"""Regression tests for the Python service defects found by the audit (agent audit-service).

Classes named ``Fixed*`` each prove a defect that was reproduced by a failing test before it was
fixed; their docstrings describe what the owner would have experienced. ``Verified*`` classes pin
behaviour the audit checked and found correct. Nothing here opens a serial port: the transport
tests inject a fake ``serial`` module.
"""
import argparse
import asyncio
import contextlib
import importlib.util
import io
import json
import logging
import os
import runpy
import signal
import socket
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

import aiohttp
from aiohttp.test_utils import TestClient, TestServer

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from serial import SerialTimeoutException  # noqa: E402  (the exception class only; no port is opened)
from vesper.device import SerialDevice  # noqa: E402
from vesper.protocol import Decoder, Kind, encode  # noqa: E402
from vesper.server import Console, make_app  # noqa: E402
from vesper.storage import Store  # noqa: E402

REAL_SLEEP = asyncio.sleep
ZEROS = "[0,0,0,0,0,0,0,0,0]"


def make_args(directory, simulate=True, port=None):
    return argparse.Namespace(data=directory, simulate=simulate, port=port, baud=921600, model=directory)


# --------------------------------------------------------------------------------------
# Simulated service (aiohttp test server + simulated node), as in tests/test_runtime.py
# --------------------------------------------------------------------------------------
class ServiceCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Several tests make the server raise on purpose; keep its tracebacks out of the output.
        logging.getLogger("aiohttp.server").setLevel(logging.CRITICAL)
        self.temporary = tempfile.TemporaryDirectory()
        self.client = TestClient(TestServer(make_app(make_args(self.temporary.name))))
        await self.client.start_server()
        self.console = self.client.app["console"]
        self.ident = 0

    async def asyncTearDown(self):
        await self.client.close()
        self.temporary.cleanup()

    async def connect(self):
        ws = await self.client.ws_connect("/ws")
        return ws, await ws.receive_json()

    async def rpc(self, ws, command, **data):
        self.ident += 1
        await ws.send_json({**data, "requestId": self.ident, "command": command})
        for _ in range(100):
            event = await asyncio.wait_for(ws.receive_json(), 3)
            if event.get("type") == "reply" and event.get("id") == self.ident:
                return event
        self.fail("No matching reply")

    async def reply_or_drop(self, ws, raw_text):
        """Send raw text; return the reply dict, or the closing message type if the server hung up."""
        await ws.send_str(raw_text)
        for _ in range(50):
            message = await asyncio.wait_for(ws.receive(), 3)
            if message.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(message.data)
                if data.get("type") == "reply":
                    return data
                continue
            return message.type
        self.fail("no reply and no close")

    def stub_speech(self):
        """Skip the Vosk model: record the requested mode and nothing else."""
        async def set_mode(mode):
            self.console.speech.mode = mode
        self.console.speech.set_mode = set_mode


class FixedCommandValidation(ServiceCase):
    async def test_out_of_range_numbers_get_an_error_reply_not_a_dropped_session(self):
        """ROUGH (only a non-browser client can send these: JSON.stringify never emits 1e999 or a
        400-digit integer): a number Python accepts but the validators do not expect (an integer
        too large for float(), 1e999, or deeply nested JSON) raises OverflowError or RecursionError,
        which the WebSocket handler does not catch. aiohttp drops the connection, the sender loses
        its session, and if it was the controller the microphone is muted and the lamps cleared."""
        big = "1" + "0" * 400
        cases = {
            "timer seconds = 10**400 (float() overflow)": '{"command":"timer","op":"create","seconds":%s}' % big,
            "reaction delay = 1e999 (int(inf))": '{"command":"reaction","trial":1,"delay":1e999}',
            "reaction trial = 1e999": '{"command":"reaction","trial":1e999,"delay":500}',
            "pattern repeat = 1e999": '{"command":"pattern","repeat":1e999,"steps":[{"ms":100,"values":%s}]}' % ZEROS,
            "pattern step ms = 1e999": '{"command":"pattern","repeat":1,"steps":[{"ms":1e999,"values":%s}]}' % ZEROS,
            "score = 10**400 (math.isfinite overflow)": '{"command":"score","app":"orbit","score":%s}' % big,
            "settings volume = 10**400": '{"command":"settings","key":"volume","value":%s}' % big,
            "JSON nested 50000 deep (RecursionError)": "[" * 50000,
        }
        for name, raw in cases.items():
            with self.subTest(name):
                ws, snapshot = await self.connect()
                self.assertTrue(snapshot["controller"], "precondition: this tab must hold control")
                result = await self.reply_or_drop(ws, raw)
                self.assertIsInstance(result, dict, f"server dropped the connection ({result}) instead of replying")
                self.assertFalse(result["ok"])
                await ws.close()

    async def test_device_and_storage_errors_get_an_error_reply_not_a_dropped_session(self):
        """WRONG (reachable from the shipped UI under fault): the handler only catches ValueError,
        TypeError, KeyError, ConnectionError, TimeoutError and struct.error. pyserial's SerialTimeoutException (raised
        when a write exceeds the 0.5 s write_timeout) and sqlite3.Error ("database is locked" while
        a backup runs, disk full) are neither, so one stalled write or one locked database drops
        the controller tab's session instead of answering with an error."""
        async def write_timeout(*args, **kwargs):
            raise SerialTimeoutException("Write timeout")

        def locked(*args, **kwargs):
            raise sqlite3.OperationalError("database is locked")
        cases = [
            ("serial write timeout during leds", self.console.device, "command", write_timeout,
             {"command": "leds", "values": [0] * 9}),
            ("serial write timeout during cancel", self.console.device, "command", write_timeout, {"command": "cancel"}),
            ("database locked during settings", self.console.store, "put", locked,
             {"command": "settings", "key": "sound", "value": False}),
            ("database locked during timer create", self.console.store, "put", locked,
             {"command": "timer", "op": "create", "seconds": 60}),
            ("database locked during progress", self.console.store, "put", locked,
             {"command": "progress", "app": "morse", "value": {"a": 1}}),
            ("database locked during score", self.console.store, "score", locked,
             {"command": "score", "app": "orbit", "score": 5}),
        ]
        for name, target, attribute, replacement, payload in cases:
            with self.subTest(name):
                ws, snapshot = await self.connect()
                self.assertTrue(snapshot["controller"], "precondition: this tab must hold control")
                original = getattr(target, attribute)
                setattr(target, attribute, replacement)
                try:
                    result = await self.reply_or_drop(ws, json.dumps({**payload, "requestId": 1}))
                finally:
                    setattr(target, attribute, original)
                self.assertIsInstance(result, dict, f"server dropped the connection ({result}) instead of replying")
                self.assertFalse(result["ok"])
                await ws.close()

    async def test_wrong_types_are_rejected_not_coerced(self):
        """WRONG: booleans, numeric strings and floats are coerced instead of rejected, so
        {"score": true} writes 1.0 into the high-score table, and {"pressed": "false"} presses
        the simulated switch. (leds and settings already use `type(x) is int` correctly.)"""
        cases = [
            ("score true", "score", {"app": "orbit", "score": True}),
            ("reaction trial true", "reaction", {"trial": True, "delay": 500}),
            ("reaction delay '500'", "reaction", {"trial": 1, "delay": "500"}),
            ("reaction delay 500.9", "reaction", {"trial": 1, "delay": 500.9}),
            ("pattern repeat '2'", "pattern", {"repeat": "2", "steps": [{"ms": 100, "values": [0] * 9}]}),
            ("pattern repeat true", "pattern", {"repeat": True, "steps": [{"ms": 100, "values": [0] * 9}]}),
            ("button pressed 'false'", "button", {"pressed": "false"}),
        ]
        ws, _ = await self.connect()
        for name, command, data in cases:
            with self.subTest(name):
                reply = await self.rpc(ws, command, **data)
                self.assertFalse(reply["ok"], "accepted a value of the wrong type")
        self.assertNotIn("orbit", self.console.store.scores(), "score=true was stored as a high score")
        await ws.close()

    async def test_non_finite_progress_cannot_poison_state(self):
        """ROUGH (not reachable from the shipped UI, JSON.stringify turns NaN into null):
        Python's json accepts NaN/Infinity, so a progress value is stored verbatim and every later
        /api/state (and the state frame sent to each new tab) is invalid JSON for JSON.parse in the
        browser, until someone edits the database."""
        ws, _ = await self.connect()
        reply = await self.rpc(ws, "progress", app="morse", value={"streak": 3})
        self.assertTrue(reply["ok"])
        await ws.send_str('{"command":"progress","app":"morse","value":{"score":NaN},"requestId":99}')
        await asyncio.sleep(.2)
        text = await (await self.client.get("/api/state")).text()

        def refuse(constant):
            raise ValueError("invalid JSON constant " + constant)
        try:
            json.loads(text, parse_constant=refuse)
        except ValueError as exc:
            self.fail(f"/api/state is not strict JSON after a progress write: {exc}")
        finally:
            await ws.close()


class FixedSessionAndControllerBookkeeping(ServiceCase):
    async def test_failed_handshake_does_not_leave_a_phantom_controller(self):
        """BREAKS control until the service is restarted: console.controller is assigned and the
        first state frame is sent OUTSIDE the try/finally in websocket(). If that send (or
        console.state()) raises once, the handler exits without releasing control, nothing ever
        clears it, and every later tab is a monitor ("Close the controlling tab, then reload")."""
        original, calls = self.console.state, {"n": 0}

        def flaky_state():
            calls["n"] += 1
            if calls["n"] == 1:
                raise sqlite3.OperationalError("disk I/O error")
            return original()
        self.console.state = flaky_state
        first = await self.client.ws_connect("/ws")
        message = await asyncio.wait_for(first.receive(), 3)
        self.assertNotEqual(message.type, aiohttp.WSMsgType.TEXT, "the failing handshake should not have produced state")
        await asyncio.sleep(.3)
        second, snapshot = await self.connect()
        self.assertTrue(snapshot["controller"], "a dead handshake still owns the controller slot")
        await second.close()
        await first.close()

    async def test_tab_that_vanishes_during_the_handshake_does_not_leave_a_phantom_controller(self):
        """BREAKS control until the service is restarted: same root cause as above with the
        realistic trigger. The tab closes (reload, kiosk restart) while the service is writing
        the first state frame, send_json raises ConnectionResetError, and no finally releases
        the controller slot."""
        real_send_json, calls = aiohttp.web.WebSocketResponse.send_json, {"n": 0}

        async def flaky_send_json(ws, data, *args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise ConnectionResetError("Cannot write to closing transport")
            return await real_send_json(ws, data, *args, **kwargs)
        with patch.object(aiohttp.web.WebSocketResponse, "send_json", flaky_send_json):
            first = await self.client.ws_connect("/ws")
            await asyncio.wait_for(first.receive(), 3)
            await asyncio.sleep(.3)
            second, snapshot = await self.connect()
        self.assertTrue(snapshot["controller"], "a dead handshake still owns the controller slot")
        await second.close()
        await first.close()

    async def test_focus_returns_home_when_the_controller_leaves(self):
        """WRONG: console.focus keeps the last app after the controller disconnects. tick() only
        pulses the lamps for a finished timer while focus is home/timers/environment, so a timer
        that ends after the browser closed or crashed mid-game never lights the lamps (the only
        alert left)."""
        ws, _ = await self.connect()
        self.assertTrue((await self.rpc(ws, "focus", app="runner"))["ok"])
        await ws.close()
        await asyncio.sleep(.3)
        self.assertIsNone(self.console.controller)
        self.assertEqual(self.console.focus, "home")

    async def test_session_rows_are_not_left_open_after_an_unclean_stop(self):
        """ROUGH: a power cut or SIGKILL during transcription leaves sessions.ended = NULL for
        ever; nothing reconciles open sessions at startup, so notes show as still recording."""
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            sid = store.start_session()
            store.line(sid, "kept")
            store.db.close()  # no end_session: the process died
            console = Console(make_args(directory))
            try:
                rows = console.store.sessions()
                self.assertEqual(len(rows), 1)
                self.assertIsNotNone(rows[0]["ended"], "session still open after restart")
            finally:
                console.store.close()

    async def test_sessions_offset_overflow_is_a_client_error(self):
        """ROUGH: ?offset=<larger than 2**63> reaches SQLite, raises OverflowError and returns a
        500 with a logged traceback instead of 400 (or an empty page) like other bad offsets."""
        async with self.client.get("/api/sessions?offset=99999999999999999999") as response:
            self.assertIn(response.status, (200, 400))


class FixedBroadcastAndTimers(ServiceCase):
    async def test_a_stalled_client_does_not_hold_up_the_node_event_path(self):
        """WRONG: broadcast() awaits each client in turn with a 1 s timeout, and the serial read
        loop awaits broadcast() for every packet. One wedged monitor tab (or a frozen controller)
        delays a button press by a second, and the whole sensor/audio stream with it."""
        class Stalled:
            async def send_json(self, event):
                await asyncio.sleep(30)

            async def close(self, *args, **kwargs):
                return None
        stalled = Stalled()
        self.console.clients.add(stalled)
        started = time.monotonic()
        try:
            await self.console.event({"type": "button", "pressed": True, "at_us": 1, "source": "node", "generation": 1})
            elapsed = time.monotonic() - started
        finally:
            self.console.clients.discard(stalled)
        self.assertLess(elapsed, .25, f"event() took {elapsed:.2f}s with one stalled client")

    async def test_timer_loop_survives_a_transient_storage_error(self):
        """BREAKS timers until restart: tick() has no error handling and its task is never
        awaited, so one sqlite3.OperationalError ("database is locked" while a backup runs) at the
        moment a timer completes kills it silently. No later timer ever finishes or alerts."""
        self.console.timer_command({"op": "create", "seconds": 60})
        self.console.timer_command({"op": "create", "seconds": 60})
        first, second = self.console.timers
        original, calls = self.console.store.put, {"n": 0}

        def flaky_put(key, value):
            calls["n"] += 1
            if calls["n"] == 1:
                raise sqlite3.OperationalError("database is locked")
            return original(key, value)
        self.console.store.put = flaky_put
        first["deadline"] = time.time() - 1
        await asyncio.sleep(1.4)
        second["deadline"] = time.time() - 1
        await asyncio.sleep(1.6)
        self.assertTrue(second["finished"], "tick() task is dead: later timers never complete")

    async def test_pausing_a_timer_at_the_instant_it_expires_still_alerts(self):
        """ROUGH: pause (toggle) between the deadline and the next once-a-second tick stores
        remaining=0, running=False, finished=False. The timer sits at 00:00 'paused' and the
        completion alert (timer_done, lamp pattern) is never raised."""
        self.console.timer_command({"op": "create", "seconds": 60})
        timer = self.console.timers[0]
        timer["deadline"] = time.time() - .2
        self.console.timer_command({"op": "toggle", "id": timer["id"]})
        await asyncio.sleep(1.3)
        stranded = timer["remaining"] == 0 and not timer["running"] and not timer["finished"]
        self.assertFalse(stranded, f"timer stranded at zero without finishing: {timer}")


# --------------------------------------------------------------------------------------
# Serial transport with a fake pyserial module and a fake node
# --------------------------------------------------------------------------------------
class FakeSerial:
    """Enough of pyserial.Serial and of the node (docs/PROTOCOL.md) to drive SerialDevice.run()."""
    created = []
    missing = False
    sensor_samples = False
    silent = set()   # ports that open fine but never send a byte

    def __init__(self):
        self.port = self.baudrate = self.timeout = self.write_timeout = self.dtr = self.rts = None
        self.is_open = False
        self._rx = bytearray()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._decoder = Decoder()
        self.frames = []          # host frames the node received
        self.mic = False
        self.ack = True
        self.fail_next_write = False
        self.fail_read = False
        self.created.append(self)

    # pyserial surface used by vesper.device
    def open(self):
        if self.missing:
            raise OSError(2, "No such file or directory: " + str(self.port))
        self.is_open = True
        if self.port not in self.silent:
            threading.Thread(target=self._chatter, daemon=True).start()

    @property
    def in_waiting(self):
        return len(self._rx)

    def read(self, count=1):
        deadline = time.monotonic() + (self.timeout or .1)
        while time.monotonic() < deadline:
            if self.fail_read:
                raise OSError(5, "device disappeared")
            with self._lock:
                if self._rx:
                    out = bytes(self._rx[:count])
                    del self._rx[:count]
                    return out
            time.sleep(.003)
        return b""

    def write(self, data):
        if self.fail_next_write:
            self.fail_next_write = False
            raise SerialTimeoutException("Write timeout")  # what pyserial raises when write_timeout expires
        for packet in self._decoder.feed(data):
            self.frames.append(packet)
            if packet.kind == Kind.MIC:
                self.mic = bool(packet.payload[0])
            if packet.kind != Kind.PING and self.ack:
                self.push(encode(Kind.ACK, struct.pack("<HBB", packet.sequence, 0, packet.kind), 0))
        return len(data)

    def close(self):
        self.is_open = False
        self._stop.set()

    # test controls
    def push(self, data):
        with self._lock:
            self._rx.extend(data)

    def count(self, kind):
        return sum(1 for p in self.frames if p.kind == kind)

    def _status(self):
        return encode(Kind.STATUS, json.dumps({"fw": "fake", "link": "uart", "mic": self.mic, "button": False,
                                               "leds": [0] * 9}).encode(), 0)

    def _chatter(self):
        """The real node sends STATUS about once a second whether or not it is pinged."""
        while not self._stop.is_set():
            self.push(self._status())
            if self.sensor_samples:
                self.push(encode(Kind.SENSOR, struct.pack("<Qff", 1, 21.5, 40.0), 0))
            self._stop.wait(.05)


class FastClock:
    """vesper.device.time with a monotonic clock running ten times faster, so the 4 s stale-link rule fits in a test."""
    def __getattr__(self, name):
        return getattr(time, name)

    @staticmethod
    def monotonic():
        return time.monotonic() * 10


async def quick_sleep(delay, *args, **kwargs):
    """Shrink the service's fixed 1 s and 2 s waits so reconnect behaviour fits in a unit test."""
    return await REAL_SLEEP(min(delay, .05) if delay >= 1 else delay, *args, **kwargs)


class SerialCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        FakeSerial.created = []
        FakeSerial.missing = False
        FakeSerial.sensor_samples = False
        FakeSerial.silent = set()
        module = types.ModuleType("serial")
        module.Serial = FakeSerial
        module.SerialException = OSError
        real_exists = os.path.exists
        self.patches = [patch.dict(sys.modules, {"serial": module}), patch("asyncio.sleep", quick_sleep),
                        patch("vesper.device.time", FastClock()),
                        patch("vesper.device.os.path.exists", lambda path: str(path).startswith("/dev/fake-") or real_exists(path))]
        for p in self.patches:
            p.start()
        self.temporary = tempfile.TemporaryDirectory()

    async def asyncTearDown(self):
        for node in FakeSerial.created:
            node.close()
        for p in reversed(self.patches):
            p.stop()
        self.temporary.cleanup()

    async def until(self, condition, timeout=3.0, message="condition"):
        deadline = time.monotonic() + timeout
        while not condition():
            if time.monotonic() > deadline:
                self.fail("timed out waiting for " + message)
            await REAL_SLEEP(.01)

    @contextlib.asynccontextmanager
    async def device(self):
        events = []

        async def emit(event):
            events.append(event)
        device = SerialDevice("/dev/fake-node", 921600, emit)
        device.events = events
        task = asyncio.create_task(device.run())
        try:
            yield device
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    @contextlib.asynccontextmanager
    async def console(self):
        console = Console(make_args(self.temporary.name, simulate=False, port="/dev/fake-node"))
        await console.start(None)
        try:
            yield console
        finally:
            await console.stop(None)


class FixedSerialLink(SerialCase):
    async def test_heartbeat_survives_one_failed_write(self):
        """BREAKS capture/lights until reconnect: heartbeat() has no error handling and its task is
        only collected when the link is torn down. One write timeout (write_timeout is 0.5 s)
        kills it silently while the read loop keeps seeing the node's own STATUS frames, so the
        link stays 'connected' with no PING traffic. The node's 3 s host watchdog (PROTOCOL.md)
        then stops capture and clears the lamps under a console that still says mic live."""
        async with self.device() as device:
            await self.until(lambda: device.connected, message="link up")
            node = FakeSerial.created[-1]
            await self.until(lambda: node.count(Kind.LEDS) >= 1, message="connect-time frames delivered")
            node.fail_next_write = True  # the next frame written is a heartbeat PING
            await REAL_SLEEP(.3)
            before = node.count(Kind.PING)
            await REAL_SLEEP(.6)
            sent = node.count(Kind.PING) - before
            self.assertTrue(device.connected, "link should still be up")
            self.assertGreaterEqual(sent, 5, f"only {sent} PINGs in 0.6 s after one failed write: heartbeat task is dead")

    async def test_sensor_storage_error_does_not_take_the_node_link_down(self):
        """BREAKS the node link while storage is unhealthy: Console.event() calls store.sensor()
        unguarded, device.packet() only catches ValueError/struct.error, so a sqlite error (disk
        full, locked) escapes into run(), which closes the port and reconnects. last_saved_sensor
        is not advanced on failure, so the next sensor frame (the node sends one every 5 s) does
        it again: the node link flaps, the microphone is shut off and every tab gets disconnect
        events. (This test sends frames every 50 ms to fit a unit test.)"""
        FakeSerial.sensor_samples = True

        def broken(temperature, humidity):
            raise sqlite3.OperationalError("database or disk is full")
        async with self.console() as console:
            console.store.sensor = broken
            await self.until(lambda: console.device.connected, message="link up")
            await REAL_SLEEP(1.0)
            self.assertEqual(len(FakeSerial.created), 1,
                             f"serial port was reopened {len(FakeSerial.created) - 1} times in 1 s")

    async def test_unplugged_node_is_announced_once_not_on_every_attempt(self):
        """WRONG: every failed open (every 2 s while the cable is out) emits another
        {"device", connected: false}. The browser treats each as a fresh link loss: it cancels
        input, invalidates the lamp cache and re-opens the system menu if an app is showing
        (web/main.js case "device"), so an app cannot be used while the node is unplugged."""
        FakeSerial.missing = True
        async with self.device() as device:
            await REAL_SLEEP(.7)  # about a dozen attempts at the shortened pause
        announcements = [e for e in device.events if e["type"] == "device"]
        self.assertLessEqual(len(announcements), 1, f"{len(announcements)} identical disconnect events")


    async def test_a_silent_preferred_port_does_not_block_a_working_alternative(self):
        """WRONG: every attempt takes the FIRST candidate that exists. If that device node is
        present but never speaks protocol v1 (native USB enumerated but wedged, a stale by-id link,
        a different program on it) the service re-opens it every six seconds for ever and never
        tries the second candidate it was given (the live unit passes both the native-USB and
        the COM path), so the console shows NODE LINK LOST while a working path exists."""
        FakeSerial.silent = {"/dev/fake-usb"}
        events = []

        async def emit(event):
            events.append(event)
        device = SerialDevice("/dev/fake-usb,/dev/fake-com", 921600, emit)
        task = asyncio.create_task(device.run())
        try:
            deadline = time.monotonic() + 4
            while not device.connected and time.monotonic() < deadline:
                await REAL_SLEEP(.02)
            tried = sorted({node.port for node in FakeSerial.created})
            self.assertTrue(device.connected, f"never connected; ports tried: {tried}")
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


class VerifiedSerialLink(SerialCase):
    async def test_reconnect_after_unplug_renegotiates_a_muted_session(self):
        async with self.device() as device:
            await self.until(lambda: device.connected, message="link up")
            first = FakeSerial.created[-1]
            generation = device.generation
            first.fail_read = True
            await self.until(lambda: not device.connected, message="disconnect noticed")
            await self.until(lambda: len(FakeSerial.created) == 2 and device.connected, message="reconnect")
            second = FakeSerial.created[-1]
            await self.until(lambda: second.count(Kind.LEDS) >= 1, message="lights-off frame")
            self.assertGreater(device.generation, generation)
            kinds = [p.kind for p in second.frames if p.kind != Kind.PING]
            self.assertEqual(kinds[:3], [Kind.MIC, Kind.CANCEL, Kind.LEDS])
            self.assertEqual(second.frames[[p.kind for p in second.frames].index(Kind.MIC)].payload, b"\x00")

    async def test_pending_command_fails_fast_when_the_link_drops(self):
        async with self.device() as device:
            await self.until(lambda: device.connected, message="link up")
            node = FakeSerial.created[-1]
            node.ack = False
            pending = asyncio.create_task(device.command(Kind.LEDS, bytes(9)))
            await REAL_SLEEP(.1)
            node.fail_read = True
            started = time.monotonic()
            with self.assertRaises(ConnectionError):
                await asyncio.wait_for(pending, 1.2)
            self.assertLess(time.monotonic() - started, 1.0)
            self.assertEqual(device.pending, {})

    async def test_node_reset_mid_session_turns_the_microphone_off(self):
        async with self.console() as console:
            async def set_mode(mode):
                console.speech.mode = mode
            console.speech.set_mode = set_mode
            await self.until(lambda: console.device.connected, message="link up")
            await console.set_mic("commands")
            self.assertEqual(console.mode, "commands")
            node = FakeSerial.created[-1]
            node.mic = False
            node.push(encode(Kind.HELLO, json.dumps({"fw": "fake", "mic": False, "button": False}).encode(), 0))
            await self.until(lambda: console.mode == "off", message="mic off after node reset")
            self.assertIsNone(console.session)

    async def test_failed_mute_closes_the_link_so_the_node_watchdog_takes_over(self):
        async with self.console() as console:
            async def set_mode(mode):
                console.speech.mode = mode
            console.speech.set_mode = set_mode
            await self.until(lambda: console.device.connected, message="link up")
            await console.set_mic("transcribe")
            node = FakeSerial.created[-1]
            node.ack = False
            with self.assertRaises(Exception):
                await console.set_mic("off")
            self.assertEqual(console.mode, "off")
            self.assertIsNone(console.session)
            self.assertFalse(node.is_open, "port should be closed after an unconfirmed mute")
            self.assertTrue(all(s["ended"] for s in console.store.sessions()))


class VerifiedService(ServiceCase):
    async def raw_get(self, path, host=None, extra=""):
        reader, writer = await asyncio.open_connection(self.client.server.host, self.client.server.port)
        host = host or f"{self.client.server.host}:{self.client.server.port}"
        writer.write(f"GET {path} HTTP/1.1\r\nHost: {host}\r\n{extra}Connection: close\r\n\r\n".encode())
        await writer.drain()
        data = await asyncio.wait_for(reader.read(-1), 3)
        writer.close()
        head, _, body = data.partition(b"\r\n\r\n")
        return int(head.split()[1]), body

    async def test_static_files_cannot_escape_the_web_directory(self):
        for path in ["/../vesper/server.py", "/%2e%2e/vesper/server.py", "/..%2fvesper%2fserver.py",
                     "/apps/../../vesper/server.py", "/%2e%2e%2f%2e%2e%2fetc/passwd", "/..\\vesper\\server.py",
                     "//etc/passwd", "/ws/../../vesper/storage.py"]:
            with self.subTest(path):
                status, body = await self.raw_get(path)
                self.assertNotEqual(status, 200)
                self.assertNotIn(b"class Console", body)
                self.assertNotIn(b"root:", body)

    async def test_host_and_origin_rules(self):
        status, _ = await self.raw_get("/api/state")
        self.assertEqual(status, 200)
        for host in ["evil.test", "localhost.evil.test", "127.0.0.1.evil.test", "0.0.0.0:8799", "localhost.:8799"]:
            with self.subTest(host=host):
                self.assertEqual((await self.raw_get("/api/state", host=host))[0], 403)
        local = f"127.0.0.1:{self.client.server.port}"
        for origin in ["null", "http://localhost:1", "https://evil.test", "http://127.0.0.1.evil.test"]:
            with self.subTest(origin=origin):
                self.assertEqual((await self.raw_get("/api/state", extra=f"Origin: {origin}\r\n"))[0], 403)
        self.assertEqual((await self.raw_get("/api/state", extra=f"Origin: http://{local}\r\n"))[0], 200)

    async def test_second_tab_cannot_command_or_inject_audio(self):
        first, snapshot = await self.connect()
        self.assertTrue(snapshot["controller"])
        second, snapshot = await self.connect()
        self.assertFalse(snapshot["controller"])
        for payload in ({"command": "leds", "values": [255] * 9}, {"command": "mic", "mode": "commands"},
                        {"command": "settings", "key": "sound", "value": False},
                        {"command": "score", "app": "orbit", "score": 5}, {"command": "button", "pressed": True}):
            self.assertFalse((await self.rpc(second, **payload))["ok"], payload)
        self.stub_speech()
        await self.rpc(first, "mic", mode="commands")
        await second.send_bytes(bytes(640))
        await asyncio.sleep(.2)
        self.assertEqual(self.console.speech.queue.qsize(), 0)
        self.assertEqual(self.console.device.leds, [0] * 9)
        self.assertEqual(self.console.store.scores(), {})
        await first.close()
        await second.close()

    async def test_microphone_starts_muted_and_a_failed_enable_leaves_it_off(self):
        self.assertEqual((self.console.mode, self.console.device.mic, self.console.speech.mode), ("off", False, "off"))
        ws, _ = await self.connect()
        reply = await self.rpc(ws, "mic", mode="transcribe")  # no model in the temporary directory
        self.assertFalse(reply["ok"])
        self.assertEqual((self.console.mode, self.console.device.mic, self.console.speech.mode), ("off", False, "off"))
        self.assertIsNone(self.console.session)
        self.assertEqual(self.console.store.sessions(), [])
        await ws.close()

    async def test_controller_disconnect_mutes_and_clears_lamps(self):
        self.stub_speech()
        ws, _ = await self.connect()
        self.assertTrue((await self.rpc(ws, "mic", mode="commands"))["ok"])
        self.assertTrue(self.console.device.mic)
        self.assertTrue((await self.rpc(ws, "leds", values=[9] * 9))["ok"])
        await ws.close()
        await self.until_cleared()
        self.assertFalse(self.console.device.mic)
        self.assertEqual(self.console.device.leds, [0] * 9)

    async def until_cleared(self):
        for _ in range(100):
            if self.console.controller is None and not self.console.device.mic and self.console.device.leds == [0] * 9:
                return
            await asyncio.sleep(.02)

    async def test_progress_limit_and_unknown_ids(self):
        ws, _ = await self.connect()
        fits = {"k": "x" * (8192 - len(json.dumps({"k": ""})))}
        self.assertEqual(len(json.dumps(fits)), 8192)
        self.assertTrue((await self.rpc(ws, "progress", app="morse", value=fits))["ok"])
        fat = {"k": "x" * (8193 - len(json.dumps({"k": ""})))}
        self.assertFalse((await self.rpc(ws, "progress", app="morse", value=fat))["ok"])
        for bad in ({"app": "nope", "value": {}}, {"app": ["morse"], "value": {}}, {"app": "morse", "value": [1]},
                    {"app": "morse"}, {"value": {}}):
            self.assertFalse((await self.rpc(ws, "progress", **bad))["ok"], bad)
        self.assertEqual(self.console.store.get("progress")["morse"], fits)
        for focus in ("nope", ["home"], 5, None):
            self.assertFalse((await self.rpc(ws, "focus", app=focus))["ok"], focus)
        await ws.close()

    async def test_wrongly_typed_fields_never_raise(self):
        ws, _ = await self.connect()
        payloads = [
            {"command": "leds"}, {"command": "leds", "values": "x" * 9}, {"command": "leds", "values": [True] * 9},
            {"command": "leds", "values": [1.0] * 9}, {"command": "leds", "values": [256] * 9},
            {"command": "pattern"}, {"command": "pattern", "steps": "abc"}, {"command": "pattern", "steps": [1]},
            {"command": "pattern", "steps": [{"ms": 100}]}, {"command": "pattern", "steps": [{"ms": 100, "values": 5}]},
            {"command": "pattern", "steps": [{"ms": 5, "values": [0] * 9}]},
            {"command": "pattern", "steps": [{"ms": 100, "values": [0] * 9}] * 17},
            {"command": "reaction"}, {"command": "reaction", "trial": "x", "delay": 500},
            {"command": "reaction", "trial": 1, "delay": 5}, {"command": "reaction", "trial": -1, "delay": 500},
            {"command": "timer", "op": "create", "seconds": "soon"}, {"command": "timer", "op": "create", "seconds": [5]},
            {"command": "timer", "op": "create", "seconds": 1e9}, {"command": "timer", "op": "toggle", "id": ["x"]},
            {"command": "timer", "op": {"a": 1}}, {"command": "timer"},
            {"command": "score", "app": "orbit", "score": "9"}, {"command": "score", "app": "orbit", "score": -1},
            {"command": "score", "app": "orbit", "score": 2e9}, {"command": "score", "app": "orbit", "metric": ["a"], "score": 1},
            {"command": "score", "app": "reaction", "score": 1}, {"command": "score", "app": ["orbit"], "score": 1},
            {"command": "settings", "key": ["sound"], "value": True}, {"command": "settings", "key": "sound", "value": 1},
            {"command": "settings", "key": "volume", "value": True}, {"command": "settings", "key": "gesturePace", "value": [1]},
            {"command": "settings", "key": "nope", "value": 1}, {"command": "settings"},
            {"command": "mic", "mode": ["off"]}, {"command": "mic"}, {"command": ["leds"]}, {"command": None},
            {"command": "focus", "app": {"a": 1}}, {"command": "progress", "app": "morse", "value": "text"},
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                reply = await self.reply_or_drop(ws, json.dumps({**payload, "requestId": 1}))
                self.assertIsInstance(reply, dict, f"connection dropped ({reply})")
                self.assertFalse(reply["ok"])
        self.assertEqual(self.console.store.scores(), {})
        self.assertEqual(self.console.device.leds, [0] * 9)
        await ws.close()

    async def test_settings_merge_with_new_defaults_after_upgrade(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            store.put("settings", {"volume": 0.9, "sound": False})  # written by an older version
            store.close()
            console = Console(make_args(directory))
            try:
                self.assertEqual(console.settings["volume"], 0.9)
                self.assertIn("tempUnit", console.settings)
                self.assertNotIn("menuClicks", console.settings)
            finally:
                console.store.close()


class FixedUpgradeAndStorage(unittest.TestCase):
    def test_stored_settings_are_trusted_without_validation(self):
        """ROUGH: settings read from the database after an upgrade are merged over the defaults
        but never passed through validate_setting(), so a value that the current code would
        reject (an older range, a hand edit, a renamed option) goes straight to every tab."""
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            store.put("settings", {"menuClicks": 2, "volume": "loud", "scanMs": 851})
            store.close()
            console = Console(make_args(directory))
            try:
                self.assertNotIn("menuClicks", console.settings)
                self.assertIsInstance(console.settings["volume"], (int, float))
                self.assertIn(console.settings["scanMs"], (600, 850, 1200, 1600))
            finally:
                console.store.close()


class FixedHttp(ServiceCase):
    async def test_static_files_are_revalidated_after_an_upgrade(self):
        """ROUGH: static responses carry ETag and Last-Modified but no Cache-Control, so the
        browser may apply heuristic freshness (10% of the file's age) and not even ask the service.
        Measured with headless Chromium and a persistent profile against the same aiohttp static
        handler (fleet/work/audit-service/stale-cache.txt): after the files changed, a new browser
        session served the OLD page and script and sent the service no request for them. The kiosk
        profile is persistent, so an upgrade can leave the UI one version behind its service."""
        for path in ("/", "/main.js", "/engine/bridge.js", "/apps/catalog.js", "/style.css"):
            with self.subTest(path):
                async with self.client.get(path) as response:
                    self.assertEqual(response.status, 200)
                    control = response.headers.get("Cache-Control", "")
                self.assertTrue(any(word in control for word in ("no-cache", "no-store", "max-age=0")),
                                f"Cache-Control is {control!r}")


class FixedKiosk(unittest.TestCase):
    def test_kiosk_launcher_does_not_give_up_when_the_service_is_slow(self):
        """ROUGH: scripts/kiosk.py polls /api/state for 30 s and then exits, so a slow start (SD
        card check after a power cut, a service restarting at login) leaves a blank desktop until
        the next login. The page reconnects by itself every 1.5 s (web/engine/bridge.js), so
        starting the browser anyway, or waiting longer, is safe."""
        launched = []

        class Launched(Exception):
            pass

        def refuse(*args, **kwargs):
            raise urllib.error.URLError("connection refused")

        def fake_exec(path, argv):
            launched.append(argv)
            raise Launched()
        with tempfile.TemporaryDirectory() as scratch, patch("tempfile.tempdir", scratch), \
             patch("shutil.which", return_value="/usr/bin/chromium"), \
             patch("urllib.request.urlopen", refuse), patch("time.sleep"), patch("os.execv", fake_exec):
            try:
                runpy.run_path(str(ROOT / "scripts/kiosk.py"))
            except Launched:
                pass
            except SystemExit as exit_:
                self.fail(f"kiosk launcher exited without starting the browser: {exit_}")
        self.assertEqual(len(launched), 1)


class ProcessCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        self.port = probe.getsockname()[1]
        probe.close()
        self.assertNotEqual(self.port, 8799)
        self.process = subprocess.Popen(
            [sys.executable, "-m", "vesper.server", "--simulate", "--http-port", str(self.port),
             "--data", self.temporary.name, "--model", self.temporary.name],
            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.session = aiohttp.ClientSession()
        for _ in range(100):
            try:
                async with self.session.get(f"http://127.0.0.1:{self.port}/api/state") as response:
                    if response.status == 200:
                        return
            except aiohttp.ClientError:
                await asyncio.sleep(.1)
        self.fail("server did not start")

    async def asyncTearDown(self):
        await self.session.close()
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait()
        self.temporary.cleanup()


class FixedProcess(ProcessCase):
    async def test_service_restart_with_a_tab_connected_is_prompt(self):
        """WRONG: nothing closes open WebSockets on shutdown. After SIGTERM aiohttp waits for the
        idle /ws handler (about 25 s measured here, up to its 60 s shutdown_timeout) before
        on_cleanup runs, so every `systemctl --user restart vesper` (including the installer's)
        stalls while the kiosk tab is connected, and the microphone stays on until then."""
        ws = await self.session.ws_connect(f"http://127.0.0.1:{self.port}/ws")
        await ws.receive_json()
        started = time.monotonic()
        self.process.send_signal(signal.SIGTERM)
        try:
            await asyncio.to_thread(self.process.wait, 8)
        except subprocess.TimeoutExpired:
            self.fail("service still running 8 s after SIGTERM with one tab connected")
        self.assertLess(time.monotonic() - started, 8)


class VerifiedProcess(ProcessCase):
    async def test_http_port_is_bound_to_loopback_only(self):
        """VERIFIED: the listener answers on 127.0.0.1 and refuses the machine's LAN address."""
        async with self.session.get(f"http://127.0.0.1:{self.port}/api/state") as response:
            self.assertEqual(response.status, 200)
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            udp.connect(("192.0.2.1", 9))  # chooses a source address; sends nothing
            lan = udp.getsockname()[0]
        except OSError:
            self.skipTest("no non-loopback address on this machine")
        finally:
            udp.close()
        if lan.startswith("127."):
            self.skipTest("no non-loopback address on this machine")
        with self.assertRaises(OSError):
            socket.create_connection((lan, self.port), timeout=2).close()


class FixedInstaller(unittest.TestCase):
    def test_reinstall_without_data_keeps_the_existing_data_directory(self):
        """ROUGH: the unit is regenerated from the current arguments only. Re-running the
        installer (to add --kiosk, say) without repeating --data silently points the service at
        the checkout's empty data/console, so scores, timers and notes appear to be gone (the old
        unit is only in backups/)."""
        spec = importlib.util.spec_from_file_location("install_service_audit", ROOT / "scripts/install-service.py")
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root, home, data = base / "checkout", base / "home", base / "existing-data"
            (root / ".venv/bin").mkdir(parents=True)
            (root / ".venv/bin/python").touch()
            data.mkdir()
            unit = home / ".config/systemd/user/vesper.service"

            def install(*argv):
                with patch.object(installer, "__file__", str(root / "scripts/install-service.py")), \
                     patch.object(Path, "home", return_value=home), \
                     patch.object(installer.shutil, "which", return_value="/usr/bin/chromium"), \
                     patch.object(installer.subprocess, "run"), \
                     patch("sys.argv", ["install-service.py", *argv]), \
                     contextlib.redirect_stdout(io.StringIO()):
                    installer.main()
            install("--port", "/dev/test-node", "--data", str(data))
            self.assertIn(str(data), unit.read_text())
            install("--port", "/dev/test-node", "--kiosk")
            self.assertIn(str(data), unit.read_text(), "second install dropped the data directory")


if __name__ == "__main__":
    unittest.main()
