// *shatter pose ses tuiles sur un calque, juste avant la balise, dans son parent : ni le bloc {if}
// ni la destruction du nœud ne le connaissent. À la fin d'une sortie (`@out=*shatter`), à l'arrêt de
// l'effet posé directement (retrait, relance par une variable de réglage), le calque doit partir
// et la balise redevenir visible — sinon ses tuiles restent à l'écran, éparpillées. happy-dom ne
// calcule aucune mise en page : la taille de l'image est simulée. Les classes d'éléments de happy-dom sont partagées
// par toutes ses fenêtres : ce que ce fichier y remplace (la taille d'une image, l'animation) est rendu à la fin, un
// autre fichier lancé ensuite ne doit pas y voir ses tailles.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'eclats-sortie': '<script>\n$vu = true\n</script>\n<div class="box">{if $vu}<img class="i" src="x.png" alt="" @out=*shatter(size: 20, duration: 60ms)>{end}</div>',
  'eclats-aller-retour': '<script>\n$vu = true\n</script>\n<div class="box">{if $vu}<img class="i" src="x.png" alt="" @transition=*shatter(size: 20, duration: 60ms)>{end}</div>',
  'eclats-relance': '<script>\n$s = 20\n</script>\n<div class="box"><img class="j" src="x.png" alt="" *shatter(size: $s, on: load, duration: 400ms)></div>',
  'eclats-attente': '<script>\n$s = 20\n</script>\n<div class="box"><img class="k" src="x.png" alt="" *shatter(size: $s, on: view, duration: 60ms)></div>',
  'eclats-defile': '<div class="box"><img class="d" src="x.png" alt="" *shatter(on: scroll, range: 0 1000px)></div>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// les mesures de mise en page de happy-dom telles qu'elles étaient avant la simulation (descripteurs propres du prototype)
const mesuresAvant: { largeur?: PropertyDescriptor, hauteur?: PropertyDescriptor } = {}

describe('*shatter : le calque des tuiles ne survit ni à la sortie ni à l\'arrêt de l\'effet', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any

  before(async () => {
    const root   = mjsTmp('eclats-calque')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    // une horloge à elle : happy-dom date ses images par l'objet `performance` de Node, qu'un autre
    // fichier de la même exécution peut remplacer (tests/transition-tick-abort-resolves.test.ts)
    const h0 = process.hrtime.bigint()
    window.performance = { now: () => Number(process.hrtime.bigint() - h0) / 1e6, timeOrigin: Date.now() }
    // une image de 60 × 40 : trois colonnes, deux rangées de tuiles de 20 px
    mesuresAvant.largeur = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetWidth')
    mesuresAvant.hauteur = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.localName === 'img' ? 60 : 0 } })
    Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.localName === 'img' ? 40 : 0 } })
    // un observateur d'intersection qui ne voit jamais rien : la balise attend, cachée
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
    // des animations Web minimales (la pose directe les exige ; *shatter, lui, joue image par image)
    animateAvant = window.Element.prototype.animate
    window.Element.prototype.animate = function () {
      let fin: any
      const a: any = { finished: new Promise((r) => { fin = r }), cancel() { fin(a) }, pause() {}, play() {}, finish() { fin(a) }, effect: { getComputedTiming: () => ({ progress: 1 }) } }
      setTimeout(() => fin(a), 5)
      return a
    }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    if (animateAvant === undefined) delete window?.Element?.prototype?.animate
    else if (window) window.Element.prototype.animate = animateAvant
    // les mesures de happy-dom : leurs descripteurs d'origine, ou plus rien si le prototype n'en avait pas
    for (const [nom, descripteur] of [['offsetWidth', mesuresAvant.largeur], ['offsetHeight', mesuresAvant.hauteur]] as const) {
      if (!window) break
      if (descripteur) Object.defineProperty(window.HTMLElement.prototype, nom, descripteur)
      else delete window.HTMLElement.prototype[nom]
    }
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.box'))
    await new Promise((r) => setTimeout(r, 20))
    return comp
  }

  // les calques de tuiles restés dans la boîte
  const calques = (comp: any) => comp._shadow.querySelectorAll('.box > span[aria-hidden="true"]').length

  it('@out=*shatter : après la sortie, plus aucun calque de tuiles dans le parent', async () => {
    const comp = await monter('mjs-eclats-sortie')
    assert.ok(comp._shadow.querySelector('.i'), 'l\'image est là')
    comp._set('vu', false)
    await attendre(() => !comp._shadow.querySelector('.i'))
    assert.equal(!!comp._shadow.querySelector('.i'), false, 'l\'image est partie')
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(calques(comp), 0)
  })

  it('@transition=*shatter : sortie puis entrée, l\'image revient visible, sans calque', async () => {
    const comp = await monter('mjs-eclats-aller-retour')
    comp._set('vu', false)
    await attendre(() => !comp._shadow.querySelector('.i'))
    comp._set('vu', true)
    await attendre(() => !!comp._shadow.querySelector('.i'))
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(calques(comp), 0)
    assert.equal(comp._shadow.querySelector('.i').style.visibility, '')
  })

  it('posé directement, relancé en plein jeu par sa variable : l\'ancien calque part, un seul jeu en mémoire', async () => {
    const comp = await monter('mjs-eclats-relance')
    const j    = comp._shadow.querySelector('.j')
    await attendre(() => calques(comp) > 0, 1000)
    assert.equal(calques(comp), 1, 'le calque du premier jeu')
    comp._set('s', 30)
    await new Promise((r) => setTimeout(r, 60))
    comp._set('s', 40)
    await new Promise((r) => setTimeout(r, 800))
    assert.equal(calques(comp), 0, 'aucun calque après la fin du dernier jeu')
    assert.equal(j.style.visibility, '')
    assert.ok((j._mjs_tick_cfgs ? j._mjs_tick_cfgs.size : 0) <= 1, 'les jeux arrêtés ne restent pas en mémoire')
  })

  it('posé directement, en attente de l\'écran puis relancé : un calque au plus, l\'image rendue au retrait', async () => {
    const comp = await monter('mjs-eclats-attente')
    const k    = comp._shadow.querySelector('.k')
    comp._set('s', 30)
    await new Promise((r) => setTimeout(r, 20))
    comp._set('s', 40)
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(calques(comp), 0, 'en attente de l\'écran, à t = 0 : aucun calque, l\'image seulement cachée')
    assert.equal(k.style.visibility, 'hidden', 'l\'image attend, cachée')
    assert.ok((k._mjs_tick_cfgs ? k._mjs_tick_cfgs.size : 0) <= 1, 'les jeux arrêtés ne restent pas en mémoire')
    k._mjs_fxOff.shatter()
    assert.equal(calques(comp), 0, 'l\'effet retiré : plus de calque')
    assert.equal(k.style.visibility, '', 'l\'effet retiré : l\'image visible')
  })

  it('au défilement (on: scroll), puis retiré : l\'image rendue, sans calque', async () => {
    const comp = await monter('mjs-eclats-defile')
    const d    = comp._shadow.querySelector('.d')
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(d.style.visibility, 'hidden', 'en haut de la page, l\'image est encore éclatée')
    d._mjs_fxOff.shatter()
    assert.equal(calques(comp), 0, 'l\'effet retiré : plus de calque')
    assert.equal(d.style.visibility, '', 'l\'effet retiré : l\'image visible')
  })
})

describe('*shatter : ce que le fichier a remplacé dans happy-dom est rendu', function () {
  it('la taille des éléments redevient celle de happy-dom, pour toute fenêtre ouverte ensuite', () => {
    const autre: any = new Window({ url: 'http://localhost/' })
    try {
      const proto = autre.HTMLElement.prototype
      assert.ok(mesuresAvant.largeur && mesuresAvant.hauteur, 'les mesures d\'origine ont été relevées avant la simulation')
      assert.equal(Object.getOwnPropertyDescriptor(proto, 'offsetWidth')?.get === mesuresAvant.largeur!.get, true, 'offsetWidth est celui de happy-dom')
      assert.equal(Object.getOwnPropertyDescriptor(proto, 'offsetHeight')?.get === mesuresAvant.hauteur!.get, true, 'offsetHeight est celui de happy-dom')
      assert.equal(autre.document.createElement('img').offsetWidth, 0, 'une image sans mise en page n\'a pas de largeur')
    } finally {
      autre.close()
    }
  })
})
