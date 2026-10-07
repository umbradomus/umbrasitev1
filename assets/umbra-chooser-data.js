/* ============================================================================
   UMBRA DOMUS — THE CHOOSER'S DATA. ONE FILE, ONE PLACE. (SITE-FIX-01, 2026-09-28)

   His words: "we need when we press fix something for there be to a really easy
   customer experience to be able to tell our form whats wrong ... super easy to
   maybe even find something that is wrong but you werent even thinking about it."

   Everything the chooser shows lives here and nowhere else: the symptom tiles,
   what each tile means in the Worker's own `service` list, the questions that
   belong to that tile, and the "while we're there" checklist. A new tile is added
   HERE — no page is edited, no script is edited.

   THE POSTED-NAME CONTRACT. Nothing here renames a field the Worker already
   reads. The tiles tick `service` and `problem`, which the form has always sent.
   Everything a tile asks travels in ONE ADDED field, `answers`, as plain
   "tile: question = answer" lines, and the checklist in ONE ADDED field,
   `while_there`. Added, never renamed — so the Flux Capacitor's leg 1 keeps the
   contract it walked 18/18 on.

   THE HOLE TILE IS DIFFERENT, on purpose. Its questions are the ones the page has
   always asked (ceiling_count_band, walls_biggest, ceiling_surface and the rest),
   so those field names keep carrying exactly what they always carried — and now
   ONLY when the hole tile is lit. A customer who only wants paint is never shown
   a hole question again. `legacy: true` below is what marks that.

   WHAT IS NEVER HERE. Electrical, plumbing, A/C and security are licensed trades
   and not ours: no switch, no thermostat, no doorbell, no camera, no lock, and no
   bug or termite line appears in any tile, any question or the checklist, in
   either language.
   ========================================================================== */
(function () {
  'use strict';

  /* A tile:
       key       the value posted in `tiles`, and the name a question's answer carries
       service   the Worker's own `service` value this tile means (the FIRST lit tile wins)
       problem   values ticked on the form's existing `problem` boxes ([] = none)
       legacy    true  -> this tile's questions are the page's own steps, by their own field names
       en / es   { label, sub } — the tile's words. `sub` is the plain-words line under it.
       photo     the per-tile photo ask
       questions each { key, multi, en:{q, opts[]}, es:{q, opts[]} } — ONE screen, one Continue,
                 nothing preselected, no auto-jump. Every list ends with "Not sure".
                 A question may carry when:{ q, opts[] } — it is asked only while one of
                 that question's options, BY POSITION (so the rule needs no translating),
                 is ticked. A question that stops being asked forgets its answer.
  */
  var NOT_SURE_EN = 'Not sure', NOT_SURE_ES = 'No estoy seguro';

  var TILES = [
    {
      key: 'hole', service: 'Drywall & Paint', problem: ['Holes'], legacy: true,
      en: { label: 'A hole, crack or stain on a wall or ceiling',
            sub: 'Anything that needs patching before it can be painted' },
      es: { label: 'Un hoyo, una grieta o una mancha en una pared o techo',
            sub: 'Cualquier cosa que haya que resanar antes de pintar' },
      photo: { en: 'The whole thing from the doorway, then up close with your hand next to it for size.',
               es: 'Todo desde la puerta, y luego de cerca con su mano al lado para el tamaño.' },
      questions: [
        { key: 'wet', multi: false,
          en: { q: 'Is it wet or damp right now?', opts: ['Yes', 'No', NOT_SURE_EN] },
          es: { q: '¿Está mojado o húmedo ahora mismo?', opts: ['Si', 'No', NOT_SURE_ES] } }
      ]
    },
    {
      key: 'paint', service: 'Drywall & Paint', problem: ['Just paint'],
      en: { label: 'Paint — peeling, faded, or a room to repaint',
            sub: 'Inside or outside, one wall or the whole room' },
      es: { label: 'Pintura — descascarada, descolorida, o un cuarto para repintar',
            sub: 'Adentro o afuera, una pared o el cuarto entero' },
      photo: { en: 'The whole wall or ceiling from the doorway, then up close with your hand next to it for size.',
               es: 'Toda la pared o el techo desde la puerta, y luego de cerca con su mano al lado.' },
      questions: [
        { key: 'what_gets_paint', multi: true,
          en: { q: 'What needs paint?', opts: ['A ceiling', 'The walls', 'The whole room, ceiling and walls', 'Trim and doors', 'Outside', NOT_SURE_EN] },
          es: { q: '¿Qué se va a pintar?', opts: ['Un techo', 'Las paredes', 'El cuarto entero, techo y paredes', 'Molduras y puertas', 'Afuera', NOT_SURE_ES] } },
        { key: 'all_or_spot', multi: false,
          en: { q: 'All of it, or just a spot?', opts: ['The whole thing', 'Just a patch or spot', NOT_SURE_EN] },
          es: { q: '¿Todo, o sólo una parte?', opts: ['Todo', 'Sólo un parche o una parte', NOT_SURE_ES] } },
        /* SITE-FIX-01.1 · AMEND A6.2, as the ignite cuts it: "how many rooms" is asked ONLY
           when the walls or the whole room get paint. A ceiling is not rooms, and his own job
           is a ceiling. `when` names the question it depends on and the OPTIONS BY POSITION,
           so the one rule holds in both languages without a word of it being written twice. */
        { key: 'rooms', multi: false, when: { q: 'what_gets_paint', opts: [1, 2] },
          en: { q: 'How many rooms?', opts: ['1 room', '2–3 rooms', 'More than 3', NOT_SURE_EN] },
          es: { q: '¿Cuántos cuartos?', opts: ['1 cuarto', '2–3 cuartos', 'Más de 3', NOT_SURE_ES] } },
        { key: 'height', multi: false,
          en: { q: 'How high?', opts: ['Normal', 'Tall, 9–10 ft', 'Two-story or vaulted', NOT_SURE_EN] },
          es: { q: '¿Qué tan alto?', opts: ['Normal', 'Alto, 9–10 pies', 'Dos pisos o techo abovedado', NOT_SURE_ES] } },
        { key: 'surface', multi: false,
          en: { q: 'The surface?', opts: ['Smooth', 'Textured', NOT_SURE_EN] },
          es: { q: '¿La superficie?', opts: ['Lisa', 'Con textura', NOT_SURE_ES] } },
        /* SITE-FIX-02 · CDO 5 · the word a customer reads is "color" — we are in Brownsville.
           The KEY stays `colour`, because the Worker reads the field `a_paint_colour`. */
        { key: 'colour', multi: false,
          en: { q: 'The color?', opts: ['Match what’s there', 'A new color', 'Help me choose', NOT_SURE_EN] },
          es: { q: '¿El color?', opts: ['Igualar el que ya está', 'Un color nuevo', 'Ayúdenme a escoger', NOT_SURE_ES] } },
        { key: 'why', multi: false,
          en: { q: 'What’s wrong with it now?', opts: ['Peeling or stained', 'A repair spot that doesn’t match', 'Just tired', 'A new look', NOT_SURE_EN] },
          es: { q: '¿Qué tiene ahora?', opts: ['Descascarada o manchada', 'Un resane que no combina', 'Sólo está gastada', 'Un look nuevo', NOT_SURE_ES] } }
      ]
    },
    {
      key: 'door', service: 'Doors & Carpentry', problem: [],
      en: { label: 'A door, cabinet or window that sticks, won’t latch or won’t close',
            sub: 'Including the cabinet door that hangs crooked' },
      es: { label: 'Una puerta, gabinete o ventana que se atora o no cierra',
            sub: 'Incluye la que no pega y la puerta del gabinete chueca' },
      photo: { en: 'The whole door from a step back, then up close at the latch or the hinge.',
               es: 'Toda la puerta desde un paso atrás, y luego de cerca en la chapa o la bisagra.' },
      questions: [
        { key: 'which', multi: true,
          en: { q: 'Which is it?', opts: ['A door', 'A cabinet door', 'A window', NOT_SURE_EN] },
          es: { q: '¿Cuál es?', opts: ['Una puerta', 'Una puerta de gabinete', 'Una ventana', NOT_SURE_ES] } },
        { key: 'how_many', multi: false,
          en: { q: 'How many?', opts: ['Just one', 'Two or three', 'More than three', NOT_SURE_EN] },
          es: { q: '¿Cuántas?', opts: ['Una', 'Dos o tres', 'Más de tres', NOT_SURE_ES] } },
        { key: 'what_it_does', multi: true,
          en: { q: 'What does it do?', opts: ['Sticks', 'Won’t latch', 'Won’t close', 'Rubs the floor', NOT_SURE_EN] },
          es: { q: '¿Qué hace?', opts: ['Se atora', 'No pega', 'No cierra', 'Raspa el piso', NOT_SURE_ES] } }
      ]
    },
    {
      key: 'trim', service: 'Doors & Carpentry', problem: [],
      en: { label: 'Trim, baseboard or wood gone soft', sub: 'Wood you can press a thumb into' },
      es: { label: 'Molduras, zoclo o madera podrida', sub: 'Madera que se hunde con el dedo' },
      photo: { en: 'The whole run from a step back, then up close with your hand next to it for size.',
               es: 'Todo el tramo desde un paso atrás, y luego de cerca con su mano al lado.' },
      questions: [
        { key: 'where', multi: true,
          en: { q: 'Where is it?', opts: ['Baseboard', 'Window sill', 'Door frame', 'Outside trim', NOT_SURE_EN] },
          es: { q: '¿Dónde está?', opts: ['El zoclo', 'El alféizar de la ventana', 'El marco de la puerta', 'Molduras de afuera', NOT_SURE_ES] } },
        { key: 'how_long', multi: false,
          en: { q: 'Roughly how long?', opts: ['A hand', 'An arm', 'Longer', NOT_SURE_EN] },
          es: { q: '¿Más o menos qué tan largo?', opts: ['Una mano', 'Un brazo', 'Más largo', NOT_SURE_ES] } }
      ]
    },
    {
      key: 'outside', service: 'Yard & Property', problem: [],
      en: { label: 'Outside — gutters, a fence or gate, yard or beds',
            sub: 'Edging, hand weeding and mulch; deck boards and rails, fence repairs' },
      es: { label: 'Afuera — canaletas, cerca, portón o jardín',
            sub: 'Orillas, deshierbe a mano y mantillo; tablas y barandales de terraza, reparación de cercas' },
      photo: { en: 'The whole run from a step back, then up close at the spot that’s wrong.',
               es: 'Todo el tramo desde un paso atrás, y luego de cerca donde está el problema.' },
      questions: [
        { key: 'which', multi: true,
          en: { q: 'Which is it?', opts: ['Gutters', 'Fence', 'Gate', 'Yard and beds', NOT_SURE_EN] },
          es: { q: '¿Cuál es?', opts: ['Canaletas', 'Cerca', 'Portón', 'Jardín y arriates', NOT_SURE_ES] } },
        { key: 'what_is_wrong', multi: true,
          en: { q: 'What is wrong?', opts: ['Dripping or overflowing', 'Leaning or loose boards', 'Will not latch', 'Overgrown edges', NOT_SURE_EN] },
          es: { q: '¿Qué tiene?', opts: ['Gotea o se desborda', 'Inclinada o con tablas flojas', 'No cierra', 'Orillas crecidas', NOT_SURE_ES] } }
      ]
    },
    {
      key: 'comfort', service: 'Comfort & Efficiency', problem: [],
      en: { label: 'Hot rooms, drafts, high bills', sub: 'Sealing, insulation and shade' },
      es: { label: 'Cuartos calientes, corrientes de aire, recibos altos', sub: 'Sellado, aislamiento y sombra' },
      photo: { en: 'The room from the doorway, then up close at the window or door that leaks air.',
               es: 'El cuarto desde la puerta, y luego de cerca en la ventana o puerta por donde entra el aire.' },
      questions: [
        { key: 'rooms', multi: true,
          en: { q: 'Which rooms?', opts: ['Bedroom', 'Living room', 'Kitchen', 'All of it', NOT_SURE_EN] },
          es: { q: '¿Cuáles cuartos?', opts: ['La recámara', 'La sala', 'La cocina', 'Toda la casa', NOT_SURE_ES] } },
        { key: 'when', multi: true,
          en: { q: 'When is it worst?', opts: ['Afternoon sun', 'All day', 'Winter', NOT_SURE_EN] },
          es: { q: '¿Cuándo es peor?', opts: ['Con el sol de la tarde', 'Todo el día', 'En invierno', NOT_SURE_ES] } },
        { key: 'attic', multi: false,
          en: { q: 'Is there a way into the attic?', opts: ['Yes', 'No', NOT_SURE_EN] },
          es: { q: '¿Hay manera de entrar al ático?', opts: ['Si', 'No', NOT_SURE_ES] } }
      ]
    },
    {
      key: 'smart', service: 'Home Automation', problem: [],
      en: { label: 'Wi-Fi dead spots, smart plugs, smart bulbs, leak sensors',
            sub: 'Things that plug in or screw in — nothing wired' },
      es: { label: 'Wi-Fi, enchufes y focos inteligentes, sensores de fugas',
            sub: 'Cosas que se enchufan o se enroscan — nada de cableado' },
      photo: { en: 'The room from the doorway, then up close at the plug or the fixture.',
               es: 'El cuarto desde la puerta, y luego de cerca en el enchufe o la lámpara.' },
      questions: [
        { key: 'which', multi: true,
          en: { q: 'Which is it?', opts: ['Wi-Fi dead spots', 'Smart plugs', 'Smart bulbs', 'Leak sensors', NOT_SURE_EN] },
          es: { q: '¿Cuál es?', opts: ['Zonas sin Wi-Fi', 'Enchufes inteligentes', 'Focos inteligentes', 'Sensores de fugas', NOT_SURE_ES] } },
        { key: 'rooms', multi: false,
          en: { q: 'How many rooms?', opts: ['1 room', '2–3 rooms', 'More than 3', NOT_SURE_EN] },
          es: { q: '¿Cuántos cuartos?', opts: ['1 cuarto', '2–3 cuartos', 'Más de 3', NOT_SURE_ES] } }
      ]
    },
    {
      key: 'else', service: 'Not sure', problem: ['Something else'],
      en: { label: 'Something else — say it in a sentence', sub: 'If it’s not ours, we say so straight away' },
      es: { label: 'Otra cosa — díganoslo en una frase', sub: 'Si no es lo nuestro, se lo decimos de una vez' },
      photo: { en: 'The whole thing from a step back, then up close.',
               es: 'Todo desde un paso atrás, y luego de cerca.' },
      questions: []
    }
  ];

  /* "WHILE WE'RE THERE" — the things people do not notice until someone asks. Each is a tap,
     each is a one-person job, and none is a licensed trade. The smoke-alarm line is deliberately
     NOT here: a dead smoke alarm is not ours to touch. */
  var CHECKLIST = [
    { key: 'door_drags',   en: 'A door that drags or won’t stay shut',        es: 'Una puerta que raspa o no se queda cerrada' },
    { key: 'caulk',        en: 'Cracked caulk at the tub, sink or windows',      es: 'Sellador agrietado en la tina, el lavabo o las ventanas' },
    { key: 'loose',        en: 'A loose towel bar, cabinet knob or hinge',       es: 'Un toallero, una perilla de gabinete o una bisagra floja' },
    { key: 'cabinet',      en: 'A cabinet door out of line',                     es: 'Una puerta de gabinete chueca' },
    { key: 'screen',       en: 'A torn window screen',                           es: 'Un mosquitero roto' },
    { key: 'weatherstrip', en: 'Weatherstrip gaps you can see daylight through', es: 'Huecos en el burlete por donde se ve la luz del día' },
    { key: 'fence_board',  en: 'A wobbly fence board or gate latch',             es: 'Una tabla de la cerca floja o el pasador del portón' },
    { key: 'dryer_vent',   en: 'A dryer-vent cover full of lint',                es: 'La tapa del ducto de la secadora llena de pelusa' },
    { key: 'gutter_drip',  en: 'A gutter dripping in one spot',                  es: 'Una canaleta que gotea en un solo punto' }
  ];

  /* Every other word the chooser, the review and the details screen say. */
  var WORDS = {
    en: {
      heading: 'Tell us what’s wrong. We’ll tell you what it takes.',
      hint: 'Tap everything that sounds like your house. Several things in one visit is normal.',
      whileHeading: 'While we’re there — tap anything that sounds like your house.',
      continueWord: 'Continue',
      reviewHeading: 'Ready to send — look it over',
      reviewEdit: 'Edit',
      reviewSend: 'Send it — we reply within 2 hours.',
      replyBy: 'We’ll reply by ',
      tomorrow: ' tomorrow',
      /* SITE-FIX-15 B - after hours only; % is the time the reply-by line names */
      sendBy: 'Send it — we reply by %.',
      missing: 'We still need ',
      nothingYet: 'Nothing chosen yet.',
      /* SITE-FIX-15 C - % is the tile's own words and its own price text */
      youPicked: 'You picked: %',
      sTiles: 'What’s wrong',
      sWhile: 'While we’re there',
      sPhotos: 'Photos',
      sSentence: 'What you wrote',
      sName: 'Your name', sPhone: 'Phone', sAddress: 'Address', sTimes: 'When we could come',
      photoOf: 'Photo ',
      photosNone: 'No photos yet — one photo saves us both a visit',
      photoOne: '1 photo',
      photoMany: ' photos',
      photoTile: 'This photo is of',
      detailsHeading: 'A few last things',
      replyHow: 'How should we reply?',
      replyHowOpts: ['Text', 'Call'],
      howSoon: 'How soon?',
      howSoonOpts: ['This week', 'When you can', 'It’s urgent'],
      whoseHouse: 'Whose house is it?',
      whoseHouseOpts: ['Mine', 'Rented', 'Family or a friend'],
      notSure: 'Not sure',
      micHint: 'Tap the mic on your keyboard to talk.',
      gotIt: 'This is what we got'
    },
    es: {
      heading: 'Díganos qué está mal. Nosotros le decimos qué necesita.',
      hint: 'Toque todo lo que suene como su casa. Varias cosas en una visita es lo normal.',
      whileHeading: 'Ya que estamos ahí — toque lo que suene como su casa.',
      continueWord: 'Continuar',
      reviewHeading: 'Listo para enviar — revise todo',
      reviewEdit: 'Editar',
      reviewSend: 'Enviar — le contestamos en menos de 2 horas.',
      /* SITE-FIX-01.1 · no 'las' here: UmbraSent.due() says 'la 1:05 p.m.' or 'las 3:05 p.m.'
         itself, and this line used to double it — 'antes de las las 3:05 p.m.' */
      replyBy: 'Le contestamos antes de ',
      tomorrow: ' de mañana',
      /* SITE-FIX-15 B - fuera de horario; % es la hora que nombra la línea de respuesta */
      sendBy: 'Enviar — le contestamos antes de %',
      missing: 'Todavía nos falta ',
      nothingYet: 'Todavía no ha escogido nada.',
      /* SITE-FIX-15 C - % son las palabras del mosaico y su propio precio */
      youPicked: 'Usted eligió: %',
      sTiles: 'Qué está mal',
      sWhile: 'Ya que estamos ahí',
      sPhotos: 'Fotos',
      sSentence: 'Lo que escribió',
      sName: 'Su nombre', sPhone: 'Teléfono', sAddress: 'Dirección', sTimes: 'Cuándo podemos ir',
      photoOf: 'Foto ',
      photosNone: 'Todavía sin fotos — una foto nos ahorra una visita a los dos',
      photoOne: '1 foto',
      photoMany: ' fotos',
      photoTile: 'Esta foto es de',
      detailsHeading: 'Unas últimas cosas',
      /* SITE-FIX-15 D4 - was '¿Cómo le contestamos?', one letter from screen 12's
         '¿Cómo le contactamos?'. This one asks how the answer is sent. */
      replyHow: '¿Cómo le enviamos la respuesta?',
      replyHowOpts: ['Mensaje de texto', 'Llamada'],
      howSoon: '¿Qué tan pronto?',
      howSoonOpts: ['Esta semana', 'Cuando pueda', 'Es urgente'],
      whoseHouse: '¿De quién es la casa?',
      whoseHouseOpts: ['Mia', 'Rentada', 'De familia o de un amigo'],
      notSure: 'No estoy seguro',
      /* SITE-FIX-15 D3 - the page's own Spanish for an option's words. The key is
         the value that is posted and never changes; the value is what he reads. */
      optWords: {
        'Si': 'Sí',
        'Mia': 'Mía',
        'Sólo un parche o una parte': 'Solo un parche o una parte',
        'Sólo está gastada': 'Solo está gastada',
        'No estoy seguro': 'No sé'
      },
      micHint: 'Toque el micrófono de su teclado para hablar.',
      gotIt: 'Esto es lo que recibimos'
    }
  };

  window.UMBRA_CHOOSER = { tiles: TILES, checklist: CHECKLIST, words: WORDS };
})();
