// Rendu serveur — happy-dom 20.11.2 au moins. Avant cette version, happy-dom tient le rappel d'un MutationObserver par une
// référence faible : un ramasse-miettes l'éteint en silence (un composant ne voit plus ses attributs changer, un rendu varie
// d'un passage à l'autre). La création du rendu refuse donc une version plus ancienne, en disant la version trouvée, la version
// exigée et la commande pour monter ; le dépôt lui-même, la dépendance pair et la doc disent la même chose.
//
// La version « installée chez l'appli » est simulée par le package.json de happy-dom lui-même : Node le garde en mémoire, le rendu
// le lit par `require`, l'essai y pose la version voulue le temps d'un appel puis la rend.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { setMessagesLang } from '../src/messages/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const EXIGEE   = '20.11.2'
const COMMANDE = 'npm i happy-dom@^20.11.2'

// l'objet que Node garde en mémoire pour ce package.json : toute lecture par `require` rend celui-là
const paquet = createRequire(import.meta.url)('happy-dom/package.json')
const REELLE = paquet.version as string
const racine = new URL('..', import.meta.url)

// majeur.mineur.correctif comparés comme des nombres : « 20.9.0 » vient avant « 20.11.2 », « 100.0.0 » après
function auMoins(version: string, minimum: string): boolean {
  const a = version.split('.').map(Number)
  const b = minimum.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return true
}

// crée un rendu comme si l'appli avait installé `version` de happy-dom ; rend l'erreur levée, ou null (le rendu créé est refermé)
async function creerAvec(version: string, sourceDir: string): Promise<Error | null> {
  paquet.version = version
  try {
    const renderer = await createSSRRenderer({ sourceDir })
    await renderer.close()
    return null
  } catch (e) {
    return e as Error
  } finally {
    paquet.version = REELLE
  }
}

describe('rendu serveur — happy-dom 20.11.2 au moins', function () {
  this.timeout(60000)

  let sourceDir: string

  before(() => {
    sourceDir = join(mjsTmp('ssr-happydom-version'), 'src')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'salut.mjs'), '<script>\n$nom = "Monde"\n</script>\n<p>Bonjour {$nom}</p>\n')
  })

  after(async () => { await terminateSharedWorkerPool() })
  afterEach(() => setMessagesLang('fr'))

  describe('une version plus ancienne est refusée à la création du rendu', () => {
    for (const version of ['20.11.1', '20.11.0', '20.10.9', '20.9.0', '19.12.3']) {
      it(`${version} : refusée, avec la version trouvée, la version exigée et la commande pour monter`, async () => {
        const erreur = await creerAvec(version, sourceDir)
        assert.ok(erreur, `happy-dom ${version} doit être refusé`)
        assert.ok(erreur.message.includes(version), erreur.message)
        assert.ok(erreur.message.includes(EXIGEE), erreur.message)
        assert.ok(erreur.message.includes(COMMANDE), erreur.message)
      })
    }

    it('refusée, la création ne laisse aucun dossier de travail derrière elle', async () => {
      const tmp   = mjsTmp('ssr-happydom-tmp')
      const avant = process.env.TMPDIR
      process.env.TMPDIR = tmp
      try {
        const erreur = await creerAvec('20.11.0', sourceDir)
        assert.ok(erreur, 'happy-dom 20.11.0 doit être refusé')
        assert.deepEqual(readdirSync(tmp).filter((f) => f.startsWith('mjs-ssr-')), [])
      } finally {
        if (avant === undefined) delete process.env.TMPDIR
        else process.env.TMPDIR = avant
      }
    })
  })

  describe('une version assez récente passe', () => {
    for (const version of ['20.11.2', '20.11.15', '20.12.0', '21.0.0', '100.0.0']) {
      it(`${version} : acceptée`, async () => {
        const erreur = await creerAvec(version, sourceDir)
        assert.equal(erreur, null, String(erreur && erreur.message))
      })
    }
  })

  describe('le message', () => {
    it('en français, au vouvoiement : ce qu\'il faut, ce qui est installé, pourquoi, la commande', async () => {
      const erreur = await creerAvec('20.11.0', sourceDir)
      assert.ok(erreur, 'happy-dom 20.11.0 doit être refusé')
      assert.match(erreur.message, /^\[mjs-ssr\] le rendu serveur requiert happy-dom 20\.11\.2 au moins/)
      assert.match(erreur.message, /version installée : 20\.11\.0/)
      assert.match(erreur.message, /ramasse-miettes/)
      assert.match(erreur.message, /Montez la version : npm i happy-dom@\^20\.11\.2$/)
    })

    it('en anglais', async () => {
      setMessagesLang('en')
      const erreur = await creerAvec('20.11.0', sourceDir)
      assert.ok(erreur, 'happy-dom 20.11.0 doit être refusé')
      assert.match(erreur.message, /^\[mjs-ssr\] server rendering requires happy-dom 20\.11\.2 or later/)
      assert.match(erreur.message, /installed version: 20\.11\.0/)
      assert.match(erreur.message, /garbage collection/)
      assert.match(erreur.message, /Upgrade it: npm i happy-dom@\^20\.11\.2$/)
    })
  })

  describe('le dépôt, la dépendance pair et la doc disent la même chose', () => {
    const lirePaquet = () => JSON.parse(readFileSync(new URL('package.json', racine), 'utf-8'))

    it('le dépôt tourne sous la version exigée', () => {
      assert.ok(auMoins(REELLE, EXIGEE), `happy-dom ${REELLE} est installé, ${EXIGEE} est exigé : un MutationObserver y perd son rappel au ramasse-miettes`)
    })

    it('la dépendance de développement ne descend pas sous la version exigée', () => {
      const plage = String(lirePaquet().devDependencies['happy-dom'])
      assert.ok(auMoins(plage.replace(/^[^\d]*/, ''), EXIGEE), `devDependencies : happy-dom ${plage}`)
    })

    it('la dépendance pair exige 20.11.2 au moins, et reste optionnelle', () => {
      const pkg = lirePaquet()
      assert.equal(pkg.peerDependencies['happy-dom'], '>=20.11.2')
      assert.equal(pkg.peerDependenciesMeta['happy-dom'].optional, true)
    })

    it('la doc du rendu serveur cite la version exigée et la commande pour monter', () => {
      const doc = readFileSync(new URL('docs/19-ssr.md', racine), 'utf-8')
      assert.ok(doc.includes('20.11.2'), 'docs/19-ssr.md doit dire la version exigée')
      assert.ok(doc.includes(COMMANDE), 'docs/19-ssr.md doit donner la commande pour monter')
    })
  })
})
