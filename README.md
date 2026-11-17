# STATUS: AVAILABLE — Fresh application

A clean-room Next.js starter for the curated one-page website marketplace. **Not production-ready.** This is intentionally independent of the deleted prototype.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The root page shows a visual storefront with three **illustrative** Edition concepts, individual detail pages, and a clearly disabled customer workspace.

## What exists

- Next.js App Router, TypeScript, Tailwind CSS v4 configuration
- Responsive editorial storefront and Edition detail routes
- Typed, static demonstration Edition catalog
- Customer workspace placeholder with explicit nonfunctional status

## What does not exist

Authentication, Supabase integration or schema, checkout, payments, licensing, real inventory, editor, media upload, preview permissions, static publication/export, Cloudflare routing, customer domains, or renewal lifecycle. Do not sell Editions from this scaffold.

## Deployment boundaries

No domain, DNS, Cloudflare, Supabase, Stripe, GitHub, or other external account was modified. Never commit `.env` or service-role keys. Backend work should begin with a reviewed migration plan, staging environment, and authorization before production changes.

## Suggested next implementation slice

1. Create a new empty GitHub repository and push this starter after review.
2. Set up local dev and verify the build.
3. Add typed Edition manifest/schema and renderer contracts.
4. Build an interactive, local-only customization editor.
5. Plan Clerk, Stripe, Supabase and Cloudflare integrations with explicit safety gates.
