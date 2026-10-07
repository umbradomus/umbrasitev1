/* THE QUOTE LINK, BEHIND THE PAGE — ACCEPT-PAGE-01, 2026-09-23.
   His words: "and then in our 2 hour response we will give them the quote and select one of the times
   they suggested. and then if they accept the quote we will have the date and time."

   The quote goes as a text (his hand, R34) ending in a link on our own domain, /q/<code>. This file is
   everything behind that link except the page itself (ACCEPT-PAGE-02 builds the page on top of it):

     · the admin routes the Flux Capacitor calls (create · sent · accept · cancel · state) — QUOTE-API.md
     · THE SEAM the page uses, and every caller uses only these three:
         viewByCode(env, code, nowIso)                        — one book call; counts the visit
         bookByCode(env, code, version, option, by, nowIso)   — the booking step, then the stamp, then the push
                                                                (road W: `option` was `window`; the same number on an old quote)
         markNone(env, code, version, nowIso)                 — "none of these times work", same shape
     · the stamp (the KV job record as the mirror of the book, rebuilt per JOB from all its rows)
     · the push to his phone on a page booking and on "none", only 7 AM–9 PM Central
     · reconcile(env, nowIso), which the 5-minute scheduled run calls after runAlerts

   THE CODE: 22 characters of base62 from crypto.getRandomValues with rejection sampling — about 131 bits.
   Never the job number, a date or a counter (lane D round 3 §1 item 12: /q/U0099 was guessable). It is
   returned ONCE by the create route and never stored, never logged: the book keeps sha256(code).
   road FW: for a job with its own secret the 22 characters are MADE (HMAC of that secret) instead of drawn, so the
   status page can make the link again — see madeQuoteCode below. Still never the job number, a date or a counter.

   THE HOLD (lane D round 3 §1 item 11 · R39 — settled before the materials-buying morning):
     cutoff     = 9:00 PM Central two days before the EARLIEST offered window's date. Already past when
                  the quote is created → short_notice, cutoff = that window's start − 12 hours; past too →
                  refused, "too soon to hold".
     hold_until = the earlier of (sent_at, or created_at until it is sent) + 48 real hours, and cutoff.
     A page booking is allowed while now < cutoff and the time is free; after hold_until the time is no
     longer held for them but is still open. A YES by text is his call and ignores both.
   Every Central wall-clock moment comes from biztime.js's Intl path; the 48 hours are UTC arithmetic.

   THE PROMISE THE CUSTOMER READS IS A FLOOR (D-CEO11-10, CEO seat 11, 2026-10-07, PROVISIONAL — only Drew
   promotes). A TEST quote sent at 8:07 PM told a customer their times were held until 9:00 PM: fifty-three
   minutes, because the cutoff was 9:00 PM and the hold is bounded by it. So:
     promise    = 9:00 PM Central the same day for a quote sent BEFORE 3:00 PM Central; 12:00 noon Central
                  the NEXT day for one sent at or after 3:00 PM.
     hold_until = the promise as a FLOOR, never a cap — where the 48-hour-and-cutoff line above already
                  holds LONGER, the longer one stands (the defect is a hold too short; shortening one is a
                  new defect).
     the bound  = the hold never reaches the short-notice floor, the first held time less 12 hours, so it
                  never outlives the START of the time it holds and the 12 hours are never spent.
     the door   = the cutoff is lifted to hold_until wherever hold_until is later, never lowered, so the
                  book (quotebook.js:375) never refuses a time the customer's page says is held.
   The 48-hour span, the short-notice road's 12 hours and the 9:00 PM-two-days-before cutoff are unchanged:
   this rule only ever lifts. ONE PLACE COMPUTES IT — holdFor below, and nothing else.

   CHANGE ORDERS (road CO, 2026-09-26) — "have that create a new work order that we can get signed before we buy
   anything else". POST /admin/quote/<id> with kind "change" makes one (numbered "Change 1", its own link on the same
   /q/ road, its code made from the job's secret like a quote's); /sent and /cancel take kind "change" too. The customer
   OKs it on its page with their name typed as the signature — or says no thanks — and his phone gets
   "CHANGE OK · U-9601 · $85" (the job number, never the name). The quote, its booking and its hold are never touched,
   and GET /admin/quote/<id> gains a `changes` list only when the job has one.

   THE CONFIRMATION TEXT (CONFIRM-01, 2026-10-04). U-0015 booked a time at 07:46 and heard nothing. Now every booking —
   the page's tap and the texted YES alike, both through finishBooking below — gets ONE confirmation text from the website
   itself (confirm.js: consent and STOP honoured, 9 PM–7 AM queued for the first run from 7:00, never a retry), and where
   that stands rides on the booking row as `confirmation`, mirrored to the KV record, GET /admin/quote/<id> and /api/jobs. */

import { getRecord, putRecord, addEvent } from './store.js';
import { sha256hex, minutesBetween, newToken } from './util.js';
import { chicagoWall, chicagoParts, isOpen } from './biztime.js';
import { sendAlert } from './notify.js';
import { acknowledge } from './alerts.js';
import { confirmRow, confirmDue } from './confirm.js';

export const CODE_LEN = 22;
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_RE = /^[A-Za-z0-9]{22}$/;
const HOLD_MS = 48 * 3600000;
const SHORT_NOTICE_MS = 12 * 3600000;
const PROMISE_HOUR = 15;      /* D-CEO11-10: the Central hour that moves the promise to the next day */
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

/* road FW (2026-09-26) · THE CODE, MADE — so the customer's status page can open their quote. The code is still never
   stored and never logged (the book keeps only its sha256), but for a job that has its own secret (`token`, the key of
   its status link) it is MADE from that secret rather than drawn: the same 22 base62 characters, from
   HMAC-SHA256(token, "umbra-quote|<id>|<version>|<n>") with the same rejection sampling. Nobody without the job's
   secret can make it; anyone holding that job's status link could already see that job. A job with no secret (made by
   hand) still gets a drawn code, and its status page simply has no quote button. */
async function hmacBytes(keyText, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(String(keyText)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
export async function madeQuoteCode(secret, jobId, version) {
  let out = '';
  for (let n = 0; out.length < CODE_LEN; n++) {
    for (const x of await hmacBytes(secret, `umbra-quote|${jobId}|${version}|${n}`)) {
      if (x >= 248) continue;
      out += BASE62[x % 62];
      if (out.length === CODE_LEN) break;
    }
  }
  return out;
}

/** road FW · the customer's own quote link for their status page: the newest version, once it has been sent and while
    it is still theirs to answer (open — not replaced, withdrawn or booked). null otherwise, and null for a quote whose
    code was drawn (made before road FW, or a job with no secret): its code cannot be made again, only matched. */
export async function customerQuoteLink(env, rec, nowIso) {
  if (!rec || !rec.token || !env.BOOK) return null;
  let rows;
  try { rows = (await book(env).job(rec.id, nowIso)).rows; } catch (err) { return null; }
  const cur = rows && rows[rows.length - 1];
  if (!cur || !cur.sent_at || cur.status !== 'open') return null;
  const code = await madeQuoteCode(rec.token, rec.id, cur.version);
  if ((await codeHash(code)) !== cur.token_hash) return null;
  const base = String(env.QUOTE_LINK_BASE || 'https://umbradomus.com').replace(/\/+$/, '');
  return `${base}/q/${code}`;
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

/** D-CEO11-10's promise for a quote sent at `fromMs`: 9:00 PM Central that day before 3:00 PM, else noon the next. */
function promisedUntil(fromMs) {
  const c = chicagoParts(fromMs);
  return c.h < PROMISE_HOUR ? chicagoWall(c.y, c.mo, c.d, 21, 0) : chicagoWall(c.y, c.mo, c.d + 1, 12, 0);
}

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
  /* D-CEO11-10: the promise is a FLOOR (see the head of this file). `Math.max` is why nothing gets shorter,
     `ceiling` is why the 12 hours are never spent, and the lift of `cutoff` is why the book never refuses a
     time the page says is held. */
  const ceiling = windowStartMs(earliest) - SHORT_NOTICE_MS;
  let hold = Math.min(from + HOLD_MS, cutoff);
  hold = Math.max(hold, Math.min(promisedUntil(from), ceiling));
  cutoff = Math.max(cutoff, hold);
  return { cutoff: new Date(cutoff).toISOString(), hold_until: new Date(hold).toISOString(), short_notice: short };
}

/* ------------------------------------------------------------ validation (the create route) */

/** One window, checked by the rules every window keeps. { error } or { window }. The words are the old route's. */
function readWindow(n, w, env) {
  if (!w || typeof w !== 'object') return { error: `${n} must be {date, start, end}` };
  const d = realDate(w.date);
  if (!d) return { error: `${n}: ${JSON.stringify(w.date)} is not a real date (YYYY-MM-DD)` };
  if (!TIME_RE.test(String(w.start)) || !TIME_RE.test(String(w.end))) return { error: `${n}: start and end must be HH:MM` };
  const len = toMin(w.end) - toMin(w.start);
  if (len !== 60 && len !== 120) return { error: `${n}: a window is 60 or 120 minutes (R37), this one is ${len}` };
  if (toMin(w.start) < 7 * 60 || toMin(w.end) > 21 * 60) return { error: `${n}: outside 7:00 AM to 9:00 PM Central (R32)` };
  if (d.dow === 0 && String(env.ALLOW_SUNDAY) !== 'true') return { error: `${n}: ${w.date} is a Sunday` };
  return { window: { date: w.date, start: w.start, end: w.end } };
}

const overlap = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

/**
 * road W · the options: 1–2 of them, each 1–2 visits on different days, the first one first. Every visit keeps
 * every window rule. Two options may share a day (Mon+Tue or Tue+Wed), but not be the same offer twice, and two
 * one-visit options keep the old rule that they may not overlap. { error } or { options: [[w, w?], …] }.
 */
function readOptions(list, env) {
  if (!Array.isArray(list) || !list.length) return { error: 'options must be a list of 1 or 2 choices, each {windows: [...]}' };
  if (list.length > 2) return { error: 'more than 2 options' };
  const options = [];
  for (const [i, o] of list.entries()) {
    const n = `option ${i + 1}`;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: `${n} must be {windows: [...]}` };
    if (!Array.isArray(o.windows) || !o.windows.length) return { error: `${n}: windows must be a list of 1 or 2 visits` };
    if (o.windows.length > 2) return { error: `${n}: more than 2 visits` };
    const ws = [];
    for (const [j, w] of o.windows.entries()) {
      const one = readWindow(`${n}, visit ${j + 1}`, w, env);
      if (one.error) return { error: one.error };
      ws.push(one.window);
    }
    if (ws.length === 2 && !(ws[1].date > ws[0].date)) return { error: `${n}: its two visits must be on different days, the first one first` };
    options.push(ws);
  }
  if (options.length === 2) {
    if (JSON.stringify(options[0]) === JSON.stringify(options[1])) return { error: 'the two options are the same' };
    if (options[0].length === 1 && options[1].length === 1 && overlap(options[0][0], options[1][0])) return { error: 'the two windows overlap' };
  }
  return { options };
}

/** Every visit a quote offers, across its options — the hold and the cutoff read the earliest of them. */
export function allVisits(q) {
  return (q.options || q.windows.map((w) => [w])).flat();
}

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
  /* road XW (2026-09-26), three optional fields, each kept only when sent (a quote without them is stored exactly as before):
     step_count — the number of steps on the Flux's plan (the page says "12 steps"), never fewer than the scope lines;
     visit_minutes — how long each visit takes, visit 1 then visit 2 of every option (the page says "about 4 hours");
     their_paint — true when the job uses their leftover paint (the page says "Painted with your paint."); without it
     the Worker reads the form's own answer (paint_on_site "Yes"). */
  if (b.step_count != null) {
    if (!Number.isInteger(b.step_count) || b.step_count < 1 || b.step_count > 99) return bad('step_count must be a whole number, 1 to 99');
    if (b.step_count < b.scope.length) return bad('step_count cannot be fewer than the scope lines');
  }
  if (b.visit_minutes != null) {
    const vm = b.visit_minutes;
    if (!Array.isArray(vm) || !vm.length || vm.length > 2 || !vm.every((m) => Number.isInteger(m) && m >= 15 && m <= 720)) {
      return bad('visit_minutes must be a list of 1 or 2 whole numbers of minutes, 15 to 720: visit 1, then visit 2');
    }
  }
  if (b.their_paint != null && typeof b.their_paint !== 'boolean') return bad('their_paint must be true or false');

  /* road W: `options` wins when it is sent; `windows` alone keeps its exact old meaning (one-visit options). */
  let windows, options = null;
  if (b.options !== undefined && b.options !== null) {
    const o = readOptions(b.options, env);
    if (o.error) return bad(o.error);
    options = o.options;
    windows = options.map((ws) => ws[0]);
  } else {
    if (!Array.isArray(b.windows) || !b.windows.length) return bad('windows must be a list of 1 or 2 times');
    if (b.windows.length > 2) return bad('more than 2 windows');
    windows = [];
    for (const [i, w] of b.windows.entries()) {
      const one = readWindow(`window ${i + 1}`, w, env);
      if (one.error) return bad(one.error);
      windows.push(one.window);
    }
    if (windows.length === 2 && overlap(windows[0], windows[1])) return bad('the two windows overlap');
  }
  const clean = (s) => (s == null ? null : String(s).trim());
  return {
    quote: {
      version: b.version,
      lang,
      sent_at: b.sent_at ? new Date(b.sent_at).toISOString() : null,
      windows,
      options,
      body: {
        price: b.price,
        price_note: clean(b.price_note),
        scope: b.scope.map((s) => s.trim()),
        included: clean(b.included),
        guarantee: clean(b.guarantee),
        insurance: clean(b.insurance),
        ...(b.step_count != null ? { step_count: b.step_count } : {}),
        ...(b.visit_minutes != null ? { visit_minutes: b.visit_minutes.slice() } : {}),
        ...(b.their_paint != null ? { their_paint: b.their_paint } : {}),
      },
    },
  };
}

/* ------------------------------------------------------------ road CO · a change order's body */

const CHANGE_WHAT_MAX = 140;
const CHANGE_NAME_MAX = 80;
const cents = (x) => Math.round(Number(x) * 100) / 100;

/** The body of POST /admin/quote/<id> with kind "change", checked. { error, status } or { change }.
    { kind: "change", version: n, what: "Roll the whole ceiling - the patch color won't blend",
      scope: ["Paint the whole ceiling", "Ceiling paint, 1 gal", …], price: 85, base: 225, total: 310, lang?, sent_at? } */
export function readChangeBody(b) {
  const bad = (reason, status = 422) => ({ error: reason, status });
  if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('the body must be a JSON object', 400);
  if (!Number.isInteger(b.version) || b.version < 1) return bad('version must be the change\'s number, a whole number, 1 or more');
  const w = lineProblem('what', b.what, { money: false });
  if (w) return bad(w);
  if (String(b.what).trim().length > CHANGE_WHAT_MAX) return bad(`what is longer than ${CHANGE_WHAT_MAX} characters`);
  if (!Array.isArray(b.scope) || !b.scope.length) return bad('scope must be a list of one or more plain lines: what the change adds');
  if (b.scope.length > SCOPE_MAX) return bad(`scope has more than ${SCOPE_MAX} lines`);
  for (const [i, x] of b.scope.entries()) { const p = lineProblem(`scope line ${i + 1}`, x, { money: false }); if (p) return bad(p); }
  for (const k of ['price', 'base', 'total']) {
    if (typeof b[k] !== 'number' || !isFinite(b[k]) || b[k] < 0) return bad(`${k} must be one number of dollars`);
  }
  if (!(b.price > 0)) return bad('price must be one positive number (dollars)');
  if (Math.abs(cents(b.base) + cents(b.price) - cents(b.total)) > 0.005) return bad('total must be base + price');
  /* road MW (2026-09-26): work_lines — optional. How many scope lines, from the top, are steps of the work; the lines
     after them are the store items it uses. The customer's page then shows the steps ("5 steps · done during your booked
     visits") and folds the items away. Absent, the page lists every line as before. */
  if (b.work_lines != null && (!Number.isInteger(b.work_lines) || b.work_lines < 0 || b.work_lines > b.scope.length)) {
    return bad('work_lines must be a whole number from 0 to the number of scope lines');
  }
  const lang = b.lang == null ? 'en' : b.lang;
  if (lang !== 'en' && lang !== 'es') return bad('lang must be "en" or "es"');
  if (b.sent_at != null && (typeof b.sent_at !== 'string' || isNaN(Date.parse(b.sent_at)))) return bad('sent_at must be an ISO time');
  return {
    change: {
      n: b.version, lang, sent_at: b.sent_at ? new Date(b.sent_at).toISOString() : null,
      body: { what: b.what.trim(), scope: b.scope.map((x) => x.trim()), price: cents(b.price), base: cents(b.base), total: cents(b.total),
        ...(b.work_lines != null ? { work_lines: b.work_lines } : {}) },
    },
  };
}

/* ------------------------------------------------------------ the admin side */

export async function createQuote(env, jobId, input, nowIso) {
  const rec = await getRecord(env, jobId);
  if (!rec) return { status: 404, body: { error: 'not_found' } };
  /* road W: the hold and the cutoff are read from the EARLIEST visit of any option */
  const hold = holdFor(allVisits(input), nowIso, input.sent_at);
  if (hold.error) return { status: 422, body: { error: hold.error } };
  /* road FW: made from the job's own secret when it has one (its status page can then open it), else drawn */
  const code = rec.token ? await madeQuoteCode(rec.token, jobId, input.version) : newQuoteCode();
  const first = String((rec.fields || {}).name || '').trim().split(/\s+/)[0] || '';
  /* road XW: their leftover paint — the Flux's word when it sends one, else the form's answer ("Yes" only) */
  const paint = input.body.their_paint != null ? {} : (String((rec.fields || {}).paint_on_site || '').trim() === 'Yes' ? { their_paint: true } : {});
  const r = await book(env).create({
    token_hash: await codeHash(code), job_id: jobId, version: input.version, created_at: nowIso, sent_at: input.sent_at,
    hold_until: hold.hold_until, cutoff: hold.cutoff, short_notice: hold.short_notice, lang: input.lang,
    /* the page greets them by first name ("Hi Ana,"); it never reaches a push */
    body: { ...input.body, ...paint, first_name: first.slice(0, 40) }, windows: input.windows, options: input.options || null,
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
  const hold = holdFor(allVisits(cur), cur.created_at, sentIso, cur.short_notice);
  /* D-CEO11-10, the door: the row's `cutoff` is written only by the INSERT (quotebook.js:333) — `sent()` carries
     sent_at and hold_until and nothing else — so a hold lifted past the cutoff this row already holds would be a
     promise quotebook.js:375 refuses. Until the cutoff travels with the hold at /sent, the hold this row takes is
     bounded by the cutoff this row carries. It is never shorter than the hold the row already had, and a quote
     created and sent in the same breath (every quote the Flux makes) takes the whole promise at create.
     Bridge\IGNITE-WORKER-HOLD-01.1-2026-10-07.txt is the one line that closes the gap. */
  const holdUntil = new Date(Math.min(Date.parse(hold.hold_until), Date.parse(cur.cutoff))).toISOString();
  const r = await b.sent(jobId, version, sentIso, holdUntil);
  if (r.error === 'not_found') return { status: 404, body: { error: 'not_found' } };
  if (r.error) return { status: 409, body: { error: r.error, ...(r.newest ? { newest: r.newest } : {}) } };
  const rec = await stampSafe(env, jobId, nowIso);
  return {
    status: 200,
    body: {
      ok: true, version, sent_at: sentIso, hold_until: holdUntil, cutoff: cur.cutoff,
      record: rec ? { status: rec.status, quoted_at: rec.quoted_at, minutes_to_quote: rec.minutes_to_quote, quote_amount: rec.quote_amount } : null,
    },
  };
}

export async function cancelQuote(env, jobId, version, nowIso) {
  const r = await book(env).cancel(jobId, version, nowIso);
  if (r.state === 'not_found') return { status: 404, body: { error: 'not_found' } };
  await stampSafe(env, jobId, nowIso);
  /* `freed` stays the first visit, for old readers; road W adds every visit the booking held */
  const freedAll = r.freed ? [freedOf(r.freed), ...(r.freed_days || []).map(freedOf)] : null;
  return { status: 200, body: { state: 'withdrawn', version, already: Boolean(r.already), freed: r.freed ? freedOf(r.freed) : null, freed_windows: freedAll } };
}

/* ------------------------------------------------------------ REPRICE-01 · lowering a booked price, once */

/** POST /admin/quote/<id>/reprice {version, price} — his side lowering the price of the version the customer
    booked, once, WITH NO WORD TO THE CUSTOMER: no text, no push, no email. Nothing here sends, and the stamp
    cannot either — the version and its accepted_at do not move, so there is no fresh booking to acknowledge
    and no newly-sent version to announce.

    The book is the truth, so the price moves there first; `stampSafe` then re-stamps the KV mirror through the
    one path every other write uses, which is what carries P to `quote_amount`, `accept.price` and `quote.price`
    and writes the single `repriced` event. A stamp that fails leaves the row ahead of the mirror and the
    5-minute reconcile heals it, exactly as every other write on this road. */
export async function repriceQuote(env, jobId, version, price, nowIso) {
  const r = await book(env).reprice(jobId, version, price, nowIso);
  if (r.state === 'not_found') return { status: 404, body: { error: 'not_found' } };
  if (r.state === 'not_accepted') {
    return { status: 409, body: { error: 'not_accepted', reason: 'a price is lowered on the version the customer booked; this one is ' + r.standing, standing: r.standing } };
  }
  if (r.state === 'change_order') {
    const ns = r.standing.map((c) => c.n).join(', ');
    return { status: 422, body: { error: 'invalid',
      reason: 'this job holds a change order (' + ns + ') that still carries the booked price; withdraw it first, then lower',
      changes: r.standing } };
  }
  if (r.state === 'no_price') return { status: 422, body: { error: 'invalid', reason: 'this version carries no price to lower' } };
  if (r.state === 'not_positive') return { status: 422, body: { error: 'invalid', reason: 'price must be a positive number of dollars' } };
  if (r.state === 'not_lower') {
    return { status: 422, body: { error: 'invalid', reason: 'price must be LOWER than the booked price (' + r.was + '); a price that adds is a change order', price: r.was } };
  }
  if (r.state === 'spent') {
    return { status: 422, body: { error: 'invalid', reason: 'this price was already lowered once, from ' + r.from + ' to ' + r.to + '; it is lowered once', price: r.to, price_was: r.from } };
  }
  /* the identical call again: the same answer, and not one write — no stamp, no event */
  if (r.state === 'already') return { status: 200, body: { state: 'repriced', version, already: true, price: r.to, price_was: r.from } };
  await stampSafe(env, jobId, nowIso);
  return { status: 200, body: { state: 'repriced', version, already: false, price: r.to, price_was: r.from } };
}

/* ------------------------------------------------------------ road CO · the change orders, the admin side */

/** The code of change n: made from the job's own secret when it has one (its status page can then open it), else drawn.
    "c<n>" in the HMAC message keeps it apart from every quote version's code. */
async function changeCode(rec, jobId, n) {
  return rec.token ? madeQuoteCode(rec.token, jobId, 'c' + n) : newQuoteCode();
}

export async function createChange(env, jobId, input, nowIso) {
  const rec = await getRecord(env, jobId);
  if (!rec) return { status: 404, body: { error: 'not_found' } };
  const code = await changeCode(rec, jobId, input.n);
  const first = String((rec.fields || {}).name || '').trim().split(/\s+/)[0] || '';
  const r = await book(env).createChange({
    token_hash: await codeHash(code), job_id: jobId, n: input.n, created_at: nowIso, sent_at: input.sent_at, lang: input.lang,
    body: { ...input.body, first_name: first.slice(0, 40) },
  });
  if (r.error === 'not_booked') return { status: 409, body: { error: 'not_booked', reason: 'a change order is made on a job whose quote is booked' } };
  if (r.error === 'change_not_newer') return { status: 409, body: { error: 'version_not_newer', reason: `the change's number must be greater than ${r.newest}`, newest: r.newest } };
  await stampSafe(env, jobId, nowIso);
  const base = String(env.QUOTE_LINK_BASE || 'https://umbradomus.com').replace(/\/+$/, '');
  return { status: 201, body: { kind: 'change', code, url: `${base}/q/${code}`, version: input.n } };
}

export async function markChangeSent(env, jobId, n, sentIso, nowIso) {
  const r = await book(env).changeSent(jobId, n, sentIso);
  if (r.error === 'not_found') return { status: 404, body: { error: 'not_found' } };
  if (r.error) return { status: 409, body: { error: r.error } };
  await stampSafe(env, jobId, nowIso);
  return { status: 200, body: { ok: true, kind: 'change', version: n, sent_at: r.row.sent_at } };
}

export async function cancelChange(env, jobId, n, nowIso) {
  const r = await book(env).cancelChange(jobId, n, nowIso);
  if (r.state === 'not_found') return { status: 404, body: { error: 'not_found' } };
  if (r.state !== 'withdrawn') return { status: 409, body: { error: r.state, reason: 'they have answered this change already' } };
  await stampSafe(env, jobId, nowIso);
  return { status: 200, body: { state: 'withdrawn', kind: 'change', version: n, already: Boolean(r.already) } };
}

/** A change order as the Flux reads it (never the code, never its hash). The name they typed is theirs to see and his. */
function changePub(c) {
  return {
    kind: 'change', version: c.n, status: c.status, state: c.state, created_at: c.created_at, sent_at: c.sent_at, lang: c.lang,
    what: c.body.what, scope: c.body.scope, price: c.body.price, base: c.body.base, total: c.body.total,
    /* road MW: only on a change that carries it */
    ...(c.body.work_lines != null ? { work_lines: c.body.work_lines } : {}),
    answer: c.status === 'accepted' ? 'yes' : c.status === 'declined' ? 'no' : null,
    answered_at: c.answered_at, signed_name: c.status === 'accepted' ? c.signed_name : null,
    views: c.views, last_view_at: c.last_view_at, pushed_at: c.pushed_at, push_kind: c.push_kind,
    mirrored: c.mirrored_version >= c.state_version,
  };
}

/** road CO · the customer's own link to an open change order they have been sent, for their status page — made from
    the job's secret, and only when that code is the book's. null otherwise. */
export async function customerChangeLink(env, rec, c) {
  if (!rec || !rec.token || !c || c.state !== 'open' || !c.sent_at) return null;
  const code = await madeQuoteCode(rec.token, rec.id, 'c' + c.n);
  if ((await codeHash(code)) !== c.token_hash) return null;
  const base = String(env.QUOTE_LINK_BASE || 'https://umbradomus.com').replace(/\/+$/, '');
  return `${base}/q/${code}`;
}

/** The status page's changes: what each one is, its price, the new total, and where it stands; the link while open. */
export async function customerChanges(env, rec, nowIso) {
  if (!rec || !env.BOOK) return null;
  let list;
  try { list = (await book(env).job(rec.id, nowIso)).changes; } catch (err) { return null; }
  const shown = (list || []).filter((c) => c.sent_at || c.status !== 'open');
  if (!shown.length) return null;
  const out = [];
  for (const c of shown) {
    if (c.state === 'withdrawn') continue;
    out.push({ n: c.n, what: c.body.what, price: c.body.price, total: c.body.total, state: c.state, answered_at: c.answered_at || null,
      link: await customerChangeLink(env, rec, c) });
  }
  return out.length ? out : null;
}

function freedOf(b) {
  const t = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { date: b.date, start: t(b.start_min), end: t(b.end_min) };
}

/** road W: every visit a job's booking holds, in order — the first from `bookings`, the later ones from `booking_days`. */
function bookedVisits(bookings, days) {
  if (!bookings.length) return [];
  const first = bookings[0];
  const later = (days || []).filter((d) => d.token_hash === first.token_hash).sort((a, c) => a.n - c.n);
  return [first, ...later].map(freedOf);
}

/** GET /admin/quote/<id> — every version's state for the Flux Capacitor. Never the code, never its hash. */
export async function quoteState(env, jobId, nowIso) {
  const { rows, bookings, booking_days: days, changes } = await book(env).job(jobId, nowIso);
  if (!rows.length) return null;
  const pub = (r) => ({
    version: r.version, status: r.status, state: r.state, created_at: r.created_at, sent_at: r.sent_at,
    hold_until: r.hold_until, held: Date.parse(nowIso) < Date.parse(r.hold_until) && r.status === 'open',
    cutoff: r.cutoff, short_notice: r.short_notice, lang: r.lang,
    price: r.body.price, price_note: r.body.price_note, scope: r.body.scope, included: r.body.included,
    /* REPRICE-01: the price the customer booked at, only on a version his side lowered. HIS side only —
       no customer payload carries it (the status API serves quote_amount, the pages read body.price). */
    ...(r.body.price_was != null ? { price_was: r.body.price_was, repriced_at: r.body.repriced_at || null } : {}),
    guarantee: r.body.guarantee, insurance: r.body.insurance,
    windows: r.windows_free.map((w) => ({ n: w.n, date: w.date, start: w.start, end: w.end, free: w.free, label: windowLabel(w) })),
    accepted_at: r.accepted_at, accepted_by: r.accepted_by, accepted_window: r.accepted_window,
    none_at: r.none_at, cancelled_at: r.cancelled_at, views: r.views, last_view_at: r.last_view_at,
    pushed_at: r.pushed_at, push_kind: r.push_kind,
    mirrored: r.mirrored_version >= r.state_version,
    /* road W: every option with every visit; the old fields above stay exactly as they were */
    options: r.options_free.map((o) => ({
      n: o.n, windows: o.windows.map((w) => ({ date: w.date, start: w.start, end: w.end, label: windowLabel(w), free: w.free })), free: o.free,
    })),
    /* the option they said yes to — the same number as accepted_window, which names that option's first visit */
    accepted_option: r.accepted_window == null ? null : r.accepted_window,
    /* road FW: ONE hold — `hold_until` above is the one the customer's page shows too, to the minute */
    /* road XW: the three optional fields, only on a version that carries them */
    ...(r.body.step_count != null ? { step_count: r.body.step_count } : {}),
    ...(r.body.visit_minutes != null ? { visit_minutes: r.body.visit_minutes } : {}),
    ...(r.body.their_paint != null ? { their_paint: r.body.their_paint } : {}),
    /* CONFIRM-01: the booking's confirmation text — {state: sent|queued|failed|no_consent|no_key, at, id, sha, …}, null
       until the version is booked */
    confirmation: r.confirmation || null,
  });
  const all = rows.map(pub);
  const booked = rows.find((r) => r.status === 'accepted');
  const out = {
    job_id: jobId, now: nowIso, current: all[all.length - 1], versions: all,
    booking: bookings.length ? { ...freedOf(bookings[0]), version: bookings[0].version, booked_at: bookings[0].booked_at, windows: bookedVisits(bookings, days) } : null,
    /* CONFIRM-01: the booked version's confirmation, where the Flux polls (null while nothing is booked) */
    confirmation: booked && booked.confirmation ? booked.confirmation : null,
  };
  /* road CO: the change orders, only when the job has one — a job with none answers exactly as before */
  if (changes && changes.length) out.changes = changes.map(changePub);
  /* road XW: the year their house was built, when they typed it on the quote page — the Flux reads `year_built` */
  const yr = yearRow(rows);
  if (yr) { out.year_built = yr.year_built; out.year_built_at = yr.year_at; }
  return out;
}

/* ------------------------------------------------------------ road XW · the year their house was built */

/** The newest year any version of the job was given, or null. */
function yearRow(rows) {
  const given = (rows || []).filter((r) => r.year_built != null && r.year_at);
  return given.length ? given.sort((a, c) => Date.parse(a.year_at) - Date.parse(c.year_at))[given.length - 1] : null;
}

/** A year as the box on the quote page takes it: four digits, 1700 to this year. Anything else is no answer (the box is
    optional, so a stray entry never stops a booking). */
export function readYear(v, nowIso) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}$/.test(s)) return null;
  const y = Number(s);
  const top = new Date(Date.parse(nowIso) || Date.now()).getUTCFullYear();
  return y >= 1700 && y <= top ? y : null;
}

/** Their year, typed on the quote page: kept on the version's own row (one book call), then the KV record (`year_built`).
    The same year again writes nothing. Pushed to nobody. */
export async function noteYearByCode(env, code, version, year, nowIso, { stamp = true } = {}) {
  if (!CODE_RE.test(String(code || '')) || !year) return { state: 'not_found' };
  const r = await book(env).noteYear(await codeHash(code), Number(version), year, nowIso);
  if (r.state === 'kept' && stamp) await stampSafe(env, r.row.job_id, nowIso);
  return { state: r.state, job_id: r.row ? r.row.job_id : null };
}

/** The stamp, for a caller that kept a year and whose next step did not stamp (a refused booking). */
export async function stampAfterYear(env, jobId, nowIso) {
  return jobId ? stampSafe(env, jobId, nowIso) : null;
}

/* ------------------------------------------------------------ THE SEAM (ACCEPT-PAGE-02 calls only these) */

function answerOf(r, extra = {}) {
  const row = r.row;
  const n = row && row.accepted_window;
  return {
    state: r.state,
    ...(row ? {
      job_id: row.job_id, version: row.version, lang: row.lang,
      window: n ? { n, ...row.windows[n - 1] } : null,
      price: row.body.price, accepted_by: row.accepted_by, accepted_at: row.accepted_at,
      /* road W: the option booked and every visit of it (window above stays its first visit, for old readers) */
      option: n || null, windows: n ? row.options[n - 1] : null,
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
  /* CONFIRM-01: the customer's confirmation text, decided and sent (or queued, or refused) BEFORE the stamp, so the one
     KV write carries it. It never throws; a booking never fails because its text did. */
  const confirmation = await confirmRow(env, hash, nowIso);
  await stampSafe(env, r.row.job_id, nowIso);
  if (r.row.accepted_by === 'page') await pushRow(env, hash, nowIso);
  return answerOf(r, { confirmation: confirmation || null });
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

/** road CO · their answer to a change order, on its page: "yes" with the name they typed (the signature), or "no".
    Once: the first answer stamps the record and pushes his phone; a second does nothing. */
export async function answerChangeByCode(env, code, version, answer, name, nowIso) {
  if (!CODE_RE.test(String(code || ''))) return { state: 'not_found' };
  const who = cleanName(name);
  if (answer === 'yes' && !who) return { state: 'need_name' };
  const hash = await codeHash(code);
  const r = await book(env).answerChange(hash, Number(version), answer === 'yes' ? 'yes' : 'no', who, nowIso);
  if (r.first) {
    await stampSafe(env, r.row.job_id, nowIso);
    await pushChangeRow(env, hash, nowIso);
  }
  return { state: r.state, first: Boolean(r.first) };
}

/** The name they typed, as a signature: letters, spaces, apostrophes, hyphens and periods, 2 to 80 characters, at
    least two letters. Anything else is no signature. */
export function cleanName(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > CHANGE_NAME_MAX) return null;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(s)) return null;
  if ((s.match(/\p{L}/gu) || []).length < 2) return null;
  return s;
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
  /* road CO: a change order's page — what, why, the price, the new total, and their answer once they gave it */
  if (v.kind === 'change') {
    return {
      kind: 'change', state: v.state, body: row.body, version: row.n, lang: row.lang, job_id: row.job_id, views: row.views,
      answered_at: row.answered_at, signed_name: row.status === 'accepted' ? row.signed_name : null,
    };
  }
  return {
    state: v.state, body: row.body,
    windows: v.windows.map((w) => ({ n: w.n, date: w.date, start: w.start, end: w.end, free: w.free })),
    accepted_window: row.accepted_window, hold_until: row.hold_until, cutoff: row.cutoff, short_notice: row.short_notice,
    lang: row.lang, job_id: row.job_id, version: row.version, views: row.views,
    /* road W: the choices as the page shows them — every visit of each, and whether the whole option is free */
    options: v.options.map((o) => ({ n: o.n, windows: o.windows.map((w) => ({ date: w.date, start: w.start, end: w.end, free: w.free })), free: o.free })),
    /* road XW: the year they gave on this version, so the box shows it again */
    ...(row.year_built != null ? { year_built: row.year_built } : {}),
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
  const { rows, changes } = await b.job(jobId, nowIso);
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
    const visits = r.options[r.accepted_window - 1] || [w];
    if (!hasEvent('accepted', (e) => e.version === r.version && e.accepted_at === r.accepted_at)) {
      /* road W: a two-visit booking names every day in its event; a one-visit booking's event is exactly as before */
      addEvent(rec, 'accepted', { version: r.version, by: r.accepted_by, window: w, ...(visits.length > 1 ? { windows: visits } : {}), price: r.body.price, accepted_at: r.accepted_at }, r.accepted_at);
    }
    if (r.cancelled_at && !hasEvent('booking-cancelled', (e) => e.version === r.version && e.accepted_at === r.accepted_at)) {
      addEvent(rec, 'booking-cancelled', { version: r.version, accepted_at: r.accepted_at }, r.cancelled_at);
    }
  }
  if (accepted) {
    const w = accepted.windows[accepted.accepted_window - 1];
    const visits = accepted.options[accepted.accepted_window - 1] || [w];
    const fresh = !rec.accept || rec.accept.version !== accepted.version || rec.accept.at !== accepted.accepted_at || rec.accept.cancelled_at;
    /* road W: accept.windows is every visit booked; accept.window stays the first, for every old reader */
    rec.accept = {
      at: accepted.accepted_at, by: accepted.accepted_by, version: accepted.version, window: { date: w.date, start: w.start, end: w.end },
      windows: visits.map((x) => ({ date: x.date, start: x.start, end: x.end })), price: accepted.body.price,
    };
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
    /* CONFIRM-01: the confirmation text's state rides with the booking; one event per settled state */
    if (accepted.confirmation) {
      const c = accepted.confirmation;
      rec.confirmation = { ...c, version: accepted.version };
      if (c.state !== 'queued' && !hasEvent('confirmation', (e) => e.version === accepted.version && e.state === c.state)) {
        addEvent(rec, 'confirmation', { version: accepted.version, state: c.state, ...(c.id ? { id: c.id } : {}), ...(c.why ? { why: c.why } : {}) }, c.at || nowIso);
      }
    }
  } else if (rec.accept && !rec.accept.cancelled_at) {
    const was = rows.find((r) => r.version === rec.accept.version);
    rec.accept.cancelled_at = (was && was.cancelled_at) || nowIso;
    if (rec.status === 'scheduled') rec.status = 'quoted';
    rec.scheduled_for = null;
    rec.scheduled_at = null;
  }

  /* 3b · REPRICE-01: a booked price his side lowered. Read off the book's own `price_was`, so one stamp, a
     stamp that failed and then the reconcile all write this event exactly once, and `from` is always the
     price the customer booked at. The price itself rode into accept.price and quote_amount above. */
  for (const r of rows) {
    if (r.body.price_was != null && !hasEvent('repriced', (e) => e.version === r.version)) {
      addEvent(rec, 'repriced', { version: r.version, from: r.body.price_was, to: r.body.price }, r.body.repriced_at || nowIso);
    }
  }

  /* 4 · the quote as the Flux Capacitor and the collector read it — the newest version. Never the code. */
  rec.quote = {
    version: newest.version, status: newest.status, state: newest.state, sent_at: newest.sent_at,
    hold_until: newest.hold_until, cutoff: newest.cutoff, short_notice: newest.short_notice,
    windows: newest.windows, price: newest.body.price, none_at: newest.none_at,
    views: newest.views, last_view_at: newest.last_view_at, sent_versions: sentSeen,
    /* road W: every option with every visit, in the shape the create route takes */
    options: newest.options.map((ws) => ({ windows: ws })),
  };

  /* 4b · road XW: the year their house was built, typed on the quote page (only when they gave one) */
  const yr = yearRow(rows);
  if (yr && rec.year_built !== yr.year_built) {
    rec.year_built = yr.year_built;
    addEvent(rec, 'year_built', { year: yr.year_built, version: yr.version }, yr.year_at);
  }

  /* 5 · road CO: the change orders, when the job has any — what each is, its price, the new total, where it stands and
     when they answered (never the code, and the name they typed stays in the book). One event per answer. */
  if (changes && changes.length) {
    rec.changes = changes.map((c) => ({ n: c.n, state: c.state, what: c.body.what, price: c.body.price, base: c.body.base, total: c.body.total,
      sent_at: c.sent_at || null, answered_at: c.answered_at || null }));
    for (const c of changes) {
      if (c.status === 'accepted' && !hasEvent('change_ok', (e) => e.n === c.n)) addEvent(rec, 'change_ok', { n: c.n, price: c.body.price, total: c.body.total }, c.answered_at);
      if (c.status === 'declined' && !hasEvent('change_no', (e) => e.n === c.n)) addEvent(rec, 'change_no', { n: c.n, price: c.body.price }, c.answered_at);
    }
  }

  await putRecord(env, rec);
  await b.mirrored(jobId, Object.fromEntries([...rows, ...(changes || [])].map((r) => [r.token_hash, r.state_version])));
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

/* ------------------------------------------------- SITE-FIX-03 · the confirmation email's two stamps

   The booking confirmation email is SENT by page.js (the words carry the business phone, which
   page-words.js forbids, and quotes.js must never import page.js — page.js imports this file, so the
   other direction is a cycle). But the RECORD is written here, where every other KV write of a booking
   is written: page.js never writes KV and never pushes by itself, and these two functions keep that true.

   `confirmation_email_at` is the field name — the Worker's own snake_case `<thing>_at` shape, as
   `forwarded_at` and `accepted_at` are. The ignite asked for `confirmationEmailAt` "or the field the
   Worker's own shape uses — name it"; this is it.

   THE CLAIM COMES BEFORE THE SEND, AND IS GIVEN BACK WHEN THE SEND DID NOT DELIVER. A stamp taken first
   can only ever be taken once, so the website can never send this email twice — a second booking tap, a
   reload, a retry, a reconcile, all find the stamp already there and send nothing. Taking it first was
   not enough on its own: this send leaves from the Worker's own leg, and FormSubmit has answered that leg
   429 on every request the Worker has ever taken (index.js, U-0003/4/5). A stamp left standing on a
   refusal would be Jose's empty inbox again, and for good — no later tap could ever retry, because the
   claim above refuses while a stamp is there. So noteConfirmationEmail below deletes the stamp when the
   send did not deliver: the claim is held for the length of the send, which is all the never-twice
   promise needs, and released if nothing went. A delivered send leaves it standing for good. Either way
   the customer is not in the dark — the screen said the day, the window and the price the moment they
   booked, and the Flux still texts the day before (FLUX-FIX-16).

   The read-modify-write is not atomic, and it does not need to be: the booking itself is serialised by the
   QuoteBook durable object, which answers `already_booked` to every tap after the first (quotebook.js), so
   only one request per booking ever reaches this claim. */

/**
 * Takes the right to send the one confirmation email for this job, or refuses.
 * @returns {Promise<string|null>} the customer's address when this call took the stamp; null when the
 *   stamp was already taken, when the customer gave no email, or when the record cannot be read.
 */
export async function claimConfirmationEmail(env, jobId, nowIso) {
  let rec = null;
  try { rec = await getRecord(env, jobId); } catch (err) {
    console.error('confirmation email: record unreadable for', jobId, String(err && err.message || err));
    return null;
  }
  if (!rec) return null;
  if (rec.confirmation_email_at) return null;
  const to = String((rec.fields || {}).email || '').trim();
  if (!to) return null;
  rec.confirmation_email_at = nowIso;
  try { await putRecord(env, rec); } catch (err) {
    console.error('confirmation email: claim could not be written for', jobId, String(err && err.message || err));
    return null;
  }
  return to;
}

/** What the send answered, recorded beside the claim — the same ok/status shape index.js keeps for the
    request copy (`forwarded_at` / `forward_failed`). Never fails the booking: the booking is already in
    the book and on the screen. */
export async function noteConfirmationEmail(env, jobId, result, nowIso) {
  try {
    const rec = await getRecord(env, jobId);
    if (!rec) return null;
    const ok = !!(result && result.ok);
    if (ok) delete rec.confirmation_email_failed;
    else {
      rec.confirmation_email_failed = { at: nowIso, status: (result && result.status) || 0 };
      /* nothing went, so the claim goes back: a later tap may still send the one email (see above). */
      delete rec.confirmation_email_at;
    }
    addEvent(rec, ok ? 'confirmation_email' : 'confirmation_email_failed',
      { to_given: true, status: (result && result.status) || 0 }, nowIso);
    await putRecord(env, rec);
    return rec;
  } catch (err) {
    console.error('confirmation email: note failed for', jobId, String(err && err.message || err));
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

/** The only two messages this file writes. The job id, every day and window booked, the price — no link (R25),
    no name, phone, address or email. road W: "ACCEPTED · U-9601 · Mon 9/28 8–10 AM + Tue 9/29 11 AM–1 PM", "$360"
    (the version number is not his word, so it left the message). */
export function buildPush(kind, row) {
  if (kind === 'accept') {
    const visits = row.options[row.accepted_window - 1] || [row.windows[row.accepted_window - 1]];
    return { title: `ACCEPTED · ${row.job_id} · ${visits.map(windowLabel).join(' + ')}`, message: money(row.body.price), priority: 1 };
  }
  return { title: `${row.job_id} · none of the times work`, message: 'text them other times', priority: 1 };
}

/** road CO · a change order's push: "CHANGE OK · U-9601 · $85" / "Change 1 · new total $310". The job number and the
    money only — never the name they typed, their phone, address or the link (R25). */
export function buildChangePush(kind, row) {
  if (kind === 'change_ok') return { title: `CHANGE OK · ${row.job_id} · ${money(row.body.price)}`, message: `Change ${row.n} · new total ${money(row.body.total)}`, priority: 1 };
  return { title: `CHANGE NO · ${row.job_id} · ${money(row.body.price)}`, message: `Change ${row.n} · they said no thanks`, priority: 1 };
}

async function pushChangeRow(env, hash, nowIso) {
  if (!isOpen(Date.parse(nowIso))) return { held: true };
  const b = book(env);
  const claim = newToken();
  const c = await b.claimChangePush(hash, claim, nowIso);
  if (!c) return null;
  const msg = buildChangePush(c.kind, c.row);
  let results;
  try {
    results = await sendAlert(env, msg, c.only || undefined);
  } catch (err) {
    results = [{ channel: 'all', ok: false, retry: true, error: String(err && err.message || err) }];
  }
  const slim = results.filter((r) => !r.skipped).map((r) => ({ channel: r.channel, ok: Boolean(r.ok), retry: Boolean(r.retry), status: r.status }));
  await b.finishChangePush(hash, claim, c.attempt, c.kind, slim, nowIso);
  return { job_id: c.row.job_id, kind: c.kind, attempt: c.attempt, results: slim };
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
  const out = { now: nowIso, stamped: [], stamp_failed: [], pushed: [], confirmed: [] };
  if (!env.BOOK) return out;
  const b = book(env);
  /* CONFIRM-01: every confirmation text still owed — queued 9 PM–7 AM, sent with the first run from 7:00 (confirm.js
     itself does nothing by night, and never twice). Each finish moves the row's state_version on, so the stamp loop
     below mirrors it in this same run. */
  out.confirmed = await confirmDue(env, nowIso);
  for (const jobId of await b.unmirroredJobs()) {
    try { await stampJob(env, jobId, nowIso); out.stamped.push(jobId); }
    catch (err) { out.stamp_failed.push(jobId); console.error('reconcile stamp failed for', jobId, String(err && err.message || err)); }
  }
  if (isOpen(Date.parse(nowIso))) {
    for (const hash of await b.pushesDue()) {
      const p = await pushRow(env, hash, nowIso);
      if (p && !p.held) out.pushed.push(p);
    }
    /* road CO: a change's answer that came in overnight pushes with the first run from 7:00 */
    for (const hash of await b.changePushesDue()) {
      const p = await pushChangeRow(env, hash, nowIso);
      if (p && !p.held) out.pushed.push(p);
    }
  }
  return out;
}

/* ------------------------------------------------------------ test hook only */

export async function bookDump(env) {
  return book(env).dump();
}
