/* ============================================================================
   K · SITE-FIX-01 — "FIX SOMETHING" LANDS ON THE CHOOSER.

   Drew: "the form is still taking us to fill in straight to drywall ... i have to
   scroll up from the drywall form that it just starts us already on to even see any
   of these options ... all i need is a little painting done."

   Nine readings, one per clause of the ignite and the amend it carries:
     (1) the landing            — ignite (2): #request puts the TOP of the chooser on screen
     (2) one screen, one tap    — ignite (2): 390x844, tiles by symptom, multi-select, one mapping file
     (3) while we're there      — ignite (3) + amend A6(1): one-person jobs only, each tap a line
     (4) a tile owns its asks   — amend A1: nobody sees another tile's questions
     (5) his job, end to end    — amend A4b: paint only, five answers, and no hole field in the post
     (6) the ask and the review — ignite (4) + amend A3: photos first, ONE Send, on the review alone
     (7) the address            — amend A2: gibberish cannot pass, the card confirms, the key file is empty
     (8) espanol                — every one of the above, in Spanish
     (9) the pictures           — ignite (1): no page names a picture this round removed

   HOW IT IS POINTED. The site under test is run-all's `siteNew` copy, whose form
   posts to the FormSubmit relay, so every reading of what TRAVELS is read from the
   captured multipart. UMBRA_K_SITE=siteOld points the whole suite at the tree
   before this round instead — that is how each reading below was proved RED first.
   Nothing here talks to a real Census, a real Google or a real endpoint.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { parseMultipart, fieldValue } from './lib/multipart.mjs';

/* words that would put Umbra in a licensed trade. The standing brief: electrical,
   plumbing, A/C and security are not ours — never offered, never in a picker. */
const LICENSED = [
  'electrician', 'electrical', 'rewire', 'breaker', 'panel upgrade', 'outlet', 'switch',
  'plumber', 'plumbing', 'water heater', 'sewer', 'repipe',
  'hvac', 'a/c', 'air conditioner', 'air conditioning', 'furnace', 'thermostat',
  'alarm system', 'security camera', 'camera', 'doorbell', 'smart lock', 'deadbolt',
  'smoke alarm', 'smoke detector', 'gas line',
];
/* the words of the old form that no customer should ever read (amend A1) */
const NEVER_READ = ['sections', 'basketball'];
/* the pictures this round took off the site (ignite (1)) */
const REMOVED_PICTURES = ['ideas-04', 'ideas-05', 'ideas-06', 'ideas-09', 'ideas-11', 'construction', 'automation'];

export async function suiteChooser(ctx) {
  const { browser, relay, suite, ok, eq, sleep, PORT } = ctx;
  /* the files the last two readings read. UMBRA_K_ROOT points them at another tree
     (that is how they were proved RED against the tree before this round). */
  const REPO_DIR = process.env.UMBRA_K_ROOT || ctx.REPO_DIR;
  const KEY = process.env.UMBRA_K_SITE || 'siteNew';
  const SITE = `http://127.0.0.1:${PORT[KEY]}`;
  const R = { site: KEY };
  const relayPosts = () => relay.captured.filter((c) => c.method === 'POST');

  /* ------------------------------------------------- a stand-in Census geocoder
     The real one is across the internet and has no CORS; the module reaches it with
     a script tag. This answers one address and nothing else. It is stopped below. */
  const censusAsked = [];
  const census = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    censusAsked.push(u.pathname);
    const cb = u.searchParams.get('callback') || 'cb';
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(cb + '(' + JSON.stringify({
      result: { addressMatches: [{ matchedAddress: '1200 E ADAMS ST, BROWNSVILLE, TX, 78520', coordinates: { x: -97.4967, y: 25.9022 } }] },
    }) + ');');
  });
  await new Promise((r) => census.listen(PORT.extraD, '127.0.0.1', r));
  const CENSUS = `http://127.0.0.1:${PORT.extraD}`;

  async function newPage(width = 390) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: width <= 420 ? 844 : 900 });
    await page.evaluateOnNewDocument((base) => { window.UMBRA_CENSUS_BASE = base; }, CENSUS);
    page.on('dialog', async (d) => { await d.dismiss(); });
    return page;
  }
  async function land(page, route, width = 390) {
    await page.setViewport({ width, height: width <= 420 ? 844 : 900 });
    /* 'load', not 'domcontentloaded': the pictures below the form set the page's
       height, and a customer's browser lands where that height says. */
    await page.goto(SITE + route, { waitUntil: 'load' });
    await page.waitForSelector('[data-intake2][data-screen]', { timeout: 15000 }).catch(() => null);
    return page;
  }
  const screenOf = (page) => page.$eval('[data-intake2]', (e) => e.getAttribute('data-screen')).catch(() => '(none)');
  const next = async (page) => { await page.click('[data-v2next]'); await sleep(90); };
  const tap = (page, sel) => page.evaluate((s) => {
    const b = document.querySelector(s);
    if (!b) return false;
    if (b.tagName === 'INPUT') { b.checked = !b.checked; b.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    b.click(); return true;
  }, sel);
  const fill = (page, who) => page.evaluate((w) => {
    const f = document.querySelector('form.req');
    /* only a CHANGE is typed. Re-typing the same address would re-open the address
       question and throw away the confirmation the walk already tapped Yes on, the
       same as it would for a customer who never touched the field again. */
    /* an empty field is typed into ONCE. A customer does not retype an address the
       page has already tidied and confirmed, and neither does this walk: typing it
       again re-opens the address question and throws the confirmation away. */
    const set = (sel, v) => {
      const e = f.querySelector(sel);
      if (e && v && !e.value) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }
    };
    set('[name="name"]', w.name); set('[name="phone"]', w.phone);
    set('[name="address"]', w.address); set('textarea[name="what"]', w.what);
  }, who);
  const WHO = {
    name: 'Chooser Cleo', phone: '956 555 0177',
    address: '1200 E Adams St, Brownsville, TX 78520',
    what: 'the patch on the ceiling is a different color',
  };

  /* G83: an unbounded substring test on words is a defect class of its own. "recámara"
   is a bedroom and contains "cámara"; "switches" is the licensed trade and "switch"
   inside another word is not. Every term below is matched as a WHOLE word. */
function namesAny(text, terms) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const edge = '[^a-z\\u00e1\\u00e9\\u00ed\\u00f3\\u00fa\\u00fc\\u00f1]';
  return terms.filter((t) => new RegExp('(^|' + edge + ')' + esc(t) + '(' + edge + '|$)', 'i').test(text));
}

/* every word a customer can read on the chooser screen and on every tile screen */
  const readable = (page) => page.evaluate(() => {
    const bits = [];
    const grab = (sel) => document.querySelectorAll(sel).forEach((e) => bits.push(e.textContent));
    grab('[data-fstep="chooser"]');
    grab('[data-tile-steps] [data-fstep]');
    return bits.join(' \n ');
  });

  /* ==================================================================== K (1) */
  suite('K · (1) "Fix something" lands on the TOP of the chooser, nothing preselected, nothing focused');
  {
    const page = await newPage();
    await land(page, '/services#request');
    eq(await screenOf(page), 'chooser', 'the first screen is the chooser, not a filled form');
    const g = await page.evaluate(() => {
      const step = document.querySelector('[data-fstep="chooser"]');
      const head = document.querySelector('[data-chooser-heading]');
      const top = document.querySelector('.top');
      return {
        headTop: head ? Math.round(head.getBoundingClientRect().top) : null,
        headWords: head ? head.textContent.trim() : null,
        stepTop: step ? Math.round(step.getBoundingClientRect().top) : null,
        lid: top ? Math.round(top.getBoundingClientRect().height) : 0,
        focused: document.activeElement === document.body ? 'nothing' : document.activeElement.tagName,
        preselected: [...document.querySelectorAll('input[name="service"]')].filter((x) => x.checked).map((x) => x.value),
        litOnLanding: [...document.querySelectorAll('input[name="tiles"]')].filter((x) => x.checked).length,
        scrollW: document.documentElement.scrollWidth,
        scrollY: Math.round(window.scrollY),
      };
    });
    ok(g.headTop !== null && g.headTop >= 0 && g.headTop <= g.lid + 60,
      'the heading is on screen, just under the sticky header — no scrolling up to find it',
      `heading top ${g.headTop}px, header ${g.lid}px`);
    ok(g.scrollY > 0, 'the page really did land down at the request band', String(g.scrollY));
    eq(g.headWords, 'Tell us what’s wrong. We’ll tell you what it takes.', 'the heading is the one the ignite asks for');
    eq(g.focused, 'nothing', 'nothing autofocuses');
    eq(g.preselected.join(','), '', 'no category is preselected');
    eq(g.litOnLanding, 0, 'no tile is lit on landing');
    ok(g.scrollW <= 391, 'the page does not scroll sideways at 390', String(g.scrollW));
    R['1'] = g;
    await page.close();
  }

  /* ==================================================================== K (2) */
  suite('K · (2) one screen on a phone: tiles by symptom, multi-select, and one mapping file');
  {
    const page = await newPage();
    await land(page, '/services#request');
    const g = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-chooser-tiles] .ch-tap')];
      const head = document.querySelector('[data-chooser-heading]');
      return {
        count: tiles.length,
        headTop: head ? Math.round(head.getBoundingClientRect().top) : null,
        lastBottom: tiles.length ? Math.round(tiles[tiles.length - 1].getBoundingClientRect().bottom) : null,
        smallest: tiles.length ? Math.min(...tiles.map((t) => Math.round(t.getBoundingClientRect().height))) : 0,
        narrowest: tiles.length ? Math.min(...tiles.map((t) => Math.round(t.getBoundingClientRect().width))) : 0,
        boxes: tiles.map((t) => { const i = t.querySelector('input'); return i ? i.type : 'none'; }),
        mapping: !!(window.UMBRA_CHOOSER && window.UMBRA_CHOOSER.tiles && window.UMBRA_CHOOSER.checklist),
        mappingFiles: [...document.querySelectorAll('script[src]')].map((s) => s.src).filter((s) => /chooser-data/.test(s)).length,
      };
    });
    ok(g.count >= 6, 'there are tiles to choose from', String(g.count));
    ok(g.lastBottom !== null && g.lastBottom <= 844,
      'the heading and every last tile fit on one 390x844 screen',
      `last tile ends at ${g.lastBottom}px of 844`);
    ok(g.smallest >= 44 && g.narrowest >= 44, 'every tile is a 44pt target or bigger',
      `${g.narrowest} x ${g.smallest}`);
    eq(g.boxes.filter((b) => b !== 'checkbox').length, 0, 'every tile is a checkbox: more than one thing can be wrong at once');
    ok(g.mapping, 'the mapping is data the page can read');
    eq(g.mappingFiles, 1, 'and it lives in exactly ONE file');
    /* two lit at once, and both travel */
    await tap(page, 'input[name="tiles"][value="paint"]');
    await tap(page, 'input[name="tiles"][value="outside"]');
    await sleep(120);
    const lit = await page.$eval('input[type="hidden"][name="tiles"]', (e) => e.value).catch(() => '');
    ok(/paint/.test(lit) && /outside/.test(lit), 'two tiles lit at once both travel', lit);
    R['2'] = Object.assign(g, { two_lit: lit });
    await page.close();
  }

  /* ==================================================================== K (3) */
  suite("K · (3) 'While we're there': one-person jobs only, no licensed trade, every tap a line");
  {
    const page = await newPage();
    await land(page, '/services#request');
    const words = (await readable(page)).toLowerCase();
    const hits = namesAny(words, LICENSED);
    eq(hits.join(', '), '', 'no licensed trade is named anywhere a customer can read it');
    const never = namesAny(words, NEVER_READ);
    eq(never.join(', '), '', 'the old form’s words ("sections", "basketball") are nowhere a customer can read');
    const list = await page.$$eval('input[name="while_there"]', (b) => b.map((x) => x.value));
    ok(list.length >= 6, 'the checklist has lines to tap', String(list.length));
    eq(list.filter((v) => /smoke|detector/i.test(v)).join(','), '', 'the smoke-alarm line is dropped (amend A6)');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('input[name="while_there"]')].slice(0, 2);
      b.forEach((x) => { x.checked = true; x.dispatchEvent(new Event('change', { bubbles: true })); });
    });
    await sleep(120);
    const travelled = await page.$eval('input[type="hidden"][name="while_there"]', (e) => e.value).catch(() => '');
    eq(travelled.split('\n').filter(Boolean).length, 2, 'each tap became its own line in the request', JSON.stringify(travelled));
    R['3'] = { lines: list, travelled };
    await page.close();
  }

  /* ==================================================================== K (4) */
  suite('K · (4) a tile owns its questions: a paint job is never asked about holes');
  {
    const page = await newPage();
    await land(page, '/services#request');
    await tap(page, 'input[name="tiles"][value="paint"]');
    await sleep(120);
    const seen = [];
    for (let i = 0; i < 25 && (await screenOf(page)) !== 'send'; i++) {
      const s = await screenOf(page);
      seen.push(s);
      await fill(page, WHO);
      if (s === 'times') await tap(page, 'input[name="avail_flexible"]');
      await sleep(70);
      await next(page);
      if ((await screenOf(page)) === s) break;
    }
    seen.push(await screenOf(page));
    eq(seen.filter((s) => /^(ceiling|walls)-/.test(s)).join(','), '',
      'a paint job walks past every hole screen', seen.join(' → '));
    ok(seen.indexOf('tile-paint') > -1, 'and lands on the paint tile’s own screen instead', seen.join(' → '));
    ok(seen.indexOf('tile-hole') === -1, 'the hole tile’s screen is nowhere in it', seen.join(' → '));
    R['4'] = { walk: seen };
    await page.close();
  }

  /* ==================================================================== K (5) */
  suite('K · (5) his job, sent: paint only, five answers, and not one hole field on the record');
  {
    const before = relayPosts().length;
    const page = await newPage();
    await land(page, '/services#request');
    await tap(page, 'input[name="tiles"][value="paint"]');
    await sleep(120);
    const want = ['A ceiling', '1 room', 'An average room', 'Match what’s there', 'A repair spot that doesn’t match'];
    const picked = await page.evaluate((list) => {
      const out = [];
      for (const w of list) {
        const lab = [...document.querySelectorAll('[data-fstep="tile-paint"] .ch-tap')]
          .find((l) => l.textContent.trim().indexOf(w) === 0);
        if (!lab) { out.push('MISSING: ' + w); continue; }
        const box = lab.querySelector('input');
        box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
        out.push(box.name + '=' + box.value);
      }
      return out;
    }, want);
    eq(picked.filter((p) => p.indexOf('MISSING') === 0).join(' | '), '',
      'every answer the amend names is there to be tapped', picked.join(' | '));
    for (let i = 0; i < 25 && (await screenOf(page)) !== 'send'; i++) {
      const s = await screenOf(page);
      await fill(page, WHO);
      if (s === 'address') {
        await page.waitForSelector('[data-uaddr-yes]', { timeout: 12000 }).catch(() => null);
        await tap(page, '[data-uaddr-yes]');
      }
      if (s === 'times') await tap(page, 'input[name="avail_flexible"]');
      await sleep(70);
      await next(page);
      if ((await screenOf(page)) === s) break;
    }
    const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.click('[data-v2send]').catch(() => null);
    await nav;
    for (let i = 0; i < 60 && relayPosts().length === before; i++) await sleep(100);
    const cap = relayPosts().slice(before);
    if (!ok(cap.length === 1, 'the request was sent once', String(cap.length))) { await page.close(); }
    else {
      const parts = parseMultipart(cap[0].body, cap[0].headers['content-type']);
      const v = (n) => fieldValue(parts, n);
      const names = parts.map((p) => p.name);
      eq(v('service'), 'Drywall & Paint', 'the category the Worker reads is still filled in');
      eq(v('problem'), 'Just paint', 'and it says paint, not holes');
      eq(names.filter((n) => /^(ceiling|walls)_/.test(n)).join(','), '', 'not one hole field travelled');
      const answers = v('answers') || '';
      for (const w of want) ok(answers.indexOf(w) > -1 || names.some((n) => (v(n) || '') === w),
        `"${w}" is on the record`, answers.slice(0, 200));
      eq(v('what'), WHO.what, 'his sentence travelled word for word');
      eq(v('address_confirmed'), 'census', 'the address travelled confirmed, and says who confirmed it');
      ok((v('lat') || '').length > 0 && (v('lng') || '').length > 0, 'with the point on the map', v('lat') + ', ' + v('lng'));
      ok((v('started_at') || '').length > 0 && (v('sent_at') || '').length > 0, 'and how long it took to say it');
      R['5'] = { fields: names, answers: answers.split('\n') };
      await page.close();
    }
  }

  /* ==================================================================== K (6) */
  suite('K · (6) the ask in order, ONE Send, and it lives only on the review');
  {
    const page = await newPage();
    await land(page, '/services#request');
    await tap(page, 'input[name="tiles"][value="paint"]');
    await sleep(120);
    const order = [];
    let sendSeenEarly = 0;
    for (let i = 0; i < 25 && (await screenOf(page)) !== 'send'; i++) {
      const s = await screenOf(page);
      order.push(s);
      sendSeenEarly += await page.evaluate(() => [...document.querySelectorAll('[data-v2send]')].filter((b) => b.offsetParent !== null).length);
      await fill(page, WHO);
      if (s === 'address') {
        await page.waitForSelector('[data-uaddr-yes]', { timeout: 12000 }).catch(() => null);
        await tap(page, '[data-uaddr-yes]');
      }
      if (s === 'times') await tap(page, 'input[name="avail_flexible"]');
      await sleep(70);
      await next(page);
      if ((await screenOf(page)) === s) break;
    }
    order.push(await screenOf(page));
    const at = (k) => order.indexOf(k);
    ok(at('photos') > -1 && at('photos') < at('name'), 'the photos are asked for before the name', order.join(' → '));
    ok(at('name') < at('phone') && at('phone') < at('address'), 'then name, then phone, then the address', order.join(' → '));
    ok(at('times') > at('address'), 'and when we could come, last', order.join(' → '));
    eq(sendSeenEarly, 0, 'no Send button is visible on any screen before the review');
    const rev = await page.evaluate(() => ({
      sends: [...document.querySelectorAll('[data-v2send]')].filter((b) => b.offsetParent !== null).length,
      groups: [...document.querySelectorAll('.ch-rgroup')].map((g) => ({
        title: (g.querySelector('.ch-rtitle') || {}).textContent || '',
        edit: !!g.querySelector('.ch-redit'),
        lines: [...g.querySelectorAll('.ch-rlist li')].length,
      })),
      replyBy: (document.querySelector('.ch-replyby') || {}).textContent || '',
      sendWords: (document.querySelector('[data-v2send]') || {}).textContent || '',
    }));
    eq(rev.sends, 1, 'exactly ONE Send button, and it is on the review');
    ok(rev.sendWords.indexOf('2 hours') > -1, 'it says the promise on it', rev.sendWords);
    ok(rev.groups.length >= 5, 'the review lists what was chosen, in groups', JSON.stringify(rev.groups.map((g) => g.title)));
    eq(rev.groups.filter((g) => !g.edit).length, 0, 'every group has its own Edit tap');
    ok(/\d/.test(rev.replyBy), 'the review names the TIME we reply by', rev.replyBy);
    /* an Edit tap really goes back to that screen */
    const edited = await page.evaluate(() => {
      const b = document.querySelectorAll('.ch-redit')[0];
      if (!b) return false;
      b.click(); return true;
    });
    await sleep(150);
    ok(edited && (await screenOf(page)) !== 'send', 'and tapping Edit leaves the review for that screen',
      edited ? await screenOf(page) : 'there is no Edit to tap');
    R['6'] = { order, review: rev };
    await page.close();
  }

  /* ==================================================================== K (7) */
  suite('K · (7) the address: gibberish cannot pass, a real one is confirmed by a tap');
  {
    const cfgPath = path.join(REPO_DIR, 'site.config.js');
    const cfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
    let key;
    if (cfg === null) key = '(there is no site.config.js)';
    else {
      const m = cfg.match(/UMBRA_PLACES_KEY\s*=\s*['"]([^'"]*)['"]/);
      key = m ? m[1] : '(the file names no key)';
    }
    eq(key, '', 'site.config.js ships with an EMPTY key — only Drew fills it in');
    const page = await newPage();
    await land(page, '/services#request');
    await tap(page, 'input[name="tiles"][value="paint"]');
    await sleep(120);
    for (let i = 0; i < 25 && (await screenOf(page)) !== 'address'; i++) {
      await fill(page, { name: WHO.name, phone: WHO.phone, address: '', what: WHO.what });
      await sleep(60);
      const s = await screenOf(page);
      await next(page);
      if ((await screenOf(page)) === s) break;
    }
    eq(await screenOf(page), 'address', 'the walk reached the address screen');
    await page.evaluate(() => {
      const a = document.querySelector('[name="address"]');
      a.value = 'afdsjohgaeojuhfhioasd';
      a.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(700);                              /* the module waits before it speaks */
    await next(page);
    eq(await screenOf(page), 'address', '"afdsjohgaeojuhfhioasd" does not get past the address screen');
    const said = await page.evaluate(() => {
      const bits = [];
      document.querySelectorAll('[data-fstep="address"] [role="alert"], [data-fstep="address"] .uaddr')
        .forEach((e) => { if (!e.hidden && e.textContent.trim()) bits.push(e.textContent.trim()); });
      return bits.join(' | ');
    });
    ok(said.length > 0, 'and the screen says what is missing, in plain words', said);
    await page.evaluate((a) => {
      const e = document.querySelector('[name="address"]');
      e.value = a; e.dispatchEvent(new Event('input', { bubbles: true }));
    }, WHO.address);
    await page.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 12000 }).catch(() => null);
    const card = await page.evaluate(() => ({
      words: (document.querySelector('.uaddr') || {}).textContent || '',
      yes: !!document.querySelector('[data-uaddr-yes]'),
      no: !!document.querySelector('[data-uaddr-no]'),
      confirmedBefore: (document.querySelector('input[name="address_confirmed"]') || {}).value || '',
    }));
    ok(card.yes && card.no, 'a real address gets the card: "Yes, that’s it" and "No, let me fix it"');
    eq(card.confirmedBefore, '', 'and nothing is confirmed until the tap');
    await tap(page, '[data-uaddr-yes]');
    await sleep(200);
    const after = await page.$eval('input[name="address_confirmed"]', (e) => e.value).catch(() => '');
    eq(after, 'census', 'the tap confirms it, and the record says which map answered');
    ok(censusAsked.length > 0, 'the stand-in Census was reached by script tag, across origins', JSON.stringify(censusAsked.slice(0, 2)));
    R['7'] = Object.assign(card, { after, censusAsked: censusAsked.length });
    await page.close();
  }

  /* ==================================================================== K (8) */
  suite('K · (8) español mirrors all of it');
  {
    const page = await newPage();
    await land(page, '/es/servicios#pedir');
    eq(await screenOf(page), 'chooser', 'la primera pantalla es el selector');
    const g = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-chooser-tiles] .ch-tap')];
      const head = document.querySelector('[data-chooser-heading]');
      return {
        head: head ? head.textContent.trim() : null,
        headTop: head ? Math.round(head.getBoundingClientRect().top) : null,
        count: tiles.length,
        lastBottom: tiles.length ? Math.round(tiles[tiles.length - 1].getBoundingClientRect().bottom) : null,
        preselected: [...document.querySelectorAll('input[name="service"]')].filter((x) => x.checked).length,
        focused: document.activeElement === document.body ? 'nothing' : document.activeElement.tagName,
        scrollW: document.documentElement.scrollWidth,
      };
    });
    eq(g.head, 'Díganos qué está mal. Nosotros le decimos qué necesita.', 'con el mismo encabezado');
    eq(g.focused, 'nothing', 'nada toma el foco');
    eq(g.preselected, 0, 'ninguna categoría viene preseleccionada');
    ok(g.lastBottom !== null && g.lastBottom <= 844, 'y todo cabe en una sola pantalla de 390x844',
      `${g.lastBottom} de 844`);
    ok(g.scrollW <= 391, 'sin barrido lateral', String(g.scrollW));
    const words = (await readable(page)).toLowerCase();
    const bad = ['electricista', 'plomero', 'plomería', 'aire acondicionado', 'termostato', 'cámara', 'cerradura', 'detector de humo'];
    eq(namesAny(words, bad).join(', '), '', 'ningún oficio con licencia aparece en el selector');
    await tap(page, 'input[name="tiles"][value="paint"]');
    await sleep(120);
    await next(page);
    eq(await screenOf(page), 'tile-paint', 'y la opción de pintura lleva a sus propias preguntas');
    R['8'] = g;
    await page.close();
  }

  /* ==================================================================== K (9) */
  suite('K · (9) the pictures one man cannot stand in front of are gone from every page');
  {
    const pages = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        /* a dot-directory is scratch, never a page a customer can reach */
        if (e.name.charAt(0) === '.' || e.name === 'node_modules' || e.name === 'worker' || e.name === 'tools') continue;
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f); else if (e.name.endsWith('.html')) pages.push(f);
      }
    };
    walk(REPO_DIR);
    ok(pages.length > 0, 'there are pages to read', String(pages.length));
    const hits = [];
    for (const f of pages) {
      const s = fs.readFileSync(f, 'utf8');
      for (const pic of REMOVED_PICTURES) {
        if (new RegExp('img/' + pic + '[-.]').test(s)) hits.push(path.relative(REPO_DIR, f) + ' → ' + pic);
      }
    }
    eq(hits.join(' | '), '', 'no page names a picture this round removed');
    const captions = fs.readFileSync(path.join(REPO_DIR, 'services.html'), 'utf8');
    for (const gone of ['A deck from the frame up', "A deck you'll actually use", 'A new fence line', 'A driveway pressure-washed']) {
      ok(captions.indexOf(gone) === -1, `the card "${gone}" is off the page`);
    }
    ok(/deck boards and rails/.test(captions) && /fence repairs/.test(captions),
      'and the words say deck boards and rails, fence repairs');
    ok(/pressure.?wash/i.test(captions), 'pressure washing stays a service line, without a picture');
    R['9'] = { pages: pages.length, hits };
  }

  await new Promise((r) => census.close(r));
  return R;
}
