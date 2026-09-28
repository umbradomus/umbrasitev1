/* SITE-FIX-01 · the word edits, applied once. Kept so the close can name exactly
   what changed and the next round can read it. Run: node tools/site-fix-01-words.mjs */
import fs from 'node:fs';

const EDITS = [
  ['services.html',
    "Doors that stick or won't latch, trim, steps, decks, fences, rotted wood, and the small jobs nobody else will come out for.",
    "Doors that stick or won't latch, trim, steps, deck boards and rails, fence repairs, rotted wood, and the small jobs nobody else will come out for."],
  ['es/servicios.html',
    'Puertas que se atoran o no cierran, molduras, escalones, terrazas, cercas, madera podrida, y los trabajitos que nadie más quiere venir a hacer.',
    'Puertas que se atoran o no cierran, molduras, escalones, tablas y barandales de terraza, reparación de cercas, madera podrida, y los trabajitos que nadie más quiere venir a hacer.'],
];

let done = 0;
for (const [file, from, to] of EDITS) {
  const s = fs.readFileSync(file, 'utf8');
  if (!s.includes(from)) { console.log('ALREADY / MISSING:', file); continue; }
  fs.writeFileSync(file, s.split(from).join(to));
  console.log('rewritten:', file);
  done++;
}
console.log('edits applied:', done);
