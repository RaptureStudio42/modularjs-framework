// animations/draw.ts — un tracé SVG se dessine d'un bout à l'autre : son trait devient un tiret aussi long que lui, décalé de sa
// longueur puis ramené à zéro ; il s'efface de même à la sortie
// seul un tracé SVG sait donner sa longueur (getTotalLength) : tout autre nœud reçoit un avertissement à chaque jeu et reste tel quel
// un trait aux bouts ronds ou carrés déborde du tracé de son épaisseur : elle s'ajoute à la longueur
// options : duration (800 ; ou une fonction de la longueur du tracé), speed (px par ms : la durée vaut alors longueur / speed quand
// duration n'est pas écrite), delay (0), easing (ease-in-out)
(function(opts = {}) {
  var setup = function(node) {
    var len = 0;
    var style, d;
    if (typeof node.getTotalLength === 'function') len = node.getTotalLength() ?? 0;
    else µ.warn('[ModularJS] *draw ne s\'applique qu\'à un tracé SVG.');
    style = window.getComputedStyle(node);
    if (style.strokeLinecap !== 'butt') len += parseInt(style.strokeWidth, 10) || 0;
    d = opts.duration;
    return {
      delay: opts.delay ?? 0,
      duration: d != null ? typeof d === 'function' ? d(len) : d : opts.speed != null ? len / opts.speed : 800,
      easing: µ.easing.resolve(opts.easing ?? µ.easing.cubicInOut),
      steps: opts.steps ?? 60,
      css: function(t, u) {
        return { strokeDasharray: `${len}`, strokeDashoffset: `${u * len}` };
      }
    };
  };
  setup._isCfgFactory = true;
  return {
    intro: setup,
    outro: setup
  };
});
