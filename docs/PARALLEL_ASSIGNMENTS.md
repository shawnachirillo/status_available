# Parallel engineering assignments

Start each assignment from the accepted SA-003 branch in a separate worktree or Cloud checkout. Run the unified verification command against each checkout. Use individual branches and local, reviewable commits. Publication, PR creation and review workflow activation are subject to deployment-trigger review and authorization.

## SA-004A — Storefront purchase and checkout return

**Estimate** 18–30 engineering hours.

**Dependencies** Existing Clerk identity, inventory reservation, checkout and Stripe webhook fulfillment. Product owner supplies commercial terms and catalog values before customer-facing commercialization. Use synthetic values in tests.

**Owns** Platform landing and Edition detail pages, checkout return routes under `src/app/(platform)/checkout/`, any narrowly scoped checkout status API, and A-specific components and tests. This stream owns changes to `src/app/api/checkout/route.ts` and payment orchestration when required. The existing editor is B's.

**Accept when** A signed-in customer can initiate checkout for an eligible Edition. Invalid, unavailable and disabled checkout have usable recovery states. Success and cancel routes handle direct, repeated and delayed visits. A return URL cannot grant entitlement. Status lookup is restricted to the buyer. Webhook fulfillment remains idempotent and the existing paid-access and inventory regressions pass. Use simulated Stripe responses in automation, then approved test mode for provider acceptance.

## SA-004B — Customer onboarding and workspace

**Estimate** 12–22 engineering hours.

**Dependencies** Clerk account state and the existing authorized website listing. Agree with A on a minimal post-checkout status-to-workspace contract before wiring redirects. Existing website and draft APIs remain the source of access decisions.

**Owns** `src/app/(platform)/app/`, workspace shell and onboarding components, and B-specific tests. C and D deliver independent modules and routes. Only B edits the shared workspace shell while B is in flight.

**Accept when** Signed-out, eligible new, empty, pending, multiple-site and ineligible states have clear safe actions. No route leaks a different buyer's website. The first paid site can enter the existing editor. Existing draft conflict, revision, purchase-backed access and publication behaviors continue to work.

## SA-004C — Media and private previews

**Estimate** 28–48 engineering hours.

**Dependencies** Confirm storage and delivery architecture and the required unlink/recovery behavior with product and security owners before any paid service or provider configuration. Agree with B on workspace integration points. Use test adapters and controlled clocks.

**Owns** New media and preview routes and modules, a separate media/preview component directory, C-specific tests, and C-owned migrations with assigned versions. Any shared renderer contract change is reviewed with publication and accessibility owners.

**Accept when** Media is scoped to the website and enforces the approved 250 MB site allowance, 10 MB per upload and 50-image limit, including concurrent uploads and failed-upload cleanup. Unpublished drafts stay private. Share links expire after seven days, enforce the agreed access policy, and do not introduce indexing or stale public access. Cross-account, expired-link and cleanup regressions pass. Cloud verification uses a local adapter and synthetic files.

## SA-004D — Hosting renewal and management foundations

**Estimate** 24–42 engineering hours.

**Dependencies** Canonical SQL hosting state and purchase/entitlement rules. Product owner supplies renewal pricing and payment terms and approves retention and recovery policy separately. Coordinate with A if renewal reuses commerce infrastructure.

**Owns** Dedicated hosting management routes, hosting and renewal services, reminder scheduling interfaces, D-specific tests, and assigned D migration versions. Coordinate editor integration with B. The existing lifecycle SQL remains authoritative for hosting time eligibility.

**Accept when** Owners can see hosting state and initiate authorized opt-in renewal during active hosting, grace and protected retention. Refund, revocation and ownership overrides remain enforced. Expiration calculations and notification scheduling at 60, 30, 14 and 7 days are deterministic and retry-safe. Suspension preserves data and blocks prohibited operations. Retention expiry creates no unattended deletion. External billing and notification delivery wait for approved configuration and staging verification.

## SA-004E — Accessibility and defensive security acceptance

**Estimate** 14–24 engineering hours.

**Dependencies** The SA-003 runner and the current UI. Provider settings are needed for staging authentication, runtime roles, edge routing and deployment evidence. A–D provide branch-level features for final acceptance.

**Owns** Acceptance test files, audit evidence and release-checklist updates. File issues or coordinate patches with the current owner for shared application files. Use local synthetic identities and data for security checks.

**Accept when** Keyboard navigation, focus, form labels, error feedback and contrast are checked across the storefront, workspace and customer flow. Authorization coverage includes ownership, Clerk boundaries, webhook signature handling, draft/preview separation, stale state, caching and host routing. Document coverage, reproducible checks, unresolved defects and evidence that require staging.

## Integration order

1. Agree on buyer status and workspace handoff between A and B. Reserve migration versions for C and D. E can start the baseline audit independently.
2. Run A and B in parallel on their own surfaces. C and D can implement isolated services, tests and UI modules in parallel with them. A owns any shared payment adapter until a reviewed interface is available to D.
3. Integrate A and B once synthetic checkout and post-purchase workspace behavior pass. Review C and D migrations together, apply them in assigned order to a clean database, and integrate their workspace modules one at a time.
4. Run E's cross-stream accessibility and security acceptance after each integration. Run the full authorized staging and release checks once all approved launch features are integrated.

The assignments total 96–166 engineering hours. Static export, managed handoff, custom-domain operations, remaining infrastructure and staging work sit outside those assignment estimates unless separately assigned. The full launch planning range is 125–225 engineering hours, subject to staging access and outstanding product decisions.
