/* ============================================================================
   THE WORKER-ONLY SUITES, WITHOUT WRANGLER — CONFIRM-01, 2026-10-04.

   `node test/run-all.mjs` is the run that counts: a real `wrangler dev` and a real headless Chrome. This runner is for
   a machine that has neither (the sandbox CONFIRM-01 was built in could not install wrangler at all): it stands the
   Worker up inside Node (test/lib/node-worker.mjs) with the same fake Pushover / Telegram / FormSubmit stub and the same
   contract fake of SMSGate the big runner uses, and runs the suites that speak only HTTP to the Worker — D, H, J, S, P and
   C. The browser suites (A–G, I, K) are not here and are never called green by this file.

   Run:  node test/run-local.mjs                      every Worker-only suite
         UMBRA_ONLY=C node test/run-local.mjs         one suite
         UMBRA_WORKER_SRC=<dir> …                     the Worker from another checkout (a RED run against main)
   The tally prints exactly as run-all.mjs prints it.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureServer, smsgateServer, close } from './lib/servers.mjs';
import { startNodeWorker } from './lib/node-worker.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = process.env.UMBRA_WORKER_SRC ? path.resolve(process.env.UMBRA_WORKER_SRC) : path.resolve(HERE, '..');
const TMP = path.join(HERE, '.tmp-local');

const SHIFT = Number(process.env.UMBRA_TEST_PORT_SHIFT || 0);
const P = (n) => n + SHIFT;
const PORT = {
  worker: Number(process.env.UMBRA_TEST_WORKER_PORT || 8787),
  stub: P(4773),
  smsgate: P(4770),
  siteWorker: P(4772),
  extraA: P(4776), extraB: P(4777), extraC: P(4778), extraD: P(4779),
};

const ADMIN_KEY = 'test-admin-key-' + crypto.randomBytes(9).toString('hex');
const FAKE = {
  PUSHOVER_TOKEN: 'FAKEpotok' + crypto.randomBytes(8).toString('hex'),
  PUSHOVER_USER: 'FAKEpouser' + crypto.randomBytes(8).toString('hex'),
  TELEGRAM_BOT_TOKEN: '000000:FAKE' + crypto.randomBytes(8).toString('hex'),
  TELEGRAM_CHAT_ID: '-100' + String(crypto.randomInt(1e9)),
  HOOK_SECRET: 'FAKEhook' + crypto.randomBytes(10).toString('hex'),
};
const FAKE_SMSGATE_AUTH = 'FAKEsmsuser' + crypto.randomBytes(5).toString('hex') + ':FAKEsmspass' + crypto.randomBytes(8).toString('hex');
const FAKE_WEBHOOK_KEY = 'FAKEwebhook' + crypto.randomBytes(12).toString('hex');

/* ------------------------------------------------------------- test plumbing (run-all.mjs's, verbatim) */
const suites = new Map();
let current = null;
function suite(name) { current = name; if (!suites.has(name)) suites.set(name, { pass: 0, fail: 0, notes: [] }); }
function ok(cond, label, detail) {
  const s = suites.get(current);
  if (cond) { s.pass++; console.log(`  ✓ ${label}`); }
  else { s.fail++; s.notes.push(label + (detail ? ' — ' + detail : '')); console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
  return Boolean(cond);
}
function eq(a, b, label) { return ok(a === b, label, a === b ? '' : `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (url, init) => {
  const r = await fetch(url, init);
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  return { status: r.status, body, headers: r.headers };
};

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const stub = await captureServer({ port: PORT.stub, tls: false });
  const gate = await smsgateServer({ port: PORT.smsgate });

  const vars = {
    ADMIN_KEY, ...FAKE,
    PUSHOVER_API_BASE: `http://127.0.0.1:${PORT.stub}/pushover`,
    TELEGRAM_API_BASE: `http://127.0.0.1:${PORT.stub}/telegram`,
    FORMSUBMIT_ENDPOINT: `http://127.0.0.1:${PORT.stub}/formsubmit`,
    SITE_BASE_URL: `http://127.0.0.1:${PORT.siteWorker}`,
    PUBLIC_BASE_URL: `http://127.0.0.1:${PORT.worker}`,
    IGNORE_NEXT_ORIGIN: 'true',
    ALLOW_TEST_HOOKS: 'true',
    SMSGATE_AUTH: FAKE_SMSGATE_AUTH,
    SMSGATE_API_BASE: `http://127.0.0.1:${PORT.smsgate}`,
    SMSGATE_WEBHOOK_KEY: FAKE_WEBHOOK_KEY,
    QUOTE_LINK_BASE: `http://127.0.0.1:${PORT.siteWorker}`,
    SEED_LAST_ID: '2',
  };
  console.log(`starting the Worker in Node from ${WORKER_DIR} …`);
  const nw = await startNodeWorker({ workerDir: WORKER_DIR, port: PORT.worker, vars });
  const W = nw.W;
  const SITE = `http://127.0.0.1:${PORT.siteWorker}`;
  const wlogRef = () => nw.log();
  console.log('the Worker is up (stand-in runtime: Node, not wrangler)\n');

  const ONLY = process.env.UMBRA_ONLY ? new Set(process.env.UMBRA_ONLY.split(',').map((x) => x.trim())) : null;
  const want = (letter) => !ONLY || ONLY.has(letter);
  if (ONLY) console.log('UMBRA_ONLY=' + [...ONLY].join(',') + ' — the other suites are skipped');

  const run = async (letter, name, fn) => {
    if (!want(letter)) return;
    try {
      const readings = await fn();
      fs.writeFileSync(path.join(TMP, `${name}-readings.json`), JSON.stringify(readings, null, 2));
    } catch (err) {
      suite(`${letter} · the suite ran to its end`);
      ok(false, `suite ${letter} stopped early — every reading after this point did NOT run`, String(err && err.stack || err).slice(0, 600));
    }
  };

  try {
    await run('D', 'alerts', async () => (await import('./suite-d-alerts.mjs')).suiteAlerts({ W, stub, ADMIN_KEY, FAKE, suite, ok, eq, json, sleep }));
    await run('H', 'book', async () => (await import('./suite-h-book.mjs')).suiteBook({ W, stub, ADMIN_KEY, FAKE, suite, ok, eq, json, sleep, SITE, wlogRef }));
    await run('J', 'reminders', async () => (await import('./suite-j-reminders.mjs')).suiteReminders({ W, stub, gate, ADMIN_KEY, FAKE, FAKE_SMSGATE_AUTH, suite, ok, eq, json, sleep }));
    await run('S', 'seat', async () => (await import('./suite-s-seat.mjs')).suiteSeat({ W, stub, gate, ADMIN_KEY, suite, ok, eq, json, sleep }));
    await run('P', 'phone', async () => (await import('./suite-p-phone.mjs')).suitePhone({ W, stub, gate, ADMIN_KEY, FAKE, FAKE_SMSGATE_AUTH, FAKE_WEBHOOK_KEY, suite, ok, eq, json, sleep }));
    if (fs.existsSync(path.join(HERE, 'suite-c-confirm.mjs'))) {
      await run('C', 'confirm', async () => (await import('./suite-c-confirm.mjs')).suiteConfirm({
        W, stub, gate, ADMIN_KEY, FAKE, FAKE_SMSGATE_AUTH, FAKE_WEBHOOK_KEY, suite, ok, eq, json, sleep, SITE, PORT, TMP, WORKER_DIR, wlogRef,
        /* the no-key Worker: this runtime's own second instance, since there is no wrangler here */
        secondWorker: async (extraVars, port) => startNodeWorker({ workerDir: WORKER_DIR, port, vars: { ...vars, ...extraVars } }),
      }));
    }
  } finally {
    await nw.stop();
    await Promise.all([close(stub), close(gate)]);
  }

  console.log('\n================ RESULTS ================');
  let pass = 0, fail = 0;
  for (const [name, s] of suites) {
    console.log(`${s.fail === 0 ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${s.pass} passed, ${s.fail} failed`);
    for (const n of s.notes) console.log(`        · ${n}`);
    pass += s.pass; fail += s.fail;
  }
  console.log('-----------------------------------------');
  console.log(`TOTAL ${pass} passed, ${fail} failed   (runtime: Node stand-in, not wrangler — see test/lib/node-worker.mjs)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
