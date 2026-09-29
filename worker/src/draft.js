/* THE WORDS HIS PHONE SENDS FOR HIM — UMBRA-SIDE-01 (lane P), 2026-09-28.

   His words: "just got the alert on the umbra phone... not sure exactly what to do from this process with our system..
   this all needs to be easier on the umbra side too". He promises every customer a reply within two hours, he never
   wants to type on the phone, and he does every job himself.

   Everything a customer can be texted from the job page is written here, from the request itself, in the request's
   language, in plain characters (holding.js's GSM-7 rule, the one FC-TEXT-01 sends by):

     · THE ONE-TAP REPLY — the first text of the thread, so it names him and says how to stop:
         EN "Hi Will, it's Drew with Umbra Domus. I got your photos of the ceiling patch. I'll text you the price by
             4:30 PM today. Reply STOP to stop texts."
         ES "Hola Will, soy Drew de Umbra Domus. Ya vi las fotos del parche del techo. Le mando el precio hoy antes de
             las 4:30 p. m. Si no quiere mensajes, responda STOP."
       "by <time>" = the tap + 2 business hours (7 AM–9 PM Central, carried into the next morning), rounded UP to the
       quarter hour.
     · THE STOP CONFIRMATION — once, when they text STOP:
         EN "You're unsubscribed from Umbra Domus texts. Call (956) 556-6438 if you need us."
     · (the holding text lives in holding.js, beside the rest of the holding text's rules)

   The job's few words ("the ceiling patch", "holes in your ceiling and walls") come from what they tapped on the form:
   today's `problem` + `problem_area`, or the new form's `tiles` when it lands; else the service they picked. Never from
   their own typed words, so nothing they typed (a name, a number, a link) can ride into a text or a push. */

import { bizAdvance, chicagoParts, chicagoDay, clock } from './biztime.js';
import { firstNameOf, langOf, textFault, textParts, gsmFold } from './holding.js';

export const REPLY_WINDOW_MIN = 120;
const QUARTER_MS = 15 * 60000;
/* the business's own number, as the site prints it (index.js tells a customer to text it when the form fails) */
export const BUSINESS_PHONE_DEFAULT = '(956) 556-6438';

const list = (v) => (v == null ? [] : (Array.isArray(v) ? v : String(v).split(/\s*[,;]\s*/)).map((x) => String(x).trim()).filter(Boolean));

/* ------------------------------------------------------------ the promise time */

/** The reply's promise: `nowMs` (to the minute) + 2 business hours, rounded UP to the quarter hour. Chicago's offsets
    are whole hours, so a quarter hour of UTC is a quarter hour of Chicago. */
export function promiseBy(nowMs) {
  const minute = Math.floor(nowMs / 60000) * 60000;
  const t = bizAdvance(minute, REPLY_WINDOW_MIN);
  return Math.ceil(t / QUARTER_MS) * QUARTER_MS;
}

/** "4:30 PM today" · "9:15 AM tomorrow" · "hoy antes de las 4:30 p. m." · "mañana antes de la 1:15 p. m." */
export function byWords(byMs, nowMs, lang) {
  const { h, mi } = chicagoParts(byMs);
  const h12 = ((h + 11) % 12) + 1;
  const mm = String(mi).padStart(2, '0');
  const same = chicagoDay(byMs) === chicagoDay(nowMs);
  if (lang === 'es') return `${same ? 'hoy' : 'mañana'} antes de ${h12 === 1 ? 'la' : 'las'} ${h12}:${mm} ${h < 12 ? 'a. m.' : 'p. m.'}`;
  return `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'} ${same ? 'today' : 'tomorrow'}`;
}

/* ------------------------------------------------------------ the job, in a few words */

const PROBLEM = {
  holes: { en: 'holes', es: 'los hoyos', one: 'hole' },
  cracks: { en: 'cracks', es: 'las grietas' },
  'water stain': { en: 'water stain', es: 'la mancha de agua' },
  'a patch that shows': { en: 'patch', es: 'el parche' },
  'just paint': { en: 'paint job', es: 'la pintura' },
};
/* the new form's tiles (lane A), read loosely: the tile's first words pick the noun */
const TILE = [
  [/^hole|^hoyo/i, 'holes'],
  [/crack|grieta/i, 'cracks'],
  [/water|agua/i, 'water stain'],
  [/patch|parche/i, 'a patch that shows'],
  [/^paint|^pintura/i, 'just paint'],
];
const AREA = {
  ceiling: { adj: 'ceiling', noun: 'ceiling', es: 'techo', esGen: 'del techo', esYour: 'su techo' },
  walls: { adj: 'wall', noun: 'walls', es: 'paredes', esGen: 'de las paredes', esYour: 'sus paredes' },
};

function problemsOf(f) {
  const out = [];
  for (const p of list(f.problem)) { const k = p.toLowerCase(); if (PROBLEM[k] && !out.includes(k)) out.push(k); }
  if (!out.length) for (const t of list(f.tiles)) { const hit = TILE.find(([re]) => re.test(t)); if (hit && !out.includes(hit[1])) out.push(hit[1]); }
  return out.slice(0, 2);
}
function areasOf(f) {
  const out = [];
  for (const a of list(f.problem_area).concat(list(f.surface), list(f.where))) {
    const k = /ceil|techo/i.test(a) ? 'ceiling' : /wall|pared/i.test(a) ? 'walls' : /both|los dos/i.test(a) ? 'both' : null;
    if (k === 'both') { for (const x of ['ceiling', 'walls']) if (!out.includes(x)) out.push(x); }
    else if (k && !out.includes(k)) out.push(k);
  }
  return out.sort((x, y) => (x === 'ceiling' ? -1 : y === 'ceiling' ? 1 : 0));
}
function serviceOf(f) {
  const s = String(Array.isArray(f.service) ? f.service[0] : (f.service || '')).replace(/\s+/g, ' ').trim();
  return s && !/^not sure$/i.test(s) ? s : '';
}

/**
 * The job in a few words, both ways the words are used:
 *   thing  "the ceiling patch" · "the holes in your ceiling and walls" · "el parche del techo"
 *   area   "your ceiling" · "your ceiling and walls" · "su techo y sus paredes"   (null when the form did not say where)
 *   short  "Ceiling patch" · "Holes · ceiling and walls" — the page's and the board's line under the name
 */
export function jobWords(rec, lang = 'en') {
  const f = rec.fields || {};
  const probs = problemsOf(f);
  const areas = areasOf(f);
  const svc = serviceOf(f);
  const es = lang === 'es';
  let thing, short;
  if (probs.length) {
    const nouns = probs.map((k) => (es ? PROBLEM[k].es : PROBLEM[k].en));
    if (es) {
      const gen = areas.length === 2 ? 'del techo y las paredes' : areas.length === 1 ? AREA[areas[0]].esGen : '';
      thing = nouns.join(' y ') + (gen ? ' ' + gen : '');
    } else if (areas.length === 1 && probs.length === 1) {
      thing = `the ${AREA[areas[0]].adj} ${nouns[0]}`;
    } else if (areas.length) {
      thing = `the ${nouns.join(' and ')} in your ${areas.map((a) => AREA[a].noun).join(' and ')}`;
    } else {
      thing = `the ${nouns.join(' and ')}`;
    }
    const enNouns = probs.map((k) => PROBLEM[k].en);
    short = areas.length === 1 && probs.length === 1
      ? `${AREA[areas[0]].adj.charAt(0).toUpperCase() + AREA[areas[0]].adj.slice(1)} ${enNouns[0]}`
      : `${enNouns.join(' and ').replace(/^./, (c) => c.toUpperCase())}${areas.length ? ' · ' + areas.map((a) => AREA[a].noun).join(' and ') : ''}`;
  } else if (svc) {
    thing = es ? 'su solicitud' : `the ${svc.toLowerCase()} job`;
    short = svc;
  } else {
    thing = es ? 'su solicitud' : 'your request';
    short = 'New request';
  }
  let area = null;
  if (areas.length) area = es ? areas.map((a) => AREA[a].esYour).join(' y ') : 'your ' + areas.map((a) => AREA[a].noun).join(' and ');
  return { thing, area, short, service: svc || null };
}

/* ------------------------------------------------------------ the reply */

/** "Hi Will, …" or, for his own phone's push, "Hi [name], …" (a push never carries a customer's name — CONTRACTS C4). */
export function replyText(rec, byMs, nowMs, { forPush = false } = {}) {
  const lang = langOf(rec);
  const name = forPush ? '[name]' : firstNameOf(rec);
  const w = jobWords(rec, lang);
  const photos = (rec.photos || []).filter((p) => !p.store_failed).length > 0;
  const vague = w.thing === 'your request' || w.thing === 'su solicitud';
  let text;
  if (lang === 'es') {
    const de = /^el /.test(w.thing) ? 'del ' + w.thing.slice(3) : 'de ' + w.thing;
    const got = vague ? (photos ? 'Ya vi sus fotos.' : 'Recibi su solicitud.') : (photos ? `Ya vi las fotos ${de}.` : `Recibi su solicitud sobre ${w.thing}.`);
    text = `Hola${name ? ' ' + name : ''}, soy Drew de Umbra Domus. ${got} ` +
      `Le mando el precio ${byWords(byMs, nowMs, 'es')}. Si no quiere mensajes, responda STOP.`;
  } else {
    const got = vague ? (photos ? 'I got your photos.' : 'I got your request.') : (photos ? `I got your photos of ${w.thing}.` : `I got your request about ${w.thing}.`);
    text = `Hi${name ? ' ' + name : ''}, it's Drew with Umbra Domus. ${got} ` +
      `I'll text you the price by ${byWords(byMs, nowMs, 'en')}. Reply STOP to stop texts.`;
  }
  /* "a. m." already ends the sentence; the template's own full stop would double it (holding.js does the same) */
  text = gsmFold(text).replace(/\.\.(?!\.)/g, '.');
  const fault = textFault(text);
  if (fault && !forPush) return { error: fault.error, lang };
  return { text, lang, parts: textParts(text), by: new Date(byMs).toISOString() };
}

/** The button's own words: "Text Will: price by 4:30 PM" · "Text Will: price by 9:15 AM tomorrow". */
export function replyLabel(rec, byMs, nowMs) {
  const name = firstNameOf(rec) || 'them';
  const { h, mi } = chicagoParts(byMs);
  const t = `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return `Text ${name}: price by ${t}${chicagoDay(byMs) === chicagoDay(nowMs) ? '' : ' tomorrow'}`;
}

/* ------------------------------------------------------------ the STOP confirmation */

export function stopConfirmText(env, lang) {
  const phone = String((env && env.BUSINESS_PHONE) || BUSINESS_PHONE_DEFAULT).trim();
  const text = lang === 'es'
    ? `Ya no le enviaremos mensajes de Umbra Domus. Si nos necesita, llame al ${phone}.`
    : `You're unsubscribed from Umbra Domus texts. Call ${phone} if you need us.`;
  return gsmFold(text);
}

/* ------------------------------------------------------------ what the request says about the reply */

/** How they want the reply: 'call' when they picked Call (the new form's reach_by, or reply_how), else 'text'. */
export function reachOf(rec) {
  const f = rec.fields || {};
  const v = list(f.reply_how).concat(list(f.reach_by)).join(' ').toLowerCase();
  if (/\bcall\b|llamada|llamar/.test(v)) return 'call';
  if (/whatsapp/.test(v)) return 'whatsapp';
  return 'text';
}

/** "Still wet or soft" (the new form's flag), or any answer saying the spot is wet now: the cause is fixed first, and
    no automatic text ever goes to a wet request — he calls. */
export function isWetNow(rec) {
  const f = rec.fields || {};
  for (const [k, v] of Object.entries(f)) {
    if (!/^(flags?|wet|wet_now|.*_flags?|.*condition|extras?)$/i.test(k)) continue;
    const s = list(v).join(' ');
    if (/\b(still wet|wet now|wet or soft|is wet|mojad[oa])\b/i.test(s)) return true;
    if (/^(wet|wet_now)$/i.test(k) && /^(yes|true|1|s[ií])$/i.test(s.trim())) return true;
  }
  return false;
}

/** The house's age as the request (or their quote page) says it: 'before' (1977 and earlier), 'unsure', 'after' or null. */
export function builtOf(rec) {
  const f = rec.fields || {};
  const y = Number(rec.year_built);
  if (Number.isInteger(y) && y > 1600) return y < 1978 ? 'before' : 'after';
  const s = list(f.built).concat(list(f.year_built)).join(' ').trim();
  if (!s) return null;
  if (/before 1978|antes de 1978|pre-?1978/i.test(s)) return 'before';
  if (/not sure|no s[eé]|unsure|don'?t know/i.test(s)) return 'unsure';
  const m = /\b(1[6-9]\d\d|20\d\d)\b/.exec(s);
  if (m) return Number(m[1]) < 1978 ? 'before' : 'after';
  if (/1978 or later|de 1978 en adelante|after 1978/i.test(s)) return 'after';
  return null;
}

/** A paint or hole job: the drywall & paint service, a hole/crack/stain/patch/paint answer, or a hole or paint tile. */
export function isPaintOrHoleJob(rec) {
  const f = rec.fields || {};
  if (problemsOf(f).length) return true;
  const s = [serviceOf(f)].concat(list(f.tiles)).join(' ');
  return /drywall|paint|pintura|hole|hoyo|crack|grieta|patch|parche/i.test(s);
}

/** The lead line, when it applies: built before 1978 or "not sure", on a paint or hole job. */
export function leadApplies(rec) {
  const b = builtOf(rec);
  return (b === 'before' || b === 'unsure') && isPaintOrHoleJob(rec);
}

/** "Text · English · 3 photos · Rented" — the facts that change the reply, for the arrival push's second line. */
export function factsLine(rec) {
  const f = rec.fields || {};
  const bits = [];
  const consent = rec.consent ? rec.consent.smsService === true : null;
  const reach = reachOf(rec);
  bits.push(reach === 'call' ? 'Call' : reach === 'whatsapp' ? 'WhatsApp' : consent === false ? 'No texts: call' : 'Text');
  bits.push(langOf(rec) === 'es' ? 'Español' : 'English');
  const soon = list(f.how_soon)[0];
  if (soon) bits.push(soon);
  const n = (rec.photos || []).filter((p) => !p.store_failed).length;
  bits.push(n === 1 ? '1 photo' : `${n} photos`);
  if (/rent/i.test(list(f.occupancy).join(' '))) bits.push('Rented');
  if (isWetNow(rec)) bits.push('Still wet');
  return bits.join(' · ');
}

export { clock };
