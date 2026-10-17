import express from 'express';
import Stripe from 'stripe';

export function createApp({ pool, signingSecret, expectedLivemode = false }) {
  const app = express();
  app.disable('x-powered-by');
  app.post('/webhook', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    let event;
    try {
      event = Stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], signingSecret);
    } catch { return res.status(400).send('Invalid signature or payload'); }
    if (event.livemode !== expectedLivemode) return res.status(400).send('Wrong environment');
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return res.sendStatus(200);
    const session = event.data?.object;
    if (session?.mode !== 'payment') return res.sendStatus(200);
    if (!session || typeof session.id !== 'string' || !session.id || !Number.isSafeInteger(session.amount_total) || session.amount_total < 0 || !/^[a-z]{3}$/.test(session.currency)) return res.status(400).send('Invalid checkout');
    if (!['paid', 'unpaid', 'no_payment_required'].includes(session.payment_status) || (session.payment_status === 'no_payment_required' && session.amount_total !== 0)) return res.status(400).send('Invalid payment status');
    if (session.payment_status === 'unpaid') return res.sendStatus(200);
    const accountId = event.account ?? 'platform';
    const payload = { accountId, sessionId: session.id, amount: session.amount_total, currency: session.currency };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query('INSERT INTO orders(account_id,session_id,amount,currency) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,session_id) DO NOTHING RETURNING session_id', [accountId, session.id, session.amount_total, session.currency]);
      if (inserted.rowCount) await client.query('INSERT INTO outbox(id,account_id,session_id,amount,currency,payload) VALUES($1,$2,$3,$4,$5,$6)', [JSON.stringify([accountId, session.id]), accountId, session.id, session.amount_total, session.currency, JSON.stringify(payload)]);
      await client.query('COMMIT');
      return res.sendStatus(200);
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      return res.sendStatus(500);
    } finally { client.release(); }
  });
  app.use((error, _req, res, _next) => res.sendStatus(error.type === 'entity.too.large' ? 413 : 400));
  return app;
}

export async function dispatchOne({ pool, deliver }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query("SELECT id,payload FROM outbox WHERE status='pending' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1");
    if (!result.rowCount) { await client.query('COMMIT'); return 0; }
    const row = result.rows[0];
    await deliver(row.payload, row.id);
    await client.query("UPDATE outbox SET status='delivered' WHERE id=$1", [row.id]);
    await client.query('COMMIT');
    return 1;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
