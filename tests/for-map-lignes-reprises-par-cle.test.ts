// `{for p in $m}` sur une `Map`, sans `by` : chaque ligne est suivie par la clé de la `Map`, comme la ligne d'un tableau par sa
// clé — une `Map` neuve aux mêmes clés (valeurs neuves comprises), un ordre changé, une insertion, un retrait, une écriture en
// place (`$m.set`, `$m.delete`) gardent les lignes des clés restées : mêmes balises, saisie gardée. Le `{for}` placé dans la
// ligne d'une `Map` garde ses lignes internes, une seule fois chacune.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = `<script lang="js">
  $m = null;
  @poser = function(m) { $m = m; };
  @ajouter = function(k, v) { $m.set(k, v); };
  @retirer = function(k) { $m.delete(k); };
</script>
<ul class="l">{for p in $m}<li>{p[0]}:{p[1].label}<input></li>{end}</ul>
<ol class="n">{for k, p in $m}<li><b>{p[0]}</b>{for s in p[1].subs}<i>{s}</i>{end}</li>{end}</ol>
`

const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

async function monter() {
  const root   = mjsTmp('for-map-cle')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'map-cle.mjs'), SOURCE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n'))
  window.document.body.innerHTML = '<mjs-map-cle></mjs-map-cle>'
  const el = window.document.querySelector('mjs-map-cle')
  await attendre(() => !!el._shadow)
  return { window, el }
}

const lignes  = (el: any) => Array.from(el._shadow.querySelectorAll('ul li')) as any[]
const internes = (el: any) => Array.from(el._shadow.querySelectorAll('ol li')).map((li: any) => li.textContent)
// la ligne de chaque clé (texte avant les deux-points), et la saisie posée dans chacune
const parCle  = (el: any) => new Map(lignes(el).map((li: any) => [li.textContent.split(':')[0], li]))

describe('{for} sur une Map, sans by : lignes reprises par la clé de la Map', function () {
  this.timeout(60000)
  let m: any
  before(async () => { m = await monter() })
  after(async () => { await terminateSharedWorkerPool() })

  const carte = (ids: number[]) => new m.window.Map(ids.map((id) => [id, { label: 'L' + id, subs: ['s' + id, 't' + id] }]))

  async function poser(ids: number[], geste: () => void) {
    const avant = parCle(m.el)
    for (const [k, li] of avant) li.querySelector('input').value = 'v' + k
    geste()
    await attendre(() => lignes(m.el).map((li: any) => li.textContent.split(':')[0]).join(',') === ids.join(','))
    const apres = parCle(m.el)
    assert.deepEqual([...apres.keys()], ids.map(String))
    for (const [k, li] of apres) {
      const garde = avant.has(k)
      assert.ok(!garde || li === avant.get(k), `clé ${k} : la ligne doit être la même balise`)
      assert.equal(li.querySelector('input').value, garde ? 'v' + k : '', `clé ${k} : saisie`)
    }
    assert.deepEqual(internes(m.el), ids.map((id) => `${id}s${id}t${id}`))
  }

  it('Map neuve aux mêmes clés, ordre changé, insertion, retrait', async () => {
    await poser([1, 2, 3, 4], () => m.el.poser(carte([1, 2, 3, 4])))
    await poser([1, 2, 3, 4], () => m.el.poser(carte([1, 2, 3, 4])))
    await poser([1, 2, 4], () => m.el.poser(carte([1, 2, 4])))
    await poser([4, 1, 7, 2], () => m.el.poser(carte([4, 1, 7, 2])))
    await poser([2, 7], () => m.el.poser(carte([2, 7])))
  })

  it('écriture en place : $m.set, $m.delete', async () => {
    await poser([1, 2, 3], () => m.el.poser(carte([1, 2, 3])))
    await poser([1, 2, 3, 5], () => m.el.ajouter(5, { label: 'L5', subs: ['s5', 't5'] }))
    await poser([1, 3, 5], () => m.el.retirer(2))
    await poser([1, 3, 5], () => m.el.ajouter(3, { label: 'L3', subs: ['s3', 't3'] }))
  })
})
