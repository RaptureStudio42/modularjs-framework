// Page rendue par le serveur en français et ouverte en `?lang=en`, dans Chromium, Firefox et WebKit réels : un toast tiré pendant le
// chargement (au montage, le fichier de langue anglais encore en route) paraît dans la langue de la page, celle du serveur, puis passe
// à l'anglais avec elle, à la bascule du démarrage — le libellé anglais du framework, ou la surcharge anglaise du projet
// (`mjs.toast.success`). Aucune image ne montre le toast et la page dans deux langues. Avant, le toast gardait la langue du serveur
// (« Succès », ou la surcharge française) une fois la page passée à l'anglais, comme un toast affiché avant une bascule ordinaire

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { MOTEURS, lancer, construire, relever, apresLeVide, type Moteur, type Page, type Sonde } from './helpers/graine-page.js'

const FR = (RUNTIME_LABELS as any).fr.toast.success
const EN = (RUNTIME_LABELS as any).en.toast.success

const HOME = `@i18n 'accueil'
<script>
  µmount ->
    µ.modal.notify('bonjour', { type: 'success', duration: 0 }) unless µ.server
</script>
<h1 class="t">{µt('salut')}</h1>
`
const SONDES: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: [], sel: '.mjs-toast-title' }]
const EN_FINAL = `(function() { var h = document.querySelector('mjs-home'); var r = h && (h._shadow || h.shadowRoot); var n = r && r.querySelector('h1.t'); return !!n && n.textContent.indexOf('Hello') !== -1 && !!document.querySelector('.mjs-toast-title'); })()`

const CAS = [
  { nom: 'libellé du framework', racine: undefined, fr: [FR], en: EN },
  { nom: 'surcharge du projet', racine: { fr: 'mjs:\n  toast:\n    success: PROJET-fr-succes\n', en: { mjs: { toast: { success: 'PROJET-en-succes' } } } }, fr: [FR, 'PROJET-fr-succes'], en: 'PROJET-en-succes' }
]

// la langue d'une image : celle du titre de la page, celle du titre du toast
function langue(texte: string, fr: string[], en: string[]): string {
  if (fr.includes(texte)) return 'fr'
  if (en.includes(texte)) return 'en'
  return '?' + texte
}

describe('graine : un toast tiré pendant le chargement passe à la langue de l\'adresse avec la page (Chromium, Firefox, WebKit)', function () {
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

  for (const cas of CAS) {
    describe(cas.nom, function () {
      let page: Page | null = null

      before(async function () {
        page = await construire({ nom: 'toast-' + (cas.racine ? 'surcharge' : 'framework'), composants: { home: HOME }, env: 'prod', placeholder: 'wait', racine: cas.racine })
      })

      after(async function () {
        if (page) await page.fermer()
      })

      for (const m of MOTEURS) {
        it(`${m} : le toast paraît dans la langue du serveur, puis passe à l'anglais avec la page`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          // le fichier de langue anglais à 900 ms : le toast du montage est tiré avant la bascule du démarrage
          page!.poser({ racineEn: 900 })
          const r = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES, {
            scenario: async (p: any) => {
              await p.waitForFunction(EN_FINAL, null, { timeout: 15000 })
              await p.waitForTimeout(400)
            }
          })
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          const vus    = apresLeVide(r.vus)
          const toasts = vus.map(v => v.split(' | ')).filter(([, t]) => t !== '-')
          assert.deepEqual(vus[vus.length - 1], 'Hello home | ' + cas.en, `dernière image : ${r.etats.join(' ; ')}`)
          assert.ok(toasts.some(([h, t]) => h === 'Bonjour accueil' && cas.fr.includes(t)), `le toast est tiré pendant le chargement, dans la langue du serveur : ${r.etats.join(' ; ')}`)
          for (const [h, t] of toasts) {
            assert.equal(langue(t, cas.fr, [cas.en]), langue(h, ['Bonjour accueil'], ['Hello home']), `toast et page dans la même langue, à chaque image : ${r.etats.join(' ; ')}`)
          }
        })
      }
    })
  }
})
