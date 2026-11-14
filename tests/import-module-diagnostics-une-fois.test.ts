// un module `.civet` importé par un composant ne se compile qu'une fois par construction, quelle que soit la forme de la
// directive (`@import total '…'` ou `@import { total } '…'`) : le composant qui l'importe et la compilation des modules le
// compilaient chacun de leur côté, ses avertissements et ses erreurs sortaient deux fois. Ses erreurs sont citées une fois,
// au nom du module, même quand elles remontent par le composant, suivies des fichiers qui l'importent (« importé par … ») ;
// deux constructions simultanées sur le même Bundler les citent chacune. Avec eux, deux messages de la directive :
// `@import default {}` propose des écritures valides, et `@import µ$$x` dans une entrée serveur dit que le singleton n'y a
// pas de sens
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { readImportDirectives, importNames } from '../src/transpiler/directives.js'
import { compileServerFile } from '../src/cli/server-entry.js'
import { mjsTmp } from './helpers/tmp.js'

const FORMES       = ["@import total 'regles.civet.mjs'", "@import { total } 'regles.civet.mjs'"]
const MODULE_CASSE = "@import foo 'absent-du-module.civet.mjs'\nexport total := (x) -> x * 2\n"

// pose un projet (chemins relatifs à src) et rend son Bundler
function projet(nom: string, fichiers: Record<string, string>): Bundler {
  const root = mjsTmp(nom)
  const src  = join(root, 'src')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(src, chemin)), { recursive: true })
    writeFileSync(join(src, chemin), contenu)
  }
  return new Bundler({ sourceDir: src, outputDir: join(root, 'out'), manifestPath: join(root, 'out', 'bundle.js') })
}

// construit un projet : les erreurs de la construction et les lignes `[lint.unreachable]` écrites pendant elle
async function construire(nom: string, fichiers: Record<string, string>): Promise<{ erreurs: string[], lignes: string[] }> {
  const b                = projet(nom, fichiers)
  const orig             = console.warn
  const lignes: string[] = []
  console.warn = (...a: unknown[]) => { const s = String(a[0]); if (s.includes('[lint.unreachable]')) lignes.push(s) }
  try {
    const st = await b.compile()
    return { erreurs: st.errors.map(e => String(e.message ?? e)), lignes }
  }
  finally {
    console.warn = orig
    await b.close()
  }
}

const panier = (directive: string): string => `${directive}\n<script>\n  $v = total(2)\n</script>\n<p>{$v}</p>\n`

describe('module importé : une compilation par construction, ses diagnostics cités une fois', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const directive of FORMES) {
    it(`code inaccessible du module : un avertissement (${directive})`, async () => {
      const { erreurs, lignes } = await construire('module-une-fois-avertissement', { 'regles.civet.mjs': 'export total := (x) ->\n  return x * 2\n  x * 3\n', 'panier.mjs': panier(directive) })
      assert.deepEqual(erreurs, [])
      assert.equal(lignes.filter(l => /'regles\.civet\.mjs' \(ligne 3\)/.test(l)).length, 1, JSON.stringify(lignes))
    })

    it(`fichier absent cité par le module : une erreur, au nom du module (${directive})`, async () => {
      const { erreurs } = await construire('module-une-fois-absent', { 'regles.civet.mjs': MODULE_CASSE, 'panier.mjs': panier(directive) })
      const citees      = erreurs.filter(m => m.includes('absent-du-module.civet.mjs'))
      assert.equal(citees.length, 1, JSON.stringify(erreurs))
      assert.match(citees[0], /[/\\]regles\.civet\.mjs: /)
    })

    it(`directive refusée dans le module : une erreur, au nom du module (${directive})`, async () => {
      const { erreurs } = await construire('module-une-fois-refus', { 'regles.civet.mjs': "@import default defaut autre 'vendor/chart.js'\nexport total := (x) -> x * 2\n", 'vendor/chart.js': 'export default function defaut() { return 1 }\n', 'panier.mjs': panier(directive) })
      const citees      = erreurs.filter(m => m.includes("se nomme d'un seul nom"))
      assert.equal(citees.length, 1, JSON.stringify(erreurs))
      assert.match(citees[0], /[/\\]regles\.civet\.mjs: /)
    })
  }

  it('erreur du module : citée une fois, au nom du module, suivie des fichiers qui l\'importent', async () => {
    const { erreurs } = await construire('module-importe-par', { 'regles.civet.mjs': MODULE_CASSE, 'panier.mjs': panier(FORMES[1]), 'caisse.mjs': panier(FORMES[0]) })
    const citees      = erreurs.filter(m => m.includes('absent-du-module.civet.mjs'))
    assert.equal(citees.length, 1, JSON.stringify(erreurs))
    assert.match(citees[0], /[/\\]regles\.civet\.mjs: /)
    assert.match(citees[0], /\n  importé par caisse\.mjs, panier\.mjs$/)
  })

  it('deux constructions simultanées sur le même Bundler : chacune cite l\'erreur du module, une fois', async () => {
    const b      = projet('module-deux-constructions', { 'regles.civet.mjs': MODULE_CASSE, 'panier.mjs': panier(FORMES[1]) })
    const citees = (st: { errors: Error[] }): number => st.errors.filter(e => String(e.message).includes('absent-du-module.civet.mjs')).length
    try {
      const simultanees = await Promise.all([b.compile(), b.compile()])
      const seule       = await b.compile()
      assert.deepEqual([...simultanees, seule].map(citees), [1, 1, 1])
    }
    finally {
      await b.close()
    }
  })
})

describe('@import default aux accolades vides : le message propose des écritures valides', () => {
  for (const ecrite of ["@import default {} 'vendor/chart.js'", "@import default { } 'vendor/chart.js'"]) {
    it(ecrite, () => {
      const [d] = readImportDirectives(ecrite + '\n')
      assert.throws(() => importNames(d), (e: Error) => {
        assert.match(e.message, /@import default nom 'vendor\/chart\.js'/)
        assert.match(e.message, /@import 'vendor\/chart\.js'/)
        assert.doesNotMatch(e.message, /@import default 'vendor/)
        assert.doesNotMatch(e.message, /@import \{ ?\} 'vendor/)
        return true
      })
    })
  }
})

describe('entrée serveur : @import µ$$x refusé, le singleton n\'a pas de sens côté serveur', () => {
  it('le message nomme le singleton et le serveur', async () => {
    const d = mjsTmp('entree-serveur-singleton')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'lib.civet.mjs'), "export x := 'X'\n")
    writeFileSync(join(d, 'e.server.mjs'), "@import µ$$x 'lib.civet.mjs'\nexport res := 1\n")
    await assert.rejects(compileServerFile(join(d, 'e.server.mjs'), d), (e: Error) => {
      assert.match(e.message, /singleton \(µ\$\$\).*côté serveur/)
      assert.match(e.message, /« @import µ\$\$x 'lib\.civet\.mjs' »/)
      assert.doesNotMatch(e.message, /lisible/)
      return true
    })
  })
})
