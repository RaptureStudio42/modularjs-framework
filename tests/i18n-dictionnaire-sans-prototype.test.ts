// µt ne descend que dans les clés du dictionnaire : `µt('constructor.name')`, `µt('toString.name')` ne donnent jamais
// de texte, seulement le repère de la clé absente — à la racine, dans un objet imbriqué, dans un fragment de section
// arrivé par le réseau, dans la graine du serveur. Les tables du dictionnaire sont sans prototype à tous les niveaux,
// copiées une fois à l'arrivée des données : aucun contrôle à chaque traduction. Avant, ces chemins rendaient
// « Object » et « toString » (le nom de la fonction héritée d'Object.prototype)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STORE_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_store_globals.ts'), 'utf-8')
const I18N_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_i18n.ts'), 'utf-8')

const FRAGMENT = { resume: 'Votre panier', ligne: { total: 'Total' } }

function monter(dev: boolean, graine?: any) {
  const µ: any = { log() {}, warn() {}, error() {}, state(o: any) { return o } }
  poserMessages(µ)
  new Function('µ', STORE_SRC)(µ)
  µ._i18nData = { prefix: '/i18n', langs: ['fr'], files: {}, dev, default: 'fr', placeholder: 'auto' }
  const faux = async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(FRAGMENT)) })
  const doc = graine ? { getElementById: (id: string) => id === '__mjs_i18n' ? { textContent: JSON.stringify(graine) } : null } : undefined
  new Function('µ', 'fetch', 'document', I18N_SRC)(µ, faux, doc)
  µ._i18nLang('fr', { root: { titre: 'Bonjour', menu: { ouvrir: 'Ouvrir' } }, sections: { panier: 'panier' } })
  return µ
}

const NOMS = ['constructor.name', 'toString.name', '__proto__.constructor.name', 'hasOwnProperty.name', 'menu.constructor.name', 'menu.toString.name']

describe('µt : le dictionnaire est sans prototype à tous les niveaux', function () {
  for (const dev of [true, false]) {
    const absente = (k: string) => dev ? '⟦' + k + '⟧' : ''
    describe(dev ? 'développement' : 'production', function () {
      it('racine et objet imbriqué : un nom du prototype ne donne que le repère de la clé absente', () => {
        const µ = monter(dev)
        assert.deepEqual(NOMS.map((k) => µ.t(k)), NOMS.map(absente))
        assert.deepEqual([µ.t('titre'), µ.t('menu.ouvrir')], ['Bonjour', 'Ouvrir'], 'témoins : les clés du dictionnaire se lisent')
      })

      it('fragment de section arrivé par le réseau : même lecture', async () => {
        const µ = monter(dev)
        await µ.i18n._ensure('fr', 'panier')
        const noms = ['panier.constructor.name', 'panier.toString.name', 'panier.ligne.constructor.name']
        assert.deepEqual(noms.map((k) => µ.t(k)), noms.map(absente))
        assert.deepEqual([µ.t('panier.resume'), µ.t('panier.ligne.total')], ['Votre panier', 'Total'], 'témoins')
      })

      it('graine du serveur (section et racine) : même lecture', () => {
        const µ = monter(dev, { lang: 'fr', sections: { fr: { aide: { titre: 'Aide', bloc: { a: 'A' } } } }, root: { fr: { pied: { droits: 'Droits' } } } })
        const noms = ['aide.constructor.name', 'aide.bloc.toString.name', 'pied.constructor.name']
        assert.deepEqual(noms.map((k) => µ.t(k)), noms.map(absente))
        assert.deepEqual([µ.t('aide.titre'), µ.t('aide.bloc.a'), µ.t('pied.droits')], ['Aide', 'A', 'Droits'], 'témoins')
      })
    })
  }
})
