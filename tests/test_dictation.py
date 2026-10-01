"""Two-pass dictation: fake Vosk and fake second-pass recognisers, no models needed."""
import argparse
import asyncio
import os
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp.test_utils import TestClient, TestServer

from vesper import speech as speech_module
from vesper.server import make_app
from vesper.speech import BYTES_PER_SECOND, Speech

CHUNK = bytes(640)          # 20 ms


class FakeVosk:
    """Finishes an utterance every `every` chunks (0 = never) and says `words` while it is open."""
    def __init__(self, every=0, words='hello world', changing=False):
        self.every, self.words, self.changing = every, words, changing
        self.chunks = 0

    def AcceptWaveform(self, pcm):
        self.chunks += 1
        return bool(self.every) and self.chunks % self.every == 0

    def Result(self):
        return '{"text": "%s"}' % self.words

    def PartialResult(self):
        return '{"partial": "%s"}' % (self.words + ' ' + str(self.chunks) if self.changing else self.words)

    def FinalResult(self):
        text = self.words if self.chunks % (self.every or 10 ** 9) else ''
        self.chunks = 0
        return '{"text": "%s"}' % text


class Harness:
    def __init__(self, vosk, refine=None, loader=True):
        self.events, self.vosk, self.refine, self.statuses = [], vosk, refine, []
        self.calls = []

        def make_loader():
            def load(path, threads):
                if isinstance(refine, Exception):
                    raise refine
                def transcribe(pcm):
                    self.calls.append(len(pcm))
                    return refine(pcm) if callable(refine) else 'Refined text.'
                return transcribe
            return load

        async def emit(event):
            self.events.append(event)

        async def status(info):
            self.statuses.append(info)

        self.speech = Speech('/unused', emit, on_status=status, refine_loader=make_loader() if loader else None,
                             refine_path='/nonexistent-refine-model')
        self.speech.availability = lambda: None
        self.speech.model = object()
        self.patch = patch.dict(sys.modules, {'vosk': SimpleNamespace(KaldiRecognizer=lambda *args: vosk)})

    async def __aenter__(self):
        self.patch.start()
        await self.speech.set_mode('transcribe')
        return self

    async def __aexit__(self, *exc):
        await self.speech.close()
        self.patch.stop()

    async def feed(self, chunks, settle=True):
        for _ in range(chunks):
            while self.speech.queue.qsize() > 20:      # never outrun the worker (the real queue drops chunks)
                await asyncio.sleep(.001)
            self.speech.feed(CHUNK)
            await asyncio.sleep(0)
        if settle:
            await self.settle()

    async def settle(self, timeout=3):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            await asyncio.sleep(.01)
            if self.speech.queue.empty() and self.speech.pending.empty() and self.speech.inflight is None:
                await asyncio.sleep(.02)
                if self.speech.queue.empty() and self.speech.pending.empty() and self.speech.inflight is None:
                    return

    def finals(self):
        return [e for e in self.events if e['type'] == 'speech' and e['final']]

    def provisional(self):
        return [e for e in self.events if e['type'] == 'speech' and e.get('provisional')]


class TwoPassFlow(unittest.IsolatedAsyncioTestCase):
    async def test_vosk_final_is_provisional_until_refined_line_replaces_it(self):
        async with Harness(FakeVosk(every=5)) as h:
            await h.feed(5)
            self.assertEqual([(e['text'], e['utt']) for e in h.provisional()], [('hello world', 1)])
            self.assertEqual([(e['text'], e['utt'], e['engine']) for e in h.finals()], [('Refined text.', 1, 'second-pass')])
            self.assertLess(h.events.index(h.provisional()[0]), h.events.index(h.finals()[0]))
            self.assertEqual(h.calls, [5 * 640])           # exactly that utterance's audio, nothing more
            self.assertEqual(len(h.speech.audio), 0)
            self.assertEqual(h.speech.pending_bytes, 0)

    async def test_live_partials_still_come_from_vosk(self):
        async with Harness(FakeVosk(every=0, changing=True)) as h:
            await h.feed(3)
            partials = [e['text'] for e in h.events if e['type'] == 'speech' and not e['final']]
            self.assertEqual(partials, ['hello world 1', 'hello world 2', 'hello world 3'])
            self.assertEqual(h.finals(), [])

    async def test_each_utterance_gets_one_final_in_order(self):
        texts = iter(['One.', 'Two.', 'Three.'])
        async with Harness(FakeVosk(every=4), refine=lambda pcm: next(texts)) as h:
            await h.feed(12)
            self.assertEqual([e['text'] for e in h.finals()], ['One.', 'Two.', 'Three.'])
            self.assertEqual([e['utt'] for e in h.finals()], [1, 2, 3])

    async def test_status_reports_loading_then_ready(self):
        async with Harness(FakeVosk(every=5)) as h:
            await h.feed(5)
            self.assertEqual([s['refine'] for s in h.statuses], ['loading', 'ready'])
            self.assertEqual(h.speech.status(), {'engine': 'vosk+parakeet', 'refine': 'ready', 'detail': None})


class Fallbacks(unittest.IsolatedAsyncioTestCase):
    async def test_exception_in_second_pass_keeps_vosk_text_and_dictation_continues(self):
        def flaky(pcm):
            if len(h.calls) == 1:
                raise RuntimeError('injected')
            return 'Second.'
        async with Harness(FakeVosk(every=3), refine=flaky) as h:
            await h.feed(6)
            self.assertEqual([(e['text'], e['engine']) for e in h.finals()], [('hello world', 'vosk'), ('Second.', 'second-pass')])
            self.assertEqual(h.speech.mode, 'transcribe')
            self.assertIsNone(h.speech.error)

    async def test_timeout_falls_back_and_the_next_utterance_gets_a_fresh_thread(self):
        def slow_then_fast(pcm):
            if len(h.calls) == 1:
                time.sleep(.4)
            return 'Fast.'
        with patch.object(speech_module, 'REFINE_TIMEOUT_S', .1):
            async with Harness(FakeVosk(every=3), refine=slow_then_fast) as h:
                await h.feed(3)
                self.assertEqual([(e['text'], e['engine']) for e in h.finals()], [('hello world', 'vosk')])
                await h.feed(3)
                self.assertEqual([(e['text'], e['engine']) for e in h.finals()][1:], [('Fast.', 'second-pass')])

    async def test_empty_second_pass_text_keeps_vosk_text(self):
        async with Harness(FakeVosk(every=3), refine=lambda pcm: '') as h:
            await h.feed(3)
            self.assertEqual([(e['text'], e['engine']) for e in h.finals()], [('hello world', 'vosk')])

    async def test_repeated_failures_switch_the_pass_off_but_not_dictation(self):
        def broken(pcm):
            raise RuntimeError('always')
        async with Harness(FakeVosk(every=2), refine=broken) as h:
            await h.feed(2 * speech_module.REFINE_MAX_FAILURES)
            self.assertEqual(len(h.finals()), speech_module.REFINE_MAX_FAILURES)
            self.assertEqual(h.speech.status()['engine'], 'vosk')
            self.assertEqual(h.speech.status()['refine'], 'failed')
            await h.feed(2)
            self.assertEqual(h.finals()[-1]['engine'], 'vosk')
            self.assertEqual(h.finals()[-1]['text'], 'hello world')
            self.assertEqual(len(h.speech.audio), 0)        # no longer collecting audio

    async def test_model_that_cannot_load_means_vosk_alone(self):
        async with Harness(FakeVosk(every=3), refine=OSError('corrupt model')) as h:
            await h.feed(3)
            self.assertEqual([(e['text'], e['engine']) for e in h.finals()], [('hello world', 'vosk')])
            self.assertEqual(h.speech.status()['engine'], 'vosk')
            self.assertIn('corrupt model', h.speech.status()['detail'])
            self.assertEqual(h.speech.mode, 'transcribe')

    async def test_missing_package_or_model_directory_is_plain_vosk_dictation(self):
        async with Harness(FakeVosk(every=3), loader=False) as h:
            self.assertEqual(h.speech.status()['refine'], 'unavailable')
            self.assertEqual(h.speech.status()['engine'], 'vosk')
            await h.feed(3)
            self.assertEqual([(e['text'], e['engine']) for e in h.finals()], [('hello world', 'vosk')])
            self.assertEqual(h.provisional(), [])
            self.assertEqual(len(h.speech.audio), 0)         # never buffers audio without a second pass

    async def test_emit_failure_of_a_refined_line_stops_dictation_and_calls_the_fault_handler(self):
        faults = []
        async def emit(event):
            if event.get('final'):
                raise RuntimeError('storage down')
        async def fault(error):
            faults.append(error)
        speech = Speech('/unused', emit, fault, refine_loader=lambda path, threads: (lambda pcm: 'Text.'))
        speech.availability = lambda: None
        speech.model = object()
        with patch.dict(sys.modules, {'vosk': SimpleNamespace(KaldiRecognizer=lambda *args: FakeVosk(every=2))}):
            await speech.set_mode('transcribe')
            for _ in range(2):
                speech.feed(CHUNK)
            for _ in range(100):
                await asyncio.sleep(.02)
                if faults:
                    break
            self.assertEqual(len(faults), 1)
            self.assertEqual(speech.mode, 'off')
            await speech.close()


class Stopping(unittest.IsolatedAsyncioTestCase):
    async def test_stopping_mid_utterance_refines_the_last_words_once(self):
        async with Harness(FakeVosk(every=100)) as h:
            await h.feed(7)
            self.assertEqual(h.finals(), [])
            await h.speech.set_mode('off')
            self.assertEqual([(e['text'], e['engine']) for e in h.finals()], [('Refined text.', 'second-pass')])
            self.assertEqual(h.calls, [7 * 640])
            self.assertEqual(h.speech.pending_bytes, 0)
            self.assertEqual(len(h.speech.audio), 0)

    async def test_switching_mode_waits_for_a_pending_second_pass(self):
        def slow(pcm):
            time.sleep(.2)
            return 'Late.'
        async with Harness(FakeVosk(every=3), refine=slow) as h:
            await h.feed(3, settle=False)
            await asyncio.sleep(.05)
            self.assertEqual(h.finals(), [])
            await h.speech.set_mode('commands')
            self.assertEqual([e['text'] for e in h.finals()], ['Late.'])
            self.assertEqual(len(h.finals()), 1)

    async def test_stop_that_outlasts_the_flush_limit_emits_the_live_text_once(self):
        def stuck(pcm):
            time.sleep(.6)
            return 'Never.'
        with patch.object(speech_module, 'REFINE_FLUSH_S', .1), patch.object(speech_module, 'REFINE_TIMEOUT_S', 5):
            async with Harness(FakeVosk(every=3), refine=stuck) as h:
                await h.feed(3, settle=False)
                await asyncio.sleep(.05)
                await h.speech.set_mode('off')
                self.assertEqual([(e['text'], e['engine']) for e in h.finals()], [('hello world', 'vosk')])
                await asyncio.sleep(.8)
                self.assertEqual(len(h.finals()), 1)

    async def test_failed_mute_path_final_result_error_still_ends_off(self):
        class BrokenFinal(FakeVosk):
            def FinalResult(self):
                raise RuntimeError('bad final')
        async with Harness(BrokenFinal(every=100)) as h:
            await h.feed(3)
            await h.speech.set_mode('off')
            self.assertEqual(h.speech.mode, 'off')
            self.assertIn('bad final', h.speech.error)
            self.assertEqual(len(h.speech.audio), 0)


class Bounds(unittest.IsolatedAsyncioTestCase):
    async def test_a_very_long_unbroken_utterance_is_cut_at_the_hard_limit(self):
        async with Harness(FakeVosk(every=0, changing=True)) as h:
            biggest = 0
            for _ in range(int(70 / .02 / 50)):
                await h.feed(50, settle=False)
                await asyncio.sleep(.001)
                biggest = max(biggest, len(h.speech.audio))
            await h.settle(10)
            self.assertLessEqual(biggest, speech_module.MAX_UTTERANCE_S * BYTES_PER_SECOND + 50 * 640)
            self.assertGreaterEqual(len(h.calls), 2)
            self.assertTrue(all(n <= speech_module.MAX_UTTERANCE_S * BYTES_PER_SECOND for n in h.calls), h.calls)

    async def test_a_long_utterance_is_cut_at_a_pause_after_the_soft_limit(self):
        # words that stop changing (a pause) once 20 s have passed: the cut lands about 0.4 s later
        class Pausing(FakeVosk):
            def PartialResult(self):
                return '{"partial": "%s"}' % ('talking %d' % self.chunks if self.chunks < 1050 else 'talking done')
        async with Harness(Pausing(every=0)) as h:
            await h.feed(1100)
            self.assertEqual(len(h.calls), 1)
            self.assertTrue(abs(h.calls[0] / BYTES_PER_SECOND - 21.4) < .1, h.calls)

    async def test_backlog_skips_the_second_pass_instead_of_growing_without_bound(self):
        def slow(pcm):
            time.sleep(.05)
            return 'Done.'
        with patch.object(speech_module, 'REFINE_BACKLOG_S', 0.2):
            async with Harness(FakeVosk(every=10), refine=slow) as h:
                await h.feed(100, settle=False)
                await h.settle(10)
                self.assertLess(len(h.calls), 10)
                self.assertEqual(len(h.finals()), 10)        # every utterance still got a final line
                self.assertEqual(h.speech.pending_bytes, 0)

    async def test_commands_mode_never_collects_audio_or_loads_the_model(self):
        async with Harness(FakeVosk(every=0)) as h:
            await h.speech.set_mode('commands')
            await h.feed(10)
            self.assertEqual(len(h.speech.audio), 0)


class NothingStored(unittest.IsolatedAsyncioTestCase):
    async def test_no_file_is_opened_for_writing_while_dictating(self):
        opened = []
        recording = [False]
        def hook(event, args):
            if recording[0] and event == 'open':
                path, mode, flags = args
                if (isinstance(mode, str) and any(c in mode for c in 'wax+')) or (isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT)):
                    opened.append(args)
        sys.addaudithook(hook)
        before = set(os.listdir(tempfile.gettempdir()))
        cwd_before = set(os.listdir('.'))
        recording[0] = True
        try:
            async with Harness(FakeVosk(every=4)) as h:
                await h.feed(12)
                await h.speech.set_mode('off')
        finally:
            recording[0] = False
        self.assertEqual(opened, [])
        self.assertEqual(set(os.listdir('.')), cwd_before)
        self.assertEqual(set(os.listdir(tempfile.gettempdir())) - before, set())

    async def test_audio_is_dropped_when_the_line_is_final(self):
        async with Harness(FakeVosk(every=100)) as h:
            await h.feed(10)
            self.assertEqual(len(h.speech.audio), 10 * 640)
            await h.speech.set_mode('off')
            self.assertEqual(len(h.speech.audio), 0)
            self.assertIsNone(h.speech.inflight)


class ModelLifetime(unittest.IsolatedAsyncioTestCase):
    async def test_model_loads_lazily_on_first_transcription_and_is_released_when_idle(self):
        loads = []
        async def emit(event): pass
        def loader(path, threads):
            loads.append(threads)
            return lambda pcm: 'x'
        speech = Speech('/unused', emit, refine_loader=loader)
        speech.availability = lambda: None
        speech.model = object()
        speech.refine_idle_s = .05
        with patch.dict(sys.modules, {'vosk': SimpleNamespace(KaldiRecognizer=lambda *args: FakeVosk())}):
            await speech.set_mode('commands')
            await asyncio.sleep(.05)
            self.assertEqual(loads, [])                       # commands do not load it
            await speech.set_mode('transcribe')
            await asyncio.sleep(.05)
            self.assertEqual(loads, [2])                      # two threads, no more
            self.assertEqual(speech.refine_state, 'ready')
            await asyncio.sleep(.2)
            self.assertEqual(speech.refine_state, 'ready')    # kept loaded while dictating
            await speech.set_mode('off')
            await asyncio.sleep(.2)
            self.assertEqual(speech.refine_state, 'idle')     # released after the idle period
            self.assertIsNone(speech.refiner)
            await speech.set_mode('transcribe')
            await asyncio.sleep(.05)
            self.assertEqual(loads, [2, 2])                   # and reloaded on demand
            await speech.close()


class ConsoleSaves(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        args = argparse.Namespace(data=self.temporary.name, simulate=True, port=None, baud=921600, model=self.temporary.name)
        self.client = TestClient(TestServer(make_app(args)))
        await self.client.start_server()
        self.console = self.client.app['console']
        speech = self.console.speech
        speech.refine_loader = lambda path, threads: (lambda pcm: 'Refined line.')
        speech.availability = lambda: None
        speech.model = object()
        speech.refine_check()
        self.patch = patch.dict(sys.modules, {'vosk': SimpleNamespace(KaldiRecognizer=lambda *args: FakeVosk(every=4))})
        self.patch.start()
        self.sent = []
        original = self.console.broadcast
        async def broadcast(event):
            self.sent.append(event)
            await original(event)
        self.console.broadcast = broadcast

    async def asyncTearDown(self):
        self.patch.stop()
        await self.client.close()
        self.temporary.cleanup()

    async def test_only_the_refined_line_is_saved_once_and_mute_saves_the_last_words_once(self):
        await self.console.set_mic('transcribe')
        sid = self.console.session
        for _ in range(4):
            await self.console.event({'type': 'audio', 'pcm': CHUNK})
        for _ in range(100):
            await asyncio.sleep(.02)
            if self.console.store.transcript(sid):
                break
        self.assertEqual([r['text'] for r in self.console.store.transcript(sid)], ['Refined line.'])
        for _ in range(2):                                    # a few more words, no pause yet
            await self.console.event({'type': 'audio', 'pcm': CHUNK})
        await asyncio.sleep(.1)
        await self.console.set_mic('off')
        lines = [r['text'] for r in self.console.store.transcript(sid)]
        self.assertEqual(lines, ['Refined line.', 'Refined line.'])
        provisional = [e for e in self.sent if e.get('provisional')]
        self.assertTrue(provisional and all('session' not in e for e in provisional))
        finals = [e for e in self.sent if e['type'] == 'speech' and e['final']]
        self.assertEqual(len(finals), 2)
        await asyncio.sleep(.1)
        self.assertEqual(len(self.console.store.transcript(sid)), 2)

    async def test_state_and_recognizer_event_say_which_recognisers_are_in_use(self):
        state = self.console.state()
        self.assertEqual(state['mic']['recognizer'], {'engine': 'vosk+parakeet', 'refine': 'idle', 'detail': None})
        await self.console.set_mic('transcribe')
        await asyncio.sleep(.1)
        events = [e for e in self.sent if e['type'] == 'recognizer']
        self.assertEqual([e['refine'] for e in events][-2:], ['loading', 'ready'])
        await self.console.set_mic('off')


if __name__ == '__main__':
    unittest.main()
