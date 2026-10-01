"""Bounded local speech worker. Explicit retries; faults never reacquire capture."""
import asyncio
import importlib.util
import json
import logging
from pathlib import Path
from .catalog import CATALOG

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
    def __init__(self, model_path, emit, on_error=None):
        self.path = Path(model_path).expanduser()
        self.emit, self.on_error = emit, on_error
        self.mode = 'off'
        self.model = self.recognizer = self.task = None
        self.queue = asyncio.Queue(maxsize=50)
        self.lock = asyncio.Lock()
        self.generation = self.dropped = 0
        self.partial = ''
        self.error = None

    def availability(self):
        if importlib.util.find_spec('vosk') is None:
            return "Install the speech extra: .venv/bin/pip install -e '.[speech]'"
        if not (self.path / 'am').is_dir():
            return 'Install the voice model with scripts/get-voice-model.py'
        return None

    def drain(self):
        while not self.queue.empty():
            self.queue.get_nowait()

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
                    if text:
                        await self.emit({'type': 'speech', 'final': True, 'text': text, 'mode': 'transcribe'})
            except Exception as exc:
                self.error = 'Final speech text could not be saved: ' + str(exc)
                logging.warning('%s', self.error)
            finally:
                self.generation += 1
                self.drain()
                self.partial = ''
                self.mode = 'off'
                self.recognizer = None
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
                        return final, json.loads(rec.Result() if final else rec.PartialResult())
                    final, data = await asyncio.to_thread(recognize)
                    text = data.get('text' if final else 'partial', '')
                    if not final and text == self.partial:
                        continue
                    self.partial = '' if final else text
                    if self.mode == 'commands':
                        if final and text in COMMANDS:
                            await self.emit({'type': 'voice', 'heard': text, **COMMANDS[text]})
                    else:
                        await self.emit({'type': 'speech', 'text': text, 'final': bool(final), 'mode': self.mode})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.error = 'Speech stopped: ' + str(exc)
            self.mode = 'off'
            self.recognizer = None
            self.generation += 1
            self.drain()
            self.task = None
            logging.error('%s', self.error)
            # Separate emergency callback still runs when the ordinary emit failed.
            try:
                if self.on_error:
                    await self.on_error(self.error)
                else:
                    await self.emit({'type': 'speech_error', 'error': self.error})
            except Exception:
                logging.exception('Speech failure notification failed')

    async def close(self):
        await self.set_mode('off')
        task, self.task = self.task, None
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
