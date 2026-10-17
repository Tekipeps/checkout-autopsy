"""Trusted replay driver. Candidate handlers run in separate processes.

The parent observes committed SQLite state after every delivery batch. Expected
results are checked by TypeScript on the server, outside this sandbox.
"""
import concurrent.futures
import json
import os
import sqlite3
import subprocess
import sys
import tempfile

SCHEMA = """
CREATE TABLE shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL
);
CREATE TABLE processed_events (event_id TEXT PRIMARY KEY);
"""

def invoke(handler, database, path, race):
    try:
        result = subprocess.run(
            [sys.executable, "-I", "/tmp/autopsy/worker.py", handler, database, path, "race" if race else "normal"],
            capture_output=True, text=True, timeout=8,
            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"},
        )
        return result.returncode, result.stdout[-4000:], result.stderr[-4000:]
    except subprocess.TimeoutExpired:
        return 124, "", "Handler exceeded its 8 second deadline."

def replay(handler, trial):
    with tempfile.TemporaryDirectory(prefix="autopsy-") as workspace:
        database = os.path.join(workspace, "store.sqlite")
        with sqlite3.connect(database) as db:
            db.executescript(SCHEMA)
        steps = []
        for batch_index, batch in enumerate(trial["batches"]):
            paths = []
            for index, event in enumerate(batch):
                path = os.path.join(workspace, f"event-{batch_index}-{index}.json")
                with open(path, "w") as target:
                    json.dump(event, target)
                paths.append(path)
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda p: invoke(handler, database, p, len(batch) > 1), paths))
            with sqlite3.connect(database) as db:
                rows = db.execute("SELECT session_id, amount, currency FROM shipments ORDER BY id").fetchall()
            steps.append({
                "eventIds": [e["id"] for e in batch],
                "exitCodes": [r[0] for r in results],
                "stdout": [r[1] for r in results],
                "stderr": [r[2] for r in results],
                "shipments": [{"sessionId": r[0], "amount": r[1], "currency": r[2]} for r in rows],
            })
        return {"id": trial["id"], "steps": steps}

if __name__ == "__main__":
    with open(sys.argv[2]) as source:
        trials = json.load(source)
    print(json.dumps([replay(sys.argv[1], trial) for trial in trials]))
