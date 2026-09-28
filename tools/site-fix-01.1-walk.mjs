/* SITE-FIX-01.1 · THE WALK. A real browser, the real pages, at 390x844 and at 1440.
   It serves this worktree on a port of its own above 4900 and stops it itself; it
   starts nothing else and stops nothing it did not start. The Census geocoder is a
   stand-in on a second port of mine — never the real one, and never a real key.
   Pictures land in Boss/Bridge/SITE-FIX-01.1/screens/.
   Run: node tools/site-fix-01.1-walk.mjs */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import puppeteer from './../worker/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const ROOT = path.resolve('.');
const OUT = 'C:/Users/andre/Umbra/Boss/Bridge/SITE-FIX-01.1/screens';
const PORT = 4933;                       /* mine, above 4900, stopped below */
const CPORT = 4934;                      /* the stand-in Census, also mine */
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

/* the stand-in Census: one address, JSONP, nothing else */
const census = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const cb = u.searchParams.get('callback') || 'cb';
  res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
  res.end(cb + '(' + JSON.stringify({
    result: { addressMatches: [{ matchedAddress: '1200 E ADAMS ST, BROWNSVILLE, TX, 78520', coordinates: { x: -97.4967, y: 25.9022 } }] },
  }) + ');');
});
await new Promise((r) => census.listen(CPORT, '127.0.0.1', r));

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(width, url, wizard = true) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width <= 420 ? 844 : 900 });
  await page.evaluateOnNewDocument((base) => { window.UMBRA_CENSUS_BASE = base; }, `http://127.0.0.1:${CPORT}`);
  page.on('console', (m) => { if (m.type() === 'error') say.push('  ! console: ' + m.text()); });
  page.on('pageerror', (e) => say.push('  ! pageerror: ' + e.message));
  await page.goto(SITE + url, { waitUntil: 'load' });
  if (wizard) await page.waitForSelector('[data-intake2][data-screen]');
  return page;
}

/* ----------------------------------------------------- 1 · the phone, 390x844 */
{
  const page = await open(390, '/services#request');
  say.push('PHONE 390x844 — /services#request');
  say.push('  screen on landing: ' + (await screenOf(page)));
  await shot(page, '1-chooser-390.png');

  /* A4b · HIS JOB: the paint tile alone. */
  await page.evaluate(() => {
    const b = document.querySelector('input[name="tiles"][value="paint"]');
    b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(140);
  await next(page);
  say.push('  after the paint tile, Next lands on: ' + (await screenOf(page)));
  const askedNow = () => page.evaluate(() => [...document.querySelectorAll('[data-fstep="tile-paint"] .ch-qblock')].filter((b) => !b.hidden).map((b) => b.querySelector('.v2q').textContent));
  say.push('  the paint screen asks (nothing tapped): ' + JSON.stringify(await askedNow()));
  await shot(page, '3-paint-questions-390.png');

  /* the amend's own answers, the new set */
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
  say.push('  a CEILING is asked: ' + JSON.stringify(await askedNow()));
  await shot(page, '4-paint-answered-390.png');

  /* and the walls DO get asked how many rooms */
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll('[data-fstep="tile-paint"] .ch-tap')].find((l) => l.textContent.trim().indexOf('The walls') === 0);
    const box = lab.querySelector('input'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(140);
  say.push('  the WALLS are asked:  ' + JSON.stringify(await askedNow()));
  await shot(page, '3b-paint-walls-rooms-390.png');
  /* back to his own job: a ceiling only */
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll('[data-fstep="tile-paint"] .ch-tap')].find((l) => l.textContent.trim().indexOf('The walls') === 0);
    const box = lab.querySelector('input'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(140);

  /* walk the rest of the way, filling what is asked */
  const seen = [];
  for (let i = 0; i < 25 && (await screenOf(page)) !== 'send'; i++) {
    const s = await screenOf(page);
    seen.push(s);
    if (s === 'notes') {
      say.push('  the sentence screen is number ' + seen.length + ' of the ask, and it asks: '
        + await page.evaluate(() => { const e = document.querySelector('[data-fstep="notes"] .v2q'); return e ? e.textContent.trim() : '(none)'; }));
      await shot(page, '9-sentence-second-390.png');
    }
    await page.evaluate(() => {
      const f = document.querySelector('form.req');
      const set = (sel, v) => { const e = f.querySelector(sel); if (e && !e.value) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('[name="name"]', 'Walk Wanda');
      set('[name="phone"]', '956 555 0143');
      set('[name="address"]', '1200 E Adams St, Brownsville, TX 78520');
      set('textarea[name="what"]', 'the patch on the ceiling is a different color');
    });
    await wait(80);
    if (s === 'address') {
      const yes = await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
      say.push('  the address card says: ' + await page.evaluate(() => { const c = document.querySelector('.uaddr'); return c ? c.textContent.replace(/[ \t\n]+/g, ' ').trim() : '(no card)'; }));
      await shot(page, '5-address-card-390.png');
      say.push('  Next with the card UNTAPPED: ' + await page.evaluate(() => {
        document.querySelector('[data-v2next]').click();
        const n = document.querySelector('[data-fstep="address"] .v2need');
        return (document.querySelector('[data-intake2]').getAttribute('data-screen')) + '  — the page says: "' + (n && !n.hidden ? n.textContent.trim() : '(nothing)') + '"';
      }));
      await shot(page, '5c-address-held-390.png');
      if (yes) { await yes.click(); await wait(250); await shot(page, '5b-address-confirmed-390.png'); }
      say.push('  address_confirmed = ' + await page.evaluate(() => { const h = document.querySelector('input[name="address_confirmed"]'); return h ? h.value : '(not sent)'; }));
    }
    if (s === 'times') {
      await page.evaluate(() => { const f = document.querySelector('input[name="avail_flexible"]'); if (f && !f.checked) { f.checked = true; f.dispatchEvent(new Event('change', { bubbles: true })); } });
      await wait(80);
    }
    await next(page);
    if ((await screenOf(page)) === s) { say.push('  STUCK on ' + s); break; }
  }
  seen.push(await screenOf(page));
  say.push('  the whole walk: ' + seen.join(' \u2192 '));
  await shot(page, '6-review-390.png');
  say.push('  the reply-by line: ' + await page.evaluate(() => { const e = document.querySelector('[data-reply-by]'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : '(none)'; }));
  say.push('  review groups: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ch-rgroup .ch-rtitle')].map((x) => x.textContent))));
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
  say.push('DESKTOP 1440 — /services#request  screen: ' + (await screenOf(page)));
  await shot(page, '7-chooser-1440.png');
  await page.close();
}

/* ------------------------------------------------------------ 3 · el espanol */
{
  const page = await open(390, '/es/servicios#pedir');
  say.push('ESPANOL 390 — screen: ' + (await screenOf(page)));
  say.push('  tiles: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-chooser-tiles] .ch-label')].map((x) => x.textContent))));
  await shot(page, '8-chooser-es-390.png');

  /* THE SPANISH SIZE SCALE — the hole tile's own screens, the words a customer reads */
  const scale = await page.evaluate(() => {
    const sec = document.querySelector('[data-fstep="ceiling-size"]');
    if (!sec) return null;
    /* show that one screen and only it — the words are the page's own */
    for (const s of document.querySelectorAll('[data-fstep]')) s.hidden = (s !== sec);
    sec.hidden = false;
    return {
      q: sec.querySelector('.v2q').textContent.trim(),
      words: [...sec.querySelectorAll('.v2opt span')].map((s) => s.textContent),
      values: [...sec.querySelectorAll('input')].map((i) => i.value),
    };
  });
  say.push('  the Spanish size scale asks: "' + (scale && scale.q) + '"');
  say.push('  the words:  ' + JSON.stringify(scale && scale.words));
  say.push('  the values: ' + JSON.stringify(scale && scale.values) + '   (untouched)');
  await page.evaluate(() => { const s = document.querySelector('[data-fstep="ceiling-size"]'); s.scrollIntoView({ block: 'center', behavior: 'instant' }); });
  await wait(200);
  await shot(page, '10-size-scale-es-390.png');
  await page.close();
}

/* ------------------------------------------------ 4 · the review in Spanish, reply-by */
{
  const page = await open(390, '/es/servicios#pedir');
  await page.evaluate(() => {
    const b = document.querySelector('input[name="tiles"][value="paint"]');
    b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(140);
  for (let i = 0; i < 25 && (await screenOf(page)) !== 'send'; i++) {
    const s = await screenOf(page);
    await page.evaluate(() => {
      const f = document.querySelector('form.req');
      const set = (sel, v) => { const e = f.querySelector(sel); if (e && !e.value) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('[name="name"]', 'Paseo Paloma');
      set('[name="phone"]', '956 555 0144');
      set('[name="address"]', '1200 E Adams St, Brownsville, TX 78520');
      set('textarea[name="what"]', 'el resane del techo no combina');
    });
    await wait(80);
    if (s === 'address') {
      const yes = await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
      if (yes) { await yes.click(); await wait(250); }
    }
    if (s === 'times') {
      await page.evaluate(() => { const f = document.querySelector('input[name="avail_flexible"]'); if (f && !f.checked) { f.checked = true; f.dispatchEvent(new Event('change', { bubbles: true })); } });
      await wait(80);
    }
    await next(page);
    if ((await screenOf(page)) === s) { say.push('  ES STUCK on ' + s); break; }
  }
  say.push('ESPANOL review — the reply-by line: ' + await page.evaluate(() => { const e = document.querySelector('[data-reply-by]'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : '(none)'; }));
  say.push('  review lines: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ch-rgroup .ch-rlist li')].map((x) => x.textContent))));
  await shot(page, '11-review-es-390.png');
  await page.close();
}

/* ------------------------------------------ 5 · the plain page, the card, the gate */
{
  const page = await open(390, '/contact', false);
  await page.evaluate(() => {
    const f = document.querySelector('form.req');
    const set = (sel, v) => { const e = f.querySelector(sel); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('[name="name"]', 'Plain Page Pilar');
    set('[name="phone"]', '956 555 0145');
    set('[name="address"]', '1200 E Adams St, Brownsville, TX 78520');
    set('textarea[name="what"]', 'the patch on the ceiling is a different color');
    const radio = f.querySelector('input[name="service"]');
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
  say.push('CONTACT 390 — the card says: ' + await page.evaluate(() => { const c = document.querySelector('.uaddr'); return c ? c.textContent.replace(/[ \t\n]+/g, ' ').trim() : '(no card)'; }));
  await page.evaluate(() => { const c = document.querySelector('.uaddr'); if (c) c.scrollIntoView({ block: 'center', behavior: 'instant' }); });
  await wait(150);
  await shot(page, '12-contact-card-390.png');
  const held = await page.evaluate(() => {
    document.querySelector('form.req button[type="submit"]').click();
    const n = document.querySelector('[data-uaddr-need]');
    return { url: location.pathname, said: n && !n.hidden ? n.textContent.trim() : '(nothing)' };
  });
  await wait(250);
  say.push('  Send with the card UNTAPPED: still on ' + held.url + ' — the page says: "' + held.said + '"');
  say.push('  what would post before the tap: ' + JSON.stringify(await page.evaluate(() => {
    const d = new FormData(document.querySelector('form.req'));
    return { address_confirmed: d.get('address_confirmed'), lang: d.get('lang'), started_at: d.get('started_at'), sent_at: d.get('sent_at') };
  })));
  await page.close();
}

/* --------------------------------------------------- 6 · the thank-you and the footer */
{
  const page = await open(390, '/request-received', false);
  say.push('THANK-YOU 390 — next actions in <main>: ' + JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll('main a.btn, main button.btn')].map((b) => (b.id || '') + ':' + b.textContent.trim()))));
  say.push('  the no-email line: class="' + await page.evaluate(() => { const c = document.getElementById('sent-copy'); return c ? c.className : '(gone)'; })
    + '"  in a box: ' + await page.evaluate(() => !!(document.getElementById('sent-copy') || {}).closest && !!document.getElementById('sent-copy').closest('.note, .sent, .card')));
  say.push('  the reply-by line: ' + await page.evaluate(() => (document.getElementById('byline') || {}).textContent.replace(/\s+/g, ' ').trim()));
  await shot(page, '13-thank-you-390.png');
  await page.close();

  /* the same page as the Worker actually sends them to it: with a request number, so the
     ONE next action and the small line under it are both on the screen */
  const withId = await open(390, '/request-received?id=U-4821&t=invented-token-0000', false);
  await wait(200);
  say.push('  with a request number — next actions: ' + JSON.stringify(await withId.evaluate(() =>
    [...document.querySelectorAll('main a.btn, main button.btn')].map((b) => (b.id || '') + ':' + b.textContent.trim()))));
  await withId.evaluate(() => document.getElementById('jobnote').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await wait(200);
  await shot(withId, '13b-thank-you-link-390.png');
  await withId.close();

  const page2 = await open(390, '/request-received', false);
  await page2.evaluate(() => document.querySelector('footer').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await wait(150);
  say.push('  the footer says: ' + JSON.stringify(await page2.evaluate(() => document.querySelector('footer').innerText.replace(/\s+/g, ' ').trim().slice(0, 200))));
  await shot(page2, '14-footer-390.png');
  await page2.close();

  const es = await open(390, '/es/recibido', false);
  await es.evaluate(() => document.querySelector('footer').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await wait(150);
  say.push('  the Spanish footer says: ' + JSON.stringify(await es.evaluate(() => document.querySelector('footer').innerText.replace(/\s+/g, ' ').trim().slice(0, 200))));
  await shot(es, '15-footer-es-390.png');
  await es.close();

  const wide = await open(1440, '/services', false);
  await wide.evaluate(() => document.querySelector('footer').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await wait(150);
  await shot(wide, '16-footer-1440.png');
  await wide.close();
}

await browser.close();
await new Promise((r) => server.close(r));
await new Promise((r) => census.close(r));
console.log(say.join('\n'));
console.log('\npictures:\n' + fs.readdirSync(OUT).map((x) => '  ' + x).join('\n'));
