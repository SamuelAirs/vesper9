# audit-speech (written by the coordinator from the benchmark's result files; the agent was
# interrupted three times by restarts and never wrote its own report)

Sources: `fleet/speech-bench/results/table.md`, `extra-e2e.json`, `extra-e2e-0.6b.json`, `commands.json`,
`timing-idle.json`; models and provenance in `fleet/speech-bench/models/manifest.json`. Audio: a LibriSpeech
test-clean subset and FLEURS English, each clean and "degraded" (attenuated with added noise to imitate the
node's quiet microphone). Sam's own voice was not recorded, so no number here is from his voice or microphone.

## Dictation, word error rate (lower is better), measured on this Pi, 2 threads

| Configuration | Clean | Degraded | CPU real-time factor | Peak memory |
| --- | --- | --- | --- | --- |
| Vosk small (current) | 9.2 % | 21.6 % | 0.40 | 248 MB |
| Vosk small + level normalisation | 9.7 % | 23.9 % | 0.42 | 251 MB |
| Vosk lgraph (larger) | 7.1 % | 22.1 % | 1.36 (too slow) | 588 MB |
| Whisper base.en | 3.8 % | 8.1 % | 0.63 | 332 MB |
| Whisper small.en | 2.8 % | 3.8 % | 1.94 (too slow) | 657 MB |
| Parakeet TDT 110m (sherpa-onnx, int8) | 2.8 % | 3.8 % | 0.18 | 476 MB |
| Parakeet 0.6b v2 | 1.0 % | 1.5 % | 0.41 | 1100 MB |

End to end through the prototype (Vosk live text, each finished utterance re-transcribed):
current 12.2 % clean / 26.0 % degraded; two-pass with Parakeet 110m 3.1 % / 4.3 %, adding a median 0.45 s
(max about 1.1 s) before the corrected line appears, about 700 MB total memory, 0.34-0.39 CPU-seconds per
second of audio. Two-pass with Parakeet 0.6b: 1.8 % / 2.8 % but 1.5-2.3 GB memory and 1.2-1.9 s extra delay.
On FLEURS (harder, out of domain): Vosk small 21.1 % / 47.3 %; Parakeet 110m 12.0 % / 14.7 %.

## Commands

Grammar-constrained Vosk small: 252 command clips, 100 % correct clean, 99.2 % degraded (the rest rejected,
none wrong), zero false triggers in 26 minutes of ordinary speech and zero on 96 hard-negative clips, at
every confidence threshold tried.

## Decision

- Live partial text: keep Vosk small.
- Final text: re-transcribe each finished utterance with Parakeet TDT 110m via sherpa-onnx and replace the
  line. About five to six times fewer errors for under half a second of delay.
- Commands: keep the Vosk grammar; nothing to gain.
- Level normalisation: not worth doing (slightly worse).
- Dependencies added to the production environment: sherpa_onnx 1.13.8, numpy 2.5.3. Model:
  sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8 (126 MB on disk), from the k2-fsa
  sherpa-onnx asr-models release, archive SHA-256
  f628312e9fdf8686374cb01a69425c41732529d540860311f16f37cbc32cfe9b, licence CC-BY-4.0 (NVIDIA; attribution).
- Prototype: `fleet/speech-bench/prototype/speech.py` (same shape as `vesper/speech.py`).
- Risk: all numbers are from public read speech; real accuracy with Sam's voice and room is unmeasured.
