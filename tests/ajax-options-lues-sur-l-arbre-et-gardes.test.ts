// la forme appelable de µajax : ses options se lisent sur l'objet tel que le langage l'a rangé (objets implicites de CoffeeScript,
// raccourcis, clés entre guillemets) — aucun faux refus sur un objet imbriqué, un `type:` écrit dans `data:` reste une donnée, et un
// ancien nom en raccourci ou entre guillemets est refusé comme les autres ; une garde d'existence (`µajax?`, `if µajax`, `µ.ajax and
// …`, `µ.ajax ? … : …`) est permise, et ne fait pas entrer le code de la forme appelable

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const DEFINITION = /method:\s*['"]GET['"],\s*success:/
const TYPES      = '<types>\nReward\n  id     int 1..\n  title  string 1..80\n</types>\n'

// une appli de production : rend les erreurs de sa construction, son cœur et tout le JavaScript écrit
async function construire(fichiers: Record<string, string>, prod = true): Promise<{ erreurs: string[], core: string, tout: string }> {
  const racine  = mkdtempSync(join(tmpdir(), 'ajax-arbre-'))
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
    const js      = existsSync(out) ? readdirSync(out).filter(x => x.endsWith('.js')) : []
    const f       = js.find(x => /^mjs_core-/.test(x))
    return { erreurs: (st.errors ?? []).map((e: any) => String(e?.message ?? e)), core: f ? readFileSync(join(out, f), 'utf-8') : '', tout: js.filter(x => !/^mjs_core-/.test(x)).map(x => readFileSync(join(out, x), 'utf-8')).join('\n') }
  }
  finally {
    [console.log, console.warn, console.error] = journal
    rmSync(racine, { recursive: true, force: true })
  }
}

const comp = (script: string) => `<script>\n  ${script}\n</script>\n<p>{$r}</p>\n`

describe('µajax : les options lues sur l\'objet que le langage a rangé', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [nom, appel] of [
    ['data: title: \'a\', price: 2', "µajax '/app/rewards', method: 'POST', data: title: 'a', price: 2"],
    ['data: JSON.stringify title: \'a\', price: 2', "µajax '/app/rewards', method: 'POST', data: JSON.stringify title: 'a', price: 2"],
    ['error: (e) -> ok: false, code: 1', "µajax '/app/rewards', error: (e) -> ok: false, code: 1"],
  ] as const) {
    it(`CoffeeScript valide, objet imbriqué : ${nom} — pas de refus`, async () => {
      const r = await construire({ 'alpha.mjs': comp(`load = -> $r = await ${appel}`) })
      assert.deepEqual(r.erreurs, [])
      assert.match(r.core, DEFINITION)
    })
  }

  it('`data: kind: \'a\', type: Reward` : le `type:` est dans `data`, une donnée, jamais le contrôle de la réponse', async () => {
    const r = await construire({ 'app.types.mjs': TYPES, 'alpha.mjs': comp("Reward = 'cadeau'\n  load = -> $r = await µajax '/app/rewards', method: 'POST', data: kind: 'a', type: Reward") }, false)
    assert.deepEqual(r.erreurs, [])
    assert.ok(!r.tout.includes('_mjs_tajax'), 'aucun contrôle de la réponse')
    assert.match(r.tout, /type: Reward\b/)
  })

  for (const [nom, fichiers] of [
    ['{ onError } en raccourci', { 'alpha.mjs': comp("onError = (e) -> []\n  load = -> $r = await µajax '/app/rewards', { onError }") }],
    ["'onError': entre guillemets", { 'alpha.mjs': comp("load = -> $r = await µajax '/app/rewards', 'onError': (e) -> []") }],
    ['"onError": dans un module .js.mjs', { 'outil.js.mjs': "export const f = () => µajax('/app/rewards', { \"onError\": () => [] })\n", 'alpha.mjs': "<script>\n@import { f } 'outil.js.mjs'\nload = -> $r = await f()\n</script>\n<p>{$r}</p>\n" }],
  ] as const) {
    it(`${nom} : refusé, le message donne error: et typeError:`, async () => {
      const r = await construire(fichiers)
      assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
      assert.match(r.erreurs[0], /onError/)
      assert.match(r.erreurs[0], /error:/)
      assert.match(r.erreurs[0], /typeError:/)
    })
  }
})

describe('µajax : les gardes d\'existence sont permises', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [nom, fichiers] of [
    ['ok = µajax?', { 'alpha.mjs': comp('ok = µajax?\n  load = -> $r = ok') }],
    ['if µajax then', { 'alpha.mjs': comp('load = ->\n    if µajax then $r = 1') }],
    ['µ.ajax and µ.ajax.get(…)', { 'alpha.mjs': comp("load = -> µ.ajax and µ.ajax.get('/app/rewards', (x) -> $r = x)") }],
    ['µ.ajax ? µ.ajax.get(…) : null dans un module .js.mjs', { 'outil.js.mjs': "export const f = (ok) => µ.ajax ? µ.ajax.get('/app/rewards', ok) : null\n", 'alpha.mjs': "<script>\n@import { f } 'outil.js.mjs'\nload = -> f((x) -> $r = x)\n</script>\n<p>{$r}</p>\n" }],
  ] as const) {
    it(`${nom} : pas de refus, et la forme appelable reste hors du cœur`, async () => {
      const r = await construire(fichiers)
      assert.deepEqual(r.erreurs, [])
      assert.doesNotMatch(r.core, DEFINITION)
    })
  }
})
