/* FLUX-ROUTE-01 · the printed QR's addresses serve the front door from a real file, so they can
   never 404 on a config change. A real file can drift from the door it copies. This check is the
   thing that stops it: /services must be byte-identical to /request, and /es/servicios to
   /es/solicitud. Nothing else in the repo asserts it. */
import { readFileSync } from 'node:fs';
const PAIRS = [
  ['services.html', 'request/index.html', '/services (his printed QR)', '/request'],
  ['es/servicios.html', 'es/solicitud/index.html', '/es/servicios (his printed Spanish QR)', '/es/solicitud'],
];
let pass = 0, fail = 0;
for (const [alias, door, aName, dName] of PAIRS) {
  const name = 'door-alias-' + alias.replace(/[/.]/g, '-');
  let a, d;
  try { a = readFileSync(alias); d = readFileSync(door); }
  catch (e) { console.log('FAIL  ' + name + '  - cannot read: ' + e.message); fail++; continue; }
  if (a.equals(d)) { console.log('PASS  ' + name + '  - ' + aName + ' serves the same bytes as ' + dName + ' (' + a.length + ')'); pass++; }
  else { console.log('FAIL  ' + name + '  - ' + aName + ' has drifted from ' + dName + ' (' + a.length + ' vs ' + d.length + ' bytes)'); fail++; }
}
console.log('\n--- RESULT ---');
console.log('RESULT: ' + (fail ? 'FAIL' : 'PASS') + '  pass ' + pass + '  fail ' + fail);
process.exit(fail ? 1 : 0);
