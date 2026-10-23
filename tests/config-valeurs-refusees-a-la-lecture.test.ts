// mjs.config.json — des valeurs qui passaient la validation et faisaient des dégâts plus loin, refusées désormais
// à la lecture, avec un message qui nomme la clé :
//   - `manifestPath` qui désigne un fichier source de l'application (confusion courante avec `manifestExternal`) :
//     le build lisait ce fichier comme manifeste externe, puis l'ÉCRASAIT avec le manifeste produit ;
//   - `defaultTheme`/`varPrefix` en tableau : validés sur `String(valeur)`, puis comparés à un nom de thème
//     (jamais égaux) — la page nue restait sans thème, sans un mot ;
//   - un fichier qui vaut `[]` (accepté comme configuration vide) ou `null` (« Cannot read properties of null ») ;
//   - une langue de `render.locales` qui sort du dossier du prérendu (`..`), des largeurs d'image en double ou
//     démesurées, un `dev.host` vide (le serveur de développement écoutait alors sur toutes les adresses).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findConfig } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(contenu: string, fichiers: Record<string, string> = {}): string {
  const root = mjsTmp('config-refus')
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(join(root, nom, '..'), { recursive: true })
    writeFileSync(join(root, nom), texte)
  }
  writeFileSync(join(root, 'mjs.config.json'), contenu)
  return root
}

const refus = (cfg: unknown, motif: RegExp, fichiers: Record<string, string> = {}): void => {
  assert.throws(() => findConfig(projet(JSON.stringify(cfg), fichiers)), motif, JSON.stringify(cfg))
}
const accepte = (cfg: unknown): void => {
  assert.doesNotThrow(() => findConfig(projet(JSON.stringify(cfg))), JSON.stringify(cfg))
}

describe('mjs.config.json — valeurs refusées à la lecture', () => {
  describe('manifestPath ne désigne jamais un fichier source de l\'application', () => {
    it('le manifeste externe par défaut (`app/modularjs/manifest.civet`) : refusé, le fichier reste intact', () => {
      const code = '# mon code à moi\nconsole.log "ok"\n'
      const root = projet(JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out', manifestPath: 'app/modularjs/manifest.civet' }), { 'app/modularjs/manifest.civet': code, 'app/modularjs/a.mjs': '<p>a</p>\n' })
      assert.throws(() => findConfig(root), /manifestPath/)
      assert.equal(readFileSync(join(root, 'app/modularjs/manifest.civet'), 'utf-8'), code)
    })

    it('une extension de fichier source (.mjs, .civet, .coffee), où qu\'il soit : refusé', () => {
      refus({ manifestPath: 'public/bundle.mjs' }, /manifestPath.*\.mjs/)
      refus({ manifestPath: 'app/assets/javascripts/application.coffee' }, /manifestPath.*\.coffee/)
      refus({ manifestPath: 'vendor/manifeste.civet' }, /manifestPath.*\.civet/)
    })

    it('le même fichier que `manifestExternal` : refusé', () => {
      refus({ manifestExternal: 'vendor/manifeste.js', manifestPath: 'vendor/manifeste.js' }, /manifestPath.*manifestExternal/)
      refus({ manifestExternal: './vendor/manifeste.js', manifestPath: 'vendor/../vendor/manifeste.js' }, /manifestPath.*manifestExternal/)
    })

    it('dans le dossier des sources alors que les fichiers produits vont ailleurs : refusé', () => {
      refus({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'app/modularjs/aides.js' }, /manifestPath.*sourceDir/)
      refus({ manifestPath: 'app/modularjs/bundle.js' }, /manifestPath.*sourceDir/)
    })

    it('témoins acceptés : manifeste à côté des fichiers produits, y compris quand ceux-ci vivent sous le dossier des sources', () => {
      accepte({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' })
      accepte({ sourceDir: 'src', outputDir: 'dist/assets', manifestPath: 'dist/assets/bundle.js' })
      accepte({ sourceDir: 'app/assets/modularJS', outputDir: 'public/assets/modularJS_compiled', manifestPath: 'app/assets/javascripts/bundle_modular.js' })
      accepte({ sourceDir: '.', outputDir: 'out', manifestPath: 'out/bundle.js' })
      accepte({ sourceDir: 'client', outputDir: 'client/public/mjs', manifestPath: 'client/public/mjs/bundle.js' })
      accepte({ manifestPath: 'bundle.js' })
    })
  })

  describe('defaultTheme et varPrefix : des chaînes', () => {
    it('en tableau : refusés, la clé nommée', () => {
      refus({ defaultTheme: ['dark'] }, /defaultTheme doit être une chaîne/)
      refus({ varPrefix: ['app'] }, /varPrefix doit être une chaîne/)
      refus({ defaultTheme: 5 }, /defaultTheme doit être une chaîne/)
    })

    it('témoins : les chaînes valides passent, les chaînes mal formées gardent leur message', () => {
      accepte({ defaultTheme: 'dark', varPrefix: 'app' })
      refus({ defaultTheme: 'Dark Mode' }, /defaultTheme invalide/)
    })
  })

  describe('le fichier entier doit être un objet', () => {
    it('`[]` et `null` : « doit être un objet »', () => {
      assert.throws(() => findConfig(projet('[]')), /doit être un objet/)
      assert.throws(() => findConfig(projet('null')), (e: Error) => /doit être un objet/.test(e.message) && !/Cannot read/.test(e.message))
    })

    it('témoin : `{}` passe', () => {
      assert.doesNotThrow(() => findConfig(projet('{}')))
    })
  })

  describe('langues, largeurs d\'image, hôte de développement', () => {
    it('une langue de `render.locales` qui sortirait du dossier du prérendu : refusée', () => {
      refus({ render: { locales: ['fr', '../../hors'] } }, /render\.locales.*\.\.\/\.\.\/hors/)
      refus({ render: { locales: ['fr', 'en\\..\\..'] } }, /render\.locales/)
      accepte({ render: { locales: ['fr', 'en-US', 'zh-Hant'] } })
    })

    it('`image.widths` : ni doublon, ni largeur au-delà de 10 000 pixels', () => {
      refus({ image: { widths: [480, 480] } }, /image\.widths.*480/)
      refus({ image: { widths: [480, 1e9] } }, /image\.widths.*1000000000/)
      accepte({ image: { widths: [480, 960, 10000] } })
    })

    it('`dev.host` vide : refusé', () => {
      refus({ dev: { host: '' } }, /dev\.host doit être une chaîne non vide/)
      refus({ dev: { host: '   ' } }, /dev\.host doit être une chaîne non vide/)
      accepte({ dev: { host: '0.0.0.0' } })
    })
  })
})
