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
        if app['escape'] not in ('adaptive', 'hold') or not isinstance(app['capabilities'], list):
            raise ValueError(f'Invalid control policy: {ident}')
        for alias in app.get('voice', []):
            if not re.fullmatch(r'[a-z]+(?: [a-z]+)*', alias) or alias in aliases:
                raise ValueError(f'Invalid or duplicate voice alias: {alias}')
            aliases.add(alias)
    return data


CATALOG = load_catalog()
APP_IDS = {app['id'] for app in CATALOG['apps']}
DEFAULT_SETTINGS = CATALOG['settings']


def validate_setting(key, value):
    import math
    if key in ('sound', 'crt', 'reducedMotion'):
        valid = type(value) is bool
    elif key == 'menuClicks':
        valid = type(value) is int and value in (0, 3, 4)
    elif key == 'scanMs':
        valid = type(value) is int and value in (600, 850, 1200, 1600)
    elif key == 'gesturePace':
        valid = value in ('quick', 'standard', 'relaxed')
    elif key in ('volume', 'morseWpm', 'holdMs', 'scanMs'):
        low, high = {'volume': (0, 1), 'morseWpm': (5, 25), 'holdMs': (450, 1200), 'scanMs': (600, 1600)}[key]
        valid = type(value) in (int, float) and math.isfinite(value) and low <= value <= high
    else:
        valid = False
    if not valid:
        raise ValueError('Invalid setting: ' + str(key))
    return value
