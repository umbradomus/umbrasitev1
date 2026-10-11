/* FLUX-ROUTE-01 · THE WALK. Pictures of the road his QR opens, BEFORE and AFTER, at 390 wide.
   BEFORE is today's live road: GET only, of public pages, and inside the browser every request
   that is not a GET of www.umbradomus.com is caught and answered here - the live Worker is never
   reached and nothing is ever posted anywhere. AFTER is a local preview of THIS worktree on a
   port of its own. The Census geocoder is answered by this script's own stub through the seam
   umbra-address.js already has, so the address card runs its real code path with no packet
   leaving this machine. No text, no email, no booking.

   Run: node tools/flux-route-01-walk.mjs      (its own port, its own pid, both named at the end) */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const PUP = 'C:/Users/andre/Umbra/umbrasitev1-wt/accept-page-01/worker/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const puppeteer = (await import('file:///' + PUP)).default;

const ROOT = path.resolve('.');
const OUT = 'C:/Users/andre/Umbra/Boss/Bridge/FLUX-ROUTE-01/shots';
const REC = 'C:/Users/andre/Umbra/Boss/Bridge/FLUX-ROUTE-01/readings';
const PORT = 4953;                      /* mine; never 4177/4178/4747/4750 */
const LIVE = 'https://www.umbradomus.com';
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  /* vercel.json's own two rewrites, so a deep link opens the step it names */
  if (/^\/request(\/|$)/.test(p)) p = '/request/index.html';
  else if (/^\/es\/solicitud(\/|$)/.test(p)) p = '/es/solicitud/index.html';
  else if (p.endsWith('/')) p += 'index.html';
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    /* vercel.json cleanUrls: /es -> es/index.html, /contact -> contact.html */
    if (fs.existsSync(f) && fs.statSync(f).isDirectory() && fs.existsSync(path.join(f, 'index.html'))) f = path.join(f, 'index.html');
    else if (fs.existsSync(f + '.html')) f += '.html';
    else { res.writeHead(404); res.end('no ' + p); return; }
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + PORT;
console.log('serving this worktree at ' + BASE + '   (pid ' + process.pid + ')');

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!CHROME) { console.log('RED: no Chrome or Edge on this machine'); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--hide-scrollbars']
});
console.log('browser: ' + CHROME + '   (one at a time)');

const shots = [], posts = [], blocked = [], defects = [], liveGets = [];

/* NO PHONE NUMBER AND NO EMAIL LEAVES THIS WALK. It is a one-person business, so the number and
   the inbox printed on every page of his site are his own. Every picture is taken with both
   painted over first, and 40-walk-readings.json records how many it painted on each page.
   Nothing else on the page is touched. */
async function maskPhones(page) {
  return await page.evaluate(() => {
    const RE = new RegExp("\\(?\\b\\d{3}\\)?[\\s.\\-]?\\d{3}[\\s.\\-]\\d{4}\\b|\\+1\\d{10}", "g");
    const MAIL = new RegExp("\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b", "g");
    const scrub = (s) => { RE.lastIndex = 0; MAIL.lastIndex = 0; return s.replace(RE, '(the business number)').replace(MAIL, '(the business email)'); };
    let n = 0;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (w.nextNode()) hits.push(w.currentNode);
    for (const t of hits) { const before = t.nodeValue; const after = scrub(before); if (after !== before) { t.nodeValue = after; n++; } }
    for (const a of document.querySelectorAll('a[href^="tel:"],a[href^="sms:"],a[href^="mailto:"]')) a.setAttribute('href', '#masked');
    for (const i of document.querySelectorAll('input,textarea')) { const after = scrub(i.value || ''); if (after !== (i.value || '')) { i.value = after; n++; } }
    return n;
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function censusBody(url) {
  const cb = (url.match(/[?&]callback=([^&]+)/) || [null, 'cb'])[1];
  const body = { result: { addressMatches: [{ matchedAddress: '1 MAIN ST, BROWNSVILLE, TX, 78520', coordinates: { x: -97.4975, y: 25.9017 } }] } };
  return cb + '(' + JSON.stringify(body) + ');';
}

async function newPage(liveOk) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) { } });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url(), m = r.method();
    if (/geocoding\.geo\.census\.gov|\/stub-census/.test(u)) {
      return r.respond({ status: 200, contentType: 'text/javascript', body: censusBody(u) });
    }
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') return r.continue();
    if (liveOk && m === 'GET' && u.startsWith(LIVE) && !/workers\.dev|\/intake|\/q\/|\/receipt\//.test(u)) {
      liveGets.push(u); return r.continue();
    }
    /* THE STUB. Nothing else leaves this machine. A post is recorded, never sent. */
    if (m !== 'GET') posts.push({ url: u, method: m, body: (r.postData() || '(not readable)').slice(0, 400) });
    else blocked.push(u);
    return r.respond({
      status: 200, contentType: 'text/plain', body: 'OK (stub)',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
    });
  });
  page.on('pageerror', (e) => defects.push('page error: ' + e.message));
  page.on('console', (mm) => { if (mm.type() === 'error') defects.push('console: ' + mm.text().slice(0, 160)); });
  return page;
}

async function shot(page, name, note) {
  const file = path.join(OUT, name + '.png');
  await sleep(200);
  const masked = await maskPhones(page);
  await page.screenshot({ path: file, fullPage: true });
  const read = await page.evaluate(() => {
    const d = document;
    const txt = d.body.innerText;
    return {
      over: d.documentElement.scrollWidth > d.documentElement.clientWidth + 1,
      clip: [...d.querySelectorAll('h1,h2,.btn')].filter((e) => e.scrollWidth > e.clientWidth + 2).length,
      h1: (d.querySelector('h1') || { textContent: '' }).textContent.trim().slice(0, 60),
      url: location.pathname, chars: txt.length,
      onlyDrew: (txt.match(/Only Drew|Solo Drew/g) || []).length,
      confirmedLine: (txt.match(/Address confirmed|Direcci\u00f3n confirmada/g) || []).length,
      needLine: (txt.match(/We need the house number|Necesitamos el n\u00famero de la casa/g) || []).length,
      requestLinks: [...d.querySelectorAll('a[href]')].filter((a) => /^\/(request|es\/solicitud)(\/|$|\?)/.test(a.getAttribute('href') || '')).length
    };
  });
  if (read.over) defects.push(name + ': scrolls sideways at 390');
  if (read.clip) defects.push(name + ': ' + read.clip + ' clipped line(s)');
  shots.push({ name, note: note || '', masked, ...read, bytes: fs.statSync(file).size });
  console.log('  ' + name.padEnd(42) + read.url.padEnd(20) + '"' + read.h1.slice(0, 30) + '"' +
    '  links-to-door ' + read.requestLinks +
    (read.over ? ' SIDEWAYS' : '') + (read.clip ? ' CLIPPED' : '') + (read.onlyDrew ? ' ONLY-DREW' : '') +
    (read.confirmedLine ? ' SECOND-STOP' : '') + (read.needLine ? ' RED-LINE' : ''));
  return read;
}

async function crop(page, sel, name) {
  const el = await page.$(sel);
  if (!el) { defects.push(name + ': no element ' + sel); return; }
  const file = path.join(OUT, name + '.png');
  const masked = await maskPhones(page);
  await el.screenshot({ path: file });
  shots.push({ name, masked, note: 'the ' + sel + ' alone', url: page.url().replace(BASE, '').replace(LIVE, ''), bytes: fs.statSync(file).size, chars: 0, h1: '' });
  console.log('  ' + name.padEnd(42) + '(' + sel + ' alone)  ' + fs.statSync(file).size + ' bytes');
}

/* the address card, walked the same way on any page that has an address field */
async function addressWalk(page, sel, tag) {
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.click(sel);
  await page.type(sel, '12 Mai', { delay: 45 });     /* still typing - no red line is allowed here */
  await sleep(1100);
  await shot(page, tag + '-address-still-typing', 'half an address typed, the box still has focus');
  await page.type(sel, 'n St, Brownsville TX 78520', { delay: 20 });
  await sleep(1500);
  await shot(page, tag + '-address-card-asking', 'the "Is this the place?" card he said to KEEP');
  const yes = await page.$('[data-uaddr-yes]');
  if (!yes) { defects.push(tag + ': no "Yes, that is it" button appeared'); return; }
  await yes.click();
  await sleep(1000);
  await shot(page, tag + '-address-after-yes', 'one tap after "Yes, that is it"');
}

/* ======================================================= BEFORE · today's live road */
console.log('');
console.log('BEFORE - the live road (GET only, public pages):');
for (const pair of [['/services', '01-before-the-QR-page'], ['/', '02-before-the-home-page'],
  ['/contact', '03-before-the-contact-page'], ['/es/servicios', '04-before-the-ES-QR-page'],
  ['/es', '05-before-the-ES-home-page']]) {
  const page = await newPage(true);
  await page.goto(LIVE + pair[0], { waitUntil: 'networkidle2', timeout: 60000 });
  await shot(page, pair[1], 'the live page today');
  await page.close();
}
{
  const page = await newPage(true);
  await page.goto(LIVE + '/contact', { waitUntil: 'networkidle2', timeout: 60000 });
  await addressWalk(page, 'input[name="address"]', '06-before');
  await page.close();
}

/* ======================================================== AFTER · this worktree, local */
console.log('');
console.log('AFTER - a local preview of this worktree:');
for (const row of [
  ['/services', '10-after-the-QR-page', 'what his printed QR opens now'],
  ['/', '12-after-the-home-page', 'the home page, with a request button'],
  ['/contact', '13-after-the-contact-page', 'the contact page, with a request button'],
  ['/es/servicios', '14-after-the-ES-QR-page', 'what his printed Spanish QR opens now'],
  ['/es', '15-after-the-ES-home-page', 'the Spanish home page'],
  ['/es/contacto', '16-after-the-ES-contact-page', 'the Spanish contact page'],
  ['/request', '17-after-the-door-at-its-own-address', 'the door at /request, unchanged'],
  ['/prices', '18-after-the-prices-page', 'where the old page lives now'],
  ['/es/precios', '19-after-the-ES-prices-page', 'the Spanish price page']
]) {
  const page = await newPage(false);
  await page.goto(BASE + row[0], { waitUntil: 'networkidle0', timeout: 60000 });
  await shot(page, row[1], row[2]);
  if (row[0] === '/services') await crop(page, '.hd, .hd-big, header', '11-after-the-name-on-his-phone');
  if (row[0] === '/') await crop(page, '.fd-hero .cta-row', '12b-after-the-home-buttons');
  if (row[0] === '/contact') await crop(page, '.cta-row', '13b-after-the-contact-buttons');
  await page.close();
}
{   /* the door's own address step, deep-linked, so "Yes, that is it" IS the Next */
  const page = await newPage(false);
  await page.goto(BASE + '/request/drywall/address', { waitUntil: 'networkidle0', timeout: 60000 });
  await addressWalk(page, '#fd-addr', '20-after-the-door');
  await page.close();
}
{   /* and the same card on a plain page, which is where he met it */
  const page = await newPage(false);
  await page.goto(BASE + '/contact', { waitUntil: 'networkidle0', timeout: 60000 });
  await addressWalk(page, 'input[name="address"]', '21-after-the-contact-page');
  await page.close();
}

await browser.close();
await new Promise((r) => server.close(r));

const out = {
  when: new Date().toISOString(), port: PORT, pid: process.pid, browser: CHROME,
  shots, defects, posts, blockedNonLive: blocked.slice(0, 40), liveGetCount: liveGets.length,
  liveHosts: [...new Set(liveGets.map((u) => new URL(u).host))]
};
fs.writeFileSync(path.join(REC, '40-walk-readings.json'), JSON.stringify(out, null, 1));
console.log('');
console.log('pictures: ' + shots.length + '   defects: ' + defects.length + '   posts caught by the stub: ' + posts.length);
for (const d of defects) console.log('  DEFECT  ' + d);
console.log('live GETs: ' + liveGets.length + ' to hosts ' + out.liveHosts.join(', ') + '   non-live requests caught: ' + blocked.length);
console.log('RESULT: ' + (defects.length ? 'DEFECTS ' + defects.length : 'CLEAN'));
console.log('server closed, browser closed; the only pid this script started is its own ' + process.pid);
