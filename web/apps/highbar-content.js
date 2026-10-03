// High Bar tuning and authored park content. Stable park, gap and goal IDs preserve careers.
export const G = 650; // px/s^2
export const STEP = 4; // heightmap spacing, px
export const LIP_ANGLE = 78 * Math.PI / 180; // the steepest a ramp gets before it is vert
export const MAX_SPEED = 820;
export const FRICTION = 6; // px/s^2 rolling resistance
export const PUMP = 1.7; // a crouch multiplies the slope's pull when it helps
export const PUSH_MIN = 220;
export const PUSH = 420; // below this speed on the ground the rider kicks
export const OLLIE = 240; // px/s off the ground, along its normal
export const REACH = 260;
export const MIN_R = 45; // how far a bar can be grabbed from
export const CATCH_LAG = 4 / 60; // the grab takes this long to land
export const REGRAB = 0.45; // seconds before the bar just left can be grabbed again
export const SKATE_DRIVE = 360; // a held kick keeps accelerating beyond automatic cruise
export const SWING_DRIVE = 0; // energy comes from skating, never holding a web
export const SWING_CAP = 920;
export const SWING_OMEGA = 7; // readable short-radius orbits, rad/s
export const RELEASE_LIFT = 0;
export const TUCK = 8.5; // rad/s of a full tuck
export const SETTLE = 4.2; // rad/s at most while untucked, turning towards the landing
export const LAND_TOL = 0.8; // radians off the ground's angle that still land
export const ROLL = 1.2; // seconds on the ground before a combo banks
export const BAIL_T = 1.1;
export const SESSION = 120;
export const OVERTIME = 8; // seconds after the clock for the last trick
export const HOLD_PICK = 0.5; // a press this long on a menu screen chooses
export const WHIP_GAIN = 1;
export const WHIP_CAP = 760;

// One-way deck contact is swept at the crossing point, not sampled at the end
// of the frame. Rolling off an edge and rising through a deck remain free.
export function platformContact(platforms, x0, y0, x1, y1) {
  if (y1 <= y0) return null;
  let hit = null;
  for (const deck of platforms || []) {
    if (y0 > deck.y + 1e-7 || y1 < deck.y) continue;
    const t = (deck.y - y0) / (y1 - y0), x = x0 + (x1 - x0) * t;
    if (x < deck.x1 || x > deck.x2 || hit && t >= hit.t) continue;
    hit = { id: deck.id, x, y: deck.y, t };
  }
  return hit;
}
export function airSurfaceSlope(platforms, x, y, slope) {
  return (platforms || []).some(deck => x >= deck.x1 && x <= deck.x2 && y <= deck.y) ? 0 : slope(x);
}

// Read-only landing forecast. It follows stepAir's current bounded time step,
// including wall rebounds, changing slopes and the special vert return. The
// delayed version asks what another short tuck would cost before releasing.
// It never catches a post or supplies an input on the player's behalf.
export function projectLanding(rider, air, geo, groundY, slope, delay = 0, dt = 1 / 60, platforms = []) {
  dt = Number.isFinite(dt) ? Math.max(1 / 240, Math.min(1 / 30, dt)) : 1 / 60;
  const p = { ...rider };
  const angle = a => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const limit = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  for (let step = 1; step <= Math.ceil(6 / dt); step++) {
    const time = step * dt;
    const x0 = p.x, y0 = p.y;
    if (p.vert) { p.vy += G * dt; p.y += p.vy * dt; }
    else {
      p.x += p.vx * dt; p.y += p.vy * dt + 0.5 * G * dt * dt; p.vy += G * dt;
      if (p.x < geo.lipL) { p.x = geo.lipL; p.vx = Math.abs(p.vx) * 0.4; }
      if (p.x > geo.lipR) { p.x = geo.lipR; p.vx = -Math.abs(p.vx) * 0.4; }
    }
    const target = Math.atan(p.vert ? slope(p.x + (p.vert < 0 ? 3 : -3)) : airSurfaceSlope(platforms, p.x, p.y, slope));
    if (rider.tuck && time <= delay) p.rotV += ((p.tuckDir || -1) * TUCK - p.rotV) * Math.min(1, 10 * dt);
    else {
      const want = limit(angle(target - p.rot) * 5, -SETTLE, SETTLE);
      p.rotV += (want - p.rotV) * Math.min(1, 7 * dt);
    }
    p.rot += p.rotV * dt;
    const deck = !p.vert ? platformContact(platforms, x0, y0, p.x, p.y) : null;
    const contact = deck || (p.vert ? p.vy > 0 && p.y >= geo.lipY : p.y >= groundY(p.x));
    if (!contact) continue;
    if (p.vert) p.x = p.vert < 0 ? geo.lipL + 1 : geo.lipR - 1;
    const off = Math.abs(angle(p.rot - (deck ? 0 : Math.atan(slope(p.x))))), tol = air?.style ? LAND_TOL * 0.7 : LAND_TOL;
    const kind = off > tol ? "bail" : off >= tol * 0.75 ? "sketchy" : off < 0.22 && (air?.t || 0) + time >= 0.35 ? "clean" : "safe";
    return { time, off, kind };
  }
  return null;
}

// Shared by the real release and its dotted aiming preview. This calculation
// is pure: it neither changes the rider nor advances the swing.
export function barLaunchVelocity(p, kind) {
  let vx = p.r * p.om * Math.cos(p.phi), vy = -p.r * p.om * Math.sin(p.phi);
  // Releasing preserves the tangent, regardless of hold duration or post kind.
  const speed = Math.hypot(vx, vy);
  if (speed > SWING_CAP) { vx *= SWING_CAP / speed; vy *= SWING_CAP / speed; }
  return { vx, vy };
}
export const SLOTS = 3;
export const MAX_TRICKS = 40;
export const MAX_PARTS = 24;
export const REPEAT = [1, 0.75, 0.5, 0.25, 0.1];
export const FLIPS = ["", "", "DOUBLE ", "TRIPLE ", "QUAD "];
export const FLIP_PTS = [0, 300, 750, 1400, 2200];
export const MODES = ["SESSION", "LINE RUN", "PRACTICE"];
export const MANUAL_LIMIT = 5;
export const TAP_COOLDOWN = 0.45;
export const STYLE_TIME = 0.28;
export const MEDALS = ["—", "BRONZE", "SILVER", "GOLD"];
export const GUIDE = [
  ["ROLL AND FLY", "Hold on the ground to push; release to ollie.", "In air, tap then hold the second press to flip.", "Release early to straighten. Land on decks to skate higher."],
  ["SWING THE BARS", "In air, hold a fresh press near the ring to catch.", "Release to fly along the web's tangent. Green: upward.", "Webs lose momentum. Land and push to gain speed."],
  ["CASE TAP: STYLE", "In air: one tap shoves the board; two taps kickflip.", "On a web: one regrip adds style without adding speed.", "Case taps are optional. On the ground they do nothing."],
  ["BANK YOUR LINE", "Land, then roll for 1.2 seconds to bank the combo.", "Ollie before it banks to keep linking the next air.", "Mix tricks. Each move scores five times per line."],
  ["PRACTICE TO MASTERY", "SESSION: two minutes. Three goals open the next park.", "LINE RUN ends when you bank the target. Link for gold.", "Menu / FLAT SCHOOL teaches by riding, without records."],
  ["THE FOUR LAMPS", "I: speed / swing release. II: landing safety.", "III: variety in your combo. IV: when to tap for style.", "Board LED flashes only for a bank or new challenge."],
];
export const LINES = [
  [
    { id: "first", skill: "CATCH + RELEASE", difficulty: 1,
      approach: ["Build speed and catch the first marked bar.", "Release upward; quick press, then hold the second to flip.", "Let go early; land and roll to bank."],
      name: "FIRST FLIGHT", text: "Bank a flip and a swing in one line", flip: 1, swing: true },
    { id: "style", skill: "LANDING CONTROL", difficulty: 1,
      approach: ["Mix a swing, air and one other trick.", "A case tap adds a shove-it when cyan is lit.", "Straighten early for a clean landing."],
      name: "BOWL STYLE", text: "Bank three different tricks with a clean landing", variety: 3, clean: true },
    { id: "link", skill: "COMBO FLOW", difficulty: 2,
      approach: ["Land an air, then ollie before the line banks.", "Add a case-tap shove-it during either flight.", "Land the second air and roll to bank."],
      name: "ROLLING LINK", text: "Link two airs and a shove-it, then bank", shove: true, airs: 2 },
    { id: "sky", skill: "ASCENT + FLIP", difficulty: 3, seconds: 60,
      approach: ["Climb the decks and build speed for the upper arc.", "Connect B7 → B9 → B8 without landing; add a flip.", "Land and bank. Link another clean air for gold."],
      name: "CANAL SKYLINE", text: "Fly B7 → B9 → B8 without landing; bank a flip", gap: "skyline", flip: 1 },
  ],
  [
    { id: "ladder", skill: "UPWARD TRANSFERS", difficulty: 2,
      approach: ["Climb the three bars on the left.", "Transfer between B2 and B3 in either direction.", "Fit a flip into the same banked combo."],
      name: "LADDER LINE", text: "Bank THE LADDER and a flip", gap: "ladder", flip: 1 },
    { id: "spine", skill: "TERRAIN + VARIETY", difficulty: 2,
      approach: ["Carry speed over the central spine.", "Mix four trick names into that same combo.", "Ollie before banking to link another air."],
      name: "SPINE STYLE", text: "Bank OVER THE SPINE and four different tricks", gap: "spine", variety: 4 },
    { id: "whips", skill: "SWING TIMING", difficulty: 3,
      approach: ["Catch either amber whip: B4 or B6.", "Tap the case once to regrip; release rising.", "Catch the other whip before touching down."],
      name: "WHIP LINE", text: "Bank WHIP TO WHIP and a regrip", gap: "whips", regrip: true },
    { id: "sky", skill: "HIGH CROSSING", difficulty: 3, seconds: 75,
      approach: ["Recharge on the upper deck for the amber crossing.", "Fly B14 → B15 → B13 → B11 without landing.", "Bank five trick types; the return is part of the route."],
      name: "FREIGHT SWITCH", text: "Fly B14 → B15 → B13 → B11; bank five trick types", gap: "freight", variety: 5 },
  ],
  [
    { id: "climb", skill: "VERTICAL FLOW", difficulty: 2,
      approach: ["Release rising, then catch a higher rung.", "Connect three transfers without banking.", "Add a double flip and find a safe landing."],
      name: "UP THE TOWER", text: "Bank three transfers and a double flip", transfers: 3, flip: 2 },
    { id: "top", skill: "SUMMIT ROUTE", difficulty: 3,
      approach: ["Climb to the named TOP RUNG milestone: B12.", "Catch it; mix four tricks. Sky posts rise above it.", "Allow time to descend and bank on the floor."],
      name: "TOP STYLE", text: "Reach TOP RUNG and bank four different tricks", gap: "top", variety: 4, seconds: 75 },
    { id: "cross", skill: "PRECISION TRANSFER", difficulty: 3,
      approach: ["Climb to the two amber bars: B9 and B10.", "Transfer across without touching ground.", "Straighten early on the descent; land clean."],
      name: "CROSSOVER LINE", text: "Bank CROSSOVER with a clean landing", gap: "cross", clean: true, seconds: 75 },
    { id: "sky", skill: "SUSTAINED CLIMB", difficulty: 3, seconds: 75,
      approach: ["Climb the decks and recharge below the crown.", "Fly B16 → B17 → B15 → B14 without landing.", "Use linking posts; bank six transfers in the line."],
      name: "CROWN CLIMB", text: "Fly B16 → B17 → B15 → B14; bank six transfers", gap: "crown", transfers: 6 },
  ],
  [
    { id: "moon", skill: "LONG AIR", difficulty: 3,
      approach: ["Build speed, then release high across the pipe.", "Cover both marked edges in one flight.", "Add a double flip before banking the line."],
      name: "MOON LINE", text: "Bank OVER THE MOON and a double flip", gap: "moon", flip: 2 },
    { id: "summit", skill: "AIR STYLE", difficulty: 2,
      approach: ["Catch the amber SUMMIT launch bar: B4.", "Release into clear air; tap when cyan is lit.", "Let go to straighten, then bank the shove-it."],
      name: "NIGHT STYLE", text: "Bank SUMMIT and a shove-it", gap: "summit", shove: true },
    { id: "master", skill: "COMPLETE LINE", difficulty: 3,
      approach: ["Use the deep transitions for a triple flip.", "Link five different trick names in one combo.", "A safe bank matters more than one extra trick."],
      name: "PIPE MASTER", text: "Bank five different tricks and a triple flip", variety: 5, flip: 3 },
    { id: "sky", skill: "SUMMIT + RETURN", difficulty: 3, seconds: 75,
      approach: ["Climb the decks and carry speed into the moon arc.", "Fly B8 → B10 → B9 → B7 without landing.", "Bring the whole line down for a clean bank."],
      name: "LUNAR RETURN", text: "Fly B8 → B10 → B9 → B7; bank a clean landing", gap: "lunar", clean: true },
  ],
];

// ---- parks -------------------------------------------------------------------
// w, h: world size. floor: floor height. r: quarter-pipe radius. bumps: [centre, height, width]
// (positive is a hump). bars: [x, y, kind]. gaps: named lines worth points (bar to bar, an air
// spanning x1..x2, or reaching a bar). goals: five per park.
export const PARKS = [
  {
    id: "bowl", district: "01 / CANAL COMMONS", tagline: "Find your flow.",
    routeTip: "Skate into a launch. Catch the open ladders to build height.",
    theme: { sky: "#0b1b20", far: "#152c31", ground: "#203a38", accent: "#96dbcf", secondary: "#dabd88" },
    landmarks: [{ x: 250, y: 130, kind: "beacon", label: "COMMONS" }, { x: 1220, y: 150, kind: "antenna", label: "09" }],
    training: { x: 750, speed: 220 },
    name: "THE BOWL", text: "A flowing bowl with open sky ladders.", w: 1500, h: 1490, floor: 1420, r: 250, bumps: [],
    platforms: [{ id: "canal-low", x1: 220, x2: 820, y: 1180 },
      { id: "canal-mid", x1: 680, x2: 1280, y: 900 },
      { id: "canal-high", x1: 220, x2: 820, y: 640 }],
    bars: [[430, 1250], [750, 1210], [1070, 1250],
      [560, 1010], [940, 1010], [750, 780], [520, 550], [980, 550], [750, 320]],
    gaps: [{ id: "bowlx", name: "BAR HOP", t: "bars", a: 0, b: 2, pts: 500 },
      { id: "skyline", name: "CANAL SKYLINE", t: "sequence", bars: [6, 8, 7], pts: 1200 }],
    goals: [
      { t: "score", n: 3000, text: "Score 3,000 in a session" },
      { t: "flip", n: 1, text: "Land a flip" },
      { t: "giants", n: 1, text: "Swing a full giant round a bar" },
      { t: "count", n: 4, text: "String 4 tricks in one combo" },
      { t: "score", n: 10000, text: "Score 10,000 in a session" },
    ],
  },
  {
    id: "yard", district: "02 / FREIGHT EXCHANGE", tagline: "Turn obstacles into connections.",
    routeTip: "Climb the left ladder. Carry the spine into the amber whips.",
    theme: { sky: "#211c19", far: "#352a24", ground: "#40332a", accent: "#edbd79", secondary: "#acccc3" },
    landmarks: [{ x: 350, y: 100, kind: "gantry", label: "FREIGHT 02" }, { x: 1500, y: 100, kind: "tank", label: "TRANSFER" }, { x: 2000, y: 170, kind: "beacon", label: "EAST" }],
    training: { x: 1300, speed: 220 },
    name: "THE YARD", text: "A ladder of bars, a spine and two whips.", w: 2200, h: 1590, floor: 1520, r: 250,
    platforms: [{ id: "freight-low", x1: 240, x2: 880, y: 1240 },
      { id: "freight-mid", x1: 850, x2: 1490, y: 960 },
      { id: "freight-east", x1: 1290, x2: 1930, y: 680 },
      { id: "freight-high", x1: 850, x2: 1490, y: 410 }],
    bumps: [[1100, 80, 60]],
    bars: [[480, 1380], [620, 1285], [770, 1200], [1100, 1250, "whip"], [1440, 1350], [1640, 1240, "whip"], [1840, 1360],
      [940, 980], [1350, 980], [1640, 970], [1120, 740], [1480, 730], [1300, 500], [1060, 280, "whip"], [1540, 280, "whip"]],
    gaps: [
      { id: "ladder", name: "THE LADDER", t: "bars", a: 1, b: 2, pts: 800 },
      { id: "spine", name: "OVER THE SPINE", t: "span", x1: 1030, x2: 1170, pts: 600 },
      { id: "whips", name: "WHIP TO WHIP", t: "bars", a: 3, b: 5, pts: 1000 },
      { id: "freight", name: "FREIGHT SWITCH", t: "sequence", bars: [13, 14, 12, 10], pts: 1600 },
    ],
    goals: [
      { t: "score", n: 8000, text: "Score 8,000 in a session" },
      { t: "gap", id: "ladder", text: "Climb THE LADDER: bar to top bar" },
      { t: "gap", id: "spine", text: "Fly OVER THE SPINE" },
      { t: "flip", n: 2, text: "Land a double flip" },
      { t: "value", n: 3000, text: "Bank a 3,000 point combo" },
    ],
  },
  {
    id: "tower", district: "03 / UPLINK SPIRE", tagline: "The way up is a chain of good releases.",
    routeTip: "Alternate the rungs. Release while rising; reset your grip in flight.",
    theme: { sky: "#171827", far: "#25273c", ground: "#303147", accent: "#c2b5e8", secondary: "#91d4d7" },
    landmarks: [{ x: 150, y: 280, kind: "antenna", label: "UPLINK" }, { x: 1130, y: 690, kind: "beacon", label: "ALT / 640" }, { x: 190, y: 1060, kind: "gantry", label: "BASE" }],
    training: { x: 650, speed: 220 },
    name: "THE TOWER", text: "Bars stacked high. Climb them.", w: 1300, h: 2100, floor: 2030, r: 300, bumps: [],
    platforms: [{ id: "spire-low", x1: 170, x2: 800, y: 1730 },
      { id: "spire-east", x1: 500, x2: 1130, y: 1420 },
      { id: "spire-mid", x1: 170, x2: 800, y: 1110 },
      { id: "spire-high", x1: 500, x2: 1130, y: 800 },
      { id: "spire-crown", x1: 170, x2: 800, y: 490 }],
    bars: [[400, 1840], [900, 1840], [560, 1710], [740, 1710], [400, 1580], [900, 1580], [340, 1450], [960, 1450],
      [300, 1320, "whip"], [1000, 1320, "whip"], [650, 1170], [650, 950],
      [270, 640], [880, 720], [650, 490], [420, 260, "whip"], [880, 260, "whip"]],
    gaps: [
      { id: "top", name: "TOP RUNG", t: "reach", a: 11, pts: 2000 },
      { id: "cross", name: "CROSSOVER", t: "bars", a: 8, b: 9, pts: 900 },
      { id: "crown", name: "CROWN CLIMB", t: "sequence", bars: [15, 16, 14, 13], pts: 2000 },
    ],
    goals: [
      { t: "score", n: 15000, text: "Score 15,000 in a session" },
      { t: "gap", id: "top", text: "Reach the TOP RUNG" },
      { t: "giants", n: 3, text: "3 giants in one combo" },
      { t: "count", n: 8, text: "String 8 tricks in one combo" },
      { t: "score", n: 35000, text: "Score 35,000 in a session" },
    ],
  },
  {
    id: "pipe", district: "04 / LUNAR RESERVOIR", tagline: "Commit to the crossing. Earn the return.",
    routeTip: "Build speed in the transition. Use SUMMIT to launch across the bowl.",
    theme: { sky: "#0b1728", far: "#192b43", ground: "#24394a", accent: "#97ccef", secondary: "#e3c891" },
    landmarks: [{ x: 1150, y: 90, kind: "moon", label: "NIGHT SHIFT" }, { x: 270, y: 300, kind: "beacon", label: "RESERVOIR" }, { x: 1450, y: 310, kind: "antenna", label: "04" }],
    training: { x: 1100, speed: -220 },
    name: "THE NIGHT PIPE", text: "A deep half-pipe with bars over the drop.", w: 1700, h: 1700, floor: 1640, r: 380, bumps: [],
    platforms: [{ id: "lunar-low", x1: 220, x2: 850, y: 1370 },
      { id: "lunar-east", x1: 800, x2: 1430, y: 1090 },
      { id: "lunar-mid", x1: 220, x2: 850, y: 810 },
      { id: "lunar-high", x1: 800, x2: 1430, y: 530 }],
    bars: [[600, 1380], [1100, 1380], [850, 1450], [850, 1210, "whip"],
      [590, 980], [1110, 980], [850, 750], [590, 520], [1110, 520], [850, 290, "whip"], [460, 1470], [1240, 1470]],
    gaps: [
      { id: "moon", name: "OVER THE MOON", t: "span", x1: 470, x2: 1230, pts: 1500 },
      { id: "summit", name: "SUMMIT", t: "reach", a: 3, pts: 700 },
      { id: "lunar", name: "LUNAR RETURN", t: "sequence", bars: [7, 9, 8, 6], pts: 1800 },
    ],
    goals: [
      { t: "score", n: 25000, text: "Score 25,000 in a session" },
      { t: "gap", id: "moon", text: "Fly OVER THE MOON, across the pipe" },
      { t: "flip", n: 3, text: "Land a triple flip" },
      { t: "value", n: 10000, text: "Bank a 10,000 point combo" },
      { t: "score", n: 60000, text: "Score 60,000 in a session" },
    ],
  },
];
export const UNLOCK = 3; // goals in a park that open the next one
