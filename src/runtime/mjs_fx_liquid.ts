// mjs_fx_liquid — `*liquid` : l'image se tord comme de l'eau quand on la survole. Deux façons de
// déformer, selon les réglages. Sans cells, radius ni ghost (le défaut) : un filtre SVG
// feTurbulence + feDisplacementMap propre à la balise, posé dans la même racine qu'elle (rien n'est
// ajouté dans la balise, une `<img>` convient), qui déforme toute l'image en douceur. Avec l'un
// d'eux, sur une `<img>` lisible : un petit programme WebGL posé par-dessus l'image le temps de la
// déformation — la déformation ne vit qu'autour de la souris, par carreaux si on le demande.
// La force passe en douceur du repos à l'actif ; les vagues bougent (leur position dérive
// en boucle) ; la boucle ne tourne que s'il y a quelque chose à animer (ni hors écran, ni onglet
// caché, ni au repos : la force revenue à celle du repos, les vagues s'arrêtent où elles sont, la déformation de repos reste, figée,
// et repartent de là au survol). Réglages : strength (la force de la
// déformation quand l'effet est actif, en px ; 40), cells (le nombre de carreaux sur la largeur de
// l'image, de 0 à 200 ; 0 = déformation lisse, comme avant ; sinon l'image se déforme carreau par
// carreau : chaque carreau montre l'image décalée, d'un décalage qui ondule et change d'un carreau à
// l'autre ; 0), radius (le rayon en px de la zone déformée autour de la souris, de 0 à 2000 ; 0 = toute
// l'image ; sinon la force décroît vite avec la distance et s'éteint au bord de la zone ; 0), ghost
// (une couleur : un fantôme de l'image, décalé plus loin et teinté de cette couleur, dans la zone
// déformée ; aucun), resolution (le plafond de la densité de pixels de la toile, de 0.5 à 4 : sur un écran très fin elle ne dépasse pas cette part de la taille
// CSS, ni la densité de l'écran ; 1.5), rest (la part de la force au repos, de 0 à 1 ; 0 = image nette ; 0.12 ; pour la déformation lisse seulement), frequency
// (la finesse des vagues, de 0.001 à 0.2 ; 0.015), octaves (le nombre de couches de vagues, de 1 à 5 ;
// 2), seed (la graine du hasard des vagues ; 2), animate (les vagues bougent ; vrai), speed (la durée
// d'une ondulation ; 4s), duration (le passage du repos à l'actif, et l'extinction quand la souris
// sort ; 500ms), on (hover : actif pendant le survol ; always ; view : actif dès l'arrivée à
// l'écran ; click : chaque clic bascule). « Réduire les animations » : aucune déformation animée, la
// force du repos reste fixe (déformation lisse) ; par carreaux, rien ne se déforme.
// Par carreaux, sous la souris (cells, radius, ghost) : la toile ne vit que pendant la déformation —
// elle se pose à l'entrée de la souris (la boîte, l'arrondi, l'opacité, `object-fit` et
// `object-position` de l'image sont lus à ce moment, une fois) et se retire quand la force est
// revenue à zéro : la balise redevient nue, plus aucune boucle. Au repos, ni toile, ni contexte WebGL,
// ni image peinte, avec ou sans radius : la force de repos (rest) ne vaut que pour la déformation lisse. Le programme rendu à la réserve ne garde que sa
// compilation : sa toile et l'image qu'il avait en texture sont ramenées à 1 px.
// Pendant la déformation, seul le contenu de l'image passe sous la toile (poussé hors de sa boîte, sans
// rien perdre de ses événements) : sa bordure, son fond, son ombre et son contour restent peints par
// l'image. La toile couvre la boîte de contenu, posée sur le même rectangle que celle de l'image (le navigateur
// l'arrondit comme elle) ; elle est rognée comme l'image par ses ancêtres qui rognent (l'intersection de leurs boîtes, l'arrondi du plus
// proche) et suit leur défilement et leur taille. À la souris immobile avec animate: false, plus aucune
// image n'est peinte ; par image, seuls des uniformes sont écrits et un seul dessin recouvre toute
// la toile (son tampon de dessin n'est pas conservé : le navigateur n'a rien à recopier ; hors de la zone, le programme relit simplement l'image). Avec radius, la zone suit la souris et
// la force s'éteint sur duration quand elle sort ; sans radius, toute l'image est la zone tant que l'état
// est actif (on: always, view, click : toutes les images actives déforment ensemble, au plus 8 à la fois :
// les suivantes prennent la déformation lisse et un avertissement le dit une fois). Image illisible (autre
// origine servie sans `crossorigin`), balise qui n'est pas une `<img>`, navigateur sans WebGL : la
// déformation lisse d'avant, sur toute l'image, jamais une image cassée ; la console reçoit alors UN avertissement
// par cause et par page (pas par balise), qui dit la cause et le remède. Limites : la toile est posée à
// côté de l'image (même parent) ; une transformation (`transform`) ou un filtre posés sur l'image
// elle-même ne sont pas repris par la toile : les poser sur une balise englobante. Une image animée (GIF,
// WebP animé) est dessinée une fois à l'entrée de la souris : elle reste figée le temps de la déformation. À la densité 2, sur des bords fractionnaires, la texture peut être étirée de un
// ou deux pixels d'écran (le navigateur arrondit les bords de la boîte d'une façon que la page ne lit pas). Deux effets à filtre sur une même balise
// (`*liquid` lisse et `*filter`, `*chromatic`) se disputent la propriété `filter` : un avertissement
// dit d'en poser un sur une balise englobante. `*blend` fait exception : il compose son filtre après
// celui de `*liquid` (le calque se fond sur l'image déformée).

(function() {
  var NS  = 'http://www.w3.org/2000/svg';
  var n   = 0;
  var r   = function(v) { return Math.round(v * 1000) / 1000; };
  var num = function(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };

  // la déformation lisse : un filtre SVG sur toute la balise (le comportement d'origine, inchangé)
  var smooth = function(el, s) {
    var cfg = {
      strength:  num(s.strength, 40),
      rest:      num(s.rest, .12),
      frequency: num(s.frequency, .015),
      speed:     µ._mjs_fxMs(s.speed, 4000),
      duration:  µ._mjs_fxMs(s.duration, 500),
      animate:   s.animate !== false
    };
    // @@ cells radius ghost
    why(el, s);
    // @@
    var id   = 'mjs-fx-liquid-' + (++n);
    var svg  = µ._mjs_fxSvgDefs(el);
    svg.setAttribute('mjs-fx-liquid-svg', '');
    var f    = document.createElementNS(NS, 'filter');
    var turb = document.createElementNS(NS, 'feTurbulence');
    var map  = document.createElementNS(NS, 'feDisplacementMap');
    f.setAttribute('id', id);
    f.setAttribute('color-interpolation-filters', 'sRGB');
    turb.setAttribute('type', 'fractalNoise');
    turb.setAttribute('numOctaves', String(Math.min(5, Math.max(1, Math.round(num(s.octaves, 2))))));
    turb.setAttribute('seed', String(Math.round(num(s.seed, 2))));
    turb.setAttribute('result', 'mjs-fx-liquid-noise');
    map.setAttribute('in', 'SourceGraphic');
    map.setAttribute('in2', 'mjs-fx-liquid-noise');
    map.setAttribute('xChannelSelector', 'R');
    map.setAttribute('yChannelSelector', 'G');
    f.appendChild(turb);
    f.appendChild(map);
    svg.appendChild(f);

    var calm    = µ._mjs_fxCalm();
    var cur     = cfg.strength * cfg.rest;
    var active  = false;
    var visible = true;
    var shown   = false;
    var raf     = 0;
    var last    = 0;
    var clock   = 0;
    var goal    = function() { return !calm && active ? cfg.strength : cfg.strength * cfg.rest; };
    var draw    = function(now) {
      var phase = cfg.animate && !calm && cfg.speed > 0 ? now * 2 * Math.PI / cfg.speed : 0;
      var fx    = cfg.frequency * (1 + .35 * Math.sin(phase));
      var fy    = cfg.frequency * 1.6 * (1 + .3 * Math.sin(phase * .78));
      turb.setAttribute('baseFrequency', r(fx) + ' ' + r(fy));
      map.setAttribute('scale', r(cur));
      // image nette : le filtre est retiré, la balise ne le paie pas
      var on = cur >= .05;
      if (on === shown) return;
      shown = on;
      if (on) {
        el.style.setProperty('--mjs-fx-liquid-filter', 'url(#' + id + ')');
        µ._mjs_dom.setAttribute(el, 'mjs-fx-liquid-on', '');
      }
      else {
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-liquid-on');
        el.style.removeProperty('--mjs-fx-liquid-filter');
      }
    };
    var wants = function() {
      if (calm || !visible || (typeof document !== 'undefined' && document.hidden)) return false;
      if (Math.abs(cur - goal()) > .05) return true;
      return cfg.animate && cur >= .05 && active;
    };
    var tick = function(now) {
      raf = 0;
      var dt = last ? Math.min(100, now - last) : 16;
      last = now;
      var g = goal();
      if (cfg.duration <= 0) cur = g;
      else cur += (g - cur) * (1 - Math.exp(-dt * 3 / cfg.duration));
      if (Math.abs(cur - g) < .05) cur = g;
      // le temps des vagues ne court que pendant que la boucle tourne : figées au repos, elles repartent d'où elles étaient
      clock += dt;
      draw(clock);
      if (wants()) raf = requestAnimationFrame(tick);
      else last = 0;
    };
    var wake = function() {
      if (raf || !wants() || typeof requestAnimationFrame !== 'function') return;
      raf = requestAnimationFrame(tick);
    };
    var stopRaf = function() {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf  = 0;
      last = 0;
    };

    // l'état actif : posé par le cœur (jeton `liquid` dans `mjs-fx-on`), relu à chaque changement
    var gate  = µ._mjs_fxState(el, 'liquid', s.on || 'hover');
    var read  = function() { active = (µ._mjs_dom.getAttribute(el, 'mjs-fx-on') || '').split(' ').indexOf('liquid') >= 0; wake(); };
    var mo    = typeof MutationObserver === 'function' ? new MutationObserver(read) : null;
    if (mo) mo.observe(el, { attributes: true, attributeFilter: ['mjs-fx-on'] });
    else active = true;
    read();
    var io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function(entries) {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) wake();
      else stopRaf();
    }) : null;
    if (io) io.observe(el);
    var onVisible = function() { if (document.hidden) stopRaf(); else wake(); };
    document.addEventListener('visibilitychange', onVisible);
    draw(0);
    wake();

    // deux filtres sur la même balise : le dernier posé gagne, l'autre est perdu
    var warned = setTimeout(function() {
      var tokens = (µ._mjs_dom.getAttribute(el, 'mjs-fx') || '').split(' ');
      var other  = tokens.indexOf('filter') >= 0 || tokens.indexOf('chromatic') >= 0;
      // *blend posé en filtre compose les filtres de la balise : rien ne se perd
      if (!other || el._mjs_fxFilterWarn || µ._mjs_dom.getAttribute(el, 'mjs-fx-blend-use') === 'filter') return;
      el._mjs_fxFilterWarn = true;
      µ.warn(µ._mjs_msg('liquidFilter', null, '*liquid : la balise porte déjà un autre effet à filtre (*filter ou *chromatic) : les deux se disputent la propriété CSS filter. Posez l\'un des deux sur une balise englobante.'));
    }, 0);

    var off = function() {
      clearTimeout(warned);
      stopRaf();
      gate();
      if (mo) mo.disconnect();
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-liquid-on');
      el.style.removeProperty('--mjs-fx-liquid-filter');
      el._mjs_fxFilterWarn = false;
      svg.remove();
    };
    // un réglage tenu par une variable change sur place (octaves, graine et déclencheur reposent l'effet)
    off.set = function(k, v) {
      if (k === 'strength') cfg.strength = num(v, 40);
      else if (k === 'rest') cfg.rest = num(v, .12);
      else if (k === 'frequency') cfg.frequency = num(v, .015);
      else if (k === 'speed') cfg.speed = µ._mjs_fxMs(v, 4000);
      else if (k === 'duration') cfg.duration = µ._mjs_fxMs(v, 500);
      else if (k === 'animate') cfg.animate = v !== false;
      else return false;
      if (calm) cur = goal();
      draw(clock);
      wake();
    };
    return off;
  };

  // @@ cells radius ghost
  // ----- par carreaux, sous la souris : un programme WebGL posé sur l'image -----
  // la toile ne dépasse jamais MAXPX pixels de côté (au-delà, le navigateur l'étire) ; au plus MAXKITS programmes
  // WebGL en service à la fois (les navigateurs en retirent au-delà d'une quinzaine)
  var EPS     = .05;
  var MAXPX   = 2560;
  var MAXKITS = 8;
  var VERT    = 'attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}';
  // v : le point de la toile, de 0 à 1 depuis le coin haut gauche ; tout le reste se compte en px CSS
  // le champ de vagues est lu dans une petite texture de hasard (une seule lecture lissée par couche) ;
  // en carreaux, il est lu au centre du carreau, donc le même pour tout le carreau ; là où la force est nulle (hors de la zone),
  // le programme ne lit que l'image : toute la toile est redessinée à chaque image, sans conserver le tampon
  var FRAG    = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 v;',
    'uniform sampler2D uImg;',
    'uniform sampler2D uNoise;',
    'uniform vec2 uSize;',
    'uniform vec2 uMouse;',
    'uniform float uPhase;',
    'uniform float uAmp;',
    'uniform float uCells;',
    'uniform float uRadius;',
    'uniform float uFreq;',
    'uniform float uOct;',
    'uniform vec4 uGhost;',
    'vec3 lattice(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  f = f * f * (3. - 2. * f);',
    '  return texture2D(uNoise, (i + f + .5) / 64.).rgb;',
    '}',
    'vec2 wave(vec2 p) {',
    '  vec2 sum = vec2(0.);',
    '  float w = 1.;',
    '  float tot = 0.;',
    '  for (int i = 0; i < 5; i++) {',
    '    if (float(i) >= uOct) break;',
    '    float k = float(i);',
    '    float ph = uPhase * (1. + .37 * k) + k * 1.9;',
    '    vec2 drift = vec2(cos(ph), sin(ph * .83 + 1.3)) * (1.5 + k);',
    '    sum += (lattice(p * uFreq * exp2(k) + drift).xy - .5) * 2. * w;',
    '    tot += w;',
    '    w *= .5;',
    '  }',
    '  return sum / tot;',
    '}',
    'void main() {',
    '  vec2 at = v * uSize;',
    '  vec2 id = vec2(0.);',
    '  if (uCells > 0.) {',
    '    float side = uSize.x / uCells;',
    '    id = floor(at / side);',
    '    at = (id + .5) * side;',
    '  }',
    '  float f = 1.;',
    '  if (uRadius > 0.) {',
    '    float t = clamp(1. - distance(at, uMouse) / uRadius, 0., 1.);',
    '    f = t * t;',
    '  }',
    '  vec4 c;',
    '  if (f > 0.) {',
    '    vec2 shiver = vec2(0.);',
    '    float part = 0.;',
    '    if (uCells > 0.) {',
    '      vec3 h = texture2D(uNoise, (id + .5) / 64.).rgb;',
    '      shiver = vec2(sin(uPhase * 1.3 + h.r * 6.2832), cos(uPhase * 1.1 + h.g * 6.2832));',
    '      part = .35;',
    '    }',
    '    vec2 o = mix(wave(at), shiver, part) * (f * uAmp * .5);',
    '    c = texture2D(uImg, clamp(v + o / uSize, 0., 1.));',
    '    if (uGhost.a > 0.) {',
    '      vec4 g = texture2D(uImg, clamp(v + o * 2.2 / uSize, 0., 1.));',
    '      float l = dot(g.rgb, vec3(.299, .587, .114)) * uGhost.a * f;',
    '      c = vec4(uGhost.rgb * l + c.rgb * (1. - l), l + c.a * (1. - l));',
    '    }',
    '  }',
    '  else {',
    '    c = texture2D(uImg, v);',
    '  }',
    '  gl_FragColor = c;',
    '}'
  ].join('\n');
  var NAMES   = ['uImg', 'uNoise', 'uSize', 'uMouse', 'uPhase', 'uAmp', 'uCells', 'uRadius', 'uFreq', 'uOct', 'uGhost'];

  var kits   = [];
  var live   = 0;
  var drain  = 0;
  var broken = false;
  var told   = {};
  var swatch = null;

  var cellsOf      = function(v) { return Math.min(200, Math.max(0, Math.round(num(v, 0)))); };
  var radiusOf     = function(v) { return Math.min(2000, Math.max(0, num(v, 0))); };
  var resolutionOf = function(v) { return Math.min(4, Math.max(.5, num(v, 1.5))); };
  var lose         = function(gl) {
    var e = gl.getExtension ? gl.getExtension('WEBGL_lose_context') : null;
    if (e) e.loseContext();
  };

  // la déformation lisse prend la place des carreaux : la page en est prévenue UNE fois par cause (pas une fois par balise), la cause et le remède en une phrase
  var tell = function(key) {
    if (told[key]) return;
    told[key] = true;
    if (key === 'liquidTag') µ.warn(µ._mjs_msg('liquidTag', null, '*liquid : cette balise n\'est pas une <img>, elle prend donc la déformation lisse ; posez *liquid sur une <img> pour avoir les carreaux.'));
    else if (key === 'liquidCors') µ.warn(µ._mjs_msg('liquidCors', null, '*liquid : cette image vient d\'un autre site et le navigateur ne la laisse pas lire sans crossorigin, elle prend donc la déformation lisse ; ajoutez crossorigin="anonymous" à la balise <img> (le site de l\'image doit l\'autoriser).'));
    else if (key === 'liquidGl') µ.warn(µ._mjs_msg('liquidGl', null, '*liquid : ce navigateur ne propose pas WebGL, les images prennent donc la déformation lisse ; activez l\'accélération matérielle du navigateur.'));
    else µ.warn(µ._mjs_msg('liquidCap', { max: MAXKITS }, '*liquid : plus de {max} images se déforment en même temps par carreaux (le navigateur limite les contextes WebGL) : les suivantes prennent la déformation lisse. Posez radius : seule l\'image sous la souris se déforme alors.'));
  };
  // une balise qui demande les carreaux et prend d'emblée la déformation lisse : pourquoi ?
  var why = function(el, s) {
    if (!(cellsOf(s.cells) > 0 || radiusOf(s.radius) > 0 || colorOf(s.ghost) !== null)) return;
    if (el.localName !== 'img') tell('liquidTag');
    else if (broken) tell('liquidGl');
    else if (el.complete === true && el.naturalWidth > 0 && !clean(el)) tell('liquidCors');
  };

  // une couleur CSS → [r, g, b, a] de 0 à 1 (celle que la toile 2D comprend) ; null si elle n'est pas lisible ou transparente
  var colorOf = function(v) {
    if (typeof v !== 'string' || v === '') return null;
    if (!swatch) {
      swatch = document.createElement('canvas');
      swatch.width  = 1;
      swatch.height = 1;
    }
    var g = typeof swatch.getContext === 'function' ? swatch.getContext('2d', { willReadFrequently: true }) : null;
    if (!g) return null;
    g.fillStyle = '#010203';
    g.fillStyle = v;
    if (g.fillStyle === '#010203') return null;
    g.clearRect(0, 0, 1, 1);
    g.fillRect(0, 0, 1, 1);
    var d = g.getImageData(0, 0, 1, 1).data;
    return d[3] > 0 ? [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255] : null;
  };

  // l'image se lit-elle sans autorisation de plus ? Même origine, `data:`, `blob:`, ou chargée avec `crossorigin`
  // (sans cela elle n'aurait pas chargé) ; le dernier mot reste à la texture, qui refuse une image que la page ne peut lire
  var clean = function(img) {
    var src = img.currentSrc || img.src;
    if (!src) return false;
    if (img.crossOrigin !== null && img.crossOrigin !== void 0) return true;
    if (/^(data|blob):/i.test(src)) return true;
    try {
      return new URL(src, location.href).origin === location.origin;
    }
    catch (e) {
      return false;
    }
  };

  // où l'image tombe dans la boîte (px CSS), selon object-fit et object-position
  var place = function(fit, pos, nw, nh, W, H) {
    var dw = W;
    var dh = H;
    if (fit === 'contain' || fit === 'cover' || fit === 'none' || fit === 'scale-down') {
      var k = fit === 'cover' ? Math.max(W / nw, H / nh) : fit === 'none' ? 1 : Math.min(W / nw, H / nh);
      if (fit === 'scale-down') k = Math.min(1, k);
      dw = nw * k;
      dh = nh * k;
    }
    var p  = String(pos || '50% 50%').split(/\s+/);
    var at = function(t, free) {
      var m = /^(-?[\d.]+)(%|px)$/.exec(t || '');
      if (!m) return free / 2;
      return m[2] === '%' ? free * parseFloat(m[1]) / 100 : parseFloat(m[1]);
    };
    return { x: at(p[0], W - dw), y: at(p[1] || p[0], H - dh), w: dw, h: dh };
  };

  var CORNERS = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];
  // l'éloignement qu'on écrit pour un côté qui ne rogne pas
  var FAR     = 1e4;

  // une longueur à l'unité de mise en page du navigateur (1/64 px) : une boîte posée à la même place et à la même taille que celle de
  // l'image tombe sur les mêmes pixels d'écran, quel que soit l'arrondi (au pixel CSS ou au pixel d'écran) que le navigateur applique ;
  // la texture, elle, a la taille arrondie de la boîte × la densité : au plus un ou deux pixels d'écran de plus ou de moins
  var lu = function(v) { return Math.round(v * 64) / 64; };
  var clips = function(v) { return v === 'hidden' || v === 'scroll' || v === 'auto' || v === 'clip' || v === 'overlay'; };

  // les quatre arrondis d'une boîte de w × h px, [horizontal, vertical] par coin (haut gauche, haut droit, bas droit, bas gauche) :
  // ramenés dans la boîte comme le fait CSS, puis réduits de `cut` (haut, droite, bas, gauche : bordure et marge intérieure ôtées)
  var radii = function(cs, w, h, cut) {
    var o = [];
    for (var i = 0; i < 4; i++) {
      var p = cs.getPropertyValue(CORNERS[i]).split(/\s+/);
      o.push([p[0], p[1] || p[0]].map(function(v, j) { return /%$/.test(v) ? parseFloat(v) * (j ? h : w) / 100 : parseFloat(v) || 0; }));
    }
    var side = function(len, sum) { return sum > len ? len / sum : 1; };
    var k    = Math.min(side(w, o[0][0] + o[1][0]), side(w, o[3][0] + o[2][0]), side(h, o[0][1] + o[3][1]), side(h, o[1][1] + o[2][1]));
    var x    = [cut[3], cut[1], cut[1], cut[3]];
    var y    = [cut[0], cut[0], cut[2], cut[2]];
    return o.map(function(c, i) { return [Math.max(0, c[0] * k - x[i]), Math.max(0, c[1] * k - y[i])]; });
  };

  // les ancêtres qui rognent l'image : ceux de la chaîne de ses blocs contenants — une balise en position absolue saute les ancêtres
  // qui ne la contiennent pas (jusqu'à un ancêtre positionné ou transformé), une balise fixe jusqu'à la fenêtre ; le corps et la
  // racine de la page défilent avec elle, ils ne comptent pas
  var clippers = function(el) {
    var list = [];
    var mode = getComputedStyle(el).position;
    var a    = el.parentNode;
    while (a) {
      if (a.nodeType === 1) {
        var cs   = getComputedStyle(a);
        var cb   = cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none';
        var hold = mode === 'absolute' ? cb || cs.position !== 'static' : mode === 'fixed' ? cb : true;
        if (hold) {
          if (a !== document.body && a !== document.documentElement && (clips(cs.overflowX) || clips(cs.overflowY)) && cs.display !== 'inline' && cs.display !== 'contents') list.push(a);
          mode = cs.position;
        }
      }
      a = a.nodeType === 11 ? a.host : a.parentNode;
    }
    return list;
  };

  var shader = function(gl, type, src) {
    var sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  var texture = function(gl, t, unit, wrap) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  };

  // un programme prêt : sa toile, son contexte, ses deux textures (l'image, le hasard) et ses uniformes
  var build = function() {
    var cv = document.createElement('canvas');
    var gl = null;
    try {
      gl = typeof cv.getContext === 'function' ? cv.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power' }) : null;
    }
    catch (e) {
      gl = null;
    }
    if (!gl) return null;
    var vs = shader(gl, gl.VERTEX_SHADER, VERT);
    var fs = shader(gl, gl.FRAGMENT_SHADER, FRAG);
    var pg = gl.createProgram();
    var ok = false;
    if (vs && fs && pg) {
      gl.attachShader(pg, vs);
      gl.attachShader(pg, fs);
      gl.bindAttribLocation(pg, 0, 'a');
      gl.linkProgram(pg);
      ok = !!gl.getProgramParameter(pg, gl.LINK_STATUS);
    }
    if (!ok) {
      lose(gl);
      return null;
    }
    gl.useProgram(pg);
    // un seul grand triangle couvre la toile
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    var kit = { cv: cv, gl: gl, u: {}, img: gl.createTexture(), noise: gl.createTexture(), seed: -1, dead: false, lost: null, bk: null };
    for (var i = 0; i < NAMES.length; i++) kit.u[NAMES[i]] = gl.getUniformLocation(pg, NAMES[i]);
    gl.uniform1i(kit.u.uImg, 0);
    gl.uniform1i(kit.u.uNoise, 1);
    texture(gl, kit.img, 0, gl.CLAMP_TO_EDGE);
    texture(gl, kit.noise, 1, gl.REPEAT);
    cv.addEventListener('webglcontextlost', function(e) {
      e.preventDefault();
      kit.dead = true;
      if (kit.lost) kit.lost();
    });
    return kit;
  };

  // la toile ne garde que 1 px : son tampon de dessin est rendu au navigateur
  var shrink = function(kit) {
    kit.cv.width  = 1;
    kit.cv.height = 1;
  };

  var free = function(kit) {
    kit.dead = true;
    lose(kit.gl);
    shrink(kit);
  };

  // un programme au repos s'emprunte (il évite de recompiler à chaque entrée de la souris) ; sans emploi
  // pendant un moment, il est libéré
  var take = function() {
    if (broken || live >= MAXKITS) return null;
    var kit = kits.pop();
    while (kit && kit.dead) kit = kits.pop();
    if (!kit) {
      kit = build();
      if (!kit) {
        // aucun autre en service : c'est ce navigateur qui n'a pas de WebGL (sinon, trop de contextes d'un coup)
        if (live === 0) broken = true;
        return null;
      }
    }
    if (kits.length === 0) {
      clearTimeout(drain);
      drain = 0;
    }
    live++;
    return kit;
  };
  var give = function(kit) {
    live--;
    if (kit.dead) return;
    // en réserve, le programme garde sa compilation, pas la mémoire graphique de la toile ni de l'image (elle revient à l'entrée suivante)
    shrink(kit);
    var gl = kit.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, kit.img);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    kits.push(kit);
    while (kits.length > 1) free(kits.shift());
    clearTimeout(drain);
    drain = setTimeout(function() {
      drain = 0;
      while (kits.length > 0) free(kits.pop());
    }, 8000);
  };

  // le hasard des vagues : 64 × 64 valeurs, tirées de la graine (xorshift)
  var noiseOf = function(kit, seed) {
    var d = new Uint8Array(64 * 64 * 3);
    var x = (Math.imul(seed + 1, 2654435761) >>> 0) || 1;
    for (var i = -16; i < d.length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      if (i >= 0) d[i] = x >>> 24;
    }
    var gl = kit.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, kit.noise);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 64, 64, 0, gl.RGB, gl.UNSIGNED_BYTE, d);
    kit.seed = seed;
  };

  // l'image, à la taille de la toile et rangée comme le fait object-fit, devient la texture ; faux si l'image
  // ne se lit pas (la texture refuse une image d'une autre origine sans autorisation)
  var upload = function(kit, img, cs, W, H, PW, PH) {
    var bk = kit.bk || (kit.bk = document.createElement('canvas'));
    var g  = typeof bk.getContext === 'function' ? bk.getContext('2d') : null;
    if (!g) return false;
    bk.width  = PW;
    bk.height = PH;
    g.imageSmoothingQuality = 'high';
    var f  = place(cs.objectFit, cs.objectPosition, img.naturalWidth, img.naturalHeight, W, H);
    var kx = PW / W;
    var ky = PH / H;
    var gl = kit.gl;
    try {
      g.drawImage(img, f.x * kx, f.y * ky, f.w * kx, f.h * ky);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, kit.img);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bk);
    }
    catch (e) {
      return false;
    }
    // la copie n'a plus d'emploi
    bk.width  = 1;
    bk.height = 1;
    return true;
  };

  var pixels = function(el, s) {
    var cfg = {
      strength:   num(s.strength, 40),
      rest:       num(s.rest, .12),
      frequency:  num(s.frequency, .015),
      speed:      µ._mjs_fxMs(s.speed, 4000),
      duration:   µ._mjs_fxMs(s.duration, 500),
      animate:    s.animate !== false,
      octaves:    Math.min(5, Math.max(1, Math.round(num(s.octaves, 2)))),
      seed:       Math.round(num(s.seed, 2)),
      cells:      cellsOf(s.cells),
      radius:     radiusOf(s.radius),
      ghost:      colorOf(s.ghost),
      resolution: resolutionOf(s.resolution)
    };
    var on      = s.on || 'hover';
    var calm    = µ._mjs_fxCalm();
    var active  = false;
    var inside  = false;
    var visible = true;
    var ready   = false;
    var refused = false;
    var gone    = false;
    var stale   = false;
    var mounted = null;
    var inner   = null;
    var raf     = 0;
    var last    = 0;
    var ox      = 0;
    var oy      = 0;
    var undo    = [];
    // la force visée, en px : nulle tant que l'état n'est pas actif (rest ne vaut que pour l'effet lisse) ; avec radius, la zone suit la souris, sans lui toute l'image est la zone
    var goal    = function() { return !calm && active && (inside || cfg.radius <= 0) ? cfg.strength : 0; };
    var cur     = goal();
    var canRun  = function() { return !calm && visible && ready && !refused && !(typeof document !== 'undefined' && document.hidden) && typeof requestAnimationFrame === 'function'; };
    var wants   = function() { return canRun() && (Math.abs(cur - goal()) > EPS || (cfg.animate && cur >= EPS)); };
    var stopRaf = function() {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf  = 0;
      last = 0;
    };

    // les uniformes qui ne changent pas à chaque image : repostés à la pose et au changement d'un réglage
    var statics = function(m) {
      var gl = m.kit.gl;
      var u  = m.kit.u;
      var g  = cfg.ghost;
      gl.viewport(0, 0, m.PW, m.PH);
      gl.uniform2f(u.uSize, m.W, m.H);
      gl.uniform1f(u.uCells, cfg.cells);
      gl.uniform1f(u.uRadius, cfg.radius);
      gl.uniform1f(u.uFreq, cfg.frequency);
      gl.uniform1f(u.uOct, cfg.octaves);
      gl.uniform4f(u.uGhost, g ? g[0] : 0, g ? g[1] : 0, g ? g[2] : 0, g ? g[3] : 0);
    };
    // une image : trois uniformes et un seul dessin qui recouvre toute la toile (son tampon n'est pas conservé : hors de la zone, le programme relit l'image)
    var draw = function(now) {
      var m  = mounted;
      var gl = m.kit.gl;
      var u  = m.kit.u;
      if (stale) {
        stale = false;
        statics(m);
      }
      gl.uniform1f(u.uPhase, cfg.animate && !calm && cfg.speed > 0 ? now * 2 * Math.PI / cfg.speed : 0);
      gl.uniform2f(u.uMouse, ox - m.pl, oy - m.pt);
      gl.uniform1f(u.uAmp, cur);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    // la toile se cale sur la boîte de contenu de l'image, là où elle est (au 1/64 de pixel de la mise en page), et se rogne comme
    // l'image par ses ancêtres qui rognent : l'intersection de leurs boîtes de remplissage, avec l'arrondi du plus proche qui en a un
    var fit = function(m) {
      var rect = µ._mjs_dom.getBoundingClientRect(el);
      var at   = µ._mjs_dom.getBoundingClientRect(m.cv);
      var L    = rect.left + m.il * m.sx;
      var T    = rect.top + m.it * m.sy;
      var dx   = (L - at.left) / m.sx;
      var dy   = (T - at.top) / m.sy;
      if (Math.abs(dx) >= .001) {
        m.x = lu(m.x + dx);
        m.cv.style.setProperty('--mjs-fx-liquid-x', m.x + 'px');
      }
      if (Math.abs(dy) >= .001) {
        m.y = lu(m.y + dy);
        m.cv.style.setProperty('--mjs-fx-liquid-y', m.y + 'px');
      }
      if (m.chain.length === 0) return;
      var right  = L + m.W * m.sx;
      var bottom = T + m.H * m.sy;
      var cut    = [-FAR, -FAR, -FAR, -FAR];
      var near   = null;
      var curved = function(c) { return c[0] > 0 || c[1] > 0; };
      for (var i = 0; i < m.chain.length; i++) {
        var a  = m.chain[i];
        var cs = getComputedStyle(a);
        var b  = µ._mjs_dom.getBoundingClientRect(a);
        var bw = [parseFloat(cs.borderTopWidth) || 0, parseFloat(cs.borderRightWidth) || 0, parseFloat(cs.borderBottomWidth) || 0, parseFloat(cs.borderLeftWidth) || 0];
        // la boîte de remplissage, sans les barres de défilement (leur épaisseur : ce que la boîte a de plus que sa partie visible)
        var sw = /^(scroll|auto|overlay)$/.test(cs.overflowY) ? Math.max(0, Math.round(a.offsetWidth - a.clientWidth - bw[1] - bw[3])) : 0;
        var sh = /^(scroll|auto|overlay)$/.test(cs.overflowX) ? Math.max(0, Math.round(a.offsetHeight - a.clientHeight - bw[0] - bw[2])) : 0;
        var e  = [b.top + bw[0] * m.sy, b.right - (bw[1] + sw) * m.sx, b.bottom - (bw[2] + sh) * m.sy, b.left + bw[3] * m.sx];
        var q  = [
          clips(cs.overflowY) ? (e[0] - T) / m.sy : -FAR,
          clips(cs.overflowX) ? (right - e[1]) / m.sx : -FAR,
          clips(cs.overflowY) ? (bottom - e[2]) / m.sy : -FAR,
          clips(cs.overflowX) ? (e[3] - L) / m.sx : -FAR
        ];
        for (var j = 0; j < 4; j++) cut[j] = Math.max(cut[j], q[j]);
        if (near) continue;
        var rad = radii(cs, b.width / m.sx, b.height / m.sy, bw);
        if (rad.some(curved)) near = { q: q, rad: rad };
      }
      // l'arrondi du plus proche ne vaut que dans les coins dont les deux côtés sont ceux de la découpe
      var corner = [[0, 3], [0, 1], [2, 1], [2, 3]];
      var rx     = [];
      var ry     = [];
      for (var k = 0; k < 4; k++) {
        var s0  = corner[k][0];
        var s1  = corner[k][1];
        var hit = near && near.q[s0] > -FAR && near.q[s1] > -FAR && Math.abs(cut[s0] - near.q[s0]) < .5 && Math.abs(cut[s1] - near.q[s1]) < .5;
        rx.push(hit ? r(near.rad[k][0]) : 0);
        ry.push(hit ? r(near.rad[k][1]) : 0);
      }
      var none = cut.every(function(x) { return x <= 0; }) && rx.every(function(x) { return x === 0; }) && ry.every(function(x) { return x === 0; });
      var v    = none ? '' : 'inset(' + cut.map(function(x) { return r(x) + 'px'; }).join(' ') + ' round ' + rx.join('px ') + 'px / ' + ry.join('px ') + 'px)';
      if (m.clip === v) return;
      m.clip = v;
      if (v) m.cv.style.setProperty('--mjs-fx-liquid-clip', v);
      else m.cv.style.removeProperty('--mjs-fx-liquid-clip');
    };
    var follow = function() { if (mounted) fit(mounted); };

    // la toile se pose sur l'image (la boîte est lue ici, une fois) ; son contenu passe sous la toile, pas sa bordure ni son ombre
    var mount = function() {
      var parent = el.parentNode;
      if (!parent || gone) return false;
      var rect = µ._mjs_dom.getBoundingClientRect(el);
      var cs   = getComputedStyle(el);
      var len  = function(v) { return parseFloat(v) || 0; };
      // une échelle posée par un ancêtre (le zoom d'une carte au survol) : la boîte lue à l'écran est plus grande que celle de la mise en page ;
      // la toile a la taille de la mise en page, l'ancêtre la grossit comme l'image (une transformation de l'image elle-même n'est pas lue)
      var own  = cs.transform && cs.transform !== 'none';
      var sx   = !own && el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
      var sy   = !own && el.offsetHeight > 0 ? rect.height / el.offsetHeight : 1;
      if (Math.abs(sx - 1) < .01) sx = 1;
      if (Math.abs(sy - 1) < .01) sy = 1;
      var pl   = len(cs.paddingLeft);
      var pt   = len(cs.paddingTop);
      var il   = len(cs.borderLeftWidth) + pl;
      var it   = len(cs.borderTopWidth) + pt;
      var ir   = len(cs.borderRightWidth) + len(cs.paddingRight);
      var ib   = len(cs.borderBottomWidth) + len(cs.paddingBottom);
      var W    = rect.width / sx - il - ir;
      var H    = rect.height / sy - it - ib;
      if (!(W >= 1 && H >= 1)) return false;
      var kit = take();
      if (!kit) {
        // plus de programme à prêter : l'effet lisse d'avant prend l'image (jamais une image nue), la page en est prévenue une fois
        if (broken) tell('liquidGl');
        else tell('liquidCap');
        swap();
        return false;
      }
      var dpr = µ._mjs_fxLite ? 1 : Math.min(cfg.resolution, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
      var k   = Math.min(1, MAXPX / (Math.max(W * sx, H * sy) * dpr));
      var PW  = Math.max(1, Math.round(W * sx * dpr * k));
      var PH  = Math.max(1, Math.round(H * sy * dpr * k));
      var cv  = kit.cv;
      if (cv.width !== PW) cv.width = PW;
      if (cv.height !== PH) cv.height = PH;
      cv.setAttribute('mjs-fx-layer', 'liquid');
      cv.setAttribute('aria-hidden', 'true');
      cv.style.setProperty('--mjs-fx-liquid-w', lu(W) + 'px');
      cv.style.setProperty('--mjs-fx-liquid-h', lu(H) + 'px');
      cv.style.removeProperty('--mjs-fx-liquid-x');
      cv.style.removeProperty('--mjs-fx-liquid-y');
      cv.style.removeProperty('--mjs-fx-liquid-clip');
      cv.style.setProperty('opacity', cs.opacity);
      // la toile couvre la boîte de contenu : ses arrondis sont ceux de l'image, moins la bordure et la marge intérieure
      var rad = radii(cs, rect.width / sx, rect.height / sy, [it, ir, ib, il]);
      for (var i = 0; i < 4; i++) cv.style.setProperty(CORNERS[i], rad[i][0] === rad[i][1] ? r(rad[i][0]) + 'px' : r(rad[i][0]) + 'px ' + r(rad[i][1]) + 'px');
      µ._mjs_dom.insertBefore(parent, cv, el.nextSibling);
      var m = { kit: kit, cv: cv, W: W, H: H, PW: PW, PH: PH, pl: pl, pt: pt, il: il, it: it, sx: sx, sy: sy, x: 0, y: 0, clip: '', chain: clippers(el), ew: rect.width, eh: rect.height };
      // à gauche 0, en haut 0 : la toile donne l'origine du bloc qui la contient
      fit(m);
      if (kit.seed !== cfg.seed) noiseOf(kit, cfg.seed);
      if (!upload(kit, el, cs, W, H, PW, PH)) {
        cv.remove();
        give(kit);
        tell('liquidCors');
        swap();
        return false;
      }
      kit.lost = function() {
        if (mounted !== m) return;
        unmount();
        refused = true;
      };
      statics(m);
      mounted = m;
      µ._mjs_dom.setAttribute(el, 'mjs-fx-liquid-view', '');
      if (ro) ro.observe(el);
      // un ancêtre qui rogne défile ou change de taille : la toile se recale et se redécoupe
      for (var c = 0; c < m.chain.length; c++) {
        µ._mjs_dom.addEventListener(m.chain[c], 'scroll', follow, { passive: true });
        if (ro) ro.observe(m.chain[c]);
      }
      return true;
    };
    // l'image reprend sa place, la toile part
    var unmount = function() {
      var m = mounted;
      if (!m) return;
      mounted = null;
      if (ro) ro.unobserve(el);
      for (var c = 0; c < m.chain.length; c++) {
        µ._mjs_dom.removeEventListener(m.chain[c], 'scroll', follow);
        if (ro) ro.unobserve(m.chain[c]);
      }
      m.kit.lost = null;
      // sans fondu : les transitions de l'auteur sont suspendues le temps de la remise
      µ._mjs_dom.setAttribute(el, 'mjs-fx-liquid-back', '');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-liquid-view');
      if (typeof getComputedStyle === 'function') void getComputedStyle(el).opacity;
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-liquid-back');
      m.cv.remove();
      give(m.kit);
    };
    var again = function() {
      unmount();
      if (mount()) draw(performance.now());
    };
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(function() {
      if (!mounted) return;
      var b = µ._mjs_dom.getBoundingClientRect(el);
      if (Math.abs(b.width - mounted.ew) < .5 && Math.abs(b.height - mounted.eh) < .5) fit(mounted);
      else again();
    }) : null;

    // une image : la toile se pose si la force est là, se retire quand elle est revenue à zéro
    var show = function(now) {
      if (cur >= EPS) {
        if (!mounted && !mount()) {
          refused = true;
          return;
        }
        if (mounted) draw(now);
      }
      else if (mounted) unmount();
    };
    var tick = function(now) {
      raf = 0;
      var dt = last ? Math.min(100, now - last) : 16;
      last = now;
      var g = goal();
      if (cfg.duration <= 0) cur = g;
      else cur += (g - cur) * (1 - Math.exp(-dt * 3 / cfg.duration));
      if (Math.abs(cur - g) < EPS) cur = g;
      show(now);
      if (wants()) raf = requestAnimationFrame(tick);
      else last = 0;
    };
    var wake = function(force) {
      if (raf || !canRun()) return;
      if (force === true || wants()) raf = requestAnimationFrame(tick);
    };
    // « réduire les animations » : pas de boucle, rien à montrer (la force est nulle) ; sinon une image au moins si la toile a quelque chose à montrer ou à retirer
    var kick = function() {
      if (calm) {
        if (ready && visible && !refused && !gone) show(0);
      }
      else wake(cur >= EPS || !!mounted);
    };

    // l'effet lisse d'avant prend la place (image illisible, pas de WebGL) ; l'état actif est gardé
    var swap = function() {
      if (inner || gone) return;
      var was = active;
      teardown();
      inner = smooth(el, { strength: cfg.strength, rest: cfg.rest, frequency: cfg.frequency, speed: cfg.speed, duration: cfg.duration, animate: cfg.animate, octaves: cfg.octaves, seed: cfg.seed, on: on });
      if (!was) return;
      var list = (µ._mjs_dom.getAttribute(el, 'mjs-fx-on') || '').split(' ').filter(function(x) { return x !== ''; });
      if (list.indexOf('liquid') < 0) {
        list.push('liquid');
        µ._mjs_dom.setAttribute(el, 'mjs-fx-on', list.join(' '));
      }
    };
    var teardown = function() {
      if (gone) return;
      gone = true;
      stopRaf();
      gate();
      if (mo) mo.disconnect();
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      for (var i = 0; i < undo.length; i++) undo[i]();
      unmount();
      if (ro) ro.disconnect();
    };

    // l'image est-elle prête, et lisible ? (une nouvelle image est reposée sur la toile)
    var check = function() {
      if (gone) return;
      ready = el.complete === true && el.naturalWidth > 0;
      if (ready && !clean(el)) {
        tell('liquidCors');
        swap();
        return;
      }
      refused = false;
      if (mounted) again();
      kick();
    };
    var track = function(e) {
      if (typeof e.offsetX === 'number' && typeof e.offsetY === 'number') {
        ox = e.offsetX;
        oy = e.offsetY;
      }
    };
    var enter = function(e) {
      inside  = true;
      refused = false;
      track(e);
      if (mounted) again();
      kick();
    };
    var move = function(e) {
      inside = true;
      track(e);
      wake(true);
    };
    var leave = function() {
      inside = false;
      kick();
    };
    var listen = function(ev, f, opts) {
      µ._mjs_dom.addEventListener(el, ev, f, opts);
      undo.push(function() { µ._mjs_dom.removeEventListener(el, ev, f); });
    };
    listen('pointerenter', enter, { passive: true });
    listen('pointermove', move, { passive: true });
    listen('pointerleave', leave, { passive: true });
    listen('load', check);

    // l'état actif : posé par le cœur (jeton `liquid` dans `mjs-fx-on`), relu à chaque changement
    var gate  = µ._mjs_fxState(el, 'liquid', on);
    var read  = function() { active = (µ._mjs_dom.getAttribute(el, 'mjs-fx-on') || '').split(' ').indexOf('liquid') >= 0; kick(); };
    var mo    = typeof MutationObserver === 'function' ? new MutationObserver(read) : null;
    if (mo) mo.observe(el, { attributes: true, attributeFilter: ['mjs-fx-on'] });
    else active = true;
    read();
    var io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function(entries) {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) kick();
      else stopRaf();
    }) : null;
    if (io) io.observe(el);
    var onVisible = function() { if (document.hidden) stopRaf(); else kick(); };
    document.addEventListener('visibilitychange', onVisible);
    check();

    var off = function() {
      teardown();
      if (inner) inner();
    };
    // un réglage tenu par une variable change sur place (octaves, graine et déclencheur reposent l'effet)
    off.set = function(k, v) {
      if (inner) return inner.set ? inner.set(k, v) : false;
      if (k === 'strength') cfg.strength = num(v, 40);
      else if (k === 'rest') cfg.rest = num(v, .12);
      else if (k === 'frequency') cfg.frequency = num(v, .015);
      else if (k === 'speed') cfg.speed = µ._mjs_fxMs(v, 4000);
      else if (k === 'duration') cfg.duration = µ._mjs_fxMs(v, 500);
      else if (k === 'animate') cfg.animate = v !== false;
      else if (k === 'cells') cfg.cells = cellsOf(v);
      else if (k === 'radius') cfg.radius = radiusOf(v);
      else if (k === 'ghost') cfg.ghost = colorOf(v);
      else if (k === 'resolution') {
        cfg.resolution = resolutionOf(v);
        if (mounted) again();
      }
      else return false;
      // plus rien de la déformation par carreaux : l'effet lisse repose
      if (cfg.cells <= 0 && cfg.radius <= 0 && !cfg.ghost) return false;
      stale = true;
      if (calm) cur = goal();
      kick();
      if (!calm) wake(true);
    };
    return off;
  };
  // @@

  µ._mjs_fxDefs.liquid = {
    css: '[mjs-fx~="liquid"][mjs-fx-liquid-on]{filter:var(--mjs-fx-liquid-filter,none)}',
    setup: function(el, s) {
      // la déformation par carreaux : sur une image, quand l'un de ses réglages est écrit, tant que WebGL répond
      // @@ cells radius ghost
      var tiles = !broken && el.localName === 'img' && (cellsOf(s.cells) > 0 || radiusOf(s.radius) > 0 || colorOf(s.ghost) !== null);
      // une image déjà chargée et illisible : l'effet lisse d'emblée
      if (tiles && el.complete === true && el.naturalWidth > 0 && !clean(el)) tiles = false;
      if (tiles) return pixels(el, s);
      // @@
      return smooth(el, s);
    }
  };

  // les règles de la toile de la déformation par carreaux
  // @@ cells radius ghost
  µ._mjs_fxDefs.liquid.css += '[mjs-fx~="liquid"][mjs-fx-liquid-view]{object-fit:none!important;object-position:100000px 0!important;transition-property:none!important}'
    + '[mjs-fx~="liquid"][mjs-fx-liquid-back]{transition-property:none!important}'
    + '[mjs-fx-layer="liquid"]{position:absolute;left:var(--mjs-fx-liquid-x,0);top:var(--mjs-fx-liquid-y,0);width:var(--mjs-fx-liquid-w,0);height:var(--mjs-fx-liquid-h,0);display:block;box-sizing:border-box;margin:0;padding:0;border:0;max-width:none;max-height:none;pointer-events:none;clip-path:var(--mjs-fx-liquid-clip,none)}';
  // @@
})();
