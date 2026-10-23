// Dossier de sortie dans le dossier des sources : quatre sorties à nom fixe échappaient encore à la garde des fichiers de
// l'auteur — le registre des variables de thème (`.mjs-theme-vars.json`, développement), les noms courts de la minification
// (`.mangle-cache.json`, production), la carte du fichier unique (`<manifeste>.map`, `js: "bundle"`) et les fragments de
// traduction à nom clair (`i18n/<langue>/<section>.json`). Un fichier de l'auteur de ce nom était remplacé sans un mot.
// Un fichier qui n'a pas la forme de cette sortie est maintenant refusé avant toute écriture ; celui qu'une construction
// a écrit, de cette version ou d'une précédente, est reconnu à sa forme et remplacé comme avant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const composant = '<style>\n  :host\n    --mjs-alerte: red\n</style>\n<p>{µt(\'admin.titre\')}</p>\n'

// projet qui construit dans ses sources (`sourceDir` = la racine), sortie sous public/modularjs
function projet(prefixe: string): string {
  const root = mjsTmp(prefixe)
  mkdirSync(join(root, 'composants'), { recursive: true })
  mkdirSync(join(root, 'i18n', 'fr'), { recursive: true })
  mkdirSync(join(root, 'public', 'modularjs', 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(root, 'composants', 'carte.mjs'), composant)
  writeFileSync(join(root, 'i18n', 'fr', 'admin.json'), '{ "titre": "Bonjour" }\n')
  return root
}

const sortie = (root: string) => join(root, 'public', 'modularjs')

async function construire(root: string, reglages: Record<string, unknown>): Promise<string[]> {
  const b = new Bundler({ sourceDir: root, outputDir: sortie(root), manifestPath: join(sortie(root), 'bundle.js'), urlPrefix: '/modularjs', i18n: { default: 'fr' }, keepFailedComponents: false, ...reglages })
  try {
    return (await b.compile()).errors.map(e => e.message)
  }
  finally {
    await b.close()
  }
}

const CAS = [
  { nom: 'registre des variables de thème', fichier: '.mjs-theme-vars.json', reglages: { env: 'dev' } },
  { nom: 'noms courts de la minification', fichier: '.mangle-cache.json', reglages: { env: 'prod' } },
  { nom: 'carte du fichier unique', fichier: 'bundle.js.map', reglages: { env: 'dev', js: 'bundle', sourceMap: 'always' } },
  { nom: 'fragment de traduction à nom clair', fichier: join('i18n', 'fr', 'admin.json'), reglages: { env: 'dev' } },
]

describe('sortie dans le dossier des sources : les sorties JSON à nom fixe ne remplacent jamais un fichier de l\'auteur', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const cas of CAS) {
    it(`${cas.nom} (${cas.fichier}) : un fichier de l'auteur de ce nom est refusé avant toute écriture, intact`, async () => {
      const root    = projet(`json-nom-fixe-${cas.fichier.replace(/[^a-z]/g, '')}`)
      const chemin  = join(sortie(root), cas.fichier)
      const auteur  = '{\n  "note": "fichier de l auteur",\n  "valeur": 1\n}\n'
      writeFileSync(chemin, auteur)
      const erreurs = await construire(root, cas.reglages)
      assert.equal(erreurs.length, 1, erreurs.join('\n'))
      assert.ok(erreurs[0].includes(chemin), erreurs[0])
      assert.match(erreurs[0], /Rien n'a été écrit/)
      assert.equal(readFileSync(chemin, 'utf-8'), auteur, 'fichier de l\'auteur remplacé')
      assert.equal(existsSync(join(sortie(root), 'bundle.js')), false, 'manifeste écrit malgré le refus')
    })
  }

  it('sorties d\'une construction précédente, sans marque : reconnues à leur forme, remplacées sans refus', async () => {
    const root = projet('json-nom-fixe-anciennes')
    writeFileSync(join(sortie(root), '.mjs-theme-vars.json'), JSON.stringify({ alerte: { declarations: [], readBy: [] } }, null, 2) + '\n')
    writeFileSync(join(sortie(root), 'bundle.js.map'), '{"version":3,"sources":[],"names":[],"mappings":""}')
    writeFileSync(join(sortie(root), 'i18n', 'fr', 'admin.json'), '{"titre":"ANCIEN"}')
    const dev = { env: 'dev', js: 'bundle', sourceMap: 'always' }
    assert.deepEqual(await construire(root, dev), [])
    assert.equal(readFileSync(join(sortie(root), 'i18n', 'fr', 'admin.json'), 'utf-8'), '{"titre":"Bonjour"}')
    assert.deepEqual(JSON.parse(readFileSync(join(sortie(root), '.mjs-theme-vars.json'), 'utf-8')).alerte.readBy, [])
    assert.deepEqual(await construire(root, dev), [], 'deuxième construction refusée')
    writeFileSync(join(sortie(root), '.mangle-cache.json'), JSON.stringify({ _mjs_ancien: false }, null, 2) + '\n')
    assert.deepEqual(await construire(root, { env: 'prod' }), [])
    assert.deepEqual(await construire(root, { env: 'prod' }), [], 'deuxième construction de production refusée')
  })
})
