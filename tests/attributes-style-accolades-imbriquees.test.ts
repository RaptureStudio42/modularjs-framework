// `@style.prop="pre-{expr}-post"` : l'expression peut contenir un objet
// littéral imbriqué (`{k: $w}`) ou un `}` littéral dans une chaîne — le
// découpage doit rester ÉQUILIBRÉ (même mécanique que l'interpolation
// d'attribut ordinaire), pas une regex qui referme sur le PREMIER `}`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string): string => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

async function mountFiles(files: Record<string, string>, rootTag: string): Promise<{ window: any; document: any; el: any }> {
  const root   = mjsTmp('style-brace')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [name, src] of Object.entries(files)) writeFileSync(join(srcDir, name), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const window: any   = new Window({ url: 'http://localhost/' })
  const document: any = window.document
  const outFiles = readdirSync(outDir)
  const coreFile = outFiles.find((f: string) => /^mjs_core-/.test(f))!
  const jsFiles  = outFiles.filter((f: string) => f.endsWith('.js') && f !== coreFile && f !== 'bundle.js')
  const coreCode = stripEsm(readFileSync(join(outDir, coreFile), 'utf-8'))
  const compCode = jsFiles.map((f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  window.eval(`${coreCode}\nglobalThis.µ = µ;\n${compCode}`)
  document.body.insertAdjacentHTML('beforeend', `<${rootTag}></${rootTag}>`)
  const el = document.body.querySelector(rootTag)
  return { window, document, el }
}

describe('@style.prop avec objet littéral imbriqué dans l\'expression', function () {
  this.timeout(15000)
  after(async () => { await terminateSharedWorkerPool() })

  it('compile sans erreur et pose la valeur RÉELLE (pas de troncature au 1er `}`)', async () => {
    const src = [
      '<script>', '$w = 10', 'f = (o) -> o.k', '</script>',
      '<div class="cible" @style.width="{f({k: $w})}px">x</div>',
    ].join('\n')
    const { el } = await mountFiles({ 'style-nested.mjs': src }, 'mjs-style-nested')
    await new Promise((r) => setTimeout(r, 30))
    assert.ok(!el.classList.contains('mjs-error'), 'le composant ne doit pas planter à la compilation ni au montage')
    const cible = el._shadow.querySelector('.cible')
    assert.equal(cible.style.width, '10px', 'la valeur posée doit être celle RÉELLEMENT calculée par f({k: $w})')
  })

  it('reste réactif : une mutation de la var utilisée dans l\'objet imbriqué met à jour le style', async () => {
    const src = [
      '<script>', '$w = 10', 'f = (o) -> o.k', '</script>',
      '<div class="cible" @style.width="{f({k: $w})}px">x</div>',
      '<button class="mut" @click={$w = 25}>mut</button>',
    ].join('\n')
    const { el } = await mountFiles({ 'style-nested-reactive.mjs': src }, 'mjs-style-nested-reactive')
    await new Promise((r) => setTimeout(r, 30))
    const cible = el._shadow.querySelector('.cible')
    assert.equal(cible.style.width, '10px')
    el._shadow.querySelector('.mut').click()
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(cible.style.width, '25px', 'la dépendance $w (dans l\'objet imbriqué) doit rester détectée')
  })
})
