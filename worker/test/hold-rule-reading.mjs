/* WORKER-HOLD-01 · THE READING FOR D-CEO11-10, THE HOLD THE CUSTOMER IS PROMISED. 2026-10-07.
   Test-only. Nothing here ships and nothing here is reached by the deployed Worker. No wrangler, no network,
   no port: every check is arithmetic on the Worker's own holdFor and words built from the Worker's own tables.

   WHY. On 2026-10-06 at 8:07 PM a TEST quote told a customer their times were "Held for you until Tue 10/6,
   9:00 PM" — fifty-three minutes. The cutoff was 9:00 PM and hold_until is bounded by it. D-CEO11-10 makes the
   promise a FLOOR: 9:00 PM that day for a quote sent before 3:00 PM Central, 12:00 noon the next day for one
   sent at or after 3:00 PM; never shorter than the old arithmetic gave; never spending the short-notice floor;
   and the cutoff lifted to the hold, never lowered, so the book never refuses a time the page says is held.

   IT RETYPES NOTHING. The candidate's holdFor is IMPORTED from ../src/quotes.js. The arithmetic it must never
   shorten is SLICED, by content and never by line number (G88), out of `git show <baseref>:worker/src/quotes.js`
   and eval'd — so "never shorter than today" is read off the live base itself, not off this seat's memory. The
   customer's two sentences come from ../src/page-words.js's own templates through ../src/page.js's own fill and
   holdLabel, sliced the same way. The three files that must not move are read off disk and off the base.

   Run (from worker/):  node test/hold-rule-reading.mjs
     --baseref <ref>   the tree "today" means (default main)
     --cdir <dir>      the directory clause C scans (default ../src) — the C plant points it at a planted copy  */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chicagoWall, chicagoParts } from '../src/biztime.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const REPO = path.join(HERE, '..', '..');
const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const CDIR = A.cdir ? path.resolve(A.cdir) : SRC;
const BASEREF = A.baseref || 'main';

let fails = 0, passes = 0;
const say = (s) => console.log(s);
const J = (s) => JSON.stringify(s);
const chk = (name, ok, reading) => {
  if (ok) { passes++; say('PASS  ' + name + '   ' + reading); }
  else { fails++; say('FAIL  ' + name + '   ' + reading); }
};
const rig = (why) => { say('RIG FAILED: ' + why); process.exit(3); };

/* ---------------------------------------------------------------- the candidate, imported */
const W = await import(pathToFileURL(path.join(SRC, 'quotes.js')).href);
const WORDS = (await import(pathToFileURL(path.join(SRC, 'page-words.js')).href)).WORDS;

/* ---------------------------------------------------------------- "today", sliced out of the base by content */
function sliceFn(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return null;
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  return null;
}
const baseSrc = execFileSync('git', ['show', BASEREF + ':worker/src/quotes.js'], { cwd: REPO, encoding: 'utf8' });
const pieces = [
  (baseSrc.match(/const HOLD_MS = [^;]+;/) || [])[0],
  (baseSrc.match(/const SHORT_NOTICE_MS = [^;]+;/) || [])[0],
  (baseSrc.match(/const DATE_RE = [^;]+;/) || [])[0],
  sliceFn(baseSrc, 'function realDate('),
  (sliceFn(baseSrc, 'export function holdFor(') || '').replace(/^export\s+/, ''),
];
if (pieces.some((p) => !p)) rig('the base ' + BASEREF + ':worker/src/quotes.js did not yield HOLD_MS, SHORT_NOTICE_MS, DATE_RE, realDate and holdFor by content');
if (/promisedUntil|PROMISE_HOUR/.test(pieces[4])) rig('the base already carries the rule — ' + BASEREF + ' is not the tree this round calls "today"');
const BASE = new Function('chicagoWall', 'windowStartMs', pieces.join('\n') + '\nreturn holdFor;')(chicagoWall, W.windowStartMs);

/* ---------------------------------------------------------------- the customer's own sentence */
const pageSrc = fs.readFileSync(path.join(SRC, 'page.js'), 'utf8');
const pa = pageSrc.indexOf('const esc = '), pb = pageSrc.indexOf('const STYLE = ');
if (pa < 0 || pb < 0 || pb < pa) rig('page.js did not yield the span from `const esc = ` to `const STYLE = `');
const PJ = pageSrc.slice(pa, pb);
if (!/function holdLabel/.test(PJ) || !/const fill/.test(PJ) || !/function heldUntilMs/.test(PJ)) rig('the page.js span does not hold fill, heldUntilMs and holdLabel');
const PW = new Function(PJ + '\nreturn { holdLabel, fill, heldUntilMs };')();
const customerLine = (holdIso, lang, plural) => {
  const w = WORDS[lang];
  return PW.fill(plural ? w.hold_two : w.hold_one, { at: PW.holdLabel(PW.heldUntilMs({ hold_until: holdIso }), lang) });
};

/* ---------------------------------------------------------------- the quote under test: the walk's own two times */
const WINDOWS = [{ n: 1, date: '2026-10-08', start: '08:00', end: '10:00' }, { n: 2, date: '2026-10-09', start: '08:00', end: '10:00' }];
const FIRST = W.windowStartMs(WINDOWS[0]);
const CEIL = FIRST - 12 * 3600000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CT = (y, mo, d, h, mi = 0) => new Date(chicagoWall(y, mo, d, h, mi)).toISOString();
const words = (ms) => {
  const p = chicagoParts(ms);
  const h12 = (p.h % 12) || 12;
  return DOW[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()] + ' ' + p.mo + '/' + p.d + ', ' + h12 + ':' + String(p.mi).padStart(2, '0') + ' ' + (p.h < 12 ? 'AM' : 'PM');
};
const wanted = (w) => w.mo + '/' + w.d + ', ' + ((w.h % 12) || 12) + ':' + String(w.mi).padStart(2, '0') + ' ' + (w.h < 12 ? 'AM' : 'PM');
const same = (ms, w) => {
  const p = chicagoParts(ms);
  return p.y === w.y && p.mo === w.mo && p.d === w.d && p.h === w.h && p.mi === w.mi;
};

say('# WORKER-HOLD-01 · D-CEO11-10 · candidate worker/src/quotes.js · "today" = ' + BASEREF);
say('# the quote offers ' + WINDOWS.map((w) => w.date + ' ' + w.start + '-' + w.end).join(' and ') + '; the first held time starts ' + words(FIRST) + ' Central, so the short-notice floor is ' + words(CEIL) + ' Central.');
say('');

/* ================================================================ A · THE RULE, IN ONE PLACE */
say('--- A · THE RULE, IN ONE PLACE: four clock times, both languages, and at every one of them the bounds ---');
const SENT = [
  { iso: CT(2026, 10, 6, 14, 59), say: '2:59 PM Tue 10/6', want: { y: 2026, mo: 10, d: 6, h: 21, mi: 0 }, why: 'before 3:00 PM — 9:00 PM that day, exactly as today' },
  { iso: CT(2026, 10, 6, 15, 0), say: '3:00 PM Tue 10/6', want: { y: 2026, mo: 10, d: 7, h: 12, mi: 0 }, why: 'at 3:00 PM — 12:00 noon the next day' },
  { iso: CT(2026, 10, 6, 20, 7), say: '8:07 PM Tue 10/6', want: { y: 2026, mo: 10, d: 7, h: 12, mi: 0 }, why: "the walk's own quote: noon the next day, not 53 minutes" },
  { iso: CT(2026, 10, 6, 23, 30), say: '11:30 PM Tue 10/6', want: { y: 2026, mo: 10, d: 7, h: 20, mi: 0 }, why: 'the promise is the FLOOR; today already holds to Wed 8:00 PM and that stands' },
];
for (const s of SENT) {
  const N = 'HOLD01-A-' + s.say.replace(/[: ]/g, '').replace(/\//g, '').toUpperCase();
  const r = W.holdFor(WINDOWS, s.iso, null);
  const b = BASE(WINDOWS, s.iso, null);
  if (r.error) { chk(N + '-PROMISE', false, 'the candidate refused the quote: ' + r.error); continue; }
  const hold = Date.parse(r.hold_until), cut = Date.parse(r.cutoff);
  const bHold = Date.parse(b.hold_until), bCut = Date.parse(b.cutoff);
  const en = customerLine(r.hold_until, 'en', true), es = customerLine(r.hold_until, 'es', true);
  const hr = ((s.want.h % 12) || 12) + ':' + String(s.want.mi).padStart(2, '0');
  say('  -- sent ' + s.say + ' (' + s.iso + ') · ' + s.why);
  say('     today (' + BASEREF + '): hold_until ' + b.hold_until + ' = ' + words(bHold) + ' Central, ' + Math.round((bHold - Date.parse(s.iso)) / 60000) + ' min after the quote; cutoff ' + b.cutoff);
  say('     candidate:      hold_until ' + r.hold_until + ' = ' + words(hold) + ' Central, ' + Math.round((hold - Date.parse(s.iso)) / 60000) + ' min after the quote; cutoff ' + r.cutoff);
  say('     the customer reads  EN: ' + J(en));
  say('     the customer reads  ES: ' + J(es));
  chk(N + '-PROMISE', same(hold, s.want), 'the candidate holds the times until ' + words(hold) + ' Central; D-CEO11-10 wants ' + wanted(s.want));
  chk(N + '-NEVER-SHORTER', hold >= bHold, 'today holds to ' + words(bHold) + ' Central; the candidate holds to ' + words(hold) + ' Central. A fix for a hold that is too short may never make one shorter.');
  chk(N + '-NOT-PAST-THE-FIRST-TIME', hold <= FIRST, 'the hold ends ' + words(hold) + ' Central and the first held time starts ' + words(FIRST) + ' Central');
  chk(N + '-TWELVE-HOURS-NEVER-SPENT', hold <= CEIL, 'the hold ends ' + words(hold) + ' Central and the short-notice floor is ' + words(CEIL) + ' Central');
  chk(N + '-BOOK-NEVER-REFUSES-A-HELD-TIME', cut >= hold, 'the page says held till ' + words(hold) + ' Central; quotebook.js:375 refuses the Accept from the cutoff, ' + words(cut) + ' Central');
  chk(N + '-CUTOFF-NEVER-LOWERED', cut >= bCut, "today's cutoff is " + words(bCut) + " Central; the candidate's is " + words(cut) + ' Central. The rule only ever lifts it.');
  chk(N + '-WORDS-EN', en.includes(String(s.want.d)) && en.includes(hr), 'EN: ' + J(en));
  chk(N + '-WORDS-ES', es.includes(String(s.want.d)) && es.includes(hr), 'ES: ' + J(es));
  say('');
}
/* the boundary is AT 3:00 PM, not after it — the minute either side, by name */
{
  const before = W.holdFor(WINDOWS, CT(2026, 10, 6, 14, 59), null);
  const at = W.holdFor(WINDOWS, CT(2026, 10, 6, 15, 0), null);
  chk('HOLD01-A-THE-3PM-BOUNDARY-IS-INCLUSIVE',
    same(Date.parse(before.hold_until), { y: 2026, mo: 10, d: 6, h: 21, mi: 0 }) && same(Date.parse(at.hold_until), { y: 2026, mo: 10, d: 7, h: 12, mi: 0 }),
    '2:59 PM holds to ' + words(Date.parse(before.hold_until)) + ' and 3:00 PM holds to ' + words(Date.parse(at.hold_until)) + ' Central');
}
/* every minute of five days: the four bounds at every send time, against the base */
{
  let worst = null, n = 0;
  for (const dd of [3, 4, 5, 6, 7]) {
    for (let m = 0; m < 1440; m++) {
      const iso = CT(2026, 10, dd, Math.floor(m / 60), m % 60);
      const r = W.holdFor(WINDOWS, iso, null), b = BASE(WINDOWS, iso, null);
      if (r.error || b.error) {
        if (!!r.error !== !!b.error) worst = worst || { iso, why: 'one road refused and the other did not: candidate ' + J(r.error || null) + ', base ' + J(b.error || null) };
        continue;
      }
      n++;
      const hold = Date.parse(r.hold_until), cut = Date.parse(r.cutoff);
      if (hold < Date.parse(b.hold_until)) worst = worst || { iso, why: 'shorter than today: ' + r.hold_until + ' < ' + b.hold_until };
      else if (hold > CEIL) worst = worst || { iso, why: 'past the short-notice floor: ' + r.hold_until + ' > ' + new Date(CEIL).toISOString() };
      else if (cut < hold) worst = worst || { iso, why: 'the book would refuse a held time: cutoff ' + r.cutoff + ' < hold ' + r.hold_until };
      else if (cut < Date.parse(b.cutoff)) worst = worst || { iso, why: 'the cutoff was lowered: ' + r.cutoff + ' < ' + b.cutoff };
    }
  }
  chk('HOLD01-A-EVERY-MINUTE-OF-FIVE-DAYS', !worst,
    n + ' send minutes across 2026-10-03..07 Central, each checked for all four bounds (never shorter · never past the floor · the book never refuses · the cutoff never lowered)' + (worst ? ' — first break at ' + worst.iso + ': ' + worst.why : ''));
}
say('');

/* ================================================================ B · BOTH CALLS, AND /sent */
say('--- B · BOTH CALLS: create (createQuote) and /sent (markSent, short_notice pinned) ---');
{
  /* the Flux makes the link first and calls /sent after (Flux Capacitor.html:3739) — so BOTH shapes are live */
  const created = CT(2026, 10, 6, 20, 5), sent = CT(2026, 10, 6, 20, 7);
  const atCreate = W.holdFor(WINDOWS, created, null);
  const atSent = W.holdFor(WINDOWS, created, sent, atCreate.short_notice);
  say('  -- the real road: link made ' + created + ' (8:05 PM), text sent ' + sent + ' (8:07 PM)');
  say('     create: hold_until ' + atCreate.hold_until + ' cutoff ' + atCreate.cutoff + ' short_notice ' + atCreate.short_notice);
  say('     /sent:  hold_until ' + atSent.hold_until + ' cutoff ' + atSent.cutoff + ' short_notice ' + atSent.short_notice);
  chk('HOLD01-B-CREATE-TAKES-THE-PROMISE', same(Date.parse(atCreate.hold_until), { y: 2026, mo: 10, d: 7, h: 12, mi: 0 }),
    'a quote whose link is made at 8:05 PM holds to ' + words(Date.parse(atCreate.hold_until)) + ' Central. The customer reads ' + J(customerLine(atCreate.hold_until, 'en', true)) + ' / ' + J(customerLine(atCreate.hold_until, 'es', true)));
  chk('HOLD01-B-SENT-TAKES-THE-PROMISE', same(Date.parse(atSent.hold_until), { y: 2026, mo: 10, d: 7, h: 12, mi: 0 }),
    'the same quote marked sent at 8:07 PM holds to ' + words(Date.parse(atSent.hold_until)) + ' Central');
  chk('HOLD01-B-BOTH-CALLS-DOOR-AS-WIDE-AS-THE-HOLD',
    Date.parse(atCreate.cutoff) >= Date.parse(atCreate.hold_until) && Date.parse(atSent.cutoff) >= Date.parse(atSent.hold_until),
    'create cutoff ' + words(Date.parse(atCreate.cutoff)) + ' >= hold ' + words(Date.parse(atCreate.hold_until)) + '; /sent cutoff ' + words(Date.parse(atSent.cutoff)) + ' >= hold ' + words(Date.parse(atSent.hold_until)) + ' Central');
}
{
  /* short_notice PINNED: /sent keeps the road create chose, and never spends the 12 hours */
  const created = CT(2026, 10, 6, 23, 30), sent = CT(2026, 10, 7, 7, 0);
  const atCreate = W.holdFor(WINDOWS, created, null);
  const pinned = W.holdFor(WINDOWS, created, sent, atCreate.short_notice);
  chk('HOLD01-B-SHORT-NOTICE-PINNED-AT-SENT',
    atCreate.short_notice === true && pinned.short_notice === true && Date.parse(pinned.hold_until) <= CEIL,
    'create said short_notice ' + atCreate.short_notice + ' and /sent, handed that pin as markSent hands it (cur.short_notice), says ' + pinned.short_notice + ' and holds to ' + words(Date.parse(pinned.hold_until)) + ' Central — never past the floor ' + words(CEIL) + ' Central, so the short-notice road spends none of its 12 hours when the promise is applied to it');
}
{
  /* THE TWO-STEP ROAD ACROSS 3:00 PM, against the row the book actually keeps.
     WORKER-HOLD-01.1: `sent()` now carries the CUTOFF as well, raising the row's own and never lowering it, and
     markSent's clamp is gone. The SET list AND the raise arithmetic are both read out of quotebook.js BY CONTENT
     (G88) and the raise is eval'd rather than retyped, so this simulation cannot drift from the real book. */
  const qbSrc = fs.readFileSync(path.join(SRC, 'quotebook.js'), 'utf8');
  const sentFn = sliceFn(qbSrc, '  sent(jobId, version, sentAt, holdUntil, cutoff) {') || '';
  if (!sentFn) rig('quotebook.js has no sent(jobId, version, sentAt, holdUntil, cutoff) — the cutoff does not travel');
  const setsCut = sentFn.split("_bump(row.token_hash, '");
  const sets = setsCut.length > 1 ? setsCut[1].split("'")[0] : '(not found)';
  const raiseLine = (sentFn.match(/const newCutoff = [^;]+;/) || [])[0] || '';
  if (!raiseLine) rig('quotebook.js sent() does not yield `const newCutoff = …;` by content');
  const RAISE = new Function('row', 'cutoff', raiseLine + ' return newCutoff;');

  /* RE-CUT by WORKER-HOLD-01.1 from HOLD01-B-THE-BOOK-WRITES-NO-CUTOFF-AT-SENT, which asserted the very gap this
     round closes: it read 'sent_at = ?, hold_until = ?' and passed BECAUSE the cutoff could not travel. It was
     always meant to flip. Same subject, opposite truth — not a deleted guard. */
  chk('HOLD01-B-THE-BOOK-WRITES-THE-CUTOFF-AT-SENT',
    sets === 'sent_at = ?, hold_until = ?, cutoff = ?' && sentFn.includes('[sentAt, holdUntil, newCutoff]'),
    'quotebook.js sent() sets ' + J(sets) + ' and binds [sentAt, holdUntil, newCutoff] — the cutoff travels with the hold');

  const created = CT(2026, 10, 6, 14, 0), sent = CT(2026, 10, 6, 20, 7);
  const row = W.holdFor(WINDOWS, created, null);                       /* what the INSERT stores */
  const recomputed = W.holdFor(WINDOWS, created, sent, row.short_notice);
  const todayAtSent = BASE(WINDOWS, created, sent, row.short_notice);
  const qSrc = fs.readFileSync(path.join(SRC, 'quotes.js'), 'utf8');
  const markSent = sliceFn(qSrc, 'export async function markSent(') || '';
  /* RE-CUT by WORKER-HOLD-01.1 from HOLD01-B-MARKSENT-BOUNDS-THE-HOLD-BY-THE-ROWS-CUTOFF, which asserted the
     clamp W3 orders removed in this same commit. Leaving it would be a dead brake asserting its own brake. */
  const travels = markSent.includes('b.sent(jobId, version, sentIso, hold.hold_until, hold.cutoff)')
    && !markSent.includes('Math.min(Date.parse(hold.hold_until)');
  chk('HOLD01-B-MARKSENT-HANDS-THE-CUTOFF-TO-THE-BOOK', travels,
    'markSent ' + (travels
      ? 'hands hold.hold_until AND hold.cutoff to sent(), and the clamp against cur.cutoff is gone'
      : 'does not hand hold.cutoff to sent(), or still clamps the hold against cur.cutoff'));
  /* what the row holds AFTER the /sent, modelled on the code just read */
  const stored = travels ? Date.parse(recomputed.hold_until) : Math.min(Date.parse(recomputed.hold_until), Date.parse(row.cutoff));
  const storedCut = travels ? Date.parse(RAISE(row, recomputed.cutoff)) : Date.parse(row.cutoff);
  say('  -- the two-step road across 3:00 PM: link made ' + created + ' (2:00 PM), text sent ' + sent + ' (8:07 PM)');
  say('     the row the INSERT wrote: hold_until ' + row.hold_until + ' cutoff ' + row.cutoff);
  say('     holdFor at /sent:         hold_until ' + recomputed.hold_until + ' cutoff ' + recomputed.cutoff);
  say('     what the row then holds:  hold_until ' + new Date(stored).toISOString() + ' cutoff ' + new Date(storedCut).toISOString()
    + (travels ? '  (the cutoff travelled: sent() raised it)' : "  (markSent bounds the hold by the row's cutoff)"));
  /* W2's reading in this instrument: the cutoff the row ends up with was RAISED, never lowered */
  say('     the cutoff moved ' + words(Date.parse(row.cutoff)) + ' -> ' + words(storedCut) + ' Central (it may only ever go up)');
  chk('HOLD01-B-TWO-STEP-BOOK-NEVER-REFUSES-A-HELD-TIME', stored <= storedCut && storedCut >= Date.parse(row.cutoff),
    'the row says held till ' + words(stored) + ' Central and the cutoff the row ends up with is ' + words(storedCut)
    + ' Central, which the book refuses from; it was ' + words(Date.parse(row.cutoff)) + ' and may only ever go up');
  chk('HOLD01-B-TWO-STEP-NEVER-SHORTER', stored >= Date.parse(row.hold_until) && stored >= Date.parse(todayAtSent.hold_until),
    'the row held to ' + words(Date.parse(row.hold_until)) + ' and now holds to ' + words(stored) + ' Central; today (' + BASEREF + ') gives ' + words(Date.parse(todayAtSent.hold_until)) + ' Central');
  chk('HOLD01-B-TWO-STEP-TAKES-THE-SENT-TIME-RULE', same(stored, { y: 2026, mo: 10, d: 7, h: 12, mi: 0 }),
    'a quote created before 3:00 PM and SENT after it must take the SENT-time rule (' + wanted({ mo: 10, d: 7, h: 12, mi: 0 }) + '); the row takes ' + words(stored) + ' Central. ' +
    (stored < Date.parse(recomputed.hold_until)
      ? 'holdFor gives ' + words(Date.parse(recomputed.hold_until)) + ' and the row cannot carry it: the cutoff does not travel with the hold at /sent (quotebook.js sent())'
      : ''));
}
say('');

/* ================================================================ C · NOTHING ELSE MOVED */
say('--- C · NOTHING ELSE MOVED: no hold arithmetic and no customer word outside holdFor ---');
{
  const NOARITH = ['page.js', 'page-words.js', 'quotebook.js'];
  const BANNED = [/48\s*\*\s*3600000/, /\bHOLD_MS\b/, /12\s*\*\s*3600000/, /\bSHORT_NOTICE_MS\b/, /\bPROMISE_HOUR\b/, /chicagoWall\s*\([^)]*21\s*,\s*0\s*\)/, /\bpromisedUntil\b/];
  const hits = [];
  for (const f of NOARITH) {
    const t = fs.readFileSync(path.join(CDIR, f), 'utf8');
    for (const re of BANNED) if (re.test(t)) hits.push(f + ' :: /' + re.source + '/ :: ' + String((t.match(re) || [''])[0]).trim());
  }
  chk('HOLD01-C-NO-HOLD-ARITHMETIC-OUTSIDE-HOLDFOR', hits.length === 0,
    NOARITH.join(', ') + ' in ' + CDIR + ' scanned for ' + BANNED.length + ' forms of the hold arithmetic' + (hits.length ? ' — found: ' + hits.join(' | ') : ' — none present'));

  /* tracked AND untracked: a stray file outside the grant is as much a move as an edit inside it */
  const tracked = execFileSync('git', ['diff', '--name-only', BASEREF, '--'], { cwd: REPO, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const untracked = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: REPO, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
  const changed = [...new Set([...tracked, ...untracked])].sort();
  /* RE-CUT by WORKER-HOLD-01.1: the grant WIDENED by exactly one file. WORKER-HOLD-01 could not touch
     quotebook.js, so this list was quotes.js + the test dir; the .1 ignite grants quotebook.js sent() and
     names it THE GRANT EXTENSION. Widened to the .1 grant and no further — page.js, page-words.js and
     biztime.js stay read-only and any stray file outside these three paths still reds this clause. */
  const allowed = (p) => p === 'worker/src/quotes.js' || p === 'worker/src/quotebook.js' || p.startsWith('worker/test/');
  chk('HOLD01-C-ONLY-QUOTES-JS-AND-THE-TEST-DIR-MOVED', changed.length > 0 && changed.every(allowed),
    'git diff --name-only ' + BASEREF + ' + git status --porcelain -uall -> ' + (changed.length ? changed.join(' , ') : '(nothing)') + (changed.every(allowed) ? '' : ' — OUTSIDE THE GRANT: ' + changed.filter((p) => !allowed(p)).join(' , ')));

  const baseWordsSrc = execFileSync('git', ['show', BASEREF + ':worker/src/page-words.js'], { cwd: REPO, encoding: 'utf8' });
  const quoted = [];
  let allFound = true;
  for (const l of ['en', 'es']) {
    for (const k of ['hold_one', 'hold_two', 'hold_ended_one', 'hold_ended_two']) {
      const v = WORDS[l][k];
      quoted.push(l + '.' + k + ' = ' + J(v));
      if (!baseWordsSrc.includes(v)) { allFound = false; quoted.push('!! ' + l + '.' + k + ' IS NOT IN ' + BASEREF); }
    }
  }
  chk('HOLD01-C-THE-CUSTOMERS-HOLD-WORDS-ARE-UNCHANGED', allFound,
    'all eight hold lines read off page-words.js and found verbatim in ' + BASEREF + ': ' + quoted.join(' · '));
}
say('');
say('RESULT: ' + (fails ? 'FAIL' : 'PASS') + '   PASS ' + passes + ' FAIL ' + fails + '   baseref=' + BASEREF + ' cdir=' + CDIR);
process.exit(fails ? 1 : 0);
