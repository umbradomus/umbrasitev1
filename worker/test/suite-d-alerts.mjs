/* SUITE D · THE PHONE (ALERTS-01, 2026-09-23; HIS TABLE, REMINDERS-01, 2026-09-24). Replaces the Stage 1
   "90-minute nudge" suite, whose push service was removed by the first of those rounds. Thirteen
   readings, each against the real `wrangler dev` and the fake Pushover / Telegram in lib/servers.mjs.
   Every moment is named with the test hooks (x-umbra-test-now on a submission, ?now= on the cron body),
   so the ladder is walked in minutes of wall time instead of hours.

   REMINDERS-01 MOVED THE LADDER UNDER THIS SUITE. Every request that lands from now on walks HIS TABLE
   (15/30/45/60 at priority 1, then 70/80/90/95/100/105/110/115 at priority 2), and an acknowledgement no
   longer stops it — only the quote going out does. The readings below were rewritten to read the ladder
   that now exists; what they prove about the intake alert, the business clock, the 7 AM summary, the
   retry rules, the de-duplication, the claim and the register is unchanged. His table's own new ground
   — the holding text, the second clock and the night rule — is suite J.

   Readings are returned with their actual values for the round's close. */

import { chicagoWall } from '../src/biztime.js';

export async function suiteAlerts({ W, stub, ADMIN_KEY, FAKE, suite, ok, eq, json, sleep }) {
  const R = {};
  const CT = (y, mo, d, h, mi) => new Date(chicagoWall(y, mo, d, h, mi)).toISOString();
  const plus = (iso, min) => new Date(Date.parse(iso) + min * 60000).toISOString();
  const text = (c) => (c.p ? c.p.get('title') + '\n' + c.p.get('message') : c.j.text);

  const PO = () => stub.captured
    .filter((c) => c.method === 'POST' && c.url === '/pushover/1/messages.json')
    .map((c) => Object.assign(c, { p: new URLSearchParams(c.body.toString('utf8')) }));
  const TG = () => stub.captured
    .filter((c) => c.method === 'POST' && /^\/telegram\/bot[^/]+\/sendMessage$/.test(c.url))
    .map((c) => Object.assign(c, { j: JSON.parse(c.body.toString('utf8')) }));
  const CANCELS = () => stub.captured.filter((c) => c.method === 'POST' && c.url.startsWith('/pushover/1/receipts/cancel_by_tag/'));
  const about = (list, id) => list.filter((c) => text(c).includes(id));

  let serial = 0;
  async function submitAt(iso, name, extra = {}) {
    const fd = new FormData();
    fd.set('_subject', extra.subject || 'Service request from umbradomus.com');
    fd.set('_next', 'https://www.umbradomus.com/request-received');
    fd.set('name', name);
    fd.set('phone', '(956) 555-0142');
    fd.set('address', '742 Evergreen Terrace, Brownsville');
    fd.set('email', 'customer@example.com');
    fd.set('service', 'Drywall & Paint');
    fd.set('what', extra.what || `${name} here: two holes in the hallway ceiling. Call me at 956-555-0142 or see https://example.com/pics`);
    const r = await fetch(`${W}/intake`, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
    const loc = new URL(r.headers.get('location'));
    serial++;
    return { status: r.status, id: loc.searchParams.get('id'), token: loc.searchParams.get('t') };
  }
  const runAt = (iso) => json(`${W}/__run-alerts?k=${ADMIN_KEY}&now=${encodeURIComponent(iso)}`, { method: 'POST' }).then((r) => r.body);
  async function row(id) {
    const r = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.jobs.find((j) => j.id === id);
    return r;
  }
  /* what a record looks like with the one real-time field taken out, for "nothing was written" */
  const still = (r) => { const { minutes_open, ...rest } = r; return JSON.stringify(rest); };
  async function waitFor(fn, ms = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(100); }
    return null;
  }
  const seen = (id, iso) => fetch(`${W}/admin/seen/${id}?k=${ADMIN_KEY}`, { method: 'POST', headers: iso ? { 'x-umbra-test-now': iso } : {} });
  /* REMINDERS-01: on HIS TABLE an acknowledgement is not a stop. This is how a reading takes a request
     off the board when it has finished with it, so the next reading sees only its own pushes. */
  const done = (id, iso) => fetch(`${W}/admin/no-text/${id}?k=${ADMIN_KEY}`, { method: 'POST', headers: iso ? { 'x-umbra-test-now': iso } : {} });
  const tap = (id, type, at, extra = {}) => json(`${W}/api/job/${id}/event?k=${ADMIN_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, at, ...extra }),
  });
  const leaks = (c) => {
    const t = text(c) + '\n' + (c.p ? [...c.p.entries()].filter(([k]) => k !== 'callback' && k !== 'token' && k !== 'user').map(([, v]) => v).join('\n') : JSON.stringify(c.j));
    const found = [];
    if (/https?:\/\/|www\./i.test(t)) found.push('link');
    if (t.includes(ADMIN_KEY)) found.push('admin key');
    for (const [k, v] of Object.entries(FAKE)) if (k !== 'TELEGRAM_CHAT_ID' && t.includes(v)) found.push(k);
    if (/555-?0142|\(956\)/.test(t)) found.push('phone');
    if (/Evergreen/.test(t)) found.push('address');
    if (/@example\.com/.test(t)) found.push('email');
    return found;
  };

  /* Start clean: every request the earlier suites made is acknowledged, so the runs below see only
     their own. (This is also the first use of POST /admin/seen.) */
  {
    const jobs = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.jobs;
    for (const j of jobs) if (j.status === 'received') { await seen(j.id); await done(j.id); }
  }

  const DAY_A = [2026, 9, 24];   /* Thursday */
  const DAY_B = [2026, 9, 25];
  const DAY_C = [2026, 9, 26];

  /* ============================================================ (2) */
  suite('D · (2) a request at 7:28 AM pushes within 5 s');
  const T0 = CT(...DAY_A, 7, 28);
  const alice = await submitAt(T0, 'Alert Alice');
  {
    eq(alice.status, 303, 'the customer is redirected as always');
    const tStart = Date.now();
    const ms = await waitFor(() => about(PO(), alice.id).length >= 1 && about(TG(), alice.id).length >= 1);
    ok(ms !== null && ms <= 5000, 'the Pushover and Telegram calls arrived within 5 s', ms === null ? 'never' : ms + ' ms');
    await sleep(1500);
    const po = about(PO(), alice.id), tg = about(TG(), alice.id);
    eq(po.length, 1, 'exactly 1 Pushover call');
    eq(tg.length, 1, 'exactly 1 Telegram call');
    const p = po[0] && po[0].p;
    eq(p && p.get('priority'), '1', 'priority 1 (normal)');
    eq(p && p.get('title'), `NEW REQUEST ${alice.id} · quote due 9:28 AM`, 'the title as written');
    eq(p && p.get('url'), null, 'no url parameter');
    ok(po[0] && leaks(po[0]).length === 0, 'no link, no admin key, no secret, no phone, address or email in the push', po[0] && leaks(po[0]).join(','));
    ok(tg[0] && leaks(tg[0]).length === 0, 'none of those in the Telegram message either', tg[0] && leaks(tg[0]).join(','));
    eq(tg[0] && tg[0].j.parse_mode, undefined, 'Telegram carries no parse_mode');
    eq(tg[0] && tg[0].j.reply_markup, undefined, 'and no buttons');
    const r = await row(alice.id);
    eq(r.alerts && r.alerts.count, 1, 'the record says alerts.count = 1');
    R['2'] = {
      id: alice.id, received: T0, ms_to_both_calls: ms, pushover_calls: po.length, telegram_calls: tg.length,
      priority: p && p.get('priority'), title: p && p.get('title'), message: p && p.get('message'),
      telegram_text: tg[0] && tg[0].j.text, telegram_parse_mode: tg[0] ? (tg[0].j.parse_mode === undefined ? 'absent' : tg[0].j.parse_mode) : null,
      leaks: po[0] ? leaks(po[0]) : null, alerts_count: r.alerts && r.alerts.count, alerts_channels: r.alerts && r.alerts.channels,
      took_ms_wall: Date.now() - tStart,
    };
  }

  /* ============================================================ (4) */
  suite('D · (4) +16: the minute-15 push at priority 1; +17: nothing; +71: priority 2, with its receipt');
  {
    const b = PO().length, bt = TG().length;
    const out16 = await runAt(plus(T0, 16));
    const po16 = PO().slice(b);
    eq(about(po16, alice.id).length, 1, 'the run at +16 sends exactly one push for it');
    const p = po16[0] && po16[0].p;
    /* REMINDERS-01: minute 15 is the first rung of HIS TABLE and is priority 1 — the repeating kind
       starts at minute 70. Before this round minute 15 was the priority-2 rung. */
    eq(p && p.get('priority'), '1', 'priority 1 (his table: priority 1 through minute 60)');
    eq(p && p.get('retry'), null, 'no retry — a priority-1 push does not repeat');
    eq(p && p.get('expire'), null, 'and no expire');
    eq(p && p.get('title'), `STILL OPEN · ${alice.id} · 105 min left`, 'and it says the minutes left');
    ok(po16[0] && leaks(po16[0]).length === 0, 'the message itself carries no link and no secret', po16[0] && leaks(po16[0]).join(','));
    const b17 = PO().length, bt17 = TG().length;
    const out17 = await runAt(plus(T0, 17));
    eq(PO().length - b17, 0, 'the run at +17 sends nothing to Pushover');
    eq(TG().length - bt17, 0, 'and nothing to Telegram');
    /* the first priority-2 rung: minute 70. 30, 45 and 60 are past too, so this run fires the latest
       one and marks the earlier three skipped — never two pushes in one run. */
    const b71 = PO().length;
    const out71 = await runAt(plus(T0, 71));
    const po71 = about(PO().slice(b71), alice.id);
    eq(po71.length, 1, 'the run at +71 sends exactly one push, not four');
    const q = po71[0] && po71[0].p;
    eq(q && q.get('priority'), '2', 'priority 2 (the repeating kind), from minute 70');
    eq(q && q.get('retry'), '120', 'retry 120');
    ok(q && Number(q.get('expire')) > 0 && Number(q.get('expire')) <= 1800, 'expire at most 1800', q && q.get('expire'));
    eq(q && q.get('tags'), 'req_' + alice.id, 'tag req_<id>');
    eq(q && q.get('callback'), `${W}/hooks/pushover/${FAKE.HOOK_SECRET}`, 'callback = PUBLIC_BASE_URL + /hooks/pushover/<HOOK_SECRET>');
    eq(q && q.get('title'), `STILL OPEN · ${alice.id} · 50 min left`, 'and it says fifty minutes left');
    const rSkip = await row(alice.id);
    eq(JSON.stringify(rSkip.alerts.table.fired), JSON.stringify([15, 30, 45, 60, 70]), 'the skipped rungs are marked fired, so they never fire late');
    R['4'] = {
      run16: { pushover: PO().slice(b, b17).length, telegram: TG().slice(bt, bt17).length, priority: p && p.get('priority'), retry: p && p.get('retry'), expire: p && p.get('expire'), title: p && p.get('title'), sent: out16.sent.map((x) => x.step + ':' + x.id) },
      run17: { pushover: PO().length - b17 - po71.length, telegram: TG().length - bt17 - 1, sent: out17.sent.length },
      run71: { pushover: po71.length, priority: q && q.get('priority'), retry: q && q.get('retry'), expire: q && q.get('expire'), tags: q && q.get('tags'), callback_path: q && q.get('callback') && q.get('callback').replace(FAKE.HOOK_SECRET, '<HOOK_SECRET>'), title: q && q.get('title'), receipt_issued: Boolean(po71[0] && po71[0].receipt), sent: out71.sent.map((x) => x.step + ':' + x.id), fired_after: rSkip.alerts.table.fired },
    };
    R['4']._receipt = po71[0] && po71[0].receipt;
  }

  /* ============================================================ (5) */
  suite("D · (5) Pushover's Acknowledge callback — it cancels that push, not the clock");
  {
    const receipt = R['4']._receipt;
    delete R['4']._receipt;
    const before = still(await row(alice.id));
    const c0 = CANCELS().length;
    const wrong = await fetch(`${W}/hooks/pushover/not-the-secret`, { method: 'POST', body: new URLSearchParams({ receipt, acknowledged: '1' }) });
    eq(wrong.status, 404, 'a wrong secret is a 404');
    eq(still(await row(alice.id)), before, 'and nothing was written');
    const unknown = await fetch(`${W}/hooks/pushover/${FAKE.HOOK_SECRET}`, { method: 'POST', body: new URLSearchParams({ receipt: 'u' + 'a'.repeat(29), acknowledged: '1' }) });
    eq(unknown.status, 404, 'an unknown receipt is a 404');
    eq(still(await row(alice.id)), before, 'and nothing was written');
    eq(CANCELS().length, c0, 'neither called cancel_by_tag');
    const good = await fetch(`${W}/hooks/pushover/${FAKE.HOOK_SECRET}`, {
      method: 'POST', headers: { 'x-umbra-test-now': plus(T0, 74) },
      body: new URLSearchParams({ receipt, acknowledged: '1', acknowledged_at: String(Math.floor(Date.parse(plus(T0, 74)) / 1000)), acknowledged_by: FAKE.PUSHOVER_USER }),
    });
    eq(good.status, 200, 'the stored receipt is accepted');
    const r = await row(alice.id);
    ok(r.alerts.ack_at, 'ack_at is set', r.alerts.ack_at);
    eq(r.alerts.ack_by, 'pushover', 'by Pushover');
    const cancels = CANCELS().slice(c0);
    eq(cancels.length, 1, 'cancel_by_tag was called once');
    ok(cancels[0] && cancels[0].url.includes('req_' + alice.id), 'for req_<id>', cancels[0] && cancels[0].url);
    const again = await fetch(`${W}/hooks/pushover/${FAKE.HOOK_SECRET}`, { method: 'POST', body: new URLSearchParams({ receipt, acknowledged: '1' }) });
    eq(CANCELS().length - c0, 1, 'a second callback with the same receipt cancels nothing more');
    /* REMINDERS-01 §2: the acknowledgement stopped THAT push repeating. It did not stop the clock. */
    eq(r.alerts.table.ended_at, null, 'the ladder is not ended by the acknowledgement');
    const b = PO().length;
    await runAt(plus(T0, 81));
    const next = about(PO().slice(b), alice.id);
    eq(next.length, 1, 'the minute-80 rung still fires after the ack');
    eq(next[0] && next[0].p.get('title'), `STILL OPEN · ${alice.id} · 40 min left`, 'saying forty minutes left');
    /* and now Alice comes off the board, so the readings after this one see only their own pushes */
    await done(alice.id, plus(T0, 82));
    const b2 = PO().length, bt2 = TG().length;
    for (const m of [86, 121, 200]) await runAt(plus(T0, m));
    eq(about(PO().slice(b2), alice.id).length, 0, 'after the no-text tap, later runs push nothing for it');
    eq(about(TG().slice(bt2), alice.id).length, 0, 'and send no Telegram');
    R['5'] = {
      wrong_secret: wrong.status, unknown_receipt: unknown.status, nothing_written_on_404: true,
      good: good.status, ack_at: r.alerts.ack_at, ack_by: r.alerts.ack_by,
      cancel_by_tag_calls: cancels.length, cancel_url: cancels[0] && cancels[0].url, repeat_callback_status: again.status,
      ladder_ended_by_ack: r.alerts.table.ended_at, next_rung_after_ack: next[0] && next[0].p.get('title'),
      later_runs_after_no_text_pushover: about(PO().slice(b2), alice.id).length,
      later_runs_after_no_text_telegram: about(TG().slice(bt2), alice.id).length,
    };
  }

  /* ============================================================ (6) */
  suite('D · (6) the QUOTED tap, and POST /admin/seen/<id>');
  {
    const tony = await submitAt(CT(...DAY_A, 7, 40), 'Tap Tony');
    const sam = await submitAt(CT(...DAY_A, 7, 45), 'Seen Sam');
    await waitFor(() => about(PO(), sam.id).length >= 1);
    const b = PO().length;
    await runAt(CT(...DAY_A, 7, 56));
    eq(about(PO().slice(b), tony.id).length, 1, 'Tony got his minute-15 push at 7:56');
    const c0 = CANCELS().length;
    const t = await tap(tony.id, 'quoted', CT(...DAY_A, 7, 58), { quote_amount: 180 });
    eq(t.status, 200, 'the Quoted tap is accepted');
    const rt = await row(tony.id);
    ok(rt.alerts.ack_at, 'the tap set ack_at', rt.alerts.ack_at);
    eq(rt.alerts.ack_by, 'tap:quoted', 'by the Quoted tap');
    const ct = CANCELS().slice(c0);
    eq(ct.length, 1, 'and called cancel_by_tag once');
    ok(ct[0] && ct[0].url.includes('req_' + tony.id), 'for req_' + tony.id, ct[0] && ct[0].url);

    const before = still(await row(sam.id));
    const c1 = CANCELS().length;
    const noKey = await fetch(`${W}/admin/seen/${sam.id}`, { method: 'POST' });
    eq(noKey.status, 401, 'POST /admin/seen without the admin key is a 401');
    const badKey = await fetch(`${W}/admin/seen/${sam.id}?k=guess`, { method: 'POST' });
    eq(badKey.status, 401, 'and with a wrong key');
    eq(still(await row(sam.id)), before, 'nothing was written');
    const yes = await seen(sam.id, CT(...DAY_A, 7, 50));
    eq(yes.status, 200, 'with the key it is accepted');
    const rs = await row(sam.id);
    ok(rs.alerts.ack_at, 'ack_at is set', rs.alerts.ack_at);
    eq(rs.alerts.ack_by, 'seen', 'by /admin/seen');
    eq(CANCELS().length - c1, 1, 'cancel_by_tag called once');
    /* REMINDERS-01 §2: the Quoted tap stops Tony's clock, because it is the quote going out. Sam was
       only acknowledged, so his clock runs on — the rungs keep coming until he is taken off. */
    const b2 = PO().length;
    for (const m of [[8, 1], [8, 31], [9, 50]]) await runAt(CT(...DAY_A, ...m));
    eq(about(PO().slice(b2), tony.id).length, 0, 'later runs are silent for Tony — his quote went out');
    ok(about(PO().slice(b2), sam.id).length > 0, "but not for Sam: an acknowledgement is not a quote", String(about(PO().slice(b2), sam.id).length) + ' push(es)');
    const samRungs = about(PO().slice(b2), sam.id).map((c) => c.p.get('title'));
    await done(sam.id, CT(...DAY_A, 9, 51));
    const b3 = PO().length;
    for (const m of [[9, 56], [10, 30]]) await runAt(CT(...DAY_A, ...m));
    eq(about(PO().slice(b3), sam.id).length, 0, 'the no-text tap does stop him');
    R['6'] = {
      tony: tony.id, tap_status: t.status, tap_ack_at: rt.alerts.ack_at, tap_ack_by: rt.alerts.ack_by, tap_cancel_calls: ct.length,
      tony_later_runs: 0,
      sam: sam.id, seen_no_key: noKey.status, seen_bad_key: badKey.status, seen_with_key: yes.status, seen_ack_at: rs.alerts.ack_at, seen_ack_by: rs.alerts.ack_by, seen_cancel_calls: CANCELS().length - c1 - 0,
      sam_rungs_after_the_ack: samRungs, sam_after_no_text: 0,
    };
  }

  /* ============================================================ (8) */
  suite("D · (8) his table end to end, then \"call them now\", then silence");
  let larry;
  {
    /* Larry's request came from a page without the texts box, so his consent is null. At minute 120 the
       rule is §5: no text and no second clock — one "call them now" push, and the ladder ends. */
    const t = CT(...DAY_A, 9, 0);
    larry = await submitAt(t, 'Late Larry');
    await waitFor(() => about(PO(), larry.id).length >= 1);
    const plan = [16, 31, 46, 61, 71, 81, 91, 96, 101, 106, 111, 116, 121, 126, 180, 300, 715];  /* +715 = 8:55 PM */
    const per = [];
    for (const m of plan) {
      const b = PO().length;
      await runAt(plus(t, m));
      const got = about(PO().slice(b), larry.id);
      per.push({ at: '+' + m, pushes: got.length, priority: got.map((c) => c.p.get('priority')).join(','), title: got.map((c) => c.p.get('title')).join(' | ') });
    }
    eq(per.map((x) => x.pushes).join(','), '1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0', 'one push at each of his twelve rungs, one at +121, then none');
    eq(per.slice(0, 12).map((x) => x.priority).join(','), '1,1,1,1,2,2,2,2,2,2,2,2', 'priority 1 through minute 60, priority 2 from minute 70');
    eq(per.map((x) => (x.title.match(/(\d+) min left/) || [])[1]).slice(0, 12).join(','), '105,90,75,60,50,40,30,25,20,15,10,5', 'each rung says the minutes left');
    ok(per[12].title.startsWith('CALL THEM NOW · ' + larry.id + ' — no texts tick'), 'at minute 120 with no texts tick: "call them now"', per[12].title);
    eq(per[12].priority, '2', 'at priority 2');
    eq(per.slice(13).reduce((n, x) => n + x.pushes, 0), 0, 'silence for the rest of the day');
    const r = await row(larry.id);
    eq(r.alerts.stage, 'done', 'the ladder is finished');
    eq(r.alerts.next_at, null, 'with no next step');
    eq(r.alerts.table.end_reason, 'call:no texts tick', 'and the record says why it ended');
    R['8'] = { id: larry.id, received: t, due_at: r.alerts.due_at, runs: per, stage: r.alerts.stage, count: r.alerts.count, end_reason: r.alerts.table.end_reason };
  }

  /* ============================================================ (9) */
  suite('D · (9) Pushover 500 → Telegram still goes, one retry; 400 → never retried');
  {
    const t = CT(...DAY_A, 13, 0);
    stub.state.pushover = '500';
    const fran = await submitAt(t, 'Flaky Fran');
    await waitFor(() => about(TG(), fran.id).length >= 1 && about(PO(), fran.id).length >= 1);
    await sleep(1000);
    const po0 = about(PO(), fran.id), tg0 = about(TG(), fran.id);
    eq(po0.length, 1, 'Pushover was tried once at intake');
    eq(po0[0] && po0[0].answered, 500, 'and answered 500');
    eq(tg0.length, 1, 'Telegram was still sent');
    stub.state.pushover = 'ok';
    let b = PO().length, bt = TG().length;
    await runAt(plus(t, 5));
    const retry = about(PO().slice(b), fran.id);
    eq(retry.length, 1, 'the next run (+5 min) retries Pushover once');
    eq(retry[0] && retry[0].answered, 200, 'and it goes');
    eq(about(TG().slice(bt), fran.id).length, 0, 'Telegram is not sent again');
    b = PO().length;
    await runAt(plus(t, 10));
    eq(about(PO().slice(b), fran.id).length, 0, 'the run after that sends nothing');
    const rMid = await row(fran.id);

    stub.state.pushover = '400';
    b = PO().length; bt = TG().length;
    await runAt(plus(t, 16));
    const four = about(PO().slice(b), fran.id);
    eq(four.length, 1, 'the +16 push is tried');
    eq(four[0] && four[0].answered, 400, 'and answered 400');
    eq(about(TG().slice(bt), fran.id).length, 1, 'Telegram carries that step');
    stub.state.pushover = 'ok';
    b = PO().length;
    await runAt(plus(t, 21));
    await runAt(plus(t, 26));
    eq(about(PO().slice(b), fran.id).length, 0, 'the 400 is never retried (+21, +26: nothing)');
    await done(fran.id);
    R['9'] = {
      id: fran.id, intake: { pushover: po0.length, pushover_answer: po0[0] && po0[0].answered, telegram: tg0.length },
      run5: { pushover_retry: retry.length, answer: retry[0] && retry[0].answered, telegram: 0 },
      run10: 0, count_after_retry: rMid.alerts.count,
      run16_with_400: { pushover: four.length, answer: four[0] && four[0].answered },
      runs21_26_pushover: 0,
    };
  }

  /* ============================================================ (10) */
  suite('D · (10) the same submission twice in 10 minutes');
  {
    const t = CT(...DAY_A, 14, 0);
    const n0 = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.count;
    const f0 = stub.captured.filter((c) => c.url.startsWith('/formsubmit')).length;
    const one = await submitAt(t, 'Double Dan');
    const two = await submitAt(plus(t, 3), 'Double Dan');
    /* EMAIL-SUBJECT-01: the page stamps the subject with the minute it was sent, so a real resend
       differs from the first post in `_subject` alone. It must still be the same request. */
    const twoStamped = await submitAt(plus(t, 4), 'Double Dan', { subject: 'Service request from umbradomus.com · Double · 1/1 2:04 PM' });
    await waitFor(() => about(PO(), one.id).length >= 1);
    await sleep(2000);
    const n1 = (await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body.count;
    eq(two.id, one.id, 'the second post lands on the same request number');
    eq(two.token, one.token, 'with the same status link');
    eq(twoStamped.id, one.id, 'EMAIL-SUBJECT-01: a resend whose only difference is the stamped subject is the same request');
    eq(n1 - n0, 1, 'one record');
    eq(about(PO(), one.id).length, 1, 'one push');
    eq(about(TG(), one.id).length, 1, 'one Telegram message');
    eq(stub.captured.filter((c) => c.url.startsWith('/formsubmit')).length - f0, 1, 'one email fallback');
    const three = await submitAt(plus(t, 11), 'Double Dan');
    ok(three.id && three.id !== one.id, 'the same words 11 minutes later are a new request', three.id);
    await waitFor(() => about(PO(), three.id).length >= 1);
    await done(one.id); await done(three.id);
    R['10'] = { first: one.id, second_at_plus3: two.id, same_token: two.token === one.token, records_added: n1 - n0, pushover: about(PO(), one.id).length, telegram: about(TG(), one.id).length, third_at_plus11: three.id };
  }

  /* ============================================================ (11) */
  suite('D · (11) two runs at once on one due record → one push');
  {
    /* Two runs started together on one due record, then three runs on three due records — the second
       widens the window in which both runs have read the record before either has claimed it. */
    const t = CT(...DAY_A, 15, 0);
    const rita = await submitAt(t, 'Race Rita');
    await waitFor(() => about(PO(), rita.id).length >= 1);
    const b = PO().length;
    const [a1, a2] = await Promise.all([runAt(plus(t, 16)), runAt(plus(t, 16))]);
    await sleep(500);
    const got = about(PO().slice(b), rita.id);
    eq(got.length, 1, 'two runs together: exactly one push');
    const how = (o, id) => (o.sent.some((s) => s.id === id) ? 'sent' : o.skipped_claims.includes(id) ? 'lost the claim' : 'found it already moved');
    const pair = [how(a1, rita.id), how(a2, rita.id)];
    eq(pair.filter((x) => x === 'sent').length, 1, 'one run sent it; the other did not', pair.join(' / '));
    await done(rita.id);

    const t3 = CT(...DAY_A, 15, 30);
    const trio = [await submitAt(t3, 'Race Rhea'), await submitAt(t3, 'Race Ruth'), await submitAt(t3, 'Race Rosa')];
    await waitFor(() => trio.every((x) => about(PO(), x.id).length >= 1));
    const b3 = PO().length;
    const outs = await Promise.all([runAt(plus(t3, 16)), runAt(plus(t3, 16)), runAt(plus(t3, 16))]);
    await sleep(500);
    const per = trio.map((x) => about(PO().slice(b3), x.id).length);
    eq(per.join(','), '1,1,1', 'three runs on three due records: one push each');
    const paths = trio.map((x) => outs.map((o) => how(o, x.id)));
    for (const x of trio) await done(x.id);

    /* The claim itself: both runs are held for 1 s between reading and claiming, so BOTH see the record
       due and BOTH write a claim. Only the claim that stuck may send. */
    const t4 = CT(...DAY_A, 16, 0);
    const rae = await submitAt(t4, 'Race Rae');
    await waitFor(() => about(PO(), rae.id).length >= 1);
    const b4 = PO().length;
    const runPaused = () => json(`${W}/__run-alerts?k=${ADMIN_KEY}&now=${encodeURIComponent(plus(t4, 16))}&pause=1000`, { method: 'POST' }).then((r) => r.body);
    const both = await Promise.all([runPaused(), runPaused()]);
    await sleep(500);
    const raeGot = about(PO().slice(b4), rae.id).length;
    const raePaths = both.map((o) => how(o, rae.id));
    eq(raeGot, 1, 'both runs claimed it: still exactly one push');
    ok(raePaths.includes('sent') && raePaths.includes('lost the claim'), 'one run sent, the other lost the claim', raePaths.join(' / '));
    await done(rae.id);
    R['11'] = {
      pair: { id: rita.id, pushes: got.length, runs: pair },
      trio: trio.map((x, i) => ({ id: x.id, pushes: per[i], runs: paths[i] })),
      both_claimed: { id: rae.id, pushes: raeGot, runs: raePaths },
      lost_claims_seen: paths.flat().concat(pair, raePaths).filter((p) => p === 'lost the claim').length,
    };
  }

  /* ============================================================ (7) */
  suite('D · (7) 10:15 PM: nothing until one 7:00 AM summary');
  let nate;
  {
    const t = CT(...DAY_A, 22, 15);
    nate = await submitAt(t, 'Night Nate');
    await sleep(3000);
    let po = about(PO(), nate.id).length, tg = about(TG(), nate.id).length;
    eq(po + tg, 0, 'nothing at 10:15 PM');
    const quiet = [CT(...DAY_A, 22, 20), CT(...DAY_A, 23, 0), CT(...DAY_B, 2, 0), CT(...DAY_B, 6, 55)];
    const outs = [];
    for (const q of quiet) outs.push(await runAt(q));
    eq(about(PO(), nate.id).length + about(TG(), nate.id).length, 0, 'nothing from the runs at 10:20 PM, 11:00 PM, 2:00 AM, 6:55 AM');
    const b = PO().length, bt = TG().length;
    const o7 = await runAt(CT(...DAY_B, 7, 0));
    const s = about(PO().slice(b), nate.id);
    eq(s.length, 1, 'at 7:00 one push names it');
    ok(s[0] && s[0].p.get('title').startsWith('MORNING SUMMARY'), 'the summary', s[0] && s[0].p.get('title'));
    eq(s[0] && s[0].p.get('priority'), '1', 'normal priority (no visit on the calendar)');
    eq(PO().slice(b).length, 1, 'and it is the only push at 7:00');
    eq(about(TG().slice(bt), nate.id).length, 1, 'Telegram carries the same summary');
    const b5 = PO().length;
    await runAt(CT(...DAY_B, 7, 5));
    eq(about(PO().slice(b5), nate.id).length, 0, 'the 7:05 run adds nothing');
    const r = await row(nate.id);
    R['7'] = {
      id: nate.id, received: t, calls_before_7: po + tg, quiet_runs: quiet.length, quiet_runs_open_flag: outs.map((o) => o.open),
      at_7: { pushover: s.length, title: s[0] && s[0].p.get('title'), message: s[0] && s[0].p.get('message'), priority: s[0] && s[0].p.get('priority'), telegram: about(TG().slice(bt), nate.id).length, summary: o7.summary && o7.summary.summary },
      due_at: r.alerts.due_at, count: r.alerts.count,
    };

    /* the other half of the rule: a visit on the calendar before the due time makes it urgent */
    const vic = await submitAt(CT(...DAY_B, 10, 0), 'Visit Vic');
    await tap(vic.id, 'scheduled', CT(...DAY_B, 10, 30), { scheduled_for: CT(...DAY_C, 8, 0) });
    await done(nate.id);
    const ella = await submitAt(CT(...DAY_C, 5, 30), 'Early Ella');
    await sleep(1500);
    const e0 = about(PO(), ella.id).length;
    const bc = PO().length;
    await runAt(CT(...DAY_C, 7, 0));
    const u = about(PO().slice(bc), ella.id);
    eq(e0, 0, 'a 5:30 AM request is not pushed at 5:30');
    eq(u.length, 1, 'at 7:00 one summary names it');
    eq(u[0] && u[0].p.get('priority'), '2', 'priority 2 because a visit is booked before its 9:00 AM due time');
    ok(u[0] && u[0].p.get('title').startsWith('QUOTE BEFORE YOU LEAVE'), '"quote before you leave"', u[0] && u[0].p.get('title'));
    ok(u[0] && u[0].p.get('message').includes('8:00 AM'), 'naming the visit time', u[0] && u[0].p.get('message'));
    eq(u[0] && u[0].p.get('tags'), 'req_' + ella.id, 'tagged so an ack cancels it');
    await done(ella.id);
    R['7'].visit_variant = { id: ella.id, received: CT(...DAY_C, 5, 30), visit: CT(...DAY_C, 8, 0), pushes_before_7: e0, at_7: u.length, priority: u[0] && u[0].p.get('priority'), title: u[0] && u[0].p.get('title'), message: u[0] && u[0].p.get('message') };
  }

  /* ============================================================ (3) and (12) */
  suite('D · (3) the due-time table, and (12) the register counts business minutes');
  {
    const t830 = CT(...DAY_A, 20, 30);
    const tOct = CT(2026, 10, 31, 20, 30);
    const r830 = await submitAt(t830, 'Table Tina');
    const rOct = await submitAt(tOct, 'Halloween Hal');
    const cases = [
      { label: '7:28 AM', id: alice.id, want: '2026-09-24 9:28 AM' },
      { label: '8:30 PM', id: r830.id, want: '2026-09-25 8:30 AM' },
      { label: '10:15 PM', id: nate.id, want: '2026-09-25 9:00 AM' },
      { label: 'Sat 31 Oct 8:30 PM', id: rOct.id, want: '2026-11-01 8:30 AM' },
    ];
    R['3'] = []; R['12'] = [];
    for (const c of cases) {
      const r = await row(c.id);
      const md0 = await (await fetch(`${W}/api/export/${c.id}.md?k=${ADMIN_KEY}`)).text();
      const dueLine = (md0.split('\n').find((l) => l.startsWith('| `quote due`')) || '');
      const shown = (/\| (\d{4}-\d\d-\d\d \d{1,2}:\d\d [AP]M) Central/.exec(dueLine) || [])[1];
      eq(shown, c.want, `${c.label} → due ${c.want}`);
      R['3'].push({ received: c.label, received_utc: r.received_at, due_at_utc: r.alerts.due_at, register_due: shown, raw_minutes_to_due: Math.round((Date.parse(r.alerts.due_at) - Date.parse(r.received_at)) / 60000) });

      /* quoted exactly at the due time: 120 business minutes, whatever the clock says */
      await tap(c.id, 'quoted', r.alerts.due_at, { quote_amount: 100 });
      const md = await (await fetch(`${W}/api/export/${c.id}.md?k=${ADMIN_KEY}`)).text();
      const line = md.split('\n').find((l) => l.startsWith('| **2-hour window met?**')) || '';
      const cell = (/\| \*\*2-hour window met\?\*\* \| ([^|]+?) — \*business/.exec(line) || [])[1];
      const raw = (md.split('\n').find((l) => l.startsWith('| `minutes_to_quote`')) || '').split('|')[2];
      eq(cell, 'YES — 120 business min', `${c.label}: quoted at the due time reads YES — 120 business min`);
      R['12'].push({ received: c.label, quoted_at: r.alerts.due_at, register: cell, raw_minutes_to_quote: raw && raw.trim() });
    }
    /* one minute late is late */
    await tap(larry.id, 'quoted', CT(...DAY_A, 11, 1), { quote_amount: 100 });
    const mdL = await (await fetch(`${W}/api/export/${larry.id}.md?k=${ADMIN_KEY}`)).text();
    const lateCell = (/\| \*\*2-hour window met\?\*\* \| ([^|]+?) — \*business/.exec(mdL.split('\n').find((l) => l.startsWith('| **2-hour window met?**')) || '') || [])[1];
    eq(lateCell, 'NO — 121 business min', 'a quote one minute past due reads NO — 121 business min');
    R['12'].push({ received: '9:00 AM (Larry)', quoted_at: CT(...DAY_A, 11, 1), register: lateCell });
  }

  return R;
}
