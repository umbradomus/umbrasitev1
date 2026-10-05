/* THE CUSTOMER'S PAGE (ACCEPT-PAGE-02). The link at the end of the quote text: /q/<22-character code>,
   reached on our own domain through the site's rewrite (vercel.json → this Worker), so the address bar stays
   on umbradomus.com and the form posts are same-origin. No JavaScript anywhere: plain HTML forms, plain pages.

     GET  /q/<code>        the page. It changes nothing but the visit count on the book's row (viewByCode) —
                           link previews and mail scanners open links by themselves, so opening must be harmless.
     POST /q/<code>        Accept & confirm → bookByCode(…, "page") → 303 back to GET, which then says BOOKED.
     POST /q/<code>/none   None of these times work → markNone → 303 back to GET, which then says RECEIVED.
     GET  /q/<code>/calendar.ics   QUOTE-PAGE-03: a BOOKED quote's visits as an .ics file, one event per day (road W)
                           (else NOT VALID, 404). Like the page's GET it moves only the visit count; a POST answers 405.

   ROAD W (2026-09-26): a quote offers 1–2 options, each 1–2 visits on different days. Each option is one card listing
   all its days; Accept sits right under the choice and is pinned to the bottom of the screen once one is picked (CSS
   :has — still no JavaScript; road MW: sticky, so it covers nothing after it); the step list folds to one line; the trust lines and the notices sit below the button;
   the price's arithmetic is never shown to the customer; the hold is `hold_until`, to the minute (road FW: the one hold
   the Flux shows too). The radio is
   still `w` and its value is the option's number, which on an old-shape quote is the window's — so a page left open
   across a deploy still posts what the book expects.

   THE SEAM (the ignite's AMENDMENT 2, E1): this file calls only ACCEPT-PAGE-01's viewByCode, bookByCode and
   markNone, which already count, stamp and push. It never writes KV and never pushes by itself.

   ROAD CO (2026-09-26): the same /q/<code> road carries a CHANGE ORDER when the code is a change's (the book answers
   which, in the one view call). Its page: what and why, the price, the new total, what it adds (folded), then "OK the
   change" with their name typed as the signature, or "No thanks". POST /q/<code> with a=ok (and name) or a=no →
   answerChangeByCode → 303 back to GET, which then says OK'd or No change. A quote's form never sends `a`.

   THE ORIGIN CHECK RUNS FIRST on a POST, before the code is looked up: an Origin header that is present and not
   one of the site's own origins (SITE_BASE_URL's and its www/apex twin — "null" is foreign), or
   Sec-Fetch-Site: cross-site, answers 403 and nothing is written. Neither header → allowed (older browsers).

   Every 303 carries a RELATIVE Location. Behind the rewrite this Worker's own host is workers.dev: an absolute
   URL would leave the site (and form-action 'self' would block the next post), and Response.redirect() throws
   on a relative one in workerd. So: new Response(null, { status: 303, headers: { Location: '/q/' + code } }). */

import { viewByCode, bookByCode, markNone, codeHash, windowStartMs, answerChangeByCode, readYear, noteYearByCode, stampAfterYear, claimConfirmationEmail, noteConfirmationEmail } from './quotes.js';
import { forwardToFormSubmit } from './forward.js';
import { confirmationEmail } from './booking-email.js';
import { chicagoWall } from './biztime.js';
import { NOTICE_53255 } from './notices.js';
import { getRecord } from './store.js';
import { leadApplies } from './draft.js';
import { WORDS, LIGHTING_ES, CHANGE_WORDS, LIGHT_SHORT } from './page-words.js';

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

/* ------------------------------------------------------------------ road W · the days, as the options show them */

/** English, the way his texts write it: "Mon 9/28". */
function dayShort(date) {
  const [y, mo, d] = String(date).split('-').map(Number);
  return `${DOW.en[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ${mo}/${d}`;
}

/** English: "8–10 AM" · "11 AM–1 PM" · "8:30–10:30 AM". Spanish keeps its sentence: "las 8 y las 10 a.m.". */
function spanOf(w, lang) {
  if (lang === 'es') return windowSpan(w, 'es');
  const a = clock(toMin(w.start), 'en'), b = clock(toMin(w.end), 'en');
  return a.ap === b.ap ? `${a.t}–${b.t} ${b.ap}` : `${a.t} ${a.ap}–${b.t} ${b.ap}`;
}

/** A day at the start of a line (visit 1): "Mon 9/28" · "Lunes 28 de septiembre"; after "then": "Tue 9/29" · "martes 29 de septiembre". */
const dayFirst = (date, lang) => (lang === 'es' ? lineDay(date, 'es') : dayShort(date));
const dayThen = (date, lang) => (lang === 'es' ? dayLabel(date, 'es') : dayShort(date));

/** road XW · how long a visit takes, in plain words: "about 4 hours" · "about 1½ hours" · "about 45 minutes" ·
    "unas 4 horas" · "una hora y media". Rounded to the half hour from an hour up. */
function lengthWords(min, lang) {
  const m = Number(min);
  if (!Number.isInteger(m) || m <= 0) return '';
  if (m < 60) return lang === 'es' ? `unos ${m} minutos` : `about ${m} minutes`;
  const halves = Math.round(m / 30), h = Math.floor(halves / 2), half = halves % 2 === 1;
  if (lang === 'es') {
    if (h === 1) return half ? 'una hora y media' : 'una hora';
    return `unas ${h} horas${half ? ' y media' : ''}`;
  }
  return `about ${h}${half ? '½' : ''} ${h === 1 && !half ? 'hour' : 'hours'}`;
}
/** "about 4 hours" for visit i (0 = the first), when the quote carries its length; else ''. */
function visitLenWords(b, i, lang) {
  const list = b && Array.isArray(b.visit_minutes) ? b.visit_minutes : null;
  return list ? lengthWords(list[i], lang) : '';
}

/** One visit on an option card, the day in bold: "<b>Mon 9/28</b>, arriving 8–10 AM" · "then <b>Tue 9/29</b>, arriving 11 AM–1 PM".
    road XW: and how long it takes, when the Flux sends it, on a small line of its own under its arrival window
    ("about 4 hours") — on one line with the window it would break "11 AM–1 PM" across two lines on a phone. */
function cardVisitHtml(x, i, lang, w, b) {
  const [pre, post] = (i === 0 ? w.card_first : w.card_then).split('{day}');
  const len = visitLenWords(b, i, lang);
  return `<span class="qvl">${esc(pre)}<span class="qod">${esc(i === 0 ? dayFirst(x.date, lang) : dayThen(x.date, lang))}</span>` +
    `${esc(fill(post, { span: spanOf(x, lang) }))}${len ? `<span class="qlen"><span class="qsep"> · </span>${esc(len)}</span>` : ''}</span>`;
}

/** road XW · the "included" line as the page says it. When they said they have leftover paint (the form's answer, or
    the Flux's their_paint), the sentence that says the paint is included ("Paint for the color match is included." ·
    "La pintura … incluida.") reads "Painted with your paint." instead. Any other line is left exactly as sent. */
const PAINT_INCLUDED = /^\s*(paint\b[^.!?]*\bincluded\b|la pintura\b[^.!?]*\bincluida\b)/i;
function includedLine(b, lang, w) {
  const inc = b && b.included ? String(b.included) : '';
  if (!inc || !(b.their_paint === true)) return inc;
  const parts = inc.match(/[^.!?]+[.!?]*\s*/g) || [inc];
  let swapped = false;
  const out = parts.map((p) => {
    if (!swapped && PAINT_INCLUDED.test(p)) { swapped = true; return w.paint_theirs + (/\s$/.test(p) ? ' ' : ''); }
    return p;
  }).join('').trim();
  return swapped ? out : inc;
}

/** Every option the quote offers, each with all its visits: [{ n, visits: [{date, start, end, free}], free }]. */
function optionsOf(v) {
  if (Array.isArray(v.options) && v.options.length) return v.options.map((o) => ({ n: o.n, visits: o.windows || [], free: o.free }));
  return (v.windows || []).map((x) => ({ n: x.n, visits: [x], free: x.free }));
}

/** The hold as the page says it. road FW (2026-09-26) · ONE HOLD: exactly the book's `hold_until` — the value the
    create, /sent and GET /admin/quote/<id> answer and the Flux shows — to the minute, never rounded, never an older one.
    The rule is quotes.js's: (sent_at, or created_at until it is sent) + 48 hours, and never past the cutoff. */
function heldUntilMs(v) {
  const at = Date.parse(v.hold_until);
  return isFinite(at) ? Math.floor(at / 60000) * 60000 : NaN;
}

/** "Sat 9/26, 8:00 AM" (the text's own style) · "sábado 26 de septiembre a las 8:00 a.m." */
function holdLabel(ms, lang) {
  if (lang === 'es') return momentLabel(new Date(ms).toISOString(), 'es');
  const p = Object.fromEntries(CHI.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const c = clock(Number(p.hour) % 24 * 60 + Number(p.minute), 'en', true);
  return `${p.weekday} ${p.month}/${p.day}, ${c.t} ${c.ap}`;
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
.qsay{font-size:1.15rem;font-weight:600;line-height:1.35;margin:.1rem 0 .55rem;color:#0F0B1A}
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
.qopt .qov{display:grid;gap:.3rem;min-width:0}
.qopt .qvl{display:block;font-size:1.02rem;line-height:1.35}
.qopt .qvl .qod{display:inline;font-weight:600;font-size:inherit}
.qopt .qvl+.qvl{color:#4E4960}
.qticket .qtw .qtd+.qtwin{margin:0}
.qticket .qtw .qtwin+.qtd{margin-top:.6rem}
.qticket .qtd .qthen{font-weight:500;color:#4E4960}
.qact{margin:1.1rem 0 .7rem}
.qact .qgo{margin:0}
.qfold{margin:0 0 1.1rem}
.qfold summary svg:first-child{color:#0D7471}
.qfold .qlb{padding:.85rem .95rem .3rem}
.qfold .qwork{margin:0 0 .6rem}
.qbelow{margin-top:1.8rem}
.qopt .qvl .qlen{display:block;font-size:.85rem;line-height:1.25;color:#4E4960}
.qopt .qvl .qsep,.qtwin .qsep{display:none}
.qtwin .qlen{display:block;font-size:.88rem;line-height:1.3;color:#4E4960}
.qopt:has(.qlen){padding-top:.55rem;padding-bottom:.55rem}
.qopt:has(.qlen) .qov{gap:.2rem}
.q:has(.qlen) .qhold{margin-bottom:.9rem}
.q:has(.qlen) .qact{margin-top:.8rem}
.qmore{text-align:left;margin:0 0 .6rem}
.qyear{display:grid;grid-template-columns:auto 1fr;align-items:center;column-gap:.75rem;row-gap:.4rem;margin:0 0 1.1rem;padding:.7rem .95rem;background:#fff;border:1px solid #D9D2C7;border-radius:14px}
.qyear label{font-weight:600;font-size:1rem;line-height:1.3;grid-column:1 / -1;grid-row:1}
.qyear .qsmall{text-align:left;margin:0;grid-column:2;grid-row:2;font-size:.85rem;line-height:1.3}
.qyear input{grid-column:1;grid-row:2;font:inherit;font-size:1.1rem;width:5.6rem;min-height:48px;box-sizing:border-box;padding:.5rem .7rem;border:2px solid #D9D2C7;border-radius:12px;background:#fff;color:#0F0B1A}
.qyear input:focus-visible{outline:3px solid #2F6BB0;outline-offset:2px;border-color:#0D7471}
@supports selector(:has(a)){
.q:has(.qpick input:checked) .qact.qpin{position:sticky;z-index:30;bottom:0;margin:.5rem 0 .7rem;padding:.6rem 0 calc(10px + env(safe-area-inset-bottom, 0px));background:linear-gradient(rgba(246,243,238,0),#F6F3EE .7rem)}
.q:has(.qpick input:checked) .qgo{box-shadow:0 10px 28px rgba(15,11,26,.3)}
}
`;

/* road CO: the change order's page adds these, on its own pages only (every quote page stays byte for byte as it was) */
const CHANGE_STYLE = `
.qwhat{font-size:1.12rem;font-weight:600;line-height:1.35;margin:.55rem 0 0}
.qtot{display:flex;align-items:baseline;justify-content:space-between;gap:.8rem;padding:.95rem 1.2rem 1.05rem}
.qtot .qtl{margin:0}
.qtot .qtv{font-size:1.6rem;font-weight:600;margin:0}
.qtot .qtwas{display:block;font-size:.9rem;color:#4E4960;font-weight:400}
.qsign{display:grid;gap:.4rem;margin:1.1rem 0 0}
.qsign label{font-weight:600;font-size:1.05rem}
.qsign input{font:inherit;font-size:1.15rem;min-height:52px;box-sizing:border-box;width:100%;padding:.6rem .9rem;border:2px solid #D9D2C7;border-radius:14px;background:#fff;color:#0F0B1A}
.qsign input:focus-visible{outline:3px solid #2F6BB0;outline-offset:2px;border-color:#0D7471}
.qsign .qsmall{text-align:left;margin:0}
.qadds{background:#fff;border:1px solid #D9D2C7;border-radius:14px;margin:0 0 .7rem}
.qadds .qah{display:flex;gap:.7rem;align-items:center;min-height:52px;box-sizing:border-box;padding:.55rem .95rem;border-bottom:1px solid #ECE7DF}
.qadds .qah svg{color:#0D7471;width:1.4em;height:1.4em;flex:none}
.qadds .qlt{display:grid;gap:.05rem}
.qadds .qlh{font-weight:600;font-size:.97rem}
.qadds .qlp{font-weight:400;font-size:.88rem;color:#4E4960}
.qadds .qwork{padding:.8rem .95rem .3rem;margin:0}
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
  list: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M3.8 6.6l1.3 1.3 2.4-2.6M3.8 12.1l1.3 1.3 2.4-2.6M3.8 17.6l1.3 1.3 2.4-2.6"/></svg>',
};

/** The four steps. `done` are ticked; `now` (an index, or -1) is the current one. */
function stepsHtml(w, done, now) {
  return `<ol class="qsteps" aria-label="${esc(w.steps_label)}">` + w.steps.map((label, i) => {
    const cls = i < done ? 'done' : i === now ? 'now' : '';
    return `<li${cls ? ` class="${cls}"` : ''}${cls === 'now' ? ' aria-current="step"' : ''}><span class="dot">${cls === 'done' ? ICON.check : ''}</span>${esc(label)}</li>`;
  }).join('') + '</ol>';
}

/** The ticket's time half: the calendar icon, a small label, and every visit — its day, then "Arriving 8–10 AM".
    road W: a second visit reads "then Tue 9/29". */
function ticketVisitsHtml(label, visits, lang, w, b) {
  const rows = visits.map((x, i) => `<p class="qtd">${i === 0 ? esc(dayFirst(x.date, lang))
    : `<span class="qthen">${esc(w.ticket_then)}</span> ${esc(dayThen(x.date, lang))}`}</p>` +
    `<p class="qtwin">${esc(fill(w.ticket_arrive, { span: spanOf(x, lang) }))}${visitLenWords(b, i, lang)
      ? `<span class="qlen"><span class="qsep">${esc(fill(w.visit_len, { len: '' }))}</span>${esc(visitLenWords(b, i, lang))}</span>` : ''}</p>`).join('');
  return `<div class="qtw">${ICON.cal}<div><p class="qtl">${esc(label)}</p>${rows}</div></div>`;
}

function frame(lang, state, inner, { bilingual = false, changeTitle = null } = {}) {
  const w = WORDS[lang] || WORDS.en;
  /* The title and the preview tags are generic on every state: never a price, a name or an address. */
  const title = changeTitle || (bilingual ? WORDS.en.title : w.title);
  return `<!DOCTYPE html>
<html lang="${lang === 'es' ? 'es' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<link rel="stylesheet" href="/assets/site.css?v=${CSS_V}">
<style>${STYLE}</style>${changeTitle ? `\n<style>${CHANGE_STYLE}</style>` : ''}
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

/* UMBRA-SIDE-01 (lane P, 2026-09-28) · THE LEAD LINE. A house built before 1978 (or "not sure"), on a paint or hole job:
   one line under "Good to know" with the EPA's own pamphlet, which the renovation rule has him hand over before the work.
   Only then; every other quote page is byte for byte as before. */
export const RENOVATE_RIGHT = 'https://www.epa.gov/lead/renovate-right-important-lead-hazard-information-families-child-care-providers-and-schools';
function leadHtml(lang) {
  return lang === 'es'
    ? `<p class="qnote" id="notice-lead">¿Casa de antes de 1978? Lea primero el folleto de la EPA <a href="${RENOVATE_RIGHT}" rel="noreferrer">Renovate Right</a>.</p>\n`
    : `<p class="qnote" id="notice-lead">Built before 1978? Read the EPA's <a href="${RENOVATE_RIGHT}" rel="noreferrer">Renovate Right</a> first.</p>\n`;
}

function noticesHtml(env, lang) {
  const w = WORDS[lang] || WORDS.en;
  const light = String(env.NOTICE_LIGHTING ?? 'true') === 'true';
  const law = String(env.NOTICE_53255 ?? 'false') === 'true' && NOTICE_53255.length > 0;
  if (!light && !law) return '';
  /* road XW: the one-line "Light." in English — READY-4's full paragraph stays in notices.js for the record. The Spanish
     keeps its reviewed paragraph (LIGHTING_ES) until his reviewer has read a one-line version. */
  const L = lang === 'es' ? LIGHTING_ES : LIGHT_SHORT.en;
  /* road W: the notices sit below the button now, under the page's own "Good to know" heading (openPage writes it) */
  let out = '';
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

/**
 * OPEN, HOLD ENDED BUT OPEN, and TAKEN with a choice still free: the quote and its two buttons.
 * road W, phone first: the dots · "Your quote" · the big price (never its arithmetic) · the step list folded to one
 * line · the choice, each option one card listing all its days · the hold (hold_until, to the minute) · Accept, right under
 * the choice, pinned to the bottom of the screen once a choice is picked (CSS :has, no JavaScript) · None of these
 * times work · then, below the buttons, his promise, his insurance and the notices.
 */
function openPage(env, v, code, nowIso, pickError, lead = false) {
  const lang = v.lang === 'es' ? 'es' : 'en';
  const w = WORDS[lang];
  const b = v.body || {};
  const all = optionsOf(v);
  const free = all.filter((o) => o.free);
  const taken = v.state === 'taken';
  const pairs = all.some((o) => o.visits.length > 1);

  if (taken && free.length === 0) {
    return wordsPage(200, lang, 'taken', pairs ? w.h_taken_pair : w.h_taken, w.taken_none);
  }

  const offer = taken ? free : all;
  const choose = offer.length > 1;
  /* "these times" once more than one visit is on the page (two choices, or one choice of two days) */
  const plural = offer.reduce((n, o) => n + o.visits.length, 0) > 1;
  const parts = [];
  parts.push(stepsHtml(w, 1, 1));
  if (taken) parts.push(`<p class="qerr" role="status">${esc(pairs ? w.h_taken_pair : w.h_taken)} ${esc(pairs ? w.taken_other_pair : w.taken_other)}</p>`);
  parts.push(`<h1>${esc(w.h1_quote)}</h1>`);
  parts.push(`<p class="qhi">${esc(b.first_name ? fill(w.hi_name, { name: b.first_name }) : w.hi)}</p>`);

  /* the ticket: the one price and what it includes (a tick, never a "+" that reads like an add-on) — and, with one
     choice offered, all its days below the tear. The price's arithmetic ("5 hours at $45") is his, not theirs. */
  parts.push('<div class="qticket"><div class="qtt">' +
    `<p class="qtl">${esc(w.h_price)}</p><p class="qprice">${esc(money(b.price))}</p>` +
    (b.included ? `<p class="qti">${ICON.check}<span>${esc(includedLine(b, lang, w))}</span></p>` : '') + '</div>' +
    (choose ? '' : `<div class="qtear" aria-hidden="true"></div>${ticketVisitsHtml(w.h_when, offer[0].visits, lang, w, b)}`) + '</div>');

  /* what we'll do: one line until it is tapped (<details>, no JavaScript) */
  const scope = b.scope || [];
  if (scope.length) {
    /* road XW: the count is the Flux's plan (step_count, when it sends one), never fewer than the lines listed; the
       steps the list does not name (setting up, cleaning up) are counted in one line under it */
    const count = Number.isInteger(b.step_count) && b.step_count >= scope.length ? b.step_count : scope.length;
    const more = count - scope.length;
    parts.push(`<details class="qlaw qfold"><summary>${ICON.list}<span class="qlt"><span class="qlh">${esc(w.h_work)}</span>` +
      `<span class="qlp">${esc(count === 1 ? w.work_hint_one : fill(w.work_hint, { n: count }))}</span></span>` +
      `<span class="chev">${ICON.chev}</span></summary>\n<div class="qlb"><ul class="qwork">` +
      scope.map((s) => `<li><span class="ck">${ICON.check}</span><span>${esc(s)}</span></li>`).join('') + '</ul>' +
      (more > 0 ? `<p class="qsmall qmore">${esc(more === 1 ? w.work_more_one : fill(w.work_more, { n: more }))}</p>` : '') + '</div></details>');
  }

  const form = [];
  form.push(`<form method="post" action="/q/${esc(code)}">`);
  form.push(`<input type="hidden" name="v" value="${esc(v.version)}">`);
  /* road XW: the year their house was built — one optional box, kept on the record with the accept (and even if the
     booking is refused); the Flux reads it as year_built. Filled in again if they gave it already.
     road MW (2026-09-26): shown from the start, ABOVE the choice. Accept sits last in this form and, once a day is
     picked, is stuck to the bottom of the screen while its own place is below it (position: sticky, CSS :has — no
     JavaScript). A sticky bar only ever covers what comes before its own place, and the page opens at the top with the
     year box on the first screen, so the bar never sits over the year box; "None of these times work" comes after the
     form, so never over that either. With one choice there is nothing to pick and nothing is pinned. */
  form.push(`<div class="qyear"><label for="q-year">${esc(w.year_label)}</label><p class="qsmall" id="q-year-hint">${esc(w.year_hint)}</p>` +
    `<input type="text" id="q-year" name="year" inputmode="numeric" maxlength="4" autocomplete="off" aria-describedby="q-year-hint"` +
    `${v.year_built ? ` value="${esc(v.year_built)}"` : ''}></div>`);
  if (choose) {
    if (pickError) form.push(`<p class="qerr" id="pick-error">${esc(w.pick_error)}</p>`);
    form.push(`<fieldset class="qpick"${pickError ? ' aria-describedby="pick-error"' : ''}><legend>${esc(pairs ? w.pick_legend_pair : w.pick_legend)}</legend>`);
    for (const o of offer) {
      form.push(`<label class="qopt"><input type="radio" name="w" value="${esc(o.n)}" required><span class="qov">` +
        o.visits.map((x, i) => cardVisitHtml(x, i, lang, w, b)).join('') + '</span></label>');
    }
    form.push('</fieldset>');
  } else if (all.length > 1) {
    /* One choice of two left free: name it, so the book never has to guess. One choice of one: nothing to say. */
    form.push(`<input type="hidden" name="w" value="${esc(offer[0].n)}">`);
  }
  const heldMs = heldUntilMs(v);
  const holdEnded = v.state === 'hold_ended' || (isFinite(heldMs) && Date.parse(nowIso) >= heldMs);
  if (holdEnded || isFinite(heldMs)) {
    form.push(`<p class="qhold">${ICON.clock}<span>${esc(holdEnded
      ? (plural ? w.hold_ended_two : w.hold_ended_one)
      : fill(plural ? w.hold_two : w.hold_one, { at: holdLabel(heldMs, lang) }))}</span></p>`);
  }
  form.push(`<div class="qact qpin"><button type="submit" class="qgo">${esc(w.accept)}</button></div>`);
  form.push('</form>');
  parts.push(form.join('\n'));

  parts.push(`<form method="post" action="/q/${esc(code)}/none"><input type="hidden" name="v" value="${esc(v.version)}"><button type="submit" class="qalt">` +
    `${esc(choose ? w.none : plural ? w.none_pair : w.none_one)}</button></form>`);
  parts.push(`<p class="qsmall">${esc(offer.every((o) => o.visits.length === 1) ? w.small : w.small_pair)}</p>`);

  /* below the buttons: his promise and his insurance (each only if the quote carries it), then the notices */
  const below = [];
  const trust = [];
  if (b.guarantee) trust.push(`<li>${ICON.redo}<span>${esc(b.guarantee)}</span></li>`);
  if (b.insurance) trust.push(`<li>${ICON.shield}<span>${esc(b.insurance)}</span></li>`);
  if (trust.length) below.push(`<ul class="qtrust">${trust.join('')}</ul>`);
  const notices = noticesHtml(env, lang);
  if (notices) below.push(notices);
  if (lead) below.push(leadHtml(lang));
  if (below.length) parts.push(`<div class="qbelow">\n<h2>${esc(w.h_notices_below)}</h2>\n${below.join('\n')}</div>`);

  const state = taken ? 'taken' : holdEnded ? 'hold_ended' : 'open';
  return page(200, lang, state + (pickError ? ' pick' : ''), parts.join('\n'));
}

/** Every visit a booked quote holds: all the days of the option they accepted (else of its only one). */
function bookedVisits(v) {
  const opts = optionsOf(v);
  const o = opts.find((y) => y.n === v.accepted_window) || opts[0];
  return o ? o.visits : [];
}
const bookedWindow = (v) => bookedVisits(v)[0];

/** SITE-FIX-03 · THE ONE LINE THE BOOKED PAGE SAYS OUT LOUD, under "You're booked.": the day, the window,
    the price, then the promise of the text the day before — em-dash separated, in the customer's language.
    A fact the booking does not carry is DROPPED, never left as a blank dash: a record with a day but no
    window reads "Tue, Nov 10 — $395 — I'll text you the day before." The promise is a promise only: the
    FLUX sends that text on its Job Sync tick (FLUX-FIX-16). This page never texts.
    `window` is a visit ({date, start, end}); `price` is the accepted version's own price. */
export function bookedSummary(window, price, lang) {
  const l = lang === 'es' ? 'es' : 'en';
  const parts = [];
  if (window && window.date) parts.push(lineDay(window.date, l));
  /* English says the span bare — "8–10 AM" stands on its own between the dashes. Spanish does not: "las 8 y
     las 10 a.m." alone is not a phrase, so it takes the ticket's own word below it, "Llegada entre {span}".
     No new word is minted for this line in either language. */
  if (window && window.start && window.end) {
    const span = spanOf(window, l);
    parts.push(l === 'es' ? fill(WORDS.es.ticket_arrive, { span }) : span);
  }
  if (price != null && price !== '' && Number.isFinite(Number(price))) parts.push(money(price));
  parts.push(WORDS[l].booked_promise);
  return parts.join(' — ');
}

/** SITE-FIX-03 · THE ONE EMAIL A BOOKING SENDS. On 10-01 Jose booked here and his inbox stayed empty: the
    website's only email was the request copy at the form. This sends the other half, on the booking, when
    the customer gave an address on the request form — never otherwise, and never twice: the stamp in the
    record is CLAIMED FIRST (quotes.js claimConfirmationEmail), so a second tap, a reload or a retry finds
    it taken and sends nothing.

    The road is the one the request copy already rides: FormSubmit's `_autoresponse` is the customer's own
    copy, exactly as assets/umbra-sent.js sends it at the form. No `job_id` and no `status_link` go with it
    — the status link carries the quote code and the code is the secret.

    The day, the window and the price are written by this file's own lineDay/spanOf/money, so the inbox and
    the booked screen spell the same visit the same way; a fact the booking does not carry is dropped, as
    bookedSummary drops it. The window is the booking's first visit, the arrival the screen names first.

    THIS SENDS NO TEXT. Only the FLUX texts (FLUX-FIX-16) — one sender, or the customer hears twice.

    Only the page road reaches here. A YES Drew marks by text goes through bookByJob and gets no email,
    which is right: that customer is already in a text thread with him. */
async function confirmByEmail(env, r, nowIso) {
  if (!r || r.state !== 'booked' || !r.job_id) return;
  const to = await claimConfirmationEmail(env, r.job_id, nowIso);
  if (!to) return;
  const lang = r.lang === 'es' ? 'es' : 'en';
  const w = r.window;
  const mail = confirmationEmail({
    lang,
    day: w && w.date ? lineDay(w.date, lang) : '',
    span: w && w.start && w.end ? spanOf(w, lang) : '',
    price: r.price != null && r.price !== '' && Number.isFinite(Number(r.price)) ? money(r.price) : '',
    phone: env.BUSINESS_PHONE,
  });
  let out = null;
  try {
    out = await forwardToFormSubmit(env, [
      /* the address FormSubmit answers the autoresponse to: the customer's own */
      ['email', to],
      ['_subject', mail.subject],
      ['_autoresponse', mail.body],
      ['_template', 'table'],
      ['_captcha', 'false'],
    ]);
  } catch (err) {
    console.error('confirmation email: send threw for', r.job_id, String(err && err.message || err));
    out = { ok: false, status: 0 };
  }
  await noteConfirmationEmail(env, r.job_id, out, nowIso);
}

function bookedPage(v, code) {
  const lang = v.lang === 'es' ? 'es' : 'en';
  const w = WORDS[lang];
  const visits = bookedVisits(v);
  /* road W: the ticket lists every day booked; "Nothing else to do." — the booking is done, not waiting on a text */
  const inner = [
    stepsHtml(w, 3, -1),
    `<div class="qok" aria-hidden="true">${ICON.check}</div>`,
    `<h1>${esc(w.h_booked)}</h1>`,
    `<p class="qsay">${esc(bookedSummary(bookedWindow(v), v.body && v.body.price, lang))}</p>`,
    `<p class="qhi">${esc(w.booked_done)}</p>`,
    '<div class="qticket">' + (visits.length ? ticketVisitsHtml(visits.length > 1 ? w.lbl_visits : w.lbl_visit, visits, lang, w, v.body) + '<div class="qtear" aria-hidden="true"></div>' : '') +
      `<div class="qtt"><p class="qtl">${esc(w.h_price)}</p><p class="qprice" style="font-size:2.1rem">${esc(money(v.body && v.body.price))}</p></div></div>`,
    visits.length ? `<a class="qalt" href="/q/${esc(code)}/calendar.ics">${ICON.cal}<span>${esc(w.add_calendar)}</span></a>` : '',
    `<p class="qsmall">${esc(w.booked_small)}</p>`,
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

/** Every booked visit as its own VEVENT (road W: both days of a two-visit job). No name, phone, address or price:
    the day, the window and a line of words. The first visit keeps the UID it always had. */
async function calendarFile(v, code, nowIso) {
  const lang = v.lang === 'es' ? 'es' : 'en';
  const w = WORDS[lang];
  /* the UID is never the code itself: the first 32 hex of sha256(code), with no @ in it */
  const uid = 'umbradomus-' + (await codeHash(code)).slice(0, 32);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Umbra Domus//Quote page//EN',
    'METHOD:PUBLISH',
  ];
  bookedVisits(v).forEach((x, i) => {
    const [y, mo, d] = String(x.date).split('-').map(Number);
    const [eh, em] = String(x.end).split(':').map(Number);
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + uid + (i ? '-' + (i + 1) : ''),
      'DTSTAMP:' + icsUtc(Date.parse(nowIso)),
      'DTSTART:' + icsUtc(windowStartMs(x)),
      'DTEND:' + icsUtc(chicagoWall(y, mo, d, eh, em)),
      'SUMMARY:' + icsText(w.ics_title),
      'DESCRIPTION:' + icsText(fill(w.ics_desc, { window: windowSpan(x, lang) })),
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ road CO · the change order's page */

/** "Tue 9/29, 1:02 PM" · "martes 29 de septiembre a la 1:02 p.m." — when they OK'd it, on Chicago's clock */
function answeredLabel(iso, lang) {
  if (lang === 'es') return momentLabel(iso, 'es');
  const p = Object.fromEntries(CHI.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const c = clock(Number(p.hour) % 24 * 60 + Number(p.minute), 'en', true);
  return `${p.weekday} ${p.month}/${p.day}, ${c.t} ${c.ap}`;
}

function changePage(v, code, signError) {
  const lang = v.lang === 'es' ? 'es' : 'en';
  const w = CHANGE_WORDS[lang];
  const b = v.body || {};
  const ticket = (big) => '<div class="qticket"><div class="qtt">' +
    `<p class="qtl">${esc(fill(w.lbl, { n: v.version }))}</p><p class="qprice"${big ? '' : ' style="font-size:2.1rem"'}>${esc(fill(w.more, { price: money(b.price) }))}</p>` +
    `<p class="qwhat" id="change-what">${esc(b.what)}</p></div><div class="qtear" aria-hidden="true"></div>` +
    `<div class="qtot"><p class="qtl">${esc(w.lbl_total)}<span class="qtwas">${esc(fill(w.was, { base: money(b.base) }))}</span></p><p class="qtv" id="change-total">${esc(money(b.total))}</p></div></div>`;
  const scope = b.scope || [];
  /* road MW (2026-09-26): when the Flux says which lines are the work (work_lines), the page shows the WORK, in the open,
     and when it happens — "What it adds · 5 steps · done during your booked visits" — and the store items only under a
     fold of their own ("What it uses · 2 items"). Without it, every line in one fold, as road CO made it. */
  const nWork = Number.isInteger(b.work_lines) && b.work_lines > 0 ? Math.min(b.work_lines, scope.length) : 0;
  const fold = (head, hint, lines) => `<details class="qlaw qfold"><summary>${ICON.list}<span class="qlt"><span class="qlh">${esc(head)}</span>` +
    `<span class="qlp">${esc(hint)}</span></span>` +
    `<span class="chev">${ICON.chev}</span></summary>\n<div class="qlb"><ul class="qwork">` +
    lines.map((x) => `<li><span class="ck">${ICON.plus}</span><span>${esc(x)}</span></li>`).join('') + '</ul></div></details>';
  let adds = '';
  if (nWork) {
    const work = scope.slice(0, nWork), items = scope.slice(nWork);
    adds = `<div class="qadds" id="change-work"><div class="qah">${ICON.list}<span class="qlt"><span class="qlh">${esc(w.h_adds)}</span>` +
      `<span class="qlp">${esc(nWork === 1 ? w.work_hint_one : fill(w.work_hint, { n: nWork }))}</span></span></div>` +
      `<ul class="qwork">${work.map((x) => `<li><span class="ck">${ICON.plus}</span><span>${esc(x)}</span></li>`).join('')}</ul></div>` +
      (items.length ? '\n' + fold(w.h_items, items.length === 1 ? w.items_hint_one : fill(w.items_hint, { n: items.length }), items) : '');
  } else if (scope.length) {
    adds = fold(w.h_adds, scope.length === 1 ? w.adds_hint_one : fill(w.adds_hint, { n: scope.length }), scope);
  }
  if (v.state === 'accepted') {
    const who = v.signed_name || '';
    return page(200, lang, 'change_ok', [
      `<div class="qok" aria-hidden="true">${ICON.check}</div>`,
      `<h1>${esc(w.h_ok)}</h1>`,
      `<p class="qhi">${esc(fill(w.ok_lead, { name: who }))}</p>`,
      ticket(false), adds,
      v.answered_at ? `<p class="qsmall" id="change-signed">${esc(fill(w.ok_small, { name: who, at: answeredLabel(v.answered_at, lang) }))}</p>` : '',
      `<p class="qsmall">${esc(w.questions)}</p>`,
    ].join('\n'), { changeTitle: w.title });
  }
  if (v.state === 'declined') {
    return page(200, lang, 'change_no', `<div class="qwords">\n<h1>${esc(w.h_no)}</h1>\n<p class="qhi">${esc(w.no_lead)}</p>\n<p class="qsmall">${esc(w.questions)}</p>\n</div>`, { changeTitle: w.title });
  }
  if (v.state !== 'open') {
    return page(200, lang, 'change_withdrawn', `<div class="qwords">\n<h1>${esc(w.h_withdrawn)}</h1>\n<p class="qhi">${esc(w.withdrawn)}</p>\n</div>`, { changeTitle: w.title });
  }
  const parts = [];
  parts.push(`<h1>${esc(w.h1)}</h1>`);
  parts.push(`<p class="qhi">${esc(b.first_name ? fill(w.lead_name, { name: b.first_name }) : w.lead)} ${esc(w.nothing_yet)}</p>`);
  parts.push(ticket(true));
  if (adds) parts.push(adds);
  parts.push(`<form method="post" action="/q/${esc(code)}">` +
    `<input type="hidden" name="v" value="${esc(v.version)}"><input type="hidden" name="a" value="ok">` +
    (signError ? `<p class="qerr" id="sign-error">${esc(w.sign_error)}</p>` : '') +
    `<div class="qsign"><label for="change-name">${esc(w.sign_label)}</label>` +
    `<input type="text" id="change-name" name="name" autocomplete="name" maxlength="80" required${signError ? ' aria-describedby="sign-error" autofocus' : ''}>` +
    `<p class="qsmall">${esc(w.sign_hint)}</p></div>` +
    `<div class="qact"><button type="submit" class="qgo">${esc(w.ok)}</button></div></form>`);
  parts.push(`<form method="post" action="/q/${esc(code)}"><input type="hidden" name="v" value="${esc(v.version)}"><input type="hidden" name="a" value="no">` +
    `<button type="submit" class="qalt">${esc(w.no)}</button></form>`);
  parts.push(`<p class="qsmall">${esc(w.no_small)}</p>`);
  return page(200, lang, 'change_open' + (signError ? ' sign' : ''), parts.join('\n'), { changeTitle: w.title });
}

function statePage(env, v, code, nowIso, pickError, lead = false) {
  if (!v || v.state === 'not_found') return notValid();
  if (v.kind === 'change') return changePage(v, code, pickError);
  const lang = v.lang === 'es' ? 'es' : 'en';
  const w = WORDS[lang];
  switch (v.state) {
    case 'open':
    case 'hold_ended':
    case 'taken':
      return openPage(env, v, code, nowIso, pickError, lead);
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
    /* road CO: a change order's answer — a=ok with the name they typed, or a=no. A quote's form never sends `a`. */
    const act = form ? String(form.get('a') || '') : '';
    if (!isNone && (act === 'ok' || act === 'no')) {
      const r = await answerChangeByCode(env, code, v, act === 'ok' ? 'yes' : 'no', form.get('name'), nowIso);
      return seeOther(code, r && r.state === 'need_name' ? '?sign=1' : '');
    }
    const wRaw = form ? form.get('w') : null;
    const win = wRaw === null || wRaw === '' ? null : (/^\d{1,2}$/.test(String(wRaw)) ? Number(wRaw) : -1);
    if (isNone) {
      await markNone(env, code, v, nowIso);
      return seeOther(code);
    }
    /* road XW: the year their house was built, if they typed one — kept first, so a refused booking never loses it */
    const year = readYear(form ? form.get('year') : null, nowIso);
    const kept = year ? await noteYearByCode(env, code, v, year, nowIso, { stamp: false }) : null;
    const r = await bookByCode(env, code, v, win, 'page', nowIso);
    /* a booking stamps the record (the year with it); anything else, the year's own stamp */
    if (kept && kept.state === 'kept' && !(r && r.state === 'booked')) await stampAfterYear(env, kept.job_id, nowIso);
    /* SITE-FIX-03: the booking's one confirmation email, when they gave an address. Awaited, so the record
       carries its stamp before the 303 the browser follows back to the booked screen. */
    if (r && r.state === 'booked') await confirmByEmail(env, r, nowIso);
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
    /* lane P: the lead line reads the job's own record (read only — the GET still writes nothing but the visit count) */
    let lead = false;
    if (v && v.kind !== 'change' && ['open', 'hold_ended', 'taken'].includes(v.state) && v.job_id) {
      try { const rec = await getRecord(env, v.job_id); lead = Boolean(rec && leadApplies(rec)); } catch (err) { lead = false; }
    }
    return head(method, statePage(env, v, code, nowIso, url.searchParams.get(v && v.kind === 'change' ? 'sign' : 'pick') === '1', lead));
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
