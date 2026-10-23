// Ranger une liste dans un état (`$favs = favs`, `partage.l = liste`) ne modifie jamais la liste donnée. Défaut garanti
// absent : l'affectation remplaçait EN PLACE, dans la liste de l'auteur, les éléments lus par l'enveloppe (`$items[0]`)
// par leurs données brutes — `favs.includes(x)` passait de vrai à faux après `$favs = favs`, une liste gelée
// l'aurait refusé. L'état range une copie brute (`indexOf` y retrouve l'élément) ; la liste de l'auteur reste telle
// quelle.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const LISTE = [
  '<script>',
  "$items = [{n: 'a'}, {n: 'b'}]",
  '$favs = []',
  'window.__r = {}',
  'window.__partageLi ||= µ.state({l: []})',
  'locale = ->',
  '  x = $items[0]',
  '  favs = [x]',
  '  $favs = favs',
  "  window.__r.locale = [favs.includes(x), favs[0] == x, $favs.indexOf(x)].join(',')",
  'partagee = ->',
  '  x = $items[0]',
  '  liste = [x]',
  '  window.__partageLi.l = liste',
  '  window.__r.partagee = liste.includes(x)',
  '</script>',
  '<button class="locale" @click={locale()}>l</button><button class="partagee" @click={partagee()}>p</button>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('etat-liste-intacte')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-lai-liste.mjs'), LISTE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('état : la liste affectée reste intacte chez son auteur', function () {
  this.timeout(60000)
  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('`$favs = favs` : la liste locale garde ses éléments (`includes`, identité), l\'état les retrouve', async () => {
    const c = await app.mount('tst-lai-liste')
    await c.click('.locale')
    assert.equal(app.window.__r.locale, 'true,true,0')
    c.destroy()
  })

  it('`partage.l = liste` (µ.state) : la liste donnée garde ses éléments', async () => {
    const c = await app.mount('tst-lai-liste')
    await c.click('.partagee')
    assert.equal(app.window.__r.partagee, true)
    c.destroy()
  })
})
