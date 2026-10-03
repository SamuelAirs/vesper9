/* Stop only the process tree created by this test, then release its private temp data.
   Windows venv python.exe is a launcher: killing only it leaves the service running. */
const { execFile } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
module.exports = async function cleanup(server, directory) {
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 5000).unref(); });
    if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, resolve));
    else server.kill('SIGTERM');
    await exited;
  }
  if (directory) {
    const relative = path.relative(os.tmpdir(), path.resolve(directory));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Refusing cleanup outside a private temp directory');
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
};
