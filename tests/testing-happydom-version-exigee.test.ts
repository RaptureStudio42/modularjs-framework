// Harnais de test des applications (createHarness) — happy-dom 20.11.2 au moins, comme au rendu serveur. Avant cette version, happy-dom
// tient le rappel d'un MutationObserver par une référence faible : un ramasse-miettes l'éteint en silence (un composant ne voit plus ses
// attributs changer, un test réussit ou échoue au hasard). Le harnais refuse donc une version plus ancienne, en disant la version trouvée,
// la version exigée et la commande pour monter ; la doc du harnais dit la même chose.
//
// La version « installée chez l'appli » est simulée par le package.json de happy-dom lui-même : Node le garde en mémoire, la garde le lit
// par `require`, l'essai y pose la version voulue le temps d'un appel puis la rend.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const EXIGEE   = '20.11.2'
const COMMANDE = 'npm i -D happy-dom@^20.11.2'

// l'objet que Node garde en mémoire pour ce package.json : toute lecture par `require` rend celui-là
const paquet = createRequire(import.meta.url)('happy-dom/package.json')
const REELLE = paquet.version as string
const racine = new URL('..', import.meta.url)

// crée un harnais comme si l'appli avait installé `version` de happy-dom ; rend l'erreur levée, ou null (le harnais créé est refermé)
async function creerAvec(version: string, root: string): Promise<Error | null> {
  paquet.version = version
  try {
    const app = await createHarness({ root })
    await app.destroy()
    return null
  } catch (e) {
    return e as Error
  } finally {
    paquet.version = REELLE
  }
}

describe('harnais de test — happy-dom 20.11.2 au moins', function () {
  this.timeout(60000)

  let root: string
  let rootEn: string

  // un petit projet ; la langue des messages est celle de sa clé `lang` (le harnais lit mjs.config.json)
  function projet(nom: string, lang?: string): string {
    const dossier = mjsTmp(nom)
    mkdirSync(join(dossier, 'src'), { recursive: true })
    writeFileSync(join(dossier, 'src', 'salut.mjs'), '<script>\n$nom = "Monde"\n</script>\n<p>Bonjour {$nom}</p>\n')
    writeFileSync(join(dossier, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...(lang ? { lang } : {}) }, null, 2))
    return dossier
  }

  before(() => {
    root   = projet('testing-happydom-version')
    rootEn = projet('testing-happydom-version-en', 'en')
  })

  after(async () => { await terminateSharedWorkerPool() })
  afterEach(() => setMessagesLang('fr'))

  describe('une version plus ancienne est refusée à la création du harnais', () => {
    for (const version of ['20.11.1', '20.10.9', '20.9.0', '19.12.3']) {
      it(`${version} : refusée, avec la version trouvée, la version exigée et la commande pour monter`, async () => {
        const erreur = await creerAvec(version, root)
        assert.ok(erreur, `happy-dom ${version} doit être refusé`)
        assert.ok(erreur.message.includes(version), erreur.message)
        assert.ok(erreur.message.includes(EXIGEE), erreur.message)
        assert.ok(erreur.message.includes(COMMANDE), erreur.message)
      })
    }
  })

  describe('une version assez récente passe', () => {
    for (const version of ['20.11.2', '20.12.0', '100.0.0']) {
      it(`${version} : acceptée`, async () => {
        const erreur = await creerAvec(version, root)
        assert.equal(erreur, null, String(erreur && erreur.message))
      })
    }
  })

  describe('le message', () => {
    it('en français, au vouvoiement : ce qu\'il faut, ce qui est installé, pourquoi, la commande', async () => {
      const erreur = await creerAvec('20.11.0', root)
      assert.ok(erreur, 'happy-dom 20.11.0 doit être refusé')
      assert.match(erreur.message, /^\[mjs\/testing\] les tests d'application requièrent happy-dom 20\.11\.2 au moins/)
      assert.match(erreur.message, /version installée : 20\.11\.0/)
      assert.match(erreur.message, /ramasse-miettes/)
      assert.match(erreur.message, /Montez la version : npm i -D happy-dom@\^20\.11\.2$/)
    })

    it('en anglais, quand le projet écrit lang: "en"', async () => {
      const erreur = await creerAvec('20.11.0', rootEn)
      assert.ok(erreur, 'happy-dom 20.11.0 doit être refusé')
      assert.match(erreur.message, /^\[mjs\/testing\] application tests require happy-dom 20\.11\.2 or later/)
      assert.match(erreur.message, /installed version: 20\.11\.0/)
      assert.match(erreur.message, /garbage collection/)
      assert.match(erreur.message, /Upgrade it: npm i -D happy-dom@\^20\.11\.2$/)
    })
  })

  describe('la doc du harnais dit la même chose', () => {
    it('elle cite la version exigée et la commande pour monter', () => {
      const doc = readFileSync(new URL('docs/33-tester-son-application.md', racine), 'utf-8')
      assert.ok(doc.includes(EXIGEE), 'docs/33-tester-son-application.md doit dire la version exigée')
      assert.ok(doc.includes(COMMANDE), 'docs/33-tester-son-application.md doit donner la commande pour monter')
    })
  })
})
