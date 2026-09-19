/* UMBRA DOMUS · INTAKE WORKER · STAGE 1
   "The form posts to something we own."

   THE ONE THING IT MUST NOT DO IS LOSE A REQUEST.
   Two channels on every submit: the record (KV + R2) and the email (FormSubmit).
   They are independent on purpose. If KV is down the email still goes. If
   FormSubmit is down the record is still kept and flagged `forward_failed`.

   Routes
     POST /intake                      the site's form, byte-for-byte as it posts today
     GET  /api/job/:id?t=              the customer's view   (token)
     GET  /api/photo/:id/:n?t=         the customer's photos (token) — never a raw R2 URL
     GET  /api/jobs?k=                 Drew's aging list      (admin key)
     POST /api/job/:id/event?k=        the taps               (admin key)
     GET  /api/export/:id.md?k=        the record as vault markdown (admin key)
     GET  /admin?k=                    the aging list as a page
     GET  /health                      liveness
*/

import ADMIN_HTML from '../admin.html';
import {
  newToken, safeEqual, sha256hex, chicago, minutesBetween,
  json, notFound, text, html, extFor,
} from './util.js';
import {
  allocateId, getRecord, putRecord, listRecords, addEvent, minutesOpen, sortForAdmin,
} from './store.js';
import { forwardToFormSubmit } from './forward.js';
import { sendNudge } from './notify.js';
import { renderJobMarkdown } from './export.js';

/* Caps. A submit that breaks one of these is refused out loud, never trimmed quietly. */
/* The entry module may only export the handler object, so these stay local. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const HONEYPOT = '_honey';
const PHOTO_FIELD = /^attachment(\d*)$/;

const NUDGE_AFTER_MINUTES = 90;

/* ------------------------------------------------------------------ helpers */

function siteBase(env, nextValue) {
  /* The form's own `_next` decides which confirmation page the customer lands on
     (English or Spanish), so its origin is normally trusted. IGNORE_NEXT_ORIGIN
     pins everything to SITE_BASE_URL instead — that is how the local tests and a
     staging copy keep the redirect on the site under test. */
  if (nextValue && String(env.IGNORE_NEXT_ORIGIN) !== 'true') {
    try { return new URL(nextValue).origin; } catch (err) { /* relative _next */ }
  }
  return (env.SITE_BASE_URL || 'https://www.umbradomus.com').replace(/\/+$/, '');
}

/** The confirmation page the form already points at, with the id and token added. */
function confirmationUrl(env, nextValue, id, token) {
  const base = siteBase(env, nextValue);
  let path = '/request-received';
  if (nextValue) {
    try { path = new URL(nextValue, base).pathname; } catch (err) { /* keep default */ }
  }
  const q = new URLSearchParams();
  if (id) q.set('id', id);
  if (token) q.set('t', token);
  return base + path + (q.toString() ? '?' + q.toString() : '');
}

function statusUrl(env, nextValue, id, token) {
  const base = siteBase(env, nextValue);
  /* There is no Spanish status page on the site yet (checked 2026-09-17: no
     es/estado.html), so both languages point at /status. When one is written,
     this is the single line that routes the Spanish flow to it. */
  return `${base}/status?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`;
}

function adminOk(env, url) {
  const k = url.searchParams.get('k') || '';
  return Boolean(env.ADMIN_KEY) && safeEqual(k, env.ADMIN_KEY);
}

function adminDenied() {
  return json({ error: 'not_found' }, 404);
}

/* The status page lives on umbradomus.com and the Worker on its own host, so the
   customer's two GETs are cross-origin and need this. They are gated by a
   256-bit token in the URL, never by an origin, so `*` gives nothing away that
   the link itself does not already carry. The admin routes get no CORS at all. */
const CUSTOMER_CORS = {
  'access-control-allow-origin': '*',
  'vary': 'origin',
};

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CUSTOMER_CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

function tokenOk(rec, url) {
  const t = url.searchParams.get('t') || '';
  return Boolean(rec && rec.token) && safeEqual(t, rec.token);
}

/* ------------------------------------------------------------------- intake */

async function handleIntake(request, env, ctx) {
  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return text('We could not read that submission. Please text (956) 556-6438 and we will take it by hand.', 400);
  }

  const entries = [...form.entries()];

  /* THE HONEYPOT. A bot that filled it gets a clean-looking redirect and
     nothing else happens: no record, no email, no trace it was seen. */
  const honey = form.get(HONEYPOT);
  if (typeof honey === 'string' && honey.trim() !== '') {
    const next = String(form.get('_next') || '');
    return Response.redirect(confirmationUrl(env, next, null, null), 303);
  }

  /* Split the submission into fields and photos, keeping order. */
  const fields = {};
  const photos = [];
  for (const [name, value] of entries) {
    const isFile = value && typeof value === 'object' && 'arrayBuffer' in value;
    if (isFile) {
      if (!PHOTO_FIELD.test(name)) continue;
      if (!value.size) continue;                 /* an empty file slot is not a photo */
      const m = PHOTO_FIELD.exec(name);
      photos.push({ field: name, order: m[1] === '' ? 0 : parseInt(m[1], 10), file: value });
      continue;
    }
    if (name === HONEYPOT) continue;
    /* Several parts can share a name (a checkbox group). Keep them all. */
    if (name in fields) {
      fields[name] = Array.isArray(fields[name]) ? fields[name].concat(String(value)) : [fields[name], String(value)];
    } else {
      fields[name] = String(value);
    }
  }
  photos.sort((a, b) => a.order - b.order);

  /* THE CAPS — refused out loud, before anything is written or sent. */
  let total = 0;
  for (const p of photos) {
    total += p.file.size;
    if (p.file.size > MAX_FILE_BYTES) {
      return text(
        `That photo (${p.file.name || p.field}, ${(p.file.size / 1048576).toFixed(1)} MB) is larger than the 10 MB we can take. ` +
        `Nothing was sent. Send the request without it and text the photo to (956) 556-6438, and we will put it with your request.`,
        413,
      );
    }
  }
  if (total > MAX_TOTAL_BYTES) {
    return text(
      `Those photos add up to ${(total / 1048576).toFixed(1)} MB, more than the 25 MB we can take in one go. ` +
      `Nothing was sent. Send a few of them and text the rest to (956) 556-6438, and we will put them with your request.`,
      413,
    );
  }

  const received_at = new Date().toISOString();
  const nextValue = typeof fields._next === 'string' ? fields._next : '';

  /* 1 · the id and the token. If KV is unreachable the record cannot exist —
     the email still must. */
  let id = null, token = null, allocError = null;
  try {
    id = await allocateId(env);
    token = newToken();
  } catch (err) {
    allocError = String(err && err.message || err);
  }

  const status_link = id ? statusUrl(env, nextValue, id, token) : '';

  /* 2 · the photos into R2. A photo that will not store is recorded as a
     failure on the record, never silently dropped. */
  const stored = [];
  if (id) {
    let n = 0;
    for (const p of photos) {
      n++;
      const ext = extFor(p.file.name, p.file.type);
      const key = `jobs/${id}/intake/${n}.${ext}`;
      try {
        const buf = await p.file.arrayBuffer();
        const sha256 = await sha256hex(buf);
        await env.PHOTOS.put(key, buf, {
          httpMetadata: { contentType: p.file.type || 'application/octet-stream' },
          customMetadata: { job: id, field: p.field, filename: p.file.name || '' },
        });
        stored.push({
          n, key, field: p.field, filename: p.file.name || '',
          size: p.file.size, contentType: p.file.type || 'application/octet-stream', sha256,
        });
      } catch (err) {
        stored.push({ n, key, field: p.field, filename: p.file.name || '', size: p.file.size, contentType: p.file.type || '', sha256: null, store_failed: String(err && err.message || err) });
      }
    }
  }

  /* 3 · THE SECOND CHANNEL — AND WHO OWNS IT (R28 · R30).
     The browser sends its own copy straight to FormSubmit BEFORE it posts here,
     from the customer's own address. It posts `email_sent=yes` only when
     FormSubmit redirected it back to our own origin, which FormSubmit does only
     after it has taken the submission — so `yes` is a delivery, not an attempt.
     THE BROWSER OWNS THE EMAIL. This forward is the FALLBACK and fires only on
     `no`, so there is exactly one email per job in every combination: Worker up,
     Worker down, JavaScript off.
     WHY THE FALLBACK IS SECOND AND NOT FIRST: this send leaves from Cloudflare's
     shared address, and FormSubmit has answered it `429` on every request the
     Worker has ever taken — U-0003, U-0004, U-0005. The leg that works is the
     browser's. This one is kept because when the browser cannot send, a
     rate-limited attempt still beats no attempt. */
  const browserSent = String((fields && fields.email_sent) || '').trim().toLowerCase() === 'yes';
  let forward = { ok: false, error: 'not attempted' };
  if (browserSent) {
    forward = { ok: true, status: 0, by: 'browser' };
  } else {
    try {
      forward = await forwardToFormSubmit(env, entries, {
        job_id: id || '(no record — see forward_failed)',
        status_link: status_link || '(no record)',
      });
    } catch (err) {
      forward = { ok: false, error: String(err && err.message || err) };
    }
    forward.by = 'worker';
  }

  /* 4 · the record. Written last so it carries the outcome of 2 and 3. */
  if (id) {
    const rec = {
      id,
      token,
      received_at,
      received_at_chicago: chicago(received_at),
      source: 'site-form',
      page: request.headers.get('referer') || '',
      user_agent: request.headers.get('user-agent') || '',
      status: 'received',
      fields,
      photos: stored,
      status_link,
      quoted_at: null,
      minutes_to_quote: null,
      quote_amount: null,
      scheduled_at: null,
      scheduled_for: null,
      done_at: null,
      accepted_at: null,
      questions_sent_at: null,
      answers_in_at: null,
      questions_asked: [],
      scope: null,
      outcome: null,
      nudged_at: null,
      forwarded_at: forward.ok ? new Date().toISOString() : null,
      forward_failed: !forward.ok,
      /* which leg carried it, so a 429 can never again be invisible */
      forwarded_by: forward.by || 'worker',
      email_copy_id: typeof fields.email_copy_id === 'string' ? fields.email_copy_id : null,
      events: [],
    };
    addEvent(rec, 'received', {
      source: 'site-form',
      photos: stored.length,
      page: rec.page || undefined,
    }, received_at);
    if (!forward.ok) {
      addEvent(rec, 'forward_failed', { endpoint: 'formsubmit', detail: forward.error || ('status ' + forward.status), by: forward.by || 'worker' });
    } else {
      addEvent(rec, 'forwarded', { endpoint: 'formsubmit', status: forward.status, by: forward.by || 'worker', copy: rec.email_copy_id || undefined });
    }
    for (const p of stored) {
      if (p.store_failed) addEvent(rec, 'photo_store_failed', { key: p.key, detail: p.store_failed });
    }
    try {
      await putRecord(env, rec);
    } catch (err) {
      /* The email has already gone. Losing the record is bad; losing the
         request is the failure with no fix, and it did not happen. */
      console.error('record write failed for', id, err);
    }
  } else {
    console.error('no record created (id allocation failed):', allocError, 'forward ok:', forward.ok);
  }

  return Response.redirect(confirmationUrl(env, nextValue, id, token), 303);
}

/* ------------------------------------------------------------ customer view */

function ladder(rec) {
  return [
    { step: 'received', label: 'Received', at: rec.received_at || null },
    { step: 'quoted', label: 'Quoted', at: rec.quoted_at || null },
    { step: 'scheduled', label: 'Scheduled', at: rec.scheduled_at || null },
    { step: 'done', label: 'Done', at: rec.done_at || null },
  ];
}

async function handleCustomerJob(env, url, id) {
  const rec = await getRecord(env, id);
  /* A wrong token and a job that does not exist answer identically. */
  if (!rec || !tokenOk(rec, url)) return notFound();

  const t = url.searchParams.get('t');
  const photos = (rec.photos || [])
    .filter((p) => !p.store_failed)
    .map((p) => ({
      n: p.n,
      url: `/api/photo/${rec.id}/${p.n}?t=${encodeURIComponent(t)}`,
      contentType: p.contentType,
      size: p.size,
    }));

  return json({
    id: rec.id,
    status: rec.status,
    received_at: rec.received_at,
    received_at_chicago: rec.received_at_chicago,
    ladder: ladder(rec),
    scope: rec.scope || null,
    quote_amount: rec.quote_amount != null ? rec.quote_amount : null,
    scheduled_for: rec.scheduled_for || null,
    photos,
  });
}

async function handlePhoto(env, url, id, nRaw) {
  const rec = await getRecord(env, id);
  if (!rec || !tokenOk(rec, url)) return notFound();
  const n = parseInt(nRaw, 10);
  const p = (rec.photos || []).find((x) => x.n === n && !x.store_failed);
  if (!p) return notFound();
  const obj = await env.PHOTOS.get(p.key);
  if (!obj) return notFound();
  return new Response(obj.body, {
    headers: {
      'content-type': p.contentType || 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
      'content-disposition': `inline; filename="${rec.id}-${n}"`,
    },
  });
}

/* --------------------------------------------------------------- admin view */

function adminRow(rec, nowIso) {
  return {
    id: rec.id,
    status: rec.status,
    received_at: rec.received_at,
    received_at_chicago: rec.received_at_chicago,
    minutes_open: minutesOpen(rec, nowIso),
    minutes_to_quote: rec.minutes_to_quote,
    quoted_at: rec.quoted_at,
    scheduled_at: rec.scheduled_at,
    scheduled_for: rec.scheduled_for,
    done_at: rec.done_at,
    quote_amount: rec.quote_amount,
    nudged_at: rec.nudged_at,
    forward_failed: Boolean(rec.forward_failed),
    photos: (rec.photos || []).length,
    name: (rec.fields || {}).name || '',
    phone: (rec.fields || {}).phone || '',
    address: (rec.fields || {}).address || '',
    service: (rec.fields || {}).service || '',
    /* contact.html names the free text `message`, the other three name it `what`. */
    what: (rec.fields || {}).what || (rec.fields || {}).message || '',
    idioma: (rec.fields || {}).idioma || '',
    status_link: rec.status_link || '',
    token: rec.token,
    /* Everything the form posted, exactly as stored — repeated names stay arrays.
       Admin only: this row is served behind the key and never on the status link. */
    fields: rec.fields || {},
  };
}

async function handleJobs(env, url) {
  if (!adminOk(env, url)) return adminDenied();
  const nowIso = new Date().toISOString();
  const rows = sortForAdmin(await listRecords(env)).map((r) => adminRow(r, nowIso));
  return json({ now: nowIso, count: rows.length, jobs: rows });
}

const EVENT_TYPES = new Set(['quoted', 'scheduled', 'done', 'note']);

async function handleEvent(request, env, url, id) {
  if (!adminOk(env, url)) return adminDenied();
  const rec = await getRecord(env, id);
  if (!rec) return notFound();

  let body = {};
  const ct = request.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) body = await request.json();
    else {
      const fd = await request.formData();
      body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
    }
  } catch (err) {
    return json({ error: 'bad_body' }, 400);
  }

  const type = String(body.type || '').toLowerCase();
  if (!EVENT_TYPES.has(type)) return json({ error: 'bad_type', allowed: [...EVENT_TYPES] }, 400);

  const at = body.at && !isNaN(Date.parse(body.at)) ? new Date(body.at).toISOString() : new Date().toISOString();
  const detail = {};
  if (body.note) detail.note = String(body.note);

  if (type === 'quoted') {
    rec.quoted_at = at;
    rec.minutes_to_quote = minutesBetween(rec.received_at, at);
    rec.status = 'quoted';
    if (body.quote_amount != null && body.quote_amount !== '') {
      const amt = Number(body.quote_amount);
      if (isFinite(amt)) { rec.quote_amount = amt; detail.quote_amount = amt; }
    }
    detail.minutes_to_quote = rec.minutes_to_quote;
  } else if (type === 'scheduled') {
    rec.scheduled_at = at;
    rec.status = 'scheduled';
    if (body.scheduled_for && !isNaN(Date.parse(body.scheduled_for))) {
      rec.scheduled_for = new Date(body.scheduled_for).toISOString();
      detail.scheduled_for = rec.scheduled_for;
    }
    /* A job scheduled without a quote is still a quote that happened. */
    if (!rec.quoted_at) { rec.quoted_at = at; rec.minutes_to_quote = minutesBetween(rec.received_at, at); }
  } else if (type === 'done') {
    rec.done_at = at;
    rec.status = 'done';
  }

  /* Optional, and useful long before Stage 2: the scope paragraph the customer
     sees on their status link. */
  if (body.scope != null && body.scope !== '') { rec.scope = String(body.scope); detail.scope = true; }

  addEvent(rec, type, detail, at);
  await putRecord(env, rec);
  return json({ ok: true, id: rec.id, status: rec.status, quoted_at: rec.quoted_at, minutes_to_quote: rec.minutes_to_quote });
}

async function handleExport(env, url, id) {
  if (!adminOk(env, url)) return adminDenied();
  const rec = await getRecord(env, id);
  if (!rec) return notFound();
  return new Response(renderJobMarkdown(rec), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': `inline; filename="${rec.id}-00-JOB.md"`,
    },
  });
}

/* -------------------------------------------------------------- the nudge */

async function runNudge(env, nowIso = new Date().toISOString()) {
  const all = await listRecords(env);
  const sent = [];
  for (const rec of all) {
    if (rec.status !== 'received') continue;
    if (rec.nudged_at) continue;                       /* never twice */
    const open = minutesOpen(rec, nowIso);
    if (open == null || open < NUDGE_AFTER_MINUTES) continue;

    const link = adminLink(env);
    const who = (rec.fields || {}).name || 'someone';
    const what = ((rec.fields || {}).what || '').slice(0, 120);
    const res = await sendNudge(env, {
      title: `${rec.id} · ${open} minutes open`,
      body: `${who} — ${(rec.fields || {}).service || 'request'}\n${what}\nNot quoted yet. The promise is 2 hours.`,
      clickUrl: link,
    });

    /* The stamp is set on a delivered push only. A push that failed will be
       retried at the next tick rather than lost. */
    if (res.ok) {
      rec.nudged_at = nowIso;
      addEvent(rec, 'nudged', { channel: 'ntfy', minutes_open: open }, nowIso);
      await putRecord(env, rec);
      sent.push(rec.id);
    } else {
      console.error('nudge failed for', rec.id, res);
    }
  }
  return sent;
}

function adminLink(env) {
  const base = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!base) return '';
  /* GUESS (coder, 2026-09-17): the admin key rides in the nudge link so the push
     is one tap from the Quoted button. The ntfy topic name is itself a secret and
     is the outer gate. Set NUDGE_LINK_INCLUDES_KEY = "false" to send a bare
     /admin link instead and paste the key by hand. */
  if (String(env.NUDGE_LINK_INCLUDES_KEY || 'true') === 'false' || !env.ADMIN_KEY) return base + '/admin';
  return base + '/admin?k=' + encodeURIComponent(env.ADMIN_KEY);
}

/* ------------------------------------------------------------------- router */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if (path === '/health') return json({ ok: true, service: 'umbra-intake', now: new Date().toISOString() });

    if (path === '/intake') {
      if (method === 'POST') return handleIntake(request, env, ctx);
      return text('This endpoint takes the request form from umbradomus.com. Nothing to see here.', 405, { allow: 'POST' });
    }

    if (path === '/admin' && method === 'GET') {
      if (!adminOk(env, url)) return adminDenied();
      return html(ADMIN_HTML);
    }

    let m;
    if ((m = /^\/api\/job\/(U-\d{4,6})$/.exec(path)) && method === 'GET') {
      return withCors(await handleCustomerJob(env, url, m[1]));
    }
    if ((m = /^\/api\/job\/(U-\d{4,6})\/event$/.exec(path)) && method === 'POST') {
      return handleEvent(request, env, url, m[1]);
    }
    if ((m = /^\/api\/photo\/(U-\d{4,6})\/(\d{1,3})$/.exec(path)) && method === 'GET') {
      return withCors(await handlePhoto(env, url, m[1], m[2]));
    }
    if (path === '/api/jobs' && method === 'GET') {
      return handleJobs(env, url);
    }
    if ((m = /^\/api\/export\/(U-\d{4,6})\.md$/.exec(path)) && method === 'GET') {
      return handleExport(env, url, m[1]);
    }

    /* A test hook, never reachable in production: the cron body on demand so the
       nudge can be exercised without waiting fifteen minutes. Gated on the admin
       key AND on ALLOW_TEST_HOOKS, which is only ever set in .dev.vars. */
    if (path === '/__run-nudge' && method === 'POST') {
      if (String(env.ALLOW_TEST_HOOKS) !== 'true' || !adminOk(env, url)) return adminDenied();
      const now = url.searchParams.get('now') || new Date().toISOString();
      return json({ nudged: await runNudge(env, now) });
    }

    return notFound();
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNudge(env, new Date(event.scheduledTime || Date.now()).toISOString()));
  },
};
