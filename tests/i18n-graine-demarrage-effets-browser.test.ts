// La bascule du démarrage (page rendue en français, `?lang=en`) vue du code de l'application, dans Chromium, Firefox et WebKit réels :
//
// 1. Un guetteur direct de la langue (`µ._mjs_storeWatch('__mjsLang', …)`) reçoit la langue voulue UNE seule fois au démarrage, pas deux.
// 2. Un clic qui ramène `µlang` à la langue de la graine pendant la bascule du démarrage (`fr` → `en` demandé, `fr` re-demandé avant que la page
//    ait passé) ne prévient aucun crochet de l'effet `*lang` : la langue ne change pas à l'écran. Un vrai changement de langue, lui, les prévient.
//    La mémoire de la langue et l'adresse suivent le clic, comme à tout choix de l'utilisateur.
//
// Le composant journalise dans `window.__log` ce que voient son guetteur (`watch:<langue>`) et son crochet de bascule (`hook:<avant>><après>`).

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, type Moteur, type Page, type Sonde } from './helpers/graine-page.js'

const HOME = `@i18n 'accueil'
<script>
  jn = (s)->
    if typeof window != 'undefined'
      window.__log = [] unless window.__log
      window.__log.push(s)

  setLang = (l)-> µlang = l

  if typeof window != 'undefined'
    µ._mjs_storeWatch('__mjsLang', (v)-> jn('watch:' + v))
    (µ._mjs_i18nSwapHooks or (µ._mjs_i18nSwapHooks = new Set())).add((n, p)-> jn('hook:' + p + '>' + n))
    window.__setLang = setLang
</script>
<h1 class="t">{µt('salut')}</h1>
<mjs-kid-section></mjs-kid-section>
`
const COMPOSANTS = { home: HOME, 'kid-section': '@i18n \'fiche\'\n<i class="ks">{µt(\'nom\')}</i>\n' }
const SONDES: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }]

// ce que la page dit à un instant : le journal du composant, son titre, la mémoire de la langue et l'adresse
const LIRE = `(function() {
  var h = document.querySelector('mjs-home');
  var r = h && (h._shadow || h.shadowRoot);
  var n = r && r.querySelector('h1.t');
  var m;
  try { m = localStorage.getItem('__mjsLang'); } catch (e) { m = 'illisible'; }
  return { log: (window.__log || []).slice(), h1: n ? n.textContent.trim() : null, memoire: m, adresse: location.search };
})()`
const EN_FINAL   = `(function() { var h = document.querySelector('mjs-home'); var r = h && (h._shadow || h.shadowRoot); var n = r && r.querySelector('h1.t'); return !!n && n.textContent.indexOf('Hello') !== -1; })()`
const DEMARRAGE  = 'window.__log && window.__log.indexOf(\'watch:en\') !== -1'

interface Vu { log: string[], h1: string | null, memoire: string | null, adresse: string }

describe('graine : la bascule du démarrage vue du code de l\'application (Chromium, Firefox, WebKit)', function () {
  this.timeout(300000)
  const navigateurs: Partial<Record<Moteur, any>> = {}
  let page: Page | null = null

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
    page = await construire({ nom: 'effets', composants: COMPOSANTS, env: 'prod', placeholder: 'wait', i18n: { persist: true } })
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    if (page) await page.fermer()
    await terminateSharedWorkerPool()
  })

  // le fichier de langue anglais à 300 ms, l'accueil à 900 ms, la fiche à 700 ms : la page passe vers 1,2 s
  const RESEAU = { racineEn: 300, retards: { accueil: 900, fiche: 700 } }

  for (const m of MOTEURS) {
    describe(m, function () {
      beforeEach(function () {
        if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
        page!.poser(RESEAU)
      })

      it('?lang=en : le guetteur direct reçoit « en » une seule fois, aucun crochet, ni mémoire ni adresse retouchées', async function () {
        const r = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES, {
          scenario: async (p: any) => {
            await p.waitForFunction(EN_FINAL, null, { timeout: 15000 })
            await p.waitForTimeout(400)
            return p.evaluate(LIRE)
          }
        })
        const vu = r.extra as Vu
        assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
        assert.deepEqual(vu.log, ['watch:en'], 'un seul passage de « en » au guetteur, aucun crochet de bascule')
        assert.equal(vu.memoire, null, 'la langue du démarrage n\'est pas mémorisée')
        assert.equal(vu.adresse, '?lang=en', 'l\'adresse reste celle de la page')
      })

      it('un clic « fr » pendant la bascule du démarrage : aucun crochet (la langue ne change pas à l\'écran), la page reste en français, mémoire et adresse suivent', async function () {
        const r = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES, {
          scenario: async (p: any) => {
            await p.waitForFunction(DEMARRAGE, null, { timeout: 15000 })
            await p.evaluate('window.__setLang(\'fr\')')
            await p.waitForTimeout(2600)
            return p.evaluate(LIRE)
          }
        })
        const vu = r.extra as Vu
        assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
        assert.deepEqual(vu.log, ['watch:en', 'watch:fr'], 'le guetteur voit « en » puis « fr » ; aucun crochet « hook:fr>fr »')
        assert.equal(vu.h1, 'Bonjour accueil', 'la page est restée en français')
        assert.equal(vu.memoire, 'fr', 'le choix de l\'utilisateur est mémorisé')
        assert.equal(vu.adresse, '', 'et l\'adresse revient à celle de la langue par défaut')
        assert.deepEqual(r.vus.filter(v => /Hello|Card/.test(v)), [], 'jamais un texte anglais à l\'écran : ' + r.etats.join(' /// '))
      })

      it('un vrai changement de langue après le démarrage prévient les crochets, une fois', async function () {
        const r = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES, {
          scenario: async (p: any) => {
            await p.waitForFunction(EN_FINAL, null, { timeout: 15000 })
            await p.evaluate('window.__setLang(\'fr\')')
            await p.waitForTimeout(800)
            return p.evaluate(LIRE)
          }
        })
        const vu = r.extra as Vu
        assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
        assert.deepEqual(vu.log, ['watch:en', 'watch:fr', 'hook:en>fr'])
        assert.equal(vu.h1, 'Bonjour accueil')
      })
    })
  }
})
