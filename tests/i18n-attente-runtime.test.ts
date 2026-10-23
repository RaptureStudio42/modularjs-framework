// L'attente des textes traduits à l'exécution (fenêtre happy-dom, vrai build évalué : cœur, manifeste, composants).
//
// Par défaut un module traduit attend ses textes avant de paraître : caché (`mjs-loading`) tant que son fragment
// manque, puis affiché d'un coup, jamais de texte brut ni de barres. Il paraît TOUJOURS : un fragment en 404, un réseau
// coupé, un fichier de langue qui ne vient pas — le module est montré, avec des barres à la place des textes manquants (le repère
// ⟦clé⟧ en développement), jamais invisible pour toujours.
// `*skeleton` rend ce que rendait l'ancien `auto` (des barres à la place de chaque texte) ; `*loader(bloom)` affiche
// l'effet à la place du module, qui reste caché comme en `wait`, puis le retire à l'arrivée des textes.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { projet } from './helpers/i18n-rendu-projet.js'
import { assertAbsent } from './helpers/dom-assert.js'

const attendre = (ms = 40) => new Promise((r) => setTimeout(r, ms))
const BARRE    = ' '.repeat(12)

const page = (directive = '') => ["@i18n 'panier'", directive, '<script>', '  $n = 7', '</script>', '', '<p class="t">{µt(\'resume\')}</p>', '<p class="n">{$n}</p>', ''].join('\n')
const lire = (el: any, c = 'p.t') => el._shadow.querySelector(c)?.textContent.trim() ?? null
// le texte tel quel : les barres sont des espaces de chiffre, qu'un trim() emporte
const lireBrut = (el: any, c = 'p.t') => el._shadow.querySelector(c)?.textContent ?? null
// l'indicateur de chargement : dans la balise posée avant le module, jamais dans le module
const couche = (p: any) => p.document.querySelector('[mjs-i18n-loader] [mjs-fx-layer="loader"]')

// retient chaque fragment jusqu'à l'appel de la valeur rendue : l'attente dure aussi longtemps que le test le décide
function porte(p: any): () => void {
  const origine = p.window.fetch
  let ouvrir: () => void = () => {}
  const ouverte = new Promise<void>((r) => { ouvrir = r })
  p.window.fetch = async (url: string) => { await ouverte; return origine(url) }
  return ouvrir
}

describe('attente des textes traduits — wait par défaut', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const env = prod ? 'production' : 'développement'

    it(`${env} : sans directive ni réglage, le module est caché pendant l'attente puis affiché d'un coup, sans texte brut ni barres`, async () => {
      const p = await projet({ prod, sources: { vue: page() } })
      const ouvrir = porte(p)
      const el = p.monte('vue')
      await attendre()
      assert.equal(el.hasAttribute('mjs-loading'), true, 'caché tant que le fragment manque')
      assert.equal(lire(el), '', 'rien de rendu : ni ⟦clé⟧, ni barres')
      assert.equal(lire(el, 'p.n'), '', 'le gabarit n\'a même pas été rendu')
      ouvrir()
      await attendre(120)
      assert.equal(el.hasAttribute('mjs-loading'), false, 'montré une fois le fragment arrivé')
      assert.equal(lire(el), 'Résumé du panier')
      assert.equal(lire(el, 'p.n'), '7')
    })

    it(`${env} : un fragment en 404 : le module paraît quand même, avec des barres à la place de ses textes (le repère ⟦clé⟧ en développement)`, async () => {
      const p = await projet({ prod, retardFragments: 80, fragmentsEnEchec: ['panier'], sources: { vue: page() } })
      const el = p.monte('vue')
      await attendre(20)
      assert.equal(el.hasAttribute('mjs-loading'), true, 'caché pendant l\'attente')
      await attendre(300)
      assert.equal(el.hasAttribute('mjs-loading'), false, 'la panne lève la retenue')
      assert.equal(lire(el, 'p.n'), '7', 'rendu, pas laissé nu')
      assert.equal(lireBrut(el), prod ? BARRE : '⟦panier.resume⟧', 'le texte que l\'échec laisse sans valeur : les barres, jamais le vide')
    })

    it(`${env} : réseau coupé : le module paraît quand même`, async () => {
      const p = await projet({ prod, retardFragments: 80, horsLigne: true, sources: { vue: page() } })
      const el = p.monte('vue')
      await attendre(20)
      assert.equal(el.hasAttribute('mjs-loading'), true)
      await attendre(300)
      assert.equal(el.hasAttribute('mjs-loading'), false)
      assert.equal(lire(el, 'p.n'), '7')
      assert.equal(lireBrut(el), prod ? BARRE : '⟦panier.resume⟧', 'réseau coupé : les barres aussi')
    })

    it(`${env} : le fichier de langue ne vient pas (échec du téléchargement) : le module paraît quand même`, async () => {
      const panne = Promise.reject(new Error('HTTP 404 sur le fichier de langue'))
      panne.catch(() => {})
      const p = await projet({ prod, porteLangue: panne, sources: { vue: page() } })
      const el = p.monte('vue')
      await attendre(300)
      assert.equal(el.hasAttribute('mjs-loading'), false, 'jamais invisible pour toujours')
      assert.equal(lire(el, 'p.n'), '7')
    })

    it(`${env} : une langue sans fragment pour la section : le module paraît, avec le texte de la langue par défaut`, async () => {
      const p = await projet({ prod, url: 'http://localhost/?lang=en', i18n: { urlParam: true }, sansEn: ['panier'], sources: { vue: page() } })
      const el = p.monte('vue')
      await attendre(300)
      assert.equal(el.hasAttribute('mjs-loading'), false)
      assert.equal(lire(el), 'Résumé du panier', 'repli sur le français')
    })
  }

  it('une graine du rendu serveur : le module n\'attend rien, ses textes sont déjà là', async () => {
    const p = await projet({ prod: true, graine: true, sources: { vue: page() } })
    const ouvrir = porte(p)
    const el = p.monte('vue')
    await attendre(80)
    assert.equal(el.hasAttribute('mjs-loading'), false)
    assert.equal(lire(el), 'Résumé du panier')
    ouvrir()
  })

  it('wait écrit dans la configuration ou dans le module : même comportement que le défaut', async () => {
    for (const p of [await projet({ prod: true, i18n: { placeholder: 'wait' }, sources: { vue: page() } }), await projet({ prod: true, sources: { vue: page('@i18nPlaceholder wait') } })]) {
      const ouvrir = porte(p)
      const el = p.monte('vue')
      await attendre()
      assert.equal(el.hasAttribute('mjs-loading'), true)
      ouvrir()
      await attendre(120)
      assert.equal(lire(el), 'Résumé du panier')
    }
  })
})

describe('attente des textes traduits — *skeleton', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('production : le rendu d\'avant (des barres à la place de chaque texte, le module est déjà là), puis le texte', async () => {
    for (const p of [await projet({ prod: true, i18n: { placeholder: '*skeleton' }, sources: { vue: page() } }), await projet({ prod: true, sources: { vue: page('@i18nPlaceholder *skeleton') } })]) {
      const ouvrir = porte(p)
      const el = p.monte('vue')
      await attendre()
      assert.equal(el.hasAttribute('mjs-loading'), false, 'le module est affiché, pas retenu')
      assert.equal(lireBrut(el), BARRE, 'les barres à la place du texte en route')
      assert.equal(lire(el, 'p.n'), '7', 'le reste du module est rendu')
      ouvrir()
      await attendre(120)
      assert.equal(lire(el), 'Résumé du panier')
    }
  })

  it('développement : comme l\'ancien auto, le repère ⟦clé⟧ et non les barres', async () => {
    const p = await projet({ prod: false, i18n: { placeholder: '*skeleton' }, sources: { vue: page() } })
    const ouvrir = porte(p)
    const el = p.monte('vue')
    await attendre()
    assert.equal(lire(el), '⟦panier.resume⟧')
    ouvrir()
    await attendre(120)
    assert.equal(lire(el), 'Résumé du panier')
  })

  it('key : toujours le nom de la clé, en production comme en développement', async () => {
    const p = await projet({ prod: true, i18n: { placeholder: 'key' }, sources: { vue: page() } })
    const ouvrir = porte(p)
    const el = p.monte('vue')
    await attendre()
    assert.equal(lire(el), '⟦panier.resume⟧')
    ouvrir()
    await attendre(120)
    assert.equal(lire(el), 'Résumé du panier')
  })
})

describe('attente des textes traduits — *loader(bloom)', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, fabrique] of [
    ['directive du module', () => projet({ prod: true, sources: { vue: page('@i18nPlaceholder *loader(bloom)') } })],
    ['configuration', () => projet({ prod: true, i18n: { placeholder: '*loader(bloom)' }, sources: { vue: page() } })],
  ] as const) {
    it(`${nom} : l'effet est affiché pendant l'attente, le module reste vide, puis l'effet est retiré et le module rendu`, async () => {
      const p = await fabrique()
      const ouvrir = porte(p)
      const el = p.monte('vue')
      await attendre()
      assert.ok(couche(p), 'l\'indicateur de chargement est affiché à la place du module')
      assert.equal(couche(p).getAttribute('mjs-fx-loader-style'), 'bloom')
      assert.equal(el.previousElementSibling.hasAttribute('mjs-i18n-loader'), true, 'posé juste avant le module')
      assert.equal(el.hasAttribute('mjs-loading'), true, 'le module reste caché comme en wait : le gabarit brut ne se peint jamais')
      assert.equal(lire(el), '', 'et il n\'est pas rendu')
      ouvrir()
      await attendre(120)
      assertAbsent(couche(p), 'l\'indicateur est retiré')
      assertAbsent(p.document.querySelector('[mjs-i18n-loader]'), 'avec sa balise')
      assert.equal(el.hasAttribute('mjs-loading'), false, 'le module est montré')
      assert.equal(lire(el), 'Résumé du panier')
      assert.equal(lire(el, 'p.n'), '7')
    })
  }

  it('un fragment en 404 : l\'indicateur est retiré et le module paraît avec des barres à la place de ses textes', async () => {
    const p = await projet({ prod: true, retardFragments: 100, fragmentsEnEchec: ['panier'], sources: { vue: page('@i18nPlaceholder *loader(bloom)') } })
    const el = p.monte('vue')
    await attendre(30)
    assert.ok(couche(p), 'visible pendant l\'attente')
    await attendre(300)
    assertAbsent(couche(p))
    assert.equal(el.hasAttribute('mjs-loading'), false)
    assert.equal(lire(el, 'p.n'), '7')
    assert.equal(lireBrut(el), BARRE, 'les barres du texte que l\'échec laisse sans valeur, pas le vide')
  })

  it('une graine du rendu serveur : aucun indicateur, le module est déjà là', async () => {
    const p = await projet({ prod: true, graine: true, sources: { vue: page('@i18nPlaceholder *loader(bloom)') } })
    const el = p.monte('vue')
    await attendre(80)
    assertAbsent(couche(p))
    assert.equal(lire(el), 'Résumé du panier')
  })
})

describe('attente des textes traduits — le secours de wait (3 s)', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  // une horloge simulée : les minuteries de 3 s du secours sont relevées, jamais armées pour de bon (celles du reste passent)
  function horloge(p: any) {
    const secours: Array<{ fn: () => void, defaite: boolean }> = []
    const arme   = p.window.setTimeout.bind(p.window)
    const defait = p.window.clearTimeout.bind(p.window)
    p.window.setTimeout = (fn: any, ms?: number, ...args: any[]) => {
      if (ms !== 3000) return arme(fn, ms, ...args)
      secours.push({ fn, defaite: false })
      return -secours.length
    }
    p.window.clearTimeout = (id: any) => {
      if (typeof id === 'number' && id < 0) secours[-id - 1].defaite = true
      else defait(id)
    }
    return secours
  }
  // une requête qui ne répond que quand le test le décide
  function silence(p: any): () => void {
    const origine = p.window.fetch
    let repondre: () => void = () => {}
    const retenue = new Promise<void>((r) => { repondre = r })
    p.window.fetch = (url: string) => retenue.then(() => origine(url))
    return repondre
  }

  it('une requête qui ne répond jamais : au bout de 3 s le module paraît avec des barres, puis les vrais textes les remplacent', async () => {
    const p = await projet({ prod: true, sources: { vue: page() } })
    const secours = horloge(p)
    const repondre = silence(p)
    const el = p.monte('vue')
    await attendre()
    assert.equal(secours.length, 1, 'une minuterie de secours armée')
    assert.equal(el.hasAttribute('mjs-loading'), true, 'caché avant l\'échéance')
    secours[0].fn()
    await attendre(60)
    assert.equal(el.hasAttribute('mjs-loading'), false, 'le module paraît')
    assert.equal(lireBrut(el), BARRE, 'avec des barres à la place du texte')
    assert.equal(lire(el, 'p.n'), '7', 'le reste du module est rendu')
    repondre()
    await attendre(150)
    assert.equal(lire(el), 'Résumé du panier', 'les vrais textes remplacent les barres')
    assert.equal(secours.length, 1, 'une seule minuterie, jamais réarmée')
  })

  it('développement : un avertissement le dit, une seule fois', async () => {
    const p = await projet({ prod: false, sources: { vue: page() } })
    const secours = horloge(p)
    const repondre = silence(p)
    const avertis: string[] = []
    p.window.µ.warn = (...a: unknown[]) => { avertis.push(a.join(' ')) }
    const el = p.monte('vue')
    await attendre()
    secours[0].fn()
    secours[0].fn()
    await attendre(60)
    assert.equal(avertis.filter(a => /3000/.test(a)).length, 1, `avertissements : ${JSON.stringify(avertis)}`)
    assert.equal(el.hasAttribute('mjs-loading'), false)
    repondre()
    await attendre(150)
    assert.equal(lire(el), 'Résumé du panier')
  })

  it('des textes à l\'heure : la minuterie est défaite, un rendu tardif du secours ne fait rien (pas de fuite, pas de rendu de plus)', async () => {
    // développement : le build de production renomme `_mjs_invalidate`, que ce test observe
    const p = await projet({ prod: false, sources: { vue: page() } })
    const secours = horloge(p)
    const ouvrir = porte(p)
    const el = p.monte('vue')
    await attendre()
    assert.equal(secours.length, 1)
    ouvrir()
    await attendre(150)
    assert.equal(lire(el), 'Résumé du panier')
    assert.equal(secours[0].defaite, true, 'défaite dès l\'arrivée des textes')
    let rendus = 0
    const invalider = el._mjs_invalidate.bind(el)
    el._mjs_invalidate = (...a: unknown[]) => { rendus++; return invalider(...a) }
    secours[0].fn()
    await attendre(60)
    assert.equal(rendus, 0, 'aucun rendu de plus')
    assert.equal(lire(el), 'Résumé du panier', 'ni barres, ni retour en arrière')
  })

  it('un module retiré pendant l\'attente ne laisse aucune minuterie armée', async () => {
    const p = await projet({ prod: true, sources: { vue: page() } })
    const secours = horloge(p)
    silence(p)
    const el = p.monte('vue')
    await attendre()
    el.remove()
    await attendre(40)
    assert.equal(secours[0].defaite, true)
  })

  it('*loader et *skeleton n\'ont pas besoin du délai : aucune minuterie', async () => {
    for (const directive of ['@i18nPlaceholder *loader(bloom)', '@i18nPlaceholder *skeleton']) {
      const p = await projet({ prod: true, sources: { vue: page(directive) } })
      const secours = horloge(p)
      silence(p)
      p.monte('vue')
      await attendre()
      assert.equal(secours.length, 0, directive)
    }
  })

  it('une page prérendue (hôte mjs-ssr) n\'est pas concernée : aucune minuterie', async () => {
    const p = await projet({ prod: true, sources: { vue: page() } })
    const secours = horloge(p)
    silence(p)
    p.document.body.insertAdjacentHTML('beforeend', '<mjs-vue mjs-ssr></mjs-vue>')
    await attendre()
    assert.equal(secours.length, 0)
  })
})
