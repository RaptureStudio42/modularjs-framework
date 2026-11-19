// en production : µajax pris comme valeur (`f = µajax`, `µajax?(…)`, `const a = µajax` dans un module .js.mjs, `µ['ajax'](…)`,
// `{ ajax } = µ`) fait entrer la forme appelable, et µ.ajax s'appelle comme elle, ses verbes et ses rappels gardés ; une
// bibliothèque .js qui lit une rune en nom libre (`µajax.get`, `µajax(…)`, `µafter`, `µt`) arrête la construction, et le message
// dit de la nommer x.js.mjs — une rune en paramètre, en propriété, dans un texte ou un commentaire ne compte pas

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const ICI        = dirname(fileURLToPath(import.meta.url))
const AJAX_SRC   = readFileSync(join(ICI, '../src/runtime/mjs_ajax.ts'), 'utf-8')
// la forme appelable (bloc `<ajax-call>` du cœur) : un GET dont la promesse rend le corps
const DEFINITION = /method:\s*['"]GET['"],\s*success:/

// une appli : rend les erreurs de sa construction et son cœur
async function construire(fichiers: Record<string, string>, prod: boolean): Promise<{ erreurs: string[], core: string }> {
  const racine  = mkdtempSync(join(tmpdir(), 'ajax-valeur-'))
  const src     = join(racine, 'src')
  const out     = join(racine, 'out')
  const journal = [console.log, console.warn, console.error]
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(src, nom)), { recursive: true })
    writeFileSync(join(src, nom), texte)
  }
  console.log = console.warn = console.error = () => {}
  try {
    const b: any  = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(racine, 'bundle.js'), ...(prod ? { env: 'prod' } : {}) } as any)
    const st: any = await b.compile()
    const f       = existsSync(out) ? readdirSync(out).find(x => /^mjs_core-/.test(x)) : undefined
    return { erreurs: (st.errors ?? []).map((e: any) => String(e?.message ?? e)), core: f ? readFileSync(join(out, f), 'utf-8') : '' }
  }
  finally {
    [console.log, console.warn, console.error] = journal
    rmSync(racine, { recursive: true, force: true })
  }
}

const comp    = (script: string) => `<script>\n  ${script}\n</script>\n<p>{$r}</p>\n`
const IMPORTE = "<script>\n@import { f } 'aide.js'\nload = -> $r = f()\n</script>\n<p>{$r}</p>\n"

describe('µajax s\'appelle directement, en production', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  const CAS: Array<[string, Record<string, string>]> = [
    ['f = µajax', { 'alpha.mjs': comp("f = µajax\n  load = -> $r = await f('/app/rewards')") }],
    ['µajax?(…)', { 'alpha.mjs': comp("load = -> $r = await µajax?('/app/rewards')") }],
    ['const a = µajax dans un module .js.mjs', { 'outil.js.mjs': 'export const a = µajax\n', 'alpha.mjs': "<script>\n@import { a } 'outil.js.mjs'\nload = -> $r = await a('/app/rewards')\n</script>\n<p>{$r}</p>\n" }],
    ["µ['ajax'](…)", { 'alpha.mjs': comp("load = -> $r = await µ['ajax']('/app/rewards')") }],
    ['{ ajax } = µ', { 'alpha.mjs': comp("{ ajax } = µ\n  load = -> $r = await ajax('/app/rewards')") }],
  ]
  for (const [nom, fichiers] of CAS) {
    if (nom === 'µajax?(…)') {
      it(`${nom} : un appel direct, la forme appelable entre au cœur`, async () => {
        const r = await construire(fichiers, true)
        assert.deepEqual(r.erreurs, [])
        assert.match(r.core, DEFINITION)
      })
      continue
    }
    it(`${nom} : µajax pris comme valeur arrête la construction, le message montre l'appel direct`, async () => {
      const r = await construire(fichiers, true)
      assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
      assert.match(r.erreurs[0], /prend µajax comme valeur/)
      assert.match(r.erreurs[0], /µajax\(url, options\)/)
    })
  }

  it('µajax?.(…) dans un module .js.mjs : un appel direct, la forme appelable entre au cœur', async () => {
    const r = await construire({ 'outil.js.mjs': "export const a = () => µajax?.('/app/rewards')\n", 'alpha.mjs': "<script>\n@import { a } 'outil.js.mjs'\nload = -> $r = await a()\n</script>\n<p>{$r}</p>\n" }, true)
    assert.deepEqual(r.erreurs, [])
    assert.match(r.core, DEFINITION)
  })

  it('µ.ajax passé en argument (`localGet(µ.ajax, …)`) arrête la construction, en développement aussi', async () => {
    for (const prod of [true, false]) {
      const r = await construire({ 'alpha.mjs': comp("localGet = (a, u) -> a.get u, (x) -> $r = x\n  load = -> localGet(µ.ajax, '/app/rewards')") }, prod)
        assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
        assert.match(r.erreurs[0], /prend µajax comme valeur/)
        assert.match(r.erreurs[0], /µajax\(url, options\)/)
      console.info('message (localGet) : ' + r.erreurs[0])
    }
  })

  it('µ.ajax s\'appelle comme la forme appelable, et garde ses verbes et ses rappels par défaut', async () => {
    const µ: any  = { log() {}, warn() {}, error() {} }
    const vus: any[] = []
    const reponse = (status: number, corps: string) => ({ status, ok: status < 300, url: 'https://app.example/x', headers: { get: (n: string) => n === 'content-type' ? 'application/json' : null }, json: async () => JSON.parse(corps), text: async () => corps })
    new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, async (u: string) => u === '/panne' ? reponse(500, '{"message":"panne"}') : reponse(200, '[1]'), { querySelector: () => null })
    assert.equal(typeof µ.ajax, 'function')
    assert.deepEqual(await µ.ajax('/x'), [1])
    assert.equal(typeof µ.ajax.get, 'function')
    await µ.ajax.get('/x', (b: any) => { vus.push(b) })
    µ.ajax.error = (e: any) => { vus.push(e.message) }
    assert.equal(await µ.ajax('/panne'), undefined)
    assert.deepEqual(vus, [[1], 'panne'])
  })
})

describe('bibliothèque .js qui lit une rune, en production', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  const RUNES: Array<[string, string]> = [
    ['µajax.get', "export const f = () => µajax.get('/x', (r) => r)\n"],
    ['µajax(…)', "export const f = () => µajax('/x')\n"],
    ['µafter', 'export const f = () => µafter(30, () => 1)\n'],
    ['µt', "export const f = () => µt('cle')\n"],
  ]
  for (const [nom, code] of RUNES) {
    it(`${nom} en nom libre : la construction s'arrête et dit de nommer le fichier aide.js.mjs`, async () => {
      const r = await construire({ 'alpha.mjs': IMPORTE, 'aide.js': code }, true)
      assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
      assert.match(r.erreurs[0], /aide\.js\.mjs/)
    })
  }

  it('en développement aussi', async () => {
    const r = await construire({ 'alpha.mjs': IMPORTE, 'aide.js': RUNES[0][1] }, false)
    assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
    assert.match(r.erreurs[0], /aide\.js\.mjs/)
  })

  it('une rune en paramètre, en propriété, dans un texte ou un commentaire ne compte pas', async () => {
    for (const code of ["export const f = (µajax) => µajax.get('/x')\n", 'export const f = () => window.µajax\n', "// µajax('/x')\nexport const f = () => 'µafter'\n"]) {
      assert.deepEqual((await construire({ 'alpha.mjs': IMPORTE, 'aide.js': code }, true)).erreurs, [], code)
    }
  })
})
