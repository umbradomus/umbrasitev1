/* THE QUOTE LINK, BEHIND THE PAGE — ACCEPT-PAGE-01, 2026-09-23.
   His words: "and then in our 2 hour response we will give them the quote and select one of the times
   they suggested. and then if they accept the quote we will have the date and time."

   The quote goes as a text (his hand, R34) ending in a link on our own domain, /q/<code>. This file is
   everything behind that link except the page itself (ACCEPT-PAGE-02 builds the page on top of it):

     · the admin routes the Flux Capacitor calls (create · sent · accept · cancel · state) — QUOTE-API.md
     · THE SEAM the page uses, and every caller uses only these three:
         viewByCode(env, code, nowIso)                        — one book call; counts the visit
         bookByCode(env, code, version, window, by, nowIso)   — the booking step, then the stamp, then the push
         markNone(env, code, version, nowIso)                 — "none of these times work", same shape
     · the stamp (the KV job record as the mirror of the book, rebuilt per JOB from all its rows)
     · the push to his phone on a page booking and on "none", only 7 AM–9 PM Central
     · reconcile(env, nowIso), which the 5-minute scheduled run calls after runAlerts

   THE CODE: 22 characters of base62 from crypto.getRandomValues with rejection sampling — about 131 bits.
   Never the job number, a date or a counter (lane D round 3 §1 item 12: /q/U0099 was guessable). It is
   returned ONCE by the create route and never stored, never logged: the book keeps sha256(code).

   THE HOLD (lane D round 3 §1 item 11 · R39 — settled before the materials-buying morning):
     cutoff     = 9:00 PM Central two days before the EARLIEST offered window's date. Already past when
                  the quote is created → short_notice, cutoff = that window's start − 12 hours; past too →
                  refused, "too soon to hold".
     hold_until = the earlier of (sent_at, or created_at until it is sent) + 48 real hours, and cutoff.
     A page booking is allowed while now < cutoff and the time is free; after hold_until the time is no
     longer held for them but is still open. A YES by text is his call and ignores both.
   Every Central wall-clock moment comes from biztime.js's Intl path; the 48 hours are UTC arithmetic. */

import { getRecord, putRecord, addEvent } from './store.js';
import { sha256hex, minutesBetween, newToken } from './util.js';
import { chicagoWall, isOpen } from './biztime.js';
import { sendAlert } from './notify.js';
import { acknowledge } from './alerts.js';

export const CODE_LEN = 22;
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_RE = /^[A-Za-z0-9]{22}$/;
const HOLD_MS = 48 * 3600000;
const SHORT_NOTICE_MS = 12 * 3600000;
const LINE_MAX = 400;
const SCOPE_MAX = 20;

/* ------------------------------------------------------------ the code */

/** 22 base62 characters. A byte ≥ 248 is thrown away, so every character is equally likely (248 = 4 × 62). */
export function newQuoteCode() {
  let out = '';
  while (out.length < CODE_LEN) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    for (const x of b) {
      if (x >= 248) continue;
      out += BASE62[x % 62];
      if (out.length === CODE_LEN) break;
    }
  }
  return out;
}

export async function codeHash(code) {
  return sha256hex(new TextEncoder().encode(String(code)));
}

function book(env) {
  return env.BOOK.get(env.BOOK.idFromName('book'));
}

/* ------------------------------------------------------------ the words (R33 · R38) */

/* R33: never "licensed" or "bonded", in either language — whole words, any case (AMENDMENT 1 D3), so
   "confianza" (trust) passes and "fianza" does not. */
const BANNED = /\b(licensed|bonded|licencia|licenciado|fianza|afianzado)\b/i;
/* R38: one price. A dollar figure anywhere but price_note (the labour arithmetic, "5 hours at $45") and
   the insurance line (its coverage limit, "$1M") is a second price or an itemised material. */
const MONEY = /\$\s*\d|\d[\d,.]*\s*(?:dollars?|d[oó]lares|usd|bucks)\b|\bUS\s*\$/i;
/* Plain text only: a tag or an entity is refused, never stored. Escaping is the page's job. */
const HTMLISH = /<[^>]*>|<\/?[a-z!]|&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i;

function lineProblem(name, v, { money }) {
  if (typeof v !== 'string') return `${name} must be text`;
  const s = v.trim();
  if (!s) return `${name} is empty`;
  if (/[\r\n]/.test(s)) return `${name} must be one line`;
  if (s.length > LINE_MAX) return `${name} is longer than ${LINE_MAX} characters`;
  if (HTMLISH.test(s)) return `${name} carries HTML; send plain text`;
  const w = BANNED.exec(s);
  if (w) return `${name} says "${w[1]}" (R33: never licensed or bonded)`;
  if (!money && MONEY.test(s)) return `${name} carries a dollar amount (R38: one price; materials never itemised)`;
  return null;
}

/* ------------------------------------------------------------ the calendar */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function realDate(s) {
  const m = DATE_RE.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, mo, d, dow: t.getUTCDay() };
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** The instant a window starts, on Chicago's own clock. */
export function windowStartMs(w) {
  const d = realDate(w.date);
  const [h, mi] = w.start.split(':').map(Number);
  return chicagoWall(d.y, d.mo, d.d, h, mi);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function h12(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return { t: `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''}`, ap: h < 12 ? 'AM' : 'PM' };
}

/** "Tue 9/29 8–10 AM" · "Tue 9/29 11 AM–1 PM" — the day and window as his push names them. */
export function windowLabel(w) {
  const d = realDate(w.date);
  const a = h12(toMin(w.start)), b = h12(toMin(w.end));
  const span = a.ap === b.ap ? `${a.t}–${b.t} ${b.ap}` : `${a.t} ${a.ap}–${b.t} ${b.ap}`;
  return `${DOW[d.dow]} ${d.mo}/${d.d} ${span}`;
}

/* ------------------------------------------------------------ the hold */

/**
 * { cutoff, hold_until, short_notice } for these windows, created at `createdIso`, sent at `sentIso`
 * (or not yet). { error } when even the short-notice cutoff has passed.
 */
export function holdFor(windows, createdIso, sentIso, shortNotice = null) {
  const earliest = windows.slice().sort((a, b) => windowStartMs(a) - windowStartMs(b))[0];
  const d = realDate(earliest.date);
  const created = Date.parse(createdIso);
  let cutoff = chicagoWall(d.y, d.mo, d.d - 2, 21, 0);
  let short = false;
  if (shortNotice === true || (shortNotice === null && created >= cutoff)) {
    short = true;
    cutoff = windowStartMs(earliest) - SHORT_NOTICE_MS;
    if (shortNotice === null && created >= cutoff) return { error: 'too soon to hold' };
  }
  const from = Date.parse(sentIso || createdIso);
  const hold = Math.min(from + HOLD_MS, cutoff);
  return { cutoff: new Date(cutoff).toISOString(), hold_until: new Date(hold).toISOString(), short_notice: short };
}

/* ------------------------------------------------------------ validation (the create route) */

/** The body of POST /admin/quote/<id>, checked. { error, status } or { quote }. */
export function readQuoteBody(b, env) {
  const bad = (reason, status = 422) => ({ error: reason, status });
  if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('the body must be a JSON object', 400);
  if (!Number.isInteger(b.version) || b.version < 1) return bad('version must be a whole number, 1 or more');
  if (typeof b.price !== 'number' || !isFinite(b.price) || !(b.price > 0)) return bad('price must be one positive number (dollars)');
  if (!Array.isArray(b.scope) || !b.scope.length) return bad('scope must be a list of one or more plain lines');
  if (b.scope.length > SCOPE_MAX) return bad(`scope has more than ${SCOPE_MAX} lines`);
  const lines = [];
  b.scope.forEach((s, i) => lines.push([`scope line ${i + 1}`, s, false]));
  for (const k of ['included', 'guarantee']) if (b[k] != null) lines.push([k, b[k], false]);
  if (b.price_note != null) lines.push(['price_note', b.price_note, true]);
  if (b.insurance != null) lines.push(['insurance', b.insurance, true]);
  for (const [name, v, money] of lines) {
    const p = lineProblem(name, v, { money });
    if (p) return bad(p);
  }
  const lang = b.lang == null ? 'en' : b.lang;
  if (lang !== 'en' && lang !== 'es') return bad('lang must be "en" or "es"');
  if (b.sent_at != null && (typeof b.sent_at !== 'string' || isNaN(Date.parse(b.sent_at)))) return bad('sent_at must be an ISO time');

  if (!Array.isArray(b.windows) || !b.windows.length) return bad('windows must be a list of 1 or 2 times');
  if (b.windows.length > 2) return bad('more than 2 windows');
  const windows = [];
  for (const [i, w] of b.windows.entries()) {
    const n = `window ${i + 1}`;
    if (!w || typeof w !== 'object') return bad(`${n} must be {date, start, end}`);
    const d = realDate(w.date);
    if (!d) return bad(`${n}: ${JSON.stringify(w.date)} is not a real date (YYYY-MM-DD)`);
    if (!TIME_RE.test(String(w.start)) || !TIME_RE.test(String(w.end))) return bad(`${n}: start and end must be HH:MM`);
    const len = toMin(w.end) - toMin(w.start);
    if (len !== 60 && len !== 120) return bad(`${n}: a window is 60 or 120 minutes (R37), this one is ${len}`);
    if (toMin(w.start) < 7 * 60 || toMin(w.end) > 21 * 60) return bad(`${n}: outside 7:00 AM to 9:00 PM Central (R32)`);
    if (d.dow === 0 && String(env.ALLOW_SUNDAY) !== 'true') return bad(`${n}: ${w.date} is a Sunday`);
    windows.push({ date: w.date, start: w.start, end: w.end });
  }
  if (windows.length === 2 && windows[0].date === windows[1].date
      && toMin(windows[0].start) < toMin(windows[1].end) && toMin(windows[1].start) < toMin(windows[0].end)) {
    return bad('the two windows overlap');
  }
  const clean = (s) => (s == null ? null : String(s).trim());
  return {
    quote: {
      version: b.version,
      lang,
      sent_at: b.sent_at ? new Date(b.sent_at).toISOString() : null,
      windows,
      body: {
        price: b.price,
        price_note: clean(b.price_note),
        scope: b.scope.map((s) => s.trim()),
        included: clean(b.included),
        guarantee: clean(b.guarantee),
        insurance: clean(b.insurance),
      },
    },
  };
}

/* ------------------------------------------------------------ the admin side */

export async function createQuote(env, jobId, input, nowIso) {
  const rec = await getRecord(env, jobId);
  if (!rec) return { status: 404, body: { error: 'not_found' } };
  const hold = holdFor(input.windows, nowIso, input.sent_at);
  if (hold.error) return { status: 422, body: { error: hold.error } };
  const code = newQuoteCode();
  const first = String((rec.fields || {}).name || '').trim().split(/\s+/)[0] || '';
  const r = await book(env).create({
    token_hash: await codeHash(code), job_id: jobId, version: input.version, created_at: nowIso, sent_at: input.sent_at,
    hold_until: hold.hold_until, cutoff: hold.cutoff, short_notice: hold.short_notice, lang: input.lang,
    /* the page greets them by first name ("Hi Ana,"); it never reaches a push */
    body: { ...input.body, first_name: first.slice(0, 40) }, windows: input.windows,
  });
  if (r.error === 'accepted') return { status: 409, body: { error: 'accepted', reason: 'this job already has an accepted quote; a change after booking is a change order' } };
  if (r.error === 'version_not_newer') return { status: 409, body: { error: 'version_not_newer', reason: `version must be greater than ${r.newest}`, newest: r.newest } };
  await stampSafe(env, jobId, nowIso);
  const base = String(env.QUOTE_LINK_BASE || 'https://umbradomus.com').replace(/\/+$/, '');
  return {
    status: 201,
    body: { code, url: `${base}/q/${code}`, version: input.version, hold_until: hold.hold_until, cutoff: hold.cutoff, short_notice: hold.short_notice },
  };
}

export async function markSent(env, jobId, version, sentIso, nowIso) {
  const b = book(env);
  const cur = (await b.job(jobId, nowIso)).rows.find((r) => r.version === version);
  if (!cur) return { status: 404, body: { error: 'not_found' } };
  const hold = holdFor(cur.windows, cur.created_at, sentIso, cur.short_notice);
  const r = await b.sent(jobId, version, sentIso, hold.hold_until);
  if (r.error === 'not_found') return { status: 404, body: { error: 'not_found' } };
  if (r.error) return { status: 409, body: { error: r.error, ...(r.newest ? { newest: r.newest } : {}) } };
  const rec = await stampSafe(env, jobId, nowIso);
  return {
    status: 200,
    body: {
      ok: true, version, sent_at: sentIso, hold_until: hold.hold_until, cutoff: cur.cutoff,
      record: rec ? { status: rec.status, quoted_at: rec.quoted_at, minutes_to_quote: rec.minutes_to_quote, quote_amount: rec.quote_amount } : null,
    },
  };
}

export async function cancelQuote(env, jobId, version, nowIso) {
  const r = await book(env).cancel(jobId, version, nowIso);
  if (r.state === 'not_found') return { status: 404, body: { error: 'not_found' } };
  await stampSafe(env, jobId, nowIso);
  return { status: 200, body: { state: 'withdrawn', version, already: Boolean(r.already), freed: r.freed ? freedOf(r.freed) : null } };
}

function freedOf(b) {
  const t = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { date: b.date, start: t(b.start_min), end: t(b.end_min) };
}

/** GET /admin/quote/<id> — every version's state for the Flux Capacitor. Never the code, never its hash. */
export async function quoteState(env, jobId, nowIso) {
  const { rows, bookings } = await book(env).job(jobId, nowIso);
  if (!rows.length) return null;
  const pub = (r) => ({
    version: r.version, status: r.status, state: r.state, created_at: r.created_at, sent_at: r.sent_at,
    hold_until: r.hold_until, held: Date.parse(nowIso) < Date.parse(r.hold_until) && r.status === 'open',
    cutoff: r.cutoff, short_notice: r.short_notice, lang: r.lang,
    price: r.body.price, price_note: r.body.price_note, scope: r.body.scope, included: r.body.included,
    guarantee: r.body.guarantee, insurance: r.body.insurance,
    windows: r.windows_free.map((w) => ({ n: w.n, date: w.date, start: w.start, end: w.end, free: w.free, label: windowLabel(w) })),
    accepted_at: r.accepted_at, accepted_by: r.accepted_by, accepted_window: r.accepted_window,
    none_at: r.none_at, cancelled_at: r.cancelled_at, views: r.views, last_view_at: r.last_view_at,
    pushed_at: r.pushed_at, push_kind: r.push_kind,
    mirrored: r.mirrored_version >= r.state_version,
  });
  const all = rows.map(pub);
  return {
    job_id: jobId, now: nowIso, current: all[all.length - 1], versions: all,
    booking: bookings.length ? { ...freedOf(bookings[0]), version: bookings[0].version, booked_at: bookings[0].booked_at } : null,
  };
}

/* ------------------------------------------------------------ THE SEAM (ACCEPT-PAGE-02 calls only these) */

function answerOf(r, extra = {}) {
  const row = r.row;
  return {
    state: r.state,
    ...(row ? {
      job_id: row.job_id, version: row.version, lang: row.lang,
      window: row.accepted_window ? { n: row.accepted_window, ...row.windows[row.accepted_window - 1] } : null,
      price: row.body.price, accepted_by: row.accepted_by, accepted_at: row.accepted_at,
    } : {}),
    ...extra,
  };
}

/**
 * THE BOOKING STEP. `by` is "page" (the customer's tap) or "text" (a YES he marks). One book call does
 * the checks and the booking together; then the KV stamp; then, for a page booking, his phone.
 * Answers { state: booked | already_booked | not_found | replaced | updating | withdrawn | taken |
 * too_close | choose_window | no_such_window, … }.
 */
export async function bookByCode(env, code, version, window, by, nowIso) {
  if (!CODE_RE.test(String(code || ''))) return { state: 'not_found' };
  const hash = await codeHash(code);
  return finishBooking(env, await book(env).book({ token_hash: hash }, Number(version), window, by === 'text' ? 'text' : 'page', nowIso), hash, nowIso);
}

/** The same step by job id — POST /admin/quote/<id>/accept, a texted YES. */
export async function bookByJob(env, jobId, version, window, nowIso) {
  const r = await book(env).book({ job_id: jobId }, Number(version), window, 'text', nowIso);
  return finishBooking(env, r, r.row && r.row.token_hash, nowIso);
}

async function finishBooking(env, r, hash, nowIso) {
  if (r.state !== 'booked') return answerOf(r, r.clash ? { taken_by_other_job: true } : {});
  await stampSafe(env, r.row.job_id, nowIso);
  if (r.row.accepted_by === 'page') await pushRow(env, hash, nowIso);
  return answerOf(r);
}

/** "None of these times work." Once per version: the first call stamps and pushes, a second does nothing. */
export async function markNone(env, code, version, nowIso) {
  if (!CODE_RE.test(String(code || ''))) return { state: 'not_found' };
  const hash = await codeHash(code);
  const r = await book(env).none(hash, Number(version), nowIso);
  if (r.state === 'received' && r.first) {
    await stampSafe(env, r.row.job_id, nowIso);
    await pushRow(env, hash, nowIso);
  }
  return answerOf(r, r.state === 'received' ? { first: Boolean(r.first), none_at: r.row.none_at } : {});
}

/**
 * What the page shows. ONE book call; it counts the visit on the book's row and never touches KV.
 * { state: open | hold_ended | taken | too_close | booked | updating | replaced | withdrawn | received |
 *   not_found, body, windows [{n, date, start, end, free}], hold_until, cutoff, lang, job_id, version }
 */
export async function viewByCode(env, code, nowIso) {
  if (!CODE_RE.test(String(code || ''))) return { state: 'not_found' };
  const v = await book(env).view(await codeHash(code), nowIso, true);
  if (v.state === 'not_found') return { state: 'not_found' };
  const row = v.row;
  return {
    state: v.state, body: row.body,
    windows: v.windows.map((w) => ({ n: w.n, date: w.date, start: w.start, end: w.end, free: w.free })),
    accepted_window: row.accepted_window, hold_until: row.hold_until, cutoff: row.cutoff, short_notice: row.short_notice,
    lang: row.lang, job_id: row.job_id, version: row.version, views: row.views,
  };
}

/* ------------------------------------------------------------ THE STAMP — the KV record as the book's mirror */

/**
 * Rebuilds the job's whole projection from ALL its rows (AMENDMENT 1 D1): record.quote from the newest
 * version; record.accept, status, scheduled_for and scheduled_at from the accepted (or cancelled) row;
 * the QUOTED path from the first version marked sent. Idempotent: running it twice changes nothing the
 * second time, so the reconcile can run it on any job whose rows are ahead of the mirror. Only after the
 * KV write lands does every row of the job get mirrored_version = the state_version this rebuild read.
 */
export async function stampJob(env, jobId, nowIso) {
  const b = book(env);
  const { rows } = await b.job(jobId, nowIso);
  if (!rows.length) return null;
  const rec = await getRecord(env, jobId);
  if (!rec) return null;
  await testFailStamp(env, jobId);

  const acks = [];
  const newest = rows[rows.length - 1];
  const prevQuote = rec.quote || {};
  const sentSeen = Array.isArray(prevQuote.sent_versions) ? prevQuote.sent_versions.slice() : [];
  const hasEvent = (type, pred) => (rec.events || []).some((e) => e.type === type && pred(e));

  /* 1 · every version marked sent, in the order it went: the first stops the clock (the admin page's
     QUOTED path, exactly), a later one only moves the price and says so. Never overwrites quoted_at
     (R26's measurement), never moves status back from scheduled or done. */
  for (const r of rows.filter((x) => x.sent_at).sort((a, c) => Date.parse(a.sent_at) - Date.parse(c.sent_at))) {
    const seenKey = r.version + '@' + r.sent_at;
    if (sentSeen.includes(seenKey)) continue;
    sentSeen.push(seenKey);
    if (!rec.quoted_at) {
      const at = r.sent_at;
      rec.quoted_at = at;
      rec.minutes_to_quote = minutesBetween(rec.received_at, at);
      if (rec.status === 'received') rec.status = 'quoted';
      rec.quote_amount = r.body.price;
      addEvent(rec, 'quoted', { quote_amount: r.body.price, minutes_to_quote: rec.minutes_to_quote }, at);
      acks.push(['quote:sent', at]);
    } else {
      rec.quote_amount = r.body.price;
      if (!hasEvent('quote_sent', (e) => e.version === r.version && e.at === r.sent_at)) addEvent(rec, 'quote_sent', { version: r.version, price: r.body.price }, r.sent_at);
    }
  }

  /* 2 · none of these times work */
  for (const r of rows) {
    if (r.none_at && !hasEvent('none_of_these_times', (e) => e.version === r.version)) addEvent(rec, 'none_of_these_times', { version: r.version }, r.none_at);
  }

  /* 3 · the booking, and a booking withdrawn */
  const accepted = rows.find((r) => r.status === 'accepted');
  for (const r of rows.filter((x) => x.accepted_at).sort((a, c) => Date.parse(a.accepted_at) - Date.parse(c.accepted_at))) {
    const w = r.windows[r.accepted_window - 1];
    if (!hasEvent('accepted', (e) => e.version === r.version && e.accepted_at === r.accepted_at)) {
      addEvent(rec, 'accepted', { version: r.version, by: r.accepted_by, window: w, price: r.body.price, accepted_at: r.accepted_at }, r.accepted_at);
    }
    if (r.cancelled_at && !hasEvent('booking-cancelled', (e) => e.version === r.version && e.accepted_at === r.accepted_at)) {
      addEvent(rec, 'booking-cancelled', { version: r.version, accepted_at: r.accepted_at }, r.cancelled_at);
    }
  }
  if (accepted) {
    const w = accepted.windows[accepted.accepted_window - 1];
    const fresh = !rec.accept || rec.accept.version !== accepted.version || rec.accept.at !== accepted.accepted_at || rec.accept.cancelled_at;
    rec.accept = { at: accepted.accepted_at, by: accepted.accepted_by, version: accepted.version, window: { date: w.date, start: w.start, end: w.end }, price: accepted.body.price };
    rec.accepted_at = accepted.accepted_at;
    rec.quote_amount = accepted.body.price;
    if (rec.status !== 'done') rec.status = 'scheduled';
    rec.scheduled_for = new Date(windowStartMs(w)).toISOString();
    rec.scheduled_at = accepted.accepted_at;
    if (!rec.quoted_at) {
      /* booked before any version was marked sent: the clock stops at the quote's own time, and says so */
      const at = accepted.sent_at || accepted.created_at;
      rec.quoted_at = at;
      rec.minutes_to_quote = minutesBetween(rec.received_at, at);
      addEvent(rec, 'quoted', { quote_amount: accepted.body.price, minutes_to_quote: rec.minutes_to_quote, from: 'accept', note: 'quoted_at set from the accepted quote v' + accepted.version + (accepted.sent_at ? ' sent_at' : ' created_at (never marked sent)') }, at);
    }
    if (fresh) acks.push(['accept', nowIso]);
  } else if (rec.accept && !rec.accept.cancelled_at) {
    const was = rows.find((r) => r.version === rec.accept.version);
    rec.accept.cancelled_at = (was && was.cancelled_at) || nowIso;
    if (rec.status === 'scheduled') rec.status = 'quoted';
    rec.scheduled_for = null;
    rec.scheduled_at = null;
  }

  /* 4 · the quote as the Flux Capacitor and the collector read it — the newest version. Never the code. */
  rec.quote = {
    version: newest.version, status: newest.status, state: newest.state, sent_at: newest.sent_at,
    hold_until: newest.hold_until, cutoff: newest.cutoff, short_notice: newest.short_notice,
    windows: newest.windows, price: newest.body.price, none_at: newest.none_at,
    views: newest.views, last_view_at: newest.last_view_at, sent_versions: sentSeen,
  };

  await putRecord(env, rec);
  await b.mirrored(jobId, Object.fromEntries(rows.map((r) => [r.token_hash, r.state_version])));
  for (const [by, at] of acks) {
    try { await acknowledge(env, jobId, by, at); } catch (err) { console.error('acknowledge failed for', jobId, err); }
  }
  return getRecord(env, jobId);
}

/** The stamp after an event. A failed KV write never fails the event — the book already holds it, the
    rows stay ahead of the mirror, and the next 5-minute run re-stamps them. Answers the record or null. */
async function stampSafe(env, jobId, nowIso) {
  try {
    return await stampJob(env, jobId, nowIso);
  } catch (err) {
    console.error('stamp failed for', jobId, '- the reconcile will heal it:', String(err && err.message || err));
    return null;
  }
}

/** Test hook only: a KV key the suite plants makes the next stamp for that job fail once. */
async function testFailStamp(env, jobId) {
  if (String(env.ALLOW_TEST_HOOKS) !== 'true') return;
  const k = 'test:fail-stamp:' + jobId;
  const n = parseInt((await env.RECORDS.get(k)) || '0', 10);
  if (n > 0) {
    if (n > 1) await env.RECORDS.put(k, String(n - 1)); else await env.RECORDS.delete(k);
    throw new Error('test: the KV stamp for ' + jobId + ' was made to fail');
  }
}

/* ------------------------------------------------------------ THE PUSH */

function money(n) {
  return '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
}

/** The only two messages this file writes. The job id, the day and window, the price — no link (R25),
    no name, phone, address or email. */
export function buildPush(kind, row) {
  if (kind === 'accept') {
    const w = row.windows[row.accepted_window - 1];
    return { title: `ACCEPTED · ${row.job_id} · ${windowLabel(w)}`, message: `${money(row.body.price)} · v${row.version}`, priority: 1 };
  }
  return { title: `${row.job_id} · none of the times work`, message: 'text them other times', priority: 1 };
}

/** Sends this row's due push if it is 7 AM–9 PM Central; otherwise leaves it for the first run from 7:00. */
async function pushRow(env, hash, nowIso) {
  if (!isOpen(Date.parse(nowIso))) return { held: true };
  const b = book(env);
  const claim = newToken();
  const c = await b.claimPush(hash, claim, nowIso);
  if (!c) return null;
  const msg = buildPush(c.kind, c.row);
  let results;
  try {
    results = await sendAlert(env, msg, c.only || undefined);
  } catch (err) {
    results = [{ channel: 'all', ok: false, retry: true, error: String(err && err.message || err) }];
  }
  const slim = results.filter((r) => !r.skipped).map((r) => ({ channel: r.channel, ok: Boolean(r.ok), retry: Boolean(r.retry), status: r.status }));
  await b.finishPush(hash, claim, c.attempt, c.kind, slim, nowIso);
  return { job_id: c.row.job_id, kind: c.kind, attempt: c.attempt, results: slim };
}

/* ------------------------------------------------------------ THE RECONCILE */

/**
 * After runAlerts, every 5 minutes: every job whose rows are ahead of the KV mirror is re-stamped (no KV
 * list), and every push still owed — held overnight, or a channel that answered 5xx — is sent.
 */
export async function reconcile(env, nowIso) {
  const out = { now: nowIso, stamped: [], stamp_failed: [], pushed: [] };
  if (!env.BOOK) return out;
  const b = book(env);
  for (const jobId of await b.unmirroredJobs()) {
    try { await stampJob(env, jobId, nowIso); out.stamped.push(jobId); }
    catch (err) { out.stamp_failed.push(jobId); console.error('reconcile stamp failed for', jobId, String(err && err.message || err)); }
  }
  if (isOpen(Date.parse(nowIso))) {
    for (const hash of await b.pushesDue()) {
      const p = await pushRow(env, hash, nowIso);
      if (p && !p.held) out.pushed.push(p);
    }
  }
  return out;
}

/* ------------------------------------------------------------ test hook only */

export async function bookDump(env) {
  return book(env).dump();
}
