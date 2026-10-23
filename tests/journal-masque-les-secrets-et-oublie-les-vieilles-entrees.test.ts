// Le journal des erreurs gardait tel quel ce qu'il recevait : URL à jeton (`?token=`, `#access_token=`), courriels, jetons
// `Bearer` ou JWT dans un message, et sans durée (seule l'éviction par nombre ou par taille les retirait). Il masque désormais
// jetons et courriels à l'écriture (la signature et le fichier sur le disque non plus ne les contiennent) et oublie une entrée
// restée sans nouvelle occurrence au-delà de `journal.maxDays` (30 jours par défaut). Le jeton de la visionneuse, lui, ne
// voyage plus que la première fois dans l'adresse : la page le change en cookie de session (HttpOnly, SameSite=Strict), le
// retire de la barre d'adresse, et ne laisse partir aucun Referer.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createJournal } from '../src/server/journal.js'
import { startRenderServer } from '../src/server/render-server.js'
import { StaticServer } from '../src/server/index.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

after(() => sweepRegistered())

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'

describe('journal — jetons et courriels masqués à l\'écriture', () => {
  it('URL, message et pile : jetons, JWT, Bearer et courriels remplacés, le reste intact', () => {
    const dir = mjsTmp('journal-masque')
    const j   = createJournal({ dir })
    j.record('client', {
      message: `échec pour jean.dupont@exemple.fr (Authorization: Bearer abcdef0123456789) jeton ${JWT}`,
      pile:    'at https://site.test/compte?session=s3cr3t&onglet=2:10:5',
      url:     'https://site.test/reinit?token=t0k3n-123&page=2&api_key=K3Y#access_token=zzz999',
    })
    j.close()
    const [e] = j.list()
    assert.equal(e.url, 'https://site.test/reinit?token=***&page=2&api_key=***#access_token=***')
    assert.equal(e.message, 'échec pour ***@exemple.fr (Authorization: Bearer ***) jeton ***')
    assert.equal(e.pile, 'at https://site.test/compte?session=***&onglet=2:10:5')
    const disque = readFileSync(join(dir, 'mjs-errors-client.ndjson'), 'utf-8')
    for (const secret of ['t0k3n-123', 'K3Y', 'zzz999', 'jean.dupont', 'abcdef0123456789', JWT, 's3cr3t']) assert.ok(!disque.includes(secret), secret)
  })
})

describe('journal — durée de vie des entrées (`maxDays`)', () => {
  const ancienne = (jours: number, message: string): string => {
    const quand = Date.now() - jours * 86_400_000
    return JSON.stringify({ ts: quand, source: 'server', signature: message + '\n\n/', message, pile: '', url: '/', version: null, n: 1, premier: quand, dernier: quand }) + '\n'
  }

  it('défaut 30 jours : une entrée sans nouvelle occurrence depuis 40 jours est oubliée, sur le disque aussi', () => {
    const dir = mjsTmp('journal-duree')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'mjs-errors-server.ndjson'), ancienne(40, 'vieille') + ancienne(2, 'recente'))
    const j = createJournal({ dir })
    assert.deepEqual(j.list().map(e => e.message), ['recente'])
    j.close()
    assert.ok(!readFileSync(join(dir, 'mjs-errors-server.ndjson'), 'utf-8').includes('vieille'))
  })

  it('maxDays: 1 → une entrée de 2 jours est oubliée', () => {
    const dir = mjsTmp('journal-duree-1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'mjs-errors-server.ndjson'), ancienne(2, 'deux-jours'))
    const j = createJournal({ dir, maxDays: 1 })
    assert.deepEqual(j.list(), [])
    j.close()
  })
})

describe('visionneuse du journal — jeton hors de l\'adresse', function () {
  this.timeout(30000)
  let nodeEnv: string | undefined
  before(() => { nodeEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'production' })
  after(() => { if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv })

  function projet() {
    const root   = mjsTmp('journal-jeton-cookie')
    const outDir = join(root, 'out')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(root, 'src', 'home.mjs'), '<h1>Salut</h1>')
    writeFileSync(join(outDir, 'manifest.js'), "const µCore = '/mjs_core-test1234.js';\nµ.paths = {};\nµ.version = \"abcd1234\";\n")
    const config: any = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/manifest.js', journal: { viewer: 'secret-jeton' }, render: { routes: { '/': { component: 'mjs-home', mode: 'csr' } } } }
    return { root, outDir, config }
  }

  async function verifier(port: number): Promise<void> {
    const page = await fetch(`http://127.0.0.1:${port}/__mjs/errors?token=secret-jeton`)
    assert.equal(page.status, 200)
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer')
    const cookie = page.headers.get('set-cookie') ?? ''
    assert.match(cookie, /^mjs-journal=[^;]+; Path=\/__mjs\/; HttpOnly; SameSite=Strict$/)
    assert.ok(!cookie.includes('secret-jeton'), 'le cookie ne porte pas le jeton lui-même')
    assert.match(await page.text(), /history\.replaceState/)
    const parCookie = await fetch(`http://127.0.0.1:${port}/__mjs/errors.json`, { headers: { cookie: cookie.split(';')[0] } })
    assert.equal(parCookie.status, 200)
    const mauvais = await fetch(`http://127.0.0.1:${port}/__mjs/errors.json`, { headers: { cookie: 'mjs-journal=faux' } })
    assert.equal(mauvais.status, 404)
    const sansRien = await fetch(`http://127.0.0.1:${port}/__mjs/errors.json`)
    assert.equal(sansRien.status, 404)
  }

  it('mjs serve : la page pose le cookie, errors.json l\'accepte', async () => {
    const { root, config } = projet()
    const running = await startRenderServer(config, root, { port: 0 })
    try { await verifier(running.port) }
    finally { await running.close() }
  })

  it('mjs dev : la page pose le cookie, errors.json l\'accepte', async () => {
    const { root, outDir, config } = projet()
    const server = new StaticServer({ rootDir: outDir, pathPrefix: '/modularjs', port: 0, host: '127.0.0.1', config, configDir: root, manifestPath: join(outDir, 'manifest.js'), journal: createJournal({ dir: join(root, 'log') }) })
    await server.start()
    try { await verifier((server.server!.address() as any).port) }
    finally { await server.stop() }
  })
})
