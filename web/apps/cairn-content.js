// CAIRN is a fixed place. Coordinates are pixels; positive y is height above the landing.
export const CAIRN_PHYSICS = Object.freeze({ gravity: 980, radius: 10, height: 23,
  tap: 0.18, charge: 0.95, minVX: 145, addVX: 170, minVY: 300, addVY: 410,
  left: 64, right: 896, maxFall: 950 });
export const REGIONS = Object.freeze([
  { at: 0, name: "THE ROOTWORK", ink: "#c5d994", rock: "#344a39", edge: "#90ae76", bg: "#101b18", note: "A small thing. A very tall place." },
  { at: 985, name: "THE HOLLOW CHOIR", ink: "#9dd7d3", rock: "#2a444b", edge: "#72aaa9", bg: "#0c1920", note: "The stones remember your arrival." },
  { at: 2050, name: "THE GLASS ORCHARD", ink: "#c5b5e5", rock: "#39354d", edge: "#a599c4", bg: "#151421", note: "Nothing here grows toward the ground." },
  { at: 2980, name: "THE LAST ANTENNA", ink: "#edc997", rock: "#4b4038", edge: "#c5a77d", bg: "#1a171c", note: "Someone left a light on." },
]);
// Authored alternating traverses, same-facing leaps, short transfers and exposed needles.
// Shelves are solid on all faces; overcharging below a shelf can strike its underside.
const shelves = [
  [64, 0, 832], [365, 105, 140], [610, 230, 120], [430, 350, 90],
  [190, 470, 100], [395, 605, 76], [635, 730, 85], [445, 850, 65],
  [200, 985, 130], [90, 1135, 74], [330, 1240, 76], [545, 1370, 64],
  [720, 1480, 62], [505, 1615, 58], [275, 1730, 65], [90, 1860, 60],
  [305, 1980, 70], [510, 2110, 180], [720, 2250, 56], [510, 2385, 54],
  [300, 2500, 58], [100, 2640, 52], [315, 2765, 48], [535, 2890, 52],
  [735, 3010, 50], [515, 3140, 46], [285, 3265, 44], [100, 3390, 48],
  [315, 3520, 44], [530, 3650, 120],
];
export const PLATFORMS = Object.freeze(shelves.map(([x, y, w], id) => Object.freeze({ id, x, y, w, h: id ? 15 : 70,
  checkpoint: id === 8 ? 1 : id === 17 ? 2 : 0, summit: id === shelves.length - 1 })));
export const CHECKPOINTS = Object.freeze([0, 8, 17]);
export const SUMMIT = PLATFORMS.at(-1).y;
export const regionAt = y => REGIONS.reduce((n, region, i) => y >= region.at ? i : n, 0);
export const chargeFor = seconds => Math.max(0, Math.min(1, (seconds - CAIRN_PHYSICS.tap) / (CAIRN_PHYSICS.charge - CAIRN_PHYSICS.tap)));
export const launchFor = seconds => { const q = chargeFor(seconds); return { vx: CAIRN_PHYSICS.minVX + CAIRN_PHYSICS.addVX * q, vy: CAIRN_PHYSICS.minVY + CAIRN_PHYSICS.addVY * q }; };
const number = (v, lo, hi, fallback = 0) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
const count = (v, hi = 1e7) => Math.floor(number(v, 0, hi));
export function migrateSave(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const compatible = o.schema === 1 && o.physicsVersion === "cairn-v1";
  const checkpoint = compatible ? count(o.checkpoint, 2) : 0;
  const out = { schema: 1, physicsVersion: "cairn-v1", runs: count(o.runs), highest: number(o.highest, 0, SUMMIT),
    summits: count(o.summits), checkpoint, milestone: checkpoint, bestSeconds: compatible ? number(o.bestSeconds, 0, 86400) : 0,
    last: null, active: null };
  if (o.last && typeof o.last === "object") out.last = { height: count(o.last.height, SUMMIT / 10),
    seconds: number(o.last.seconds, 0, 86400), jumps: count(o.last.jumps), falls: count(o.last.falls), summit: o.last.summit === true };
  const a = compatible && o.active;
  if (a && Number.isInteger(a.platform) && CHECKPOINTS.includes(a.platform)) {
    const p = PLATFORMS[a.platform];
    const anchor = count(a.anchor, checkpoint);
    if (a.platform === CHECKPOINTS[anchor]) out.active = { platform: p.id, x: p.id ? p.x + p.w / 2 : 230,
      facing: a.facing === -1 ? -1 : 1, seconds: number(a.seconds, 0, 86400), jumps: count(a.jumps), falls: count(a.falls), anchor };
  }
  return out;
}
