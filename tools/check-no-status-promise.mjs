/* SITE-FIX-17 · E-2 · NO PAGE AND NO MESSAGE PROMISES A STATUS LINK THAT IS NOT BUILT.
   A READ ONLY. It opens files and prints; it writes nothing, sends nothing, and reaches no network.

   THE DEFECT (Bridge/FLUX-REWALK-01/70-EDGES.md E-2): "Save my status link - It shows where your request
   stands, any time" on the received page, and "Track it: https://umbradomus.com/status?id=..." in the text
   the website sends - against a page that answers every id with "It's being built". The only promise in the
   whole walk that the product itself contradicts, made twice.

   WHY IT IS ONE CHECK OVER EVERY SURFACE AND NOT A CLAUSE PER PAGE (R-D, Bridge/EXEC/MISTAKES-CEO11-2026-10-07.md):
   the floor's two failures of 2026-10-07 both happened because a ban he stated was turned into a check for the
   one screen somebody remembered. This reads EVERY customer surface in the repo and names the ones it read.

   THE TWO PAGES IT DOES NOT READ, BY NAME AND WITH THE REASON: status.html and es/estado.html. They ARE the
   status page; their own copy says plainly that it is being built, which is the honest half of E-2 and the
   charter's "the status page itself is not built or changed here". A promise made ON the page that answers it
   is not a promise the product contradicts.

     node tools/check-no-status-promise.mjs [--out <file>]
   exit 0 = no surface promises it · exit 1 = at least one does, each named with its file, line and line text. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) A[a.slice(2)] = (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) ? process.argv[++i] : true;
}
const OUT = A.out ? String(A.out) : null;
const L = [];
const say = (s) => { L.push(s); console.log(s); };
let pass = 0, fail = 0;
const ok = (name, good, detail) => {
  if (good) { pass++; say('PASS  ' + name + (detail ? '  - ' + detail : '')); }
  else { fail++; say('FAIL  ' + name + (detail ? '  - ' + detail : '')); }
};

/* ---------------------------------------------------------------- the surfaces, found by content */
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'Claude outputs', 'tools', '_pre-OG141-2026-09-11',
  '_pre-OG148-2026-09-12', '_pre-restore-2026-09-06-icons', '_git-stale-locks-2026-09-06', 'test', 'img', 'fonts']);
const NOT_READ = ['status.html', 'es/estado.html'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); continue; }
    out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(REPO, p).replace(/\\/g, '/');

/* A customer surface: a page the customer's browser opens, a script those pages load, or a Worker file that
   writes words the customer reads. Found by content: an .html with a <body>, an asset the pages load, and any
   worker/src file that pulls in page-words.js (the customer's own vocabulary) or defines the booking text. */
const all = walk(REPO);
const html = all.filter((p) => p.endsWith('.html') && /<body/i.test(fs.readFileSync(p, 'utf8')));
const assets = all.filter((p) => rel(p).startsWith('assets/') && p.endsWith('.js'));
const workerSrc = all.filter((p) => rel(p).startsWith('worker/src/') && p.endsWith('.js'));
const customerWorker = workerSrc.filter((p) => {
  const s = fs.readFileSync(p, 'utf8');
  return /from '\.\/page-words\.js'/.test(s) || /^export const CONFIRM_/m.test(s) || /confirmationEmail/.test(s);
});
const surfaces = [...html, ...assets, ...customerWorker].filter((p) => !NOT_READ.includes(rel(p)));

/* ---------------------------------------------------------------- the promise, in either language */
const BANNED = [
  [/status link/i, 'the words "status link"'],
  [/enlace de estado/i, 'the words "enlace de estado"'],
  [/\bTrack it\b/i, 'the "Track it" line'],
  [/Save my status|Guardar mi enlace/i, 'a button that saves the link'],
  [/\/status\?id=|\/es\/estado\?id=/, 'the link itself, built for a customer to keep'],
  [/S[ií]galo (aqu[ií]|en)/i, 'a Spanish "follow it here" line'],
];
/* What a customer reads is the words, not the notes around them: a block comment and a line comment come out
   first. `//` is only a comment here when it does not follow a colon, so https:// survives. */
function spoken(src, isHtml) {
  let s = src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (!isHtml) s = s.split('\n').map((ln) => ln.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  return s;
}

say('SITE-FIX-17 · E-2 · check-no-status-promise · ' + new Date().toISOString());
say('repo: ' + REPO);
say('');
say('--- the surfaces read (' + surfaces.length + ') ---');
for (const p of surfaces) say('  ' + rel(p));
say('');
say('--- not read, by name and with the reason ---');
for (const p of NOT_READ) say('  ' + p + '  - it IS the status page; its own copy says it is being built (charter: not built or changed here)');
say('');

const hits = [];
for (const p of surfaces) {
  const raw = fs.readFileSync(p, 'utf8');
  const src = spoken(raw, p.endsWith('.html'));
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const [re, what] of BANNED) {
      if (re.test(lines[i])) hits.push({ file: rel(p), line: i + 1, what, text: lines[i].trim().slice(0, 160) });
    }
  }
}
say('--- every promise found (' + hits.length + ') ---');
for (const h of hits) say('  ' + h.file + ':' + h.line + '  ' + h.what + '\n      ' + h.text);
if (!hits.length) say('  none');
say('');

ok('e2-no-surface-promises-a-status-link', hits.length === 0,
  hits.length ? hits.map((h) => h.file + ':' + h.line).join(', ') : 'no page, asset or customer-facing Worker file promises it');

/* The other half of the ruling: the received page tells them what to do instead. */
for (const [f, re, what] of [
  ['request-received.html', /[Rr]eply to Drew's text/, 'the English received page says to reply to the text'],
  ['es/recibido.html', /Responda al mensaje/, 'the Spanish received page says to reply to the message'],
]) {
  /* R88 second reader: through spoken() like everything else, or a COMMENT saying "reply to Drew's text" would
     satisfy the clause while the page said nothing of the kind. */
  const s = spoken(fs.readFileSync(path.join(REPO, f), 'utf8'), true);
  ok('e2-reply-instead-' + f.replace(/[^a-z]/gi, '-'), re.test(s), what);
}
/* And the request number stays: it is what they quote when they reply. */
for (const f of ['request-received.html', 'es/recibido.html']) {
  const s = fs.readFileSync(path.join(REPO, f), 'utf8');
  ok('e2-request-number-kept-' + f.replace(/[^a-z]/gi, '-'), /id="jobid"/.test(s), 'the request number is still on the page');
}
/* The booking text the WEBSITE sends carries no link at all - read on the words themselves. */
{
  const s = fs.readFileSync(path.join(REPO, 'worker/src/confirm.js'), 'utf8');
  /* R88 second reader: a backtick form counts too - the next hand to write one must not slip past this clause. */
  const words = (s.match(/^export const CONFIRM_[A-Z0-9_]+ = (['"`])[\s\S]*?\1;$/gm) || []);
  say('--- the confirmation text the website sends, as confirm.js writes it (' + words.length + ' forms) ---');
  for (const wd of words) say('  ' + wd.replace(/\s+/g, ' ').slice(0, 200));
  say('');
  ok('e2-confirmation-text-has-no-link', words.length >= 2 && !words.some((wd) => /https?:|status|Track/i.test(wd)),
    'no link and no "Track it" in any form of the text');
}

say('--- RESULT ---');
say((fail === 0 ? 'RESULT: PASS' : 'RESULT: FAIL') + '  pass ' + pass + '  fail ' + fail);
if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, L.join('\n') + '\n'); }
process.exit(fail === 0 ? 0 : 1);
