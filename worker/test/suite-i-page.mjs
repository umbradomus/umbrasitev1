/* SUITE I · THE CUSTOMER'S PAGE (ACCEPT-PAGE-02, 2026-09-23). /q/<code> through the local site server, which
   plays vercel.json's rewrite (lib/servers.mjs proxyTo), against the real `wrangler dev` with the book running
   locally, and the fake Pushover / Telegram. A real headless Chrome clicks the buttons; raw HTTP (node:http, and
   curl for the re-post) sends exactly the headers a reading names. Every moment is named with x-umbra-test-now.

   Every booked day below is this suite's own (suite H's are 9/29–10/10), except reading (4)'s Tue 9/29 8–10,
   which the ignite names: the job suite H left holding it is cancelled first, by the admin route, and named.
     P1 10/12 · P2 9/29 8–10 · P3 10/13 · P4 10/14 · P5 10/15 + 10/16 1–3 PM · P6 10/19 + 10/20 · P7 10/19 ·
     P8 10/19 9–11 · P9 10/22 · P10 10/23 · P11 10/24 · P12 10/26 · P13 10/27 · P14 10/28 + 10/29 ·
     P15 (es) 10/30 + 10/31 11 AM–1 PM · P16 10/30 2–4 PM · the notice Workers their own books. */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { chicagoWall } from '../src/biztime.js';
import { WORDS, LIGHTING_ES } from '../src/page-words.js';
import { LIGHTING_EN, NOTICE_53255, LIGHTING_SHA256, NOTICE_53255_SHA256 } from '../src/notices.js';
import { staticServer, close } from './lib/servers.mjs';

/* The notice Workers: wrangler dev on 4779, its site copy (with the /q proxy) on 4776, inspector on 4778.
   All three belong to the website range; suite G's Sunday Worker used 4776–4778 and has closed them by now. */
const PORT_NOTICE_WORKER = 4779;
const PORT_NOTICE_SITE = 4776;
const PORT_NOTICE_INSPECTOR = 4778;

const READY4 = 'C:/Users/andre/Umbra/Boss/Bridge/SITE-ROWS-READY-01/READY-4-status-page-disclosures.md';

export async function suitePage(ctx) {
  const { browser, W, stub, sw, siteWorker, ADMIN_KEY, FAKE, suite, ok, eq, json, sleep, SITE, TMP, WORKER_DIR, REPO_DIR, wlogRef } = ctx;
  const R = {};
  const PIC = path.join(TMP, 'page-pictures');
  fs.rmSync(PIC, { recursive: true, force: true });
  fs.mkdirSync(PIC, { recursive: true });

  const CT = (y, mo, d, h, mi = 0) => new Date(chicagoWall(y, mo, d, h, mi)).toISOString();
  const win = (date, start, end) => ({ date, start, end });
  const WED = [2026, 9, 23];
  const T10 = CT(...WED, 10, 0);
  const codes = [];                                  /* every code this suite made — for the log grep */
  const bodies = [];                                 /* every page body this suite read — for the word greps */
  const redirects = [];                              /* every 303 this suite saw — reading (17) */

  /* ---------------------------------------------------------------- raw HTTP, exactly the headers named */
  function req(method, url, { headers = {}, body = null } = {}) {
    const u = new URL(url);
    const h = {};
    for (const [k, v] of Object.entries(headers)) if (v !== null && v !== undefined) h[k] = v;
    if (body !== null) h['content-length'] = Buffer.byteLength(body);
    return new Promise((resolve, reject) => {
      const r = http.request({ host: u.hostname, port: u.port, method, path: u.pathname + u.search, headers: h }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (text) bodies.push(text);
          const out = { status: res.statusCode, headers: res.headers, text };
          if (res.statusCode === 303) redirects.push({ via: 'node:http', method, path: u.pathname, location: res.headers.location, headers: res.headers });
          resolve(out);
        });
      });
      r.on('error', reject);
      if (body !== null) r.write(body);
      r.end();
    });
  }
  const qurl = (code, tail = '', base = SITE) => `${base}/q/${code}${tail}`;
  const getQ = (code, now, extra = {}, base = SITE) => req('GET', qurl(code, '', base), { headers: { 'x-umbra-test-now': now, ...extra } });
  const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)).toString();
  /* A same-origin form post, as the browser sends it; `extra` may replace or (with null) remove any header. */
  const postQ = (code, fields, now, extra = {}, tail = '', base = SITE) => req('POST', qurl(code, tail, base), {
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base, 'sec-fetch-site': 'same-origin', 'x-umbra-test-now': now, ...extra },
    body: form(fields),
  });
  const stateOf = (html) => { const m = /<body data-state="([^"]*)"/.exec(html || ''); return m ? m[1] : null; };
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const textOf = (html) => decode(String(html || '').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const titleOf = (html) => { const m = /<title>([^<]*)<\/title>/.exec(html || ''); return m ? decode(m[1]) : null; };

  /* ---------------------------------------------------------------- the Worker's own doors */
  const H = (now) => ({ 'content-type': 'application/json', ...(now ? { 'x-umbra-test-now': now } : {}) });
  const admin = (method, p, body, now, base = W) => json(`${base}${p}?k=${ADMIN_KEY}`, { method, headers: H(now), body: body === undefined ? undefined : JSON.stringify(body) });
  const create = (id, body, now, base = W) => admin('POST', `/admin/quote/${id}`, body, now, base);
  const sentQ = (id, version, at, base = W) => admin('POST', `/admin/quote/${id}/sent`, { version, sent_at: at }, at, base);
  const cancelQ = (id, version, now) => admin('POST', `/admin/quote/${id}/cancel`, { version }, now);
  const acceptText = (id, version, window, now) => admin('POST', `/admin/quote/${id}/accept`, { version, window }, now);
  const dump = async (base = W) => (await json(`${base}/__book-dump?k=${ADMIN_KEY}`, { method: 'POST', headers: H(null), body: '{}' })).body;
  const rowsOf = async (id, base = W) => (await dump(base)).quotes.filter((q) => q.job_id === id);
  const bookingsOn = async (date) => (await dump()).bookings.filter((b) => b.date === date);
  const rawRecord = async (id, base = W) => (await fetch(`${base}/__record/${id}?k=${ADMIN_KEY}`, { method: 'POST' })).text();
  const record = async (id) => JSON.parse(await rawRecord(id));
  const minusViews = (r) => { const { views, last_view_at, ...rest } = r; return JSON.stringify(rest); };

  const PO = () => stub.captured.filter((c) => c.method === 'POST' && c.url === '/pushover/1/messages.json')
    .map((c) => new URLSearchParams(c.body.toString('utf8')));
  const TG = () => stub.captured.filter((c) => c.method === 'POST' && /^\/telegram\/bot[^/]+\/sendMessage$/.test(c.url))
    .map((c) => JSON.parse(c.body.toString('utf8')).text);
  /* only the book's two pushes (as suite H counts them), never the intake ladder's first alert for the job */
  const BOOKISH = /^(ACCEPTED · U-\d+ · |U-\d+ · none of the times work$)/;
  const pushesFor = (id) => ({
    pushover: PO().filter((p) => BOOKISH.test(p.get('title') || '') && (p.get('title') || '').includes(id + ' ')).map((p) => p.get('title') + ' / ' + p.get('message')),
    telegram: TG().filter((t) => BOOKISH.test(t.split('\n')[0]) && t.split('\n')[0].includes(id + ' ')).map((t) => t.replace(/\n/g, ' / ')),
  });

  let serial = 0;
  async function submitAt(iso, name, words, base = W) {
    serial++;
    const fd = new FormData();
    fd.set('_subject', 'Service request from umbradomus.com');
    fd.set('_next', 'https://www.umbradomus.com/request-received');
    fd.set('name', name);
    fd.set('phone', `(956) 555-01${String(40 + serial).padStart(2, '0')}`);
    fd.set('address', `${210 + serial} Almendro Court, Brownsville`);
    fd.set('email', `page.fixture${serial}@example.com`);
    fd.set('service', 'Drywall & Paint');
    fd.set('what', `${words} (page fixture ${serial})`);
    fd.set('email_sent', 'yes');
    const r = await fetch(`${base}/intake`, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
    const id = new URL(r.headers.get('location')).searchParams.get('id');
    if (!id) throw new Error('fixture submission failed for ' + name);
    await fetch(`${base}/admin/seen/${id}?k=${ADMIN_KEY}`, { method: 'POST', headers: { 'x-umbra-test-now': iso } });
    return id;
  }
  const Q = (version, windows, extra = {}) => ({
    version, price: 225, price_note: '5 hours at $45',
    scope: ['Cut out the soft drywall under the window and patch it', 'Match the orange-peel texture and paint the wall'],
    included: 'Primer, paint and cleanup included.',
    guarantee: 'If anything is not right, I come back and fix it.',
    insurance: 'Insured: $1M general liability.',
    windows, lang: 'en', ...extra,
  });
  /** A request, a quote, the quote marked sent: the code a text would carry. */
  async function quoted(name, words, windows, { sentAt = T10, extra = {}, base = W } = {}) {
    const id = await submitAt(CT(...WED, 9, 0), name, words, base);
    const c = await create(id, Q(1, windows, extra), sentAt, base);
    if (c.status !== 201) throw new Error(`quote for ${name} refused: ${c.status} ${JSON.stringify(c.body)}`);
    const s = await sentQ(id, 1, sentAt, base);
    if (s.status !== 200) throw new Error(`/sent for ${name} refused: ${s.status} ${JSON.stringify(s.body)}`);
    codes.push(c.body.code);
    return { id, code: c.body.code, url: c.body.url };
  }

  /* ---------------------------------------------------------------- the browser */
  async function tab(now, { width = 390, js = true, blockCss = false } = {}) {
    const p = await browser.newPage();
    await p.setViewport({ width, height: width <= 420 ? 844 : 900 });
    await p.setExtraHTTPHeaders({ 'x-umbra-test-now': now });
    await p.setJavaScriptEnabled(js);
    p._blocked = [];
    p._console = [];
    p.on('console', (m) => p._console.push(m.type() + ': ' + m.text()));
    if (blockCss) {
      await p.setRequestInterception(true);
      p.on('request', (r) => { if (r.url().includes('/assets/site.css')) { p._blocked.push(r.url()); r.abort(); } else r.continue(); });
    }
    return p;
  }
  const html = (p) => p.content();
  async function shot(p, file) {
    /* site.css cross-fades page to page (@view-transition, 180 ms): let it finish, or the picture shows both */
    await p.bringToFront();
    await sleep(600);
    await p.screenshot({ path: path.join(PIC, file), fullPage: true });
    return file;
  }
  async function clickAndWait(p, selector) {
    /* A background tab drops CDP clicks (reading (5) keeps two tabs open): front the one being tapped. */
    await p.bringToFront();
    try {
      await Promise.all([p.waitForNavigation({ waitUntil: 'load', timeout: 15000 }), p.click(selector)]);
    } catch (err) {
      console.log('DIAG click failed:', err.message);
      console.log('DIAG url now:', p.url());
      console.log('DIAG console:', JSON.stringify(p._console));
      console.log('DIAG button:', JSON.stringify(await p.evaluate((sel) => { const b = document.querySelector(sel); if (!b) return null; const r = b.getBoundingClientRect(); const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { r: [r.x, r.y, r.width, r.height], inner: innerHeight, at: at && at.outerHTML.slice(0, 80), form: b.form && b.form.getAttribute('action') }; }, selector).catch((e) => 'eval failed ' + e.message)));
      console.log('DIAG proxy tail:', JSON.stringify(sw.proxyLog.slice(-4).map((e) => ({ m: e.method, u: e.url.replace(/[A-Za-z0-9]{22}/, '<c>'), s: e.status, err: e.error, ct: e.headers['content-type'], cl: e.headers['content-length'], o: e.headers.origin }))));
      console.log('DIAG wrangler tail:', wlogRef().slice(-1500));
      throw err;
    }
    const b = await html(p);
    bodies.push(b);
    return b;
  }
  const proxied = (code, method) => sw.proxyLog.filter((e) => e.method === method && e.url.startsWith('/q/' + code));

  /* ============================================================ (2) */
  suite('I · (2) GET twice: OPEN, only the view count moves, the headers, a generic title, no contact details');
  const P1 = await quoted('Rosalind Ferro', 'Soft drywall under the den window, about a foot square', [win('2026-10-12', '08:00', '10:00')]);
  {
    const row0 = (await rowsOf(P1.id))[0];
    const rec0 = await rawRecord(P1.id);
    const bk0 = JSON.stringify(await bookingsOn('2026-10-12'));
    const g1 = await getQ(P1.code, CT(...WED, 10, 30));
    const g2 = await getQ(P1.code, CT(...WED, 10, 31));
    const row2 = (await rowsOf(P1.id))[0];
    const rec2 = await rawRecord(P1.id);
    eq(g1.status, 200, 'first GET answers 200');
    eq(stateOf(g1.text), 'open', 'first GET shows OPEN');
    eq(stateOf(g2.text), 'open', 'second GET shows OPEN');
    eq(row0.views, 0, "the book row's views start at 0");
    eq(row2.views, 2, "the book row's views = 2 after two GETs");
    eq(minusViews(row2), minusViews(row0), 'nothing else on the book row changed (every column but views / last_view_at)');
    eq(JSON.stringify(await bookingsOn('2026-10-12')), bk0, 'the bookings table is unchanged');
    eq(rec2, rec0, 'the KV record is byte-identical before and after');
    const HDR = ['cache-control', 'x-robots-tag', 'referrer-policy', 'x-frame-options', 'content-security-policy'];
    const want = {
      'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    };
    for (const k of HDR) eq(g1.headers[k], want[k], `header ${k}: ${want[k]}`);
    eq(titleOf(g1.text), 'Your quote from Umbra Domus', 'the <title> is generic');
    const og = /<meta property="og:title" content="([^"]*)">/.exec(g1.text);
    eq(og && og[1], 'Your quote from Umbra Domus', 'the preview title tag is the same generic line');
    const t = textOf(g1.text);
    const contact = {
      phone: /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/.test(t) || /tel:|sms:/i.test(g1.text),
      email: /[\w.+-]+@[\w-]+\.[\w.]+/.test(t) || /mailto:/i.test(g1.text),
      address: /Almendro Court|\b\d+\s+\w+\s+(Street|St|Court|Ct|Lane|Ln|Avenue|Ave|Road|Rd|Drive|Dr)\b/i.test(t),
      customer_last_name: /Ferro/.test(t),
    };
    eq(JSON.stringify(contact), JSON.stringify({ phone: false, email: false, address: false, customer_last_name: false }), 'no phone number, email or address in the page text (grep)', JSON.stringify(contact));
    ok(t.includes('Hi Rosalind,'), '"Hi <first name>," — the first name only');
    ok(t.includes("We're holding this time for you until Fri, Sep 25 at 10:00 AM."), 'the hold line reads the quote\'s hold_until in words');
    ok(t.includes('Mon, Oct 12 · arrival between 8 and 10 AM'), 'the one window, in words');
    ok(t.includes('$225') && t.includes('5 hours at $45') && t.includes('Primer, paint and cleanup included.'), 'the one price, its note and the included line');
    ok(t.includes('Accept & confirm') && t.includes('None of these times work'), 'both buttons');
    ok(t.includes('Accepting books this visit at the price above. Questions? Reply to our text.'), 'the small print');
    eq(/<script/i.test(g1.text), false, 'no <script> anywhere on the page');
    R['2'] = {
      job: P1.id, get1: { status: g1.status, state: stateOf(g1.text) }, get2: { status: g2.status, state: stateOf(g2.text) },
      views_before: row0.views, views_after: row2.views, last_view_at: row2.last_view_at,
      book_row_other_columns_unchanged: minusViews(row2) === minusViews(row0), kv_record_byte_identical: rec2 === rec0,
      kv_record_sha256: crypto.createHash('sha256').update(rec2).digest('hex'),
      headers: Object.fromEntries(HDR.map((k) => [k, g1.headers[k]])), title: titleOf(g1.text), og_title: og && og[1],
      contact_grep: contact, page_text: t,
    };
  }

  /* ============================================================ (3) */
  suite('I · (3) link previews: five agents, only the view count moves');
  {
    const AGENTS = [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.140 Safari/537.36 Edge/18.17763 (Microsoft Safe Links scan)',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    ];
    const out = [];
    for (const [i, ua] of AGENTS.entries()) {
      const r0 = (await rowsOf(P1.id))[0];
      const k0 = await rawRecord(P1.id);
      const g = await getQ(P1.code, CT(...WED, 10, 40 + i), { 'user-agent': ua });
      const r1 = (await rowsOf(P1.id))[0];
      const k1 = await rawRecord(P1.id);
      const good = g.status === 200 && stateOf(g.text) === 'open' && r1.views === r0.views + 1 && minusViews(r1) === minusViews(r0) && k1 === k0;
      ok(good, `${ua.split(/[ /]/)[0]}${/Safe Links/.test(ua) ? ' (Safe Links)' : ''}: OPEN, views ${r0.views} → ${r1.views}, row and KV otherwise unchanged`);
      out.push({ agent: ua, status: g.status, state: stateOf(g.text), views: `${r0.views} → ${r1.views}`, row_otherwise_unchanged: minusViews(r1) === minusViews(r0), kv_identical: k1 === k0 });
    }
    eq((await bookingsOn('2026-10-12')).length, 0, 'still no booking on that day');
    R['3'] = out;
  }

  /* picture 1 and 12 (after the readings that count views) */
  {
    const p = await tab(CT(...WED, 10, 50));
    await p.goto(qurl(P1.code), { waitUntil: 'load' });
    await shot(p, '1-open.png');
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(qurl(P1.code), { waitUntil: 'load' });
    await shot(p, '12-open-1280.png');
    await p.close();
  }

  /* ============================================================ (4) + (5) */
  suite('I · (4) Accept & confirm clicked in the browser at 10:00 AM → BOOKED, one booking, the stamp, one push each');
  const freed = [];
  {
    /* Suite H leaves a job holding Tue 9/29 8–10. The ignite names that time for this reading, so the holder
       is withdrawn first through the admin route (the Flux Capacitor's own cancel) and named in the readings. */
    for (const b of await bookingsOn('2026-09-29')) {
      if (b.start_min < 600 && b.end_min > 480) {
        const c = await cancelQ(b.job_id, b.version, CT(...WED, 9, 55));
        freed.push({ job: b.job_id, version: b.version, window: `${b.start_min}-${b.end_min}`, cancel: c.status });
      }
    }
    ok(freed.every((f) => f.cancel === 200), "suite H's holder of 9/29 8–10 withdrawn first", JSON.stringify(freed));
  }
  const P2 = await quoted('Teo Vance', 'Nail pops and a water ring on the hall ceiling', [win('2026-09-29', '08:00', '10:00')]);
  {
    const po0 = pushesFor(P2.id);
    const p = await tab(T10);
    const second = await tab(T10);                  /* a second tab opened on the same link, before the tap */
    await p.goto(qurl(P2.code), { waitUntil: 'load' });
    await second.goto(qurl(P2.code), { waitUntil: 'load' });
    const before = textOf(await html(p));
    ok(before.includes('Tue, Sep 29 · arrival between 8 and 10 AM'), '"Tue, Sep 29 · arrival between 8 and 10 AM"');
    const posts0 = proxied(P2.code, 'POST').length;
    const after = await clickAndWait(p, 'button.qgo');
    const post = proxied(P2.code, 'POST')[posts0];
    eq(stateOf(after), 'booked', 'the page after the tap is BOOKED');
    const at = textOf(after);
    ok(at.includes("You're booked.") && at.includes('Tue, Sep 29') && at.includes('arrival between 8 and 10 AM') && at.includes('$225') && at.includes("We'll text you to confirm."),
      'BOOKED names the day, the window, the price and "We\'ll text you to confirm."');
    eq(post && post.status, 303, 'the tap was one POST answered 303');
    eq(post && post.response_headers.location, '/q/' + P2.code, 'with the relative Location /q/<code>');
    if (post) redirects.push({ via: 'browser (proxy log)', method: 'POST', path: post.url, location: post.response_headers.location, headers: post.response_headers });
    const origin = post && post.headers.origin;
    eq(origin, SITE, 'the real click carried Origin = the site\'s own origin');
    const bk = (await bookingsOn('2026-09-29')).filter((b) => b.start_min === 480);
    eq(bk.length, 1, 'one booking row for Tue 9/29 8–10');
    eq(bk[0] && bk[0].job_id, P2.id, "and it is this job's");
    const rec = await record(P2.id);
    eq(rec.status, 'scheduled', 'the record: status scheduled');
    eq(rec.scheduled_for, '2026-09-29T13:00:00.000Z', 'the record: scheduled_for 13:00Z (8:00 AM CDT on 9/29)');
    eq(rec.accept && rec.accept.by, 'page', 'the record: accept.by "page"');
    const po1 = pushesFor(P2.id);
    eq(po1.pushover.length - po0.pushover.length, 1, 'exactly 1 Pushover (fake)');
    eq(po1.telegram.length - po0.telegram.length, 1, 'exactly 1 Telegram (fake)');
    await shot(p, '3-booked.png');
    R['4'] = {
      freed_first: freed, job: P2.id, origin_header_the_click_carried: origin, sec_fetch_site: post && post.headers['sec-fetch-site'],
      post_status: post && post.status, location: post && post.response_headers.location, page_after: stateOf(after),
      bookings_on_9_29_8_10: bk.map((b) => ({ job: b.job_id, version: b.version, start_min: b.start_min, end_min: b.end_min })),
      record: { status: rec.status, scheduled_for: rec.scheduled_for, scheduled_at: rec.scheduled_at, accepted_at: rec.accepted_at, accept: rec.accept },
      pushes: po1, page_text_after: at,
    };

    suite('I · (5) a second tap, and the form re-posted with curl → BOOKED; still one booking and one push');
    const posts1 = proxied(P2.code, 'POST').length;
    const again = await clickAndWait(second, 'button.qgo');
    const post2 = proxied(P2.code, 'POST')[posts1];
    eq(stateOf(again), 'booked', 'the stale second tab, tapped after the booking → BOOKED');
    eq(post2 && post2.status, 303, 'its POST answered 303');
    if (post2) redirects.push({ via: 'browser (proxy log)', method: 'POST', path: post2.url, location: post2.response_headers.location, headers: post2.response_headers });
    /* curl, as a person re-sending the form would: the same fields, the site's own origin */
    let curlOut = '';
    try {
      /* async: the site server that curl talks to runs in this very process, so a synchronous call would deadlock */
      curlOut = await new Promise((resolve, reject) => execFile('curl', ['-s', '-S', '-i', '--noproxy', '*', '-m', '15', '-X', 'POST', '-H', `Origin: ${SITE}`, '-H', `x-umbra-test-now: ${CT(...WED, 10, 5)}`,
        '-H', 'Content-Type: application/x-www-form-urlencoded', '--data', 'v=1', qurl(P2.code)], { encoding: 'utf8', timeout: 20000 }, (err, out, errOut) => (err ? reject(Object.assign(err, { stdout: out, stderr: errOut })) : resolve(out))));
    } catch (err) { curlOut = 'curl failed: ' + err.message + ' | stdout ' + (err.stdout || '') + ' | stderr ' + (err.stderr || ''); console.log('DIAG curl:', curlOut.slice(0, 1500)); }
    const curlStatus = (/^HTTP\/[\d.]+ (\d{3})/m.exec(curlOut) || [])[1];
    const curlLoc = (/^location: (.*)$/im.exec(curlOut) || [])[1];
    eq(curlStatus, '303', 'curl re-post → 303');
    eq(curlLoc && curlLoc.trim(), '/q/' + P2.code, 'with the relative Location');
    redirects.push({ via: 'curl', method: 'POST', path: '/q/' + P2.code, location: curlLoc && curlLoc.trim(), raw: curlOut.split(/\r?\n\r?\n/)[0].replace(P2.code, '<code>') });
    const g = await getQ(P2.code, CT(...WED, 10, 6));
    eq(stateOf(g.text), 'booked', 'and the page then shows BOOKED');
    const bk2 = (await bookingsOn('2026-09-29')).filter((b) => b.start_min === 480);
    eq(bk2.length, 1, 'still one booking row');
    const po2 = pushesFor(P2.id);
    eq(po2.pushover.length, po1.pushover.length, 'still one Pushover');
    eq(po2.telegram.length, po1.telegram.length, 'still one Telegram');
    R['5'] = {
      second_tab: { status: post2 && post2.status, page: stateOf(again) },
      curl: { status: curlStatus, location: curlLoc && curlLoc.trim(), headers: curlOut.split(/\r?\n\r?\n/)[0].split(/\r?\n/).map((l) => l.replace(P2.code, '<code>')) },
      page_after_curl: stateOf(g.text), booking_rows: bk2.length, pushover: po2.pushover.length, telegram: po2.telegram.length,
    };
    await p.close();
    await second.close();
  }

  /* ============================================================ (6) */
  suite('I · (6) the origin rules: foreign Origin, "null", cross-site → 403, nothing written; neither header → allowed');
  const P3 = await quoted('Marisol Quintero', 'Two cracked corners above the bedroom door', [win('2026-10-13', '08:00', '10:00')]);
  {
    const snap = async () => JSON.stringify({ row: (await rowsOf(P3.id))[0], rec: await rawRecord(P3.id), bk: await bookingsOn('2026-10-13'), po: pushesFor(P3.id) });
    const s0 = await snap();
    const now = CT(...WED, 11, 0);
    const cases = [
      ['Origin https://evil.example', { origin: 'https://evil.example', 'sec-fetch-site': null }],
      ['Origin null', { origin: 'null', 'sec-fetch-site': null }],
      ['Sec-Fetch-Site cross-site (no Origin)', { origin: null, 'sec-fetch-site': 'cross-site' }],
      ['Origin https://evil.example on /none', { origin: 'https://evil.example', 'sec-fetch-site': null }, '/none'],
      ['Origin https://evil.example on an unknown code (the check runs before the lookup)', { origin: 'https://evil.example', 'sec-fetch-site': null }, '', 'AAAAAAAAAAAAAAAAAAAAAA'],
    ];
    const out = [];
    for (const [label, hdr, tail = '', code = P3.code] of cases) {
      const r = await postQ(code, { v: 1 }, now, hdr, tail);
      eq(r.status, 403, `${label} → 403`);
      out.push({ case: label, status: r.status, state: stateOf(r.text), csp: r.headers['content-security-policy'] ? 'present' : 'missing' });
    }
    const unchanged = (await snap()) === s0;
    ok(unchanged, 'nothing written on any 403: the book row (views too), the KV record, the bookings, the pushes');
    const allowed = await postQ(P3.code, { v: 1 }, now, { origin: null, 'sec-fetch-site': null });
    eq(allowed.status, 303, 'neither header → allowed (303)');
    const g = await getQ(P3.code, CT(...WED, 11, 1));
    eq(stateOf(g.text), 'booked', 'and it booked');
    R['6'] = { job: P3.id, refused: out, nothing_written_on_403: unchanged, neither_header: { status: allowed.status, location: allowed.headers.location, page_after: stateOf(g.text) } };
  }

  /* ============================================================ (7) */
  suite('I · (7) versions: v2 created → UPDATING; v2 sent → REPLACED; v1 re-posted → REPLACED, nothing booked');
  const P4 = await quoted('Dmitri Hale', 'A dented closet door jamb and the wall beside it', [win('2026-10-14', '08:00', '10:00')]);
  {
    const v2 = await create(P4.id, Q(2, [win('2026-10-14', '10:00', '12:00')], { price: 260 }), CT(...WED, 11, 10));
    eq(v2.status, 201, 'v2 created');
    const u = await getQ(P4.code, CT(...WED, 11, 11));
    eq(stateOf(u.text), 'updating', "v1's page: UPDATING");
    ok(textOf(u.text).includes("We're updating this quote. You'll get a new text from us shortly."), 'in those words');
    await sentQ(P4.id, 2, CT(...WED, 11, 20));
    const rp = await getQ(P4.code, CT(...WED, 11, 21));
    eq(stateOf(rp.text), 'replaced', "v2 marked sent → v1's page: REPLACED");
    ok(textOf(rp.text).includes('This quote was replaced. Use the link in our latest text.'), 'in those words');
    const re = await postQ(P4.code, { v: 1 }, CT(...WED, 11, 22));
    eq(re.status, 303, "v1's form re-posted → 303");
    const after = await getQ(P4.code, CT(...WED, 11, 23));
    eq(stateOf(after.text), 'replaced', 'and the page says REPLACED');
    eq((await bookingsOn('2026-10-14')).length, 0, 'nothing booked');
    eq((await record(P4.id)).accept || null, null, 'the record carries no accept');
    const p = await tab(CT(...WED, 11, 24));
    await p.goto(qurl(P4.code), { waitUntil: 'load' });
    await shot(p, '7-replaced.png');
    await p.close();
    codes.push(v2.body.code);
    R['7'] = { job: P4.id, v2_created: v2.status, v1_after_v2_created: stateOf(u.text), v1_after_v2_sent: stateOf(rp.text), v1_repost: re.status, v1_after_repost: stateOf(after.text), bookings_on_10_14: 0 };
  }

  /* ============================================================ (8) */
  suite('I · (8) two windows: no choice → OPEN again, "Pick one of the times", nothing written; the 2nd → booked 2');
  const P5 = await quoted('Ines Okafor', 'Patch where a shelf pulled out of the kitchen wall', [win('2026-10-15', '08:00', '10:00'), win('2026-10-16', '13:00', '15:00')]);
  {
    const p = await tab(CT(...WED, 11, 30));
    await p.goto(qurl(P5.code), { waitUntil: 'load' });
    const h0 = await html(p);
    const group = await p.evaluate(() => {
      const fs = document.querySelector('fieldset.qpick');
      const radios = [...document.querySelectorAll('input[type=radio][name=w]')];
      return {
        legend: fs && fs.querySelector('legend') && fs.querySelector('legend').textContent,
        radios: radios.length, checked: radios.filter((r) => r.checked).length,
        required: radios.every((r) => r.required),
        labels: radios.map((r) => r.closest('label') && r.closest('label').textContent.trim()),
      };
    });
    eq(group.legend, 'Pick your time', 'the radio group is labelled "Pick your time"');
    eq(group.radios, 2, 'two choices');
    eq(group.checked, 0, 'no default: none is checked');
    ok(!/\bchecked\b/.test(h0.replace(/<style[\s\S]*?<\/style>/, '')), 'the markup carries no "checked" at all');
    ok(textOf(h0).includes("We're holding these times for you until Fri, Sep 25 at 10:00 AM."), '"these times" with two');
    await shot(p, '2-two-times.png');
    /* the browser's own required check: tapping Accept with nothing picked sends nothing */
    const n0 = proxied(P5.code, 'POST').length;
    await p.click('button.qgo');
    await sleep(700);
    eq(proxied(P5.code, 'POST').length, n0, 'in the browser, Accept with nothing picked sends no post (required)');
    /* the server's own check: a post with no w */
    const snap = async () => JSON.stringify({ row: minusViews((await rowsOf(P5.id))[0]), rec: await rawRecord(P5.id), a: await bookingsOn('2026-10-15'), b: await bookingsOn('2026-10-16'), po: pushesFor(P5.id) });
    const s0 = await snap();
    const none = await postQ(P5.code, { v: 1 }, CT(...WED, 11, 31));
    eq(none.status, 303, 'a post with no choice → 303');
    eq(none.headers.location, '/q/' + P5.code + '?pick=1', 'back to the page, asking again (?pick=1)');
    const back = await getQ(P5.code, CT(...WED, 11, 32), {}, SITE);
    const again = await req('GET', qurl(P5.code, '?pick=1'), { headers: { 'x-umbra-test-now': CT(...WED, 11, 32) } });
    eq(stateOf(again.text), 'open pick', 'OPEN again');
    ok(textOf(again.text).includes('Pick one of the times.'), '"Pick one of the times."');
    eq(await snap(), s0, 'nothing written (the book row but its view count, the record, both days, the pushes)');
    /* choose the second, in the browser */
    await p.goto(qurl(P5.code), { waitUntil: 'load' });
    await p.click('input[type=radio][name=w][value="2"]');
    const booked = await clickAndWait(p, 'button.qgo');
    eq(stateOf(booked), 'booked', 'choosing the 2nd → BOOKED');
    ok(textOf(booked).includes('Fri, Oct 16') && textOf(booked).includes('arrival between 1 and 3 PM'), 'BOOKED names window 2: Fri, Oct 16, 1–3 PM');
    const rec = await record(P5.id);
    eq(rec.accept && rec.accept.window && rec.accept.window.date, '2026-10-16', 'the record: accept.window is the 2nd (10/16)');
    eq((await bookingsOn('2026-10-15')).length, 0, 'nothing on the 1st window\'s day');
    await p.close();
    R['8'] = { job: P5.id, group, no_choice: { status: none.status, location: none.headers.location && none.headers.location.replace(P5.code, '<code>'), page: stateOf(again.text) }, nothing_written: true, chose_second: { page: stateOf(booked), accept: rec.accept }, plain_get_between: stateOf(back.text) };
  }

  /* ============================================================ (9) */
  suite('I · (9) TAKEN on a plain GET: another job booked one offered time; only the free one is offered');
  const P6 = await quoted('Walt Brennan', 'Garage wall patch where the old panel came off', [win('2026-10-19', '08:00', '10:00'), win('2026-10-20', '08:00', '10:00')]);
  const P7 = await quoted('Priya Lund', 'Popcorn ceiling repair over the stairs', [win('2026-10-19', '08:00', '10:00')]);
  const P8 = await quoted('Lucia Ortega', 'Hairline crack along the living room ceiling seam', [win('2026-10-19', '09:00', '11:00')]);
  {
    const b7 = await acceptText(P7.id, 1, 1, CT(...WED, 12, 0));
    eq(b7.status, 200, 'another job (P7) books Mon 10/19 8–10 by text');
    const g = await getQ(P6.code, CT(...WED, 12, 5));
    eq(stateOf(g.text), 'taken', 'the other quote\'s plain GET → TAKEN');
    const t = textOf(g.text);
    ok(t.includes('That time was just booked.'), '"That time was just booked."');
    ok(t.includes('Tue, Oct 20 · arrival between 8 and 10 AM') && !t.includes('Mon, Oct 19'), 'only the free window (Tue 10/20) is offered');
    eq((g.text.match(/type="radio"/g) || []).length, 0, 'no choice to make: no radio');
    ok(/<input type="hidden" name="w" value="2">/.test(g.text), 'the form names window 2');
    const p = await tab(CT(...WED, 12, 6));
    await p.goto(qurl(P6.code), { waitUntil: 'load' });
    await shot(p, '5-taken.png');
    const booked = await clickAndWait(p, 'button.qgo');
    eq(stateOf(booked), 'booked', 'and tapping it books the free window');
    eq((await record(P6.id)).accept.window.date, '2026-10-20', 'window 2 (10/20)');
    await p.close();
    const g8 = await getQ(P8.code, CT(...WED, 12, 10));
    eq(stateOf(g8.text), 'taken', 'a quote whose only time overlaps it → TAKEN');
    ok(textOf(g8.text).includes("That time was just booked.") && textOf(g8.text).includes("Reply to our text and we'll find you another time."), 'with no time free: "Reply to our text and we\'ll find you another time."');
    eq(/<form/.test(g8.text), false, 'and no button');
    R['9'] = { job: P6.id, other_job: P7.id, page: stateOf(g.text), offered: t.match(/(Mon|Tue), Oct \d+ · arrival between [^.]*?(AM|PM)/g), then_booked: (await record(P6.id)).accept.window, no_free_job: P8.id, no_free_page: stateOf(g8.text), no_free_text: textOf(g8.text) };
  }

  /* ============================================================ (10) */
  suite('I · (10) HOLD ENDED BUT OPEN, and accept works; TOO CLOSE at the cutoff, and a re-post books nothing');
  const P9 = await quoted('Hector Ames', 'Doorknob hole behind the bathroom door', [win('2026-10-22', '08:00', '10:00')]);
  const P10 = await quoted('Selma Voss', 'Water-stained patch on the laundry room ceiling', [win('2026-10-23', '08:00', '10:00')]);
  {
    const sat = CT(2026, 9, 26, 12, 0);
    const g = await getQ(P9.code, sat);
    eq(stateOf(g.text), 'hold_ended', 'after hold_until, before the cutoff → HOLD ENDED BUT OPEN');
    ok(textOf(g.text).includes("Our hold on this time has ended, but it's still open.") && !textOf(g.text).includes("We're holding"), 'the hold line replaced by "Our hold on this time has ended, but it\'s still open."');
    const p = await tab(sat);
    await p.goto(qurl(P9.code), { waitUntil: 'load' });
    await shot(p, '4-hold-ended.png');
    const booked = await clickAndWait(p, 'button.qgo');
    eq(stateOf(booked), 'booked', 'and Accept books it');
    await p.close();
    const cutoff = (await rowsOf(P10.id))[0].cutoff;
    eq(cutoff, CT(2026, 10, 21, 21, 0), 'P10\'s cutoff is Wed 10/21 9:00 PM Central');
    const tc = await getQ(P10.code, cutoff);
    eq(stateOf(tc.text), 'too_close', 'at the cutoff → TOO CLOSE');
    ok(textOf(tc.text).includes("This time is too close for us to prepare. Reply to our text and we'll find another."), 'in those words');
    const p2 = await tab(cutoff);
    await p2.goto(qurl(P10.code), { waitUntil: 'load' });
    await shot(p2, '6-too-close.png');
    await p2.close();
    const s0 = JSON.stringify({ rec: await rawRecord(P10.id), bk: await bookingsOn('2026-10-23') });
    const re = await postQ(P10.code, { v: 1 }, cutoff);
    eq(re.status, 303, 'the form re-posted at the cutoff → 303');
    eq(stateOf((await getQ(P10.code, cutoff)).text), 'too_close', 'and the page still says TOO CLOSE');
    eq(JSON.stringify({ rec: await rawRecord(P10.id), bk: await bookingsOn('2026-10-23') }), s0, 'nothing booked, the record unchanged');
    R['10'] = { hold_ended: { job: P9.id, at: sat, page: stateOf(g.text), then: stateOf(booked) }, too_close: { job: P10.id, cutoff, page: stateOf(tc.text), repost: re.status, booked: 0 } };
  }

  /* ============================================================ (11) */
  suite('I · (11) None of these times work → RECEIVED; one push; a second post → no second push');
  const P11 = await quoted('Omar Castell', 'Loose tape along the hallway ceiling joint', [win('2026-10-24', '08:00', '10:00')]);
  {
    const n1 = await postQ(P11.code, { v: 1 }, CT(...WED, 13, 0), {}, '/none');
    eq(n1.status, 303, 'None → 303');
    eq(n1.headers.location, '/q/' + P11.code, 'Location /q/<code>');
    const g = await getQ(P11.code, CT(...WED, 13, 1));
    eq(stateOf(g.text), 'received', 'the page: RECEIVED');
    ok(textOf(g.text).includes("Got it. We'll text you some other times."), 'in those words');
    const a = pushesFor(P11.id);
    eq(a.pushover.length, 1, 'one Pushover');
    eq(a.telegram.length, 1, 'one Telegram');
    const n2 = await postQ(P11.code, { v: 1 }, CT(...WED, 13, 2), {}, '/none');
    eq(n2.status, 303, 'a second None → 303');
    const b = pushesFor(P11.id);
    eq(b.pushover.length, 1, 'no second Pushover');
    eq(b.telegram.length, 1, 'no second Telegram');
    R['11'] = { job: P11.id, first: n1.status, page: stateOf(g.text), pushes: a, second: n2.status, pushes_after_second: b };
  }

  /* ============================================================ (12) */
  suite('I · (12) WITHDRAWN after a cancel; NOT VALID (404) for an unknown code and a mistyped one — the same page');
  const P12 = await quoted('Greta Solis', 'Scuffed and gouged wall behind the couch', [win('2026-10-26', '08:00', '10:00')]);
  {
    eq((await cancelQ(P12.id, 1, CT(...WED, 13, 10))).status, 200, 'the quote is cancelled (admin)');
    const w = await getQ(P12.code, CT(...WED, 13, 11));
    eq(stateOf(w.text), 'withdrawn', 'its page: WITHDRAWN');
    ok(textOf(w.text).includes('This quote was withdrawn. Reply to our text with any questions.'), 'in those words');
    const p = await tab(CT(...WED, 13, 12));
    await p.goto(qurl(P12.code), { waitUntil: 'load' });
    await shot(p, '8-withdrawn.png');
    const flip = (c) => c.slice(0, -1) + (c.slice(-1) === 'z' ? 'y' : 'z');
    const variants = [['never existed (22 A\'s)', 'AAAAAAAAAAAAAAAAAAAAAA'], ['mistyped (last character changed)', flip(P1.code)], ['mistyped (one character short)', P1.code.slice(0, -1)], ['not base62', P1.code.slice(0, -1) + '-']];
    const got = [];
    for (const [label, c] of variants) {
      const r = await getQ(c, CT(...WED, 13, 13));
      got.push({ label, status: r.status, state: stateOf(r.text), sha256: crypto.createHash('sha256').update(r.text).digest('hex'), cache: r.headers['cache-control'], robots: r.headers['x-robots-tag'] });
      eq(r.status, 404, `${label} → 404`);
    }
    eq(new Set(got.map((g) => g.sha256)).size, 1, 'every one is the same page, byte for byte');
    const nv = await getQ('AAAAAAAAAAAAAAAAAAAAAA', CT(...WED, 13, 14));
    ok(textOf(nv.text).includes("This link isn't valid. Check the link in our text, or reply to it."), '"This link isn\'t valid. Check the link in our text, or reply to it."');
    await p.goto(qurl('AAAAAAAAAAAAAAAAAAAAAA'), { waitUntil: 'load' });
    await shot(p, '9-not-valid.png');
    await p.close();
    R['12'] = { withdrawn: { job: P12.id, page: stateOf(w.text) }, not_valid: got };
  }

  /* ============================================================ (13) */
  suite('I · (13) JavaScript switched off in the browser: OPEN renders and Accept books');
  const P13 = await quoted('Nell Tarrant', 'Two anchor holes and a torn paper face in the office', [win('2026-10-27', '08:00', '10:00')]);
  {
    const p = await tab(CT(...WED, 14, 0), { js: false });
    await p.goto(qurl(P13.code), { waitUntil: 'load' });
    const h0 = await html(p);
    eq(stateOf(h0), 'open', 'OPEN renders with JavaScript off');
    ok(textOf(h0).includes('Accept & confirm'), 'the button is there');
    const booked = await clickAndWait(p, 'button.qgo');
    eq(stateOf(booked), 'booked', 'Accept books it with JavaScript off');
    eq((await record(P13.id)).status, 'scheduled', 'the record is stamped scheduled');
    await p.close();
    R['13'] = { job: P13.id, javascript: 'disabled (page.setJavaScriptEnabled(false))', open: stateOf(h0), after_tap: stateOf(booked) };
  }

  /* ============================================================ (14) */
  suite('I · (14) 390 px: no sideways scroll, every target ≥ 44 px, keyboard-only accept; stylesheet blocked still reads in order');
  const P14 = await quoted('Farah Delacroix', 'Corner bead dented by the hallway closet', [win('2026-10-28', '08:00', '10:00'), win('2026-10-29', '08:00', '10:00')]);
  {
    const measure = (p) => p.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const targets = [...document.querySelectorAll('button, a[href], .qpick label')].map((el) => ({ what: el.tagName.toLowerCase() + (el.className ? '.' + el.className : ''), w: Math.round(r(el).width), h: Math.round(r(el).height), text: el.textContent.trim().slice(0, 40) }));
      return { scrollWidth: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth, innerWidth: window.innerWidth, targets };
    });
    const p = await tab(CT(...WED, 14, 10));
    await p.goto(qurl(P14.code), { waitUntil: 'load' });
    const m = await measure(p);
    ok(m.scrollWidth <= 390 && m.bodyScroll <= 390, 'no sideways scroll at 390 px', `scrollWidth ${m.scrollWidth}, body ${m.bodyScroll}`);
    const small = m.targets.filter((t) => t.h < 44 || t.w < 44);
    eq(small.length, 0, 'every target is at least 44 × 44 px', JSON.stringify(small));
    /* keyboard only: Tab to the first time, Arrow Down to the second, Tab to Accept, Enter */
    await p.bringToFront();
    await p.focus('body');
    const keys = [];
    let focus = '';
    for (let i = 0; i < 12; i++) {
      await p.keyboard.press('Tab'); keys.push('Tab');
      focus = await p.evaluate(() => { const a = document.activeElement; return a ? a.tagName + (a.type ? ':' + a.type : '') + (a.value ? '=' + a.value : '') : ''; });
      if (/radio/.test(focus)) break;
    }
    await p.keyboard.press('ArrowDown'); keys.push('ArrowDown');
    const chosen = await p.evaluate(() => { const c = document.querySelector('input[name=w]:checked'); return c ? c.value : null; });
    eq(chosen, '2', 'the arrow key chose the 2nd time');
    for (let i = 0; i < 6; i++) {
      await p.keyboard.press('Tab'); keys.push('Tab');
      focus = await p.evaluate(() => document.activeElement && document.activeElement.className);
      if (focus === 'qgo') break;
    }
    eq(focus, 'qgo', 'Tab reaches Accept & confirm');
    await Promise.all([p.waitForNavigation({ waitUntil: 'load' }), p.keyboard.press('Enter')]);
    keys.push('Enter');
    const after = await html(p);
    eq(stateOf(after), 'booked', 'keyboard alone booked it');
    eq((await record(P14.id)).accept.window.date, '2026-10-29', 'the time the keyboard chose (10/29)');
    await p.close();
    /* the stylesheet blocked */
    const nc = await tab(CT(...WED, 14, 20), { blockCss: true });
    await nc.goto(qurl(P1.code), { waitUntil: 'load' });
    const m2 = await measure(nc);
    const order = await nc.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
    const seq = ['Umbra Domus', 'Your quote from Umbra Domus', 'Hi Rosalind,', "What we'll do", 'Price', '$225', 'When', 'Mon, Oct 12', "We're holding this time", 'Before you accept', 'Accept & confirm', 'None of these times work', 'Accepting books this visit'];
    const pos = seq.map((s) => order.indexOf(s));
    ok(nc._blocked.length >= 1, 'the stylesheet request was blocked', JSON.stringify(nc._blocked));
    ok(pos.every((x, i) => x >= 0 && (i === 0 || x > pos[i - 1])), 'with no stylesheet the page still reads in order', JSON.stringify(seq.map((s, i) => [s, pos[i]])));
    ok(m2.scrollWidth <= 390, 'and has no sideways scroll', `scrollWidth ${m2.scrollWidth}`);
    const small2 = m2.targets.filter((t) => t.h < 44 || t.w < 44);
    eq(small2.length, 0, 'and its buttons are still at least 44 px (inline styles)', JSON.stringify(small2));
    await nc.close();
    R['14'] = { job: P14.id, width: 390, scroll: { documentElement: m.scrollWidth, body: m.bodyScroll }, targets: m.targets, keys, chosen, after: stateOf(after), css_blocked: { blocked: nc._blocked.map((u) => u.replace(/^https?:\/\/[^/]+/, '')), scrollWidth: m2.scrollWidth, order: seq.map((s, i) => [s, pos[i]]), targets: m2.targets } };
  }

  /* ============================================================ (15) */
  suite('I · (15) Spanish: lang "es" → every fixed string Spanish; the REVIEW list complete');
  const ES = {
    scope: ['Resanar los hoyos del techo de la sala y dar textura para que combine', 'Sellar cada parche y retocar la pintura'],
    included: 'Incluye la pintura para igualar el color y la limpieza.',
    guarantee: 'Si algo no queda bien, regreso y lo arreglo.',
    insurance: 'Asegurados: $1M de responsabilidad civil general.',
    price_note: '5 horas a $45', lang: 'es',
  };
  const P15 = await quoted('Rocío Almanza', 'Hoyos en el techo de la sala, tamaño moneda', [win('2026-10-30', '08:00', '10:00'), win('2026-10-31', '11:00', '13:00')], { extra: ES });
  {
    const E = WORDS.en, S = WORDS.es;
    const SENT = String.fromCharCode(1);
    const seen = {};
    const expectIn = (label, h, keys, fillers = {}) => {
      const t = textOf(h);
      for (const k of keys) {
        const es = S[k].replace(/\{(\w+)\}/g, (_, x) => fillers[x] ?? '\u0000');
        const en = E[k].replace(/\{(\w+)\}/g, (_, x) => fillers[x] ?? '\u0000');
        const parts = es.split('\u0000').filter(Boolean);
        const enParts = en.split('\u0000').filter(Boolean);
        const has = parts.every((x) => t.includes(x.trim()));
        const hasEn = enParts.some((x) => x.trim().length > 3 && t.includes(x.trim()));
        seen[k] = (seen[k] || []).concat(label);
        ok(has && !hasEn, `${label}: ${k} is Spanish ("${S[k]}")`, has ? `English still there: "${E[k]}"` : 'Spanish missing');
      }
    };
    const open = await getQ(P15.code, CT(...WED, 15, 0));
    eq(/<html lang="es">/.test(open.text), true, '<html lang="es">');
    eq(titleOf(open.text), S.title, 'the title is the Spanish generic line');
    expectIn('OPEN', open.text, ['title', 'hi_name', 'h_work', 'h_price', 'h_when', 'pick_legend', 'hold_two', 'h_notices', 'accept', 'none', 'small'], { name: 'Rocío' });
    const ot = textOf(open.text);
    ok(ot.includes('vie 30 oct · llegada entre las 8 y las 10 a. m.'), 'the first time in Spanish: "vie 30 oct · llegada entre las 8 y las 10 a. m."');
    ok(ot.includes('sáb 31 oct · llegada entre las 11 a. m. y la 1 p. m.'), 'across noon: "sáb 31 oct · llegada entre las 11 a. m. y la 1 p. m."');
    ok(ot.includes('hasta el vie 25 sept, a las 10:00 a. m.'), 'the hold in Spanish: "hasta el vie 25 sept, a las 10:00 a. m."');
    eq((ot.match(/\.\.(?!\.)/g) || []).length, 0, 'no doubled period anywhere ("a. m." ends its own sentence)');
    seen.when = ['OPEN'];
    ok(ot.includes(LIGHTING_ES.lead + ' ' + LIGHTING_ES.text) && !ot.includes(LIGHTING_EN.text.slice(0, 40)), 'the lighting paragraph in Spanish, not English');
    const p = await tab(CT(...WED, 15, 1));
    await p.goto(qurl(P15.code), { waitUntil: 'load' });
    await shot(p, '10-spanish.png');
    await p.close();
    await postQ(P15.code, { v: 1 }, CT(...WED, 15, 2));
    expectIn('OPEN · no time picked', (await req('GET', qurl(P15.code, '?pick=1'), { headers: { 'x-umbra-test-now': CT(...WED, 15, 3) } })).text, ['pick_error']);
    /* P16: the one-window and the words-only states, in Spanish */
    const P16 = await quoted('Joaquín Ferrán', 'Grietas finas en la esquina del pasillo', [win('2026-10-30', '14:00', '16:00')], { extra: ES });
    expectIn('OPEN · one time', (await getQ(P16.code, CT(...WED, 15, 4))).text, ['hold_one']);
    expectIn('HOLD ENDED · one time', (await getQ(P16.code, CT(2026, 9, 26, 9, 0))).text, ['hold_ended_one']);
    expectIn('HOLD ENDED · two times', (await getQ(P15.code, CT(2026, 9, 26, 9, 0))).text, ['hold_ended_two']);
    await postQ(P15.code, { v: 1, w: 2 }, CT(...WED, 15, 5));
    expectIn('BOOKED', (await getQ(P15.code, CT(...WED, 15, 6))).text, ['h_booked', 'booked_window', 'booked_confirm', 'questions'], { window: 'las 11 a. m. y la 1 p. m.' });
    /* P15 booked 10/31, not 10/30 2–4: P16 is still open; book 10/30 2–4 by text for another job to show TAKEN */
    const P17 = await quoted('Nora Echeverría', 'Parche en la pared de la cocina', [win('2026-10-30', '14:00', '16:00')], { extra: ES });
    await acceptText(P17.id, 1, 1, CT(...WED, 15, 8));
    expectIn('TAKEN · no time free', (await getQ(P16.code, CT(...WED, 15, 9))).text, ['h_taken', 'taken_none']);
    const P18 = await quoted('Ramiro Lozano', 'Dos hoyos detrás de la puerta', [win('2026-10-30', '08:00', '10:00'), win('2026-10-31', '12:00', '14:00')], { extra: ES });
    expectIn('TAKEN · one free', (await getQ(P18.code, CT(...WED, 15, 10))).text, ['h_taken', 'taken_other']);
    const P19 = await quoted('Elena Barrón', 'Marcas en la pared del comedor', [win('2026-11-02', '08:00', '10:00')], { extra: ES });
    const cut19 = (await rowsOf(P19.id))[0].cutoff;
    expectIn('TOO CLOSE', (await getQ(P19.code, cut19)).text, ['h_too_close', 'too_close']);
    await create(P19.id, Q(2, [win('2026-11-02', '10:00', '12:00')], ES), CT(...WED, 15, 11));
    expectIn('UPDATING', (await getQ(P19.code, CT(...WED, 15, 12))).text, ['h_updating', 'updating', 'questions']);
    await sentQ(P19.id, 2, CT(...WED, 15, 13));
    expectIn('REPLACED', (await getQ(P19.code, CT(...WED, 15, 14))).text, ['h_replaced', 'replaced', 'questions']);
    await postQ(P18.code, { v: 1 }, CT(...WED, 15, 15), {}, '/none');
    expectIn('RECEIVED', (await getQ(P18.code, CT(...WED, 15, 16))).text, ['h_received', 'received', 'questions']);
    await cancelQ(P17.id, 1, CT(...WED, 15, 17));
    expectIn('WITHDRAWN', (await getQ(P17.code, CT(...WED, 15, 18))).text, ['h_withdrawn', 'withdrawn']);
    /* the two bilingual pages carry both */
    const nv = textOf((await getQ('AAAAAAAAAAAAAAAAAAAAAA', CT(...WED, 15, 19))).text);
    ok(nv.includes(S.h_not_valid) && nv.includes(S.not_valid) && nv.includes(E.h_not_valid), 'NOT VALID carries the Spanish beside the English');
    const fb = await postQ(P16.code, { v: 1 }, CT(...WED, 15, 20), { origin: 'https://evil.example' });
    ok(textOf(fb.text).includes(S.h_forbidden) && textOf(fb.text).includes(S.forbidden), 'the 403 page carries the Spanish beside the English');
    for (const k of ['h_not_valid', 'not_valid', 'h_forbidden', 'forbidden']) seen[k] = (seen[k] || []).concat('bilingual page');
    const keys = Object.keys(E);
    const missingEs = keys.filter((k) => !(k in S));
    const unexercised = keys.filter((k) => !seen[k] && k !== 'hi' && k !== 'statute_intro');
    eq(missingEs.length, 0, 'every English string has its Spanish');
    eq(unexercised.length, 0, 'every Spanish string was seen on a page (hi and statute_intro are checked in (16) and by hand)', unexercised.join(', '));
    const review = keys.map((k) => ({ key: k, en: E[k], es: S[k] })).concat([{ key: 'lighting (READY-4, translated)', en: LIGHTING_EN.lead + ' ' + LIGHTING_EN.text, es: LIGHTING_ES.lead + ' ' + LIGHTING_ES.text }]);
    fs.writeFileSync(path.join(TMP, 'page-spanish-review.json'), JSON.stringify(review, null, 1));
    R['15'] = { jobs: [P15.id, P16.id, P17.id, P18.id, P19.id], strings: keys.length + 1, seen, review_file: '.tmp/page-spanish-review.json' };
  }

  /* ============================================================ (16) */
  suite('I · (16) the notices: 53255 "false" hides it; lighting matches READY-4 byte for byte; the flags flip each');
  {
    /* the main Worker runs the defaults: NOTICE_LIGHTING unset → "true", NOTICE_53255 unset → "false" */
    const g = await getQ(P1.code, CT(...WED, 16, 0));
    const m = /<p class="qnote" id="notice-lighting"><strong>([^<]*)<\/strong> ([^<]*)<\/p>/.exec(g.text);
    const shown = m ? decode(m[1]) + ' ' + decode(m[2]) : null;
    eq(shown, LIGHTING_EN.lead + ' ' + LIGHTING_EN.text, 'the lighting paragraph shows, exactly the constant');
    eq(crypto.createHash('sha256').update(shown || '').digest('hex'), LIGHTING_SHA256, 'its sha256 is the constant\'s');
    let ready4 = null;
    if (fs.existsSync(READY4)) {
      const src = fs.readFileSync(READY4, 'utf8');
      const r = /<p><strong>Light\.<\/strong> ([^<]*)<\/p>/.exec(src);
      ready4 = r ? 'Light. ' + r[1] : null;
      eq(Buffer.compare(Buffer.from(shown || '', 'utf8'), Buffer.from(ready4 || '', 'utf8')), 0, "the page's lighting paragraph equals READY-4's, byte for byte");
    } else {
      ok(true, `na() — READY-4 is not on this machine (${READY4}); the constant's sha256 stands in`);
    }
    eq(/id="notice-53255"/.test(g.text), false, 'NOTICE_53255 "false" (the default): the §53.255 block is absent');

    /* two more Workers, one after the other on the same ports: the flags are read from env, so each is its own boot */
    const runNotice = async (name, vars) => {
      const DIR = path.join(TMP, 'notice-' + name);
      fs.rmSync(DIR, { recursive: true, force: true });
      fs.mkdirSync(DIR, { recursive: true });
      const WN = `http://127.0.0.1:${PORT_NOTICE_WORKER}`;
      const SN = `http://127.0.0.1:${PORT_NOTICE_SITE}`;
      fs.writeFileSync(path.join(DIR, '.dev.vars'), [
        `ADMIN_KEY=${ADMIN_KEY}`,
        `FORMSUBMIT_ENDPOINT=http://127.0.0.1:${stub.port}/formsubmit`,
        `PUSHOVER_API_BASE=http://127.0.0.1:${stub.port}/pushover-notice`,
        `TELEGRAM_API_BASE=http://127.0.0.1:${stub.port}/telegram-notice`,
        `PUBLIC_BASE_URL=${WN}`, `QUOTE_LINK_BASE=${SN}`,
        'IGNORE_NEXT_ORIGIN=true', 'ALLOW_TEST_HOOKS=true', ...vars, '',
      ].join('\n'));
      const cfg = path.join(DIR, 'wrangler.notice.toml');
      fs.writeFileSync(cfg, `
name = "umbra-intake-notice-test"
main = ${JSON.stringify(path.join(WORKER_DIR, 'src', 'index.js'))}
base_dir = ${JSON.stringify(WORKER_DIR)}
compatibility_date = "2025-06-01"
rules = [ { type = "Text", globs = ["**/*.html"], fallthrough = false } ]

[vars]
SEED_LAST_ID = "700"

[[kv_namespaces]]
binding = "RECORDS"
id = "test-records-notice"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "umbra-job-photos-notice-test"

[[durable_objects.bindings]]
name = "BOOK"
class_name = "QuoteBook"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["QuoteBook"]
`);
      const wr = spawn(process.execPath,
        [path.join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
          'dev', '--config', cfg, '--port', String(PORT_NOTICE_WORKER), '--ip', '127.0.0.1',
          '--inspector-port', String(PORT_NOTICE_INSPECTOR),
          '--local', '--log-level', 'warn', '--persist-to', path.join(DIR, 'state')],
        { cwd: WORKER_DIR, env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let wlog = '';
      wr.stdout.on('data', (d) => { wlog += d; }); wr.stderr.on('data', (d) => { wlog += d; });
      let up = false;
      for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(WN + '/health')).ok; } catch (e) { /* not yet */ } if (!up) await sleep(500); }
      ok(up, `the ${name} Worker came up on ${PORT_NOTICE_WORKER} (pid ${wr.pid})`, up ? '' : wlog.slice(-600));
      const ss = await staticServer({ port: PORT_NOTICE_SITE, root: siteWorker, proxy: WN });
      return { WN, SN, wr, ss, pid: wr.pid, logRef: () => wlog, stop: async () => { await close(ss); wr.kill('SIGTERM'); await new Promise((r) => (wr.exitCode !== null ? r() : wr.once('exit', r))); } };
    };

    /* BOTH: NOTICE_53255 "true", lighting left to its default. SITE_BASE_URL is production's own value here, so
       the www/apex twin rule is read exactly as it will run live. */
    const both = await runNotice('both', ['SITE_BASE_URL=https://www.umbradomus.com', 'NOTICE_53255=true']);
    let bothR = null;
    try {
      const q = await quoted('Anselm Rook', 'Ceiling patch over the tub, painted to match', [win('2026-10-12', '10:00', '12:00')], { base: both.WN });
      const gb = await getQ(q.code, CT(...WED, 16, 10), {}, both.SN);
      ok(/id="notice-lighting"/.test(gb.text), 'BOTH: the lighting paragraph shows');
      const blk = /<div class="q53" id="notice-53255" lang="en">([\s\S]*?)<\/div>/.exec(gb.text);
      const paras = blk ? [...blk[1].matchAll(/<p>([^<]*)<\/p>/g)].map((x) => decode(x[1])) : [];
      eq(paras.length, NOTICE_53255.length, `BOTH: the §53.255 block shows its ${NOTICE_53255.length} paragraphs`);
      eq(JSON.stringify(paras), JSON.stringify(NOTICE_53255), 'BOTH: every paragraph is the statute\'s, exactly');
      eq(crypto.createHash('sha256').update(paras.join('\n')).digest('hex'), NOTICE_53255_SHA256, 'its sha256 is the constant\'s');
      const pos = ['Before you accept', 'Light.', 'KNOW YOUR RIGHTS', 'OBTAIN TITLE INSURANCE PROTECTION', 'Accept & confirm'].map((s) => textOf(gb.text).indexOf(s));
      ok(pos.every((x, i) => x >= 0 && (i === 0 || x > pos[i - 1])), 'both notices come before the Accept button', JSON.stringify(pos));
      const p = await tab(CT(...WED, 16, 11));
      await p.goto(qurl(q.code, '', both.SN), { waitUntil: 'load' });
      await shot(p, '11-notices-both.png');
      await p.close();
      /* the origin rule with production's SITE_BASE_URL: both twins allowed, anything else refused */
      const twin = [];
      for (const o of ['https://evil.example', 'https://umbradomus.com.evil.example', 'http://www.umbradomus.com', 'https://umbradomus.com', 'https://www.umbradomus.com']) {
        const r = await req('POST', `${both.WN}/q/AAAAAAAAAAAAAAAAAAAAAA`, { headers: { 'content-type': 'application/x-www-form-urlencoded', origin: o, 'x-umbra-test-now': CT(...WED, 16, 12) }, body: 'v=1' });
        twin.push({ origin: o, status: r.status });
      }
      eq(JSON.stringify(twin.map((t) => t.status)), JSON.stringify([403, 403, 403, 303, 303]), 'production origins: https://umbradomus.com and https://www.umbradomus.com pass; http://, look-alikes and others → 403', JSON.stringify(twin));
      eq(both.logRef().includes(q.code), false, "the code is not in that Worker's log");
      bothR = { worker: both.WN, pid: both.pid, vars: ['NOTICE_53255=true', 'NOTICE_LIGHTING (default)'], job: q.id, lighting: true, statute_paragraphs: paras.length, statute_equal: JSON.stringify(paras) === JSON.stringify(NOTICE_53255), production_origin_rule: twin };
    } finally {
      await both.stop();
    }
    const off = await runNotice('lighting-off', ['SITE_BASE_URL=http://127.0.0.1:' + PORT_NOTICE_SITE, 'NOTICE_53255=true', 'NOTICE_LIGHTING=false']);
    let offR = null;
    try {
      const q = await quoted('Bettina Marsh', 'Tape seam lifting in the nursery', [win('2026-10-12', '10:00', '12:00')], { base: off.WN });
      const go = await getQ(q.code, CT(...WED, 16, 20), {}, off.SN);
      eq(/id="notice-lighting"/.test(go.text), false, 'NOTICE_LIGHTING "false": the lighting paragraph is hidden');
      eq(textOf(go.text).includes(LIGHTING_EN.text.slice(0, 30)), false, 'no trace of its words');
      ok(/id="notice-53255"/.test(go.text), 'while §53.255 (still "true") shows');
      offR = { worker: off.WN, pid: off.pid, vars: ['NOTICE_53255=true', 'NOTICE_LIGHTING=false'], job: q.id, lighting: /id="notice-lighting"/.test(go.text), statute: /id="notice-53255"/.test(go.text) };
    } finally {
      await off.stop();
    }
    R['16'] = { default_worker: { lighting: Boolean(m), lighting_equals_ready4: ready4 === null ? 'na (READY-4 absent)' : shown === ready4, statute: /id="notice-53255"/.test(g.text) }, lighting_sha256: LIGHTING_SHA256, statute_sha256: NOTICE_53255_SHA256, both: bothR, lighting_off: offR };
  }

  /* ============================================================ (17) */
  suite('I · (17) every 303 carries a relative Location (/q/<code>)');
  {
    const bad = redirects.filter((r) => !/^\/q\/[A-Za-z0-9]{22}(\?pick=1)?$/.test(r.location || ''));
    ok(redirects.length >= 10, `${redirects.length} redirects seen across this suite`);
    eq(bad.length, 0, 'every one is /q/<code> (or /q/<code>?pick=1), relative — never an absolute URL', JSON.stringify(bad));
    const all303 = sw.proxyLog.filter((e) => e.status === 303);
    const badProxy = all303.filter((e) => !/^\/q\/[A-Za-z0-9]{22}(\?pick=1)?$/.test(e.response_headers.location || ''));
    eq(badProxy.length, 0, `and every 303 the site's proxy passed (${all303.length}) is relative too`);
    const hdrs = ['cache-control', 'x-robots-tag', 'referrer-policy', 'x-frame-options', 'content-security-policy'];
    const missing = all303.filter((e) => hdrs.some((h) => !e.response_headers[h]));
    eq(missing.length, 0, 'and carries the five headers');
    R['17'] = { count_node_and_curl_and_browser: redirects.length, count_via_proxy: all303.length, dump: redirects.map((r) => ({ via: r.via, method: r.method, path: (r.path || '').replace(/[A-Za-z0-9]{22}/, '<code>'), location: (r.location || '').replace(/[A-Za-z0-9]{22}/, '<code>'), headers: r.headers ? Object.fromEntries(Object.entries(r.headers).filter(([k]) => ['location', ...hdrs].includes(k)).map(([k, v]) => [k, String(v).replace(/[A-Za-z0-9]{22}/, '<code>')])) : r.raw })) };
  }

  /* ============================================================ (18) */
  suite('I · (18) the site: exactly one rewrite, .vercelignore, and the proxy path works for GET and POST');
  {
    const vj = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'vercel.json'), 'utf8'));
    eq(JSON.stringify(vj.rewrites), JSON.stringify([{ source: '/q/:path*', destination: 'https://umbra-intake.umbradomus.workers.dev/q/:path*' }]), 'vercel.json has exactly the one rewrite');
    eq(fs.readFileSync(path.join(REPO_DIR, '.vercelignore'), 'utf8'), 'worker/\ntools/\n', '.vercelignore has exactly the two lines');
    const gets = sw.proxyLog.filter((e) => e.method === 'GET' && e.status === 200).length;
    const posts = sw.proxyLog.filter((e) => e.method === 'POST' && e.status === 303).length;
    ok(gets > 0 && posts > 0, `the proxy carried ${gets} GETs answered 200 and ${posts} POSTs answered 303`);
    R['18'] = { rewrites: vj.rewrites, vercelignore: 'worker/\\ntools/\\n', proxy_gets_200: gets, proxy_posts_303: posts, proxy_requests_total: sw.proxyLog.length };
  }

  /* ============================================================ (19) — the part a suite can read */
  suite('I · (19) no raw code logged; no banned word, review ask, contact detail or admin key on any page');
  {
    const log = wlogRef();
    const logged = codes.filter((c) => log.includes(c));
    eq(logged.length, 0, `none of the ${codes.length} codes this suite made is in wrangler dev's log`);
    const law = new Set(NOTICE_53255);
    const pageText = bodies.map((b) => {
      /* the statute's own words are the statute's: they are read apart, below */
      const noLaw = b.replace(/<div class="q53" id="notice-53255" lang="en">[\s\S]*?<\/div>/g, ' ');
      return textOf(noLaw);
    }).join('\n');
    const banned = pageText.match(/\b(licensed|bonded|licencia|licenciado|fianza|afianzado)\b/gi) || [];
    eq(banned.length, 0, 'none of licensed/bonded/licencia/licenciado/fianza/afianzado (whole words) on any page');
    const asks = pageText.match(/\b(review|reviews|referral|referrals|refer a friend|discount|discounts|coupon|promo|rate us|reseña|reseñas|recomiéndenos|descuento|descuentos|cupón)\b/gi) || [];
    eq(asks.length, 0, 'no review, referral or discount wording on any page (outside the statute\'s own text)', asks.join(', '));
    const lawText = NOTICE_53255.join('\n');
    const lawWords = { review: (lawText.match(/\breview\w*\b/gi) || []).length, licensed_or_bonded: (lawText.match(/\b(licensed|bonded)\b/gi) || []).length };
    eq(lawWords.licensed_or_bonded, 0, 'the statute text itself says neither licensed nor bonded');
    eq(bodies.some((b) => b.includes(ADMIN_KEY)), false, 'the admin key is on no page');
    const contact = pageText.match(/tel:|sms:|mailto:|\(956\)|555-01\d\d|@example\.com|Almendro Court/g) || [];
    eq(contact.length, 0, 'no phone, email or fixture address on any page');
    R['19'] = { pages_read: bodies.length, codes_made: codes.length, codes_in_log: logged.length, banned_words: banned, review_referral_discount: asks, statute_own_words: lawWords, admin_key_on_a_page: false, contact_hits: contact };
  }

  R.pictures = fs.readdirSync(PIC).sort();
  return R;
}
