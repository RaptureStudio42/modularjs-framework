// atelier des thèmes (POST /__mjs/theme/write) : seule la machine elle-même enregistre dans le source — l'en-tête Origin s'écrit à la
// main hors d'un navigateur (curl), depuis un autre poste du réseau (`dev.host: "0.0.0.0"`) comme derrière un mandataire ; aucun fichier
// d'un dossier caché (`.git`) ni de `node_modules` n'est réécrit ; l'atelier ouvert sous `app.localhost` (hôte admis par mjs dev)
// enregistre comme sous `localhost`. Les requêtes entrent par handle(), le pair posé à la main : aucun port ouvert hors du dernier cas,
// un vrai mjs dev sur 127.0.0.1
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { StaticServer } from '../src/server/index.js'
import { getMessagesLang, setMessagesLang, t } from '../src/messages/index.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE   = '  $$accent: #3b82f6\n'

after(() => sweepRegistered())

async function ecrire(server: StaticServer, pair: string, entetes: Record<string, string>, corps: Record<string, unknown>) {
  const req: any = Readable.from([Buffer.from(JSON.stringify(corps))])
  req.method     = 'POST'
  req.url        = '/__mjs/theme/write'
  req.headers    = { 'content-type': 'text/plain', ...entetes }
  req.socket     = { remoteAddress: pair }
  let texte      = ''
  const res: any = { statusCode: 200, headersSent: false, setHeader() {}, getHeader() {}, once() {}, on() {}, end(c?: unknown) { texte = String(c ?? '') } }
  await (server as any).handle(req, res)
  return { status: res.statusCode as number, texte }
}

describe('atelier des thèmes — seule la machine elle-même enregistre dans le source', function () {
  let root = ''
  let server: StaticServer
  const corps = { name: 'accent', value: '#ff0000', file: 'src/carte.mjs', line: 1 }
  const lu    = (f: string) => readFileSync(join(root, f), 'utf-8')

  beforeEach(function () {
    root = mjsTmp('theme-write-pair')
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'node_modules', 'paquet'), { recursive: true })
    for (const f of ['src/carte.mjs', '.git/essai', 'node_modules/paquet/carte.mjs']) writeFileSync(join(root, f), SOURCE)
    server = new StaticServer({ rootDir: root, projectRoot: root, host: '0.0.0.0', config: { dev: { allowedHosts: ['192.168.1.5'] } } as any })
  })

  it('un autre poste du réseau qui écrit lui-même « Origin: http://localhost » n\'enregistre pas, et la réponse dit pourquoi', async function () {
    const r = await ecrire(server, '192.168.1.77', { host: '192.168.1.5:3939', origin: 'http://localhost' }, corps)
    assert.equal(lu('src/carte.mjs'), SOURCE, `source réécrit par un autre poste : ${r.status} ${r.texte}`)
    assert.equal(r.status, 403)
    assert.deepEqual(JSON.parse(r.texte), { written: false, reason: 'local-machine-only' })
  })

  it('le visiteur d\'un mandataire local (pair local, X-Forwarded-For) n\'enregistre pas', async function () {
    const r = await ecrire(server, '127.0.0.1', { host: 'localhost:3939', origin: 'http://localhost', 'x-forwarded-for': '203.0.113.9' }, corps)
    assert.equal(lu('src/carte.mjs'), SOURCE, `source réécrit au bout d'un tunnel : ${r.status} ${r.texte}`)
    assert.equal(r.status, 403)
    assert.equal(JSON.parse(r.texte).reason, 'local-machine-only')
  })

  // en-têtes par lesquels un mandataire se signale, chacun seul, pair 127.0.0.1 : un mandataire local devant mjs dev
  const MANDATAIRE: Record<string, string> = { forwarded: 'for=203.0.113.9;proto=https', 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9', 'x-forwarded-host': 'abc.example', 'x-forwarded-proto': 'https', via: '1.1 caddy', 'cf-connecting-ip': '203.0.113.9', 'true-client-ip': '203.0.113.9' }
  for (const [entete, valeur] of Object.entries(MANDATAIRE)) {
    it(`un mandataire local qui ne pose que « ${entete} » n'enregistre pas`, async function () {
      const r = await ecrire(server, '127.0.0.1', { host: 'localhost:3939', origin: 'http://localhost:3939', [entete]: valeur }, corps)
      assert.equal(lu('src/carte.mjs'), SOURCE, `source réécrit derrière « ${entete} » : ${r.status} ${r.texte}`)
      assert.equal(r.status, 403)
      assert.equal(JSON.parse(r.texte).reason, 'local-machine-only')
    })
  }

  for (const file of ['.git/essai', 'node_modules/paquet/carte.mjs']) {
    it(`${file} n'est jamais réécrit, même depuis la machine`, async function () {
      const r = await ecrire(server, '127.0.0.1', { host: 'localhost:3939', origin: 'http://localhost:3939' }, { ...corps, file })
      assert.equal(lu(file), SOURCE, `réécrit : ${r.texte}`)
      assert.equal(JSON.parse(r.texte).reason, 'outside-project')
    })
  }

  for (const pair of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    it(`l'atelier ouvert sur la machine (pair ${pair}) enregistre toujours`, async function () {
      const r = await ecrire(server, pair, { host: 'localhost:3939', origin: 'http://localhost:3939' }, corps)
      assert.equal(r.status, 200, r.texte)
      assert.equal(JSON.parse(r.texte).written, true, r.texte)
      assert.equal(lu('src/carte.mjs'), '  $$accent: #ff0000\n')
    })
  }

  it('l\'atelier ouvert sous app.localhost (hôte admis par mjs dev) enregistre comme sous localhost', async function () {
    const r = await ecrire(server, '127.0.0.1', { host: 'app.localhost:3939', origin: 'http://app.localhost:3939' }, corps)
    assert.equal(r.status, 200, r.texte)
    assert.equal(JSON.parse(r.texte).written, true, r.texte)
  })

  it('une page d\'un autre site n\'enregistre pas, même ouverte sur la machine', async function () {
    const r = await ecrire(server, '127.0.0.1', { host: 'localhost:3939', origin: 'http://evil.example' }, corps)
    assert.equal(r.status, 403)
    assert.equal(lu('src/carte.mjs'), SOURCE)
  })

  it('l\'atelier traduit le motif du refus, en français et en anglais', function () {
    const avant = getMessagesLang()
    setMessagesLang('fr')
    const fr = t('viewer.theme.pattern-machine-only' as any)
    setMessagesLang('en')
    const en = t('viewer.theme.pattern-machine-only' as any)
    setMessagesLang(avant)
    assert.equal(fr, 'L\'atelier n\'enregistre dans le source que depuis la machine elle-même : ni depuis un autre poste, ni par un mandataire qui se signale.')
    assert.equal(en, 'The theme workshop only writes to the source from this machine itself: not from another computer, nor through a proxy that announces itself.')
    assert.match(readFileSync(join(repoRoot, 'src', 'server', 'theme-viewer.mjs'), 'utf-8'), /'local-machine-only': +⟪theme\.pattern-machine-only⟫/)
  })
})

describe('atelier des thèmes — un vrai mjs dev sur 127.0.0.1 enregistre pour la machine', function () {
  this.timeout(60000)

  it('POST depuis la machine (Origin http://localhost:<port>) : la couleur est écrite dans le composant', async function () {
    const root = mjsTmp('theme-write-dev')
    mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
    writeFileSync(join(root, 'app', 'modularjs', 'carte.mjs'), '<p>carte</p>\n\n<style>\n  $$accent: #3b82f6\n  p\n    color: $$accent\n</style>\n')
    const libre = createServer()
    await new Promise<void>((ok) => libre.listen(0, '127.0.0.1', () => ok()))
    const port = (libre.address() as AddressInfo).port
    await new Promise<void>((ok) => libre.close(() => ok()))
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out', dev: { port, host: '127.0.0.1' } }))
    const child = spawn(join(repoRoot, 'node_modules', '.bin', 'tsx'), [join(repoRoot, 'src', 'cli.ts'), 'dev', '--root', root], { cwd: root, env: { ...process.env, NO_COLOR: '1' } })
    let sortie  = ''
    child.stdout.on('data', (d) => { sortie += d })
    child.stderr.on('data', (d) => { sortie += d })
    const base = `http://127.0.0.1:${port}`
    try {
      for (let i = 0; ; i++) {
        if (child.exitCode !== null || i > 120) assert.fail('mjs dev n\'écoute pas :\n' + sortie)
        try { await fetch(base + '/'); break } catch { await new Promise((ok) => setTimeout(ok, 250)) }
      }
      const r    = await fetch(base + '/__mjs/theme/write', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}` }, body: JSON.stringify({ name: 'accent', value: '#ff0000', file: 'app/modularjs/carte.mjs', line: 4 }) })
      const recu = await r.json()
      assert.equal(recu.written, true, JSON.stringify(recu) + '\n' + sortie)
      assert.match(readFileSync(join(root, 'app', 'modularjs', 'carte.mjs'), 'utf-8'), /^ {2}\$\$accent: #ff0000$/m)
    }
    finally {
      if (child.exitCode === null) {
        const fin = new Promise((ok) => child.once('exit', ok))
        child.kill('SIGTERM')
        await fin
      }
    }
  })
})
