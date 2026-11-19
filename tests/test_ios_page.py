"""The iPhone app's page: the standalone console with the app's layer in its head (ios/build-web.py)."""
import re
import runpy
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


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
        layer = (ROOT / 'ios/layer/app.css').read_text(encoding='utf-8') + (ROOT / 'ios/layer/app.js').read_text(encoding='utf-8')
        for name in ('arcade', 'menu-arcade', 'game', 'application', 'mic-button', 'mode-tag', 'control-secondary',
                     'escape-hint', 'control-hint', 'pause-button', 'clock', 'build-tag', 'toast'):
            self.assertIn(f'#{name}', layer, f'the layer no longer uses #{name}')
            self.assertIn(f'id="{name}"', page, f'the page has no #{name}')
        for name in ('console', 'masthead', 'instrument-bar', 'physical-lights', 'lamp', 'app-heading', 'app-description',
                     'hud', 'hud-item', 'game-stage', 'stage-corners', 'app-readout', 'control-deck', 'arcade', 'arcade-cap',
                     'control-copy', 'hold-track', 'footer-right', 'case-label', 'system-menu'):
            self.assertIn(f'.{name}', layer, f'the layer no longer styles .{name}')
            self.assertRegex(page + style, rf'[ ."]{re.escape(name)}[ ".{{,:>]', f'the page has no .{name}')
        # The page's play mode, which the layer builds on, and the handles app.js uses.
        self.assertIn('@media (min-width: 700px) and (min-height: 400px)', style)
        self.assertIn('classList.toggle("playing", playing)', main)
        for handle in ('window.vesper = consoleApp', 'this.loaded = true', 'softwareButton(pressed)'):
            self.assertIn(handle, main)
        self.assertIn('localStorage.getItem("vesper-demo")', (ROOT / 'web/engine/demo.js').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
