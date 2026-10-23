// Messages de la console en production : un appel à µ.log/warn/error qui porte un texte court en attente est noté,
// puis rejoué avec le texte complet à l'arrivée du fichier de messages. Ses autres arguments sont rejoués tels quels,
// quelle que soit leur valeur : un Symbol (qu'aucune concaténation ne sait écrire) ou un objet sans prototype (ni
// toString ni valueOf) ne doit ni lever d'erreur pendant le rejeu, ni empêcher les autres appels notés de sortir.
// L'écouteur des erreurs non attrapées de la page lit leur texte de la même façon : un rejet par un Symbol ou par un
// objet sans prototype ne le fait pas lever.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')

function assistant() {
  const win: any = new Window({ url: 'http://localhost/' })
  const initSrc = readFileSync(join(RUNTIME_DIR, 'mjs_init.ts'), 'utf-8').replace(/export\s*\{[^}]*\}/, '')
  const fichiers: Record<string, any> = { '/fr.json': { monMsg: 'bonjour {nom}, ça va', autre: 'second' } }
  const fetchSimule = (url: string) => Promise.resolve({ ok: true, json: () => Promise.resolve(fichiers[url]) })
  // les arguments reçus par la console, tels quels (pas de conversion en texte ici)
  const appels: Array<[string, any[]]> = []
  const trace = (niveau: string) => (...a: any[]) => { appels.push([niveau, a]) }
  const consoleSimulee = { log: trace('log'), warn: trace('warn'), error: trace('error') }
  // écouteurs que le runtime pose sur window, gardés pour être appelés directement
  const ecouteurs: Record<string, any> = {}
  const poser = win.addEventListener.bind(win)
  win.addEventListener = (type: string, f: any, o?: any) => { ecouteurs[type] = f; return poser(type, f, o) }
  const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'fetch', 'console', `${initSrc}\nreturn µ;`)(
    win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, fetchSimule, consoleSimulee,
  )
  µ._runtimeLabels = { fr: {} }
  µ._runtimeLabelsLang = 'fr'
  µ._msgUrls = { fr: '/fr.json' }
  return { µ, appels, ecouteurs }
}

const attendre = () => new Promise((r) => setTimeout(r, 20))

describe('messages de la console — rejeu d\'un appel qui porte un Symbol ou un objet sans prototype', () => {
  it('µ.error(texte en attente, Symbol) : rejoué au texte complet, le Symbol passé tel quel', async () => {
    const { µ, appels } = assistant()
    const jeton = Symbol('jeton')
    µ.error(µ._mjs_msg('monMsg', { nom: 'x' }), jeton)
    await attendre()
    assert.equal(appels.length, 2, 'le texte court tout de suite, puis le rejeu : ' + appels.map(([n, a]) => n + ' ' + a.map(String).join(' ')).join(' | '))
    const [niveau, args] = appels[1]
    assert.equal(niveau, 'error')
    assert.equal(args[0], '[ModularJS] bonjour x, ça va')
    assert.equal(args[1], jeton, 'le Symbol est rejoué lui-même, pas son texte')
  })

  it('un Symbol dans un appel noté n\'empêche pas les autres appels notés de sortir', async () => {
    const { µ, appels } = assistant()
    µ.warn('a ' + µ._mjs_txt('autre'), Symbol('jeton'))
    µ.warn('b ' + µ._mjs_txt('autre'))
    await attendre()
    const rejoues = appels.slice(2).map(([n, a]) => n + ' ' + String(a[0]))
    assert.deepEqual(rejoues, ['warn a second', 'warn b second'])
  })

  it('un objet sans prototype dans un appel noté : rejoué tel quel, sans lever ni bloquer les autres appels notés', async () => {
    const { µ, appels } = assistant()
    const brut = Object.create(null)
    µ.warn('a ' + µ._mjs_txt('autre'), brut)
    µ.warn('b ' + µ._mjs_txt('autre'))
    await attendre()
    const rejoues = appels.slice(2)
    assert.deepEqual(rejoues.map(([n, a]) => n + ' ' + String(a[0])), ['warn a second', 'warn b second'])
    assert.equal(rejoues[0][1][1], brut, 'l\'objet est rejoué lui-même')
  })
})

describe('messages de la console — erreur non attrapée qui porte un Symbol ou un objet sans prototype', () => {
  it('l\'écouteur des rejets non attrapés ne lève pas sur eux, et sert encore le rejet suivant qui porte un texte court', async () => {
    const { µ, appels, ecouteurs } = assistant()
    µ._mjs_txt('monMsg', { nom: 'x' })
    const ecoute = ecouteurs.unhandledrejection
    assert.equal(typeof ecoute, 'function', 'écouteur posé à la première inscription')
    assert.doesNotThrow(() => ecoute({ reason: Symbol('jeton') }), 'rejet par un Symbol')
    assert.doesNotThrow(() => ecoute({ reason: Object.create(null) }), 'rejet par un objet sans prototype')
    ecoute({ reason: new Error('échec : monMsg {"nom":"x"}') })
    await attendre()
    assert.deepEqual(appels.map(([n, a]) => n + ' ' + String(a[0])), ['error bonjour x, ça va'])
  })
})
