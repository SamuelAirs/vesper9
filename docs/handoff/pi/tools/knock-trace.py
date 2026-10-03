#!/usr/bin/env python3
"""Pi-only knock qualification in lamp-cued phases (firmware 0.1.3, draft PR #4).

Usage: knock-trace.py KNOCK_TEST_CHECKOUT PORT PHASE [PHASE ...]
A phase is LAMP:THRESHOLD:SECONDS:LABEL with LAMP one of left, middle, right.
The lamp is lit for the phase; every KNOCK and BUTTON is printed, and so is every
change of the node's own counters (n sent, btn dropped at a button edge, long
judged sustained), which shows what happened to sounds that were not reported.
Stop vesper.service first. Records no audio; ends muted with the lamps off.
"""
import importlib.util
import pathlib
import struct
import sys
import time

checkout, port, phases = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3:]
spec = importlib.util.spec_from_file_location("node_probe", checkout / "scripts" / "node-probe.py")
node_probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(node_probe)
Kind = node_probe.Kind
LAMPS = {"left": 0, "middle": 3, "right": 6}


class Trace(node_probe.Probe):
    last = None

    def handle(self, packet, show):
        super().handle(packet, show)
        if packet.kind == Kind.STATUS:
            knock = (self.status or {}).get("knock")
            if knock != self.last:
                if show:
                    print(f"  counters {knock}", flush=True)
                self.last = knock


probe = Trace(port, 921600)
try:
    probe.pump(1, show=False)
    print("FIRMWARE", (probe.status or {}).get("fw"), flush=True)
    for phase in phases:
        lamp, threshold, seconds, label = phase.split(":", 3)
        leds = bytearray(9)
        leds[LAMPS[lamp] + 2] = 255  # blue
        probe.command(Kind.KNOCK_SET, struct.pack("<H", int(threshold)))
        probe.command(Kind.LEDS, bytes(leds))
        print(f"PHASE {label}: {lamp} lamp, threshold {threshold}, {seconds} s, started {time.strftime('%H:%M:%S')}", flush=True)
        probe.pump(float(seconds))
        print(f"END {label}: {(probe.status or {}).get('knock')}", flush=True)
    probe.command(Kind.LEDS, bytes(9))
    probe.command(Kind.KNOCK_SET, b"\x00\x00")
    print("FINAL", probe.status, "host crc errors", probe.decoder.errors, flush=True)
finally:
    probe.close()
