/* KV-FIX-01 · THE READING THAT COUNTS KV OPERATIONS. 2026-10-05.
   Test-only. Nothing here ships and nothing here is reached by the deployed Worker.

   WHY. The account is on Workers FREE: 1,000 KV LIST operations per UTC day. The cron runs every minute
   and `runAlerts()` LISTed KV on every one of the 840 open minutes a day. This file is the instrument that
   reads what ONE alert run spends: it stands up a real `wrangler dev` (local KV, R2 and the SQLite Durable
   Object) with fake Pushover / Telegram / SMSGate, writes three scratch records — one received on HIS
   TABLE, one quoted, one done — and drives the alert run through the gated hook POST /__run-alerts with
   `?count=1`, which runs the body against a counting stand-in for the RECORDS binding and returns the ops.

   THE DRIVER IS THE /__run-alerts HOOK (src/index.js), not a suite's own harness: the counting proxy lives
   inside that hook, so the run under the proxy is the same function the cron calls, byte for byte.

   Run (from worker/):  node test/kv-ops-reading.mjs
   Ports move with UMBRA_KV_SHIFT (default 60) so it never meets another round on this PC. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureServer, smsgateServer, close } from './lib/servers.mjs';
import { chicagoWall } from '../src/biztime.js';

const WORKER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHIFT = Number(process.env.UMBRA_KV_SHIFT || 60);
const PORT = { worker: 8787 + SHIFT, stub: 4770 + SHIFT, smsgate: 4771 + SHIFT };
for (const p of Object.values(PORT)) {
  if ([4747, 4750, 4177, 4178].includes(p)) throw new Error('port ' + p + ' is reserved on this PC');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN_KEY = 'kvfix-admin-' + crypto.randomBytes(9).toString('hex');
const FAKE = {
  PUSHOVER_TOKEN: 'FAKEpo' + crypto.randomBytes(8).toString('hex'),
  PUSHOVER_USER: 'FAKEpu' + crypto.randomBytes(8).toString('hex'),
  TELEGRAM_BOT_TOKEN: '000000:FAKE' + crypto.randomBytes(8).toString('hex'),
  TELEGRAM_CHAT_ID: '-1001234567890',
  HOOK_SECRET: 'FAKEhook' + crypto.randomBytes(8).toString('hex'),
};
const FAKE_SMSGATE_AUTH = 'FAKEsmsuser' + crypto.randomBytes(5).toString('hex') + ':FAKEsmspass' + crypto.randomBytes(8).toString('hex');
const FAKE_WEBHOOK_KEY = 'FAKEwebhook' + crypto.randomBytes(12).toString('hex');

const W = 'http://127.0.0.1:' + PORT.worker;
const CT = (h, mi) => new Date(chicagoWall(2026, 10, 6, h, mi)).toISOString();
const jget = async (u, o) => {
  const r = await fetch(u, o);
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { return { http: r.status, text: t }; }
};
const runAt = (iso) => jget(W + '/__run-alerts?k=' + ADMIN_KEY + '&count=1&now=' + encodeURIComponent(iso), { method: 'POST' });

async function submitAt(iso, name) {
  const fd = new FormData();
  fd.set('_subject', 'Service request from umbradomus.com');
  fd.set('_next', 'https://www.umbradomus.com/request-received');
  fd.set('name', name);
  fd.set('phone', '(956) 555-0142');
  fd.set('address', '742 Evergreen Terrace, Brownsville');
  fd.set('email', 'customer@example.com');
  fd.set('service', 'Drywall & Paint');
  fd.set('what', name + ' here: two holes in the hallway ceiling.');
  const r = await fetch(W + '/intake', { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
  const loc = new URL(r.headers.get('location'));
  return loc.searchParams.get('id');
}
const poke = (id, body, raw) => jget(W + '/__poke/' + id + '?k=' + ADMIN_KEY + (raw ? '&raw=1' : ''), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const record = (id) => jget(W + '/__record/' + id + '?k=' + ADMIN_KEY, { method: 'POST' });

async function main() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'umbra-kvfix-'));
  const stub = await captureServer({ port: PORT.stub, tls: false });
  const gate = await smsgateServer({ port: PORT.smsgate });
  fs.writeFileSync(path.join(TMP, '.dev.vars'), [
    'ADMIN_KEY=' + ADMIN_KEY,
    ...Object.entries(FAKE).map(([k, v]) => k + '=' + v),
    'PUSHOVER_API_BASE=http://127.0.0.1:' + PORT.stub + '/pushover',
    'TELEGRAM_API_BASE=http://127.0.0.1:' + PORT.stub + '/telegram',
    'FORMSUBMIT_ENDPOINT=http://127.0.0.1:' + PORT.stub + '/formsubmit',
    'SITE_BASE_URL=http://127.0.0.1:' + PORT.stub,
    'PUBLIC_BASE_URL=' + W,
    'IGNORE_NEXT_ORIGIN=true',
    'ALLOW_TEST_HOOKS=true',
    'SMSGATE_AUTH=' + FAKE_SMSGATE_AUTH,
    'SMSGATE_API_BASE=http://127.0.0.1:' + PORT.smsgate,
    'SMSGATE_WEBHOOK_KEY=' + FAKE_WEBHOOK_KEY,
    'QUOTE_LINK_BASE=http://127.0.0.1:' + PORT.stub,
    '',
  ].join('\n'));
  const cfg = path.join(TMP, 'wrangler.kvfix.toml');
  fs.writeFileSync(cfg, [
    'name = "umbra-intake-kvfix"',
    'main = ' + JSON.stringify(path.join(WORKER_DIR, 'src', 'index.js')),
    'base_dir = ' + JSON.stringify(WORKER_DIR),
    'compatibility_date = "2025-06-01"',
    'rules = [ { type = "Text", globs = ["**/*.html"], fallthrough = false } ]',
    '',
    '[vars]',
    'SEED_LAST_ID = "2"',
    '',
    '[[kv_namespaces]]',
    'binding = "RECORDS"',
    'id = "kvfix-records"',
    '',
    '[[r2_buckets]]',
    'binding = "PHOTOS"',
    'bucket_name = "umbra-job-photos-kvfix"',
    '',
    '[[durable_objects.bindings]]',
    'name = "BOOK"',
    'class_name = "QuoteBook"',
    '',
    '[[migrations]]',
    'tag = "v1"',
    'new_sqlite_classes = ["QuoteBook"]',
    '',
  ].join('\n'));
  const wrangler = spawn(process.execPath, [
    path.join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'dev', '--config', cfg, '--port', String(PORT.worker), '--ip', '127.0.0.1',
    '--inspector-port', String(9229 + SHIFT), '--local', '--log-level', 'warn',
    '--persist-to', path.join(TMP, 'wrangler-state'),
  ], {
    cwd: WORKER_DIR,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let wlog = '';
  wrangler.stdout.on('data', (d) => { wlog += d; });
  wrangler.stderr.on('data', (d) => { wlog += d; });
  let up = false;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(W + '/health'); if (r.ok) { up = true; break; } } catch (e) { /* not up yet */ }
    await sleep(500);
  }
  if (!up) { console.error(wlog); throw new Error('wrangler dev did not come up'); }

  const show = (label, out) => {
    const o = out.kv_ops || {};
    console.log(label + ' · LIST=' + o.list + ' GET=' + o.get + ' PUT=' + o.put + ' DELETE=' + o.delete
      + ' · full_list=' + (out.full_list === undefined ? 'n/a' : out.full_list)
      + ' · sent=' + JSON.stringify(out.sent) + ' · summary=' + (out.summary ? 'fired' : 'null'));
  };
  const idx = () => jget(W + '/__kv-get?k=' + ADMIN_KEY + '&key=idx:ladder', { method: 'POST' })
    .then((r) => JSON.stringify(r.value));

  try {
    /* THE BOOTSTRAP: the first quarter-hour run, before any record exists. This is what the deployed
       Worker does on its own first :00/:15/:30/:45 minute — it LISTs and writes the index. On the base
       this run costs the same one LIST and there is no index for it to write. */
    show('BOOTSTRAP RUN 09:45 Chicago', await runAt(CT(9, 45)));
    console.log('idx:ladder after the bootstrap: ' + (await idx()));

    /* three scratch records: one received on HIS TABLE, one quoted, one done */
    const A = await submitAt(CT(9, 50), 'Scratch Table');
    const B = await submitAt(CT(9, 51), 'Scratch Quoted');
    const C = await submitAt(CT(9, 52), 'Scratch Done');
    await poke(B, { set: { status: 'quoted', quoted_at: CT(9, 55) } });
    await poke(C, { set: { status: 'done', done_at: CT(9, 56) } });
    console.log('scratch records: ' + A + ' received/table · ' + B + ' quoted · ' + C + ' done');
    console.log('idx:ladder before the runs: ' + (await idx()));

    for (const [h, mi] of [[10, 7], [10, 15]]) {
      show('RUN ' + String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ' Chicago', await runAt(CT(h, mi)));
    }
    console.log('idx:ladder after the runs:  ' + (await idx()));
    const a = await record(A);
    console.log('the table record after the runs: status=' + a.status + ' stage=' + (a.alerts && a.alerts.stage) + ' steps_sent=' + JSON.stringify(a.alerts && a.alerts.table && a.alerts.table.sent));
  } finally {
    wrangler.kill('SIGTERM');
    await Promise.all([close(stub), close(gate)]);
    await sleep(300);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* wrangler may still hold a handle */ }
  }
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
