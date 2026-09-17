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

export async function putRecord(env, rec) {
  await env.RECORDS.put(jobKey(rec.id), JSON.stringify(rec));
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
