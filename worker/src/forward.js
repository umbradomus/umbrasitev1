/* THE SECOND CHANNEL.
   Two channels on intake, always. The record is ours; the email is the one that
   has never lost a request. This rebuilds the customer's submission field for
   field — same names, same files, same order — and posts it to FormSubmit, so
   the email in Drew's inbox arrives exactly as it does today, plus two lines
   telling him the request also has a record and a status link. */

export const FORMSUBMIT_ENDPOINT = 'https://formsubmit.co/07242513cc0b8b4dac5ae320baa7c431';

/* How much of FormSubmit's answer is kept on the record when it is not a
   delivery. The whole page is ~10 KB of markup whose first 500 raw bytes are
   whitespace and <meta> (measured 00:38Z 2026-09-20), so what is kept is the
   first RESPONSE_KEEP characters of the page's VISIBLE TEXT, tags stripped —
   the sentence a person would read on it. */
export const RESPONSE_KEEP = 500;
const RESPONSE_READ_MAX = 65536;

/* FLUX-SEND-TRUTH-01 · the ceiling on this leg, in one place. The reasoning for the
   number is at the fetch it guards. */
export const FORWARD_TIMEOUT_MS = 8000;

export function forwardEndpoint(env) {
  return env.FORMSUBMIT_ENDPOINT || FORMSUBMIT_ENDPOINT;
}

/** The visible text of an HTML answer: scripts and styles dropped, tags
    stripped, whitespace collapsed, cut to RESPONSE_KEEP. Plain text passes
    through the same cut. */
export function visibleText(raw, keep = RESPONSE_KEEP) {
  const s = String(raw || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > keep ? s.slice(0, keep) : s;
}

/** Read at most RESPONSE_READ_MAX bytes of a response body, never throwing:
    the record must be written whatever FormSubmit did with the connection. */
async function readHead(res) {
  try {
    const buf = new Uint8Array(await res.arrayBuffer());
    return new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, RESPONSE_READ_MAX));
  } catch (err) {
    return '(body unreadable: ' + String(err && err.message || err) + ')';
  }
}

/* FormSubmit's OWN failure pages come back 200. Measured from this machine
   00:38Z 2026-09-20: a POST with no Referer answers `200` and a page headed
   "Unable to submit form". Before EMAIL-01 `status < 400` counted that as a
   delivery. A 2xx whose page says one of these is NOT an email. */
const NOT_A_DELIVERY = /unable to submit|activat(e|ion)|confirm your email|too many requests|rate limit/i;

/**
 * @param {Array<[string, string|File]>} entries the submission verbatim, in order
 * @param {{job_id: string, status_link: string}} [extra] the two named lines the REQUEST copy adds.
 *   OMITTED by SITE-FIX-03's booking confirmation on purpose: that email carries no job number and no
 *   status link, because a status link carries the quote code and the code is the secret.
 * @returns {Promise<{ok: boolean, status: number, location?: string, response?: {status:number, type:string, text:string}}>}
 */
export async function forwardToFormSubmit(env, entries, extra) {
  const fd = new FormData();
  for (const [name, value] of entries) {
    if (value && typeof value === 'object' && 'arrayBuffer' in value) {
      fd.append(name, value, value.name || 'photo');
    } else {
      fd.append(name, String(value));
    }
  }
  /* The two extra lines. Named so they read plainly in the table template. A caller with nothing to add
     (the booking confirmation) passes no `extra` and posts the entries alone. */
  /* by presence, not by truth: a caller that hands these lines hands them whole, and an empty string is
     a caller's defect to see in the copy, not a line this road silently drops. */
  if (extra && 'job_id' in extra) fd.append('job_id', extra.job_id);
  if (extra && 'status_link' in extra) fd.append('status_link', extra.status_link);

  /* FLUX-SEND-TRUTH-01 · A CEILING ON THE ONE LEG THAT IS ON THE CUSTOMER'S CLOCK.
     This await sits between the customer's press and their answer, and until this
     round it had no timeout of any kind — the only AbortController in worker/src was
     holding.js's. On 2026-10-13 his send "took a while" and then lied about failing,
     and this is the leg with no ceiling on it.
     WHAT IT COSTS AND WHY 8 S: the same round trip, measured on real records in
     assets/umbra-two-channels.js, spent 1098 / 1366 / 1413 / 1637 ms through
     2026-10-01, then 5705 (U-0019), 8071 (U-0018) and 15004 ms (U-0020). 8 s is above
     every copy before 10-07 and is EMAIL-01's own measured reading of what is longer
     than a person waits. The browser leg takes 30 s because it is the leg that
     DELIVERS; this one is the fallback, and from a Worker it has been refused 429 on
     every send ever made (U-0003 onward), so what a longer wait here buys is a 429
     that arrives later.
     WHAT A TIMEOUT DOES NOT DO: it does not lose anything. The caller already treats a
     throw as a non-delivery and writes it to the record with its reason, so a cut leg
     lands on the record as `email_lost` with the word `timeout` in it — the same place
     and the same shape a 429 lands in, and readable afterwards. */
  const ctl = new AbortController();
  const bell = setTimeout(() => ctl.abort(), FORWARD_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(forwardEndpoint(env), {
      method: 'POST',
      body: fd,
      redirect: 'manual',
      signal: ctl.signal,
    });
  } catch (err) {
    if (ctl.signal.aborted) return { ok: false, status: 0, error: 'timeout after ' + FORWARD_TIMEOUT_MS + ' ms' };
    throw err;
  } finally {
    clearTimeout(bell);
  }
  /* FormSubmit answers a browser post with a 302 to _next. A 3xx is a delivery.
     A 2xx is a delivery only if the page is not one of FormSubmit's own
     refusals; anything 4xx/5xx is not. Whatever it was, when it is NOT a
     delivery the first RESPONSE_KEEP characters of what the page SAYS go back
     with it, so the record can name the failure instead of just its number
     (EMAIL-01: the thing that decides must be measurable). */
  const status = res.status;
  const location = res.headers.get('location') || '';
  const type = res.headers.get('content-type') || '';
  if (status >= 300 && status < 400) {
    return { ok: true, status, location };
  }
  const text = visibleText(await readHead(res));
  const ok = status < 300 && !NOT_A_DELIVERY.test(text);
  const out = { ok, status };
  if (!ok) out.response = { status, type, text };
  return out;
}
