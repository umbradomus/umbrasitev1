import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { start } from './rig.mjs';

const PHOTOS = ['/tmp/ph1.jpg', '/tmp/ph2.jpg'];
const results = [];
function say(name, pass, detail) { results.push({ name, pass, detail }); console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '\n        ' + detail : '')); }

async function run({ label, workerDown = false, js = true, photos = true }) {
  const rig = await start({ workerDown });
  const url = 'http://127.0.0.1:' + rig.port;
  const rig2 = rig;

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ javaScriptEnabled: js });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(url + '/services', { waitUntil: 'domcontentloaded' });

  if (js) {
    await page.check('input[name="service"][value="Drywall & Paint"]');
    await page.check('input[name="problem"][value="Holes to patch"]');
    await page.check('input[name="problem_area"][data-area="ceiling"]');
    await page.check('input[name="ceiling_count_band"][value="6–15"]');
    await page.fill('input[name="ceiling_count_exact"]', '15');
  }
  await page.fill('input[name="name"]', 'R28 DONE-TEST — not a customer');
  await page.fill('input[name="phone"]', '(956) 556-6438');
  await page.fill('input[name="address"]', 'R28 done-test, Brownsville TX');
  await page.fill('textarea[name="what"]', 'R28 two-channel done-test. Not a real request.');
  if (photos && js) await page.setInputFiles('input[name="attachment"]', PHOTOS);

  await page.click('button[type="submit"]').catch(() => {});
  await page.waitForTimeout(6000);
  const out = { label, email: rig2.log.email.slice(), worker: rig2.log.worker.slice(), errs };
  await browser.close();
  rig2.server.close();
  return out;
}

const names = r => r.parts.map(p => p.name);
const files = r => r.parts.filter(p => p.filename).map(p => p.filename);

(async () => {
  /* ---- 1 · WORKER UP ------------------------------------------------- */
  let r = await run({ label: 'worker up' });
  say('worker up · exactly one email', r.email.length === 1, 'emails=' + r.email.length + ' worker-posts=' + r.worker.length);
  say('worker up · the email came from the BROWSER, not the worker fallback', r.email.length === 1 && !r.email[0].via, 'via=' + (r.email[0] && r.email[0].via || 'browser'));
  say('worker up · the worker post carries email_sent=yes', r.worker.length === 1 && names(r.worker[0]).includes('email_sent'), 'worker fields: ' + (r.worker[0] ? names(r.worker[0]).join(',') : '-'));
  if (r.email[0]) {
    const n = names(r.email[0]);
    say('worker up · THE EMAIL CARRIES EVERYTHING — the intake answers', ['problem','problem_area','ceiling_count_band','ceiling_count_exact','paint_on_site','name','phone','address','what'].every(k => n.includes(k)), n.join(','));
    say('worker up · THE EMAIL CARRIES THE PHOTOS', files(r.email[0]).length === 2, 'files: ' + files(r.email[0]).join(', ') + ' · ' + r.email[0].bytes + ' bytes');
    say('worker up · the email is matchable to the record', n.includes('browser_copy_id') && n.includes('sent_by'), n.filter(x=>/browser_copy_id|sent_by/.test(x)).join(','));
  }
  say('worker up · no page errors', r.errs.length === 0, r.errs.join(' | '));

  /* ---- 2 · WORKER DEAD — THE CLAUSE THE ROUND EXISTS FOR -------------- */
  r = await run({ label: 'worker dead', workerDown: true });
  say('⬛ WORKER AT A DEAD HOST · AN EMAIL STILL ARRIVES', r.email.length === 1, 'emails=' + r.email.length + ' worker-posts=' + r.worker.length);
  say('⬛ WORKER AT A DEAD HOST · exactly one, and it carries the photos', r.email.length === 1 && files(r.email[0]).length === 2, r.email[0] ? files(r.email[0]).join(', ') : 'none');

  /* ---- 2b · NO PHOTOS — the submit that never reaches the photo block ---- */
  r = await run({ label: 'no photos', photos: false });
  say('no photos · exactly one email, and it still carries the answers', r.email.length === 1 && r.worker.length === 1 && names(r.email[0]).includes('ceiling_count_exact'), 'emails=' + r.email.length + ' worker-posts=' + r.worker.length);
  say('no photos · the worker post still carries email_sent', r.worker.length === 1 && names(r.worker[0]).includes('email_sent'), (r.worker[0] ? names(r.worker[0]).filter(x=>/email_/.test(x)).join(',') : '-'));

  /* ---- 3 · JAVASCRIPT OFF -------------------------------------------- */
  r = await run({ label: 'js off', js: false, photos: false });
  say('javascript off · exactly one email, straight to the relay', r.email.length === 1 && r.worker.length === 0, 'emails=' + r.email.length + ' worker-posts=' + r.worker.length);

  const failed = results.filter(x => !x.pass);
  console.log('\n' + (failed.length ? 'RED — ' + failed.length + ' of ' + results.length + ' failed' : 'GREEN — ' + results.length + '/' + results.length));
  process.exit(failed.length ? 1 : 0);
})();
