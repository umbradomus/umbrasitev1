# THE INTAKE WORKER — what it is, and how to turn it on

**Stage 1 of `THE-ROAD-FROM-EMAIL-TO-AUTOMATED-QUOTE`: "the form posts to something we own."**
Written 2026-09-17.

> ### TO TURN IT ON, DOUBLE-CLICK ONE FILE
> ```
> C:\Users\andre\Umbra\umbrasitev1\worker\DEPLOY-STAGE-1.cmd
> ```
> Then click **Allow** in the browser tab that opens, once. That is the whole job —
> everything else is in the script. Details in **THE ONE-CLICK ROUTE** below.

---

## WHAT IT IS, IN PLAIN WORDS

Today the request form on umbradomus.com posts to FormSubmit, which turns it into an email
and forgets it. There is no record, no clock, and the `/status` page honestly says it is
being built.

This is a small program that sits between the form and that email. When somebody fills the
form in:

1. It gives the request a number — **U-0003**, then U-0004, and so on. U-0001 and U-0002
   already exist on paper, so the first one this creates is U-0003.
2. It saves everything they typed, word for word, and puts their photos in storage we own.
3. It **still sends the same email to your inbox**, through FormSubmit, exactly as today —
   plus two extra lines: the job number and the customer's status link.
4. It sends the customer to the confirmation page, which now tells them their number and
   gives them a private link they can reopen any time.
5. **It pushes your phone the minute a request lands** (Pushover, with Telegram as the
   backup) and keeps at it until you acknowledge: one urgent alert at 15 minutes that rings
   until you tap Acknowledge, a reminder every 30 minutes, one OVERDUE at the 2-hour mark.
   Nothing between 9 PM and 7 AM; one summary at 7:00. That push is the whole point. A screen
   you have to remember to open is not. Setting it up: `ALERTS-SETUP.md` (ALERTS-01).
6. It gives you one page — `/admin` — with the oldest unquoted request on top, the minutes
   showing, and three buttons on each job: **Quoted · Scheduled · Done.**
7. It can hand any job back as a markdown file in the same shape as
   `Bridge\BIP\UMBRA\JOBS\U-0002-wills-ceiling\00-JOB.md`, so a job lands in the brain the
   way every other record does.

**The one rule it is built around: never lose a request.** The record and the email are two
separate channels and neither can take the other down. If the record store is unreachable
the email still goes. If FormSubmit is down the record is still kept and marked
`forward_failed` so you can see it. Both were tested by breaking each one on purpose.

---

## THE SECRETS

| name | what it is |
|---|---|
| `ADMIN_KEY` | A long random string. It is the only thing between the internet and your list of customers. It goes in the address bar of the admin page: `/admin?k=THEKEY`. Bookmark that URL on your phone. |
| `PUSHOVER_TOKEN` · `PUSHOVER_USER` · `TELEGRAM_BOT_TOKEN` · `TELEGRAM_CHAT_ID` · `HOOK_SECRET` | The phone's alerts (ALERTS-01). What each one is and where it comes from is in `ALERTS-SETUP.md`. They go into a file you paste from; no seat ever sees them. |

No email password, no third party holding money or records.

**The one-click script makes the admin key for you** and never changes it once it exists.
(It was written for Stage 1, before the alerts: it also stores the retired push service's
secret. For any change after Stage 1, deploy with `npx wrangler deploy` instead — see the
close of round ALERTS-01.)
Doing it by hand instead, the admin key comes from:

```
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

---

## THE ONE-CLICK ROUTE — do this one, not the long one below

**Double-click this file:**

```
C:\Users\andre\Umbra\umbrasitev1\worker\DEPLOY-STAGE-1.cmd
```

A black window opens and does everything on this page by itself. **You do exactly one
thing:** a browser tab will open asking Cloudflare for permission — click **Allow**, then
go back to the black window. It carries on from there.

It makes the record store, makes the photo bucket, makes both passwords, stores them at
Cloudflare, puts the Worker up, checks that it answers, switches the website over, commits
and pushes. Then it writes **`worker\DEPLOY-RESULT.md`** with your list's address (password
included) and a PASS or FAIL line for every step.

Things worth knowing:

- **It is safe to run again.** Every step checks whether it has already been done. Your two
  passwords are never regenerated on a second run, the record store is never duplicated,
  and nothing is ever deleted.
- **If it stops, it tells you the one thing to do and stops cleanly.** Do that thing,
  double-click the file again, and it picks up from where it stopped. The two most likely
  stops are R2 needing to be switched on once in the Cloudflare dashboard, and a GitHub
  login for the final push.
- **If the window ever asks you a yes/no question**, the answer is `y` and Enter. It is not
  supposed to — say so if it does, because that is a defect.
- **It never touches the website until the Worker has answered correctly.** If the Worker
  is up but misbehaving, the site is left exactly as it is today.
- The full transcript of every run is appended to `worker\DEPLOY-LOG.txt`, with both
  passwords blanked out, so that file is safe to send to Claude as-is.
- **`DEPLOY-RESULT.md` has your admin key in it.** It is git-ignored, along with
  `DEPLOY-LOG.txt` and `.dev.vars`, so none of the three can ever be committed by accident.
  If you send the result file to Claude, delete the `?k=...` part first.

**If Windows refuses to run it.** Both files are written locally rather than downloaded, so
SmartScreen should not appear at all — but if Windows does put up a blue "protected your PC"
box, or the window closes instantly: right-click `DEPLOY-STAGE-1.cmd`, choose **Properties**,
tick **Unblock** at the bottom, click OK, and double-click it again. Nothing else needs
changing — the launcher already sets the execution policy for its own run only, so you never
have to change a Windows setting.

To check the script's own logic without touching Cloudflare or the internet:

```
powershell -ExecutionPolicy Bypass -File worker\deploy-stage-1.ps1 -SelfTest
```

---

## THE LONG ROUTE — the same thing by hand

Only needed if the one-click route stops on something and you would rather finish it
yourself. Do these in order, from `C:\Users\andre\Umbra\umbrasitev1\worker`. Everything
here is free at Umbra's volume by a wide margin.

**1 · Sign in**

```
npx wrangler login
```

A browser window opens. Approve it.

**2 · Make the record store**

```
npx wrangler kv namespace create RECORDS
```

It prints an id. Open `wrangler.toml` and paste that id over `REPLACE_WITH_KV_NAMESPACE_ID`.

**3 · Make the photo bucket**

```
npx wrangler r2 bucket create umbra-job-photos
```

(R2 needs to be switched on once in the Cloudflare dashboard; it is free to enable.)

**4 · Set the two secrets**

```
npx wrangler secret put ADMIN_KEY
```

and the five alert secrets, exactly as `ALERTS-SETUP.md` step F says.

Each one asks for the value and stores it at Cloudflare. **They are never written into any
file in this folder.**

**5 · Put it up**

```
npx wrangler deploy
```

It prints an address like `https://umbra-intake.SOMETHING.workers.dev`. **Write it down.**

**6 · Tell it its own address**

Open `wrangler.toml`, put that address into `PUBLIC_BASE_URL`, and run `npx wrangler deploy`
again. Pushover calls back on that address when you tap Acknowledge. (No alert carries a
link: the request waits for you on the computer.)

**7 · Set up the phone**

Follow `ALERTS-SETUP.md`: Pushover, the Telegram bot, and the Gmail filter that makes the
form's email ring the phone even when the Worker is down.

**8 · Check it before pointing the site at it**

Open `https://umbra-intake.SOMETHING.workers.dev/admin?k=YOUR-ADMIN-KEY`. An empty list is
the right answer.

---

## THE ONE LINE THAT FLIPS THE SITE OVER

In `assets/umbra-endpoint.js`, at the top:

```js
window.UMBRA_WORKER_BASE = '';
```

becomes

```js
window.UMBRA_WORKER_BASE = 'https://umbra-intake.SOMETHING.workers.dev';
```

That is the whole change. Commit and push, and Vercel does the rest. All four request forms,
the confirmation page and the status page follow that one line. Nothing else on the site
needs touching.

Put it back to `''` and everything is exactly as it is today.

---

## THE ONE-WAY DOOR — and why it isn't one

**It isn't.** Once the form points at the Worker, the Worker still forwards every single
submission to FormSubmit, so **the email you get today keeps arriving, unchanged**, with the
same fields and the same photos. If the Worker were removed tomorrow, changing that one line
back to `''` puts the site exactly where it is now and nothing has been lost.

Two things worth knowing:

- **With JavaScript switched off**, the form keeps its own `action`, which stays on
  FormSubmit forever. A no-JS submit still arrives as an email; it just gets no record and
  no status link. That is a deliberate floor, not an oversight.
- **The records live at Cloudflare.** Markdown is the source of truth (standing doctrine), so
  pull each job out with `/api/export/U-NNNN.md?k=…` and land it in the vault. The KV copy is
  derived and reproducible; the markdown is the record.

---

## WHAT THE ONE-CLICK SCRIPT WAS AND WAS NOT TESTED AGAINST

`deploy-stage-1.ps1` was rehearsed against stand-in `wrangler`, `npm` and `git` commands
that reply with real Cloudflare output text, so the whole run was exercised end to end
without touching the account. What was proved: the happy path; a re-run doing nothing twice;
R2 not switched on; no workers.dev subdomain; a Worker that does not answer (and the site
correctly left alone); a refused `git push`; no git remote; nothing new to commit; Node.js
missing; the secrets file not being git-ignored (it refuses to write the passwords); and
Vercel being slow. Its output-parsing and file-editing functions have 52 assertions of their
own behind `-SelfTest`, covering three different shapes of `wrangler kv namespace create`
output and two of `wrangler deploy`.

**What could not be proved from here:** the real Cloudflare API, a real browser login, and
Windows PowerShell 5.1 itself — the rehearsal ran on PowerShell 7 on Linux. The script
deliberately uses no syntax newer than 5.1.

## RUNNING IT ON THIS MACHINE

```
cd worker
copy .dev.vars.example .dev.vars      (then fill it in)
npm install
npm run dev
```

`.dev.vars` is git-ignored and must never be committed.

To run the tests — a real `wrangler dev` with local storage, a real headless browser driving
the real `services.html`, and stand-in servers for FormSubmit, Pushover and Telegram so neither
your inbox nor your phone is touched (every alert secret in the run is a fresh fake):

```
npm test
```

---

## THINGS IT DOES, IN ONE TABLE

| address | who it is for | what it does |
|---|---|---|
| `POST /intake` | the site's form | makes the record, stores the photos, forwards the email, sends the customer on |
| `GET /api/job/U-NNNN?t=…` | the customer | their four steps, their photos, the scope and price once set |
| `GET /api/photo/U-NNNN/1?t=…` | the customer | their photo, served through us — the storage bucket is never public |
| `GET /admin?k=…` | Drew | the aging list with the three buttons |
| `GET /api/jobs?k=…` | Drew | the same list as data |
| `POST /api/job/U-NNNN/event?k=…` | Drew | the taps: `quoted`, `scheduled`, `done`, `note` |
| `GET /api/export/U-NNNN.md?k=…` | the vault | the job as markdown, fixed slots, blanks visible |
| `POST /admin/seen/U-NNNN?k=…` | Drew, the FC | "I have it": stops the alerts for that request (401 without the key) |
| `POST /hooks/pushover/SECRET` | Pushover | the Acknowledge tap; only a receipt the Worker issued is accepted |
| *(every 5 minutes)* | Drew's phone | the alert ladder in `src/alerts.js`: +15 urgent, every 30, OVERDUE at due; 9 PM–7 AM held to one 7:00 summary |

A wrong link and a link to a job that never existed answer identically, so a stranger
guessing cannot learn that a job exists.

---

## WHAT IS A GUESS, AND WHAT IS NOT TESTED HERE

**GUESSES — reversible in one sentence each:**

- **Pushover first, Telegram second** (ALERTS-01, from the research on
  `Bridge\SUPE\FLUX-UX-v1-2026-09-23.md` §5). Both senders are in `src/notify.js`; the
  ladder's minutes are constants at the top of `src/alerts.js`.
- **No link in any alert, and never the admin key** (R25). The Stage 1 push carried the key
  inside its link; that is gone.
- **10 MB per photo, 25 MB per request.** The page already shrinks photos to about 1600px,
  so a real phone photo lands far under this.
- **Ids are `U-NNNN`**, matching the job folders on disk (`U-0002-wills-ceiling`). The design
  document says `UD-26-NNNN`; the folders say `U-NNNN`. The folders won.

**NOT TESTED, and honestly so:**

- **The real FormSubmit, the real Pushover and the real Telegram.** All were stood up as
  local servers and the bytes they received were read and checked; neither the live relay
  nor a real phone was touched.
- **Real Cloudflare KV and R2.** Everything ran on the local emulation that ships with
  wrangler.
- **The cron firing on its own schedule.** The local runtime does not run schedules, so the
  job the schedule calls was run directly instead, with the clock moved forward. The
  `crons` line in `wrangler.toml` is untested until it is deployed.
- **A real phone camera.** The camera-capture and multi-photo code on the form pages was not
  altered and its behaviour is unchanged, but it was exercised through a desktop headless
  browser, not a handset.
- **KV's list is eventually consistent** on the real edge. A brand-new request may take up to
  a minute to appear in `/api/jobs`. It is on the record immediately — only the *list* lags.
  The intake alert does not depend on it; the alert ladder's next run is 5 minutes later.
- **There is no Spanish status page.** `es/recibido.html` links to the English `/status`,
  because `es/estado.html` does not exist. One line in `src/index.js` routes it when it does.
- **Job ids are allocated without a lock.** KV cannot increment atomically, so the allocator
  reads the counter, takes the next free number, and refuses one that is already taken. At
  one request an hour this is safe; at ten a second it would not be.
