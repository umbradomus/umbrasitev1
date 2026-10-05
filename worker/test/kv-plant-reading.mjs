/* KV-FIX-01 · THE PLANT. 2026-10-05. Test-only; nothing here ships.

   The index (store.js, `idx:ladder`) is a CACHE and never the truth. Two ways it can be wrong, and this
   file plants both ON PURPOSE and reads what the alert run does with them:

     PLANT A — THE INDEX IS MISSING A RECORD. A received record written straight to KV by some other hand,
     with the index not updated. A normal minute cannot see it (that is the RED, and the honest cost of
     the fix); the next quarter-hour run LISTs in full, reaches it, and gives it its due step (the GREEN).

     PLANT B — THE INDEX STILL NAMES A RECORD THAT MOVED ON. Quoted straight to KV, so the index still
     lists it (the RED: an index-trusting run would text him about a request he has already quoted). The
     run getRecord()s every member fresh, so it is skipped (the GREEN), and the next full LIST drops it.

   `/__poke/<id>?raw=1` is what writes straight to KV, past putRecord — src/index.js, behind testHookOk.

   Run (from worker/):  node test/kv-plant-reading.mjs
   Ports move with UMBRA_KV_SHIFT (default 62) so it never meets another round on this PC. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureServer, smsgateServer, close } from './lib/servers.mjs';
import { chicagoWall } from '../src/biztime.js';

const WORKER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHIFT = Number(process.env.UMBRA_KV_SHIFT || 62);
const PORT = { worker: 8787 + SHIFT, stub: 4770 + SHIFT, smsgate: 4771 + SHIFT };
for (const p of Object.values(PORT)) {
  if ([4747, 4750, 4177, 4178].includes(p)) throw new Error('port ' + p + ' is reserved on this PC');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN_KEY = 'kvplant-admin-' + crypto.randomBytes(9).toString('hex');
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
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'umbra-kvplant-'));
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
  const cfg = path.join(TMP, 'wrangler.kvplant.toml');
  fs.writeFileSync(cfg, [
    'name = "umbra-intake-kvplant"',
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
    'id = "kvplant-records"',
    '',
    '[[r2_buckets]]',
    'binding = "PHOTOS"',
    'bucket_name = "umbra-job-photos-kvplant"',
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

  const idx = () => jget(W + '/__kv-get?k=' + ADMIN_KEY + '&key=idx:ladder', { method: 'POST' })
    .then((r) => (r.value ? JSON.parse(r.value).ids : null));
  const steps = (r) => JSON.stringify((r.alerts && r.alerts.table && r.alerts.table.sent) || []);
  const show = (label, out) => {
    const o = out.kv_ops || {};
    console.log(label + ' · LIST=' + o.list + ' GET=' + o.get + ' PUT=' + o.put
      + ' · full_list=' + out.full_list + ' · sent=' + JSON.stringify((out.sent || []).map((s) => s.id + '/' + s.step)));
    return out;
  };

  try {
    /* the honest first minute: a quarter-hour run builds the index before anything exists */
    await runAt(CT(9, 45));
    const A = await submitAt(CT(9, 50), 'Plant A');
    const B = await submitAt(CT(9, 51), 'Plant B');
    console.log('scratch records: ' + A + ' (PLANT A) · ' + B + ' (PLANT B)');
    console.log('idx:ladder with both in it: ' + JSON.stringify(await idx()));

    /* PLANT A: quoted through putRecord (the index drops it), then received again STRAIGHT TO KV. */
    await poke(A, { set: { status: 'quoted', quoted_at: CT(9, 55) } });
    console.log('idx:ladder after A was quoted through putRecord: ' + JSON.stringify(await idx()));
    await poke(A, { set: { status: 'received' }, unset: ['quoted_at'] }, true);
    /* PLANT B: quoted STRAIGHT TO KV, so the index still names it. */
    await poke(B, { set: { status: 'quoted', quoted_at: CT(9, 56) } }, true);

    const planted = await idx();
    const ra = await record(A); const rb = await record(B);
    console.log('--- THE PLANT, as it stands at 10:00 ---');
    console.log('idx:ladder: ' + JSON.stringify(planted));
    console.log('KV says: ' + A + ' status=' + ra.status + ' (the index does NOT name it: ' + !planted.includes(A) + ')');
    console.log('KV says: ' + B + ' status=' + rb.status + ' (the index STILL names it: ' + planted.includes(B) + ')');

    console.log('--- RED · 10:07 Chicago, a normal minute: the index is the only thing read ---');
    const red = show('RUN 10:07', await runAt(CT(10, 7)));
    const redA = await record(A); const redB = await record(B);
    console.log('PLANT A · RED: ' + A + ' is not in the index, so the run never sees it · steps sent ' + steps(redA)
      + ' · in the run: ' + JSON.stringify((red.sent || []).some((s) => s.id === A)));
    console.log('PLANT B · RED: the index still names ' + B + ', so the run DOES read it — and the fresh getRecord says status='
      + redB.status + ', so it is skipped · in the run: ' + JSON.stringify((red.sent || []).some((s) => s.id === B)));

    console.log('--- GREEN · 10:15 Chicago, the quarter hour: a full listRecords() ---');
    const green = show('RUN 10:15', await runAt(CT(10, 15)));
    const gA = await record(A); const gB = await record(B);
    console.log('PLANT A · GREEN: ' + A + ' is reached and gets its due step · steps sent ' + steps(gA)
      + ' · in the run: ' + JSON.stringify((green.sent || []).filter((s) => s.id === A).map((s) => s.step + ' ' + JSON.stringify(s.results))));
    console.log('PLANT B · GREEN: ' + B + ' stays quoted and silent · status=' + gB.status
      + ' · in the run: ' + JSON.stringify((green.sent || []).some((s) => s.id === B)));
    const after = await idx();
    console.log('idx:ladder rewritten by the full list: ' + JSON.stringify(after)
      + ' (A in: ' + after.includes(A) + ' · B in: ' + after.includes(B) + ')');
  } finally {
    wrangler.kill('SIGTERM');
    await Promise.all([close(stub), close(gate)]);
    await sleep(300);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* wrangler may still hold a handle */ }
  }
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
