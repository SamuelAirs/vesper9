"""Portable service failures and release safeguards; no physical device writes."""
import asyncio
import importlib.util
import json
import random
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_service_fixes import ServiceCase
from test_tapdir import MemoryStore
from vesper.build import identity, source_hash
from vesper.device import simulated_tap
from vesper.health import HostProbe
from vesper.tapdir import Classifier, TapDirection
from vesper.catalog import CATALOG, load_catalog, validate_setting

ROOT = Path(__file__).resolve().parents[1]


def script(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PortableHealth(unittest.TestCase):
    def test_missing_unix_apis_produce_null_metrics(self):
        import vesper.health as health
        with tempfile.TemporaryDirectory() as folder, patch.object(health.os, 'sysconf', None, create=True), patch.object(health.os, 'getloadavg', None, create=True):
            probe = HostProbe(folder, proc=folder, sysfs=folder, vcgencmd=False)
            host, service = probe.sample()
            self.assertIsNone(host['loadAvg'])
            self.assertIsNone(service['rssBytes'])


class BuildAndPackaging(unittest.TestCase):
    def test_metric_and_tap_mode_contracts_are_validated(self):
        self.assertEqual(validate_setting('tapMode', 'generic'), 'generic')
        self.assertEqual(validate_setting('tapMode', 'sides'), 'sides')
        with self.assertRaises(ValueError):
            validate_setting('tapMode', 'back')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'catalog.json'
            data = json.loads(json.dumps(CATALOG))
            data['apps'][0]['scoreMetric'] = 'highbar-style-v2'
            path.write_text(json.dumps(data), encoding='utf-8')
            self.assertEqual(load_catalog(path)['apps'][0]['scoreMetric'], 'highbar-style-v2')
            for bad in (None, 2, 'unsafe/metric'):
                data['apps'][0]['scoreMetric'] = bad
                path.write_text(json.dumps(data), encoding='utf-8')
                with self.assertRaises(ValueError):
                    load_catalog(path)

    def test_extracted_manifest_is_checked_against_actual_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'vesper').mkdir()
            code = root / 'vesper/service.py'
            code.write_text('original', encoding='utf-8')
            stamp = {'commit': 'a' * 40, 'dirty': False, 'sourceHash': source_hash(root)}
            (root / 'RELEASE-MANIFEST.json').write_text(json.dumps({'build': stamp}), encoding='utf-8')
            self.assertEqual(identity(root)['commit'], stamp['commit'])
            (root / 'data').mkdir()
            (root / 'data/private.txt').write_text('private')
            self.assertEqual(identity(root)['sourceHash'], stamp['sourceHash'])
            code.write_text('modified', encoding='utf-8')
            changed = identity(root)
            self.assertIsNone(changed['commit'])
            self.assertTrue(changed['dirty'])

    def test_board_builds_and_runtime_artifacts_are_excluded(self):
        package = script('package-release')
        for name in ('firmware/build-board1/a.bin', 'firmware/build-board2/a.bin', 'web/__pycache__/a', 'handoff/secret.wav', 'vesper/a.sqlite3',
                     'docs/.env', 'docs/.env.local', 'tests/private.db', 'web/private.sqlite', 'docs/local.zim',
                     'firmware/backup.bin', 'examples/recording.m4a', 'books/model.zip', 'scripts/local.onnx'):
            self.assertFalse(package.include_file(Path(name)), name)
        self.assertTrue(package.include_file(Path('firmware/prebuilt/sdkconfig')))

    def test_package_never_collects_parent_files_and_extracted_identity_matches(self):
        import hashlib
        import zipfile
        package = script('package-release')
        with tempfile.TemporaryDirectory() as folder:
            parent = Path(folder)
            root = parent / 'checkout'
            (root / 'vesper').mkdir(parents=True)
            (root / 'vesper/service.py').write_text('source', encoding='utf-8')
            (root / 'docs').mkdir()
            (root / 'docs/guide.md').write_text('public', encoding='utf-8')
            (parent / 'CLAUDE.md').write_text('UNRELATED PRIVATE', encoding='utf-8')
            (parent / 'handoff').mkdir()
            (parent / 'handoff/private.md').write_text('UNRELATED PRIVATE', encoding='utf-8')
            for name in ('.env', 'private.db', 'archive.zim', 'recording.mp3', 'model.tar.gz', 'node-backup.bin'):
                (root / 'docs' / name).write_bytes(b'PRIVATE')
            output = parent / 'release.zip'
            with patch.object(package, 'ROOT', root), patch.object(package.subprocess, 'run'), patch('sys.argv', ['package-release.py', '--output', str(output)]):
                package.main()
            with zipfile.ZipFile(output) as archive:
                self.assertFalse(any('/handoff/' in n for n in archive.namelist()))
                self.assertFalse(any(b'PRIVATE' in archive.read(n) for n in archive.namelist()))
                manifest = json.loads(archive.read('VESPER-9-v0.2.0/vesper9/RELEASE-MANIFEST.json'))
                for name, digest in manifest['sha256'].items():
                    self.assertEqual(hashlib.sha256(archive.read('VESPER-9-v0.2.0/vesper9/' + name)).hexdigest(), digest)
                archive.extractall(parent / 'extracted')
            extracted = parent / 'extracted/VESPER-9-v0.2.0/vesper9'
            self.assertEqual(identity(extracted)['sourceHash'], manifest['build']['sourceHash'])
            self.assertEqual(identity(extracted)['dirty'], manifest['build']['dirty'])

    def test_flash_rejects_wrong_board_and_short_or_changed_backup(self):
        flash = script('flash-node')
        with self.assertRaisesRegex(ValueError, 'board1'):
            flash.prebuilt_images(2)
        self.assertEqual(len(flash.prebuilt_images(1)), 3)
        with tempfile.TemporaryDirectory() as folder:
            backup = Path(folder) / 'backup.bin'
            backup.write_bytes(b'short')
            with self.assertRaisesRegex(ValueError, 'exactly16'):
                flash.verify_backup(backup)
            with backup.open('wb') as stream:
                stream.truncate(flash.FLASH_BYTES)
            digest = flash.verify_backup(backup)
            with backup.open('r+b') as stream:
                stream.write(b'x')
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                flash.verify_backup(backup, digest)

    def test_flash_never_writes_without_matching_mac_and_complete_backup(self):
        flash = script('flash-node')
        mac = 'aa:bb:cc:dd:ee:ff'
        argv = ['flash-node.py', '--board', '2', '--port', 'fake', '--expected-mac', mac]
        for observed, complete in [('00:11:22:33:44:55', True), (mac, False), (mac, True)]:
            calls = []
            def run(command, **kwargs):
                import subprocess
                calls.append(command)
                if 'read_flash' in command:
                    with Path(command[-1]).open('wb') as stream:
                        stream.truncate(flash.FLASH_BYTES if complete else 100)
                return subprocess.CompletedProcess(command, 1 if command[0] == 'systemctl' else 0, stdout=observed)
            with tempfile.TemporaryDirectory() as folder, patch.object(flash, 'ROOT', Path(folder)), patch.object(flash, 'source_images', return_value=[(0, Path('fake-image'))]), patch.object(flash.subprocess, 'run', side_effect=run), patch('sys.argv', argv):
                if observed != mac or not complete:
                    with self.assertRaises(ValueError):
                        flash.main()
                    self.assertFalse(any('write_flash' in c for c in calls))
                else:
                    flash.main()
                    self.assertLess(next(i for i, c in enumerate(calls) if 'read_flash' in c), next(i for i, c in enumerate(calls) if 'write_flash' in c))
                    record = json.loads(next((Path(folder) / 'backups').glob('*.json')).read_text())
                    self.assertEqual((record['mac'], record['board'], record['bytes']), (mac, 2, flash.FLASH_BYTES))
                    self.assertIn('--restore', record['restoreArgv'])


class GenericTap(unittest.TestCase):
    def test_existing_back_samples_survive_but_generic_never_assigns_a_side(self):
        rng = random.Random(9)
        store = MemoryStore()
        old = [{'side': 'back', 'level_db': 50, 'lag': 0, 'onset': 0}]
        store.put('tapDirection', {'taps': old})
        taps = TapDirection(store)
        taps.command('start')
        for side in ('left', 'right'):
            taps.command('label', side)
            for _ in range(8):
                taps.annotate({'clip': simulated_tap(side, rng)})
        status = taps.command('save')
        self.assertTrue(status['ready'])
        self.assertFalse(status['enabled'])
        self.assertEqual(status['saved']['back'], 1)
        self.assertEqual(store.get('tapDirection')['taps'][0], old[0])
        event = taps.annotate({'source': 'node', 'generation': 7, 'side': 'back', 'clip': simulated_tap('right', rng)})
        self.assertNotIn('side', event)
        self.assertNotIn('clip', event)
        self.assertEqual((event['source'], event['generation']), ('node', 7))
        taps.mode = 'sides'
        self.assertTrue(taps.status()['enabled'])
        self.assertNotIn('back', {side for side, _ in taps.classifier.taps})
        with self.assertRaises(ValueError):
            taps.command('label', 'back')

    def test_three_two_vote_is_uncertain_for_operational_sides(self):
        samples = [{'side': s, 'level_db': i, 'lag': 0, 'onset': 0} for i, s in enumerate(('left', 'right', 'left', 'right', 'left'))]
        result = Classifier(samples, sides=('left', 'right'), min_votes=4).classify({'level_db': 2, 'lag': 0, 'onset': 0})
        self.assertEqual(result, (None, 3))


class ServiceRecovery(ServiceCase):
    async def test_completed_send_cannot_swallow_shutdown_cancellation(self):
        from types import SimpleNamespace
        class Client:
            async def send_json(self, event):
                pass
        async def completed(awaitable, timeout):
            await awaitable
            asyncio.current_task().cancel()
            try:
                await asyncio.sleep(0)
            except asyncio.CancelledError:
                pass  # Model wait_for's completed-future cancellation race.
        client = Client()
        box = SimpleNamespace(queue=asyncio.Queue())
        box.queue.put_nowait({'type': 'test'})
        with patch('vesper.server.asyncio.wait_for', side_effect=completed):
            task = asyncio.create_task(self.console.pump(client, box))
            await asyncio.sleep(.02)
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            self.fail('send pump ignored its pending cancellation request')
        await task

    async def test_storage_failure_mutes_and_retains_closure_for_retry(self):
        self.stub_speech()
        await self.console.set_mic('transcribe')
        old = self.console.session
        with patch.object(self.console.store, 'end_session', side_effect=OSError('disk full')):
            with self.assertRaisesRegex(OSError, 'disk full'):
                await self.console.set_mic('off')
            state = self.console.state()
            self.assertEqual(state['mic']['mode'], 'off')
            self.assertFalse(state['mic']['capture'])
            self.assertEqual(self.console.pending_session, old)
            self.assertIn('disk full', state['mic']['error'])
            with self.assertRaises(OSError):
                await self.console.set_mic('transcribe')
            self.assertFalse(self.console.device.mic)
        await self.console.set_mic('transcribe')
        self.assertIsNone(self.console.pending_session)
        self.assertNotEqual(self.console.session, old)
        self.assertTrue(self.console.device.mic)

    async def test_wall_clock_jump_does_not_change_uptime(self):
        before = (await (await self.client.get('/api/system')).json())['service']['uptimeS']
        corrected_wall = self.console.started + 64 * 86400
        with patch('vesper.server.time.time', return_value=corrected_wall):
            service = (await (await self.client.get('/api/system')).json())['service']
            after = service['uptimeS']
            self.assertAlmostEqual(service['startedAt'] + after, corrected_wall, delta=.2)
        self.assertLess(after - before, 2)
        self.assertGreaterEqual(after, before)

    async def test_simulator_final_node_has_no_environment_samples(self):
        await asyncio.sleep(.05)
        self.assertEqual((self.console.device.lamps, self.console.device.mics), (4, 2))
        self.assertEqual(self.console.device.status['board'], 2)
        self.assertEqual(self.console.device.status['sensor']['addr'], 0)
        self.assertIsNone(self.console.state()['sensor'])
        self.assertTrue(self.console.state()['tapDirection']['available'])
