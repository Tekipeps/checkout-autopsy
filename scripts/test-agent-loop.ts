/** Integration check: real CreateOS execution, a local mock model, no AI claim. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { investigate } from '../server/investigate';
import { readAsset } from '../server/executor';

const reference = await readAsset('fixtures/reference_patch.py');
const eventOnly = `def handle(event, db):
    if event.get("type") not in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        return "ignored"
    checkout = event["data"]["object"]
    if checkout.get("payment_status") != "paid":
        return "awaiting_payment"
    with db:
        cursor = db.execute("INSERT OR IGNORE INTO processed_events (event_id) VALUES (?)", (event["id"],))
        if cursor.rowcount == 0:
            return "duplicate"
        db.execute("INSERT INTO shipments (session_id, amount, currency) VALUES (?, ?, ?)", (checkout["id"], checkout["amount_total"], checkout["currency"]))
    return "fulfilled"
`;
const requests: string[] = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += String(chunk);
  requests.push(body);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: `\`\`\`python\n${requests.length === 1 ? eventOnly : reference}\`\`\`` } }] }));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
process.env.MODEL_BASE_URL = `http://127.0.0.1:${address.port}`;
process.env.MODEL_API_KEY = 'local-integration-fixture';
process.env.MODEL_NAME = 'integration-test-fixture-not-live-ai';
try {
  const result = await investigate({ incidentId: 'duplicate', mode: 'agent' }, e => console.log(`${e.type}: ${e.message}`), AbortSignal.timeout(180_000));
  assert.equal(requests.length, 2, 'repair loop must use failing holdout evidence to retry');
  assert(!requests[0].includes('cs_holdout_'), 'initial prompt must not include holdout inputs');
  assert(requests[1].includes('hidden-semantic'), 'retry prompt must include actual failure feedback');
  assert(result.attempts[0].checks.some(c => c.hidden && !c.passed));
  assert.equal(result.repaired.passed, 12);
  assert.equal(result.audit?.candidate.passed, 12);
  assert.equal(result.audit?.feedbackToModel, false);
  assert(!requests.some(body => body.includes('cs_audit_')), 'final audit inputs must never enter model requests');
  assert.equal(result.cleanup, true);
  console.log('PASS: two mock model requests, evidence-driven retry, 12/12 repair checks and 12/12 frozen audit checks, confirmed cleanup. No live AI claim.');
} finally { server.close(); server.closeAllConnections(); }
