-- Synthetic test fixtures for the private verification cluster.
BEGIN;

INSERT INTO public.edition_catalog (id, slug, name, tier, status, price_cents)
VALUES ('00000000-0000-4000-8000-000000000101', 'atelier', 'Fixture Atelier', 'Open', 'active', 10000);

INSERT INTO public.purchases (id, buyer_clerk_user_id, edition_id, payment_provider, status, amount_cents, currency, paid_at)
VALUES ('00000000-0000-4000-8000-000000000102', 'provision-test-owner',
        '00000000-0000-4000-8000-000000000101', 'stripe', 'paid', 10000, 'usd', now());

INSERT INTO public.entitlements (id, purchase_id, edition_id, owner_clerk_user_id)
VALUES ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000102',
        '00000000-0000-4000-8000-000000000101', 'provision-test-owner');

INSERT INTO public.websites (id, owner_clerk_user_id, edition_id, edition_catalog_id,
                            entitlement_id, name, draft_content, hosting_starts_at, hosting_ends_at)
VALUES ('00000000-0000-4000-8000-000000000104', 'provision-test-owner', 'atelier',
        '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000103',
        'Fixture Studio',
        '{"edition":"atelier","business":"Fixture Studio","headline":"Fixture headline","description":"","email":"","phone":"","booking":"","palette":0}',
        now() - interval '1 day', now() + interval '12 months');

INSERT INTO public.website_revisions (id, website_id, content)
SELECT '00000000-0000-4000-8000-000000000105', id, draft_content
FROM public.websites WHERE id = '00000000-0000-4000-8000-000000000104';

COMMIT;
