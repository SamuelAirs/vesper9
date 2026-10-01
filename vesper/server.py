"""Local appliance service for VESPER-9. Run: python -m vesper.server --simulate."""
import argparse
import asyncio
import base64
import contextlib
import copy
import json
import logging
import math
import os
import re
import struct
import sys
import time
import uuid
from array import array
from pathlib import Path

from aiohttp import web, WSMsgType, WSCloseCode

from . import analysis
from .device import SerialDevice, SimulatedDevice
from .health import HostProbe, safe
from .protocol import Kind
from .speech import Speech, COMMANDS
from .storage import Store

ROOT = Path(__file__).resolve().parents[1]
from .catalog import APP_IDS, DEFAULT_SETTINGS, validate_setting

VERSION = "0.2.0"
# Microphone modes. "commands" and "transcribe" run speech recognition; "analyze" only measures
# level, spectrum and pitch (vesper/analysis.py): nothing is recognised, stored or sent anywhere.
RECOGNITION_MODES = ("commands", "transcribe")
MIC_MODES = ("off", *RECOGNITION_MODES, "analyze")
SEND_TIMEOUT = 1            # seconds a client may take to accept one frame before it is dropped
OUTBOX_LIMIT = 200          # frames queued for one client before it counts as stalled
KEEPALIVE_TIMEOUT = 20      # seconds of controller silence that end capture, once it has sent a keepalive
AUDIO_STALL = 3             # seconds without audio that end an analysis capture
TIMER_KEYS = {"id": str, "label": str, "duration": (int, float), "remaining": (int, float),
              "deadline": (int, float), "running": bool, "finished": bool}


def is_number(value):
    return type(value) in (int, float)


def stored_timers(raw):
    """Timers read back from the database: keep well-formed ones only."""
    if not isinstance(raw, list):
        return []
    good = []
    for timer in raw:
        if isinstance(timer, dict) and all(isinstance(timer.get(k), t) and (type(timer.get(k)) is not bool or t is bool)
                                           for k, t in TIMER_KEYS.items()):
            good.append(timer)
        else:
            logging.warning("Ignoring a malformed stored timer")
    return good[:8]


class Outbox:
    """One client's queue of frames and the task that writes them, so a slow tab delays only itself."""
    def __init__(self, pump):
        self.queue = asyncio.Queue(maxsize=OUTBOX_LIMIT)
        self.task = asyncio.create_task(pump(self))


class Console:
    def __init__(self, args):
        self.args = args
        self.store = Store(args.data)
        self.clients = set()
        self.outboxes = {}
        self.controller = None
        self.settled = asyncio.Event()      # clear while a departed controller's cleanup is running
        self.settled.set()
        self.controller_seen = time.monotonic()
        self.keepalive_armed = False        # becomes true once the controller sends a keepalive
        self.background = set()
        self.device = SimulatedDevice(self.event) if args.simulate else SerialDevice(args.port, args.baud, self.event)
        self.speech = Speech(args.model, self.speech_event, self.speech_failed)
        self.mode_lock = asyncio.Lock()
        self.mode = "off"
        self.mode_since = 0
        self.session = None
        self.focus = "home"
        self.sensor = None
        self.level = 0
        self.last_level = 0
        self.last_audio = 0
        self.stray_capture = 0
        self.last_saved_sensor = 0
        self.last_command = 0
        self.analyzer = None
        self.analysis_generation = 0
        self.analysis_busy = False
        self.analysis_error = None
        self.synthetic = None
        self.timers = stored_timers(self.store.get("timers", []))
        self.timers_dirty = False
        self.settings = dict(DEFAULT_SETTINGS)
        stored = self.store.get("settings", {})
        for key, value in (stored.items() if isinstance(stored, dict) else []):
            try:
                self.settings[key] = validate_setting(key, value)
            except Exception:
                logging.warning("Ignoring stored setting %r", key)
        self.started = time.time()
        self.host = HostProbe(args.data)
        self.tasks = []
        self.task_names = []
        self.closing = False

    def schedule(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.background.add(task)
        def done(t):
            self.background.discard(t)
            if not t.cancelled() and t.exception():
                logging.error("Background operation failed", exc_info=t.exception())
        task.add_done_callback(done)
        return task

    def mic_error(self):
        return self.speech.error or self.analysis_error

    def state(self):
        return {"type": "state", "version": VERSION, "simulated": self.device.simulated,
                "device": {"connected": self.device.connected, "name": self.device.name, "capture": self.device.mic,
                           "crcErrors": self.device.crc_errors, "missingSamples": self.device.audio_missing,
                           "audioBytes": self.device.audio_bytes, "button": self.device.pressed, "generation": self.device.generation},
                "leds": self.device.leds, "mic": {"mode": self.mode, "level": self.level, "session": self.session,
                           "unavailable": self.speech.availability(), "droppedChunks": self.speech.dropped, "error": self.mic_error(),
                           "modes": list(MIC_MODES),
                           "analysis": {"rate": analysis.RATE, "bands": analysis.BANDS, "edgesHz": analysis.EDGES,
                                        "intervalMs": round(analysis.HOP * 1000 / analysis.RATE)}},
                "sensor": self.sensor, "timers": self.public_timers(), "settings": self.settings,
                "scores": self.store.scores(), "progress": self.store.get("progress", {}), "serverTime": time.time()}

    def public_timers(self):
        now = time.time()
        return [{**t, "remaining": max(0, t["deadline"] - now) if t["running"] else t["remaining"]} for t in self.timers]

    # ---- sending to browsers -------------------------------------------------------------

    async def pump(self, client, box):
        try:
            while True:
                event = await box.queue.get()
                await asyncio.wait_for(client.send_json(event), SEND_TIMEOUT)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logging.info("Dropping a browser connection: %s", exc or type(exc).__name__)
            await self.drop(client)

    def send(self, client, event):
        """Queue one frame for one client. Never blocks and never raises; frames keep their order."""
        if client not in self.clients:
            return
        box = self.outboxes.get(client)
        if box is None:
            box = self.outboxes[client] = Outbox(lambda b: self.pump(client, b))
        try:
            box.queue.put_nowait(event)
        except asyncio.QueueFull:
            self.schedule(self.drop(client))

    async def broadcast(self, event):
        # Every client has its own queue, so one stalled tab cannot delay the others or the
        # serial reader that calls this for every node packet.
        for client in list(self.clients):
            self.send(client, event)

    def forget(self, client):
        self.clients.discard(client)
        box = self.outboxes.pop(client, None)
        if box and box.task is not asyncio.current_task():
            box.task.cancel()

    async def drop(self, client):
        """Disconnect a client that cannot keep up or has gone: free its control slot at once."""
        self.forget(client)
        self.schedule(self.release_controller(client))
        with contextlib.suppress(Exception):
            await asyncio.wait_for(client.close(), 2)

    async def release_controller(self, ws):
        """Give up control when the controlling tab leaves (reload, crash, close, stalled link).
        The slot is free immediately, so a reloaded tab becomes the controller again; commands from
        that tab wait for the cleanup (`settled`) so it cannot undo what the new tab just did."""
        self.forget(ws)
        if self.controller is not ws:
            return
        self.controller = None
        self.focus = "home"
        self.keepalive_armed = False
        if self.closing:
            return
        self.settled.clear()
        try:
            for label, step in (("microphone off", lambda: self.set_mic("off")),
                                ("cancel", lambda: self.device.command(Kind.CANCEL)),
                                ("lamps off", lambda: self.device.command(Kind.LEDS, bytes(9)))):
                try:
                    await step()
                except Exception as exc:
                    logging.warning("Controller cleanup (%s) failed: %s", label, exc)
            if self.device.simulated:
                with contextlib.suppress(Exception):
                    await self.device.button(False)
        finally:
            self.settled.set()

    # ---- node events ---------------------------------------------------------------------

    async def event(self, event):
        kind = event["type"]
        if kind == "audio":
            if self.mode != "off":
                pcm = event["pcm"]
                now = time.monotonic()
                self.last_audio = now
                if self.mode == "analyze":
                    self.analyse_chunk(pcm)
                else:
                    self.speech.feed(pcm)
                if now - self.last_level > .1:
                    samples = array("h", pcm)
                    if samples:
                        self.level = math.sqrt(sum(x*x for x in samples) / len(samples)) / 32768
                    self.last_level = now
                    await self.broadcast({"type": "level", "value": self.level, "droppedChunks": self.speech.dropped})
            return
        if kind == "sensor":
            event = {**event, "at": time.time()}
            self.sensor = event
            if time.monotonic() - self.last_saved_sensor > 30:
                # Advance first: a failing disk must be retried in 30 s, not on every frame.
                self.last_saved_sensor = time.monotonic()
                try:
                    self.store.sensor(event["temperature"], event["humidity"])
                except Exception as exc:
                    logging.warning("Sensor sample not stored: %s", exc)
        elif ((kind == "device" and not event["connected"]) or kind == "node_reset") and self.mode != "off":
            # Serial read task must never await a command ACK from itself.
            self.schedule(self.set_mic("off", disconnected=True))
        await self.broadcast(event)

    async def speech_failed(self, error):
        try:
            await self.set_mic("off")
        finally:
            await self.broadcast({"type": "speech_error", "error": error})

    async def speech_event(self, event):
        if event["type"] == "speech" and event.get("final") and self.session:
            self.store.line(self.session, event["text"])
            event = {**event, "session": self.session}
        if event["type"] == "voice":
            now = time.monotonic()
            if now - self.last_command < .7:
                return
            self.last_command = now
            if event["action"] == "mute":
                self.schedule(self.set_mic("off"))
            elif event["action"] == "timer":
                try:
                    self.timer_command({"op": "create", "seconds": event["seconds"]})
                except ValueError as exc:
                    await self.broadcast({"type": "error", "error": str(exc)})
                    return
                await self.broadcast({"type": "timers", "timers": self.public_timers()})
        await self.broadcast(event)

    # ---- sound analysis ------------------------------------------------------------------

    def analyse_chunk(self, pcm):
        """Hand audio to the analyzer (cheap) and start one analysis off the event loop when a frame is due."""
        analyzer = self.analyzer
        if analyzer is None:
            return
        analyzer.feed(pcm)
        if self.analysis_busy:
            return
        frame = analyzer.take()
        if frame:
            self.analysis_busy = True
            self.schedule(self.run_analysis(frame, self.analysis_generation))

    async def run_analysis(self, frame, generation):
        try:
            result = await asyncio.to_thread(analysis.analyse, frame)
        except Exception as exc:
            logging.exception("Sound analysis failed")
            if generation == self.analysis_generation:
                await self.analysis_failed("Sound analysis failed: " + str(exc))
            return
        finally:
            self.analysis_busy = False
        if self.mode == "analyze" and generation == self.analysis_generation:
            await self.broadcast({"type": "analysis", "at": time.time(), **result, "simulated": self.device.simulated})

    async def analysis_failed(self, error):
        """Any analysis failure ends capture; the browser is told why."""
        self.analysis_error = error
        logging.error("%s", error)
        await self.broadcast({"type": "analysis_error", "error": error})
        if self.mode == "analyze":
            self.schedule(self.set_mic("off"))

    def stop_analysis(self):
        self.analysis_generation += 1
        self.analyzer = None
        self.analysis_busy = False
        task, self.synthetic = self.synthetic, None
        if task:
            task.cancel()

    async def synthetic_microphone(self, generation):
        """Simulator only: a clearly artificial signal (sweeping tone over faint noise) in 20 ms chunks."""
        source = analysis.SyntheticSource()
        due = time.monotonic()
        try:
            while generation == self.analysis_generation and self.mode == "analyze":
                await self.event({"type": "audio", "pcm": source.chunk(), "simulated": True})
                due += .02
                now = time.monotonic()
                if due < now - .2:
                    due = now
                await asyncio.sleep(max(0, due - now))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logging.exception("Simulated microphone failed")
            await self.analysis_failed("Simulated microphone failed: " + str(exc))

    async def set_mic(self, mode, disconnected=False):
        if mode not in MIC_MODES:
            raise ValueError("Unknown microphone mode")
        async with self.mode_lock:
            # "off" while the console already says off still mutes a node that reports capture.
            if mode == self.mode and not (mode == "off" and self.device.connected and self.device.mic):
                return
            if mode != "off" and not self.device.connected:
                raise ValueError("Connect the node before enabling its microphone")
            # Disable acquisition before changing workers. Even on a failed
            # recognition setup, the system remains visibly muted.
            mute_error = None
            if self.device.connected and not disconnected:
                try:
                    await self.device.command(Kind.MIC, b"\x00")
                except Exception as exc:
                    mute_error = exc
                    # Stop heartbeat as well if the node cannot confirm mute.
                    # Its watchdog then shuts acquisition down independently.
                    if not self.device.simulated and self.device.serial:
                        self.device.serial.close()
            old_session = self.session
            self.stop_analysis()
            await self.speech.set_mode("off")
            if old_session:
                self.store.end_session(old_session)
            self.session = None
            self.mode = "off"
            self.level = 0
            if mode != "off":
                self.analysis_error = None
            try:
                if mute_error:
                    raise mute_error
                if mode != "off":
                    if mode in RECOGNITION_MODES:
                        await self.speech.set_mode(mode)
                    if mode == "transcribe":
                        self.session = self.store.start_session()
                    await self.device.command(Kind.MIC, b"\x01")
                    deadline = time.monotonic() + 2.5
                    while not self.device.mic and time.monotonic() < deadline:
                        await asyncio.sleep(.025)
                    if not self.device.mic:
                        raise ValueError("Node did not start microphone capture")
                    self.mode = mode
                    self.mode_since = self.last_audio = time.monotonic()
                    if mode == "analyze":
                        self.analyzer = analysis.Analyzer()
                        if self.device.simulated:
                            # No node microphone here: the signal is synthetic and says so.
                            self.synthetic = asyncio.create_task(self.synthetic_microphone(self.analysis_generation))
            except Exception:
                self.stop_analysis()
                with contextlib.suppress(Exception):
                    await self.device.command(Kind.MIC, b"\x00")
                await self.speech.set_mode("off")
                if self.session:
                    self.store.end_session(self.session)
                self.session = None
                self.mode = "off"
                raise
            finally:
                await self.broadcast({"type": "mic", "mode": self.mode, "session": self.session, "capture": self.device.mic, "error": self.mic_error()})

    # ---- timers --------------------------------------------------------------------------

    def timer_command(self, data):
        # Work on a copy and swap it in only once the database has accepted it, so memory and
        # database cannot disagree after a failed write.
        timers = copy.deepcopy(self.timers)
        op = data.get("op")
        if op == "create":
            seconds = data.get("seconds", 300)
            if not is_number(seconds) or not 5 <= seconds <= 86400 or not math.isfinite(seconds):
                raise ValueError("Timer duration must be 5 seconds to 24 hours")
            label = data.get("label", "FIELD TIMER")
            if not isinstance(label, str):
                raise ValueError("Timer label must be text")
            if len(timers) >= 8:
                raise ValueError("Eight timers are already present. Remove a finished timer first.")
            seconds = float(seconds)
            timers.append({"id": uuid.uuid4().hex[:12], "label": label[:32],
                           "duration": seconds, "remaining": seconds, "deadline": time.time() + seconds,
                           "running": True, "finished": False})
        else:
            timer = next((t for t in timers if t["id"] == data.get("id")), None)
            if not timer:
                raise ValueError("Timer not found")
            if op == "toggle":
                if timer["running"]:
                    if time.time() >= timer["deadline"]:
                        return  # already due: tick() finishes it and raises the alert
                    timer["remaining"] = max(0, timer["deadline"] - time.time())
                    timer["running"] = False
                else:
                    if timer["remaining"] <= 0:
                        timer["remaining"] = timer["duration"]
                    timer.update(running=True, finished=False, deadline=time.time() + timer["remaining"])
            elif op == "reset":
                timer.update(remaining=timer["duration"], running=False, finished=False)
            elif op == "remove":
                timers.remove(timer)
            else:
                raise ValueError("Unknown timer action")
        self.store.put("timers", timers)
        self.timers = timers
        self.timers_dirty = False

    # ---- commands from the controlling tab -------------------------------------------------

    async def command(self, data):
        kind = data.get("command")
        if kind == "leds":
            values = data.get("values")
            if not isinstance(values, list) or len(values) != 9 or any(type(x) is not int or not 0 <= x <= 255 for x in values):
                raise ValueError("Nine integer light values from 0 to 255 required")
            await self.device.command(Kind.LEDS, bytes(values))
        elif kind == "pattern":
            steps, repeat = data.get("steps"), data.get("repeat", 1)
            if not isinstance(steps, list) or not 1 <= len(steps) <= 16 or type(repeat) is not int or not 1 <= repeat <= 8:
                raise ValueError("Pattern must contain 1–16 steps and repeat 1–8 times")
            payload = bytes([repeat, len(steps)])
            for step in steps:
                if not isinstance(step, dict):
                    raise ValueError("Invalid pattern step")
                ms, values = step.get("ms"), step.get("values")
                if (type(ms) is not int or not 10 <= ms <= 10000 or not isinstance(values, list) or len(values) != 9
                        or any(type(v) is not int or not 0 <= v <= 255 for v in values)):
                    raise ValueError("Invalid pattern step")
                payload += struct.pack("<H9B", ms, *values)
            await self.device.command(Kind.PATTERN, payload)
        elif kind == "reaction":
            trial, delay = data.get("trial"), data.get("delay")
            if type(trial) is not int or type(delay) is not int or not 0 <= trial <= 0xFFFFFFFF or not 250 <= delay <= 10000:
                raise ValueError("Invalid reaction round")
            await self.device.command(Kind.LEDS, bytes([70, 18, 0, 0, 0, 0, 0, 0, 0]))
            await self.device.command(Kind.ARM, struct.pack("<IIBBBB", trial, delay, 1, 30, 255, 90))
        elif kind == "cancel":
            await self.device.command(Kind.CANCEL)
        elif kind == "button":
            if not self.device.simulated:
                raise ValueError("Desktop controls are disabled in hardware mode")
            if type(data.get("pressed")) is not bool:
                raise ValueError("pressed must be true or false")
            await self.device.button(data["pressed"])
        elif kind == "mic":
            mode = data.get("mode")
            if not isinstance(mode, str):
                raise ValueError("Unknown microphone mode")
            await self.set_mic(mode)
        elif kind == "keepalive":
            # Optional liveness signal: once a controlling tab has sent one, silence for
            # KEEPALIVE_TIMEOUT seconds with the microphone on turns the microphone off.
            self.keepalive_armed = True
        elif kind == "timer":
            self.timer_command(data)
            await self.broadcast({"type": "timers", "timers": self.public_timers()})
        elif kind == "score":
            app, metric = data.get("app"), data.get("metric", "default")
            if not isinstance(app, str) or app not in APP_IDS:
                raise ValueError("Unknown app")
            if not isinstance(metric, str):
                raise ValueError("Unknown score class")
            if app == "reaction":
                if metric not in ("physical", "keyboard", "simulator"):
                    raise ValueError("Reaction score requires a timing source")
            elif metric != "default" and not (app == "glyphs" and metric in ("scan600", "scan850", "scan1200", "scan1600")):
                raise ValueError("Unknown score class")
            self.store.score(app if metric == "default" else app + ":" + metric, data.get("score"))
            await self.broadcast({"type": "scores", "scores": self.store.scores()})
        elif kind == "progress":
            app, value = data.get("app"), data.get("value")
            if not isinstance(app, str) or app not in APP_IDS or not isinstance(value, dict):
                raise ValueError("Invalid app progress")
            if len(json.dumps(value, allow_nan=False)) > 8192:  # allow_nan=False raises ValueError on NaN/Infinity
                raise ValueError("Invalid app progress")
            progress = self.store.get("progress", {})
            progress[app] = value
            self.store.put("progress", progress)
        elif kind == "settings":
            key, value = data.get("key"), data.get("value")
            validate_setting(key, value)
            settings = {**self.settings, key: value}
            self.store.put("settings", settings)
            self.settings = settings
            await self.broadcast({"type": "settings", "settings": self.settings})
        elif kind == "reset_settings":
            settings = dict(DEFAULT_SETTINGS)
            self.store.put("settings", settings)
            self.settings = settings
            await self.broadcast({"type": "settings", "settings": self.settings})
        elif kind == "focus":
            focus = data.get("app")
            if not isinstance(focus, str) or (focus != "home" and focus not in APP_IDS):
                raise ValueError("Unknown app")
            self.focus = focus
        else:
            raise ValueError("Unknown command")
        return {"accepted": True}

    # ---- background work -----------------------------------------------------------------

    async def tick(self):
        while True:
            await asyncio.sleep(1)
            try:
                await self.tick_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logging.exception("Timer pass failed; will retry")

    async def tick_once(self):
        now = time.time()
        for timer in list(self.timers):
            if timer["running"] and now >= timer["deadline"]:
                timer.update(running=False, remaining=0, finished=True)
                self.timers_dirty = True
                # The alert comes first and each step stands alone: a failing disk must not hide it.
                try:
                    await self.broadcast({"type": "timer_done", "timer": timer})
                    # Gameplay keeps its LEDs; the screen always receives an alert.
                    if self.device.connected and self.focus in ("home", "timers", "environment"):
                        await self.broadcast({"type": "light_effect", "durationMs": 1200})
                        payload = bytes([3, 2]) + struct.pack("<H9B", 180, *([180, 100, 0]*3)) + struct.pack("<H9B", 180, *([0]*9))
                        with contextlib.suppress(Exception):
                            await self.device.command(Kind.PATTERN, payload)
                except Exception:
                    logging.exception("Timer alert failed")
        if self.timers_dirty:
            try:
                self.store.put("timers", self.timers)
                self.timers_dirty = False
            except Exception as exc:
                logging.warning("Timers not saved (will retry): %s", exc)
        if self.timers:
            await self.broadcast({"type": "timers", "timers": self.public_timers()})
        await self.watch_microphone()

    async def watch_microphone(self):
        """Safety nets for capture the console does not know about, or that has silently stopped."""
        now = time.monotonic()
        # Node reports capture while the console says off (a lost mute): send the mute again.
        if self.mode == "off" and self.device.connected and self.device.mic and not self.mode_lock.locked():
            self.stray_capture += 1
            if self.stray_capture >= 2:
                logging.warning("Node reports capture while the microphone is off; muting it")
                self.stray_capture = 0
                self.schedule(self.set_mic("off"))
        else:
            self.stray_capture = 0
        if self.mode == "off":
            return
        # A controlling tab that opted in and then went silent (hung renderer): stop capture.
        if self.keepalive_armed and self.controller is not None and now - self.controller_seen > KEEPALIVE_TIMEOUT:
            logging.warning("Controlling tab silent for %d s; microphone off", KEEPALIVE_TIMEOUT)
            await self.broadcast({"type": "error", "error": "The controlling tab stopped responding; microphone turned off."})
            self.schedule(self.set_mic("off"))
        if self.mode == "analyze" and now - max(self.last_audio, self.mode_since) > AUDIO_STALL:
            await self.analysis_failed("No audio from the microphone for %d seconds" % AUDIO_STALL)

    async def supervise(self, name, factory):
        """Run a long-lived task for ever: an error is logged and the task restarted, never lost."""
        delay = 1
        while not self.closing:
            started = time.monotonic()
            try:
                await factory()
                if not self.closing:
                    logging.error("Task %s ended unexpectedly; restarting", name)
            except asyncio.CancelledError:
                raise
            except Exception:
                logging.exception("Task %s failed; restarting in %d s", name, delay)
            delay = 1 if time.monotonic() - started > 60 else min(delay * 2, 30)
            await asyncio.sleep(delay)

    async def start(self, app):
        self.task_names = ["device", "timers"]
        self.tasks = [asyncio.create_task(self.supervise("device", self.device.run)),
                      asyncio.create_task(self.supervise("timers", self.tick))]

    async def stop(self, app):
        self.closing = True
        with contextlib.suppress(Exception):
            await self.set_mic("off")
        self.stop_analysis()
        await self.speech.close()
        await self.device.close()
        boxes = [box.task for box in self.outboxes.values()]
        for task in [*self.tasks, *self.background, *boxes]:
            task.cancel()
        await asyncio.gather(*self.tasks, *self.background, *boxes, return_exceptions=True)
        for client in list(self.clients):
            await client.close()
        self.store.close()

    # ---- system health -------------------------------------------------------------------

    async def system(self):
        """The payload of GET /api/system (see docs/PROTOCOL.md)."""
        host, process = await asyncio.to_thread(self.host.sample)
        device = self.device
        status = device.status if isinstance(device.status, dict) else {}
        age = safe(lambda: round(time.monotonic() - device.status_at, 1))
        node = {
            "connected": bool(device.connected),
            "simulated": bool(device.simulated),
            "port": "simulated" if device.simulated else safe(lambda: str(device.name)),
            "link": status.get("link"),
            "firmware": status.get("fw"),
            "statusAgeS": age,
            "capture": bool(device.mic),
            "generation": device.generation,
            "crcErrors": safe(lambda: device.crc_errors),
            "missingSamples": safe(lambda: device.audio_missing),
            "audioBytes": safe(lambda: device.audio_bytes),
            "nodeRxCrc": status.get("rx_crc"),
            "audioDrops": status.get("audio_drops"),
            "sensor": status.get("sensor"),
        }
        alive = {name: not task.done() for name, task in zip(self.task_names, self.tasks)}
        service = {
            "version": VERSION,
            "startedAt": round(self.started, 1),
            "uptimeS": round(time.time() - self.started, 1),
            "rssBytes": process["rssBytes"],
            "pid": os.getpid(),
            "python": "%d.%d.%d" % sys.version_info[:3],
            "tasks": alive or None,
            "clients": len(self.clients),
            "micMode": self.mode,
        }
        return {"schema": 1, "at": round(time.time(), 3), "simulated": bool(device.simulated),
                "host": host, "service": service, "node": node}


@web.middleware
async def local_only(request, handler):
    # Reject cross-origin control and DNS rebinding even on a loopback bind.
    host = request.host.split(":")[0].lower()
    if host not in ("localhost", "127.0.0.1", "[::1]"):
        raise web.HTTPForbidden(text="VESPER accepts local connections only")
    origin = request.headers.get("Origin")
    if origin and origin not in ("http://" + request.host, "https://" + request.host):
        raise web.HTTPForbidden(text="Cross-origin connection rejected")
    try:
        response = await handler(request)
    except web.HTTPException as error:
        secure(error)
        raise
    secure(response)
    return response


def secure(response):
    # no-cache: the console is updated in place, and the kiosk browser must revalidate (a cheap
    # 304) rather than keep serving an old UI for a service that has moved on.
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"


def make_app(args):
    console = Console(args)
    app = web.Application(middlewares=[local_only], client_max_size=65536)
    app["console"] = console
    async def index(request):
        return web.FileResponse(ROOT / "web" / "index.html")
    async def state(request):
        return web.json_response(console.state())
    async def system(request):
        return web.json_response(await console.system(), dumps=lambda data: json.dumps(data, allow_nan=False))
    async def history(request):
        return web.json_response(console.store.history())
    async def sessions(request):
        try:
            offset = min(2 ** 31, max(0, int(request.query.get("offset", "0"))))
        except ValueError:
            raise web.HTTPBadRequest(text="Invalid note offset")
        return web.json_response(console.store.sessions(offset=offset))
    async def transcript(request):
        sid = request.match_info["sid"]
        if not re.fullmatch(r"[0-9a-f]{32}", sid):
            raise web.HTTPBadRequest(text="Invalid session")
        lines = console.store.transcript(sid)
        if request.path.startswith("/api/export/"):
            text = "VESPER-9 / FIELD TRANSCRIPT\n\n" + "\n".join(time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(r["at"])) + "  " + r["text"] for r in lines)
            return web.Response(text=text, content_type="text/plain", headers={"Content-Disposition": f'attachment; filename="vesper-transcript-{sid[:8]}.txt"'})
        return web.json_response(lines)
    async def websocket(request):
        ws = web.WebSocketResponse(heartbeat=15, max_msg_size=65536, timeout=2)
        await ws.prepare(request)
        # Everything after prepare() is inside the try: whatever fails (a tab that closes during
        # the handshake, a database error in state()), the finally releases control.
        try:
            console.clients.add(ws)
            if console.controller is None:
                console.controller = ws
                console.controller_seen = time.monotonic()
                console.keepalive_armed = False
            console.send(ws, {**console.state(), "controller": console.controller is ws})
            async for message in ws:
                if console.controller is ws:
                    console.controller_seen = time.monotonic()
                if message.type == WSMsgType.BINARY:
                    # In the simulator the browser's microphone feeds recognition; analysis uses
                    # the service's own synthetic signal, so browser audio is ignored then.
                    if (console.controller is ws and console.device.simulated and console.mode not in ("off", "analyze")
                            and len(message.data) <= 16384 and len(message.data) % 2 == 0):
                        await console.event({"type": "audio", "pcm": message.data})
                    continue
                if message.type != WSMsgType.TEXT:
                    continue
                ident = None
                try:
                    try:
                        data = json.loads(message.data)
                    except RecursionError:
                        raise ValueError("JSON nested too deeply")
                    if not isinstance(data, dict):
                        raise ValueError("Object message required")
                    ident = data.get("requestId")
                    if console.controller is not ws:
                        raise ValueError("This is a monitor tab. Close the controlling tab, then reload.")
                    # A tab that has just replaced a departed controller waits for that tab's cleanup.
                    await asyncio.wait_for(console.settled.wait(), 5)
                    result = await console.command(data)
                    if ident is not None:
                        console.send(ws, {"type": "reply", "id": ident, "ok": True, "data": result})
                except (ValueError, ConnectionError, asyncio.TimeoutError) as exc:
                    console.send(ws, {"type": "reply", "id": ident, "ok": False, "error": str(exc) or "Node command timed out"})
                except Exception as exc:
                    # Device or storage faults and anything unforeseen: answer, keep the session.
                    logging.exception("Command failed")
                    console.send(ws, {"type": "reply", "id": ident, "ok": False, "error": f"{type(exc).__name__}: {exc}"})
        finally:
            await console.release_controller(ws)
        return ws
    async def close_sockets(app):
        # Without this aiohttp waits (about 24 s measured) for every idle /ws handler.
        console.closing = True
        await asyncio.gather(*(client.close(code=WSCloseCode.GOING_AWAY, message=b"Service stopping")
                               for client in list(console.clients)), return_exceptions=True)
    app.router.add_get("/", index)
    app.router.add_get("/api/state", state)
    app.router.add_get("/api/system", system)
    app.router.add_get("/api/history", history)
    app.router.add_get("/api/sessions", sessions)
    app.router.add_get("/api/transcript/{sid}", transcript)
    app.router.add_get("/api/export/{sid}", transcript)
    app.router.add_get("/ws", websocket)
    app.router.add_static("/", ROOT / "web", show_index=False)
    app.on_startup.append(console.start)
    app.on_shutdown.append(close_sockets)
    app.on_cleanup.append(console.stop)
    return app


def main():
    parser = argparse.ArgumentParser(description="VESPER-9 single-button console")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--simulate", action="store_true", help="Use the clearly labelled desktop simulator")
    mode.add_argument("--port", help="Node serial device, preferably /dev/serial/by-id/…; several comma-separated candidates (COM and native USB) may be given")
    parser.add_argument("--baud", type=int, default=921600)
    parser.add_argument("--http-port", type=int, default=8799)
    parser.add_argument("--data", default=None)
    parser.add_argument("--model", default=str(ROOT / "models" / "vosk-model-small-en-us-0.15"))
    args = parser.parse_args()
    if args.data is None:
        args.data = str(ROOT / "data" / ("simulator" if args.simulate else "console"))
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    web.run_app(make_app(args), host="127.0.0.1", port=args.http_port, shutdown_timeout=3,
                print=lambda _: print(f"VESPER-9 → http://localhost:{args.http_port} / {'SIMULATOR' if args.simulate else args.port}"))


if __name__ == "__main__":
    main()
