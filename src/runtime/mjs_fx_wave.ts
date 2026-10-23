// mjs_fx_wave — `*wave` : le texte est un verre qui se remplit d'eau, dont la surface ondule. Sur un
// calque posé par-dessus le texte (deux copies : le verre, en contour ; l'eau, pleine, découpée
// sous une ligne qui ondule), le texte d'origine reste en place. Réglages : color (le verre et
// l'eau ; #03a9f4), speed (une ondulation, aller-retour ; 4s), level (la hauteur de l'eau, en % du
// texte ; 45), stroke (l'épaisseur du verre en px ; 2), on (always, hover, view, click, load).
// Le verre est dans le flux du calque (il lui donne sa taille : le calque se range comme le texte de
// la balise), l'eau posée exactement dessus.

µ._mjs_fxDefs.wave = {
  css: '[mjs-fx-wave-copy="water"]{position:absolute;inset:0;box-sizing:border-box;padding:inherit;white-space:inherit}'
    + '[mjs-fx-wave-copy="glass"]{-webkit-text-fill-color:transparent;-webkit-text-stroke:var(--mjs-wave-stroke,2px) var(--mjs-wave-color,#03a9f4)}'
    + '[mjs-fx-wave-copy="water"]{--mjs-fx-wave-y:calc(100% - var(--mjs-wave-level,45) * 1%);-webkit-text-fill-color:var(--mjs-wave-color,#03a9f4);clip-path:polygon(0% calc(var(--mjs-fx-wave-y) - 10%),15% calc(var(--mjs-fx-wave-y) - 11%),32% calc(var(--mjs-fx-wave-y) - 5%),54% calc(var(--mjs-fx-wave-y) + 5%),70% calc(var(--mjs-fx-wave-y) + 6%),84% calc(var(--mjs-fx-wave-y) + 4%),100% calc(var(--mjs-fx-wave-y) - 3%),100% 100%,0% 100%);animation:var(--mjs-fx-wave-go,mjs-fx-wave) var(--mjs-wave-speed,4s) ease-in-out 0s var(--mjs-fx-wave-times,infinite)}'
    + '@keyframes mjs-fx-wave{0%,100%{clip-path:polygon(0% calc(var(--mjs-fx-wave-y) - 10%),15% calc(var(--mjs-fx-wave-y) - 11%),32% calc(var(--mjs-fx-wave-y) - 5%),54% calc(var(--mjs-fx-wave-y) + 5%),70% calc(var(--mjs-fx-wave-y) + 6%),84% calc(var(--mjs-fx-wave-y) + 4%),100% calc(var(--mjs-fx-wave-y) - 3%),100% 100%,0% 100%)}50%{clip-path:polygon(0% calc(var(--mjs-fx-wave-y) + 5%),16% calc(var(--mjs-fx-wave-y) + 10%),34% calc(var(--mjs-fx-wave-y) + 11%),51% calc(var(--mjs-fx-wave-y) + 7%),67% calc(var(--mjs-fx-wave-y) - 5%),84% calc(var(--mjs-fx-wave-y) - 10%),100% calc(var(--mjs-fx-wave-y) - 9%),100% 100%,0% 100%)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-wave-copy="water"][mjs-fx-wave-copy="water"]{animation:none}}',
  vars: { color: '', speed: '', level: '', stroke: 'px' },
  setup: function(el, s, comp) {
    var tx = µ._mjs_fxLayer(comp, el, function(l, txt) {
      ['glass', 'water'].forEach(function(kind) {
        var copy = document.createElement('span');
        copy.setAttribute('mjs-fx-wave-copy', kind);
        copy.textContent = txt;
        l.appendChild(copy);
      });
    });
    var gate = µ._mjs_fxLoop(el, 'wave', s.on);
    return function() {
      gate();
      tx.off();
    };
  }
};
