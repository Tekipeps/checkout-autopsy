# Project instructions

Use Conventional Commits: `<type>(<optional scope>): <short description>`.
Sign off every commit with `git commit -s`; preserve sign-offs when amending.
Never commit credentials, `.env*` (except `.env.example`), or private `.projects/` state.
User-approved exceptions for leaderboard validation: `.projects/state.json` may contain only reviewed public provider/service metadata; `.projects/state.local.json` may contain only the reviewed Stripe account ID, project ID and project name. No provider links, backend resource IDs, variables, email, credentials, vault data or actual local state may be published. The pre-commit hook enforces these schemas.
Generated agent code runs only inside CreateOS, never on the host.
Keep local simulation explicitly labeled; it does not demonstrate live AI execution.

<!-- stripe-projects-cli managed:agents-md:start -->
## Stripe Projects CLI

This repository is initialized for the Stripe project "createos-hackathon".

## Tools used

- [Stripe CLI](https://docs.stripe.com/stripe-cli) with the `projects` plugin to manage third-party services, credentials, and deployments for this project. Use the stripe-projects-cli to manage deploying and access to third party services.
<!-- stripe-projects-cli managed:agents-md:end -->
