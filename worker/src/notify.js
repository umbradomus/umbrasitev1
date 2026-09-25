/* THE ALERT CHANNELS — ALERTS-01, 2026-09-23. One call, two senders, so the clock never knows which.
   PUSHOVER FIRST: it rings until he taps Acknowledge (priority 2), can break through Do Not Disturb, and
   answers from its own API rather than a shared free tier. TELEGRAM SECOND: the same alert from a bot
   that messages only him, so one provider's outage is not silence.
   The Stage 1 push service is gone, not commented out: its free tier is rate-limited per IP address,
   every Cloudflare Worker shares outgoing addresses (its issue 1963, 19 Sep 2026), and its link carried
   the admin key.

   THE RULES EVERY MESSAGE KEEPS:
     · NO LINK. The request waits on the computer (R25); nothing here opens a page.
     · Never the admin key, a customer's phone, address or email. The builders in alerts.js are the only
       place a message is written, and they are given none of those.
     · Never throws. Each channel answers { ok, channel, status, receipt?, retry }.
     · A 4xx is logged and never retried (the request itself is wrong; sending it again cannot help).
       A 5xx or a network failure is `retry: true` and is tried again on the next scheduled run. */

const PUSHOVER_MAX_MESSAGE = 1024;
const PUSHOVER_MAX_TITLE = 250;
const TELEGRAM_MAX_TEXT = 4096;

function cut(s, n) {
  s = String(s == null ? '' : s);
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

/* SEAT FIX (1Supe7, 2026-09-25, review N4 · AMENDMENT 1 F, the Pushover half): an override of where the pushes go is
   honoured only with the test hooks on AND a 127.0.0.1 address — the same door holding.js keeps for SMSGate — so a
   production build cannot be pointed anywhere but the real service. */
function base(env, v, fallback) {
  const o = String(v || '').replace(/\/+$/, '');
  if (o && String((env || {}).ALLOW_TEST_HOOKS) === 'true' && /^http:\/\/127\.0\.0\.1(:\d{1,5})?(\/[^\s]*)?$/.test(o)) return o;
  return String(fallback).replace(/\/+$/, '');
}

async function bodyOf(res) {
  try { return await res.json(); } catch (err) { return null; }
}

/**
 * Pushover. `msg` = { title, message, priority (-2..2), tags?: string[], expire?, retry? }.
 * Priority 2 carries retry 120, expire 1800, the tags, and the callback that acknowledges it.
 * REMINDERS-01 AMENDMENT 1 D: the clock hands in a shorter `expire` so no repeat ever rings past 9 PM.
 */
export async function sendPushover(env, msg) {
  const channel = 'pushover';
  if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER) return { ok: false, channel, status: 0, skipped: true, retry: false, error: 'PUSHOVER_TOKEN or PUSHOVER_USER not set' };
  const form = new URLSearchParams();
  form.set('token', env.PUSHOVER_TOKEN);
  form.set('user', env.PUSHOVER_USER);
  form.set('title', cut(msg.title, PUSHOVER_MAX_TITLE));
  form.set('message', cut(msg.message, PUSHOVER_MAX_MESSAGE));
  const priority = Number(msg.priority || 0);
  form.set('priority', String(priority));
  if (priority === 2) {
    const retry = Math.max(30, Number(msg.retry) || 120);
    /* Pushover's own floor is 30 s retry and 30 s expire; the caller may only shorten the window. */
    const expire = Math.max(30, Math.min(1800, Number(msg.expire) || 1800));
    form.set('retry', String(retry));
    form.set('expire', String(expire));
    if (msg.tags && msg.tags.length) form.set('tags', msg.tags.join(','));
    const cb = callbackUrl(env);
    if (cb) form.set('callback', cb);
  }
  try {
    const res = await fetch(base(env, env.PUSHOVER_API_BASE, 'https://api.pushover.net') + '/1/messages.json', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const b = await bodyOf(res);
    const ok = res.status >= 200 && res.status < 300 && (!b || b.status === 1 || b.status === undefined);
    const out = { ok, channel, status: res.status, retry: res.status >= 500 };
    if (b && b.receipt) out.receipt = String(b.receipt);
    if (!ok) out.error = b && b.errors ? b.errors.join('; ') : 'HTTP ' + res.status;
    return out;
  } catch (err) {
    return { ok: false, channel, status: 0, retry: true, error: String(err && err.message || err) };
  }
}

/** Telegram. Plain text only — no parse_mode, no buttons, so nothing in a customer's words can format or link. */
export async function sendTelegram(env, msg) {
  const channel = 'telegram';
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { ok: false, channel, status: 0, skipped: true, retry: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set' };
  const text = cut(msg.title + '\n' + msg.message, TELEGRAM_MAX_TEXT);
  try {
    const res = await fetch(base(env, env.TELEGRAM_API_BASE, 'https://api.telegram.org') + '/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
    const b = await bodyOf(res);
    const ok = res.status >= 200 && res.status < 300 && (!b || b.ok !== false);
    const out = { ok, channel, status: res.status, retry: res.status >= 500 };
    if (!ok) out.error = b && b.description ? String(b.description) : 'HTTP ' + res.status;
    return out;
  } catch (err) {
    return { ok: false, channel, status: 0, retry: true, error: String(err && err.message || err) };
  }
}

const SENDERS = { pushover: sendPushover, telegram: sendTelegram };
export const CHANNELS = ['pushover', 'telegram'];

/** The one call the clock makes. `only` limits it to some channels (a retry). Pushover goes first. */
export async function sendAlert(env, msg, only = CHANNELS) {
  const results = [];
  for (const ch of CHANNELS) {
    if (!only.includes(ch)) continue;
    const r = await SENDERS[ch](env, msg);
    if (!r.ok && !r.skipped) console.error('alert channel failed', ch, r.status, r.error, r.retry ? '(will retry)' : '(4xx: not retried)');
    results.push(r);
  }
  return results;
}

/** Stops a priority-2 alert repeating once he has acknowledged it any other way. */
export async function cancelPushoverTag(env, tag) {
  if (!env.PUSHOVER_TOKEN) return { ok: false, skipped: true };
  try {
    const res = await fetch(base(env, env.PUSHOVER_API_BASE, 'https://api.pushover.net') + '/1/receipts/cancel_by_tag/' + encodeURIComponent(tag) + '.json', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: env.PUSHOVER_TOKEN }).toString(),
    });
    return { ok: res.status < 400, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/** Where Pushover reports the tap on Acknowledge. The path secret is the gate; it never appears in a message. */
export function callbackUrl(env) {
  const b = String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!b || !env.HOOK_SECRET) return '';
  return b + '/hooks/pushover/' + encodeURIComponent(env.HOOK_SECRET);
}
