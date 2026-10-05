/* SITE-FIX-03 · THE READINGS. The real `wrangler dev` with the book running locally, the site copy playing
   vercel.json's /q/* rewrite, the FormSubmit/Pushover/Telegram stub, and one real headless Chrome.
   Item 1 · THE BOOKED SCREEN — after a booking through the real route, is there ONE line carrying the
            day, the window and the price, and does the page promise the text the day before?
   Item 2 · THE CONFIRMATION EMAIL — what the mail stub recorded on that booking.
   Its own ports (4954 worker / 4955 stub / 4956 site / 9264 inspector), started and stopped by itself.
   Nothing else on this PC is touched; never 4747, 4750, 4177.
   Run: node tools/site-fix-03-read.mjs [ITEM]   ITEM = 1|2|plant1 (default: all) */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from './../worker/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { captureServer, staticServer, close } from './../worker/test/lib/servers.mjs';
import { chicagoWall } from './../worker/src/biztime.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(REPO, 'worker');
const BRIDGE = 'C:/Users/andre/Umbra/Boss/Bridge/SITE-FIX-03';
const SHOTS = BRIDGE + '/screens';
const PORT = { worker: 4954, stub: 4955, site: 4956, inspector: 9264 };
const ONLY = (process.argv[2] || '').trim();
const STAGE = process.env.SF03_STAGE || 'base';
const want = (n) => !ONLY || ONLY.split(',').map((x) => x.trim()).includes(n);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'site-fix-03-'));
const ADMIN_KEY = 'sf03-' + crypto.randomBytes(8).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf = process.env.ProgramFiles || 'C:\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const c = [path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')].find((x) => fs.existsSync(x));
  if (!c) throw new Error('no Chrome');
  return c;
}

/* ------------------------------------------------------------------ the servers */
const stub = await captureServer({ port: PORT.stub, tls: false });
const site = await staticServer({ port: PORT.site, root: REPO, proxy: 'http://127.0.0.1:' + PORT.worker });
const SITE = 'http://127.0.0.1:' + PORT.site;
const W = 'http://127.0.0.1:' + PORT.worker;

fs.writeFileSync(path.join(TMP, '.dev.vars'), [
  'ADMIN_KEY=' + ADMIN_KEY,
  'PUSHOVER_TOKEN=fake-sf03-token',
  'PUSHOVER_USER=fake-sf03-user',
  'TELEGRAM_BOT_TOKEN=fake-sf03-bot',
  'TELEGRAM_CHAT_ID=-100123',
  'PUSHOVER_API_BASE=http://127.0.0.1:' + PORT.stub + '/pushover',
  'TELEGRAM_API_BASE=http://127.0.0.1:' + PORT.stub + '/telegram',
  'FORMSUBMIT_ENDPOINT=http://127.0.0.1:' + PORT.stub + '/formsubmit',
  'SITE_BASE_URL=' + SITE,
  'PUBLIC_BASE_URL=' + W,
  'QUOTE_LINK_BASE=' + SITE,
  'IGNORE_NEXT_ORIGIN=true',
  'ALLOW_TEST_HOOKS=true',
  '',
].join('\n'));

const cfg = path.join(TMP, 'wrangler.sf03.toml');
fs.writeFileSync(cfg, [
  'name = "umbra-intake-sf03"',
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
  'id = "sf03-records"',
  '',
  '[[r2_buckets]]',
  'binding = "PHOTOS"',
  'bucket_name = "umbra-job-photos-sf03"',
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

console.log('starting wrangler dev on ' + PORT.worker + ' ...');
const wrangler = spawn(process.execPath, [
  path.join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  'dev', '--config', cfg, '--port', String(PORT.worker), '--ip', '127.0.0.1',
  '--inspector-port', String(PORT.inspector), '--local', '--log-level', 'warn',
  '--persist-to', path.join(TMP, 'wrangler-state')],
{ cwd: WORKER_DIR, env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let wlog = '';
wrangler.stdout.on('data', (d) => { wlog += d; });
wrangler.stderr.on('data', (d) => { wlog += d; });

let up = false;
for (let i = 0; i < 120; i++) {
  try { const r = await fetch(W + '/health'); if (r.ok) { up = true; break; } } catch (e) { /* not yet */ }
  await sleep(500);
}
if (!up) { console.error(wlog); throw new Error('wrangler dev did not come up'); }
console.log('wrangler dev is up');

const browser = await puppeteer.launch({
  executablePath: chrome(), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server',
    '--host-resolver-rules=MAP formsubmit.co ~NOTFOUND, MAP *.workers.dev ~NOTFOUND'],
});

/* ------------------------------------------------------------------ the tally */
let pass = 0, fail = 0;
const out = [];
const say = (s) => { console.log(s); out.push(s); };
const ok = (cond, name, got) => {
  if (cond) { pass++; say('  OK   ' + name); }
  else { fail++; say('  RED  ' + name + (got === undefined ? '' : '  -- got ' + JSON.stringify(got))); }
};
const head = (s) => say('\n' + s);

/* ------------------------------------------------------------------ the Worker's doors */
const H = (now) => ({ 'content-type': 'application/json', ...(now ? { 'x-umbra-test-now': now } : {}) });
async function json(url, init) {
  const r = await fetch(url, init);
  const t = await r.text();
  let b = null;
  try { b = JSON.parse(t); } catch (e) { b = t; }
  return { status: r.status, body: b };
}
const admin = (method, p, body, now) => json(W + p + '?k=' + ADMIN_KEY, { method, headers: H(now), body: body === undefined ? undefined : JSON.stringify(body) });
const create = (id, body, now) => admin('POST', '/admin/quote/' + id, body, now);
const sentQ = (id, version, at) => admin('POST', '/admin/quote/' + id + '/sent', { version, sent_at: at }, at);
const record = (id) => json(W + '/__record/' + id + '?k=' + ADMIN_KEY, { method: 'POST' }).then((r) => r.body);
const CT = (y, mo, d, h, mi = 0) => new Date(chicagoWall(y, mo, d, h, mi)).toISOString();
const win = (date, start, end) => ({ date, start, end });
const forwards = () => stub.captured.filter((c) => c.url.startsWith('/formsubmit') && c.method === 'POST');
const fieldsOf = (c) => {
  const text = c.body.toString('utf8');
  const o = {};
  for (const m of text.matchAll(/name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n--/g)) o[m[1]] = m[2];
  return o;
};

let serial = 0;
async function scratchJob(iso, name, withEmail = true) {
  serial++;
  const fd = new FormData();
  fd.set('_subject', 'Service request from umbradomus.com');
  fd.set('_next', 'https://www.umbradomus.com/request-received');
  fd.set('name', name);
  fd.set('phone', '(956) 555-02' + String(10 + serial).padStart(2, '0'));
  fd.set('address', (300 + serial) + ' Scratch Row, Brownsville');
  if (withEmail) fd.set('email', 'sf03.scratch' + serial + '@example.com');
  fd.set('service', 'Drywall & Paint');
  fd.set('what', name + ' (sf03 scratch ' + serial + '): two small holes in the hall ceiling to patch and paint.');
  fd.set('email_sent', 'yes');
  const r = await fetch(W + '/intake', { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
  const loc = r.headers.get('location') || '';
  const id = new URL(loc, SITE).searchParams.get('id');
  if (!id) throw new Error('scratch submission failed: ' + r.status + ' ' + loc);
  await fetch(W + '/admin/seen/' + id + '?k=' + ADMIN_KEY, { method: 'POST', headers: { 'x-umbra-test-now': iso } });
  return id;
}
const Q = (version, windows, extra = {}) => ({
  version,
  price: 395,
  scope: ['Patch the holes in the ceiling and re-texture to match', 'Prime every patch and spot-paint it, feathered'],
  included: 'Paint for the color match is included. Cleanup included.',
  guarantee: 'If anything is not right, I come back and fix it.',
  insurance: 'Insured: $1M general liability. Certificate on request.',
  windows,
  lang: 'en',
  ...extra,
});

/* ------------------------------------------------------------------ the browser */
fs.mkdirSync(SHOTS, { recursive: true });
async function openPage(width, now) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width <= 420 ? 844 : 900 });
  await page.setExtraHTTPHeaders({ 'x-umbra-test-now': now });
  return page;
}
async function bookInBrowser(code, now, width, shot) {
  const page = await openPage(width, now);
  await page.goto(SITE + '/q/' + code, { waitUntil: 'load' });
  await page.waitForSelector('button.qgo');
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('button.qgo')]);
  await sleep(150);
  if (shot) await page.screenshot({ path: path.join(SHOTS, shot), fullPage: true });
  return page;
}
async function openBooked(code, now, width, shot) {
  const page = await openPage(width, now);
  await page.goto(SITE + '/q/' + code, { waitUntil: 'load' });
  await sleep(120);
  if (shot) await page.screenshot({ path: path.join(SHOTS, shot), fullPage: true });
  return page;
}
const stateOf = (p) => p.$eval('body', (e) => e.getAttribute('data-state'));
/* every element that holds text and has no element children -- the lines a person reads */
const leaves = (p) => p.evaluate(() => Array.from(document.querySelectorAll('body *'))
  .filter((e) => e.children.length === 0 && e.textContent.trim())
  .map((e) => ({ cls: String(e.className || ''), text: e.textContent.replace(/\s+/g, ' ').trim() })));
/* the tightest elements whose text carries all three: none of their children carries all three too */
const tightest = (p, d, s, m) => p.evaluate((day, span, money) => {
  const has = (e) => { const t = e.textContent.replace(/\s+/g, ' '); return t.includes(day) && t.includes(span) && t.includes(money); };
  const all = Array.from(document.querySelectorAll('body, body *')).filter(has);
  return all.filter((e) => !Array.from(e.children).some(has))
    .map((e) => ({ tag: e.tagName.toLowerCase(), cls: String(e.className || ''), text: e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240) }));
}, d, s, m);
const bodyText = (p) => p.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').trim());

/* The three things the ignite's one line must carry, in the customer's own language.
   The day is read as the weekday word AND the date, in either shape the site writes it
   ("Tue, Nov 10" on the new line, "Tue 11/10" on the ticket), so base and GREEN are read the same way. */
const LANGS = {
  en: {
    day: '2026-11-10', name: 'Rita Calder',
    dayRe: [/Tue/, new RegExp('(Nov 10|11/10)')], span: '8–10 AM', price: '$395',
    promise: /text you the day before/i,
  },
  es: {
    day: '2026-11-12', name: 'Lupe Serrano',
    dayRe: [/jueves/i, /12 de noviembre/], span: 'las 8 y las 10 a.m.', price: '$395',
    promise: /mensaje de texto el día anterior/i,
  },
};
const shotName = (lang, width) => (STAGE === 'base'
  ? (lang === 'en' && width === 390 ? 'R1-booked-390-base.png' : 'R1-booked-' + width + '-' + lang + '-base.png')
  : 'booked-' + width + '-' + lang + '.png');

const RESULT = { stage: STAGE, at: new Date().toISOString() };
try {
  const T10 = CT(2026, 10, 5, 10, 0);        /* this reading's own moment: Mon 10/5 2026, 10:00 AM Central */

  /* ============================================================ item 1 · THE BOOKED SCREEN */
  if (want('1')) {
    head('ITEM 1 · THE BOOKED SCREEN — a booking through the real route, then what the page says');
    for (const lang of ['en', 'es']) {
      const L = LANGS[lang];
      const id = await scratchJob(CT(2026, 10, 5, 9, 0), L.name);
      const c = await create(id, Q(1, [win(L.day, '08:00', '10:00')], { sent_at: T10, lang }), T10);
      const code = c.body && c.body.code;
      ok(Boolean(code), lang + ': the scratch quote has a code', code || c.body);
      await sentQ(id, 1, T10);
      for (const width of [390, 1440]) {
        const shot = shotName(lang, width);
        const page = width === 390
          ? await bookInBrowser(code, T10, width, shot)
          : await openBooked(code, T10, width, shot);
        const st = await stateOf(page);
        ok(st === 'booked', lang + ' ' + width + ': the page after the booking is the booked page', st);
        const t = await bodyText(page);
        ok(L.dayRe.every((re) => re.test(t)), lang + ' ' + width + ': the day is somewhere on the page');
        ok(t.includes(L.span), lang + ' ' + width + ': the window is somewhere on the page', L.span);
        ok(t.includes(L.price), lang + ' ' + width + ': the price is somewhere on the page', L.price);
        const lv = await leaves(page);
        const oneLine = lv.filter((e) => L.dayRe.every((re) => re.test(e.text)) && e.text.includes(L.span) && e.text.includes(L.price));
        ok(oneLine.length === 1, lang + ' ' + width + ': ONE line carries the day, the window and the price',
          oneLine.length ? oneLine.map((e) => e.cls + ': ' + e.text) : 0);
        ok(L.promise.test(t), lang + ' ' + width + ': the page promises the text the day before', L.promise.source);
        RESULT['item1_' + lang + '_' + width] = {
          state: st,
          screenshot: shot,
          lines_carrying_day_window_price: oneLine.map((e) => e.cls + ': ' + e.text),
          tightest_element_carrying_all_three: await tightest(page, lang === 'es' ? 'de noviembre' : 'Tue', L.span, L.price),
          promise_present: L.promise.test(t),
          lines: lv.map((e) => (e.cls ? e.cls + ': ' : '') + e.text),
        };
        await page.close();
      }
    }
  }

  /* ============================================================ item 1 · THE PLANT */
  if (want('plant1')) {
    head('ITEM 1 · THE PLANT — a booked record with no window in it: the day and the price, never a blank dash');
    const mod = await import('./../worker/src/page.js');
    const fn = mod.bookedSummary;
    ok(typeof fn === 'function', 'page.js exports bookedSummary (the one line itself)', typeof fn);
    if (typeof fn === 'function') {
      for (const lang of ['en', 'es']) {
        const L = LANGS[lang];
        const whole = fn({ date: L.day, start: '08:00', end: '10:00' }, 395, lang);
        const noWindow = fn({ date: L.day }, 395, lang);
        const noVisit = fn(null, 395, lang);
        say('  ' + lang + ' whole     : ' + whole);
        say('  ' + lang + ' no window : ' + noWindow);
        say('  ' + lang + ' no visit  : ' + noVisit);
        const clean = (s) => !/—\s*—/.test(s) && !/—\s*$/.test(s) && !/^\s*—/.test(s) && !/-\s*-/.test(s);
        ok(L.dayRe.every((re) => re.test(whole)) && whole.includes(L.span) && whole.includes(L.price) && L.promise.test(whole),
          lang + ': the whole line carries the day, the window, the price and the promise', whole);
        ok(L.dayRe.every((re) => re.test(noWindow)), lang + ': no window → the day is still there', noWindow);
        ok(noWindow.includes(L.price), lang + ': no window → the price is still there', noWindow);
        ok(L.promise.test(noWindow), lang + ': no window → the promise is still there', noWindow);
        ok(!noWindow.includes(L.span), lang + ': no window → no window on the line', noWindow);
        ok(clean(noWindow), lang + ': no window → no blank dash', noWindow);
        ok(noVisit.includes(L.price) && L.promise.test(noVisit) && clean(noVisit),
          lang + ': no visit at all → the price and the promise, no blank dash', noVisit);
        RESULT['plant1_' + lang] = { whole, no_window: noWindow, no_visit: noVisit };
      }
    }
  }

  /* ============================================================ item 2 · THE CONFIRMATION EMAIL
     The road is the one the request copy already rides, so the reading is the one run-all.mjs already
     counts: every POST the mail stub caught whose url starts /formsubmit. `_autoresponse` is the field the
     customer's own copy travels in (assets/umbra-sent.js writes it at the form); `_subject` is the subject
     of the copy that lands in Drew's inbox. Both languages. NEVER A REAL ADDRESS — the stub only, and the
     scratch records give sf03.scratch<n>@example.com. */
  if (want('2')) {
    head('ITEM 2 · THE CONFIRMATION EMAIL — what the mail stub recorded on a booking, both languages');
    RESULT.item2_on_booking = {};
    const MAIL = {
      en: {
        day: '2026-11-17', name: 'Mail Mercer',
        dayRe: [/Tue/, new RegExp('(Nov 17|11/17)')],
        spanRe: /Arriving 8[–-]10 AM/,
        promise: /text you the day before/i,
        umbra: /Questions\? Text or call \(956\) 556-6438\./,
        subjectRe: /^You're booked — /,
      },
      es: {
        day: '2026-11-19', name: 'Correo Cantu',
        dayRe: [/jueves/i, /19 de noviembre/],
        spanRe: /Llegada entre las 8 y las 10 a\.m\./,
        promise: /mensaje de texto el día anterior/i,
        umbra: /¿Preguntas\? Mande un mensaje de texto o llame al \(956\) 556-6438\./,
        subjectRe: /^Su visita quedó programada — /,
      },
    };
    let lastCode = null, lastId = null;
    for (const lang of ['en', 'es']) {
      const L = MAIL[lang];
      head('  ' + lang.toUpperCase() + ' — the one email a booking sends');
      const id = await scratchJob(CT(2026, 10, 5, 9, 30), L.name);
      const c = await create(id, Q(1, [win(L.day, '08:00', '10:00')], { sent_at: T10, lang }), T10);
      const code = c.body && c.body.code;
      ok(Boolean(code), lang + ': the mail quote has a code', code || c.body);
      await sentQ(id, 1, T10);
      const before = forwards().length;
      const page = await bookInBrowser(code, T10, 390, null);
      ok((await stateOf(page)) === 'booked', lang + ': the booking landed');
      await page.close();
      await sleep(600);
      const after = forwards().slice(before).map(fieldsOf);
      ok(after.length === 1, lang + ': the mail stub recorded ONE email on the booking', after.length);
      const rec = await record(id);
      const stamp = rec.confirmation_email_at || null;
      const f = after[0] || {};
      const body = String(f._autoresponse || '');
      const subj = String(f._subject || '');
      ok(Boolean(stamp), lang + ': the record carries confirmation_email_at', stamp);
      ok(String(f.email || '') === String((rec.fields || {}).email || ''),
        lang + ': the email goes to the address they gave on the form', f.email || null);
      for (const re of L.dayRe) ok(re.test(body), lang + ': the email carries the day ' + re, body || null);
      ok(L.spanRe.test(body), lang + ': the email carries the window', body || null);
      ok(body.includes('$395'), lang + ': the email carries the price', body || null);
      ok(L.promise.test(body), lang + ': the email promises the text the day before', body || null);
      ok(L.umbra.test(body), lang + ': the email carries the Umbra line the request copy carries', body || null);
      ok(L.subjectRe.test(subj), lang + ': the subject is in the customer\'s language', subj);
      ok(!subj.includes(id), lang + ': no job id in the subject', subj);
      ok(!body.includes(id) && !('job_id' in f) && !('status_link' in f),
        lang + ': no job id and no status link anywhere in the send', Object.keys(f));
      ok(!body.includes(code) && !subj.includes(code), lang + ': no secret (no quote code) in the email');
      RESULT.item2_on_booking[lang] = {
        emails_recorded: after.length, email_fields: after, record_stamp: stamp,
        record_email: (rec.fields || {}).email || null,
      };
      lastCode = code; lastId = id;
    }

    /* THE PLANT: a second booking tap on the same page sends nothing again */
    head('  PLANT — the same page booked twice');
    const before2 = forwards().length;
    const re = await fetch(SITE + '/q/' + lastCode, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SITE, 'sec-fetch-site': 'same-origin', 'x-umbra-test-now': T10 },
      body: 'v=1&w=1',
    });
    await sleep(600);
    const extra = forwards().length - before2;
    ok(extra === 0, 'PLANT: booked twice on the same page → one email, not two', { second_post: re.status, extra_emails: extra });
    const recAgain = await record(lastId);
    RESULT.item2_plant_second_tap = {
      second_post_status: re.status, extra_emails: extra, total_emails: forwards().length,
      stamp_unchanged: (recAgain.confirmation_email_at || null) === (RESULT.item2_on_booking.es.record_stamp || null),
    };
    ok(RESULT.item2_plant_second_tap.stamp_unchanged, 'PLANT: the stamp is the first send\'s, unmoved', recAgain.confirmation_email_at);

    /* no email address given → no email */
    head('  no address given');
    const id2 = await scratchJob(CT(2026, 10, 5, 9, 40), 'Noemail Nava', false);
    const c2 = await create(id2, Q(1, [win('2026-11-18', '08:00', '10:00')], { sent_at: T10 }), T10);
    await sentQ(id2, 1, T10);
    const before3 = forwards().length;
    const p3 = await bookInBrowser(c2.body.code, T10, 390, null);
    ok((await stateOf(p3)) === 'booked', 'the no-address booking landed');
    await p3.close();
    await sleep(600);
    const extra3 = forwards().length - before3;
    ok(extra3 === 0, 'no email address given → no email sent', extra3);
    const rec2 = await record(id2);
    ok(!rec2.confirmation_email_at, 'no address → no confirmation_email_at stamp', rec2.confirmation_email_at || null);
    RESULT.item2_no_address = {
      emails: extra3, record_email: (rec2.fields && rec2.fields.email) || null,
      record_stamp: rec2.confirmation_email_at || null,
    };
  }
} finally {
  say('\n--------------------------------------------');
  say(pass + ' readings held, ' + fail + ' RED');
  fs.mkdirSync(BRIDGE, { recursive: true });
  const tag = (ONLY || 'all').replace(/[^\w.-]+/g, '_') + '-' + STAGE;
  fs.writeFileSync(path.join(BRIDGE, 'read-' + tag + '.json'), JSON.stringify(RESULT, null, 1));
  fs.writeFileSync(path.join(BRIDGE, 'read-' + tag + '.txt'), out.join('\n') + '\n');
  try { await browser.close(); } catch (e) { /* already gone */ }
  wrangler.kill('SIGTERM');
  await Promise.all([close(stub), close(site)]);
  if (/\bError\b/.test(wlog)) fs.writeFileSync(path.join(BRIDGE, 'wlog-' + tag + '.txt'), wlog);
}
process.exit(fail === 0 ? 0 : 1);
