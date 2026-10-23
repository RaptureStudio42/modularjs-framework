// Une application traduite construite avec `"runtime": ["hydrate", "i18n"]` (la liste que la doc et le message d'erreur de construction recommandent)
// applique la langue voulue : `?lang=en`, comme avec le `runtime` par défaut. La langue voulue (adresse, préférence mémorisée, navigateur) et la
// bascule du démarrage passent par le magasin global (`µlang`) : `'i18n'` l'embarque avec lui, il n'y a pas à le nommer. Dans Chromium, Firefox
// et WebKit réels :
//
// 1. Une page sans rendu serveur (aucune graine) demandée en anglais se montre en anglais, sans qu'une image soit en français.
// 2. Une page rendue en français par le serveur et reprise par hydratation, demandée en anglais, garde le français du serveur puis passe d'un coup à
//    l'anglais, sans image qui mêle les deux langues (la bascule du démarrage).
// 3. Sans `?lang=`, la même page reste en français.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, langues, apresLeVide, type Moteur, type Page, type Releve, type Sonde } from './helpers/graine-page.js'

const COMPOSANTS = {
  home:          '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'/titre\')}</h1>\n<mjs-kid-section></mjs-kid-section>\n',
  'kid-section': '@i18n \'fiche\'\n<i class="ks">{µt(\'nom\')}</i>\n'
}
const SONDES: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }]
const FR = 'Bonjour accueil / Titre | Fiche'
const EN = 'Hello home / Title | Card'

// chaque image est dans l'un des états permis, la dernière est la finale
const parmi = (permis: string[], final: string) => (r: Releve) => {
  assert.equal(r.vus[r.vus.length - 1], final, 'état final : ' + r.etats.join(' /// '))
  assert.deepEqual(apresLeVide(r.vus).filter(v => !permis.includes(v)), [], 'états hors de ' + JSON.stringify(permis) + ' : ' + r.etats.join(' /// '))
}

describe('runtime en liste avec \'i18n\' : la langue voulue s\'applique (Chromium, Firefox, WebKit)', function () {
  this.timeout(300000)
  const navigateurs: Partial<Record<Moteur, any>> = {}
  let sansRendu: Page | null = null
  let hydratee: Page | null = null

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
    sansRendu = await construire({ nom: 'liste-sans-rendu', composants: COMPOSANTS, env: 'prod', sansRendu: true, runtime: ['hydrate', 'i18n'] })
    hydratee  = await construire({ nom: 'liste-hydratee', composants: COMPOSANTS, env: 'prod', hydrate: true, runtime: ['hydrate', 'i18n'] })
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    if (sansRendu) await sansRendu.fermer()
    if (hydratee) await hydratee.fermer()
    await terminateSharedWorkerPool()
  })

  for (const m of MOTEURS) {
    describe(m, function () {
      beforeEach(function () {
        if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
        sansRendu!.poser({ racineEn: 200, retards: { accueil: 300, fiche: 400 } })
        hydratee!.poser({ racineEn: 200, retards: { accueil: 300, fiche: 400 } })
      })

      it('page sans rendu serveur, ?lang=en : anglais, jamais une image en français', async function () {
        const r = await relever(navigateurs[m], sansRendu!.base + '/?lang=en', SONDES)
        assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
        assert.equal(r.vus[r.vus.length - 1], EN, 'état final : ' + r.etats.join(' /// '))
        assert.deepEqual(r.vus.filter(v => langues(v).has('fr')), [], 'aucune image en français : ' + r.etats.join(' /// '))
      })

      it('page sans rendu serveur, sans ?lang= : français', async function () {
        const r = await relever(navigateurs[m], sansRendu!.base + '/', SONDES)
        assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
        assert.equal(r.vus[r.vus.length - 1], FR, 'état final : ' + r.etats.join(' /// '))
        assert.deepEqual(r.vus.filter(v => langues(v).has('en')), [], 'aucune image en anglais : ' + r.etats.join(' /// '))
      })

      it('page rendue en français et reprise par hydratation, ?lang=en : le français du serveur, puis l\'anglais d\'un coup', async function () {
        const r = await relever(navigateurs[m], hydratee!.base + '/?lang=en', SONDES)
        assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
        parmi([FR, EN], EN)(r)
      })

      it('page rendue en français et reprise par hydratation, sans ?lang= : français', async function () {
        const r = await relever(navigateurs[m], hydratee!.base + '/', SONDES)
        assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
        parmi([FR], FR)(r)
      })
    })
  }
})
