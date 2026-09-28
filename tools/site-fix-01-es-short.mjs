/* SITE-FIX-01 · three Spanish tile labels ran to three lines on a 390-wide phone and
   pushed the eighth tile off the one screen the ignite asks for. The words that were
   doing the least move to the second line, which the phone hides and the desktop
   still shows. Nothing is dropped from the meaning.
   Run: node tools/site-fix-01-es-short.mjs */
import fs from 'node:fs';
const F = 'assets/umbra-chooser-data.js';
let s = fs.readFileSync(F, 'utf8');
const E = [
  [`label: 'Una puerta, un gabinete o una ventana que se atora, no cierra o no pega',`,
   `label: 'Una puerta, gabinete o ventana que se atora o no cierra',`],
  [`label: 'Afuera — canaletas, una cerca o un portón, el jardín o los arriates',`,
   `label: 'Afuera — canaletas, cerca, portón o jardín',`],
  [`label: 'Zonas sin Wi-Fi, enchufes inteligentes, focos inteligentes, sensores de fugas',`,
   `label: 'Wi-Fi, enchufes y focos inteligentes, sensores de fugas',`],
  [`sub: 'Incluye la puerta del gabinete que quedó chueca' }`,
   `sub: 'Incluye la que no pega y la puerta del gabinete chueca' }`],
];
let n = 0;
for (const [a, b] of E) { if (!s.includes(a)) { console.log('MISS:', a.slice(0, 55)); continue; } s = s.replace(a, b); n++; }
fs.writeFileSync(F, s);
console.log('edits applied:', n, 'of', E.length);
