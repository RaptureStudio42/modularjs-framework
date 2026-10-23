// mjs_fx_behind — `*behind` : le texte passe derrière le sujet d'une photo. La balise a un fond (la photo) et du
// contenu (un titre géant) ; `image` est le sujet de cette photo, détouré — un PNG transparent de mêmes dimensions —
// et l'effet le pose par-dessus le contenu, juste au-dessus du fond : les lettres semblent passer derrière le sujet.
// Un calque (`[mjs-fx-layer="behind"]`) dernier enfant de la balise, dans le composant si la balise en est un : il
// ne capte pas les clics, n'est pas lu par les lecteurs d'écran (`aria-hidden`), passe devant le texte de la balise et
// ses enfants positionnés sans z-index (le titre : le cas de l'effet) parce qu'il est le dernier enfant positionné, à
// `z-index: auto`. La balise n'est pas un contexte d'empilement (sauf avec `depth`) : un enfant à z-index positif
// (menu, bouton) reste devant le sujet, et un menu qui déborde de la balise n'est pas enfermé sous la suite de la
// page. Il est calé sur le fond de la balise : sans réglage, il en prend la taille et la place par héritage CSS (le
// fond change, le sujet suit, même pendant une transition) ; un fond à plusieurs images (un dégradé sur la photo)
// donne à la photo, et à elle seule, sa taille et sa place, et il en suit l'origine (`background-origin`), le rognage
// (`background-clip`) et, tant que `size` et `position` ne sont pas écrits, la répétition (`background-repeat`) : le
// calque prend le `padding` de la balise pour que sa boîte de contenu soit la sienne. Une balise sans fond en `url(…)` :
// le sujet est cadré `cover`, au centre, posé une fois.
// Réglages : image (principal : le sujet détouré, une adresse, `µasset`, `µimage`), size (cover, contain, auto : la
// taille du sujet ; non écrit, celle du fond de la balise), position (la place du sujet, un mot ou `x% y%` ; non
// écrit, celle du fond de la balise), depth (le relief, en px ; 0 : immobile — la souris décale le sujet dans un
// sens et le fond de la balise dans l'autre, de ce nombre de px au bord de la balise), edge (avec `depth` seulement :
// ce que montre le bord que le relief découvre — `zoom` (le défaut), `blur`, ou une couleur que le navigateur reconnaît : `edge: black`, `edge: '#101014'`, `edge: rgb(10 10 20)` ; autre chose (une faute de frappe) donne le zoom et un avertissement dans la console).
// Le relief : deux variables (`--mjs-fx-behind-x`, `--mjs-fx-behind-y`, de -1 à 1) écrites sur les calques à la
// souris, un calque de plus (la copie du fond, qui déborde de `depth` px et que la balise rogne : `overflow:
// clip` tant que le relief est actif). Le fond de cette copie se place sur la boîte de la balise, pas sur la sienne
// (un `padding` de `depth` px et `background-origin: content-box`) : même taille, même place que le fond de la
// balise, au repos comme avec `depth: 0` ; seule la souris le décale. Le débord peint les `depth` px que le mouvement
// peut découvrir : un fond en tuiles (une taille en px, répété) y continue son motif sans coupure ; un fond en `cover` n'y est pas répété
// (la copie a `background-repeat: no-repeat` pour cette couche, relu à la pose, quand `size` ou le fond de la balise changent) : la bande
// découverte ne montre jamais la tuile voisine (le bord opposé de la photo), elle montre ce que `edge` demande.
// Le bord (`edge`) : `zoom` (le défaut) agrandit le fond ET le sujet ensemble, autour du centre de la balise, du strict nécessaire pour que le
// décalage le plus fort ne sorte jamais de l'image — 1 + 2 × depth / le petit côté de la balise, écrit dans `--mjs-fx-behind-zoom` sur les deux
// calques (+9,8 % pour 960 × 285 et depth: 14, +4,7 % pour 1200 × 600), relu quand la balise change de taille ou que `depth` change, jamais par image ;
// au repos le fond et le sujet restent calés l'un sur l'autre, seul le cadrage est un peu plus serré. `blur` pose sous la copie un calque
// (`[mjs-fx-layer="behind-edge"]`) : la même photo, agrandie (en cover sur une boîte qui déborde de trois fois le flou) et floue (au moins 24 px, ou
// depth) ; une couleur pose le même calque en couleur unie. Un texte que le navigateur ne reconnaît pas comme couleur (`zooom`, `blakc`) donne le zoom et un seul avertissement, tant que ce même texte reste écrit. Ce calque est invisible tant que la copie n'a pas glissé (son opacité suit le décalage :
// nulle au repos, entière dès un huitième de la course) : au repos rien ne change, quel que soit le fond.
// Une seule boucle, qui rejoint la souris en douceur et s'arrête d'elle-même quand tout est posé ; la boîte de la
// balise est lue une fois par survol (et après un défilement) ; `will-change` n'est posé que pendant le mouvement (`transform` sur le sujet et la copie du fond,
// `opacity` sur le calque du bord) ; les doigts sont ignorés. « Réduire les animations » : pas de relief.
// Rien n'est repeint pendant le relief : l'image du sujet est écrite EN LITTÉRAL sur son calque (style en ligne, une fois à la pose et quand elle change), jamais derrière une
// `var()` — avec les deux variables du relief réécrites à chaque image, le navigateur redonnerait une image neuve à chaque recalcul de style (décodage et re-trame du calque à chaque
// image) ; le mouvement ne passe que par `transform` et `opacity`, sur des calques composés (le calque du bord aussi, tant que le relief bouge : son opacité suit le décalage).
// Limites : la copie du fond montre aussi le sujet (la photo entière) : plus `depth` est grand, plus le sujet du fond
// et son détourage s'écartent (un fond sans le sujet fait un relief net) ; un enfant à z-index positif passe devant le
// sujet (le moyen de garder un menu ou un bouton devant lui), et un enfant positionné sans z-index ajouté APRÈS la pose
// aussi (le sujet n'est plus le dernier de l'arbre) ; avec `depth`, la balise devient un contexte d'empilement (la
// copie du fond passe sous le contenu et au-dessus de son propre fond) et rogne ce qui déborde : un menu qui déborde y
// est coupé ; le fond d'une balise en `background-attachment: fixed` n'est pas suivi ; un `padding` en pourcentage
// se calcule sur la largeur de la balise et non plus sur celle de son parent (visible avec `background-origin` ou
// `background-clip` en `content-box`) ; la bordure de la balise n'est pas couverte, et un `background-origin: border-box`
// avec une bordure décale le cadrage de son épaisseur ; `background-clip: text` ne laisse pas de sujet ; la copie du fond
// du relief se cale sur la boîte de remplissage de la balise (le `padding` compris) : un `background-origin: content-box`
// ou `border-box` n'est pas suivi, ni le rognage du fond ; le zoom est calculé sur le petit côté de la balise : il suppose une photo qui la couvre (cover) et agrandit donc
// un peu plus que le strict nécessaire quand la photo déborde déjà de la balise sur ce côté ; un fond qui ne couvre pas (contain, un motif)
// n'est pas agrandi plus loin ; avec `blur` ou une couleur, le bord se voit aussi là où la photo n'arrive pas (la marge d'un contain) dès
// que la copie a glissé, et le sujet découvre `depth` px de fond au bord du cadre (le zoom l'évite) ; la photo en place sous la bande, que
// montrait la première version, n'existe plus ; un fond dont la taille change par une
// règle `:hover` ou un ancêtre n'est pas relu (la copie garde la répétition calculée avant) ; une couche de taille `auto` (un dégradé
// par-dessus la photo) garde sa répétition.

(function() {
  var P = '[mjs-fx-layer="behind"]';
  var Q = '[mjs-fx-layer="behind-bg"]';
  var R = '[mjs-fx-layer="behind-edge"]';
  var X = 'var(--mjs-fx-behind-x,0) * var(--mjs-behind-depth,0px)';
  var Y = 'var(--mjs-fx-behind-y,0) * var(--mjs-behind-depth,0px)';
  // le zoom commun du sujet et de la copie du fond (1 tant que rien n'est écrit), appliqué avant le décalage
  var Z = ' scale(var(--mjs-fx-behind-zoom,1))';
  // le flou du bord : 24 px au moins, ou depth
  var B = 'max(24px,var(--mjs-behind-depth,0px))';
  // l'opacité du calque du bord : nulle au repos, entière dès que le décalage dépasse un huitième
  var O = 'clamp(0,calc(max(var(--mjs-fx-behind-x,0),var(--mjs-fx-behind-y,0),var(--mjs-fx-behind-x,0) * -1,var(--mjs-fx-behind-y,0) * -1) * 8),1)';
  // la liste d'un réglage CSS à plusieurs fonds : coupée aux virgules du premier niveau (hors parenthèses et guillemets :
  // `linear-gradient(rgba(0, 0, 0, .5), rgba(0, 0, 0, .5)), url(…)` fait deux fonds)
  var split = function(v) {
    var str = String(v || '');
    var out = [];
    var at  = 0;
    var lvl = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charAt(i);
      if (c === '"' || c === '\'') {
        for (i++; i < str.length && str.charAt(i) !== c; i++) if (str.charAt(i) === '\\') i++;
      }
      else if (c === '(') lvl++;
      else if (c === ')') lvl--;
      else if (c === ',' && lvl === 0) {
        out.push(str.slice(at, i).trim());
        at = i + 1;
      }
    }
    out.push(str.slice(at).trim());
    return out;
  };

  // ce que `edge` demande : 'zoom' (le défaut), 'blur' (ces deux mots sans compter les espaces autour ni la casse), ou une couleur que le navigateur reconnaît (un nom, #hex, rgb()…) ;
  // autre chose (une faute de frappe) rend null
  var kind = function(v) {
    var c = v === void 0 || v === null ? '' : String(v).trim();
    var w = c.toLowerCase();
    if (c === '' || w === 'zoom') return 'zoom';
    if (w === 'blur') return 'blur';
    return typeof CSS === 'object' && CSS !== null && typeof CSS.supports === 'function' && !CSS.supports('color', c) ? null : c;
  };

  µ._mjs_fxDefs.behind = {
    // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
    decor: true,
    // l'image du sujet n'est appelée qu'à l'approche de la balise (cf. mjs_fx.ts)
    image: true,
    css: '[mjs-fx~="behind"][mjs-fx-behind-relief]{overflow:clip;isolation:isolate}'
      + P + ',' + Q + '{position:absolute;pointer-events:none}'
      + P + '{inset:0;border-radius:inherit;padding:inherit;background-repeat:no-repeat;background-size:inherit;background-position:inherit;background-origin:inherit;background-clip:inherit}'
      + P + ':not([mjs-fx-behind-size]):not([mjs-fx-behind-pos]){background-repeat:inherit}'
      + P + '[mjs-fx-behind-size]{background-size:var(--mjs-fx-behind-size)}'
      + P + '[mjs-fx-behind-pos]{background-position:var(--mjs-fx-behind-pos)}'
      + Q + '{inset:calc(var(--mjs-behind-depth,0px) * -1);z-index:-1;padding:var(--mjs-behind-depth,0px);background-origin:content-box;background-image:inherit;background-size:inherit;background-position:inherit;background-repeat:inherit}'
      + Q + '[mjs-fx-behind-repeat]{background-repeat:var(--mjs-fx-behind-repeat)}'
      + R + '{position:absolute;pointer-events:none;z-index:-2;inset:0;opacity:' + O + '}'
      + R + '[mjs-fx-behind-edge="blur"]{inset:calc(' + B + ' * -3);background-image:inherit;background-size:cover;background-position:inherit;background-repeat:no-repeat;filter:blur(' + B + ')}'
      + R + '[mjs-fx-behind-edge="color"]{background-color:var(--mjs-fx-behind-edge)}'
      + P + '[mjs-fx-relief]{transform:translate3d(calc(' + X + '),calc(' + Y + '),0)' + Z + '}'
      + Q + '[mjs-fx-relief]{transform:translate3d(calc(' + X + ' * -1),calc(' + Y + ' * -1),0)' + Z + '}'
      + P + '[mjs-fx-moving],' + Q + '[mjs-fx-moving]{will-change:transform}'
      + R + '[mjs-fx-moving]{will-change:opacity}'
      + '@media (prefers-reduced-motion:reduce){' + P + '[mjs-fx-relief],' + Q + '[mjs-fx-relief]{transform:none;will-change:auto}' + R + '[mjs-fx-moving]{will-change:auto}}',
    vars: { depth: 'px' },
    setup: function(el, s) {
      var host    = µ._mjs_fxInner(el) || el;
      if (host !== el) µ._mjs_fxAdopt(host, 'behind');
      var restore = µ._mjs_fxRelative(el);
      var cur     = { image: s.image, size: s.size, position: s.position, depth: s.depth };
      var cut     = document.createElement('span');
      cut.setAttribute('mjs-fx-layer', 'behind');
      cut.setAttribute('aria-hidden', 'true');
      var found = false;
      var url   = '';
      var probe = null;

      // le sujet prend, dans la liste des fonds de la balise, la place de la photo (le premier fond en `url(…)`) :
      // son `background-size` et sa `background-position` héritées sont alors ceux de la photo
      var shape = function() {
        var cs   = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
        var list = split(cs ? cs.backgroundImage : '');
        var n    = -1;
        for (var i = 0; i < list.length && n < 0; i++) if (/^url\(/.test(list[i])) n = i;
        found = n >= 0;
        return new Array(Math.max(n, 0) + 1).join('none,');
      };
      var mark = function(name, v) {
        if (v) {
          cut.style.setProperty('--mjs-fx-behind-' + name, v);
          cut.setAttribute('mjs-fx-behind-' + name, '');
        }
        else {
          cut.style.removeProperty('--mjs-fx-behind-' + name);
          cut.removeAttribute('mjs-fx-behind-' + name);
        }
      };
      // la taille et la place écrites l'emportent ; sinon l'héritage, ou `cover` au centre sans fond en url(…)
      var place = function() {
        var p = cur.position === void 0 ? null : µ._mjs_fxPoint(cur.position) || { x: 0.5, y: 0.5 };
        mark('size', cur.size || (found ? '' : 'cover'));
        mark('pos', p ? Math.round(p.x * 1000) / 10 + '% ' + Math.round(p.y * 1000) / 10 + '%' : found ? '' : '50% 50%');
      };
      var pose = function() {
        cut.style.backgroundImage = url ? shape() + 'url("' + url.replace(/["\\\n]/g, '\\$&') + '")' : 'none';
        place();
      };
      var seek = function() {
        if (probe) {
          probe.onerror = null;
          probe = null;
        }
        url = µ._mjs_fxImage(cur.image, el);
        pose();
        if (url !== '' && typeof Image === 'function') {
          var u = url;
          probe = new Image();
          probe.onerror = function() { µ.warn(µ._mjs_msg('behindImage', { url: u }, '*behind : l\'image {url} est introuvable — le sujet détouré n\'apparaît pas')); };
          probe.src = url;
        }
      };
      seek();
      µ._mjs_dom.appendChild(host, cut);
      // le fond de la balise change (classe, style) : la place de la photo dans sa liste est relue
      // la classe ou un réglage de fond écrit en ligne ont changé : sans cela (une autre animation qui écrit le style de la balise
      // à chaque image), le style n'est pas relu
      var key = function() {
        var st = el.style;
        return (µ._mjs_dom.getAttribute(el, 'class') || '') + '|' + st.background + '|' + st.backgroundImage + '|' + st.backgroundSize + '|' + st.backgroundPosition + '|' + st.backgroundRepeat;
      };
      var sig = key();
      var mo = typeof MutationObserver === 'function' ? new MutationObserver(function() {
        var k = key();
        if (k === sig) return;
        sig = k;
        if (url !== '') pose();
        tile();
      }) : null;
      if (mo) mo.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });

      // LE RELIEF — la souris cible (nx, ny), de -1 à 1 depuis le centre de la balise ; (cx, cy) la rejoint en douceur
      var bg   = null;
      var edge = null;
      var seen = null;
      var live = false;
      var near = false;
      var box  = null;
      var raf  = 0;
      var last = 0;
      var nx   = 0;
      var ny   = 0;
      var cx   = 0;
      var cy   = 0;
      var layers = function() { return bg ? [cut, bg] : [cut]; };
      var moving = function(yes) {
        var l = edge ? layers().concat(edge) : layers();
        for (var i = 0; i < l.length; i++) {
          if (yes) l[i].setAttribute('mjs-fx-moving', '');
          else l[i].removeAttribute('mjs-fx-moving');
        }
      };
      var draw = function() {
        var a = String(Math.round(cx * 1000) / 1000);
        var b = String(Math.round(cy * 1000) / 1000);
        var l = layers();
        for (var i = 0; i < l.length; i++) {
          l[i].style.setProperty('--mjs-fx-behind-x', a);
          l[i].style.setProperty('--mjs-fx-behind-y', b);
        }
        // le calque du bord les lit pour son opacité
        if (edge) {
          edge.style.setProperty('--mjs-fx-behind-x', a);
          edge.style.setProperty('--mjs-fx-behind-y', b);
        }
      };
      var frame = function(t) {
        var k = 1 - Math.exp(-(last ? Math.min(t - last, 64) : 16) / 90);
        last = t;
        cx  += (nx - cx) * k;
        cy  += (ny - cy) * k;
        var end = Math.abs(nx - cx) < 0.002 && Math.abs(ny - cy) < 0.002;
        if (end) {
          cx = nx;
          cy = ny;
        }
        draw();
        if (!end) raf = requestAnimationFrame(frame);
        else {
          raf  = 0;
          last = 0;
          moving(false);
        }
      };
      var go = function() {
        if (raf) return;
        moving(true);
        raf = requestAnimationFrame(frame);
      };
      // la boîte est lue une fois par survol ; un défilement la périme
      var stale = function() { box = null; };
      var unwatch = function() {
        if (!near) return;
        near = false;
        window.removeEventListener('scroll', stale, { capture: true });
      };
      var aim = function(e) {
        if (e.pointerType === 'touch') return;
        if (!box) box = µ._mjs_dom.getBoundingClientRect(el);
        if (!(box.width > 0) || !(box.height > 0)) return;
        if (!near) {
          near = true;
          window.addEventListener('scroll', stale, { passive: true, capture: true });
        }
        nx = Math.max(-1, Math.min(1, (e.clientX - box.left) / box.width * 2 - 1));
        ny = Math.max(-1, Math.min(1, (e.clientY - box.top) / box.height * 2 - 1));
        go();
      };
      var rest = function() {
        box = null;
        nx  = 0;
        ny  = 0;
        unwatch();
        go();
      };
      // LA RÉPÉTITION DE LA COPIE — un fond en `cover` ne se répète pas dans la copie : la bande que le relief découvre au bord montre alors le fond de la balise, resté
      // en place (la même photo), et non la tuile voisine (le bord opposé de la photo) ; toute autre taille (un motif en tuiles) garde la répétition de la balise, le motif
      // continue sans coupure. Couche par couche : la taille calculée du fond de la balise, et `size: cover` écrit sur l'effet pour la couche de la photo (la première en
      // `url(…)`). Lue à la pose du relief, quand `size` ou le fond de la balise (classe, style en ligne) changent, jamais par image
      var tile = function() {
        if (!bg) return;
        var cs    = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
        var imgs  = split(cs ? cs.backgroundImage : '');
        var sizes = split(cs ? cs.backgroundSize : '');
        var reps  = split(cs ? cs.backgroundRepeat : '');
        var n     = 0;
        var cover = false;
        var list  = [];
        for (var i = imgs.length - 1; i >= 0; i--) if (/^url\(/.test(imgs[i])) n = i;
        for (i = 0; i < imgs.length; i++) {
          var c = sizes[i % sizes.length] === 'cover' || (i === n && cur.size === 'cover');
          cover = cover || c;
          list.push(c ? 'no-repeat' : reps[i % reps.length] || 'repeat');
        }
        if (cover) {
          bg.style.setProperty('--mjs-fx-behind-repeat', list.join(', '));
          bg.setAttribute('mjs-fx-behind-repeat', '');
        }
        else {
          bg.style.removeProperty('--mjs-fx-behind-repeat');
          bg.removeAttribute('mjs-fx-behind-repeat');
        }
      };
      // un texte que le navigateur ne reconnaît pas (zooom, blakc) donne le zoom, et un seul avertissement dans la console tant que ce même texte reste écrit
      var bad  = '';
      var pick = function(v) {
        var k = kind(v);
        if (k !== null) {
          bad = '';
          return k;
        }
        var txt = String(v).trim();
        if (txt !== bad) µ.warn(µ._mjs_msg('behindEdge', { edge: txt }, '*behind : edge = {edge} n\'est ni zoom, ni blur, ni une couleur que votre navigateur connaît — le zoom est pris. Vérifiez comment vous l\'avez écrit.'));
        bad = txt;
        return 'zoom';
      };
      // LE BORD — `zoom` : le fond et le sujet, agrandis ensemble autour du centre de la balise, couvrent encore la balise quand le relief les décale de `depth` px (chacun dans son sens) :
      // 1 + 2 × depth / le petit côté de la balise, écrit sur les deux calques. Relu quand la balise change de taille ou que `depth` change, jamais par image
      var how = pick(s.edge);
      var fit = function() {
        if (!bg) return;
        var w = el.clientWidth;
        var h = el.clientHeight;
        var k = how === 'zoom' && cur.depth > 0 && w > 0 && h > 0 ? String(Math.round((1 + 2 * cur.depth / Math.min(w, h)) * 10000) / 10000) : '';
        var l = layers();
        for (var i = 0; i < l.length; i++) {
          if (k) l[i].style.setProperty('--mjs-fx-behind-zoom', k);
          else l[i].style.removeProperty('--mjs-fx-behind-zoom');
        }
      };
      // la taille de la balise n'est observée que pour le zoom ; sans ResizeObserver : lue à la pose et à chaque redimensionnement de la fenêtre. Rend vrai quand la lecture est déjà faite
      // (ou va l'être : l'observateur lit à son arrivée), pour ne pas forcer la mise en page à la pose
      var measure = function(on) {
        if (on === (seen !== null)) return false;
        if (!on) {
          if (seen.disconnect) seen.disconnect();
          else window.removeEventListener('resize', seen);
          seen = null;
          return false;
        }
        if (typeof ResizeObserver === 'function') {
          seen = new ResizeObserver(fit);
          seen.observe(el);
        }
        else {
          seen = fit;
          window.addEventListener('resize', fit);
          fit();
        }
        return true;
      };
      // `blur` et une couleur : un calque sous la copie du fond, qui ne se voit que là où elle a glissé ; `zoom` : pas de calque, le zoom
      var look = function() {
        if (!bg) return;
        if (how === 'zoom') {
          if (edge) edge.remove();
          edge = null;
        }
        else {
          if (!edge) {
            edge = document.createElement('span');
            edge.setAttribute('mjs-fx-layer', 'behind-edge');
            edge.setAttribute('aria-hidden', 'true');
            µ._mjs_dom.insertBefore(host, edge, bg.nextSibling);
          }
          edge.setAttribute('mjs-fx-behind-edge', how === 'blur' ? 'blur' : 'color');
          if (how === 'blur') edge.style.removeProperty('--mjs-fx-behind-edge');
          else edge.style.setProperty('--mjs-fx-behind-edge', how);
          draw();
        }
        if (!measure(how === 'zoom')) fit();
      };
      var arm = function(on) {
        if (on === live) return;
        live = on;
        if (on) {
          bg = document.createElement('span');
          bg.setAttribute('mjs-fx-layer', 'behind-bg');
          bg.setAttribute('aria-hidden', 'true');
          bg.setAttribute('mjs-fx-relief', '');
          cut.setAttribute('mjs-fx-relief', '');
          µ._mjs_dom.insertBefore(host, bg, host.firstChild);
          µ._mjs_dom.setAttribute(el, 'mjs-fx-behind-relief', '');
          tile();
          look();
          µ._mjs_dom.addEventListener(el, 'pointermove', aim, { passive: true });
          µ._mjs_dom.addEventListener(el, 'pointerleave', rest);
          return;
        }
        µ._mjs_dom.removeEventListener(el, 'pointermove', aim);
        µ._mjs_dom.removeEventListener(el, 'pointerleave', rest);
        unwatch();
        if (raf) cancelAnimationFrame(raf);
        raf  = 0;
        last = 0;
        box  = null;
        nx   = ny = cx = cy = 0;
        moving(false);
        cut.removeAttribute('mjs-fx-relief');
        cut.style.removeProperty('--mjs-fx-behind-x');
        cut.style.removeProperty('--mjs-fx-behind-y');
        cut.style.removeProperty('--mjs-fx-behind-zoom');
        measure(false);
        if (edge) edge.remove();
        edge = null;
        if (bg) bg.remove();
        bg = null;
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-behind-relief');
      };
      var want = function(v) { return typeof v === 'number' && v > 0 && !µ._mjs_fxCalm(); };
      arm(want(s.depth));

      var off = function() {
        arm(false);
        if (mo) mo.disconnect();
        if (probe) {
          probe.onerror = null;
          probe = null;
        }
        cut.remove();
        restore();
      };
      // le relief s'allume et s'éteint sur place (sa variable CSS suit d'elle-même) ; le sujet, sa taille et sa place
      // aussi ; les autres réglages relancent l'effet
      off.set = function(k, v) {
        if (k === 'depth') {
          var was = live;
          cur.depth = v;
          arm(want(v));
          if (was && live) look();
        }
        else if (k === 'edge') {
          how = pick(v);
          look();
        }
        else if (k === 'image' || k === 'size' || k === 'position') {
          if (v === void 0) delete cur[k];
          else cur[k] = v;
          if (k === 'image') seek();
          else place();
          if (k === 'size') tile();
        }
        else return false;
      };
      return off;
    }
  };
})();
