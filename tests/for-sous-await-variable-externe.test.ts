// Un `{for}` dans la branche `{success}` d'un `{await}` : une liaison de sa ligne qui lit une variable
// du dehors (`data-t={d.title + $q}`, un texte `{$q}`, une classe, un style) suit cette variable quand
// elle change — comme dans un `{for}` à la racine. La ligne lit aussi la valeur de la branche (`d`) et
// celle de la boucle (`x`) : elles restent justes.
//
// `_mjs_updAwait` ne rejoue pas une branche dont la promesse et le statut n'ont pas changé, et les lignes
// ne lisent `$q` que dans leur closure de mise à jour : la liste d'une branche déjà affichée se refait par
// un effet que `compileFor` enregistre sur les variables lues par les lignes (generator/compile.ts,
// branche `{await}`).

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

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(prefixe: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  return window
}

const PAGE = `<script>
  $p = Promise.resolve({title: 'un', items: [{id: 1, name: 'a'}, {id: 2, name: 'b'}]})
  $q = 0
</script>

<div class="host">
{await $p}{success d}{for x in d.items by id}<i class="x" data-t={d.title + $q} title="{x.name}-{$q}" @class{$q is 5}="cinq">{d.title}-{x.name}-{$q}</i>{end}{end}
</div>
`

describe('{for} sous {await} : une liaison de la ligne suit la variable du dehors', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('data-t, title, texte et classe lisent $q : ils suivent $q', async () => {
    const window = await monter('for-sous-await', { 'demo-attend.mjs': PAGE })
    try {
      window.document.body.innerHTML = '<mjs-demo-attend></mjs-demo-attend>'
      const c = window.document.querySelector('mjs-demo-attend')
      await attendre(() => (c._shadow?.querySelectorAll('i.x').length ?? 0) === 2)
      await pause(40)
      const lire = () => JSON.stringify([...c._shadow.querySelectorAll('i.x')].map((i: any) => [i.getAttribute('data-t'), i.getAttribute('title'), i.textContent, i.classList.contains('cinq')]))
      assert.equal(lire(), JSON.stringify([['un0', 'a-0', 'un-a-0', false], ['un0', 'b-0', 'un-b-0', false]]), 'montage')
      c._set('q', 5)
      await pause(60)
      assert.equal(lire(), JSON.stringify([['un5', 'a-5', 'un-a-5', true], ['un5', 'b-5', 'un-b-5', true]]), '$q change : la ligne suit')
      c._set('p', Promise.resolve({title: 'deux', items: [{id: 1, name: 'A'}, {id: 3, name: 'C'}]}))
      await pause(80)
      assert.equal(lire(), JSON.stringify([['deux5', 'A-5', 'deux-A-5', true], ['deux5', 'C-5', 'deux-C-5', true]]), 'nouvelle promesse : la valeur de la branche et $q restent justes')
      c._set('q', 6)
      await pause(60)
      assert.equal(lire(), JSON.stringify([['deux6', 'A-6', 'deux-A-6', false], ['deux6', 'C-6', 'deux-C-6', false]]), '$q change encore : la ligne suit la nouvelle valeur')
    }
    finally {
      window.close()
    }
  })
})
