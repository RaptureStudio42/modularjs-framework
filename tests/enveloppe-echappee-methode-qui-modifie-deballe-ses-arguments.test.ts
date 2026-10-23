// Une liste, un Set ou une Map de l'état passés à une fonction (`ajouter($items, $obj)`) : la fonction les modifie par
// leur enveloppe réactive. Ce qu'elle y range (`push`, `unshift`, `splice`, `add`, `set`) doit être la donnée brute,
// comme une affectation : avant, une méthode qui modifie appelée par l'enveloppe pouvait ranger ses arguments tels
// quels, enveloppes d'un composant comprises.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = [
  '<script>',
  '$items = []',
  '$ens = new Set()',
  '$carte = new Map()',
  '$obj = { n: 1 }',
  'ajouter = (l, x) -> l.push(x)',
  'devant = (l, x) -> l.unshift(x)',
  'inserer = (l, x) -> l.splice(1, 0, x)',
  'mettre = (s, x) -> s.add(x)',
  "poser = (m, x) -> m.set('k', x)",
  'tout = ->',
  '  ajouter($items, $obj)',
  '  devant($items, $obj)',
  '  inserer($items, $obj)',
  '  mettre($ens, $obj)',
  '  poser($carte, $obj)',
  '</script>',
  '<button class="t" @click={tout()}>t</button><p class="n">{$items.length} {$ens.size} {$carte.size}</p>',
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('enveloppe échappée — une méthode qui modifie range ses arguments bruts', function () {
  this.timeout(60000)
  let core = ''
  let module = ''
  let w: any

  before(async () => {
    const root   = mjsTmp('enveloppe-echappee')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'mee-liste.mjs'), SOURCE + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    core   = lire(files.find((f) => /^mjs_core-/.test(f))!)
    module = lire(files.find((f) => /^mee-liste-[0-9a-z]{5}\.js$/.test(f))!)
  })

  after(async () => {
    w?.close?.()
    await terminateSharedWorkerPool()
  })

  // monte le composant et lance les cinq modifications par les fonctions qui reçoivent l'enveloppe
  async function modifier() {
    w = new Window({ url: 'http://localhost/' })
    w.eval(`${core}\nglobalThis.µ = µ;`)
    w.eval(module)
    w.document.body.insertAdjacentHTML('beforeend', '<mjs-mee-liste></mjs-mee-liste>')
    const el = w.document.body.querySelector('mjs-mee-liste')
    await attendre(() => !!el._shadow)
    el._shadow.querySelector('.t').click()
    await attendre(() => el._shadow.querySelector('.n').textContent === '3 1 1')
    assert.equal(el._shadow.querySelector('.n').textContent, '3 1 1', 'le composant suit les cinq modifications')
    return el
  }
  const brut = (v: any) => w.µ._mjs_toRaw(v)
  const enveloppe = (v: any) => v !== null && typeof v === 'object' && !!v[w.µ._mjs_RAW]

  it('liste : push, unshift, splice rangent l\'objet de l\'état lui-même', async () => {
    const el = await modifier()
    const obj = brut(el._state.obj)
    const items = brut(el._state.items)
    assert.deepEqual([...items].map(enveloppe), [false, false, false], 'liste : push, unshift, splice')
    assert.ok([...items].every((e: any) => e === obj), 'liste : l\'objet de l\'état lui-même')
    w.close()
  })

  it('Set.add et Map.set rangent l\'objet de l\'état lui-même', async () => {
    const el = await modifier()
    const obj = brut(el._state.obj)
    const ens = brut(el._state.ens)
    assert.deepEqual([...ens].map(enveloppe), [false], 'Set : add')
    assert.ok(ens.has(obj), 'Set : l\'objet de l\'état lui-même')
    const carte = brut(el._state.carte)
    assert.equal(enveloppe(carte.get('k')), false, 'Map : set')
    assert.equal(carte.get('k'), obj, 'Map : l\'objet de l\'état lui-même')
  })
})
