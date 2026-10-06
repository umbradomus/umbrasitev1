/* ============================================================================
   UMBRA DOMUS — THE MENU. (FRONT-DOOR-01, 2026-10-04)

   Drew chose "Shape 1 — The Menu": a price first, then the ask. This file is the
   ONE place every price lives. The home page (/ and /es) and the services page
   (/services and /es/servicios) both draw the menu from here, so a price is changed
   in one line and is right on four pages.

   WHAT THIS FILE DOES
     1. Draws the menu into every element marked data-menu, grouped, two tiles to a
        row on a phone. Each tile is a plain link into the request form:
            /services?menu=<key>#request        /es/servicios?menu=<key>#pedir
        With JavaScript off the host is empty and its <noscript> line stands; the
        pages' own words, the form and the footer are untouched.
     2. On the form page, reads ?menu=<key> and lands the customer with that job
        already chosen: the matching chooser tile is lit (which is what ticks
        `service` and `problem`, exactly as a thumb on the tile would), and the job's
        name is written into "Anything else, in a sentence" (`what`). Nothing is sent;
        the chooser's own screens, review and ONE Send stand as they are.

   THE POSTED-NAME CONTRACT IS UNCHANGED. Nothing here adds a field, renames one, or
   talks to the Worker. `tiles`, `service`, `problem` and `what` are the form's own.

   NO HOURLY FIGURE lives here, by his rule. A half day and a full day are the only
   time-shaped prices, and they are a visit, not a rate.
   ========================================================================== */
(function () {
  'use strict';

  var FORM = { en: { path: '/services', hash: 'request' }, es: { path: '/es/servicios', hash: 'pedir' } };

  var WORDS = {
    en: {
      from: 'from', each: 'each', piece: 'per piece',
      byText: 'Price by text',
      dayHead: 'Your whole list, one visit',
      dayLead: 'Hand us everything at once. Most lists fit in a half day.',
      half: 'Half day', full: 'Full day', hours4: '4 hours', hours8: '8 hours',
      bookHalf: 'Book a half day', bookFull: 'Book a full day',
      noscript: 'The price list needs JavaScript to show. Text (956) 556-6438 and we send it.'
    },
    es: {
      from: 'desde', each: 'c/u', piece: 'por pieza',
      byText: 'Precio por texto',
      dayHead: 'Toda su lista, una visita',
      dayLead: 'Entréguenos todo de una vez. La mayoría de las listas caben en medio día.',
      half: 'Medio día', full: 'Día completo', hours4: '4 horas', hours8: '8 horas',
      bookHalf: 'Reservar medio día', bookFull: 'Reservar un día completo',
      noscript: 'La lista de precios necesita JavaScript. Mande un texto al (956) 556-6438 y se la enviamos.'
    }
  };

  /* tile  = the chooser tile this job lights (assets/umbra-chooser-data.js)
     service = the `service` value that tile ticks — written here so a page can read it
               without the chooser, and so the walk can check the two agree */
  var GROUPS = [
    { key: 'house', en: 'Around the house', es: 'En la casa', items: [
      { key: 'bulbs', tile: 'else', service: 'Not sure', price: { amt: 89 },
        en: { name: 'Bulbs, smoke-detector batteries, filters', inc: 'Whole house, one visit' },
        es: { name: 'Focos, pilas de detectores de humo, filtros', inc: 'Toda la casa, en una visita' } },
      { key: 'tv', tile: 'else', service: 'Not sure', price: { amt: 119, from: true },
        en: { name: 'TV mounted', inc: 'Bracket on, cords tidy · brick or fireplace +$50' },
        es: { name: 'Televisión montada', inc: 'Soporte puesto, cables ordenados · en ladrillo o chimenea +$50' } },
      { key: 'hang', tile: 'else', service: 'Not sure', price: { amt: 69, from: true },
        en: { name: 'Shelves, mirrors, pictures hung', inc: 'Level and anchored right' },
        es: { name: 'Repisas, espejos y cuadros colgados', inc: 'Nivelados y bien anclados' } },
      { key: 'blinds', tile: 'else', service: 'Not sure', price: { amt: 45, unit: 'each' },
        en: { name: 'Blinds or curtain rods', inc: 'Hung and working' },
        es: { name: 'Persianas o cortineros', inc: 'Instalados y funcionando' } },
      { key: 'furniture', tile: 'else', service: 'Not sure', price: { amt: 79, from: true, unit: 'piece' },
        en: { name: 'Furniture assembled', inc: 'Built, leveled, box taken out' },
        es: { name: 'Muebles armados', inc: 'Armados, nivelados, la caja a la basura' } },
      { key: 'drywall', tile: 'hole', service: 'Drywall & Paint', price: { amt: 99, from: true },
        en: { name: 'Drywall patch, texture matched', inc: 'Patched, textured, ready for paint' },
        es: { name: 'Parche de tablaroca, textura igualada', inc: 'Parchado, texturizado, listo para pintar' } },
      { key: 'door', tile: 'door', service: 'Doors & Carpentry', price: { amt: 79, from: true },
        en: { name: 'Door that sticks or won’t latch', inc: 'Planed, adjusted, latching' },
        es: { name: 'Puerta que se atora o no cierra', inc: 'Cepillada, ajustada y cerrando bien' } },
      { key: 'caulk', tile: 'comfort', service: 'Comfort & Efficiency', price: { amt: 149, from: true },
        en: { name: 'Caulk and weatherstrip, whole house', inc: 'Tubs, sinks, windows and doors' },
        es: { name: 'Sellador y burletes, toda la casa', inc: 'Tinas, lavabos, ventanas y puertas' } },
      { key: 'screens', tile: 'else', service: 'Not sure', price: { amt: 39, from: true, unit: 'each' },
        en: { name: 'Window screens fixed or replaced', inc: 'New mesh, or a new frame' },
        es: { name: 'Mosquiteros reparados o nuevos', inc: 'Malla nueva, o marco nuevo' } },
      { key: 'windowunit', tile: 'else', service: 'Not sure', price: { amt: 69 },
        en: { name: 'Window unit put in or taken out', inc: 'Set, sealed and secured' },
        es: { name: 'Aparato de ventana puesto o quitado', inc: 'Colocado, sellado y asegurado' } },
      { key: 'appliance', tile: 'else', service: 'Not sure', price: { byText: true },
        en: { name: 'Appliance installation', inc: 'Set in place, connected and tested' },
        es: { name: 'Instalación de electrodomésticos', inc: 'Colocado, conectado y probado' } },
      { key: 'fans', tile: 'else', service: 'Not sure', price: { byText: true },
        en: { name: 'Ceiling fans', inc: 'A new fan, or the old one changed out' },
        es: { name: 'Ventiladores de techo', inc: 'Uno nuevo, o cambio del que hay' } },
      { key: 'dryervent', tile: 'else', service: 'Not sure', price: { amt: 99 },
        en: { name: 'Dryer vent cleaned', inc: 'Cleaned end to end, cover checked' },
        es: { name: 'Ducto de la secadora limpio', inc: 'Limpio de punta a punta, tapa revisada' } },
      { key: 'paint', tile: 'paint', service: 'Drywall & Paint', price: { amt: 349, from: true },
        en: { name: 'Room painted', inc: 'Walls, one color · paint extra' },
        es: { name: 'Cuarto pintado', inc: 'Paredes, un color · la pintura aparte' } }
    ] },
    { key: 'parents', en: 'For parents and grandparents', es: 'Para papás y abuelos', items: [
      { key: 'grabbars', tile: 'else', service: 'Not sure', price: { amt: 89, from: true, unit: 'each' },
        en: { name: 'Grab bars and handrails', inc: 'ADA-height, anchored to studs' },
        es: { name: 'Barras de apoyo y pasamanos', inc: 'Altura ADA, anclados a los postes de la pared' } },
      { key: 'wifi', tile: 'smart', service: 'Home Automation', price: { amt: 99 },
        en: { name: 'Wi-Fi, TV and streaming set up, explained slowly', inc: 'Set up, written down, shown twice' },
        es: { name: 'Wi-Fi, televisión y streaming instalados, explicados con calma', inc: 'Instalado, anotado y mostrado dos veces' } },
      { key: 'homecheck', tile: 'else', service: 'Not sure', price: { amt: 129 },
        en: { name: 'Home Check — a quarterly visit', inc: 'Filters, batteries, caulk, gutters, a photo report' },
        es: { name: 'Revisión del Hogar — una visita cada tres meses', inc: 'Filtros, pilas, sellador, canaletas y un reporte con fotos' } },
      { key: 'winterhome', tile: 'else', service: 'Not sure', price: { amt: 129 },
        en: { name: 'Winter-home open or close', inc: 'Walk-through, everything checked, photos sent' },
        es: { name: 'Abrir o cerrar la casa de temporada', inc: 'Recorrido completo, todo revisado, fotos enviadas' } }
    ] },
    { key: 'smart', en: 'Smart home', es: 'Casa inteligente', items: [
      { key: 'smart1', tile: 'smart', service: 'Home Automation', price: { amt: 99 },
        en: { name: 'One smart device set up', inc: 'Doorbell camera on your existing chime, smart lock, plugs, leak sensors' },
        es: { name: 'Un dispositivo inteligente instalado', inc: 'Timbre con cámara en su timbre actual, cerradura inteligente, enchufes, sensores de fugas' } },
      { key: 'smart3', tile: 'smart', service: 'Home Automation', price: { amt: 239 },
        en: { name: 'Three devices', inc: 'Any three from the list, one visit' },
        es: { name: 'Tres dispositivos', inc: 'Tres de la lista, en una visita' } }
    ] },
    { key: 'outside', en: 'Outside', es: 'Afuera', items: [
      { key: 'lawnpackage', tile: 'outside', service: 'Yard & Property', price: { amt: 69, from: false },
        en: { name: 'Lawn Enjoyment Package — each week',
              inc: 'Mowed, edged and blown, beds weeded by hand, dog waste picked up, ant mounds knocked down. Every other week also available' },
        es: { name: 'Paquete Disfrute su Patio — cada semana',
              inc: 'Cortado, orillado y soplado, jardineras desyerbadas a mano, popó del perro recogida, hormigueros deshechos. También cada dos semanas' } },
      { key: 'mow', tile: 'outside', service: 'Yard & Property', price: { amt: 35, from: false },
        en: { name: 'Lawn mowed, edged and blown',
              inc: 'Front and back cut, edges done, driveway and walk blown clean' },
        es: { name: 'Zacate cortado, orillado y soplado',
              inc: 'Enfrente y atrás cortado, orillado, entrada y banqueta sopladas' } },
      { key: 'weedbeds', tile: 'outside', service: 'Yard & Property', price: { amt: 45, from: false },
        en: { name: 'Flower beds weeded by hand',
              inc: 'Pulled by hand and bagged. No weed killer or chemical of any kind' },
        es: { name: 'Jardineras desyerbadas a mano',
              inc: 'Arrancadas a mano y embolsadas. Sin herbicidas ni químicos de ningún tipo' } },
      { key: 'dogwaste', tile: 'outside', service: 'Yard & Property', price: { amt: 45, from: false },
        en: { name: 'Dog waste picked up',
              inc: 'Whole yard walked and cleared, bagged into your own city cart' },
        es: { name: 'Popó del perro recogida',
              inc: 'Todo el patio recorrido y limpio, embolsada en su propio bote de la ciudad' } },
      { key: 'anthills', tile: 'outside', service: 'Yard & Property', price: { amt: 25, from: false },
        en: { name: 'Ant mounds knocked down by hand',
              inc: 'Shovel and hot water only. We do not apply any chemical, bait or pesticide' },
        es: { name: 'Hormigueros deshechos a mano',
              inc: 'Solo pala y agua caliente. No aplicamos ningún químico, cebo ni pesticida' } },
      { key: 'hosetimer', tile: 'outside', service: 'Yard & Property', price: { amt: 49, from: false },
        en: { name: 'Hose timer and sprinkler set up',
              inc: 'Your timer and sprinkler put on your outside faucet and programmed with you. Hose only, nothing in the ground' },
        es: { name: 'Timer de manguera y regadera instalados',
              inc: 'Su timer y su regadera en la llave de afuera, programados con usted. Solo manguera, nada enterrado' } },
      { key: 'hedges', tile: 'outside', service: 'Yard & Property', price: { amt: 60, from: true },
        en: { name: 'Hedges and shrubs trimmed',
              inc: 'Shaped and the trimmings bagged, up to six. Ground level, no tree or palm work' },
        es: { name: 'Arbustos y setos recortados',
              inc: 'Recortados y la basura embolsada, hasta seis. A nivel del suelo, sin trabajo de árboles ni palmas' } },
      { key: 'leafcleanup', tile: 'outside', service: 'Yard & Property', price: { amt: 75, from: true },
        en: { name: 'Yard raked, bagged and stacked at the curb',
              inc: 'Leaves and clippings bagged and set out the way the city wants them' },
        es: { name: 'Patio rastrillado, embolsado y puesto en la banqueta',
              inc: 'Hojas y recorte embolsados y acomodados como los pide la ciudad' } },
      { key: 'yardtrash', tile: 'outside', service: 'Yard & Property', price: { amt: 35, from: true },
        en: { name: 'Yard trash stacked at the curb for the city',
              inc: 'Brush and bulky sorted into separate piles, limbs under eight feet, clear of meters and wires. We do not haul it off' },
        es: { name: 'Basura del patio apilada en la banqueta',
              inc: 'Ramas y bultos en montones separados, ramas de menos de ocho pies, lejos de medidores y cables. No nos la llevamos' } },
      { key: 'gutters', tile: 'outside', service: 'Yard & Property', price: { amt: 99, from: false },
        en: { name: 'Gutters cleaned',
              inc: 'Cleared and flushed from a ladder, downspouts checked. One-storey homes, we do not go on roofs' },
        es: { name: 'Canaletas limpias',
              inc: 'Destapadas y enjuagadas desde escalera, bajantes revisadas. Casas de un piso, no subimos a los techos' } },
      { key: 'pressurewash', tile: 'outside', service: 'Yard & Property', price: { amt: 149, from: true },
        en: { name: 'Driveway or patio pressure-washed', inc: 'Washed and rinsed clean' },
        es: { name: 'Entrada o patio lavados a presión', inc: 'Lavados y enjuagados' } },
      { key: 'fence', tile: 'outside', service: 'Yard & Property', price: { amt: 89, from: true },
        en: { name: 'Fence, gate or mailbox fixed', inc: 'Boards, latches, posts reset' },
        es: { name: 'Cerca, portón o buzón reparados', inc: 'Tablas, pasadores, postes enderezados' } },
      { key: 'lights', tile: 'outside', service: 'Yard & Property', price: { amt: 199, from: true },
        en: { name: 'Holiday lights up, and down in January', inc: 'Your lights, hung and taken down' },
        es: { name: 'Luces navideñas puestas, y quitadas en enero', inc: 'Sus luces, colgadas y retiradas' } }
    ] },
    { key: 'rentals', en: 'For rentals and short-term hosts', es: 'Para rentas y anfitriones', items: [
      { key: 'turnover', tile: 'else', service: 'Not sure', price: { amt: 199, from: true },
        en: { name: 'Turnover check between tenants or guests', inc: 'Walk-through, small fixes, photos for your file' },
        es: { name: 'Revisión de cambio de inquilino o huésped', inc: 'Recorrido, arreglos pequeños, fotos para su expediente' } }
    ] }
  ];

  /* the two that are a visit, not a job — drawn as the card, never as tiles */
  var DAYS = [
    { key: 'halfday', tile: 'else', service: 'Not sure', price: { amt: 349 },
      en: { name: 'Half day — your whole list, one visit', inc: '4 hours' },
      es: { name: 'Medio día — toda su lista, una visita', inc: '4 horas' } },
    { key: 'fullday', tile: 'else', service: 'Not sure', price: { amt: 649 },
      en: { name: 'Full day — your whole list, one visit', inc: '8 hours' },
      es: { name: 'Día completo — toda su lista, una visita', inc: '8 horas' } }
  ];

  /* LANDLORDS-01 · the two care rows that carry no figure.
     They are NOT menu items: they are never drawn, they are not in UmbraMenu.items,
     and they hold no amount. They exist so the property care page can name its price
     in the words the CDO cleared — and so a tap on those two rows lands in the form
     the same way every other tile does. */
  var CARE = [
    { key: 'repairs', tile: 'else', service: 'Not sure',
      word: { en: 'Menu price, or by text', es: 'Precio del menú, o por texto' },
      en: { name: 'Repairs', inc: 'Drywall, paint, doors, trim, blinds, screens, fences and gates' },
      es: { name: 'Reparaciones', inc: 'Tablaroca, pintura, puertas, molduras, persianas, mosquiteros, cercas y portones' } },
    { key: 'tenantfix', tile: 'else', service: 'Not sure',
      word: { en: 'At your direction', es: 'Según sus indicaciones' },
      en: { name: 'Tenant repair request', inc: 'Your tenant sends the photo, you say yes, I send you the after' },
      es: { name: 'Pedido de reparación de su inquilino', inc: 'Su inquilino manda la foto, usted dice que sí, yo le mando el después' } }
  ];

  var ES = (document.documentElement.getAttribute('lang') || '').toLowerCase().indexOf('es') === 0;
  var LANG = ES ? 'es' : 'en';
  var W = WORDS[LANG];
  var F = FORM[LANG];

  var ALL = [];
  for (var g = 0; g < GROUPS.length; g++) for (var i = 0; i < GROUPS[g].items.length; i++) ALL.push(GROUPS[g].items[i]);
  for (var d = 0; d < DAYS.length; d++) ALL.push(DAYS[d]);

  function find(key) {
    for (var i = 0; i < ALL.length; i++) if (ALL[i].key === key) return ALL[i];
    for (var c = 0; c < CARE.length; c++) if (CARE[c].key === key) return CARE[c];
    return null;
  }
  function hrefOf(item) { return F.path + '?menu=' + encodeURIComponent(item.key) + '#' + F.hash; }
  function money(n) { return '$' + String(n); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function chev() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'mchev');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M9 5l7 7-7 7');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2.5');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p);
    return s;
  }
  function priceOf(item) {
    var p = el('span', 'mprice');
    /* a job his two prices have not landed on yet: the price slot carries the site's own
       words instead of a figure, never a number we made up (SITE-LICENCE-FLIP-01) */
    if (item.price.byText) { p.appendChild(el('span', 'mamt', W.byText)); return p; }
    if (item.price.from) p.appendChild(el('span', 'mfrom', W.from));
    p.appendChild(el('span', 'mamt', money(item.price.amt)));
    if (item.price.unit) p.appendChild(el('span', 'munit', W[item.price.unit]));
    return p;
  }
  function tile(item) {
    var li = el('li');
    var a = el('a', 'mtile');
    a.href = hrefOf(item);
    a.setAttribute('data-menu-item', item.key);
    a.setAttribute('data-tile', item.tile);
    a.setAttribute('data-service', item.service);
    var top = el('span', 'mtop');
    top.appendChild(el('span', 'mname', item[LANG].name));
    top.appendChild(el('span', 'minc', item[LANG].inc));
    a.appendChild(top);
    a.appendChild(priceOf(item));
    a.appendChild(chev());
    li.appendChild(a);
    return li;
  }
  function dayCard() {
    var card = el('div', 'daycard');
    card.setAttribute('data-menu-days', '1');
    card.appendChild(el('h3', null, W.dayHead));
    card.appendChild(el('p', null, W.dayLead));
    var days = el('div', 'days');
    for (var i = 0; i < DAYS.length; i++) {
      var dy = DAYS[i];
      var a = el('a', 'day');
      a.href = hrefOf(dy);
      a.setAttribute('data-menu-item', dy.key);
      a.setAttribute('data-tile', dy.tile);
      a.setAttribute('data-service', dy.service);
      a.setAttribute('aria-label', dy[LANG].name + ', ' + money(dy.price.amt));
      a.appendChild(el('span', 'l', i === 0 ? W.half : W.full));
      a.appendChild(el('span', 'v', money(dy.price.amt)));
      a.appendChild(el('span', 'h', dy[LANG].inc));
      days.appendChild(a);
    }
    card.appendChild(days);
    var btn = el('a', 'btn paper', W.bookHalf);
    btn.href = hrefOf(DAYS[0]);
    btn.setAttribute('data-menu-item', DAYS[0].key);
    btn.setAttribute('data-tile', DAYS[0].tile);
    btn.setAttribute('data-service', DAYS[0].service);
    card.appendChild(btn);
    return card;
  }

  function render(host) {
    host.textContent = '';
    for (var g = 0; g < GROUPS.length; g++) {
      var grp = GROUPS[g];
      var sec = el('div', 'menu-group');
      sec.setAttribute('data-menu-group', grp.key);
      sec.appendChild(el('h3', null, grp[LANG]));
      var ul = el('ul', 'menu-tiles');
      for (var i = 0; i < grp.items.length; i++) ul.appendChild(tile(grp.items[i]));
      sec.appendChild(ul);
      host.appendChild(sec);
    }
    host.appendChild(dayCard());
    host.setAttribute('data-menu-drawn', String(ALL.length));
  }

  /* ================================================================== THE LANDING
     On the form page: ?menu=<key> lights the chooser tile for that job and writes
     its name in the sentence box. It goes through the form's own events, so the
     chooser ticks `service`, the stepper re-orders its screens, and the draft is
     kept, exactly as if a thumb had done it. */
  function apply(key) {
    var item = find(key);
    if (!item) return false;
    var form = document.querySelector('form.req');
    if (!form) return false;
    var done = { key: key, tile: false, service: false, what: false };
    var svc = form.querySelector('input[name="service"][value="' + item.service.replace(/"/g, '\\"') + '"]');
    if (svc) { svc.checked = true; done.service = true; }
    var box = form.querySelector('input[name="tiles"][value="' + item.tile + '"]');
    if (box) {
      if (!box.checked) {
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }
      done.tile = true;
    }
    var what = form.querySelector('textarea[name="what"]');
    var line = item[LANG].name;
    if (what && what.value.indexOf(line) < 0) {
      what.value = what.value ? line + '\n' + what.value : line;
      what.dispatchEvent(new Event('input', { bubbles: true }));
      done.what = true;
    } else if (what) done.what = true;
    form.setAttribute('data-menu-pick', key);
    return done;
  }

  var hosts = document.querySelectorAll('[data-menu]');
  for (var h = 0; h < hosts.length; h++) render(hosts[h]);

  /* LANDLORDS-01 · a price slot on a page that writes its own tiles.
     <span class="mprice" data-menu-price="homecheck"></span> is filled from this file,
     so the property care page never holds a price of its own. */
  var slots = document.querySelectorAll('[data-menu-price]');
  for (var s = 0; s < slots.length; s++) {
    var slot = slots[s];
    var pick = find(slot.getAttribute('data-menu-price'));
    if (!pick) continue;
    slot.textContent = '';
    if (pick.price) {
      var built = priceOf(pick);
      while (built.firstChild) slot.appendChild(built.firstChild);
    } else if (pick.word) {
      slot.appendChild(el('span', 'munit', pick.word[LANG]));
    }
  }

  var picked = null;
  try {
    var q = new URLSearchParams(location.search);
    var want = q.get('menu');
    if (want && document.querySelector('form.req')) {
      picked = apply(want);
      if (picked) {
        /* the pick is now in the form; the address need not carry it any more, so a
           reload or a shared link does not light it twice */
        try { history.replaceState(history.state, '', location.pathname + (location.hash || '#' + F.hash)); } catch (e) { }
      }
    }
  } catch (e) { picked = null; }

  window.UmbraMenu = { groups: GROUPS, days: DAYS, items: ALL, find: find, href: hrefOf, apply: apply, render: render, picked: picked, lang: LANG };
})();
