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
       ceiling_surface      walls_surface
       paint_on_site · name · phone · address · what · attachment
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

  /* ---------------------------------------------------------------- the order */
  function order() {
    var ceiling = has('problem_area', 'Ceiling');
    var walls = has('problem_area', 'Walls') || has('problem_area', 'Corner or edge') ||
                has('problem_area', 'Door or window');
    var sized = has('problem', 'Holes') || has('problem', 'Cracks') ||
                has('problem', 'A patch that shows') || has('problem', 'Something else');
    var holes = has('problem', 'Holes');
    var keys = ['photos', 'what', 'where'];
    function block(s) {
      if (sized) keys.push(s + '-count', s + '-size');
      if (holes) keys.push(s + '-left');
      keys.push(s + '-tex');
    }
    if (ceiling) block('ceiling');
    if (walls) block('walls');
    keys.push('paint', 'name', 'phone', 'address', 'notes', 'send');
    var live = [];
    for (var i = 0; i < keys.length; i++) { var s = stepOf(keys[i]); if (s) live.push(s); }
    return live;
  }

  /* A screen that has dropped out of the order must not post yesterday's answer. */
  function clearDropped(live) {
    for (var i = 0; i < steps.length; i++) {
      if (live.indexOf(steps[i]) > -1) continue;
      var ins = steps[i].querySelectorAll('input[type="radio"], input[type="checkbox"]');
      for (var j = 0; j < ins.length; j++) ins[j].checked = false;
    }
  }

  /* ------------------------------------------------------------- the screens */
  var at = 0;
  function show() {
    var live = order();
    clearDropped(live);
    if (at >= live.length) at = live.length - 1;
    if (at < 0) at = 0;
    for (var i = 0; i < steps.length; i++) steps[i].hidden = (steps[i] !== live[at]);
    var last = (at === live.length - 1);
    back.hidden = (at === 0);
    next.hidden = last;
    send.hidden = !last;
    if (fill) fill.style.width = Math.round(100 * (at + 1) / live.length) + '%';
    root.setAttribute('data-at', String(at + 1));
    root.setAttribute('data-of', String(live.length));
    var key = live[at] ? live[at].getAttribute('data-fstep') : '';
    root.setAttribute('data-screen', key);
  }

  /* "Pick at least one" on the two screens that need it, said on the screen. */
  function needMet(step) {
    if (!step || !step.hasAttribute('data-need')) return true;
    var any = step.querySelector('input[type="checkbox"]:checked, input[type="radio"]:checked');
    var note = step.querySelector('.v2need');
    if (note) note.hidden = !!any;
    return !!any;
  }

  function go(by) {
    var live = order();
    if (by > 0) {
      var step = live[at];
      var field = step ? step.querySelector('input[required], textarea[required]') : null;
      if (field && !field.checkValidity()) { field.reportValidity(); return; }
      if (!needMet(step)) return;
    }
    at += by;
    show();
    var top = root.getBoundingClientRect().top + window.pageYOffset - 12;
    window.scrollTo(0, top < 0 ? 0 : top);
    var first = live[at] ? live[at].querySelector('input:not([type=hidden]), textarea, button') : null;
    if (first && first.type !== 'file' && first.type !== 'checkbox' && first.type !== 'radio') {
      try { first.focus({ preventScroll: true }); } catch (e) { }
    }
  }

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
    markRows();
    var live = order();
    var step = live[at];
    if (step && step.hasAttribute('data-need')) needMet(step);
    show();
  });

  markRows();
  show();
})();
