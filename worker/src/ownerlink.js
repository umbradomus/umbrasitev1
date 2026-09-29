/* HIS LINKS — UMBRA-SIDE-01 (lane P), 2026-09-28. The job page on his phone and the board page, each behind a key made
   from the Worker's own secret, so a push can carry a link that opens exactly one job and nothing else.

     /j/<U-id>.<key>      one job     key = HMAC-SHA256(ADMIN_KEY, "umbra-owner|<U-id>")   43 characters of base64url
     /j/board/<key>       every open job, the same way      key = HMAC-SHA256(ADMIN_KEY, "umbra-owner|board")

   Made, never drawn and never stored: asking twice answers the same link, nothing is written, and the key opens only the
   job it was made for (a key for U-0012 does not open U-0013). A wrong or missing key and a job that is not there are
   answered the same way, by the page. Changing ADMIN_KEY changes every link at once.
   Served on the Worker's own address (PUBLIC_BASE_URL), so the site needs no rewrite for them. Without PUBLIC_BASE_URL or
   ADMIN_KEY there is no link, and a push simply goes without one, as every push did before this round. */

import { b64url, safeEqual } from './util.js';

const enc = (s) => new TextEncoder().encode(String(s));
const ID_RE = /^U-\d{4,6}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

async function mac(env, what) {
  const key = await crypto.subtle.importKey('raw', enc(env.ADMIN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc('umbra-owner|' + what))));
}

const hasSecret = (env) => typeof (env && env.ADMIN_KEY) === 'string' && env.ADMIN_KEY.length > 0;

export function ownerBase(env) {
  return String((env && env.PUBLIC_BASE_URL) || '').replace(/\/+$/, '');
}

/** "U-9601.<43 characters>" — the one path segment after /j/ for a job. */
export async function jobToken(env, id) {
  if (!hasSecret(env) || !ID_RE.test(String(id))) return null;
  return id + '.' + await mac(env, id);
}

export async function boardToken(env) {
  return hasSecret(env) ? mac(env, 'board') : null;
}

/** The job page's full address for a push, or null when this Worker has no public address or no secret. */
export async function jobLink(env, id) {
  const b = ownerBase(env), t = await jobToken(env, id);
  return b && t ? `${b}/j/${t}` : null;
}

export async function boardLink(env) {
  const b = ownerBase(env), t = await boardToken(env);
  return b && t ? `${b}/j/board/${t}` : null;
}

/** The job id a /j/ segment opens, or null (a wrong key, a key for another job, a malformed segment). */
export async function jobOfToken(env, seg) {
  const m = /^(U-\d{4,6})\.([A-Za-z0-9_-]+)$/.exec(String(seg || ''));
  if (!m || !KEY_RE.test(m[2]) || !hasSecret(env)) return null;
  return safeEqual(m[2], await mac(env, m[1])) ? m[1] : null;
}

export async function isBoardToken(env, seg) {
  if (!KEY_RE.test(String(seg || '')) || !hasSecret(env)) return false;
  return safeEqual(String(seg), await mac(env, 'board'));
}
