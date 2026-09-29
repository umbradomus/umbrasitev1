/* THE WORK PHONE'S OUTBOX, FROM THE WEBSITE — UMBRA-SIDE-01 (lane P), 2026-09-28.

   Every text the Worker itself gives the work phone goes through here: his one-tap reply from the job page, the one
   STOP confirmation, and (holding.js) the holding text. It is the same outbox the Flux's "Send" uses — SMSGate's
   POST /3rdparty/v1/messages, answered "Pending" — with holding.js's door (the key, the base, twenty seconds, never a
   retry). Every text carries `validUntil`, no later than 9:00 PM Central that day, so a phone that is off does not
   send it late: it expires instead.

   THE OPT-OUT LIST. A number that texted STOP (or that he marked "No texts" on the job page) is kept as
   optout:<sha256 of its E.164 number> in KV — the number itself is never a key and never logged. Every send route here
   asks it first and refuses; the one exception is the single confirmation that answers the STOP itself. */

import { sha256hex } from './util.js';
import { chicagoParts, chicagoWall, CLOSE_H } from './biztime.js';
import { postText } from './holding.js';

const enc = (s) => new TextEncoder().encode(String(s));
export const optKey = async (e164) => 'optout:' + await sha256hex(enc(e164));

/** The moment a text sent at `nowMs` stops being worth sending: `maxSec` from now, and never after 9:00 PM that day. */
export function validUntilFor(nowMs, maxSec) {
  const c = chicagoParts(nowMs);
  const close = chicagoWall(c.y, c.mo, c.d, CLOSE_H);
  return new Date(Math.min(nowMs + maxSec * 1000, close)).toISOString();
}

/** The opt-out on file for this number, or null. */
export async function optedOut(env, e164) {
  if (!e164) return null;
  try {
    const raw = await env.RECORDS.get(await optKey(e164));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    /* KV would not answer: treat the number as opted out, so nothing goes that might not be wanted */
    return { at: null, by: 'unknown', unreadable: true };
  }
}

/** Puts the number on the list (once). Answers { first, entry }. */
export async function optOut(env, e164, entry) {
  const had = await optedOut(env, e164);
  if (had && !had.unreadable) return { first: false, entry: had };
  await env.RECORDS.put(await optKey(e164), JSON.stringify(entry));
  return { first: true, entry };
}

/** ONE POST of one customer text. Answers { state: accepted | refused | unknown, gateway_id?, status, gateway_state? }. */
export async function sendCustomerText(env, { id, e164, text, validUntil }) {
  return postText(env, { id, e164, text, validUntil });
}
