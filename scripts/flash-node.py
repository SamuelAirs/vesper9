#!/usr/bin/env python3
"""Explicit board/MAC targeting; verified full16 MiB backup before every write.

Activate ESP-IDF for source builds; install esptool4.12 for --prebuilt.
Bundled0.1.2 binaries target board1 only. No board is inferred from a USB name.
"""
import argparse
import datetime
import hashlib
import json
import re
import shlex
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLASH_BYTES = 16 * 1024 * 1024


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify_backup(path, expected=None):
    path = Path(path)
    if path.stat().st_size != FLASH_BYTES:
        raise ValueError('Backup must contain exactly16 MiB; no write permitted')
    digest = sha256(path)
    if expected is not None and digest != expected:
        raise ValueError('Backup SHA-256 mismatch; no write permitted')
    return digest


def prebuilt_images(board):
    folder = ROOT / 'firmware/prebuilt'
    data = json.loads((folder / 'BUILD.json').read_text(encoding='utf-8'))
    image_board = data.get('board', 1 if data.get('version') == '0.1.2' else None)
    if image_board != board:
        raise ValueError(f'Bundled firmware targets board{image_board}, requested board{board}; build the correct profile')
    files = [(0, folder / 'bootloader.bin'), (0x8000, folder / 'partition-table.bin'), (0x10000, folder / 'vesper_node.bin')]
    for _, path in files:
        if sha256(path) != data['sha256'][path.name]:
            raise ValueError('Bundled image SHA-256 mismatch: ' + path.name)
    return files


def source_images(board):
    folder = ROOT / 'firmware'
    build = folder / f'build-board{board}'
    idf = shutil.which('idf.py')
    if not idf:
        raise ValueError('Activate ESP-IDF before building firmware')
    subprocess.run([sys.executable, idf, '-B', str(build), f'-DNODE_BOARD={board}', 'build'], cwd=folder, check=True)
    cache = (build / 'CMakeCache.txt').read_text(encoding='utf-8')
    if not re.search(rf'^NODE_BOARD:[^=]+={board}$', cache, re.M):
        raise ValueError('Build cache does not confirm requested board')
    args = json.loads((build / 'flasher_args.json').read_text(encoding='utf-8'))
    files = []
    for address, name in args['flash_files'].items():
        path = (build / name).resolve()
        if not path.is_relative_to(build.resolve()) or not path.is_file():
            raise ValueError('Invalid build image path')
        files.append((int(address, 0), path))
    return sorted(files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--board', type=int, choices=(1, 2), required=True)
    parser.add_argument('--port', required=True)
    parser.add_argument('--expected-mac', required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--prebuilt', action='store_true')
    group.add_argument('--restore', type=Path)
    args = parser.parse_args()
    mac = args.expected_mac.lower()
    if not re.fullmatch(r'(?:[0-9a-f]{2}:){5}[0-9a-f]{2}', mac):
        parser.error('--expected-mac must be six colon-separated hex bytes')
    base = [sys.executable, '-m', 'esptool', '--chip', 'esp32s3', '--port', args.port, '--baud', '460800']
    if args.restore:
        record = json.loads(args.restore.with_suffix('.json').read_text(encoding='utf-8'))
        if record['board'] != args.board or record['mac'] != mac:
            raise ValueError('Restore provenance does not match requested board/MAC')
        verify_backup(args.restore, record['sha256'])
        files = [(0, args.restore)]
    else:
        files = prebuilt_images(args.board) if args.prebuilt else source_images(args.board)
    active = False
    try:
        active = subprocess.run(['systemctl', '--user', 'is-active', '--quiet', 'vesper.service'], capture_output=True).returncode == 0
    except FileNotFoundError:
        pass
    try:
        if active:
            subprocess.run(['systemctl', '--user', 'stop', 'vesper.service'], check=True)
        detected = subprocess.run(base + ['read_mac'], check=True, capture_output=True, text=True)
        observed = re.findall(r'\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b', detected.stdout.lower())
        if mac not in observed:
            raise ValueError('Connected node MAC does not match target; no write permitted')
        folder = ROOT / 'backups'
        folder.mkdir(exist_ok=True)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
        backup = folder / f'node-board{args.board}-{stamp}-{uuid.uuid4().hex[:8]}.bin'
        subprocess.run(base + ['read_flash', '0x0', hex(FLASH_BYTES), str(backup)], check=True)
        digest = verify_backup(backup)
        restore = [sys.executable, str(Path(__file__).resolve()), '--board', str(args.board), '--port', args.port,
                   '--expected-mac', mac, '--restore', str(backup)]
        record = {'board': args.board, 'mac': mac, 'bytes': FLASH_BYTES, 'sha256': digest,
                  'createdAt': stamp, 'restoreArgv': restore}
        metadata = backup.with_suffix('.json')
        metadata.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
        verify_backup(backup, json.loads(metadata.read_text(encoding='utf-8'))['sha256'])
        print('Verified backup:', backup, digest, flush=True)
        print('Restore:', subprocess.list2cmdline(restore) if sys.platform == 'win32' else shlex.join(restore), flush=True)
        flash = base + ['write_flash', '--flash_mode', 'dio', '--flash_size', '16MB', '--flash_freq', '80m']
        for address, path in files:
            flash.extend([hex(address), str(path)])
        subprocess.run(flash, check=True)
        verify = base + ['verify_flash']
        for address, path in files:
            verify.extend([hex(address), str(path)])
        subprocess.run(verify, check=True)
    finally:
        if active:
            subprocess.run(['systemctl', '--user', 'start', 'vesper.service'], check=True)


if __name__ == '__main__':
    main()
