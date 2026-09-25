/* ============================================================================
   THE TESTS. Real, headless, against a real `wrangler dev` with local KV and R2.
   Nothing here is mocked except the things we must not call for real:
   FormSubmit (Drew's inbox), and Pushover and Telegram (Drew's phone). All are
   stood up as real local servers and the bytes that reach them are parsed, not
   trusted. Every alert secret below is a FAKE made fresh for the run.

   Run:  cd worker && npm test
   ========================================================================== */

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { captureServer, staticServer, smsgateServer, close } from './lib/servers.mjs';
import { parseMultipart, fieldValue, files as filesOf } from './lib/multipart.mjs';
import { suiteAlerts } from './suite-d-alerts.mjs';
import { suiteWindows } from './suite-g-windows.mjs';
import { suiteBook } from './suite-h-book.mjs';
import { suitePage } from './suite-i-page.mjs';
import { suiteReminders } from './suite-j-reminders.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = path.resolve(HERE, '..');
const REPO_DIR = path.resolve(WORKER_DIR, '..');
const TMP = path.join(HERE, '.tmp');

/* The pre-change copies of the site, for the byte-identity suite (F). Where this
   was written that was a copy staged under /mnt/user-data; on Drew's machine no
   such copy exists, so the default is the repo itself — which makes suite F a
   self-comparison until UMBRA_ORIGINAL_SITE points at a genuinely older tree.
   The override stays in front: the next machine will differ again. */
const ORIGINAL_SITE = process.env.UMBRA_ORIGINAL_SITE || REPO_DIR;

/* ALERTS-01 (2026-09-23) moved the five stand-ins from 8788–8792 to 4771–4775: several rounds share
   this PC and that is the range this Worker's tests were given. The Worker itself stays on 8787.
   REMINDERS-01: several rounds now run this same suite on this same PC at the same time, and they
   cannot all have 8787 and 4771-4776. The defaults below are unchanged; UMBRA_TEST_WORKER_PORT and
   UMBRA_TEST_PORT_SHIFT move a run out of the way without touching anybody else's, and without
   anybody having to kill a process that is not theirs. */
const SHIFT = Number(process.env.UMBRA_TEST_PORT_SHIFT || 0);
const P = (n) => n + SHIFT;
const PORT = {
  worker: Number(process.env.UMBRA_TEST_WORKER_PORT || 8787),
  formsubmitTls: P(4771),   /* https, reached as https://formsubmit.co via a host-resolver rule */
  siteWorker: P(4772),      /* the modified site, constant flipped to the Worker */
  stub: P(4773),            /* http, what the Worker itself calls: FormSubmit + Pushover + Telegram */
  siteNew: P(4774),         /* the modified site, constant left on FormSubmit */
  siteOld: P(4775),         /* the site exactly as it was before this round */
  /* REMINDERS-01: the contract fake of SMSGate's cloud server. Nothing is ever sent from it. */
  smsgate: P(4770),
  /* The second Workers two suites stand up for a moment of their own: suite G's Sunday Worker (it
     closes them before suite I opens them again) and suite I's notice Worker. They were four bare
     numbers inside those files; they live here now so that ONE shift moves the whole suite out of
     another round's way, and none of them is left behind on somebody else's port. */
  extraA: P(4776), extraB: P(4777), extraC: P(4778), extraD: P(4779),
};
/* Two of these landing on the same number kills workerd at startup with "std::terminate() called with
   no exception" and nothing else — half an hour to work out, once. Say it here instead. */
{
  const seen = new Map();
  for (const [name, n] of Object.entries(PORT)) {
    if (seen.has(n)) throw new Error(`two test ports are the same: ${seen.get(n)} and ${name} are both ${n}. `
      + 'UMBRA_TEST_WORKER_PORT and UMBRA_TEST_PORT_SHIFT have been set so that they collide.');
    seen.set(n, name);
  }
}

const ADMIN_KEY = 'test-admin-key-' + crypto.randomBytes(9).toString('hex');
/* FAKE alert secrets, fresh each run, so a grep of any message can prove none of them leaked. */
const FAKE = {
  PUSHOVER_TOKEN: 'FAKEpotok' + crypto.randomBytes(8).toString('hex'),
  PUSHOVER_USER: 'FAKEpouser' + crypto.randomBytes(8).toString('hex'),
  TELEGRAM_BOT_TOKEN: '000000:FAKE' + crypto.randomBytes(8).toString('hex'),
  TELEGRAM_CHAT_ID: '-100' + String(crypto.randomInt(1e9)),
  HOOK_SECRET: 'FAKEhook' + crypto.randomBytes(10).toString('hex'),
};
/* REMINDERS-01: the SMSGate pair is one value, "user:pass", and it is FAKE. It is kept out of FAKE above
   because the leak scan treats every FAKE value as a single token, and this one is deliberately a pair. */
const FAKE_SMSGATE_AUTH = 'FAKEsmsuser' + crypto.randomBytes(5).toString('hex') + ':FAKEsmspass' + crypto.randomBytes(8).toString('hex');
/** The Chrome that puppeteer-core drives. CHROME_PATH wins; otherwise the first
    of the usual install locations that exists on this machine. No Chrome is a
    loud stop, never a silent skip. */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = process.platform === 'win32' ? [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ] : [
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/home/claude/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome',
  ];
  const hit = candidates.find((c) => fs.existsSync(c));
  if (!hit) throw new Error('no Chrome found — set CHROME_PATH. Looked at:\n  ' + candidates.join('\n  '));
  return hit;
}
const CHROME = findChrome();

/* ------------------------------------------------------------- test plumbing */

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

/* ------------------------------------------------------------------ fixtures */

/** A tiny solid-colour PNG. Small enough that the page's shrink step keeps the
    original bytes, which makes the byte-identity comparison deterministic. */
function png(r, g, b) {
  const W = 8, H = 8;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) { raw[o++] = r; raw[o++] = g; raw[o++] = b; }
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

/* ------------------------------------------------------------------ site copies */

function copyTree(from, to, skip = []) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyTree(a, b, skip);
    else if (e.isFile()) fs.copyFileSync(a, b);
  }
}

/** The one-line switch, applied exactly as Drew would apply it. The line reads
    `window.UMBRA_WORKER_BASE = '<whatever it is today>';` — since Stage 1 that
    is the real Worker's URL, not '' — so the match is on the line's shape, never
    on a particular value. A miss THROWS: a copy that did not flip posts to
    whatever the repo points at, and every assertion downstream measures the
    wrong thing. Returns the before/after lines for the proof. */
const ONE_LINE = /^window\.UMBRA_WORKER_BASE = '[^'\r\n]*';[ \t]*$/m;
function flipConstant(root, base) {
  const f = path.join(root, 'assets', 'umbra-endpoint.js');
  const before = fs.readFileSync(f, 'utf8');
  const m = before.match(ONE_LINE);
  if (!m) throw new Error(`the one line was not found in ${f} — expected a line shaped like window.UMBRA_WORKER_BASE = '…';`);
  const line = `window.UMBRA_WORKER_BASE = '${base}';`;
  const after = before.replace(ONE_LINE, () => line);
  if (after !== before) fs.writeFileSync(f, after);
  console.log(`flip ${path.relative(TMP, f)}: ${m[0].trim()}  →  ${line}${after === before ? '  (already so)' : ''}`);
  return { before: m[0].trim(), after: line, changed: after !== before };
}

/* -------------------------------------------------------------- browser helper */

async function fillAndSubmit(page, url, { photos = [], honey = null, waitNav = true } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const f = document.querySelector('form.req');
    const set = (sel, v) => { const el = f.querySelector(sel); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('[name="name"]', 'Testy McTest');
    set('[name="phone"]', '(956) 555-0101');
    set('[name="address"]', '100 Palm Blvd, Brownsville');
    /* services and the two Spanish pages call it `what`; contact.html calls it
       `message`. Both are required, so both get filled. */
    set('textarea[name="what"]', 'Two holes in the ceiling, about the size of a fist, over the kitchen table.');
    set('textarea[name="message"]', 'Two holes in the ceiling, about the size of a fist, over the kitchen table.');
    const radio = f.querySelector('input[name="service"]');
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  if (honey !== null) {
    await page.evaluate((v) => { document.querySelector('form.req [name="_honey"]').value = v; }, honey);
  }
  if (photos.length) {
    const input = await page.$('form.req [data-photo-input]');
    await input.uploadFile(...photos);
    await page.waitForFunction(
      (n) => document.querySelectorAll('form.req [data-photo-list] li').length === n,
      { timeout: 10000 }, photos.length,
    );
  }
  const nav = waitNav ? page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null) : Promise.resolve(null);
  await page.evaluate(() => {
    const f = document.querySelector('form.req');
    f.querySelector('button[type="submit"]').click();
  });
  await nav;
  await sleep(250);
  return page.url();
}

/** What a submission looks like, reduced to the things that must not change. */
function shapeOf(parts) {
  return parts.map((p) => ({
    name: p.name,
    isFile: p.isFile,
    filename: p.filename,
    contentType: p.isFile ? p.contentType : null,
    sha256: p.sha256,
  }));
}

/* ------------------------------------------------------------------------ main */

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  /* --- fixtures ---------------------------------------------------------- */
  const FIX = path.join(TMP, 'fixtures');
  fs.mkdirSync(FIX, { recursive: true });
  const photoA = path.join(FIX, 'kitchen-ceiling.png');
  const photoB = path.join(FIX, 'hallway.png');
  fs.writeFileSync(photoA, png(200, 30, 30));
  fs.writeFileSync(photoB, png(30, 60, 200));
  const shaA = crypto.createHash('sha256').update(fs.readFileSync(photoA)).digest('hex');
  const shaB = crypto.createHash('sha256').update(fs.readFileSync(photoB)).digest('hex');
  if (shaA === shaB) throw new Error('fixtures are identical');

  /* --- site copies ------------------------------------------------------- */
  const SKIP = ['worker', '.git', 'node_modules', '_git-stale-locks-2026-09-06', 'Claude outputs', 'tools'];
  const siteWorker = path.join(TMP, 'site-worker');
  const siteNew = path.join(TMP, 'site-new');
  const siteOld = path.join(TMP, 'site-old');
  copyTree(REPO_DIR, siteWorker, SKIP);
  copyTree(REPO_DIR, siteNew, SKIP);
  copyTree(ORIGINAL_SITE, siteOld, SKIP);
  /* siteWorker points at the Worker under test. siteNew is "the modified site
     with the constant left on FormSubmit" — that is '', and since Stage 1 the
     repo no longer ships '' there, so it is put there here. siteOld gets the
     same when it carries the file (a pre-Stage-1 tree does not, and posts to
     FormSubmit by its markup alone). NO test copy may ever reach production. */
  const flips = {
    worker: flipConstant(siteWorker, `http://127.0.0.1:${PORT.worker}`),
    new: flipConstant(siteNew, ''),
    old: fs.existsSync(path.join(siteOld, 'assets', 'umbra-endpoint.js')) ? flipConstant(siteOld, '') : null,
  };
  if (!flips.worker.changed) throw new Error('siteWorker did not change on flip — it would be indistinguishable from an unflipped copy');
  const servedWorker = fs.readFileSync(path.join(siteWorker, 'assets', 'umbra-endpoint.js'), 'utf8');
  const servedNew = fs.readFileSync(path.join(siteNew, 'assets', 'umbra-endpoint.js'), 'utf8');
  if (servedWorker === servedNew) throw new Error('site-worker and site-new serve byte-identical umbra-endpoint.js — the flip did not flip');

  /* --- servers ----------------------------------------------------------- */
  const stub = await captureServer({ port: PORT.stub, tls: false });
  const relay = await captureServer({ port: PORT.formsubmitTls, tls: true, tlsDir: TMP });
  /* ACCEPT-PAGE-02: this copy of the site also plays vercel.json's rewrite, /q/* to the Worker under test */
  const sw = await staticServer({ port: PORT.siteWorker, root: siteWorker, proxy: `http://127.0.0.1:${PORT.worker}` });
  const sn = await staticServer({ port: PORT.siteNew, root: siteNew });
  const so = await staticServer({ port: PORT.siteOld, root: siteOld });
  /* REMINDERS-01: the fake SMSGate. It never sends anything; it logs and answers. */
  const gate = await smsgateServer({ port: PORT.smsgate });

  /* --- wrangler dev ------------------------------------------------------ */
  const devVars = [
    `ADMIN_KEY=${ADMIN_KEY}`,
    ...Object.entries(FAKE).map(([k, v]) => `${k}=${v}`),
    `PUSHOVER_API_BASE=http://127.0.0.1:${PORT.stub}/pushover`,
    `TELEGRAM_API_BASE=http://127.0.0.1:${PORT.stub}/telegram`,
    `FORMSUBMIT_ENDPOINT=http://127.0.0.1:${PORT.stub}/formsubmit`,
    `SITE_BASE_URL=http://127.0.0.1:${PORT.siteWorker}`,
    `PUBLIC_BASE_URL=http://127.0.0.1:${PORT.worker}`,
    'IGNORE_NEXT_ORIGIN=true',
    'ALLOW_TEST_HOOKS=true',
    /* REMINDERS-01: a FAKE pair, fresh each run, and a 127.0.0.1 base the Worker only honours because
       ALLOW_TEST_HOOKS is on. Drew's real SMSGATE_AUTH is never read, written or printed by this suite. */
    `SMSGATE_AUTH=${FAKE_SMSGATE_AUTH}`,
    `SMSGATE_API_BASE=http://127.0.0.1:${PORT.smsgate}`,
    /* ACCEPT-PAGE-01: the quote link points at the local site copy, never umbradomus.com */
    `QUOTE_LINK_BASE=http://127.0.0.1:${PORT.siteWorker}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(TMP, '.dev.vars'), devVars);

  const cfg = path.join(TMP, 'wrangler.test.toml');
  fs.writeFileSync(cfg, `
name = "umbra-intake-test"
main = ${JSON.stringify(path.join(WORKER_DIR, 'src', 'index.js'))}
base_dir = ${JSON.stringify(WORKER_DIR)}
compatibility_date = "2025-06-01"
rules = [ { type = "Text", globs = ["**/*.html"], fallthrough = false } ]

[vars]
SEED_LAST_ID = "2"

[[kv_namespaces]]
binding = "RECORDS"
id = "test-records"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "umbra-job-photos-test"

[triggers]
crons = ["*/5 * * * *"]

# ACCEPT-PAGE-01: the book, exactly as wrangler.toml declares it
[[durable_objects.bindings]]
name = "BOOK"
class_name = "QuoteBook"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["QuoteBook"]
`);

  console.log('starting wrangler dev…');
  const wrangler = spawn(
    process.execPath,
    [path.join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'dev', '--config', cfg, '--port', String(PORT.worker), '--ip', '127.0.0.1',
      /* REMINDERS-01: wrangler's inspector is 9229 by default and two rounds on this PC would fight
         over it — the runtime dies at startup with no useful word. It moves with the shift. */
      '--inspector-port', String(9229 + SHIFT),
      '--local', '--log-level', 'warn',
      '--persist-to', path.join(TMP, 'wrangler-state')],
    {
      cwd: WORKER_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let wlog = '';
  wrangler.stdout.on('data', (d) => { wlog += d; });
  wrangler.stderr.on('data', (d) => { wlog += d; });

  /* wrangler reads .dev.vars from the directory of the --config it was given
     (getVarsForDev: path.resolve(dirname(userConfigPath), '.dev.vars')), so the
     one written into TMP above is the one it sees. worker/.dev.vars is Drew's
     real file and is never touched. */

  const W = `http://127.0.0.1:${PORT.worker}`;
  let up = false;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(W + '/health');
      if (r.ok) { up = true; break; }
    } catch (err) { /* not yet */ }
    await sleep(500);
  }
  if (!up) {
    console.error(wlog);
    throw new Error('wrangler dev did not come up');
  }
  console.log('wrangler dev is up\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      /* formsubmit.co lands on the TLS relay; every *.workers.dev name is
         unresolvable, so no test copy can reach the production Worker even if
         a flip were ever missed. */
      `--host-resolver-rules=MAP formsubmit.co 127.0.0.1:${PORT.formsubmitTls}, MAP *.workers.dev ~NOTFOUND`,
      '--ignore-certificate-errors',
      /* the container's outbound proxy would swallow the host-resolver rule */
      '--no-proxy-server',
    ],
  });

  const cleanup = async () => {
    try { await browser.close(); } catch (e) {}
    wrangler.kill('SIGTERM');
    await Promise.all([close(stub), close(relay), close(sw), close(sn), close(so), close(gate)]);
  };

  try {
    await runSuites({ browser, W, stub, relay, gate, photoA, photoB, shaA, shaB, wlogRef: () => wlog, sw, siteWorker });
  } finally {
    await cleanup();
  }

  /* --- the tally --------------------------------------------------------- */
  console.log('\n================ RESULTS ================');
  let pass = 0, fail = 0;
  for (const [name, s] of suites) {
    console.log(`${s.fail === 0 ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${s.pass} passed, ${s.fail} failed`);
    for (const n of s.notes) console.log(`        · ${n}`);
    pass += s.pass; fail += s.fail;
  }
  console.log('-----------------------------------------');
  console.log(`TOTAL ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------- suites */

async function runSuites({ browser, W, stub, relay, gate, photoA, photoB, shaA, shaB, wlogRef, sw, siteWorker }) {
  /* REMINDERS-01 · UMBRA_ONLY="J" runs one suite and skips the rest. It exists for the mutant pass:
     a mutant has to be RED on one named reading, and running the whole suite seven times over to see
     it would take an hour. Unset — every ordinary run, and the run whose count goes in a close — every
     suite runs, in order, as it always did. */
  const ONLY = process.env.UMBRA_ONLY ? new Set(process.env.UMBRA_ONLY.split(',').map((x) => x.trim())) : null;
  const want = (letter) => !ONLY || ONLY.has(letter);
  if (ONLY) console.log('UMBRA_ONLY=' + [...ONLY].join(',') + ' — the other suites are skipped');
  const SITE = `http://127.0.0.1:${PORT.siteWorker}`;
  let lastDialog = null;
  const page = await browser.newPage();
  page.on('dialog', async (d) => { lastDialog = d.message(); await d.dismiss(); });
  const forwards = () => stub.captured.filter((c) => c.url.startsWith('/formsubmit') && c.method === 'POST');
  const relayPosts = () => relay.captured.filter((c) => c.method === 'POST');

  const json = async (url, init) => {
    const r = await fetch(url, init);
    let body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    return { status: r.status, body, headers: r.headers };
  };

  /* ===================================================================== A1 */
  let recA = null, tokenA = null;
  if (want('A')) {
  suite('A · intake from the real form (2 photos)');
  {
    const before = forwards().length;
    const beforeRelay = relayPosts().length;
    const landed = await fillAndSubmit(page, SITE + '/services#request', { photos: [photoA, photoB] });
    ok(landed.startsWith(`http://127.0.0.1:${PORT.siteWorker}/request-received`), 'redirect landed on the confirmation page', landed);
    const u = new URL(landed);
    const id = u.searchParams.get('id');
    tokenA = u.searchParams.get('t');
    recA = id;
    eq(id, 'U-0003', 'the first live record is U-0003 (U-0001 and U-0002 exist on paper)');
    ok(tokenA && tokenA.length >= 22, 'the confirmation link carries a token of at least 128 bits', tokenA ? `${tokenA.length} base64url chars` : 'missing');
    const shown = await page.evaluate(() => document.getElementById('jobnote') && !document.getElementById('jobnote').hidden
      ? document.getElementById('jobnote').textContent.replace(/\s+/g, ' ').trim() : null);
    ok(shown && shown.includes('Your request number is ' + id), 'the confirmation page shows the request number', shown);
    const href = await page.evaluate(() => document.getElementById('joblink') && document.getElementById('joblink').getAttribute('href'));
    ok(href && href.includes('/status?id=') && href.includes('t='), 'the confirmation page links to the status page with id and token', href);

    /* the record */
    const rec = await json(`${W}/api/job/${id}?t=${encodeURIComponent(tokenA)}`);
    eq(rec.status, 200, 'the customer view answers with the record');
    eq(rec.body && rec.body.status, 'received', 'status is "received"');
    ok(rec.body && rec.body.received_at && !isNaN(Date.parse(rec.body.received_at)), 'received_at is a real ISO instant', rec.body && rec.body.received_at);
    ok(rec.body && /CST|CDT/.test(rec.body.received_at_chicago || ''), 'received_at_chicago is a Central wall clock', rec.body && rec.body.received_at_chicago);
    eq(rec.body && rec.body.photos.length, 2, 'two photos on the record');

    /* the fields, verbatim, through the admin view */
    const jobs = await json(`${W}/api/jobs?k=${ADMIN_KEY}`);
    const row = jobs.body.jobs.find((j) => j.id === id);
    eq(row.name, 'Testy McTest', 'name stored verbatim');
    eq(row.phone, '(956) 555-0101', 'phone stored verbatim');
    eq(row.address, '100 Palm Blvd, Brownsville', 'address stored verbatim');
    ok(row.what.startsWith('Two holes in the ceiling'), 'the description is stored verbatim, uncleaned');
    ok(row.service && row.service.length > 0, 'the service category is stored', row.service);

    /* the photos, in R2, distinct */
    const p1 = await fetch(`${W}/api/photo/${id}/1?t=${encodeURIComponent(tokenA)}`);
    const p2 = await fetch(`${W}/api/photo/${id}/2?t=${encodeURIComponent(tokenA)}`);
    const b1 = Buffer.from(await p1.arrayBuffer());
    const b2 = Buffer.from(await p2.arrayBuffer());
    const h1 = crypto.createHash('sha256').update(b1).digest('hex');
    const h2 = crypto.createHash('sha256').update(b2).digest('hex');
    eq(p1.status, 200, 'photo 1 serves through the Worker');
    ok((p1.headers.get('content-type') || '').startsWith('image/'), 'photo 1 carries an image content type', p1.headers.get('content-type'));
    ok(h1 !== h2, 'the two photos are genuinely different bytes in R2');
    ok(new Set([h1, h2]).size === 2 && (h1 === shaA || h1 === shaB), 'the stored bytes are the bytes that were picked');
    const recPhotos = (await json(`${W}/api/job/${id}?t=${encodeURIComponent(tokenA)}`)).body.photos;
    ok(recPhotos.every((p) => p.url.startsWith('/api/photo/')), 'photo URLs go through the Worker, never a raw R2 URL');

    /* the forward */
    for (let i = 0; i < 40 && forwards().length === before; i++) await sleep(100);
    const f = forwards().slice(before);
    eq(f.length, 1, 'exactly one forward to FormSubmit');
    if (f.length) {
      const parts = parseMultipart(f[0].body, f[0].headers['content-type']);
      const names = parts.map((p) => p.name);
      for (const n of ['_subject', '_captcha', '_template', '_next', 'service', 'name', 'phone', 'address', 'what', 'attachment1', 'attachment2']) {
        ok(names.includes(n), `the forward carries the field "${n}" under its own name`);
      }
      eq(fieldValue(parts, 'job_id'), id, 'the forward adds job_id');
      ok((fieldValue(parts, 'status_link') || '').includes('/status?id=' + id), 'the forward adds status_link', fieldValue(parts, 'status_link'));
      const ff = filesOf(parts);
      eq(ff.length, 2, 'both photos are forwarded');
      ok(ff[0].sha256 !== ff[1].sha256, 'the two forwarded photos are different files (MULTIPLE-FILES-ONE-NAME stays closed)');
      ok(!names.includes('_honey') || fieldValue(parts, '_honey') === '', 'the honeypot is not forwarded with a value');
      /* EMAIL-SUBJECT-01: every job's email carries its own subject — the first name and the Central
         time — so Gmail never stacks two jobs in one conversation (a stacked one arrives silent). */
      const subj = fieldValue(parts, '_subject') || '';
      ok(/^Service request from umbradomus\.com · Testy · \d{1,2}\/\d{1,2} \d{1,2}:\d{2} (AM|PM)$/.test(subj),
        'EMAIL-SUBJECT-01: the subject carries the first name and the Central time, stamped once', subj);
      const copies = relayPosts().slice(beforeRelay);
      const copySubj = copies.length ? (fieldValue(parseMultipart(copies[0].body, copies[0].headers['content-type']), '_subject') || '') : null;
      eq(copySubj, subj, "EMAIL-SUBJECT-01: the browser's own copy carries the very same subject");
    }
    /* the record knows the email went */
    const jobs2 = await json(`${W}/api/jobs?k=${ADMIN_KEY}`);
    eq(jobs2.body.jobs.find((j) => j.id === id).forward_failed, false, 'forward_failed is false when FormSubmit answered');
  }

  /* ===================================================================== A2 */
  suite('A · intake with no photo');
  let recB = null, tokenB = null;
  {
    const before = forwards().length;
    const landed = await fillAndSubmit(page, SITE + '/services#request', { photos: [] });
    const u = new URL(landed);
    recB = u.searchParams.get('id');
    tokenB = u.searchParams.get('t');
    eq(recB, 'U-0004', 'the id increments to U-0004');
    const rec = await json(`${W}/api/job/${recB}?t=${encodeURIComponent(tokenB)}`);
    eq(rec.status, 200, 'the record exists');
    eq(rec.body.photos.length, 0, 'no photos on the record');
    for (let i = 0; i < 40 && forwards().length === before; i++) await sleep(100);
    const f = forwards().slice(before);
    eq(f.length, 1, 'the email still goes out with no photo');
    if (f.length) {
      const parts = parseMultipart(f[0].body, f[0].headers['content-type']);
      eq(filesOf(parts).filter((p) => p.size > 0).length, 0, 'no file parts with bytes');
      eq(fieldValue(parts, 'job_id'), recB, 'job_id still added');
    }
  }

  /* ===================================================================== A3 */
  suite('A · honeypot');
  {
    const beforeF = forwards().length;
    const beforeJobs = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.count;
    const landed = await fillAndSubmit(page, SITE + '/services#request', { honey: 'http://spam.example/buy' });
    ok(landed.startsWith(`http://127.0.0.1:${PORT.siteWorker}/request-received`), 'the bot is shown an ordinary confirmation', landed);
    const u = new URL(landed);
    ok(!u.searchParams.get('id'), 'no id is handed back');
    await sleep(600);
    const afterJobs = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.count;
    eq(afterJobs, beforeJobs, 'no record was created');
    eq(forwards().length, beforeF, 'nothing was emailed');
  }

  /* ===================================================================== A4 */
  suite('A · oversized files are refused out loud');
  {
    /* Worker-side cap: a single file over 10 MB. */
    const big = new Blob([new Uint8Array(11 * 1024 * 1024)], { type: 'image/jpeg' });
    const fd = new FormData();
    fd.set('_subject', 'Service request from umbradomus.com');
    fd.set('_next', 'https://www.umbradomus.com/request-received');
    fd.set('name', 'Too Big');
    fd.set('phone', '9565550102');
    fd.set('what', 'one enormous photo');
    fd.set('attachment1', big, 'huge.jpg');
    const beforeJobs = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.count;
    const beforeF = forwards().length;
    const r = await fetch(`${W}/intake`, { method: 'POST', body: fd, redirect: 'manual' });
    const msg = await r.text();
    eq(r.status, 413, 'a single file over 10 MB is refused with 413');
    ok(/10 MB/.test(msg) && /Nothing was sent/.test(msg) && /956/.test(msg), 'the refusal says what happened and what to do instead', msg.slice(0, 120));
    eq((await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.count, beforeJobs, 'no record was created for a refused submit');
    eq(forwards().length, beforeF, 'nothing was emailed for a refused submit');

    /* Worker-side cap: three files under 10 MB each, over 25 MB together. */
    const fd2 = new FormData();
    fd2.set('name', 'Too Much');
    fd2.set('what', 'lots of photos');
    for (let i = 1; i <= 3; i++) fd2.set('attachment' + i, new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'image/jpeg' }), `p${i}.jpg`);
    const r2 = await fetch(`${W}/intake`, { method: 'POST', body: fd2, redirect: 'manual' });
    const msg2 = await r2.text();
    eq(r2.status, 413, 'more than 25 MB in total is refused with 413');
    ok(/25 MB/.test(msg2), 'the total-size refusal names the 25 MB limit', msg2.slice(0, 100));

    /* And the page's own guard, ahead of the Worker: 9 MB, one file, no submit. */
    const bigFile = path.join(path.dirname(photoA), 'enormous.jpg');
    fs.writeFileSync(bigFile, Buffer.alloc(9.5 * 1024 * 1024));
    lastDialog = null;
    const beforeJobs2 = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.count;
    await fillAndSubmit(page, SITE + '/services#request', { photos: [bigFile], waitNav: false }).catch(() => {});
    await sleep(1500);
    eq((await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.count, beforeJobs2, 'the page stops an oversized photo before it is ever sent');
    ok(lastDialog && /too big/i.test(lastDialog), 'and it says so to the customer', lastDialog);
  }

  /* ===================================================================== A5 */
  suite('A · two channels: neither one can take the other down');
  {
    /* FormSubmit is down. The record must still be kept, and must say so. */
    stub.state.mode = 'fail';
    const fd = new FormData();
    fd.set('_subject', 'Service request from umbradomus.com');
    fd.set('_next', 'https://www.umbradomus.com/request-received');
    fd.set('name', 'Relay Down');
    fd.set('phone', '9565550199');
    fd.set('what', 'The relay is refusing mail right now.');
    const beforeF = forwards().length;
    const r = await fetch(`${W}/intake`, { method: 'POST', body: fd, redirect: 'manual' });
    stub.state.mode = 'ok';
    eq(r.status, 303, 'the customer is still redirected as normal');
    const loc = new URL(r.headers.get('location'));
    const id = loc.searchParams.get('id');
    ok(id, 'a record id was still issued', id);
    ok(forwards().length > beforeF, 'the forward was still attempted');
    const row = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.jobs.find((j) => j.id === id);
    eq(row.forward_failed, true, 'and the record is flagged forward_failed');
    const md = await (await fetch(`${W}/api/export/${id}.md?k=${ADMIN_KEY}`)).text();
    ok(md.includes('forward_failed'), 'the flag is visible in the markdown export');
    ok(/\| `forward_failed` \|/.test(md) || md.includes('**NO — `forward_failed`**'), 'named plainly in section A');
  }

  /* ====================================================================== B */
  suite('B · the customer view');
  {
    const good = await json(`${W}/api/job/${recA}?t=${encodeURIComponent(tokenA)}`);
    eq(good.status, 200, 'the right token returns the record');
    const l = good.body.ladder.map((s) => s.step).join(',');
    eq(l, 'received,quoted,scheduled,done', 'the four-step ladder is returned in order');
    ok(good.body.ladder[0].at && !good.body.ladder[1].at, 'only the steps that happened carry a timestamp');
    ok(!('token' in good.body) && !('fields' in good.body), 'the customer view leaks neither the token nor the raw field bag');
    eq(good.headers.get('access-control-allow-origin'), '*', 'the customer view is readable from the site origin');

    const wrong = await json(`${W}/api/job/${recA}?t=totally-wrong-token`);
    const missing = await json(`${W}/api/job/${recA}`);
    const nobody = await json(`${W}/api/job/U-9999?t=whatever`);
    eq(wrong.status, 404, 'a wrong token is a 404');
    eq(missing.status, 404, 'a missing token is a 404');
    eq(nobody.status, 404, 'an id that never existed is a 404');
    eq(JSON.stringify(wrong.body), JSON.stringify(nobody.body), 'wrong token and unknown id answer with an identical body');
    eq(JSON.stringify(missing.body), JSON.stringify(nobody.body), 'missing token and unknown id answer with an identical body');

    const ph = await fetch(`${W}/api/photo/${recA}/1?t=${encodeURIComponent(tokenA)}`);
    eq(ph.status, 200, 'the photo endpoint serves bytes');
    eq(ph.headers.get('content-type'), 'image/png', 'with the content type it was stored under');
    ok(Buffer.from(await ph.arrayBuffer()).length > 0, 'and the bytes are not empty');
    const phBad = await fetch(`${W}/api/photo/${recA}/1?t=nope`);
    eq(phBad.status, 404, 'a wrong token gets no photo');

    /* the status page renders it */
    const sp = await browser.newPage();
    await sp.goto(`${SITE}/status?id=${recA}&t=${encodeURIComponent(tokenA)}`, { waitUntil: 'domcontentloaded' });
    await sp.waitForFunction(() => !document.getElementById('live').hidden, { timeout: 15000 }).catch(() => null);
    const live = await sp.evaluate(() => {
      const el = document.getElementById('live');
      return el && !el.hidden ? {
        head: document.getElementById('live-head').textContent,
        steps: [...document.querySelectorAll('#live-track li')].map((li) => li.className + ':' + li.querySelector('strong').textContent),
        photos: document.querySelectorAll('#live-photos li').length,
        genericHidden: document.getElementById('generic').hidden,
      } : null;
    });
    ok(live, 'the status page shows the real ladder when the link carries id and token');
    if (live) {
      eq(live.steps.length, 4, 'four steps rendered');
      eq(live.steps[0], 'now:Received', 'Received is the current step');
      eq(live.photos, 2, 'the customer sees their own photos');
      eq(live.genericHidden, true, 'the "it is being built" copy is replaced');
    }
    /* and without the query it is exactly today's page */
    await sp.goto(`${SITE}/status`, { waitUntil: 'domcontentloaded' });
    await sleep(800);
    const plain = await sp.evaluate(() => ({
      liveHidden: document.getElementById('live').hidden,
      genericHidden: document.getElementById('generic').hidden,
      text: document.body.textContent.includes("It's being built"),
    }));
    eq(plain.liveHidden, true, 'with no id the live block stays hidden');
    eq(plain.genericHidden, false, 'with no id the page is unchanged');
    eq(plain.text, true, 'and still says honestly that it is being built');
    /* a wrong token must not tell a stranger the job exists */
    await sp.goto(`${SITE}/status?id=${recA}&t=wrong`, { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    const bad = await sp.evaluate(() => document.getElementById('live').hidden && !document.getElementById('generic').hidden);
    eq(bad, true, 'a wrong token shows the ordinary page, not an error that confirms the id');
    await sp.close();
  }

  /* ====================================================================== C */
  suite('C · the admin view and the taps');
  {
    const noKey = await json(`${W}/api/jobs`);
    const badKey = await json(`${W}/api/jobs?k=guess`);
    eq(noKey.status, 404, 'the jobs list needs the admin key');
    eq(badKey.status, 404, 'a wrong admin key is a 404, not a 403');
    const adminPage = await fetch(`${W}/admin?k=nope`);
    eq(adminPage.status, 404, 'the admin page needs the key too');
    const adminOkRes = await fetch(`${W}/admin?k=${ADMIN_KEY}`);
    eq(adminOkRes.status, 200, 'with the key the admin page is served');
    ok((await adminOkRes.text()).includes('oldest unquoted first'), 'and it is the aging list');

    const before = await json(`${W}/api/jobs?k=${ADMIN_KEY}`);
    const rowBefore = before.body.jobs.find((j) => j.id === recA);
    ok(rowBefore.minutes_open != null, 'every row carries minutes_open', String(rowBefore.minutes_open));

    const ev = await json(`${W}/api/job/${recA}/event?k=${ADMIN_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'quoted', quote_amount: 175, scope: 'Patch two fist-sized holes in the kitchen ceiling, texture matched, one coat over the patch.' }),
    });
    eq(ev.status, 200, 'the Quoted tap is accepted');
    eq(ev.body.status, 'quoted', 'status moves to quoted');
    ok(ev.body.quoted_at && !isNaN(Date.parse(ev.body.quoted_at)), 'quoted_at is stamped', ev.body.quoted_at);
    ok(ev.body.minutes_to_quote != null && ev.body.minutes_to_quote >= 0, 'minutes_to_quote is computed', String(ev.body.minutes_to_quote));

    const evBad = await json(`${W}/api/job/${recA}/event?k=wrong`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'done' }),
    });
    eq(evBad.status, 404, 'the taps need the admin key');

    const evType = await json(`${W}/api/job/${recA}/event?k=${ADMIN_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'invented' }),
    });
    eq(evType.status, 400, 'an unknown event type is refused');

    const after = await json(`${W}/api/jobs?k=${ADMIN_KEY}`);
    const ids = after.body.jobs.map((j) => j.id);
    const unquoted = after.body.jobs.filter((j) => !j.quoted_at);
    const firstQuotedAt = after.body.jobs.findIndex((j) => j.quoted_at);
    ok(unquoted.length > 0, 'there are still unquoted requests to sort');
    ok(firstQuotedAt === -1 || firstQuotedAt >= unquoted.length, 'every unquoted request sorts above every quoted one', ids.join(','));
    const opens = unquoted.map((j) => Date.parse(j.received_at));
    ok(opens.every((v, i) => i === 0 || opens[i - 1] <= v), 'and the unquoted block runs oldest first');

    /* the scope the customer now sees */
    const cust = await json(`${W}/api/job/${recA}?t=${encodeURIComponent(tokenA)}`);
    eq(cust.body.status, 'quoted', 'the customer view follows the tap');
    ok(cust.body.scope && cust.body.scope.startsWith('Patch two'), 'the scope paragraph reaches the customer');
    eq(cust.body.quote_amount, 175, 'and so does the price');
    ok(cust.body.ladder[1].at, 'the Quoted rung now carries a timestamp');

    /* scheduled and done */
    const sch = await json(`${W}/api/job/${recA}/event?k=${ADMIN_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'scheduled', scheduled_for: '2026-09-22T14:00:00.000Z' }),
    });
    eq(sch.body.status, 'scheduled', 'the Scheduled tap moves the status');
    const dn = await json(`${W}/api/job/${recA}/event?k=${ADMIN_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'done' }),
    });
    eq(dn.body.status, 'done', 'the Done tap closes it');
    const full = await json(`${W}/api/job/${recA}?t=${encodeURIComponent(tokenA)}`);
    eq(full.body.ladder.filter((s) => s.at).length, 4, 'all four rungs are stamped');
  }

  /* ===================================================================== C2 */
  suite('C · the admin page on a phone');
  {
    const ap = await browser.newPage();
    await ap.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    ap.on('dialog', async (d) => { await d.accept('150'); });
    await ap.goto(`${W}/admin?k=${ADMIN_KEY}`, { waitUntil: 'domcontentloaded' });
    await ap.waitForFunction(() => document.querySelectorAll('#list .job').length > 0, { timeout: 15000 });
    const shape = await ap.evaluate(() => ({
      jobs: [...document.querySelectorAll('#list .job')].map((d) => d.querySelector('.id').textContent),
      firstIsOpen: !!document.querySelector('#list .job').className.match(/open|late/),
      buttons: [...document.querySelectorAll('#list .job:first-child button')].map((b) => b.textContent),
      overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
    }));
    ok(shape.jobs.length > 0, 'the aging list renders on a 390px screen', shape.jobs.join(','));
    eq(shape.firstIsOpen, true, 'the top row is an unquoted request');
    eq(shape.buttons.join('/'), 'Quoted/No text — handled by phone/Scheduled/Done',
      'each job carries the three taps, and REMINDERS-01’s one more');
    eq(shape.overflow, true, 'and the page does not scroll sideways on a phone');

    const target = shape.jobs[0];
    await ap.evaluate(() => document.querySelector('#list .job:first-child button[data-act="quoted"]').click());
    await ap.waitForFunction((id) => {
      const rows = [...document.querySelectorAll('#list .job')];
      const row = rows.find((d) => d.querySelector('.id').textContent === id);
      return row && /quoted in/.test(row.textContent);
    }, { timeout: 15000 }, target).catch(() => null);
    const row = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.jobs.find((j) => j.id === target);
    ok(row.quoted_at, `tapping Quoted on ${target} stamped quoted_at from the page`, row.quoted_at);
    eq(row.quote_amount, 150, 'and stored the amount typed into the prompt');
    ok(row.minutes_to_quote != null, 'and computed minutes_to_quote', String(row.minutes_to_quote));
    await ap.close();
  }

  }   /* end of A, B and C */

  /* ====================================================================== D */
  /* ALERTS-01: the phone. The Stage 1 nudge suite was retired with its push service; the thirteen
     readings live in suite-d-alerts.mjs and are written to .tmp/readings.json for the round's close. */
  if (want('D')) {
    const readings = await suiteAlerts({ W, stub, ADMIN_KEY, FAKE, suite, ok, eq, json, sleep });
    fs.writeFileSync(path.join(TMP, 'readings.json'), JSON.stringify(readings, null, 2));
  }

  /* ====================================================================== E */
  if (want('E')) {
  suite('E · the markdown export');
  {
    const bad = await fetch(`${W}/api/export/${recA}.md?k=wrong`);
    eq(bad.status, 404, 'the export needs the admin key');
    const r = await fetch(`${W}/api/export/${recA}.md?k=${ADMIN_KEY}`);
    eq(r.status, 200, 'the export renders');
    ok((r.headers.get('content-type') || '').startsWith('text/markdown'), 'as markdown', r.headers.get('content-type'));
    const md = await r.text();
    /* the eight section headings of Bridge\BIP\UMBRA\JOBS\U-0002-wills-ceiling\00-JOB.md */
    const HEADINGS = [
      '## A · THE REQUEST — as it arrived, never cleaned up',
      '## B · THE THREE QUESTIONS — what had to be asked before pricing',
      "## C · THE PACKET — the quote seat's fixed output",
      '## D · THE CLOCK',
      '## E · ACCEPTANCE → SCHEDULE',
      '## F · THE WORK ORDER — generated on acceptance',
      '## G · ACTUALS — filled AFTER, never before',
      '## H · CLOSE',
    ];
    for (const h of HEADINGS) ok(md.includes(h), `carries the heading "${h.slice(3, 30)}…"`);
    ok(md.startsWith('# ' + recA + ' ·'), 'titled with the job id', md.split('\n')[0]);
    ok(md.includes('Testy McTest'), 'and the customer that is on the record');
    ok(md.includes('Two holes in the ceiling'), 'with their words verbatim');
    ok(md.includes('`____`'), 'and a visible blank wherever the record knows nothing');
    ok(md.includes('jobs/' + recA + '/intake/1.png'), 'the photo keys are named');
    ok(md.includes('**Status:** `DONE`'), 'the status line reflects the taps');
  }

  /* ====================================================================== F */
  suite('F · the four form pages still submit byte-identically');
  {
    const PAGES = [
      ['services', '/services'],
      ['contact', '/contact'],
      ['es/servicios', '/es/servicios'],
      ['es/index', '/es'],
    ];
    for (const [label, route] of PAGES) {
      const before = relayPosts().length;
      const p1 = await browser.newPage();
      await fillAndSubmit(p1, `http://127.0.0.1:${PORT.siteOld}${route}`, { photos: [photoA, photoB] });
      await p1.close();
      for (let i = 0; i < 60 && relayPosts().length === before; i++) await sleep(100);
      const oldCap = relayPosts().slice(before);

      const before2 = relayPosts().length;
      const p2 = await browser.newPage();
      await fillAndSubmit(p2, `http://127.0.0.1:${PORT.siteNew}${route}`, { photos: [photoA, photoB] });
      await p2.close();
      for (let i = 0; i < 60 && relayPosts().length === before2; i++) await sleep(100);
      const newCap = relayPosts().slice(before2);

      if (!ok(oldCap.length === 1 && newCap.length === 1, `${label}: both copies posted once to formsubmit.co`, `${oldCap.length} vs ${newCap.length}`)) continue;
      ok(oldCap[0].url === newCap[0].url, `${label}: same endpoint path`, `${oldCap[0].url} vs ${newCap[0].url}`);
      const a = shapeOf(parseMultipart(oldCap[0].body, oldCap[0].headers['content-type']));
      const b = shapeOf(parseMultipart(newCap[0].body, newCap[0].headers['content-type']));
      const same = JSON.stringify(a) === JSON.stringify(b);
      ok(same, `${label}: the multipart is identical field for field, byte for byte`,
        same ? '' : `\n      before: ${JSON.stringify(a)}\n      after:  ${JSON.stringify(b)}`);
      ok(a.some((x) => x.name === 'attachment1') && a.some((x) => x.name === 'attachment2'),
        `${label}: still one field per photo`);
    }
  }

  }   /* end of E and F */

  /* ====================================================================== G */
  /* FORM-WINDOWS-01: the time screen and the text box. Its eleven readings go to .tmp/windows-readings.json. */
  if (want('G')) {
    const readings = await suiteWindows({ browser, W, stub, relay, ADMIN_KEY, suite, ok, eq, json, sleep, PORT, TMP, WORKER_DIR, flipConstant, copyTree });
    fs.writeFileSync(path.join(TMP, 'windows-readings.json'), JSON.stringify(readings, null, 2));
  }

  /* ====================================================================== H */
  /* ACCEPT-PAGE-01: the book behind the quote link. Its readings go to .tmp/book-readings.json. */
  if (want('H')) {
    const readings = await suiteBook({ W, stub, ADMIN_KEY, FAKE, suite, ok, eq, json, sleep, SITE, wlogRef });
    fs.writeFileSync(path.join(TMP, 'book-readings.json'), JSON.stringify(readings, null, 2));
  }

  /* ====================================================================== I */
  /* ACCEPT-PAGE-02: the customer's page at /q/<code>, through the site's own /q proxy. Readings go to
     .tmp/page-readings.json and its pictures to .tmp/page-pictures/. */
  if (want('I')) {
    /* A throw inside suite I is a named FAIL and the tally still prints: the readings after it did not run,
       and the count says so rather than the run dying without a TOTAL. */
    try {
      const readings = await suitePage({ browser, W, stub, sw, siteWorker, ADMIN_KEY, FAKE, suite, ok, eq, json, sleep, SITE, PORT, TMP, WORKER_DIR, REPO_DIR, wlogRef });
      fs.writeFileSync(path.join(TMP, 'page-readings.json'), JSON.stringify(readings, null, 2));
    } catch (err) {
      suite('I · the suite ran to its end');
      ok(false, 'suite I stopped early — every reading after this point did NOT run', String(err && err.stack || err).slice(0, 600));
    }
  }

  /* ====================================================================== J */
  /* REMINDERS-01: his table, the holding text and the second clock. Its readings go to
     .tmp/reminders-readings.json for the round's close. */
  if (want('J')) {
    try {
      const readings = await suiteReminders({ W, stub, gate, ADMIN_KEY, FAKE, FAKE_SMSGATE_AUTH, suite, ok, eq, json, sleep });
      fs.writeFileSync(path.join(TMP, 'reminders-readings.json'), JSON.stringify(readings, null, 2));
    } catch (err) {
      suite('J · the suite ran to its end');
      ok(false, 'suite J stopped early — every reading after this point did NOT run', String(err && err.stack || err).slice(0, 600));
    }
  }

  await page.close();
}

main().catch((e) => { console.error(e); process.exit(2); });
