// Transition suivie au défilement (`on: scroll`) dont la plage est tenue par une variable
// (`range: $r`) : une plage malformée (une seule borne, un mot) n'est pas une plage — la transition
// suit alors le passage de la balise à l'écran, sans jamais donner `NaN` à son animation (un
// navigateur lèverait une TypeError à chaque image de défilement).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'plage-variable': "<script>\n$r = '100'\n</script>\n<p class=\"d\" *iris(on: scroll, range: $r)>défile</p>\n<button class=\"bonne\" @click={$r = '0 1000px'}>b</button>",
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('on: scroll, range tenue par une variable : jamais NaN', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any
  const temps: number[] = []

  before(async () => {
    const root   = mjsTmp('plage-variable')
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
    // une animation Web dont on relève chaque position donnée par le défilement
    animateAvant = window.Element.prototype.animate
    window.Element.prototype.animate = function () {
      let fin: any
      const a: any = { finished: new Promise((r) => { fin = r }), cancel() { fin(a) }, pause() {}, play() {}, finish() { fin(a) }, effect: { getComputedTiming: () => ({ progress: 0 }) } }
      Object.defineProperty(a, 'currentTime', { get: () => 0, set: (v: number) => { temps.push(v) } })
      return a
    }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    if (animateAvant === undefined) delete window?.Element?.prototype?.animate
    else if (window) window.Element.prototype.animate = animateAvant
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('range: \'100\' (une seule borne) : aucune position NaN ; une plage juste ensuite, suivie', async () => {
    window.document.body.innerHTML = '<mjs-plage-variable></mjs-plage-variable>'
    const comp = window.document.querySelector('mjs-plage-variable')
    await attendre(() => !!comp._shadow?.querySelector('.d[mjs-fx]'))
    await new Promise((r) => setTimeout(r, 60))
    assert.ok(temps.length > 0, 'l\'animation suit le défilement')
    assert.equal(temps.filter((t) => !Number.isFinite(t)).length, 0, 'positions : ' + temps.join(', '))
    temps.length = 0
    comp._shadow.querySelector('.bonne').click()
    await new Promise((r) => setTimeout(r, 60))
    assert.ok(temps.length > 0 && temps.every((t) => Number.isFinite(t)), 'positions : ' + temps.join(', '))
  })
})
