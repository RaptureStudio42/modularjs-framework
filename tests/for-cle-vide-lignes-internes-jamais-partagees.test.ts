// `{for … by id}` : une ligne dont la clé est vide (`null`, `undefined`) est suivie comme une ligne sans clé, et deux lignes à clé
// vide ne partagent jamais rien — pas même le contenu du `{for}` placé dans la ligne. Même règle sans `by` pour le même objet
// rangé deux fois dans la liste : chaque ligne garde ses propres lignes internes. Mises à jour successives (objets gardés,
// objets neufs, ordre changé) : chaque ligne affiche les siennes, une seule fois.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const PAR_CLE = `<script lang="js">
  $rows = [];
  @poser = function(r) { $rows = r; };
</script>
<ul class="l">{for row in $rows by id}<li><b>{row.label}</b>{for s in row.subs}<i>{s}</i>{end}</li>{end}</ul>
`
const SANS_CLE = `<script lang="js">
  $rows = [];
  @poser = function(r) { $rows = r; };
</script>
<ul class="l">{for row in $rows}<li><b>{row.label}</b>{for s in row.subs}<i>{s}</i>{end}</li>{end}</ul>
`

const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

async function monter() {
  const root   = mjsTmp('for-cle-vide')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'cle-vide.mjs'), PAR_CLE)
  writeFileSync(join(srcDir, 'cle-vide-sans.mjs'), SANS_CLE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n'))
  window.document.body.innerHTML = '<mjs-cle-vide></mjs-cle-vide><mjs-cle-vide-sans></mjs-cle-vide-sans>'
  const parCle  = window.document.querySelector('mjs-cle-vide')
  const sansCle = window.document.querySelector('mjs-cle-vide-sans')
  await attendre(() => !!parCle._shadow && !!sansCle._shadow)
  return { parCle, sansCle }
}

// texte de chaque ligne : son libellé, puis ses lignes internes
const lignes = (el: any) => Array.from(el._shadow.querySelectorAll('li')).map((li: any) => li.textContent)

async function poser(el: any, rows: any[], attendu: string[]) {
  el.poser(rows)
  await attendre(() => lignes(el).join(',') === attendu.join(','))
  assert.deepEqual(lignes(el), attendu)
}

describe('{for} : deux lignes à clé vide ne partagent jamais leurs lignes internes', function () {
  this.timeout(60000)
  let m: any
  before(async () => { m = await monter() })
  after(async () => { await terminateSharedWorkerPool() })

  it('by id : deux lignes à clé null, puis undefined, mêlées à une clé réelle', async () => {
    const a = { id: null, label: 'A', subs: ['a1', 'a2'] }
    const b = { id: null, label: 'B', subs: ['b1'] }
    const c = { id: 1, label: 'C', subs: ['c1', 'c2', 'c3'] }
    await poser(m.parCle, [a, b], ['Aa1a2', 'Bb1'])
    await poser(m.parCle, [a, c, b], ['Aa1a2', 'Cc1c2c3', 'Bb1'])
    b.subs = ['b1', 'b2']
    await poser(m.parCle, [b, a, c], ['Bb1b2', 'Aa1a2', 'Cc1c2c3'])
    const d = { id: undefined, label: 'D', subs: ['d1'] }
    const e = { id: undefined, label: 'E', subs: ['e1', 'e2'] }
    await poser(m.parCle, [d, e, a], ['Dd1', 'Ee1e2', 'Aa1a2'])
    await poser(m.parCle, [e, d], ['Ee1e2', 'Dd1'])
  })

  it('by id : lignes à clé vide refaites d\'objets neufs', async () => {
    await poser(m.parCle, [{ id: null, label: 'A', subs: ['a1'] }, { id: null, label: 'B', subs: ['b1', 'b2'] }], ['Aa1', 'Bb1b2'])
    await poser(m.parCle, [{ id: null, label: 'B', subs: ['b1', 'b2'] }, { id: null, label: 'A', subs: ['a1'] }], ['Bb1b2', 'Aa1'])
  })

  it('sans by : le même objet rangé deux fois garde deux fois ses lignes internes', async () => {
    const a = { label: 'A', subs: ['a1', 'a2'] }
    const b = { label: 'B', subs: ['b1'] }
    await poser(m.sansCle, [a, a], ['Aa1a2', 'Aa1a2'])
    await poser(m.sansCle, [a, b, a], ['Aa1a2', 'Bb1', 'Aa1a2'])
    a.subs = ['a3']
    await poser(m.sansCle, [b, a, a], ['Bb1', 'Aa3', 'Aa3'])
  })
})
