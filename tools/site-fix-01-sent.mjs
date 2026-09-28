/* SITE-FIX-01 · the thank-you pages say the same list back, read-only.
   A3: "The sent screen thanks by name, repeats the 2-hour promise, and keeps the
   same list under it read-only ('This is what we got')."
   Run: node tools/site-fix-01-sent.mjs */
import fs from 'node:fs';

const PAGES = [
  ['request-received.html', '<div class="sent" id="sent" hidden>'],
  ['es/recibido.html', null],
];

const SCRIPTS = `<!-- SITE-FIX-01 · the same list the review screen showed, said back read-only.
     It comes from this tab's own memory, never from the address and never from the Worker. -->
<script src="/assets/umbra-chooser-data.js?v=1" defer></script>
<script src="/assets/umbra-chooser.js?v=1" defer></script>
<script src="/assets/umbra-sent.js?v=1"></script>`;

for (const [file] of PAGES) {
  let s = fs.readFileSync(file, 'utf8');
  const was = s.length;

  if (!s.includes('umbra-chooser.js')) {
    s = s.replace('<script src="/assets/umbra-sent.js?v=1"></script>', SCRIPTS);
  }

  /* the read-only list goes inside the same note the promise lives in */
  if (!s.includes('data-got')) {
    const anchor = '<div class="sent" id="sent" hidden>';
    if (s.includes(anchor)) {
      s = s.replace(anchor, '<div class="sent" data-got hidden></div>\n        ' + anchor);
    } else {
      console.log('NO ANCHOR in', file, '- add by hand');
    }
  }

  fs.writeFileSync(file, s);
  console.log('ok:', file, was, '->', s.length);
}
