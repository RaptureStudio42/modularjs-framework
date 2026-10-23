// `css: "split"` : retoucher UNE feuille partagée recompilait à froid tous les composants en cache, même ceux qui ne la
// déclarent pas (en `mjs dev`, chaque retouche de feuille coûtait une reconstruction complète). Seuls les composants qui
// embarquent le chemin de cette feuille sont recompilés ; le résultat reste celui d'une construction neuve.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('css split : une feuille retouchée ne recompile que les composants qui la déclarent', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('b.scss retouchée, déclarée par c1 seul : c1 seul recompilé, manifeste identique à celui d\'une construction neuve', async () => {
    const root   = mjsTmp('split-seuls-dependants')
    const src    = join(root, 'src')
    const styles = join(root, 'styles')
    mkdirSync(src, { recursive: true })
    mkdirSync(styles, { recursive: true })
    writeFileSync(join(styles, 'a.scss'), '.a { color: red; }\n')
    writeFileSync(join(styles, 'b.scss'), '.b { color: blue; }\n')
    for (let i = 0; i < 10; i++) {
      const css = i === 0 ? '<style @css="a">\n</style>\n' : i === 1 ? '<style @css="b">\n</style>\n' : ''
      writeFileSync(join(src, `c${i}.mjs`), `<script>\n  $x = ${i}\n</script>\n<p class="a b">{$x}</p>\n${css}`)
    }
    const options = (out: string) => ({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), stylesheetsDir: styles, css: 'split', urlPrefix: '/modularjs' })
    const b: any  = new Bundler(options(join(root, 'out')))
    const froids: string[] = []
    const compileMjsCold = b.compileMjsCold.bind(b)
    b.compileMjsCold = (f: string, ...reste: any[]) => { froids.push(f.split('/').pop()!); return compileMjsCold(f, ...reste) }
    assert.deepEqual((await b.compile()).errors.map((e: Error) => e.message), [])
    froids.length = 0
    assert.deepEqual((await b.compile()).errors.map((e: Error) => e.message), [])
    assert.deepEqual(froids, [], 'deuxième tour sans changement')
    writeFileSync(join(styles, 'b.scss'), '.b { color: green; }\n')
    assert.deepEqual((await b.compile()).errors.map((e: Error) => e.message), [])
    assert.deepEqual(froids.sort(), ['c1.mjs'], 'composants recompilés après la retouche de b.scss')
    writeFileSync(join(styles, 'a.scss'), '.a { color: black; }\n')
    froids.length = 0
    assert.deepEqual((await b.compile()).errors.map((e: Error) => e.message), [])
    assert.deepEqual(froids.sort(), ['c0.mjs'], 'composants recompilés après la retouche de a.scss')
    await b.close()

    const neuf = new Bundler(options(join(root, 'neuf')))
    assert.deepEqual((await neuf.compile()).errors.map(e => e.message), [])
    await neuf.close()
    assert.equal(readFileSync(join(root, 'out', 'bundle.js'), 'utf-8'), readFileSync(join(root, 'neuf', 'bundle.js'), 'utf-8'))
  })
})
