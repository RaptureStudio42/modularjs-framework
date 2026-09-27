// Un commentaire `#` (style Coffee/Civet) DANS une expression en ligne
// (gestionnaire `@event={…}`, callback de transition, interpolation `{…}`)
// n'est pas retiré et casse l'expression au runtime : ces sites passent par
// `cleanJs`/`cleanJsExpr` (generator/utils.ts), des passes REGEX qui isolent
// les chaînes/gabarits mais ne compilent pas réellement le Coffee/Civet de
// l'expression — un `#…` littéral survit tel quel dans le JS généré, que
// V8 refuse (`Unexpected character` / `Unexpected token`). Un commentaire
// bloc JS `/* … */` (ou `// …` en fin de ligne), lui, est du JS VALIDE : il
// n'a besoin d'aucun traitement spécial, le moteur l'exécute comme un
// commentaire normal. Ces deux tests le prouvent par exécution réelle.

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

async function build(files: Record<string, string>, tag: string): Promise<string> {
  const root   = mjsTmp('inline-comment-' + tag)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(srcDir, rel), content)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return outDir
}

function mountAll(outDir: string, hostTag: string) {
  const win: any      = new Window({ url: 'http://localhost/' })
  const document: any = win.document
  const files    = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coreFile = files.find((f) => /^mjs_core-/.test(f))!
  const code = files
    .filter((f) => f !== coreFile)
    .reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coreFile), 'utf-8')))
  win.eval(`${code}\nglobalThis.µ = µ;`)
  document.body.innerHTML = `<${hostTag}></${hostTag}>`
  return { win, document, el: document.body.firstElementChild }
}

const tick  = () => new Promise((r) => setTimeout(r, 0))
const ticks = async (n = 2) => { for (let i = 0; i < n; i++) await tick() }

describe('commentaire /* … */ dans une expression en ligne : forme qui fonctionne', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('@click={ … } : un commentaire /* … */ dans le corps du gestionnaire ne casse pas l\'expression', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$x = 0',
      '</script>',
      '<button id="btn" @click={$x = $x + 1 /* incrément */}>t</button>',
      '<span id="v">{$x}</span>',
    ].join('\n')

    const outDir = await build({ 'hotecmt.mjs': HOTE }, 'click')
    const { win, el } = mountAll(outDir, 'mjs-hotecmt')
    await ticks()
    const shadow = el._shadow || el.shadowRoot
    assert.equal(shadow.querySelector('#v').textContent, '0')

    shadow.querySelector('#btn').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()
    assert.equal(shadow.querySelector('#v').textContent, '1', 'le commentaire bloc dans le gestionnaire ne doit pas empêcher son exécution')

    win.close?.()
  })

  it('interpolation {…} : un commentaire /* … */ dans l\'expression ne casse pas le rendu', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$n = 5',
      '</script>',
      '<span id="v">{$n /* valeur affichee */ + 1}</span>',
    ].join('\n')

    const outDir = await build({ 'hotecmt2.mjs': HOTE }, 'interp')
    const { win, el } = mountAll(outDir, 'mjs-hotecmt2')
    await ticks()
    const shadow = el._shadow || el.shadowRoot
    assert.equal(shadow.querySelector('#v').textContent, '6', 'le commentaire bloc dans l\'interpolation ne doit pas empêcher son évaluation')

    win.close?.()
  })
})
