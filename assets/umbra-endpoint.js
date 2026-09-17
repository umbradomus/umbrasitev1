/* ============================================================================
   UMBRA DOMUS — WHERE THE REQUEST FORM POSTS, AND WHERE THE STATUS PAGE LOOKS.

   THIS IS THE ONE PLACE. Change the one line below and the whole site follows:
   the four request forms, the confirmation page and the status page.

       ''                                      → FormSubmit, exactly as today
       'https://umbra-intake.<you>.workers.dev' → our own Worker

   Leaving it '' is today's behaviour, byte for byte. Nothing else changes.

   With JavaScript switched off the forms still carry their own action attribute,
   which stays on FormSubmit — so a no-JS submit is never lost, it just arrives
   as an email only.
   ========================================================================== */

/* ▼▼▼ THE ONE LINE ▼▼▼ */
window.UMBRA_WORKER_BASE = 'https://umbra-intake.umbradomus.workers.dev';
/* ▲▲▲ THE ONE LINE ▲▲▲ */

(function () {
  var FORMSUBMIT = 'https://formsubmit.co/07242513cc0b8b4dac5ae320baa7c431';
  var base = String(window.UMBRA_WORKER_BASE || '').replace(/\/+$/, '');

  /* Where the form posts. */
  window.UMBRA_FORM_ACTION = base ? base + '/intake' : FORMSUBMIT;
  /* Where /status and /request-received ask about a job. '' means there is no
     Worker yet, and those pages keep their honest "it's being built" copy. */
  window.UMBRA_API_BASE = base;

  function apply() {
    var forms = document.querySelectorAll('form.req');
    for (var i = 0; i < forms.length; i++) forms[i].setAttribute('action', window.UMBRA_FORM_ACTION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
