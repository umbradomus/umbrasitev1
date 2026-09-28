/* SITE-FIX-01 · the words as a person says them. The ignite's heading is quoted
   exactly; the rest of the English loses the stilted "will not / what is" the first
   pass left behind, and the paint tile's answers are the ones the amend names.
   Run: node tools/site-fix-01-voice.mjs */
import fs from 'node:fs';

const F = 'assets/umbra-chooser-data.js';
let s = fs.readFileSync(F, 'utf8');
const was = s.length;
const A = '’';   /* the curly apostrophe the rest of the site uses */
let n = 0;

const EDITS = [
  /* the ignite's own heading, word for word */
  ["heading: 'Tell us what is wrong. We will tell you what it takes.'",
   `heading: 'Tell us what${A}s wrong. We${A}ll tell you what it takes.'`],
  ["whileHeading: 'While we are there — tap anything that sounds like your house.'",
   `whileHeading: 'While we${A}re there — tap anything that sounds like your house.'`],
  ["replyBy: 'We will reply by '", `replyBy: 'We${A}ll reply by '`],
  ["sTiles: 'What is wrong'", `sTiles: 'What${A}s wrong'`],
  ["sWhile: 'While we are there'", `sWhile: 'While we${A}re there'`],
  ["'It is urgent'", `'It${A}s urgent'`],

  /* A4b names these five answers. They must be there to be tapped. */
  ["opts: ['1', '2–3', 'More', NOT_SURE_EN]", "opts: ['1 room', '2–3 rooms', 'More than 3', NOT_SURE_EN]"],
  ["opts: ['1', '2–3', 'Mas', NOT_SURE_ES]", "opts: ['1 cuarto', '2–3 cuartos', 'Más de 3', NOT_SURE_ES]"],
  ["opts: ['Match what is there', 'A new colour', 'Help me choose', NOT_SURE_EN]",
   `opts: ['Match what${A}s there', 'A new colour', 'Help me choose', NOT_SURE_EN]`],
  ["q: 'What is wrong with it now?', opts: ['Peeling or stained', 'A repair spot that does not match', 'Just tired', 'A new look', NOT_SURE_EN]",
   `q: 'What${A}s wrong with it now?', opts: ['Peeling or stained', 'A repair spot that doesn${A}t match', 'Just tired', 'A new look', NOT_SURE_EN]`],

  /* the rest of the English, said out loud */
  ["label: 'A door, cabinet or window that sticks, will not latch or will not close'",
   `label: 'A door, cabinet or window that sticks, won${A}t latch or won${A}t close'`],
  ["en: 'The whole run from a step back, then up close at the spot that is wrong.'",
   `en: 'The whole run from a step back, then up close at the spot that${A}s wrong.'`],
  ["sub: 'If it is not ours, we say so straight away'", `sub: 'If it${A}s not ours, we say so straight away'`],
  ["'A door that drags or will not stay shut'", `'A door that drags or won${A}t stay shut'`],
];

for (const [from, to] of EDITS) {
  if (!s.includes(from)) { console.log('MISS:', from.slice(0, 60)); continue; }
  s = s.split(from).join(to);
  n++;
}
fs.writeFileSync(F, s);
console.log('edits applied:', n, 'of', EDITS.length, '| bytes', was, '->', s.length);
