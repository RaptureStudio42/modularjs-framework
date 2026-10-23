// Dossier de sortie égal au dossier des sources, dans un projet traduit : les fragments de traduction iraient dans
// `i18n/<langue>/`, le dossier même des traductions de l'auteur. Chaque construction de développement réécrivait alors
// ces fichiers (JSON compacté, sceau `__source` retiré : la langue était rejetée au build suivant), et une construction
// de production suivie de la purge retirait la traduction source en laissant un fragment `<empreinte>.json`, relu
// ensuite comme une section. Le build refuse désormais cette configuration par une erreur, sans rien écrire dans le
// dossier des traductions ; la purge ne retire jamais un fichier de ce dossier, même quand le registre des sorties le
// nomme.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const auteur = '{\n  "titre": "Bonjour",\n  "aide": "Texte de l\'auteur"\n}\n'

function projet(prefixe: string, admin = auteur): string {
  const app = mjsTmp(prefixe)
  mkdirSync(join(app, 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(app, 'carte.mjs'), "<p>{µt('admin.titre')}</p>\n")
  writeFileSync(join(app, 'i18n', 'fr', 'admin.json'), admin)
  return app
}

const surPlace = (app: string, extra: Record<string, unknown> = {}) => ({ sourceDir: app, outputDir: app, manifestPath: join(app, 'bundle.js'), i18n: { default: 'fr' }, ...extra })

describe('sortie égale aux sources dans un projet traduit : les traductions de l\'auteur ne sont ni réécrites ni retirées', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('développement : la traduction reste identique à l\'octet, une erreur demande un dossier de sortie distinct', async () => {
    const app = projet('i18n-sur-place-dev')
    const b = new Bundler(surPlace(app))
    const s = await b.compile()
    await b.close()
    assert.equal(readFileSync(join(app, 'i18n', 'fr', 'admin.json'), 'utf-8'), auteur, 'fichier de l\'auteur réécrit')
    assert.deepEqual(readdirSync(join(app, 'i18n', 'fr')), ['admin.json'])
    assert.equal(s.errors.length, 1, s.errors.map(e => e.message).join('\n') || 'aucune erreur')
    assert.match(s.errors[0].message, /outputDir/)
  })

  it('traduction scellée (`i18n.source`) : le sceau `__source` reste dans le fichier de l\'auteur', async () => {
    // empreinte de `{ "titre": "Bonjour" }`, la traduction anglaise est à jour
    const app = projet('i18n-sur-place-sceau', '{\n  "titre": "Bonjour"\n}\n')
    mkdirSync(join(app, 'i18n', 'en'), { recursive: true })
    const scellee = '{\n  "__source": "4699ee1a22d5",\n  "titre": "Hello"\n}\n'
    writeFileSync(join(app, 'i18n', 'en', 'admin.json'), scellee)
    const b = new Bundler(surPlace(app, { i18n: { default: 'fr', source: 'fr' } }))
    await b.compile()
    await b.close()
    assert.equal(readFileSync(join(app, 'i18n', 'en', 'admin.json'), 'utf-8'), scellee, 'sceau retiré du fichier de l\'auteur')
    assert.equal(readFileSync(join(app, 'i18n', 'fr', 'admin.json'), 'utf-8'), '{\n  "titre": "Bonjour"\n}\n')
  })

  it('développement puis production avec purge : la traduction source reste, aucun fragment dans le dossier des traductions', async () => {
    const app = projet('i18n-sur-place-purge')
    const b1 = new Bundler(surPlace(app, { env: 'dev' }))
    await b1.compile()
    await b1.close()
    const b2 = new Bundler(surPlace(app, { env: 'prod', keepFailedComponents: false }))
    await b2.compile()
    b2.pruneOrphans()
    await b2.close()
    assert.deepEqual(readdirSync(join(app, 'i18n', 'fr')), ['admin.json'], 'traduction retirée, ou fragment écrit parmi les traductions')
    assert.equal(readFileSync(join(app, 'i18n', 'fr', 'admin.json'), 'utf-8'), auteur)
  })

  it('la purge ne retire jamais un fichier du dossier des traductions, même nommé par le registre des sorties', async () => {
    // dictionnaire racine seul : aucun fragment à écrire, la configuration reste permise (témoin, aucune erreur)
    const app = mjsTmp('i18n-sur-place-registre')
    mkdirSync(join(app, 'i18n'), { recursive: true })
    writeFileSync(join(app, 'carte.mjs'), "<p>{µt('titre')}</p>\n")
    writeFileSync(join(app, 'i18n', 'fr.json'), '{ "titre": "Bonjour" }\n')
    const b = new Bundler(surPlace(app, { env: 'prod', keepFailedComponents: false }))
    const s = await b.compile()
    assert.deepEqual(s.errors.map(e => e.message), [])
    // une section que l'auteur ajoute ensuite, et un registre qui la nomme comme un fragment écrit par un build
    mkdirSync(join(app, 'i18n', 'fr'))
    writeFileSync(join(app, 'i18n', 'fr', 'admin.json'), auteur)
    const registre = join(app, '.mjs-outputs.json')
    writeFileSync(registre, JSON.stringify({ ...JSON.parse(readFileSync(registre, 'utf-8')), i18nFragments: { fr: ['admin.json'] } }))
    const p = b.pruneOrphans()
    await b.close()
    assert.equal(readFileSync(join(app, 'i18n', 'fr', 'admin.json'), 'utf-8'), auteur, 'traduction de l\'auteur retirée')
    assert.deepEqual(p.removed.filter(f => f.startsWith('i18n/')), [])
  })
})
