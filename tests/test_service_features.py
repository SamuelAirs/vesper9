"""Tests for the service features added with the audit fixes: sound analysis (microphone mode
``analyze``), system health (``GET /api/system``) and the related safety nets.

Nothing here opens a serial port (a fake ``serial`` module and node are injected), records audio,
or touches port 8799, ``data/`` or ``backups/``.
"""
import asyncio
import cmath
import contextlib
import importlib.util
import io
import json
import logging
import math
import random
import runpy
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
from array import array
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_service_fixes import (FakeSerial, REAL_SLEEP, ROOT, SerialCase, ServiceCase, make_args,  # noqa: E402
                                quick_sleep)

from serial import SerialTimeoutException  # noqa: E402
from vesper import analysis, health, server  # noqa: E402
from vesper.protocol import Kind, encode  # noqa: E402
from vesper.server import Console  # noqa: E402


def sine(frequency, amplitude=0.5, count=analysis.WINDOW, phase=0.0):
    return [amplitude * 32768 * math.sin(2 * math.pi * frequency * i / analysis.RATE + phase) for i in range(count)]


def pcm(samples):
    return array("h", [max(-32768, min(32767, int(v))) for v in samples]).tobytes()


class Sink:
    """A stand-in browser connection that records every frame it is sent."""
    def __init__(self):
        self.events = []

    async def send_json(self, event):
        self.events.append(event)

    async def close(self, *args, **kwargs):
        return None

    def of(self, kind):
        return [e for e in self.events if e.get("type") == kind]


# --------------------------------------------------------------------------------------
# vesper/analysis.py
# --------------------------------------------------------------------------------------
class AnalysisMath(unittest.TestCase):
    def test_fft_matches_a_direct_dft(self):
        rng = random.Random(3)
        samples = [rng.uniform(-1000, 1000) for _ in range(analysis.WINDOW)]
        power = analysis.power_spectrum(samples)
        windowed = [a * b for a, b in zip(samples, analysis.tables().hann)]
        scale = (analysis.WINDOW / 4 * 32768) ** 2
        for k in (0, 1, 7, 100, 301, 512):
            direct = sum(windowed[n] * cmath.exp(-2j * math.pi * k * n / analysis.WINDOW) for n in range(analysis.WINDOW))
            self.assertAlmostEqual(power[k], abs(direct) ** 2 / scale, delta=1e-9 + 1e-9 * power[k])

    def test_full_scale_sine_on_a_bin_reads_zero_dbfs(self):
        centre = 64 * analysis.RATE / analysis.WINDOW
        self.assertAlmostEqual(analysis.to_db(max(analysis.power_spectrum(sine(centre, 1.0)))), 0.0, places=3)

    def test_band_layout(self):
        self.assertEqual(analysis.BANDS, 28)
        self.assertEqual(len(analysis.EDGES), analysis.BANDS + 1)
        self.assertEqual((analysis.EDGES[0], analysis.EDGES[-1]), (60.0, 7000.0))
        self.assertEqual(analysis.EDGES, sorted(analysis.EDGES))
        ratios = [b / a for a, b in zip(analysis.EDGES, analysis.EDGES[1:])]
        self.assertLess(max(ratios) - min(ratios), 0.01)  # logarithmic: constant ratio

    def test_a_tone_lands_in_its_own_band_and_nowhere_loud_far_away(self):
        for frequency in (100, 440, 1000, 3000, 6000):
            with self.subTest(frequency=frequency):
                levels = analysis.band_levels(analysis.power_spectrum(sine(frequency)))
                loudest = max(range(analysis.BANDS), key=lambda i: levels[i])
                self.assertLessEqual(analysis.EDGES[loudest], frequency * 1.08)
                self.assertGreater(analysis.EDGES[loudest + 1], frequency / 1.08)
                far = [levels[i] for i in range(analysis.BANDS) if abs(math.log(analysis.EDGES[i] / frequency)) > 1.0]
                self.assertLess(max(far), levels[loudest] - 40)
                self.assertTrue(all(isinstance(v, float) and -120 <= v <= 0 for v in levels))

    def test_silence_floors_at_minus_120_and_has_no_pitch(self):
        result = analysis.analyse((0, [0.0] * analysis.WINDOW, 0, 0, analysis.HOP))
        self.assertEqual((result["rmsDb"], result["peakDb"]), (-120.0, -120.0))
        self.assertEqual(set(result["bands"]), {-120.0})
        self.assertIsNone(result["pitch"])

    def test_rms_and_peak_in_dbfs(self):
        samples = sine(440, 0.5, analysis.HOP)
        sumsq = sum(v * v for v in samples)
        result = analysis.analyse((4, samples[-analysis.WINDOW:], sumsq, int(max(samples)), analysis.HOP))
        self.assertAlmostEqual(result["rmsDb"], 20 * math.log10(0.5 / math.sqrt(2)), delta=0.1)
        self.assertAlmostEqual(result["peakDb"], 20 * math.log10(0.5), delta=0.1)
        self.assertEqual(result["seq"], 4)

    def test_pitch_of_pure_tones(self):
        for frequency in (65, 82.4, 110, 220, 261.6, 440, 660, 800):
            with self.subTest(frequency=frequency):
                hz, confidence = analysis.estimate_pitch(sine(frequency))
                self.assertAlmostEqual(hz, frequency, delta=frequency * 0.015)
                self.assertGreater(confidence, 0.9)

    def test_pitch_of_a_harmonic_tone_is_its_fundamental_not_a_harmonic(self):
        samples = [sum(0.25 * 32768 / h * math.sin(2 * math.pi * 220 * h * i / analysis.RATE) for h in (1, 2, 3, 4))
                   for i in range(analysis.WINDOW)]
        hz, confidence = analysis.estimate_pitch(samples)
        self.assertAlmostEqual(hz, 220, delta=4)

    def test_noise_has_no_pitch(self):
        rng = random.Random(1)
        misses = sum(analysis.estimate_pitch([rng.uniform(-8000, 8000) for _ in range(analysis.WINDOW)]) is None for _ in range(20))
        self.assertGreaterEqual(misses, 19)

    def test_a_tone_in_noise_is_still_found_and_quiet_audio_is_gated(self):
        rng = random.Random(2)
        noisy = [v + rng.uniform(-3000, 3000) for v in sine(200)]
        self.assertAlmostEqual(analysis.estimate_pitch(noisy)[0], 200, delta=4)
        quiet = sine(200, 0.0005)
        result = analysis.analyse((0, quiet, sum(v * v for v in quiet), 16, analysis.HOP))
        self.assertLess(result["rmsDb"], analysis.PITCH_GATE_DB)
        self.assertIsNone(result["pitch"])

    def test_the_analyzer_emits_one_frame_per_hop_and_keeps_only_a_window(self):
        analyzer = analysis.Analyzer()
        chunk = pcm(sine(440, 0.3, 320))
        frames = []
        for _ in range(30):  # 600 ms in 20 ms chunks
            analyzer.feed(chunk)
            frame = analyzer.take()
            if frame:
                frames.append(frame)
            self.assertLessEqual(len(analyzer.window), analysis.WINDOW)
        self.assertEqual(len(frames), 6)  # 30 * 320 / 1600 = 6, ten a second
        self.assertEqual([f[0] for f in frames], list(range(6)))
        self.assertTrue(all(f[4] == analysis.HOP for f in frames))

    def test_the_synthetic_source_is_artificial_bounded_and_sweeps(self):
        source = analysis.SyntheticSource()
        first = source.chunk()
        self.assertEqual(len(first), 640)
        self.assertEqual(analysis.SyntheticSource().chunk(), first)  # deterministic
        pitches = []
        samples = array("h")
        for _ in range(60 * 3):  # 3.6 s
            samples.extend(array("h", source.chunk()))
        for start in range(0, len(samples) - analysis.WINDOW, 4000):
            window = [float(v) for v in samples[start:start + analysis.WINDOW]]
            found = analysis.estimate_pitch(window)
            if found:
                pitches.append(found[0])
        self.assertGreater(len(pitches), 8)
        self.assertGreater(max(pitches) / min(pitches), 1.3)  # it moves
        self.assertLess(max(abs(v) for v in samples), 32768 * 0.12)  # about -20 dBFS: never loud

    def test_cost_of_one_frame_is_small(self):
        samples = sine(440)
        frame = (0, samples, sum(v * v for v in samples), 16000, analysis.HOP)
        started = time.process_time()
        for _ in range(20):
            analysis.analyse(frame)
        per_frame = (time.process_time() - started) / 20
        self.assertLess(per_frame, 0.04, f"{per_frame * 1000:.1f} ms per frame")  # 10 frames/s -> under 40% of a core even on a slow machine


# --------------------------------------------------------------------------------------
# microphone mode "analyze" through the service
# --------------------------------------------------------------------------------------
class AnalyzeMode(ServiceCase):
    async def collect(self, ws, kind, count, timeout=4):
        found = []
        deadline = time.monotonic() + timeout
        while len(found) < count and time.monotonic() < deadline:
            try:
                event = await asyncio.wait_for(ws.receive_json(), max(0.05, deadline - time.monotonic()))
            except asyncio.TimeoutError:
                break
            if event.get("type") == kind:
                found.append(event)
        return found

    async def test_analyze_starts_muted_works_without_a_speech_model_and_stores_nothing(self):
        self.assertEqual((self.console.mode, self.console.device.mic), ("off", False))
        self.assertIn("analyze", self.console.state()["mic"]["modes"])
        ws, _ = await self.connect()
        reply = await self.rpc(ws, "mic", mode="analyze")  # the temporary directory holds no Vosk model
        self.assertTrue(reply["ok"], reply)
        self.assertEqual((self.console.mode, self.console.device.mic), ("analyze", True))
        self.assertEqual(self.console.speech.mode, "off")
        self.assertIsNone(self.console.session)
        events = await self.collect(ws, "analysis", 5)
        self.assertGreaterEqual(len(events), 5)
        await self.rpc(ws, "mic", mode="off")
        self.assertEqual(self.console.store.sessions(), [])
        self.assertEqual(self.console.store.db.execute("SELECT COUNT(*) FROM lines").fetchone()[0], 0)
        await ws.close()

    async def test_analysis_event_shape_and_rate(self):
        ws, _ = await self.connect()
        await self.rpc(ws, "mic", mode="analyze")
        started = time.monotonic()
        events = await self.collect(ws, "analysis", 12, timeout=5)
        elapsed = time.monotonic() - started
        self.assertEqual(len(events), 12)
        self.assertLess(elapsed, 2.5, "about ten events a second")
        self.assertGreater(elapsed, 0.8)
        for event in events:
            self.assertEqual(set(event), {"type", "at", "seq", "rmsDb", "peakDb", "bands", "pitch", "simulated"})
            self.assertTrue(event["simulated"])
            self.assertEqual(len(event["bands"]), 28)
            self.assertTrue(all(isinstance(v, (int, float)) and -120 <= v <= 0 for v in event["bands"]))
            self.assertTrue(-120 <= event["rmsDb"] <= event["peakDb"] <= 0)
            if event["pitch"] is not None:
                self.assertEqual(set(event["pitch"]), {"hz", "confidence"})
                self.assertTrue(60 <= event["pitch"]["hz"] <= 800 and 0 <= event["pitch"]["confidence"] <= 1)
        self.assertEqual([e["seq"] for e in events], sorted(e["seq"] for e in events))
        self.assertTrue(any(e["pitch"] for e in events), "the synthetic tone should be heard")
        await ws.close()

    async def test_only_the_controlling_tab_can_enter_the_mode_and_names_are_checked(self):
        first, _ = await self.connect()
        second, snapshot = await self.connect()
        self.assertFalse(snapshot["controller"])
        self.assertFalse((await self.rpc(second, "mic", mode="analyze"))["ok"])
        self.assertEqual(self.console.mode, "off")
        for bad in ("analyse", "ANALYZE", "", None, 5, ["analyze"]):
            reply = await self.rpc(first, "mic", mode=bad)
            self.assertFalse(reply["ok"], bad)
        self.assertEqual((self.console.mode, self.console.device.mic), ("off", False))
        with self.assertRaises(ValueError):
            await self.console.speech.set_mode("analyze")  # recognition never takes this mode
        await first.close()
        await second.close()

    async def test_leaving_the_mode_stops_acquisition_and_events(self):
        ws, _ = await self.connect()
        await self.rpc(ws, "mic", mode="analyze")
        self.assertTrue(await self.collect(ws, "analysis", 2))
        self.assertTrue((await self.rpc(ws, "mic", mode="off"))["ok"])
        self.assertFalse(self.console.device.mic)
        self.assertIsNone(self.console.analyzer)
        self.assertIsNone(self.console.synthetic)
        await asyncio.sleep(.4)
        while True:  # drain what was already in flight, then expect silence
            try:
                await asyncio.wait_for(ws.receive_json(), .05)
            except asyncio.TimeoutError:
                break
        await asyncio.sleep(.5)
        self.assertEqual(await self.collect(ws, "analysis", 1, timeout=.5), [])
        await ws.close()

    async def test_controller_disconnect_ends_capture(self):
        ws, _ = await self.connect()
        await self.rpc(ws, "mic", mode="analyze")
        await ws.close()
        for _ in range(100):
            if self.console.mode == "off" and not self.console.device.mic:
                break
            await asyncio.sleep(.02)
        self.assertEqual((self.console.mode, self.console.device.mic), ("off", False))
        self.assertIsNone(self.console.synthetic)

    async def test_switching_between_analysis_and_recognition_modes(self):
        modes = []

        async def set_mode(mode):
            modes.append(mode)
            self.console.speech.mode = mode
        self.console.speech.set_mode = set_mode
        ws, _ = await self.connect()
        await self.rpc(ws, "mic", mode="analyze")
        self.assertNotIn("commands", modes)
        await self.rpc(ws, "mic", mode="commands")
        self.assertEqual((self.console.mode, self.console.speech.mode), ("commands", "commands"))
        self.assertIsNone(self.console.analyzer)
        await self.rpc(ws, "mic", mode="analyze")
        self.assertEqual((self.console.mode, self.console.speech.mode), ("analyze", "off"))
        self.assertIsNotNone(self.console.analyzer)
        await ws.close()

    async def test_status_reflects_confirmed_capture_only(self):
        """The mode is not reported until the node confirms capture; an unconfirmed start leaves everything off."""
        original = self.console.device.command

        async def unconfirmed(kind, payload=b""):
            if kind == Kind.MIC and payload == b"\x01":
                return None  # accepted, but the node never reports capture
            return await original(kind, payload)
        self.console.device.command = unconfirmed
        ws, _ = await self.connect()
        reply = await self.rpc(ws, "mic", mode="analyze")  # waits out the 2.5 s confirmation window
        self.assertFalse(reply["ok"])
        self.assertEqual((self.console.mode, self.console.device.mic), ("off", False))
        self.assertIsNone(self.console.analyzer)
        self.assertIsNone(self.console.synthetic)
        await ws.close()

    async def test_browser_audio_is_ignored_while_analysing(self):
        with patch.object(Console, "synthetic_microphone", lambda self, generation: asyncio.sleep(30)):
            ws, _ = await self.connect()
            await self.rpc(ws, "mic", mode="analyze")
            await ws.send_bytes(bytes(640))
            await asyncio.sleep(.2)
            self.assertEqual(self.console.analyzer.count, 0)
            await ws.close()

    async def test_an_analysis_failure_ends_capture_and_is_reported(self):
        ws, _ = await self.connect()
        with patch("vesper.analysis.analyse", side_effect=RuntimeError("boom")):
            await self.rpc(ws, "mic", mode="analyze")
            errors = await self.collect(ws, "analysis_error", 1, timeout=3)
        self.assertEqual(len(errors), 1)
        self.assertIn("boom", errors[0]["error"])
        for _ in range(100):
            if self.console.mode == "off":
                break
            await asyncio.sleep(.02)
        self.assertEqual((self.console.mode, self.console.device.mic), ("off", False))
        self.assertIn("boom", self.console.state()["mic"]["error"])
        self.assertTrue((await self.rpc(ws, "mic", mode="analyze"))["ok"])  # an explicit new request clears the error
        self.assertIsNone(self.console.state()["mic"]["error"])
        await ws.close()

    async def test_audio_that_stops_ends_capture(self):
        with patch.object(server, "AUDIO_STALL", 0.3), \
                patch.object(Console, "synthetic_microphone", lambda self, generation: asyncio.sleep(30)):
            ws, _ = await self.connect()
            await self.rpc(ws, "mic", mode="analyze")
            for _ in range(60):
                if self.console.mode == "off":
                    break
                await asyncio.sleep(.1)
            self.assertEqual((self.console.mode, self.console.device.mic), ("off", False))
            self.assertIn("No audio", self.console.state()["mic"]["error"])
            await ws.close()


class AnalyzeOnTheNodeLink(SerialCase):
    """The hardware path: audio frames from a (fake) node over the serial transport."""
    async def feed_audio(self, node, seconds, frequency=440):
        index = 0
        for _ in range(int(seconds / 0.02)):
            samples = sine(frequency, 0.3, 320, phase=2 * math.pi * frequency * index / analysis.RATE)
            node.push(encode(Kind.AUDIO, struct.pack("<I", index) + pcm(samples), 0))
            index += 320
            await REAL_SLEEP(.02)

    async def test_analysis_from_node_audio_and_end_on_link_loss(self):
        async with self.console() as console:
            sink = Sink()
            console.clients.add(sink)
            await self.until(lambda: console.device.connected, message="link up")
            await console.set_mic("analyze")
            self.assertEqual((console.mode, console.device.mic, console.speech.mode), ("analyze", True, "off"))
            node = FakeSerial.created[-1]
            await self.feed_audio(node, 0.8)
            events = sink.of("analysis")
            self.assertGreaterEqual(len(events), 5)
            self.assertTrue(all(not e["simulated"] for e in events))
            self.assertAlmostEqual(events[-1]["pitch"]["hz"], 440, delta=8)
            node.fail_read = True
            await self.until(lambda: console.mode == "off", message="capture ended with the link")
            self.assertIsNone(console.analyzer)

    async def test_analyze_needs_the_node(self):
        async with self.console() as console:
            with self.assertRaises(ValueError):
                await console.set_mic("analyze")
            self.assertEqual(console.mode, "off")


# --------------------------------------------------------------------------------------
# vesper/health.py and GET /api/system
# --------------------------------------------------------------------------------------
class HostProbeTests(unittest.TestCase):
    def fake_host(self, root, cpu_first="cpu 100 0 100 700 100 0 0 0\ncpu0 50 0 50 350 50 0 0 0\ncpu1 50 0 50 350 50 0 0 0\n"):
        proc, sysfs = root / "proc", root / "sys"
        (proc / "self").mkdir(parents=True)
        (sysfs / "class/thermal/thermal_zone0").mkdir(parents=True)
        (proc / "stat").write_text(cpu_first)
        (proc / "loadavg").write_text("0.52 0.40 0.30 1/200 999\n")
        (proc / "meminfo").write_text("MemTotal:        8000000 kB\nMemFree: 1 kB\nMemAvailable:    6000000 kB\n")
        (proc / "uptime").write_text("12345.67 40000.00\n")
        (proc / "self/statm").write_text("1000 500 100 10 0 400 0\n")
        (sysfs / "class/thermal/thermal_zone0/temp").write_text("51234\n")
        return proc, sysfs

    def test_every_field_from_fake_proc_and_sys(self):
        with tempfile.TemporaryDirectory() as folder:
            proc, sysfs = self.fake_host(Path(folder))
            probe = health.HostProbe(folder, proc=str(proc), sysfs=str(sysfs), vcgencmd=False)
            time.sleep(.55)
            (proc / "stat").write_text("cpu 150 0 150 750 150 0 0 0\ncpu0 50 0 50 450 50 0 0 0\ncpu1 100 0 100 300 100 0 0 0\n")
            host, process = probe.sample()
            self.assertEqual(host["cpuTempC"], 51.2)
            self.assertEqual(host["loadAvg"], [0.52, 0.4, 0.3])
            self.assertEqual(host["memory"], {"totalBytes": 8000000 * 1024, "availableBytes": 6000000 * 1024})
            self.assertEqual(host["uptimeS"], 12345.7)
            self.assertEqual(host["cpuPercent"], 50.0)   # 200 busy of 400 total jiffies
            self.assertEqual(host["cpuPerCore"], [0.0, 100.0])
            self.assertGreaterEqual(host["cpuWindowS"], 0.5)
            self.assertGreater(host["disk"]["totalBytes"], 0)
            self.assertGreaterEqual(host["disk"]["freeBytes"], 0)
            self.assertIsNone(host["throttled"])  # no vcgencmd
            self.assertEqual(process["rssBytes"], 500 * probe.page_size)

    def test_every_missing_source_degrades_to_none_without_raising(self):
        with tempfile.TemporaryDirectory() as folder:
            nowhere = str(Path(folder) / "absent")
            probe = health.HostProbe(nowhere, proc=nowhere, sysfs=nowhere, vcgencmd=False)
            host, process = probe.sample()
            for key in ("cpuTempC", "cpuPercent", "cpuPerCore", "cpuWindowS", "memory", "disk", "throttled"):
                self.assertIsNone(host[key], key)
            self.assertIsNone(process["rssBytes"])
            self.assertIsNone(host["uptimeS"])
            self.assertEqual(set(host), set(health.HostProbe(folder, vcgencmd=False).sample()[0]))  # same shape

    def test_garbage_sources_degrade_too(self):
        with tempfile.TemporaryDirectory() as folder:
            proc, sysfs = self.fake_host(Path(folder))
            for name in ("loadavg", "meminfo", "uptime", "stat"):
                (proc / name).write_text("not what the kernel writes\n")
            (sysfs / "class/thermal/thermal_zone0/temp").write_text("hot\n")
            host, _ = health.HostProbe(folder, proc=str(proc), sysfs=str(sysfs), vcgencmd=False).sample()
            for key in ("cpuTempC", "memory", "uptimeS", "cpuPercent"):
                self.assertIsNone(host[key], key)

    def test_throttle_flags_decode_and_vcgencmd_failures_are_null(self):
        with tempfile.TemporaryDirectory() as folder:
            probe = health.HostProbe(folder, proc=str(Path(folder) / "none"), vcgencmd="/usr/bin/vcgencmd")
            with patch.object(probe, "run_vcgencmd", return_value="throttled=0x50005"):
                value = probe.throttled()
            self.assertEqual(value["raw"], "0x50005")
            self.assertTrue(value["underVoltageNow"] and value["throttledNow"])
            self.assertTrue(value["underVoltageOccurred"] and value["throttledOccurred"])
            self.assertFalse(value["freqCappedNow"] or value["softTempLimitNow"])
            probe = health.HostProbe(folder, vcgencmd="/usr/bin/vcgencmd")
            with patch("vesper.health.subprocess.run", side_effect=subprocess.TimeoutExpired("vcgencmd", 1)):
                self.assertIsNone(health.safe(probe.throttled))
                probe.sysfs = "/nonexistent"
                self.assertIsNone(health.safe(probe.temperature))

    def test_two_quick_calls_share_one_cpu_window(self):
        with tempfile.TemporaryDirectory() as folder:
            proc, sysfs = self.fake_host(Path(folder))
            probe = health.HostProbe(folder, proc=str(proc), sysfs=str(sysfs), vcgencmd=False)
            time.sleep(.55)
            (proc / "stat").write_text("cpu 200 0 200 700 100 0 0 0\ncpu0 100 0 100 350 50 0 0 0\ncpu1 100 0 100 350 50 0 0 0\n")
            first = probe.sample()[0]["cpuPercent"]
            (proc / "stat").write_text("cpu 200 0 200 800 100 0 0 0\ncpu0 100 0 100 400 50 0 0 0\ncpu1 100 0 100 400 50 0 0 0\n")
            self.assertEqual(probe.sample()[0]["cpuPercent"], first)  # inside 0.5 s: same window, not a noisy tiny one


class SystemEndpoint(ServiceCase):
    HOST_KEYS = {"model", "cpuTempC", "loadAvg", "cpuCount", "cpuPercent", "cpuPerCore", "cpuWindowS", "memory", "disk",
                 "uptimeS", "throttled"}
    SERVICE_KEYS = {"version", "startedAt", "uptimeS", "rssBytes", "pid", "python", "tasks", "clients", "micMode"}
    NODE_KEYS = {"connected", "simulated", "port", "link", "firmware", "statusAgeS", "capture", "generation", "crcErrors",
                 "missingSamples", "audioBytes", "nodeRxCrc", "audioDrops", "sensor", "knock"}

    async def fetch(self):
        async with self.client.get("/api/system") as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.content_type, "application/json")
            self.assertEqual(response.headers["Cache-Control"], "no-cache")
            text = await response.text()

        def refuse(constant):
            raise ValueError("not strict JSON: " + constant)
        return json.loads(text, parse_constant=refuse)

    async def test_shape_and_simulated_marking(self):
        data = await self.fetch()
        self.assertEqual(set(data), {"schema", "at", "simulated", "host", "service", "node"})
        self.assertEqual((data["schema"], data["simulated"]), (1, True))
        self.assertEqual(set(data["host"]), self.HOST_KEYS)
        self.assertEqual(set(data["service"]), self.SERVICE_KEYS)
        self.assertEqual(set(data["node"]), self.NODE_KEYS)
        node = data["node"]
        self.assertEqual((node["simulated"], node["connected"], node["firmware"], node["link"], node["port"]),
                         (True, True, "simulated", "simulated", "simulated"))
        self.assertTrue(node["sensor"]["simulated"])
        self.assertEqual(data["service"]["version"], "0.2.0")
        self.assertEqual(data["service"]["tasks"], {"device": True, "timers": True})
        self.assertGreaterEqual(data["service"]["uptimeS"], 0)
        self.assertGreater(data["host"]["cpuCount"], 0)
        self.assertGreater(data["host"]["disk"]["totalBytes"], 0)  # real host values even in simulation

    async def test_cpu_utilisation_since_the_previous_call(self):
        await self.fetch()
        await asyncio.sleep(.6)
        data = await self.fetch()
        if data["host"]["cpuPercent"] is not None:  # /proc/stat exists
            self.assertTrue(0 <= data["host"]["cpuPercent"] <= 100)
            self.assertEqual(len(data["host"]["cpuPerCore"]), data["host"]["cpuCount"])
            self.assertGreaterEqual(data["host"]["cpuWindowS"], 0.5)

    async def test_missing_host_sources_give_null_not_an_error(self):
        nowhere = str(Path(self.temporary.name) / "absent")
        self.console.host = health.HostProbe(nowhere, proc=nowhere, sysfs=nowhere, vcgencmd=False)
        data = await self.fetch()
        self.assertEqual(set(data["host"]), self.HOST_KEYS)
        self.assertIsNone(data["host"]["memory"])
        self.assertIsNone(data["host"]["cpuTempC"])
        self.assertEqual(set(data["node"]), self.NODE_KEYS)

    async def test_a_slow_host_read_does_not_block_the_event_loop(self):
        def slow(*args):
            time.sleep(.5)
            return {key: None for key in self.HOST_KEYS}, {"rssBytes": None}
        self.console.host.sample = slow
        gaps, stop = [], False

        async def heartbeat():
            last = time.monotonic()
            while not stop:
                await REAL_SLEEP(.01)
                now = time.monotonic()
                gaps.append(now - last)
                last = now
        task = asyncio.create_task(heartbeat())
        await self.fetch()
        stop = True
        await task
        self.assertLess(max(gaps), .2, f"event loop stalled for {max(gaps):.2f} s")

    async def test_read_only_and_local_only(self):
        async with self.client.post("/api/system") as response:
            self.assertEqual(response.status, 405)
        async with self.client.get("/api/system", headers={"Host": "evil.test"}) as response:
            self.assertEqual(response.status, 403)

    async def test_task_that_died_is_visible(self):
        self.console.tasks[0].cancel()
        await asyncio.sleep(.05)
        self.assertEqual((await self.fetch())["service"]["tasks"], {"device": False, "timers": True})


class SystemEndpointOnTheNodeLink(SerialCase):
    async def test_node_details_come_from_the_nodes_last_status(self):
        async with self.console() as console:
            await self.until(lambda: console.device.connected and console.device.status, message="status received")
            node = FakeSerial.created[-1]
            status = json.dumps({"fw": "0.1.2", "link": "usb", "mic": False, "button": False, "rx_crc": 3,
                                 "audio_drops": 2, "sensor": {"addr": 64, "ok": 10, "fail": 1, "err": "x"}}).encode()
            node._status = lambda: encode(Kind.STATUS, status, 0)  # what the fake node now says every 50 ms
            await self.until(lambda: console.device.status.get("fw") == "0.1.2", message="new status")
            data = await console.system()
            self.assertFalse(data["simulated"])
            node = data["node"]
            self.assertEqual((node["connected"], node["simulated"], node["port"]), (True, False, "/dev/fake-node"))
            self.assertEqual((node["firmware"], node["link"], node["nodeRxCrc"], node["audioDrops"]), ("0.1.2", "usb", 3, 2))
            self.assertEqual(node["sensor"], {"addr": 64, "ok": 10, "fail": 1, "err": "x"})
            self.assertEqual(node["crcErrors"], 0)
            self.assertLess(node["statusAgeS"], 5)
            json.dumps(data, allow_nan=False)

    async def test_before_any_status_the_node_fields_are_null(self):
        console = Console(make_args(self.temporary.name, simulate=False, port="/dev/fake-node"))
        try:
            data = await console.system()
            self.assertFalse(data["node"]["connected"])
            for key in ("link", "firmware", "statusAgeS", "nodeRxCrc", "audioDrops", "sensor"):
                self.assertIsNone(data["node"][key], key)
            self.assertIsNone(data["service"]["tasks"])
        finally:
            console.store.close()


# --------------------------------------------------------------------------------------
# More regression tests for the audit fixes
# --------------------------------------------------------------------------------------
class ControllerHandover(ServiceCase):
    async def test_a_reloaded_tab_becomes_controller_and_its_commands_survive_the_old_tabs_cleanup(self):
        original = self.console.device.command

        async def slow(kind, payload=b""):
            if kind == Kind.CANCEL:
                await asyncio.sleep(.4)
            return await original(kind, payload)
        self.console.device.command = slow
        first, _ = await self.connect()
        await first.close()
        second, snapshot = await self.connect()  # the reload: arrives while the old cleanup is running
        self.assertTrue(snapshot["controller"])
        reply = await self.rpc(second, "leds", values=[9] * 9)
        self.assertTrue(reply["ok"])
        await asyncio.sleep(.2)
        self.assertEqual(self.console.device.leds, [9] * 9, "the old tab's cleanup switched the new tab's lamps off")
        await second.close()

    async def test_cleanup_continues_when_the_microphone_step_fails(self):
        sent = []
        original = self.console.device.command

        async def record(kind, payload=b""):
            sent.append(kind)
            return await original(kind, payload)

        async def failing(mode, disconnected=False):
            raise ConnectionError("lost")
        self.console.device.command = record
        ws, _ = await self.connect()
        self.console.set_mic = failing
        await ws.close()
        for _ in range(100):
            if Kind.LEDS in sent:
                break
            await asyncio.sleep(.02)
        self.assertIn(Kind.CANCEL, sent)
        self.assertIn(Kind.LEDS, sent)

    async def test_a_stalled_controller_loses_the_slot(self):
        class Stuck(Sink):
            async def send_json(self, event):
                await asyncio.sleep(30)
        stuck = Stuck()
        self.console.clients.add(stuck)
        self.console.controller = stuck
        self.console.focus = "runner"
        await self.console.broadcast({"type": "timers", "timers": []})
        await asyncio.sleep(1.4)
        self.assertIsNone(self.console.controller)
        self.assertEqual(self.console.focus, "home")
        self.assertNotIn(stuck, self.console.clients)

    async def test_frames_to_one_client_keep_their_order_and_a_reply_follows_the_events_before_it(self):
        ws, _ = await self.connect()
        await ws.send_json({"command": "settings", "key": "sound", "value": False, "requestId": 1})
        seen = []
        while True:
            event = await asyncio.wait_for(ws.receive_json(), 3)
            seen.append(event["type"])
            if event["type"] == "reply":
                break
        self.assertEqual(seen, ["settings", "reply"])
        await ws.close()


class KeepaliveAndSafetyNets(ServiceCase):
    async def test_a_silent_controller_that_opted_in_loses_the_microphone(self):
        self.stub_speech()
        ws, _ = await self.connect()
        self.assertTrue((await self.rpc(ws, "keepalive"))["ok"])
        await self.rpc(ws, "mic", mode="commands")
        with patch.object(server, "KEEPALIVE_TIMEOUT", 0.5):
            for _ in range(60):
                if self.console.mode == "off":
                    break
                await asyncio.sleep(.1)
        self.assertEqual((self.console.mode, self.console.device.mic), ("off", False))
        await ws.close()

    async def test_keepalive_traffic_keeps_the_microphone_and_no_opt_in_means_no_timeout(self):
        self.stub_speech()
        ws, _ = await self.connect()
        await self.rpc(ws, "keepalive")
        await self.rpc(ws, "mic", mode="commands")
        with patch.object(server, "KEEPALIVE_TIMEOUT", 1.5):
            for _ in range(8):
                await asyncio.sleep(.4)
                await ws.send_json({"command": "keepalive"})
            self.assertEqual(self.console.mode, "commands")
        await ws.close()

    async def test_nothing_is_enforced_for_a_browser_that_never_sends_a_keepalive(self):
        self.stub_speech()
        ws, _ = await self.connect()
        await self.rpc(ws, "mic", mode="commands")
        with patch.object(server, "KEEPALIVE_TIMEOUT", 0.3):
            await asyncio.sleep(2.3)
        self.assertEqual(self.console.mode, "commands")
        await ws.close()

    async def test_the_monitor_tab_cannot_send_keepalive(self):
        await self.connect()
        second, _ = await self.connect()
        self.assertFalse((await self.rpc(second, "keepalive"))["ok"])

    async def test_capture_the_console_does_not_know_about_is_muted_again(self):
        self.console.device.mic = True  # a lost mute: the node reports capture while the console says off
        for _ in range(40):
            if not self.console.device.mic:
                break
            await asyncio.sleep(.1)
        self.assertFalse(self.console.device.mic)
        self.assertEqual(self.console.mode, "off")

    async def test_failed_writes_leave_memory_and_database_in_agreement(self):
        def locked(*args, **kwargs):
            raise sqlite3.OperationalError("database is locked")
        ws, _ = await self.connect()
        await self.rpc(ws, "timer", op="create", seconds=60)
        before_timers, before_settings = json.dumps(self.console.timers), dict(self.console.settings)
        with patch.object(self.console.store, "put", locked):
            self.assertFalse((await self.rpc(ws, "settings", key="sound", value=not before_settings["sound"]))["ok"])
            self.assertFalse((await self.rpc(ws, "timer", op="create", seconds=30))["ok"])
            self.assertFalse((await self.rpc(ws, "timer", op="remove", id=self.console.timers[0]["id"]))["ok"])
        self.assertEqual(self.console.settings, before_settings)
        self.assertEqual(json.dumps(self.console.timers), before_timers)
        await ws.close()

    async def test_timer_alert_goes_out_even_when_the_database_fails_and_is_saved_later(self):
        calls = {"n": 0}
        original = self.console.store.put

        def flaky(key, value):
            calls["n"] += 1
            if calls["n"] <= 1:
                raise sqlite3.OperationalError("database is locked")
            return original(key, value)
        ws, _ = await self.connect()
        await self.rpc(ws, "timer", op="create", seconds=60)
        calls["n"] = 0
        self.console.store.put = flaky
        self.console.timers[0]["deadline"] = time.time() - 1
        done = None
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline and done is None:
            try:
                event = await asyncio.wait_for(ws.receive_json(), 1)
            except asyncio.TimeoutError:
                continue
            if event.get("type") == "timer_done":
                done = event
        self.assertIsNotNone(done, "the alert must not depend on the database")
        await asyncio.sleep(2.2)
        self.assertTrue(self.console.store.get("timers")[0]["finished"], "the failed save is retried")
        self.assertFalse(self.console.timers_dirty)
        await ws.close()

    async def test_wrong_types_in_timer_commands(self):
        ws, _ = await self.connect()
        for data in ({"op": "create", "seconds": "60"}, {"op": "create", "seconds": True},
                     {"op": "create", "seconds": 60, "label": 5}, {"op": "create", "seconds": 60, "label": ["x"]}):
            self.assertFalse((await self.rpc(ws, "timer", **data))["ok"], data)
        self.assertEqual(self.console.timers, [])
        self.assertTrue((await self.rpc(ws, "timer", op="create", seconds=60.5, label="ok"))["ok"])
        await ws.close()

    async def test_error_pages_are_not_cached_either(self):
        async with self.client.get("/no-such-file.js") as response:
            self.assertEqual(response.status, 404)
            self.assertEqual(response.headers.get("Cache-Control"), "no-cache")
            self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")

    async def test_malformed_stored_timers_and_settings_are_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            store = server.Store(directory)
            good = {"id": "a", "label": "x", "duration": 60.0, "remaining": 60.0, "deadline": 1.0, "running": False, "finished": False}
            store.put("timers", [good, {"id": 5}, "text", {**good, "running": 1}, {**good, "deadline": True}])
            store.put("settings", ["not", "a", "dict"])
            store.close()
            console = Console(make_args(directory))
            try:
                self.assertEqual(console.timers, [good])
                self.assertEqual(console.settings, dict(server.DEFAULT_SETTINGS))
            finally:
                console.store.close()


class SupervisedTasks(unittest.IsolatedAsyncioTestCase):
    async def test_a_failing_long_lived_task_is_logged_and_restarted(self):
        with tempfile.TemporaryDirectory() as directory:
            console = Console(make_args(directory))
            console.RESTART_DELAY = .02
            runs = []

            async def flaky():
                runs.append(1)
                if len(runs) < 3:
                    raise RuntimeError("boom")
                await asyncio.sleep(30)
            console.device.run = flaky
            with self.assertLogs(level="ERROR") as logs:
                await console.start(None)
                for _ in range(100):
                    if len(runs) >= 3:
                        break
                    await asyncio.sleep(.02)
            self.assertEqual(len(runs), 3)
            self.assertEqual(len([line for line in logs.output if "failed; restarting" in line]), 2)
            self.assertFalse(console.tasks[0].done())
            await console.stop(None)

    async def test_a_task_that_ends_quietly_is_noticed_and_restarted(self):
        with tempfile.TemporaryDirectory() as directory:
            console = Console(make_args(directory))
            console.RESTART_DELAY = .02
            runs = []

            async def ends():
                runs.append(1)
                if len(runs) >= 2:
                    await asyncio.sleep(30)
            console.device.run = ends
            with self.assertLogs(level="ERROR") as logs:
                await console.start(None)
                for _ in range(100):
                    if len(runs) >= 2:
                        break
                    await asyncio.sleep(.02)
            self.assertTrue(any("ended unexpectedly" in line for line in logs.output))
            await console.stop(None)


class SerialWriteFailures(SerialCase):
    async def test_three_failed_writes_in_a_row_reconnect_cleanly(self):
        async with self.device() as device:
            await self.until(lambda: device.connected, message="link up")
            node = FakeSerial.created[-1]
            await self.until(lambda: node.count(Kind.LEDS) >= 1, message="connect-time frames delivered")

            def broken(data):
                raise SerialTimeoutException("Write timeout")
            node.write = broken
            await self.until(lambda: len(FakeSerial.created) >= 2 and device.connected, timeout=5, message="clean reconnect")
            self.assertFalse(node.is_open, "the wedged port should have been closed")
            self.assertEqual(device.write_failures, 0)

    async def test_failed_command_writes_count_too_and_the_error_still_reaches_the_caller(self):
        async with self.device() as device:
            await self.until(lambda: device.connected, message="link up")
            node = FakeSerial.created[-1]
            await self.until(lambda: node.count(Kind.LEDS) >= 1, message="connect-time frames delivered")
            real_write = node.write

            def broken(data):
                raise SerialTimeoutException("Write timeout")
            node.write = broken
            raised = 0
            for _ in range(3):
                with contextlib.suppress(Exception):
                    await device.command(Kind.LEDS, bytes(9))
                    continue
                raised += 1
            self.assertEqual(raised, 3)
            await self.until(lambda: len(FakeSerial.created) >= 2 and device.connected, timeout=5, message="reconnect")
            node.write = real_write

    async def test_one_failed_write_does_not_drop_the_link(self):
        async with self.device() as device:
            await self.until(lambda: device.connected, message="link up")
            node = FakeSerial.created[-1]
            await self.until(lambda: node.count(Kind.LEDS) >= 1, message="connect-time frames delivered")
            real_write = node.write

            def selective(data):  # only the lamp command fails, not the heartbeat
                if data[3] == int(Kind.LEDS):
                    raise SerialTimeoutException("Write timeout")
                return real_write(data)
            node.write = selective
            with self.assertRaises(SerialTimeoutException):
                await device.command(Kind.LEDS, bytes(9))
            await REAL_SLEEP(.5)
            self.assertEqual(len(FakeSerial.created), 1)
            self.assertTrue(device.connected)

    async def test_a_status_that_is_not_an_object_does_not_drop_the_link(self):
        async with self.device() as device:
            await self.until(lambda: device.connected, message="link up")
            node = FakeSerial.created[-1]
            await self.until(lambda: node.count(Kind.LEDS) >= 1, message="connect-time frames delivered")
            node.push(encode(Kind.STATUS, b"[1, 2]", 0))
            node.push(encode(Kind.HELLO, b'"text"', 0))
            await REAL_SLEEP(.5)
            self.assertEqual(len(FakeSerial.created), 1)
            self.assertTrue(device.connected)
            self.assertIsInstance(device.status, dict)

    async def test_a_listener_that_raises_does_not_drop_the_link(self):
        FakeSerial.sensor_samples = True
        events = []

        async def emit(event):
            events.append(event["type"])
            if event["type"] == "sensor":
                raise RuntimeError("listener failed")
        device = server.SerialDevice("/dev/fake-node", 921600, emit)
        task = asyncio.create_task(device.run())
        try:
            await self.until(lambda: device.connected, message="link up")
            await REAL_SLEEP(.6)
            self.assertGreater(events.count("sensor"), 3)
            self.assertEqual(len(FakeSerial.created), 1)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_a_node_that_stays_away_is_logged_once_not_every_attempt(self):
        FakeSerial.missing = True
        async with self.device() as device:
            with self.assertLogs("vesper.device", level="WARNING") as logs:
                await REAL_SLEEP(.7)
                logging.getLogger("vesper.device").warning("marker")
        failures = [line for line in logs.output if "Node link" in line]
        self.assertEqual(len(failures), 1, failures)


# --------------------------------------------------------------------------------------
# Scripts
# --------------------------------------------------------------------------------------
class InstallerKeepsData(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("install_service_features", ROOT / "scripts/install-service.py")
        self.installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.installer)
        self.folder = tempfile.TemporaryDirectory()
        self.base = Path(self.folder.name)
        self.home = self.base / "home"
        self.unit = self.home / ".config/systemd/user/vesper.service"

    def tearDown(self):
        self.folder.cleanup()

    def checkout(self, name):
        root = self.base / name
        (root / ".venv/bin").mkdir(parents=True)
        (root / ".venv/bin/python").touch()
        return root

    def install(self, root, *argv):
        out = io.StringIO()
        with patch.object(self.installer, "__file__", str(root / "scripts/install-service.py")), \
                patch.object(Path, "home", return_value=self.home), \
                patch.object(self.installer.shutil, "which", return_value="/usr/bin/chromium"), \
                patch.object(self.installer.subprocess, "run"), \
                patch("sys.argv", ["install-service.py", *argv]), contextlib.redirect_stdout(out):
            self.installer.main()
        return out.getvalue()

    def exec_line(self):
        return next(line for line in self.unit.read_text().splitlines() if line.startswith("ExecStart="))

    def test_default_directory_of_the_same_checkout_stays_the_default(self):
        root = self.checkout("a")
        self.install(root, "--port", "/dev/n")
        self.install(root, "--port", "/dev/n", "--kiosk")
        self.assertNotIn("--data", self.exec_line())

    def test_reinstalling_from_another_checkout_keeps_the_old_checkouts_data(self):
        old, new = self.checkout("old"), self.checkout("new")
        self.install(old, "--port", "/dev/n")
        output = self.install(new, "--port", "/dev/n")
        self.assertIn(str(old / "data/console"), self.exec_line())
        self.assertIn("Keeping the data directory", output)

    def test_switching_between_simulator_and_node_keeps_the_data(self):
        root = self.checkout("a")
        self.install(root, "--simulate")
        self.install(root, "--port", "/dev/n")
        self.assertIn(str(root / "data/simulator"), self.exec_line())

    def test_an_explicit_data_directory_wins_and_says_so(self):
        root = self.checkout("a")
        first, second = self.base / "one", self.base / "two"
        self.install(root, "--port", "/dev/n", "--data", str(first))
        output = self.install(root, "--port", "/dev/n", "--data", str(second))
        self.assertIn(str(second), self.exec_line())
        self.assertNotIn(str(first), self.exec_line())
        self.assertIn("Changing the data directory", output)
        self.assertIn("Data directory: " + str(second), output)

    def test_awkward_paths_survive_the_round_trip(self):
        root = self.checkout("a")
        data = self.base / 'my "data" 100% dir'
        self.install(root, "--port", "/dev/n", "--data", str(data))
        self.install(root, "--port", "/dev/n", "--kiosk")
        settings = self.installer.unit_settings(self.unit)
        self.assertEqual(self.installer.effective_data(settings), data.resolve())

    def test_an_unreadable_old_unit_falls_back_to_the_default_and_says_which(self):
        root = self.checkout("a")
        self.unit.parent.mkdir(parents=True)
        self.unit.write_text("garbage\n")
        output = self.install(root, "--port", "/dev/n")
        self.assertIn("Data directory: " + str(root / "data/console"), output)
        self.assertNotIn("--data", self.exec_line())


class KioskLauncher(unittest.TestCase):
    def run_kiosk(self, answer):
        attempts, launched = [], []

        class Launched(Exception):
            pass

        def urlopen(*args, **kwargs):
            attempts.append(1)
            return answer()

        def fake_exec(path, argv):
            launched.append(argv)
            raise Launched()
        with tempfile.TemporaryDirectory() as scratch, patch("tempfile.tempdir", scratch), \
                patch("shutil.which", return_value="/usr/bin/chromium"), patch("urllib.request.urlopen", urlopen), \
                patch("time.sleep"), patch("os.execv", fake_exec), patch("sys.stderr", io.StringIO()) as stderr:
            with contextlib.suppress(Launched):
                runpy.run_path(str(ROOT / "scripts/kiosk.py"))
            if launched and launched[-1][-1].startswith("file://"):
                self.page = Path(launched[-1][-1][len("file://"):]).read_text()
        return attempts, launched, stderr.getvalue()

    def test_waits_at_least_three_minutes_then_shows_a_page_that_says_so_and_keeps_trying(self):
        def refuse():
            raise urllib.error.URLError("refused")
        attempts, launched, stderr = self.run_kiosk(refuse)
        self.assertGreaterEqual(len(attempts) * 0.25, 180)
        self.assertEqual(len(launched), 1)
        self.assertTrue(launched[0][-1].startswith("file:///"))
        self.assertIn("SERVICE NOT RESPONDING", self.page)
        self.assertIn("setInterval", self.page)
        self.assertIn("http://localhost:8799", self.page)
        self.assertIn("did not answer", stderr)

    def test_opens_the_console_as_soon_as_the_service_answers(self):
        class Ok:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False
        attempts, launched, _ = self.run_kiosk(Ok)
        self.assertEqual(len(attempts), 1)
        self.assertEqual(launched[0][-1], "http://localhost:8799")


if __name__ == "__main__":
    unittest.main()
