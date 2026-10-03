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
sys.path.insert(0, str(ROOT))
from vesper.build import identity
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
NODE_FIRMWARE = json.loads((ROOT / 'firmware/prebuilt/BUILD.json').read_text())['version']
INCLUDE = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'LICENSE', 'THIRD_PARTY.md', 'pyproject.toml', 'package.json', '.gitignore', '.clang-format',
           '.github', 'books', 'web', 'vesper', 'firmware', 'scripts', 'tests', 'examples', 'docs', 'VESPER-9-Simulator.html']
SKIP_PARTS = {'build', '__pycache__', '.pytest_cache', 'node_modules', '.venv', '.git', '.claude', '.flash-env',
              'managed_components', 'models', 'backups', 'test-output', 'recordings', 'transcripts'}
SKIP_NAMES = {'sdkconfig', 'sdkconfig.old', 'dependencies.lock'}


def include_file(relative):
    """Exclude local build/runtime artifacts, including each board's new build directory."""
    parts = relative.parts
    if any(part.lower() in SKIP_PARTS or part.lower().startswith('build-board') for part in parts):
        return False
    name = relative.name.lower()
    if name.startswith('.env') or 'backup' in name or name.endswith(('.bak', '.backup')):
        return False
    if relative.suffix.lower() in ('.pyc', '.o', '.db', '.sqlite', '.sqlite3', '.sqlite3-wal', '.sqlite3-shm',
                                  '.wav', '.pcm', '.mp3', '.m4a', '.ogg', '.flac', '.aac', '.opus', '.webm',
                                  '.zim', '.onnx', '.gguf', '.tflite', '.safetensors', '.pt', '.pth',
                                  '.zip', '.tar', '.gz', '.tgz', '.xz', '.bz2', '.7z', '.pem', '.key', '.pfx', '.p12'):
        return False
    if name.endswith(('.db-wal', '.db-shm', '.sqlite-wal', '.sqlite-shm')):
        return False
    if relative.suffix.lower() == '.bin' and relative.as_posix() not in (
            'firmware/prebuilt/bootloader.bin', 'firmware/prebuilt/partition-table.bin', 'firmware/prebuilt/vesper_node.bin'):
        return False
    return not (relative.name in SKIP_NAMES and 'prebuilt' not in parts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT.parent / f'VESPER-9-v{VERSION}.zip')
    parser.add_argument('--handoff-dir', type=Path, help='Explicit optional directory of continuation documents; default packages project source only')
    args = parser.parse_args()
    subprocess.run([sys.executable, str(ROOT / 'scripts/build-demo.py')], check=True)
    build = identity(ROOT)
    entries = {}
    for name in INCLUDE:
        entry = ROOT / name
        for file in ([entry] if entry.is_file() else entry.rglob('*')):
            relative = file.relative_to(ROOT)
            if not file.is_file() or file.is_symlink() or not include_file(relative):
                continue
            content = file.read_bytes()
            if relative.suffix.lower() == '.bin':
                firmware = json.loads((ROOT / 'firmware/prebuilt/BUILD.json').read_text(encoding='utf-8'))
                if hashlib.sha256(content).hexdigest() != firmware.get('sha256', {}).get(file.name):
                    raise ValueError('Bundled firmware hash mismatch: ' + file.name)
            entries['vesper9/' + relative.as_posix()] = content
    entries['vesper9/data/.gitkeep'] = b''
    project_hashes = {name.removeprefix('vesper9/'): hashlib.sha256(data).hexdigest() for name, data in sorted(entries.items())}
    entries['vesper9/RELEASE-MANIFEST.json'] = (json.dumps({'release': VERSION, 'node_firmware': NODE_FIRMWARE,
        'bundled_firmware': build['bundledFirmware'], 'build': build, 'protocol': 1, 'sha256': project_hashes}, indent=2) + '\n').encode()
    if args.handoff_dir:
        handoff = args.handoff_dir.resolve(strict=True)
        if not handoff.is_dir():
            parser.error('--handoff-dir must be a directory')
        for file in handoff.rglob('*'):
            relative = file.relative_to(handoff)
            # Continuation documents only: arbitrary archives/binaries/data are not handoff source.
            if (file.is_file() and not file.is_symlink() and relative.suffix.lower() in ('.md', '.txt', '.pdf')
                    and include_file(relative)):
                entries['handoff/' + relative.as_posix()] = file.read_bytes()
    manifest = {'format': 1, 'application_version': VERSION, 'node_firmware': NODE_FIRMWARE, 'protocol': 1,
                'build': build, 'bundled_firmware': build['bundledFirmware'],
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
