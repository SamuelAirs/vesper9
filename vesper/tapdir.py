"""Where on the case a tap landed: its back, left side or right side (docs/PROTOCOL.md, KNOCK_CLIP).

A two-microphone node sends, after each KNOCK, the first 11 ms of the tap from both microphones on
one clock. Three numbers are measured from it, as in the Pi's labelled session of 2026-10-02
(fleet-notes/reports/knock-input.md; that session tapped the top, not the back): the level difference, the cross-correlation lag and the
difference in onset between the right and the left microphone. No fixed rule separates the spots
on a real case, and every node and tapping style differs, so the side is decided by the nearest
labelled taps of this node's own calibration (Calibration > TAP DIRECTION). Without a calibration
no side is given. When the nearest taps disagree the side is left out ("unsure") rather than guessed.
"""
import math
import time

SIDES = ("back", "left", "right")  # back is the main tap; left and right are for games
WINDOW = 160                  # samples after the onset that are measured: 10 ms at 16 kHz
MAX_LAG = 24                  # cross-correlation search, samples either way
LAG_LIMIT = 8                 # a lag beyond this is a correlation peak at the edge: clamp it
ONSET_LIMIT = 12
FEATURES = ("level_db", "lag", "onset")
K = 5                         # nearest labelled taps consulted
MIN_VOTES = 3                 # of K that must agree, or the side is unsure
MIN_TAPS = 6                  # labelled taps a side needs before it can be saved
MAX_TAPS = 40                 # per side; later taps replace the oldest while labelling


def _rms(values):
    return math.sqrt(sum(v * v for v in values) / len(values)) if values else 0.0


def _onset(values):
    """First sample reaching a quarter of the channel's own peak."""
    peak = max((abs(v) for v in values), default=0)
    if not peak:
        return 0
    return next(i for i, v in enumerate(values) if abs(v) * 4 >= peak)


def features(left, right, pre):
    """Measure one tap. `left` and `right` are equal-length sample lists; the onset is at index `pre`.
    Returns {level_db, lag, onset, corr}; positive lag and onset mean the right microphone heard it later."""
    n = min(len(left), len(right))
    if n <= pre + 16:
        raise ValueError("Tap clip too short")
    a, b = pre, min(n, pre + WINDOW)
    wl, wr = left[a:b], right[a:b]
    rl, rr = _rms(wl), _rms(wr)
    level = 20 * math.log10(max(rr, 1) / max(rl, 1))
    energy = math.sqrt(sum(v * v for v in wl) * sum(v * v for v in wr)) or 1.0
    scores = {}
    for k in range(-MAX_LAG, MAX_LAG + 1):
        s = 0
        for i in range(a, b):
            j = i + k
            if 0 <= j < n:
                s += left[i] * right[j]
        scores[k] = s / energy
    best = max(scores, key=scores.get)
    lag = float(best)
    if -MAX_LAG < best < MAX_LAG:  # parabolic refinement between the neighbours
        y0, y1, y2 = scores[best - 1], scores[best], scores[best + 1]
        bend = y0 - 2 * y1 + y2
        if bend:
            lag += max(-0.5, min(0.5, 0.5 * (y0 - y2) / bend))
    return {"level_db": round(level, 2), "lag": round(lag, 2), "onset": _onset(right[:b]) - _onset(left[:b]),
            "corr": round(scores[best], 3)}


def _vector(f):
    return (float(f["level_db"]), max(-LAG_LIMIT, min(LAG_LIMIT, float(f["lag"]))),
            float(max(-ONSET_LIMIT, min(ONSET_LIMIT, f["onset"]))))


class Classifier:
    """k nearest labelled taps, each feature scaled by its spread across the calibration."""

    def __init__(self, taps, k=K, min_votes=MIN_VOTES):
        self.taps = [(t["side"], _vector(t)) for t in taps if t.get("side") in SIDES]
        self.k, self.min_votes = k, min_votes
        columns = list(zip(*(v for _, v in self.taps))) if self.taps else []
        self.scale = []
        for column in columns:
            mean = sum(column) / len(column)
            spread = math.sqrt(sum((x - mean) ** 2 for x in column) / len(column))
            self.scale.append(spread or 1.0)

    def classify(self, f, exclude=None):
        """(side or None, votes for it out of k)."""
        v = _vector(f)
        near = sorted((sum(((v[i] - u[i]) / self.scale[i]) ** 2 for i in range(len(v))), side)
                      for n, (side, u) in enumerate(self.taps) if n != exclude)[:self.k]
        if not near:
            return None, 0
        votes = {}
        for _, side in near:
            votes[side] = votes.get(side, 0) + 1
        side = max(votes, key=lambda s: (votes[s], -min(d for d, x in near if x == s)))
        return (side if votes[side] >= min(self.min_votes, len(near)) else None), votes[side]

    def leave_one_out(self):
        """How the calibration places its own taps when each is left out: per side, right / unsure / total."""
        result = {}
        for n, (side, _) in enumerate(self.taps):
            row = result.setdefault(side, {"right": 0, "wrong": 0, "unsure": 0, "total": 0})
            got, _ = self.classify(dict(zip(FEATURES, self.taps[n][1])), exclude=n)
            row["total"] += 1
            row["right" if got == side else "unsure" if got is None else "wrong"] += 1
        return result


class TapDirection:
    """The service's side of it: the saved calibration, labelling taps for a new one, and the side of
    each knock. `store` is the console's key-value store (key "tapDirection")."""

    def __init__(self, store):
        self.store = store
        self.label = None          # the side being labelled now, or None
        self.pending = {s: [] for s in SIDES}
        self.load()

    def load(self):
        saved = self.store.get("tapDirection", None) or {}
        self.saved = saved if isinstance(saved.get("taps"), list) else {}
        self.classifier = Classifier(self.saved["taps"]) if self.saved else None

    def annotate(self, event):
        """Measure a knock's clip (removed from the event) and add `side`, `sideVotes`, `tap`."""
        clip = event.pop("clip", None)
        if not clip:
            return event
        try:
            f = features(clip["left"], clip["right"], clip["pre"])
        except (KeyError, TypeError, ValueError):
            return event
        event["tap"] = f
        if self.label:
            taps = self.pending[self.label]
            taps.append({"side": self.label, **f, "at": round(time.time(), 1)})
            del taps[:-MAX_TAPS]
            event["labelled"] = self.label
        elif self.classifier:
            side, votes = self.classifier.classify(f)
            event["sideVotes"] = votes
            if side:
                event["side"] = side
        return event

    def status(self):
        return {"calibrated": bool(self.classifier), "label": self.label,
                "pending": {s: len(t) for s, t in self.pending.items()},
                "saved": {s: sum(1 for t in self.saved.get("taps", []) if t.get("side") == s) for s in SIDES},
                "check": self.saved.get("check"), "savedAt": self.saved.get("savedAt")}

    def command(self, op, side=None):
        if op == "label":
            if side is not None and side not in SIDES:
                raise ValueError("Unknown tap side")
            self.label = side
        elif op == "start":
            self.pending = {s: [] for s in SIDES}
            self.label = side if side in SIDES else None
        elif op == "cancel":
            self.label = None
            self.pending = {s: [] for s in SIDES}
        elif op == "save":
            sides = [s for s in SIDES if len(self.pending[s]) >= MIN_TAPS]  # a skipped side is left out
            if len(sides) < 2:
                self.label = None
                raise ValueError(f"At least two sides with {MIN_TAPS} taps each are needed")
            taps = [t for s in sides for t in self.pending[s]]
            check = Classifier(taps).leave_one_out()
            self.store.put("tapDirection", {"version": 1, "taps": taps, "check": check, "savedAt": round(time.time())})
            self.label = None
            self.pending = {s: [] for s in SIDES}
            self.load()
        elif op == "clear":
            self.store.put("tapDirection", {})
            self.label = None
            self.load()
        elif op != "status":
            raise ValueError("Unknown tap direction operation")
        return self.status()
