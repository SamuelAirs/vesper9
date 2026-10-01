"""Level, spectrum and pitch analysis of the node microphone. Pure Python, no dependencies.

Nothing here recognises, stores or transmits audio: PCM goes in, a few dozen numbers come out.
`Analyzer.feed` is cheap and runs on the event loop; `analyse` does the FFT and must be called
off the loop (asyncio.to_thread). `SyntheticSource` is the clearly artificial signal used by the
simulator, which has no microphone.
"""
import cmath
import math
import random
import sys
from array import array
from operator import mul

RATE = 16000
WINDOW = 1024                  # samples analysed per frame (64 ms)
HOP = 1600                     # new samples per frame (100 ms): about ten frames a second
BANDS = 28
F_MIN, F_MAX = 60.0, 7000.0
FLOOR_DB = -120.0
PITCH_MIN, PITCH_MAX = 60.0, 800.0
PITCH_CONFIDENCE = 0.6
PITCH_GATE_DB = -60.0          # no pitch is reported below this RMS level

# Band i spans EDGES[i] .. EDGES[i + 1] Hz, logarithmically spaced.
EDGES = [round(F_MIN * (F_MAX / F_MIN) ** (i / BANDS), 1) for i in range(BANDS + 1)]


def to_db(power):
    return FLOOR_DB if power <= 1e-12 else max(FLOOR_DB, 10 * math.log10(power))


def _fft(values, size, bitrev, twiddles):
    """In-place iterative radix-2 FFT over a list of complex numbers."""
    for i, j in enumerate(bitrev):
        if i < j:
            values[i], values[j] = values[j], values[i]
    span = 1
    while span < size:
        step = size // (span * 2)
        for start in range(0, size, span * 2):
            for k in range(span):
                a = values[start + k]
                b = values[start + k + span] * twiddles[k * step]
                values[start + k] = a + b
                values[start + k + span] = a - b
        span *= 2


class _Tables:
    """Window, bit reversal and twiddles, built once."""
    def __init__(self):
        half = WINDOW // 2
        bits = half.bit_length() - 1
        self.half = half
        self.hann = [0.5 - 0.5 * math.cos(2 * math.pi * n / WINDOW) for n in range(WINDOW)]
        self.bitrev = [int(format(i, "0%db" % bits)[::-1], 2) for i in range(half)]
        self.twiddles = [cmath.exp(-2j * math.pi * k / half) for k in range(half // 2)]
        self.unpack = [cmath.exp(-2j * math.pi * k / WINDOW) for k in range(half + 1)]
        self.bin_hz = RATE / WINDOW
        # Which spectrum bins fall in each band, and (for bands narrower than a bin) where to interpolate.
        self.members, self.centres = [], []
        for i in range(BANDS):
            lo, hi = EDGES[i], EDGES[i + 1]
            self.members.append([k for k in range(1, half + 1) if lo <= k * self.bin_hz < hi])
            self.centres.append(math.sqrt(lo * hi) / self.bin_hz)


_tables = None


def tables():
    global _tables
    if _tables is None:
        _tables = _Tables()
    return _tables


def power_spectrum(samples):
    """Power per bin of a Hann-windowed WINDOW-sample frame of 16-bit samples, normalised so that a full-scale
    sine centred on a bin reads 1.0 (0 dBFS). Returns WINDOW/2 + 1 values."""
    t = tables()
    x = list(map(mul, samples, t.hann))
    z = [complex(x[2 * n], x[2 * n + 1]) for n in range(t.half)]
    _fft(z, t.half, t.bitrev, t.twiddles)
    scale = (WINDOW / 4 * 32768) ** 2  # samples are 16-bit integers
    out = []
    for k in range(t.half + 1):
        zk = z[k % t.half]
        zc = z[(t.half - k) % t.half].conjugate()
        even, odd = (zk + zc) / 2, (zk - zc) / 2j
        value = even + t.unpack[k] * odd
        out.append((value.real * value.real + value.imag * value.imag) / scale)
    return out


def band_levels(power):
    """Mean bin power per band in dBFS (rounded to 0.1 dB)."""
    t = tables()
    levels = []
    for members, centre in zip(t.members, t.centres):
        if members:
            level = sum(power[k] for k in members) / len(members)
        else:  # narrower than one bin: interpolate between the neighbours
            k = int(centre)
            frac = centre - k
            level = power[k] * (1 - frac) + power[min(k + 1, len(power) - 1)] * frac
        levels.append(round(to_db(level), 1))
    return levels


def estimate_pitch(samples):
    """Fundamental frequency by normalised autocorrelation (McLeod's method) on a 4x
    decimated copy. Returns (hz, confidence) or None when no clear pitch is present."""
    rate = RATE // 4
    n = len(samples) // 4
    d = [(samples[4 * i] + samples[4 * i + 1] + samples[4 * i + 2] + samples[4 * i + 3]) / 4 for i in range(n)]
    mean = sum(d) / n
    d = [v - mean for v in d]
    low, high = int(rate / PITCH_MAX), min(int(rate / PITCH_MIN) + 1, n // 2)
    squares = [0.0]
    for v in d:
        squares.append(squares[-1] + v * v)
    if squares[-1] <= 0:
        return None
    nsdf = [0.0] * (high + 2)
    for tau in range(1, high + 2):
        m = squares[n - tau] + (squares[n] - squares[tau])
        nsdf[tau] = 2 * sum(map(mul, d, d[tau:])) / m if m > 0 else 0.0
    peaks, tau = [], 1
    while tau <= high and nsdf[tau] > 0:  # skip the zero-lag lobe
        tau += 1
    while tau <= high:
        while tau <= high and nsdf[tau] <= 0:
            tau += 1
        best = 0
        while tau <= high and nsdf[tau] > 0:
            if tau >= low and (best == 0 or nsdf[tau] > nsdf[best]):
                best = tau
            tau += 1
        if best:
            peaks.append(best)
    if not peaks:
        return None
    top = max(nsdf[p] for p in peaks)
    chosen = next(p for p in peaks if nsdf[p] >= 0.9 * top)
    if nsdf[chosen] < PITCH_CONFIDENCE:
        return None
    a, b, c = nsdf[chosen - 1], nsdf[chosen], nsdf[chosen + 1]
    denominator = a - 2 * b + c
    shift = 0.5 * (a - c) / denominator if denominator else 0.0
    lag = chosen + max(-1.0, min(1.0, shift))
    return round(rate / lag, 1), round(min(1.0, nsdf[chosen]), 2)


class Analyzer:
    """Collects PCM chunks; every HOP samples it hands out a frame to analyse."""
    def __init__(self):
        self.window = array("h")
        self.sumsq = 0
        self.peak = 0
        self.count = 0
        self.sequence = 0

    def feed(self, pcm):
        samples = array("h", pcm)
        if sys.byteorder == "big":
            samples.byteswap()
        self.window.extend(samples)
        if len(self.window) > WINDOW:
            del self.window[:len(self.window) - WINDOW]
        self.sumsq += sum(map(mul, samples, samples))
        if samples:
            self.peak = max(self.peak, max(samples), -min(samples))
        self.count += len(samples)

    def take(self):
        """The next frame to analyse, or None if less than HOP new samples have arrived."""
        if self.count < HOP or len(self.window) < WINDOW:
            return None
        frame = (self.sequence, list(self.window), self.sumsq, self.peak, self.count)
        self.sequence += 1
        self.sumsq = self.peak = self.count = 0
        return frame


def analyse(frame):
    """Turn a frame from Analyzer.take() into the numbers of an `analysis` event (blocking, CPU only)."""
    sequence, samples, sumsq, peak, count = frame
    rms = math.sqrt(sumsq / count) / 32768
    rms_db = round(to_db(rms * rms), 1)
    peak_db = round(to_db((peak / 32768) ** 2), 1)
    bands = band_levels(power_spectrum(samples))
    pitch = estimate_pitch(samples) if rms_db > PITCH_GATE_DB else None
    return {"seq": sequence, "rmsDb": rms_db, "peakDb": peak_db, "bands": bands,
            "pitch": {"hz": pitch[0], "confidence": pitch[1]} if pitch else None}


class SyntheticSource:
    """Simulator microphone: a tone sweeping slowly and smoothly up and down between 110 and 700 Hz
    (a 24 s round trip) at about -23 dBFS RMS over faint noise (about -71 dBFS). Deliberately artificial; never real audio."""
    def __init__(self, seed=9):
        self.rng = random.Random(seed)
        self.phase = 0.0
        self.t = 0.0

    def chunk(self, samples=320):
        out = array("h")
        for _ in range(samples):
            # Triangle sweep of log-frequency, 24 s per round trip.
            position = abs((self.t / 24 % 1.0) * 2 - 1)
            frequency = 110 * (700 / 110) ** position
            self.phase += 2 * math.pi * frequency / RATE
            self.t += 1 / RATE
            out.append(int(3277 * math.sin(self.phase) + self.rng.uniform(-16, 16)))
        self.phase %= 2 * math.pi
        if sys.byteorder == "big":
            out.byteswap()
        return out.tobytes()
