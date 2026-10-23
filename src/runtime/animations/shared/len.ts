// animations/shared/len.ts — une longueur comme les transitions la reçoivent : un nombre (px) ou une longueur écrite (« 40px », « 10% »,
// « 1em ») → [valeur, unité] ; ce qui ne se lit pas vaut 0px. Appelée par fly (son déplacement) et blur (son flou)
(function(v) {
  var m;
  if (typeof v === 'number') return [v, 'px'];
  m = String(v).match(/^([\d.\-]+)(.*)$/);
  return m ? [parseFloat(m[1]), m[2] || 'px'] : [parseFloat(v) || 0, 'px'];
});
