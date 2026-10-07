/* WORKER-EMAIL-01 — THE EMAIL COPY OF A REQUEST, READ ON A STUB.
   NOTHING HERE SENDS MAIL, A TEXT, OR A REQUEST TO THE LIVE WORKER.
   Every outbound mail endpoint either leg calls is answered locally:
     · the BROWSER's copy  — formsubmit.co is pointed at a local TLS stub by Chrome's
       --host-resolver-rules (the rig worker/test/run-all.mjs already uses), and every
       *.workers.dev name is unresolvable, so no walk can reach the live Worker.
     · the WORKER's fallback — `wrangler dev` reads FORMSUBMIT_ENDPOINT out of the
       .dev.vars this script writes beside its own --config (worker/src/forward.js
       forwardEndpoint(env) honours it). That env var is the Worker's OWN config for
       tests; the live Worker's vars and secrets are never read or written.
   Ports: wrangler dev 4821 (inspector 4822), everything else 49xx — all started and
   stopped by this script. 4747, 4750, 4177 and 4178 are never touched.

   node email-copy-reading.mjs --label X --lang en|es --site cand|<sha> [--assets-from <sha>]
        [--mail ok|slow:<ms>|429|hang] [--worker-mail ok|429] [--cut-browser] --out <file>
*/
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = path.resolve(HERE, '..');
const REPO = path.resolve(WORKER_DIR, '..');
/* node_modules is not committed, so a worktree has none: the main checkout's is READ
   from (never written) when this worktree has no copy of its own. */
const NM = [path.join(WORKER_DIR, 'node_modules'), 'C:/Users/andre/Umbra/umbrasitev1/worker/node_modules']
  .find((d) => fs.existsSync(path.join(d, 'puppeteer-core')));
if (!NM) throw new Error('no puppeteer-core on this machine');
const puppeteer = (await import('file:///' + path.join(NM, 'puppeteer-core/lib/esm/puppeteer/puppeteer-core.js').replace(/\\/g, '/'))).default;

/* ---------------------------------------------------------------- arguments */
const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    A[k] = (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) ? process.argv[++i] : true;
  }
}
const LABEL = String(A.label || 'reading');
const LANG = String(A.lang || 'en');
const SITE_AT = String(A.site || 'cand');
const ASSETS_FROM = A['assets-from'] ? String(A['assets-from']) : null;
const MAIL = String(A.mail || 'ok');
const WORKER_MAIL = String(A['worker-mail'] || 'ok');
const CUT_BROWSER = Boolean(A['cut-browser']);
const OUT = String(A.out || path.join(REPO, 'reading.txt'));

const SHIFT = Number(process.env.UMBRA_TEST_PORT_SHIFT || 0);
const CRLF = String.fromCharCode(13, 10); /* the multipart line break, spelled out so no shell eats it */
const PORT = {
  /* the Worker on a shifted 48xx port of its own; wrangler's inspector keeps the suites'
     own convention (9229 + a shift), because workerd dies at startup with
     "std::terminate() called with no exception" and nothing else when its inspector
     port is one another round already holds — measured here at 08:03Z. */
  worker: 4831 + SHIFT, inspector: 9239 + SHIFT,
  site: 4901 + SHIFT, mailTls: 4902 + SHIFT, mailHttp: 4903 + SHIFT, census: 4904 + SHIFT,
};
{
  const seen = new Map();
  for (const [k, v] of Object.entries(PORT)) {
    if (seen.has(v)) throw new Error('two ports are the same: ' + seen.get(v) + ' and ' + k);
    seen.set(v, k);
  }
}

const L = [];
const say = (s) => { L.push(s); console.log(s); };
const flush = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, L.join('\n') + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

say('WORKER-EMAIL-01 · ' + LABEL);
say('started ' + new Date().toISOString() + '  ·  lang=' + LANG + '  site=' + SITE_AT
  + (ASSETS_FROM ? '  assets-served-from=' + ASSETS_FROM : '')
  + '  browser-mail-stub=' + MAIL + '  worker-mail-stub=' + WORKER_MAIL + (CUT_BROWSER ? '  browser-copy=CUT' : ''));
say('ports: wrangler ' + PORT.worker + ' (inspector ' + PORT.inspector + '), site ' + PORT.site
  + ', mail-tls ' + PORT.mailTls + ', mail-http ' + PORT.mailHttp + ', census ' + PORT.census);
say('');

/* ------------------------------------------------------------- the site tree */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'umbra-email-01-'));
const TREE = path.join(TMP, 'site');
fs.mkdirSync(TREE, { recursive: true });
function git(args) { return execFileSync('git', ['-C', REPO, ...args], { encoding: 'buffer', maxBuffer: 1 << 28 }); }

if (SITE_AT === 'cand') {
  const skip = new Set(['.git', 'node_modules', '_pre-OG141-2026-09-11', '_pre-OG148-2026-09-12', '_pre-restore-2026-09-06-icons']);
  (function copy(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const f = path.join(from, e.name), t = path.join(to, e.name);
      if (e.isDirectory()) copy(f, t);
      else if (e.isFile()) fs.copyFileSync(f, t);
    }
  })(REPO, TREE);
} else {
  const tar = path.join(TMP, 'base.tar');
  fs.writeFileSync(tar, git(['archive', SITE_AT]));
  /* --force-local: GNU tar reads "C:\…" as host:path and tries to resolve the host */
  execFileSync('tar', ['--force-local', '-xf', tar.replace(/\\/g, '/'), '-C', TREE.replace(/\\/g, '/')]);
}
say('site tree: ' + (SITE_AT === 'cand' ? 'the worktree as it stands' : SITE_AT) + ' -> ' + TREE);

/* THE FLIP: this copy of the site points at MY wrangler dev, never at *.workers.dev. */
const ONE_LINE = /window\.UMBRA_WORKER_BASE\s*=\s*['"][^'"]*['"]\s*;/;
{
  const f = path.join(TREE, 'assets', 'umbra-endpoint.js');
  const before = fs.readFileSync(f, 'utf8');
  if (!ONE_LINE.test(before)) throw new Error('the one line was not found in ' + f);
  const after = before.replace(ONE_LINE, "window.UMBRA_WORKER_BASE = 'http://127.0.0.1:" + PORT.worker + "';");
  if (after === before) throw new Error('the flip did not flip — this copy would be indistinguishable from the live one');
  fs.writeFileSync(f, after);
  say('flip: UMBRA_WORKER_BASE -> http://127.0.0.1:' + PORT.worker + '  (every *.workers.dev name is also unresolvable in this Chrome)');
}
/* the stand-in Census, run-all.mjs's way: the one place the site reads its address settings from */
{
  const cfg = path.join(TREE, 'site.config.js');
  if (fs.existsSync(cfg)) fs.appendFileSync(cfg, "\nwindow.UMBRA_CENSUS_BASE = window.UMBRA_CENSUS_BASE || 'http://127.0.0.1:" + PORT.census + "';\n");
}

/* assets as they stood at another commit — what a 7-day browser cache still serves */
const STALE = new Map();
if (ASSETS_FROM) {
  const names = git(['ls-tree', '-r', '--name-only', ASSETS_FROM]).toString('utf8').split('\n')
    .filter((n) => /^assets\/[^/]+\.js$/.test(n) || n === 'site.config.js');
  for (const n of names) {
    let body = git(['show', ASSETS_FROM + ':' + n]);
    if (n === 'assets/umbra-endpoint.js') {
      body = Buffer.from(body.toString('utf8').replace(ONE_LINE, "window.UMBRA_WORKER_BASE = 'http://127.0.0.1:" + PORT.worker + "';"), 'utf8');
    }
    if (n === 'site.config.js') {
      body = Buffer.from(body.toString('utf8') + "\nwindow.UMBRA_CENSUS_BASE = window.UMBRA_CENSUS_BASE || 'http://127.0.0.1:" + PORT.census + "';\n", 'utf8');
    }
    STALE.set('/' + n, body);
  }
  say('cache pre-load: ' + STALE.size + " script files served from " + ASSETS_FROM + " (today's HTML from the tree above)");
}
say('');

/* ------------------------------------------------------------------ servers */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};
function listen(server, port) { return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server))); }

const siteSrv = await listen(http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(TREE, p);
  if (!file.startsWith(TREE)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (fs.existsSync(file + '.html')) file += '.html';
    else if (fs.existsSync(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
    else { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + p); return; }
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}), PORT.site);

const census = await listen(http.createServer((req, res) => {
  const cb = new URL(req.url, 'http://x').searchParams.get('callback') || 'cb';
  res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
  res.end(cb + '(' + JSON.stringify({ result: { addressMatches: [] } }) + ');');
}), PORT.census);

/* THE MAIL STUB. It plays FormSubmit and it is the ONLY mail endpoint either leg can
   reach. `captured` keeps field NAMES, part sizes and the _next it was handed — never a
   value, so no test body and no log line can carry anybody's details. */
const captured = [];
function readBody(req) {
  return new Promise((r) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => r(Buffer.concat(c))); });
}
function boundaryOf(ctype) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype || '');
  return m ? '--' + (m[1] || m[2]).trim() : null;
}
function partsOf(buf, ctype) {
  const out = [];
  const b = boundaryOf(ctype);
  if (!b) return out;
  for (const part of buf.toString('latin1').split(b)) {
    const n = /name="([^"]*)"/.exec(part);
    if (!n) continue;
    const fn = /filename="([^"]*)"/.exec(part);
    const i = part.indexOf('\r\n\r\n');
    const body = i < 0 ? '' : part.slice(i + 4).replace(/\r\n$/, '');
    out.push({ name: n[1], file: Boolean(fn), bytes: body.length });
  }
  return out;
}
function nextOf(buf, ctype) {
  const b = boundaryOf(ctype);
  if (!b) return null;
  for (const part of buf.toString('utf8').split(b)) {
    if (!/name="_next"/.test(part)) continue;
    const i = part.indexOf('\r\n\r\n');
    return i < 0 ? null : part.slice(i + 4).replace(/\r\n$/, '').trim();
  }
  return null;
}
/* FormSubmit's own rate-limit page, as U-0018's record quotes it back */
const RATE_LIMIT_PAGE = '<!doctype html><title>FormSubmit | Easy to use form backend - form endpoints for your HTML forms</title>'
  + '<body><h1>Rate Limit Exceeded</h1><p>Submission limit reached. Please try again later. You are using the free plan.</p>';

async function mailHandler(leg, req, res) {
  const body = await readBody(req);
  const ctype = req.headers['content-type'] || '';
  const cap = {
    leg, at: Date.now(), method: req.method, url: req.url, bytes: body.length,
    parts: partsOf(body, ctype), next: nextOf(body, ctype),
  };
  captured.push(cap);
  const mode = leg === 'browser' ? MAIL : WORKER_MAIL;
  if (mode === 'hang') { cap.answered = 'no answer, ever'; return; }
  const m = /^slow:(\d+)$/.exec(mode);
  if (m) { cap.delayed_ms = Number(m[1]); await sleep(Number(m[1])); }
  if (mode === '429') {
    cap.answered = '429 Rate Limit Exceeded';
    res.writeHead(429, { 'content-type': 'text/html; charset=utf-8' });
    res.end(RATE_LIMIT_PAGE);
    return;
  }
  /* FormSubmit, once it has TAKEN the submission: 302 to _next. That redirect is the
     whole proof the browser leg reads (assets/umbra-two-channels.js). */
  if (cap.next) { cap.answered = '302 -> _next'; res.writeHead(302, { location: cap.next }); res.end(); return; }
  cap.answered = '200 thank you';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>Thank you</title><body><p>Thank you! Your submission has been received.</p>');
}

function selfSigned(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'k.pem'), crt = path.join(dir, 'c.pem');
  if (!fs.existsSync(key)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt,
      '-days', '2', '-subj', '/CN=formsubmit.co',
      '-addext', 'subjectAltName=DNS:formsubmit.co,DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}
const mailTls = await listen(https.createServer(selfSigned(path.join(TMP, 'tls')), (q, s) => mailHandler('browser', q, s)), PORT.mailTls);
const mailHttp = await listen(http.createServer((q, s) => mailHandler('worker', q, s)), PORT.mailHttp);
say('stubs up: site ' + PORT.site + ', mail(browser leg, TLS, plays formsubmit.co) ' + PORT.mailTls
  + ', mail(Worker leg) ' + PORT.mailHttp + ', census ' + PORT.census);

/* --------------------------------------------------------------- wrangler dev */
const ADMIN_KEY = 'test-admin-key-' + crypto.randomBytes(9).toString('hex');
fs.writeFileSync(path.join(TMP, '.dev.vars'), [
  'ADMIN_KEY=' + ADMIN_KEY,
  'FORMSUBMIT_ENDPOINT=http://127.0.0.1:' + PORT.mailHttp + '/formsubmit',
  'SITE_BASE_URL=http://127.0.0.1:' + PORT.site,
  'PUBLIC_BASE_URL=http://127.0.0.1:' + PORT.worker,
  'QUOTE_LINK_BASE=http://127.0.0.1:' + PORT.site,
  'IGNORE_NEXT_ORIGIN=true',
  'ALLOW_TEST_HOOKS=true',
  '',
].join('\n'));
const cfg = path.join(TMP, 'wrangler.test.toml');
fs.writeFileSync(cfg, `
name = "umbra-intake-email-01"
main = ${JSON.stringify(path.join(WORKER_DIR, 'src', 'index.js'))}
base_dir = ${JSON.stringify(WORKER_DIR)}
compatibility_date = "2025-06-01"
rules = [ { type = "Text", globs = ["**/*.html"], fallthrough = false } ]

[vars]
SEED_LAST_ID = "0"

[[kv_namespaces]]
binding = "RECORDS"
id = "test-records"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "umbra-job-photos-test"

[[durable_objects.bindings]]
name = "BOOK"
class_name = "QuoteBook"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["QuoteBook"]
`);
let wlog = '';
const wrangler = spawn(process.execPath, [
  path.join(NM, 'wrangler', 'bin', 'wrangler.js'),
  'dev', '--config', cfg, '--port', String(PORT.worker), '--ip', '127.0.0.1',
  '--inspector-port', String(PORT.inspector),
  '--local', '--log-level', 'warn',
  '--persist-to', path.join(TMP, 'wrangler-state'),
], {
  cwd: WORKER_DIR,
  env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
wrangler.stdout.on('data', (d) => { wlog += d; });
wrangler.stderr.on('data', (d) => { wlog += d; });

const W = 'http://127.0.0.1:' + PORT.worker;
let up = false;
for (let i = 0; i < 160 && !up; i++) {
  await sleep(500);
  try { const r = await fetch(W + '/health'); if (r.ok) up = true; } catch (e) { /* not yet */ }
}
if (!up) {
  say('COULD NOT: wrangler dev did not come up');
  say(wlog.slice(-3000));
  flush();
  process.exit(1);
}
say('wrangler dev up on ' + PORT.worker + ' (local KV/R2/Durable Object; its FORMSUBMIT_ENDPOINT is the stub above)');

/* ------------------------------------------------------------------- the walk */
const CHROME = (() => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const c = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].find((x) => fs.existsSync(x));
  if (!c) throw new Error('no Chrome on this machine');
  return c;
})();
const PROFILE = path.join(TMP, 'chrome-profile');     /* FRESH, this run only */
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: PROFILE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars',
    '--host-resolver-rules=MAP formsubmit.co 127.0.0.1:' + PORT.mailTls
      + ', MAP www.formsubmit.co 127.0.0.1:' + PORT.mailTls
      + ', MAP *.workers.dev ~NOTFOUND, MAP geocoding.geo.census.gov ~NOTFOUND, MAP maps.googleapis.com ~NOTFOUND',
    '--ignore-certificate-errors', '--no-proxy-server'],
});
say('Chrome: FRESH profile, formsubmit.co -> 127.0.0.1:' + PORT.mailTls + ', *.workers.dev unresolvable');

const SITE = 'http://127.0.0.1:' + PORT.site;
const MENU = LANG === 'es' ? '/es/servicios' : '/services';
const DONE = LANG === 'es' ? '/es/recibido' : '/request-received';

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const reqs = [], errs = [];
/* the /intake body, by field NAME only: clause C has to show that nothing else in the
   request moved, and the only honest way to show it is to read the very body the page
   hands the Worker. Names and part sizes only - never a value. */
let intakeBody = null;
page.on('request', (r) => {
  reqs.push({ at: Date.now(), method: r.method(), url: r.url(), type: r.resourceType() });
  if (r.method() === 'POST' && r.url().indexOf('/intake') > 0 && !intakeBody) {
    const raw = r.postData();
    if (!raw) { intakeBody = { parts: null, note: 'Chrome did not hand the body over' }; return; }
    const b = raw.slice(0, raw.indexOf(CRLF));
    const names = [];
    if (b) {
      for (const chunk of raw.split(b)) {
        const m = chunk.match(/name="([^"]*)"/);
        if (m) names.push(m[1] + (/filename="[^"]+"/.test(chunk) ? ':file' : ''));
      }
    }
    intakeBody = { parts: names, bytes: raw.length };
  }
});
page.on('response', (r) => {
  for (let i = reqs.length - 1; i >= 0; i--) {
    if (reqs[i].url === r.url() && reqs[i].status === undefined) { reqs[i].status = r.status(); return; }
  }
});
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 240)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 240)));

if (STALE.size || CUT_BROWSER) {
  await page.setRequestInterception(true);
  page.on('request', async (r) => {
    try {
      const u = new URL(r.url());
      /* the 7-day cache: these URLs answer with the bytes the browser already had */
      if (STALE.size && u.port === String(PORT.site) && STALE.has(u.pathname)) {
        await r.respond({
          status: 200,
          headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=604800' },
          body: STALE.get(u.pathname),
        });
        return;
      }
      /* clause B: the browser's copy cut on purpose — the leg is tried and cannot land */
      if (CUT_BROWSER && /(^|\.)formsubmit\.co$/.test(u.hostname)) { await r.abort('connectionrefused'); return; }
      await r.continue();
    } catch (e) { try { await r.continue(); } catch (e2) { /* already handled */ } }
  });
}

const T0 = Date.now();
const rel = (t) => '+' + String(((t - T0) / 1000).toFixed(2)).padStart(7, ' ') + 's';

say('');
say('--- the walk (' + LANG + '): tile tap -> form -> send ---');
await page.goto(SITE + MENU, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('a.mtile', { timeout: 30000 });
const tile = await page.evaluate(() => {
  const a = document.querySelector('a.mtile');
  return a ? { key: a.getAttribute('data-menu-item'), name: ((a.querySelector('.mname') || {}).textContent || '').trim() } : null;
});
say('tile tapped: ' + JSON.stringify(tile));
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {}),
  page.click('a.mtile'),
]);
await page.waitForSelector('form.req', { timeout: 30000 });
await sleep(700);

/* fill whatever screen is up, then Next — the customer's own order, no field invented */
const FILL = `(() => {
  const f = document.querySelector('form.req');
  const steps = [...f.querySelectorAll('section.fstep')].filter((s) => !s.hidden && s.offsetParent !== null);
  const step = steps[steps.length - 1] || null;
  const which = step ? step.getAttribute('data-fstep') : null;
  const fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));
  if (step) {
    for (const el of step.querySelectorAll('input, textarea, select')) {
      if (el.form !== f) continue;
      if (el.type === 'radio') {
        const g = step.querySelectorAll('input[type=radio][name="' + el.name + '"]');
        if (![...g].some((x) => x.checked)) { el.checked = true; fire(el, 'change'); }
      } else if (el.type === 'checkbox') {
        if (el.name === 'avail_flexible' && !el.checked) { el.checked = true; fire(el, 'change'); }
      } else if (el.type === 'file' || el.type === 'hidden') {
        continue;
      } else if (!el.value) {
        /* only the fields a customer must give. Everything optional is left blank on
           purpose — the optional email box especially: a made-up word in it is not an
           address and the contact screen's own gate refuses it. */
        const v = el.name === 'name' ? 'TESTY TESTCASE'
          : el.name === 'phone' ? '(956) 555-0101'
          : el.name === 'address' ? '100 Test Street, Brownsville, TX 78521'
          : el.name === 'what' ? 'WORKER-EMAIL-01 stub reading, not a real request'
          : '';
        if (v) { el.value = v; fire(el, 'input'); fire(el, 'change'); }
      }
    }
    for (const g of step.querySelectorAll('ul')) {
      const boxes = [...g.querySelectorAll('input[type=checkbox]')];
      if (boxes.length && !boxes.some((x) => x.checked)) { boxes[0].checked = true; fire(boxes[0], 'change'); }
    }
  }
  const yes = document.querySelector('[data-uaddr-yes]');
  if (yes && yes.offsetParent !== null) yes.click();
  const send = f.querySelector('[data-v2send]');
  const next = f.querySelector('[data-v2next]');
  return {
    step: which,
    sendShown: Boolean(send && !send.hidden && send.offsetParent !== null),
    nextShown: Boolean(next && !next.hidden && next.offsetParent !== null),
    need: [...f.querySelectorAll('.v2need:not([hidden]), [data-uaddr-need]:not([hidden])')].map((p) => p.textContent.trim().slice(0, 80)).filter(Boolean),
  };
})()`;

const seen = [];
let state = null;
for (let i = 0; i < 60; i++) {
  state = await page.evaluate(FILL);
  const tag = state.step + (state.need.length ? ' need=' + JSON.stringify(state.need) : '');
  if (seen[seen.length - 1] !== tag) seen.push(tag);
  if (state.sendShown) break;
  if (!state.nextShown) { await sleep(300); continue; }
  await page.click('[data-v2next]');
  await sleep(320);
}
say('screens walked: ' + seen.join(' > '));

let sentOk = false;
if (!state || !state.sendShown) {
  say('COULD NOT: the Send button never appeared. last screen: ' + JSON.stringify(state));
} else {
  await page.evaluate(() => { const y = document.querySelector('[data-uaddr-yes]'); if (y) y.click(); });
  await sleep(200);
  const tSend = Date.now();
  say('');
  say(rel(tSend) + '  SEND tapped');
  await page.click('[data-v2send]');
  try {
    await page.waitForFunction('location.pathname.indexOf("' + DONE + '") === 0', { timeout: 90000, polling: 300 });
    sentOk = true;
  } catch (e) {
    say('COULD NOT: the page never reached ' + DONE + ' — it is at ' + page.url());
  }
  say(rel(Date.now()) + '  landed: ' + page.url().replace(SITE, '<site>'));
  await sleep(1500);
}

/* ------------------------------------------------------- what the page asked for */
say('');
say("--- the page's requests, in order (its own origin, the Worker, and the mail stub) ---");
for (const r of reqs) {
  const u = r.url.replace(SITE, '<site>').replace(W, '<worker>').replace('https://formsubmit.co', '<mail stub, as formsubmit.co>');
  if (/\.(png|jpg|jpeg|webp|svg|ico|woff2|css)(\?|$)/.test(u) && r.type !== 'document') continue;
  say('  ' + rel(r.at) + '  ' + String(r.method).padEnd(5) + ' ' + String(r.status === undefined ? '---' : r.status) + '  ' + u.slice(0, 150));
}
say('');
if (errs.length) { say('page errors:'); for (const e of errs) say('  ' + e); } else { say('page errors: none'); }

/* ----------------------------------------------------------------- the stub log */
say('');
say("--- the mail stub's log (field NAMES and part sizes only; no value is printed) ---");
if (!captured.length) say('  NOTHING REACHED THE MAIL STUB. No copy was sent by either leg.');
for (const c of captured) {
  say('  ' + rel(c.at) + '  leg=' + c.leg + '  ' + c.method + ' ' + c.url + '  ' + c.bytes + ' bytes'
    + (c.delayed_ms ? '  held ' + c.delayed_ms + ' ms' : '') + '  answered: ' + c.answered);
  say('      _next it was handed: ' + (c.next === null ? '(none)' : c.next));
  say('      ' + c.parts.length + ' parts: ' + c.parts.map((p) => p.name + (p.file ? '(file ' + p.bytes + 'B)' : '')).join(', '));
}

/* ----------------------------------------------------------------- the record */
say('');
say('');
say('--- the /intake body the page handed the Worker (field NAMES and total size only) ---');
if (!intakeBody) say('  no POST to /intake was seen');
else if (!intakeBody.parts) say('  ' + intakeBody.note);
else { say('  ' + intakeBody.bytes + ' bytes  ' + intakeBody.parts.length + ' parts:'); say('  ' + intakeBody.parts.join(', ')); }
say('');
say('--- the record the Worker wrote (GET /api/jobs?k=, adminRow) ---');
let rows = [];
try {
  const r = await fetch(W + '/api/jobs?k=' + ADMIN_KEY);
  const j = await r.json();
  rows = j.jobs || j.rows || (Array.isArray(j) ? j : []);
  if (!rows.length) say('  no record — the form never reached /intake');
  for (const row of rows) {
    const keep = ['id', 'forward_failed', 'forwarded_by', 'email_sent', 'email_copy_ms', 'sent_by', 'email_lost', 'photos', 'service'];
    say('  ' + keep.map((k) => k + '=' + JSON.stringify(row[k])).join('  '));
    if (row.status_note) say('  status_note: ' + String(row.status_note).slice(0, 420));
  }
} catch (e) { say('  COULD NOT read /api/jobs: ' + String(e)); }

/* --------------------------------------------------------------- the verdict */
const browserCopies = captured.filter((c) => c.leg === 'browser');
const workerCopies = captured.filter((c) => c.leg === 'worker');
say('');
say('--- COUNT: copies that reached the mail stub ---');
say('  by the browser: ' + browserCopies.length + '   by the Worker: ' + workerCopies.length + '   TOTAL: ' + captured.length);
say('  reached the received page: ' + (sentOk ? 'yes' : 'NO'));
say('');
say('finished ' + new Date().toISOString());

/* -------------------------------------------------------------------- cleanup */
try { await browser.close(); } catch (e) {}
wrangler.kill('SIGTERM');
await sleep(900);
try { wrangler.kill('SIGKILL'); } catch (e) {}
for (const s of [siteSrv, census, mailTls, mailHttp]) await new Promise((r) => s.close(r));
flush();
/* the /intake-side bodies, for clause C's diff — field names only, never a value */
fs.writeFileSync(OUT.replace(/\.txt$/, '') + '.parts.json', JSON.stringify({
  label: LABEL, lang: LANG, site: SITE_AT,
  record: rows.map((r) => ({ id: r.id, email_sent: r.email_sent, sent_by: r.sent_by, forwarded_by: r.forwarded_by, forward_failed: r.forward_failed, email_lost: r.email_lost })),
  copies: captured.map((c) => ({ leg: c.leg, parts: c.parts.map((p) => p.name + (p.file ? ':file' : '')) })),
  intake: intakeBody,
}, null, 1) + '\n');
process.exit(0);
