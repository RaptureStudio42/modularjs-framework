// Tests de la commande `mjs server` — CLI déclarative MJS-Server (cf. src/cli/server.ts,
// docs/24-mjs-server.md §2). MÊME patron à trois niveaux que tests/mjs-ws-cli.test.ts : (a)
// validation de la section `server` de mjs.config.json (bundler/config.ts, MÊME patron strict que
// `ws`) ; (b) fonctions pures de cli/server.ts (résolution d'entry — dont la NON-collision avec
// `mjs ws` —, contrat, priorités port/host/heartbeat/limits/antiTriche) ; (c) boucle complète via
// runServerCommand() contre un VRAI client µ.socket sur MemoryTransport, fixtures dans un dossier
// TEMPORAIRE (fs.mkdtemp — jamais dans le dépôt).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findConfig } from '../src/bundler/config.js'
import { resolveServerEntryPath, readServerEntryContract, buildServerRunPlan, runServerCommand } from '../src/cli/server.js'
import { resolveEntryPath } from '../src/cli/ws.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { mjsTmp } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// dossiers temporaires créés par ce fichier — nettoyés une seule fois à la fin (jamais de fixture
// dans le dépôt, cf. feedback_scratch_cleanup_glob_precision)
const tmpDirs: string[] = []
function freshDir(prefix: string): string {
  const d = mjsTmp(prefix)
  tmpDirs.push(d)
  return d
}
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

// --- même technique que tests/mjs-ws-cli.test.ts : VRAI client µ.socket sur MemoryTransport ---
function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}
function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  return makeMu()
}

// une console capturée revient toujours, même quand l'essai échoue avant son `restore()` (un lancement qui lève, une assertion) :
// sinon elle reste muette pour tous les essais suivants du process, ceux des autres fichiers compris
const capturesEnCours: Array<() => void> = []
function restoreCaptures(): void { while (capturesEnCours.length) (capturesEnCours.pop() as () => void)() }

function patchConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const orig = { log: console.log, warn: console.warn, error: console.error }
  console.log   = (...a: any[]) => { lines.push(a.join(' ')) }
  console.warn  = (...a: any[]) => { lines.push(a.join(' ')) }
  console.error = (...a: any[]) => { lines.push(a.join(' ')) }
  const restore = (): void => {
    console.log = orig.log; console.warn = orig.warn; console.error = orig.error
    const i = capturesEnCours.indexOf(restore)
    if (i >= 0) capturesEnCours.splice(i, 1)
  }
  capturesEnCours.push(restore)
  return { lines, restore }
}

// ============================================================================
// (a) mjs.config.json — section `server`
// ============================================================================

describe('mjs.config.json — section `server` (validation stricte, patron `ws`)', () => {
  function writeConfig(config: Record<string, unknown>): string {
    const root = freshDir('cfg-serveur')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config))
    return root
  }

  it('accepte une section server complète valide', () => {
    const root = writeConfig({ server: { entry: 'server/game.js', port: 4101, host: '0.0.0.0', heartbeat: 20000, limits: { rate: 10, burst: 20 }, antiCheat: { movesPerIdentity: [40, 1000] } } })
    const found = findConfig(root)
    assert.ok(found)
    assert.equal(found!.config.server?.entry, 'server/game.js')
    assert.equal(found!.config.server?.port, 4101)
    assert.deepEqual(found!.config.server?.antiCheat?.movesPerIdentity, [40, 1000])
  })

  it('server.ban et server.limits.rateBy : mêmes formes que ws.*, valeurs fausses refusées', () => {
    const cfg = findConfig(writeConfig({ server: { ban: { by: 'account', duration: 60000 }, limits: { rateBy: 'account' } } }))!.config
    assert.deepEqual(cfg.server?.ban, { by: 'account', duration: 60000 })
    assert.equal((cfg.server?.limits as any)?.rateBy, 'account')
    assert.throws(() => findConfig(writeConfig({ server: { ban: { within: -1 } } })), /server\.ban\.within doit être un entier > 0/)
    assert.throws(() => findConfig(writeConfig({ server: { limits: { rateBy: 'tout' } } })), /server\.limits\.rateBy invalide/)
  })

  it("throw sur server.X inconnu, avec suggestion orthographique ('entrry' → 'entry')", () => {
    const root = writeConfig({ server: { entrry: 'game.js' } })
    assert.throws(() => findConfig(root), /server\.entrry : clé inconnue.*vouliez-vous dire 'entry'/)
  })

  it('throw sur server non-objet', () => {
    const root = writeConfig({ server: 'game.js' })
    assert.throws(() => findConfig(root), /'server' doit être un objet/)
  })

  it('throw sur server.port hors bornes TCP', () => {
    const root = writeConfig({ server: { port: 99999 } })
    assert.throws(() => findConfig(root), /server\.port doit être un entier entre 1 et 65535/)
  })

  it("le top-level accepte 'server' ET 'ws' EN MÊME TEMPS (les deux commandes coexistent)", () => {
    const root = writeConfig({ ws: { port: 4000 }, server: { port: 4001 } })
    assert.doesNotThrow(() => findConfig(root))
    const found = findConfig(root)!
    assert.equal(found.config.ws?.port, 4000)
    assert.equal(found.config.server?.port, 4001)
  })

  it('throw sur server.limits.X inconnu, avec suggestion orthographique', () => {
    const root = writeConfig({ server: { limits: { ratee: 5 } } })
    assert.throws(() => findConfig(root), /server\.limits\.ratee : clé inconnue.*vouliez-vous dire 'rate'/)
  })

  it("server.verifyOrigin : accepte un tableau non vide de chaînes non vides, throw sinon (allowlist, refus 1008)", () => {
    const root = writeConfig({ server: { verifyOrigin: ['https://exemple.com'] } })
    assert.equal(findConfig(root)!.config.server?.verifyOrigin?.[0], 'https://exemple.com')

    assert.throws(() => findConfig(writeConfig({ server: { verifyOrigin: [] } })), /server\.verifyOrigin doit être un tableau non vide/)
    assert.throws(() => findConfig(writeConfig({ server: { verifyOrigin: ['', 'https://ok.com'] } })), /server\.verifyOrigin doit être un tableau non vide/)
    assert.throws(() => findConfig(writeConfig({ server: { verifyOrigin: 'https://exemple.com' } })), /server\.verifyOrigin doit être un tableau non vide/)
  })

  it("server.antiCheat : movesPerIdentity accepte [n≥1, fenêtreMs>0] ou null, throw sur forme invalide", () => {
    assert.deepEqual(findConfig(writeConfig({ server: { antiCheat: { movesPerIdentity: [10, 500] } } }))!.config.server?.antiCheat?.movesPerIdentity, [10, 500])
    assert.equal(findConfig(writeConfig({ server: { antiCheat: { movesPerIdentity: null } } }))!.config.server?.antiCheat?.movesPerIdentity, null)

    assert.throws(() => findConfig(writeConfig({ server: { antiCheat: { movesPerIdentity: [0, 500] } } })), /movesPerIdentity doit être \[n entier ≥ 1, fenêtreMs entier > 0\] ou null/)
    assert.throws(() => findConfig(writeConfig({ server: { antiCheat: { movesPerIdentity: [10, 0] } } })), /movesPerIdentity doit être/)
    assert.throws(() => findConfig(writeConfig({ server: { antiCheat: { movesPerIdentity: 'oui' } } })), /movesPerIdentity doit être/)
  })

  it("throw sur server.antiCheat.X inconnu, avec suggestion orthographique", () => {
    const root = writeConfig({ server: { antiCheat: { movesPerIdentityy: [10, 500] } } })
    assert.throws(() => findConfig(root), /server\.antiCheat\.movesPerIdentityy : clé inconnue.*vouliez-vous dire 'movesPerIdentity'/)
  })

  it('server.antiCheat non-objet → throw', () => {
    const root = writeConfig({ server: { antiCheat: 'oui' } })
    assert.throws(() => findConfig(root), /'server\.antiCheat' doit être un objet/)
  })
})

// ============================================================================
// (b) cli/server.ts — fonctions pures
// ============================================================================

describe('cli/server — resolveServerEntryPath (--entry > server.entry > game.server.mjs > … > server/game.civet)', () => {
  it('--entry prioritaire même si la config ET les défauts existent', () => {
    const root = freshDir('server-entry-prio')
    writeFileSync(join(root, 'game.js'), '// défaut\n')
    writeFileSync(join(root, 'custom.js'), '// custom\n')
    const p = resolveServerEntryPath(root, 'custom.js', 'game.js')
    assert.equal(p, join(root, 'custom.js'))
  })

  it("--entry pointant vers un fichier absent → erreur immédiate (PAS de repli sur les défauts existants)", () => {
    const root = freshDir('server-entry-missing')
    writeFileSync(join(root, 'game.js'), '// défaut, ne doit PAS être choisi\n')
    assert.throws(() => resolveServerEntryPath(root, 'nope.js', undefined), /--entry 'nope\.js'.*introuvable/s)
  })

  it("server.entry (config) prioritaire sur les défauts quand --entry absent", () => {
    const root = freshDir('server-entry-config')
    writeFileSync(join(root, 'game.js'), '// défaut\n')
    mkdirSync(join(root, 'custom'), { recursive: true })
    writeFileSync(join(root, 'custom', 'srv.js'), '// config\n')
    const p = resolveServerEntryPath(root, undefined, 'custom/srv.js')
    assert.equal(p, join(root, 'custom', 'srv.js'))
  })

  it("défaut 'game.js' choisi quand rien d'autre n'est spécifié", () => {
    const root = freshDir('server-entry-default1')
    writeFileSync(join(root, 'game.js'), '// défaut\n')
    const p = resolveServerEntryPath(root, undefined, undefined)
    assert.equal(p, join(root, 'game.js'))
  })

  it("défaut 'server/game.js' choisi quand 'game.js' est absent", () => {
    const root = freshDir('server-entry-default2')
    mkdirSync(join(root, 'server'), { recursive: true })
    writeFileSync(join(root, 'server', 'game.js'), '// défaut serveur\n')
    const p = resolveServerEntryPath(root, undefined, undefined)
    assert.equal(p, join(root, 'server', 'game.js'))
  })

  it("'game.server.mjs' (format RECOMMANDÉ) prime sur 'game.js'/'game.civet'", () => {
    const root = freshDir('server-entry-servermjs')
    writeFileSync(join(root, 'game.server.mjs'), `export default\n  setup: (app) ->\n    app.game 'x', { places: 1, state: (p) -> ({}), moves: {} }\n`)
    writeFileSync(join(root, 'game.js'), `export default {\n  setup(app) {},\n}\n`)
    const p = resolveServerEntryPath(root, undefined, undefined)
    assert.equal(p, join(root, 'game.server.mjs'))
  })

  it("introuvable (aucun candidat) → erreur claire qui IMPRIME un squelette minimal mentionnant mjsServer/app.game", () => {
    const root = freshDir('server-entry-none')
    assert.throws(() => resolveServerEntryPath(root, undefined, undefined), (err: any) => {
      assert.match(err.message, /aucun fichier d'entry trouvé/)
      assert.match(err.message, /game\.server\.mjs, server\/game\.server\.mjs, game\.js, game\.civet, server\/game\.js, server\/game\.civet/)
      assert.match(err.message, /mjsServer/, 'le message doit expliquer que le CLI construit l\'app mjsServer')
      assert.match(err.message, /app\.game/, 'le squelette doit montrer app.game(...)')
      assert.match(err.message, /export default/)
      assert.doesNotMatch(err.message, /^import |\bfrom '/m, 'le squelette ne doit contenir AUCUN import (entry chargée par data: URL — un import npm y planterait)')
      return true
    })
  })

  it("AUCUNE collision avec les défauts de `mjs ws` : un projet avec ws.server.mjs ET game.server.mjs résout chacun le sien", () => {
    const root = freshDir('server-vs-ws-no-collision')
    writeFileSync(join(root, 'ws.server.mjs'), `export default\n  setup: (app) ->\n    app.serve 'ping', -> 'pong-ws'\n`)
    writeFileSync(join(root, 'game.server.mjs'), `export default\n  setup: (app) ->\n    app.game 'x', { places: 1, state: (p) -> ({}), moves: {} }\n`)
    const wsPath      = resolveEntryPath(root, undefined, undefined)
    const serveurPath = resolveServerEntryPath(root, undefined, undefined)
    assert.equal(wsPath, join(root, 'ws.server.mjs'))
    assert.equal(serveurPath, join(root, 'game.server.mjs'))
    assert.notEqual(wsPath, serveurPath)
  })
})

describe("cli/server — readServerEntryContract (contrat de l'entry)", () => {
  it("throw si le default export est absent", () => {
    assert.throws(() => readServerEntryContract({}, '/fake/game.js', () => {}), /doit faire 'export default \{ \.\.\. \}'.*aucun export par défaut/s)
  })

  it("throw si 'setup' n'est pas une fonction", () => {
    assert.throws(() => readServerEntryContract({ default: { setup: 42 } }, '/fake/game.js', () => {}), /'setup' doit être une fonction/)
  })

  it('extrait les options + setup normalement (cas nominal)', () => {
    const setupFn = () => {}
    const warns: string[] = []
    const { options, setup } = readServerEntryContract({ default: { heartbeat: 5000, setup: setupFn } }, '/fake/game.js', m => warns.push(m))
    assert.equal(options.heartbeat, 5000)
    assert.equal(setup, setupFn)
    assert.deepEqual(warns, [])
  })

  it("chacune des 3 clés réservées (port/host/onLog) déclenche EXACTEMENT le warn attendu et est retirée des options", () => {
    for (const key of ['port', 'host', 'onLog']) {
      const warns: string[] = []
      const { options } = readServerEntryContract({ default: { [key]: 'peu-importe' } }, '/fake/game.js', m => warns.push(m))
      assert.deepEqual(warns, [`entry.${key} ignorée : gérée par le CLI/la config`])
      assert.ok(!(key in options), `${key} ne doit PAS survivre dans les options transmises à mjsServer()`)
    }
  })

  it("'antiTriche'/'persist' traversent SANS warn (options légitimes de mjsServer(), pas réservées)", () => {
    const warns: string[] = []
    const { options } = readServerEntryContract({ default: { antiCheat: { movesPerIdentity: [5, 1000] }, persist: { load: () => {}, save: () => {}, remove: () => {} } } }, '/fake/game.js', m => warns.push(m))
    assert.deepEqual(warns, [])
    assert.deepEqual((options as any).antiCheat, { movesPerIdentity: [5, 1000] })
  })
})

describe('cli/server — buildServerRunPlan (priorités port/host/heartbeat/limits/antiTriche)', () => {
  const noWarn = () => { throw new Error('aucun warn attendu ici') }

  it('port : --port prioritaire sur server.port et sur le défaut 4001', () => {
    const plan = buildServerRunPlan({ options: {} }, { port: 5000 }, 6000, noWarn)
    assert.equal(plan.port, 6000)
  })

  it('port : server.port utilisé si --port absent', () => {
    const plan = buildServerRunPlan({ options: {} }, { port: 5000 }, undefined, noWarn)
    assert.equal(plan.port, 5000)
  })

  it('port : défaut 4001 (DISTINCT du 4000 de `mjs ws`) si rien de spécifié', () => {
    const plan = buildServerRunPlan({ options: {} }, undefined, undefined, noWarn)
    assert.equal(plan.port, 4001)
  })

  it("heartbeat : défini dans LES DEUX → l'entry prime + warn explicite", () => {
    const warns: string[] = []
    const plan = buildServerRunPlan({ options: { heartbeat: 111 } }, { heartbeat: 222 }, undefined, m => warns.push(m))
    assert.equal(plan.heartbeat, 111)
    assert.ok(warns.some(w => /heartbeat.*entry prime/.test(w)))
  })

  it('heartbeat : absent des deux → DEFAULT_HEARTBEAT (15000)', () => {
    const plan = buildServerRunPlan({ options: {} }, undefined, undefined, noWarn)
    assert.equal(plan.heartbeat, 15000)
  })

  it("limits : défini dans LES DEUX → l'entry prime EN BLOC (pas de fusion clé à clé) + warn", () => {
    const warns: string[] = []
    const plan = buildServerRunPlan({ options: { limits: { rate: 1 } } }, { limits: { rate: 2, burst: 2 } }, undefined, m => warns.push(m))
    assert.equal(plan.limits.rate, 1)
    assert.equal(plan.limits.burst, 80)   // DEFAULT_LIMITS.burst — PAS 2
    assert.ok(warns.some(w => /limits.*entry prime/.test(w)))
  })

  it("antiTriche : défini SEULEMENT dans la config → utilisé sans warn", () => {
    const plan = buildServerRunPlan({ options: {} }, { antiCheat: { movesPerIdentity: [20, 1000] } }, undefined, noWarn)
    assert.deepEqual((plan.options as any).antiCheat, { movesPerIdentity: [20, 1000] })
  })

  it("antiTriche : défini dans LES DEUX → l'entry prime EN BLOC + warn explicite", () => {
    const warns: string[] = []
    const plan = buildServerRunPlan({ options: { antiCheat: { movesPerIdentity: [5, 500] } } }, { antiCheat: { movesPerIdentity: [99, 99] } }, undefined, m => warns.push(m))
    assert.deepEqual((plan.options as any).antiCheat, { movesPerIdentity: [5, 500] })
    assert.ok(warns.some(w => /antiCheat.*entry prime/.test(w)))
  })

  it('ban : défini SEULEMENT dans la config → utilisé sans warn', () => {
    const plan = buildServerRunPlan({ options: {} }, { ban: { by: 'ip' } }, undefined, noWarn)
    assert.deepEqual((plan.options as any).ban, { by: 'ip' })
  })

  it('antiTriche : absent des deux → undefined (aucun quota, comportement mjsServer() par défaut)', () => {
    const plan = buildServerRunPlan({ options: {} }, undefined, undefined, noWarn)
    assert.equal((plan.options as any).antiCheat, undefined)
  })
})

// ============================================================================
// (c) runServerCommand — boucle complète (MemoryTransport injecté, VRAI client µ.socket)
// ============================================================================

describe("cli/server — runServerCommand : chargement d'entry (VRAI client µ.socket, MemoryTransport injecté)", function () {
  this.timeout(10000)

  afterEach(restoreCaptures)

  // app.game('morpion', …) déclaré dans setup(app) — capacité SPÉCIFIQUE à MJS-Server : une app
  // construite par mjsWs() n'a jamais `.game` ni `stats().game`. Le test ci-dessous s'assure que
  // c'est bien mjsServer() (pas mjsWs()) qui construit l'app derrière `mjs server`.
  const MORPION_ENTRY = `export default {
  setup(app) {
    app.game('morpion', {
      seats: 2,
      state: (game) => ({ grille: Array(9).fill(null) }),
      moves: {
        jouer: (game, player, p) => {
          game.state.grille[p.i] = player.id
          game.next()
        },
      },
    })
  },
}
`

  it("setup(app) est appelé AVANT listen(), app.game(...) déclaré sans throw → preuve que mjsServer() a construit l'app (app.stats().game existe, absent d'une app mjsWs())", async () => {
    const root = freshDir('server-load')
    writeFileSync(join(root, 'serveur.mjs'), MORPION_ENTRY)
    const transport = new MemoryTransport()
    const cap = patchConsole()
    const handle = await runServerCommand({ root, entry: 'serveur.mjs' }, undefined, { transport, watch: false })
    cap.restore()
    try {
      assert.ok(cap.lines.some(l => l.includes('Ctrl-C pour arrêter')), 'la bannière doit être imprimée au démarrage')
      assert.equal(typeof handle.app.game, 'function', 'app.game DOIT exister — capacité EXCLUSIVE à mjsServer()')
      const stats = handle.app.stats() as any
      assert.deepEqual(stats.game, { suspectMoves: 0, rejectedMoves: 0 }, "app.stats().game DOIT exister — absent d'une app mjsWs() nue")

      const µ = makeClient(transport)
      const s = µ.socket('memory://serveur-load-1')
      s.connect(); await tick()
      assert.equal(s.state, 'open')
      const res = await s.request('µgame:play', { type: 'morpion' })
      assert.ok(res && typeof res === 'object', 'µgame:play doit répondre — la plomberie interne MJS-Server doit être active')
      s.destroy()
    } finally {
      await handle.stop()
    }
  })

  it("clé réservée ('port') présente dans l'entry → warn explicite + ignorée, le serveur démarre quand même normalement", async () => {
    const root = freshDir('server-reserved')
    writeFileSync(join(root, 'serveur.mjs'), `export default {\n  port: 9999,\n  setup(app) {\n    app.serve('ping', () => 'pong')\n  },\n}\n`)
    const transport = new MemoryTransport()
    const cap = patchConsole()
    const handle = await runServerCommand({ root, entry: 'serveur.mjs' }, undefined, { transport, watch: false })
    cap.restore()
    try {
      assert.ok(cap.lines.some(l => l.includes('entry.port ignorée : gérée par le CLI/la config')), `warn attendu absent. lignes:\n${cap.lines.join('\n')}`)
      const µ = makeClient(transport)
      const s = µ.socket('memory://serveur-reserved-1')
      s.connect(); await tick()
      assert.equal(await s.request('ping', {}), 'pong')
      s.destroy()
    } finally {
      await handle.stop()
    }
  })

  it("default export absent → runServerCommand rejette avec une erreur claire", async () => {
    const root = freshDir('server-badexport')
    writeFileSync(join(root, 'serveur.mjs'), `export const rien = true\n`)
    const transport = new MemoryTransport()
    await assert.rejects(
      runServerCommand({ root, entry: 'serveur.mjs' }, undefined, { transport, watch: false }),
      /doit faire 'export default \{ \.\.\. \}'/,
    )
  })

  it("mjs.config.json server.antiCheat.movesPerIdentity appliqué au boot → ligne bannière anti-triche", async () => {
    const root = freshDir('server-antitriche-banner')
    writeFileSync(join(root, 'serveur.mjs'), MORPION_ENTRY)
    const transport = new MemoryTransport()
    const cap = patchConsole()
    const handle = await runServerCommand({ root, entry: 'serveur.mjs' }, { server: { antiCheat: { movesPerIdentity: [40, 1000] } } } as any, { transport, watch: false })
    cap.restore()
    try {
      assert.ok(cap.lines.some(l => l.includes('anti-triche : quota 40 coups/identité par 1s')), `ligne anti-triche absente. lignes:\n${cap.lines.join('\n')}`)
    } finally {
      await handle.stop()
    }
  })
})

// ============================================================================
// (d) entry en `.server.mjs` — MÊME dialecte Civet que `mjs ws` (réutilise cli/server-entry.ts)
// ============================================================================

describe('cli/server — entry en .server.mjs (dialecte Civet des composants, RÉUTILISE cli/server-entry.ts)', function () {
  this.timeout(10000)

  it("fixture game.server.mjs (syntaxe Civet réelle) → résolution PAR DÉFAUT + chargement + setup(app) appelé + boucle complète (vrai client µ.socket)", async () => {
    const root = freshDir('server-server-dialect')
    writeFileSync(join(root, 'game.server.mjs'), `GREETING = 'bonjour'\n\nexport default\n  setup: (app) ->\n    app.serve 'ping', -> "#{GREETING}"\n`)
    const transport = new MemoryTransport()
    const handle = await runServerCommand({ root }, undefined, { transport, watch: false })
    try {
      assert.match(handle.entryPath, /game\.server\.mjs$/, "game.server.mjs doit avoir été trouvé par la résolution PAR DÉFAUT")
      const µ = makeClient(transport)
      const s = µ.socket('memory://serveur-server-dialect-1')
      s.connect(); await tick()
      assert.equal(s.state, 'open')
      assert.equal(await s.request('ping', {}), 'bonjour', 'interpolation Civet "#{}" doit avoir été traduite (dialecte composant)')
      s.destroy()
    } finally {
      await handle.stop()
    }
  })

  it('markup de composant (<template>) dans un game.server.mjs → erreur française claire (runServerCommand rejette, MÊME garde que `mjs ws`)', async () => {
    const root = freshDir('server-markup')
    const entryPath = join(root, 'game.server.mjs')
    writeFileSync(entryPath, `<template>\n  <p>salut</p>\n</template>\n`)
    const transport = new MemoryTransport()
    await assert.rejects(
      runServerCommand({ root }, undefined, { transport, watch: false }),
      (err: any) => {
        assert.match(err.message, /markup de composant/)
        assert.match(err.message, /<template>/)
        return true
      },
    )
  })
})

// ============================================================================
// (d bis) grammaire @import d'une entry serveur — MIROIR minimal de mjs-ws-cli.test.ts
// (cli/server-entry.ts, module PARTAGÉ avec `mjs ws`)
// ============================================================================

describe("cli/server — grammaire @import d'une entry serveur (cli/server-entry.ts)", function () {
  this.timeout(10000)

  it("@import d'un fichier .civet relatif (dialecte appliqué) → utilisable dans app.game (setup)", async () => {
    const root = freshDir('server-import-civet')
    writeFileSync(join(root, 'rules.civet.mjs'), `export ligne := (grille, id) -> grille.every (c) -> c is id\n`)
    writeFileSync(join(root, 'game.server.mjs'), `@import ligne './rules.civet.mjs'\n\nexport default\n  setup: (app) ->\n    app.game 'morpion',\n      seats: 2\n      state: (partie) -> { grille: Array(9).fill(null), gagne: ligne([null, null, null], 'x') }\n      moves:\n        jouer: (partie, joueur, p) ->\n          partie.state.grille[p.i] = joueur.id\n          partie.next()\n`)
    const transport = new MemoryTransport()
    const handle = await runServerCommand({ root }, undefined, { transport, watch: false })
    try {
      assert.match(handle.entryPath, /game\.server\.mjs$/)
      const µ = makeClient(transport)
      const s = µ.socket('memory://server-import-civet-1')
      s.connect(); await tick()
      const res = await s.request('µgame:play', { type: 'morpion' })
      assert.ok(res && typeof res === 'object', "µgame:play doit répondre — la fonction @import-ée n'a pas cassé state()")
      s.destroy()
    } finally {
      await handle.stop()
    }
  })
})

// ============================================================================
// (e) rechargement à chaud
// ============================================================================

describe('cli/server — rechargement à chaud (fs.watch réel, fixture réécrite sur disque)', function () {
  this.timeout(10000)

  afterEach(restoreCaptures)

  it('nouvelle version de la fixture → nouveau comportement actif (nouvelle connexion)', async () => {
    const root = freshDir('server-reload-ok')
    const entryPath = join(root, 'serveur.mjs')
    writeFileSync(entryPath, `export default {\n  setup(app) {\n    app.serve('version', () => 'v1')\n  },\n}\n`)
    const transport = new MemoryTransport()
    const boot = patchConsole()
    const handle = await runServerCommand({ root, entry: 'serveur.mjs' }, undefined, { transport })   // watch par défaut (true)
    boot.restore()
    try {
      const µ1 = makeClient(transport)
      const s1 = µ1.socket('memory://serveur-reload-ok-v1')
      s1.connect(); await tick()
      assert.equal(await s1.request('version', {}), 'v1')

      const cap = patchConsole()
      writeFileSync(entryPath, `export default {\n  setup(app) {\n    app.serve('version', () => 'v2')\n  },\n}\n`)
      await tick(600)   // 150ms debounce + import/stop/listen, marge large
      cap.restore()
      assert.ok(cap.lines.some(l => l.includes('♻️') && l.includes('redémarré')), `log de rechargement absent. lignes:\n${cap.lines.join('\n')}`)

      const µ2 = makeClient(transport)
      const s2 = µ2.socket('memory://serveur-reload-ok-v2')
      s2.connect(); await tick()
      assert.equal(await s2.request('version', {}), 'v2', 'le nouveau serveur doit refléter la v2 de la fixture')
      s1.destroy(); s2.destroy()
    } finally {
      await handle.stop()
    }
  })
})
