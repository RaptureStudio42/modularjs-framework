// µt d'une clé dont un mot du chemin est un nom du prototype d'Object (`constructor.name`, `toString.name`,
// `imbrique.constructor.name`) : le chemin ne descend que dans les clés du dictionnaire, dont les tables n'ont pas de
// prototype — `µt('constructor.name')` ne rend que le repère de la clé absente, jamais « Object ». Une liste du dictionnaire
// reste une liste (`liste.1` rend son élément, `liste.constructor.name` « Array »). Un chemin ne descend pas non plus dans
// une chaîne (`µt('titre.0')` ne rend pas « B », la première lettre de « Bonjour »). Les libellés du runtime
// (`mjs.toast.success`…) passent par la même résolution.
// Chargement du fichier SOURCE brut, calqué sur tests/i18n-runtime.test.ts (`new Function('µ', src)(µ)`).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const storeSrc  = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_store_globals.ts'), 'utf-8')
const i18nSrc   = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_i18n.ts'), 'utf-8')

// un `µ` frais, les dictionnaires déjà là (démarrage synchrone) ; `dev` : une clé absente rend `⟦clé⟧`
function makeMu(root: Record<string, any>) {
  const µ: any = { log() {}, warn() {}, error() {}, state(o: any) { return o } }
  poserMessages(µ)
  new Function('µ', storeSrc)(µ)
  µ._i18nLangs = { fr: { root: root.fr, sections: {} }, en: { root: root.en, sections: {} } }
  µ._i18nData  = { prefix: '/i18n', langs: ['en', 'fr'], files: {}, dev: true, default: 'fr', placeholder: 'auto' }
  new Function('µ', i18nSrc)(µ)
  return µ
}

const DICTIONNAIRES = {
  fr: {
    titre:       'Bonjour',
    imbrique:    { profond: 'Valeur' },
    liste:       ['a', 'b'],
    constructor: 'Constructeur',
    outils:      { toString: 'Texte' },
    mjs:         { toast: { success: 'Gagné' } }
  },
  en: { titre: 'Hello' }
}

describe('µt — le chemin d\'une clé ne descend que dans les clés du dictionnaire', function () {
  it('un nom du prototype d\'Object en premier mot : le repère de la clé absente', function () {
    const µ = makeMu({ fr: { titre: 'Bonjour' }, en: { titre: 'Hello' } })
    for (const cle of ['constructor.name', 'toString.name', 'hasOwnProperty.name', '__proto__.constructor.name', 'valueOf.name']) assert.equal(µ.t(cle), '⟦' + cle + '⟧', cle)
  })

  it('un nom du prototype plus loin dans le chemin : le repère de la clé absente, sauf dans une liste', function () {
    const µ = makeMu(DICTIONNAIRES)
    for (const cle of ['imbrique.constructor.name', 'imbrique.toString.name', 'imbrique.__proto__.constructor.name']) assert.equal(µ.t(cle), '⟦' + cle + '⟧', cle)
    assert.equal(µ.t('liste.constructor.name'), 'Array', 'une liste du dictionnaire reste une liste')
  })

  it('un chemin ne descend pas dans une chaîne : ni son constructeur, ni ses lettres', function () {
    const µ = makeMu(DICTIONNAIRES)
    for (const cle of ['titre.constructor.name', 'titre.0', 'titre.length']) {
      assert.equal(µ.t(cle), '⟦' + cle + '⟧', cle)
    }
  })

  it('la langue de repli est lue de la même façon', function () {
    const µ = makeMu(DICTIONNAIRES)
    µ._storeSet('__mjsLang', 'en')
    return new Promise((ok) => setTimeout(ok, 30)).then(() => {
      assert.equal(µ.t('titre'), 'Hello', 'la langue affichée')
      assert.equal(µ.t('imbrique.profond'), 'Valeur', 'une clé qui manque en anglais : le français')
      assert.equal(µ.t('constructor.name'), '⟦constructor.name⟧')
      assert.equal(µ.t('titre.0'), '⟦titre.0⟧')
    })
  })

  it('les libellés du runtime : même résolution', function () {
    const µ = makeMu(DICTIONNAIRES)
    assert.equal(µ._mjs_i18nLookup('mjs.toast.success'), 'Gagné', 'le libellé du projet')
    assert.equal(µ._mjs_i18nLookup('mjs.toast.success.constructor.name'), undefined, 'pas de descente dans une chaîne')
    assert.equal(µ._mjs_i18nLookup('mjs.constructor.name'), undefined, 'pas de nom du prototype')
  })

  it('témoins : les clés du dictionnaire se lisent toujours, y compris celles qui portent un nom du prototype', function () {
    const µ = makeMu(DICTIONNAIRES)
    assert.equal(µ.t('titre'), 'Bonjour')
    assert.equal(µ.t('imbrique.profond'), 'Valeur')
    assert.equal(µ.t('liste.1'), 'b', 'une liste se lit par son indice')
    assert.equal(µ.t('constructor'), 'Constructeur', 'une clé du dictionnaire nommée constructor')
    assert.equal(µ.t('outils.toString'), 'Texte', 'une clé imbriquée nommée toString')
    assert.equal(µ.t('absente.x'), '⟦absente.x⟧', 'une clé absente : son repère')
  })
})
