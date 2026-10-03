"""An explicit simulator and a reconnecting USB-serial transport."""
import array
import asyncio
import collections
import concurrent.futures
import contextlib
import glob
import json
import logging
import math
import os
import random
import struct
import sys
import time

from .protocol import Decoder, Kind, encode

log = logging.getLogger(__name__)

# A knock on the case (docs/PROTOCOL.md, KNOCK and KNOCK_SET): the node's peak threshold for each
# sensitivity setting, in the units of the streamed 16-bit audio. 0 switches detection off.
# Measured on the case (PR #4, 2026-10-01): Sam's lightest wanted taps peak around 8000 and below, a
# quiet room near 2300. Medium (4000) caught 34 of 34 taps in the first test; high stays above the room.
KNOCK_THRESHOLDS = {"off": 0, "low": 8000, "medium": 4000, "high": 3000}
# The button itself can sound like a tap: during 11 minutes of button-only play at full volume about
# 15 of 36 stray knocks came with a button press, loud and bright, past the node's own 60 ms guard
# (PR #4). The service also drops a knock, by the node's clock, while the button is down, from
# KNOCK_GUARD_BEFORE_US before any button edge, or up to KNOCK_GUARD_AFTER_US after one.
KNOCK_GUARD_BEFORE_US = 60_000
KNOCK_GUARD_AFTER_US = 200_000
# A two-microphone node (board 2) streams both channels; speech and sound analysis get one. "sum" is
# the average of the two, which keeps a voice in front of the box and halves each microphone's own
# noise; "left" and "right" are for comparing them.
MIC_MIXES = ("sum", "left", "right")


def fold_lamps(values):
    """Twelve values (four lamps) as nine (left, middle, right): the middle takes the brighter of the
    two middle lamps, channel by channel."""
    values = list(values)
    return values[0:3] + [max(a, b) for a, b in zip(values[3:6], values[6:9])] + values[9:12]


def spread_lamps(values):
    """Nine values (left, middle, right) as twelve: both middle lamps show the middle."""
    values = list(values)
    return values[0:6] + values[3:6] + values[6:9]


WRITE_FAILURES_LIMIT = 3   # consecutive failed writes before the link is torn down and reopened
READ_STALL_S = 1.5         # a serial read that has not returned by then (it waits at most 0.1 s) means a dead link
REPEAT_LOG_EVERY = 30      # a link that stays down is logged on the first failure, then every 30th


# Simulated taps: right-minus-left level (dB), right's delay (samples) and spread, near the medians of
# the Pi's labelled session on the two-microphone case (2026-10-02).
SIMULATED_SIDES = {"left": (-0.5, 3, 0.8), "right": (3.0, -3, 0.8), "back": (3.5, -1, 0.8)}  # back: the top's values, until measured


def simulated_tap(side, rng=random):
    """An 11 ms two-microphone clip (16 samples before the onset) of a tap on `side`."""
    level, delay, spread = SIMULATED_SIDES[side]
    level += rng.uniform(-spread, spread)
    delay += rng.choice((-1, 0, 0, 1))
    gain = 10 ** (level / 20)
    def ring(start, amplitude):
        out = []
        for i in range(176):
            t = (i - start) / 16000
            out.append(int(amplitude * math.exp(-t / 0.004) * math.sin(2 * math.pi * 900 * t)) if i >= start else 0)
        return [v + rng.randint(-40, 40) for v in out]
    left = ring(16 + max(0, -delay), 12000)
    right = ring(16 + max(0, delay), 12000 * gain)
    return {"pre": 16, "left": left, "right": right}


class SimulatedDevice:
    simulated = True

    def __init__(self, emit):
        self.emit = emit
        self.connected = True
        self.mic = False
        self.leds = [0] * 9
        self.lamps = 4              # the simulator stands in for the second node: four lamps, a board LED
        self.mics = 2
        self.lamp_values = [0] * 12  # every physical lamp; `leds` stays the three logical ones
        self.board_led = [0, 0, 0]
        self.has_board_led = True
        self.cue_task = None
        self.pattern_task = None
        self.crc_errors = 0
        self.audio_missing = 0
        self.audio_bytes = 0
        self.name = "SIMULATED NODE"
        self.pressed = False
        self.generation = 1
        self.knock_threshold = 0
        self.status = {"fw": "simulated", "link": "simulated", "mic": False, "button": False,
                       "sensor": {"simulated": True, "ok": 0, "fail": 0, "err": None},
                       "knock": {"thr": 0, "n": 0, "btn": 0, "long": 0, "peak": 0}}
        self.status_at = time.monotonic()

    async def run(self):
        await self.emit({"type": "device", "connected": True, "simulated": True, "name": self.name})
        while True:
            t = time.monotonic()
            await self.emit({"type": "sensor", "temperature": round(22 + math.sin(t / 95) * .7, 2),
                             "humidity": round(43 + math.sin(t / 120) * 2, 2), "simulated": True})
            self.status["sensor"]["ok"] += 1
            self.status_at = time.monotonic()
            await asyncio.sleep(5)

    async def command(self, kind, payload=b""):
        if kind == Kind.LEDS:
            self.cancel_pattern()
            await self.show(payload)
        elif kind == Kind.BOARD_LED:
            self.board_led = list(payload)
            await self.emit({"type": "board_led", "values": self.board_led})
        elif kind == Kind.MIC:
            self.mic = bool(payload[0])
            self.status["mic"] = self.mic
        elif kind == Kind.KNOCK_SET:
            self.knock_threshold = struct.unpack("<H", payload)[0]
            self.status["knock"]["thr"] = self.knock_threshold
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
            size = (len(payload) - 2) // count  # 11: nine values a step; 14: twelve
            steps = [struct.unpack_from(f"<H{size - 2}B", payload, 2 + i * size) for i in range(count)]
            async def play():
                for _ in range(repeat):
                    for step in steps:
                        await self.show(step[1:])
                        await asyncio.sleep(step[0] / 1000)
                await self.show(bytes(9))
            self.pattern_task = asyncio.create_task(play())

    async def show(self, values):
        """Nine values (three logical lamps) or twelve (four lamps), as the node takes them."""
        values = list(values)
        self.lamp_values = values if len(values) == 12 else spread_lamps(values)
        self.leds = fold_lamps(self.lamp_values)
        await self.emit({"type": "leds", "values": self.leds, "lamps": self.lamp_values})

    def cancel_pattern(self):
        if self.pattern_task:
            self.pattern_task.cancel()
            self.pattern_task = None

    async def button(self, pressed):
        if self.pressed != pressed:
            self.pressed = pressed
            await self.emit({"type": "button", "pressed": pressed, "at_us": time.monotonic_ns() // 1000, "source": "simulator", "generation": self.generation})

    async def set_knock(self, threshold):
        await self.command(Kind.KNOCK_SET, struct.pack("<H", threshold))

    async def knock(self, side=None):
        """A simulated knock on the case, as strong as a firm tap. Ignored while detection is off, as on the node.
        With a side, it also carries a two-microphone clip shaped like a tap on that side of the real case."""
        if not self.knock_threshold:
            return
        self.status["knock"]["n"] += 1
        self.status["knock"]["peak"] = 20000
        event = {"type": "knock", "at_us": time.monotonic_ns() // 1000, "peak": 20000, "source": "simulator",
                 "generation": self.generation}
        if side:
            event["clip"] = simulated_tap(side)
        await self.emit(event)

    def status_age(self):
        """Seconds since the last status record (None before the first)."""
        return None if self.status_at is None else time.monotonic() - self.status_at

    async def close(self):
        await self.command(Kind.CANCEL)


class SerialDevice:
    simulated = False

    def __init__(self, port, baud, emit):
        # Several comma-separated candidates may be given (the node's COM bridge
        # and its native USB port); the first one present is used on each attempt.
        # A candidate may be a pattern (…/usb-Espressif_USB_JTAG_serial_debug_unit_*), so a
        # different node on the same cable is found without editing the service.
        self.ports = [candidate.strip() for candidate in port.split(",") if candidate.strip()] or [port]
        self.port = self.ports[0]
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
        self.status = None          # last HELLO/STATUS payload from the node
        self.status_at = None       # monotonic time it arrived
        self.write_failures = 0     # consecutive failed serial writes
        self.knock_threshold = 0    # what the console wants; the node is told on connect and whenever its STATUS differs
        self.button_edges = collections.deque(maxlen=16)  # (node at_us, pressed) of recent button edges
        self.knock_guarded = 0      # knocks dropped as the button's own sound
        # The link's reads and writes get threads of their own, fresh for each connection: a stalled
        # node then cannot tie up the shared pool that speech, sound analysis and health sampling use,
        # and a read stuck on a dead port cannot hold up the next connection.
        self.reader = self.writer = None
        self.link_broken = False    # set when repeated write failures closed the port
        self.knock_clip = None      # (at_us, clip) of the last KNOCK_CLIP, for the KNOCK that follows it
        self.attempt_failures = 0   # consecutive connection attempts that never heard the node
        self.mic_mix = "sum"        # which microphone(s) of a two-microphone node feed speech and analysis
        self.lamp_values = [0] * 9  # every physical lamp's values, as the node last reported or was told
        self.board_led = [0, 0, 0]

    @property
    def has_board_led(self):
        """Firmware 0.2.0 and later drives the development board's own LED."""
        return isinstance(self.status, dict) and "board_led" in self.status

    @property
    def lamps(self):
        """Physical lamps on the connected node: 3, or 4 on the second board."""
        return int((self.status or {}).get("lamps", 3) or 3)

    @property
    def mics(self):
        return int((self.status or {}).get("mics", 1) or 1)

    def candidates(self):
        """The port candidates with patterns expanded, in the order given."""
        found = []
        for candidate in self.ports:
            matches = sorted(glob.glob(candidate)) if any(ch in candidate for ch in "*?[") else [candidate]
            found.extend(match for match in matches if match not in found)
        return found

    @property
    def crc_errors(self):
        return self.decoder.errors

    async def write(self, frame):
        """Write one frame. Repeated failures close the port, so the read loop reconnects cleanly
        instead of leaving a link that can read but not write."""
        link = self.serial
        try:
            await asyncio.get_running_loop().run_in_executor(self.writer, link.write, frame)
        except Exception as exc:
            self.write_failures += 1
            if self.write_failures >= WRITE_FAILURES_LIMIT and link is self.serial and not self.link_broken:
                log.warning("Node link: %d writes failed in a row (%s); reconnecting", self.write_failures, exc)
                self.link_broken = True  # the read loop sees this at once and reconnects
                with contextlib.suppress(Exception):
                    link.close()
            raise
        self.write_failures = 0

    async def raw_send(self, kind, payload=b""):
        async with self.write_lock:
            if not self.serial:
                raise ConnectionError("Node is disconnected")
            sequence = self.sequence
            self.sequence = (sequence + 1) & 65535
            await self.write(encode(kind, payload, sequence))
            return sequence

    async def command(self, kind, payload=b""):
        # Publish the future before writing: a fast ACK cannot race registration.
        async with self.write_lock:
            if not self.serial or not self.connected:
                raise ConnectionError("Node is disconnected")
            if kind == Kind.MIC and payload == b"\x01" and self.mics == 2:
                payload = b"\x02"  # both microphones; packet() mixes them down
            if kind == Kind.LEDS and len(payload) == 12 and self.lamps == 3:
                payload = bytes(fold_lamps(payload))  # a four-lamp picture on a three-lamp node
            if kind == Kind.PATTERN and self.lamps == 3 and len(payload) == 2 + payload[1] * 14:
                payload = payload[:2] + b"".join(
                    payload[2 + i * 14:4 + i * 14] + bytes(fold_lamps(payload[4 + i * 14:16 + i * 14])) for i in range(payload[1]))
            if kind == Kind.BOARD_LED and not self.has_board_led:
                return  # older firmware: nothing to light, and nothing to complain about
            sequence = self.sequence
            self.sequence = (sequence + 1) & 65535
            future = asyncio.get_running_loop().create_future()
            self.pending[sequence] = future
            try:
                await self.write(encode(kind, payload, sequence))
            except Exception:
                self.pending.pop(sequence, None)
                raise
        try:
            await asyncio.wait_for(future, 1.5)
        finally:
            self.pending.pop(sequence, None)
        if kind == Kind.LEDS:
            values = list(payload)
            self.lamp_values = values if len(values) == 3 * self.lamps else spread_lamps(values) if self.lamps == 4 else values
            self.leds = fold_lamps(self.lamp_values) if len(self.lamp_values) == 12 else self.lamp_values
            await self.emit({"type": "leds", "values": self.leds, "lamps": self.lamp_values})
        elif kind == Kind.BOARD_LED:
            self.board_led = list(payload)
            await self.emit({"type": "board_led", "values": self.board_led})

    async def run(self):
        import serial
        while True:
            try:
                # Opening either port may reset the board. Wait for a valid
                # protocol packet, then explicitly renegotiate a muted session.
                # Each attempt that never hears the node moves on to the next
                # candidate port, so a present but silent first port cannot block a working one.
                candidates = self.candidates()
                present = [candidate for candidate in candidates if os.path.exists(candidate)] or candidates or self.ports
                self.port = present[self.attempt_failures % len(present)]
                self.name = self.port
                link = serial.Serial()
                link.port, link.baudrate = self.port, self.baud
                link.timeout, link.write_timeout = .1, .5
                link.dtr = False
                link.rts = False
                link.open()
                for pool in (self.reader, self.writer):
                    if pool:
                        pool.shutdown(wait=False)
                self.reader = concurrent.futures.ThreadPoolExecutor(1, thread_name_prefix="node-read")
                self.writer = concurrent.futures.ThreadPoolExecutor(1, thread_name_prefix="node-write")
                self.link_broken = False
                self.serial = link
                self.decoder = Decoder()
                self.last_seen = time.monotonic()
                self.audio_expected = None
                self.write_failures = 0
                heartbeat = asyncio.create_task(self.heartbeat())
                try:
                    while True:
                        def read_available():
                            # A large fixed read would delay a lone button event
                            # until the serial timeout. Wake on the first byte.
                            if not link.is_open:
                                raise ConnectionError("Port closed")
                            first = link.read(1)
                            return first + link.read(min(link.in_waiting or 0, 8192))
                        if self.link_broken:
                            raise ConnectionError("Writes failed")
                        try:
                            data = await asyncio.wait_for(
                                asyncio.get_running_loop().run_in_executor(self.reader, read_available), READ_STALL_S)
                        except asyncio.TimeoutError:
                            raise ConnectionError("Serial read stalled") from None
                        for packet in self.decoder.feed(data):
                            self.last_seen = time.monotonic()
                            if not self.connected:
                                self.attempt_failures = 0
                                self.connected = True
                                self.generation += 1
                                await self.raw_send(Kind.MIC, b"\x00")
                                await self.raw_send(Kind.CANCEL)
                                await self.raw_send(Kind.LEDS, bytes(9))
                                if self.knock_threshold:
                                    await self.raw_send(Kind.KNOCK_SET, struct.pack("<H", self.knock_threshold))
                                await self.emit({"type": "device", "connected": True, "simulated": False, "name": self.port})
                            await self.packet(packet)
                        if heartbeat.done():
                            heartbeat.result()  # re-raises the heartbeat's own error
                            raise ConnectionError("Heartbeat stopped")
                        if time.monotonic() - self.last_seen > 4:
                            raise ConnectionError("Node heartbeat timed out")
                finally:
                    heartbeat.cancel()
                    await asyncio.gather(heartbeat, return_exceptions=True)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                # An absent node fails every two seconds for as long as the cable is out:
                # say so once, then now and then, not 43,000 times a day.
                if self.connected or self.attempt_failures % REPEAT_LOG_EVERY == 0:
                    log.warning("Node link: %s", exc)
            finally:
                was_connected = self.connected
                if not was_connected:
                    self.attempt_failures += 1
                self.connected = False
                self.mic = False
                for future in self.pending.values():
                    if not future.done():
                        future.set_exception(ConnectionError("Node disconnected"))
                self.pending.clear()
                if self.serial:
                    with contextlib.suppress(Exception):
                        self.serial.close()
                self.serial = None
                # Announce a loss only when there was a link to lose; the browser treats
                # every such event as a fresh disconnect.
                if was_connected:
                    await self.emit({"type": "device", "connected": False, "simulated": False, "name": self.port})
            await asyncio.sleep(2)

    async def set_knock(self, threshold):
        """Firmware before 0.1.3 does not know KNOCK_SET and answers it as unknown; nothing waits for
        that answer, so the command is sent without one and STATUS confirms it."""
        self.knock_threshold = threshold
        if self.serial and self.connected:
            await self.raw_send(Kind.KNOCK_SET, struct.pack("<H", threshold))

    async def heartbeat(self):
        failures = 0
        while True:
            try:
                await self.raw_send(Kind.PING)
                failures = 0
            except Exception as exc:
                failures += 1
                log.warning("Heartbeat write failed (%d): %s", failures, exc)
                if failures >= WRITE_FAILURES_LIMIT:
                    raise  # run() sees the finished task and reconnects
            await asyncio.sleep(1)

    def button_sound(self, at):
        """Whether a knock at node time `at` is more likely the button than a tap: the button was down
        then, or an edge lies within the guard around it. Edges a little after `at` may not have
        arrived yet; the node's own guard covers those."""
        down = False
        for edge, pressed in self.button_edges:
            if at - KNOCK_GUARD_AFTER_US <= edge <= at + KNOCK_GUARD_BEFORE_US:
                return True
            if edge <= at:
                down = pressed
        return down

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
                self.button_edges.append((at, self.pressed))
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
            elif kind == Kind.AUDIO2 and len(p) >= 8 and len(p) % 4 == 0:
                # Two microphones, left/right pairs. Consumers get one channel, as from a one-microphone node.
                index = struct.unpack_from("<I", p)[0]
                frames = (len(p) - 4) // 4
                if self.audio_expected is not None and index != self.audio_expected:
                    gap = (index - self.audio_expected) & 0xFFFFFFFF
                    self.audio_missing += gap if gap < 160000 else 0
                self.audio_expected = (index + frames) & 0xFFFFFFFF
                self.audio_bytes += frames * 2
                pairs = array.array("h", p[4:])
                if self.mic_mix == "left":
                    mono = pairs[0::2]
                elif self.mic_mix == "right":
                    mono = pairs[1::2]
                else:
                    mono = array.array("h", [(pairs[i] + pairs[i + 1]) // 2 for i in range(0, len(pairs), 2)])
                await self.emit({"type": "audio", "pcm": mono.tobytes()})
            elif kind == Kind.KNOCK_CLIP and len(p) >= 14 and (len(p) - 10) % 4 == 0 and p[9] == 2:
                # Sent just before its KNOCK, from a two-microphone node: kept until that KNOCK arrives.
                at, pre = struct.unpack_from("<QB", p)
                pairs = array.array("h", p[10:])
                if sys.byteorder != "little":
                    pairs.byteswap()
                self.knock_clip = (at, {"pre": pre, "left": list(pairs[0::2]), "right": list(pairs[1::2])})
            elif kind == Kind.KNOCK and len(p) in (10, 11):
                at, peak = struct.unpack_from("<QH", p)
                event = {"type": "knock", "at_us": at, "peak": peak, "source": "node", "generation": self.generation}
                if len(p) == 11:
                    event["hf"] = p[10]
                clip, self.knock_clip = self.knock_clip, None
                if clip and clip[0] == at:
                    event["clip"] = clip[1]
                if self.button_sound(at):
                    self.knock_guarded += 1
                    log.debug("Knock at %d dropped as the button's sound (peak %d)", at, peak)
                else:
                    await self.emit(event)
            elif kind == Kind.CUE and len(p) == 12:
                trial, at = struct.unpack("<IQ", p)
                await self.emit({"type": "cue", "trial": trial, "at_us": at, "simulated": False, "generation": self.generation})
            elif kind in (Kind.HELLO, Kind.STATUS):
                if kind == Kind.HELLO:
                    self.audio_expected = None
                    self.button_edges.clear()  # the node's clock restarts
                    self.generation += 1
                    await self.emit({"type": "node_reset", "generation": self.generation})
                state = json.loads(p)
                if not isinstance(state, dict):
                    raise ValueError("status is not an object")
                self.status, self.status_at = state, time.monotonic()
                self.mic = bool(state.get("mic", False))
                self.pressed = bool(state.get("button", False))
                if "leds" in state:
                    values = state["leds"]
                    # Four lamps: `leds` stays the three logical lamps (left, middle, right) for
                    # everything written for three; `lamp_values` has all of them.
                    self.lamp_values = values
                    self.leds = fold_lamps(values) if len(values) == 12 else values
                if isinstance(state.get("board_led"), list):
                    self.board_led = state["board_led"]
                # A node that lost the setting (it resets it after 3 s without the host, and at boot) is
                # told again. Firmware without knock detection has no "knock" field and is left alone.
                knock = state.get("knock")
                if isinstance(knock, dict) and knock.get("thr") != self.knock_threshold and self.serial:
                    await self.raw_send(Kind.KNOCK_SET, struct.pack("<H", self.knock_threshold))
                await self.emit({"type": "node_status", **state, "crcErrors": self.crc_errors,
                                 "missingSamples": self.audio_missing, "audioBytes": self.audio_bytes, "generation": self.generation})
        except (ValueError, struct.error, UnicodeDecodeError) as exc:
            log.warning("Invalid node payload: %s", exc)
        except Exception:
            # A failure while handling one packet (storage, a listener) is that packet's failure,
            # not a reason to drop the link.
            log.exception("Node packet handling failed")

    def status_age(self):
        """Seconds since the last HELLO/STATUS from the node (None before the first)."""
        return None if self.status_at is None else time.monotonic() - self.status_at

    async def close(self):
        if self.serial and self.connected:
            try:
                await self.raw_send(Kind.MIC, b"\x00")
                await self.raw_send(Kind.CANCEL)
                await self.raw_send(Kind.LEDS, bytes(9))
                await self.raw_send(Kind.BOARD_LED, bytes(3))
            except Exception:
                pass
