// testing/index (harnais applicatif) — fire() doit construire la bonne classe d'évènement
// selon le type (KeyboardEvent pour key*, CustomEvent quand un detail est fourni…) pour que
// les propriétés spécifiques (key, detail) atteignent le gestionnaire ; click() doit
// déclencher l'activation native (comme un vrai navigateur) pour qu'une case à cocher bascule.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CIBLE = [
  '<script>',
  "$lastKey = ''",
  "$lastDetail = ''",
  "onKey = (e) -> $lastKey = if e.key then e.key else '(perdu)'",
  "onPing = (e) -> $lastDetail = if e.detail then JSON.stringify(e.detail) else '(perdu)'",
  '</script>',
  '<input class="kb" @keydown={onKey} @ping={onPing}>',
  '<p class="key-out">{$lastKey}</p>',
  '<p class="detail-out">{$lastDetail}</p>',
  '<input class="cb" type="checkbox">',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('testing-evenements')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-cible.mjs'), CIBLE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('testing/createHarness — fire() et click() fidèles au navigateur', function () {
  this.timeout(60000)

  let root: string
  let app: any

  before(async () => {
    root = projetTemporaire()
    app  = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('fire(sel, "keydown", { key }) construit un KeyboardEvent : key atteint le gestionnaire', async () => {
    const c = await app.mount('tst-cible')
    await c.fire('.kb', 'keydown', { key: 'Enter', code: 'Enter' })
    assert.equal(c.text('.key-out'), 'Enter')
    c.destroy()
  })

  it('fire() avec un detail construit un évènement dont le detail atteint le gestionnaire', async () => {
    const c = await app.mount('tst-cible')
    await c.fire('.kb', 'ping', { detail: { n: 42 } })
    assert.equal(c.text('.detail-out'), '{"n":42}')
    c.destroy()
  })

  it('click() sur une case à cocher la coche, comme un vrai navigateur', async () => {
    const c = await app.mount('tst-cible')
    assert.equal(c.find('.cb').checked, false)
    await c.click('.cb')
    assert.equal(c.find('.cb').checked, true)
    c.destroy()
  })
})
