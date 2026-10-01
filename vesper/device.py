"""An explicit simulator and a reconnecting USB-serial transport."""
import asyncio
import json
import logging
import math
import struct
import time

from .protocol import Decoder, Kind, encode

log = logging.getLogger(__name__)


class SimulatedDevice:
    simulated = True

    def __init__(self, emit):
        self.emit = emit
        self.connected = True
        self.mic = False
        self.leds = [0] * 9
        self.cue_task = None
        self.pattern_task = None
        self.crc_errors = 0
        self.audio_missing = 0
        self.audio_bytes = 0
        self.name = "SIMULATED NODE"
        self.pressed = False
        self.generation = 1

    async def run(self):
        await self.emit({"type": "device", "connected": True, "simulated": True, "name": self.name})
        while True:
            t = time.monotonic()
            await self.emit({"type": "sensor", "temperature": round(22 + math.sin(t / 95) * .7, 2),
                             "humidity": round(43 + math.sin(t / 120) * 2, 2), "simulated": True})
            await asyncio.sleep(5)

    async def command(self, kind, payload=b""):
        if kind == Kind.LEDS:
            self.cancel_pattern()
            self.leds = list(payload)
            await self.emit({"type": "leds", "values": self.leds})
        elif kind == Kind.MIC:
            self.mic = bool(payload[0])
        elif kind == Kind.ARM:
            await self.command(Kind.CANCEL)
            trial, delay, index, r, g, b = struct.unpack("<IIBBBB", payload)
            async def fire():
                await asyncio.sleep(delay / 1000)
                values = [0] * 9
                values[index*3:index*3+3] = [r, g, b]
                await self.command(Kind.LEDS, bytes(values))
                await self.emit({"type": "cue", "trial": trial, "at_us": time.monotonic_ns() // 1000, "simulated": True, "generation": self.generation})
            self.cue_task = asyncio.create_task(fire())
        elif kind == Kind.CANCEL:
            if self.cue_task:
                self.cue_task.cancel()
                self.cue_task = None
            self.cancel_pattern()
        elif kind == Kind.PATTERN:
            self.cancel_pattern()
            repeat, count = payload[:2]
            steps = [struct.unpack_from("<H9B", payload, 2 + i * 11) for i in range(count)]
            async def play():
                for _ in range(repeat):
                    for step in steps:
                        self.leds = list(step[1:])
                        await self.emit({"type": "leds", "values": self.leds})
                        await asyncio.sleep(step[0] / 1000)
                self.leds = [0] * 9
                await self.emit({"type": "leds", "values": self.leds})
            self.pattern_task = asyncio.create_task(play())

    def cancel_pattern(self):
        if self.pattern_task:
            self.pattern_task.cancel()
            self.pattern_task = None

    async def button(self, pressed):
        if self.pressed != pressed:
            self.pressed = pressed
            await self.emit({"type": "button", "pressed": pressed, "at_us": time.monotonic_ns() // 1000, "source": "simulator", "generation": self.generation})

    async def close(self):
        await self.command(Kind.CANCEL)


class SerialDevice:
    simulated = False

    def __init__(self, port, baud, emit):
        self.port = port
        self.baud = baud
        self.emit = emit
        self.serial = None
        self.connected = False
        self.mic = False
        self.leds = [0] * 9
        self.name = port
        self.sequence = 0
        self.decoder = Decoder()
        self.write_lock = asyncio.Lock()
        self.pending = {}
        self.last_seen = 0
        self.audio_expected = None
        self.audio_missing = 0
        self.audio_bytes = 0
        self.pressed = False
        self.generation = 0

    @property
    def crc_errors(self):
        return self.decoder.errors

    async def raw_send(self, kind, payload=b""):
        async with self.write_lock:
            if not self.serial:
                raise ConnectionError("Node is disconnected")
            sequence = self.sequence
            self.sequence = (sequence + 1) & 65535
            await asyncio.to_thread(self.serial.write, encode(kind, payload, sequence))
            return sequence

    async def command(self, kind, payload=b""):
        # Publish the future before writing: a fast ACK cannot race registration.
        async with self.write_lock:
            if not self.serial or not self.connected:
                raise ConnectionError("Node is disconnected")
            sequence = self.sequence
            self.sequence = (sequence + 1) & 65535
            future = asyncio.get_running_loop().create_future()
            self.pending[sequence] = future
            try:
                await asyncio.to_thread(self.serial.write, encode(kind, payload, sequence))
            except Exception:
                self.pending.pop(sequence, None)
                raise
        try:
            await asyncio.wait_for(future, 1.5)
        finally:
            self.pending.pop(sequence, None)
        if kind == Kind.LEDS:
            self.leds = list(payload)
            await self.emit({"type": "leds", "values": self.leds})

    async def run(self):
        import serial
        while True:
            try:
                # Opening CH343 may reset some development boards. Wait for a valid
                # protocol packet, then explicitly renegotiate a muted session.
                link = serial.Serial()
                link.port, link.baudrate = self.port, self.baud
                link.timeout, link.write_timeout = .1, .5
                link.dtr = False
                link.rts = False
                link.open()
                self.serial = link
                self.decoder = Decoder()
                self.last_seen = time.monotonic()
                self.audio_expected = None
                heartbeat = asyncio.create_task(self.heartbeat())
                try:
                    while True:
                        def read_available():
                            # A large fixed read would delay a lone button event
                            # until the serial timeout. Wake on the first byte.
                            first = link.read(1)
                            return first + link.read(min(link.in_waiting, 8192))
                        data = await asyncio.to_thread(read_available)
                        for packet in self.decoder.feed(data):
                            self.last_seen = time.monotonic()
                            if not self.connected:
                                self.connected = True
                                self.generation += 1
                                await self.raw_send(Kind.MIC, b"\x00")
                                await self.raw_send(Kind.CANCEL)
                                await self.raw_send(Kind.LEDS, bytes(9))
                                await self.emit({"type": "device", "connected": True, "simulated": False, "name": self.port})
                            await self.packet(packet)
                        if time.monotonic() - self.last_seen > 4:
                            raise ConnectionError("Node heartbeat timed out")
                finally:
                    heartbeat.cancel()
                    await asyncio.gather(heartbeat, return_exceptions=True)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                log.warning("Node link: %s", exc)
            finally:
                self.connected = False
                self.mic = False
                for future in self.pending.values():
                    if not future.done():
                        future.set_exception(ConnectionError("Node disconnected"))
                self.pending.clear()
                if self.serial:
                    self.serial.close()
                self.serial = None
                await self.emit({"type": "device", "connected": False, "simulated": False, "name": self.port})
            await asyncio.sleep(2)

    async def heartbeat(self):
        while True:
            await self.raw_send(Kind.PING)
            await asyncio.sleep(1)

    async def packet(self, packet):
        kind, p = packet.kind, packet.payload
        try:
            if kind == Kind.ACK and len(p) == 4:
                sequence, result, original = struct.unpack("<HBB", p)
                future = self.pending.get(sequence)
                if future and not future.done():
                    if result:
                        future.set_exception(ValueError(f"Node rejected command {original}: {result}"))
                    else:
                        future.set_result(True)
            elif kind == Kind.BUTTON and len(p) == 9:
                at, pressed = struct.unpack("<QB", p)
                self.pressed = bool(pressed)
                await self.emit({"type": "button", "pressed": self.pressed, "at_us": at, "source": "node", "generation": self.generation})
            elif kind == Kind.SENSOR and len(p) == 16:
                at, temperature, humidity = struct.unpack("<Qff", p)
                if math.isfinite(temperature) and math.isfinite(humidity):
                    await self.emit({"type": "sensor", "temperature": temperature, "humidity": humidity, "at_us": at, "simulated": False})
            elif kind == Kind.AUDIO and len(p) >= 6 and len(p) % 2 == 0:
                index = struct.unpack_from("<I", p)[0]
                if self.audio_expected is not None and index != self.audio_expected:
                    gap = (index - self.audio_expected) & 0xFFFFFFFF
                    self.audio_missing += gap if gap < 160000 else 0
                self.audio_expected = (index + (len(p) - 4) // 2) & 0xFFFFFFFF
                self.audio_bytes += len(p) - 4
                await self.emit({"type": "audio", "pcm": p[4:]})
            elif kind == Kind.CUE and len(p) == 12:
                trial, at = struct.unpack("<IQ", p)
                await self.emit({"type": "cue", "trial": trial, "at_us": at, "simulated": False, "generation": self.generation})
            elif kind in (Kind.HELLO, Kind.STATUS):
                if kind == Kind.HELLO:
                    self.audio_expected = None
                    self.generation += 1
                    await self.emit({"type": "node_reset", "generation": self.generation})
                state = json.loads(p)
                self.mic = bool(state.get("mic", False))
                self.pressed = bool(state.get("button", False))
                if "leds" in state:
                    self.leds = state["leds"]
                await self.emit({"type": "node_status", **state, "crcErrors": self.crc_errors,
                                 "missingSamples": self.audio_missing, "audioBytes": self.audio_bytes, "generation": self.generation})
        except (ValueError, struct.error, UnicodeDecodeError) as exc:
            log.warning("Invalid node payload: %s", exc)

    async def close(self):
        if self.serial and self.connected:
            try:
                await self.raw_send(Kind.MIC, b"\x00")
                await self.raw_send(Kind.CANCEL)
                await self.raw_send(Kind.LEDS, bytes(9))
            except Exception:
                pass
