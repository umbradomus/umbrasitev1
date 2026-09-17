/* THE SECOND CHANNEL.
   Two channels on intake, always. The record is ours; the email is the one that
   has never lost a request. This rebuilds the customer's submission field for
   field — same names, same files, same order — and posts it to FormSubmit, so
   the email in Drew's inbox arrives exactly as it does today, plus two lines
   telling him the request also has a record and a status link. */

export const FORMSUBMIT_ENDPOINT = 'https://formsubmit.co/07242513cc0b8b4dac5ae320baa7c431';

export function forwardEndpoint(env) {
  return env.FORMSUBMIT_ENDPOINT || FORMSUBMIT_ENDPOINT;
}

/**
 * @param {Array<[string, string|File]>} entries the submission verbatim, in order
 * @param {{job_id: string, status_link: string}} extra
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
  /* FormSubmit answers a browser post with a 302 to _next. A 2xx or a 3xx is a
     delivery; anything else is not. */
  const ok = res.status < 400;
  return { ok, status: res.status };
}
