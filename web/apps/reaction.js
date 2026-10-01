import { C, text, circle, space, grid, banner } from "../engine/draw.js";
import { AppGuard } from "../engine/input.js";
import { LAMP, fill, only } from "../engine/lightshow.js";
import { recordRun, LampBus } from "./game-kit.js";

export function reactionSummary(values) {
  if (!values.length) return { count: 0, median: null, best: null, mean: null };
  const sorted = values.slice().sort((a,b) => a-b), n = sorted.length;
  return { count: n, median: Math.round((sorted[Math.floor((n-1)/2)] + sorted[Math.floor(n/2)]) / 2),
    best: sorted[0], mean: Math.round(sorted.reduce((a,b) => a+b, 0) / n) };
}
// ---------------------------------------------------------------------------------------------
// Light Trial. While a trial is armed and waiting the host writes no light at all: the node times
// the cue on the middle lamp itself. The lamps are used before arming and after the result only.
export function reactionGrade(ms) {
  if (ms < 200) return { word: "SHARP", color: LAMP.green };
  if (ms < 300) return { word: "GOOD", color: LAMP.cyan };
  if (ms < 450) return { word: "STEADY", color: LAMP.amber };
  return { word: "SLOW", color: LAMP.red };
}
export class LightTrial {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.guard = new AppGuard(this, ctx);
    this.phase = "title";
    this.trial = 0;
    this.cueAt = 0;
    this.screenCueAt = 0;
    this.results = [];
    this.buckets = { physical: [], keyboard: [], simulator: [] };
    this.metric = ctx.simulated() ? "simulator" : "physical";
    this.cueGeneration = 0;
    this.last = null;
    this.fresh = false;   // the last result beat the saved best
    this.t = 0;
    this.c.hint(
      "Wait for the MIDDLE light. Press once it turns green. Early presses fail.",
    );
  }
  falseStart() {
    this.phase = "early";
    this.c.tone(90, 0.18);
    // Left and right lamps alternate red twice; the middle lamp stays dark.
    this.lamps.flash(0.8, (e) => (Math.floor(e / 0.2) % 2 === 0 ? only(0, LAMP.red, 0.8) : only(2, LAMP.red, 0.8)));
  }
  down(event) {
    this.guard.mark();
    if (
      this.phase === "title" ||
      this.phase === "result" ||
      this.phase === "early" ||
      this.phase === "error"
    ) {
      this.lamps.clear();
      this.fresh = false;
      this.trial = this.c.rng.int(1, 0x7ffffffe);
      this.phase = "wait";
      this.cueAt = 0;
      this.last = null;
      this.c
        .command("reaction", {
          trial: this.trial,
          delay: this.c.rng.int(1300, 4200),
        })
        .catch((error) => {
          if (this.c.alive()) {
            this.phase = "error";
            this.c.hint(error.message);
          }
        });
      return;
    }
    if (this.phase === "wait") {
      this.c.command("cancel").catch(() => {});
      this.falseStart();
      return;
    }
    if (this.phase === "go") {
      const metric = event.source === "node" ? "physical" : event.source === "simulator" ? "simulator" : "keyboard";
      const nativeClock = metric !== "keyboard";
      if (nativeClock && (event.generation ?? 0) !== this.cueGeneration) { this.abort(); return; }
      const milliseconds = nativeClock
        ? (event.at_us - this.cueAt) / 1000
        : performance.now() - this.screenCueAt;
      if (milliseconds < 0) {
        this.falseStart();
        return;
      }
      this.last = Math.round(milliseconds);
      this.metric = metric;
      this.buckets[metric].push(this.last);
      this.buckets[metric] = this.buckets[metric].slice(-10);
      this.results = this.buckets[metric];
      this.phase = "result";
      this.c.tone(660, 0.15);
      // Scores use higher-is-better points, while the measured time stays visible.
      const points = Math.max(0, 1000 - this.last), saved = this.c.best?.(this.metric) ?? 0;
      this.fresh = points > saved && points > 0;
      this.c.score(points, this.metric);
      recordRun(this.c, { metric: this.metric, milliseconds: this.last, summary: reactionSummary(this.results), milestone: this.results.length });
      // The grade colour on all three lamps, then dark; a new best sweeps white across first.
      const grade = reactionGrade(this.last).color, sweep = this.fresh ? 0.36 : 0;
      this.lamps.flash(1.2 + sweep, (e) => {
        if (e < sweep) return only(Math.min(2, Math.floor(e / 0.12)), LAMP.white, 0.9);
        return fill(grade, e - sweep < 0.15 ? 0.8 : 0.33);
      });
    }
  }
  event(event) {
    if (event.type === "node_reset" || (event.type === "device" && !event.connected)) { this.abort(); return; }
    if (
      event.type === "cue" &&
      event.trial === this.trial &&
      this.phase === "wait"
    ) {
      this.cueAt = event.at_us;
      this.cueGeneration = event.generation ?? 0;
      this.screenCueAt = performance.now();
      this.phase = "go";
    }
  }
  // An interrupted trial (node reset or lost link): cancel it and go back to the title.
  abort() {
    this.c.command("cancel").catch(() => {});
    this.lamps.clear();
    if (this.phase === "wait" || this.phase === "go") this.phase = "title";
  }
  // An interruption clears the glow, but never while a trial is armed: the node owns the lamps then.
  up() { this.guard.release(); }
  cancel() {
    this.guard.rewind();
    if (this.phase !== "wait" && this.phase !== "go") this.lamps.clear();
  }
  pause() { this.guard.settle(); this.abort(); this.lamps.sleep(); }
  resume() { this.lamps.wake(); }
  dispose() {
    this.guard.settle();
    this.c.command("cancel").catch(() => {});
    this.lamps.sleep();
  }
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    // No host light while armed or waiting for the cue.
    if (this.phase !== "wait" && this.phase !== "go") this.lamps.frame(dt, null);
    const summary = reactionSummary(this.results);
    this.c.hud([
      ["LAST", this.last === null ? "—" : this.last + " ms"],
      [
        "MEAN / " + this.results.length,
        this.results.length
          ? Math.round(
              this.results.reduce((a, b) => a + b, 0) / this.results.length,
            ) + " ms"
          : "—",
      ],
      ["MEDIAN", summary.median === null ? "—" : summary.median + " ms"],
      ["CLOCK", this.metric.toUpperCase()],
    ]);
  }
  draw(g) {
    space(g, this.t, 0.3);
    grid(g, 90);
    if (this.c.state?.()?.scores?.reaction !== undefined)
      text(g, 'LEGACY RECORD RETAINED / TIMING SOURCE UNKNOWN', 30, 32, 16, C.muted);
    const go = this.phase === "go";
    for (let i = 0; i < 3; i++) {
      circle(
        g,
        290 + i * 190,
        190,
        58,
        i === 1 && go ? C.ink : C.line,
        i === 1 && go,
      );
      circle(g, 290 + i * 190, 190, 66, C.line);
      text(
        g,
        ["I", "II", "III"][i],
        290 + i * 190,
        190,
        27,
        i === 1 && go ? C.bg : C.muted,
        "center",
      );
    }
    const grade = this.phase === "result" ? reactionGrade(this.last) : null;
    const title = {
      wait: "WAIT FOR THE MIDDLE LIGHT",
      go: "NOW",
      early: "TOO EARLY",
      result: this.last + " ms",
      error: "NODE UNAVAILABLE",
    }[this.phase];
    if (title) {
      text(
        g,
        title,
        480,
        312,
        36,
        this.phase === "early" ? C.amber : C.ink,
        "center",
      );
      if (grade) text(g, grade.word + (this.fresh ? " / NEW BEST" : ""), 480, 358, 24, this.fresh ? C.amber : C.muted, "center");
      if (this.phase === "result" && this.metric === "keyboard")
        text(g, "KEYBOARD TIMING IS APPROXIMATE", 480, 392, 18, C.muted, "center");
      if (["result", "early", "error"].includes(this.phase))
        text(g, "PRESS FOR ANOTHER TRIAL", 480, 420, 22, C.amber, "center");
    }
    // The last ten results as bars: taller is slower, the scale runs to 600 ms.
    const bars = this.results;
    if (bars.length && this.phase !== "title") {
      const w = 36, gap = 12, x0 = 480 - (bars.length * (w + gap) - gap) / 2, base = 504;
      bars.forEach((ms, i) => {
        const h = Math.max(4, Math.min(1, ms / 600) * 60);
        g.fillStyle = i === bars.length - 1 && this.phase === "result" ? C.amber : C.muted;
        g.fillRect(x0 + i * (w + gap), base - h, w, h);
      });
      text(g, "RECENT TRIALS / TALLER IS SLOWER", 480, 526, 16, C.muted, "center");
    }
    if (this.phase === "title")
      banner(
        g,
        "LIGHT TRIAL",
        "An honest measure of the moment between seeing and acting.",
      );
  }
}

