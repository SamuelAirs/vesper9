/* Does a finished, never-removed timer keep the service's 1 Hz `timers`
   broadcast (and the page's status refresh) alive? Counts `timers` messages
   over 10 s on the dashboard with (a) no timers, (b) one finished timer. */
const L = require("./lib.cjs");
(async () => {
  const svc = await L.startService();
  const browser = await L.launch();
  const wsLog = []; wsLog.on = false;
  try {
    const { page } = await L.openPage(browser, svc, { wsLog });
    const count = async () => { wsLog.length = 0; wsLog.on = true; await L.sleep(10000); wsLog.on = false; const t = wsLog.filter((f) => f.type === "timers"); return { timersMsgs: t.length, bytes: t.reduce((a, f) => a + f.bytes, 0) }; };
    const none = await count();
    await page.evaluate(() => vesper.bridge.command("timer", { op: "create", seconds: 5, label: "DONE" }));
    await L.sleep(7000);
    const finished = await page.evaluate(() => vesper.state.timers.map((t) => ({ running: t.running, finished: t.finished })));
    const withFinished = await count();
    const result = { none, finishedTimerState: finished, withFinished };
    console.log(JSON.stringify(result));
    L.save("perf-finished-timer.json", result);
  } finally { await browser.close(); svc.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
