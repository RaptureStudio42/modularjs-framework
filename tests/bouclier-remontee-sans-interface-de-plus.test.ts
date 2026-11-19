// La remontée du bouclier (qui cherche, au-dessus d'un composant qui se montre, un ancêtre encore caché) ne réveille aucune
// interface du navigateur dans une page sans ombre.
//
// Pourquoi ce test existe : `x instanceof HTMLFormElement` et `x instanceof ShadowRoot` obligent le navigateur à fabriquer ces
// deux interfaces dans la page (constructeur, prototype, accesseurs), que l'appli s'en serve ou non. Une appli sans formulaire ni
// ombre gardait pour elles 8,6 Ko de mémoire au repos (lecture « mémoire au repos » de js-framework-benchmark, Chromium 149).
// « Mon parent est-il un formulaire ? » se demande au moteur depuis l'enfant (`matches`), sans rien lire sur le formulaire, et la racine
// n'est comparée à `ShadowRoot` qu'une fois le document écarté : seule une page qui a déjà une ombre nomme cette interface.
//
// Ce que le test garde : le fichier de départ d'une petite appli bâtie pour la production, formulaire compris, ne nomme pas
// `HTMLFormElement`, et chaque `instanceof ShadowRoot` y vient après `!== document`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'fiche-app.mjs': [
    '<script>',
    '$city = \'Paris\'',
    '</script>',
    '',
    '<@fiche-form value=!{$city}></@fiche-form>',
    '<p class="ville">{$city}</p>'
  ].join('\n'),
  'fiche-form.mjs': [
    '<script>',
    '$value = \'\'',
    'submit = -> µemit \'search\'',
    '</script>',
    '',
    '<form @submit.prevent={submit()}>',
    '  <input type="text" value=!{$value}>',
    '  <button type="submit">Chercher</button>',
    '</form>'
  ].join('\n')
}

describe('remontée du bouclier — aucune interface du navigateur réveillée sans ombre', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le fichier de départ ne nomme pas HTMLFormElement et ne demande ShadowRoot qu\'une fois le document écarté', async () => {
    const root   = mjsTmp('bouclier-sans-interface')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), contenu + '\n')
    const manifeste = join(root, 'dist', 'assets', 'bundle.js')
    const bundler   = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'dist', 'assets'), manifestPath: manifeste, runtime: 'core', js: 'bundle', env: 'prod' } as any)
    const stats     = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const texte    = readFileSync(manifeste, 'utf8')
    assert.ok(!/\bHTMLFormElement\b/.test(texte), 'le cœur nomme HTMLFormElement : le navigateur fabrique cette interface dans chaque page, même sans formulaire — demandez-le au moteur depuis l\'enfant (matches)')
    const demandes = texte.match(/instanceof ShadowRoot\b/g) ?? []
    const gardees  = texte.match(/!==?\s*document\s*&&\s*\w+ instanceof ShadowRoot\b/g) ?? []
    assert.equal(gardees.length, demandes.length, `${demandes.length - gardees.length} « instanceof ShadowRoot » sans « !== document » devant : une page sans ombre fabrique alors l'interface ShadowRoot pour rien`)
  })
})
