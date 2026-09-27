// module cœur radio : sémantique native du groupement — un radio SANS <form> ne se groupe
// qu'avec les radios de même name SANS <form> du même arbre ; un radio DANS un <form> ne se
// groupe qu'avec ceux du MÊME <form>. Deux groupes de même name, l'un dans un <form>, l'autre
// hors de tout <form>, dans le MÊME shadow root, doivent rester indépendants. Patron
// build+happy-dom calqué sur tests/core-radio.test.ts.

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

// MÊME shadow root (celui de l'hôte), MÊME name="opt" : un groupe DANS un <form>, l'autre
// hors de tout <form> — exactement le scénario où le repli `getRootNode() ?? document` était
// trop large.
const HOST = [
  '<form id="avecform" @noUJS>',
  '  <@radio name="opt" value="a">A</@radio>',
  '</form>',
  '<div id="sansform">',
  '  <@radio name="opt" value="b">B</@radio>',
  '</div>',
].join('\n')

async function buildAndMount(): Promise<{ window: any; hote: any }> {
  const root   = mjsTmp('core-radio-groupes')
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
  const code = [pick(/^mjs_core-/), pick(/^radio-/), pick(/^hote-/)]
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

// simule ce que fait un navigateur réel sur un clic radio : le natif passe à
// checked=true PUIS l'événement change se déclenche (@onChange l'écoute)
function check(win: any, native: any) {
  native.checked = true
  native.dispatchEvent(new win.Event('change', { bubbles: true, cancelable: true, composed: true }))
}

async function tick(ms = 30) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('mjs-radio — un groupe hors <form> ne décoche pas un groupe de même name DANS un <form>', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('cocher le radio hors formulaire laisse le radio du formulaire coché (groupes indépendants)', async () => {
    const { window, hote } = await buildAndMount()
    const dansForm = hote._shadow.querySelector('#avecform mjs-radio')
    const horsForm = hote._shadow.querySelector('#sansform mjs-radio')
    assert.ok(dansForm && horsForm, 'les deux <mjs-radio> attendus')
    const nativeDansForm = dansForm._shadow.querySelector('input.native')
    const nativeHorsForm = horsForm._shadow.querySelector('input.native')

    check(window, nativeDansForm)
    await tick()
    assert.equal(nativeDansForm.checked, true, 'préalable : le radio du formulaire est coché')

    check(window, nativeHorsForm)
    await tick()
    assert.equal(nativeHorsForm.checked, true, 'le radio hors formulaire doit être coché par son propre clic')
    assert.equal(nativeDansForm.checked, true, 'le radio DANS le formulaire doit rester coché : groupe différent, même name')
  })

  it('inversement, cocher le radio du formulaire ne décoche pas celui hors formulaire', async () => {
    const { window, hote } = await buildAndMount()
    const dansForm = hote._shadow.querySelector('#avecform mjs-radio')
    const horsForm = hote._shadow.querySelector('#sansform mjs-radio')
    const nativeDansForm = dansForm._shadow.querySelector('input.native')
    const nativeHorsForm = horsForm._shadow.querySelector('input.native')

    check(window, nativeHorsForm)
    await tick()
    assert.equal(nativeHorsForm.checked, true, 'préalable : le radio hors formulaire est coché')

    check(window, nativeDansForm)
    await tick()
    assert.equal(nativeDansForm.checked, true, 'le radio du formulaire doit être coché par son propre clic')
    assert.equal(nativeHorsForm.checked, true, 'le radio hors formulaire doit rester coché : groupe différent, même name')
  })
})
