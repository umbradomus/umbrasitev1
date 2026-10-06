/* ============================================================================
   UMBRA DOMUS — THE DRYWALL-HOLES INTAKE (WSS-03 · R17 · R17b · R17d · R17e)

   The old form asked "how many holes?" once. Drew's own job broke it: fifteen in
   the ceiling, four on the walls, some open, some with a plastic anchor still in
   them, some patched and showing. One count cannot describe two places, and the
   CONDITION of a hole is what changes the labour most. So the quantity block
   repeats PER PLACE, and a customer only ever sees a card for a place they
   themselves tapped.

   THE POSTED-NAME CONTRACT (R17e) — flat names, never nested, never JSON:
       problem              one value
       problem_area         REPEATED, one part per place tapped
       <place>_count_band   <place>_count_exact   <place>_biggest
       <place>_condition    REPEATED, one part per box checked
       <place>_surface
       paint_on_site
   where <place> is ceiling, walls, corner or opening.

   A PLACE NOBODY TAPPED POSTS NO FIELDS AT ALL — not empty ones. That is not
   done by pruning on submit; every control in this block ships DISABLED in the
   markup and is only enabled when its own place is tapped. A disabled control is
   never submitted, so an untapped corner cannot leave a `corner_*` key in the
   record even if the script is half-loaded or a browser restores old state.

   With JavaScript off nothing here is ever enabled or revealed, so the form
   degrades to exactly the form it was: name, phone, address, what, photos.
   ========================================================================== */
(function () {
  var intake = document.querySelector('[data-intake]');
  if (!intake) return;
  var form = intake.closest ? intake.closest('form') : null;
  if (!form) return;

  var problemStep = intake.querySelector('[data-intake-problem]');
  var holesStep   = intake.querySelector('[data-intake-holes]');
  var gateLine    = intake.querySelector('[data-gate]');
  var whatField   = form.querySelector('textarea[name="what"]');
  var whatLabel   = form.querySelector('[data-what-label]');
  var whatHint    = form.querySelector('[data-what-hint]');
  if (!problemStep || !holesStep) return;

  var NOT_SURE = 'Not sure — you count';   /* em dash, as the approved reference writes it */
  var SERVICE  = 'Drywall & Paint';
  var PROBLEM  = 'Holes to patch';

  /* THE FOUR SENTENCES THIS FILE PUTS ON THE PAGE (SITE-FIX-13).
     The posted names and values above are the contract and stay English in every
     language. These four are not posted - they are read by the customer, and
     /es/casas and /es/contacto carry this block too, so a Spanish customer must
     not be handed them in English. The page says which language it is in and this
     file never guesses from the path: the same test, for the same reason, as
     assets/umbra-status.js (SITE-FIX-11 clause 2). The Spanish is the usted voice
     of /es and /es/servicios. The English half below is the English this file has
     always written, word for word, so an English page reads exactly as before. */
  var ES = (document.documentElement.getAttribute('lang') || '').toLowerCase().indexOf('es') === 0;
  var W = ES ? {
    gateKnown:   'Ya tenemos todos los números que necesitamos, así que de esto se puede sacar un precio — sin adivinar.',
    gateMissing: 'Falta un conteo o nos lo dejó a nosotros, así que esto queda SIN COTIZAR hasta que lo veamos — esa es la respuesta honesta, no un precio adivinado.',
    whatLabel:   '¿Algo más que debamos saber?',
    whatHint:    'Opcional — lo que tocó arriba ya nos dijo casi todo.'
  } : {
    gateKnown:   'Every number we need is here, so a price can be generated from this — no guessing.',
    gateMissing: 'A count is missing or left to us, so this stays NOT QUOTABLE until we look — which is the honest answer, not a guessed price.',
    whatLabel:   'Anything else we should know?',
    whatHint:    'Optional — the taps above told us most of it.'
  };

  var serviceInputs = form.querySelectorAll('input[name="service"]');
  var problemInputs = problemStep.querySelectorAll('input[name="problem"]');
  var whereInputs   = holesStep.querySelectorAll('input[name="problem_area"]');
  var paintInputs   = holesStep.querySelectorAll('input[name="paint_on_site"]');
  var cards         = holesStep.querySelectorAll('[data-card]');

  /* what the `what` box said before the taps took its job over */
  var whatWas = {
    label: whatLabel ? whatLabel.textContent : '',
    hint:  whatHint ? whatHint.textContent : '',
    required: whatField ? whatField.required : false
  };

  function setDisabled(nodes, off) {
    for (var i = 0; i < nodes.length; i++) nodes[i].disabled = off;
  }
  function checked(nodes) {
    for (var i = 0; i < nodes.length; i++) if (nodes[i].checked) return nodes[i];
    return null;
  }

  /* The picture highlights what the words mean. Ported from the approved
     reference unchanged — the chips do the selecting, the room only teaches. */
  function paintRoom(live) {
    var all = intake.querySelectorAll('.zone, .edge');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
    if (!live) return;
    for (var j = 0; j < whereInputs.length; j++) {
      if (!whereInputs[j].checked) continue;
      (whereInputs[j].getAttribute('data-z') || '').split(' ').forEach(function (id) {
        if (!id) return;
        var el = document.getElementById(id);
        if (!el) return;
        if (el.tagName === 'g') {
          var edges = el.querySelectorAll('.edge');
          for (var k = 0; k < edges.length; k++) edges[k].classList.add('on');
        } else {
          el.classList.add('on');
        }
      });
    }
  }

  /* THE HONESTY GATE IS IN THE DATA, NOT IN ANYONE'S JUDGEMENT.
     Every tapped place has a count -> a price can be generated with no guessing.
     Any count left to us -> NOT QUOTABLE until we look. The rule is the approved
     reference's own `known` test, lifted line for line. */
  function gate(live) {
    if (!gateLine) return;
    var open = [];
    for (var i = 0; i < whereInputs.length; i++) {
      if (whereInputs[i].checked) open.push(whereInputs[i].getAttribute('data-area'));
    }
    if (!live || !open.length) { gateLine.hidden = true; gateLine.textContent = ''; return; }
    var known = open.every(function (place) {
      var exact = holesStep.querySelector('input[name="' + place + '_count_exact"]');
      if (exact && String(exact.value).trim() !== '') return true;
      var band = checked(holesStep.querySelectorAll('input[name="' + place + '_count_band"]'));
      return Boolean(band) && band.value !== NOT_SURE;
    });
    gateLine.hidden = false;
    gateLine.className = known ? 'gate' : 'gate warn';
    gateLine.textContent = known ? W.gateKnown : W.gateMissing;
  }

  /* `what` stops being the only description once the taps carry it (R17/R17e).
     It demotes only while the holes block is open — a customer who taps nothing
     still has to tell us what is wrong, which is the form we have today. */
  function demoteWhat(live) {
    if (!whatField) return;
    whatField.required = live ? false : whatWas.required;
    if (whatLabel) whatLabel.textContent = live ? W.whatLabel : whatWas.label;
    if (whatHint) whatHint.textContent = live ? W.whatHint : whatWas.hint;
  }

  /* One function recomputes the whole block from the answers, every time.
     Nothing is toggled incrementally, so the enabled set can never drift out of
     step with what the customer can actually see. */
  function sync() {
    var service = checked(serviceInputs);
    var onService = Boolean(service) && service.value === SERVICE;
    intake.hidden = !onService;
    problemStep.hidden = !onService;
    setDisabled(problemInputs, !onService);

    var problem = onService ? checked(problemInputs) : null;
    var onHoles = Boolean(problem) && problem.value === PROBLEM;
    holesStep.hidden = !onHoles;
    setDisabled(whereInputs, !onHoles);
    setDisabled(paintInputs, !onHoles);

    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var place = card.getAttribute('data-card');
      var box = holesStep.querySelector('input[name="problem_area"][data-area="' + place + '"]');
      var on = onHoles && Boolean(box) && box.checked;
      card.hidden = !on;
      setDisabled(card.querySelectorAll('input'), !on);
    }

    paintRoom(onHoles);
    gate(onHoles);
    demoteWhat(onHoles);
  }

  form.addEventListener('change', sync);
  form.addEventListener('input', function (e) {
    /* the exact-number box moves the gate as it is typed */
    if (e.target && /_count_exact$/.test(e.target.name || '')) gate(!holesStep.hidden);
  });
  sync();
})();
