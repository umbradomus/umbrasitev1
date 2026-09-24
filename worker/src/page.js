/* THE CUSTOMER'S PAGE (ACCEPT-PAGE-02). The link at the end of the quote text: /q/<22-character code>,
   reached on our own domain through the site's rewrite (vercel.json → this Worker), so the address bar stays
   on umbradomus.com and the form posts are same-origin. No JavaScript anywhere: plain HTML forms, plain pages.

     GET  /q/<code>        the page. It changes nothing but the visit count on the book's row (viewByCode) —
                           link previews and mail scanners open links by themselves, so opening must be harmless.
     POST /q/<code>        Accept & confirm → bookByCode(…, "page") → 303 back to GET, which then says BOOKED.
     POST /q/<code>/none   None of these times work → markNone → 303 back to GET, which then says RECEIVED.
     GET  /q/<code>/calendar.ics   QUOTE-PAGE-03: a BOOKED quote's visit as an .ics file (else NOT VALID, 404).
                           Like the page's GET it moves only the visit count; a POST to it answers 405.

   THE SEAM (the ignite's AMENDMENT 2, E1): this file calls only ACCEPT-PAGE-01's viewByCode, bookByCode and
   markNone, which already count, stamp and push. It never writes KV and never pushes by itself.

   THE ORIGIN CHECK RUNS FIRST on a POST, before the code is looked up: an Origin header that is present and not
   one of the site's own origins (SITE_BASE_URL's and its www/apex twin — "null" is foreign), or
   Sec-Fetch-Site: cross-site, answers 403 and nothing is written. Neither header → allowed (older browsers).

   Every 303 carries a RELATIVE Location. Behind the rewrite this Worker's own host is workers.dev: an absolute
   URL would leave the site (and form-action 'self' would block the next post), and Response.redirect() throws
   on a relative one in workerd. So: new Response(null, { status: 303, headers: { Location: '/q/' + code } }). */

import { viewByCode, bookByCode, markNone, codeHash, windowStartMs } from './quotes.js';
import { chicagoWall } from './biztime.js';
import { LIGHTING_EN, NOTICE_53255 } from './notices.js';
import { WORDS, LIGHTING_ES } from './page-words.js';

/* The site's stylesheet, at the version every page of the site loads today (status.html: site.css?v=3). */
const CSS_V = '3';

const CSP = "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/* On EVERY /q response. Referrer-Policy is same-origin and NOT no-referrer: under no-referrer a same-origin form
   post sends `Origin: null`, which the check above refuses (measured by the reviewer of the ignite). */
export const PAGE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
};

const CODE_SHAPE = /^[A-Za-z0-9]{1,64}$/;

/* ------------------------------------------------------------------ small helpers */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/* A value that ends the sentence with its own period ("a.m.") takes the sentence's period with it: never "a.m..". */
const fill = (tpl, vals) => tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vals ? vals[k] : '')).replace(/\.\.$/, '.');

const DOW = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
};
const MON = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
};

/** "Tue, Sep 29" · "martes 29 de septiembre" — a window's date is a calendar day, so no time zone enters.
    Spanish is written in full and lowercase, as inside a sentence; lineDay() capitalises it where it starts a line. */
function dayLabel(date, lang) {
  const [y, mo, d] = String(date).split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return lang === 'es' ? `${DOW.es[dow]} ${d} de ${MON.es[mo - 1]}` : `${DOW.en[dow]}, ${MON.en[mo - 1]} ${d}`;
}
/** A date that starts its line: "Martes 29 de septiembre · llegada entre …". English already starts with a capital. */
function lineDay(date, lang) {
  const s = dayLabel(date, lang);
  return lang === 'es' ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function clock(min, lang, withMinutes) {
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = ((h + 11) % 12) + 1;
  const t = withMinutes || m ? `${h12}:${String(m).padStart(2, '0')}` : String(h12);
  const ap = lang === 'es' ? (h < 12 ? 'a.m.' : 'p.m.') : (h < 12 ? 'AM' : 'PM');
  return { t, ap, h12 };
}
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

/** "8 and 10 AM" · "11 AM and 1 PM" · "las 8 y las 10 a.m." · "las 11 a.m. y la 1 p.m." */
function windowSpan(w, lang) {
  const a = clock(toMin(w.start), lang), b = clock(toMin(w.end), lang);
  if (lang === 'es') {
    const art = (c) => (c.h12 === 1 ? 'la' : 'las');
    return a.ap === b.ap ? `${art(a)} ${a.t} y ${art(b)} ${b.t} ${b.ap}` : `${art(a)} ${a.t} ${a.ap} y ${art(b)} ${b.t} ${b.ap}`;
  }
  return a.ap === b.ap ? `${a.t} and ${b.t} ${b.ap}` : `${a.t} ${a.ap} and ${b.t} ${b.ap}`;
}

const CHI = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
});
/** An instant on Chicago's own clock: "Fri, Sep 25 at 10:00 AM" · "viernes 25 de septiembre a las 10:00 a.m." */
function momentLabel(iso, lang) {
  const p = Object.fromEntries(CHI.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const c = clock(Number(p.hour) % 24 * 60 + Number(p.minute), lang, true);
  if (lang === 'es') return `${dayLabel(date, 'es')} a ${c.h12 === 1 ? 'la' : 'las'} ${c.t} ${c.ap}`;
  return `${dayLabel(date, 'en')} at ${c.t} ${c.ap}`;
}

function money(n) {
  const v = Number(n);
  return '$' + (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

/* ------------------------------------------------------------------ the page frame */

/* QUOTE-PAGE-03: the look of 1SUPE5's mock (Bridge/SUPE/QUOTE-PAGE-03-MOCK-2026-09-23/make_mock.py), with every
   colour written out, so the page stays right when site.css does not load (or on workers.dev):
   teal #0D7471 · teal-deep #0A5C5A · line #D9D2C7 · paper #F6F3EE · paper-2 #ECE7DF · muted #4E4960 ·
   ink #0F0B1A · focus #2F6BB0 · rust #92310E · prussian #003153. The class names avoid site.css's own
   .top, .note and .inc, which collide. */
const STYLE = `
body{background:#F6F3EE;color:#0F0B1A}
.qtop{background:#fff;border-bottom:1px solid #D9D2C7;padding:.7rem 0}
.qbrand{display:flex;align-items:center;gap:.6rem;margin:0;font-weight:600;letter-spacing:.14em;text-transform:uppercase;font-size:1rem}
.qbrand img{width:36px;height:36px;display:block}
.q{padding:1.1rem 0 3rem}
.q svg{width:1.25em;height:1.25em;flex:none}
.qsteps{list-style:none;display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin:0 0 1.4rem;padding:0}
.qsteps li{position:relative;display:grid;justify-items:center;gap:.35rem;font-size:.78rem;font-weight:500;color:#4E4960;text-align:center}
.qsteps li::before{content:"";position:absolute;top:13px;left:-50%;right:50%;height:2px;background:#D9D2C7;z-index:0}
.qsteps li:first-child::before{display:none}
.qsteps li.done::before,.qsteps li.now::before{background:#0D7471}
.qsteps .dot{position:relative;z-index:1;display:grid;place-items:center;width:28px;height:28px;box-sizing:border-box;border-radius:50%;background:#F6F3EE;border:2px solid #D9D2C7;color:#fff}
.qsteps .dot svg{width:15px;height:15px}
.qsteps li.done .dot{background:#0D7471;border-color:#0D7471}
.qsteps li.now .dot{border-color:#0D7471;box-shadow:0 0 0 4px rgba(13,116,113,.16)}
.qsteps li.now .dot::after{content:"";width:10px;height:10px;border-radius:50%;background:#0D7471}
.qsteps li.done,.qsteps li.now{color:#0F0B1A}
.q h1{font-size:clamp(1.9rem,7vw,2.4rem);line-height:1.05;margin:0 0 .3rem}
.qhi{font-size:1.15rem;margin:0 0 1.1rem;color:#4E4960}
.q h2{font-size:1.1rem;letter-spacing:0;margin:1.5rem 0 .6rem}
.qticket{background:#fff;border:1px solid #D9D2C7;border-radius:18px;box-shadow:0 10px 30px rgba(15,11,26,.07);overflow:hidden;margin:0 0 1.2rem}
.qticket .qtt{padding:1.1rem 1.2rem .95rem}
.qtl{font-size:.74rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#0D7471;margin:0 0 .25rem}
.qprice{font-size:2.7rem;font-weight:600;line-height:1;margin:0 0 .35rem;letter-spacing:-.01em}
.qticket .qtn{margin:0;color:#4E4960}
.qticket .qti{display:flex;gap:.45rem;align-items:flex-start;margin:.55rem 0 0;font-size:.95rem}
.qticket .qti svg{color:#0D7471;margin-top:.1em}
.qticket .qtear{height:0;border-top:2px dashed #D9D2C7;margin:0 1.2rem;position:relative}
.qticket .qtear::before,.qticket .qtear::after{content:"";position:absolute;top:-11px;width:20px;height:20px;border-radius:50%;background:#F6F3EE;border:1px solid #D9D2C7}
.qticket .qtear::before{left:-31px}.qticket .qtear::after{right:-31px}
.qticket .qtw{display:flex;gap:.8rem;align-items:flex-start;padding:.95rem 1.2rem 1.1rem}
.qticket .qtw svg{color:#0D7471;width:1.6em;height:1.6em;margin-top:.1em}
.qticket .qtd{font-weight:600;font-size:1.15rem;margin:0}
.qticket .qtwin{margin:0}
.qhold{display:flex;gap:.5rem;align-items:flex-start;font-size:.93rem;color:#4E4960;margin:0 0 1.2rem}
.qhold svg{margin-top:.1em}
.qwork{list-style:none;padding:0;margin:0 0 1rem;display:grid;gap:.55rem}
.qwork li{display:grid;grid-template-columns:26px 1fr;gap:.6rem;align-items:start}
.qwork .ck{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:rgba(13,116,113,.12);color:#0D7471}
.qwork .ck svg{width:15px;height:15px}
.qtrust{list-style:none;margin:0 0 .4rem;padding:.2rem .95rem;background:#fff;border:1px solid #D9D2C7;border-radius:14px}
.qtrust li{display:flex;gap:.65rem;align-items:flex-start;padding:.6rem 0;font-size:.95rem}
.qtrust li+li{border-top:1px solid #ECE7DF}
.qtrust svg{color:#0D7471;width:1.4em;height:1.4em}
.qerr{border-left:5px solid #b83622;background:#fff;padding:.6rem .9rem;font-weight:600;margin:0 0 1rem}
.qpick{border:0;padding:0;margin:0 0 1rem;min-width:0}
.qpick legend{font-weight:600;font-size:1.1rem;padding:0;margin:0 0 .6rem}
.qopt{display:flex;align-items:center;gap:.9rem;min-height:64px;box-sizing:border-box;padding:.8rem 1rem;margin:0 0 .6rem;background:#fff;border:2px solid #D9D2C7;border-radius:16px;cursor:pointer}
.qopt input{width:24px;height:24px;margin:0;flex:none;accent-color:#0D7471}
.qopt .qod{display:block;font-weight:600;font-size:1.05rem}
.qopt .qot{display:block;color:#4E4960}
.qopt:has(input:checked){border-color:#0D7471;background:#EFF7F6;box-shadow:0 0 0 3px rgba(13,116,113,.14)}
.qopt input:focus-visible{outline:3px solid #2F6BB0;outline-offset:2px}
@supports selector(:has(a)){.qopt input:focus-visible{outline:none}.qopt:has(input:focus-visible){outline:3px solid #2F6BB0;outline-offset:3px}}
.qnotebox{display:flex;gap:.7rem;align-items:flex-start;background:#fff;border:1px solid #D9D2C7;border-radius:14px;padding:.8rem .95rem;font-size:.93rem;margin:0 0 .7rem}
.qnotebox svg{color:#92310E;width:1.4em;height:1.4em;margin-top:.1em}
.qnote{margin:0}
.qlaw{background:#fff;border:1px solid #D9D2C7;border-radius:14px;margin:0 0 .7rem}
.qlaw summary{display:flex;gap:.7rem;align-items:center;min-height:52px;box-sizing:border-box;padding:.55rem .95rem;cursor:pointer;font-weight:600;font-size:.97rem;list-style:none}
.qlaw summary::-webkit-details-marker{display:none}
.qlaw summary svg:first-child{color:#003153;width:1.4em;height:1.4em}
.qlaw .qlt{display:grid;gap:.05rem}
.qlaw .qlh{font-weight:600}
.qlaw .qlp{font-weight:400;font-size:.88rem;color:#4E4960}
.qlaw summary .chev{margin-left:auto;display:flex;transition:transform .15s}
.qlaw[open] summary .chev{transform:rotate(180deg)}
.qlaw summary:focus-visible{outline:3px solid #2F6BB0;outline-offset:2px;border-radius:12px}
.qlaw .qlb{border-top:1px solid #D9D2C7;padding:.8rem .95rem;font-size:.86rem}
.qlaw .qlin{margin:0 0 .65em;font-style:italic}
.qlaw .q53{max-height:55vh;overflow:auto;margin:0}
.qlaw .q53 p{margin:0 0 .65em}
.qgo{display:block;width:100%;min-height:58px;margin:1.1rem 0 .7rem;padding:.8rem 1.2rem;font:inherit;font-size:1.15rem;font-weight:600;border-radius:16px;border:2px solid #0D7471;background:#0D7471;color:#fff;cursor:pointer;box-shadow:0 8px 20px rgba(13,116,113,.25)}
.qgo:hover{background:#0A5C5A;border-color:#0A5C5A}
.qalt{display:flex;align-items:center;justify-content:center;gap:.5rem;width:100%;min-height:50px;box-sizing:border-box;margin:0 0 1rem;padding:.6rem 1.2rem;font:inherit;font-size:1rem;font-weight:500;border-radius:16px;border:2px solid #D9D2C7;background:#fff;color:#0F0B1A;cursor:pointer;text-decoration:none}
.qgo:focus-visible,.qalt:focus-visible{outline:3px solid #2F6BB0;outline-offset:3px}
.qsmall{font-size:.9rem;color:#4E4960;text-align:center;margin:.2rem 0 0}
.qwords .qsmall{text-align:left}
.qok{display:grid;place-items:center;width:64px;height:64px;border-radius:50%;background:#0D7471;color:#fff;margin:.4rem 0 .9rem;box-shadow:0 10px 24px rgba(13,116,113,.28)}
.q .qok svg{width:34px;height:34px}
@keyframes qpop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}
.qok{animation:qpop .45s ease-out both}
@media (prefers-reduced-motion:reduce){.qok{animation:none}.qlaw summary .chev{transition:none}}
`;

/* The mock's icons. Decoration only: every one is aria-hidden, and the words beside it carry the meaning. */
const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6l7-3z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.4"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.35-5.65"/><path d="M20 4.5V9h-4.5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>',
  law: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v17M7 20.5h10M4 7.5h16M6.5 7.5L4 13.5a3 3 0 0 0 5 0L6.5 7.5zM17.5 7.5L15 13.5a3 3 0 0 0 5 0l-2.5-6z"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10l4 4 4-4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>',
};

/** The four steps. `done` are ticked; `now` (an index, or -1) is the current one. */
function stepsHtml(w, done, now) {
  return `<ol class="qsteps" aria-label="${esc(w.steps_label)}">` + w.steps.map((label, i) => {
    const cls = i < done ? 'done' : i === now ? 'now' : '';
    return `<li${cls ? ` class="${cls}"` : ''}${cls === 'now' ? ' aria-current="step"' : ''}><span class="dot">${cls === 'done' ? ICON.check : ''}</span>${esc(label)}</li>`;
  }).join('') + '</ol>';
}

/** The ticket's time half: the calendar icon, a small label, the day, and "Arrival between …". */
function whenHtml(label, x, lang, w) {
  return `<div class="qtw">${ICON.cal}<div><p class="qtl">${esc(label)}</p><p class="qtd">${esc(lineDay(x.date, lang))}</p>` +
    `<p class="qtwin">${esc(fill(w.when_line, { window: windowSpan(x, lang) }))}</p></div></div>`;
}

function frame(lang, state, inner, { bilingual = false } = {}) {
  const w = WORDS[lang] || WORDS.en;
  /* The title and the preview tags are generic on every state: never a price, a name or an address. */
  return `<!DOCTYPE html>
<html lang="${lang === 'es' ? 'es' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(bilingual ? WORDS.en.title : w.title)}</title>
<meta property="og:title" content="${esc(bilingual ? WORDS.en.title : w.title)}">
<link rel="stylesheet" href="/assets/site.css?v=${CSS_V}">
<style>${STYLE}</style>
</head>
<body data-state="${esc(state)}">
<header class="qtop"><div class="wrap narrow"><p class="qbrand"><img src="/assets/apple-touch-icon.png?v=5" width="36" height="36" alt=""><span>Umbra Domus</span></p></div></header>
<main class="q"><div class="wrap narrow">
${inner}
</div></main>
</body>
</html>
`;
}

function page(status, lang, state, inner, opts) {
  return new Response(frame(lang, state, inner, opts), {
    status, headers: { ...PAGE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** A state that is only words: a heading, a line, and where questions go. */
function wordsPage(status, lang, state, head, line, withQuestions = true) {
  const w = WORDS[lang] || WORDS.en;
  /* QUOTE-PAGE-03: the new frame and type, and no strip — these states have nothing to count. */
  return page(status, lang, state,
    `<div class="qwords">\n<h1>${esc(head)}</h1>\n<p class="qhi">${esc(line)}</p>\n${withQuestions && line !== w.questions ? `<p class="qsmall">${esc(w.questions)}</p>` : ''}\n</div>`);
}

/** The same page in both languages — for a link we cannot tie to a quote, so we cannot know its language. */
function bothPage(status, state, hk, lk) {
  const inner = ['en', 'es'].map((l) => `<section${l === 'es' ? ' lang="es"' : ''} style="padding:0 0 1.2rem">
<h1>${esc(WORDS[l][hk])}</h1>
<p class="qhi">${esc(WORDS[l][lk])}</p>
</section>`).join('\n');
  return page(status, 'en', state, inner, { bilingual: true });
}

const notValid = (status = 404) => bothPage(status, 'not_valid', 'h_not_valid', 'not_valid');

/* ------------------------------------------------------------------ the states */

function noticesHtml(env, lang) {
  const w = WORDS[lang] || WORDS.en;
  const light = String(env.NOTICE_LIGHTING ?? 'true') === 'true';
  const law = String(env.NOTICE_53255 ?? 'false') === 'true' && NOTICE_53255.length > 0;
  if (!light && !law) return '';
  const L = lang === 'es' ? LIGHTING_ES : LIGHTING_EN;
  let out = `<h2>${esc(w.h_notices)}</h2>\n`;
  /* The paragraph keeps its own opening tag and bytes; the card and the sun go around it. */
  if (light) out += `<div class="qnotebox">${ICON.sun}<p class="qnote" id="notice-lighting"><strong>${esc(L.lead)}</strong> ${esc(L.text)}</p></div>\n`;
  if (law) {
    /* QUOTE-PAGE-03: the whole statute is in the page, folded behind one line — never `open` in the markup, so it
       costs one row until it is tapped, and <details> opens with no JavaScript. Its block keeps today's tag. */
    out += `<details class="qlaw"><summary>${ICON.law}<span class="qlt"><span class="qlh">${esc(w.law_title)}</span>` +
      `<span class="qlp">${esc(w.law_hint)}</span></span><span class="chev">${ICON.chev}</span></summary>\n` +
      `<div class="qlb">\n<p class="qlin">${esc(w.statute_intro)}</p>\n<div class="q53" id="notice-53255" lang="en">\n` +
      NOTICE_53255.map((p) => `<p>${esc(p)}</p>`).join('\n') + '\n</div>\n</div>\n</details>\n';
  }
  return out;
}

/** OPEN, HOLD ENDED BUT OPEN, and TAKEN with a time still free: the quote and its two buttons. */
function openPage(env, v, code, nowIso, pickError) {
  const lang = v.lang === 'es' ? 'es' : 'en';
  const w = WORDS[lang];
  const b = v.body || {};
  const all = v.windows || [];
  const free = all.filter((x) => x.free);
  const taken = v.state === 'taken';

  if (taken && free.length === 0) {
    return wordsPage(200, lang, 'taken', w.h_taken, w.taken_none);
  }

  const offer = taken ? free : all;
  const plural = offer.length > 1;
  const parts = [];
  parts.push(stepsHtml(w, 1, 1));
  if (taken) parts.push(`<p class="qerr" role="status">${esc(w.h_taken)} ${esc(w.taken_other)}</p>`);
  parts.push(`<h1>${esc(w.h1_quote)}</h1>`);
  parts.push(`<p class="qhi">${esc(b.first_name ? fill(w.hi_name, { name: b.first_name }) : w.hi)}</p>`);

  /* the ticket: the price, and — with one time offered — the time, below the tear */
  parts.push('<div class="qticket"><div class="qtt">' +
    `<p class="qtl">${esc(w.h_price)}</p><p class="qprice">${esc(money(b.price))}</p>` +
    (b.price_note ? `<p class="qtn">${esc(b.price_note)}</p>` : '') +
    (b.included ? `<p class="qti">${ICON.plus}<span>${esc(b.included)}</span></p>` : '') + '</div>' +
    (plural ? '' : `<div class="qtear" aria-hidden="true"></div>${whenHtml(w.h_when, offer[0], lang, w)}`) + '</div>');

  const form = [];
  form.push(`<form method="post" action="/q/${esc(code)}">`);
  form.push(`<input type="hidden" name="v" value="${esc(v.version)}">`);
  if (plural) {
    if (pickError) form.push(`<p class="qerr" id="pick-error">${esc(w.pick_error)}</p>`);
    form.push(`<fieldset class="qpick"${pickError ? ' aria-describedby="pick-error"' : ''}><legend>${esc(w.pick_legend)}</legend>`);
    for (const x of offer) {
      form.push(`<label class="qopt"><input type="radio" name="w" value="${esc(x.n)}" required><span><span class="qod">${esc(lineDay(x.date, lang))}</span>` +
        `<span class="qot">${esc(fill(w.when_line, { window: windowSpan(x, lang) }))}</span></span></label>`);
    }
    form.push('</fieldset>');
  } else if (all.length > 1) {
    /* One window of two left free: name it, so the book never has to guess. One window of one: nothing to say. */
    form.push(`<input type="hidden" name="w" value="${esc(offer[0].n)}">`);
  }
  const holdEnded = v.state === 'hold_ended' || (v.hold_until && Date.parse(nowIso) >= Date.parse(v.hold_until));
  form.push(`<p class="qhold">${ICON.clock}<span>${esc(holdEnded
    ? (plural ? w.hold_ended_two : w.hold_ended_one)
    : fill(plural ? w.hold_two : w.hold_one, { at: momentLabel(v.hold_until, lang) }))}</span></p>`);

  form.push(`<h2>${esc(w.h_work)}</h2>`);
  form.push('<ul class="qwork">' + (b.scope || []).map((s) => `<li><span class="ck">${ICON.check}</span><span>${esc(s)}</span></li>`).join('') + '</ul>');
  /* his promise and his insurance: each only if the quote carries it; with neither, no card */
  const trust = [];
  if (b.guarantee) trust.push(`<li>${ICON.redo}<span>${esc(b.guarantee)}</span></li>`);
  if (b.insurance) trust.push(`<li>${ICON.shield}<span>${esc(b.insurance)}</span></li>`);
  if (trust.length) form.push(`<ul class="qtrust">${trust.join('')}</ul>`);

  form.push(noticesHtml(env, lang));
  form.push(`<button type="submit" class="qgo">${esc(w.accept)}</button>`);
  form.push('</form>');
  parts.push(form.join('\n'));

  parts.push(`<form method="post" action="/q/${esc(code)}/none"><input type="hidden" name="v" value="${esc(v.version)}"><button type="submit" class="qalt">${esc(w.none)}</button></form>`);
  parts.push(`<p class="qsmall">${esc(w.small)}</p>`);

  const state = taken ? 'taken' : holdEnded ? 'hold_ended' : 'open';
  return page(200, lang, state + (pickError ? ' pick' : ''), parts.join('\n'));
}

/** The window a booked quote holds (the one accepted, else its only one). */
const bookedWindow = (v) => (v.windows || []).find((y) => y.n === v.accepted_window) || (v.windows || [])[0];

function bookedPage(v, code) {
  const lang = v.lang === 'es' ? 'es' : 'en';
  const w = WORDS[lang];
  const x = bookedWindow(v);
  const inner = [
    stepsHtml(w, 3, -1),
    `<div class="qok" aria-hidden="true">${ICON.check}</div>`,
    `<h1>${esc(w.h_booked)}</h1>`,
    `<p class="qhi">${esc(w.booked_confirm)}</p>`,
    '<div class="qticket">' + (x ? whenHtml(w.lbl_visit, x, lang, w) + '<div class="qtear" aria-hidden="true"></div>' : '') +
      `<div class="qtt"><p class="qtl">${esc(w.h_price)}</p><p class="qprice" style="font-size:2.1rem">${esc(money(v.body && v.body.price))}</p></div></div>`,
    x ? `<a class="qalt" href="/q/${esc(code)}/calendar.ics">${ICON.cal}<span>${esc(w.add_calendar)}</span></a>` : '',
    `<p class="qsmall">${esc(w.questions)}</p>`,
  ].join('\n');
  return page(200, lang, 'booked', inner);
}

/* ------------------------------------------------------------------ the calendar file (QUOTE-PAGE-03) */

/** RFC 5545 TEXT: backslash, semicolon, comma and newline escaped. */
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold a content line at 75 octets, never inside a UTF-8 character: each continuation starts with one space. */
function icsFold(line) {
  const out = [];
  let cur = '', octets = 0, limit = 75;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (octets + n > limit) { out.push(cur); cur = ' '; octets = 1; limit = 75; }
    cur += ch; octets += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

/** 20260929T130000Z */
const icsUtc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** The booked visit as one VEVENT. No name, phone, address or price: the day, the window and a line of words. */
async function calendarFile(v, code, nowIso) {
  const lang = v.lang === 'es' ? 'es' : 'en';
  const w = WORDS[lang];
  const x = bookedWindow(v);
  const [y, mo, d] = String(x.date).split('-').map(Number);
  const [eh, em] = String(x.end).split(':').map(Number);
  /* the UID is never the code itself: the first 32 hex of sha256(code), with no @ in it */
  const uid = 'umbradomus-' + (await codeHash(code)).slice(0, 32);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Umbra Domus//Quote page//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + icsUtc(Date.parse(nowIso)),
    'DTSTART:' + icsUtc(windowStartMs(x)),
    'DTEND:' + icsUtc(chicagoWall(y, mo, d, eh, em)),
    'SUMMARY:' + icsText(w.ics_title),
    'DESCRIPTION:' + icsText(fill(w.ics_desc, { window: windowSpan(x, lang) })),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

function statePage(env, v, code, nowIso, pickError) {
  if (!v || v.state === 'not_found') return notValid();
  const lang = v.lang === 'es' ? 'es' : 'en';
  const w = WORDS[lang];
  switch (v.state) {
    case 'open':
    case 'hold_ended':
    case 'taken':
      return openPage(env, v, code, nowIso, pickError);
    case 'booked': return bookedPage(v, code);
    case 'too_close': return wordsPage(200, lang, 'too_close', w.h_too_close, w.too_close);
    case 'updating': return wordsPage(200, lang, 'updating', w.h_updating, w.updating);
    case 'replaced': return wordsPage(200, lang, 'replaced', w.h_replaced, w.replaced);
    case 'withdrawn': return wordsPage(200, lang, 'withdrawn', w.h_withdrawn, w.withdrawn, false);
    case 'received': return wordsPage(200, lang, 'received', w.h_received, w.received);
    default: return notValid();
  }
}

/* ------------------------------------------------------------------ the origin check */

/** SITE_BASE_URL's origin and its www/apex twin: https://www.umbradomus.com and https://umbradomus.com. */
export function siteOrigins(env) {
  let u;
  try { u = new URL(env.SITE_BASE_URL || 'https://www.umbradomus.com'); } catch (err) { return []; }
  const out = [u.origin];
  const h = u.hostname;
  if (h !== 'localhost' && !/^[\d.]+$/.test(h) && !h.includes(':')) {
    const twin = h.startsWith('www.') ? h.slice(4) : 'www.' + h;
    out.push(`${u.protocol}//${twin}${u.port ? ':' + u.port : ''}`);
  }
  return out;
}

/** True when the post came from another site: a foreign Origin ("null" included), or Sec-Fetch-Site: cross-site. */
export function foreignPost(request, env) {
  const origin = request.headers.get('origin');
  if (origin !== null && !siteOrigins(env).includes(origin)) return true;
  const sfs = request.headers.get('sec-fetch-site');
  if (sfs !== null && sfs.trim().toLowerCase() === 'cross-site') return true;
  return false;
}

/* ------------------------------------------------------------------ the route */

const seeOther = (code, query = '') => new Response(null, {
  status: 303, headers: { ...PAGE_HEADERS, Location: '/q/' + code + query },
});

/**
 * Everything under /q. `rest` is the path after "/q/" ("" for /q itself). `nowIso` comes from the router's
 * nowFor, so the tests can name the moment (only ever with ALLOW_TEST_HOOKS).
 */
export async function handleQuotePage(request, env, url, rest, method, nowIso) {
  const m = /^([^/]*)(\/none|\/calendar\.ics)?$/.exec(rest);
  const code = m ? m[1] : '';
  const isNone = Boolean(m && m[2] === '/none');
  const isCal = Boolean(m && m[2] === '/calendar.ics');

  if (method === 'POST') {
    /* FIRST, before the code is looked up: a post from another site writes nothing. */
    if (foreignPost(request, env)) return bothPage(403, 'forbidden', 'h_forbidden', 'forbidden');
    /* QUOTE-PAGE-03: the calendar file is read-only. Its path must never fall through to bookByCode below. */
    if (isCal) return notAllowed('GET, HEAD');
    if (!m || !CODE_SHAPE.test(code)) return notValid();
    let form = null;
    try { form = await request.formData(); } catch (err) { form = null; }
    const v = form ? String(form.get('v') || '') : '';
    const wRaw = form ? form.get('w') : null;
    const win = wRaw === null || wRaw === '' ? null : (/^\d{1,2}$/.test(String(wRaw)) ? Number(wRaw) : -1);
    if (isNone) {
      await markNone(env, code, v, nowIso);
      return seeOther(code);
    }
    const r = await bookByCode(env, code, v, win, 'page', nowIso);
    /* Two times offered and none chosen: back to the page, which asks again. Nothing was written. */
    if (r && r.state === 'choose_window') return seeOther(code, '?pick=1');
    /* Every other answer — booked, already_booked, taken, too_close, updating, replaced, withdrawn,
       not_found, no_such_window — is shown by the page itself, from the book, on the GET that follows. */
    return seeOther(code);
  }

  if (method === 'GET' || method === 'HEAD') {
    if (!m || isNone || !CODE_SHAPE.test(code)) return head(method, notValid());
    const v = await viewByCode(env, code, nowIso);
    if (isCal) {
      /* QUOTE-PAGE-03: only a BOOKED quote has a visit to put in a calendar; anything else is NOT VALID. */
      if (!v || v.state !== 'booked' || !bookedWindow(v)) return head(method, notValid());
      return head(method, new Response(await calendarFile(v, code, nowIso), {
        status: 200,
        headers: {
          ...PAGE_HEADERS,
          'Content-Type': 'text/calendar; charset=utf-8; method=PUBLISH',
          'Content-Disposition': 'attachment; filename="umbra-domus-visit.ics"',
        },
      }));
    }
    return head(method, statePage(env, v, code, nowIso, url.searchParams.get('pick') === '1'));
  }

  return notAllowed(isCal ? 'GET, HEAD' : 'GET, HEAD, POST');
}

function notAllowed(allow) {
  const r = notValid(405);
  r.headers.set('Allow', allow);
  return r;
}

function head(method, res) {
  return method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
