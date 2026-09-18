/* WSS-03 — writes the drywall-holes intake block into services.html.

   The four per-place cards are identical apart from their place, so they are
   generated here rather than typed four times: a typo in one card's field name
   would be a silent hole in the record. Run once; the result is committed HTML.

   Every string below is lifted from the approved reference,
   Bridge\BIP\UMBRA\WSS\INTAKE-DRYWALL-HOLES-APPROVED-2026-09-18.html.        */
'use strict';
const fs = require('fs');
const path = require('path');

const EN = '–';   /* en dash, in the count bands */
const EM = '—';   /* em dash */

const PLACES = [
  { key: 'ceiling', label: 'Ceiling',                  z: 'z-ceiling' },
  { key: 'walls',   label: 'Walls',                    z: 'z-wall-back z-wall-side' },
  { key: 'corner',  label: 'Corner or edge',           z: 'z-edges' },
  { key: 'opening', label: 'Around a door or window',  z: 'z-open-door z-open-window' },
];

const COUNTS = ['1' + EN + '5', '6' + EN + '15', '16' + EN + '30', 'More than 30', 'Not sure ' + EM + ' you count'];
const SIZES = [['Pinhole', 4], ['Coin', 11], ['Golf ball', 20], ['Fist or larger', 30]];
const STATES = ['Open holes', 'Already patched but it shows', 'Still has a plastic anchor in it', 'Not sure'];
const SURF = ['Smooth', 'Textured', 'Not sure'];
const PROBLEMS = ['Holes to patch', 'Cracks', 'Water stain', 'A bad old patch', 'Just needs painting', 'Something else'];
const PAINT = ['Yes', 'No', 'Not sure'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* one chip. Every control ships disabled — see the header of umbra-intake.js. */
function chip(type, name, value, opts) {
  opts = opts || {};
  const attrs = [
    'type="' + type + '"',
    'name="' + name + '"',
    'value="' + esc(value) + '"',
  ];
  if (opts.data) for (const k of Object.keys(opts.data)) attrs.push('data-' + k + '="' + esc(opts.data[k]) + '"');
  if (opts.checked) attrs.push('checked');
  attrs.push('disabled');
  const dot = opts.dot ? '<i class="dot" style="width:' + opts.dot + 'px;height:' + opts.dot + 'px"></i>' : '';
  return '<li class="chip"><label><input ' + attrs.join(' ') + '><span>' + dot + esc(value) + '</span></label></li>';
}

function chipRow(type, name, values, pad, opts) {
  opts = opts || {};
  const items = values.map((v) => {
    const value = Array.isArray(v) ? v[0] : v;
    const dot = Array.isArray(v) ? v[1] : 0;
    return pad + '  ' + chip(type, name, value, { dot, checked: opts.checked === value });
  });
  return pad + '<ul class="chips">\n' + items.join('\n') + '\n' + pad + '</ul>';
}

function card(place, pad) {
  const p = place.key;
  const L = [];
  L.push(pad + '<div class="area" data-card="' + p + '" hidden>');
  L.push(pad + '  <h3><i class="pin"></i>' + esc(place.label) + '</h3>');
  L.push(pad + '  <p class="q">Roughly how many spots?</p>');
  L.push(pad + '  <p class="hint">An estimate is fine ' + EM + ' we count them on site.</p>');
  L.push(chipRow('radio', p + '_count_band', COUNTS, pad + '  '));
  L.push(pad + '  <div class="exact"><label>Exact number, if you know it:');
  L.push(pad + '    <input type="number" name="' + p + '_count_exact" min="0" inputmode="numeric" placeholder="' + EM + '" disabled></label></div>');
  L.push(pad + '  <p class="q">How big is the biggest one here?</p>');
  L.push(chipRow('radio', p + '_biggest', SIZES, pad + '  '));
  L.push(pad + '  <p class="q">What state are they in?</p>');
  L.push(pad + '  <p class="hint">Tap any that apply.</p>');
  L.push(chipRow('checkbox', p + '_condition', STATES, pad + '  '));
  L.push(pad + '  <p class="q">Smooth or textured?</p>');
  L.push(pad + '  <p class="hint">Run your hand over it. Textured takes longer to match.</p>');
  L.push(chipRow('radio', p + '_surface', SURF, pad + '  '));
  L.push(pad + '</div>');
  return L.join('\n');
}

/* The room, seen from inside. Copied byte for byte out of the approved reference,
   including the side-wall label rotated -13 degrees about its own anchor so it
   runs along the wall — Drew asked for that specifically. */
const ROOM = `          <div class="room">
            <svg viewBox="0 0 320 210" role="img" aria-label="A room seen from inside: ceiling, back wall, side wall, a door and a window">
              <polygon id="z-ceiling" class="zone" points="10,10 310,10 248,62 72,62"></polygon>
              <polygon id="z-wall-back" class="zone" points="72,62 248,62 248,150 72,150"></polygon>
              <polygon id="z-wall-side" class="zone" points="10,10 72,62 72,150 10,200"></polygon>
              <polygon points="72,150 248,150 310,200 10,200" fill="#D9D2C7" fill-opacity=".5" stroke="#D9D2C7" stroke-width="1.2"></polygon>
              <rect id="z-open-window" class="zone" x="100" y="80" width="52" height="40" rx="2"></rect>
              <polygon id="z-open-door" class="zone" points="196,78 232,72 232,150 196,150"></polygon>
              <g id="z-edges">
                <path class="edge" d="M72,62 L248,62"></path>
                <path class="edge" d="M72,62 L72,150"></path>
                <path class="edge" d="M248,62 L248,150"></path>
                <path class="edge" d="M10,10 L72,62"></path>
              </g>
              <text class="lbl" x="160" y="30" text-anchor="middle">ceiling</text>
              <text class="lbl" x="160" y="140" text-anchor="middle">wall</text>
              <!-- the side wall reads at an angle, so its label runs along the wall instead of sitting flat -->
              <text class="lbl" x="41" y="126" text-anchor="middle" transform="rotate(-13 41 126)">wall</text>
              <text class="lbl" x="126" y="104" text-anchor="middle">window</text>
              <text class="lbl" x="214" y="118" text-anchor="middle">door</text>
            </svg>
          </div>`;

function build() {
  const L = [];
  L.push('        <!-- WSS-03 · THE INTAKE THAT GIVES THE WORKER SOMETHING TO WORK WITH.');
  L.push('             Ported, not redesigned, from the file Drew approved on 2026-09-18:');
  L.push('             Bridge\\BIP\\UMBRA\\WSS\\INTAKE-DRYWALL-HOLES-APPROVED-2026-09-18.html.');
  L.push('             The reference\'s bottom two boxes — the JSON payload panel and the');
  L.push('             derived-scope list under it — are a demonstration built for Drew to');
  L.push('             judge the data by. They are not customer UI and they are deliberately');
  L.push('             NOT here, and their headings are not quoted here either, so a grep of');
  L.push('             this page for them comes back empty.');
  L.push('');
  L.push('             Every control below ships DISABLED and is enabled only when its own');
  L.push('             place is tapped, because a disabled control is never submitted. That is');
  L.push('             how a place nobody tapped posts no fields at all — not empty ones. With');
  L.push('             JavaScript off none of it is ever revealed or enabled, so the form stays');
  L.push('             exactly the form it was. -->');
  L.push('        <div class="intake" data-intake hidden>');

  /* step one — the problem, on the service tap */
  L.push('');
  L.push('          <div class="step" data-intake-problem hidden>');
  L.push('            <p class="q">What is it?</p>');
  L.push('            <p class="hint">Whichever is closest.</p>');
  L.push(chipRow('radio', 'problem', PROBLEMS, '            '));
  L.push('          </div>');

  /* step two — holes to patch: where, then one card per place */
  L.push('');
  L.push('          <div class="step" data-intake-holes hidden>');
  L.push('            <p class="q">Where is it?</p>');
  L.push('            <p class="hint">Tap any that apply.</p>');
  L.push(ROOM.replace(/^/gm, '  '));
  L.push('            <ul class="chips">');
  for (const p of PLACES) {
    L.push('              ' + chip('checkbox', 'problem_area', p.label, { data: { area: p.key, z: p.z } }));
  }
  L.push('            </ul>');
  L.push('');
  L.push('            <p class="q">Tell us about each place</p>');
  L.push('            <p class="hint">A few quick questions for each place.</p>');
  for (const p of PLACES) L.push(card(p, '            '));
  L.push('');
  L.push('            <p class="q">Do you have the leftover paint?</p>');
  L.push('            <p class="hint">An old can with the color name on it saves a trip.</p>');
  L.push(chipRow('radio', 'paint_on_site', PAINT, '            ', { checked: 'Not sure' }));
  L.push('');
  L.push('            <!-- The honesty gate, and it is in the data rather than in anyone\'s');
  L.push('                 judgement: every tapped place with a count means a price can be');
  L.push('                 generated with no guessing; one count left to us means NOT QUOTABLE');
  L.push('                 until we look. -->');
  L.push('            <p class="gate" data-gate hidden></p>');
  L.push('          </div>');
  L.push('        </div>');
  return L.join('\n');
}

const out = path.join(__dirname, '_wss03-intake-block.html');
fs.writeFileSync(out, build() + '\n', 'utf8');
console.log('wrote ' + out + ' (' + build().split('\n').length + ' lines)');
