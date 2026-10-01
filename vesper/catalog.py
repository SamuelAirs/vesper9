"""One declarative cartridge catalog shared with the generated browser module."""
import json
import re
from pathlib import Path


def load_catalog(path=None):
    data = json.loads(Path(path or Path(__file__).with_name('catalog.json')).read_text())
    ids, aliases = set(), set()
    for app in data['apps']:
        ident = app['id']
        if not re.fullmatch(r'[a-z][a-z0-9_-]{0,31}', ident) or ident in ids:
            raise ValueError(f'Invalid or duplicate cartridge: {ident}')
        ids.add(ident)
        for key in ('name', 'subtitle', 'description', 'controls', 'category', 'factory'):
            if not isinstance(app[key], str) or not app[key]:
                raise ValueError(f'Missing cartridge {key}: {ident}')
        if not isinstance(app['capabilities'], list):
            raise ValueError(f'Invalid capabilities: {ident}')
        # "escape" ("adaptive" or "hold") was a per-app menu policy. The menu gesture is now the same
        # everywhere (tap, tap, hold), so the field changes nothing: older cartridges that still carry it
        # are accepted (a bad value is still an error) and it is dropped from the loaded catalog.
        if app.pop('escape', 'adaptive') not in ('adaptive', 'hold'):
            raise ValueError(f'Invalid control policy: {ident}')
        # Optional: inline SVG shapes for the dashboard card (48 x 48 viewBox, trusted
        # project source) and labels for keys of the saved field record.
        if not isinstance(app.get('icon', ''), str) or '<script' in app.get('icon', '').lower():
            raise ValueError(f'Invalid cartridge icon: {ident}')
        record = app.get('record', {})
        if not isinstance(record, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in record.items()):
            raise ValueError(f'Invalid record labels: {ident}')
        for alias in app.get('voice', []):
            if not re.fullmatch(r'[a-z]+(?: [a-z]+)*', alias) or alias in aliases:
                raise ValueError(f'Invalid or duplicate voice alias: {alias}')
            aliases.add(alias)
    data['sectors'] = validate_sectors(data.get('sectors'), [app['id'] for app in data['apps']])
    system = data.setdefault('system', [])
    if not isinstance(system, list) or any(not isinstance(i, str) or i not in ids for i in system) or len(set(system)) != len(system):
        raise ValueError('Invalid system apps')
    return data


# The dashboard shows one page per sector. A page holds at most this many cards (a 3 x 2 grid).
SECTOR_PAGE_SIZE = 6


def validate_sectors(sectors, app_ids):
    """Sectors are named groups of app ids, in order: [{"name": "PLAY", "apps": ["orbit", ...]}, ...].
    An app in no sector is not on the dashboard (it stays launchable by id and by voice). The older
    form, a list of names with the apps taken six at a time in catalog order, is still accepted."""
    if isinstance(sectors, list) and sectors and all(isinstance(name, str) and name for name in sectors):
        sectors = [{'name': name, 'apps': app_ids[i * SECTOR_PAGE_SIZE:(i + 1) * SECTOR_PAGE_SIZE]} for i, name in enumerate(sectors)]
        sectors = [sector for sector in sectors if sector['apps']]
    if not isinstance(sectors, list) or not sectors:
        raise ValueError('Invalid sectors')
    seen, names = set(), set()
    for sector in sectors:
        if not isinstance(sector, dict) or set(sector) != {'name', 'apps'}:
            raise ValueError('Invalid sector')
        name, apps = sector['name'], sector['apps']
        if not isinstance(name, str) or not name or name in names:
            raise ValueError(f'Invalid or duplicate sector name: {name!r}')
        names.add(name)
        if not isinstance(apps, list) or not 1 <= len(apps) <= SECTOR_PAGE_SIZE:
            raise ValueError(f'Sector {name} must list 1 to {SECTOR_PAGE_SIZE} apps')
        for ident in apps:
            if not isinstance(ident, str) or ident not in app_ids:
                raise ValueError(f'Sector {name} lists an unknown app: {ident!r}')
            if ident in seen:
                raise ValueError(f'App listed in two sectors: {ident}')
            seen.add(ident)
    return sectors


CATALOG = load_catalog()
APP_IDS = {app['id'] for app in CATALOG['apps']}
DEFAULT_SETTINGS = CATALOG['settings']


def validate_setting(key, value):
    import math
    if key in ('sound', 'crt', 'reducedMotion', 'lampAmbient'):
        valid = type(value) is bool
    elif key == 'lampLevel':
        valid = value in ('full', 'medium', 'low', 'off')
    elif key == 'scanMs':
        valid = type(value) is int and value in (600, 850, 1200, 1600)
    elif key == 'knock':
        # Sensitivity of knock-on-the-case input (vesper/device.py KNOCK_THRESHOLDS).
        valid = value in ('off', 'low', 'medium', 'high')
    elif key == 'gesturePace':
        valid = value in ('quick', 'standard', 'relaxed')
    elif key == 'tempUnit':
        valid = value in ('C', 'F')
    elif key == 'tempOffset':
        # Degrees Celsius subtracted for the case's self-heating (stored as the correction to add).
        valid = (type(value) in (int, float) and math.isfinite(value) and -10 <= value <= 5
                 and (value * 2) == int(value * 2))
    elif key in ('volume', 'morseWpm', 'holdMs', 'scanMs'):
        low, high = {'volume': (0, 1), 'morseWpm': (5, 25), 'holdMs': (450, 1200), 'scanMs': (600, 1600)}[key]
        # Range first: math.isfinite() overflows on a huge integer, and NaN already fails the range test.
        valid = type(value) in (int, float) and low <= value <= high and math.isfinite(value)
    else:
        valid = False
    if not valid:
        raise ValueError('Invalid setting: ' + str(key))
    return value
