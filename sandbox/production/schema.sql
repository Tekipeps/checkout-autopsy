CREATE TABLE orders (
  account_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL,
  PRIMARY KEY (account_id, session_id)
);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered')),
  UNIQUE (account_id, session_id),
  FOREIGN KEY (account_id, session_id) REFERENCES orders(account_id, session_id)
);
CREATE TABLE processed_events (
  account_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (account_id, event_id)
);
