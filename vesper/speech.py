"""Bounded local speech worker. Explicit retries; faults never reacquire capture.

Dictation runs two passes. Vosk gives the live text and finds where each utterance ends; when an
utterance finishes, its audio (held in memory only, bounded, dropped as soon as the line is final) is
re-transcribed by the optional second-pass model in vesper/refine.py and that text becomes the final
line. Any failure of the second pass falls back to Vosk's own text for that utterance."""
import asyncio
import concurrent.futures
import gc
import importlib.util
import json
import logging
from pathlib import Path
from . import refine
from .catalog import CATALOG

BYTES_PER_SECOND = 32000           # 16 kHz, 16-bit mono
SOFT_UTTERANCE_S = 20              # a longer utterance is cut at the next pause ...
PAUSE_CUT_S = .4                   # ... of this length (the live text has stopped changing)
MAX_UTTERANCE_S = 30               # ... and unconditionally at this length
MIN_REFINE_S = .3                  # shorter audio with no live text is not worth a second pass
REFINE_TIMEOUT_S = 10              # one utterance's second pass; then Vosk's own text is used
REFINE_LOAD_WAIT_S = 60            # how long a finished utterance waits for the model to load
REFINE_BACKLOG_S = 20              # audio waiting for the second pass above which new utterances skip it
REFINE_FLUSH_S = 15                # stopping dictation waits at most this long for pending lines
REFINE_IDLE_S = 900                # the model is released after this long outside dictation
REFINE_MAX_FAILURES = 5            # consecutive failed passes after which the pass is switched off
REFINE_THREADS = 2

COMMANDS = {
    'computer home': {'action': 'home'}, 'computer pause': {'action': 'pause'},
    'computer menu': {'action': 'pause'}, 'computer resume': {'action': 'resume'},
    'computer microphone off': {'action': 'mute'},
}
for app in CATALOG['apps']:
    for word in app.get('voice', []):
        COMMANDS['computer open ' + word] = {'action': 'launch', 'app': app['id']}
for words, seconds in {'one minute': 60, 'five minutes': 300, 'fifteen minutes': 900, 'twenty five minutes': 1500}.items():
    COMMANDS['computer timer ' + words] = {'action': 'timer', 'seconds': seconds}


class Speech:
    def __init__(self, model_path, emit, on_error=None, *, on_status=None, refine_path=None, refine_loader=None):
        """on_status: async callback told when the second-pass state changes.
        refine_path: directory of the second-pass model (default: next to the Vosk model).
        refine_loader: replaces refine.load (tests); when given, the install check is skipped."""
        self.path = Path(model_path).expanduser()
        self.emit, self.on_error, self.on_status = emit, on_error, on_status
        self.model = self.recognizer = self.task = None
        self.queue = asyncio.Queue(maxsize=50)
        self.lock = asyncio.Lock()
        self.generation = self.dropped = 0
        self.partial = ''
        self.error = None
        # second pass
        self.refine_path = Path(refine_path).expanduser() if refine_path else refine.default_path(self.path)
        self.refine_loader = refine_loader
        self.refine_idle_s = REFINE_IDLE_S
        self.refiner = self.refine_load = self.worker = self.idle_timer = self.pool = self.inflight = None
        self.refine_state, self.refine_detail = 'idle', None
        self.pending = asyncio.Queue()          # in-order utterances waiting for their second pass
        self.pending_bytes = self.failures = self.utt = self.stable = 0
        self.audio = bytearray()                # the open utterance, in memory only
        self.notices = set()
        self.mode = 'off'
        self.refine_check()

    def availability(self):
        if importlib.util.find_spec('vosk') is None:
            return "Install the speech extra: .venv/bin/pip install -e '.[speech]'"
        if not (self.path / 'am').is_dir():
            return 'Install the voice model with scripts/get-voice-model.py'
        return None

    def drain(self):
        while not self.queue.empty():
            self.queue.get_nowait()

    # ---- second pass: state ---------------------------------------------------------------

    def refine_check(self):
        """Re-read what is installed (the model may have been fetched since the service started)."""
        if self.refiner is not None or self.refine_state == 'loading':
            return
        reason = None if self.refine_loader else refine.availability(self.refine_path)
        self.set_refine('unavailable' if reason else 'idle', reason)

    def set_refine(self, state, detail=None):
        if (state, detail) == (self.refine_state, self.refine_detail):
            return
        self.refine_state, self.refine_detail = state, detail
        if self.on_status:
            try:
                task = asyncio.get_running_loop().create_task(self.notify())
            except RuntimeError:
                return
            self.notices.add(task)
            task.add_done_callback(self.notices.discard)

    async def notify(self):
        try:
            await self.on_status(self.status())
        except Exception:
            logging.exception('Recogniser status notification failed')

    def status(self):
        """What the browser is told: which recognisers are in use and how far the second one is."""
        second = self.refine_state in ('idle', 'loading', 'ready')
        return {'engine': 'vosk+parakeet' if second else 'vosk', 'refine': self.refine_state, 'detail': self.refine_detail}

    def collecting(self):
        return self.mode == 'transcribe' and self.refine_state in ('loading', 'ready')

    def take_audio(self):
        audio, self.audio, self.stable = (bytes(self.audio) if self.collecting() else None), bytearray(), 0
        return audio

    async def load_refiner(self):
        try:
            loader = self.refine_loader or refine.load
            self.refiner = await asyncio.to_thread(loader, str(self.refine_path), REFINE_THREADS)
            self.failures = 0
            self.set_refine('ready')
        except Exception as exc:
            logging.warning('Second-pass model could not load: %s', exc)
            self.set_refine('failed', 'Second pass could not load, dictation uses Vosk alone: ' + str(exc))

    def release_refiner(self):
        """Idle for a long time outside dictation: give the memory back (reloaded on the next start)."""
        self.idle_timer = None
        if self.mode == 'transcribe' or self.pending_bytes or self.refine_state != 'ready':
            return
        self.refiner = None
        if self.pool:
            self.pool.shutdown(wait=False)
            self.pool = None
        gc.collect()
        self.set_refine('idle')

    def arm_idle(self):
        if self.idle_timer:
            self.idle_timer.cancel()
            self.idle_timer = None
        if self.refiner is not None:
            self.idle_timer = asyncio.get_running_loop().call_later(self.refine_idle_s, self.release_refiner)

    def start_refiner(self):
        """Dictation starts at once with Vosk; the second-pass model loads in the background and the
        utterances that finish meanwhile wait for it (their live text stays on screen)."""
        if self.idle_timer:
            self.idle_timer.cancel()
            self.idle_timer = None
        self.refine_check()
        if self.refiner is None and self.refine_state in ('idle', 'failed'):
            self.set_refine('loading')
            self.refine_load = asyncio.create_task(self.load_refiner())
        if self.worker is None or self.worker.done():
            self.worker = asyncio.create_task(self.refine_worker())

    # ---- modes ----------------------------------------------------------------------------

    async def set_mode(self, mode):
        if mode not in ('off', 'commands', 'transcribe'):
            raise ValueError('invalid microphone mode')
        async with self.lock:
            healthy = self.task is not None and not self.task.done()
            if mode == self.mode and (mode == 'off' or healthy):
                return
            # Always invalidate stale work even when FinalResult or persistence fails.
            try:
                if self.recognizer and self.mode == 'transcribe':
                    result = await asyncio.to_thread(self.recognizer.FinalResult)
                    text = json.loads(result).get('text', '')
                    audio = self.take_audio()
                    if text or audio:
                        await self.utterance(text, audio)
                await self.flush()
            except Exception as exc:
                self.error = 'Final speech text could not be saved: ' + str(exc)
                logging.warning('%s', self.error)
            finally:
                self.generation += 1
                self.drain()
                self.partial = ''
                self.audio, self.stable = bytearray(), 0
                self.mode = 'off'
                self.recognizer = None
            if mode != 'transcribe':
                self.arm_idle()
            if mode == 'off':
                return
            reason = self.availability()
            if reason:
                raise ValueError(reason)
            try:
                if self.model is None:
                    def load():
                        import vosk
                        vosk.SetLogLevel(-1)
                        return vosk.Model(str(self.path))
                    self.model = await asyncio.to_thread(load)
                from vosk import KaldiRecognizer
                self.recognizer = KaldiRecognizer(self.model, 16000, json.dumps([*COMMANDS, '[unk]'])) if mode == 'commands' else KaldiRecognizer(self.model, 16000)
                if mode == 'transcribe':
                    self.start_refiner()
                self.mode = mode
                self.error = None
                if not healthy:
                    self.task = asyncio.create_task(self.run())
            except Exception as exc:
                self.error = 'Speech could not start: ' + str(exc)
                self.recognizer = None
                self.mode = 'off'
                raise ValueError(self.error) from exc

    def feed(self, pcm):
        if self.mode == 'off' or not pcm:
            return
        if self.queue.full():
            self.queue.get_nowait()
            self.dropped += 1
        self.queue.put_nowait((self.generation, pcm))

    async def run(self):
        try:
            while True:
                generation, pcm = await self.queue.get()
                async with self.lock:
                    if generation != self.generation or self.recognizer is None:
                        continue
                    rec = self.recognizer
                    def recognize():
                        final = rec.AcceptWaveform(pcm)
                        collect = self.collecting()
                        if collect:
                            self.audio += pcm
                        if final:
                            return True, json.loads(rec.Result()), self.take_audio()
                        data = json.loads(rec.PartialResult())
                        if collect:
                            # A very long utterance is cut at a pause (or at the hard limit) so the
                            # buffer stays bounded and the second pass gets manageable pieces.
                            self.stable = self.stable + len(pcm) if data.get('partial', '') == self.partial else 0
                            size = len(self.audio)
                            if size >= MAX_UTTERANCE_S * BYTES_PER_SECOND or (
                                    size >= SOFT_UTTERANCE_S * BYTES_PER_SECOND and self.stable >= PAUSE_CUT_S * BYTES_PER_SECOND):
                                return True, json.loads(rec.FinalResult()), self.take_audio()
                        return False, data, None
                    final, data, audio = await asyncio.to_thread(recognize)
                    text = data.get('text' if final else 'partial', '')
                    if not final and text == self.partial:
                        continue
                    self.partial = '' if final else text
                    if self.mode == 'commands':
                        if final and text in COMMANDS:
                            await self.emit({'type': 'voice', 'heard': text, **COMMANDS[text]})
                    elif final:
                        await self.utterance(text, audio)
                    else:
                        await self.emit({'type': 'speech', 'text': text, 'final': False, 'mode': self.mode})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self.fault(exc)

    async def fault(self, exc):
        """An unrecoverable error: recognition stops, the ordinary and the emergency callback are told."""
        self.error = 'Speech stopped: ' + str(exc)
        self.mode = 'off'
        self.recognizer = None
        self.generation += 1
        self.drain()
        self.audio, self.stable = bytearray(), 0
        while not self.pending.empty():
            self.pending.get_nowait()
            self.pending.task_done()
        self.pending_bytes = 0
        task, self.task = self.task, None
        if task and task is not asyncio.current_task():
            task.cancel()
        logging.error('%s', self.error)
        # Separate emergency callback still runs when the ordinary emit failed.
        try:
            if self.on_error:
                await self.on_error(self.error)
            else:
                await self.emit({'type': 'speech_error', 'error': self.error})
        except Exception:
            logging.exception('Speech failure notification failed')

    # ---- second pass: utterances ----------------------------------------------------------

    async def utterance(self, text, audio):
        """A finished utterance from Vosk. Without a second pass its text is the final line. With one, the
        text stays on screen as provisional until the refined line (or, failing that, this text) replaces it."""
        if audio is None:
            await self.emit({'type': 'speech', 'text': text, 'final': True, 'mode': 'transcribe', 'engine': 'vosk'})
            return
        if not text and len(audio) < MIN_REFINE_S * BYTES_PER_SECOND:
            return
        self.utt += 1
        if text:
            await self.emit({'type': 'speech', 'text': text, 'final': False, 'provisional': True, 'utt': self.utt, 'mode': 'transcribe'})
        skip = self.pending_bytes > REFINE_BACKLOG_S * BYTES_PER_SECOND
        self.pending_bytes += len(audio)
        self.pending.put_nowait((self.utt, text, audio, skip))

    async def refine_worker(self):
        """Second passes run one at a time, in order, off the event loop; each emits its final line."""
        while True:
            item = await self.pending.get()
            self.inflight = item
            try:
                await self.finish(*item)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # The final line could not be delivered (storage failed): same as a failed emit elsewhere.
                logging.exception('Final text could not be delivered')
                await self.fault(exc)
            finally:
                self.pending_bytes = max(0, self.pending_bytes - len(item[2]))
                self.inflight = None
                self.pending.task_done()

    async def finish(self, utt, text, audio, skip):
        better = None if skip else await self.second_pass(audio)
        final, engine = (better, 'second-pass') if better else (text, 'vosk')
        if final:
            await self.emit({'type': 'speech', 'text': final, 'final': True, 'utt': utt, 'mode': 'transcribe', 'engine': engine})

    async def second_pass(self, audio):
        """The refined text, or None (Vosk's own text is then used). Never raises."""
        try:
            if self.refine_load and not self.refine_load.done():
                await asyncio.wait_for(asyncio.shield(self.refine_load), REFINE_LOAD_WAIT_S)
            refiner = self.refiner
            if refiner is None:
                return None
            if self.pool is None:
                self.pool = concurrent.futures.ThreadPoolExecutor(1, thread_name_prefix='second-pass')
            future = asyncio.get_running_loop().run_in_executor(self.pool, refiner, audio)
            text = (await asyncio.wait_for(future, REFINE_TIMEOUT_S)).strip()
            self.failures = 0
            return text
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logging.warning('Second pass failed, keeping the live text: %r', exc)
            if isinstance(exc, asyncio.TimeoutError) and self.pool:
                self.pool.shutdown(wait=False)      # abandon a stuck call; the next one gets a fresh thread
                self.pool = None
            self.failures += 1
            if self.failures >= REFINE_MAX_FAILURES:
                self.refiner = None
                self.set_refine('failed', 'Second pass failed repeatedly, dictation uses Vosk alone')
            return None

    async def flush(self):
        """Stopping or switching: every finished utterance gets its final line before the session ends."""
        if self.worker is None or (self.pending.empty() and self.inflight is None):
            return
        try:
            await asyncio.wait_for(self.pending.join(), REFINE_FLUSH_S)
            return
        except asyncio.TimeoutError:
            logging.warning('Second pass did not finish in time; using the live text for the rest')
        worker, left = self.worker, []
        if self.inflight:
            left.append(self.inflight)
        self.worker = None
        worker.cancel()
        await asyncio.gather(worker, return_exceptions=True)
        while not self.pending.empty():
            left.append(self.pending.get_nowait())
        self.pending, self.pending_bytes = asyncio.Queue(), 0
        for utt, text, _, _ in left:
            if text:
                await self.emit({'type': 'speech', 'text': text, 'final': True, 'utt': utt, 'mode': 'transcribe', 'engine': 'vosk'})

    async def close(self):
        await self.set_mode('off')
        for name in ('task', 'worker', 'refine_load'):
            task = getattr(self, name)
            setattr(self, name, None)
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        if self.idle_timer:
            self.idle_timer.cancel()
            self.idle_timer = None
        if self.pool:
            self.pool.shutdown(wait=False)
            self.pool = None
        self.refiner = None
