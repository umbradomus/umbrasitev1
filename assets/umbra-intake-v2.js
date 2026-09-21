/* ============================================================================
   UMBRA DOMUS — THE INTAKE, v2 (INTAKE-FORM-V2-SPEC-2026-09-21 §3–§6)

   One question per screen, photos first, bands only, no per-area repetition.
   The v1 file /assets/umbra-intake.js is still in the repo and is no longer
   referenced by any page.

   THE POSTED-NAME CONTRACT IS UNCHANGED. Every name the Worker and the Flux
   Capacitor already read still goes out:

       service            one value, today's list, no longer a question
       problem            REPEATED — it is checkboxes now, same name
       problem_area       REPEATED
       ceiling_count_band   walls_count_band          (bands only, no exact counts)
       ceiling_biggest      walls_biggest             one answer, both names
       ceiling_condition    walls_condition           one answer, both names
       walls_surface        ceiling_surface           texture by name
       paint_on_site · name · phone · address · idioma · what · attachment
       _subject · _captcha · _template · _next · _honey

   HOW ONE ANSWER CARRIES TWO NAMES. The visible control for "Biggest one?" IS
   `ceiling_biggest`; `walls_biggest` is a hidden input this file keeps equal to
   it. The visible control for "Anything still in them?" IS `ceiling_condition`;
   this file rebuilds one hidden `walls_condition` input per ticked box. So the
   wire looks exactly as it did when the question was asked twice, and nothing
   downstream has to learn a new name.

   `corner_*` and `opening_*` are not asked any more and no input carries those
   names, so nothing empty is posted under them.

   THE ROOM DRAWING IS AN ILLUSTRATION. It has no hit regions and no state (the
   measured v1 defect was zones that looked tappable and were not). It only
   fills the surface whose box is ticked.

   WITH JAVASCRIPT OFF every screen is shown at once, top to bottom, and the
   form still posts to its own action attribute. Nothing is hidden by this file
   that the page does not first mark `hidden` itself.
   ========================================================================== */
(function () {
  var form = document.querySelector('form.req');
  if (!form) return;
  var root = form.querySelector('[data-intake2]');
  if (!root) return;

  var MAX_PHOTOS = 8;

  var steps = [].slice.call(root.querySelectorAll('[data-fstep]'));
  var fill  = root.querySelector('[data-v2fill]');
  var back  = root.querySelector('[data-v2back]');
  var next  = root.querySelector('[data-v2next]');
  var mirrorBox = root.querySelector('[data-v2mirrors]');
  var mirrorBiggest = mirrorBox ? mirrorBox.querySelector('input[name="walls_biggest"]') : null;
  if (!steps.length || !back || !next) return;

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
     4a only when the ceiling is ticked; 4b when a wall, a corner or an opening
     is — those two are location tags on the wall count, not screens of their
     own. 8 only when the ceiling is ticked. */
  function order() {
    var ceiling = has('problem_area', 'Ceiling');
    var walls = has('problem_area', 'Walls') || has('problem_area', 'Corner or edge') ||
                has('problem_area', 'Door or window');
    var keys = ['photos', 'what', 'where'];
    if (ceiling) keys.push('count-ceiling');
    if (walls) keys.push('count-walls');
    keys.push('size', 'left', 'tex-walls');
    if (ceiling) keys.push('tex-ceiling');
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

  /* "How many spots?" when only one count screen applies; the named question
     when both do. */
  function countWording(live) {
    var both = live.indexOf(stepOf('count-ceiling')) > -1 && live.indexOf(stepOf('count-walls')) > -1;
    ['count-ceiling', 'count-walls'].forEach(function (key) {
      var s = stepOf(key); if (!s) return;
      var q = s.querySelector('[data-q-one]'); if (!q) return;
      q.textContent = both ? q.getAttribute('data-q-both') : q.getAttribute('data-q-one');
    });
  }

  /* ------------------------------------------------- one answer, both names */
  function mirror() {
    if (mirrorBiggest) {
      var pick = ticked('ceiling_biggest');
      mirrorBiggest.value = pick.length ? pick[0] : '';
    }
    if (!mirrorBox) return;
    var olds = mirrorBox.querySelectorAll('input[name="walls_condition"]');
    for (var i = 0; i < olds.length; i++) mirrorBox.removeChild(olds[i]);
    ticked('ceiling_condition').forEach(function (v) {
      var el = document.createElement('input');
      el.type = 'hidden'; el.name = 'walls_condition'; el.value = v;
      el.setAttribute('data-mirror', 'ceiling_condition');
      mirrorBox.appendChild(el);
    });
  }

  /* ------------------------------------------------------- the room drawing */
  function paintRoom() {
    var zones = root.querySelectorAll('.zone, .edge');
    for (var i = 0; i < zones.length; i++) zones[i].classList.remove('on');
    boxes('problem_area').forEach(function (el) {
      if (!el.checked) return;
      (el.getAttribute('data-z') || '').split(' ').forEach(function (id) {
        if (!id) return;
        var z = document.getElementById(id);
        if (!z) return;
        if (z.tagName === 'g') {
          var edges = z.querySelectorAll('.edge');
          for (var k = 0; k < edges.length; k++) edges[k].classList.add('on');
        } else z.classList.add('on');
      });
    });
  }

  /* ------------------------------------------------------------- the screens */
  var at = 0;
  function show() {
    var live = order();
    clearDropped(live);
    countWording(live);
    if (at >= live.length) at = live.length - 1;
    if (at < 0) at = 0;
    for (var i = 0; i < steps.length; i++) steps[i].hidden = (steps[i] !== live[at]);
    back.hidden = (at === 0);
    next.hidden = (at === live.length - 1);
    if (fill) fill.style.width = Math.round(100 * (at + 1) / live.length) + '%';
    root.setAttribute('data-at', String(at + 1));
    root.setAttribute('data-of', String(live.length));
    var key = live[at] ? live[at].getAttribute('data-fstep') : '';
    root.setAttribute('data-screen', key);
  }

  function go(by) {
    var live = order();
    if (by > 0) {
      var field = live[at] ? live[at].querySelector('input[required], textarea[required]') : null;
      if (field && !field.checkValidity()) { field.reportValidity(); return; }
    }
    at += by;
    show();
    var top = root.getBoundingClientRect().top + window.pageYOffset - 12;
    window.scrollTo(0, top < 0 ? 0 : top);
    var first = live[at] ? live[at].querySelector('input:not([type=hidden]), textarea, button') : null;
    if (first && first.type !== 'file') { try { first.focus({ preventScroll: true }); } catch (e) { } }
  }

  back.addEventListener('click', function () { go(-1); });
  next.addEventListener('click', function () { go(1); });

  /* Enter in a one-line field means Next, never a surprise submit. */
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || el.type === 'file' || el.type === 'submit') return;
    e.preventDefault();
    go(1);
  });

  /* a chosen row also carries a class, so a browser without :has() still shows it */
  function markRows() {
    var labels = root.querySelectorAll('.v2opt');
    for (var i = 0; i < labels.length; i++) {
      var box = labels[i].querySelector('input');
      labels[i].classList.toggle('on', !!(box && box.checked));
    }
  }

  form.addEventListener('change', function () { mirror(); paintRoom(); markRows(); show(); });

  /* ------------------------------------------------------------ up to eight.
     The photo block on this page is the one that was already here, and its own
     script owns the list. This runs in the CAPTURE phase on the form, so it
     trims what a picker hands over BEFORE that script reads it. */
  form.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || el.type !== 'file' || !el.files || !el.files.length) return;
    if (!(el.hasAttribute('data-photo-input') || el.hasAttribute('data-photo-capture'))) return;
    var list = form.querySelector('[data-photo-list]');
    var have = list ? list.querySelectorAll('li').length : 0;
    var room = MAX_PHOTOS - have;
    if (room < 0) room = 0;
    if (el.files.length <= room) return;
    if (typeof DataTransfer !== 'function') return;
    try {
      var dt = new DataTransfer();
      for (var i = 0; i < room; i++) dt.items.add(el.files[i]);
      el.files = dt.files;
    } catch (err) { }
  }, true);

  mirror();
  paintRoom();
  markRows();
  show();
})();
