// `mjs mcp` : le serveur MCP (Model Context Protocol) de MJS, en stdio — JSON-RPC 2.0, un message par ligne, rien d'autre
// sur la sortie standard. Une session complète, comme un assistant d'IA la mène : initialisation (version du protocole
// négociée, nom et version de MJS), notification `initialized` (sans réponse), liste des outils, puis chaque outil — chercher
// dans la doc, lire une page de doc, compiler un composant, lister les erreurs de la page d'un `mjs dev` en cours, lister les
// composants, lister les routes —, les erreurs du protocole (méthode inconnue, outil inconnu, JSON illisible), et la sortie
// propre quand l'entrée se ferme

import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION  = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version as string
const TOOLS    = ['compile_component', 'list_components', 'list_routes', 'page_errors', 'read_doc', 'search_docs']

function projet(): string {
  const root = mjsTmp('mcp')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', render: { routes: { '/': { component: 'mjs-accueil', mode: 'prerender' } } } }, null, 2))
  writeFileSync(join(root, 'app', 'modularjs', 'image.mjs'), '<img src="a.png">\n')
  writeFileSync(join(root, 'app', 'modularjs', 'accueil.mjs'), '<p>accueil</p>\n')
  writeFileSync(join(root, 'app', 'modularjs', 'app.page.mjs'), '<routes target="app-view">\n  /          home-page\n  /guide/:id guide-page\n</routes>\n<@view id="app-view"/>\n')
  return root
}

// client JSON-RPC minimal : une requête par ligne, réponses rangées par id, chaque ligne de la sortie lue comme du JSON
class Client {
  private buffer  = ''
  private waiting = new Map<number | string | null, (msg: any) => void>()
  readonly lines  = [] as string[]
  stderr          = ''
  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => { this.stderr += d })
    child.stdout.on('data', (d) => {
      this.buffer += d
      let i
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line  = this.buffer.slice(0, i)
        this.buffer = this.buffer.slice(i + 1)
        this.lines.push(line)
        const msg = JSON.parse(line)
        this.waiting.get(msg.id)?.(msg)
        this.waiting.delete(msg.id)
      }
    })
  }
  raw(text: string, id: number | string | null): Promise<any> {
    const reponse = new Promise<any>((ok, ko) => {
      const minuterie = setTimeout(() => ko(new Error(`pas de réponse à ${text}\nstderr :\n${this.stderr}`)), 20000)
      this.waiting.set(id, (msg) => { clearTimeout(minuterie); ok(msg) })
    })
    this.child.stdin.write(text + '\n')
    return reponse
  }
  request(id: number, method: string, params?: unknown): Promise<any> {
    return this.raw(JSON.stringify({ jsonrpc: '2.0', id, method, params }), id)
  }
  notify(method: string, params?: unknown): void {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }
}

describe('cli.ts — mjs mcp : une session MCP complète en stdio', function () {
  this.timeout(120000)

  let client: Client
  let erreurs: Server
  let portErreurs: number
  let n      = 10
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.request(n++, 'tools/call', { name, arguments: args })).result

  before(async () => {
    erreurs = createServer((req, res) => {
      if (req.url === '/__mjs/errors.json') {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify([{ source: 'client', message: 'TypeError: x is undefined', component: 'mjs-image' }]))
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((ok) => erreurs.listen(0, '127.0.0.1', () => ok()))
    portErreurs = (erreurs.address() as { port: number }).port
    const child = spawn(join(repoRoot, 'node_modules', '.bin', 'tsx'), [join(repoRoot, 'src', 'cli.ts'), 'mcp', '--root', projet()], { cwd: repoRoot, env: { ...process.env, NO_COLOR: '1' } })
    client      = new Client(child)
  })

  after(async () => {
    if (client.child.exitCode === null) client.child.kill('SIGTERM')
    await new Promise<void>((ok) => erreurs.close(() => ok()))
  })

  it('initialize : la version du protocole demandée, le nom et la version de MJS, les outils annoncés', async () => {
    const r = await client.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'essai', version: '1.0.0' } })
    assert.equal(r.jsonrpc, '2.0')
    assert.equal(r.result.protocolVersion, '2025-06-18')
    assert.equal(r.result.serverInfo.name, 'modularjs')
    assert.equal(r.result.serverInfo.version, VERSION)
    assert.ok(r.result.capabilities.tools, 'capacité tools')
    assert.match(r.result.instructions ?? '', /llms\.txt/, 'les consignes disent où commencer')
    client.notify('notifications/initialized')
  })

  it('une version de protocole inconnue : le serveur répond avec la sienne', async () => {
    const r = await client.request(2, 'initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'essai', version: '1' } })
    assert.match(r.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/)
    assert.notEqual(r.result.protocolVersion, '1999-01-01')
  })

  it('ping, puis tools/list : les six outils, chacun décrit avec son schéma', async () => {
    assert.deepEqual((await client.request(3, 'ping')).result, {})
    const r = await client.request(4, 'tools/list')
    assert.deepEqual(r.result.tools.map((o: { name: string }) => o.name).sort(), TOOLS)
    for (const o of r.result.tools) {
      assert.ok(o.description.length > 20, `${o.name} décrit`)
      assert.equal(o.inputSchema.type, 'object', `${o.name} : schéma objet`)
    }
  })

  it('search_docs : la page et la section qui parlent du sujet, avec un extrait', async () => {
    const r = await call('search_docs', { query: ':group' })
    assert.notEqual(r.isError, true)
    const pages = r.structuredContent.results.map((x: { page: string }) => x.page)
    assert.ok(pages.includes('07-bindings.md'), `07-bindings.md trouvée : ${pages.join(', ')}`)
    const hit = r.structuredContent.results[0]
    assert.equal(typeof hit.section, 'string')
    assert.equal(typeof hit.line, 'number')
    assert.match(hit.excerpt, /:group/i)
    assert.equal(r.content[0].type, 'text')
  })

  it('read_doc : une page entière, ou une seule section ; page inconnue → erreur qui liste les pages', async () => {
    const page = await call('read_doc', { page: '17-router' })
    assert.match(page.content[0].text, /^# 17/)
    const section = await call('read_doc', { page: '17-router.md', section: 'zone `<@view>`' })
    assert.match(section.content[0].text, /^## La zone `<@view>`/)
    assert.doesNotMatch(section.content[0].text, /^## Layouts/m, 'la section seule, pas la suivante')
    const inconnue = await call('read_doc', { page: 'n-existe-pas' })
    assert.equal(inconnue.isError, true)
    assert.match(inconnue.content[0].text, /01-introduction\.md/)
  })

  it('compile_component : un fichier du projet, ou une source ; erreurs et avertissements à la forme de mjs check --json', async () => {
    const fichier = await call('compile_component', { file: 'app/modularjs/image.mjs' })
    assert.equal(fichier.structuredContent.ok, true)
    const a11y = fichier.structuredContent.warnings.find((w: { type: string }) => w.type === 'a11y')
    assert.ok(a11y, JSON.stringify(fichier.structuredContent))
    assert.equal(a11y.file, 'app/modularjs/image.mjs')
    assert.equal(a11y.line, 1)
    const source = await call('compile_component', { source: '<p>{if $x}oui</p>\n', name: 'essai' })
    assert.equal(source.structuredContent.ok, false)
    assert.equal(source.structuredContent.errors[0].line, 1)
    assert.match(source.structuredContent.errors[0].fix ?? '', /\{end\}/)
    const rien = await call('compile_component', {})
    assert.equal(rien.isError, true)
  })

  it('page_errors : le journal d\'erreurs du mjs dev en cours ; aucun serveur → erreur qui dit de lancer mjs dev', async () => {
    const r = await call('page_errors', { port: portErreurs })
    assert.notEqual(r.isError, true, JSON.stringify(r))
    assert.equal(r.structuredContent.entries[0].message, 'TypeError: x is undefined')
    const libre  = await new Promise<number>((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)) }) })
    const absent = await call('page_errors', { port: libre })
    assert.equal(absent.isError, true)
    assert.match(absent.content[0].text, /mjs dev/)
  })

  it('list_components : nom, balise, fichier, page ou non', async () => {
    const r     = await call('list_components')
    const image = r.structuredContent.components.find((c: { name: string }) => c.name === 'image')
    assert.deepEqual(image, { name: 'image', tag: 'mjs-image', file: 'app/modularjs/image.mjs', page: false })
    const app = r.structuredContent.components.find((c: { name: string }) => c.name === 'app')
    assert.equal(app.page, true)
  })

  it('list_routes : les pages de render.routes et les routes des blocs <routes>', async () => {
    const r = await call('list_routes')
    assert.deepEqual(r.structuredContent.pages, [{ path: '/', component: 'mjs-accueil', mode: 'prerender' }])
    assert.deepEqual(r.structuredContent.views, [{ file: 'app/modularjs/app.page.mjs', target: 'app-view', routes: [{ path: '/', component: 'home-page' }, { path: '/guide/:id', component: 'guide-page' }] }])
  })

  it('erreurs du protocole : méthode inconnue, outil inconnu, JSON illisible', async () => {
    assert.equal((await client.request(90, 'n/existe/pas')).error.code, -32601)
    assert.equal((await client.request(91, 'tools/call', { name: 'outil_absent', arguments: {} })).error.code, -32602)
    assert.equal((await client.raw('{ pas du json', null)).error.code, -32700)
  })

  it('rien d\'autre que du JSON-RPC sur la sortie standard ; entrée fermée → sortie en code 0', async () => {
    for (const l of client.lines) assert.equal(JSON.parse(l).jsonrpc, '2.0', l)
    const code = await new Promise<number | null>((ok) => { client.child.once('exit', (c) => ok(c)); client.child.stdin.end() })
    assert.equal(code, 0, client.stderr)
  })
})

// un serveur MCP neuf, sur le projet donné
function lance(root: string): Client {
  return new Client(spawn(join(repoRoot, 'node_modules', '.bin', 'tsx'), [join(repoRoot, 'src', 'cli.ts'), 'mcp', '--root', root], { cwd: repoRoot, env: { ...process.env, NO_COLOR: '1' } }))
}

// le jeton du journal (« journal.viewer ») protège aussi le journal de production : il ne part que vers le mjs dev de ce
// projet, sur la boucle locale, au port du projet ; tout autre hôte est refusé, sans la moindre requête
describe('cli.ts — mjs mcp : page_errors ne donne le jeton du journal qu\'au mjs dev du projet', function () {
  this.timeout(120000)

  const recus    = [] as string[]
  const ecoutes  = [] as Server[]
  let client: Client
  let portProjet: number
  let autrePort: number
  let portTiers: number
  let n          = 1
  const call     = async (args: Record<string, unknown>) => (await client.request(n++, 'tools/call', { name: 'page_errors', arguments: args })).result
  const ecoute   = (host: string) => new Promise<number>((ok) => {
    const s = createServer((req, res) => {
      recus.push(`${host}:${(s.address() as { port: number }).port} ${req.url}`)
      res.setHeader('Content-Type', 'application/json')
      res.end('[]')
    })
    ecoutes.push(s)
    s.listen(0, host, () => ok((s.address() as { port: number }).port))
  })

  before(async () => {
    portProjet = await ecoute('127.0.0.1')
    autrePort  = await ecoute('127.0.0.1')
    portTiers  = await ecoute('127.0.0.2')
    const root = mjsTmp('mcp-jeton')
    mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
    writeFileSync(join(root, 'app', 'modularjs', 'accueil.mjs'), '<p>accueil</p>\n')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', dev: { port: portProjet }, journal: { viewer: 'JETON-SECRET' } }))
    client = lance(root)
    await client.request(0, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'essai', version: '1' } })
  })

  after(async () => {
    if (client.child.exitCode === null) client.child.kill('SIGTERM')
    for (const s of ecoutes) await new Promise<void>((ok) => s.close(() => ok()))
  })

  it('le mjs dev du projet (port de mjs.config.json ; 127.0.0.1, ::1 ou localhost) reçoit le jeton', async () => {
    assert.notEqual((await call({})).isError, true)
    assert.notEqual((await call({ host: 'localhost' })).isError, true)
    assert.deepEqual(recus, [`127.0.0.1:${portProjet} /__mjs/errors.json?token=JETON-SECRET`, `127.0.0.1:${portProjet} /__mjs/errors.json?token=JETON-SECRET`])
  })

  it('un autre hôte est refusé avec un message clair, sans requête : 127.0.0.2, un nom, 0.0.0.0', async () => {
    recus.length = 0
    for (const host of ['127.0.0.2', 'exemple.invalid', '0.0.0.0']) {
      const r = await call({ host, port: portTiers })
      assert.equal(r.isError, true, host)
      assert.match(r.content[0].text, /127\.0\.0\.1, ::1 ou localhost/, host)
    }
    assert.deepEqual(recus, [])
  })

  it('un autre port que celui du projet : le jeton ne part pas, l\'outil dit pourquoi', async () => {
    recus.length = 0
    const r = await call({ port: autrePort })
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, new RegExp(`journal\\.viewer[\\s\\S]*${portProjet}`))
    assert.deepEqual(recus, [])
  })
})

// une requête ne bloque pas le serveur : search_docs borné (nombre de mots, longueur), et un lien du projet qui mène dehors
// n'est pas suivi
describe('cli.ts — mjs mcp : bornes de search_docs, liens qui mènent hors du projet ou de la doc', function () {
  this.timeout(120000)

  let client: Client
  let n      = 1
  const call = async (name: string, args: Record<string, unknown>) => (await client.request(n++, 'tools/call', { name, arguments: args })).result

  before(async () => {
    const root   = projet()
    const dehors = mjsTmp('mcp-dehors')
    writeFileSync(join(dehors, 'secret.mjs'), '<p>secret hors du projet</p>\n')
    symlinkSync(join(dehors, 'secret.mjs'), join(root, 'app', 'modularjs', 'lien.mjs'))
    client = lance(root)
    await client.request(0, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'essai', version: '1' } })
  })

  after(() => {
    if (client.child.exitCode === null) client.child.kill('SIGTERM')
  })

  it('search_docs : plus de 20 mots ou plus de 500 caractères → refus clair, tout de suite ; 20 mots passent', async () => {
    const debut = Date.now()
    const mots  = await call('search_docs', { query: Array.from({ length: 21 }, (_, i) => 'mot' + i).join(' ') })
    assert.equal(mots.isError, true)
    assert.match(mots.content[0].text, /21 mots[\s\S]*20 au plus/)
    const long = await call('search_docs', { query: 'a'.repeat(501) })
    assert.equal(long.isError, true)
    assert.match(long.content[0].text, /501 caractères[\s\S]*500 au plus/)
    const enorme = await call('search_docs', { query: Array(20000).fill('e').join(' ') })
    assert.equal(enorme.isError, true)
    assert.ok(Date.now() - debut < 5000, `refus tout de suite : ${Date.now() - debut} ms`)
    const vingt = await call('search_docs', { query: 'a b c d e f g h i j k l m n o p q r s t' })
    assert.notEqual(vingt.isError, true, JSON.stringify(vingt).slice(0, 300))
  })

  it('compile_component : un fichier du projet qui est un lien vers le dehors n\'est pas lu', async () => {
    const r = await call('compile_component', { file: 'app/modularjs/lien.mjs' })
    assert.equal(r.isError, true, JSON.stringify(r).slice(0, 300))
    assert.match(r.content[0].text, /hors du projet/)
    assert.doesNotMatch(r.content[0].text, /secret/)
  })

  it('read_doc et search_docs : une page de la doc qui est un lien vers le dehors n\'en fait pas partie', async () => {
    const { docPages } = await import('../src/cli/mcp.js') as { docPages?: (dir: string) => string[] }
    assert.equal(typeof docPages, 'function', 'docPages exportée')
    const doc    = mjsTmp('mcp-doc')
    const dehors = mjsTmp('mcp-doc-dehors')
    writeFileSync(join(doc, 'a.md'), '# A\n')
    writeFileSync(join(dehors, 'secret.md'), '# Secret\n')
    symlinkSync(join(dehors, 'secret.md'), join(doc, 'b.md'))
    symlinkSync('a.md', join(doc, 'c.md'))
    assert.deepEqual(docPages!(doc), ['a.md', 'c.md'])
  })
})

// l'entrée se ferme (l'assistant quitte) : le serveur s'arrête vite, même avec des requêtes en file — personne ne lira plus
// leurs réponses
describe('cli.ts — mjs mcp : arrêt rapide quand l\'entrée se ferme', function () {
  this.timeout(120000)

  it('cent recherches en file puis entrée fermée : sortie en code 0 en moins de 4 s', async () => {
    const client = lance(projet())
    await client.request(0, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'essai', version: '1' } })
    const query = 'a b c d e f g h i j k l m n o p q r s t'
    for (let i = 1; i <= 100; i++) client.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'search_docs', arguments: { query } } }) + '\n')
    const debut = Date.now()
    const code  = await new Promise<number | null>((ok) => {
      const garde = setTimeout(() => { client.child.kill('SIGKILL'); ok(-1) }, 30000)
      client.child.once('exit', (c) => { clearTimeout(garde); ok(c) })
      client.child.stdin.end()
    })
    const duree = Date.now() - debut
    assert.equal(code, 0, client.stderr)
    assert.ok(duree < 4000, `arrêt en ${duree} ms après la fin de l'entrée (${client.lines.length - 1} réponses écrites)`)
  })
})
