// un tunnel qui réécrit l'en-tête Host en `localhost` (ngrok `--host-header=rewrite`, proxy local) passe la garde Host, mais la page
// qu'il sert garde pour origine le nom du tunnel : le rechargement à chaud la refusait (`1008 Origin not allowed`) et les formulaires
// (actions `.server.mjs`) répondaient 403, faute d'égalité entre cette origine et le Host reçu. Elle est admise par son nom EXACT dans
// `dev.allowedHosts`, et par lui seul : une entrée `.domaine` et `true` ouvrent des Host, pas une origine autre que Host — derrière un
// Host réécrit, ils admettraient aussi les pages d'autres sites (un autre utilisateur d'un domaine partagé comme `.ngrok-free.app`, ou
// n'importe quel site avec `true`), qui joignent `mjs dev` depuis votre navigateur. Refus ; le message qui dit d'écrire le nom exact ne
// paraît que si le Host reçu est local (un tunnel l'a réécrit), un refus simple sinon. `mjs serve` ne lit pas `dev.allowedHosts`

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'
import * as hmr from '../src/server/hmr.js'
import { StaticServer } from '../src/server/index.js'
import { startRenderServer } from '../src/server/render-server.js'
import { createServeEntry } from '../src/server/serve-entry.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

after(async () => { await terminateSharedWorkerPool() })

const TUNNEL = 'abc.ngrok-free.app'
const PAGE   = 'https://' + TUNNEL
const MOTIF  = '.ngrok-free.app'

const FIXTURE = `export default {
  actions: {
    '/p/:id': (params, body, req) -> { redirect: "/p/#{params.id}" }
  }
}
`

// projet minimal avec une action `.server.mjs` (même fixture que les tests du pipeline d'actions)
function projet(dev?: { allowedHosts: string[] | true }, allowedOrigins?: string[]) {
  const root = mjsTmp('tunnel-host-reecrit')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'out'), { recursive: true })
  writeFileSync(join(root, 'src', 'home.mjs'), '<h1>Salut</h1>')
  writeFileSync(join(root, 'out', 'manifest.js'), 'µ.paths = {};\nµ.version = "abcd1234";\n')
  writeFileSync(join(root, 'serve.server.mjs'), FIXTURE)
  const config: any = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/manifest.js', render: { routes: { '/p/:id': { component: 'mjs-page', mode: 'csr' as const } } } }
  if (dev) config.dev = dev
  if (allowedOrigins) config.render.allowedOrigins = allowedOrigins
  return { root, config }
}

// `mjs dev` câblé comme cli.ts : rechargement à chaud actif, entrée serveur branchée
async function dev(allowedHosts?: string[] | true, allowedOrigins?: string[]) {
  const { root, config } = projet(allowedHosts === undefined ? undefined : { allowedHosts }, allowedOrigins)
  const entry  = await createServeEntry(config, root)
  const server = new StaticServer({ rootDir: join(root, 'out'), port: 0, host: '127.0.0.1', hmr: true, config, configDir: root, manifestPath: join(root, 'out', 'manifest.js'), entry: entry ?? undefined })
  await server.start()
  const port = (server.server!.address() as any).port
  return { port, close: async () => { await server.stop(); entry?.close() } }
}

// connexion au rechargement à chaud telle qu'elle arrive par le tunnel : Host réécrit, origine de la page
function connecter(port: number, host: string, origin: string): Promise<string> {
  return new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__mjs_hmr`, { headers: { host, origin } })
    ws.on('message', (m) => { ok(String(m)); ws.close() })
    ws.on('close', (code, raison) => ok(`fermé ${code} ${String(raison)}`))
    ws.on('error', (e) => ok('erreur ' + e.message))
  })
}

function envoyer(port: number, host: string, origin: string): Promise<{ status: number, body: string }> {
  return new Promise((ok, ko) => {
    const r = request({ host: '127.0.0.1', port, path: '/p/42', method: 'POST', headers: { host, origin, 'content-type': 'application/x-www-form-urlencoded' } }, (x) => {
      let body = ''
      x.setEncoding('utf-8')
      x.on('data', (c) => { body += c })
      x.on('end', () => ok({ status: x.statusCode!, body }))
    })
    r.on('error', ko)
    r.end('name=ok')
  })
}

// avertissements du terminal releves pendant `fn`
async function avertissements(fn: () => Promise<void> | void): Promise<string[]> {
  const releves: string[] = []
  const warn = console.warn
  console.warn = (m: unknown) => { releves.push(String(m)) }
  try { await fn() }
  finally { console.warn = warn }
  return releves
}

describe('tunnel qui réécrit l\'en-tête Host — origine admise par dev.allowedHosts', () => {
  it('Host réécrit : l\'origine du tunnel est admise par son nom exact, refusée sans dev.allowedHosts', () => {
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, 'localhost', '127.0.0.1', [TUNNEL]), true)
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, 'localhost:3939', '127.0.0.1', [TUNNEL]), true)
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, '127.0.0.1:3939', '127.0.0.1', [MOTIF, TUNNEL]), true)
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, 'localhost:3939', '127.0.0.1'), false)
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, 'localhost:3939', '127.0.0.1', []), false)
  })

  it('Host réécrit : une entrée .domaine ne suffit pas, un autre utilisateur du domaine partagé passerait aussi', () => {
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, 'localhost:3939', '127.0.0.1', [MOTIF]), false)
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, '[::1]:3939', '127.0.0.1', [MOTIF]), false)
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, '192.168.1.20:3939', '0.0.0.0', [MOTIF]), false)
    assert.equal(hmr.isAcceptedHmrOrigin('https://autre.ngrok-free.app', 'localhost:3939', '127.0.0.1', [MOTIF]), false)
    assert.equal(hmr.isAcceptedHmrOrigin('https://autre.ngrok-free.app', TUNNEL, '127.0.0.1', [MOTIF]), false)
  })

  it('une origine étrangère reste refusée, même avec la liste', () => {
    assert.equal(hmr.isAcceptedHmrOrigin('https://evil.example', 'localhost:3939', '127.0.0.1', [MOTIF, TUNNEL]), false)
    assert.equal(hmr.isAcceptedHmrOrigin('https://ngrok-free.app.evil.example', 'localhost:3939', '127.0.0.1', [MOTIF]), false)
    assert.equal(hmr.isAcceptedHmrOrigin('https://x.' + TUNNEL, 'localhost:3939', '127.0.0.1', [TUNNEL]), false)
    assert.equal(hmr.isAcceptedHmrOrigin('ftp://' + TUNNEL, 'localhost:3939', '127.0.0.1', [TUNNEL]), false)
    assert.equal(hmr.isAcceptedHmrOrigin('null', 'localhost:3939', '127.0.0.1', [TUNNEL]), false)
  })

  it('true : tout Host admis, pas toute origine — une page d\'un autre nom que Host est refusée, celle du tunnel comprise', () => {
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, 'localhost:3939', '127.0.0.1', true), false)
    assert.equal(hmr.isAcceptedHmrOrigin('https://n-importe.example', '127.0.0.1:3939', '127.0.0.1', true), false)
    assert.equal(hmr.isAcceptedHmrOrigin('https://evil.example', 'localhost:3939', '127.0.0.1', true), false)
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, TUNNEL, '127.0.0.1', true), true)
    const garde = hmr.createDevOriginCheck(true)
    assert.equal(garde(PAGE, 'localhost:3939'), false)
    assert.equal(garde('https://evil.example', 'localhost:3939'), false)
    assert.equal(garde(PAGE, TUNNEL), true)
  })

  it('Host gardé : inchangé, l\'entrée .domaine vaut quand Host nomme l\'origine', () => {
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, TUNNEL, '127.0.0.1', [MOTIF]), true)
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, TUNNEL, '127.0.0.1', [TUNNEL]), true)
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, TUNNEL, '127.0.0.1'), false)
    assert.equal(hmr.isAcceptedHmrOrigin('http://localhost:5173', 'localhost:3939', '127.0.0.1'), true)
  })

  it('message de développement : le nom exact à écrire, une fois par nom dans le terminal, en français et en anglais', async () => {
    let refus: unknown
    const releves = await avertissements(() => {
      const garde = hmr.createDevOriginCheck([MOTIF])
      refus = garde(PAGE, 'localhost:3939')
      garde(PAGE, 'localhost:3939')
      assert.equal(garde(PAGE, TUNNEL), true)
      assert.equal(garde('https://evil.example', 'localhost:3939'), false)
      assert.equal(hmr.createDevOriginCheck([TUNNEL])(PAGE, 'localhost:3939'), true)
      assert.equal(hmr.createDevOriginCheck(true)(PAGE, 'localhost:3939'), false)
    })
    assert.equal(typeof refus, 'string')
    assert.match(String(refus), /« abc\.ngrok-free\.app »[\s\S]*« \.ngrok-free\.app »[\s\S]*nom exact[\s\S]*Ajoutez-le[\s\S]*"dev": \{ "allowedHosts": \["abc\.ngrok-free\.app"\] \}/)
    assert.deepEqual(releves, [refus])
    setMessagesLang('en')
    try {
      const anglais = await avertissements(() => { hmr.createDevOriginCheck([MOTIF])(PAGE, 'localhost:3939') })
      assert.match(anglais[0] ?? '', /“abc\.ngrok-free\.app”[\s\S]*exact name[\s\S]*"dev": \{ "allowedHosts": \["abc\.ngrok-free\.app"\] \}/)
    } finally {
      setMessagesLang('fr')
    }
  })

  it('Host en majuscules : il nomme la même origine, sans la casse', async () => {
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, 'ABC.NGROK-FREE.APP', '127.0.0.1', [MOTIF]), true)
    assert.equal(hmr.isAcceptedHmrOrigin(PAGE, 'Abc.Ngrok-Free.App', '127.0.0.1', true), true)
    assert.equal(hmr.isAcceptedHmrOrigin('https://autre.ngrok-free.app', 'ABC.NGROK-FREE.APP', '127.0.0.1', [MOTIF]), false)
    const garde = hmr.createDevOriginCheck([MOTIF])
    assert.equal(garde(PAGE, 'ABC.NGROK-FREE.APP'), true)
    let refus: unknown
    const releves = await avertissements(() => { refus = garde(PAGE, 'LOCALHOST:3939') })
    assert.equal(typeof refus, 'string')
    assert.equal(releves.length, 1)
  })

  it('le message du nom exact ne paraît que si le Host reçu est local (réécrit par un tunnel) : Host gardé, la page d\'un autre utilisateur du domaine est refusée sans proposer son nom', async () => {
    const garde = hmr.createDevOriginCheck([MOTIF])
    const autre = 'https://evil.ngrok-free.app'
    let gardes: unknown[] = []
    let locaux: unknown[] = []
    const releves = await avertissements(() => {
      gardes = [TUNNEL, TUNNEL + ':443', '192.168.1.20:3939', 'mon-proxy.example'].map(h => garde(autre, h))
      locaux = ['localhost:3939', '127.0.0.1:3939', '[::1]:3939', 'app.localhost:3939'].map(h => garde(autre, h))
    })
    assert.deepEqual(gardes, [false, false, false, false])
    assert.deepEqual(locaux.map(v => typeof v), ['string', 'string', 'string', 'string'])
    assert.equal(releves.length, 1)
    assert.match(releves[0], /"allowedHosts": \["evil\.ngrok-free\.app"\]/)
  })

  it('terminal : vingt noms signalés au plus, puis une ligne dit que les refus suivants sont tus ; la réponse garde son message', async () => {
    const garde    = hmr.createDevOriginCheck([MOTIF])
    const reponses: unknown[] = []
    const releves  = await avertissements(() => {
      for (let i = 0; i < 50; i++) reponses.push(garde(`https://n${i}.ngrok-free.app`, 'localhost:3939'))
      garde('https://n0.ngrok-free.app', 'localhost:3939')
      garde('https://n49.ngrok-free.app', 'localhost:3939')
    })
    assert.equal(releves.length, 21)
    assert.match(releves[19], /n19\.ngrok-free\.app/)
    assert.doesNotMatch(releves[20], /n20\.ngrok-free\.app/)
    assert.match(releves[20], /20 noms[\s\S]*ne sont plus affichés/)
    assert.equal(reponses.length, 50)
    assert.ok(reponses.every(r => typeof r === 'string' && r.includes('nom exact')))
    setMessagesLang('en')
    try {
      const anglais = await avertissements(() => {
        const g = hmr.createDevOriginCheck([MOTIF])
        for (let i = 0; i < 21; i++) g(`https://n${i}.ngrok-free.app`, 'localhost:3939')
      })
      assert.equal(anglais.length, 21)
      assert.match(anglais[20], /20 names[\s\S]*no longer shown/)
    } finally {
      setMessagesLang('fr')
    }
  })

  it('mjs dev : rechargement à chaud par le tunnel qui réécrit Host — connecté avec le nom exact, fermé avec .domaine seul (avertissement) ou true, sans dev.allowedHosts ou pour une page étrangère', async function () {
    this.timeout(20000)
    const exact = await dev([TUNNEL])
    const motif = await dev([MOTIF])
    const tout  = await dev(true)
    const sans  = await dev()
    try {
      assert.equal(await connecter(exact.port, 'localhost:' + exact.port, PAGE), '{"type":"connected"}')
      assert.equal(await connecter(motif.port, TUNNEL, PAGE), '{"type":"connected"}')
      assert.equal(await connecter(tout.port, TUNNEL, PAGE), '{"type":"connected"}')
      let ferme = ''
      const releves = await avertissements(async () => { ferme = await connecter(motif.port, 'localhost:' + motif.port, PAGE) })
      assert.equal(ferme, 'fermé 1008 Origin not allowed')
      assert.equal(releves.length, 1)
      assert.match(releves[0], /"allowedHosts": \["abc\.ngrok-free\.app"\]/)
      assert.equal(await connecter(tout.port, 'localhost:' + tout.port, PAGE), 'fermé 1008 Origin not allowed')
      assert.equal(await connecter(tout.port, 'localhost:' + tout.port, 'https://evil.example'), 'fermé 1008 Origin not allowed')
      assert.equal(await connecter(exact.port, 'localhost:' + exact.port, 'https://evil.example'), 'fermé 1008 Origin not allowed')
      assert.equal(await connecter(sans.port, 'localhost:' + sans.port, PAGE), 'fermé 1008 Origin not allowed')
    } finally {
      for (const s of [exact, motif, tout, sans]) await s.close()
    }
  })

  it('mjs dev : formulaire par le tunnel qui réécrit Host — 303 avec le nom exact, 403 avec .domaine seul (message du nom exact) ou true, sans dev.allowedHosts ou pour une page étrangère', async function () {
    this.timeout(20000)
    const exact = await dev([TUNNEL])
    const motif = await dev([MOTIF])
    const tout  = await dev(true)
    const sans  = await dev()
    try {
      assert.equal((await envoyer(exact.port, 'localhost:' + exact.port, PAGE)).status, 303)
      assert.equal((await envoyer(motif.port, TUNNEL, PAGE)).status, 303)
      assert.equal((await envoyer(tout.port, TUNNEL, PAGE)).status, 303)
      let refus = { status: 0, body: '' }
      await avertissements(async () => { refus = await envoyer(motif.port, 'localhost:' + motif.port, PAGE) })
      assert.equal(refus.status, 403)
      assert.match(refus.body, /nom exact[\s\S]*"dev": \{ "allowedHosts": \["abc\.ngrok-free\.app"\] \}/)
      assert.deepEqual(await envoyer(tout.port, 'localhost:' + tout.port, PAGE), { status: 403, body: 'Forbidden' })
      assert.deepEqual(await envoyer(tout.port, 'localhost:' + tout.port, 'https://evil.example'), { status: 403, body: 'Forbidden' })
      assert.deepEqual(await envoyer(exact.port, 'localhost:' + exact.port, 'https://evil.example'), { status: 403, body: 'Forbidden' })
      assert.equal((await envoyer(sans.port, 'localhost:' + sans.port, PAGE)).status, 403)
    } finally {
      for (const s of [exact, motif, tout, sans]) await s.close()
    }
  })

  it('mjs dev, Host gardé : la page d\'un autre utilisateur du domaine est refusée sans proposer son nom, au rechargement comme au formulaire', async function () {
    this.timeout(20000)
    const motif = await dev([MOTIF])
    try {
      const autre = 'https://evil.ngrok-free.app'
      let ferme = ''
      let refus = { status: 0, body: '' }
      const releves = await avertissements(async () => {
        ferme = await connecter(motif.port, TUNNEL, autre)
        refus = await envoyer(motif.port, TUNNEL, autre)
      })
      assert.equal(ferme, 'fermé 1008 Origin not allowed')
      assert.deepEqual(refus, { status: 403, body: 'Forbidden' })
      assert.deepEqual(releves, [])
    } finally {
      await motif.close()
    }
  })

  it('mjs dev : un Host en majuscules nomme la même origine, au rechargement comme au formulaire', async function () {
    this.timeout(20000)
    const motif = await dev([MOTIF])
    try {
      assert.equal(await connecter(motif.port, 'ABC.NGROK-FREE.APP', PAGE), '{"type":"connected"}')
      assert.equal((await envoyer(motif.port, 'ABC.NGROK-FREE.APP', PAGE)).status, 303)
    } finally {
      await motif.close()
    }
  })

  it('mjs dev : une origine que render.allowedOrigins admet passe sans avertissement de la garde de développement', async function () {
    this.timeout(20000)
    const srv = await dev([MOTIF], [PAGE])
    try {
      let reponse = { status: 0, body: '' }
      const releves = await avertissements(async () => { reponse = await envoyer(srv.port, 'localhost:' + srv.port, PAGE) })
      assert.equal(reponse.status, 303)
      assert.deepEqual(releves, [])
    } finally {
      await srv.close()
    }
  })

  it('mjs serve : dev.allowedHosts n\'ouvre pas la garde d\'origine des formulaires', async function () {
    this.timeout(20000)
    const { root, config } = projet({ allowedHosts: [TUNNEL] })
    const running = await startRenderServer(config, root, { port: 0 })
    try {
      assert.deepEqual(await envoyer(running.port, 'localhost:' + running.port, PAGE), { status: 403, body: 'Forbidden' })
      assert.equal((await envoyer(running.port, 'localhost:' + running.port, 'http://localhost:' + running.port)).status, 303)
    } finally {
      await running.close()
    }
  })
})
