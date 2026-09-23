/* SUITE H · THE BOOK (ACCEPT-PAGE-01, 2026-09-23). The quotes, the holds and one booking per time
   behind the quote link, against the real `wrangler dev` with the Durable Object running locally, and the
   fake Pushover / Telegram in lib/servers.mjs. No page exists yet (ACCEPT-PAGE-02 builds it): the page's
   three calls are reached through the gated test hooks /__view-by-code, /__book-by-code and
   /__none-by-code, which call exactly viewByCode, bookByCode and markNone. Every moment is named with
   x-umbra-test-now. Readings (2)–(14) and (16) are returned with their actual values for the close.

   Every booked day below is its own, so no two readings collide by accident:
     J1 9/29 8–10 · B 9/29 8–10 + 9/30 10–12 · C 9/29 9–11 · D, E 10/1 8–10 · V 10/2 · H 9/29 2–4 PM ·
     H2 9/29 4–6 PM · F 9/29 8–10 (after the cancel) · T 10/1 8–10 + 10/5 9–11 · N 10/6 8–10 ·
     P 10/7 8–10 · M 10/7 10–12 · K 10/8 · K2 10/9 · L 10/10 · S 10/6 2–4 PM (never booked) */

import crypto from 'node:crypto';
import { chicagoWall } from '../src/biztime.js';

export async function suiteBook({ W, stub, ADMIN_KEY, FAKE, suite, ok, eq, json, sleep, SITE, wlogRef }) {
  const R = {};
  const CT = (y, mo, d, h, mi = 0) => new Date(chicagoWall(y, mo, d, h, mi)).toISOString();
  const FMT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'short', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const central = (iso) => (iso ? FMT.format(new Date(iso)).replace(/\s+/g, ' ') : iso);
  const win = (date, start, end) => ({ date, start, end });
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

  /* ---------------------------------------------------------------- the stand-ins */
  const titleOf = (c) => (c.p ? c.p.get('title') : c.j.text.split('\n')[0]);
  const textOf = (c) => (c.p ? c.p.get('title') + '\n' + c.p.get('message') : c.j.text);
  const PO = () => stub.captured
    .filter((c) => c.method === 'POST' && c.url === '/pushover/1/messages.json')
    .map((c) => Object.assign(c, { p: new URLSearchParams(c.body.toString('utf8')) }));
  const TG = () => stub.captured
    .filter((c) => c.method === 'POST' && /^\/telegram\/bot[^/]+\/sendMessage$/.test(c.url))
    .map((c) => Object.assign(c, { j: JSON.parse(c.body.toString('utf8')) }));
  /* only the book's two pushes, never the intake ladder's */
  const BOOKISH = /^(ACCEPTED · U-\d+ · |U-\d+ · none of the times work$)/;
  const pushes = (list, id) => list.filter((c) => BOOKISH.test(titleOf(c)) && titleOf(c).includes(id + ' '));

  /* ---------------------------------------------------------------- the Worker */
  const H = (now) => ({ 'content-type': 'application/json', ...(now ? { 'x-umbra-test-now': now } : {}) });
  const admin = (method, p, body, now, key = ADMIN_KEY) => json(`${W}${p}${key === null ? '' : '?k=' + key}`, { method, headers: H(now), body: body === undefined ? undefined : JSON.stringify(body) });
  const create = (id, body, now) => admin('POST', `/admin/quote/${id}`, body, now);
  const sentQ = (id, version, sentAt, now) => admin('POST', `/admin/quote/${id}/sent`, { version, sent_at: sentAt }, now || sentAt);
  const acceptQ = (id, version, window, now) => admin('POST', `/admin/quote/${id}/accept`, { version, window }, now);
  const cancelQ = (id, version, now) => admin('POST', `/admin/quote/${id}/cancel`, { version }, now);
  const stateQ = (id, now) => admin('GET', `/admin/quote/${id}`, undefined, now);
  const hook = (name, body, now) => json(`${W}/__${name}?k=${ADMIN_KEY}`, { method: 'POST', headers: H(now), body: JSON.stringify(body || {}) }).then((r) => r.body);
  const byCode = (code, version, window, now, by = 'page') => hook('book-by-code', { code, version, window, by }, now);
  const noneBy = (code, version, now) => hook('none-by-code', { code, version }, now);
  const view = (code, now) => hook('view-by-code', { code }, now);
  const reconcileAt = (now) => hook('reconcile', {}, now);
  const dump = () => hook('book-dump', {}, null);
  const failStamp = (id, times = 1) => json(`${W}/__fail-stamp/${id}?k=${ADMIN_KEY}&times=${times}`, { method: 'POST' });
  const jobs = async () => (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.jobs;
  const row = async (id) => (await jobs()).find((j) => j.id === id);
  const still = (r) => { const { minutes_open, ...rest } = r; return JSON.stringify(rest); };
  const md = async (id) => (await fetch(`${W}/api/export/${id}.md?k=${ADMIN_KEY}`)).text();
  const bookRows = async (id) => (await dump()).quotes.filter((q) => q.job_id === id);
  const bookingsOn = async (date) => (await dump()).bookings.filter((b) => b.date === date);

  let serial = 0;
  async function submitAt(iso, name) {
    serial++;
    const fd = new FormData();
    fd.set('_subject', 'Service request from umbradomus.com');
    fd.set('_next', 'https://www.umbradomus.com/request-received');
    fd.set('name', name);
    fd.set('phone', '(956) 555-0177');
    fd.set('address', `${100 + serial} Quote Lane, Brownsville`);
    fd.set('email', 'quote.fixture@example.com');
    fd.set('service', 'Drywall & Paint');
    fd.set('what', `${name} (fixture ${serial}): ${serial + 1} small holes in the ${['hall', 'den', 'kitchen', 'bedroom'][serial % 4]} ceiling to patch and paint.`);
    fd.set('email_sent', 'yes');
    const r = await fetch(`${W}/intake`, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
    const id = new URL(r.headers.get('location')).searchParams.get('id');
    if (!id) throw new Error('fixture submission failed for ' + name);
    /* acknowledged at once, so the intake ladder never pushes during these readings */
    await fetch(`${W}/admin/seen/${id}?k=${ADMIN_KEY}`, { method: 'POST', headers: { 'x-umbra-test-now': iso } });
    return id;
  }

  const Q = (version, windows, extra = {}) => ({
    version, price: 395,
    scope: ['Patch the holes in the ceiling and re-texture to match', 'Prime every patch and spot-paint it, feathered'],
    included: 'Paint for the color match is included. Cleanup included.',
    guarantee: 'If anything is not right, I come back and fix it.',
    insurance: 'Insured: $1M general liability. Certificate on request.',
    windows, lang: 'en', ...extra,
  });

  const leaks = (c, id) => {
    const t = textOf(c) + '\n' + (c.p ? [...c.p.entries()].filter(([k]) => !['token', 'user', 'callback'].includes(k)).map(([, v]) => v).join('\n') : JSON.stringify(c.j));
    const found = [];
    if (/https?:\/\/|www\.|\/q\//i.test(t)) found.push('link');
    if (t.includes(ADMIN_KEY)) found.push('admin key');
    for (const [k, v] of Object.entries(FAKE)) if (k !== 'TELEGRAM_CHAT_ID' && t.includes(v)) found.push(k);
    if (/555-?0177|\(956\)/.test(t)) found.push('phone');
    if (/Quote Lane/.test(t)) found.push('address');
    if (/@example\.com/.test(t)) found.push('email');
    if (/Quinn|Bea|Cruz|Nadia|Paco|Mona/i.test(t)) found.push('name');
    return found;
  };

  const WED = [2026, 9, 23];
  const T10 = CT(...WED, 10, 0);

  /* ============================================================ (2) */
  suite('H · (2) create v1: a random 22-character code, only its hash in the book');
  const J1 = await submitAt(CT(...WED, 9, 0), 'Quinn Aster');
  const c1 = await create(J1, Q(1, [win('2026-09-29', '08:00', '10:00')], { sent_at: T10 }), T10);
  const code1 = c1.body && c1.body.code;
  {
    eq(c1.status, 201, 'the create answers 201');
    ok(/^[A-Za-z0-9]{22}$/.test(code1 || ''), 'the code is 22 base62 characters', code1 ? code1.length + ' chars' : 'missing');
    ok(c1.body.url === `${SITE}/q/${code1}`, 'url = QUOTE_LINK_BASE + "/q/" + code', c1.body.url && c1.body.url.replace(code1, '<code>'));
    const d = await dump();
    const all = JSON.stringify(d);
    const mine = d.quotes.find((q) => q.job_id === J1);
    eq(mine && mine.token_hash, sha(code1), 'the book row is keyed by sha256(code)');
    eq(all.includes(code1), false, 'the raw code appears nowhere in the book dump');
    const recRow = await row(J1);
    eq(JSON.stringify(recRow).includes(code1), false, 'nor in the KV record (/api/jobs row)');
    eq((await md(J1)).includes(code1), false, 'nor in the markdown export');
    eq(wlogRef().includes(code1), false, "nor in wrangler dev's log");
    const again = await create(J1, Q(1, [win('2026-09-29', '08:00', '10:00')]), T10);
    eq(again.status, 409, 'the same version again is refused (409 version_not_newer)');
    const other = await create('U-9999', Q(1, [win('2026-09-29', '08:00', '10:00')]), T10);
    eq(other.status, 404, 'an unknown job is a 404');
    const noKey = await admin('POST', `/admin/quote/${J1}`, Q(2, [win('2026-09-29', '08:00', '10:00')]), T10, null);
    const badKey = await admin('POST', `/admin/quote/${J1}`, Q(2, [win('2026-09-29', '08:00', '10:00')]), T10, 'guess');
    eq(noKey.status, 401, 'no admin key → 401');
    eq(badKey.status, 401, 'a wrong admin key → 401');
    eq(JSON.stringify(noKey.body), '{"error":"unauthorized"}', 'answered {"error":"unauthorized"}, exactly like /admin/seen');
    R['2'] = {
      job: J1, status: c1.status, code_length: code1 && code1.length, code_charset_base62: /^[A-Za-z0-9]+$/.test(code1 || ''),
      url_shape: c1.body.url && c1.body.url.replace(code1, '<code>'), book_row_token_hash: mine && mine.token_hash,
      hash_equals_sha256_of_code: mine && mine.token_hash === sha(code1),
      raw_code_in_book_dump: all.includes(code1), raw_code_in_kv_row: JSON.stringify(recRow).includes(code1), raw_code_in_wrangler_log: wlogRef().includes(code1),
      same_version_again: again.status, unknown_job: other.status, no_key: noKey.status, wrong_key: badKey.status, no_key_body: noKey.body,
    };
  }

  /* ============================================================ (3) */
  suite('H · (3) the hold table, in Central time');
  {
    R['3'] = [];
    const cases = [
      { label: 'sent Wed 9/23 10:00 AM for Tue 9/29 8–10', id: J1, body: c1.body, want: 'Fri, 9/25, 10:00 AM CDT', short: false },
    ];
    const B2 = await submitAt(CT(...WED, 9, 5), 'Bea Hollis');
    const b2 = await create(B2, Q(1, [win('2026-09-25', '08:00', '10:00')], { sent_at: T10 }), T10);
    cases.push({ label: 'sent Wed 9/23 10:00 AM for Fri 9/25 8–10', id: B2, body: b2.body, want: 'Wed, 9/23, 9:00 PM CDT', short: false });
    const B3 = await submitAt(CT(...WED, 9, 10), 'Cruz Delmar');
    const b3 = await create(B3, Q(1, [win('2026-09-24', '08:00', '10:00')], { sent_at: T10 }), T10);
    cases.push({ label: 'sent Wed 9/23 10:00 AM for Thu 9/24 8–10', id: B3, body: b3.body, want: 'Wed, 9/23, 8:00 PM CDT', short: true });
    const oct = CT(2026, 10, 30, 10, 0);
    const B4 = await submitAt(CT(2026, 10, 30, 9, 0), 'Dora Fenwick');
    const b4 = await create(B4, Q(1, [win('2026-11-03', '08:00', '10:00')], { sent_at: oct }), oct);
    cases.push({ label: 'sent Fri 10/30 10:00 AM for Tue 11/3 8–10', id: B4, body: b4.body, want: 'Sun, 11/1, 9:00 AM CST', short: false });
    for (const c of cases) {
      eq(central(c.body.hold_until), c.want, `${c.label} → hold ${c.want}`);
      eq(c.body.short_notice, c.short, `${c.label}: short_notice ${c.short}`);
      R['3'].push({ case: c.label, job: c.id, hold_until: central(c.body.hold_until), cutoff: central(c.body.cutoff), short_notice: c.body.short_notice, hold_until_utc: c.body.hold_until, cutoff_utc: c.body.cutoff });
    }
    const real48 = (Date.parse(b4.body.hold_until) - Date.parse(oct)) / 3600000;
    eq(real48, 48, 'across the end of DST the hold is 48 real hours');
    const late = CT(...WED, 20, 30);
    const B5 = await submitAt(CT(...WED, 20, 0), 'Eli Marsh');
    const b5 = await create(B5, Q(1, [win('2026-09-24', '08:00', '09:00')]), late);
    eq(b5.status, 422, 'created Wed 9/23 8:30 PM for Thu 9/24 8–9 AM → 422');
    eq(b5.body && b5.body.error, 'too soon to hold', 'with the reason "too soon to hold"');
    eq((await bookRows(B5)).length, 0, 'and nothing was written to the book');
    R['3'].push({ case: 'created Wed 9/23 8:30 PM for Thu 9/24 8–9 AM', job: B5, status: b5.status, body: b5.body, real_hours_dst_case: real48 });
  }

  /* ============================================================ (4) (12a) (16a) */
  suite('H · (4) the booking step by code; (12) a page booking at 10:00 AM pushes once');
  R['16'] = [];
  {
    const v0 = await view(code1, T10);
    eq(v0.state, 'open', 'viewByCode before booking: open');
    R['16'].push({ case: '(4) J1 before booking', state: v0.state, windows: v0.windows });
    const bP = PO().length, bT = TG().length;
    const r = await byCode(code1, 1, null, T10);
    eq(r.state, 'booked', 'the page books it');
    const rec = await row(J1);
    eq(rec.status, 'scheduled', 'record status scheduled');
    eq(rec.scheduled_for, '2026-09-29T13:00:00.000Z', 'scheduled_for 13:00Z = 8:00 AM CDT on 9/29');
    eq(rec.scheduled_at, T10, 'scheduled_at = the moment it was booked');
    eq(rec.accepted_at, T10, 'accepted_at stamped');
    eq(JSON.stringify(rec.accept), JSON.stringify({ at: T10, by: 'page', version: 1, window: win('2026-09-29', '08:00', '10:00'), price: 395 }), 'the accept block: at, by page, version 1, the window, the price');
    const full = (await json(`${W}/api/export/${J1}.md?k=${ADMIN_KEY}`)).status;
    const ev = (await md(J1)).includes('`accepted`');
    ok(ev, 'the "accepted" event is in the audit list');
    await sleep(300);
    const po = pushes(PO().slice(bP), J1), tg = pushes(TG().slice(bT), J1);
    eq(po.length, 1, '(12) exactly 1 Pushover push');
    eq(tg.length, 1, '(12) exactly 1 Telegram message');
    eq(po[0] && po[0].p.get('title'), `ACCEPTED · ${J1} · Tue 9/29 8–10 AM`, '(12) the title as written');
    eq(po[0] && po[0].p.get('message'), '$395 · v1', '(12) the message as written');
    eq(po[0] && po[0].p.get('priority'), '1', '(12) priority 1');
    eq(po[0] && po[0].p.get('url'), null, '(12) no url parameter');
    ok(po[0] && leaks(po[0], J1).length === 0, '(12) no link, key, secret, name, phone, address or email in the push', po[0] && leaks(po[0], J1).join(','));
    ok(tg[0] && leaks(tg[0], J1).length === 0, '(12) none in the Telegram message either', tg[0] && leaks(tg[0], J1).join(','));
    const v1 = await view(code1, T10);
    eq(v1.state, 'booked', 'viewByCode after booking: booked');
    R['16'].push({ case: '(4) J1 after booking', state: v1.state });
    const before = still(await row(J1));
    const d0 = await dump();
    const again = await byCode(code1, 1, null, CT(...WED, 10, 5));
    eq(again.state, 'already_booked', 'the same call again answers already_booked');
    eq((await bookingsOn('2026-09-29')).filter((b) => b.job_id === J1).length, 1, 'still one booking row');
    eq(still(await row(J1)), before, 'and the record was not written');
    const d1 = await dump();
    eq(JSON.stringify(d1.quotes.find((q) => q.job_id === J1)), JSON.stringify(d0.quotes.find((q) => q.job_id === J1)), 'nor the book row');
    await sleep(300);
    eq(pushes(PO(), J1).length, 1, 'and no second push');
    R['4'] = {
      job: J1, first: r.state, record: { status: rec.status, scheduled_for: rec.scheduled_for, scheduled_at: rec.scheduled_at, accepted_at: rec.accepted_at, accept: rec.accept, accepted_event: ev, export_status: full },
      again: again.state, booking_rows: (await bookingsOn('2026-09-29')).filter((b) => b.job_id === J1).length,
    };
    R['12'] = { page_booking_10am: { job: J1, pushover: po.length, telegram: tg.length, title: po[0] && po[0].p.get('title'), message: po[0] && po[0].p.get('message'), priority: po[0] && po[0].p.get('priority'), url_param: po[0] && po[0].p.get('url'), telegram_text: tg[0] && tg[0].j.text, leaks: po[0] ? leaks(po[0], J1) : null } };
  }

  /* ============================================================ (5) */
  suite('H · (5) one booking per time');
  let B, C, codeB, codeC;
  {
    B = await submitAt(CT(...WED, 9, 20), 'Bram Oakes');
    C = await submitAt(CT(...WED, 9, 25), 'Celia Vance');
    codeB = (await create(B, Q(1, [win('2026-09-29', '08:00', '10:00'), win('2026-09-30', '10:00', '12:00')], { sent_at: T10 }), T10)).body.code;
    codeC = (await create(C, Q(1, [win('2026-09-29', '09:00', '11:00')], { sent_at: T10 }), T10)).body.code;
    const vB = await view(codeB, CT(...WED, 10, 30));
    eq(vB.state, 'taken', "viewByCode for B: taken (A holds B's first window)");
    eq(vB.windows.map((w) => w.free).join(','), 'false,true', 'window 1 not free, window 2 free');
    R['16'].push({ case: '(5) B with A booked', state: vB.state, free: vB.windows.map((w) => w.free) });
    const dB0 = JSON.stringify(await bookRows(B)), bk0 = JSON.stringify((await dump()).bookings), recB0 = still(await row(B));
    const rB1 = await byCode(codeB, 1, 1, CT(...WED, 10, 30));
    eq(rB1.state, 'taken', 'B on the same window → taken');
    eq(JSON.stringify(await bookRows(B)), dB0, "nothing written to B's book row");
    eq(JSON.stringify((await dump()).bookings), bk0, 'nothing written to the bookings');
    eq(still(await row(B)), recB0, "nothing written to B's record");
    const rC = await byCode(codeC, 1, null, CT(...WED, 10, 31));
    eq(rC.state, 'taken', 'C offered 9–11 the same day → taken (overlap)');
    const vC = await view(codeC, CT(...WED, 10, 31));
    eq(vC.state, 'taken', 'viewByCode for C: taken');
    R['16'].push({ case: '(5) C overlapping', state: vC.state });
    const rB2 = await byCode(codeB, 1, 2, CT(...WED, 10, 32));
    eq(rB2.state, 'booked', "B's other window is still bookable → booked");
    eq(JSON.stringify(rB2.window), JSON.stringify({ n: 2, ...win('2026-09-30', '10:00', '12:00') }), 'window 2, Wed 9/30 10–12');

    const D = await submitAt(CT(...WED, 9, 30), 'Dex Rowan');
    const E = await submitAt(CT(...WED, 9, 35), 'Esme Quill');
    const codeD = (await create(D, Q(1, [win('2026-10-01', '08:00', '10:00')], { sent_at: T10 }), T10)).body.code;
    const codeE = (await create(E, Q(1, [win('2026-10-01', '08:00', '10:00')], { sent_at: T10 }), T10)).body.code;
    const at = CT(...WED, 10, 40);
    const [x, y] = await Promise.all([byCode(codeD, 1, null, at), byCode(codeE, 1, null, at)]);
    const pair = [x.state, y.state].sort();
    eq(pair.join(' / '), 'booked / taken', 'two bookings of one window at the same instant: one booked, the other taken');
    eq((await bookingsOn('2026-10-01')).length, 1, 'exactly one booking row for 10/1');
    R['5'] = {
      A: { job: J1, window: 'Tue 9/29 8–10', state: 'booked (reading 4)' }, B: { job: B, window1: rB1.state, nothing_written: true, window2: rB2.state },
      C: { job: C, window: 'Tue 9/29 9–11', state: rC.state }, same_instant: { jobs: [D, E], states: [x.state, y.state], booking_rows: (await bookingsOn('2026-10-01')).length },
    };
  }

  /* ============================================================ (6) */
  suite('H · (6) versions: updating, then replaced');
  {
    const V = await submitAt(CT(...WED, 9, 40), 'Vera Lund');
    const v1c = (await create(V, Q(1, [win('2026-10-02', '08:00', '10:00')], { sent_at: T10 }), T10)).body.code;
    const v2 = await create(V, Q(2, [win('2026-10-02', '08:00', '10:00')], { price: 425 }), CT(...WED, 11, 0));
    eq(v2.status, 201, 'v2 created');
    const a = await byCode(v1c, 1, null, CT(...WED, 11, 5));
    eq(a.state, 'updating', 'v1 by code → updating (v2 exists, not marked sent)');
    const va = await view(v1c, CT(...WED, 11, 5));
    eq(va.state, 'updating', 'viewByCode v1: updating');
    const s2 = await sentQ(V, 2, CT(...WED, 11, 10));
    eq(s2.status, 200, 'v2 marked sent');
    const b = await byCode(v1c, 1, null, CT(...WED, 11, 15));
    eq(b.state, 'replaced', 'v1 by code → replaced');
    const vb = await view(v1c, CT(...WED, 11, 15));
    eq(vb.state, 'replaced', 'viewByCode v1: replaced');
    const vo = await view(v2.body.code, CT(...WED, 11, 15));
    eq(vo.state, 'open', 'viewByCode v2: open');
    const c = await byCode(v2.body.code, 2, null, CT(...WED, 11, 20));
    eq(c.state, 'booked', 'v2 books normally');
    eq(c.price, 425, "at v2's price");
    eq((await row(V)).accept.version, 2, 'the record carries accept.version 2');
    R['6'] = { job: V, v1_after_v2_created: a.state, v1_after_v2_sent: b.state, v2_booking: c.state, v2_price: c.price };
    R['16'].push({ case: '(6) v1 after v2 created', state: va.state }, { case: '(6) v1 after v2 sent', state: vb.state }, { case: '(6) v2', state: vo.state });
  }

  /* ============================================================ (7) */
  suite('H · (7) the hold: after it, still bookable; at the cutoff, too close; by text, his call');
  let Hj, H2, codeH2;
  {
    Hj = await submitAt(CT(...WED, 9, 45), 'Hana Pike');
    const ch = await create(Hj, Q(1, [win('2026-09-29', '14:00', '16:00')], { sent_at: T10 }), T10);
    eq(central(ch.body.hold_until), 'Fri, 9/25, 10:00 AM CDT', 'hold Fri 9/25 10:00 AM');
    eq(central(ch.body.cutoff), 'Sun, 9/27, 9:00 PM CDT', 'cutoff Sun 9/27 9:00 PM');
    const sat = CT(2026, 9, 26, 12, 0);
    const vh = await view(ch.body.code, sat);
    eq(vh.state, 'hold_ended', 'viewByCode after hold_until, before cutoff: hold_ended');
    const r1 = await byCode(ch.body.code, 1, null, sat);
    eq(r1.state, 'booked', 'booking by the page after the hold, before the cutoff → booked');

    H2 = await submitAt(CT(...WED, 9, 50), 'Hugo Brandt');
    const c2 = await create(H2, Q(1, [win('2026-09-29', '16:00', '18:00')], { sent_at: T10 }), T10);
    codeH2 = c2.body.code;
    const cut = c2.body.cutoff;
    const vc = await view(codeH2, cut);
    eq(vc.state, 'too_close', 'viewByCode at the cutoff: too_close');
    const d0 = JSON.stringify(await bookRows(H2)), rec0 = still(await row(H2));
    const r2 = await byCode(codeH2, 1, null, cut);
    eq(r2.state, 'too_close', 'booking by the page AT the cutoff → too_close');
    eq(JSON.stringify(await bookRows(H2)), d0, 'nothing written to the book');
    eq(still(await row(H2)), rec0, 'nothing written to the record');
    const late = CT(2026, 9, 27, 22, 0);
    const r3 = await acceptQ(H2, 1, 1, late);
    eq(r3.status, 200, 'by text past the cutoff → 200');
    eq(r3.body.state, 'booked', 'booked (his call)');
    eq(r3.body.accepted_by, 'text', 'accepted_by text');
    R['7'] = {
      after_hold: { job: Hj, hold_until: central(ch.body.hold_until), cutoff: central(ch.body.cutoff), at: central(sat), view: vh.state, page: r1.state },
      at_cutoff: { job: H2, at: central(cut), view: vc.state, page: r2.state, nothing_written: true },
      by_text_past_cutoff: { at: central(late), status: r3.status, state: r3.body.state, by: r3.body.accepted_by },
    };
    R['16'].push({ case: '(7) after hold, before cutoff', state: vh.state }, { case: '(7) at cutoff', state: vc.state });
  }

  /* ============================================================ (8) */
  suite('H · (8) cancel: the booking freed, the record re-stamped');
  {
    const at = CT(...WED, 12, 0);
    const r = await cancelQ(J1, 1, at);
    eq(r.status, 200, 'cancel answers 200');
    eq(r.body.state, 'withdrawn', 'withdrawn');
    eq(JSON.stringify(r.body.freed), JSON.stringify(win('2026-09-29', '08:00', '10:00')), 'it names the freed time');
    eq((await bookingsOn('2026-09-29')).filter((b) => b.job_id === J1).length, 0, 'the booking row is gone');
    const rec = await row(J1);
    eq(rec.status, 'quoted', 'status back to quoted');
    eq(rec.scheduled_for, null, 'scheduled_for null');
    eq(rec.scheduled_at, null, 'scheduled_at null');
    eq(rec.accept && rec.accept.cancelled_at, at, 'accept.cancelled_at stamped');
    ok((await md(J1)).includes('`booking-cancelled`'), 'the "booking-cancelled" event is in the audit list');
    const vw = await view(code1, at);
    eq(vw.state, 'withdrawn', 'viewByCode J1: withdrawn');
    const rj = await byCode(code1, 1, null, at);
    eq(rj.state, 'withdrawn', 'its code now answers withdrawn');
    const F = await submitAt(CT(...WED, 11, 50), 'Fern Castell');
    const cf = (await create(F, Q(1, [win('2026-09-29', '08:00', '10:00')], { sent_at: at }), at)).body.code;
    const rf = await byCode(cf, 1, null, CT(...WED, 12, 5));
    eq(rf.state, 'booked', "another job's booking of that window now succeeds");
    const rc = await byCode(codeC, 1, null, CT(...WED, 12, 6));
    eq(rc.state, 'taken', "(and C's 9–11 still overlaps F's new 8–10)");
    R['8'] = {
      job: J1, cancel: r.status, state: r.body.state, freed: r.body.freed, booking_rows_after: 0,
      record: { status: rec.status, scheduled_for: rec.scheduled_for, scheduled_at: rec.scheduled_at, accept_cancelled_at: rec.accept && rec.accept.cancelled_at },
      code_after: rj.state, other_job: { job: F, state: rf.state },
    };
    R['16'].push({ case: '(8) J1 after cancel', state: vw.state });
  }

  /* ============================================================ (9) */
  suite('H · (9) the texted-YES route: same time rules, no push');
  {
    const Tj = await submitAt(CT(...WED, 12, 10), 'Tomas Reyes');
    await create(Tj, Q(1, [win('2026-10-01', '08:00', '10:00'), win('2026-10-05', '09:00', '11:00')], { sent_at: CT(...WED, 12, 30) }), CT(...WED, 12, 30));
    const bP = PO().length, bT = TG().length;
    const t1 = await acceptQ(Tj, 1, 1, CT(...WED, 13, 0));
    eq(t1.status, 409, 'a taken time → 409');
    eq(t1.body.error, 'taken', 'error "taken"');
    ok(t1.body.reason && /overlaps a booking/.test(t1.body.reason), 'with the reason', t1.body.reason);
    const t0 = await acceptQ(Tj, 1, null, CT(...WED, 13, 0));
    eq(t0.status, 409, 'two windows and no choice → 409 choose_window');
    const t2 = await acceptQ(Tj, 1, 2, CT(...WED, 13, 1));
    eq(t2.status, 200, 'window 2 → 200');
    eq(t2.body.state, 'booked', 'booked');
    const rec = await row(Tj);
    eq(rec.accept && rec.accept.by, 'text', 'record.accept.by = text');
    eq(rec.scheduled_for, '2026-10-05T14:00:00.000Z', 'scheduled_for Mon 10/5 9:00 AM CDT');
    await sleep(500);
    eq(pushes(PO().slice(bP), Tj).length + pushes(TG().slice(bT), Tj).length, 0, 'no push for a YES he marked himself');
    R['9'] = { job: Tj, taken: { status: t1.status, body: { error: t1.body.error, reason: t1.body.reason } }, no_choice: { status: t0.status, error: t0.body.error }, window2: { status: t2.status, state: t2.body.state, by: rec.accept.by, scheduled_for: rec.scheduled_for }, pushes: 0 };
  }

  /* ============================================================ (10) */
  suite('H · (10) /sent: the QUOTED path, field by field, and the ladder goes silent');
  {
    const recvd = CT(...WED, 13, 30);
    const S = await (async () => {
      /* not acknowledged at intake — this reading needs its ladder live */
      const fd = new FormData();
      fd.set('_next', 'https://www.umbradomus.com/request-received');
      fd.set('name', 'Sol Arden'); fd.set('phone', '(956) 555-0177'); fd.set('service', 'Drywall & Paint');
      fd.set('what', 'Sol Arden (fixture S): one crack over the closet door to tape and paint.');
      fd.set('email_sent', 'yes');
      const r = await fetch(`${W}/intake`, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': recvd } });
      return new URL(r.headers.get('location')).searchParams.get('id');
    })();
    const S0 = await (async () => {
      const fd = new FormData();
      fd.set('_next', 'https://www.umbradomus.com/request-received');
      fd.set('name', 'Tapp Control'); fd.set('phone', '(956) 555-0177'); fd.set('service', 'Drywall & Paint');
      fd.set('what', 'Tapp Control (fixture S0): the control for the Quoted tap, a dent in the hall wall.');
      fd.set('email_sent', 'yes');
      const r = await fetch(`${W}/intake`, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': recvd } });
      return new URL(r.headers.get('location')).searchParams.get('id');
    })();
    await create(S, Q(1, [win('2026-10-06', '14:00', '16:00')]), CT(...WED, 14, 0));
    const pre = await row(S);
    eq(pre.quoted_at, null, 'quoted_at is null before /sent (creating a quote does not stop the clock)');
    const sentAt = CT(...WED, 14, 40);
    const s = await sentQ(S, 1, sentAt);
    eq(s.status, 200, '/sent answers 200');
    await json(`${W}/api/job/${S0}/event?k=${ADMIN_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'quoted', at: sentAt, quote_amount: 395 }) });
    const a = await row(S), b = await row(S0);
    const lastQuoted = (mdText) => mdText.split('\n').filter((l) => l.includes('| `quoted` |')).pop();
    const mA = lastQuoted(await md(S)), mB = lastQuoted(await md(S0));
    for (const k of ['quoted_at', 'minutes_to_quote', 'status', 'quote_amount', 'business_minutes_to_quote']) eq(a[k], b[k], `${k}: /sent ${JSON.stringify(a[k])} = the Quoted tap ${JSON.stringify(b[k])}`);
    eq(mA, mB, 'the "quoted" event is the same line in the audit list');
    ok(a.alerts.ack_at === sentAt && b.alerts.ack_at === sentAt, 'both acknowledged the alerts at the same moment', `${a.alerts.ack_at} / ${b.alerts.ack_at}`);
    const ladder = [];
    for (const m of [16, 46, 76, 121]) {
      const bp = PO().length;
      await json(`${W}/__run-alerts?k=${ADMIN_KEY}&now=${encodeURIComponent(new Date(Date.parse(recvd) + m * 60000).toISOString())}`, { method: 'POST' });
      ladder.push(PO().slice(bp).filter((c) => textOf(c).includes(S)).length);
    }
    eq(ladder.join(','), '0,0,0,0', "ALERTS-01's ladder is silent for it afterwards (+16, +46, +76, +121)");

    /* already quoted, and scheduled: H from reading (7) */
    const h0 = await row(Hj);
    const again = CT(2026, 9, 26, 13, 0);
    const s2 = await sentQ(Hj, 1, again);
    eq(s2.status, 200, 'on a job already quoted and scheduled: 200');
    const h1 = await row(Hj);
    eq(h1.quoted_at, h0.quoted_at, 'quoted_at unchanged');
    eq(h1.status, 'scheduled', 'status stays scheduled');
    ok((await md(Hj)).split('\n').some((l) => l.includes('| `quote_sent` |') && l.includes(again)), 'a "quote_sent" event at the new time');
    R['10'] = {
      job: S, control: S0, sent_at: sentAt,
      sent_record: { quoted_at: a.quoted_at, minutes_to_quote: a.minutes_to_quote, business_minutes_to_quote: a.business_minutes_to_quote, status: a.status, quote_amount: a.quote_amount, ack_at: a.alerts.ack_at, ack_by: a.alerts.ack_by, event: mA },
      tap_record: { quoted_at: b.quoted_at, minutes_to_quote: b.minutes_to_quote, business_minutes_to_quote: b.business_minutes_to_quote, status: b.status, quote_amount: b.quote_amount, ack_at: b.alerts.ack_at, ack_by: b.alerts.ack_by, event: mB },
      ladder_pushes_after: ladder,
      already_quoted: { job: Hj, quoted_at_before: h0.quoted_at, quoted_at_after: h1.quoted_at, status_after: h1.status, quote_sent_event: true },
    };
  }

  /* ============================================================ (11) */
  suite('H · (11) every refusal, one by one, and what passes');
  {
    const Vj = await submitAt(CT(...WED, 15, 0), 'Val Idate');
    const at = CT(...WED, 15, 5);
    const good = [win('2026-10-12', '08:00', '10:00')];
    let v = 0;
    const tryQ = async (label, patch, want, wantReason) => {
      v++;
      const body = { ...Q(v, good), ...patch };
      if (patch.version !== undefined) body.version = patch.version;
      const r = await create(Vj, body, at);
      const pass = r.status === want && (!wantReason || (r.body && wantReason.test(String(r.body.reason || r.body.error))));
      ok(pass, `${label} → ${want}`, `${r.status} ${JSON.stringify(r.body && (r.body.reason || r.body.error))}`);
      R['11'].push({ case: label, status: r.status, reason: r.status === 201 ? null : (r.body && (r.body.reason || r.body.error)) });
      return r;
    };
    R['11'] = [];
    const u = await create('U-9999', Q(1, good), at);
    eq(u.status, 404, 'unknown job → 404');
    R['11'].push({ case: 'unknown job U-9999', status: u.status, reason: u.body && u.body.error });
    await tryQ('price as a string "395"', { price: '395' }, 422, /price/);
    await tryQ('price 0', { price: 0 }, 422, /price/);
    await tryQ('price -50', { price: -50 }, 422, /price/);
    await tryQ('two prices [395, 425]', { price: [395, 425] }, 422, /price/);
    await tryQ('scope line "Paint $45"', { scope: ['Patch the holes', 'Paint $45'] }, 422, /dollar amount/);
    await tryQ('included "Paint, a 20 dollars value"', { included: 'Paint included, a 20 dollars value' }, 422, /dollar amount/);
    await tryQ('guarantee "or $50 back"', { guarantee: 'Fixed right or $50 back' }, 422, /dollar amount/);
    await tryQ('price_note "5 hours at $45"', { price_note: '5 hours at $45' }, 201);
    await tryQ('insurance "Insured: $1M general liability"', { insurance: 'Insured: $1M general liability' }, 201);
    await tryQ('insurance "Licensed and insured"', { insurance: 'Licensed and insured' }, 422, /licensed/i);
    await tryQ('scope "BONDED crew"', { scope: ['BONDED crew does the patch'] }, 422, /bonded/i);
    await tryQ('es scope "con licencia"', { lang: 'es', scope: ['Trabajo con licencia'] }, 422, /licencia/);
    await tryQ('es guarantee "licenciado"', { lang: 'es', guarantee: 'Contratista licenciado' }, 422, /licenciado/);
    await tryQ('es insurance "fianza"', { lang: 'es', insurance: 'Con fianza' }, 422, /fianza/);
    await tryQ('es scope "afianzado"', { lang: 'es', scope: ['Equipo afianzado'] }, 422, /afianzado/);
    await tryQ('es scope "confianza" (trust, an ordinary word)', { lang: 'es', scope: ['Trabajo de confianza, limpio y a tiempo'] }, 201);
    await tryQ('a 90-minute window', { windows: [win('2026-10-12', '08:00', '09:30')] }, 422, /60 or 120/);
    await tryQ('a 3-hour window', { windows: [win('2026-10-12', '08:00', '11:00')] }, 422, /60 or 120/);
    await tryQ('a window starting 6:00 AM', { windows: [win('2026-10-12', '06:00', '08:00')] }, 422, /7:00 AM to 9:00 PM/);
    await tryQ('a window ending 9:30 PM', { windows: [win('2026-10-12', '19:30', '21:30')] }, 422, /7:00 AM to 9:00 PM/);
    await tryQ('Sunday 10/11', { windows: [win('2026-10-11', '08:00', '10:00')] }, 422, /Sunday/);
    await tryQ('30 Feb', { windows: [win('2027-02-30', '08:00', '10:00')] }, 422, /not a real date/);
    await tryQ('a garbage date', { windows: [win('next tuesday', '08:00', '10:00')] }, 422, /not a real date/);
    await tryQ('3 windows', { windows: [win('2026-10-12', '08:00', '10:00'), win('2026-10-13', '08:00', '10:00'), win('2026-10-14', '08:00', '10:00')] }, 422, /more than 2/);
    await tryQ('two windows that overlap', { windows: [win('2026-10-12', '08:00', '10:00'), win('2026-10-12', '09:00', '11:00')] }, 422, /overlap/);
    await tryQ('HTML in a scope line', { scope: ['<b>Patch</b> the holes'] }, 422, /HTML/);
    await tryQ('an HTML entity', { included: 'Paint &amp; cleanup included' }, 422, /HTML/);
    await tryQ('lang "fr"', { lang: 'fr' }, 422, /lang/);
    await tryQ('an older version', { version: 1 }, 409, /version/);
    R['11_sunday_allowed_note'] = 'ALLOW_SUNDAY is unset in this run; the Sunday rule reads env.ALLOW_SUNDAY === "true" exactly as FORM-WINDOWS-01 does';
  }

  /* ============================================================ (12) */
  suite('H · (12) the pushes: 11 PM waits for 7:00; a 500 is retried once; none pushes once');
  {
    /* 11:00 PM */
    const N = await submitAt(CT(...WED, 16, 0), 'Nadia Frost');
    const cn = (await create(N, Q(1, [win('2026-10-06', '08:00', '10:00')], { sent_at: CT(...WED, 16, 30) }), CT(...WED, 16, 30))).body.code;
    const bP = PO().length, bT = TG().length;
    const r = await byCode(cn, 1, null, CT(...WED, 23, 0));
    eq(r.state, 'booked', 'a page booking at 11:00 PM books');
    await sleep(300);
    eq(pushes(PO().slice(bP), N).length + pushes(TG().slice(bT), N).length, 0, 'nothing is sent at 11:00 PM');
    const quiet = [CT(...WED, 23, 30), CT(2026, 9, 24, 2, 0), CT(2026, 9, 24, 6, 55)];
    for (const q of quiet) await reconcileAt(q);
    eq(pushes(PO().slice(bP), N).length + pushes(TG().slice(bT), N).length, 0, 'nor by the runs at 11:30 PM, 2:00 AM, 6:55 AM');
    eq((await bookRows(N))[0].pushed_at, null, 'pushed_at stays null overnight');
    const o7 = await reconcileAt(CT(2026, 9, 24, 7, 0));
    eq(pushes(PO().slice(bP), N).length, 1, 'the 7:00 AM run sends exactly 1 Pushover push');
    eq(pushes(TG().slice(bT), N).length, 1, 'and 1 Telegram message');
    await reconcileAt(CT(2026, 9, 24, 7, 5));
    eq(pushes(PO().slice(bP), N).length + pushes(TG().slice(bT), N).length, 2, 'the 7:05 run adds nothing');
    R['12'].night = { job: N, booked_at: central(CT(...WED, 23, 0)), pushes_before_7: 0, at_7: { pushover: 1, telegram: 1, run: o7.pushed }, after_7_05: 0, pushed_at: (await bookRows(N))[0].pushed_at };

    /* a 500 from the fake Pushover */
    const P = await submitAt(CT(2026, 9, 24, 8, 0), 'Paco Linde');
    const cp = (await create(P, Q(1, [win('2026-10-07', '08:00', '10:00')], { sent_at: CT(2026, 9, 24, 9, 0) }), CT(2026, 9, 24, 9, 0))).body.code;
    stub.state.pushover = '500';
    const b2 = PO().length, t2 = TG().length;
    await byCode(cp, 1, null, CT(2026, 9, 24, 10, 0));
    stub.state.pushover = 'ok';
    await sleep(300);
    const first = pushes(PO().slice(b2), P);
    eq(first.length, 1, 'Pushover tried once, answered 500');
    eq(first[0] && first[0].answered, 500, '(it answered 500)');
    eq(pushes(TG().slice(t2), P).length, 1, 'Telegram delivered');
    const rowP = (await bookRows(P))[0];
    ok(rowP.pushed_at, 'pushed_at is set as soon as any channel delivers (D5)', rowP.pushed_at);
    ok(rowP.push_retry_json && JSON.parse(rowP.push_retry_json).channels.join() === 'pushover', 'only Pushover is owed a retry', rowP.push_retry_json);
    const b3 = PO().length, t3 = TG().length;
    await reconcileAt(CT(2026, 9, 24, 10, 5));
    const retry = pushes(PO().slice(b3), P);
    eq(retry.length, 1, 'the next reconcile retries Pushover once');
    eq(retry[0] && retry[0].answered, 200, 'and it goes');
    eq(pushes(TG().slice(t3), P).length, 0, 'Telegram is not sent again');
    const b4 = PO().length;
    await reconcileAt(CT(2026, 9, 24, 10, 10));
    eq(pushes(PO().slice(b4), P).length, 0, 'the run after that sends nothing');
    R['12'].pushover_500 = { job: P, first: { pushover: first.length, answered: first[0] && first[0].answered, telegram: 1, pushed_at: rowP.pushed_at, retry_owed: rowP.push_retry_json }, next_reconcile: { pushover: retry.length, answered: retry[0] && retry[0].answered, telegram: 0 }, after: 0 };

    /* none of these times work */
    const M = await submitAt(CT(2026, 9, 24, 8, 30), 'Mona Rask');
    const cm = (await create(M, Q(1, [win('2026-10-07', '10:00', '12:00')], { sent_at: CT(2026, 9, 24, 9, 0) }), CT(2026, 9, 24, 9, 0))).body.code;
    const b5 = PO().length, t5 = TG().length;
    const n1 = await noneBy(cm, 1, CT(2026, 9, 24, 11, 0));
    eq(n1.state, 'received', 'markNone → received');
    await sleep(300);
    const np = pushes(PO().slice(b5), M), nt = pushes(TG().slice(t5), M);
    eq(np.length, 1, 'one Pushover push');
    eq(nt.length, 1, 'one Telegram message');
    eq(np[0] && np[0].p.get('title'), `${M} · none of the times work`, 'the title as written');
    eq(np[0] && np[0].p.get('message'), 'text them other times', 'the message as written');
    ok(np[0] && leaks(np[0], M).length === 0, 'no link or contact details', np[0] && leaks(np[0], M).join(','));
    const n2 = await noneBy(cm, 1, CT(2026, 9, 24, 11, 5));
    await sleep(300);
    eq(n2.first, false, 'a second markNone is not the first');
    eq(pushes(PO().slice(b5), M).length + pushes(TG().slice(t5), M).length, 2, 'and pushes nothing more');
    const vm = await view(cm, CT(2026, 9, 24, 11, 5));
    eq(vm.state, 'received', 'viewByCode after none: received');
    ok((await md(M)).includes('`none_of_these_times`'), 'the record carries the event');
    R['12'].none = { job: M, first: n1.state, pushover: np.length, telegram: nt.length, title: np[0] && np[0].p.get('title'), message: np[0] && np[0].p.get('message'), second_first: n2.first, second_pushes: 0 };
    R['16'].push({ case: '(12) after none', state: vm.state });
  }

  /* ============================================================ (13) */
  suite('H · (13) the mirror: a failed stamp is healed');
  {
    const K = await submitAt(CT(2026, 9, 24, 12, 0), 'Kit Ambry');
    const at0 = CT(2026, 9, 24, 12, 30);
    const ck = (await create(K, Q(1, [win('2026-10-08', '08:00', '10:00')], { sent_at: at0 }), at0)).body.code;
    await failStamp(K);
    const bk = await byCode(ck, 1, null, CT(2026, 9, 24, 13, 0));
    eq(bk.state, 'booked', 'with the KV stamp made to fail, the book still says booked');
    const kr0 = (await bookRows(K))[0];
    ok(kr0.status === 'accepted' && kr0.mirrored_version < kr0.state_version, 'the row is ahead of the mirror', `status ${kr0.status}, mirrored ${kr0.mirrored_version} < state ${kr0.state_version}`);
    const rec0 = await row(K);
    eq(rec0.accept, null, 'and the KV record has no accept yet');
    const rc = await reconcileAt(CT(2026, 9, 24, 13, 5));
    ok(rc.stamped.includes(K), 'the next reconcile re-stamps it', JSON.stringify(rc.stamped));
    const rec1 = await row(K);
    eq(rec1.accept && rec1.accept.version, 1, 'record.accept is there');
    eq(rec1.status, 'scheduled', 'status scheduled');
    const kr1 = (await bookRows(K))[0];
    eq(kr1.mirrored_version, kr1.state_version, 'mirrored_version = state_version');
    R['13'] = { stamp_failed_once: { job: K, book: bk.state, row_before: { status: kr0.status, state_version: kr0.state_version, mirrored_version: kr0.mirrored_version }, kv_accept_before: rec0.accept, reconcile_stamped: rc.stamped, kv_accept_after: rec1.accept, row_after: { state_version: kr1.state_version, mirrored_version: kr1.mirrored_version } } };

    /* v1 accept → cancel → v2 accept with the v2 stamp failing */
    const K2 = await submitAt(CT(2026, 9, 24, 12, 5), 'Kai Brook');
    const a1 = CT(2026, 9, 24, 12, 40);
    const k21 = (await create(K2, Q(1, [win('2026-10-09', '08:00', '10:00')], { sent_at: a1 }), a1)).body.code;
    eq((await byCode(k21, 1, null, CT(2026, 9, 24, 12, 45))).state, 'booked', 'K2 v1 booked');
    await cancelQ(K2, 1, CT(2026, 9, 24, 12, 50));
    const k22 = (await create(K2, Q(2, [win('2026-10-09', '10:00', '12:00')], { price: 410, sent_at: CT(2026, 9, 24, 12, 55) }), CT(2026, 9, 24, 12, 55))).body.code;
    await failStamp(K2);
    eq((await byCode(k22, 2, null, CT(2026, 9, 24, 13, 0))).state, 'booked', 'K2 v2 booked with its stamp failing');
    const m0 = await row(K2);
    ok(m0.accept && m0.accept.version === 1 && m0.accept.cancelled_at, 'KV still shows the cancelled v1', JSON.stringify(m0.accept));
    await reconcileAt(CT(2026, 9, 24, 13, 10));
    const m1 = await row(K2);
    eq(m1.accept && m1.accept.version, 2, 'healed: record.accept is v2');
    eq(m1.accept && m1.accept.cancelled_at, undefined, 'not cancelled');
    eq(m1.status, 'scheduled', 'status scheduled');
    eq(m1.scheduled_for, '2026-10-09T15:00:00.000Z', 'scheduled_for Fri 10/9 10:00 AM CDT');
    eq(m1.quote && m1.quote.version, 2, 'record.quote is v2');
    ok((await bookRows(K2)).every((q) => q.mirrored_version === q.state_version), 'every row of the job mirrored');
    R['13'].v1_cancel_v2 = { job: K2, kv_before: m0.accept, kv_after: m1.accept, status: m1.status, scheduled_for: m1.scheduled_for, quote_version: m1.quote && m1.quote.version };

    /* D1: a failed accept stamp followed by a successful /sent is still healed */
    const L = await submitAt(CT(2026, 9, 24, 12, 10), 'Lark Denby');
    await create(L, Q(1, [win('2026-10-10', '08:00', '10:00')]), CT(2026, 9, 24, 13, 0));
    await failStamp(L);
    const la = await acceptQ(L, 1, 1, CT(2026, 9, 24, 13, 15));
    eq(la.body.state, 'booked', 'L booked by text with its stamp failing');
    eq((await row(L)).accept, null, 'KV has no accept');
    const ls = await sentQ(L, 1, CT(2026, 9, 24, 13, 20));
    eq(ls.status, 200, '/sent succeeds');
    const l1 = await row(L);
    eq(l1.accept && l1.accept.version, 1, 'and the /sent stamp carried the lost accept (the mirror is per job)');
    eq(l1.status, 'scheduled', 'status scheduled');
    ok((await bookRows(L)).every((q) => q.mirrored_version === q.state_version), 'mirrored');
    R['13'].failed_accept_then_sent = { job: L, kv_accept_after_sent: l1.accept, status: l1.status, quoted_at: l1.quoted_at };
  }

  /* ============================================================ (14) */
  suite("H · (14) the collector's view: /api/jobs and the markdown");
  {
    const r = await row(Hj);
    ok(r.accept && r.accept.version === 1 && r.accept.by === 'page', '/api/jobs carries record.accept', JSON.stringify(r.accept));
    ok(r.quote && r.quote.version === 1 && r.quote.hold_until && Array.isArray(r.quote.windows), '/api/jobs carries record.quote', JSON.stringify(r.quote));
    eq(JSON.stringify(r).includes('token_hash'), false, 'with no code hash in it');
    const m = await md(Hj);
    const sec = m.slice(m.indexOf('## E2 · ACCEPTED'), m.indexOf('## F ·'));
    ok(sec.startsWith('## E2 · ACCEPTED'), 'the export carries the Accepted section');
    ok(sec.includes('2026-09-29 (Tue)'), 'the day', sec.split('\n').find((l) => l.includes('**Day**')));
    ok(sec.includes('2–4 PM Central'), 'the window', sec.split('\n').find((l) => l.includes('Arrival')));
    ok(sec.includes('$395'), 'the price');
    ok(sec.includes('page — they tapped'), 'by page');
    ok(sec.includes('v1'), 'the version');
    const t = await md((await jobs()).find((j) => j.accept && j.accept.by === 'text').id);
    ok(t.includes('text — a YES he marked'), 'and a text booking says so');
    R['14'] = { api_jobs_accept: r.accept, api_jobs_quote: r.quote, export_section: sec.trim() };
  }

  /* ============================================================ (16) */
  suite('H · (16) viewByCode: every state, the count rising, KV untouched');
  {
    const at = CT(2026, 9, 24, 14, 0);
    const before = still(await row(B));
    const kvRaw0 = JSON.stringify(await row(B));
    const v1 = await view(codeB, at), v2 = await view(codeB, at), v3 = await view(codeB, at);
    eq(v2.views, v1.views + 1, 'the view count rises by one per visit');
    eq(v3.views, v1.views + 2, 'and again');
    eq((await bookRows(B))[0].views, v3.views, "on the book's row");
    eq(still(await row(B)), before, 'the KV record is byte-identical across the views');
    const nf = await view('A'.repeat(22), at);
    eq(nf.state, 'not_found', 'an unknown code: not_found');
    const bad = await view('short', at);
    eq(bad.state, 'not_found', 'a malformed code: not_found');
    R['16'].push({ case: 'unknown code (22 A)', state: nf.state }, { case: 'malformed code', state: bad.state });
    const need = ['open', 'booked', 'taken', 'updating', 'replaced', 'hold_ended', 'too_close', 'withdrawn', 'received', 'not_found'];
    const seen = new Set(R['16'].map((x) => x.state));
    eq(need.filter((s) => !seen.has(s)).join(','), '', 'all ten states were seen');
    R['16_count'] = { job: B, views: [v1.views, v2.views, v3.views], kv_identical: still(await row(B)) === before, kv_row_len: kvRaw0.length };
    /* the Flux Capacitor's GET, never the code */
    const s = await stateQ(Hj, at);
    eq(s.status, 200, 'GET /admin/quote/<id> answers');
    eq(JSON.stringify(s.body).includes('token_hash') || JSON.stringify(s.body).includes('code'), false, 'and carries neither the code nor its hash');
    R['16_admin_get'] = s.body;
  }

  return R;
}
