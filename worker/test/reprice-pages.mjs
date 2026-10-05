/* REPRICE-01 · THE READING FOR CLAUSE 2 — WHAT THE CUSTOMER SEES. 2026-10-05. Test-only; nothing ships.

   Three scratch jobs, each booked BY THE PAGE at $70, exactly as U-0015 was on 10-01:
     EN    quoted in English — read on /q/ and on the status page, at 390 and at 1440
     ES    quoted in Spanish — read on /q/ at 390 and at 1440
     PLANT a third, booked at $70, where the reprice asks for EIGHTY

   RED FIRST is those same pages BEFORE the lowering: they read $70, after he said "it is 50 dollars".
   GREEN is them after it: $50 in both languages, and the old price on none of them.

   The pages are read in a real Chrome through the site's own static server, same-origin, with the one
   /q rewrite played by test/lib/servers.mjs — so this is the customer's browser, not a fetch.
   window.UMBRA_WORKER_BASE is set before the page's scripts run, which is the single line
   assets/umbra-endpoint.js reads; no file on the site is touched.

   THE STATUS PAGE IS ENGLISH ONLY, and that is the site's, not this round's: src/index.js statusUrl()
   carries the repo's own note that there is no es/estado.html, so both languages point at /status.

   Run (from worker/):  node test/reprice-pages.mjs
   Ports move with UMBRA_PAGES_SHIFT (default 65). Screenshots go to UMBRA_PAGES_SHOTS. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureServer, smsgateServer, staticServer, close } from './lib/servers.mjs';
import { chicagoWall } from '../src/biztime.js';
import puppeteer from '../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const WORKER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(WORKER_DIR);
const SHOTS = process.env.UMBRA_PAGES_SHOTS || 'C:/Users/andre/Umbra/Boss/Bridge/REPRICE-01/screens';
const SHIFT = Number(process.env.UMBRA_PAGES_SHIFT || 65);
const PORT = { worker: 8787 + SHIFT, stub: 4770 + SHIFT, smsgate: 4771 + SHIFT, site: 4772 + SHIFT, inspector: 9229 + SHIFT };
for (const p of Object.values(PORT)) {
  if ([4747, 4750, 4177, 4178].includes(p)) throw new Error('port ' + p + ' is reserved on this PC');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN_KEY = 'pages-admin-' + crypto.randomBytes(9).toString('hex');
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
const SITE = 'http://127.0.0.1:' + PORT.site;
/* the one line in assets/umbra-endpoint.js, which the site ships with and this reading never edits */
const PROD = 'https://umbra-intake.umbradomus.workers.dev';
const CT = (d, h, mi = 0) => new Date(chicagoWall(2026, 12, d, h, mi)).toISOString();
const NOW = CT(1, 10, 0);
const H = (now) => ({ 'content-type': 'application/json', ...(now ? { 'x-umbra-test-now': now } : {}) });

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const c = [path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')].find((x) => fs.existsSync(x));
  if (!c) throw new Error('no Chrome on this PC');
  return c;
}

async function call(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let body;
  try { body = JSON.parse(t); } catch (e) { body = { _text: t.slice(0, 200) }; }
  return { status: r.status, body };
}
const admin = (method, p, body, now) => call(W + p + '?k=' + ADMIN_KEY, {
  method, headers: H(now), body: body === undefined ? undefined : JSON.stringify(body),
});
const record = (id) => call(W + '/__record/' + id + '?k=' + ADMIN_KEY, { method: 'POST' }).then((r) => r.body);
const dump = () => call(W + '/__book-dump?k=' + ADMIN_KEY, { method: 'POST', headers: H(), body: '{}' }).then((r) => r.body);
const parseRow = (q) => (q ? { ...q, body: JSON.parse(q.body_json) } : q);
const bookRow = async (id, version) => parseRow((await dump()).quotes.find((q) => q.job_id === id && q.version === version));

let stub = null;
let gate = null;
const sends = () => ({
  pushover: stub.captured.filter((c) => c.method === 'POST' && c.url === '/pushover/1/messages.json').length,
  telegram: stub.captured.filter((c) => c.method === 'POST' && /^\/telegram\/bot[^/]+\/sendMessage$/.test(c.url)).length,
  email: stub.captured.filter((c) => c.method === 'POST' && c.url.startsWith('/formsubmit')).length,
  text: gate.requests.filter((r) => r.method === 'POST' && r.path === '/3rdparty/v1/messages').length,
});
const sendsLine = (s) => 'pushover=' + s.pushover + ' telegram=' + s.telegram + ' email=' + s.email + ' text=' + s.text;

/* nothing in a customer's details may read 70 by accident: the phone is 555-03xx, the street unnumbered */
async function submitAt(iso, name, serial) {
  const fd = new FormData();
  fd.set('_subject', 'Service request from umbradomus.com');
  fd.set('_next', 'https://www.umbradomus.com/request-received');
  fd.set('name', name);
  fd.set('phone', '(956) 555-03' + serial);
  fd.set('address', 'Lantana Street, Brownsville');
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
  const loc = new URL(r.headers.get('location'));
  return { id: loc.searchParams.get('id'), t: loc.searchParams.get('t') };
}

/* the real customer page, not the hook: the same form the browser posts */
async function bookByPage(code, version, win, iso) {
  const fd = new FormData();
  fd.set('v', String(version));
  fd.set('w', String(win));
  const r = await fetch(W + '/q/' + code, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
  return { status: r.status, location: r.headers.get('location') };
}

const QUOTE = (price, lang, days) => ({
  version: 1,
  price,
  scope: lang === 'es'
    ? ['Parchar el hoyo sobre la ventana y igualar la textura', 'Sellar el parche y pintarlo, difuminado']
    : ['Patch the hole over the window and re-texture to match', 'Prime the patch and spot-paint it, feathered'],
  included: lang === 'es'
    ? 'La pintura para igualar el color esta incluida. Limpieza incluida.'
    : 'Paint for the color match is included. Cleanup included.',
  windows: [{ date: days[0], start: '08:00', end: '10:00' }, { date: days[1], start: '10:00', end: '12:00' }],
  lang,
  sent_at: NOW,
});

async function main() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'umbra-pages-'));
  fs.mkdirSync(SHOTS, { recursive: true });
  stub = await captureServer({ port: PORT.stub, tls: false });
  gate = await smsgateServer({ port: PORT.smsgate });
  const site = await staticServer({ port: PORT.site, root: REPO, proxy: W });
  fs.writeFileSync(path.join(TMP, '.dev.vars'), [
    'ADMIN_KEY=' + ADMIN_KEY,
    ...Object.entries(FAKE).map(([k, v]) => k + '=' + v),
    'PUSHOVER_API_BASE=http://127.0.0.1:' + PORT.stub + '/pushover',
    'TELEGRAM_API_BASE=http://127.0.0.1:' + PORT.stub + '/telegram',
    'FORMSUBMIT_ENDPOINT=http://127.0.0.1:' + PORT.stub + '/formsubmit',
    'SITE_BASE_URL=' + SITE,
    'PUBLIC_BASE_URL=' + W,
    'IGNORE_NEXT_ORIGIN=true',
    'ALLOW_TEST_HOOKS=true',
    'SMSGATE_AUTH=' + FAKE_SMSGATE_AUTH,
    'SMSGATE_API_BASE=http://127.0.0.1:' + PORT.smsgate,
    'SMSGATE_WEBHOOK_KEY=' + FAKE_WEBHOOK_KEY,
    'QUOTE_LINK_BASE=' + SITE,
    '',
  ].join('\n'));
  const cfg = path.join(TMP, 'wrangler.pages.toml');
  fs.writeFileSync(cfg, [
    'name = "umbra-intake-pages"',
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
    'id = "pages-records"',
    '',
    '[[r2_buckets]]',
    'binding = "PHOTOS"',
    'bucket_name = "umbra-job-photos-pages"',
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

  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: chrome(),
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server',
        '--host-resolver-rules=MAP formsubmit.co ~NOTFOUND, MAP *.workers.dev ~NOTFOUND'],
    });

    /* The /q/ page is rendered by the Worker same-origin through the site's /q rewrite, so it takes the
       test clock in a header. The status page instead makes a CROSS-ORIGIN fetch of /api/job, and a
       custom header on that would force a CORS preflight the live Worker does not answer either — the
       real browser never sends one, so neither does this reading. The status page therefore reads on the
       real clock; nothing it prints depends on the hour. */
    const openAt = async (url, width, shot, waitFor, sendNow = true) => {
      const page = await browser.newPage();
      const trouble = [];
      page.on('requestfailed', (r) => trouble.push('requestfailed ' + r.url().slice(0, 90) + ' ' + ((r.failure() || {}).errorText || '')));
      page.on('pageerror', (e) => trouble.push('pageerror ' + String(e).slice(0, 120)));
      page.on('console', (m) => { if (m.type() === 'error') trouble.push('console ' + m.text().slice(0, 120)); });
      await page.setViewport({ width, height: width <= 420 ? 844 : 900 });
      if (sendNow) await page.setExtraHTTPHeaders({ 'x-umbra-test-now': NOW });
      /* assets/umbra-endpoint.js names the live Worker in the file itself ("THE ONE LINE"), so the
         honest local read is to resolve that one hostname to this wrangler, the way a hosts entry
         would. The site's own files are read byte for byte, unedited; anything NOT rewritten still
         meets MAP *.workers.dev ~NOTFOUND and fails loudly rather than reaching the internet. */
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const u = req.url();
        if (u.startsWith(PROD)) { req.continue({ url: W + u.slice(PROD.length) }); return; }
        req.continue();
      });
      await page.goto(url, { waitUntil: 'load' });
      if (waitFor) {
        try { await page.waitForFunction(waitFor, { timeout: 15000 }); } catch (e) { /* read it as it stands */ }
      }
      await sleep(300);
      await page.screenshot({ path: path.join(SHOTS, shot), fullPage: true });
      const text = await page.evaluate(() => document.body.innerText.replace(/[ \t]+/g, ' ').trim());
      const leaves = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
        .filter((e) => !['SCRIPT', 'STYLE', 'TEMPLATE'].includes(e.tagName))
        .filter((e) => e.children.length === 0 && e.textContent.trim())
        .map((e) => ({ cls: String(e.className || ''), text: e.textContent.replace(/\s+/g, ' ').trim() })));
      const html = await page.content();
      await page.close();
      return { text, leaves, html, shot, url, trouble };
    };
    const hunt = (r, needle) => 'text:' + (r.text.includes(needle) ? 'YES' : 'no')
      + ' html:' + (r.html.includes(needle) ? 'YES' : 'no');
    const show = (label, r, needles) => {
      console.log('  ' + label + ' · ' + r.shot);
      for (const n of needles) console.log('      "' + n + '"  ' + hunt(r, n));
      console.log('      every $ on the page: ' + JSON.stringify(r.text.match(/\$[0-9][0-9.,]*/g) || []));
      const priced = r.leaves.filter((l) => /\$/.test(l.text) || /precio|price/i.test(l.text));
      for (const l of priced.slice(0, 4)) console.log('      leaf [' + l.cls + '] ' + JSON.stringify(l.text.slice(0, 120)));
      for (const t of r.trouble) console.log('      TROUBLE ' + t);
    };

    /* ------------------------------------------------- the three scratch jobs */
    console.log('=== THREE SCRATCH JOBS, EACH BOOKED BY THE PAGE AT $70 (U-0015 was booked this way on 10-01) ===');
    const jobs = {};
    const make = async (key, serial, lang, days) => {
      const s = await submitAt(NOW, 'Reprice Page ' + key, serial);
      const q = await admin('POST', '/admin/quote/' + s.id, QUOTE(70, lang, days), NOW);
      const b = await bookByPage(q.body.code, 1, 1, CT(1, 10, 5));
      const row = await bookRow(s.id, 1);
      console.log(key.padEnd(5) + ' · ' + s.id + ' · lang ' + lang + ' · quote ' + q.status
        + ' · booked by the page ' + b.status + ' → ' + b.location
        + ' · book price ' + row.body.price + ' · status ' + row.status);
      jobs[key] = { ...s, code: q.body.code, lang };
    };
    await make('EN', '21', 'en', ['2026-12-03', '2026-12-04']);
    await make('ES', '22', 'es', ['2026-12-08', '2026-12-09']);
    await make('PLANT', '23', 'en', ['2026-12-10', '2026-12-11']);
    const sendsPre = sendsLine(sends());
    console.log('sends after the three bookings (the reprice must add nothing to these): ' + sendsPre);

    const qUrl = (j) => SITE + '/q/' + j.code;
    const stUrl = (j) => SITE + '/status?id=' + j.id + '&t=' + encodeURIComponent(j.t);
    const priceShown = () => /\$\s?\d/.test(document.body.innerText);

    /* ------------------------------------------------- RED */
    console.log('');
    console.log('=== RED · THE PAGES BEFORE THE LOWERING — he said "it is 50 dollars" and they read 70 ===');
    const red = {};
    red.qEn390 = await openAt(qUrl(jobs.EN), 390, 'q-en-390-RED.png');
    red.qEn1440 = await openAt(qUrl(jobs.EN), 1440, 'q-en-1440-RED.png');
    red.qEs390 = await openAt(qUrl(jobs.ES), 390, 'q-es-390-RED.png');
    red.qEs1440 = await openAt(qUrl(jobs.ES), 1440, 'q-es-1440-RED.png');
    red.st390 = await openAt(stUrl(jobs.EN), 390, 'status-en-390-RED.png', priceShown, false);
    red.st1440 = await openAt(stUrl(jobs.EN), 1440, 'status-en-1440-RED.png', priceShown, false);
    console.log('the booked /q/ page · ENGLISH');
    show('390 ', red.qEn390, ['$70', '$50']);
    show('1440', red.qEn1440, ['$70', '$50']);
    console.log('the booked /q/ page · SPANISH');
    show('390 ', red.qEs390, ['$70', '$50']);
    show('1440', red.qEs1440, ['$70', '$50']);
    console.log('the status page · ENGLISH ONLY (the site has no es/estado.html; src/index.js statusUrl says so)');
    show('390 ', red.st390, ['$70', '$50']);
    show('1440', red.st1440, ['$70', '$50']);
    const apiRed = await call(W + '/api/job/' + jobs.EN.id + '?t=' + encodeURIComponent(jobs.EN.t), { method: 'GET' });
    console.log('GET /api/job/<id>?t= (what the status page reads): quote_amount ' + apiRed.body.quote_amount
      + ' · price_was on it: ' + ('price_was' in apiRed.body));

    /* ------------------------------------------------- the lowering */
    console.log('');
    console.log('=== THE LOWERING · his side only, no word to the customer ===');
    for (const k of ['EN', 'ES']) {
      const r = await admin('POST', '/admin/quote/' + jobs[k].id + '/reprice', { version: 1, price: 50 }, CT(1, 11, 0));
      console.log(k.padEnd(5) + ' · POST /admin/quote/' + jobs[k].id + '/reprice {"version":1,"price":50} → '
        + r.status + ' ' + JSON.stringify(r.body));
    }
    console.log('sends: ' + sendsPre + ' → ' + sendsLine(sends()) + ' (unchanged: ' + (sendsPre === sendsLine(sends())) + ')');

    /* ------------------------------------------------- GREEN */
    console.log('');
    console.log('=== GREEN · THE SAME PAGES AFTER IT ===');
    const green = {};
    green.qEn390 = await openAt(qUrl(jobs.EN), 390, 'q-en-390-GREEN.png');
    green.qEn1440 = await openAt(qUrl(jobs.EN), 1440, 'q-en-1440-GREEN.png');
    green.qEs390 = await openAt(qUrl(jobs.ES), 390, 'q-es-390-GREEN.png');
    green.qEs1440 = await openAt(qUrl(jobs.ES), 1440, 'q-es-1440-GREEN.png');
    green.st390 = await openAt(stUrl(jobs.EN), 390, 'status-en-390-GREEN.png', priceShown, false);
    green.st1440 = await openAt(stUrl(jobs.EN), 1440, 'status-en-1440-GREEN.png', priceShown, false);
    console.log('the booked /q/ page · ENGLISH');
    show('390 ', green.qEn390, ['$50', '$70', 'price_was']);
    show('1440', green.qEn1440, ['$50', '$70', 'price_was']);
    console.log('the booked /q/ page · SPANISH');
    show('390 ', green.qEs390, ['$50', '$70', 'price_was']);
    show('1440', green.qEs1440, ['$50', '$70', 'price_was']);
    console.log('the status page · ENGLISH ONLY');
    show('390 ', green.st390, ['$50', '$70', 'price_was']);
    show('1440', green.st1440, ['$50', '$70', 'price_was']);
    const apiGreen = await call(W + '/api/job/' + jobs.EN.id + '?t=' + encodeURIComponent(jobs.EN.t), { method: 'GET' });
    console.log('GET /api/job/<id>?t= : quote_amount ' + apiGreen.body.quote_amount
      + ' · price_was on it: ' + ('price_was' in apiGreen.body)
      + ' · the whole customer payload reads 70 anywhere: ' + /(^|[^0-9])70([^0-9]|$)/.test(JSON.stringify(apiGreen.body)));
    console.log('THE CUSTOMER PAYLOAD IN FULL: ' + JSON.stringify(apiGreen.body));
    console.log('');
    console.log('--- the English /q/ page, every word of it ---');
    console.log(green.qEn390.text);
    console.log('--- the Spanish /q/ page, every word of it ---');
    console.log(green.qEs390.text);
    console.log('--- the status page, every word of it ---');
    console.log(green.st390.text);

    /* ------------------------------------------------- THE PLANT */
    console.log('');
    console.log('=== THE PLANT · a reprice to EIGHTY on a job booked at $70 ===');
    const before = await record(jobs.PLANT.id);
    const rowBefore = await bookRow(jobs.PLANT.id, 1);
    const plant = await admin('POST', '/admin/quote/' + jobs.PLANT.id + '/reprice', { version: 1, price: 80 }, CT(1, 11, 5));
    const after = await record(jobs.PLANT.id);
    const rowAfter = await bookRow(jobs.PLANT.id, 1);
    console.log('the answer → ' + plant.status + ' ' + JSON.stringify(plant.body));
    console.log('--- THE RECORD BEFORE ---');
    console.log(JSON.stringify(before, null, 1));
    console.log('--- THE RECORD AFTER ---');
    console.log(JSON.stringify(after, null, 1));
    console.log('byte-identical record: ' + (JSON.stringify(before) === JSON.stringify(after)));
    console.log('byte-identical book row: ' + (JSON.stringify(rowBefore) === JSON.stringify(rowAfter))
      + ' · price ' + rowAfter.body.price + ' · price_was ' + JSON.stringify(rowAfter.body.price_was)
      + ' · state_version ' + rowBefore.state_version + ' → ' + rowAfter.state_version);
    const plantPage = await openAt(qUrl(jobs.PLANT), 390, 'q-plant-390-AFTER-422.png');
    show('the plant job page after the 422', plantPage, ['$70', '$80']);
    console.log('');
    console.log('sends across the whole reading: ' + sendsPre + ' → ' + sendsLine(sends()));
    console.log('the site served ' + site.proxyLog.length + ' /q requests through its own rewrite (same-origin, as on umbradomus.com)');
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* already gone */ } }
    wrangler.kill('SIGTERM');
    await Promise.all([close(stub), close(gate), close(site)]);
    await sleep(300);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* wrangler may still hold a handle */ }
  }
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
