/* SITE-FIX-01 · two words the first voice pass over-reached on: the door tile counts
   doors, not rooms, and the door's own answers say "won't" like a person.
   Run: node tools/site-fix-01-voice2.mjs */
import fs from 'node:fs';
const F = 'assets/umbra-chooser-data.js';
let s = fs.readFileSync(F, 'utf8');
const A = '’';
const E = [
  [`q: 'How many?', opts: ['1 room', '2–3 rooms', 'More than 3', NOT_SURE_EN]`,
   `q: 'How many?', opts: ['Just one', 'Two or three', 'More than three', NOT_SURE_EN]`],
  [`q: '¿Cuántas?', opts: ['1 cuarto', '2–3 cuartos', 'Más de 3', NOT_SURE_ES]`,
   `q: '¿Cuántas?', opts: ['Una', 'Dos o tres', 'Más de tres', NOT_SURE_ES]`],
  [`opts: ['Sticks', 'Will not latch', 'Will not close', 'Rubs the floor', NOT_SURE_EN]`,
   `opts: ['Sticks', 'Won${A}t latch', 'Won${A}t close', 'Rubs the floor', NOT_SURE_EN]`],
];
let n = 0;
for (const [a, b] of E) { if (!s.includes(a)) { console.log('MISS:', a.slice(0, 50)); continue; } s = s.split(a).join(b); n++; }
fs.writeFileSync(F, s);
console.log('edits applied:', n, 'of', E.length);
