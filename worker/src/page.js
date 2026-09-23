/* THE CUSTOMER'S PAGE (ACCEPT-PAGE-02). The link at the end of the quote text: /q/<22-character code>,
   reached on our own domain through the site's rewrite (vercel.json → this Worker), so the address bar stays
   on umbradomus.com and the form posts are same-origin. No JavaScript anywhere: plain HTML forms, plain pages.

     GET  /q/<code>        the page. It changes nothing but the visit count on the book's row (viewByCode) —
                           link previews and mail scanners open links by themselves, so opening must be harmless.
     POST /q/<code>        Accept & confirm → bookByCode(…, "page") → 303 back to GET, which then says BOOKED.
     POST /q/<code>/none   None of these times work → markNone → 303 back to GET, which then says RECEIVED.

   THE SEAM (the ignite's AMENDMENT 2, E1): this file calls only ACCEPT-PAGE-01's viewByCode, bookByCode and
   markNone, which already count, stamp and push. It never writes KV and never pushes by itself.

   THE ORIGIN CHECK RUNS FIRST on a POST, before the code is looked up: an Origin header that is present and not
   one of the site's own origins (SITE_BASE_URL's and its www/apex twin — "null" is foreign), or
   Sec-Fetch-Site: cross-site, answers 403 and nothing is written. Neither header → allowed (older browsers).

   Every 303 carries a RELATIVE Location. Behind the rewrite this Worker's own host is workers.dev: an absolute
   URL would leave the site (and form-action 'self' would block the next post), and Response.redirect() throws
   on a relative one in workerd. So: new Response(null, { status: 303, headers: { Location: '/q/' + code } }). */

import { viewByCode, bookByCode, markNone } from './quotes.js';
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

const STYLE = `
.qtop{background:#fff;border-bottom:1px solid #D9D2C7;padding:.7rem 0}
.qbrand{display:flex;align-items:center;gap:.6rem;margin:0;font-weight:600;letter-spacing:.14em;text-transform:uppercase;font-size:1rem}
.qbrand img{width:34px;height:auto;display:block}
.q{padding:1.6rem 0 3rem}
.q h1{font-size:clamp(1.9rem,6vw,2.6rem)}
.q h2{font-size:1.25rem;letter-spacing:0;margin:1.6rem 0 .5rem}
.q ul{padding-left:1.2rem;margin:0 0 1rem}
.qprice{font-size:2.1rem;font-weight:600;line-height:1.1;margin:0 0 .35rem}
.qbox{background:#fff;border:1px solid #D9D2C7;border-radius:14px;padding:.9rem 1.1rem;margin:0 0 1rem}
.qpick{border:2px solid #0D7471;border-radius:14px;padding:.6rem 1rem .8rem;margin:0 0 1rem;min-width:0}
.qpick legend{font-weight:600;padding:0 .3rem}
.qpick label{display:flex;align-items:center;gap:.75rem;min-height:48px;padding:.25rem 0;cursor:pointer}
.qpick input{width:24px;height:24px;margin:0;flex:none;accent-color:#0D7471}
.qerr{border-left:5px solid #b83622;background:#fff;padding:.6rem .9rem;font-weight:600;margin:0 0 1rem}
.qnote{font-size:.97rem}
.q53{font-size:.9rem;background:#fff;border:1px solid #D9D2C7;border-radius:14px;padding:.9rem 1.1rem;margin:0 0 1rem}
.q53 p{margin:0 0 .7em}
.qgo{display:block;width:100%;min-height:56px;margin:1.2rem 0 .8rem;padding:.8rem 1.2rem;font:inherit;font-size:1.15rem;font-weight:600;border-radius:14px;border:2px solid #0D7471;background:#0D7471;color:#fff;cursor:pointer}
.qgo:hover{background:#0A5C5A;border-color:#0A5C5A}
.qalt{display:block;width:100%;min-height:48px;margin:0 0 1rem;padding:.6rem 1.2rem;font:inherit;font-size:1rem;font-weight:500;border-radius:14px;border:2px solid #4E4960;background:transparent;color:#0F0B1A;cursor:pointer}
.qgo:focus-visible,.qalt:focus-visible,.qpick input:focus-visible{outline:3px solid #2F6BB0;outline-offset:3px}
.qsmall{font-size:.95rem;color:#4E4960}
`;

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
<header class="qtop"><div class="wrap narrow"><p class="qbrand"><img src="/assets/mark-128.png?v=3" width="34" height="36" alt=""><span>Umbra Domus</span></p></div></header>
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
  return page(status, lang, state,
    `<h1>${esc(head)}</h1>\n<p class="lead">${esc(line)}</p>\n${withQuestions && line !== w.questions ? `<p class="qsmall">${esc(w.questions)}</p>` : ''}`);
}

/** The same page in both languages — for a link we cannot tie to a quote, so we cannot know its language. */
function bothPage(status, state, hk, lk) {
  const inner = ['en', 'es'].map((l) => `<section${l === 'es' ? ' lang="es"' : ''} style="padding:0 0 1.2rem">
<h1>${esc(WORDS[l][hk])}</h1>
<p class="lead">${esc(WORDS[l][lk])}</p>
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
  if (light) out += `<p class="qnote" id="notice-lighting"><strong>${esc(L.lead)}</strong> ${esc(L.text)}</p>\n`;
  if (law) {
    out += `<p class="qnote">${esc(w.statute_intro)}</p>\n<div class="q53" id="notice-53255" lang="en">\n` +
      NOTICE_53255.map((p) => `<p>${esc(p)}</p>`).join('\n') + '\n</div>\n';
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
  if (taken) parts.push(`<p class="qerr" role="status">${esc(w.h_taken)} ${esc(w.taken_other)}</p>`);
  parts.push(`<h1>${esc(w.title)}</h1>`);
  parts.push(`<p class="lead">${esc(b.first_name ? fill(w.hi_name, { name: b.first_name }) : w.hi)}</p>`);

  parts.push(`<h2>${esc(w.h_work)}</h2>`);
  parts.push('<ul>' + (b.scope || []).map((s) => `<li>${esc(s)}</li>`).join('') + '</ul>');

  parts.push(`<h2>${esc(w.h_price)}</h2>`);
  parts.push('<div class="qbox">' +
    `<p class="qprice">${esc(money(b.price))}</p>` +
    (b.price_note ? `<p>${esc(b.price_note)}</p>` : '') +
    (b.included ? `<p style="margin:0">${esc(b.included)}</p>` : '') + '</div>');
  if (b.guarantee) parts.push(`<p>${esc(b.guarantee)}</p>`);
  if (b.insurance) parts.push(`<p>${esc(b.insurance)}</p>`);

  const form = [];
  form.push(`<form method="post" action="/q/${esc(code)}">`);
  form.push(`<input type="hidden" name="v" value="${esc(v.version)}">`);
  form.push(`<h2 id="when">${esc(w.h_when)}</h2>`);
  if (plural) {
    if (pickError) form.push(`<p class="qerr" id="pick-error">${esc(w.pick_error)}</p>`);
    form.push(`<fieldset class="qpick"${pickError ? ' aria-describedby="pick-error"' : ''}><legend>${esc(w.pick_legend)}</legend>`);
    for (const x of offer) {
      form.push(`<label><input type="radio" name="w" value="${esc(x.n)}" required> <span>${esc(fill(w.when, { day: lineDay(x.date, lang), window: windowSpan(x, lang) }))}</span></label>`);
    }
    form.push('</fieldset>');
  } else {
    const x = offer[0];
    form.push(`<p class="qbox" style="font-weight:600">${esc(fill(w.when, { day: lineDay(x.date, lang), window: windowSpan(x, lang) }))}</p>`);
    /* One window of two left free: name it, so the book never has to guess. One window of one: nothing to say. */
    if (all.length > 1) form.push(`<input type="hidden" name="w" value="${esc(x.n)}">`);
  }
  const holdEnded = v.state === 'hold_ended' || (v.hold_until && Date.parse(nowIso) >= Date.parse(v.hold_until));
  form.push(`<p>${esc(holdEnded
    ? (plural ? w.hold_ended_two : w.hold_ended_one)
    : fill(plural ? w.hold_two : w.hold_one, { at: momentLabel(v.hold_until, lang) }))}</p>`);
  form.push(noticesHtml(env, lang));
  form.push(`<button type="submit" class="qgo">${esc(w.accept)}</button>`);
  form.push('</form>');
  parts.push(form.join('\n'));

  parts.push(`<form method="post" action="/q/${esc(code)}/none"><input type="hidden" name="v" value="${esc(v.version)}"><button type="submit" class="qalt">${esc(w.none)}</button></form>`);
  parts.push(`<p class="qsmall">${esc(w.small)}</p>`);

  const state = taken ? 'taken' : holdEnded ? 'hold_ended' : 'open';
  return page(200, lang, state + (pickError ? ' pick' : ''), parts.join('\n'));
}

function bookedPage(v) {
  const lang = v.lang === 'es' ? 'es' : 'en';
  const w = WORDS[lang];
  const x = (v.windows || []).find((y) => y.n === v.accepted_window) || (v.windows || [])[0];
  const inner = [
    `<h1>${esc(w.h_booked)}</h1>`,
    '<div class="qbox">',
    x ? `<p class="lead" style="font-weight:600;margin:0 0 .3rem">${esc(lineDay(x.date, lang))}</p>` : '',
    x ? `<p style="margin:0 0 .3rem">${esc(fill(w.booked_window, { window: windowSpan(x, lang) }))}</p>` : '',
    `<p class="qprice" style="margin:0">${esc(money(v.body && v.body.price))}</p>`,
    '</div>',
    `<p class="lead">${esc(w.booked_confirm)}</p>`,
    `<p class="qsmall">${esc(w.questions)}</p>`,
  ].join('\n');
  return page(200, lang, 'booked', inner);
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
    case 'booked': return bookedPage(v);
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
  const m = /^([^/]*)(\/none)?$/.exec(rest);
  const code = m ? m[1] : '';
  const isNone = Boolean(m && m[2]);

  if (method === 'POST') {
    /* FIRST, before the code is looked up: a post from another site writes nothing. */
    if (foreignPost(request, env)) return bothPage(403, 'forbidden', 'h_forbidden', 'forbidden');
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
    return head(method, statePage(env, v, code, nowIso, url.searchParams.get('pick') === '1'));
  }

  const r = notValid(405);
  r.headers.set('Allow', 'GET, HEAD, POST');
  return r;
}

function head(method, res) {
  return method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
