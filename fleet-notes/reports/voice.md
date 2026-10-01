# voice: two-pass dictation and voice control that covers the console

## 1. Outcome

Dictation now runs Vosk for the live text and re-transcribes each finished utterance with Parakeet TDT 110m (sherpa-onnx) for the final line, optional and fail safe. Voice commands grew from 21 to 200 generated phrases covering navigation, apps, timers, notes, lamps, sound and on-screen questions, each performed by the browser host or the service. Both parts are committed on the branch below; all verification commands pass. All speech numbers are public read speech or synthesised voices, not the owner's voice or microphone, and nothing was run on the device.

## 2. Details

### Part 1: dictation (commit a3342b1)

What changed
- `vesper/refine.py` (new): availability check (package and the four model files), `load()` returning a `Transcriber` (`transcribe(pcm16 bytes) -> text`, `close()`), two ORT threads.
- `vesper/speech.py`: second pass in `Speech`. Audio of the open utterance is held in a `bytearray` only while a second pass is possible (mode transcribe and state loading or ready). It is cut at a pause (live text unchanged 0.4 s) after 20 s and unconditionally at 30 s, and dropped when the line is final. One worker task finishes utterances in order, one dedicated thread runs inference (`REFINE_TIMEOUT_S` 10 s; a timed-out call's thread is abandoned and the next utterance gets a fresh one). More than 20 s of audio waiting means new utterances skip the pass. After 5 consecutive failures the pass switches itself off (state `failed`), dictation goes on with Vosk. Any exception, empty result or timeout means Vosk's text for that utterance. An emit failure of a final line (storage down) is treated exactly like one elsewhere: fault callback, microphone off.
- Lazy load: the model loads in a background task when transcription starts, so dictation starts at once; utterances that finish meanwhile wait (up to 60 s) with their Vosk text on screen. It stays loaded; after 15 idle minutes outside dictation it is released (`close()`, `gc`, `malloc_trim`): RSS 437 MB to 65 MB in an isolated test, three load/release cycles identical (`fleet/work/voice/release.py`). Reloads in about 3 s.
- Mode change, mute and stop: `set_mode` finishes Vosk's open utterance, queues its audio and waits (at most 15 s, then falls back to Vosk text for the rest) for every pending line before returning, so the last words are saved exactly once while the session is still open (`Console.set_mic` ends the session after `speech.set_mode("off")`).
- Browser contract (documented in `docs/PROTOCOL.md`): Vosk's final text is announced as `{"type":"speech","final":false,"provisional":true,"utt":N,...}` and stays on screen, then `{"final":true,"utt":N,"engine":"second-pass"|"vosk",...}` replaces it. Only `final:true` events are saved (`Console.speech_event` unchanged), once. Without a second pass finals look as before plus `engine:"vosk"`. `state.mic.recognizer` and a `recognizer` event give `{engine: "vosk"|"vosk+parakeet", refine: unavailable|idle|loading|ready|failed, detail}`.
- `Transcription` (web/apps/utilities.js) shows provisional lines, keeps each until the reload that contains its refined line has rendered (no flicker), is not disturbed by a refined line arriving while the next utterance is in progress, clears everything when the mode leaves transcribe. `status.js`: header reads `TRANSCRIBING / LOADING` while the model loads; Field Notes shows `RECOGNISER / VOSK LIVE + PARAKEET FINAL` (or `VOSK ONLY`, with the reason, when the package or model is missing).
- Install: `scripts/get-voice-model.py` fetches Vosk and, unless `--no-refine`, the Parakeet archive: pinned SHA-256 (`f628312e...fe9b`), discards on mismatch, extracts only the named regular files into a staging directory, skips when the four files exist. I did not run the download; logic is tested with a fake archive (traversal members, wrong hash, incomplete archive, already present). `pyproject.toml` extra `refine` (sherpa-onnx 1.13.8, numpy 2.5.3), `THIRD_PARTY.md` (CC-BY-4.0 attribution and hash), `docs/INSTALL.md`, `docs/OPERATOR.md`, `docs/PROTOCOL.md`.
- Server: `--refine-model` option (default: next to `--model`), status broadcast, state field.

Real run: `fleet/work/voice/e2e_vesper.py`, 3 sessions of 12 public LibriSpeech utterances (738 words) per condition with 0.4 to 2.0 s pauses, 20 ms chunks at real-time pace into `vesper.speech.Speech` with the real Vosk small and real Parakeet models. "Degraded" is the benchmark's stand-in for the quiet noisy node microphone (attenuated, 60-count noise). Public read speech, not the owner's voice.

| Condition | Recogniser | WER | Finals | CPU (core-s per audio s) | End of speech to final line, median |
| --- | --- | --- | --- | --- | --- |
| clean | Vosk only | 10.0 % (S58 D6 I10) | 40 | 0.17 | 0.61 s |
| clean | Vosk + second pass | 2.6 % (S16 D3 I0) | 40 | 0.31 | 1.24 s |
| degraded | Vosk only | 26.6 % (S146 D35 I15) | 46 | 0.22 | 0.59 s |
| degraded | Vosk + second pass | 6.1 % (S35 D9 I1) | 46 | 0.45 | 1.25 s |

- Delay the second pass adds (Vosk final to refined line): median 0.51 s clean, 0.54 s degraded; p90 0.88 / 0.91 s; max 1.02 / 1.22 s. Dropped audio chunks 0, worst feed lag 27 ms. Flush at stop: 0.2 s.
- Engines of the final lines: 40 of 40 and 45 of 46 second-pass; one degraded utterance fell back to Vosk text (empty or skipped, not investigated).
- Memory, fresh process: Vosk only 185 MB after load; with the second pass 440 MB after load, peak 715 MB while decoding (`e2e-after-close.json`). (937 MB appeared in the benchmark loop only because it ran after the Vosk-only runs in one process; do not quote it.) Model load 3.0 to 3.8 s in the background. Inference uses `num_threads=2` on one dedicated worker thread; the process's thread count does not grow while decoding (`threads.py`).
- Tests: `tests/test_dictation.py` (24: provisional then refined flow, single save through a real `Console`, exception / timeout / empty / repeated failure / load failure / not installed fallbacks, stop and mode switch awaiting pending passes, flush time limit, hard 30 s cut and pause cut, backlog skip, no audio kept after final, audit-hook proof that no file is opened for writing and nothing appears in the temp dir, lazy load, two threads, release after idle, status events), `tests/test_voice_model_script.py` (5), `tests/transcription.test.mjs` (5).

### Part 2: voice control (commit 281ea1e)

Files: `vesper/commands.py` (grammar generator, `resolve()`, vocabulary check), `vesper/speech.py` (grammar, word confidences, gate), `vesper/server.py` (result text for timer and mute), `web/engine/voice.js` (new, pure: what a command means in each context, answers, the Calibration list), `web/main.js` (`voice()`, `stepBack()`, `answerLamps()`), `web/apps/utilities.js` (Calibration VOICE COMMANDS becomes four pages with every command and every app's voice name), docs.

How the host acts (all through its own functions, never a simulated press): next = `advance()`, back/previous = new `stepBack()` on the same `nav`, select/choose = `select()`, next sector = the dashboard sector button's own `run`, home/menu/resume/open = `home()`, `systemMenu()`, `closeMenu()`, `launch()`; timer cancel/pause/resume = the `timer` command (`remove`, `toggle`) on the most recently created timer; lamps, sound, volume = the `settings` command; start dictation = `setMic("transcribe")` then open Field Notes; timer creation and microphone off stay in the service as before. Dictation never executes commands: no grammar is built in transcribe mode and the new test feeds command phrases through a transcribing `Speech` and sees no `voice` event.

Contexts: inside a game next, back and select answer `NOT IN A GAME / OPEN THE MENU FIRST` and change nothing; next sector outside the dashboard, home on the dashboard, resume with no menu, pause with the menu open, pausing a paused timer, lamps already at full, a monitor tab changing settings, dictation not installed: each says why in the toast. A confirmation toast follows every command (`HEARD / computer next -> MOONRUNNER`); the cyan lamp sweep is unchanged. Answers: time, temperature in the Calibration unit, humidity with its comfort band, running timers, each as a toast and, only when the host owns the lamps, a 2.5 s lamp pattern (colour by temperature band, comfort band, or the nearest timer's meter) that is handed back afterwards; a stale reading is labelled and does not light the lamps.

Known design limit: "stop dictation" can only be heard while dictation is off, because the command grammar is deliberately inactive during transcription. It is in the list and says so; stopping dictation is the button (or the microphone menu).

Vocabulary: every word of the grammar was checked against the loaded model with `vosk_model_find_word`; none unknown. All 24 catalog aliases (including rhythm, swing, lander, breakout, snake, launcher, lamp, metronome, moon, sound, dice, system) are known words; no alias needed changing. The check is a test (skipped without the model).

Grammar: 200 phrases, 6,951 bytes of JSON. Recogniser creation 1.7 ms median (0.65 ms for the old 21-phrase grammar), 2.0 ms including the first chunk. Recognition RTF 0.048 over 66 minutes of audio (about 21 times real time). Time from end of speech to the `voice` event: median 0.74 s clean, 0.64 s degraded (p90 0.85 / 0.79), measured with silence continuing after the phrase as in real use.

Accuracy: `fleet/work/voice/eval_commands.py`. Recall clips: the benchmark's 252 (21 phrases, 12 synthetic voices) plus 666 new (179 phrases, 3 to 6 Piper voices from the benchmark's multi-speaker model, made the same way as `build_commands_audio.py`), clean and degraded, 918 each. A clip counts as correct if its action equals the expected action. Synthetic speech.

| Group (clips per condition) | clean correct | degraded correct | degraded wrong | degraded not recognised |
| --- | --- | --- | --- | --- |
| navigation and microphone off (96) | 100 % | 99.0 % | 1.0 % | 0 |
| open app (216) | 100 % | 97.7 % | 0 | 2.3 % |
| timer N minutes or seconds (504) | 99.4 % | 94.2 % | 0.8 % | 5.0 % |
| cancel, pause, resume timer (24) | 100 % | 100 % | 0 | 0 |
| dictation start and stop (12) | 100 % | 100 % | 0 | 0 |
| lamps, sound, volume (48) | 100 % | 95.8 % | 0 | 4.2 % |
| questions (18) | 100 % | 100 % | 0 | 0 |
| all (918) | 99.7 % | 96.0 % | 0.4 % | 3.6 % |

(The table is at the shipped confidence gate 0.7. With no gate: 99.8 % clean and 98.4 % degraded, 1.4 % degraded wrong.)

False triggers (command grammar, exact phrase or its unit-number forgiveness, as the product acts):
- 33.2 minutes of ordinary public speech (LibriSpeech, its negatives, FLEURS): 0 triggers clean. Its degraded copy: 1, `computer resume` at confidence 1.0, from a FLEURS sentence about the articles of confederation whose last words decoded as that phrase. Confidence cannot remove it.
- 432 hard-negative clips (216 per condition, 36 sentences such as "computer science is fun", "stop the music and go home", "the next sector is ready", 6 voices each): no gate 0 clean and 3 degraded triggers (`computer sound on` 0.68, `computer home` 0.62, `computer resume timer` 0.41), gate 0.7: 0 and 0.

Tuning: `COMMAND_MIN_CONF` = 0.7 (the least certain word of a command must score at least that), chosen from the trade-off table in `commands-full2.json`: it removes all three hard-negative triggers for 0.1 points of clean recall and 2.4 points of degraded recall; 0.8 and above cost more with no further gain. Also tuned from data: recall was first measured with only the benchmark's 1 s of trailing silence and looked 2 points worse, because phrases then finalised only on flush, which the product never uses and does not need (silence continues); the final run adds 3 s of silence. `resolve()` accepts a timer phrase whose unit has the wrong number ("thirty one minute"), which recovered about 2 points of degraded recall; it cannot change what was meant.

Weak spot: look-alike number words. Wrong durations in the 504 timer clips: 1 clean, 4 degraded at the gate (nineteen/ninety, fifteen/fifty, forty/four, seventy/seven, eighty two/eighteen), some with confidence 1.0, so the gate cannot catch them. Mitigation shipped: the toast states the timer started (`TIMER STARTED / 19:00`) and `computer cancel timer` removes it.

Tests: `tests/test_commands.py` (17: prefix, closed action set, every alias, every minute 1 to 120, word check, help list equals grammar via node, OPERATOR.md lists every non-generated phrase, grammar and confidence handling, dictation has no grammar), `tests/voice.test.mjs` (13), `tests/voice-host.cjs` (37 browser checks against a simulated service: every command class, refusals, settings and timers really changing on the service, monitor tab).

Complete command list (every phrase starts with "computer"):

| Group | Phrases | Action |
| --- | --- | --- |
| Move and choose (6) | next; back; previous; select; choose; next sector | highlight forward, back, back, choose, choose, dashboard sector |
| Place (5) | home; menu; pause; resume; microphone off | dashboard; system menu; system menu; close menu; microphone off |
| Apps (24) | open orbit, runner, drift, echo, lights, glyphs, rhythm, swing, lander, breakout, snake, launcher, morse, timer, notes, environment, diagnostics, settings, lamp, metronome, moon, sound, dice, system | launch the app |
| Timers (151) | timer N minute(s) for N = one ... one hundred twenty (101 to 120 also as "one hundred and ..."); timer ten / fifteen / twenty / thirty / forty five / ninety seconds; timer one hour; timer two hours; cancel timer; pause timer; resume timer | create a timer; remove / pause / restart the most recent timer |
| Notes (2) | start dictation; stop dictation | open Field Notes and transcribe; explanation only (see design limit) |
| Lamps, sound (8) | lamps up; lamps down; lamps off; lamps on; sound on; sound off; volume up; volume down | settings one step, off, on, or back to medium |
| Questions (4) | what time is it; temperature; humidity; show timers | toast plus lamp answer |

## 3. Verification

Run from the worktree root with the rules' environment:
- `python -m unittest discover -s tests -p 'test_*.py'`: Ran 177 tests, OK (about 55 s on this hot Pi).
- `node --test tests/*.test.mjs`: 480 tests, 480 pass, 0 fail.
- `python3 scripts/build-catalog.py --check`: exit 0.
- `python3 scripts/build-demo.py`, then `node tests/browser-smoke.cjs`: `"passed":true,"appsExercised":24,"pageErrors":[]`; `node tests/extension-smoke.cjs`: `"passed":true`; `node tests/host-browser.cjs`: exit 0, 12 PASS, 0 FAIL; and my `node tests/voice-host.cjs`: ALL 37 PASSED.
- Real audio: `fleet/work/voice/e2e.json` / `e2e.log` (Part 1), `commands-full2.json` / `.log` (Part 2). Screenshots I opened: `fleet/work/voice/shots/voice-page-1.png`, `voice-page-3.png`, `field-notes-provisional.png` (shows the `TRANSCRIBING / LOADING` chip and the recogniser line; the provisional text itself is not in that picture because my fake session id could not load, so it is covered by `tests/transcription.test.mjs` only).
- Pi temperature: it hovered at 70 to 76 C throughout, largely from the owner's kiosk browser (not my runs); I ran one heavy job at a time and used `nice` for the long command evaluation, which peaked at 76 C; the other runs stayed below 75 C. No processes of mine are left running (a headless browser and server on another port belong to another agent).

## 4. Not done / uncertain

- Every accuracy number is public read speech (LibriSpeech, FLEURS) or Piper-synthesised commands, through simulated microphone degradation. Nothing is measured with the owner's voice, room or INMP441, and nothing ran on the node or the live service (not restarted; the new code needs a restart to take effect).
- `scripts/install-pi.sh` (not in my scope) installs `.[speech]` and runs `get-voice-model.py`, which now also fetches the Parakeet model, but does not install the `refine` extra, so the second pass stays `VOSK ONLY` on a fresh install until `pip install -e '.[speech,refine]'`. One-word fix for the owner of that file. The production venv already has both packages and the model.
- `RELEASE-MANIFEST.json` hashes of changed files are stale until `scripts/package-release.py` regenerates them.
- I extended the closed action set in the existing `VoiceTests.test_allowlist_requires_prefix_and_has_no_shell` (`tests/test_runtime.py`) to the new action names in the same commit as the cause; it still forbids anything outside a fixed set, and the prefix checks are untouched.
- The download in `get-voice-model.py` was not run (instructed); the pinned hash comes from the audit's manifest.
- `state.mic.recognizer` is computed at start-up and refreshed whenever transcription starts, so a model installed while the service runs shows `VOSK ONLY` until the next transcription start.
- Lamp answers use the host's pattern effect; checked only in the simulator (no lamps). `start dictation` by voice is covered by the pure plan test, not by a browser test (it needs a microphone grant).
- Not investigated: one degraded utterance in the real run fell back to Vosk text; spoken "one hundred ten" and "one hundred and ten" are both in the grammar, other forms such as "a hundred" are not.
- Wrong timer numbers (nineteen/ninety class) remain about 0.2 to 0.8 % of timer commands in the synthetic test; a live user would see the confirmation toast and can cancel.

## 5. Branch

`worktree-agent-ad94844df9a9f2186`, last commit `281ea1e` ("Voice control that covers the console"); Part 1 is `a3342b1`.
