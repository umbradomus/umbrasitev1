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
     (10) the forbidden words  — amend A1: nothing a customer reads says them
   SITE-FIX-01.1 adds six more, on D-CEO-61 and his words of 09-28 and 09-27:
     (11) the sentence second   — ignite 01.1 (2): photos, one sentence, name, phone, address, time
     (12) the paint set         — ignite 01.1 (4) squared with AMEND A6.2, exactly
     (13) every path            — ignite 01.1 (3): nothing sends until Yes, the no-tile pages too
     (14) the reply-by time     — ignite 01.1 (5): one hours constant, both screens, both languages
     (15) the thank-you page    — ignite 01.1 (6): one next action, the small line under it
     (16) the footer            — ignite 01.1 (7): what Umbra is, on every page

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
  suite('K · (5) his job, sent: paint only, the amend’s six answers, and not one hole field on the record');
  {
    const before = relayPosts().length;
    const page = await newPage();
    await land(page, '/services#request');
    await tap(page, 'input[name="tiles"][value="paint"]');
    await sleep(120);
    /* SITE-FIX-01.1 · A4b's test job, squared with the paint set of AMEND A6.2 as the
       ignite cuts it: what gets paint · all of it or a spot · how high · the surface ·
       the colour · what's wrong. "How many rooms" is not among them — it is asked only
       when the walls or the whole room get paint, and his job is a ceiling — and
       "roughly how big" is gone from the set altogether. */
    const want = ['A ceiling', 'The whole thing', 'Normal', 'Textured', 'Match what’s there', 'A repair spot that doesn’t match'];
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

    /* A2, the whole of it: nothing SENDS until the tap. A plausible address is not
       a confirmed one, and on a request built on the chooser the screen holds. */
    const held = await newPage();
    await land(held, '/services#request');
    await tap(held, 'input[name="tiles"][value="paint"]');
    await sleep(120);
    for (let i = 0; i < 25 && (await screenOf(held)) !== 'address'; i++) {
      const s2 = await screenOf(held);
      await fill(held, { name: WHO.name, phone: WHO.phone, address: '', what: WHO.what });
      await sleep(60);
      await next(held);
      if ((await screenOf(held)) === s2) break;
    }
    await held.evaluate((a) => {
      const e = document.querySelector('[name="address"]');
      e.value = a; e.dispatchEvent(new Event('input', { bubbles: true }));
    }, WHO.address);
    await held.waitForSelector('[data-uaddr-yes]', { visible: true, timeout: 12000 }).catch(() => null);
    await next(held);
    eq(await screenOf(held), 'address', 'a plausible address nobody confirmed does not get past the screen either');
    const stillWants = await held.evaluate(() => {
      const bits = [];
      document.querySelectorAll('[data-fstep="address"] [role="alert"]')
        .forEach((e) => { if (!e.hidden && e.textContent.trim()) bits.push(e.textContent.trim()); });
      return bits.join(' | ');
    });
    ok(/confirm/i.test(stillWants), 'and it asks, in plain words, for the tap', stillWants);
    await tap(held, '[data-uaddr-yes]');
    await sleep(200);
    await next(held);
    ok((await screenOf(held)) !== 'address', 'the tap lets it through', await screenOf(held));
    await held.close();
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

  /* =================================================================== K (10) */
  suite('K · (10) the words the amend forbids are on no screen a customer can reach');
  {
    /* A1: "sections" and "basketball" appear nowhere a customer can read. Every
       question on the form is read here, shown or hidden, because a hidden step is
       one tap from being shown. What the answer POSTS is not read: that is Drew's
       record and the Worker's field, and renaming it is forbidden this round. */
    for (const [where, url] of [['English', '/services#request'], ['espanol', '/es/servicios#pedir']]) {
      const page = await newPage();
      await land(page, url);
      const words = await page.evaluate(() => {
        const bits = [];
        document.querySelectorAll('form.req [data-fstep] .v2q, form.req [data-fstep] label span, form.req [data-fstep] p')
          .forEach((e) => { const t = e.textContent.trim(); if (t) bits.push(t); });
        return bits.join(' | ');
      });
      eq(namesAny(words.toLowerCase(), NEVER_READ).join(', '), '',
        `${where}: no question on the form says a word the amend forbids`);
      eq(namesAny(words.toLowerCase(), LICENSED).join(', '), '',
        `${where}: and no licensed trade is named on one either`);
      R['10'] = Object.assign(R['10'] || {}, { [where]: words.length });
      await page.close();
    }
  }

  /* =================================================================== K (11) */
  suite('K · (11) the sentence sits second: photos → one sentence → name → phone → address → best time');
  {
    for (const [where, url] of [['English', '/services#request'], ['espanol', '/es/servicios#pedir']]) {
      const page = await newPage();
      await land(page, url);
      await tap(page, 'input[name="tiles"][value="paint"]');
      await sleep(120);
      const order = [];
      for (let i = 0; i < 30 && (await screenOf(page)) !== 'send'; i++) {
        const s = await screenOf(page);
        order.push(s);
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
      const ask = order.filter((k) => ['photos', 'notes', 'name', 'phone', 'address', 'times'].indexOf(k) > -1);
      eq(ask.join(' → '), 'photos → notes → name → phone → address → times',
        `${where}: the ask reads photos, one sentence, name, phone, the address, best time`, order.join(' → '));
      eq(order[order.indexOf('photos') + 1], 'notes',
        `${where}: and the sentence is the very next screen after the photos — second`, order.join(' → '));
      R['11'] = Object.assign(R['11'] || {}, { [where]: order });
      await page.close();
    }
  }

  /* =================================================================== K (12) */
  suite('K · (12) the paint set is AMEND A6.2’s, exactly');
  {
    const page = await newPage();
    await land(page, '/services#request');
    await tap(page, 'input[name="tiles"][value="paint"]');
    await sleep(120);
    for (let i = 0; i < 20 && (await screenOf(page)) !== 'tile-paint'; i++) { await next(page); }
    eq(await screenOf(page), 'tile-paint', 'the paint tile’s own screen is reached');
    const readSet = () => page.evaluate(() => {
      const step = document.querySelector('[data-fstep="tile-paint"]');
      return [...step.querySelectorAll('.ch-qblock')].filter((b) => !b.hidden).map((b) => ({
        q: (b.querySelector('.v2q') || {}).textContent.trim(),
        opts: [...b.querySelectorAll('.ch-tap')].map((l) => l.textContent.trim()),
      }));
    });
    const set = await readSet();
    const WANT = ['What gets paint?', 'All of it, or just a spot?', 'How high?', 'The surface?',
      'The colour?', 'What’s wrong with it now?'];
    eq(set.map((x) => x.q).join(' · '), WANT.join(' · '),
      'the six questions A6.2 names, in its order, and nothing else', JSON.stringify(set.map((x) => x.q)));
    eq(set.filter((x) => x.opts.indexOf('Not sure') === -1).map((x) => x.q).join(', '), '',
      '"Not sure" is on every one of them');
    eq(set.filter((x) => /rough/i.test(x.q)).length, 0, 'and "roughly how big" is nowhere in the set');
    const whatGets = set[0].opts.join(' · ');
    eq(whatGets, 'A ceiling · The walls · The whole room, ceiling and walls · Trim and doors · Outside · Not sure',
      'what gets paint reads in his words', whatGets);
    /* "how many rooms" ONLY when the walls or the whole room */
    const tapOpt = (q, opt) => page.evaluate((qq, oo) => {
      const step = document.querySelector('[data-fstep="tile-paint"]');
      const block = [...step.querySelectorAll('.ch-qblock')].find((b) => (b.querySelector('.v2q') || {}).textContent.trim() === qq);
      if (!block) return false;
      const lab = [...block.querySelectorAll('.ch-tap')].find((l) => l.textContent.trim().indexOf(oo) === 0);
      if (!lab) return false;
      const box = lab.querySelector('input');
      box.checked = !box.checked;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, q, opt);
    ok(await tapOpt('What gets paint?', 'A ceiling'), 'a ceiling can be tapped');
    await sleep(120);
    eq((await readSet()).filter((x) => /rooms/i.test(x.q)).length, 0,
      'a ceiling is not asked how many rooms');
    ok(await tapOpt('What gets paint?', 'The walls'), 'the walls can be tapped too');
    await sleep(150);
    const withWalls = await readSet();
    const rooms = withWalls.find((x) => /rooms/i.test(x.q));
    ok(rooms, 'the walls ARE asked how many rooms', JSON.stringify(withWalls.map((x) => x.q)));
    ok(rooms && rooms.opts.indexOf('Not sure') > -1, 'with "Not sure" on it as well');
    /* the review reads the set back in those words */
    ok(await tapOpt('What gets paint?', 'The walls'), 'the walls are untapped again');
    await sleep(120);
    for (const [q, o] of [['All of it, or just a spot?', 'The whole thing'], ['How high?', 'Normal'],
      ['The surface?', 'Textured'], ['The colour?', 'Match what’s there'],
      ['What’s wrong with it now?', 'A repair spot that doesn’t match']]) {
      ok(await tapOpt(q, o), `"${o}" can be tapped under "${q}"`);
    }
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
    const said = await page.evaluate(() => {
      const g = [...document.querySelectorAll('.ch-rgroup')][0];
      return g ? [...g.querySelectorAll('.ch-rlist li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()).join(' | ') : '';
    });
    for (const w of ['A ceiling', 'The whole thing', 'Normal', 'Textured', 'Match what’s there', 'A repair spot that doesn’t match']) {
      ok(said.indexOf(w) > -1, `the review reads "${w}" back in those words`, said.slice(0, 300));
    }
    ok(said.indexOf('rooms') === -1, 'and says nothing about how many rooms, because a ceiling is not rooms', said.slice(0, 300));
    R['12'] = { set: set.map((x) => x.q), review: said };
    await page.close();
  }

  /* =================================================================== K (13) */
  suite('K · (13) nothing sends until "Yes, that’s it" — the old no-tile pages included');
  {
    for (const [where, route] of [['contact', '/contact'], ['es/index', '/es']]) {
      const before = relayPosts().length;
      const page = await newPage();
      await page.goto(SITE + route, { waitUntil: 'load' });
      await page.evaluate(() => {
        const f = document.querySelector('form.req');
        const set = (sel, v) => { const e = f.querySelector(sel); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
        set('[name="name"]', 'Chooser Cleo');
        set('[name="phone"]', '956 555 0177');
        set('[name="address"]', '1200 E Adams St, Brownsville, TX 78520');
        set('textarea[name="what"]', 'the patch on the ceiling is a different color');
        set('textarea[name="message"]', 'the patch on the ceiling is a different color');
      });
      await page.waitForSelector('form.req [data-uaddr-card]', { timeout: 12000 }).catch(() => null);
      const card = await page.evaluate(() => ({
        yes: !!document.querySelector('form.req [data-uaddr-yes]'),
        confirmed: (document.querySelector('form.req input[name="address_confirmed"]') || {}).value || '',
      }));
      ok(card.yes, `${where}: a plausible address gets the same card here too`);
      eq(card.confirmed, '', `${where}: and nothing is confirmed until the tap`);
      await page.evaluate(() => { document.querySelector('form.req button[type="submit"]').click(); });
      await sleep(900);
      eq(relayPosts().length - before, 0, `${where}: a plausible address nobody confirmed CANNOT be sent`);
      const said = await page.evaluate(() => {
        const bits = [];
        document.querySelectorAll('form.req .uaddr, form.req .uaddr-need, form.req [data-uaddr-need]')
          .forEach((e) => { if (!e.hidden && e.textContent.trim()) bits.push(e.textContent.replace(/\s+/g, ' ').trim()); });
        return bits.join(' | ');
      });
      ok(said.length > 0, `${where}: and the page says so, in plain words`, said);
      if (!card.yes) { await page.close(); continue; }
      const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
      await page.evaluate(() => {
        const y = document.querySelector('form.req [data-uaddr-yes]');
        if (y) y.click();
        document.querySelector('form.req button[type="submit"]').click();
      });
      await nav;
      for (let i = 0; i < 60 && relayPosts().length === before; i++) await sleep(100);
      const cap = relayPosts().slice(before);
      if (!ok(cap.length === 1, `${where}: the tap lets it through, once`, String(cap.length))) { await page.close(); continue; }
      const parts = parseMultipart(cap[0].body, cap[0].headers['content-type']);
      const v = (n) => fieldValue(parts, n);
      eq(v('address_confirmed'), 'census', `${where}: and the record says which map answered`);
      eq(v('lang'), where === 'contact' ? 'en' : 'es', `${where}: the language travels with it`);
      for (const clock of ['started_at', 'sent_at']) {
        ok(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v(clock) || ''), `${where}: ${clock} travels with it`, v(clock));
      }
      R['13'] = Object.assign(R['13'] || {}, { [where]: { confirmed: v('address_confirmed'), lang: v('lang'), started_at: v('started_at'), sent_at: v('sent_at') } });
      await page.close();
    }
  }

  /* =================================================================== K (14) */
  suite('K · (14) the reply-by time, on the review and on the sent screen, from ONE hours constant');
  {
    /* A6.7 as the ignite cuts it: Mon-Sun 7 AM - 9 PM, the review's own line. The hours
       live in /assets/umbra-sent.js and nowhere else; both screens ask it the same way. */
    const sent = fs.readFileSync(path.join(REPO_DIR, 'assets', 'umbra-sent.js'), 'utf8');
    const opens = sent.match(/OPEN_H\s*=\s*(\d+)/), closes = sent.match(/CLOSE_H\s*=\s*(\d+)/);
    eq(opens && opens[1], '7', 'the one hours constant opens at 7 AM');
    eq(closes && closes[1], '21', 'and closes at 9 PM, seven days a week');
    eq((sent.match(/OPEN_H\s*=/g) || []).length, 1, 'and it is written down exactly once');
    const chooser = fs.readFileSync(path.join(REPO_DIR, 'assets', 'umbra-chooser.js'), 'utf8');
    eq(/OPEN_H|CLOSE_H|\b21\s*,\s*0\b/.test(chooser), false, 'the chooser keeps no hours of its own — it asks that one');

    for (const [where, url, shape] of [
      ['English', '/services#request', /^We’ll reply by \d{1,2}:\d{2} (AM|PM)( tomorrow)?$/],
      ['espanol', '/es/servicios#pedir', /^Le contestamos antes de (la|las) \d{1,2}:\d{2} (a\.m\.|p\.m\.)( de mañana)?$/],
    ]) {
      const page = await newPage();
      await land(page, url);
      await tap(page, 'input[name="tiles"][value="paint"]');
      await sleep(120);
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
      const line = await page.evaluate(() => {
        const e = document.querySelector('[data-reply-by]');
        return e ? e.textContent.replace(/\s+/g, ' ').trim() : '(no line)';
      });
      ok(shape.test(line), `${where}: the review says the reply-by TIME, beside the promise`, line);
      eq(/\.\./.test(line), false, `${where}: and says it without a doubled full stop`, line);
      const fromConstant = await page.evaluate(() => {
        const d = window.UmbraSent.due(Date.now());
        return d.at;
      });
      ok(line.indexOf(fromConstant) > -1, `${where}: and the time on it is the one the hours constant gives`,
        `${line}  /  ${fromConstant}`);
      R['14'] = Object.assign(R['14'] || {}, { [where]: { review: line, due: fromConstant } });
      await page.close();
    }
    /* the SENT screen names the same time, from the same constant, in both languages */
    for (const [where, route] of [['English', '/request-received'], ['espanol', '/es/recibido']]) {
      const page = await newPage();
      await page.goto(SITE + route, { waitUntil: 'load' });
      const r = await page.evaluate(() => ({
        by: (document.getElementById('byline') || {}).textContent.replace(/\s+/g, ' ').trim(),
        due: window.UmbraSent ? window.UmbraSent.due(Date.now()).at : null,
      }));
      ok(r.due && r.by.indexOf(r.due) > -1, `${where}: the sent screen names the reply-by time from the same constant`,
        `${r.by}  /  ${r.due}`);
      R['14'] = Object.assign(R['14'] || {}, { ['sent-' + where]: r });
      await page.close();
    }
  }

  /* =================================================================== K (15) */
  suite('K · (15) the thank-you page: ONE next action, and the no-email line small under it');
  {
    for (const [where, route] of [['English', '/request-received'], ['espanol', '/es/recibido']]) {
      const page = await newPage();
      await page.goto(SITE + route, { waitUntil: 'load' });
      const r = await page.evaluate(() => {
        const main = document.querySelector('main');
        const copy = document.getElementById('sent-copy');
        const note = document.getElementById('jobnote');
        return {
          buttons: [...main.querySelectorAll('a.btn, button.btn')].map((b) => (b.id || '') + ':' + b.textContent.trim()),
          copyExists: !!copy,
          copyInBox: !!(copy && copy.closest('.note, .sent, .card')),
          copyAfterAction: !!(copy && note && (note.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING)),
          copySmall: !!(copy && copy.classList.contains('fine')),
        };
      });
      eq(r.buttons.length, 1, `${where}: exactly one next action on the page`, JSON.stringify(r.buttons));
      ok(/joblink/.test(r.buttons[0] || ''), `${where}: and it is "Save my status link"`, r.buttons[0]);
      ok(r.copyExists, `${where}: the no-email line is still on the page`);
      eq(r.copyInBox, false, `${where}: it is not in a box any more`);
      ok(r.copyAfterAction, `${where}: it sits UNDER the one next action`);
      ok(r.copySmall, `${where}: and it is small`);
      R['15'] = Object.assign(R['15'] || {}, { [where]: r });
      await page.close();
    }
  }

  /* =================================================================== K (16) */
  suite('K · (16) the footer says what Umbra is, on every page, in both languages');
  {
    /* His words 09-27: "so umbra is a real estate company were just starting out doing
       services right now." It goes live only when he has seen it; this is a branch. */
    const EN = 'Umbra Domus LLC — real estate development, acquisition and home repair.';
    const ES = 'Umbra Domus LLC — desarrollo inmobiliario, adquisiciones y reparación del hogar.';
    const pages = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.charAt(0) === '.' || e.name === 'node_modules' || e.name === 'worker' || e.name === 'tools') continue;
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f); else if (e.name.endsWith('.html')) pages.push(f);
      }
    };
    walk(REPO_DIR);
    const missing = [];
    for (const f of pages) {
      const rel = path.relative(REPO_DIR, f).replace(/\\/g, '/');
      const src = fs.readFileSync(f, 'utf8');
      if (!/<footer/.test(src)) continue;
      const want = /^es\//.test(rel) ? ES : EN;
      if (src.indexOf(want) === -1) missing.push(rel);
    }
    eq(missing.join(' | '), '', 'every page with a footer says it, in its own language', missing.join(' | '));
    /* and a customer can actually read it on the page */
    for (const [where, route, want] of [['English', '/services', EN], ['espanol', '/es/servicios', ES]]) {
      const page = await newPage();
      await page.goto(SITE + route, { waitUntil: 'load' });
      const seen = await page.evaluate(() => {
        const f = document.querySelector('footer');
        return f ? f.innerText.replace(/\s+/g, ' ').trim() : '';
      });
      ok(seen.indexOf(want) > -1, `${where}: and it is on the screen, not only in the source`, seen.slice(0, 220));
      await page.close();
    }
    R['16'] = { pages: pages.length, missing };
  }

  await new Promise((r) => census.close(r));
  return R;
}
