/* ============================================================================
   UMBRA DOMUS — THE ADDRESS IS A REAL ADDRESS, CONFIRMED BY A TAP.
   ONE MODULE, TWO PROVIDERS BEHIND ONE INTERFACE. (SITE-FIX-01, 2026-09-28)

   His words: "when you type the address in that we can actually pull a reall
   address from google maps up. right now you can just type afdsjohgaeojuhfhioasd
   as an addresss. people will probably make mistakes and type the address wrong.
   we need to make sure an address pops up they can click on and confirm its the
   real address before form is submitted".

   THE TWO PROVIDERS
     (a) GOOGLE — only when a key is present. THE KEY IS DREW'S HAND. It is not in
         this round, it is never typed by a coder and never guessed. The page reads
         it from exactly ONE place: `window.UMBRA_PLACES_KEY`, set in /site.config.js,
         which ships EMPTY. That file is the whole hand-off: put the key there and
         Google's suggestions turn on by themselves, everywhere, in both languages.
     (b) NO KEY — what ships today. The field will not take "afdsjohgaeojuhfhioasd":
         it needs a house number, a street, and a ZIP or a town. Then the page asks
         the US Census Bureau's free, key-less geocoder and shows what it found.

   THE CENSUS GEOCODER HAS NO CORS. It must never be reached with fetch() or
   XMLHttpRequest — the browser refuses the answer and the customer sees nothing.
   It is reached with JSONP only: a <script> tag with a random callback name, an
   8-second timeout, and a shape check on whatever comes back. Nothing from that
   answer is ever put on the page as HTML — only with textContent.

   WHAT THE WORKER RECEIVES
     address             the confirmed address, in the field it has always been in
     address_confirmed   google | census | typed   (ADDED)
     address_place_id    when Google knew it       (ADDED)
     lat, lng            when a provider knew them (ADDED)
   Added, never renamed.

   SITE-FIX-01.1 · NOTHING SENDS UNTIL "YES, THAT'S IT", ON EVERY PATH.
   THE OLD ASSERTION (SITE-FIX-01, and the header that stood here): the tap was
   asked for and flagged, but it was NOT a hard block on Send, because suite F read
   the four plain form pages against a frozen record of the bytes they post and a
   screen they could not pass would have changed it.
   THE NEW ONE: the tap is a hard block on the SEND itself, on every page that
   carries a request form — the wizard and the two plain pages alike. A plausible
   but unconfirmed address cannot leave any page.
   THE WORDS THAT REQUIRE IT (Drew, 09-28): "we need to make sure an address pops up
   they can click on and confirm its the real address BEFORE FORM IS SUBMITTED."
   D-CEO-61 re-cut suite F on those words; its four pages now post the confirmed
   address. The gate is a CAPTURE-phase listener on the document so that it runs
   before a page's own submit handler can take the request away.

   THE JOURNEY TRAVELS WITH EVERY REQUEST TOO — `lang` at load, `started_at` the
   first time the customer touches the form, `sent_at` at the moment it leaves. One
   place, this file, for every form on the site; the chooser used to stamp them for
   itself and no longer does.
   ========================================================================== */
(function () {
  'use strict';

  /* THE BROWNSVILLE-AREA ZIPs — one place, easy to grow. */
  var LOCAL_ZIPS = ['78520', '78521', '78526', '78575', '78566', '78586'];
  var CENSUS_HOST = 'https://geocoding.geo.census.gov';
  var JSONP_MS = 8000;

  var ES = (document.documentElement.getAttribute('lang') || '').toLowerCase().indexOf('es') === 0;
  var T = ES ? {
    ask: '¿Es este el lugar?',
    yes: 'Sí, es aquí',
    no: 'No, déjeme corregirlo',
    looking: 'Buscando la dirección…',
    noMatch: 'No la encontramos en el mapa. Revise que esté bien escrita — si está bien, confírmela como la escribió.',
    needMore: 'Necesitamos el número de la casa, la calle, y el código postal o la ciudad.',
    confirmed: 'Dirección confirmada.',
    notYet: 'Todavía falta confirmar la dirección.',
    typedNote: 'Confirmada como la escribió.'
  } : {
    ask: 'Is this the place?',
    yes: "Yes, that's it",
    no: 'No, let me fix it',
    looking: 'Looking up the address…',
    noMatch: "We couldn't find it on the map. Check the spelling — if it's right, confirm it as you typed it.",
    needMore: 'We need the house number, the street, and a ZIP or a town.',
    confirmed: 'Address confirmed.',
    notYet: 'The address still needs confirming.',
    typedNote: 'Confirmed as you typed it.'
  };

  /* ------------------------------------------------------------------ plausibility
     "afdsjohgaeojuhfhioasd" fails here and never gets past the address screen.
     A house number, a street word, and either a 5-digit ZIP or a town. */
  function parse(raw) {
    var s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (s.length < 8) return null;
    var num = /(^|\s)(\d{1,6}[A-Za-z]?)\s+\S/.exec(s);
    if (!num) return null;
    var zip = /\b(\d{5})(?:-\d{4})?\b/.exec(s.slice(num.index + num[0].length - 1));
    var rest = s.slice(s.indexOf(num[2]) + num[2].length).trim();
    /* the street is what sits between the number and the first comma */
    var street = rest.split(',')[0].trim();
    if (!/[A-Za-z]{2,}/.test(street)) return null;
    var town = '';
    var bits = s.split(',');
    if (bits.length > 1) town = bits[1].replace(/\b(TX|Texas)\b/ig, '').replace(/\b\d{5}(-\d{4})?\b/g, '').replace(/\s+/g, ' ').trim();
    if (!zip && !town) return null;
    return { full: s, number: num[2], street: num[2] + ' ' + street, zip: zip ? zip[1] : '', town: town };
  }

  function plausible(raw) { return !!parse(raw); }
  function isLocalZip(zip) { return LOCAL_ZIPS.indexOf(String(zip || '')) > -1; }

  /* the address said back the way a person writes it */
  function tidy(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim().replace(/\s*,\s*/g, ', ')
      .replace(/[A-Za-zÁÉÍÓÚÑÜáéíóúñü][\wÁÉÍÓÚÑÜáéíóúñü'']*/g, function (w) {
        if (/^(TX|USA|NE|NW|SE|SW|N|S|E|W)$/i.test(w)) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      });
  }

  /* ------------------------------------------------------------------ JSONP, never fetch/XHR
     The Census geocoder answers no cross-origin request. A script tag is the only way in. */
  var jsonpN = 0;
  function jsonp(url, done) {
    var name = 'umbraGeo' + (Date.now() % 100000) + '_' + (++jsonpN) + '_' +
               Math.floor(Math.random() * 1e6);
    var s = document.createElement('script');
    var timer = null, over = false;
    function finish(err, data) {
      if (over) return;
      over = true;
      if (timer) clearTimeout(timer);
      try { delete window[name]; } catch (e) { window[name] = undefined; }
      if (s.parentNode) s.parentNode.removeChild(s);
      done(err, data);
    }
    window[name] = function (data) { finish(null, data); };
    timer = setTimeout(function () { finish('timeout', null); }, JSONP_MS);
    s.onerror = function () { finish('error', null); };
    s.src = url + (url.indexOf('?') > -1 ? '&' : '?') + 'callback=' + name;
    (document.head || document.documentElement).appendChild(s);
  }

  /* what a Census answer must look like before a single word of it is believed */
  function firstMatch(data) {
    if (!data || typeof data !== 'object') return null;
    var r = data.result;
    if (!r || typeof r !== 'object') return null;
    var list = r.addressMatches;
    if (!Array.isArray(list) || !list.length) return null;
    var m = list[0];
    if (!m || typeof m !== 'object' || typeof m.matchedAddress !== 'string' || !m.matchedAddress) return null;
    var c = m.coordinates && typeof m.coordinates === 'object' ? m.coordinates : null;
    var lat = c && typeof c.y === 'number' && isFinite(c.y) ? c.y : null;
    var lng = c && typeof c.x === 'number' && isFinite(c.x) ? c.x : null;
    return { address: m.matchedAddress, lat: lat, lng: lng };
  }

  function censusLookup(bits, done) {
    var base = (window.UMBRA_CENSUS_BASE || CENSUS_HOST) + '/geocoder/locations/';
    var url;
    if (bits.zip) {
      url = base + 'address?street=' + encodeURIComponent(bits.street) +
            '&zip=' + encodeURIComponent(bits.zip) + '&benchmark=Public_AR_Current&format=jsonp';
    } else {
      url = base + 'onelineaddress?address=' +
            encodeURIComponent(bits.street + ', ' + bits.town + ', TX') +
            '&benchmark=Public_AR_Current&format=jsonp';
    }
    jsonp(url, function (err, data) {
      if (err) return done(err, null);
      done(null, firstMatch(data));
    });
  }

  /* ------------------------------------------------------------------ Google, only with a key
     Built against a stub in the suite. With no key this branch never runs, and no
     Google script is ever added to the page. */
  function googleReady() {
    return !!(window.google && window.google.maps && window.google.maps.places);
  }
  function loadGoogle(key, done) {
    if (googleReady()) return done(true);
    if (window.__umbraGoogleLoading) { window.__umbraGoogleLoading.push(done); return; }
    window.__umbraGoogleLoading = [done];
    var cb = 'umbraPlacesReady';
    window[cb] = function () {
      var q = window.__umbraGoogleLoading || [];
      window.__umbraGoogleLoading = null;
      for (var i = 0; i < q.length; i++) q[i](googleReady());
    };
    var s = document.createElement('script');
    s.async = true;
    s.src = (window.UMBRA_PLACES_BASE || 'https://maps.googleapis.com/maps/api/js') +
            '?key=' + encodeURIComponent(key) + '&libraries=places&callback=' + cb;
    s.onerror = function () {
      var q = window.__umbraGoogleLoading || [];
      window.__umbraGoogleLoading = null;
      for (var i = 0; i < q.length; i++) q[i](false);
    };
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------------ the module the page uses */
  /* every card this page put up, so the send gate below can ask it whether the
     customer has tapped "Yes, that's it" yet */
  var ATTACHED = [];

  function attach(opts) {
    var input = opts.input, host = opts.host, onChange = opts.onChange || function () { };
    if (!input || !host) return null;

    var state = { confirmed: false, how: '', address: '', place_id: '', lat: null, lng: null };
    var lastAsked = '';
    var box = document.createElement('div');
    box.className = 'uaddr';
    host.appendChild(box);

    var sugList = document.createElement('ul');
    sugList.className = 'uaddr-sug';
    sugList.hidden = true;
    host.insertBefore(sugList, box);

    function say(cls, text) {
      box.className = 'uaddr ' + cls;
      box.textContent = '';
      var p = document.createElement('p');
      p.className = 'uaddr-line';
      p.textContent = text;
      box.appendChild(p);
    }
    function clear() { box.className = 'uaddr'; box.textContent = ''; }

    function card(address, how, extra) {
      box.className = 'uaddr uaddr-card';
      box.setAttribute('data-uaddr-card', '1');
      box.textContent = '';
      var h = document.createElement('p');
      h.className = 'uaddr-ask';
      h.textContent = T.ask;
      var a = document.createElement('p');
      a.className = 'uaddr-found';
      a.setAttribute('data-uaddr-found', '1');
      a.textContent = address;
      box.appendChild(h);
      box.appendChild(a);
      if (extra) {
        var n = document.createElement('p');
        n.className = 'uaddr-note';
        n.textContent = extra;
        box.appendChild(n);
      }
      var row = document.createElement('div');
      row.className = 'uaddr-row';
      var yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'btn uaddr-yes';
      yes.setAttribute('data-uaddr-yes', '1');
      yes.textContent = T.yes;
      var no = document.createElement('button');
      no.type = 'button';
      no.className = 'btn ghost uaddr-no';
      no.setAttribute('data-uaddr-no', '1');
      no.textContent = T.no;
      yes.addEventListener('click', function () {
        input.value = address;
        state.confirmed = true;
        state.how = how;
        state.address = address;
        say('uaddr-ok', T.confirmed);
        box.setAttribute('data-uaddr-confirmed', how);
        onChange(state);
      });
      no.addEventListener('click', function () {
        state.confirmed = false; state.how = ''; state.place_id = ''; state.lat = null; state.lng = null;
        box.removeAttribute('data-uaddr-confirmed');
        clear();
        lastAsked = '';
        try { input.focus(); } catch (e) { }
        onChange(state);
      });
      row.appendChild(yes);
      row.appendChild(no);
      box.appendChild(row);
      onChange(state);
    }

    /* --- provider (a): Google suggestions under the field --- */
    function drawSuggestions(items) {
      sugList.textContent = '';
      if (!items || !items.length) { sugList.hidden = true; return; }
      for (var i = 0; i < items.length; i++) {
        (function (it) {
          var li = document.createElement('li');
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'uaddr-pick';
          b.textContent = it.description;
          b.addEventListener('click', function () {
            sugList.hidden = true;
            sugList.textContent = '';
            state.place_id = it.place_id || '';
            state.lat = it.lat != null ? it.lat : null;
            state.lng = it.lng != null ? it.lng : null;
            input.value = it.description;
            card(it.description, 'google', null);
          });
          li.appendChild(b);
          sugList.appendChild(li);
        })(items[i]);
      }
      sugList.hidden = false;
    }

    var googleSvc = null;
    function askGoogle(text) {
      if (!googleSvc) {
        try { googleSvc = new window.google.maps.places.AutocompleteService(); }
        catch (e) { googleSvc = null; }
      }
      if (!googleSvc) return false;
      googleSvc.getPlacePredictions({
        input: text,
        componentRestrictions: { country: 'us' },
        types: ['address'],
        /* biased to Brownsville TX */
        locationBias: { center: { lat: 25.9017, lng: -97.4975 }, radius: 40000 }
      }, function (preds) {
        var out = [];
        if (Array.isArray(preds)) {
          for (var i = 0; i < preds.length && i < 5; i++) {
            out.push({ description: preds[i].description, place_id: preds[i].place_id });
          }
        }
        drawSuggestions(out);
      });
      return true;
    }

    /* --- provider (b): the Census geocoder, JSONP only --- */
    function askCensus(bits) {
      say('uaddr-busy', T.looking);
      censusLookup(bits, function (err, found) {
        if (found) {
          state.lat = found.lat; state.lng = found.lng; state.place_id = '';
          card(found.address, 'census', null);
          return;
        }
        /* no match, a garbled body, or silence for 8 seconds: the typed card, flagged typed */
        state.lat = null; state.lng = null; state.place_id = '';
        card(tidy(bits.full), 'typed', T.noMatch);
      });
    }

    var timer = null;
    function look() {
      var raw = String(input.value || '').trim();
      if (state.confirmed && raw === state.address) return;
      if (state.confirmed && raw !== state.address) {
        state.confirmed = false; state.how = '';
        box.removeAttribute('data-uaddr-confirmed');
        onChange(state);
      }
      var key = String(window.UMBRA_PLACES_KEY || '').trim();
      if (key) {
        if (raw.length < 4) { sugList.hidden = true; return; }
        loadGoogle(key, function (ok) { if (ok) askGoogle(raw); else fallback(raw); });
        return;
      }
      fallback(raw);
    }
    function fallback(raw) {
      var bits = parse(raw);
      if (!bits) { if (raw) say('uaddr-need', T.needMore); else clear(); return; }
      if (raw === lastAsked) return;
      lastAsked = raw;
      askCensus(bits);
    }

    input.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(look, 450);
    });
    input.addEventListener('blur', function () {
      if (timer) clearTimeout(timer);
      setTimeout(look, 120);
    });

    var api = {
      state: function () { return state; },
      plausible: function () { return plausible(input.value); },
      needMore: T.needMore,
      notYet: T.notYet,
      localZip: function () { var b = parse(input.value); return !!(b && isLocalZip(b.zip)); },
      check: look
    };
    ATTACHED.push({ form: input.form, api: api, box: box, input: input, host: host });
    return api;
  }

  /* ------------------------------------------------------------------ the added fields
     A hidden input the customer never sees, made once and written every time. */
  function setHidden(form, name, value) {
    if (!form) return;
    var f = form.querySelector('input[type="hidden"][name="' + name + '"]');
    if (!f) {
      f = document.createElement('input');
      f.type = 'hidden';
      f.name = name;
      form.appendChild(f);
    }
    f.value = value;
  }

  /* ------------------------------------------------------------------ THE JOURNEY
     `lang` the moment the page loads, `started_at` the first time a finger lands on
     the form, `sent_at` at the send. Every request form on the site, one place. */
  function journey(form) {
    if (!form || form.getAttribute('data-uaddr-journey')) return;
    form.setAttribute('data-uaddr-journey', '1');
    setHidden(form, 'lang', ES ? 'es' : 'en');
    setHidden(form, 'started_at', '');
    setHidden(form, 'sent_at', '');
    var started = '';
    function touch() {
      if (started) return;
      started = new Date().toISOString();
      setHidden(form, 'started_at', started);
    }
    form.addEventListener('input', touch);
    form.addEventListener('change', touch);
    form.addEventListener('click', touch);
  }
  function stampSend(form) {
    if (!form) return;
    var started = form.querySelector('input[name="started_at"]');
    var now = new Date().toISOString();
    if (started && !started.value) started.value = now;
    setHidden(form, 'sent_at', now);
  }

  /* ------------------------------------------------------------------ THE SEND GATE
     CAPTURE phase, on the document, so it runs BEFORE the page's own submit handler —
     a page that calls preventDefault() and posts by hand must not get the chance. */
  function gate(e) {
    var form = e.target;
    if (!form || form.nodeName !== 'FORM' || !/(^|\s)req(\s|$)/.test(form.className || '')) return;
    var rec = null;
    for (var i = 0; i < ATTACHED.length; i++) if (ATTACHED[i].form === form) rec = ATTACHED[i];
    if (!rec) { stampSend(form); return; }
    if (rec.api.state().confirmed) { stampSend(form); return; }
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    var need = rec.host.querySelector('[data-uaddr-need]');
    if (!need) {
      need = document.createElement('p');
      need.className = 'v2need';
      need.setAttribute('role', 'alert');
      need.setAttribute('data-uaddr-need', '1');
      rec.host.appendChild(need);
    }
    need.hidden = false;
    need.textContent = plausible(rec.input.value) ? T.notYet : T.needMore;
    rec.api.check();
    try { rec.input.focus(); } catch (err) { }
  }
  document.addEventListener('submit', gate, true);

  /* ------------------------------------------------------------------ THE PLAIN PAGES
     A page with no wizard — contact.html, es/index.html — gets the same card, put up
     right under the address field, by this file and nobody else. A page that HAS the
     wizard is left alone: its chooser attaches the card on the address screen. */
  function bootstrap() {
    var forms = document.querySelectorAll('form.req');
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      journey(form);
      if (form.querySelector('[data-fstep="address"]')) continue;
      var field = form.querySelector('[name="address"]');
      if (!field || field.getAttribute('data-uaddr-on')) continue;
      field.setAttribute('data-uaddr-on', '1');
      var host = document.createElement('div');
      host.className = 'ch-addr-host';
      host.setAttribute('data-address-host', '1');
      var where = field.closest('label') || field.parentNode;
      if (where && where.parentNode) where.parentNode.insertBefore(host, where.nextSibling);
      else form.appendChild(host);
      (function (f, frm) {
        attach({
          input: f, host: host,
          onChange: function (s) {
            setHidden(frm, 'address_confirmed', s.confirmed ? s.how : '');
            setHidden(frm, 'address_place_id', s.place_id || '');
            setHidden(frm, 'lat', s.lat == null ? '' : String(s.lat));
            setHidden(frm, 'lng', s.lng == null ? '' : String(s.lng));
            var n = host.querySelector('[data-uaddr-need]');
            if (n && s.confirmed) n.hidden = true;
          }
        });
        setHidden(frm, 'address_confirmed', '');
      })(field, form);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
  else bootstrap();

  window.UmbraAddress = {
    attach: attach,
    plausible: plausible,
    parse: parse,
    tidy: tidy,
    LOCAL_ZIPS: LOCAL_ZIPS,
    words: T
  };
})();
