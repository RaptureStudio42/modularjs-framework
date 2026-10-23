// La langue choisie par le visiteur (mémorisée, `i18n.persist`) passe avant celle que le serveur a posée dans sa page. L'ordre de la langue de départ est :
// `?lang=`, la langue mémorisée, la langue du rendu serveur, le navigateur, le défaut. Une page rendue en français pour un visiteur qui avait choisi l'anglais
// passe donc à l'anglais, d'un seul coup, par la bascule du démarrage (celle de `?lang=en`) : d'abord la langue du serveur, puis toute la page — enfants compris
// — quand les textes voulus sont là. Aucune image vide ni mêlée de deux langues ; la mémoire n'est pas réécrite, l'adresse ne change pas. Sans graine, rien ne change.
// Chromium, Firefox et WebKit réels, avec les aides de `helpers/graine-page.ts`.
//
// La page est rendue par l'API du serveur avec `store: { __mjsLang: 'fr' }` : c'est ce que fait un back qui pose la langue négociée de la requête, et ce qu'écrit un
// prérendu par langue (`render.locales`). Le texte de chaque sonde est relevé à chaque image (`requestAnimationFrame`), depuis la première.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, apresLeVide, langues, type Moteur, type Page, type Releve, type Reseau, type Sonde } from './helpers/graine-page.js'

// l'accueil lit une section et une clé racine, sa fiche enfant une autre section ; `compte` note chaque évaluation du gabarit de l'accueil
const COMPOSANTS = {
  home:          '@i18n \'accueil\'\n<script>\n  compte = (v) ->\n    globalThis.__rendus = (globalThis.__rendus or 0) + 1\n    v\n</script>\n<h1 class="t">{compte(µt(\'salut\'))} / {µt(\'/titre\')}</h1>\n<mjs-kid-section></mjs-kid-section>\n',
  'kid-section': '@i18n \'fiche\'\n<i class="ks">{µt(\'nom\')}</i>\n'
}
const SONDES: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }]
const FR = 'Bonjour accueil / Titre | Fiche'
const EN = 'Hello home / Title | Card'
// les fragments et le fichier de langue anglais traînent : le passage ne se fait qu'à la dernière arrivée, et se voit
const RESEAU: Reseau = { racineEn: 300, retards: { accueil: 400, fiche: 600 } }

// la mémoire du visiteur, posée avant la page ; l'écriture de la mémoire et le changement d'adresse sont notés pour dire que la page n'y touche pas
const MEMOIRE = (lang: string) => `(function() {
  var ecrire = Storage.prototype.setItem;
  try { ecrire.call(localStorage, '__mjsLang', ${JSON.stringify(lang)}); } catch (e) {}
  window.__ecritures = [];
  window.__adresses = [];
  Storage.prototype.setItem = function(k, v) { window.__ecritures.push(k + '=' + v); return ecrire.call(this, k, v); };
  var remplacer = history.replaceState;
  history.replaceState = function() { window.__adresses.push(String(arguments[2])); return remplacer.apply(this, arguments); };
})();`

// ce que la page a fait de la mémoire, de l'adresse et du nombre de rendus de l'accueil, après les arrivées
const BILAN = async (page: any) => {
  await page.waitForTimeout(2600)
  return page.evaluate(() => ({ ecritures: (window as any).__ecritures, adresses: (window as any).__adresses, memoire: localStorage.getItem('__mjsLang'), adresse: location.search, rendus: (window as any).__rendus }))
}

// chaque image de la page est permise (`permis` : ce qu'une image des sondes peut montrer), la dernière est la finale
function juger(r: Releve, permis: (v: string) => boolean, final: string): void {
  assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
  assert.equal(r.vus[r.vus.length - 1], final, 'état final : ' + r.etats.join(' /// '))
  assert.deepEqual(apresLeVide(r.vus).filter(v => !permis(v)), [], 'images hors de ce qui est permis : ' + r.etats.join(' /// '))
}
// la page du serveur (fr) : la fiche est là, ou pas encore définie ; jamais un texte vide ni deux langues dans une image, puisque seules ces images sont permises
const FR_SEUL = (v: string) => [FR, 'Bonjour accueil / Titre | -'].includes(v)
const FR_OU_EN = (v: string) => FR_SEUL(v) || v === EN

describe('la langue mémorisée avant celle du serveur (Chromium, Firefox, WebKit)', function () {
  this.timeout(300000)
  const navigateurs: Partial<Record<Moteur, any>> = {}

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    await terminateSharedWorkerPool()
  })

  // ---- page rendue en français, langue posée dans sa page ----

  describe('page rendue en français par le serveur, mémorisation active (production)', function () {
    let page: Page | null = null

    before(async function () {
      page = await construire({ nom: 'memoire-fr', composants: COMPOSANTS, env: 'prod', api: true, store: { __mjsLang: 'fr' }, i18n: { persist: true } })
    })

    after(async function () {
      if (page) await page.fermer()
    })

    for (const m of MOTEURS) {
      it(`mémoire « en » : la page reste en français jusqu'aux textes anglais, puis passe d'un coup, sans écrire la mémoire ni changer l'adresse — ${m}`, async function () {
        if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
        page!.poser(RESEAU)
        const r = await relever(navigateurs[m], page!.base + '/', SONDES, { initScript: MEMOIRE('en'), scenario: BILAN })
        juger(r, FR_OU_EN, EN)
        assert.ok(FR_SEUL(apresLeVide(r.vus)[0]), 'la page du serveur se voit avant le passage : ' + r.etats.join(' /// '))
        assert.deepEqual(r.extra.ecritures, [], 'la mémoire n\'est pas réécrite par le passage du démarrage')
        assert.deepEqual(r.extra.adresses, [], 'l\'adresse ne change pas')
        assert.equal(r.extra.memoire, 'en')
        assert.equal(r.extra.adresse, '')
      })

      it(`?lang=fr l'emporte sur la mémoire « en » : la page reste en français, sans un texte anglais — ${m}`, async function () {
        if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
        page!.poser(RESEAU)
        const r = await relever(navigateurs[m], page!.base + '/?lang=fr', SONDES, { initScript: MEMOIRE('en'), scenario: BILAN })
        juger(r, FR_SEUL, FR)
        assert.deepEqual(r.extra.ecritures, [])
        assert.equal(r.extra.memoire, 'en', 'la mémoire reste ce qu\'elle était')
      })

      it(`sans mémoire : la page reste dans la langue de la graine — ${m}`, async function () {
        if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
        page!.poser(RESEAU)
        const r = await relever(navigateurs[m], page!.base + '/', SONDES, { scenario: BILAN })
        juger(r, FR_SEUL, FR)
        assert.equal(r.extra.memoire, null, 'rien n\'est mémorisé par le simple chargement')
      })

      it(`mémoire « fr », égale à la graine : un seul rendu, comme sans mémoire — ${m}`, async function () {
        if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
        page!.poser(RESEAU)
        const sans = await relever(navigateurs[m], page!.base + '/', SONDES, { scenario: BILAN })
        const avec = await relever(navigateurs[m], page!.base + '/', SONDES, { initScript: MEMOIRE('fr'), scenario: BILAN })
        juger(avec, FR_SEUL, FR)
        assert.equal(sans.extra.rendus, 1, 'sans mémoire : un seul rendu de l\'accueil')
        assert.equal(avec.extra.rendus, 1, 'mémoire égale à la graine : un seul rendu de l\'accueil, comme sans mémoire')
        assert.deepEqual(avec.extra.ecritures, [])
      })
    }
  })

  // ---- sans graine : rien ne change ----

  describe('page sans rendu serveur (sans graine), mémorisation active (production)', function () {
    let page: Page | null = null

    before(async function () {
      page = await construire({ nom: 'memoire-csr', composants: COMPOSANTS, env: 'prod', sansRendu: true, i18n: { persist: true } })
    })

    after(async function () {
      if (page) await page.fermer()
    })

    for (const m of MOTEURS) {
      it(`mémoire « en » : la page paraît directement en anglais, jamais en français — ${m}`, async function () {
        if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
        page!.poser(RESEAU)
        const r = await relever(navigateurs[m], page!.base + '/', SONDES, { initScript: MEMOIRE('en'), scenario: BILAN })
        const permis = (v: string) => v === EN || (v.includes('[C]') && !langues(v).has('fr'))
        assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
        assert.equal(r.vus[r.vus.length - 1], EN, 'état final : ' + r.etats.join(' /// '))
        assert.deepEqual(apresLeVide(r.vus).filter(v => !permis(v)), [], 'images hors de ce qui est permis (jamais de français) : ' + r.etats.join(' /// '))
      })
    }
  })

  // ---- dev, Chromium ----

  describe('page rendue en français par le serveur, mémoire « en » (développement)', function () {
    let page: Page | null = null

    before(async function () {
      page = await construire({ nom: 'memoire-fr-dev', composants: COMPOSANTS, env: 'dev', api: true, store: { __mjsLang: 'fr' }, i18n: { persist: true } })
    })

    after(async function () {
      if (page) await page.fermer()
    })

    it('la page passe à l\'anglais d\'un coup, Chromium', async function () {
      if (!navigateurs.chromium) this.skip()
      page!.poser(RESEAU)
      const r = await relever(navigateurs.chromium, page!.base + '/', SONDES, { initScript: MEMOIRE('en'), scenario: BILAN })
      juger(r, FR_OU_EN, EN)
      assert.deepEqual(r.extra.ecritures, [])
    })
  })
})
