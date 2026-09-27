// module cœur select : une option modifiée EN PLACE (liste {for} réactive, même clé, même
// noeud <mjs-option> réutilisé — donc aucun slotchange) doit se refléter dans le panneau, y
// compris après fermeture puis réouverture. Patron build+happy-dom calqué sur
// tests/core-select.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const HOST = [
  '<script>',
  "$items = [{id: 1, value: 'a', label: 'Alpha'}]",
  'renommer = -> $items = [{id: 1, value: "a", label: "Alpha modifie"}]',
  '</script>',
  '<@select name="sel">',
  '  {for item in $items by id}',
  '    <@option value={item.value}>{item.label}</@option>',
  '  {end}',
  '</@select>',
  '<button class="renommer" @click={renommer()}>renommer</button>',
].join('\n')

async function buildAndMount(): Promise<{ window: any; hote: any }> {
  const root   = mjsTmp('core-select-mutation')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOST)

  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const files = readdirSync(outDir)
  const pick = (re: RegExp) => {
    const f = files.find((f) => re.test(f))
    assert.ok(f, `chunk attendu ${re} parmi ${files.join(', ')}`)
    return f!
  }
  const code = [pick(/^mjs_core-/), pick(/^select-/), pick(/^option-/), pick(/^hote-/)]
    .map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8')))
    .join('\n')

  const window: any   = new Window({ url: 'http://localhost/' })
  const document: any = window.document
  window.eval(`${code}\nglobalThis.µ = µ;`)
  document.body.innerHTML = '<mjs-hote></mjs-hote>'
  await new Promise((r) => setTimeout(r, 80))
  const hote = document.body.querySelector('mjs-hote')
  return { window, hote }
}

function click(win: any, el: any) {
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
}

async function tick(ms = 30) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('mjs-select — une option modifiée en place reste juste dans le panneau', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le libellé du panneau suit la mutation dès la première réouverture, sans ajout ni retrait d\'option', async () => {
    const { window, hote } = await buildAndMount()
    const selEl = hote._shadow.querySelector('mjs-select')
    const selShadow = () => selEl._shadow

    click(window, selShadow().querySelector('.select-btn'))
    await tick()
    assert.equal(selShadow().querySelector('.select-option-label')?.textContent.trim(), 'Alpha', 'préalable : le panneau affiche le libellé initial')

    // mutation EN PLACE : même id -> même noeud <mjs-option> réutilisé, aucun slotchange
    click(window, hote._shadow.querySelector('.renommer'))
    await tick()
    // le bouton est HORS du wrapper <@select> : le clic-dehors (onDocumentClick) referme le
    // panneau, comportement normal
    assert.equal(selEl._state.open, false, 'préalable : le clic-dehors a bien refermé le panneau')

    click(window, selShadow().querySelector('.select-btn'))
    await tick()
    assert.equal(selShadow().querySelector('.select-option-label')?.textContent.trim(), 'Alpha modifie', 'le panneau doit refléter la donnée à jour à la réouverture')
  })

  it('le libellé du bouton (hors panneau) suit aussi la mutation en place', async () => {
    const { window, hote } = await buildAndMount()
    const selEl = hote._shadow.querySelector('mjs-select')
    const btn = selEl._shadow.querySelector('.select-btn')

    click(window, btn)
    await tick()
    click(window, selEl._shadow.querySelectorAll('.select-option')[0])
    await tick()
    assert.match(btn.textContent, /Alpha/)

    click(window, hote._shadow.querySelector('.renommer'))
    await tick()
    assert.match(btn.textContent, /Alpha modifie/, 'le libellé sélectionné affiché sur le bouton doit suivre la mutation')
  })
})
