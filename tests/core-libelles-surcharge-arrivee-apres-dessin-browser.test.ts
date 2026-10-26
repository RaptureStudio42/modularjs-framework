// Libellés des modules cœur surchargés par le projet (`mjs.core.<clé>` dans les textes racine), page sans rendu serveur : le fichier de la
// langue arrive APRÈS le dessin du module (réseau lent). Au démarrage, le module prend la surcharge à l'arrivée du fichier. À une bascule
// de langue (µlang passé à l'anglais une fois la page affichée), le module se redessine aussitôt avec le libellé anglais du framework,
// puis prend la surcharge anglaise du projet dès que le fichier anglais arrive. Avant, rien ne le redessinait à cette arrivée : la
// surcharge ne se voyait que si le fichier était déjà là. Même chose pour le texte « aucun résultat » de `<@@select>`, ouvert sur une
// recherche sans résultat pendant la bascule, quand l'auteur écrit `placeholder` et `search-placeholder` (aucun autre libellé du module
// n'est alors lu) : il restait au libellé anglais du framework. Page qui démarre dans une autre langue que la langue par défaut (`?lang=en`),
// les deux fichiers retardés, dans un ordre puis dans l'autre : le module paraît avec le libellé anglais du framework et prend la surcharge
// anglaise à l'arrivée du fichier anglais ; il ne montre jamais le français (avant, la recherche se faisait dans la langue par défaut : il
// prenait la surcharge française). Chromium, Firefox et WebKit réels, développement et production.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, apresLeVide, type Moteur, type Page, type Sonde } from './helpers/graine-page.js'

const HOME   = '<script>\n  basculer = -> µlang = \'en\'\n</script>\n<button class="en" @click={basculer()}>EN</button>\n<@@chart rows={[]}></@@chart>\n'
const SONDES: Sonde[] = [{ chemin: ['mjs-home', 'mjs-core-chart'], sel: 'p.empty' }]
const RACINE = { fr: 'mjs:\n  core:\n    chartEmpty: Rien à montrer\n', en: { mjs: { core: { chartEmpty: 'Nothing to show' } } } }

// la liste, dans une page traduite (son titre est un texte du projet) : l'auteur écrit ses deux textes d'attente, la langue passe à
// l'anglais par le script de la page (un clic hors de la liste la fermerait)
const HOME_SELECT   = '<script>\n  basculer = -> µlang = \'en\'\n\n  µmount ->\n    window.__basculer = basculer\n</script>\n<h1>{µt(\'titre\')}</h1>\n<@@select placeholder="Ville" search-placeholder="Chercher une ville" search><@@option value="1">Paris</@@option><@@option value="2">Lyon</@@option></@@select>\n'
const SONDES_SELECT: Sonde[] = [{ chemin: ['mjs-home', 'mjs-core-select'], sel: '.select-empty' }]
const RACINE_SELECT = { fr: 'mjs:\n  core:\n    selectEmpty: Rien trouvé\n', en: { mjs: { core: { selectEmpty: 'Nothing found' } } } }

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
      let pageSelect: Page | null = null

      before(async function () {
        page       = await construire({ nom: 'surcharge-tardive-' + env, composants: { home: HOME }, env, sansRendu: true, racine: RACINE })
        pageSelect = await construire({ nom: 'surcharge-tardive-select-' + env, composants: { home: HOME_SELECT }, env, sansRendu: true, racine: RACINE_SELECT })
      })

      after(async function () {
        if (page) await page.fermer()
        if (pageSelect) await pageSelect.fermer()
      })

      // la bascule : le bouton de la page passe µlang à l'anglais 600 ms après le chargement, la page déjà affichée en français
      const basculer = async (p: any) => {
        await p.waitForTimeout(600)
        await p.evaluate(() => { (document.querySelector('mjs-home') as any)._shadow.querySelector('button.en').click() })
        await p.waitForTimeout(2400)
      }
      const CAS: Array<{ nom: string, url?: string, retard: { racineFr?: number, racineEn?: number }, scenario?: (p: any) => Promise<void>, attente?: number, avant: string, apres: string, jamais?: string[] }> = [
        { nom: 'démarrage en français, fichier de la langue par défaut retardé', retard: { racineFr: 900 }, avant: 'Aucune valeur', apres: 'Rien à montrer' },
        { nom: 'bascule vers l\'anglais, fichier anglais retardé', retard: { racineEn: 900 }, scenario: basculer, avant: 'No values', apres: 'Nothing to show' },
        { nom: 'démarrage dans la langue voulue (?lang=en), fichier anglais arrivé avant le français', url: '/?lang=en', retard: { racineEn: 900, racineFr: 1800 }, attente: 3200, avant: 'No values', apres: 'Nothing to show', jamais: ['Aucune valeur', 'Rien à montrer'] },
        { nom: 'démarrage dans la langue voulue (?lang=en), fichier français arrivé avant l\'anglais', url: '/?lang=en', retard: { racineFr: 900, racineEn: 1800 }, attente: 3200, avant: 'No values', apres: 'Nothing to show', jamais: ['Aucune valeur', 'Rien à montrer'] },
      ]

      for (const m of MOTEURS) for (const c of CAS) {
        it(`${m} : ${c.nom}`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          page!.poser(c.retard)
          const r = await relever(navigateurs[m], page!.base + (c.url ?? '/'), SONDES, c.scenario ? { scenario: c.scenario } : { attente: c.attente ?? 2600 })
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          const vus = apresLeVide(r.vus)
          assert.ok(vus.includes(c.avant), `le module paraît avant le fichier de la langue, avec le libellé du framework : ${r.etats.join(' /// ')}`)
          assert.ok(vus.indexOf(c.avant) < vus.indexOf(c.apres), `le libellé du framework vient avant la surcharge : ${r.etats.join(' /// ')}`)
          assert.equal(vus[vus.length - 1], c.apres, `la surcharge du projet se voit à l'arrivée du fichier : ${r.etats.join(' /// ')}`)
          for (const texte of c.jamais ?? []) assert.ok(!vus.includes(texte), `jamais « ${texte} » : ${r.etats.join(' /// ')}`)
        })
      }

      // la liste s'ouvre sur « zzz » (aucun résultat) en français, puis la page passe à l'anglais, fichier anglais retardé ; chaque geste
      // attend que la liste soit prête, et la bascule que le relevé ait vu le texte français (un moteur chargé espace ses images)
      const chercherPuisBasculer = async (p: any) => {
        const ombre    = `document.querySelector('mjs-home')?._shadow?.querySelector('mjs-core-select')?._shadow`
        const attendre = (expr: string) => p.waitForFunction(expr, null, { polling: 50 })
        await attendre(`!!${ombre}?.querySelector('.select-btn')`)
        await p.evaluate(`${ombre}.querySelector('.select-btn').click()`)
        await attendre(`!!${ombre}?.querySelector('.select-search')`)
        await p.evaluate(`${ombre}.querySelector('.select-search').focus()`)
        await p.keyboard.type('zzz')
        await p.waitForFunction(() => ((window as any).__vus ?? []).includes('Rien trouvé'), null, { polling: 50, timeout: 5000 }).catch(() => {})
        await p.evaluate(() => (window as any).__basculer())
        await p.waitForTimeout(2400)
      }

      for (const m of MOTEURS) {
        it(`${m} : <@@select> ouvert sur « aucun résultat », bascule vers l'anglais, fichier anglais retardé`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pageSelect!.poser({ racineEn: 900 })
          const r = await relever(navigateurs[m], pageSelect!.base + '/', SONDES_SELECT, { scenario: chercherPuisBasculer })
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          const vus = apresLeVide(r.vus)
          assert.ok(vus.includes('Rien trouvé'), `la recherche sans résultat montre la surcharge française : ${r.etats.join(' /// ')}`)
          assert.ok(vus.indexOf('Rien trouvé') < vus.indexOf('No results'), `pendant l'attente du fichier anglais, le libellé anglais du framework : ${r.etats.join(' /// ')}`)
          assert.equal(vus[vus.length - 1], 'Nothing found', `la surcharge anglaise se voit à l'arrivée du fichier : ${r.etats.join(' /// ')}`)
        })
      }
    })
  }
})
