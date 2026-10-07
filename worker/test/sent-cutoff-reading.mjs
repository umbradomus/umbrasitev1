/* WORKER-HOLD-01.1 · THE READING FOR W2 AND W4: THE CUTOFF ONLY EVER GOES UP, AND THE API REPORTS WHAT WAS
   WRITTEN. 2026-10-07. Test-only: no wrangler, no network, no port, nothing here ships.

   WHY A SECOND INSTRUMENT. hold-rule-reading.mjs proves the ROUND'S CLAUSE — a quote created before 3:00 PM and
   sent after it takes the sent-time rule — and its finish line is PASS 46 FAIL 0, which the deploy reads. But on
   the real road holdFor's cutoff at /sent is NEVER below the row's own (worked out by hand in
   Bridge\WORKER-HOLD-01.1\R2-expectation-worked-by-hand.txt: with short_notice pinned, `from` only ever advances
   and promisedUntil is non-decreasing, so cutoff_sent >= cutoff_create always). That means `Max` and a bare
   `assign` give the SAME answer on every quote the Flux can make, and NO clause in hold-rule-reading can tell
   them apart. A plant that changes no reading is a check that cannot fail (G76). So W2 — THE CUTOFF ONLY EVER
   GOES UP, which is what keeps a booking from being taken away from a customer still holding the link — needs a
   guard that exercises sent() where the real road cannot reach: a LOWER cutoff handed in, none handed in, and
   an unparseable one. That is this file.

   IT RETYPES NOTHING. sent()'s raise is SLICED OUT OF quotebook.js BY CONTENT (G88) and eval'd, so planting
   `assign` in the real source turns these clauses red. markSent's response is read off quotes.js the same way.

   Run (from worker/):  node test/sent-cutoff-reading.mjs                                                     */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chicagoWall } from '../src/biztime.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');

let fails = 0, passes = 0;
const say = (s) => console.log(s);
const J = (s) => JSON.stringify(s);
const chk = (name, ok, reading) => {
  if (ok) { passes++; say('PASS  ' + name + '   ' + reading); }
  else { fails++; say('FAIL  ' + name + '   ' + reading); }
};
const rig = (why) => { say('RIG FAILED: ' + why); process.exit(3); };

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

/* ---------------------------------------------------------------- sent()'s own raise, sliced and eval'd */
const qbSrc = fs.readFileSync(path.join(SRC, 'quotebook.js'), 'utf8');
const sentFn = sliceFn(qbSrc, '  sent(jobId, version, sentAt, holdUntil, cutoff) {');
if (!sentFn) rig('quotebook.js has no sent(jobId, version, sentAt, holdUntil, cutoff) — the cutoff does not travel');
const raiseLine = (sentFn.match(/const newCutoff = [^;]+;/) || [])[0];
if (!raiseLine) rig('quotebook.js sent() does not yield a `const newCutoff = ...;` statement by content');
const RAISE = new Function('row', 'cutoff', raiseLine + ' return newCutoff;');

const CT = (y, mo, d, h, mi = 0) => new Date(chicagoWall(y, mo, d, h, mi)).toISOString();
const ROWCUT = CT(2026, 10, 10, 21, 0);
const LOWER = CT(2026, 10, 3, 21, 0);
const HIGHER = CT(2026, 10, 20, 12, 0);

say('# WORKER-HOLD-01.1 · W2 (the cutoff only ever goes up) and W4 (the API reports what was written)');
say('# quotebook.js sent() raise, sliced by content and evaluated: ' + raiseLine.trim());
say('# the row under test carries cutoff ' + ROWCUT);
say('');

say('--- W2 · THE CUTOFF ONLY EVER GOES UP. The book reads it to REFUSE, so a lowered cutoff is a booking taken away ---');
{
  const row = { cutoff: ROWCUT };
  const cases = [
    { n: 'A-LOWER-CUTOFF-IS-REFUSED', hand: LOWER, want: ROWCUT, why: 'a cutoff EARLIER than the row own must leave the column exactly as it was' },
    { n: 'A-HIGHER-CUTOFF-IS-TAKEN', hand: HIGHER, want: HIGHER, why: 'a cutoff LATER than the row own is the whole point of the round' },
    { n: 'THE-SAME-CUTOFF-IS-A-NO-OP', hand: ROWCUT, want: ROWCUT, why: 'every quote the Flux makes today lands here: sent == created, so the hand-in equals the column' },
    { n: 'NO-CUTOFF-LEAVES-THE-COLUMN', hand: undefined, want: ROWCUT, why: 'the method is public and a caller may hand none' },
    { n: 'NULL-LEAVES-THE-COLUMN', hand: null, want: ROWCUT, why: 'the same, explicitly' },
    { n: 'AN-UNPARSEABLE-CUTOFF-LEAVES-THE-COLUMN', hand: 'not a date', want: ROWCUT, why: 'Date.parse gives NaN and every comparison with NaN is false, so the column stands' },
    { n: 'AN-EMPTY-CUTOFF-LEAVES-THE-COLUMN', hand: '', want: ROWCUT, why: 'falsy, so it never reaches the comparison' },
  ];
  for (const c of cases) {
    let got, threw = null;
    try { got = RAISE(row, c.hand); } catch (e) { threw = String(e && e.message); }
    chk('SENTCUT-W2-' + c.n, !threw && got === c.want,
      'handed ' + J(c.hand) + ' against a row at ' + ROWCUT + ' -> ' + (threw ? 'THREW ' + threw : J(got)) + '; wanted ' + J(c.want) + ' — ' + c.why);
  }
  /* the property itself, over every ordering, not just the named moments */
  let worst = null, n = 0;
  for (const dd of [1, 5, 9, 10, 11, 15, 25]) {
    for (const hh of [0, 7, 12, 15, 20, 21, 23]) {
      const hand = CT(2026, 10, dd, hh, 0);
      const got = RAISE(row, hand);
      n++;
      if (Date.parse(got) < Date.parse(ROWCUT)) worst = worst || { hand, got, why: 'the column was LOWERED' };
      else if (Date.parse(hand) > Date.parse(ROWCUT) && got !== hand) worst = worst || { hand, got, why: 'a later cutoff was not taken' };
      else if (Date.parse(hand) <= Date.parse(ROWCUT) && got !== ROWCUT) worst = worst || { hand, got, why: 'an earlier cutoff moved the column' };
    }
  }
  chk('SENTCUT-W2-NEVER-LOWERED-OVER-EVERY-ORDERING', !worst,
    n + ' cutoffs handed in across 2026-10-01..25 Central against a row at ' + ROWCUT
    + ', each checked that the column is the LATER of the two and never earlier than it was'
    + (worst ? ' — first break: handed ' + worst.hand + ' gave ' + worst.got + ': ' + worst.why : ''));
}
say('');

say('--- W2b · the SET list, the binding and where the raise happens, off quotebook.js own source ---');
{
  const setsCut = sentFn.split("_bump(row.token_hash, '");
  const sets = setsCut.length > 1 ? setsCut[1].split("'")[0] : '(not found)';
  chk('SENTCUT-W2B-THE-SET-LIST-CARRIES-THE-CUTOFF',
    sets === 'sent_at = ?, hold_until = ?, cutoff = ?' && sentFn.includes('[sentAt, holdUntil, newCutoff]'),
    'sent() sets ' + J(sets) + ' and binds the RAISED value, not the handed-in one');
  chk('SENTCUT-W2B-THE-RAISE-IS-INSIDE-THE-TRANSACTION',
    sentFn.indexOf('transactionSync') >= 0 && sentFn.indexOf('transactionSync') < sentFn.indexOf('const newCutoff'),
    'the raise reads row.cutoff INSIDE transactionSync, where no stale read can lower it');
  chk('SENTCUT-W2B-NO-DDL-AND-NO-MIGRATION',
    !/ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+/i.test(sentFn),
    'sent() adds no DDL: the cutoff column is create own INSERT column');
}
say('');

say('--- W4 · the API must not report the cutoff the row no longer has ---');
{
  const qSrc = fs.readFileSync(path.join(SRC, 'quotes.js'), 'utf8');
  const markSent = sliceFn(qSrc, 'export async function markSent(');
  if (!markSent) rig('quotes.js did not yield markSent by content');
  chk('SENTCUT-W4-THE-BODY-REPORTS-THE-WRITTEN-CUTOFF',
    markSent.includes('cutoff: r.row.cutoff') && !markSent.includes('cutoff: cur.cutoff'),
    'markSent 200 body reports ' + (markSent.includes('cutoff: r.row.cutoff') ? 'r.row.cutoff, read back off the row sent() wrote' : 'something else')
    + (markSent.includes('cutoff: cur.cutoff') ? ' AND STILL reports cur.cutoff, the value the row no longer has' : ''));
  chk('SENTCUT-W4-THE-BODY-REPORTS-THE-WRITTEN-HOLD',
    markSent.includes('hold_until: r.row.hold_until'),
    'markSent 200 body reports the hold_until off the same row read');
  chk('SENTCUT-W4-THE-CLAMP-IS-GONE',
    !markSent.includes('Math.min(Date.parse(hold.hold_until)') && !/const holdUntil =/.test(markSent),
    'the Math.min against cur.cutoff and its holdUntil local are both gone (W3: out in the same commit the cutoff starts travelling)');
  chk('SENTCUT-W4-THE-CUTOFF-IS-HANDED-TO-THE-BOOK',
    markSent.includes('b.sent(jobId, version, sentIso, hold.hold_until, hold.cutoff)'),
    'markSent hands holdFor own cutoff to sent()');
}
say('');
say('RESULT: ' + (fails ? 'FAIL' : 'PASS') + '   PASS ' + passes + ' FAIL ' + fails + '   W2 the cutoff only ever goes up · W4 the API reports what was written');
process.exit(fails ? 1 : 0);
