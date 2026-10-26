// Messages de la console en production : le fichier de messages ne se télécharge que lorsqu'un
// message est réellement écrit (µ.log/warn/error au niveau courant) ou qu'une erreur du framework
// atteint la page sans être attrapée. Le build retire les appels µ.log éteints mais garde leur
// argument µ._mjs_msg(…) : évalué seul, il ne doit ni télécharger ni écrire. La table d'attente est
// bornée (50 entrées, 10 appels notés par entrée) et se vide à l'arrivée du fichier comme à son échec.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')

function assistant(opts: { fetch?: any, fichiers?: Record<string, any> } = {}) {
  const win: any = new Window({ url: 'http://localhost/' })
  const initSrc = readFileSync(join(RUNTIME_DIR, 'mjs_init.ts'), 'utf-8').replace(/export\s*\{[^}]*\}/, '')
  const demandes: string[] = []
  const fichiers: Record<string, any> = opts.fichiers ?? {
    '/fr.json': {
      monMsg: 'bonjour {nom}, ça va',
      autre: 'second',
      routerNoRoute: 'aucune route ne correspond',
      routerNoRouteLog: 'aucune route',
    },
  }
  const fetchSimule = opts.fetch ?? ((url: string) => {
    demandes.push(url)
    return Promise.resolve({ ok: true, json: () => Promise.resolve(fichiers[url]) })
  })
  const journal: string[] = []
  const trace = (niveau: string) => (...a: any[]) => { journal.push(niveau + ' ' + a.map(String).join(' ')) }
  const consoleSimulee = { log: trace('log'), warn: trace('warn'), error: trace('error') }
  const [µ, table]: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'fetch', 'console', `${initSrc}\nreturn [µ, _mjsMsgWait];`)(
    win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, fetchSimule, consoleSimulee,
  )
  µ._runtimeLabels = { fr: { modal: { ok: 'OK' } } }
  µ._runtimeLabelsLang = 'fr'
  µ._msgUrls = { fr: '/fr.json' }
  const taille = () => table instanceof Map ? table.size : Object.keys(table).length
  const levee = (message: string) => win.dispatchEvent(new win.ErrorEvent('error', { message }))
  const rejetee = (message: string, chaine = false) => {
    const e = new win.Event('unhandledrejection')
    e.reason = chaine ? message : new Error(message)
    win.dispatchEvent(e)
  }
  return { µ, demandes, journal, taille, levee, rejetee }
}

const attendre = () => new Promise((r) => setTimeout(r, 20))

describe('messages chargés à bon escient — rien d\'écrit, rien de téléchargé', () => {
  it('un µ._mjs_msg / µ._mjs_txt évalué seul (appel µ.log retiré par le build) : aucune requête, aucune erreur', async () => {
    const { µ, demandes, journal, taille } = assistant()
    µ._mjs_msg('monMsg', { nom: 'x' })
    µ._mjs_txt('autre')
    await attendre()
    assert.equal(demandes.length, 0)
    assert.deepEqual(journal, [])
    assert.equal(taille(), 2, 'les deux entrées attendent seulement, sans rien demander')
  })

  it('un message que le niveau courant n\'écrit pas ne télécharge rien', async () => {
    const a = assistant()
    a.µ._logLevel = 'error'
    a.µ.warn('a ' + a.µ._mjs_txt('autre'))
    a.µ.log('b ' + a.µ._mjs_txt('autre'))
    await attendre()
    assert.equal(a.demandes.length, 0)
    assert.deepEqual(a.journal, [])
    const b = assistant()
    b.µ._logLevel = 'silent'
    b.µ.error('c ' + b.µ._mjs_txt('autre'))
    await attendre()
    assert.equal(b.demandes.length, 0)
  })

  it('un message écrit demande le fichier, une seule fois, puis sort en texte complet', async () => {
    const { µ, demandes, journal } = assistant()
    µ.warn('a ' + µ._mjs_txt('autre'))
    await attendre()
    assert.equal(demandes.length, 1)
    assert.deepEqual(journal, ['warn a autre {}', 'warn a second'])
  })
})

describe('messages chargés à bon escient — erreur levée', () => {
  it('erreur non attrapée (événement error) : une requête, puis le texte complet par console.error, une seule fois', async () => {
    const { µ, demandes, journal, levee } = assistant()
    const msg = µ._mjs_msg('monMsg', { nom: 'x' })
    levee('Uncaught Error: ' + msg)
    levee('Uncaught Error: ' + msg)
    await attendre()
    assert.equal(demandes.length, 1)
    assert.deepEqual(journal, ['error [ModularJS] bonjour x, ça va'])
  })

  it('erreur non attrapée (promesse rejetée, unhandledrejection) : texte complet par console.error', async () => {
    const { µ, demandes, journal, rejetee } = assistant()
    rejetee(µ._mjs_msg('monMsg', { nom: 'y' }))
    await attendre()
    assert.equal(demandes.length, 1)
    assert.deepEqual(journal, ['error [ModularJS] bonjour y, ça va'])
  })

  it('erreur du framework attrapée par le code du site (aucun événement) : rien', async () => {
    const { µ, demandes, journal } = assistant()
    try { throw new Error(µ._mjs_msg('monMsg', { nom: 'z' })) } catch { /* attrapée */ }
    await attendre()
    assert.equal(demandes.length, 0)
    assert.deepEqual(journal, [])
  })

  it('un événement sans rapport avec une entrée en attente ne demande rien', async () => {
    const { µ, demandes, levee } = assistant()
    µ._mjs_msg('monMsg', { nom: 'z' })
    levee('Uncaught TypeError: x is undefined')
    await attendre()
    assert.equal(demandes.length, 0)
  })

  it('sans entrée en attente, aucun écouteur n\'est posé (page sans message)', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const posés: string[] = []
    const ajout = win.addEventListener.bind(win)
    win.addEventListener = (n: string, ...r: any[]) => { posés.push(n); return ajout(n, ...r) }
    const initSrc = readFileSync(join(RUNTIME_DIR, 'mjs_init.ts'), 'utf-8').replace(/export\s*\{[^}]*\}/, '')
    const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'fetch', `${initSrc}\nreturn µ;`)(
      win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, () => Promise.reject(new Error('x')),
    )
    µ._runtimeLabels = { fr: {} }
    µ._runtimeLabelsLang = 'fr'
    µ._msgUrls = { fr: '/fr.json' }
    const ecoutes = () => posés.filter((n) => n === 'error' || n === 'unhandledrejection')
    assert.equal(ecoutes().length, 0, 'aucun écouteur avant la première inscription')
    µ._mjs_txt('autre')
    µ._mjs_txt('monMsg')
    assert.equal(ecoutes().length, 2, 'deux écouteurs, posés une seule fois')
  })
})

describe('messages chargés à bon escient — table bornée', () => {
  it('échec du chargement : au plus 50 entrées pendant l\'attente, 0 après le rejet, µ.log banal sans coût', async () => {
    const { µ, taille } = assistant({ fetch: () => Promise.reject(new Error('hors ligne')) })
    for (let i = 0; i < 2000; i++) µ.warn(µ._mjs_txt('monMsg', { nom: 'v' + i }))
    assert.ok(taille() <= 50, `table : ${taille()} entrées`)
    await attendre()
    assert.equal(taille(), 0)
    const t0 = performance.now()
    for (let i = 0; i < 200; i++) µ.log('banal ' + i)
    const ms = performance.now() - t0
    assert.ok(ms < 20, `200 µ.log : ${ms} ms`)
  })

  it('échec : rien n\'est retenu pendant les 30 s qui suivent, nouvel essai ensuite', async () => {
    let appels = 0
    const { µ, taille } = assistant({ fetch: () => { appels++; return Promise.reject(new Error('hors ligne')) } })
    µ.warn(µ._mjs_txt('autre'))
    await attendre()
    µ.warn(µ._mjs_txt('monMsg', { nom: 'a' }))
    assert.equal(taille(), 0)
    assert.equal(appels, 1)
    const reel = Date.now
    try {
      Date.now = () => reel() + 31000
      µ.warn(µ._mjs_txt('monMsg', { nom: 'b' }))
    } finally { Date.now = reel }
    assert.equal(appels, 2)
    await attendre()
  })

  it('au plus 10 appels notés par entrée', async () => {
    const { µ, journal } = assistant()
    for (let i = 0; i < 15; i++) µ.warn('n' + i + ' ' + µ._mjs_txt('autre'))
    await attendre()
    assert.equal(journal.filter((l) => l.endsWith(' autre {}')).length, 15)
    assert.equal(journal.filter((l) => l.endsWith(' second')).length, 10)
  })

  it('fichier arrivé sans la clé, ou JSON null : la table est vide ensuite, µ.log ne retient plus rien', async () => {
    for (const contenu of [{ autre: 'second' }, null]) {
      const { µ, demandes, taille } = assistant({ fichiers: { '/fr.json': contenu } })
      µ.warn(µ._mjs_txt('monMsg', { nom: 'x' }))
      µ.warn(µ._mjs_txt('absente'))
      await attendre()
      assert.equal(taille(), 0)
      µ.warn(µ._mjs_txt('monMsg', { nom: 'y' }))
      µ.log('banal')
      await attendre()
      assert.equal(taille(), 0)
      assert.equal(demandes.length, 1)
    }
  })

  it('la plus ancienne entrée sort quand une 51e arrive', () => {
    const { µ, taille } = assistant()
    for (let i = 0; i < 80; i++) µ._mjs_txt('monMsg', { nom: 'v' + i })
    assert.equal(taille(), 50)
  })
})

describe('messages chargés à bon escient — clé préfixe d\'une autre', () => {
  it('routerNoRoute levée et routerNoRouteLog écrite, sans variables : chacun une fois, au bon niveau', async () => {
    const { µ, journal, levee } = assistant()
    const leve = µ._mjs_msg('routerNoRoute')
    µ.warn('[Router] ' + µ._mjs_txt('routerNoRouteLog'))
    levee('Uncaught Error: ' + leve)
    await attendre()
    assert.deepEqual(journal.slice(1).sort(), ['error [ModularJS] aucune route ne correspond', 'warn [Router] aucune route'])
  })

  it('le texte court est toujours la clé suivie de ses valeurs, {} sans valeurs', () => {
    const { µ } = assistant()
    assert.equal(µ._mjs_txt('routerNoRoute'), 'routerNoRoute {}')
    assert.equal(µ._mjs_txt('routerNoRoute', null), 'routerNoRoute {}')
    assert.equal(µ._mjs_txt('routerNoRoute', { a: 1 }), 'routerNoRoute {"a":1}')
  })

  it('aucune clé du groupe err n\'est le suffixe d\'une autre (seule sous-chaîne encore possible entre textes courts)', () => {
    for (const lang of ['fr', 'en'] as const) {
      const cles = Object.keys((RUNTIME_LABELS as any)[lang].err)
      const trouves: string[] = []
      for (const a of cles) for (const b of cles) if (a !== b && b.endsWith(a)) trouves.push(`${a} / ${b}`)
      assert.deepEqual(trouves, [], `clés suffixes d'une autre (${lang}) : ${trouves.join(', ')}`)
    }
  })
})

describe('messages chargés à bon escient — erreur attrapée par le framework, variables de l\'appelant', () => {
  it('erreur écrite en objet par µ.error (crash d\'un composant intercepté) : une requête, puis la ligne rejouée avec le texte complet', async () => {
    const { µ, demandes, journal } = assistant()
    const err: any = new Error(µ._mjs_msg('monMsg', { nom: 'x' }))
    err._mjs_fatal = { textContent: 'Fatal Error: ' + err.message }
    µ.error('Crash intercepted in x-y:', err)
    await attendre()
    assert.equal(demandes.length, 1)
    assert.deepEqual(journal, [
      'error Crash intercepted in x-y: Error: [ModularJS] monMsg {"nom":"x"}',
      'error Crash intercepted in x-y: Error: [ModularJS] bonjour x, ça va',
    ])
    assert.equal(err._mjs_fatal.textContent, 'Fatal Error: [ModularJS] bonjour x, ça va')
  })

  it('promesse rejetée avec une chaîne pour raison : texte complet par console.error', async () => {
    const { µ, demandes, journal, rejetee } = assistant()
    rejetee(µ._mjs_msg('monMsg', { nom: 'y' }), true)
    await attendre()
    assert.equal(demandes.length, 1)
    assert.deepEqual(journal, ['error [ModularJS] bonjour y, ça va'])
  })

  it('morceau imbriqué : les variables de l\'appelant ne sont pas réécrites, même gelées, et la table se vide', async () => {
    const { µ, journal, taille } = assistant()
    const libres = { nom: µ._mjs_txt('autre') }
    const gelees = Object.freeze({ nom: µ._mjs_txt('autre') })
    µ.warn(µ._mjs_msg('monMsg', libres))
    µ.log(µ._mjs_msg('monMsg', gelees))
    await attendre()
    assert.equal(libres.nom, 'autre {}')
    assert.equal(gelees.nom, 'autre {}')
    assert.equal(journal[journal.length - 1].replace(/^\w+ /, ''), '[ModularJS] bonjour second, ça va')
    assert.equal(taille(), 0)
  })
})
