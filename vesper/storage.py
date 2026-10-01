"""Small, local SQLite store. No audio is persisted."""
import json
import math
import sqlite3
import time
import uuid
from pathlib import Path


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.directory / "vesper.sqlite3")
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS scores(app TEXT PRIMARY KEY, score REAL NOT NULL, at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, started REAL, ended REAL);
        CREATE TABLE IF NOT EXISTS lines(id INTEGER PRIMARY KEY, session TEXT, at REAL, text TEXT);
        CREATE TABLE IF NOT EXISTS sensors(at REAL PRIMARY KEY, temperature REAL, humidity REAL);
        """)

    def get(self, key, default=None):
        row = self.db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, key, value):
        self.db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, json.dumps(value)))
        self.db.commit()

    def score(self, app, score):
        if not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1e9:
            raise ValueError("invalid score")
        self.db.execute("""INSERT INTO scores VALUES (?,?,?) ON CONFLICT(app) DO UPDATE SET
            score=MAX(score,excluded.score), at=CASE WHEN excluded.score>score THEN excluded.at ELSE at END""",
                        (app, score, time.time()))
        self.db.commit()

    def scores(self):
        return {r["app"]: r["score"] for r in self.db.execute("SELECT * FROM scores")}

    def start_session(self):
        sid = uuid.uuid4().hex
        self.db.execute("INSERT INTO sessions VALUES (?,?,NULL)", (sid, time.time()))
        self.db.commit()
        return sid

    def end_session(self, sid):
        self.db.execute("UPDATE sessions SET ended=? WHERE id=?", (time.time(), sid))
        self.db.commit()

    def line(self, sid, text):
        if text.strip():
            self.db.execute("INSERT INTO lines(session,at,text) VALUES (?,?,?)", (sid, time.time(), text.strip()))
            self.db.commit()

    def sessions(self, offset=0):
        return [dict(r) for r in self.db.execute("""SELECT s.*,COUNT(l.id) AS lines FROM sessions s
            LEFT JOIN lines l ON l.session=s.id GROUP BY s.id ORDER BY started DESC, s.id DESC LIMIT 50 OFFSET ?""", (offset,))]

    def transcript(self, sid):
        return [dict(r) for r in self.db.execute("SELECT at,text FROM lines WHERE session=? ORDER BY id", (sid,))]

    def sensor(self, temperature, humidity):
        if not (math.isfinite(temperature) and math.isfinite(humidity)):
            return
        self.db.execute("INSERT OR REPLACE INTO sensors VALUES (?,?,?)", (time.time(), temperature, humidity))
        self.db.execute("DELETE FROM sensors WHERE at<?", (time.time() - 30 * 86400,))
        self.db.commit()

    def history(self):
        return [dict(r) for r in self.db.execute("""SELECT AVG(at) AS at,AVG(temperature) AS temperature,
           AVG(humidity) AS humidity FROM sensors WHERE at>? GROUP BY CAST(at/300 AS INTEGER)
           ORDER BY at""", (time.time() - 86400,))]

    def close(self):
        self.db.close()
