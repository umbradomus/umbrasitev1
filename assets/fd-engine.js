/* ============================================================================
   UMBRA DOMUS - THE REQUEST FRONT DOOR. ONE ENGINE, 42 PATHWAYS, NO HAND-BUILT
   JOB SCREEN. (FRONT-DOOR-BUILD-01, 2026-10-09)

   Every job's screen is drawn from assets/fd-jobs.js, which is generated out of
   the pathways page. Adding a job means adding a block there; nothing here knows
   a job by name.

   WHAT IT SENDS. Not a new envelope: the SAME multipart post today's form makes,
   to the same /intake, with today's field names filled from the new answers, and
   the new names (job, a_<field>, answers, visit_mode...) beside them. The owner
   tool keeps reading what it reads today and gains the rest for free.
   ========================================================================== */
(function () {
  'use strict';

  var LANG = document.documentElement.lang === 'es' ? 'es' : 'en';
  var ES = LANG === 'es';
  var ROOT = ES ? '/es/solicitud' : '/request';
  var OTHER = ES ? '/request' : '/es/solicitud';
  var JOBS = window.FD_JOBS || [];
  var POOL = window.FD_ADDONS || {};
  var BY_ID = {};
  for (var i = 0; i < JOBS.length; i++) BY_ID[JOBS[i].id] = JOBS[i];

  /* ------------------------------------------------------- every customer string */
  /* SPEC section 5, both columns, verbatim. Nothing here is translated by hand. */
  var T = window.FD_WORDS[LANG];
  var t = function (k) { return T[k] == null ? '' : T[k]; };
  var W = function (s) { return s == null ? '' : String(s); };
  function fill(s, o) { return W(s).replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? o[k] : m; }); }

  /* ------------------------------------------------------------------- the groups */
  var GROUPS = [];
  for (var g = 0; g < JOBS.length; g++) {
    var gn = JOBS[g].group[LANG];
    if (GROUPS.indexOf(gn) < 0) GROUPS.push(gn);
  }
  /* screen 1's three group tiles, by the group each one opens (SPEC section 3) */
  var AREAS = [
    { key: 'doors', pic: 'p-area-doors', group: 'Doors, windows & trim', s: 's1.doors' },
    { key: 'mount', pic: 'p-area-mount', group: 'Install or mount', s: 's1.mount' },
    { key: 'outside', pic: 'p-area-outside', group: 'Outside', s: 's1.outside' }
  ];
  var ON_S1 = ['drywall', 'paint_room', 'furniture', 'comfort'];
  function inGroup(gEn) { return JOBS.filter(function (j) { return j.group.en === gEn; }); }
  /* screen 2 holds every job that is not one of screen 1's own four, and not `else` */
  function menuJobs() {
    return JOBS.filter(function (j) { return ON_S1.indexOf(j.id) < 0 && j.id !== 'else'; });
  }

  /* ------------------------------------------------------------------- the search */
  var SYN = window.FD_SYNONYMS || {};
  function matches(j, q) {
    if (!q) return true;
    var hay = (j.tile.en + ' ' + j.tile.es + ' ' + (SYN[j.id] || '')).toLowerCase();
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    for (var k = 0; k < words.length; k++) if (hay.indexOf(words[k]) < 0) return false;
    return true;
  }

  /* --------------------------------------------------------------------- the state */
  var DRAFT = 'ud_draft_v1';
  var S = {
    job: null, step: 0, via: 'tile', answers: {}, note: '', photos: [], addons: [],
    times: null, first: '', phone: '', email: '', sms: false,
    address: '', addrState: null, sent: null, q: ''
  };
  try {
    var raw = localStorage.getItem(DRAFT);
    if (raw) {
      var d = JSON.parse(raw);
      if (d && d.at && Date.now() - d.at < 7 * 864e5) { S = Object.assign(S, d.s || {}); S.photos = []; }
    }
  } catch (e) { }
  function save() {
    try {
      var c = Object.assign({}, S); delete c.photos; delete c.addrState;
      localStorage.setItem(DRAFT, JSON.stringify({ at: Date.now(), s: c }));
    } catch (e) { }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT); } catch (e) { } }

  /* ----------------------------------------------------- the steps a job actually has */
  function stepsOf(job) {
    var out = [];
    if (job.id !== 'else') out.push('questions');
    out.push('photos');
    if (job.addons.length) out.push('addons');
    if (timesMode(job) !== 'none') out.push('times');
    out.push('contact', 'address', 'review');
    return out;
  }
  /* which questions are shown right now (a rule that is not met hides the question) */
  function shown(job) {
    return job.questions.filter(function (q) {
      if (!q.rule) return true;
      var on = q.rule.on, v = S.answers[on.field];
      var hit = on.has ? (Array.isArray(v) ? on.has.some(function (x) { return v.indexOf(x) > -1; }) : on.has.indexOf(v) > -1)
        : (Array.isArray(v) ? v.some(function (x) { return on.is.indexOf(x) > -1; }) : on.is.indexOf(v) > -1);
      return q.rule.kind === 'onlyif' ? hit : !hit;
    });
  }
  function answered(q) {
    var v = S.answers[q.field];
    return q.many ? (Array.isArray(v) && v.length > 0) : (v != null && v !== '');
  }
  function questionsDone(job) {
    return shown(job).every(function (q) { return !q.required || answered(q); });
  }
  /* the times mode this job is in RIGHT NOW, which its own rule may switch (S2) */
  function timesMode(job) {
    var v = job.visits, w = v.when;
    if (!w) return v.mode;
    var a = S.answers[w.field], hit;
    if (w.not) hit = !(w.not.indexOf(a) > -1);
    else if (w.has) {
      hit = Array.isArray(a) ? w.has.some(function (x) { return a.indexOf(x) > -1; }) : w.has.indexOf(a) > -1;
      if (!hit && w.orField) hit = w.orIs.indexOf(S.answers[w.orField]) > -1;
    } else hit = w.is.indexOf(a) > -1;
    return hit ? v.mode : (v.elseMode || 'picks');
  }
  function visitsCount(job) {
    var m = timesMode(job);
    return m === 'pairs' || m === 'dated' ? 2 : m === 'recurring' ? (job.visits.every === 'week' ? 'weekly' : 'quarterly') : m === 'none' ? 0 : 1;
  }

  /* ------------------------------------------------------------------- the calendar */
  var BLOCKS = [['08-11', '8', '11'], ['11-14', '11', '2'], ['14-17', '2', '5'], ['17-20', '5', '8']];
  var DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MON_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fromIso(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dayWords(s) { var d = fromIso(s); return (ES ? DAY_ES : DAY_EN)[d.getDay()] + ' ' + d.getDate() + ' ' + (ES ? MON_ES : MON_EN)[d.getMonth()]; }
  function winWords(b) { var r = BLOCKS.filter(function (x) { return x[0] === b; })[0]; return r ? fill(t('s6.win'), { a: r[1], b: r[2] }) : b; }
  /* 14 days from tomorrow, no Sundays. The live calendar of taken windows is the
     Worker's; this round never calls it (S4), so nothing is drawn as taken. */
  function days(from, n) {
    var out = [], d = from ? fromIso(from) : new Date();
    if (!from) d.setDate(d.getDate() + 1);
    var guard = 0;
    while (out.length < (n || 14) && guard++ < 60) {
      if (d.getDay() !== 0) out.push(iso(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  /* -------------------------------------------------------------------- the drawing */
  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return W(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pic(id, cls) {
    return '<svg class="' + (cls || 'ill') + '" viewBox="0 0 160 100" aria-hidden="true" preserveAspectRatio="xMidYMid slice"><use href="#' + id + '"/></svg>';
  }
  var app = document.getElementById('fd-app');

  function header(big) {
    var alt = ES ? 'Umbra Domus' : 'Umbra Domus';
    return '<div class="hd' + (big ? ' hd-big' : '') + '">' +
      '<img class="lk" src="/assets/ud-lockup-700w.png?v=1" width="700" height="312" alt="' + alt + '">' +
      '<a class="lang" href="' + OTHER + '/" hreflang="' + (ES ? 'en' : 'es') + '">' + esc(t('g.lang')) + '</a></div>';
  }
  function stripe(n, N) {
    var pc = N ? Math.round((n / N) * 100) : 100;
    return '<div class="stripe" aria-hidden="true">' + (N ? '<i style="position:absolute;inset:0 ' + (100 - pc) + '% 0 0;background:var(--navy)"></i>' : '') + '</div>';
  }

  /* ========================================================= SCREEN 1 - THE DOOR */
  function screen1() {
    var tiles = '';
    function jobTile(j, sid) {
      var w = t(sid).split(' / ');
      return '<button class="tile" type="button" data-job="' + j.id + '" data-via="tile">' + pic(j.pic) +
        '<div class="tt"><b>' + esc(w[0]) + '</b><span>' + esc(w[1]) + '</span><em>' + esc(j.price[LANG]) + '</em></div></button>';
    }
    tiles += jobTile(BY_ID.drywall, 's1.walls');
    tiles += jobTile(BY_ID.paint_room, 's1.paint');
    for (var a = 0; a < 2; a++) {
      var A = AREAS[a], w = t(A.s).split(' / ');
      tiles += '<button class="tile area" type="button" data-area="' + A.group + '">' + pic(A.pic) +
        '<div class="tt"><b>' + esc(w[0]) + '</b><span>' + esc(w[1]) + '</span><em>' +
        esc(fill(w[2], { n: inGroup(A.group).length })) + '</em></div></button>';
    }
    tiles += jobTile(BY_ID.furniture, 's1.furniture');
    tiles += jobTile(BY_ID.comfort, 's1.comfort');
    var O = AREAS[2], ow = t(O.s).split(' / ');
    tiles += '<button class="tile area" type="button" data-area="' + O.group + '">' + pic(O.pic) +
      '<div class="tt"><b>' + esc(ow[0]) + '</b><span>' + esc(ow[1]) + '</span><em>' +
      esc(fill(ow[2], { n: inGroup(O.group).length })) + '</em></div></button>';
    var ew = t('s1.else').split(' / ');
    tiles += '<button class="tile door" type="button" data-area="*">' +
      '<div class="dooric">' + pic('p-else', 'doorpic') + '</div>' +
      '<div class="tt"><b>' + esc(ew[0]) + '</b><span>' + esc(fill(ew[1], { n: menuJobs().length - 5 })) + '</span></div></button>';

    var top = t('s1.top').split(' / ');
    var resume = '';
    if (S.job && S.step > 0) {
      var r = t('s1.resume').split(' / ');
      resume = '<p class="msg"><span>' + esc(r[0]) + '</span> <u data-act="resume">' + esc(r[1]) + '</u> · <u data-act="startover">' + esc(r[2]) + '</u></p>';
    }
    app.innerHTML = header(true) + '<div class="stripe full" aria-hidden="true"></div>' +
      '<div class="bd s1"><h1>' + esc(top[0]) + '</h1>' +
      '<p class="promise"><span>' + esc(top[1]) + '</span></p>' + resume +
      '<div class="tiles">' + tiles + '</div>' +
      '<p class="trust">' + esc(t('s1.trust')) + '</p>' +
      '<p class="call"><a href="tel:+19565566438"><u>' + esc(t('s1.call')) + '</u></a></p></div>';
    document.title = t('title.s1');
  }

  /* ============================================= SCREEN 2 - EVERYTHING WE DO */
  function screen2(openAt) {
    var top = t('s2.top').split(' / ');
    var body = '<div class="bd"><h1>' + esc(top[0]) + '</h1>' +
      '<label class="field search"><input type="search" id="fd-q" placeholder="' + esc(top[1]) + '" value="' + esc(S.q) + '" enterkeyhint="search" autocomplete="off"></label>' +
      '<div id="fd-menu"></div></div>';
    app.innerHTML = header(false) + '<div class="stripe full" aria-hidden="true"></div>' +
      '<div class="sub"><button class="bk" type="button" data-act="home">&#8249; ' + esc(t('g.back')) + '</button></div>' + body;
    drawMenu(openAt);
    var q = document.getElementById('fd-q');
    q.addEventListener('input', function () { S.q = q.value; drawMenu(null); });
    document.title = t('title.s2');
  }
  function drawMenu(openAt) {
    var host = document.getElementById('fd-menu');
    if (!host) return;
    /* no search: the groups as drawn, without the jobs screen 1 already shows.
       A typed search looks at EVERY job - the spec's own example is hole -> drywall,
       and drywall is one of screen 1's own tiles. */
    var pool = S.q ? JOBS.filter(function (j) { return j.id !== 'else'; }) : menuJobs();
    var list = pool.filter(function (j) { return matches(j, S.q); });
    var html = '';
    if (!list.length) html += '<p class="msg"><span>' + esc(fill(t('s2.none'), { q: S.q })) + '</span></p>';
    var heads = [];
    for (var i = 0; i < list.length; i++) if (heads.indexOf(list[i].group[LANG]) < 0) heads.push(list[i].group[LANG]);
    for (var k = 0; k < heads.length; k++) {
      var inH = list.filter(function (j) { return j.group[LANG] === heads[k]; });
      html += '<h2 class="gh" id="g-' + k + '">' + esc(heads[k]) + '</h2><div class="jtiles">';
      for (var m = 0; m < inH.length; m++) {
        html += '<button class="jt" type="button" data-job="' + inH[m].id + '" data-via="menu">' + pic(inH[m].pic, 'pic') +
          '<b>' + esc(inH[m].tile[LANG]) + '</b><em>' + esc(inH[m].price[LANG]) + '</em></button>';
      }
      html += '</div>';
    }
    var tw = t('s2.tell').split(' / ');
    html += '<button class="tellt" type="button" data-job="else" data-via="menu">' + pic('p-else', 'pic') +
      '<b>' + esc(tw[0]) + '</b><span>' + esc(tw[1]) + '</span></button>' +
      '<p class="fine">' + esc(t('s2.fine')) + '</p>';
    host.innerHTML = html;
    if (openAt) {
      var at = heads.indexOf(JOBS.filter(function (j) { return j.group.en === openAt; })[0].group[LANG]);
      var el = document.getElementById('g-' + at);
      if (el) el.scrollIntoView({ block: 'start' });
    }
  }

  /* ================================================== A STEP INSIDE A JOB'S FLOW */
  function stepShell(job, name, bodyHtml, actHtml) {
    var steps = stepsOf(job), n = steps.indexOf(name) + 1, N = steps.length;
    app.innerHTML = header(false) + stripe(n, N) +
      '<div class="sub"><button class="bk" type="button" data-act="back">&#8249; ' + esc(t('g.back')) + '</button>' +
      '<span class="cnt">' + esc(fill(t('g.step'), { n: n, N: N })) + '</span></div>' +
      '<div class="bd">' + bodyHtml + '</div>' +
      '<div class="act">' + actHtml + '</div>';
    document.title = job.tile[LANG] + ' - ' + t('title.s1');
  }
  function jobChip(job) {
    var first = null, sh = shown(job);
    for (var i = 0; i < sh.length; i++) {
      var v = S.answers[sh[i].field];
      if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) { first = label(sh[i], v); break; }
    }
    return '<div class="job">' + pic(job.pic, 'jobpic') +
      '<span>' + esc(job.tile[LANG]) + (first ? ': ' + esc(first) : '') + '</span>' +
      '<u data-act="change-job">' + esc(t('g.change')) + '</u></div>';
  }
  function label(q, v) {
    if (q.kind === 'text') return W(v);
    var vals = Array.isArray(v) ? v : [v];
    return vals.map(function (x) {
      var o = q.options.filter(function (y) { return y.v === x; })[0];
      return o ? o[LANG] : x;
    }).join(', ');
  }

  /* ----- step: the job's own questions, revealed one at a time (SPEC section 3, 3) */
  function stepQuestions(job) {
    var sh = shown(job), html = jobChip(job), reveal = true;
    for (var i = 0; i < sh.length; i++) {
      var q = sh[i];
      if (!reveal) break;
      html += '<div class="cond"><p class="q optq">' + esc(q.q[LANG]) + (q.required ? '' : ' <span class="help">' + esc(t('g.optional')) + '</span>') + '</p>';
      if (q.kind === 'text') {
        html += '<label class="field area"><textarea rows="4" data-f="' + q.field + '" maxlength="500" placeholder="">' + esc(S.answers[q.field] || '') + '</textarea></label>';
      } else if (q.kind === 'pics') {
        html += '<div class="opts c' + Math.min(3, q.options.length) + '">';
        for (var o = 0; o < q.options.length; o++) {
          var on = q.many ? (S.answers[q.field] || []).indexOf(q.options[o].v) > -1 : S.answers[q.field] === q.options[o].v;
          html += '<button class="opt' + (on ? ' on' : '') + '" type="button" data-f="' + q.field + '" data-v="' + esc(q.options[o].v) + '" data-many="' + (q.many ? 1 : 0) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
            pic(job.pic, 'pic') + '<span>' + esc(q.options[o][LANG]) + '</span>' + (q.many ? '<i class="tk"></i>' : '') + '</button>';
        }
        html += '</div>';
      } else {
        html += '<div class="chips' + (q.many ? ' multi' : '') + (q.options.some(function (x) { return x[LANG].length > 18; }) ? ' w2' : '') + '">';
        for (var c = 0; c < q.options.length; c++) {
          var cn = q.many ? (S.answers[q.field] || []).indexOf(q.options[c].v) > -1 : S.answers[q.field] === q.options[c].v;
          html += '<span class="' + (cn ? 'on' : '') + '" role="button" tabindex="0" data-f="' + q.field + '" data-v="' + esc(q.options[c].v) + '" data-many="' + (q.many ? 1 : 0) + '" aria-pressed="' + (cn ? 'true' : 'false') + '">' + esc(q.options[c][LANG]) + '</span>';
        }
        html += '</div>';
      }
      /* the route message this answer triggers, under its own question, never blocking */
      for (var r = 0; r < job.routes.length; r++) {
        if (routeHit(job.routes[r], q.field)) html += '<p class="msg"><span>' + esc(job.routes[r].text[LANG]) + '</span></p>';
      }
      html += '</div>';
      if (q.required && !answered(q)) reveal = false;     /* reveal one at a time */
    }
    var done = questionsDone(job);
    var next = stepsOf(job)[1] === 'photos' ? t('g.next.photos') : t('g.next');
    html = '<h1>' + esc(job.tile[LANG]) + '</h1>' + html;
    stepShell(job, 'questions',
      html + '<p class="price"><b>' + esc(job.price[LANG]) + '</b>. ' + esc(t('s3.exact')) + '</p>',
      '<button class="btn" type="button" data-act="next"' + (done ? '' : ' disabled') + '>' + esc(next) + '</button>');
    /* a typed answer is kept as it is typed - the tap handler only knows data-v, so a
       question whose kind is text would otherwise lose every word of it. It re-renders
       on blur, not on every key, so the box never loses the cursor mid-sentence. */
    var tas = app.querySelectorAll('.bd textarea[data-f]');
    for (var ti = 0; ti < tas.length; ti++) {
      tas[ti].addEventListener('input', function () {
        S.answers[this.getAttribute('data-f')] = this.value; save();
        var b = app.querySelector('[data-act="next"]');
        if (b) b.disabled = !questionsDone(job);
      });
      tas[ti].addEventListener('blur', function () { if (questionsDone(job)) render(); });
    }
  }
  function routeHit(route, onlyField) {
    var m = /^([a-z_0-9]+)\s*(=|is|has)\s*(.+)$/.exec(route.cond);
    if (!m) return false;
    if (onlyField && m[1] !== onlyField) return false;
    var want = m[3].split(/\s+or\s+|,\s*/).map(function (s) { return s.trim(); });
    var v = S.answers[m[1]];
    if (v == null) return false;
    return Array.isArray(v) ? v.some(function (x) { return want.indexOf(x) > -1; }) : want.indexOf(v) > -1;
  }

  /* ------------------------------------------------------------- step: the photos */
  function stepPhotos(job) {
    var top = t('s4.top').split(' / '), btns = t('s4.btns').split(' / '), nw = t('s4.note').split(' / ');
    var th = '';
    for (var i = 0; i < S.photos.length; i++) {
      th += '<div class="th"><img src="' + S.photos[i].url + '" alt=""><i data-act="rmphoto" data-i="' + i + '" role="button" tabindex="0" aria-label="' + esc(btns[3]) + '">&#215;</i></div>';
    }
    if (S.photos.length < 6) th += '<div class="th add" data-act="pick" role="button" tabindex="0">+</div>';
    var req = job.id === 'else';
    var noteQ = req ? t('s3.else').split(' / ') : nw;
    var body = '<h1>' + esc(req ? noteQ[0] : top[0]) + '</h1><p class="lede">' + esc(req ? noteQ[1] : top[1]) + '</p>' +
      (req ? '' : '') +
      '<div class="thumbs">' + th + '</div>' +
      '<input type="file" id="fd-file" accept="image/*" multiple>' +
      '<p class="errt" id="fd-ferr" hidden></p>' +
      '<p class="q">' + esc(req ? noteQ[0] : nw[0]) + (req ? '' : ' <span class="help">' + esc(t('g.optional')) + '</span>') + '</p>' +
      '<label class="field area"><textarea rows="4" id="fd-note" maxlength="500" placeholder="' + esc(req ? '' : nw[1]) + '">' + esc(S.note) + '</textarea></label>' +
      (req ? '' : '<p class="help">' + esc(nw[1]) + '</p>');
    var ok = !req || W(S.note).trim().length > 0;
    stepShell(job, 'photos', body,
      '<button class="btn" type="button" data-act="next"' + (ok ? '' : ' disabled') + '>' +
      esc(nextWord(job, 'photos')) + '</button>' +
      (req || S.photos.length ? '' : '<button class="btn text" type="button" data-act="next">' + esc(btns[4]) + '</button>'));
    var f = document.getElementById('fd-file');
    f.addEventListener('change', function () { takePhotos(f.files); });
    document.getElementById('fd-note').addEventListener('input', function () {
      S.note = this.value; save();
      var b = app.querySelector('[data-act="next"]');
      if (req && b) b.disabled = !W(S.note).trim();
    });
  }
  function takePhotos(files) {
    var err = document.getElementById('fd-ferr'), ew = t('s4.err').split(' / ');
    var bad = false;
    for (var i = 0; i < files.length; i++) {
      if (S.photos.length >= 6) { err.textContent = ew[1]; err.hidden = false; break; }
      if (!/^image\//.test(files[i].type)) { bad = true; continue; }
      S.photos.push({ file: files[i], url: URL.createObjectURL(files[i]) });
    }
    if (bad) { err.textContent = ew[0]; err.hidden = false; }
    render();
  }

  /* --------------------------------------------- step: while we're there (add-ons) */
  function stepAddons(job) {
    var top = t('s5.top').split(' / '), meta = t('s5.meta').split(' / ');
    var html = '<h1>' + esc(top[0]) + '</h1><p class="lede">' + esc(top[1]) + '</p><div class="addons">';
    for (var i = 0; i < job.addons.length; i++) {
      var A = POOL[job.addons[i]], on = S.addons.indexOf(A.id) > -1;
      html += '<div class="addon' + (on ? ' on' : '') + '">' + pic(job.pic, 'pic') +
        '<div class="at"><b>' + esc(A.title[LANG]) + '</b><span>' + esc(A.why[LANG]) + '</span><em>' + esc(A.price[LANG]) + '</em></div>' +
        '<button class="addb' + (on ? ' on' : '') + '" type="button" data-addon="' + A.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(on ? meta[2] : meta[1]) + '</button></div>';
    }
    html += '</div>';
    stepShell(job, 'addons', html,
      '<button class="btn" type="button" data-act="next">' +
      esc(S.addons.length ? fill(t('s5.btn1'), { k: S.addons.length }) : t('s5.btn0')) + '</button>');
  }

  /* -------------------------------------------------------------- step: the times */
  function stepTimes(job) {
    var mode = timesMode(job);
    var top = t('s6.top').split(' / ');
    var html = '<h1>' + esc(top[0]) + '</h1>';
    S.times = S.times && S.times.mode === mode ? S.times : { mode: mode, picks: [], v1: null, v2: null, far: null };
    var T2 = S.times;

    if (mode === 'picks' || mode === 'recurring' || mode === 'later') {
      html += '<p class="lede">' + esc(mode === 'picks' ? top[1] : t('s6.one')) + '</p>';
      if (mode === 'later') html += '<p class="why"><span>' + esc(t('s6.later')) + '</span></p>';
      html += calendar('a', T2.picks, mode === 'picks' ? 3 : 1);
      if (mode === 'picks') {
        html += '<p class="picks"><span>' + esc(fill(t('s6.picks'), { k: T2.picks.length })) + '</span></p>';
      }
      if (mode === 'recurring') html += '<p class="why"><span>' + esc(job.visits.every === 'week' ? t('s6.weekly') : t('s6.quarterly')) + '</span></p>';
      html += '<p class="only">' + esc(t('s6.len')) + '</p>';
    } else if (mode === 'pairs') {
      html += '<p class="why"><span>' + esc(t(job.visits.why) || t('s6.why')) + '</span></p>';
      var vw = ['Visit', 'Visita'][ES ? 1 : 0];
      html += '<div class="visit' + (T2.v1 ? ' done' : '') + '"><div class="vh"><b>' + vw + ' 1</b><span>' + esc(job.visits.v1[ES ? 1 : 0]) + '</span></div>' +
        (T2.v1 ? '<div class="vpick"><span>' + esc(dayWords(T2.v1.date) + ' · ' + winWords(T2.v1.win)) + '</span><u data-act="redo1">' + esc(t('g.change')) + '</u></div>'
          : calendar('v1', [], 1)) + '</div>';
      if (T2.v1) {
        var gap = job.visits.gap || [1, 3];
        var from = fromIso(T2.v1.date); from.setDate(from.getDate() + gap[0]);
        html += '<div class="visit"><div class="vh"><b>' + vw + ' 2</b><span>' + esc(job.visits.v2[ES ? 1 : 0]) + '</span></div>' +
          '<p class="only">' + esc(t('s6.only')) + '</p>' +
          calendar('v2', T2.v2 ? [T2.v2] : [], 1, iso(from), gap[1] - gap[0] + 1) + '</div>';
      }
      if (T2.v1 && T2.v2) html += '<p class="both"><p>' + esc(t('s6.both')) + '</p></p>';
    } else if (mode === 'dated') {
      var N = job.visits.near, F = job.visits.far;
      html += '<div class="visit' + (T2.v1 ? ' done' : '') + '"><div class="vh"><b>' + esc(N[ES ? 2 : 1]) + '</b></div>' +
        (T2.v1 ? '<div class="vpick"><span>' + esc(dayWords(T2.v1.date) + ' · ' + winWords(T2.v1.win)) + '</span><u data-act="redo1">' + esc(t('g.change')) + '</u></div>' : calendar('v1', [], 1)) + '</div>';
      html += '<div class="visit"><div class="vh"><b>' + esc(F[ES ? 2 : 1]) + '</b></div>' +
        '<p class="only">' + esc(t('s6.dated.pick')) + '</p>' +
        '<label class="field"><input type="date" id="fd-far" min="' + esc(farMin(job)) + '" max="' + esc(farMax(job)) + '" value="' + esc(T2.far || '') + '"></label></div>';
    }
    var ready = mode === 'pairs' ? !!(T2.v1 && T2.v2) : mode === 'dated' ? !!(T2.v1 && T2.far) : T2.picks.length > 0;
    html += '<p class="errt" id="fd-terr" hidden></p>';
    stepShell(job, 'times', html,
      '<button class="btn" type="button" data-act="next"' + (ready ? '' : ' disabled') + '>' + esc(t('s6.next')) + '</button>');
    var far = document.getElementById('fd-far');
    if (far) far.addEventListener('change', function () { T2.far = this.value; save(); render(); });
  }
  function farMin(job) {
    var d = new Date();
    if (job.visits.farWindow === 'january') return (d.getMonth() >= 1 ? d.getFullYear() + 1 : d.getFullYear()) + '-01-01';
    d.setDate(d.getDate() + 14); return iso(d);
  }
  function farMax(job) {
    var d = new Date();
    if (job.visits.farWindow === 'january') return (d.getMonth() >= 1 ? d.getFullYear() + 1 : d.getFullYear()) + '-01-31';
    d.setMonth(d.getMonth() + 6); return iso(d);
  }
  function calendar(which, picked, max, from, n) {
    var list = days(from, n), html = '<div class="days fit" role="group">';
    var sel = (S.cal && S.cal[which]) || null;
    for (var i = 0; i < list.length; i++) {
      var d = fromIso(list[i]);
      html += '<button class="day' + (sel === list[i] ? ' on' : '') + '" type="button" data-cal="' + which + '" data-date="' + list[i] + '">' +
        '<small>' + (ES ? DAY_ES : DAY_EN)[d.getDay()] + '</small><b>' + d.getDate() + '</b></button>';
    }
    html += '</div>';
    if (sel) {
      html += '<ul class="wins">';
      for (var b = 0; b < BLOCKS.length; b++) {
        var on = picked.some(function (p) { return p.date === sel && p.win === BLOCKS[b][0]; });
        html += '<li class="' + (on ? 'on' : '') + '" role="button" tabindex="0" data-cal="' + which + '" data-date="' + sel + '" data-win="' + BLOCKS[b][0] + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          '<b>' + esc(winWords(BLOCKS[b][0])) + '</b></li>';
      }
      html += '</ul>';
    }
    if (picked.length && which === 'a') {
      html += '<p class="picks">';
      for (var p = 0; p < picked.length; p++) {
        html += '<span>' + esc(dayWords(picked[p].date) + ' · ' + winWords(picked[p].win)) +
          ' <u class="pk" data-act="unpick" data-i="' + p + '" role="button" tabindex="0">&#215;</u></span>';
      }
      html += '</p>';
    }
    return html;
  }

  /* ------------------------------------------------------------ step: the contact */
  function stepContact(job) {
    var top = t('s7.top').split(' / '), ph = t('s7.phone').split(' / '), box = t('s7.box').split(' / ');
    var em = t('s7.email').split(' / ');
    var html = '<h1>' + esc(top[0]) + '</h1>' +
      '<label class="field"><span class="lbl">' + esc(top[1]) + '</span><input type="text" id="fd-first" autocomplete="given-name" maxlength="40" enterkeyhint="next" value="' + esc(S.first) + '"></label>' +
      '<p class="errt" id="e-first" hidden></p>' +
      '<label class="field"><span class="lbl">' + esc(ph[0]) + '</span><input type="tel" id="fd-phone" autocomplete="tel-national" inputmode="tel" enterkeyhint="next" value="' + esc(S.phone) + '"></label>' +
      '<p class="help">' + esc(ph[1]) + '</p><p class="errt" id="e-phone" hidden></p>' +
      /* S5 · THE CONSENT STEP KEEPS TODAY'S WORDING. Only the layout changed. */
      '<div class="consent' + (S.sms ? ' on' : '') + '" data-act="sms" role="checkbox" tabindex="0" aria-checked="' + (S.sms ? 'true' : 'false') + '">' +
      '<i class="box"></i><div><b>' + esc(t('consent.bold')) + '</b>' +
      '<small>' + esc(t('consent.small')) + '</small></div></div>' +
      '<label class="field"><span class="lbl">' + esc(em[0]) + (S.sms ? ' <span class="help">' + esc(t('g.optional')) + '</span>' : '') + '</span>' +
      '<input type="email" id="fd-email" autocomplete="email" inputmode="email" enterkeyhint="next" value="' + esc(S.email) + '"></label>' +
      '<p class="help">' + esc(S.sms ? em[1] : em[2]) + '</p><p class="errt" id="e-email" hidden></p>' +
      '<p class="fine">' + esc(t('legal.privacy')) + '</p>';
    stepShell(job, 'contact', html, '<button class="btn" type="button" data-act="next">' + esc(t('s7.next')) + '</button>');
    ['first', 'phone', 'email'].forEach(function (k) {
      var el = document.getElementById('fd-' + k);
      el.addEventListener('input', function () { S[k] = el.value; save(); });
      el.addEventListener('blur', function () { if (el.value) checkContact(false); });
    });
  }
  function digits(s) { return W(s).replace(/[^0-9]/g, '').replace(/^1(?=\d{10}$)/, ''); }
  function checkContact(all) {
    var errs = t('s7.errs').split(' / '), bad = null;
    function set(id, msg) {
      var e = document.getElementById(id);
      if (!e) return;
      e.textContent = msg || ''; e.hidden = !msg;
      if (msg && !bad) bad = id;
    }
    var d = digits(S.phone);
    set('e-first', W(S.first).trim() ? '' : (all ? errs[0] : ''));
    set('e-phone', (all || S.phone) && !(d.length === 10 && /^[2-9]/.test(d)) ? errs[1] : '');
    var emailBad = S.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(S.email);
    set('e-email', emailBad ? errs[2] : (all && !S.sms && !S.email ? t('s7.e_none') : ''));
    if (bad) { var e = document.getElementById(bad); if (e) e.scrollIntoView({ block: 'center' }); }
    return !bad;
  }

  /* ------------------------------------------------------------ step: the address */
  /* S6 · ADDRESS SUGGESTIONS AS YOU TYPE ARE NOT IN THIS ROUND: they need a provider
     account, which is his hand (site.config.js). This step is TODAY'S address check,
     the same /assets/umbra-address.js the live form uses, with its own "Is this the
     place?" card, and it says so on the page. */
  function stepAddress(job) {
    var top = t('s8.top').split(' / ');
    var html = '<h1>' + esc(top[0]) + '</h1>' +
      '<label class="field"><span class="lbl">' + esc(top[1]) + '</span>' +
      '<input type="text" id="fd-addr" name="address" autocomplete="street-address" enterkeyhint="done" value="' + esc(S.address) + '"></label>' +
      '<div id="fd-addr-host"></div>' +
      '<p class="help">' + esc(t('s8.notyet')) + '</p>' +
      '<p class="errt" id="e-addr" hidden></p>';
    stepShell(job, 'address', html, '<button class="btn" type="button" data-act="next">' + esc(t('s8.next')) + '</button>');
    var input = document.getElementById('fd-addr');
    input.addEventListener('input', function () { S.address = input.value; save(); });
    if (window.UmbraAddress) {
      S.addrApi = window.UmbraAddress.attach({ input: input, host: document.getElementById('fd-addr-host') });
    }
  }

  /* ------------------------------------------------------------- step: the review */
  function stepReview(job) {
    var top = t('s9.top').split(' / '), secs = t('s9.secs').split(' / '), vals = t('s9.vals').split(' / ');
    var sh = shown(job);
    var ans = sh.filter(function (q) { return answered(q); })
      .map(function (q) { return label(q, S.answers[q.field]); }).join('. ');
    var html = '<h1>' + esc(top[0]) + '</h1><p class="lede">' + esc(top[1]) + '</p>';
    function sec(name, step, lines) {
      return '<div class="rv"><div class="rvh"><b>' + esc(name) + '</b>' +
        (step ? '<u data-act="goto" data-step="' + step + '">' + esc(t('g.change')) + '</u>' : '') + '</div>' +
        lines.map(function (l) { return '<p>' + l + '</p>'; }).join('') + '</div>';
    }
    html += sec(secs[0], job.id === 'else' ? null : 'questions', [esc(job.tile[LANG]) + (ans ? ': ' + esc(ans) + '.' : '')]);
    html += sec(secs[1], 'photos', [esc(S.photos.length ? S.photos.length + (ES ? ' fotos' : ' photos') : vals[0]) + (S.note ? ' &middot; ' + esc(S.note) : '')]);
    if (job.addons.length) {
      html += sec(secs[2], 'addons', [S.addons.length ? S.addons.map(function (a) { return esc(POOL[a].title[LANG]); }).join('; ') : esc(vals[1])]);
    }
    if (timesMode(job) !== 'none') {
      var lines = [];
      var T2 = S.times || {};
      if (T2.mode === 'pairs' || T2.mode === 'dated') {
        if (T2.v1) lines.push(esc(fill(t('s9.visit'), { n: 1, day: dayWords(T2.v1.date), win: winWords(T2.v1.win) })));
        if (T2.v2) lines.push(esc(fill(t('s9.visit'), { n: 2, day: dayWords(T2.v2.date), win: winWords(T2.v2.win) })));
        if (T2.far) lines.push(esc(fill(t('s9.visit'), { n: 2, day: dayWords(T2.far), win: t('s6.bytext') })));
      } else {
        (T2.picks || []).forEach(function (p, i) { lines.push(esc(fill(t('s9.visit'), { n: i + 1, day: dayWords(p.date), win: winWords(p.win) }))); });
      }
      html += sec(secs[3], 'times', lines.length ? lines : [esc(t('s6.none'))]);
    }
    html += sec(secs[4], 'contact', [esc(S.first + ' · ' + S.phone) + ' · ' + esc(S.sms ? vals[2] : vals[3]) + (S.email ? ' · ' + esc(fill(vals[4], { email: S.email })) : '')]);
    html += sec(secs[5], 'address', [esc(S.address)]);
    var addonPrices = S.addons.map(function (a) { return POOL[a].title[LANG] + ' - ' + POOL[a].price[LANG]; }).join('; ');
    html += '<p class="price"><b>' + esc(job.price[LANG]) + '</b>' + (addonPrices ? '. ' + esc(addonPrices) : '') + '. ' +
      esc(fill(t('s9.price.tail'), { how: S.sms ? t('g.bytext') : t('g.byemail') })) + '</p>' +
      '<p class="errt" id="e-send" hidden></p>';
    stepShell(job, 'review', html,
      '<button class="btn" type="button" data-act="send">' + esc(t('s9.send')) + '</button>');
  }

  /* ========================================================== THE RECEIVED PAGE */
  function received() {
    var misc = t('s10.misc').split(' / ');
    var r = S.sent || {};
    var html = header(false) + '<div class="stripe full" aria-hidden="true"></div><div class="bd s10">' +
      '<p class="ok">&#10003;</p><h1>' + esc(fill(misc[0], { first: r.first || S.first })) + '</h1>' +
      '<p class="big">' + esc(fill(t('s10.by'), { how: r.sms ? t('g.text') : t('g.email'), time: r.by })) + '</p>' +
      '<h2>' + esc(misc[1]) + '</h2><ul class="next">' +
      '<li>' + esc(misc[2]) + '</li>' +
      '<li>' + esc(fill(t('s10.n2'), { time: r.by, what: r.visitWords })) + '</li>' +
      '<li>' + esc(fill(t('s10.n3'), { what: r.bookWords })) + '</li>' +
      '<li>' + esc(r.billWords) + '</li></ul>' +
      /* S5 · the received page promises an email copy ONLY where that path exists and ran */
      (r.emailCopy ? '<p class="copy">' + esc(fill(t('s10.copy'), { email: S.email, phone: S.phone })) + '</p>' : '') +
      '<p class="fine">' + esc(t('s10.late')) + '</p>' +
      '</div><div class="act">' +
      '<a class="btn" href="/" data-act="done">' + esc(misc[3]) + '</a>' +
      '<button class="btn ghost" type="button" data-act="again">' + esc(misc[4]) + '</button></div>';
    app.innerHTML = html;
    document.title = t('title.s10');
  }

  /* ================================================================ WHAT IS SENT */
  /* S3 · EVERY FIELD TODAY'S FORM SENDS, UNDER TODAY'S NAME, filled from the new
     answers, AND the new ones beside them. Every name below was read out of the live
     code, not from memory: services.html's own form (name="..."), umbra-chooser.js
     syncFields()/driveWorkerFields(), umbra-windows.js (avail_choice),
     umbra-address.js (address_confirmed / address_place_id / lat / lng) and the
     Worker's handleIntake (_honey, attachment<N>). */
  function buildForm(job) {
    var f = document.createElement('form');
    f.className = 'req';
    f.method = 'post';
    f.enctype = 'multipart/form-data';
    f.action = window.UMBRA_FORM_ACTION || '';
    f.hidden = true;
    function put(name, value) {
      if (value == null || value === '') return;
      var i = document.createElement('input');
      i.type = 'hidden'; i.name = name; i.value = String(value);
      f.appendChild(i);
    }
    var sh = shown(job);
    var answerLines = sh.filter(function (q) { return answered(q); })
      .map(function (q) { return q.q[LANG] + ' ' + label(q, S.answers[q.field]); });

    /* --- FormSubmit's own control fields, exactly as today's form carries them */
    put('_subject', (ES ? 'Solicitud' : 'Request') + ': ' + job.tile[LANG] + ' - ' + S.first);
    put('_template', 'table');
    put('_captcha', 'false');
    put('_next', location.origin + ROOT + '/received');
    /* the honeypot goes even when it is empty - EMPTY IS THE WHOLE POINT, and today's
       form carries the input itself. put() drops an empty value, so this one is hand-added. */
    var hp = document.createElement('input');
    hp.type = 'hidden'; hp.name = '_honey'; hp.value = '';
    f.appendChild(hp);

    /* --- today's names, filled from the new answers */
    put('service', job.tile.en);
    put('problem', job.tile.en);
    put('problem_area', job.group.en);
    put('tiles', job.tile[LANG]);
    put('what', S.note || answerLines.join(' · '));
    put('answers', answerLines.join('\n'));
    put('while_there', S.addons.map(function (a) { return POOL[a].title[LANG]; }).join('\n'));
    /* the owner tool reads f.extras for its "While we're there" list and f.flags for
       "They said"; today's form posts neither name, so today those two sections are
       always empty. The new form posts today's name AND the name the tool reads. */
    put('extras', S.addons.map(function (a) { return POOL[a].title[LANG]; }).join('\n'));
    put('flags', job.routes.filter(function (r) { return routeHit(r, null); })
      .map(function (r) { return r.text[LANG]; }).join('\n'));
    put('description', S.note || (S.answers.sentence || '') || answerLines.join(' · '));
    /* today's walls/ceiling block on the owner's job card (worker/src/owner.js reads
       walls_count_band / walls_biggest / ceiling_... by name and PRINTS them) stays
       filled: the new answers go in under today's names, in the customer's own words,
       so nothing is invented and the card reads as it reads today. */
    if (job.id === 'drywall') {
      var pre = S.answers.where === 'ceiling' ? 'ceiling_' : 'walls_';
      var qOf = function (fld) { return job.questions.filter(function (q) { return q.field === fld; })[0]; };
      if (S.answers.count) put(pre + 'count_band', label(qOf('count'), S.answers.count));
      if (S.answers.size) put(pre + 'biggest', label(qOf('size'), S.answers.size));
    }
    put('name', S.first);
    put('phone', S.phone);
    put('email', S.email);
    put('address', S.address);
    var st = S.addrApi && S.addrApi.state ? S.addrApi.state() : null;
    if (st) {
      put('address_confirmed', st.confirmed ? (st.how || 'yes') : '');
      put('address_place_id', st.place_id);
      if (st.lat != null) put('lat', st.lat);
      if (st.lng != null) put('lng', st.lng);
    }
    put('sms_consent_lang', LANG);
    put('sms_consent_version', 'sms-v2');            /* S5: today's version, not a new one */
    if (S.sms) put('sms_consent', 'yes');
    /* the times, in the shape worker/src/windows.js readAvailability() already parses */
    var T2 = S.times || {}, choices = [];
    if (T2.mode === 'picks' || T2.mode === 'recurring' || T2.mode === 'later') choices = T2.picks || [];
    else { if (T2.v1) choices.push(T2.v1); if (T2.v2) choices.push(T2.v2); }
    if (timesMode(job) !== 'none') {
      put('avail_form', 'v1');
      put('avail_flexible', choices.length ? '' : 'yes');
      for (var c = 0; c < choices.length && c < 3; c++) put('avail_choice', choices[c].date + ' ' + choices[c].win);
      var notes = [];
      if (T2.far) notes.push((ES ? 'Segunda fecha' : 'Second date') + ': ' + T2.far);
      if (T2.mode === 'recurring') notes.push(job.visits.every === 'week' ? (ES ? 'Cada semana' : 'Every week') : (ES ? 'Cada 3 meses' : 'Every 3 months'));
      if (T2.mode === 'later') notes.push(t('s6.later'));
      if (notes.length) put('avail_notes', notes.join('\n'));
    }

    /* --- THE NEW NAMES, beside what is there. A name the Worker does not know is kept
           on the record's own `fields` bag, which handleIntake writes whole. */
    put('fd_version', 'request-v2');
    put('job', job.id);
    put('job_label', job.tile[LANG]);
    put('lang', LANG);
    put('via', S.via);
    put('visits', visitsCount(job));
    put('visit_mode', timesMode(job));
    put('price_shown', job.price[LANG]);
    put('addons_ids', S.addons.join(','));
    put('photo_count', S.photos.length);
    for (var i = 0; i < sh.length; i++) {
      var v = S.answers[sh[i].field];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      put('a_' + sh[i].field, Array.isArray(v) ? v.join(',') : v);
      put('a_' + sh[i].field + '_label', label(sh[i], v));
    }
    /* a question the job asks but the answers hid sends nothing, as the spec says */
    var answersJson = {};
    for (var q2 = 0; q2 < job.questions.length; q2++) {
      var fq = job.questions[q2].field;
      answersJson[fq] = sh.some(function (x) { return x.field === fq; }) ? (S.answers[fq] == null ? null : S.answers[fq]) : null;
    }
    put('answers_json', JSON.stringify(answersJson));
    put('times_json', JSON.stringify(S.times || null));

    /* --- the photos, under the only names the Worker takes: attachment, attachment2.. */
    for (var p = 0; p < S.photos.length; p++) {
      var fi = document.createElement('input');
      fi.type = 'file';
      fi.name = p === 0 ? 'attachment' : 'attachment' + (p + 1);
      var dt = new DataTransfer();
      dt.items.add(S.photos[p].file);
      fi.files = dt.files;
      f.appendChild(fi);
    }
    return f;
  }

  function send() {
    if (!checkReady()) return;
    var job = BY_ID[S.job];
    var btn = app.querySelector('[data-act="send"]');
    if (btn) { btn.disabled = true; btn.textContent = t('s9.sending'); }
    var f = buildForm(job);
    document.body.appendChild(f);
    var fd = new FormData(f);
    fetch(f.action, { method: 'POST', body: fd, redirect: 'follow' }).then(function (res) {
      f.remove();
      if (!res.ok && res.status !== 0) throw new Error('HTTP ' + res.status);
      return res.text().then(function (body) { return { body: body, url: res.url }; });
    }).then(function (r) {
      S.sent = receipt(job, r);
      clearDraft();
      go(ROOT + '/received', { received: 1 });
    }).catch(function (err) {
      f.remove();
      var e = document.getElementById('e-send');
      if (e) { e.textContent = t('s9.fail'); e.hidden = false; e.scrollIntoView({ block: 'center' }); }
      if (btn) { btn.disabled = false; btn.textContent = t('s9.send'); }
      if (window.console) console.error('send failed', err);
    });
  }
  function checkReady() {
    var job = BY_ID[S.job];
    if (!questionsDone(job)) { goStep('questions'); return false; }
    if (!W(S.first).trim() || digits(S.phone).length !== 10 || (!S.sms && !S.email)) { goStep('contact'); setTimeout(function () { checkContact(true); }, 0); return false; }
    if (!W(S.address).trim()) { goStep('address'); return false; }
    return true;
  }
  /* the reply-by clock: sent 7 AM - 7 PM gets +2 h; otherwise 9:00 the next morning */
  function receipt(job, r) {
    var now = new Date(), h24 = now.getHours(), by, tomorrow = false;
    if (h24 >= 7 && h24 < 19) { var d = new Date(now.getTime() + 2 * 36e5); by = clock(d); }
    else { by = ES ? '9:00 a. m.' : '9:00 AM'; tomorrow = true; }
    var m = timesMode(job), two = m === 'pairs' || m === 'dated';
    var vw = t('s10.visitwords').split(' / ');
    var bw = t('s10.bookwords').split(' / ');
    var billw = t('s10.n4').split(' / ');
    /* S5 · the email-copy sentence shows only if an email copy actually goes. The
       browser's own direct copy to FormSubmit is NOT wired into this flow in this
       round, so the only copy is the Worker's own forward, and it needs an email. */
    return {
      first: S.first, sms: S.sms, by: (tomorrow ? t('g.tomorrow') + ' ' : '') + by,
      visitWords: two ? vw[0] : m === 'recurring' ? vw[2] : vw[1],
      bookWords: two ? bw[0] : bw[1],
      billWords: m === 'recurring' ? billw[2] : two ? billw[0] : billw[1],
      emailCopy: false
    };
  }
  function clock(d) {
    var h12 = d.getHours() % 12 || 12, mm = String(d.getMinutes()).padStart(2, '0');
    return ES ? (h12 + ':' + mm + (d.getHours() < 12 ? ' a. m.' : ' p. m.')) : (h12 + ':' + mm + (d.getHours() < 12 ? ' AM' : ' PM'));
  }

  /* ========================================================== ROUTES AND HISTORY */
  /* /request              screen 1, the door (the QR target; the live home page is untouched)
     /request/all          screen 2, everything we do
     /request/<job>/<step> the job's own flow
     /request/received     the received page                  (ES: /es/solicitud/...) */
  function path() {
    var p = location.pathname.replace(/\/+$/, '') || '/';
    if (p.indexOf(ROOT) !== 0) return { s: 'one' };
    var rest = p.slice(ROOT.length).replace(/^\//, '');
    if (!rest || rest === 'one') return { s: 'one' };
    if (rest === 'all' || rest === 'todo') return { s: 'two' };
    if (rest === 'received' || rest === 'recibido') return { s: 'received' };
    var bits = rest.split('/');
    if (BY_ID[bits[0]]) return { s: 'step', job: bits[0], step: bits[1] || 'questions' };
    return { s: 'two' };
  }
  function go(url, st) { history.pushState(st || {}, '', url); render(); }
  function goStep(name) {
    S.step = stepsOf(BY_ID[S.job]).indexOf(name) + 1;
    save();
    go(ROOT + '/' + S.job + '/' + name);
  }
  function render() {
    var r = path();
    window.scrollTo(0, 0);
    if (r.s === 'one') return screen1();
    if (r.s === 'two') return screen2(S.openAt);
    if (r.s === 'received') return received();
    var job = BY_ID[r.job];
    S.job = r.job;
    var steps = stepsOf(job);
    var name = steps.indexOf(r.step) > -1 ? r.step : steps[0];
    S.step = steps.indexOf(name) + 1;
    if (name === 'questions') return stepQuestions(job);
    if (name === 'photos') return stepPhotos(job);
    if (name === 'addons') return stepAddons(job);
    if (name === 'times') return stepTimes(job);
    if (name === 'contact') return stepContact(job);
    if (name === 'address') return stepAddress(job);
    return stepReview(job);
  }
  function nextWord(job, from) {
    var steps = stepsOf(job), at = steps.indexOf(from), to = steps[at + 1];
    return t('g.next.' + to) || t('g.next');
  }
  function nextStep() {
    var job = BY_ID[S.job], steps = stepsOf(job), here = steps[S.step - 1];
    if (here === 'contact' && !checkContact(true)) return;
    if (here === 'address') {
      var e = document.getElementById('e-addr');
      if (!W(S.address).trim()) { e.textContent = t('s8.errs').split(' / ')[0]; e.hidden = false; return; }
      if (S.addrApi && S.addrApi.state && !S.addrApi.state().confirmed) {
        if (S.addrApi.check) S.addrApi.check();
        e.textContent = t('s8.confirm'); e.hidden = false;
        return;
      }
    }
    if (S.backToReview) { S.backToReview = false; return goStep('review'); }
    var to = steps[S.step];
    if (!to) return;
    goStep(to);
  }

  /* ----------------------------------------------------------------- the one listener */
  document.addEventListener('click', onTap);
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var el = ev.target.closest('[role="button"],[role="checkbox"]');
    if (!el) return;
    ev.preventDefault(); onTap(ev);
  });
  function onTap(ev) {
    var el = ev.target.closest('[data-job],[data-area],[data-act],[data-f],[data-addon],[data-cal]');
    if (!el || !app.contains(el)) return;
    var job;
    if (el.hasAttribute('data-job')) {
      ev.preventDefault();
      S.job = el.getAttribute('data-job');
      S.via = el.getAttribute('data-via') || 'tile';
      S.answers = {}; S.addons = []; S.times = null; S.cal = {}; S.note = '';
      save();
      return go(ROOT + '/' + S.job + '/' + stepsOf(BY_ID[S.job])[0]);
    }
    if (el.hasAttribute('data-area')) {
      ev.preventDefault();
      S.openAt = el.getAttribute('data-area') === '*' ? null : el.getAttribute('data-area');
      S.via = el.getAttribute('data-area') === '*' ? 'menu' : 'group'; S.q = '';
      return go(ROOT + '/all');
    }
    if (el.hasAttribute('data-addon')) {
      ev.preventDefault();
      var id = el.getAttribute('data-addon'), at = S.addons.indexOf(id);
      if (at > -1) S.addons.splice(at, 1); else S.addons.push(id);
      save(); return render();
    }
    if (el.hasAttribute('data-f')) {
      ev.preventDefault();
      job = BY_ID[S.job];
      var fld = el.getAttribute('data-f'), v = el.getAttribute('data-v');
      if (el.getAttribute('data-many') === '1') {
        var cur = S.answers[fld] || [];
        var i2 = cur.indexOf(v);
        if (i2 > -1) cur.splice(i2, 1); else cur = cur.concat([v]);
        S.answers[fld] = cur;
      } else S.answers[fld] = v;
      /* an answer that hides a later question clears it, so nothing stale is sent */
      var live = shown(job).map(function (q) { return q.field; });
      for (var k in S.answers) if (live.indexOf(k) < 0) delete S.answers[k];
      save(); return render();
    }
    if (el.hasAttribute('data-cal')) {
      ev.preventDefault();
      var which = el.getAttribute('data-cal'), date = el.getAttribute('data-date'), win = el.getAttribute('data-win');
      S.cal = S.cal || {};
      if (!win) { S.cal[which] = date; return render(); }
      var T2 = S.times;
      if (which === 'a') {
        var at2 = -1;
        for (var p = 0; p < T2.picks.length; p++) if (T2.picks[p].date === date && T2.picks[p].win === win) at2 = p;
        if (at2 > -1) T2.picks.splice(at2, 1);
        else if (T2.picks.length >= (timesMode(BY_ID[S.job]) === 'picks' ? 3 : 1)) {
          if (timesMode(BY_ID[S.job]) !== 'picks') T2.picks = [{ date: date, win: win }];
          else { var e2 = document.getElementById('fd-terr'); if (e2) { e2.textContent = t('s6.max').split(' / ')[0]; e2.hidden = false; } return; }
        } else T2.picks.push({ date: date, win: win });
      } else if (which === 'v1') { T2.v1 = { date: date, win: win }; T2.v2 = null; S.cal.v2 = null; }
      else T2.v2 = { date: date, win: win };
      save(); return render();
    }
    var act = el.getAttribute('data-act');
    if (!act) return;
    ev.preventDefault();
    if (act === 'home') return go(ROOT);
    if (act === 'back') return history.back();
    if (act === 'next') return nextStep();
    if (act === 'send') return send();
    if (act === 'sms') { S.sms = !S.sms; save(); return render(); }
    if (act === 'pick') return document.getElementById('fd-file').click();
    if (act === 'rmphoto') { S.photos.splice(+el.getAttribute('data-i'), 1); return render(); }
    if (act === 'unpick') { S.times.picks.splice(+el.getAttribute('data-i'), 1); save(); return render(); }
    if (act === 'redo1') { S.times.v1 = null; S.times.v2 = null; S.cal = {}; save(); return render(); }
    if (act === 'change-job') return go(S.via === 'tile' ? ROOT : ROOT + '/all');
    if (act === 'goto') { S.backToReview = true; return goStep(el.getAttribute('data-step')); }
    if (act === 'resume') return goStep(stepsOf(BY_ID[S.job])[S.step - 1] || 'questions');
    if (act === 'startover') { clearDraft(); S.job = null; S.step = 0; S.answers = {}; return render(); }
    if (act === 'again') { clearDraft(); S.job = null; S.step = 0; S.answers = {}; S.photos = []; S.addons = []; S.times = null; S.sent = null; return go(ROOT); }
    if (act === 'done') { clearDraft(); location.href = '/'; }
  }
  window.addEventListener('popstate', render);
  render();
  window.FD = { S: S, render: render, path: path, buildForm: buildForm, stepsOf: stepsOf, timesMode: timesMode, jobs: JOBS };
})();
