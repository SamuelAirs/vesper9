"""The iPhone app's page and the console's saves brought to it (ios/build-web.py, ios/console-saves.py)."""
import json
import re
import runpy
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def layer(suffix):
    """The app's layer: every file of one kind in ios/layer, in the order the page gets them."""
    return '\n'.join(path.read_text(encoding='utf-8') for path in sorted((ROOT / 'ios/layer').glob('*' + suffix)))


class IosPage(unittest.TestCase):
    def test_layer_is_in_the_head_and_the_console_after_it(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / 'index.html'
            runpy.run_path(str(ROOT / 'ios/build-web.py'))['build'](out)
            html = out.read_text(encoding='utf-8')
        head_end = html.index('</head>')
        css, js = html.index('id="vesper-app-css"'), html.index('id="vesper-app-js"')
        console = html.index('window.VESPER_STANDALONE=true')
        # The app's style after the page's own, both layers in the head, the console's code in the body.
        self.assertLess(html.index('<style>'), css)
        self.assertLess(css, head_end)
        self.assertLess(js, head_end)
        self.assertLess(head_end, console)
        self.assertEqual(html.count('<meta name="viewport"'), 1)
        self.assertLess(html.index('<meta name="viewport"'), js)

    def test_layer_names_only_what_the_page_has(self):
        page = (ROOT / 'web/index.html').read_text(encoding='utf-8')
        style = (ROOT / 'web/style.css').read_text(encoding='utf-8')
        main = (ROOT / 'web/main.js').read_text(encoding='utf-8')
        both = re.sub(r'/\*.*?\*/', '', layer('.css') + layer('.js'), flags=re.S)
        for name in ('arcade', 'menu-arcade', 'game', 'application', 'dashboard', 'mic-button', 'mode-tag',
                     'control-secondary', 'escape-hint', 'control-hint', 'pause-button', 'clock', 'build-tag', 'toast',
                     'save-status', 'utility-stage', 'utility-content', 'menu-actions', 'menu-description'):
            self.assertIn(f'#{name}', both, f'the layer no longer uses #{name}')
            self.assertIn(f'id="{name}"', page, f'the page has no #{name}')
        for name in ('console', 'masthead', 'instrument-bar', 'physical-lights', 'lamp', 'app-heading', 'app-description',
                     'hud', 'hud-item', 'game-stage', 'stage-corners', 'app-readout', 'control-deck', 'arcade', 'arcade-cap',
                     'control-copy', 'hold-track', 'footer-right', 'case-label', 'system-menu', 'overlay', 'menu-switch',
                     'sector-head', 'section-line', 'sector-strip', 'section-meta', 'app-grid', 'app-card',
                     'dashboard-actions', 'scan-action', 'utility-actions', 'utility-button', 'brand-symbol', 'eyebrow'):
            self.assertIn(f'.{name}', both, f'the layer no longer styles .{name}')
            self.assertRegex(page + style, rf'[ ."]{re.escape(name)}[ ".{{,:>]', f'the page has no .{name}')
        # The page's play mode, which the layer builds on, and the handles app.js uses.
        self.assertIn('@media (min-width: 700px) and (min-height: 400px)', style)
        self.assertIn('classList.toggle("playing", playing)', main)
        for handle in ('window.vesper = consoleApp', 'this.loaded = true', 'softwareButton(pressed)', 'toast(', 'fitCanvas()'):
            self.assertIn(handle, main)
        self.assertIn('window.addEventListener("resize", () => this.fitCanvas())', main)
        self.assertIn('localStorage.getItem("vesper-demo")', (ROOT / 'web/engine/demo.js').read_text(encoding='utf-8'))

    def test_the_app_and_the_page_use_the_same_words(self):
        """What Swift says and what app.js listens for: the postures, the messages, the file's name."""
        swift = ''.join(path.read_text(encoding='utf-8') for path in sorted((ROOT / 'ios/Vesper9').glob('*.swift')))
        script, style = layer('.js'), layer('.css')
        for posture in ('plain', 'openBook', 'halfBook', 'openTall', 'laptop'):
            self.assertRegex(swift, rf'case {posture}\b')
            self.assertIn(posture, script)
        for message in ('saves', 'save', 'remove', 'clear', 'imported', 'press', 'knock', 'ready'):
            self.assertIn(f'case "{message}"', swift)
            self.assertIn(f't: "{message}"', script)
        for key in ('"posture"', '"window"', '"safe"', '"crease"', '"saved"', '"launch"', '"import"', '"fold"'):
            self.assertIn(key, swift)
        for key in ('told.posture', 'told.window', 'told.safe', 'told.crease', 'given.saved', 'given.launch', 'given.import', 'given.fold'):
            self.assertIn(key, script)
        self.assertIn('window.vesperApp.fold(', swift)
        self.assertIn('window.vesperApp.fit = fit;', script)
        self.assertIn('window.vesperApp.fold = fold;', script)
        self.assertIn('console-saves.json', swift)
        self.assertIn('console-saves.json', (ROOT / 'ios/console-saves.py').read_text(encoding='utf-8'))
        for name in ('--fold-start', '--fold-band', '--sat', '--sar', '--sab', '--sal'):
            self.assertIn(name, script)
            self.assertIn(f'var({name}', style)
        self.assertIn('[data-fold="across"]', style)
        self.assertIn('"data-fold"', script)

    def test_console_saves_are_read_as_the_service_gives_them(self):
        from vesper.storage import Store
        tool = runpy.run_path(str(ROOT / 'ios/console-saves.py'))
        with tempfile.TemporaryDirectory() as folder:
            store = Store(folder)
            store.score('orbit', 41)
            store.score('orbit', 12)
            store.score('highbar:flow-v5', 13840)
            store.put('progress', {'orbit': {'sector': 5}, 'outpost#2': {'machines': [1, 2]}, 'slots': {'outpost': 2}})
            store.put('settings', {'volume': 3})
            expected = {'scores': store.scores(), 'progress': store.get('progress')}
            store.db.close()
            before = (Path(folder) / 'vesper.sqlite3').read_bytes()
            out = Path(folder) / 'console-saves.json'
            tool['main']([str(Path(folder) / 'vesper.sqlite3'), str(out)])
            saves = json.loads(out.read_text(encoding='utf-8'))
            # Read only: the console's database is as it was.
            self.assertEqual((Path(folder) / 'vesper.sqlite3').read_bytes(), before)
            sqlite3.connect(Path(folder) / 'vesper.sqlite3').close()
        self.assertEqual(saves['vesper9'], 'console-saves')
        self.assertEqual(saves['scores'], expected['scores'])
        self.assertEqual(saves['scores']['orbit'], 41)
        self.assertEqual(saves['progress'], expected['progress'])
        self.assertNotIn('settings', saves)
        self.assertTrue(saves['lastBest'])


if __name__ == '__main__':
    unittest.main()
