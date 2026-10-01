"""Local appliance service for VESPER-9. Run: python -m vesper.server --simulate."""
import argparse
import asyncio
import base64
import contextlib
import json
import logging
import math
import re
import struct
import time
import uuid
from array import array
from pathlib import Path

from aiohttp import web, WSMsgType

from .device import SerialDevice, SimulatedDevice
from .protocol import Kind
from .speech import Speech, COMMANDS
from .storage import Store

ROOT = Path(__file__).resolve().parents[1]
from .catalog import APP_IDS, DEFAULT_SETTINGS, validate_setting



class Console:
    def __init__(self, args):
        self.args = args
        self.store = Store(args.data)
        self.clients = set()
        self.controller = None
        self.background = set()
        self.device = SimulatedDevice(self.event) if args.simulate else SerialDevice(args.port, args.baud, self.event)
        self.speech = Speech(args.model, self.speech_event, self.speech_failed)
        self.mode_lock = asyncio.Lock()
        self.mode = "off"
        self.session = None
        self.focus = "home"
        self.sensor = None
        self.level = 0
        self.last_level = 0
        self.last_saved_sensor = 0
        self.last_command = 0
        self.timers = self.store.get("timers", [])
        self.settings = {**DEFAULT_SETTINGS, **self.store.get("settings", {})}
        self.tasks = []
        self.closing = False

    def schedule(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.background.add(task)
        def done(t):
            self.background.discard(t)
            if not t.cancelled() and t.exception():
                logging.error("Background operation failed: %s", t.exception())
        task.add_done_callback(done)
        return task

    def state(self):
        return {"type": "state", "version": "0.2.0", "simulated": self.device.simulated,
                "device": {"connected": self.device.connected, "name": self.device.name, "capture": self.device.mic,
                           "crcErrors": self.device.crc_errors, "missingSamples": self.device.audio_missing,
                           "audioBytes": self.device.audio_bytes, "button": self.device.pressed, "generation": self.device.generation},
                "leds": self.device.leds, "mic": {"mode": self.mode, "level": self.level, "session": self.session,
                           "unavailable": self.speech.availability(), "droppedChunks": self.speech.dropped, "error": self.speech.error},
                "sensor": self.sensor, "timers": self.public_timers(), "settings": self.settings,
                "scores": self.store.scores(), "progress": self.store.get("progress", {}), "serverTime": time.time()}

    def public_timers(self):
        now = time.time()
        return [{**t, "remaining": max(0, t["deadline"] - now) if t["running"] else t["remaining"]} for t in self.timers]

    async def broadcast(self, event):
        dead = []
        for client in list(self.clients):
            try:
                await asyncio.wait_for(client.send_json(event), 1)
            except (ConnectionError, RuntimeError, asyncio.TimeoutError):
                dead.append(client)
        for client in dead:
            self.clients.discard(client)
            await client.close()

    async def event(self, event):
        kind = event["type"]
        if kind == "audio":
            if self.mode != "off":
                pcm = event["pcm"]
                self.speech.feed(pcm)
                now = time.monotonic()
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
                self.store.sensor(event["temperature"], event["humidity"])
                self.last_saved_sensor = time.monotonic()
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

    async def set_mic(self, mode, disconnected=False):
        if mode not in ("off", "commands", "transcribe"):
            raise ValueError("Unknown microphone mode")
        async with self.mode_lock:
            if mode == self.mode:
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
            await self.speech.set_mode("off")
            if old_session:
                self.store.end_session(old_session)
            self.session = None
            self.mode = "off"
            self.level = 0
            try:
                if mute_error:
                    raise mute_error
                if mode != "off":
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
            except Exception:
                with contextlib.suppress(Exception):
                    await self.device.command(Kind.MIC, b"\x00")
                await self.speech.set_mode("off")
                if self.session:
                    self.store.end_session(self.session)
                self.session = None
                raise
            finally:
                await self.broadcast({"type": "mic", "mode": self.mode, "session": self.session, "capture": self.device.mic, "error": self.speech.error})

    def timer_command(self, data):
        op = data.get("op")
        if op == "create":
            seconds = float(data.get("seconds", 300))
            if not math.isfinite(seconds) or not 5 <= seconds <= 86400:
                raise ValueError("Timer duration must be 5 seconds to 24 hours")
            if len(self.timers) >= 8:
                raise ValueError("Eight timers are already present. Remove a finished timer first.")
            self.timers.append({"id": uuid.uuid4().hex[:12], "label": str(data.get("label", "FIELD TIMER"))[:32],
                                "duration": seconds, "remaining": seconds, "deadline": time.time() + seconds,
                                "running": True, "finished": False})
        else:
            timer = next((t for t in self.timers if t["id"] == data.get("id")), None)
            if not timer:
                raise ValueError("Timer not found")
            if op == "toggle":
                if timer["running"]:
                    timer["remaining"] = max(0, timer["deadline"] - time.time())
                    timer["running"] = False
                else:
                    if timer["remaining"] <= 0:
                        timer["remaining"] = timer["duration"]
                    timer.update(running=True, finished=False, deadline=time.time() + timer["remaining"])
            elif op == "reset":
                timer.update(remaining=timer["duration"], running=False, finished=False)
            elif op == "remove":
                self.timers.remove(timer)
            else:
                raise ValueError("Unknown timer action")
        self.store.put("timers", self.timers)

    async def command(self, data):
        kind = data.get("command")
        if kind == "leds":
            values = data.get("values")
            if not isinstance(values, list) or len(values) != 9 or any(type(x) is not int or not 0 <= x <= 255 for x in values):
                raise ValueError("Nine integer light values from 0 to 255 required")
            await self.device.command(Kind.LEDS, bytes(values))
        elif kind == "pattern":
            steps = data.get("steps", [])
            repeat = int(data.get("repeat", 1))
            if not 1 <= len(steps) <= 16 or not 1 <= repeat <= 8:
                raise ValueError("Pattern must contain 1–16 steps and repeat 1–8 times")
            payload = bytes([repeat, len(steps)])
            for step in steps:
                ms, values = int(step["ms"]), step["values"]
                if not 10 <= ms <= 10000 or len(values) != 9 or any(type(v) is not int or not 0 <= v <= 255 for v in values):
                    raise ValueError("Invalid pattern step")
                payload += struct.pack("<H9B", ms, *values)
            await self.device.command(Kind.PATTERN, payload)
        elif kind == "reaction":
            trial, delay = int(data["trial"]), int(data["delay"])
            if not 0 <= trial <= 0xFFFFFFFF or not 250 <= delay <= 10000:
                raise ValueError("Invalid reaction round")
            await self.device.command(Kind.LEDS, bytes([70, 18, 0, 0, 0, 0, 0, 0, 0]))
            await self.device.command(Kind.ARM, struct.pack("<IIBBBB", trial, delay, 1, 30, 255, 90))
        elif kind == "cancel":
            await self.device.command(Kind.CANCEL)
        elif kind == "button":
            if not self.device.simulated:
                raise ValueError("Desktop controls are disabled in hardware mode")
            await self.device.button(bool(data.get("pressed")))
        elif kind == "mic":
            await self.set_mic(data.get("mode"))
        elif kind == "timer":
            self.timer_command(data)
            await self.broadcast({"type": "timers", "timers": self.public_timers()})
        elif kind == "score":
            app = data.get("app")
            if app not in APP_IDS:
                raise ValueError("Unknown app")
            metric = data.get("metric", "default")
            if app == "reaction":
                if metric not in ("physical", "keyboard", "simulator"):
                    raise ValueError("Reaction score requires a timing source")
            elif metric != "default" and not (app == "glyphs" and metric in ("scan600", "scan850", "scan1200", "scan1600")):
                raise ValueError("Unknown score class")
            self.store.score(app if metric == "default" else app + ":" + metric, data.get("score"))
            await self.broadcast({"type": "scores", "scores": self.store.scores()})
        elif kind == "progress":
            app, value = data.get("app"), data.get("value")
            if app not in APP_IDS or not isinstance(value, dict) or len(json.dumps(value)) > 8192:
                raise ValueError("Invalid app progress")
            progress = self.store.get("progress", {})
            progress[app] = value
            self.store.put("progress", progress)
        elif kind == "settings":
            key, value = data.get("key"), data.get("value")
            validate_setting(key, value)
            self.settings[key] = value
            self.store.put("settings", self.settings)
            await self.broadcast({"type": "settings", "settings": self.settings})
        elif kind == "reset_settings":
            self.settings = dict(DEFAULT_SETTINGS)
            self.store.put("settings", self.settings)
            await self.broadcast({"type": "settings", "settings": self.settings})
        elif kind == "focus":
            focus = data.get("app")
            if focus != "home" and focus not in APP_IDS:
                raise ValueError("Unknown app")
            self.focus = focus
        else:
            raise ValueError("Unknown command")
        return {"accepted": True}

    async def tick(self):
        while True:
            await asyncio.sleep(1)
            for timer in self.timers:
                if timer["running"] and time.time() >= timer["deadline"]:
                    timer.update(running=False, remaining=0, finished=True)
                    self.store.put("timers", self.timers)
                    await self.broadcast({"type": "timer_done", "timer": timer})
                    # Gameplay keeps its LEDs; the screen always receives an alert.
                    if self.device.connected and self.focus in ("home", "timers", "environment"):
                        await self.broadcast({"type": "light_effect", "durationMs": 1200})
                        payload = bytes([3, 2]) + struct.pack("<H9B", 180, *([180, 100, 0]*3)) + struct.pack("<H9B", 180, *([0]*9))
                        with contextlib.suppress(Exception):
                            await self.device.command(Kind.PATTERN, payload)
            if self.timers:
                await self.broadcast({"type": "timers", "timers": self.public_timers()})

    async def start(self, app):
        self.tasks = [asyncio.create_task(self.device.run()), asyncio.create_task(self.tick())]

    async def stop(self, app):
        self.closing = True
        with contextlib.suppress(Exception):
            await self.set_mic("off")
        await self.speech.close()
        await self.device.close()
        for task in [*self.tasks, *self.background]:
            task.cancel()
        await asyncio.gather(*self.tasks, *self.background, return_exceptions=True)
        for client in list(self.clients):
            await client.close()
        self.store.close()


@web.middleware
async def local_only(request, handler):
    # Reject cross-origin control and DNS rebinding even on a loopback bind.
    host = request.host.split(":")[0].lower()
    if host not in ("localhost", "127.0.0.1", "[::1]"):
        raise web.HTTPForbidden(text="VESPER accepts local connections only")
    origin = request.headers.get("Origin")
    if origin and origin not in ("http://" + request.host, "https://" + request.host):
        raise web.HTTPForbidden(text="Cross-origin connection rejected")
    response = await handler(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def make_app(args):
    console = Console(args)
    app = web.Application(middlewares=[local_only], client_max_size=65536)
    app["console"] = console
    async def index(request):
        return web.FileResponse(ROOT / "web" / "index.html")
    async def state(request):
        return web.json_response(console.state())
    async def history(request):
        return web.json_response(console.store.history())
    async def sessions(request):
        try:
            offset = max(0, int(request.query.get("offset", "0")))
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
        ws = web.WebSocketResponse(heartbeat=15, max_msg_size=65536)
        await ws.prepare(request)
        console.clients.add(ws)
        if console.controller is None:
            console.controller = ws
        await ws.send_json({**console.state(), "controller": console.controller is ws})
        try:
            async for message in ws:
                if message.type == WSMsgType.BINARY:
                    if console.controller is ws and console.device.simulated and console.mode != "off" and len(message.data) <= 16384 and len(message.data) % 2 == 0:
                        await console.event({"type": "audio", "pcm": message.data})
                    continue
                if message.type != WSMsgType.TEXT:
                    continue
                ident = None
                try:
                    data = json.loads(message.data)
                    if not isinstance(data, dict):
                        raise ValueError("Object message required")
                    ident = data.get("requestId")
                    if console.controller is not ws:
                        raise ValueError("This is a monitor tab. Close the controlling tab, then reload.")
                    result = await console.command(data)
                    if ident is not None:
                        await ws.send_json({"type": "reply", "id": ident, "ok": True, "data": result})
                except (ValueError, TypeError, KeyError, ConnectionError, asyncio.TimeoutError, struct.error) as exc:
                    await ws.send_json({"type": "reply", "id": ident, "ok": False, "error": str(exc) or "Node command timed out"})
        finally:
            console.clients.discard(ws)
            if console.controller is ws:
                console.controller = None
                if not console.closing:
                    with contextlib.suppress(Exception):
                        await console.set_mic("off")
                        await console.device.command(Kind.CANCEL)
                        await console.device.command(Kind.LEDS, bytes(9))
                        if console.device.simulated:
                            await console.device.button(False)
        return ws
    app.router.add_get("/", index)
    app.router.add_get("/api/state", state)
    app.router.add_get("/api/history", history)
    app.router.add_get("/api/sessions", sessions)
    app.router.add_get("/api/transcript/{sid}", transcript)
    app.router.add_get("/api/export/{sid}", transcript)
    app.router.add_get("/ws", websocket)
    app.router.add_static("/", ROOT / "web", show_index=False)
    app.on_startup.append(console.start)
    app.on_cleanup.append(console.stop)
    return app


def main():
    parser = argparse.ArgumentParser(description="VESPER-9 single-button console")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--simulate", action="store_true", help="Use the clearly labelled desktop simulator")
    mode.add_argument("--port", help="ESP32 COM serial device, preferably /dev/serial/by-id/…")
    parser.add_argument("--baud", type=int, default=921600)
    parser.add_argument("--http-port", type=int, default=8799)
    parser.add_argument("--data", default=None)
    parser.add_argument("--model", default=str(ROOT / "models" / "vosk-model-small-en-us-0.15"))
    args = parser.parse_args()
    if args.data is None:
        args.data = str(ROOT / "data" / ("simulator" if args.simulate else "console"))
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    web.run_app(make_app(args), host="127.0.0.1", port=args.http_port, print=lambda _: print(f"VESPER-9 → http://localhost:{args.http_port} / {'SIMULATOR' if args.simulate else args.port}"))


if __name__ == "__main__":
    main()
