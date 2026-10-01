"""Optional real Vosk check: python tests/speech-smoke.py /path/to/16k-mono.wav.

Requires the speech extra and downloaded model. This tests recognition and
session persistence using a recording, not the physical microphone.
"""
import argparse
import asyncio
import sys
import tempfile
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vesper.server import Console


async def check(wav_path):
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory() as data:
        console = Console(argparse.Namespace(simulate=True, data=data, model=str(root / "models/vosk-model-small-en-us-0.15")))
        try:
            await console.set_mic("transcribe")
            session = console.session
            with wave.open(str(wav_path), "rb") as recording:
                assert (recording.getframerate(), recording.getnchannels(), recording.getsampwidth()) == (16000, 1, 2)
                while pcm := recording.readframes(320):
                    while console.speech.queue.qsize() >= 8:
                        await asyncio.sleep(.01)
                    await console.event({"type": "audio", "pcm": pcm})
            while not console.speech.queue.empty():
                await asyncio.sleep(.01)
            await console.set_mic("off")
            lines = console.store.transcript(session)
            assert lines, "No speech was recognized in the recording"
            assert console.mode == "off" and not console.device.mic
            assert console.store.sessions()[0]["ended"] is not None
            assert console.speech.dropped == 0
            print("Recognized and saved:", " / ".join(row["text"] for row in lines))
            await console.set_mic("commands")
            assert console.mode == "commands"
            await console.set_mic("off")
            print("PASS: real recognition, saved session, command grammar, capture off, no dropped chunks")
        finally:
            await console.speech.close()
            await console.device.close()
            console.store.close()


if __name__ == "__main__":
    asyncio.run(check(Path(sys.argv[1])))
