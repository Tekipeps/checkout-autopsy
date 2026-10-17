# Checkout Autopsy

**A successful response. A broken checkout.**

Reproduce duplicate or premature checkout fulfillment, run a repair inside CreateOS Sandbox, and verify committed shipment records after every delivery. Built fresh for the October 17, 2026 CreateOS × Stripe Projects hackathon.

## Public demo and evidence

[Explore the recorded runs](https://gleeful-baklava-f89941.netlify.app). Inspect exact AI edits, before/after checks, frozen hashes, and downloadable raw reports. This public site displays completed real executions; run the local app or CLI for new agent executions. [Submission packet and video script](docs/submission.md).

## Run locally

Node.js 24+ is required.

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The Express API listens on loopback port 3001. Vite reloads interface changes; restart the dev command after server or credential changes. For a production build served locally, run `npm run build` then `npm start` and open **http://127.0.0.1:3001**. Public multi-user hosting requires authentication, per-user quotas, and durable job coordination before exposure.

## Execution modes

- **Guided sandbox:** executes the intentionally faulty fixture and published reference repair in a real disposable CreateOS micro-VM. No AI generation is claimed.
- **Live agent:** sends source and observed failures to a configured model, executes its Python candidate in CreateOS, checks database state, and retries from failed evidence up to three times. It never silently substitutes the reference repair.

Choose a preset or **Bring your own handler**: paste a standard-library Python implementation and 1–12 synthetic Stripe-shaped events in your chosen delivery order. The interface validates inputs, shows the first divergent state with exact expected/observed rows, and exports the patch and full JSON evidence. See the [new-handler challenge](docs/challenges/README.md).

## Credentials

Provision CreateOS and OpenRouter through Stripe Projects as described in [setup](docs/setup.md). Alternatively, use an ignored `.env.local` for your own keys (see `.env.example`). Stripe Projects owns `.env`; do not hand-edit that output. Never commit credentials.

For live AI, configure a model credential, then restart the server:

```dotenv
OPENROUTER_API_KEY=<your key>
MODEL_NAME=cohere/north-mini-code:free
```

The default model is [Cohere North Mini Code (free)](https://openrouter.ai/cohere/north-mini-code:free), verified in the live OpenRouter catalog. Projects-provisioned credentials (`OPENROUTER_API_API_KEY`) are recognized automatically. OpenRouter can fall back to the verified free Gemma 4 31B model if the primary endpoint is unavailable. The actual responding model and token count are retained per attempt. Availability and rate limits vary. Another compatible endpoint can use `MODEL_API_KEY`, `MODEL_BASE_URL`, and `MODEL_NAME`. Configure paid models only deliberately. Secrets stay server-side; model and Stripe credentials never enter the execution sandbox or browser bundle.

## Verification

The contract requires exactly one **persisted shipment row** per paid checkout session across retries, distinct event IDs, process restarts, reordering, and simultaneous invocation. Unpaid and unrelated events must create no rows. Amount and currency must match.

Four visible scenarios and eight holdouts run against both handlers. Each delivery starts a fresh candidate process. The parent driver reads committed SQLite state after each batch; a separate TypeScript oracle on the server derives and checks expected outcomes. Reports retain randomized holdout seeds, candidate SHA-256 hashes, stdout, and exit codes. Holdout inputs are excluded from the initial model prompt; failures become feedback on later attempts.

Passing the repair suite now freezes the candidate's SHA-256 and triggers a **separate twelve-case final audit**, generated only after model generation stops. Fresh cases vary identifiers, prices (including zero), currencies, permutations, multiple sessions, concurrency and negative inputs. The original and frozen patch both run against the same audit inputs. Audit results never go back to the model. A failed audit withholds verification without another repair attempt. The interface distinguishes repair checks from final audit checks; a complete passing run is **24/24**. This is sample-based evidence, not a statistical benchmark or proof.

Observed CreateOS results: faulty duplicate fixture **4/12**, reference repair **12/12**. A separate integration run with a local mock model verified the retry loop: an event-ID-only patch passed **8/12**, then its replacement passed **12/12**. Mock responses are not a live AI result. The subsequent **real live-agent run** used Cohere North Mini Code: its first repair passed **11/12**, the checker caught a concurrency race, and its second repair passed **12/12**. Cleanup was confirmed destroyed. See `artifacts/checkout-autopsy-live-report.json` for that local evidence.

The newer **custom-handler challenge** exposed a failed repair run, which correctly withheld verification. After improving runtime facts and counterexample feedback, the same imported source/deliveries passed **12/12 repair checks in one AI attempt plus 12/12 fresh frozen-audit checks**. The original passed only **3/12** audit checks. Both outcomes and the intervening changes are documented in [challenge results](docs/challenges/README.md#observed-live-results); local evidence is `artifacts/checkout-autopsy-challenge-verified.json`. This demonstrates a second synthetic implementation within the contract, not generalization to arbitrary production handlers.

## Node/Express/PostgreSQL integration profile

The **Production support** view adds a second runtime: JavaScript ESM, real Express HTTP, the official Stripe Node SDK, native PostgreSQL and separate outbox worker processes. It exercises signature rejection, zero-total Checkout fulfillment, concurrent requests, hard service/worker crashes, durable order/outbox transactions and idempotent HTTP fulfillment retries.

The profile uses 22 repair checks followed by a separate 23-check frozen audit. The default corpus explicitly introduces three fault mutations; it is not a set of independent customer repositories. A supported custom module can be pasted into the interface or supplied through the CLI. Exact edits and all failed attempts are retained. See [the compatibility contract, scope and test matrix](docs/production-support.md).

Recorded integration result: authored reference **22/22**; three real AI repairs **66/66**; three frozen audits **69/69**. One targeted model repair per mutation; sandbox destruction confirmed. [Rechecked evidence summary](docs/evidence/node-postgres.json). This establishes the named cases for this profile; independent customer applications and production traffic remain untested.

```bash
npm ci --prefix sandbox/production --ignore-scripts
npm run validate:production
npm run validate:production -- /absolute/path/to/app.mjs
```

Linux/x64 packaging is required for this pinned native runtime. Generated modules execute only inside CreateOS; no live Stripe credentials enter the VM. Production-shaped evidence does not certify untested stacks, real customer deployments or arbitrary repositories.

## Scope

Both profiles use **synthetic Stripe-shaped snapshots**, not deliveries from Stripe infrastructure. The Python lab assumes authentication happened earlier. The Node profile verifies signatures over real raw HTTP requests, signed locally with the official SDK test helper. Neither profile collects payments, ships parcels or exposes a registered production webhook.

Passing these checks is evidence for the tested cases, not a production correctness guarantee or proof of exactly-once physical delivery. External side effects need durable outbox/queue patterns and fulfillment-side idempotency. The VM isolates the host, but the in-VM driver is not an adversarially tamper-proof grader.

## Checks

```bash
npm run check           # TypeScript
npm test                # checker tests; no cloud access
npm run build           # type check and production bundle
npm run doctor          # read-only CreateOS auth and sandbox counts
npm run sandbox:smoke   # real CreateOS run; one sandbox creation
npm run test:agent-loop # real sandbox, local mock model, retry/cleanup check
npm run validate:production # real Node/HTTP/PostgreSQL + AI; one sandbox per campaign
```

Disposable sandboxes use `s-1vcpu-1gb`, `devbox:1`, private ingress, a nonempty egress allowlist restricted to a reserved documentation address, process limits, and idle auto-pause. Cleanup runs in `finally` and waits for the destroyed state. Failures surface the sandbox ID. Evidence is retained in ignored `artifacts/`. Watch the daily sandbox-creation quota.

## Layout

- `src/`: React interface, responsive theme, self-hosted fonts.
- `shared/`: synthetic events, replay fixtures, result schemas.
- `server/`: streaming API, sandbox lifecycle, model adapter, independent checker.
- `sandbox/`: replay driver and isolated invocation wrapper.
- `fixtures/`: intentionally faulty handler and labeled reference repair.
- `tests/`: checks that reject false-positive evidence.
- `docs/`: setup, architecture, research, and demo guidance.

Stripe Projects successfully initialized `createos-hackathon`. See [setup notes](docs/setup.md) and the [demo script](docs/demo.md). No public deployment or submission has occurred. Commits require Conventional Commits and `git commit -s`; the local pre-commit hook blocks common credential patterns and secret files.

## Build the public evidence explorer

```bash
npm run build:showcase
python3 -m http.server 4174 --directory dist-showcase
```

This static build contains only the explicitly published synthetic run reports and browser assets. It has no server credentials or live execution API. Full recorded reports are in `docs/evidence/`; cloud artifacts remain ignored.
