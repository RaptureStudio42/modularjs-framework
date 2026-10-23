// *typewriter : ses réglages `delay` et `easing` (catalogue, docs/38-effets.md) comptent — le texte
// attend son délai avant de se taper, et se tape à vitesse constante par défaut (`linear`), pas en
// ralentissant sur la fin.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'machine-delai': '<p class="t" *typewriter(delay: 1s, on: load)>Bonjour</p>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*typewriter : délai et courbe', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any

  before(async () => {
    const root   = mjsTmp('machine-a-ecrire')
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
    // des animations Web minimales : la pose directe les exige (*typewriter, lui, joue image par image)
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
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('delay: 1s — rien de tapé pendant le délai, le texte entier ensuite', async () => {
    window.document.body.innerHTML = '<mjs-machine-delai></mjs-machine-delai>'
    const comp = window.document.querySelector('mjs-machine-delai')
    await attendre(() => !!comp._shadow?.querySelector('.t'))
    const t = comp._shadow.querySelector('.t')
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(t.textContent, '', 'à 400 ms, le délai d\'une seconde court encore')
    await attendre(() => t.textContent === 'Bonjour', 3000)
    assert.equal(t.textContent, 'Bonjour')
  })

  it('courbe : linéaire par défaut, celle écrite sinon ; le délai passe à l\'animation', () => {
    const µ = window.µ
    const p = window.document.createElement('p')
    p.textContent = 'Bonjour'
    const courbe = (s: any) => {
      delete p._mjs_text_cache
      const cfg = µ.anim.typewriter(µ._mjs_fxAnimOpts('typewriter', s)).intro(p)
      return { mi: µ.easing.resolve(cfg.easing)(0.5), delai: cfg.delay }
    }
    assert.deepEqual(courbe({ on: 'load' }), { mi: 0.5, delai: 0 })
    assert.deepEqual(courbe({ easing: 'quad-in', delay: '250ms' }), { mi: 0.25, delai: 250 })
  })
})
