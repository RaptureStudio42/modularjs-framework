// préchargement des routes : la liste des pages confiée au routeur (`µ._mjs_routesIdle`) est lue dans la table affectée à `@routes`,
// même quand le script lit `@routes` plus haut, dans une méthode qui porte elle-même un objet (`µtoast { texte: 'fade-in' }`) : sans
// quoi les vraies pages ne partaient pas d'avance et un nom pris dans cet objet était demandé comme page ; vraie construction (Bundler)
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { write } from './helpers/construction-cache.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

// listes passées à `µ._mjs_routesIdle` dans le code produit de la page
async function pagesAuRepos(nom: string, script: string): Promise<string[][]> {
  const root = mjsTmp('routes-repos-' + nom)
  write(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m' }, null, 2) + '\n')
  write(join(root, `app/${nom}.page.mjs`), `<script>\n${script}\n</script>\n<@view></@view>\n`)
  const found   = findConfig(root)!
  const bundler = new Bundler(resolveBundlerOpts(found.config, found.configDir) as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const out  = join(root, 'public/m')
  const code = readdirSync(out).filter(f => f.startsWith(nom) && f.endsWith('.js')).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
  return [...code.matchAll(/µ\._mjs_routesIdle\?\.\(([^)]*)\)/g)].map(m => JSON.parse(m[1]))
}

const TABLE = "@routes =\n  '/': 'home-page'\n  '/b': 'b-page'"

describe('préchargement des routes — la table affectée à @routes', function () {
  this.timeout(120_000)
  after(async () => { await terminateSharedWorkerPool() })

  it('table seule : ses pages partent au repos', async () => {
    assert.deepEqual(await pagesAuRepos('ra', TABLE), [['home-page', 'b-page']])
  })

  it('@routes lu plus haut par une méthode qui porte un objet : les pages de la table, rien de l\'objet', async () => {
    assert.deepEqual(await pagesAuRepos('rc', "@aller = (p) ->\n  if @routes[p] then µtoast { texte: 'fade-in' }\n" + TABLE), [['home-page', 'b-page']])
  })
})
