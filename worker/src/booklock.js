/* THE BOOK, ASKED BY THE CLOCK — REMINDERS-01, 2026-09-24.

   The alert clock needs exactly two things from the BOOK Durable Object, and nothing else:

     · quoteWentOut — has a quote for this job actually gone out? Asked FRESH just before any holding
       text (AMENDMENT 1 C). The KV record's `quoted_at` is a mirror: it can lag, and it can be edited.
       A customer cannot be un-texted, so the question is put to the one place that knows.
     · markOnce / markSet — a mark only one caller can ever win. KV has no lock (ALERTS-01 FOUND 4);
       inside the Durable Object an insert-if-absent runs in its own turn and cannot be split.

   It lives in its own file because quotes.js already imports alerts.js: putting these there and
   importing them back would make a cycle out of two modules that only need one line of each other. */

function book(env) {
  return env.BOOK.get(env.BOOK.idFromName('book'));
}

/** { sent, versions } — fresh from the Durable Object, never from the KV mirror. */
export async function quoteWentOut(env, jobId) {
  try {
    return await book(env).quoteWentOut(jobId);
  } catch (err) {
    /* The book could not be reached. Answer "sent", so nothing goes out: a holding text missed is a
       phone call he was going to make anyway; a holding text sent to a customer who already has their
       quote cannot be taken back. */
    console.error('quoteWentOut failed for', jobId, String((err && err.message) || err));
    return { sent: true, unreadable: true, versions: [] };
  }
}

/** Insert if absent. `won` is true for the ONE caller that put the row there. */
export async function markOnce(env, key, jobId, state, nowIso, note) {
  return book(env).markOnce(key, jobId, state, nowIso, note);
}

/** How the one call ended. Only the caller that won the mark ever writes it. */
export async function markSet(env, key, state, gatewayId, nowIso, note) {
  return book(env).markSet(key, state, gatewayId, nowIso, note);
}

export async function markGet(env, key) {
  return book(env).markGet(key);
}
