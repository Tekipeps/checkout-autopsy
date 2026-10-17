def handle(event, db):
    if event["type"] not in (
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
    ):
        return "ignored"

    checkout = event["data"]["object"]
    if checkout["payment_status"] != "paid":
        return "pending"

    receipt = "fulfillment:" + checkout["id"][-6:]
    with db:
        saved = db.execute(
            "INSERT OR IGNORE INTO processed_events(event_id) VALUES (?)",
            (receipt,),
        )
        if saved.rowcount == 0:
            return "already_fulfilled"
        db.execute(
            "INSERT INTO shipments(session_id, amount, currency) VALUES (?, ?, ?)",
            (checkout["id"], checkout["amount_total"], "usd"),
        )
    return "fulfilled"
