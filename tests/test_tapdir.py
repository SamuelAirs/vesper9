"""Tap direction (vesper/tapdir.py, docs/PROTOCOL.md KNOCK_CLIP): measuring a two-microphone tap,
deciding its side from this node's own labelled taps, pairing the clip with its KNOCK, and the
calibration commands. No serial port is opened.
"""
import asyncio
import json
import math
import random
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_service_fixes import ServiceCase  # noqa: E402

from vesper.device import SerialDevice, simulated_tap  # noqa: E402
from vesper.protocol import Decoder, Kind, encode  # noqa: E402
from vesper.tapdir import MIN_TAPS, Classifier, TapDirection, features  # noqa: E402

SESSION = Path(__file__).resolve().parent / "fixtures" / "tap-direction-2026-10-02.json"
SPOTS = {"left-side": "left", "right-side": "right", "top": "back"}  # that session tapped the top; stands in for back


def ring(delay, amplitude, n=176, pre=16):
    return [int(amplitude * math.exp(-(i - pre - delay) / 64) * math.sin(2 * math.pi * 900 * (i - pre - delay) / 16000))
            if i >= pre + delay else 0 for i in range(n)]


class MemoryStore:
    def __init__(self):
        self.data = {}

    def get(self, key, default=None):
        return self.data.get(key, default)

    def put(self, key, value):
        self.data[key] = json.loads(json.dumps(value))


class Features(unittest.TestCase):
    def test_signs_follow_which_microphone_heard_it_first_and_loudest(self):
        f = features(ring(0, 12000), ring(3, 6000), 16)
        self.assertAlmostEqual(f["lag"], 3, delta=0.3)
        self.assertEqual(f["onset"], 3)
        self.assertAlmostEqual(f["level_db"], -6.0, delta=0.5)
        f = features(ring(2, 5000), ring(0, 10000), 16)
        self.assertAlmostEqual(f["lag"], -2, delta=0.3)
        self.assertEqual(f["onset"], -2)
        self.assertGreater(f["level_db"], 5)
        self.assertGreater(f["corr"], 0.9)

    def test_a_clip_too_short_or_silent_is_handled(self):
        with self.assertRaises(ValueError):
            features([0] * 20, [0] * 20, 16)
        self.assertEqual(features([0] * 176, [0] * 176, 16)["level_db"], 0.0)


class Deciding(unittest.TestCase):
    def labelled(self, n, seed=1):
        rng = random.Random(seed)
        out = []
        for side in ("back", "left", "right"):
            for _ in range(n):
                clip = simulated_tap(side, rng)
                out.append({"side": side, **features(clip["left"], clip["right"], clip["pre"])})
        return out

    def test_simulated_sides_are_told_apart_from_a_calibration(self):
        classifier = Classifier(self.labelled(10))
        rng, right = random.Random(7), 0
        for side in ("back", "left", "right"):
            for _ in range(10):
                clip = simulated_tap(side, rng)
                got, votes = classifier.classify(features(clip["left"], clip["right"], clip["pre"]))
                right += got == side
                self.assertLessEqual(votes, 5)
        self.assertGreaterEqual(right, 24)

    def test_disagreeing_neighbours_leave_the_side_unsure(self):
        taps = [{"side": s, "level_db": 0, "lag": 0, "onset": 0} for s in ("left", "left", "right", "right", "back", "back")]
        self.assertEqual(Classifier(taps).classify({"level_db": 0, "lag": 0, "onset": 0})[0], None)

    def test_the_pi_session_of_2026_10_02(self):
        """One sitting on the real case. Each tap left out in turn is placed well, but a calibration from the
        first half of the sitting places the second half poorly: tapping drifts, so a calibration is per
        node and per sitting until a second session shows otherwise."""
        session = json.loads(SESSION.read_text())
        taps = [{"side": SPOTS[k], **t} for k, v in session.items() for t in v if not t["sustained"]]
        check = Classifier(taps).leave_one_out()
        self.assertGreaterEqual(sum(r["right"] for r in check.values()) / len(taps), 0.85)
        self.assertEqual(check["left"]["right"], check["left"]["total"])
        first, second = [], []
        for side in SPOTS.values():
            mine = [t for t in taps if t["side"] == side]
            first += mine[:len(mine) // 2]
            second += mine[len(mine) // 2:]
        classifier = Classifier(first)
        placed = sum(classifier.classify(t)[0] == t["side"] for t in second) / len(second)
        self.assertLess(placed, 0.75, "if this rises, the drift finding in the report needs revisiting")


    def test_the_pi_session_of_2026_10_03_back_left_right(self):
        """The second sitting, measured from its clips by this module: back, left and right are placed
        well both left-out and from one half of the sitting to the other."""
        taps = json.loads((SESSION.parent / "tap-direction-2026-10-03.json").read_text())["taps"]
        self.assertEqual({t["side"] for t in taps}, {"back", "left", "right"})
        check = Classifier(taps).leave_one_out()
        self.assertGreaterEqual(sum(r["right"] for r in check.values()) / len(taps), 0.88)
        first, second = [], []
        for side in ("back", "left", "right"):
            mine = [t for t in taps if t["side"] == side]
            first += mine[:len(mine) // 2]
            second += mine[len(mine) // 2:]
        for train, test in ((first, second), (second, first)):
            classifier = Classifier(train)
            self.assertGreaterEqual(sum(classifier.classify(t)[0] == t["side"] for t in test) / len(test), 0.8)


class Calibration(unittest.TestCase):
    def test_label_save_classify_clear(self):
        store = MemoryStore()
        taps = TapDirection(store)
        self.assertFalse(taps.status()["calibrated"])
        rng = random.Random(3)
        event = taps.annotate({"type": "knock", "clip": simulated_tap("left", rng)})
        self.assertNotIn("side", event, "no calibration, no side")
        self.assertNotIn("clip", event, "the clip never goes on to the browser")
        taps.command("start", "left")
        for side in ("back", "left", "right"):
            taps.command("label", side)
            for _ in range(MIN_TAPS + 2):
                self.assertEqual(taps.annotate({"type": "knock", "clip": simulated_tap(side, rng)})["labelled"], side)
        self.assertEqual(taps.status()["pending"], {"back": 8, "left": 8, "right": 8})
        status = taps.command("save")
        self.assertTrue(status["calibrated"])
        self.assertEqual(status["saved"], {"back": 8, "left": 8, "right": 8})
        self.assertEqual(sum(r["total"] for r in status["check"].values()), 24)
        event = taps.annotate({"type": "knock", "clip": simulated_tap("left", rng)})
        self.assertIn(event.get("side"), ("left", None))
        self.assertIn("sideVotes", event)
        self.assertTrue(TapDirection(store).status()["calibrated"], "kept in the store")
        taps.command("clear")
        self.assertFalse(TapDirection(store).status()["calibrated"])

    def test_save_needs_two_sides_with_enough_taps(self):
        taps = TapDirection(MemoryStore())
        taps.command("start", "left")
        for _ in range(MIN_TAPS):
            taps.annotate({"type": "knock", "clip": simulated_tap("left")})
        with self.assertRaises(ValueError):
            taps.command("save")
        with self.assertRaises(ValueError):
            taps.command("label", "bottom")
        with self.assertRaises(ValueError):
            taps.command("explode")


class Pairing(unittest.IsolatedAsyncioTestCase):
    async def test_a_clip_rides_on_the_knock_that_follows_it(self):
        events = []
        async def emit(event): events.append(event)
        device = SerialDevice("unused", 921600, emit)
        clip = simulated_tap("right", random.Random(1))
        pairs = [v for pair in zip(clip["left"], clip["right"]) for v in pair]
        def clip_frame(at): return encode(Kind.KNOCK_CLIP, struct.pack("<QBB", at, 16, 2) + struct.pack(f"<{len(pairs)}h", *pairs))
        def knock(at): return encode(Kind.KNOCK, struct.pack("<QHB", at, 9000, 60))
        self.assertLessEqual(len(struct.pack("<QBB", 0, 16, 2)) + 2 * len(pairs), 768)
        stream = (clip_frame(5_000_000) + knock(5_000_000)    # paired
                  + knock(6_000_000)                           # no clip (one-microphone node)
                  + clip_frame(7_000_000) + knock(7_500_000))  # a clip for another knock is not used
        for packet in Decoder().feed(stream):
            await device.packet(packet)
        knocks = [e for e in events if e["type"] == "knock"]
        self.assertEqual([("clip" in e) for e in knocks], [True, False, False])
        self.assertEqual(knocks[0]["clip"], clip)
        self.assertIsNone(device.knock_clip)


class Service(ServiceCase):
    async def collect(self, ws, command, **data):
        self.ident += 1
        await ws.send_json({**data, "requestId": self.ident, "command": command})
        seen = []
        while not any(e.get("type") == "reply" and e.get("id") == self.ident for e in seen):
            seen.append(await asyncio.wait_for(ws.receive_json(), 3))
        self.assertTrue(seen[-1]["ok"], seen[-1])
        return seen

    async def test_calibrate_then_taps_carry_a_side(self):
        ws, state = await self.connect()
        self.assertFalse(state["tapDirection"]["calibrated"])
        seen = await self.collect(ws, "knock", side="left")
        knock = next(e for e in seen if e["type"] == "knock")
        self.assertNotIn("clip", knock)
        self.assertIn("tap", knock)
        self.assertNotIn("side", knock)
        await self.collect(ws, "tap_direction", op="start")
        for side in ("back", "left", "right"):
            await self.collect(ws, "tap_direction", op="label", side=side)
            for _ in range(MIN_TAPS + 2):
                seen = await self.collect(ws, "knock", side=side)
            progress = [e for e in seen if e["type"] == "tap_direction"][-1]
            self.assertEqual(progress["pending"][side], MIN_TAPS + 2)
        seen = await self.collect(ws, "tap_direction", op="save")
        self.assertTrue([e for e in seen if e["type"] == "tap_direction"][-1]["calibrated"])
        sides = []
        for _ in range(6):
            seen = await self.collect(ws, "knock", side="right")
            sides.append(next(e for e in seen if e["type"] == "knock").get("side"))
        self.assertGreaterEqual(sides.count("right"), 3, sides)
        system = await (await self.client.get("/api/system")).json()
        self.assertTrue(system["node"]["tapDirection"]["calibrated"])
        self.assertFalse((await self.rpc(ws, "knock", side="bottom"))["ok"])
        self.assertFalse((await self.rpc(ws, "tap_direction", op="save"))["ok"], "nothing labelled")
        await ws.close()


if __name__ == "__main__":
    unittest.main()
