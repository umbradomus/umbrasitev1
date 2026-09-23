/* ============================================================================
   G · FORM-WINDOWS-01 — "When could we come?" and the text box.

   The eleven readings of the ignite, each with its actual value, written to
   .tmp/windows-readings.json for the round's close. The browser's clock is set
   by test (a Date shim installed before any page script) and the Worker's by
   the x-umbra-test-now header, which the page's own POST to /intake carries by
   request interception. A second `wrangler dev` with ALLOW_SUNDAY="true" runs on
   4776 for reading (5), with its own site copy on 4777.

   Pictures, when FW_PICTURES_DIR is set: <dir>/390/<n>.png and <dir>/1280/<n>.png.
   Every name in every fixture is invented; no real customer is anywhere here.
   ========================================================================== */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseMultipart, fieldValue } from './lib/multipart.mjs';
import { staticServer, close } from './lib/servers.mjs';
import { SMS_WORDING } from '../src/windows.js';

const PORT_SUNDAY_WORKER = 4776;
const PORT_SUNDAY_SITE = 4777;
const PORT_SUNDAY_INSPECTOR = 4778;

/* Wed 23 Sep 2026, 10:00 AM Central (CDT = UTC-5) */
const T = '2026-09-23T15:00:00.000Z';
const plus = (iso, min) => new Date(Date.parse(iso) + min * 60000).toISOString();
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

export async function suiteWindows(ctx) {
  const { browser, W, stub, relay, ADMIN_KEY, suite, ok, eq, json, sleep, PORT, TMP, WORKER_DIR, flipConstant, copyTree } = ctx;
  const R = {};
  const SITE = `http://127.0.0.1:${PORT.siteWorker}`;
  const PICS = process.env.FW_PICTURES_DIR || '';
  const relayPosts = () => relay.captured.filter((c) => c.method === 'POST');
  const PO = () => stub.captured
    .filter((c) => c.method === 'POST' && c.url === '/pushover/1/messages.json')
    .map((c) => Object.assign(c, { p: new URLSearchParams(c.body.toString('utf8')) }));
  const TG = () => stub.captured
    .filter((c) => c.method === 'POST' && /^\/telegram\/bot[^/]+\/sendMessage$/.test(c.url))
    .map((c) => Object.assign(c, { j: JSON.parse(c.body.toString('utf8')) }));
  const aboutPO = (id) => PO().filter((c) => (c.p.get('title') + '\n' + c.p.get('message')).includes(id));
  const aboutTG = (id) => TG().filter((c) => c.j.text.includes(id));
  const rowOf = async (base, id) => (await json(`${base}/api/jobs?k=${ADMIN_KEY}`)).body.jobs.find((j) => j.id === id);
  const rowsNamed = async (base, name) => (await json(`${base}/api/jobs?k=${ADMIN_KEY}`)).body.jobs.filter((j) => j.name === name);

  /* ------------------------------------------------------------ page helpers */
  async function newPage({ now = T, width = 390, tz = null } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: width <= 420 ? 844 : 900 });
    if (tz) await page.emulateTimezone(tz);
    const clock = { now };
    await page.evaluateOnNewDocument((fixed) => {
      const RD = Date;
      const off = fixed - RD.now();
      function FD(...a) {
        if (!(this instanceof FD)) return new RD(RD.now() + off).toString();
        return a.length ? new RD(...a) : new RD(RD.now() + off);
      }
      FD.prototype = RD.prototype;
      FD.now = () => RD.now() + off;
      FD.UTC = RD.UTC;
      FD.parse = RD.parse;
      globalThis.Date = FD;
    }, Date.parse(now));
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/intake$/.test(r.url())) {
        r.continue({ headers: { ...r.headers(), 'x-umbra-test-now': clock.now } });
      } else r.continue();
    });
    page.on('dialog', async (d) => { await d.dismiss(); });
    page.clock = clock;
    return page;
  }

  /** Open a v2 form page, fill the contact fields with invented words, and walk Next to `target`. */
  async function openAt(page, url, target, who) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-intake2][data-screen]');
    await page.evaluate((w) => {
      const f = document.querySelector('form.req');
      const set = (sel, v) => { const el = f.querySelector(sel); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('[name="name"]', w.name);
      set('[name="phone"]', w.phone);
      set('[name="address"]', w.address);
      set('textarea[name="what"]', w.what);
      const tick = (n, v) => { const el = f.querySelector(`input[name="${n}"][value="${v}"]`); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); };
      tick('problem', 'Just paint');
      tick('problem_area', 'Walls');
    }, who);
    for (let i = 0; i < 30; i++) {
      const s = await page.$eval('[data-intake2]', (e) => e.getAttribute('data-screen'));
      if (s === target) return true;
      await page.click('[data-v2next]');
      await sleep(40);
    }
    return false;
  }
  async function pick(page, date, block) {
    await page.click(`.wday[data-date="${date}"]`);
    await page.waitForSelector(`.wblock[data-block="${block}"]`, { visible: true });
    await page.click(`.wblock[data-block="${block}"]`);
    await page.waitForFunction((d) => !document.querySelector('[data-wblocks]') || document.querySelector('[data-wblocks]').hidden, { timeout: 3000 }, date).catch(() => null);
  }
  const screenOf = (page) => page.$eval('[data-intake2]', (e) => e.getAttribute('data-screen'));
  const chipDates = (page) => page.$$eval('.wday', (b) => b.map((x) => x.getAttribute('data-date')));
  const chipTexts = (page) => page.$$eval('.wday', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  async function blockLabels(page, date) {
    await page.click(`.wday[data-date="${date}"]`);
    await page.waitForSelector('.wblock', { visible: true });
    const labels = await page.$$eval('.wblock', (b) => b.map((x) => x.textContent.trim()));
    await page.click(`.wday[data-date="${date}"]`);   /* close it again */
    return labels;
  }
  async function send(page) {
    for (let i = 0; i < 5 && (await screenOf(page)) !== 'send'; i++) { await page.click('[data-v2next]'); await sleep(40); }
    const before = relayPosts().length;
    const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.click('[data-v2send]');
    await nav;
    await sleep(200);
    const u = new URL(page.url());
    for (let i = 0; i < 40 && relayPosts().length === before; i++) await sleep(100);
    const copy = relayPosts().slice(before)[0] || null;
    return { landed: page.url(), id: u.searchParams.get('id'), token: u.searchParams.get('t'), copy: copy ? parseMultipart(copy.body, copy.headers['content-type']) : null };
  }
  async function shoot(page, name) {
    if (!PICS) return null;
    const vw = page.viewport().width;
    const files = [];
    /* the site's sticky header would sit over the top of a tall element shot: unstick it for the picture only */
    await page.evaluate(() => { const h = document.querySelector('header.top'); if (h) h.style.position = 'static'; });
    for (const width of [390, 1280]) {
      await page.setViewport({ width, height: width <= 420 ? 844 : 900 });
      await sleep(120);
      const dir = path.join(PICS, String(width));
      fs.mkdirSync(dir, { recursive: true });
      const el = await page.$('form.req');
      const file = path.join(dir, name);
      await el.screenshot({ path: file });
      files.push(file);
    }
    await page.evaluate(() => { const h = document.querySelector('header.top'); if (h) h.style.position = ''; });
    await page.setViewport({ width: vw, height: vw <= 420 ? 844 : 900 });
    await sleep(80);
    return files;
  }
  async function directPost(base, iso, f) {
    const fd = new FormData();
    fd.set('_subject', 'Service request from umbradomus.com');
    fd.set('_next', 'https://www.umbradomus.com/request-received');
    fd.set('service', 'Drywall & Paint');
    for (const [k, v] of Object.entries(f)) {
      if (Array.isArray(v)) for (const x of v) fd.append(k, x); else fd.set(k, v);
    }
    const r = await fetch(`${base}/intake`, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
    const loc = r.headers.get('location');
    const u = loc ? new URL(loc) : null;
    return { status: r.status, id: u ? u.searchParams.get('id') : null, token: u ? u.searchParams.get('t') : null };
  }
  const who = (n) => ({
    name: `Fixture ${n}`, phone: '(956) 555-01' + String(10 + (n.length % 80)).padStart(2, '0'),
    address: `${100 + n.length} Invented Lane, Brownsville`, what: `${n}: a scuffed wall in the invented hallway, just paint.`,
  });

  const EXPECT_DAYS = ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07'];

  /* ============================================================== (2) */
  suite('G · (2) the new screen, English and Spanish');
  {
    R['2'] = {};
    for (const [lang, url, title, blocks] of [
      ['en', SITE + '/services#request', 'When could we come?', ['Morning 8–11', 'Midday 11–2', 'Afternoon 2–5', 'Evening 5–8']],
      ['es', SITE + '/es/servicios#request', '¿Cuándo podemos ir?', ['Mañana 8–11', 'Mediodía 11–2', 'Tarde 2–5', 'Noche 5–8']],
    ]) {
      const page = await newPage();
      const reached = await openAt(page, url, 'times', who('Screen ' + lang));
      ok(reached, `${lang}: Next walks to the time screen`);
      const order = await page.evaluate(() => {
        const s = [...document.querySelectorAll('[data-fstep]')].map((x) => x.getAttribute('data-fstep'));
        return s.slice(s.indexOf('notes'));
      });
      eq(order.join(','), 'notes,times,send', `${lang}: the time screen sits just before Send`);
      const q = await page.$eval('[data-fstep="times"] .v2q', (e) => e.textContent.trim());
      eq(q, title, `${lang}: titled "${title}"`);
      await page.waitForSelector('.wday');
      const dates = await chipDates(page);
      const texts = await chipTexts(page);
      eq(dates.length, 12, `${lang}: 12 day chips`);
      eq(dates.join(','), EXPECT_DAYS.join(','), `${lang}: Thu 9/24 … Wed 10/7, from TOMORROW (Central)`);
      ok(dates.every((d) => new Date(d + 'T12:00:00Z').getUTCDay() !== 0), `${lang}: no Sunday among them`);
      const bl = await blockLabels(page, '2026-09-29');
      eq(bl.join(' | '), blocks.join(' | '), `${lang}: tapping a day offers the four blocks`);
      const flex = await page.$eval('input[name="avail_flexible"]', (e) => ({ checked: e.checked, label: e.closest('label').textContent.trim() }));
      eq(flex.checked, false, `${lang}: the flexible toggle is there, off`);
      await shoot(page, lang === 'en' ? '1-empty.png' : '5-spanish-empty.png');
      /* the text box sits on the phone screen ("the number above") */
      const consent = await page.$eval('input[name="sms_consent"]', (e) => ({
        checked: e.checked, required: e.required, screen: e.closest('[data-fstep]').getAttribute('data-fstep'),
        words: e.closest('label').querySelector('[data-sms-wording]').textContent.replace(/\s+/g, ' ').trim(),
        privacy: e.closest('.wconsent').querySelector('a.wprivacy').getAttribute('href'),
      }));
      eq(consent.checked, false, `${lang}: the text box is UNCHECKED`);
      eq(consent.required, false, `${lang}: and not required`);
      eq(consent.screen, 'phone', `${lang}: on the phone screen, under the number it names`);
      eq(consent.words, SMS_WORDING[lang], `${lang}: its words are the Worker's sms-v1 wording exactly`);
      ok(consent.privacy === '#privacy' && await page.$('#privacy'), `${lang}: with the privacy link beside it`, consent.privacy);
      const promo = await page.$$eval('input[type="checkbox"]', (b) => b.map((x) => x.name).filter((n) => /promo|market|offer|news/i.test(n)));
      eq(promo.length, 0, `${lang}: no promotional box anywhere on the form`);
      R['2'][lang] = { title: q, chips: dates.length, first: texts[0], last: texts[texts.length - 1], chip_texts: texts, blocks: bl, flexible_checked: flex.checked, flexible_label: flex.label, consent_checked: consent.checked, consent_required: consent.required, consent_screen: consent.screen, consent_words: consent.words };
      await page.close();
    }
  }

  /* ============================================================== (3) (8 checked) */
  suite('G · (3) three picks submit; record, email copy, /api/jobs');
  let threeId = null;
  {
    const page = await newPage();
    const w = who('Three Picks Tessaly');
    await openAt(page, SITE + '/services#request', 'phone', w);
    /* the text box, ticked by a real click */
    await page.click('.wconsent label.v2opt');
    ok(await page.$eval('input[name="sms_consent"]', (e) => e.checked), 'the text box ticks on a click');
    await shoot(page, '4-consent.png');
    const shownWords = await page.$eval('[data-sms-wording]', (e) => e.textContent.replace(/\s+/g, ' ').trim());
    for (let i = 0; i < 5 && (await screenOf(page)) !== 'times'; i++) { await page.click('[data-v2next]'); await sleep(40); }
    await page.waitForSelector('.wday');
    await pick(page, '2026-09-29', '08-11');
    await pick(page, '2026-09-25', '17-20');
    await pick(page, '2026-10-02', '11-14');
    const chips = await page.$$eval('.wpick', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    eq(chips.length, 3, 'three removable chips');
    eq(chips[0], '1Tue 9/29 · Morning 8–11✕', 'the first chip reads Tue 9/29 · Morning 8–11');
    const full = await page.evaluate(async () => {
      document.querySelector('.wday[data-date="2026-10-05"]').click();
      await new Promise((r) => setTimeout(r, 50));
      const d = [...document.querySelectorAll('.wblock')].map((b) => b.disabled);
      const note = document.querySelector('[data-wfull]');
      const said = note && !note.hidden ? note.textContent.trim() : null;
      document.querySelector('.wday[data-date="2026-10-05"]').click();
      return { disabled: d, said };
    });
    eq(full.disabled.join(','), 'true,true,true,true', 'a fourth pick is not offered: every block of a new day is off');
    ok(full.said && /picked 3/.test(full.said), 'and the page says so in words', full.said);
    await page.$eval('textarea[name="avail_notes"]', (e) => { e.value = 'Side gate, invented code 0000. One friendly dog.'; });
    await shoot(page, '2-three-picked.png');
    const got = await send(page);
    threeId = got.id;
    ok(got.id, 'the request was stored', got.landed);
    const row = await rowOf(W, got.id);
    eq(JSON.stringify(row.availability.choices), JSON.stringify([
      { date: '2026-09-29', block: '08-11' }, { date: '2026-09-25', block: '17-20' }, { date: '2026-10-02', block: '11-14' },
    ]), 'the record holds the three, in the order picked, with blocks');
    eq(row.availability.flexible, false, 'flexible false');
    eq(row.availability.notes, 'Side gate, invented code 0000. One friendly dog.', 'the note is kept');
    ok(!('invalid' in row.availability), 'no invalid flag', row.availability.invalid);
    ok(row.consent && row.consent.smsService === true, '/api/jobs carries the consent block, smsService true');
    const copy = got.copy;
    ok(copy, 'the browser posted its email copy');
    const t1 = copy && fieldValue(copy, 'time_1'), t2 = copy && fieldValue(copy, 'time_2'), t3 = copy && fieldValue(copy, 'time_3');
    eq(t1, '1 · Tue 9/29 · Morning 8–11', 'the email copy: "1 · Tue 9/29 · Morning 8–11"');
    eq(t2, '2 · Fri 9/25 · Evening 5–8', 'the email copy: "2 · Fri 9/25 · Evening 5–8"');
    eq(t3, '3 · Fri 10/2 · Midday 11–2', 'the email copy: "3 · Fri 10/2 · Midday 11–2"');
    eq(copy && fieldValue(copy, 'text_consent'), 'Yes — agreed to texts about this request (sms-v1)', 'the email copy carries the consent answer');
    eq(copy && fieldValue(copy, 'times_flexible'), 'No', 'and the flexible answer');
    eq(copy && fieldValue(copy, 'avail_notes'), 'Side gate, invented code 0000. One friendly dog.', 'and the note');
    const avc = copy ? copy.filter((p) => p.name === 'avail_choice').map((p) => p.value) : [];
    eq(avc.join(' | '), '2026-09-29 08-11 | 2026-09-25 17-20 | 2026-10-02 11-14', 'the email copy and the Worker got the same picks');

    /* (8) checked */
    const c = row.consent;
    eq(c.textVersion, 'sms-v1', '(8) version sms-v1');
    eq(c.at, T, '(8) the time is the server\'s moment');
    ok('ip' in c, '(8) the IP field is stored as received', String(c.ip));
    ok(typeof c.ua === 'string' && c.ua.length > 0 && c.ua.length <= 200 && /Chrome/.test(c.ua), '(8) the browser, first 200 chars', c.ua);
    eq(c.wordingSha256, sha(shownWords), '(8) the wording hash is the hash of the words the page showed');
    R['3'] = { id: got.id, choices: row.availability.choices, notes: row.availability.notes, chips, email_copy: { time_1: t1, time_2: t2, time_3: t3, times_flexible: fieldValue(copy, 'times_flexible'), text_consent: fieldValue(copy, 'text_consent') }, api_jobs_availability: row.availability, api_jobs_consent: row.consent };
    R['8'] = { checked: { id: got.id, consent: c, shown_words_sha256: sha(shownWords) } };
    await page.close();
  }

  /* B7 · the register's clock, the Worker's half */
  {
    const a = await directPost(W, '2026-09-22T01:25:11.000Z', { avail_form: 'v1', avail_flexible: 'yes', name: 'Fixture Late Lark', phone: '(956) 555-0177', what: 'Fixture Late Lark: invented ceiling crack.' });
    const tap = await json(`${W}/api/job/${a.id}/event?k=${ADMIN_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'quoted', at: '2026-09-22T10:43:00.000Z' }) });
    const r1 = await rowOf(W, a.id);
    eq(r1.minutes_to_quote, 558, '(3/B7) received Mon 9/21 8:25:11 PM, quoted Tue 9/22 5:43 AM: minutes_to_quote 558 (raw)');
    eq(r1.business_minutes_to_quote, 35, '(3/B7) business_minutes_to_quote 35');
    const u = await directPost(W, T, { avail_form: 'v1', avail_flexible: 'yes', name: 'Fixture Unquoted Una', phone: '(956) 555-0178', what: 'Fixture Unquoted Una: invented.' });
    const r2 = await rowOf(W, u.id);
    eq(r2.business_minutes_to_quote, null, '(3/B7) an unquoted record shows null');
    R['3'].b7 = { quoted: { id: a.id, received_at: r1.received_at, quoted_at: r1.quoted_at, minutes_to_quote: r1.minutes_to_quote, business_minutes_to_quote: r1.business_minutes_to_quote, tap_status: tap.status }, unquoted: { id: u.id, business_minutes_to_quote: r2.business_minutes_to_quote } };
  }

  /* ============================================================== (4) */
  suite('G · (4) refused on the server, the rest of the request kept');
  {
    const EIGHT_PM = '2026-09-24T01:00:00.000Z';   /* Wed 9/23 8:00 PM Central */
    const cases = [
      ['4 choices', T, ['2026-09-24 08-11', '2026-09-25 08-11', '2026-09-26 08-11', '2026-09-28 08-11'], 'too_many_choices'],
      ['0 choices without flexible', T, [], 'no_choice'],
      ['the same date+block twice', T, ['2026-09-29 08-11', '2026-09-29 08-11'], 'repeated_choice'],
      ['a 7–10 block', T, ['2026-09-29 07-10'], 'unknown_block'],
      ['today at 8 PM for Morning', EIGHT_PM, ['2026-09-23 08-11'], 'too_soon'],
      ['15 days out', T, ['2026-10-08 08-11'], 'too_far'],
      ['a Sunday', T, ['2026-09-27 08-11'], 'sunday'],
      ['30 Feb', T, ['2027-02-30 08-11'], 'not_a_date'],
      ['a garbage string', T, ['next tuesday-ish, afternoonish'], 'unreadable'],
    ];
    R['4'] = [];
    let n = 0;
    for (const [label, at, choices, code] of cases) {
      n++;
      const name = `Fixture Refusal ${String.fromCharCode(64 + n)}${n}`;
      const what = `${name}: invented dent by the invented door (${label}).`;
      const r = await directPost(W, at, { avail_form: 'v1', sms_consent_lang: 'en', avail_choice: choices, name, phone: '(956) 555-02' + String(n).padStart(2, '0'), address: `${n} Invented Ct`, what });
      const row = r.id ? await rowOf(W, r.id) : null;
      const inv = row && row.availability ? row.availability.invalid : null;
      ok(r.status === 303 && row, `${label}: the request is still stored (${r.id})`);
      ok(inv && inv.startsWith(code + ':'), `${label}: refused with a reason — ${inv}`, inv);
      ok(row && row.name === name && row.what === what && row.phone.startsWith('(956) 555-02'), `${label}: the rest of the request stands`);
      eq(row && row.availability.choices.length, 0, `${label}: nothing refused is offered as a time`);
      R['4'].push({ case: label, id: r.id, status: r.status, invalid: inv, raw: row && row.availability.raw, name_kept: row && row.name, what_kept: row && row.what });
    }
    /* a positive beside the same-day rule: at 10 AM, today's Evening (5 PM, 7 h away) is accepted */
    const sd = await directPost(W, T, { avail_form: 'v1', avail_choice: ['2026-09-23 17-20'], name: 'Fixture Same Day Sol', phone: '(956) 555-0250', what: 'Fixture Same Day Sol: invented.' });
    const sdr = await rowOf(W, sd.id);
    ok(sdr.availability && !sdr.availability.invalid && sdr.availability.choices.length === 1, 'today at 10 AM for Evening (7 h away) is accepted', sdr.availability.invalid);
    R['4'].push({ case: 'today at 10 AM for Evening (control, accepted)', id: sd.id, invalid: sdr.availability.invalid || null, choices: sdr.availability.choices });

    /* B4 · a form without the screen: contact.html, through the real page */
    const page = await newPage();
    await page.goto(SITE + '/contact', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const f = document.querySelector('form.req');
      const set = (sel, v) => { const el = f.querySelector(sel); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('[name="name"]', 'Fixture Contact Cato');
      set('[name="phone"]', '(956) 555-0299');
      set('[name="address"]', '9 Invented Row, Brownsville');
      set('textarea[name="message"]', 'Fixture Contact Cato: an invented question about a door.');
      set('textarea[name="what"]', 'Fixture Contact Cato: an invented question about a door.');
      const radio = f.querySelector('input[name="service"]');
      if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.evaluate(() => document.querySelector('form.req button[type="submit"]').click());
    await nav; await sleep(200);
    const cid = new URL(page.url()).searchParams.get('id');
    const crow = cid ? await rowOf(W, cid) : null;
    ok(crow, 'contact form: stored', page.url());
    eq(crow && crow.availability, null, 'contact form: availability null');
    eq(crow && crow.consent, null, 'contact form: no consent block');
    ok(crow && !JSON.stringify(crow).includes('"invalid"'), 'contact form: no invalid flag anywhere on the row');
    R['4'].push({ case: 'contact form (B4)', id: cid, availability: crow && crow.availability, consent: crow && crow.consent });
    await page.close();
  }

  /* ============================================================== (6) */
  suite('G · (6) at 11:30 PM Central "today" is still the 23rd');
  {
    const LATE = '2026-09-24T04:30:00.000Z';   /* Wed 9/23 11:30 PM CDT; UTC already says Thu 9/24 */
    const cfg = await json(`${W}/api/windows`, { headers: { 'x-umbra-test-now': LATE } });
    eq(cfg.body.today, '2026-09-23', 'the Worker: today is 2026-09-23 (Central)');
    const utcDay = LATE.slice(0, 10);
    eq(utcDay, '2026-09-24', 'while UTC already says 2026-09-24');
    const a = await directPost(W, LATE, { avail_form: 'v1', avail_choice: ['2026-10-07 08-11'], name: 'Fixture Night Owl Ona', phone: '(956) 555-0301', what: 'Fixture Night Owl Ona: invented.' });
    const ra = await rowOf(W, a.id);
    ok(!ra.availability.invalid, 'Wed 10/7 (today + 14, Central) is accepted', ra.availability.invalid);
    const b = await directPost(W, LATE, { avail_form: 'v1', avail_choice: ['2026-10-08 08-11'], name: 'Fixture Night Owl Oto', phone: '(956) 555-0302', what: 'Fixture Night Owl Oto: invented.' });
    const rb = await rowOf(W, b.id);
    ok(rb.availability.invalid && rb.availability.invalid.startsWith('too_far'), 'Thu 10/8 is 15 days out (UTC would have allowed it)', rb.availability.invalid);
    const c = await directPost(W, LATE, { avail_form: 'v1', avail_choice: ['2026-09-24 08-11'], name: 'Fixture Night Owl Oma', phone: '(956) 555-0303', what: 'Fixture Night Owl Oma: invented.' });
    const rc = await rowOf(W, c.id);
    ok(!rc.availability.invalid, 'Thu 9/24 Morning is tomorrow, accepted', rc.availability.invalid);
    /* the page, at the same instant, with the browser's own zone set to UTC */
    const page = await newPage({ now: LATE, tz: 'UTC' });
    await openAt(page, SITE + '/services#request', 'times', who('Night Page'));
    await page.waitForSelector('.wday');
    const dates = await chipDates(page);
    const browserUtcDay = await page.evaluate(() => new Date().toISOString().slice(0, 10));
    eq(dates[0], '2026-09-24', 'the page (browser zone UTC) starts at Thu 9/24');
    eq(dates[dates.length - 1], '2026-10-07', 'and ends at Wed 10/7');
    R['6'] = { now: LATE, worker_today: cfg.body.today, utc_day: utcDay, browser_utc_day: browserUtcDay, oct7: ra.availability, oct8: rb.availability.invalid, sep24: rc.availability, page_first: dates[0], page_last: dates[dates.length - 1], page_chips: dates.length };
    await page.close();
  }

  /* ============================================================== (7) (8 unchecked) */
  suite('G · (7) flexible, with 0 and with 3; (8) the box left unticked');
  {
    const page = await newPage();
    await openAt(page, SITE + '/services#request', 'times', who('Flexible Fern'));
    await page.waitForSelector('.wday');
    /* Next without a pick and without flexible is stopped, said in words */
    await page.click('[data-v2next]');
    const stopped = await page.evaluate(() => ({ screen: document.querySelector('[data-intake2]').getAttribute('data-screen'), note: (() => { const n = document.querySelector('[data-fstep="times"] .v2need'); return n && !n.hidden ? n.textContent.trim() : null; })() }));
    eq(stopped.screen, 'times', 'Next is held on the time screen with nothing picked');
    ok(stopped.note, 'and the page says why', stopped.note);
    await page.click('label.wflex');
    await shoot(page, '3-flexible.png');
    const got = await send(page);
    const row = await rowOf(W, got.id);
    ok(row.availability && row.availability.flexible === true && row.availability.choices.length === 0 && !row.availability.invalid, 'flexible with 0 choices accepted', JSON.stringify(row.availability));
    eq(row.consent && row.consent.smsService, false, '(8) the box left unticked: smsService false, and the request went through');
    eq(got.copy && fieldValue(got.copy, 'text_consent'), 'No', '(8) the email copy says No');
    eq(got.copy && fieldValue(got.copy, 'times_flexible'), 'Yes — any time works', 'the email copy says flexible');
    const three = await directPost(W, T, { avail_form: 'v1', avail_flexible: 'yes', avail_choice: ['2026-09-24 11-14', '2026-09-30 14-17', '2026-10-06 17-20'], name: 'Fixture Flexible Faye', phone: '(956) 555-0402', what: 'Fixture Flexible Faye: invented.' });
    const r3 = await rowOf(W, three.id);
    ok(r3.availability.flexible === true && r3.availability.choices.length === 3 && !r3.availability.invalid, 'flexible with 3 choices accepted', JSON.stringify(r3.availability));
    R['7'] = { flexible_0: { id: got.id, availability: row.availability }, flexible_3: { id: three.id, availability: r3.availability }, held_without_pick: stopped };
    R['8'].unchecked = { id: got.id, consent: row.consent, email_text_consent: fieldValue(got.copy, 'text_consent') };
    await page.close();

    /* the Spanish wording's hash */
    const es = await newPage();
    await openAt(es, SITE + '/es/servicios#request', 'phone', who('Spanish Sara'));
    await es.click('.wconsent label.v2opt');
    const esWords = await es.$eval('[data-sms-wording]', (e) => e.textContent.replace(/\s+/g, ' ').trim());
    for (let i = 0; i < 5 && (await screenOf(es)) !== 'times'; i++) { await es.click('[data-v2next]'); await sleep(40); }
    await es.waitForSelector('.wday');
    await pick(es, '2026-09-26', '08-11');
    await es.click('.wday[data-date="2026-10-01"]');
    await es.waitForSelector('.wblock', { visible: true });
    await shoot(es, '5-spanish.png');
    await es.click('.wday[data-date="2026-10-01"]');
    const esGot = await send(es);
    const esRow = await rowOf(W, esGot.id);
    eq(esRow.consent && esRow.consent.lang, 'es', '(8) Spanish: the record says which wording was shown');
    eq(esRow.consent && esRow.consent.wordingSha256, sha(esWords), '(8) Spanish: the hash is the hash of the Spanish words shown');
    ok(esRow.consent && esRow.consent.wordingSha256 !== R['8'].checked.consent.wordingSha256, '(8) and differs from the English hash');
    eq(esGot.copy && fieldValue(esGot.copy, 'time_1'), '1 · Sat 9/26 · Morning 8–11', 'Spanish page: the email copy is in plain English words for Drew');
    R['8'].spanish = { id: esGot.id, consent: esRow.consent, shown_words_sha256: sha(esWords), choices: esRow.availability.choices };
    await es.close();
  }

  /* ============================================================== (9) */
  suite('G · (9) keyboard alone; no target under 44 px at 390');
  {
    const page = await newPage();
    await openAt(page, SITE + '/services#request', 'notes', who('Keyboard Kit'));
    const tabTo = async (pred, max = 60) => {
      for (let i = 0; i < max; i++) {
        await page.keyboard.press('Tab');
        if (await page.evaluate(pred)) return true;
      }
      return false;
    };
    const log = [];
    ok(await tabTo(() => document.activeElement && document.activeElement.hasAttribute('data-v2next')), 'Tab reaches Next');
    await page.keyboard.press('Enter');
    await sleep(80);
    eq(await screenOf(page), 'times', 'Enter on Next opens the time screen');
    let fe = await page.evaluate(() => document.activeElement.className + ':' + document.activeElement.getAttribute('data-date'));
    log.push('focus after Next: ' + fe);
    ok(/wday/.test(fe), 'focus lands on the first day chip', fe);
    await page.keyboard.press('Enter');
    await sleep(60);
    fe = await page.evaluate(() => document.activeElement.className + ':' + document.activeElement.getAttribute('data-block'));
    ok(/wblock/.test(fe), 'Enter on a day opens its blocks, focus on the first', fe);
    log.push('Enter on day → ' + fe);
    await page.keyboard.press('Enter');
    await sleep(60);
    await page.keyboard.press('Tab');                               /* the next day */
    await page.keyboard.press('Enter');
    await sleep(60);
    await page.keyboard.press('Tab');                               /* Morning → Midday */
    await page.keyboard.press('Enter');
    await sleep(60);
    let picks = await page.$$eval('.wpick', (b) => b.map((x) => x.querySelector('.wpt').textContent));
    eq(picks.length, 2, 'two picks made by keyboard', picks.join(' | '));
    log.push('picks: ' + picks.join(' | '));
    /* Escape closes an open day */
    await page.keyboard.press('Enter'); await sleep(60);
    await page.keyboard.press('Escape'); await sleep(60);
    const closed = await page.evaluate(() => document.querySelector('[data-wblocks]').hidden);
    ok(closed, 'Escape closes an open day');
    ok(await tabTo(() => document.activeElement && document.activeElement.classList.contains('wpick')), 'Tab reaches a pick chip');
    await page.keyboard.press('Enter'); await sleep(60);
    picks = await page.$$eval('.wpick', (b) => b.map((x) => x.querySelector('.wpt').textContent));
    eq(picks.length, 1, 'Enter on a chip removes it', picks.join(' | '));
    ok(await tabTo(() => document.activeElement && document.activeElement.name === 'avail_flexible'), 'Tab reaches the flexible box');
    await page.keyboard.press('Space'); await sleep(40);
    eq(await page.$eval('input[name="avail_flexible"]', (e) => e.checked), true, 'Space ticks it');
    ok(await tabTo(() => document.activeElement && document.activeElement.hasAttribute('data-v2next')), 'Tab reaches Next again');
    await page.keyboard.press('Enter'); await sleep(80);
    eq(await screenOf(page), 'send', 'Enter moves on to Send');
    ok(await tabTo(() => document.activeElement && document.activeElement.hasAttribute('data-v2send')), 'Tab reaches Send');
    const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.keyboard.press('Enter');
    await nav; await sleep(200);
    const kid = new URL(page.url()).searchParams.get('id');
    const krow = kid ? await rowOf(W, kid) : null;
    ok(krow && krow.availability && krow.availability.choices.length === 1 && krow.availability.flexible === true && !krow.availability.invalid, 'the keyboard-only request is stored with its pick and flexible', krow && JSON.stringify(krow.availability));
    await page.close();

    /* targets at 390 px: the time screen with a day open and three picks, and the phone screen */
    const p2 = await newPage({ width: 390 });
    await openAt(p2, SITE + '/services#request', 'phone', who('Target Tam'));
    const measure = (scope) => p2.evaluate((sel) => {
      const root = document.querySelector(sel);
      const els = [...root.querySelectorAll('button, a, label.v2opt, textarea, input:not([type=hidden])'), ...document.querySelectorAll('.v2nav .btn')];
      return els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
        .map((e) => { const r = e.getBoundingClientRect(); return { t: (e.className || e.tagName) + ' ' + (e.textContent || e.name || '').replace(/\s+/g, ' ').trim().slice(0, 30), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; });
    }, scope);
    const phoneT = await measure('[data-fstep="phone"]');
    for (let i = 0; i < 3 && (await screenOf(p2)) !== 'times'; i++) { await p2.click('[data-v2next]'); await sleep(40); }
    await p2.waitForSelector('.wday');
    await pick(p2, '2026-09-24', '08-11');
    await pick(p2, '2026-09-30', '14-17');
    await pick(p2, '2026-10-07', '17-20');
    await p2.click('.wday[data-date="2026-10-01"]');
    await p2.waitForSelector('.wblock', { visible: true });
    const timesT = await measure('[data-fstep="times"]');
    const all = [...timesT, ...phoneT];
    const small = all.filter((x) => x.w < 44 || x.h < 44);
    eq(small.length, 0, `no target under 44 px (measured ${all.length})`, JSON.stringify(small));
    const minH = Math.min(...all.map((x) => x.h)), minW = Math.min(...all.map((x) => x.w));
    const scrollW = await p2.evaluate(() => document.documentElement.scrollWidth);
    ok(scrollW <= 391, 'and the page does not scroll sideways at 390', String(scrollW));
    await shoot(p2, '2b-day-open-three-picked.png');
    R['9'] = { keyboard: log, keyboard_record: kid, keyboard_availability: krow && krow.availability, targets_measured: all.length, min_height: minH, min_width: minW, under_44: small, scroll_width: scrollW, targets: all };
    await p2.close();
  }

  /* ============================================================== (11) */
  suite('G · (11) the same submission twice in 10 minutes, picks and consent included');
  {
    const f = { avail_form: 'v1', sms_consent_lang: 'en', sms_consent: 'yes', avail_choice: ['2026-09-28 08-11', '2026-10-01 14-17'], avail_notes: 'Invented: ring twice.', name: 'Fixture Twice Tova', phone: '(956) 555-0511', address: '11 Invented Loop', what: 'Fixture Twice Tova: an invented crack over the invented door.' };
    const n0 = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.count;
    const one = await directPost(W, T, f);
    const two = await directPost(W, plus(T, 2), f);
    for (let i = 0; i < 50 && aboutPO(one.id).length < 1; i++) await sleep(100);
    await sleep(1500);
    const n1 = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.count;
    eq(two.id, one.id, 'the second post lands on the same request number');
    eq(n1 - n0, 1, 'one record');
    eq(aboutPO(one.id).length, 1, 'one push');
    eq(aboutTG(one.id).length, 1, 'one Telegram message');
    const row = await rowOf(W, one.id);
    eq(row.consent.at, T, 'the consent time is the first post\'s (the server stamps it; it is not part of the match)');
    R['11'] = { first: one.id, second_at_plus2: two.id, records_added: n1 - n0, pushover: aboutPO(one.id).length, telegram: aboutTG(one.id).length, consent_at: row.consent.at, choices: row.availability.choices };
  }

  /* ============================================================== (5) */
  suite('G · (5) ALLOW_SUNDAY="true": Sundays appear and are accepted');
  {
    const SUN = path.join(TMP, 'sunday');
    fs.mkdirSync(SUN, { recursive: true });
    fs.writeFileSync(path.join(SUN, '.dev.vars'), [
      `ADMIN_KEY=${ADMIN_KEY}`,
      `FORMSUBMIT_ENDPOINT=http://127.0.0.1:${PORT.stub}/formsubmit`,
      `PUSHOVER_API_BASE=http://127.0.0.1:${PORT.stub}/pushover-sunday`,
      `TELEGRAM_API_BASE=http://127.0.0.1:${PORT.stub}/telegram-sunday`,
      `SITE_BASE_URL=http://127.0.0.1:${PORT_SUNDAY_SITE}`,
      `PUBLIC_BASE_URL=http://127.0.0.1:${PORT_SUNDAY_WORKER}`,
      'IGNORE_NEXT_ORIGIN=true', 'ALLOW_TEST_HOOKS=true', 'ALLOW_SUNDAY=true', '',
    ].join('\n'));
    const cfgFile = path.join(SUN, 'wrangler.sunday.toml');
    fs.writeFileSync(cfgFile, `
name = "umbra-intake-sunday-test"
main = ${JSON.stringify(path.join(WORKER_DIR, 'src', 'index.js'))}
base_dir = ${JSON.stringify(WORKER_DIR)}
compatibility_date = "2025-06-01"
rules = [ { type = "Text", globs = ["**/*.html"], fallthrough = false } ]

[vars]
SEED_LAST_ID = "900"

[[kv_namespaces]]
binding = "RECORDS"
id = "test-records-sunday"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "umbra-job-photos-sunday-test"
`);
    const wr = spawn(process.execPath,
      [path.join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
        'dev', '--config', cfgFile, '--port', String(PORT_SUNDAY_WORKER), '--ip', '127.0.0.1',
        '--inspector-port', String(PORT_SUNDAY_INSPECTOR),
        '--local', '--log-level', 'warn', '--persist-to', path.join(SUN, 'state')],
      { cwd: WORKER_DIR, env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let wlog = '';
    wr.stdout.on('data', (d) => { wlog += d; }); wr.stderr.on('data', (d) => { wlog += d; });
    const WS = `http://127.0.0.1:${PORT_SUNDAY_WORKER}`;
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(WS + '/health')).ok; } catch (e) { /* not yet */ } if (!up) await sleep(500); }
    ok(up, 'the ALLOW_SUNDAY Worker came up on ' + PORT_SUNDAY_WORKER, up ? '' : wlog.slice(-600));
    const siteSun = path.join(TMP, 'site-sunday');
    copyTree(path.join(TMP, 'site-worker'), siteSun, []);
    flipConstant(siteSun, WS);
    const ss = await staticServer({ port: PORT_SUNDAY_SITE, root: siteSun });
    try {
      const cfg = await json(`${WS}/api/windows`);
      eq(cfg.body && cfg.body.allow_sunday, true, '/api/windows says Sundays are allowed');
      const page = await newPage();
      await openAt(page, `http://127.0.0.1:${PORT_SUNDAY_SITE}/services#request`, 'times', who('Sunday Suri'));
      await page.waitForSelector('.wbox[data-config="loaded"]', { timeout: 10000 }).catch(() => null);
      const dates = await chipDates(page);
      eq(dates.length, 14, '14 day chips');
      ok(dates.includes('2026-09-27') && dates.includes('2026-10-04'), 'Sun 9/27 and Sun 10/4 appear', dates.join(','));
      await pick(page, '2026-09-27', '11-14');
      const got = await send(page);
      const row = got.id ? await rowOf(WS, got.id) : null;
      ok(row && !row.availability.invalid && row.availability.choices[0].date === '2026-09-27', 'a Sunday pick is accepted', row && JSON.stringify(row.availability));
      R['5'] = { worker: WS, config: cfg.body, chips: dates.length, chip_dates: dates, id: got.id, availability: row && row.availability, main_worker_sunday: R['4'].find((x) => x.case === 'a Sunday').invalid };
      await page.close();
    } finally {
      await close(ss);
      wr.kill('SIGTERM');
    }
  }

  return R;
}
