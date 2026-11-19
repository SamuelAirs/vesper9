#!/usr/bin/env python3
"""Make the file that brings the console's saves to the iPhone app.

    python3 ios/console-saves.py <the console's vesper.sqlite3> [console-saves.json]

Reads the Pi service's database, without changing it, and writes the best scores and every
game's progress in the shape the app takes in (ios/layer/app.js): the same two maps the service
gives the console's own page. Settings, tap calibration, timers, notes and sensor history stay
behind: they belong to the console and its node.

On the phone: Files > On My iPhone > VESPER-9, put console-saves.json there, open VESPER-9.
The file holds a person's own progress. Keep it out of git.
"""
import datetime
import json
import sqlite3
import sys
from pathlib import Path


def read(database):
    database = Path(database).resolve()
    if not database.is_file():
        raise SystemExit(f"No such file: {database}")
    db = sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)
    try:
        scores = {app: score for app, score in db.execute("SELECT app, score FROM scores")}
        newest = db.execute("SELECT MAX(at) FROM scores").fetchone()[0]
        row = db.execute("SELECT value FROM settings WHERE key='progress'").fetchone()
    finally:
        db.close()
    progress = json.loads(row[0]) if row else {}
    if not isinstance(progress, dict):
        raise SystemExit("The console's progress is not in the shape this expects")
    return {
        "vesper9": "console-saves",
        "version": 1,
        "lastBest": datetime.datetime.fromtimestamp(newest, datetime.timezone.utc).isoformat(timespec="seconds") if newest else None,
        "scores": scores,
        "progress": progress,
    }


def main(arguments):
    if not 1 <= len(arguments) <= 2:
        raise SystemExit(__doc__)
    saves = read(arguments[0])
    destination = Path(arguments[1] if len(arguments) == 2 else "console-saves.json")
    destination.write_text(json.dumps(saves, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"{destination}: {len(saves['scores'])} best scores, {len(saves['progress'])} games' progress, last best {saves['lastBest']}")


if __name__ == "__main__":
    main(sys.argv[1:])
