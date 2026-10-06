/* WORKER-SHOWN-01 · WHAT THE CUSTOMER WAS SHOWN.
   ----------------------------------------------------------------------------
   The booking form may carry four optional fields naming the tile the customer
   tapped and the price that tile showed them:

       shown_key    the menu key, e.g. "tv-mount"      (assets/umbra-menu.js)
       shown_label  the tile's words, e.g. "TV mounting"
       shown_price  the TEXT the tile showed, e.g. "from$119" or "desde$79por pieza"
       shown_lang   "en" or "es"

   This is ONE rule and nothing else. It never quotes, never re-prices and never
   parses `shown_price` into a number: the price is the customer's evidence of what
   they were told, kept character for character, and the quote the Worker makes is
   the Worker's own as it has always been.

   A missing or bad `shown` is DROPPED. The caller then writes no `shown` key at
   all, so the answer to that customer — status, Location, body — is exactly the
   answer the same request without these four fields gets. This function never
   throws and never logs: nothing a customer typed is ever printed.           */

const KEY = /^[a-z0-9-]{1,40}$/;
/* 1-32 printable characters: no C0 control, no DEL */
const PRINTABLE = /^[^\u0000-\u001f\u007f]{1,32}$/;
const CONTROL = /[\u0000-\u001f\u007f]/g;

/* a repeated part makes the field an array, so only a real string is ever read */
function one(v) {
  return typeof v === 'string' ? v : null;
}

export function readShown(fields) {
  const f = fields || {};
  const key = one(f.shown_key);
  const price = one(f.shown_price);

  /* the two that must be right, or there is no `shown` */
  if (!key || !KEY.test(key)) return null;
  if (!price || !PRINTABLE.test(price)) return null;
  if (price.indexOf('$') < 0 || !/[0-9]/.test(price)) return null;

  /* the words are optional: control characters and the two angle brackets come out,
     80 characters at most, and nothing left means the key stands in for them */
  let label = one(f.shown_label) || '';
  label = label.replace(CONTROL, '').replace(/[<>]/g, '').slice(0, 80);
  if (label.trim() === '') label = key;

  const lang = one(f.shown_lang) === 'es' ? 'es' : 'en';

  return { key, label, price, lang };
}
