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
   change of state and moves nothing — views reach KV with the next real change.

   TWO-VISIT OPTIONS (road W, 2026-09-25). A quote now offers 1–2 OPTIONS, and an option is 1–2 visits on
   different days ("Mon 9/28 8–10, then Tue 9/29 11–1"). The old quote — 1–2 single windows, the customer picks
   one — is exactly an option list of one-window options, and is stored exactly as before:
     · quotes.windows_json keeps its meaning for every old reader: ONE window per choice, the choice's first
       visit. accepted_window is the number of the accepted CHOICE (= the option), so windows[accepted_window-1]
       is still the first visit of what was booked.
     · quotes.options_json (new, NULL on every old row) holds the whole options only when a quote was created
       with options; NULL reads as "each window is its own one-visit option".
     · A booking is one row per visit: the first visit in `bookings` (as always, one row per quote, its
       token_hash UNIQUE), every later visit in `booking_days` (new). A time is taken if it overlaps either.
     · ONE HOLD (road FW, 2026-09-26): hold_until is the only hold. The page, the create's answer, /sent's answer and
       GET /admin/quote/<id> all carry it, so the customer's page and the Flux name the same minute. (W's hold_told
       column, never deployed, is gone.)
   THE UPGRADE IS ADDITIVE AND IDEMPOTENT on the live book: each column is added only when PRAGMA table_info
   says it is missing, the table and its index are CREATE … IF NOT EXISTS, and no existing row is rewritten.

   CHANGE ORDERS (road CO, 2026-09-26). His words: "we need an ability to add extra materials, and have that create a
   new work order that we can get signed before we buy anything else". A change order is a version of the job's quote
   with kind "change", numbered on its own ("Change 1", "Change 2"), kept in its OWN table (`changes`, new) so no reader
   of `quotes` ever meets one: the original quote, its booking, its hold and its mirror are untouched. A change is only
   ever made on a job whose quote is booked; the customer OKs it on its own page with their name typed as the signature
   (kept here with the time), or says no thanks. Like a quote row it is keyed by sha256(code), moves its state_version on
   every change, and carries its own push (CHANGE OK / CHANGE NO) through the same claim-once machinery. A job with no
   change has no row here, and every answer about it reads exactly as before.

   THE CONFIRMATION TEXT (CONFIRM-01, 2026-10-04). A booking gets ONE text from the website itself (confirm.js). The
   booking's own quote row carries where that stands — `confirm_json` (state sent | queued | failed | no_consent | no_key,
   with the time, the gateway's message id and the words' sha256), `confirm_due` (set by book() the moment a booking lands,
   kept while the text waits for 7:00 AM, NULL once it is settled), and a claim (`confirm_claim`, `confirm_claim_at`) so two
   senders never both send it. Four columns added the additive way; a row an older Worker wrote reads NULL in all of them
   and is never touched. A booking withdrawn clears its due text, so nothing goes at 7:00 for a time that was freed. */

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
  /* REMINDERS-01: the once-only marks. One row per thing that may happen at most once for a job — today
     only `hold:<U-id>`, the holding text. KV cannot say no to the second writer (ALERTS-01 FOUND 4); an
     insert-if-absent here can, because it runs inside this object's own turn with no await in it. */
  `CREATE TABLE IF NOT EXISTS marks (
     key TEXT PRIMARY KEY,
     job_id TEXT NOT NULL,
     state TEXT NOT NULL,
     gateway_id TEXT,
     at TEXT NOT NULL,
     changed_at TEXT,
     note TEXT
   )`,
  'CREATE INDEX IF NOT EXISTS bookings_by_date ON bookings (date)',
  'CREATE INDEX IF NOT EXISTS quotes_by_job ON quotes (job_id, version)',
  /* road W: every visit of a booking after its first (n = 2 for the second day). One row per visit, so a later
     day blocks its own time exactly as the first day's row in `bookings` does. */
  `CREATE TABLE IF NOT EXISTS booking_days (
     token_hash TEXT NOT NULL,
     n INTEGER NOT NULL,
     date TEXT NOT NULL,
     start_min INTEGER NOT NULL,
     end_min INTEGER NOT NULL,
     job_id TEXT NOT NULL,
     version INTEGER NOT NULL,
     booked_at TEXT NOT NULL,
     PRIMARY KEY (token_hash, n)
   )`,
  'CREATE INDEX IF NOT EXISTS booking_days_by_date ON booking_days (date)',
  /* road CO: the change orders — one row per change, its own number per job (n = 1, 2, …) */
  `CREATE TABLE IF NOT EXISTS changes (
     token_hash TEXT PRIMARY KEY,
     job_id TEXT NOT NULL,
     n INTEGER NOT NULL,
     status TEXT NOT NULL,
     created_at TEXT NOT NULL,
     sent_at TEXT,
     lang TEXT NOT NULL,
     body_json TEXT NOT NULL,
     answered_at TEXT,
     signed_name TEXT,
     views INTEGER NOT NULL DEFAULT 0,
     last_view_at TEXT,
     pushed_at TEXT,
     push_kind TEXT,
     push_due TEXT,
     push_retry_json TEXT,
     push_claim TEXT,
     push_claim_at TEXT,
     state_version INTEGER NOT NULL DEFAULT 1,
     mirrored_version INTEGER NOT NULL DEFAULT 0,
     UNIQUE (job_id, n)
   )`,
  'CREATE INDEX IF NOT EXISTS changes_by_job ON changes (job_id, n)',
];

/* road W: columns added to a table that already exists on the live book. Each is added only if PRAGMA
   table_info says it is missing, so opening the book twice (or an old book once) changes nothing else. */
const ADDED_COLUMNS = [
  ['quotes', 'options_json', 'TEXT'],
  /* road XW: the year their house was built, typed on the quote page (NULL on every row until they give one) */
  ['quotes', 'year_built', 'INTEGER'],
  ['quotes', 'year_at', 'TEXT'],
  /* CONFIRM-01: the booking's confirmation text — where it stands, whether one is still owed, and who holds the right
     to send it this minute */
  ['quotes', 'confirm_json', 'TEXT'],
  ['quotes', 'confirm_due', 'TEXT'],
  ['quotes', 'confirm_claim', 'TEXT'],
  ['quotes', 'confirm_claim_at', 'TEXT'],
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
  /* road W: the options. A row with none stored (every row an older Worker wrote, and every quote sent the old
     way) offers each of its windows as a one-visit option — exactly what it always offered. */
  o.options = o.options_json ? JSON.parse(o.options_json) : o.windows.map((w) => [w]);
  o.push_retry = o.push_retry_json ? JSON.parse(o.push_retry_json) : null;
  /* CONFIRM-01: the confirmation text's state (null on a row that never had a booking, and on every older row) */
  o.confirmation = o.confirm_json ? JSON.parse(o.confirm_json) : null;
  delete o.body_json; delete o.windows_json; delete o.push_retry_json; delete o.options_json; delete o.confirm_json;
  return o;
}

/* road CO: a change row, read */
function parseChange(r) {
  if (!r) return null;
  const o = { ...r, kind: 'change' };
  o.body = JSON.parse(o.body_json);
  o.push_retry = o.push_retry_json ? JSON.parse(o.push_retry_json) : null;
  delete o.body_json; delete o.push_retry_json;
  return o;
}

/** road W: the additive upgrade. Returns the columns it added (none on a book already upgraded). */
export function upgradeBook(sql) {
  const added = [];
  for (const [table, column, type] of ADDED_COLUMNS) {
    const have = sql.exec(`PRAGMA table_info(${table})`).toArray().map((c) => c.name);
    if (!have.includes(column)) {
      sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      added.push(table + '.' + column);
    }
  }
  return added;
}

export class QuoteBook extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const s of SCHEMA) this.sql.exec(s);
    this.upgraded = upgradeBook(this.sql);
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

  /* road CO: the change orders */
  _change(tokenHash) {
    return parseChange(this.sql.exec('SELECT * FROM changes WHERE token_hash = ?', tokenHash).toArray()[0]);
  }

  _changeByJob(jobId, n) {
    return parseChange(this.sql.exec('SELECT * FROM changes WHERE job_id = ? AND n = ?', jobId, n).toArray()[0]);
  }

  _changes(jobId) {
    return this.sql.exec('SELECT * FROM changes WHERE job_id = ? ORDER BY n', jobId).toArray().map(parseChange);
  }

  /** Where a change stands: open (theirs to answer) · accepted · declined · withdrawn. A change on a job whose booked
      quote was withdrawn since reads withdrawn — there is no job left for it to change. */
  _changeState(c) {
    if (c.status !== 'open') return c.status;
    const booked = this.sql.exec("SELECT COUNT(*) AS n FROM quotes WHERE job_id = ? AND status = 'accepted'", c.job_id).toArray()[0];
    return booked && booked.n > 0 ? 'open' : 'withdrawn';
  }

  _bumpChange(tokenHash, sets, args) {
    this.sql.exec(`UPDATE changes SET ${sets}, state_version = state_version + 1 WHERE token_hash = ?`, ...args, tokenHash);
  }

  _bookings(jobId) {
    return this.sql.exec('SELECT * FROM bookings WHERE job_id = ?', jobId).toArray();
  }

  /** road W: the later visits of this job's booking (n = 2, …), in order. */
  _bookingDays(jobId) {
    return this.sql.exec('SELECT * FROM booking_days WHERE job_id = ? ORDER BY token_hash, n', jobId).toArray();
  }

  /** Any booking, by any job except this quote's own, that overlaps this window — a first visit or a later one. */
  _clash(win, tokenHash) {
    const args = [win.date, toMin(win.end), toMin(win.start), tokenHash];
    return this.sql.exec(
      'SELECT job_id, version FROM bookings WHERE date = ? AND start_min < ? AND end_min > ? AND token_hash != ? ' +
      'UNION ALL SELECT job_id, version FROM booking_days WHERE date = ? AND start_min < ? AND end_min > ? AND token_hash != ? LIMIT 1',
      ...args, ...args,
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

  /** road W: every option, each visit with its own free flag; an option is free only if every visit of it is.
      A booked row's accepted option is the free one (it is theirs), every other option is not. */
  _optionsFree(row) {
    return row.options.map((ws, i) => {
      const mine = row.status === 'accepted' ? row.accepted_window === i + 1 : null;
      const windows = ws.map((w) => ({ ...w, free: mine === null ? !this._clash(w, row.token_hash) : mine }));
      return { n: i + 1, windows, free: windows.every((w) => w.free) };
    });
  }

  /** One entry per choice, its first visit, as every old reader knows it; `free` is the whole choice's. */
  _windowsFree(row) {
    const opts = this._optionsFree(row);
    return row.windows.map((w, i) => ({ n: i + 1, ...w, free: opts[i] ? opts[i].free : false }));
  }

  _state(row, nowIso) {
    const s = this._standing(row);
    if (s !== 'open') return s;
    if (row.none_at) return 'received';
    const now = Date.parse(nowIso);
    if (now >= Date.parse(row.cutoff)) return 'too_close';
    if (this._optionsFree(row).some((o) => !o.free)) return 'taken';
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
      /* road W: options_json only for a quote sent with options (the old shape stays NULL, exactly as before) */
      this.sql.exec(
        `INSERT INTO quotes (token_hash, job_id, version, status, created_at, sent_at, hold_until, cutoff, short_notice, lang, body_json, windows_json, state_version, mirrored_version, options_json)
         VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
        q.token_hash, q.job_id, q.version, q.created_at, q.sent_at || null, q.hold_until, q.cutoff, q.short_notice ? 1 : 0,
        q.lang, JSON.stringify(q.body), JSON.stringify(q.windows), q.options ? JSON.stringify(q.options) : null,
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
   * `choiceN` is the option (1 or 2) — on an old-shape quote that is the window, as it always was.
   * road W: EVERY visit of the option is checked first and written together, or none is: one row per visit
   * (the first in `bookings`, each later one in `booking_days`), and `taken` if any visit overlaps a booking
   * another job holds.
   * Answers { state, row?, clash? } — state is booked or a refusal naming where the quote stands.
   */
  book(who, version, choiceN, by, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const row = who.token_hash ? this._row(who.token_hash) : this._rowByJob(who.job_id, version);
      if (!row || row.version !== version) return { state: 'not_found' };
      if (row.status === 'accepted') return { state: 'already_booked', row };
      const standing = this._standing(row);
      if (standing !== 'open') return { state: standing, row };
      let n = choiceN == null || choiceN === '' ? null : Number(choiceN);
      if (n == null && row.options.length === 1) n = 1;
      if (n == null) return { state: 'choose_window', row };
      if (!(n === 1 || n === 2) || !row.options[n - 1]) return { state: 'no_such_window', row };
      if (by === 'page' && Date.parse(nowIso) >= Date.parse(row.cutoff)) return { state: 'too_close', row };
      const visits = row.options[n - 1];
      for (const win of visits) {
        const clash = this._clash(win, row.token_hash);
        if (clash) return { state: 'taken', row, clash };
      }
      /* CONFIRM-01: the booking owes the customer ONE confirmation text, by page or by texted YES alike (confirm_due);
         confirm.js decides and sends it, and clears this when it is settled */
      this._bump(row.token_hash,
        "status = 'accepted', accepted_at = ?, accepted_by = ?, accepted_window = ?, push_due = ?, confirm_due = 'confirm'",
        [nowIso, by, n, by === 'page' ? 'accept' : null]);
      visits.forEach((win, i) => {
        if (i === 0) {
          this.sql.exec('INSERT INTO bookings (date, start_min, end_min, job_id, token_hash, version, booked_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            win.date, toMin(win.start), toMin(win.end), row.job_id, row.token_hash, row.version, nowIso);
        } else {
          this.sql.exec('INSERT INTO booking_days (token_hash, n, date, start_min, end_min, job_id, version, booked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            row.token_hash, i + 1, win.date, toMin(win.start), toMin(win.end), row.job_id, row.version, nowIso);
        }
      });
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
      /* road W: a two-visit booking frees every day it held */
      const days = this._bookingDays(jobId).filter((b) => b.token_hash === row.token_hash);
      if (days.length) this.sql.exec('DELETE FROM booking_days WHERE token_hash = ?', row.token_hash);
      /* CONFIRM-01: a text still waiting for 7:00 AM for this booking is owed no longer — the time was freed */
      this._bump(row.token_hash, "status = 'withdrawn', cancelled_at = ?, push_due = NULL, push_retry_json = NULL, confirm_due = NULL, confirm_claim = NULL, confirm_claim_at = NULL", [nowIso]);
      return { state: 'withdrawn', freed: booking, freed_days: days, row: this._row(row.token_hash) };
    });
  }

  /* ------------------------------------------------------------ REPRICE-01 · the one lowering

     His own words on U-0015 (D-CEO5-15): "it is 50 dollars". A booked quote is settled — QUOTE-API §1 refuses a
     new version on it, and a change order can only ADD — so there was no way down but cancelling the booking,
     which takes the customer's link and their time with it. This is the way down: the ACCEPTED version's price,
     lowered ONCE, and nothing else on the row moved. The booking, its days, its windows, its hold, its cutoff,
     its confirmation and anything still owed a push are left exactly as they stand.

     The price he booked at is kept beside the new one INSIDE the body, as `price_was`: no column is added, so
     nothing that reads a column changes, and the old price is on no customer payload. A version already lowered
     is spent — the identical call again answers `already` and writes nothing. */
  reprice(jobId, version, price, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const row = this._rowByJob(jobId, version);
      if (!row) return { state: 'not_found' };
      if (row.status !== 'accepted') return { state: 'not_accepted', standing: this._standing(row), row };
      const was = row.body.price;
      if (row.body.price_was != null) {
        /* once. The same lowering asked twice is the same answer, and no write at all. */
        if (price === was) return { state: 'already', from: row.body.price_was, to: was, row };
        return { state: 'spent', from: row.body.price_was, to: was, row };
      }
      if (typeof was !== 'number' || !Number.isFinite(was)) return { state: 'no_price', row };
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return { state: 'not_positive', row };
      if (price >= was) return { state: 'not_lower', was, row };
      this._bump(row.token_hash, 'body_json = ?', [JSON.stringify({ ...row.body, price, price_was: was, repriced_at: nowIso })]);
      return { state: 'repriced', from: was, to: price, row: this._row(row.token_hash) };
    });
  }

  /* ------------------------------------------------------------ road CO · the change orders */

  /** A new change order for a job whose quote is booked. Its number must be newer than every change the job has had. */
  createChange(c) {
    return this.ctx.storage.transactionSync(() => {
      const booked = this._rows(c.job_id).find((r) => r.status === 'accepted');
      if (!booked) return { error: 'not_booked' };
      const top = this.sql.exec('SELECT MAX(n) AS n FROM changes WHERE job_id = ?', c.job_id).toArray()[0];
      const newest = (top && top.n) || 0;
      if (c.n <= newest) return { error: 'change_not_newer', newest };
      this.sql.exec(
        `INSERT INTO changes (token_hash, job_id, n, status, created_at, sent_at, lang, body_json, state_version, mirrored_version)
         VALUES (?, ?, ?, 'open', ?, ?, ?, ?, 1, 0)`,
        c.token_hash, c.job_id, c.n, c.created_at, c.sent_at || null, c.lang, JSON.stringify(c.body),
      );
      return { ok: true, row: this._change(c.token_hash) };
    });
  }

  /** "It went": the change's text left his phone. */
  changeSent(jobId, n, sentAt) {
    return this.ctx.storage.transactionSync(() => {
      const c = this._changeByJob(jobId, n);
      if (!c) return { error: 'not_found' };
      if (c.status === 'withdrawn') return { error: 'withdrawn' };
      if (!c.sent_at) this._bumpChange(c.token_hash, 'sent_at = ?', [sentAt]);
      return { ok: true, row: this._change(c.token_hash) };
    });
  }

  /** THEIR ANSWER, on their own page: "yes" with their name typed as the signature, or "no". Once only: a second
      answer (either way) writes nothing and answers the first. No await inside, so two taps cannot both win. */
  answerChange(tokenHash, n, answer, name, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const c = this._change(tokenHash);
      if (!c || c.n !== n) return { state: 'not_found' };
      if (c.status === 'accepted' || c.status === 'declined') return { state: 'already', row: c };
      const st = this._changeState(c);
      if (st !== 'open') return { state: st, row: c };
      if (answer === 'yes') {
        this._bumpChange(tokenHash, "status = 'accepted', answered_at = ?, signed_name = ?, push_due = 'change_ok'", [nowIso, name]);
        return { state: 'accepted', first: true, row: this._change(tokenHash) };
      }
      this._bumpChange(tokenHash, "status = 'declined', answered_at = ?, push_due = 'change_no'", [nowIso]);
      return { state: 'declined', first: true, row: this._change(tokenHash) };
    });
  }

  /** Withdraws one change order he made (not one they answered). */
  cancelChange(jobId, n, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const c = this._changeByJob(jobId, n);
      if (!c) return { state: 'not_found' };
      if (c.status === 'withdrawn') return { state: 'withdrawn', already: true, row: c };
      if (c.status !== 'open') return { state: c.status, row: c };
      this._bumpChange(c.token_hash, "status = 'withdrawn', answered_at = ?, push_due = NULL, push_retry_json = NULL", [nowIso]);
      return { state: 'withdrawn', row: this._change(c.token_hash) };
    });
  }

  /** A visit to a change order's page: counts it on its own row, never on the quote's. */
  _viewChange(c, nowIso, count) {
    if (count) {
      this.sql.exec('UPDATE changes SET views = views + 1, last_view_at = ? WHERE token_hash = ?', nowIso, c.token_hash);
      c.views += 1; c.last_view_at = nowIso;
    }
    return { kind: 'change', state: this._changeState(c), row: c };
  }

  /** road CO: a change's push, claimed once (the same rule as a quote's) */
  changePushesDue() {
    return this.sql.exec('SELECT token_hash FROM changes WHERE push_due IS NOT NULL OR push_retry_json IS NOT NULL').toArray().map((r) => r.token_hash);
  }

  claimChangePush(tokenHash, claim, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const row = this._change(tokenHash);
      if (!row || (!row.push_due && !row.push_retry)) return null;
      if (row.push_claim && Date.parse(nowIso) - Date.parse(row.push_claim_at) < PUSH_CLAIM_MS) return null;
      this.sql.exec('UPDATE changes SET push_claim = ?, push_claim_at = ? WHERE token_hash = ?', claim, nowIso, tokenHash);
      return row.push_due
        ? { kind: row.push_due, only: null, attempt: 1, row }
        : { kind: row.push_retry.kind, only: row.push_retry.channels, attempt: 2, row };
    });
  }

  finishChangePush(tokenHash, claim, attempt, kind, results, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const row = this._change(tokenHash);
      if (!row || row.push_claim !== claim) return { ok: false };
      const delivered = results.some((r) => r.ok);
      const again = attempt === 1 ? results.filter((r) => !r.ok && r.retry).map((r) => r.channel) : [];
      this.sql.exec(
        `UPDATE changes SET push_due = NULL, push_claim = NULL, push_claim_at = NULL, push_retry_json = ?,
           pushed_at = CASE WHEN ? THEN COALESCE(pushed_at, ?) ELSE pushed_at END,
           push_kind = CASE WHEN ? THEN ? ELSE push_kind END
         WHERE token_hash = ?`,
        again.length ? JSON.stringify({ kind, channels: again }) : null,
        delivered ? 1 : 0, nowIso, delivered ? 1 : 0, kind, tokenHash,
      );
      return { ok: true, delivered, retry: again };
    });
  }

  /** A visit: counts it on this row only, and answers everything the page needs.
      road CO: a code that is no quote's may be a change order's — one call either way. */
  view(tokenHash, nowIso, count = true) {
    const row = this._row(tokenHash);
    if (!row) { const c = this._change(tokenHash); return c ? this._viewChange(c, nowIso, count) : { state: 'not_found' }; }
    if (count) {
      this.sql.exec('UPDATE quotes SET views = views + 1, last_view_at = ? WHERE token_hash = ?', nowIso, tokenHash);
      row.views += 1; row.last_view_at = nowIso;
    }
    return { state: this._state(row, nowIso), row, windows: this._windowsFree(row), options: this._optionsFree(row) };
  }

  /** road XW · the year their house was built, typed on this version's page. Kept on the row (the mirror carries it
      to KV); the same year again writes nothing. A withdrawn version keeps nothing. */
  noteYear(tokenHash, version, year, nowIso) {
    return this.ctx.storage.transactionSync(() => {
      const row = this._row(tokenHash);
      if (!row || row.version !== version || row.status === 'withdrawn') return { state: 'not_found' };
      if (row.year_built === year) return { state: 'same', row };
      this._bump(tokenHash, 'year_built = ?, year_at = ?', [year, nowIso]);
      return { state: 'kept', row: this._row(tokenHash) };
    });
  }

  /* ------------------------------------------------------------ the mirror */

  /** Every row of one job, with each one's state, for the Worker to rebuild the whole projection from.
      road W: `booking_days` beside `bookings` — the later visits of the job's booking. */
  job(jobId, nowIso) {
    return {
      rows: this._rows(jobId).map((r) => ({ ...r, state: this._state(r, nowIso), windows_free: this._windowsFree(r), options_free: this._optionsFree(r) })),
      bookings: this._bookings(jobId),
      booking_days: this._bookingDays(jobId),
      /* road CO: the job's change orders, oldest first (none: an empty list, and nothing else reads differently) */
      changes: this._changes(jobId).map((c) => ({ ...c, state: this._changeState(c) })),
    };
  }

  /** The KV write for this job landed carrying these state versions. */
  mirrored(jobId, versions) {
    for (const [hash, sv] of Object.entries(versions)) {
      this.sql.exec('UPDATE quotes SET mirrored_version = MAX(mirrored_version, ?) WHERE token_hash = ? AND job_id = ?', sv, hash, jobId);
      /* road CO: a change row's hash matches no quote row, and the other way round */
      this.sql.exec('UPDATE changes SET mirrored_version = MAX(mirrored_version, ?) WHERE token_hash = ? AND job_id = ?', sv, hash, jobId);
    }
    return { ok: true };
  }

  unmirroredJobs() {
    /* road CO: a change answered while the KV write failed is healed by the same run */
    return this.sql.exec('SELECT job_id FROM quotes WHERE mirrored_version < state_version UNION SELECT job_id FROM changes WHERE mirrored_version < state_version ORDER BY job_id').toArray().map((r) => r.job_id);
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

  /* ------------------------------------------------------------ CONFIRM-01 · the booking's confirmation text */

  /** Every booked row still owed its confirmation text (queued overnight, or a first try that never finished). */
  confirmationsDue() {
    return this.sql.exec("SELECT token_hash FROM quotes WHERE confirm_due IS NOT NULL AND status = 'accepted'").toArray().map((r) => r.token_hash);
  }

  /**
   * Takes the right to send this row's confirmation text, so two senders never both send it. null when nothing is owed,
   * when the booking is gone, or when another sender holds the claim. A claim older than `staleMs` never came back:
   * the call's end is unknown, so the row is written `failed` (never a second POST) and null is answered.
   */
  claimConfirm(tokenHash, claim, nowIso, staleMs) {
    return this.ctx.storage.transactionSync(() => {
      const row = this._row(tokenHash);
      if (!row || !row.confirm_due || row.status !== 'accepted') return null;
      if (row.confirm_claim) {
        if (Date.parse(nowIso) - Date.parse(row.confirm_claim_at) < staleMs) return null;
        const prior = row.confirmation || {};
        const failed = { ...prior, state: 'failed', at: nowIso, why: 'stale_sending', claimed_at: row.confirm_claim_at };
        this._bump(tokenHash, 'confirm_json = ?, confirm_due = NULL, confirm_claim = NULL, confirm_claim_at = NULL', [JSON.stringify(failed)]);
        return null;
      }
      this.sql.exec('UPDATE quotes SET confirm_claim = ?, confirm_claim_at = ? WHERE token_hash = ?', claim, nowIso, tokenHash);
      return { row };
    });
  }

  /**
   * How the step ended, written by the one holder of the claim: the confirmation as the Flux will read it, and whether a
   * text is still owed (`stillDue`: queued for 7:00 AM). Every terminal state clears the due mark for good. `force` is
   * for the one caller that could not finish normally (an error before or inside the step) and writes without a claim.
   */
  finishConfirm(tokenHash, claim, confirmation, stillDue, force = false) {
    return this.ctx.storage.transactionSync(() => {
      const row = this._row(tokenHash);
      if (!row) return { ok: false };
      if (!force && row.confirm_claim !== claim) return { ok: false };
      if (force && row.confirmation && !row.confirm_due) return { ok: false };     /* settled already: never overwrite a sent */
      this._bump(tokenHash, 'confirm_json = ?, confirm_due = ?, confirm_claim = NULL, confirm_claim_at = NULL',
        [JSON.stringify(confirmation), stillDue ? 'confirm' : null]);
      return { ok: true, row: this._row(tokenHash) };
    });
  }

  /* ------------------------------------------------------------ REMINDERS-01 · what stops the clock */

  /**
   * Has a quote for this job actually gone out? AMENDMENT 1 C: the BOOK is asked fresh just before any
   * holding text, because the KV mirror can lag or be edited and the customer cannot be un-texted.
   * A withdrawn version that was sent still counts: the customer has it.
   */
  quoteWentOut(jobId) {
    const rows = this.sql.exec('SELECT version, status, sent_at FROM quotes WHERE job_id = ? AND sent_at IS NOT NULL ORDER BY version', jobId).toArray();
    /* road FW: `ready` — the Flux has made the quote link (an open version) and it has not gone yet. The repeats say so. */
    const made = this.sql.exec("SELECT COUNT(*) AS n FROM quotes WHERE job_id = ? AND sent_at IS NULL AND status = 'open'", jobId).toArray()[0];
    const ready = rows.length === 0 && Boolean(made && made.n > 0);
    /* road MW: the price of the newest open version not sent yet — the QUOTE READY push says it ("$225 · text ready") */
    let price = null;
    if (ready) {
      const top = this.sql.exec("SELECT body_json FROM quotes WHERE job_id = ? AND sent_at IS NULL AND status = 'open' ORDER BY version DESC LIMIT 1", jobId).toArray()[0];
      try { const p = top ? JSON.parse(top.body_json).price : null; price = typeof p === 'number' && isFinite(p) ? p : null; } catch (err) { price = null; }
    }
    return { sent: rows.length > 0, ready, ...(ready ? { price } : {}), versions: rows.map((r) => ({ version: r.version, status: r.status, sent_at: r.sent_at })) };
  }

  /* ------------------------------------------------------------ REMINDERS-01 · the once-only mark */

  /** Insert if absent. `won` is true for the ONE caller that put the row there; every other gets the row. */
  markOnce(key, jobId, state, nowIso, note) {
    return this.ctx.storage.transactionSync(() => {
      const had = this.sql.exec('SELECT * FROM marks WHERE key = ?', key).toArray()[0];
      if (had) return { won: false, mark: had };
      this.sql.exec('INSERT INTO marks (key, job_id, state, gateway_id, at, changed_at, note) VALUES (?, ?, ?, NULL, ?, ?, ?)',
        key, jobId, state, nowIso, nowIso, note || null);
      return { won: true, mark: this.sql.exec('SELECT * FROM marks WHERE key = ?', key).toArray()[0] };
    });
  }

  /** How the one call ended. Only the writer that won the mark ever calls this. */
  markSet(key, state, gatewayId, nowIso, note) {
    return this.ctx.storage.transactionSync(() => {
      const had = this.sql.exec('SELECT * FROM marks WHERE key = ?', key).toArray()[0];
      if (!had) return { ok: false };
      this.sql.exec('UPDATE marks SET state = ?, gateway_id = COALESCE(?, gateway_id), changed_at = ?, note = ? WHERE key = ?',
        state, gatewayId || null, nowIso, note || null, key);
      return { ok: true, mark: this.sql.exec('SELECT * FROM marks WHERE key = ?', key).toArray()[0] };
    });
  }

  markGet(key) {
    return this.sql.exec('SELECT * FROM marks WHERE key = ?', key).toArray()[0] || null;
  }

  /* ------------------------------------------------------------ tests only (reached through gated hooks) */

  dump() {
    return {
      quotes: this.sql.exec('SELECT * FROM quotes ORDER BY job_id, version').toArray(),
      bookings: this.sql.exec('SELECT * FROM bookings ORDER BY date, start_min').toArray(),
      marks: this.sql.exec('SELECT * FROM marks ORDER BY key').toArray(),
      booking_days: this.sql.exec('SELECT * FROM booking_days ORDER BY date, start_min').toArray(),
      changes: this.sql.exec('SELECT * FROM changes ORDER BY job_id, n').toArray(),
    };
  }
}
