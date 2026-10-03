"""One-off migrations of the saved console data (vesper/storage.py, Store.migrate)."""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vesper.storage import Store  # noqa: E402


def old_database(directory, rows):
    """A database as the previous release wrote it: the scores table, no migrations recorded."""
    db = sqlite3.connect(Path(directory) / "vesper.sqlite3")
    db.execute("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    db.execute("CREATE TABLE scores(app TEXT PRIMARY KEY, score REAL NOT NULL, at REAL NOT NULL)")
    db.executemany("INSERT INTO scores VALUES (?,?,?)", rows)
    db.commit()
    db.close()


class BallistaMetres(unittest.TestCase):
    def test_the_old_artillery_best_is_kept_under_its_own_name_and_the_launcher_starts_fresh(self):
        with tempfile.TemporaryDirectory() as directory:
            old_database(directory, [("ballista", 4820, 1.0), ("perihelion", 77, 2.0)])
            store = Store(directory)
            self.assertEqual(store.scores(), {"ballista:artillery": 4820, "perihelion": 77})
            store.score("ballista", 312)  # a launcher distance, in metres
            self.assertEqual(store.scores()["ballista"], 312)
            self.assertEqual(store.scores()["ballista:artillery"], 4820)
            store.close()

    def test_it_runs_once_so_later_distances_are_never_moved(self):
        with tempfile.TemporaryDirectory() as directory:
            old_database(directory, [("ballista", 4820, 1.0)])
            Store(directory).close()
            store = Store(directory)
            store.score("ballista", 312)
            store.close()
            store = Store(directory)  # a restart
            self.assertEqual(store.scores(), {"ballista:artillery": 4820, "ballista": 312})
            self.assertIn("ballista_metres_v2", store.get("migrations"))
            store.close()

    def test_a_new_console_and_one_without_a_ballista_score_are_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.assertEqual(store.scores(), {})
            self.assertEqual(store.get("migrations"), ["ballista_metres_v2"])
            store.close()
        with tempfile.TemporaryDirectory() as directory:
            old_database(directory, [("orbit", 12, 1.0)])
            store = Store(directory)
            self.assertEqual(store.scores(), {"orbit": 12})
            store.close()


if __name__ == "__main__":
    unittest.main()
