/* SUITE D · THE PHONE (ALERTS-01, 2026-09-23). Replaces the Stage 1 "90-minute nudge" suite, whose
   push service was removed by the same round. Thirteen readings, each against the real `wrangler dev`
   and the fake Pushover / Telegram in lib/servers.mjs. Every moment is named with the test hooks
   (x-umbra-test-now on a submission, ?now= on the cron body), so the ladder is walked in minutes of
   wall time instead of hours. Readings are returned with their actual values for the round's close. */

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
    for (const j of jobs) if (j.status === 'received') await seen(j.id);
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
  suite('D · (4) +16 min: one priority-2 push; +17 min: nothing');
  {
    const b = PO().length, bt = TG().length;
    const out16 = await runAt(plus(T0, 16));
    const po16 = PO().slice(b);
    eq(about(po16, alice.id).length, 1, 'the run at +16 sends exactly one push for it');
    const p = po16[0] && po16[0].p;
    eq(p && p.get('priority'), '2', 'priority 2 (the repeating kind)');
    eq(p && p.get('retry'), '120', 'retry 120');
    eq(p && p.get('expire'), '1800', 'expire 1800');
    eq(p && p.get('tags'), 'req_' + alice.id, 'tag req_<id>');
    eq(p && p.get('callback'), `${W}/hooks/pushover/${FAKE.HOOK_SECRET}`, 'callback = PUBLIC_BASE_URL + /hooks/pushover/<HOOK_SECRET>');
    ok(po16[0] && leaks(po16[0]).length === 0, 'the message itself carries no link and no secret', po16[0] && leaks(po16[0]).join(','));
    const b17 = PO().length, bt17 = TG().length;
    const out17 = await runAt(plus(T0, 17));
    eq(PO().length - b17, 0, 'the run at +17 sends nothing to Pushover');
    eq(TG().length - bt17, 0, 'and nothing to Telegram');
    R['4'] = {
      run16: { pushover: PO().slice(b, b17).length, telegram: TG().slice(bt, bt17).length, priority: p && p.get('priority'), retry: p && p.get('retry'), expire: p && p.get('expire'), tags: p && p.get('tags'), callback_path: p && p.get('callback') && p.get('callback').replace(FAKE.HOOK_SECRET, '<HOOK_SECRET>'), title: p && p.get('title'), receipt_issued: Boolean(po16[0] && po16[0].receipt), sent: out16.sent.map((s) => s.step + ':' + s.id) },
      run17: { pushover: PO().length - b17, telegram: TG().length - bt17, sent: out17.sent.length },
    };
    R['4']._receipt = po16[0] && po16[0].receipt;
  }

  /* ============================================================ (5) */
  suite("D · (5) Pushover's Acknowledge callback");
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
      method: 'POST', headers: { 'x-umbra-test-now': plus(T0, 19) },
      body: new URLSearchParams({ receipt, acknowledged: '1', acknowledged_at: String(Math.floor(Date.parse(plus(T0, 19)) / 1000)), acknowledged_by: FAKE.PUSHOVER_USER }),
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
    const b = PO().length, bt = TG().length;
    for (const m of [46, 76, 121, 200]) await runAt(plus(T0, m));
    eq(about(PO().slice(b), alice.id).length, 0, 'later runs (+46, +76, +121, +200) push nothing for it');
    eq(about(TG().slice(bt), alice.id).length, 0, 'and send no Telegram');
    R['5'] = {
      wrong_secret: wrong.status, unknown_receipt: unknown.status, nothing_written_on_404: true,
      good: good.status, ack_at: r.alerts.ack_at, ack_by: r.alerts.ack_by,
      cancel_by_tag_calls: cancels.length, cancel_url: cancels[0] && cancels[0].url, repeat_callback_status: again.status,
      later_runs_pushover: about(PO().slice(b), alice.id).length, later_runs_telegram: about(TG().slice(bt), alice.id).length,
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
    eq(about(PO().slice(b), tony.id).filter((c) => c.p.get('priority') === '2').length, 1, 'Tony got his priority-2 push at +16');
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
    const b2 = PO().length;
    for (const m of [[8, 1], [8, 31], [9, 50]]) await runAt(CT(...DAY_A, ...m));
    eq(about(PO().slice(b2), tony.id).length + about(PO().slice(b2), sam.id).length, 0, 'later runs are silent for both');
    R['6'] = {
      tony: tony.id, tap_status: t.status, tap_ack_at: rt.alerts.ack_at, tap_ack_by: rt.alerts.ack_by, tap_cancel_calls: ct.length,
      sam: sam.id, seen_no_key: noKey.status, seen_bad_key: badKey.status, seen_with_key: yes.status, seen_ack_at: rs.alerts.ack_at, seen_ack_by: rs.alerts.ack_by, seen_cancel_calls: CANCELS().length - c1 - 0,
      later_runs_pushover: about(PO().slice(b2), tony.id).length + about(PO().slice(b2), sam.id).length,
    };
  }

  /* ============================================================ (8) */
  suite('D · (8) the ladder to OVERDUE, then silence');
  let larry;
  {
    const t = CT(...DAY_A, 9, 0);
    larry = await submitAt(t, 'Late Larry');
    await waitFor(() => about(PO(), larry.id).length >= 1);
    const plan = [16, 46, 76, 106, 121, 126, 180, 300, 715];   /* +715 = 8:55 PM */
    const per = [];
    for (const m of plan) {
      const b = PO().length;
      await runAt(plus(t, m));
      const got = about(PO().slice(b), larry.id);
      per.push({ at: '+' + m, pushes: got.length, priority: got.map((c) => c.p.get('priority')).join(','), title: got.map((c) => c.p.get('title')).join(' | ') });
    }
    eq(per.map((x) => x.pushes).join(','), '1,1,1,1,1,0,0,0,0', 'one push at +16/+46/+76/+106, one at +121, then none');
    eq(per[0].priority, '2', 'the +16 push is priority 2');
    ok(per[4].title.startsWith('OVERDUE · ' + larry.id), 'the push one minute past due says OVERDUE', per[4].title);
    eq(per.slice(5).reduce((n, x) => n + x.pushes, 0), 0, 'silence for the rest of the day');
    const r = await row(larry.id);
    eq(r.alerts.stage, 'done', 'the ladder is finished');
    eq(r.alerts.next_at, null, 'with no next step');
    R['8'] = { id: larry.id, received: t, due_at: r.alerts.due_at, runs: per, stage: r.alerts.stage, count: r.alerts.count };
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
    await seen(fran.id);
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
    await seen(one.id); await seen(three.id);
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
    await seen(rita.id);

    const t3 = CT(...DAY_A, 15, 30);
    const trio = [await submitAt(t3, 'Race Rhea'), await submitAt(t3, 'Race Ruth'), await submitAt(t3, 'Race Rosa')];
    await waitFor(() => trio.every((x) => about(PO(), x.id).length >= 1));
    const b3 = PO().length;
    const outs = await Promise.all([runAt(plus(t3, 16)), runAt(plus(t3, 16)), runAt(plus(t3, 16))]);
    await sleep(500);
    const per = trio.map((x) => about(PO().slice(b3), x.id).length);
    eq(per.join(','), '1,1,1', 'three runs on three due records: one push each');
    const paths = trio.map((x) => outs.map((o) => how(o, x.id)));
    for (const x of trio) await seen(x.id);

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
    await seen(rae.id);
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
    await seen(nate.id);
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
    await seen(ella.id);
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
