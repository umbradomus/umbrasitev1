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
     POST /admin/seen/:id?k=           "I have it" — acknowledges the alerts (admin key; 401 without)
     POST /hooks/pushover/:secret      Pushover's Acknowledge callback (path secret + a receipt we issued)
     GET  /api/windows                 what the time screen may offer (Sundays, blocked dates) — public
     POST /admin/quote/:id?k=          a new version of the quote; answers the /q/<code> link ONCE (QUOTE-API.md)
     POST /admin/quote/:id/sent?k=     "I sent it" — stops the 2-hour clock, restarts the hold from sent_at
     POST /admin/quote/:id/accept?k=   a texted YES he marks — the same booking step as the page, by "text"
     POST /admin/quote/:id/cancel?k=   withdraws a version; a booked one frees its time
     GET  /admin/quote/:id?k=          every version's state for the Flux Capacitor (never the code)
     GET  /q/:code                     the customer's quote page — opening it changes nothing but the visit count (page.js)
     POST /q/:code  ·  /q/:code/none   Accept & confirm · None of these times work — same-origin forms, then 303 back
     GET  /health                      liveness
   The book behind the quote link is a Durable Object (quotebook.js, binding BOOK); quotes.js is the rest.
   The site reaches /q/* through its own rewrite (vercel.json), so the page lives on umbradomus.com.
*/

import ADMIN_HTML from '../admin.html';
import {
  newToken, safeEqual, sha256hex, chicago, minutesBetween,
  json, notFound, text, html, extFor,
} from './util.js';
import {
  allocateId, getRecord, putRecord, listRecords, addEvent, minutesOpen, sortForAdmin, jobKey,
} from './store.js';
import { forwardToFormSubmit } from './forward.js';
import {
  initialAlerts, sendIntakeAlert, runAlerts, acknowledge, acknowledgeReceipt,
} from './alerts.js';
import { renderJobMarkdown } from './export.js';
import { bizMinutes } from './biztime.js';
import { readAvailability, readConsent, windowsConfig } from './windows.js';
import {
  readQuoteBody, createQuote, markSent, cancelQuote, quoteState, bookByJob,
  bookByCode, markNone, viewByCode, reconcile, bookDump,
} from './quotes.js';
import { handleQuotePage } from './page.js';

/* ACCEPT-PAGE-01: the book's class rides the main module beside the default export (wrangler.toml
   binds it as BOOK; its migration is new_sqlite_classes, the only kind the Workers Free plan takes). */
export { QuoteBook } from './quotebook.js';

/* Caps. A submit that breaks one of these is refused out loud, never trimmed quietly. */
/* The entry module exports the handler object and the book's class only, so these stay local. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const HONEYPOT = '_honey';
const PHOTO_FIELD = /^attachment(\d*)$/;

/* THE SAME REQUEST TWICE. A double tap, a Back-and-resend, or a phone that retried the post: the same
   words and the same photos inside ten minutes are one request — one record, one alert, one email.
   The browser's own copy id and timings differ between two posts and are left out of the match. */
const DEDUP_WINDOW_MS = 10 * 60000;
const DEDUP_IGNORE = /^(email_sent|email_copy_id|email_copy_ms|_next)$/;

/** The moment this request is handled. A test may name it, and only when test hooks are on. */
function nowFor(request, env) {
  const t = request.headers.get('x-umbra-test-now');
  if (t && String(env.ALLOW_TEST_HOOKS) === 'true' && !isNaN(Date.parse(t))) return new Date(t).toISOString();
  return new Date().toISOString();
}

async function fingerprint(fields, photos) {
  const keep = Object.keys(fields).filter((k) => !DEDUP_IGNORE.test(k)).sort().map((k) => [k, fields[k]]);
  const ph = photos.map((p) => [p.field, p.file.name || '', p.file.size]);
  return sha256hex(new TextEncoder().encode(JSON.stringify([keep, ph])));
}

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

  const received_at = nowFor(request, env);
  const nextValue = typeof fields._next === 'string' ? fields._next : '';

  /* 0 · the same request twice inside ten minutes is the first one: same confirmation, nothing new. */
  let dupKey = null;
  try {
    dupKey = 'dup:' + await fingerprint(fields, photos);
    const seen = await env.RECORDS.get(dupKey);
    if (seen) {
      const s = JSON.parse(seen);
      const age = Date.parse(received_at) - Date.parse(s.at);
      if (s.id && s.token && age >= 0 && age <= DEDUP_WINDOW_MS) {
        console.log('duplicate submission folded into', s.id, 'after', Math.round(age / 1000), 's');
        return Response.redirect(confirmationUrl(env, nextValue, s.id, s.token), 303);
      }
    }
  } catch (err) {
    /* KV unreachable: carry on — the email must still go */
  }

  /* 1 · the id and the token. If KV is unreachable the record cannot exist —
     the email still must. */
  let id = null, token = null, allocError = null;
  try {
    id = await allocateId(env);
    token = newToken();
  } catch (err) {
    allocError = String(err && err.message || err);
  }
  if (id && dupKey) {
    try {
      await env.RECORDS.put(dupKey, JSON.stringify({ id, token, at: received_at }), { expirationTtl: DEDUP_WINDOW_MS / 1000 });
    } catch (err) { /* the record matters more than the fold */ }
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

  /* 3b · EMAIL-01: the browser's report and the fallback's answer, in words,
     computed once so the record, the events and the note cannot disagree. */
  const emailSentField = typeof fields.email_sent === 'string' && fields.email_sent.trim() !== ''
    ? fields.email_sent.trim().toLowerCase() : null;
  const emailCopyMs = typeof fields.email_copy_ms === 'string' && /^[0-9]+$/.test(fields.email_copy_ms.trim())
    ? parseInt(fields.email_copy_ms.trim(), 10) : null;
  const forwardDetail = forward.error
    || ('status ' + forward.status + (forward.response && forward.response.text ? ' — ' + forward.response.text.slice(0, 160) : ''));
  const lostNote = forward.ok ? null
    : 'NO EMAIL REACHED ANYONE. The browser copy ' +
      (emailSentField === 'yes' ? 'said yes' : emailSentField === null ? 'was not attempted (no JavaScript or the old form)' : 'reported ' + emailSentField + (emailCopyMs === null ? '' : ' after ' + emailCopyMs + ' ms')) +
      ' and the Worker fallback failed (' + forwardDetail + '). This record is the only copy of the request.';

  /* 3c · FORM-WINDOWS-01: the times they offered and their answer on texts. Both null on a page without
     the time screen. A bad availability is kept with its reason and never costs the request. */
  let availability = null, consent = null;
  try {
    availability = readAvailability(fields, env, received_at);
  } catch (err) {
    availability = { flexible: false, choices: [], notes: '', invalid: 'unreadable: ' + String(err && err.message || err) };
  }
  try {
    consent = await readConsent(fields, request, received_at);
  } catch (err) {
    consent = null;
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
      availability,
      ...(consent ? { consent } : {}),
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
      /* ALERTS-01: the phone's ladder for this request — see alerts.js */
      alerts: initialAlerts(received_at),
      forwarded_at: forward.ok ? new Date().toISOString() : null,
      forward_failed: !forward.ok,
      /* which leg carried it, so a 429 can never again be invisible */
      forwarded_by: forward.by || 'worker',
      email_copy_id: typeof fields.email_copy_id === 'string' ? fields.email_copy_id : null,
      /* EMAIL-01 · THE FIELD THAT DECIDES IS ON THE RECORD. Until 2026-09-20
         `email_sent` and `email_copy_ms` were read here and dropped, so the one
         thing that chose which channel owned the email could never be read
         back (U-0006: browser said no at 21 s, fallback 429, record silent).
         `email_sent` is the browser's own word, verbatim: 'yes' | 'no' | null
         (null = JavaScript off or the old form; the copy was never attempted).
         `sent_by` is WHO DELIVERED: 'browser' | 'worker' | 'nobody'. */
      email_sent: emailSentField,
      email_copy_ms: emailCopyMs,
      sent_by: forward.ok ? (forward.by || 'worker') : 'nobody',
      /* both legs failed: the browser did not say yes and the fallback did not
         deliver. A job with no email must never look like a job with one. */
      email_lost: !forward.ok,
      status_note: forward.ok ? null : lostNote,
      /* what FormSubmit answered the fallback, in words, when it refused */
      forward_response: forward.response || null,
      events: [],
    };
    addEvent(rec, 'received', {
      source: 'site-form',
      photos: stored.length,
      page: rec.page || undefined,
    }, received_at);
    if (!forward.ok) {
      addEvent(rec, 'forward_failed', {
        endpoint: 'formsubmit', detail: forwardDetail, by: forward.by || 'worker',
        response: forward.response ? forward.response.text : undefined,
      });
      /* EMAIL-01 · THE DOUBLE FAILURE, LOUD. `forward_failed` alone has been on
         every job since U-0003 and reads as "the fallback failed" — which is
         also what it says when the browser DID deliver. This event fires only
         when neither leg did, and says so in words the audit list prints. */
      addEvent(rec, 'email_lost', {
        note: lostNote,
        browser: emailSentField === null ? 'not attempted (no JavaScript or old form)' : ('email_sent=' + emailSentField + (emailCopyMs === null ? '' : ' after ' + emailCopyMs + ' ms')),
        worker: forwardDetail,
        response: forward.response ? forward.response.text : undefined,
      });
    } else {
      addEvent(rec, 'forwarded', { endpoint: 'formsubmit', status: forward.status, by: forward.by || 'worker', copy: rec.email_copy_id || undefined });
    }
    for (const p of stored) {
      if (p.store_failed) addEvent(rec, 'photo_store_failed', { key: p.key, detail: p.store_failed });
    }
    let kept = false;
    try {
      await putRecord(env, rec);
      kept = true;
    } catch (err) {
      /* The email has already gone. Losing the record is bad; losing the
         request is the failure with no fix, and it did not happen. */
      console.error('record write failed for', id, err);
    }
    /* 5 · THE PHONE. After the record is kept, off the customer's clock. Outside 7 AM–9 PM the record is
       born `held` and nothing goes until the 7:00 AM summary. If this send dies with the request, the
       cron picks the record up two minutes later. */
    if (kept && rec.alerts.stage === 'intake') {
      const p = sendIntakeAlert(env, id, rec.alerts.claim, received_at).catch((err) => console.error('intake alert failed for', id, err));
      if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
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
    /* FORM-WINDOWS-01 (B7 · B8): the register's two-hour column reads THIS, never a second clock.
       minutes_to_quote above stays raw. */
    business_minutes_to_quote: rec.quoted_at ? bizMinutes(Date.parse(rec.received_at), Date.parse(rec.quoted_at)) : null,
    quoted_at: rec.quoted_at,
    scheduled_at: rec.scheduled_at,
    scheduled_for: rec.scheduled_for,
    done_at: rec.done_at,
    quote_amount: rec.quote_amount,
    /* ALERTS-01: where the phone's ladder stands for this request */
    alerts: rec.alerts ? {
      first_at: rec.alerts.first_at, count: rec.alerts.count, next_at: rec.alerts.next_at,
      ack_at: rec.alerts.ack_at, ack_by: rec.alerts.ack_by || null, stage: rec.alerts.stage,
      due_at: rec.alerts.due_at || null, channels: rec.alerts.channels || [],
    } : null,
    forward_failed: Boolean(rec.forward_failed),
    /* EMAIL-01: which leg was tried, which channel owned the email, and whether any email went at all */
    forwarded_by: rec.forwarded_by || null,
    email_sent: rec.email_sent === undefined ? null : rec.email_sent,
    email_copy_ms: rec.email_copy_ms === undefined ? null : rec.email_copy_ms,
    sent_by: rec.sent_by || (rec.forward_failed ? null : rec.forwarded_by || null),
    email_lost: Boolean(rec.email_lost),
    status_note: rec.status_note || null,
    photos: (rec.photos || []).length,
    name: (rec.fields || {}).name || '',
    phone: (rec.fields || {}).phone || '',
    address: (rec.fields || {}).address || '',
    service: (rec.fields || {}).service || '',
    /* contact.html names the free text `message`, the other three name it `what`. */
    what: (rec.fields || {}).what || (rec.fields || {}).message || '',
    idioma: (rec.fields || {}).idioma || '',
    /* FORM-WINDOWS-01 (B5): the times they offered and their answer on texts — FC-1.4b reads them here */
    availability: rec.availability === undefined ? null : rec.availability,
    consent: rec.consent || null,
    /* ACCEPT-PAGE-01: the quote as the book holds it (never the code), and the booking its YES made */
    accept: rec.accept || null,
    accepted_at: rec.accepted_at || null,
    quote: rec.quote || null,
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
  /* The Quoted tap (and Scheduled or Done, which imply it) is also "I have it": the alerts stop. */
  if (type === 'quoted' || type === 'scheduled' || type === 'done') {
    await acknowledge(env, rec.id, 'tap:' + type, at);
  }
  return json({ ok: true, id: rec.id, status: rec.status, quoted_at: rec.quoted_at, minutes_to_quote: rec.minutes_to_quote });
}

async function handleSeen(request, env, url, id) {
  if (!adminOk(env, url)) return json({ error: 'unauthorized' }, 401);
  const rec = await getRecord(env, id);
  if (!rec) return notFound();
  const acked = await acknowledge(env, id, 'seen', nowFor(request, env), rec);
  const back = await getRecord(env, id);
  return json({ ok: true, id, acknowledged_now: acked, ack_at: back && back.alerts ? back.alerts.ack_at : null });
}

async function handlePushoverHook(request, env, secret) {
  /* A wrong path and an unknown receipt answer identically, and neither writes anything. */
  if (!env.HOOK_SECRET || !safeEqual(secret, env.HOOK_SECRET)) return notFound();
  let receipt = '';
  try {
    const fd = await request.formData();
    receipt = String(fd.get('receipt') || '');
  } catch (err) {
    return notFound();
  }
  const done = await acknowledgeReceipt(env, receipt, nowFor(request, env));
  if (done === null) return notFound();
  return json({ ok: true, acknowledged: done });
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

/* ------------------------------------------------------------ the quote link (ACCEPT-PAGE-01) */

async function readJson(request) {
  try { return { body: await request.json() }; } catch (err) { return { error: true }; }
}

const REFUSAL = {
  taken: 'that time overlaps a booking another job already holds',
  replaced: 'a newer version of this quote has been sent',
  updating: 'a newer version of this quote exists and is not marked sent yet',
  withdrawn: 'this quote was withdrawn',
  too_close: 'the cutoff has passed',
  choose_window: 'this quote offers two windows: say which (window 1 or 2)',
  no_such_window: 'this quote has no such window',
};

/** POST|GET /admin/quote/<id>[/sent|/accept|/cancel] — the Flux Capacitor's calls. QUOTE-API.md. */
async function handleAdminQuote(request, env, url, id, action, method) {
  if (!adminOk(env, url)) return json({ error: 'unauthorized' }, 401);
  const now = nowFor(request, env);
  if (!action && method === 'GET') {
    const s = await quoteState(env, id, now);
    return s ? json(s) : notFound();
  }
  if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: action ? 'POST' : 'GET, POST' });
  const { body, error } = await readJson(request);
  if (error || !body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_body', reason: 'send a JSON object' }, 400);

  if (!action) {
    const q = readQuoteBody(body, env);
    if (q.error) return json({ error: 'invalid', reason: q.error }, q.status);
    const r = await createQuote(env, id, q.quote, now);
    return json(r.body, r.status);
  }
  if (!Number.isInteger(body.version) || body.version < 1) return json({ error: 'invalid', reason: 'version must be a whole number, 1 or more' }, 422);
  if (action === 'sent') {
    if (body.sent_at != null && (typeof body.sent_at !== 'string' || isNaN(Date.parse(body.sent_at)))) return json({ error: 'invalid', reason: 'sent_at must be an ISO time' }, 422);
    const at = body.sent_at ? new Date(body.sent_at).toISOString() : now;
    const r = await markSent(env, id, body.version, at, now);
    return json(r.body, r.status);
  }
  if (action === 'accept') {
    const r = await bookByJob(env, id, body.version, body.window, now);
    if (r.state === 'not_found') return notFound();
    const ok = r.state === 'booked' || r.state === 'already_booked';
    return json(ok ? r : { error: r.state, reason: REFUSAL[r.state] || r.state, ...r }, ok ? 200 : 409);
  }
  const r = await cancelQuote(env, id, body.version, now);
  return json(r.body, r.status);
}

/** The gate every test hook shares: ALLOW_TEST_HOOKS (only ever in a test's .dev.vars) AND the admin key. */
function testHookOk(env, url) {
  return String(env.ALLOW_TEST_HOOKS) === 'true' && adminOk(env, url);
}

/* ------------------------------------------------------------------- router */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if (path === '/health') return json({ ok: true, service: 'umbra-intake', now: new Date().toISOString() });

    if (path === '/api/windows' && method === 'GET') {
      return withCors(json(windowsConfig(env, nowFor(request, env))));
    }

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

    if ((m = /^\/admin\/seen\/(U-\d{4,6})$/.exec(path)) && method === 'POST') {
      return handleSeen(request, env, url, m[1]);
    }
    if ((m = /^\/admin\/quote\/(U-\d{4,6})(?:\/(sent|accept|cancel))?$/.exec(path))) {
      return handleAdminQuote(request, env, url, m[1], m[2] || null, method);
    }
    if ((m = /^\/hooks\/pushover\/([^/]{1,200})$/.exec(path)) && method === 'POST') {
      return handlePushoverHook(request, env, decodeURIComponent(m[1]));
    }

    /* ACCEPT-PAGE-02: the customer's page. Everything under /q answers from page.js with its own headers. */
    if (path === '/q' || path.startsWith('/q/')) {
      return handleQuotePage(request, env, url, path.slice(3), method, nowFor(request, env));
    }

    /* A test hook, never reachable in production: the cron body on demand, at a named moment, so the
       ladder can be exercised without waiting. Gated on the admin key AND on ALLOW_TEST_HOOKS, which is
       only ever set in a test's .dev.vars. */
    if (path === '/__run-alerts' && method === 'POST') {
      if (String(env.ALLOW_TEST_HOOKS) !== 'true' || !adminOk(env, url)) return adminDenied();
      const now = url.searchParams.get('now') || new Date().toISOString();
      const pause = Math.min(5000, parseInt(url.searchParams.get('pause') || '0', 10) || 0);
      return json(await runAlerts(env, now, { pauseAfterReadMs: pause }));
    }

    /* ACCEPT-PAGE-01's test hooks — the same gate as /__run-alerts. They reach exactly the functions the
       page (ACCEPT-PAGE-02) will call, so the step is proved without the page. */
    const hook = /^\/__(book-by-code|none-by-code|view-by-code|reconcile|book-dump|fail-stamp\/(U-\d{4,6}))$/.exec(path);
    if (hook) {
      if (method !== 'POST' || !testHookOk(env, url)) return adminDenied();
      const now = nowFor(request, env);
      if (hook[1] === 'reconcile') return json(await reconcile(env, now));
      if (hook[1] === 'book-dump') return json(await bookDump(env));
      if (hook[2]) {
        await env.RECORDS.put('test:fail-stamp:' + hook[2], String(parseInt(url.searchParams.get('times') || '1', 10) || 1));
        return json({ ok: true });
      }
      const b = (await readJson(request)).body || {};
      if (hook[1] === 'book-by-code') return json(await bookByCode(env, b.code, b.version, b.window, b.by || 'page', now));
      if (hook[1] === 'none-by-code') return json(await markNone(env, b.code, b.version, now));
      return json(await viewByCode(env, b.code, now));
    }

    /* ACCEPT-PAGE-02's one test hook, the same gate: the job's KV record exactly as stored, so a reading can
       prove a visit left it byte-identical. */
    if ((m = /^\/__record\/(U-\d{4,6})$/.exec(path))) {
      if (method !== 'POST' || !testHookOk(env, url)) return adminDenied();
      const raw = await env.RECORDS.get(jobKey(m[1]));
      return raw === null ? notFound() : new Response(raw, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    return notFound();
  },

  async scheduled(event, env, ctx) {
    const now = new Date(event.scheduledTime || Date.now()).toISOString();
    /* ACCEPT-PAGE-01: after the alert ladder (never inside it), the book's mirror and the pushes it owes */
    ctx.waitUntil(runAlerts(env, now).catch((err) => console.error('runAlerts failed', err))
      .then(() => reconcile(env, now)).catch((err) => console.error('reconcile failed', err)));
  },
};
