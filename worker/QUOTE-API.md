# QUOTE API — the quote link's admin routes (ACCEPT-PAGE-01, 2026-09-23)

**For the Flux lane's coder (FC-WORKER-TAPS / FC-1.4b).** These are the calls the Flux Capacitor makes to put a quote behind a link, say it was sent, book a texted YES, and withdraw it. The customer's page (`/q/<code>`) is ACCEPT-PAGE-02 and is not described here, except for the three functions it calls (the last section).

Everything here is in `src/quotes.js` (the Worker side) and `src/quotebook.js` (the book: a Durable Object with SQLite storage, binding `BOOK`, one instance named `"book"`). **The book is the single source of truth for quotes and bookings.** The KV job record, which the collector reads through `/api/jobs`, is its mirror. Every write re-stamps the mirror, and the 5-minute scheduled run heals any stamp that failed.

---

## The rules every route shares

- **Base:** the Worker, e.g. `https://umbra-intake.umbradomus.workers.dev`.
- **The admin key** goes in `?k=`, like every admin route. A missing or wrong key answers **`401 {"error":"unauthorized"}`**, exactly like `POST /admin/seen/<id>`.
- **Bodies are JSON**, sent with `content-type: application/json`. A body that is not a JSON object answers `400 {"error":"bad_body","reason":"send a JSON object"}`.
- **`<U-id>`** is the job id, `U-` followed by 4 to 6 digits. An unknown job answers `404 {"error":"not_found"}`.
- **Times** are ISO instants in UTC (`2026-09-23T15:00:00.000Z`). A window is written as Central wall-clock parts: `{"date":"2026-09-29","start":"08:00","end":"10:00"}`. The Worker turns those into instants with Chicago's own clock, never a fixed offset.
- **The code is never stored and never comes back.** Only the create route returns it, **once**. Keep the `url` from that answer; nothing can produce it again. If it is lost, create a new version.

---

## 1 · `POST /admin/quote/<U-id>` — a new version of the quote

**Body**

| field | required | what it is |
|---|---|---|
| `version` | yes | A whole number, greater than every version this job has had. |
| `price` | yes | **One** positive number, in dollars (`395`, `412.50`). Never a string, never a list. |
| `price_note` | no | One plain line: the researched arithmetic clause, e.g. `"5 hours at $45"`. It may carry a dollar figure. |
| `scope` | yes | A list of 1 to 20 plain lines: what we'll do. |
| `included` | no | One plain line, e.g. `"Paint for the color match is included. Cleanup included."` |
| `guarantee` | no | One plain line. |
| `insurance` | no | One plain line: their protection, with its limit, e.g. `"Insured: $1M general liability. Certificate on request."` It may carry a dollar figure. |
| `windows` | yes | 1 or 2 × `{date "YYYY-MM-DD", start "HH:MM", end "HH:MM"}`, Central. |
| `lang` | no | `"en"` (default) or `"es"`: the page's language. |
| `sent_at` | no | An ISO time, if the text has already gone. The same as calling `/sent` straight after. |

**Refused with `422 {"error":"invalid","reason":"…"}`**, one reason at a time:
- `price` is not one positive number.
- A dollar amount in any `scope`, `included` or `guarantee` line. R38: one price, and materials are never itemised. Only `price_note` and `insurance` may carry a figure.
- `licensed`, `bonded`, `licencia`, `licenciado`, `fianza` or `afianzado` anywhere, as a whole word, any case (R33). `confianza` passes.
- A window that is not 60 or 120 minutes long (R37).
- A window starting before 7:00 or ending after 21:00 Central (R32).
- A Sunday, unless the Worker's `ALLOW_SUNDAY` is `"true"`.
- A date that is not real (`2027-02-30`, `next tuesday`).
- More than 2 windows, or two windows that overlap.
- Any HTML in any line: a tag or an entity such as `&amp;`. Send plain text; escaping is the page's job.
- An empty line, a line with a line break, or a line over 400 characters.
- `lang` other than `en` or `es`.
- **`"too soon to hold"`** when even the short-notice cutoff (§5) has already passed.

**Other answers**
- `404 {"error":"not_found"}`: unknown job.
- `409 {"error":"version_not_newer","newest":N}`: the version is not greater than every earlier one.
- `409 {"error":"accepted"}`: this job already has an ACCEPTED quote. A change after booking is a change order, and this round does not build that.

**On success, `201`:**
```json
{ "code": "k3Xw9QpL2mZr7TbVn4HsYa",
  "url": "https://umbradomus.com/q/k3Xw9QpL2mZr7TbVn4HsYa",
  "version": 1,
  "hold_until": "2026-09-25T15:00:00.000Z",
  "cutoff": "2026-09-28T02:00:00.000Z",
  "short_notice": false }
```
`url` is `QUOTE_LINK_BASE + "/q/" + code`, where `QUOTE_LINK_BASE` is set in `wrangler.toml` to `https://umbradomus.com`. **A newer version supersedes every older open one.** The old link then shows "updating" until the new version is marked sent, and "replaced" after that.

**Worked example.** Job U-0012 gets its quote at 10:00 AM Wed 9/23, and the text goes at the same minute:
```
POST /admin/quote/U-0012?k=…
{"version":1,"price":395,"price_note":"about 8 hours at $45",
 "scope":["Patch the two ceiling holes and re-texture to match","Prime every patch and spot-paint it, feathered"],
 "included":"Paint for the color match is included. Cleanup included.",
 "guarantee":"If anything is not right, I come back and fix it. You don't pay twice.",
 "insurance":"Insured: $1M general liability. If anything in your home is damaged while I work, it's on my policy, not yours.",
 "windows":[{"date":"2026-09-29","start":"08:00","end":"10:00"},{"date":"2026-09-30","start":"13:00","end":"15:00"}],
 "lang":"en","sent_at":"2026-09-23T15:00:00.000Z"}
→ 201 {"code":"…22 chars…","url":"https://umbradomus.com/q/…","version":1,
       "hold_until":"2026-09-25T15:00:00.000Z","cutoff":"2026-09-28T02:00:00.000Z","short_notice":false}
```
The cutoff is 9:00 PM Central on Sun 9/27, two days before the earliest window. The hold ends at 10:00 AM Fri 9/25, 48 hours after sending, which is earlier.

---

## 2 · `POST /admin/quote/<U-id>/sent` — "I sent it"

His *I sent it* tap in the Flux Capacitor. **Body:** `{"version": 1, "sent_at": "<ISO>"}`. `sent_at` is optional and defaults to now.

What it does:
1. Sets `sent_at` on that version and **recomputes the hold** from it: `hold_until` = the earlier of `sent_at + 48 h` and the cutoff.
2. **If the record's `quoted_at` is null**, it runs the admin page's QUOTED path with `at = sent_at` and `quote_amount = price`. That sets `quoted_at`, `minutes_to_quote` (raw clock minutes), status `quoted` (only from `received`), and a `quoted` event with `{quote_amount, minutes_to_quote}`. It then calls ALERTS-01's `acknowledge` with `ack_by: "quote:sent"`, so the ladder stops. **The Flux Capacitor needs this one call. It does not also need the Quoted tap.**
3. **If `quoted_at` is already set**, it only sets `quote_amount` and adds a `quote_sent` event `{version, price}`. It never overwrites the first quote's time (R26) and never moves status back from `scheduled` or `done`.

**Answers**
- `200 {"ok":true,"version":1,"sent_at":…,"hold_until":…,"cutoff":…,"record":{"status","quoted_at","minutes_to_quote","quote_amount"}}`
- `404`: no such job or version.
- `409 {"error":"not_current","newest":N}`: a newer version exists, so mark that one sent instead.
- `409 {"error":"withdrawn"}`: the version was cancelled.
- `422`: a bad `version` or `sent_at`.

**Worked example.**
```
POST /admin/quote/U-0014/sent?k=…   {"version":1,"sent_at":"2026-09-23T19:40:00.000Z"}
→ 200 {"ok":true,"version":1,"sent_at":"2026-09-23T19:40:00.000Z","hold_until":"2026-09-25T19:40:00.000Z",
       "cutoff":"2026-10-05T02:00:00.000Z","record":{"status":"quoted","quoted_at":"2026-09-23T19:40:00.000Z","minutes_to_quote":70,"quote_amount":395}}
```

---

## 3 · `POST /admin/quote/<U-id>/accept` — a texted YES he marks

**Body:** `{"version": 1, "window": 1}`. `window` is 1 or 2, and may be left out when the quote offers one window.

This is **the same booking step the page uses**, with `accepted_by: "text"`. The time rules apply: the window must be one of those offered, and no booking on that date may overlap it, for any job. **The hold and the cutoff do not apply**, because a YES by text is his call. No push is sent, because he marked it himself.

**Answers**
- `200 {"state":"booked","job_id","version","window":{"n","date","start","end"},"price","accepted_by":"text","accepted_at"}`
- `200 {"state":"already_booked",…}`: this version is already booked. Nothing is written.
- `404`: no such job or version.
- `409 {"error":<state>,"reason":…}`, where `<state>` is one of:
  - `taken`: *that time overlaps a booking another job already holds*
  - `updating` / `replaced`: a newer version exists (not sent / sent)
  - `withdrawn`
  - `choose_window`: two windows and no `window`
  - `no_such_window`

After a booking the record is stamped (§6), and `/api/jobs` shows status `scheduled`, `scheduled_for` and the `accept` block.

**Worked example.**
```
POST /admin/quote/U-0024/accept?k=…   {"version":1,"window":1}
→ 409 {"error":"taken","reason":"that time overlaps a booking another job already holds","state":"taken",…}
POST /admin/quote/U-0024/accept?k=…   {"version":1,"window":2}
→ 200 {"state":"booked","job_id":"U-0024","version":1,"window":{"n":2,"date":"2026-10-05","start":"09:00","end":"11:00"},"price":395,"accepted_by":"text",…}
```

---

## 4 · `POST /admin/quote/<U-id>/cancel` — withdraw a version

**Body:** `{"version": 1}`. The version becomes `withdrawn` and its link shows "withdrawn". **If it was booked, the booking is freed**: another job can book that time at once. The record is re-stamped: status back to `quoted`, `scheduled_for` and `scheduled_at` null, `accept.cancelled_at` set, and a `booking-cancelled` event.

**Answers**
- `200 {"state":"withdrawn","version":1,"already":false,"freed":{"date","start","end"}|null}`
- `404`: no such job or version.

**Worked example.**
```
POST /admin/quote/U-0012/cancel?k=…   {"version":1}
→ 200 {"state":"withdrawn","version":1,"already":false,"freed":{"date":"2026-09-29","start":"08:00","end":"10:00"}}
```

---

## 5 · `GET /admin/quote/<U-id>` — the quote's state, for the Flux Capacitor

This returns every version, newest last as `current`, plus the job's booking. **It never returns the code or its hash.**

```json
{ "job_id": "U-0019", "now": "…",
  "current": { "version": 1, "status": "accepted", "state": "booked",
    "created_at": "…", "sent_at": "…", "hold_until": "…", "held": false, "cutoff": "…", "short_notice": false,
    "lang": "en", "price": 395, "price_note": null, "scope": ["…"], "included": "…", "guarantee": "…", "insurance": "…",
    "windows": [{ "n": 1, "date": "2026-09-29", "start": "14:00", "end": "16:00", "free": true, "label": "Tue 9/29 2–4 PM" }],
    "accepted_at": "…", "accepted_by": "page", "accepted_window": 1, "none_at": null, "cancelled_at": null,
    "views": 3, "last_view_at": "…", "pushed_at": "…", "push_kind": "accept", "mirrored": true },
  "versions": [ … ],
  "booking": { "date": "2026-09-29", "start": "14:00", "end": "16:00", "version": 1, "booked_at": "…" } }
```
- `status` is one of `open` · `superseded` · `accepted` · `withdrawn`.
- `state` is what the customer's page would show (§7).
- **`held`** is true while `now < hold_until` on an open quote. This is what the Flux Capacitor treats as "held for this quote" when two quotes offer the same window. The book does not block a second quote from offering a held time; the first YES wins.
- An unknown job, or a job with no quote, answers `404`.

**THE HOLD, as the Worker computes it:**
- `cutoff` = 9:00 PM Central two days before the **earliest** offered window's date.
- If that has already passed when the quote is created, the quote is `short_notice` and `cutoff` = that window's start − 12 hours. If that has passed too, the create answers `422 "too soon to hold"`.
- `hold_until` = the earlier of (`sent_at`, or `created_at` until it is sent) + 48 real hours, and `cutoff`.
- A booking **by the page** is allowed while `now < cutoff` and the time is free. Before `hold_until` the time is held for them. After it, the time is still open but no longer held. At or after `cutoff` it is too close to prepare.

| sent | window | hold_until | cutoff |
|---|---|---|---|
| Wed 9/23 10:00 AM | Tue 9/29 8–10 | Fri 9/25 10:00 AM | Sun 9/27 9:00 PM |
| Wed 9/23 10:00 AM | Fri 9/25 8–10 | Wed 9/23 9:00 PM | Wed 9/23 9:00 PM |
| Wed 9/23 10:00 AM | Thu 9/24 8–10 | Wed 9/23 8:00 PM (short notice) | Wed 9/23 8:00 PM |
| Fri 10/30 10:00 AM | Tue 11/3 8–10 | Sun 11/1 9:00 AM CST (48 real hours across the end of DST) | Sun 11/1 9:00 PM CST |
| created Wed 9/23 8:30 PM | Thu 9/24 8–9 AM | — `422 too soon to hold` | — |

---

## 6 · What the KV record carries (the collector's view, `/api/jobs`)

- `quote`: the newest version as `{version, status, state, sent_at, hold_until, cutoff, short_notice, windows, price, none_at, views, last_view_at, sent_versions}`. It never carries the code. It is refreshed on create, sent, accept, none and cancel, and by the reconcile. **Views are counted only in the book.** A visit never writes KV, so `views` here is as of the last real change.
- `accept`: `{at, by: "page"|"text", version, window {date, start, end}, price}`, plus `cancelled_at` once withdrawn.
- `accepted_at`, `status` `scheduled`, `scheduled_for` (the window's start as a UTC instant), `scheduled_at` (the moment it was booked). The events `accepted`, `booking-cancelled`, `quote_sent` and `none_of_these_times` are added. If `quoted_at` was still null when a quote was accepted, it is set from the quote's `sent_at` (or `created_at`), with a `quoted` event whose `note` says so.
- The markdown export (`/api/export/<id>.md`) has a section **E2 · ACCEPTED**: the day, the arrival window, the price, by page or text, and the version.
- **The mirror is per job.** Every KV write rebuilds the job's whole projection from all its rows, then marks every row mirrored. A write that fails leaves the rows ahead, and the 5-minute run re-stamps them without needing a KV list.

---

## 7 · The seam ACCEPT-PAGE-02 uses (not HTTP routes; `src/quotes.js`)

The page calls only these three. Each is the whole step: the book call, then the KV stamp, then his phone. **A caller never stamps or pushes by itself.**

- **`viewByCode(env, code, nowIso)`** is ONE book call. It counts the visit (`views`, `last_view_at` on the book's row only, never KV) and returns `{state, body, windows [{n, date, start, end, free}], accepted_window, hold_until, cutoff, short_notice, lang, job_id, version, views}`.
  - `state` is one of `open` · `hold_ended` · `taken` · `too_close` · `booked` · `updating` · `replaced` · `withdrawn` · `received` · `not_found`.
  - `taken` means at least one offered window is booked by another job. `free` says which window is still open.
  - `body` is `{price, price_note, scope[], included, guarantee, insurance, first_name}`. `first_name` is the first word of the name on the request, for "Hi Ana,".
- **`bookByCode(env, code, version, window, by, nowIso)`** returns `{state, …}`.
  - `state` is `booked` · `already_booked` (idempotent: the same code again writes nothing) · `not_found` · `updating` · `replaced` · `withdrawn` · `taken` · `too_close` · `choose_window` (two windows and no choice) · `no_such_window`.
  - `by: "page"` pushes his phone, 7 AM–9 PM Central only. Outside those hours the push waits for the first 5-minute run from 7:00.
- **`markNone(env, code, version, nowIso)`** returns `{state: "received", first: true|false}` or a standing refusal. It stamps `none_at` once per version. The first call pushes "none of the times work"; a second call does nothing.

An unknown or malformed code answers `not_found` without reaching the book.

---

## 8 · The pushes (for reference; the Flux lane sends none of these)

- **A page booking:** title `ACCEPTED · U-0012 · Tue 9/29 8–10 AM`, message `$395 · v1`, priority 1.
- **"None of these times work":** title `U-0012 · none of the times work`, message `text them other times`.
- No push carries a link (R25), a customer name, phone, address or email.
- They go out between 7 AM and 9 PM Central only. Exactly one push per event. `pushed_at` is set as soon as any channel delivers. A channel that answered 5xx is retried once by the next run. A 4xx is logged and never retried.

---

## 9 · A suggested last line for the quote text

In his researched style (plain characters, no dashes, no emoji; see `SUPE\QUOTE-REPLY-RESEARCH-2026-09-22.md` §0):

> Reply YES or tap here to lock it in: umbradomus.com/q/<code>

**The Flux lane decides the final wording.** The link is `url` from §1, with its `https://` dropped for the text if they choose.
