// Un composant traduit n'est rendu que le nombre de fois nécessaire au montage à froid.
//
// Défaut d'origine : le PREMIER composant `@i18n` monté avant la fin du démarrage de l'i18n
// évaluait chaque expression de son gabarit 3 fois. Trois rendus complets partaient du même
// montage : celui de `connectedCallback`, celui du rejeu de `__i18nBoot` (composant mis en file
// pendant le téléchargement du fichier de langue), et celui de l'arrivée du fragment de section
// (`_ensure.then`) — même quand le fragment était déjà là (graine de rendu serveur) ou que le
// composant n'avait qu'une clé racine. Coût mesuré : 3 évaluations de chaque `{µt(…)}` au lieu
// de 1 pour la page qui s'ouvre ; une deuxième instance montée après le démarrage : 1 (juste).
//
// Ce que le test garde, pour les 4 situations (mode `*skeleton`, l'ancien `auto`, et `wait` × textes déjà là ou à
// télécharger), en développement et en production :
//   - le nombre d'évaluations du gabarit. À froid, le fichier de la langue est lui-même un
//     téléchargement : le composant monté avant son arrivée se rend une fois en attente
//     (squelette ou vide), puis une fois avec les textes — 2, jamais 3 ; en mode `wait` il ne
//     se rend qu'une fois, avec les textes. Sauf quand la page prérendue porte déjà ses textes
//     (graine `#__mjs_i18n`) dans la langue du visiteur : un seul rendu, les bons textes, sans
//     attendre le fichier de langue (groupe « graine du rendu serveur » plus bas). Une fois le
//     démarrage passé : 1 quand la section est déjà là (graine, cache), 2 quand il faut la
//     télécharger (attente, puis textes) ;
//   - l'écran final : les bons textes, sans rien d'autre qu'un rendu d'attente avant eux ;
//   - les comportements documentés : repli de langue « toujours le fr », changement de langue,
//     `µt` dans un attribut, dans un composant enfant, clé absente (`⟦clé⟧` en développement).

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { projet } from './helpers/i18n-rendu-projet.js'

const attendre = (ms = 80) => new Promise((r) => setTimeout(r, ms))

// gabarit : chaque évaluation de `{µt(…)}` passe par `compte`, qui la note dans `globalThis.__rendus`
const SCRIPT = ['<script>', 'compte = (v) ->', '  globalThis.__rendus = (globalThis.__rendus or 0) + 1', '  v', '</script>']
const section = (mode: string) => ["@i18n 'panier'", '@i18nPlaceholder ' + mode, ...SCRIPT, '<p class="t">{compte(µt(\'resume\'))}</p>'].join('\n')
const racine = (mode: string) => ['@i18nPlaceholder ' + mode, ...SCRIPT, '<p class="t">{compte(µt(\'titre\'))}</p>'].join('\n')

async function mesure(mode: string, cas: 'section' | 'racine', opts: { graine?: boolean; prod?: boolean }) {
  const p = await projet({ ...opts, sources: { vue: cas === 'section' ? section(mode) : racine(mode) } })
  const el = p.monte('vue')
  await attendre()
  return { rendus: p.window.__rendus as number, texte: el._shadow.querySelector('p.t').textContent.trim(), requetes: p.requetes.length }
}

describe('composant traduit — nombre de rendus au montage à froid', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const env = prod ? 'production' : 'développement'
    for (const mode of ['*skeleton', 'wait']) {
      const attendu = mode === 'wait' ? 1 : 2
      it(`${env}, mode ${mode}, à froid, section déjà là (graine de rendu serveur) : 1 évaluation, le texte juste`, async () => {
        const r = await mesure(mode, 'section', { graine: true, prod })
        assert.equal(r.texte, 'Résumé du panier')
        assert.equal(r.requetes, 0, 'aucun téléchargement de section : la graine la porte')
        assert.equal(r.rendus, 1)
      })

      it(`${env}, mode ${mode}, à froid, section à télécharger : ${attendu} évaluation(s), le texte juste`, async () => {
        const r = await mesure(mode, 'section', { prod })
        assert.equal(r.texte, 'Résumé du panier')
        assert.equal(r.requetes, 1, 'un seul téléchargement')
        assert.equal(r.rendus, attendu)
      })

      if (mode === '*skeleton') it(`${env}, mode ${mode}, à froid, clé racine seule : 2 évaluations, le texte juste`, async () => {
        const r = await mesure(mode, 'racine', { prod })
        assert.equal(r.texte, 'Bienvenue')
        assert.equal(r.requetes, 0, 'la racine est dans le fichier de langue')
        assert.equal(r.rendus, 2)
      })

      it(`${env}, mode ${mode}, démarrage passé : section déjà là = 1 évaluation, section à télécharger = ${attendu}`, async () => {
        const p = await projet({ prod, sources: { vue: section(mode), autre: section(mode).replace(/panier/g, 'ailleurs') } })
        p.monte('vue')
        await attendre()
        p.window.__rendus = 0
        const el2 = p.monte('vue')
        await attendre()
        assert.equal(p.window.__rendus, 1, 'section en cache : un seul rendu')
        assert.equal(el2._shadow.querySelector('p.t').textContent.trim(), 'Résumé du panier')
        p.window.__rendus = 0
        const el3 = p.monte('autre')
        await attendre()
        assert.equal(el3._shadow.querySelector('p.t').textContent.trim(), 'Autre résumé')
        assert.equal(p.window.__rendus, attendu, 'section à télécharger')
      })
    }
  }

  it('deuxième instance montée après le démarrage : 1 évaluation (le comportement juste, gardé)', async () => {
    const p = await projet({ sources: { vue: section('*skeleton') } })
    p.monte('vue')
    await attendre()
    const avant = p.window.__rendus
    const el2 = p.monte('vue')
    await attendre()
    assert.equal(p.window.__rendus - avant, 1)
    assert.equal(el2._shadow.querySelector('p.t').textContent.trim(), 'Résumé du panier')
  })

  describe('comportements documentés, intacts après la suppression du rendu en trop', () => {
    const riche = ["@i18n 'panier'", ...SCRIPT,
      '<p class="t" title={µt(\'resume\')}>{compte(µt(\'resume\'))}</p>',
      '<p class="fr">{µt(\'seul_fr\')}</p>',
      '<p class="abs">{µt(\'inconnue\')}</p>'].join('\n')

    it('repli de langue « toujours le fr » et changement de langue : en = texte en, clé manquante en en = texte fr, un seul rendu pour la bascule', async () => {
      const p = await projet({ sources: { vue: riche } })
      const el = p.monte('vue')
      await attendre()
      const t = (c: string) => el._shadow.querySelector(c).textContent.trim()
      assert.equal(t('p.t'), 'Résumé du panier')
      assert.equal(t('p.fr'), 'Seulement en français')
      p.window.__rendus = 0
      p.window.µ.store.__mjsLang = 'en'
      await attendre(150)
      assert.equal(t('p.t'), 'Cart summary')
      assert.equal(t('p.fr'), 'Seulement en français', 'clé absente en en : repli sur le fr')
      assert.equal(p.window.__rendus, 1, 'la bascule ne rend qu\'une fois')
    })

    it('µt dans un attribut : posé avec le texte juste', async () => {
      const p = await projet({ graine: true, sources: { vue: riche } })
      const el = p.monte('vue')
      await attendre()
      assert.equal(el._shadow.querySelector('p.t').getAttribute('title'), 'Résumé du panier')
    })

    it('développement : clé absente = ⟦panier.inconnue⟧ ; production : vide', async () => {
      for (const prod of [false, true]) {
        const p = await projet({ prod, sources: { vue: riche } })
        const el = p.monte('vue')
        await attendre()
        assert.equal(el._shadow.querySelector('p.abs').textContent.trim(), prod ? '' : '⟦panier.inconnue⟧')
      }
    })

    it('production, mode *skeleton : le texte pas encore arrivé est le squelette (espaces de chiffre), puis le texte', async () => {
      const p = await projet({ prod: true, sources: { vue: section('*skeleton') } })
      let ouvrir: () => void = () => {}
      const porte = new Promise<void>((r) => { ouvrir = r })
      const vrai = p.window.fetch
      p.window.fetch = async (u: string) => { await porte; return vrai(u) }
      const el = p.monte('vue')
      await attendre(150)
      assert.equal(el._shadow.querySelector('p.t').textContent, '\u2007'.repeat(12), 'squelette tant que la section est en route')
      ouvrir()
      await attendre()
      assert.equal(el._shadow.querySelector('p.t').textContent.trim(), 'Résumé du panier')
    })

    it('composant enfant traduit dans un parent traduit : chacun affiche son texte', async () => {
      const enfant = ["@i18n 'ailleurs'", ...SCRIPT, '<i class="e">{compte(µt(\'resume\'))}</i>'].join('\n')
      const parent = ["@i18n 'panier'", ...SCRIPT, '<p class="t">{compte(µt(\'resume\'))}</p>', '<mjs-enfant></mjs-enfant>'].join('\n')
      const p = await projet({ sources: { vue: parent, enfant } })
      const el = p.monte('vue')
      await attendre(200)
      assert.equal(el._shadow.querySelector('p.t').textContent.trim(), 'Résumé du panier')
      assert.equal(el._shadow.querySelector('mjs-enfant')._shadow.querySelector('i.e').textContent.trim(), 'Autre résumé')
    })
  })

  // Graine du rendu serveur : la page prérendue porte la langue du rendu et les sections qu'il a lues.
  // Le navigateur sait donc, sans attendre le fichier de langue, quels textes afficher : si la langue
  // qu'il va choisir est celle de la graine, le composant dont tous les textes y sont se rend UNE fois,
  // avec les bons textes (comme le serveur) ; dans tous les autres cas rien ne change — jamais une
  // mauvaise langue ni un texte manquant affiché à la place d'une attente.
  describe('graine du rendu serveur : un seul rendu quand elle suffit', () => {
    const racinePlus = ['@i18nPlaceholder *skeleton', "@i18n 'panier'", ...SCRIPT, '<p class="t">{compte(µt(\'resume\'))}</p>', '<p class="r">{µt(\'/titre\')}</p>'].join('\n')
    const lire = (el: any, c = 'p.t') => el._shadow.querySelector(c).textContent.trim()

    for (const prod of [false, true]) {
      const env = prod ? 'production' : 'développement'

      it(`${env} : graine de la langue du visiteur, fichier de langue pas encore arrivé : le texte est déjà affiché, 1 rendu, et l'arrivée du fichier n'en ajoute aucun`, async () => {
        let ouvrir: () => void = () => {}
        const porte = new Promise<void>((r) => { ouvrir = r })
        const p = await projet({ prod, graine: true, porteLangue: porte, sources: { vue: section('*skeleton') } })
        const el = p.monte('vue')
        await attendre()
        assert.equal(lire(el), 'Résumé du panier', 'les textes de la graine sont affichés AVANT le fichier de langue')
        assert.equal(p.window.__rendus, 1)
        ouvrir()
        await attendre()
        assert.equal(lire(el), 'Résumé du panier')
        assert.equal(p.window.__rendus, 1, 'le fichier de langue arrive : rien à refaire, la graine avait tout')
        assert.equal(p.requetes.length, 0)
      })

      it(`${env} : puis changement de langue : 1 rendu, les textes de la nouvelle langue`, async () => {
        const p = await projet({ prod, graine: true, sources: { vue: section('*skeleton') } })
        const el = p.monte('vue')
        await attendre()
        p.window.__rendus = 0
        p.window.µ.store.__mjsLang = 'en'
        await attendre(150)
        assert.equal(lire(el), 'Cart summary')
        assert.equal(p.window.__rendus, 1)
      })

      it(`${env} : graine d'une autre langue que celle du visiteur (rendue en en, visiteur en fr) : on n'affiche pas la graine, 2 rendus, le texte fr`, async () => {
        const p = await projet({ prod, graine: { lang: 'en', sections: { en: ['panier'] } }, sources: { vue: section('*skeleton') } })
        const el = p.monte('vue')
        await attendre()
        assert.equal(lire(el), 'Résumé du panier')
        assert.equal(p.window.__rendus, 2)
        assert.equal(p.requetes.length, 1, 'le fragment fr n\'était pas dans la graine')
      })

      it(`${env} : graine fr mais visiteur en anglais (?lang=en) : on n'affiche pas la graine, 2 rendus, le texte en`, async () => {
        const p = await projet({ prod, graine: true, i18n: { urlParam: true }, url: 'http://localhost/?lang=en', sources: { vue: section('*skeleton') } })
        const el = p.monte('vue')
        await attendre()
        assert.equal(lire(el), 'Cart summary')
        assert.equal(p.window.__rendus, 2)
      })

      it(`${env} : section absente de la graine : 2 rendus (attente, puis textes)`, async () => {
        const p = await projet({ prod, graine: { lang: 'fr', sections: { fr: ['ailleurs'] } }, sources: { vue: section('*skeleton') } })
        const el = p.monte('vue')
        await attendre()
        assert.equal(lire(el), 'Résumé du panier')
        assert.equal(p.window.__rendus, 2)
        assert.equal(p.requetes.length, 1)
      })

      it(`${env} : composant qui lit aussi une clé racine (dans le fichier de langue, pas dans la graine) : 2 rendus, les deux textes`, async () => {
        const p = await projet({ prod, graine: true, sources: { vue: racinePlus } })
        const el = p.monte('vue')
        await attendre()
        assert.equal(lire(el), 'Résumé du panier')
        assert.equal(lire(el, 'p.r'), 'Bienvenue')
        assert.equal(p.window.__rendus, 2)
      })

      it(`${env} : section servie en repli sous le fr (pas de fragment en) pour un visiteur en anglais : 1 rendu, le texte du repli, aucune requête`, async () => {
        const p = await projet({ prod, graine: { lang: 'en', sections: { fr: ['panier'] } }, i18n: { urlParam: true }, url: 'http://localhost/?lang=en', sansEn: ['panier'], sources: { vue: section('*skeleton') } })
        const el = p.monte('vue')
        await attendre()
        assert.equal(lire(el), 'Résumé du panier', 'le repli fr, comme le serveur')
        assert.equal(p.window.__rendus, 1)
        assert.equal(p.requetes.length, 0)
      })
    }

    it('mode wait avec graine : 1 rendu, le texte (inchangé)', async () => {
      const p = await projet({ graine: true, sources: { vue: section('wait') } })
      const el = p.monte('vue')
      await attendre()
      assert.equal(lire(el), 'Résumé du panier')
      assert.equal(p.window.__rendus, 1)
    })

    it('sans graine (application sans prérendu) : 2 rendus comme avant, le texte juste', async () => {
      const p = await projet({ sources: { vue: section('*skeleton') } })
      const el = p.monte('vue')
      await attendre()
      assert.equal(lire(el), 'Résumé du panier')
      assert.equal(p.window.__rendus, 2)
    })

    it('graine abîmée (JSON cassé, langue absente, section qui n\'est pas un objet) : aucun effet, aucune exception, 2 rendus, le texte juste', async () => {
      for (const graine of ['{"lang":"fr","sections":{"fr":{"panier":', '{"sections":{"fr":{"panier":{"resume":"X"}}}}', '{"lang":"fr","sections":{"fr":{"panier":"texte"}}}', '{"lang":"fr","sections":{"__proto__":{"panier":{"resume":"X"}}}}']) {
        const p = await projet({ graine, sources: { vue: section('*skeleton') } })
        const el = p.monte('vue')
        await attendre()
        assert.equal(lire(el), 'Résumé du panier', graine)
        assert.equal(p.window.__rendus, 2, graine)
      }
    })
  })
})
