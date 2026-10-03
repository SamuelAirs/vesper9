"""Optional calibrated left/right case taps (docs/PROTOCOL.md, KNOCK_CLIP).

A two-microphone node sends, after each KNOCK, the first 11 ms of the tap from both microphones on
one clock. Three numbers are measured from it, as in the Pi's labelled session of 2026-10-02
(fleet-notes/reports/knock-input.md; that session tapped the top, not the back): the level difference, the cross-correlation lag and the
difference in onset between the right and the left microphone. No fixed rule separates the spots
on a real case, and every node and tapping style differs, so the side is decided by the nearest
labelled taps of this node's own calibration (Calibration > TAP DIRECTION). Generic mode always
omits direction. Sides mode needs six usable left and six right examples and four of five agreeing
neighbours; otherwise no side is given. Historical back examples remain saved but are not trained.
"""
import math
import time

SIDES = ("back", "left", "right")  # Historical labels are retained for provenance.
TARGETS = ("left", "right")        # Optional direction mode never trains a back classifier.
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

    def __init__(self, taps, k=K, min_votes=MIN_VOTES, sides=SIDES):
        self.taps = []
        for tap in taps:
            if not isinstance(tap, dict) or tap.get("side") not in sides:
                continue
            try:
                vector = _vector(tap)
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
            if all(math.isfinite(v) for v in vector):
                self.taps.append((tap["side"], vector))
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
        self.mode = "generic"
        self.label = None          # the side being labelled now, or None
        self.pending = {s: [] for s in TARGETS}
        self.load()

    def load(self):
        saved = self.store.get("tapDirection", None) or {}
        self.saved = saved if isinstance(saved, dict) and isinstance(saved.get("taps"), list) else {}
        classifier = Classifier(self.saved.get("taps", []), sides=TARGETS, min_votes=4)
        self.ready = all(sum(side == s for side, _ in classifier.taps) >= MIN_TAPS for s in TARGETS)
        self.classifier = classifier if self.ready else None
        self.check = classifier.leave_one_out() if self.ready else None

    def annotate(self, event):
        """Measure a knock's clip (removed from the event) and add `side`, `sideVotes`, `tap`."""
        event.pop("side", None)
        event.pop("sideVotes", None)
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
        elif self.mode == "sides" and self.classifier:
            side, votes = self.classifier.classify(f)
            event["sideVotes"] = votes
            if side:
                event["side"] = side
        return event

    def status(self):
        return {"mode": self.mode, "enabled": self.mode == "sides" and self.ready,
                "ready": self.ready, "calibrated": self.ready, "targets": list(TARGETS), "minimumTaps": MIN_TAPS,
                "label": self.label,
                "pending": {s: len(t) for s, t in self.pending.items()},
                "saved": {s: sum(1 for t in self.saved.get("taps", []) if isinstance(t, dict) and t.get("side") == s) for s in SIDES},
                "check": self.check,
                "savedAt": self.saved.get("savedAt")}

    def command(self, op, side=None):
        if op == "label":
            if side is not None and side not in TARGETS:
                raise ValueError("Tap calibration targets are left and right")
            self.label = side
        elif op == "start":
            if side is not None and side not in TARGETS:
                raise ValueError("Tap calibration targets are left and right")
            self.pending = {s: [] for s in TARGETS}
            self.label = side
        elif op == "cancel":
            self.label = None
            self.pending = {s: [] for s in TARGETS}
        elif op == "save":
            if any(len(self.pending[s]) < MIN_TAPS for s in TARGETS):
                self.label = None
                raise ValueError(f"Left and right each need at least {MIN_TAPS} taps")
            taps = [t for s in TARGETS for t in self.pending[s]]
            check = Classifier(taps, sides=TARGETS, min_votes=4).leave_one_out()
            legacy = [t for t in self.saved.get("taps", []) if isinstance(t, dict) and t.get("side") == "back"]
            self.store.put("tapDirection", {"version": 2, "taps": legacy + taps, "check": check, "savedAt": round(time.time())})
            self.label = None
            self.pending = {s: [] for s in TARGETS}
            self.load()
        elif op == "clear":
            self.store.put("tapDirection", {})
            self.label = None
            self.pending = {s: [] for s in TARGETS}
            self.load()
        elif op != "status":
            raise ValueError("Unknown tap direction operation")
        return self.status()
