/* THE BOOK — ACCEPT-PAGE-01, 2026-09-23. The quotes, their holds, and one booking per time.

   One Durable Object, reached as ONE named instance ("book"), so every create / sent / accept / none /
   cancel runs one at a time. It is the single source of truth for quotes and bookings; the KV job record
   is only its mirror (quotes.js stamps it, the 5-minute run heals it).

   WHY A DURABLE OBJECT: two quotes may offer the same window ("first YES wins"), and KV cannot say no to
   the second YES — it has no lock (ALERTS-01 FOUND 4). Here every method below is synchronous SQL from its
   first read to its last write, with no await in between, so nothing else can run inside it: the check
   "is this time free?" and the insert of the booking are one step.

   THE CODE IS NEVER HERE. A quote row is keyed by sha256(code); the Worker hashes what the customer's
   link carries and asks by the hash. The raw 22-character code exists only in the create response.

   Every change to a quote row (create, sent, accept, none, cancel) moves its state_version on by one;
   the mirror is current when mirrored_version has caught up. A visit (views, last_view_at) is not a
   change of state and moves nothing — views reach KV with the next real change. */

import { DurableObject } from 'cloudflare:workers';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS quotes (
     token_hash TEXT PRIMARY KEY,
     job_id TEXT NOT NULL,
     version INTEGER NOT NULL,
     status TEXT NOT NULL,
     created_at TEXT NOT NULL,
     sent_at TEXT,
     hold_until TEXT NOT NULL,
     cutoff TEXT NOT NULL,
     short_notice INTEGER NOT NULL DEFAULT 0,
     lang TEXT NOT NULL,
     body_json TEXT NOT NULL,
     windows_json TEXT NOT NULL,
     accepted_at TEXT,
     accepted_by TEXT,
     accepted_window INTEGER,
     none_at TEXT,
     cancelled_at TEXT,
     views INTEGER NOT NULL DEFAULT 0,
     last_view_at TEXT,
     pushed_at TEXT,
     push_kind TEXT,
     state_version INTEGER NOT NULL DEFAULT 1,
     mirrored_version INTEGER NOT NULL DEFAULT 0,
     push_due TEXT,
     push_retry_json TEXT,
     push_claim TEXT,
     push_claim_at TEXT,
     UNIQUE (job_id, version)
   )`,
  `CREATE TABLE IF NOT EXISTS bookings (
     date TEXT NOT NULL,
     start_min INTEGER NOT NULL,
     end_min INTEGER NOT NULL,
     job_id TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     version INTEGER NOT NULL,
     booked_at TEXT NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS bookings_by_date ON bookings (date)',
  'CREATE INDEX IF NOT EXISTS quotes_by_job ON quotes (job_id, version)',
];

/* A claimed push that never reported back (the Worker died mid-send) is released after this long. */
const PUSH_CLAIM_MS = 2 * 60000;

export const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

function parseRow(r) {
  if (!r) return null;
  const o = { ...r };
  o.short_notice = Boolean(o.short_notice);
  o.body = JSON.parse(o.body_json);
  o.windows = JSON.parse(o.windows_json);
  o.push_retry = o.push_retry_json ? JSON.parse(o.push_retry_json) : null;
  delete o.body_json; delete o.windows_json; delete o.push_retry_json;
  return o;
}

export class QuoteBook extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const s of SCHEMA) this.sql.exec(s);
  }

  /* ------------------------------------------------------------ reading */

  _row(tokenHash) {
    return parseRow(this.sql.exec('SELECT * FROM quotes WHERE token_hash = ?', tokenHash).toArray()[0]);
  }

  _rowByJob(jobId, version) {
    return parseRow(this.sql.exec('SELECT * FROM quotes WHERE job_id = ? AND version = ?', jobId, version).toArray()[0]);
  }

  _rows(jobId) {
    return this.sql.exec('SELECT * FROM quotes WHERE job_id = ? ORDER BY version', jobId).toArray().map(parseRow);
  }

  _newest(jobId) {
    return parseRow(this.sql.exec('SELECT * FROM quotes WHERE job_id = ? ORDER BY version DESC LIMIT 1', jobId).toArray()[0]);
  }

  _bookings(jobId) {
    return this.sql.exec('SELECT * FROM bookings WHERE job_id = ?', jobId).toArray();
  }

  /** Any booking, by any job except this quote's own, that overlaps this window. */
  _clash(win, tokenHash) {
    return this.sql.exec(
      'SELECT job_id, version FROM bookings WHERE date = ? AND start_min < ? AND end_min > ? AND token_hash != ?',
      win.date, toMin(win.end), toMin(win.start), tokenHash,
    ).toArray()[0] || null;
  }

  /** Where a quote stands for whoever holds its link, before any time question is asked. */
  _standing(row) {
    if (row.status === 'withdrawn') return 'withdrawn';
    if (row.status === 'accepted') return 'booked';
    const newest = this._newest(row.job_id);
    if (newest && newest.version > row.version) {
      if (newest.status === 'withdrawn') return 'withdrawn';
      return newest.sent_at ? 'replaced' : 'updating';
    }
    return 'open';
  }

  _windowsFree(row) {
    return row.windows.map((w, i) => ({ n: i + 1, ...w, free: row.status === 'accepted' ? row.accepted_window === i + 1 : !this._clash(w, row.token_hash) }));
  }

  _state(row, nowIso) {
    const s = this._standing(row);
    if (s !== 'open') return s;
    if (row.none_at) return 'received';
    const now = Date.parse(nowIso);
    if (now >= Date.parse(row.cutoff)) return 'too_close';
    if (this._windowsFree(row).some((w) => !w.free)) return 'taken';
    if (now >= Date.parse(row.hold_until)) return 'hold_ended';
    return 'open';
  }

  _bump(tokenHash, sets, args) {
    this.sql.exec(`UPDATE quotes SET ${sets}, state_version = state_version + 1 WHERE token_hash = ?`, ...args, tokenHash);
  }

  /* ------------------------------------------------------------ writing */

  /** A new version of a job's quote. Refuses a job already booked, and a version that is not newer. */
  create(q) {
    return this.ctx.storage.transactionSync(() => {
      const rows = this._rows(q.job_id);
      if (rows.some((r) => r.status === 'accepted')) return { error: 'accepted' };
      const top = rows.reduce((m, r) => Math.max(m, r.version), 0);
      if (q.version <= top) return { error: 'version_not_newer', newest: top };
      /* A newer version supersedes every older open quote for this job. */
      for (const r of rows) if (r.status === 'open') this._bump(r.token_hash, "status = 'superseded'", []);
      this.sql.exec(
        `INSERT INTO quotes (token_hash, job_id, version, status, created_at, sent_at, hold_until, cutoff, short_notice, lang, body_json, windows_json, state_version, mirrored_version)
         VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
        q.token_hash, q.job_id, q.version, q.created_at, q.sent_at || null, q.hold_until, q.cutoff, q.short_notice ? 1 : 0,
        q.lang, JSON.stringify(q.body), JSON.stringify(q.windows),
      );
      return { ok: true };
    });
  }

  /** "I sent it." The hold is recomputed by the Worker from sent_at and handed in. */
  sent(jobId, version, sentAt, holdUntil) {
    return this.ctx.storage.transactionSync(() => {
      const row = this._rowByJob(jobId, version);
      if (!row) return { error: 'not_found' };
      if (row.status === 'withdrawn') return { error: 'withdrawn' };
      const newest = this._newest(jobId);
      if (newest.version !== version) return { error: 'not_current', newest: newest.version };
      this._bump(row.token_hash, 'sent_at = ?, hold_until = ?', [sentAt, holdUntil]);
      return { ok: true, row: this._row(row.token_hash) };
    });
  }

  /**
   * THE BOOKING STEP. `who` is { token_hash } (the page, the texted-YES hook by code) or { job_id }
   * (the texted-YES admin route). One call, no await: the checks and the writes cannot be split.
   * Answers { state, row?, clash? } — state is booked or a refusal naming where the quote stands.
   */
  book(who, version, windowN, by, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const row = who.token_hash ? this._row(who.token_hash) : this._rowByJob(who.job_id, version);
      if (!row || row.version !== version) return { state: 'not_found' };
      if (row.status === 'accepted') return { state: 'already_booked', row };
      const standing = this._standing(row);
      if (standing !== 'open') return { state: standing, row };
      let n = windowN == null || windowN === '' ? null : Number(windowN);
      if (n == null && row.windows.length === 1) n = 1;
      if (n == null) return { state: 'choose_window', row };
      if (!(n === 1 || n === 2) || !row.windows[n - 1]) return { state: 'no_such_window', row };
      if (by === 'page' && Date.parse(nowIso) >= Date.parse(row.cutoff)) return { state: 'too_close', row };
      const win = row.windows[n - 1];
      const clash = this._clash(win, row.token_hash);
      if (clash) return { state: 'taken', row, clash };
      this._bump(row.token_hash,
        "status = 'accepted', accepted_at = ?, accepted_by = ?, accepted_window = ?, push_due = ?",
        [nowIso, by, n, by === 'page' ? 'accept' : null]);
      this.sql.exec('INSERT INTO bookings (date, start_min, end_min, job_id, token_hash, version, booked_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        win.date, toMin(win.start), toMin(win.end), row.job_id, row.token_hash, row.version, nowIso);
      return { state: 'booked', row: this._row(row.token_hash) };
    });
  }

  /** "None of these times work." Once per version; the second call writes nothing. */
  none(tokenHash, version, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const row = this._row(tokenHash);
      if (!row || row.version !== version) return { state: 'not_found' };
      const standing = this._standing(row);
      if (standing !== 'open') return { state: standing, row };
      if (row.none_at) return { state: 'received', first: false, row };
      this._bump(tokenHash, "none_at = ?, push_due = 'none'", [nowIso]);
      return { state: 'received', first: true, row: this._row(tokenHash) };
    });
  }

  /** Withdraws one version. A booked one frees its time. */
  cancel(jobId, version, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const row = this._rowByJob(jobId, version);
      if (!row) return { state: 'not_found' };
      if (row.status === 'withdrawn') return { state: 'withdrawn', already: true, row };
      const booking = this._bookings(jobId).find((b) => b.token_hash === row.token_hash) || null;
      if (booking) this.sql.exec('DELETE FROM bookings WHERE token_hash = ?', row.token_hash);
      this._bump(row.token_hash, "status = 'withdrawn', cancelled_at = ?, push_due = NULL, push_retry_json = NULL", [nowIso]);
      return { state: 'withdrawn', freed: booking, row: this._row(row.token_hash) };
    });
  }

  /** A visit: counts it on this row only, and answers everything the page needs. */
  view(tokenHash, nowIso, count = true) {
    const row = this._row(tokenHash);
    if (!row) return { state: 'not_found' };
    if (count) {
      this.sql.exec('UPDATE quotes SET views = views + 1, last_view_at = ? WHERE token_hash = ?', nowIso, tokenHash);
      row.views += 1; row.last_view_at = nowIso;
    }
    return { state: this._state(row, nowIso), row, windows: this._windowsFree(row) };
  }

  /* ------------------------------------------------------------ the mirror */

  /** Every row of one job, with each one's state, for the Worker to rebuild the whole projection from. */
  job(jobId, nowIso) {
    return {
      rows: this._rows(jobId).map((r) => ({ ...r, state: this._state(r, nowIso), windows_free: this._windowsFree(r) })),
      bookings: this._bookings(jobId),
    };
  }

  /** The KV write for this job landed carrying these state versions. */
  mirrored(jobId, versions) {
    for (const [hash, sv] of Object.entries(versions)) {
      this.sql.exec('UPDATE quotes SET mirrored_version = MAX(mirrored_version, ?) WHERE token_hash = ? AND job_id = ?', sv, hash, jobId);
    }
    return { ok: true };
  }

  unmirroredJobs() {
    return this.sql.exec('SELECT DISTINCT job_id FROM quotes WHERE mirrored_version < state_version ORDER BY job_id').toArray().map((r) => r.job_id);
  }

  /* ------------------------------------------------------------ the push */

  pushesDue() {
    return this.sql.exec('SELECT token_hash FROM quotes WHERE push_due IS NOT NULL OR push_retry_json IS NOT NULL').toArray().map((r) => r.token_hash);
  }

  /** Takes the right to send this row's push, so two senders never both send it. */
  claimPush(tokenHash, claim, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const row = this._row(tokenHash);
      if (!row || (!row.push_due && !row.push_retry)) return null;
      if (row.push_claim && Date.parse(nowIso) - Date.parse(row.push_claim_at) < PUSH_CLAIM_MS) return null;
      this.sql.exec('UPDATE quotes SET push_claim = ?, push_claim_at = ? WHERE token_hash = ?', claim, nowIso, tokenHash);
      return row.push_due
        ? { kind: row.push_due, only: null, attempt: 1, row }
        : { kind: row.push_retry.kind, only: row.push_retry.channels, attempt: 2, row };
    });
  }

  /** What the channels answered. Delivered anywhere = pushed; a 5xx channel gets one retry; a 4xx none. */
  finishPush(tokenHash, claim, attempt, kind, results, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const row = this._row(tokenHash);
      if (!row || row.push_claim !== claim) return { ok: false };
      const delivered = results.some((r) => r.ok);
      const again = attempt === 1 ? results.filter((r) => !r.ok && r.retry).map((r) => r.channel) : [];
      this.sql.exec(
        `UPDATE quotes SET push_due = NULL, push_claim = NULL, push_claim_at = NULL, push_retry_json = ?,
           pushed_at = CASE WHEN ? THEN COALESCE(pushed_at, ?) ELSE pushed_at END,
           push_kind = CASE WHEN ? THEN ? ELSE push_kind END
         WHERE token_hash = ?`,
        again.length ? JSON.stringify({ kind, channels: again }) : null,
        delivered ? 1 : 0, nowIso, delivered ? 1 : 0, kind, tokenHash,
      );
      return { ok: true, delivered, retry: again };
    });
  }

  /* ------------------------------------------------------------ tests only (reached through gated hooks) */

  dump() {
    return {
      quotes: this.sql.exec('SELECT * FROM quotes ORDER BY job_id, version').toArray(),
      bookings: this.sql.exec('SELECT * FROM bookings ORDER BY date, start_min').toArray(),
    };
  }
}
