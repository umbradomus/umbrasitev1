/* ============================================================================
   UMBRA DOMUS — "WHEN COULD WE COME?" (FORM-WINDOWS-01, 2026-09-23)

   The customer offers up to three times — a day from the next 14 (from
   TOMORROW, on Brownsville's clock; Sundays off), and a block of that day —
   or says "I'm flexible". The two-hour reply then confirms one of them.

   A day is a button, never a date input: a plain date input cannot hide a
   Sunday. Tapping a day opens its four blocks; tapping a block adds the pick;
   every pick is a chip that removes itself when tapped. No state is shown by
   colour alone — a picked block says "Picked", a day with picks says how many.

   WHAT IT POSTS (the Worker's worker/src/windows.js reads it):
       avail_choice      one per pick, in the order picked: "YYYY-MM-DD HH-HH"
       time_1..3         the same picks in plain words, for the email copy
       times_flexible    "Yes — any time works" | "No"
       text_consent      "Yes — agreed to texts about this request (sms-v1)" | "No"
   The flexible box (avail_flexible), the note (avail_notes), the consent box
   (sms_consent) and the markers (avail_form, sms_consent_lang) are in the
   markup, so they post as they are.

   WITH JAVASCRIPT OFF the screen shows its flexible box and its note, and the
   form posts to its own action exactly as before.
   ========================================================================== */
(function () {
  var form = document.querySelector('form.req');
  if (!form) return;
  var box = form.querySelector('[data-windows]');
  if (!box) return;

  var ES = (document.documentElement.getAttribute('lang') || '').toLowerCase().indexOf('es') === 0;
  var TZ = 'America/Chicago';
  var HORIZON = 14;
  var MAX = 3;

  var BLOCKS = [
    { key: '08-11', en: 'Morning 8–11', es: 'Mañana 8–11' },
    { key: '11-14', en: 'Midday 11–2', es: 'Mediodía 11–2' },
    { key: '14-17', en: 'Afternoon 2–5', es: 'Tarde 2–5' },
    { key: '17-20', en: 'Evening 5–8', es: 'Noche 5–8' }
  ];
  var DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOW_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var MON_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  var T = ES ? {
    which: function (d) { return '¿A qué hora el ' + d + '?'; },
    picked: 'Elegido',
    count: function (n) { return n + ' de ' + MAX + ' elegidos'; },
    full: 'Ya eligió 3. Quite uno para cambiarlo.',
    remove: function (s) { return 'Quitar ' + s; },
    dayHas: function (n) { return n === 1 ? '1 elegido' : n + ' elegidos'; },
    none: 'Todavía no ha elegido ningún horario.'
  } : {
    which: function (d) { return 'Which part of ' + d + '?'; },
    picked: 'Picked',
    count: function (n) { return n + ' of ' + MAX + ' picked'; },
    full: "You've picked 3. Remove one to change it.",
    remove: function (s) { return 'Remove ' + s; },
    dayHas: function (n) { return n === 1 ? '1 picked' : n + ' picked'; },
    none: 'No times picked yet.'
  };

  /* ---------------------------------------------------------- the calendar */
  function todayCentral() {
    var p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date());
    function g(t) { for (var i = 0; i < p.length; i++) if (p[i].type === t) return parseInt(p[i].value, 10); return 0; }
    return { y: g('year'), m: g('month'), d: g('day') };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(dt) { return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()); }
  /* Plain words stay English on both pages for the email (the posted values are English on both, as today). */
  function shortEn(dt) { return DOW_EN[dt.getUTCDay()] + ' ' + (dt.getUTCMonth() + 1) + '/' + dt.getUTCDate(); }
  function shortShown(dt) {
    return ES ? DOW_ES[dt.getUTCDay()] + ' ' + dt.getUTCDate() + ' ' + MON_ES[dt.getUTCMonth()] : shortEn(dt);
  }
  function blockOf(key) { for (var i = 0; i < BLOCKS.length; i++) if (BLOCKS[i].key === key) return BLOCKS[i]; return null; }

  var cfg = { allowSunday: false, blocked: {} };
  function days() {
    var t = todayCentral(), out = [];
    for (var i = 1; i <= HORIZON; i++) {
      var dt = new Date(Date.UTC(t.y, t.m - 1, t.d + i));
      var iso = isoOf(dt);
      if (dt.getUTCDay() === 0 && !cfg.allowSunday) continue;
      if (cfg.blocked[iso]) continue;
      out.push({ iso: iso, dt: dt });
    }
    return out;
  }

  /* ------------------------------------------------------------- the state */
  var picks = [];          /* [{ date, block, dt }] in the order picked */
  var openDay = null;      /* iso of the day whose blocks are showing */

  var grid = box.querySelector('[data-wdays]');
  var panel = box.querySelector('[data-wblocks]');
  var legend = box.querySelector('[data-wlegend]');
  var blockList = box.querySelector('[data-wblocklist]');
  var fullNote = box.querySelector('[data-wfull]');
  var pickList = box.querySelector('[data-wpicks]');
  var countLine = box.querySelector('[data-wcount]');
  var flex = form.querySelector('input[name="avail_flexible"]');
  var consent = form.querySelector('input[name="sms_consent"]');
  var out = box.querySelector('[data-wout]');
  if (!grid || !panel || !blockList || !pickList || !out) return;

  function wordsOf(p, n) { return n + ' · ' + shortEn(p.dt) + ' · ' + blockOf(p.block).en; }
  function shownOf(p) { return shortShown(p.dt) + ' · ' + blockOf(p.block)[ES ? 'es' : 'en']; }
  function hasPick(date, block) {
    for (var i = 0; i < picks.length; i++) if (picks[i].date === date && picks[i].block === block) return i;
    return -1;
  }
  function countOn(date) { var n = 0; for (var i = 0; i < picks.length; i++) if (picks[i].date === date) n++; return n; }

  function hidden(name, value) {
    var el = document.createElement('input');
    el.type = 'hidden'; el.name = name; el.value = value;
    return el;
  }

  /* The posted answers, rebuilt on every change so they are ready whenever the form is sent. */
  function writeOut() {
    out.innerHTML = '';
    for (var i = 0; i < picks.length; i++) {
      var h = hidden('avail_choice', picks[i].date + ' ' + picks[i].block);
      h.setAttribute('data-picked', '1');
      out.appendChild(h);
    }
    for (var j = 0; j < picks.length; j++) out.appendChild(hidden('time_' + (j + 1), wordsOf(picks[j], j + 1)));
    out.appendChild(hidden('times_flexible', flex && flex.checked ? 'Yes — any time works' : 'No'));
    out.appendChild(hidden('text_consent', consent && consent.checked ? 'Yes — agreed to texts about this request (sms-v1)' : 'No'));
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function drawDays() {
    grid.innerHTML = '';
    var list = days();
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      var b = el('button', 'wday');
      b.type = 'button';
      b.setAttribute('data-date', d.iso);
      b.setAttribute('aria-pressed', openDay === d.iso ? 'true' : 'false');
      b.setAttribute('aria-controls', panel.id || '');
      var parts = shortShown(d.dt).split(' ');
      b.appendChild(el('span', 'wdow', parts[0]));
      b.appendChild(el('span', 'wdate', parts.slice(1).join(' ')));
      var n = countOn(d.iso);
      if (n) { b.appendChild(el('span', 'whas', '✓ ' + T.dayHas(n))); b.classList.add('has'); }
      b.setAttribute('aria-label', shortShown(d.dt) + (n ? ', ' + T.dayHas(n) : ''));
      grid.appendChild(b);
    }
  }

  function drawBlocks() {
    if (!openDay) { panel.hidden = true; return; }
    var dt = null, list = days();
    for (var i = 0; i < list.length; i++) if (list[i].iso === openDay) dt = list[i].dt;
    if (!dt) { openDay = null; panel.hidden = true; return; }
    panel.hidden = false;
    if (legend) legend.textContent = T.which(shortShown(dt));
    blockList.innerHTML = '';
    var full = picks.length >= MAX;
    for (var k = 0; k < BLOCKS.length; k++) {
      var bl = BLOCKS[k];
      var on = hasPick(openDay, bl.key) > -1;
      var b = el('button', 'wblock' + (on ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('data-block', bl.key);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.appendChild(el('span', 'wblabel', bl[ES ? 'es' : 'en']));
      if (on) b.appendChild(el('span', 'wbon', '✓ ' + T.picked));
      if (full && !on) b.disabled = true;
      blockList.appendChild(b);
    }
    if (fullNote) fullNote.hidden = !full;
  }

  function drawPicks() {
    pickList.innerHTML = '';
    for (var i = 0; i < picks.length; i++) {
      var li = el('li');
      var b = el('button', 'wpick');
      b.type = 'button';
      b.setAttribute('data-remove', String(i));
      b.setAttribute('aria-label', T.remove(shownOf(picks[i])));
      b.appendChild(el('span', 'wpn', String(i + 1)));
      b.appendChild(el('span', 'wpt', shownOf(picks[i])));
      b.appendChild(el('span', 'wpx', '✕'));
      b.lastChild.setAttribute('aria-hidden', 'true');
      li.appendChild(b);
      pickList.appendChild(li);
    }
    if (countLine) countLine.textContent = picks.length ? T.count(picks.length) : T.none;
  }

  function draw() {
    drawDays(); drawBlocks(); drawPicks(); writeOut();
    box.setAttribute('data-picks', String(picks.length));
    /* the "pick one or say flexible" note clears the moment either is true */
    var need = box.closest('[data-fstep]');
    var note = need ? need.querySelector('.v2need') : null;
    if (note && (picks.length || (flex && flex.checked))) note.hidden = true;
  }

  function focusSel(sel) {
    var t = box.querySelector(sel);
    if (!t) return false;
    try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); }
    return true;
  }

  grid.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.wday') : null;
    if (!b) return;
    var iso = b.getAttribute('data-date');
    openDay = (openDay === iso) ? null : iso;
    draw();
    if (openDay) { if (!focusSel('.wblock:not([disabled])')) focusSel('.wblock'); }
    else focusSel('.wday[data-date="' + iso + '"]');
  });

  blockList.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.wblock') : null;
    if (!b || b.disabled || !openDay) return;
    var key = b.getAttribute('data-block');
    var at = hasPick(openDay, key);
    var day = openDay;
    if (at > -1) picks.splice(at, 1);
    else if (picks.length < MAX) {
      var list = days(), dt = null;
      for (var i = 0; i < list.length; i++) if (list[i].iso === day) dt = list[i].dt;
      if (dt) picks.push({ date: day, block: key, dt: dt });
    }
    /* A pick is made: back to the days, focus on the day just used, ready for the next one. */
    openDay = null;
    draw();
    focusSel('.wday[data-date="' + day + '"]');
  });

  pickList.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.wpick') : null;
    if (!b) return;
    var i = parseInt(b.getAttribute('data-remove'), 10);
    if (i >= 0 && i < picks.length) picks.splice(i, 1);
    draw();
    var left = box.querySelectorAll('.wpick');
    if (left.length) { try { left[Math.min(i, left.length - 1)].focus(); } catch (err) {} }
    else focusSel('.wday');
  });

  /* Escape closes an open day and returns to its chip. */
  box.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openDay) {
      var day = openDay; openDay = null; draw(); focusSel('.wday[data-date="' + day + '"]');
    }
  });

  form.addEventListener('change', function (e) {
    if (e.target === flex || e.target === consent) draw();
  });

  /* What the Worker allows beyond the default: Sundays (ALLOW_SUNDAY) and blocked dates. The page never
     waits for it — the default (no Sundays, nothing blocked) is drawn first, and the Worker re-checks
     every pick anyway. */
  function loadConfig() {
    var base = String(window.UMBRA_API_BASE || '').replace(/\/+$/, '');
    if (!base || !window.fetch) return;
    fetch(base + '/api/windows', { method: 'GET', mode: 'cors', credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) {
        if (!c) return;
        cfg.allowSunday = c.allow_sunday === true;
        cfg.blocked = {};
        (c.blocked_dates || []).forEach(function (d) { cfg.blocked[d] = true; });
        picks = picks.filter(function (p) { return !cfg.blocked[p.date]; });
        box.setAttribute('data-config', 'loaded');
        draw();
      })
      .catch(function () { /* the default stands */ });
  }

  box.classList.add('js');
  draw();
  loadConfig();
})();
