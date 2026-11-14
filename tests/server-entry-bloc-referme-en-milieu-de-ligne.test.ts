// Test — fichiers serveur en CoffeeScript ou dans le dialecte (`*.server.mjs`, `*.civet.mjs`, `*.coffee.mjs`, `.coffee`
// brut) : un bloc `###` se referme au premier `###` qui suit, même en milieu de ligne, pour leur compilateur (CoffeeScript,
// balayeur du dialecte) ; le code écrit après ce `###` est du code. Civet lit autrement un `###` suivi de code sur sa ligne
// (il n'y referme rien et ouvre un bloc jusqu'au `###` d'une fin de ligne plus bas) : une directive écrite entre les deux
// reste refusée, jamais compilée en appel de méthode (`this.css(…)`)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
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
const REFUS_BRUT    = /n'existe pas|doesn't exist/
const FIN           = 'export default { setup: (app) -> 1 }'

async function compiler(nom: string, source: string): Promise<string> {
  const root = freshRoot('bloc-milieu')
  const path = join(root, nom)
  writeFileSync(path, source)
  return /\.(?:civet|coffee)$/.test(nom) ? compileRawCivetFile(path, root) : compileServerFile(path, root)
}

describe('cli/server-entry — un bloc ### refermé en milieu de ligne ne cache pas la directive écrite dessous', function () {
  this.timeout(20000)

  const ENTETE = ['### Aide', '### aide = 1', '@css \'a.css\'', '###', 'fin = 2', '###', FIN, ''].join('\n')
  const MILIEU = ['###', 'foo ### x = 1', '@css \'a.css\'', '###', 'y = 2', '###', FIN, ''].join('\n')
  const LIGNE  = ['x = 1 ### c ### y = 2', '@css \'a.css\'', '###', 'z = 3', '###', FIN, ''].join('\n')

  for (const nom of ['app.server.mjs', 'a.civet.mjs', 'app.server.coffee.mjs']) {
    it(`${nom} : \`### Aide\` refermé par \`### aide = 1\`, puis @css → refusée`, async () => {
      await assert.rejects(compiler(nom, ENTETE), REFUS_SERVEUR)
    })
    it(`${nom} : bloc refermé par \`foo ### x = 1\`, puis @css → refusée`, async () => {
      await assert.rejects(compiler(nom, MILIEU), REFUS_SERVEUR)
    })
  }

  it('lib.coffee brut : bloc refermé en milieu de ligne, puis @css → refusée', async () => {
    await assert.rejects(compiler('lib.coffee', MILIEU), REFUS_BRUT)
  })

  it('app.server.mjs : `x = 1 ### c ### y = 2`, puis @css → refusée', async () => {
    await assert.rejects(compiler('app.server.mjs', LIGNE), REFUS_SERVEUR)
  })

  // une chaîne que Civet ouvre dans ce bloc (`foo "### x = 1`) court jusqu'au guillemet d'un commentaire plus bas
  const CHAINE = ['###', 'foo "### x = 1', '@css \'a.css\'', 'y = 2 # "', '###', '###', FIN, ''].join('\n')
  for (const nom of ['app.server.mjs', 'app.server.coffee.mjs', 'lib.coffee']) {
    it(`${nom} : guillemet dans le bloc refermé en milieu de ligne, puis @css → refusée`, async () => {
      await assert.rejects(compiler(nom, CHAINE), nom === 'lib.coffee' ? REFUS_BRUT : REFUS_SERVEUR)
    })
  }

  it('app.server.mjs : bloc refermé en milieu de ligne, puis @import → jamais compilé en this.import(…)', async () => {
    await assert.rejects(compiler('app.server.mjs', MILIEU.replace('@css \'a.css\'', '@import chemin \'node:path\'')))
  })
})
