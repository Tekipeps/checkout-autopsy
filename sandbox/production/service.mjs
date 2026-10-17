// Trusted process boundary. Candidate source is imported only inside CreateOS.
import pg from 'pg';

process.once('message', async config => {
  const actualPool = new pg.Pool({ ...config.database, max: 8, connectionTimeoutMillis: 3000, statement_timeout: 3500, idle_in_transaction_session_timeout: 3500 });
  const kill = () => process.kill(process.pid, 'SIGKILL');
  const wrap = (query, state) => async (text, values) => {
    const sql = String(typeof text === 'string' ? text : text.text).replaceAll('"', '').trim().toLowerCase();
    if (/^begin\b/.test(sql)) state.transaction = true;
    const result = await query(text, values);
    const orderWrite = /insert\s+into\s+(?:public\.)?orders\b/.test(sql) && result.rowCount > 0;
    const outboxWrite = /insert\s+into\s+(?:public\.)?outbox\b/.test(sql) && result.rowCount > 0;
    if (orderWrite) state.dirty = true;
    if (config.fault === 'after-order' && orderWrite) kill();
    if (config.fault === 'after-commit' && ((/^commit\b/.test(sql) && state.dirty) || (outboxWrite && !state.transaction))) kill();
    if (/^(commit|rollback)\b/.test(sql)) { state.transaction = false; state.dirty = false; }
    return result;
  };
  const pool = {
    query: wrap((...args) => actualPool.query(...args), { transaction: false, dirty: false }),
    async connect() {
      const client = await actualPool.connect();
      return { query: wrap((...args) => client.query(...args), { transaction: false, dirty: false }), release: () => client.release() };
    },
  };
  try {
    const candidate = await import(config.module);
    if (config.mode === 'worker') {
      await candidate.dispatchOne({ pool, deliver: async (payload, idempotencyKey) => {
        const response = await fetch(config.sink, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': String(idempotencyKey ?? '') }, body: JSON.stringify(payload), signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error(`Fulfillment HTTP ${response.status}`);
        if (config.crashAfterDelivery) kill();
      } });
      await actualPool.end();
      process.send?.({ done: true });
      process.exit(0);
    } else {
      const app = candidate.createApp({ pool, signingSecret: config.signingSecret, expectedLivemode: false });
      const server = app.listen(0, '127.0.0.1', () => process.send?.({ ready: true, port: server.address().port }));
      server.requestTimeout = 5000;
    }
  } catch (error) {
    process.send?.({ error: String(error?.message ?? error).slice(0, 700) });
    await actualPool.end().catch(() => {});
    process.exit(1);
  }
});
