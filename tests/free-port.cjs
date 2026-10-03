/* A free loopback port per test run, so several checkouts can run browser tests at once.
   VESPER_TEST_PORT pins it. Port 8799 belongs to the live console and is never used. */
const { execFileSync } = require("node:child_process");
module.exports = function freePort() {
  const pinned = Number(process.env.VESPER_TEST_PORT);
  if (process.env.VESPER_TEST_PORT) {
    if (!Number.isInteger(pinned) || pinned < 1024 || pinned > 65535 || pinned === 8799)
      throw new Error('VESPER_TEST_PORT must be1024–65535 and cannot be live port8799');
    return pinned;
  }
  const code = 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])';
  return Number(execFileSync(process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-c", code], { timeout: 10000 }).toString());
};
