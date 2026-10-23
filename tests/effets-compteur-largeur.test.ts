// *count : la place du nombre se mesure dans une balise qui a une boîte. Posé dans un composant encore
// masqué au premier rendu (ou dans un onglet fermé), l'effet ne trouve aucune boîte : la mesure ne rend
// rien, et sans reprise la balise garde la largeur du nombre brut (`12480`), le nombre mis en forme
// (`12 480 €`) déborde sur la suite. La place est donc reprise dès que la balise a une boîte — un
// ResizeObserver, armé seulement quand il n'y en a pas, débranché dès qu'il a servi et au retrait. Son
// premier avis arrive toujours, balise masquée et taille nulle (Chromium, Firefox et WebKit) : sans boîte,
// l'avis ne mesure rien et ne relance rien — un observateur armé de nouveau à chaque avis tournerait à
// chaque image tant que la balise est masquée. Quand la boîte vient, la place est mesurée et écrite à l'image suivante,
// jamais dans l'avis de l'observateur : elle y changerait la boîte de la balise et celle d'un parent qu'un observateur
// de la page suit, et le navigateur signalerait « ResizeObserver loop » ; l'image en attente est annulée au retrait.
// happy-dom ne met rien en page : la boîte et les avis de l'observateur sont joués ; la largeur elle-même
// se voit au banc navigateur (effets-compteur-largeur-browser.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const dort = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*count — la place du nombre attend la boîte de sa balise', function () {
  this.timeout(60000)
  let window: any
  let rendreRects: (() => void) | undefined

  // un observateur de taille espion : ce qu'il observe, son rappel, s'il est débranché
  type Espion = { vus: any[], rappel: () => void, coupe: boolean }
  const observateurs: Espion[] = []
  // la boîte de la balise : `getClientRects` rend une liste vide tant qu'elle manque
  // `apres` : la boîte vient au n-ième appel (un hôte qui se montre entre la pose et le micro-tâche qui la suit)
  const etat = { boite: true, apres: 0 }
  // les images d'animation demandées à la fenêtre, et celles qu'on annule
  const images = { demandes: [] as number[], annulees: [] as number[] }

  before(async () => {
    const root   = mjsTmp('effets-compteur-largeur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-compte.mjs'), '<b class="n" *count(on: load)>12480</b>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.ResizeObserver = class {
      espion: Espion
      constructor(rappel: () => void) {
        this.espion = { vus: [], rappel, coupe: false }
        observateurs.push(this.espion)
      }
      observe(el: any) { this.espion.vus.push(el) }
      unobserve() {}
      disconnect() { this.espion.coupe = true }
    }
    const demande = window.requestAnimationFrame.bind(window)
    const annule  = window.cancelAnimationFrame.bind(window)
    window.requestAnimationFrame = (f: any) => { const h = demande(f); images.demandes.push(h); return h }
    window.cancelAnimationFrame  = (h: number) => { images.annulees.push(h); return annule(h) }
    // le prototype des éléments est celui de toutes les fenêtres de happy-dom : la mesure y est rendue telle qu'elle était à la fin du groupe
    const proto = window.Element.prototype
    const avant = Object.getOwnPropertyDescriptor(proto, 'getClientRects')
    rendreRects = () => {
      if (avant) Object.defineProperty(proto, 'getClientRects', avant)
      else delete proto.getClientRects
    }
    proto.getClientRects = function () {
      if (etat.apres && --etat.apres === 0) etat.boite = true
      return etat.boite ? [{ left: 0, top: 0, width: 10, height: 10 }] : []
    }
  })

  after(async () => {
    rendreRects?.()
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // la balise posée, avec ou sans boîte ; chaque mesure de la place est comptée
  async function pose(boite: boolean, apres = 0) {
    etat.boite = boite
    etat.apres = apres
    observateurs.length = 0
    const mesures = { n: 0 }
    const avant   = window.µ._mjs_fxNumWidth
    window.µ._mjs_fxNumWidth = function (this: any, ...a: any[]) { mesures.n++; return avant.apply(this, a) }
    window.document.body.innerHTML = '<mjs-fx-compte></mjs-fx-compte>'
    const comp = window.document.querySelector('mjs-fx-compte')
    await attendre(() => !!comp._shadow?.querySelector('.n [mjs-fx-layer="text"]'))
    await dort(30)
    return { n: comp._shadow.querySelector('.n'), mesures, rend: () => { window.µ._mjs_fxNumWidth = avant } }
  }
  const attentes = (n: any) => observateurs.filter((o) => o.vus.includes(n))

  it('sans boîte à la pose : un observateur attend la balise, et la place est reprise quand elle en a une', async () => {
    const { n, mesures, rend } = await pose(false)
    try {
      assert.ok(mesures.n >= 1, 'la pose mesure la place')
      assert.equal(attentes(n).length, 1, 'un observateur attend la boîte de la balise')
      assert.equal(attentes(n)[0].coupe, false, 'il attend')
      const m0 = mesures.n
      const d0 = images.demandes.length
      etat.boite = true
      attentes(n)[0].rappel()
      assert.equal(mesures.n, m0, 'la place ne se mesure pas dans l\'avis de l\'observateur')
      assert.equal(n.style.minWidth, '', 'et ne s\'écrit pas dans l\'avis')
      assert.equal(images.demandes.length, d0 + 1, 'elle est demandée à l\'image suivante')
      await dort(80)
      assert.equal(mesures.n, m0 + 1, 'la boîte est là : la place est reprise à l\'image suivante')
      assert.equal(attentes(n)[0].coupe, true, 'l\'observateur est débranché une fois servi')
      assert.equal(attentes(n).length, 1, 'aucun autre n\'attend')
    }
    finally {
      rend()
    }
  })

  it('un avis sans boîte (le premier, balise masquée) ne mesure rien et ne relance rien ; une police qui arrive pendant l\'attente reprend la mesure sans autre observateur', async () => {
    const polices: any = new window.EventTarget()
    polices.ready = Promise.resolve()
    Object.defineProperty(window.document, 'fonts', { value: polices, configurable: true })
    const { n, mesures, rend } = await pose(false)
    try {
      assert.equal(attentes(n).length, 1)
      // le premier avis d'un observateur arrive balise masquée, taille nulle : ni mesure, ni autre observateur, il attend toujours
      const m0 = mesures.n
      attentes(n)[0].rappel()
      attentes(n)[0].rappel()
      assert.equal(mesures.n, m0, 'un avis sans boîte ne mesure rien')
      assert.equal(attentes(n).length, 1, 'aucun observateur de plus')
      assert.equal(attentes(n)[0].coupe, false, 'il attend toujours')
      // une police arrive, la balise n'a toujours pas de boîte : la mesure est reprise, l'attente reste la même
      polices.dispatchEvent(new window.Event('loadingdone'))
      assert.equal(mesures.n, m0 + 1, 'la police fait reprendre la mesure')
      assert.equal(attentes(n).length, 1, 'toujours un seul observateur pour la balise')
      assert.equal(attentes(n)[0].coupe, false)
      // la boîte vient : l'avis mesure, débranche, et plus rien n'attend
      etat.boite = true
      attentes(n)[0].rappel()
      assert.equal(mesures.n, m0 + 1, 'la boîte est là : la place attend l\'image suivante')
      await dort(80)
      assert.equal(mesures.n, m0 + 2, 'la boîte est là : la place est prise')
      assert.equal(attentes(n)[0].coupe, true)
      assert.equal(attentes(n).length, 1, 'aucun observateur neuf : la balise a sa boîte')
    }
    finally {
      rend()
    }
  })

  it('l\'hôte se montre juste après la pose (le micro-tâche qui suit le premier rendu) : la place est reprise sans avis ni image, et l\'observateur encore armé est débranché sans avoir servi', async () => {
    const { n, mesures, rend } = await pose(false, 2)
    try {
      assert.equal(attentes(n).length, 1, 'la pose sans boîte arme un observateur')
      const d0 = images.demandes.length
      // un navigateur ne livre rien à un observateur débranché : seuls les avis des observateurs encore branchés arrivent
      for (const o of attentes(n)) if (!o.coupe) o.rappel()
      const demandees = images.demandes.length - d0
      await dort(80)
      assert.equal(mesures.n, 2, 'la pose et le micro-tâche mesurent la place, avant toute image, et pas une troisième fois')
      assert.equal(demandees, 0, 'aucune image demandée : le premier avis ne redemande rien')
      assert.equal(attentes(n)[0].coupe, true, 'la mesure du micro-tâche a trouvé une boîte : l\'observateur est débranché')
      assert.equal(attentes(n).length, 1, 'aucun autre n\'attend')
    }
    finally {
      rend()
    }
  })

  it('une balise qui perd sa boîte après l\'avoir eue au micro-tâche (la zone est cachée de nouveau) : une mesure sans boîte arme un observateur neuf, qui reprend la place quand la boîte revient', async () => {
    const polices: any = new window.EventTarget()
    polices.ready = Promise.resolve()
    Object.defineProperty(window.document, 'fonts', { value: polices, configurable: true })
    const { n, mesures, rend } = await pose(false, 2)
    try {
      assert.equal(attentes(n).length, 1, 'la pose sans boîte arme un observateur')
      assert.equal(attentes(n)[0].coupe, true, 'la mesure du micro-tâche a trouvé une boîte : l\'observateur de la pose est débranché')
      // la zone est cachée de nouveau, puis une police arrive : la mesure ne trouve plus de boîte
      etat.boite = false
      const m0 = mesures.n
      polices.dispatchEvent(new window.Event('loadingdone'))
      assert.equal(mesures.n, m0 + 1, 'la police fait reprendre la mesure')
      assert.equal(attentes(n).length, 2, 'la balise n\'a plus de boîte : un observateur neuf l\'attend, celui qui a été débranché n\'est pas pris pour lui')
      assert.equal(attentes(n)[1].coupe, false, 'il attend')
      // la boîte revient : la place est reprise à l'image suivante et l'observateur neuf est débranché
      etat.boite = true
      attentes(n)[1].rappel()
      await dort(80)
      assert.equal(mesures.n, m0 + 2, 'la boîte est là : la place est reprise à l\'image suivante')
      assert.equal(attentes(n)[1].coupe, true, 'l\'observateur neuf est débranché une fois servi')
      assert.equal(attentes(n).length, 2, 'aucun autre n\'attend')
    }
    finally {
      rend()
    }
  })

  it('une balise qui a sa boîte dès la pose : aucun observateur, rien ne reste à attendre', async () => {
    const { n, rend } = await pose(true)
    try {
      assert.equal(attentes(n).length, 0)
    }
    finally {
      rend()
    }
  })

  it('retiré entre l\'avis et l\'image suivante : l\'image en attente est annulée, rien ne se mesure ni ne s\'écrit', async () => {
    const { n, mesures, rend } = await pose(false)
    try {
      const m0 = mesures.n
      const d0 = images.demandes.length
      etat.boite = true
      attentes(n)[0].rappel()
      assert.equal(images.demandes.length, d0 + 1)
      const attendue = images.demandes[d0]
      window.document.body.innerHTML = ''
      await dort(80)
      assert.ok(images.annulees.includes(attendue), 'le retrait annule l\'image en attente')
      assert.equal(mesures.n, m0, 'et la place n\'est pas mesurée')
      assert.equal(n.style.minWidth, '', 'ni écrite')
    }
    finally {
      rend()
    }
  })

  it('retiré avant que la boîte vienne : l\'observateur est débranché, un avis tardif ne mesure rien', async () => {
    const { n, mesures, rend } = await pose(false)
    try {
      assert.equal(attentes(n).length, 1)
      const attente = attentes(n)[0]
      window.document.body.innerHTML = ''
      await dort(30)
      assert.equal(attente.coupe, true, 'le retrait débranche l\'observateur')
      const m0 = mesures.n
      etat.boite = true
      attente.rappel()
      assert.equal(mesures.n, m0, 'un avis tardif ne mesure plus rien')
    }
    finally {
      rend()
    }
  })
})
