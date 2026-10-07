/* ============================================================================
   UMBRA DOMUS — "FIX SOMETHING" LANDS ON THE CHOOSER. (SITE-FIX-01, 2026-09-28)

   His words: "the form is still taking us to fill in straight to drywall ... and i
   have to scroll up from the drywall form that it just starts us already on to even
   see any of these options" — and "we need when we press fix something for there be
   to a really easy customer experience to be able to tell our form whats wrong".

   WHAT THIS FILE DOES
     1. Draws the CHOOSER — big tappable tiles by SYMPTOM, not by trade, multi-select,
        nothing preselected, nothing autofocused, and under them the "while we're
        there" checklist. Every word of it comes from /assets/umbra-chooser-data.js.
     2. Draws ONE screen of questions per lit tile, from the same data file. A hole
        question is never shown to somebody who only wants paint.
     3. Draws the REVIEW — the last screen before Send, listing everything chosen,
        each group with an Edit tap. The ONE Send button lives only there.
     4. Keeps the draft in this tab's own memory and puts a history entry behind every
        screen, so the back gesture loses nothing.

   THE POSTED-NAME CONTRACT IS UNCHANGED. The tiles tick `service` and `problem`,
   which the form has always sent. Everything else this file adds is an ADDED field:
       tiles · answers · while_there · photo_tiles · lang · started_at · sent_at
       reply_how · how_soon · whose_house
       address_confirmed · address_place_id · lat · lng     (from umbra-address.js)
   Added, never renamed. The hole tile's own answers still travel in the hole field
   names the Worker and the Flux Capacitor already read.

   WITH JAVASCRIPT OFF none of this exists and the page's own static screens stand,
   exactly as they did before, posting to the form's own action.
   ========================================================================== */
(function () {
  'use strict';

  var DATA = window.UMBRA_CHOOSER;
  if (!DATA) return;

  var ES = (document.documentElement.getAttribute('lang') || '').toLowerCase().indexOf('es') === 0;
  var LANG = ES ? 'es' : 'en';
  var W = DATA.words[LANG];
  var TILES = DATA.tiles;
  var LIST = DATA.checklist;
  var DRAFT_KEY = 'umbra.draft.v1';
  var GOT_KEY = 'umbra.got.v1';

  function elx(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ================================================================== THE SENT PAGE
     A3 · the thank-you page keeps the same list under it, read-only: "This is what we
     got." It comes from this tab's own memory of the review screen — never from the
     address, never from the Worker. Another phone, or a tab that never had the form,
     simply sees nothing here. */
  var got = document.querySelector('[data-got]');
  if (got) {
    var mem = null;
    try { mem = JSON.parse(window.sessionStorage.getItem(GOT_KEY) || 'null'); } catch (e) { mem = null; }
    if (mem && mem.groups && mem.groups.length && Date.now() - (mem.at || 0) < 12 * 3600000) {
      got.appendChild(elx('p', 'sent-h', W.gotIt));
      for (var g = 0; g < mem.groups.length; g++) {
        var grp = mem.groups[g];
        if (!grp || !grp.lines || !grp.lines.length) continue;
        got.appendChild(elx('p', 'ch-rtitle', grp.title));
        var ul = elx('ul', 'ch-got');
        for (var L2 = 0; L2 < grp.lines.length; L2++) ul.appendChild(elx('li', null, grp.lines[L2]));
        got.appendChild(ul);
      }
      got.hidden = false;
    }
    return;
  }

  var form = document.querySelector('form.req');
  if (!form) return;
  var root = form.querySelector('[data-intake2]');
  if (!root) return;

  var el = elx;
  function stepOf(key) { return root.querySelector('[data-fstep="' + key + '"]'); }
  function boxes(name) { return [].slice.call(form.querySelectorAll('[name="' + name + '"]')); }

  /* one hidden field per added name, made once, never renamed */
  function hidden(name) {
    var e = form.querySelector('input[type="hidden"][name="' + name + '"]');
    if (!e) {
      e = document.createElement('input');
      e.type = 'hidden';
      e.name = name;
      form.appendChild(e);
    }
    return e;
  }
  /* ============================================================ SITE-FIX-16 · A
     ONE INPUT PER NAME, SO AN ANSWER IS POSTED ONCE. A tap row already puts a real
     checkbox or radio in this form under the answer's own name, and the browser posts
     every control it finds there — so a hidden twin of that same name, made here,
     posted the answer a SECOND time: tiles "hole" then "hole", reply_how "Text" then
     "Text" (on /es "Mensaje de texto" twice), and the Worker stored ["hole","hole"]
     for the Flux to print "hole,hole". A hidden twin is made only for a name NO live
     control carries (answers, photo_tiles, the address fields); where one does, any
     twin is taken down and the control the customer tapped — the one the browser posts
     FIRST — is the single carrier of its answer. The value sent does not move: the
     twin held the same string the tapped control holds. */
  function liveCarrier(name) {
    var bs = form.querySelectorAll('[name="' + name + '"]');
    for (var i = 0; i < bs.length; i++) {
      if (bs[i].type !== 'hidden' && !bs[i].disabled) return true;
    }
    return false;
  }
  function setHidden(name, value) {
    var v = String(value == null ? '' : value);
    var e = form.querySelector('input[type="hidden"][name="' + name + '"]');
    if (!v || liveCarrier(name)) { if (e && e.parentNode) e.parentNode.removeChild(e); return; }
    hidden(name).value = v;
  }

  /* ------------------------------------------------------------------ a tap row
     One shape for every tap on this form: a big label, the box inside it, a mark,
     the words. 44pt targets and 16px text come from site.css. */
  /* ============================================================ SITE-FIX-15 · D3
     THE WORDS ON THE OPTION ARE THE PAGE'S OWN SPANISH. One table, in the words
     file, keyed by the value that is posted: the label he reads changes, the
     value the request carries does not. English has no table and needs none. */
  function optWords(s) {
    var m = W.optWords, k = String(s == null ? '' : s);
    return (m && Object.prototype.hasOwnProperty.call(m, k)) ? m[k] : k;
  }

  function tapRow(name, value, label, sub, multi) {
    var li = el('li');
    var lab = el('label', 'v2opt ' + (multi ? 'v2checkbox' : 'v2radio') + ' ch-tap');
    var box = document.createElement('input');
    box.type = multi ? 'checkbox' : 'radio';
    box.name = name;
    box.value = value;
    var mark = el('i', 'v2mark');
    mark.setAttribute('aria-hidden', 'true');
    var wrap = el('span', 'ch-words');
    wrap.appendChild(el('span', 'ch-label', label));
    if (sub) wrap.appendChild(el('span', 'ch-sub', sub));
    lab.appendChild(box);
    lab.appendChild(mark);
    lab.appendChild(wrap);
    li.appendChild(lab);
    return li;
  }

  /* ================================================================== 1 · THE CHOOSER */
  var chooserStep = stepOf('chooser');
  if (!chooserStep) return;

  /* THE HEADING IS THE PAGE'S OWN when the page has one. /services and /es/servicios
     carry it in their HTML, so it is there with JavaScript off and it is there before
     this file runs — and saying it twice, once in the band and once again three lines
     below, reads like a mistake. On a page without one, the chooser says it itself. */
  var pageHead = document.getElementById('request-top') || document.getElementById('pedir-top');
  var head = pageHead;
  if (!head) {
    head = el('h3', 'v2q ch-heading', W.heading);
    head.id = 'chooser-heading';
    chooserStep.appendChild(head);
    chooserStep.appendChild(el('p', 'v2hint ch-hint', W.hint));
  }
  head.setAttribute('data-chooser-heading', '1');

  var tileList = el('ul', 'v2opts ch-tiles');
  tileList.setAttribute('data-chooser-tiles', '1');
  for (var i = 0; i < TILES.length; i++) {
    var t = TILES[i];
    var row = tapRow('tiles', t.key, t[LANG].label, t[LANG].sub, true);
    row.setAttribute('data-tile', t.key);
    tileList.appendChild(row);
  }
  chooserStep.appendChild(tileList);

  /* "WHILE WE'RE THERE" — the second thing on the same screen, under the tiles */
  var whileWrap = el('div', 'ch-while');
  whileWrap.setAttribute('data-chooser-while', '1');
  whileWrap.appendChild(el('h3', 'v2q ch-heading', W.whileHeading));
  var whileList = el('ul', 'v2opts ch-list');
  for (var j = 0; j < LIST.length; j++) {
    whileList.appendChild(tapRow('while_there', LIST[j][LANG], LIST[j][LANG], '', true));
  }
  whileWrap.appendChild(whileList);
  chooserStep.appendChild(whileWrap);

  /* ================================================================== 2 · A TILE'S QUESTIONS */
  var tileHost = root.querySelector('[data-tile-steps]');
  var tileSteps = {};
  if (tileHost) {
    for (var k = 0; k < TILES.length; k++) {
      var tl = TILES[k];
      if (!tl.questions.length) continue;
      var sec = document.createElement('section');
      sec.className = 'fstep';
      sec.setAttribute('data-fstep', 'tile-' + tl.key);
      sec.setAttribute('data-tile-step', tl.key);
      sec.hidden = true;
      sec.appendChild(el('p', 'v2where ch-which', tl[LANG].label));
      for (var q = 0; q < tl.questions.length; q++) {
        var qq = tl.questions[q];
        var block = el('div', 'ch-qblock');
        block.setAttribute('data-q', qq.key);
        block.appendChild(el('p', 'v2q', qq[LANG].q));
        var ul = el('ul', 'v2opts');
        var nm = 'a_' + tl.key + '_' + qq.key;
        for (var o = 0; o < qq[LANG].opts.length; o++) {
          ul.appendChild(tapRow(nm, qq[LANG].opts[o], optWords(qq[LANG].opts[o]), '', !!qq.multi));
        }
        block.appendChild(ul);
        block.setAttribute('data-answer-name', nm);
        /* SITE-FIX-01.1 · a question that is only asked sometimes says so here, and
           applyWhen() below is the one place that decides. */
        if (qq.when) {
          block.setAttribute('data-when-name', 'a_' + tl.key + '_' + qq.when.q);
          block.setAttribute('data-when-opts', qq.when.opts.join(','));
          block.setAttribute('data-when-of', tl.key + '/' + qq.when.q);
        }
        sec.appendChild(block);
      }
      tileHost.appendChild(sec);
      tileSteps[tl.key] = sec;
    }
  }

  /* SITE-FIX-01.1 · THE QUESTIONS THAT ARE ONLY SOMETIMES ASKED. AMEND A6.2: "how many
     rooms" only when the walls or the whole room get paint. A question whose turn has not
     come is hidden AND forgets whatever was tapped in it, so nothing a customer cannot see
     travels to Drew. The options are matched BY POSITION, which is why the rule reads the
     same in English and in Spanish. */
  function optionValues(tileKey, qKey, positions) {
    for (var t = 0; t < TILES.length; t++) {
      if (TILES[t].key !== tileKey) continue;
      for (var q = 0; q < TILES[t].questions.length; q++) {
        if (TILES[t].questions[q].key !== qKey) continue;
        var opts = TILES[t].questions[q][LANG].opts, out = [];
        for (var p = 0; p < positions.length; p++) out.push(opts[positions[p]]);
        return out;
      }
    }
    return [];
  }
  function askedOf(tileKey, qq) {
    if (!qq.when) return true;
    var wanted = optionValues(tileKey, qq.when.q, qq.when.opts);
    var on = ticked('a_' + tileKey + '_' + qq.when.q);
    for (var w = 0; w < wanted.length; w++) if (on.indexOf(wanted[w]) > -1) return true;
    return false;
  }
  function applyWhen() {
    var blocks = root.querySelectorAll('[data-when-name]');
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var of = (b.getAttribute('data-when-of') || '').split('/');
      var positions = (b.getAttribute('data-when-opts') || '').split(',').map(Number);
      var wanted = optionValues(of[0], of[1], positions);
      var on = ticked(b.getAttribute('data-when-name'));
      var asked = false;
      for (var w = 0; w < wanted.length; w++) if (on.indexOf(wanted[w]) > -1) asked = true;
      if (b.hidden === !asked) continue;
      b.hidden = !asked;
      if (!asked) {
        var ins = b.querySelectorAll('input');
        for (var n = 0; n < ins.length; n++) ins[n].checked = false;
      }
    }
  }

  /* ================================================================== 3 · A FEW LAST THINGS */
  var detailsStep = stepOf('details');
  if (detailsStep) {
    detailsStep.appendChild(el('p', 'v2q', W.detailsHeading));
    var rows = [
      { name: 'reply_how', q: W.replyHow, opts: W.replyHowOpts },
      { name: 'how_soon', q: W.howSoon, opts: W.howSoonOpts },
      { name: 'whose_house', q: W.whoseHouse, opts: W.whoseHouseOpts }
    ];
    for (var r = 0; r < rows.length; r++) {
      var b = el('div', 'ch-qblock');
      b.appendChild(el('p', 'v2q ch-small-q', rows[r].q));
      var rl = el('ul', 'v2opts ch-inline');
      for (var ro = 0; ro < rows[r].opts.length; ro++) {
        rl.appendChild(tapRow(rows[r].name, rows[r].opts[ro], optWords(rows[r].opts[ro]), '', false));
      }
      rl.appendChild(tapRow(rows[r].name, W.notSure, optWords(W.notSure), '', false));
      b.appendChild(rl);
      detailsStep.appendChild(b);
    }
  }

  /* ================================================================== the lit tiles */
  function lit() {
    var out = [];
    var bs = boxes('tiles');
    for (var i = 0; i < TILES.length; i++) {
      for (var b = 0; b < bs.length; b++) {
        if (bs[b].checked && bs[b].value === TILES[i].key) { out.push(TILES[i]); break; }
      }
    }
    return out;
  }
  function ticked(name) {
    return boxes(name).filter(function (e) { return e.checked; }).map(function (e) { return e.value; });
  }

  /* THE STEP KEYS a lit chooser puts in front of the customer, in order.
     The hole tile is the page's own screens, by their own field names. */
  function tileStepKeys() {
    var on = lit(), pre = [], post = [];
    for (var i = 0; i < on.length; i++) {
      if (on[i].legacy) {
        if (pre.indexOf('where') < 0) pre.push('where');
        if (tileSteps[on[i].key]) post.push('tile-' + on[i].key);
      } else if (tileSteps[on[i].key]) {
        pre.push('tile-' + on[i].key);
      }
    }
    return { pre: pre, post: post };
  }
  function wantsPaintStep() {
    var on = lit();
    if (!on.length) return true;                       /* nothing chosen: the page's own order stands */
    for (var i = 0; i < on.length; i++) if (on[i].key === 'hole' || on[i].key === 'paint') return true;
    return false;
  }

  /* ================================================================== the order of the thumb
     SITE-FIX-12 clause 2. `lit()` answers in the tiles' declaration order, which is not
     the order a thumb put them in, so the FIRST tile declared used to decide the job even
     after the customer chose another. This records each tick as it happens - capture
     phase, on the form, so it is written before the form's own change handler reads it -
     and nothing else in the file uses it. With the record empty (a page just loaded, its
     tiles restored from the draft) every answer below is the one the page gave before. */
  var tapOrder = [];
  form.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || t.name !== 'tiles') return;
    var at = tapOrder.indexOf(t.value);
    if (at > -1) tapOrder.splice(at, 1);
    if (t.checked) tapOrder.push(t.value);
  }, true);
  function lastLit() {
    var on = lit();
    for (var i = tapOrder.length - 1; i >= 0; i--) {
      for (var j = 0; j < on.length; j++) if (on[j].key === tapOrder[i]) return on[j];
    }
    return on.length ? on[0] : null;
  }
  /* SITE-FIX-12.1, the second reader's finding 2. The record above is memory only, so a
     customer who taps A then B and comes back to the page used to arrive with the record
     empty - and the draft puts BOTH tiles back, so the first tile declared decided the job
     again. The draft already remembers which job it was, in the service field, because that is what
     the thumb wrote. This reads it back and puts that one tile in the record, so the page
     resumes with the thumb it had. With no service restored, or none that matches a lit
     tile, the record stays empty and the page answers exactly as it did before. */
  function seedTapOrder() {
    if (tapOrder.length) return;
    var sb = boxes('service'), was = null;
    for (var i = 0; i < sb.length; i++) if (sb[i].checked) was = sb[i].value;
    if (!was) return;
    var on = lit();
    for (var j = 0; j < on.length; j++) if (on[j].service === was) { tapOrder = [on[j].key]; return; }
  }

  /* ================================================================== service + problem
     The LAST tile tapped decides `service` (it is one value and always has been); with
     nothing tapped yet it is the first lit tile, as before.
     `problem` is ticked from every lit tile that names one. Nothing is preselected:
     with no tile lit, neither is touched. */
  function driveWorkerFields() {
    var on = lit();
    if (!on.length) return;
    var want = (lastLit() || on[0]).service;
    var sb = boxes('service');
    for (var i = 0; i < sb.length; i++) sb[i].checked = (sb[i].value === want);
    var wantProblems = [];
    for (var t = 0; t < on.length; t++) {
      for (var p = 0; p < on[t].problem.length; p++) {
        if (wantProblems.indexOf(on[t].problem[p]) < 0) wantProblems.push(on[t].problem[p]);
      }
    }
    var pb = boxes('problem');
    for (var b = 0; b < pb.length; b++) pb[b].checked = wantProblems.indexOf(pb[b].value) > -1;
  }

  /* ================================================================== the added fields */
  function answerLines() {
    var out = [], on = lit();
    for (var i = 0; i < on.length; i++) {
      var tl = on[i];
      for (var q = 0; q < tl.questions.length; q++) {
        var qq = tl.questions[q];
        if (!askedOf(tl.key, qq)) continue;
        var vals = ticked('a_' + tl.key + '_' + qq.key);
        if (!vals.length) continue;
        out.push(tl[LANG].label + ': ' + qq[LANG].q + ' = ' + vals.join(' · '));
      }
    }
    return out;
  }
  function photoTileLines() {
    var out = [];
    var sels = form.querySelectorAll('[data-photo-list] select[data-photo-tile]');
    for (var i = 0; i < sels.length; i++) {
      out.push(W.photoOf + (i + 1) + ': ' + (sels[i].options[sels[i].selectedIndex] || {}).text);
    }
    if (!out.length) {
      var n = form.querySelectorAll('[data-photo-list] li').length;
      var on = lit();
      for (var p = 0; p < n; p++) out.push(W.photoOf + (p + 1) + ': ' + (on[0] ? on[0][LANG].label : ''));
    }
    return out;
  }

  /* SITE-FIX-01.1 · THE CLOCK AND THE LANGUAGE TRAVEL WITH EVERY REQUEST NOW, and they are
     stamped in ONE place for every page of the site — /assets/umbra-address.js, the file
     every form page loads. The round before this one carried them only with a request built
     on the chooser, to keep suite F's frozen record of what the four form pages post;
     D-CEO-61 re-cut that reading. Nothing about them is set in this file. */

  function syncFields() {
    driveWorkerFields();
    setHidden('tiles', ticked('tiles').join(' · '));
    setHidden('answers', answerLines().join('\n'));
    setHidden('while_there', ticked('while_there').join('\n'));
    setHidden('photo_tiles', photoTileLines().join('\n'));
    setHidden('reply_how', ticked('reply_how')[0] || '');
    setHidden('how_soon', ticked('how_soon')[0] || '');
    setHidden('whose_house', ticked('whose_house')[0] || '');
    if (addr) {
      var s = addr.state();
      setHidden('address_confirmed', s.confirmed ? s.how : '');
      setHidden('address_place_id', s.place_id || '');
      setHidden('lat', s.lat == null ? '' : String(s.lat));
      setHidden('lng', s.lng == null ? '' : String(s.lng));
    }
  }

  /* ================================================================== 4 · THE ADDRESS */
  var addr = null;
  var addressStep = stepOf('address');
  if (addressStep && window.UmbraAddress) {
    var field = addressStep.querySelector('[name="address"]');
    var holder = el('div', 'ch-addr-host');
    holder.setAttribute('data-address-host', '1');
    addressStep.appendChild(holder);
    /* SITE-FIX-02 · CDO 2 · ONE ADDRESS STATE AT A TIME. This line is put up by the
       screen gate below when Next is tapped before "Yes, that's it". It used to stay up
       after the tap, so the screen said confirmed AND not confirmed at once — the CDO's
       screen 5b-address-confirmed-390. It is made BEFORE the card now, so the card's own
       onChange can take it down the moment the address is confirmed. */
    var need = el('p', 'v2need ch-addr-need');
    need.setAttribute('role', 'alert');
    need.hidden = true;
    need.textContent = window.UmbraAddress.words.needMore;
    addressStep.appendChild(need);
    addr = window.UmbraAddress.attach({
      input: field, host: holder,
      /* SITE-FIX-12 clause 3 - the box is about to speak, so this alert goes quiet first:
         the screen says exactly one thing at a time. */
      onQuiet: function () { need.hidden = true; },
      onChange: function (s) {
        if (s && s.confirmed) need.hidden = true;
        syncFields(); drawReview();
      }
    });
    /* THE HARD GATE: "afdsjohgaeojuhfhioasd" does not get past this screen. */
    addressStep.setAttribute('data-gate', 'address');
    window.UMBRA_ADDRESS_GATE = function () {
      if (!window.UmbraAddress.plausible(field.value)) {
        need.textContent = addr.needMore;
        /* SITE-FIX-12 clause 3 - if the box is already saying something of its own, that
           is the one message; this alert stays down. The gate still refuses, same words,
           same decision - only the doubling is gone. */
        need.hidden = addr.speaking();
        try { field.focus(); } catch (e) { }
        return false;
      }
      /* SITE-FIX-01.1 · A2, the whole of it, ON EVERY PATH. His words: "we need to make
         sure an address pops up they can click on and confirm its the real address before
         form is submitted." A tap is always on offer — when the map cannot be reached the
         card still says "confirm it as you typed it" — so this holds nobody up who has
         typed a real address. The round before this one asked it only of a request built
         on the chooser, because suite F read the four form pages against a frozen record
         of the bytes they post; D-CEO-61 re-cut that reading, and the gate is the same on
         every path now. The SEND itself is gated too, in /assets/umbra-address.js, so no
         page can be submitted around this screen. */
      if (!addr.state().confirmed) {
        need.textContent = addr.notYet;
        need.hidden = addr.speaking();
        return false;
      }
      need.hidden = true;
      return true;
    };
  }

  /* ================================================================== 5 · THE PHOTO ASK, PER TILE */
  var photoStep = stepOf('photos');
  var photoAsk = null;
  if (photoStep) {
    photoAsk = el('ul', 'ch-photo-ask');
    photoAsk.setAttribute('data-photo-ask', '1');
    var hintEl = photoStep.querySelector('.v2hint');
    if (hintEl && hintEl.parentNode) hintEl.parentNode.insertBefore(photoAsk, hintEl.nextSibling);
    else photoStep.appendChild(photoAsk);
  }
  function drawPhotoAsk() {
    if (!photoAsk) return;
    photoAsk.textContent = '';
    var on = lit();
    for (var i = 0; i < on.length; i++) {
      var li = el('li');
      li.appendChild(el('strong', null, on[i][LANG].label));
      li.appendChild(document.createTextNode(' — ' + on[i].photo[LANG]));
      photoAsk.appendChild(li);
    }
    photoAsk.hidden = !on.length;
  }

  /* Each photo carries its tile. With one tile lit every photo is that tile's; with
     several, a small picker on the thumbnail says which, defaulting to the first. */
  var photoList = form.querySelector('[data-photo-list]');
  function tagPhotos() {
    if (!photoList) return;
    var on = lit();
    var items = photoList.querySelectorAll('li');
    for (var i = 0; i < items.length; i++) {
      var have = items[i].querySelector('select[data-photo-tile]');
      if (on.length < 2) { if (have && have.parentNode) have.parentNode.removeChild(have); continue; }
      if (!have) {
        have = document.createElement('select');
        have.setAttribute('data-photo-tile', '1');
        have.className = 'ch-photo-tile';
        have.setAttribute('aria-label', W.photoTile);
        items[i].appendChild(have);
      }
      var wanted = on.map(function (t) { return t[LANG].label; }).join('|');
      if (have.getAttribute('data-built') !== wanted) {
        var was = have.value;
        have.textContent = '';
        for (var o = 0; o < on.length; o++) {
          var op = document.createElement('option');
          op.value = on[o].key;
          op.textContent = on[o][LANG].label;
          have.appendChild(op);
        }
        have.setAttribute('data-built', wanted);
        if (was) have.value = was;
      }
    }
    syncFields();
  }
  if (photoList && typeof MutationObserver === 'function') {
    new MutationObserver(function () { tagPhotos(); drawReview(); }).observe(photoList, { childList: true });
  }

  /* ================================================================== 6 · THE REVIEW */
  var sendStep = stepOf('send');
  var reviewHost = null;
  if (sendStep) {
    var q = sendStep.querySelector('.v2q');
    if (q) q.textContent = W.reviewHeading;
    reviewHost = el('div', 'ch-review');
    reviewHost.setAttribute('data-review', '1');
    var sum = sendStep.querySelector('[data-contact-sum]');
    if (sum && sum.parentNode) sum.parentNode.insertBefore(reviewHost, sum);
    else sendStep.appendChild(reviewHost);
  }

  /* SITE-FIX-15 B - ONE reading of the reply clock per review draw: the line and the
     Send button are two readings of the same answer, never two clocks. */
  function dueNow() {
    if (!window.UmbraSent || typeof window.UmbraSent.due !== 'function') return null;
    var d = window.UmbraSent.due(Date.now());
    return (d && d.at) ? d : null;
  }
  function replyByLine(d) {
    if (!d) return '';
    return W.replyBy + d.at + (d.tomorrow ? W.tomorrow : '');
  }
  /* The button promised two hours under a line that said tomorrow morning. When the
     wait has been pushed past two hours the button names the line's own time; inside
     the open hours it keeps its own words, to the letter. */
  function drawSendButton(d) {
    var b = form.querySelector('[data-v2send]');
    if (!b) return;
    if (!b.hasAttribute('data-send-words')) b.setAttribute('data-send-words', b.textContent);
    var own = b.getAttribute('data-send-words');
    b.textContent = (d && d.shifted && W.sendBy) ? W.sendBy.replace('%', d.at) : own;
  }

  function group(title, lines, editKey) {
    var sec = el('div', 'ch-rgroup');
    sec.setAttribute('data-rgroup', editKey || title);
    var h = el('div', 'ch-rhead');
    h.appendChild(el('span', 'ch-rtitle', title));
    if (editKey) {
      var b = el('button', 'ch-redit', W.reviewEdit);
      b.type = 'button';
      b.setAttribute('data-edit', editKey);
      b.addEventListener('click', function () { jump(editKey); });
      h.appendChild(b);
    }
    sec.appendChild(h);
    var ul = el('ul', 'ch-rlist');
    for (var i = 0; i < lines.length; i++) ul.appendChild(el('li', null, lines[i]));
    sec.appendChild(ul);
    return sec;
  }

  function val(name) {
    var e = form.querySelector('[name="' + name + '"]');
    return e ? String(e.value || '').trim() : '';
  }
  function pickedTimes() {
    var out = [], els = form.querySelectorAll('[data-wpicks] .wpt');
    for (var i = 0; i < els.length; i++) out.push(String(els[i].textContent || '').trim());
    var flex = form.querySelector('[name="avail_flexible"]');
    if (flex && flex.checked) out.push(flex.closest('label') ? flex.closest('label').textContent.trim() : '');
    return out;
  }

  function missingThings() {
    var miss = [];
    if (!val('name')) miss.push(W.sName);
    if (!val('phone')) miss.push(W.sPhone);
    if (!val('address')) miss.push(W.sAddress);
    else if (addr && !addr.state().confirmed) miss.push(window.UmbraAddress.words.notYet);
    if (!pickedTimes().length) miss.push(W.sTimes);
    return miss;
  }

  /* ============================================================ SITE-FIX-15 · A
     THE REVIEW SAYS THE QUESTION THAT WAS ASKED, AND THE ANSWER HE TAPPED.
     Three readings of the screen, and nothing else: whether a control was on the
     screen at all, the words on the option he tapped, and the heading he saw above
     it. The request is not touched by any of them - what is posted is still the
     control's own value, set where it has always been set. */
  function shownIn(node, stop) {
    for (var n = node; n && n !== stop; n = n.parentNode) {
      if (n.nodeType === 1 && n.hidden) return false;
    }
    return true;
  }
  function stepOfEl(e) { return e && e.closest ? e.closest('[data-fstep]') : null; }
  /* A control on a hidden HALF of a screen was never asked - the "same texture as the
     ceiling?" question, and the five tiles it stands in for (umbra-intake-v2.js
     sameTexture()). A question that was never asked gets no line on the review. */
  function wasAsked(e) { return !!e && shownIn(e, stepOfEl(e) || form); }
  /* the words on the option he tapped - never the value that is posted */
  function tapLabel(e) {
    var lab = e && e.closest ? e.closest('label') : null;
    var w = lab ? (lab.querySelector('.ch-label') || lab.querySelector('span:not(.v2mark)')) : null;
    var t = w ? String(w.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return t || (e ? String(e.value || '') : '');
  }
  function tappedLabels(name) {
    var out = [], bs = boxes(name);
    for (var i = 0; i < bs.length; i++) if (bs[i].checked && wasAsked(bs[i])) out.push(tapLabel(bs[i]));
    return out;
  }
  function firstAsked(name) {
    var bs = boxes(name);
    for (var i = 0; i < bs.length; i++) if (bs[i].checked && wasAsked(bs[i])) return bs[i];
    return null;
  }
  /* the question he really saw: the LAST heading above that control on its own screen
     that was not hidden. */
  function askedLabel(e) {
    if (!e) return '';
    var step = stepOfEl(e), scope = step || form;
    var qs = scope.querySelectorAll('.v2q'), out = '';
    for (var i = 0; i < qs.length; i++) {
      if (!(qs[i].compareDocumentPosition(e) & 4)) continue;
      if (!shownIn(qs[i], scope)) continue;
      out = String(qs[i].textContent || '').replace(/\s+/g, ' ').trim();
    }
    return out;
  }

  function drawReview() {
    if (!reviewHost) return;
    reviewHost.textContent = '';
    /* SITE-FIX-01.1 · A6.7 as the ignite cuts it: the reply-by TIME sits BESIDE THE
       PROMISE, which is the line at the head of this screen. So it goes first, not last. */
    var dueRead = dueNow();
    drawSendButton(dueRead);
    var by = replyByLine(dueRead);
    if (by) {
      var pBy = el('p', 'ch-replyby', by);
      pBy.setAttribute('data-reply-by', '1');
      reviewHost.appendChild(pBy);
    }
    var on = lit();

    var tileLines = [];
    /* ============================================================ SITE-FIX-15 · C
       THE TILE AND THE PRICE HE TAPPED, SHOWN BACK TO HIM. Read from the very four
       fields the request carries (umbra-menu.js carryShown), in the words the tile
       showed - never a price computed a second time here. No tile tapped, no line. */
    var pickedLabel = val('shown_label'), pickedPrice = val('shown_price');
    /* A tile the menu prices by text sends no shown_* field at all (the Worker's own
       shape rule). He still tapped it, so the review names it - the name alone, with
       no price invented here - and only when THIS tab's tap is the tile the form was
       prefilled from. No tap in this tab: data-menu-pick is absent and there is no line. */
    if (!pickedLabel) {
      var mShown = (window.UmbraMenu && window.UmbraMenu.shown) ? window.UmbraMenu.shown() : null;
      var mKey = form.getAttribute('data-menu-pick');
      if (mShown && mShown.label && mKey && mShown.key === mKey) {
        pickedLabel = mShown.label;
        pickedPrice = '';
      }
    }
    if (pickedLabel && W.youPicked) {
      tileLines.push(W.youPicked.replace('%', pickedLabel + (pickedPrice ? ' · ' + pickedPrice : '')));
    }
    for (var i = 0; i < on.length; i++) {
      tileLines.push(on[i][LANG].label);
      for (var q2 = 0; q2 < on[i].questions.length; q2++) {
        var qq = on[i].questions[q2];
        if (!askedOf(on[i].key, qq)) continue;
        var nm = 'a_' + on[i].key + '_' + qq.key;
        var v = tappedLabels(nm);
        if (v.length) tileLines.push('   ' + (askedLabel(firstAsked(nm)) || qq[LANG].q) + ' ' + v.join(' · '));
      }
      if (on[i].legacy) {
        var legacyNames = ['problem_area', 'ceiling_count_band', 'ceiling_biggest', 'ceiling_condition',
          'ceiling_surface', 'walls_count_band', 'walls_biggest', 'walls_condition', 'walls_same', 'walls_surface',
          /* SITE-FIX-15 D2 - answered on every drywall path, on no review line */
          'paint_on_site'];
        for (var L = 0; L < legacyNames.length; L++) {
          var lv = tappedLabels(legacyNames[L]);
          if (!lv.length) continue;
          tileLines.push('   ' + (askedLabel(firstAsked(legacyNames[L])) + ' ').replace(/^ $/, '') + lv.join(' · '));
        }
      }
    }
    reviewHost.appendChild(group(W.sTiles, tileLines.length ? tileLines : [W.nothingYet], 'chooser'));

    var wl = tappedLabels('while_there');
    if (wl.length) reviewHost.appendChild(group(W.sWhile, wl, 'chooser'));

    var photos = form.querySelectorAll('[data-photo-list] li');
    var pg = group(W.sPhotos, [photos.length
      ? (photos.length === 1 ? W.photoOne : photos.length + W.photoMany)
      : W.photosNone], 'photos');
    if (photos.length) {
      var strip = el('div', 'ch-thumbs');
      for (var p = 0; p < photos.length; p++) {
        var src = photos[p].querySelector('img');
        if (!src) continue;
        var im = document.createElement('img');
        im.src = src.src;
        im.alt = '';
        im.className = 'ch-thumb';
        strip.appendChild(im);
      }
      pg.appendChild(strip);
    }
    reviewHost.appendChild(pg);

    if (val('what')) reviewHost.appendChild(group(W.sSentence, [val('what')], 'notes'));
    var last = [];
    var lastLab = { reply_how: W.replyHow, how_soon: W.howSoon, whose_house: W.whoseHouse };
    var lastNames = ['reply_how', 'how_soon', 'whose_house'];
    for (var Z = 0; Z < lastNames.length; Z++) {
      var zv = tappedLabels(lastNames[Z]);
      if (!zv.length) continue;
      last.push((askedLabel(firstAsked(lastNames[Z])) || lastLab[lastNames[Z]]) + ' ' + zv[0]);
    }
    if (last.length) reviewHost.appendChild(group(W.detailsHeading, last, 'details'));

    reviewHost.appendChild(group(W.sName, [val('name') || '—'], 'name'));
    reviewHost.appendChild(group(W.sPhone, [val('phone') || '—'], 'phone'));
    var addrLines = [val('address') || '—'];
    if (addr && val('address')) {
      addrLines.push(addr.state().confirmed ? window.UmbraAddress.words.confirmed : window.UmbraAddress.words.notYet);
    }
    reviewHost.appendChild(group(W.sAddress, addrLines, 'address'));
    var times = pickedTimes();
    reviewHost.appendChild(group(W.sTimes, times.length ? times : ['—'], 'times'));

    var miss = missingThings();
    var note = el('p', 'v2need ch-missing');
    note.setAttribute('data-missing', '1');
    note.setAttribute('role', 'alert');
    if (miss.length) { note.textContent = W.missing + miss.join(', ') + '.'; note.hidden = false; }
    else note.hidden = true;
    reviewHost.appendChild(note);
  }

  /* ================================================================== 7 · MOVING ABOUT */
  function jump(key) {
    if (window.UmbraIntake && typeof window.UmbraIntake.to === 'function') window.UmbraIntake.to(key);
  }

  /* A HISTORY ENTRY PER SCREEN, so the back gesture loses nothing. The URL never
     changes — only the entry — so a shared link still lands on the chooser. */
  var pushing = false;
  function here() { return location.pathname + location.search + (location.hash || ''); }
  function onScreen(key) {
    if (pushing || !key) return;
    try {
      if (history.state && history.state.umbraStep === key) return;
      history.pushState({ umbraStep: key }, '', here());
    } catch (e) { /* a browser that will not take it simply has no back-by-screen */ }
  }
  window.addEventListener('popstate', function (e) {
    var key = e.state && e.state.umbraStep;
    if (!key) return;
    pushing = true;
    jump(key);
    setTimeout(function () { pushing = false; }, 0);
  });
  if (typeof MutationObserver === 'function') {
    new MutationObserver(function () {
      onScreen(root.getAttribute('data-screen'));
      drawReview();
    }).observe(root, { attributes: true, attributeFilter: ['data-screen'] });
  }

  /* ================================================================== 8 · THE DRAFT */
  function draftable() {
    return [].slice.call(form.querySelectorAll('input:not([type=hidden]):not([type=file]), textarea'))
      .filter(function (e) { return e.name && e.name.charAt(0) !== '_'; });
  }
  function saveDraft() {
    try {
      var m = { at: Date.now(), v: {} };
      var els = draftable();
      for (var i = 0; i < els.length; i++) {
        var e = els[i];
        if (e.type === 'checkbox' || e.type === 'radio') {
          if (!e.checked) continue;
          var k = e.name + '\u0000' + e.value;
          m.v[k] = 1;
        } else if (e.value) m.v[e.name] = e.value;
      }
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(m));
    } catch (e) { /* private mode: the form simply does not remember */ }
  }
  function loadDraft() {
    try {
      var m = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || 'null');
      if (!m || !m.v || Date.now() - (m.at || 0) > 12 * 3600000) return false;
      var els = draftable(), any = false;
      for (var i = 0; i < els.length; i++) {
        var e = els[i];
        if (e.type === 'checkbox' || e.type === 'radio') {
          if (m.v[e.name + '\u0000' + e.value]) { e.checked = true; any = true; }
        } else if (m.v[e.name] != null) { e.value = m.v[e.name]; any = true; }
      }
      return any;
    } catch (e) { return false; }
  }
  function clearDraft() {
    try { window.sessionStorage.removeItem(DRAFT_KEY); } catch (e) { }
  }

  /* ================================================================== 9 · WIRING */
  form.addEventListener('change', function () {
    applyWhen();
    syncFields();
    drawPhotoAsk();
    tagPhotos();
    drawReview();
    saveDraft();
  });
  form.addEventListener('input', function () {
    syncFields();
    drawReview();
    saveDraft();
  });

  /* what the review said, kept for the thank-you page to say back */
  function keepGot() {
    try {
      var groups = [], secs = reviewHost ? reviewHost.querySelectorAll('.ch-rgroup') : [];
      for (var i = 0; i < secs.length; i++) {
        var title = secs[i].querySelector('.ch-rtitle');
        var items = secs[i].querySelectorAll('.ch-rlist li');
        var lines = [];
        for (var j = 0; j < items.length; j++) lines.push(items[j].textContent);
        groups.push({ title: title ? title.textContent : '', lines: lines });
      }
      window.sessionStorage.setItem(GOT_KEY, JSON.stringify({ at: Date.now(), groups: groups }));
    } catch (e) { /* private mode: the thank-you page simply says less */ }
  }

  /* THE SEND: the moment the request leaves, and the category it must never leave without. */
  form.addEventListener('submit', function () {
    syncFields();
    drawReview();
    keepGot();
    var sb = boxes('service'), anyService = false;
    for (var i = 0; i < sb.length; i++) if (sb[i].checked) anyService = true;
    if (!anyService) {
      for (var j = 0; j < sb.length; j++) if (sb[j].value === 'Not sure') sb[j].checked = true;
    }
    clearDraft();
  });

  loadDraft();
  seedTapOrder();
  applyWhen();
  syncFields();
  drawPhotoAsk();
  drawReview();

  /* ============================================== "FIX SOMETHING" LANDS ON THE TOP
     His words: "i have to scroll up from the drywall form that it just starts us
     already on to even see any of these options." So the tap on Fix something puts
     the TOP of the chooser at the top of the screen — not the middle of a form, and
     not a field. The browser's own jump to #request happens before the chooser is
     drawn and before the pictures below settle, which is exactly how he ended up
     halfway down it; this puts it right once everything has its height.
     Nothing is focused. The customer's thumb is already where it needs to be. */
  var band = root.closest('.band') || root;
  function toTop() {
    /* the site's header sticks to the top of the screen, so the landing sits below
       it — otherwise the first line of the chooser lands underneath the logo */
    var top = document.querySelector('.top');
    var lid = 0;
    if (top) {
      var pos = window.getComputedStyle ? window.getComputedStyle(top).position : '';
      if (pos === 'sticky' || pos === 'fixed') lid = top.getBoundingClientRect().height;
    }
    var y = Math.max(0, Math.round(band.getBoundingClientRect().top - lid +
      (window.pageYOffset || document.documentElement.scrollTop || 0)));
    /* The page's own CSS scrolls smoothly, which is right for a link two screens
       down and wrong for this one: the chooser sits six thousand pixels below the
       top of /services, and a six-second slide is not a landing. The smooth is put
       aside for this one jump and handed straight back. */
    var de = document.documentElement;
    var was = de.style.scrollBehavior;
    de.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    de.style.scrollBehavior = was;
  }
  function askedForIt(h) { return h === '#request' || h === '#pedir' || h === '#' + band.id; }
  if (askedForIt(location.hash)) {
    toTop();
    if (document.readyState !== 'complete') window.addEventListener('load', toTop);
  }
  /* a tap on any "Fix something" link already on this page does the same */
  var links = document.querySelectorAll('a[href^="#"]');
  for (var li = 0; li < links.length; li++) {
    (function (a) {
      if (!askedForIt(a.getAttribute('href'))) return;
      a.addEventListener('click', function () { setTimeout(toTop, 0); });
    })(links[li]);
  }

  window.UmbraChooser = {
    lit: lit,
    tileStepKeys: tileStepKeys,
    wantsPaintStep: wantsPaintStep,
    review: drawReview,
    sync: syncFields,
    tiles: TILES
  };
})();
