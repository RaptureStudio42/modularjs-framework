// Une entité lissée par `µ.smooth` nommée `constructor` ou `__proto__` (un joueur ainsi nommé, une clé d'un objet reçu en
// JSON) : le magasin de sortie, un état réactif (µ.state), refuse ces noms. `µ.smooth` y écrivait quand même à chaque
// image, et chaque écriture refusée écrivait un avertissement, en production comme en développement : plus de cent par
// seconde, sans fin. Une clé refusée par `µ.state` n'est plus dite que par une trace de développement, une fois par nom
// et par état — rien en production ; `µ.smooth` laisse ce refus à l'état (il ne vérifie plus ces noms une seconde fois).

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { createHarness } from '../src/testing/index.js'
import { cutRuntimeTraces } from '../src/bundler/minify.js'
import { mjsTmp } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SOURCE = [
  '<script lang="js">',
  '  @lisse = function(txt) { window.__lnr = µ.smooth(JSON.parse(txt), {delay: 0}); };',
  '  @etat = function() {',
  '    const st = µ.state({a: 1});',
  '    for (let i = 0; i < 3; i++) { st.constructor = i; st[\'__proto__\'] = {x: i}; delete st.prototype; }',
  '    return Object.keys(st).join(\',\') + \':\' + ({}).x;',
  '  };',
  '</script>',
  '<p>l</p>',
].join('\n')

describe('µ.smooth et µ.state — une clé refusée : une trace par nom en développement, jamais un avertissement répété', function () {
  this.timeout(60000)
  let app: any
  const avert: string[] = []
  const traces: string[] = []

  before(async () => {
    const root = mjsTmp('lissage-cle-refusee')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'tst-lcr.mjs'), SOURCE)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    app = await createHarness({ root })
    app.window.console.warn = (...a: any[]) => { avert.push(a.map(String).join(' ')) }
    app.window.console.log = (...a: any[]) => { traces.push(a.map(String).join(' ')) }
  })

  after(async () => { if (app) await app.destroy() })

  it('µ.smooth : les entités `constructor` et `__proto__` sont écartées, une trace chacune, aucun avertissement', async () => {
    avert.length = 0
    traces.length = 0
    const c = await app.mount('tst-lcr')
    c.el.lisse('{"a": {"x": 1}, "toString": {"x": 2}, "constructor": {"x": 3}, "__proto__": {"x": 4}}')
    await pause(600)
    const sm = app.window.__lnr
    assert.deepEqual(Object.keys(sm).sort(), ['a', 'toString'], 'les entités ordinaires sont lissées')
    assert.equal(avert.length, 0, 'avertissements en 600 ms : ' + avert.length + ' ' + JSON.stringify(avert.slice(0, 2)))
    const refus = traces.filter((t) => t.includes('clé refusée'))
    assert.equal(refus.length, 2, 'une trace par nom écarté : ' + JSON.stringify(refus.slice(0, 4)))
    assert.ok(refus.some((t) => t.includes('constructor')) && refus.some((t) => t.includes('__proto__')), JSON.stringify(refus))
    sm.dispose()
    c.destroy()
  })

  it('µ.state : trois écritures refusées par nom, une seule trace pour chacun, aucun avertissement', async () => {
    avert.length = 0
    traces.length = 0
    const c = await app.mount('tst-lcr')
    assert.equal(c.el.etat(), 'a:undefined', 'clés refusées, prototype intact')
    assert.equal(avert.length, 0, 'avertissements : ' + JSON.stringify(avert))
    const refus = traces.filter((t) => t.includes('clé refusée'))
    assert.equal(refus.length, 3, 'une trace par nom : ' + JSON.stringify(refus))
    c.destroy()
  })

  it('production : ces traces partent avec les autres traces du runtime', () => {
    for (const f of ['mjs_state.ts']) {
      const src  = readFileSync(join(__dirname, '../src/runtime', f), 'utf8')
      const prod = transformSync(cutRuntimeTraces(src), { loader: 'ts', minify: true, define: { MJS_TRACE: 'null' } }).code
      assert.ok(src.includes('runesKey'), f + ' : la trace est dans la source')
      assert.equal(prod.includes('runesKey'), false, f + ' : trace retirée')
    }
  })
})
