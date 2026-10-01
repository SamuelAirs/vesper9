#!/usr/bin/env python3
"""Build a clean, versioned source + simulator + firmware + continuation bundle."""
import argparse
import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
INCLUDE = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'LICENSE', 'THIRD_PARTY.md', 'pyproject.toml', 'package.json', '.gitignore', '.clang-format',
           'web', 'vesper', 'firmware', 'scripts', 'tests', 'examples', 'docs', 'VESPER-9-Simulator.html']
SKIP_PARTS = {'build', '__pycache__', '.pytest_cache', 'node_modules', '.venv', 'models', 'backups', 'test-output'}
SKIP_NAMES = {'sdkconfig', 'sdkconfig.old', 'dependencies.lock'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT.parent / f'VESPER-9-v{VERSION}.zip')
    args = parser.parse_args()
    subprocess.run([sys.executable, str(ROOT / 'scripts/build-demo.py')], check=True)
    entries = {}
    for name in INCLUDE:
        entry = ROOT / name
        for file in ([entry] if entry.is_file() else entry.rglob('*')):
            relative = file.relative_to(ROOT)
            if not file.is_file() or file.is_symlink() or any(part in SKIP_PARTS for part in relative.parts):
                continue
            if file.suffix in ('.pyc', '.o') or (file.name in SKIP_NAMES and 'prebuilt' not in relative.parts):
                continue
            entries['vesper9/' + relative.as_posix()] = file.read_bytes()
    entries['vesper9/data/.gitkeep'] = b''
    project_hashes = {name.removeprefix('vesper9/'): hashlib.sha256(data).hexdigest() for name, data in sorted(entries.items())}
    entries['vesper9/RELEASE-MANIFEST.json'] = (json.dumps({'release': VERSION, 'node_firmware': '0.1.1', 'protocol': 1, 'sha256': project_hashes}, indent=2) + '\n').encode()
    for name in ['START-HERE.txt', 'CLAUDE.md', 'CLAUDE-START-PROMPT.txt', 'CODEX-START-PROMPT.txt', 'handoff']:
        entry = ROOT.parent / name
        for file in ([entry] if entry.is_file() else entry.rglob('*')):
            if file.is_file() and not file.is_symlink():
                entries[file.relative_to(ROOT.parent).as_posix()] = file.read_bytes()
    manifest = {'format': 1, 'application_version': VERSION, 'node_firmware': '0.1.1', 'protocol': 1,
                'note': 'Source implementation release; physical Pi/node qualification remains required.',
                'sha256': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(entries.items())}}
    entries['HANDOFF-MANIFEST.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    prefix = f'VESPER-9-v{VERSION}/'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            archive.writestr(prefix + name, data)
    with zipfile.ZipFile(args.output) as archive:
        assert archive.testzip() is None
        for name, expected in manifest['sha256'].items():
            assert hashlib.sha256(archive.read(prefix + name)).hexdigest() == expected
    print(f'{args.output} — {args.output.stat().st_size:,} bytes, {len(entries)} files; CRC and SHA-256 verified')


if __name__ == '__main__':
    main()
