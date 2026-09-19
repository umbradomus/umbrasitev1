# R28 · THE TWO-CHANNEL DONE-TEST

**The clause the round exists for, and it cannot be simulated:** *point the page's
endpoint at a dead host, submit, and prove an email still arrives.* This runs it.

The rig serves a **scratch copy** of the site with the one line in
`assets/umbra-endpoint.js` re-pointed at two endpoints it can watch — and, for the
dead-host run, at `http://127.0.0.1:1`, which refuses the connection. Then a real
browser fills the real form and presses the real button. The fake Worker mirrors
`worker/src/index.js` §3 exactly: the browser owns the email, the Worker's forward
fires only on `email_sent != yes`, so the email count end to end is the real one.

    node tools/r28-done-test/test.mjs

Needs Playwright and a Chromium, which is why it runs in a Claude container rather
than on the machine. Site path is `SITE` at the top of `rig.mjs`.

**What it must print — 12 of 12, and the two that matter are the dead-host pair:**
exactly one email with the Worker up, exactly one with the Worker at a dead host
(carrying the photos), exactly one with no photos, exactly one with JavaScript off.
