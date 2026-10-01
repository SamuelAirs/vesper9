"""The voice command grammar: every phrase the command recogniser accepts and what it asks the host to do.

Every phrase starts with "computer". The phrases are generated (apps from vesper/catalog.json, timer
lengths from number words) and use only common words that the small Vosk model knows: `unknown_words()`
checks that against a loaded model, because a grammar phrase containing an unknown word silently fails.
Actions are performed by the browser host (web/main.js, `voice()`), except the timer creation and the
microphone mute, which the service performs itself (vesper/server.py `speech_event`)."""
from .catalog import CATALOG

PREFIX = 'computer'
UNITS = ('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen '
         'seventeen eighteen nineteen').split()
TENS = 'twenty thirty forty fifty sixty seventy eighty ninety'.split()
TIMER_MINUTES = range(1, 121)
TIMER_SECONDS = (10, 15, 20, 30, 45, 90)


def number_words(n):
    """1 to 120 in the words people say ("twenty five", "one hundred and five" is made by `with_and`)."""
    if not 1 <= n <= 120:
        raise ValueError('number out of range')
    if n < 20:
        return UNITS[n - 1]
    if n < 100:
        return TENS[n // 10 - 2] + (' ' + UNITS[n % 10 - 1] if n % 10 else '')
    return 'one hundred' + (' ' + number_words(n - 100) if n > 100 else '')


def build():
    commands = {}

    def add(words, **action):
        commands[PREFIX + ' ' + words] = action

    # Moving the highlight and choosing (dashboard, instruments, menus; the host says so inside a game).
    add('next', action='next')
    add('back', action='previous')
    add('previous', action='previous')
    add('select', action='select')
    add('choose', action='select')
    add('next sector', action='sector')
    add('home', action='home')
    add('menu', action='pause')
    add('pause', action='pause')
    add('resume', action='resume')
    # Apps, by the aliases in the catalog.
    for app in CATALOG['apps']:
        for word in app.get('voice', []):
            add('open ' + word, action='launch', app=app['id'])
    # Timers: "timer N minutes" 1 to 120, a few seconds values, and the last timer cancelled/paused/resumed.
    for minutes in TIMER_MINUTES:
        words = number_words(minutes)
        label = words + (' minute' if minutes == 1 else ' minutes')
        add('timer ' + label, action='timer', seconds=minutes * 60)
        if minutes > 100:
            add('timer one hundred and ' + number_words(minutes - 100) + ' minutes', action='timer', seconds=minutes * 60)
    add('timer one hour', action='timer', seconds=3600)
    add('timer two hours', action='timer', seconds=7200)
    for seconds in TIMER_SECONDS:
        add('timer ' + number_words(seconds) + ' seconds', action='timer', seconds=seconds)
    add('cancel timer', action='timer_cancel')
    add('pause timer', action='timer_pause')
    add('resume timer', action='timer_resume')
    # Field notes.
    add('start dictation', action='dictation_start')
    add('stop dictation', action='dictation_stop')
    # Lamps and sound.
    for word in ('up', 'down', 'off', 'on'):
        add('lamps ' + word, action='lamps', to=word)
    add('sound on', action='sound', to='on')
    add('sound off', action='sound', to='off')
    add('volume up', action='volume', to='up')
    add('volume down', action='volume', to='down')
    # Questions, answered with a toast and the lamps.
    add('what time is it', action='ask', about='time')
    add('temperature', action='ask', about='temperature')
    add('humidity', action='ask', about='humidity')
    add('show timers', action='ask', about='timers')
    add('microphone off', action='mute')
    return commands


COMMANDS = build()
_MINUTES = {number_words(n): n for n in TIMER_MINUTES}


def resolve(text):
    """The action for a recognised text, or None. Exact phrases only, with one forgiveness: the recogniser
    often gets the unit's number wrong ("thirty one minute", "one minutes"), which cannot change what was meant."""
    action = COMMANDS.get(text)
    if action is not None:
        return action
    head, _, unit = text.rpartition(' ')
    if unit in ('minute', 'minutes') and head.startswith(PREFIX + ' timer '):
        words = head[len(PREFIX + ' timer '):].replace('hundred and ', 'hundred ')
        if words in _MINUTES:
            return {'action': 'timer', 'seconds': _MINUTES[words] * 60}
    return None


def words_used(commands=None):
    return sorted({word for phrase in (commands or COMMANDS) for word in phrase.split()})


def unknown_words(model, commands=None):
    """Words of the grammar that `model` (a vosk.Model) does not know; empty when every phrase can work."""
    return [word for word in words_used(commands) if model.vosk_model_find_word(word) < 0]
