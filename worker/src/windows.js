/* FORM-WINDOWS-01 · THE TIMES THE CUSTOMER OFFERS, AND THEIR YES TO TEXTS.

   The request form (services and es/servicios) gains one screen, "When could we come?": up to three
   date + block picks from the next 14 days, or "I'm flexible". The phone screen gains one unchecked box
   agreeing to texts about the request. The browser posts:

       avail_form           "v1" — present only on a page that has the screen. Absent → availability null,
                            no consent block, the request exactly as today (contact, homes, es/index).
       avail_choice         repeated, in the order picked: "YYYY-MM-DD HH-HH"
       avail_flexible       "yes" when ticked
       avail_notes          free text (gate code, pets, best way in)
       sms_consent          "yes" when ticked
       sms_consent_lang     "en" | "es" — which wording the page showed
       sms_consent_version  "sms-v2" — which version of that wording the page showed (absent on an sms-v1 page)
       time_1..3 · times_flexible · text_consent   the same answers in plain words, for the email copy only

   THE RULE THAT BEATS EVERY OTHER: a bad availability NEVER loses the request. It is stored with
   availability.invalid = the reason, and everything else on the record stands.

   Every calendar question is asked of Chicago's own clock (biztime.js), never of UTC: at 11:30 PM on the
   23rd, UTC already says the 24th and Brownsville does not. */

import { chicagoParts, chicagoWall, chicagoDay } from './biztime.js';
import { sha256hex } from './util.js';

export const BLOCKS = {
  '08-11': { start: 8, label: 'Morning 8–11' },
  '11-14': { start: 11, label: 'Midday 11–2' },
  '14-17': { start: 14, label: 'Afternoon 2–5' },
  '17-20': { start: 17, label: 'Evening 5–8' },
};
export const MAX_CHOICES = 3;
export const HORIZON_DAYS = 14;
export const SAME_DAY_LEAD_H = 3;
const NOTES_MAX = 1000;

/* THE WORDING, EXACTLY AS THE PAGES SHOW IT (the label's text with its whitespace collapsed). The hash on
   the record is the hash of the one the customer saw. Every wording a page has ever shown is kept here, and
   the page declares which one it showed (sms_consent_version), so a form left open across a deploy is
   recorded under its own words. A change to either string is a new version: add it here, move SMS_VERSION,
   and move the pages' sms_consent_version with it. The suite reads each page's label and proves its hash
   equals the one stored. sms-v1 is the wording as FORM-WINDOWS-01 shipped it, byte for byte; sms-v2 adds
   ALTO and AYUDA to the Spanish (SPANISH-FIX-01), and its English is sms-v1's. */
export const SMS_WORDINGS = {
  'sms-v1': {
    en: 'Text me about this request. I agree Umbra Domus may text the number above about my request, quote, scheduling and appointment reminders, including automated messages. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not required to get service.',
    es: 'Envíenme mensajes de texto sobre esta solicitud. Acepto que Umbra Domus me envíe mensajes de texto al número de arriba sobre mi solicitud, cotización, programación y recordatorios de cita, incluidos mensajes automatizados. La frecuencia de los mensajes varía. Pueden aplicarse tarifas de mensajes y datos. Responda STOP para cancelar, HELP para obtener ayuda. El consentimiento no es requisito para recibir el servicio.',
  },
  'sms-v2': {
    en: 'Text me about this request. I agree Umbra Domus may text the number above about my request, quote, scheduling and appointment reminders, including automated messages. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not required to get service.',
    es: 'Envíenme mensajes de texto sobre esta solicitud. Acepto que Umbra Domus me envíe mensajes de texto al número de arriba sobre mi solicitud, cotización, programación y recordatorios de cita, incluidos mensajes automatizados. La frecuencia de los mensajes varía. Pueden aplicarse tarifas de mensajes y datos. Responda STOP o ALTO para cancelar, HELP o AYUDA para obtener ayuda. El consentimiento no es requisito para recibir el servicio.',
  },
};
/* The versions a post may name, as a plain list: never a lookup on the object itself, where "constructor",
   "__proto__" or "toString" would find the prototype's. */
const SMS_VERSIONS = ['sms-v1', 'sms-v2'];
export const SMS_VERSION = 'sms-v2';
export const SMS_WORDING = SMS_WORDINGS[SMS_VERSION];

/** Which wording the page showed: absent or blank → 'sms-v1' (the only pages without the field are v1
    pages); exactly one known version, trimmed → that one; anything else (unknown, posted twice) → null. */
function consentVersion(fields) {
  const v = fields.sms_consent_version;
  if (v === undefined || v === null) return 'sms-v1';
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === '') return 'sms-v1';
  return SMS_VERSIONS.includes(t) ? t : null;
}

const CHOICE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}-\d{2})$/;

function list(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** Whole days from Chicago-day a to Chicago-day b ("YYYY-MM-DD" both). */
function dayGap(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

function blockedSet(env) {
  return new Set(String((env && env.BLOCKED_DATES) || '').split(/[\s,]+/).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)));
}

export function allowSunday(env) {
  return String((env && env.ALLOW_SUNDAY) || '') === 'true';
}

/** What the page may offer, for GET /api/windows. The page's own default (no Sundays, nothing blocked)
    stands when this cannot be reached. */
export function windowsConfig(env, nowIso) {
  return {
    today: chicagoDay(Date.parse(nowIso)),
    tz: 'America/Chicago',
    horizon_days: HORIZON_DAYS,
    allow_sunday: allowSunday(env),
    blocked_dates: [...blockedSet(env)].sort(),
    blocks: Object.keys(BLOCKS),
  };
}

/**
 * The availability block for the record, from the posted fields.
 * Returns null when the page had no time screen (B4). Otherwise always an object; a refusal is
 * { invalid: '<code>: <words>', raw: [what was posted] } beside the flexible flag and the notes, and
 * choices is then [] so nothing downstream books a time the rules refused.
 */
export function readAvailability(fields, env, nowIso) {
  if (!fields || typeof fields.avail_form !== 'string' || fields.avail_form.trim() === '') return null;
  const flexible = String(fields.avail_flexible || '').trim().toLowerCase() === 'yes';
  const notesRaw = list(fields.avail_notes).join('\n').trim();
  const notes = notesRaw.slice(0, NOTES_MAX);
  const raw = list(fields.avail_choice).map((s) => s.trim()).filter((s) => s !== '');
  const out = { flexible, choices: [], notes };

  const refuse = (code, words) => ({ ...out, invalid: code + ': ' + words, raw });

  if (raw.length > MAX_CHOICES) return refuse('too_many_choices', `${raw.length} choices; at most ${MAX_CHOICES}`);
  if (raw.length === 0 && !flexible) return refuse('no_choice', 'no time picked and not marked flexible');

  const nowMs = Date.parse(nowIso);
  const today = chicagoDay(nowMs);
  const blocked = blockedSet(env);
  const sundayOk = allowSunday(env);
  const seen = new Set();
  const choices = [];
  for (const s of raw) {
    const m = CHOICE.exec(s);
    if (!m) return refuse('unreadable', JSON.stringify(s.slice(0, 60)) + ' is not "YYYY-MM-DD HH-HH"');
    const y = +m[1], mo = +m[2], d = +m[3], block = m[4];
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (mo < 1 || mo > 12 || probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
      return refuse('not_a_date', `${date} is not a calendar date`);
    }
    if (!BLOCKS[block]) return refuse('unknown_block', `${block} is not one of ${Object.keys(BLOCKS).join(', ')}`);
    const key = date + ' ' + block;
    if (seen.has(key)) return refuse('repeated_choice', `${key} picked twice`);
    seen.add(key);
    const gap = dayGap(today, date);
    if (gap < 0) return refuse('in_the_past', `${date} is before today (${today}, Central)`);
    if (gap === 0) {
      const startMs = chicagoWall(y, mo, d, BLOCKS[block].start);
      if (startMs - nowMs < SAME_DAY_LEAD_H * 3600000) {
        return refuse('too_soon', `${key} starts less than ${SAME_DAY_LEAD_H} hours from now (${chicagoParts(nowMs).h}:${String(chicagoParts(nowMs).mi).padStart(2, '0')} Central)`);
      }
    }
    if (gap > HORIZON_DAYS) return refuse('too_far', `${date} is ${gap} days out; at most ${HORIZON_DAYS}`);
    if (!sundayOk && probe.getUTCDay() === 0) return refuse('sunday', `${date} is a Sunday`);
    if (blocked.has(date)) return refuse('blocked_date', `${date} is blocked`);
    choices.push({ date, block });
  }
  return { ...out, choices };
}

/** The consent block, or null when the page had no time screen (B4). `at` is the server's moment, so it
    never makes two identical posts look different (the de-duplication reads the posted fields only). */
export async function readConsent(fields, request, nowIso) {
  if (!fields || typeof fields.avail_form !== 'string' || fields.avail_form.trim() === '') return null;
  const lang = String(fields.sms_consent_lang || '').trim().toLowerCase() === 'es' ? 'es' : 'en';
  const version = consentVersion(fields);
  return {
    /* a version we cannot name is words we cannot show them: the yes does not count */
    smsService: version !== null && String(fields.sms_consent || '').trim().toLowerCase() === 'yes',
    textVersion: version === null ? 'unknown' : version,
    lang,
    at: nowIso,
    /* what the Worker received; on the live edge this is the customer's address. Never invented. */
    ip: request.headers.get('cf-connecting-ip') || null,
    ua: (request.headers.get('user-agent') || '').slice(0, 200),
    wordingSha256: version === null ? null : await sha256hex(new TextEncoder().encode(SMS_WORDINGS[version][lang])),
  };
}
