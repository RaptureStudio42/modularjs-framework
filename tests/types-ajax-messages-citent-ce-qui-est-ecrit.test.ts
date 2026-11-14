// les messages de la construction citent ce que l'auteur a écrit : un module .coffee en erreur montre sa ligne, jamais le code que
// la forme appelable de µajax réécrit (`µ._mjs_ajax`, `µ._mjs_tajax`) ; dans un appel par verbe, `type: "#{Reward}"` cite un nom de
// règle comme `type: [Reward]` (refusé sans liaison qui englobe l'appel), et `type: Reward['id']` se cite tel quel, jamais comme
// `type: Reward[]`

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const TYPES = '<types>\nReward\n  id     int 1..\n  title  string 1..80\n</types>\n'

// une appli : rend les erreurs de sa construction
async function construire(fichiers: Record<string, string>, prod: boolean): Promise<string[]> {
  const racine  = mkdtempSync(join(tmpdir(), 'types-msg-'))
  const src     = join(racine, 'src')
  const journal = [console.log, console.warn, console.error]
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(src, nom)), { recursive: true })
    writeFileSync(join(src, nom), texte)
  }
  console.log = console.warn = console.error = () => {}
  try {
    const b: any  = new Bundler({ sourceDir: src, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js'), ...(prod ? { env: 'prod' } : {}) } as any)
    const st: any = await b.compile()
    return (st.errors ?? []).map((e: any) => String(e?.message ?? e))
  }
  finally {
    [console.log, console.warn, console.error] = journal
    rmSync(racine, { recursive: true, force: true })
  }
}

const comp = (script: string) => `<script>\n  ${script}\n</script>\n<p>{$r}</p>\n`

describe('types : les messages citent ce qui est écrit', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  it('module .coffee en erreur : le message montre la ligne de l\'auteur, jamais le code réécrit', async () => {
    const e = (await construire({ 'app.types.mjs': TYPES, 'charger.coffee.mjs': 'export charger = (u) -> await µajax u, type: Reward[], ,\n', 'alpha.mjs': "<script>\n@import { charger } 'charger.coffee.mjs'\nload = -> $r = await charger('/x')\n</script>\n<p>{$r}</p>\n" }, false)).join('\n')
    assert.ok(e.length > 0, 'une erreur')
    assert.ok(!/_mjs_t?ajax/.test(e), e)
    assert.match(e, /µajax u, type: Reward\[\]/)
  })

  it('`type: "#{Reward}"` dans un appel par verbe, sans liaison qui englobe l\'appel : refusé, le message cite ce qui est écrit', async () => {
    const e = await construire({ 'app.types.mjs': TYPES, 'alpha.mjs': comp('load = -> µajax.post \'/x\', { type: "#{Reward}" }, (r) -> $r = r') }, true)
    assert.equal(e.length, 1, e.join('\n'))
    assert.match(e[0], /Reward/)
    assert.match(e[0], /#\{Reward\}/)
  })

  it('`type: Reward[\'id\']` dans un appel par verbe : le message le cite tel quel, jamais « type: Reward[] »', async () => {
    const e = await construire({ 'app.types.mjs': TYPES, 'alpha.mjs': comp("load = -> µajax.post '/x', { type: Reward['id'] }, (r) -> $r = r") }, true)
    assert.equal(e.length, 1, e.join('\n'))
    assert.ok(!e[0].includes('type: Reward[]'), e[0])
    assert.match(e[0], /Reward\['id'\]/)
  })
})
