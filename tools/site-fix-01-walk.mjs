/* SITE-FIX-01 · THE WALK. A real browser, the real pages, at 390x844 and at 1440.
   It serves this worktree on a port of its own above 4900 and stops it itself; it
   starts nothing else and stops nothing it did not start.
   Pictures land in Boss/Bridge/SITE-FIX-01/screens/.
   Run: node tools/site-fix-01-walk.mjs */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import puppeteer from './../worker/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const ROOT = path.resolve('.');
const OUT = 'C:/Users/andre/Umbra/Boss/Bridge/SITE-FIX-01/screens';
const PORT = 4931;                       /* mine, above 4900, stopped below */
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
const SITE = `http://127.0.0.1:${PORT}`;

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
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name) }); say.push('  ' + name); };
const screenOf = (p) => p.$eval('[data-intake2]', (e) => e.getAttribute('data-screen'));
const next = async (p) => { await p.click('[data-v2next]'); await new Promise((r) => setTimeout(r, 90)); };

async function open(width, url) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width <= 420 ? 844 : 900 });
  page.on('console', (m) => { if (m.type() === 'error') say.push('  ! console: ' + m.text()); });
  page.on('pageerror', (e) => say.push('  ! pageerror: ' + e.message));
  /* 'load', not 'domcontentloaded': the pictures below the form decide the page's
     height, and a customer's browser lands where that height says. */
  await page.goto(SITE + url, { waitUntil: 'load' });
  await page.waitForSelector('[data-intake2][data-screen]');
  return page;
}

/* ----------------------------------------------------- 1 · the phone, 390x844 */
{
  const page = await open(390, '/services#request');
  say.push('PHONE 390x844 — /services#request');
  say.push('  screen on landing: ' + (await screenOf(page)));
  say.push('  anything focused:  ' + await page.evaluate(() => document.activeElement === document.body ? 'no (body)' : document.activeElement.tagName + '.' + document.activeElement.className));
  say.push('  a category preselected: ' + await page.evaluate(() => [...document.querySelectorAll('input[name="service"]')].filter((x) => x.checked).map((x) => x.value).join(',') || 'none'));
  const geo = await page.evaluate(() => {
    /* the heading the round is judged on is the band's own, marked when the chooser
       reuses it; '.ch-heading' alone also matches the checklist's heading below. */
    const h = document.querySelector('[data-chooser-heading]');
    const tiles = [...document.querySelectorAll('[data-chooser-tiles] .ch-tap')];
    const r = (e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) }; };
    return {
      scrollY: Math.round(window.scrollY),
      heading: h ? r(h) : null,
      sectionTop: Math.round(document.querySelector('[data-fstep="chooser"]').getBoundingClientRect().top),
      bandTop: Math.round((document.querySelector('[data-chooser-tiles]').closest('.band') || document.body).getBoundingClientRect().top),
      lid: Math.round((document.querySelector('.top') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
      headingText: h ? h.textContent : null,
      tiles: tiles.map((t) => ({ t: t.textContent.replace(/\s+/g, ' ').trim().slice(0, 40), ...r(t) })),
      lastTileBottom: tiles.length ? Math.round(tiles[tiles.length - 1].getBoundingClientRect().bottom) : null,
      scrollW: document.documentElement.scrollWidth,
    };
  });
  say.push('  scrollY on landing: ' + geo.scrollY + '   page scrollWidth: ' + geo.scrollW);
  say.push('  the band top, on screen: ' + geo.bandTop + ' px (the sticky header is ' + geo.lid + ' px tall)');
  say.push('  the first tap screen starts at: ' + geo.sectionTop + ' px');
  say.push('  heading: "' + geo.headingText + '" top=' + (geo.heading && geo.heading.top));
  say.push('  tiles: ' + geo.tiles.length + ', last tile bottom = ' + geo.lastTileBottom + ' (viewport 844)');
  for (const t of geo.tiles) say.push('    ' + String(t.h).padStart(4) + 'x' + String(t.w).padStart(4) + '  ' + t.t);
  await shot(page, '1-chooser-390.png');

  /* A4b · HIS JOB: the paint tile alone. */
  await page.evaluate(() => {
    const b = document.querySelector('input[name="tiles"][value="paint"]');
    b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 120));
  await shot(page, '2-paint-lit-390.png');
  await next(page);
  say.push('  after the paint tile, Next lands on: ' + (await screenOf(page)));
  say.push('  the paint screen asks: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-fstep="tile-paint"] .ch-qblock .v2q')].map((x) => x.textContent))));
  await shot(page, '3-paint-questions-390.png');
  /* answer it exactly as the amend says */
  const answers = ['A ceiling', '1 room', 'An average room', 'Match what\u2019s there', 'A repair spot that doesn\u2019t match'];
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
  say.push('  answered: ' + picked.join(' | '));
  await shot(page, '4-paint-answered-390.png');

  /* walk the rest of the way, filling what is asked */
  const seen = [];
  for (let i = 0; i < 25 && (await screenOf(page)) !== 'send'; i++) {
    const s = await screenOf(page);
    seen.push(s);
    await page.evaluate(() => {
      const f = document.querySelector('form.req');
      const set = (sel, v) => { const e = f.querySelector(sel); if (e && !e.value) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('[name="name"]', 'Walk Wanda');
      set('[name="phone"]', '956 555 0143');
      set('[name="address"]', '1200 E Adams St, Brownsville, TX 78520');
      set('textarea[name="what"]', 'the patch on the ceiling is a different color');
    });
    await new Promise((r) => setTimeout(r, 60));
    if (s === 'address') {
      /* wait for the card itself, not for a clock: the geocoder is across the internet */
      const yes = await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
      say.push('  the address card says: ' + await page.evaluate(() => { const c = document.querySelector('.uaddr'); return c ? c.textContent.replace(/[ \t\n]+/g, ' ').trim() : '(no card)'; }));
      await shot(page, '5-address-card-390.png');
      if (yes) { await yes.click(); await new Promise((r) => setTimeout(r, 250)); await shot(page, '5b-address-confirmed-390.png'); }
      say.push('  address_confirmed = ' + await page.evaluate(() => { const h = document.querySelector('input[name="address_confirmed"]'); return h ? h.value : '(not sent)'; }));
    }
    if (s === 'times') {
      await page.evaluate(() => { const f = document.querySelector('input[name="avail_flexible"]'); if (f && !f.checked) { f.checked = true; f.dispatchEvent(new Event('change', { bubbles: true })); } });
      await new Promise((r) => setTimeout(r, 80));
    }
    await next(page);
    if ((await screenOf(page)) === s) { say.push('  STUCK on ' + s); break; }
  }
  seen.push(await screenOf(page));
  say.push('  the whole walk: ' + seen.join(' \u2192 '));
  say.push('  hole screens seen on a paint job: ' + (seen.filter((s) => /ceiling-|walls-/.test(s)).join(',') || 'none'));
  await shot(page, '6-review-390.png');
  say.push('  review groups: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ch-rgroup .ch-rtitle')].map((x) => x.textContent))));
  say.push('  review lines:  ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ch-rgroup .ch-rlist li')].map((x) => x.textContent))));
  say.push('  Send buttons visible anywhere: ' + await page.evaluate(() => [...document.querySelectorAll('[data-v2send]')].filter((b) => b.offsetParent !== null).length));
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
  say.push('DESKTOP 1440 — /services#request  screen: ' + (await screenOf(page)));
  await shot(page, '7-chooser-1440.png');
  await page.close();
}

/* ------------------------------------------------------------ 3 · el espanol */
{
  const page = await open(390, '/es/servicios#pedir');
  say.push('ESPANOL 390 — screen: ' + (await screenOf(page)));
  const g = await page.evaluate(() => {
    const h = document.querySelector('[data-chooser-heading]');
    const tiles = [...document.querySelectorAll('[data-chooser-tiles] .ch-tap')];
    return {
      scrollY: Math.round(window.scrollY),
      heading: h && h.textContent,
      headingTop: h ? Math.round(h.getBoundingClientRect().top) : null,
      bandTop: Math.round(document.querySelector('.band#pedir').getBoundingClientRect().top),
      count: tiles.length,
      lastBottom: tiles.length ? Math.round(tiles[tiles.length - 1].getBoundingClientRect().bottom) : null,
      shortest: Math.min(...tiles.map((t) => Math.round(t.getBoundingClientRect().height))),
      labels: [...document.querySelectorAll('[data-chooser-tiles] .ch-label')].map((x) => x.textContent),
      scrollW: document.documentElement.scrollWidth,
    };
  });
  say.push('  scrollY: ' + g.scrollY + '  band top on screen: ' + g.bandTop + '  scrollWidth: ' + g.scrollW);
  say.push('  heading: "' + g.heading + '" top=' + g.headingTop);
  say.push('  ' + g.count + ' tiles, last bottom = ' + g.lastBottom + ' (viewport 844), shortest tile ' + g.shortest + 'px');
  say.push('  tiles: ' + JSON.stringify(g.labels));
  await shot(page, '8-chooser-es-390.png');
  await page.close();
}

await browser.close();
await new Promise((r) => server.close(r));
console.log(say.join('\n'));
console.log('\npictures:\n' + fs.readdirSync(OUT).map((x) => '  ' + x).join('\n'));
