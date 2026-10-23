// `find`, `findIndex`… d'une liste d'état (composant, µ.state) appellent le prédicat une fois par élément, avec
// l'élément tel que l'état le rend. Défaut garanti absent : le prédicat était appelé deux fois (élément enveloppé,
// puis brut) et l'élément rendu si l'un des deux disait vrai — `$items.find((x) -> x != $sel)` rendait `$sel`
// lui-même, `findIndex` son rang, un prédicat à effet de bord tournait deux fois. Garde : `indexOf` et `includes`
// retrouvent toujours l'élément, tenu brut ou par son enveloppe.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const LISTE = [
  '<script>',
  "$items = [{n: 'a'}, {n: 'b'}]",
  '$sel = null',
  "window.__partageFi ||= µ.state({l: [{n: 'a'}, {n: 'b'}]})",
  'go = ->',
  '  $sel = $items[0]',
  '  r = {}',
  '  r.find = $items.find((x) -> x != $sel)?.n',
  '  r.index = $items.findIndex((x) -> x != $sel)',
  '  appels = 0',
  '  $items.find((x) -> appels += 1; false)',
  '  r.appels = appels',
  '  r.indexOf = $items.indexOf($sel)',
  '  r.includes = $items.includes($sel)',
  '  l = window.__partageFi.l',
  '  s0 = l[0]',
  '  r.etatFind = l.find((x) -> x != s0)?.n',
  '  n = 0',
  '  l.findIndex((x) -> n += 1; false)',
  '  r.etatAppels = n',
  '  window.__r = r',
  '</script>',
  '<button class="go" @click={go()}>go</button>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('liste-find-un-appel')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-lfa-liste.mjs'), LISTE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('liste réactive : `find` appelle le prédicat une fois par élément', function () {
  this.timeout(60000)
  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('prédicat négatif, compte des appels, état de composant et µ.state ; `indexOf` / `includes` intacts', async () => {
    const c = await app.mount('tst-lfa-liste')
    await c.click('.go')
    assert.deepEqual({ ...app.window.__r }, { find: 'b', index: 1, appels: 2, indexOf: 0, includes: true, etatFind: 'b', etatAppels: 2 })
    c.destroy()
  })
})
