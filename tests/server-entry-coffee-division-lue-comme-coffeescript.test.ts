// Test — fichiers serveur en CoffeeScript (`*.coffee.mjs`, `.coffee` brut) : après un nombre, une chaîne, `true`, `null`,
// `{}` ou une regex, CoffeeScript lit `/` comme une division, jamais comme l'ouverture d'une regex (`2 /b; c = "/` divise,
// et le guillemet ouvre une chaîne) ; le mode CoffeeScript de Civet y lit une regex. Une directive que CoffeeScript compile
// en appel (`this.css(…)`) reste refusée, et une ligne que CoffeeScript range dans une chaîne ou un bloc `###` n'est pas
// refusée, comme avant toute lecture par l'arbre

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileServerFile, compileRawCivetFile } from '../src/cli/server-entry.js'
import { mjsTmp } from './helpers/tmp.js'

const tmpDirs: string[] = []
function freshRoot(prefix: string): string {
  const root = mjsTmp(prefix)
  tmpDirs.push(root)
  mkdirSync(join(root, 'node_modules'))   //cache SOUS node_modules, jamais os.tmpdir() (serverCacheDir)
  return root
}
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

const REFUS_SERVEUR = /n'a pas de sens|makes no sense/
const REFUS_BRUT    = /n'existe pas|doesn't exist|se sert de/
const FIN           = 'export default { setup: (app) -> 1 }'

async function compiler(nom: string, source: string): Promise<string> {
  const root = freshRoot('coffee-division')
  const path = join(root, nom)
  writeFileSync(path, source)
  const url  = await (/\.(?:civet|coffee)$/.test(nom) ? compileRawCivetFile(path, root) : compileServerFile(path, root))
  return readFileSync(fileURLToPath(url.replace(/\?v=\d+$/, '')), 'utf8')
}

describe('cli/server-entry — CoffeeScript : une division lue comme une division au contrôle des directives', function () {
  this.timeout(20000)

  const CACHEE = ['x = 2 /b; c = "/ + "', '@css \'a.css\'', '" # "', FIN, ''].join('\n')
  const RETRAIT = ['f = ->', '  x = 2 /b; c = "/ + "', '  @css \'a.css\'', '  " # "', FIN, ''].join('\n')
  const ACCOLADES = ['x = {} /b; c = "/ + "', '@lang \'fr\'', '" # "', FIN, ''].join('\n')
  const GRAVE = ['x = 2 /`/g; y = `', '@css \'a.css\'', '` # `', FIN, ''].join('\n')

  for (const nom of ['app.server.coffee.mjs', 'lib.coffee']) {
    const refus = nom === 'lib.coffee' ? REFUS_BRUT : REFUS_SERVEUR
    it(`${nom} : \`x = 2 /b; c = "/ + "\` divise, puis @css → refusée`, async () => {
      await assert.rejects(compiler(nom, CACHEE), refus)
    })
    it(`${nom} : la même division dans une fonction, puis @css en retrait → refusée`, async () => {
      await assert.rejects(compiler(nom, RETRAIT), refus)
    })
    it(`${nom} : \`{} /b\` divise, puis @lang → refusée`, async () => {
      await assert.rejects(compiler(nom, ACCOLADES), refus)
    })
    it(`${nom} : \`2 /\\\`/g\` divise, puis @css → refusée`, async () => {
      await assert.rejects(compiler(nom, GRAVE), refus)
    })
  }

  it('app.server.coffee.mjs : la division, puis @import → importé, jamais compilé en this.import(…)', async () => {
    const js = await compiler('app.server.coffee.mjs', CACHEE.replace('@css \'a.css\'', '@import chemin \'node:path\''))
    assert.ok(!/this\.import\b/.test(js), 'this.import compilé')
    assert.match(js, /from ['"]node:path['"]/)
  })

  // le guillemet que la division laisse au code ouvre une chaîne qui court sur la ligne d'après : du texte
  const CHAINE = ['y = 2 /b; c = "/', '@css \'a.css\'', '" # "', FIN, ''].join('\n')
  const BLOC   = ['x = 2 /###/g', '@css \'a.css\'', '# ### 3', FIN, ''].join('\n')
  for (const nom of ['app.server.coffee.mjs', 'lib.coffee']) {
    it(`${nom} : \`2 /b; c = "/\` ouvre une chaîne, la ligne @css qu'elle porte n'est pas une directive`, async () => {
      const js = await compiler(nom, CHAINE)
      assert.ok(!/this\.css\b/.test(js), 'this.css compilé')
    })
    it(`${nom} : \`2 /###/g\` ouvre un bloc ###, la ligne @css qu'il porte n'est pas une directive`, async () => {
      const js = await compiler(nom, BLOC)
      assert.ok(!/this\.css\b/.test(js), 'this.css compilé')
    })
  }
})
