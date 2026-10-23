// Réglage `messages` de mjs.config.json : `demand` (défaut) ne télécharge le fichier de messages
// qu'au premier message écrit ; `idle` le télécharge d'avance, une fois la page au repos, dans la
// langue courante, une seule fois. Un échec de ce téléchargement reste silencieux.

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig } from '../src/bundler/config.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

after(async () => { await terminateSharedWorkerPool(); sweepRegistered() })

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')

function assistant(opts: { echec?: boolean, sansIdle?: boolean } = {}) {
  const win: any = new Window({ url: 'http://localhost/' })
  const initSrc = readFileSync(join(RUNTIME_DIR, 'mjs_init.ts'), 'utf-8').replace(/export\s*\{[^}]*\}/, '')
  const demandes: string[] = []
  const repos: Array<() => void> = []
  win.requestIdleCallback = opts.sansIdle ? undefined : (f: () => void) => { repos.push(f) }
  const fetchSimule = (url: string) => {
    demandes.push(url)
    if (opts.echec) return Promise.reject(new Error('réseau'))
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ monMsg: 'bonjour {nom}, ça va' }) })
  }
  const journal: string[] = []
  const trace = (niveau: string) => (...a: any[]) => { journal.push(niveau + ' ' + a.map(String).join(' ')) }
  const consoleSimulee = { log: trace('log'), warn: trace('warn'), error: trace('error') }
  const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'fetch', 'console', 'setTimeout', `${initSrc}\nreturn µ;`)(
    win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, fetchSimule, consoleSimulee, (f: () => void) => { repos.push(f) },
  )
  µ._runtimeLabels = { fr: { modal: { ok: 'OK' } }, en: { modal: { ok: 'OK' } } }
  µ._runtimeLabelsLang = 'fr'
  µ._msgUrls = { fr: '/fr.json', en: '/en.json' }
  return { µ, win, demandes, repos, journal }
}

const attendre = () => new Promise((r) => setTimeout(r, 30))
// la page finit de se charger (événement load) avant que le repos soit demandé
const auRepos = async (repos: Array<() => void>) => { await attendre(); repos.splice(0).forEach((f) => f()); await attendre() }

describe('messages chargés d\'avance — réglage `messages`', () => {
  it('sans le déclencheur : aucun téléchargement tant qu\'aucun message ne s\'écrit', async () => {
    const { demandes, repos } = assistant()
    await attendre()
    assert.equal(demandes.length, 0)
    assert.equal(repos.length, 0)
  })

  it('avec le déclencheur : rien avant le repos, puis un téléchargement et un seul, dans la langue courante', async () => {
    const { µ, win, demandes, repos } = assistant()
    win.document.documentElement.lang = 'en'
    µ._runtimeLabelsLang = 'en'
    µ._msgIdle()
    µ._msgIdle()
    await attendre()
    assert.equal(demandes.length, 0, 'rien tant que la page n\'est pas au repos')
    await auRepos(repos)
    assert.deepEqual(demandes, ['/en.json'])
    µ._msgIdle()
    await auRepos(repos)
    assert.equal(demandes.length, 1)
  })

  it('repli sans requestIdleCallback : le délai de repli déclenche le téléchargement', async () => {
    const { µ, demandes, repos } = assistant({ sansIdle: true })
    µ._msgIdle()
    await auRepos(repos)
    assert.deepEqual(demandes, ['/fr.json'])
  })

  it('un message émis après le chargement d\'avance s\'écrit directement en entier', async () => {
    const { µ, demandes, repos, journal } = assistant()
    µ._msgIdle()
    await auRepos(repos)
    µ.warn(µ._mjs_msg('monMsg', { nom: 'x' }))
    assert.deepEqual(journal, ['warn [ModularJS] bonjour x, ça va'])
    assert.equal(demandes.length, 1)
  })

  it('un échec du téléchargement d\'avance reste silencieux et ne se relance pas avant 30 s', async () => {
    const { µ, demandes, repos, journal } = assistant({ echec: true })
    µ._msgIdle()
    await auRepos(repos)
    assert.equal(demandes.length, 1)
    assert.deepEqual(journal, [])
    µ._mjs_txt('monMsg', { nom: 'x' })
    await attendre()
    assert.equal(demandes.length, 1)
  })
})

describe('messages chargés d\'avance — validation du réglage', () => {
  const ecrire = (messages: unknown) => {
    const root = mjsTmp('messages-avance')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ messages }))
    return root
  }

  it('"demand" et "idle" passent', () => {
    assert.doesNotThrow(() => findConfig(ecrire('demand')))
    assert.doesNotThrow(() => findConfig(ecrire('idle')))
  })

  it('une autre valeur est refusée, au vouvoiement, en français', () => {
    const root = ecrire('toujours')
    assert.throws(() => findConfig(root), /messages invalide : 'toujours'/)
    assert.throws(() => findConfig(root), /Valeurs valides : demand, idle/)
  })

  it('un booléen est refusé', () => {
    assert.throws(() => findConfig(ecrire(true)), /messages invalide/)
  })
})

describe('messages chargés d\'avance — le build n\'embarque le déclencheur que si le réglage le demande', function () {
  this.timeout(60000)

  async function construire(messages?: string): Promise<string> {
    const root   = mjsTmp('messages-avance-build')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'app-demo.mjs'), '<p>bonjour</p>\n')
    const manifeste = join(root, 'dist', 'assets', 'bundle.js')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'dist', 'assets'), manifestPath: manifeste, runtime: 'core', js: 'bundle', env: 'prod', messages } as any)
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    assert.ok(readdirSync(join(root, 'dist', 'assets')).some((f) => /^mjs_err-fr-.*\.json$/.test(f)))
    return readFileSync(manifeste, 'utf-8')
  }

  it('sans réglage ou en "demand" : ni appel ni code d\'avance dans le fichier de départ', async () => {
    for (const mode of [undefined, 'demand']) {
      const code = await construire(mode)
      assert.ok(code.includes('requestIdleCallback') === false)
      assert.ok(/_msgUrls/.test(code))
    }
  })

  it('en "idle" : le fichier de départ attend le repos de la page', async () => {
    const code = await construire('idle')
    assert.ok(code.includes('requestIdleCallback'))
  })
})
