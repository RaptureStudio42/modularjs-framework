// Page rendue par l'API du serveur (`createSSRRenderer`, `renderToString`) pour une application traduite SANS bloc `render` ni `"runtime": ["hydrate"]` :
// la graine `#__mjs_i18n` porte les textes RACINE (clés hors section) que la page a lus, et le navigateur les reprend quand même. Un module qui en lit
// paraît avec tous ses textes dès sa première image et n'en perd aucun le temps que le fichier de langue arrive (retardé de 700 ms ici), quel que soit
// le réglage `placeholder` : Chromium, Firefox et WebKit réels.
//
// Le texte du module est relevé à chaque image (`requestAnimationFrame`), depuis la première ; une image où le texte racine manque (un trou entre les
// deux barres obliques) fait échouer le test.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, apresLeVide, type Moteur, type Page, type Sonde } from './helpers/graine-page.js'

const COMPOSANTS = { home: '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'/titre\')} / {µt(\'/enfant\')}</h1>\n' }
const SONDES: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }]
const FINAL = 'Bonjour accueil / Titre / Enfant'

describe('graine : les textes racine d\'une page rendue par l\'API, dans une application sans bloc render ni hydrate (Chromium, Firefox, WebKit)', function () {
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

  for (const [env, placeholder] of [['prod', 'wait'], ['prod', '*skeleton'], ['dev', 'wait']] as Array<['prod' | 'dev', string]>) {
    describe(`page rendue par l'API (${env}, ${placeholder})`, function () {
      let page: Page | null = null

      before(async function () {
        page = await construire({ nom: 'api-' + env + '-' + placeholder.replace(/\W/g, ''), composants: COMPOSANTS, env, placeholder, api: true })
      })

      after(async function () {
        if (page) await page.fermer()
      })

      it('la page porte une graine avec les textes racine que le rendu a lus, et eux seuls', async function () {
        const html = await (await fetch(page!.base + '/')).text()
        const balise = html.match(/<script[^>]*id="__mjs_i18n"[^>]*>([\s\S]*?)<\/script>/)
        assert.ok(balise, 'la page rendue par l\'API porte sa graine de traduction')
        const graine = JSON.parse(balise![1])
        assert.deepEqual(graine.root, { fr: { titre: 'Titre', enfant: 'Enfant' } })
        assert.deepEqual(graine.sections, { fr: { accueil: { salut: 'Bonjour accueil' } } })
      })

      for (const m of MOTEURS) {
        it(`${m} : le texte racine ne disparaît pas, le temps que le fichier de langue arrive`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          page!.poser({ racineFr: 700 })
          const r = await relever(navigateurs[m], page!.base + '/', SONDES)
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          assert.deepEqual(apresLeVide(r.vus), [FINAL], `une seule valeur, jamais de trou : ${r.etats.join(' /// ')}`)
        })
      }
    })
  }
})
