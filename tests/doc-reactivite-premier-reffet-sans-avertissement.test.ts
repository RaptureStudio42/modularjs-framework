// Le premier exemple de `µeffect` de `docs/03-reactivite.md` (un reffet qui pose un intervalle et rend son nettoyage)
// compile sans avertissement, et ne repose pas son intervalle à chaque tour : il ne lit pas la variable que l'intervalle
// écrit. Avant : `$i++` dans l'intervalle — le compilateur avertissait « µeffect qui LIT et ÉCRIT $i », et chaque tour
// relançait le reffet, donc un nouvel intervalle. Le nettoyage rendu coupe l'intervalle à la destruction.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// le premier bloc html qui suit le titre « Reffets — `µeffect` »
const DOC     = readFileSync(new URL('../docs/03-reactivite.md', import.meta.url), 'utf-8')
const SECTION = DOC.split('## Reffets — `µeffect`')[1] ?? ''
const EXEMPLE = (SECTION.split('```html\n')[1] ?? '').split('\n```')[0]

const pause = (ms = 40) => new Promise(r => setTimeout(r, ms))

describe('docs/03 : le premier exemple de µeffect', function () {
  this.timeout(60000)

  it('compile sans avertissement', async () => {
    assert.ok(EXEMPLE.includes('µeffect') && EXEMPLE.includes('setInterval'), 'exemple trouvé dans docs/03-reactivite.md')
    const vus: string[] = []
    const avant = console.warn
    console.warn = (...a: any[]) => { vus.push(a.join(' ')) }
    try { await transpile(EXEMPLE + '\n', { moduleName: 'doc-premier-reffet' }) }
    finally { console.warn = avant }
    assert.deepEqual(vus, [])
  })

  it('l\'intervalle est posé une fois, pas à chaque tour, et coupé à la destruction', async () => {
    const root = mjsTmp('doc-premier-reffet')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    writeFileSync(join(root, 'src', 'doc-premier-reffet.mjs'), EXEMPLE + '\n')
    const app: any = await createHarness({ root })
    try {
      const w      = app.window
      const poser  = w.setInterval
      const couper = w.clearInterval
      let poses    = 0
      let tours    = 0
      let coupes   = 0
      // même code, tour raccourci à 20 ms et compté
      w.setInterval   = (f: any, _d: number, ...r: any[]) => { poses++; return poser.call(w, (...a: any[]) => { tours++; return f(...a) }, 20, ...r) }
      w.clearInterval = (id: any) => { coupes++; return couper.call(w, id) }
      try {
        const c     = await app.mount('doc-premier-reffet')
        const avant = JSON.stringify(c.state)
        await pause(120)
        assert.ok(tours >= 2, `l'intervalle tourne (${tours} tours)`)
        assert.notEqual(JSON.stringify(c.state), avant, 'l\'intervalle écrit l\'état')
        assert.equal(poses, 1, `intervalle posé une fois, malgré les rendus (${poses} poses, ${coupes} coupés)`)
        assert.equal(coupes, 0, 'aucun intervalle coupé tant que le composant vit')
        c.destroy()
        assert.equal(coupes, 1, 'le nettoyage coupe l\'intervalle à la destruction')
        const t = tours
        await pause(80)
        assert.equal(tours, t, 'plus aucun tour après la destruction')
      }
      finally {
        w.setInterval   = poser
        w.clearInterval = couper
      }
    }
    finally { await app.destroy() }
  })
})
