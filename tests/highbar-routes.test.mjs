import test from "node:test";
import assert from "node:assert/strict";
import { HighBar } from "../web/apps/highbar.js";
import { appContext } from "./helpers/app-context.mjs";

// Recorded from deterministic play/search, then replayed from a normal drop-in.
// D/U/T are actual button-down/button-up/generic-tap events at 60 Hz frame indexes.
// No rider placement, fabricated tricks, gap flags, scores or challenge flags.
const ROUTES = [
  {
    "park": 0,
    "line": 0,
    "frames": 266,
    "input": "D0 U42 D48 U84 D90 U192 D264"
  },
  {
    "park": 0,
    "line": 1,
    "frames": 282,
    "input": "D0 U42 D48 T54 T96 T138 U180 T198"
  },
  {
    "park": 0,
    "line": 2,
    "frames": 394,
    "input": "D0 U42 D48 T54 U90 D96 T108 U144 T150 T192 D192 U234 D240 T252 U288 T294"
  },
  {
    "park": 1,
    "line": 0,
    "frames": 617,
    "input": "D0 U42 D54 T60 T102 T144 U150 D156 T186 U222 D228 T234 T276 T318 U336 D342 T360 U390 T402 T444 D444 U492 T498 T540"
  },
  {
    "park": 1,
    "line": 1,
    "frames": 506,
    "input": "D0 U36 D54 T54 U90 D96 T132 U156 D174 T174 T216 T258 T300 T342 U354 D360 T384 U414 T426 D504"
  },
  {
    "park": 1,
    "line": 2,
    "frames": 758,
    "input": "D0 U12 T30 D108 U120 D138 T144 T186 T228 U258 D276 T276 U312 T330 D360 T372 U408 T426 D438 T468 U474 T510 D546 T552 T594 U606 T636 T678"
  },
  {
    "park": 2,
    "line": 0,
    "frames": 1030,
    "input": "D0 U18 T36 D42 U60 T78 D96 T120 U126 D132 T162 U180 T204 T246 D246 U288 D306 T306 U336 D342 T354 T396 U438 T438 D444 U474 D480 T492 T534 U570 T576 D582 U612 D618 T624 T666 T708 T750 U756 D762 U792 D798 T804 T846 U888 D894 T906 U942 T948"
  },
  {
    "park": 2,
    "line": 1,
    "frames": 4708,
    "input": "D0 U36 D54 U90 D96 T102 T144 T186 T228 U234 D246 T270 T312 U354 D360 T366 T408 T450 U462 D468 T492 T534 U570 D576 T582 T624 U654 D660 T666 T708 U750 D756 T762 T804 T846 T888 T930 U942 D948 T972 T1014 T1056 U1068 D1086 T1098 T1140 T1182 U1212 D1218 T1224 T1266 T1308 U1350 D1356 T1362 T1404 T1446 U1482 D1488 T1494 T1536 T1578 T1620 U1626 D1632 T1662 T1704 T1746 U1782 D1788 T1794 T1836 T1878 T1920 U1950 D1956 T1962 T2004 T2046 T2088 T2130 U2148 D2154 T2172 T2214 U2226 D2232 T2256 T2298 T2340 T2382 U2400 D2406 T2424 T2466 U2502 T2520 D2526 T2562 T2604 U2628 D2634 T2646 T2688 U2730 D2736 T2742 T2784 U2820 T2838 D2844 T2880 T2922 U2946 T2964 D2982 T3006 T3048 T3090 T3132 U3144 T3174 D3210 T3216 T3258 T3300 T3342 T3384 T3426 U3456 T3474 T3516 D3522 T3558 T3600 T3642 T3684 U3714 T3732 T3774 D3786 T3816 T3858 T3900 U3912 T3942 D3984 T3984 T4026 T4068 U4086 T4110 T4152 D4164 T4194 T4236 T4278 U4302 T4320 T4362 D4386 T4404 T4446 U4488 T4506 T4548 T4590 T4632"
  },
  {
    "park": 2,
    "line": 2,
    "frames": 3825,
    "input": "D0 U30 D48 U78 D90 T96 T138 T180 T222 U228 D240 T264 T306 U348 D354 T360 T402 T444 U450 D474 T486 T528 T570 U600 D606 T612 T654 T696 T738 U744 D750 T780 T822 T864 U888 D894 T906 T948 T990 U1026 D1032 T1038 T1080 T1122 U1164 D1176 T1182 T1224 T1266 U1308 D1320 T1326 T1368 T1410 U1452 D1458 T1464 T1506 T1548 U1584 D1596 T1602 T1644 T1686 U1728 D1734 T1740 T1782 T1824 U1860 D1872 T1878 T1920 T1962 U2004 D2010 T2016 T2058 T2100 T2142 U2148 D2154 T2184 T2226 T2268 U2286 D2292 T2310 T2352 T2394 U2430 D2436 T2442 T2484 T2526 T2568 U2586 D2592 T2610 T2652 T2694 T2736 U2778 D2784 T2790 T2832 T2874 T2916 U2934 D2940 T2958 T3000 T3042 T3084 U3102 T3126 D3138 T3168 T3210 T3252 U3264 D3270 U3521 D3559 U3599"
  },
  {
    "park": 3,
    "line": 0,
    "frames": 3048,
    "input": "D0 U12 T30 D114 U126 T144 D198 T210 U246 T252 D252 U294 T312 D390 U402 D408 T420 U456 T462 T504 D594 U606 T624 D672 T684 U720 T726 T768 D768 U810 T828 D834 T870 U882 D888 T912 T954 U984 D990 T1002 U1038 T1044 D1086 T1086 T1128 T1170 U1194 D1200 T1212 U1248 D1254 T1260 T1302 T1344 U1350 D1356 T1386 U1404 T1428 T1470 D1482 T1512 U1548 D1554 T1566 U1596 T1608 T1650 D1746 U1758 D1776 U1788 D1794 T1806 U1842 T1848 T1890 T1932 D1932 U1974 D1980 T1986 T2028 T2070 U2094 D2100 T2112 T2154 T2196 T2238 U2256 D2262 T2280 U2310 T2322 D2340 T2364 T2406 U2442 D2448 T2460 U2496 T2502 T2544 D2574 T2586 T2628 U2674 T2831 D2831 U2878 D2878 U2974"
  },
  {
    "park": 3,
    "line": 1,
    "frames": 391,
    "input": "D0 U54 T72 D84 T114 U120 D126 T156 U192 T210 T252 T294"
  },
  {
    "park": 3,
    "line": 2,
    "frames": 3080,
    "input": "D0 U54 T72 D84 T114 T156 U186 D192 T198 T240 T282 U294 D300 T324 T366 T408 U432 D510 U564 T582 T624 D624 U666 T684 D792 U846 T864 T906 D906 U948 D954 T966 U1002 D1080 U1134 T1152 T1194 D1194 U1236 T1254 T1296 D1380 U1434 T1452 D1530 U1584 T1602 D1614 T1644 T1686 U1728 D1734 T1746 U1782 T1788 D1788 U1830 T1836 T1878 D1950 U2004 T2022 D2070 T2082 U2124 T2124 D2196 U2250 T2268 D2274 T2310 T2352 U2376 D2382 T2394 T2436 T2478 U2502 D2508 T2520 T2562 U2598 T2604 D2604 U2646 D2658 T2664 T2706 T2748 U2760 D2766 T2790 T2832 U2868 D2874 T2886 T2928 T2970 U3000 D3078"
  }
];

for (const route of ROUTES) for (const mode of [0, 1, 2]) {
  test(`park ${route.park + 1} / line ${route.line + 1} banks through actual controls in ${["SESSION", "LINE RUN", "PRACTICE"][mode]}`, () => {
    const ctx = appContext({ settings: { knock: "medium" } });
    const app = new HighBar(ctx);
    app.slot().guided = true;
    // The audit exercises unlocked parks without manufacturing the current park's goals.
    app.slot().goals = [0, 1, 2, 3].map(p => p < route.park ? [0, 1, 2] : []);
    app.parkId = route.park; app.slot().line = route.line; app.mode = mode; app.start();
    const before = structuredClone(app.save), target = app.challenge();
    let targetBanks = 0;
    const bank = app.bank.bind(app);
    app.bank = () => { if (app.meetsLine(target, app.combo)) targetBanks++; bank(); };
    const events = route.input.split(" ").map(s => [Number(s.slice(1)), s[0]]);
    let next = 0;
    for (let frame = 0; frame < route.frames && app.phase === "play"; frame++) {
      while (events[next]?.[0] === frame) {
        const [, action] = events[next++];
        if (action === "D") app.down({ source: "keyboard" });
        else if (action === "U") app.up({ source: "keyboard", durationMs: (app.t - app.pt) * 1000 });
        else app.knock();
      }
      app.update(1 / 60);
    }
    assert.ok(targetBanks > 0, target.name + " must actually land and bank within this mode's clock");
    assert.ok(app.score > 0);
    if (mode === 1) assert.equal(app.lineMet, true);
    if (mode !== 2) assert.ok(app.slot().lines[route.park].includes(route.line));
    app.finish(); app.guard.settle();
    if (mode === 2) {
      assert.deepEqual(app.save, before, "the same route in practice changes no career data");
      assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
    } else if (mode === 1) {
      assert.equal(app.slot().lineBest[route.park][route.line], app.score);
      assert.equal(ctx.calls.score.length, 0, "short attempts never enter the session leaderboard");
    } else assert.deepEqual(ctx.calls.score.at(-1), [app.score, "style-v2"]);
  });
}

test("Tower summit/crossover attempt clocks are explicit and other lines retain 45 seconds", () => {
  const app = new HighBar(appContext());
  for (let park = 0; park < 4; park++) for (let line = 0; line < 3; line++) {
    app.parkId = park; app.slot().line = line; app.mode = 1; app.start();
    const seconds = park === 2 && line > 0 ? 75 : 45;
    assert.equal(app.clock, seconds);
    assert.match(app.setupItems().find(item => item.id === "line").label, new RegExp(seconds + "s"));
  }
});
