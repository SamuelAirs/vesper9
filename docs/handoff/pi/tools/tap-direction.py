#!/usr/bin/env python3
"""Pi-only: can two microphones tell where on the box a tap landed? (second node, firmware 0.2.0)

Usage: tap-direction.py CHECKOUT PORT PHASE [PHASE ...] [--threshold N] [--json FILE]
A phase is LAMP:SECONDS:LABEL with LAMP 1 to 4 (lit blue for the phase), e.g. 1:20:left 4:20:right 2:20:top
The node streams both microphones; this script finds each tap in the stream and prints, per tap:
  peaks      highest sample of each microphone in the first 10 ms
  level      right level relative to left over the first 10 ms, in dB (positive: louder on the right)
  lag        where the two microphones' signals line up best, in samples of 1/16000 s
             (positive: the right microphone heard it later), from the cross-correlation
  onset      the same from when each channel first reached a quarter of its own peak
Then a summary per phase and how well simple rules separate the phases. The audio is analysed in
memory and discarded: nothing but these numbers is printed or written. Stop vesper.service first.
"""
import argparse
import importlib.util
import json
import math
import pathlib
import struct
import sys
import time
import wave

import numpy

parser = argparse.ArgumentParser()
parser.add_argument("checkout")
parser.add_argument("port")
parser.add_argument("phases", nargs="+")
parser.add_argument("--threshold", type=int, default=2500, help="peak either microphone must reach (default 2500)")
parser.add_argument("--json", help="write the per-tap numbers here")
parser.add_argument("--clips", help="also save each detection as a two-channel 16 kHz WAV, 50 ms before to 150 ms after its onset,"
                                    " in CLIPS/<phase label>/NN.wav (short clips around taps only; nothing else is kept)")
args = parser.parse_args()

spec = importlib.util.spec_from_file_location("node_probe", pathlib.Path(args.checkout) / "scripts" / "node-probe.py")
node_probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(node_probe)
Kind = node_probe.Kind
RATE, PRE, BODY, SPAN, REFRACTORY = 16000, 64, 160, 24, 2400  # samples: 4 ms before, 10 ms body, +-1.5 ms lag, 150 ms apart


def taps_in(left, right, threshold):
    """Find taps in two aligned channels; return one dict of features per tap."""
    a, b = numpy.asarray(left, dtype=float), numpy.asarray(right, dtype=float)
    loud = numpy.maximum(numpy.abs(a), numpy.abs(b))
    # background: the median level of each 20 ms block, held over the block
    blocks = len(loud) // 320
    floor = numpy.repeat(numpy.median(loud[:blocks * 320].reshape(blocks, 320), axis=1), 320) if blocks else numpy.zeros(0)
    found, at = [], PRE + SPAN
    end = min(len(floor), len(loud)) - (BODY + 640 + SPAN)
    while at < end:
        if loud[at] >= threshold and loud[at] >= 8 * max(16.0, floor[max(0, at - 640)]):
            body = slice(at, at + BODY)
            tail = slice(at + 640, at + 1440) if at + 1440 < len(loud) else slice(at + 640, len(loud))
            peak_l, peak_r = float(numpy.abs(a[body]).max()), float(numpy.abs(b[body]).max())
            rms_l, rms_r = float(numpy.sqrt((a[body] ** 2).mean())), float(numpy.sqrt((b[body] ** 2).mean()))
            sustained = loud[tail].mean() > 0.2 * loud[body].mean() if tail.stop > tail.start else False
            window = slice(at - PRE, at + BODY)
            x = a[window] - a[window].mean()
            scores = []
            for lag in range(-SPAN, SPAN + 1):
                y = b[at - PRE + lag:at + BODY + lag]
                scores.append(float((x * (y - y.mean())).sum()))
            best = int(numpy.argmax(scores))
            lag = float(best - SPAN)
            if 0 < best < len(scores) - 1:  # parabolic refinement around the peak
                y0, y1, y2 = scores[best - 1], scores[best], scores[best + 1]
                denominator = y0 - 2 * y1 + y2
                if denominator:
                    lag += 0.5 * (y0 - y2) / denominator
            norm = math.sqrt(float((x * x).sum()) * float(((b[window] - b[window].mean()) ** 2).sum())) or 1.0

            def first(channel, peak):
                reached = numpy.nonzero(numpy.abs(channel[at - PRE:at + BODY]) >= 0.25 * peak)[0]
                return int(reached[0]) if len(reached) else 0
            found.append({"at": at, "peak_l": round(peak_l), "peak_r": round(peak_r),
                          "level_db": round(20 * math.log10((rms_r or 1) / (rms_l or 1)), 1),
                          "lag": round(lag, 2), "corr": round(scores[best] / norm, 2),
                          "onset": first(b, peak_r) - first(a, peak_l), "sustained": bool(sustained)})
            at += REFRACTORY
        else:
            at += 1
    return found


def describe(values):
    values = sorted(values)
    if not values:
        return "none"
    q = lambda f: values[min(len(values) - 1, int(f * len(values)))]
    return f"median {q(.5):+.1f}  (10% {q(.1):+.1f}, 90% {q(.9):+.1f})"


probe = node_probe.Probe(args.port, 921600)
results = {}
try:
    probe.pump(1, show=False)
    status = probe.status or {}
    print("NODE", {k: status.get(k) for k in ("fw", "board", "lamps", "mics", "mic2")}, flush=True)
    if int(status.get("mics", 1)) != 2:
        sys.exit("this node reports one microphone")
    # Also run the node's own detector (medium threshold), so the run shows how many of the taps the node
    # itself reports and whether its KNOCK_CLIP messages (firmware with type 10) arrive.
    probe.command(Kind.KNOCK_SET, struct.pack("<H", 4000))
    for phase in args.phases:
        lamp, seconds, label = phase.split(":", 2)
        leds = bytearray(3 * int(status.get("lamps", 3)))
        leds[(int(lamp) - 1) * 3 + 2] = 255
        probe.stereo[0], probe.stereo[1] = node_probe.array.array("h"), node_probe.array.array("h")
        probe.audio_next = None
        gaps = probe.audio_gaps
        probe.command(Kind.LEDS, bytes(leds))
        probe.command(Kind.MIC, b"\x02")
        print(f"PHASE {label}: lamp {lamp}, {seconds} s, started {time.strftime('%H:%M:%S')}", flush=True)
        probe.pump(float(seconds), show=False)
        probe.command(Kind.MIC, b"\x00")
        probe.command(Kind.LEDS, bytes(len(leds)))
        left, right = probe.stereo
        taps = [t for t in taps_in(left, right, args.threshold)]
        results[label] = taps
        if args.clips:
            folder = pathlib.Path(args.clips) / label
            folder.mkdir(parents=True, exist_ok=True)
            a, b = numpy.asarray(left, dtype=numpy.int16), numpy.asarray(right, dtype=numpy.int16)
            for number, t in enumerate(taps, 1):
                start, end = max(0, t["at"] - 800), min(len(a), t["at"] + 2400)
                frames = numpy.empty((end - start) * 2, dtype=numpy.int16)
                frames[0::2], frames[1::2] = a[start:end], b[start:end]
                with wave.open(str(folder / f"{number:02d}.wav"), "wb") as out:
                    out.setnchannels(2); out.setsampwidth(2); out.setframerate(RATE); out.writeframes(frames.tobytes())
                t["clip"] = f"{label}/{number:02d}.wav"
                t["clip_onset_frame"] = t["at"] - start
        print(f"  {len(left)} frames, {probe.audio_gaps - gaps} missing, {len(taps)} taps"
              f" ({sum(t['sustained'] for t in taps)} of them lasting sounds)", flush=True)
        for t in taps:
            print(f"  TAP at {t['at'] / RATE:6.2f} s  peaks L {t['peak_l']:5d} R {t['peak_r']:5d}  level {t['level_db']:+5.1f} dB"
                  f"  lag {t['lag']:+6.2f}  onset {t['onset']:+3d}  corr {t['corr']:.2f}{'  (lasting)' if t['sustained'] else ''}", flush=True)
        probe.pump(1.0, show=False)
    probe.command(Kind.KNOCK_SET, b"\x00\x00")
    print("NODE PACKETS", {k: v for k, v in probe.counts.items() if k in ("KNOCK", "KNOCK_CLIP", "10")}, "knock counters", (probe.status or {}).get("knock"))
    print("FINAL", {k: (probe.status or {}).get(k) for k in ("fw", "audio_drops", "rx_crc", "mic2")}, "host crc errors", probe.decoder.errors)
finally:
    probe.close()

print("\nSUMMARY (taps that were not lasting sounds)")
clean = {label: [t for t in taps if not t["sustained"]] for label, taps in results.items()}
for label, taps in clean.items():
    print(f"  {label:12s} n {len(taps):3d}   level dB {describe([t['level_db'] for t in taps])}   lag {describe([t['lag'] for t in taps])}"
          f"   onset {describe([float(t['onset']) for t in taps])}")
labels = [label for label, taps in clean.items() if taps]
if len(labels) >= 2:
    # How separable are the phases with one number and fixed cut-offs between the phase medians?
    for feature in ("level_db", "lag", "onset"):
        medians = sorted((float(numpy.median([t[feature] for t in clean[label]])), label) for label in labels)
        cuts = [(medians[i][0] + medians[i + 1][0]) / 2 for i in range(len(medians) - 1)]
        right_count = total = 0
        for rank, (_, label) in enumerate(medians):
            low = cuts[rank - 1] if rank else -math.inf
            high = cuts[rank] if rank < len(cuts) else math.inf
            hits = sum(low <= t[feature] < high for t in clean[label])
            right_count += hits
            total += len(clean[label])
        print(f"  by {feature:8s}: order {' < '.join(label for _, label in medians)}; cut-offs {[round(c, 2) for c in cuts]};"
              f" {right_count} of {total} taps fall in their own band")
if args.json:
    pathlib.Path(args.json).write_text(json.dumps(results, indent=1))
