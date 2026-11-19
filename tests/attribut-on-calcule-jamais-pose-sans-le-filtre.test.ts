// un attribut `on…` dont la valeur est calculée n'est jamais posé sur une balise HTML : le filtre des attributs du runtime le refuse, et le
// compilateur ne l'en dispense jamais (un nom `on…` reste un nom à risque). Deux chemins le prouvent : un `$x` écrit sans accolade dans le
// texte d'un `onclick` (la valeur devient calculée, le nom est écrit dans le gabarit) et un étalement `{...o}` (nom calculé) — vraie
// construction, la page ne porte aucun des deux gestionnaires ; un attribut sans risque de l'étalement est posé
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = `<button class="v" onclick="window.__n = $x">b</button>
<p class="e" {...$o}>e</p>
<script>
  $x = 7
  $o = { onclick: 'window.__n = 1', 'data-x': 'x' }
</script>
`

describe('attribut on… calculé : jamais posé sans le filtre des attributs', function () {
  this.timeout(200000)

  it('`onclick="window.__n = $x"` et un étalement qui porte `onclick` : aucun gestionnaire sur la page, data-x posé', async () => {
    const root = mjsTmp('attribut-on-calcule')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'on-calcule.mjs'), SOURCE)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    const app = await createHarness({ root })
    try {
      const c = await app.mount('on-calcule')
      await c.tick()
      assert.deepEqual([c.find('.v').getAttribute('onclick'), c.find('.e').getAttribute('onclick'), c.find('.e').getAttribute('data-x')], [null, null, 'x'])
      c.destroy()
    }
    finally { await app.destroy() }
  })
})
