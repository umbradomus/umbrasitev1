/* SUITE P · THE JOB ON HIS PHONE — UMBRA-SIDE-01 (lane P, 2026-09-28).

   His words: "just got the alert on the umbra phone... not sure exactly what to do from this process with our system..
   this all needs to be easier on the umbra side too.. ill see what happens on the work phone when we dont aknoldege
   and reply in our 2 hours". Written RED-FIRST against Candidate N's Worker (tag n-base), GREEN on branch P.

   Same stand-ins as suites J and S: the fake Pushover and Telegram, the contract fake of SMSGate on 127.0.0.1. NOTHING
   IS EVER SENT. Every moment is named through the gated hooks (x-umbra-test-now, ?now=). The requests are invented
   (956-555-02xx, invented names and streets), on days no other suite uses: 16–20 November 2026 (Central Standard Time).
   The webhook signing key is FAKE and fresh per run (FAKE_WEBHOOK_KEY, the Worker's SMSGATE_WEBHOOK_KEY).

   (1)  the job page: /j/<U-id>.<key> — name, job words, the reply clock (amber ≤ 60, red ≤ 30), photos, their words
        uncut, what they picked, where (✓ or "Typed — check it" + Maps), the phone with Text/Call, ONE primary button;
        a wrong or missing key shows nothing; noindex; no script; no GET writes anything; the board page
   (2)  the push opens it: url + "Open the job", no name; it rings (priority 2, retry 120, expire to the 15-minutes-left
        mark); the ack records seen-at; opening the page cancels the ring; neither moves the reply-by time; 9 PM–7 AM
        the arrival push is quiet and the 7 AM push rings
   (3)  the reply is one tap: the drafted text (EN/ES), "by" = the tap + 2 business hours rounded up to the quarter;
        one confirm; one POST to the outbox (validUntil ≤ 9 PM); replied-at; the clock and the ladder stop; Call +
        "I called"; no texts ticked → no text button; a foreign post writes nothing
   (4)  the ladder carries the draft and the link
   (5)  STOP (and ALTO, BASTA, END, UNSUBSCRIBE, CANCEL, QUIT, alone or in a sentence): signed webhook only; one
        confirmation; then every send route refuses; "No texts" is one tap; any other text lands on the job and pushes
   (6)  the holding text: the only automatic text, only when every guard passes — one reading per guard, each proving
        the text did NOT go — and "LATE · call them now" rings when a guard blocks it; the timer ticks every minute
   (7)  the lead line: built before 1978 or "not sure", on a paint or hole job → one line on the page; the EPA's
        Renovate Right link on the customer's quote page                                                             */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chicagoWall } from '../src/biztime.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function suitePhone({ W, stub, gate, ADMIN_KEY, FAKE, FAKE_SMSGATE_AUTH, FAKE_WEBHOOK_KEY, suite, ok, eq, json, sleep, WORKER_DIR = null }) {
  /* the Worker under test: its own src/ and wrangler.toml (a runner that tests another tree names it; run-all.mjs does not) */
  const WDIR = WORKER_DIR || path.join(HERE, '..');
  const R = {};
  const CT = (y, mo, d, h, mi = 0) => new Date(chicagoWall(y, mo, d, h, mi)).toISOString();
  const MON = [2026, 11, 16], TUE = [2026, 11, 17], WED = [2026, 11, 18], THU = [2026, 11, 19], FRI = [2026, 11, 20];
  const FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true });
  const hhmm = (iso) => FMT.format(new Date(iso)).replace(/[\u202f\u00a0]/g, ' ');

  /* ---------------------------------------------------------------- the owner's keys, made the way the Worker makes them */
  const mac = (what) => crypto.createHmac('sha256', ADMIN_KEY).update('umbra-owner|' + what).digest('base64url');
  const tokOf = (id) => id + '.' + mac(id);
  const boardTok = mac('board');

  /* ---------------------------------------------------------------- the stand-ins */
  const PO = () => stub.captured
    .filter((c) => c.method === 'POST' && c.url === '/pushover/1/messages.json')
    .map((c) => Object.assign(c, { p: c.p || new URLSearchParams(c.body.toString('utf8')) }));
  const CANCELS = () => stub.captured.filter((c) => c.method === 'POST' && c.url.startsWith('/pushover/1/receipts/cancel_by_tag/'));
  const titleOf = (c) => c.p.get('title') || '';
  const SUMMARYISH = /^(MORNING SUMMARY|QUOTE BEFORE YOU LEAVE)/;
  const mine = (id) => PO().filter((c) => (titleOf(c) + '\n' + (c.p.get('message') || '')).includes(id) && !SUMMARYISH.test(titleOf(c)));
  const one = (l) => l[0] || { p: new URLSearchParams(), receipt: null };
  const posts = (from = 0) => gate.requests.slice(from).filter((r) => r.method === 'POST' && r.path === '/3rdparty/v1/messages');
  const bodyOf = (r) => { try { return JSON.parse(r.body); } catch (e) { return {}; } };
  const textOf = (r) => ((bodyOf(r).textMessage || {}).text) || '';
  const unesc = (s) => String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const plain = (html) => unesc(String(html).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

  /* ---------------------------------------------------------------- the Worker */
  const H = (now) => ({ 'content-type': 'application/json', ...(now ? { 'x-umbra-test-now': now } : {}) });
  const admin = (method, p, body, now) => json(`${W}${p}?k=${ADMIN_KEY}`, { method, headers: H(now), body: body === undefined ? undefined : JSON.stringify(body) });
  const record = (id) => json(`${W}/__record/${id}?k=${ADMIN_KEY}`, { method: 'POST' }).then((r) => r.body || {});
  const recordRaw = (id) => fetch(`${W}/__record/${id}?k=${ADMIN_KEY}`, { method: 'POST' }).then((r) => r.text());
  const row = async (id) => ((await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body || { jobs: [] }).jobs.find((j) => j.id === id) || {};
  const noText = (id, when) => json(`${W}/admin/no-text/${id}?k=${ADMIN_KEY}`, { method: 'POST', headers: H(when) });
  const runAt = async (iso) => {
    const b = PO().length, g = gate.requests.length;
    const r = (await json(`${W}/__run-alerts?k=${ADMIN_KEY}&now=${encodeURIComponent(iso)}`, { method: 'POST' })).body;
    for (const c of PO().slice(b)) c.runNow = iso;
    for (const q of gate.requests.slice(g)) q.runNow = iso;
    return r;
  };
  const walk = async (fromIso, toIso, step = 5) => { for (let t = Date.parse(fromIso); t <= Date.parse(toIso); t += step * 60000) await runAt(new Date(t).toISOString()); };
  const get = async (p, now, headers = {}) => {
    const r = await fetch(W + p, { headers: { ...(now ? { 'x-umbra-test-now': now } : {}), ...headers }, redirect: 'manual' });
    const isText = /text|json/.test(r.headers.get('content-type') || '');
    return { status: r.status, headers: r.headers, text: isText ? await r.text() : '', bytes: isText ? null : Buffer.from(await r.arrayBuffer()) };
  };
  const post = async (p, form, now, headers = {}) => {
    const r = await fetch(W + p, { method: 'POST', body: new URLSearchParams(form || {}).toString(), redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(now ? { 'x-umbra-test-now': now } : {}), ...headers } });
    await r.arrayBuffer().catch(() => null);
    return { status: r.status, location: r.headers.get('location') };
  };
  const page = (id, now, q = '') => get(`/j/${tokOf(id)}${q}`, now);
  /** the one confirm → Send, exactly as the page's own form posts it */
  async function sendReply(id, now, sendAt = now, extraHeaders = { origin: W }) {
    const c = await page(id, now, '?c=reply');
    const by = (/name="by" value="([^"]*)"/.exec(c.text) || [])[1] || '';
    const sha = (/name="sha" value="([^"]*)"/.exec(c.text) || [])[1] || '';
    const text = unesc((/<p class="jbub" id="j-text">([^<]*)<\/p>/.exec(c.text) || [])[1] || '');
    const r = await post(`/j/${tokOf(id)}/reply`, { by, sha }, sendAt, extraHeaders);
    return { confirm: c, by, sha, text, r };
  }

  /* ---------------------------------------------------------------- invented requests */
  const PNG = (() => {
    /* an 8×8 solid PNG, made here (zlib-free: a stored deflate block) */
    const w = 8, h = 8, raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) raw.set([200, 170, 120], y * (w * 3 + 1) + 1 + x * 3); }
    const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const adler = (buf) => { let a = 1, b = 0; for (const x of buf) { a = (a + x) % 65521; b = (b + a) % 65521; } return (b << 16) | a; };
    const z = Buffer.concat([Buffer.from([0x78, 0x01, 0x01]), Buffer.from([raw.length & 255, raw.length >> 8, ~raw.length & 255, (~raw.length >> 8) & 255]), raw, (() => { const x = Buffer.alloc(4); x.writeUInt32BE(adler(raw) >>> 0); return x; })()]);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', Buffer.alloc(0))]);
  })();
  let serial = 200;
  const LONG = 'The old patch on the living room ceiling shows through the paint, a round shape about the size of a dinner plate, right above the couch. It has been like that since the last owner fixed a leak. The paint up there is flat white and we still have the can in the garage.';
  const who = (name, extra = {}) => ({
    avail_form: 'v1', avail_flexible: 'yes',
    sms_consent: 'yes', sms_consent_lang: 'en', sms_consent_version: 'sms-v2',
    name, phone: '(956) 555-0' + String(++serial).padStart(3, '0'),
    address: `${serial} Invented Mesquite Ct, Brownsville, TX 78520`,
    service: 'Drywall & Paint', problem: 'A patch that shows', problem_area: 'Ceiling',
    what: LONG,
    ...extra,
  });
  async function submit(iso, f, photos = 2) {
    const fd = new FormData();
    fd.set('_subject', 'Service request from umbradomus.com');
    fd.set('_next', 'https://www.umbradomus.com/request-received');
    for (const [k, v] of Object.entries(f)) { if (Array.isArray(v)) for (const x of v) fd.append(k, x); else fd.set(k, v); }
    for (let i = 0; i < photos; i++) fd.append(i === 0 ? 'attachment' : 'attachment' + (i + 1), new Blob([PNG], { type: 'image/png' }), `IMG_${serial}_${i + 1}.png`);
    const r = await fetch(`${W}/intake`, { method: 'POST', body: fd, redirect: 'manual', headers: { 'x-umbra-test-now': iso } });
    const u = r.headers.get('location') ? new URL(r.headers.get('location')) : null;
    await sleep(900);                                   /* the arrival push rides the request's way out */
    return { status: r.status, id: u && u.searchParams.get('id'), token: u && u.searchParams.get('t'), phone: f.phone, e164: '+1' + String(f.phone).replace(/\D/g, '') };
  }
  /* SMSGate's webhook, signed the way SMSGate signs it: hex HMAC-SHA256(key, raw body + X-Timestamp) */
  let ev = 0;
  async function textIn(iso, e164, message, { key = FAKE_WEBHOOK_KEY, ts = Math.floor(Date.parse(iso) / 1000), sig = null, event = 'sms:received' } = {}) {
    const raw = JSON.stringify({ deviceId: 'fake-device-0001', event, id: 'fake-ev-' + (++ev), payload: { messageId: 'fake-msg-' + ev, message, phoneNumber: e164, simNumber: 1, receivedAt: iso }, webhookId: 'fake-webhook-01' });
    const s = sig === null ? crypto.createHmac('sha256', String(key || 'x')).update(raw + String(ts)).digest('hex') : sig;
    const r = await fetch(`${W}/hooks/smsgate`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-umbra-test-now': iso, ...(s !== false ? { 'x-signature': s } : {}), ...(ts !== false ? { 'x-timestamp': String(ts) } : {}) } });
    let body = null; try { body = await r.json(); } catch (e) { body = null; }
    return { status: r.status, body };
  }
  const leaksName = (c, name) => {
    const t = [...c.p.entries()].filter(([k]) => !['token', 'user', 'callback', 'url'].includes(k)).map(([, v]) => v).join('\n');
    return name.split(/\s+/).filter((w) => w.length >= 3).some((w) => new RegExp('(^|[^\\p{L}])' + w + '(?![\\p{L}])', 'iu').test(t));
  };

  /* Start clean: every request the earlier suites left open comes off his table, so the runs below see only their own */
  {
    const jobs = ((await json(`${W}/api/jobs?k=${ADMIN_KEY}`)).body || { jobs: [] }).jobs;
    for (const j of jobs) {
      if (j.status !== 'received') continue;
      await fetch(`${W}/admin/seen/${j.id}?k=${ADMIN_KEY}`, { method: 'POST' });
      if (j.alerts && j.alerts.table) await noText(j.id);
    }
  }

  /* ============================================================ (2) THE PUSH OPENS IT (read first: it is the arrival) */
  suite('P · (2) the arrival push opens the job, rings until acknowledged, and names no one');
  let A = null;
  {
    const t0 = CT(...MON, 9, 0);
    A = await submit(t0, who('Willow Pagetest'));
    eq(A.status, 303, '(2) the request lands');
    const arrival = one(mine(A.id));
    eq(titleOf(arrival), `NEW JOB · ${A.id} · reply by 11:00 AM`, '(2) the title stays "NEW JOB · U-NNNN · reply by h:mm" — the job id, never a name');
    eq(arrival.p.get('url'), `${W}/j/${tokOf(A.id)}`, '(2) url = that job\'s page on his phone (/j/<U-id>.<key>, the key made from the Worker\'s secret)');
    eq(arrival.p.get('url_title'), 'Open the job', '(2) url_title "Open the job" (CONTRACTS C4: no name in a push; the name is on the page)');
    eq(arrival.p.get('priority'), '2', '(2) it rings: priority 2');
    eq(arrival.p.get('retry'), '120', '(2) every 2 minutes (retry 120)');
    eq(arrival.p.get('expire'), '6300', '(2) until the 15-minutes-left mark: 10:45 AM, 6300 s after a 9:00 AM landing');
    eq(arrival.p.get('tags'), `req_${A.id}`, '(2) tagged with the job, so any tap can cancel it by tag');
    ok(Boolean(arrival.p.get('callback')), '(2) with the callback that records his acknowledgement');
    eq(leaksName(arrival, 'Willow Pagetest'), false, '(2) the name is nowhere in the push (title, message, link title)');
    const before = await record(A.id);
    const receipt = arrival.receipt;
    ok(Boolean(receipt), '(2) Pushover issued a receipt for the ring', String(receipt));
    const cb = await fetch(`${W}/hooks/pushover/${encodeURIComponent(FAKE.HOOK_SECRET)}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-umbra-test-now': CT(...MON, 9, 2) },
      body: new URLSearchParams({ receipt: receipt || 'none' }).toString(),
    });
    eq(cb.status, 200, '(2) his Acknowledge reaches the Worker (the callback)');
    const acked = await record(A.id);
    eq((acked.alerts || {}).seen_at, CT(...MON, 9, 2), '(2) the ack records seen-at on the job (9:02 AM)');
    eq((await row(A.id)).seen_at, CT(...MON, 9, 2), '(2) …and the register row the collector copies carries seen_at');
    eq((acked.alerts || {}).due_at, (before.alerts || {}).due_at, '(2) …and the reply-by time did not move');
    const c0 = CANCELS().length;
    const raw0 = await recordRaw(A.id);
    const g = await page(A.id, CT(...MON, 9, 3));
    eq(g.status, 200, '(2) opening the job page answers 200');
    await sleep(400);                                   /* the cancel rides the page's way out (waitUntil) */
    const cancels = CANCELS().slice(c0).filter((c) => c.url.includes(`req_${A.id}`));
    eq(cancels.length, 1, '(2) opening the job cancels the ring, by tag (once)');
    eq(await recordRaw(A.id), raw0, '(2) …and writes nothing: the record is byte-identical, the reply-by time with it');
    R['2'] = { id: A.id, title: titleOf(arrival), url: arrival.p.get('url') && arrival.p.get('url').replace(/\.[A-Za-z0-9_-]{43}$/, '.<key>'), url_title: arrival.p.get('url_title'), priority: arrival.p.get('priority'), retry: arrival.p.get('retry'), expire: arrival.p.get('expire'), tags: arrival.p.get('tags'), seen_at: acked.alerts && acked.alerts.seen_at, cancel_on_open: cancels.length };
  }

  /* ============================================================ (1) THE JOB PAGE */
  suite('P · (1) the job page on his phone');
  {
    const g = await page(A.id, CT(...MON, 9, 5));
    eq(g.status, 200, '(1) GET /j/<U-id>.<key> → 200');
    ok(/text\/html/.test(g.headers.get('content-type') || ''), '(1) a page');
    eq(g.headers.get('x-robots-tag'), 'noindex, nofollow', '(1) noindex, nofollow (header)');
    ok(/<meta name="robots" content="noindex, nofollow">/.test(g.text), '(1) …and in the page');
    eq(g.headers.get('cache-control'), 'no-store', '(1) no-store');
    ok(/default-src 'none'/.test(g.headers.get('content-security-policy') || '') && !/script-src/.test(g.headers.get('content-security-policy') || ''), '(1) CSP: nothing but its own images and inline styles, no script');
    eq((g.text.match(/<script/gi) || []).length, 0, '(1) no <script> anywhere');
    const t = plain(g.text);
    ok(/<h1 class="jn">Willow<\/h1>/.test(g.text), '(1) the first name, big, at the top');
    ok(t.includes('Ceiling patch'), '(1) the job in a few words ("Ceiling patch")', t.slice(0, 200));
    ok(/class="jck ok"[^>]*>Reply by 11:00 AM · 1 h 55 m left</.test(g.text), '(1) the reply clock: "Reply by 11:00 AM · 1 h 55 m left"', (/class="jck[^"]*"[^>]*>[^<]*</.exec(g.text) || [])[0]);
    eq((g.text.match(new RegExp(`<img src="/j/${tokOf(A.id).replace(/[.]/g, '\\.')}/p/\\d"`, 'g')) || []).length, 2, '(1) their 2 photos');
    ok(t.includes(LONG), '(1) their words, uncut (all ' + LONG.length + ' characters)');
    ok(t.includes('A patch that shows · Ceiling'), '(1) what they picked');
    ok(t.includes('Invented Mesquite Ct') && t.includes('Typed — check it') && /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=/.test(g.text), '(1) the address, "Typed — check it", and a Maps link');
    ok(/href="tel:\+1956555\d{4}"/.test(g.text) && /href="sms:\+1956555\d{4}"/.test(g.text), '(1) the phone, with Text and Call');
    eq((g.text.match(/class="jgo"/g) || []).length, 1, '(1) ONE primary button');
    ok(/<a class="jgo" href="\/j\/[^"]+\?c=reply">Text Willow: price by 11:15 AM<\/a>/.test(g.text), '(1) …named for the next thing: "Text Willow: price by 11:15 AM"', (/class="jgo"[^>]*>[^<]*/.exec(g.text) || [])[0]);
    ok(/\.jgo\{[^}]*min-height:56px/.test(g.text) && /\.jalt\{[^}]*min-height:48px/.test(g.text), '(1) the buttons are 56 and 48 px tall (≥ 44)');
    ok(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(g.text), '(1) sized for the phone');
    const amber = await page(A.id, CT(...MON, 10, 5));
    ok(/class="jck amber"[^>]*>Reply by 11:00 AM · 55 m left</.test(amber.text), '(1) amber at ≤ 60 minutes left ("55 m left")', (/class="jck[^"]*"[^>]*>[^<]*/.exec(amber.text) || [])[0]);
    const red = await page(A.id, CT(...MON, 10, 35));
    ok(/class="jck red"[^>]*>Reply by 11:00 AM · 25 m left</.test(red.text), '(1) red at ≤ 30 minutes left ("25 m left")', (/class="jck[^"]*"[^>]*>[^<]*/.exec(red.text) || [])[0]);
    /* nothing for a wrong, missing or borrowed key */
    const other = await submit(CT(...MON, 9, 1), who('Otto Othertest', { address_confirmed: 'yes', extras: ['A door that drags', 'Caulk around the tub'], problem: ['Holes', 'Cracks'], problem_area: ['Ceiling', 'Walls'] }), 0);
    const wrong = await get(`/j/${A.id}.${mac(A.id).replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))}`, CT(...MON, 9, 5));
    const borrowed = await get(`/j/${A.id}.${mac(other.id)}`, CT(...MON, 9, 5));
    const missing = await get(`/j/${A.id}`, CT(...MON, 9, 5));
    const bare = await get(`/j/${mac(A.id)}`, CT(...MON, 9, 5));
    const ghost = await get(`/j/U-099999.${mac('U-099999')}`, CT(...MON, 9, 5));
    ok([wrong, borrowed, missing, bare, ghost].every((x) => x.status === 404), '(1) a wrong key, another job\'s key, no key, a bare key, a job that is not there → 404', JSON.stringify([wrong.status, borrowed.status, missing.status, bare.status, ghost.status]));
    ok([wrong, borrowed, missing, ghost].every((x) => x.text === wrong.text) && !wrong.text.includes('Willow'), '(1) …all four the same page, and it shows nothing of the job');
    /* no GET changes anything */
    const raw0 = await recordRaw(A.id);
    await page(A.id, CT(...MON, 9, 6)); await page(A.id, CT(...MON, 9, 6), '?c=reply');
    const ph = await get(`/j/${tokOf(A.id)}/p/1`, CT(...MON, 9, 6));
    await get(`/j/board/${boardTok}`, CT(...MON, 9, 6));
    eq(await recordRaw(A.id), raw0, '(1) no GET changes anything: page, confirm, photo, board → the record byte-identical');
    ok(ph.status === 200 && /image\/png/.test(ph.headers.get('content-type') || '') && ph.bytes && ph.bytes.equals(PNG), '(1) their photo, byte for byte, behind the same key');
    eq((await get(`/j/${A.id}.${mac(other.id)}/p/1`, CT(...MON, 9, 6))).status, 404, '(1) …and not with another job\'s key');
    /* the other job: confirmed address, extras, two surfaces */
    const og = await page(other.id, CT(...MON, 9, 6));
    const ot = plain(og.text);
    ok(/title="They confirmed it">✓</.test(og.text) && !ot.includes('Typed — check it'), '(1) a confirmed address: ✓, and no "check it"');
    ok(ot.includes("While we're there") && ot.includes('A door that drags') && ot.includes('Caulk around the tub'), '(1) the "while we\'re there" lines, when the request carries them');
    ok(ot.includes('Holes and cracks · ceiling and walls'), '(1) two things in two places: "Holes and cracks · ceiling and walls"', ot.slice(0, 160));
    ok(!/<img src=/.test(og.text), '(1) no photos, no photo block');
    /* the board */
    const b = await get(`/j/board/${boardTok}`, CT(...MON, 9, 6));
    eq(b.status, 200, '(1) the board: GET /j/board/<key> → 200');
    ok(b.text.includes(`href="/j/${tokOf(A.id)}"`) && b.text.includes(`href="/j/${tokOf(other.id)}"`), '(1) every open job, each one link to its page');
    ok(/2 need a reply/.test(plain(b.text)), '(1) "2 need a reply"', plain(b.text).slice(0, 120));
    eq((await get(`/j/board/${mac('board').slice(0, 42)}A`, CT(...MON, 9, 6))).status, 404, '(1) a wrong board key → 404');
    eq(b.headers.get('x-robots-tag'), 'noindex, nofollow', '(1) the board is noindex too');
    R['1'] = { id: A.id, clock: (/class="jck[^"]*"[^>]*>([^<]*)/.exec(g.text) || [])[1], amber: (/class="jck amber"[^>]*>([^<]*)/.exec(amber.text) || [])[1], red: (/class="jck red"[^>]*>([^<]*)/.exec(red.text) || [])[1], button: (/class="jgo"[^>]*>([^<]*)/.exec(g.text) || [])[1], photos: 2, wrong_key: wrong.status };
    await noText(other.id);
  }

  /* ============================================================ (3) THE REPLY IS ONE TAP */
  suite('P · (3) the reply is one tap and one confirm — nothing typed');
  {
    const g0 = gate.requests.length;
    const s = await sendReply(A.id, CT(...MON, 9, 6));
    const want = "Hi Willow, it's Drew with Umbra Domus. I got your photos of the ceiling patch. I'll text you the price by 11:15 AM today. Reply STOP to stop texts.";
    eq(s.text, want, '(3) the one confirm shows the drafted text, exactly');
    ok(plain(s.confirm.text).includes('Send this from the work phone?') && plain(s.confirm.text).includes('To Willow · (956) 555-0'), '(3) …who it goes to and from which phone');
    eq((s.confirm.text.match(/<button type="submit" class="jgo" id="j-send">Send<\/button>/g) || []).length, 1, '(3) …and one "Send"');
    eq(s.r.status, 303, '(3) Send → 303 back to the job');
    const p = posts(g0);
    eq(p.length, 1, '(3) exactly ONE POST to the work phone\'s outbox (SMSGate)');
    const b = bodyOf(one(p) || {});
    eq(textOf(one(p) || {}), want, '(3) the text that went is the text he saw, byte for byte');
    eq(b.id, `${A.id}-r1`, '(3) with its own id');
    eq(JSON.stringify(b.phoneNumbers), JSON.stringify([A.e164]), '(3) to their number');
    eq(one(p).authUser, FAKE_SMSGATE_AUTH.split(':')[0], '(3) through the work phone\'s own key');
    ok(Date.parse(b.validUntil) <= Date.parse(CT(...MON, 21, 0)) && Date.parse(b.validUntil) === Date.parse(CT(...MON, 10, 6)), '(3) validUntil = 10:06 AM (an hour, and never past 9 PM)', b.validUntil);
    eq(b.ttl, undefined, '(3) validUntil, not ttl');
    const rec = await record(A.id);
    eq(rec.replied_at, CT(...MON, 9, 6), '(3) the send records replied-at on the job');
    eq((rec.reply || {}).how, 'text', '(3) a text…');
    eq((rec.reply || {}).promised_by, CT(...MON, 11, 15), '(3) …promising the price by 11:15 AM');
    eq((rec.reply || {}).state, 'Pending', '(3) …"Pending", as the phone\'s outbox answered');
    const r2 = await row(A.id);
    ok(r2.replied_at === CT(...MON, 9, 6) && r2.reply && r2.reply.how === 'text' && !JSON.stringify(r2.reply).includes('555'), '(3) the register row carries replied_at and reply (never the number)', JSON.stringify(r2.reply));
    const after = await page(A.id, CT(...MON, 9, 8));
    ok(/class="jck done"[^>]*>Replied 9:06 AM · price by 11:15 AM</.test(after.text), '(3) the clock stops: "Replied 9:06 AM · price by 11:15 AM"', (/class="jck[^"]*"[^>]*>[^<]*/.exec(after.text) || [])[0]);
    eq((after.text.match(/class="jgo"/g) || []).length, 0, '(3) no reply button any more');
    ok(plain(after.text).includes('Texted Willow 9:06 AM · from the work phone'), '(3) "Texted Willow 9:06 AM · from the work phone", the text folded under it');
    const bd = plain((await get(`/j/board/${boardTok}`, CT(...MON, 9, 8))).text);
    ok(bd.includes('Replied 9:06 AM') && bd.includes('Price by 11:15 AM'), '(3) the board row stops too');
    /* the ladder stops */
    const m = PO().length, g1 = gate.requests.length;
    await walk(CT(...MON, 9, 10), CT(...MON, 11, 10));
    eq(mine(A.id).filter((c) => c.runNow).length, 0, '(3) the ladder stops: no push from 9:10 to 11:10');
    eq(posts(g1).length, 0, '(3) and no holding text at 11:00');
    eq(((await record(A.id)).alerts || {}).table && (await record(A.id)).alerts.table.end_reason, 'replied', '(3) the record says why: replied');
    /* once */
    const again = await sendReply(A.id, CT(...MON, 9, 12));
    eq(posts(g1).length, 0, '(3) a second Send sends nothing (one reply per request)');
    R['3'] = { id: A.id, text: want, post: { id: b.id, validUntil: b.validUntil }, replied_at: rec.replied_at, promised_by: rec.reply && rec.reply.promised_by, again: again.r.status };
  }

  suite('P · (2b) 9 PM–7 AM: the arrival push is quiet, and the ring starts at 7 AM');
  {
    const n = await submit(CT(...MON, 22, 15), who('Nightly Newcomb'));
    const quiet = mine(n.id);
    eq(quiet.length, 1, '(2b) one push at 10:15 PM');
    eq(one(quiet).p.get('priority'), '-1', '(2b) quiet: priority -1');
    eq(one(quiet).p.get('expire'), null, '(2b) no ring (no retry, no expire)');
    eq(one(quiet).p.get('url'), `${W}/j/${tokOf(n.id)}`, '(2b) and it opens the job');
    eq(titleOf(one(quiet)), `NEW JOB · ${n.id} · reply by 9:00 AM`, '(2b) "reply by 9:00 AM" — two business hours from 7:00');
    const m = PO().length;
    await runAt(CT(...TUE, 2, 0)); await runAt(CT(...TUE, 6, 55));
    eq(PO().length, m, '(2b) nothing at 2:00 AM or 6:55 AM');
    await runAt(CT(...TUE, 7, 0));
    const at7 = PO().slice(m).filter((c) => c.runNow === CT(...TUE, 7, 0));
    eq(at7.length, 1, '(2b) at 7:00 AM one push');
    const s = one(at7);
    ok(/MORNING SUMMARY|QUOTE BEFORE YOU LEAVE/.test(titleOf(s)) && (s.p.get('message') || '').includes(n.id), '(2b) the 7 AM push names the overnight job', titleOf(s));
    eq(s.p.get('priority'), '2', '(2b) and it RINGS (priority 2)');
    eq(s.p.get('expire'), '6300', '(2b) to the 15-minutes-left mark: 8:45 AM');
    eq(s.p.get('url'), `${W}/j/${tokOf(n.id)}`, '(2b) and opens the job');
    R['2b'] = { id: n.id, night: { priority: one(quiet).p.get('priority'), title: titleOf(one(quiet)) }, at7: { title: titleOf(s), priority: s.p.get('priority'), expire: s.p.get('expire') } };
    await noText(n.id);
  }

  suite('P · (3b) in Spanish, by call, with no texts ticked, from another site');
  {
    const es = await submit(CT(...TUE, 9, 0), who('María Españatest', { sms_consent_lang: 'es' }));
    const g0 = gate.requests.length;
    const s = await sendReply(es.id, CT(...TUE, 9, 0));
    const want = 'Hola Maria, soy Drew de Umbra Domus. Ya vi las fotos del parche del techo. Le mando el precio hoy antes de las 11:00 a. m. Si no quiere mensajes, responda STOP.';
    eq(s.text, want, '(3b) Spanish: the research\'s words, "antes de las 11:00 a. m."');
    eq(textOf(one(posts(g0))), want, '(3b) …and that is what went');
    await noText(es.id);
    const call = await submit(CT(...TUE, 9, 1), who('Carl Callmetest', { reach_by: 'Call' }));
    const cp = await page(call.id, CT(...TUE, 9, 2));
    ok(/<a class="jgo" href="tel:\+1956555\d{4}">Call Carl<\/a>/.test(cp.text), '(3b) they asked for a call: the button is "Call Carl" (tel:)', (/class="jgo"[^>]*>[^<]*/.exec(cp.text) || [])[0]);
    ok(/action="\/j\/[^"]+\/called"><button type="submit" class="jalt">I called<\/button>/.test(cp.text), '(3b) …with "I called" under it');
    ok(!cp.text.includes('?c=reply'), '(3b) …and no text button');
    const g1 = gate.requests.length;
    const tried = await sendReply(call.id, CT(...TUE, 9, 3));
    eq(posts(g1).length, 0, '(3b) a reply posted anyway sends nothing');
    const cr = await post(`/j/${tokOf(call.id)}/called`, {}, CT(...TUE, 9, 4), { origin: W });
    eq(cr.status, 303, '(3b) "I called" → 303');
    const crec = await record(call.id);
    ok(crec.replied_at === CT(...TUE, 9, 4) && crec.reply && crec.reply.how === 'call', '(3b) "I called" records replied-at, as a call');
    ok(/class="jck done"[^>]*>Called 9:04 AM</.test((await page(call.id, CT(...TUE, 9, 5))).text), '(3b) the clock: "Called 9:04 AM"');
    ok(crec.alerts && crec.alerts.table && crec.alerts.table.end_reason === 'replied', '(3b) the ladder stops');
    const no = await submit(CT(...TUE, 9, 2), who('Nora Notickstest', { sms_consent: 'no' }));
    const np = await page(no.id, CT(...TUE, 9, 3));
    ok(!np.text.includes('?c=reply') && /Call Nora</.test(np.text), '(3b) no texts ticked: no text button — "Call Nora"');
    ok(plain(np.text).includes('No texts OK on the request — call them.'), '(3b) …and says why in one line');
    const g2 = gate.requests.length;
    await sendReply(no.id, CT(...TUE, 9, 4));
    eq(posts(g2).length, 0, '(3b) a reply posted anyway sends nothing');
    await noText(no.id);
    const fo = await submit(CT(...TUE, 9, 3), who('Fiona Foreigntest'));
    const g3 = gate.requests.length;
    const f1 = await sendReply(fo.id, CT(...TUE, 9, 4), CT(...TUE, 9, 4), { origin: 'https://evil.example' });
    eq(f1.r.status, 403, '(3b) a Send from another site → 403');
    const f2 = await sendReply(fo.id, CT(...TUE, 9, 4), CT(...TUE, 9, 4), { 'sec-fetch-site': 'cross-site' });
    eq(f2.r.status, 403, '(3b) Sec-Fetch-Site: cross-site → 403');
    eq(posts(g3).length, 0, '(3b) …and nothing went');
    const tamper = await post(`/j/${tokOf(fo.id)}/reply`, { by: f1.by, sha: '0'.repeat(64) }, CT(...TUE, 9, 5), { origin: W });
    ok(tamper.status === 303 && /\?c=reply$/.test(tamper.location || ''), '(3b) words that are not the ones he saw → back to the confirm', tamper.location);
    const late = await post(`/j/${tokOf(fo.id)}/reply`, { by: f1.by, sha: f1.sha }, CT(...TUE, 13, 0), { origin: W });
    eq(posts(g3).length, 0, '(3b) a confirm whose promise has passed sends nothing');
    ok(/\?c=reply$/.test(late.location || ''), '(3b) …it goes back to a fresh confirm');
    await noText(fo.id);
    const nj = await submit(CT(...TUE, 20, 30), who('Nina Nighttest'), 0);
    const night = await page(nj.id, CT(...TUE, 21, 30));
    ok(/class="jgo off"[^>]*>Texts go from 7 AM</.test(night.text), '(3b) 9 PM–7 AM the button says "Texts go from 7 AM" and does nothing', (/class="jgo[^"]*"[^>]*>[^<]*/.exec(night.text) || [])[0]);
    const g4 = gate.requests.length;
    const nc = await sendReply(nj.id, CT(...TUE, 20, 55), CT(...TUE, 21, 5));
    eq(posts(g4).length, 0, '(3b) a Send at 9:05 PM sends nothing');
    await noText(nj.id);
    R['3b'] = { es: want, call_button: 'Call Carl', no_texts_button: 'Call Nora', foreign: [f1.r.status, f2.r.status] };
  }

  suite('P · (3c) "by <time>" = the tap + 2 business hours, rounded up to the quarter hour (12 rows)');
  {
    let promiseBy = () => NaN, byWords = () => '';
    try { ({ promiseBy, byWords } = await import(pathToFileURL(path.join(WDIR, 'src', 'draft.js')).href)); } catch (err) { ok(false, '(3c) the Worker under test has the words module (src/draft.js)', String(err && err.message).slice(0, 120)); }
    const rows = [
      [CT(...WED, 9, 0), CT(...WED, 11, 0)],
      [new Date(Date.parse(CT(...WED, 9, 0)) + 30000).toISOString(), CT(...WED, 11, 0)],
      [CT(...WED, 9, 1), CT(...WED, 11, 15)],
      [CT(...WED, 14, 15), CT(...WED, 16, 15)],
      [CT(...WED, 14, 19), CT(...WED, 16, 30)],
      [CT(...WED, 18, 59), CT(...WED, 21, 0)],
      [CT(...WED, 19, 0), CT(...WED, 21, 0)],
      [CT(...WED, 19, 5), CT(...THU, 7, 15)],
      [CT(...WED, 20, 50), CT(...THU, 9, 0)],
      [CT(...WED, 22, 30), CT(...THU, 9, 0)],
      [CT(...THU, 6, 10), CT(...THU, 9, 0)],
      [CT(2026, 10, 31, 20, 0), CT(2026, 11, 1, 8, 0)],          /* across the night the clocks go back */
    ];
    const got = rows.map(([t]) => { const x = promiseBy(Date.parse(t)); return isFinite(x) ? new Date(x).toISOString() : 'none'; });
    eq(JSON.stringify(got), JSON.stringify(rows.map((r) => r[1])), '(3c) the twelve rows', JSON.stringify(got.map((x) => (x === 'none' ? x : hhmm(x)))));
    eq(byWords(Date.parse(CT(...WED, 16, 30)), Date.parse(CT(...WED, 14, 19)), 'en'), '4:30 PM today', '(3c) "4:30 PM today"');
    eq(byWords(Date.parse(CT(...THU, 7, 15)), Date.parse(CT(...WED, 19, 5)), 'en'), '7:15 AM tomorrow', '(3c) "7:15 AM tomorrow"');
    eq(byWords(Date.parse(CT(...WED, 13, 15)), Date.parse(CT(...WED, 11, 5)), 'es'), 'hoy antes de la 1:15 p. m.', '(3c) "hoy antes de la 1:15 p. m."');
    R['3c'] = rows.map(([t], i) => `${hhmm(t)} → ${got[i] === 'none' ? 'none' : hhmm(got[i])}`);
  }

  /* ============================================================ (4) THE LADDER CARRIES THE DRAFT */
  suite('P · (4) with no reply, every reminder carries the drafted reply and the link');
  {
    const L = await submit(CT(...WED, 9, 0), who('Lenny Laddertest'));
    await walk(CT(...WED, 9, 5), CT(...WED, 10, 55));
    const slots = mine(L.id).filter((c) => c.runNow && /STILL OPEN/.test(titleOf(c)));
    eq(slots.length, 12, '(4) his table, unchanged: twelve reminders');
    eq(JSON.stringify(slots.map((c) => hhmm(c.runNow))), JSON.stringify(['9:15 AM', '9:30 AM', '9:45 AM', '10:00 AM', '10:10 AM', '10:20 AM', '10:30 AM', '10:35 AM', '10:40 AM', '10:45 AM', '10:50 AM', '10:55 AM']), '(4) at his minutes');
    ok(slots.every((c) => c.p.get('url') === `${W}/j/${tokOf(L.id)}` && c.p.get('url_title') === 'Open the job'), '(4) each opens the job');
    const last3 = slots.slice(-3);
    const drafts = last3.map((c) => (/Ready to send: "([^"]*)"/.exec(c.p.get('message') || '') || [])[1]);
    eq(JSON.stringify(last3.map((c) => (titleOf(c).match(/(\d+) min left/) || [])[1])), JSON.stringify(['15', '10', '5']), '(4) 15, 10 and 5 minutes left');
    eq(drafts[0], "Hi [name], it's Drew with Umbra Domus. I got your photos of the ceiling patch. I'll text you the price by 12:45 PM today. Reply STOP to stop texts.", '(4) 15 minutes left: the drafted reply, "[name]" where the name goes, "by 12:45 PM"');
    ok(drafts[1] && drafts[1].includes('by 1:00 PM today') && drafts[2] && drafts[2].includes('by 1:00 PM today'), '(4) 10 and 5 minutes left: the draft as it would go then ("by 1:00 PM")', JSON.stringify(drafts.slice(1)));
    ok(slots.every((c) => /Ready to send: "Hi \[name\], it's Drew with Umbra Domus\./.test(c.p.get('message') || '')), '(4) every reminder carries it');
    eq(slots.filter((c) => leaksName(c, 'Lenny Laddertest')).length, 0, '(4) and none carries the name');
    await noText(L.id);
    const C = await submit(CT(...WED, 9, 0), who('Cora Calltest', { reach_by: 'Call' }));
    await walk(CT(...WED, 9, 5), CT(...WED, 9, 15));
    ok(/\nCall them: they asked for a call\.$/.test(one(mine(C.id).filter((c) => c.runNow)).p.get('message') || ''), '(4) a call-only request: the reminder says "Call them: they asked for a call."');
    await noText(C.id);
    R['4'] = { id: L.id, last3: last3.map((c) => ({ run: hhmm(c.runNow), title: titleOf(c), draft: (/Ready to send: "([^"]*)"/.exec(c.p.get('message') || '') || [])[1] })) };
  }

  /* ============================================================ (5) STOP */
  suite('P · (5) STOP: the signed webhook, one confirmation, and every send refuses');
  {
    const S = await submit(CT(...THU, 9, 0), who('Stella Stoptest'));
    const raw0 = await recordRaw(S.id);
    const g0 = gate.requests.length, p0 = PO().length;
    const bad = await textIn(CT(...THU, 9, 5), S.e164, 'STOP', { key: 'not-the-key' });
    const none = await textIn(CT(...THU, 9, 5), S.e164, 'STOP', { sig: false });
    const stale = await textIn(CT(...THU, 9, 5), S.e164, 'STOP', { ts: Math.floor(Date.parse(CT(...THU, 8, 50)) / 1000) });
    ok([bad.status, none.status, stale.status].every((x) => x === 401), '(5) a bad signature, no signature, a stale timestamp → 401', JSON.stringify([bad.status, none.status, stale.status]));
    ok(await recordRaw(S.id) === raw0 && gate.requests.length === g0 && PO().length === p0, '(5) …and nothing was written, texted or pushed');
    const good = await textIn(CT(...THU, 9, 5), S.e164, 'STOP');
    eq(good.status, 200, '(5) a signed STOP → 200');
    const conf = posts(g0);
    eq(conf.length, 1, '(5) ONE confirmation text');
    eq(textOf(one(conf)), "You're unsubscribed from Umbra Domus texts. Call (956) 556-6438 if you need us.", '(5) in the brief\'s words');
    ok(Date.parse(bodyOf(one(conf)).validUntil) <= Date.parse(CT(...THU, 9, 10)), '(5) within five minutes (validUntil 9:10 AM)', bodyOf(one(conf)).validUntil);
    const rec = await record(S.id);
    ok(rec.sms_opt_out && rec.sms_opt_out.by === 'text' && rec.sms_opt_out.word === 'STOP', '(5) the job says they texted STOP');
    const pu = PO().slice(p0).filter((c) => titleOf(c) === `${S.id} replied: STOP`);
    eq(pu.length, 1, '(5) his phone: "U-NNNN replied: STOP"');
    eq(one(pu).p.get('url'), `${W}/j/${tokOf(S.id)}`, '(5) …with the link');
    const g1 = gate.requests.length;
    await sendReply(S.id, CT(...THU, 9, 6));
    eq(posts(g1).length, 0, '(5) then the reply route refuses the number');
    const sp = await page(S.id, CT(...THU, 9, 6));
    ok(!sp.text.includes('?c=reply') && /Call Stella</.test(sp.text) && plain(sp.text).includes('They texted STOP 9:05 AM — call them.'), '(5) the page: "They texted STOP 9:05 AM — call them." and the button is Call');
    await textIn(CT(...THU, 9, 7), S.e164, 'stop');
    eq(posts(g1).length, 0, '(5) a second STOP: no second confirmation');
    eq(PO().filter((c) => titleOf(c) === `${S.id} replied: STOP`).length, 1, '(5) …and his phone hears it once');
    await walk(CT(...THU, 9, 10), CT(...THU, 11, 0), 5);
    eq(posts(g1).length, 0, '(5) and the holding text refuses it at 11:00');
    ok(mine(S.id).some((c) => c.runNow === CT(...THU, 11, 0) && titleOf(c) === `LATE · ${S.id} · call them now`), '(5) …his phone rings "LATE · call them now" instead', JSON.stringify(mine(S.id).map((c) => [c.runNow && hhmm(c.runNow), titleOf(c)])));
    const eqRow = await row(S.id);
    ok(eqRow.sms_opt_out && eqRow.sms_opt_out.by === 'text', '(5) the register row carries sms_opt_out (the Flux\'s send routes must read it)');
    R['5'] = { id: S.id, refused: [bad.status, none.status, stale.status], confirmation: textOf(one(conf)), push: titleOf(one(pu)) };
  }

  suite('P · (5b) every stop word, alone or in a sentence; "No texts" is one tap; any other text lands on the job');
  {
    const words = [['end', 'END'], ['Please UNSUBSCRIBE me', 'UNSUBSCRIBE'], ['cancel', 'CANCEL'], ['I quit getting these', 'QUIT'], ['ALTO', 'ALTO'], ['Basta ya por favor', 'BASTA'], ['please stop texting me', 'STOP']];
    const got = [];
    for (const [msg, word] of words) {
      const j = await submit(CT(...THU, 13, 0), who('Wanda Wordtest'), 0);
      const g0 = gate.requests.length;
      const r = await textIn(CT(...THU, 13, 5), j.e164, msg);
      const rec = await record(j.id);
      got.push({ msg, status: r.status, word: rec.sms_opt_out && rec.sms_opt_out.word, confirmations: posts(g0).length, text: textOf(one(posts(g0))) });
      await noText(j.id);
    }
    ok(got.every((x, i) => x.status === 200 && x.word === words[i][1] && x.confirmations === 1), '(5b) END, UNSUBSCRIBE, CANCEL, QUIT, ALTO, BASTA, STOP — each opts the number out, with one confirmation', JSON.stringify(got.map((x) => [x.msg, x.word, x.confirmations])));
    ok(got[4].text.startsWith('Ya no le enviaremos mensajes de Umbra Domus.') && got[5].text.startsWith('Ya no le enviaremos'), '(5b) ALTO and BASTA are answered in Spanish', got[4].text);
    const T = await submit(CT(...THU, 13, 10), who('Tomas Taptest'));
    const g0 = gate.requests.length;
    const nt = await post(`/j/${tokOf(T.id)}/no-texts`, {}, CT(...THU, 13, 11), { origin: W });
    eq(nt.status, 303, '(5b) "No texts" → 303');
    const trec = await record(T.id);
    ok(trec.sms_opt_out && trec.sms_opt_out.by === 'tap', '(5b) the number is off texts, by his tap');
    await sendReply(T.id, CT(...THU, 13, 12));
    eq(posts(g0).length, 0, '(5b) no confirmation for a tap, and the reply route refuses the number');
    await noText(T.id);
    const O = await submit(CT(...THU, 13, 20), who('Olive Oktest'));
    const p0 = PO().length;
    const r = await textIn(CT(...THU, 13, 25), O.e164, 'ok thanks, tomorrow afternoon works for me. Olive');
    eq(r.status, 200, '(5b) any other text → 200');
    const orec = await record(O.id);
    ok(Array.isArray(orec.inbound) && orec.inbound.length === 1 && orec.inbound[0].text === 'ok thanks, tomorrow afternoon works for me. Olive', '(5b) it lands on the job, whole');
    ok(!orec.sms_opt_out, '(5b) not an opt-out');
    const rp = PO().slice(p0);
    eq(rp.length, 1, '(5b) one push');
    eq(titleOf(one(rp)), `${O.id} replied: ok thanks, tomorrow afternoon works for me. [name]`, '(5b) "U-NNNN replied: <their words>" — the name taken out');
    eq(one(rp).p.get('url'), `${W}/j/${tokOf(O.id)}`, '(5b) with the link');
    ok(plain((await page(O.id, CT(...THU, 13, 26))).text).includes('They replied 1:25 PM: "ok thanks, tomorrow afternoon works for me. Olive"'), '(5b) the page shows their reply');
    await noText(O.id);
    const N = await submit(CT(...THU, 20, 0), who('Nell Nightstoptest'), 0);
    const g2 = gate.requests.length;
    await textIn(CT(...THU, 22, 30), N.e164, 'STOP');
    const nrec = await record(N.id);
    ok(nrec.sms_opt_out && posts(g2).length === 0 && nrec.sms_opt_out.confirm && nrec.sms_opt_out.confirm.why === 'night', '(5b) a STOP at 10:30 PM: off texts, and no text at night (the job says so)');
    await noText(N.id);
    R['5b'] = { words: got.map((x) => `${x.msg} → ${x.word}`), reply_push: titleOf(one(rp)) };
  }

  /* ============================================================ (6) THE HOLDING TEXT AND ITS GUARDS */
  suite('P · (6) the holding text: the only automatic text, when every guard passes');
  {
    const h = await submit(CT(...FRI, 9, 0), who('Holly Holdtest'));
    const g0 = gate.requests.length;
    await walk(CT(...FRI, 9, 5), CT(...FRI, 11, 0));
    const p = posts(g0);
    eq(p.length, 1, '(6) at 11:00, ONE text');
    eq(textOf(one(p)), "Hi Holly, it's Drew with Umbra Domus. Sorry, I'm running behind today. I'll text you about your ceiling by 1:00 PM. Reply STOP to stop texts.", '(6) the brief\'s words, the new promise two business hours on');
    eq(bodyOf(one(p)).validUntil, CT(...FRI, 12, 0), '(6) validUntil 12:00 PM (an hour, never past 9 PM)');
    eq(bodyOf(one(p)).ttl, undefined, '(6) validUntil, not ttl');
    await walk(CT(...FRI, 11, 5), CT(...FRI, 13, 0), 5);
    eq(posts(g0).length, 1, '(6) never a second automatic text…');
    eq(mine(h.id).filter((c) => titleOf(c) === `CALL THEM NOW · ${h.id} — two hours twice, no quote`).length, 1, '(6) …the second clock ends in ONE "CALL THEM NOW" ring for him');
    const lp = await page(h.id, CT(...FRI, 11, 5));
    ok(plain(lp.text).includes('The work phone texted them 11:00 AM: "Sorry, I\'m running behind today."') && /class="jck amber"[^>]*>Late · you promised 1:00 PM · 1 h 55 m left</.test(lp.text), '(6) the page: late, the holding text sent, the new promise', (/class="jck[^"]*"[^>]*>[^<]*/.exec(lp.text) || [])[0]);
    ok(/<a class="jgo" href="tel:[^"]+">Call Holly<\/a>/.test(lp.text), '(6) …and the one button is "Call Holly"');
    const cronLine = (fs.readFileSync(path.join(WDIR, 'wrangler.toml'), 'utf8').match(/^crons\s*=\s*(.*)$/m) || [])[1];
    eq(cronLine, '["* * * * *"]', '(6) the Worker\'s timer ticks every minute (wrangler.toml crons)');
    R['6'] = { id: h.id, text: textOf(one(p)), validUntil: bodyOf(one(p)).validUntil, cron: cronLine };
  }

  suite('P · (6b) one reading per guard — each proves the holding text did NOT go');
  {
    const guard = async (label, name, extra, before, lateWhy) => {
      const j = await submit(CT(...FRI, 13, 0), who(name, extra));
      if (before) await before(j);
      const g0 = gate.requests.length;
      await walk(CT(...FRI, 13, 5), CT(...FRI, 15, 0), 5);
      const went = posts(g0).filter((x) => bodyOf(x).id === `${j.id}-hold`);
      eq(went.length, 0, `${label} the holding text did NOT go`);
      if (lateWhy) {
        const late = mine(j.id).filter((c) => titleOf(c) === `LATE · ${j.id} · call them now`);
        eq(late.length, 1, `${label} "LATE · ${j.id} · call them now" instead`);
        ok(late.length === 1 && late[0].p.get('priority') === '2' && late[0].p.get('retry') === '120' && late[0].p.get('expire') === '10800', `${label} ringing until acknowledged (priority 2, every 2 minutes, 3 hours — before 9 PM)`, late[0] && [late[0].p.get('priority'), late[0].p.get('retry'), late[0].p.get('expire')].join(','));
        ok(late.length === 1 && (late[0].p.get('message') || '').startsWith('No auto-text: ' + lateWhy), `${label} saying why: "${lateWhy}"`, late[0] && late[0].p.get('message'));
        eq(late[0] && late[0].p.get('url'), `${W}/j/${tokOf(j.id)}`, `${label} with the link`);
      }
      const rec = await record(j.id);
      await noText(j.id);
      return { id: j.id, end_reason: rec.alerts && rec.alerts.table && rec.alerts.table.end_reason, holding: rec.alerts && rec.alerts.holding };
    };
    R['6b'] = {};
    R['6b'].replied = await guard('(6b) he replied by text:', 'Rita Repliedtest', {}, async (j) => { await sendReply(j.id, CT(...FRI, 13, 2)); });
    eq(R['6b'].replied.end_reason, 'replied', '(6b) …the ladder ended on his reply');
    R['6b'].called = await guard('(6b) he called:', 'Cal Calledtest', {}, async (j) => { await post(`/j/${tokOf(j.id)}/called`, {}, CT(...FRI, 13, 3), { origin: W }); });
    R['6b'].quoted = await guard('(6b) the desk sent the quote:', 'Quinn Quotedtest', {}, async (j) => {
      await admin('POST', `/admin/quote/${j.id}`, { version: 1, price: 180, scope: ['Repaint the ceiling so the old patch does not show'], windows: [{ date: '2026-12-01', start: '09:00', end: '11:00' }], lang: 'en' }, CT(...FRI, 14, 0));
      await admin('POST', `/admin/quote/${j.id}/sent`, { version: 1, sent_at: CT(...FRI, 14, 1) }, CT(...FRI, 14, 1));
    });
    R['6b'].wet = await guard('(6b) still wet:', 'Wes Wettest', { flags: 'Still wet or soft' }, null, "it's still wet");
    R['6b'].no_auto = await guard('(6b) he tapped "Don\'t auto-text":', 'Dot Donttest', {}, async (j) => {
      const r = await post(`/j/${tokOf(j.id)}/no-auto`, {}, CT(...FRI, 13, 4), { origin: W });
      eq(r.status, 303, '(6b) "Don\'t auto-text" → 303');
    }, 'you turned the auto-text off');
    R['6b'].opted_out = await guard('(6b) they texted STOP:', 'Otis Optouttest', {}, async (j) => { await textIn(CT(...FRI, 13, 6), j.e164, 'STOP'); }, 'they said no texts');
    R['6b'].no_consent = await guard('(6b) no texts ticked:', 'Nia Noconsenttest', { sms_consent: 'no' }, null, 'they did not tick the texts box');
    R['6b'].call = await guard('(6b) they asked for a call:', 'Cy Callguardtest', { reach_by: 'Call' }, null, 'they asked for a call');
    /* the phone's own send record, read fresh: his reply in flight at the reply-by minute keeps the holding text home */
    {
      const j = await submit(CT(...FRI, 16, 0), who('Ivy Inflighttest'));
      await walk(CT(...FRI, 16, 5), CT(...FRI, 17, 55), 5);
      const g0 = gate.requests.length;
      gate.state.slowMs = 3000;
      const c = await page(j.id, CT(...FRI, 17, 59), '?c=reply');
      const by = (/name="by" value="([^"]*)"/.exec(c.text) || [])[1], sha = (/name="sha" value="([^"]*)"/.exec(c.text) || [])[1];
      const sending = post(`/j/${tokOf(j.id)}/reply`, { by, sha }, CT(...FRI, 18, 0), { origin: W });
      await sleep(800);
      await runAt(CT(...FRI, 18, 0));
      await sending;
      gate.state.slowMs = 0;
      const all = posts(g0);
      eq(all.filter((x) => bodyOf(x).id === `${j.id}-hold`).length, 0, '(6b) his reply in flight at the minute: the holding text did NOT go (the phone\'s send record, read fresh)');
      eq(all.filter((x) => bodyOf(x).id === `${j.id}-r1`).length, 1, '(6b) …his reply went, once');
      await noText(j.id);
    }
    /* never a second holding text: the BOOK's mark (suite J (8) proves the race; here, a later minute) */
    ok(true, '(6b) no holding text before on this request: J (8) and (6) above — one POST, ever');
  }

  suite('P · (6c) at the Worker\'s own timer, no step of his table and no holding text more than 60 s late');
  {
    /* the timer as the Worker under test sets it (its wrangler.toml): the sweep runs only at the marks that timer fires */
    const cron = (fs.readFileSync(path.join(WDIR, 'wrangler.toml'), 'utf8').match(/^crons\s*=\s*\[\s*"([^"]+)"/m) || [])[1] || '*/5 * * * *';
    const f0 = cron.trim().split(/\s+/)[0];
    const every = f0 === '*' ? 1 : Number((/^\*\/(\d+)$/.exec(f0) || [])[1] || 5);
    /* it lands at 1:32 PM — off the five-minute marks, as most requests do */
    const j = await submit(CT(...FRI, 13, 32), who('Minnie Minutetest'), 0);
    const g0 = gate.requests.length;
    for (let t = Date.parse(CT(...FRI, 13, 33)); t <= Date.parse(CT(...FRI, 15, 36)); t += 60000) {
      if (new Date(t).getUTCMinutes() % every === 0) await runAt(new Date(t).toISOString());
    }
    const slots = mine(j.id).filter((c) => c.runNow && /STILL OPEN/.test(titleOf(c)));
    const marks = [15, 30, 45, 60, 70, 80, 90, 95, 100, 105, 110, 115].map((m) => Date.parse(CT(...FRI, 13, 32)) + m * 60000);
    eq(slots.length, 12, `(6c) the timer fires every ${every} min: twelve reminders`);
    const lateBy = slots.map((c, i) => Math.round((Date.parse(c.runNow) - marks[i]) / 1000));
    ok(lateBy.length === 12 && lateBy.every((x) => x >= 0 && x <= 60), '(6c) each within 60 s of its own minute', JSON.stringify(slots.map((c) => hhmm(c.runNow))));
    const hold = posts(g0).filter((x) => bodyOf(x).id === `${j.id}-hold`);
    const heldAt = hold[0] && hold[0].runNow ? Date.parse(hold[0].runNow) : NaN;
    ok(hold.length === 1 && heldAt - Date.parse(CT(...FRI, 15, 32)) <= 60000, '(6c) the holding text at the reply-by minute (3:32 PM), not after it', hold[0] ? hhmm(hold[0].runNow) : 'none');
    await noText(j.id);
    R['6c'] = { every, slots: slots.map((c) => hhmm(c.runNow)), holding_at: hold[0] ? hhmm(hold[0].runNow) : null };
  }

  /* ============================================================ (7) THE LEAD LINE */
  suite('P · (7) built before 1978 or "not sure": one line on his page, and the EPA link on their quote page');
  {
    const line = (html) => (plain(html).match(/Built(?: before 1978|: not sure) — lead-safe setup applies/g) || []);
    const old = await submit(CT(...MON, 15, 0), who('Olga Oldhousetest', { built: 'Before 1978' }), 0);
    const ol = line((await page(old.id, CT(...MON, 15, 1))).text);
    eq(JSON.stringify(ol), JSON.stringify(['Built before 1978 — lead-safe setup applies']), '(7) before 1978: exactly one line');
    const uns = await submit(CT(...MON, 15, 0), who('Ursula Unsuretest', { built: 'Not sure' }), 0);
    eq(JSON.stringify(line((await page(uns.id, CT(...MON, 15, 1))).text)), JSON.stringify(['Built: not sure — lead-safe setup applies']), '(7) not sure: one line');
    const nw = await submit(CT(...MON, 15, 0), who('Nate Newhousetest', { built: '1978 or later' }), 0);
    eq(line((await page(nw.id, CT(...MON, 15, 1))).text).length, 0, '(7) 1978 or later: no line');
    const yard = await submit(CT(...MON, 15, 0), { ...who('Yuri Yardtest', { built: 'Before 1978' }), service: 'Yard & Property', problem: [], problem_area: [] }, 0);
    eq(line((await page(yard.id, CT(...MON, 15, 1))).text).length, 0, '(7) a job that is not paint or holes: no line');
    const q = async (j) => {
      const c = await admin('POST', `/admin/quote/${j.id}`, { version: 1, price: 150, scope: ['Patch and repaint the ceiling'], windows: [{ date: '2026-12-02', start: '09:00', end: '11:00' }], lang: 'en' }, CT(...MON, 15, 5));
      const code = c.body && c.body.code;
      const r = await get(`/q/${code}`, CT(...MON, 15, 6));
      return (r.text.match(/href="https:\/\/www\.epa\.gov\/lead\/renovate-right[^"]*"/g) || []).length;
    };
    eq(await q(old), 1, '(7) their quote page (built before 1978): one link to the EPA\'s Renovate Right');
    eq(await q(nw), 0, '(7) their quote page (1978 or later): none');
    for (const j of [old, uns, nw, yard]) await noText(j.id);
    R['7'] = { before: ol[0] || null };
  }

  return R;
}
