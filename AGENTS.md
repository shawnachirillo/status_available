# STATUS: AVAILABLE engineering instructions

The existing checkout and migration history are authoritative. Preserve completed functionality and uncommitted work. Inspect Git state before editing. Use isolated branches or worktrees for independent assignments and assign file ownership and integration dependencies before parallel changes.

Codex owns implementation, tests, debugging, review and documentation. Product scope, commercial policy, spending and releases belong to the product owner. Make reversible engineering decisions autonomously. Escalate material ambiguity, security and access blockers, irreversible actions and expenses.

Do not push, merge to main or deploy without authorization. Verify external deployment triggers before any authorized push or merge. Production migrations, paid services and live Stripe require explicit approval. Commit locally at tested milestones. Keep credentials, generated artifacts and unreviewed tools out of commits.

For every implementation block, record acceptance criteria, authorization and ownership checks, failure and recovery behavior, regression tests, documentation changes, a reviewable diff and verified results. Never report an unexecuted test as passing.

Use [PRODUCT_SPEC](docs/PRODUCT_SPEC.md) for approved behavior, [ARCHITECTURE](docs/ARCHITECTURE.md) for current boundaries, and [TESTING](docs/TESTING.md) for isolated test setup. Update status and decisions as evidence changes.

Use the canonical PostgreSQL hosting predicates. Revalidate draft save and restore at the final authorized mutation. Acquire locks in the existing purchase, entitlement, website order where those rows are needed. Rejected writes must preserve draft, version, revisions and snapshots.

Use the private PostgreSQL verification runner in TESTING for local, Cloud and CI regressions. Verify identity, schema, fixtures and runtime grants before test mutations. The previously approved fixed loopback target is reserved for explicitly isolated legacy checks. Keep hosted credentials and unreviewed utilities out of all verification commands. Assign ownership and migration order using [PARALLEL_ASSIGNMENTS](docs/PARALLEL_ASSIGNMENTS.md).
