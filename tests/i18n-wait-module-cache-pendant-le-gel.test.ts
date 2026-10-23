// Un module en mode `wait` dont le fragment n'est pas arrivé reste CACHÉ, pas seulement gelé — pourquoi ce test existe.
//
// Défaut d'origine : le premier rendu d'un module `wait` est retenu tant que son fragment manque, mais
// l'attribut `mjs-loading` (qui cache le module, règle du bouclier) était retiré dès la microtâche
// suivante : le navigateur peignait le gabarit brut (parties fixes, liaisons vides, titres de 1 px, un
// enfant de 0 px de haut), puis les textes arrivaient et poussaient toute la page. La documentation
// (29 · i18n, modes placeholder) promet l'inverse : le module attend AVANT de s'afficher.
//
// Ce que le test garde, sur la fenêtre happy-dom (les images réellement peintes sont lues dans
// i18n-wait-module-cache-pendant-le-gel-browser.test.ts) : tant que le gel tient, l'hôte porte `mjs-loading` ; à l'arrivée du
// fragment le module est rendu ET montré. Un module monté avant le démarrage de la traduction (fichier de
// langue encore en route) est retenu de même ; un enfant créé par un `{if}` aussi. Quatre cas ne changent
// pas : un hôte de page prérendue (`mjs-ssr`) et le rendu serveur ne sont jamais retenus (la page a déjà son
// texte, la capture ne doit rien porter de masqué), les modes `*skeleton` et `key` retirent `mjs-loading` tout de
// suite, et un fragment qui échoue (404, réseau coupé) lève la retenue en même temps que le gel — le module
// se rend alors avec ses placeholders plutôt que de rester invisible.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { projet } from './helpers/i18n-rendu-projet.js'

const attendre = (ms = 40) => new Promise((r) => setTimeout(r, ms))

const PAGE = ["@i18n 'panier'", '<script>', '  $n = 7', '</script>', '', '<p class="t">{µt(\'resume\')}</p>', '<p class="n">{$n}</p>'].join('\n')
const PAGE_WAIT = ["@i18n 'panier'", '@i18nPlaceholder wait', '<script>', '  $n = 7', '</script>', '', '<p class="t">{µt(\'resume\')}</p>', '<p class="n">{$n}</p>'].join('\n')
const ENFANT = ["@i18n 'ailleurs'", '<script>', '  $m = 9', '</script>', '', '<p class="u">{µt(\'resume\')}</p>', '<p class="m">{$m}</p>'].join('\n')
const COQUILLE = ['<script>', '  $ouvert = true', '</script>', '', '<p class="fixe">fixe</p>', '{if $ouvert}<@enfantgele></@enfantgele>{end}'].join('\n')

const lire = (el: any, c = 'p.t') => el._shadow.querySelector(c)?.textContent.trim() ?? null

// retient chaque fragment jusqu'à l'appel de la valeur rendue : l'attente dure aussi longtemps que le test le décide
function porte(p: any): () => void {
  const origine = p.window.fetch
  let ouvrir: () => void = () => {}
  const ouverte = new Promise<void>((r) => { ouvrir = r })
  p.window.fetch = async (url: string) => { await ouverte; return origine(url) }
  return ouvrir
}

describe('module en mode wait — caché tant que le gel tient', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const env = prod ? 'production' : 'développement'

    it(`${env} : fragment en vol : l'hôte garde mjs-loading, puis le module paraît rendu`, async () => {
      const p = await projet({ prod, i18n: { placeholder: 'wait' }, sources: { vue: PAGE } })
      const ouvrir = porte(p)
      const el = p.monte('vue')
      await attendre()
      assert.equal(el.hasAttribute('mjs-loading'), true, 'caché tant que le fragment manque')
      assert.equal(lire(el), '', 'le gel tient : aucun texte rendu')
      ouvrir()
      await attendre(120)
      assert.equal(el.hasAttribute('mjs-loading'), false, 'montré une fois le fragment arrivé')
      assert.equal(lire(el), 'Résumé du panier')
      assert.equal(lire(el, 'p.n'), '7')
    })

    it(`${env} : mode demandé par le module seul (@i18nPlaceholder wait), config par défaut : même retenue`, async () => {
      const p = await projet({ prod, sources: { vue: PAGE_WAIT } })
      const ouvrir = porte(p)
      const el = p.monte('vue')
      await attendre()
      assert.equal(el.hasAttribute('mjs-loading'), true)
      ouvrir()
      await attendre(120)
      assert.equal(el.hasAttribute('mjs-loading'), false)
      assert.equal(lire(el), 'Résumé du panier')
    })

    it(`${env} : enfant créé par un {if} dont le fragment manque : caché de même, montré à l'arrivée`, async () => {
      const p = await projet({ prod, i18n: { placeholder: 'wait' }, sources: { coquille: COQUILLE, enfantgele: ENFANT } })
      const ouvrir = porte(p)
      const el = p.monte('coquille')
      await attendre(80)
      const enfant = el._shadow.querySelector('mjs-enfantgele')
      assert.ok(enfant, 'le {if} a bien créé l\'enfant')
      assert.equal(el.hasAttribute('mjs-loading'), false, 'la coquille, elle, n\'attend rien')
      assert.equal(enfant.hasAttribute('mjs-loading'), true, 'l\'enfant gelé reste caché')
      ouvrir()
      await attendre(120)
      assert.equal(enfant.hasAttribute('mjs-loading'), false)
      assert.equal(lire(enfant, 'p.u'), 'Autre résumé')
      assert.equal(lire(enfant, 'p.m'), '9')
    })

    it(`${env} : module monté avant le démarrage de la traduction (fichier de langue en route) : retenu jusqu'au fragment`, async () => {
      let ouvrirLangue: () => void = () => {}
      const porteLangue = new Promise<void>((r) => { ouvrirLangue = r })
      const p = await projet({ prod, i18n: { placeholder: 'wait' }, porteLangue, sources: { vue: PAGE } })
      const el = p.monte('vue')
      await attendre()
      assert.equal(el.hasAttribute('mjs-loading'), true, 'fichier de langue pas là : caché')
      ouvrirLangue()
      await attendre(150)
      assert.equal(el.hasAttribute('mjs-loading'), false)
      assert.equal(lire(el), 'Résumé du panier')
    })

    it(`${env} : fragment en échec (404) : retenu pendant l'attente, puis montré et rendu avec ses placeholders`, async () => {
      const p = await projet({ prod, i18n: { placeholder: 'wait' }, retardFragments: 80, fragmentsEnEchec: ['panier'], sources: { vue: PAGE } })
      const el = p.monte('vue')
      await attendre(20)
      assert.equal(el.hasAttribute('mjs-loading'), true, 'caché pendant l\'attente')
      await attendre(300)
      assert.equal(el.hasAttribute('mjs-loading'), false, 'la panne lève la retenue avec le gel')
      assert.equal(lire(el, 'p.n'), '7', 'rendu, pas laissé nu')
      assert.equal(lire(el), prod ? '' : '⟦panier.resume⟧', 'placeholder du mode')
    })

    it(`${env} : réseau coupé : retenu pendant l'attente, puis montré et rendu`, async () => {
      const p = await projet({ prod, i18n: { placeholder: 'wait' }, retardFragments: 80, horsLigne: true, sources: { vue: PAGE } })
      const el = p.monte('vue')
      await attendre(20)
      assert.equal(el.hasAttribute('mjs-loading'), true)
      await attendre(300)
      assert.equal(el.hasAttribute('mjs-loading'), false)
      assert.equal(lire(el, 'p.n'), '7')
    })

    it(`${env} : retiré du document pendant le gel, puis remis : ni erreur, ni hôte resté caché`, async () => {
      const rejets: unknown[] = []
      const surRejet = (e: unknown) => { rejets.push(e) }
      process.on('unhandledRejection', surRejet)
      try {
        const p = await projet({ prod, i18n: { placeholder: 'wait' }, sources: { vue: PAGE } })
        const ouvrir = porte(p)
        const el = p.monte('vue')
        await attendre()
        el.remove()
        ouvrir()
        await attendre(150)
        p.document.body.appendChild(el)
        await attendre(150)
        assert.equal(el.hasAttribute('mjs-loading'), false, 'remis au document : montré')
        assert.equal(lire(el), 'Résumé du panier')
        assert.deepEqual(rejets, [])
      }
      finally { process.off('unhandledRejection', surRejet) }
    })
  }

  // ce qui ne change pas

  it('hôte de page prérendue (mjs-ssr) : jamais retenu, il a déjà son texte', async () => {
    const p = await projet({ i18n: { placeholder: 'wait' }, sources: { vue: PAGE } })
    const ouvrir = porte(p)
    p.document.body.insertAdjacentHTML('beforeend', '<mjs-vue mjs-ssr></mjs-vue>')
    const el = p.document.body.querySelector('mjs-vue')
    await attendre()
    assert.equal(el.hasAttribute('mjs-loading'), false)
    ouvrir()
    await attendre(120)
    assert.equal(lire(el), 'Résumé du panier')
  })

  it('rendu serveur (µ.server) : jamais retenu, la capture ne doit rien porter de masqué', async () => {
    const p = await projet({ i18n: { placeholder: 'wait' }, sources: { vue: PAGE } })
    p.window.µ.server = true
    const ouvrir = porte(p)
    const el = p.monte('vue')
    await attendre()
    assert.equal(el.hasAttribute('mjs-loading'), false)
    ouvrir()
    await attendre(120)
    assert.equal(lire(el), 'Résumé du panier')
  })

  for (const mode of ['*skeleton', 'key']) {
    it(`mode ${mode} : mjs-loading retiré tout de suite, comme toujours`, async () => {
      const p = await projet({ i18n: { placeholder: mode }, sources: { vue: PAGE } })
      const ouvrir = porte(p)
      const el = p.monte('vue')
      await attendre()
      assert.equal(el.hasAttribute('mjs-loading'), false)
      assert.equal(lire(el, 'p.n'), '7', 'rendu sans attendre le fragment')
      ouvrir()
      await attendre(120)
      assert.equal(lire(el), 'Résumé du panier')
    })
  }

  it('mode wait, fragment déjà là (graine du rendu serveur) : jamais gelé, jamais retenu', async () => {
    const p = await projet({ graine: true, i18n: { placeholder: 'wait' }, sources: { vue: PAGE } })
    const el = p.monte('vue')
    await attendre()
    assert.equal(el.hasAttribute('mjs-loading'), false)
    assert.equal(lire(el), 'Résumé du panier')
  })
})
