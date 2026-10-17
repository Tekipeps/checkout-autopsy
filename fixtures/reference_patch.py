"""Reference repair for guided mode. Live AI mode never receives this file."""

def handle(event, db):
    if event.get("type") not in (
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
    ):
        return "ignored"
    checkout = event["data"]["object"]
    if checkout.get("payment_status") != "paid":
        return "awaiting_payment"

    with db:
        # This write acquires SQLite's transaction lock BEFORE the read.
        # Durable state survives process restarts and serializes concurrent calls.
        db.execute(
            "INSERT OR IGNORE INTO processed_events (event_id) VALUES (?)",
            (event["id"],),
        )
        if db.execute(
            "SELECT 1 FROM shipments WHERE session_id = ?", (checkout["id"],)
        ).fetchone():
            return "duplicate"
        db.execute(
            "INSERT INTO shipments (session_id, amount, currency) VALUES (?, ?, ?)",
            (checkout["id"], checkout["amount_total"], checkout["currency"]),
        )
    return "fulfilled"
