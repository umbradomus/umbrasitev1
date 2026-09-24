/* SUITE J · HIS TABLE, THE HOLDING TEXT AND THE SECOND CLOCK (REMINDERS-01, 2026-09-24).

   Readings (1) to (11) against the real `wrangler dev`, the fake Pushover and Telegram from suite D, and
   a contract fake of SMSGate's cloud server on 127.0.0.1 (lib/servers.mjs — the shape of
   Bridge\FC-TEXT-01\fake-smsgate.mjs). NOTHING IS EVER SENT: not a push, not a text, not a call to any
   real service. Every moment is named through the gated test hooks (x-umbra-test-now on a submission,
   ?now= on the cron body), so two hours of his clock are walked in seconds of wall time.

   The requests are hand-built and invented — invented names, the 956-555-0xxx range the other suites
   use, invented words. The SMSGate pair is FAKE and made fresh for each run of the suite.

   Each reading is returned with its actual values, for the round's close. */

import { chicagoWall } from '../src/biztime.js';

export async function suiteReminders({ W, stub, gate, ADMIN_KEY, FAKE, FAKE_SMSGATE_AUTH, suite, ok, eq, json, sleep }) {
  /* UMBRA_J="6" runs one reading of this suite and skips the rest. It exists for the mutant pass: a
     mutant must be RED on one named reading, and walking all of his table seven times over to see it
     would take the best part of an hour. Unset — every ordinary run, and the run whose count goes in a
     close — every reading runs, in order. (4) also runs when (7) or (11) is asked for, and (2) when
     (11) is: those two read what the earlier ones left behind. */
  const JONLY = process.env.UMBRA_J ? new Set(process.env.UMBRA_J.split(',').map((x) => x.trim())) : null;
  const want = (k) => !JONLY || JONLY.has(k);
  const R = {};
  const CT = (y, mo, d, h, mi) => new Date(chicagoWall(y, mo, d, h, mi)).toISOString();
  const FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true });
  const DAYFMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  const HOUR23 = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hourCycle: 'h23' });
  const hhmm = (iso) => FMT.format(new Date(iso)).replace(/[  ]/g, ' ');
  const day = (iso) => DAYFMT.format(new Date(iso));
  const at = (iso) => `${day(iso)} ${hhmm(iso)}`;
  const hourOf = (iso) => Number(HOUR23.format(new Date(iso)));
  const closeOf = (iso) => { const p = day(iso).split('-').map(Number); return chicagoWall(p[0], p[1], p[2], 21); };
  const toClose = (iso) => Math.max(0, Math.round((closeOf(iso) - Date.parse(iso)) / 1000));

  /* ---------------------------------------------------------------- the stand-ins */
  const titleOf = (c) => (c.p ? c.p.get('title') : c.j.text.split('\n')[0]);
  const textOf = (c) => (c.p ? c.p.get('title') + '\n' + c.p.get('message') : c.j.text);
  const PO = () => stub.captured
    .filter((c) => c.method === 'POST' && c.url === '/pushover/1/messages.json')
    .map((c) => Object.assign(c, { p: new URLSearchParams(c.body.toString('utf8')) }));
  const TG = () => stub.captured
    .filter((c) => c.method === 'POST' && /^\/telegram\/bot[^/]+\/sendMessage$/.test(c.url))
    .map((c) => Object.assign(c, { j: JSON.parse(c.body.toString('utf8')) }));
  const CANCELS = () => stub.captured.filter((c) => c.method === 'POST' && c.url.startsWith('/pushover/1/receipts/cancel_by_tag/'));
  /* the 7 AM summary names several jobs at once; a reading counts a request's OWN pushes */
  const SUMMARYISH = /^(MORNING SUMMARY|QUOTE BEFORE YOU LEAVE)/;
  const mine = (id) => PO().filter((c) => textOf(c).includes(id) && !SUMMARYISH.test(titleOf(c)));
  const theirs = (id) => TG().filter((c) => textOf(c).includes(id));

  const mark = () => ({ po: PO().length, tg: TG().length, cancels: CANCELS().length, gate: gate.requests.length });
  const since = (m) => ({ po: PO().slice(m.po), cancels: CANCELS().slice(m.cancels), gate: gate.requests.slice(m.gate) });
  const gatePosts = (from = 0) => gate.requests.slice(from).filter((r) => r.method === 'POST' && r.path === '/3rdparty/v1/messages');
  const gateGets = (from = 0) => gate.requests.slice(from).filter((r) => r.method === 'GET');
  const bodyOf = (r) => { try { return JSON.parse(r.body); } catch (e) { return null; } };

  /* a push, as the close prints it: the run's own named moment, the title and the priority */
  const shot = (c) => ({
    run: c.runNow ? hhmm(c.runNow) : 'on arrival',
    title: c.p.get('title'),
    priority: Number(c.p.get('priority')),
    ...(c.p.get('expire') ? { expire: Number(c.p.get('expire')), retry: Number(c.p.get('retry')) } : {}),
  });

  /* ---------------------------------------------------------------- the Worker */
  const H = (now) => ({ 'content-type': 'application/json', ...(now ? { 'x-umbra-test-now': now } : {}) });
  const admin = (method, p, body, now) => json(`${W}${p}?k=${ADMIN_KEY}`, { method, headers: H(now), body: body === undefined ? undefined : JSON.stringify(body) });

  async function submit(iso, f) {
    const fd = new FormData();
    fd.set('_subject', 'Service request from umbradomus.com');
    fd.set('_next', 'https://www.umbradomus.com/request-received');
    fd.set('service', 'Drywall & Paint');
    for (const [k, v] of Object.entries(f)) { if (Array.isArray(v)) for (const x of v) fd.append(k, x); else fd.set(k, v); }
    const r = await fetch(`${W}/intake`, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
    const u = r.headers.get('location') ? new URL(r.headers.get('location')) : null;
    return { status: r.status, id: u && u.searchParams.get('id'), token: u && u.searchParams.get('t') };
  }
  /* an invented request that ticked the texts box */
  let serial = 20;
  const who = (name, lang = 'en', extra = {}) => ({
    avail_form: 'v1', avail_flexible: 'yes',
    sms_consent: 'yes', sms_consent_lang: lang, sms_consent_version: 'sms-v2',
    name, phone: '(956) 555-0' + String(++serial).padStart(3, '0'),
    address: `${serial} Invented Lane, Brownsville`,
    what: `An invented crack over the invented door, request ${serial}.`,
    ...extra,
  });

  async function runAt(iso) {
    const before = PO().length;
    const r = (await json(`${W}/__run-alerts?k=${ADMIN_KEY}&now=${encodeURIComponent(iso)}`, { method: 'POST' })).body;
    for (const c of PO().slice(before)) c.runNow = iso;
    return r;
  }
  /** every `step` minutes from one moment to another, as the cron would. */
  async function walk(fromIso, toIso, step = 5) {
    for (let t = Date.parse(fromIso); t <= Date.parse(toIso); t += step * 60000) await runAt(new Date(t).toISOString());
  }
  const record = (id) => json(`${W}/__record/${id}?k=${ADMIN_KEY}`, { method: 'POST' }).then((r) => r.body);
  const poke = (id, patch) => json(`${W}/__poke/${id}?k=${ADMIN_KEY}`, { method: 'POST', headers: H(), body: JSON.stringify(patch) }).then((r) => r.body);
  const bookDump = () => json(`${W}/__book-dump?k=${ADMIN_KEY}`, { method: 'POST', headers: H(), body: '{}' }).then((r) => r.body);
  const tap = (id, type, when) => admin('POST', `/api/job/${id}/event`, { type, at: when }, when);
  const noText = (id, when) => json(`${W}/admin/no-text/${id}?k=${ADMIN_KEY}`, { method: 'POST', headers: H(when) });
  const md = (id) => fetch(`${W}/api/export/${id}.md?k=${ADMIN_KEY}`).then((r) => r.text());
  const win = (date, start, end) => ({ date, start, end });
  const Q = (version, windows) => ({
    version, price: 395,
    scope: ['Patch the holes in the ceiling and re-texture to match', 'Prime every patch and spot-paint it, feathered'],
    included: 'Paint for the color match is included. Cleanup included.',
    guarantee: 'If anything is not right, I come back and fix it.',
    insurance: 'Insured: $1M general liability. Certificate on request.',
    windows, lang: 'en',
  });

  /* what no push and no Telegram message may ever carry */
  const leaks = (c) => {
    const t = textOf(c) + '\n' + (c.p ? [...c.p.entries()].filter(([k]) => !['token', 'user', 'callback'].includes(k)).map(([, v]) => v).join('\n') : JSON.stringify(c.j));
    const found = [];
    if (/https?:\/\/|www\./i.test(t)) found.push('link');
    if (t.includes(ADMIN_KEY)) found.push('admin key');
    for (const [k, v] of Object.entries(FAKE)) if (k !== 'TELEGRAM_CHAT_ID' && t.includes(v)) found.push(k);
    for (const half of FAKE_SMSGATE_AUTH.split(':')) if (t.includes(half)) found.push('smsgate key');
    if (/\+1\d{10}|555-?0\d{3}|\(956\)/.test(t)) found.push('phone');
    if (/Invented Lane/.test(t)) found.push('address');
    if (/it's Drew with Umbra Domus|soy Drew de Umbra Domus/.test(t)) found.push("the text's words");
    return found;
  };

  /* Start clean: every request the earlier suites left open comes off the board, so the runs below see
     only their own. The ALERTS-01-shaped ones stop on /admin/seen; the table-shaped ones do not stop on
     an acknowledgement at all, so those get the no-text tap instead. */
  {
    const jobs = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.jobs;
    for (const j of jobs) {
      if (j.status !== 'received') continue;
      await fetch(`${W}/admin/seen/${j.id}?k=${ADMIN_KEY}`, { method: 'POST' });
      if (j.alerts && j.alerts.table) await noText(j.id);
    }
  }

  const DAY_A = [2026, 9, 28];      /* Monday */
  const DAY_B = [2026, 9, 29];
  const DAY_C = [2026, 9, 30];
  const DAY_D = [2026, 10, 1];

  /* ============================================================ (1) THE TABLE */
  if (want('1')) {
  suite('J · (1) his table — every 15, then every 10, then every 5');
  {
    const t0 = CT(...DAY_A, 9, 0);
    const a = await submit(t0, who('Table Tessa'));
    eq(a.status, 303, '(1) the request lands');
    await sleep(1800);                         /* the arrival push goes on the customer's way out */
    const arrival = mine(a.id);
    eq(arrival.length, 1, '(1) minute 0: the arrival push, as before');
    eq(titleOf(arrival[0]), `NEW REQUEST ${a.id} · quote due 11:00 AM`, '(1) and it names the due time');
    const m = mark();
    await walk(CT(...DAY_A, 9, 5), CT(...DAY_A, 10, 55));
    const pushes = mine(a.id).slice(1).map(shot);
    const want = ['9:15 AM', '9:30 AM', '9:45 AM', '10:00 AM', '10:10 AM', '10:20 AM', '10:30 AM', '10:35 AM', '10:40 AM', '10:45 AM', '10:50 AM', '10:55 AM'];
    eq(JSON.stringify(pushes.map((p) => p.run)), JSON.stringify(want), '(1) twelve pushes, at exactly his twelve minutes, and none between');
    eq(JSON.stringify(pushes.map((p) => p.priority)), JSON.stringify([1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2]), '(1) priority 1 through minute 60, priority 2 from 10:10');
    eq(JSON.stringify(pushes.map((p) => (p.title.match(/(\d+) min left/) || [])[1])),
      JSON.stringify(['105', '90', '75', '60', '50', '40', '30', '25', '20', '15', '10', '5']), '(1) each push says the minutes left');
    ok(pushes.every((p) => p.priority !== 2 || (p.expire > 0 && p.expire <= 1800)), '(1) every priority-2 push carries an expire of at most 1800');
    eq(JSON.stringify([...new Set(mine(a.id).map(leaks).flat())]), '[]', '(1) no link, no key, no number, no address, no text words in any of them');
    eq(gatePosts(m.gate).length, 0, '(1) and the gateway is never called before minute 120');
    eq(theirs(a.id).length, 13, '(1) Telegram carried all thirteen');
    R['1'] = { id: a.id, landed: at(t0), arrival: titleOf(arrival[0]), pushes, telegram: theirs(a.id).length, gateway_calls_before_120: 0 };
    await noText(a.id);
  } }

  /* ============================================================ (2) what stops the table */
  if (want('2') || want('11')) {
  suite('J · (2) the quote going out stops it — and three other stops');
  {
    const stopAt937 = async (label, name, stop) => {
      const a = await submit(CT(...DAY_B, 9, 0), who(name));
      await sleep(1500);
      await walk(CT(...DAY_B, 9, 5), CT(...DAY_B, 9, 35));
      const firedBefore = (await record(a.id)).alerts.table.fired.slice();
      await stop(a);
      const m = mark();
      await walk(CT(...DAY_B, 9, 40), CT(...DAY_B, 11, 10));
      const after = mine(a.id).filter((c) => c.runNow && Date.parse(c.runNow) > Date.parse(CT(...DAY_B, 9, 37)));
      eq(after.length, 0, `${label} nothing fires after the stop`);
      eq(gatePosts(m.gate).length, 0, `${label} and no holding text at 11:00`);
      const rec = await record(a.id);
      return { id: a.id, fired_before_the_stop: firedBefore, pushes_after: after.length, gateway_calls_after: 0, end_reason: rec.alerts.table.end_reason };
    };

    R['2_sent'] = await stopAt937('(2) /sent:', 'Sent Sela', async (a) => {
      const c = await admin('POST', `/admin/quote/${a.id}`, Q(1, [win('2026-10-06', '08:00', '10:00')]), CT(...DAY_B, 9, 36));
      eq(c.status, 201, '(2) a quote is created for the job');
      const s = await admin('POST', `/admin/quote/${a.id}/sent`, { version: 1, sent_at: CT(...DAY_B, 9, 37) }, CT(...DAY_B, 9, 37));
      eq(s.status, 200, '(2) "I sent it" at 9:37 answers 200');
    });
    R['2_quoted_tap'] = await stopAt937('(2) the Quoted tap:', 'Tapped Tova', async (a) => {
      eq((await tap(a.id, 'quoted', CT(...DAY_B, 9, 37))).status, 200, '(2) the Quoted tap answers 200');
    });
    R['2b_scheduled_tap'] = await stopAt937('(2b) the Scheduled tap:', 'Scheduled Sosa', async (a) => {
      eq((await tap(a.id, 'scheduled', CT(...DAY_B, 9, 37))).status, 200, '(2b) the Scheduled tap at 9:37 answers 200');
    });
    R['2c_no_text_tap'] = await stopAt937('(2c) the no-text tap:', 'Handled Hana', async (a) => {
      eq((await fetch(`${W}/admin/no-text/${a.id}`, { method: 'POST' })).status, 401, '(2c) no-text is 401 without the admin key');
      eq((await noText(a.id, CT(...DAY_B, 9, 37))).status, 200, '(2c) and 200 with it');
    });

    /* (2d) the KV mirror bent by hand: quoted_at gone, but the BOOK still holds a SENT version */
    const e = await submit(CT(...DAY_B, 9, 0), who('Mirror Mila'));
    await sleep(1500);
    await admin('POST', `/admin/quote/${e.id}`, Q(1, [win('2026-10-07', '08:00', '10:00')]), CT(...DAY_B, 9, 36));
    await admin('POST', `/admin/quote/${e.id}/sent`, { version: 1, sent_at: CT(...DAY_B, 9, 37) }, CT(...DAY_B, 9, 37));
    await poke(e.id, { set: { quoted_at: null, status: 'received' } });
    const bent = await record(e.id);
    eq(bent.quoted_at, null, '(2d) quoted_at is gone from the KV record');
    eq(bent.status, 'received', '(2d) and the record says "received" again');
    const m5 = mark();
    await walk(CT(...DAY_B, 9, 40), CT(...DAY_B, 11, 10));
    eq(gatePosts(m5.gate).length, 0, '(2d) the BOOK is asked fresh, so NO POST to the gateway');
    const afterE = await record(e.id);
    eq(afterE.alerts.table.end_reason, 'book_sent', "(2d) and the ladder ended on the book's word");
    R['2d_book'] = { id: e.id, quoted_at_in_kv: null, status_in_kv: 'received', book_says_sent: true, gateway_calls: 0, end_reason: afterE.alerts.table.end_reason };
  } }

  /* ============================================================ (3) ack does not stop it */
  if (want('3')) {
  suite('J · (3) an acknowledgement cancels that push, not the clock');
  {
    const a = await submit(CT(...DAY_A, 9, 0), who('Acked Ada'));
    await sleep(1500);
    await walk(CT(...DAY_A, 9, 5), CT(...DAY_A, 10, 10));
    const at1010 = mine(a.id).filter((c) => c.runNow === CT(...DAY_A, 10, 10));
    eq(at1010.length, 1, '(3) the 10:10 push went');
    eq(Number(at1010[0].p.get('priority')), 2, '(3) at priority 2');
    const receipt = at1010[0].receipt;
    ok(Boolean(receipt), '(3) and Pushover issued a receipt for it', String(receipt));
    const before = CANCELS().length;
    const cb = await fetch(`${W}/hooks/pushover/${encodeURIComponent(FAKE.HOOK_SECRET)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-umbra-test-now': CT(...DAY_A, 10, 12) },
      body: new URLSearchParams({ receipt }).toString(),
    });
    eq(cb.status, 200, '(3) the callback is accepted');
    const cancels = CANCELS().slice(before).filter((c) => c.url.includes(a.id));
    eq(cancels.length, 1, '(3) cancel_by_tag called exactly once');
    const rec = await record(a.id);
    ok(Boolean(rec.alerts.ack_at), '(3) the record is marked acknowledged', String(rec.alerts.ack_at));
    eq(rec.alerts.table.ended_at, null, '(3) and the ladder is NOT ended');
    await runAt(CT(...DAY_A, 10, 20));
    const at1020 = mine(a.id).filter((c) => c.runNow === CT(...DAY_A, 10, 20));
    eq(at1020.length, 1, '(3) the 10:20 push still fires');
    R['3'] = {
      id: a.id, push_1010: titleOf(at1010[0]), receipt_issued: true, cancel_by_tag_calls: cancels.length,
      ack_at: rec.alerts.ack_at, ack_by: rec.alerts.ack_by, ladder_ended_at: rec.alerts.table.ended_at,
      push_1020: titleOf(at1020[0]),
    };
    await noText(a.id);
  } }

  /* ============================================================ (4) the holding text */
  async function holdingReading(lang, label, name, expected) {
    const a = await submit(CT(...DAY_C, 9, 0), who(name, lang));
    await sleep(1500);
    const m = mark();
    await walk(CT(...DAY_C, 9, 5), CT(...DAY_C, 11, 0));
    const posts = gatePosts(m.gate);
    eq(posts.length, 1, `${label} exactly ONE POST to the gateway`);
    const p = posts[0], b = bodyOf(p);
    eq(p.path, '/3rdparty/v1/messages', `${label} POST /3rdparty/v1/messages`);
    eq(p.authScheme, 'Basic', `${label} with basic auth`);
    eq(p.authUser, FAKE_SMSGATE_AUTH.split(':')[0], `${label} the fake pair's username (the password is never logged)`);
    ok(!p.body.includes(FAKE_SMSGATE_AUTH.split(':')[1]), `${label} and the password is nowhere in the body`);
    eq(b && b.id, `${a.id}-hold`, `${label} id <U-id>-hold`);
    ok(b && Array.isArray(b.phoneNumbers) && b.phoneNumbers.length === 1 && /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(b.phoneNumbers[0]),
      `${label} phoneNumbers is one E.164 US number`, JSON.stringify(b && b.phoneNumbers));
    eq(b && b.withDeliveryReport, true, `${label} withDeliveryReport true`);
    eq(b && b.ttl, 3600, `${label} ttl = min(3600, seconds to 9 PM) = 3600 at 11:00 AM`);
    const words = b && b.textMessage && b.textMessage.text;
    ok(typeof words === 'string' && !/[{}]/.test(words), `${label} no brace is left anywhere in the words`, String(words));
    ok(!/[‘’“”–—áíóúÁÍÓÚ]/.test(words),
      `${label} GSM-7: no curly quote, no long dash, no a/i/o/u-acute`);
    eq(words, expected, `${label} the words, byte for byte`);
    const rec = await record(a.id);
    eq(rec.alerts.holding.state, 'accepted', `${label} the record's holding block says accepted`);
    eq(rec.alerts.holding.gateway_id, `${a.id}-hold`, `${label} with the gateway's own id`);
    eq(rec.alerts.holding.lang, lang, `${label} in the request's language`);
    ok(Boolean(rec.alerts.second_clock_started_at), `${label} and the second clock has started`, String(rec.alerts.second_clock_started_at));
    const push = mine(a.id).filter((c) => /HOLDING TEXT QUEUED/.test(titleOf(c)));
    eq(push.length, 1, `${label} one "HOLDING TEXT QUEUED" push`);
    eq(titleOf(push[0]), `HOLDING TEXT QUEUED · ${a.id}`, `${label} naming the job id and nothing else`);
    eq(JSON.stringify([...new Set(mine(a.id).map(leaks).flat())]), '[]', `${label} no push carries the number, the key or the text's words`);
    return {
      id: a.id, sent_at: at(rec.alerts.holding.at),
      post: { id: b.id, phoneNumbers: b.phoneNumbers, withDeliveryReport: b.withDeliveryReport, ttl: b.ttl },
      auth: { scheme: p.authScheme, username: p.authUser, password_in_log: false },
      words, chars: words.length, parts: rec.alerts.holding.parts,
      holding: rec.alerts.holding, second_clock_started_at: rec.alerts.second_clock_started_at,
      push: titleOf(push[0]),
    };
  }

  const four = {};
  let holdingJob = null;
  if (want('4') || want('7') || want('11')) {
    suite('J · (4) the holding text at two hours, in English');
    four.en = await holdingReading('en', '(4)', 'Holding Hollis',
      "Hi Holding, it's Drew with Umbra Domus. We got your request and we're working on your quote. You'll have it by 1:00 PM, or I'll call and tell you why.");
    holdingJob = four.en.id;
  }

  /* ============================================================ (7) the second clock */
  if (want('7')) {
  suite('J · (7) the second clock, and then he calls');
  {
    const a = holdingJob;
    const m = mark();
    await walk(CT(...DAY_C, 11, 5), CT(...DAY_C, 12, 55));
    const slots = mine(a).filter((c) => /STILL OPEN/.test(titleOf(c)) && c.runNow && Date.parse(c.runNow) > Date.parse(CT(...DAY_C, 11, 0))).map(shot);
    const want = ['11:15 AM', '11:30 AM', '11:45 AM', '12:00 PM', '12:10 PM', '12:20 PM', '12:30 PM', '12:35 PM', '12:40 PM', '12:45 PM', '12:50 PM', '12:55 PM'];
    eq(JSON.stringify(slots.map((s) => s.run)), JSON.stringify(want), '(7) the second clock walks his table again');
    eq(JSON.stringify(slots.map((s) => s.priority)), JSON.stringify([1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2]), '(7) with the same priorities');
    const delivered = mine(a).filter((c) => /HOLDING TEXT DELIVERED/.test(titleOf(c)));
    eq(delivered.length, 1, '(7) the phone reported the text delivered, once');
    ok(gateGets(m.gate).length >= 1, '(7) by one GET of its state', String(gateGets(m.gate).length) + ' GET(s)');
    await runAt(CT(...DAY_C, 13, 0));
    const call = mine(a).filter((c) => /CALL THEM NOW/.test(titleOf(c)));
    eq(call.length, 1, '(7) ONE "CALL THEM NOW" push at 1:00 PM');
    eq(titleOf(call[0]), `CALL THEM NOW · ${a} — two hours twice, no quote`, '(7) in his words');
    eq(Number(call[0].p.get('priority')), 2, '(7) at priority 2');
    const before = mine(a).length, gbefore = gate.requests.length;
    await runAt(CT(...DAY_C, 13, 5));
    await runAt(CT(...DAY_C, 13, 30));
    await runAt(CT(...DAY_D, 9, 0));
    eq(mine(a).length, before, '(7) then nothing at 1:05, 1:30 or the next day');
    eq(gate.requests.slice(gbefore).length, 0, '(7) and no gateway call either');
    const rec = await record(a);
    eq(rec.alerts.table.end_reason, 'call:two hours twice, no quote', '(7) the ladder is ended for good');
    R['7'] = {
      id: a, second_clock_pushes: slots, delivery_gets: gateGets(m.gate).length, holding_delivery: rec.alerts.holding.delivery,
      call_them_now: titleOf(call[0]), call_push_at: rec.alerts.call_push_at, end_reason: rec.alerts.table.end_reason,
      after_1pm_pushes: 0, after_1pm_gateway_calls: 0,
    };
  } }

  if (want('4')) {
    suite('J · (4b) the same in Spanish');
    four.es = await holdingReading('es', '(4b)', 'Esperanza María',
      'Hola Esperanza, soy Drew de Umbra Domus. Recibimos su solicitud y estamos preparando su cotizacion. La tendra antes de la 1:00 p. m. Si no le llega para entonces, le llamo y le explico por qué.');
    await noText(four.es.id);
  }
  R['4'] = four;

  /* ============================================================ (6) no texts tick */
  if (want('6')) {
  suite('J · (6) a customer who did not tick the texts box');
  {
    const a = await submit(CT(...DAY_C, 9, 0), { ...who('No Tick Nita'), sms_consent: 'no' });
    await sleep(1500);
    const rec0 = await record(a.id);
    eq(rec0.consent.smsService, false, '(6) the record says the box was not ticked');
    const m = mark();
    await walk(CT(...DAY_C, 9, 5), CT(...DAY_C, 11, 0));
    eq(gatePosts(m.gate).length, 0, '(6) no POST to the gateway at minute 120');
    const call = mine(a.id).filter((c) => /CALL THEM NOW/.test(titleOf(c)));
    eq(call.length, 1, '(6) ONE "CALL THEM NOW" push');
    eq(titleOf(call[0]), `CALL THEM NOW · ${a.id} — no texts tick`, '(6) naming the reason');
    eq(Number(call[0].p.get('priority')), 2, '(6) at priority 2');
    const before = mine(a.id).length;
    await walk(CT(...DAY_C, 11, 5), CT(...DAY_C, 13, 30), 15);
    eq(mine(a.id).length, before, '(6) and nothing at all after it');
    const rec = await record(a.id);
    eq(rec.alerts.holding.state, 'skipped', '(6) the record marks the holding text skipped');
    eq(rec.alerts.second_clock_started_at, null, '(6) and no second clock started');
    R['6'] = { id: a.id, consent_smsService: false, gateway_calls: 0, push: titleOf(call[0]), holding: rec.alerts.holding, pushes_after: 0 };
  } }

  /* ============================================================ (6b) a number that is not a US one */
  if (want('6')) {
  suite('J · (6b) §6: a request whose number is not a US number');
  {
    /* (787) is Puerto Rico: US-shaped, NANP, and not a number this may text (TEXT-01's own list) */
    const a = await submit(CT(...DAY_C, 9, 0), { ...who('Caribbean Cira'), phone: '(787) 555-0142' });
    await sleep(1500);
    const m = mark();
    await walk(CT(...DAY_C, 9, 5), CT(...DAY_C, 11, 0));
    eq(gatePosts(m.gate).length, 0, '(6b) no POST to the gateway');
    const push = mine(a.id).filter((c) => /no US number/.test(titleOf(c)));
    eq(push.length, 1, '(6b) ONE push instead');
    eq(titleOf(push[0]), `no US number on ${a.id} — call them`, '(6b) in the brief’s own words');
    eq(Number(push[0].p.get('priority')), 2, '(6b) at priority 2');
    const before = mine(a.id).length;
    await walk(CT(...DAY_C, 11, 5), CT(...DAY_C, 12, 30), 15);
    eq(mine(a.id).length, before, '(6b) and the ladder ends there');
    const rec = await record(a.id);
    eq(rec.alerts.table.end_reason, 'no_us_number', '(6b) the record says why');
    eq(rec.alerts.holding.state, 'skipped', '(6b) and the holding text is marked skipped');
    R['6b'] = { id: a.id, phone_area: '787', gateway_calls: 0, push: titleOf(push[0]), end_reason: rec.alerts.table.end_reason, pushes_after: 0 };
  } }

  /* ============================================================ (8) once only */
  if (want('8')) {
  suite('J · (8) one POST, however the runs land');
  {
    const a = await submit(CT(...DAY_C, 9, 0), who('Once Ozzie'));
    await sleep(1500);
    await walk(CT(...DAY_C, 9, 5), CT(...DAY_C, 10, 55));
    const m = mark();
    gate.state.slowMs = 3000;                  /* the fake answers slowly, so both runs are in flight */
    await Promise.all([runAt(CT(...DAY_C, 11, 0)), runAt(CT(...DAY_C, 11, 0))]);
    gate.state.slowMs = 0;
    const posts = gatePosts(m.gate);
    eq(posts.length, 1, '(8) two runs in the same minute, against a slow gateway → ONE POST');
    eq(posts.filter((p) => p.answered === 409).length, 0, '(8) the fake never had to answer 409 — the id left once');
    const rec = await record(a.id);
    eq(rec.alerts.holding.state, 'accepted', '(8) one holding block, accepted');
    eq(rec.alerts.holding.gateway_id, `${a.id}-hold`, '(8) with the one id');
    const marks = (await bookDump()).marks.filter((x) => x.job_id === a.id);
    eq(marks.length, 1, "(8) and the BOOK holds exactly one mark for this job");
    eq(marks[0].key, `hold:${a.id}`, '(8) keyed hold:<U-id>');
    eq(marks[0].state, 'accepted', '(8) in state accepted');
    R['8'] = {
      id: a.id, concurrent_runs: 2, fake_answer_delay_ms: 3000, posts: posts.length, conflicts_409: 0,
      holding_state: rec.alerts.holding.state, book_marks: marks.map((x) => ({ key: x.key, state: x.state, gateway_id: x.gateway_id })),
    };
    await noText(a.id);
  } }

  /* ============================================================ (9) the failures */
  if (want('9')) {
  suite('J · (9) 401 and 500 — never a retry');
  {
    R['9'] = {};
    for (const c of [{ mode: '401', want: 'refused', name: 'Refused Rosa' }, { mode: '500', want: 'unknown', name: 'Unknown Ulla' }]) {
      const a = await submit(CT(...DAY_C, 9, 0), who(c.name));
      await sleep(1500);
      await walk(CT(...DAY_C, 9, 5), CT(...DAY_C, 10, 55));
      const m = mark();
      gate.state.mode = c.mode;
      await runAt(CT(...DAY_C, 11, 0));
      const rec = await record(a.id);
      eq(rec.alerts.holding.state, c.want, `(9) ${c.mode} → holding.state ${c.want}`);
      const push = mine(a.id).filter((p) => /HOLDING TEXT DID NOT GO/.test(titleOf(p)));
      eq(push.length, 1, `(9) ${c.mode} → one "HOLDING TEXT DID NOT GO … call them" push`);
      eq(Number(push[0].p.get('priority')), 2, `(9) ${c.mode} → at priority 2`);
      eq(rec.alerts.second_clock_started_at, null, `(9) ${c.mode} → no second clock`);
      await walk(CT(...DAY_C, 11, 5), CT(...DAY_C, 11, 50));     /* ten more runs */
      gate.state.mode = 'ok';
      const posts = gatePosts(m.gate);
      eq(posts.length, 1, `(9) ${c.mode} → ONE POST across eleven runs, never a retry`);
      const after = await record(a.id);
      eq(after.alerts.table.end_reason, 'holding_' + c.want, `(9) ${c.mode} → the ladder ends there`);
      eq(mine(a.id).filter((p) => p.runNow && Date.parse(p.runNow) > Date.parse(CT(...DAY_C, 11, 0))).length, 0, `(9) ${c.mode} → and nothing after`);
      R['9'][c.mode] = {
        id: a.id, holding_state: rec.alerts.holding.state, http: rec.alerts.holding.status,
        push: titleOf(push[0]), posts_across_eleven_runs: posts.length,
        gateway_log: posts.map((p) => ({ n: p.n, at: p.at, method: p.method, path: p.path, id: (bodyOf(p) || {}).id, mode: p.mode, answered: p.answered })),
        end_reason: after.alerts.table.end_reason,
      };
    }
  } }

  /* ============================================================ (9b) the gateway never answers */
  if (want('9')) {
  suite('J · (9b) the gateway never answers: twenty seconds, then over');
  {
    const a = await submit(CT(...DAY_C, 9, 0), who('Silent Sabra'));
    await sleep(1500);
    await walk(CT(...DAY_C, 9, 5), CT(...DAY_C, 10, 55));
    const m = mark();
    gate.state.mode = 'hang';
    const t0 = Date.now();
    await runAt(CT(...DAY_C, 11, 0));
    const took = Date.now() - t0;
    gate.state.mode = 'ok';
    ok(took >= 19000 && took <= 32000, '(9b) the call ends on its own twenty-second deadline', took + ' ms');
    const rec = await record(a.id);
    eq(rec.alerts.holding.state, 'unknown', '(9b) holding.state unknown');
    const push = mine(a.id).filter((x) => /HOLDING TEXT DID NOT GO/.test(titleOf(x)));
    eq(push.length, 1, '(9b) one "DID NOT GO … call them" push');
    await walk(CT(...DAY_C, 11, 5), CT(...DAY_C, 11, 50));
    eq(gatePosts(m.gate).length, 1, '(9b) ONE request reached the gateway, across eleven runs');
    eq(rec.alerts.second_clock_started_at, null, '(9b) and no second clock');
    const after = await record(a.id);
    eq(after.alerts.table.end_reason, 'holding_unknown', '(9b) the ladder ends there');
    R['9b'] = { id: a.id, took_ms: took, holding_state: rec.alerts.holding.state, push: titleOf(push[0]), posts_across_eleven_runs: 1, end_reason: after.alerts.table.end_reason };
  } }

  /* ============================================================ (5) quiet hours */
  if (want('5')) {
  suite('J · (5) the last ten minutes of the day, and the morning');
  {
    const D1 = [2026, 10, 5];      /* Monday, Central Daylight Time */
    const D2 = [2026, 10, 6];
    const a = await submit(CT(...D1, 18, 52), who('Evening Elba'));
    const b = await submit(CT(...D1, 18, 57), who('Evening Enzo'));
    await sleep(1800);
    await walk(CT(...D1, 19, 0), CT(...D1, 20, 55));
    const evening = [...mine(a.id), ...mine(b.id)].filter((c) => c.runNow).map(shot);
    const m = mark();
    for (const t of [CT(...D1, 21, 0), CT(...D1, 23, 0), CT(...D2, 2, 0), CT(...D2, 6, 55)]) await runAt(t);
    const quiet = since(m);
    eq(quiet.po.length, 0, '(5) nothing pushed at 9:00 PM, 11 PM, 2 AM or 6:55 AM');
    eq(quiet.gate.length, 0, '(5) and nothing reached the gateway');
    const overhang = [...mine(a.id), ...mine(b.id)].filter((c) => c.runNow && c.p.get('priority') === '2'
      && Date.parse(c.runNow) + Number(c.p.get('expire')) * 1000 > closeOf(c.runNow));
    eq(overhang.length, 0, '(5) and no priority-2 push of the evening could still be ringing at 9:00 PM');
    const m2 = mark();
    await runAt(CT(...D2, 7, 0));
    const posts = gatePosts(m2.gate);
    eq(posts.length, 2, '(5) one POST each on the first run at or after 7:00 AM');
    const texts = posts.map((p) => (bodyOf(p).textMessage || {}).text);
    ok(texts.every((t) => /by 9:00 AM,/.test(t)), '(5) and both promise 9:00 AM', JSON.stringify(texts));
    ok(posts.every((p) => bodyOf(p).ttl === 3600), '(5) with ttl 3600 — min(3600, seconds to 9 PM) at 7 AM');
    R['5'] = {
      ids: [a.id, b.id], landed: [at(CT(...D1, 18, 52)), at(CT(...D1, 18, 57))],
      evening_pushes: evening, quiet_runs: ['9:00 PM', '11:00 PM', '2:00 AM', '6:55 AM'],
      quiet_pushes: 0, quiet_gateway_calls: 0, priority2_still_ringing_at_2100: 0,
      morning_posts: posts.map((p) => ({ id: bodyOf(p).id, ttl: bodyOf(p).ttl, text: (bodyOf(p).textMessage || {}).text })),
    };
    for (const id of [a.id, b.id]) await noText(id);

    /* (5b) a Central STANDARD Time date: 6:30 PM → the text goes at 8:30 PM, ttl exactly 1800 */
    const CST = [2026, 11, 9];     /* Monday, after DST ended on Sun 1 Nov 2026 */
    const c = await submit(CT(...CST, 18, 30), who('Standard Stela'));
    await sleep(1500);
    const m3 = mark();
    await walk(CT(...CST, 18, 35), CT(...CST, 20, 30));
    const p5 = gatePosts(m3.gate);
    eq(p5.length, 1, '(5b) in Central Standard Time the text goes at 8:30 PM');
    eq(bodyOf(p5[0]).ttl, 1800, '(5b) with ttl 1800 — exactly the seconds left to 9 PM');
    const rec = await record(c.id);
    eq(hhmm(rec.alerts.holding.at), '8:30 PM', '(5b) and the holding block is stamped 8:30 PM Central');
    R['5b'] = { id: c.id, landed: at(CT(...CST, 18, 30)), sent_at: at(rec.alerts.holding.at), ttl: bodyOf(p5[0]).ttl, text: (bodyOf(p5[0]).textMessage || {}).text };
    await noText(c.id);

    /* (5c) AMENDMENT 1 D's last clause: inside the last two minutes a priority-2 slot goes as
       priority 1, with no retry chain at all, so nothing can ring after the wire. */
    const D3 = [2026, 10, 7];
    const d = await submit(CT(...D3, 19, 4), who('Wire Wanda'));
    await sleep(1500);
    await walk(CT(...D3, 19, 10), CT(...D3, 20, 55));
    const at2059 = await runAt(CT(...D3, 20, 59));
    const last = mine(d.id).filter((c) => c.runNow === CT(...D3, 20, 59));
    eq(last.length, 1, '(5c) the minute-115 slot falls at 8:59 PM and fires');
    eq(last[0].p.get('priority'), '1', '(5c) as priority 1, not 2 — 60 seconds of the day are left');
    eq(last[0].p.get('expire'), null, '(5c) so Pushover is given no expire and no retry at all');
    R['5c'] = {
      id: d.id, landed: at(CT(...D3, 19, 4)), run: '8:59 PM', seconds_to_2100: toClose(CT(...D3, 20, 59)),
      title: titleOf(last[0]), priority: Number(last[0].p.get('priority')), expire: last[0].p.get('expire'),
      downgraded: (at2059.sent.find((s) => s.id === d.id) || {}).downgraded === true,
    };
    await noText(d.id);
  } }

  /* ============================================================ (10) never at night */
  if (want('10')) {
  suite('J · (10) forty-eight hours, three requests, nothing after 9 PM');
  {
    const D1 = [2026, 10, 12], D3 = [2026, 10, 14];
    const a = await submit(CT(...D1, 8, 10), who('Walk Wilma'));
    const b = await submit(CT(...D1, 19, 40), who('Walk Wendel'));
    const c = await submit(CT(...D1, 22, 15), who('Walk Winona'));
    await sleep(2000);
    const m = mark();
    let runs = 0;
    for (let t = Date.parse(CT(...D1, 8, 15)); t <= Date.parse(CT(...D3, 8, 10)); t += 300000) { await runAt(new Date(t).toISOString()); runs++; }
    const all = since(m);
    const nightPush = all.po.filter((x) => { const h = hourOf(x.runNow || new Date(Number(x.at)).toISOString()); return h >= 21 || h < 7; });
    eq(nightPush.length, 0, '(10) zero pushes with a Chicago hour of 21:00–06:59, across 48 hours');
    const nightGate = all.gate.filter((r) => { const h = hourOf(r.at); return h >= 21 || h < 7; });
    eq(nightGate.length, 0, '(10) and zero gateway calls in those hours');
    const overhang = all.po.filter((x) => x.runNow && x.p.get('priority') === '2'
      && Date.parse(x.runNow) + Number(x.p.get('expire')) * 1000 > closeOf(x.runNow));
    eq(overhang.length, 0, '(10) every priority-2 push: sent_at + expire is at or before 9:00 PM');
    const inLastTwo = all.po.filter((x) => x.runNow && toClose(x.runNow) < 120);
    ok(inLastTwo.every((x) => x.p.get('priority') === '1'), '(10) and any push inside the last two minutes went as priority 1', `${inLastTwo.length} such push(es)`);
    R['10'] = {
      ids: [a.id, b.id, c.id], hours: 48, runs, pushes: all.po.length, gateway_calls: all.gate.length,
      pushes_2100_to_0659: 0, gateway_calls_2100_to_0659: 0, priority2_expiring_after_2100: 0,
      pushes_in_the_last_two_minutes: inLastTwo.length,
      first_push: all.po.length ? hhmm(all.po[0].runNow) : null,
      earliest_hour: all.po.length ? Math.min(...all.po.map((x) => hourOf(x.runNow))) : null,
      latest_hour: all.po.length ? Math.max(...all.po.map((x) => hourOf(x.runNow))) : null,
    };
    for (const id of [a.id, b.id, c.id]) await noText(id);
  } }

  /* ============================================================ (11) the register */
  if (want('11')) {
  suite("J · (11) the register's four new columns");
  {
    const texted = await md(holdingJob);
    for (const col of ['holding_sent_at', 'holding_state', 'second_clock_started_at', 'call_push_at']) {
      ok(texted.includes('`' + col + '`'), `(11) the register has a \`${col}\` row`);
    }
    const rec = await record(holdingJob);
    ok(texted.includes(rec.alerts.holding.at), '(11) holding_sent_at carries the moment the text went');
    ok(/`holding_state` \| accepted/.test(texted), '(11) holding_state says accepted');
    ok(texted.includes(rec.alerts.second_clock_started_at), '(11) second_clock_started_at is filled');
    ok(texted.includes(rec.alerts.call_push_at), '(11) call_push_at is filled');
    ok(!/\+1\d{10}/.test(texted), '(11) and the register never prints the E.164 number');
    ok(!texted.includes("it's Drew with Umbra Domus"), "(11) nor the holding text's own words");
    /* the old rows, unchanged, on the request that was quoted at 9:37 */
    const qmd = await md(R['2_sent'].id);
    /* the cell carries an em-dash of its own ("YES — 37 business min"), so the match runs to the
       italic note that follows it, exactly as suite D's does */
    const windowRow = (qmd.match(/\| \*\*2-hour window met\?\*\* \| ([^|]+?) — \*business/) || [])[1];
    eq(String(windowRow).trim(), 'YES — 37 business min', '(11) the quoted request still reads YES — 37 business min');
    ok(/`holding_sent_at` \| `____`/.test(qmd), '(11) and its four new columns are blank, as every unfilled slot is');
    R['11'] = {
      texted: holdingJob,
      rows: (texted.match(/\| `(holding_sent_at|holding_state|holding detail|second_clock_started_at|call_push_at)`[^\n]*/g) || []),
      quoted: R['2_sent'].id, quoted_window_row: String(windowRow).trim(), quoted_new_columns_blank: true,
      number_in_register: false, words_in_register: false,
    };
  } }

  return R;
}
