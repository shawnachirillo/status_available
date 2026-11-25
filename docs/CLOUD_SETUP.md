# Codex Cloud verification setup

This setup uses public packages and local subprocesses. No Clerk, Stripe, Supabase, deployment or database secret is needed. The branch containing SA-003 must first be made available to the Cloud task through a separately authorized GitHub publication or an approved handoff. A local commit alone is unavailable to the Cloud repository picker.

1. In **Settings → Codex Cloud → Environments**, create an environment for `shawnachirillo/status_available`. Select the authorized verification branch or confirm the task checkout contains the SA-003 commit. Keep production repositories, credentials and deploy hooks out of this engineering environment.
2. Select Node `22.23.2` where runtime selection is available. If the image uses nvm, install and select the repository version with `nvm install && nvm use`. Use the package dependencies in `package-lock.json`.
3. Provide PostgreSQL 17 server and client binaries and curl. Run `/usr/lib/postgresql/17/bin/postgres --version` to confirm availability. On a managed Cloud machine with an approved package helper and PostgreSQL 17 in its package indexes, use:

   ```sh
   sudo -n /usr/local/bin/cloud-agent-packages update
   sudo -n /usr/local/bin/cloud-agent-packages install postgresql-17 postgresql-client-17 curl
   ```

   If package names are unavailable on the selected image, use an image with those packages or request the approved PostgreSQL 17 package source. The GitHub Actions workflow demonstrates the official signed PGDG repository for Ubuntu 24.04 on a runner where APT source changes are allowed. Do not modify Cloud sandbox or package-source restrictions.

4. Run this setup from the repository root:

   ```sh
   node --version
   /usr/lib/postgresql/17/bin/postgres --version
   npm ci --no-audit --no-fund
   ```

   Setup needs access to the npm registry and the approved package source if installing PostgreSQL. Access to the Node distribution source is needed only if adding Node via nvm. Set the runtime variable `STATUS_TEST_PG_BIN=/usr/lib/postgresql/17/bin`, or point it at the selected image's verified PostgreSQL 17 binary directory. Set no other variables or secrets for verification.

5. In a Cloud task as a non-root user, run `npm run test:unit` or `npm test`. Full verification needs private Unix sockets, local PostgreSQL shared memory, an IPv4 loopback listener and child-process signaling. It needs no internet after setup and no inbound HTTP portal. Expect seven Vitest suites and 77 tests at the SA-003 baseline. Save and publish the environment configuration after a clean Cloud run succeeds.

The prepared workflow runs on pull requests and manual dispatch with read-only repository permissions. It performs no deployment or production migration. Before pushing or opening a PR, confirm the hosting provider's production and preview branch mappings, events that trigger each, connected GitHub app or webhook, migration/build hooks or separate jobs, and which environment the hooks target. Obtain read-only access to those settings or a redacted screenshot. Secret values and production database access are unnecessary. GitHub checks alone do not prove external deployment triggers are absent.

References: [Codex Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments) · [PostgreSQL packages for Ubuntu](https://www.postgresql.org/download/linux/ubuntu/)
