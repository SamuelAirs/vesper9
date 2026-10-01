# audit-performance report

Agent: audit-performance. Branch: `worktree-agent-aa2a5f4ff28668ba4`. Raw data: `fleet/work/audit-performance/` (`baseline/`, `ab/`). Scripts: `tests/audit/`.

## 1. Outcome

On this Pi the JavaScript in the apps is cheap: `update` + `draw` average 0.2 to 2.1 ms per frame and the host's own overhead is 0.1 to 0.5 ms. The cost is the browser painting and compositing a canvas that changes every frame. Headless Chromium (software rendering) spends 65 to 92 % of a core on a game and 8 to 15 % on an instrument page, and the idle dashboard was spending 43 % of a core redrawing a decorative dot that moves about 4 px/s. I measured everything (scripts committed), made four small optimisations with before/after numbers (the idle dashboard now costs 19 % instead of 43 %), and left larger proposals below. The service is negligible: 0.05 to 0.6 % CPU, 41 MiB RSS, +44 KiB/min growth.

Conditions you must read before trusting any absolute number (section 6): the Pi was 85 to 100 % busy (load average 8 to 13) from other agents the whole time, so wall-clock frame times, p95s and fps in games are inflated.

## 2. Findings, ranked by measured cost

Totals are CPU as a percent of one core, summed over my headless Chromium processes (renderer + GPU/compositor + browser + utility), from `/proc`.

| # | Cost | Measured | Where | Status |
| --- | --- | --- | --- | --- |
| 1 | Painting and compositing a canvas that changes each frame | Games 65 to 92 % total (renderer 27 to 44 %, gpu-process 35 to 46 %); instrument pages 10 to 15 %. Drift (Undertow) is worst: 1298 canvas calls per frame (993 `lineTo`), frame total mean 2.06 ms / p95 9.9 ms, 92 % total | `web/apps/games.js` `Undertow.draw` (8 sine polylines of 121 points each frame, up to ~12 `glyph()` per gate), `engine/draw.js` `space()` | Proposal A, B |
| 2 | Idle dashboard redrew the orrery canvas on every rAF (about 60 fps), `ambient()` = 206 canvas calls/frame, 185 us of recording | 43.4 % total (renderer 29.9, gpu 11.9). Instrument pages with no canvas cost 10 to 15 % | `main.js` `frame()` | **Fixed (commit 4f4f63d): 43.4 to 18.7 %** |
| 3 | Node Scope re-renders its whole panel on every microphone level event | Mic on (commands mode, synthetic source): 8 level msgs/s, 8.2 `innerHTML` writes/s (9 KB/s of markup), 5.45/s byte-identical, layout 92 ms/s (9 % of a core), 403 nodes/s created | `utilities.js` `Diagnostics.event` and `main.js` `ctx.content` | **Fixed for identical markup (624b7ed)**; proposal C for the rest |
| 4 | HUD rebuilt with `innerHTML` whenever any value changes | Moonrunner 17.2 rebuilds/s (206 nodes/s), 22 layouts/s, 47 ms/s layout; Undertow 4/s | `main.js` `hud()` | **Fixed (02e4989): layout 77 to 38 ms/s** |
| 5 | Status bar rewrote about nine identical text nodes every second | 10.6 mutation records/s and 1.2 layouts/s on an idle page, forever | `main.js` `status()`, clock task | **Fixed (d592368): 0.13/s** |
| 6 | Environment re-renders panel and both SVG charts every second (`tick()`) | 1.9 KB/s of markup, layout 6.5 ms/s, 45 nodes/s; only the "N s AGO" text changes | `utilities.js` `Environment.tick` | Proposal D |
| 7 | rAF loop never stops: instrument pages still wake the renderer 60 times a second | Floor of 10 to 15 % total (renderer 7.5, gpu 2) with nothing to draw | `main.js` `frame()` | Proposal E |
| 8 | Font switching in `text()`: sets `g.font` with a new string each call | 8 us per call with the same font, 51 us when sizes alternate (+43 us per switch). Morse draws 6 texts of 5 sizes per frame | `engine/draw.js` `text()` | Proposal F |
| 9 | `space()` star field: 100 `fillRect` plus 100 `globalAlpha` sets each frame | 52 us/frame recording at density 1 (17 us at 0.3), 22 to 118 canvas calls/frame in every game | `engine/draw.js` | Proposal F |
| 10 | Draw continues while paused behind `backdrop-filter: blur(4px)` | Not measured (software rendering cannot show the GPU blur cost). Game state is frozen, the picture is identical every frame | `main.js` `frame()`, `style.css` `.overlay` | Proposal G (unmeasured) |
| 11 | A finished timer that is never removed keeps a 1 Hz `timers` broadcast and a page status refresh alive | 10 msgs / 1720 B in 10 s vs 0 without a timer (`perf-finished-timer.cjs`) | `server.py` `tick()` (`if self.timers:`) | Proposal H |
| 12 | SQLite `commit()` on the event loop | tmpfs: 0.05 ms; real NVMe: median 1.7 ms, p95 6 ms, max ~10 ms per `put`/`score`. Only at run end, progress save, timer change, sensor save every 30 s | `vesper/storage.py` | Proposal I (rough) |
| 13 | Smaller per-frame items | `frameStats()` sorts 600 samples: 222 us per Node Scope render; `lights.flush()` allocates a Promise each frame (1 us); `frameTimes.shift()` on a 600-array (0.2 us); hud key `JSON.stringify` 0.6 us per update step | `main.js` | Not worth doing alone |

No quadratic behaviour found. Per-frame allocations exist (Moonrunner builds two rects per obstacle per step and `filter()` per step; Undertow `unshift` plus `filter`; `hud([...])` arrays each step) but measure under 0.2 ms per frame.

### Proposals (not done)

- **A. Undertow draw** (it is the costliest game: 1298 canvas calls and 92 % total CPU). The 8 background wave lines are drawn with 121 points each (993 `lineTo` plus 968 `Math.sin` per frame); drawing them at 16 px steps halves that with no visible change at the line width used, and each gate's glyph column (up to about a dozen `glyph()` calls with `save`/`restore`) could be a pre-rendered sprite. Expected: roughly half the canvas calls in that game. Visible risk: low but it is a visual change, so a person should look.
- **B. Static background layers.** `space()` plus `grid()` plus fixed text are redrawn from scratch every frame. Rendering the static parts to an offscreen canvas once and blitting with `drawImage` removes 30 to 120 calls per frame in every game. Stars scroll (`x - t*0.8`), so blit twice with an offset.
- **C. Node Scope.** Update only the changed `<b>` values in place instead of rebuilding the 14-row list, and throttle the `level` re-render to 2 Hz. Expected: layout 92 ms/s to under 10 ms/s with the mic on.
- **D. Environment.** In `tick()` update only the "UPDATED N s AGO" text and re-render charts on new sensor data (every 5 s in the simulator). Expected: about 5 ms/s layout and 1.9 KB/s of markup removed.
- **E. Stop the rAF loop when nothing needs it.** On instrument pages (and the dashboard after fix 2) schedule rAF only while a press is held or LED values are pending; use a 100 ms timer otherwise. Expected: instrument pages 10 to 15 % to about 2 to 4 %. Riskier: the input contract (immediate edges, hold visuals, `lights.flush` cadence) depends on `frame()`; needs a test of the button path.
- **F. `text()`**: cache the last font string and skip the assignment when equal; group text calls by size. Saves up to 43 us per switch, about 0.2 ms per frame in text-heavy apps (Signal School). Cheap, but it touches the shared helper used by every game, so I left it for the host owner.
- **G. Skip `draw()` while `this.paused`** once the first frame after pausing is drawn. Expected gain on the real GPU path is the blur re-composite; I could not measure it (software rendering). Needs a game-by-game check that nothing draws from wall-clock time while paused.
- **H. Server**: broadcast `timers` only while some timer is running (plus once on change). Saves 1 msg/s and a page status refresh.
- **I. Storage**: set `PRAGMA synchronous=NORMAL` (safe in WAL) or move commits to a thread. Saves up to 6 to 10 ms stalls of the event loop (serial reads, WebSocket). `vesper/` is out of my scope, so not changed.
- **J. Console CRT overlay** (`.console.crt:after`, a full-screen repeating-gradient layer at opacity .22): no measurable effect in software rendering (dashboard 22 vs 17.7 %, runner 58 vs 67 % with the overlay off; noise). Its cost on the GPU path is unknown. Test by toggling "Phosphor texture" while watching the live kiosk's gpu-process CPU.

## 3. Results

### 3.1 Per-app frame cost

Command: `FRAME_SECONDS=25 node tests/audit/perf-frames.cjs` (bot-driven play through the real WebSocket button path, 25 s per app, 1024 x 600). Milliseconds. "frame" is the whole `frame()` call; "host" is frame minus update minus draw. `performance.now()` here has 100 us resolution, so the minimum of 15 batches of 50 back-to-back calls ("min batch") is given as a cleaner figure for pure recording cost. Machine busy 99 to 100 % during these runs (see section 6): fps below 60 in games is starvation by other processes, not the app.

| App | Phases seen | upd/s | update mean / p95 | draw mean / p95 | host mean / p95 | frame mean / p95 | min batch draw / update |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard (orrery redraw, before fix) | - | - | - | - | - | 0.62 / 1.7 | draw 0.16 |
| Orbit Lock | play | 61.5 | 0.046 / 0.1 | 0.58 / 1.0 | 0.25 / 0.3 | 0.88 / 2.4 | 0.23 / 0.00 |
| Moonrunner | play | 60.6 | 0.40 / 0.8 | 0.85 / 1.5 | 0.52 / 2.4 | 1.77 / 7.2 | 0.17 / 0.002 |
| Undertow | play | 59.2 | 0.13 / 0.5 | 1.42 / 5.2 | 0.50 / 1.6 | 2.06 / 9.9 | 0.59 / 0.002 |
| Echo Vault | show, listen, between | 60.6 | 0.053 / 0.3 | 0.41 / 0.8 | 0.23 / 0.4 | 0.69 / 1.4 | 0.10 / 0.002 |
| Light Trial | wait, go, result | 60.8 | 0.057 / 0.2 | 0.41 / 0.9 | 0.18 / 0.3 | 0.65 / 2.0 | 0.12 / 0.004 |
| Glyph Archive | watch, choose, between | 60.4 | 0.035 / 0.1 | 0.43 / 0.7 | 0.17 / 0.3 | 0.64 / 1.3 | 0.21 / 0.002 |
| Signal School (guided) | key | 60.8 | 0.056 / 0.1 | 0.40 / 0.9 | 0.26 / 0.6 | 0.71 / 2.5 | 0.19 / 0.002 |
| Timers / Notes / Atmosphere / Node Scope / Settings | - | - | - | - | 0.11 to 0.16 / 0.2 | 0.11 to 0.16 / 0.2 | - |

The simulation step holds 60 updates per second in every game. The host's own cost outside the app (input router, light flush, frame statistics, wrapper) is 0.17 to 0.52 ms per frame; Moonrunner's higher figure is hold-bar writes while the button is down. Canvas calls per frame (`perf-frames.cjs` pass 2): dashboard 206, Orbit 413, Moonrunner 285, Undertow 1298, Echo 56, Light Trial 126, Glyph 120, Signal School 43.

Frame interval (rAF): 16.7 ms median, p95 16.8 ms over a 600-sample window at the end of the soak (section 3.4). Note this is the host's "FRAME / p95" figure in Node Scope; it is the time between frames, not the app's cost, and it only reads 16.7 when the browser is not starved.

### 3.2 Instrument and state matrix (DOM churn, traffic, CPU)

Command: `STATE_SECONDS=20 MODEL=<vosk model> node tests/audit/perf-states.cjs`. Pass A (uninstrumented) gives CPU and layout counts; pass B (MutationObserver, `innerHTML` setter hook, WebSocket frame events) gives DOM and traffic. Games are bot-driven. CPU is percent of one core. "+nodes/s" counts nodes added (descendants included), "ih" = `innerHTML` writes per second, "chars" = characters assigned per second.

| State | Chromium total % (renderer / gpu) | Service % | layouts/s (ms/s) | mutation records/s | +nodes/s | ih/s (chars/s) | WS msgs/s (B/s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard, idle (before fixes) | 42.8 (30.6 / 11.4) | 0.05 | 1.2 (2.1) | 10.6 | 9.4 | 0 | 0.15 (15) |
| Orbit Lock | 65.3 (27.4 / 34.7) | 0.25 | 4.5 (12.6) | 44.5 | 26.6 | 0.95 (245) | 9.9 (652) |
| Moonrunner | 85.6 (39.2 / 45.0) | 0.05 | 22.6 (47.1) | 43.5 | 229.6 | 17.2 (4556) | 2.1 (146) |
| Undertow | 91.9 (44.2 / 45.5) | 0.50 | 22.1 (30.0) | 89.6 | 69.7 | 4.05 (811) | 18.5 (1210) |
| Echo Vault | 74.9 (31.2 / 42.3) | 0.35 | 9.8 (14.9) | 66.9 | 29.8 | 0.8 (219) | 10.2 (663) |
| Light Trial | 83.3 (35.8 / 46.5) | 0.25 | 5.3 (7.8) | 29.6 | 22.5 | 0.7 (194) | 6.9 (515) |
| Glyph Archive | 74.4 (29.9 / 44.0) | 0.05 | 2.8 (3.8) | 12.7 | 11.2 | 0.05 (14) | 1.0 (74) |
| Signal School | 79.9 (32.3 / 46.4) | 0.35 | 13.2 (14.8) | 86.9 | 28.7 | 0.4 (111) | 14.2 (1173) |
| Timers (30 min timer running) | 12.2 (9.5 / 2.2) | 0.05 | 1.95 (2.75) | 26.6 | 24.4 | 1 (206) | 1.2 (213) |
| Field Notes | 10.0 (7.6 / 2.2) | 0.05 | 1.2 (1.6) | 10.6 | 9.4 | 0 | 0.2 (21) |
| Atmosphere | 14.8 (12.0 / 2.4) | 0.05 | 1.2 (6.5) | 15.4 | 45.4 | 1.2 (1900) | 0.2 (21) |
| Node Scope, mic off | 9.8 (7.5 / 2.0) | 0.0 | 1.2 (1.6) | 12.4 | 19.0 | 0.2 (218) | 0.2 (21) |
| Settings | 10.9 (8.3 / 2.4) | 0.05 | 1.2 (2.1) | 10.6 | 9.4 | 0 | 0.2 (21) |
| Node Scope, mic on (commands, synthetic source, Vosk) | 52.7 (38.3 / 4.9) | 9.3 | 9.2 (92.0) | 86.8 | 403 | 8.2 (8988, 5.45/s identical) | 31.5 (32207) |

The "dashboard with finished timer" row in the raw JSON is invalid (the script removed the timer first); the real test is `tests/audit/perf-finished-timer.cjs`: 0 `timers` messages in 10 s without a timer, 10 messages (1720 B) with a finished one.

Where the DOM churn comes from, by region (mutation records/s): the instrument bar, masthead and control deck rewrite status text every second (fixed); Moonrunner's HUD rebuilds 17/s; Undertow's instrument bar took about 57 records/s from `lightVisual()` in a 6 s trial run (not broken out in the 20 s baseline) (three lamps: style plus `aria-label`, on every `leds` event, which in Undertow is every press and release); `control-deck` takes 16/s in Moonrunner while the button is held (`holdVisual()` writes `style.width` and the title text every frame during a press, even with a zero ratio).

Messages and what triggers them (per second; Playwright frame events, payload bytes only):

| State | Traffic | Trigger |
| --- | --- | --- |
| Dashboard idle | 0.15 to 0.2 msg/s, 15 to 21 B/s: `sensor` | simulated sensor every 5 s (the real node sends its own) |
| Orbit Lock | 9.9: `cmd:leds` 1.95 + `leds` event 1.95 + `reply` 1.95, `cmd:button` 1.9 + `button` event 1.9 | each LED change is a command, a reply and an echoed event; each press is a command plus an event |
| Undertow | 18.5: button 3.7 + 3.7, leds 3.7 + 3.7 + 3.7 reply | press and release both change the lamps |
| Signal School | 14.2: adds `score` / `progress` / `scores` at 0.35/s | every answer saves progress |
| Timers | 1.2: `timers` 1/s (192 B each) | server 1 Hz `tick()` |
| Node Scope + mic | 31.5 msgs/s, 32 KB/s: 23 binary audio frames/s out (31.8 KB/s), `level` 8/s in (427 B/s) | browser microphone PCM to the service (simulator only; the real node does not send audio to the browser), `level` every 100 ms |

### 3.3 Service CPU and memory

Command: `node tests/audit/perf-soak.cjs` (300 s, 25 s per app, all 12 apps, samples every 5 s; a 30-minute timer exists throughout, so `timers` broadcasts run all the time).

| Measure | Value |
| --- | --- |
| Idle (dashboard, no timers) | 0.05 % CPU |
| In a game | Orbit 0.28, Moonrunner 0.12, Undertow 0.59, Echo 0.36, Light Trial 0.28, Glyph 0.08, Signal School 0.44 % |
| Instruments | 0.0 to 0.08 % |
| 5-minute rotation, per-sample range | 0 to 0.79 %, mean about 0.2 % |
| Mic on, Vosk commands mode, synthetic source | 9.3 % (Vosk worker thread plus 23 audio frames/s) |
| RSS start / end | 41,136 / 41,380 KiB (+244 KiB, slope +44 KiB/min, linear fit over 59 samples) |
| Threads / open fds | 4 / 18 at start, 4 / 12 at end |
| Service ready after spawn | 578 to 1035 ms (loaded machine) |

Growth: RSS rose 0.6 % in 5 minutes, monotonic and slow. Five minutes cannot separate a leak from allocator warm-up; the 20-minute `tests/soak.cjs` is the right instrument for that. No errors, no pending requests at the end.

### 3.4 Page memory

Command: same soak run. JS heap read through CDP `Runtime.getHeapUsage` after a forced GC.

| | Start | After 5-minute rotation |
| --- | --- | --- |
| JS heap used (forced GC) | 1.38 MiB (total 2.56) | 1.90 MiB (total 2.81) |
| DOM nodes | 344 | 382 |
| JS event listeners | 47 | 60 |

Unforced heap samples range 1.7 to 2.7 MiB (heap slope +0.064 MiB/min including garbage). The listener count rose by 13 over the rotation, unverified as a leak: five minutes is too short, and the apps legitimately add listeners per mount; check with a longer run and a per-app breakdown if it keeps climbing.

### 3.5 Start-up

Command: `RUNS=8 node tests/audit/perf-startup.cjs`. Cold = new browser context (empty cache), warm = reload with the HTTP cache. Chromium headless, software rendering, loaded machine.

| | Cold median (range) | Warm median (range) |
| --- | --- | --- |
| Navigation to `vesper.loaded` (first `state` message handled) | 1061 ms (950 to 1386) | 677 ms (418 to 876) |
| DOMContentLoaded | 692 ms | 270 ms (earlier 3-run trial) |
| First contentful paint | 652 ms | - |
| Requests | 16 | 16 |
| Bytes | 157,968 transferred, 153,168 decoded (no compression) | 300 transferred (304 revalidation) |

What is loaded (decoded bytes): `style.css` 22.7 KB, `main.js` 30.9 KB, `apps/games.js` 28.2 KB, `apps/utilities.js` 19.8 KB, `apps/morse.js` 9.9 KB, `engine/demo.js` 7.2 KB (the standalone-simulator bridge, loaded and unused when the service is present), `apps/catalog.js` 6.7 KB, the rest under 5 KB each, `index.html` about 7 KB. The ES module graph is three levels deep (`main.js` at about 150 to 307 ms, then `engine/*` and `catalog` at about 490 to 760 ms, then `games`/`morse`/`utilities` at about 720 to 800 ms): each level waits for the previous one. The module waterfall, not the byte count, is the start-up cost; `<link rel="modulepreload">` for the second and third levels in `index.html` would remove two of three round trips. A cold start of about 1 s is acceptable for a kiosk that loads once.

## 4. What I changed

One optimisation per commit. All measured with `tests/audit/perf-ab.cjs`: an old and a new copy of the tree run in interleaved rounds (so other agents' load hits both), median of 4 rounds, 15 s windows. The machine was 95 to 100 % busy, so percentages carry noise of several points; mutation, layout and node counts are exact.

1. `4f4f63d` **Dashboard orrery redrawn at 10 Hz (1 Hz when reduced motion is on)** (`web/main.js`). Idle dashboard Chromium CPU 43.4 % to 18.7 % (renderer 29.9 to 12.9, gpu 11.9 to 4.6), script time 36.0 to 15.9 ms/s. With reduced motion on: 46.3 % to 14.0 %. The same draw function renders the same picture; the dot moves 0.4 px between redraws. I looked at the dashboard screenshot from the browser test and it is unchanged.
2. `d592368` **Status bar writes only changed text** (`web/main.js`). Mutation records 10.6/s to 0.13/s, layouts 1.2/s to 0.13/s, layout time 2.8 to 0.08 ms/s. CPU change was inside the noise (23.5 to 22.7 %).
3. `02e4989` **HUD updated in place when its labels are unchanged** (`web/main.js`). Moonrunner layout time 77.1 to 38.5 ms/s, CPU 54.4 to 47.9 % (noisy). Layout count unchanged (14/s: the text still changes). Undertow: no difference beyond noise.
4. `624b7ed` **`ctx.content()` skips identical markup** (`web/main.js`). Node Scope with 8 level events/s of constant level (best case: all identical): layout time 58.3 to 13.6 ms/s, CPU 44.6 to 20.5 %. With a real microphone about two thirds of rewrites (5.45 of 8.2/s) are identical, so expect a smaller but real gain.
5. Scripts, no behaviour change: `39d562f` audit scripts, `c238050` driver, `7056861` micro-benchmark and finished-timer scripts.

Files touched: `web/main.js` (four small hunks), `tests/audit/*`. Nothing under `vesper/`.

## 5. Performance budget for authors of new apps

Measured headroom: the existing games use 0.4 to 2.1 ms of JavaScript per frame, and the expensive part is what the browser must paint, so the budget is in canvas operations as much as milliseconds. Keep `update` + `draw` under **4 ms mean and 8 ms at the 95th percentile** on this Pi (one quarter of the 16.7 ms frame, so the rest of the page and speech recognition still fit), and keep **a frame under about 400 canvas calls** (Orbit Lock, the heaviest healthy game, makes 413; Undertow's 1298 is the outlier to avoid). Do not use `shadowBlur`, `filter`, `getImageData`, gradients created per frame, or `measureText` in `draw`; do not set `g.font` more than once per size (group text by size), do not change `globalAlpha` per element when elements can be batched by alpha, and merge shapes of one colour into a single path with one `stroke()`/`fill()`. Pre-render anything static (backgrounds, glyph sprites, star fields) to an offscreen canvas once and `drawImage` it. Allocate nothing per frame in `update` (no `filter()`, `map()`, object literals for collision tests; use a pool or swap-remove). Call `ctx.hud()` and `ctx.leds()` only when values change: each HUD change costs a layout and each LED change costs three WebSocket messages (command, reply, echoed event) and a lamp style rewrite. Never write to the DOM from `draw`. Instrument panels: re-render only on data that changed, never faster than 1 Hz unless the data changes, and update in place rather than replacing `innerHTML` while the user may be navigating (focus and scroll are lost, and nodes churn). Measure with `tests/audit/perf-frames.cjs` before and after.

## 6. Verification

Commands (all from the worktree root, with `PYTHON`, `PLAYWRIGHT_PATH`, `TEST_BROWSER_BIN` as in `fleet/RULES.md`):

```
node tests/audit/perf-startup.cjs              # RUNS=8
FRAME_SECONDS=25 node tests/audit/perf-frames.cjs
STATE_SECONDS=20 MODEL=.../vosk-model-small-en-us-0.15 node tests/audit/perf-states.cjs
node tests/audit/perf-soak.cjs                 # 300 s
node tests/audit/perf-micro.cjs
node tests/audit/perf-finished-timer.cjs
VARIANTS="old=/path/a,new=/path/b" ROUNDS=4 WINDOW=15 SCENARIOS=dashboard,runner node tests/audit/perf-ab.cjs
tests/audit/run-all.sh                         # startup, frames, states, soak in sequence
```

Results of the existing checks at the last commit (`624b7ed`):

- `python -m unittest discover -s tests -p 'test_*.py'`: 29 tests, OK.
- `node --test tests/*.test.mjs`: 33 pass, 0 fail.
- `python3 scripts/build-catalog.py --check`: exit 0.
- `python3 scripts/build-demo.py` then `node tests/browser-smoke.cjs`: **fails** at line 79 (the four-click menu step, `false !== true`), and fails identically on the unmodified baseline `e3a723e` under this load (8 to 10). STATUS.md records that step as load-flaky and fixed on main (`732c584`). Using `732c584`'s version of the test file (copied temporarily, not committed) the smoke test passed on my branch after each of the four optimisation commits ("passed": true, 12 apps exercised).
- Baseline files and A/B JSON are under `fleet/work/audit-performance/`.

### What this set-up can and cannot tell us

- Headless Chromium here renders in software (`--disable-gpu`); the kiosk uses GPU rasterisation through ANGLE/GLES. Absolute CPU percentages, the renderer/gpu-process split and anything about compositing (the CRT overlay, the pause-menu blur, canvas scaling) do not transfer. Layout and style counts, DOM and WebSocket traffic, `update`/`draw` JavaScript time, canvas call counts and the Python service numbers do transfer.
- The Pi was 85 to 100 % busy the entire time (other agents' tests and speech benchmarks). Wall-clock frame times and p95 are inflated; games ran at 22 to 51 fps in my window because they were starved, not because of the app. I used medians, minima of batches and interleaved before/after runs to compensate. A quiet-machine rerun with `run-all.sh` would tighten every number.
- The CPU is fixed at 1.5 GHz here (`cpuinfo_min_freq == cpuinfo_max_freq`), about 60 % of a stock Pi 5's top speed, so it is not the cause of noise but absolute JS times are on a slower clock than a default Pi.
- `performance.now()` is 100 us here. Cross-origin-isolating the page for 5 us timing hung the page load in this environment, so I dropped it.
- The service data directory is on tmpfs in the scripts; the real console uses NVMe, where commits take 1.7 ms (measured separately).
- A passive `top` snapshot of the live kiosk before the reboot (not touched, port 8799 not used) showed its GPU process at 27 % and its page renderer at 16 to 18 % of a core, averaged over about 22 minutes of uptime. I do not know which screen it was on (probably the dashboard). That is consistent with finding 2 but it is not a controlled measurement; the after-fix number on the real kiosk is unknown until the change is deployed.
- Bots play the games through the real WebSocket path; they are not human timing. The synthetic microphone is Chromium's fake device, not real audio.

## 7. Not done / uncertain

- Quiet-machine re-run of everything.
- Real-display (GPU) cost of the CRT overlay, the blur under the pause menu, and canvas scaling to the 1024 x 600 stage.
- JS listener growth (47 to 60) is unverified as a leak.
- Possible correctness issues seen in passing (not my scope, unverified): Node Scope re-renders call `actions()` with labels that change ("SELECT LIGHT / LEFT"), and `setNav` matches focus by label, so the focused item may jump while the user navigates; `lightVisual()` runs per `leds` event and sets `aria-label` each time; quick toggling in a game (Undertow with a high hold/release rate) can register as the four-click menu gesture (my bot needed a 190 ms dwell to avoid it).
- Proposals A to J are unimplemented.

## 8. Branch

`worktree-agent-aa2a5f4ff28668ba4`, last commit `624b7ed`. Commits: `39d562f`, `4f4f63d`, `d592368`, `02e4989`, `c238050`, `7056861`, `624b7ed`.
