// Page servie en flux (`stream`, par route ou par défaut dans `render`) : la coquille (`<head>` et ses feuilles) part avant le
// chargeur de données et le rendu, le corps suit quand il est prêt, et la page finale garde les octets d'une page servie d'un
// bloc. Une erreur une fois la coquille partie : la suite reprend les octets de la page d'erreur d'un bloc et la réponse se termine
// normalement — le statut 200 déjà parti ne peut plus changer. Sans l'option, rien ne change.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { get, type IncomingHttpHeaders } from 'node:http'
import { join } from 'node:path'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'
import { startRenderServer, type RunningServer } from '../src/server/render-server.js'
import { StaticServer } from '../src/server/index.js'
import { createRenderHandler } from '../src/server/render-request.js'
import { createServeEntry } from '../src/server/serve-entry.js'
import { findConfig } from '../src/bundler/config.js'
import { terminateSharedWorkerPool, OUTPUT_MARK } from '../src/bundler/index.js'

after(async () => { sweepRegistered(); await terminateSharedWorkerPool() })

const COQUILLE = '<!doctype html>\n<html lang="fr">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'

const CHARGEUR = `export default {
  props: {
    '/lent': (params, req) -> globalThis.__mjsFluxChargeur.then(-> { titre: 'Charge' }),
    '/lent-bloc': (params, req) -> globalThis.__mjsFluxChargeur.then(-> { titre: 'Charge' }),
    '/gros': (params, req) -> { liste: Array.from({ length: 60000 }, (v, i) -> 'element-' + i) },
    '/gros-bloc': (params, req) -> { liste: Array.from({ length: 60000 }, (v, i) -> 'element-' + i) }
  }
}
`

const ATTENTE = `<script module>
attendre = (ms) -> new Promise((r) -> setTimeout(r, ms))
</script>
<script>
$attente = attendre(3000)
</script>
{await $attente}
  <p>en attente</p>
{success}
  <p>arrivé</p>
{end}
`

interface Lecture { statut: number, entetes: IncomingHttpHeaders, morceaux: string[], texte: string, complete: boolean }

const delai = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// lit une réponse morceau par morceau : `surPremier` reçoit le premier dès son arrivée, `lent` lit par petites prises espacées
// (client lent), `couper` ferme la connexion du client après le premier morceau
function lire(port: number, chemin: string, o: { surPremier?: (m: string) => void, lent?: boolean, couper?: boolean } = {}): Promise<Lecture> {
  return new Promise((ok, ko) => {
    const req = get({ host: '127.0.0.1', port, path: chemin, agent: false }, (res) => {
      const morceaux: string[] = []
      res.setEncoding('utf8')
      res.on('data', (m: string) => {
        morceaux.push(m)
        if (morceaux.length === 1) {
          o.surPremier?.(m)
          if (o.couper) req.destroy()
        }
        if (o.lent) {
          res.pause()
          setTimeout(() => res.resume(), 15)
        }
      })
      res.on('error', () => {})
      res.on('close', () => ok({ statut: res.statusCode ?? 0, entetes: res.headers, morceaux, texte: morceaux.join(''), complete: res.complete }))
    })
    req.on('error', (e) => { if (!o.couper) ko(e) })
  })
}

// suspend le chargeur des pages lentes jusqu'à l'appel de la fonction rendue
function suspendre(): () => void {
  let liberer: () => void = () => {}
  ;(globalThis as any).__mjsFluxChargeur = new Promise<void>((r) => { liberer = r })
  return () => liberer()
}

function projet(): { root: string, outDir: string, config: any } {
  const root   = mjsTmp('page-en-flux')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(srcDir, 'home.mjs'), '<h1 class="t">{$titre}</h1>\n')
  writeFileSync(join(srcDir, 'attente.mjs'), ATTENTE)
  writeFileSync(join(outDir, 'manifest.js'), `${OUTPUT_MARK}\nµ.paths = {};\nµ.version = "abcd1234";\n`)
  writeFileSync(join(root, 'serve.server.mjs'), CHARGEUR)
  const config: any = {
    sourceDir: 'src', outputDir: 'out', manifestPath: 'out/manifest.js',
    render: {
      routes: {
        '/lent':         { component: 'mjs-home', mode: 'ssr', stream: true },
        '/lent-bloc':    { component: 'mjs-home', mode: 'ssr' },
        '/casse':        { component: 'mjs-absent', mode: 'ssr', stream: true },
        '/attente':      { component: 'mjs-attente', mode: 'ssr', settleMs: 50, stream: true },
        '/attente-bloc': { component: 'mjs-attente', mode: 'ssr', settleMs: 50 },
        '/gros':         { component: 'mjs-home', mode: 'csr', stream: true },
        '/gros-bloc':    { component: 'mjs-home', mode: 'csr' },
      },
    },
  }
  return { root, outDir, config }
}

// la page lente demandée en flux : rend la lecture et dit si le chargeur attendait encore à l'arrivée du premier morceau
async function lireEnFlux(port: number, chemin: string): Promise<{ lecture: Lecture, chargeurEnAttente: boolean | null, tPremier: number, tFin: number }> {
  const liberer = suspendre()
  let fini = false
  let chargeurEnAttente: boolean | null = null
  let tPremier = -1
  let signaler: () => void = () => {}
  const premier = new Promise<void>((r) => { signaler = r })
  const t0      = Date.now()
  const enCours = lire(port, chemin, { surPremier: () => { tPremier = Date.now() - t0; chargeurEnAttente = !fini; signaler() } })
  await Promise.race([premier, delai(5000)])
  await delai(300)
  fini = true
  liberer()
  const lecture = await enCours
  return { lecture, chargeurEnAttente, tPremier, tFin: Date.now() - t0 }
}

function verifierCoquille(m: string): void {
  assert.ok(m.startsWith(COQUILLE), 'le premier morceau commence par la coquille : ' + m.slice(0, 120))
  assert.ok(m.endsWith('</head>\n<body>\n'), 'le premier morceau s\'arrête à l\'ouverture du corps : ' + m.slice(-60))
  assert.ok(!m.includes('__mjs_res') && !m.includes('<mjs-'), 'rien du corps dans le premier morceau')
}

describe('page servie en flux — mjs serve', function () {
  this.timeout(60000)
  let root: string
  let config: any
  let serveur: RunningServer

  before(async function () {
    ;({ root, config } = projet())
    serveur = await startRenderServer(config, root, { port: 0 })
  })

  after(async () => { await serveur.close() })

  it('sans l\'option : une seule écriture, longueur annoncée, mêmes en-têtes qu\'aujourd\'hui', async () => {
    ;(globalThis as any).__mjsFluxChargeur = Promise.resolve()
    const r = await lire(serveur.port, '/lent-bloc')
    assert.equal(r.statut, 200)
    assert.ok(r.complete)
    assert.equal(r.entetes['content-length'], String(Buffer.byteLength(r.texte)))
    assert.equal(r.entetes['transfer-encoding'], undefined)
    assert.equal(r.entetes['x-mjs-mode'], 'ssr:replace')
    assert.equal(r.entetes['vary'], 'X-MJS-Nav')
    assert.ok(r.entetes['x-mjs-version'], 'version du build annoncée')
    assert.ok(r.texte.startsWith(COQUILLE))
    assert.match(r.texte, /__mjs_res/)
    assert.match(r.texte, /Charge/)
  })

  it('avec l\'option : la coquille part avant la fin du chargeur, le corps suit, la page finale est celle d\'un bloc', async () => {
    const { lecture, chargeurEnAttente, tPremier, tFin } = await lireEnFlux(serveur.port, '/lent')
    assert.equal(chargeurEnAttente, true, `la coquille doit partir avant la fin du chargeur (premier morceau à ${tPremier} ms, fin à ${tFin} ms)`)
    assert.ok(tPremier >= 0 && tPremier < tFin, `premier morceau à ${tPremier} ms, fin à ${tFin} ms`)
    verifierCoquille(lecture.morceaux[0])
    assert.ok(lecture.complete, 'réponse terminée proprement')
    assert.equal(lecture.statut, 200)
    assert.equal(lecture.entetes['transfer-encoding'], 'chunked')
    ;(globalThis as any).__mjsFluxChargeur = Promise.resolve()
    const bloc = await lire(serveur.port, '/lent-bloc')
    assert.equal(lecture.texte, bloc.texte, 'mêmes octets qu\'une page servie d\'un bloc')
    for (const nom of ['content-type', 'x-mjs-mode', 'vary', 'x-mjs-version']) assert.equal(lecture.entetes[nom], bloc.entetes[nom], nom)
  })

  it('render.stream sert de défaut, et `stream: false` sur une route l\'emporte', async () => {
    ;(globalThis as any).__mjsFluxChargeur = Promise.resolve()
    config.render.stream = true
    try {
      const parDefaut = await lire(serveur.port, '/lent-bloc')
      assert.equal(parDefaut.entetes['transfer-encoding'], 'chunked', 'le défaut de render met la route en flux')
      config.render.routes['/lent-bloc'].stream = false
      const refus = await lire(serveur.port, '/lent-bloc')
      assert.equal(refus.entetes['transfer-encoding'], undefined, 'la route garde le dernier mot')
      assert.equal(refus.texte, parDefaut.texte)
    } finally {
      delete config.render.stream
      delete config.render.routes['/lent-bloc'].stream
    }
  })

  it('erreur pendant le rendu : la suite reprend les octets de la page d\'erreur, statut 200 déjà parti, fin normale', async () => {
    config.render.routes['/casse'].stream = false
    let bloc: Lecture
    try {
      bloc = await lire(serveur.port, '/casse')
    } finally {
      config.render.routes['/casse'].stream = true
    }
    assert.equal(bloc.statut, 500, 'contrôle : la page d\'un bloc est bien une erreur')
    const flux = await lire(serveur.port, '/casse')
    assert.equal(flux.statut, 200, 'le statut part avec la coquille')
    verifierCoquille(flux.morceaux[0])
    assert.equal(flux.texte, bloc.texte, 'mêmes octets que la page d\'erreur d\'un bloc')
    assert.ok(flux.complete, 'la réponse se termine normalement')
  })

  it('délai de rendu dépassé (settleMs) : même page qu\'un bloc', async () => {
    // l'avertissement du rendu non stabilisé prouve que le délai a bien été dépassé, pour l'une et l'autre page
    const avertissements: string[] = []
    const warn = console.warn
    console.warn = (...a: unknown[]) => { avertissements.push(a.map(String).join(' ')) }
    let flux: Lecture, bloc: Lecture
    try {
      flux = await lire(serveur.port, '/attente')
      bloc = await lire(serveur.port, '/attente-bloc')
    } finally {
      console.warn = warn
    }
    assert.equal(avertissements.filter((m) => m.includes('mjs-attente') && m.includes('50ms')).length, 2, avertissements.join('\n'))
    assert.equal(flux.statut, 200)
    assert.equal(bloc.statut, 200)
    assert.equal(flux.entetes['transfer-encoding'], 'chunked')
    assert.ok(flux.complete)
    assert.equal(flux.texte, bloc.texte)
  })

  it('client lent qui lit le flux : page complète, octets d\'un bloc', async () => {
    const flux = await lire(serveur.port, '/gros', { lent: true })
    const bloc = await lire(serveur.port, '/gros-bloc')
    assert.equal(flux.entetes['transfer-encoding'], 'chunked')
    assert.ok(flux.complete)
    assert.ok(flux.morceaux.length > 10, 'lu en plusieurs prises : ' + flux.morceaux.length)
    assert.ok(flux.texte.length > 500000)
    assert.equal(flux.texte, bloc.texte)
  })

  it('connexion coupée par le client en cours de flux : aucune fuite côté serveur', async () => {
    const liberer = suspendre()
    const enCours = lire(serveur.port, '/lent', { couper: true })
    await Promise.race([enCours, delai(5000)])
    liberer()
    const coupee = await enCours
    verifierCoquille(coupee.morceaux[0])
    assert.equal(coupee.complete, false)
    // le rendu de la page abandonnée se termine sans rien casser ; plus aucune connexion ouverte
    await delai(1500)
    const ouvertes = await new Promise<number>((r) => serveur.server.getConnections((e, n) => r(n)))
    assert.equal(ouvertes, 0, 'connexions encore ouvertes : ' + ouvertes)
    ;(globalThis as any).__mjsFluxChargeur = Promise.resolve()
    const suivante = await lire(serveur.port, '/lent')
    assert.ok(suivante.complete)
    assert.equal(suivante.statut, 200)
    assert.match(suivante.texte, /Charge/)
  })
})

describe('page servie en flux — mjs dev', function () {
  this.timeout(60000)
  let root: string, outDir: string, config: any
  let dev: StaticServer
  let port: number
  let handler: Awaited<ReturnType<typeof createRenderHandler>>
  let entry: Awaited<ReturnType<typeof createServeEntry>>

  before(async function () {
    ;({ root, outDir, config } = projet())
    handler = await createRenderHandler(config, root)
    entry   = await createServeEntry(config, root)
    dev     = new StaticServer({ rootDir: outDir, port: 0, host: '127.0.0.1', config, configDir: root, manifestPath: join(outDir, 'manifest.js'), renderHandle: handler.handle, entry })
    await dev.start()
    port = (dev.server!.address() as any).port
  })

  after(async () => {
    await dev.stop()
    entry.close()
    await handler.close()
  })

  it('la coquille part avant la fin du chargeur, la page finale est celle d\'un bloc', async () => {
    const { lecture, chargeurEnAttente, tPremier, tFin } = await lireEnFlux(port, '/lent')
    assert.equal(chargeurEnAttente, true, `la coquille doit partir avant la fin du chargeur (premier morceau à ${tPremier} ms, fin à ${tFin} ms)`)
    verifierCoquille(lecture.morceaux[0])
    assert.ok(lecture.complete)
    assert.equal(lecture.entetes['transfer-encoding'], 'chunked')
    ;(globalThis as any).__mjsFluxChargeur = Promise.resolve()
    const bloc = await lire(port, '/lent-bloc')
    assert.equal(bloc.entetes['transfer-encoding'], undefined)
    assert.equal(lecture.texte, bloc.texte)
    for (const nom of ['content-type', 'x-mjs-mode']) assert.equal(lecture.entetes[nom], bloc.entetes[nom], nom)
  })

  it('erreur pendant le rendu : mêmes octets que la page d\'erreur, fin normale', async () => {
    config.render.routes['/casse'].stream = false
    let bloc: Lecture
    try {
      bloc = await lire(port, '/casse')
    } finally {
      config.render.routes['/casse'].stream = true
    }
    assert.equal(bloc.statut, 500)
    const flux = await lire(port, '/casse')
    assert.equal(flux.statut, 200)
    verifierCoquille(flux.morceaux[0])
    assert.equal(flux.texte, bloc.texte)
    assert.ok(flux.complete)
  })
})

describe('page servie en flux — file de rendu pleine', function () {
  this.timeout(60000)
  let root: string, outDir: string, config: any
  let serveur: RunningServer
  let dev: StaticServer
  let portDev: number
  let handler: Awaited<ReturnType<typeof createRenderHandler>>
  let entry: Awaited<ReturnType<typeof createServeEntry>>

  before(async function () {
    ;({ root, outDir, config } = projet())
    // un rendu à la fois, une seule place d'attente
    config.render.renderQueue = { concurrency: 1, maxQueue: 1 }
    serveur = await startRenderServer(config, root, { port: 0 })
    handler = await createRenderHandler(config, root)
    entry   = await createServeEntry(config, root)
    dev     = new StaticServer({ rootDir: outDir, port: 0, host: '127.0.0.1', config, configDir: root, manifestPath: join(outDir, 'manifest.js'), renderHandle: handler.handle, entry })
    await dev.start()
    portDev = (dev.server!.address() as any).port
    // rendu à froid fait d'avance (compilation du projet, qui réécrit la version du manifeste) : les séries comparées voient la même
    ;(globalThis as any).__mjsFluxChargeur = Promise.resolve()
    await lire(serveur.port, '/lent-bloc')
    await lire(portDev, '/lent-bloc')
  })

  after(async () => {
    await serveur.close()
    await dev.stop()
    entry.close()
    await handler.close()
  })

  // trois demandes de la page lente à 0, 60 et 120 ms, chargeur suspendu jusqu'à leur départ ; `stream` de la route le temps de la série
  async function troisLentes(port: number, stream: boolean): Promise<Lecture[]> {
    config.render.routes['/lent'].stream = stream
    const liberer  = suspendre()
    const lectures = [0, 60, 120].map((ms) => delai(ms).then(() => lire(port, '/lent')))
    await delai(400)
    liberer()
    try {
      return await Promise.all(lectures)
    } finally {
      config.render.routes['/lent'].stream = true
    }
  }

  // la troisième demande, refusée faute de place : en flux comme d'un bloc, le 503 d'un bloc octet pour octet, sans coquille
  async function verifierRefus(port: number): Promise<void> {
    const bloc = await troisLentes(port, false)
    assert.deepEqual(bloc.map((l) => l.statut), [200, 200, 503], 'contrôle : d\'un bloc, la troisième est refusée')
    const flux = await troisLentes(port, true)
    assert.deepEqual(flux.map((l) => l.statut), [200, 200, 503], 'en flux, la troisième est refusée avant sa coquille')
    assert.equal(flux[2].entetes['retry-after'], '1')
    assert.equal(flux[2].entetes['transfer-encoding'], undefined, 'refus d\'un bloc, aucune coquille partie')
    for (const nom of ['content-type', 'content-length', 'x-mjs-mode', 'x-mjs-version', 'vary', 'retry-after']) assert.equal(flux[2].entetes[nom], bloc[2].entetes[nom], nom)
    assert.equal(flux[2].texte, bloc[2].texte, 'mêmes octets que le refus d\'un bloc')
    for (const l of flux.slice(0, 2)) {
      verifierCoquille(l.morceaux[0])
      assert.ok(l.complete)
      assert.match(l.texte, /Charge/)
    }
  }

  it('mjs serve : la troisième page lente reçoit le 503 d\'un bloc, avec Retry-After', async () => {
    await verifierRefus(serveur.port)
  })

  it('mjs dev : même refus, décidé avant la coquille', async () => {
    await verifierRefus(portDev)
  })
})

describe('page servie en flux — configuration', () => {
  function essayer(render: unknown): string | null {
    const dir = mjsTmp('page-en-flux-config')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', render }))
    try {
      findConfig(dir)
      return null
    } catch (e: any) {
      return String(e?.message ?? e)
    }
  }

  it('render.stream et render.routes[url].stream : des booléens, toute autre valeur refusée', () => {
    assert.equal(essayer({ stream: true, routes: { '/': { component: 'mjs-home', mode: 'ssr', stream: false } } }), null)
    const global = essayer({ stream: 'oui' })
    assert.ok(global && /render\.stream/.test(global) && /booléen/.test(global), String(global))
    const route = essayer({ routes: { '/': { component: 'mjs-home', stream: 1 } } })
    assert.ok(route && route.includes("render.routes['/'].stream") && /booléen/.test(route), String(route))
  })
})
