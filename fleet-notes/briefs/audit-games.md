<!-- launch: subagent_type=general-purpose model=sonnet isolation=worktree description='Audit games and Morse' -->
Your agent name is `audit-games`. Before anything else, read `/home/sam/VESPER-9-v0.2.0-Claude/fleet/RULES.md` and follow it exactly; it explains the project, the environment on this Raspberry Pi, what you must never touch, and the report format.

## Why this task exists

VESPER-9 is a one-button console with six games and several instruments. Its owner played it tonight and found it fun; he also said the three RGB lamps on the device are underused. Overnight, a fleet of agents is improving it. You are the reviewer for the **existing games and the Morse trainer**. Your findings decide what a later agent fixes and tunes, so they need to be true and specific. Other agents are separately reviewing the host/engine, the Python service, performance and layout; stay in your lane.

## Your scope

- `web/apps/games.js`: Orbit Lock, Moonrunner, Undertow, Echo Vault, Light Trial, Glyph Archive
- `web/apps/morse.js`: Signal School (guided keying, listening, adaptive review)
- Their tests in `tests/engine.test.mjs`, and `docs/OPERATOR.md` for what each is supposed to do

## What to look for

**Defects (prove each one):** state-machine mistakes, runs that cannot be won or cannot be lost, obstacles that are physically impossible to clear, scoring or best-score errors, progress that is saved wrong or lost, behaviour that depends on frame rate rather than the fixed 1/60 s step, randomness that bypasses the seeded `ctx.rng`, lamps or tones left on after `dispose()`/`cancel()`/pause, and bad reactions to the system-menu gesture. Remember the input contract in `docs/ENGINE.md`: four quick clicks open the menu in most games, so the first three taps reach the game before the gesture completes and then `cancel()` is called. A game that punishes that heavily (for example by ending a run) is a real problem for a one-button player.

**Balance (measure it):** write small seeded bots that play each game through the app's own `down`/`up`/`update` methods for many simulated minutes and record facts: how long runs last under a naive policy and under a competent policy, where difficulty jumps, whether a degenerate policy (never press, always hold, press on a fixed rhythm) scores well, how long before anything new happens. Numbers, not impressions.

**Proposals (clearly separate from defects):** for each of the seven apps, up to three concrete improvements ranked by value for effort. One of them must be about the lamps: describe what the three lamps (left, middle, right, each full RGB) should show moment to moment so that they carry real information or feedback in that game, since today they only flash a fixed colour on a few events. Be specific enough that another agent could implement it without guessing.

## How to work

1. Read the files in scope completely. Read `docs/ENGINE.md` for the app context API (`ctx.rng`, `ctx.leds`, `ctx.score`, `ctx.saveProgress`, and so on).
2. Prove defects with failing `node:test` tests in new files under `tests/audit/` (for example `tests/audit/games.test.mjs`). See `tests/engine.test.mjs` for how the existing tests construct an app with a stub context and step it. Put your bots and their measurement scripts in the same directory and include their real output in the report. That directory is outside the normal suite, so failing tests there break nothing.
3. Do not modify any product file. Your only writes are new files under `tests/audit/` and your report. Commit them on your branch.
4. A few proven defects beat many guesses. Anything you cannot prove goes in a separate "unverified" section with the reason, or is dropped.

## What to deliver

The report at `/home/sam/VESPER-9-v0.2.0-Claude/fleet/reports/audit-games.md` in the format from the rules, with three parts: proven defects (severity, file and line, what the player experiences, the test that shows it and its failing output, smallest fix), balance measurements per game (a compact table plus what they imply), and proposals per game (including the lamp design).

Your final message to me should be a summary under 250 words: number of proven defects by severity, the top three in one line each, the single most valuable balance observation, the branch name and commit hash, and the report path.
