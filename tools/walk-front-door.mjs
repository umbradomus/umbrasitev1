/* FRONT-DOOR-01 · THE WALK. A real browser, the real pages, 390x844 and 1280x900.
   It serves the tree it is pointed at (clean URLs, like Vercel), opens / and /es at both
   sizes, and READS, never assumes:
     - every menu tile is a link into the form page (/services or /es/servicios) that carries
       the chosen job, and the job's service agrees with the chooser tile it lights
     - "licensed" / "licencia" appear 0 times; no hourly figure ("/hour", "per hour", "/hr",
       "la hora", "por hora") appears
     - the sms: link is there, with its body
     - no console error, no horizontal overflow at 390 (and at 320 / 430 as a bonus)
     - the hero's first button reads 3:1 against the hero as a shape and 4.5:1 as text
     - every tile is 44px tall or more
     - on /services the chooser still initializes, and a tile tapped on / lands on the form
       with that service ticked, the chooser tile lit and the job's name in the sentence box
   It saves a full-page picture of / and /es at both sizes, and of the landing on /services.
   Run:  node tools/walk-front-door.mjs                 (this tree → front-door-proof/green)
         WALK_ROOT=<a checkout of main> WALK_OUT=.../red node tools/walk-front-door.mjs
   It exits 1 when any reading fails, so RED on main is a real red. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const c of ['playwright', '/opt/npm-tools/node_modules/playwright', path.join(process.cwd(), 'worker/node_modules/playwright')]) {
    try { return require(c); } catch (e) { /* next */ }
  }
  throw new Error('playwright is not installed: npm i -D playwright (or set NODE_PATH)');
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(process.env.WALK_ROOT || '.');
const OUT = path.resolve(process.env.WALK_OUT || path.join(process.env.HOME || '.', 'front-door-proof', 'green'));
const PORT = Number(process.env.WALK_PORT || 4971);
const EXE = process.env.WALK_CHROME || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    if (fs.existsSync(f + '.html')) f += '.html';
    else if (fs.existsSync(path.join(f, 'index.html'))) f = path.join(f, 'index.html');
    else { res.writeHead(404); res.end('no ' + p); return; }
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = 'http://127.0.0.1:' + PORT;

/* ------------------------------------------------------------------ readings */
let pass = 0, fail = 0;
const lines = [];
function say(s) { lines.push(s); console.log(s); }
function ok(cond, what, got) {
  if (cond) { pass++; say('  ok   ' + what); }
  else { fail++; say('  FAIL ' + what + (got != null ? '  — got: ' + String(got).slice(0, 300) : '')); }
}
function suite(s) { say('\n' + s); }

/* WCAG relative luminance and contrast, from an rgb() string */
function lum(rgb) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return null;
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]);
}
function contrast(a, b) { const la = lum(a), lb = lum(b); if (la == null || lb == null) return 0; const [h, l] = la > lb ? [la, lb] : [lb, la]; return (h + 0.05) / (l + 0.05); }

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const SIZES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }];
const PAGES = [
  { route: '/', lang: 'en', form: '/services', hash: 'request', licensed: 'licensed', legal: 'Electrical and plumbing work, including appliance installation, is performed by licensed contractors we work with.', hourly: ['/hour', 'per hour', '/hr', 'an hour', 'hourly'] },
  { route: '/es', lang: 'es', form: '/es/servicios', hash: 'pedir', licensed: 'licencia', legal: 'El trabajo eléctrico y de plomería, incluida la instalación de electrodomésticos, lo realizan contratistas con licencia con los que trabajamos.', hourly: ['la hora', 'por hora', '/hora', '/hr'] },
];
const R = { root: ROOT, out: OUT, pages: {} };

async function open(size, route) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  /* the Worker is across the internet; the form's time picker asks it one GET on load and keeps
     its own default when the answer says nothing. A stand-in answers that one call here, so a
     sandbox without the internet reads the page and not the network. Nothing is POSTed. */
  await page.route('**/umbra-intake.umbradomus.workers.dev/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"allow_sunday":false,"blocked_dates":[]}' }));
  await page.goto(SITE + route, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}

for (const P of PAGES) {
  for (const size of SIZES) {
    suite(`${P.route} at ${size.width}x${size.height}`);
    const { ctx, page, errors } = await open(size, P.route);
    const shot = path.join(OUT, `home-${P.lang}-${size.name}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    say('  shot ' + shot);

    const read = await page.evaluate(() => {
      const text = document.body.innerText.replace(/\s+/g, ' ');
      const tiles = [...document.querySelectorAll('[data-menu] a[data-menu-item]')].map((a) => ({
        key: a.getAttribute('data-menu-item'), href: a.getAttribute('href'), tile: a.getAttribute('data-tile'),
        service: a.getAttribute('data-service'), h: a.getBoundingClientRect().height, w: a.getBoundingClientRect().width,
        name: (a.querySelector('.mname') || a).textContent.trim(), price: (a.querySelector('.mamt, .v') || {}).textContent || '',
      }));
      const sms = [...document.querySelectorAll('a[href^="sms:"]')].map((a) => a.getAttribute('href'));
      const hero = document.querySelector('.fd-hero');
      const btn = hero ? hero.querySelector('.btn') : null;
      const cs = (e, p) => (e ? getComputedStyle(e)[p] : '');
      const groups = [...document.querySelectorAll('[data-menu-group]')].map((g) => g.getAttribute('data-menu-group'));
      const firstTile = document.querySelector('[data-menu] .menu-tiles');
      const cols = firstTile ? getComputedStyle(firstTile).gridTemplateColumns.split(' ').length : 0;
      const names = [...document.querySelectorAll('[data-menu] .mname')].map((e) => ({ fs: parseFloat(getComputedStyle(e).fontSize), over: e.scrollWidth > e.clientWidth + 1 }));
      return {
        text, tiles, sms, groups, cols, names,
        drawn: document.querySelector('[data-menu]') ? document.querySelector('[data-menu]').getAttribute('data-menu-drawn') : null,
        heroBg: cs(hero, 'backgroundColor'), btnBg: cs(btn, 'backgroundColor'), btnFg: cs(btn, 'color'), btnText: btn ? btn.textContent.trim() : '',
        bodyFs: parseFloat(cs(document.querySelector('main'), 'fontSize')),
        scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
        h1: (document.querySelector('h1') || {}).textContent || '',
        title: document.title,
        ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent); } catch (e) { return null; } }),
        footer: (document.querySelector('footer') || {}).innerText || '',
        headerOk: !!document.querySelector('header.top .brand') && !!document.querySelector('header.top nav.menu') && !!document.querySelector('p.promise'),
      };
    });
    const low = read.text.toLowerCase();

    ok(read.headerOk, 'header, nav and promise strip are the site’s own');
    ok(/small jobs, done this week|trabajos pequeños, listos esta semana/i.test(read.h1), 'the hero says the headline', read.h1);
    ok(read.tiles.length >= 24, `the menu is drawn: ${read.tiles.length} tiles (24 jobs + the day card)`, read.tiles.length);
    ok(read.groups.length === 5, 'five groups', read.groups.join(','));
    const badHref = read.tiles.filter((t) => !(t.href.startsWith(P.form + '?menu=') && t.href.endsWith('#' + P.hash)));
    ok(read.tiles.length > 0 && badHref.length === 0, `every tile is a link to ${P.form}?menu=<key>#${P.hash}`, badHref.map((t) => t.href).join(' '));
    const noSvc = read.tiles.filter((t) => !t.service || !t.tile);
    ok(read.tiles.length > 0 && noSvc.length === 0, 'every tile carries its service and the chooser tile it lights', noSvc.map((t) => t.key).join(','));
    const short = read.tiles.filter((t) => t.h < 44 || t.w < 44);
    ok(read.tiles.length > 0 && short.length === 0, 'every tile is a 44px tap target or bigger', short.map((t) => t.key + ':' + Math.round(t.h)).join(','));
    const outside = low.split(P.legal.toLowerCase()).join(' ');
    const licCount = (outside.match(new RegExp(P.licensed, 'g')) || []).length;
    ok(licCount === 0, `"${P.licensed}" appears 0 times outside the contractor line`, licCount);
    const hourly = P.hourly.filter((h) => low.indexOf(h) > -1);
    ok(hourly.length === 0, 'no hourly figure on the page', hourly.join(', '));
    ok(read.sms.some((h) => /^sms:\+19565566438\?body=/.test(h)), 'the sms: link is there, with its body', read.sms.join(' '));
    ok(errors.length === 0, 'no console error', errors.join(' | '));
    ok(read.scrollW <= read.innerW, 'no horizontal overflow', `${read.scrollW} > ${read.innerW}`);
    ok(read.bodyFs >= 18, 'body type is 18px', read.bodyFs);
    if (size.width < 600) {
      ok(read.cols === 2, 'tiles sit two to a row on a phone', read.cols);
    }
    const tiny = read.names.filter((n) => n.fs < 15 || n.over);
    ok(read.names.length > 0 && tiny.length === 0, 'tile names are 15px or more and do not spill', JSON.stringify(tiny.slice(0, 3)));
    const cShape = contrast(read.btnBg, read.heroBg), cText = contrast(read.btnFg, read.btnBg);
    ok(cShape >= 3, `hero button reads as a shape on the hero: ${cShape.toFixed(2)}:1 (3:1 needed)`, `${read.btnBg} on ${read.heroBg}`);
    ok(cText >= 4.5, `hero button text reads: ${cText.toFixed(2)}:1 (4.5:1 needed)`, `${read.btnFg} on ${read.btnBg}`);
    ok(/\$45–\$649/.test(JSON.stringify(read.ld)) && /HomeAndConstructionBusiness/.test(JSON.stringify(read.ld)), 'JSON-LD: HomeAndConstructionBusiness with the price range');
    ok(/small jobs done this week|trabajos pequeños, listos esta semana/i.test(read.title), 'the title', read.title);
    ok(/real estate development|desarrollo inmobiliario/.test(read.footer), 'the footer line is as it was', read.footer.slice(0, 120));
    const need = ['$89', '$119', '$69', '$45', '$79', '$99', '$149', '$39', '$129', '$349', '$239', '$199', '$649'];
    const missing = need.filter((p) => read.text.indexOf(p) < 0);
    ok(missing.length === 0, 'the fixed prices are all on the page', missing.join(','));
    R.pages[`${P.lang}-${size.name}`] = { tiles: read.tiles.length, shot, errors, contrast: { shape: cShape, text: cText }, scrollW: read.scrollW };

    /* ---------------------------------------------- a tap on a tile lands on the form */
    if (size.width < 600 && read.tiles.length) {
      const picks = [
        { key: 'door', tile: 'door', service: 'Doors & Carpentry' },
        { key: 'gutters', tile: 'outside', service: 'Yard & Property' },
        { key: 'tv', tile: 'else', service: 'Not sure' },
      ];
      for (const pick of picks) {
        suite(`  tap "${pick.key}" on ${P.route} → ${P.form}`);
        const fresh = await open(size, P.route);
        const a = fresh.page.locator(`[data-menu] a[data-menu-item="${pick.key}"]`).first();
        const want = await a.getAttribute('href').catch(() => null);
        if (!want) { ok(false, 'the tile exists', 'no tile ' + pick.key); await fresh.ctx.close(); continue; }
        const tileText = await a.locator('.mname').textContent();
        await a.scrollIntoViewIfNeeded();
        await Promise.all([fresh.page.waitForURL((u) => u.pathname === P.form, { timeout: 15000 }), a.click()]);
        await fresh.page.waitForSelector('[data-intake2][data-screen]', { timeout: 15000 }).catch(() => null);
        await fresh.page.waitForTimeout(400);
        const st = await fresh.page.evaluate(() => {
          const f = document.querySelector('form.req');
          const on = (n) => [...document.querySelectorAll(`form.req input[name="${n}"]`)].filter((e) => e.checked).map((e) => e.value);
          const root = document.querySelector('[data-intake2]');
          return {
            url: location.pathname + location.search + location.hash,
            screen: root ? root.getAttribute('data-screen') : null,
            chooserDrawn: !!document.querySelector('[data-chooser-tiles]'),
            service: on('service'), tiles: on('tiles'),
            hiddenTiles: (f.querySelector('input[type="hidden"][name="tiles"]') || {}).value || '',
            what: (f.querySelector('textarea[name="what"]') || {}).value || '',
            pick: f.getAttribute('data-menu-pick'),
            lit: window.UmbraChooser ? window.UmbraChooser.lit().map((t) => t.key) : null,
            top: (document.querySelector('#request, #pedir') || {}).getBoundingClientRect ? document.querySelector('#request, #pedir').getBoundingClientRect().top : null,
            menuOnForm: document.querySelectorAll('[data-menu] a[data-menu-item]').length,
          };
        });
        ok(st.chooserDrawn && !!st.screen, 'the chooser initialized on the form page', JSON.stringify({ screen: st.screen, drawn: st.chooserDrawn }));
        ok(st.screen === 'chooser', 'and the customer lands on the chooser screen', st.screen);
        ok(st.service[0] === pick.service, `service is "${pick.service}"`, st.service.join(','));
        ok(st.tiles.indexOf(pick.tile) > -1 && (st.lit || []).indexOf(pick.tile) > -1, `the "${pick.tile}" chooser tile is lit, and travels`, JSON.stringify({ tiles: st.tiles, lit: st.lit, hidden: st.hiddenTiles }));
        ok(st.what.indexOf(tileText.trim()) > -1, 'the job’s name is in "Anything else, in a sentence"', st.what);
        ok(st.pick === pick.key, 'the form says which job was picked', st.pick);
        ok(st.menuOnForm >= 24, 'the same menu is on the form page too', st.menuOnForm);
        ok(st.top != null && st.top < size.height, 'the form is on screen after the tap', st.top);
        ok(fresh.errors.length === 0, 'no console error on the form page', fresh.errors.join(' | '));
        if (pick.key === 'door') {
          const fshot = path.join(OUT, `form-${P.lang}-landed-${pick.key}.png`);
          await fresh.page.screenshot({ path: fshot, fullPage: false });
          say('  shot ' + fshot);
          const full = path.join(OUT, `services-${P.lang}-390.png`);
          await fresh.page.screenshot({ path: full, fullPage: true });
          say('  shot ' + full);
        }
        await fresh.ctx.close();
      }
    }
    await ctx.close();
  }
  /* the narrow and the wide phone, overflow only */
  for (const w of [320, 430]) {
    suite(`${P.route} at ${w} wide — overflow`);
    const o = await open({ width: w, height: 844 }, P.route);
    const r = await o.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
      names: [...document.querySelectorAll('[data-menu] .mname')].filter((e) => e.scrollWidth > e.clientWidth + 1).length }));
    ok(r.sw <= r.iw, `no horizontal overflow at ${w}`, `${r.sw} > ${r.iw}`);
    ok(r.names === 0, `no tile name spills at ${w}`, r.names);
    if (w === 320) { const s = path.join(OUT, `home-${P.lang}-320.png`); await o.page.screenshot({ path: s, fullPage: true }); say('  shot ' + s); }
    await o.ctx.close();
  }
}

/* ------------------------------------------- the menu and the chooser agree */
suite('the menu’s service for each job is what its chooser tile ticks');
{
  const o = await open(SIZES[1], '/services');
  const r = await o.page.evaluate(() => {
    if (!window.UmbraMenu || !window.UMBRA_CHOOSER) return null;
    const byKey = {}; window.UMBRA_CHOOSER.tiles.forEach((t) => { byKey[t.key] = t.service; });
    return window.UmbraMenu.items.map((i) => ({ key: i.key, tile: i.tile, service: i.service, tileSays: byKey[i.tile] }));
  });
  ok(!!r, 'both files are on the page');
  if (r) {
    const dis = r.filter((x) => x.tileSays !== x.service);
    ok(dis.length === 0, `${r.length} jobs, every one agrees with its tile`, JSON.stringify(dis));
    const noTile = r.filter((x) => x.tileSays == null);
    ok(noTile.length === 0, 'every job names a tile the chooser has', JSON.stringify(noTile));
  }
  const shot = path.join(OUT, 'services-en-1280.png');
  await o.page.screenshot({ path: shot, fullPage: true });
  say('  shot ' + shot);
  await o.ctx.close();
}

await browser.close();
await new Promise((r) => server.close(r));
say(`\n${fail === 0 ? 'GREEN' : 'RED'} — ${pass} ok, ${fail} failed · root ${ROOT}`);
fs.writeFileSync(path.join(OUT, 'walk.txt'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'walk.json'), JSON.stringify(Object.assign(R, { pass, fail }), null, 2));
process.exit(fail === 0 ? 0 : 1);
