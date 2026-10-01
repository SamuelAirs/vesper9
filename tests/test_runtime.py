import argparse
import asyncio
import json
import os
import random
import struct
import tempfile
import time
import unittest
from pathlib import Path

from aiohttp import WSServerHandshakeError
from aiohttp.test_utils import TestClient, TestServer
from vesper.protocol import Decoder, Kind, crc16, encode
from vesper.storage import Store
from vesper.device import SimulatedDevice, SerialDevice
from vesper.server import make_app
from vesper.speech import COMMANDS, Speech
from vesper.catalog import load_catalog, validate_setting
from unittest.mock import patch
from types import SimpleNamespace
import sys


class ProtocolTests(unittest.TestCase):
    def test_known_crc(self):
        self.assertEqual(crc16(b"123456789"), 0x29B1)

    def test_every_fragment_boundary(self):
        payload = struct.pack("<QB", 1234567890123, 1)
        frame = encode(Kind.BUTTON, payload, 65535)
        for i in range(len(frame) + 1):
            decoder = Decoder()
            packets = decoder.feed(frame[:i]) + decoder.feed(frame[i:])
            self.assertEqual(len(packets), 1)
            self.assertEqual(packets[0].payload, payload)
            self.assertEqual(packets[0].sequence, 65535)

    def test_corrupt_frame_recovers_to_next_frame(self):
        bad = bytearray(encode(Kind.LEDs if hasattr(Kind, 'LEDs') else Kind.LEDS, bytes(9), 3))
        bad[11] ^= 0x7F
        decoder = Decoder()
        packets = decoder.feed(b"ESP-ROM startup\r\n" + bad + encode(Kind.MIC, b"\x00", 4))
        self.assertEqual([p.sequence for p in packets], [4])
        self.assertGreater(decoder.errors, 0)

    def test_large_noise_and_oversize_header_are_bounded(self):
        decoder = Decoder()
        decoder.feed(b"x" * 50000 + b"V9\x01\x01\x00\x00\xff\xff")
        self.assertLessEqual(len(decoder.buffer), 8)
        self.assertEqual(len(decoder.feed(encode(Kind.PING))), 1)
        with self.assertRaises(ValueError):
            encode(Kind.AUDIO, bytes(769))

    def test_random_packet_chunks(self):
        rng = random.Random(1979)
        payloads = [rng.randbytes(rng.randint(0, 768)) for _ in range(100)]
        stream = b"".join(encode(Kind.AUDIO, p, i) for i, p in enumerate(payloads))
        decoder, packets = Decoder(), []
        while stream:
            n = rng.randint(1, 257)
            packets += decoder.feed(stream[:n])
            stream = stream[n:]
        self.assertEqual([p.payload for p in packets], payloads)


class StorageTests(unittest.TestCase):
    def test_scores_progress_and_transcripts_persist(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            store.score("runner", 42)
            store.score("runner", 12)
            store.put("progress", {"morse": {"index": 8}})
            sid = store.start_session()
            store.line(sid, "the room has a story")
            store.end_session(sid)
            store.close()
            store = Store(directory)
            self.assertEqual(store.scores()["runner"], 42)
            self.assertEqual(store.get("progress")["morse"]["index"], 8)
            self.assertEqual(store.transcript(sid)[0]["text"], "the room has a story")
            self.assertIsNotNone(store.sessions()[0]["ended"])
            with self.assertRaises(ValueError):
                store.score("runner", float("nan"))
            store.close()


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        args = argparse.Namespace(data=self.temporary.name, simulate=True, port=None, baud=921600, model=self.temporary.name)
        self.client = TestClient(TestServer(make_app(args)))
        await self.client.start_server()
        self.console = self.client.app["console"]
        self.ws = await self.client.ws_connect("/ws")
        self.snapshot = await self.ws.receive_json()
        self.ident = 0

    async def asyncTearDown(self):
        await self.ws.close()
        await self.client.close()
        self.temporary.cleanup()

    async def command(self, command, **data):
        self.ident += 1
        await self.ws.send_json({**data, "requestId": self.ident, "command": command})
        for _ in range(100):
            event = await asyncio.wait_for(self.ws.receive_json(), 3)
            if event.get("type") == "reply" and event.get("id") == self.ident:
                return event
        self.fail("No matching reply")

    async def test_complete_dashboard_and_explicit_simulator(self):
        response = await self.client.get("/")
        self.assertEqual(response.status, 200)
        self.assertIn("VESPER", await response.text())
        self.assertTrue(self.snapshot["simulated"])
        self.assertEqual(self.snapshot["mic"]["mode"], "off")

    async def test_invalid_commands_rejected_and_microphone_stays_off(self):
        self.assertFalse((await self.command("leds", values=[999]*9))["ok"])
        self.assertFalse((await self.command("mic", mode="transcribe"))["ok"])
        self.assertEqual(self.console.mode, "off")
        self.assertFalse(self.console.device.mic)
        self.assertFalse((await self.command("shell", code="anything"))["ok"])

    async def test_timers_background_completion_and_persistence(self):
        self.assertTrue((await self.command("timer", op="create", seconds=5))["ok"])
        timer = self.console.timers[0]
        await self.command("focus", app="runner")
        timer["deadline"] = time.time() - 1
        await asyncio.sleep(1.15)
        self.assertTrue(timer["finished"])
        self.assertFalse(timer["running"])
        self.assertTrue(self.console.store.get("timers")[0]["finished"])

    async def test_timer_validation_pause_and_resume(self):
        self.assertFalse((await self.command("timer", op="create", seconds=float("nan")))["ok"])
        await self.command("timer", op="create", seconds=60)
        tid = self.console.timers[0]["id"]
        await self.command("timer", op="toggle", id=tid)
        remaining = self.console.timers[0]["remaining"]
        self.assertFalse(self.console.timers[0]["running"])
        await self.command("timer", op="toggle", id=tid)
        self.assertAlmostEqual(self.console.timers[0]["deadline"] - time.time(), remaining, delta=.2)

    async def test_failed_mute_still_closes_transcription(self):
        self.console.mode = "transcribe"
        self.console.speech.mode = "transcribe"
        self.console.session = self.console.store.start_session()
        original = self.console.device.command
        async def fail(*args, **kwargs):
            raise ConnectionError("lost mute acknowledgment")
        self.console.device.command = fail
        try:
            with self.assertRaises(ConnectionError):
                await self.console.set_mic("off")
            self.assertEqual(self.console.mode, "off")
            self.assertIsNone(self.console.session)
            self.assertIsNotNone(self.console.store.sessions()[0]["ended"])
        finally:
            self.console.device.command = original

    async def test_full_timer_list_does_not_break_voice_worker(self):
        for _ in range(8):
            self.console.timer_command({"op": "create", "seconds": 60})
        await self.console.speech_event({"type": "voice", "action": "timer", "seconds": 60, "heard": "computer timer one minute"})
        self.assertEqual(len(self.console.timers), 8)

    async def test_one_controller_and_origin_protection(self):
        other = await self.client.ws_connect("/ws")
        self.assertFalse((await other.receive_json())["controller"])
        await other.send_json({"id": 99, "command": "timer", "op": "create", "seconds": 5})
        self.assertFalse((await other.receive_json())["ok"])
        await other.close()
        with self.assertRaises(WSServerHandshakeError):
            await self.client.ws_connect("/ws", origin="https://unrelated.example")
        response = await self.client.get("/api/state", headers={"Host": "unrelated.example"})
        self.assertEqual(response.status, 403)

    async def test_led_ack_and_progress(self):
        self.assertTrue((await self.command("leds", values=[10,20,30]*3))["ok"])
        self.assertEqual(self.console.device.leds, [10,20,30]*3)
        await self.command("progress", app="morse", value={"index": 6})
        self.assertEqual(self.console.store.get("progress")["morse"], {"index": 6})

    async def test_new_settings_validate_and_reset_without_erasing_progress(self):
        await self.command('progress', app='morse', value={'correct': 7})
        self.assertTrue((await self.command('settings', key='menuClicks', value=3))['ok'])
        self.assertFalse((await self.command('settings', key='menuClicks', value=2))['ok'])
        self.assertFalse((await self.command('settings', key='scanMs', value=851))['ok'])
        self.assertTrue((await self.command('reset_settings'))['ok'])
        self.assertEqual(self.console.settings['menuClicks'], 4)
        self.assertEqual(self.console.store.get('progress')['morse']['correct'], 7)

    async def test_reaction_score_classes_preserve_ambiguous_legacy_record(self):
        self.console.store.score('reaction', 999)
        self.assertFalse((await self.command('score', app='reaction', score=800))['ok'])
        self.assertTrue((await self.command('score', app='reaction', score=700, metric='physical'))['ok'])
        self.assertTrue((await self.command('score', app='reaction', score=900, metric='simulator'))['ok'])
        self.assertEqual(self.console.store.scores()['reaction'], 999)
        self.assertEqual(self.console.store.scores()['reaction:physical'], 700)
        self.assertEqual(self.console.store.scores()['reaction:simulator'], 900)

    async def test_saved_notes_are_paginated_and_selected_export_is_exact(self):
        for index in range(57):
            sid = self.console.store.start_session()
            self.console.store.line(sid, 'note ' + str(index))
            self.console.store.end_session(sid)
        first = await (await self.client.get('/api/sessions?offset=0')).json()
        later = await (await self.client.get('/api/sessions?offset=50')).json()
        self.assertEqual(len(first), 50)
        self.assertEqual(len(later), 7)
        self.assertFalse({s['id'] for s in first} & {s['id'] for s in later})
        text = await (await self.client.get('/api/export/' + sid)).text()
        self.assertIn('note 56', text)

    async def test_sensor_event_includes_observation_age_and_no_fake_resampling(self):
        sent = []
        original = self.console.broadcast
        async def capture(event): sent.append(event)
        self.console.broadcast = capture
        try:
            await self.console.event({'type': 'sensor', 'temperature': 23, 'humidity': 45})
            self.assertIn('at', sent[-1])
            self.assertEqual(sent[-1]['at'], self.console.sensor['at'])
            count = self.console.store.db.execute('SELECT COUNT(*) FROM sensors').fetchone()[0]
            await self.console.event({'type': 'device', 'connected': False})
            self.assertEqual(self.console.store.db.execute('SELECT COUNT(*) FROM sensors').fetchone()[0], count)
        finally:
            self.console.broadcast = original

    async def test_speech_worker_fault_turns_capture_off_and_closes_session(self):
        class BrokenRecognizer:
            def AcceptWaveform(self, pcm): raise RuntimeError('injected decoder failure')
        speech = self.console.speech
        self.console.session = self.console.store.start_session()
        self.console.mode = speech.mode = 'transcribe'
        self.console.device.mic = True
        speech.recognizer = BrokenRecognizer()
        task = speech.task = asyncio.create_task(speech.run())
        speech.feed(bytes(640))
        await asyncio.wait_for(task, 1)
        self.assertFalse(self.console.device.mic)
        self.assertEqual(self.console.mode, 'off')
        self.assertIsNone(self.console.session)
        self.assertIsNotNone(self.console.store.sessions()[0]['ended'])
        self.assertIn('injected decoder failure', speech.error)

    async def test_timer_clock_policy_follows_wall_deadline_and_never_negative(self):
        self.console.timer_command({'op': 'create', 'seconds': 60, 'label': 'TEA'})
        deadline = self.console.timers[0]['deadline']
        with patch('vesper.server.time.time', return_value=deadline + 10):
            self.assertEqual(self.console.public_timers()[0]['remaining'], 0)
        with patch('vesper.server.time.time', return_value=deadline - 120):
            self.assertEqual(self.console.public_timers()[0]['remaining'], 120)



class DeviceTests(unittest.IsolatedAsyncioTestCase):
    async def test_reaction_same_clock_and_cancel(self):
        events = []
        async def emit(e):
            events.append(e)
        device = SimulatedDevice(emit)
        await device.command(Kind.ARM, struct.pack("<IIBBBB", 77, 25, 1, 0, 255, 0))
        await asyncio.sleep(.04)
        await device.button(True)
        cue = next(e for e in events if e["type"] == "cue")
        button = next(e for e in events if e["type"] == "button")
        self.assertEqual(cue["trial"], 77)
        self.assertGreater(button["at_us"], cue["at_us"])
        events.clear()
        await device.command(Kind.ARM, struct.pack("<IIBBBB", 78, 30, 1, 0, 255, 0))
        await device.command(Kind.CANCEL)
        await asyncio.sleep(.05)
        self.assertFalse(any(e["type"] == "cue" for e in events))

    async def test_audio_gap_accounting_and_button_decode(self):
        events=[]
        async def emit(e):
            events.append(e)
        device=SerialDevice("unused",921600,emit)
        packets=Decoder().feed(encode(Kind.AUDIO,struct.pack('<I',0)+bytes(640))+encode(Kind.AUDIO,struct.pack('<I',640)+bytes(640))+encode(Kind.BUTTON,struct.pack('<QB',12345,1)))
        for packet in packets:
            await device.packet(packet)
        self.assertEqual(device.audio_missing,320)
        self.assertEqual(events[-1]['at_us'],12345)
        self.assertTrue(events[-1]['pressed'])

    async def test_node_boot_generation_and_current_button_are_reported(self):
        events = []
        async def emit(event): events.append(event)
        node = SerialDevice('unused', 921600, emit)
        frames = encode(Kind.HELLO, json.dumps({'button': False, 'mic': False}).encode()) + encode(Kind.BUTTON, struct.pack('<QB', 50, 1))
        for packet in Decoder().feed(frames): await node.packet(packet)
        self.assertEqual(events[0]['type'], 'node_reset')
        self.assertFalse(events[1]['button'])
        self.assertEqual(events[2]['generation'], events[0]['generation'])
        self.assertTrue(node.pressed)


class SpeechRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_emit_failure_notifies_independent_fault_handler_and_retry_restarts(self):
        faults = []
        async def emit(event): raise RuntimeError('injected storage callback failure')
        async def fault(error): faults.append(error)
        class Recognizer:
            def AcceptWaveform(self, pcm): return True
            def Result(self): return '{"text":"hello"}'
            def FinalResult(self): return '{"text":""}'
        speech = Speech('/unused', emit, fault)
        speech.recognizer = Recognizer()
        speech.mode = 'transcribe'
        task = speech.task = asyncio.create_task(speech.run())
        speech.feed(bytes(640))
        await asyncio.wait_for(task, 1)
        self.assertEqual(speech.mode, 'off')
        self.assertEqual(len(faults), 1)
        self.assertIsNone(speech.task)
        speech.model = object()
        speech.availability = lambda: None
        with patch.dict(sys.modules, {'vosk': SimpleNamespace(KaldiRecognizer=lambda *args: Recognizer())}):
            await speech.set_mode('commands')
            self.assertIsNotNone(speech.task)
            self.assertFalse(speech.task.done())
            self.assertIsNone(speech.error)
            await speech.close()

    async def test_final_result_failure_cannot_prevent_off(self):
        async def emit(event): pass
        speech = Speech('/unused', emit)
        class BrokenFinal:
            def FinalResult(self): raise RuntimeError('bad final')
        speech.mode = 'transcribe'
        speech.recognizer = BrokenFinal()
        await speech.set_mode('off')
        self.assertEqual(speech.mode, 'off')
        self.assertIsNone(speech.recognizer)
        self.assertIn('bad final', speech.error)


class CatalogTests(unittest.TestCase):
    def test_catalog_voice_aliases_and_ids_stay_in_sync(self):
        catalog = load_catalog()
        self.assertGreaterEqual(len(catalog['apps']), 12)
        for app in catalog['apps']:
            for alias in app['voice']:
                self.assertEqual(COMMANDS['computer open ' + alias]['app'], app['id'])
        with self.assertRaises(ValueError): validate_setting('menuClicks', True)



class VoiceTests(unittest.TestCase):
    def test_allowlist_requires_prefix_and_has_no_shell(self):
        self.assertIn("computer open morse", COMMANDS)
        self.assertNotIn("open morse", COMMANDS)
        self.assertNotIn("computer delete everything", COMMANDS)
        self.assertTrue(all(k.startswith("computer ") for k in COMMANDS))
        self.assertTrue(all(v["action"] in {"launch","home","pause","resume","mute","timer"} for v in COMMANDS.values()))


if __name__ == "__main__":
    unittest.main()
