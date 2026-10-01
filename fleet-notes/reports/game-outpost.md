# game-outpost report: OUTPOST (web/apps/outpost.js)

## 1. Outcome
OUTPOST is built from scratch as a deep incremental game: ten machines, 48 one-time upgrades (machine doublers, tap, synergies, battery banks, grid sync), count milestones, a relocation (prestige) with a ten-node bearing tree, expeditions on wall-clock timers, relics, and rare signal flares. It saves often, credits time away (capped, upgradeable), and has a status-board lamp design. All tests pass; nothing is left running.

## 2. Details
**Layers and when they appear** (mixed player: 2.5 min active per 10 min, tapping 4/s, check-ins every 2.5 min; real simulated cartridge, `tests/helpers/outpost-bot.mjs`):
- Run 1: first machine 0:00 (first purchase via the real interface 8-10 s), first x2 milestone 0.7 min, first machine upgrade 1.4 min, first synergy 5 min, core drill 7.5 min, relocation tease shown 18 min, observatory 27.5 min, relocation worth doing at 47.7 min (bot acts at its next check-in, 50 min).
- Run 2 (spending 8 bearings on the tree): ready at 13 min, acted at 15 (30% of run 1). Run 3: 7.4 min.
- Casual player (1 min active per 10): first relocation 56 min, second 24 min (43%). Fully active: 17.5 min, then 8.6 min.
- Expeditions need tree node SURVEY TEAM (shown after 6 lifetime bearings). Flares begin after 150 run signal.
- Deep policy (relocate only when gain >= current bearings): 8 runs of 30-40 min, reaches the last machine from run 7, gains double per run, everything stays finite.

**Economy**: cost = base x 1.15^owned (x0.94^BULK RATE); milestones at 10/25/50/100/150/200/250/300 owned double a machine; bearings gain = floor((run signal / 1.2e5)^0.25), each lifetime bearing +20% output. Numbers are doubles clamped to 1e150; display scheme: 7.3, 999, 1.25 K ... 1.00 Dc, then 1.00e36.

**One-button interface**: tap gathers (floating number, soft varied tone). Hold 0.42 s opens the build ring (production continues). Ring: tap = next entry, hold >= 0.45 s then release = choose. Order: CLOSE, BUY ALL AFFORDABLE (when two or more), affordable items best gain per cost first, sub-menus (EXPEDITIONS, BEARING TREE, RELOCATE OUTPOST), then three nearly-affordable previews. The highlight starts on the best affordable item, so buying is hold, wait a moment, hold. Large card shows cost and effect. Guard: a choose-hold only works if the entry has been highlighted for 0.7 s before the press (shown as "STEADY..."), so tap-tap-hold cannot buy; relocation needs a sub-menu, 1.2 s dwell and a 1.2 s hold. Ring closes after 7 s idle (countdown shown at 4 s). The release that opened the ring is consumed.

**Lamps**: left breathes green, 0.12 Hz (idle) to 0.72 Hz (huge output), tap flicker; middle fills amber toward the cheapest unaffordable item and goes steady green when anything is affordable; right: flare (amber blink) > boost (violet, blinks in last 3 s) > expedition progress (cyan) > relocation ready (slow white pulse). Accents: purchase (green flash), milestone (blue sweep), flare/expedition (violet flash), relocation (white swell). Sustained peak about a third of full; after 180 s without input drop to ~12% (flare and ready cues stay visible).

**Offline**: save holds schema 2, `t`, state. On open, credit = rate x min(away, cap); cap 8 h (+4 h per DEEP STORAGE level, battery banks +4/+12/+24 h). Backwards clock or save from the future: no credit, nothing lost, summary says so. Expeditions complete on wall time, also while away; a trip is never made to wait longer than its length after a clock jump. Pause/resume and long frame stalls credit the wall-clock gap. Summary card "WHILE YOU WERE AWAY". Saves: every 15 s, on purchases (min 1.5 s apart), cancel, pause, dispose, ring close. Unknown future-version fields are kept and rewritten. Late save is under 2 KB.

**Files**: `web/apps/outpost.js`, `tests/outpost.test.mjs` (33 tests), `tests/helpers/outpost-bot.mjs`, `tests/helpers/outpost-sim-cli.mjs` (prints the timeline), `vesper/catalog.json` (icon, record labels, controls, description) and regenerated `web/apps/catalog.js`.

## 3. Verification
- `node --test tests/outpost.test.mjs`: 33 pass, 0 fail (formulas, bot layers and windows, interface, guard, lamps, offline, cap, clock back, future save, migration, size, top-of-range finiteness, performance 2 ms).
- `node --test tests/*.test.mjs`: 495 pass, 0 fail. Python suite: 131 OK. `build-catalog.py --check`: in sync.
- `build-demo.py && node tests/browser-smoke.cjs`: passed (26 apps, standalone bundle).
- `scripts/dev-shot.cjs --app outpost` at 1024x600: "no page or host errors". Shots in `fleet/work/game-outpost/shots/`: outpost-title, early, ring-first, mid, ring-mid, ring-step, late, flare, away, relocated, tree, exp (.png). I opened and checked each. Late-game and away states were set through `vesper.app` eval, not played to.
- Save/offline tests use a faked `Date.now`. Nothing was verified on the device; sound and lamps were not heard or seen.

## 4. Not done / uncertain
- Balance is from a bot only; a human will tap slower. Third and later runs with the "relocate at 8" policy get very short (7 min); a real player pushes for bigger gains.
- No separate result screen beyond the relocation card; first-launch card stands in for a title. No research track.
- The away-card overlap with the header line was fixed after the away screenshot; not re-shot.
- Draw cost measured only under a fake canvas (about 0.3 ms); real Canvas cost on the Pi not measured.
- `ctx.score` is floor(20 x log10(1 + lifetime signal)).
- Schema 1 was never shipped; the v1 migration path covers a defined prototype shape (tested) so later changes have a pattern.

## 5. Branch
Branch `worktree-agent-acd29f913dad48bb1`, last commit: see the final message.
