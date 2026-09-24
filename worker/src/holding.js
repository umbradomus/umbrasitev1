/* THE HOLDING TEXT — REMINDERS-01, 2026-09-24.

   His words, 09-23 17:1x CDT: "maybe we have a failsafe text that goes out just to say we reached out in
   the 2 hours", then "so the short holding text, work on that make it better". The better words are on
   Bridge\SUPE\REPLY-CLOCK-AND-SEND-HIS-CALLS-2026-09-23.md §"THE HOLDING TEXT"; AMENDMENT 1 A picks the
   Recommended English line and its Spanish twin, and fills {first name} and {time}.

   ONE TEXT, ONCE, NEVER A RETRY. Two business hours after a request lands with no quote sent, the Worker
   makes exactly ONE POST to SMSGate, from the work phone's own number. A 4xx is refused, a 5xx or a
   timeout is unknown; neither is ever tried again, and no second POST is ever made for the same request
   (the mark that says so is an insert-if-absent row in the BOOK Durable Object — KV is not a lock,
   ALERTS-01 FOUND 4).

   WHAT NEVER LEAVES THIS FILE: the customer's number, the key, and the text's own words. The record keeps
   a holding block; the push to his phone names the job id and nothing else.

   THE KEY is the whole "user:pass" pair in the Worker secret SMSGATE_AUTH — never split, never logged,
   never returned, never put in an event. Absent → no call at all.

   THE BASE is https://api.sms-gate.app. SMSGATE_API_BASE overrides it ONLY when ALLOW_TEST_HOOKS is true
   AND the override is a 127.0.0.1 address (AMENDMENT 1 F) — so a production build can never be pointed
   at a fake, and the key can never travel anywhere but the real gateway. */

import { chicagoParts, chicagoDay, clock, bizAdvance, chicagoWall, CLOSE_H } from './biztime.js';

export const GATEWAY_REAL_BASE = 'https://api.sms-gate.app';
export const SEND_PATH = '/3rdparty/v1/messages';
export const CALL_TIMEOUT_MS = 20000;      /* SEAT JUDGEMENT F8: twenty seconds, absolute, then the call is over */
export const MAX_TTL = 3600;
export const MIN_TTL = 600;                /* FC-TEXT-01 AMENDMENT 1 D's floor: under ten minutes left and it waits for 7 AM */
export const MAX_PARTS = 10;
export const SENDING_STALE_MS = 10 * 60000;   /* AMENDMENT 1 E: a "sending" older than this is unknown */
export const DELIVERY_GRACE_MS = 10 * 60000;  /* AMENDMENT 1 E: ttl + this long with no word is "call them" */

/* ------------------------------------------------------------ the number (TEXT-01's rule, unchanged) */

const US_NUMBER = /^[2-9]\d{2}[2-9]\d{6}$/;
/* US-shaped NANP area codes that are not the United States. FC-TEXT-01's list, copied whole. */
const CARIBBEAN = new Set(['242', '246', '264', '268', '284', '340', '345', '441', '473', '649', '658',
  '664', '670', '671', '684', '721', '758', '767', '784', '787', '809', '829', '849', '868', '869', '876', '939']);

/** Digits only, a leading 1 dropped from 11, a US NANP shape, no Caribbean area code. */
export function usNumber(raw) {
  let d = String(raw == null ? '' : raw).replace(/[^0-9]/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10 || !US_NUMBER.test(d)) return { error: 'no_number' };
  if (CARIBBEAN.has(d.slice(0, 3))) return { error: 'not_us' };
  return { e164: '+1' + d };
}

/* ------------------------------------------------------------ GSM-7 */

/* The same set FC-TEXT-01 checks by, written as code points so no tool can eat one. */
const GSM_BASIC_CP = [64, 163, 36, 165, 232, 233, 249, 236, 242, 199, 10, 216, 248, 13, 197, 229, 916, 95, 934, 915, 923, 937, 928, 936, 931, 920, 926, 198, 230, 223, 201, 32, 33, 34, 35, 164, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 161, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 196, 214, 209, 220, 167, 191, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 228, 246, 241, 252, 224];
const GSM_EXT_CP = [94, 123, 125, 92, 91, 126, 93, 124, 8364];
export const GSM_SET = new Set(GSM_BASIC_CP.concat(GSM_EXT_CP).map((c) => String.fromCodePoint(c)));
const GSM_EXTSET = new Set(GSM_EXT_CP.map((c) => String.fromCodePoint(c)));

/* AMENDMENT 1 B. Curly quotes and dashes become plain; a-acute, i-acute, o-acute and u-acute (and their
   capitals) fold to a i o u. e-acute, n-tilde, u-diaeresis and the inverted marks are GSM-7 and stay. */
const FOLD = new Map(Object.entries({
  '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
  '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u00AB': '"', '\u00BB': '"',
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
  '\u2026': '...', '\u00A0': ' ', '\u202F': ' ', '\u2007': ' ', '\u2009': ' ',
  '\u00E1': 'a', '\u00ED': 'i', '\u00F3': 'o', '\u00FA': 'u',
  '\u00C1': 'A', '\u00CD': 'I', '\u00D3': 'O', '\u00DA': 'U',
}));

export function gsmFold(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) out += FOLD.has(ch) ? FOLD.get(ch) : ch;
  return out;
}

/** null if the text is sendable, else why not. Never carries the text itself. */
export function textFault(s) {
  let at = 0, sept = 0;
  for (const ch of s) {
    at++;
    if (!GSM_SET.has(ch)) return { error: 'bad_text', where: at };
    sept += GSM_EXTSET.has(ch) ? 2 : 1;
  }
  const parts = sept <= 160 ? 1 : Math.ceil(sept / 153);
  if (parts > MAX_PARTS) return { error: 'too_long', parts };
  return null;
}

export function textParts(s) {
  let sept = 0;
  for (const ch of s) sept += GSM_EXTSET.has(ch) ? 2 : 1;
  return sept <= 160 ? 1 : Math.ceil(sept / 153);
}

/* ------------------------------------------------------------ the words */

/* THE HOLDING TEXT, folded to GSM-7, exactly as REPLY-CLOCK's "Recommended" line and its Spanish twin
   read after AMENDMENT 1 B's fold. `{name}` is "" or " " + the first name; `{time}` carries its own
   Spanish article ("las 9:00 a. m."), so the Spanish line reads "antes de {time}", not "antes de las". */
export const HOLDING_EN = "Hi{name}, it's Drew with Umbra Domus. We got your request and we're working on your quote. You'll have it by {time}, or I'll call and tell you why.";
export const HOLDING_ES = 'Hola{name}, soy Drew de Umbra Domus. Recibimos su solicitud y estamos preparando su cotizacion. La tendra antes de {time}. Si no le llega para entonces, le llamo y le explico por qu\u00E9.';

const MAX_FIRST_NAME = 24;

/** The first word of the record's name, folded. Omitted (and the sentence reads without it) if it is
    too long, empty, or holds anything a phone cannot carry. */
export function firstNameOf(rec) {
  const raw = String((rec.fields && rec.fields.name) || '').trim();
  const word = gsmFold(raw.split(/\s+/)[0] || '').trim();
  if (!word || word.length > MAX_FIRST_NAME) return '';
  if (/[{}]/.test(word) || textFault(word)) return '';
  return word;
}

/** "9:00 AM" · "9:00 AM tomorrow" · "las 9:00 a. m." · "la 1:05 p. m. de manana" (AMENDMENT 1 A). */
export function promiseTime(endMs, nowMs, lang) {
  const { h, mi } = chicagoParts(endMs);
  const h12 = ((h + 11) % 12) + 1;
  const mm = String(mi).padStart(2, '0');
  const next = chicagoDay(endMs) !== chicagoDay(nowMs);
  if (lang === 'es') {
    const art = h12 === 1 ? 'la' : 'las';
    return `${art} ${h12}:${mm} ${h < 12 ? 'a. m.' : 'p. m.'}${next ? ' de ma\u00F1ana' : ''}`;
  }
  return `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}${next ? ' tomorrow' : ''}`;
}

/** The language a request answers in: the consent record's own, else the Spanish pages' marker. */
export function langOf(rec) {
  const c = rec.consent || {};
  if (c.lang === 'es') return 'es';
  const f = rec.fields || {};
  if (String(f.lang || f._lang || '').toLowerCase() === 'es') return 'es';
  if (/\/es\//.test(String(rec.page || ''))) return 'es';
  return 'en';
}

/**
 * The words that go to this customer at `nowMs`, with the second clock's end filled in.
 * Answers { text, lang, parts } or { error } — and never a text still holding a brace.
 */
export function holdingText(rec, nowMs) {
  const lang = langOf(rec);
  const endMs = bizAdvance(nowMs, 120);
  const name = firstNameOf(rec);
  const text = (lang === 'es' ? HOLDING_ES : HOLDING_EN)
    .replace('{name}', name ? ' ' + name : '')
    .replace('{time}', promiseTime(endMs, nowMs, lang))
    /* "las 9:00 a. m." already ends the sentence; the template's own full stop would double it */
    .replace(/\.\.(?!\.)/g, '.');
  if (/[{}]/.test(text)) return { error: 'unfilled' };      /* AMENDMENT 1 A, mutant (d) */
  const fault = textFault(text);
  if (fault) return { error: fault.error };
  return { text, lang, parts: textParts(text), end_at: new Date(endMs).toISOString() };
}

/* ------------------------------------------------------------ the clock the text lives by */

/** Seconds from `ms` to 9:00 PM on Chicago's clock that day (0 once it is past). */
export function secondsToClose(ms) {
  const c = chicagoParts(ms);
  return Math.max(0, Math.round((chicagoWall(c.y, c.mo, c.d, CLOSE_H) - ms) / 1000));
}

/** The text's own time to live: it dies at 9 PM if the phone has not sent it (min 3600). */
export function ttlFor(ms) {
  return Math.min(MAX_TTL, secondsToClose(ms));
}

/* ------------------------------------------------------------ the door */

/** The gateway this build may call. Only a 127.0.0.1 override, and only with the test hooks on. */
export function gatewayBase(env) {
  const o = String(env.SMSGATE_API_BASE || '').replace(/\/+$/, '');
  if (o && String(env.ALLOW_TEST_HOOKS) === 'true' && /^http:\/\/127\.0\.0\.1(:\d{2,5})?$/.test(o)) return o;
  return GATEWAY_REAL_BASE;
}

/* The whole pair, never split. A pair that is not "user:pass" in printable ASCII is treated as absent. */
const PAIR = /^[\x21-\x39\x3b-\x7e]{1,128}:[\x21-\x7e]{1,256}$/;

export function hasKey(env) {
  return PAIR.test(String(env.SMSGATE_AUTH || ''));
}

function authHeader(env) {
  /* the one place "Basic " is built, and the only place the pair is read */
  return 'Basic ' + btoa(String(env.SMSGATE_AUTH));
}

async function call(env, method, path, bodyObj) {
  const ctl = new AbortController();
  const bell = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(gatewayBase(env) + path, {
      method,
      signal: ctl.signal,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        authorization: authHeader(env),
        ...(bodyObj ? { 'content-type': 'application/json' } : {}),
      },
      ...(bodyObj ? { body: JSON.stringify(bodyObj) } : {}),
    });
    let body = null;
    try { body = await res.json(); } catch (err) { body = null; }
    return { status: res.status, body };
  } catch (err) {
    /* the message may name the host; it never names the key, the number or the words */
    return { status: 0, timeout: ctl.signal.aborted, error: String((err && err.message) || err).slice(0, 120) };
  } finally {
    clearTimeout(bell);
  }
}

/**
 * ONE POST. `id` is minted once by the caller and never minted again for this request.
 * Answers { state, gateway_id?, status } — state is accepted | refused | unknown.
 */
export async function postHolding(env, { id, e164, text, ttl }) {
  const r = await call(env, 'POST', SEND_PATH, {
    id,
    textMessage: { text },
    phoneNumbers: [e164],
    withDeliveryReport: true,
    ttl,
  });
  if (r.status >= 200 && r.status < 300) {
    const gid = r.body && typeof r.body.id === 'string' ? r.body.id : id;
    return { state: 'accepted', gateway_id: gid, status: r.status, gateway_state: (r.body && r.body.state) || null };
  }
  if (r.status >= 400 && r.status < 500) return { state: 'refused', status: r.status };
  return { state: 'unknown', status: r.status, ...(r.timeout ? { timeout: true } : {}) };
}

/** ONE GET of a message's state. Answers { state } as SMSGate words it, or null when it could not be read. */
export async function getHoldingState(env, gid) {
  const r = await call(env, 'GET', SEND_PATH + '/' + encodeURIComponent(gid), null);
  if (r.status === 404) return { gone: true, status: 404 };
  if (r.status < 200 || r.status >= 300) return { status: r.status };
  return { status: r.status, state: r.body && typeof r.body.state === 'string' ? r.body.state : null };
}

export const DONE_STATES = /^(Sent|Delivered)$/;
export const FAILED_STATES = /^(Failed|Expired|Cancelled)$/;

export { clock };
