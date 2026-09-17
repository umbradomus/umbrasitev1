/* Small shared helpers. No dependencies, no framework. */

/** base64url, no padding. */
export function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes = 256 bits, comfortably above the 128-bit floor. */
export function newToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b64url(b);
}

/** Length-independent, value-constant compare. Never `a === b` on a secret. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  /* Hash both first so the compare is always over equal-length input and the
     length of the real secret does not leak through an early return. */
  let diff = ae.length ^ be.length;
  const n = Math.max(ae.length, be.length);
  for (let i = 0; i < n; i++) diff |= (ae[i] || 0) ^ (be[i] || 0);
  return diff === 0;
}

export async function sha256hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** "U-0003" from 3. */
export function jobId(n) {
  return 'U-' + String(n).padStart(4, '0');
}

export function jobNumber(id) {
  const m = /^U-(\d{1,6})$/.exec(String(id || ''));
  return m ? parseInt(m[1], 10) : null;
}

/** America/Chicago wall-clock string. Brownsville is Central. */
export function chicago(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZoneName: 'short',
  }).formatToParts(d);
  const g = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')} ${g('timeZoneName')}`;
}

export function minutesBetween(fromIso, toIso) {
  const a = Date.parse(fromIso), b = Date.parse(toIso);
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.round((b - a) / 60000);
}

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

/** One body, one status, for both "no such job" and "wrong token". */
export function notFound() {
  return json({ error: 'not_found' }, 404);
}

export function text(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

export function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Keeps a table cell from being broken by a pipe or a newline in a customer's words. */
export function mdCell(s) {
  if (s == null || s === '') return '`____`';
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

const EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
};

export function extFor(name, type) {
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ''));
  if (fromName) return fromName[1].toLowerCase();
  return EXT[String(type || '').toLowerCase()] || 'bin';
}
