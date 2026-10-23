// Dossier de sortie dans le dossier des sources : les sorties à nom fixe (la feuille de mise en page `<module>.<nom>.css`
// d'un `<style name="…">`, `mjs-precache.json`, le manifeste) tombaient sur le fichier de l'auteur du même nom et le
// réécrivaient sans un mot, construction en code 0. Un fichier existant n'est désormais remplacé que s'il porte la marque
// des fichiers que la construction produit : sinon le build s'arrête sur une erreur qui nomme le fichier, et le fichier
// reste intact. Ceux que le build a lui-même écrits se réécrivent d'un tour à l'autre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const carte    = (couleur: string) => ['<p class="c">carte</p>', '<style>', '  .c', '    color: red', '</style>', '<style name="large">', '  .c', `    color: ${couleur}`, '</style>'].join('\n')
const feuille  = '/* feuille de l auteur pour la variante large */\n.c { font-size: 2em }\n'
const precache = '{ "auteur": true }\n'
const entree   = 'export const entree = 1 // fichier de l auteur\n'

function projet(prefixe: string): string {
  const app = mjsTmp(prefixe)
  mkdirSync(app, { recursive: true })
  writeFileSync(join(app, 'carte.mjs'), carte('blue'))
  writeFileSync(join(app, 'page.mjs'), '<mjs-carte layout="large"></mjs-carte>\n')
  return app
}

const surPlace = (app: string, keep: boolean) => ({ sourceDir: app, outputDir: app, manifestPath: join(app, 'bundle.js'), keepFailedComponents: keep })

async function construire(opts: Record<string, unknown>): Promise<string[]> {
  const b = new Bundler(opts)
  const s = await b.compile()
  await b.close()
  return s.errors.map(e => e.message)
}

describe('sortie dans le dossier des sources : une sortie à nom fixe ne remplace jamais un fichier de l\'auteur', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const keep of [false, true]) {
    const mode = keep ? 'développement' : 'build'

    it(`${mode} : \`carte.large.css\` de l'auteur reste intacte, une erreur la nomme`, async () => {
      const app = projet(`noms-fixes-feuille-${keep}`)
      writeFileSync(join(app, 'carte.large.css'), feuille)
      const erreurs = await construire(surPlace(app, keep))
      assert.equal(readFileSync(join(app, 'carte.large.css'), 'utf-8'), feuille, 'feuille de l\'auteur réécrite')
      assert.ok(erreurs.some(m => m.includes('carte.large.css')), erreurs.join('\n') || 'aucune erreur')
    })

    it(`${mode} : \`mjs-precache.json\` de l'auteur reste intact, une erreur le nomme`, async () => {
      const app = projet(`noms-fixes-precache-${keep}`)
      writeFileSync(join(app, 'mjs-precache.json'), precache)
      const erreurs = await construire(surPlace(app, keep))
      assert.equal(readFileSync(join(app, 'mjs-precache.json'), 'utf-8'), precache, 'liste de l\'auteur réécrite')
      assert.ok(erreurs.some(m => m.includes('mjs-precache.json')), erreurs.join('\n') || 'aucune erreur')
    })

    it(`${mode} : un manifeste sur un fichier de l'auteur des sources reste intact, une erreur le nomme`, async () => {
      const app = projet(`noms-fixes-manifeste-${keep}`)
      writeFileSync(join(app, 'entree.js'), entree)
      const erreurs = await construire({ ...surPlace(app, keep), manifestPath: join(app, 'entree.js') })
      assert.equal(readFileSync(join(app, 'entree.js'), 'utf-8'), entree, 'fichier de l\'auteur réécrit')
      assert.ok(erreurs.some(m => m.includes('entree.js')), erreurs.join('\n') || 'aucune erreur')
    })
  }

  it('témoin : sans fichier de l\'auteur, deux constructions sur place réécrivent les sorties à nom fixe sans erreur', async () => {
    const app = projet('noms-fixes-temoin')
    assert.deepEqual(await construire(surPlace(app, false)), [])
    assert.match(readFileSync(join(app, 'carte.large.css'), 'utf-8'), /blue/)
    assert.ok(existsSync(join(app, 'mjs-precache.json')))
    writeFileSync(join(app, 'carte.mjs'), carte('green'))
    writeFileSync(join(app, 'autre.mjs'), '<p>autre</p>\n')
    assert.deepEqual(await construire(surPlace(app, false)), [])
    assert.match(readFileSync(join(app, 'carte.large.css'), 'utf-8'), /green/)
    assert.match(readFileSync(join(app, 'bundle.js'), 'utf-8'), /autre/)
  })

  it('témoin : sortie hors des sources, la construction reste verte', async () => {
    const root = mjsTmp('noms-fixes-sortie-distincte')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'carte.mjs'), carte('blue'))
    writeFileSync(join(src, 'page.mjs'), '<mjs-carte layout="large"></mjs-carte>\n')
    const opts = { sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), keepFailedComponents: false }
    assert.deepEqual(await construire(opts), [])
    assert.deepEqual(await construire(opts), [])
    assert.match(readFileSync(join(out, 'carte.large.css'), 'utf-8'), /blue/)
  })
})
