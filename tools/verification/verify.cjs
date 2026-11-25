const { execFileSync, spawn } = require('node:child_process');
const { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync } = require('node:fs');
const { createServer } = require('node:net');
const { request } = require('node:http');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const repo = resolve(__dirname, '../..');
const nodeModules = join(repo, 'node_modules');
const executable = name => join(nodeModules, '.bin', name);
const version = '22.23.2';
const database = 'status_payment_concurrency_test';
const port = '55432';
const runtimeUser = 'status_test';

function launch(command, args, options) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  const result = new Promise(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, result };
}

async function checked(process, label) {
  const { code, signal, error } = await process.result;
  if (error) throw error;
  if (code !== 0) throw new Error(`${label} failed (${signal ?? code})`);
}

async function ready(server, probe, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!server.child.pid || server.child.exitCode !== null || server.child.signalCode !== null) {
      await checked(server, label);
      throw new Error(`${label} exited before readiness`);
    }
    if (await probe()) return;
    await delay(100);
  }
  throw new Error(`${label} did not become ready`);
}

async function stop(server, signal) {
  if (!server) return;
  const { child, result } = server;
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    await result;
    return;
  }

  for (const requestedSignal of [signal, 'SIGKILL']) {
    if (!child.kill(requestedSignal)) break;
    const timeout = delay(5000, false, { ref: false });
    if (await Promise.race([result.then(() => true), timeout])) return;
  }
  child.unref();
  throw new Error(`Could not stop verification child process ${child.pid}`);
}

async function freeHttpPort() {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function httpReady(port) {
  return new Promise(resolve => {
    const probe = request({
      hostname: '127.0.0.1',
      port,
      path: '/',
      headers: { Host: `verification-missing.localhost:${port}` },
      timeout: 1000
    }, response => {
      response.resume();
      resolve(response.statusCode === 404 && response.headers['x-middleware-rewrite']?.includes('/sites/verification-missing'));
    });
    probe.on('timeout', () => probe.destroy());
    probe.on('error', () => resolve(false));
    probe.end();
  });
}

async function main() {
  if (process.versions.node !== version) {
    throw new Error(`Use Node ${version} (.nvmrc) for verification`);
  }
  if (process.getuid?.() === 0) {
    throw new Error('Run verification as a non-root user so PostgreSQL can initialize');
  }

  const workspace = mkdtempSync('/tmp/status-test-');
  const app = join(workspace, 'app');
  const socket = join(workspace, 'socket');
  const data = join(workspace, 'pgdata');
  const env = {
    PATH: process.env.PATH,
    HOME: workspace,
    TMPDIR: workspace,
    LANG: 'C',
    TZ: 'UTC',
    NEXT_TELEMETRY_DISABLED: '1'
  };
  let postgres;
  let http;
  let step;
  let interrupted;
  function interrupt(signal) {
    interrupted = signal;
    step?.child.kill('SIGTERM');
  }
  const sigint = () => interrupt('SIGINT');
  const sigterm = () => interrupt('SIGTERM');
  process.on('SIGINT', sigint);
  process.on('SIGTERM', sigterm);

  async function run(command, args, options) {
    if (interrupted) throw new Error(`Verification interrupted by ${interrupted}`);
    step = launch(command, args, options);
    await checked(step, args[0] ?? command);
    step = undefined;
  }

  try {
    const pgBin = process.env.STATUS_TEST_PG_BIN ||
      execFileSync('pg_config', ['--bindir'], { env, encoding: 'utf8' }).trim();
    const pg = name => join(pgBin, name);
    const pgVersion = execFileSync(pg('postgres'), ['--version'], { env, encoding: 'utf8' });
    if (!/^postgres \(PostgreSQL\) 17\./.test(pgVersion)) {
      throw new Error('PostgreSQL 17 server binaries are required. Set STATUS_TEST_PG_BIN to their directory.');
    }

    mkdirSync(app);
    mkdirSync(socket, { mode: 0o700 });
    for (const entry of ['src', 'tests', 'package.json', 'package-lock.json', 'postcss.config.mjs', 'tsconfig.json']) {
      cpSync(join(repo, entry), join(app, entry), { recursive: true });
    }
    for (const entry of ['public', 'next.config.js', 'next.config.mjs', 'next.config.ts']) {
      if (existsSync(join(repo, entry))) {
        cpSync(join(repo, entry), join(app, entry), { recursive: true });
      }
    }
    symlinkSync(nodeModules, join(app, 'node_modules'), 'dir');

    const buildEnv = {
      ...env,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64')
    };
    await run(executable('next'), ['build', '--webpack'], { cwd: app, env: buildEnv });
    await run(executable('tsc'), ['--noEmit', '--incremental', 'false'], { cwd: app, env });

    await run(pg('initdb'), ['-D', data, '--username=status_bootstrap', '--auth-local=trust',
      '--auth-host=reject', '--encoding=UTF8', '--locale=C'], { env });
    postgres = launch(pg('postgres'), ['-D', data, '-h', '', '-p', port, '-k', socket,
      '-c', 'unix_socket_permissions=0700', '-c', 'log_min_messages=warning'], { env });
    const admin = ['-X', '-w', '-h', socket, '-p', port, '-U', 'status_bootstrap', '-v', 'ON_ERROR_STOP=1'];
    await ready(postgres, () => {
      if (interrupted) throw new Error(`Verification interrupted by ${interrupted}`);
      try {
        execFileSync(pg('pg_isready'), ['-q', '-h', socket, '-p', port, '-U', 'status_bootstrap'], { env });
        return true;
      } catch {
        return false;
      }
    }, 'PostgreSQL');

    await run(pg('psql'), [...admin, '-d', 'postgres', '-c', `
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE ROLE ${runtimeUser} LOGIN BYPASSRLS IN ROLE service_role;
    `, '-c', `CREATE DATABASE ${database}`], { env });
    const migrations = join(repo, 'supabase/migrations');
    for (const filename of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
      await run(pg('psql'), [...admin, '-d', database, '-q', '-f', join(migrations, filename)], { env });
    }
    await run(pg('psql'), [...admin, '-d', database, '-q',
      '-f', join(__dirname, 'fixtures.sql'), '-c', `
        GRANT USAGE ON SCHEMA public TO ${runtimeUser};
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtimeUser};
      `], { env });
    const identity = execFileSync(pg('psql'), ['-X', '-w', '-h', socket, '-p', port,
      '-U', runtimeUser, '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', `
      SELECT current_database(), current_user, inet_server_addr() IS NULL,
             NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
             public.website_hosting_state(now() - interval '1 day', now() + interval '1 day', now()),
             public.website_hosting_operational(w.hosting_starts_at, w.hosting_ends_at, now()),
             NOT has_function_privilege('anon', 'public.website_hosting_operational(timestamptz,timestamptz,timestamptz)', 'EXECUTE'),
             NOT has_function_privilege('authenticated', 'public.website_hosting_state(timestamptz,timestamptz,timestamptz)', 'EXECUTE'),
             to_regclass('public.website_publications') IS NOT NULL
      FROM public.websites w JOIN public.edition_catalog e ON e.id = w.edition_catalog_id
      WHERE e.slug = 'atelier' AND w.owner_clerk_user_id = 'provision-test-owner'
    `], { env, encoding: 'utf8' }).trim();
    if (identity !== `${database}|${runtimeUser}|t|t|active|t|t|t|t`) {
      throw new Error('Private PostgreSQL identity, migration, grants, or fixture validation failed');
    }
    console.log('Verified fresh PostgreSQL 17 cluster, restricted runtime role, migrations, and fixtures');

    const httpPort = await freeHttpPort();
    const testEnv = {
      ...env,
      NODE_OPTIONS: '--dns-result-order=ipv4first',
      STATUS_INTEGRATION_TEST_MODE: 'true',
      STATUS_TEST_DB_SOCKET: socket,
      STATUS_TEST_DB_PORT: port,
      STATUS_TEST_DB_NAME: database,
      STATUS_TEST_HTTP_PORT: String(httpPort)
    };
    http = launch(executable('next'), ['start', '--hostname', 'localhost', '--port', String(httpPort)], {
      cwd: app, env: { ...testEnv, STATUS_SUBDOMAIN_ROUTING: 'true', STATUS_BASE_DOMAIN: 'localhost' }
    });
    await ready(http, () => {
      if (interrupted) throw new Error(`Verification interrupted by ${interrupted}`);
      return httpReady(httpPort);
    }, 'Next.js HTTP harness');
    await run(executable('vitest'), ['run', '--no-file-parallelism'], { cwd: app, env: testEnv });
  } finally {
    const shutdown = await Promise.allSettled([stop(http, 'SIGTERM'), stop(postgres, 'SIGINT')]);
    process.removeListener('SIGINT', sigint);
    process.removeListener('SIGTERM', sigterm);
    const failures = shutdown.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      console.error(`Verification files retained at ${workspace} because teardown failed`);
      throw new AggregateError(failures.map(result => result.reason), 'Verification teardown failed');
    }
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.message);
  if (error instanceof AggregateError) {
    for (const failure of error.errors) console.error(failure.message);
  }
  process.exitCode = 1;
});
