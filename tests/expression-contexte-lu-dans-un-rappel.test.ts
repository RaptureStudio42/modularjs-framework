// une clé de contexte (`§n`, `§§cfg.seuil`) lue dans un rappel `->` d'une expression du gabarit (`{$l.map((x) -> x + §n)}`) : le rappel
// est une `function`, qui a son propre `this` ; la clé se lit sur le composant (`_mjsThis`), comme `@@x`. Sans cela le rendu
// levait et le composant n'affichait rien. Vraie construction (createHarness), texte rendu lu ; la lecture hors d'un rappel et
// le gestionnaire (son `->` devient `=>`) servent de témoins
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const fichiers: Record<string, string> = {
  'cr-direct.mjs': ['<script>', '§n = 10', '$l = [1, 2]', '</script>', '<p class="v">{$l.length + §n}</p>'].join('\n'),
  'cr-rappel.mjs': ['<script>', '§n = 10', '$l = [1, 2]', '</script>', '<p class="v">{$l.map((x) -> x + §n).join(",")}</p>'].join('\n'),
  'cr-reactif-direct.mjs': ['<script>', '§§cfg = { seuil: 3 }', '$l = [1, 2, 5]', '</script>', '<p class="v">{§§cfg.seuil}</p>'].join('\n'),
  'cr-reactif-rappel.mjs': ['<script>', '§§cfg = { seuil: 3 }', '$l = [1, 2, 5]', '</script>', '<p class="v">{$l.filter((x) -> x < §§cfg.seuil).length}</p>'].join('\n'),
  'cr-geste.mjs': ['<script>', '§n = 10', '$l = [1, 2]', '$s = 0', '</script>', '<p class="v">{$s}</p>', '<button class="b" @click={-> $l.forEach((x) -> $s += x + §n)}>b</button>'].join('\n'),
}

describe('expression du gabarit : une clé de contexte lue dans un rappel `->`', function () {
  this.timeout(120000)
  let app: any
  before(async () => {
    const root = mjsTmp('contexte-rappel')
    mkdirSync(join(root, 'src'), { recursive: true })
    for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(root, 'src', nom), texte)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })
  after(async () => { if (app) await app.destroy() })

  // le texte de `.v` après le montage (et le clic sur `.b`), ou ce qui a levé ; les erreurs dites à la console sont jointes
  const texte = async (nom: string, clic = false): Promise<string> => {
    const erreurs: string[] = []
    const garde = console.error
    console.error = (...x: unknown[]) => { erreurs.push(x.map(String).join(' ').slice(0, 300)) }
    try {
      const c = await app.mount(nom)
      try {
        if (clic) await c.click('.b')
        const v = (c.el._shadow ?? c.el.shadowRoot ?? c.el).querySelector('.v')
        return v ? v.textContent : `rien de rendu ; console : ${erreurs.join(' | ')}`
      }
      finally { c.destroy() }
    }
    catch (e) {
      return `levé : ${String((e as Error).message).slice(0, 300)} ; console : ${erreurs.join(' | ')}`
    }
    finally { console.error = garde }
  }

  it('témoin : `{$l.length + §n}` hors d\'un rappel affiche 12', async () => { assert.equal(await texte('cr-direct'), '12') })
  it('`{$l.map((x) -> x + §n).join(",")}` affiche 11,12', async () => { assert.equal(await texte('cr-rappel'), '11,12') })
  it('témoin : `{§§cfg.seuil}` hors d\'un rappel affiche 3', async () => { assert.equal(await texte('cr-reactif-direct'), '3') })
  it('`{$l.filter((x) -> x < §§cfg.seuil).length}` affiche 2', async () => { assert.equal(await texte('cr-reactif-rappel'), '2') })
  it('témoin : le gestionnaire `@click={-> $l.forEach((x) -> $s += x + §n)}` affiche 23', async () => { assert.equal(await texte('cr-geste', true), '23') })
})
