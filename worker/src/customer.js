/* THE CUSTOMER'S OWN PAGES, BEHIND ONE PRIVATE KEY — road W, 2026-09-26.

     POST /admin/status-link/<U-id>?k=   the private status link for a text: <SITE_BASE_URL>/status?id=<id>&v=<token>
     PUT  /admin/receipt/<U-id>?k=       { html, paid: {method, amount, at}, completed_at? } → the receipt kept, the job
                                         marked done and paid → { ok, link }  (link = <SITE_BASE_URL>/receipt/<id>?v=<token>)
                                         road FW: `completed_at` (optional, ISO) is when the work finished; the status
                                         page says "Done · Tue 9/29, 4:20 PM". Without it the page says "Done", no time.
     GET  /receipt/<U-id>?v=  (or ?t=)   the receipt itself, on a phone, served with a CSP that runs no script
     GET  /receipt/<U-id>/print?v=       road XW: the same receipt, opening the phone's Print (Save as PDF); one pinned script

   THE VIEW TOKEN (`v`). Every job already has one secret, `token`, the `t` in the status link its thank-you page
   carries. The view token is made from it: HMAC-SHA256(token, "umbra-view|<id>"), 43 characters of base64url. Only its
   sha256 is stored on the record (`view.sha256`). Because it is made rather than drawn, asking for the link twice
   answers the SAME link — a Flux that asks again never breaks the link it already texted — and nothing new is written.
   `t` keeps working exactly as before; `v` opens the same three things: the status JSON, its photos, the receipt.

   THE RECEIPT is the page the Flux draws (the ensō stamp, PAID), stored whole in R2 beside the job's photos:
   jobs/<id>/receipt/<n>.html in the PHOTOS bucket, the newest one served. Nothing is ever deleted; a receipt sent again
   with the same bytes writes nothing. It is served with no script allowed at all, so whatever the page carries can only
   be looked at and printed (the phone's own Print makes the PDF). */

import { getRecord, putRecord, addEvent } from './store.js';
import { sha256hex, safeEqual, newToken, b64url } from './util.js';

export const RECEIPT_MAX_BYTES = 800 * 1024;
export const PAY_METHODS = ['cash', 'zelle', 'check', 'card'];
const VIEW_RE = /^[A-Za-z0-9_-]{20,128}$/;

/* The receipt runs no script, loads nothing from anywhere else, and cannot be framed. Styles and images may be inline
   or the site's own (a receipt opened through umbradomus.com may use /assets). `sandbox` (the second read, 2026-09-26)
   puts the page in its own sealed box as well: no script even if one got past script-src, no forms, no plugins, no
   storage or cookies of the site (no allow-same-origin), no way to steer another window. Its one allowance,
   allow-modals, is what lets a browser print a sandboxed page; with no script there is nothing else it can open. */
export const RECEIPT_CSP = "default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-modals";

const RECEIPT_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': RECEIPT_CSP,
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
};

const enc = (s) => new TextEncoder().encode(String(s));

function siteBase(env) {
  return String(env.SITE_BASE_URL || 'https://www.umbradomus.com').replace(/\/+$/, '');
}

/* ------------------------------------------------------------ the view token */

async function hmac(keyText, msg) {
  const key = await crypto.subtle.importKey('raw', enc(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc(msg)));
}

/** The job's view token, made from its own secret. */
export async function viewToken(rec) {
  return b64url(await hmac(rec.token, 'umbra-view|' + rec.id));
}

/** Makes sure the record carries the view token's hash. Answers { token, wrote }: `wrote` only the first time. */
export async function ensureView(rec, nowIso) {
  let wrote = false;
  /* every record the form made has its secret; one made by hand without it gets one now, like any other */
  if (!rec.token) { rec.token = newToken(); wrote = true; }
  const token = await viewToken(rec);
  const hash = await sha256hex(enc(token));
  if (!rec.view || rec.view.sha256 !== hash) {
    rec.view = { sha256: hash, at: nowIso };
    addEvent(rec, 'status_link', {}, nowIso);
    wrote = true;
  }
  return { token, wrote };
}

/**
 * Which of the customer's two keys opened this: { k: 't'|'v', val } or null. `t` is the record's own secret (the
 * thank-you page's link); `v` is the view token, checked against its stored hash. A wrong key, a key for another job
 * and a job that does not exist all answer null, and the callers answer them identically.
 */
export async function customerKey(rec, url) {
  if (!rec) return null;
  const t = url.searchParams.get('t');
  if (t && rec.token && safeEqual(t, rec.token)) return { k: 't', val: t };
  const v = url.searchParams.get('v');
  if (v && VIEW_RE.test(v) && rec.view && typeof rec.view.sha256 === 'string') {
    if (safeEqual(await sha256hex(enc(v)), rec.view.sha256)) return { k: 'v', val: v };
  }
  return null;
}

/** POST /admin/status-link/<id> — { link } or null for an unknown job. Asking again answers the same link. */
export async function statusLink(env, id, nowIso) {
  const rec = await getRecord(env, id);
  if (!rec) return null;
  const { token, wrote } = await ensureView(rec, nowIso);
  if (wrote) await putRecord(env, rec);
  return { link: `${siteBase(env)}/status?id=${encodeURIComponent(id)}&v=${token}` };
}

export function receiptLink(env, id, token) {
  return `${siteBase(env)}/receipt/${encodeURIComponent(id)}?v=${token}`;
}

/* ------------------------------------------------------------ the receipt, kept */

/** { paid } or { error } — the way it was paid, how much, and when. */
export function readPaid(p, nowIso) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { error: 'paid must be {method, amount, at}' };
  const method = String(p.method == null ? '' : p.method).trim().toLowerCase();
  if (!PAY_METHODS.includes(method)) return { error: `paid.method must be one of ${PAY_METHODS.join(', ')}` };
  let amount = p.amount;
  if (typeof amount === 'string' && /^\s*\d+(\.\d{1,2})?\s*$/.test(amount)) amount = Number(amount);
  /* 0 is a real payment: a free fix still gets its receipt. A negative, a non-number or no amount is refused. */
  if (typeof amount !== 'number' || !isFinite(amount) || !(amount >= 0)) return { error: 'paid.amount must be one number of dollars, 0 or more' };
  let at = nowIso;
  if (p.at != null) {
    if (typeof p.at !== 'string' || isNaN(Date.parse(p.at))) return { error: 'paid.at must be an ISO time' };
    at = new Date(p.at).toISOString();
  }
  return { paid: { method, amount: Math.round(amount * 100) / 100, at } };
}

/**
 * PUT /admin/receipt/<id>. Stores the receipt (a new R2 object only when the bytes changed), marks the job paid and
 * done, and answers { status, body }. The link is the job's view link to the receipt.
 */
export async function putReceipt(env, id, b, nowIso) {
  if (typeof b.html !== 'string' || !b.html.trim()) return { status: 422, body: { error: 'invalid', reason: 'html must be the receipt page, as text' } };
  const bytes = enc(b.html);
  if (bytes.length > RECEIPT_MAX_BYTES) {
    return { status: 413, body: { error: 'too_large', reason: `the receipt is ${Math.ceil(bytes.length / 1024)} KB; it may be at most 800 KB` } };
  }
  const p = readPaid(b.paid, nowIso);
  if (p.error) return { status: 422, body: { error: 'invalid', reason: p.error } };
  /* road FW: when the work finished, if the Flux says (never guessed from the receipt's own send time) */
  let finished = null;
  if (b.completed_at != null) {
    if (typeof b.completed_at !== 'string' || isNaN(Date.parse(b.completed_at))) return { status: 422, body: { error: 'invalid', reason: 'completed_at must be an ISO time' } };
    finished = new Date(b.completed_at).toISOString();
  }
  const rec = await getRecord(env, id);
  if (!rec) return { status: 404, body: { error: 'not_found' } };

  const sha = await sha256hex(bytes);
  const { token, wrote } = await ensureView(rec, nowIso);
  let changed = wrote;
  if (!rec.receipt || rec.receipt.sha256 !== sha) {
    const n = ((rec.receipt && rec.receipt.n) || 0) + 1;
    const key = `jobs/${id}/receipt/${n}.html`;
    await env.PHOTOS.put(key, bytes, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
      customMetadata: { job: id, sha256: sha, kind: 'receipt' },
    });
    rec.receipt = { n, key, sha256: sha, bytes: bytes.length, at: nowIso };
    addEvent(rec, 'receipt', { n, bytes: bytes.length, sha256: sha.slice(0, 12) }, nowIso);
    changed = true;
  }
  const paid = p.paid;
  if (!rec.paid || rec.paid.method !== paid.method || rec.paid.amount !== paid.amount || rec.paid.at !== paid.at) {
    rec.paid = paid;
    addEvent(rec, 'paid', { method: paid.method, amount: paid.amount, paid_at: paid.at }, nowIso);
    changed = true;
  }
  if (finished && rec.finished_at !== finished) {
    rec.finished_at = finished;
    addEvent(rec, 'finished', { finished_at: finished }, nowIso);
    changed = true;
  }
  if (!rec.done_at) {
    rec.done_at = nowIso;
    addEvent(rec, 'done', { by: 'receipt' }, nowIso);
    changed = true;
  }
  if (rec.status !== 'done') { rec.status = 'done'; changed = true; }
  if (changed) await putRecord(env, rec);
  return {
    status: 200,
    body: { ok: true, link: receiptLink(env, id, token), paid: rec.paid, done_at: rec.done_at, finished_at: rec.finished_at || null, receipt: { n: rec.receipt.n, bytes: rec.receipt.bytes, sha256: rec.receipt.sha256, at: rec.receipt.at }, written: changed },
  };
}

/* ------------------------------------------------------------ the receipt, shown */

/** The receipt as a phone should open it: a page with no viewport tag gets one; a bare fragment gets a page around it. */
export function phoneReady(html) {
  const s = String(html);
  if (/<meta[^>]+name\s*=\s*["']?viewport/i.test(s)) return s;
  const vp = '<meta name="viewport" content="width=device-width, initial-scale=1">';
  if (/<head[^>]*>/i.test(s)) return s.replace(/<head[^>]*>/i, (m) => m + vp);
  if (/<html[^>]*>/i.test(s)) return s.replace(/<html[^>]*>/i, (m) => m + '<head><meta charset="utf-8">' + vp + '</head>');
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' + vp + '\n<meta name="robots" content="noindex, nofollow">\n' +
    '<title>Your receipt · Umbra Domus</title>\n</head>\n<body>\n' + s + '\n</body>\n</html>\n';
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The one answer for a wrong key, a job that is not there and a job with no receipt yet — the same in all three. */
function notThere(method) {
  const body = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="robots" content="noindex, nofollow">\n<title>Umbra Domus</title>\n' +
    '<style>body{margin:0;font:17px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F6F3EE;color:#0F0B1A}main{max-width:34rem;margin:0 auto;padding:2.2rem 1.1rem}h1{font-size:1.6rem;margin:0 0 .4rem}p{margin:0 0 1rem;color:#4E4960}</style>\n' +
    '</head>\n<body>\n<main>\n' +
    `<h1>${esc("This link isn't valid.")}</h1>\n<p>${esc('Check the link in our text, or reply to it.')}</p>\n` +
    `<section lang="es"><h1>${esc('Este enlace no es válido.')}</h1>\n<p>${esc('Revise el enlace de nuestro mensaje de texto o respóndanos.')}</p></section>\n` +
    '</main>\n</body>\n</html>\n';
  return new Response(method === 'HEAD' ? null : body, { status: 404, headers: RECEIPT_HEADERS });
}

/* road XW (2026-09-26) · [SAVE AS PDF] ON THE PHONE, AND A BIGGER SEAL AT PHONE WIDTH. The stored receipt is never
   changed (its bytes and sha256 stay the Flux's); on the way out the page gets one bar at the top and one small style
   block: the bar is a plain link, the seal is drawn larger under 8.7 in, and neither prints. The receipt page itself
   still runs no script at all (RECEIPT_CSP above, unchanged). The link opens /receipt/<id>/print — the same receipt, with
   ONE script allowed, pinned by its sha256 in that response's CSP: it opens the phone's own Print (Save as PDF) once the
   page has loaded. Anything the stored page carries (a <script>, an onerror) still cannot run there: its hash is not the
   pinned one and inline handlers are never allowed. The sandbox stays (no same-origin, no forms, no top navigation);
   it gains only allow-scripts, for that one pinned script. */
const SAVE_STYLE = '<style id="ud-save-style">' +
  '.ud-save{max-width:8.5in;margin:0 auto;padding:14px 18px 0;display:flex;justify-content:flex-end;box-sizing:border-box}' +
  '.ud-save a{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:48px;padding:.65rem 1.3rem;box-sizing:border-box;' +
  'border-radius:12px;background:#003153;color:#fff;font:600 16px/1.2 "Segoe UI","Helvetica Neue",Arial,sans-serif;text-decoration:none}' +
  '.ud-save a:focus-visible{outline:3px solid #2F6BB0;outline-offset:3px}' +
  '@media screen and (max-width:8.7in){.ud-save a{width:100%}.cust .cu-stamp{width:104px!important;height:104px!important}' +
  '.cust .cu-sealbox{width:104px!important;height:104px!important}}' +
  '@media print{.ud-save{display:none!important}}' +
  /* road MW (2026-09-26): a long price line ("Change 1 · 2 more fist-size holes behind the dresser") wraps inside the money
     column instead of pushing the amounts past its right edge — on the page as served, at any width, and on paper */
  '.cust table.cu-price td{white-space:normal}.cust table.cu-price td.a{white-space:nowrap;width:1%}</style>';
const PRINT_SCRIPT = "addEventListener('load',function(){setTimeout(function(){print()},250)});";
let printHash = null;
async function printScriptHash() {
  if (!printHash) printHash = 'sha256-' + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', enc(PRINT_SCRIPT)))));
  return printHash;
}
export async function receiptPrintCsp() {
  return RECEIPT_CSP.replace("script-src 'none'", `script-src '${await printScriptHash()}'`).replace(/sandbox allow-modals$/, 'sandbox allow-modals allow-scripts');
}

/** The receipt as served: the one bar ([Save as PDF], linked with the page's own key) and its style; on the print
    page, the pinned script too. A page with no <body> tag is served as it is. */
export function withSaveBar(html, href, script) {
  const s = String(html);
  const bar = `<div class="ud-save" id="ud-save"><a href="${esc(href).replace(/"/g, '&quot;')}" id="ud-save-pdf">Save as PDF</a></div>`;
  if (!/<body[^>]*>/i.test(s)) return s;
  let out = s.replace(/<body[^>]*>/i, (m) => m + bar);
  const style = SAVE_STYLE + (script ? `<script>${PRINT_SCRIPT}</script>` : '');
  out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, (m) => style + m) : out.replace(/<body[^>]*>/i, (m) => style + m);
  return out;
}

/** GET /receipt/<id>?v= (or ?t=) — the newest receipt, or the same "not valid" page for anything else.
    road XW: GET /receipt/<id>/print?v= — the same receipt, opening the phone's Print (Save as PDF). */
export async function receiptPage(env, url, id, method, print = false) {
  if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405, headers: { ...RECEIPT_HEADERS, Allow: 'GET, HEAD' } });
  const rec = await getRecord(env, id);
  const key = await customerKey(rec, url);
  if (!key || !rec.receipt || !rec.receipt.key) return notThere(method);
  const obj = await env.PHOTOS.get(rec.receipt.key);
  if (!obj) return notThere(method);
  /* the link carries the key the page was opened with (v, else t), relative, so it stays on umbradomus.com */
  const k = url.searchParams.get('v') ? 'v' : 't';
  const href = `/receipt/${id}/print?${k}=${encodeURIComponent(url.searchParams.get(k) || '')}`;
  const html = withSaveBar(phoneReady(await obj.text()), href, print);
  const headers = print ? { ...RECEIPT_HEADERS, 'Content-Security-Policy': await receiptPrintCsp() } : RECEIPT_HEADERS;
  return new Response(method === 'HEAD' ? null : html, { status: 200, headers });
}
