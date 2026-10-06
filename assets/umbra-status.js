/* umbra-status.js - SITE-FIX-11 clause 2 · THE SPANISH CUSTOMER'S STATUS PAGE EXISTS.
   This is the status page's render, moved out of status.html so that ONE source serves both
   /status and /es/estado. There is no fork of the logic: the two pages carry the same element
   ids and this file reads the page's own lang attribute for the words. Every line below was
   status.html's inline script; what changed is that each sentence the customer reads now comes
   from the word table W instead of being written in place.
   The page stays exactly as it is unless the link carried ?id= and a key AND a Worker is
   configured in /assets/umbra-endpoint.js. A wrong or expired link answers the same as one
   that never existed. */
// Reads the confirmation link. With no ?id= and a key, or with no Worker configured in /assets/umbra-endpoint.js,
// this does nothing at all and the page is exactly as it was. road W: the key is ?t= (the confirmation page's link)
// or ?v= (the private link the Flux texts); the photos and the receipt open with the same key.
(function () {
  var q = new URLSearchParams(location.search);
  var id = q.get('id'), t = q.get('t'), v = q.get('v');
  var key = t ? 't' : (v ? 'v' : '');
  var val = t || v || '';
  var base = String(window.UMBRA_API_BASE || '');
  if (!id || !key || !/^U-\d{4,6}$/.test(id) || !base) return;
  base = base.replace(/\/+$/, '');

  /* THE WORDS. The page says which language it is in; this file never guesses from the path.
     The Spanish is the usted voice of /es, /es/servicios and /es/recibido - the same sentences
     the Spanish customer has already read on the confirmation page. */
  var ES = (document.documentElement.getAttribute('lang') || '').toLowerCase().indexOf('es') === 0;

  /* road FW: the Done step says only what happened: the work finished, was inspected and stamped. It never claims
     the customer said anything - no screen asks them. */
  var W = ES ? {
    loc: 'es-MX',
    DOW: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
    PAY: { cash: 'efectivo', check: 'cheque', card: 'tarjeta' }, /* CFO s24: cheque, efectivo o tarjeta. Si el Worker manda otro metodo, la linea no lo nombra. */
    LABEL: {
      received: 'Tenemos su solicitud.',
      quoted: 'Tiene un precio y un plan, por escrito.',
      scheduled: 'Un día y un horario de llegada, acordados con usted.',
      done: 'Terminado, revisado y sellado.'
    },
    /* the ladder's own headings. The Worker sends them in English, so the Spanish page reads
       them from here by step and never from the wire. */
    STEP: { received: 'Recibido', quoted: 'Cotizado', scheduled: 'Programado', done: 'Terminado' },
    twoVisits: 'Dos visitas, acordadas con usted.',
    doneTail: ' — terminado, revisado y sellado.',
    doneBare: 'terminado, revisado y sellado.',
    arriving: ', llegada ',
    am: 'a.m.', pm: 'p.m.',
    repair: 'Su reparación',
    headPaid: 'Terminado y pagado.',
    headNew: 'Recibido.',
    leadDone: 'Terminado · ',
    leadGot: 'Recibido ', leadGotTail: '. Esta página está en vivo — ábrala cuando quiera.',
    price: 'Su precio: ', quoteReady: 'Su cotización está lista.',
    paidWord: 'Pagado ', paidBy: ' con ', paidOn: ' el ',
    visits: 'Sus visitas', visit: 'Su visita',
    change: 'Cambio ', okd: ' · usted lo aprobó',
    declined: 'Usted dijo que no — el trabajo queda como se cotizó.',
    waiting: ' más · esperando su aprobación. No se compra nada extra hasta que usted lo apruebe.',
    seeChange: 'Ver el cambio y aprobarlo',
    quotedWord: ' cotizado',
    photoAlt: function (n) { return 'Foto ' + n + ' que usted envió'; },
    photoName: function (n) { return 'Foto ' + n; }
  } : {
    loc: 'en-US',
    DOW: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    PAY: { cash: 'cash', check: 'check', card: 'card' }, /* CFO s24: check, cash or card. A method not on this list is simply not named in the line. */
    LABEL: {
      received: 'We have your request.',
      quoted: 'You have a price and a plan, in writing.',
      scheduled: 'A day and a window, agreed with you.',
      done: 'Finished, inspected and stamped.'
    },
    STEP: { received: 'Received', quoted: 'Quoted', scheduled: 'Scheduled', done: 'Done' },
    twoVisits: 'Two visits, agreed with you.',
    doneTail: ' — finished, inspected and stamped.',
    doneBare: 'finished, inspected and stamped.',
    arriving: ', arriving ',
    am: 'AM', pm: 'PM',
    repair: 'Your repair',
    headPaid: 'Done and paid.',
    headNew: 'Received.',
    leadDone: 'Done · ',
    leadGot: 'Received ', leadGotTail: '. This page is live — reopen it any time.',
    price: 'Your price: ', quoteReady: 'Your quote is ready.',
    paidWord: 'Paid ', paidBy: ' by ', paidOn: ' on ',
    visits: 'Your visits', visit: 'Your visit',
    change: 'Change ', okd: ' · you OK\'d it',
    declined: 'You said no thanks — the job is finished as quoted.',
    waiting: ' more · waiting for your OK. Nothing extra is bought until you do.',
    seeChange: 'See the change & OK it',
    quotedWord: ' quoted',
    photoAlt: function (n) { return 'Photo ' + n + ' you sent'; },
    photoName: function (n) { return 'Photo ' + n; }
  };
  var LABEL = W.LABEL;
  var DOW = W.DOW;
  var PAY = W.PAY;

  /* road FW: every time on this page as his texts write it, on Brownsville's clock: "Tue 9/29, 4:20 PM"
     - and in Spanish the way Spanish writes it: "mar 29/9, 4:20 p.m." */
  function fmt(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    try {
      var p = {};
      new Intl.DateTimeFormat(W.loc, { timeZone: 'America/Chicago', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
        .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      var wd = String(p.weekday || '').replace(/\.$/, '');
      var ap = /^a/i.test(String(p.dayPeriod || '')) ? W.am : W.pm;
      var day = ES ? (p.day + '/' + p.month) : (p.month + '/' + p.day);
      return wd + ' ' + day + ', ' + p.hour + ':' + p.minute + ' ' + ap;
    } catch (e) {
      return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
  }
  /* a visit as his texts write it: "Mon 9/28, arriving 8-10 AM" (the date is a calendar day, so no time zone enters) */
  function visitWords(w) {
    var p = String(w.date).split('-').map(Number);
    var dw = DOW[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
    var day = dw + ' ' + (ES ? (p[2] + '/' + p[1]) : (p[1] + '/' + p[2]));
    function c(hhmm) {
      var x = String(hhmm).split(':').map(Number), h = x[0], m = x[1];
      return { t: (((h + 11) % 12) + 1) + (m ? ':' + (m < 10 ? '0' : '') + m : ''), ap: h < 12 ? W.am : W.pm };
    }
    var a = c(w.start), b = c(w.end);
    return day + W.arriving + (a.ap === b.ap ? a.t + '–' + b.t + ' ' + b.ap : a.t + ' ' + a.ap + '–' + b.t + ' ' + b.ap);
  }
  function money(n) {
    var x = Number(n);
    return '$' + (x % 1 ? x.toFixed(2) : String(x));
  }

  fetch(base + '/api/job/' + encodeURIComponent(id) + '?' + key + '=' + encodeURIComponent(val))
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (j) {
      /* road FW: their job in their words, never a code: "Your repair · drywall & paint" */
      document.getElementById('live-kicker').textContent = j.service ? W.repair + ' · ' + String(j.service).toLowerCase() : W.repair;
      var steps = j.ladder || [];
      var visitsAll = j.visits || [];
      if (visitsAll.length > 1) LABEL.scheduled = W.twoVisits;
      /* the Done step's time is when the work finished (the Flux's word with the receipt); without it, no time at all */
      var doneLine = j.finished_at && fmt(j.finished_at) ? fmt(j.finished_at) + W.doneTail : W.doneBare;
      var at = null;
      for (var i = 0; i < steps.length; i++) if (steps[i].at) at = steps[i];
      var paid = j.paid && j.paid.amount != null ? j.paid : null;
      document.getElementById('live-head').textContent = paid && at && at.step === 'done' ? W.headPaid : (at ? (W.STEP[at.step] || at.label) + '.' : W.headNew);
      document.getElementById('live-lead').textContent = paid && at && at.step === 'done'
        ? W.leadDone + doneLine
        : W.leadGot + (fmt(j.received_at) || j.received_at_chicago) + W.leadGotTail;

      /* road FW: quoted — the price and one big button to their quote page (the link the Worker makes for them) */
      var quoteGo = null;
      if (j.status === 'quoted' && j.quote_link && /^https?:\/\//.test(j.quote_link) && !paid) {
        quoteGo = j.quote_link;
        document.getElementById('live-quote-price').innerHTML = j.quote_amount != null
          ? '<strong>' + W.price + '$' + String(j.quote_amount).replace(/[^0-9.,]/g, '') + '</strong>' : '<strong>' + W.quoteReady + '</strong>';
        document.getElementById('live-quote-go').href = quoteGo;
        document.getElementById('live-quote').hidden = false;
      }

      /* road W: paid — the payment in one line, and the receipt one tap away, opened with this page's own key */
      if (paid) {
        var pd = new Date(paid.at);
        var when = isNaN(pd) ? '' : W.paidOn + pd.toLocaleDateString(W.loc, { weekday: 'short', month: 'short', day: 'numeric' });
        document.getElementById('live-paid-line').textContent = W.paidWord + money(paid.amount) + (PAY[paid.method] ? W.paidBy + PAY[paid.method] : '') + when + '.';
        var a = document.getElementById('live-receipt');
        if (j.receipt) a.href = '/receipt/' + encodeURIComponent(j.id) + '?' + key + '=' + encodeURIComponent(val);
        else a.parentNode.hidden = true;
        document.getElementById('live-paid').hidden = false;
      }

      /* road W: every day the booking holds, while it is still ahead */
      var visits = j.visits || [];
      if (visits.length && !paid && j.status !== 'done') {
        var box = document.getElementById('live-visits');
        box.innerHTML = '';
        var h = document.createElement('p');
        var hs = document.createElement('strong');
        hs.textContent = visits.length > 1 ? W.visits : W.visit;
        h.appendChild(hs);
        box.appendChild(h);
        visits.forEach(function (w) { var p = document.createElement('p'); p.textContent = visitWords(w); box.appendChild(p); });
        box.hidden = false;
      }

      /* road CO: the change orders they were sent. Waiting: one button to it. OK'd: when, and the new total. */
      var changes = j.changes || [];
      var okTotal = null;
      if (changes.length) {
        var cb = document.getElementById('live-changes');
        cb.innerHTML = '';
        changes.forEach(function (c) {
          var p = document.createElement('p');
          var b = document.createElement('strong');
          b.textContent = W.change + c.n + ' · ' + c.what;
          p.appendChild(b);
          var line = document.createElement('span');
          line.style.display = 'block';
          if (c.state === 'accepted') {
            okTotal = c.total;
            line.textContent = money(c.price) + W.okd + (c.answered_at && fmt(c.answered_at) ? ' ' + fmt(c.answered_at) : '') + '.';
          } else if (c.state === 'declined') {
            line.textContent = W.declined;
          } else {
            line.textContent = money(c.price) + W.waiting;
          }
          p.appendChild(line);
          cb.appendChild(p);
          if (c.state === 'open' && c.link && /^https?:\/\//.test(c.link)) {
            var pa = document.createElement('p');
            var a2 = document.createElement('a');
            a2.className = 'btn wide';
            a2.href = c.link;
            a2.textContent = W.seeChange;
            pa.appendChild(a2);
            cb.appendChild(pa);
          }
        });
        /* road XW · ONE price once a change is OK'd: "Your price: $300 · $225 quoted + Change 1 $75" — never the
           quote's "$225 as quoted" beside a "New total $300" */
        if (okTotal != null) {
          var pt = document.createElement('p');
          pt.className = 'live-money';
          var pb = document.createElement('strong');
          pb.textContent = W.price + money(okTotal);
          pt.appendChild(pb);
          var chain = [];
          var quoted = j.quote_amount != null && isFinite(Number(j.quote_amount)) ? Number(j.quote_amount) : null;
          var sum = quoted;
          if (quoted != null) chain.push(money(quoted) + W.quotedWord);
          changes.forEach(function (c) {
            if (c.state !== 'accepted') return;
            chain.push(W.change + c.n + ' ' + money(c.price));
            if (sum != null) sum = Math.round((sum + Number(c.price)) * 100) / 100;
          });
          /* the chain is shown only when it adds up to the total; otherwise the one total stands alone */
          if (quoted != null && sum === Number(okTotal)) {
            var sp = document.createElement('span');
            sp.className = 'chain';
            sp.textContent = chain.join(' + ');
            pt.appendChild(sp);
          }
          cb.appendChild(pt);
        }
        cb.hidden = false;
      }

      var ol = document.getElementById('live-track');
      ol.innerHTML = '';
      var lastDone = -1;
      steps.forEach(function (s, i) { if (s.at) lastDone = i; });
      steps.forEach(function (s, i) {
        var li = document.createElement('li');
        if (s.at) li.className = (i === lastDone && !(paid && s.step === 'done')) ? 'now' : 'done';
        var d = document.createElement('div');
        var st = document.createElement('strong');
        st.textContent = W.STEP[s.step] || s.label;
        var sm = document.createElement('small');
        if (s.step === 'done' && s.at) sm.textContent = doneLine.charAt(0).toUpperCase() + doneLine.slice(1);
        else sm.textContent = s.at ? (fmt(s.at) + ' — ' + (LABEL[s.step] || '')) : (LABEL[s.step] || '');
        d.appendChild(st); d.appendChild(sm);
        li.appendChild(d);
        ol.appendChild(li);
      });

      /* road XW: once a change is OK'd its block carries the one price; the quote's own price line is not shown again */
      var quoteLine = j.quote_amount != null && !paid && !quoteGo && okTotal == null;
      if (j.scope || quoteLine) {
        var note = document.getElementById('live-scope');
        note.innerHTML = '';
        if (j.scope) {
          var ps = document.createElement('p');
          ps.style.margin = '0';
          ps.textContent = j.scope;
          note.appendChild(ps);
        }
        if (quoteLine) {
          var pq = document.createElement('p');
          pq.style.margin = j.scope ? '.5rem 0 0' : '0';
          pq.innerHTML = '<strong>' + W.price + '$' + String(j.quote_amount).replace(/[^0-9.,]/g, '') + '</strong>';
          note.appendChild(pq);
        }
        note.hidden = false;
      }

      var pix = j.photos || [];
      if (pix.length) {
        var ul = document.getElementById('live-photos');
        ul.innerHTML = '';
        pix.forEach(function (p, i) {
          var li = document.createElement('li');
          var a = document.createElement('a');
          a.href = base + p.url;
          a.target = '_blank'; a.rel = 'noopener';
          var img = document.createElement('img');
          img.src = a.href; img.alt = W.photoAlt(i + 1);
          a.appendChild(img);
          var nm = document.createElement('span');
          nm.className = 'nm';
          nm.textContent = W.photoName(i + 1);
          li.appendChild(a); li.appendChild(nm);
          ul.appendChild(li);
        });
        document.getElementById('live-photos-wrap').hidden = false;
      }

      /* road XW: the response promise is about a reply still owed — gone once the job is past "received" */
      var promise = document.getElementById('promise');
      if (promise && j.status && j.status !== 'received') promise.hidden = true;

      document.getElementById('generic').hidden = true;
      document.getElementById('live').hidden = false;
    })
    .catch(function () {
      // A wrong or expired link answers the same as one that never existed.
      // Leave the page as it is rather than telling a stranger which it was.
    });
})();
