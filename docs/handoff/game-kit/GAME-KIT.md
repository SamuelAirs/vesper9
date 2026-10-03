# VESPER-9 game kit: how to build a game for this console

This file is everything you need to write a game for VESPER-9 without asking anyone. Read it top to bottom once, then build. It was written on 2026-10-02 against the `main` branch of the public repository https://github.com/SamuelAirs/vesper9 plus the drafts that are about to merge.

## The task, if you were handed this file

Build one or more new games for VESPER-9. Each game comes back as **its own folder** that needs **no edits outside that folder**. Someone else registers it, puts it on the dashboard and runs the full test suites. Section 3 has the exact folder layout. Section 13 is the checklist to run before you hand anything back.

Quality beats quantity. Two games that feel good after ten minutes are worth more than five that don't.

---

## 1. The console in one paragraph

VESPER-9 is a handheld "field instrument" built on a Raspberry Pi 5 with a 7-inch 1024 × 600 screen. Chromium runs fullscreen and draws the games on a Canvas 2D. All input comes from one small node (an ESP32-S3) that has **one arcade button**, **four RGB lamps** in a row (lamp 1 on the left to lamp 4 on the right), **two microphones**, and a small extra board LED. There is no temperature or humidity sensor. (The first node had three lamps, one microphone and a sensor; consoles may still run it, so every game must also work on three lamps, section 6.2.) There is no keyboard, joystick or touchscreen in normal use. On a desktop, `Space` stands in for the button. The look is a retro, phosphor-green, alien field instrument: dark green background, pale green ink, amber and cyan accents, monospace text.

## 2. Design rules (from the owner; these are not optional)

1. **The button and the lamps come first.** Every game is playable with the one button. The lamps should be part of the play: show the state of the game on them so a player could glance at the lamps and know what's happening. Give all four lamps a job (section 6.2).
1a. **The game teaches itself.** The owner's first playtest of outside-built games: the ones that drop the player in without explaining the controls or the lamps were "no clue what's going on", however good the game underneath. Open with a short HOW TO PLAY (two or three screens: the controls, what each lamp means, the goal) on first launch, remember it was seen in the save, and offer it again from `menuActions()` (the After Hours games call it GAME GUIDE, since the console menu already has HOW TO PLAY / CONTROLS). Label lamp-driven choices on screen ("LAMP 1", ...).
2. **Temperature and humidity are not game inputs.** Don't use them.
3. **The microphone only where it really improves the game.** Mic input is slow and coarse (about 10 readings a second, 100–200 ms behind). Most games should not use it. If you do, the game must still be fully playable without it.
4. **Pace, flow and fair difficulty matter most.** In playtests, games that were too slow at the start (a lander that took ages to get going) or too hard early (a fishing game, a runner) flopped. A new player should be having fun inside 10 seconds and should not lose their first run in under 30 seconds. Then let the difficulty climb steadily.
5. **Depth through the game itself, not bolt-ons.** The owner wants games you can sink time into: escalating rules, new elements introduced over a run, mastery, a reason to play again. A recent review found every game carrying the same extras: its own daily challenge, its own achievement list and long hidden menus. **Don't add a daily mode, an achievements/feats screen or a hold-for-menu settings screen.** The platform is getting a shared version of those. A title screen, the game and a result screen are enough. If the game truly needs a choice before a run (for example a difficulty or a ship), keep it to one short screen of at most five options.
6. **Make it its own game.** Existing games, so you don't repeat them: a satellite-gate timing game (Orbit Lock), a hill-flyer (Moonrunner), a swinging tether game (Perihelion), a submarine (Undertow), a breakout (Ricochet), a distance launcher (Ballista), fishing (Tideline), an incremental outpost builder (Outpost), a lamp pendulum timing game (Meridian), a call-and-answer rhythm game (Relay), a reaction test (Light Trial), Morse and memory trainers (Signal School, Echo Vault, Glyph Archive). One-button genres that are not taken yet include, for example: a one-button golf or pool, a tower stacker, a one-button racing line, a rhythm-free music toy, a turn-based tactics or deck game driven by tap-to-cycle and hold-to-choose, a roguelike with timed choices, a puzzle about timing three lamps against each other.

### What "one button" can mean
- **Press**: an instant edge. Good for timing.
- **Hold and release**: `up(e)` carries `e.durationMs`. Good for charge, thrust, tether, aim.
- **Tap to cycle, hold to choose**: good for menus inside a game and for turn-based games. This is how the console's own menus work, so players already know it: a tap moves to the next choice, a hold of about 0.5 s **then release** does it. Choose on the release, not when the hold passes 0.5 s, so the menu gesture can never pick anything. Prefer this over a lamp that scans through the choices on its own: in playtests the scanning cursor confused players. `web/apps/after-hours-kit.js` (in the console) has the shared pieces: `HOLD`, `holdFraction`, `drawGuide` for HOW TO PLAY pages, `drawPressHelp`, `lampCount`, `withFourth`.
- **Rhythm and counts**: double taps and patterns. Careful with the menu gesture, below.

### The menu gesture: design around it
The console's system menu opens anywhere with **tap, tap, hold**: two quick taps (each under about 150 ms, with gaps under about 220 ms) and then a third press held down. In a game the hold needs about 1.6 s (1.0 s on the current `main`, 1.6 s once the platform update merges). The two taps and the start of the hold reach your game first as ordinary presses; when the menu opens the host calls your `cancel()` and the game must put back whatever those presses changed. Section 6.1 shows the one line that does that for you.

Design rule: **don't make "two quick taps and then a long hold" a normal move in your game**, or players will open the menu by accident. Plain holds of any length are fine. Quick taps are fine.

---

## 3. What to hand back: one folder per game

Name each game with a short lowercase id, for example `beacon`. The folder mirrors where the files go in the repository, so integration is a copy:

```
beacon/
  web/apps/beacon.js          the game (required). Larger games may split into beacon-*.js files in the same folder.
  tests/beacon.test.mjs       its tests (required; see section 11)
  catalog-entry.json          its dashboard entry (required; see section 9)
  NOTES.md                    one page: the idea, how a run goes, how difficulty climbs, what you tested, known issues
  screenshots/                optional PNGs of title, play and result at 1024 × 600
```

Rules for the folder:
- **Touch nothing else.** Don't edit `registry.js`, `catalog.json`, `main.js`, anything in `web/engine/` or another game. If you think the engine needs a change, write it up in NOTES.md instead.
- Only `import` from these files (relative to `web/apps/`): `../engine/draw.js`, `../engine/math.js`, `../engine/lightshow.js`, `../engine/input.js`, `./game-kit.js`, and your own `./beacon-*.js` files. No npm packages, no dynamic `import()`, no CDN scripts.
- Export the game class with a **PascalCase** name (the "factory"), for example `export class Beacon`.
- Don't commit, push or open pull requests to the repository. Hand back the folders.

---

## 4. The app contract

The host creates your game with `new Beacon(ctx)` when the player launches it and throws it away when they leave. It then calls these methods if you define them:

| Member | When it is called | What to do |
| --- | --- | --- |
| `constructor(ctx)` | Launch | Keep `ctx` as `this.c` (or `this.ctx`). Load your save. Show the title. |
| `down(e)` | The button goes down, immediately | Game input. `e.source` is `node`, `simulator` or `keyboard`. |
| `up(e)` | The button is released | `e.durationMs` is how long it was held. |
| `cancel()` | Focus changed (menu opened, link lost) | Drop any held input. Undo the menu gesture (section 6.1). |
| `update(dt)` | 60 times a second, `dt = 1/60` exactly | All game simulation. Fixed step; up to 6 catch-up steps per frame. |
| `draw(g)` | Every rendered frame | Draw the whole picture into `g`, a Canvas 2D context, in **960 × 540 logical coordinates**. |
| `event(e)` | Sensor, mic and system events | Most games don't need it. |
| `pause()` / `resume()` | The system menu opens / closes | Simulation is already frozen by the host. Stop lamp writes on pause. |
| `dispose()` | The player leaves | Turn your lamps off. Save anything not yet saved. |
| `menuActions()` | The system menu opens | Optional: return `[{ label, run }]` extra menu entries, for example "NEW RUN". Keep it to one or two. |

Do **not** set `navigation = true`; that is for menu-style instruments, not games.

Rules that follow from this:
- **All timing comes from `update(dt)`.** Keep your own clock (`this.t += dt`). Don't use `setTimeout`, `setInterval`, `requestAnimationFrame`, `Date.now()` or `performance.now()` for gameplay: the host pauses the simulation, and the menu-gesture rewind can only undo what lives in your object's fields.
- **Use `this.c.rng` for randomness**, never `Math.random()`. The rewind restores its state. (`rng.next()` gives 0..1, `rng.range(a, b)`, `rng.int(a, b)`.) For a fixed seed, `new Random(seed)` from `../engine/math.js`.
- **Draw everything every frame.** The host clears nothing for you. Start `draw()` with a full background (for example `space(g, this.t)`). Pair every `g.save()` with `g.restore()`, and put `globalAlpha` back to 1.
- **No DOM.** Don't touch `document`, `window`, `localStorage` or `fetch`. Tests run your game in Node, where none of them exist.

---

## 5. The context (`ctx`): what a game uses

| Call | What it does |
| --- | --- |
| `ctx.rng` | Seeded random generator: `next()`, `range(a, b)`, `int(a, b)`. |
| `ctx.settings()` | Console settings. Read-only. Games care about `latencyMs` (section 6.4), `sound`, `reducedMotion`. |
| `ctx.tone(hz, seconds, wave)` | A short synthesized tone. `wave` is `"sine"`, `"triangle"`, `"square"` or `"sawtooth"`. Keep tones short (≤ 0.3 s) and not too many per second. |
| `ctx.synth.startTone(hz)` / `ctx.synth.stopTone()` | A sustained tone, for example while the button is held. Always stop it in `cancel()`, `pause()` and `dispose()`. |
| `ctx.leds([...])` | Set the lamps, left to right, 0–255 each: nine values (three lamps; the fourth stays dark) or twelve (four lamps). Use `LampBus` instead of calling this directly (section 6.2). |
| `ctx.lampCount()` | 3 or 4: how many lamps this node has. May be missing on an old console; treat missing as 3. |
| `ctx.board([r,g,b])` / `ctx.hasBoardLed()` | The node's small board LED: an optional extra accent, **not a fifth lamp**. Dark unless a game sets it; most games should leave it alone. |
| `ctx.slot()` | `{ index, count, fresh }` when the game uses save slots (section 6.3). |
| `ctx.hud([[label, value], ...])` | The small readouts above the play area, for example `[["SCORE", 1200], ["LIVES", "◆◆◆"]]`. Two to four items. |
| `ctx.hint(text)` | One line of help under the play area. Set it when the phase changes, not every frame. |
| `ctx.best(metric?)` | The saved high score (higher is better). |
| `ctx.score(n, metric?)` | Submit a finished run's score. Call once per run, at the end. |
| `ctx.progress()` | This game's saved object (or `{}`). |
| `ctx.saveProgress(obj)` | Replace this game's saved object. At most **8 KiB** as JSON. Returns a Promise; add `?.catch?.(ctx.error)`. |
| `ctx.error(err)` | Show an error toast. |
| `ctx.menuGesture()` | `{ armed, progress }`: a third press of the menu gesture is being counted now. Only needed if you play a held tone. |
| `ctx.alive()` | False once the game has been left. |

The host also offers microphone access (`ctx.setMic("analyze")`, then `event(e)` receives `{type: "analysis", rmsDb, peakDb, bands[28], pitch: {hz, confidence} | null}` about 10 times a second) and node-timed lamp sequences (`ctx.pattern`). You almost certainly don't need either; if you use the mic, turn it off again with `ctx.setMic("off")` in `pause()` and `dispose()`, and note that the standalone simulator has no microphone.

---

## 6. Four patterns every game uses

### 6.1 Undo the menu gesture: `AppGuard`
`AppGuard` (in `web/engine/input.js`) snapshots every plain-data field of your game at each press. When the host calls `cancel()` after a menu gesture, it puts all of them back as they were before the gesture's first tap. It also holds back `ctx.score()` and `ctx.saveProgress()` for the second or two while a gesture could still be in progress, so a death caused by the gesture's own taps is never saved. Wire it like this, exactly:

```js
constructor(ctx) {
  this.c = ctx;
  this.lamps = new LampBus(ctx);
  /* ... set up all your fields ... */
  this.guard = new AppGuard(this, ctx);   // LAST line of the constructor
}
down(e)    { this.guard.mark(); /* then your input handling */ }   // FIRST line of down()
up(e)      { this.guard.release(); /* ... */ }
update(dt) { this.guard.tick(dt); /* ... */ }
cancel()   { this.guard.rewind(); this.lamps.clear(); /* stop held tones, drop held input */ }
pause()    { this.guard.settle(); this.lamps.sleep(); }
resume()   { this.lamps.wake(); }
dispose()  { this.guard.settle(); this.lamps.sleep(); }
```

For the rewind to work, **all game state must be plain data on `this`**: numbers, strings, booleans, arrays, plain objects, typed arrays, Maps, Sets. Class instances (like `LampBus`) are left alone, so don't keep game state inside your own class instances; use plain objects. Large tables that never change can be skipped: `new AppGuard(this, ctx, { skip: ["levelTable"] })`.

The repository's test suite plays every game, performs the gesture, and fails if score, lives, position or saves changed. Your game will be put through it at integration.

### 6.2 Lamps: `LampBus`
`LampBus` (in `web/apps/game-kit.js`) writes the lamps only when they change, rounds values so the hardware isn't flooded, and handles pause. Each frame give it the resting picture; for short events use `flash`:

```js
update(dt) {
  /* ... */
  this.lamps.frame(dt, restingNineValues);              // every frame (null = dark)
}
onHit() { this.lamps.flash(0.2, (elapsed, total, resting) => fill(LAMP.green)); }
```

Helpers in `web/engine/lightshow.js` build the nine values: `lamps(left, middle, right)` from three `[r,g,b]` (or `null`), `fill(rgb, level)`, `only(index, rgb, level)`, `meter(fraction, rgb)`, `spot(position0to1, rgb, width)`, `dim(rgb, level)`, `blend(a, b, t)`, `ramp(t, [rgb, rgb, ...])`, and the curves `pulse(seconds, hz)`, `blink(seconds, hz)`, `chase(seconds, hz)`. Colours: `LAMP.green`, `amber`, `red`, `cyan`, `blue`, `violet`, `white`, `off`. `lampMax(a, b)` in `game-kit.js` overlays two pictures.

The real lamps update about **17 times a second** and trail the game by roughly 50 ms. Don't build a mechanic that needs lamp changes faster than about 10 per second, and when the player times a press against a lamp, judge generously or allow for the delay.

**Four lamps.** The current node has four; a game must still play on three. Every helper takes the lamp count as its last argument (`fill(rgb, level, n)`, `meter(f, rgb, rest, n)`, `spot(p, rgb, width, n)`, `chase(s, hz, bounce, n)`, `only(i, rgb, level, n)`), defaulting to 3; pass `ctx.lampCount?.() === 4 ? 4 : 3`. Two patterns: spread the same picture over all four (a meter or a moving spot), or keep lamps 1–3 for the three choices or lanes and give **lamp 4 its own job**. The After Hours games do the second: lamp 4 is your health (Crawlspace), the table about to leave (Supper Club), the battery (Night Grid), or where the shot will stop (Pocket Links). Never make lamp 4 the only place something important shows, since a three-lamp node doesn't have it. Remember `flash(...)` pictures need the count too, or lamp 4 goes dark during the flash.

Lamp ideas that worked: the lamps as a meter (health, charge, danger), a spot that moves across them, one colour per lane or threat, a flash of green or red on success or failure, a slow breathing glow on the title screen.

### 6.3 Saves
Keep one save object, give it a `schema` number and write a `migrateSave(raw)` that turns **anything** (nothing, junk, an older schema) into the current shape without throwing. The host itself reads three top-level keys for the dashboard card and the "field record", so include them:

```js
{ schema: 1, runs: 12, milestone: 3, last: { score: 4200, /* any keys */ }, /* your own fields */ }
```

`runs` is the number of finished runs, `milestone` your own "how far" number, and `last` the latest result (label its keys with `record` in the catalog entry). Save at the end of a run and when something worth keeping happens, not every frame. Stay well under 8 KiB.

**Save slots.** A game with progress worth keeping apart (a run in progress, unlocks, a build) can offer up to four saves: set `MyGame.saveSlots = true` after the class. Nothing else changes: `ctx.progress()` and `ctx.saveProgress()` read and write the active slot, slot 1 is the save the game always had, and the system menu shows SAVE SLOT. Add a `slotSummary(value)` method that returns a label of at most 24 characters for a slot's row, such as `"LEVEL 2, ROOM 3/4 · H1"`, built through `migrateSave(value)` so junk can't break it, and test it. A short arcade game with only a best score doesn't need slots.

### 6.4 Timing
If the game judges the timing of a press, allow for input delay: the console's Calibration screen measures it as `ctx.settings().latencyMs` (milliseconds, positive when presses register late). Clamp it to −150…300 and treat a missing value as 0. Judge a press as if it happened `latencyMs` earlier. The reference game does this in `posAt()`.

Keep timing windows humane. Relay's tightest grade is ±50 ms; Orbit Lock narrowing to about ±23 ms was judged too tight by the platform review. Start around ±100 ms and narrow slowly, never below about ±50 ms.

---

## 7. Engine helpers you can import

`../engine/draw.js`:
- `C`: the palette. `C.bg #0c1511` (background), `C.ink #d6efa4` (main), `C.muted #7f9a78`, `C.line #314938`, `C.dark #18271b`, `C.amber #e7b879`, `C.cyan #8fcbc5`, `C.red #eb947a`.
- `text(g, value, x, y, size = 22, color = C.ink, align = "left")`: monospace text, vertically centred on `y`.
- `line(g, x1, y1, x2, y2, color, width)`, `circle(g, x, y, r, color, fill = false, width = 2)`, `diamond(g, x, y, r, color, fill)`.
- `space(g, t, density = 1)`: fills the background and draws a drifting star field. A good first line of `draw()`.
- `grid(g, step)`, `banner(g, title, subtitle, color)` (a centred title card that ends with "PRESS TO BEGIN"), `glyph(g, index, x, y, size, color)`, `wrapText(value, limit)`.

`../engine/math.js`: `TAU`, `clamp(x, a, b)`, `lerp(a, b, t)`, `wrapAngle(a)`, `overlaps(rectA, rectB)` for `{x, y, w, h}`, `Random` (seeded: `new Random(seed)`), `formatTime(seconds)`.

`./game-kit.js`: `LampBus`, `lampMax`, `LOCKOUT` (0.6 s: how long a result screen ignores presses, so a player tapping in rhythm sees it), `announce(game, message, seconds)` and `drawNote(g, game)` for a short banner near the top.

`../engine/input.js`: `AppGuard`.

## 8. Performance budget (this matters)

The Pi draws on the CPU, and recent "visual pass" drafts of other games dropped to 20–30 fps on it. Measured on a desktop with the CPU slowed to Pi-like speeds, the cost is in drawing, not in game logic. Budget:

- **`update()` + `draw()` together under 2 ms** on an ordinary desktop browser (check with the frame check in section 11). That leaves room on the Pi.
- **Never create gradients, patterns or `shadowBlur` every frame.** Build gradients once (in the constructor or the first draw) and reuse them; avoid `shadowBlur` and `filter` entirely.
- **Cache static backgrounds** in an offscreen canvas made once (guard it with `typeof document !== "undefined"` or `typeof OffscreenCanvas !== "undefined"` so Node tests still run), then `drawImage` it each frame.
- Few hundred shapes per frame at most; avoid full-screen translucent overlays stacked several deep.
- Text is fairly expensive; don't draw paragraphs during play.
- Draw in the 960 × 540 coordinate space and let the host scale. Don't read `g.canvas.width` to size your drawing.

## 9. The catalog entry

`catalog-entry.json` describes the game for the dashboard, the system menu and voice launch:

```json
{
  "id": "beacon",
  "name": "BEACON",
  "subtitle": "Catch the light on the middle lamp.",
  "description": "Two or three sentences shown in help. What you do, how a run goes, how it ends.",
  "controls": "PRESS ON THE MIDDLE LAMP",
  "category": "PLAY / TIMING",
  "glyph": 2,
  "factory": "Beacon",
  "voice": ["beacon"],
  "capabilities": ["button", "lights", "audio", "progress"],
  "record": { "score": "Score", "catches": "Caught" },
  "icon": "<circle cx=\"24\" cy=\"24\" r=\"6\"/><path d=\"M6 24H42\"/>",
  "sector": "LAMPS"
}
```

- `id`: lowercase, `[a-z][a-z0-9_-]`, at most 32 characters, not already taken (list below).
- `name` in capitals; `subtitle` one short line; `controls` in capitals with ` · ` between parts.
- `category` must start with `PLAY / ` for a game, then a one-word kind.
- `glyph` 0–5 picks a fallback icon; `icon` (optional, recommended) is the inner SVG of a 48 × 48 line icon drawn with `stroke="currentColor"`, no `<script>`.
- `voice`: one or two plain lowercase English words, so "computer open beacon" launches it. Must not clash. Each word must be an ordinary dictionary word the offline speech model knows: write "crawl space", not "crawlspace"; made-up or joined words cannot be recognised.
- `record`: display names for the keys you put in the save's `last` object.
- `sector` (for the integrator; not part of the real catalog): which dashboard page you suggest. One of `VOYAGES` (long games to sink an evening into), `ARCADE` (quick runs for sharp hands), `LAMPS` (played on the lamps), `MIND` (memory, reading and pattern), `AFTER HOURS` (slower games for the end of the day).

**Ids and voice words already taken**: ballista (launcher), crawlspace (crawl space), supper (supper, kitchen), pocketlinks (golf, pocket links), nightgrid (night grid), stacks, cadence (metronome, timer), descent (lander), diagnostics, drift (drift), echo, environment, ephemeris, glyphs, helix (snake), lantern (lamp), library, meridian (pendulum), morse, oracle (dice), orbit, outpost (station), perihelion (swing), pulsar (rhythm), reaction (lights), relay, resonance (sound), ricochet (breakout), runner, settings, telemetry (system), tideline (fishing), timers, transcribe (notes).

## 10. Gotchas that have bitten this codebase

- **One export per `export const` line.** The simulator bundler only sees the first name in `export const A = 1, B = 2;`, so `B` silently becomes `undefined` in the web build. Write `export const A = 1;` and `export const B = 2;` on separate lines. Also no `export default`, no `export { x as y }` and no `export * from`. Imports must be the plain form `import { a, b } from "../engine/draw.js";` on one line (no `import * as`, no default imports).
- No top-level code with side effects beyond constants; the game may be imported by tests without being launched.
- Don't keep a reference to `ctx` anywhere except `this.c` / `this.ctx`, and don't store functions in game state.
- A result screen must ignore presses for `LOCKOUT` (0.6 s) so a player still tapping doesn't skip it.
- Phase strings (`"title"`, `"play"`, `"over"`) in a field called `phase` read well and the tests expect simple state.
- Turn every lamp off in `dispose()` (`this.lamps.sleep()` does it).

## 11. Testing it yourself

The repository is public. Clone it and work in a scratch copy:

```bash
git clone https://github.com/SamuelAirs/vesper9 && cd vesper9
# Put your files in place for local testing only:
cp ../beacon/web/apps/beacon.js web/apps/
cp ../beacon/tests/beacon.test.mjs tests/
```

**Unit tests (Node 20+).** Write `tests/<id>.test.mjs` with `node:test`. The helpers in `tests/helpers/app-context.mjs` give you a fake `ctx` that records every call (`appContext({ seed, settings, progress })`, then `ctx.calls.leds`, `.tone`, `.score`, `.saved`), a `fakeCanvas()` that accepts every drawing call, and `run(app, seconds, eachFrame)` that steps the game at 60 Hz. Test at least: the core rule (a correct press scores, a wrong one costs), a run ending and saving once, `migrateSave` on junk input, and a minute of random play drawing without throwing. Run `node --test tests/<id>.test.mjs`.

**The menu-gesture test.** For local testing only, register the game: in `web/apps/registry.js` add `import { Beacon } from "./beacon.js";` and `Beacon` to `FACTORIES`; add the catalog entry (without `sector`) to the `apps` array in `vesper/catalog.json`; in `tests/gesture-apps.test.mjs` add your id to the list in the first test. Then:

```bash
python3 scripts/build-catalog.py
node --test tests/gesture-apps.test.mjs     # every test with your id in it must pass
node --test tests/*.test.mjs                 # one Perihelion bot test fails on main already; ignore that one
```

**Play it.** Also add your id to a sector's `apps` list in `vesper/catalog.json` (each sector holds at most six), then `python3 scripts/build-demo.py` writes `VESPER-9-Simulator.html`. Open it in Chromium; `Space` is the button and the three lamps are drawn at the top left. Play a dozen runs. Is the first 30 seconds fun? Does the difficulty climb? Can you read the game from the lamps alone?

**Frame check (optional, recommended).** In Chromium DevTools, Performance tab, set CPU to "6× slowdown", record 10 seconds of play: frames should mostly stay under 16.7 ms. If you have Playwright, `vesper.launch("beacon")` in the page console launches a game directly.

Remember the registry, catalog and gesture-test edits were for local testing; leave them out of what you hand back.

## 12. What is still changing on the platform

These are in open drafts that will merge before your games are integrated. None of them changes the contract above.

- **The play screen.** Games are about to get more of the screen, and the canvas will draw at the size it is shown (with a "render quality" setting). You keep drawing in 960 × 540; don't depend on the canvas's pixel size.
- **The menu gesture's hold** in games goes from 1.0 s to 1.6 s. `AppGuard` already covers both.
- **Four lamps, the board LED and save slots** (sections 5, 6.2, 6.3) arrive with the same platform update; on an older console `ctx.lampCount`, `ctx.board` and `ctx.slot` may be missing, so call them with `?.`.
- **Calibration** gains the timing offset `latencyMs` (section 6.4). On `main` today it is absent, so treat it as 0.
- **The dashboard** is being regrouped into the sectors listed in section 9, with cards showing best score and runs (from `ctx.score` and the save's `runs`).
- **Shared dailies, achievements and menus** at platform level are being designed. That's why rule 5 says not to build your own.

## 13. Checklist before handing a game back

- [ ] Folder layout as in section 3; nothing outside it.
- [ ] Fun inside 10 seconds; the first run lasts at least 30 seconds for a new player; difficulty climbs.
- [ ] Playable with the button alone; the lamps show the game's state; all four lamps have a job, and the game still plays on three.
- [ ] HOW TO PLAY on first launch (controls, what each lamp means, the goal) and in `menuActions()`.
- [ ] No temperature or humidity. Mic only if it truly improves the game, and optional.
- [ ] No daily mode, no achievements screen, no hidden settings menu.
- [ ] `AppGuard` wired exactly as in 6.1; the menu-gesture test passes with your id.
- [ ] `LampBus` for all lamp writes; lamps dark after `dispose()`.
- [ ] Save has `schema`, `runs`, `milestone`, `last`; `migrateSave` survives junk; under 8 KiB.
- [ ] Timing judged with `latencyMs`; windows never tighter than about ±50 ms.
- [ ] No `Math.random`, timers, `Date.now`, DOM or storage in gameplay.
- [ ] No per-frame gradients or `shadowBlur`; update + draw under 2 ms on a desktop.
- [ ] One name per `export const`.
- [ ] Unit tests pass; NOTES.md written.

---

## 14. Reference game: BEACON (complete and passing)

A deliberately small game that shows every pattern above. It passes its own tests and the console's menu-gesture test on all three gesture paces. Copy its structure, not its game. The same files are next to this guide in `beacon/`.

### `beacon/web/apps/beacon.js`

```js
// BEACON — the reference cartridge for docs/GAME-KIT. A light sweeps back and forth across the three
// lamps (and across the screen). Press while it is on the middle lamp to bank a signal; the sweep speeds
// up with every catch. A press away from the middle costs one of three lives. Save schema 1.
import { C, space, text, circle, banner } from "../engine/draw.js";
import { clamp } from "../engine/math.js";
import { LAMP, spot, fill, dim, lamps } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus } from "./game-kit.js";

const LOCKOUT = 0.6;   // a result screen ignores presses this long, so rhythm tapping cannot skip it
const LIVES = 3;
export const WINDOW = 0.11;                       // half-width of the catch zone, as a fraction of the sweep
export const speedAt = (catches) => 0.55 + Math.min(catches, 40) * 0.025;  // sweeps per second

// The console-wide timing offset (Calibration). Positive when presses register late. 0 when absent.
const latency = (ctx) => {
  const v = Number(ctx.settings?.()?.latencyMs);
  return Number.isFinite(v) ? clamp(v, -150, 300) / 1000 : 0;
};

// Bring whatever is stored (nothing, an older schema, junk) to schema 1. Never throw.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return {
    schema: 1,
    runs: n(r.runs),                                   // read by the host: field record, dashboard card
    milestone: n(r.milestone),                         // read by the host: field record
    last: r.last && typeof r.last === "object" ? r.last : {},  // read by the host: field record
    bestStreak: n(r.bestStreak),                       // this game's own
  };
}

export class Beacon {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);                   // class instance: AppGuard leaves it alone
    this.sv = migrateSave(ctx.progress?.());
    this.t = 0;
    this.title();
    // Last line of the constructor: AppGuard snapshots every plain-data field from here on.
    this.guard = new AppGuard(this, ctx);
  }
  title() {
    this.phase = "title";
    this.pos = 0.5; this.dir = 1; this.catches = 0; this.lives = LIVES; this.streak = 0;
    this.flash = 0; this.miss = 0; this.overAt = 0;
    this.c.hint("Press while the light is on the middle lamp.");
  }
  start() {
    this.title();
    this.phase = "play";
    this.pos = 0; this.dir = 1;
  }
  // Where the light was when the player actually pressed, allowing for the timing offset.
  posAt(secondsAgo) {
    let p = this.pos - this.dir * speedAt(this.catches) * 2 * secondsAgo, d = this.dir;
    if (p < 0) { p = -p; d = -d; }
    if (p > 1) { p = 2 - p; d = -d; }
    return p;
  }
  down() {
    this.guard.mark();                                 // first line of down(): snapshot before anything changes
    if (this.phase === "title") { this.start(); return; }
    if (this.phase === "over") {
      if (this.t - this.overAt >= LOCKOUT) this.start();
      return;
    }
    const off = Math.abs(this.posAt(latency(this.c)) - 0.5);
    if (off <= WINDOW) {
      this.catches++; this.streak++; this.flash = 0.25;
      this.c.tone(440 + 40 * Math.min(this.catches, 20), 0.08, "triangle");
      this.lamps.flash(0.2, () => fill(LAMP.green));
    } else {
      this.lives--; this.streak = 0; this.miss = 0.4;
      this.c.tone(110, 0.2, "sawtooth");
      this.lamps.flash(0.35, () => fill(LAMP.red, 0.6));
      if (this.lives <= 0) this.end();
    }
    this.sv.bestStreak = Math.max(this.sv.bestStreak, this.streak);
  }
  up() { this.guard.release(); }
  end() {
    this.phase = "over"; this.overAt = this.t;
    const score = this.catches * 100;
    this.sv.runs++;
    this.sv.milestone = Math.max(this.sv.milestone, Math.floor(this.catches / 10));
    this.sv.last = { score, catches: this.catches, milestone: Math.floor(this.catches / 10) };
    this.c.score(score);                               // AppGuard holds this back while a gesture could still complete
    this.c.saveProgress(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error);
  }
  cancel() {
    this.guard.rewind();                              // undoes the menu gesture's own taps, if that is what this was
    this.lamps.clear();
  }
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt); this.miss = Math.max(0, this.miss - dt);
    if (this.phase === "play") {
      this.pos += this.dir * speedAt(this.catches) * 2 * dt;
      if (this.pos > 1) { this.pos = 2 - this.pos; this.dir = -1; }
      if (this.pos < 0) { this.pos = -this.pos; this.dir = 1; }
    }
    this.c.hud([["CAUGHT", this.catches], ["LIVES", "◆".repeat(Math.max(0, this.lives))], ["BEST", this.c.best()]]);
    // Resting picture: the moving light, plus a dim green marker on the middle lamp as the target.
    const rest = this.phase === "play"
      ? spot(this.pos, LAMP.amber).map((v, i) => Math.max(v, lamps(null, dim(LAMP.green, 0.15), null)[i]))
      : lamps(null, dim(LAMP.amber, 0.25 + 0.25 * Math.sin(this.t * 3)), null);
    this.lamps.frame(dt, rest);
  }
  draw(g) {
    space(g, this.t, 0.4);
    const x0 = 180, x1 = 780, y = 300;
    g.save();
    g.fillStyle = C.dark; g.fillRect(480 - WINDOW * (x1 - x0), y - 40, 2 * WINDOW * (x1 - x0), 80);
    g.restore();
    for (let i = 0; i < 3; i++) circle(g, x0 + i * (x1 - x0) / 2, y, 26, i === 1 ? C.cyan : C.line);
    if (this.phase === "play") circle(g, x0 + this.pos * (x1 - x0), y, 14, this.miss > 0 ? C.red : C.amber, true);
    if (this.flash > 0) circle(g, 480, y, 26 + 120 * (0.25 - this.flash), C.ink);
    if (this.phase === "title") banner(g, "BEACON", "Press while the light is on the middle lamp. Press to begin.");
    if (this.phase === "over") banner(g, "SIGNAL LOST", this.catches + " caught · best streak " + this.sv.bestStreak, C.amber);
    text(g, "STREAK " + this.streak, 480, 420, 18, C.muted, "center");
  }
  pause() { this.guard.settle(); this.lamps.sleep(); }
  resume() { this.lamps.wake(); }
  dispose() { this.guard.settle(); this.lamps.sleep(); }
}
```

### `beacon/tests/beacon.test.mjs`

```js
// Beacon: rules, save migration, and a smoke run of draw(). Runs with: node --test tests/beacon.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { Beacon, migrateSave, WINDOW } from "../web/apps/beacon.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const press = (app) => { app.down({ source: "keyboard" }); app.up({ source: "keyboard", durationMs: 60 }); };

test("a press on the middle lamp catches; three presses off it end the run and save", () => {
  const ctx = appContext();
  const app = new Beacon(ctx);
  press(app);                                   // title -> play
  assert.equal(app.phase, "play");
  app.pos = 0.5; press(app);
  assert.equal(app.catches, 1);
  for (let i = 0; i < 3; i++) { app.pos = 0.05; press(app); }
  assert.equal(app.phase, "over");
  run(app, 3);                                  // let AppGuard release the held score and save
  assert.deepEqual(ctx.calls.score.at(-1), [100, "default"]);
  assert.equal(ctx.calls.saved.at(-1).runs, 1);
});

test("the timing offset judges where the light was when the player pressed", () => {
  const ctx = appContext({ settings: { latencyMs: 100 } });
  const app = new Beacon(ctx);
  press(app);
  app.dir = 1; app.pos = 0.5 + WINDOW + 0.05;   // just past the zone now, inside it 100 ms ago
  press(app);
  assert.equal(app.catches, 1);
});

test("any stored shape migrates to schema 1", () => {
  for (const raw of [undefined, null, 7, "x", {}, { runs: -3, bestStreak: "a" }, { schema: 1, runs: 4, bestStreak: 9 }]) {
    const s = migrateSave(raw);
    assert.equal(s.schema, 1);
    assert.ok(Number.isInteger(s.runs) && s.runs >= 0);
  }
  assert.equal(migrateSave({ schema: 1, runs: 4, bestStreak: 9 }).bestStreak, 9);
});

test("a minute of play draws without throwing and stays inside its lamps contract", () => {
  const ctx = appContext();
  const app = new Beacon(ctx), g = fakeCanvas();
  run(app, 60, (i) => { if (i % 37 === 0) press(app); if (i % 10 === 0) app.draw(g); });
  for (const v of ctx.calls.leds) assert.ok(v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
  app.dispose();
});
```

### `beacon/catalog-entry.json`

```json
{
  "id": "beacon",
  "name": "BEACON",
  "subtitle": "Catch the light on the middle lamp.",
  "description": "A light sweeps across the three lamps. Press while it is on the middle one; every catch makes it faster. Three misses end the run.",
  "controls": "PRESS ON THE MIDDLE LAMP",
  "category": "PLAY / TIMING",
  "glyph": 2,
  "factory": "Beacon",
  "voice": ["beacon"],
  "capabilities": ["button", "lights", "audio", "progress"],
  "record": { "score": "Score", "catches": "Caught" },
  "sector": "LAMPS"
}
```
