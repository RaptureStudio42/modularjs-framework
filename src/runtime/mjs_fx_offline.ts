// mjs_fx_offline — `*offline` : le réseau tombe, la zone se voile et un bandeau dit ce qui attend ; il
// revient, tout se recolore. Posé sur `<@document>` : toute la page (bandeau fixé au bord de l'écran,
// voile par-dessus la page) ; sur une balise : elle seule (bandeau à son bord). Hors ligne : le
// navigateur n'a plus de réseau, ou un serveur temps réel de MJS (µsocket) ne répond plus — depuis
// `delay`, pour qu'une coupure d'un instant ne clignote pas. Ce qui attend : les messages que µsocket
// garde pour le retour (file hors ligne, requêtes en attente d'ouverture) et les mises à jour
// optimistes en vol (µoptimistic). Le voile est un calque qui grise ce qu'il recouvre
// (backdrop-filter) : la page reste utilisable, sa mise en page ne bouge pas.
// Réglages : text (le message ; « Hors ligne »), count (le nombre de changements en attente, à la
// suite ; oui), place (top, bottom ; top), size (la hauteur du bandeau, en px ; 40), zindex
// (2147483000), background (le fond du bandeau ; #24292f), color (son texte ; #fff), opacity (le
// bandeau ; 1), logo (au début du bandeau : une image — son adresse — ou un texte, un émoji), veil
// (le gris du voile, 0 : aucun ; 0.8), fx (l'arrivée du bandeau, un effet qui se joue une fois ;
// sans lui, il glisse depuis son bord), delay (le temps hors ligne avant de le dire ; 1s).

µ._mjs_fxDefs.offline = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  css: '[mjs-fx-offline-band]{position:fixed;left:0;right:0;bottom:0;z-index:var(--mjs-offline-zindex,2147483000);display:flex;align-items:center;gap:10px;box-sizing:border-box;height:var(--mjs-offline-size,40px);padding:0 16px;background:var(--mjs-offline-background,#24292f);color:var(--mjs-offline-color,#fff);opacity:var(--mjs-offline-opacity,1);font:500 14px/1.3 system-ui,sans-serif;transform:translateY(100%);transition:transform .35s ease}'
    + '[mjs-fx-offline-band][mjs-fx-offline-place="top"]{top:0;bottom:auto;transform:translateY(-100%)}'
    + '[mjs-fx-offline-band][mjs-fx-offline-in],[mjs-fx-offline-band][mjs-fx-offline-fx]{transform:none}'
    + '[mjs-fx-offline-band][mjs-fx-offline-fx]{transition:none}'
    + '[mjs-fx-offline-band] img{height:60%;width:auto}'
    + '[mjs-fx-offline-band] [mjs-fx-offline-n]{opacity:.8}'
    + '[mjs-fx-offline-veil]{position:fixed;inset:0;z-index:var(--mjs-offline-zindex,2147483000);pointer-events:none;-webkit-backdrop-filter:grayscale(var(--mjs-offline-veil,0.8));backdrop-filter:grayscale(var(--mjs-offline-veil,0.8));opacity:0;transition:opacity .6s ease}'
    + '[mjs-fx-offline-veil][mjs-fx-offline-in]{opacity:1}'
    // sur une balise : bandeau et voile dans sa boîte
    + '[mjs-fx~="offline"]:not(html) > [mjs-fx-offline-band],[mjs-fx~="offline"]:not(html) > [mjs-fx-offline-veil]{position:absolute}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-offline-band],[mjs-fx-offline-veil]{transition:none}}',
  vars: { size: 'px', zindex: '', background: '', color: '', opacity: '', veil: '' },
  setup: function(el, s, comp) {
    var page  = el === document.documentElement;
    var at    = page ? document.body : el;
    var band  = null;
    var veil  = null;
    var down  = 0;
    var shown = false;
    var fxOff = null;
    // le voile est voulu tant que son réglage n'est pas 0 (suivi par `stop.set` quand une variable le tient)
    var veiled  = s.veil !== 0;
    var restore = page ? function() {} : µ._mjs_fxRelative(el);
    if (page) µ._mjs_fxAdopt(document, 'offline');
    // ses libellés dans la langue de la page (fr, en ; surcharge du projet : clés i18n `mjs.fx.*`)
    var L = µ._mjs_fxLabel;
    // ce que MJS sait : les serveurs temps réel qui ne répondent plus, ce qui attend
    var state = function() {
      var n = µ._mjs_optPending || 0;
      // `µ._mjs_fxOfflineSim` : une coupure simulée (la carte de l'effet, dans la doc)
      var lost = µ._mjs_fxOfflineSim === true || (typeof navigator !== 'undefined' && navigator.onLine === false);
      var all = µ._mjs_sockets || {};
      for (var u in all) {
        var k = all[u];
        if (!k || k._mjs_destroyed) continue;
        n += (k._mjs_queue ? k._mjs_queue.length : 0) + (k._mjs_pendingOpenReqs ? k._mjs_pendingOpenReqs.length : 0);
        if (k._mjs_wantOpen && k.state !== 'open') lost = true;
      }
      return { lost: lost, n: n };
    };
    // une adresse, un texte, ou ce que le build pose pour un chemin de fichier (son adresse)
    var logo  = µ._mjs_fxImage(s.logo, el);
    var msg   = null;
    var said  = '';
    var count = 0;
    // le logo et le message, posés une fois par bandeau ; le compte ne réécrit ensuite que le texte du message
    var words = function() {
      var t = document.createDocumentFragment();
      if (logo) {
        var lg;
        if (/^(\/|\.|https?:|data:image)/.test(logo)) {
          lg = document.createElement('img');
          lg.src = logo;
          lg.alt = '';
        }
        else {
          lg = document.createElement('span');
          lg.textContent = logo;
        }
        lg.setAttribute('mjs-fx-offline-logo', '');
        t.appendChild(lg);
      }
      msg = document.createElement('span');
      t.appendChild(msg);
      return t;
    };
    // le texte (et ce qui attend) : réécrit seulement quand il change — hors ligne, le bandeau était refait toutes les
    // 500 ms (un <img> de logo neuf, redemandé au réseau, et la région `status` réécrite) ; récrit aussi à l'arrivée du
    // fichier de la langue s'il surcharge ses libellés
    var write = function() {
      msg.textContent = typeof s.text === 'string' && s.text !== '' ? s.text : L('offline');
      if (s.count !== false && count > 0) {
        var c = document.createElement('span');
        c.setAttribute('mjs-fx-offline-n', '');
        c.textContent = ' — ' + L(count === 1 ? 'pending1' : 'pendingN').replace('{n}', String(count));
        msg.appendChild(c);
      }
    };
    var say = function(n) {
      var key = (s.count !== false ? n : 0) + ' ' + (typeof µ._mjs_labelLang === 'function' ? µ._mjs_labelLang() : µ._runtimeLabelsLang);
      if (key === said) return;
      said  = key;
      count = n;
      µ._mjs_fxLabelKeep(write);
    };
    var show = function(n) {
      if (!band) {
        band = document.createElement('div');
        band.setAttribute('mjs-fx-offline-band', '');
        band.setAttribute('mjs-fx-layer', 'offline');
        band.setAttribute('role', 'status');
        band.setAttribute('mjs-fx-offline-place', s.place === 'bottom' ? 'bottom' : 'top');
        veil = document.createElement('div');
        veil.setAttribute('mjs-fx-offline-veil', '');
        veil.setAttribute('mjs-fx-layer', 'offline');
        veil.setAttribute('aria-hidden', 'true');
        if (veiled) at.appendChild(veil);
        at.appendChild(band);
        var fx = s.fx && typeof s.fx === 'object' && µ._mjs_fxDefs[s.fx.fx] ? s.fx : null;
        if (fx) {
          band.setAttribute('mjs-fx-offline-fx', '');
          fxOff = µ._mjs_fxOnce(comp, band, fx);
        }
        void band.offsetWidth;
        band.setAttribute('mjs-fx-offline-in', '');
        veil.setAttribute('mjs-fx-offline-in', '');
        band.appendChild(words());
        said = '';
      }
      say(n);
      shown = true;
    };
    var hide = function() {
      if (!band) return;
      var b = band;
      var v = veil;
      band = null;
      veil = null;
      shown = false;
      if (fxOff) fxOff();
      fxOff = null;
      b.removeAttribute('mjs-fx-offline-in');
      v.removeAttribute('mjs-fx-offline-in');
      // le bandeau repart par son bord, le voile s'efface, puis ils s'en vont
      setTimeout(function() {
        b.remove();
        v.remove();
      }, µ._mjs_fxCalm() || b.hasAttribute('mjs-fx-offline-fx') ? 0 : 400);
    };
    var tick = function() {
      var st = state();
      if (!st.lost) {
        down = 0;
        hide();
        return;
      }
      if (!down) down = Date.now();
      if (shown || Date.now() - down >= µ._mjs_fxMs(s.delay, 1000)) show(st.n);
    };
    var poll = setInterval(tick, 500);
    window.addEventListener('online', tick);
    window.addEventListener('offline', tick);
    tick();
    var stop = function() {
      clearInterval(poll);
      window.removeEventListener('online', tick);
      window.removeEventListener('offline', tick);
      if (fxOff) fxOff();
      if (band) band.remove();
      if (veil) veil.remove();
      restore();
    };
    // le voile tenu par une variable : son gris suit (le moteur) ; à 0, aucun voile (celui qui est là
    // part), au-dessus de 0 il vient, derrière le bandeau comme à la pose. Les autres réglages relancent
    // l'effet
    stop.set = function(k, v) {
      if (k !== 'veil') return false;
      veiled = v !== 0;
      if (!veil) return;
      if (!veiled) {
        veil.removeAttribute('mjs-fx-offline-in');
        veil.remove();
      }
      else if (!veil.parentNode) {
        at.insertBefore(veil, band);
        void veil.offsetWidth;
        veil.setAttribute('mjs-fx-offline-in', '');
      }
    };
    return stop;
  }
};
