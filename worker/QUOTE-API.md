# QUOTE API — the quote link's admin routes (ACCEPT-PAGE-01, 2026-09-23)

**For the Flux lane's coder (FC-WORKER-TAPS / FC-1.4b).** These are the calls the Flux Capacitor makes to put a quote behind a link, say it was sent, book a texted YES, and withdraw it. The customer's page (`/q/<code>`) is ACCEPT-PAGE-02 and is not described here, except for the three functions it calls (the last section).

Everything here is in `src/quotes.js` (the Worker side) and `src/quotebook.js` (the book: a Durable Object with SQLite storage, binding `BOOK`, one instance named `"book"`). **The book is the single source of truth for quotes and bookings.** The KV job record, which the collector reads through `/api/jobs`, is its mirror. Every write re-stamps the mirror, and the 5-minute scheduled run heals any stamp that failed.

> **Road W, 2026-09-26 (CONTRACTS C4) — two-visit options, the private status link, the receipt.** A quote now offers
> 1–2 **options**, each 1–2 visits on different days, and a yes books **every** visit of the option at once. A quote
> sent the old way (`windows` only) is exactly a list of one-visit options and behaves as before. New: `options` on the
> create (§1), `option` on accept (§3), `freed_windows` on cancel (§4), `options` / `accepted_option` /
> `booking.windows` on the state (§5), `accept.windows` and `quote.options` in KV (§6), every day in the pushes (§8),
> and two new routes: the private status link (§10) and the receipt (§11). Nothing an old caller sends or reads changed.

> **CONFIRM-01, 2026-10-04 — the website confirms the booking itself.** U-0015 booked a time on the quote page at 07:46
> on 2026-10-01 and got nothing: the confirmation text went only from the Flux on his tap, and nothing told him it was
> waiting. Now **every booking — the page's tap and the texted YES (§3) alike — gets ONE confirmation text from the
> Worker**, and where that stands is the new field **`confirmation`** on `GET /admin/quote/<id>` (§5), on `/accept`'s
> answer (§3) and on the `/api/jobs` row (§6). **§14 has the whole of it.** Nothing an old caller sends or reads changed.

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
| `windows` | yes, unless `options` is sent | 1 or 2 × `{date "YYYY-MM-DD", start "HH:MM", end "HH:MM"}`, Central. Alone, each window is its own one-visit option (the old quote, unchanged). |
| `options` | no (road W) | 1 or 2 × `{windows: [w1, w2?]}`: each option is 1 or 2 visits **on different days, the first one first**; every visit keeps every window rule below. **When `options` is sent it wins** and `windows` is ignored — send both, `windows` = each option's first visit, so an older Worker still gets a sensible quote. |
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
- With `options` (road W): not a list of 1–2; an option that is not `{windows: [...]}`, has 0 or more than 2 visits,
  or has its two visits on one day or out of order; the same option twice; two one-visit options that overlap.
  The reason names the option and the visit ("option 2, visit 1: … is a Sunday").
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

**The hold and the cutoff read the earliest visit of any option.** **One hold (road FW, 2026-09-26):** `hold_until` is
the only hold. `/sent` moves it to `sent_at + 48 h` (never past the cutoff), and from then the customer's page, `/sent`'s
answer and `GET /admin/quote/<id>` (`current.hold_until`) all carry that same value; the page shows it to the minute,
so the page and the Flux always name the same time. **road MW (proved by build/MW/test-worker.mjs):** the one field is
`hold_until`. It is first set when the quote link is made (the create's answer: `created_at + 48 h`, a placeholder
nobody has seen), and set for good the moment `/sent` is called — `/sent`'s answer `hold_until` and, from then on,
`GET /admin/quote/<id>` → `current.hold_until` are that same ISO string, and the customer's page shows it cut DOWN to
the minute (8:16:40 reads 8:16 AM, never 8:17). Once a quote is sent, the create's `hold_until` must never be shown again.

**Worked example (road W).** Two pairs of days from their own picks:
```
POST /admin/quote/U-9601?k=…
{"version":1,"price":225,"scope":["…"],
 "windows":[{"date":"2026-09-28","start":"08:00","end":"10:00"},{"date":"2026-09-29","start":"11:00","end":"13:00"}],
 "options":[{"windows":[{"date":"2026-09-28","start":"08:00","end":"10:00"},{"date":"2026-09-29","start":"11:00","end":"13:00"}]},
            {"windows":[{"date":"2026-09-29","start":"11:00","end":"13:00"},{"date":"2026-09-30","start":"14:00","end":"16:00"}]}]}
→ 201 {"code":"…","url":"https://umbradomus.com/q/…","version":1,"hold_until":…,"cutoff":"2026-09-27T02:00:00.000Z",…}
```

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

**Body:** `{"version": 1, "option": 1}` (road W), or the old `{"version": 1, "window": 1}` — the same number: an old-shape quote's options are its windows. `option` wins when both are sent. It may be left out when the quote offers one option.

This is **the same booking step the page uses**, with `accepted_by: "text"`. The time rules apply: the option must be one of those offered, and **no visit of it** may overlap a booking another job holds. Every visit of the option is booked in the same step, all or none: one booking row per visit. **The hold and the cutoff do not apply**, because a YES by text is his call. No push is sent, because he marked it himself. **CONFIRM-01:** the customer's confirmation text goes from this step too (§14) — **the Flux does not send one of its own after a 200 here.**

**Answers**
- `200 {"state":"booked","job_id","version","window":{"n","date","start","end"},"option":n,"windows":[{date,start,end},…],"price","accepted_by":"text","accepted_at","confirmation":{…}}` — `window` stays the option's first visit, for old readers; `windows` is every visit booked; `confirmation` (CONFIRM-01) is §14's block as it stands the moment the answer leaves (`sent`, or `queued` by night, or why not).
- `200 {"state":"already_booked",…}`: this version is already booked. Nothing is written.
- `404`: no such job or version.
- `409 {"error":<state>,"reason":…}`, where `<state>` is one of:
  - `taken`: *that time overlaps a booking another job already holds*
  - `updating` / `replaced`: a newer version exists (not sent / sent)
  - `withdrawn`
  - `choose_window`: two options and no `option` (or `window`)
  - `no_such_window`: no such option

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
- `200 {"state":"withdrawn","version":1,"already":false,"freed":{"date","start","end"}|null,"freed_windows":[…]|null}` — `freed` is the first visit (as before); `freed_windows` (road W) is every visit the booking held, all of them free again.
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
- **road W**, on every version: `options: [{n, windows: [{date, start, end, label, free}], free}]` (an option is `free`
  only when every visit of it is; on a booked version its accepted option is the free one), `accepted_option` (the
  same number as `accepted_window`, which names that option's first visit). `hold_until` is the one hold the
  customer's page shows too (road FW). `windows` keeps its old
  shape: one entry per option, its first visit.
- **road W**, `booking.windows`: every visit the booking holds, in order; `booking.date/start/end` stay the first.
- **`held`** is true while `now < hold_until` on an open quote. This is what the Flux Capacitor treats as "held for this quote" when two quotes offer the same window. The book does not block a second quote from offering a held time; the first YES wins.
- **CONFIRM-01**, top-level **`confirmation`**: the booked version's confirmation text (§14), `null` while nothing is booked; every version also carries its own `confirmation` (`null` until booked).
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
- `accept`: `{at, by: "page"|"text", version, window {date, start, end}, windows [{date, start, end}, …], price}`, plus `cancelled_at` once withdrawn. `window` is the first visit (every old reader); `windows` (road W) is every visit booked. `quote.options` carries every option in the create route's shape.
- **`confirmation`** (CONFIRM-01): §14's block plus `version`, mirrored from the booked row; `null` until a booking. One `confirmation` event per settled state (`sent`, `failed`, `no_consent`, `no_key` — never for `queued`).
- `accepted_at`, `status` `scheduled`, `scheduled_for` (the window's start as a UTC instant), `scheduled_at` (the moment it was booked). The events `accepted`, `booking-cancelled`, `quote_sent` and `none_of_these_times` are added. If `quoted_at` was still null when a quote was accepted, it is set from the quote's `sent_at` (or `created_at`), with a `quoted` event whose `note` says so.
- The markdown export (`/api/export/<id>.md`) has a section **E2 · ACCEPTED**: the day, the arrival window, the price, by page or text, and the version. A second visit adds **Day 2** and **Arrival window 2** rows. CONFIRM-01 adds a **Confirmation text** row once there is one ("sent by the website · <at> · <id>", or why it did not go).
- **The mirror is per job.** Every KV write rebuilds the job's whole projection from all its rows, then marks every row mirrored. A write that fails leaves the rows ahead, and the 5-minute run re-stamps them without needing a KV list.

---

## 7 · The seam ACCEPT-PAGE-02 uses (not HTTP routes; `src/quotes.js`)

The page calls only these three. Each is the whole step: the book call, then the KV stamp, then his phone. **A caller never stamps or pushes by itself.**

- **`viewByCode(env, code, nowIso)`** is ONE book call. It counts the visit (`views`, `last_view_at` on the book's row only, never KV) and returns `{state, body, windows [{n, date, start, end, free}], accepted_window, hold_until, cutoff, short_notice, lang, job_id, version, views, options [{n, windows [{date, start, end, free}], free}]}` (the last: road W).
  - `state` is one of `open` · `hold_ended` · `taken` · `too_close` · `booked` · `updating` · `replaced` · `withdrawn` · `received` · `not_found`.
  - `taken` means at least one offered window is booked by another job. `free` says which window is still open.
  - `body` is `{price, price_note, scope[], included, guarantee, insurance, first_name}`. `first_name` is the first word of the name on the request, for "Hi Ana,".
- **`bookByCode(env, code, version, option, by, nowIso)`** returns `{state, …}`. (`option` was `window`; on an old-shape quote they are the same number.)
  - `state` is `booked` · `already_booked` (idempotent: the same code again writes nothing) · `not_found` · `updating` · `replaced` · `withdrawn` · `taken` · `too_close` · `choose_window` (two windows and no choice) · `no_such_window`.
  - `by: "page"` pushes his phone, 7 AM–9 PM Central only. Outside those hours the push waits for the first 5-minute run from 7:00.
  - **CONFIRM-01:** a `booked` answer also carries `confirmation` (§14) — the customer's text went (or was queued, or why not) inside this same step, before the stamp and the push.
- **`markNone(env, code, version, nowIso)`** returns `{state: "received", first: true|false}` or a standing refusal. It stamps `none_at` once per version. The first call pushes "none of the times work"; a second call does nothing.

An unknown or malformed code answers `not_found` without reaching the book.

---

## 8 · The pushes (for reference; the Flux lane sends none of these)

- **A page booking:** title `ACCEPTED · U-0012 · Tue 9/29 8–10 AM` — every day booked, joined by ` + ` (road W: `ACCEPTED · U-9601 · Mon 9/28 8–10 AM + Tue 9/29 11 AM–1 PM`) — message the price only, `$395`, priority 1.
- **A new request** (alerts.js, road W): title `NEW JOB · U-9601 · reply by 9:00 AM`, message the job type and the first line of their words (`Drywall & Paint — Two fist-sized holes in the ceiling over the kitchen table.`), cut at a sentence or a whole word, never mid-word; any word of the name on the request is taken out of their words. The ladder after it is unchanged.
- **"None of these times work":** title `U-0012 · none of the times work`, message `text them other times`.
- No push carries a link (R25), a customer name, phone, address or email.
- **The repeats on his table** (alerts.js): `STILL OPEN · U-9601 · 50 min left`; once the Flux has made the quote
  link and it has not gone (road FW, the book asked fresh), **road MW:** title `QUOTE READY · U-9601 · $225 · text ready ·
  tap Send` (the price of the newest version not sent yet; the job number, never a name or their words), message
  `50 min left · quote due 9:00 AM`, **priority 0** (normal: no siren, no acknowledge chain, at any minute of the
  ladder). A STILL OPEN repeat's message is one line, never cut mid-word: the job type and the first line of their
  words. Once the quote is sent, no more repeats.
- **One app (road FW):** every push goes to Pushover. Telegram carries it only when Pushover did not (a 4xx, a 5xx,
  no answer, or no Pushover keys); when Pushover takes it, Telegram is not called.
- They go out between 7 AM and 9 PM Central only. Exactly one push per event. `pushed_at` is set as soon as any channel delivers. A channel that answered 5xx is retried once by the next run. A 4xx is logged and never retried.

---

## 9 · A suggested last line for the quote text

In his researched style (plain characters, no dashes, no emoji; see `SUPE\QUOTE-REPLY-RESEARCH-2026-09-22.md` §0):

> Reply YES or tap here to lock it in: umbradomus.com/q/<code>

**The Flux lane decides the final wording.** The link is `url` from §1, with its `https://` dropped for the text if they choose.

---

## 10 · `POST /admin/status-link/<U-id>` — the private status link (road W)

For a text that carries "Track it: <link>". **No body.** Admin key in `?k=`; no key → `401`; unknown job →
`404 {"error":"not_found","what":"job"}` (the `what` tells it from an older Worker without this route, whose `404` is
a plain `{"error":"not_found"}`).

- `200 {"link":"https://www.umbradomus.com/status?id=U-9601&v=<43 characters>"}` — `SITE_BASE_URL + /status?id=<id>&v=<token>`.
- **Asking again answers the same link.** The token is made from the job's own secret (HMAC-SHA256 over the record's
  `token`, the `t` of its thank-you link), so a Flux that asks twice never breaks a link it already texted, and a repeat
  writes nothing. The record keeps only the token's sha256 (`view.sha256`), never the token.
- The status page (`/status`) opens with `?id=&v=` exactly as it opens with `?id=&t=`; so do `GET /api/job/<id>?v=` and
  its photos. A wrong key answers exactly like a job that does not exist (`404`).

## 11 · `PUT /admin/receipt/<U-id>` — the customer's receipt, kept and linked (road W)

**Body:** `{"html": "<the receipt page>", "paid": {"method": "cash"|"zelle"|"check"|"card", "amount": 225, "at": "<ISO>"}, "completed_at": "<ISO>"}`.
`at` may be left out (now). `completed_at` (road FW, optional) is when the work finished; the status page's Done step
names it ("Done · Tue 9/29, 4:20 PM — finished, inspected and stamped."), and without it says "Done" with no time. A
`completed_at` that is not a time is `422 invalid`. `amount` is one number of dollars, 0 or more (a free fix still gets its receipt); a negative,
a non-number or a missing amount is `422 invalid`.

What it does: stores `html` in the PHOTOS R2 bucket at `jobs/<id>/receipt/<n>.html` (a new object only when the bytes
changed; nothing is ever deleted), marks the record `status: "done"` with `done_at` (if not already set) and `paid`,
and adds the events `receipt`, `paid` and `done`. The same receipt sent again writes nothing and answers the same link.

- `200 {"ok":true,"link":"https://www.umbradomus.com/receipt/U-9601?v=<the same view token as §10>","paid":{…},"done_at":"…","receipt":{"n","bytes","sha256","at"},"written":true|false}`
- `400 bad_body` · `401` · `404` unknown job · `405` (not PUT) · `413 too_large` over 800 KB of html ·
  `422 invalid` (no html, or a bad `paid`).

**The link.** `GET /receipt/<id>?v=` (or `?t=`) serves the newest receipt as it was sent, with
`Content-Security-Policy: default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-modals`
— no script runs, nothing loads from anywhere else, and the page is sandboxed (no script, forms or site storage even
if something got past `script-src`; `allow-modals` only so a browser will print it) — plus `no-store`, `noindex` and `nosniff`. A page without a
viewport tag gets one, so it opens at phone width. It prints to PDF from the phone's own Print. The site rewrites
`/receipt/*` to this Worker (vercel.json), so the link lives on umbradomus.com. A wrong key, another job's key or a job
with no receipt yet all answer the same `404` "This link isn't valid." page.

**The status page then shows it:** `/api/job/<id>` carries `paid {method, amount, at}`, `receipt: true` and every
booked visit (`visits`), and `/status` reads "Done and paid.", "Paid $225 by Zelle on Tue, Sep 29." and a
**Your receipt** button that opens the receipt with the page's own key.

**Road FW adds to `/api/job/<id>`:** `service` (the page's top line reads "Your repair · drywall & paint", never the
job number), `finished_at` (from `completed_at` above, else null) and `quote_link` — while the newest version is sent
and still open, the customer's own quote page, so the status page shows "See your quote & pick your days". The code
behind that link is MADE from the job's own secret (HMAC-SHA256 over the record's `token`, like §10's view token) and
still never stored; a quote whose code was drawn (before road FW, or a job with no secret) has no button.

## 12 · Change orders — `kind: "change"` on the same routes (road CO)

His words: *"we need an ability to add extra materials, and have that create a new work order that we can get signed
before we buy anything else."* A change order is a version of the job's quote with `kind: "change"`, numbered on its own
("Change 1", "Change 2"). It lives in the book's own `changes` table (additive: `CREATE TABLE IF NOT EXISTS`), so the
original quote, its booking, its hold and its KV mirror are never touched. It is only ever made on a job whose quote is
booked.

- **Make one:** `POST /admin/quote/<U-id>` `{"kind":"change","version":1,"what":"Roll the whole ceiling - the patch color won't blend","scope":["Paint the whole ceiling","Ceiling paint, 1 gal","Roller cover"],"price":85,"base":225,"total":310,"lang":"en"}`
  → `201 {"kind":"change","code":"…","url":"https://umbradomus.com/q/<code>","version":1}`. `what` is one plain line
  (≤ 140 characters); `scope` 1–20 plain lines; like a quote, no dollar figure in either (R38: the change is one price)
  and neither of R33's words. `total` must be `base + price`. `409 not_booked` on a job with no booked quote;
  `409 version_not_newer` for a number already used. The code is made from the job's secret (`"c<n>"` in the HMAC
  message, apart from every quote version's) and never stored.
  **road MW · `work_lines` (optional, a whole number 0 to the number of scope lines):** how many `scope` lines, from the
  top, are steps of the work; the lines after them are the store items it uses. The Flux sends `ch.steps.length` (its
  scope is the steps, then the items). With it, their page shows the work in the open — "What it adds · 5 steps · done
  during your booked visits" and the steps — and folds the items away under "What it uses · 2 items". Without it, the
  page is as before. `GET /admin/quote` carries it back on that change only.
- **It went:** `POST /admin/quote/<U-id>/sent` `{"kind":"change","version":1,"sent_at":"…"}` → `200 {ok, kind, version, sent_at}`.
- **Withdraw one they haven't answered:** `POST /admin/quote/<U-id>/cancel` `{"kind":"change","version":1}`.
- **Their page:** `/q/<code>` shows what and why, the price ("$85 more"), the new total, what it adds (folded), then
  **OK the change** with their name typed as the signature, or **No thanks**. `POST /q/<code>` with `a=ok&name=…&v=1` or
  `a=no&v=1`; a name that is not 2–80 letters answers the page again asking for it. One answer only: a second writes
  nothing. OK'd → the book keeps the name and the time; his phone gets `CHANGE OK · U-9601 · $85` / `Change 1 · new
  total $310` (no → `CHANGE NO · U-9601 · $85` / `Change 1 · they said no thanks`), 7 AM–9 PM Central, the job number and
  the money only (R25).
- **The state:** `GET /admin/quote/<U-id>` gains `changes: [{kind, version, status (open|accepted|declined|withdrawn),
  state, created_at, sent_at, what, scope, price, base, total, answer (yes|no|null), answered_at, signed_name, views, …}]`
  — **only when the job has one**; a job with none answers exactly as before.
- **KV and the status page:** the record gains `changes: [{n, state, what, price, base, total, sent_at, answered_at}]`
  and the events `change_ok` / `change_no`; `/api/job/<id>` gains `changes` (with the customer's own link while one is
  waiting), and `/status` shows each change and the new total. Neither key exists on a job with no change.

## 13 · Round 3 of the website fixes (road XW, 2026-09-26)

**New optional fields on `POST /admin/quote/<U-id>`** (a quote). Each is stored only when sent; a quote without them is
stored and read exactly as before, and `GET /admin/quote/<id>` echoes each one on a version that carries it.

| field | what it is | the customer's page |
|---|---|---|
| `step_count` | a whole number 1–99, never fewer than the `scope` lines: the number of steps on the Flux's plan (e.g. 12 when `scope` lists the 10 that are not set-up or clean-up) | "What I'll do · 12 steps", and under the folded list "Plus 2 smaller steps along the way." Without it the count is the lines listed. |
| `visit_minutes` | a list of 1 or 2 whole numbers of minutes, 15–720: how long visit 1, then visit 2, of every option takes | under each visit's arrival window, on a small line of its own: "about 1½ hours", "about 4 hours" (rounded to the half hour; Spanish "una hora y media", "unas 4 horas"); the booked page too |
| `their_paint` | `true` / `false`: the job uses their leftover paint | `true` turns the included line's paint sentence into "Painted with your paint." Without it the Worker reads the form's own answer (`paint_on_site` "Yes" → `true`). `false` keeps the Flux's line as sent. |

`422 invalid` with the reason when one is wrong ("step_count cannot be fewer than the scope lines", "visit_minutes must
be a list of 1 or 2 whole numbers of minutes, 15 to 720: visit 1, then visit 2", "their_paint must be true or false").

**The year their house was built.** The quote page has one optional box, "What year was your house built?", posted with
Accept (`year`, four digits, 1700 to this year; anything else is no answer and never stops a booking). It is kept on
that version's book row (new columns `quotes.year_built`, `quotes.year_at`, added the additive way) even when the
booking is refused, shown back in the box, and mirrored to the KV record as `year_built` (plus one `year_built` event).
It is pushed to nobody. **The Flux reads it from `GET /admin/quote/<id>`: top-level `year_built` (a number) and
`year_built_at` (ISO)** — both only present once they gave one.

**The words.** The English page speaks in one voice, his ("I", "my text"); the hold reads "Held for you until Sat 9/26,
7:42 AM."; the "Light." paragraph is one line (`LIGHT_SHORT` in `page-words.js`; READY-4's paragraph stays in
`notices.js`, unchanged).

**The receipt on a phone.** `GET /receipt/<id>?v=` gets one [Save as PDF] bar at the top and a bigger seal under 8.7 in
(the stored bytes never change; the page's CSP is unchanged: no script at all). The bar links
`GET /receipt/<id>/print?v=` (or `?t=`): the same receipt with ONE script, pinned by its sha256 in that response's CSP
(`script-src 'sha256-…'`, sandbox `allow-modals allow-scripts`, never same-origin, forms or top navigation), which opens
the phone's Print (Save as PDF) once loaded. The bar never prints.

## 14 · The booking's confirmation text — `confirmation` (CONFIRM-01, 2026-10-04)

**His call (option A): the website confirms the booking itself, the moment it happens.** `src/confirm.js`, called from the one
place every booking passes (`finishBooking` in `src/quotes.js`): the page's **Accept & confirm** (§7 `bookByCode`) and the
texted YES (§3) alike.

**What goes.** ONE text to the customer's number, through the same door every text leaves by (`holding.js postText`: the
`SMSGATE_AUTH` pair, twenty seconds, never a retry), folded to GSM-7:

> You're booked with Umbra Domus: Tue Sep 29, 8-10 AM. Price $395 flat. We'll text the day before and when we're on the
> way. Reply STOP to opt out. - Drew

Spanish when the quote's `lang` is `"es"` ("Su cita con Umbra Domus quedo confirmada: mar 29 sep, 8-10 a.m. Precio $395
fijo. Le escribimos el dia anterior y cuando vayamos en camino. Responda STOP para no recibir mensajes. - Drew"). A
two-visit option lists each visit on its own line. Under 320 characters (two segments). Never "licensed" or "bonded".

**When.** 7 AM–9 PM Central, at once (and never inside the last ten minutes before 9 PM). **9 PM–7 AM it is queued** on the
booking's own row in the book and the every-minute cron (`reconcile`) sends it with the **first run from 7:00 AM** — once.
Whatever the gateway answers, it is **never retried**: a 4xx is `failed` (refused), a 5xx or a timeout is `failed`
(unknown), and nothing is sent again. A booking withdrawn (§4) while its text waits sends nothing at 7:00.

**Who.** Only a customer whose request ticked **"Text me about this request"** (the record's `consent.smsService === true`,
the same word the holding text reads) and whose number is **not on the STOP list** (a STOP through SMSGate's webhook, or
his "No texts" tap; `sms_opt_out` / `optout:` in KV). Without that: no text, state `no_consent` — the Flux shows **"they
didn't opt in to texts — call them"**. No `SMSGATE_AUTH` on the Worker: no call at all, state `no_key`, and his phone gets
**`Booking U-0015: no texting key on the website — confirm them yourself`** (the day and the price in the message, R25).

**The field.** On the booked version (`GET /admin/quote/<id>` top-level `confirmation`, and on each version), on `/accept`'s
`booked` answer, and on the `/api/jobs` row (with `version`):
```json
{ "state": "sent",                       // sent | queued | failed | no_consent | no_key
  "at": "2026-10-01T12:46:03.000Z",      // when it was decided / sent (Central 7:46 AM)
  "id": "U-0015-confirm-v1",             // SMSGate's message id — minted ONCE from the job and the version
  "sha": "<sha256 of the words>",
  "lang": "en", "parts": 2, "status": 202,
  "queued_at": "…", "send_at": "…",      // only on a text that waited for 7:00 AM
  "why": "stop" }                        // only on no_consent (no_consent | stop), no_key, failed (refused | unknown | …)
```
**THE RULE FOR THE FLUX: never a second send.** Read `confirmation` before sending anything of its own: `sent` or
`queued` means the website has it — show "Confirmation sent ✓ 7:46 AM" (or "queued for 7:00 AM") from `at` and do nothing.
`no_consent`, `no_key` and `failed` are the three that need him: show the reason and "call them". The message id
`<U-id>-confirm-v<version>` is also what the gateway itself refuses a repeat of, so a Flux send that reused it would be
a 409, not a second text. A booking never fails because its text failed: the worst case is `failed` on the row.

**The customer's page** after booking reads "You're booked." · one line with the day, the window, the price and the
promise — **"Tue, Nov 10 — 8–10 AM — $395 — I'll text you the day before."** (SITE-FIX-03's `bookedSummary`; Spanish:
"Jueves 12 de noviembre — Llegada entre las 8 y las 10 a.m. — $395 — Le enviaremos un mensaje de texto el día
anterior.") · then "Nothing else to do." / "No tiene que hacer nada más." — the promise is said once (CONFIRM-02).

**The email** (SITE-FIX-03, folded under CONFIRM-02): a page booking with an address also gets ONE confirmation email,
down the FormSubmit road the request copy rides (`worker/src/booking-email.js`, sent from page.js's POST, claimed on the
record as `confirmation_email_at` before the send; a refused send gives the claim back). A texted YES gets no email.
So a booking is ONE text (this section) and ONE email (that one) — never a second of either.

---

## 15 · `POST /admin/quote/<U-id>/reprice` — lowering a booked price, once (REPRICE-01, 2026-10-05)

**Why it exists.** U-0015 was booked on the page on 10-01 at $70, and the price is $50 ("it is 50 dollars"). §1 answers
**`409 accepted`** to a new version on a job that has one, and a change order (§12) can only **ADD** (`total = base + price`).
Cancelling v1 (§4) would withdraw the link he already booked and free a visit now in the past. So there is one route, and
it does one thing: **his side lowers the accepted version's price, once, and the customer is told nothing.**

```
POST /admin/quote/U-0015/reprice?k=<ADMIN_KEY>
{ "version": 1, "price": 50 }

200 { "state": "repriced", "version": 1, "already": false, "price": 50, "price_was": 70 }
```

**Only down, only the booked version, only once.**

| the call | the answer |
|---|---|
| `price` equal to or above the version's price | `422 {"error":"invalid","reason":"price must be LOWER than the booked price (70); a price that adds is a change order","price":70}` |
| `price` not a positive number (0, −5, `"45"`, missing) | `422 {"error":"invalid","reason":"price must be a positive number of dollars, lower than the booked price"}` |
| the version is not the accepted one (open, sent, withdrawn) | `409 {"error":"not_accepted","reason":"…this one is <standing>","standing":"open"}` |
| an unknown job, or a version this job never had | `404 {"error":"not_found"}` |
| **the identical call again** | `200 {"state":"repriced","version":1,"already":true,"price":50,"price_was":70}` — **and not one write** |
| a *different* second lowering (45 on the one already at 50) | `422 {"error":"invalid","reason":"this price was already lowered once, from 70 to 50; it is lowered once","price":50,"price_was":70}` |

**What it moves.** In the book, that version's `price` becomes P and the price he booked at is kept beside it as
**`price_was`** (with `repriced_at`), inside `body_json` — no new column, nothing the Flux or the Job Sync reads. The KV
record is re-stamped through the one mirror every other write uses, so **`quote_amount`**, **`accept.price`** and
`quote.price` all read P, with exactly one event **`repriced {version, from, to}`** (derived from the book, so a stamp,
a failed stamp and the 5-minute reconcile all write it once). `GET /admin/quote/<id>` (§5) carries the new `price` and
**`price_was`** on that version and on `current` — **his side only: no customer payload and no customer page carries the
old price.** The customer's `/q/` page and his status page simply read the new price, in both languages.

**What it never does.** No text, no push, no email — the version and its `accepted_at` do not move, so nothing is
"fresh" and no confirmation, acknowledgement or reminder is minted. The booking, its visit windows, its confirmation
and its hold are untouched. It cannot raise a price: that is still a change order (§12).
