// Un module à plusieurs sections (`@i18n 'accueil' 'fiche'`) dont une section échoue (404) pendant que l'autre arrive : en production,
// le texte de la section en échec paraît avec les barres du secours, comme pour un module à une seule section — jamais vide. La lecture
// d'une clé absente de toutes les sections nomme la section dont le fragment est en route ou a échoué, pour que le repère d'échec la voie.
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, type Moteur, type Page, type Sonde } from './helpers/graine-page.js'

const HOME   = '@i18n \'accueil\' \'fiche\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'nom\')}</h1>\n'
const SONDES: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }]

describe('i18n : une section en échec dans un module à plusieurs sections (Chromium, Firefox, WebKit)', function () {
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

  for (const placeholder of ['wait', '*skeleton']) {
    describe(`production, ${placeholder}`, function () {
      let page: Page | null = null

      before(async function () {
        page = await construire({ nom: 'i18n-echec-sections-' + placeholder.replace(/\W/g, ''), composants: { home: HOME }, env: 'prod', placeholder, sansRendu: true })
      })

      after(async function () { if (page) await page.fermer() })

      const cas: Array<[string, string[], string]> = [
        ['la seconde section échoue, la première arrive', ['fiche'], 'Hello home / ▒'],
        ['la première section échoue, la seconde arrive', ['accueil'], '▒ / Card'],
        ['les deux sections échouent', ['accueil', 'fiche'], '▒ / ▒']
      ]
      for (const [nom, echecs, attendu] of cas) {
        for (const m of MOTEURS) {
          it(`${nom} — ${m}`, async function () {
            if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
            page!.poser({ racineEn: 100, echecs })
            const r = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES, { attente: 3500 })
            assert.deepEqual(r.erreurs, [], 'erreurs : ' + r.erreurs.join(' | '))
            assert.equal(r.vus[r.vus.length - 1], attendu, 'états : ' + r.etats.join(' /// '))
          })
        }
      }
    })
  }
})
