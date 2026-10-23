// les outils du cœur des effets (runtime/mjs_fx_tool*.ts), dans happy-dom : chacun est écrit une fois et sert à plusieurs effets.
// Ce que la mise en page seule montre (la boîte d'une balise mise à l'échelle, l'observateur de visibilité réel) est dans
// effets-outils-coeur-browser.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const ICI  = dirname(fileURLToPath(import.meta.url))
const lire = (f: string) => readFileSync(join(ICI, '../src/runtime', f), 'utf-8')
const CODE = ['mjs_fx.ts', 'mjs_fx_toolup.ts', 'mjs_fx_toolroots.ts', 'mjs_fx_toolbox.ts', 'mjs_fx_toolwatch.ts', 'mjs_fx_toollag.ts', 'mjs_fx_toolsmooth.ts', 'mjs_fx_toolregister.ts', 'mjs_fx_toolvisible.ts', 'mjs_fx_toolsplit.ts', 'mjs_fx_toolsvg.ts'].map(lire).join('\n')

// la méthode d'origine des éléments, relevée au chargement du fichier, avant qu'aucun test n'ait posé de boîte à l'écran
const ORIGINALE = new Window({ url: 'http://localhost/' }).Element.prototype.getBoundingClientRect

// le moteur (il porte µ._mjs_dom) et les outils dans une fenêtre happy-dom
function monde(avant = '') {
  const window: any = new Window({ url: 'http://localhost/' })
  if (avant) window.eval(avant)
  const µ: any = { _fxConf: { lite: 'off' }, warn: () => {}, _mjs_msg: (_c: string, _v: unknown, texte: string) => texte }
  window.eval(`globalThis.__charge = function(µ) {\n${CODE}\n}`)
  window.__charge(µ)
  return { window, µ, doc: window.document }
}

describe('mjs_fx_toolup et mjs_fx_toolroots — remonter à travers les ombres', () => {
  it('parent : le parent, ou l\'hôte à la racine d\'une ombre ; within : un ancêtre strict, ombres comprises ; roots : de la balise vers le haut', () => {
    const { µ, doc } = monde()
    const hote  = doc.body.appendChild(doc.createElement('div'))
    const ombre = hote.attachShadow({ mode: 'open' })
    const bloc  = ombre.appendChild(doc.createElement('section'))
    const hote2 = bloc.appendChild(doc.createElement('div'))
    const ombre2 = hote2.attachShadow({ mode: 'open' })
    const el    = ombre2.appendChild(doc.createElement('p'))
    // des nœuds : comparés par `===`, jamais par assert.equal (un échec sérialiserait tout le document)
    assert.ok(µ._mjs_fxParent(el) === hote2, 'à la racine d\'une ombre : l\'hôte')
    assert.ok(µ._mjs_fxParent(bloc) === hote, 'le parent d\'un bloc de l\'ombre : l\'hôte de l\'ombre')
    assert.ok(µ._mjs_fxParent(doc.documentElement) === doc, 'le parent de <html> : le document')
    assert.ok(µ._mjs_fxParent(doc) === null, 'au sommet : null')
    assert.equal(µ._mjs_fxWithin(hote, el), true)
    assert.equal(µ._mjs_fxWithin(bloc, el), true)
    assert.equal(µ._mjs_fxWithin(doc.body, el), true)
    assert.equal(µ._mjs_fxWithin(el, el), false, 'strict : la balise n\'est pas dans elle-même')
    assert.equal(µ._mjs_fxWithin(el, bloc), false)
    assert.equal(µ._mjs_fxWithin(doc.createElement('i'), el), false)
    const racines = µ._mjs_fxRoots(el)
    assert.equal(racines.length, 3)
    assert.ok(racines[0] === ombre2, 'la première racine : l\'ombre de la balise')
    assert.ok(racines[1] === ombre, 'la deuxième : l\'ombre de son hôte')
    assert.ok(racines[2] === doc, 'la dernière : le document')
    assert.equal(µ._mjs_fxRoots(doc.body).length, 1, 'une balise du document : sa seule racine')
  })
})

describe('mjs_fx_toollag et mjs_fx_toolsmooth — le retard d\'un suivi', () => {
  it('le réglage : entre 0.01 et 1, la valeur d\'absence pour ce qui n\'est pas un nombre', () => {
    const { µ } = monde()
    const r = (v: unknown, a = 0.18) => µ._mjs_fxLagSetting(v, a)
    for (const v of [undefined, null, '', 'lent', NaN]) assert.equal(r(v), 0.18, String(v))
    assert.equal(r(0), 0.01)
    assert.equal(r(-3), 0.01)
    assert.equal(r(0.5), 0.5)
    assert.equal(r('0.25'), 0.25)
    assert.equal(r(1), 1)
    assert.equal(r(40), 1)
    assert.equal(r(undefined, 1), 1, 'la valeur d\'absence est celle de l\'effet')
  })

  it('le retard : à la première image la part rattrapée est le réglage ; l\'écart est plafonné à 100 ms ; 1 est collé', () => {
    const { µ } = monde()
    assert.ok(Math.abs(µ._mjs_fxLag(0.18, 1000, 0) - 0.18) < 1e-12)
    assert.ok(Math.abs(µ._mjs_fxLag(0.18, 1033, 1000) - (1 - Math.pow(0.82, 33 / 16.667))) < 1e-12)
    assert.equal(µ._mjs_fxLag(0.18, 5000, 1000), µ._mjs_fxLag(0.18, 1100, 1000))
    assert.equal(µ._mjs_fxLag(1, 1000, 0), 1)
    assert.equal(µ._mjs_fxLag(3, 1016, 1000), 1)
  })

  it('le même retard à toute cadence : une seconde de suivi laisse le même reste à 60 et à 144 images par seconde', () => {
    const { µ } = monde()
    const reste = (hz: number) => {
      let r = 1
      let last = 0
      for (let i = 1; i <= hz; i++) {
        const now = 1000 + i * 1000 / hz
        r *= 1 - µ._mjs_fxLag(0.18, now, last)
        last = now
      }
      return r
    }
    assert.ok(Math.abs(reste(60) - reste(144)) < 0.01, reste(60) + ' contre ' + reste(144))
  })
})

describe('mjs_fx_toolregister — la variable enregistrée sans héritage', () => {
  const FAUX_CSS = `globalThis.__reg = []; Object.defineProperty(globalThis, 'CSS', { configurable: true, writable: true, value: { registerProperty: function(o) { if (o.name === '--refuse') throw new Error('déjà'); globalThis.__reg.push(o); } } });`

  it('enregistrée sans héritage, avec sa syntaxe et sa valeur de départ', () => {
    const { µ, window } = monde(FAUX_CSS)
    µ._mjs_fxRegister('--mjs-fx-essai-d', '<number>', '0')
    µ._mjs_fxRegister('--mjs-fx-essai-x', '<length-percentage>', '50%')
    assert.equal(window.__reg.length, 2)
    assert.equal(window.__reg[0].name, '--mjs-fx-essai-d')
    assert.equal(window.__reg[0].syntax, '<number>')
    assert.equal(window.__reg[0].inherits, false)
    assert.equal(window.__reg[0].initialValue, '0')
    assert.equal(window.__reg[1].initialValue, '50%')
  })

  it('une erreur du navigateur (déjà enregistrée) est avalée ; sans CSS.registerProperty, rien ne se passe', () => {
    const { µ } = monde(FAUX_CSS)
    assert.doesNotThrow(() => µ._mjs_fxRegister('--refuse', '<number>', '0'))
    const sans = monde("Object.defineProperty(globalThis, 'CSS', { configurable: true, writable: true, value: {} });")
    assert.doesNotThrow(() => sans.µ._mjs_fxRegister('--mjs-fx-essai-d', '<number>', '0'))
  })
})

describe('mjs_fx_toolsplit — une liste CSS coupée à ses virgules de premier niveau', () => {
  it('hors parenthèses et guillemets, blancs retirés', () => {
    const { µ } = monde()
    const c = (v: unknown) => Array.from(µ._mjs_fxCssList(v))
    assert.deepEqual(c('a, b ,c'), ['a', 'b', 'c'])
    assert.deepEqual(c('linear-gradient(rgba(0, 0, 0, .5), rgba(0, 0, 0, .5)), url(a.png)'), ['linear-gradient(rgba(0, 0, 0, .5), rgba(0, 0, 0, .5))', 'url(a.png)'])
    assert.deepEqual(c('url("a,b.png"), none'), ['url("a,b.png")', 'none'])
    assert.deepEqual(c('url(\'a\\\',b.png\'), x'), ['url(\'a\\\',b.png\')', 'x'])
    // une virgule ou une parenthèse DANS un guillemet, hors de toute parenthèse : le guillemet seul la protège
    assert.deepEqual(c('"a,b", c'), ['"a,b"', 'c'])
    assert.deepEqual(c('\'a,b\', c'), ['\'a,b\'', 'c'])
    assert.deepEqual(c('"a(b", c, d'), ['"a(b"', 'c', 'd'], 'une parenthèse ouvrante dans un guillemet n\'ouvre rien')
    assert.deepEqual(c('"a)b", c, d'), ['"a)b"', 'c', 'd'], 'une parenthèse fermante dans un guillemet ne ferme rien')
    assert.deepEqual(c('"a\\",b", c'), ['"a\\",b"', 'c'], 'un guillemet échappé ne ferme pas la chaîne')
    assert.deepEqual(c(''), [''])
    assert.deepEqual(c(null), [''])
    assert.deepEqual(c(12), ['12'])
  })
})

describe('mjs_fx_toolsvg — le <svg> caché qui porte les filtres', () => {
  it('dans le <body>, nul, caché aux lecteurs d\'écran, hors du flux', () => {
    const { µ, doc } = monde()
    const el  = doc.body.appendChild(doc.createElement('div'))
    const svg = µ._mjs_fxSvgDefs(el)
    assert.ok(svg.parentNode === doc.body, 'le <svg> est un enfant direct du <body>')
    assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg')
    assert.equal(svg.getAttribute('aria-hidden'), 'true')
    assert.equal(svg.style.position, 'absolute')
    assert.equal(svg.getAttribute('width'), '0')
    assert.equal(svg.getAttribute('height'), '0')
  })

  it('dans l\'ombre de la balise quand elle est dans un composant : le filtre s\'y résout', () => {
    const { µ, doc } = monde()
    const ombre = doc.body.appendChild(doc.createElement('div')).attachShadow({ mode: 'open' })
    const el    = ombre.appendChild(doc.createElement('div'))
    assert.ok(µ._mjs_fxSvgDefs(el).parentNode === ombre, 'le <svg> est posé dans l\'ombre de la balise')
  })

  it('dans un fragment détaché (la balise n\'est pas encore posée) : le <svg> reste dans le fragment avec elle et arrive avec elle dans l\'ombre qui l\'accueille', () => {
    const { µ, doc } = monde()
    const fragment = doc.createDocumentFragment()
    const el       = fragment.appendChild(doc.createElement('div'))
    const svg      = µ._mjs_fxSvgDefs(el)
    assert.ok(svg.parentNode === fragment, 'le <svg> est dans le fragment de la balise')
    assert.equal(doc.body.querySelectorAll('svg').length, 0, 'rien n\'est posé dans le <body>')
    const ombre = doc.body.appendChild(doc.createElement('div')).attachShadow({ mode: 'open' })
    ombre.appendChild(fragment)
    assert.ok(svg.parentNode === ombre, 'le <svg> est arrivé dans l\'ombre avec la balise')
    assert.equal(doc.body.querySelectorAll('svg').length, 0, 'et rien n\'est resté dans le <body>')
  })

  it('un environnement sans getRootNode (navigateur ancien, document factice) : le <svg> est posé dans le <body>, sans rien lever', () => {
    const { µ, window, doc } = monde()
    const el = doc.body.appendChild(doc.createElement('div'))
    // le prototype de happy-dom est partagé par toutes les fenêtres du fichier : la méthode est rendue quoi qu'il arrive
    const origine = Object.getOwnPropertyDescriptor(window.Node.prototype, 'getRootNode')!
    try {
      delete window.Node.prototype.getRootNode
      assert.equal(typeof el.getRootNode, 'undefined', 'la balise n\'a plus getRootNode')
      let svg: any
      assert.doesNotThrow(() => { svg = µ._mjs_fxSvgDefs(el) })
      assert.ok(svg.parentNode === doc.body, 'le <svg> est un enfant direct du <body>')
    } finally {
      Object.defineProperty(window.Node.prototype, 'getRootNode', origine)
    }
  })
})

describe('mjs_fx_toolvisible — n\'agir que si la balise est à l\'écran', () => {
  // un IntersectionObserver factice : le test envoie lui-même les annonces
  const FAUX_IO = `globalThis.__io = []; globalThis.IntersectionObserver = class { constructor(f, o) { this.f = f; this.o = o; this.cible = null; this.gone = false; globalThis.__io.push(this) } observe(e) { this.cible = e } disconnect() { this.gone = true } };`

  it('la dernière annonce du navigateur décide ; la marge est celle de l\'observateur, telle quelle', () => {
    const { µ, window, doc } = monde(FAUX_IO)
    const el = doc.body.appendChild(doc.createElement('div'))
    const journal: string[] = []
    µ._mjs_fxVisible(el, '200px', () => journal.push('entre'), () => journal.push('sort'))
    µ._mjs_fxVisible(el, '100% 0px', () => {}, () => {})
    const io = window.__io[0]
    assert.equal(io.cible, el)
    assert.equal(io.o.rootMargin, '200px')
    assert.equal(window.__io[1].o.rootMargin, '100% 0px')
    assert.deepEqual(journal, [], 'rien tant que le navigateur n\'a rien dit')
    io.f([{ isIntersecting: false }])
    io.f([{ isIntersecting: true }, { isIntersecting: true }])
    io.f([{ isIntersecting: true }, { isIntersecting: false }])
    assert.deepEqual(journal, ['sort', 'entre', 'sort'])
  })

  it('sans IntersectionObserver (navigateur ancien) : la balise est tenue pour visible, enter() est appelée tout de suite, off() ne plante pas', () => {
    const { µ, window, doc } = monde()
    delete window.IntersectionObserver
    assert.equal(typeof window.IntersectionObserver, 'undefined', 'le banc : aucun observateur')
    const el = doc.body.appendChild(doc.createElement('div'))
    const journal: string[] = []
    let off: any
    assert.doesNotThrow(() => { off = µ._mjs_fxVisible(el, '200px', () => journal.push('entre'), () => journal.push('sort')) })
    assert.deepEqual(journal, ['entre'])
    assert.doesNotThrow(() => off())
    assert.deepEqual(journal, ['entre'], 'off ne dit rien')
  })

  it('off rend l\'observateur', () => {
    const { µ, window, doc } = monde(FAUX_IO)
    const el = doc.body.appendChild(doc.createElement('div'))
    const off = µ._mjs_fxVisible(el, '0px', () => {}, () => {})
    off()
    assert.equal(window.__io[0].gone, true)
  })
})

describe('mjs_fx_toolbox — la boîte d\'une balise', () => {
  // happy-dom ne mesure rien : la boîte à l'écran est posée par le test sur le prototype des éléments, partagé entre toutes les fenêtres
  // et les autres fichiers de test ; il est rendu tel qu'il était après chaque test
  const rendus: Array<() => void> = []
  afterEach(() => { while (rendus.length) rendus.pop()!() })
  function ecran(window: any, boite: { left: number, top: number, width: number, height: number }) {
    const proto = window.Element.prototype
    const avant = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect')
    proto.getBoundingClientRect = () => boite
    rendus.push(() => { if (avant) Object.defineProperty(proto, 'getBoundingClientRect', avant); else delete proto.getBoundingClientRect })
  }
  // la taille de mise en page d'une balise
  const miseEnPage = (el: any, w: number | undefined, h: number | undefined) => {
    Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true })
    Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true })
  }
  function banc() {
    const m = monde()
    const el = m.doc.body.appendChild(m.doc.createElement('div'))
    ecran(m.window, { left: 100, top: 50, width: 300, height: 100 })
    miseEnPage(el, 200, 50)
    return { ...m, el }
  }

  it('{ l, t, sx, sy } : le coin à l\'écran et l\'échelle de la balise ; un point de la fenêtre rendu dans son repère intérieur', () => {
    const { µ, el } = banc()
    const b = µ._mjs_fxBox(el)
    assert.deepEqual({ l: b.l, t: b.t, sx: b.sx, sy: b.sy }, { l: 100, t: 50, sx: 1.5, sy: 2 })
    assert.equal((250 - b.l) / b.sx, 100, 'le repère intérieur d\'un point de la fenêtre')
    assert.equal((250 - b.t) / b.sy, 100)
  })

  it('une balise sans taille de mise en page (0 sur 0), ou qui n\'a pas de offsetWidth (svg) : échelle 1', () => {
    const { µ, doc, window } = monde()
    ecran(window, { left: 5, top: 6, width: 0, height: 0 })
    const b = µ._mjs_fxBox(doc.body.appendChild(doc.createElement('div')))
    assert.equal(b.sx, 1)
    assert.equal(b.sy, 1)
    const s = µ._mjs_fxBox(doc.body.appendChild(doc.createElementNS('http://www.w3.org/2000/svg', 'svg')))
    assert.equal(s.sx, 1)
  })

  it('une taille de mise en page nulle MAIS une taille à l\'écran (balise sans boîte propre, svg) : échelle 1, jamais infinie ni NaN', () => {
    const { µ, doc, window } = monde()
    ecran(window, { left: 5, top: 6, width: 50, height: 20 })
    const vide = doc.body.appendChild(doc.createElement('div'))
    miseEnPage(vide, 0, 0)
    const b = µ._mjs_fxBox(vide)
    assert.equal(b.sx, 1, 'offsetWidth 0, largeur à l\'écran 50')
    assert.equal(b.sy, 1, 'offsetHeight 0, hauteur à l\'écran 20')
    const svg = doc.body.appendChild(doc.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    miseEnPage(svg, undefined, undefined)
    const s = µ._mjs_fxBox(svg)
    assert.equal(s.sx, 1, 'un svg n\'a pas de offsetWidth')
    assert.equal(s.sy, 1)
  })

  it('une taille à l\'écran nulle mais une mise en page réelle : échelle 1, jamais 0 (le point ne se divise pas par 0)', () => {
    const { µ, doc, window } = monde()
    ecran(window, { left: 0, top: 0, width: 0, height: 0 })
    const el = doc.body.appendChild(doc.createElement('div'))
    miseEnPage(el, 200, 50)
    const b = µ._mjs_fxBox(el)
    assert.equal(b.sx, 1)
    assert.equal(b.sy, 1)
  })

  it('le prototype des éléments est rendu comme il était : une mesure posée par un test ne fuit pas dans les autres fichiers', () => {
    const { window } = monde()
    const avant = Object.getOwnPropertyDescriptor(window.Element.prototype, 'getBoundingClientRect')
    ecran(window, { left: 1, top: 2, width: 3, height: 4 })
    assert.notEqual(window.Element.prototype.getBoundingClientRect, avant?.value)
    rendus.pop()!()
    assert.deepEqual(Object.getOwnPropertyDescriptor(window.Element.prototype, 'getBoundingClientRect'), avant)
  })

  // le crochet de nettoyage lui-même : un test pose une boîte sans la rendre, le suivant exige la méthode d'origine
  it('un test pose une boîte à l\'écran sans la rendre (le test suivant exige que le nettoyage de fin de test l\'ait fait)', () => {
    const { window } = banc()
    assert.ok(window.Element.prototype.getBoundingClientRect !== ORIGINALE, 'le banc a bien remplacé la méthode des éléments')
  })

  it('le test précédent a laissé la méthode d\'origine : getBoundingClientRect n\'est plus celle du banc', () => {
    const { window } = monde()
    assert.ok(window.Element.prototype.getBoundingClientRect === ORIGINALE, 'la boîte posée par le test précédent fuit dans les autres tests et les autres fichiers')
  })
})

describe('mjs_fx_toolwatch — surveiller l\'entourage d\'une balise', () => {
  const FAUX_RO = 'globalThis.__ro = []; globalThis.ResizeObserver = class { constructor(f) { this.f = f; this.gone = false; globalThis.__ro.push(this) } observe() {} disconnect() { this.gone = true } };'

  it('un défilement du document, d\'un conteneur, d\'une ombre, un redimensionnement de la fenêtre appellent f ; off rend tout', () => {
    const { µ, window, doc } = monde(FAUX_RO)
    const ombre = doc.body.appendChild(doc.createElement('div')).attachShadow({ mode: 'open' })
    const el    = ombre.appendChild(doc.createElement('div'))
    let n = 0
    const off = µ._mjs_fxWatch(el, () => n++)
    doc.dispatchEvent(new window.Event('scroll'))
    doc.body.dispatchEvent(new window.Event('scroll'))
    ombre.dispatchEvent(new window.Event('scroll'))
    window.dispatchEvent(new window.Event('resize'))
    assert.equal(n, 4, 'la page, un conteneur, l\'ombre, la fenêtre')
    off()
    doc.dispatchEvent(new window.Event('scroll'))
    ombre.dispatchEvent(new window.Event('scroll'))
    window.dispatchEvent(new window.Event('resize'))
    assert.equal(n, 4, 'plus rien après off')
    assert.equal(window.__ro[0].gone, true)
    assert.doesNotThrow(() => off())
  })

  it('sans ResizeObserver (navigateur ancien) : pas de surveillance de la taille, mais le défilement et la fenêtre appellent f ; off() rend tout', () => {
    const { µ, window, doc } = monde()
    delete window.ResizeObserver
    assert.equal(typeof window.ResizeObserver, 'undefined', 'le banc : aucun observateur')
    let n = 0
    let off: any
    assert.doesNotThrow(() => { off = µ._mjs_fxWatch(doc.body.appendChild(doc.createElement('div')), () => n++) })
    doc.dispatchEvent(new window.Event('scroll'))
    window.dispatchEvent(new window.Event('resize'))
    assert.equal(n, 2, 'la page, la fenêtre')
    assert.doesNotThrow(() => off())
    window.dispatchEvent(new window.Event('resize'))
    assert.equal(n, 2, 'plus rien après off')
  })

  it('l\'observateur de taille : sa première annonce dit seulement qu\'il est posé ; la suivante appelle f', () => {
    const { µ, doc, window } = monde(FAUX_RO)
    let n = 0
    µ._mjs_fxWatch(doc.body.appendChild(doc.createElement('div')), () => n++)
    window.__ro[0].f()
    assert.equal(n, 0)
    window.__ro[0].f()
    assert.equal(n, 1)
  })

  it('sans surveillance de taille (troisième paramètre vrai) : aucun ResizeObserver n\'est posé ; le défilement des racines et la fenêtre appellent f, off() rend les écouteurs', () => {
    const { µ, window, doc } = monde(FAUX_RO)
    const ombre = doc.body.appendChild(doc.createElement('div')).attachShadow({ mode: 'open' })
    const el    = ombre.appendChild(doc.createElement('div'))
    let n = 0
    const off = µ._mjs_fxWatch(el, () => n++, true)
    assert.equal(window.__ro.length, 0, 'aucun observateur de taille posé')
    doc.dispatchEvent(new window.Event('scroll'))
    ombre.dispatchEvent(new window.Event('scroll'))
    window.dispatchEvent(new window.Event('resize'))
    assert.equal(n, 3, 'la page, l\'ombre, la fenêtre')
    assert.doesNotThrow(() => off())
    doc.dispatchEvent(new window.Event('scroll'))
    ombre.dispatchEvent(new window.Event('scroll'))
    window.dispatchEvent(new window.Event('resize'))
    assert.equal(n, 3, 'plus rien après off')
    // sans le paramètre : l'observateur de taille est posé, comme avant
    µ._mjs_fxWatch(el, () => n++)
    assert.equal(window.__ro.length, 1)
  })
})

