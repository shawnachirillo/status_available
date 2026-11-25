# STATUS: AVAILABLE engineering instructions

The existing checkout and migration history are authoritative. Preserve completed functionality and uncommitted work. Inspect Git state before editing. Use isolated branches or worktrees for independent assignments and assign file ownership and integration dependencies before parallel changes.

Codex owns implementation, tests, debugging, review and documentation. Product scope, commercial policy, spending and releases belong to the product owner. Make reversible engineering decisions autonomously. Escalate material ambiguity, security and access blockers, irreversible actions and expenses.

Do not push, merge to main or deploy without authorization. Verify external deployment triggers before any authorized push or merge. Production migrations, paid services and live Stripe require explicit approval. Commit locally at tested milestones. Keep credentials, generated artifacts and unreviewed tools out of commits.

For every implementation block, record acceptance criteria, authorization and ownership checks, failure and recovery behavior, regression tests, documentation changes, a reviewable diff and verified results. Never report an unexecuted test as passing.

Use [PRODUCT_SPEC](docs/PRODUCT_SPEC.md) for approved behavior, [ARCHITECTURE](docs/ARCHITECTURE.md) for current boundaries, and [TESTING](docs/TESTING.md) for isolated test setup. Update status and decisions as evidence changes.

Use the canonical PostgreSQL hosting predicates. Revalidate draft save and restore at the final authorized mutation. Acquire locks in the existing purchase, entitlement, website order where those rows are needed. Rejected writes must preserve draft, version, revisions and snapshots.

Use only the approved loopback integration target in TESTING. Verify identity, schema, fixture and runtime role before mutation. Never use hosted credentials or execute unreviewed utilities.
