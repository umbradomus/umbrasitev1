/* THE NUDGE CHANNEL — one function, so it can be swapped without touching the clock.
   GUESS (WSS coder, 2026-09-17): ntfy.sh is the Stage 1 push channel. It is free,
   needs no account, has an Android app, and a push is the whole product — a
   dashboard you have to remember to open is not. Replace `send` with a Pushover,
   Telegram or email sender and nothing else in the Worker changes. */

export async function sendNudge(env, { title, body, clickUrl, priority = 'high' }) {
  const topic = env.NTFY_TOPIC;
  if (!topic) return { ok: false, skipped: true, reason: 'NTFY_TOPIC not set' };

  const base = env.NTFY_BASE || 'https://ntfy.sh';
  const headers = { 'content-type': 'text/plain; charset=utf-8' };
  if (title) headers['Title'] = title;
  if (priority) headers['Priority'] = priority;
  if (clickUrl) headers['Click'] = clickUrl;
  if (env.NTFY_TOKEN) headers['Authorization'] = 'Bearer ' + env.NTFY_TOKEN;

  try {
    const res = await fetch(base.replace(/\/+$/, '') + '/' + encodeURIComponent(topic), {
      method: 'POST',
      headers,
      body,
    });
    return { ok: res.status < 400, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}
