/* ============================================================ SITE-FIX-16 · B
   A CHANGED FILE IS A NEW URL.

     node tools/check-asset-versions.mjs <refA> <refB>

   refA is the commit that is LIVE (the sha a DEPLOY-WEBSITE close names), refB the tip
   about to go live. For every local file a page asks for, this reads the file's bytes at
   both refs and the URL the page writes for it at both refs. It FAILS, naming the file and
   the pages, when the bytes changed and a page still asks for the same URL - because the
   site tells browsers to keep /assets for 7 days (Cache-Control: public, max-age=604800),
   so a returning visitor with that URL in its cache runs last week's file. The cache
   headers are right; only the URL has to move.

   Reads git and nothing else - no library, no network, no write. Exit 0 pass, 1 fail,
   2 could not read.   DEPLOY-WEBSITE-17 should run:
     node tools/check-asset-versions.mjs <deployed-sha> <tip>
*/
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [refA, refB] = process.argv.slice(2);
if (!refA || !refB) {
  console.error('usage: node tools/check-asset-versions.mjs <refA-live> <refB-tip>');
  process.exit(2);
}

function git(args) {
  return execFileSync('git', ['-C', ROOT].concat(args), { encoding: 'utf8', maxBuffer: 1 << 28 });
}

/* every blob in a ref: path -> blob sha (the sha IS the bytes) */
function tree(ref) {
  const out = new Map();
  for (const line of git(['ls-tree', '-r', ref]).split('\n')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.*)$/.exec(line);
    if (m) out.set(m[2], m[1]);
  }
  return out;
}

/* the pages a visitor loads: tracked .html outside worker/ */
function pages(ref, t) {
  return [...t.keys()].filter((p) => p.endsWith('.html') && !p.startsWith('worker/'));
}

/* every local URL a page ASKS THE BROWSER FOR, by the file it points at.
   An HTML comment is taken out first - /assets/umbra-menu.js is named in a comment on
   six pages and no browser ever fetches it - and only a quoted src=, href= or content=
   is read, so a src=, a stylesheet href= and an og:image content= are all caught the
   same way and prose is not. */
const LOCAL = /^\/(?:assets\/[A-Za-z0-9._\-/]+|site\.config\.js)(?:\?[^"]*)?$/;
const ATTR = /(?:src|href|content)\s*=\s*"([^"]*)"/gi;
function urlsOf(text) {
  const clean = text.replace(/<!--[\s\S]*?-->/g, ' ');
  const out = new Map();                         /* file path -> Set of full URLs */
  let m;
  while ((m = ATTR.exec(clean)) !== null) {
    const u = m[1].trim();
    if (!LOCAL.test(u)) continue;
    const file = u.split('?')[0].slice(1);
    if (!out.has(file)) out.set(file, new Set());
    out.get(file).add(u);
  }
  ATTR.lastIndex = 0;
  return out;
}

let tA, tB;
try { tA = tree(refA); tB = tree(refB); }
catch (err) { console.error('could not read a ref: ' + String(err.message || err).trim()); process.exit(2); }

/* what every page asks for, at each ref */
function asks(ref, t) {
  const byFile = new Map();                      /* file -> Map(page -> Set(url)) */
  for (const pg of pages(ref, t)) {
    let text = '';
    try { text = git(['show', ref + ':' + pg]); } catch { continue; }
    for (const [file, urls] of urlsOf(text)) {
      if (!byFile.has(file)) byFile.set(file, new Map());
      byFile.get(file).set(pg, urls);
    }
  }
  return byFile;
}
const askA = asks(refA, tA);
const askB = asks(refB, tB);

const files = [...new Set([...askA.keys(), ...askB.keys()])].sort();
const bad = [];
const bumped = [];
const unchanged = [];

for (const f of files) {
  const shaA = tA.get(f), shaB = tB.get(f);
  if (!shaA || !shaB) continue;                  /* a file added or deleted is a new URL by itself */
  if (shaA === shaB) { unchanged.push(f); continue; }

  const pagesB = askB.get(f) || new Map();
  const stale = [];
  for (const [pg, urlsB] of pagesB) {
    const urlsA = (askA.get(f) || new Map()).get(pg);
    if (!urlsA) continue;                        /* the page did not load it before */
    for (const u of urlsB) if (urlsA.has(u)) stale.push(pg + '  ' + u);
  }
  if (stale.length) bad.push({ f, shaA, shaB, stale, pagesB });
  else bumped.push({ f, shaA, shaB, pagesB });
}

const sh = (s) => String(s).slice(0, 8);
console.log('check-asset-versions  ' + refA.slice(0, 8) + ' (live) -> ' + refB.slice(0, 8) + ' (tip)');
console.log('  files a page asks for: ' + files.length
  + ' | bytes unchanged: ' + unchanged.length
  + ' | bytes changed and the URL moved: ' + bumped.length
  + ' | bytes changed and a page still asks for the old URL: ' + bad.length);

for (const b of bumped) {
  console.log('  OK      ' + b.f + '  ' + sh(b.shaA) + ' -> ' + sh(b.shaB)
    + '  new URL on all ' + b.pagesB.size + ' page(s): '
    + [...new Set([...b.pagesB.values()].flatMap((s) => [...s]))].join(' '));
}
for (const b of bad) {
  console.log('  FAIL    ' + b.f + '  bytes changed ' + sh(b.shaA) + ' -> ' + sh(b.shaB)
    + '  but ' + b.stale.length + ' page(s) still ask for the old URL:');
  for (const s of b.stale) console.log('            ' + s);
}

if (bad.length) {
  console.log('');
  console.log('FAIL: ' + bad.length + ' changed file(s) still served from a cached URL: '
    + bad.map((b) => b.f).join(', '));
  process.exit(1);
}
console.log('');
console.log('PASS: every file whose bytes changed is asked for at a new URL on every page that loads it.');
process.exit(0);
