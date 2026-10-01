# tool-telemetry report

## Outcome
Built TELEMETRY: four pages (overview, node, history, about) from GET /api/system, plus a three-lamp health light. Committed on branch worktree-agent-abc1102f7c7974d87, commit 426cb70. All suites pass.

## Details
- web/apps/telemetry.js: markup built once with one ctx.content; afterwards only changed text/colour/attributes are written (this.shown records the screen). Fixed list of 7 actions.
- Polling: on open, then from tick() every 2 s, never overlapping; a request outstanding 10 s is abandoned (late answer ignored) and retried; dispose() stops it and darkens lamps.
- Failures: last payload kept, panel dimmed, status 'STALE / LAST DATA n S AGO / RETRYING'; before any data 'NO DATA / SERVICE NOT ANSWERING'. Recovers by itself. simulated:true is stated on screen. All nulls show a dash.
- Thresholds (normal/elevated/critical): CPU temp <70 / 70 / 80 C (shown in tempUnit); CPU % <70 / 70 / 90; memory used % <80 / 80 / 92; storage free >=20 % / <20 % / <10 % or <1 GiB; throttle flags: under-voltage or throttled now critical, freq cap or soft temp limit now elevated; occurred-since-boot is text only.
- Lamps (peak about a third): left = temperature + throttle-now flags; middle = worst of CPU (mean of last 3) and memory; right = node link. Dim green normal, amber elevated, red pulsing 0.4 Hz critical, dark unknown. Node disconnected: right lamp dark with slow amber blink. Node elevated: errors rose in last minute, status older than 10 s, or sensor never read; critical: 20+ new errors per minute or status older than 30 s. Lamps dark when data older than 15 s and on dispose.
- Node page explains CRC errors, missing samples, sensor failures in words. History: 360-sample buffer (12 min), SVG charts with threshold lines, frame-time median/p95 from ctx.stats().
- web/engine/demo.js: confined 'system' branch in get (simulated:true). catalog.json: added icon; catalog.js regenerated. Constructor accepts optional {clock} for tests.

## Verification
- node --test tests/*.test.mjs: 271 pass, 0 fail (23 in tests/telemetry.test.mjs covering healthy, hot, critical, all-null, disconnected, rejected then recovered, garbage replies, no overlap, hung request, stop on dispose, late answer, bounded history, content built once, stable actions, lamps nine bytes and dark after dispose).
- Python unittest: OK. build-catalog.py --check: OK. build-demo.py + browser-smoke.cjs: passed true, no page errors.
- dev-shot at 1024x600, no page or host errors; shots in fleet/work/tool-telemetry/shots/telemetry-{overview,overview-focus,node,history,about}.png, all opened and read. Overview and node fit above the actions; History and About push the last action slightly below the fold (main scrolls).

## Not done / uncertain
- The simulator showed real host values (Pi at 84 C, 100 % CPU from other agents), so history charts are flat lines at the top; chart shape with varying data is tested only as a points string, not by screenshot.
- Lamps verified as values only, not on hardware. Standalone edition checked by calling DemoBridge.get('system') in node, not in a browser.
- No threshold hysteresis (verdicts can flicker at a boundary). Hung requests are abandoned, not aborted (ctx.get has no abort).
- Endpoint does not report the data directory; About says so (shows service.dataDir if it ever appears).
- Leftover processes seen at finish (vesper.server --simulate on /tmp/vesper-hostbrowser-*, its chromium) are not mine.

## Branch
worktree-agent-abc1102f7c7974d87, commit 426cb70
