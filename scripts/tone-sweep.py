#!/usr/bin/env python3
"""Do the console's own sounds register as taps on the case? (PR #4, knock input)

Plays the kinds of short tone the games make, through the Pi's speaker, with the same envelope as
the console's synth (8 ms attack, exponential fall to silence at the tone's end), and listens to the
running service for knock events. Silent slots in between count what arrives with no sound at all.
Nobody should touch the case or the button while it runs. Records no audio.

  .venv/bin/python scripts/tone-sweep.py                 # service on this Pi, port 8799
  .venv/bin/python scripts/tone-sweep.py --repeat 5 --gain 0.25

The service must be running with knock input on (Calibration > KNOCK SENSITIVITY) and the system
volume where Sam plays. Leave the console on its home screen so no game makes sounds of its own.
"""
import argparse
import asyncio
import io
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import wave

import aiohttp

RATE = 48000
# (Hz, seconds, wave): the tones the games use most (Pulsar, Perihelion, Descent, the menu tick).
TONES = [
    (70, .05, "square"), (98, .1, "square"), (110, .12, "triangle"), (147, .05, "triangle"),
    (150, .05, "square"), (180, .1, "square"), (210, .025, "triangle"), (300, .06, "triangle"),
    (420, .05, "triangle"), (520, .05, "sine"), (523, .12, "triangle"), (660, .1, "sine"),
    (784, .25, "triangle"), (1040, .05, "square"), (1200, .05, "square"), (330, .5, "triangle"),
]
WINDOW = .8  # a knock up to this long after a tone starts is put down to it


def wave_at(kind, phase):
    x = phase % 1
    if kind == "square":
        return 1.0 if x < .5 else -1.0
    if kind == "triangle":
        return 4 * abs(x - .5) - 1
    return math.sin(2 * math.pi * x)


def tone_wav(hz, seconds, kind, gain):
    """The console's synth.tone() (web/engine/audio.js) at `gain` (the console uses volume x 0.25)."""
    frames = bytearray()
    for i in range(int((seconds + .02) * RATE)):
        t = i / RATE
        if t < .008:
            g = t / .008
        elif t < seconds:
            g = math.exp(math.log(1e-4) * (t - .008) / (seconds - .008))
        else:
            g = 0
        frames += struct.pack("<h", int(32767 * gain * g * wave_at(kind, hz * t)))
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))
    return out.getvalue()


def player():
    for name in ("pw-play", "paplay", "aplay"):
        if shutil.which(name):
            return [name] if name != "aplay" else [name, "-q"]
    sys.exit("No audio player found (pw-play, paplay or aplay).")


async def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", default="http://localhost:8799")
    parser.add_argument("--repeat", type=int, default=3, help="plays of each tone (default 3)")
    parser.add_argument("--gap", type=float, default=1.2, help="seconds between plays (default 1.2)")
    parser.add_argument("--gain", type=float, default=.25, help="tone level, 0-1 (the console at full volume: 0.25)")
    parser.add_argument("--player", help="command that plays a WAV file (default: pw-play, paplay or aplay)")
    args = parser.parse_args()
    play = args.player.split() if args.player else player()

    knocks = []
    async with aiohttp.ClientSession() as http, http.ws_connect(args.url.rstrip("/") + "/ws") as ws:
        state = await ws.receive_json()
        level = (state.get("settings") or {}).get("knock")
        print(f"knock setting: {level}; player: {' '.join(play)}; gain {args.gain}")
        if level in (None, "off"):
            print("Knock input is off: switch it on in Calibration first.")

        async def listen():
            async for message in ws:
                if message.type == aiohttp.WSMsgType.TEXT:
                    event = message.json()
                    if event.get("type") == "knock":
                        knocks.append((time.monotonic(), event))
        listener = asyncio.create_task(listen())

        slots = [t for t in TONES for _ in range(args.repeat)] + [None] * (args.repeat * 4)  # None: silence
        starts = []
        with tempfile.TemporaryDirectory() as folder:
            files = {}
            for tone in TONES:
                path = f"{folder}/{tone[0]}-{tone[1]}-{tone[2]}.wav"
                with open(path, "wb") as f:
                    f.write(tone_wav(*tone, args.gain))
                files[tone] = path
            for index, tone in enumerate(slots):
                starts.append((time.monotonic(), tone))
                if tone:
                    await (await asyncio.create_subprocess_exec(*play, files[tone], stdout=subprocess.DEVNULL,
                                                                stderr=subprocess.DEVNULL)).wait()
                await asyncio.sleep(max(0, starts[-1][0] + args.gap - time.monotonic()))
                print(f"\r{index + 1}/{len(slots)}", end="", flush=True)
        await asyncio.sleep(WINDOW)
        listener.cancel()
        system = await (await http.get(args.url.rstrip("/") + "/api/system")).json()

    print()
    rows = {}
    for at, event in knocks:
        slot = max((s for s in starts if s[0] <= at), default=None, key=lambda s: s[0])
        tone = slot[1] if slot and at - slot[0] <= WINDOW else "other"
        rows.setdefault(tone, []).append(event)
    print(f"{'sound':<24}{'plays':>6}{'taps':>6}  peaks / hf")
    for tone in TONES + [None, "other"]:
        plays = sum(1 for _, t in starts if t == tone) if tone != "other" else "-"
        name = "silence" if tone is None else tone if tone == "other" else f"{tone[0]} Hz {tone[1]}s {tone[2]}"
        got = rows.get(tone, [])
        detail = ", ".join(f"{e.get('peak')}/{e.get('hf', '?')}" for e in got)
        print(f"{name:<24}{plays:>6}{len(got):>6}  {detail}")
    node = system.get("node") or {}
    print(f"node knock counters: {node.get('knock')}; dropped as the button: {node.get('knockGuarded')}")


if __name__ == "__main__":
    asyncio.run(main())
