/* THE STAND-IN RUNTIME'S MODULE HOOKS — CONFIRM-01, 2026-10-04. Test-only; nothing here ships.

   `wrangler dev` cannot be installed on every machine (the sandbox this round was built in has no road to the npm
   registry at all), and the Worker's own code imports two things Node cannot resolve on its own:
     · `cloudflare:workers` (quotebook.js's DurableObject base class) — mapped here to node-worker-shim.mjs
     · `../admin.html` as text (wrangler's `rules = [{ type = "Text" }]`) — loaded here as a string default export
   Everything else the Worker imports is plain ES modules and Web APIs Node 22 already has.

   Registered by node-worker.mjs through module.register(). It changes how the Worker is LOADED, never what it does. */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHIM = new URL('./node-worker-shim.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: SHIM, shortCircuit: true };
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (/\.html$/.test(url)) {
    const text = fs.readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module', source: 'export default ' + JSON.stringify(text) + ';', shortCircuit: true };
  }
  return nextLoad(url, context);
}
