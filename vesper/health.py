"""Read-only system health for GET /api/system. Standard library only.

Every reader returns None when its source is missing or unreadable, so the payload always has
the same shape. `HostProbe.sample` does blocking file reads (and at most one short `vcgencmd`
call every few seconds): call it with asyncio.to_thread, never on the event loop.
"""
import logging
import math
import os
import shutil
import subprocess
import threading
import time

log = logging.getLogger(__name__)

THROTTLE_FLAGS = {
    0: "underVoltageNow", 1: "freqCappedNow", 2: "throttledNow", 3: "softTempLimitNow",
    16: "underVoltageOccurred", 17: "freqCappedOccurred", 18: "throttledOccurred", 19: "softTempLimitOccurred",
}


def safe(function, *args):
    try:
        value = function(*args)
    except Exception:  # missing file, odd format, permission: degrade to null
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def read_text(path):
    with open(path, "r", encoding="ascii", errors="replace") as handle:
        return handle.read()


def cpu_times(proc):
    """{'cpu': (busy, total), 'cpu0': ...} from /proc/stat jiffies."""
    out = {}
    for line in read_text(proc + "/stat").splitlines():
        parts = line.split()
        if parts and parts[0].startswith("cpu"):
            values = [int(v) for v in parts[1:9]]  # user nice system idle iowait irq softirq steal
            idle = values[3] + values[4]
            total = sum(values)
            out[parts[0]] = (total - idle, total)
    return out


def percent(previous, current):
    busy, total = current[0] - previous[0], current[1] - previous[1]
    return round(100 * busy / total, 1) if total > 0 else None


class HostProbe:
    def __init__(self, data_dir, proc="/proc", sysfs="/sys", vcgencmd=None):
        self.data_dir, self.proc, self.sysfs = str(data_dir), proc, sysfs
        self.vcgencmd = vcgencmd if vcgencmd is not None else shutil.which("vcgencmd")
        self.lock = threading.Lock()
        self.previous = None        # (monotonic time, cpu_times) at the previous call
        self.cpu = None             # last computed utilisation block
        self.throttle = (0.0, None)
        self.started = time.time()
        self.page_size = safe(os.sysconf, "SC_PAGE_SIZE") or 4096
        safe(self.measure_cpu)      # prime, so the first call covers "since the service started"

    def measure_cpu(self):
        now, times = time.monotonic(), cpu_times(self.proc)
        if self.previous is not None and now - self.previous[0] < 0.5 and self.cpu is not None:
            return self.cpu         # two callers in quick succession share one window
        if self.previous is None:
            self.previous = (now, times)
            return None
        before_time, before = self.previous
        self.previous = (now, times)
        cores = sorted((k for k in times if k != "cpu" and k in before), key=lambda k: int(k[3:]))
        self.cpu = {"percent": percent(before["cpu"], times["cpu"]) if "cpu" in before else None,
                    "perCore": [percent(before[k], times[k]) for k in cores],
                    "windowS": round(now - before_time, 2)}
        return self.cpu

    def temperature(self):
        try:
            return round(int(read_text(self.sysfs + "/class/thermal/thermal_zone0/temp")) / 1000, 1)
        except Exception:
            if not self.vcgencmd:
                return None
            out = self.run_vcgencmd("measure_temp")  # temp=51.0'C
            return float(out.split("=")[1].split("'")[0])

    def run_vcgencmd(self, *args):
        result = subprocess.run([self.vcgencmd, *args], capture_output=True, text=True, timeout=1)
        if result.returncode != 0:
            raise RuntimeError("vcgencmd failed")
        return result.stdout.strip()

    def throttled(self):
        if not self.vcgencmd:
            return None
        now = time.monotonic()
        if now - self.throttle[0] < 5 and self.throttle[1] is not None:
            return self.throttle[1]
        raw = int(self.run_vcgencmd("get_throttled").split("=")[1], 16)
        value = {"raw": "0x%x" % raw, **{name: bool(raw >> bit & 1) for bit, name in THROTTLE_FLAGS.items()}}
        self.throttle = (now, value)
        return value

    def memory(self):
        values = {}
        for line in read_text(self.proc + "/meminfo").splitlines():
            key, _, rest = line.partition(":")
            if key in ("MemTotal", "MemAvailable"):
                values[key] = int(rest.split()[0]) * 1024
        return {"totalBytes": values["MemTotal"], "availableBytes": values["MemAvailable"]}

    def disk(self):
        usage = shutil.disk_usage(self.data_dir)
        return {"totalBytes": usage.total, "freeBytes": usage.free}

    def service_rss(self):
        fields = read_text(self.proc + "/self/statm").split()
        return int(fields[1]) * self.page_size

    def sample(self):
        """Host and service-process numbers. Blocking; keep it off the event loop."""
        with self.lock:
            cpu = safe(self.measure_cpu)
            load = safe(lambda: [float(v) for v in read_text(self.proc + "/loadavg").split()[:3]]) or safe(os.getloadavg)
            return {
                "model": safe(lambda: read_text("/proc/device-tree/model").strip("\0\n ") or None),
                "cpuTempC": safe(self.temperature),
                "loadAvg": [round(v, 2) for v in load] if load else None,
                "cpuCount": safe(os.cpu_count),
                "cpuPercent": cpu["percent"] if cpu else None,
                "cpuPerCore": cpu["perCore"] if cpu else None,
                "cpuWindowS": cpu["windowS"] if cpu else None,
                "memory": safe(self.memory),
                "disk": safe(self.disk),
                "uptimeS": safe(lambda: round(float(read_text(self.proc + "/uptime").split()[0]), 1)),
                "throttled": safe(self.throttled),
            }, {"rssBytes": safe(self.service_rss)}
