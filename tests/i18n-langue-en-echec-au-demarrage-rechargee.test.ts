// Langue dont le fichier échoue AU DÉMARRAGE (réseau coupé) : le démarrage ne gèle pas, la langue est enregistrée vide et ses
// textes paraissent en barres. Elle restait vide pour toute la session : une bascule vers elle plus tard, réseau revenu,
// « réussissait » sans jamais redemander le fichier. Elle est désormais rechargée à la première bascule vers elle ; si le
// fichier échoue encore, la bascule est annulée comme pour toute langue en échec pendant une bascule. Le démarrage, lui, ne
// retente pas en boucle. Même assemblage que i18n-langue-en-echec-pendant-une-bascule.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const storeSrc = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_store_globals.ts'), 'utf-8')
const i18nSrc = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_i18n.ts'), 'utf-8')

const DONNEES = { dev: false, default: 'en', placeholder: 'wait', persist: false, detect: false, urlParam: false, prefix: '/i18n', langs: ['en', 'fr'], files: { en: '/en.js', fr: '/fr.js' } }
const FICHIERS: any = { fr: { root: { bonjour: 'Bonjour' }, sections: {} }, en: { root: { bonjour: 'Hello' }, sections: {} } }

// `echecs` : nombre de chargements du fichier anglais (langue par défaut) qui échouent avant que le réseau revienne
function monter(echecs: number): { µ: any; charges: string[]; erreurs: string[] } {
  const µ: any = { log() {}, warn() {}, error() {}, state(o: any) { return o } }
  poserMessages(µ)
  const erreurs: string[] = []
  µ.error = (m: string) => { erreurs.push(String(m)) }
  new Function('µ', storeSrc)(µ)
  µ._i18nData = DONNEES
  const charges: string[] = []
  µ._i18nImport = (url: string) => {
    const lang = url === '/en.js' ? 'en' : 'fr'
    charges.push(lang)
    if (lang === 'en' && echecs-- > 0) { return Promise.reject(new Error('réseau coupé')) }
    return Promise.resolve({ default: FICHIERS[lang] })
  }
  new Function('µ', i18nSrc)(µ)
  return { µ, charges, erreurs }
}

const attendre = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
const anglais = (charges: string[]): number => charges.filter((c) => c === 'en').length

describe('mjs_i18n — langue en échec au démarrage, rechargée à la bascule suivante', function () {
  it('démarrage en échec, bascule vers fr, puis retour vers en réseau revenu : le fichier est redemandé, « Hello »', async function () {
    const { µ, charges, erreurs } = monter(1)
    await attendre()
    assert.equal(µ._mjs_storeRaw.__mjsLang, 'en', 'le démarrage ne gèle pas')
    assert.notEqual(µ.t('bonjour'), 'Hello', 'sans son fichier, le texte n\'est pas là')
    assert.equal(erreurs.length, 1, 'l\'échec est signalé une fois')
    µ._storeSet('__mjsLang', 'fr')
    await attendre()
    assert.equal(µ.t('bonjour'), 'Bonjour')
    µ._storeSet('__mjsLang', 'en')
    await attendre()
    assert.equal(anglais(charges), 2, 'le fichier anglais est redemandé')
    assert.equal(µ._mjs_storeRaw.__mjsLang, 'en')
    assert.equal(µ.t('bonjour'), 'Hello')
  })

  it('le démarrage ne retente pas en boucle : un seul chargement tant que rien ne le redemande', async function () {
    const { µ, charges } = monter(5)
    await attendre()
    await attendre()
    assert.equal(anglais(charges), 1)
    assert.equal(µ._mjs_storeRaw.__mjsLang, 'en')
  })

  it('fichier encore en échec à la bascule : elle est annulée, puis aboutit réseau revenu', async function () {
    const { µ, charges } = monter(2)
    await attendre()
    µ._storeSet('__mjsLang', 'fr')
    await attendre()
    µ._storeSet('__mjsLang', 'en')
    await attendre()
    assert.equal(µ._mjs_storeRaw.__mjsLang, 'fr', 'bascule annulée : µlang revient à la langue affichée')
    assert.equal(µ.t('bonjour'), 'Bonjour')
    µ._storeSet('__mjsLang', 'en')
    await attendre()
    assert.equal(anglais(charges), 3)
    assert.equal(µ._mjs_storeRaw.__mjsLang, 'en')
    assert.equal(µ.t('bonjour'), 'Hello')
  })
})
