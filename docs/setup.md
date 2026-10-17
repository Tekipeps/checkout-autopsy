# Setup status

- Stripe CLI 1.54.0, Projects plugin 0.50.0, Directory plugin 0.3.5 available.
- Stripe Projects `createos-hackathon` initialized successfully after browser pairing.
- CreateOS free plan and project provisioned through Projects, status `complete`.
- Supplied CreateOS key authenticates against the EU endpoint. Real replay and repair runs passed; the latest cleanup was confirmed destroyed.
- OpenRouter free plan and API provisioned through Projects, status `complete`. The app reads `OPENROUTER_API_API_KEY` automatically.
- `MODEL_NAME` is a Projects-managed variable selecting `cohere/north-mini-code:free`, verified in the OpenRouter model catalog. The first live run through the generic free router returned truncated output; the app rejected it and confirmed sandbox cleanup. Live verification completed: original 4/12, first AI repair 11/12, second AI repair 12/12. The concurrent-delivery check uses injected read latency, and the final sandbox was confirmed destroyed.
- Guided mode uses a labeled reference repair. Integration tests use labeled mock model responses.
- Custom-handler challenge completed with real AI: after one failed development run and improvements to runtime facts/counterexample feedback, the unchanged imported handler and sequence passed 12/12 repair checks plus 12/12 new frozen-audit checks. One generated candidate; no audit feedback to the model; sandbox destruction confirmed. Both outcomes are retained. See `docs/challenges/README.md`.
- Expanded Node/Express/Stripe SDK/PostgreSQL profile completed: 22/22 authored reference-control checks, 66/66 checks across three real AI repairs, and 69/69 frozen audit checks. Each fault mutation required one targeted model repair. An interrupted transfer resumed the exact pending audit without rerolling inputs. Source hashes and raw evidence were independently rechecked; sandbox destruction confirmed. See `docs/production-support.md` and `docs/evidence/node-postgres.json`.
- Local UI/API implemented; no public deployment, repository publication, or hackathon submission yet.
- No paid plan selected.

Do not read or edit `.projects/` or generated `.env` directly. Use the Projects CLI to inspect resources and synchronize credentials. Personal overrides stay in ignored `.env.local`.

| Provider | Service | Tier | Credential variables |
| --- | --- | --- | --- |
| CreateOS | Project and plan | Free | `CREATEOS_PROJECT_API_KEY`, `CREATEOS_PLAN_API_KEY` |
| OpenRouter | Model API and plan | Free | `OPENROUTER_API_API_KEY`, `OPENROUTER_PLAN_API_KEY` |

Potential later additions in the verified catalog: Supabase (database), Inngest (queue), Datadog (observability). None is required for the current local lab or provisioned here.
