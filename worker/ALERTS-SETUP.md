# THE PHONE KNOWS — setting up the alerts (your part, once)

When someone fills in the form, three things now reach your work phone:

1. **Pushover** (the main one). It pings the minute the request lands. If 15 minutes go by and you
   have not tapped **Acknowledge**, it rings every 2 minutes for half an hour, even through Do Not
   Disturb. After that, one reminder every 30 minutes, and one **OVERDUE** alert when the 2-hour
   reply is due. Then it stops.
2. **Telegram** (the backup). The same alerts, from a bot that messages only you.
3. **Email** (already built). The form's email still goes straight from the customer's browser.
   Step C below makes that email ring the phone too, so **you still get pinged if the Worker is
   down**.

Nothing is sent between 9 PM and 7 AM. At 7:00 AM you get **one summary** of everything that came in
overnight. If a visit is on the calendar before those replies are due, the summary rings like an
urgent alert and says **"quote before you leave."**

No alert has a link in it. The request waits for you on the computer.

**To stop the alerts for a request, do any one of these:** tap **Acknowledge** in Pushover, tap
**Quoted** (or Scheduled, or Done) on the admin page, or have the Flux Capacitor mark it seen.

About 20 minutes in all. You need the work phone and the computer.

---

## A · Pushover on the work phone (about 8 minutes)

1. On the work phone, install **Pushover** from the Play Store. The first 30 days are free. After
   that it costs **$4.99, paid once**, inside the app.
2. Open it and create your account. Pushover shows you your **User Key**, a long string of letters
   and numbers. You will copy it into the paste file in step E.
3. On the computer, go to **pushover.net**, sign in, and click **Create an Application/API Token**.
   Name it **Umbra Alerts**, tick the box to agree, and click **Create Application**. Pushover shows
   you the **API Token**. You will copy it into the paste file in step E.
4. **Let it through Do Not Disturb.** On the phone: **Settings → Notifications → Do Not Disturb →
   Apps → add Pushover**. (On the moto g power this is under **Settings → Sound → Do Not Disturb**.)
   Then in the Pushover app, open **Settings** and turn on **Override Do Not Disturb** for
   **Emergency priority** alerts.
5. **Stop the phone from putting it to sleep.** **Settings → Apps → Pushover → Battery → Unrestricted**.
   Without this, Android can delay the alert by many minutes.
6. Test it: on pushover.net, send yourself a message from the box on your dashboard. The phone
   should buzz within a few seconds.

## B · The Telegram bot (about 5 minutes)

1. Install **Telegram** on the work phone if it is not there yet, and sign in.
2. In Telegram, search for **@BotFather** (the one with the blue check mark) and open it.
3. Send it `/newbot`. When it asks for a name, send **Umbra Alerts**. When it asks for a username,
   send something that ends in `bot`, for example **umbra_alerts_drew_bot**.
4. BotFather answers with a **token**, a long line that looks like `123456789:AA...`. You will copy
   it into the paste file in step E. **Anyone who has this token can send messages as the bot**, so
   keep it out of chats and screenshots.
5. Tap the link BotFather gives you to your new bot, and tap **Start**. **The bot cannot message you
   until you do this.**
6. Get your **chat id**, once. On the computer, open this address in the browser, putting your
   token in place of `THE-TOKEN`:

   `https://api.telegram.org/botTHE-TOKEN/getUpdates`

   Find `"chat":{"id":` on the page. The number after it is your **chat id** (for example
   `812345678`). You will copy it into the paste file in step E. If the page shows `"result":[]`,
   send the bot any message such as "hi", then reload the page.
   Do this **before** anything else is connected to the bot. It only works while the bot has no
   webhook, and the Worker never sets one.

## C · The Gmail filter: email reaches the phone even if the Worker is down (about 5 minutes)

This makes Gmail forward every form email to Pushover, so the phone rings **even if you are not
logged into that inbox** and **even if the Worker is down**.

1. Find your **Pushover email address**. In the Pushover app: **Settings → E-mail Gateway**. It looks
   like `something@pomail.net`.
2. On the computer, open the Gmail account that receives the form emails (the Umbra inbox).
3. **Settings (gear) → See all settings → Forwarding and POP/IMAP → Add a forwarding address.**
   Enter the Pushover address and click **Next → Proceed → OK**.
4. Gmail sends a confirmation to that address, so it arrives **on your phone as a Pushover alert**.
   Open it, find the **confirmation code** (or tap the confirmation link), and enter the code back
   in Gmail's Forwarding page. Click **Verify**.
5. **Do not** turn on "Forward a copy of incoming mail" for everything. Make a filter instead.
   In the Gmail search bar, click the **show search options** icon and fill in only:
   - **Subject:** `umbradomus.com`

   Every form on the site puts that in the subject line: "Service request from umbradomus.com",
   the Spanish "Solicitud de servicio (español) desde umbradomus.com", "New contact from
   umbradomus.com", and "Homes waiting list from umbradomus.com".
   Click **Create filter**, tick **Forward it to:**, pick the Pushover address, and click
   **Create filter**.
6. Test it: send a request through the website form. Within a minute you should get the Pushover
   alert from the Worker, the Telegram message, **and** a Pushover alert from the forwarded email.

## D · The Pushover callback secret

Make one more long random string. Pushover uses it when you tap **Acknowledge** to tell the Worker
you have seen the alert. On the computer, in PowerShell:

```
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Copy what it prints. That is your **HOOK_SECRET**.

## E · The paste file: your keys stay yours

Put the five values in one plain text file. Keep it on your own computer, **outside the website
folder**, for example `C:\Users\andre\Documents\umbra-alert-keys.txt`:

```
PUSHOVER_TOKEN=   (the API Token from A.3)
PUSHOVER_USER=    (the User Key from A.2)
TELEGRAM_BOT_TOKEN=   (the token from B.4)
TELEGRAM_CHAT_ID=     (the number from B.6)
HOOK_SECRET=      (the string from D)
```

No seat, coder or agent ever reads this file. You type or paste each value yourself.

## F · Give the five secrets to Cloudflare (your hand)

In PowerShell, in the `worker` folder of the website repo, run these five commands, one at a time.
Each one asks for a value. **Paste the value from your file, then press Enter.**

```
npx wrangler secret put PUSHOVER_TOKEN
npx wrangler secret put PUSHOVER_USER
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put HOOK_SECRET
```

The old push service's secret is no longer used. The close of round ALERTS-01 names it and gives the
one line that deletes it. `npx wrangler secret list` shows what is stored.

Then deploy the Worker the usual way (see the close of round ALERTS-01 for the exact route). From then
on every form submission pings the phone.

## If something does not ring

- **No Pushover alert at all:** check A.5 (battery set to Unrestricted) and that the User Key and API
  Token were pasted without spaces.
- **Pushover rings but Telegram is silent:** you probably did not tap **Start** on the bot (B.5), or
  the chat id is wrong. Open `getUpdates` again (B.6).
- **Nothing from the Worker, but the forwarded email rings:** that is the backup doing its job. The
  Worker or its secrets need a look. The request is safe in the inbox.
