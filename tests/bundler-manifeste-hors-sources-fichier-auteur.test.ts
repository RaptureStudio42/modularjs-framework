// Manifeste rangé hors du dossier des sources (`manifestPath`) : il remplaçait tout fichier de ce nom, même un fichier de
// l'auteur (`app/assets/javascripts/application.js` d'une appli Rails). Un fichier qui existe déjà et n'est ni marqué ni
// reconnaissable comme un manifeste ModularJS (fichier unique compris, version précédente comprise) est maintenant refusé
// avant toute écriture ; un projet qui monte de version n'est pas refusé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const auteur       = '//= require rails-ujs\nconsole.log(\'application de l auteur\')\n'
// manifeste écrit par la 2.5.0 (sans marque)
const manifeste250 = ["const µCore = '/modularjs/mjs_core-5f4edbfe.js';", 'const µPaths = {"carte":"carte-25b0059f.js"};', 'const µReady = import(µCore).then(async ({ µ }) => {', '  µ.paths = µPaths;', '  µ.version = "7ec786c6";', '});'].join('\n')

function projet(prefixe: string): { root: string, manifeste: string } {
  const root = mjsTmp(prefixe)
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  mkdirSync(join(root, 'app', 'assets', 'javascripts'), { recursive: true })
  writeFileSync(join(root, 'app', 'modularjs', 'carte.mjs'), '<p>carte</p>\n')
  return { root, manifeste: join(root, 'app', 'assets', 'javascripts', 'application.js') }
}

async function construire(root: string, manifeste: string, reglages: Record<string, unknown> = {}): Promise<string[]> {
  const b = new Bundler({ sourceDir: join(root, 'app', 'modularjs'), outputDir: join(root, 'public', 'modularjs'), manifestPath: manifeste, urlPrefix: '/modularjs', keepFailedComponents: false, ...reglages })
  try {
    return (await b.compile()).errors.map(e => e.message)
  }
  finally {
    await b.close()
  }
}

describe('manifeste hors du dossier des sources : jamais à la place d\'un fichier de l\'auteur', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const js of ['split', 'bundle']) {
    it(`js: "${js}" : application.js de l'auteur refusé, intact, rien d'écrit`, async () => {
      const { root, manifeste } = projet(`manifeste-auteur-${js}`)
      writeFileSync(manifeste, auteur)
      const erreurs = await construire(root, manifeste, { js })
      assert.equal(erreurs.length, 1, erreurs.join('\n'))
      assert.ok(erreurs[0].includes(manifeste), erreurs[0])
      assert.match(erreurs[0], /Rien n'a été écrit/)
      assert.equal(readFileSync(manifeste, 'utf-8'), auteur, 'fichier de l\'auteur remplacé')
      assert.equal(existsSync(join(root, 'public', 'modularjs')), false, 'sorties écrites malgré le refus')
    })

    it(`js: "${js}" : le manifeste d'une construction précédente est remplacé, deux fois de suite`, async () => {
      const { root, manifeste } = projet(`manifeste-reconstruit-${js}`)
      assert.deepEqual(await construire(root, manifeste, { js }), [])
      assert.deepEqual(await construire(root, manifeste, { js, env: 'prod' }), [])
      assert.deepEqual(await construire(root, manifeste, { js }), [])
    })
  }

  it('manifeste de la 2.5.0 : la mise à jour n\'est pas refusée', async () => {
    const { root, manifeste } = projet('manifeste-250')
    writeFileSync(manifeste, manifeste250)
    assert.deepEqual(await construire(root, manifeste), [])
    assert.notEqual(readFileSync(manifeste, 'utf-8'), manifeste250)
  })
})
