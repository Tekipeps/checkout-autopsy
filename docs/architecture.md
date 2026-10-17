# Execution and evidence

There are two bounded profiles: the original Python/SQLite lab described below, and the [Node/Express/Stripe SDK/PostgreSQL integration profile](production-support.md). They share CreateOS isolation, host-side verification, patch provenance and independent post-freeze audits, with different handler and business contracts.

The browser submits an incident, bounded replay sequence, and Python handler to the local Express server. The server creates a disposable CreateOS micro-VM and uploads a driver, invocation wrapper, candidate, and fixtures. Candidate code never executes on the host.

The driver creates a clean SQLite database per trial. Every event invokes the candidate in a fresh subprocess; the concurrency case starts four invocations against the same database. The concurrent batch injects 60ms of SELECT latency to expose check-then-write races on a single-vCPU machine. After each batch, the parent reads committed rows. The server's TypeScript checker independently derives expected paid sessions and compares every snapshot, including amounts and currencies. Successful exits cannot compensate for duplicate or premature fulfillment.

Live mode gives the model the contract, original source, visible-case failures, and observations. The model returns Python. The server records its hash, executes it in CreateOS, validates the results, and feeds failures back for up to three attempts. Holdouts are absent from the initial model prompt; subsequent attempts see failing holdout evidence, as disclosed in the report.

Each failing check now includes the first divergent step, delivered batch, expected rows, observed rows and exit codes. Initial feedback includes the visible input cases as well as snapshots. The contract states actual schema uniqueness and SQLite transaction-control semantics explicitly, so the model need not guess the runtime. These facts do not expose holdout inputs or provide a reference patch.

Once the repair suite passes, generation stops and the patch hash freezes. Only then is an independent audit seed drawn and twelve additional cases generated. They vary identifiers, prices, currencies, event permutations, concurrent batches and negative cases. Both original and frozen candidate execute against them; the same server oracle validates every committed snapshot. Audit results are recorded separately and **never supplied as model feedback**. A failure cannot trigger another attempt in that run and prevents a verified result. Unit tests enforce this ordering, hash binding and failure behavior. If the repair suite fails, the audit is skipped and verification remains withheld.

The `custom` API input requires both Python source and a nonempty sequence. The same validation schema drives the custom input form and API, caps inputs at twelve deliveries, and rejects contradictory amounts/currencies for a checkout. Each fixture remains synthetic and within the same narrow contract; this is not arbitrary repository ingestion.

Guided mode reads a reference patch instead of calling a model. Its evidence still comes from real sandbox execution. UI and reports identify the mode.

## Boundaries

- Credentials never enter sandbox environment variables or client bundles.
- The API binds to loopback, checks browser origins, bounds requests, serializes jobs, and enforces a five-minute budget.
- The VM has private ingress and a nonempty restricted egress list. Empty CreateOS egress would permit all outbound traffic.
- Candidate processes have CPU, memory, file-size, open-file, and wall-clock limits.
- Cleanup runs after completion, errors, and client disconnects, without using the cancelled work signal for destruction.
- Creation timeouts can be ambiguous at the provider boundary. Check CreateOS's sandbox list after network failure. Idle auto-pause is a backstop, not cleanup.
- The sandbox isolates the host. A malicious candidate has access to its VM filesystem, so this is not an adversarially secure grading environment.
- This lab does not test real Stripe signatures, external fulfillment, payment collection, or production transaction semantics.

## Sources

- [Stripe event delivery behavior](https://docs.stripe.com/webhooks#event-delivery-behaviors)
- [Stripe signature verification](https://docs.stripe.com/webhooks#verify-events)
- [CreateOS SDK](https://github.com/NodeOps-app/createos-sandbox-sdk)
- [CreateOS egress](https://createos.sh/docs/Sandbox/REST-API/Egress)
- [OpenRouter API](https://openrouter.ai/docs/api/reference/overview)

The retry prompt includes only failing input cases and observations, plus relevant runtime facts. For concurrency failures it explains legacy sqlite3 transaction control and the lack of a session uniqueness constraint. It supplies no reference repair code.

SQLite behavior is grounded in the [Python connection context manager documentation](https://docs.python.org/3/library/sqlite3.html#how-to-use-the-connection-context-manager) and [SQLite transaction reference](https://www.sqlite.org/lang_transaction.html).
