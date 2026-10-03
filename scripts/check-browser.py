#!/usr/bin/env python3
"""Build and verify the browser console on Windows or Linux, using only isolated simulators.

Requires Node, Playwright and Chromium. NODE, PLAYWRIGHT_PATH and TEST_BROWSER_BIN may
point to existing installations. PYTHON defaults to this interpreter. No Pi access.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
CHECKS = ['browser-smoke', 'extension-smoke', 'host-browser', 'voice-host', 'twinbeat-browser', 'save-browser', 'utility-polish', 'game-polish-browser', 'highbar-refresh-browser', 'soak']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', choices=CHECKS)
    parser.add_argument('--output', type=Path, default=ROOT / 'test-output/browser')
    parser.add_argument('--soak-seconds', type=int, default=60)
    args = parser.parse_args()
    node = os.environ.get('NODE') or shutil.which('node')
    if not node:
        parser.error('Install Node or set NODE to its executable')
    env = dict(os.environ, PYTHON=os.environ.get('PYTHON', sys.executable), PYTHONUTF8='1',
               TEST_OUTPUT=str(args.output.resolve()), SOAK_SECONDS=str(args.soak_seconds))
    env['PATH'] = str(Path(node).parent) + os.pathsep + env.get('PATH', '')
    args.output.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, 'scripts/build-demo.py'], cwd=ROOT, env=env, check=True, timeout=60)
    results = []
    for name in [args.only] if args.only else CHECKS:
        command = [node, f'tests/{name}.cjs']
        started = time.monotonic()
        with (args.output / f'{name}.log').open('w', encoding='utf-8') as log:
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=os.name != 'nt')
            try:
                # High Bar visits twelve route cards and profiles four real-time courses.
                budget = 300 if name == 'highbar-refresh-browser' else 180
                code = process.wait(timeout=max(budget, args.soak_seconds + 60))
            except subprocess.TimeoutExpired:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=10)
                else:
                    os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=10)
                code = 'timeout'
        result = {'check': name, 'exitCode': code, 'seconds': round(time.monotonic() - started, 2)}
        results.append(result)
        print(json.dumps(result), flush=True)
    (args.output / 'summary.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
    return int(any(row['exitCode'] != 0 for row in results))


if __name__ == '__main__':
    raise SystemExit(main())
