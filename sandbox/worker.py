"""Trusted invocation boundary; executed only inside CreateOS."""
import importlib.util
import json
import resource
import sqlite3
import sys
import time

class ReplayConnection(sqlite3.Connection):
    def execute(self, sql, parameters=()):
        cursor = super().execute(sql, parameters)
        # Controlled read latency makes check-then-write races observable even
        # on a single-vCPU VM. An already-held write transaction remains safe.
        if len(sys.argv) > 4 and sys.argv[4] == "race" and sql.lstrip().lower().startswith("select") and "shipments" in sql.lower():
            time.sleep(0.06)
        return cursor

if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    spec = importlib.util.spec_from_file_location("candidate", sys.argv[1])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with open(sys.argv[3]) as source:
        event = json.load(source)
    db = sqlite3.connect(sys.argv[2], timeout=5, factory=ReplayConnection)
    try:
        decision = module.handle(event, db)
        print(json.dumps({"decision": str(decision), "status_code": 200}))
    finally:
        db.close()
