"""The second node (board 2: four lamps, two microphones, no sensor; docs/PROTOCOL.md): the service
finds it by a port pattern, asks for both microphones, hands consumers one channel, and still shows
three lamps to the console. Nothing here opens a serial port or touches port 8799.
"""
import array
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_service_fixes import FakeSerial, SerialCase  # noqa: E402

from vesper.device import MIC_MIXES, SerialDevice  # noqa: E402
from vesper.protocol import Decoder, Kind, encode  # noqa: E402


class TwoMicNode(FakeSerial):
    """A fake board 2 on firmware 0.2.0: twelve lamp values in STATUS, MIC 2 accepted."""
    def __init__(self):
        super().__init__()
        self.mic_requests = []

    def write(self, data):
        for packet in Decoder().feed(data):
            if packet.kind == Kind.MIC:
                self.mic_requests.append(packet.payload)
        return super().write(data)

    def _status(self):
        return encode(Kind.STATUS, json.dumps({
            "fw": "vesper-node-0.2.0", "board": 2, "lamps": 4, "mics": 2, "link": "usb", "mic": self.mic, "stereo": self.mic,
            "button": False, "sensor": {"addr": 0, "ok": 0, "fail": 0, "err": 0},
            "leds": [1, 2, 3, 4, 5, 6, 4, 5, 6, 7, 8, 9],
            "knock": {"thr": 0, "n": 0, "btn": 0, "long": 0, "bright": 0, "peak": 0, "hf": 0}}).encode(), 0)

    def stereo(self, index, pairs):
        payload = struct.pack("<I", index) + array.array("h", [v for pair in pairs for v in pair]).tobytes()
        with self._lock:
            self._rx.extend(encode(Kind.AUDIO2, payload, 0))


class SecondNode(SerialCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        sys.modules["serial"].Serial = TwoMicNode

    async def test_four_lamps_are_reported_as_left_middle_right(self):
        async with self.device() as device:
            await self.until(lambda: device.status is not None, message="status")
            self.assertEqual((device.lamps, device.mics), (4, 2))
            self.assertEqual(device.leds, [1, 2, 3, 4, 5, 6, 7, 8, 9])

    async def test_capture_asks_for_both_microphones_and_consumers_get_one_channel(self):
        async with self.device() as device:
            await self.until(lambda: device.status is not None, message="status")
            node = FakeSerial.created[-1]
            await device.command(Kind.MIC, b"\x01")
            self.assertEqual(node.mic_requests[-1], b"\x02")
            pairs = [(1000, 3000), (-2000, 2000), (32767, 32767), (-32768, -32768)]
            want = {"sum": [2000, 0, 32767, -32768], "left": [1000, -2000, 32767, -32768], "right": [3000, 2000, 32767, -32768]}
            self.assertEqual(set(want), set(MIC_MIXES))
            index = 0
            for mix, expected in want.items():
                device.mic_mix = mix
                seen = len([e for e in device.events if e["type"] == "audio"])
                node.stereo(index, pairs)
                index += len(pairs)
                await self.until(lambda: len([e for e in device.events if e["type"] == "audio"]) > seen, message="audio " + mix)
                pcm = [e for e in device.events if e["type"] == "audio"][-1]["pcm"]
                self.assertEqual(list(array.array("h", pcm)), expected, mix)
            self.assertEqual(device.audio_missing, 0)
            node.stereo(index + 160, pairs)  # a dropped message of 160 frames
            await self.until(lambda: device.audio_missing == 160, message="gap counted in frames")

    async def test_stopping_capture_is_not_rewritten(self):
        async with self.device() as device:
            await self.until(lambda: device.status is not None, message="status")
            await device.command(Kind.MIC, b"\x00")
            self.assertEqual(FakeSerial.created[-1].mic_requests[-1], b"\x00")


class PortPatterns(unittest.TestCase):
    def test_a_pattern_finds_whichever_node_is_plugged_in(self):
        async def emit(event):
            pass
        with tempfile.TemporaryDirectory() as folder:
            for name in ("usb-Espressif_USB_JTAG_serial_debug_unit_AA-if00", "usb-Espressif_USB_JTAG_serial_debug_unit_BB-if00",
                         "usb-1a86_USB_Single_Serial_123-if00", "usb-Other-if00"):
                (Path(folder) / name).touch()
            device = SerialDevice(f"{folder}/usb-Espressif_USB_JTAG_serial_debug_unit_*, {folder}/usb-1a86_USB_Single_Serial_*,"
                                  f" {folder}/usb-Espressif_USB_JTAG_serial_debug_unit_AA-if00, /dev/absent", 921600, emit)
            self.assertEqual([Path(p).name for p in device.candidates()],
                             ["usb-Espressif_USB_JTAG_serial_debug_unit_AA-if00", "usb-Espressif_USB_JTAG_serial_debug_unit_BB-if00",
                              "usb-1a86_USB_Single_Serial_123-if00", "absent"])
            self.assertEqual(SerialDevice(f"{folder}/nothing-*", 921600, emit).candidates(), [])


if __name__ == "__main__":
    unittest.main()
