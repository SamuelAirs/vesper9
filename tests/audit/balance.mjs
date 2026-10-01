// Balance measurements. Run: node tests/audit/balance.mjs
// All runs use the fixed 1/60 s step and seeded rngs; nothing here uses wall time.
// BALANCE_SEEDS=12 runs fewer seeds; BALANCE_ONLY=orbit,runner,undertow,echo,glyph,morse picks games.
import { orbitWindow, orbitSpeed } from "../../web/apps/games.js";
import { mean, median, pct, playOrbit, playRunner, playUndertow, playEcho, playGlyph, playMorse,
  runnerWindow, RUNNER_SHAPES } from "./bots.mjs";

const SEEDS = Array.from({ length: Number(process.env.BALANCE_SEEDS || 40) }, (_, i) => i + 1);
const ONLY = process.env.BALANCE_ONLY ? process.env.BALANCE_ONLY.split(",") : null;
const want = (name) => !ONLY || ONLY.includes(name);
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const row = (cells) => console.log("| " + cells.join(" | ") + " |");
const head = (cells) => { row(cells); row(cells.map(() => "---")); };
const CAP = Number(process.env.BALANCE_CAP || 1200); // simulated seconds a run may last before it is cut off

function summarize(label, runs, key) {
  const v = runs.map((r) => r[key]), s = runs.map((r) => r.seconds);
  const capped = runs.filter((r) => !r.over).length;
  const alive20 = runs.filter((r) => !r.over || r.seconds >= 20).length;
  row([label, f(mean(v)), f(median(v), 0), f(pct(v, 0.1), 0), f(pct(v, 0.9), 0), f(median(s), 0) + " s", `${capped}/${runs.length}`, `${alive20}/${runs.length}`]);
}
const H = ["policy", "mean score", "median", "p10", "p90", "median run length", "runs hitting 20-min cap", "alive at 20 s"];

if (want("orbit")) {
  console.log("## Orbit Lock (score = locks)");
  head(H);
  for (const [n, p] of [["perfect timing", { kind: "timed", sigma: 0 }], ["competent (sd 40 ms)", { kind: "timed", sigma: 0.04 }],
    ["average (sd 80 ms)", { kind: "timed", sigma: 0.08 }], ["naive (sd 150 ms)", { kind: "timed", sigma: 0.15 }],
    ["never press", { kind: "never" }], ["press every 1.0 s", { kind: "rhythm", period: 1 }],
    ["press every 2.1 s", { kind: "rhythm", period: 2.1 }], ["mash 8 Hz", { kind: "rhythm", period: 0.125 }]])
    summarize(n, SEEDS.map((s) => playOrbit(s, p, CAP)), "points");
  const runs = SEEDS.map((s) => playOrbit(s, { kind: "timed", sigma: 0.04 }, CAP));
  const t5 = runs.map((r) => r.locks[4]).filter(Number.isFinite), t25 = runs.map((r) => r.locks[24]).filter(Number.isFinite);
  console.log(`\ncompetent: median time to 5th lock ${f(median(t5))} s, to 25th lock ${f(median(t25))} s (${t25.length}/${runs.length} runs reach 25)`);
  const gate = (p) => orbitWindow(p) * 2 / orbitSpeed(p);
  console.log("gate time-width (ms) by locks: " + [0, 5, 10, 15, 20, 25, 30, 40, 45].map((p) => `${p}:${f(gate(p) * 1000, 0)}`).join("  "));
}

if (want("runner")) {
  console.log("\n## Moonrunner (score = metres)");
  head(H);
  for (const [n, p] of [["competent (sd 2.4 frames = 40 ms)", { kind: "timed", sigmaFrames: 2.4 }],
    ["average (sd 4.8 frames = 80 ms)", { kind: "timed", sigmaFrames: 4.8 }], ["casual (sd 6 frames = 100 ms)", { kind: "timed", sigmaFrames: 6 }], ["naive (sd 9 frames = 150 ms)", { kind: "timed", sigmaFrames: 9 }],
    ["never press", { kind: "never" }], ["always hold", { kind: "hold" }],
    ["tap every 2.25 s (= mean spacing)", { kind: "rhythm", period: 2.25 }], ["tap every 1.0 s", { kind: "rhythm", period: 1 }],
    ["mash 8 Hz", { kind: "mash", hz: 8 }], ["mash 4 Hz", { kind: "mash", hz: 4 }]])
    summarize(n, SEEDS.map((s) => playRunner(s, p, CAP)), "metres");
  console.log("\nClearing windows (launch frames that clear, tap vs hold; one frame = 16.7 ms):");
  head(["shape", "relics", "speed px/s", "tap window ms", "hold window ms"]);
  for (const sh of RUNNER_SHAPES) for (const p of [0, 6, 14, 30]) {
    const speed = 250 + Math.min(p * 5, 150);
    row([sh.name, p, speed, f(runnerWindow(sh, p, "tap").length * 1000 / 60, 0), f(runnerWindow(sh, p, "hold").length * 1000 / 60, 0)]);
  }
  for (const [n, p] of [["competent", { kind: "timed", sigmaFrames: 2.4 }], ["average", { kind: "timed", sigmaFrames: 4.8 }]]) {
    const runs = SEEDS.map((s) => playRunner(s, p, CAP));
    console.log(`${n}: ${runs.filter((r) => !r.over).length}/${runs.length} runs survive the full ${CAP} s.`);
    const at = (k) => f(median(runs.map((r) => r.at[k]).filter(Number.isFinite)));
    console.log(`${n}: median time of the 3rd / 6th (first wall) / 14th (first mesa) / 30th relic: ${at(3)} / ${at(6)} / ${at(14)} / ${at(30)} s`);
  }
}

if (want("undertow")) {
  console.log("\n## Undertow (score = passages)");
  head(H);
  for (const [n, p] of [["pilot, decides every 50 ms, brakes (competent)", { kind: "pilot", every: 3, brake: 0.42 }],
    ["pilot, decides every 150 ms, brakes", { kind: "pilot", every: 9, brake: 0.42 }],
    ["pilot, decides every 250 ms, no braking (naive)", { kind: "pilot", every: 15, brake: 0 }],
    ["never press", { kind: "never" }], ["always hold", { kind: "hold" }],
    ["pilot, decides every 250 ms, brakes", { kind: "pilot", every: 15, brake: 0.42 }],
    ["pilot, decides every 400 ms, brakes", { kind: "pilot", every: 24, brake: 0.42 }],
    ["blind hover: 6 of 15 frames held (0.25 s rhythm)", { kind: "duty", period: 0.25, fraction: 0.4 }],
    ["blind hover: 12 of 30 frames held (0.5 s rhythm)", { kind: "duty", period: 0.5, fraction: 0.4 }],
    ["blind rhythm: 50% duty, 0.5 s period", { kind: "duty", period: 0.5, fraction: 0.5 }]])
    summarize(n, SEEDS.map((s) => playUndertow(s, p, CAP)), "points");
  const runs = SEEDS.map((s) => playUndertow(s, { kind: "pilot", every: 3, brake: 0.42 }, CAP));
  const at = (n) => f(median(runs.map((r) => r.at[n]).filter(Number.isFinite)));
  console.log(`\ncompetent pilot: median time of the 1st / 10th (drift starts) / 20th (narrower) / 32nd (speed cap) passage: ${at(1)} / ${at(10)} / ${at(20)} / ${at(32)} s`);
}

if (want("echo")) {
  console.log("\n## Echo Vault (score = sequences)");
  head(H);
  for (const [n, p] of [["perfect memory, steady keyer (short 150+-50 ms, long 600+-120)", { kind: "memory" }],
    ["perfect memory, sloppy keyer (short 220+-110, long 480+-150)", { kind: "memory", short: [220, 110], long: [480, 150] }],
    ["97% memory per pulse, steady keyer", { kind: "memory", recall: 0.97 }],
    ["90% memory per pulse, steady keyer", { kind: "memory", recall: 0.9 }],
    ["random taps/holds", { kind: "random" }], ["always short taps", { kind: "allShort" }], ["always long holds", { kind: "allLong" }],
    ["every hold 330 ms (degenerate)", { kind: "fixed", ms: 330 }], ["every hold 370 ms (degenerate)", { kind: "fixed", ms: 370 }]])
    summarize(n, SEEDS.map((s) => playEcho(s, p, CAP)), "rounds");
  const r = playEcho(1, { kind: "memory" }, 600);
  console.log(`\nsteady keyer seed 1: round start times (s): ${r.roundStart.slice(0, 12).map((x) => f(x, 0)).join(", ")}; sequence length now ${r.len}`);
}

if (want("glyph")) {
  console.log("\n## Glyph Archive (score = inscriptions decoded)");
  head(["scan", ...H]);
  for (const scan of [600, 850, 1200, 1600]) {
    for (const [n, p] of [["perfect memory, reaction 150+-50 ms", { kind: "memory", react: [150, 50], recall: 1 }],
      ["memory 90% per glyph, reaction 250+-80 ms", { kind: "memory", react: [250, 80], recall: 0.9 }],
      ["memory 75% per glyph, reaction 250+-80 ms", { kind: "memory", react: [250, 80], recall: 0.75 }],
      ["memory 90%, slow reaction 350+-120 ms", { kind: "memory", react: [350, 120], recall: 0.9 }]]) {
      const runs = SEEDS.map((s) => playGlyph(s, p, scan, CAP)), v = runs.map((r) => r.rounds);
      row([scan, n, f(mean(v)), f(median(v), 0), f(pct(v, 0.1), 0), f(pct(v, 0.9), 0), f(median(runs.map((r) => r.seconds)), 0) + " s", `${runs.filter((r) => !r.over).length}/${runs.length}`,
        `${runs.filter((r) => !r.over || r.seconds >= 20).length}/${runs.length}`]);
    }
  }
  for (const [n, p] of [["mash 5 Hz", { kind: "mash", hz: 5 }], ["press every 1.0 s", { kind: "rhythm", period: 1 }]]) {
    const runs = SEEDS.map((s) => playGlyph(s, p, 850, CAP)), v = runs.map((r) => r.rounds);
    row([850, n, f(mean(v)), f(median(v), 0), f(pct(v, 0.1), 0), f(pct(v, 0.9), 0), f(median(runs.map((r) => r.seconds)), 0) + " s", `${runs.filter((r) => !r.over).length}/${runs.length}`,
      `${runs.filter((r) => !r.over || r.seconds >= 20).length}/${runs.length}`]);
  }
  const r = playGlyph(1, { kind: "memory", react: [150, 50], recall: 1 }, 850, 900);
  console.log(`\nperfect memory seed 1 @850 ms: inscription completion times (s): ${r.roundStart.slice(0, 14).map((x) => f(x, 0)).join(", ")}`);
}

if (want("morse")) {
  console.log("\n## Signal School, guided keying, human keyer sd 35 ms, 3 sessions of 10 answers");
  head(["WPM", "dot ms", "dash ms", "dot/dash threshold ms", "accuracy", "first session length", "letters taught after 3 sessions (index)"]);
  for (const wpm of [5, 10, 15, 20, 25]) {
    const runs = SEEDS.slice(0, 20).map((s) => playMorse(s, wpm, { noiseMs: 35, sessions: 3 }));
    const ans = runs.reduce((a, r) => a + r.answered, 0), ok = runs.reduce((a, r) => a + r.ok, 0);
    const unit = 1200 / wpm;
    row([wpm, f(unit, 0), f(unit * 3, 0), f(unit * 2, 0), f(100 * ok / ans, 0) + " %", f(median(runs.map((r) => r.firstSession)), 0) + " s", f(mean(runs.map((r) => r.index)))]);
  }
}
