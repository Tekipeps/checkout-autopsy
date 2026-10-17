# Project instructions

Use Conventional Commits: `<type>(<optional scope>): <short description>`.
Sign off every commit with `git commit -s`; preserve sign-offs when amending.
Never commit credentials, `.env*` (except `.env.example`), or private `.projects/` state.
User-approved exception: `.projects/state.json` may contain only the reviewed public provider/service manifest for leaderboard validation. Account IDs, backend IDs, variables, credentials, vault data and local state remain excluded. The pre-commit hook enforces this schema.
Generated agent code runs only inside CreateOS, never on the host.
Keep local simulation explicitly labeled; it does not demonstrate live AI execution.

<!-- stripe-projects-cli managed:agents-md:start -->
## Stripe Projects CLI

This repository is initialized for the Stripe project "createos-hackathon".

## Tools used

- [Stripe CLI](https://docs.stripe.com/stripe-cli) with the `projects` plugin to manage third-party services, credentials, and deployments for this project. Use the stripe-projects-cli to manage deploying and access to third party services.
<!-- stripe-projects-cli managed:agents-md:end -->
