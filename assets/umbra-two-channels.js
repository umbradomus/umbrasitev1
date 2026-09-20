/* ============================================================================
   UMBRA DOMUS — THE SECOND CHANNEL, SENT BY THE BROWSER (R28 · R28b · R30)

   WHY THIS EXISTS, MEASURED AND NOT ASSUMED. Every request the Worker has ever
   taken failed to send its email: U-0003 (William, real, 14 photos), U-0004 and
   U-0005, all three `forward_failed`, all three `status 429`. The cause is
   structural, not a bug — `worker/src/forward.js` sends the email FROM THE
   WORKER, so every submission on earth reaches FormSubmit from Cloudflare's
   shared address. One address for everybody, so FormSubmit rate-limits it.

   A browser-side send comes from the customer's own address with the customer's
   own headers, which is the shape FormSubmit is built for and the shape that
   worked for a year before the Worker existed. So this file does two things at
   once: it gives Drew the failsafe he asked for — if something happens to the
   Worker the data still reaches the email — and it repairs a channel that is
   dead right now.

   THE RULES, AS DREW RULED THEM:
     · THE EMAIL CARRIES EVERYTHING. Every field and every photo, not a
       details-only summary. Both channels send the SAME already-shrunk files
       the page prepared, so the two copies never disagree about what was sent.
     · EXACTLY ONE EMAIL PER JOB. The browser owns the email; the Worker's own
       forward becomes the FALLBACK. The form posts `email_sent=yes|no` and the
       Worker forwards only on `no`.
     · THE EMAIL GOES FIRST. It is the copy that must survive. If the Worker is
       unreachable, the email has already gone by the time we find out.
     · NO-JAVASCRIPT IS UNTOUCHED. The static `action` on the markup is still
       FormSubmit, so a no-JS submit reaches the email exactly as today.

   `yes` MEANS DELIVERED, NOT ATTEMPTED. A cross-origin `fetch` to FormSubmit
   cannot be read, so it could never tell us whether the mail went — which is
   the same blindness that let 429 run silently for a day. Instead the copy is
   posted by a real form into a hidden iframe with `_next` pointing at a page on
   OUR OWN origin. FormSubmit redirects there only after it has taken the
   submission. So the moment that iframe's URL becomes readable, the email is
   real; while it is unreadable, it is not. That read is the whole proof.
   ========================================================================== */
(function () {
  var forms = document.querySelectorAll('form.req');
  if (!forms.length) return;

  /* ONE PLACE for the address: /assets/umbra-endpoint.js publishes it. The
     override exists so the done-test can point either leg somewhere else. */
  var EMAIL_ACTION = String(window.UMBRA_EMAIL_ACTION || '');
  if (!EMAIL_ACTION) return;

  var OK_PATH = String(window.UMBRA_EMAIL_OK_PATH || '/assets/email-copy-ok.html');
  /* EMAIL-01 (2026-09-20): was 25000. U-0006 sat 21 s on this leg before the
     real post began — longer than a person waits. 8 s is the ceiling now; a
     copy that has not redirected home by then is reported `no` and the
     Worker's fallback fires. The number spent here is posted as email_copy_ms
     and, since EMAIL-01, kept on the record. */
  var CAP_MS  = Number(window.UMBRA_EMAIL_CAP_MS || 8000);
  var OK_URL  = location.origin + OK_PATH;

  var nativeSubmit = HTMLFormElement.prototype.submit;

  /* A correlation id the collector can match on. The job number is minted by
     the Worker AFTER this send, so the email cannot carry one — and a backup
     the collector cannot match to a record is an archive, not a failsafe. Both
     copies carry this instead. */
  function copyId() {
    var d = new Date();
    function p(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
    return 'BC-' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' +
           p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z-' +
           Math.random().toString(36).slice(2, 8);
  }

  function hidden(name, value) {
    var el = document.createElement('input');
    el.type = 'hidden'; el.name = name; el.value = String(value);
    return el;
  }

  function setField(form, name, value) {
    var el = form.querySelector('input[type="hidden"][name="' + name + '"]');
    if (!el) { el = hidden(name, value); form.appendChild(el); }
    else { el.value = String(value); }
  }

  function isFile(v) {
    return v && typeof v === 'object' && 'size' in v && 'name' in v;
  }

  /* THE EMAIL LEG. `done(true)` only when FormSubmit redirected us home. */
  function sendEmailCopy(form, id, done) {
    var settled = false, frame = null, temp = null, timer = null;

    function finish(ok) {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      try { if (temp && temp.parentNode) temp.parentNode.removeChild(temp); } catch (e) {}
      /* the iframe is left in place briefly so a late response is not aborted */
      setTimeout(function () {
        try { if (frame && frame.parentNode) frame.parentNode.removeChild(frame); } catch (e) {}
      }, 2000);
      done(ok);
    }

    try {
      var name = 'umbra-email-' + Math.random().toString(36).slice(2);
      frame = document.createElement('iframe');
      frame.name = name;
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0';
      document.body.appendChild(frame);

      temp = document.createElement('form');
      temp.method = 'POST';
      temp.action = EMAIL_ACTION;
      temp.enctype = 'multipart/form-data';
      temp.acceptCharset = 'UTF-8';
      temp.target = name;
      temp.style.display = 'none';

      /* The submission, part for part, in order — the same FormData the real
         post is about to send, including every `attachment1..N` the page built
         from the already-shrunk photos. */
      var fd = new FormData(form);
      var keys = [];
      fd.forEach(function (value, key) {
        if (key === '_next') return;             /* replaced below, so we can read the answer */
        if (isFile(value)) {
          if (!value.size) return;               /* an empty file slot is not a photo */
          var dt = new DataTransfer();
          dt.items.add(value);
          var fi = document.createElement('input');
          fi.type = 'file'; fi.name = key; fi.files = dt.files;
          if (fi.files.length !== 1) throw new Error('one photo per field');
          temp.appendChild(fi);
        } else {
          temp.appendChild(hidden(key, value));
        }
        keys.push(key);
      });
      if (!keys.length) throw new Error('nothing to send');

      temp.appendChild(hidden('_next', OK_URL));
      temp.appendChild(hidden('sent_by', 'browser-direct'));
      temp.appendChild(hidden('browser_copy_id', id));

      frame.onload = function () {
        var href = '';
        try { href = String(frame.contentWindow.location.href || ''); } catch (e) { href = ''; }
        if (href === 'about:blank' || href === '') {
          /* Still on FormSubmit (cross-origin, so unreadable) — the request
             finished and did NOT redirect home. Not a delivery. */
          if (href === 'about:blank') return;    /* the empty frame's own first load */
          finish(false);
          return;
        }
        finish(href.indexOf(OK_URL) === 0);
      };
      frame.onerror = function () { finish(false); };

      document.body.appendChild(temp);
      temp.submit();
      timer = setTimeout(function () { finish(false); }, CAP_MS);
    } catch (err) {
      /* Could not build the copy — say `no` so the Worker's fallback fires.
         Never both, never neither. */
      finish(false);
    }
  }

  function busyButton(form) {
    var btn = form.querySelector('button[type="submit"]');
    if (btn && !btn.disabled) { btn.disabled = true; btn.textContent = 'Sending…'; }
  }

  function twoChannel(form, proceed) {
    var action = String(form.getAttribute('action') || '');
    /* Already posting to the email: there is one channel and it IS the email. */
    if (!action || action.indexOf('formsubmit.co') !== -1) { proceed(); return; }
    if (form.__umbraEmailLeg) { proceed(); return; }
    form.__umbraEmailLeg = true;
    busyButton(form);
    var id = copyId();
    setField(form, 'email_copy_id', id);
    var t0 = Date.now();
    sendEmailCopy(form, id, function (ok) {
      setField(form, 'email_sent', ok ? 'yes' : 'no');
      setField(form, 'email_copy_ms', String(Date.now() - t0));
      proceed();
    });
  }

  for (var i = 0; i < forms.length; i++) {
    (function (form) {
      /* 1 · the photo block finishes its shrink and calls form.submit() itself,
         which fires no submit event. That call lands here. */
      form.submit = function () {
        var self = this;
        twoChannel(self, function () { nativeSubmit.call(self); });
      };
      /* 2 · a submit with no photos never reaches the photo block's own path.
         The photo block's listener is registered first (it is inline in the
         page) so when it takes the submit it has already prevented the default
         by the time we are called, and we leave it alone. */
      form.addEventListener('submit', function (e) {
        if (e.defaultPrevented) return;
        if (form.__umbraEmailLeg) return;
        e.preventDefault();
        twoChannel(form, function () { nativeSubmit.call(form); });
      });
    })(forms[i]);
  }
})();
