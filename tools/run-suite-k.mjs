/* FRONT-DOOR-01 · SUITE K ON ITS OWN. worker/test/run-all.mjs needs a real `wrangler dev`;
   suite K (the chooser, worker/test/suite-k-chooser.mjs) does not — it reads the served pages
   and what the form POSTS to a stand-in FormSubmit. This stands up exactly the three things
   run-all gives it: a TLS relay reached as https://formsubmit.co, a static copy of this tree
   with the Worker constant flipped to '' (so nothing can reach production), and a browser.
   Readings and the tally are run-all's own shape. Nothing here talks to the internet.
   Run:  node tools/run-suite-k.mjs        (UMBRA_K_SITE=siteOld + UMBRA_ORIGINAL_SITE=<tree> for the old tree) */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(HERE, '..');
const WORKER_DIR = path.join(REPO_DIR, 'worker');
const require = createRequire(import.meta.url);
function need(name) {
  for (const c of [name, path.join(WORKER_DIR, 'node_modules', name), '/opt/npm-tools/node_modules/' + name]) {
    try { return require(c); } catch (e) { /* next */ }
  }
  throw new Error(name + ' is not installed (npm i in worker/, or set NODE_PATH)');
}
const puppeteer = need('puppeteer-core');
const { captureServer, staticServer, close } = await import(path.join(WORKER_DIR, 'test/lib/servers.mjs'));
const { suiteChooser } = await import(path.join(WORKER_DIR, 'test/suite-k-chooser.mjs'));

const SHIFT = Number(process.env.UMBRA_TEST_PORT_SHIFT || 0);
const P = (n) => n + SHIFT;
const PORT = { formsubmitTls: P(4771), siteNew: P(4774), siteOld: P(4775), extraD: P(4779) };
const CHROME = process.env.UMBRA_TEST_CHROME || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const ORIGINAL_SITE = process.env.UMBRA_ORIGINAL_SITE || REPO_DIR;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'umbra-suite-k-'));

const SKIP = ['worker', '.git', 'node_modules', '_git-stale-locks-2026-09-06', 'Claude outputs', 'tools'];
function copyTree(from, to, skip = []) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyTree(a, b, skip);
    else if (e.isFile()) fs.copyFileSync(a, b);
  }
}
const ONE_LINE = /^window\.UMBRA_WORKER_BASE = '[^'\r\n]*';[ \t]*$/m;
function flipConstant(root, base) {
  const f = path.join(root, 'assets', 'umbra-endpoint.js');
  if (!fs.existsSync(f)) return;
  const before = fs.readFileSync(f, 'utf8');
  const after = before.replace(ONE_LINE, () => `window.UMBRA_WORKER_BASE = '${base}';`);
  if (after !== before) fs.writeFileSync(f, after);
}
const siteNew = path.join(TMP, 'site-new'), siteOld = path.join(TMP, 'site-old');
copyTree(REPO_DIR, siteNew, SKIP); flipConstant(siteNew, '');
/* FRONT-DOOR-01: the Spanish home page no longer carries a form (it is the menu; the form is on
   /es/servicios), and K (13) still walks to /es for one. With UMBRA_K_ES_STANDIN=1 the TEST COPY
   serves the Spanish form page at /es as well, so readings 14-16 can run to their end here. It is
   said out loud below, and it never touches this tree. The suite's own line is for the Worker's
   owner to re-point. */
if (process.env.UMBRA_K_ES_STANDIN === '1') {
  fs.copyFileSync(path.join(siteNew, 'es', 'servicios.html'), path.join(siteNew, 'es', 'index.html'));
  console.log('STAND-IN: the test copy serves es/servicios.html at /es too (UMBRA_K_ES_STANDIN=1) — K (13) "es/index" reads the form page, not the home page');
}
copyTree(ORIGINAL_SITE, siteOld, SKIP); flipConstant(siteOld, '');

const suites = new Map();
let current = null;
function suite(name) { current = name; if (!suites.has(name)) suites.set(name, { pass: 0, fail: 0, notes: [] }); console.log('\n' + name); }
function ok(cond, label, detail) {
  const s = suites.get(current);
  if (cond) { s.pass++; console.log(`  ✓ ${label}`); }
  else { s.fail++; s.notes.push(label + (detail ? ' — ' + detail : '')); console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
  return Boolean(cond);
}
function eq(a, b, label) { return ok(a === b, label, a === b ? '' : `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const relay = await captureServer({ port: PORT.formsubmitTls, tls: true, tlsDir: TMP });
const sn = await staticServer({ port: PORT.siteNew, root: siteNew });
const so = await staticServer({ port: PORT.siteOld, root: siteOld });
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    `--host-resolver-rules=MAP formsubmit.co 127.0.0.1:${PORT.formsubmitTls}, MAP *.workers.dev ~NOTFOUND`,
    '--ignore-certificate-errors', '--no-proxy-server'],
});
let readings = null;
try {
  readings = await suiteChooser({ browser, relay, suite, ok, eq, sleep, PORT, REPO_DIR });
} catch (err) {
  suite('K · the suite ran to its end');
  ok(false, 'suite K stopped early — every reading after this point did NOT run', String(err && err.stack || err).slice(0, 600));
} finally {
  try { await browser.close(); } catch (e) { /* gone */ }
  await Promise.all([close(relay), close(sn), close(so)]);
}
let pass = 0, fail = 0;
console.log('\n==================== SUITE K');
for (const [name, s] of suites) {
  pass += s.pass; fail += s.fail;
  console.log(`${s.fail ? 'FAIL' : ' ok '}  ${name}  (${s.pass} ok, ${s.fail} failed)`);
  for (const n of s.notes) console.log('        ' + n);
}
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — ${pass} ok, ${fail} failed · site ${process.env.UMBRA_K_SITE || 'siteNew'} · ${TMP}`);
if (readings) fs.writeFileSync(path.join(TMP, 'chooser-readings.json'), JSON.stringify(readings, null, 2));
process.exit(fail === 0 ? 0 : 1);
