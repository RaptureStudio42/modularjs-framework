// l'élément du dernier gabarit de ligne copié, gardé d'un appel de `µ._mjs_cloneEl` au suivant (mjs_init.ts), ne sert qu'à l'appli dont une
// ligne de `{for}` à racine unique se copie ainsi. Une construction de production sans une telle ligne ne l'emporte pas : la copie y relit
// son gabarit à chaque appel, et le cœur d'une appli sans liste ne porte rien de plus. Il reste dès qu'une unité copie une ligne, avec le
// cœur demandé tout entier, et dans tout build de développement (un composant recompilé à chaud peut copier une ligne)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as acorn from 'acorn'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures, ROW_CLONE } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'

const NO_LIST   = '<script>\n$t = 1\n</script>\n<p>{$t}</p>\n'
const ONE_ROOT  = '<script>\n$rows = [{ id: 1, t: \'a\' }]\n</script>\n<ul>{for r in $rows by id}<li class="r">{r.t}</li>{end}</ul>\n'
const TWO_ROOTS = '<script>\n$rows = [{ id: 1, t: \'a\' }]\n</script>\n<dl>{for r in $rows by id}<dt>{r.id}</dt><dd>{r.t}</dd>{end}</dl>\n'
const TEXT_ONLY = '<script>\n$l = [\'a\', \'b\']\n</script>\n<p>{for x in $l}{x} {end}</p>\n'

// le code compilé d'un composant, et ses signaux comme le build les relève
const compiled = async (source: string) => (await transpile(source, { moduleName: 'c' })).output
const signals  = async (source: string) => scanCompiledFeatures(await compiled(source))

// le cœur assemblé, non minifié
const core = async (used: Set<string>, opts: Record<string, unknown> = {}) => {
  const out     = mjsTmp('copie-de-ligne')
  const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), minify: false, ...opts } as any)
  const path    = await bundler.bundleRuntime(used)
  return path === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') as string : readFileSync(join(out, basename(path)), 'utf-8')
}

// l'élément gardé d'un appel au suivant, et la copie qui le lit
const KEPT    = ['var _mjsLastHtml, _mjsLastEl;', 'html === _mjsLastHtml ? _mjsLastEl']
// ce qui le remplace : la copie relit son gabarit à chaque appel
const WITHOUT = ['µ._mjs_cloneEl  = (html) => _mjsTpl(html).firstChild.cloneNode(true);']

const all   = (text: string, marks: string[], what: string) => { for (const m of marks) assert.ok(text.includes(m), `${what} : « ${m} » manque`) }
const none  = (text: string, marks: string[], what: string) => { for (const m of marks) assert.ok(!text.includes(m), `${what} : « ${m} » est encore là`) }
const valid = (text: string) => assert.doesNotThrow(() => acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' }), 'le cœur n\'est plus du JavaScript valide')
const clean = (text: string) => assert.doesNotMatch(text, /^[ \t]*\/\/ <\/?(?:sans-)?copie-de-ligne>$/m, 'une marque du bloc copie-de-ligne est restée')

describe('copie d\'une ligne de {for} : l\'élément gardé d\'un appel au suivant est retiré à la construction quand aucune ligne ne se copie ainsi', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  it('le relevé : seule une ligne à racine unique, copiée par µ._mjs_cloneEl, donne le signal', async () => {
    assert.match(await compiled(ONE_ROOT), /µ\._mjs_cloneEl\(/, 'la ligne à racine unique se copie par µ._mjs_cloneEl')
    assert.ok((await signals(ONE_ROOT)).has(ROW_CLONE), 'une ligne à racine unique : pas de signal')
    for (const [what, source] of [['un composant sans liste', NO_LIST], ['une ligne à deux racines', TWO_ROOTS], ['une ligne de texte seul', TEXT_ONLY]] as const) {
      assert.doesNotMatch(await compiled(source), /µ\._mjs_cloneEl\(/, `${what} : µ._mjs_cloneEl est appelé`)
      assert.ok(!(await signals(source)).has(ROW_CLONE), `${what} donne le signal`)
    }
  })

  it('production, aucune ligne copiée ainsi : pas d\'élément gardé, la copie relit son gabarit, le cœur reste du JavaScript valide', async () => {
    for (const [what, source] of [['sans liste', NO_LIST], ['ligne à deux racines', TWO_ROOTS], ['ligne de texte seul', TEXT_ONLY]] as const) {
      const text = await core(await signals(source), { env: 'prod' })
      none(text, KEPT, `production, ${what}`)
      all(text, WITHOUT, `production, ${what}`)
      clean(text)
      valid(text)
    }
  })

  it('production, une ligne à racine unique : l\'élément gardé reste, sans son remplaçant', async () => {
    const text = await core(await signals(ONE_ROOT), { env: 'prod' })
    all(text, KEPT, 'production, ligne à racine unique')
    none(text, WITHOUT, 'production, ligne à racine unique')
    clean(text)
    valid(text)
  })

  it('production avec le cœur demandé tout entier, et développement : gardé', async () => {
    const used = await signals(NO_LIST)
    for (const [what, opts] of [['production, runtime: \'all\'', { env: 'prod', runtime: 'all' }], ['développement', {}]] as const) {
      const text = await core(used, opts)
      all(text, KEPT, what)
      none(text, WITHOUT, what)
      clean(text)
    }
  })
})
