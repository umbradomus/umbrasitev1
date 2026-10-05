/* KV is the record store. One key per job, plus one counter.
   Markdown stays the source of truth (standing doctrine) — /api/export/:id.md
   renders the record into the vault's job shape, and the KV copy is derived. */

import { jobId, minutesBetween } from './util.js';

export const COUNTER_KEY = 'counter';
export const JOB_PREFIX = 'job:';

export function jobKey(id) {
  return JOB_PREFIX + id;
}

/**
 * Allocate the next id.
 *
 * KV has no atomic increment, so this reads the counter, takes the next free
 * number and writes it back. At one request an hour that is safe; two submits
 * inside the same second could in principle collide, so it also refuses any
 * number whose record already exists and walks forward. Noted in README.
 */
export async function allocateId(env) {
  const seed = parseInt(env.SEED_LAST_ID ?? '2', 10);
  const raw = await env.RECORDS.get(COUNTER_KEY);
  let last = raw == null ? (isFinite(seed) ? seed : 2) : parseInt(raw, 10);
  if (!isFinite(last)) last = isFinite(seed) ? seed : 2;

  let n = last + 1;
  for (let guard = 0; guard < 50; guard++) {
    const id = jobId(n);
    const taken = await env.RECORDS.get(jobKey(id));
    if (!taken) {
      await env.RECORDS.put(COUNTER_KEY, String(n));
      return id;
    }
    n++;
  }
  throw new Error('could not allocate a free job id');
}

export async function getRecord(env, id) {
  if (!/^U-\d{4,6}$/.test(String(id || ''))) return null;
  const raw = await env.RECORDS.get(jobKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/* SEAT FIX (1Supe7, 2026-09-25, review B1): Workers KV allows ONE write to a key per second and throws a 429 on the
   next one inside that second. A step that writes the same job twice in quick succession (the claim and then the
   send's stamp; the gateway's answer and then the push's stamp) would otherwise lose its second write and leave
   the record behind the BOOK. One wait of 1.1 s and one more try; a second refusal, or any other error, stands. */
async function writeKey(env, key, body) {
  try {
    await env.RECORDS.put(key, body);
  } catch (err) {
    if (!/\b429\b|too many requests/i.test(String((err && err.message) || err))) throw err;
    await sleepMs(1100);
    await env.RECORDS.put(key, body);
  }
}

export async function putRecord(env, rec) {
  await writeKey(env, jobKey(rec.id), JSON.stringify(rec));
  await touchLadderIndex(env, rec);
}

/* --------------------------------------------------- the ladder index · KV-FIX-01, 2026-10-05
   Workers FREE allows 1,000 KV LIST operations a UTC day. The cron fires every minute and inside business
   hours — 7 AM to 9 PM Chicago, 840 minutes of every UTC day — the alert run LISTed the whole store on
   every one of them: 840 a day, plus Job Sync's 96 = 936 of 1,000, before Drew opened his board. (KV-01's
   count; Cloudflare's own number agreed to the LIST.) At 1,000 every LIST throws until 00:00Z and his
   reminders and the customer's holding text stop.
   So the ids the alert run can ACT on are kept in ONE key, and a normal minute reads that key and GETs
   those records instead of listing. Membership is exactly what runAlerts' claim loop and the 7 AM summary
   refuse to skip: status 'received' with an alerts block. The key is outside JOB_PREFIX, so listRecords()
   never sees it and /api/jobs, /api/export and the board are untouched.
   IT IS A CACHE, NEVER THE TRUTH. A missing or unreadable index, and every quarter hour, makes the run
   LIST in full and rewrite it — so a record written straight to KV by some other hand is late by at most
   fifteen minutes, never lost. And the write cap is 1,000 a day too, so the index is written ONLY when
   what it holds would change: a claim stamp, a send stamp or a tap costs no write at all. */
export const LADDER_INDEX_KEY = 'idx:ladder';

/** The records the alert run can act on — the same test its claim loop uses. */
export const inLadder = (rec) => Boolean(rec && rec.status === 'received' && rec.alerts);

/** The index as stored: an array of ids, or null when it is missing or unreadable (either means: LIST). */
export async function readLadderIndex(env) {
  let raw;
  try { raw = await env.RECORDS.get(LADDER_INDEX_KEY); } catch (err) { return null; }
  if (!raw) return null;
  try {
    const ids = JSON.parse(raw).ids;
    if (!Array.isArray(ids)) return null;
    return ids.map(String).filter((id) => /^U-\d{4,6}$/.test(id));
  } catch (err) { return null; }
}

/** The records the index names, fresh from KV. A id with no record behind it is skipped, never deleted. */
export async function getLadder(env, ids) {
  const out = [];
  for (const id of ids) {
    const rec = await getRecord(env, id);
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * Write the index — but only if what it holds would change. `have` is the reading to compare against
 * (pass it when you already have one, so this costs no second GET). Returns true if it wrote.
 */
export async function writeLadderIndex(env, ids, have = undefined, at = new Date().toISOString()) {
  const next = [...new Set(ids.map(String))].sort();
  const now = have === undefined ? await readLadderIndex(env) : have;
  if (now && now.length === next.length && now.every((id, i) => id === next[i])) return false;
  await writeKey(env, LADDER_INDEX_KEY, JSON.stringify({ ids: next, at }));
  return true;
}

/** Keep the index true for ONE record: read it, and write only if THIS record's membership changed. */
async function touchLadderIndex(env, rec) {
  const id = String((rec && rec.id) || '');
  if (!/^U-\d{4,6}$/.test(id)) return;
  const ids = await readLadderIndex(env);
  if (ids === null) return;        /* missing or unreadable: the next run LISTs and rebuilds it whole */
  const has = ids.includes(id);
  const should = inLadder(rec);
  if (has === should) return;      /* nothing about this record's membership moved: no write */
  await writeLadderIndex(env, should ? ids.concat(id) : ids.filter((x) => x !== id), ids);
}

export async function listRecords(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.RECORDS.list({ prefix: JOB_PREFIX, cursor });
    for (const k of page.keys) {
      const raw = await env.RECORDS.get(k.name);
      if (!raw) continue;
      try { out.push(JSON.parse(raw)); } catch (err) { /* a corrupt row is skipped, never deleted */ }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/** Nothing is deleted; the events list only grows. */
export function addEvent(rec, type, detail = {}, at = new Date().toISOString()) {
  if (!Array.isArray(rec.events)) rec.events = [];
  rec.events.push({ at, type, ...detail });
  return rec;
}

/** Minutes the request has been open: to the quote if quoted, to now if not. */
export function minutesOpen(rec, nowIso = new Date().toISOString()) {
  return minutesBetween(rec.received_at, rec.quoted_at || nowIso);
}

export function isUnquoted(rec) {
  return !rec.quoted_at;
}

/** Oldest unquoted first; everything already quoted below it, newest first. */
export function sortForAdmin(list) {
  const open = list.filter(isUnquoted).sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  const closed = list.filter((r) => !isUnquoted(r)).sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at));
  return open.concat(closed);
}
