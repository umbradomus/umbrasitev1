/* SITE-FIX-01 · the Spanish page gets exactly the structure the English one got:
   the same chooser, the same tile screens, the same "a few last things", the same
   review and the same one Send — with the same posted field names.
   Run: node tools/site-fix-01-es.mjs */
import fs from 'node:fs';

const F = 'es/servicios.html';
let s = fs.readFileSync(F, 'utf8');
const was = s.length;
let n = 0;
function swap(from, to, what) {
  if (!s.includes(from)) { console.log('MISS:', what); return; }
  s = s.split(from).join(to);
  n++;
  console.log('ok:', what);
}

/* 1 · the scripts, in the order the chooser needs (chooser before the stepper) */
swap(
  `<script src="/assets/umbra-intake-v2.js?v=9" defer></script>`,
  `<!-- SITE-FIX-01 · the key's one place. Ships EMPTY; only Drew fills it in. -->
<script src="/site.config.js?v=1"></script>
<!-- SITE-FIX-01 · el selector. El archivo de datos tiene cada opción, cada pregunta
     y la lista, en los dos idiomas. Tiene que correr ANTES del formulario por pasos. -->
<script src="/assets/umbra-chooser-data.js?v=1" defer></script>
<script src="/assets/umbra-address.js?v=1" defer></script>
<script src="/assets/umbra-chooser.js?v=1" defer></script>
<script src="/assets/umbra-intake-v2.js?v=10" defer></script>`,
  'scripts');

/* 2 · the band's own heading is the chooser's heading — "Fix something" lands on it */
swap(
  `      <h2>Cuéntenos qué pasa.</h2>
      <p class="lead">Unas fotos y unas preguntas rápidas. Sin cuenta, sin correo. Recibirá una confirmación que dice cuándo le contestamos.</p>
      <p>Si el trabajo no queda bien, regresamos y lo arreglamos. Usted no paga dos veces por el mismo trabajo.</p>`,
  `      <h2 id="request-top">Díganos qué está mal. Nosotros le decimos qué necesita.</h2>
      <p class="lead">Toque lo que suene como su casa. Sin cuenta, sin correo, y no se manda nada hasta que usted lo revise.</p>`,
  'heading');

/* 3 · no category is preselected anywhere */
swap(
  `<label><input type="radio" name="service" value="Drywall &amp; Paint" checked><span>Drywall &amp; Paint</span></label>`,
  `<label><input type="radio" name="service" value="Drywall &amp; Paint"><span>Drywall &amp; Paint</span></label>`,
  'no preselected category');

/* 4 · the chooser screen and the per-tile screens */
swap(
  `        <div class="intake2" data-intake2>
          <div class="v2bar" aria-hidden="true"><i data-v2fill></i></div>
        <section class="fstep" data-fstep="photos" hidden>`,
  `        <div class="intake2" data-intake2>
          <div class="v2bar" aria-hidden="true"><i data-v2fill></i></div>
        <!-- SITE-FIX-01 · EL SELECTOR. "Arreglar algo" llega AQUÍ, arriba de esta
             pantalla — nunca a un formulario ya lleno, sin categoría preseleccionada
             y sin nada enfocado. Lo dibuja /assets/umbra-chooser.js. -->
        <section class="fstep ch-step" data-fstep="chooser" hidden></section>
        <!-- SITE-FIX-01 · una pantalla de preguntas por cada opción encendida. -->
        <div data-tile-steps></div>
        <section class="fstep" data-fstep="photos" hidden>`,
  'chooser screen');

/* 5 · "a few last things" sits BEFORE the sentence: the last three screens in this
   file must stay notes, times, send — the time picker's suite reads that order. */
swap(
  `        <section class="fstep" data-fstep="notes" hidden>
          <label class="v2field"><span class="v2q">¿Algo más que debamos saber?</span><span class="v2hint">Opcional</span><textarea class="field" name="what" rows="4"></textarea></label>
        </section>`,
  `        <!-- SITE-FIX-01 · tres filas de un toque, todas opcionales. -->
        <section class="fstep ch-step" data-fstep="details" hidden></section>
        <section class="fstep" data-fstep="notes" hidden>
          <label class="v2field"><span class="v2q">Algo más, en una frase</span><span class="v2hint">Opcional &mdash; toque el micrófono de su teclado para hablar.</span><textarea class="field" name="what" rows="4"></textarea></label>
        </section>`,
  'details screen + the sentence');

/* 6 · the one Send, revealed on the review screen and nowhere else */
swap(
  `<button class="btn v2send" type="submit" data-v2send hidden>Enviar</button>`,
  `<!-- SITE-FIX-01 · EL ÚNICO Enviar. Sólo aparece en la pantalla de revisión. -->
            <button class="btn v2send" type="submit" data-v2send hidden>Enviar &mdash; le contestamos en menos de 2 horas.</button>`,
  'the one Send');

fs.writeFileSync(F, s);
console.log('edits applied:', n, '| bytes', was, '->', s.length);
