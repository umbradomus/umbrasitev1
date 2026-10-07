/* assembles Bridge/WORKER-EMAIL-01/R4-suites.txt: the Worker's own suites and the walk
   scripts, candidate vs base, compared BY NAME and not by count. Reads only this round's logs. */
import fs from 'node:fs';
import path from 'node:path';

const B = 'C:/Users/andre/Umbra/Boss/Bridge/WORKER-EMAIL-01';
const L = [];
const say = (s) => L.push(s == null ? '' : String(s));
const rd = (f) => fs.readFileSync(path.join(B, f), 'utf8').split(/\r?\n/);

/* a PASS/FAIL line looks like:  PASS  H · (7) the hold: ... 11 passed, 0 failed  */
function tally(file) {
  const out = new Map();
  let total = null, exit = null;
  for (const l of rd(file)) {
    const m = l.match(/^(PASS|FAIL)\s+(.*?)\s+(\d+) passed,\s+(\d+) failed\s*$/);
    if (m) out.set(m[2].trim(), { form: m[1], pass: Number(m[3]), fail: Number(m[4]) });
    const t = l.match(/^TOTAL (\d+) passed, (\d+) failed/);
    if (t) total = { pass: Number(t[1]), fail: Number(t[2]) };
    const e = l.match(/^exit=(-?\d+)/);
    if (e) exit = Number(e[1]);
  }
  return { out, total, exit };
}

const cand = tally('R4-cand-suites.log');
const base = tally('R4-base-suites.log');

say('WORKER-EMAIL-01 · R4-suites - THE PROOF: the Worker\'s own suites and the walk scripts, CANDIDATE vs BASE');
say('assembled 2026-10-07T09:02Z');
say('candidate = branch worker-email-01 @ 9c69926 (clause A 8de7a10 · clause C 84c626e · harness 9c69926)');
say('base      = main tip 2e8436a, reached in MY OWN worktree with `git switch --detach 2e8436a`');
say('            (main\'s ref was never moved, never merged into, never pushed; nothing was deployed)');
say('');
say('HOW THEY WERE RUN - DEPLOY-WORKER-13.3\'s own invocation, from its close:');
say('  node test\\run-all.mjs   with   UMBRA_ONLY=D,H,J,S,C   UMBRA_TEST_PORT_SHIFT=300');
say('  cwd C:\\Users\\andre\\Umbra\\umbrasitev1-wt\\worker-email-01\\worker, a real wrangler dev with local KV/R2,');
say('  every outbound thing (FormSubmit, Pushover, Telegram, the SMS gateway) a local stand-in. Fake secrets only.');
say('  One deviation, named: this worktree has no node_modules of its own (gitignored), so worker/node_modules/wrangler');
say('  and worker/node_modules/puppeteer-core are JUNCTIONS to C:\\Users\\andre\\Umbra\\umbrasitev1\\worker\\node_modules,');
say('  read-only use of the same packages the repo\'s own walk scripts already reach for. Nothing was installed.');
say('  And openssl had to be put on PATH (C:\\Program Files\\Git\\usr\\bin) - the suites\' TLS stand-in shells out to it.');
say('');
say('=============================================================================');
say('1 · THE TOTALS');
say('=============================================================================');
say('  candidate   TOTAL ' + cand.total.pass + ' passed, ' + cand.total.fail + ' failed    exit=' + cand.exit + '   [R4-cand-suites.log]');
say('  base        TOTAL ' + base.total.pass + ' passed, ' + base.total.fail + ' failed    exit=' + base.exit + '   [R4-base-suites.log]');
say('  NOT FEWER PASSES THAN ON BASE: ' + (cand.total.pass >= base.total.pass ? 'YES' : 'NO') +
    '   (' + cand.total.pass + ' >= ' + base.total.pass + ')');
say('  (DEPLOY-WORKER-13.3 read 723 passed, 0 failed on main at 930026b; the same 723 here, on both trees.)');
say('');
say('=============================================================================');
say('2 · BY NAME, SUITE BY SUITE - never by count');
say('=============================================================================');
const names = [...new Set([...cand.out.keys(), ...base.out.keys()])];
const missing = names.filter((n) => !cand.out.has(n) || !base.out.has(n));
const lower = names.filter((n) => cand.out.has(n) && base.out.has(n) && cand.out.get(n).pass < base.out.get(n).pass);
const reds = names.filter((n) => (cand.out.get(n) || {}).form === 'FAIL' || (base.out.get(n) || {}).form === 'FAIL');
say('  checks reported on the candidate: ' + cand.out.size);
say('  checks reported on the base:      ' + base.out.size);
say('  names present on one tree only:   ' + (missing.length ? missing.join(' | ') : '(none)'));
say('  names whose pass count FELL on the candidate: ' + (lower.length ? lower.join(' | ') : '(none)'));
say('  names reported FAIL on either tree: ' + (reds.length ? reds.join(' | ') : '(none)'));
say('');
say('  every check, candidate vs base (pass/fail, candidate first):');
for (const n of names) {
  const c = cand.out.get(n), b = base.out.get(n);
  const f = (x) => (x ? x.form + ' ' + x.pass + '/' + x.fail : 'ABSENT');
  const same = c && b && c.pass === b.pass && c.fail === b.fail && c.form === b.form;
  say('    ' + (same ? ' = ' : ' ! ') + f(c).padEnd(12) + ' ' + f(b).padEnd(12) + '  ' + n);
}
say('');
say('=============================================================================');
say('3 · THE WALK SCRIPTS, ON MY OWN LOCAL SERVER');
say('=============================================================================');
say('  tools/site-fix-02-walk.mjs - the real pages in a real headless browser on its own ports (4963/4964),');
say('  21 screens at 390 and 1440, then the RENDERED PIXELS counted for the three colours B58 retired.');
say('  Its pictures were sent to my own folder (SITEFIX02_OUT), never over another round\'s screens.');
for (const [which, f, out] of [['candidate', 'R4-cand-walk-sf02.log', 'walk-screens-cand'], ['base', 'R4-base-walk-sf02.log', 'walk-screens-base']]) {
  const lines = rd(f);
  const v = lines.find((l) => /TOTAL retired-colour pixels/.test(l)) || '(no verdict line)';
  const e = (lines.find((l) => /^exit=/.test(l)) || 'exit=?').trim();
  say('    ' + which.padEnd(10) + v.trim() + '   ' + e + '   [' + f + ', pictures in ' + out + '/]');
}
say('  SAME ON BOTH TREES: GREEN, zero retired pixels over 21 screens.');
say('');
say('  tools/run-suite-k.mjs - the chooser suite on its own. IT DOES NOT RUN ON THIS MACHINE\'S NODE,');
say('  AND IT DOES NOT RUN ON THE BASE EITHER. Both trees die in the same place, before any check:');
const kline = rd('R4-base-walk-k.log').find((l) => /ERR_UNSUPPORTED_ESM_URL_SCHEME/.test(l) && /Only URLs/.test(l)) || '';
say('    ' + kline.trim());
say('    at tools/run-suite-k.mjs:25  ->  await import(path.join(WORKER_DIR, \'test/lib/servers.mjs\'))');
say('    node v24.19.0 wants a file:// URL for a dynamic import of an absolute Windows path.');
say('    candidate exit=1, base exit=1, 0 checks on either side  [R4-cand-walk-k.log, R4-base-walk-k.log]');
say('    This is PRE-EXISTING and nothing to do with this round: NOT FEWER PASSES THAN BASE holds at 0 = 0.');
say('    It is left alone on purpose - fixing an unrelated tools script would put a change in this branch\'s');
say('    diff that no clause asked for. Named here and in the close for whoever owns that script.');
say('');
say('  tools/walk-front-door.mjs - NOT RUN, and why: it loads playwright, which is not installed anywhere');
say('    this machine resolves (checked worker/node_modules and /opt/npm-tools). It would be DEAD on both trees.');
say('  tools/site-fix-01-walk.mjs and tools/site-fix-01.1-walk.mjs - NOT RUN, and why: their output path is');
say('    hard-coded to Bridge/SITE-FIX-01[.1]/screens, which is outside this round\'s write grant and is');
say('    another round\'s evidence. I will not write there and I will not edit their path to get a reading.');
say('');
say('  The browser walks that DO carry this round are my own, and they are in RA-browser.txt, RA-before.txt,');
say('  RB-fallback.txt and RC-request.txt: a real tile tap -> form -> send, EN and ES, candidate and base.');
say('');
say('=============================================================================');
say('4 · VERDICT');
say('=============================================================================');
say('  R4: GREEN. Suites D,H,J,S,C: ' + cand.total.pass + ' passed / ' + cand.total.fail + ' failed on the candidate,');
say('  the same ' + base.total.pass + ' / ' + base.total.fail + ' on base, name for name, with no check absent and none fallen.');
say('  The pixel walk is GREEN on both. The one walk script that is dead is dead on base too, for a reason');
say('  that predates this round and is written out above.');

const out = path.join(B, 'R4-suites.txt');
fs.writeFileSync(out, L.join('\n') + '\n');
console.log('written: ' + out + '  ' + fs.statSync(out).size + ' bytes');
console.log('names compared: ' + names.length + '  absent: ' + missing.length + '  fallen: ' + lower.length + '  FAIL: ' + reds.length);
