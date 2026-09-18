/* WSS-03 — splices the generated intake block and the R17d photo wording into
   services.html. Exact-anchor edits only: every replacement below asserts it
   matched exactly once, so a moved line fails loudly instead of landing twice
   or silently not at all. */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const page = path.join(root, 'services.html');
const block = fs.readFileSync(path.join(__dirname, '_wss03-intake-block.html'), 'utf8').replace(/\n$/, '');

let src = fs.readFileSync(page, 'utf8');

function once(find, replace, what) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(what + ': expected 1 match, found ' + n);
  src = src.replace(find, () => replace);
  console.log('  ok  ' + what);
}

/* 1 — load the intake script beside the endpoint script. `defer` because it
       reads the form, and the endpoint script above it runs in the head. */
once(
  '<script src="/assets/umbra-endpoint.js?v=2"></script>',
  '<script src="/assets/umbra-endpoint.js?v=2"></script>\n' +
  '<!-- WSS-03 · the drywall-holes intake: the service tap reveals the problem row, and\n' +
  '     "Holes to patch" reveals one card per place tapped. -->\n' +
  '<script src="/assets/umbra-intake.js?v=1" defer></script>',
  'intake script tag',
);

/* 2 — the block itself, directly under the service chips it is revealed by. */
once(
  '        <p class="fine" style="margin:0">All three fields are required.</p>',
  block + '\n\n        <p class="fine" style="margin:0">All three fields are required.</p>',
  'intake block',
);

/* 3 — `what` gets handles so the script can demote it once the taps carry the
       description. With JavaScript off it keeps the label and the `required` it
       has today. */
once(
  "<label>What's wrong? <small>A sentence is enough. Where it is and what it's doing.</small>",
  "<label><span data-what-label>What's wrong?</span> <small data-what-hint>A sentence is enough. Where it is and what it's doing.</small>",
  'what handles',
);

/* 4 — the photo block's wording, exactly as R17d gives it, above the existing
       picker. Nothing else about photos changes: the shrink, the detach, the
       thumbnails and one-file-per-field are untouched. */
const PHOTO_ANCHOR = '        <label>Photos of the problem';
once(
  PHOTO_ANCHOR,
  '        <!-- R17d · the photo block\'s final wording. Line 1 is deliberately per-surface\n' +
  '             rather than "the whole wall or ceiling": it scales the photo count to the\n' +
  '             size of the job. Line 3 removes the fear of sending too many, which is the\n' +
  '             thing that actually holds a customer to two photos. -->\n' +
  '        <p class="hint" style="margin-bottom:.35rem">Turn the light on. The more we can see, the tighter the price — often with no visit at all.</p>\n' +
  '        <ol class="guide">\n' +
  '          <li><b>One shot of each wall or ceiling with spots on it.</b> Stand back so the whole surface is in frame.</li>\n' +
  '          <li><b>A close-up of the worst one.</b> Put a coin or a pen next to it so we can see the size.</li>\n' +
  '          <li><b>Anything else that helps.</b> More is fine — we would rather have too many than too few.</li>\n' +
  '        </ol>\n' +
  PHOTO_ANCHOR,
  'R17d photo wording',
);

fs.writeFileSync(page, src, 'utf8');
console.log('services.html written (' + src.split('\n').length + ' lines)');
