/* SITE-FIX-03 · THE CONFIRMATION EMAIL'S WORDS, 2026-10-04.
   On 10-01 Jose booked on the quote page and got nothing back: the page did not say he was booked and no
   email went. The booked screen is item 1 of this round; this file is item 2's half — what the customer
   reads in their inbox when they gave an email on the request form.

   ONE email, on the booking, through the road the request copy already uses (FormSubmit's `_autoresponse`,
   the same road `assets/umbra-sent.js` sends the request copy on). It carries the day, the window, the
   price, the promise of the text the day before, and the Umbra line the request copy ends with.

   THIS FILE SENDS NO TEXT. The day-before text is the FLUX's (FLUX-FIX-16, on the Job Sync tick); the one
   booking confirmation TEXT is confirm.js's (CONFIRM-01, from finishBooking) — this file only writes the
   email, and the promise of the day-before text.

   Kept out of page-words.js on purpose: that file's own rule is "No phone number, address or email of
   anyone" and Suite I greps every rendered page for its whole table. The phone number belongs in an email,
   not on the page, so the email's words live here.

   The caller hands the day, the window and the price ALREADY WRITTEN, in the customer's language, by
   page.js's own lineDay/spanOf/money — so the inbox and the screen spell the same visit the same way and
   there is one spelling of "Tue, Nov 10" on this site. A fact the booking does not carry is DROPPED, never
   left as a blank line or a dash, exactly as bookedSummary drops it on the screen. */

import { BUSINESS_PHONE_DEFAULT } from './draft.js';

const W = {
  en: {
    subject: "You're booked",
    lede: "You're booked. Umbra Domus has your visit.",
    arrive: 'Arriving {span}',
    promise: "I'll text you the day before.",
    /* the Umbra line the request copy carries, word for word (assets/umbra-sent.js copyText) */
    umbra: 'Questions? Text or call {phone}.',
  },
  es: {
    subject: 'Su visita quedó programada',
    lede: 'Su visita quedó programada con Umbra Domus.',
    arrive: 'Llegada entre {span}',
    promise: 'Le enviaremos un mensaje de texto el día anterior.',
    umbra: '¿Preguntas? Mande un mensaje de texto o llame al {phone}.',
  },
};

/**
 * The subject and the body of the booking confirmation, in the customer's language.
 * Never the job number (not in the subject, not in the body), never the quote code, never a secret.
 *
 * @param {{day?: string, span?: string, price?: string, lang?: string, phone?: string}} v
 *   `day`, `span` and `price` are already written in the customer's language, or absent.
 * @returns {{subject: string, body: string}}
 */
export function confirmationEmail(v) {
  const lang = v && v.lang === 'es' ? 'es' : 'en';
  const w = W[lang];
  const phone = String((v && v.phone) || BUSINESS_PHONE_DEFAULT).trim();
  const day = v && v.day ? String(v.day) : '';
  const span = v && v.span ? String(v.span) : '';
  const price = v && v.price ? String(v.price) : '';

  const L = [w.lede, ''];
  if (day) L.push(day);
  if (span) L.push(w.arrive.replace('{span}', span));
  if (price) L.push(price);
  L.push('', w.promise, '', w.umbra.replace('{phone}', phone));

  return { subject: day ? `${w.subject} — ${day}` : w.subject, body: L.join('\n') };
}
