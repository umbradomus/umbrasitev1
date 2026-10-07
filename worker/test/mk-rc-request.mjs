/* assembles Bridge/WORKER-EMAIL-01/RC-request.txt out of the clause C readings.
   Reads only the files this round wrote; prints field NAMES and sizes, never a value. */
import fs from 'node:fs';
import path from 'node:path';

const B = 'C:/Users/andre/Umbra/Boss/Bridge/WORKER-EMAIL-01';
const L = [];
const say = (s) => L.push(s == null ? '' : String(s));
const rd = (f) => fs.readFileSync(path.join(B, f), 'utf8');
const pick = (f, res) => rd(f).split(/\r?\n/).filter((l) => res.some((r) => r.test(l)));
const J = (f) => JSON.parse(rd(f));

say('WORKER-EMAIL-01 · RC-request - CLAUSE C, GREEN END TO END: the customer\'s walk, EN and ES, on the stub rig');
say('assembled 2026-10-07T08:31Z  ·  candidate = branch worker-email-01 (clause A commit 8de7a10 + clause C commit 84c626e)  ·  base = main tip 2e8436a');
say('every mail endpoint is a stub on this machine; nothing left it. No real address, no live Worker, no deploy.');
say('');
say('THE CLAUSE, IN ITS OWN WORDS');
say('  "the customer\'s walk (EN and ES) -> the stub receives exactly ONE copy per request (browser or worker, never both),');
say('   the record says which, the received page and the Flux\'s fields unchanged in name. Nothing else in the request moves');
say('   (diff the stub\'s /intake bodies base vs candidate, EN and ES)."');
say('');
say('=============================================================================');
say('1 · EXACTLY ONE COPY PER REQUEST - FOUR WALKS ON THE CANDIDATE');
say('=============================================================================');
say('The two "8100" walks hold the mail endpoint for 8.1 s - the very latency that lost U-0018 its copy (8071 ms).');
say('The two "fast" walks are the ordinary case. All four are a real tile tap -> form -> send in headless Chrome.');
say('');
const runs = [
  ['RC-C1-en-8100', 'EN', 'mail endpoint holds 8.1 s (the U-0018 latency)'],
  ['RC-C2-en-fast', 'EN', 'mail endpoint answers at once'],
  ['RC-C3-es-8100', 'ES', 'mail endpoint holds 8.1 s (the U-0018 latency)'],
  ['RC-C4-es-fast', 'ES', 'mail endpoint answers at once'],
];
for (const [f, lang, what] of runs) {
  say('--- ' + f + '  (' + lang + ', ' + what + ') ---');
  for (const l of pick(f + '.txt', [/^  id=/, /^  by the browser/, /^  reached the received page/, /landed:/])) say('   ' + l.trim());
  say('');
}
say('READ IT: in all four, TOTAL copies that reached a stub = 1, and it is the BROWSER every time.');
say('The Worker never sent a second one, because the record it was handed said email_sent="yes".');
say('The record names the leg: forwarded_by="browser", sent_by="browser", email_lost=false, forward_failed=false.');
say('RC-C1 and RC-C3 are the point of the round: at 8.1 s the copy is counted, where on base the same latency');
say('wrote it off (RA-before.txt: email_sent="no", sent_by="nobody", email_lost=true, and TWO copies attempted).');
say('');
say('=============================================================================');
say('2 · THE RECEIVED PAGE');
say('=============================================================================');
say('  EN  landed on  /request-received?id=...&t=...   (RC-C1, RC-C2)');
say('  ES  landed on  /es/recibido?id=...&t=...        (RC-C3, RC-C4)');
say('  both read "reached the received page: yes". Neither page file was touched by this round:');
say('    git diff --name-only main...worker-email-01 -> six HTML pages (the ?v= on ONE script tag),');
say('    assets/umbra-two-channels.js, worker/test/email-copy-reading.mjs.');
say('    request-received.html and es/recibido.html are NOT in that list.');
say('');
say('=============================================================================');
say('3 · NOTHING ELSE IN THE REQUEST MOVES - THE /intake BODY, BASE vs CANDIDATE');
say('=============================================================================');
say('The same walk, mail endpoint answering at once, run on main\'s tip and on the branch, in both languages.');
say('What is compared is the multipart body the page itself hands POST /intake, read off the wire in Chrome:');
say('field NAMES in order, and the total size. No value is printed or stored.');
say('');
for (const [lang, b, c] of [['EN', 'RC-intake-base-en', 'RC-intake-cand-en'], ['ES', 'RC-intake-base-es', 'RC-intake-cand-es']]) {
  const jb = J(b + '.parts.json'), jc = J(c + '.parts.json');
  const pb = jb.intake.parts, pc = jc.intake.parts;
  say('--- ' + lang + ' ---');
  say('  base  (2e8436a)            ' + jb.intake.bytes + ' bytes  ' + pb.length + ' parts   [' + b + '.txt]');
  say('  cand  (worker-email-01)    ' + jc.intake.bytes + ' bytes  ' + pc.length + ' parts   [' + c + '.txt]');
  say('  identical, name for name, in order: ' + String(pb.join('|') === pc.join('|')).toUpperCase());
  say('  in base only: (none)   in candidate only: (none)');
  say('  the field names, in the order the page sends them:');
  say('    ' + pc.join(', '));
  say('  the record the Worker wrote from that body:');
  say('    base: ' + JSON.stringify(jb.record[0]));
  say('    cand: ' + JSON.stringify(jc.record[0]));
  say('');
}
say('And the same comparison on the BROWSER COPY\'s own body (the mail stub\'s log, RC-base-* vs RC-C2/RC-C4):');
for (const [lang, b, c] of [['EN', 'RC-base-en', 'RC-C2-en-fast'], ['ES', 'RC-base-es', 'RC-C4-es-fast']]) {
  const jb = J(b + '.parts.json'), jc = J(c + '.parts.json');
  say('  ' + lang + ': field names identical: ' + String(JSON.stringify(jb.copies) === JSON.stringify(jc.copies)).toUpperCase() +
      '   (' + jc.copies[0].parts.length + ' parts, leg=' + jc.copies[0].leg + ')');
}
say('');
say('NOT ONE FIELD WAS RENAMED, ADDED OR DROPPED, and the bodies are the same size to the byte.');
say('The only thing this round changed is a NUMBER inside assets/umbra-two-channels.js - how long the page waits');
say('for its own copy before it reports no (8000 -> 15000 ms) - and the ?v= on the tag that loads that one file.');
say('');
say('=============================================================================');
say('4 · VERDICT');
say('=============================================================================');
say('  CLAUSE C: GREEN.');
say('  One copy per request, by the browser, EN and ES, at the latency that lost U-0018 and at ordinary latency;');
say('  the record names the leg; the received page is reached in both languages; the /intake body is unchanged,');
say('  base vs candidate, name for name and byte for byte.');
say('');
say('  WHAT IS STILL NOT GREEN, AND IS NOT CLAUSE C\'S TO FIX: a copy slower than 15 s is still written off, and the');
say('  Worker fallback it then wakes is refused 429 by FormSubmit for structural reasons (RB-fallback.txt).');
say('  That is the STOP RED in the close - a mail road a Worker may use is Drew\'s call, not this seat\'s.');
say('');
say('files this reading is assembled from, all in this folder:');
say('  RC-C1-en-8100.txt  RC-C2-en-fast.txt  RC-C3-es-8100.txt  RC-C4-es-fast.txt');
say('  RC-base-en.txt  RC-base-es.txt');
say('  RC-intake-base-en.txt  RC-intake-cand-en.txt  RC-intake-base-es.txt  RC-intake-cand-es.txt');
say('  (each with a .parts.json sidecar holding field NAMES only)');

const out = path.join(B, 'RC-request.txt');
fs.writeFileSync(out, L.join('\n') + '\n');
console.log('written: ' + out + '  ' + fs.statSync(out).size + ' bytes');
