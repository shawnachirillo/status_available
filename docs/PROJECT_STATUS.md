# Project status

Validated main baseline: 31134d5. Hosting development baseline: 4d15fc7.

Implemented in the repository: storefront and Edition pages, Clerk identity, purchase-backed ownership, Stripe test-mode checkout and fulfillment, inventory reservations, website provisioning, draft editor and revision history, snapshot publication, hostname routing and hosting eligibility.

Prior owner-reported evidence: 76 publication regression tests and a subsequent 32-test hosting regression passed. Full hosting HTTP regression, final-write draft and restore authorization, and production runtime-role compatibility are open. Treat these historical counts separately from new execution evidence.

SA-001 identified hard-coded hosted database routing, missing reproducible fixtures and lint setup, stale active-term expectations, and local utilities with mixed isolation guarantees. Checkout has no storefront caller or success/cancel pages. The local sandbox denied both PostgreSQL TCP and Unix socket access; the listening process alone does not verify the harness.

Missing or incomplete approved features include hosting management, renewal, custom domains, previews, media, export, managed handoff, customer support documentation and controlled retention operations. External automatic deployment triggers are unverified.

## SA-002 verification

- The existing isolated PostgreSQL 17.2 database is reachable after local network permission. Verified its identity, publication table, canonical hosting functions and synthetic fixtures.
- The pinned main baseline passed all 76 tests in a credential-free source copy. The only test harness adjustment in that copy was the HTTP port. The pinned hosting baseline passed all 32 targeted tests.
- The stabilized branch passed all 77 tests across seven suites on a dedicated local production-build server. TypeScript and the webpack production build passed.
- Tests cover exact SQL boundaries, successful grace save and restore, a new grace snapshot delivered over HTTP, preservation during suspension and retention expiry, and rejection of writes during cutoff and refund scenarios.
- A transaction-scoped non-superuser role successfully called both hosting functions when granted execution. The migration's restricted client roles lack execution. The test login is a superuser, so this separate probe does not establish the actual production login's table privileges or migration grants.
- Remaining release prerequisites include actual staging runtime-role and migration verification, external deployment settings, clean fixture bootstrap and the remaining approved product features.

## SA-003 cloud readiness

- Added a pinned Node version, unified verification runner, clean PostgreSQL 17 migrations and synthetic fixtures, isolated Next.js HTTP startup, and a verification-only workflow. See [TESTING](TESTING.md) and [CLOUD_SETUP](CLOUD_SETUP.md).
- A clean package installation, webpack production build, independent TypeScript check and all 77 regressions passed using a fresh database on the already-running isolated PostgreSQL 17.2 instance. The verification copy adapted only cluster startup and test identifiers for the existing local service. It applied tracked migrations and verified the fixture and grants as a separate non-superuser role. It stopped the new HTTP harness and dropped the temporary database and roles.
- The exact unified command reached `initdb` in the desktop sandbox and failed at a denied System V shared-memory call. Standalone fresh-cluster startup and shutdown remain unverified on Linux. No Cloud task or GitHub Actions run was launched. Before parallel overnight work, publish the branch only with approval and run the exact unified command in a selected Cloud environment.
- The three historic processes on ports 3011–3013 were confirmed to belong to SA-002 harness copies. Normal signals were denied, and automatic approval policy rejected the narrowly scoped elevated stop command. They remained listening at the final check.
- [SA-004 assignments](PARALLEL_ASSIGNMENTS.md) establish ownership, acceptance and dependencies. Cloud execution and provider trigger verification remain operational gates.
