// *particles n'appelle jamais une méthode de l'auteur : sur la balise d'un composant qui écrit `@addEventListener`,
// `@removeEventListener`, `@getBoundingClientRect`, `@insertBefore`… (des noms laissés libres par le compilateur),
// chaque mode passe par la méthode de la balise elle-même, prise au prototype — ses écoutes (survol, souris, clics)
// comprises, posées puis retirées. Même banc que tests/effets-methodes-auteur-prototype.test.ts : les méthodes sont
// des champs de l'élément (ce que fait un composant), comptées, puis l'effet est joué avec des événements réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const METHODES = [
  'contains', 'getBoundingClientRect', 'getClientRects', 'getAttribute', 'setAttribute', 'removeAttribute',
  'hasAttribute', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'closest', 'matches', 'querySelector',
  'querySelectorAll', 'remove', 'replaceWith', 'appendChild', 'insertBefore', 'after', 'getRootNode'
]

const MODES: Array<Record<string, any>> = [
  { mode: 'snow', on: 'hover' },
  { mode: 'stars', on: 'hover' },
  { mode: 'meteors' },
  { mode: 'aura', on: 'hover' },
  { mode: 'network' },
  { mode: 'network', on: 'hover' }
]

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('*particles — jamais une méthode de l\'auteur sur la balise d\'un composant', function () {
  this.timeout(60000)
  let window: any
  let comp: any

  before(async () => {
    const root   = mjsTmp('effets-particules-methodes-auteur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-pm-banc.mjs'), '<div *particles>x</div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-fx-pm-banc></mjs-fx-pm-banc>'
    comp = window.document.querySelector('mjs-fx-pm-banc')
    await attendre(() => !!comp._shadow?.querySelector('div'))
    await pause()
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // une balise dont chaque méthode du DOM est « écrite par l'auteur » : elle compte l'appel puis fait ce que ferait celle
  // de la balise ; un appel venu de happy-dom lui-même (sa propagation d'événement) ne compte pas. Son parent aussi :
  // l'aura se pose à côté de la balise
  function balise(appels: string[]) {
    const parent = window.document.createElement('section')
    const el     = window.document.createElement('div')
    el.innerHTML = '<span>un</span>'
    parent.appendChild(el)
    window.document.body.appendChild(parent)
    const proto = window.HTMLElement.prototype
    for (const [qui, n] of [['balise', el], ['parent', parent]] as Array<[string, any]>) {
      for (const nom of METHODES) {
        const natif = proto[nom] || window.Element.prototype[nom] || window.Node.prototype[nom] || window.EventTarget.prototype[nom]
        if (typeof natif !== 'function') continue
        n[nom] = function (...args: any[]) {
          if (!/node_modules\/happy-dom/.test(String(new Error().stack).split('\n')[2])) appels.push(qui + '.' + nom)
          return natif.apply(this, args)
        }
      }
    }
    return el
  }

  const evenement = (el: any, type: string) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true })
    Object.assign(ev, { clientX: 5, clientY: 5, pointerId: 1 })
    window.EventTarget.prototype.dispatchEvent.call(el, ev)
  }

  for (const reglages of MODES) {
    it(`*particles(${Object.entries(reglages).map(([k, v]) => k + ': ' + v).join(', ')}) : aucune méthode de l'auteur appelée`, async () => {
      const appels: string[] = []
      const el = balise(appels)
      let off: any
      try { off = window.µ._mjs_fx(comp, el, 'particles', { ...reglages }, {}, null) }
      catch (e: any) { assert.fail(`l'effet ne se pose pas : ${e.message}`) }
      for (const type of ['pointerenter', 'pointermove', 'click', 'pointerleave']) evenement(el, type)
      await pause(30)
      if (typeof off === 'function') off()
      window.document.body.removeChild(el.parentNode)
      assert.deepEqual(appels, [])
    })
  }
})
