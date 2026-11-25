# Current architecture

Next.js App Router, React, TypeScript and Tailwind render the storefront, Edition pages, registration and customer editor. Clerk protects the workspace. Node API handlers query PostgreSQL through server-only pg. Supabase migrations own the schema. The default database path points at a hosted pooler. Integration mode permits the verification runner’s private Unix socket or the explicitly configured legacy loopback target. The verification cluster starts empty and uses separate bootstrap and runtime roles.

Stripe Checkout uses locked inventory reservations. Signed webhook events transition purchases and provision entitlements and a website; provider IDs, reconciliation and refund records support retries. The build rejects live Stripe keys.

Website APIs enforce Clerk ownership, matching Edition, active entitlement and paid purchase. Draft save and restore use versions and revisions. Publication creates immutable snapshots and atomically updates the live pointer. Public rendering reads the snapshot through dynamic /sites/[slug]; the optional hostname proxy rewrites validated customer root requests. The SQL hosting state and operational functions determine time eligibility.

Tracked migrations cover drafts, ownership, reservations, checkout, webhook events, reconciliation, refunds, publication and hosting eligibility. Hosting management, renewal, previews, media and export are future implementation boundaries. External edge, deployment and migration triggers remain unverified.
