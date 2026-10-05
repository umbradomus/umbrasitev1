RESULT: GREEN — CONFIRM-01: the website now sends ONE booking confirmation text itself on every booking (page tap and texted YES), queued 9 PM–7 AM, consent and STOP honoured, never retried, and `confirmation` is on the state, /api/jobs and the export. Proved RED→GREEN by suite C (54 failed on main → 85/85) under a Node stand-in runtime, because wrangler could not be installed in this sandbox; the run under `wrangler dev` and the browser suites (A–G, I, K) are still owed on a machine that has them.

## STATE
Branch `confirm-01` in /home/claude/site, 8 commits on top of main 588a728; nothing pushed, nothing deployed, no secret touched, no new dependency, no wrangler.toml change.
- de555e7 (1) the Node stand-in runtime for the Worker-only suites (test/lib/node-worker*.mjs, test/run-local.mjs)
- 58f76e5 (2) suite C, RED on main (test/suite-c-confirm.mjs; wired into run-all.mjs as want('C'))
- 65b270f (3) the book carries the text (quotebook.js, 4 additive columns + claim-once); src/confirm.js decides and sends once
- 9d0de77 (4) finishBooking → the text; the state, /accept, /api/jobs, the export carry `confirmation`; reconcile sends what is owed
- 0fac180 (5) the booked page: "Nothing else to do. I'll text you the day before." (ES: "Le escribimos el día anterior.")
- 728a593 (6) QUOTE-API.md §14 + the rule for the Flux: never a second send
- dffca32 (7) the proof files under worker/test/proof-confirm/

## DID
1. **The text.** `src/confirm.js`, called from `finishBooking` (quotes.js) — the one place both the page's accept and `POST /admin/quote/<id>/accept` land. One POST through holding.js's `postText` (same key, same base gate, 20 s, never a retry). EN: "You're booked with Umbra Domus: Tue Sep 29, 8-10 AM. Price $395 flat. We'll text the day before and when we're on the way. Reply STOP to opt out. - Drew" (GSM-7 folded, 174–186 chars, 2 segments). Spanish when lang=es. Two-visit option: one visit per line. Message id `<U-id>-confirm-v<version>`, minted once; the gateway refuses a repeat of it.
2. **Quiet hours.** `isOpen` false, or inside the last ten minutes before 9 PM → `queued` on the row (`confirm_due` kept); the every-minute cron's `reconcile` (already day-only) sends it at the first 7:00 run, then stamps in the same run. Cancel clears the due text.
3. **Consent.** `consent.smsService === true` (the form's "Text me about this request") and not on STOP (outbox `optedOut` + `sms_opt_out`). Else `no_consent` (why `no_consent` | `stop`), no POST.
4. **No key.** `!hasKey(env)` → `no_key`, no call, push "Booking U-xxxx: no texting key on the website — confirm them yourself" via sendAlert (day and price only).
5. **Recorded.** Book row `confirm_json` → `confirmation {state, at, id, sha, lang, parts, status, why?, queued_at?, send_at?}`; stamp mirrors it to KV (`confirmation` + `version`, one `confirmation` event per settled state); `GET /admin/quote/<id>` top-level and per version; `/accept` answer; `/api/jobs` row; export E2 row.
6. **Page.** booked_done gains the promise line; the ticket already shows day, window, price.
7. **Never a second send.** Claim-once on the row in the Durable Object; a stale claim is written `failed`, not resent; suite C's fake 409s a repeated id and saw none.

## PROOF
worker/test/proof-confirm/: RED-suite-c-on-main-588a728.txt (31 passed, 54 failed — every one of the 8 readings fails on main); GREEN-suite-c-on-confirm-01.txt (85/85); confirm-readings.json (the actual words, ids, states); GREEN-confirm-01-suites-DHJSPC-node-standin.txt (D, H, J, S, P, C: 832 passed, 0 failed); BASELINE-main-588a728-suites-DJSP-node-standin.txt (main under the same stand-in: 534/534, so the stand-in runs those suites faithfully); COULD-NOT-run-all-no-wrangler.txt.
Readings: (1) daytime page booking → exactly one POST, right words/number/id, `sent` on state + /api/jobs + export, page promise line, no second send on later ticks or a re-tap; texted YES → one POST. (2) 9:01 PM → queued, nothing at 9:05 PM/11 PM/3 AM/6:59 AM, ONE at 7:00, none at 7:01/7:05. (3) no consent → no POST, `no_consent`. (4) signed STOP webhook → no POST, `no_consent`/`stop`. (5) gateway 500 → `failed`, booking scheduled, no retry. (6) Spanish words; two-visit lines. (7) second Worker without SMSGATE_AUTH → no call, `no_key`, the push. (8) cancelled overnight → nothing at 7:00.

## FOUND
- This sandbox's egress policy denies registry.npmjs.org (`x-deny-reason: host_not_allowed`), so `npm install` cannot bring wrangler or puppeteer-core and `node test/run-all.mjs` cannot start. Built `test/lib/node-worker.mjs`: the Worker's own src loaded into Node 22 (KV/R2 as Maps, the BOOK over node:sqlite), served on 127.0.0.1 — the suites run unchanged against it. Proof is real HTTP against the real code paths, but under a stand-in runtime, not workerd.
- The suite caught a double full stop in the Spanish text ("2-4 p.m.." ) before anything shipped; fixed with holding.js's rule.
- His "Don't auto-text" tap (`no_auto_text_at`) is about the holding text and does NOT block the confirmation; only consent and STOP do, as decided. Say if that should change.
- On the page's POST the send is awaited inline: a gateway timeout would hold the customer's 303 for up to 20 s (rare; same door as every text).

## COULD NOT
- Run `node test/run-all.mjs` or any suite under `wrangler dev`: wrangler is not installable here (registry denied). Suites A–G, I, K (browser + wrangler) did not run and are NOT called green; D, H, J, S, P ran green only under the stand-in. Run `cd worker && npm install && node test/run-all.mjs` on L1 or L2 for the count that goes in the record.
- Email confirmation: out of this round (no transactional mailer; FormSubmit mails only him) — the next item.
