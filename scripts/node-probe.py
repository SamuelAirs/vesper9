#!/usr/bin/env python3
"""Talk protocol v1 to a real node without the console service.

Reports firmware/link, sensor, button edges, command ACKs and (optionally)
microphone level statistics. It records no audio and always ends muted with
the lights off. Stop vesper.service first: only one program can own the port.
"""
import argparse
import array
import json
import math
import pathlib
import struct
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import serial  # noqa: E402

from vesper.protocol import Decoder, Kind, encode  # noqa: E402


class Probe:
    def __init__(self, port, baud):
        self.link = serial.Serial()
        self.link.port, self.link.baudrate = port, baud
        self.link.timeout, self.link.write_timeout = .05, .5
        self.link.dtr = False
        self.link.rts = False
        self.link.open()
        self.decoder = Decoder()
        self.sequence = 0
        self.counts = {}
        self.status = None
        self.acks = {}
        self.audio_samples = 0
        self.audio_gaps = 0
        self.audio_next = None
        self.sum_squares = 0.0
        self.peak = 0
        self.last_ping = 0
        self.presses = 0

    def send(self, kind, payload=b""):
        sequence = self.sequence
        self.sequence = (sequence + 1) & 65535
        self.link.write(encode(kind, payload, sequence))
        return sequence

    def pump(self, seconds, show=True):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if time.monotonic() - self.last_ping > 1:
                self.send(Kind.PING)
                self.last_ping = time.monotonic()
            for packet in self.decoder.feed(self.link.read(4096)):
                self.handle(packet, show)

    def handle(self, packet, show):
        kind, p = packet.kind, packet.payload
        name = Kind(kind).name if kind in Kind._value2member_map_ else str(kind)
        self.counts[name] = self.counts.get(name, 0) + 1
        if kind in (Kind.HELLO, Kind.STATUS):
            self.status = json.loads(p)
            if kind == Kind.HELLO and show:
                print("HELLO", self.status, flush=True)
        elif kind == Kind.ACK and len(p) == 4:
            sequence, result, _ = struct.unpack("<HBB", p)
            self.acks[sequence] = result
        elif kind == Kind.BUTTON and len(p) == 9:
            at, pressed = struct.unpack("<QB", p)
            self.presses += bool(pressed)
            if show:
                print(f"BUTTON {'down' if pressed else 'up  '} at {at / 1e6:.3f} s", flush=True)
        elif kind == Kind.SENSOR and len(p) == 16 and show:
            _, t, rh = struct.unpack("<Qff", p)
            print(f"SENSOR {t:.2f} C  {rh:.2f} %RH", flush=True)
        elif kind == Kind.AUDIO and len(p) >= 6:
            index = struct.unpack_from("<I", p)[0]
            samples = array.array("h", p[4:])
            if self.audio_next is not None and index != self.audio_next:
                self.audio_gaps += (index - self.audio_next) & 0xFFFFFFFF
            self.audio_next = (index + len(samples)) & 0xFFFFFFFF
            self.audio_samples += len(samples)
            self.sum_squares += sum(s * s for s in samples)
            self.peak = max(self.peak, max(abs(s) for s in samples))

    def command(self, kind, payload=b"", wait=1.5):
        sequence = self.send(kind, payload)
        end = time.monotonic() + wait
        while time.monotonic() < end and sequence not in self.acks:
            self.pump(.02, show=False)
        return self.acks.get(sequence)

    def close(self):
        try:
            self.send(Kind.MIC, b"\x00")
            self.send(Kind.CANCEL)
            self.send(Kind.LEDS, bytes(9))
            self.link.flush()
        finally:
            self.link.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port")
    parser.add_argument("--baud", type=int, default=921600)
    parser.add_argument("--listen", type=float, default=8, help="seconds to report node events")
    parser.add_argument("--leds", action="store_true", help="step through all nine channels")
    parser.add_argument("--step", type=float, default=1.0, help="seconds per LED channel")
    parser.add_argument("--mic", type=float, default=0, help="seconds of microphone level statistics")
    parser.add_argument("--identify", action="store_true",
                        help="light one output at a time; each button press advances (maps real lamp/colour per GPIO)")
    args = parser.parse_args()
    probe = Probe(args.port, args.baud)
    try:
        probe.pump(args.listen)
        print("STATUS", probe.status)
        print("ACK lights-off:", probe.command(Kind.LEDS, bytes(9)))
        if args.leds:
            names = [f"{side} {color}" for side in ("LEFT", "MIDDLE", "RIGHT") for color in ("red", "green", "blue")]
            for index, name in enumerate(names):
                values = bytearray(9)
                values[index] = 255
                print(f"LED {index} {name}: ack {probe.command(Kind.LEDS, bytes(values))}", flush=True)
                probe.pump(args.step)
            for level in (255, 64, 8):
                print(f"ALL at {level}: ack {probe.command(Kind.LEDS, bytes([level] * 9))}", flush=True)
                probe.pump(args.step)
            probe.command(Kind.LEDS, bytes(9))
        if args.identify:
            for index in range(9):
                values = bytearray(9)
                values[index] = 255
                probe.command(Kind.LEDS, bytes(values))
                print(f"STEP {index + 1}: output index {index} lit; waiting for a button press", flush=True)
                seen, deadline = probe.presses, time.monotonic() + 600
                while probe.presses == seen and time.monotonic() < deadline:
                    probe.pump(.05, show=False)
                if probe.presses == seen:
                    print("TIMEOUT waiting for the button", flush=True)
                    break
                probe.pump(.4, show=False)
            probe.command(Kind.LEDS, bytes(9))
            print("IDENTIFY finished", flush=True)
        if args.mic:
            print("ACK mic on:", probe.command(Kind.MIC, b"\x01"))
            start = time.monotonic()
            probe.pump(args.mic, show=False)
            elapsed = time.monotonic() - start
            print("ACK mic off:", probe.command(Kind.MIC, b"\x00"))
            n = probe.audio_samples
            rms = math.sqrt(probe.sum_squares / n) if n else 0
            print(f"MIC {n} samples in {elapsed:.2f} s ({n / elapsed:.0f}/s), rms {rms:.0f}"
                  f" ({20 * math.log10(rms / 32768) if rms else -99:.1f} dBFS), peak {probe.peak}, missing {probe.audio_gaps}")
            probe.pump(1.5, show=False)
        print("FINAL", probe.status)
        print("packets", probe.counts, "host crc errors", probe.decoder.errors, "discarded bytes", probe.decoder.discarded)
    finally:
        probe.close()


if __name__ == "__main__":
    main()
