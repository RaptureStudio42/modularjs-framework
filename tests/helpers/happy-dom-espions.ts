// espions pour les essais happy-dom : les écouteurs vivants d'une cible (un écouteur posé avec un effet doit être retiré avec lui), un
// garde-fou contre deux souscriptions qui se réinsèrent sans fin, une boîte non nulle pour la balise, une position `static`, une taille
// de mise en page (`clientWidth`, `clientHeight`) et un ResizeObserver que l'essai réveille à la main.
// happy-dom partage ses classes — donc leurs prototypes — entre toutes les fenêtres du processus : une méthode remplacée pour un essai
// se REND à la fin de l'essai (`rendreTout`, à brancher sur un `afterEach` et à rappeler avant une fenêtre neuve), sinon elle suit tous
// les essais suivants, ceux de ce fichier comme ceux des autres.

const rendre: Array<() => void> = []

export function rendreTout() {
  while (rendre.length) (rendre.pop() as () => void)()
}

// remplace la méthode `nom` là où elle vit (l'objet lui-même, ou le prototype qui la porte), et prévoit de la remettre
function remplacer(objet: any, nom: string, fabrique: (vraie: any) => any) {
  let hote = objet
  while (hote && !Object.prototype.hasOwnProperty.call(hote, nom)) hote = Object.getPrototypeOf(hote)
  const vraie = hote[nom]
  hote[nom] = fabrique(vraie)
  rendre.push(() => { hote[nom] = vraie })
}

// compte les écouteurs vivants, un par un, sur n'importe quelle cible ; à poser avant que le moteur ne charge
export function compter(w: any) {
  const vivants: Array<{ cible: any, type: string, f: any, capture: boolean }> = []
  const cap   = (o: any) => typeof o === 'object' && o !== null ? !!o.capture : !!o
  const meme  = (v: any, cible: any, type: string, f: any, c: boolean) => v.cible === cible && v.type === type && v.f === f && v.capture === c
  // la fenêtre vue du moteur (le royaume où `window.eval` tourne) n'est pas l'objet `w` du test : les deux comptent pour la fenêtre
  const interne = w.eval('window')
  const qui     = (cible: any) => cible === interne ? w : cible
  for (const objet of [w.document.createElement('div'), w]) {
    remplacer(objet, 'addEventListener', (ajoute) => function(this: any, type: string, f: any, opt: any) {
      const cible = qui(this)
      if (f && !vivants.some((v) => meme(v, cible, type, f, cap(opt)))) vivants.push({ cible, type, f, capture: cap(opt) })
      return ajoute.call(this, type, f, opt)
    })
    remplacer(objet, 'removeEventListener', (retire) => function(this: any, type: string, f: any, opt: any) {
      const at = vivants.findIndex((v) => meme(v, qui(this), type, f, cap(opt)))
      if (at >= 0) vivants.splice(at, 1)
      return retire.call(this, type, f, opt)
    })
  }
  return { vivants: (type: string, cible: any) => vivants.filter((v) => v.type === type && v.cible === cible).length }
}

// deux souscriptions qui se disputent la place d'une balise se réinsèrent l'une l'autre sans fin : une boucle de microtâches que rien
// n'interrompt, pas même le garde-temps de mocha. Au-delà de ce nombre d'insertions, l'essai échoue au lieu de ne jamais finir.
export function garde(w: any) {
  let n = 0
  remplacer(w.Element.prototype, 'insertBefore', (ins) => function(this: any, ...a: any[]) {
    if (++n > 5000) throw new Error('trop de réinsertions : deux souscriptions se disputent la place d\'une balise (une souscription n\'a pas été retirée)')
    return ins.apply(this, a)
  })
}

// happy-dom n'a pas de mise en page : toute balise y mesure 0 × 0. Une boîte de 200 × 100 pour que la souris puisse la viser.
export function avecBoite(w: any) {
  remplacer(w.Element.prototype, 'getBoundingClientRect', () => function() { return { left: 0, top: 0, right: 200, bottom: 100, x: 0, y: 0, width: 200, height: 100 } })
}

// sa position calculée est vide, jamais `static` : une balise `static` (le cas d'une <img> de page) que l'effet passe `relative` et rend telle quelle
export function statique(w: any) {
  remplacer(w, 'getComputedStyle', (lire) => (n: any, p?: any) => new Proxy(lire.call(w, n, p), { get: (t: any, k: any) => k === 'position' && !t.position ? 'static' : typeof t[k] === 'function' ? t[k].bind(t) : t[k] }))
}

// happy-dom n'a pas de mise en page : `clientWidth` et `clientHeight` y valent 0. Une taille pour toute balise (le zoom du relief la lit) ; l'essai la change à la main
// (l'objet rendu) avant de réveiller l'observateur
export function avecTaille(w: any, largeur: number, hauteur: number) {
  const taille = { largeur, hauteur }
  for (const [nom, cle] of [['clientWidth', 'largeur'], ['clientHeight', 'hauteur']] as const) {
    let hote = w.HTMLElement.prototype
    while (hote && !Object.prototype.hasOwnProperty.call(hote, nom)) hote = Object.getPrototypeOf(hote)
    const avant = Object.getOwnPropertyDescriptor(hote, nom) as PropertyDescriptor
    // sauf la page elle-même : sa largeur nulle dit au moteur qu'il n'y a pas de mise en page (il ne diffère alors aucune image)
    Object.defineProperty(hote, nom, { configurable: true, get(this: any) { return this.localName === 'html' ? 0 : taille[cle] } })
    rendre.push(() => Object.defineProperty(hote, nom, avant))
  }
  return taille
}

// un ResizeObserver que l'essai déclenche à la main : les observations vivantes (une par observateur et par cible), et de quoi réveiller chaque observateur ;
// posé sur la fenêtre de l'essai seule (pas sur un prototype partagé) : rien à rendre
export function observateurs(w: any) {
  const vivants: Array<{ obs: any, cible: any }> = []
  // le moteur lit le ResizeObserver du royaume où `window.eval` tourne, pas celui de l'objet `w` du test
  w.eval('window').ResizeObserver = class {
    rappel: any
    constructor(rappel: any) { this.rappel = rappel }
    observe(cible: any) { if (!vivants.some((v) => v.obs === this && v.cible === cible)) vivants.push({ obs: this, cible }) }
    unobserve(cible: any) {
      const at = vivants.findIndex((v) => v.obs === this && v.cible === cible)
      if (at >= 0) vivants.splice(at, 1)
    }
    disconnect() {
      for (let i = vivants.length - 1; i >= 0; i--) if (vivants[i].obs === this) vivants.splice(i, 1)
    }
  }
  return {
    vivants: (cible?: any) => vivants.filter((v) => cible === undefined || v.cible === cible).length,
    declencher: () => {
      const faits = new Set<any>()
      for (const v of [...vivants]) {
        if (faits.has(v.obs)) continue
        faits.add(v.obs)
        v.obs.rappel(vivants.filter((x) => x.obs === v.obs).map((x) => ({ target: x.cible })), v.obs)
      }
    }
  }
}
