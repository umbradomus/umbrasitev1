/* SITE-FIX-02 · THE WALK AND THE PIXELS. A real browser, the real pages, 390x844 and 1440.
   It takes the sixteen screens the CDO looked at, re-taken, into Boss/Bridge/SITE-FIX-02/screens/,
   and then SAMPLES THE RENDERED PIXELS of every one of them for the three colours B58 retired:
   #B83622, #3A4E36 and #000000. That is the CDO's own method — the colour is read off the render,
   not off the stylesheet.
   Its own ports (4963 / 4964), started and stopped by itself; nothing else is touched.
   Run: node tools/site-fix-02-walk.mjs */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import zlib from 'node:zlib';
import puppeteer from './../worker/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const ROOT = path.resolve('.');
/* SITEFIX02_OUT lets the very same walk be run against the BASE tree, so the pixel count
   below is a reading and not a claim. Its pictures land somewhere else and are not the round's. */
const OUT = process.env.SITEFIX02_OUT || 'C:/Users/andre/Umbra/Boss/Bridge/SITE-FIX-02/screens';
const PORT = 4963, CPORT = 4964;
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
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
const census = http.createServer((req, res) => {
  const cb = new URL(req.url, 'http://x').searchParams.get('callback') || 'cb';
  res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
  res.end(cb + '(' + JSON.stringify({ result: { addressMatches: [{ matchedAddress: '1200 E ADAMS ST, BROWNSVILLE, TX, 78520', coordinates: { x: -97.4967, y: 25.9022 } }] } }) + ');');
});
await new Promise((r) => census.listen(CPORT, '127.0.0.1', r));
const SITE = 'http://127.0.0.1:' + PORT;

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const c = [path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')].find((x) => fs.existsSync(x));
  if (!c) throw new Error('no Chrome');
  return c;
}

/* ---------------------------------------------------------- a PNG read with node's own zlib.
   Chromium writes 8-bit RGBA, colour type 6, no interlace. No library is added to do this. */
function pixels(file) {
  const buf = fs.readFileSync(file);
  let at = 8, w = 0, h = 0, depth = 0, type = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const tag = buf.toString('ascii', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (tag === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; }
    else if (tag === 'IDAT') idat.push(body);
    else if (tag === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || (type !== 6 && type !== 2)) throw new Error(file + ': not 8-bit RGB/RGBA (' + depth + '/' + type + ')');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = type === 6 ? 4 : 3, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let src = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[src++];
    const row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src++];
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = (x >= bpp && y > 0) ? out[prev + x - bpp] : 0;
      let r;
      if (filter === 0) r = v;
      else if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
      }
      out[row + x] = r & 0xff;
    }
  }
  return { w, h, bpp, data: out };
}
/* how many pixels of this picture are EXACTLY one of the retired colours */
const RETIRED = { '#B83622': [184, 54, 34], '#3A4E36': [58, 78, 54], '#000000': [0, 0, 0] };
function retiredIn(file) {
  const im = pixels(file);
  const n = { '#B83622': 0, '#3A4E36': 0, '#000000': 0 };
  for (let i = 0; i < im.data.length; i += im.bpp) {
    if (im.bpp === 4 && im.data[i + 3] < 250) continue;
    const r = im.data[i], g = im.data[i + 1], b = im.data[i + 2];
    for (const k in RETIRED) { const c = RETIRED[k]; if (r === c[0] && g === c[1] && b === c[2]) n[k]++; }
  }
  return n;
}

const browser = await puppeteer.launch({ executablePath: chrome(), headless: true, args: ['--no-sandbox'] });
const say = [];
const taken = [];
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name) }); taken.push(name); say.push('  ' + name); };
const screenOf = (p) => p.$eval('[data-intake2]', (e) => e.getAttribute('data-screen'));
const next = async (p) => { await p.click('[data-v2next]'); await wait(90); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : '(none)'; }, sel);

async function open(width, url, wizard = true) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width <= 420 ? 844 : 900 });
  await page.evaluateOnNewDocument((base) => { window.UMBRA_CENSUS_BASE = base; }, 'http://127.0.0.1:' + CPORT);
  page.on('pageerror', (e) => say.push('  ! pageerror: ' + e.message));
  await page.goto(SITE + url, { waitUntil: 'load' });
  if (wizard) await page.waitForSelector('[data-intake2][data-screen]');
  return page;
}
const fill = (page, w) => page.evaluate((who) => {
  const f = document.querySelector('form.req');
  const set = (sel, v) => { const e = f.querySelector(sel); if (e && !e.value) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
  set('[name="name"]', who.name); set('[name="phone"]', who.phone);
  set('[name="address"]', who.address); set('textarea[name="what"]', who.what);
}, w);
const flexible = (page) => page.evaluate(() => {
  const f = document.querySelector('input[name="avail_flexible"]');
  if (f && !f.checked) { f.checked = true; f.dispatchEvent(new Event('change', { bubbles: true })); }
});
const WHO = { name: 'Walk Wanda', phone: '956 555 0143', address: '1200 E Adams St, Brownsville, TX 78520', what: 'the patch on the ceiling is a different color' };
const WHO_ES = { name: 'Paseo Paloma', phone: '956 555 0144', address: '1200 E Adams St, Brownsville, TX 78520', what: 'el resane del techo no combina' };

/* ----------------------------------------------------- 1 · the phone, 390x844, English */
{
  const page = await open(390, '/services#request');
  say.push('PHONE 390x844 — /services#request');
  say.push('  screen on landing: ' + (await screenOf(page)));
  await shot(page, '1-chooser-390.png');
  /* the menu, opened the way a thumb would */
  const menu = await page.evaluate(() => {
    const ctl = document.querySelector('[data-menu-toggle], .nav-d > summary');
    if (ctl) ctl.click();
    const nav = document.querySelector('nav.menu');
    return { ctl: !!ctl, items: [...nav.querySelectorAll('a')].map((a) => a.textContent.trim() + ' ' + Math.round(a.getBoundingClientRect().left) + '..' + Math.round(a.getBoundingClientRect().right)), vw: innerWidth };
  });
  say.push('  the menu at 390: ' + JSON.stringify(menu.items) + '  (a control opens it: ' + menu.ctl + ')');
  await shot(page, '17-menu-390.png');
  await page.evaluate(() => { const ctl = document.querySelector('[data-menu-toggle], .nav-d > summary'); if (ctl) ctl.click(); });
  await wait(80);

  await page.evaluate(() => {
    const b = document.querySelector('input[name="tiles"][value="paint"]');
    b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(140);
  await next(page);
  const askedNow = () => page.evaluate(() => [...document.querySelectorAll('[data-fstep="tile-paint"] .ch-qblock')].filter((b) => !b.hidden).map((b) => b.querySelector('.v2q').textContent));
  say.push('  the paint screen asks (nothing tapped): ' + JSON.stringify(await askedNow()));
  await shot(page, '3-paint-questions-390.png');

  const answers = ['A ceiling', 'The whole thing', 'Normal', 'Textured', 'Match what\u2019s there', 'A repair spot that doesn\u2019t match'];
  const picked = await page.evaluate((want) => {
    const out = [];
    for (const w of want) {
      const lab = [...document.querySelectorAll('[data-fstep="tile-paint"] .ch-tap')].find((l) => l.textContent.trim().indexOf(w) === 0);
      if (!lab) { out.push('MISSING: ' + w); continue; }
      const box = lab.querySelector('input'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
      out.push(box.name + ' = ' + box.value);
    }
    return out;
  }, answers);
  await wait(120);
  say.push('  answered: ' + picked.join(' | '));
  await shot(page, '4-paint-answered-390.png');
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll('[data-fstep="tile-paint"] .ch-tap')].find((l) => l.textContent.trim().indexOf('The walls') === 0);
    const box = lab.querySelector('input'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(140);
  say.push('  the WALLS are asked: ' + JSON.stringify(await askedNow()));
  await shot(page, '3b-paint-walls-rooms-390.png');
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll('[data-fstep="tile-paint"] .ch-tap')].find((l) => l.textContent.trim().indexOf('The walls') === 0);
    const box = lab.querySelector('input'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(140);

  const seen = [];
  for (let i = 0; i < 25 && (await screenOf(page)) !== 'send'; i++) {
    const s = await screenOf(page);
    seen.push(s);
    if (s === 'notes') await shot(page, '9-sentence-second-390.png');
    await fill(page, WHO);
    await wait(80);
    if (s === 'address') {
      await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
      say.push('  the address card says: ' + await text(page, '.uaddr'));
      await shot(page, '5-address-card-390.png');
      /* THE CDO'S OWN PATH: Next BEFORE Yes, then Yes */
      await page.click('[data-v2next]'); await wait(200);
      say.push('  Next with the card UNTAPPED — the page says: ' + JSON.stringify(await page.evaluate(() =>
        [...document.querySelectorAll('[data-fstep="address"] .v2need, [data-fstep="address"] .uaddr-line')]
          .filter((e) => !e.hidden && getComputedStyle(e).display !== 'none' && e.textContent.trim())
          .map((e) => e.textContent.trim()))));
      await shot(page, '5c-address-held-390.png');
      const yes = await page.$('[data-uaddr-yes]');
      if (yes) { await yes.click(); await wait(320); }
      say.push('  then Yes — the page says: ' + JSON.stringify(await page.evaluate(() =>
        [...document.querySelectorAll('[data-fstep="address"] .v2need, [data-fstep="address"] .uaddr-line')]
          .filter((e) => !e.hidden && getComputedStyle(e).display !== 'none' && e.textContent.trim())
          .map((e) => e.textContent.trim()))));
      say.push('  the address on the screen: ' + JSON.stringify(await page.$eval('[name="address"]', (e) => e.value)));
      await shot(page, '5b-address-confirmed-390.png');
      say.push('  address_confirmed = ' + await page.evaluate(() => { const h = document.querySelector('input[name="address_confirmed"]'); return h ? h.value : '(not sent)'; }));
    }
    if (s === 'times') await flexible(page);
    await next(page);
    if ((await screenOf(page)) === s) { say.push('  STUCK on ' + s); break; }
  }
  seen.push(await screenOf(page));
  say.push('  the whole walk: ' + seen.join(' \u2192 '));
  await shot(page, '6-review-390.png');
  say.push('  review lines:  ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ch-rgroup .ch-rlist li')].map((x) => x.textContent))));
  say.push('  what would post: ' + JSON.stringify(await page.evaluate(() => {
    const d = new FormData(document.querySelector('form.req'));
    const o = {}; for (const [k, v] of d.entries()) if (typeof v === 'string') o[k] = v.length > 90 ? v.slice(0, 90) + '\u2026' : v;
    return o;
  }), null, 1));
  await page.close();
}

/* ------------------------------------------------------------ 2 · the desktop */
{
  const page = await open(1440, '/services#request');
  say.push('DESKTOP 1440 — screen: ' + (await screenOf(page)));
  await shot(page, '7-chooser-1440.png');
  await page.close();
}

/* ------------------------------------------------------------ 3 · el espanol */
{
  const page = await open(390, '/es/servicios#pedir');
  say.push('ESPANOL 390 — screen: ' + (await screenOf(page)));
  say.push('  tiles: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-chooser-tiles] .ch-label')].map((x) => x.textContent))));
  await shot(page, '8-chooser-es-390.png');
  const menu = await page.evaluate(() => {
    const ctl = document.querySelector('[data-menu-toggle], .nav-d > summary');
    if (ctl) ctl.click();
    const nav = document.querySelector('nav.menu');
    return [...nav.querySelectorAll('a')].map((a) => a.textContent.trim() + ' ' + Math.round(a.getBoundingClientRect().left) + '..' + Math.round(a.getBoundingClientRect().right));
  });
  say.push('  the Spanish menu at 390: ' + JSON.stringify(menu));
  await shot(page, '17b-menu-es-390.png');
  await page.evaluate(() => { const ctl = document.querySelector('[data-menu-toggle], .nav-d > summary'); if (ctl) ctl.click(); });
  await wait(80);
  /* The CDO's screen 10. This used to be reached by hiding every other step by hand,
     which meant the page's own show() never ran and the picture carried whatever was on
     the screen before it — the privacy line among it. It is reached the page's own way
     now: tick the hole tile so the ceiling screens are in the live order, then ask the
     wizard to go there, exactly as the review's Edit does. */
  await page.evaluate(() => {
    for (const sel of ['input[name="tiles"][value="hole"]',
                       'input[name="problem_area"][value="Ceiling"]']) {
      const b = document.querySelector(sel);
      b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await wait(160);
  const scale = await page.evaluate(() => {
    if (!window.UmbraIntake || !window.UmbraIntake.to('ceiling-size')) return null;
    const sec = document.querySelector('[data-fstep="ceiling-size"]');
    return { q: sec.querySelector('.v2q').textContent.trim(), words: [...sec.querySelectorAll('.v2opt span')].map((s) => s.textContent) };
  });
  say.push('  the Spanish size scale: ' + JSON.stringify(scale && scale.words));
  if (!scale) throw new Error('the Spanish size scale was not reached');
  await wait(200);
  await shot(page, '10-size-scale-es-390.png');
  await page.close();
}

/* ------------------------------------------ 4 · the review in Spanish */
{
  const page = await open(390, '/es/servicios#pedir');
  await page.evaluate(() => {
    const b = document.querySelector('input[name="tiles"][value="paint"]');
    b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(140);
  for (let i = 0; i < 25 && (await screenOf(page)) !== 'send'; i++) {
    const s = await screenOf(page);
    await fill(page, WHO_ES);
    await wait(80);
    if (s === 'address') {
      await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
      await page.click('[data-v2next]'); await wait(200);
      const yes = await page.$('[data-uaddr-yes]');
      if (yes) { await yes.click(); await wait(320); }
      say.push('ESPANOL — after Next-then-Yes the page says: ' + JSON.stringify(await page.evaluate(() =>
        [...document.querySelectorAll('[data-fstep="address"] .v2need, [data-fstep="address"] .uaddr-line')]
          .filter((e) => !e.hidden && getComputedStyle(e).display !== 'none' && e.textContent.trim())
          .map((e) => e.textContent.trim()))));
    }
    if (s === 'times') await flexible(page);
    await next(page);
    if ((await screenOf(page)) === s) { say.push('  ES STUCK on ' + s); break; }
  }
  say.push('ESPANOL review lines: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ch-rgroup .ch-rlist li')].map((x) => x.textContent))));
  await shot(page, '11-review-es-390.png');
  await page.close();
}

/* ------------------------------------------ 5 · the plain page, the card */
{
  const page = await open(390, '/contact', false);
  await page.evaluate((w) => {
    const f = document.querySelector('form.req');
    const set = (sel, v) => { const e = f.querySelector(sel); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('[name="name"]', w.name); set('[name="phone"]', w.phone); set('[name="address"]', w.address); set('textarea[name="what"]', w.what);
    const radio = f.querySelector('input[name="service"]');
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
  }, { name: 'Plain Page Pilar', phone: '956 555 0145', address: WHO.address, what: WHO.what });
  await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
  say.push('CONTACT 390 — the card says: ' + await text(page, '.uaddr'));
  await page.evaluate(() => { const c = document.querySelector('.uaddr'); if (c) c.scrollIntoView({ block: 'center', behavior: 'instant' }); });
  await wait(150);
  await shot(page, '12-contact-card-390.png');
  await page.close();
}

/* --------------------------------------------------- 6 · the thank-you and the footer */
{
  const page = await open(390, '/request-received', false);
  say.push('THANK-YOU 390 — the first thing in <main>: ' + await text(page, 'main h1'));
  say.push('  the promise banner sits after the heading: ' + await page.evaluate(() => {
    const pr = document.querySelector('.promise'), h = document.querySelector('main h1');
    return !!(pr && h && (h.compareDocumentPosition(pr) & Node.DOCUMENT_POSITION_FOLLOWING));
  }));
  await shot(page, '13-thank-you-390.png');
  await page.close();

  const withId = await open(390, '/request-received?id=U-4821&t=invented-token-0000', false);
  await wait(200);
  await withId.evaluate(() => { const e = document.getElementById('jobnote'); if (e) e.scrollIntoView({ block: 'center', behavior: 'instant' }); });
  await wait(200);
  await shot(withId, '13b-thank-you-link-390.png');
  await withId.close();

  const page2 = await open(390, '/request-received', false);
  await page2.evaluate(() => document.querySelector('footer').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await wait(150);
  say.push('  the footer says: ' + JSON.stringify(await page2.evaluate(() => document.querySelector('footer').innerText.replace(/\s+/g, ' ').trim().slice(0, 220))));
  await shot(page2, '14-footer-390.png');
  await page2.close();

  const es = await open(390, '/es/recibido', false);
  await es.evaluate(() => document.querySelector('footer').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await wait(150);
  say.push('  the Spanish footer says: ' + JSON.stringify(await es.evaluate(() => document.querySelector('footer').innerText.replace(/\s+/g, ' ').trim().slice(0, 220))));
  await shot(es, '15-footer-es-390.png');
  await es.close();

  const wide = await open(1440, '/services', false);
  await wide.evaluate(() => document.querySelector('footer').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await wait(150);
  await shot(wide, '16-footer-1440.png');
  await wide.close();

  const tyes = await open(390, '/es/recibido', false);
  say.push('  the Spanish thank-you first says: ' + await text(tyes, 'main h1'));
  await tyes.close();
}

await browser.close();
await new Promise((r) => server.close(r));
await new Promise((r) => census.close(r));

/* ------------------------------------------------- THE PIXELS, off every screen taken */
say.push('');
say.push('THE RENDERED PIXELS — every picture above, counted for the three colours B58 retired');
let worst = 0;
const rows = [];
for (const name of taken) {
  const n = retiredIn(path.join(OUT, name));
  const bad = n['#B83622'] + n['#3A4E36'] + n['#000000'];
  worst += bad;
  rows.push('  ' + (bad ? '\u2717' : '\u2713') + ' ' + name.padEnd(30) + ' #B83622=' + n['#B83622'] + '  #3A4E36=' + n['#3A4E36'] + '  #000000=' + n['#000000']);
}
say.push(...rows);
say.push('  TOTAL retired-colour pixels over the ' + taken.length + ' screens: ' + worst + (worst ? '   \u2190 RED' : '   \u2190 GREEN'));
console.log(say.join('\n'));
console.log('\npictures in ' + OUT + ':\n' + taken.map((x) => '  ' + x).join('\n'));
process.exit(worst ? 1 : 0);
