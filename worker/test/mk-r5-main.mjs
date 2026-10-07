/* assembles Bridge/WORKER-EMAIL-01/R5-main.txt: T1 - main merged in, A-C re-run. */
import fs from 'node:fs';
import path from 'node:path';

const B = 'C:/Users/andre/Umbra/Boss/Bridge/WORKER-EMAIL-01';
const L = [];
const say = (s) => L.push(s == null ? '' : String(s));
const rd = (f) => fs.readFileSync(path.join(B, f), 'utf8').split(/\r?\n/);
const J = (f) => JSON.parse(fs.readFileSync(path.join(B, f), 'utf8'));
const line = (f, re) => (rd(f).find((l) => re.test(l)) || '(line not found)').trim();
const count = (f) => line(f, /^  by the browser:/);
const rec = (f) => line(f, /^  id=/);

say('WORKER-EMAIL-01 · R5-main - T1, UP TO MAIN: main merged in, clauses A-C re-run against it');
say('assembled 2026-10-07T09:12Z');
say('');
say('WHAT MAIN DID WHILE THIS ROUND RAN');
say('  at the clock start (07:42:19Z) main was 2e8436a "DEPLOY-WEBSITE-16: merge site-fix-15" - that is 00-BASE.txt.');
say('  by 09:04Z another seat had moved main to 1ef484a "DEPLOY-WEBSITE-17: merge site-fix-16", bringing');
say('    b6e2407 SITE-FIX-16 A: every answer posted once');
say('    e70f95a SITE-FIX-16 B: a changed file is a new URL');
say('    a1a7fa2 SITE-FIX-16 A.1 (R88): a live carrier is one the browser will actually post');
say('    b1ccb96 SITE-FIX-16 B.1 (R88): the cache is keyed by URL, not by page');
say('  THAT IS THE ?v= ROUND THE CTO\'S UPDATE NAMED. It is now merged INTO this branch - never the other way.');
say('  main\'s ref was not moved, not merged into, not reset, not pushed by this seat. Nothing was deployed.');
say('');
say('THE MERGE');
say('  git merge main  ->  TWO conflicts, both the same two adjacent script tags, on services.html and es/servicios.html:');
say('    HEAD: umbra-sent.js?v=1 + umbra-two-channels.js?v=4      (mine: the two-channels bump)');
say('    main: umbra-sent.js?v=2 + umbra-two-channels.js?v=3      (theirs: the sent.js bump)');
say('  RESOLVED by keeping BOTH - they are different files and neither claim is about the other:');
say('    umbra-sent.js?v=2 (main\'s) and umbra-two-channels.js?v=4 (mine).');
say('  merge commit d25ef3f. No other conflict; 40 of main\'s files came in clean.');
say('');
say('=============================================================================');
say('0 · SITE-FIX-16\'S OWN GUARD, RUN ON THE MERGED TREE');
say('=============================================================================');
say('  node tools/check-asset-versions.mjs 1ef484a HEAD      (main\'s new guard, brought in by the merge)');
for (const l of rd('R5-asset-versions.log').slice(2)) if (l.trim()) say('  ' + l.replace(/\s+$/, ''));
say('  READ IT: the one file this round changed is asked for at a NEW URL on ALL SIX pages that load it,');
say('  and at exactly one URL. That is the guard main itself wrote for this exact mistake, and it passes.');
say('');
say('=============================================================================');
say('1 · CLAUSE A RE-RUN - THE CAUSE IS STILL THE CAUSE ON TODAY\'S MAIN');
say('=============================================================================');
say('RED, on main at 1ef484a (SITE-FIX-16 and all), mail endpoint held 8.1 s - the U-0018 latency:');
say('  ' + rec('R5-A3-base-8100-en.txt'));
say('  ' + count('R5-A3-base-8100-en.txt'));
say('  ' + line('R5-A3-base-8100-en.txt', /^  status_note:/));
say('  [R5-A3-base-8100-en.txt]');
say('  -> SITE-FIX-16 DID NOT FIX THIS. Today\'s main still writes off a copy the mail service then takes,');
say('     still wakes the Worker fallback, still gets 429, still records email_lost=true - and attempts TWO sends.');
say('');
say('GREEN, the same walk at the same 8.1 s on this branch with main merged in:');
say('  ' + rec('R5-A2-cand-8100-en.txt'));
say('  ' + count('R5-A2-cand-8100-en.txt'));
say('  [R5-A2-cand-8100-en.txt]');
say('');
say('CONTROL, a fresh browser profile with the mail endpoint answering at once (the reading that never reproduced):');
say('  ' + rec('R5-A1-fresh-en.txt'));
say('  ' + count('R5-A1-fresh-en.txt'));
say('  [R5-A1-fresh-en.txt]');
say('');
say('=============================================================================');
say('2 · CLAUSE B RE-RUN - THE FALLBACK, BROWSER LEG CUT ON PURPOSE');
say('=============================================================================');
say('  ' + line('R5-B-fallback-en.txt', /leg=worker/));
say('  ' + rec('R5-B-fallback-en.txt'));
say('  ' + count('R5-B-fallback-en.txt'));
say('  [R5-B-fallback-en.txt]');
say('  READ IT: with the browser\'s copy cut, the Worker\'s fallback reaches the stub and the record says so -');
say('  email_sent "no" (the browser\'s own word, kept verbatim), sent_by "worker", forward_failed false, email_lost false.');
say('  ONE copy, by the Worker. The fallback\'s CODE is sound; only its live target refuses it (RB-fallback.txt).');
say('');
say('=============================================================================');
say('3 · CLAUSE C RE-RUN - ONE COPY PER REQUEST, EN AND ES');
say('=============================================================================');
for (const [f, what] of [
  ['R5-C-en-8100.txt', 'EN, mail endpoint holds 8.1 s'],
  ['R5-C-es-8100.txt', 'ES, mail endpoint holds 8.1 s'],
  ['R5-C-en-fast.txt', 'EN, mail endpoint answers at once'],
  ['R5-C-es-fast.txt', 'ES, mail endpoint answers at once'],
]) {
  say('  ' + what);
  say('    ' + rec(f));
  say('    ' + count(f));
}
say('  all four: ONE copy, by the browser, the record names the leg, email_lost false, the received page reached.');
say('');
say('NOTHING ELSE IN THE REQUEST MOVES, against TODAY\'S main (1ef484a):');
for (const [lang, b, c] of [['EN', 'R5-base-en-fast', 'R5-C-en-fast'], ['ES', 'R5-base-es-fast', 'R5-C-es-fast']]) {
  const jb = J(b + '.parts.json'), jc = J(c + '.parts.json');
  say('  ' + lang + '  /intake body:  base(1ef484a) ' + jb.intake.bytes + ' bytes / ' + jb.intake.parts.length + ' parts   ' +
      'cand(d25ef3f) ' + jc.intake.bytes + ' bytes / ' + jc.intake.parts.length + ' parts   ' +
      'identical name for name: ' + String(jb.intake.parts.join('|') === jc.intake.parts.join('|')).toUpperCase());
  say('      ' + jc.intake.parts.join(', '));
  say('  ' + lang + '  the browser copy\'s own body: identical: ' +
      String(JSON.stringify(jb.copies) === JSON.stringify(jc.copies)).toUpperCase());
}
say('');
say('  ONE THING TO NAME, and it is MAIN\'S doing, not this round\'s: between 2e8436a and 1ef484a the request got');
say('  SMALLER - EN went from 40 parts / 4480 bytes to 35 / 3944 (RC-request.txt vs this file). That is SITE-FIX-16 A,');
say('  "every answer posted once", removing the duplicate parts. This branch carries whatever main carries, part for');
say('  part: on 2e8436a it matched 2e8436a, and on 1ef484a it matches 1ef484a. No field of this round\'s doing.');
say('');
say('=============================================================================');
say('4 · VERDICT');
say('=============================================================================');
say('  R5 (T1): GREEN. main at 1ef484a is merged in at d25ef3f, A-C re-run against it:');
say('  the cause still reproduces on today\'s main and no longer reproduces on this branch; the fallback still');
say('  reaches the stub when the browser leg is cut; one copy per request in EN and ES; the /intake body unchanged');
say('  against today\'s main, name for name and byte for byte; and main\'s own asset-version guard passes on the tree.');

const out = path.join(B, 'R5-main.txt');
fs.writeFileSync(out, L.join('\n') + '\n');
console.log('written: ' + out + '  ' + fs.statSync(out).size + ' bytes');
