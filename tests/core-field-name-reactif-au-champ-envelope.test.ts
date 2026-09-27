// module cœur field : quand aucun `name` n'est fourni sur <@field>, le nom déduit du champ
// enveloppé n'était lu qu'une fois au montage — un changement ultérieur de l'attribut `name`
// du champ (composant tiers qui le renomme, par exemple) restait sans effet. Patron
// build+happy-dom calqué sur tests/core-field.test.ts.

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

async function buildAndMount(hostSource: string): Promise<{ window: any; hote: any }> {
  const root   = mjsTmp('field-name-reactif')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), hostSource)

  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const files = readdirSync(outDir)
  const pick = (re: RegExp) => {
    const f = files.find((f) => re.test(f))
    assert.ok(f, `chunk attendu ${re} parmi ${files.join(', ')}`)
    return f!
  }
  const code = [pick(/^mjs_core-/), pick(/^field-/), pick(/^hote-/)]
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

describe('mjs-field — name déduit du champ enveloppé, réévalué si son attribut change', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le name déduit suit l\'attribut name du champ enveloppé quand il change après le montage', async () => {
    const HOST = [
      '<@field label="Pseudo">',
      '  <input name="pseudo">',
      '</@field>',
    ].join('\n')
    const { hote } = await buildAndMount(HOST)
    const fieldEl = hote._shadow.querySelector('mjs-field')
    const input = fieldEl.querySelector('input')
    assert.equal(fieldEl._state.name, 'pseudo', 'préalable : name déduit au montage')

    input.setAttribute('name', 'surnom')
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(fieldEl._state.name, 'surnom', 'le name déduit doit suivre le changement d\'attribut du champ enveloppé')
  })

  it('un name EXPLICITE sur <@field> ignore les changements d\'attribut du champ enveloppé', async () => {
    const HOST = [
      '<@field name="email" label="Adresse e-mail">',
      '  <input name="autre-nom">',
      '</@field>',
    ].join('\n')
    const { hote } = await buildAndMount(HOST)
    const fieldEl = hote._shadow.querySelector('mjs-field')
    const input = fieldEl.querySelector('input')
    assert.equal(fieldEl._state.name, 'email', 'préalable : le name explicite gagne au montage')

    input.setAttribute('name', 'encore-un-autre')
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(fieldEl._state.name, 'email', 'le name explicite ne doit jamais être écrasé par le champ enveloppé')
  })
})
