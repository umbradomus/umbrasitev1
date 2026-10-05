/* REPRICE-01 · THE READING FOR THE SECOND READER'S ONE AT-THE-BAR FINDING. 2026-10-05. Test-only.

   R88 (SECOND-READER-REPRICE-01.md, finding 1) read the diff and said: a change order carries the price
   the customer booked at inside its own `base`, and `total = base + price`; nothing ever recomputes them,
   and the lowering writes the quote row only. So on a job that already holds a change order the customer's
   CHANGE PAGE keeps reading "Your quote was $70" / "Su cotizacion era de $70" and a total of $100 after the
   price has been lowered to $50, and GET /api/job carries that same stale total. That falsifies the round's
   own words — clause 2's "the old price nowhere on the customer's pages" — on exactly that shape of job.

   This reading asks it on a running Worker, RED first:

     RED  (the branch as clause 1 and clause 2 left it) — job booked at $70, change order base 70 / add 30 /
     total 100, sent. Lower to $50: 200 repriced. The change page still reads $70 and $100, in both
     languages, and /api/job answers quote_amount 50 beside changes[0].total 100.

     GREEN (with the guard) — the same call answers 422 with a plain reason while a change order stands;
     the record and the book row come back byte-identical, and the customer's pages never see a number the
     book disagrees with. A job with no change order still lowers, and so does a job whose only change order
     has been WITHDRAWN (a withdrawn change shows the customer no price at all — page.js changePage()
     returns the withdrawn words before the ticket, and customerChanges() drops it).

   Run (from worker/):  node test/reprice-change.mjs
   Ports move with UMBRA_RPCHG_SHIFT (default 67) so it never meets another round on this PC. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureServer, smsgateServer, close } from './lib/servers.mjs';
import { chicagoWall } from '../src/biztime.js';

const WORKER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHIFT = Number(process.env.UMBRA_RPCHG_SHIFT || 67);
const PORT = { worker: 8787 + SHIFT, stub: 4770 + SHIFT, smsgate: 4771 + SHIFT, inspector: 9229 + SHIFT };
for (const p of Object.values(PORT)) {
  if ([4747, 4750, 4177, 4178].includes(p)) throw new Error('port ' + p + ' is reserved on this PC');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN_KEY = 'rpchg-admin-' + crypto.randomBytes(9).toString('hex');
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
const CT = (d, h, mi = 0) => new Date(chicagoWall(2026, 12, d, h, mi)).toISOString();
const NOW = CT(1, 10, 0);
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

/* the customer's own change page, fetched the way a browser does */
async function html(url, now) {
  const r = await fetch(url, { headers: now ? { 'x-umbra-test-now': now } : {} });
  return { status: r.status, text: await r.text() };
}
/* every dollar figure the page prints, in order */
const dollars = (t) => (t.replace(/<[^>]*>/g, ' ').match(/\$[\d,]+(?:\.\d\d)?/g) || []);

let stub = null, gate = null;
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
  fd.set('phone', '(956) 555-08' + serial);
  fd.set('address', serial + ' Change Road, Brownsville');
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

async function bookByPage(code, version, win, iso) {
  const fd = new FormData();
  fd.set('v', String(version));
  if (win !== null) fd.set('w', String(win));
  const r = await fetch(W + '/q/' + code, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
  return { status: r.status, location: r.headers.get('location') };
}

const QUOTE = (version, price, lang, windows) => ({
  version, price,
  scope: ['Patch the hole over the window and re-texture to match', 'Prime the patch and spot-paint it, feathered'],
  included: 'Paint for the color match is included. Cleanup included.',
  windows, lang, sent_at: NOW,
});
const CHANGE = (n, lang) => ({
  kind: 'change', version: n, lang,
  what: lang === 'es' ? 'Pintar todo el techo' : 'Roll the whole ceiling',
  scope: ['Paint the whole ceiling', 'Ceiling paint, 1 gal'],
  price: 30, base: 70, total: 100, sent_at: NOW,
});

/* one booked job at $70 with a change order on it, sent; returns everything the reading needs */
async function jobWithChange(serial, name, lang, days, iso) {
  const id = await submitAt(NOW, name, serial);
  const q = await admin('POST', '/admin/quote/' + id, QUOTE(1, 70, lang, [
    { date: '2026-12-' + days[0], start: '08:00', end: '10:00' },
    { date: '2026-12-' + days[1], start: '10:00', end: '12:00' },
  ]), NOW);
  const booked = await bookByPage(q.body.code, 1, 1, iso);
  const ch = await admin('POST', '/admin/quote/' + id, CHANGE(1, lang), iso);
  const rec = await record(id);
  return { id, lang, quoted: q.status, booked: booked.status, change: ch.status, changeUrl: ch.body.url, code: ch.body.code,
    token: rec.token, apiUrl: W + '/api/job/' + id + '?t=' + encodeURIComponent(rec.token) };
}

async function readCustomer(j, when, now) {
  const page = await html(W + '/q/' + j.code, now);
  const api = await call(j.apiUrl, { headers: { } });
  const ch = (api.body.changes || [])[0] || null;
  console.log('  ' + when.padEnd(6) + j.lang.toUpperCase() + ' change page ' + page.status
    + ' · every $ on it: ' + JSON.stringify(dollars(page.text))
    + ' · the "was" line: ' + JSON.stringify((page.text.replace(/<[^>]*>/g, ' ').match(/(?:Your quote was|Su cotizaci[^ ]*n era de) \$[\d,.]+/g) || [])));
  console.log('         /api/job → quote_amount ' + api.body.quote_amount
    + ' · changes[0] ' + JSON.stringify(ch && { n: ch.n, price: ch.price, total: ch.total, state: ch.state })
    + ' · the whole payload reads "70" anywhere: ' + /(^|[^\d])70([^\d]|$)/.test(JSON.stringify(api.body)));
  return { page: page.text, api: api.body };
}

async function main() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'umbra-rpchg-'));
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
    'QUOTE_LINK_BASE=' + W,
    '',
  ].join('\n'));
  const cfg = path.join(TMP, 'wrangler.rpchg.toml');
  fs.writeFileSync(cfg, [
    'name = "umbra-intake-rpchg"',
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
    'id = "rpchg-records"',
    '',
    '[[r2_buckets]]',
    'binding = "PHOTOS"',
    'bucket_name = "umbra-job-photos-rpchg"',
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
    console.log('=== THE SHAPE R88 NAMED: booked at $70, then a change order base 70 / adds 30 / total 100 ===');
    const EN = await jobWithChange('21', 'Change Scratch EN', 'en', ['03', '04'], CT(1, 10, 5));
    const ES = await jobWithChange('22', 'Change Scratch ES', 'es', ['08', '09'], CT(1, 10, 6));
    for (const j of [EN, ES]) {
      console.log(j.lang.toUpperCase() + ' · ' + j.id + ' · quoted ' + j.quoted + ' · booked by the page ' + j.booked
        + ' · change order ' + j.change + ' · its page ' + j.changeUrl);
    }
    /* a job with NO change order, and a job whose only change order is WITHDRAWN: the lowering must still work */
    const PLAIN = await submitAt(NOW, 'Change None', '23');
    const pq = await admin('POST', '/admin/quote/' + PLAIN, QUOTE(1, 70, 'en', [
      { date: '2026-12-10', start: '08:00', end: '10:00' }, { date: '2026-12-11', start: '10:00', end: '12:00' }]), NOW);
    const pb = await bookByPage(pq.body.code, 1, 1, CT(1, 10, 7));
    console.log('PLAIN · ' + PLAIN + ' · quoted ' + pq.status + ' · booked ' + pb.status + ' · no change order');
    const GONE = await jobWithChange('24', 'Change Gone', 'en', ['14', '15'], CT(1, 10, 8));
    const wd = await admin('POST', '/admin/quote/' + GONE.id + '/cancel', { kind: 'change', version: 1 }, CT(1, 10, 9));
    console.log('GONE  · ' + GONE.id + ' · its one change order withdrawn → ' + wd.status + ' ' + JSON.stringify(wd.body));

    console.log('');
    console.log('=== WHAT THE CUSTOMER READS BEFORE ANY LOWERING ===');
    const before = {};
    for (const j of [EN, ES]) before[j.id] = await readCustomer(j, 'BEFORE', CT(1, 10, 10));

    const pre = sendsLine(sends());
    console.log('');
    console.log('THE BASELINE · sends immediately before the lowering: ' + pre);
    const rec0 = { [EN.id]: await record(EN.id), [ES.id]: await record(ES.id) };
    const row0 = { [EN.id]: await bookRow(EN.id, 1), [ES.id]: await bookRow(ES.id, 1) };

    console.log('');
    console.log('=== THE LOWERING, ON A JOB THAT HOLDS A CHANGE ORDER ===');
    const answers = {};
    for (const j of [EN, ES]) {
      const r = await admin('POST', '/admin/quote/' + j.id + '/reprice', { version: 1, price: 50 }, CT(1, 10, 11));
      answers[j.id] = r;
      console.log(j.lang.toUpperCase() + ' · POST /admin/quote/' + j.id + '/reprice {"version":1,"price":50} → '
        + r.status + ' ' + JSON.stringify(r.body));
    }

    console.log('');
    console.log('=== WHAT THE CUSTOMER READS AFTER IT ===');
    for (const j of [EN, ES]) await readCustomer(j, 'AFTER', CT(1, 10, 12));
    console.log('NO SEND · ' + pre + ' → ' + sendsLine(sends()) + ' (unchanged: ' + (pre === sendsLine(sends())) + ')');

    const lowered = answers[EN.id].status === 200;
    console.log('');
    if (lowered) {
      console.log('=== RED ===');
      for (const j of [EN, ES]) {
        const row = await bookRow(j.id, 1), rec = await record(j.id);
        const ch = (rec.changes || [])[0] || {};
        console.log(j.lang.toUpperCase() + ' · the book says price ' + row.body.price + ' (was ' + row.body.price_was
          + ') · the change row still says base ' + ch.base + ' total ' + ch.total
          + ' · the page the customer holds still prints the old ' + ch.base + '.');
      }
      console.log('The price came down and the customer\'s change page did not. Clause 2 asks for "the old price');
      console.log('nowhere on the customer\'s pages"; on this shape of job it is in two places, in both languages.');
      return;
    }

    /* ------------------------------------------------------------------ GREEN */
    console.log('=== GREEN · THE LOWERING IS REFUSED WHILE A CHANGE ORDER STANDS ===');
    for (const j of [EN, ES]) {
      const rec1 = await record(j.id), row1 = await bookRow(j.id, 1);
      console.log(j.lang.toUpperCase() + ' · ' + answers[j.id].status + ' ' + JSON.stringify(answers[j.id].body));
      console.log('       the record byte-identical: ' + (JSON.stringify(rec0[j.id]) === JSON.stringify(rec1))
        + ' · the book row byte-identical: ' + (JSON.stringify(row0[j.id]) === JSON.stringify(row1))
        + ' · price ' + row1.body.price + ' · price_was ' + JSON.stringify(row1.body.price_was)
        + ' · state_version ' + row0[j.id].state_version + ' → ' + row1.state_version);
    }
    console.log('Nothing was lowered, so nothing the customer holds can disagree with the book.');

    console.log('');
    console.log('=== AND THE ORDINARY JOB STILL LOWERS ===');
    const pl = await admin('POST', '/admin/quote/' + PLAIN + '/reprice', { version: 1, price: 50 }, CT(1, 10, 13));
    const plRow = await bookRow(PLAIN, 1);
    console.log('no change order  · ' + PLAIN + ' → ' + pl.status + ' ' + JSON.stringify(pl.body)
      + ' · book price ' + plRow.body.price + ' · price_was ' + JSON.stringify(plRow.body.price_was));
    const gn = await admin('POST', '/admin/quote/' + GONE.id + '/reprice', { version: 1, price: 50 }, CT(1, 10, 14));
    const gnRow = await bookRow(GONE.id, 1);
    const gnPage = await html(W + '/q/' + GONE.code, CT(1, 10, 15));
    const gnApi = await call(GONE.apiUrl, {});
    console.log('withdrawn change · ' + GONE.id + ' → ' + gn.status + ' ' + JSON.stringify(gn.body)
      + ' · book price ' + gnRow.body.price + ' · price_was ' + JSON.stringify(gnRow.body.price_was));
    console.log('       its withdrawn change page shows the customer no price at all: ' + JSON.stringify(dollars(gnPage.text))
      + ' · /api/job changes: ' + JSON.stringify(gnApi.body.changes || null)
      + ' · quote_amount ' + gnApi.body.quote_amount);

    console.log('');
    console.log('=== THE REFUSAL IS A REFUSAL: a change order raised AFTER a lowering is left alone ===');
    const after = await admin('POST', '/admin/quote/' + PLAIN, CHANGE(1, 'en'), CT(1, 10, 16));
    const afterRec = await record(PLAIN);
    const afterCh = (afterRec.changes || [])[0] || {};
    console.log('a change order on the already-lowered job → ' + after.status
      + ' · base ' + afterCh.base + ' total ' + afterCh.total + ' (his side\'s own numbers, not the reprice\'s)');
    const again = await admin('POST', '/admin/quote/' + PLAIN + '/reprice', { version: 1, price: 50 }, CT(1, 10, 17));
    console.log('and the identical lowering asked again, now that it holds one → ' + again.status + ' ' + JSON.stringify(again.body));
    console.log('(once means once comes first: an identical repeat still answers already:true and writes nothing)');
    console.log('');
    console.log('NO SEND, whole reading · ' + pre + ' → ' + sendsLine(sends()));
  } finally {
    wrangler.kill('SIGTERM');
    await Promise.all([close(stub), close(gate)]);
    await sleep(300);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* wrangler may still hold a handle */ }
  }
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
