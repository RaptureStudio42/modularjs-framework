// le quantifieur d'une expression régulière dans une valeur d'attribut entre guillemets (`pattern="[0-9]{5}"`, `{2,4}`, `{3,}`)
// est du texte : il était lu comme une expression à afficher (`[0-9]5`, et `{2,4}` donnait `4`) ; une vraie expression (`{$n}`)
// garde sa lecture. Vraie construction (createHarness) d'un composant par cas, attribut lu sur l'élément rendu
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

// le `pattern` de `.v` dans le composant `texte` construit seul, ou la raison du refus de la construction
const motif = async (texte: string): Promise<string> => {
  const root = mjsTmp('quantifieur-motif')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'qm-champ.mjs'), texte)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  let app: any
  try { app = await createHarness({ root }) }
  catch (e) { return `construction refusée : ${String((e as Error).message).slice(0, 400)}` }
  try {
    const c = await app.mount('qm-champ')
    try { return String((c.el._shadow ?? c.el).querySelector('.v')?.getAttribute('pattern')) }
    finally { c.destroy() }
  }
  finally { await app.destroy() }
}

describe('attribut entre guillemets : le quantifieur d\'un motif reste du texte', function () {
  this.timeout(120000)
  it('pattern="[0-9]{5}" garde [0-9]{5}', async () => { assert.equal(await motif('<label>cp <input class="v" name="cp" pattern="[0-9]{5}"></label>\n'), '[0-9]{5}') })
  it('pattern="[a-z]{2,4}" garde [a-z]{2,4}', async () => { assert.equal(await motif('<label>mot <input class="v" name="mot" pattern="[a-z]{2,4}"></label>\n'), '[a-z]{2,4}') })
  it('pattern="[A-Z]{3,}" garde [A-Z]{3,}', async () => { assert.equal(await motif('<label>code <input class="v" name="code" pattern="[A-Z]{3,}"></label>\n'), '[A-Z]{3,}') })
  it('pattern="[0-9]{5}-{$n}" garde le quantifieur à côté de l\'expression : [0-9]{5}-3', async () => { assert.equal(await motif('<script>\n$n = 3\n</script>\n<label>cp <input class="v" name="cp" pattern="[0-9]{5}-{$n}"></label>\n'), '[0-9]{5}-3') })
  it('pattern="{$n}[a-z]{2,}" garde le quantifieur après l\'expression : 3[a-z]{2,}', async () => { assert.equal(await motif('<script>\n$n = 3\n</script>\n<label>mot <input class="v" name="mot" pattern="{$n}[a-z]{2,}"></label>\n'), '3[a-z]{2,}') })
  it('témoin : pattern="[0-9]{$n}" lit l\'expression et donne [0-9]5', async () => { assert.equal(await motif('<script>\n$n = 5\n</script>\n<label>cp <input class="v" name="cp" pattern="[0-9]{$n}"></label>\n'), '[0-9]5') })
})
