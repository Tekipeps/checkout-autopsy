"""Intentionally faulty synthetic-store fixture, not a production webhook."""

def handle(event, db):
    if event["type"] == "checkout.session.completed":
        checkout = event["data"]["object"]
        with db:
            db.execute(
                "INSERT INTO shipments (session_id, amount, currency) VALUES (?, ?, ?)",
                (checkout["id"], checkout["amount_total"], checkout["currency"]),
            )
        return "fulfilled"
    return "ignored"
