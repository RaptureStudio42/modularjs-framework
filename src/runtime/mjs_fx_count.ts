// mjs_fx_count — `*count` : le nombre écrit dans la balise se compte depuis `from` (0) ; un nombre
// réactif (`{$total}`) se recompte vers sa nouvelle valeur. Le nombre s'écrit sans séparateur
// (`12480`, `3.5`). Sur un calque posé par-dessus le texte, qui reste en place. Réglages : duration
// (2s), from (0), separator (le séparateur des milliers ; une espace), decimal (le séparateur des
// décimales ; une virgule), prefix, suffix (un texte avant, après : `€`, `%`), easing, delay, on
// (view : quand la balise entre à l'écran ; hover, click ; load : dès l'apparition).
// Le nombre affiché ne passe jamais à la ligne, et la balise prend sa place : sans quoi elle n'a que
// la largeur du nombre brut (`12480`), et séparateurs, préfixe et suffixe débordent sur la suite. Posée
// dans un composant encore masqué ou une zone cachée (aucune boîte à mesurer), elle prend sa place dès
// qu'elle a une boîte : à l'image qui suit son apparition (l'écrire dans l'avis de l'observateur de taille
// ferait signaler « ResizeObserver loop » à la page qui observe un parent de la balise).
// Pendant un décompte, la balise garde la place du nombre le plus large possible du même gabarit : le plus long des nombres de départ et
// d'arrivée, chaque chiffre de sa partie nombre remplacé par le chiffre le plus large de la police. Un nombre entre les deux bouts peut
// être plus large que l'un et l'autre (« 10 523 » contre « 11 111 » avec des chiffres proportionnels ; le noyau « 11 » rapproche aussi les
// deux 1), et un nombre qui perd des chiffres (12 480 → 9) montre encore l'ancien à l'écran : aucun ne déborde sur la suite. À la dernière
// image la balise prend d'un coup, sans transition, la place du nombre final ; cette place est lue d'avance avec celle du gabarit, au départ
// du décompte, jamais dans la boucle. Les dix chiffres se lisent une seule fois par police. Un nombre donné en plein décompte part du
// nombre affiché à cet instant.
// `pad` : le nombre s'écrit sur au moins `pad` chiffres (la partie entière), zéros de tête compris (`07`) ; séparateurs et décimales comme sans lui.
// `style: flip` : le rendu en volets, comme un panneau d'aéroport. Chaque chiffre du nombre est une carte à deux moitiés qui bascule quand il
// change ; le reste (séparateurs, préfixe, suffixe) s'écrit en texte entre les cartes. L'effet fabrique lui-même ses cartes, l'auteur n'écrit que
// `<span *count(style: flip)>{$n}</span>`. Seules les cartes dont le chiffre change basculent (129 → 130 : les deux dernières) ; une carte en train de
// basculer garde le dernier chiffre demandé pour sa bascule suivante, de sorte qu'un décompte rapide fait défiler les chiffres sans jamais empiler de
// bascules. Une carte de plus (9 → 10) arrive en basculant depuis une carte vide, une carte de moins (100 → 99) part sans bascule. La balise garde la
// place du plus large des nombres comme sans volets (la mesure du cœur écrit un texte dans une rangée cachée, qui le reçoit en cartes). Le texte écrit
// reste en place, lisible, et le calque des cartes est caché aux lecteurs d'écran : les chiffres des cartes sont des attributs, jamais du texte. Avec
// « réduire les animations » le chiffre change sans bascule. Réglages du rendu : speed (une bascule ; 400ms), background (le fond des cartes ;
// #1f2633), color (le chiffre ; #f5f7fa). Sections marquées du fichier (`// @@ …`, filtrées par le build, bundler/fx-sections.ts) : `style=flip`
// (les cartes, leur feuille) et `pad` (les zéros de tête) ne partent que dans une appli dont une page écrit le réglage.

// le chiffre le plus large de la police d'un calque : les dix chiffres se lisent une seule fois par police. La clé suit
// ce qui change la forme des chiffres (famille, graisse, style, chasse, chiffres, variations) et le nombre de polices web arrivées : une
// police qui arrive en change la clé, la lecture suivante se refait. Sans boîte (calque caché) rien ne se lit : null, et rien n'est gardé
var _mjsFxCountFonts = {};
function _mjsFxCountDigit(layer) {
  if (typeof getComputedStyle !== 'function' || typeof document.createRange !== 'function') return null;
  var cs    = getComputedStyle(layer);
  var faces = document.fonts;
  var n     = 0;
  if (faces && typeof faces.forEach === 'function') faces.forEach(function(f) { if (f.status === 'loaded') n++; });
  var key = [cs.fontFamily, cs.fontWeight, cs.fontStyle, cs.fontStretch, cs.fontVariantNumeric, cs.fontFeatureSettings, cs.fontVariationSettings, n].join('|');
  if (_mjsFxCountFonts[key]) return _mjsFxCountFonts[key];
  var keep = layer.textContent;
  var r    = document.createRange();
  var high = 0;
  var best = '0';
  for (var i = 0; i < 10; i++) {
    layer.textContent = '' + i;
    r.selectNodeContents(layer.firstChild);
    var w = µ._mjs_dom.getBoundingClientRect(r).width;
    if (!w) break;
    if (w > high) { high = w; best = '' + i; }
  }
  layer.textContent = keep;
  return i < 10 ? null : _mjsFxCountFonts[key] = best;
}

// @@ pad
// l'écriture sur au moins `pad` chiffres : la valeur est ramenée sur `pad` + 1 chiffres (un 1 devant), écrite comme toutes les autres (séparateurs de milliers,
// décimales, préfixe, suffixe), puis le 1 est ôté, avec le séparateur de milliers qu'il laissait en tête (« 1 003 » : le 1 seul dans son groupe)
function _mjsFxCountPad(num, s) {
  var base = Math.pow(10, s.pad);
  var head = ('' + (s.prefix || '')).length;
  return function(v) {
    var a = Math.abs(v);
    var r = a.toFixed(num.dec);
    // les chiffres de la partie entière tels que `fmt` les écrit : l'arrondi peut en ajouter un (99,6 → 100)
    if (r.split('.')[0].length >= s.pad) return num.fmt(v);
    var t = num.fmt(a + base);
    // le signe suit la valeur arrondie : -0,3 s'écrit 00, jamais -00
    return t.slice(0, head) + (v < 0 && /[1-9]/.test(r) ? '-' : '') + t.slice(head + 1).replace(/^\D+/, '');
  };
}
// @@

// @@ style=flip
// le rendu en volets (cf. l'en-tête) : une rangée de cartes, une par chiffre du nombre écrit, et entre elles le reste du nombre en texte. Une carte a quatre
// moitiés, dans cet ordre : le haut et le bas qu'on voit au repos, le volet du haut qui tombe (le haut de l'ancien chiffre) et le volet du bas qui se
// relève (le bas du nouveau). Le chiffre d'une moitié est son attribut `mjs-fx-count-d`, que la feuille écrit (`content: attr()`) : aucun texte dans les cartes.
// La rangée vit d'une reconstruction du calque à l'autre (`mount` la remet dans le calque vidé) : les cartes gardent leur chiffre et leur bascule en cours.
// `probe` : la même rangée, cachée, où la mesure du cœur (µ._mjs_fxNumWidth) écrit les nombres qu'elle compare — elle leur écrit un texte, la rangée le reçoit
// en cartes
function _mjsFxCountFlip(s) {
  var cells = [];
  var make  = function(tag, mark) {
    var n = document.createElement(tag);
    if (mark) n.setAttribute(mark, '');
    return n;
  };
  var row   = make('span', 'mjs-fx-count-row');
  var probe = make('span', 'mjs-fx-count-row');
  probe.setAttribute('mjs-fx-count-probe', '');
  var tokens = function(t) { return t.match(/\d|\D+/g) || []; };
  var tilt   = function(deg) { return 'perspective(4em) rotateX(' + deg + 'deg)'; };
  var card   = function(d) {
    var c = make('span');
    c.setAttribute('mjs-fx-count-card', d);
    for (var i = 0; i < 4; i++) {
      var h = make('i');
      h.setAttribute('mjs-fx-count-d', d);
      c.appendChild(h);
    }
    return c;
  };
  var text = function(t) {
    var c = make('span', 'mjs-fx-count-char');
    c.textContent = t;
    return c;
  };
  // une carte au repos : ses quatre moitiés montrent le même chiffre
  var rest = function(k, d) {
    for (var i = 0; i < 4; i++) k.el.children[i].setAttribute('mjs-fx-count-d', d);
    k.el.setAttribute('mjs-fx-count-card', d);
    k.d = d;
  };
  // la bascule vers le dernier chiffre demandé : le volet du haut tombe sur l'ancien chiffre, puis celui du bas se relève avec le nouveau ; au repos, la carte
  // en reprend une si un autre chiffre a été demandé entre-temps
  var turn = function(k) {
    var now  = k.want;
    var c    = k.el;
    var half = µ._mjs_fxMs(s.speed, 400) / 2;
    if (µ._mjs_fxCalm() || !(half > 0) || typeof c.animate !== 'function') { rest(k, now); return; }
    var p = c.children;
    k.busy = true;
    c.setAttribute('mjs-fx-count-card', now);
    c.setAttribute('mjs-fx-count-flip', '');
    p[0].setAttribute('mjs-fx-count-d', now);
    p[2].setAttribute('mjs-fx-count-d', k.d);
    p[3].setAttribute('mjs-fx-count-d', now);
    var fall = k.run = µ._mjs_animate(p[2], [{ transform: tilt(0) }, { transform: tilt(-90) }], { duration: half, easing: 'ease-in', fill: 'forwards' });
    fall.onfinish = function() {
      if (k.dead) return;
      var rise = k.run = µ._mjs_animate(p[3], [{ transform: tilt(90) }, { transform: tilt(0) }], { duration: half, easing: 'ease-out', fill: 'forwards' });
      rise.onfinish = function() {
        if (k.dead) return;
        rest(k, now);
        fall.cancel();
        rise.cancel();
        c.removeAttribute('mjs-fx-count-flip');
        k.busy = false;
        k.run  = null;
        if (k.want !== now) turn(k);
      };
    };
  };
  var drop = function(k) {
    k.dead = true;
    if (k.run) k.run.cancel();
    k.run = null;
  };
  // la rangée cachée reçoit le texte que la mesure lui écrit
  Object.defineProperty(probe, 'textContent', {
    configurable: true,
    get: function() { return ''; },
    set: function(t) {
      while (probe.firstChild) probe.removeChild(probe.firstChild);
      var list = tokens('' + t);
      for (var i = 0; i < list.length; i++) probe.appendChild(/\d/.test(list[i]) ? card(list[i]) : text(list[i]));
    }
  });
  return {
    probe: probe,
    // la rangée et sa jumelle cachée dans le calque, vidé par la reconstruction
    mount: function(layer) {
      layer.appendChild(row);
      layer.appendChild(probe);
    },
    // le nombre écrit : les cartes dont le chiffre change basculent ; la première fois, les cartes naissent au repos
    show: function(txt) {
      var list  = tokens(txt);
      var first = cells.length === 0;
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        var d = /\d/.test(t);
        var k = cells[i];
        if (k && k.digit === d) {
          if (d) {
            k.want = t;
            if (!k.busy && k.d !== t) turn(k);
          }
          else if (k.t !== t) { k.el.textContent = t; k.t = t; }
          continue;
        }
        var n = d ? { digit: true, el: card(first ? t : ''), d: first ? t : '', want: t, busy: false, dead: false, run: null } : { digit: false, el: text(t), t: t };
        if (k) {
          drop(k);
          row.replaceChild(n.el, k.el);
        }
        else row.appendChild(n.el);
        cells[i] = n;
        if (d && !first) turn(n);
      }
      while (cells.length > list.length) {
        var gone = cells.pop();
        drop(gone);
        row.removeChild(gone.el);
      }
    },
    off: function() {
      for (var i = 0; i < cells.length; i++) drop(cells[i]);
      cells = [];
    }
  };
}
// @@

µ._mjs_fxDefs.count = {
  css: ''
    // @@ style=flip
    // les volets : une rangée de cartes qui prend la hauteur de la balise ; une carte a quatre moitiés (haut, bas, volet qui tombe, volet qui se relève) dont le chiffre
    // est écrit par `content: attr()`, séparées par un trait et un léger dégradé (le haut s'éclaire, le bas s'assombrit) ; les volets ne se voient que pendant la bascule (`mjs-fx-count-flip`)
    + '[mjs-fx~="count"] [mjs-fx-count-row]{display:inline-flex;align-items:center;gap:.06em;height:100%;vertical-align:top}'
    + '[mjs-fx-count-probe]{position:absolute;left:0;top:0;visibility:hidden;pointer-events:none}'
    + '[mjs-fx-count-card]{position:relative;flex:none;align-self:stretch;width:.86em;border-radius:.14em;color:var(--mjs-count-color,#f5f7fa);-webkit-text-fill-color:currentColor;background:var(--mjs-count-background,#1f2633);box-shadow:0 .05em .12em rgba(0,0,0,.3)}'
    + '[mjs-fx-count-card]::after{content:"";position:absolute;left:0;right:0;top:50%;height:max(1px,.025em);background:rgba(0,0,0,.45);transform:translateY(-50%)}'
    + '[mjs-fx-count-card] i{position:absolute;left:0;right:0;height:50%;overflow:hidden;background:inherit;font-style:normal}'
    + '[mjs-fx-count-card] i:nth-child(odd){top:0;border-radius:.14em .14em 0 0;background-image:linear-gradient(rgba(255,255,255,.08),rgba(255,255,255,0))}'
    + '[mjs-fx-count-card] i:nth-child(even){bottom:0;border-radius:0 0 .14em .14em;background-image:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.2))}'
    + '[mjs-fx-count-card] i:nth-child(3){transform-origin:50% 100%}'
    + '[mjs-fx-count-card] i:nth-child(4){transform-origin:50% 0;transform:perspective(4em) rotateX(90deg)}'
    + '[mjs-fx-count-card] i:nth-child(n+3){visibility:hidden}'
    + '[mjs-fx-count-flip] i:nth-child(n+3){visibility:visible}'
    + '[mjs-fx-count-card] i::before{content:attr(mjs-fx-count-d);position:absolute;left:0;right:0;height:200%;display:flex;align-items:center;justify-content:center;line-height:1}'
    + '[mjs-fx-count-card] i:nth-child(odd)::before{top:0}'
    + '[mjs-fx-count-card] i:nth-child(even)::before{bottom:0}'
    + '[mjs-fx-count-char]{align-self:center;white-space:pre}'
    // @@
    + '[mjs-fx~="count"] [mjs-fx-layer="text"]{font-variant-numeric:tabular-nums;white-space:nowrap}',
  vars: { background: '', color: '' },
  // la durée d'un jeu (une sortie `@out=*count` l'attend)
  span: function(el, s) { return µ._mjs_fxMs(s.delay, 0) + µ._mjs_fxMs(s.duration, 2000); },
  setup: function(el, s, comp) {
    var from   = typeof s.from === 'number' ? s.from : 0;
    var num    = µ._mjs_fxNum(s);
    var fmt    = num.fmt;
    var parse  = num.parse;
    var curve  = num.curve;
    var target = null;
    var shown  = from;
    var lead   = from;
    var rest   = null;
    var played = false;
    var raf    = 0;
    var wait   = null;
    var layer  = null;
    var flip   = null;
    // le nœud où la mesure de la place écrit les nombres qu'elle compare : le calque (en volets, la rangée cachée)
    var ruler  = function() { return layer; };
    if (s.pad > 1) fmt = _mjsFxCountPad(num, s); // @@ pad
    if (s.style === 'flip') flip = _mjsFxCountFlip(s); // @@ style=flip
    if (flip) ruler = function() { return flip.probe; }; // @@ style=flip
    var paint = function(v) {
      shown = v;
      if (!layer) return;
      if (flip) { flip.show(fmt(v)); return; } // @@ style=flip
      layer.textContent = fmt(v);
    };
    // fin d'un décompte : la balise prend d'un coup la place du nombre final, lue d'avance (`rest` : rien à rendre quand le départ n'était pas plus long)
    var settle = function() {
      lead = null;
      if (rest === null) return;
      el.style.minWidth = rest;
      rest = null;
    };
    var animate = function(a, b) {
      cancelAnimationFrame(raf);
      lead = a;
      if (µ._mjs_fxCalm() || typeof requestAnimationFrame !== 'function') { paint(b); settle(); return; }
      // durée et courbe du décompte lues à son départ : un réglage changé en route vaut au suivant
      var d  = µ._mjs_fxMs(s.duration, 2000);
      var c  = curve;
      var t0 = null;
      var tick = function(now) {
        if (t0 === null) t0 = now;
        var k = d > 0 ? Math.min(1, (now - t0) / d) : 1;
        paint(a + (b - a) * c(k));
        if (k < 1) raf = requestAnimationFrame(tick);
        else settle();
      };
      raf = requestAnimationFrame(tick);
    };
    var tx = µ._mjs_fxLayer(comp, el, function(l, txt) {
      layer = l;
      var n = parse(txt);
      // pas un nombre : le texte tel quel
      if (n === null) { l.textContent = txt; target = null; return; }
      if (flip) flip.mount(l); // @@ style=flip
      target = n;
      rest   = null;
      if (played) animate(shown, n);
      else paint(from);
    });
    // une balise en ligne passe en inline-block : seul moyen de lui donner une largeur
    var inline = µ._mjs_fxMovable(el);
    var minW   = el.style.minWidth;
    var dead   = false;
    var wake   = null;
    var redo   = 0;
    // le gabarit d'un nombre : chaque chiffre de sa partie nombre (ni le préfixe ni le suffixe) devient le chiffre `digit`
    var shape = function(digit) {
      var head = ('' + (s.prefix || '')).length;
      var tail = ('' + (s.suffix || '')).length;
      return function(v) {
        var t = fmt(v);
        var e = t.length - tail;
        return t.slice(0, head) + t.slice(head, e).replace(/\d/g, digit) + t.slice(e);
      };
    };
    // la place du nombre le plus large qu'elle affichera (le gabarit du départ du décompte en cours et de l'arrivée, ou l'arrivée). Sans boîte (le composant est
    // encore masqué à la pose, la zone est cachée), la mesure ne rend rien : la place est reprise dès que la
    // balise en a une, par un observateur de taille débranché dès qu'il a servi, ou dès qu'une mesure trouve une boîte. Son premier avis arrive
    // toujours, balise masquée et taille nulle : sans boîte, il n'est pas écouté
    var reserve = function() {
      if (dead || !layer) return;
      rest = null;
      if (target === null) { el.style.minWidth = minW; return; }
      // le chiffre le plus large de la police (rien à lire une fois le décompte fini : la place est celle de l'arrivée seule ; en volets, toutes les cartes ont la même largeur)
      var digit  = lead === null || flip ? null : _mjsFxCountDigit(layer);
      var a      = lead === null ? 0 : fmt(lead).length;
      var b      = fmt(target).length;
      var longer = a > b;
      // le gabarit tenu pendant le décompte est plus large que le nombre final (chiffres de largeurs inégales, noyau « 11 », départ plus long) : la place de l'arrivée seule se lit d'avance. Sans chiffre lu (balise cachée), seulement quand le départ est plus long
      if (digit !== null || longer) {
        µ._mjs_fxNumWidth(el, ruler(), [target], fmt, minW);
        rest = el.style.minWidth;
      }
      // pendant le décompte : le plus long des deux bouts (les deux à longueur égale), chaque chiffre au plus large ; sans chiffre lu, les deux bouts tels quels
      var vals = lead === null ? [target] : digit === null || a === b ? [lead, target] : longer ? [lead] : [target];
      µ._mjs_fxNumWidth(el, ruler(), vals, digit === null ? fmt : shape(digit), minW);
      // une boîte : la mesure est faite, l'observateur encore armé (celui de la pose, quand l'hôte s'est montré dans le micro-tâche) n'a plus rien à attendre
      if (µ._mjs_dom.getClientRects(el).length) {
        if (wake) wake.disconnect();
        wake = null;
        return;
      }
      // sans boîte, rien n'a été lu : la place de l'arrivée seule n'est pas connue
      rest = null;
      if (wake || typeof ResizeObserver !== 'function') return;
      wake = new ResizeObserver(function() {
        if (!µ._mjs_dom.getClientRects(el).length) return;
        wake.disconnect();
        wake = null;
        // la place s'écrit à l'image suivante, pas ici : écrite dans le rappel, elle change la boîte de la balise et celle d'un parent qu'un observateur de la page suit, et le navigateur signale « ResizeObserver loop » (une erreur de la page)
        redo = requestAnimationFrame(reserve);
      });
      wake.observe(el);
    };
    reserve();
    // l'hôte masqué se montre dans le micro-tâche qui suit le premier rendu : la place est prise avant que l'image soit dessinée
    queueMicrotask(reserve);
    tx.onBuild(reserve);
    // une police arrivée après la pose change la largeur des chiffres : la place est reprise une fois, à la fin
    // du chargement. `loading` (un chargement commence) arme la reprise ; la fin se dit par `ready` (neuf à cet
    // instant) et par `loadingdone` : WebKit n'émet que `loading` puis `ready`, Chromium résout `ready` après
    // `loadingdone`, Firefox avant. Le premier signal reprend la place ; le second, son jumeau, la laisse
    var fonts   = document.fonts || null;
    var waiting = false;
    var twin    = false;
    var byReady = function() {
      if (!waiting) return;
      waiting = false;
      twin    = true;
      reserve();
    };
    var byDone = function() {
      var paired = twin;
      twin       = false;
      waiting    = false;
      if (!paired) reserve();
    };
    var loading = function() {
      waiting = true;
      twin    = false;
      if (fonts.ready && typeof fonts.ready.then === 'function') fonts.ready.then(byReady);
    };
    if (fonts && typeof fonts.addEventListener === 'function') {
      fonts.addEventListener('loading', loading);
      fonts.addEventListener('loadingdone', byDone);
    }
    // une police déjà en route à la pose : son `loading` est parti avant l'effet, qui ne l'a pas entendu
    if (fonts && fonts.status === 'loading') loading();
    var stop = µ._mjs_fxWhen(el, s.on, function() {
      played = true;
      clearTimeout(wait);
      wait = setTimeout(function() {
        if (target === null) return;
        // un décompte rejoué après la fin du précédent : le départ reprend sa place, avec celle de l'arrivée
        var held = lead === from;
        animate(from, target);
        if (!held) reserve();
      }, µ._mjs_fxMs(s.delay, 0));
    });
    var off = function() {
      dead = true;
      if (wake) wake.disconnect();
      cancelAnimationFrame(redo);
      if (fonts && typeof fonts.removeEventListener === 'function') {
        fonts.removeEventListener('loading', loading);
        fonts.removeEventListener('loadingdone', byDone);
      }
      stop();
      clearTimeout(wait);
      cancelAnimationFrame(raf);
      if (flip) flip.off(); // @@ style=flip
      tx.off();
      el.style.minWidth = minW;
      inline();
    };
    // un réglage d'écriture tenu par une variable (préfixe, suffixe, zéros de tête) : le nombre affiché se réécrit sur place, sans
    // recompter ; durée, courbe et attente valent au décompte suivant. Le reste relance l'effet (rend false) : un séparateur ou une
    // marque des décimales qui changent (la langue) rejouent le décompte, comme le style, `on` ou `from`
    off.set = function(k, v) {
      if (!/^(?:prefix|suffix|pad|duration|easing|delay)$/.test(k)) return false;
      var next = Object.assign(Object.create(null), s);
      if (v === void 0) delete next[k];
      else next[k] = v;
      var n = µ._mjs_fxNum(next);
      // les décimales du texte, lues comme à la pose
      if (target !== null) n.parse(tx.text);
      s     = next;
      num   = n;
      fmt   = n.fmt;
      parse = n.parse;
      curve = n.curve;
      if (s.pad > 1) fmt = _mjsFxCountPad(num, s); // @@ pad
      if (target !== null) paint(shown);
      reserve();
    };
    return off;
  }
};
