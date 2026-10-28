// GARDE « BUNDLE PÉRIMÉ » — writeHashed() (bundler) supprime physiquement les anciens
// fichiers hachés à CHAQUE rebuild. Un onglet resté ouvert avant un rebuild/déploiement garde un
// µ.paths qui pointe un hash disparu : le prochain import() d'un composant à la demande prend un
// 404, le navigateur refuse de l'exécuter comme module, load() atterrit dans son catch — et sans
// garde, la page reste MUETTE pour toujours (le composant n'apparaîtra jamais). La garde ajoutée
// (`_mjs_reloadOnStale`, cf. src/runtime/mjs_autoloader.ts) recharge la page UNE SEULE fois par build
// — clé sessionStorage 'mjs-stale-reload' posée à µ.version (pas un simple booléen), pour qu'un NOUVEAU
// build reparte avec un drapeau neuf. Un import qui échoue n'en est pas la preuve (Safari refuse tout
// fichier demandé pendant que la page s'en va, une connexion qui tombe échoue de même, et le
// rechargement remplaçait la navigation du visiteur) : le fichier est redemandé, et seul un serveur qui
// RÉPOND sans module JavaScript (404, page HTML de repli) fait recharger ; jamais après un départ annoncé.

import { strict as assert } from 'node:assert'
import { writeFileSync, rmSync, readFileSync } from 'node:fs'
import { mjsTmp } from './helpers/tmp.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname       = dirname(fileURLToPath(import.meta.url))
const AUTOLOADER_SRC  = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_autoloader.ts'), 'utf-8')

describe('mjs_autoloader — garde bundle périmé (rechargement une fois par build)', function () {
  let dir: string
  let savedWindow: any
  let savedCustomElements: any
  let savedSessionStorage: any
  let savedFetch: any

  before(function () {
    dir = mjsTmp('autoloader-stale')
    // module valide : simule le code émis par le compilateur (customElements.define
    // au niveau racine, synchrone — cf. src/transpiler/template.ts:97). Appelle le VRAI
    // customElements (le stub posé en beforeEach), pas __mjsTestRegistry directement —
    // sinon .define() sur le Map brut jette (pas de méthode .define), l'import REJETTE
    // et ce cas retombe (par accident) dans le chemin échec au lieu du succès testé ici
    writeFileSync(join(dir, 'good.mjs'), `globalThis.customElements.define('mjs-good', class {});\n`)
  })

  after(function () {
    rmSync(dir, { recursive: true, force: true })
  })

  beforeEach(function () {
    savedWindow         = (globalThis as any).window
    savedCustomElements = (globalThis as any).customElements
    savedSessionStorage = (globalThis as any).sessionStorage
    savedFetch          = (globalThis as any).fetch
    ;(globalThis as any).__mjsTestRegistry = new Map<string, any>()
    ;(globalThis as any).customElements = {
      get: (t: string) => (globalThis as any).__mjsTestRegistry.get(t),
      define: (t: string, c: any) => (globalThis as any).__mjsTestRegistry.set(t, c),
    }
  })

  afterEach(function () {
    (globalThis as any).window          = savedWindow
    ;(globalThis as any).customElements = savedCustomElements
    ;(globalThis as any).sessionStorage = savedSessionStorage
    ;(globalThis as any).fetch          = savedFetch
    delete (globalThis as any).__mjsTestRegistry
  })

  // stub sessionStorage minimal (Map en mémoire), avec options pour jeter à la lecture/écriture
  function makeStorage(opts: { throwGet?: boolean, throwSet?: boolean, seed?: Record<string, string> } = {}) {
    const map = new Map<string, string>(Object.entries(opts.seed || {}))
    return {
      getCalls: 0,
      setCalls: 0,
      getItem(this: any, key: string) {
        this.getCalls++
        if (opts.throwGet) { throw new Error('sessionStorage indisponible (lecture)') }
        return map.has(key) ? map.get(key)! : null
      },
      setItem(this: any, key: string, val: string) {
        this.setCalls++
        if (opts.throwSet) { throw new Error('sessionStorage indisponible (écriture)') }
        map.set(key, val)
      },
      _map: map,
    }
  }

  // pose µ + globals (window/sessionStorage) et évalue la source de l'autoloader — même
  // technique que tests/autoloader-pending-components-leak.test.ts (new Function('µ', SRC))
  function setup(opts: {
    paths?: Record<string, string>,
    version?: string,
    staleReload?: boolean,
    storage?: any,
    noWindow?: boolean,
    // réponse du serveur au fichier redemandé : 404 en page HTML (défaut, fichier disparu), module JavaScript servi, pas de réponse
    answer?: '404' | 'js' | 'reseau',
    left?: boolean,
  } = {}) {
    const calls: string[]      = [] // journal partagé, ordre d'appel réel
    const reloadCalls: any[]   = []
    const errorCalls: any[]    = []
    const warnCalls: any[]     = []
    const fetchCalls: any[]    = []
    const µ: any = {
      log() {},
      warn:  (...a: any[]) => { warnCalls.push(a); calls.push('warn') },
      error: (...a: any[]) => { errorCalls.push(a); calls.push('error') },
      paths: opts.paths || {},
      version: opts.version,
      config: opts.staleReload === undefined ? undefined : { staleReload: opts.staleReload },
    }
    if (opts.left !== undefined) µ._mjs_left = () => opts.left
    ;(globalThis as any).fetch = async (url: string, init: any) => {
      fetchCalls.push([url, init])
      if (opts.answer === 'reseau') throw new TypeError('Failed to fetch')
      const js = opts.answer === 'js'
      return { ok: js, status: js ? 200 : 404, headers: { get: (h: string) => h.toLowerCase() === 'content-type' ? (js ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8') : null } }
    }
    ;(globalThis as any).sessionStorage = opts.storage || makeStorage()
    if (opts.noWindow) {
      delete (globalThis as any).window
    } else {
      (globalThis as any).window = { location: { reload: () => { reloadCalls.push(true); calls.push('reload') } } }
    }
    poserMessages(µ)
    new Function('µ', AUTOLOADER_SRC)(µ)
    return { Autoloader: µ.Autoloader, µ, calls, reloadCalls, errorCalls, warnCalls, fetchCalls }
  }

  // le verdict du serveur arrive après `load()` : la réponse au fichier redemandé est attendue avant de regarder
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('1. import qui échoue (fichier inexistant) + sessionStorage vierge → reload() une fois, drapeau posé à µ.version', async function () {
    const { Autoloader, reloadCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'abc12345' })
    await Autoloader.load('mjs-missing')
    await settle()
    assert.equal(reloadCalls.length, 1)
    assert.equal((globalThis as any).sessionStorage._map.get('mjs-stale-reload'), 'abc12345')
  })

  it('2. deuxième import qui échoue dans le MÊME build (drapeau déjà à µ.version) → reload() pas rappelé', async function () {
    const { Autoloader, reloadCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'abc12345' })
    await Autoloader.load('mjs-missing')
    await settle()
    await Autoloader.load('mjs-missing')
    await settle()
    assert.equal(reloadCalls.length, 1, 'le 2e échec du même build ne doit pas redéclencher un reload')
  })

  it('3. drapeau posé avec une ANCIENNE version, µ.version différent → reload() appelé et drapeau réécrit', async function () {
    const storage = makeStorage({ seed: { 'mjs-stale-reload': 'old00000' } })
    const { Autoloader, reloadCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'new11111', storage })
    await Autoloader.load('mjs-missing')
    await settle()
    assert.equal(reloadCalls.length, 1)
    assert.equal(storage._map.get('mjs-stale-reload'), 'new11111')
  })

  it("4. µ.version undefined des deux côtés → repli '1', même logique une-fois-par-build", async function () {
    const { Autoloader, reloadCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: undefined })
    await Autoloader.load('mjs-missing')
    await settle()
    assert.equal(reloadCalls.length, 1)
    assert.equal((globalThis as any).sessionStorage._map.get('mjs-stale-reload'), '1')
    await Autoloader.load('mjs-missing')
    await settle()
    assert.equal(reloadCalls.length, 1, 'toujours undefined ⇒ même drapeau replié, pas de 2e reload')
  })

  it('5. µ.config.staleReload === false → jamais de reload(), message d\'erreur toujours écrit', async function () {
    const { Autoloader, reloadCalls, errorCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'abc12345', staleReload: false })
    await Autoloader.load('mjs-missing')
    await settle()
    assert.equal(reloadCalls.length, 0)
    assert.equal(errorCalls.length, 1)
    assert.match(errorCalls[0][0], /Failed to import/)
  })

  it('6. sessionStorage qui jette à la lecture ET à l\'écriture → pas de reload(), aucune exception, pendingComponents purgé', async function () {
    const storage = makeStorage({ throwGet: true, throwSet: true })
    const { Autoloader, reloadCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'abc12345', storage })
    await assert.doesNotReject(Autoloader.load('mjs-missing'))
    await settle()
    assert.equal(reloadCalls.length, 0)
    assert.equal(Autoloader.pendingComponents.has('mjs-missing'), false)
  })

  it('6bis. sessionStorage qui jette SEULEMENT à l\'écriture (lecture OK) → même filet, pas de reload()', async function () {
    const storage = makeStorage({ throwSet: true })
    const { Autoloader, reloadCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'abc12345', storage })
    await assert.doesNotReject(Autoloader.load('mjs-missing'))
    await settle()
    assert.equal(reloadCalls.length, 0)
    assert.equal(Autoloader.pendingComponents.has('mjs-missing'), false)
  })

  it("7. µ.error existant part TOUJOURS avant le rechargement (ordre vérifié via journal partagé)", async function () {
    const { Autoloader, calls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'abc12345' })
    await Autoloader.load('mjs-missing')
    await settle()
    const errIdx    = calls.indexOf('error')
    const reloadIdx = calls.indexOf('reload')
    assert.notEqual(errIdx, -1, 'µ.error doit avoir été appelé')
    assert.notEqual(reloadIdx, -1, 'reload() doit avoir été appelé')
    assert.ok(errIdx < reloadIdx, `l'erreur (index ${errIdx}) doit précéder le reload (index ${reloadIdx})`)
  })

  it('8. un import qui RÉUSSIT ne touche jamais sessionStorage ni reload(), et ne redemande rien', async function () {
    const { Autoloader, reloadCalls, fetchCalls } = setup({ paths: { good: join(dir, 'good.mjs') }, version: 'abc12345' })
    await Autoloader.load('mjs-good')
    await settle()
    const storage = (globalThis as any).sessionStorage
    assert.equal(fetchCalls.length, 0)
    assert.equal(reloadCalls.length, 0)
    assert.equal(storage.getCalls, 0)
    assert.equal(storage.setCalls, 0)
  })

  it('9. window absent (harnais Node) → pas de throw, pas de reload(), sessionStorage jamais consulté', async function () {
    const { Autoloader, reloadCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'abc12345', noWindow: true })
    await assert.doesNotReject(Autoloader.load('mjs-missing'))
    await settle()
    assert.equal(reloadCalls.length, 0)
    const storage = (globalThis as any).sessionStorage
    assert.equal(storage.getCalls, 0, 'la garde window doit court-circuiter AVANT tout accès à sessionStorage')
  })

  it('10. le fichier est redemandé sans cache, à son chemin entier, avant tout rechargement', async function () {
    const { Autoloader, fetchCalls, reloadCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'abc12345' })
    await Autoloader.load('mjs-missing')
    await settle()
    assert.equal(fetchCalls.length, 1)
    assert.equal(fetchCalls[0][0], join(dir, 'nope.mjs'))
    assert.equal(fetchCalls[0][1] && fetchCalls[0][1].cache, 'no-store')
    assert.equal(reloadCalls.length, 1)
  })

  it('11. pas de réponse du serveur (réseau coupé, page qui s\'en va) → jamais de reload(), l\'erreur est écrite, sessionStorage intact', async function () {
    const { Autoloader, reloadCalls, errorCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'abc12345', answer: 'reseau' })
    await Autoloader.load('mjs-missing')
    await settle()
    assert.equal(reloadCalls.length, 0)
    assert.equal(errorCalls.length, 1)
    assert.match(errorCalls[0][0], /Failed to import/)
    assert.equal((globalThis as any).sessionStorage.setCalls, 0)
  })

  it('12. le serveur sert bien le module (échec ailleurs : évaluation, coupure passagère) → pas de reload()', async function () {
    const { Autoloader, reloadCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'abc12345', answer: 'js' })
    await Autoloader.load('mjs-missing')
    await settle()
    assert.equal(reloadCalls.length, 0)
    assert.equal((globalThis as any).sessionStorage.setCalls, 0)
  })

  it('13. départ de la page annoncé (µ._mjs_left) → jamais de reload(), même sur un 404', async function () {
    const { Autoloader, reloadCalls, errorCalls } = setup({ paths: { missing: join(dir, 'nope.mjs') }, version: 'abc12345', left: true })
    await Autoloader.load('mjs-missing')
    await settle()
    assert.equal(reloadCalls.length, 0)
    assert.equal(errorCalls.length, 1)
    assert.equal((globalThis as any).sessionStorage.setCalls, 0)
  })
})
