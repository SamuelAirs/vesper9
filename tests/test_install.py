"""Installer checks with an isolated home and a simulated active user service."""
import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "install_service", Path(__file__).resolve().parents[1] / "scripts/install-service.py"
)
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class ServiceInstallTests(unittest.TestCase):
    def test_upgrade_preserves_files_and_data_and_replaces_active_process(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root, home, data = base / "new checkout", base / "home", base / "existing-data"
            (root / ".venv/bin").mkdir(parents=True)
            (root / ".venv/bin/python").touch()
            data.mkdir()
            (data / "vesper.sqlite3").write_bytes(b"existing user data")
            unit = home / ".config/systemd/user/vesper.service"
            launcher = home / ".config/autostart/vesper.desktop"
            unit.parent.mkdir(parents=True)
            launcher.parent.mkdir(parents=True)
            unit.write_text("old service")
            launcher.write_text("old kiosk")
            running = {"config": "old service"}

            def systemctl(command, **kwargs):
                # Enabling an active unit does not reload its process; restarting does.
                if "restart" in command:
                    running["config"] = unit.read_text()

            with patch.object(installer, "__file__", str(root / "scripts/install-service.py")), \
                 patch.object(Path, "home", return_value=home), \
                 patch.object(installer.shutil, "which", return_value="/usr/bin/chromium"), \
                 patch.object(installer.subprocess, "run", side_effect=systemctl), \
                 patch("sys.argv", ["install-service.py", "--port", "/dev/test-node", "--data", str(data), "--kiosk"]), \
                 contextlib.redirect_stdout(io.StringIO()):
                installer.main()

            self.assertIn(str(root / ".venv/bin/python"), running["config"])
            self.assertIn(str(data), running["config"])
            self.assertEqual((data / "vesper.sqlite3").read_bytes(), b"existing user data")
            backup, = (root / "backups").iterdir()
            self.assertEqual((backup / "vesper.service").read_text(), "old service")
            self.assertEqual((backup / "vesper.desktop").read_text(), "old kiosk")
            self.assertIn(str(root / "scripts/kiosk.py"), launcher.read_text())

    def test_missing_kiosk_dependency_leaves_existing_service_untouched(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root, home = base / "checkout", base / "home"
            (root / ".venv/bin").mkdir(parents=True)
            (root / ".venv/bin/python").touch()
            unit = home / ".config/systemd/user/vesper.service"
            unit.parent.mkdir(parents=True)
            unit.write_text("working service")
            with patch.object(installer, "__file__", str(root / "scripts/install-service.py")), \
                 patch.object(Path, "home", return_value=home), \
                 patch.object(installer.shutil, "which", return_value=None), \
                 patch.object(installer.subprocess, "run") as run, \
                 patch("sys.argv", ["install-service.py", "--simulate", "--kiosk"]), \
                 contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                installer.main()
            run.assert_not_called()
            self.assertEqual(unit.read_text(), "working service")
            self.assertFalse((root / "backups").exists())
