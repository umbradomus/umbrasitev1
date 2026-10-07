/* ============================================================================
   UMBRA DOMUS — WHAT THEY GAVE, CARRIED TO THE THANK-YOU PAGE (road W, 2026-09-26)

   His Walk 1: "i dont remember what email i put i think i just put a phone number in". So the form's contact
   step asks for both side by side (phone, and an optional email for their copy), the last screen says back
   what was given, and the thank-you page says "Drew will text you at (956) 555-0147 by 9:00 AM" with their
   times and where their copy went.

   THE NUMBER NEVER LEAVES THIS BROWSER BY THIS ROUTE. It is kept in this tab's own session memory
   (sessionStorage) on the form page and read back on the thank-you page — never put in the address, never
   fetched from the Worker. Another device, or a tab that never had the form, finds nothing and the page
   says "Drew will text you by 9:00 AM".

   ON THE FORM PAGE (services, es/servicios), when Send is tapped:
     · the memory: first name, the phone and email exactly as typed, the texts box, their picks in the page's
       own words, "flexible", how many photos
     · THE CUSTOMER'S COPY: an email given → a hidden `_autoresponse` carrying their request in plain words,
       which FormSubmit sends to the `email` field's address; no email → no `email` field is posted at all,
       so the relay is never handed an empty address
     · when the browser's own copy to FormSubmit settles, whether it went (`email_sent`) is added to the memory
   ON THE THANK-YOU PAGE: UmbraSent.read(id) and UmbraSent.due(now) — the same two-hour reply clock the Worker's
   alert uses (business minutes, 7 AM–9 PM on Chicago's own clock).

   This file must load BEFORE /assets/umbra-two-channels.js on the form pages: its Send listener has to have
   written the copy's words before the email leg reads the form.
   ========================================================================== */
(function () {
  var KEY = 'umbra.sent.v1';
  var FRESH_MS = 12 * 3600000;
  var ES = (document.documentElement.getAttribute('lang') || '').toLowerCase().indexOf('es') === 0;

  function load() {
    try { var m = JSON.parse(window.sessionStorage.getItem(KEY) || 'null'); return m && typeof m === 'object' ? m : null; }
    catch (e) { return null; }
  }
  function keep(m) {
    try { window.sessionStorage.setItem(KEY, JSON.stringify(m)); } catch (e) { /* private mode: the page falls back */ }
  }

  /* ---------------------------------------------------------------- the reply clock (biztime.js, in the browser) */
  var TZ = 'America/Chicago', OPEN_H = 7, CLOSE_H = 21, REPLY_MIN = 120;
  var FMT = null;
  try {
    FMT = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) { FMT = null; }
  function parts(ms) {
    var p = FMT.formatToParts(new Date(ms)), o = {};
    for (var i = 0; i < p.length; i++) o[p[i].type] = parseInt(p[i].value, 10);
    return { y: o.year, mo: o.month, d: o.day, h: (o.hour || 0) % 24, mi: o.minute, s: o.second };
  }
  function offsetMin(ms) {
    var c = parts(ms);
    return Math.round((Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s) - Math.floor(ms / 1000) * 1000) / 60000);
  }
  function wall(y, mo, d, h, mi) {
    var guess = Date.UTC(y, mo - 1, d, h, mi || 0);
    var t = guess - offsetMin(guess) * 60000;
    return guess - offsetMin(t) * 60000;
  }
  function bizAdvance(from, minutes) {
    var t = from, left = minutes;
    for (var guard = 0; guard < 400 && left > 0; guard++) {
      var c = parts(t);
      if (c.h < OPEN_H) { t = wall(c.y, c.mo, c.d, OPEN_H, 0); continue; }
      if (c.h >= CLOSE_H) { t = wall(c.y, c.mo, c.d + 1, OPEN_H, 0); continue; }
      var close = wall(c.y, c.mo, c.d, CLOSE_H, 0), today = (close - t) / 60000;
      if (left <= today) { t += Math.round(left * 60000); left = 0; } else { t = close; left -= today; }
    }
    return t;
  }
  function words(h, mi) {
    var h12 = ((h + 11) % 12) + 1, mm = (mi < 10 ? '0' : '') + mi;
    return ES ? (h12 === 1 ? 'la ' : 'las ') + h12 + ':' + mm + ' ' + (h < 12 ? 'a.m.' : 'p.m.')
      : h12 + ':' + mm + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  /** When the reply is due: { at: "9:00 AM" | "las 9:00 a.m.", tomorrow, shifted } — two business
      hours from now. SITE-FIX-15 B: shifted is true when that is LATER than two hours from now -
      the shop was closed and the wait was pushed to the morning. The reply-by line and the Send
      button both read it from this one return, so they can never name two different times. */
  function due(nowMs) {
    if (FMT) {
      try {
        var d = bizAdvance(nowMs, REPLY_MIN), a = parts(d), n = parts(nowMs);
        return { at: words(a.h, a.mi), tomorrow: a.y !== n.y || a.mo !== n.mo || a.d !== n.d,
          shifted: d - nowMs > REPLY_MIN * 60000 + 60000 };
      } catch (e) { /* the phone's own clock below */ }
    }
    /* no time zones on this phone: the old clamp on its own clock */
    var now = new Date(nowMs), by = new Date(nowMs + REPLY_MIN * 60000);
    var close = new Date(now.getFullYear(), now.getMonth(), now.getDate(), CLOSE_H, 0, 0, 0);
    var early = now.getHours() < OPEN_H;
    if (early || by > close) by = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (early ? 0 : 1), OPEN_H, REPLY_MIN, 0, 0);
    return { at: words(by.getHours(), by.getMinutes()), tomorrow: by.getDate() !== now.getDate(),
      shifted: by.getTime() - nowMs > REPLY_MIN * 60000 + 60000 };
  }

  /** The memory for this request, or null. The first thank-you page that reads it ties it to its request number,
      so a later request in the same tab never shows an earlier one's number. */
  function read(id) {
    var m = load();
    if (!m || !m.at || Date.now() - m.at > FRESH_MS || !m.phone) return null;
    if (id) {
      if (m.id && m.id !== id) return null;
      if (!m.id) { m.id = id; keep(m); }
    }
    return m;
  }

  window.UmbraSent = { read: read, due: due };

  /* ================================================================ the form page */
  var form = document.querySelector('form.req');
  if (!form || !form.querySelector('[data-intake2]')) return;
  var phoneEl = form.querySelector('[name="phone"]');
  var emailEl = form.querySelector('[name="email"]');
  var consentEl = form.querySelector('[name="sms_consent"]');
  var sum = form.querySelector('[data-contact-sum]');

  var T = ES ? {
    text: 'Drew le manda mensajes de texto al', call: 'Drew le llama al', copy: 'Su copia va a',
    noEmail: 'No dio correo electrónico', none: '—'
  } : {
    text: 'Drew texts you at', call: 'Drew calls you at', copy: 'Your copy goes to',
    noEmail: 'No email given', none: '—'
  };

  function val(el) { return el ? String(el.value || '').trim() : ''; }
  function row(dt, dd) {
    var d = document.createElement('div');
    var a = document.createElement('dt'); a.textContent = dt;
    var b = document.createElement('dd'); b.textContent = dd;
    d.appendChild(a); d.appendChild(b);
    return d;
  }
  /* the last screen says back exactly what was given */
  function drawSum() {
    if (!sum) return;
    sum.innerHTML = '';
    var phone = val(phoneEl), email = val(emailEl);
    sum.appendChild(row(consentEl && !consentEl.checked ? T.call : T.text, phone || T.none));
    sum.appendChild(email ? row(T.copy, email) : row(T.noEmail, ES ? 'No se envía copia.' : 'No copy will be emailed.'));
  }
  form.addEventListener('input', drawSum);
  form.addEventListener('change', drawSum);
  drawSum();

  function picks() {
    var out = [], els = form.querySelectorAll('[data-wpicks] .wpt');
    for (var i = 0; i < els.length; i++) out.push(String(els[i].textContent || '').trim());
    return out;
  }
  function photoCount() {
    return form.querySelectorAll('[data-photo-list] li').length;
  }
  function hidden(name) {
    var el = form.querySelector('input[type="hidden"][name="' + name + '"]');
    if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.name = name; form.appendChild(el); }
    return el;
  }
  function drop(name) {
    var el = form.querySelector('input[type="hidden"][name="' + name + '"]');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* the customer's copy, in plain words and their language — what FormSubmit's autoresponse sends them */
  function copyText(m, address, what) {
    var L = [];
    if (ES) {
      L.push('Gracias. Esta es su copia de la solicitud que envió a Umbra Domus.');
      L.push('');
      L.push((m.consent === false ? 'Drew le llamará al ' : 'Drew le enviará un mensaje de texto al ') + m.phone + ' en menos de 2 horas, de 7 a.m. a 9 p.m.');
      if (m.times.length) L.push('Horarios que le funcionan: ' + m.times.join('; ') + (m.flexible ? ' (o cualquier horario)' : ''));
      else if (m.flexible) L.push('Horarios: cualquier horario le funciona.');
      if (address) L.push('Dirección: ' + address);
      if (what) L.push('Lo que escribió: ' + what);
      if (m.photos) L.push('Fotos: ' + m.photos);
      L.push('');
      L.push('¿Preguntas? Mande un mensaje de texto o llame al (956) 556-6438.');
    } else {
      L.push('Thank you. This is your copy of the request you sent Umbra Domus.');
      L.push('');
      L.push((m.consent === false ? 'Drew will call you at ' : 'Drew will text you at ') + m.phone + ' within 2 hours, 7am-9pm.');
      if (m.times.length) L.push('Times that work for you: ' + m.times.join('; ') + (m.flexible ? ' (or any time)' : ''));
      else if (m.flexible) L.push('Times: any time works for you.');
      if (address) L.push('Address: ' + address);
      if (what) L.push('What you wrote: ' + what);
      if (m.photos) L.push('Photos: ' + m.photos);
      L.push('');
      L.push('Questions? Text or call (956) 556-6438.');
    }
    return L.join('\n');
  }

  /* SEND: the memory and the copy, before the email leg reads the form (this listener is registered first) */
  form.addEventListener('submit', function () {
    try {
      var nameEl = form.querySelector('[name="name"]');
      var first = nameEl ? String(nameEl.value || '').trim().split(/\s+/)[0] || '' : '';
      var flexEl = form.querySelector('[name="avail_flexible"]');
      var m = {
        at: Date.now(), lang: ES ? 'es' : 'en', id: null,
        first: first.slice(0, 40),
        phone: phoneEl ? String(phoneEl.value || '').trim() : '',          /* exactly as they typed it */
        email: val(emailEl),
        consent: consentEl ? Boolean(consentEl.checked) : null,
        times: picks(),
        flexible: Boolean(flexEl && flexEl.checked),
        photos: photoCount(),
        copy: null
      };
      keep(m);
      if (m.email) {
        var addrEl = form.querySelector('[name="address"]'), whatEl = form.querySelector('[name="what"]');
        var what = whatEl ? String(whatEl.value || '').replace(/\s+/g, ' ').trim() : '';
        hidden('_autoresponse').value = copyText(m, val(addrEl), what.length > 1000 ? what.slice(0, 1000) + '…' : what);
      } else {
        drop('_autoresponse');
        /* a browser too old to let the entries be trimmed (no formdata event) simply does not post the empty box */
        if (emailEl && typeof window.FormDataEvent === 'undefined') emailEl.disabled = true;
      }
    } catch (e) { /* the request matters more than the memory */ }
  });

  /* Every time the form's entries are gathered (the email leg's copy, then the real post): an empty email is not
     posted at all, and the email leg's verdict (`email_sent`) is added to the memory. */
  form.addEventListener('formdata', function (e) {
    try {
      var fd = e.formData;
      if (fd.has('email') && !String(fd.get('email') || '').trim()) fd['delete']('email');
      var sent = fd.get('email_sent');
      var n = 0;
      fd.forEach(function (v, k) { if (/^attachment\d+$/.test(k) && v && typeof v === 'object' && v.size > 0) n++; });
      var m = load();
      if (m && !m.id) {
        if (sent === 'yes' || sent === 'no') m.copy = sent;
        if (n) m.photos = n;
        keep(m);
      }
    } catch (err) { /* nothing here may stop the post */ }
  });
})();
