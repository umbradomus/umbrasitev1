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
     POST /admin/seen/:id?k=           "I have it" — marks the alert seen (admin key; 401 without).
                                       REMINDERS-01: on HIS TABLE this cancels that push's repeats and
                                       marks ack — it does NOT stop the clock. Only the quote does.
     POST /admin/no-text/:id?k=        "No text — handled by phone" — stops the reminders and the holding
                                       text for good (admin key; REMINDERS-01 AMENDMENT 1 C)
     POST /hooks/pushover/:secret      Pushover's Acknowledge callback (path secret + a receipt we issued)
     GET  /api/windows                 what the time screen may offer (Sundays, blocked dates) — public
     POST /admin/quote/:id?k=          a new version of the quote; answers the /q/<code> link ONCE (QUOTE-API.md)
     POST /admin/quote/:id/sent?k=     "I sent it" — stops the 2-hour clock, restarts the hold from sent_at
     POST /admin/quote/:id/accept?k=   a texted YES he marks — the same booking step as the page, by "text"
                                       ({version, option}; the old {version, window} is the same thing)
     POST /admin/quote/:id/cancel?k=   withdraws a version; a booked one frees every day it held
     GET  /admin/quote/:id?k=          every version's state for the Flux Capacitor (never the code)
                                       road CO: with {kind:"change"} the create, /sent and /cancel make and move a CHANGE
                                       ORDER ("Change 1") on a booked job; the state gains `changes` when the job has one
     POST /admin/status-link/:id?k=    road W: the private status link for a text, /status?id=&v= (customer.js)
     PUT  /admin/receipt/:id?k=        road W: the receipt page kept, the job marked done and paid → {ok, link}
     GET  /receipt/:id?v=              road W: the receipt on a phone, no script (the site rewrites /receipt/* here)
     GET  /receipt/:id/print?v=        road XW: the same receipt, opening the phone's Print (Save as PDF) — one pinned script
     GET  /q/:code                     the customer's quote page — opening it changes nothing but the visit count (page.js)
     POST /q/:code  ·  /q/:code/none   Accept & confirm · None of these times work — same-origin forms, then 303 back
                                       road CO: a change order's page posts a=ok (with the name typed) or a=no to /q/:code
     GET  /j/<U-id>.<key>              UMBRA-SIDE-01 (lane P): the job on HIS phone — the page every push opens (owner.js);
                                       ?c=reply shows the one confirm; POST …/reply · …/called · …/no-texts · …/no-auto are
                                       his taps; GET …/p/<n> their photos. GET /j/board/<key>: every open job, the same way
     POST /hooks/smsgate               lane P: SMSGate's webhook (their texts back, STOP included), signed (inbound.js)
     GET  /health                      liveness
   The book behind the quote link is a Durable Object (quotebook.js, binding BOOK); quotes.js is the rest.
   The site reaches /q/* through its own rewrite (vercel.json), so the page lives on umbradomus.com.
   road W: the customer's two GETs and the receipt open with either key — `t` (the thank-you page's link, as always)
   or `v` (a private link the Flux asks for) — and answer a wrong key exactly as a job that does not exist.
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
  initialAlerts, sendIntakeAlert, runAlerts, acknowledge, acknowledgeReceipt, noTextByHand, sendQuietArrival,
} from './alerts.js';
import { renderJobMarkdown } from './export.js';
import { bizMinutes } from './biztime.js';
import { readAvailability, readConsent, windowsConfig } from './windows.js';
import {
  readQuoteBody, createQuote, markSent, cancelQuote, quoteState, bookByJob, repriceQuote,
  bookByCode, markNone, viewByCode, reconcile, bookDump, customerQuoteLink,
  readChangeBody, createChange, markChangeSent, cancelChange, customerChanges,
} from './quotes.js';
import { handleQuotePage } from './page.js';
import { customerKey, statusLink, putReceipt, receiptPage } from './customer.js';
import { handleOwner } from './owner.js';
import { handleSmsgateHook } from './inbound.js';

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
   The browser's own copy id and timings differ between two posts and are left out of the match.
   EMAIL-SUBJECT-01: so is `_subject`, which the page now stamps with the first name and the minute
   it was sent, so that Gmail gives every job its own conversation (and its own ring). */
const DEDUP_WINDOW_MS = 10 * 60000;
/* road W: `_autoresponse` too — the customer's own copy of what they sent, written by the page from the other fields */
const DEDUP_IGNORE = /^(email_sent|email_copy_id|email_copy_ms|_next|_subject|_autoresponse)$/;

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

/* road W: the key check is customer.js's customerKey (`t` exactly as before, or the private view key `v`). */

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
    /* lane P: 9 PM–7 AM, one QUIET push now (no sound), with the link; the ring starts at 7 AM */
    if (kept && rec.alerts.stage === 'held') {
      const p = sendQuietArrival(env, id, received_at).catch((err) => console.error('quiet arrival push failed for', id, err));
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
  /* A wrong token and a job that does not exist answer identically. road W: `v` opens it as well as `t`. */
  const key = await customerKey(rec, url);
  if (!key) return notFound();

  const photos = (rec.photos || [])
    .filter((p) => !p.store_failed)
    .map((p) => ({
      n: p.n,
      url: `/api/photo/${rec.id}/${p.n}?${key.k}=${encodeURIComponent(key.val)}`,
      contentType: p.contentType,
      size: p.size,
    }));

  /* road W: every day the booking holds (both days of a two-visit job), while it stands */
  const a = rec.accept && !rec.accept.cancelled_at ? rec.accept : null;
  const visits = a ? (Array.isArray(a.windows) && a.windows.length ? a.windows : (a.window ? [a.window] : []))
    .map((w) => ({ date: w.date, start: w.start, end: w.end })) : [];

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
    /* road W: the visits, the payment and whether a receipt is there (the page links it with the key it came with) */
    visits,
    paid: rec.paid ? { method: rec.paid.method, amount: rec.paid.amount, at: rec.paid.at } : null,
    receipt: Boolean(rec.receipt && rec.receipt.key),
    /* road FW: the job type for the page's top line ("Your repair · drywall & paint"); when the work finished (the
       Flux's own word with the receipt, else null — the page then says "Done" with no time); and, while a sent quote
       is still theirs to answer, their quote page, so the status link books as well as the text's link does */
    service: serviceWords(rec.fields),
    finished_at: rec.finished_at || null,
    quote_link: rec.status === 'quoted' || rec.status === 'received' ? await customerQuoteLink(env, rec, new Date().toISOString()) : null,
    /* road CO: the change orders they were sent — only when there is one, so a job with none answers exactly as before */
    ...(await changesFor(env, rec)),
  });
}

/** road CO: { changes: [...] } for the status page, or nothing at all */
async function changesFor(env, rec) {
  if (!Array.isArray(rec.changes) || !rec.changes.length) return {};
  const list = await customerChanges(env, rec, new Date().toISOString());
  return list ? { changes: list } : {};
}

/** road FW: the job type as the customer chose it, one line, or null. */
function serviceWords(f) {
  const s = f && f.service;
  const w = String(Array.isArray(s) ? s.join(', ') : (s || '')).replace(/\s+/g, ' ').trim();
  return w ? w.slice(0, 80) : null;
}

async function handlePhoto(env, url, id, nRaw) {
  const rec = await getRecord(env, id);
  if (!(await customerKey(rec, url))) return notFound();
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
    /* ALERTS-01: where the phone's ladder stands for this request.
       REMINDERS-01: and which of his two clocks it is on, and whether the holding text has gone. */
    alerts: rec.alerts ? {
      first_at: rec.alerts.first_at, count: rec.alerts.count, next_at: rec.alerts.next_at,
      ack_at: rec.alerts.ack_at, ack_by: rec.alerts.ack_by || null, stage: rec.alerts.stage,
      due_at: rec.alerts.due_at || null, channels: rec.alerts.channels || [],
      table: rec.alerts.table ? { clock: rec.alerts.table.clock, fired: rec.alerts.table.fired, ended_at: rec.alerts.table.ended_at, end_reason: rec.alerts.table.end_reason } : null,
      holding_at: rec.alerts.holding ? rec.alerts.holding.at : null,
      holding_state: rec.alerts.holding ? rec.alerts.holding.state : null,
      second_clock_started_at: rec.alerts.second_clock_started_at || null,
      call_push_at: rec.alerts.call_push_at || null,
      no_text_at: rec.alerts.no_text_at || null,
      /* lane P: the first acknowledgement of his, and his "Don't auto-text" tap */
      seen_at: rec.alerts.seen_at || null,
      no_auto_text_at: rec.alerts.no_auto_text_at || null,
    } : null,
    /* lane P · UMBRA-SIDE-01 — what the Flux learns from the phone (01-RAW-SUBMISSION.json carries this row):
       replied_at  his reply from the job page (a text from the work phone, or "I called"): the reply clock stops
       reply       { at, how: text|call, promised_by, state, gateway_id } — never the number; the words stay on the page
       seen_at     the first time he acknowledged the arrival push
       sms_opt_out { at, by: text|tap, word } — they texted STOP (or he tapped "No texts"): no text may go to them
       inbound     their texts back, newest last: [{ at, text }] */
    replied_at: rec.replied_at || null,
    reply: rec.reply ? {
      at: rec.reply.at, how: rec.reply.how, promised_by: rec.reply.promised_by || null,
      state: rec.reply.state || null, gateway_id: rec.reply.gateway_id || null,
    } : null,
    seen_at: rec.alerts && rec.alerts.seen_at ? rec.alerts.seen_at : null,
    sms_opt_out: rec.sms_opt_out ? { at: rec.sms_opt_out.at, by: rec.sms_opt_out.by, word: rec.sms_opt_out.word || null } : null,
    inbound: Array.isArray(rec.inbound) ? rec.inbound.slice(-5).map((x) => ({ at: x.at, text: x.text, ...(x.stop ? { stop: true } : {}) })) : [],
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
    /* road W: the email they gave on the contact step, if any (optional; the form asks for it beside the phone) */
    email: (rec.fields || {}).email || '',
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
    /* CONFIRM-01: the booking's confirmation text, as the website sent it — {state: sent|queued|failed|no_consent|no_key,
       at, id, sha, version, …}; null until a booking. The Flux shows "Confirmation sent ✓ 7:46 AM" from this and nothing else. */
    confirmation: rec.confirmation || null,
    quote: rec.quote || null,
    /* road W: the payment the receipt recorded, and when the receipt was kept (never its link or key) */
    paid: rec.paid || null,
    receipt_at: rec.receipt ? rec.receipt.at : null,
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

/* REMINDERS-01 AMENDMENT 1 C · "No text — handled by phone". He has this one in hand already; the
   reminders and the holding text stop for good, and nothing is sent to the customer. */
async function handleNoText(request, env, url, id) {
  if (!adminOk(env, url)) return json({ error: 'unauthorized' }, 401);
  const r = await noTextByHand(env, id, nowFor(request, env));
  if (!r) return notFound();
  return json(r);
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
  choose_window: 'this quote offers two choices: say which (option 1 or 2)',
  no_such_window: 'this quote has no such option',
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

  /* road CO: a change order — kind "change" on the create, /sent and /cancel; its number rides in `version` */
  if (body.kind === 'change') {
    if (!action) {
      const c = readChangeBody(body);
      if (c.error) return json({ error: 'invalid', reason: c.error }, c.status);
      const r = await createChange(env, id, c.change, now);
      return json(r.body, r.status);
    }
    if (!Number.isInteger(body.version) || body.version < 1) return json({ error: 'invalid', reason: 'version must be the change\'s number, a whole number, 1 or more' }, 422);
    if (action === 'sent') {
      if (body.sent_at != null && (typeof body.sent_at !== 'string' || isNaN(Date.parse(body.sent_at)))) return json({ error: 'invalid', reason: 'sent_at must be an ISO time' }, 422);
      const r = await markChangeSent(env, id, body.version, body.sent_at ? new Date(body.sent_at).toISOString() : now, now);
      return json(r.body, r.status);
    }
    if (action === 'cancel') { const r = await cancelChange(env, id, body.version, now); return json(r.body, r.status); }
    return json({ error: 'invalid', reason: 'a change order is OK\'d by the customer on its own page' }, 422);
  }
  if (body.kind != null && body.kind !== 'quote') return json({ error: 'invalid', reason: 'kind is "quote" (the default) or "change"' }, 422);

  if (!action) {
    const q = readQuoteBody(body, env);
    if (q.error) return json({ error: 'invalid', reason: q.error }, q.status);
    const r = await createQuote(env, id, q.quote, now);
    return json(r.body, r.status);
  }
  if (!Number.isInteger(body.version) || body.version < 1) return json({ error: 'invalid', reason: 'version must be a whole number, 1 or more' }, 422);
  /* REPRICE-01: his side lowering the booked price, once, with no word to the customer. Only the accepted
     version, only a positive number under its price; the shape is refused here, the rest in the book. */
  if (action === 'reprice') {
    if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price <= 0) {
      return json({ error: 'invalid', reason: 'price must be a positive number of dollars, lower than the booked price' }, 422);
    }
    const r = await repriceQuote(env, id, body.version, body.price, now);
    return json(r.body, r.status);
  }
  if (action === 'sent') {
    if (body.sent_at != null && (typeof body.sent_at !== 'string' || isNaN(Date.parse(body.sent_at)))) return json({ error: 'invalid', reason: 'sent_at must be an ISO time' }, 422);
    const at = body.sent_at ? new Date(body.sent_at).toISOString() : now;
    const r = await markSent(env, id, body.version, at, now);
    return json(r.body, r.status);
  }
  if (action === 'accept') {
    /* road W: {option: n} books every day of that option; the old {window: n} is the same number (an old-shape quote's
       options are its windows), so both keep working. `option` wins when both are sent. */
    const choice = body.option !== undefined && body.option !== null ? body.option : body.window;
    const r = await bookByJob(env, id, body.version, choice, now);
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
    if ((m = /^\/admin\/no-text\/(U-\d{4,6})$/.exec(path)) && method === 'POST') {
      return handleNoText(request, env, url, m[1]);
    }
    if ((m = /^\/admin\/quote\/(U-\d{4,6})(?:\/(sent|accept|cancel|reprice))?$/.exec(path))) {
      return handleAdminQuote(request, env, url, m[1], m[2] || null, method);
    }
    /* road W: the private status link, and the receipt kept (customer.js) */
    if ((m = /^\/admin\/status-link\/(U-\d{4,6})$/.exec(path))) {
      if (!adminOk(env, url)) return json({ error: 'unauthorized' }, 401);
      if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      const s = await statusLink(env, m[1], nowFor(request, env));
      /* the second read: an unknown job says it is the JOB that is missing ("what": "job"), so the Flux can tell it
         from an older Worker without this route, whose plain 404 {"error":"not_found"} means "no such door" */
      return s ? json(s) : json({ error: 'not_found', what: 'job' }, 404);
    }
    if ((m = /^\/admin\/receipt\/(U-\d{4,6})$/.exec(path))) {
      if (!adminOk(env, url)) return json({ error: 'unauthorized' }, 401);
      if (method !== 'PUT') return json({ error: 'method_not_allowed' }, 405, { allow: 'PUT' });
      const { body, error } = await readJson(request);
      if (error || !body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_body', reason: 'send a JSON object' }, 400);
      const r = await putReceipt(env, m[1], body, nowFor(request, env));
      return json(r.body, r.status);
    }
    if ((m = /^\/receipt\/(U-\d{4,6})(\/print)?$/.exec(path))) {
      /* road XW: /print is the same receipt, opening the phone's Print (Save as PDF) */
      return receiptPage(env, url, m[1], method, Boolean(m[2]));
    }
    if ((m = /^\/hooks\/pushover\/([^/]{1,200})$/.exec(path)) && method === 'POST') {
      return handlePushoverHook(request, env, decodeURIComponent(m[1]));
    }
    /* lane P · UMBRA-SIDE-01: SMSGate's webhook — their texts back, STOP included (signed; inbound.js) */
    if (path === '/hooks/smsgate') {
      if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      return handleSmsgateHook(request, env, nowFor(request, env));
    }
    /* lane P · the job on his phone, and the board (owner.js). Its own headers on every answer. */
    if (path.startsWith('/j/')) {
      return handleOwner(request, env, ctx, path.slice(3), method, nowFor(request, env));
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
      /* KV-FIX-01's instrument: `?count=1` runs the very same body against a counting stand-in for the
         RECORDS binding and returns `kv_ops` beside the run's own answer. The free plan allows 1,000 KV
         LIST operations a UTC day and the cron fires 840 times inside business hours, so the number of
         LISTs one run spends is a reading the round has to be able to take. Test path only — `scheduled()`
         never passes through here. */
      if (url.searchParams.get('count') === '1') {
        const ops = { list: 0, get: 0, put: 0, delete: 0 };
        const real = env.RECORDS;
        const counted = {
          list: (...a) => { ops.list += 1; return real.list(...a); },
          get: (...a) => { ops.get += 1; return real.get(...a); },
          put: (...a) => { ops.put += 1; return real.put(...a); },
          delete: (...a) => { ops.delete += 1; return real.delete(...a); },
        };
        const out = await runAlerts({ ...env, RECORDS: counted }, now, { pauseAfterReadMs: pause });
        return json({ ...out, kv_ops: ops });
      }
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
      if (hook[1] === 'book-by-code') return json(await bookByCode(env, b.code, b.version, b.option !== undefined && b.option !== null ? b.option : b.window, b.by || 'page', now));
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

    /* KV-FIX-01's one test hook, the same gate: any KV key as stored, so a reading can show the alert
       run's index key (idx:ladder) by eye. It answers a JSON envelope, never the record route's bytes. */
    if (path === '/__kv-get' && method === 'POST') {
      if (!testHookOk(env, url)) return adminDenied();
      const key = String(url.searchParams.get('key') || '');
      if (!key) return json({ error: 'key_required' }, 400);
      return json({ key, value: await env.RECORDS.get(key) });
    }

    /* REMINDERS-01's one test hook, the same gate: bend a KV record by hand, so a reading can put the
       mirror and the BOOK out of step on purpose — "quoted_at deleted from KV while the BOOK holds a
       sent version" — and prove the holding text still refuses to go. `{ set: {...}, unset: [...] }`. */
    if ((m = /^\/__poke\/(U-\d{4,6})$/.exec(path))) {
      if (method !== 'POST' || !testHookOk(env, url)) return adminDenied();
      const rec = await getRecord(env, m[1]);
      if (!rec) return notFound();
      const b = (await readJson(request)).body || {};
      for (const k of (Array.isArray(b.unset) ? b.unset : [])) delete rec[String(k)];
      Object.assign(rec, b.set && typeof b.set === 'object' ? b.set : {});
      /* KV-FIX-01: ?raw=1 writes the job key straight to KV, past putRecord, so the ladder index is left
         stale on purpose — that is the plant clause 2 reads. Test path only, behind testHookOk. */
      if (url.searchParams.get('raw') === '1') await env.RECORDS.put(jobKey(m[1]), JSON.stringify(rec));
      else await putRecord(env, rec);
      return json({ ok: true, id: m[1] });
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
