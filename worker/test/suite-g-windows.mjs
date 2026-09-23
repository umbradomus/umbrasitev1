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
/* SPANISH-FIX-01: read as a namespace, so a Worker without SMS_WORDINGS (the base) still loads and reads red */
import * as WIN from '../src/windows.js';

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
  async function newPage({ now = T, width = 390, tz = null, noConfig = false } = {}) {
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
      if (noConfig && /\/api\/windows$/.test(r.url())) { r.abort(); return; }
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

  /* SPANISH-FIX-01's pictures, all at 390 px; the round copies them out */
  const SFPIC = path.join(TMP, 'spanish-fix-pictures');
  fs.rmSync(SFPIC, { recursive: true, force: true });
  fs.mkdirSync(SFPIC, { recursive: true });
  async function sfShot(page, file, selector = null) {
    await page.evaluate(() => { const h = document.querySelector('header.top'); if (h) h.style.position = 'static'; });
    await sleep(250);
    const target = path.join(SFPIC, file);
    const el = selector ? await page.$(selector) : null;
    if (selector && !el) ok(false, `picture ${file}: ${selector} is on the page`);
    else if (el) await el.screenshot({ path: target });
    else await page.screenshot({ path: target, fullPage: true });
    await page.evaluate(() => { const h = document.querySelector('header.top'); if (h) h.style.position = ''; });
    return file;
  }

  const EXPECT_DAYS = ['2026-09-24','2026-09-25', '2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07'];

  /* ============================================================== (2) */
  suite('G · (2) the new screen, English and Spanish');
  {
    R['2'] = {};
    for (const [lang, url, title, blocks] of [
      ['en', SITE + '/services#request', 'When could we come?', ['Morning 8–11', 'Midday 11–2', 'Afternoon 2–5', 'Evening 5–8']],
      ['es', SITE + '/es/servicios#request', '¿Cuándo podemos ir?', ['Mañana 8–11', 'Mediodía 11–2', 'Tarde 2–5', 'Tarde-noche 5–8']],
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
      eq(consent.words, SMS_WORDING[lang], `${lang}: its words are the Worker's sms-v2 wording exactly`);
      ok(consent.privacy === '#privacy' && await page.$('#privacy'), `${lang}: with the privacy link beside it`, consent.privacy);
      const promo = await page.$$eval('input[type="checkbox"]', (b) => b.map((x) => x.name).filter((n) => /promo|market|offer|news/i.test(n)));
      eq(promo.length, 0, `${lang}: no promotional box anywhere on the form`);
      /* the page's own default, when the Worker cannot be asked: still no Sundays */
      const off = await newPage({ noConfig: true });
      await openAt(off, url, 'times', who('Offline ' + lang));
      await off.waitForSelector('.wday');
      await sleep(300);
      const offDates = await chipDates(off);
      const offCfg = await off.$eval('.wbox', (e) => e.getAttribute('data-config'));
      eq(offDates.join(','), EXPECT_DAYS.join(','), `${lang}: with /api/windows unreachable the page still offers the same 12, no Sunday`);
      eq(offCfg, null, `${lang}: (and the config really was not loaded)`);
      await off.close();
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
    eq(copy && fieldValue(copy, 'text_consent'), 'Yes — agreed to texts about this request (sms-v2)', 'the email copy carries the consent answer');
    eq(copy && fieldValue(copy, 'times_flexible'), 'No', 'and the flexible answer');
    eq(copy && fieldValue(copy, 'avail_notes'), 'Side gate, invented code 0000. One friendly dog.', 'and the note');
    const avc = copy ? copy.filter((p) => p.name === 'avail_choice').map((p) => p.value) : [];
    eq(avc.join(' | '), '2026-09-29 08-11 | 2026-09-25 17-20 | 2026-10-02 11-14', 'the email copy and the Worker got the same picks');

    /* (8) checked */
    const c = row.consent;
    eq(c.textVersion, 'sms-v2', '(8) version sms-v2');
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

  /* ============================================================== SPANISH-FIX-01 (12)–(15)
     The round's own readings: the consent under sms-v2, the Spanish picker, es/recibido's times, the size scale.
     Each is written so that, run on the base (645c32d), it reads red where the round changes something. */
  const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const PIN_V1 = {   /* SMS_WORDING at the base, measured by 1SUPE5 at 645c32d — never this round's own constant */
    en: 'c6445736ec428857ddf6f1575d0485b2075eb26134d954a7c7eeddb9ff9ac1a6',
    es: '1020274500ea99128270b0bf6bbfe4501ebe16dec8d6e3567ee44661b722dc01',
  };
  const R52_SHIP = 'Responda STOP o ALTO para cancelar, HELP o AYUDA para obtener ayuda.';

  suite('G · (12) SPANISH-FIX-01: sms-v2 — the record names the wording the customer saw');
  {
    const V = WIN.SMS_WORDINGS || {};
    const v1 = V['sms-v1'] || {}, v2 = V['sms-v2'] || {};
    R['12'] = { wordings: {
      'sms-v1': { en_sha256: v1.en ? sha(v1.en) : null, es_sha256: v1.es ? sha(v1.es) : null },
      'sms-v2': { en_sha256: v2.en ? sha(v2.en) : null, es_sha256: v2.es ? sha(v2.es) : null, es: v2.es || null },
      SMS_VERSION: WIN.SMS_VERSION,
    } };
    eq(v1.en ? sha(v1.en) : null, PIN_V1.en, '(2) SMS_WORDINGS["sms-v1"].en is the base wording byte for byte (sha256 pinned at 645c32d)');
    eq(v1.es ? sha(v1.es) : null, PIN_V1.es, '(2) SMS_WORDINGS["sms-v1"].es is the base wording byte for byte (sha256 pinned at 645c32d)');
    eq(v2.en === undefined ? null : v2.en, v1.en === undefined ? 'missing' : v1.en, '(6b) the sms-v2 English equals the sms-v1 English, byte for byte');
    ok(typeof v2.es === 'string' && v2.es.includes(R52_SHIP), '(2) the sms-v2 Spanish carries R52: "' + R52_SHIP + '"');
    ok(typeof v2.es === 'string' && v2.es === (v1.es || '').replace('Responda STOP para cancelar, HELP para obtener ayuda.', R52_SHIP), '(2) and differs from sms-v1 by R52 alone');
    eq(WIN.SMS_VERSION, 'sms-v2', 'SMS_VERSION is sms-v2');
    ok(WIN.SMS_WORDING === v2, 'SMS_WORDING (the old export) is SMS_WORDINGS["sms-v2"]');

    /* (6a) and (6b): through the real pages, box ticked */
    R['12'].pages = {};
    for (const [lang, url] of [['es', SITE + '/es/servicios#request'], ['en', SITE + '/services#request']]) {
      const page = await newPage();
      await openAt(page, url, 'phone', who('Consent v2 ' + lang));
      const marker = await page.evaluate(() => {
        const e = document.querySelector('input[name="sms_consent_version"]');
        return e ? { type: e.type, value: e.value, in_form: e.form === document.querySelector('form.req'), next_to_lang: !!(e.previousElementSibling && e.previousElementSibling.name === 'sms_consent_lang') } : null;
      });
      eq(marker && marker.type + ' ' + marker.value, 'hidden sms-v2', `(6) ${lang}: the page carries <input type="hidden" name="sms_consent_version" value="sms-v2">`);
      ok(marker && marker.in_form && marker.next_to_lang, `(6) ${lang}: inside form.req, next to sms_consent_lang`, JSON.stringify(marker));
      await page.click('.wconsent label.v2opt');
      const words = await page.$eval('[data-sms-wording]', (e) => e.textContent.replace(/\s+/g, ' ').trim());
      if (lang === 'es') await sfShot(page, '3-consent.png', '[data-fstep="phone"]');
      for (let i = 0; i < 5 && (await screenOf(page)) !== 'times'; i++) { await page.click('[data-v2next]'); await sleep(40); }
      await page.waitForSelector('.wday');
      await page.click('label.wflex');
      const got = await send(page);
      const row = got.id ? await rowOf(W, got.id) : null;
      const c = row && row.consent;
      eq(c && c.textVersion, 'sms-v2', `(6${lang === 'es' ? 'a' : 'b'}) ${lang}: textVersion "sms-v2"`);
      eq(c && c.smsService, true, `(6${lang === 'es' ? 'a' : 'b'}) ${lang}: smsService true`);
      eq(c && c.wordingSha256, v2[lang] ? sha(v2[lang]) : 'no v2 wording', `(6${lang === 'es' ? 'a' : 'b'}) ${lang}: wordingSha256 is the sha256 of the v2 ${lang} wording`);
      eq(words, v2[lang] === undefined ? 'no v2 wording' : v2[lang], `(6${lang === 'es' ? 'a' : 'b'}) ${lang}: the page's label, whitespace collapsed, is the v2 ${lang} wording`);
      if (lang === 'en') eq(c && c.wordingSha256, PIN_V1.en, '(6b) en: and that hash is the v1 English hash, since the English did not change');
      const copyVersion = got.copy && fieldValue(got.copy, 'sms_consent_version');
      const copyText = got.copy && fieldValue(got.copy, 'text_consent');
      eq(copyVersion, 'sms-v2', `(6) ${lang}: the browser posted sms_consent_version=sms-v2`);
      eq(copyText, 'Yes — agreed to texts about this request (sms-v2)', `(6f) ${lang}: the email copy's text_consent reads "(sms-v2)"`);
      R['12'].pages[lang] = { id: got.id, marker, consent: c, shown_words_sha256: sha(words), posted_sms_consent_version: copyVersion, email_text_consent: copyText };
      await page.close();
    }

    /* (6c) an old page: no sms_consent_version at all */
    R['12'].old_page = {};
    for (const lang of ['es', 'en']) {
      const r = await directPost(W, T, { avail_form: 'v1', avail_flexible: 'yes', sms_consent: 'yes', sms_consent_lang: lang, name: `Fixture Old Page ${lang.toUpperCase()}`, phone: lang === 'es' ? '(956) 555-0611' : '(956) 555-0612', what: `Fixture Old Page ${lang}: an invented crack.` });
      const c = (await rowOf(W, r.id)).consent;
      eq(c.textVersion, 'sms-v1', `(6c) ${lang}: no sms_consent_version (an old page) → "sms-v1"`);
      eq(c.wordingSha256, PIN_V1[lang], `(6c) ${lang}: and the v1 hash pinned at the base`);
      eq(c.smsService, true, `(6c) ${lang}: the consent counts`);
      R['12'].old_page[lang] = { id: r.id, consent: c };
    }

    /* (6d) a version we cannot show them: never counts. Plus the edges of the good ones. */
    R['12'].posted = [];
    const cases = [
      ['"sms-v9"', 'sms-v9', 'unknown'],
      ['"constructor"', 'constructor', 'unknown'],
      ['"__proto__"', '__proto__', 'unknown'],
      ['"toString"', 'toString', 'unknown'],
      ['"hasOwnProperty"', 'hasOwnProperty', 'unknown'],
      ['posted twice (sms-v2, sms-v2)', ['sms-v2', 'sms-v2'], 'unknown'],
      ['"SMS-V2" (not exactly)', 'SMS-V2', 'unknown'],
      ['" sms-v2 " (trimmed)', ' sms-v2 ', 'sms-v2'],
      ['"sms-v1" named', 'sms-v1', 'sms-v1'],
      ['"   " (empty after trimming)', '   ', 'sms-v1'],
    ];
    let k = 0;
    for (const [label, value, want] of cases) {
      k++;
      const r = await directPost(W, T, { avail_form: 'v1', avail_flexible: 'yes', sms_consent: 'yes', sms_consent_lang: 'es', sms_consent_version: value, name: `Fixture Version Case ${String.fromCharCode(64 + k)}`, phone: '(956) 555-06' + String(20 + k), what: `Fixture version case ${k}: an invented dent.` });
      const row = r.id ? await rowOf(W, r.id) : null;
      const c = row && row.consent;
      ok(r.status === 303 && row, `(6d) ${label}: the request is still stored (${r.id})`);
      eq(c && c.textVersion, want, `(6d) ${label} → textVersion "${want}"`);
      if (want === 'unknown') {
        eq(c && c.wordingSha256, null, `(6d) ${label} → wordingSha256 null`);
        eq(c && c.smsService, false, `(6d) ${label} → smsService false, though the box was ticked`);
      } else {
        eq(c && c.wordingSha256, want === 'sms-v1' ? PIN_V1.es : (v2.es ? sha(v2.es) : 'no v2'), `(6d) ${label} → the ${want} Spanish hash`);
        eq(c && c.smsService, true, `(6d) ${label} → smsService true`);
      }
      R['12'].posted.push({ case: label, posted: value, id: r.id, textVersion: c && c.textVersion, wordingSha256: c && c.wordingSha256, smsService: c && c.smsService });
    }

    /* (6e) JavaScript off: the page's own action is FormSubmit, so the post is caught in the browser and never leaves;
       its body is read, then replayed to the local Worker only. */
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844 });
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      let caught = null;
      const aborted = [];
      page.on('request', (r) => {
        const u = r.url();
        if (/^http:\/\/127\.0\.0\.1:/.test(u)) { r.continue(); return; }
        if (r.method() === 'POST' && !caught) caught = { url: u, headers: r.headers(), body: r.postData() || '' };
        aborted.push(u.replace(/\/[0-9a-f]{32}$/, '/<form id>'));
        r.abort();
      });
      await page.goto(SITE + '/es/servicios', { waitUntil: 'domcontentloaded' });
      const filled = await page.evaluate(() => {
        const f = document.querySelector('form.req');
        const set = (sel, v) => { const el = f.querySelector(sel); if (el) el.value = v; return !!el; };
        const tick = (sel) => { const el = f.querySelector(sel); if (el) el.checked = true; return !!el; };
        const r = [set('[name="name"]', 'Fixture No Script Nidia'), set('[name="phone"]', '(956) 555-0640'), set('textarea[name="what"]', 'Fixture No Script Nidia: an invented dent, JavaScript off.'), tick('input[name="sms_consent"]'), tick('input[name="avail_flexible"]')];
        f.submit();
        return r;
      }).catch((e) => 'evaluate failed: ' + e.message);
      for (let i = 0; i < 50 && !caught; i++) await sleep(100);
      const body = caught ? caught.body : '';
      const posted = /name="sms_consent_version"\r?\n\r?\nsms-v2\r?\n/.test(body);
      ok(caught && /^https:\/\/formsubmit\.co\//.test(caught.url), '(6e) JavaScript off: the form posted to its own action (caught in the browser, aborted — it never left)', caught ? caught.url.replace(/[0-9a-f]{32}$/, '<form id>') : JSON.stringify(filled));
      ok(posted, '(6e) JavaScript off: the post carries sms_consent_version=sms-v2', body.length + ' bytes');
      let replay = null;
      if (caught && body) {
        const rr = await fetch(`${W}/intake`, { method: 'POST', body: Buffer.from(body, 'utf8'), redirect: 'manual', headers: { 'content-type': caught.headers['content-type'], 'x-umbra-test-now': T } });
        const loc = rr.headers.get('location');
        const id = loc ? new URL(loc).searchParams.get('id') : null;
        const c = id ? (await rowOf(W, id)).consent : null;
        eq(c && c.textVersion, 'sms-v2', '(6e) replayed to the local Worker: the record says sms-v2');
        replay = { status: rr.status, id, consent: c };
      }
      R['12'].javascript_off = { filled, posted_to: caught && caught.url.replace(/[0-9a-f]{32}$/, '<form id>'), aborted_in_browser: aborted, version_field_posted: posted, replay };
      await page.close();
    }
  }

  suite('G · (13) SPANISH-FIX-01: the Spanish picker — a capital where a pick starts; buttons, labels and posted words unchanged');
  {
    R['13'] = {};
    const BASE = {   /* the base's own readings (645c32d, windows-readings.json (2) and (3)) */
      es_days: ['jue24 sep', 'vie25 sep', 'sáb26 sep', 'lun28 sep', 'mar29 sep', 'mié30 sep', 'jue1 oct', 'vie2 oct', 'sáb3 oct', 'lun5 oct', 'mar6 oct', 'mié7 oct'],
      en_days: ['Thu9/24', 'Fri9/25', 'Sat9/26', 'Mon9/28', 'Tue9/29', 'Wed9/30', 'Thu10/1', 'Fri10/2', 'Sat10/3', 'Mon10/5', 'Tue10/6', 'Wed10/7'],
    };
    for (const [lang, url] of [['es', SITE + '/es/servicios#request'], ['en', SITE + '/services#request']]) {
      const page = await newPage();
      await openAt(page, url, 'times', who('Picker ' + lang));
      await page.waitForSelector('.wday');
      const days = await chipTexts(page);
      const dayAria = await page.$$eval('.wday', (b) => b.map((x) => x.getAttribute('aria-label')));
      const blocks = await blockLabels(page, '2026-10-01');
      await pick(page, '2026-09-26', '08-11');
      await pick(page, '2026-10-01', '17-20');
      await pick(page, '2026-09-29', '14-17');
      const picks = await page.$$eval('.wpick', (b) => b.map((x) => ({ text: x.querySelector('.wpt').textContent, aria: x.getAttribute('aria-label') })));
      const dayAriaAfter = await page.$$eval('.wday.has', (b) => b.map((x) => x.getAttribute('aria-label')));
      const dow = await page.$$eval('.wday .wdow', (b) => b.map((x) => x.textContent));
      if (lang === 'es') {
        await sfShot(page, '2-times.png', '[data-fstep="times"]');
        eq(picks.map((p) => p.text).join(' | '), 'Sáb 26 sep · Mañana 8–11 | Jue 1 oct · Tarde-noche 5–8 | Mar 29 sep · Tarde 2–5', '(7) es: each pick\'s text (.wpick .wpt) starts with a capital');
        eq(picks.map((p) => p.aria).join(' | '), 'Quitar sáb 26 sep · Mañana 8–11 | Quitar jue 1 oct · Tarde-noche 5–8 | Quitar mar 29 sep · Tarde 2–5', '(7) es: its remove label is unchanged ("Quitar sáb 26 sep · …", lowercase)');
        eq(days.join(','), BASE.es_days.join(','), '(7) es: the day buttons read as at the base');
        eq(dayAria[0] + ' | ' + dow[0], 'jue 24 sep | jue', '(7) es: a day button\'s label and its weekday stay lowercase (CSS capitalises the button)');
        eq(dayAriaAfter.join(' | '), 'sáb 26 sep, 1 elegido | mar 29 sep, 1 elegido | jue 1 oct, 1 elegido', '(7) es: a day with a pick says so, as at the base');
        eq(blocks.join(' | '), 'Mañana 8–11 | Mediodía 11–2 | Tarde 2–5 | Tarde-noche 5–8', '(7) es: the fourth block reads "Tarde-noche 5–8"');
      } else {
        eq(picks.map((p) => p.text).join(' | '), 'Sat 9/26 · Morning 8–11 | Thu 10/1 · Evening 5–8 | Tue 9/29 · Afternoon 2–5', '(7) en: the English picks read as at the base');
        eq(picks.map((p) => p.aria).join(' | '), 'Remove Sat 9/26 · Morning 8–11 | Remove Thu 10/1 · Evening 5–8 | Remove Tue 9/29 · Afternoon 2–5', '(7) en: and their remove labels');
        eq(days.join(','), BASE.en_days.join(','), '(7) en: the English day buttons read as at the base');
        eq(blocks.join(' | '), 'Morning 8–11 | Midday 11–2 | Afternoon 2–5 | Evening 5–8', '(7) en: the English blocks read as at the base');
      }
      const got = await send(page);
      const tn = got.copy ? [1, 2, 3].map((n) => fieldValue(got.copy, 'time_' + n)) : [];
      const avc = got.copy ? got.copy.filter((p) => p.name === 'avail_choice').map((p) => p.value) : [];
      eq(tn.join(' | '), '1 · Sat 9/26 · Morning 8–11 | 2 · Thu 10/1 · Evening 5–8 | 3 · Tue 9/29 · Afternoon 2–5', `(7) ${lang}: the posted time_1..3 are the base's plain English`);
      eq(avc.join(' | '), '2026-09-26 08-11 | 2026-10-01 17-20 | 2026-09-29 14-17', `(7) ${lang}: and the posted avail_choice values`);
      R['13'][lang] = { day_buttons: days, day_aria_first: dayAria[0], day_aria_with_picks: dayAriaAfter, blocks, picks, posted_time: tn, posted_avail_choice: avc, id: got.id };
      await page.close();
    }
  }

  suite('G · (14) SPANISH-FIX-01: es/recibido — one time style, la/las, "mañana antes de …", never "p. m."');
  {
    R['14'] = [];
    const read = (page) => page.evaluate(() => {
      const t = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
      const by = document.getElementById('by');
      return { when: t('#when'), bywhen: t('#bywhen'), lead: t('main .lead'), by_line: t('#by'), by_hidden: by ? by.hidden : null, text: document.body.innerText, html: document.documentElement.outerHTML };
    });
    const cases = [
      ['1:05 PM', '2026-09-23T18:05:00.000Z', 'a la 1:05 p.m.', 'Le contestamos antes de las 3:05 p.m.', '5-recibido-afternoon.png'],
      ['12:40 PM', '2026-09-23T17:40:00.000Z', 'a las 12:40 p.m.', 'Le contestamos antes de las 2:40 p.m.'],
      ['11:05 AM', '2026-09-23T16:05:00.000Z', 'a las 11:05 a.m.', 'Le contestamos antes de la 1:05 p.m.'],
      ['7:30 PM', '2026-09-24T00:30:00.000Z', 'a las 7:30 p.m.', 'Le contestamos mañana antes de las 9:00 a.m.', '6-recibido-night.png'],
      ['5:30 AM', '2026-09-23T10:30:00.000Z', 'a las 5:30 a.m.', 'Le contestamos antes de las 9:00 a.m.'],
    ];
    for (const [label, now, when, byLine, picture] of cases) {
      const page = await newPage({ now, tz: 'America/Chicago' });
      await page.goto(SITE + '/es/recibido', { waitUntil: 'load' });
      const r = await read(page);
      eq(r.when, when, `(4) ${label}: #when reads "${when}"`);
      ok(r.lead && r.lead.includes(`se abrió ${when} en su teléfono`), `(4) ${label}: "…se abrió ${when} en su teléfono."`, r.lead);
      eq(r.by_line, byLine, `(4) ${label}: "${byLine}"`);
      eq(r.by_hidden, false, `(4) ${label}: the answer-by line shows`);
      if (label === '5:30 AM') eq(/mañana/.test(r.by_line || ''), false, '(4) 5:30 AM: same day, so no "mañana"');
      eq((r.text.match(/[ap]\. m\./g) || []).length + (r.html.match(/[ap]\. m\./g) || []).length, 0, `(4) ${label}: no "a. m."/"p. m." in the page or its source`);
      eq((r.text.match(/\.\./g) || []).length, 0, `(4) ${label}: no ".." anywhere on the page`);
      if (picture) await sfShot(page, picture);
      R['14'].push({ case: label, now, when: r.when, bywhen: r.bywhen, lead: r.lead, by_line: r.by_line });
      await page.close();
    }
    const off = await browser.newPage();
    await off.setViewport({ width: 390, height: 844 });
    await off.setJavaScriptEnabled(false);
    await off.goto(SITE + '/es/recibido', { waitUntil: 'load' });
    const r = await read(off);
    ok(r.lead && r.lead.includes('se abrió hace un momento en su teléfono'), '(4) JavaScript off: "se abrió hace un momento en su teléfono"', r.lead);
    eq(r.by_hidden, true, '(4) JavaScript off: no answer-by line (#by stays hidden)');
    eq(/Le contestamos/.test(r.text), false, '(4) JavaScript off: "Le contestamos" is nowhere in the visible text');
    eq((r.text.match(/\.\./g) || []).length, 0, '(4) JavaScript off: no ".."');
    R['14'].push({ case: 'JavaScript off', lead: r.lead, by_hidden: r.by_hidden });
    await off.close();
  }

  suite('G · (15) SPANISH-FIX-01: the size scale — the wizard and the home intake');
  {
    const SIZES = 'Como un hoyito de clavo · Como una moneda · Como una pelota de golf · Como un puño · Como un balón';
    const page = await newPage();
    await page.goto(SITE + '/es/servicios#request', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-intake2][data-screen]');
    const groups = await page.$$eval('[data-fstep$="-size"]', (s) => s.map((x) => ({ step: x.getAttribute('data-fstep'), sizes: [...x.querySelectorAll('.v2opt span')].map((e) => e.textContent.trim()) })));
    for (const g of groups) eq(g.sizes.join(' · '), SIZES, `(8) es/servicios ${g.step}: "${SIZES}"`);
    eq(groups.length, 2, '(8) both size steps (ceiling and walls) were read');
    await page.evaluate(() => {
      const f = document.querySelector('form.req');
      const tick = (n, v) => { const el = f.querySelector(`input[name="${n}"][value="${v}"]`); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); };
      tick('problem', 'Holes');
      tick('problem_area', 'Walls');
    });
    let screen = null;
    for (let i = 0; i < 12; i++) {
      screen = await screenOf(page);
      if (screen === 'walls-size') break;
      await page.click('[data-v2next]');
      await sleep(60);
    }
    eq(screen, 'walls-size', '(8) the wizard walks to the walls size step');
    if (screen === 'walls-size') await sfShot(page, '1-size.png', '[data-fstep="walls-size"]');
    await page.close();

    /* es/index.html's intake: tap Tablaroca y pintura → Hoyos por resanar → Techo, then measure the size chips at 390 */
    const home = await newPage({ width: 390 });
    await home.goto(SITE + '/es/', { waitUntil: 'load' });
    const steps = [];
    const tapChip = async (sel, shown) => {
      try {
        await home.click(sel);
        await home.waitForSelector(shown, { visible: true, timeout: 5000 });
        steps.push(sel + ' → ' + shown + ' shown');
      } catch (err) { ok(false, `(8) home: ${sel} reveals ${shown}`, err.message); }
    };
    await tapChip('input[name="service"][value="Drywall & Paint"] + span', '[data-intake-problem]');
    await tapChip('input[name="problem"][value="Holes to patch"] + span', '[data-intake-holes]');
    await tapChip('input[name="problem_area"][value="Ceiling"] + span', '.area[data-card="ceiling"]');
    const m = await home.evaluate(() => {
      const chips = [...document.querySelectorAll('.area[data-card="ceiling"] input[name="ceiling_biggest"]')].map((i) => i.closest('.chip'));
      /* the lines the words sit on: the text nodes' own boxes only (the size dot beside them is not a line) */
      const lineCount = (el) => {
        const tops = new Set();
        for (const n of el.childNodes) {
          if (n.nodeType !== 3 || !n.textContent.trim()) continue;
          const r = document.createRange(); r.selectNodeContents(n);
          for (const x of r.getClientRects()) if (x.width > 1) tops.add(Math.round(x.top));
        }
        return tops.size;
      };
      return {
        chips: chips.map((c) => { const s = c.querySelector('span'); const b = c.getBoundingClientRect(); return { text: s.textContent.trim(), w: Math.round(b.width), h: Math.round(b.height), lines: lineCount(s) }; }),
        scrollWidth: document.documentElement.scrollWidth, innerWidth,
      };
    });
    const nail = m.chips.find((c) => c.text === 'Como un hoyito de clavo');
    const coin = m.chips.find((c) => c.text === 'Como una moneda');
    ok(nail, '(8) home: the smallest chip reads "Como un hoyito de clavo"', JSON.stringify(m.chips.map((c) => c.text)));
    eq(nail && nail.lines, 1, '(8) home at 390: "Como un hoyito de clavo" sits on one line');
    eq(nail && coin && nail.h === coin.h, true, '(8) home at 390: and is as tall as the one-line "Como una moneda" chip', JSON.stringify({ nail, coin }));
    ok(m.scrollWidth <= 390, '(8) home at 390: no sideways scroll', String(m.scrollWidth));
    await sfShot(home, '4-home-intake-size.png', '.area[data-card="ceiling"]');
    R['15'] = { wizard_groups: groups, wizard_screen: screen, home_steps: steps, home_chips: m.chips, home_scroll_width: m.scrollWidth };
    await home.close();
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
