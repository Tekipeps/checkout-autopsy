# Production-shaped integration support

Checkout Autopsy now has two explicit execution profiles. The original Python/SQLite lab remains available. The broader profile executes JavaScript ESM modules against real HTTP and PostgreSQL inside CreateOS.

This is a compatibility and failure-recovery test harness. A passing report establishes its named cases and runtime versions. It does not establish arbitrary repository compatibility, certification, or successful operation under real production traffic.

## Node/Express/PostgreSQL profile

The isolated runtime pins Node 24, Express 5.3.0, the official Stripe Node SDK 23.0.0, pg 8.23.1 and native PostgreSQL 18.4. PostgreSQL is a real server, launched through `embedded-postgres`; it is not a mocked database or a WASM substitute. The exact observed versions appear in every report.

The candidate exports:

```js
export function createApp({ pool, signingSecret, expectedLivemode = false }) { /* Express app */ }
export async function dispatchOne({ pool, deliver }) { /* at most one outbox job */ }
```

It can import `express`, `stripe`, and `node:crypto`, uses the provided pg-compatible pool and fixed schema, and handles `POST /webhook`. No generated handler runs on the host. The complete contract is in [production-contract.ts](../server/production-contract.ts); the schema is [schema.sql](../sandbox/production/schema.sql).

Only one-time, `mode: payment` Checkout snapshots are in scope. Fulfillment is required for paid sessions and zero-total `no_payment_required` sessions. Unpaid events, payment-failure notifications, unrelated events, subscription sessions and setup sessions remain inert in this profile. This differs deliberately from the narrower paid-only Python lab.

## What the checks exercise

| Boundary | Evidence collected |
| --- | --- |
| Webhook authenticity | Raw HTTP body verified by the official Stripe SDK; missing, forged, stale and altered signatures rejected |
| Input limits | Signed malformed JSON, invalid checkout values, environment mismatch and oversized bodies rejected without writes |
| Checkout behavior | Delayed settlement, reordered notifications, repeated event IDs and distinct events for one checkout |
| Zero-total orders | A payment-mode `no_payment_required` checkout creates one durable order/outbox record and one fulfillment effect |
| Durable identity | Full account/session identity, independent orders, exact amounts and currencies |
| Concurrency | Sixteen simultaneous HTTP deliveries; database primary/unique constraints and transactions |
| Service restart | Genuine SIGKILL and replacement process, retaining PostgreSQL state |
| Atomic commit | SIGKILL immediately after an order write; an uncommitted transaction leaves neither order nor outbox record |
| Lost acknowledgment | SIGKILL after PostgreSQL confirms commit, before HTTP acknowledgment; both records survive and retry deduplicates |
| Downstream failure | An actual HTTP 503 from a test fulfillment recipient leaves durable pending work |
| Worker crash | SIGKILL after the recipient accepts fulfillment, before delivery is marked; retry uses stable recipient idempotency |
| Worker concurrency | Four separate worker processes compete for durable pending work |

The observer reads PostgreSQL directly after every action. A separate host-side oracle derives expected orders, outbox state and external effects from the input plan. A successful HTTP status alone cannot pass a case. Missing, duplicate, incomplete or substituted evidence is rejected.

There are **22 repair checks**. After a patch passes, its SHA-256 freezes and **23 audit checks** are generated with a fresh seed, changed identifiers/prices/currencies, shuffled case order and an additional mixed concurrent/reordered zero-total scenario. Audit inputs and results never go back to the model. A failed audit withholds verification and cannot trigger another model attempt in that campaign.

## Corpus and repair process

The default corpus consists of three explicitly authored fault mutations of a working integration:

1. Bypass signature verification.
2. Commit the order and outbox separately.
3. Generate a new downstream idempotency key for each dispatch.

These are mutation controls that measure whether the harness detects concrete failures and whether the agent repairs them. They are **not three independent production repositories**. An authored reference must pass all repair checks before any AI evidence is evaluated. Reference control results are labeled and do not count as AI generation.

The first development run used full-module rewrites and exposed invalid Stripe SDK calls. Its failed attempts were retained. The final repair mechanism requests minimal exact source edits, rejects missing/ambiguous edit anchors, preserves unrelated source, and rejects regressive candidates. Reports retain original/candidate hashes, actual responding models, tokens, exact edits, full HTTP/process/database observations and audit seeds. No reference patch is substituted for an unsuccessful AI repair.

## Recorded result — October 17, 2026

Observed runtime: **Node v24.21.0, Express 5.3.0, Stripe SDK 23.0.0, PostgreSQL 18.4, pg 8.23.1**. The authored reference control passed **22/22**. Cohere North Mini Code generated one targeted repair for each mutation.

| Authored fault mutation | Original repair checks | AI repair | Original fresh audit | Frozen patch audit |
| --- | --- | --- | --- | --- |
| Signature verification bypass | 18/22 | 22/22 | 19/23 | 23/23 |
| Split order/outbox commit | 21/22 | 22/22 | 22/23 | 23/23 |
| Unstable fulfillment key | 21/22 | 22/22 | 22/23 | 23/23 |

Combined: **66/66 repair checks and 69/69 frozen-audit checks**. All three patches were generated by the real configured model. The first and third repairs restore the same reference behavior, so their source hashes coincide; these remain fault mutations of one integration, not independent applications.

A transient upload interrupted the second audit. Its exact inputs and seed were recovered and reused, with the candidate unchanged and no additional model call. The completed first audit was retained. Safe fixed-path transfers now retry, and development-session checkpoints preserve frozen audit plans. The final CreateOS sandbox destruction was confirmed at 21:43 UTC. No compute remained running.

[Shareable, independently rechecked summary](evidence/node-postgres.json). The summary command re-derives every reported result, reconstructs patches from exact edits, and verifies source hashes, seeds and frozen bindings without executing candidate code. Full local observations are retained in `artifacts/production-latest.json`; failed full-rewrite development evidence is `artifacts/production-whole-module-rewrite-failed.json`. Neither dataset is an external benchmark or a live customer deployment.

## Reproduce or import your own module

```bash
npm install
npm ci --prefix sandbox/production --ignore-scripts
npm run validate:production                   # default three-mutation corpus
npm run validate:production -- /path/app.mjs  # one imported module
npm run evidence:production                 # recheck saved evidence; no cloud/model calls
```

The Linux/x64 runtime is packaged from the pinned nested lockfile and uploaded into one private CreateOS VM. Missing native dependencies are rejected before creating a VM. It needs no package-registry access in the VM. Native symlinks are restored inside the VM. Egress remains restricted and ingress private. Signing material and PostgreSQL credentials are generated solely for this disposable test environment. Stripe account credentials and model credentials never enter it. No charges are collected and no customer data is needed.

In the app, open **Production support** to inspect saved evidence, download a report/repair, or import a supported module. The HTTP API shares the single-job limit with the Python lab, rejects cross-origin browser requests and bounds custom modules to 30,000 characters. Each campaign creates one VM; watch the account's creation quota.

Reports are written to ignored `artifacts/production-latest.json` and `artifacts/production-<id>.json`. Partial development results use `production-progress.json` and must not be presented as a completed campaign. Cleanup waits for the sandbox's destroyed state. A report with unconfirmed cleanup displays that condition explicitly.

## What remains unproven

- Webhooks delivered by Stripe infrastructure: requests here are locally generated, signed using the official SDK test helper, and sent over real local HTTP.
- Compatibility with arbitrary Express/Next.js/FastAPI applications, ORMs, repository layouts or dependencies beyond the supported module contract.
- Thin events, live Stripe API retrieval, subscriptions, refunds, disputes, tax and non-Checkout payment flows.
- Real customer deployment, multiple application hosts, database outages/failover, storage/power failure, production rate limits or sustained load.
- Physical fulfillment exactly once. The HTTP test recipient honors idempotency; a real recipient must provide an equivalent contract.
- Adversarial grading security. The VM isolates the host, but candidate code can access its VM filesystem.

## Primary sources

- [Stripe webhook signatures, ordering and retries](https://docs.stripe.com/webhooks)
- [Stripe Checkout fulfillment, including concurrent calls and payment status](https://docs.stripe.com/checkout/fulfillment)
- [node-postgres transaction boundaries](https://node-postgres.com/features/transactions)
- [PostgreSQL locking and SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html)
- [Embedded PostgreSQL package and native binary provenance](https://github.com/leinelissen/embedded-postgres)
- [CreateOS VM images, isolation and egress](https://createos.sh/docs/Sandbox/Limits/)
