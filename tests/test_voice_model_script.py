"""scripts/get-voice-model.py: the second-pass model is verified and never downloaded twice. No network."""
import hashlib
import importlib.util
import io
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "get-voice-model.py"


def load_script():
    spec = importlib.util.spec_from_file_location("get_voice_model", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def archive(module, extra=()):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:bz2") as tar:
        for name in (*module.REFINE_FILES, *extra):
            data = b"x" * 10
            info = tarfile.TarInfo(module.REFINE_NAME + "/" + name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


class SecondPassModel(unittest.TestCase):
    def setUp(self):
        out = patch("sys.stdout", io.StringIO())
        out.start()
        self.addCleanup(out.stop)
        self.temporary = tempfile.TemporaryDirectory()
        self.module = load_script()
        self.module.ROOT = Path(self.temporary.name)
        self.target = self.module.ROOT / "models" / self.module.REFINE_NAME

    def tearDown(self):
        self.temporary.cleanup()

    def serve(self, payload):
        calls = []
        def download(url, target):
            calls.append(url)
            target.write_bytes(payload)
        return calls, patch.object(self.module, "download", download)

    def test_a_verified_archive_installs_only_the_model_files(self):
        payload = archive(self.module, extra=("../escape.txt", "test_wavs/0.wav"))
        calls, patched = self.serve(payload)
        with patched, patch.object(self.module, "REFINE_SHA256", hashlib.sha256(payload).hexdigest()):
            self.module.get_refine()
        self.assertEqual(calls, [self.module.REFINE_URL])
        self.assertEqual(sorted(p.name for p in self.target.iterdir()), sorted([*self.module.REFINE_FILES, "download-sha256.txt"]))
        self.assertFalse((self.module.ROOT / "escape.txt").exists())
        self.assertFalse((self.module.ROOT / "models" / "escape.txt").exists())

    def test_a_present_model_is_not_downloaded_again(self):
        self.target.mkdir(parents=True)
        for name in self.module.REFINE_FILES:
            (self.target / name).write_bytes(b"x")
        calls, patched = self.serve(b"unused")
        with patched:
            self.module.get_refine()
        self.assertEqual(calls, [])

    def test_an_archive_with_the_wrong_checksum_is_discarded(self):
        calls, patched = self.serve(archive(self.module))
        with patched, self.assertRaises(SystemExit) as raised:
            self.module.get_refine()
        self.assertIn("does not match", str(raised.exception))
        self.assertFalse(self.target.exists())
        self.assertEqual(list((self.module.ROOT / "models").iterdir()), [])     # no temporary leftovers

    def test_an_incomplete_archive_is_refused(self):
        payload = self.truncated()
        calls, patched = self.serve(payload)
        with patched, patch.object(self.module, "REFINE_SHA256", hashlib.sha256(payload).hexdigest()), self.assertRaises(SystemExit):
            self.module.get_refine()
        self.assertFalse(self.target.exists())

    def truncated(self):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:bz2") as tar:
            info = tarfile.TarInfo(self.module.REFINE_NAME + "/tokens.txt")
            info.size = 1
            tar.addfile(info, io.BytesIO(b"x"))
        return buffer.getvalue()

    def test_the_pinned_checksum_is_the_one_in_the_audit(self):
        self.assertEqual(self.module.REFINE_SHA256, "f628312e9fdf8686374cb01a69425c41732529d540860311f16f37cbc32cfe9b")


if __name__ == "__main__":
    unittest.main()
