/* THEIR TEXTS, BACK FROM THE WORK PHONE — UMBRA-SIDE-01 (lane P), 2026-09-28.

     POST /hooks/smsgate     SMSGate's webhook (event sms:received), registered once on the work phone's SMSGate account

   THE GATE. SMSGate signs every webhook: X-Signature = hex HMAC-SHA256(signing key, raw body + X-Timestamp), and
   X-Timestamp = Unix seconds. The Worker holds the same signing key as a secret (SMSGATE_WEBHOOK_KEY — his hand, once:
   `npx wrangler secret put SMSGATE_WEBHOOK_KEY`), recomputes it over the exact bytes it received and compares in
   constant time (util.js safeEqual, the way every secret here is compared). No key on the Worker, no timestamp, a
   timestamp more than five minutes off, or any other signature → 401 and NOTHING is written or sent.

   STOP MEANS STOP. STOP, END, UNSUBSCRIBE, CANCEL, QUIT, ALTO or BASTA — alone or anywhere in the text, any case —
   puts the number on the opt-out list (outbox.js), marks every job with that number, and sends ONE confirmation,
   within five minutes, from the work phone:
       "You're unsubscribed from Umbra Domus texts. Call (956) 556-6438 if you need us."  (or the Spanish)
   The confirmation is the only text that ever goes to an opted-out number, it goes once per number (a mark in the
   BOOK, like the holding text's), and like every text it lives only until 9:00 PM — at night it is not sent at all
   and the job says so. From then on every send route here refuses that number.

   ANY OTHER TEXT lands on their newest open job (the number matched, never shown in a push) and pushes his phone
   "U-9601 replied: <their words>" with the link to the job. The words are cleaned the way every push cleans them: no
   link, email, phone number or their name. A text from a number with no job is answered 200 and kept nowhere. */

import { getRecord, putRecord, listRecords, addEvent } from './store.js';
import { safeEqual, sha256hex, json } from './util.js';
import { isOpen, clock } from './biztime.js';
import { usNumber, langOf, hasKey } from './holding.js';
import { stopConfirmText } from './draft.js';
import { optOut, sendCustomerText, validUntilFor } from './outbox.js';
import { markOnce, markSet } from './booklock.js';
import { sendAlert, CHANNELS } from './notify.js';
import { jobLink } from './ownerlink.js';
import { cleanForPush } from './alerts.js';

export const STOP_WORDS = /\b(stop|end|unsubscribe|cancel|quit|alto|basta)\b/i;
const SKEW_S = 300;                       /* five minutes either way, as SMSGate's own guide suggests */
const CONFIRM_VALID_S = 300;              /* the confirmation is worth sending for five minutes, then never */
const INBOUND_KEEP = 20;

const enc = (s) => new TextEncoder().encode(String(s));
async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc(msg)))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** { ok } or { ok:false, why } — the exact bytes, the timestamp and the signature, checked against the Worker's key. */
export async function verifySignature(env, raw, sig, ts, nowMs) {
  const key = String((env && env.SMSGATE_WEBHOOK_KEY) || '');
  if (!key) return { ok: false, why: 'no_key' };
  if (!/^\d{9,12}$/.test(String(ts || ''))) return { ok: false, why: 'no_timestamp' };
  if (Math.abs(nowMs / 1000 - Number(ts)) > SKEW_S) return { ok: false, why: 'stale' };
  const want = await hmacHex(key, raw + String(ts));
  return safeEqual(String(sig || '').trim().toLowerCase(), want) ? { ok: true } : { ok: false, why: 'bad_signature' };
}

/** Every job whose number is this one, newest first. */
async function jobsFor(env, e164) {
  const all = await listRecords(env);
  return all.filter((r) => usNumber((r.fields || {}).phone).e164 === e164)
    .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at));
}
const OPEN = new Set(['received', 'quoted', 'scheduled']);

async function push(env, rec, title, message, nowMs) {
  const link = rec ? await jobLink(env, rec.id) : null;
  const msg = {
    title, message,
    /* by day it may interrupt; at night it arrives quietly, as the overnight arrival push does */
    priority: isOpen(nowMs) ? 1 : -1,
    ...(link ? { url: link, url_title: 'Open the job' } : {}),
  };
  try { return await sendAlert(env, msg, CHANNELS); } catch (err) { return [{ ok: false, error: String(err && err.message || err) }]; }
}

export async function handleSmsgateHook(request, env, nowIso) {
  const nowMs = Date.parse(nowIso);
  const raw = await request.text();
  const v = await verifySignature(env, raw, request.headers.get('x-signature'), request.headers.get('x-timestamp'), nowMs);
  if (!v.ok) return json({ error: 'refused' }, 401);
  let body;
  try { body = JSON.parse(raw); } catch (err) { return json({ error: 'bad_body' }, 400); }
  if (!body || body.event !== 'sms:received') return json({ ok: true, ignored: String((body && body.event) || '') });
  const p = body.payload || {};
  const text = String(p.message == null ? (p.text == null ? '' : p.text) : p.message).replace(/\r\n?/g, '\n').slice(0, 1600).trim();
  const n = usNumber(p.phoneNumber || p.phone_number || p.sender);
  if (n.error) return json({ ok: true, matched: false });
  const evId = String(body.id || '') || (await sha256hex(enc(raw))).slice(0, 24);
  const jobs = await jobsFor(env, n.e164);
  const job = jobs.find((r) => OPEN.has(r.status)) || jobs[0] || null;

  /* ------------------------------------------------ STOP */
  const w = STOP_WORDS.exec(text);
  if (w) {
    const word = w[1].toUpperCase();
    const entry = { at: nowIso, by: 'text', word, job: job ? job.id : null };
    const { first } = await optOut(env, n.e164, entry);
    const lang = /^(ALTO|BASTA)$/.test(word) ? 'es' : job ? langOf(job) : 'en';
    let confirm = { state: 'not_sent', why: 'night' };
    if (!isOpen(nowMs)) confirm = { state: 'not_sent', why: 'night' };
    else if (!hasKey(env)) confirm = { state: 'not_sent', why: 'no_key' };
    else {
      const key = 'stopconf:' + (await sha256hex(enc(n.e164))).slice(0, 32);
      const gid = 'stop-' + key.slice(9, 25);
      const claim = await markOnce(env, key, job ? job.id : 'none', 'sending', nowIso, gid);
      if (!claim.won) confirm = { state: 'already', at: claim.mark && claim.mark.at };
      else {
        const r = await sendCustomerText(env, { id: gid, e164: n.e164, text: stopConfirmText(env, lang), validUntil: validUntilFor(nowMs, CONFIRM_VALID_S) });
        await markSet(env, key, r.state, r.gateway_id || null, new Date().toISOString(), 'http ' + r.status);
        confirm = { state: r.state, at: nowIso, gateway_id: r.gateway_id || gid, lang };
      }
    }
    for (const j of jobs) {
      const rec = await getRecord(env, j.id);
      if (!rec) continue;
      if (!Array.isArray(rec.inbound)) rec.inbound = [];
      if (!rec.inbound.some((x) => x.id === evId)) rec.inbound = rec.inbound.concat({ id: evId, at: nowIso, text, stop: true }).slice(-INBOUND_KEEP);
      if (!rec.sms_opt_out) { rec.sms_opt_out = { at: nowIso, by: 'text', word }; addEvent(rec, 'sms_opt_out', { by: 'text', word }, nowIso); }
      if (j === job && confirm.state !== 'already') { rec.sms_opt_out.confirm = confirm; addEvent(rec, 'stop_confirmation', { state: confirm.state, ...(confirm.why ? { why: confirm.why } : {}) }, nowIso); }
      await putRecord(env, rec);
    }
    /* his phone hears it once: a second STOP from the same number lands on the job and nothing more */
    if (job && first) await push(env, job, `${job.id} replied: ${word}`, 'Texts to them are off now. Call if you need them.', nowMs);
    return json({ ok: true, matched: Boolean(job), stop: true, confirmation: confirm.state });
  }

  /* ------------------------------------------------ any other text: on the job, and to his phone */
  if (!job) return json({ ok: true, matched: false });
  const rec = await getRecord(env, job.id);
  if (!Array.isArray(rec.inbound)) rec.inbound = [];
  if (rec.inbound.some((x) => x.id === evId)) return json({ ok: true, matched: true, again: true });
  rec.inbound = rec.inbound.concat({ id: evId, at: nowIso, text }).slice(-INBOUND_KEEP);
  rec.inbound_at = nowIso;
  addEvent(rec, 'inbound_text', { chars: text.length }, nowIso);
  await putRecord(env, rec);
  const words = cleanForPush(text, rec);
  const short = words.length > 80 ? words.slice(0, 79).replace(/\s+\S*$/, '') + '…' : words;
  await push(env, rec, `${rec.id} replied: ${short || '(a text)'}`, `${words}\n${clock(nowMs)}`, nowMs);
  return json({ ok: true, matched: true });
}
