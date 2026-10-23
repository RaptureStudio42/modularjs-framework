// Un composant traduit dont le fragment de section ÉCHOUE au premier chargement n'est pas laissé en attente.
//
// Défaut d'origine : un composant `@i18n 'panier'` qui lit AUSSI une clé racine (`{µt('/titre')}`) ou une
// autre section sans la déclarer (`{µt('/ailleurs.resume')}`) restait sur `⟦titre⟧` / `⟦ailleurs.resume⟧`
// quand le fragment `panier` répondait 404 : le rendu de rattrapage du démarrage est sauté quand le fragment
// est « en vol » (son arrivée rendra le composant), mais son ÉCHEC ne prévenait personne. Le démarrage rend
// maintenant le composant à l'échec du fragment, s'il est toujours dans la page.
//
// Ce que le test garde : la clé racine et l'autre section s'affichent malgré l'échec (la 2ᵉ est demandée) ;
// un fragment qui réussit ne coûte aucun rendu de plus ; un composant démonté avant l'échec ne lève rien ;
// hors ligne, les requêtes ne bouclent pas.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { projet } from './helpers/i18n-rendu-projet.js'

const attendre = (ms = 80) => new Promise((r) => setTimeout(r, ms))

const SCRIPT = ['<script>', 'compte = (v) ->', '  globalThis.__rendus = (globalThis.__rendus or 0) + 1', '  v', '</script>']
const AVEC_RACINE = ["@i18n 'panier'", '@i18nPlaceholder *skeleton', ...SCRIPT, '<p class="t">{compte(µt(\'resume\'))}</p>', '<p class="r">{µt(\'/titre\')}</p>'].join('\n')
const AVEC_AUTRE  = ["@i18n 'panier'", '@i18nPlaceholder *skeleton', ...SCRIPT, '<p class="t">{compte(µt(\'resume\'))}</p>', '<p class="u">{µt(\'/ailleurs.resume\')}</p>'].join('\n')
// les fragments de section seuls (la production demande aussi son fichier de messages)
const fragments = (p: any): string[] => p.requetes.filter((u: string) => u.includes('/i18n/'))
const lire = (el: any, c = 'p.t') => el._shadow.querySelector(c).textContent.trim()

describe('composant traduit — fragment en échec au démarrage', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const env = prod ? 'production' : 'développement'

    it(`${env} : fragment de la section déclarée en 404 + clé racine : la clé racine s'affiche`, async () => {
      const p = await projet({ prod, retardFragments: 40, fragmentsEnEchec: ['panier'], sources: { vue: AVEC_RACINE } })
      const el = p.monte('vue')
      await attendre(300)
      assert.equal(lire(el, 'p.r'), 'Bienvenue')
      assert.equal(fragments(p).length, 1, 'un seul fragment demandé : celui de panier')
    })

    it(`${env} : fragment de la section déclarée en 404 + autre section lue sans déclaration : elle est demandée et s'affiche`, async () => {
      const p = await projet({ prod, retardFragments: 40, fragmentsEnEchec: ['panier'], sources: { vue: AVEC_AUTRE } })
      const el = p.monte('vue')
      await attendre(400)
      assert.equal(lire(el, 'p.u'), 'Autre résumé')
      assert.equal(fragments(p).length, 2, 'panier (en échec) puis ailleurs')
    })

    it(`${env} : fragment qui réussit : la clé racine et le texte de la section s'affichent, sans rendu de plus`, async () => {
      const p = await projet({ prod, retardFragments: 40, sources: { vue: AVEC_RACINE } })
      const el = p.monte('vue')
      await attendre(300)
      assert.equal(lire(el), 'Résumé du panier')
      assert.equal(lire(el, 'p.r'), 'Bienvenue')
      assert.equal(p.window.__rendus, 2, 'attente, puis textes : comme avant')
    })
  }

  it('composant démonté avant l\'échec du fragment : aucune erreur', async () => {
    const rejets: unknown[] = []
    const surRejet = (e: unknown) => { rejets.push(e) }
    process.on('unhandledRejection', surRejet)
    try {
      const p = await projet({ retardFragments: 60, fragmentsEnEchec: ['panier'], sources: { vue: AVEC_RACINE } })
      const erreurs: unknown[] = []
      p.window.addEventListener('error', (e: any) => { erreurs.push(e.message) })
      const el = p.monte('vue')
      await attendre(10)
      el.remove()
      await attendre(300)
      assert.deepEqual(erreurs, [])
      assert.deepEqual(rejets, [], 'aucune promesse rejetée sans suite')
    }
    finally { process.off('unhandledRejection', surRejet) }
  })

  it('hors ligne total : pas de boucle de requêtes', async () => {
    const p = await projet({ retardFragments: 20, horsLigne: true, sources: { vue: AVEC_RACINE, autre: AVEC_AUTRE } })
    p.monte('vue')
    p.monte('autre')
    await attendre(300)
    const apres = p.requetes.length
    assert.ok(apres <= 4, `${apres} requêtes`)
    await attendre(500)
    assert.equal(p.requetes.length, apres, 'plus aucune requête après coup')
  })
})
