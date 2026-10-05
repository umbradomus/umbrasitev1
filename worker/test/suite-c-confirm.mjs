/* SUITE C · THE BOOKING CONFIRMATION TEXT (CONFIRM-01, 2026-10-04).

   THE DEFECT IT PROVES FIXED: U-0015 booked a time on the quote page at 07:46 on 2026-10-01 and got nothing — the
   confirmation text was built to go only from the owner's own program on his tap. Now the website sends it itself.

   Against the Worker over HTTP (a real `wrangler dev`, or the Node stand-in in lib/node-worker.mjs when wrangler cannot
   be installed), the fake Pushover / Telegram stub, and the contract fake of SMSGate's cloud server on 127.0.0.1
   (lib/servers.mjs). NOTHING IS EVER SENT. Every moment is named (x-umbra-test-now, ?now=), so a night and a morning are
   walked in seconds. Every request is invented: invented names, the 956-555-03xx range nobody else in this suite uses
   (a STOP in reading (4) goes on THAT number's list and must not touch any other reading's).

   The readings, each RED on main (the Worker before this round sends no text and carries no `confirmation`):
     (1) a daytime booking by the page → exactly ONE POST to the fake SMSGate, the right words, the right number;
         `confirmation.state = sent` on GET /admin/quote/<id>, on /api/jobs, in the export; the page says "I'll text you
         the day before."; a texted YES (POST /admin/quote/<id>/accept) gets its one text too; no second text on the
         next cron ticks
     (2) a booking at 9:01 PM → nothing at once (`queued`), nothing at 9:05 PM, 11 PM or 6:59 AM; ONE POST at 7:00 AM;
         nothing more at 7:01 or 7:05
     (3) no consent (the texts box unticked) → no POST, `no_consent`
     (4) STOP on file (a signed STOP through SMSGate's webhook) → no POST, `no_consent` (why `stop`)
     (5) the fake SMSGate answering 500 → `failed`, the booking still booked and scheduled, no second POST on the next ticks
     (6) a Spanish quote → the Spanish words
     (7) no SMSGATE_AUTH on the Worker (a second Worker without it) → no POST at all, `no_key`, and his phone is told
         "Booking U-xxxx: no texting key on the website — confirm them yourself"
     (8) a booking cancelled while its text waits for 7:00 → nothing goes at 7:00

   Dates: every booked day is in November 2026 (CST — DST ended Nov 1), so no reading here collides with the other
   suites' bookings (September, October, December). Each reading is returned with its actual values, for the close. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chicagoWall } from '../src/biztime.js';

export async function suiteConfirm({ W, stub, gate, ADMIN_KEY, FAKE, FAKE_SMSGATE_AUTH, FAKE_WEBHOOK_KEY, suite, ok, eq, json, sleep, SITE, PORT, TMP, WORKER_DIR, wlogRef, secondWorker = null }) {
  const R = {};
  const CT = (y, mo, d, h, mi = 0) => new Date(chicagoWall(y, mo, d, h, mi)).toISOString();
  const win = (date, start, end) => ({ date, start, end });
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const H = (now) => ({ 'content-type': 'application/json', ...(now ? { 'x-umbra-test-now': now } : {}) });
  const base = (w) => w || W;

  /* ---------------------------------------------------------------- the stand-ins */
  const PO = () => stub.captured
    .filter((c) => c.method === 'POST' && c.url === '/pushover/1/messages.json')
    .map((c) => Object.assign(c, { p: new URLSearchParams(c.body.toString('utf8')) }));
  const gatePosts = () => gate.requests.filter((r) => r.method === 'POST' && r.path === '/3rdparty/v1/messages');
  const bodyOf = (r) => { try { return JSON.parse(r.body); } catch (e) { return null; } };
  /* the confirmation POSTs for one job: their id is <U-id>-confirm-v<version>, minted once */
  const confirmsFor = (id) => gatePosts().filter((r) => { const b = bodyOf(r); return b && String(b.id || '').startsWith(id + '-confirm-'); });

  /* ---------------------------------------------------------------- the Worker */
  const admin = (method, p, body, now, w) => json(`${base(w)}${p}?k=${ADMIN_KEY}`, { method, headers: H(now), body: body === undefined ? undefined : JSON.stringify(body) });
  const create = (id, body, now, w) => admin('POST', `/admin/quote/${id}`, body, now, w);
  const acceptQ = (id, version, option, now, w) => admin('POST', `/admin/quote/${id}/accept`, { version, option }, now, w);
  const cancelQ = (id, version, now, w) => admin('POST', `/admin/quote/${id}/cancel`, { version }, now, w);
  const stateQ = (id, now, w) => admin('GET', `/admin/quote/${id}`, undefined, now, w);
  const hook = (name, body, now, w) => json(`${base(w)}/__${name}?k=${ADMIN_KEY}`, { method: 'POST', headers: H(now), body: JSON.stringify(body || {}) }).then((r) => r.body);
  const byCode = (code, version, option, now, by = 'page', w) => hook('book-by-code', { code, version, option, by }, now, w);
  const reconcileAt = (now, w) => hook('reconcile', {}, now, w);
  const runAlertsAt = (now, w) => json(`${base(w)}/__run-alerts?k=${ADMIN_KEY}&now=${encodeURIComponent(now)}`, { method: 'POST' }).then((r) => r.body);
  /* one cron tick, as the scheduled handler runs it: the alert ladder, then the reconcile */
  const tick = async (now, w) => { await runAlertsAt(now, w); return reconcileAt(now, w); };
  const jobs = async (w) => (await json(`${base(w)}/api/jobs?k=${ADMIN_KEY}`)).body.jobs;
  const row = async (id, w) => (await jobs(w)).find((j) => j.id === id);
  const md = async (id, w) => (await fetch(`${base(w)}/api/export/${id}.md?k=${ADMIN_KEY}`)).text();
  const record = (id, w) => json(`${base(w)}/__record/${id}?k=${ADMIN_KEY}`, { method: 'POST' }).then((r) => r.body);
  /* the customer's page, GET straight from the Worker (what the site's rewrite proxies to) */
  const getPage = async (code, now, w) => { const r = await fetch(`${base(w)}/q/${code}`, { headers: { 'x-umbra-test-now': now } }); return { status: r.status, text: await r.text() }; };
  /* the customer's tap, as the browser posts it: same-origin, the site's Origin */
  const postPage = async (code, fields, now, w) => {
    const r = await fetch(`${base(w)}/q/${code}`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SITE, 'sec-fetch-site': 'same-origin', 'x-umbra-test-now': now },
      body: new URLSearchParams(fields).toString(),
    });
    return { status: r.status, location: r.headers.get('location') };
  };
  const textOf = (html) => String(html || '').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

  /* SMSGate's webhook, signed the way SMSGate signs it (suite P's helper): hex HMAC-SHA256(key, raw body + X-Timestamp) */
  let ev = 700;
  async function textIn(iso, e164, message) {
    const raw = JSON.stringify({ deviceId: 'fake-device-0001', event: 'sms:received', id: 'fake-ev-c' + (++ev), payload: { messageId: 'fake-msg-c' + ev, message, phoneNumber: e164, simNumber: 1, receivedAt: iso }, webhookId: 'fake-webhook-01' });
    const ts = Math.floor(Date.parse(iso) / 1000);
    const sig = crypto.createHmac('sha256', String(FAKE_WEBHOOK_KEY || 'x')).update(raw + String(ts)).digest('hex');
    const r = await fetch(`${W}/hooks/smsgate`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-umbra-test-now': iso, 'x-signature': sig, 'x-timestamp': String(ts) } });
    let body = null; try { body = await r.json(); } catch (e) { body = null; }
    return { status: r.status, body };
  }

  /* an invented request; `consent` false leaves the texts box unticked (the request form's "Text me about this request") */
  let serial = 300;
  async function submit(iso, name, { consent = true, lang = 'en', w = null } = {}) {
    serial++;
    const phone = '(956) 555-0' + String(serial).padStart(3, '0');
    const fd = new FormData();
    fd.set('_subject', 'Service request from umbradomus.com');
    fd.set('_next', 'https://www.umbradomus.com/request-received');
    fd.set('service', 'Drywall & Paint');
    fd.set('name', name);
    fd.set('phone', phone);
    fd.set('address', `${serial} Confirm Court, Brownsville`);
    fd.set('what', `An invented hole over the invented window, request ${serial}.`);
    fd.set('email_sent', 'yes');
    fd.set('avail_form', 'v1'); fd.set('avail_flexible', 'yes');
    fd.set('sms_consent_lang', lang); fd.set('sms_consent_version', 'sms-v2');
    if (consent) fd.set('sms_consent', 'yes');
    const r = await fetch(`${base(w)}/intake`, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
    const u = r.headers.get('location') ? new URL(r.headers.get('location')) : null;
    const id = u && u.searchParams.get('id');
    if (!id) throw new Error('fixture submission failed for ' + name + ' (status ' + r.status + ')');
    /* acknowledged at once, so the intake ladder never pushes during these readings */
    await fetch(`${base(w)}/admin/seen/${id}?k=${ADMIN_KEY}`, { method: 'POST', headers: { 'x-umbra-test-now': iso } });
    await sleep(300);
    return { id, phone, e164: '+1' + phone.replace(/\D/g, ''), name };
  }
  const Q = (version, windows, extra = {}) => ({
    version, price: 395,
    scope: ['Patch the hole over the window and re-texture to match', 'Prime the patch and spot-paint it, feathered'],
    included: 'Paint for the color match is included. Cleanup included.',
    guarantee: 'If anything is not right, I come back and fix it.',
    insurance: 'Insured: $1M general liability. Certificate on request.',
    windows, lang: 'en', ...extra,
  });
  /** a request with its quote made and marked sent at `iso`; answers { id, code, phone, e164, name } */
  async function quoted(iso, name, windows, { consent = true, lang = 'en', extra = {}, w = null } = {}) {
    const who = await submit(iso, name, { consent, lang, w });
    const c = await create(who.id, Q(1, windows, { sent_at: iso, lang, ...extra }), iso, w);
    if (c.status !== 201) throw new Error('fixture quote failed for ' + name + ': ' + JSON.stringify(c.body));
    return { ...who, code: c.body.code };
  }
  const confirmationOf = async (id, now, w) => ((await stateQ(id, now, w)).body || {}).confirmation || null;
  /* /api/jobs' word on it, null-safe so a Worker without the field (main) fails the reading instead of stopping the suite */
  const kvState = async (id, w) => ((((await row(id, w)) || {}).confirmation) || {}).state || null;

  const MON = [2026, 11, 2];                 /* Mon 2 Nov 2026, CST */
  const T10 = CT(...MON, 10, 0);

  /* ============================================================ (1) */
  suite('C · (1) a daytime booking: ONE text to the customer, the right words, sent on the state, the page says so');
  {
    const a = await quoted(T10, 'Cora Vell', [win('2026-11-09', '08:00', '10:00')]);
    const g0 = gatePosts().length;
    const at = CT(...MON, 10, 5);
    const p = await postPage(a.code, { v: 1, w: 1 }, at);
    eq(p.status, 303, 'the tap on Accept & confirm answers 303 back to the page');
    const mine = confirmsFor(a.id);
    eq(mine.length, 1, 'exactly ONE POST reached the fake SMSGate for this booking');
    const b = mine[0] ? bodyOf(mine[0]) : null;
    eq(b && JSON.stringify(b.phoneNumbers), JSON.stringify([a.e164]), 'to the customer\'s own number, E.164');
    eq(b && b.id, a.id + '-confirm-v1', 'the message id is <U-id>-confirm-v1, minted once');
    const text = b && b.textMessage ? b.textMessage.text : '';
    const WANT = "You're booked with Umbra Domus: Mon Nov 9, 8-10 AM. Price $395 flat. We'll text the day before and when we're on the way. Reply STOP to opt out. - Drew";
    eq(text, WANT, 'the words: "You\'re booked with Umbra Domus: Mon Nov 9, 8-10 AM. Price $395 flat. We\'ll text the day before and when we\'re on the way. Reply STOP to opt out. - Drew"');
    ok(text.length <= 320 && text.length > 0, `under 320 characters (${text.length})`);
    ok(!/\b(licensed|bonded)\b/i.test(text), 'never "licensed" or "bonded" (R33)');
    eq(mine[0] && mine[0].authUser, FAKE_SMSGATE_AUTH.split(':')[0], 'with the SMSGATE_AUTH pair, as every text (the fake logs the user only)');
    ok(mine[0] && typeof b.validUntil === 'string' && Date.parse(b.validUntil) <= chicagoWall(...MON, 21), 'validUntil no later than 9:00 PM that day');
    const c = await confirmationOf(a.id, at);
    eq(c && c.state, 'sent', 'GET /admin/quote/<id> → confirmation.state = sent');
    eq(c && c.id, a.id + '-confirm-v1', 'confirmation.id = the gateway message id');
    eq(c && c.sha, sha(WANT), 'confirmation.sha = sha256 of the words');
    eq(c && c.at, at, 'confirmation.at = the booking\'s moment');
    const st = (await stateQ(a.id, at)).body;
    eq(st.current && st.current.confirmation && st.current.confirmation.state, 'sent', 'and on the booked version itself');
    const kv = await row(a.id);
    eq(kv && kv.confirmation && kv.confirmation.state, 'sent', '/api/jobs carries confirmation.state = sent');
    eq(kv && kv.confirmation && kv.confirmation.version, 1, 'with the version it belongs to');
    eq(kv && kv.status, 'scheduled', 'the booking is scheduled');
    const rec = await record(a.id);
    eq((rec.events || []).filter((e) => e.type === 'confirmation').length, 1, 'one `confirmation` event on the record');
    ok((await md(a.id)).includes('**Confirmation text** | sent by the website'), 'the markdown export says "Confirmation text · sent by the website"');
    const pg = await getPage(a.code, CT(...MON, 10, 6));
    const t = textOf(pg.text);
    ok(t.includes("You're booked.") && t.includes('Mon 11/9') && t.includes('$395') && t.includes("I'll text you the day before."),
      'the customer\'s page: "You\'re booked." · Mon 11/9 · $395 · "I\'ll text you the day before."');
    /* the next cron ticks: the row is settled, nothing more goes */
    await tick(CT(...MON, 10, 7)); await tick(CT(...MON, 10, 12));
    eq(confirmsFor(a.id).length, 1, 'still exactly one POST after the next cron ticks (never a second send)');
    /* the same tap again (a refresh re-posting): already_booked, nothing more */
    await postPage(a.code, { v: 1, w: 1 }, CT(...MON, 10, 13));
    eq(confirmsFor(a.id).length, 1, 'the same tap again writes nothing and sends nothing');
    /* no customer detail in the push to his phone */
    const leak = PO().filter((x) => (x.p.get('title') || '').includes(a.id)).filter((x) => /Cora|Vell|555-0|Confirm Court/.test(x.p.get('title') + x.p.get('message')));
    eq(leak.length, 0, 'no push to his phone carries the name, number or address');

    /* a texted YES he marks: the same step, the same one text */
    const b2 = await quoted(CT(...MON, 10, 20), 'Dax Orrin', [win('2026-11-10', '13:00', '15:00')]);
    const at2 = CT(...MON, 10, 25);
    const r2 = await acceptQ(b2.id, 1, 1, at2);
    eq(r2.status, 200, 'POST /admin/quote/<id>/accept (a texted YES) → 200');
    eq(r2.body && r2.body.state, 'booked', 'booked');
    eq(r2.body && r2.body.confirmation && r2.body.confirmation.state, 'sent', 'the answer carries confirmation.state = sent');
    const m2 = confirmsFor(b2.id);
    eq(m2.length, 1, 'exactly ONE POST for the texted YES too');
    const t2 = m2[0] ? (bodyOf(m2[0]).textMessage || {}).text : '';
    ok(t2.includes('Tue Nov 10, 1-3 PM'), `the words name Tue Nov 10, 1-3 PM ("${t2.slice(0, 60)}…")`);
    eq((await confirmationOf(b2.id, at2) || {}).state, 'sent', 'state sent');
    R['1'] = { page: { job: a.id, posts: mine.length, text, chars: text.length, to: b && b.phoneNumbers, id: b && b.id, state: c, kv: kv && kv.confirmation }, text_yes: { job: b2.id, posts: m2.length, text: t2 }, gate_posts_before: g0 };
  }

  /* ============================================================ (2) */
  suite('C · (2) a booking at 9:01 PM: queued, nothing until 7:00 AM, then ONE text');
  {
    const a = await quoted(T10, 'Elin Marr', [win('2026-11-11', '08:00', '10:00')]);
    const night = CT(...MON, 21, 1);
    const r = await byCode(a.code, 1, 1, night, 'page');
    eq(r.state, 'booked', 'booked at 9:01 PM');
    eq(confirmsFor(a.id).length, 0, 'nothing reached the fake SMSGate at once');
    const q = await confirmationOf(a.id, night);
    eq(q && q.state, 'queued', 'confirmation.state = queued');
    eq(q && q.send_at, CT(2026, 11, 3, 7, 0), 'send_at = 7:00 AM tomorrow, Central');
    eq(await kvState(a.id), 'queued', '/api/jobs says queued');
    for (const t of [CT(...MON, 21, 5), CT(...MON, 23, 0), CT(2026, 11, 3, 3, 0), CT(2026, 11, 3, 6, 59)]) await tick(t);
    eq(confirmsFor(a.id).length, 0, 'nothing at 9:05 PM, 11 PM, 3 AM or 6:59 AM');
    const seven = CT(2026, 11, 3, 7, 0);
    const rc = await tick(seven);
    const mine = confirmsFor(a.id);
    eq(mine.length, 1, 'ONE POST at the 7:00 AM tick');
    eq(mine[0] && bodyOf(mine[0]).id, a.id + '-confirm-v1', 'the same minted id');
    const c = await confirmationOf(a.id, seven);
    eq(c && c.state, 'sent', 'state sent');
    eq(c && c.at, seven, 'at 7:00 AM');
    eq(c && c.queued_at, night, 'queued_at keeps the booking\'s own moment (9:01 PM)');
    eq(await kvState(a.id), 'sent', '/api/jobs says sent (the same run stamped it)');
    await tick(CT(2026, 11, 3, 7, 1)); await tick(CT(2026, 11, 3, 7, 5));
    eq(confirmsFor(a.id).length, 1, 'still one after 7:01 and 7:05');
    R['2'] = { job: a.id, booked_at: night, queued: q, sent: c, posts: mine.length, reconcile_at_seven: rc && rc.confirmed };
  }

  /* ============================================================ (3) */
  suite('C · (3) no consent: no text, no_consent on the state');
  {
    const a = await quoted(T10, 'Fenn Idris', [win('2026-11-12', '08:00', '10:00')], { consent: false });
    const at = CT(...MON, 11, 0);
    const r = await byCode(a.code, 1, 1, at, 'page');
    eq(r.state, 'booked', 'booked');
    eq(confirmsFor(a.id).length, 0, 'no POST reached the fake SMSGate');
    const c = await confirmationOf(a.id, at);
    eq(c && c.state, 'no_consent', 'confirmation.state = no_consent');
    eq(await kvState(a.id), 'no_consent', '/api/jobs says no_consent (the Flux shows "they didn\'t opt in to texts — call them")');
    eq(((await row(a.id)) || {}).status, 'scheduled', 'the booking itself is scheduled');
    await tick(CT(...MON, 11, 1)); await tick(CT(2026, 11, 3, 7, 0));
    eq(confirmsFor(a.id).length, 0, 'and nothing goes later either');
    ok((await md(a.id)).includes('they did not opt in to texts'), 'the export says they did not opt in');
    R['3'] = { job: a.id, state: c, posts: 0 };
  }

  /* ============================================================ (4) */
  suite('C · (4) STOP on file: no text');
  {
    const a = await quoted(T10, 'Gale Rook', [win('2026-11-13', '08:00', '10:00')]);
    const stop = await textIn(CT(...MON, 10, 30), a.e164, 'STOP');
    eq(stop.status, 200, 'their STOP reached the webhook');
    eq(stop.body && stop.body.stop, true, 'and was read as a STOP');
    const g1 = gatePosts().length;
    const at = CT(...MON, 11, 10);
    const r = await byCode(a.code, 1, 1, at, 'page');
    eq(r.state, 'booked', 'the booking still goes through');
    eq(confirmsFor(a.id).length, 0, 'no confirmation POST for an opted-out number');
    eq(gatePosts().length - g1, 0, 'no POST of any kind since the booking');
    const c = await confirmationOf(a.id, at);
    eq(c && c.state, 'no_consent', 'confirmation.state = no_consent');
    eq(c && c.why, 'stop', 'why = stop');
    await tick(CT(2026, 11, 3, 7, 0));
    eq(confirmsFor(a.id).length, 0, 'nothing at 7:00 AM either');
    R['4'] = { job: a.id, state: c, stop: stop.body };
  }

  /* ============================================================ (5) */
  suite('C · (5) the gateway answers 500: failed, the booking stands, never a retry');
  {
    const a = await quoted(T10, 'Hollis Brand', [win('2026-11-16', '08:00', '10:00')]);
    gate.state.mode = '500';
    const at = CT(...MON, 11, 20);
    let r, c, kv;
    try {
      r = await byCode(a.code, 1, 1, at, 'page');
      eq(r.state, 'booked', 'booked, though the text failed');
      eq(confirmsFor(a.id).length, 1, 'exactly one POST was made');
      c = await confirmationOf(a.id, at);
      eq(c && c.state, 'failed', 'confirmation.state = failed');
      eq(c && c.status, 500, 'with the gateway\'s status');
      kv = await row(a.id);
      eq(kv && kv.status, 'scheduled', 'the booking is scheduled on the record');
      eq(kv && kv.accept && kv.accept.window && kv.accept.window.date, '2026-11-16', 'with its day');
      eq(kv && kv.confirmation && kv.confirmation.state, 'failed', '/api/jobs says failed');
      for (const t of [CT(...MON, 11, 21), CT(...MON, 11, 25), CT(2026, 11, 3, 7, 0)]) await tick(t);
      eq(confirmsFor(a.id).length, 1, 'no second POST on the next cron ticks — a failed text is never retried');
    } finally {
      gate.state.mode = 'ok';
    }
    /* a timeout is the other unknown: the fake hangs, the Worker's own twenty seconds end it, failed, never again */
    R['5'] = { job: a.id, state: c, posts: confirmsFor(a.id).length, record_status: kv && kv.status };
  }

  /* ============================================================ (6) */
  suite('C · (6) a Spanish quote: Spanish words');
  {
    const a = await quoted(T10, 'Inés Robledo', [win('2026-11-17', '14:00', '16:00')], { lang: 'es' });
    const at = CT(...MON, 11, 30);
    const r = await byCode(a.code, 1, 1, at, 'page');
    eq(r.state, 'booked', 'booked');
    const mine = confirmsFor(a.id);
    eq(mine.length, 1, 'one POST');
    const text = mine[0] ? (bodyOf(mine[0]).textMessage || {}).text : '';
    const WANT = 'Su cita con Umbra Domus quedo confirmada: mar 17 nov, 2-4 p.m. Precio $395 fijo. Le escribimos el dia anterior y cuando vayamos en camino. Responda STOP para no recibir mensajes. - Drew';
    eq(text, WANT, 'the Spanish words, folded to GSM-7 (quedo, dia)');
    ok(!/booked|Price|text the day/.test(text), 'no English in it');
    ok(text.length <= 320, `under 320 characters (${text.length})`);
    const c = await confirmationOf(a.id, at);
    eq(c && c.lang, 'es', 'confirmation.lang = es');
    const pg = textOf((await getPage(a.code, CT(...MON, 11, 31))).text);
    /* CONFIRM-02: the promise is SITE-FIX-03's booked line (booked_promise), said once; CONFIRM-01's own
       "Le escribimos el día anterior." on booked_done gave way to it, so the screen does not say it twice */
    ok(pg.includes('Le enviaremos un mensaje de texto el día anterior.'), 'the Spanish page says "Le enviaremos un mensaje de texto el día anterior."');
    ok(!pg.includes("I'll text you the day before."), 'and no English promise on it');
    /* a two-visit option: each visit on its own line */
    const two = await quoted(CT(...MON, 11, 40), 'Jory Quist', [win('2026-11-18', '08:00', '10:00')], { extra: { options: [{ windows: [win('2026-11-18', '08:00', '10:00'), win('2026-11-19', '11:00', '13:00')] }] } });
    await byCode(two.code, 1, 1, CT(...MON, 11, 45), 'page');
    const t2 = confirmsFor(two.id)[0] ? (bodyOf(confirmsFor(two.id)[0]).textMessage || {}).text : '';
    eq(t2, "You're booked with Umbra Domus:\nWed Nov 18, 8-10 AM\nThu Nov 19, 11 AM-1 PM\nPrice $395 flat. We'll text the day before and when we're on the way. Reply STOP to opt out. - Drew", 'a two-visit option lists each visit on its own line');
    R['6'] = { job: a.id, text, two_visit: { job: two.id, text: t2 } };
  }

  /* ============================================================ (8) */
  suite('C · (8) a booking cancelled while its text waits for 7:00: nothing goes at 7:00');
  {
    const a = await quoted(T10, 'Kit Salas', [win('2026-11-20', '08:00', '10:00')]);
    const night = CT(...MON, 22, 0);
    await byCode(a.code, 1, 1, night, 'page');
    eq((await confirmationOf(a.id, night) || {}).state, 'queued', 'queued at 10 PM');
    const cx = await cancelQ(a.id, 1, CT(...MON, 22, 30));
    eq(cx.status, 200, 'withdrawn at 10:30 PM');
    await tick(CT(2026, 11, 3, 7, 0)); await tick(CT(2026, 11, 3, 7, 1));
    eq(confirmsFor(a.id).length, 0, 'no text at 7:00 AM for a booking that was freed');
    R['8'] = { job: a.id, posts: 0 };
  }

  /* ============================================================ (7) */
  suite('C · (7) no SMSGATE_AUTH on the Worker: no call, no_key, his phone is told');
  {
    let second = null, WN = null, stop = async () => {};
    const port = PORT.extraB, inspector = PORT.extraD;
    try {
      if (secondWorker) {
        second = await secondWorker({ SMSGATE_AUTH: '', SEED_LAST_ID: '800' }, port);
        WN = second.W; stop = second.stop;
      } else {
        /* a second `wrangler dev` with a .dev.vars that has every secret but SMSGATE_AUTH (suite I's way) */
        const DIR = path.join(TMP, 'confirm-nokey');
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(path.join(DIR, '.dev.vars'), [
          `ADMIN_KEY=${ADMIN_KEY}`, ...Object.entries(FAKE).map(([k, v]) => `${k}=${v}`),
          `PUSHOVER_API_BASE=http://127.0.0.1:${PORT.stub}/pushover`, `TELEGRAM_API_BASE=http://127.0.0.1:${PORT.stub}/telegram`,
          `FORMSUBMIT_ENDPOINT=http://127.0.0.1:${PORT.stub}/formsubmit`, `SITE_BASE_URL=${SITE}`, `PUBLIC_BASE_URL=http://127.0.0.1:${port}`,
          'IGNORE_NEXT_ORIGIN=true', 'ALLOW_TEST_HOOKS=true', `SMSGATE_API_BASE=http://127.0.0.1:${PORT.smsgate}`, `QUOTE_LINK_BASE=${SITE}`, '',
        ].join('\n'));
        const cfg = path.join(DIR, 'wrangler.nokey.toml');
        fs.writeFileSync(cfg, `
name = "umbra-intake-nokey-test"
main = ${JSON.stringify(path.join(WORKER_DIR, 'src', 'index.js'))}
base_dir = ${JSON.stringify(WORKER_DIR)}
compatibility_date = "2025-06-01"
rules = [ { type = "Text", globs = ["**/*.html"], fallthrough = false } ]
[vars]
SEED_LAST_ID = "800"
[[kv_namespaces]]
binding = "RECORDS"
id = "test-records-nokey"
[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "umbra-job-photos-nokey-test"
[[durable_objects.bindings]]
name = "BOOK"
class_name = "QuoteBook"
[[migrations]]
tag = "v1"
new_sqlite_classes = ["QuoteBook"]
`);
        const wr = spawn(process.execPath,
          [path.join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--config', cfg, '--port', String(port), '--ip', '127.0.0.1',
            '--inspector-port', String(inspector), '--local', '--log-level', 'warn', '--persist-to', path.join(DIR, 'state')],
          { cwd: WORKER_DIR, env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
        let wlog = '';
        wr.stdout.on('data', (d) => { wlog += d; }); wr.stderr.on('data', (d) => { wlog += d; });
        WN = `http://127.0.0.1:${port}`;
        let up = false;
        for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(WN + '/health')).ok; } catch (e) { /* not yet */ } if (!up) await sleep(500); }
        ok(up, `the no-key Worker came up on ${port}`, up ? '' : wlog.slice(-600));
        stop = async () => { wr.kill('SIGTERM'); await new Promise((r) => (wr.exitCode !== null ? r() : wr.once('exit', r))); };
      }
      const a = await quoted(T10, 'Lior Vance', [win('2026-11-09', '14:00', '16:00')], { w: WN });
      const g0 = gatePosts().length, p0 = PO().length;
      const at = CT(...MON, 12, 0);
      const r = await byCode(a.code, 1, 1, at, 'page', WN);
      eq(r.state, 'booked', 'booked');
      eq(gatePosts().length - g0, 0, 'no call reached the gateway at all');
      const c = await confirmationOf(a.id, at, WN);
      eq(c && c.state, 'no_key', 'confirmation.state = no_key');
      const pushes = PO().slice(p0).filter((x) => (x.p.get('title') || '').startsWith('Booking ' + a.id));
      eq(pushes.length, 1, 'his phone got one push');
      eq(pushes[0] && pushes[0].p.get('title'), `Booking ${a.id}: no texting key on the website — confirm them yourself`, 'titled "Booking U-xxxx: no texting key on the website — confirm them yourself"');
      ok(pushes[0] && !/Lior|Vance|555-0|Confirm Court/.test(pushes[0].p.get('title') + pushes[0].p.get('message')), 'and it carries no name, number or address');
      eq(await kvState(a.id, WN), 'no_key', '/api/jobs says no_key');
      await tick(CT(...MON, 12, 1), WN);
      eq(gatePosts().length - g0, 0, 'still no call after the next tick');
      R['7'] = { job: a.id, state: c, push_title: pushes[0] && pushes[0].p.get('title') };
    } finally {
      await stop();
    }
  }

  return R;
}
