/* SITE-FIX-02 · THE READINGS. One real browser, the real pages, 390x844 and 1440.
   Every item of the ignite gets a named reading that FAILS on the base as it stands.
   Its own ports (4961 / 4962), started and stopped by itself; nothing else is touched.
   Run: node tools/site-fix-02-read.mjs [ITEM]      ITEM = 1|2|3|4|5|6 (default: all) */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import puppeteer from './../worker/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const ROOT = path.resolve('.');
const PORT = 4961, CPORT = 4962;   /* mine, free at 15:0xZ; stopped below */
const ONLY = (process.argv[2] || '').trim();

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

/* the stand-in Census — one address, JSONP, never the real one */
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
const browser = await puppeteer.launch({ executablePath: chrome(), headless: true, args: ['--no-sandbox'] });

let pass = 0, fail = 0;
const ok = (cond, name, got) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (got === undefined ? '' : '  \u2014 got ' + JSON.stringify(got))); }
};
const eq = (a, b, name) => ok(a === b, name, a === b ? undefined : { got: a, wanted: b });
const head = (s) => console.log('\n' + s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(width, url, wizard = true) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width <= 420 ? 844 : 900 });
  await page.evaluateOnNewDocument((base) => { window.UMBRA_CENSUS_BASE = base; }, 'http://127.0.0.1:' + CPORT);
  await page.goto(SITE + url, { waitUntil: 'load' });
  if (wizard) await page.waitForSelector('[data-intake2][data-screen]');
  return page;
}
const screenOf = (p) => p.$eval('[data-intake2]', (e) => e.getAttribute('data-screen'));
const next = async (p) => { await p.click('[data-v2next]'); await wait(90); };

const WHO = { name: 'Read Rita', phone: '956 555 0199', address: '1200 E Adams St, Brownsville, TX 78520', what: 'the patch on the ceiling is a different color' };
const WHO_ES = { name: 'Lectura Lupe', phone: '956 555 0198', address: '1200 E Adams St, Brownsville, TX 78520', what: 'el resane del techo no combina' };
const WRITTEN = '1200 E Adams St, Brownsville, TX 78520';
const PRUSSIAN = 'rgb(0, 49, 83)';
const CRIMSON = 'rgb(122, 2, 21)';
const INK = 'rgb(15, 11, 26)';

async function fillAll(page, who) {
  await page.evaluate((w) => {
    const f = document.querySelector('form.req');
    const set = (sel, v) => { const e = f.querySelector(sel); if (e && !e.value) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('[name="name"]', w.name); set('[name="phone"]', w.phone);
    set('[name="address"]', w.address); set('textarea[name="what"]', w.what);
  }, who);
  await wait(80);
}
const flexible = (page) => page.evaluate(() => {
  const f = document.querySelector('input[name="avail_flexible"]');
  if (f && !f.checked) { f.checked = true; f.dispatchEvent(new Event('change', { bubbles: true })); }
});

/* walk from the chooser to the address screen, the paint tile lit */
async function toAddress(page, who) {
  await page.evaluate(() => {
    const b = document.querySelector('input[name="tiles"][value="paint"]');
    b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(140);
  for (let i = 0; i < 25; i++) {
    const s = await screenOf(page);
    if (s === 'address' || s === 'send') break;
    await fillAll(page, who);
    if (s === 'times') await flexible(page);
    await next(page);
    if ((await screenOf(page)) === s) break;
  }
  await fillAll(page, who);
  await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
  return screenOf(page);
}
/* and on from wherever it stands to the review */
async function toReview(page, who) {
  for (let i = 0; i < 25; i++) {
    const s = await screenOf(page);
    if (s === 'send') break;
    await fillAll(page, who);
    if (s === 'times') await flexible(page);
    await next(page);
    if ((await screenOf(page)) === s) break;
  }
  return screenOf(page);
}

/* every address-state line a customer can actually see, in the order the DOM holds them */
const shown = (page) => page.evaluate(() => {
  const vis = (e) => {
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden) return false;
      const st = getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
    }
    return true;
  };
  const out = [];
  for (const e of document.querySelectorAll('.uaddr-line, .v2need, [data-uaddr-need], .ch-addr-need'))
    if (vis(e) && e.textContent.trim()) out.push(e.textContent.replace(/\s+/g, ' ').trim());
  return out;
});

const NAVPAGES = ['/services', '/contact', '/request-received', '/index', '/es/servicios', '/es/index', '/es/recibido'];

/* ============================================================ 1 · THE MENU ON A PHONE */
if (!ONLY || ONLY === '1') {
  head('SITE-FIX-02 (1) THE MENU ON A PHONE \u2014 at 390 no nav item is clipped');
  for (const url of NAVPAGES) {
    const page = await open(390, url, false);
    const r = await page.evaluate(() => {
      const nav = document.querySelector('nav.menu');
      if (!nav) return { none: true };
      /* a control that opens the list counts: open it first, the way a thumb would */
      const ctl = document.querySelector('[data-menu-toggle], .nav-d > summary');
      if (ctl) ctl.click();
      const out = [];
      for (const a of nav.querySelectorAll('a')) {
        const b = a.getBoundingClientRect();
        out.push({ t: a.textContent.trim(), l: Math.round(b.left), r: Math.round(b.right) });
      }
      return { ctl: !!ctl, items: out, vw: window.innerWidth };
    });
    const bad = (r.items || []).filter((i) => i.l < -0.5 || i.r > r.vw + 0.5);
    ok(!r.none && (r.items || []).length > 0 && bad.length === 0,
      url + ' \u2014 every nav item\'s box is whole inside the 390 viewport',
      bad.length ? bad.map((b) => b.t + ' ' + b.l + '..' + b.r) : undefined);
    await page.close();
  }
}

/* ================================================= 2 · ONE ADDRESS STATE AT A TIME */
if (!ONLY || ONLY === '2') {
  head('SITE-FIX-02 (2) ONE ADDRESS STATE \u2014 Next before Yes, then Yes: only "Address confirmed." is left');
  const WIZ = [
    ['/services#request', WHO, 'The address still needs confirming.', 'Address confirmed.'],
    ['/es/servicios#pedir', WHO_ES, 'Todav\u00eda falta confirmar la direcci\u00f3n.', 'Direcci\u00f3n confirmada.'],
  ];
  for (const [url, who, notYet, done] of WIZ) {
    const page = await open(390, url);
    await toAddress(page, who);
    await page.click('[data-v2next]'); await wait(180);     /* Next BEFORE Yes — the CDO's own path */
    const held = await shown(page);
    ok(held.indexOf(notYet) > -1, url + ' \u2014 Next before Yes says "' + notYet + '"', held);
    const yes = await page.$('[data-uaddr-yes]');
    if (yes) { await yes.click(); await wait(300); }
    const after = await shown(page);
    ok(after.indexOf(done) > -1, url + ' \u2014 after Yes the page says "' + done + '"', after);
    ok(after.indexOf(notYet) === -1, url + ' \u2014 and "' + notYet + '" is GONE', after);
    ok(after.length === 1, url + ' \u2014 exactly one address state is on the screen', after);
    await page.close();
  }
  /* the plain pages: Send before Yes, then Yes */
  const PLAIN = [['/contact', WHO, 'The address still needs confirming.', 'Address confirmed.'],
    ['/es/index', WHO_ES, 'Todav\u00eda falta confirmar la direcci\u00f3n.', 'Direcci\u00f3n confirmada.']];
  for (const [url, who, notYet, done] of PLAIN) {
    const page = await open(390, url, false);
    await page.evaluate((w) => {
      const f = document.querySelector('form.req');
      const set = (sel, v) => { const e = f.querySelector(sel); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('[name="name"]', w.name); set('[name="phone"]', w.phone); set('[name="address"]', w.address); set('textarea[name="what"]', w.what);
      const radio = f.querySelector('input[name="service"]'); if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
    }, who);
    await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
    await page.evaluate(() => document.querySelector('form.req button[type="submit"]').click());
    await wait(250);
    const held = await shown(page);
    ok(held.indexOf(notYet) > -1, url + ' \u2014 Send before Yes says "' + notYet + '"', held);
    const yes = await page.$('[data-uaddr-yes]');
    if (yes) { await yes.click(); await wait(300); }
    const after = await shown(page);
    ok(after.indexOf(done) > -1 && after.indexOf(notYet) === -1 && after.length === 1,
      url + ' \u2014 after Yes only "' + done + '" is left', after);
    await page.close();
  }
}

/* ============================================ 3 · THE ADDRESS AS PEOPLE WRITE IT */
if (!ONLY || ONLY === '3') {
  head('SITE-FIX-02 (3) THE ADDRESS AS PEOPLE WRITE IT \u2014 "' + WRITTEN + '" on 5, 5b, 6 and 12');
  for (const [url, who] of [['/services#request', WHO], ['/es/servicios#pedir', WHO_ES]]) {
    const page = await open(390, url);
    await toAddress(page, who);
    const card = await page.$eval('[data-uaddr-found]', (e) => e.textContent.trim()).catch(() => '(no card)');
    eq(card, WRITTEN, url + ' (5) \u2014 the card says the address the way people write it');
    const yes = await page.$('[data-uaddr-yes]'); if (yes) { await yes.click(); await wait(280); }
    const field = await page.$eval('[name="address"]', (e) => e.value);
    eq(field, WRITTEN, url + ' (5b) \u2014 the address on the screen reads the same way');
    await toReview(page, who);
    const lines = await page.evaluate(() => [...document.querySelectorAll('.ch-rgroup .ch-rlist li')].map((x) => x.textContent.trim()));
    ok(lines.indexOf(WRITTEN) > -1, url + ' (6) \u2014 the review says it the same way', lines.filter((l) => /adams/i.test(l)));
    ok(!lines.some((l) => /ADAMS ST/.test(l) || /, TX, /.test(l)),
      url + ' (6) \u2014 and nowhere in caps or with a comma before the zip', lines.filter((l) => /adams/i.test(l)));
    const posted = await page.$eval('form.req', (f) => new FormData(f).get('address'));
    console.log('    [what posts] address = ' + JSON.stringify(posted));
    await page.close();
  }
  const page = await open(390, '/contact', false);
  await page.evaluate((w) => {
    const f = document.querySelector('form.req');
    const set = (sel, v) => { const e = f.querySelector(sel); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('[name="name"]', w.name); set('[name="phone"]', w.phone); set('[name="address"]', w.address); set('textarea[name="what"]', w.what);
  }, WHO);
  await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
  const card12 = await page.$eval('[data-uaddr-found]', (e) => e.textContent.trim()).catch(() => '(no card)');
  eq(card12, WRITTEN, '/contact (12) \u2014 the same card says it the same way');
  await page.close();
}

/* ====================================================== 4 · ONE BLUE FOR EVERY NEXT */
if (!ONLY || ONLY === '4') {
  head('SITE-FIX-02 (4) ONE BLUE FOR EVERY NEXT \u2014 every primary button is #003153');
  for (const [url, who] of [['/services#request', WHO], ['/es/servicios#pedir', WHO_ES]]) {
    const page = await open(390, url);
    const sample = () => page.evaluate(() => [...document.querySelectorAll('.btn:not(.ghost)')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({ t: b.textContent.trim().slice(0, 30), bg: getComputedStyle(b).backgroundColor })));
    const seen = [];
    await page.evaluate(() => {
      const b = document.querySelector('input[name="tiles"][value="paint"]');
      b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(140);
    for (let i = 0; i < 25; i++) {
      const s = await screenOf(page);
      for (const b of await sample()) seen.push(Object.assign({ screen: s }, b));
      if (s === 'send') break;
      await fillAll(page, who);
      if (s === 'address') {
        await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
        for (const b of await sample()) seen.push(Object.assign({ screen: '5-card' }, b));
        await page.click('[data-v2next]'); await wait(180);                   /* the held 5b the CDO saw */
        for (const b of await sample()) seen.push(Object.assign({ screen: '5b-held' }, b));
        const yes = await page.$('[data-uaddr-yes]'); if (yes) { await yes.click(); await wait(280); }
        for (const b of await sample()) seen.push(Object.assign({ screen: '5b-confirmed' }, b));
      }
      if (s === 'times') await flexible(page);
      await next(page);
      if ((await screenOf(page)) === s) break;
    }
    const off = seen.filter((b) => b.bg !== PRUSSIAN);
    ok(off.length === 0, url + ' \u2014 every primary button on every screen is ' + PRUSSIAN,
      off.length ? off.slice(0, 8) : undefined);
    await page.close();
  }
}

/* =============================== 5 · THE TWO COLOURS BACK ON THE PALETTE (B58) */
if (!ONLY || ONLY === '5') {
  head('SITE-FIX-02 (5) THE TWO COLOURS BACK ON THE PALETTE \u2014 crimson #7A0215, Prussian #003153, ink #0F0B1A');
  for (const [url, who, notYet] of [['/services#request', WHO, 'The address still needs confirming.'],
    ['/es/servicios#pedir', WHO_ES, 'Todav\u00eda falta confirmar la direcci\u00f3n.']]) {
    const page = await open(390, url);
    await toAddress(page, who);
    await page.click('[data-v2next]'); await wait(180);
    const red = await page.evaluate(() => {
      const e = [...document.querySelectorAll('.v2need, [data-uaddr-need], .ch-addr-need, .uaddr-need .uaddr-line')]
        .find((x) => !x.hidden && x.textContent.trim());
      return e ? getComputedStyle(e).color : '(none)';
    });
    eq(red, CRIMSON, url + ' \u2014 "' + notYet + '" is the kit\'s crimson #7A0215');
    const yes = await page.$('[data-uaddr-yes]'); if (yes) { await yes.click(); await wait(280); }
    const green = await page.$eval('.uaddr-ok .uaddr-line', (e) => getComputedStyle(e).color).catch(() => '(none)');
    eq(green, PRUSSIAN, url + ' \u2014 the confirmed line is Prussian #003153');
    await page.close();
  }
  for (const url of ['/services', '/es/servicios', '/request-received', '/es/recibido']) {
    const page = await open(390, url, false);
    const foot = await page.$eval('footer.foot', (e) => getComputedStyle(e).backgroundColor);
    eq(foot, INK, url + ' \u2014 the footer\'s ground is the card\'s ink #0F0B1A');
    await page.close();
  }
}

/* ========================================================= 6 · THE SEVEN ONE-LINERS */
if (!ONLY || ONLY === '6') {
  head('SITE-FIX-02 (6) THE SEVEN ONE-LINERS');
  {
    const page = await open(390, '/services#request');
    await page.evaluate(() => {
      const b = document.querySelector('input[name="tiles"][value="paint"]');
      b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(160); await next(page);
    const asks = await page.evaluate(() => [...document.querySelectorAll('[data-fstep="tile-paint"] .v2q')].map((e) => e.textContent.trim()));
    ok(asks.indexOf('What needs paint?') > -1, 'a \u00b7 the paint screen asks "What needs paint?"', asks);
    ok(asks.indexOf('What gets paint?') === -1, 'a \u00b7 and "What gets paint?" is gone', asks);
    const brit = await page.evaluate(() => (document.body.innerText.match(/colour/gi) || []).length);
    ok(brit === 0, 'b \u00b7 the English paint screen says "color", never "colour"', brit);
    await page.close();
  }
  for (const url of ['/services', '/contact', '/request-received', '/index', '/about', '/care-plans']) {
    const page = await open(390, url, false);
    const n = await page.evaluate(() => (document.body.innerText.match(/colour/gi) || []).length);
    ok(n === 0, 'b \u00b7 ' + url + ' \u2014 says "color", never "colour"', n);
    await page.close();
  }
  for (const url of ['/services#request', '/es/servicios#pedir']) {
    const who = url.indexOf('/es/') > -1 ? WHO_ES : WHO;
    const page = await open(390, url);
    const at = () => page.evaluate(() => {
      const p = document.getElementById('privacy');
      return { screen: document.querySelector('[data-intake2]').getAttribute('data-screen'),
        on: !!p && !p.hidden && getComputedStyle(p).display !== 'none' };
    });
    const log = [];
    await page.evaluate(() => {
      const b = document.querySelector('input[name="tiles"][value="paint"]');
      b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(140);
    for (let i = 0; i < 25; i++) {
      log.push(await at());
      const s = await screenOf(page);
      if (s === 'send') break;
      await fillAll(page, who);
      if (s === 'address') {
        await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 15000 }).catch(() => null);
        const y = await page.$('[data-uaddr-yes]'); if (y) { await y.click(); await wait(250); }
      }
      if (s === 'times') await flexible(page);
      await next(page);
      if ((await screenOf(page)) === s) break;
    }
    const on = log.filter((l) => l.on).map((l) => l.screen);
    ok(on.length === 2 && on.indexOf('chooser') > -1 && on.indexOf('send') > -1,
      'c \u00b7 ' + url + ' \u2014 the privacy line shows on the first screen and the review, nowhere else', on);
    await page.close();
  }
  for (const url of ['/services#request', '/es/servicios#pedir']) {
    const measure = async (w) => {
      const p = await open(w, url);
      const r = await p.evaluate(() => {
        const s = [...document.querySelectorAll('[data-chooser-tiles] .ch-sub')];
        const t = [...document.querySelectorAll('[data-chooser-tiles] .ch-tap')];
        return { n: s.length, shown: s.filter((e) => getComputedStyle(e).display !== 'none').length,
          lastBottom: t.length ? Math.round(t[t.length - 1].getBoundingClientRect().bottom) : null };
      });
      await p.close();
      return r;
    };
    const phone = await measure(390), desk = await measure(1440);
    ok(phone.n > 0 && phone.shown === phone.n && desk.shown === desk.n,
      'd \u00b7 ' + url + ' \u2014 the phone shows the line under every tile, as 1440 does', { phone, desk });
    console.log('    [room] at 390 the last tile ends at ' + phone.lastBottom + 'px of 844');
  }
  for (const url of ['/request-received', '/es/recibido']) {
    const page = await open(390, url, false);
    const order = await page.evaluate(() => {
      const pr = document.querySelector('.promise');
      const h = document.querySelector('main h1');
      if (!pr || !h) return null;
      const pos = h.compareDocumentPosition(pr);
      return { h1: h.textContent.trim(), after: !!(pos & Node.DOCUMENT_POSITION_FOLLOWING),
        hTop: Math.round(h.getBoundingClientRect().top), pTop: Math.round(pr.getBoundingClientRect().top) };
    });
    ok(!!order && order.after && order.hTop < order.pTop,
      'e \u00b7 ' + url + ' \u2014 the heading is first, the promise banner sits under it', order);
    await page.close();
  }
  for (const url of ['/services', '/es/servicios', '/request-received']) {
    const page = await open(390, url, false);
    const said = await page.evaluate(() => [...document.querySelectorAll('footer.foot p')]
      .map((p) => p.textContent.replace(/\s+/g, ' ').trim())
      .filter((t) => /real estate|bienes ra\u00edces/i.test(t)));
    ok(said.length === 1, 'f \u00b7 ' + url + ' \u2014 the footer says what Umbra is once', said);
    await page.close();
  }
}

await browser.close();
await new Promise((r) => server.close(r));
await new Promise((r) => census.close(r));
console.log('\nSITE-FIX-02 READINGS: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
