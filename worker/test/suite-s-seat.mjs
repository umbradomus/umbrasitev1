/* SUITE S · THE SEAT'S READINGS ON REMINDERS-01 (1Supe7, account 1, 2026-09-25).

   Written RED-FIRST against the merged tree main 1120fc5 + reminders-01 3b81757 (tree 4dd36cd), from the seat's
   independent review (Bridge\REMINDERS-01\SEAT-OPUS-REVIEW-REMINDERS-01-CLOSE.md), then GREEN on the seat's fix.
   Same rig as suite J: the real `wrangler dev`, the fake Pushover and Telegram, the contract fake of SMSGate on
   127.0.0.1. NOTHING IS EVER SENT. Every moment is named through the gated hooks; the requests are invented
   (956-555-0xxx, invented names), on days no other suite uses (19–22 October 2026).

   (1) B1 · the BOOK said "accepted" but KV never learned it (a lost write after the call): the next run adopts the
       mark — ONE queued push, the second clock, and never a second POST
   (2) B1 · the same after a REFUSED call: the next run adopts it — one "did not go" push, the ladder ends
   (3) S2 · a No-text tap that lands between the run's listing and its claim is kept: no POST, no push
   (4) S1 · a priority-2 push retried after a 5xx is cut to the seconds left before 9 PM, not the expire it was
       first built with
   (5) B1 · putRecord waits out KV's one-write-per-key-per-second rule (429) once — a unit reading, no Worker
   (6) N4 · a push base override is honoured only with the test hooks on AND a 127.0.0.1 address — fetch is stubbed
   (7) N5 · a first name holding "$&" reaches the text as letters, not as a replace pattern                       */

import { chicagoWall } from '../src/biztime.js';
import { putRecord } from '../src/store.js';
import { sendAlert } from '../src/notify.js';
import { holdingText } from '../src/holding.js';

export async function suiteSeat({ W, stub, gate, ADMIN_KEY, suite, ok, eq, json, sleep }) {
  const R = {};
  const CT = (y, mo, d, h, mi) => new Date(chicagoWall(y, mo, d, h, mi)).toISOString();
  const PO = () => stub.captured
    .filter((c) => c.method === 'POST' && c.url === '/pushover/1/messages.json')
    .map((c) => Object.assign(c, { p: new URLSearchParams(c.body.toString('utf8')) }));
  const titleOf = (c) => c.p.get('title');
  const mine = (id) => PO().filter((c) => titleOf(c).includes(id));
  const posts = () => gate.requests.filter((r) => r.method === 'POST' && r.path === '/3rdparty/v1/messages');
  const H = (now) => ({ 'content-type': 'application/json', ...(now ? { 'x-umbra-test-now': now } : {}) });

  async function submit(iso, f) {
    const fd = new FormData();
    fd.set('_subject', 'Service request from umbradomus.com');
    fd.set('_next', 'https://www.umbradomus.com/request-received');
    fd.set('service', 'Drywall & Paint');
    for (const [k, v] of Object.entries(f)) fd.set(k, v);
    const r = await fetch(`${W}/intake`, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
    const u = r.headers.get('location') ? new URL(r.headers.get('location')) : null;
    return { status: r.status, id: u && u.searchParams.get('id') };
  }
  let serial = 60;
  const who = (name) => ({
    avail_form: 'v1', avail_flexible: 'yes',
    sms_consent: 'yes', sms_consent_lang: 'en', sms_consent_version: 'sms-v2',
    name, phone: '(956) 555-0' + String(++serial).padStart(3, '0'),
    address: `${serial} Invented Lane, Brownsville`,
    what: `An invented crack over the invented door, request ${serial}.`,
  });
  async function runAt(iso, extra = '') {
    const before = PO().length;
    const r = (await json(`${W}/__run-alerts?k=${ADMIN_KEY}&now=${encodeURIComponent(iso)}${extra}`, { method: 'POST' })).body;
    for (const c of PO().slice(before)) c.runNow = iso;
    return r;
  }
  async function walk(fromIso, toIso, step = 5) {
    for (let t = Date.parse(fromIso); t <= Date.parse(toIso); t += step * 60000) await runAt(new Date(t).toISOString());
  }
  const record = (id) => json(`${W}/__record/${id}?k=${ADMIN_KEY}`, { method: 'POST' }).then((r) => r.body);
  const poke = (id, patch) => json(`${W}/__poke/${id}?k=${ADMIN_KEY}`, { method: 'POST', headers: H(), body: JSON.stringify(patch) }).then((r) => r.body);
  const bookDump = () => json(`${W}/__book-dump?k=${ADMIN_KEY}`, { method: 'POST', headers: H(), body: '{}' }).then((r) => r.body);
  const noText = (id, when) => json(`${W}/admin/no-text/${id}?k=${ADMIN_KEY}`, { method: 'POST', headers: H(when) });
  const markOf = async (id) => ((await bookDump()).marks || []).find((m) => m.key === 'hold:' + id) || null;

  /* ====================================================================== (1) */
  suite('S · (1) B1: KV behind an ACCEPTED mark — the next run adopts it, once, and never a second POST');
  {
    gate.state.mode = 'ok';
    const t0 = CT(2026, 10, 19, 9, 0);                              /* Monday 19 October 2026, 9:00 AM */
    const s = await submit(t0, who('Adopt Accepted'));
    const id = s.id;
    ok(!!id, '(1) the request lands', String(s.status));
    await walk(CT(2026, 10, 19, 9, 5), CT(2026, 10, 19, 11, 0));
    const p0 = posts().length, q0 = mine(id).filter((c) => titleOf(c).startsWith('HOLDING TEXT QUEUED')).length;
    eq(p0, 1, '(1) one POST at 11:00');
    eq(q0, 1, '(1) one QUEUED push at 11:00');
    const before = await record(id);
    eq(before.alerts.holding.state, 'accepted', '(1) KV says accepted');
    eq(before.alerts.table.clock, 2, '(1) KV is on clock 2');
    /* the lost write: KV never learned how the call ended — no holding block at all, clock 1 with every rung fired */
    const bent = JSON.parse(JSON.stringify(before.alerts));
    delete bent.holding; delete bent.second_clock_started_at;
    bent.table = { clock: 1, fired: [15, 30, 45, 60, 70, 80, 90, 95, 100, 105, 110, 115], skipped: [], ended_at: null, end_reason: null };
    bent.stage = 'ladder';
    await poke(id, { set: { alerts: bent } });
    const stuck = await record(id);
    eq(stuck.alerts.table.clock, 1, '(1) KV bent back to clock 1, no holding block', JSON.stringify(stuck.alerts.holding));
    const mark = await markOf(id);
    eq(mark && mark.state, 'accepted', '(1) the BOOK still says accepted');

    const r1 = await runAt(CT(2026, 10, 19, 11, 5));
    const adopted = (r1.adopted || []).filter((x) => x.id === id);
    eq(adopted.length, 1, '(1) 11:05 — the run adopted the mark', JSON.stringify(r1.adopted || r1.skipped_claims));
    eq(posts().length, p0, '(1) no second POST to the gateway');
    const q1 = mine(id).filter((c) => titleOf(c).startsWith('HOLDING TEXT QUEUED'));
    eq(q1.length, 2, '(1) one more QUEUED push (two in all: the real one and the adopted one)');
    const after = await record(id);
    eq(after.alerts.holding && after.alerts.holding.state, 'accepted', '(1) KV now says accepted');
    eq(after.alerts.holding && after.alerts.holding.gateway_id, id + '-hold', '(1) with the gateway id from the mark');
    ok(!!(after.alerts.holding && after.alerts.holding.adopted_at), '(1) and says it was adopted');
    eq(after.alerts.table.clock, 2, '(1) the second clock is on');
    eq(after.alerts.second_clock_started_at, CT(2026, 10, 19, 11, 0), '(1) anchored at the mark\'s own minute (11:00)', after.alerts.second_clock_started_at);
    const r2 = await runAt(CT(2026, 10, 19, 11, 10));
    eq((r2.adopted || []).filter((x) => x.id === id).length, 0, '(1) 11:10 — adopted once, not again');
    eq(mine(id).filter((c) => titleOf(c).startsWith('HOLDING TEXT QUEUED')).length, 2, '(1) and no third QUEUED push');
    await runAt(CT(2026, 10, 19, 11, 15));
    const slot = mine(id).filter((c) => /STILL OPEN/.test(titleOf(c)) && c.runNow === CT(2026, 10, 19, 11, 15));
    eq(slot.length, 1, '(1) 11:15 — the second clock\'s first rung fires');
    ok(slot[0] && /105 min left/.test(slot[0].p.get('title')), '(1) with 105 minutes left', slot[0] && slot[0].p.get('title'));
    eq(posts().length, p0, '(1) still one POST');
    R['1'] = { id, posts: posts().length, queued: q1.length, second_clock_started_at: after.alerts.second_clock_started_at };
  }

  /* ====================================================================== (2) */
  suite('S · (2) B1: KV behind a REFUSED mark — the next run adopts it: one "did not go" push, the ladder ends');
  {
    gate.state.mode = '401';
    const t0 = CT(2026, 10, 20, 9, 0);
    const { id } = await submit(t0, who('Adopt Refused'));
    await walk(CT(2026, 10, 20, 9, 5), CT(2026, 10, 20, 11, 0));
    const p0 = posts().length;
    const before = await record(id);
    eq(before.alerts.holding.state, 'refused', '(2) KV says refused after the 401');
    eq(before.alerts.table.end_reason, 'holding_refused', '(2) the ladder ended');
    const f0 = mine(id).filter((c) => titleOf(c).startsWith('HOLDING TEXT DID NOT GO')).length;
    eq(f0, 1, '(2) one DID NOT GO push');
    const bent = JSON.parse(JSON.stringify(before.alerts));
    delete bent.holding;
    bent.table = { ...bent.table, ended_at: null, end_reason: null };
    bent.stage = 'ladder';
    await poke(id, { set: { alerts: bent } });
    const r1 = await runAt(CT(2026, 10, 20, 11, 5));
    eq((r1.adopted || []).filter((x) => x.id === id).length, 1, '(2) 11:05 — adopted', JSON.stringify(r1.adopted || r1.skipped_claims));
    eq(posts().length, p0, '(2) no second POST');
    eq(mine(id).filter((c) => titleOf(c).startsWith('HOLDING TEXT DID NOT GO')).length, 2, '(2) one more DID NOT GO push');
    const after = await record(id);
    eq(after.alerts.holding && after.alerts.holding.state, 'refused', '(2) KV now says refused');
    eq(after.alerts.table.end_reason, 'holding_refused', '(2) the ladder is ended again');
    await runAt(CT(2026, 10, 20, 11, 10)); await runAt(CT(2026, 10, 20, 13, 5));
    eq(mine(id).filter((c) => c.runNow && Date.parse(c.runNow) > Date.parse(CT(2026, 10, 20, 11, 5))).length, 0, '(2) and nothing after');
    gate.state.mode = 'ok';
    R['2'] = { id, posts: posts().length - p0 };
  }

  /* ====================================================================== (3) */
  suite('S · (3) S2: a No-text tap between the run\'s listing and its claim is kept — no POST, no push');
  {
    gate.state.mode = 'ok';
    const t0 = CT(2026, 10, 21, 9, 0);
    const { id } = await submit(t0, who('Tap Mid Run'));
    await walk(CT(2026, 10, 21, 9, 5), CT(2026, 10, 21, 10, 55));
    const p0 = posts().length, m0 = mine(id).length;
    /* the 11:00 run reads its listing, then holds 2.5 s (the test hook); the tap lands inside that hold */
    const run = runAt(CT(2026, 10, 21, 11, 0), '&pause=2500');
    await sleep(900);
    const tap = await noText(id, CT(2026, 10, 21, 11, 0, 1));
    eq(tap.status, 200, '(3) the tap is accepted at 11:00:01');
    const r = await run;
    eq(posts().length, p0, '(3) NO POST to the gateway');
    eq(mine(id).length, m0, '(3) no push for this request');
    const after = await record(id);
    ok(!!after.alerts.no_text_at, '(3) the tap is still on the record', JSON.stringify({ no_text_at: after.alerts.no_text_at }));
    eq(after.alerts.table.end_reason, 'no_text_tap', '(3) and the ladder ended on it');
    eq(after.alerts.table.clock, 1, '(3) no second clock');
    await runAt(CT(2026, 10, 21, 11, 5));
    eq(posts().length, p0, '(3) 11:05 — still no POST');
    R['3'] = { id, stopped: r.stopped, skipped: r.skipped_claims };
  }

  /* ====================================================================== (4) */
  suite('S · (4) S1: a priority-2 push retried after a 5xx is cut to the seconds left before 9 PM');
  {
    const t0 = CT(2026, 10, 22, 18, 55);                           /* Thursday 22 October, 6:55 PM: minute 115 falls at 8:50 PM */
    const { id } = await submit(t0, who('Late Retry'));
    await walk(CT(2026, 10, 22, 19, 0), CT(2026, 10, 22, 20, 45));
    stub.state.pushover = '500';
    await runAt(CT(2026, 10, 22, 20, 50));
    stub.state.pushover = 'ok';
    const failed = mine(id).filter((c) => c.runNow === CT(2026, 10, 22, 20, 50));
    eq(failed.length, 1, '(4) 8:50 PM — the minute-115 push was tried');
    eq(failed[0] && failed[0].answered, 500, '(4) and Pushover answered 500');
    eq(failed[0] && Number(failed[0].p.get('expire')), 600, '(4) it carried expire 600 (ten minutes to close)');
    await runAt(CT(2026, 10, 22, 20, 55));
    const retried = mine(id).filter((c) => c.runNow === CT(2026, 10, 22, 20, 55));
    eq(retried.length, 1, '(4) 8:55 PM — retried once');
    const exp = retried[0] ? Number(retried[0].p.get('expire')) : null;
    ok(exp !== null && exp <= 300, '(4) with expire cut to the five minutes left, not the stored 600', 'expire ' + exp);
    eq(retried[0] && Number(retried[0].p.get('priority')), 2, '(4) still priority 2');
    await runAt(CT(2026, 10, 22, 21, 0)); await runAt(CT(2026, 10, 22, 21, 5));
    eq(mine(id).filter((c) => c.runNow && Date.parse(c.runNow) >= Date.parse(CT(2026, 10, 22, 21, 0))).length, 0, '(4) nothing at or after 9 PM');
    R['4'] = { id, first_expire: failed[0] && Number(failed[0].p.get('expire')), retry_expire: exp };
  }

  /* ====================================================================== (5) */
  suite('S · (5) B1: putRecord waits out KV\'s one-write-per-key-per-second rule once');
  {
    const puts = [];
    const mk = (fails) => ({ RECORDS: { put: async (k, v) => { puts.push({ k, at: Date.now() }); if (fails-- > 0) throw new Error('KV PUT failed: 429 Too Many Requests'); } } });
    const rec = { id: 'U-0999', alerts: {} };
    let t = Date.now();
    await putRecord(mk(1), rec);
    const waited = Date.now() - t;
    eq(puts.length, 2, '(5) one 429, then one more try');
    ok(waited >= 1000 && waited < 3000, '(5) after waiting about a second', waited + ' ms');
    puts.length = 0;
    let err = null;
    try { await putRecord(mk(2), rec); } catch (e) { err = String(e.message); }
    eq(puts.length, 2, '(5) a second 429 is not tried a third time');
    ok(/429/.test(err || ''), '(5) and the error stands', err);
    puts.length = 0; err = null;
    try { await putRecord({ RECORDS: { put: async () => { puts.push(1); throw new Error('KV PUT failed: 500 Internal Error'); } } }, rec); } catch (e) { err = String(e.message); }
    eq(puts.length, 1, '(5) any other error is not retried');
    ok(/500/.test(err || ''), '(5) and stands', err);
    R['5'] = { waited_ms: waited };
  }

  /* ====================================================================== (6) */
  suite('S · (6) N4: a push base override is honoured only with the test hooks on AND a 127.0.0.1 address');
  {
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { seen.push(String(url)); return new Response(JSON.stringify({ status: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }); };
    try {
      const msg = { title: 'test', message: 'test', priority: 0 };
      const base = { PUSHOVER_TOKEN: 'FAKEt', PUSHOVER_USER: 'FAKEu', PUSHOVER_API_BASE: 'http://127.0.0.1:1/pushover' };
      await sendAlert({ ...base }, msg, ['pushover']);
      ok(seen[0] && seen[0].startsWith('https://api.pushover.net/'), '(6) hooks off: the override is ignored and the real host is used', seen[0]);
      await sendAlert({ ...base, ALLOW_TEST_HOOKS: 'true' }, msg, ['pushover']);
      ok(seen[1] && seen[1].startsWith('http://127.0.0.1:1/pushover/'), '(6) hooks on, 127.0.0.1: the override is honoured', seen[1]);
      await sendAlert({ ...base, ALLOW_TEST_HOOKS: 'true', PUSHOVER_API_BASE: 'http://10.0.0.5:8080' }, msg, ['pushover']);
      ok(seen[2] && seen[2].startsWith('https://api.pushover.net/'), '(6) hooks on but not 127.0.0.1: ignored', seen[2]);
    } finally { globalThis.fetch = realFetch; }
    R['6'] = { seen };
  }

  /* ====================================================================== (7) */
  suite('S · (7) N5: a first name holding "$&" reaches the text as letters');
  {
    const rec = { fields: { name: '$&Dollar Sign' }, consent: { lang: 'en' }, page: '/services' };
    const nowMs = chicagoWall(2026, 10, 19, 11, 0);
    const w = holdingText(rec, nowMs);
    ok(!w.error, '(7) the text is built', w.error);
    ok(w.text && w.text.includes('$&Dollar'), '(7) and carries the name as typed', w.text);
    ok(w.text && !/[{}]/.test(w.text), '(7) with no brace left');
    R['7'] = { text: w.text };
  }

  return R;
}
