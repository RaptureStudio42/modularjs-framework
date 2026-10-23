// @style.X sur une ligne d'un {for} SANS `by` — comme @class : la clé de la ligne (`row.id`) n'est pas unique, plusieurs lignes
// peuvent porter la valeur comparée. L'index range une fonction par ligne sous sa valeur (un Set quand la valeur en porte plusieurs) ;
// au changement de la variable, toutes les lignes de l'ancienne valeur reprennent la couleur du « non », toutes celles de la nouvelle
// la couleur du « oui ». Le cas avec `by` est dans transpiler.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

describe('transpiler — @style.X dans un {for} sans `by`', () => {
  it('le code émis : une fonction par ligne rangée sous sa valeur, les lignes de l\'ancienne et de la nouvelle valeur rappelées', async () => {
    const src = `<script lang="coffee">$selected = -1
$rows = []
</script>
{for row in $rows}<div @style.color={row.id === $selected ? 'red' : 'black'}>{row.label}</div>{end}`
    const { output } = await transpile(src, { moduleName: 'fd_style_sans_by' })
    assert.match(output, /\['selected__style_color__\w+'\]\s*\?\?=\s*\{ idx: null, prev: void 0 \}/)
    assert.match(output, /const __f = \(_mjs_match\) => \{/)
    assert.match(output, /µ\._mjs_filtPut\(__fe, __k, __f\)/)
    assert.doesNotMatch(output, /__idx\.set\(__k,\s*_mjs_n[a-zA-Z0-9_$]+\)/)
    assert.match(output, /µ\._mjs_filtCall\(_mjs_idx\.get\(_mjs_prev\), false\)/)
    assert.match(output, /µ\._mjs_filtCall\(_mjs_idx\.get\(_mjs_curr\), true\)/)
    assert.match(output, /style\.setProperty\('color', String\('red'\)\)/)
    assert.match(output, /style\.setProperty\('color', String\('black'\)\)/)
    assert.match(output, /"selected":\s*\[_mjs_eff/)
  })
})

describe('@style.X dans un {for} sans `by` : deux lignes de même clé suivent la variable (happy-dom)', function () {
  this.timeout(60000)
  const fenetres: any[] = []
  let code = ''

  const COMPOSANT = `<script>
$selected = -1
$rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 1, label: 'c' }]
</script>
{for row in $rows}<div class="r" @style.color={row.id === $selected ? 'red' : 'black'}>{row.label}</div>{end}
<button class="un" @click={$selected = 1}>1</button><button class="deux" @click={$selected = 2}>2</button><button class="ajout" @click={$rows = [...$rows, { id: 2, label: 'd' }]}>+</button>
`

  before(async () => {
    const root   = mjsTmp('transpiler-style-sans-by')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'sb-liste.mjs'), COMPOSANT)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  async function attendre(cond: () => boolean, ms = 3000) {
    const fin = Date.now() + ms
    while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  }

  // la couleur de chaque ligne, dans l'ordre : { a: 'red', b: 'black', … }
  const couleurs = (comp: any) => Object.fromEntries([...comp._shadow.querySelectorAll('.r')].map((r: any) => [r.textContent, r.style.color]))

  async function cliquer(window: any, comp: any, k: string, attendu: Record<string, string>) {
    comp._shadow.querySelector('.' + k).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await attendre(() => JSON.stringify(couleurs(comp)) === JSON.stringify(attendu))
    assert.deepEqual(couleurs(comp), attendu, `après le clic sur « ${k} »`)
  }

  it('la valeur passe de l\'une à l\'autre : les deux lignes de clé 1 changent ensemble, une ligne ajoutée suit aussi', async () => {
    const window: any = new Window({ url: 'http://localhost/' })
    fenetres.push(window)
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-sb-liste></mjs-sb-liste>'
    const comp = window.document.querySelector('mjs-sb-liste')
    await attendre(() => comp._shadow?.querySelectorAll('.r').length === 3)
    assert.deepEqual(couleurs(comp), { a: 'black', b: 'black', c: 'black' }, 'aucune ligne ne porte la valeur au départ')
    await cliquer(window, comp, 'un', { a: 'red', b: 'black', c: 'red' })
    await cliquer(window, comp, 'deux', { a: 'black', b: 'red', c: 'black' })
    await cliquer(window, comp, 'ajout', { a: 'black', b: 'red', c: 'black', d: 'red' })
    await cliquer(window, comp, 'un', { a: 'red', b: 'black', c: 'red', d: 'black' })
  })
})
