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
 * @param {{job_id: string, status_link: string}} extra
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
  /* The two extra lines. Named so they read plainly in the table template. */
  fd.append('job_id', extra.job_id);
  fd.append('status_link', extra.status_link);

  const res = await fetch(forwardEndpoint(env), {
    method: 'POST',
    body: fd,
    redirect: 'manual',
  });
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
