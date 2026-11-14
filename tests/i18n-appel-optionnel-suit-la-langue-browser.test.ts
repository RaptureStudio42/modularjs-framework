// Un composant sans `@i18n` qui ne traduit que par un appel optionnel (`µt?.('titre')`) suit la langue comme avec `µt('titre')`. Il ne
// recevait pas la ligne d'instance de la traduction et gardait le texte de son premier rendu. Page sans rendu serveur demandée en anglais
// (`?lang=en`) : la racine anglaise arrive après le premier rendu, le titre doit finir en anglais. L'enfant à `µt(…)` fait embarquer la
// traduction dans les deux cas. Dans Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, type Moteur, type Page, type Sonde } from './helpers/graine-page.js'

const COMPOSANTS = {
  home:          '<h1 class="t">{µt?.(\'titre\')}</h1>\n<mjs-kid-section></mjs-kid-section>\n',
  'kid-section': '@i18n \'fiche\'\n<i class="ks">{µt(\'nom\')}</i>\n'
}
const SONDES: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }]
const FR = 'Titre | Fiche'
const EN = 'Title | Card'

describe('appel optionnel µt?.() sans @i18n : le composant suit la langue (Chromium, Firefox, WebKit)', function () {
  this.timeout(300000)
  const navigateurs: Partial<Record<Moteur, any>> = {}
  let page: Page | null = null

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
    page = await construire({ nom: 'appel-optionnel-langue', composants: COMPOSANTS, env: 'prod', sansRendu: true })
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    if (page) await page.fermer()
    await terminateSharedWorkerPool()
  })

  for (const m of MOTEURS) {
    describe(m, function () {
      beforeEach(function () {
        if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
        page!.poser({ racineEn: 200, retards: { fiche: 300 } })
      })

      it('?lang=en : le titre à µt?.() finit en anglais', async function () {
        const r = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES)
        assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
        assert.equal(r.vus[r.vus.length - 1], EN, 'état final : ' + r.etats.join(' /// '))
      })

      it('sans ?lang= : français', async function () {
        const r = await relever(navigateurs[m], page!.base + '/', SONDES)
        assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
        assert.equal(r.vus[r.vus.length - 1], FR, 'état final : ' + r.etats.join(' /// '))
      })
    })
  }
})
