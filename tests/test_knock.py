"""Knock on the case (docs/PROTOCOL.md KNOCK and KNOCK_SET): the service tells the node the
sensitivity, repeats it when the node has lost it, decodes knocks, leaves older firmware alone, and
the simulator produces knocks on request. Nothing here opens a serial port or touches port 8799.
"""
import asyncio
import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_service_fixes import FakeSerial, REAL_SLEEP, SerialCase, ServiceCase  # noqa: E402

from vesper.catalog import validate_setting  # noqa: E402
from vesper.device import KNOCK_THRESHOLDS, SerialDevice  # noqa: E402
from vesper.protocol import Decoder, Kind, encode  # noqa: E402


class KnockNode(FakeSerial):
    """A fake node running firmware 0.1.3: it keeps the threshold it is sent and reports it in STATUS."""
    def __init__(self):
        super().__init__()
        self.knock_threshold = 0

    def write(self, data):
        frames = Decoder().feed(data)
        for packet in frames:
            if packet.kind == Kind.KNOCK_SET:
                self.knock_threshold = struct.unpack("<H", packet.payload)[0]
        return super().write(data)

    def _status(self):
        return encode(Kind.STATUS, json.dumps({"fw": "vesper-node-0.1.3", "link": "usb", "mic": self.mic, "button": False,
                                               "leds": [0] * 9, "knock": {"thr": self.knock_threshold, "n": 0, "btn": 0,
                                                                           "long": 0, "peak": 0}}).encode(), 0)


class KnockLink(SerialCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        sys.modules["serial"].Serial = KnockNode

    async def test_the_node_is_told_on_connect_and_again_after_it_forgets(self):
        async with self.device() as device:
            device.knock_threshold = KNOCK_THRESHOLDS["medium"]
            await self.until(lambda: device.connected, message="link up")
            node = FakeSerial.created[-1]
            await self.until(lambda: node.knock_threshold == 4000, message="threshold sent")
            kinds = [p.kind for p in node.frames if p.kind != Kind.PING]
            self.assertEqual(kinds[:4], [Kind.MIC, Kind.CANCEL, Kind.LEDS, Kind.KNOCK_SET])
            # The node drops the setting after 3 s without the host; its next STATUS says so.
            node.knock_threshold = 0
            await self.until(lambda: node.knock_threshold == 4000, message="threshold re-sent after STATUS")
            await device.set_knock(0)
            await self.until(lambda: node.knock_threshold == 0, message="detection switched off")
            sent = node.count(Kind.KNOCK_SET)
            await REAL_SLEEP(.3)
            self.assertLessEqual(node.count(Kind.KNOCK_SET), sent + 1, "a node that agrees is not told again")

    async def test_older_firmware_without_knock_status_is_left_alone(self):
        sys.modules["serial"].Serial = FakeSerial
        async with self.device() as device:
            device.knock_threshold = 4000
            await self.until(lambda: device.connected, message="link up")
            node = FakeSerial.created[-1]
            await REAL_SLEEP(.3)
            self.assertEqual(node.count(Kind.KNOCK_SET), 1, "told once on connect, never repeated")


class KnockDecode(unittest.IsolatedAsyncioTestCase):
    async def test_knock_frame_becomes_an_event_with_the_node_clock(self):
        events = []
        async def emit(event): events.append(event)
        device = SerialDevice("unused", 921600, emit)
        frames = (encode(Kind.KNOCK, struct.pack("<QH", 123456789, 18000)) + encode(Kind.KNOCK, b"\x00" * 9)
                  + encode(Kind.KNOCK, struct.pack("<QHB", 5, 32767, 41)))
        for packet in Decoder().feed(frames):
            await device.packet(packet)
        self.assertEqual(events, [{"type": "knock", "at_us": 123456789, "peak": 18000, "source": "node", "generation": 0},
                                  {"type": "knock", "at_us": 5, "peak": 32767, "hf": 41, "source": "node", "generation": 0}])

    async def test_knocks_from_the_button_are_dropped(self):
        events = []
        async def emit(event): events.append(event)
        device = SerialDevice("unused", 921600, emit)
        ms = 1000
        def button(at, pressed): return encode(Kind.BUTTON, struct.pack("<QB", at * ms, pressed))
        def knock(at): return encode(Kind.KNOCK, struct.pack("<QHB", at * ms, 30000, 120))
        stream = (knock(1000)                                 # a tap, nothing near: kept
                  + button(2000, 1) + knock(2100)             # while the button is down
                  + button(2150, 0) + knock(2300)             # 150 ms after the release
                  + knock(2400)                               # 250 ms after: kept
                  + knock(2950) + button(3000, 1)             # 50 ms before a press (arrives first)
                  + button(3120, 0) + knock(3500)             # a tap well after the press: kept
                  + encode(Kind.HELLO, json.dumps({"fw": "vesper-node-0.1.3"}).encode()) + knock(2100))  # node restarted
        for packet in Decoder().feed(stream):
            await device.packet(packet)
        knocks = [e["at_us"] // ms for e in events if e["type"] == "knock"]
        self.assertEqual(knocks, [1000, 2400, 2950, 3500, 2100])
        self.assertEqual(device.knock_guarded, 2)
        # The press that follows a knock is caught when the knock arrives late.
        device.button_edges.append((4000 * ms, True))
        device.button_edges.append((4100 * ms, False))
        self.assertTrue(device.button_sound(3960 * ms))
        self.assertFalse(device.button_sound(3900 * ms))

    def test_setting_values(self):
        for value in ("off", "low", "medium", "high"):
            self.assertEqual(validate_setting("knock", value), value)
        for value in ("loud", True, 3, None):
            with self.assertRaises(ValueError):
                validate_setting("knock", value)
        self.assertEqual(set(KNOCK_THRESHOLDS), {"off", "low", "medium", "high"})
        self.assertEqual(KNOCK_THRESHOLDS["off"], 0)
        self.assertTrue(all(256 <= v <= 32767 for k, v in KNOCK_THRESHOLDS.items() if k != "off"),
                        "within the range the firmware accepts")


class KnockService(ServiceCase):
    async def test_simulated_knock_follows_the_setting(self):
        ws, state = await self.connect()
        self.assertEqual(state["settings"]["knock"], "medium")
        self.assertEqual(self.console.device.knock_threshold, 4000)
        await ws.send_json({"command": "knock", "requestId": 900})
        seen = []
        while not any(e.get("type") == "reply" and e.get("id") == 900 for e in seen):
            seen.append(await asyncio.wait_for(ws.receive_json(), 2))
        self.assertTrue(seen[-1]["ok"])
        event = next(e for e in seen if e.get("type") == "knock")
        self.assertEqual(event["source"], "simulator")
        self.assertGreater(event["peak"], 4000)
        self.assertTrue((await self.rpc(ws, "settings", key="knock", value="off"))["ok"])
        self.assertEqual(self.console.device.knock_threshold, 0)
        await self.rpc(ws, "knock")
        await self.rpc(ws, "keepalive")
        self.assertEqual(self.console.device.status["knock"]["n"], 1, "no knock while off")
        self.assertFalse((await self.rpc(ws, "settings", key="knock", value="loud"))["ok"])
        self.assertTrue((await self.rpc(ws, "reset_settings"))["ok"])
        self.assertEqual(self.console.device.knock_threshold, 4000)
        system = await (await self.client.get("/api/system")).json()
        self.assertEqual(system["node"]["knock"]["thr"], 4000)
        await ws.close()

    async def test_knock_command_is_refused_on_hardware(self):
        self.console.device.simulated = False
        try:
            ws, _ = await self.connect()
            reply = await self.rpc(ws, "knock")
            self.assertFalse(reply["ok"])
            await ws.close()
        finally:
            self.console.device.simulated = True


if __name__ == "__main__":
    unittest.main()
