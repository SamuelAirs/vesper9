#!/usr/bin/env python3
"""Install a user-level service and optional graphical-session kiosk launcher."""
import argparse
import datetime
import shutil
import subprocess
from pathlib import Path


def systemd_quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--port")
    group.add_argument("--simulate", action="store_true")
    parser.add_argument("--kiosk", action="store_true")
    parser.add_argument("--data", help="Existing console data directory to preserve during an upgrade")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    python = root / ".venv/bin/python"
    if not python.exists():
        parser.error("Run scripts/install-pi.sh first")
    command = [str(python), "-m", "vesper.server"] + (["--simulate"] if args.simulate else ["--port", args.port])
    if args.data:
        command += ["--data", str(Path(args.data).expanduser().resolve())]
    if args.kiosk and not (shutil.which("chromium") or shutil.which("chromium-browser")):
        parser.error("Install Chromium before requesting kiosk mode")
    backup = root / "backups" / ("service-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
    for existing in [Path.home() / ".config/systemd/user/vesper.service", Path.home() / ".config/autostart/vesper.desktop"]:
        if existing.exists() and (existing.name == "vesper.service" or args.kiosk):
            backup.mkdir(parents=True, exist_ok=True)
            shutil.copy2(existing, backup / existing.name)
    if backup.exists():
        print("Previous service configuration preserved:", backup)
    unit = Path.home() / ".config/systemd/user/vesper.service"
    unit.parent.mkdir(parents=True, exist_ok=True)
    unit.write_text("\n".join([
        "[Unit]", "Description=VESPER-9 field console", "",
        "[Service]", "Type=simple", "WorkingDirectory=" + str(root).replace("%", "%%"),
        "ExecStart=" + " ".join(systemd_quote(x) for x in command), "Restart=on-failure", "RestartSec=3",
        "Environment=PYTHONUNBUFFERED=1", "NoNewPrivileges=true", "UMask=0077", "",
        "[Install]", "WantedBy=default.target", ""
    ]))
    if args.kiosk:
        chromium = shutil.which("chromium") or shutil.which("chromium-browser")
        if not chromium:
            parser.error("Install Chromium before requesting kiosk mode: sudo apt install chromium")
        launcher = Path.home() / ".config/autostart/vesper.desktop"
        launcher.parent.mkdir(parents=True, exist_ok=True)
        launcher.write_text("[Desktop Entry]\nType=Application\nName=VESPER-9\nExec=" + systemd_quote(python) +
            " " + systemd_quote(root / "scripts/kiosk.py") + "\nTerminal=false\n")
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", "vesper.service"], check=True)
    # enable --now leaves an already-running old checkout alive after an upgrade.
    subprocess.run(["systemctl", "--user", "restart", "vesper.service"], check=True)
    print("VESPER service is running. Open http://localhost:8799")
    print("Logs: journalctl --user -u vesper -f")
    if args.kiosk:
        print("Kiosk starts with your next desktop login. Enable desktop auto-login in Raspberry Pi OS if desired.")


if __name__ == "__main__":
    main()
