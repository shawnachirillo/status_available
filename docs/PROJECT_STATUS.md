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
