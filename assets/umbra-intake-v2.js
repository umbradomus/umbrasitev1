/* ============================================================================
   UMBRA DOMUS — THE INTAKE, v3 (2026-09-22, on Drew's readings from U-0010)

   One question per screen, photos first. Every question about a surface is
   asked under that surface's name — CEILING or WALLS — on its own screen, so
   the customer always knows which one they are answering. No room drawing.
   No photo cap (the photo block's own 9 MB size guard, which speaks up when it
   trims, is the only limit). The last screen's button is Send, in Next's place.

   THE POSTED-NAME CONTRACT IS UNCHANGED. Every name the Worker and the Flux
   Capacitor already read still goes out, and each is now its own visible
   control (no mirrors):

       service            one value, today's list, ticked by the tiles above
       problem            checkboxes
       problem_area       checkboxes
       ceiling_count_band   walls_count_band
       ceiling_biggest      walls_biggest
       ceiling_condition    walls_condition
       ceiling_surface      walls_surface   (road MW: on the walls, "Same texture as the ceiling?" Yes ticks
                                            the ceiling's value here — the Yes/No itself posts nothing)
       paint_on_site · name · phone · address · what · attachment
       avail_* · sms_consent* · time_1..3 · times_flexible · text_consent
                          the time screen and the text box (FORM-WINDOWS-01, umbra-windows.js)
       _subject · _captcha · _template · _next · _honey
       idioma             Spanish page only (value="español")

   WHICH SCREENS SHOW
       ceiling block   when "Ceiling" is ticked on "Where is it?"
       walls block     when Walls, Corner or edge, or Door or window is ticked
       count · size    when the problem is Holes, Cracks, A patch that shows,
                       or Something else (not for Water stain / Just paint alone)
       still in them   when Holes is ticked
       texture         always, per ticked surface
   A screen that drops out of the order has its answers cleared, so nothing
   stale is posted.

   WITH JAVASCRIPT OFF every screen is shown at once, top to bottom, and the
   form still posts to its own action attribute.
   ========================================================================== */
(function () {
  var form = document.querySelector('form.req');
  if (!form) return;
  var root = form.querySelector('[data-intake2]');
  if (!root) return;

  var steps = [].slice.call(root.querySelectorAll('[data-fstep]'));
  var fill  = root.querySelector('[data-v2fill]');
  var back  = root.querySelector('[data-v2back]');
  var next  = root.querySelector('[data-v2next]');
  var send  = root.querySelector('[data-v2send]');
  if (!steps.length || !back || !next || !send) return;

  function stepOf(key) {
    for (var i = 0; i < steps.length; i++) if (steps[i].getAttribute('data-fstep') === key) return steps[i];
    return null;
  }
  function boxes(name) { return [].slice.call(form.querySelectorAll('[name="' + name + '"]')); }
  function ticked(name) {
    return boxes(name).filter(function (el) { return el.checked; }).map(function (el) { return el.value; });
  }
  function has(name, value) { return ticked(name).indexOf(value) > -1; }

  /* ---------------------------------------------------------------- the order
     SITE-FIX-01 · THE CHOOSER COMES FIRST AND DECIDES THE REST. "Fix something"
     lands on the chooser; a tile that is lit puts ITS OWN questions in front of
     the customer and nobody else's — which is the whole of his complaint: "the
     form is still taking us to fill in straight to drywall ... its set up for
     holes still ... all i need is a little painting done."

     The hole tile keeps the page's own screens, by their own field names, so
     ceiling_count_band and the rest still carry exactly what they always carried.
     With NO tile lit the page's own order stands, unchanged, exactly as before. */
  function order() {
    var ceiling = has('problem_area', 'Ceiling');
    var walls = has('problem_area', 'Walls') || has('problem_area', 'Corner or edge') ||
                has('problem_area', 'Door or window');
    var sized = has('problem', 'Holes') || has('problem', 'Cracks') ||
                has('problem', 'A patch that shows') || has('problem', 'Something else');
    var holes = has('problem', 'Holes');
    var C = window.UmbraChooser || null;
    var chosen = C ? C.lit() : [];
    var keys = ['chooser'];
    if (C && chosen.length) {
      var tk = C.tileStepKeys();
      keys = keys.concat(tk.pre);
    } else {
      keys.push('what', 'where');
    }
    function block(s) {
      if (sized) keys.push(s + '-count', s + '-size');
      if (holes) keys.push(s + '-left');
      keys.push(s + '-tex');
    }
    if (ceiling) block('ceiling');
    if (walls) block('walls');
    if (C && chosen.length) keys = keys.concat(C.tileStepKeys().post);
    if (!C || C.wantsPaintStep()) keys.push('paint');
    /* SITE-FIX-01.1 · THE ASK, IN HIS ORDER. Photos first: a photo says more than a
       paragraph and it is the one thing he cannot get back later. Then THE ONE
       SENTENCE, SECOND — while the problem is still the thing they are thinking
       about — then who they are, how to reach them, where the house is, and last
       when we could come. The three one-tap rows ('details', all optional) sit
       between the address and the time.
       The round before this one had to put the sentence LAST, because suite G (9)
       walked Next from the sentence screen and required the time screen on the very
       next tap. D-CEO-61 re-cut that reading on his words, and the sentence sits
       where the ignite put it. */
    keys.push('photos', 'notes', 'name', 'phone', 'address', 'details');
    /* FORM-WINDOWS-01: 'times' (When could we come?) sits just before Send. */
    keys.push('times', 'send');
    var live = [];
    for (var i = 0; i < keys.length; i++) { var s = stepOf(keys[i]); if (s) live.push(s); }
    return live;
  }

  /* A screen that has dropped out of the order must not post yesterday's answer.
     SITE-FIX-01: a screen marked data-keep is the exception — the chooser owns its
     boxes (`problem`, and the tiles' own answers), and it is the chooser, not this
     order, that decides what they say. Clearing them here would wipe the tap the
     customer had just made on a screen they never see. */
  function clearDropped(live) {
    for (var i = 0; i < steps.length; i++) {
      if (live.indexOf(steps[i]) > -1) continue;
      if (steps[i].hasAttribute('data-keep')) continue;
      var ins = steps[i].querySelectorAll('input[type="radio"], input[type="checkbox"]');
      for (var j = 0; j < ins.length; j++) ins[j].checked = false;
    }
  }

  /* ------------------------------------------------------------- the screens */
  var at = 0;
  /* road XW · THE BAR NEVER GOES BACKWARDS. Ticking a second surface adds screens; the bar used to be worked out as
     "screen n of N" and shrank when N grew. Now each screen keeps the width it was first shown at: a step forward
     covers its share of what is left (so the last screen is always 100%), a change on the same screen holds the bar
     still, and Back shows the width that screen had. */
  var widths = [];
  function show(by) {
    var live = order();
    clearDropped(live);
    if (at >= live.length) at = live.length - 1;
    if (at < 0) at = 0;
    for (var i = 0; i < steps.length; i++) steps[i].hidden = (steps[i] !== live[at]);
    var last = (at === live.length - 1);
    back.hidden = (at === 0);
    next.hidden = last;
    send.hidden = !last;
    var wide;
    if (last) wide = 100;
    else if (by > 0 && widths[at - 1] != null) wide = widths[at - 1] + (100 - widths[at - 1]) / (live.length - at);
    else if (widths[at] != null) wide = widths[at];
    else wide = 100 * (at + 1) / live.length;
    widths[at] = wide;
    widths.length = at + 1;
    if (fill) fill.style.width = Math.round(wide) + '%';
    sameTexture();
    markRows();
    /* road XW · on a patch job, one line on the time picker: the patch dries overnight, so days in a row help */
    var pair = root.querySelector('[data-pair-hint]');
    if (pair) pair.hidden = !(has('problem', 'Holes') || has('problem', 'Cracks') || has('problem', 'A patch that shows'));
    root.setAttribute('data-at', String(at + 1));
    root.setAttribute('data-of', String(live.length));
    var key = live[at] ? live[at].getAttribute('data-fstep') : '';
    root.setAttribute('data-screen', key);
    /* SITE-FIX-02 · CDO 7 · THE PRIVACY LINE, TWICE, NOT ON EVERY STEP. It sits under the
       form, so it was under every one of the eleven screens, pushing the buttons down a
       phone. It is read once on the screen they land on and once on the review, where it
       is read just before they send — and nowhere in between. With no JavaScript the
       form shows every screen at once and this never runs, so the line stays put. */
    var priv = document.getElementById('privacy');
    if (priv) priv.hidden = !(at === 0 || key === 'send');
  }

  /* road MW (2026-09-26) · "SAME TEXTURE AS THE CEILING?" On the walls' texture screen, once the ceiling has a texture
     picked (anything but "Not sure"), the screen asks one Yes / No instead of the five tiles again. Its two boxes post
     nothing (they belong to no form); what goes to the Worker is still walls_surface, exactly as before: "Yes" ticks the
     ceiling's own texture there, "No" clears it and shows the tiles. Change the ceiling later and a "Yes" follows it. */
  function sameTexture() {
    var sec = stepOf('walls-tex');
    if (!sec) return;
    var ask = sec.querySelector('[data-same]');
    var tiles = sec.querySelector('[data-same-tiles]');
    if (!ask || !tiles) return;
    var ceilBox = null, cb = boxes('ceiling_surface');
    for (var i = 0; i < cb.length; i++) if (cb[i].checked) ceilBox = cb[i];
    var offer = has('problem_area', 'Ceiling') && ceilBox && ceilBox.value !== 'Not sure';
    var yn = boxes('walls_same');
    if (!offer) {
      for (var k = 0; k < yn.length; k++) yn[k].checked = false;
      ask.hidden = true; tiles.hidden = false;
      return;
    }
    var said = ticked('walls_same')[0] || '';
    var was = sec.querySelector('[data-same-was]');
    var name = ceilBox.closest('label') ? ceilBox.closest('label').querySelector('span') : null;
    var where = document.querySelector('[data-fstep="ceiling-tex"] .v2where span');
    if (was) was.textContent = (where ? where.textContent : 'Ceiling') + ': ' + (name ? name.textContent : ceilBox.value);
    ask.hidden = false;
    if (said === 'Yes') {
      var wb = boxes('walls_surface');
      for (var j = 0; j < wb.length; j++) wb[j].checked = (wb[j].value === ceilBox.value);
      tiles.hidden = true;
    } else tiles.hidden = (said !== 'No');
  }

  /* "Pick at least one" on the two screens that need it, said on the screen. */
  function needMet(step) {
    if (!step || !step.hasAttribute('data-need')) return true;
    /* a pick on the time screen is a hidden input the picker marks data-picked (umbra-windows.js) */
    var any = step.querySelector('input[type="checkbox"]:checked, input[type="radio"]:checked, input[data-picked]');
    var note = step.querySelector('.v2need');
    if (note) note.hidden = !!any;
    return !!any;
  }

  function go(by) {
    var live = order();
    if (by > 0) {
      var step = live[at];
      /* every field on the screen answers for itself: a required one left empty, and (road W) an email typed on
         the contact step that is not an address — caught here, never later on a screen that is out of sight */
      var fields = step ? step.querySelectorAll('input:not([type="hidden"]), textarea') : [];
      for (var fi = 0; fi < fields.length; fi++) {
        if (fields[fi].willValidate && !fields[fi].checkValidity()) { fields[fi].reportValidity(); return; }
      }
      if (!needMet(step)) return;
      /* SITE-FIX-01 · THE ADDRESS GATE. His words: "right now you can just type
         afdsjohgaeojuhfhioasd as an addresss." A screen that asks for the address
         will not let go of it until it has a house number, a street, and a ZIP or
         a town — said in plain words on the screen, next to the field. */
      if (step && step.getAttribute('data-gate') === 'address' &&
          typeof window.UMBRA_ADDRESS_GATE === 'function' && !window.UMBRA_ADDRESS_GATE()) return;
    }
    at += by;
    show(by);
    /* road FW: the form's top lands just under the site's sticky header, never under it. road XW: the CARD's top
       (its border and the progress bar), not the question block inside it */
    var top = form.getBoundingClientRect().top + window.pageYOffset - headerH() - 8;
    /* road XW: at once — the next screen is simply there, and the focus below measures the page where it will stay
       (a smooth scroll still under way made that look land short) */
    try { window.scrollTo({ top: top < 0 ? 0 : top, behavior: 'instant' }); } catch (e) { window.scrollTo(0, top < 0 ? 0 : top); }
    var first = live[at] ? live[at].querySelector('input:not([type=hidden]), textarea, button') : null;
    if (first && first.type !== 'file' && first.type !== 'checkbox' && first.type !== 'radio') {
      try { first.focus({ preventScroll: true }); } catch (e) { }
    }
  }

  /* road FW (2026-09-26) · THE QUESTION STAYS IN SIGHT. On a phone the site's header is sticky, and a box that took
     the focus (a tap, the keyboard opening, Next) could scroll up under it with its question hidden. The header's
     height is measured, not guessed; a focused box's question is brought down to sit just under the header — the
     step's own question for the first box on a screen, the box's own label for the next ones (email under phone). */
  function headerH() {
    var h = document.querySelector('.top');
    if (!h) return 0;
    var pos = window.getComputedStyle(h).position;
    if (pos !== 'sticky' && pos !== 'fixed') return 0;
    return Math.max(0, h.getBoundingClientRect().bottom);
  }
  function questionOf(el) {
    var step = el.closest ? el.closest('[data-fstep]') : null;
    if (!step) return null;
    var firstBox = step.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea');
    if (firstBox === el) return step.querySelector('.v2q, .v2where') || el;
    return el.closest('.v2field') || el;
  }
  function keepInSight(el) {
    var q = questionOf(el);
    if (!q) return;
    var room = headerH() + 8;
    var y = q.getBoundingClientRect().top;
    var vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    var boxBottom = el.getBoundingClientRect().bottom;
    /* road XW: the card's top (its border and the bar) clears the header too, whenever the box still fits under it */
    var cardTop = form.getBoundingClientRect().top;
    if ((cardTop < room || y < room || boxBottom > vh) && boxBottom - cardTop + room <= vh) { window.scrollBy(0, cardTop - room); return; }
    /* hidden under the header, or the box itself pushed below what the phone shows: put the question under the header */
    if (y < room || boxBottom > vh) window.scrollBy(0, y - room);
  }
  var typing = null;
  form.addEventListener('focusin', function (e) {
    var el = e.target;
    if (!el || !(el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(hidden|checkbox|radio|file|submit|button)$/.test(el.type)))) return;
    typing = el;
    keepInSight(el);
    /* the keyboard opens a moment after the focus and the browser scrolls again: look once more when it has */
    setTimeout(function () { if (document.activeElement === el) keepInSight(el); }, 350);
  });
  form.addEventListener('focusout', function () { typing = null; });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { if (typing && document.activeElement === typing) keepInSight(typing); });

  back.addEventListener('click', function () { go(-1); });
  next.addEventListener('click', function () { go(1); });

  /* Enter in a one-line field means Next, never a surprise submit. */
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || el.type === 'file' || el.type === 'submit') return;
    e.preventDefault();
    if (!next.hidden) go(1);
  });

  /* a chosen row also carries a class, so a browser without :has() still shows it */
  function markRows() {
    var labels = root.querySelectorAll('.v2opt');
    for (var i = 0; i < labels.length; i++) {
      var box = labels[i].querySelector('input');
      labels[i].classList.toggle('on', !!(box && box.checked));
    }
  }

  form.addEventListener('change', function (e) {
    /* road MW: "No" to the same texture starts the walls' own pick from nothing */
    if (e.target && e.target.name === 'walls_same' && e.target.value === 'No' && e.target.checked) {
      var wb = boxes('walls_surface');
      for (var i = 0; i < wb.length; i++) wb[i].checked = false;
    }
    markRows();
    var live = order();
    var step = live[at];
    if (step && step.hasAttribute('data-need')) needMet(step);
    show();
  });

  markRows();
  show();

  /* SITE-FIX-01 · GOING STRAIGHT TO A SCREEN. The review's "Edit" taps and the back
     gesture both need to land on one named screen and come back. The order is worked
     out fresh here, so a screen that is not in it (a hole screen on a paint job) is
     never jumped to by mistake. */
  window.UmbraIntake = {
    to: function (key) {
      var live = order();
      for (var i = 0; i < live.length; i++) {
        if (live[i].getAttribute('data-fstep') !== key) continue;
        at = i;
        show(i > at ? 1 : -1);
        var top = form.getBoundingClientRect().top + window.pageYOffset - headerH() - 8;
        try { window.scrollTo({ top: top < 0 ? 0 : top, behavior: 'instant' }); }
        catch (e) { window.scrollTo(0, top < 0 ? 0 : top); }
        return true;
      }
      return false;
    },
    screen: function () { return root.getAttribute('data-screen'); },
    refresh: function () { show(); }
  };
})();
