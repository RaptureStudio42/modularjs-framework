// animations/crossfade.ts — deux balises qui se répondent : celle qui part d'une liste (@out) et celle qui arrive dans une autre (@in),
// de même clé, ne sont qu'un seul objet qui voyage d'une place à l'autre ; µ.anim.crossfade('todos', { duration: 600 }) enregistre
//   µ.anim.todosSend      à poser sur @out
//   µ.anim.todosReceive   à poser sur @in
//   <label @in.todosReceive={key: item.id} @out.todosSend={key: item.id}>…</label>
// l'objet voyage par un déplacement et une échelle (sa boîte de départ sur la boîte d'arrivée), son opacité en fondu ; l'entrée suit la courbe,
// la sortie son contraire (1 - courbe, pas la courbe à l'envers dans le temps) : à chaque image les deux sont au même endroit et leurs
// opacités font 1, un seul objet se voit. Sans partenaire, rien ne voyage : `fallback(node, params, isIntro)` rend alors { css(t, u), duration,
// delay, easing } si l'on veut une transition ordinaire, ou rien
// réglages : duration (√distance × 30 ms, ou une fonction de la distance), delay (0), easing (cubicOut), fallback ; les paramètres écrits sur @in
// ou @out gagnent sur ceux de crossfade()
(function(name, defaults = {}) {
  var sent     = new Map();
  var received = new Map();
  // une méthode de la balise prise au prototype (µ._mjs_dom, du moteur des effets) : un composant qui écrit `@getAttribute` ou
  // `@getBoundingClientRect` masque celle de sa balise ; une animation chargée sans le moteur prend celle de la balise
  var dom = function(n, name, a) {
    return µ._mjs_dom ? µ._mjs_dom[name](n, a) : n[name](a);
  };
  // l'animation finie ou annulée libère son maintien (fill), qui figerait les styles et accumulerait des objets Animation
  var free = function(anim) {
    try { anim.cancel(); } catch {}
  };
  // les 61 images d'un trajet : image(p) rend celle de l'avancée p (de 0 à 1)
  var sample = function(image) {
    var frames = [];
    var i;
    for (i = 0; i <= 60; i++) frames.push(Object.assign(image(i / 60), { offset: i / 60 }));
    return frames;
  };
  // de la balise `from` à la place de `node`
  var travel = function(from, node, params, isIntro) {
    var delay    = params.delay ?? defaults.delay ?? 0;
    var duration = params.duration ?? defaults.duration ?? function(d) { return Math.sqrt(d) * 30; };
    var easing   = µ.easing.resolve(params.easing ?? defaults.easing ?? µ.easing.cubicOut);
    var a        = dom(from, 'getBoundingClientRect');
    var b        = dom(node, 'getBoundingClientRect');
    // la boîte de la partenaire est celle qu'a relevée la première à passer : un vol de durée nulle fait sortir sa balise du DOM avant que l'autre ne passe
    var peer     = node._mjs_xfPeer;
    if (peer) a = peer;
    else from._mjs_xfPeer = b;
    node._mjs_xfPeer = null;
    var dx       = a.left - b.left;
    var dy       = a.top - b.top;
    var dw       = a.width / Math.max(b.width, 1);
    var dh       = a.height / Math.max(b.height, 1);
    var total    = typeof duration === 'function' ? duration(Math.sqrt(dx * dx + dy * dy)) : duration;
    var style    = window.getComputedStyle(node);
    var base     = style.transform === 'none' ? '' : style.transform;
    var opacity  = +style.opacity;
    var frames   = sample(function(p) {
      var t = isIntro ? easing(p) : 1 - easing(p);
      var u = 1 - t;
      return { opacity: t * opacity, transformOrigin: 'top left', transform: `${base} translate(${u * dx}px, ${u * dy}px) scale(${t + (1 - t) * dw}, ${t + (1 - t) * dh})`.trim() };
    });
    return new Promise(function(resolve) {
      var anim = µ._mjs_animate(node, frames, { duration: total, delay, fill: 'forwards' });
      var done = function() {
        free(anim);
        resolve();
      };
      anim.finished.then(done, done);
    });
  };
  // le repli : une transition ordinaire { css(t, u), duration, delay, easing }, échantillonnée en 60 images ; une annulation se résout sans lever
  // (une promesse rejetée ferait rejeter tout le groupe de sorties qui l'attend, et ses balises resteraient à l'écran)
  var fallback = function(node, cfg, isIntro) {
    var easing = µ.easing.resolve(cfg.easing);
    var frames = sample(function(p) {
      var t = isIntro ? easing(p) : easing(1 - p);
      return cfg.css(t, 1 - t);
    });
    var anim = µ._mjs_animate(node, frames, { duration: cfg.duration ?? 400, delay: cfg.delay ?? 0, fill: 'forwards' });
    return anim.finished.then(function(r) {
      free(anim);
      return r;
    }, function() {
      free(anim);
    });
  };
  // une moitié du couple : `items` garde les balises de son côté, `others` celles de l'autre
  var side = function(items, others, isIntro) {
    return function(params = {}) {
      var key = params.key;
      var out = {};
      out[isIntro ? 'intro' : 'outro'] = function(node) {
        var shown = node.style && node.style.opacity;
        items.set(key, node);
        // l'entrante ne se montre pas pendant l'attente : posée à sa place, pleinement opaque, elle doublerait la sortante avant le départ du vol
        if (isIntro && node.style) node.style.opacity = '0';
        // l'appariement attend deux images : les deux listes se rendent chacune dans leur tour réactif, et la première arrivée ne verrait
        // sinon aucun partenaire (les deux côtés tomberaient en repli, l'objet ne voyagerait jamais)
        return new Promise(function(resolve, reject) {
          requestAnimationFrame(function() {
            requestAnimationFrame(function() {
              var cfg;
              // l'opacité de la balise est rendue avant d'être lue (sans laisser d'attribut style vide) : l'animation prend le relais dans cette même image
              if (isIntro && node.style) {
                node.style.opacity = shown || '';
                if (!shown && node.getAttribute && dom(node, 'getAttribute', 'style') === '') dom(node, 'removeAttribute', 'style');
              }
              // fallback et css sont du code de l'appli : qu'ils lèvent hors de ce rappel, et la promesse resterait en attente — un groupe de sorties entier gelé
              try {
                if (others.has(key)) {
                  var other = others.get(key);
                  others.delete(key);
                  return travel(other, node, params, isIntro).then(resolve, reject);
                }
                items.delete(key);
                cfg = defaults.fallback && defaults.fallback(node, params, isIntro);
                return cfg && cfg.css ? fallback(node, cfg, isIntro).then(resolve, reject) : resolve();
              } catch (e) {
                µ.warn('[mjs-crossfade] ' + µ._mjs_txt('crossfadeFallbackFailed', null, 'fonction de repli en échec — transition close proprement :'), e);
                return resolve();
              }
            });
          });
        });
      };
      return out;
    };
  };
  µ.anim[`${name}Send`] = side(sent, received, false);
  µ.anim[`${name}Receive`] = side(received, sent, true);
});
