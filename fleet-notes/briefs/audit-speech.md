<!-- launch: subagent_type=general-purpose model=sonnet isolation=worktree description='Benchmark local speech engines' -->
Your agent name is `audit-speech`. Before anything else, read `/home/sam/VESPER-9-v0.2.0-Claude/fleet/RULES.md` and follow it exactly; it explains the project, the environment on this Raspberry Pi, what you must never touch, and the report format. This brief grants you two specific exceptions to those rules, described under "Your sandbox" below.

## Why this task exists

VESPER-9 is a one-button console on a Raspberry Pi 5 (4 × Cortex-A76, 8 GB RAM, no GPU acceleration for inference). Its ESP32 node streams microphone audio (INMP441, 16 kHz, mono, 16-bit, 20 ms chunks) to a Python service that does local speech recognition with Vosk and the small English model `vosk-model-small-en-us-0.15`. It has two uses: free dictation into a notes app ("Field Notes"), with live partial text, and a fixed list of spoken commands recognised with a grammar-constrained Vosk recogniser (see `vesper/speech.py` in your checkout, about 140 lines; read it first).

The owner tried dictation tonight and said it "works pretty well, but it was a little inaccurate". Commands have not been complained about. Your job is to find out, by measurement on this Pi, what would make dictation clearly more accurate while staying fully local and usable in real time next to a 60 fps browser game. A later agent will implement whatever you recommend, so your recommendation must be backed by numbers and come with a working prototype.

Hard constraints from the project: recognition stays local (no cloud, no paid service, no API keys), no general-purpose language model, nothing that needs a GPU, and normal operation must not store raw audio.

## Your sandbox (exceptions to the rules)

- Work in `/home/sam/VESPER-9-v0.2.0-Claude/fleet/speech-bench/`. Create your own Python virtual environment there (`python3 -m venv`; the system Python is 3.13 on aarch64, so check that wheels exist before committing to a package) and `pip install` into that environment only. You may download speech models and public test audio from their official sources (alphacephei.com for Vosk, Hugging Face, GitHub releases, openslr.org) into that directory. Stay under about 8 GB of disk in total and record every model's URL, size, licence and SHA-256.
- You may use web search and fetch pages to check what currently exists and how to run it.
- If an install or download is refused by a permission check, do not try to get around it; note it in the report and carry on with what you have.

## Test audio

1. **The owner's own voice through the real microphone, if present:** look in `/home/sam/VESPER-9-v0.2.0-Claude/fleet/voice-sample/` for WAV files with matching `.txt` reference transcripts (for example `dictation.wav` + `dictation.txt`, `commands.wav` + `commands.txt`). If they exist they are your primary benchmark. Check again just before your final measurements, since they may be added while you work. Treat them as private: read them in place, never copy them elsewhere, never upload them, never quote more than a few words of them in your report.
2. **Public audio:** a few minutes of read English with reference text (LibriSpeech dev/test-clean utterances are fine). Because the real microphone is quiet (speech sits far below full scale; the noise floor is around 50–75 counts RMS), also produce a degraded copy: attenuate the speech so it peaks around −25 to −30 dBFS and add low-level noise at about that floor, and benchmark both the clean and degraded versions. That degraded set is the closest stand-in for the real device if the owner's sample is absent.

## What to evaluate

Measure, at minimum, the current set-up as the baseline, and then the options you judge most promising. Candidates to consider (you are not limited to these, and you should check what is current rather than trusting this list):

- The same small Vosk model with the input level normalised first (a simple automatic gain so speech sits around −20 dBFS). This is nearly free, so measure it first.
- Larger Vosk models (for example `vosk-model-en-us-0.22-lgraph`, the daanzu models, and the full `vosk-model-en-us-0.22` if it fits in memory and time).
- A two-pass design: Vosk keeps producing the live partial text, and each finished utterance is re-transcribed by a more accurate non-streaming model that replaces the final line. Candidates for the second pass include faster-whisper (CTranslate2, int8; tiny.en, base.en, small.en), whisper.cpp, Moonshine, and models runnable through sherpa-onnx (streaming zipformer, Parakeet-class models).
- A better fully streaming recogniser if one clearly beats Vosk small at real-time speed on this CPU.

For each configuration report:

- **Word error rate** on each test set (normalise case and punctuation consistently, and say how you treated numbers and contractions).
- **Speed:** real-time factor (processing time ÷ audio duration) limited to 2 threads, since the game needs the other cores. For streaming engines, time from audio start to first partial and from end of speech to final text. For second-pass engines, the delay between the end of an utterance and the corrected line.
- **Memory:** peak resident memory, and model load time from a cold start.
- **Commands:** with the grammar from `vesper/speech.py` (`COMMANDS`), the fraction of command phrases recognised correctly, and how many false command triggers occur when ordinary dictation speech is fed to the command recogniser. If per-word confidence can cut false triggers, measure the trade-off.

Run benchmarks one at a time; other agents are using this Pi's CPU, so repeat any timing that looks noisy and say how variable it was.

## What to deliver

1. A benchmark harness in `fleet/speech-bench/` that someone else can re-run with one command, and a results file (`results.json` or CSV) with every number in the report.
2. A **prototype** in `fleet/speech-bench/prototype/`: a module with the same shape as the `Speech` class in `vesper/speech.py` (PCM chunks in through `feed`, `partial` and `final` events out through an async `emit`, modes `off` / `commands` / `transcribe`, bounded queue, inference off the event loop) implementing your recommended design, plus a script that streams a WAV file through it in 20 ms chunks at real-time pace and prints the events with timestamps. It must run in your environment as-is.
3. The report at `/home/sam/VESPER-9-v0.2.0-Claude/fleet/reports/audit-speech.md` in the format from the rules: a results table, your recommendation for (a) live partial text, (b) final text, (c) commands, the exact dependency versions and model files needed, total added disk and memory, expected load on the Pi during a game, the licences, and the risks. If nothing beats the current set-up by a margin worth the cost, say so plainly; that is a valid result.

Do not change any file in your git checkout; everything you produce lives under `fleet/`. Prioritise: baseline and level normalisation first, then the two or three strongest candidates, then the prototype. A solid result on three configurations is better than a shallow one on eight.

Your final message to me should be a summary under 250 words: the baseline numbers, the best configuration and its numbers, what you recommend, what it costs, and the report path.
