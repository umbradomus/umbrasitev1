/* SITE-FIX-17 · E-1 · WHAT THE CUSTOMER'S QUOTE PAGE AND "YOU'RE BOOKED" PAGE SAY ABOUT EVERY VISIT THE JOB NEEDS.
   NOTHING HERE SENDS, DEPLOYS, OR REACHES A NETWORK. No wrangler, no browser, no KV: the two render functions in
   worker/src/page.js are imported and handed a page view of the shape quotes.js viewByCode() returns, and the HTML
   they give back is read. That is the whole instrument.

   THE DEFECT IT READS (Bridge/FLUX-REWALK-01/70-EDGES.md E-1): the walk's TEST quote was a TWO-VISIT job and the
   customer's quote page said, whole: "Fri 10/9 · Arriving 8-10 AM · about 1 hour", and under the button "Accepting
   books this visit at the price above." The second day was on neither page. The row carries the second visit's
   length in `visit_minutes` the moment the Flux stops slicing it away (Bridge/SITE-FIX-17/E1-CONTRACT.txt) - and
   create has always accepted it, so the page is what has to read it.

     node worker/test/visits-page-reading.mjs --src base|cand|plant [--ref main] --out <file>

   --src base   worker/src as the named git ref has it (the live base), read without touching the working tree
   --src cand   worker/src as this worktree has it
   --src plant  the candidate with extraVisitMins() made to return nothing - the load-bearing plant: every clause
                this round adds must go RED on it, or the clause is not carrying the page.
   Either tree is materialised in the OS temp dir (never inside C:\Users\andre\Umbra\Boss - G128) with one line
   appended to its page.js copy, `export { openPage, bookedPage };`, so both trees are read exactly alike and the
   product file needs no test seam of its own. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, '../src');
const REPO = path.resolve(HERE, '../..');

const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) A[a.slice(2)] = (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) ? process.argv[++i] : true;
}
const SRC = String(A.src || 'cand');
const REF = String(A.ref || 'main');
const OUT = A.out ? String(A.out) : null;

const L = [];
const say = (s) => { L.push(s); console.log(s); };
let pass = 0, fail = 0;
const ok = (name, good, detail) => {
  if (good) { pass++; say('PASS  ' + name + (detail ? '  - ' + detail : '')); }
  else { fail++; say('FAIL  ' + name + (detail ? '  - ' + detail : '')); }
};

/* ------------------------------------------------------------------ the tree under the reading */
const TMP = path.join(os.tmpdir(), 'sf17-' + SRC + '-' + crypto.randomBytes(4).toString('hex'));
fs.mkdirSync(TMP, { recursive: true });
const names = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js'));
for (const f of names) {
  let body;
  if (SRC === 'base') body = execFileSync('git', ['-C', REPO, 'show', REF + ':worker/src/' + f], { encoding: 'utf8', maxBuffer: 1 << 28 });
  else body = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  if (f === 'page.js') {
    if (SRC === 'plant') {
      const before = body;
      body = body.replace('  return list.slice(shown, 2).filter((m) => Number.isInteger(m) && m >= 15 && m <= 720);', '  return [];');
      if (body === before) throw new Error('the plant found nothing to break - extraVisitMins is not there');
    }
    body += '\nexport { openPage, bookedPage };\n';
  }
  fs.writeFileSync(path.join(TMP, f), body);
}
const mod = await import('file:///' + path.join(TMP, 'page.js').replace(/\\/g, '/'));
const { openPage, bookedPage } = mod;

/* ------------------------------------------------------------------ the rows, as viewByCode() hands them over */
const NOW = '2026-10-07T20:00:00.000Z';
const HOLD = '2026-10-08T02:00:00.000Z';                       /* Wed 10/7, 9:00 PM Central */
const WIN1 = { n: 1, date: '2026-10-09', start: '08:00', end: '10:00', free: true };
const WIN2 = { n: 2, date: '2026-10-13', start: '11:00', end: '13:00', free: true };

function row(lang, { visit_minutes, options, accepted_window = null, state = 'open' } = {}) {
  const opts = options || [[WIN1]];
  return {
    state, lang, version: 1, job_id: 'U-0020', views: 1,
    hold_until: HOLD, cutoff: HOLD, short_notice: false, accepted_window,
    windows: opts.map((ws, i) => ({ ...ws[0], n: i + 1 })),
    options: opts.map((ws, i) => ({ n: i + 1, windows: ws, free: true })),
    body: {
      price: 285, first_name: 'TEST', included: 'Painted with your paint. Cleanup included.',
      scope: ['Cut out the loose drywall', 'Patch and tape', 'Texture to match', 'Prime and paint'],
      step_count: 8, guarantee: 'If it is not right, I come back.', insurance: 'Insured work.',
      ...(visit_minutes === undefined ? {} : { visit_minutes }),
    },
  };
}
const ENV = {};
/* the words the customer actually reads: the style and script blocks come out first, then every tag */
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const quote = async (v) => await bodyOf(openPage(ENV, v, 'ABCDEFGHJKMNPQRSTUVWXY', NOW));
const booked = async (v) => await bodyOf(bookedPage(v, 'ABCDEFGHJKMNPQRSTUVWXY'));
/* page() answers a Response (the Worker's own return value): its text is the page the customer is served. */
const bodyOf = async (res) => (typeof res === 'string' ? res : await res.text());

const WORDS_BACK = { en: 'we come back the next day', es: 'volvemos al d\u00eda siguiente' };
const LEN2 = { en: 'about 4 hours', es: 'unas 4 horas' };
const LEN1 = { en: 'about 1 hour', es: 'una hora' };
const BOOKS_BOTH = { en: 'Accepting books both visits at the price above.', es: 'quedan programadas las dos visitas' };
const BOOKS_ONE = { en: 'Accepting books this visit at the price above.', es: 'queda programada esta visita' };
const LBL_VISITS = { en: 'Your visits', es: 'Sus visitas' };

say('SITE-FIX-17 · E-1 · visits-page-reading · src=' + SRC + (SRC === 'base' ? ' (ref ' + REF + ')' : '') + ' · ' + new Date().toISOString());
say('tree read: ' + TMP);
say('');

/* ============================================================ 1 · THE WALK'S OWN QUOTE: TWO VISITS, ONE TIME OFFERED */
for (const lang of ['en', 'es']) {
  const v = row(lang, { visit_minutes: [60, 240] });
  const t = text(await quote((v)));
  say('--- the quote page, ' + lang + ', one window offered and visit_minutes [60, 240] ---');
  say('  ' + t.slice(0, 700));
  say('');
  ok('e1-quote-second-visit-named-' + lang, t.includes(WORDS_BACK[lang]), 'the page says "' + WORDS_BACK[lang] + '"');
  ok('e1-quote-second-visit-length-' + lang, t.includes(LEN2[lang]), 'and how long it takes: "' + LEN2[lang] + '"');
  ok('e1-quote-first-visit-kept-' + lang, t.includes(LEN1[lang]), 'visit 1 still reads "' + LEN1[lang] + '"');
  ok('e1-quote-books-both-visits-' + lang, t.includes(BOOKS_BOTH[lang]) && !t.includes(BOOKS_ONE[lang]),
    'the sentence under the button says what accepting books');
  ok('e1-quote-never-one-hour-alone-' + lang, !(t.includes(LEN1[lang]) && !t.includes(LEN2[lang])),
    'never "' + LEN1[lang] + '" alone on a two-visit job');

  const bt = text(await booked((row(lang, { visit_minutes: [60, 240], accepted_window: 1, state: 'booked' }))));
  say('--- "You are booked", ' + lang + ' ---');
  say('  ' + bt.slice(0, 560));
  say('');
  ok('e1-booked-second-visit-named-' + lang, bt.includes(WORDS_BACK[lang]), 'the booked page says "' + WORDS_BACK[lang] + '"');
  ok('e1-booked-second-visit-length-' + lang, bt.includes(LEN2[lang]), 'with its length');
  ok('e1-booked-label-plural-' + lang, bt.includes(LBL_VISITS[lang]), 'the ticket is labelled "' + LBL_VISITS[lang] + '"');
}

/* ============================================================ 2 · TWO OPTIONS, EACH ONE TIME: BOTH CARDS CARRY DAY 2 */
{
  const t = text(await quote((row('en', { visit_minutes: [60, 240], options: [[WIN1], [WIN2]] }))));
  const n = (t.match(/we come back the next day/g) || []).length;
  say('--- two options, each one window, visit_minutes [60, 240] - "we come back the next day" appears ' + n + ' time(s) ---');
  say('  ' + t.slice(0, 520));
  say('');
  ok('e1-every-option-card-carries-day-2', n === 2, 'one line per option card (' + n + ')');
  ok('e1-pick-legend-plural', t.includes('Pick your days'), 'the legend is "Pick your days"');
}

/* ============================================================ 3 · A ONE-VISIT JOB IS UNTOUCHED */
for (const lang of ['en', 'es']) {
  const t = text(await quote((row(lang, { visit_minutes: [60] }))));
  ok('e1-one-visit-says-nothing-extra-' + lang, !t.includes(WORDS_BACK[lang]), 'no second visit invented');
  ok('e1-one-visit-books-this-visit-' + lang, t.includes(BOOKS_ONE[lang]), 'the sentence is still the single-visit one');
  const t0 = text(await quote((row(lang, {}))));
  ok('e1-no-field-says-nothing-extra-' + lang, !t0.includes(WORDS_BACK[lang]) && t0.includes(BOOKS_ONE[lang]), 'and with no visit_minutes at all');
}

/* ============================================================ 4 · A BAD LENGTH IS DROPPED, NEVER AN ERROR */
for (const bad of [[60, 5], [60, 9999], [60, 'four hours'], [60, 240.5], [60, null]]) {
  let t = '', threw = null;
  try { t = text(await quote((row('en', { visit_minutes: bad })))); } catch (e) { threw = e; }
  ok('e1-bad-visit-minutes-dropped-' + JSON.stringify(bad[1]),
    !threw && t.includes('$285') && !t.includes(WORDS_BACK.en),
    threw ? 'THREW ' + threw.message : 'the page renders and the bad length is not drawn');
}

/* ============================================================ 5 · THE WORDS ARE THE FILE'S, NOT THIS CHECK'S */
{
  const wsrc = fs.readFileSync(path.join(TMP, 'page-words.js'), 'utf8');
  ok('e1-words-live-in-page-words-en', wsrc.includes("back_next: 'we come back the next day'"), 'EN back_next is in page-words.js');
  ok('e1-words-live-in-page-words-es', wsrc.includes("back_next: 'volvemos al d\u00eda siguiente'"), 'ES back_next is in page-words.js');
}

say('');
say('--- RESULT ---');
say((fail === 0 ? 'RESULT: PASS' : 'RESULT: FAIL') + '  pass ' + pass + '  fail ' + fail + '  src=' + SRC);
if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, L.join('\n') + '\n'); }
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
