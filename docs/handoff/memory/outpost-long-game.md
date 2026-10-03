---
name: outpost-long-game
description: Outpost mechanics contract on PR #15: save schema 6, sites/soundings/THE CALL, the workshop (fittings), naming, late-game pacing
metadata:
  type: project
  modified: 2026-10-03T01:00:38.022Z
---

Outpost's mechanics are on PR #15 (branch claude/outpost-lead-kasrgw), landed 2026-10-02: easy pace, hum, 12 relocation sites with two soundings each, THE CALL (a 44-note melody decoded a fragment per sounding; answered at the Silent Coast for a finale), and the workshop. The full contract for the visuals (PR #18) and sound (PR #17) threads is /mnt/project-files/outpost/outpost-plan.md (sections 3, 4, 4b and 4c).

- Save schema 6. Schema 5 added site, sx, sv, of, cf, ans and fe; schema 6 adds ft (the run's fittings). Schemas 1-5 migrate. The fixture tests/fixtures/outpost-save-v4-mid.json is a real schema 4 save. s.ans is 0 or 1 (not a count).
- Players see "SOUNDING"; the code says survey (sv, sx, SURVEY, surveyOf). Don't rename the code side: the save uses it.
- CALL_ID 101 is stored in s.sg: never change it.
- Workshop (de4f9b0) answers the review's "give purchases real choices". FIT[k] belongs to SITES[k]. A site's first sounding gives the blueprint, its second the MK II. The workshop opens at 3 blueprints and builds fittings at 3, 10 and 25 min into each run; the player picks 1 of 3. Fittings fold into siteFx and reset at relocation.
- Console logbook calls (ctx.feat/today/daily/dailyMet) are optional, so #15 works without #16, but it is meant to merge after #16.
- Simulated pacing with the workshop, six seeds: a quarter-time tapper answers the call in 5.2-7.0 h (6.5-8.2 h without fittings), a half-time tapper in 3.8-5.7 h, an always-tapper in 1.8-3.9 h. The long-game test pins 4.5-12 h for the quarter-time tapper.
- Late game: past 20,000 bearings the "ready" ratio falls as 1.25 x (20,000/held)^0.3, to 0.2. Runs stay 20 min-2 h until about 24-25 h of play. Past that, runs grow again; a new layer would be needed to push further.
- Review fixes in 32798ab (gesture rewind, story notes, finale once, kit doesn't count for sky/ground soundings, odd saves, local-date order). Reviewer's Salt Flats stacking point deliberately left as is.
- Save slots (a61e59e, 2026-10-03): Outpost opts in to #16's slot API (static saveSlots = true; API in MEMORY.md's #16 line). Save format unchanged; slotSummary = slotLabel (site · time played); a fresh slot 2-4 notes that the other slots are kept. Sam was asked whether a second save should offer later starting points; not built until he picks.

**Why:** a later thread or a cold coordinator would otherwise have to rediscover the naming split, save rules and pacing from the code.
**How to apply:** change Outpost's save only with a schema bump, a migration and a test; route scene or sound asks for new fields to the lead thread ([[outpost-team]]).
