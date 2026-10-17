# Resource review — October 17, 2026

## Event and submission

- https://createos.sh/hackathon — mandatory shape: an AI agent that writes and executes code, infrastructure provisioned with Stripe Projects, code run in CreateOS Sandbox. Free plan supports one sandbox up to 1 vCPU. Public page offers ideas, not a scored judging rubric.
- https://projects.dev/hackathon-participants — participant guide, not the ranking page. Submission needs a public repository, deployed URL (or published library), Stripe account ID, and `stripe projects share` link; event code comes from organizers.
- https://projects.dev/leaderboard — checked with the `CreateOS 2026` filter: no projects displayed at inspection time. Overall upvotes span multiple events and do not establish this event's winners.
- Supplied guidelines in the referenced chat additionally require a new project built within the event, one submission per team, maximum three members, and no post-deadline changes counted.
- Published schedule: October 17, 12–7 PM Pacific; in Africa/Lagos that is October 17, 8 PM through October 18, 3 AM. Demos begin October 18, 2 AM Lagos. Confirm exact submission lock with organizers.

## CreateOS docs and endpoint

- https://createos.sh/docs/Sandbox/Overview/ — product overview.
- https://createos.sh/docs/Sandbox/ — navigation index.
- https://createos.sh/docs/Sandbox/Quickstart.md — CLI and SDK create/exec/destroy.
- https://createos.sh/docs/Sandbox/SDK/Overview.md — six equivalent language choices; TypeScript selected for shared frontend/backend language.
- https://createos.sh/docs/Sandbox/Limits.md — `devbox:1` explicitly selects Python/Node tooling; default image is minimal Alpine. Free concurrency is one; daily creates are limited. Destroy disposable sandboxes in `finally`.
- https://createos.sh/docs/Sandbox/REST-API/Egress.md — empty egress list ALLOWS outbound traffic. Set a nonempty allowlist before generated code executes. Keep model/API secrets outside the sandbox.
- https://createos.sh/docs/Services/Stripe-Projects.md — `stripe projects add createos/project` provisions the account and injects credentials. Do not select paid plans implicitly.
- https://api-eu.sb.createos.sh/ — root returned HTTP 401 without credentials; this is an authenticated API, not a docs page. Official SDK `whoami()` authenticated successfully using the user's key. Key is not copied into documentation.

## Repositories reviewed

| Supplied repository | Role | Decision |
| --- | --- | --- |
| https://github.com/NodeOps-app/createos-cli | Infrastructure CLI | Existing v0.0.31 available; sandbox commands verified in help. |
| https://github.com/NodeOps-app/createos-plugins | Agent host integrations | Optional developer tooling; direct SDK integration is sufficient for the product. No global plugin changes made. |
| https://github.com/NodeOps-app/createos-sandbox-sdk | TypeScript sandbox client | Installed `@nodeops-createos/sandbox` 0.8.2; verified actual installed types and authentication. |
| https://github.com/NodeOps-app/createos-go-sdk | Go sandbox client | Alternative, unnecessary for a TypeScript app. |
| https://github.com/NodeOps-app/createos-rust-sdk | Rust sandbox client | Alternative, unnecessary for a TypeScript app. |
| https://github.com/NodeOps-app/createos-csharp-sdk | .NET sandbox client | Alternative, unnecessary for a TypeScript app. |
| https://github.com/NodeOps-app/createos-java-sdk | Java sandbox client | Alternative, unnecessary for a TypeScript app. |

SDK families provide lifecycle, execution, and file-transfer capabilities. Installing all languages would add setup without improving the demo.

## Open setup items

- Stripe Projects initialization completed after browser pairing. CreateOS free plan/project and OpenRouter free plan/API are provisioned and complete.
- Real CreateOS execution verified the original fixture at 4/12 checks and reference repair at 12/12. An integration run verified a failed first patch followed by successful repair using explicitly mocked model responses.
- Live OpenRouter repair verified with Cohere North Mini Code: original 4/12, first repair 11/12, second repair 12/12. A controlled concurrency race was caught and corrected. Cleanup confirmed.
- A separate imported-handler development challenge now supports custom source and event JSON. Its first live run failed safely; after explicit runtime facts and counterexample feedback were added, the same input passed 12/12 repair checks and 12/12 new post-freeze audit checks. Audit evidence never becomes model feedback. Both runs are documented in `docs/challenges/README.md`; this is one additional synthetic implementation, not an external benchmark.
- Confirm event code, judging criteria, and lock time with organizers.
