// Bascule de langue (mjs_i18n.ts) : le fichier de la langue demandée échoue (réseau coupé, 404). La bascule aboutissait quand
// même — `µlang` valait la langue demandée (mémorisée, mise dans `?lang=`) alors que le texte restait dans l'ancienne — et la
// langue était enregistrée vide pour toute la session : une nouvelle demande, réseau revenu, ne la rechargeait jamais. Comme
// l'échec d'une section, l'échec du fichier annule désormais la bascule (`µlang` revient à l'ancienne langue) et la langue
// n'est retenue ni vide ni en cours : la demande suivante la recharge. Au démarrage, le repli sur la langue par défaut ne
// change pas. Même assemblage que i18n-chargement-langue.test.ts (sources évaluées, chargement de langue simulé).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const storeSrc = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_store_globals.ts'), 'utf-8')
const i18nSrc = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_i18n.ts'), 'utf-8')

const DONNEES = { dev: false, default: 'fr', placeholder: 'wait', persist: false, detect: false, urlParam: false, prefix: '/i18n', langs: ['en', 'fr'], files: { en: '/en.js', fr: '/fr.js' } }
const FICHIERS: any = { fr: { root: { bonjour: 'Bonjour' }, sections: {} }, en: { root: { bonjour: 'Hello' }, sections: {} } }

// `echecs` : nombre de chargements du fichier anglais qui échouent avant que le réseau revienne
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

describe('mjs_i18n — fichier de langue en échec pendant une bascule', function () {
  it('la bascule est annulée : µlang revient à l\'ancienne langue, l\'échec est signalé', async function () {
    const { µ, erreurs } = monter(1)
    await attendre()
    assert.equal(µ.t('bonjour'), 'Bonjour')
    µ._storeSet('__mjsLang', 'en')
    await attendre()
    assert.equal(µ._mjs_storeRaw.__mjsLang, 'fr', 'µlang reste la langue affichée')
    assert.equal(µ.t('bonjour'), 'Bonjour')
    assert.equal(erreurs.length, 1, 'l\'échec est signalé une fois')
  })

  it('réseau revenu : la demande suivante recharge la langue et la bascule aboutit', async function () {
    const { µ, charges } = monter(1)
    await attendre()
    µ._storeSet('__mjsLang', 'en')
    await attendre()
    µ._storeSet('__mjsLang', 'en')
    await attendre()
    assert.equal(charges.filter((c) => c === 'en').length, 2, 'le fichier anglais est redemandé')
    assert.equal(µ._mjs_storeRaw.__mjsLang, 'en')
    assert.equal(µ.t('bonjour'), 'Hello')
  })
})
