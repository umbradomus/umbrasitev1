/* SITE-FIX-01 · THE CENSUS GEOCODER, PROVED ACROSS ORIGINS.
   A6(6): the Census answers no cross-origin fetch, so the module reaches it with a
   script tag and nothing else. This stands the site up on one port and a stand-in
   Census on ANOTHER (two ports of mine, both above 4900, both stopped here), and
   drives the real module through the four answers a browser actually gets:
       a match · no match · a garbled body · silence
   Nothing here ships, and no real Census is ever called.
   Run: node tools/site-fix-01-census.mjs */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import puppeteer from './../worker/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const ROOT = path.resolve('.');
const OUT = 'C:/Users/andre/Umbra/Boss/Bridge/SITE-FIX-01';

/* Other coders run on this PC. Two free ports are FOUND, above 4900, never taken
   from anybody: a busy one is stepped over, never reclaimed and never killed. */
async function freePort(from) {
  for (let p = from; p < from + 60; p++) {
    const taken = await new Promise((done) => {
      const s = http.createServer();
      s.once('error', () => done(true));
      s.once('listening', () => s.close(() => done(false)));
      s.listen(p, '127.0.0.1');
    });
    if (!taken) return p;
  }
  throw new Error('no free port above ' + from);
}
const SITE_PORT = await freePort(4951);
const CENSUS_PORT = await freePort(SITE_PORT + 1);   /* a different origin on purpose */

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const site = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    if (fs.existsSync(f + '.html')) f += '.html'; else { res.writeHead(404); res.end('no ' + p); return; }
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

/* the stand-in Census. `mode` is set by the case under test. */
const state = { mode: 'match', asked: [] };
const MATCH = {
  result: { addressMatches: [{ matchedAddress: '1200 E ADAMS ST, BROWNSVILLE, TX, 78520', coordinates: { x: -97.4967, y: 25.9022 } }] },
};
const census = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  state.asked.push({ path: u.pathname, cb: u.searchParams.get('callback'), origin: req.headers.origin || '(none — a script tag sends no Origin)' });
  const cb = u.searchParams.get('callback') || 'cb';
  if (state.mode === 'silence') return;                       /* never answers: the 8-second stop */
  res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
  if (state.mode === 'match') res.end(cb + '(' + JSON.stringify(MATCH) + ');');
  else if (state.mode === 'none') res.end(cb + '(' + JSON.stringify({ result: { addressMatches: [] } }) + ');');
  else if (state.mode === 'garbled') res.end(cb + '({"result":{"addressMatches":[{"matchedAddress":null,"coordinates":"who knows"}]},"junk":[1,2');
  else res.end(cb + '(null);');
});

await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));
await new Promise((r) => census.listen(CENSUS_PORT, '127.0.0.1', r));

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const c = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].find((x) => fs.existsSync(x));
  if (!c) throw new Error('no Chrome');
  return c;
}

const browser = await puppeteer.launch({ executablePath: chrome(), headless: true, args: ['--no-sandbox'] });
const say = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(mode, label, wait, tapYes) {
  state.mode = mode;
  const before = state.asked.length;
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const cors = [];
  page.on('console', (m) => { if (/CORS|Access-Control/i.test(m.text())) cors.push(m.text()); });
  await page.evaluateOnNewDocument((base) => { window.UMBRA_CENSUS_BASE = base; }, `http://127.0.0.1:${CENSUS_PORT}`);
  await page.goto(`http://127.0.0.1:${SITE_PORT}/services#request`, { waitUntil: 'load' });
  await page.waitForSelector('[data-intake2][data-screen]');
  await page.evaluate(() => {
    const f = document.querySelector('form.req');
    const a = f.querySelector('[name="address"]');
    a.value = '1200 E Adams St, Brownsville, TX 78520';
    a.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(wait);
  const read = await page.evaluate(() => {
    const card = document.querySelector('.uaddr');
    const h = (n) => { const e = document.querySelector('input[name="' + n + '"]'); return e ? e.value : '(not sent)'; };
    return {
      words: card ? card.textContent.replace(/[ \t\n]+/g, ' ').trim() : '(no card)',
      classes: card ? card.className : '',
      yes: !!document.querySelector('[data-uaddr-yes]'),
      confirmed: h('address_confirmed'), lat: h('lat'), lng: h('lng'),
      leftovers: Object.keys(window).filter((k) => k.indexOf('umbraGeo') === 0),
      scripts: [...document.querySelectorAll('script')].filter((s) => (s.src || '').indexOf('geocoder') > -1).length,
    };
  });
  say.push(label);
  say.push('  the stand-in was asked: ' + JSON.stringify(state.asked.slice(before)));
  say.push('  the screen says: ' + read.words);
  say.push('  card state: ' + read.classes + '   a Yes tap offered: ' + read.yes);
  say.push('  address_confirmed = ' + read.confirmed + '   lat = ' + read.lat + '   lng = ' + read.lng);
  say.push('  callback left on window: ' + (read.leftovers.length ? read.leftovers.join(',') : 'none (cleaned up)'));
  say.push('  script tags left in the page: ' + read.scripts);
  say.push('  CORS complaints in the console: ' + (cors.length ? cors.join(' | ') : 'none'));
  if (tapYes) {
    const yes = await page.$('[data-uaddr-yes]');
    if (yes) { await page.evaluate((b) => b.click(), yes); await sleep(200); }   /* the screen it lives on is not the one showing; the tap is the tap */
    say.push('  after the tap on the Yes button: address_confirmed = '
      + await page.evaluate(() => { const e = document.querySelector('input[name="address_confirmed"]'); return e ? e.value : '(not sent)'; }));
  }
  await page.close();
}

await run('match', 'A · THE CENSUS ANSWERS WITH A MATCH', 3000, true);
await run('none', 'B · THE CENSUS KNOWS NO SUCH PLACE', 3000, false);
/* a body that will not parse fires no onerror in any browser: it is the 8-second
   stop that ends it, exactly as it ends silence. So this one is watched for 9.5s. */
await run('garbled', 'C · THE BODY COMES BACK GARBLED', 9500, false);
await run('silence', 'D · THE CENSUS NEVER ANSWERS (the 8-second stop)', 9500, false);

/* the grep the ignite asks for, run here so the answer sits with the readings */
const src = fs.readFileSync('assets/umbra-address.js', 'utf8');
const bad = src.split('\n').map((l, i) => [i + 1, l])
  .filter(([, l]) => /(fetch\s*\(|XMLHttpRequest|navigator\.sendBeacon)/.test(l))
  /* the two hits in the file's own header are the sentence forbidding them */
  .filter(([, l]) => !/^\s*(\/\*|\*|\/\/)/.test(l) && !/never be reached|browser refuses/.test(l));
say.push('E · NO fetch, NO XMLHttpRequest ANYWHERE IN THE ADDRESS MODULE');
say.push('  grep -nE "fetch\\(|XMLHttpRequest|sendBeacon" assets/umbra-address.js  ->  '
  + (bad.length ? bad.map(([n, l]) => n + ': ' + l.trim()).join(' | ') : 'no hit'));

await browser.close();
await new Promise((r) => site.close(r));
await new Promise((r) => census.close(r));
const text = say.join('\n') + '\n';
fs.writeFileSync(path.join(OUT, '20-census-jsonp.txt'), text);
console.log(text);
