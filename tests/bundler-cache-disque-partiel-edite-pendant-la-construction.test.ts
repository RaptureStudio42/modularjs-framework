// `mjs build --cache` : un partiel édité pendant une construction, après que la construction l'a lu, laissait au cache le
// composant compilé avec l'ancien partiel sous l'état du nouveau (noté à la fin) ; la construction suivante le reprenait, périmé,
// sans aucun fichier absent. L'état d'une dépendance est noté quand la construction la trouve : la suivante voit le changement et
// recompile le composant, sa sortie est celle d'une construction complète

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('cache sur disque : un partiel édité pendant la construction', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la construction suivante recompile le composant qui l\'inclut : sortie d\'une construction complète', async () => {
    const root = mjsTmp('cache-partiel-edite-pendant')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), '{}\n')
    const bloc = (v: string): void => writeFileSync(join(src, '_bloc.mjs'), `<p class="bloc">bloc ${v}</p>\n`)
    bloc('v1')
    writeFileSync(join(src, 'page.mjs'), '<div class="page"><@include bloc></div>\n')
    let tour = 0
    const construire = async (cache: boolean, pendant?: (b: any) => void): Promise<string> => {
      const dir = join(root, 'runs', `${++tour}`)
      const out = join(dir, 'public/assets/modularJS_compiled')
      const b: any = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(dir, 'bundle.js'), env: 'prod', ...(cache ? { cache: true } : {}) })
      if (pendant) pendant(b)
      assert.deepEqual((await b.compile()).errors.map((e: Error) => e.message), [])
      await b.close()
      return out
    }
    await construire(true)
    bloc('v2')
    // l'autre écrivain : le partiel change juste après que la construction l'a lu pour compiler la page
    await construire(true, b => {
      const inscrire = b.updatePartialDependents.bind(b)
      b.updatePartialDependents = (parent: string, deps: string[]) => { inscrire(parent, deps); if (parent.endsWith('page.mjs')) bloc('v3') }
    })
    const suivante = await construire(true)
    const complete = await construire(false)
    const page = (out: string): string => readFileSync(join(out, readdirSync(out).find(f => /^page-\w{5}\.js$/.test(f))!), 'utf-8')
    assert.match(page(suivante), /bloc v3/, 'la page reprend le partiel tel qu\'il est sur le disque')
    assert.equal(page(suivante), page(complete))
    assert.equal(readFileSync(join(suivante, '../../../bundle.js'), 'utf-8'), readFileSync(join(complete, '../../../bundle.js'), 'utf-8'))
  })
})
