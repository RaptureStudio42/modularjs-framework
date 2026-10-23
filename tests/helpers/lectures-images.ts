// Aide des tests navigateur : compte les lectures de mise en page faites DANS les images d'animation (les rappels de requestAnimationFrame posés
// après son installation), pour garder les effets dont l'image d'animation ne fait que calculer et écrire.
// Le code est un texte, évalué dans la page (une fonction transpilée y emporterait les aides du compilateur de test, absentes de la page).
// Usage : `await page.evaluate(LECTURES)`, puis `await page.evaluate(() => window.__lectures)` → { images, lectures, vues }.

export const LECTURES = `(() => {
  const w     = window
  const bilan = { images: 0, lectures: 0, vues: {} }
  let dedans  = 0
  w.__lectures = bilan
  const ra = w.requestAnimationFrame
  w.requestAnimationFrame = (f) => ra.call(w, (t) => {
    dedans++
    bilan.images++
    try { return f(t) }
    finally { dedans-- }
  })
  const lit = (nom) => {
    if (!dedans) return
    bilan.lectures++
    bilan.vues[nom] = (bilan.vues[nom] || 0) + 1
  }
  const methode = (proto, nom) => {
    const o = proto[nom]
    proto[nom] = function (...a) { lit(nom); return o.apply(this, a) }
  }
  const lecteur = (proto, nom) => {
    const d = Object.getOwnPropertyDescriptor(proto, nom)
    if (d && d.get) Object.defineProperty(proto, nom, { configurable: true, enumerable: d.enumerable, set: d.set, get() { lit(nom); return d.get.call(this) } })
  }
  methode(Element.prototype, 'getBoundingClientRect')
  methode(Element.prototype, 'getClientRects')
  for (const n of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent']) lecteur(HTMLElement.prototype, n)
  for (const n of ['clientWidth', 'clientHeight', 'clientTop', 'clientLeft', 'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft']) lecteur(Element.prototype, n)
  const gcs = w.getComputedStyle
  w.getComputedStyle = (...a) => { lit('getComputedStyle'); return gcs.apply(w, a) }
})()`
