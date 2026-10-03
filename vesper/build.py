"""Source/build provenance, sampled once at startup; unrelated to connected node firmware."""
import hashlib
import json
import subprocess
from pathlib import Path


def source_hash(root):
    root = Path(root)
    files = [root / 'pyproject.toml']
    files += list((root / 'vesper').glob('*.py')) + [root / 'vesper/catalog.json']
    files += [p for p in (root / 'web').rglob('*') if p.is_file() and p.suffix in ('.js', '.css', '.html')]
    digest = hashlib.sha256()
    for path in sorted(set(files)):
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode() + b'\0')
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def bundled_firmware(root):
    try:
        data = json.loads((Path(root) / 'firmware/prebuilt/BUILD.json').read_text(encoding='utf-8'))
        # The existing 0.1.2 binary is explicitly the original three-lamp board.
        board = data.get('board', 1 if data.get('version') == '0.1.2' else None)
        return {'version': data.get('version'), 'board': board,
                'applicationSha256': data.get('sha256', {}).get('vesper_node.bin')}
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def identity(root):
    root = Path(root)
    actual_hash = source_hash(root)
    commit, dirty = None, None
    try:
        # Require checkout metadata here: git must not accidentally identify a parent repository.
        if (root / '.git').exists():
            def git(*args):
                return subprocess.run(['git', '-C', str(root), *args], check=True,
                                      capture_output=True, text=True, timeout=2).stdout.strip()
            commit = git('rev-parse', 'HEAD')
            dirty = bool(git('status', '--porcelain', '--untracked-files=no'))
        else:
            release = json.loads((root / 'RELEASE-MANIFEST.json').read_text(encoding='utf-8'))
            build = release.get('build', {}) if isinstance(release, dict) else {}
            build = build if isinstance(build, dict) else {}
            if build.get('sourceHash') == actual_hash:
                commit, dirty = build.get('commit'), build.get('dirty')
            else:
                # A modified extracted release must not advertise an unchanged stamp.
                dirty = True
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return {'commit': commit, 'dirty': dirty, 'sourceHash': actual_hash,
            'bundledFirmware': bundled_firmware(root)}
