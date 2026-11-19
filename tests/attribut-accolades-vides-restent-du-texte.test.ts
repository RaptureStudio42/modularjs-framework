// des accolades vides dans une valeur d'attribut entre guillemets (`pattern="[^{}]+"`, `title="{}"`) sont du texte : elles étaient
// lues comme une expression vide, et la construction de TOUT le projet était refusée par un message interne (« c'est un bogue du
// bundler »). Vraie construction (createHarness) d'un composant par cas, attribut lu sur l'élément rendu
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

// l'attribut `attribut` de `.v` dans le composant `texte` construit seul, ou la raison du refus de la construction
const lu = async (texte: string, attribut: string): Promise<string> => {
  const root = mjsTmp('accolades-vides')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'av-champ.mjs'), texte)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  let app: any
  try { app = await createHarness({ root }) }
  catch (e) { return `construction refusée : ${String((e as Error).message).slice(0, 400)}` }
  try {
    const c = await app.mount('av-champ')
    try { return String((c.el._shadow ?? c.el).querySelector('.v')?.getAttribute(attribut)) }
    finally { c.destroy() }
  }
  finally { await app.destroy() }
}

describe('attribut entre guillemets : des accolades vides restent du texte', function () {
  this.timeout(120000)
  it('pattern="[^{}]+" garde [^{}]+', async () => { assert.equal(await lu('<label>nom <input class="v" name="nom" pattern="[^{}]+"></label>\n', 'pattern'), '[^{}]+') })
  it('title="{} et {$n}" garde {} à côté de l\'expression : {} et 3', async () => { assert.equal(await lu('<script>\n$n = 3\n</script>\n<p class="v" title="{} et {$n}">t</p>\n', 'title'), '{} et 3') })
  it('title="{}" garde {}', async () => { assert.equal(await lu('<p class="v" title="{}">t</p>\n', 'title'), '{}') })
})
