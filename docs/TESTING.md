# Testing

Use the lockfile and the installed Node tooling. From the checkout, use ./node_modules/.bin/tsc --noEmit --incremental false for a type check. Run npm run build in an isolated checkout because Next.js generates files. Do not infer success from earlier test counts.

Run mocked UI and hostname suites separately:

```sh
./node_modules/.bin/vitest run tests/editor-race.test.tsx tests/editor-publication.test.tsx tests/hostname-routing.test.ts
```

## Isolated integration

The approved target is 127.0.0.1:55432, database status_payment_concurrency_test, user status_test. Require STATUS_INTEGRATION_TEST_MODE=true and pass STATUS_TEST_DB_HOST, STATUS_TEST_DB_PORT and STATUS_TEST_DB_NAME explicitly. Use a clean environment without hosted PostgreSQL credentials or Stripe secrets. For a Next HTTP harness, use an isolated checkout without production dotenv files.

Before mutating tests, verify current database, user, server address and port. Verify migrations, the canonical hosting functions, grants for the isolated runtime role and required synthetic catalog fixtures including atelier. The HTTP suite needs a dedicated local server with test-mode database config, STATUS_SUBDOMAIN_ROUTING=true and STATUS_BASE_DOMAIN=localhost. Verify the server target before use.

After the preflight, run the authenticated API, authorization edge, publication lifecycle and publication HTTP suites with Vitest and --no-file-parallelism. The signed-in route handlers use mocked Clerk identity; the HTTP suite contacts the dedicated local public server. Keep Stripe-backed and unreviewed scripts outside this command. Do not reset, clone over or mutate an unknown database. Connectivity is verified on the existing PostgreSQL 17.2 instance. Bootstrap of the synthetic fixtures on an empty database remains open.

### Verified HTTP setup

Use a source copy or worktree that includes the changes under test. Use a synthetic Clerk public key for compilation only and start the built app with isolated database flags. The publication HTTP suite takes an optional STATUS_TEST_HTTP_PORT, defaults to 3001 and always connects to IPv4 loopback. Pass localhost as the server hostname so Next recognizes the customer-host rewrite as internal.

```sh
env -i PATH="$PATH" NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_$(printf '%s' 'example.clerk.accounts.dev$' | base64) \
  ./node_modules/.bin/next build --webpack

env -i PATH="$PATH" NODE_OPTIONS=--dns-result-order=ipv4first NEXT_TELEMETRY_DISABLED=1 \
  STATUS_INTEGRATION_TEST_MODE=true STATUS_TEST_DB_HOST=127.0.0.1 STATUS_TEST_DB_PORT=55432 \
  STATUS_TEST_DB_NAME=status_payment_concurrency_test STATUS_SUBDOMAIN_ROUTING=true \
  STATUS_BASE_DOMAIN=localhost ./node_modules/.bin/next start --hostname localhost --port 3012
```

From a second execution terminal, verify the isolated database and confirm a synthetic missing hostname returns 404 before running the full suite:

```sh
env -i PATH="$PATH" PGPASSFILE=/nonexistent PGCONNECT_TIMEOUT=3 \
  psql -X -w -h 127.0.0.1 -p 55432 -U status_test -d status_payment_concurrency_test -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), current_setting('server_version');
SELECT has_function_privilege(current_user, 'public.website_hosting_state(timestamptz,timestamptz,timestamptz)', 'EXECUTE'),
       has_function_privilege(current_user, 'public.website_hosting_operational(timestamptz,timestamptz,timestamptz)', 'EXECUTE');
SELECT to_regclass('public.website_publications');
SELECT count(*) FROM public.edition_catalog WHERE slug = 'atelier';
SELECT count(*) FROM public.websites WHERE owner_clerk_user_id LIKE 'provision-test-%';
ROLLBACK;
SQL

curl --noproxy '*' --max-time 5 -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: sa002-missing.localhost:3012' http://127.0.0.1:3012/

env -i PATH="$PATH" STATUS_INTEGRATION_TEST_MODE=true STATUS_TEST_DB_HOST=127.0.0.1 \
  STATUS_TEST_DB_PORT=55432 STATUS_TEST_DB_NAME=status_payment_concurrency_test \
  STATUS_TEST_HTTP_PORT=3012 ./node_modules/.bin/vitest run --no-file-parallelism
```

Expect the named database and user, the loopback address and port, both function grants, the publication table, an Atelier catalog row, and an eligible provisioning fixture. Check fixture ownership and hosting dates if the preflight counts match but a suite cannot find the expected fixture. Do not use an existing unknown listener.
