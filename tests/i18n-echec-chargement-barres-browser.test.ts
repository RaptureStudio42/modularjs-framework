// Un texte qui manque parce que son chargement a ÉCHOUÉ (fragment de section en 404, fichier de langue en 404) : en production, les barres du secours de
// `wait` (les douze espaces de chiffre que la page peint en gris) à la place du texte, sous `wait` comme sous `*skeleton` ; en développement, le repère
// `⟦clé⟧`. Jamais un module visible et vide. Chromium, Firefox et WebKit réels, avec et sans graine :
//
// 1. Sans graine (page sans rendu serveur) : le fragment de la section du module répond 404, ou le fichier de la langue par défaut (les textes
//    racine, et la table des fragments avec lui).
// 2. Avec graine (page prérendue, demandée en anglais) : un module que la graine ne porte pas (créé par l'hôte une fois la page passée en anglais)
//    dont le fragment anglais répond 404. L'hôte, lui, est passé à l'anglais avec la page.
//
// Le texte de chaque sonde est relevé à chaque image (`requestAnimationFrame`) : « ▒ » est une barre. Les barres sont aussi peintes (surlignage
// `mjs-i18n-skel`) dans les navigateurs qui ont cette API.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, apresLeVide, type Moteur, type Page, type Releve, type Reseau, type Sonde } from './helpers/graine-page.js'

// ce que la page peint en gris : le nombre de passages surlignés, `-1` si le navigateur n'a pas l'API
const SURLIGNAGE = async (page: any): Promise<number> => {
  await page.waitForTimeout(2600)
  return page.evaluate(() => {
    const css: any = (window as any).CSS
    if (!css || !css.highlights || typeof (window as any).Highlight !== 'function') return -1
    const h = css.highlights.get('mjs-i18n-skel')
    return h ? h.size : 0
  })
}

const COMBINAISONS: Array<['prod' | 'dev', 'wait' | '*skeleton']> = [['prod', 'wait'], ['prod', '*skeleton'], ['dev', 'wait'], ['dev', '*skeleton']]

describe('chargement en échec : des barres en production, le repère en développement (Chromium, Firefox, WebKit)', function () {
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

  // ---- 1. sans graine ----

  const HOME = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'/titre\')}</h1>\n'
  const SONDES: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }]

  for (const [env, placeholder] of COMBINAISONS) {
    describe(`sans graine (${env}, ${placeholder})`, function () {
      let page: Page | null = null

      before(async function () {
        page = await construire({ nom: 'echec-csr-' + env + '-' + placeholder.replace(/\W/g, ''), composants: { home: HOME }, env, placeholder, sansRendu: true })
      })

      after(async function () {
        if (page) await page.fermer()
      })

      // le fragment de la section répond 404 : le texte de la section manque, la racine anglaise est là
      const BARRE_SECTION = env === 'prod' ? '▒ / Title' : '⟦accueil.salut⟧ / Title'
      // le fichier de la langue par défaut répond 404 : plus rien, ni racine ni section
      const BARRE_TOUT = env === 'prod' ? '▒ / ▒' : '⟦accueil.salut⟧ / ⟦titre⟧'

      for (const m of MOTEURS) {
        it(`${m} : le fragment de la section répond 404`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          page!.poser({ racineEn: 100, echecs: ['accueil'] })
          const r = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES, { scenario: SURLIGNAGE })
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          assert.equal(r.vus[r.vus.length - 1], BARRE_SECTION, `état final : ${r.etats.join(' /// ')}`)
          assert.deepEqual(apresLeVide(r.vus).filter(v => !v.includes('[C]') && /^(\s*\/|.*\/\s*$)/.test(v)), [], `jamais un texte vide quand le module est visible : ${r.etats.join(' /// ')}`)
          if (env === 'prod' && r.extra !== -1) assert.ok(r.extra >= 1, `les barres sont peintes (surlignage : ${r.extra})`)
        })

        it(`${m} : le fichier de la langue par défaut répond 404`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          page!.poser({ echecRacineFr: true })
          const r = await relever(navigateurs[m], page!.base + '/', SONDES, { scenario: SURLIGNAGE })
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          assert.equal(r.vus[r.vus.length - 1], BARRE_TOUT, `état final : ${r.etats.join(' /// ')}`)
          assert.deepEqual(apresLeVide(r.vus).filter(v => !v.includes('[C]') && /^(\s*\/|.*\/\s*$)/.test(v)), [], `jamais un texte vide quand le module est visible : ${r.etats.join(' /// ')}`)
          if (env === 'prod' && r.extra !== -1) assert.ok(r.extra >= 1, `les barres sont peintes (surlignage : ${r.extra})`)
        })
      }
    })
  }

  // ---- 2. avec graine ----

  // l'hôte (accueil) crée un module de plus 1,5 s après son montage, une fois la page passée en anglais : le serveur ne l'a pas rendu, sa section `extra` n'est pas dans la graine
  const COMPOSANTS_GRAINE = {
    home:  '@i18n \'accueil\'\n<script>\n  $late = false\n  setTimeout((-> $late = true), 1500) unless µserver\n</script>\n<h1 class="t">{µt(\'salut\')} / {µt(\'/titre\')}</h1>\n{if $late}<mjs-extra></mjs-extra>{end}\n',
    extra: '@i18n \'extra\'\n<i class="kx">{µt(\'nom\')}</i>\n'
  }
  const SONDES_GRAINE: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-extra'], sel: 'i.kx' }]

  for (const [env, placeholder] of COMBINAISONS) {
    describe(`avec graine (${env}, ${placeholder})`, function () {
      let page: Page | null = null

      before(async function () {
        page = await construire({ nom: 'echec-graine-' + env + '-' + placeholder.replace(/\W/g, ''), composants: COMPOSANTS_GRAINE, env, placeholder })
      })

      after(async function () {
        if (page) await page.fermer()
      })

      const FINAL = env === 'prod' ? 'Hello home / Title | ▒' : 'Hello home / Title | ⟦extra.nom⟧'
      const RESEAU: Reseau = { racineEn: 100, retards: { accueil: 300 }, echecs: ['extra'] }

      for (const m of MOTEURS) {
        it(`${m} : le fragment du module que la graine ne porte pas répond 404`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          page!.poser(RESEAU)
          const r: Releve = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES_GRAINE, { scenario: SURLIGNAGE })
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          assert.equal(r.vus[r.vus.length - 1], FINAL, `état final : ${r.etats.join(' /// ')}`)
          // le module, une fois visible, n'est jamais vide
          assert.deepEqual(apresLeVide(r.vus).filter(v => /\| $/.test(v)), [], `jamais le module visible et vide : ${r.etats.join(' /// ')}`)
          if (env === 'prod' && r.extra !== -1) assert.ok(r.extra >= 1, `les barres sont peintes (surlignage : ${r.extra})`)
        })
      }
    })
  }
})
