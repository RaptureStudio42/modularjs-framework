// Poids des noms (`id:`) et de la page (minuterie posée hors de tout composant actif) : en production, leur code n'entre au
// cœur que si un appel en a besoin, lu appel par appel — options écrites en objet avec une clé `id`, ou passées par une
// variable (prudence) ; appel venu d'un module ou d'un magasin (rien en tête de l'appel). Une appli qui n'en écrit aucun
// garde le cœur des minuteries sans eux, du même poids à l'octet (le texte cite les fichiers de l'appli, dont l'empreinte
// suit le composant) ; un `id:` écrit dans le corps de la fonction n'y fait rien entrer.
// En développement, les deux sont toujours là.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// cœur d'une appli : le composant `minuterie.mjs` (`script` dans son <script>, `module` dans son <script module>) et les autres fichiers de l'appli, `others` (nom → texte)
async function coeur(script: string, module = 'window.m = -> 1', prod = true, others: Record<string, string> = {}): Promise<string> {
  const root   = mjsTmp('every-poids')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'minuterie.mjs'), `<p>{$n}</p>\n\n<script module>\n  ${module}\n</script>\n\n<script>\n  $n = 0\n  ${script}\n</script>\n`)
  for (const [name, text] of Object.entries(others)) writeFileSync(join(srcDir, name), text)
  const bundler: any = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(prod ? { env: 'prod' } : {}) } as any)
  const stats        = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichier = readdirSync(outDir).find((f: string) => /^mjs_core-/.test(f))
  assert.ok(fichier, 'cœur compilé')
  return readFileSync(join(outDir, fichier!), 'utf-8')
}

// le code des noms : un registre qui a porté une minuterie nommée prend un `delete` qui libère le nom
const NOMS = 'Set.prototype.delete'

describe('µafter / µevery — le code des noms et celui de la page n\'entrent au cœur de production que si un appel en a besoin', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  it('µafter et µevery sans `id` : le cœur ne porte pas le code des noms ; un `id:` du corps de la fonction ou des options sans `id` n\'y changent rien', async () => {
    const a = await coeur('µafter 30, -> $n = $n + 1')
    assert.equal(a.includes(NOMS), false, 'pas de code des noms')
    const corps = await coeur('µafter 30, -> window.x = { id: 5 }')
    assert.equal(corps.includes(NOMS), false, 'un `id:` du corps de la fonction : pas de code des noms')
    assert.ok(corps.length === a.length, `un \`id:\` du corps de la fonction : même poids, à l'octet (${corps.length} o contre ${a.length} o)`)
    const options = await coeur('µafter 30, pause: true, -> $n = $n + 1')
    assert.ok(options.length === a.length, `options écrites en objet sans \`id\` : même poids, à l'octet (${options.length} o contre ${a.length} o)`)
    const every = await coeur('µevery 1000, times: 2, -> $n = $n + 1')
    assert.equal(every.includes(NOMS), false, 'µevery sans `id` : pas de code des noms')
  })

  it('`id:` écrit dans les options, ou options passées par une variable : le code des noms entre', async () => {
    const a = await coeur('µafter 30, -> $n = $n + 1')
    const b = await coeur('µafter 30, id: \'sauver\', -> $n = $n + 1')
    assert.ok(b.includes(NOMS), 'options en objet avec `id` : le code des noms entre')
    assert.ok(b.length > a.length, `le cœur avec \`id\` est plus lourd (${b.length} o contre ${a.length} o)`)
    const variable = await coeur('opts = { pause: true }\n  µafter 30, opts, -> $n = $n + 1')
    assert.ok(variable.includes(NOMS), 'options passées par une variable : le code des noms entre (prudence)')
    const every = await coeur('µevery 1000, id: \'horloge\', -> $n = $n + 1')
    assert.ok(every.includes(NOMS), 'µevery avec `id` : le code des noms entre')
  })

  it('µafter appelé par un module (rien en tête de l\'appel) : le code de la page entre, pas celui des noms', async () => {
    const a = await coeur('µafter 30, -> $n = $n + 1')
    const m = await coeur('µafter 30, -> $n = $n + 1', 'window.m = -> µafter 30, -> 1')
    assert.ok(m.length > a.length, `le cœur avec un appel de module est plus lourd (${m.length} o contre ${a.length} o)`)
    assert.equal(m.includes(NOMS), false, 'pas de code des noms sans `id`')
  })

  it('deux composants, l\'un avec µevery ou µafter sans `id`, l\'autre vide, ou un module `.civet` sans minuterie à côté : ni le code des noms ni celui de la page', async () => {
    const EMPTY = { 'vide.mjs': '<p>x</p>\n' }
    const CIVET = { 'aide.civet.mjs': 'value = 1\n' }
    const alone = await coeur('µevery 1000, -> $n += 1')
    for (const others of [EMPTY, CIVET]) {
      const name  = Object.keys(others)[0]
      const every = await coeur('µevery 1000, -> $n += 1', undefined, true, others)
      assert.ok(every === alone, `µevery sans \`id\` et ${name} : le cœur de l\'appli du seul composant, à l\'octet (${every.length} o contre ${alone.length} o)`)
      const once = await coeur('µafter 30, -> $n += 1', undefined, true, others)
      const page = await coeur('µafter 30, -> $n += 1', 'window.m = -> µafter 30, -> 1', true, others)
      assert.equal(once.includes(NOMS), false, `µafter sans \`id\` et ${name} : pas de code des noms`)
      assert.ok(once.length < page.length, `µafter sans \`id\` et ${name} : pas de code de la page (${once.length} o contre ${page.length} o avec un appel de module)`)
    }
  })

  it('développement : le code des noms et celui de la page sont toujours là', async () => {
    const a = await coeur('µafter 30, -> $n = $n + 1', 'window.m = -> 1', false)
    assert.ok(a.includes(NOMS), 'code des noms')
    assert.ok(a.includes('_mjsPage'), 'code de la page')
  })
})
