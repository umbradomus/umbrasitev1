/* THE BOOKING CONFIRMATION TEXT — CONFIRM-01, 2026-10-04.

   THE DEFECT, on a real customer (U-0015, 2026-10-01, 07:46): they booked a time on the quote page and got nothing —
   no text, no email. The confirmation text was built to go only from the owner's own program on his tap, and nothing
   told him it was waiting. His call (option A): THE WEBSITE CONFIRMS THE BOOKING ITSELF, THE MOMENT IT HAPPENS.

   WHAT GOES. One text to the customer's number, through the one door every text leaves by (holding.js postText: the
   SMSGATE_AUTH pair, the real gateway or the 127.0.0.1 fake under ALLOW_TEST_HOOKS, twenty seconds, never a retry):

     You're booked with Umbra Domus: Tue Sep 29, 8-10 AM. Price $395 flat. We'll text the day before and when we're
     on the way. Reply STOP to opt out. - Drew

   Spanish when the quote's lang is "es". A two-visit option lists each visit on its own line. Folded to GSM-7 like the
   holding text (the en dash becomes "-", accents that GSM-7 lacks are folded), two segments.

   WHEN. A booking by the page and a booking by texted YES both land in the same book write (quotebook.js book()), and
   both come through finishBooking in quotes.js, which calls confirmRow below — so there is ONE place a booking gets its
   text. 7 AM–9 PM Central it goes at once (and never inside the last ten minutes before 9 PM: biztime's rule for every
   text). 9 PM–7 AM it is QUEUED on the booking's own row and the every-minute cron (quotes.js reconcile, which already
   only acts by day) sends it with the first run from 7:00 — once, and never retried whatever the gateway answers.

   WHO. Only a customer who ticked "Text me about this request" (the record's consent.smsService, the same word the
   holding text reads) and whose number is not on the STOP list (outbox.js optedOut, and the record's own sms_opt_out).
   Without consent, or with a STOP on file: no text, state `no_consent`, so the Flux can show him "they didn't opt in to
   texts — call them". No SMSGATE_AUTH on the Worker: no call, state `no_key`, and his phone is told to confirm them
   himself.

   WHERE IT IS WRITTEN. The booking row carries `confirmation` — { state: sent | queued | failed | no_consent | no_key,
   at, id (the gateway's message id), sha (sha256 of the words), lang, parts, why? } — and quotes.js's stamp mirrors it to
   the KV record as `confirmation`, so GET /admin/quote/<id> and /api/jobs both carry it with no change on the Flux's side
   beyond reading a field. The message id is `<U-id>-confirm-v<version>`, minted once: his own program's send (its own
   ledger) can see from this field that the website already sent it, and the gateway itself refuses a repeat of the id.

   NEVER A SECOND TEXT. The right to send is claimed on the row inside the book (claimConfirm, one sync transaction) and
   given back with the answer (finishConfirm); a claim that never came back is unknown and is written `failed`, never sent
   again. A booking never fails because its text failed: everything here is caught, and the worst case is `failed` on the
   row.

   WHAT NEVER LEAVES THIS FILE: the customer's number, the key, and the text's own words. The push to his phone names
   the job id, the day and the price, nothing else (R25). */

import { getRecord } from './store.js';
import { sha256hex, newToken } from './util.js';
import { isOpen, nextOpen, chicagoWall, chicagoParts } from './biztime.js';
import { usNumber, gsmFold, textFault, textParts, hasKey, postText, ttlFor, MIN_TTL, MAX_TTL } from './holding.js';
import { optedOut, validUntilFor } from './outbox.js';
import { sendAlert } from './notify.js';

/* A claim that has not come back after this long was a Worker that died inside the call: unknown, written `failed`,
   never a second POST (the same ten minutes holding.js gives a "sending" mark). */
export const CONFIRM_CLAIM_MS = 10 * 60000;

/* ------------------------------------------------------------ the words */

export const CONFIRM_EN = "You're booked with Umbra Domus: {when}. Price {price} flat. We'll text the day before and when we're on the way. Reply STOP to opt out. - Drew";
export const CONFIRM_ES = 'Su cita con Umbra Domus quedó confirmada: {when}. Precio {price} fijo. Le escribimos el día anterior y cuando vayamos en camino. Responda STOP para no recibir mensajes. - Drew';
/* a two-visit option: every visit on its own line, the colon before them and the price after */
export const CONFIRM_EN_2 = "You're booked with Umbra Domus:\n{when}\nPrice {price} flat. We'll text the day before and when we're on the way. Reply STOP to opt out. - Drew";
export const CONFIRM_ES_2 = 'Su cita con Umbra Domus quedó confirmada:\n{when}\nPrecio {price} fijo. Le escribimos el día anterior y cuando vayamos en camino. Responda STOP para no recibir mensajes. - Drew';

const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MON_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

function h12(min, lang) {
  const h = Math.floor(min / 60), m = min % 60;
  const ap = lang === 'es' ? (h < 12 ? 'a.m.' : 'p.m.') : (h < 12 ? 'AM' : 'PM');
  return { t: `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''}`, ap };
}

/** "Tue Sep 29, 8-10 AM" · "Tue Sep 29, 11 AM-1 PM" · Spanish "mar 29 sep, 8-10 a.m." */
export function visitLine(w, lang) {
  const [y, mo, d] = String(w.date).split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const a = h12(toMin(w.start), lang), b = h12(toMin(w.end), lang);
  const span = a.ap === b.ap ? `${a.t}-${b.t} ${b.ap}` : `${a.t} ${a.ap}-${b.t} ${b.ap}`;
  const day = lang === 'es' ? `${DOW_ES[dow]} ${d} ${MON_ES[mo - 1]}` : `${DOW_EN[dow]} ${MON_EN[mo - 1]} ${d}`;
  return `${day}, ${span}`;
}

const money = (n) => '$' + (Number.isInteger(n) ? String(n) : Number(n).toFixed(2));

/**
 * The words for this booked row: { text, lang, parts } or { error }. `row` is the book's quote row (its accepted
 * option's visits, its price, its lang). Never a text still holding a brace; never a text GSM-7 cannot carry.
 */
export function confirmText(row) {
  const lang = row.lang === 'es' ? 'es' : 'en';
  const visits = (row.options && row.options[row.accepted_window - 1]) || [row.windows[row.accepted_window - 1]];
  if (!visits || !visits.length || !visits[0]) return { error: 'no_visit' };
  const two = visits.length > 1;
  const tpl = lang === 'es' ? (two ? CONFIRM_ES_2 : CONFIRM_ES) : (two ? CONFIRM_EN_2 : CONFIRM_EN);
  const when = visits.map((w) => visitLine(w, lang)).join('\n');
  /* "2-4 p.m." already ends the sentence; the template's own full stop would double it (holding.js's rule) */
  const text = gsmFold(tpl.replace('{when}', () => when).replace('{price}', () => money(row.body.price))).replace(/\.\.(?!\.)/g, '.');
  if (/[{}]/.test(text)) return { error: 'unfilled' };
  const fault = textFault(text);
  if (fault) return { error: fault.error };
  return { text, lang, parts: textParts(text) };
}

/* ------------------------------------------------------------ the push, when no text can go */

/** "Booking U-0015: no texting key on the website — confirm them yourself" — the job id, the day and the price (R25). */
export function buildNoKeyPush(row) {
  const visits = (row.options && row.options[row.accepted_window - 1]) || [row.windows[row.accepted_window - 1]];
  return {
    title: `Booking ${row.job_id}: no texting key on the website — confirm them yourself`,
    message: `${visits.map((w) => visitLine(w, 'en')).join(' + ')} · ${money(row.body.price)}\nSMSGATE_AUTH is not set on the Worker, so no confirmation text could go.`,
    priority: 1,
  };
}

/* ------------------------------------------------------------ the step */

function book(env) {
  return env.BOOK.get(env.BOOK.idFromName('book'));
}

const gatewayIdFor = (row) => `${row.job_id}-confirm-v${row.version}`;

/**
 * THE CONFIRMATION STEP for one booked row, by its token hash. Called by finishBooking the moment a booking lands
 * and by reconcile for every row still owed one (queued overnight, or a booking whose first try never finished).
 * Decides, then sends at most once, then writes the row. NEVER THROWS: a booking must never fail because its text
 * did. Answers the confirmation written, or null when there was nothing to do (no row, no claim, not due).
 */
export async function confirmRow(env, hash, nowIso) {
  try {
    return await confirmStep(env, hash, nowIso);
  } catch (err) {
    console.error('confirmation failed for row', String((err && err.message) || err).slice(0, 200));
    try { await book(env).finishConfirm(hash, null, { state: 'failed', at: nowIso, why: 'error' }, false, true); } catch (e) { /* the row keeps what it had */ }
    return null;
  }
}

async function confirmStep(env, hash, nowIso) {
  const nowMs = Date.parse(nowIso);
  const b = book(env);
  const claim = newToken();
  const c = await b.claimConfirm(hash, claim, nowIso, CONFIRM_CLAIM_MS);
  if (!c) return null;
  const row = c.row;
  const prior = row.confirmation || {};
  const queuedAt = prior.state === 'queued' ? (prior.queued_at || prior.at) : null;
  const base = { ...(queuedAt ? { queued_at: queuedAt } : {}) };
  const finish = (conf, stillDue = false) => b.finishConfirm(hash, claim, { ...base, ...conf }, stillDue).then(() => ({ ...base, ...conf }));

  /* 1 · who they are, and whether they said texts are fine */
  const rec = await getRecord(env, row.job_id);
  if (!rec) return finish({ state: 'failed', at: nowIso, why: 'no_record' });
  const num = usNumber(rec.fields && rec.fields.phone);
  if (num.error) return finish({ state: 'failed', at: nowIso, why: num.error });
  if (!(rec.consent && rec.consent.smsService === true)) return finish({ state: 'no_consent', at: nowIso, why: 'no_consent' });
  const opt = rec.sms_opt_out || await optedOut(env, num.e164);
  if (opt) return finish({ state: 'no_consent', at: nowIso, why: 'stop' });

  /* 2 · the hour: 9 PM–7 AM, or inside the last ten minutes of the day, it waits for the first run from 7:00 */
  if (!isOpen(nowMs) || ttlFor(nowMs) < MIN_TTL) {
    const at = new Date(nextOpenAfterClose(nowMs)).toISOString();
    return finish({ state: 'queued', at: nowIso, queued_at: queuedAt || nowIso, send_at: at }, true);
  }

  /* 3 · no key on the Worker: no call at all, and he is told to confirm them himself */
  if (!hasKey(env)) {
    let push = null;
    try { push = (await sendAlert(env, buildNoKeyPush(row))).filter((r) => !r.skipped).map((r) => ({ channel: r.channel, ok: Boolean(r.ok), status: r.status })); }
    catch (err) { push = [{ channel: 'all', ok: false }]; }
    return finish({ state: 'no_key', at: nowIso, why: 'no_key', pushed: push });
  }

  /* 4 · the words */
  const words = confirmText(row);
  if (words.error) return finish({ state: 'failed', at: nowIso, why: words.error });

  /* 5 · ONE POST. The id is minted from the job and the version, so even a repeat the book somehow let through would be
     refused by the gateway itself. The text lives until 9 PM at the latest (never into the morning). */
  const gid = gatewayIdFor(row);
  const ttl = Math.min(MAX_TTL, ttlFor(nowMs));
  const r = await postText(env, { id: gid, e164: num.e164, text: words.text, validUntil: validUntilFor(nowMs, ttl) });
  const sha = await sha256hex(new TextEncoder().encode(words.text));
  if (r.state === 'accepted') {
    return finish({ state: 'sent', at: nowIso, id: r.gateway_id || gid, sha, lang: words.lang, parts: words.parts, status: r.status });
  }
  /* refused (4xx) or unknown (5xx, timeout): failed, and never tried again */
  return finish({ state: 'failed', at: nowIso, id: gid, sha, lang: words.lang, parts: words.parts, status: r.status, why: r.state, ...(r.timeout ? { timeout: true } : {}) });
}

/** The 7:00 AM a text queued at `ms` goes at: tonight's, or — inside the last ten minutes of today — tomorrow's. */
function nextOpenAfterClose(ms) {
  if (!isOpen(ms)) return nextOpen(ms);
  const { y, mo, d } = chicagoParts(ms);
  return chicagoWall(y, mo, d + 1, 7);
}

/** The confirmations still owed (queued overnight, or never finished), for reconcile: by day only, each once. */
export async function confirmDue(env, nowIso) {
  const out = [];
  if (!env.BOOK || !isOpen(Date.parse(nowIso))) return out;
  for (const hash of await book(env).confirmationsDue()) {
    const c = await confirmRow(env, hash, nowIso);
    if (c) out.push(c);
  }
  return out;
}
