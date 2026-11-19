// µajax : la forme appelable n'est laissée hors du cœur que si chaque mention de `ajax` sous µ est une forme prouvée sûre (un verbe
// appelé, un rappel par défaut écrit) — `{ ajax: a } = µ`, `.call`, `.bind`, `.apply` la font entrer ; un appel que la construction
// ne lit pas du tout est averti en développement, une fois, et rien n'en part en production. Les anciens noms (`onError:`,
// `onTypeError:`, une autre casse) et une clé inconnue de la forme appelable arrêtent la construction, avec le bon nom ; dans un
// objet que la construction ne lit pas, un ancien nom est averti en développement. Une bibliothèque .js : le nom d'une classe nommée
// est lié dans son corps, un identifiant écrit par échappement compte pour son nom. Le message d'un `type:` cite ce qui est écrit

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const ICI        = dirname(fileURLToPath(import.meta.url))
const AJAX_SRC   = readFileSync(join(ICI, '../src/runtime/mjs_ajax.ts'), 'utf-8')
const DEFINITION = /method:\s*['"]GET['"],\s*success:/
const BS         = String.fromCharCode(92)
const TYPES      = '<types>\nReward\n  id     int 1..\n  title  string 1..80\n</types>\n'

// une appli : rend les erreurs de sa construction et son cœur
async function construire(fichiers: Record<string, string>, prod: boolean): Promise<{ erreurs: string[], core: string }> {
  const racine  = mkdtempSync(join(tmpdir(), 'ajax-preuve-'))
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
// le runtime de µajax tel que le cœur de développement le porte quand le relevé n'a lu aucun appel de µ.ajax
const sansVu  = (s: string) => s.replace(/^[ \t]*\/\/ <ajax-call-seen>\n[\s\S]*?^[ \t]*\/\/ <\/ajax-call-seen>\n/gm, '')

describe('µajax s\'appelle directement : prises comme valeur refusées, verbes permis', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [nom, script] of [
    ['{ ajax: renomme } = µ', "{ ajax: renomme } = µ\n  load = -> $r = await renomme('/app/rewards')"],
    ['µajax.call', "load = -> $r = await µajax.call(µ, '/app/rewards')"],
    ['µajax.bind', "f = µajax.bind(µ)\n  load = -> $r = await f('/app/rewards')"],
    ['µajax.apply', "load = -> $r = await µajax.apply(µ, ['/app/rewards'])"],
  ] as const) {
    for (const prod of [true, false]) {
      it(`${nom} : refusé (${prod ? 'production' : 'développement'}), le message montre l'appel direct`, async () => {
        const r = await construire({ 'alpha.mjs': comp(script) }, prod)
        assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
        assert.match(r.erreurs[0], /prend µajax comme valeur/)
        assert.match(r.erreurs[0], /µajax\(url, options\)/)
      })
    }
  }

  it('un verbe appelé et un rappel par défaut écrit, seuls : elle reste dehors en production ; en développement, elle est là, avec son avertissement', async () => {
    const appli = { 'alpha.mjs': comp("µ.ajax.error = (e) -> null\n  load = -> µajax.get '/app/rewards', (r) -> $r = r") }
    const prod  = await construire(appli, true)
    const dev   = await construire(appli, false)
    assert.deepEqual(prod.erreurs, [])
    assert.doesNotMatch(prod.core, DEFINITION)
    assert.ok(!prod.core.includes('ajaxUnseen'), 'aucun octet de l\'avertissement en production')
    assert.match(dev.core, DEFINITION)
    assert.ok(dev.core.includes('ajaxUnseen'), 'l\'avertissement en développement')
  })

  it('développement : un appel de µ.ajax que la construction n\'a pas lu marche, et le dit une fois ; un ancien nom dans un objet non lu aussi', async () => {
    const vus: string[] = []
    const µ: any        = { log() {}, warn(m: string) { vus.push(m) }, error() {}, _mjs_msg: (k: string, v: any, f: string) => k + ' ' + f.replace(/\{(\w+)\}/g, (_m: string, n: string) => v[n]) }
    const reponse       = { status: 200, ok: true, url: 'https://app.example/x', headers: { get: (n: string) => n === 'content-type' ? 'application/json' : null }, json: async () => [1], text: async () => '[1]' }
    new Function('µ', 'fetch', 'document', sansVu(AJAX_SRC))(µ, async () => reponse, { querySelector: () => null })
    const k = 'ajax'
    assert.deepEqual(await µ[k]('/x'), [1])
    assert.deepEqual(await µ[k]('/x'), [1])
    assert.equal(vus.filter(v => v.startsWith('ajaxUnseen')).length, 1)
    assert.match(vus.find(v => v.startsWith('ajaxUnseen'))!, /µajax\(…\)/)
    const o = { onError: () => 1, onTypeError: () => 1 }
    await µ._mjs_ajax('/x', o)
    await µ._mjs_ajax('/x', o)
    assert.equal(vus.filter(v => v.startsWith('ajaxOldName')).length, 2)
    assert.ok(vus.filter(v => v.startsWith('ajaxOldName')).every(v => /error:/.test(v) && /typeError:/.test(v)))
  })
})

describe('µajax : anciens noms et clés inconnues de la forme appelable', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const cle of ['onError', 'onTypeError', 'typeerror', 'onerror']) {
    for (const prod of [true, false]) {
      it(`« ${cle}: » arrête la construction (${prod ? 'production' : 'développement'}), le message donne error: et typeError:`, async () => {
        const r = await construire({ 'app.types.mjs': TYPES, 'alpha.mjs': comp(`load = -> $r = await µajax '/app/rewards', type: Reward[], ${cle}: (e) -> []`) }, prod)
        assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
        assert.ok(r.erreurs[0].includes(cle + ':'), r.erreurs[0])
        assert.match(r.erreurs[0], /error:/)
        assert.match(r.erreurs[0], /typeError:/)
      })
    }
  }

  it('dans un module .js.mjs aussi', async () => {
    const r = await construire({ 'app.types.mjs': TYPES, 'outil.js.mjs': "export const f = () => µajax('/app/rewards', { type: Reward[], onError: () => [] })\n", 'alpha.mjs': "<script>\n@import { f } 'outil.js.mjs'\nload = -> $r = await f()\n</script>\n<p>{$r}</p>\n" }, true)
    assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
    assert.match(r.erreurs[0], /onError:/)
  })

  it('une clé inconnue arrête la construction, et le message dit les options de la forme appelable', async () => {
    const r = await construire({ 'alpha.mjs': comp("load = -> $r = await µajax '/app/rewards', tmeout: 50") }, true)
    assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
    assert.match(r.erreurs[0], /tmeout:/)
    assert.match(r.erreurs[0], /timeout/)
  })
})

describe('bibliothèque .js : portée et échappements', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  it('le nom d\'une classe nommée est lié dans son corps : pas de refus', async () => {
    const r = await construire({ 'alpha.mjs': IMPORTE, 'aide.js': 'const K = class µK { m () { return µK } }\nexport const f = () => new K().m()\n' }, true)
    assert.deepEqual(r.erreurs, [])
  })

  for (const [nom, code] of [['µajax', `export const f = () => ${BS}u00b5ajax('/x')\n`], ['µt', `export const f = () => ${BS}u{B5}t('cle')\n`]] as const) {
    it(`un identifiant écrit par échappement (${nom}) compte pour son nom : refus qui nomme aide.js.mjs`, async () => {
      const r = await construire({ 'alpha.mjs': IMPORTE, 'aide.js': code }, true)
      assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
      assert.match(r.erreurs[0], /aide\.js\.mjs/)
    })
  }
})

describe('type: dans un appel par verbe : le message cite ce qui est écrit', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const ecrit of ['Reward?.id', 'Reward or 1', 'Reward?']) {
    it(`type: ${ecrit}`, async () => {
      const r = await construire({ 'app.types.mjs': TYPES, 'alpha.mjs': comp(`load = -> µajax.post '/x', { type: ${ecrit} }, (r) -> $r = r`) }, true)
      assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
      assert.ok(r.erreurs[0].includes(`type: ${ecrit}`), r.erreurs[0])
    })
  }
})
