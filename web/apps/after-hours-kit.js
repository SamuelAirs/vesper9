// Shared pieces of the After Hours games (Crawlspace, Supper Club, Pocket Links, Night Grid):
// the one press scheme they share, the HOW TO PLAY pages each game opens with, the lamp key drawn
// on screen, and the fourth lamp. Plain functions over plain data, so AppGuard can rewind the games.
//
// The press scheme is the console's own: a TAP moves to the next choice, a press HELD for HOLD
// seconds and RELEASED does the choice. The choice happens on the release, so the menu gesture
// (tap, tap, hold) never chooses anything: the host consumes that release and the game rewinds.
import { C, text, circle } from "../engine/draw.js";
import { lamps } from "../engine/lightshow.js";

// A press at least this long, then released, chooses. Shorter presses are taps.
export const HOLD = 0.5;

// Game-owned menu actions draw on the canvas. Close the system overlay after
// they succeed so their guide/new-run screen is visible and lamps wake again.
export function resumeActions(ctx, actions) {
  return actions.map((action) => ({ ...action, run: () => { action.run(); ctx.resume?.(); } }));
}

// Case taps complement the button: reverse a choice without committing it. Calibrated right
// taps optionally step forward. A tap while the button is held must never move its target.
export function caseChoice(game, event = {}, pages = 1) {
  if (game.held) return false;
  const step = game.c.settings?.().tapMode === 'sides' && event.side === 'right' ? 1 : -1;
  if (game.guide >= 0) { game.guide = Math.max(0, Math.min(pages - 1, game.guide + step)); return true; }
  if (!['play', 'upgrade', 'over'].includes(game.phase) || game.stage === 'report') return false;
  game.cursor = (game.cursor + step + 3) % 3;
  game.c.tone?.(400 + game.cursor * 60, 0.025, 'triangle');
  return true;
}

// The board LED is a dim release-ready accent, separate from the four game lamps.
export function choiceAccent(game, hold = HOLD) {
  if (!game.c.hasBoardLed?.()) return;
  const ready = game.held && game.t - game.pressAt >= hold;
  game.c.board?.(ready ? [12, 55, 22] : game.held ? [40, 22, 0] : [0, 0, 0]);
}

// 3 on the first node, 4 on the new one (PR #16's ctx.lampCount()).
export const lampCount = (ctx) => (ctx.lampCount?.() === 4 ? 4 : 3);

// A three-lamp picture plus the fourth lamp's colour, when the node has a fourth lamp.
export const withFourth = (three, fourth, n) => (n === 4 ? [...three.slice(0, 9), ...lamps(fourth)] : three.slice(0, 9));

// How far a held press is towards a choice, 0..1 (0 when nothing is held).
export const holdFraction = (game) => (game.held ? Math.min(1, (game.t - game.pressAt) / HOLD) : 0);

const css = (rgb) => "rgb(" + rgb.map((v) => Math.round(Math.max(48, v))).join(",") + ")";

// A row of lamps with what each means, centred on x. entries: [{ rgb, label, sub }].
export function drawLampRow(g, entries, x, y) {
  const gap = entries.length === 4 ? 210 : 250, left = x - gap * (entries.length - 1) / 2;
  entries.forEach((e, i) => {
    const cx = left + i * gap;
    circle(g, cx, y, 22, css(e.rgb), true);
    circle(g, cx, y, 27, C.line, false, 2);
    text(g, "LAMP " + (i + 1), cx, y + 44, 14, C.muted, "center");
    text(g, e.label, cx, y + 69, 18, C.ink, "center");
    if (e.sub) text(g, e.sub, cx, y + 93, 15, C.muted, "center");
  });
}

// The compact key along the bottom of a play screen: a dot and a word for each lamp.
export function drawLampKey(g, entries, y) {
  const width = 912 / entries.length;
  entries.forEach((e, i) => {
    const x = 24 + i * width;
    circle(g, x + 8, y - 1, 6, css(e.rgb), true);
    text(g, (i + 1) + " " + e.label, x + 22, y, 14, C.muted);
  });
}

// One HOW TO PLAY page. pages: [{ head, lines: [..], lamps?: [{ rgb, label, sub }] }].
export function drawGuide(g, name, pages, page, n) {
  const p = pages[Math.min(page, pages.length - 1)];
  g.fillStyle = C.bg; g.fillRect(0, 0, 960, 540);
  text(g, name + "  /  HOW TO PLAY  " + (page + 1) + " OF " + pages.length, 480, 40, 16, C.muted, "center");
  text(g, p.head, 480, 96, 32, C.amber, "center");
  p.lines.forEach((value, i) => text(g, value, 480, 148 + i * 32, 20, i ? C.muted : C.ink, "center"));
  if (p.lamps) drawLampRow(g, p.lamps.slice(0, n), 480, 330);
  for (let i = 0; i < pages.length; i++) circle(g, 480 + (i - (pages.length - 1) / 2) * 22, 470, 5, i === page ? C.amber : C.line, i === page);
  text(g, page < pages.length - 1 ? "TAP: NEXT PAGE      HOLD AND RELEASE: START PLAYING" : "TAP OR HOLD: START PLAYING", 480, 510, 18, C.cyan, "center");
}

// The words under a choice row, the same in every After Hours game (`idle` replaces them when space is short).
export function drawPressHelp(g, game, y, verb = "DO IT", idle = "BUTTON: NEXT   CASE: PREVIOUS   HOLD / RELEASE: " + verb) {
  const f = holdFraction(game);
  if (f >= 1) text(g, "RELEASE TO " + verb, 480, y, 17, C.amber, "center");
  else if (f > 0) {
    g.fillStyle = C.line; g.fillRect(380, y - 4, 200, 6);
    g.fillStyle = C.amber; g.fillRect(380, y - 4, 200 * f, 6);
  } else text(g, idle, 480, y, 16, C.muted, "center");
}

