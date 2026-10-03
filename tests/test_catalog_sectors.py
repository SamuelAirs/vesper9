"""The catalog's explicit dashboard sectors, the retired per-app menu policy and the retired menuClicks setting."""
import argparse
import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vesper.catalog import CATALOG, SECTOR_PAGE_SIZE, load_catalog, validate_sectors, validate_setting  # noqa: E402
from vesper.server import Console  # noqa: E402
from vesper.storage import Store  # noqa: E402

IDS = [app['id'] for app in CATALOG['apps']]
GAMES = ['orbit', 'runner', 'drift', 'echo', 'reaction', 'glyphs', 'pulsar', 'perihelion', 'descent', 'ricochet',
         'helix', 'ballista', 'tideline', 'outpost']


class Layout(unittest.TestCase):
    def test_every_sector_is_a_named_ordered_group_of_at_most_six_known_apps(self):
        names = [sector['name'] for sector in CATALOG['sectors']]
        self.assertEqual(len(names), len(set(names)))
        seen = []
        for sector in CATALOG['sectors']:
            self.assertTrue({'name', 'apps'} <= set(sector) <= {'name', 'apps', 'tagline'})
            self.assertTrue(1 <= len(sector['apps']) <= SECTOR_PAGE_SIZE, sector['name'])
            for ident in sector['apps']:
                self.assertIn(ident, IDS)
            seen += sector['apps']
        self.assertEqual(len(seen), len(set(seen)), 'an app is on two pages')

    def test_sectors_are_grouped_by_kind_games_first_with_perihelion_on_the_first_page(self):
        # Games by how they are played (long voyages, quick arcade runs, the lamps, mind games), then
        # the tools. Pulsar and Helix are retired (Sam, 2026-10-01): registered until removed, off the dashboard.
        sectors = {s['name']: s['apps'] for s in CATALOG['sectors']}
        names = [s['name'] for s in CATALOG['sectors']]
        by_id = {app['id']: app for app in CATALOG['apps']}
        game = lambda i: by_id[i]['category'].startswith('PLAY')
        self.assertEqual(names[0], 'VOYAGES')
        self.assertEqual(sectors['VOYAGES'][0], 'perihelion')
        self.assertIn('outpost', sectors['VOYAGES'])
        listed = [i for s in CATALOG['sectors'] for i in s['apps']]
        first_tool = next(n for n, i in enumerate(listed) if not game(i))
        self.assertTrue(all(game(i) for i in listed[:first_tool]) and not any(game(i) for i in listed[first_tool:]),
                        'games come first and no page mixes games and tools')
        self.assertTrue(set(GAMES) - {'pulsar', 'helix', 'kiln', 'descent', 'tideline'} <= set(listed))
        self.assertNotIn('pulsar', listed)
        self.assertNotIn('helix', listed)
        # New instruments (The Stacks, "library") join TOOLS; these seven are always there.
        self.assertLessEqual({'morse', 'cadence', 'lantern', 'oracle', 'resonance', 'transcribe'},
                             set(sectors['TOOLS'] + sectors['LISTEN']))
        self.assertTrue(all(s.get('tagline') for s in CATALOG['sectors']), 'every page says what it is for')

    def test_descent_and_tideline_are_off_the_dashboard_but_still_registered(self):
        # Descent is on hold (2026-10-02), Tideline ditched (2026-10-03): code and saves stay.
        on_dashboard = {i for s in CATALOG['sectors'] for i in s['apps']}
        for ident, factory in (('descent', 'Descent'), ('tideline', 'Tideline')):
            app = next(app for app in CATALOG['apps'] if app['id'] == ident)
            self.assertNotIn(ident, on_dashboard)
            self.assertEqual(app['voice'], [], 'its voice name is gone')
            self.assertEqual(app['factory'], factory, 'still launchable by id')

    def test_atmosphere_is_retired_with_the_sensor_node(self):
        # The new node has no temperature/humidity sensor (Sam, 2026-10-03). Atmosphere stays
        # registered, so its stored history is untouched, but it is off the dashboard and voice.
        on_dashboard = {i for s in CATALOG['sectors'] for i in s['apps']}
        atmosphere = next(app for app in CATALOG['apps'] if app['id'] == 'environment')
        self.assertNotIn('environment', on_dashboard)
        self.assertEqual(atmosphere['voice'], [])
        sensor_only = [a['id'] for a in CATALOG['apps'] if a['capabilities'] == ['sensor'] and a['id'] in on_dashboard]
        self.assertEqual(sensor_only, [], 'no dashboard app needs only the sensor')

    def test_slots_held_for_cartridges_on_their_way_in_are_only_the_known_ones(self):
        # The source catalog may name a cartridge whose own pull request has not landed: Meridian and
        # Relay on LAMPS, The Stacks and its Encyclopedia on TOOLS. Anything else unknown is a typo.
        pending = {'meridian', 'relay', 'library', 'encyclopedia'}
        raw = json.loads((ROOT / 'vesper/catalog.json').read_text())['sectors']
        raw_ids = [i for s in raw for i in s['apps']]
        self.assertEqual({i for i in raw_ids if i not in IDS} - pending, set())
        self.assertEqual(next(s for s in raw if s['name'] == 'LAMPS')['apps'], ['meridian', 'relay', 'reaction'])
        tools = next(s for s in raw if s['name'] == 'TOOLS')['apps']
        self.assertEqual(tools[tools.index('library'):], ['library', 'encyclopedia'])

    def test_chronometer_is_retired_in_favour_of_the_timer_tool_in_cadence(self):
        on_dashboard = {i for s in CATALOG['sectors'] for i in s['apps']}
        self.assertNotIn('timers', on_dashboard)
        self.assertIn('cadence', on_dashboard)
        by_id = {app['id']: app for app in CATALOG['apps']}
        self.assertEqual(by_id['timers']['voice'], [], 'the old instrument stays registered, without a voice name')
        self.assertIn('timer', by_id['cadence']['voice'], '"computer open timer" opens Cadence')

    def test_tools_are_off_the_dashboard_and_in_the_system_list_and_ephemeris_is_retired(self):
        on_dashboard = {i for s in CATALOG['sectors'] for i in s['apps']}
        for ident in ('settings', 'diagnostics', 'telemetry'):
            self.assertNotIn(ident, on_dashboard)
        self.assertEqual(CATALOG['system'], ['settings', 'diagnostics', 'telemetry'])
        self.assertNotIn('ephemeris', on_dashboard)
        self.assertNotIn('ephemeris', CATALOG['system'])
        ephemeris = next(app for app in CATALOG['apps'] if app['id'] == 'ephemeris')
        self.assertEqual(ephemeris['voice'], [], 'its voice name is gone')
        self.assertEqual(ephemeris['factory'], 'Ephemeris', 'but it is still registered and launchable by id')
        # Everything that is not on the dashboard is a system tool or retired (Ephemeris, Chronometer).
        # Pulsar and Helix are retired games, removed from the catalog by their own pull requests.
        # Descent is on hold (Sam, 2026-10-02) and Atmosphere retired with the temperature/humidity
        # sensor (2026-10-03): off the dashboard, without a voice name.
        self.assertEqual({i for i in IDS if i not in on_dashboard} - {'pulsar', 'helix'},
                         {'settings', 'diagnostics', 'telemetry', 'ephemeris', 'timers', 'descent', 'environment', 'tideline'})

    def test_the_catalog_no_longer_carries_a_menu_policy(self):
        self.assertTrue(all('escape' not in app for app in CATALOG['apps']))
        self.assertNotIn('menuClicks', CATALOG['settings'])
        text = (ROOT / 'vesper/catalog.json').read_text()
        self.assertNotIn('"escape"', text)
        self.assertNotIn('menuClicks', text)


class Validation(unittest.TestCase):
    def test_sector_rules(self):
        ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
        ok = validate_sectors([{'name': 'ONE', 'apps': ['a', 'b']}, {'name': 'TWO', 'apps': ['c']}], ids)
        self.assertEqual(ok[0]['apps'], ['a', 'b'])
        self.assertEqual(validate_sectors([{'name': 'ONE', 'apps': ['a'], 'tagline': 'For one.'}], ids)[0]['tagline'], 'For one.')
        # A cartridge not in the catalog yet holds its slot without showing; a sector left empty is dropped.
        held = validate_sectors([{'name': 'ONE', 'apps': ['zzz', 'a']}, {'name': 'TWO', 'apps': ['yyy']}], ids)
        self.assertEqual(held, [{'name': 'ONE', 'apps': ['a']}])
        for bad in (
            [],
            None,
            [{'name': 'ONE', 'apps': []}],
            [{'name': 'ONE', 'apps': ids[:7]}],                       # seven do not fit a page of six
            [{'name': 'ONE', 'apps': ['a', 'Not An Id']}],
            [{'name': 'ONE', 'apps': ['zzz']}],                        # nothing left to show
            [{'name': 'ONE', 'apps': ['a']}, {'name': 'TWO', 'apps': ['a']}],
            [{'name': 'ONE', 'apps': ['a']}, {'name': 'ONE', 'apps': ['b']}],
            [{'name': '', 'apps': ['a']}],
            [{'name': 'ONE', 'apps': ['a'], 'extra': 1}],
            [{'name': 'ONE', 'apps': ['a'], 'tagline': ''}],
            [{'name': 'ONE', 'apps': ['a'], 'tagline': 3}],
            ['ONE', 2],
        ):
            with self.assertRaises(ValueError, msg=repr(bad)):
                validate_sectors(bad, ids)

    def test_the_older_list_of_names_still_loads_six_apps_to_a_page(self):
        ids = [f'app{i}' for i in range(14)]
        sectors = validate_sectors(['PLAY', 'PLAY II', 'PLAY III'], ids)
        self.assertEqual([len(s['apps']) for s in sectors], [6, 6, 2])
        self.assertEqual(sectors[0]['apps'], ids[:6])

    def test_a_cartridge_may_still_carry_escape_but_it_changes_nothing(self):
        data = json.loads((ROOT / 'vesper/catalog.json').read_text())
        data['apps'][0]['escape'] = 'hold'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'catalog.json'
            path.write_text(json.dumps(data))
            loaded = load_catalog(path)
            self.assertNotIn('escape', loaded['apps'][0])
            data['apps'][0]['escape'] = 'sometimes'
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                load_catalog(path)

    def test_a_catalog_whose_cartridge_is_in_no_sector_loads_and_is_off_the_dashboard(self):
        data = json.loads((ROOT / 'vesper/catalog.json').read_text())
        data['apps'].append({**data['apps'][0], 'id': 'extra', 'voice': ['extra thing']})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'catalog.json'
            path.write_text(json.dumps(data))
            loaded = load_catalog(path)
            self.assertIn('extra', [a['id'] for a in loaded['apps']])
            self.assertNotIn('extra', [i for s in loaded['sectors'] for i in s['apps']])

    def test_menu_clicks_is_a_retired_setting(self):
        for value in (0, 3, 4, True, 2):
            with self.assertRaises(ValueError):
                validate_setting('menuClicks', value)
        self.assertEqual(validate_setting('gesturePace', 'quick'), 'quick')
        with self.assertRaises(ValueError):
            validate_setting('gesturePace', 'instant')


class Migration(unittest.TestCase):
    def make_console(self, directory):
        args = argparse.Namespace(data=directory, simulate=True, port=None, baud=921600, model=directory)
        return Console(args)

    def test_a_saved_menu_clicks_is_dropped_and_every_other_saved_setting_survives(self):
        for old in (4, 3, 0):
            with tempfile.TemporaryDirectory() as directory:
                store = Store(directory)
                store.put('settings', {'menuClicks': old, 'volume': 0.8, 'gesturePace': 'relaxed', 'holdMs': 800, 'sound': False})
                store.close()
                console = self.make_console(directory)
                try:
                    self.assertNotIn('menuClicks', console.settings)
                    self.assertEqual((console.settings['volume'], console.settings['gesturePace'], console.settings['holdMs'], console.settings['sound']),
                                     (0.8, 'relaxed', 800, False))
                    self.assertEqual(set(console.settings), set(CATALOG['settings']))
                finally:
                    console.store.close()

    def test_the_stale_key_leaves_the_database_with_the_next_settings_change(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            store.put('settings', {'menuClicks': 4, 'volume': 0.8})
            store.close()
            console = self.make_console(directory)
            try:
                asyncio.run(console.command({'command': 'settings', 'key': 'sound', 'value': False}))
                self.assertNotIn('menuClicks', console.store.get('settings'))
                self.assertEqual(console.store.get('settings')['volume'], 0.8)
            finally:
                console.store.close()


if __name__ == '__main__':
    unittest.main()
