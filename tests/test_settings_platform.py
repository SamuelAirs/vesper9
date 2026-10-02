"""Settings added with the play-mode shell: the timing offset and render quality."""
import unittest

from vesper.catalog import DEFAULT_SETTINGS, validate_setting


class PlatformSettingsTest(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual(DEFAULT_SETTINGS['latencyMs'], 0)
        self.assertEqual(DEFAULT_SETTINGS['renderQuality'], 'auto')

    def test_latency_offset_range(self):
        for good in (-150, 0, 45, 300):
            self.assertEqual(validate_setting('latencyMs', good), good)
        for bad in (-155, 301, 40.5, '40', True, None, float('nan')):
            with self.assertRaises(ValueError, msg=repr(bad)):
                validate_setting('latencyMs', bad)

    def test_render_quality(self):
        for good in ('auto', 'sharp', 'fast'):
            self.assertEqual(validate_setting('renderQuality', good), good)
        for bad in ('high', 1, None):
            with self.assertRaises(ValueError):
                validate_setting('renderQuality', bad)


if __name__ == '__main__':
    unittest.main()
