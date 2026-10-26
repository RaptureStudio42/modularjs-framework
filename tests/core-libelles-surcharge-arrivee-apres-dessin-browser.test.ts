// Libellés des modules cœur surchargés par le projet (`mjs.core.<clé>` dans les textes racine), page sans rendu serveur : le fichier de la
// langue arrive APRÈS le dessin du module (réseau lent). Au démarrage, le module prend la surcharge à l'arrivée du fichier. À une bascule
// de langue (µlang passé à l'anglais une fois la page affichée), le module se redessine aussitôt avec le libellé anglais du framework,
// puis prend la surcharge anglaise du projet dès que le fichier anglais arrive. Avant, rien ne le redessinait à cette arrivée : la
// surcharge ne se voyait que si le fichier était déjà là. Chromium, Firefox et WebKit réels, développement et production.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, apresLeVide, type Moteur, type Page, type Sonde } from './helpers/graine-page.js'

const HOME   = '<script>\n  basculer = -> µlang = \'en\'\n</script>\n<button class="en" @click={basculer()}>EN</button>\n<@@chart rows={[]}></@@chart>\n'
const SONDES: Sonde[] = [{ chemin: ['mjs-home', 'mjs-core-chart'], sel: 'p.empty' }]
const RACINE = { fr: 'mjs:\n  core:\n    chartEmpty: Rien à montrer\n', en: { mjs: { core: { chartEmpty: 'Nothing to show' } } } }

describe('libellés du cœur : une surcharge du projet arrivée après le dessin du module se voit (Chromium, Firefox, WebKit)', function () {
  this.timeout(600000)
  const navigateurs: Partial<Record<Moteur, any>> = {}

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    await terminateSharedWorkerPool()
  })

  for (const env of ['dev', 'prod'] as const) {
    describe(`sans rendu serveur (${env})`, function () {
      let page: Page | null = null

      before(async function () {
        page = await construire({ nom: 'surcharge-tardive-' + env, composants: { home: HOME }, env, sansRendu: true, racine: RACINE })
      })

      after(async function () {
        if (page) await page.fermer()
      })

      // la bascule : le bouton de la page passe µlang à l'anglais 600 ms après le chargement, la page déjà affichée en français
      const basculer = async (p: any) => {
        await p.waitForTimeout(600)
        await p.evaluate(() => { (document.querySelector('mjs-home') as any)._shadow.querySelector('button.en').click() })
        await p.waitForTimeout(2400)
      }
      const CAS: Array<{ nom: string, retard: { racineFr?: number, racineEn?: number }, scenario?: (p: any) => Promise<void>, avant: string, apres: string }> = [
        { nom: 'démarrage en français, fichier de la langue par défaut retardé', retard: { racineFr: 900 }, avant: 'Aucune valeur', apres: 'Rien à montrer' },
        { nom: 'bascule vers l\'anglais, fichier anglais retardé', retard: { racineEn: 900 }, scenario: basculer, avant: 'No values', apres: 'Nothing to show' },
      ]

      for (const m of MOTEURS) for (const c of CAS) {
        it(`${m} : ${c.nom}`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          page!.poser(c.retard)
          const r = await relever(navigateurs[m], page!.base + '/', SONDES, c.scenario ? { scenario: c.scenario } : { attente: 2600 })
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          const vus = apresLeVide(r.vus)
          assert.ok(vus.includes(c.avant), `le module paraît avant le fichier de la langue, avec le libellé du framework : ${r.etats.join(' /// ')}`)
          assert.ok(vus.indexOf(c.avant) < vus.indexOf(c.apres), `le libellé du framework vient avant la surcharge : ${r.etats.join(' /// ')}`)
          assert.equal(vus[vus.length - 1], c.apres, `la surcharge du projet se voit à l'arrivée du fichier : ${r.etats.join(' /// ')}`)
        })
      }
    })
  }
})
