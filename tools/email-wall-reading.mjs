/* SITE-FIX-17 · E-21-b · THE EMAIL COPY'S WALL, AND WHAT THE CUSTOMER SEES WHILE IT WAITS.
   NOTHING HERE SENDS MAIL, A TEXT, OR A REQUEST TO ANYTHING BUT 127.0.0.1. No wrangler, no live Worker, no
   FormSubmit: both endpoints are this file's own stubs on a 49xx port it starts and stops, and the page under
   the browser is served from this worktree with assets/umbra-endpoint.js rewritten to point at them (the shape
   tools/r28-done-test/rig.mjs uses). Chrome is launched with *.workers.dev and formsubmit.co unresolvable, so a
   mistake cannot reach either.

   THE EDGE (Bridge/FLUX-REWALK-01/70-EDGES.md E-21-b): U-0020's copy landed at email_copy_ms 15004 against
   CAP_MS = 15000 - four milliseconds past the wall. A copy slower than the wall is reported `no`, the Worker's
   fallback fires, and FormSubmit answers that fallback 429 (it has answered 429 to every Worker send ever made),
   so the copy that WAS delivered is written off. The wall moves to 30 s.

   WHAT IT READS, every half second, from the real form the real asset is wired to: the submit button's words,
   whether the page has navigated, and the exact moment the request POST leaves - the whole of what the customer
   sees while the email leg waits.

     node tools/email-wall-reading.mjs --slow <ms> [--lang en|es] [--out <file>]
   --slow is how long the mail stub holds the copy before it redirects home. 20000 is the reading that separates
   a 15 s wall from a 30 s one. */
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) A[a.slice(2)] = (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) ? process.argv[++i] : true;
}
const SLOW = Number(A.slow || 20000);
const LANG = String(A.lang || 'en');
const OUT = A.out ? String(A.out) : null;
const PORT = Number(A.port || 4961);

const L = [];
const say = (s) => { L.push(s); console.log(s); };
let pass = 0, fail = 0;
const ok = (name, good, detail) => {
  if (good) { pass++; say('PASS  ' + name + (detail ? '  - ' + detail : '')); }
  else { fail++; say('FAIL  ' + name + (detail ? '  - ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- puppeteer and Chrome, as the repo's own readings find them */
const NM = [path.join(REPO, 'worker/node_modules'), 'C:/Users/andre/Umbra/umbrasitev1/worker/node_modules']
  .find((d) => fs.existsSync(path.join(d, 'puppeteer-core')));
if (!NM) throw new Error('no puppeteer-core on this machine');
const puppeteer = (await import('file:///' + path.join(NM, 'puppeteer-core/lib/esm/puppeteer/puppeteer-core.js').replace(/\\/g, '/'))).default;
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

/* ---------------------------------------------------------------- the wall as the asset carries it */
const ASSET = fs.readFileSync(path.join(REPO, 'assets/umbra-two-channels.js'), 'utf8');
const capLine = (ASSET.match(/var CAP_MS\s*=\s*Number\(window\.UMBRA_EMAIL_CAP_MS \|\| (\d+)\);/) || []);
const CAP = Number(capLine[1] || 0);

/* ---------------------------------------------------------------- the two stubs and the site, on one port */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
const mail = [], intake = [];
const T0 = { at: 0 };
/* Field NAMES only, and the three fields this reading is about. A customer's own answers are never logged. */
function fields(body) {
  const s = body.toString('latin1');
  const names = [];
  const re = /name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g;
  let m; const keep = {};
  while ((m = re.exec(s))) { names.push(m[1]); if (['email_sent', 'email_copy_ms', 'email_copy_id', '_next', 'sent_by'].includes(m[1])) keep[m[1]] = m[2]; }
  return { names, keep };
}
/* THE HARNESS PAGE: the real asset, the real endpoint file, a form.req carrying nothing a person owns - no name,
   no number, no address, no email. The leg does not care what the fields are; it copies whatever the form holds. */
const HARNESS = `<!doctype html>
<html lang="${LANG === 'es' ? 'es' : 'en'}"><head><meta charset="utf-8"><title>wall</title>
<script src="/assets/umbra-endpoint.js"></script>
<script src="/assets/umbra-two-channels.js" defer></script>
</head><body>
<form class="req" method="POST" action="https://formsubmit.co/REWRITTEN" enctype="multipart/form-data">
<input type="hidden" name="_subject" value="Service request from umbradomus.com">
<input type="hidden" name="_next" value="/request-received">
<label>Service <input type="text" name="service" value="Drywall patch, texture matched"></label>
<label>What <input type="text" name="what" value="TEST - SITE-FIX-17 wall reading, not a real job."></label>
<button type="submit">Send my request</button>
</form>
</body></html>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const f = fields(body);
      if (u.pathname === '/__formsubmit') {
        mail.push({ ms: Date.now() - T0.at, bytes: body.length, names: f.names, keep: f.keep });
        await sleep(SLOW);                                   /* the slow mail endpoint, the whole point of the reading */
        res.writeHead(302, { Location: f.keep._next || '/assets/email-copy-ok' }); res.end(); return;
      }
      if (u.pathname === '/__worker/intake') {
        intake.push({ ms: Date.now() - T0.at, bytes: body.length, names: f.names, keep: f.keep });
        res.writeHead(302, { Location: LANG === 'es' ? '/es/recibido' : '/request-received' }); res.end(); return;
      }
      res.writeHead(404); res.end('no'); return;
    });
    return;
  }
  if (u.pathname === '/__wall') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); res.end(HARNESS); return; }
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  if (!path.extname(p)) p += '.html';
  const file = path.join(REPO, p);
  if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  let buf = fs.readFileSync(file);
  if (p === '/assets/umbra-endpoint.js') {
    const host = 'http://127.0.0.1:' + PORT;
    let s = buf.toString('utf8');
    s = s.replace(/window\.UMBRA_WORKER_BASE = '[^']*'/, `window.UMBRA_WORKER_BASE = '${host}/__worker'`);
    s = s.replace(/var FORMSUBMIT = '[^']*'/, `var FORMSUBMIT = '${host}/__formsubmit'`);
    buf = Buffer.from(s, 'utf8');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  res.end(buf);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

say('SITE-FIX-17 · E-21-b · email-wall-reading · lang=' + LANG + ' · the mail stub holds the copy ' + SLOW + ' ms · ' + new Date().toISOString());
say('the wall the asset carries: CAP_MS = ' + CAP + '  (assets/umbra-two-channels.js)');
say('the site, both stubs and the harness page: 127.0.0.1:' + PORT + '  - started and stopped by this file');
say('');

const TMP = path.join(os.tmpdir(), 'sf17-wall-' + crypto.randomBytes(4).toString('hex'));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: path.join(TMP, 'profile'),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars',
    '--host-resolver-rules=MAP formsubmit.co ~NOTFOUND, MAP www.formsubmit.co ~NOTFOUND, MAP *.workers.dev ~NOTFOUND',
    '--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:' + PORT + '/__wall', { waitUntil: 'load' });

/* what the customer sees, every half second, from the tap on */
const seen = [];
T0.at = Date.now();
await page.click('button[type="submit"]');
for (let i = 0; i < Math.ceil((SLOW + 12000) / 500); i++) {
  const s = await page.evaluate(() => {
    const b = document.querySelector('button[type="submit"]');
    return { url: location.pathname, btn: b ? b.textContent.trim() : '(gone)', off: b ? !!b.disabled : null,
      body: (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90) };
  }).catch(() => ({ url: '(navigating)', btn: '(navigating)', off: null, body: '' }));
  seen.push({ ms: Date.now() - T0.at, ...s });
  if (intake.length && Date.now() - T0.at > intake[0].ms + 2500) break;
  await sleep(500);
}

say('--- WHAT THE CUSTOMER SEES, FROM THE TAP ON (every 500 ms, only when something changes) ---');
let last = '';
for (const s of seen) {
  const k = s.url + '|' + s.btn + '|' + s.off;
  if (k === last) continue;
  last = k;
  say('  +' + String(s.ms).padStart(6) + ' ms  at ' + s.url + '  button: "' + s.btn + '"' + (s.off ? ' (disabled)' : '') + (s.body ? '  page: ' + s.body : ''));
}
say('  (' + seen.length + ' samples)');
say('');
say('--- THE COPY AND THE REQUEST, AS THE STUBS TOOK THEM ---');
for (const m of mail) say('  the mail stub took the copy at +' + m.ms + ' ms  (' + m.bytes + ' bytes, ' + m.names.length + ' fields: ' + m.names.join(', ') + ')');
if (!mail.length) say('  NOTHING reached the mail stub');
for (const r of intake) say('  the request POST reached /intake at +' + r.ms + ' ms  email_sent=' + JSON.stringify(r.keep.email_sent) + '  email_copy_ms=' + JSON.stringify(r.keep.email_copy_ms));
if (!intake.length) say('  NOTHING reached the request endpoint');
say('');

const rec = intake[0] || null;
const copyMs = rec ? Number(rec.keep.email_copy_ms) : NaN;
const navAfter = seen.filter((s) => s.url !== '/__wall');
ok('e21b-wall-is-30s', CAP === 30000, 'CAP_MS reads ' + CAP + ' in assets/umbra-two-channels.js');
ok('e21b-copy-at-' + SLOW + 'ms-is-kept', !!rec && rec.keep.email_sent === 'yes',
  rec ? 'the page reported email_sent=' + rec.keep.email_sent + ' at email_copy_ms=' + rec.keep.email_copy_ms : 'no request was posted');
ok('e21b-no-worker-fallback-needed', !!rec && rec.keep.email_sent === 'yes',
  'on `no` the Worker forwards a second copy and FormSubmit answers it 429 - that is how U-0018 lost its email');
ok('e21b-received-page-does-not-hold-them', navAfter.every((s) => s.url !== '/__wall') && (!rec || copyMs <= SLOW + 4000),
  'every wait is spent BEFORE the navigation: the received page is reached only after the leg settles, and it waits for nothing');
ok('e21b-the-form-is-what-holds-them', seen.some((s) => s.off === true || /ending/i.test(s.btn)),
  'the button reads "Sending..." and is disabled for the whole wait - the hold is on the FORM, named in FOUND');

say('');
say('--- RESULT ---');
say((fail === 0 ? 'RESULT: PASS' : 'RESULT: FAIL') + '  pass ' + pass + '  fail ' + fail + '  CAP_MS=' + CAP + '  slow=' + SLOW);
try { await browser.close(); } catch (e) {}
await new Promise((r) => server.close(r));
fs.rmSync(TMP, { recursive: true, force: true });
if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, L.join('\n') + '\n'); }
process.exit(fail === 0 ? 0 : 1);
