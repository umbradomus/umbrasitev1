/* THE JOB ON HIS PHONE — UMBRA-SIDE-01 (lane P), 2026-09-28.

   His words: "just got the alert on the umbra phone... not sure exactly what to do from this process with our system..
   this all needs to be easier on the umbra side too". Every push now opens one page — this one — and the page shows the
   one next thing, named for what it does.

     GET  /j/<U-id>.<key>             the job: first name · the job in a few words · the reply clock (amber at 60, red at
                                      30 minutes left) · their photos · their words, uncut · what they picked · where ·
                                      the phone with Text and Call · ONE primary button, pinned to the bottom
     GET  /j/<U-id>.<key>?c=reply     the one confirm: the exact text, the number, "Send" (nothing is written by a GET)
     POST /j/<U-id>.<key>/reply       Send → the work phone's outbox (SMSGate, "Pending"), once → 303 back
     POST /j/<U-id>.<key>/called      "I called" → the reply is recorded as a call → 303 back
     POST /j/<U-id>.<key>/no-texts    "No texts" → the number goes on the opt-out list → 303 back
     POST /j/<U-id>.<key>/no-auto     "Don't auto-text" → no holding text for this request; he gets a ring instead
     GET  /j/<U-id>.<key>/p/<n>       their photo n
     GET  /j/board/<key>              every open job the same way, one row each — the board on his phone (bookmark it)

   THE RULES IT KEEPS
     · A wrong or missing key shows nothing, exactly as a job that is not there. noindex, no-store, no referrer beyond
       the page, framed by nobody, and no script at all: plain HTML and forms, like the customer's pages.
     · No GET changes anything on the record. Opening the job while a reply is owed does one thing outside it: it
       cancels his phone's ring for that job (Pushover's cancel_by_tag), as his research asked — the reply clock stays.
     · A POST from another site writes nothing (the Origin check page.js makes, against this Worker's own address).
     · Nothing is typed. The reply's words are drafted from the request (draft.js); the promise time is worked out.
     · The reply goes only if texting is allowed for this request: they ticked the texts box, they did not ask for a
       call, the number is a US one and is not on the opt-out list, it is 7 AM–9 PM Central, no quote has gone out and
       no reply went before. Otherwise the button is "Call <name>", with "I called" under it. */

import { getRecord, putRecord, listRecords, addEvent } from './store.js';
import { sha256hex } from './util.js';
import { bizMinutes, bizAdvance, replyDue, chicagoParts, chicagoDay, isOpen } from './biztime.js';
import { firstNameOf, langOf, usNumber, hasKey } from './holding.js';
import {
  jobWords, replyText, replyLabel, promiseBy, reachOf, isWetNow, builtOf, leadApplies,
} from './draft.js';
import { optedOut, optOut, sendCustomerText, validUntilFor } from './outbox.js';
import { cancelPushoverTag } from './notify.js';
import { tagOf, recordReply, isTable, holdingWouldBlock } from './alerts.js';
import { jobToken, boardToken, jobOfToken, isBoardToken, ownerBase } from './ownerlink.js';
import { quoteWentOut, markOnce, markSet } from './booklock.js';

const enc = (s) => new TextEncoder().encode(String(s));
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const OWNER_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'";
export const OWNER_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  /* same-origin, not no-referrer: under no-referrer a same-origin form post carries `Origin: null` (page.js, measured) */
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': OWNER_CSP,
};
const REPLY_VALID_S = 3600;               /* a reply the phone has not sent within an hour is not sent at all */

/* ------------------------------------------------------------ small words */

function hm(ms) {
  const { h, mi } = chicagoParts(ms);
  return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function when(ms, nowMs) {
  if (chicagoDay(ms) === chicagoDay(nowMs)) return hm(ms);
  const d = new Date(ms);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'numeric', day: 'numeric' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.month}/${p.day}, ${hm(ms)}`;
}
function left(min) {
  if (min <= 0) return '0 m left';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${m} m left` : `${m} m left`;
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayShort(date) {
  const [y, mo, d] = String(date).split('-').map(Number);
  return `${DOW[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ${mo}/${d}`;
}
const BLOCK_WORDS = { '08-11': '8–11', '11-14': '11–2', '14-17': '2–5', '17-20': '5–8' };
const list = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter(Boolean));

/* ------------------------------------------------------------ where the job stands, read once */

/**
 * Everything the page and the board need to know about a job, from the record (and, for the reply, the BOOK), with no
 * write anywhere. `nowMs` is the router's moment.
 */
export async function standing(env, rec, nowMs, { book = true } = {}) {
  const f = rec.fields || {};
  const a = rec.alerts || {};
  const lang = langOf(rec);
  const first = firstNameOf(rec) || String(f.name || '').trim().split(/\s+/)[0] || 'Them';
  const n = usNumber(f.phone);
  const e164 = n.e164 || null;
  const opt = rec.sms_opt_out || (e164 ? await optedOut(env, e164) : null);
  const due = Date.parse(a.due_at) || replyDue(Date.parse(rec.received_at));
  const quoted = Boolean(rec.quoted_at);
  const reply = rec.reply && (rec.reply.how === 'call' || rec.reply.state) ? rec.reply : null;
  let went = { sent: quoted, ready: false };
  if (book && !quoted && !reply && rec.status === 'received' && env.BOOK) went = await quoteWentOut(env, rec.id);
  const replied = reply ? Date.parse(reply.at) : quoted ? Date.parse(rec.quoted_at) : (went.sent && !went.unreadable ? Date.parse(((went.versions || [])[0] || {}).sent_at) : null);
  /* the admin page's "No text — handled by phone" (REMINDERS-01) is his word that he has it in hand */
  const handled = a.no_text_at ? Date.parse(a.no_text_at) : null;
  const owed = rec.status === 'received' && !replied && !handled;
  const holding = a.holding && a.holding.state === 'accepted' ? a.holding : null;
  const consent = rec.consent ? rec.consent.smsService === true : false;
  const reach = reachOf(rec);
  const canText = consent && reach === 'text' && Boolean(e164) && !opt && !isWetNow(rec) && !rec.reply_failed;
  return {
    rec, f, lang, first, e164, opt, due, quoted, reply, replied, owed, holding, consent, reach, canText, handled,
    ready: Boolean(went.ready), price: went.price || null, wet: isWetNow(rec),
    minsLeft: owed ? bizMinutes(nowMs, due) : null, late: owed && nowMs >= due,
    seen: a.seen_at ? Date.parse(a.seen_at) : null,
    words: jobWords(rec, 'en'),
    open: isOpen(nowMs),
  };
}

/** The clock chip: "Reply by 9:00 AM · 1 h 40 m left" (amber ≤ 60, red ≤ 30) · "Replied 7:14 AM" · "Late · …". */
function clockChip(s, nowMs) {
  if (s.reply) {
    const t = when(Date.parse(s.reply.at), nowMs);
    return { cls: 'done', text: `${s.reply.how === 'call' ? 'Called' : 'Replied'} ${t}${s.reply.promised_by ? ' · price by ' + hm(Date.parse(s.reply.promised_by)) : ''}` };
  }
  if (s.replied) return { cls: 'done', text: `Replied ${when(s.replied, nowMs)} · the quote went` };
  if (s.handled && s.rec.status === 'received') return { cls: 'done', text: `Handled by phone ${when(s.handled, nowMs)}` };
  if (s.rec.status !== 'received') return { cls: 'done', text: s.rec.status === 'scheduled' ? 'Booked' : s.rec.status === 'done' ? 'Done' : 'Answered' };
  if (s.holding) {
    /* the holding text promised the customer a new time: the second clock's end */
    const from = Date.parse(s.rec.alerts.second_clock_started_at || s.holding.at);
    const by = isFinite(from) ? bizAdvance(from, 120) : null;
    const m = by ? bizMinutes(nowMs, by) : 0;
    return { cls: m <= 30 ? 'red' : 'amber', text: `Late · you promised ${by ? hm(by) : 'a new time'} · ${left(m)}` };
  }
  if (s.late) return { cls: 'red', text: `Late · reply was due ${when(s.due, nowMs)}` };
  const m = s.minsLeft;
  return { cls: m <= 30 ? 'red' : m <= 60 ? 'amber' : 'ok', text: `Reply by ${when(s.due, nowMs)} · ${left(m)}` };
}

/* ------------------------------------------------------------ the page frame */

const STYLE = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#F6F3EE;color:#0F0B1A;font:17px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#0A5C5A}
.jtop{background:#fff;border-bottom:1px solid #D9D2C7}
.jw{max-width:36rem;margin:0 auto;padding:0 16px}
.jtop .jw{display:flex;align-items:center;gap:.6rem;min-height:52px}
.jb{font-weight:700;letter-spacing:.16em;font-size:.9rem}
.jid{color:#4E4960;font-size:.9rem}
.jall{margin-left:auto;display:inline-flex;align-items:center;min-height:44px;padding:0 .2rem;font-weight:600;text-decoration:none}
main.jw{padding-top:14px;padding-bottom:24px}
.jn{font-size:2rem;line-height:1.1;margin:0 0 .15rem;overflow-wrap:anywhere}
.jj{margin:0 0 .7rem;color:#4E4960;font-size:1.05rem}
.jck{display:inline-block;margin:0 0 .35rem;padding:.45rem .8rem;border-radius:12px;font-weight:650;font-size:1.05rem;background:#EFF7F6;color:#0A5C5A}
.jck.amber{background:#FEF0C7;color:#8A4B0B}
.jck.red{background:#FEE4E2;color:#A4221A}
.jck.done{background:#ECE7DF;color:#0F0B1A}
.jsub{margin:0 0 .6rem;color:#4E4960;font-size:.95rem}
.jnote{margin:.5rem 0;padding:.6rem .8rem;border-left:4px solid #0D7471;background:#fff;border-radius:0 10px 10px 0;font-size:.97rem}
.jnote.warn{border-left-color:#A4221A}
.jsec{background:#fff;border:1px solid #D9D2C7;border-radius:14px;padding:.8rem .95rem;margin:.8rem 0}
.jsec h2{font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:#4E4960;margin:0 0 .4rem}
.jsec p{margin:0 0 .35rem}
.jq{white-space:pre-wrap;overflow-wrap:anywhere}
.jl{list-style:none;margin:0;padding:0}
.jl li{padding:.3rem 0;border-top:1px solid #ECE7DF;overflow-wrap:anywhere}
.jl li:first-child{border-top:0}
.jl b{font-weight:600}
.jph{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:.8rem 0}
.jph a{display:block}
.jph img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;background:#ECE7DF}
.jph a:first-child:nth-last-child(odd){grid-column:1 / -1}
.jrow{display:flex;gap:8px;margin-top:.4rem}
.jbtn{flex:1;display:inline-flex;align-items:center;justify-content:center;min-height:48px;border:2px solid #D9D2C7;border-radius:12px;background:#fff;color:#0F0B1A;font-weight:600;text-decoration:none;font-size:1rem}
.jnum{font-size:1.15rem;font-weight:600}
.jok{color:#0A5C5A;font-weight:700}
.jwarn{color:#A4221A;font-weight:600}
.jpin{position:sticky;bottom:0;z-index:5;margin:1rem -16px 0;padding:.6rem 16px calc(.7rem + env(safe-area-inset-bottom,0px));background:linear-gradient(rgba(246,243,238,0),#F6F3EE .6rem)}
.jgo{display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;padding:.7rem .8rem;border:0;border-radius:14px;background:#0D7471;color:#fff;font:inherit;font-size:1.06rem;line-height:1.25;font-weight:650;text-align:center;text-decoration:none;box-shadow:0 8px 20px rgba(13,116,113,.28);cursor:pointer}
.jgo.off{background:#8C8799;box-shadow:none;cursor:default}
.jalt{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;margin-top:8px;padding:.5rem 1rem;border:2px solid #D9D2C7;border-radius:14px;background:#fff;color:#0F0B1A;font:inherit;font-size:1rem;font-weight:600;text-decoration:none;cursor:pointer}
.jlink{display:inline-flex;align-items:center;min-height:44px;padding:0;border:0;background:none;color:#0A5C5A;font:inherit;font-size:.97rem;font-weight:600;text-decoration:underline;cursor:pointer}
.jquiet{background:transparent;border:0;padding:.2rem 0}
.jquiet p{color:#4E4960;font-size:.93rem}
.jconf{background:#fff;border:2px solid #0D7471;border-radius:16px;padding:1rem;margin:.8rem 0}
.jconf h2{font-size:1.2rem;margin:0 0 .3rem;letter-spacing:0;text-transform:none;color:#0F0B1A}
.jto{margin:0 0 .6rem;color:#4E4960}
.jbub{margin:0 0 .9rem;padding:.8rem .9rem;background:#E9F2F1;border-radius:16px 16px 16px 4px;white-space:pre-wrap;overflow-wrap:anywhere}
.jdone{background:#fff;border:1px solid #D9D2C7;border-radius:14px;padding:.8rem .95rem;margin:.8rem 0}
.jdone p{margin:0 0 .3rem}
.jdone details{margin:.1rem 0 .3rem}
.jdone summary{min-height:44px;display:flex;align-items:center;font-weight:600;color:#0A5C5A;cursor:pointer}
.jnext{margin:.3rem 0 0;font-weight:650}
.jboard{list-style:none;margin:.6rem 0;padding:0;display:grid;gap:10px}
.jcard{display:block;background:#fff;border:1px solid #D9D2C7;border-radius:16px;padding:.8rem .9rem;color:#0F0B1A;text-decoration:none}
.jcard .jn2{display:block;font-size:1.3rem;font-weight:700}
.jcard .jj{display:block;margin:0 0 .45rem}
.jthumbs{display:flex;gap:6px;margin:.45rem 0}
.jthumbs img{width:30%;max-width:104px;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#ECE7DF}
.jcard .jgo{margin-top:.5rem;min-height:48px;font-size:1.05rem;box-shadow:none}
.jcard .jck{font-size:.95rem}
.jcard .jgo.quiet{background:#ECE7DF;color:#0F0B1A}
.jempty{color:#4E4960}
`;

function frame(title, inner, { lang = 'en' } = {}) {
  return `<!DOCTYPE html>
<html lang="${lang === 'es' ? 'es' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="same-origin">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${inner}
</body>
</html>
`;
}
const page = (status, title, inner) => new Response(frame(title, inner), { status, headers: OWNER_HEADERS });

/** A wrong key, a missing key and a job that is not there: one answer, the same in all three. */
export function nothingHere(status = 404) {
  return page(status, 'Umbra Domus', '<main class="jw" style="padding-top:2rem"><h1 class="jn">Nothing here.</h1><p class="jj">This link is not valid.</p></main>');
}

/* ------------------------------------------------------------ the job page */

function answersHtml(rec) {
  const f = rec.fields || {};
  const rows = [];
  const probs = list(f.problem), areas = list(f.problem_area);
  if (probs.length || areas.length) rows.push(`<b>${esc(probs.join(', ') || 'Job')}</b>${areas.length ? ' · ' + esc(areas.join(', ')) : ''}`);
  for (const [k, label] of [['ceiling', 'Ceiling'], ['walls', 'Walls'], ['corner', 'Corner'], ['opening', 'Opening']]) {
    const bits = [];
    const cnt = list(f[k + '_count_exact'])[0] || list(f[k + '_count_band'])[0];
    if (cnt) bits.push(cnt);
    const big = list(f[k + '_biggest'])[0];
    if (big) bits.push('biggest ' + big);
    const cond = list(f[k + '_condition']);
    if (cond.length) bits.push('left in it: ' + cond.join(', '));
    const surf = list(f[k + '_surface'])[0];
    if (surf) bits.push(surf);
    if (bits.length) rows.push(`<b>${label}:</b> ${esc(bits.join(' · '))}`);
  }
  if (list(f.tiles).length) rows.push(`<b>Picked:</b> ${esc(list(f.tiles).join(' · '))}`);
  const paint = list(f.paint_on_site)[0];
  if (paint) rows.push(`<b>Paint on site:</b> ${esc(paint)}`);
  const av = rec.availability;
  if (av && Array.isArray(av.choices) && av.choices.length) rows.push(`<b>Their times:</b> ${esc(av.choices.map((c) => `${dayShort(c.date)} ${BLOCK_WORDS[c.block] || c.block}`).join(' · '))}`);
  else if (av && av.flexible) rows.push('<b>Their times:</b> flexible');
  for (const [k, label] of [['how_soon', 'How soon'], ['best_time', 'Best time'], ['occupancy', 'The house is'], ['floors', 'Floors'], ['built', 'Built']]) {
    const v = list(f[k]);
    if (v.length) rows.push(`<b>${label}:</b> ${esc(v.join(', '))}`);
  }
  if (rec.year_built) rows.push(`<b>Built:</b> ${esc(rec.year_built)}`);
  const flags = list(f.flags);
  if (flags.length) rows.push(`<b>They said:</b> ${esc(flags.join(' · '))}`);
  if (av && av.notes) rows.push(`<b>Notes:</b> ${esc(av.notes)}`);
  return rows;
}

function photosHtml(rec, tok, max = 12) {
  const ph = (rec.photos || []).filter((p) => !p.store_failed).slice(0, max);
  if (!ph.length) return '';
  return `<section class="jph" aria-label="Their photos">${ph.map((p, i) =>
    `<a href="/j/${esc(tok)}/p/${p.n}"><img src="/j/${esc(tok)}/p/${p.n}" alt="Their photo ${i + 1}"${i > 1 ? ' loading="lazy"' : ''}></a>`).join('')}</section>`;
}

function mapsHref(addr) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
}

function addressConfirmed(f) {
  return /^(yes|true|1|confirmed|confirmada|s[ií])$/i.test(String(list(f.address_confirmed)[0] || '').trim());
}

/** The one thing at the bottom of the screen, pinned. */
function primaryHtml(s, tok, nowMs) {
  const call = s.e164 ? `<a class="jgo" href="tel:${esc(s.e164)}">Call ${esc(s.first)}</a>` +
    `<form method="post" action="/j/${esc(tok)}/called"><button type="submit" class="jalt">I called</button></form>` : '';
  if (!s.owed) return '';
  if (!s.e164) return '<div class="jpin"><p class="jnote warn">No phone number on the request.</p></div>';
  if (s.holding || s.late || !s.canText) return `<div class="jpin">${call}</div>`;
  if (!s.open) return `<div class="jpin"><span class="jgo off" aria-disabled="true">Texts go from 7 AM</span></div>`;
  const by = promiseBy(nowMs);
  return `<div class="jpin"><a class="jgo" href="/j/${esc(tok)}?c=reply">${esc(replyLabel(s.rec, by, nowMs))}</a></div>`;
}

/** The lines between the clock and the photos: only the ones that change what he does. */
function notesHtml(s, nowMs) {
  const out = [];
  const r = s.rec;
  if (s.wet) out.push('<p class="jnote warn">Still wet — the cause gets fixed first. Call, don\'t text.</p>');
  if (leadApplies(r)) out.push(`<p class="jnote warn">${builtOf(r) === 'unsure' ? 'Built: not sure' : 'Built before 1978'} — lead-safe setup applies</p>`);
  if (s.opt) out.push(`<p class="jnote warn">${s.opt.by === 'tap' ? 'No texts to this number' : `They texted ${esc(String(s.opt.word || 'STOP').toUpperCase())}${s.opt.at ? ' ' + esc(when(Date.parse(s.opt.at), nowMs)) : ''}`} — call them.</p>`);
  else if (s.owed && !s.consent) out.push('<p class="jnote">No texts OK on the request — call them.</p>');
  else if (s.owed && s.reach === 'call') out.push('<p class="jnote">They asked for a call.</p>');
  if (r.reply_failed) out.push(`<p class="jnote warn">The text did not go (${esc(r.reply_failed.state)}) — call them.</p>`);
  if (s.holding) {
    const t = r.alerts.holding.at ? when(Date.parse(r.alerts.holding.at), nowMs) : '';
    out.push(`<p class="jnote warn">The work phone texted them ${esc(t)}: "Sorry, I'm running behind today."</p>`);
  }
  if (s.ready && s.owed) out.push(`<p class="jnote">Your quote is made on the Flux${s.price ? ' · $' + esc(s.price) : ''} — send it there.</p>`);
  const inb = Array.isArray(r.inbound) ? r.inbound.filter((x) => !x.stop) : [];
  if (inb.length) {
    const last = inb[inb.length - 1];
    out.push(`<p class="jnote">They replied ${esc(when(Date.parse(last.at), nowMs))}: "${esc(last.text)}"</p>`);
  }
  return out.join('\n');
}

/** What the phone will do at the reply-by minute, and the tap that stops it. */
function autoHtml(s, tok, nowMs) {
  if (!s.owed || s.holding || s.late) return '';
  const r = s.rec;
  const t = when(s.due, nowMs);
  const off = Boolean((r.alerts && r.alerts.no_auto_text_at) || r.no_auto_text_at);
  const blocked = holdingWouldBlock(r, s.opt);
  if (off || blocked || !isTable(r)) return `<p>At ${esc(t)}, if you haven't replied, your phone rings you to call them.</p>`;
  return `<p>At ${esc(t)}, if you haven't replied, the work phone texts them once: "Sorry, I'm running behind today."</p>` +
    `<form method="post" action="/j/${esc(tok)}/no-auto"><button type="submit" class="jlink">Don't auto-text</button></form>`;
}

async function jobPage(env, rec, tok, nowMs, confirm) {
  const s = await standing(env, rec, nowMs);
  const f = s.f;
  const chip = clockChip(s, nowMs);
  const board = await boardToken(env);
  const parts = [];
  parts.push(`<header class="jtop"><div class="jw"><span class="jb">UMBRA</span><span class="jid">${esc(rec.id)}</span>` +
    (board ? `<a class="jall" href="/j/board/${esc(board)}">All jobs</a>` : '') + '</div></header>');
  parts.push('<main class="jw">');
  parts.push(`<h1 class="jn">${esc(s.first)}</h1>`);
  parts.push(`<p class="jj">${esc(s.words.short)}${s.words.service && s.words.short !== s.words.service ? ' · ' + esc(s.words.service.toLowerCase()) : ''}</p>`);
  parts.push(`<p class="jck ${chip.cls}" id="j-clock">${esc(chip.text)}</p>`);
  if (s.seen && s.owed) parts.push(`<p class="jsub">Seen ${esc(when(s.seen, nowMs))}</p>`);
  const notes = notesHtml(s, nowMs);
  if (notes) parts.push(notes);

  /* the one confirm, where the page opened: the exact text, who and which number, one Send */
  if (confirm && s.owed && s.canText && s.open) {
    const by = promiseBy(nowMs);
    const t = replyText(rec, by, nowMs);
    if (!t.error) {
      parts.push(`<section class="jconf" id="j-confirm"><h2>Send this from the work phone?</h2>` +
        `<p class="jto">To ${esc(s.first)} · ${esc(f.phone)}</p><p class="jbub" id="j-text">${esc(t.text)}</p>` +
        `<form method="post" action="/j/${esc(tok)}/reply"><input type="hidden" name="by" value="${esc(t.by)}">` +
        `<input type="hidden" name="sha" value="${esc(await sha256hex(enc(t.text)))}">` +
        `<button type="submit" class="jgo" id="j-send">Send</button></form>` +
        `<a class="jalt" href="/j/${esc(tok)}">Not now</a></section>`);
    }
  }

  /* the reply that went: when, how, and the exact words folded under it */
  if (s.reply) {
    const r = s.reply;
    const t = when(Date.parse(r.at), nowMs);
    parts.push(`<section class="jdone" id="j-replied"><p class="jok">✓ ${r.how === 'call' ? `You called ${esc(t)}` : `Texted ${esc(s.first)} ${esc(t)} · from the work phone`}</p>` +
      (r.text ? `<details><summary>See the text</summary><p class="jbub">${esc(r.text)}</p></details>` : '') +
      (r.promised_by ? `<p class="jnext">Next: the price, by ${esc(hm(Date.parse(r.promised_by)))} — make the quote on the Flux.</p>` : '<p class="jnext">Next: the quote, on the Flux.</p>') +
      '</section>');
  } else if (s.replied && rec.status === 'received') {
    parts.push(`<section class="jdone"><p class="jok">✓ The quote went ${esc(when(s.replied, nowMs))}</p><p class="jnext">Next: waiting on their yes.</p></section>`);
  }

  parts.push(photosHtml(rec, tok));
  const words = String(f.what || f.message || '').trim();
  if (words) parts.push(`<section class="jsec"><h2>Their words</h2><p class="jq">${esc(words)}</p></section>`);
  const ans = answersHtml(rec);
  if (ans.length) parts.push(`<section class="jsec"><h2>What they picked</h2><ul class="jl">${ans.map((x) => `<li>${x}</li>`).join('')}</ul></section>`);
  const extras = list(f.extras);
  if (extras.length) parts.push(`<section class="jsec"><h2>While we're there</h2><ul class="jl">${extras.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`);
  if (f.address) {
    const okAddr = addressConfirmed(f);
    parts.push(`<section class="jsec"><h2>Where</h2><p>${esc(f.address)} ${okAddr ? '<span class="jok" title="They confirmed it">✓</span>' : ''}</p>` +
      (okAddr ? '' : '<p class="jwarn">Typed — check it</p>') +
      `<a class="jbtn" href="${esc(mapsHref(f.address))}" rel="noreferrer">Open in Maps</a></section>`);
  }
  if (f.phone) {
    parts.push(`<section class="jsec"><h2>Phone</h2><p class="jnum">${esc(f.phone)}</p>` +
      (s.e164 ? `<div class="jrow">${s.canText ? `<a class="jbtn" href="sms:${esc(s.e164)}">Text</a>` : ''}<a class="jbtn" href="tel:${esc(s.e164)}">Call</a></div>` : '') + '</section>');
  }
  const auto = autoHtml(s, tok, nowMs);
  const quiet = [];
  if (auto) quiet.push(auto);
  if (s.e164 && !s.opt && s.rec.status !== 'done') quiet.push(`<form method="post" action="/j/${esc(tok)}/no-texts"><button type="submit" class="jlink">No texts to this number</button></form>`);
  if (quiet.length) parts.push(`<section class="jsec jquiet">${quiet.join('')}</section>`);
  if (!confirm) parts.push(primaryHtml(s, tok, nowMs));
  parts.push('</main>');
  return page(200, `${s.first} · ${rec.id}`, parts.join('\n'));
}

/* ------------------------------------------------------------ the board */

async function boardPage(env, nowMs) {
  const all = await listRecords(env);
  const open = all.filter((r) => ['received', 'quoted', 'scheduled'].includes(r.status) && !r.archived_at);
  const rows = [];
  for (const rec of open) rows.push({ rec, s: await standing(env, rec, nowMs, { book: rec.status === 'received' }) });
  rows.sort((x, y) => (x.s.owed === y.s.owed ? (x.s.owed ? x.s.due - y.s.due : Date.parse(y.rec.received_at) - Date.parse(x.rec.received_at)) : (x.s.owed ? -1 : 1)));
  const owedN = rows.filter((x) => x.s.owed).length;
  const parts = [];
  parts.push('<header class="jtop"><div class="jw"><span class="jb">UMBRA</span><span class="jid">All open jobs</span></div></header>');
  parts.push('<main class="jw">');
  parts.push(`<h1 class="jn">Open jobs</h1><p class="jj">${owedN ? `${owedN} ${owedN === 1 ? 'needs' : 'need'} a reply` : 'No reply owed'} · ${rows.length} open</p>`);
  if (!rows.length) parts.push('<p class="jempty">Nothing open.</p>');
  parts.push('<ul class="jboard">');
  for (const { rec, s } of rows) {
    const tok = await jobToken(env, rec.id);
    const chip = clockChip(s, nowMs);
    const thumbs = (rec.photos || []).filter((p) => !p.store_failed).slice(0, 3)
      .map((p, i) => `<img src="/j/${esc(tok)}/p/${p.n}" alt="Photo ${i + 1}" loading="lazy">`).join('');
    let next, quiet = false;
    if (s.owed) next = s.holding || s.late || !s.canText ? `Call ${s.first}` : 'Reply';
    else if (s.reply) { next = s.reply.promised_by ? `Price by ${hm(Date.parse(s.reply.promised_by))}` : 'Make the quote'; quiet = true; }
    else if (rec.status === 'quoted' || s.replied) { next = 'Waiting on their yes'; quiet = true; }
    else if (s.handled && rec.status === 'received') { next = 'Handled by phone'; quiet = true; }
    else if (rec.status === 'scheduled') {
      const w = rec.accept && (rec.accept.windows || [rec.accept.window])[0];
      next = w ? `Booked ${dayShort(w.date)}` : 'Booked'; quiet = true;
    } else { next = 'Open'; quiet = true; }
    parts.push(`<li><a class="jcard" href="/j/${esc(tok)}"><span class="jn2">${esc(s.first)}</span>` +
      `<span class="jj">${esc(s.words.short)} · ${esc(rec.id)}</span><span class="jck ${chip.cls}">${esc(chip.text)}</span>` +
      (thumbs ? `<span class="jthumbs">${thumbs}</span>` : '') +
      `<span class="jgo${quiet ? ' quiet' : ''}">${esc(next)}</span></a></li>`);
  }
  parts.push('</ul></main>');
  return page(200, 'Open jobs · Umbra', parts.join('\n'));
}

/* ------------------------------------------------------------ the taps */

function foreignPost(request, env) {
  const origin = request.headers.get('origin');
  const own = [];
  try { own.push(new URL(request.url).origin); } catch (err) { /* no own origin */ }
  const b = ownerBase(env);
  if (b) { try { own.push(new URL(b).origin); } catch (err) { /* malformed */ } }
  if (origin !== null && !own.includes(origin)) return true;
  const sfs = request.headers.get('sec-fetch-site');
  return sfs !== null && sfs.trim().toLowerCase() === 'cross-site';
}
const back = (tok, q = '') => new Response(null, { status: 303, headers: { ...OWNER_HEADERS, Location: `/j/${tok}${q}` } });

/** Send, from the one confirm. Every guard is asked again here, at the moment it matters. */
async function tapReply(env, request, rec, tok, nowIso) {
  const nowMs = Date.parse(nowIso);
  let form = null;
  try { form = await request.formData(); } catch (err) { form = null; }
  const byIso = form ? String(form.get('by') || '') : '';
  const sha = form ? String(form.get('sha') || '') : '';
  const byMs = Date.parse(byIso);
  const s = await standing(env, rec, nowMs);
  if (!s.owed || !s.canText || !s.open || !hasKey(env)) return back(tok);
  /* the promise shown on the confirm must still be ahead, and never later than a fresh one */
  if (!isFinite(byMs) || byMs <= nowMs || byMs > promiseBy(nowMs)) return back(tok, '?c=reply');
  const t = replyText(rec, byMs, nowMs);
  if (t.error || (await sha256hex(enc(t.text))) !== sha) return back(tok, '?c=reply');
  /* the book, fresh: a quote that went from the desk is the reply already */
  const went = await quoteWentOut(env, rec.id);
  if (went.sent) return back(tok);
  const key = 'reply:' + rec.id, gid = rec.id + '-r1';
  const claim = await markOnce(env, key, rec.id, 'sending', nowIso, gid);
  if (!claim.won) return back(tok);
  const r = await sendCustomerText(env, { id: gid, e164: s.e164, text: t.text, validUntil: validUntilFor(nowMs, REPLY_VALID_S) });
  await markSet(env, key, r.state, r.gateway_id || null, new Date().toISOString(), 'http ' + r.status);
  if (r.state === 'accepted') {
    await recordReply(env, rec.id, {
      how: 'text', at: nowIso, by: 'phone', promised_by: t.by, gateway_id: r.gateway_id || gid,
      state: r.gateway_state || 'Pending', lang: t.lang, parts: t.parts, text: t.text,
    }, nowIso);
  } else {
    const fresh = (await getRecord(env, rec.id)) || rec;
    fresh.reply_failed = { at: nowIso, state: r.state, status: r.status };
    addEvent(fresh, 'reply_text_failed', { state: r.state, status: r.status, gateway: gid }, nowIso);
    await putRecord(env, fresh);
  }
  return back(tok);
}

async function tapCalled(env, rec, tok, nowIso) {
  await recordReply(env, rec.id, { how: 'call', at: nowIso, by: 'phone' }, nowIso);
  return back(tok);
}

async function tapNoTexts(env, rec, tok, nowIso) {
  const n = usNumber((rec.fields || {}).phone);
  if (n.e164) await optOut(env, n.e164, { at: nowIso, by: 'tap', job: rec.id });
  const fresh = (await getRecord(env, rec.id)) || rec;
  if (!fresh.sms_opt_out) {
    fresh.sms_opt_out = { at: nowIso, by: 'tap' };
    addEvent(fresh, 'sms_opt_out', { by: 'tap' }, nowIso);
    await putRecord(env, fresh);
  }
  return back(tok);
}

async function tapNoAuto(env, rec, tok, nowIso) {
  const fresh = (await getRecord(env, rec.id)) || rec;
  const a = fresh.alerts;
  if (a && !a.no_auto_text_at) { a.no_auto_text_at = nowIso; addEvent(fresh, 'no_auto_text', {}, nowIso); await putRecord(env, fresh); }
  else if (!a && !fresh.no_auto_text_at) { fresh.no_auto_text_at = nowIso; addEvent(fresh, 'no_auto_text', {}, nowIso); await putRecord(env, fresh); }
  return back(tok);
}

/* ------------------------------------------------------------ the route */

/**
 * Everything under /j. `rest` is the path after "/j/". `ctx.waitUntil` carries the ring's cancel when the job opens.
 */
export async function handleOwner(request, env, ctx, rest, method, nowIso) {
  const nowMs = Date.parse(nowIso);
  const bm = /^board\/([^/]+)$/.exec(rest);
  if (bm) {
    if (method !== 'GET' && method !== 'HEAD') return nothingHere(405);
    if (!(await isBoardToken(env, bm[1]))) return nothingHere();
    return boardPage(env, nowMs);
  }
  const m = /^([^/]+)(?:\/(reply|called|no-texts|no-auto)|\/p\/(\d{1,3}))?$/.exec(rest);
  if (!m) return nothingHere();
  const id = await jobOfToken(env, m[1]);
  const rec = id ? await getRecord(env, id) : null;
  if (method === 'POST') {
    if (foreignPost(request, env)) return nothingHere(403);
    if (!rec || !m[2]) return nothingHere();
    if (m[2] === 'reply') return tapReply(env, request, rec, m[1], nowIso);
    if (m[2] === 'called') return tapCalled(env, rec, m[1], nowIso);
    if (m[2] === 'no-texts') return tapNoTexts(env, rec, m[1], nowIso);
    return tapNoAuto(env, rec, m[1], nowIso);
  }
  if (method !== 'GET' && method !== 'HEAD') return nothingHere(405);
  if (!rec || m[2]) return nothingHere();
  if (m[3]) {
    const n = parseInt(m[3], 10);
    const p = (rec.photos || []).find((x) => x.n === n && !x.store_failed);
    const obj = p ? await env.PHOTOS.get(p.key) : null;
    if (!obj) return nothingHere();
    return new Response(method === 'HEAD' ? null : obj.body, {
      headers: { 'content-type': p.contentType || 'application/octet-stream', 'cache-control': 'private, max-age=3600', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' },
    });
  }
  /* opening the job stops his phone ringing for it — nothing on the record moves, the reply clock included */
  if (rec.status === 'received' && !rec.replied_at && !rec.quoted_at) {
    const p = cancelPushoverTag(env, tagOf(rec.id)).catch(() => null);
    if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  }
  const res = await jobPage(env, rec, m[1], nowMs, new URL(request.url).searchParams.get('c') === 'reply');
  return method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}

