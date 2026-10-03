"""Installer HTTP/disk boundaries, without networking or large downloads."""
import hashlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("get_encyclopedia", Path(__file__).resolve().parents[1] / "scripts" / "get-encyclopedia.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class Response(io.BytesIO):
    def __init__(self, data, status=200, **headers):
        super().__init__(data)
        self.status, self.headers = status, {"Content-Length": str(len(data)), **headers}


class Download(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.part = self.folder / "archive.part"
        self.disk = patch.object(installer.shutil, "disk_usage", return_value=SimpleNamespace(free=installer.DISK_RESERVE + 1000))
        self.disk.start()

    def tearDown(self):
        self.disk.stop()
        self.temp.cleanup()

    def transfer(self, response, limit=100):
        with patch.object(installer.urllib.request, "urlopen", return_value=response) as request:
            value = installer.download("https://example.invalid/archive", self.part, limit)
        return value, request.call_args.args[0]

    def test_partial_resumes_with_an_exact_range(self):
        self.part.write_bytes(b"abc")
        total, request = self.transfer(Response(b"def", 206, **{"Content-Range": "bytes 3-5/6"}))
        self.assertEqual(total, 6)
        self.assertEqual(request.get_header("Range"), "bytes=3-")
        self.assertEqual(self.part.read_bytes(), b"abcdef")

    def test_ignored_range_restarts_without_appending(self):
        self.part.write_bytes(b"old")
        self.transfer(Response(b"new content"))
        self.assertEqual(self.part.read_bytes(), b"new content")

    def test_mismatched_resume_range_preserves_partial(self):
        self.part.write_bytes(b"abc")
        with self.assertRaisesRegex(ValueError, "resume range"):
            self.transfer(Response(b"def", 206, **{"Content-Range": "bytes 2-4/5"}))
        self.assertEqual(self.part.read_bytes(), b"abc")

    def test_truncation_retains_bytes_for_resume(self):
        with self.assertRaisesRegex(ValueError, "truncated"):
            self.transfer(Response(b"abc", **{"Content-Length": "6"}))
        self.assertEqual(self.part.read_bytes(), b"abc")

    def test_overflow_and_size_ceiling_never_publish(self):
        with self.assertRaisesRegex(ValueError, "declared size"):
            self.transfer(Response(b"abcdef", **{"Content-Length": "3"}))
        with self.assertRaisesRegex(ValueError, "download limit"):
            self.transfer(Response(b"abcdef"), limit=2)

    def test_disk_reserve_is_checked_before_file_creation(self):
        with patch.object(installer.shutil, "disk_usage", return_value=SimpleNamespace(free=installer.DISK_RESERVE)):
            with self.assertRaisesRegex(ValueError, "disk space"):
                self.transfer(Response(b"abc"))
        self.assertFalse(self.part.exists())

    def test_missing_size_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "size is missing"):
            self.transfer(Response(b"abc", **{"Content-Length": ""}))

    def test_checksum_first_publication_and_existing_archive_preservation(self):
        name, data = "wikipedia_en-simple_all_nopic_2026-09.zim", b"valid archive"
        digest = hashlib.sha256(data).hexdigest()
        (self.folder / (name + ".part")).write_bytes(data)
        with patch.object(installer, "published_hash", return_value=digest), patch.object(installer, "download") as download:
            final = installer.install_archive(self.folder, name)
            download.assert_not_called()
            self.assertEqual(final.read_bytes(), data)
            self.assertTrue((self.folder / (name + ".source.json")).exists())
            final.write_bytes(b"keep existing")
            with self.assertRaisesRegex(ValueError, "preserved"):
                installer.install_archive(self.folder, name)
            self.assertEqual(final.read_bytes(), b"keep existing")
        self.assertFalse((self.folder / (name + ".lock")).exists())

    def test_checksum_mismatch_retains_partial_and_concurrent_setup_is_rejected(self):
        name = "wikipedia_en_top_mini_2026-09.zim"
        def write(url, partial, limit):
            partial.write_bytes(b"wrong")
            return 5
        with patch.object(installer, "published_hash", return_value="0" * 64), patch.object(installer, "download", side_effect=write):
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                installer.install_archive(self.folder, name)
        self.assertTrue((self.folder / (name + ".part")).exists())
        self.assertFalse((self.folder / name).exists())
        (self.folder / (name + ".lock")).write_text("123")
        with self.assertRaisesRegex(ValueError, "already running"):
            installer.install_archive(self.folder, name)

    def test_official_simple_english_spelling_and_invalid_paths(self):
        with patch.object(installer, "listing", return_value='<a href="wikipedia_en-simple_all_nopic_2026-09.zim">x</a>'):
            self.assertEqual(installer.latest("simple_all_nopic"), "wikipedia_en-simple_all_nopic_2026-09.zim")
        with self.assertRaises(ValueError):
            installer.install_archive(self.folder, "../escape.zim")
        with self.assertRaises(ValueError):
            installer.latest("../escape")

    def test_published_digest_requires_bounded_sha256(self):
        for body in (b"wrong", b"0" * 64 + b" " * 2000):
            with patch.object(installer.urllib.request, "urlopen", return_value=Response(body)):
                with self.assertRaisesRegex(ValueError, "SHA-256"):
                    installer.published_hash("https://example.invalid/a")


if __name__ == "__main__":
    unittest.main()
