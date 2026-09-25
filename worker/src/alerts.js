/* THE PHONE KNOWS — ALERTS-01, 2026-09-23 · HIS TABLE — REMINDERS-01, 2026-09-24.
   His words: "whenever someone fills out the form i want to get notified ... make sure i get it even if
   im not logged into that email."

   ═══ HIS TABLE (REMINDERS-01), his words 09-23 17:1x CDT: "first hour ill get notified on the phone
   every 15 mins. second hour will be every 10 mins. last 30 mins will be notified every 5 mins."
   Counted in BUSINESS minutes from the moment the request landed (7 AM–9 PM Central, seven days):

     0                          the arrival push, as before
     15 · 30 · 45 · 60          one push each, priority 1
     70 · 80 · 90               one push each, priority 2
     95 · 100 · 105 · 110 · 115 one push each, priority 2
     120, no quote sent         the HOLDING TEXT to the customer (holding.js), and a SECOND two-hour
                                clock on the same table
     the second clock's 120     ONE "CALL THEM NOW" push, and the ladder ends for good

   Each push says the minutes left. The cron stays every five minutes: a slot is due when its minute is at
   or past it and it has not fired; never two in one run — the latest due slot fires and the earlier ones
   are marked skipped in the log.

   WHAT STOPS IT (AMENDMENT 1 C): the quote going out — the quote API's /sent, the Quoted tap, or a SENT
   version in the BOOK read fresh · the request leaving "received" (Scheduled, Done, withdrawn) · the
   admin page's "No text — handled by phone". From then nothing fires for that request.
   ACKNOWLEDGEMENT DOES NOT STOP IT: a Pushover receipt, the callback or /admin/seen cancels that one
   push's repeats (cancel_by_tag) and marks ack — the next slot still fires.

   NIGHT, EXACTLY (AMENDMENT 1 D): nothing at all leaves between 9 PM and 7 AM. Before every priority-2
   push the request's tag is cancelled, so only one repeat chain is ever alive; expire is cut to the
   seconds left before 9 PM, and inside the last two minutes the push goes as priority 1 with no repeats.

   ═══ THE LADDER BEFORE THIS ROUND (ALERTS-01) is kept, untouched, for records that already carry it:
   +15 priority 2, +45/+75/+105 normal, one OVERDUE at the due time. A record with no `alerts` block is
   left alone, as ALERTS-01 left the ones before it. Only records that land from now on carry `table`.

   THE 7:00 AM SUMMARY is unchanged: one push naming every request still waiting from overnight.

   THE CLAIM. KV has no lock. Before a run sends anything it writes the record's claim token, waits for
   concurrent writers to land (ALERT_CLAIM_SETTLE_MS, 1.5 s), re-reads, and acts only if its token is the
   one that stuck. The holding text has a harder lock still: an insert-if-absent row in the BOOK Durable
   Object, so two runs can never both POST (ALERTS-01 FOUND 4 — KV is not a lock).

   Every message is built in this file and is given only the job id, the service, the customer's own
   first 120 characters (with any link, phone number or email address in them removed), and clock
   times. Never a link (R25), never the admin key, never a phone, an address, an email, the texting key
   or the holding text's own words. */

import { getRecord, putRecord, listRecords, addEvent } from './store.js';
import { sendAlert, cancelPushoverTag, CHANNELS } from './notify.js';
import {
  bizAdvance, bizMinutes, replyDue, isOpen, nextOpen, openOf, clock, chicagoDay, chicagoParts,
} from './biztime.js';
import { newToken } from './util.js';
import { quoteWentOut, markOnce, markSet } from './booklock.js';
import {
  usNumber, holdingText, ttlFor, secondsToClose, hasKey, postHolding, getHoldingState,
  MIN_TTL, SENDING_STALE_MS, DELIVERY_GRACE_MS, DONE_STATES, FAILED_STATES,
} from './holding.js';

export const URGENT_AFTER = 15;            /* business minutes — the ALERTS-01 ladder, for older records */
export const REPEAT_EVERY = 30;
export const MAX_ATTEMPTS = 3;             /* a 5xx channel is tried at most this many times per step */
const INTAKE_GRACE_MS = 2 * 60000;         /* the cron leaves a fresh intake alone this long */
const RETRY_AFTER_MS = 5000;
const LOG_KEEP = 60;

/* ─── HIS TABLE ─── every 15 minutes in the first hour, every 10 in the second, every 5 in the last half
   hour. Priority 1 through minute 60, priority 2 from minute 70. The clock is two hours long. */
export const TABLE = [15, 30, 45, 60, 70, 80, 90, 95, 100, 105, 110, 115];
export const CLOCK_MIN = 120;
export const prioritySlot = (slot) => (slot <= 60 ? 1 : 2);
/* AMENDMENT 1 D: inside this many seconds of 9 PM a priority-2 push goes as priority 1, so nothing rings
   after the wire. Pushover's own floor for retry and expire is 30 s. */
const NO_REPEAT_UNDER_S = 120;

export const isTable = (rec) => Boolean(rec && rec.alerts && rec.alerts.table);
const holdKey = (id) => 'hold:' + id;
const holdGatewayId = (id) => id + '-hold';

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

/* ------------------------------------------------------------ HIS TABLE · the words */

/** Which clock a table record is on, and where that clock started. */
export function anchorOf(rec) {
  const a = rec.alerts;
  return a.table.clock === 2 ? Date.parse(a.second_clock_started_at) : Date.parse(rec.received_at);
}

/** When this clock runs out — the quote's due time on clock 1, the second promise on clock 2. */
export function endOf(rec) {
  return rec.alerts.table.clock === 2 ? bizAdvance(anchorOf(rec), CLOCK_MIN) : dueOf(rec);
}

/** "STILL OPEN · U-0012 · 45 min left" — his own words for a slot on the table. */
function buildSlot(rec, slot) {
  const second = rec.alerts.table.clock === 2;
  return {
    title: `STILL OPEN · ${rec.id} · ${CLOCK_MIN - slot} min left`,
    message: whatLine(rec)
      + `\n${second ? 'Second clock — the holding text has gone. Quote by' : 'Quote due'} ${clock(endOf(rec))}.`,
    priority: prioritySlot(slot),
    ...(prioritySlot(slot) === 2 ? { tags: [tagOf(rec.id)] } : {}),
  };
}

/** The last word on a request: he picks up the phone. Never anything after it. */
function buildCallThem(rec, why) {
  return {
    title: `CALL THEM NOW · ${rec.id} — ${why}`,
    message: whatLine(rec) + '\nThe ladder ends here. Nothing more will fire for this request.',
    priority: 2,
    tags: [tagOf(rec.id)],
  };
}

/** The holding text's own three words. The push names the job id and never the number or the text. */
function buildHolding(rec, kind) {
  const W = {
    queued: { title: `HOLDING TEXT QUEUED · ${rec.id}`, priority: 1, line: 'The two-hour holding text is with the phone. A second two-hour clock has started.' },
    delivered: { title: `HOLDING TEXT DELIVERED · ${rec.id}`, priority: 1, line: 'The phone reported it delivered. The second clock is running.' },
    failed: { title: `HOLDING TEXT DID NOT GO · ${rec.id} — call them`, priority: 2, line: 'The text did not go and will not be tried again.' },
    silent: { title: `HOLDING TEXT · ${rec.id} — no delivery word, call them`, priority: 2, line: 'The phone never said what became of it.' },
    nokey: { title: `no texting key on the website — call them · ${rec.id}`, priority: 2, line: 'SMSGATE_AUTH is not set on the Worker, so no text can go.' },
    nonumber: { title: `no US number on ${rec.id} — call them`, priority: 2, line: 'The request carries no ten-digit US number.' },
    bookdown: { title: `HOLDING TEXT NOT SENT · ${rec.id} — call them`, priority: 2, line: 'The quote book would not answer, so nothing was sent rather than something wrong.' },
  }[kind];
  return {
    title: W.title,
    message: whatLine(rec) + '\n' + W.line,
    priority: W.priority,
    ...(W.priority === 2 ? { tags: [tagOf(rec.id)] } : {}),
  };
}

/* AMENDMENT 1 D · NIGHT, EXACTLY. A priority-2 push may not outlive the business day: its expire is cut
   to the seconds left before 9 PM, and inside the last two minutes it goes as priority 1 — no retry
   chain at all, so nothing can ring after the wire. */
function nightSafe(msg, nowMs) {
  if (Number(msg.priority) !== 2) return msg;
  const left = secondsToClose(nowMs);
  if (left < NO_REPEAT_UNDER_S) {
    const { tags, ...rest } = msg;
    return { ...rest, priority: 1, downgraded: true };
  }
  return { ...msg, expire: Math.min(1800, left) };
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
    /* REMINDERS-01 · HIS TABLE. Only records that land from now on carry this block; a record that
       already holds an ALERTS-01 `alerts` block keeps the ladder it was born with, and a record with no
       `alerts` block at all is left alone, exactly as ALERTS-01 left the ones before it. */
    table: { clock: 1, fired: [], skipped: [], ended_at: null, end_reason: null },
    holding: null,
    second_clock_started_at: null,
    call_push_at: null,
    no_text_at: null,
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

/* The keys a step decides for itself. On HIS TABLE the step also owns the table block and the holding
   block, because the run just moved them on. */
const STEP_KEYS = ['stage', 'next_at', 'urgent_at', 'overdue_at', 'retry'];
const TABLE_KEYS = ['table', 'holding', 'second_clock_started_at', 'call_push_at'];

async function deliver(env, rec, step, msg, nowIso, only, attempts) {
  /* AMENDMENT 1 D: one retry chain at a time. Before a priority-2 push goes out, this request's own tag
     is cancelled, so six overlapping chains can never ring at once. */
  if (isTable(rec) && Number(msg.priority) === 2) {
    const c = await cancelPushoverTag(env, tagOf(rec.id));
    if (!c.ok && !c.skipped) console.error('pre-push cancel_by_tag failed for', rec.id, c.status);
  }
  const results = await sendAlert(env, msg, only);
  const receipt = (results.find((r) => r.receipt) || {}).receipt;
  if (receipt) await rememberReceipt(env, receipt, [rec.id]);
  /* re-read so a tap that landed while we were sending is not overwritten */
  const fresh = (await getRecord(env, rec.id)) || rec;
  if (!fresh.alerts) fresh.alerts = rec.alerts;
  /* On HIS TABLE an acknowledgement does NOT stop the clock, so a mid-send ack never swallows the step. */
  if (fresh.alerts.ack_at && !isTable(fresh)) {
    /* he acknowledged mid-send: keep his ack, just note what went */
    addEvent(fresh, 'alerted', { step, priority: msg.priority, channels: channelWord(results), after_ack: true }, nowIso);
  } else {
    /* the step's own decisions travel on `rec`; everything else is KV's */
    for (const k of STEP_KEYS) fresh.alerts[k] = rec.alerts[k];
    if (isTable(rec)) for (const k of TABLE_KEYS) fresh.alerts[k] = rec.alerts[k];
    stamp(fresh, step, msg, results, nowIso, attempts);
    fresh.alerts.claim = null;
  }
  await putRecord(env, fresh);
  return {
    id: rec.id, step, priority: msg.priority, ...(msg.expire ? { expire: msg.expire } : {}),
    ...(msg.downgraded ? { downgraded: true } : {}),
    results: results.map((r) => ({ channel: r.channel, status: r.status, ok: r.ok })),
  };
}

/** The intake alert, sent right after the record is stored (the submission route, via waitUntil). */
export async function sendIntakeAlert(env, id, claim, nowIso) {
  const rec = await getRecord(env, id);
  if (!rec || !rec.alerts || rec.alerts.stage !== 'intake' || rec.alerts.claim !== claim || rec.alerts.ack_at) return null;
  const nowMs = Date.parse(nowIso);
  rec.alerts.stage = 'ladder';
  rec.alerts.next_at = isTable(rec) ? nextTableAt(rec, nowMs) : nextStepAfter(rec, nowMs);
  return deliver(env, rec, 'intake', buildIntake(rec), nowIso, CHANNELS, 1);
}

/* ------------------------------------------------------------ the claim */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function settleMs(env) {
  const v = parseInt(env.ALERT_CLAIM_SETTLE_MS || '1500', 10);
  return isFinite(v) && v >= 0 ? v : 1500;
}

/* ============================================================ HIS TABLE · the run

   Everything below runs only for a record born with a `table` block. The order inside one run is fixed:
   ask whether anything still stops the clock, then the delivery watch, then at most ONE slot, then
   minute 120. Nothing here ever fires outside 7 AM–9 PM: runAlerts has already returned by then. */

/** The wall time of the next thing owed on this clock — for the admin list and the register. */
function nextTableAt(rec, nowMs) {
  const a = rec.alerts;
  if (a.table.ended_at) return null;
  if (a.stage === 'intake' || a.stage === 'held') return a.next_at;
  const anchor = anchorOf(rec);
  const fired = new Set(a.table.fired || []);
  for (const s of TABLE) if (!fired.has(s)) return new Date(bizAdvance(anchor, s)).toISOString();
  return new Date(bizAdvance(anchor, CLOCK_MIN)).toISOString();
}

/**
 * AMENDMENT 1 C · WHAT STOPS THE CLOCK. Answers null when the ladder may go on, else why it may not.
 * The BOOK is asked fresh every time, because the KV `quoted_at` is only its mirror.
 *
 * 'book_down' is NOT a stop: the book could not be reached this minute, which is not the same as a
 * quote having gone out. The run carries on — a reminder to his own phone is harmless either way — and
 * runHolding asks the book again itself, right before the POST, which is the one moment that matters.
 * A book still down then ends in ONE "call them" push, never in silence.
 */
export async function stopReason(env, rec) {
  if (rec.quoted_at) return 'quoted';
  if (rec.status !== 'received') return 'status:' + rec.status;
  if (rec.alerts.no_text_at) return 'no_text_tap';
  const b = await quoteWentOut(env, rec.id);
  if (b.unreadable) return 'book_down';
  if (b.sent) return 'book_sent';
  return null;
}

/** What this run owes a table record: a watch, at most one slot, or minute 120. */
function tableDue(rec, nowMs) {
  const a = rec.alerts, t = a.table;
  if (t.ended_at) return null;
  if (a.stage === 'intake' || a.stage === 'held') {
    return a.next_at && Date.parse(a.next_at) <= nowMs ? { intake: true } : null;
  }
  const owed = {};
  /* a channel that answered 5xx on an earlier step is tried again here, exactly as on the old ladder */
  if (a.retry && Date.parse(a.retry.at) <= nowMs) owed.retry = a.retry;
  /* AMENDMENT 1 E: while a queued text has no word back, one GET per run until it has one. */
  if (a.holding && a.holding.state === 'accepted' && !a.holding.settled_at) owed.watch = true;
  const m = bizMinutes(anchorOf(rec), nowMs);
  const fired = new Set(t.fired || []);
  const due = TABLE.filter((s) => s <= m && !fired.has(s));
  if (due.length) {
    /* never two slots in one run: the latest due one fires, the earlier ones are marked skipped */
    owed.slot = due[due.length - 1];
    owed.skipped = due.slice(0, -1);
  } else if (m >= CLOCK_MIN) {
    owed.end = true;
  }
  return (owed.retry || owed.watch || owed.slot || owed.end) ? owed : null;
}

/** Ends the ladder for good. Nothing fires for this request afterwards, ever. */
function endLadder(rec, why, nowIso) {
  rec.alerts.table.ended_at = nowIso;
  rec.alerts.table.end_reason = why;
  rec.alerts.stage = 'done';
  rec.alerts.next_at = null;
  rec.alerts.retry = null;
}

/** ONE priority-2 "call them now", and the ladder is over. */
async function callThemNow(env, rec, why, nowIso, nowMs, out) {
  rec.alerts.call_push_at = nowIso;
  endLadder(rec, 'call:' + why, nowIso);
  out.sent.push(await deliver(env, rec, 'call_them', nightSafe(buildCallThem(rec, why), nowMs), nowIso, CHANNELS, 1));
}

/** One push about the holding text itself (never its words, never the number). */
async function holdingPush(env, rec, kind, nowIso, nowMs, out) {
  out.sent.push(await deliver(env, rec, 'holding:' + kind, nightSafe(buildHolding(rec, kind), nowMs), nowIso, CHANNELS, 1));
}

/* ------------------------------------------------------------ minute 120: the holding text */

/**
 * AMENDMENT 1 E. ONE POST, ever, for one request. The order matters: every refusal is decided before
 * the mark is taken, so a request that can never be texted does not burn the mark; and the mark is
 * taken before the call, so two runs can never both POST.
 */
async function runHolding(env, rec, nowIso, nowMs, out) {
  const a = rec.alerts;

  /* §5 · no texts tick: no text and no second clock, one push, the ladder ends */
  if (!(rec.consent && rec.consent.smsService === true)) {
    a.holding = { at: nowIso, state: 'skipped', why: 'no_consent' };
    return callThemNow(env, rec, 'no texts tick', nowIso, nowMs, out);
  }
  /* §6 · no phone, or a number that is not a US one */
  const n = usNumber(rec.fields && rec.fields.phone);
  if (n.error) {
    a.holding = { at: nowIso, state: 'skipped', why: n.error };
    endLadder(rec, 'no_us_number', nowIso);
    return holdingPush(env, rec, 'nonumber', nowIso, nowMs, out);
  }
  /* §3 · no key on the Worker: no call is made at all */
  if (!hasKey(env)) {
    a.holding = { at: nowIso, state: 'skipped', why: 'no_key' };
    endLadder(rec, 'no_key', nowIso);
    return holdingPush(env, rec, 'nokey', nowIso, nowMs, out);
  }
  /* AMENDMENT 1 A · the words, filled. A text still holding a brace never leaves. */
  const words = holdingText(rec, nowMs);
  if (words.error) {
    a.holding = { at: nowIso, state: 'skipped', why: words.error };
    endLadder(rec, 'bad_text:' + words.error, nowIso);
    return holdingPush(env, rec, 'failed', nowIso, nowMs, out);
  }
  /* AMENDMENT 1 D · the floor: under ten minutes of the day left and the text waits for 7:00 AM.
     Nothing is written and nothing is sent — the first run after 7:00 picks it up. */
  const ttl = ttlFor(nowMs);
  if (ttl < MIN_TTL) {
    out.held_for_morning.push({ id: rec.id, seconds_to_close: secondsToClose(nowMs) });
    return null;
  }
  /* AMENDMENT 1 C · the BOOK, read FRESH, immediately before the POST */
  const book = await quoteWentOut(env, rec.id);
  if (book.unreadable) {
    /* The book would not answer at the one moment we must not guess. Nothing goes to the customer, and
       he is TOLD — a request that reaches two hours never just goes quiet. */
    a.holding = { at: nowIso, state: 'skipped', why: 'book_down' };
    endLadder(rec, 'book_down', nowIso);
    return holdingPush(env, rec, 'bookdown', nowIso, nowMs, out);
  }
  if (book.sent) {
    endLadder(rec, 'book_sent', nowIso);
    await putRecord(env, rec);
    out.stopped.push({ id: rec.id, why: 'book_sent' });
    return null;
  }

  /* SEAT FIX (1Supe7, 2026-09-25, review S2): the KV stops, read fresh too. The BOOK was asked above; a No-text,
     Quoted, Scheduled or Done tap that landed in KV while this run was working is the other thing that must stop
     the text, and the record this run holds is a snapshot from before those calls. */
  const live = await getRecord(env, rec.id);
  const liveStop = kvStop(live);
  if (liveStop) {
    Object.assign(rec, live);
    if (!(rec.alerts.table && rec.alerts.table.ended_at)) endLadder(rec, liveStop, nowIso);
    rec.alerts.claim = null;
    await putRecord(env, rec);
    out.stopped.push({ id: rec.id, why: liveStop });
    return null;
  }

  /* AMENDMENT 1 E · the once-only mark: insert-if-absent in the BOOK, never a KV read-then-write */
  const gid = holdGatewayId(rec.id);
  const key = holdKey(rec.id);
  const claim = await markOnce(env, key, rec.id, 'sending', nowIso, gid);
  if (!claim.won) {
    const held = claim.mark || {};
    /* a "sending" this old means a run died inside the call: unknown, and never a second POST */
    if (held.state === 'sending' && nowMs - Date.parse(held.at) > SENDING_STALE_MS) {
      await markSet(env, key, 'unknown', null, nowIso, 'stale_sending');
      a.holding = { at: held.at, gateway_id: gid, state: 'unknown', settled_at: nowIso, why: 'stale_sending' };
      endLadder(rec, 'holding_unknown', nowIso);
      return holdingPush(env, rec, 'silent', nowIso, nowMs, out);
    }
    /* SEAT FIX (1Supe7, 2026-09-25, review B1): the BOOK's word is terminal and KV fell behind it — the run that won
       the mark lost a write after the call, or died before it. The mark is the record's own truth: take it, once,
       and finish that run's step; never another POST. Without this the request went quiet for good. */
    if (TERMINAL_MARK.has(held.state) && behindMark(a, held)) return adoptMark(env, rec, held, gid, nowIso, nowMs, out);
    out.skipped_claims.push(rec.id);
    return null;
  }

  /* SEAT FIX (1Supe7, 2026-09-25, review B1): the record no longer says "sending" in KV before the call — the BOOK's
     mark already does, the admin page reads clock 1 for the second the call takes, and one fewer write to the same
     key inside one second is one fewer 429. A run that dies inside the call is the stale-mark case above. */
  const r = await postHolding(env, { id: gid, e164: n.e164, text: words.text, ttl });
  const settledIso = new Date().toISOString();
  await markSet(env, key, r.state, r.gateway_id || null, settledIso, 'http ' + r.status);
  a.holding = {
    at: nowIso, gateway_id: r.gateway_id || gid, state: r.state, ttl, lang: words.lang, parts: words.parts,
    status: r.status, ...(r.state === 'accepted' ? { gateway_state: r.gateway_state } : { settled_at: nowIso }),
  };
  addEvent(rec, 'holding_text', { state: r.state, gateway: a.holding.gateway_id, status: r.status }, nowIso);

  if (r.state !== 'accepted') {
    /* NEVER a retry, and never a second POST for this request */
    endLadder(rec, 'holding_' + r.state, nowIso);
    await putOwn(env, rec, nowIso);                      /* SEAT FIX (1Supe7): ours onto KV's now, never a snapshot back */
    return holdingPush(env, rec, 'failed', nowIso, nowMs, out);
  }
  /* §4 · THE SECOND CLOCK starts the moment the text is accepted, on the same table */
  a.second_clock_started_at = nowIso;
  a.table = { clock: 2, fired: [], skipped: [], ended_at: null, end_reason: null };
  a.next_at = new Date(bizAdvance(nowMs, TABLE[0])).toISOString();
  /* written before the push: deliver() re-reads the record from KV, so an event left only in memory here would be
     lost and the record would never say how the one call ended. SEAT FIX (1Supe7): folded onto the record as KV
     holds it NOW — a tap that landed during the call keeps its stop, and then no second clock runs. */
  await putOwn(env, rec, nowIso);
  return holdingPush(env, rec, 'queued', nowIso, nowMs, out);
}

/* SEAT FIX (1Supe7, 2026-09-25, review B1/S2) · the helpers the fixes above use */
const TERMINAL_MARK = new Set(['accepted', 'refused', 'unknown']);

/** KV's own stops on a record read fresh (the BOOK's stop is asked separately). */
function kvStop(rec) {
  if (!rec || !rec.alerts) return null;
  if (rec.quoted_at) return 'quoted';
  if (rec.status !== 'received') return 'status:' + rec.status;
  if (rec.alerts.no_text_at) return 'no_text_tap';
  if (rec.alerts.table && rec.alerts.table.ended_at) return rec.alerts.table.end_reason || 'ended';
  return null;
}

/** Is the record behind a terminal mark? (the mark says how the call ended; KV never learned it) */
function behindMark(a, held) {
  const h = a.holding || {};
  if (h.state !== held.state) return true;
  if (held.state === 'accepted') return !a.second_clock_started_at && !(a.table && a.table.ended_at);
  return !(a.table && a.table.ended_at);
}

/** The mark's word becomes the record's, once, and the step that was owed on it is finished: the second clock and
    the QUEUED push for an accepted text, the DID-NOT-GO push and the end of the ladder for a refused or unknown one.
    The mark's own time anchors the second clock, so the promise the customer was texted still holds. */
async function adoptMark(env, rec, held, gid, nowIso, nowMs, out) {
  const a = rec.alerts;
  const gateway = held.gateway_id || gid;
  const status = Number((/^http (\d{3})$/.exec(String(held.note || '')) || [])[1]) || undefined;
  const prior = a.holding || {};
  a.holding = {
    at: held.at || nowIso, gateway_id: gateway, state: held.state,
    ttl: prior.ttl || null, lang: prior.lang || null, parts: prior.parts || null,
    ...(status ? { status } : {}), adopted_at: nowIso,
    ...(held.state === 'accepted' ? {} : { settled_at: nowIso }),
  };
  addEvent(rec, 'holding_text', { state: held.state, gateway, adopted: true }, nowIso);
  out.adopted.push({ id: rec.id, state: held.state });
  if (held.state !== 'accepted') {
    endLadder(rec, 'holding_' + held.state, nowIso);
    await putOwn(env, rec, nowIso);
    return holdingPush(env, rec, 'failed', nowIso, nowMs, out);
  }
  const settled = Date.parse(held.at);                   /* the mark's insert time: the run's own named minute, a second before the call */
  const anchorMs = isFinite(settled) && settled <= nowMs ? settled : nowMs;
  a.second_clock_started_at = new Date(anchorMs).toISOString();
  a.table = { clock: 2, fired: [], skipped: [], ended_at: null, end_reason: null };
  a.next_at = new Date(bizAdvance(anchorMs, TABLE[0])).toISOString();
  await putOwn(env, rec, nowIso);
  return holdingPush(env, rec, 'queued', nowIso, nowMs, out);
}

const eventKey = (e) => JSON.stringify(e);

/** Write THIS RUN'S OWN blocks onto the record as KV holds it now — never a snapshot back over a tap that landed
    meanwhile. A stop that landed (No text, Quoted, Scheduled, Done) is kept and ends the ladder; the holding block
    (what the one call did) is always ours. `rec` is replaced in place so the caller keeps working on the merged record. */
async function putOwn(env, rec, nowIso) {
  const fresh = await getRecord(env, rec.id);
  if (fresh && fresh.alerts) {
    const mine = rec.alerts;
    const stop = kvStop(fresh);
    fresh.alerts.holding = mine.holding;
    fresh.alerts.claim = mine.claim;
    if (stop) {
      if (!(fresh.alerts.table && fresh.alerts.table.ended_at)) endLadder(fresh, stop, nowIso);
    } else {
      for (const k of STEP_KEYS) fresh.alerts[k] = mine[k];
      for (const k of TABLE_KEYS) fresh.alerts[k] = mine[k];
    }
    const have = new Set((fresh.events || []).map(eventKey));
    for (const e of (rec.events || [])) if (!have.has(eventKey(e))) { if (!Array.isArray(fresh.events)) fresh.events = []; fresh.events.push(e); }
    for (const k of Object.keys(rec)) if (!(k in fresh)) delete rec[k];
    Object.assign(rec, fresh);
  }
  await putRecord(env, rec);
}

/* ------------------------------------------------------------ the delivery watch */

/** AMENDMENT 1 E · ONE GET per run until the phone says what became of the text. */
async function runWatch(env, rec, nowIso, nowMs, out) {
  const a = rec.alerts, h = a.holding;
  const g = await getHoldingState(env, h.gateway_id);
  const word = g && g.state ? g.state : null;
  h.checked_at = nowIso;
  h.checks = (h.checks || 0) + 1;
  out.watched.push({ id: rec.id, state: word, status: g && g.status });

  if (word && DONE_STATES.test(word)) {
    h.settled_at = nowIso;
    h.delivery = word;
    return holdingPush(env, rec, 'delivered', nowIso, nowMs, out);
  }
  if ((word && FAILED_STATES.test(word)) || (g && g.gone)) {
    h.settled_at = nowIso;
    h.delivery = word || 'gone';
    endLadder(rec, 'delivery_' + h.delivery, nowIso);
    return holdingPush(env, rec, 'failed', nowIso, nowMs, out);
  }
  /* ttl plus ten minutes with no word at all: he is told to call, and the ladder ends */
  if (nowMs - Date.parse(h.at) > (h.ttl || 0) * 1000 + DELIVERY_GRACE_MS) {
    h.settled_at = nowIso;
    h.delivery = 'no_word';
    endLadder(rec, 'delivery_silent', nowIso);
    return holdingPush(env, rec, 'silent', nowIso, nowMs, out);
  }
  /* still Pending or Processed: keep the watch, write what we learned, send nothing */
  await putOwn(env, rec, nowIso);                          /* SEAT FIX (1Supe7): ours onto KV's now, never a snapshot back */
  return null;
}

/* ------------------------------------------------------------ one table record, one run */

async function runTable(env, rec, owed, nowIso, nowMs, out) {
  /* `rec` is replaced in place after every send, so nothing here holds on to a stale alerts block. */
  const reread = async () => {
    const back = await getRecord(env, rec.id);
    if (back && back.alerts) Object.assign(rec, back);
    return rec.alerts;
  };

  /* the intake alert is the table's own minute 0 and is unchanged from ALERTS-01 */
  if (owed.intake) {
    rec.alerts.stage = 'ladder';
    rec.alerts.next_at = nextTableAt(rec, nowMs);
    out.sent.push(await deliver(env, rec, 'intake', buildIntake(rec), nowIso, CHANNELS, 1));
    return;
  }

  /* a step whose channel answered 5xx is carried here, as it always was, before anything new goes */
  if (owed.retry) {
    rec.alerts.retry = owed.retry;
    /* SEAT FIX (1Supe7, 2026-09-25, review S1): the retried push is cut to the day exactly like a first send — the
       stored message carried the expire of the minute it was first built, which could ring past 9 PM. */
    out.sent.push(await deliver(env, rec, 'retry', nightSafe(owed.retry.msg, nowMs), nowIso, owed.retry.channels, (owed.retry.attempts || 1) + 1));
    if ((await reread()).table.ended_at) return;
  }

  if (owed.watch) {
    await runWatch(env, rec, nowIso, nowMs, out);
    if (rec.alerts.table.ended_at) return;   /* Failed or silent: nothing else this run, or ever */
    await reread();
    if (rec.alerts.table.ended_at) return;
  }

  if (owed.slot) {
    const t = rec.alerts.table;
    if (owed.skipped && owed.skipped.length) {
      t.skipped.push({ at: nowIso, slots: owed.skipped, fired: owed.slot });
      t.fired.push(...owed.skipped);
    }
    t.fired.push(owed.slot);
    rec.alerts.next_at = nextTableAt(rec, nowMs);
    out.sent.push(await deliver(env, rec, 'slot:' + owed.slot, nightSafe(buildSlot(rec, owed.slot), nowMs), nowIso, CHANNELS, 1));
    return;
  }

  if (owed.end) {
    if (rec.alerts.table.clock === 2) {
      /* §4 · two hours twice, no quote */
      return callThemNow(env, rec, 'two hours twice, no quote', nowIso, nowMs, out);
    }
    return runHolding(env, rec, nowIso, nowMs, out);
  }
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
  /* On HIS TABLE an acknowledgement is not a stop, so what makes a request "still waiting" there is the
     ladder still being alive — not ack_at. Everything else about the 7 AM summary is unchanged. */
  const stillWaiting = (r) => (isTable(r) ? !r.alerts.table.ended_at : !r.alerts.ack_at);
  const waiting = all.filter((r) => r.status === 'received' && r.alerts && stillWaiting(r)
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
    if (!fresh || !fresh.alerts || (fresh.alerts.ack_at && !isTable(fresh))) continue;
    stamp(fresh, 'summary', msg, results, nowIso, 1);
    fresh.alerts.summary_at = nowIso;
    if (isTable(fresh)) {
      /* HIS TABLE decides its own stage and its own next step: the summary only says it went out.
         (Without this the summary would mark a request past its two hours "done" and the holding
         text would never leave.) */
      fresh.alerts.stage = 'ladder';
      fresh.alerts.next_at = nextTableAt(fresh, nowMs);
    } else if (dueOf(fresh) <= nowMs) {
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
 * Two ladders run side by side: HIS TABLE for records born with one, and ALERTS-01's own for the
 * records that were already on it when this round landed.
 */
export async function runAlerts(env, nowIso = new Date().toISOString(), opts = {}) {
  const nowMs = Date.parse(nowIso);
  const out = {
    now: nowIso, open: isOpen(nowMs), summary: null, sent: [], skipped_claims: [],
    stopped: [], held_for_morning: [], watched: [], book_down: [], adopted: [], failed: [],
  };
  if (!out.open) return out;                 /* 9 PM – 7 AM: nothing leaves — no push, no text */

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
    if (rec.status !== 'received' || !rec.alerts) continue;
    if (isTable(rec)) {
      /* SEAT FIX (1Supe7, 2026-09-25, review S2): the claim goes onto the record AS KV HOLDS IT NOW, not onto the
         listing's snapshot — a tap that landed since the listing (No text, Quoted, Scheduled, Done) would otherwise be
         written over by the claim itself, and the text would still go. */
      const now = await getRecord(env, rec.id);
      if (now && now.alerts) { for (const k of Object.keys(rec)) if (!(k in now)) delete rec[k]; Object.assign(rec, now); }
      if (rec.status !== 'received' || !rec.alerts) continue;
      const owed = tableDue(rec, nowMs);
      if (!owed) continue;
      rec.alerts.claim = token;              /* the table's own due-ness comes from `fired`, not next_at */
      await putRecord(env, rec);
      plans.set(rec.id, { table: owed });
      continue;
    }
    if (rec.alerts.ack_at) continue;         /* the ALERTS-01 ladder: an ack is still a full stop */
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
    if (!rec || !rec.alerts || rec.alerts.claim !== token) { out.skipped_claims.push(id); continue; }

    /* 3 · HIS TABLE: ask what stops it, fresh, then do at most one thing */
    if (plan.table) {
      const why = await stopReason(env, rec);
      if (why === 'book_down') {
        /* Not a stop, and not a silence either. The book would not answer this minute, which is not the
           same as a quote having gone out. A reminder push to his own phone is harmless if it turns out
           one had; the TEXT is the one that cannot be taken back, and runHolding asks the book again
           itself, right before the POST, and tells him if it still will not answer. */
        out.book_down.push(id);
      } else if (why) {
        endLadder(rec, why, nowIso);
        rec.alerts.claim = null;
        await putRecord(env, rec);
        out.stopped.push({ id, why });
        continue;
      }
      /* SEAT FIX (1Supe7, 2026-09-25, review B1): a write that fails on ONE record (KV's 429, a transient error) is
         logged and that record is left for the next run; the others still get their step this run. */
      try {
        await runTable(env, rec, plan.table, nowIso, nowMs, out);
        const back = await getRecord(env, id);
        if (back && back.alerts && back.alerts.claim === token) { back.alerts.claim = null; await putRecord(env, back); }
      } catch (err) {
        console.error('table run failed for', id, String((err && err.message) || err).slice(0, 200));
        out.failed.push({ id, error: String((err && err.message) || err).slice(0, 120) });
      }
      continue;
    }
    if (rec.alerts.ack_at) { out.skipped_claims.push(id); continue; }

    /* 3b · the ALERTS-01 ladder, unchanged */
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
 *
 * REMINDERS-01 §2: on HIS TABLE this cancels THAT push's repeats and marks the ack — and the next slot
 * still fires. Only the quote going out stops the clock (the Quoted tap does that separately, by
 * stamping `quoted_at`). On the ALERTS-01 ladder an ack is still a full stop, as it always was.
 */
export async function acknowledge(env, id, by, nowIso = new Date().toISOString(), rec = null, key = null) {
  rec = rec || await getRecord(env, id);
  if (!rec) return false;
  if (!rec.alerts) rec.alerts = { first_at: null, count: 0, next_at: null, ack_at: null, receipt: null, receipts: [], channels: [], stage: 'acked', retry: null, claim: null, log: [] };
  const table = isTable(rec);
  if (rec.alerts.ack_at && !table) return false;
  /* On HIS TABLE every push may be acknowledged in its turn, but ONE push is acknowledged once: a
     repeated callback carrying a receipt already answered for cancels nothing a second time. */
  if (table) {
    /* a receipt names one push; a tap names the moment he made it */
    const k = key || (by + ':' + nowIso);
    const seen = rec.alerts.ack_keys || [];
    if (seen.includes(k)) return false;
    rec.alerts.ack_keys = [...seen, k].slice(-40);
  }
  rec.alerts.ack_at = nowIso;
  rec.alerts.ack_by = by;
  if (table) {
    rec.alerts.acks = (rec.alerts.acks || 0) + 1;
  } else {
    rec.alerts.stage = 'acked';
    rec.alerts.next_at = null;
    rec.alerts.retry = null;
    rec.alerts.claim = null;
  }
  addEvent(rec, 'alerts_acknowledged', { by, ...(table ? { clock_runs_on: true } : {}) }, nowIso);
  await putRecord(env, rec);
  const c = await cancelPushoverTag(env, tagOf(rec.id));
  if (!c.ok && !c.skipped) console.error('cancel_by_tag failed for', rec.id, c);
  return true;
}

/** AMENDMENT 1 C · the admin page's one new button: "No text — handled by phone". Stops everything. */
export async function noTextByHand(env, id, nowIso = new Date().toISOString()) {
  const rec = await getRecord(env, id);
  if (!rec) return null;
  if (!rec.alerts) return { id, ok: true, table: false, no_text_at: null };
  if (!rec.alerts.no_text_at) {
    rec.alerts.no_text_at = nowIso;
    if (isTable(rec)) endLadder(rec, 'no_text_tap', nowIso);
    else { rec.alerts.stage = 'acked'; rec.alerts.next_at = null; rec.alerts.retry = null; }
    addEvent(rec, 'no_text_by_hand', {}, nowIso);
    await putRecord(env, rec);
    const c = await cancelPushoverTag(env, tagOf(rec.id));
    if (!c.ok && !c.skipped) console.error('cancel_by_tag failed for', rec.id, c.status);
  }
  return { id, ok: true, table: isTable(rec), no_text_at: rec.alerts.no_text_at };
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
    /* the receipt is the key: one push, one acknowledgement, one cancel_by_tag */
    if (await acknowledge(env, id, 'pushover', nowIso, rec, 'pushover:' + receipt)) done.push(id);
  }
  return done;
}

export { chicagoParts };
