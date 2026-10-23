// Manifeste (`manifestPath`) qui tombe sur un fichier vide (0 octet) : la garde des fichiers de l'auteur le refusait comme
// tout fichier qu'une construction n'a pas produit, alors qu'il n'a rien à perdre (fichier créé d'avance, écriture
// interrompue). Il est maintenant remplacé sans refus, hors du dossier des sources comme dedans ; un fichier qui n'est pas
// vide et n'est pas une sortie reste refusé, intact, dès son premier octet.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool, MARQUE_SORTIE } from '../src/bundler/index.js'

// hors des sources : appli Rails, manifeste dans app/assets/javascripts ; dans les sources : projet qui construit sous son
// dossier des sources (`sourceDir: "."`), manifeste dans le dossier de sortie
function projet(prefixe: string, dansSources: boolean): { opts: Record<string, unknown>, manifeste: string } {
  const root      = mjsTmp(prefixe)
  const sources   = dansSources ? root : join(root, 'app', 'modularjs')
  const manifeste = dansSources ? join(root, 'public', 'modularjs', 'bundle.js') : join(root, 'app', 'assets', 'javascripts', 'application.js')
  mkdirSync(join(sources, 'composants'), { recursive: true })
  mkdirSync(dirname(manifeste), { recursive: true })
  writeFileSync(join(sources, 'composants', 'carte.mjs'), '<p>carte</p>\n')
  return { opts: { sourceDir: sources, outputDir: join(root, 'public', 'modularjs'), manifestPath: manifeste, urlPrefix: '/modularjs', keepFailedComponents: false }, manifeste }
}

async function construire(opts: Record<string, unknown>): Promise<string[]> {
  const b = new Bundler(opts)
  try {
    return (await b.compile()).errors.map(e => e.message)
  }
  finally {
    await b.close()
  }
}

describe('manifeste sur un fichier vide : remplacé sans refus, il n\'a rien à perdre', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const js of ['split', 'bundle']) {
    it(`hors du dossier des sources, js: "${js}" : le fichier vide devient le manifeste`, async () => {
      const { opts, manifeste } = projet(`manifeste-vide-${js}`, false)
      writeFileSync(manifeste, '')
      assert.deepEqual(await construire({ ...opts, js }), [])
      assert.notEqual(readFileSync(manifeste, 'utf-8'), '', 'manifeste non écrit')
      assert.deepEqual(await construire({ ...opts, js }), [], 'seconde construction')
    })
  }

  it('dans le dossier des sources : le fichier vide devient le manifeste, marqué', async () => {
    const { opts, manifeste } = projet('manifeste-vide-sources', true)
    writeFileSync(manifeste, '')
    assert.deepEqual(await construire(opts), [])
    assert.ok(readFileSync(manifeste, 'utf-8').startsWith(`${MARQUE_SORTIE}\n`), 'manifeste sans marque')
  })

  it('un fichier d\'un seul octet n\'est pas vide : refusé, intact, hors des sources comme dedans', async () => {
    for (const dansSources of [false, true]) {
      const { opts, manifeste } = projet(`manifeste-un-octet-${dansSources ? 'sources' : 'dehors'}`, dansSources)
      writeFileSync(manifeste, '\n')
      const erreurs = await construire(opts)
      assert.equal(erreurs.length, 1, erreurs.join('\n'))
      assert.ok(erreurs[0].includes(manifeste), erreurs[0])
      assert.equal(readFileSync(manifeste, 'utf-8'), '\n', 'fichier de l\'auteur remplacé')
    }
  })
})
