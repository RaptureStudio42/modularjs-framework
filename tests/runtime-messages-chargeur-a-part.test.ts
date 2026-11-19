// Le chargeur des messages de la console (inscription des textes courts, téléchargement du fichier de la langue, rejeu des
// appels écrits avec le texte complet) quitte le cœur de production : un fichier à empreinte, `mjs_msg-<empreinte>.js`, que
// l'amorce du cœur importe quand le premier texte court en attente s'écrit dans la console, ou qu'une erreur non attrapée le
// porte — les deux cas où part le fichier de la langue. Chaque scénario se joue deux fois : chargeur au cœur (le texte du
// runtime tel quel, celui du développement) et chargeur à part (l'amorce du cœur de production, le fichier du chargeur
// importé pour de vrai) ; même console, mêmes fichiers de langue demandés, dans le même ordre. Puis les sorties du build.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Window } from 'happy-dom'
import * as B from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const __dirname   = dirname(fileURLToPath(import.meta.url))
const RUNTIME_DIR = join(__dirname, '../src/runtime')
const INIT        = readFileSync(join(RUNTIME_DIR, 'mjs_init.ts'), 'utf-8')
const FICHIERS: Record<string, any> = {
  '/fr.json': { monMsg: 'bonjour {nom}, ça va', autre: 'second', morceau: 'morceau {n}' },
  '/en.json': { monMsg: 'hello {nom}, fine', autre: 'other', morceau: 'piece {n}' },
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Options { absent?: string[], lookup?: (k: string) => any, chargeur?: string, sansReseau?: boolean }
interface Poste { µ: any, journal: string[], demandes: string[], levee: (m: string) => void }

describe('chargeur des messages à part : même console qu\'avec le chargeur au cœur', function () {
  this.timeout(60000)

  let urlChargeur = ''
  let numero = 0
  const globaux: Record<string, any> = {}

  before(() => {
    // le fichier du chargeur tel que le build le tire du runtime, non minifié ; chaque import le compte
    const dir = mjsTmp('chargeur-messages-a-part')
    const fichier = join(dir, 'mjs_msg.mjs')
    writeFileSync(fichier, 'globalThis.__mjsChargeurs = (globalThis.__mjsChargeurs || 0) + 1;\n' + B.msgLoaderSource(INIT))
    urlChargeur = pathToFileURL(fichier).href
    for (const k of ['window', 'document', 'fetch']) globaux[k] = (globalThis as any)[k]
  })

  after(() => {
    for (const k of Object.keys(globaux)) {
      if (globaux[k] === undefined) delete (globalThis as any)[k]
      else (globalThis as any)[k] = globaux[k]
    }
  })

  // chargeur au cœur (`aPart` faux) : mjs_init.ts tel quel ; à part : l'amorce du cœur de production (bloc `<msg-loader>` retiré),
  // qui importe le fichier du chargeur — module de Node, qui lit les globaux : la fenêtre de l'essai y est posée
  function poste(aPart: boolean, opts: Options = {}): Poste {
    const win: any = new Window({ url: 'http://localhost/' })
    const src = (aPart ? B.projectBlocks(INIT, { 'msg-loader': false }) : INIT).replace(/export\s*\{[^}]*\}/, '')
    const demandes: string[] = []
    const fetchSimule = (url: string) => {
      demandes.push(url)
      if (opts.absent?.includes(url)) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FICHIERS[url]) })
    }
    const journal: string[] = []
    const trace = (niveau: string) => (...a: any[]) => { journal.push(niveau + ' ' + a.map(String).join(' ')) }
    const consoleSimulee = { log: trace('log'), warn: trace('warn'), error: trace('error') }
    const recup = opts.sansReseau ? undefined : fetchSimule
    Object.assign(globalThis, { window: win, document: win.document, fetch: recup })
    const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'fetch', 'console', `${src}\nreturn µ;`)(
      win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, recup, consoleSimulee,
    )
    µ._runtimeLabels = { fr: { modal: { ok: 'OK' } }, en: { modal: { ok: 'OK' } } }
    µ._runtimeLabelsLang = 'fr'
    µ._msgUrls = { fr: '/fr.json', en: '/en.json' }
    if (aPart) µ._msgLoader = opts.chargeur ?? urlChargeur + '?n=' + ++numero
    if (opts.lookup) µ._mjs_i18nLookup = opts.lookup
    const levee = (message: string) => win.dispatchEvent(new win.ErrorEvent('error', { message }))
    return { µ, journal, demandes, levee }
  }

  async function jouer(aPart: boolean, scenario: (p: Poste) => Promise<void> | void, opts: Options = {}) {
    const p = poste(aPart, opts)
    const avant = (globalThis as any).__mjsChargeurs || 0
    await scenario(p)
    await pause(400)
    return { journal: p.journal, demandes: p.demandes, chargeurs: ((globalThis as any).__mjsChargeurs || 0) - avant }
  }

  // [nom, scénario, ligne attendue dans la console (preuve que la comparaison n'est pas vide), options]
  const SCENARIOS: Array<[string, (p: Poste) => Promise<void> | void, string | null, Options?]> = [
    ['un texte jamais écrit ne demande rien, ni le chargeur ni la langue', ({ µ }) => { µ._mjs_msg('monMsg', { nom: 'x' }); µ._mjs_txt('autre') }, null],
    ['premier message écrit en erreur : texte court tout de suite, complet ensuite', ({ µ }) => { µ.error(µ._mjs_msg('monMsg', { nom: 'x' })) }, 'error [ModularJS] bonjour x, ça va'],
    ['premier message écrit en avertissement, avec d\'autres arguments', ({ µ }) => { µ.warn('[µ.x]', µ._mjs_msg('monMsg', { nom: 'y' }), 42) }, 'warn [µ.x] [ModularJS] bonjour y, ça va 42'],
    ['premier message écrit au journal', ({ µ }) => { µ.log(µ._mjs_txt('autre')) }, 'log second'],
    ['plusieurs messages avant la fin du chargement : tous rendus', async ({ µ }) => {
      µ.error(µ._mjs_msg('monMsg', { nom: 'a' }))
      µ.warn(µ._mjs_msg('autre'))
      µ.log(µ._mjs_msg('monMsg', { nom: 'a' }))
      µ.error(µ._mjs_msg('monMsg', { nom: µ._mjs_txt('morceau', { n: 1 }) }))
      await Promise.resolve()
      µ.warn(µ._mjs_msg('monMsg', { nom: 'b' }))
    }, 'error [ModularJS] bonjour morceau 1, ça va'],
    ['une erreur levée non attrapée', ({ µ, levee }) => { levee(µ._mjs_msg('monMsg', { nom: 'z' })) }, 'error [ModularJS] bonjour z, ça va'],
    ['changement de langue : fr, puis en', async ({ µ }) => {
      µ.error(µ._mjs_msg('autre'))
      await pause(300)
      µ._mjs_storeRaw = { __mjsLang: 'en' }
      µ.error(µ._mjs_msg('monMsg', { nom: 'x' }))
    }, 'error [ModularJS] hello x, fine'],
    ['langue changée entre l\'inscription du texte et son écriture', ({ µ }) => {
      const m = µ._mjs_msg('monMsg', { nom: 'x' })
      µ._mjs_storeRaw = { __mjsLang: 'en' }
      µ.error(m)
    }, 'error [ModularJS] monMsg {"nom":"x"}'],
    ['fichier de la langue absent : le texte court reste, rien ne tombe', ({ µ }) => { µ.error(µ._mjs_msg('monMsg', { nom: 'x' })) }, 'error [ModularJS] monMsg {"nom":"x"}', { absent: ['/fr.json'] }],
    ['surcharge mjs.err.<clé> du site : texte complet tout de suite, rien de demandé', ({ µ }) => { µ.error(µ._mjs_msg('monMsg', { nom: 'x' })) }, 'error [ModularJS] surcharge x', { lookup: (k: string) => k === 'mjs.err.monMsg' ? 'surcharge {nom}' : undefined }],
    ['un texte déjà chargé ne redemande rien', async ({ µ }) => {
      µ.error(µ._mjs_msg('autre'))
      await pause(300)
      µ.warn(µ._mjs_msg('monMsg', { nom: 'q' }))
    }, 'warn [ModularJS] bonjour q, ça va'],
    ['sous silent : rien d\'écrit, rien de demandé', ({ µ }) => { µ._logLevel = 'silent'; µ.error(µ._mjs_msg('monMsg', { nom: 'x' })) }, null],
  ]

  for (const [nom, scenario, attendu, opts] of SCENARIOS) {
    it(nom, async () => {
      const coeur = await jouer(false, scenario, opts)
      const aPart = await jouer(true, scenario, opts)
      if (attendu !== null) assert.ok(coeur.journal.includes(attendu), `ligne absente : ${attendu}\n${coeur.journal.join('\n')}`)
      assert.deepEqual(aPart.journal, coeur.journal)
      assert.deepEqual(aPart.demandes, coeur.demandes)
      assert.equal(aPart.chargeurs, coeur.demandes.length > 0 ? 1 : 0, 'le chargeur est importé une fois, et seulement quand un fichier de langue part')
    })
  }

  it('chargeur introuvable (404, hors ligne) : le texte court reste, aucune exception, aucun fichier de langue', async () => {
    const r = await jouer(true, ({ µ, levee }) => {
      µ.error(µ._mjs_msg('monMsg', { nom: 'x' }))
      levee(µ._mjs_msg('autre'))
      µ.warn(µ._mjs_msg('monMsg', { nom: 'y' }))
    }, { chargeur: pathToFileURL(join(mjsTmp('chargeur-absent'), 'absent.mjs')).href })
    assert.deepEqual(r.journal, ['error [ModularJS] monMsg {"nom":"x"}', 'warn [ModularJS] monMsg {"nom":"y"}'])
    assert.deepEqual(r.demandes, [])
    assert.equal(r.chargeurs, 0)
  })

  it('sans fetch (prérendu, Node) : texte court, rien de noté, rien d\'importé', async () => {
    const r = await jouer(true, ({ µ }) => {
      assert.equal(µ._mjs_msg('monMsg', { nom: 'x' }), '[ModularJS] monMsg {"nom":"x"}')
      µ.error(µ._mjs_msg('monMsg', { nom: 'x' }))
    }, { sansReseau: true })
    assert.deepEqual(r.journal, ['error [ModularJS] monMsg {"nom":"x"}'])
    assert.equal(r.chargeurs, 0)
  })
})

describe('chargeur des messages à part : sorties du build', function () {
  this.timeout(180000)

  after(async () => { await B.terminateSharedWorkerPool() })

  async function construire(env: 'dev' | 'prod', js: 'split' | 'bundle', idle = false) {
    const root = mjsTmp('chargeur-messages-' + env + '-' + js)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), '<div>x</div>\n')
    const bundler = new B.Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/assets', env, js, runtime: 'core', ...(idle ? { messages: 'idle' } : {}) } as any)
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const fichiers = readdirSync(outDir)
    const lire = (f: string) => readFileSync(join(outDir, f), 'utf-8')
    const manifeste = lire('bundle.js')
    const noyau = js === 'bundle' ? manifeste : fichiers.filter((f) => /^mjs_core-.*\.js$/.test(f)).map(lire).join('\n')
    const chargeurs = fichiers.filter((f) => /^mjs_msg-[0-9a-z]{5}\.js$/.test(f))
    return { outDir, fichiers, manifeste, noyau, chargeurs, lire }
  }

  for (const js of ['split', 'bundle'] as const) {
    it(`production, js ${js} : un fichier mjs_msg-<empreinte>.js au registre des sorties, hors du précache, nommé par le manifeste ; le cœur ne garde que l'amorce`, async () => {
      const prod = await construire('prod', js)
      assert.equal(prod.chargeurs.length, 1, prod.fichiers.join(', '))
      const chargeur = prod.lire(prod.chargeurs[0])
      assert.match(chargeur, /export\s*(?:default\s*function|\{\s*[\w$]+\s+as\s+default\s*\})/)
      assert.doesNotMatch(chargeur, /^\s*import[\s{]/m, 'le chargeur reçoit µ de l\'amorce, il n\'importe rien')
      assert.match(chargeur, /Fatal Error: /)
      assert.doesNotMatch(prod.noyau, /Fatal Error: /, 'le rejeu des messages a quitté le cœur')
      assert.doesNotMatch(prod.noyau, /requestIdleCallback/, 'sans le réglage messages: idle, rien du chargement d\'avance')
      if (js === 'split') assert.match(prod.manifeste, new RegExp(`µ\\._msgLoader = "/assets/${prod.chargeurs[0].replace('.', '\\.')}";`))
      else assert.match(prod.manifeste, new RegExp(`\\._msgLoader\\s*=\\s*new URL\\("${prod.chargeurs[0].replace('.', '\\.')}",\\s*import\\.meta\\.url\\)\\.href`))
      const precache = JSON.parse(prod.lire('mjs-precache.json'))
      assert.equal(precache.assets.some((a: string) => a.includes('mjs_msg-')), false)
      assert.ok(prod.lire('.mjs-outputs.json').includes(prod.chargeurs[0]), 'le registre des sorties nomme le chargeur : la purge le retire quand son empreinte change')
    })
  }

  it('production, messages: idle : l\'amorce garde le chargement d\'avance, qui passe par le chargeur', async () => {
    const prod = await construire('prod', 'split', true)
    assert.equal(prod.chargeurs.length, 1)
    assert.match(prod.noyau, /requestIdleCallback/)
    assert.match(prod.manifeste, /µ\._msgIdle\(\);/)
  })

  it('développement : rien ne change — aucun fichier du chargeur, aucune adresse, le chargeur reste au cœur', async () => {
    const dev = await construire('dev', 'split')
    assert.deepEqual(dev.chargeurs, [])
    assert.doesNotMatch(dev.manifeste, /_msgLoader/)
    assert.match(dev.noyau, /Fatal Error: /)
  })
})
