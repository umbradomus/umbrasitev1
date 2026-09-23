/* THE PHONE KNOWS — ALERTS-01, 2026-09-23.
   His words: "whenever someone fills out the form i want to get notified ... make sure i get it even if
   im not logged into that email."

   THE LADDER (FLUX-UX-v1 §5), counted in BUSINESS minutes from the moment the request landed:
     0      one normal push + one Telegram message: "NEW REQUEST U-NNNN · quote due h:mm AM"
     +15    one priority-2 push — Pushover repeats it every 2 minutes for 30 minutes until he taps Acknowledge
     +45, +75, +105   a normal push each
     due (+120)       one OVERDUE push, then nothing more for that request
   Outside 7 AM–9 PM Central nothing is sent. At the first run after 7:00 AM one SUMMARY push names every
   request still waiting from overnight — priority 2 ("quote before you leave") when a visit is on the
   calendar before the last of their due times.
   ACKNOWLEDGED (any one stops the ladder and cancels Pushover's repeats): Pushover's callback with a
   receipt we issued · the Quoted / Scheduled / Done tap · POST /admin/seen/<id>.

   THE CLAIM. KV has no lock. Before a run sends anything it writes the record's next step forward with
   its own claim token, waits for concurrent writers to land (ALERT_CLAIM_SETTLE_MS, 1.5 s), re-reads, and
   sends only if its token is the one that stuck. Two runs on one due record therefore send once.

   Every message is built in this file and is given only the job id, the service, the customer's own
   first 120 characters (with any link, phone number or email address in them removed), and clock
   times. Never a link (R25), never the admin key, never a phone, an address or an email. */

import { getRecord, putRecord, listRecords, addEvent } from './store.js';
import { sendAlert, cancelPushoverTag, CHANNELS } from './notify.js';
import {
  bizAdvance, bizMinutes, replyDue, isOpen, nextOpen, openOf, clock, chicagoDay, chicagoParts,
} from './biztime.js';
import { newToken } from './util.js';

export const URGENT_AFTER = 15;            /* business minutes */
export const REPEAT_EVERY = 30;
export const MAX_ATTEMPTS = 3;             /* a 5xx channel is tried at most this many times per step */
const INTAKE_GRACE_MS = 2 * 60000;         /* the cron leaves a fresh intake alone this long */
const RETRY_AFTER_MS = 5000;
const LOG_KEEP = 60;

/* ------------------------------------------------------------ the words */

const LINKISH = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAILISH = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONEISH = /\+?\d[\d\s().-]{7,}\d/g;

/** "Drywall & Paint — Two holes in the ceiling…" — the service and the customer's first 120 characters. */
export function whatLine(rec) {
  const f = rec.fields || {};
  const service = String(Array.isArray(f.service) ? f.service.join(', ') : (f.service || 'Request')).replace(/\s+/g, ' ').trim();
  const raw = String(f.what || f.message || '').replace(/\s+/g, ' ').trim()
    .replace(LINKISH, '[link]').replace(EMAILISH, '[email]').replace(PHONEISH, '[number]');
  const words = raw.length > 120 ? raw.slice(0, 120) + '…' : raw;
  return words ? `${service} — ${words}` : service;
}

function dueOf(rec) {
  const a = rec.alerts || {};
  return Date.parse(a.due_at) || replyDue(Date.parse(rec.received_at));
}

export function buildIntake(rec) {
  return {
    title: `NEW REQUEST ${rec.id} · quote due ${clock(dueOf(rec))}`,
    message: whatLine(rec),
    priority: 1,
  };
}

function buildUrgent(rec) {
  return {
    title: `NOT SEEN · ${rec.id} · quote due ${clock(dueOf(rec))}`,
    message: whatLine(rec) + '\nTap Acknowledge when you have it. This repeats every 2 minutes for 30 minutes.',
    priority: 2,
    tags: [tagOf(rec.id)],
  };
}

function buildRepeat(rec, nowMs) {
  const left = bizMinutes(nowMs, dueOf(rec));
  return {
    title: `STILL OPEN · ${rec.id} · ${left} min left`,
    message: whatLine(rec) + `\nQuote due ${clock(dueOf(rec))}.`,
    priority: 1,
  };
}

function buildOverdue(rec) {
  return {
    title: `OVERDUE · ${rec.id} · quote was due ${clock(dueOf(rec))}`,
    message: whatLine(rec) + '\nThis is the last alert for this request.',
    priority: 1,
  };
}

function buildSummary(recs, nowMs, visitMs) {
  const n = recs.length;
  const lines = recs.map((r) => {
    const due = dueOf(r);
    return `${r.id} · ${due <= nowMs ? 'OVERDUE since ' + clock(due) : 'quote due ' + clock(due)} · ${whatLine(r)}`;
  });
  const urgent = visitMs != null;
  return {
    title: urgent
      ? `QUOTE BEFORE YOU LEAVE · ${n} request${n === 1 ? '' : 's'} from overnight`
      : `MORNING SUMMARY · ${n} request${n === 1 ? '' : 's'} waiting`,
    message: (urgent ? `Visit on the calendar at ${clock(visitMs)} — quote before you leave.\n` : '') + lines.join('\n'),
    priority: urgent ? 2 : 1,
    tags: urgent ? recs.map((r) => tagOf(r.id)) : undefined,
  };
}

export function tagOf(id) {
  return 'req_' + id;
}

/* ------------------------------------------------------------ the clock */

/** The ladder's step times for a request, in order. */
export function ladderSteps(receivedMs) {
  const steps = [{ kind: 'urgent', at: bizAdvance(receivedMs, URGENT_AFTER) }];
  for (let m = URGENT_AFTER + REPEAT_EVERY; m < 120; m += REPEAT_EVERY) steps.push({ kind: 'repeat', at: bizAdvance(receivedMs, m) });
  steps.push({ kind: 'overdue', at: replyDue(receivedMs) });
  return steps;
}

function nextStepAfter(rec, nowMs) {
  const s = ladderSteps(Date.parse(rec.received_at)).find((x) => x.at > nowMs);
  return s ? new Date(s.at).toISOString() : null;
}

/** The alerts block a new record is born with. */
export function initialAlerts(receivedIso) {
  const r = Date.parse(receivedIso);
  const open = isOpen(r);
  return {
    first_at: null,
    count: 0,
    next_at: open ? new Date(r + INTAKE_GRACE_MS).toISOString() : new Date(nextOpen(r)).toISOString(),
    ack_at: null,
    ack_by: null,
    receipt: null,
    receipts: [],
    channels: [],
    stage: open ? 'intake' : 'held',
    due_at: new Date(replyDue(r)).toISOString(),
    urgent_at: null,
    overdue_at: null,
    summary_at: null,
    retry: null,
    claim: open ? newToken() : null,
    log: [],
  };
}

/* ------------------------------------------------------------ sending and stamping */

function channelWord(results) {
  return results.map((r) => `${r.channel}:${r.skipped ? 'not set' : r.status}`).join(',');
}

async function rememberReceipt(env, receipt, ids) {
  try {
    await env.RECORDS.put('receipt:' + receipt, JSON.stringify({ ids, at: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 14 });
  } catch (err) { console.error('receipt not stored', err); }
}

/** Fold one send's results into a record's alerts block (the record is fresh from KV). */
function stamp(rec, step, msg, results, nowIso, attempts = 1) {
  const a = rec.alerts;
  const delivered = results.filter((r) => r.ok);
  if (delivered.length) {
    a.count = (a.count || 0) + (step === 'retry' ? 0 : 1);
    if (!a.first_at) a.first_at = nowIso;
    for (const r of delivered) if (!a.channels.includes(r.channel)) a.channels.push(r.channel);
  } else if (step !== 'retry') {
    /* nothing reached him: this step still counts as attempted, and the retry below carries it */
    a.count = a.count || 0;
  }
  for (const r of results) {
    if (r.receipt) { a.receipt = r.receipt; if (!a.receipts.includes(r.receipt)) a.receipts.push(r.receipt); }
    a.log.push({ at: nowIso, step, channel: r.channel, status: r.status, ok: r.ok, ...(r.skipped ? { skipped: true } : {}), ...(r.error && !r.ok ? { error: String(r.error).slice(0, 160) } : {}) });
  }
  if (a.log.length > LOG_KEEP) a.log = a.log.slice(-LOG_KEEP);
  const again = results.filter((r) => !r.ok && r.retry).map((r) => r.channel);
  if (again.length && attempts < MAX_ATTEMPTS) {
    a.retry = { at: new Date(Date.parse(nowIso) + RETRY_AFTER_MS).toISOString(), channels: again, msg, step: step === 'retry' ? (a.retry && a.retry.step) || 'retry' : step, attempts };
  } else {
    a.retry = null;
  }
  addEvent(rec, 'alerted', { step, priority: msg.priority, channels: channelWord(results) }, nowIso);
}

async function deliver(env, rec, step, msg, nowIso, only, attempts) {
  const results = await sendAlert(env, msg, only);
  const receipt = (results.find((r) => r.receipt) || {}).receipt;
  if (receipt) await rememberReceipt(env, receipt, [rec.id]);
  /* re-read so a tap that landed while we were sending is not overwritten */
  const fresh = (await getRecord(env, rec.id)) || rec;
  if (!fresh.alerts) fresh.alerts = rec.alerts;
  if (fresh.alerts.ack_at) {
    /* he acknowledged mid-send: keep his ack, just note what went */
    addEvent(fresh, 'alerted', { step, priority: msg.priority, channels: channelWord(results), after_ack: true }, nowIso);
  } else {
    /* the step's own decisions travel on `rec`; everything else is KV's */
    for (const k of ['stage', 'next_at', 'urgent_at', 'overdue_at', 'retry']) fresh.alerts[k] = rec.alerts[k];
    stamp(fresh, step, msg, results, nowIso, attempts);
    fresh.alerts.claim = null;
  }
  await putRecord(env, fresh);
  return { id: rec.id, step, priority: msg.priority, results: results.map((r) => ({ channel: r.channel, status: r.status, ok: r.ok })) };
}

/** The intake alert, sent right after the record is stored (the submission route, via waitUntil). */
export async function sendIntakeAlert(env, id, claim, nowIso) {
  const rec = await getRecord(env, id);
  if (!rec || !rec.alerts || rec.alerts.stage !== 'intake' || rec.alerts.claim !== claim || rec.alerts.ack_at) return null;
  const nowMs = Date.parse(nowIso);
  rec.alerts.stage = 'ladder';
  rec.alerts.next_at = nextStepAfter(rec, nowMs);
  return deliver(env, rec, 'intake', buildIntake(rec), nowIso, CHANNELS, 1);
}

/* ------------------------------------------------------------ the claim */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function settleMs(env) {
  const v = parseInt(env.ALERT_CLAIM_SETTLE_MS || '1500', 10);
  return isFinite(v) && v >= 0 ? v : 1500;
}

/* ------------------------------------------------------------ the summary */

function visitsBefore(all, included, fromMs, untilMs) {
  const times = [];
  /* an FC schedule entry may be an ISO string or { at }. (Not `v.at` on a string: that is String.prototype.at.) */
  const push = (v) => { const t = Date.parse(v && typeof v === 'object' ? v.at : v); if (isFinite(t) && t >= fromMs && t < untilMs) times.push(t); };
  for (const r of included) {
    if (r.scheduled_for) push(r.scheduled_for);
    if (Array.isArray(r.fc_schedule)) r.fc_schedule.forEach(push);
  }
  for (const r of all) {
    if (r.status === 'scheduled' && r.scheduled_for && !r.done_at) push(r.scheduled_for);
  }
  return times.length ? Math.min(...times) : null;
}

async function runSummary(env, all, nowMs, nowIso) {
  const open7 = openOf(nowMs);
  const waiting = all.filter((r) => r.status === 'received' && r.alerts && !r.alerts.ack_at
    && ['held', 'intake', 'ladder'].includes(r.alerts.stage) && Date.parse(r.received_at) < open7)
    .sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  if (!waiting.length) return null;

  const key = 'alerts:summary:' + chicagoDay(nowMs);
  if (await env.RECORDS.get(key)) return null;
  const claim = newToken();
  await env.RECORDS.put(key, JSON.stringify({ claim, at: nowIso }), { expirationTtl: 60 * 60 * 48 });
  await sleep(settleMs(env));
  const back = JSON.parse((await env.RECORDS.get(key)) || '{}');
  if (back.claim !== claim) return null;

  const lastDue = Math.max(...waiting.map(dueOf));
  const visit = visitsBefore(all, waiting, nowMs, lastDue);
  const msg = buildSummary(waiting, nowMs, visit);
  const results = await sendAlert(env, msg, CHANNELS);
  const receipt = (results.find((r) => r.receipt) || {}).receipt;
  if (receipt) await rememberReceipt(env, receipt, waiting.map((r) => r.id));

  for (const r of waiting) {
    const fresh = await getRecord(env, r.id);
    if (!fresh || !fresh.alerts || fresh.alerts.ack_at) continue;
    stamp(fresh, 'summary', msg, results, nowIso, 1);
    fresh.alerts.summary_at = nowIso;
    if (dueOf(fresh) <= nowMs) {
      fresh.alerts.stage = 'done';
      fresh.alerts.overdue_at = nowIso;
      fresh.alerts.next_at = null;
    } else {
      fresh.alerts.stage = 'ladder';
      fresh.alerts.next_at = nextStepAfter(fresh, nowMs);
    }
    /* the summary's own retry, if any, is carried by the first record only, so it goes once */
    if (r !== waiting[0]) fresh.alerts.retry = null;
    await putRecord(env, fresh);
  }
  await env.RECORDS.put(key, JSON.stringify({ claim, at: nowIso, sent: waiting.map((r) => r.id), priority: msg.priority }), { expirationTtl: 60 * 60 * 48 });
  return { summary: waiting.map((r) => r.id), priority: msg.priority, results: results.map((r) => ({ channel: r.channel, status: r.status, ok: r.ok })) };
}

/* ------------------------------------------------------------ the run */

/** What a due record gets at `nowMs`. */
function planFor(rec, nowMs) {
  const a = rec.alerts;
  const retryDue = a.retry && Date.parse(a.retry.at) <= nowMs;
  const stepDue = a.next_at && Date.parse(a.next_at) <= nowMs && a.stage !== 'done';
  if (!stepDue && !retryDue) return null;
  const plan = { retry: retryDue ? a.retry : null, step: null, msg: null, next_at: a.next_at, stage: a.stage };
  if (stepDue) {
    if (a.stage === 'intake' || a.stage === 'held') {
      plan.step = 'intake'; plan.msg = buildIntake(rec); plan.stage = 'ladder';
      plan.next_at = nextStepAfter(rec, nowMs);
    } else if (dueOf(rec) <= nowMs) {
      plan.step = 'overdue'; plan.msg = buildOverdue(rec); plan.stage = 'done'; plan.next_at = null;
    } else if (!a.urgent_at) {
      plan.step = 'urgent'; plan.msg = buildUrgent(rec); plan.next_at = nextStepAfter(rec, nowMs);
    } else {
      plan.step = 'repeat'; plan.msg = buildRepeat(rec, nowMs); plan.next_at = nextStepAfter(rec, nowMs);
    }
  }
  return plan;
}

/**
 * The scheduled body. Every 5 minutes. Returns what it did, for the log and the tests.
 */
export async function runAlerts(env, nowIso = new Date().toISOString(), opts = {}) {
  const nowMs = Date.parse(nowIso);
  const out = { now: nowIso, open: isOpen(nowMs), summary: null, sent: [], skipped_claims: [] };
  if (!out.open) return out;                 /* 9 PM – 7 AM: nothing leaves */

  let all = await listRecords(env);
  out.summary = await runSummary(env, all, nowMs, nowIso);
  if (out.summary) all = await listRecords(env);
  /* test hook only (reached through /__run-alerts): hold between the read and the claim, so a test can
     make two runs read the same due record before either has claimed it */
  if (opts.pauseAfterReadMs) await sleep(opts.pauseAfterReadMs);

  /* 1 · claim: write each due record's next step forward, with our token */
  const token = newToken();
  const plans = new Map();
  for (const rec of all) {
    if (rec.status !== 'received' || !rec.alerts || rec.alerts.ack_at) continue;
    const plan = planFor(rec, nowMs);
    if (!plan) continue;
    rec.alerts.claim = token;
    rec.alerts.next_at = plan.next_at;
    if (plan.retry) rec.alerts.retry = { ...plan.retry, at: new Date(nowMs + 10 * 60000).toISOString() };
    await putRecord(env, rec);
    plans.set(rec.id, plan);
  }
  if (!plans.size) return out;

  /* 2 · let a concurrent run's writes land, then keep only what is still ours */
  await sleep(settleMs(env));
  for (const [id, plan] of plans) {
    const rec = await getRecord(env, id);
    if (!rec || !rec.alerts || rec.alerts.claim !== token || rec.alerts.ack_at) { out.skipped_claims.push(id); continue; }

    /* 3 · send */
    if (plan.retry) {
      rec.alerts.retry = plan.retry;
      out.sent.push(await deliver(env, rec, 'retry', plan.retry.msg, nowIso, plan.retry.channels, (plan.retry.attempts || 1) + 1));
      if (plan.step) {
        const again = await getRecord(env, id);
        if (!again || !again.alerts || again.alerts.ack_at) continue;
        Object.assign(rec, again);
      }
    }
    if (plan.step) {
      rec.alerts.stage = plan.stage;
      rec.alerts.next_at = plan.next_at;
      if (plan.step === 'urgent') rec.alerts.urgent_at = nowIso;
      if (plan.step === 'overdue') rec.alerts.overdue_at = nowIso;
      out.sent.push(await deliver(env, rec, plan.step, plan.msg, nowIso, CHANNELS, 1));
    }
  }
  return out;
}

/* ------------------------------------------------------------ acknowledged */

/**
 * Marks a request seen and cancels Pushover's repeats for it. `by` = 'pushover' | 'tap:quoted' | 'seen'.
 * Returns true if this call is the one that acknowledged it.
 */
export async function acknowledge(env, id, by, nowIso = new Date().toISOString(), rec = null) {
  rec = rec || await getRecord(env, id);
  if (!rec) return false;
  if (!rec.alerts) rec.alerts = { first_at: null, count: 0, next_at: null, ack_at: null, receipt: null, receipts: [], channels: [], stage: 'acked', retry: null, claim: null, log: [] };
  if (rec.alerts.ack_at) return false;
  rec.alerts.ack_at = nowIso;
  rec.alerts.ack_by = by;
  rec.alerts.stage = 'acked';
  rec.alerts.next_at = null;
  rec.alerts.retry = null;
  rec.alerts.claim = null;
  addEvent(rec, 'alerts_acknowledged', { by }, nowIso);
  await putRecord(env, rec);
  const c = await cancelPushoverTag(env, tagOf(rec.id));
  if (!c.ok && !c.skipped) console.error('cancel_by_tag failed for', rec.id, c);
  return true;
}

/** Pushover's callback: the receipt must be one we issued. Anything else is a 404 with nothing written. */
export async function acknowledgeReceipt(env, receipt, nowIso) {
  if (!/^[A-Za-z0-9]{1,64}$/.test(String(receipt || ''))) return null;
  const raw = await env.RECORDS.get('receipt:' + receipt);
  if (!raw) return null;
  let ids = [];
  try { ids = JSON.parse(raw).ids || []; } catch (err) { return null; }
  const done = [];
  for (const id of ids) {
    const rec = await getRecord(env, id);
    if (!rec || !rec.alerts || !(rec.alerts.receipts || []).includes(receipt)) continue;
    if (await acknowledge(env, id, 'pushover', nowIso, rec)) done.push(id);
  }
  return done;
}

export { chicagoParts };
