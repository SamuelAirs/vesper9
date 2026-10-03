#!/usr/bin/env python3
"""Portable bounded Python/JS regressions; temporary simulator data, no Pi required.

Use the current Python environment. NODE may point to an installed Node executable.
Optional speech models are not loaded; encyclopedia tests use a tiny authored ZIM.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python-only', action='store_true')
    parser.add_argument('--timeout', type=int, default=300)
    args = parser.parse_args()
    env = dict(os.environ, PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1')
    node = env.get('NODE') or shutil.which('node')
    if node:
        env['PATH'] = str(Path(node).parent) + os.pathsep + env.get('PATH', '')
    def run(command):
        print('Running:', subprocess.list2cmdline(command), flush=True)
        subprocess.run(command, cwd=ROOT, env=env, check=True, timeout=args.timeout)
    run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v'])
    if not args.python_only:
        if not node:
            parser.error('Node is required for JS regressions; set NODE or use --python-only')
        # Expand in Python: native Windows Node does not expand shell wildcards.
        run([node, '--test', *[str(p.relative_to(ROOT)) for p in sorted((ROOT / 'tests').glob('*.test.mjs'))]])
        run([sys.executable, 'scripts/build-catalog.py', '--check'])


if __name__ == '__main__':
    main()
