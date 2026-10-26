// `*stagger` : les unités qui arrivent — lettre et mot comme avant ; `line` (les lignes telles qu'elles
// tombent à la mise en page, regroupées quand la largeur change ou qu'une police arrive) ; `child` (les
// enfants directs, sans calque, un enfant venu plus tard arrive seul) ; `clip` (chaque unité monte de
// derrière un cache). Ici la logique, dans happy-dom : marques, rangs, repos, retrait sans reste. Ce qui
// se voit (rognage réel, lignes vues par le moteur de mise en page) est dans la suite navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { EFFECTS, parseEffect } from '../src/effects/catalog.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

// les deux règles d'animation d'une lettre et d'un mot, telles qu'elles s'écrivaient avant les nouvelles unités
const REGLE_LETTRE = '[mjs-fx~="stagger"][mjs-fx-play~="stagger"] [mjs-fx-letter]{animation:var(--mjs-fx-stagger-name,mjs-fx-stagger-move) var(--mjs-stagger-duration,500ms) var(--mjs-stagger-easing,ease-out) calc(var(--mjs-stagger-delay,0s) + var(--mjs-fx-stagger-k) * var(--mjs-stagger-step,45ms)) 1 normal both}'
const REGLE_MOT    = '[mjs-fx~="stagger"][mjs-fx-stagger-unit="word"][mjs-fx-play~="stagger"] [mjs-fx-word]{animation:var(--mjs-fx-stagger-name,mjs-fx-stagger-move) var(--mjs-stagger-duration,500ms) var(--mjs-stagger-easing,ease-out) calc(var(--mjs-stagger-delay,0s) + var(--mjs-fx-stagger-k) * var(--mjs-stagger-step,45ms)) 1 normal both}'

describe('*stagger — les unités : lettre, mot, ligne, enfant, et le cache (happy-dom)', function () {
  this.timeout(90000)
  let window: any
  let doc: any
  const µ = () => window.µ

  before(async () => {
    const root   = mjsTmp('effets-stagger-unites')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-unites.mjs'), '<p class="t" *stagger(on: load)>Titre</p>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    doc = window.document
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const attendre = (ms = 25) => new Promise((r) => setTimeout(r, ms))
  const nu       = (el: any) => el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx'))
  const vars     = (el: any) => (el.getAttribute('style') ?? '').split(';').map((x: string) => x.split(':')[0].trim()).filter((x: string) => x.startsWith('--mjs-fx-stagger'))
  // une balise de texte, ou un conteneur de `n` enfants
  const texte    = (t: string) => {
    const el = doc.createElement('p')
    el.textContent = t
    doc.body.appendChild(el)
    return el
  }
  const boite    = (n: number, balise = 'div') => {
    const el = doc.createElement('div')
    el.innerHTML = Array.from({ length: n }, (_, i) => `<${balise} class="k${i}">k${i}</${balise}>`).join('')
    doc.body.appendChild(el)
    return el
  }
  // la fin de l'animation d'une unité
  const fin = (cible: any, nom = 'mjs-fx-stagger-move') => {
    const e = new window.Event('animationend', { bubbles: true })
    ;(e as any).animationName = nom
    cible.dispatchEvent(e)
  }
  // un réglage tenu par une variable qui change : la voie du moteur (variable CSS, puis le suivi de l'effet, ou sa relance)
  const regle = (el: any, k: string, v: any) => µ()._mjs_fxSet(el, 'stagger', { [k]: v })
  const rangs = (el: any, sel: string) => [...el.querySelectorAll(sel)].map((n: any) => Number(n.style.getPropertyValue('--mjs-fx-stagger-k')))
  // une variable lue sur la balise sans l'espace que happy-dom 20.14 ajoute après une virgule (20.11 rend la valeur telle qu'écrite, comme un navigateur)
  const lue   = (el: any, p: string) => el.style.getPropertyValue(p).replace(/,\s+/g, ',')

  it('lettre et mot se comportent comme avant : mêmes règles, mêmes marques, mêmes rangs', () => {
    const css = µ()._mjs_fxDefs.stagger.css
    assert.ok(css.includes(REGLE_LETTRE), 'la règle d\'animation d\'une lettre n\'a pas changé')
    assert.ok(css.includes(REGLE_MOT), 'la règle d\'animation d\'un mot n\'a pas changé')
    const a    = texte('Salut toi')
    const offA = µ()._mjs_fx(null, a, 'stagger', { on: 'click' })
    assert.equal(a.hasAttribute('mjs-fx-stagger-unit'), false, 'la lettre est l\'unité sans marque')
    assert.equal(a.querySelectorAll('[mjs-fx-letter]').length, 8)
    assert.equal(a.querySelector('[mjs-fx-layer]').style.getPropertyValue('--mjs-fx-stagger-c'), '8', 'le nombre de lettres sur le calque')
    assert.equal(a.querySelectorAll('[mjs-fx-cut]').length, 0, 'aucun cache sans clip')
    assert.equal(a.querySelectorAll('[mjs-fx-child]').length, 0)
    offA()
    const b    = texte('un deux trois')
    const offB = µ()._mjs_fx(null, b, 'stagger', { unit: 'word', order: 'left', on: 'click' })
    assert.equal(b.getAttribute('mjs-fx-stagger-unit'), 'word')
    assert.deepEqual(rangs(b, '[mjs-fx-word]'), [2, 1, 0], 'un rang par mot, dans l\'ordre demandé')
    assert.equal(b.querySelector('[mjs-fx-layer]').style.getPropertyValue('--mjs-fx-stagger-c'), '3')
    assert.equal(b.querySelectorAll('[mjs-fx-cut]').length, 0)
    offB()
  })

  it('child : aucun calque, chaque enfant direct reçoit sa marque et son rang, pas de calque ni de texte copié', () => {
    const el  = boite(4)
    const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'child', on: 'click' })
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'aucun calque de texte')
    assert.equal(el.getAttribute('mjs-fx-stagger-unit'), 'child')
    assert.deepEqual(rangs(el, ':scope > [mjs-fx-child]'), [0, 1, 2, 3])
    assert.equal(el.style.getPropertyValue('--mjs-fx-stagger-c'), '4', 'le nombre d\'enfants sur la balise')
    assert.equal(el.textContent, 'k0k1k2k3', 'le texte n\'est pas copié')
    off()
  })

  it('child : order range les enfants (left, center, edges ; random est une permutation)', () => {
    const attendu: Record<string, number[]> = { left: [4, 3, 2, 1, 0], center: [2, 1, 0, 1, 2], edges: [0, 1, 2, 1, 0] }
    for (const ordre of ['left', 'center', 'edges']) {
      const el  = boite(5)
      const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'child', order: ordre, on: 'click' })
      assert.deepEqual(rangs(el, ':scope > [mjs-fx-child]'), attendu[ordre], ordre)
      off()
    }
    const el  = boite(6)
    const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'child', order: 'random', on: 'click' })
    assert.deepEqual(rangs(el, ':scope > [mjs-fx-child]').sort(), [0, 1, 2, 3, 4, 5], 'au hasard, chaque rang une fois')
    off()
  })

  it('child : un calque posé par un autre effet, un script, un style ne sont pas des enfants', () => {
    const el = doc.createElement('div')
    el.innerHTML = '<span mjs-fx-layer="goo"></span><script></script><style></style><p>a</p><p>b</p>'
    doc.body.appendChild(el)
    const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'child', on: 'click' })
    assert.deepEqual([...el.querySelectorAll('[mjs-fx-child]')].map((n: any) => n.localName), ['p', 'p'])
    off()
  })

  it('child : le pas par défaut est de 90 ms, un pas écrit l\'emporte, et il redevient quand il est effacé', () => {
    const el  = boite(3)
    const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'child', on: 'click' })
    assert.equal(el.style.getPropertyValue('--mjs-fx-stagger-sp'), '90ms')
    off()
    const ecrit    = boite(3)
    const offEcrit = µ()._mjs_fx(null, ecrit, 'stagger', { unit: 'child', step: '200ms', on: 'click' })
    assert.equal(ecrit.style.getPropertyValue('--mjs-stagger-step'), '200ms', 'la variable du pas écrit')
    assert.equal(ecrit.style.getPropertyValue('--mjs-fx-stagger-sp'), '', 'plus de défaut en ligne : la règle CSS lit le pas écrit')
    regle(ecrit, 'step', undefined)
    assert.equal(ecrit.style.getPropertyValue('--mjs-stagger-step'), '', 'le moteur a retiré la variable du pas')
    assert.equal(ecrit.style.getPropertyValue('--mjs-fx-stagger-sp'), '90ms', 'le pas effacé, le défaut de l\'unité revient')
    regle(ecrit, 'step', '50ms')
    assert.equal(ecrit.style.getPropertyValue('--mjs-stagger-step'), '50ms')
    assert.equal(ecrit.style.getPropertyValue('--mjs-fx-stagger-sp'), '')
    offEcrit()
    // la lettre et le mot gardent leurs 45 ms : rien n'est posé en ligne
    const t    = texte('un deux')
    const offT = µ()._mjs_fx(null, t, 'stagger', { unit: 'word', on: 'click' })
    assert.equal(t.style.getPropertyValue('--mjs-fx-stagger-sp'), '')
    offT()
  })

  it('child : l\'arrivée jouée, chaque enfant redevient naturel à la fin de sa propre animation (plus de marque, plus de variable, plus de style vide)', () => {
    const el  = boite(3)
    const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'child', on: 'click' })
    el.click()
    assert.ok((el.getAttribute('mjs-fx-play') ?? '').includes('stagger'), 'la marque de lecture')
    const [a, b, c] = [...el.children]
    fin(a)
    assert.deepEqual([a, b, c].map((n: any) => n.hasAttribute('mjs-fx-child')), [false, true, true], 'le premier a fini, pas les autres')
    assert.equal(a.getAttribute('style'), null, 'plus de style vide laissé sur l\'enfant de l\'auteur')
    fin(b, 'une-animation-de-l-auteur')
    assert.equal(b.hasAttribute('mjs-fx-child'), true, 'une animation qui n\'est pas celle de l\'effet ne compte pas')
    fin(b)
    fin(c)
    assert.equal(el.querySelectorAll('[mjs-fx-child]').length, 0)
    off()
  })

  it('child : un enfant venu plus tard arrive seul, à son tour — les autres ne rejouent pas', async () => {
    const el  = boite(3)
    const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'child', on: 'click' })
    // avant la première arrivée : une seule cascade pour tous
    const tot = doc.createElement('p')
    el.appendChild(tot)
    await attendre()
    assert.deepEqual(rangs(el, ':scope > [mjs-fx-child]'), [0, 1, 2, 3], 'avant l\'arrivée, la balise refait sa cascade')
    el.click()
    for (const c of [...el.children]) fin(c)
    assert.equal(el.querySelectorAll('[mjs-fx-child]').length, 0, 'l\'arrivée est finie')
    const [x, y] = [doc.createElement('p'), doc.createElement('p')]
    el.append(x, y)
    await attendre()
    assert.deepEqual([...el.children].map((n: any) => n.hasAttribute('mjs-fx-child')), [false, false, false, false, true, true], 'seuls les deux venus sont marqués')
    assert.deepEqual([x, y].map((n: any) => n.style.getPropertyValue('--mjs-fx-stagger-k')), ['0', '1'], 'ils forment leur propre cascade')
    off()
    el.append(doc.createElement('p'))
    await attendre()
    assert.equal(el.querySelectorAll('[mjs-fx-child]').length, 0, 'l\'observateur est arrêté avec l\'effet')
  })

  it('line : les mots d\'une même ligne portent le rang de leur ligne ; la largeur qui change refait les lignes sans rejouer l\'arrivée', async () => {
    const P      = window.HTMLElement.prototype
    const ancien = Object.getOwnPropertyDescriptor(P, 'offsetTop')
    let parLigne = 3
    Object.defineProperty(P, 'offsetTop', { configurable: true, get() {
      if (!this.hasAttribute('mjs-fx-word')) return 0
      const mots = [...this.parentNode.querySelectorAll('[mjs-fx-word]')]
      return Math.floor(mots.indexOf(this) / parLigne) * 24
    } })
    const rappels: any[] = []
    let coupes = 0
    window.ResizeObserver = class { constructor(f: any) { rappels.push(f) } observe() {} disconnect() { coupes++ } }
    let police: any = null
    Object.defineProperty(doc, 'fonts', { configurable: true, value: { ready: new Promise((ok) => { police = ok }) } })
    try {
      const el  = texte('un deux trois quatre cinq six sept')
      const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'line', on: 'click' })
      assert.equal(el.getAttribute('mjs-fx-stagger-unit'), 'line')
      assert.deepEqual(rangs(el, '[mjs-fx-word]'), [0, 0, 0, 1, 1, 1, 2], 'trois mots par ligne : trois lignes')
      assert.equal(el.querySelector('[mjs-fx-layer]').style.getPropertyValue('--mjs-fx-stagger-c'), '3', 'trois lignes comptées')
      assert.equal(el.style.getPropertyValue('--mjs-fx-stagger-sp'), '130ms', 'le pas d\'une ligne : 130 ms')
      assert.equal(rappels.length, 1, 'la balise est observée')
      el.click()
      const joue = el.getAttribute('mjs-fx-play')
      // la balise devient plus étroite : deux mots par ligne
      parLigne = 2
      rappels[0]([{ contentRect: { width: 200 } }])
      assert.deepEqual(rangs(el, '[mjs-fx-word]'), [0, 0, 1, 1, 2, 2, 3], 'les lignes sont refaites')
      assert.equal(el.querySelector('[mjs-fx-layer]').style.getPropertyValue('--mjs-fx-stagger-c'), '4')
      assert.equal(el.getAttribute('mjs-fx-play'), joue, 'l\'arrivée n\'est pas rejouée')
      // la même largeur : rien n'est relu
      parLigne = 1
      rappels[0]([{ contentRect: { width: 200 } }])
      assert.deepEqual(rangs(el, '[mjs-fx-word]'), [0, 0, 1, 1, 2, 2, 3], 'la largeur n\'a pas changé : les lignes non plus')
      // une police arrive tard : les lignes se relisent
      police()
      await attendre()
      assert.deepEqual(rangs(el, '[mjs-fx-word]'), [0, 1, 2, 3, 4, 5, 6], 'une ligne par mot, après l\'arrivée de la police')
      off()
      assert.equal(coupes, 1, 'l\'observateur est coupé au retrait')
      // le retrait rend la main : une police tardive ne relit plus rien
      assertAbsent(el.querySelector('[mjs-fx-layer]'))
    }
    finally {
      if (ancien) Object.defineProperty(P, 'offsetTop', ancien)
      else delete P.offsetTop
      delete window.ResizeObserver
      delete doc.fonts
    }
  })

  it('line : order range les lignes, pas les mots', () => {
    const P      = window.HTMLElement.prototype
    const ancien = Object.getOwnPropertyDescriptor(P, 'offsetTop')
    Object.defineProperty(P, 'offsetTop', { configurable: true, get() {
      if (!this.hasAttribute('mjs-fx-word')) return 0
      return Math.floor([...this.parentNode.querySelectorAll('[mjs-fx-word]')].indexOf(this) / 2) * 24
    } })
    try {
      const el  = texte('a b c d e f')
      const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'line', order: 'left', on: 'click' })
      assert.deepEqual(rangs(el, '[mjs-fx-word]'), [2, 2, 1, 1, 0, 0], 'la dernière ligne part la première')
      off()
    }
    finally {
      if (ancien) Object.defineProperty(P, 'offsetTop', ancien)
      else delete P.offsetTop
    }
  })

  it('lettre et mot : l\'arrivée finie ne change rien — pas de marque de repos, pas d\'écouteur de fin d\'animation ; le repos ne vaut que pour une ligne et un enfant', () => {
    const vrai = µ()._mjs_dom.addEventListener
    let fins: any[] = []
    µ()._mjs_dom.addEventListener = function (cible: any, type: string, ...reste: any[]) {
      if (type === 'animationend') fins.push(cible)
      return vrai.call(this, cible, type, ...reste)
    }
    try {
      for (const unite of ['letter', 'word', 'line', 'child']) {
        fins = []
        const el     = unite === 'child' ? boite(3) : texte('ab cd')
        const off    = µ()._mjs_fx(null, el, 'stagger', { unit: unite, on: 'click' })
        const marque = unite === 'child' ? ':scope > *' : unite === 'letter' ? '[mjs-fx-letter]' : '[mjs-fx-word]'
        assert.equal(fins.length, unite === 'line' || unite === 'child' ? 1 : 0, `${unite} : l'écouteur de fin d'animation n'est posé que là où un repos l'attend`)
        el.click()
        const avant = nu(el)
        el.querySelectorAll(marque).forEach((u: any) => fin(u))
        const repos = unite === 'line' || unite === 'child'
        assert.equal(el.hasAttribute('mjs-fx-stagger-rest'), unite === 'line', `${unite} : la marque du repos`)
        assert.equal(el.querySelectorAll('[mjs-fx-child]').length, 0, `${unite} : aucun enfant marqué à la fin`)
        // lettre et mot : l'arrivée finie, la balise porte exactement les marques de l'arrivée en cours
        if (!repos) assert.deepEqual(nu(el), avant, `${unite} : rien n'a changé à la fin`)
        off()
      }
    }
    finally {
      µ()._mjs_dom.addEventListener = vrai
    }
  })

  it('clip : chaque lettre, mot ou ligne (ses mots) entre dans un cache ; celui d\'une ligne est retiré quand la dernière animation finit, lettres et mots gardent le leur ; le texte reste tel quel', () => {
    for (const unite of ['letter', 'word', 'line']) {
      const el     = texte('ab cd')
      const off    = µ()._mjs_fx(null, el, 'stagger', { unit: unite, clip: true, on: 'click' })
      const marque = unite === 'letter' ? '[mjs-fx-letter]' : '[mjs-fx-word]'
      const repos  = unite === 'line'
      const n      = el.querySelectorAll(marque).length
      assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, n, `${unite} : un cache par unité`)
      assert.ok([...el.querySelectorAll(marque)].every((u: any) => u.parentNode.hasAttribute('mjs-fx-cut')), `${unite} : l'unité est dans son cache`)
      assert.equal(el.hasAttribute('mjs-fx-stagger-clip'), true, 'la marque qui choisit les images clés du cache')
      const avant = el.querySelector('[mjs-fx-layer]').textContent
      el.click()
      const unites = [...el.querySelectorAll(marque)]
      unites.slice(0, -1).forEach((u: any) => fin(u))
      assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, n, `${unite} : une unité n'a pas fini, les caches restent`)
      fin(unites[unites.length - 1])
      assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, repos ? 0 : n, `${unite} : ${repos ? 'au repos plus aucun cache' : 'pas de repos, les caches restent'}`)
      assert.equal(el.hasAttribute('mjs-fx-stagger-rest'), repos, `${unite} : la marque du repos`)
      assert.equal(el.querySelector('[mjs-fx-layer]').textContent, avant, `${unite} : le texte est le même`)
      assert.equal(el.querySelectorAll(marque).length, n, `${unite} : les unités sont toujours là`)
      // rejouée (clic) : les caches sont là (reposés pour une ligne, jamais partis pour le reste), il n'y a pas de repos
      el.click()
      assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, n, `${unite} : rejoué, les caches sont là`)
      assert.equal(el.hasAttribute('mjs-fx-stagger-rest'), false)
      off()
    }
  })

  it('clip : sans effet sur fade et blur (ni cache, ni images clés du cache) ; un composant en ligne de style zoom garde ses caches', () => {
    for (const style of ['fade', 'blur']) {
      const el  = texte('ab cd')
      const off = µ()._mjs_fx(null, el, 'stagger', { style, clip: true, on: 'click' })
      assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, 0, style)
      assert.equal(el.hasAttribute('mjs-fx-stagger-clip'), false, style)
      assert.equal(el.style.getPropertyValue('--mjs-fx-stagger-d'), '', style)
      off()
    }
    const el  = texte('ab cd')
    const off = µ()._mjs_fx(null, el, 'stagger', { style: 'zoom', clip: true, on: 'click' })
    assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, 4, 'zoom : les lettres sont rognées par leur boîte')
    assert.equal(el.hasAttribute('mjs-fx-stagger-clip'), false, 'zoom garde ses propres images clés')
    off()
  })

  it('clip : avec la distance non écrite, l\'unité part de toute sa boîte ; la distance écrite l\'emporte et la distance effacée revient', () => {
    const el  = texte('ab')
    const off = µ()._mjs_fx(null, el, 'stagger', { clip: true, on: 'click' })
    assert.equal(el.style.getPropertyValue('--mjs-fx-stagger-d'), 'calc(100% + .35em)', 'toute la boîte de la lettre, et sa marge')
    off()
    const e2   = boite(2)
    const off2 = µ()._mjs_fx(null, e2, 'stagger', { unit: 'child', clip: true, on: 'click' })
    assert.equal(e2.style.getPropertyValue('--mjs-fx-stagger-d'), '115%', 'toute la boîte de l\'enfant')
    assert.equal(e2.getAttribute('mjs-fx-stagger-clip'), '', 'la découpe de l\'enfant')
    off2()
    const e3   = texte('ab')
    const off3 = µ()._mjs_fx(null, e3, 'stagger', { clip: true, distance: 30, on: 'click' })
    assert.equal(e3.style.getPropertyValue('--mjs-stagger-distance'), '30px')
    assert.equal(e3.style.getPropertyValue('--mjs-fx-stagger-d'), '', 'la distance écrite : celle de la variable, lue par la règle CSS')
    regle(e3, 'distance', undefined)
    assert.equal(e3.style.getPropertyValue('--mjs-fx-stagger-d'), 'calc(100% + .35em)')
    regle(e3, 'distance', 12)
    assert.equal(e3.style.getPropertyValue('--mjs-stagger-distance'), '12px')
    assert.equal(e3.style.getPropertyValue('--mjs-fx-stagger-d'), '')
    off3()
  })

  it('clip : le calque partagé avec un autre effet reste, mais sans les caches de celui qui part', () => {
    const el    = texte('ab cd')
    const garde = µ()._mjs_fxLayer(null, el)
    const off   = µ()._mjs_fx(null, el, 'stagger', { clip: true, on: 'click' })
    assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, 4, 'les caches sont posés sur le calque partagé')
    off()
    assert.ok(el.querySelector('[mjs-fx-layer]') !== null, 'le calque reste pour l\'autre effet')
    assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, 0, 'mais plus un cache')
    assert.equal(el.querySelectorAll('[mjs-fx-letter]').length, 4, 'les lettres sont toujours là')
    assert.deepEqual(nu(el).filter((a: string) => a.startsWith('mjs-fx-stagger')), [])
    garde.off()
  })

  it('un texte qui change pendant l\'arrivée d\'une ligne la reprend à zéro : les fins des anciens mots ne comptent pas pour les nouveaux', async () => {
    const el  = texte('ab cd ef gh')
    const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'line', clip: true, on: 'click' })
    el.click()
    ;[...el.querySelectorAll('[mjs-fx-word]')].slice(0, 3).forEach((u: any) => fin(u))
    assert.equal(el.hasAttribute('mjs-fx-stagger-rest'), false, 'trois mots sur quatre ont fini')
    el.firstChild.data = 'ijk lm no pq rs'
    await attendre()
    const neufs = [...el.querySelectorAll('[mjs-fx-word]')]
    assert.equal(neufs.length, 5)
    neufs.slice(0, 2).forEach((u: any) => fin(u))
    assert.equal(el.hasAttribute('mjs-fx-stagger-rest'), false, 'deux mots neufs sur cinq : l\'arrivée n\'est pas finie')
    neufs.slice(2).forEach((u: any) => fin(u))
    assert.equal(el.hasAttribute('mjs-fx-stagger-rest'), true, 'les cinq ont fini')
    assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, 0)
    off()
  })

  it('un texte qui change une fois l\'arrivée finie arrive à nouveau, comme avant : lettres et mots n\'ont pas de repos à quitter, leurs caches reposés sur les unités neuves', async () => {
    for (const unite of ['letter', 'word']) {
      const el     = texte('ab cd')
      const off    = µ()._mjs_fx(null, el, 'stagger', { unit: unite, clip: true, on: 'click' })
      const marque = unite === 'letter' ? '[mjs-fx-letter]' : '[mjs-fx-word]'
      el.click()
      el.querySelectorAll(marque).forEach((u: any) => fin(u))
      const joue = el.getAttribute('mjs-fx-play')
      el.firstChild.data = 'efg hi'
      await attendre()
      const neuves = [...el.querySelectorAll(marque)]
      assert.equal(neuves.length, unite === 'letter' ? 5 : 2, `${unite} : les unités neuves`)
      assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, neuves.length, `${unite} : un cache sur chaque unité neuve`)
      assert.ok(neuves.every((u: any) => u.parentNode.hasAttribute('mjs-fx-cut')), `${unite} : chacune dans son cache`)
      assert.equal(el.getAttribute('mjs-fx-play'), joue, `${unite} : la marque de lecture est restée, la règle d'animation joue les unités neuves toute seule`)
      assert.equal(el.hasAttribute('mjs-fx-stagger-rest'), false, `${unite} : pas de repos`)
      off()
    }
  })

  it('« réduire les animations » : aucun cache posé (rien ne bouge)', () => {
    const avant = window.matchMedia
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
    try {
      const el  = texte('ab cd')
      const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'word', clip: true, on: 'click' })
      el.click()
      assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, 0)
      off()
    }
    finally {
      window.matchMedia = avant
    }
  })

  it('« réduire les animations » : les enfants redeviennent naturels dès l\'arrivée jouée, sans attendre une fin d\'animation qui ne vient pas — l\'enfant venu plus tard aussi', async () => {
    const avant = window.matchMedia
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
    try {
      const el  = boite(3)
      const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'child', on: 'click' })
      assert.equal(el.querySelectorAll('[mjs-fx-child]').length, 3, 'témoin : avant l\'arrivée, les enfants attendent leur rang')
      el.click()
      assertAbsent(el.querySelector('[mjs-fx-child]'), 'l\'arrivée jouée, plus aucune marque')
      for (const c of [...el.children]) assert.equal(c.getAttribute('style'), null, 'ni variable ni style laissés sur l\'enfant de l\'auteur')
      el.click()
      assertAbsent(el.querySelector('[mjs-fx-child]'), 'rejouée, de même')
      const neuf = doc.createElement('p')
      el.append(neuf)
      await attendre()
      assert.equal(neuf.hasAttribute('mjs-fx-child'), false, 'l\'enfant venu plus tard n\'est pas marqué')
      assert.equal(neuf.getAttribute('style'), null, 'et ne porte aucune variable')
      off()
    }
    finally {
      window.matchMedia = avant
    }
  })

  it('on: scroll : l\'avancée est écrite sur chaque unité, jamais sur la balise ; le repos au bout pour une ligne et un enfant seulement, le retour en arrière', () => {
    const vrai = µ()._mjs_fxScroll
    let pousse: any = null
    let arret = 0
    µ()._mjs_fxScroll = (_el: any, f: any) => {
      pousse = f
      return () => { arret++ }
    }
    try {
      for (const unite of ['letter', 'word', 'line', 'child']) {
        const el  = unite === 'child' ? boite(3) : texte('ab cd')
        const off = µ()._mjs_fx(null, el, 'stagger', { unit: unite, clip: unite !== 'child', on: 'scroll' })
        assert.equal(el.hasAttribute('mjs-fx-stagger-scroll'), true, unite)
        const marque = unite === 'child' ? ':scope > [mjs-fx-child]' : unite === 'letter' ? '[mjs-fx-letter]' : '[mjs-fx-word]'
        const lit = () => [...el.querySelectorAll(marque)].map((u: any) => u.style.getPropertyValue('--mjs-fx-stagger-p'))
        pousse(0.3)
        assert.equal(el.style.getPropertyValue('--mjs-fx-stagger-p'), '', `${unite} : rien n'est écrit sur la balise`)
        assert.ok(lit().length > 0 && lit().every((v: string) => v === '0.3'), `${unite} : l'avancée est écrite sur chaque unité`)
        pousse(0.6)
        assert.ok(lit().every((v: string) => v === '0.6'), `${unite} : et suit l'avancée`)
        assert.equal(el.style.getPropertyValue('--mjs-fx-stagger-p'), '', `${unite} : toujours rien sur la balise`)
        assert.equal(el.hasAttribute('mjs-fx-stagger-rest'), false, `${unite} : l'arrivée n'est pas au bout`)
        const caches = unite === 'letter' ? 4 : 2
        pousse(1)
        if (unite === 'child') assert.equal(el.querySelectorAll('[mjs-fx-child]').length, 0, 'child : au bout, les enfants sont naturels')
        else if (unite === 'line') {
          assert.equal(el.hasAttribute('mjs-fx-stagger-rest'), true, 'line : au bout, le repos')
          assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, 0, 'line : et plus de cache')
        }
        else {
          assert.equal(el.hasAttribute('mjs-fx-stagger-rest'), false, `${unite} : pas de repos, comme avant — au bout l'animation reste posée`)
          assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, caches, `${unite} : et les caches restent`)
        }
        pousse(0.4)
        if (unite === 'child') assert.equal(el.querySelectorAll('[mjs-fx-child]').length, 3, 'child : en remontant, les enfants reviennent à la cascade')
        else {
          assert.equal(el.hasAttribute('mjs-fx-stagger-rest'), false, `${unite} : en remontant, pas de repos`)
          assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, caches, `${unite} : les caches sont là`)
        }
        off()
      }
      assert.equal(arret, 4, 'chaque suivi du défilement est arrêté au retrait')
    }
    finally {
      µ()._mjs_fxScroll = vrai
    }
  })

  it('on: scroll : les unités neuves — texte refait, enfant venu plus tard — reçoivent l\'avancée d\'aujourd\'hui', async () => {
    const vrai = µ()._mjs_fxScroll
    let pousse: any = null
    µ()._mjs_fxScroll = (_el: any, f: any) => {
      pousse = f
      return () => {}
    }
    try {
      for (const unite of ['letter', 'word', 'line']) {
        const el  = texte('ab cd')
        const off = µ()._mjs_fx(null, el, 'stagger', { unit: unite, on: 'scroll' })
        pousse(0.4)
        el.firstChild.data = 'efg hi jk'
        await attendre()
        const neuves = [...el.querySelectorAll(unite === 'letter' ? '[mjs-fx-letter]' : '[mjs-fx-word]')]
        assert.equal(neuves.length, unite === 'letter' ? 7 : 3, `${unite} : les unités neuves sont posées`)
        assert.ok(neuves.every((u: any) => u.style.getPropertyValue('--mjs-fx-stagger-p') === '0.4'), `${unite} : chaque unité neuve porte l'avancée d'aujourd'hui`)
        pousse(0.7)
        assert.ok(neuves.every((u: any) => u.style.getPropertyValue('--mjs-fx-stagger-p') === '0.7'), `${unite} : et la suit ensuite`)
        off()
      }
      // les enfants : celui qui vient en pleine arrivée refait la cascade de tous, il porte l'avancée comme les autres
      const el  = boite(3)
      const off = µ()._mjs_fx(null, el, 'stagger', { unit: 'child', on: 'scroll' })
      pousse(0.4)
      const venu = doc.createElement('p')
      el.append(venu)
      await attendre()
      assert.deepEqual([...el.children].map((n: any) => n.style.getPropertyValue('--mjs-fx-stagger-p')), ['0.4', '0.4', '0.4', '0.4'], 'child : l\'enfant venu plus tard porte l\'avancée d\'aujourd\'hui')
      off()
    }
    finally {
      µ()._mjs_fxScroll = vrai
    }
  })

  it('on: scroll : l\'avancée n\'est écrite que si elle change — rien hors de l\'arrivée, rien deux fois, tout de suite sur les unités neuves', async () => {
    const vrai = µ()._mjs_fxScroll
    let pousse: any = null
    µ()._mjs_fxScroll = (_el: any, f: any) => {
      pousse = f
      return () => {}
    }
    // chaque écriture de l'avancée sur une unité, comptée à la source
    const proto = window.CSSStyleDeclaration.prototype
    const ecrire = proto.setProperty
    let ecrites = 0
    proto.setProperty = function (this: any, nom: string, ...reste: any[]) {
      if (nom === '--mjs-fx-stagger-p') ecrites++
      return ecrire.call(this, nom, ...reste)
    }
    try {
      for (const unite of ['letter', 'word', 'line', 'child']) {
        const el  = unite === 'child' ? boite(3) : texte('ab cd')
        const off = µ()._mjs_fx(null, el, 'stagger', { unit: unite, on: 'scroll' })
        const unites = unite === 'child' ? 3 : unite === 'letter' ? 4 : 2
        const compte = (f: () => void) => {
          ecrites = 0
          f()
          return ecrites
        }
        assert.equal(compte(() => { pousse(0); pousse(0); pousse(0) }), 0, `${unite} : avant l'arrivée, rien n'est écrit`)
        assert.equal(compte(() => pousse(0.3)), unites, `${unite} : l'avancée qui change est écrite une fois par unité`)
        assert.equal(compte(() => { pousse(0.3); pousse(0.3) }), 0, `${unite} : la même avancée n'est pas réécrite`)
        assert.equal(compte(() => pousse(0.6)), unites, `${unite} : une avancée qui change l'est`)
        // au bout : lettres et mots posent leur état d'arrivée finie une fois ; au repos (lignes, enfants) rien n'est écrit — l'enfant démarqué n'a plus ni variable ni style
        const repos = unite === 'line' || unite === 'child'
        assert.equal(compte(() => { pousse(1); pousse(1); pousse(1) }), repos ? 0 : unites, `${unite} : au bout, ${repos ? 'au repos rien n\'est écrit' : 'l\'état d\'arrivée finie est écrit une fois'}`)
        if (unite === 'child') assertAbsent(el.querySelector('[style]'), 'child : démarqués, les enfants n\'ont plus de style')
        // revenue en arrière : l'arrivée reprend, avec l'avancée d'aujourd'hui
        assert.equal(compte(() => pousse(0.5)), unites, `${unite} : en remontant, l'avancée est écrite à nouveau`)
        assert.equal(compte(() => { pousse(0.5); pousse(0.5) }), 0, `${unite} : une fois`)
        off()
      }
    }
    finally {
      proto.setProperty = ecrire
      µ()._mjs_fxScroll = vrai
    }
  })

  it('on: scroll : le retrait en pleine arrivée ne laisse ni l\'avancée sur les unités d\'un calque partagé, ni la marque de calque d\'une ligne ou d\'un enfant', () => {
    const vrai = µ()._mjs_fxScroll
    let pousse: any = null
    µ()._mjs_fxScroll = (_el: any, f: any) => {
      pousse = f
      return () => {}
    }
    try {
      for (const unite of ['letter', 'word', 'line', 'child']) {
        const el     = unite === 'child' ? boite(3) : texte('ab cd')
        // le calque est gardé par un autre effet : ses lettres et ses mots survivent au retrait
        const garde  = unite === 'child' ? null : µ()._mjs_fxLayer(null, el)
        const off    = µ()._mjs_fx(null, el, 'stagger', { unit: unite, on: 'scroll' })
        const marque = unite === 'child' ? ':scope > [mjs-fx-child]' : unite === 'letter' ? '[mjs-fx-letter]' : '[mjs-fx-word]'
        pousse(0.4)
        const unites = [...el.querySelectorAll(marque)]
        assert.ok(unites.length > 0 && unites.every((u: any) => u.style.getPropertyValue('--mjs-fx-stagger-p') === '0.4'), `${unite} : l'avancée est posée`)
        if (unite === 'line' || unite === 'child') assert.equal(el.hasAttribute('mjs-fx-stagger-live'), true, `${unite} : pendant l'arrivée, la marque de calque`)
        off()
        assert.equal(el.hasAttribute('mjs-fx-stagger-live'), false, `${unite} : la marque de calque est retirée`)
        assert.ok(unites.every((u: any) => u.style.getPropertyValue('--mjs-fx-stagger-p') === ''), `${unite} : l'avancée est retirée des unités`)
        if (garde) garde.off()
      }
    }
    finally {
      µ()._mjs_fxScroll = vrai
    }
  })

  it('on: scroll : le calque d\'un mot de ligne ou d\'un enfant suit SA propre arrivée (début, fin, annulation), repart au repos et au retrait', () => {
    const vrai = µ()._mjs_fxScroll
    let pousse: any = null
    µ()._mjs_fxScroll = (_el: any, f: any) => {
      pousse = f
      return () => {}
    }
    const evt = (cible: any, type: string, nom = 'mjs-fx-stagger-move') => {
      const e = new window.Event(type, { bubbles: true })
      ;(e as any).animationName = nom
      cible.dispatchEvent(e)
    }
    try {
      for (const unite of ['line', 'child']) {
        const el     = unite === 'child' ? boite(3) : texte('ab cd ef')
        // le calque est gardé par un autre effet : ses mots survivent au retrait de celui-ci
        const garde  = unite === 'child' ? null : µ()._mjs_fxLayer(null, el)
        const off    = µ()._mjs_fx(null, el, 'stagger', { unit: unite, on: 'scroll' })
        const unites = [...el.querySelectorAll(unite === 'child' ? ':scope > [mjs-fx-child]' : '[mjs-fx-word]')]
        const marque = () => unites.map((u: any) => u.hasAttribute('mjs-fx-stagger-now'))
        pousse(0.4)
        assert.deepEqual(marque(), [false, false, false], `${unite} : avant son tour, aucune unité n'a de calque`)
        evt(unites[0], 'animationstart')
        evt(unites[1], 'animationstart')
        assert.deepEqual(marque(), [true, true, false], `${unite} : le début de sa propre animation lui donne son calque`)
        evt(unites[0], 'animationend')
        assert.deepEqual(marque(), [false, true, false], `${unite} : la fin de sa propre animation le lui retire, les autres le gardent`)
        evt(unites[1], 'animationcancel')
        assert.deepEqual(marque(), [false, false, false], `${unite} : une animation annulée aussi`)
        evt(unites[2], 'animationstart', 'une-animation-de-l-auteur')
        assert.deepEqual(marque(), [false, false, false], `${unite} : l'animation d'un autre ne compte pas`)
        // au repos (l'avancée au bout) : plus aucune unité n'a de calque
        evt(unites[0], 'animationstart')
        evt(unites[2], 'animationstart')
        pousse(1)
        assert.deepEqual(marque(), [false, false, false], `${unite} : au repos, plus de marque de calque`)
        // retrait en pleine arrivée : rien ne reste
        pousse(0.4)
        evt(unites[1], 'animationstart')
        assert.equal(marque().filter(Boolean).length, 1, `${unite} : l'arrivée a repris`)
        off()
        assert.deepEqual(marque(), [false, false, false], `${unite} : le retrait ne laisse aucune marque de calque`)
        evt(unites[0], 'animationstart')
        assert.deepEqual(marque(), [false, false, false], `${unite} : et l'écoute des animations est retirée`)
        if (garde) garde.off()
      }
    }
    finally {
      µ()._mjs_fxScroll = vrai
    }
  })

  it('le pas régulier du défilement vaut pour une ligne et un enfant comme pour un mot ; un pas écrit le remplace', () => {
    const vrai = µ()._mjs_fxScroll
    µ()._mjs_fxScroll = () => () => {}
    try {
      for (const unite of ['line', 'child']) {
        const el  = unite === 'child' ? boite(3) : texte('ab cd')
        const off = µ()._mjs_fx(null, el, 'stagger', { unit: unite, on: 'scroll' })
        assert.equal(lue(el, '--mjs-fx-stagger-st'), 'var(--mjs-stagger-duration,500ms)', `${unite} : sans pas écrit, une unité après l'autre`)
        assert.equal(el.style.getPropertyValue('--mjs-fx-stagger-ease'), 'linear')
        regle(el, 'step', '80ms')
        assert.equal(el.style.getPropertyValue('--mjs-fx-stagger-st'), '', `${unite} : le pas écrit s'applique`)
        regle(el, 'step', undefined)
        assert.equal(lue(el, '--mjs-fx-stagger-st'), 'var(--mjs-stagger-duration,500ms)', `${unite} : le pas effacé, le pas régulier revient`)
        off()
      }
    }
    finally {
      µ()._mjs_fxScroll = vrai
    }
  })

  it('retrait : chaque unité, avec ou sans cache, ne laisse ni marque, ni variable, ni calque, ni observateur, ni style sur les enfants', async () => {
    const reglages: Array<[string, any]> = [
      ['letter', { on: 'click' }], ['letter', { on: 'click', clip: true }], ['word', { on: 'click', clip: true, order: 'center', style: 'flip' }],
      ['line', { on: 'click', clip: true, opacity: 0.2 }], ['child', { on: 'click', style: 'blur' }], ['child', { on: 'click', clip: true, direction: 'right', distance: 20 }]
    ]
    for (const [unite, s] of reglages) {
      const el  = unite === 'child' ? boite(3) : texte('ab cd ef')
      const off = µ()._mjs_fx(null, el, 'stagger', { unit: unite, ...s })
      el.click()
      off()
      assert.deepEqual(nu(el), [], `${unite} ${JSON.stringify(s)} : attributs restés`)
      assert.deepEqual(vars(el), [], `${unite} ${JSON.stringify(s)} : variables restées`)
      assert.equal(el.getAttribute('style') ?? '', '', `${unite} ${JSON.stringify(s)} : style resté sur la balise`)
      assertAbsent(el.querySelector('[mjs-fx-layer]'))
      assertAbsent(el.querySelector('[mjs-fx-cut]'))
      assertAbsent(el.querySelector('[mjs-fx-child]'))
      for (const c of [...el.children]) assert.equal(c.getAttribute('style'), null, `${unite} : un style resté sur un enfant de l'auteur`)
      el.append(doc.createElement('p'))
      await attendre()
      assertAbsent(el.querySelector('[mjs-fx-child]'), `${unite} : plus rien n'observe les enfants`)
    }
  })

  it('un réglage qui change l\'unité ou le cache relance l\'effet (le moteur le repose) ; le pas et la distance se suivent sur place', () => {
    const el = boite(2)
    µ()._mjs_fx(null, el, 'stagger', { unit: 'child', on: 'click' })
    const enfant = el.firstElementChild
    regle(el, 'step', '100ms')
    regle(el, 'distance', 10)
    assert.equal(el.getAttribute('mjs-fx-stagger-unit'), 'child', 'le pas et la distance se suivent sans reposer l\'effet')
    assert.equal(enfant.hasAttribute('mjs-fx-child'), true)
    regle(el, 'unit', 'line')
    assert.equal(el.getAttribute('mjs-fx-stagger-unit'), 'line', 'unit : l\'effet est reposé')
    assert.equal(el.querySelectorAll('[mjs-fx-child]').length, 0, 'les enfants sont rendus tels quels')
    assert.equal(enfant.getAttribute('style'), null)
    assert.ok(el.querySelector('[mjs-fx-layer]') !== null, 'le texte a son calque')
    assert.equal(el.querySelectorAll('[mjs-fx-cut]').length, 0)
    regle(el, 'clip', true)
    assert.ok(el.querySelectorAll('[mjs-fx-cut]').length > 0, 'clip : l\'effet est reposé avec ses caches')
    regle(el, 'unit', 'child')
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'de retour aux enfants : le calque est retiré')
    assertAbsent(el.querySelector('[mjs-fx-cut]'))
    µ()._mjs_fxClear(el)
    assert.deepEqual(nu(el), [])
  })

  it('le catalogue : unit accepte line et child, clip est un booléen, les valeurs par défaut n\'ont pas bougé', () => {
    const s = EFFECTS.stagger.settings
    assert.equal(s.unit.dflt, 'letter')
    assert.match(s.unit.rule, /'letter' \| 'word' \| 'line' \| 'child'/)
    assert.equal(s.clip.rule, 'bool')
    assert.equal(s.clip.dflt, false)
    assert.equal(s.step.dflt, '45ms', 'le catalogue affiche toujours 45 ms (une ligne et un enfant prennent leur pas dans le fichier)')
    assert.deepEqual(parseEffect('stagger', 'unit: child, clip: true, step: 100ms').fixed, { unit: 'child', clip: true, step: '100ms' })
    assert.deepEqual(parseEffect('stagger', 'unit: line').fixed, { unit: 'line' })
    assert.throws(() => parseEffect('stagger', 'unit: row'), /unit = row/)
    assert.throws(() => parseEffect('stagger', 'clip: oui'), /clip = oui/)
  })
})
