// un attribut d'une ligne de {for} qui vaut la comparaison d'un champ de la ligne à une variable (`data-on={t.id is $sel}`) suit la règle de toute
// valeur calculée : `false` retire un `data-*`, un `aria-*` (et `draggable`) s'écrit « false » — un sélecteur `[data-on]` ne trouve que la ligne
// choisie, au montage et après un changement de sélection, comme la même valeur écrite entre parenthèses — vraie construction
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const script = `<button class="b" @click={-> $sel = 2}>b</button>\n<script>\n  $l = [{ id: 1 }, { id: 2 }]\n  $sel = 1\n</script>\n`
const fichiers: Record<string, string> = {
  'a-filtre.mjs': `<ul>{for t in $l by id}<li data-r data-on={t.id is $sel} aria-selected={t.id is $sel} draggable={t.id is $sel}>{t.id}</li>{end}</ul>` + script,
  'a-filtre-temoin.mjs': `<ul>{for t in $l by id}<li data-r data-on={(t.id is $sel)} aria-selected={(t.id is $sel)} draggable={(t.id is $sel)}>{t.id}</li>{end}</ul>` + script
}

describe('attribut filtré d\'une ligne de {for} : false retire un data-*, comme hors du filtre', function () {
  this.timeout(200000)
  let app: any
  before(async () => {
    const root = mjsTmp('attribut-filtre-booleen')
    mkdirSync(join(root, 'src'), { recursive: true })
    for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(root, 'src', nom), texte)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })
  after(async () => { if (app) await app.destroy() })

  // pour chaque ligne : data-on, aria-selected, draggable (null = absent), et les lignes que trouve `[data-on]`, au montage puis après le clic
  const etat = async (nom: string): Promise<unknown[]> => {
    const c = await app.mount(nom)
    try {
      await c.tick()
      const lire = () => [c.findAll('[data-r]').map((li: any) => [li.getAttribute('data-on'), li.getAttribute('aria-selected'), li.getAttribute('draggable')]), c.findAll('[data-on]').map((li: any) => li.textContent)]
      const montage = lire()
      await c.click('.b')
      await c.tick()
      return [montage, lire()]
    }
    finally { c.destroy() }
  }

  it('au montage et après un changement de sélection : [data-on] ne trouve que la ligne choisie, aria-selected et draggable gardent « false »', async () => {
    const lu = await etat('a-filtre')
    assert.deepEqual(lu, [
      [[['true', 'true', 'true'], [null, 'false', 'false']], ['1']],
      [[[null, 'false', 'false'], ['true', 'true', 'true']], ['2']]
    ])
    assert.deepEqual(lu, await etat('a-filtre-temoin'))
  })
})
