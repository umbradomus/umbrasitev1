/* REPRICE-01 · THE READING FOR CLAUSE 1 — THE ROUTE. 2026-10-05. Test-only; nothing here ships.

   One scratch job, booked BY THE PAGE at $70, exactly like U-0015 was on 10-01. Then the two
   questions the round turns on, asked the same way on the base and on the branch:

     RED on the base — POST /admin/quote/<id> version 2 price 50 answers 409 accepted (QUOTE-API §1:
     a change after booking is a change order, and §12's change order can only ADD), and there is no
     /reprice at all (404). A booked price cannot come down.

     GREEN on the branch — POST /admin/quote/<id>/reprice lowers it once, to a positive number BELOW
     the accepted price, and nothing else moves: no text, no push, no email, the booking, its windows,
     its confirmation and its hold byte-identical. A second identical call answers already:true.

   Every refusal is asked too: equal, higher, zero, negative, a string, a version that is not the
   accepted one, an unknown job. The book row and the whole KV record are printed before and after,
   so the mirror's re-stamp (quote_amount, accept.price) and the one repriced event are read by eye.

   Run (from worker/):  node test/reprice-reading.mjs
   Ports move with UMBRA_REPRICE_SHIFT (default 63) so it never meets another round on this PC. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureServer, smsgateServer, close } from './lib/servers.mjs';
import { chicagoWall } from '../src/biztime.js';

const WORKER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHIFT = Number(process.env.UMBRA_REPRICE_SHIFT || 63);
const PORT = { worker: 8787 + SHIFT, stub: 4770 + SHIFT, smsgate: 4771 + SHIFT, inspector: 9229 + SHIFT };
for (const p of Object.values(PORT)) {
  if ([4747, 4750, 4177, 4178].includes(p)) throw new Error('port ' + p + ' is reserved on this PC');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN_KEY = 'reprice-admin-' + crypto.randomBytes(9).toString('hex');
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
/* December 2026 (CST), so no moment here can meet another suite's bookings */
const CT = (d, h, mi = 0) => new Date(chicagoWall(2026, 12, d, h, mi)).toISOString();
const NOW = CT(1, 10, 0);        /* Tue 2026-12-01, 10:00 AM Central */
const H = (now) => ({ 'content-type': 'application/json', ...(now ? { 'x-umbra-test-now': now } : {}) });

async function call(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch (e) { body = { _text: t.slice(0, 200) }; }
  return { status: r.status, body };
}
const admin = (method, p, body, now) => call(W + p + '?k=' + ADMIN_KEY, {
  method, headers: H(now), body: body === undefined ? undefined : JSON.stringify(body),
});
const record = (id) => call(W + '/__record/' + id + '?k=' + ADMIN_KEY, { method: 'POST' }).then((r) => r.body);
const dump = () => call(W + '/__book-dump?k=' + ADMIN_KEY, { method: 'POST', headers: H(), body: '{}' }).then((r) => r.body);
const parseRow = (q) => (q ? { ...q, body: JSON.parse(q.body_json) } : q);
const bookRow = async (id, version) => parseRow((await dump()).quotes.find((q) => q.job_id === id && q.version === version));
const bookingsOf = async (id) => (await dump()).bookings.filter((b) => b.job_id === id);

let stub = null, gate = null;
/* every way this Worker can reach a human: the owner's push, the owner's Telegram, the customer's
   text through SMSGate, and the e-mail relay. A reprice must add nothing to any of these. */
const sends = () => ({
  pushover: stub.captured.filter((c) => c.method === 'POST' && c.url === '/pushover/1/messages.json').length,
  telegram: stub.captured.filter((c) => c.method === 'POST' && /^\/telegram\/bot[^/]+\/sendMessage$/.test(c.url)).length,
  email: stub.captured.filter((c) => c.method === 'POST' && c.url.startsWith('/formsubmit')).length,
  text: gate.requests.filter((r) => r.method === 'POST' && r.path === '/3rdparty/v1/messages').length,
});
const sendsLine = (s) => 'pushover=' + s.pushover + ' telegram=' + s.telegram + ' email=' + s.email + ' text=' + s.text;

async function submitAt(iso, name, serial) {
  const fd = new FormData();
  fd.set('_subject', 'Service request from umbradomus.com');
  fd.set('_next', 'https://www.umbradomus.com/request-received');
  fd.set('name', name);
  fd.set('phone', '(956) 555-07' + serial);
  fd.set('address', serial + ' Reprice Road, Brownsville');
  fd.set('email', 'customer' + serial + '@example.com');
  fd.set('service', 'Drywall & Paint');
  fd.set('what', name + ' here: one hole over the window.');
  fd.set('email_sent', 'yes');
  fd.set('avail_form', 'v1');
  fd.set('avail_flexible', 'yes');
  fd.set('sms_consent', 'yes');
  fd.set('sms_consent_lang', 'en');
  fd.set('sms_consent_version', 'sms-v2');
  const r = await fetch(W + '/intake', { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
  return new URL(r.headers.get('location')).searchParams.get('id');
}

/* the real customer page, not the hook: the same form the browser posts */
async function bookByPage(code, version, win, iso) {
  const fd = new FormData();
  fd.set('v', String(version));
  if (win !== null) fd.set('w', String(win));
  const r = await fetch(W + '/q/' + code, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
  return { status: r.status, location: r.headers.get('location') };
}

const QUOTE = (version, price, lang) => ({
  version,
  price,
  scope: ['Patch the hole over the window and re-texture to match', 'Prime the patch and spot-paint it, feathered'],
  included: 'Paint for the color match is included. Cleanup included.',
  windows: [{ date: '2026-12-03', start: '08:00', end: '10:00' }, { date: '2026-12-04', start: '10:00', end: '12:00' }],
  lang,
  sent_at: NOW,
});

/* what clause 1 says must not move: the booking, its windows, its confirmation and its hold */
const untouched = (rec, row, bk) => JSON.stringify({
  accept_at: rec.accept && rec.accept.at,
  accept_by: rec.accept && rec.accept.by,
  accept_version: rec.accept && rec.accept.version,
  accept_window: rec.accept && rec.accept.window,
  accept_windows: rec.accept && rec.accept.windows,
  status: rec.status,
  scheduled_at: rec.scheduled_at,
  confirmation: rec.confirmation,
  row_accepted_at: row && row.accepted_at,
  row_hold_until: row && row.hold_until,
  row_cutoff: row && row.cutoff,
  row_sent_at: row && row.sent_at,
  row_state: row && row.state,
  row_body_windows: row && row.body && row.body.windows,
  row_body_options: row && row.body && row.body.options,
  bookings: bk,
}, null, 1);

async function main() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'umbra-reprice-'));
  stub = await captureServer({ port: PORT.stub, tls: false });
  gate = await smsgateServer({ port: PORT.smsgate });
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
  const cfg = path.join(TMP, 'wrangler.reprice.toml');
  fs.writeFileSync(cfg, [
    'name = "umbra-intake-reprice"',
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
    'id = "reprice-records"',
    '',
    '[[r2_buckets]]',
    'binding = "PHOTOS"',
    'bucket_name = "umbra-job-photos-reprice"',
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
    '--inspector-port', String(PORT.inspector), '--local', '--log-level', 'warn',
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

  try {
    console.log('=== THE SCRATCH JOB, booked by the page at $70 (U-0015 was booked this way on 10-01) ===');
    const A = await submitAt(NOW, 'Reprice Scratch', '11');
    const c = await admin('POST', '/admin/quote/' + A, QUOTE(1, 70, 'en'), NOW);
    const code = c.body.code;
    console.log('job ' + A + ' · quote v1 price 70 → ' + c.status + ' · hold_until ' + c.body.hold_until + ' · cutoff ' + c.body.cutoff);
    const booked = await bookByPage(code, 1, 1, CT(1, 10, 5));
    console.log('POST /q/<code> v=1 w=1 (the customer\'s own form) → ' + booked.status + ' ' + booked.location);
    const st0 = await admin('GET', '/admin/quote/' + A, undefined, CT(1, 10, 6));
    const rec0 = await record(A);
    const row0 = await bookRow(A, 1);
    console.log('state → ' + st0.body.current.status + ' · current.price ' + (st0.body.current && st0.body.current.price)
      + ' · current.price_was ' + JSON.stringify(st0.body.current && st0.body.current.price_was));
    console.log('KV → quote_amount ' + rec0.quote_amount + ' · accept.price ' + (rec0.accept && rec0.accept.price)
      + ' · quote.price ' + (rec0.quote && rec0.quote.price) + ' · status ' + rec0.status);
    console.log('BOOK row v1 → body.price ' + row0.body.price + ' · body.price_was ' + JSON.stringify(row0.body.price_was)
      + ' · status ' + row0.status + ' · state_version ' + row0.state_version);
    console.log('confirmation → ' + JSON.stringify(rec0.confirmation));
    const sends0 = sendsLine(sends());
    console.log('sends so far (the booking\'s own, which the reprice must not add to): ' + sends0);

    /* a second scratch job, quoted and sent but NEVER accepted — for 409 not_accepted */
    const B = await submitAt(NOW, 'Reprice Unbooked', '12');
    const cb = await admin('POST', '/admin/quote/' + B, QUOTE(1, 70, 'en'), NOW);
    console.log('job ' + B + ' · quote v1 price 70, sent, never accepted → ' + cb.status);
    console.log('sends after that second quote went out: ' + sendsLine(sends()));

    /* a third scratch job, booked by the page at $70 and NEVER repriced: the equal, the higher and the
       malformed prices are asked on this one, where the row still carries the price he booked at */
    const Cj = await submitAt(NOW, 'Reprice Spare', '13');
    const qc = QUOTE(1, 70, 'en');
    /* its own two dates: the first job already holds 12-03 08:00, and one crew cannot be in two places */
    qc.windows = [{ date: '2026-12-08', start: '08:00', end: '10:00' }, { date: '2026-12-09', start: '10:00', end: '12:00' }];
    const cc = await admin('POST', '/admin/quote/' + Cj, qc, NOW);
    const bookedC = await bookByPage(cc.body.code, 1, 1, CT(1, 10, 7));
    const rowC0 = await bookRow(Cj, 1);
    console.log('job ' + Cj + ' · a third job, quoted ' + cc.status + ' and booked by the page ' + bookedC.status
      + ' at $70, never repriced → price ' + rowC0.body.price + ' · status ' + rowC0.status);
    console.log('sends after that third job was quoted and booked: ' + sendsLine(sends()));

    console.log('');
    console.log('=== THE TWO QUESTIONS ===');
    const q1 = await admin('POST', '/admin/quote/' + A, QUOTE(2, 50, 'en'), CT(1, 10, 10));
    console.log('Q1 · POST /admin/quote/' + A + ' version 2 price 50 → ' + q1.status + ' ' + JSON.stringify(q1.body));
    const sendsPre = sendsLine(sends());
    console.log('THE BASELINE · sends immediately before the reprice call: ' + sendsPre);
    const q2 = await admin('POST', '/admin/quote/' + A + '/reprice', { version: 1, price: 50 }, CT(1, 10, 11));
    console.log('Q2 · POST /admin/quote/' + A + '/reprice {"version":1,"price":50} → ' + q2.status + ' ' + JSON.stringify(q2.body));
    const afterQ = await record(A);
    console.log('after both: KV quote_amount ' + afterQ.quote_amount + ' · accept.price ' + (afterQ.accept && afterQ.accept.price)
      + ' · sends ' + sendsLine(sends()));

    if (q2.status === 404) {
      console.log('');
      console.log('RED: there is no /reprice (404), and §1 refuses a lower version 2 with 409 accepted.');
      console.log('A booked quote\'s price cannot be lowered. U-0015 would read $70 after "it is 50 dollars".');
      return;
    }

    /* ---------------------------------------------------------------- GREEN */
    console.log('');
    console.log('=== GREEN · WHAT THE ROUTE DID ===');
    const rec1 = await record(A);
    const row1 = await bookRow(A, 1);
    const st1 = await admin('GET', '/admin/quote/' + A, undefined, CT(1, 10, 12));
    console.log('BOOK row v1 → body.price ' + row1.body.price + ' · body.price_was ' + JSON.stringify(row1.body.price_was)
      + ' · state_version ' + row0.state_version + ' → ' + row1.state_version);
    console.log('KV mirror  → quote_amount ' + rec0.quote_amount + ' → ' + rec1.quote_amount
      + ' · accept.price ' + rec0.accept.price + ' → ' + rec1.accept.price
      + ' · quote.price ' + rec0.quote.price + ' → ' + rec1.quote.price);
    console.log('GET /admin/quote/<id> → current.price ' + st1.body.current.price
      + ' · current.price_was ' + JSON.stringify(st1.body.current.price_was));
    console.log('the repriced events on the record: ' + JSON.stringify((rec1.events || []).filter((e) => e.type === 'repriced')));
    console.log('every event the reprice added: ' + JSON.stringify((rec1.events || []).slice((rec0.events || []).length)));
    console.log('NO SEND · ' + sendsPre + ' → ' + sendsLine(sends()) + ' (unchanged: ' + (sendsPre === sendsLine(sends())) + ')');
    const u0 = untouched(rec0, row0, await bookingsOf(A));
    const u1 = untouched(rec1, row1, await bookingsOf(A));
    console.log('the booking, its windows, its confirmation and its hold, byte-identical: ' + (u0 === u1));
    if (u0 !== u1) { console.log('BEFORE ' + u0); console.log('AFTER  ' + u1); }

    console.log('');
    console.log('=== AGAIN, THE SAME CALL (once means once) ===');
    const again = await admin('POST', '/admin/quote/' + A + '/reprice', { version: 1, price: 50 }, CT(1, 10, 13));
    const rec2 = await record(A);
    const row2 = await bookRow(A, 1);
    console.log('→ ' + again.status + ' ' + JSON.stringify(again.body));
    console.log('state_version ' + row1.state_version + ' → ' + row2.state_version
      + ' · price_was ' + JSON.stringify(row2.body.price_was)
      + ' · repriced events ' + (rec2.events || []).filter((e) => e.type === 'repriced').length
      + ' · sends ' + sendsLine(sends()));
    console.log('nothing written: ' + (row1.state_version === row2.state_version && JSON.stringify(rec1) === JSON.stringify(rec2)));

    console.log('');
    console.log('=== EVERY REFUSAL ===');
    const refusals = [
      ['equal to the booked price', Cj, { version: 1, price: 70 }],
      ['higher than the booked price', Cj, { version: 1, price: 80 }],
      ['zero', Cj, { version: 1, price: 0 }],
      ['negative', Cj, { version: 1, price: -5 }],
      ['a string', Cj, { version: 1, price: '45' }],
      ['no price at all', Cj, { version: 1 }],
      ['lower AGAIN on the one already lowered (once means once)', A, { version: 1, price: 45 }],
      ['a version this job never had', A, { version: 2, price: 40 }],
      ['a job with no accepted version', B, { version: 1, price: 40 }],
      ['an unknown job', 'U-9999', { version: 1, price: 40 }],
    ];
    for (const [why, id, body] of refusals) {
      const r = await admin('POST', '/admin/quote/' + id + '/reprice', body, CT(1, 10, 20));
      console.log(String(r.status).padEnd(4) + JSON.stringify(body).padEnd(34) + ' ' + why + ' → ' + JSON.stringify(r.body));
    }
    const rec3 = await record(A);
    const row3 = await bookRow(A, 1);
    const rowC1 = await bookRow(Cj, 1);
    console.log('after every refusal: price ' + row3.body.price + ' · price_was ' + JSON.stringify(row3.body.price_was)
      + ' · state_version ' + row3.state_version + ' · sends ' + sendsLine(sends()));
    console.log('the record is where the one reprice left it: ' + (JSON.stringify(rec1) === JSON.stringify(rec3)));
    console.log('the refused job ' + Cj + ' never moved: price ' + rowC1.body.price + ' · price_was '
      + JSON.stringify(rowC1.body.price_was) + ' · state_version ' + rowC0.state_version + ' → ' + rowC1.state_version
      + ' · row byte-identical: ' + (JSON.stringify(rowC0) === JSON.stringify(rowC1)));

    console.log('');
    console.log('=== THE RECONCILE DOES NOT UNDO IT (the 5-minute heal reads the book) ===');
    await call(W + '/__reconcile?k=' + ADMIN_KEY, { method: 'POST', headers: H(CT(1, 10, 30)), body: '{}' });
    const rec4 = await record(A);
    console.log('after reconcile: quote_amount ' + rec4.quote_amount + ' · accept.price ' + rec4.accept.price
      + ' · sends ' + sendsLine(sends()));
  } finally {
    wrangler.kill('SIGTERM');
    await Promise.all([close(stub), close(gate)]);
    await sleep(300);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* wrangler may still hold a handle */ }
  }
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
