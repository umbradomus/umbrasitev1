/* SITE-FIX-01 · one screen on a phone. The band already carries the heading in the
   page itself (it works with JavaScript off); the lead under it says the one thing
   that matters and gets out of the way, so the heading and all eight tiles land on
   a single 390-wide screen. Curly apostrophes, like the rest of the site.
   Run: node tools/site-fix-01-oneScreen.mjs */
import fs from 'node:fs';
const A = '’';
const E = [
  ['services.html',
   `      <h2 id="request-top">Tell us what's wrong. We'll tell you what it takes.</h2>\n      <p class="lead">Tap what sounds like your house. No account, no email needed, and nothing is sent until you've looked it over.</p>`,
   `      <h2 id="request-top">Tell us what${A}s wrong. We${A}ll tell you what it takes.</h2>\n      <p class="lead">Tap anything that sounds like your house. Nothing is sent until you look it over.</p>`],
  ['es/servicios.html',
   `      <p class="lead">Toque lo que suene como su casa. Sin cuenta, sin correo, y no se manda nada hasta que usted lo revise.</p>`,
   `      <p class="lead">Toque lo que suene como su casa. No se manda nada hasta que usted lo revise.</p>`],
];
let n = 0;
for (const [f, a, b] of E) {
  const s = fs.readFileSync(f, 'utf8');
  if (!s.includes(a)) { console.log('MISS:', f); continue; }
  fs.writeFileSync(f, s.replace(a, b));
  n++; console.log('ok:', f);
}
console.log('edits applied:', n, 'of', E.length);
