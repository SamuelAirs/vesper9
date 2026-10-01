# tool-oracle report: ORACLE chance machine

## 1. Outcome
Built `web/apps/oracle.js` (class `Oracle`, id `oracle`): coin, dice, number, decide (yes/no/ask again and pick one of 2-8) and a ten-entry history, with a roughly one-second lamp-and-tone tumble. Tests pass and the screenshots were opened and checked. Everything is committed on the branch below.

## 2. Details
- Modes: Coin (session tally, reset action). Dice: d4/d6/d8/d10/d12/d20/d100, 1-6 dice, each die drawn (pips for d6, outlined numeral tiles otherwise) plus total. Number: 1..N, presets 10/20/50/100/1000 plus a two-step chooser (scale x1/x10/x100/x1000, then figure 1-7, so up to 7000). Decide: YES 5/12, NO 5/12, ASK AGAIN 2/12; pick one of N shows "OPTION k OF N" with a dot row.
- Actions (main list): ROLL AGAIN first, change dice/range/question (coin: reset tally), change mode, history, return. Every submenu has 8 or fewer items. Focus is parked on the first item of each new list so ROLL is focused after any change.
- Preferences (mode, die, count, max, decide kind, N) are saved with `ctx.saveProgress` and validated on load.
- The result is drawn from `ctx.rng` and written to history at the press. The animation only reveals it. Landing writes the coin tally.
- Files: `web/apps/oracle.js`, `tests/oracle.test.mjs`, `vesper/catalog.json` (own entry: icon) and the regenerated `web/apps/catalog.js`.

### Lamps
- Tumble: one lamp chases left, middle, right, with the colour changing each tick (cyan, amber, violet, green, blue, white), at 35 % level.
- Coin: heads is the left lamp (amber), tails the right lamp (cyan).
- Yes/no: yes fills green, no fills red, ask again blinks amber.
- Dice and number: a left-to-right fill whose length is how high the roll was in its range, colour ramp cyan to green to amber. Maximum is a white pulse on all three, then amber. Minimum is a red blink on all three, then the left lamp dim red.
- Pick one of N: amber blinks k times, then a steady spot at position (k-1)/(N-1) across the lamps. This repeats.
- All lamps go dark 6 s after landing, and in dispose() and pause().

### Timing
- web/main.js gives an instrument only the one-second tick(). There is no per-frame hook. Oracle runs its own requestAnimationFrame loop: guarded by ctx.alive(), cancelled in dispose()/pause(), and started only for a roll plus the six-second lamp afterglow (blinks and pulses need frames too). It stops by itself afterwards.
- rollFrame(result, seconds) is pure. Ticks fall at 40 ms gaps growing 20 % each (10 ticks, landing at 1.04 s), and the tick tones fall in pitch.
- Without requestAnimationFrame, or with reducedMotion on, the result lands at once with static lamps, and tick() turns them off after 6 s.
- Skipping: instruments get no raw button edge, only tap=advance and hold=select. During a roll the action list is a single "SHOW RESULT NOW"; holding it lands the result. Choosing ROLL during a roll also skips.

## 3. Verification
- node --test tests/oracle.test.mjs: 15 pass.
- node --test tests/*.test.mjs: 161 pass, 0 fail (last three runs).
- Python suite: Ran 29 tests ... OK. build-catalog.py --check: ok.
- build-demo.py then node tests/browser-smoke.cjs: "passed":true, "pageErrors":[].
- Uniformity test (seeded generator): chi-square against p = 0.001 critical values, 24000 rolls per case. It covers coin, every die d4 to d100, each die inside a 6d6 roll, number 1..7, pick one of 2..8, and yes/no/ask-again against 5:5:2. All pass.
- Screenshots in fleet/work/tool-oracle/shots/: oracle-title.png, oracle-coin.png, oracle-dice-rolling.png, oracle-dice-result.png, oracle-dice-type.png, oracle-d100-result.png, oracle-pick-result.png (pick-one-of-5), oracle-history.png. All dev-shot runs ended "no page or host errors" at 1024 x 600. The three lamp indicators in the top bar of the screenshots show the lamp state.
- An earlier full-suite run had one failure in an unrelated host timing test (F2 a hung ordinary write ...) while my 60000-roll test was loading the CPU. After I cut my test to 24000 rolls it passed three times in a row. Not in my files; flagging it.

## 4. Not done / uncertain
- The skip is hold-to-select only, so it saves little against a 1 s roll. A genuine second tap is impossible for instruments without a host change.
- The dashboard icon (five-pip die with tick marks) was not rendered or looked at; Oracle is on dashboard page 4.
- Yes/no and coin-tumble frames were not looked at mid-roll.
- The custom number chooser tops out at 7 x scale, not 9 x, to keep every list at 8 or fewer items.
- Nothing was verified on the device: not the sound, not the physical lamps.

## 5. Branch
worktree-agent-a4629ebf43634b3ea, last commit db1d662.
