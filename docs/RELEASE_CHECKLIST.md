# Release acceptance

- Before any push, merge or release, verify the provider project and linked repository, production and preview branch filters, triggering events, connected Git app or webhook, and migration hooks and their targets. Read-only settings or redacted evidence suffice. Obtain release authorization separately.
- Verify the unified build, type check, database and HTTP regression in a clean Cloud or CI run. Run applicable lint and record provider-backed acceptance separately.
- Verify fresh migration and upgrade paths, runtime identity and grants, staging fixtures, backups and rollback.
- Verify account isolation, checkout and webhook idempotency, inventory, provisioning and refund handling in approved test mode.
- Verify editor conflicts, immutable Edition, revisions, snapshot isolation, hostname routing, TLS, cache behavior and hosting transitions.
- Confirm approved launch features and customer support documentation; verify accessibility and recovery paths.
- Keep live Stripe and production changes gated. Record tested commit, evidence, known limitations and operational owners before release.
