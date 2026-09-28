/* SITE-FIX-01 · the review said "0" where it meant "no photos yet". Words, not a count.
   Run: node tools/site-fix-01-photowords.mjs */
import fs from 'node:fs';
const F = 'assets/umbra-chooser-data.js';
let s = fs.readFileSync(F, 'utf8');
const E = [
  [`      photoOf: 'Photo ',`, `      photoOf: 'Photo ',\n      photosNone: 'No photos yet — one photo saves us both a visit',\n      photoOne: '1 photo',\n      photoMany: ' photos',`],
  [`      photoOf: 'Foto ',`, `      photoOf: 'Foto ',\n      photosNone: 'Todavía sin fotos — una foto nos ahorra una visita a los dos',\n      photoOne: '1 foto',\n      photoMany: ' fotos',`],
];
let n = 0;
for (const [a, b] of E) { if (!s.includes(a)) { console.log('MISS:', a); continue; } s = s.replace(a, b); n++; }
fs.writeFileSync(F, s);
console.log('edits applied:', n, 'of', E.length);
