"""The voice command grammar and how the speech worker applies it."""
import asyncio
import json
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from vesper.catalog import CATALOG
from vesper.commands import COMMANDS, number_words, resolve, unknown_words, words_used
from vesper.speech import Speech

ROOT = Path(__file__).resolve().parents[1]
VOSK = Path('/home/sam/VESPER-9-v0.2.0-Claude/vesper9/models/vosk-model-small-en-us-0.15')
ACTIONS = {'next', 'previous', 'select', 'sector', 'home', 'pause', 'resume', 'launch', 'timer', 'timer_cancel', 'timer_pause',
           'timer_resume', 'dictation_start', 'dictation_stop', 'lamps', 'sound', 'volume', 'ask', 'mute'}


class Grammar(unittest.TestCase):
    def test_every_phrase_starts_with_computer_and_has_a_known_action(self):
        for phrase, action in COMMANDS.items():
            self.assertTrue(phrase.startswith('computer '), phrase)
            self.assertIn(action['action'], ACTIONS, phrase)
            self.assertEqual(phrase, ' '.join(phrase.split()))
            self.assertEqual(phrase, phrase.lower())

    def test_the_original_phrases_are_unchanged(self):
        self.assertEqual(COMMANDS['computer home'], {'action': 'home'})
        self.assertEqual(COMMANDS['computer pause'], {'action': 'pause'})
        self.assertEqual(COMMANDS['computer menu'], {'action': 'pause'})
        self.assertEqual(COMMANDS['computer resume'], {'action': 'resume'})
        self.assertEqual(COMMANDS['computer microphone off'], {'action': 'mute'})
        self.assertEqual(COMMANDS['computer timer twenty five minutes'], {'action': 'timer', 'seconds': 1500})
        self.assertEqual(COMMANDS['computer timer one minute'], {'action': 'timer', 'seconds': 60})

    def test_every_catalog_alias_opens_its_app(self):
        on_dashboard = {i for sector in CATALOG['sectors'] for i in sector['apps']}
        for app in CATALOG['apps']:
            # An app that is not on the dashboard (Ephemeris, retired from it) may have no voice name.
            if app['id'] in on_dashboard:
                self.assertTrue(app['voice'], app['id'])
            for word in app['voice']:
                self.assertEqual(COMMANDS['computer open ' + word], {'action': 'launch', 'app': app['id']})

    def test_every_whole_number_of_minutes_from_1_to_120(self):
        for minutes in range(1, 121):
            phrase = 'computer timer %s minute%s' % (number_words(minutes), '' if minutes == 1 else 's')
            self.assertEqual(COMMANDS[phrase], {'action': 'timer', 'seconds': minutes * 60}, phrase)
        self.assertNotIn('computer timer zero minutes', COMMANDS)
        self.assertFalse(any('one hundred twenty one' in p for p in COMMANDS))
        self.assertEqual(COMMANDS['computer timer one hundred and five minutes']['seconds'], 105 * 60)
        for seconds in (10, 15, 20, 30, 45, 90):
            self.assertEqual(COMMANDS['computer timer %s seconds' % number_words(seconds)]['seconds'], seconds)
        self.assertTrue(all(5 <= c['seconds'] <= 7200 for c in COMMANDS.values() if c['action'] == 'timer'))

    def test_number_words(self):
        self.assertEqual([number_words(n) for n in (1, 13, 20, 25, 99, 100, 101, 120)],
                         ['one', 'thirteen', 'twenty', 'twenty five', 'ninety nine', 'one hundred', 'one hundred one', 'one hundred twenty'])
        for bad in (0, 121):
            with self.assertRaises(ValueError):
                number_words(bad)

    def test_resolve_forgives_only_the_unit_number_of_a_timer(self):
        self.assertEqual(resolve('computer home'), {'action': 'home'})
        self.assertEqual(resolve('computer timer thirty one minute'), {'action': 'timer', 'seconds': 1860})
        self.assertEqual(resolve('computer timer one minutes'), {'action': 'timer', 'seconds': 60})
        self.assertEqual(resolve('computer timer one hundred and five minute'), {'action': 'timer', 'seconds': 6300})
        for text in ('computer timer zero minutes', 'computer timer one hundred twenty one minutes', 'computer timer five hours',
                     'computer timer fifty six moon', 'timer five minutes', 'computer', '[unk]', 'computer timer minutes', ''):
            self.assertIsNone(resolve(text), text)

    def test_grammar_stays_a_reasonable_size(self):
        self.assertLess(len(COMMANDS), 300)
        self.assertLess(len(json.dumps(list(COMMANDS))), 12000)

    def test_distinct_phrases_do_not_share_a_spoken_form(self):
        spoken = {}
        for phrase, action in COMMANDS.items():
            spoken.setdefault(phrase, action)
        self.assertEqual(len(spoken), len(COMMANDS))

    @unittest.skipUnless((VOSK / 'am').is_dir(), 'Vosk model not installed')
    def test_every_word_is_in_the_vosk_vocabulary(self):
        import vosk
        vosk.SetLogLevel(-1)
        model = vosk.Model(str(VOSK))
        self.assertEqual(unknown_words(model), [])
        self.assertEqual(unknown_words(model, {'computer flibbertigibbet': {}}), ['flibbertigibbet'])

    def test_words_used_lists_each_word_once(self):
        words = words_used()
        self.assertEqual(len(words), len(set(words)))
        self.assertIn('computer', words)


@unittest.skipUnless(shutil.which('node'), 'node not installed')
class Documented(unittest.TestCase):
    """The list shown in Calibration (web/engine/voice.js) and the grammar describe the same phrases."""

    def help_phrases(self):
        script = ("import { VOICE_HELP } from './web/engine/voice.js'; console.log(JSON.stringify(VOICE_HELP));")
        out = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        phrases = set()
        for page in json.loads(out):
            for entry in page['entries']:
                for say in entry['say']:
                    if '<app>' in say:
                        phrases |= {'computer open ' + w for app in CATALOG['apps'] for w in app['voice']}
                    elif '<minutes>' in say:
                        for n in range(1, 121):
                            phrases.add('computer ' + say.replace('<minutes>', number_words(n)).replace('minutes', 'minute' if n == 1 else 'minutes'))
                            if n > 100:
                                phrases.add('computer ' + say.replace('<minutes>', 'one hundred and ' + number_words(n - 100)))
                    elif '<seconds>' in say:
                        phrases |= {'computer ' + say.replace('<seconds>', number_words(n)) for n in (10, 15, 20, 30, 45, 90)}
                    else:
                        phrases.add('computer ' + say)
        return phrases

    def test_help_and_grammar_match(self):
        shown = self.help_phrases()
        self.assertEqual(sorted(shown - set(COMMANDS)), [], 'documented but not in the grammar')
        self.assertEqual(sorted(set(COMMANDS) - shown), [], 'in the grammar but not documented')

    def test_operator_guide_lists_every_non_generated_phrase(self):
        text = (ROOT / 'docs' / 'OPERATOR.md').read_text()
        section = text[text.index('## Voice vocabulary'):]
        for phrase in COMMANDS:
            if re.search(r'timer .* (minutes?|seconds)$', phrase) or phrase.startswith('computer open '):
                continue
            self.assertIn(phrase.replace('computer ', ''), section, phrase)


class FakeCommandRecognizer:
    def __init__(self, text, conf=None):
        self.text, self.conf, self.words, self.chunks = text, conf, False, 0

    def SetWords(self, on):
        self.words = on

    def AcceptWaveform(self, pcm):
        self.chunks += 1
        return True

    def Result(self):
        result = [] if self.conf is None else [{'word': w, 'conf': self.conf} for w in self.text.split()]
        return json.dumps({'text': self.text, 'result': result})

    def PartialResult(self):
        return '{"partial": ""}'

    def FinalResult(self):
        return '{"text": ""}'


class Applying(unittest.IsolatedAsyncioTestCase):
    async def run_mode(self, mode, text, conf=None, min_conf=None):
        events, grammars = [], []
        recognizer = FakeCommandRecognizer(text, conf)

        async def emit(event):
            events.append(event)

        def make(model, rate, *grammar):
            grammars.append(grammar)
            return recognizer

        speech = Speech('/unused', emit, refine_path='/nonexistent')
        if min_conf is not None:
            speech.command_min_conf = min_conf
        speech.availability = lambda: None
        speech.model = object()
        with patch.dict(sys.modules, {'vosk': SimpleNamespace(KaldiRecognizer=make)}):
            await speech.set_mode(mode)
            speech.feed(bytes(640))
            await asyncio.sleep(.1)
            await speech.close()
        return events, grammars, recognizer

    async def test_commands_mode_uses_the_full_grammar_and_word_confidences(self):
        events, grammars, recognizer = await self.run_mode('commands', 'computer timer five minutes', conf=.97)
        self.assertEqual(json.loads(grammars[0][0]), [*COMMANDS, '[unk]'])
        self.assertTrue(recognizer.words)
        self.assertEqual(events, [{'type': 'voice', 'heard': 'computer timer five minutes', 'confidence': .97, 'action': 'timer', 'seconds': 300}])

    async def test_a_low_confidence_word_vetoes_the_command(self):
        events, *_ = await self.run_mode('commands', 'computer home', conf=.4, min_conf=.8)
        self.assertEqual(events, [])
        events, *_ = await self.run_mode('commands', 'computer home', conf=.9, min_conf=.8)
        self.assertEqual([e['action'] for e in events], ['home'])

    async def test_a_wrong_unit_number_still_means_the_same_timer(self):
        events, *_ = await self.run_mode('commands', 'computer timer ten minute', conf=1.0)
        self.assertEqual([(e['action'], e['seconds']) for e in events], [('timer', 600)])

    async def test_text_that_is_not_exactly_a_phrase_is_ignored(self):
        for text in ('computer', 'computer [unk]', 'computer home please', '[unk]', 'home'):
            events, *_ = await self.run_mode('commands', text, conf=1.0)
            self.assertEqual(events, [], text)

    async def test_dictation_never_runs_commands_and_has_no_grammar(self):
        for text in ('computer home', 'computer microphone off', 'computer timer five minutes', 'computer start dictation'):
            events, grammars, _ = await self.run_mode('transcribe', text, conf=1.0)
            self.assertEqual([e for e in events if e['type'] == 'voice'], [], text)
            self.assertEqual([e['text'] for e in events if e['type'] == 'speech' and e['final']], [text])
            self.assertEqual(grammars, [()], 'transcribe mode builds an unconstrained recogniser')


if __name__ == '__main__':
    unittest.main()
