// *count, *delta et *weight : une police qui arrive après la pose, à la façon de WebKit — `document.fonts`
// émet `loading`, remplace `ready` par une promesse neuve et la résout à la fin, sans JAMAIS émettre
// `loadingdone`. L'effet doit alors refaire sa mesure (la place du nombre, le mode de graisse) ; retiré,
// il ne garde aucun écouteur, et la fin d'un chargement commencé avant son retrait ne le réveille pas.
// happy-dom ne met rien en page : on compte les mesures. Les trois moteurs réels sont vus par
// effets-police-tardive-browser.test.ts (et *spoiler, qui demande une vraie toile, seulement là).
// Chaque arrivée de police fait reprendre la mesure UNE fois, quel que soit l'ordre des signaux de fin (WebKit :
// `ready` seul ; Chromium : `loadingdone` puis `ready` ; Firefox : `ready` puis `loadingdone`), la police prête et
// jamais pendant qu'elle charge ; un effet posé alors que sa police est déjà en route l'attend aussi.

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

const SOURCES: Record<string, string> = {
  'fx-pt-compte.mjs':  '<b class="n" *count(on: load)>12480</b>',
  'fx-pt-delta.mjs':   '<b class="n" *delta>12480</b>',
  'fx-pt-graisse.mjs': '<b class="n" *weight(idle: false)>Mot</b>'
}

describe('une police qui arrive tard, à la façon de WebKit (loading, ready neuf, jamais loadingdone)', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-police-tardive')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // un `document.fonts` à la façon de WebKit, avec le compte de ses écouteurs ; `charge()` : un chargement
  // qui commence (`loading`, `ready` neuf) puis finit (`ready` résolu), sans `loadingdone`
  function polices() {
    const f: any = new window.EventTarget()
    const reg    = new Map<string, Set<any>>()
    const ajoute = f.addEventListener.bind(f)
    const retire = f.removeEventListener.bind(f)
    f.addEventListener = (type: string, fn: any, o?: any) => {
      if (!reg.has(type)) reg.set(type, new Set())
      reg.get(type)!.add(fn)
      return ajoute(type, fn, o)
    }
    f.removeEventListener = (type: string, fn: any, o?: any) => {
      reg.get(type)?.delete(fn)
      return retire(type, fn, o)
    }
    f.status = 'loaded'
    f.ready  = Promise.resolve()
    f.ecouteurs = () => {
      const out: Record<string, number> = {}
      reg.forEach((s, t) => { if (s.size) out[t] = s.size })
      return out
    }
    // un chargement qui commence : `status`, un `ready` neuf, puis `loading`
    f.commence = () => {
      f.status = 'loading'
      f.ready  = new Promise<void>((r) => { f.fini = r })
      f.dispatchEvent(new window.Event('loading'))
    }
    // le chargement finit, les signaux dans l'ordre du moteur
    f.finit = async (ordre: string) => {
      f.status = 'loaded'
      if (ordre === 'Chromium') {
        f.dispatchEvent(new window.Event('loadingdone'))
        f.fini()
      }
      else {
        f.fini()
        if (ordre === 'Firefox') {
          await new Promise((r) => setTimeout(r, 0))
          f.dispatchEvent(new window.Event('loadingdone'))
        }
      }
      await new Promise((r) => setTimeout(r, 30))
    }
    f.charge = async () => {
      let fini: () => void = () => {}
      f.status = 'loading'
      f.ready  = new Promise<void>((r) => { fini = r })
      f.dispatchEvent(new window.Event('loading'))
      f.status = 'loaded'
      fini()
      await new Promise((r) => setTimeout(r, 30))
    }
    return f
  }

  // `mesure` : ce qui marque une reprise (la place du nombre pour *count et *delta ; le mode de graisse, écrit sur la
  // balise à chaque mesure de la police, pour *weight)
  const CAS = [
    { nom: '*count', tag: 'mjs-fx-pt-compte', mesure: 'nombre' },
    { nom: '*delta', tag: 'mjs-fx-pt-delta', mesure: 'nombre' },
    { nom: '*weight', tag: 'mjs-fx-pt-graisse', mesure: 'mode' }
  ]
  const ORDRES = ['WebKit', 'Chromium', 'Firefox']

  // les reprises de mesure d'un effet, chacune notée avec l'état (`status`) de la police à cet instant
  function espionne(cas: { mesure: string }, f: any) {
    const vus: string[] = []
    const nombre        = window.µ._mjs_fxNumWidth
    const pose          = window.Element.prototype.setAttribute
    if (cas.mesure === 'nombre') window.µ._mjs_fxNumWidth = function (this: any, ...a: any[]) { vus.push(f.status); return nombre.apply(this, a) }
    else window.Element.prototype.setAttribute = function (this: any, nom: string, v: string) { if (nom === 'mjs-fx-weight-mode') vus.push(f.status); return pose.call(this, nom, v) }
    return {
      vus,
      remet() { vus.length = 0 },
      rend() {
        window.µ._mjs_fxNumWidth              = nombre
        window.Element.prototype.setAttribute = pose
      }
    }
  }
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

  for (const cas of CAS) {
    it(`${cas.nom} : la fin d'un chargement (ready résolu, pas de loadingdone) refait la mesure ; retiré, plus d'écouteur et plus de mesure`, async () => {
      const f = polices()
      Object.defineProperty(window.document, 'fonts', { value: f, configurable: true })
      // les mesures : la place d'un nombre pour *count et *delta, tout getBoundingClientRect pour *weight
      let mesures  = 0
      const nombre = window.µ._mjs_fxNumWidth
      const rect   = window.Element.prototype.getBoundingClientRect
      window.µ._mjs_fxNumWidth                       = function (this: any, ...a: any[]) { mesures++; return nombre.apply(this, a) }
      window.Element.prototype.getBoundingClientRect = function (this: any, ...a: any[]) { mesures++; return rect.apply(this, a) }
      try {
        window.document.body.innerHTML = `<${cas.tag}></${cas.tag}>`
        const comp = window.document.querySelector(cas.tag)
        await attendre(() => !!comp._shadow?.querySelector('.n'))
        await new Promise((r) => setTimeout(r, 30))
        const tenu = comp._shadow.querySelector('.n')
        assert.notDeepEqual(f.ecouteurs(), {}, 'l\'effet écoute document.fonts')
        const n0 = mesures
        await f.charge()
        assert.ok(mesures > n0, `la mesure est refaite à la fin du chargement (${n0} → ${mesures})`)
        window.document.body.innerHTML = ''
        await new Promise((r) => setTimeout(r, 30))
        assert.deepEqual(f.ecouteurs(), {}, 'retiré, aucun écouteur de document.fonts ne reste')
        const n1 = mesures
        await f.charge()
        assert.equal(mesures, n1, 'l\'effet parti, plus rien ne se mesure')
        assert.equal(tenu.getAttribute('mjs-fx-weight-mode'), null, 'la balise retirée n\'a rien repris')
      }
      finally {
        window.µ._mjs_fxNumWidth                       = nombre
        window.Element.prototype.getBoundingClientRect = rect
      }
    })

    it(`${cas.nom} : un chargement commencé avant le retrait et fini après ne réveille pas l'effet`, async () => {
      const f = polices()
      Object.defineProperty(window.document, 'fonts', { value: f, configurable: true })
      let mesures  = 0
      const nombre = window.µ._mjs_fxNumWidth
      const rect   = window.Element.prototype.getBoundingClientRect
      window.µ._mjs_fxNumWidth                       = function (this: any, ...a: any[]) { mesures++; return nombre.apply(this, a) }
      window.Element.prototype.getBoundingClientRect = function (this: any, ...a: any[]) { mesures++; return rect.apply(this, a) }
      try {
        window.document.body.innerHTML = `<${cas.tag}></${cas.tag}>`
        const comp = window.document.querySelector(cas.tag)
        await attendre(() => !!comp._shadow?.querySelector('.n'))
        await new Promise((r) => setTimeout(r, 30))
        const tenu = comp._shadow.querySelector('.n')
        // le chargement commence : l'effet arme `ready`
        let fini: () => void = () => {}
        f.status = 'loading'
        f.ready  = new Promise<void>((r) => { fini = r })
        f.dispatchEvent(new window.Event('loading'))
        // l'effet est retiré avant la fin du chargement
        window.document.body.innerHTML = ''
        await new Promise((r) => setTimeout(r, 30))
        const n1 = mesures
        f.status = 'loaded'
        fini()
        await new Promise((r) => setTimeout(r, 30))
        assert.equal(mesures, n1, 'la fin du chargement ne mesure plus rien')
        assert.equal(tenu.getAttribute('mjs-fx-weight-mode'), null, 'la balise retirée n\'a rien repris')
      }
      finally {
        window.µ._mjs_fxNumWidth                       = nombre
        window.Element.prototype.getBoundingClientRect = rect
      }
    })
  }

  for (const cas of CAS) {
    // un effet posé : le composant monte, l'effet se pose
    async function pose() {
      window.document.body.innerHTML = `<${cas.tag}></${cas.tag}>`
      const comp = window.document.querySelector(cas.tag)
      await attendre(() => !!comp._shadow?.querySelector('.n'))
      await pause(30)
    }
    async function retire() {
      window.document.body.innerHTML = ''
      await pause(30)
    }

    for (const ordre of ORDRES) {
      it(`${cas.nom} : une police qui arrive (${ordre}) ne fait reprendre la mesure qu'une fois, la police prête`, async () => {
        const f = polices()
        Object.defineProperty(window.document, 'fonts', { value: f, configurable: true })
        const m = espionne(cas, f)
        try {
          await pose()
          m.remet()
          f.commence()
          await pause(30)
          assert.deepEqual(m.vus, [], 'aucune reprise de la mesure tant que la police charge')
          await f.finit(ordre)
          assert.deepEqual(m.vus, ['loaded'], 'une seule reprise de la mesure, la police prête')
        }
        finally {
          m.rend()
          await retire()
        }
      })

      it(`${cas.nom} : posé pendant qu'une police charge (${ordre}), l'effet reprend sa mesure une fois, à l'arrivée`, async () => {
        const f = polices()
        Object.defineProperty(window.document, 'fonts', { value: f, configurable: true })
        const m = espionne(cas, f)
        try {
          // la police est en route, son `loading` est parti : l'effet posé ensuite ne l'entend pas
          f.commence()
          await pose()
          m.remet()
          await pause(30)
          assert.deepEqual(m.vus, [], 'aucune reprise de la mesure tant que la police charge')
          await f.finit(ordre)
          assert.deepEqual(m.vus, ['loaded'], 'une seule reprise de la mesure, la police prête')
        }
        finally {
          m.rend()
          await retire()
        }
      })
    }

    it(`${cas.nom} : un loadingdone que nul loading n'a précédé reprend quand même la mesure`, async () => {
      const f = polices()
      Object.defineProperty(window.document, 'fonts', { value: f, configurable: true })
      const m = espionne(cas, f)
      try {
        await pose()
        m.remet()
        f.dispatchEvent(new window.Event('loadingdone'))
        f.dispatchEvent(new window.Event('loadingdone'))
        assert.deepEqual(m.vus, ['loaded', 'loaded'], 'chaque loadingdone seul reprend la mesure')
      }
      finally {
        m.rend()
        await retire()
      }
    })
  }
})
