"""Optional second recognition pass: a finished utterance is re-transcribed by a more accurate,
non-streaming model (NVIDIA Parakeet TDT 110m through sherpa-onnx). Nothing here is required:
`availability()` says why the pass cannot run, and Speech then keeps Vosk's own text."""
import importlib.util
from pathlib import Path

NAME = 'sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8'
FILES = ('encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt')
SAMPLE_RATE = 16000


def default_path(vosk_path):
    """The model sits next to the Vosk model in models/."""
    return Path(vosk_path).expanduser().parent / NAME


def availability(path):
    """None when the second pass can be loaded, otherwise a short reason."""
    if importlib.util.find_spec('sherpa_onnx') is None or importlib.util.find_spec('numpy') is None:
        return "Install the extra: .venv/bin/pip install -e '.[refine]'"
    missing = [name for name in FILES if not (Path(path) / name).is_file()]
    if missing:
        return 'Install the model with scripts/get-voice-model.py (missing ' + ', '.join(missing) + ')'
    return None


def load(path, threads=2):
    """Build the recogniser (a few seconds, blocking) and return `transcribe(pcm16_bytes) -> text`.
    The audio is only ever an in-memory array; it is neither written nor kept after the call."""
    import numpy as np
    import sherpa_onnx
    directory = Path(path)
    recogniser = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(directory / FILES[0]), decoder=str(directory / FILES[1]), joiner=str(directory / FILES[2]),
        tokens=str(directory / FILES[3]), num_threads=threads, model_type='nemo_transducer')

    def transcribe(pcm):
        samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        stream = recogniser.create_stream()
        stream.accept_waveform(SAMPLE_RATE, samples)
        recogniser.decode_stream(stream)
        return stream.result.text.strip()

    return transcribe
