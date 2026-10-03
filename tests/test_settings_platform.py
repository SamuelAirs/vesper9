"""Settings added with the play-mode shell: the timing offset and render quality."""
import unittest

from vesper.catalog import DEFAULT_SETTINGS, validate_setting
from vesper.server import progress_id


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

    def test_save_slot_progress_ids(self):
        for good in ('outpost', 'outpost#2', 'outpost#4', 'console', 'slots'):
            self.assertTrue(progress_id(good), good)
        for bad in ('outpost#1', 'outpost#5', 'outpost#02', 'outpost#', 'nope#2', '#2', 'outpost#2#3', 'slots#2'):
            self.assertFalse(progress_id(bad), bad)


if __name__ == '__main__':
    unittest.main()
