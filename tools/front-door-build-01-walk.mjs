/* FRONT-DOOR-BUILD-01 · THE WALK. The ONE script this round writes (SEAT LINE S1):
   it serves THIS worktree on a port of its own, walks the built pages in a real
   browser at 390 wide, and takes the pictures.

   NOTHING IT RUNS REACHES THE LIVE SITE OR THE LIVE WORKER (S4). Inside the browser,
   every request that is not this server is caught: the Worker's intake is answered by
   this script's own stub, which RECORDS the body it was given, and the Census geocoder
   is answered by a local JSONP stub through the seam the address module already has
   (window.UMBRA_CENSUS_BASE), so today's address check runs its real code path without
   a packet leaving this machine. No text, no email, no booking.

   Run: node tools/front-door-build-01-walk.mjs                 (its own port, its own pid) */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

/* puppeteer-core is READ, never written, out of a sibling worktree's node_modules -
   this worktree has none, and `npm ci` is a heavy step this machine does not need (S7). */
const PUP = 'C:/Users/andre/Umbra/umbrasitev1-wt/accept-page-01/worker/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const puppeteer = (await import('file:///' + PUP)).default;

const ROOT = path.resolve('.');
const OUT = 'C:/Users/andre/Umbra/Boss/Bridge/FRONT-DOOR-BUILD-01/FOR-DREW';
const REC = 'C:/Users/andre/Umbra/Boss/Bridge/FRONT-DOOR-BUILD-01';
const PORT = 4937;                      /* mine, above 4900; never 4177/4178/4747/4750 */
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);

  /* the Census stub: the same JSONP shape the real geocoder answers with, for the one
     address this walk ever types. Local only. */
  if (p.startsWith('/stub-census/')) {
    const cb = u.searchParams.get('callback') || 'cb';
    const body = { result: { addressMatches: [{ matchedAddress: '1 MAIN ST, BROWNSVILLE, TX, 78520', coordinates: { x: -97.4975, y: 25.9017 } }] } };
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(cb + '(' + JSON.stringify(body) + ');');
    return;
  }
  /* vercel.json's own two rewrites, so a deep link opens the step it names */
  if (/^\/request(\/|$)/.test(p)) p = '/request/index.html';
  else if (/^\/es\/solicitud(\/|$)/.test(p)) p = '/es/solicitud/index.html';
  else if (p.endsWith('/')) p += 'index.html';

  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    if (fs.existsSync(f + '.html')) f += '.html';
    else { res.writeHead(404); res.end('no ' + p); return; }
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + PORT;
console.log('serving this worktree at ' + BASE);

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!CHROME) { console.log('RED: no Chrome or Edge on this machine'); process.exit(1); }
console.log('browser: ' + CHROME);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--hide-scrollbars']
});
const shots = [];
const bodies = [];
const defects = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument((base) => {
    window.UMBRA_CENSUS_BASE = base + '/stub-census';   /* the seam the module already has */
    try { localStorage.clear(); } catch (e) {}
  }, BASE);
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') return r.continue();
    /* THE STUB. A post to the Worker's intake is caught here and recorded, never sent. */
    if (r.method() === 'POST') bodies.push({ url: u, body: r.postData() || '(not readable)' });
    return r.respond({
      status: 200, contentType: 'text/plain', body: 'OK (stub)',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' }
    });
  });
  page.on('pageerror', (e) => defects.push('page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') defects.push('console: ' + m.text().slice(0, 160)); });
  return page;
}

async function shot(page, name) {
  const file = path.join(OUT, name + '.png');
  await sleep(140);
  await page.screenshot({ path: file, fullPage: true });
  /* LOOK at it: sideways scroll, a tile with no picture, a clipped line */
  const read = await page.evaluate(() => {
    const d = document;
    const over = d.documentElement.scrollWidth > d.documentElement.clientWidth + 1;
    const pics = [...d.querySelectorAll('.tile,.jt,.tellt,.opt')].filter((e) => !e.querySelector('svg,img')).length;
    const clip = [...d.querySelectorAll('.tt b,.tt span,.jt span,h1,.btn,.cnt')].filter((e) => e.scrollWidth > e.clientWidth + 2).length;
    return { over, pics, clip, h1: (d.querySelector('h1') || { textContent: '' }).textContent, url: location.pathname, chars: d.body.innerText.length };
  });
  if (read.over) defects.push(name + ': the page scrolls sideways at 390');
  if (read.pics) defects.push(name + ': ' + read.pics + ' tile(s) with no picture');
  if (read.clip) defects.push(name + ': ' + read.clip + ' clipped line(s)');
  shots.push({ name, file, ...read, bytes: fs.statSync(file).size });
  console.log('  ' + name + '  ' + read.url + '  "' + read.h1.slice(0, 38) + '"' +
    (read.over ? '  SIDEWAYS' : '') + (read.pics ? '  NOPIC' : '') + (read.clip ? '  CLIPPED' : ''));
  return read;
}

/* ------------------------------- the header alone, at 390, FIRST in FOR-DREW (S8) */
{
  const page = await newPage();
  await page.goto(BASE + '/request', { waitUntil: 'networkidle0' });
  const hd = await page.$('.hd, .hd-big, header');
  if (hd) {
    const f = path.join(OUT, '00-the-name-on-a-phone.png');
    await hd.screenshot({ path: f });
    shots.push({ name: '00-the-name-on-a-phone', url: '/request (the header alone)', bytes: fs.statSync(f).size, chars: 0, h1: '' });
    console.log('  00-the-name-on-a-phone  ' + fs.statSync(f).size + ' bytes');
  } else defects.push('no header element to picture');
  await page.close();
}

/* ------------------------------------------------- screens 1 and 2, both languages */
for (const [lang, root] of [['en', '/request'], ['es', '/es/solicitud']]) {
  const page = await newPage();
  await page.goto(BASE + root, { waitUntil: 'networkidle0' });
  await shot(page, '01-screen-one-the-door-' + lang);
  await page.goto(BASE + root + '/all', { waitUntil: 'networkidle0' });
  await shot(page, '02-screen-two-everything-we-do-' + lang);
  /* S1: a list of jobs still on the first two screens is a RED. Count the tiles. */
  const counts = await page.evaluate(() => ({
    tiles: document.querySelectorAll('.jt,.tellt').length,
    lists: document.querySelectorAll('.bd ul, .bd ol').length
  }));
  console.log('    screen 2 ' + lang + ': ' + counts.tiles + ' picture tiles, ' + counts.lists + ' list(s)');
  if (counts.lists) defects.push(root + '/all: ' + counts.lists + ' job list(s) still on screen 2');
  await page.close();
}

/* --------------------------------------- four jobs, tile to the received page */
const WALKS = [
  /* the four he asked to see walked, then the two more S3 wants a Send body for.
     `pick` names the answer a step must give when the first option would not do -
     drywall only goes to two visits when the biggest spot is bigger than a nail hole. */
  { job: 'drywall', lang: 'en', root: '/request', note: 'walls and ceilings, a hole, two visits', pick: { what: 'hole', where: 'ceiling', size: 'knob', wet: 'no' } },
  { job: 'comfort', lang: 'en', root: '/request', note: 'hot rooms and drafts' },
  { job: 'furniture', lang: 'es', root: '/es/solicitud', note: 'armado de muebles, en espanol' },
  { job: 'gutters', lang: 'en', root: '/request', note: 'an outside job' },
  { job: 'tv_mount', lang: 'en', root: '/request', note: 'TV mounted' },
  { job: 'ceiling_fan', lang: 'en', root: '/request', note: 'ceiling fans - one of the three licence-doubt jobs' }
];
const answerStep = async (page, pick = {}) => page.evaluate((pick) => {
  const here = location.pathname.split('/').pop();
  const set = (el, v) => { if (el && !el.value) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); return true; } return false; };
  if (here === 'questions') {
    const conds = [...document.querySelectorAll('.cond')];
    const last = conds[conds.length - 1];
    if (!last) return 'next';
    const field = (last.querySelector('[data-f]') || {}).getAttribute ? last.querySelector('[data-f]').getAttribute('data-f') : null;
    const want = field && pick[field];
    const named = want ? last.querySelector('[data-v="' + want + '"]:not(.on)') : null;
    const opt = named || last.querySelector('.opt:not(.on)') || last.querySelector('.chips span:not(.on)');
    if (opt) { opt.click(); return 'answered'; }
    const ta = last.querySelector('textarea[data-f]');
    if (ta && !ta.value) { set(ta, 'The ceiling by the kitchen window, about a foot across.'); ta.dispatchEvent(new Event('blur', { bubbles: true })); return 'answered'; }
    return 'next';
  }
  if (here === 'photos') { set(document.getElementById('fd-note'), 'The gate on the left side is unlocked.'); return 'next'; }
  if (here === 'addons') {
    const b = document.querySelector('.addb:not(.on)');
    if (b) { b.click(); return 'answered'; }
    return 'next';
  }
  if (here === 'times') {
    const far = document.getElementById('fd-far');
    if (far && !far.value) { far.value = far.min; far.dispatchEvent(new Event('change', { bubbles: true })); return 'answered'; }
    const win = document.querySelector('.wins li:not(.on)');
    if (win) { win.click(); return 'answered'; }
    const day = document.querySelector('.day:not(.on)');
    if (day) { day.click(); return 'answered'; }
    return 'next';
  }
  if (here === 'contact') {
    if (set(document.getElementById('fd-first'), 'Ana')) return 'answered';
    if (set(document.getElementById('fd-phone'), '9565550142')) return 'answered';
    const c = document.querySelector('.consent:not(.on)');
    if (c) { c.click(); return 'answered'; }
    return 'next';
  }
  if (here === 'address') {
    if (set(document.getElementById('fd-addr'), '1 Main St, Brownsville TX 78520')) return 'answered';
    const yes = document.querySelector('[data-uaddr-yes]');
    if (yes) { yes.click(); return 'answered'; }
    return 'next';
  }
  return 'next';
}, pick);

for (const w of WALKS) {
  const k = WALKS.indexOf(w) + 1;
  console.log('walk ' + k + ': ' + w.job + ' (' + w.lang + ') - ' + w.note);
  const page = await newPage();
  /* from the TILE, the way he would: open screen 2, then tap this job's tile */
  const tap = (id) => page.evaluate((j) => {
    const t = document.querySelector('[data-job="' + j + '"]');
    if (!t) return false;
    t.click(); return true;
  }, id);
  /* screen 1 carries its own job tiles; the rest are tiles on screen 2 */
  await page.goto(BASE + w.root, { waitUntil: 'networkidle0' });
  let tapped = await tap(w.job);
  if (!tapped) {
    await page.goto(BASE + w.root + '/all', { waitUntil: 'networkidle0' });
    tapped = await tap(w.job);
  }
  if (!tapped) { defects.push(w.job + ': no tile for this job on screen 2'); await page.close(); continue; }
  await sleep(260);
  let step = 0, guard = 0, where = '';
  while (guard++ < 40) {
    where = await page.evaluate(() => location.pathname.split('/').pop());
    await shot(page, '1' + k + '-walk-' + w.job + '-' + String(++step).padStart(2, '0') + '-' + where);
    if (where === 'received') break;
    for (let inner = 0; inner < 20; inner++) { if ((await answerStep(page, w.pick || {})) !== 'answered') break; await sleep(130); }
    const btn = await page.$('.act [data-act="next"]:not([disabled]), .act [data-act="send"]:not([disabled])');
    if (!btn) { defects.push(w.job + ' (' + w.lang + '): the flow stops at ' + where + ' - no live button'); break; }
    await btn.click();
    await sleep(340);
    let now = await page.evaluate(() => location.pathname.split('/').pop());
    if (now === where) {            /* the step refused the move: answer again, then once more */
      for (let inner = 0; inner < 20; inner++) { if ((await answerStep(page, w.pick || {})) !== 'answered') break; await sleep(130); }
      const b2 = await page.$('.act [data-act="next"]:not([disabled]), .act [data-act="send"]:not([disabled])');
      if (b2) { await b2.click(); await sleep(380); }
      now = await page.evaluate(() => location.pathname.split('/').pop());
      if (now === where) { defects.push(w.job + ' (' + w.lang + '): stuck on ' + where); break; }
    }
  }
  if (where !== 'received') defects.push(w.job + ' (' + w.lang + '): never reached the received page (stopped at ' + where + ')');
  await page.close();
}

/* --------------------------------- the question screen of EVERY one of the 42 jobs */
{
  const page = await newPage();
  await page.goto(BASE + '/request', { waitUntil: 'networkidle0' });
  const ids = await page.evaluate(() => window.FD.jobs.map((j) => j.id));
  console.log('the question screen of every job (' + ids.length + '):');
  let n = 0;
  for (const id of ids) {
    await page.goto(BASE + '/request/' + id + '/questions', { waitUntil: 'networkidle0' });
    await shot(page, '20-question-screen-' + String(++n).padStart(2, '0') + '-' + id);
  }
  await page.close();
}

await browser.close();
server.close();

/* ------------------------------------------------------------------- the readings */
fs.writeFileSync(path.join(REC, '30-recorded-send-bodies.txt'),
  'FRONT-DOOR-BUILD-01 - what Send handed the stub. ' + bodies.length + ' post(s) caught in the\n' +
  'headless browser. Nothing left this machine: no request to the live Worker, no text, no email.\n\n' +
  bodies.map((b, i) => '=== post ' + (i + 1) + ' -> ' + b.url + ' ===\n' + b.body + '\n').join('\n'));
fs.writeFileSync(path.join(REC, '31-walk-readings.txt'),
  'pictures ' + shots.length + '  ·  recorded posts ' + bodies.length + '\n\n' +
  shots.map((s) => s.name + '  ' + s.url + '  ' + s.bytes + ' bytes  ' + s.chars + ' chars  h1="' + String(s.h1).slice(0, 48) + '"' +
    (s.over ? '  SIDEWAYS' : '') + (s.pics ? '  NOPIC:' + s.pics : '') + (s.clip ? '  CLIPPED:' + s.clip : '')).join('\n') +
  '\n\ndefects: ' + defects.length + '\n' + defects.join('\n') + '\n');
console.log('\npictures ' + shots.length + ' | recorded posts ' + bodies.length + ' | defects ' + defects.length);
if (defects.length) console.log('DEFECTS:\n  ' + defects.slice(0, 40).join('\n  '));
console.log(defects.length ? 'RESULT: FAIL - ' + defects.length + ' defect(s)' : 'RESULT: PASS - the flow walks tile to received, and every picture is on disk');
process.exit(defects.length ? 1 : 0);
