/* umbra-phone.js - SITE-FIX-11 clause 1 · THE PHONE FIELD SAYS NO TO A NUMBER NOBODY CAN CALL.
   The walk-through found a request can leave with "123" in the phone box: the field is
   required and nothing else, so the customer finishes, the Worker cannot call anyone, and
   the job lands as "CALL THEM NOW - no US number on the request" with no number to call.

   ONE RULE, ONE SOURCE OF TRUTH. This is the browser copy of the rule the Worker already
   applies in worker/src/holding.js usNumber(): strip everything that is not a digit, drop a
   leading 1 from eleven digits, then it must be exactly ten digits in the US shape
   /^[2-9]\d{2}[2-9]\d{6}$/ and not a Caribbean area code. If the Worker would answer
   no_number or not_us, the screen says so first, in the form's own words, in the form's own
   message type (p.v2need[role=alert]) - the same sentence shape the address gate uses.
   Nothing about what the form POSTs changes: the customer's own typing is sent and the
   Worker normalises it, exactly as before. */
(function () {
  'use strict';

  var US_NUMBER = /^[2-9]\d{2}[2-9]\d{6}$/;
  /* worker/src/holding.js CARIBBEAN, copied digit for digit */
  var CARIBBEAN = ['242', '246', '264', '268', '284', '340', '345', '441', '473', '649', '658',
    '664', '670', '671', '684', '721', '758', '767', '784', '787', '809', '829', '849', '868',
    '869', '876', '939'];

  function callable(raw) {
    var d = String(raw == null ? '' : raw).replace(/[^0-9]/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    if (d.length !== 10 || !US_NUMBER.test(d)) return false;
    for (var i = 0; i < CARIBBEAN.length; i++) if (CARIBBEAN[i] === d.slice(0, 3)) return false;
    return true;
  }

  /* the form's own voice, the usted voice of /es, /es/servicios and /es/recibido */
  var ES = (document.documentElement.getAttribute('lang') || '').toLowerCase().indexOf('es') === 0;
  var T = ES
    ? { bad: 'Escriba un número de teléfono de 10 dígitos de Estados Unidos para poder contactarle.' }
    : { bad: 'Please enter a 10-digit US phone number so we can reach you.' };

  function boxes(root) {
    var found = (root || document).querySelectorAll('input[type="tel"][name="phone"]');
    return [].slice.call(found);
  }

  /* the sentence sits where the screen's other "what is missing" sentences sit: in the
     step, right under the field it is about. One element, made once, reused. */
  function need(input) {
    var lab = input.parentNode;
    while (lab && lab.nodeName !== 'LABEL' && lab !== document.body) lab = lab.parentNode;
    var anchor = (lab && lab.nodeName === 'LABEL') ? lab : input;
    var n = anchor.parentNode ? anchor.parentNode.querySelector('[data-uphone-need]') : null;
    if (!n) {
      n = document.createElement('p');
      n.className = 'v2need';
      n.setAttribute('role', 'alert');
      n.setAttribute('data-uphone-need', '1');
      n.hidden = true;
      if (anchor.parentNode) anchor.parentNode.insertBefore(n, anchor.nextSibling);
    }
    return n;
  }

  /* An empty box is not this gate's business: the form's own required message owns it. */
  function judge(input, say) {
    var n = need(input);
    var v = String(input.value == null ? '' : input.value).trim();
    if (!v) { n.hidden = true; n.textContent = ''; return true; }
    var good = callable(v);
    if (say || !good) { n.textContent = good ? '' : T.bad; n.hidden = good; }
    return good;
  }

  /* quiet while they are still typing: clear the sentence as soon as the number is callable */
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || t.nodeName !== 'INPUT' || t.name !== 'phone' || t.type !== 'tel') return;
    var n = need(t);
    if (!n.hidden && callable(t.value)) { n.hidden = true; n.textContent = ''; }
  }, true);

  /* the wizard's Next, hooked the way the address gate is hooked (umbra-intake-v2.js go()) */
  window.UMBRA_PHONE_GATE = function (step) {
    var list = boxes(step || document);
    var ok = true, first = null;
    for (var i = 0; i < list.length; i++) {
      if (!judge(list[i], true) && ok) { ok = false; first = list[i]; }
    }
    if (!ok && first) { try { first.focus(); } catch (err) { } }
    return ok;
  };

  /* the plain forms - /contact and /homes carry a required phone box and no wizard, so the
     same rule stops the submit there, the way umbra-address.js stops it for the address */
  function gate(e) {
    var form = e.target;
    if (!form || form.nodeName !== 'FORM') return;
    var list = boxes(form), bad = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].disabled) continue;
      if (!String(list[i].value == null ? '' : list[i].value).trim()) continue;
      if (!judge(list[i], true)) { bad = bad || list[i]; }
    }
    if (!bad) return;
    e.preventDefault(); e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    try { bad.focus(); } catch (err) { }
  }
  document.addEventListener('submit', gate, true);
})();
