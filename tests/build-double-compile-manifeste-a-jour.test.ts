// le build compile DEUX fois — pourquoi ces essais existent.
//
// `mjs build` compile une première fois (`bundler.compile()`), puis le prérendu RECOMPILE dans le même
// dossier de sortie (second `Bundler`, un par moteur de rendu). Si une source change entre les deux (un
// outil, un éditeur, un autre build), le second compile écrit d'autres empreintes et supprime les
// anciennes fichiers. Or l'assemblage (fichier de page, fichier de groupe, liens de préchargement des
// fragments) lisait le manifeste du PREMIER compile : il cherchait des fichiers disparus. Le message
// (« l'assemblage du fichier de page a échoué ») masquait la cause, et pire, avec `render.startup:
// 'preload'` les fragments pouvaient recevoir des liens `modulepreload` vers des fichiers disparus avec
// une sortie 0 : un build « réussi » mais cassé.
//
// Règle : l'assemblage lit le manifeste du DERNIER compile (`latestBundler`, alimenté par
// `PrerenderReport.bundler`) ; et si malgré tout un fichier annoncé n'existe plus, une erreur claire
// (« le dossier de sortie a été recompilé avec d'autres empreintes… relancez le build »), jamais un
// fragment qui ment avec une sortie 0.
//
// Pour supprimer le second compile un jour : le prérendu devrait recevoir le `Bundler` du build (ou son
// manifeste et ses unités compilées) au lieu d'en créer un ; `createSSRRenderer` et `createBrowserRenderer`
// compilent pour servir le rendu et lisent les unités une à une depuis le dossier de sortie.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { prerenderPages, type PrerenderReport } from '../src/server/prerender.js'
import { emitStartup, latestBundler } from '../src/bundler/startup.js'

interface Projet { root: string; srcDir: string; outDir: string }

function projet(etiquette: string, startup: 'bundle' | 'preload', extra: Record<string, unknown> = {}): Projet {
  const root   = mjsTmp('double-compile-' + etiquette)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'card.mjs'), '<p class="card">carte</p>\n')
  writeFileSync(join(srcDir, 'badge.mjs'), '<b class="badge">neuf</b>\n')
  writeFileSync(join(srcDir, 'home.mjs'), '<h1 class="t">accueil</h1>\n<mjs-card></mjs-card>\n<mjs-badge></mjs-badge>\n')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', ...extra,
    render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup, routes: { '/': { component: 'mjs-home' } } },
  }, null, 2))
  return { root, srcDir, outDir: join(root, 'out') }
}

// compile nº 1, une source change, puis le prérendu recompile (compile nº 2) : l'état du build divergent
async function compilerPuisModifier(p: Projet): Promise<{ premier: Bundler; report: PrerenderReport; found: NonNullable<ReturnType<typeof findConfig>> }> {
  const found = findConfig(p.root)!
  const premier = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
  const stats   = await premier.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  writeFileSync(join(p.srcDir, 'card.mjs'), '<p class="card">carte modifiée entre les deux compilations</p>\n')
  const report = await prerenderPages(found.config, found.configDir, () => {}, { env: 'prod' })
  assert.ok(report.generated.length > 0, 'pages ignorées : ' + JSON.stringify(report.skipped))
  return { premier, report, found }
}

const fichiers = (p: Projet): string[] => readdirSync(p.outDir)
const hrefsDuFragment = (texte: string): string[] => [...texte.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1])

describe('build : le prérendu recompile le dossier de sortie — l\'assemblage lit le manifeste du dernier compile', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la divergence est réelle : le second compile a remplacé le fichier de card, le premier manifeste le nomme encore', async () => {
    const p = projet('diverge', 'bundle')
    const { premier, report } = await compilerPuisModifier(p)
    const ancien = basename(premier.manifest['card'])
    assert.equal(existsSync(join(p.outDir, ancien)), false, 'l\'ancien fichier de card a disparu')
    assert.notEqual(basename(report.bundler!.manifest['card']), ancien, 'le dernier manifeste nomme le nouveau')
    assert.equal(latestBundler(premier, report), report.bundler, 'latestBundler choisit le dernier')
    await premier.close()
  })

  it('startup: bundle : l\'assemblage par le dernier manifeste réussit, le fichier de page contient la source modifiée', async () => {
    const p = projet('bundle', 'bundle')
    const { premier, report, found } = await compilerPuisModifier(p)
    await emitStartup(latestBundler(premier, report), found.config.render, report, { prod: true })
    const pages = fichiers(p).filter(f => /^mjs_page-index-[0-9a-z]{5}\.js$/.test(f))
    assert.equal(pages.length, 1)
    assert.ok(readFileSync(join(p.outDir, pages[0]), 'utf-8').includes('carte modifiée'), 'le fichier de page porte la source la plus récente')
    await premier.close()
  })

  it('startup: bundle avec le premier manifeste : erreur CLAIRE (recompilé, relancez), plus « l\'assemblage a échoué »', async () => {
    const p = projet('bundle-garde', 'bundle')
    const { premier, report, found } = await compilerPuisModifier(p)
    await assert.rejects(
      () => emitStartup(premier, found.config.render, report, { prod: true }),
      (e: Error) => /recompilé avec d'autres empreintes/.test(e.message) && /relancez/.test(e.message) && !/assemblage du fichier de page a échoué/.test(e.message),
    )
    await premier.close()
  })

  it('startup: preload : les liens du fragment nomment des fichiers qui existent tous (dernier manifeste)', async () => {
    const p = projet('preload', 'preload')
    const { premier, report, found } = await compilerPuisModifier(p)
    await emitStartup(latestBundler(premier, report), found.config.render, report, { prod: true })
    const hrefs = hrefsDuFragment(readFileSync(report.generated[0].file, 'utf-8'))
    assert.ok(hrefs.length > 0, 'des liens sont posés')
    for (const h of hrefs) assert.ok(existsSync(join(p.outDir, basename(h))), `${h} existe`)
    await premier.close()
  })

  it('startup: preload avec le premier manifeste : le build échoue au lieu d\'écrire des liens vers des fichiers disparus', async () => {
    const p = projet('preload-garde', 'preload')
    const { premier, report, found } = await compilerPuisModifier(p)
    await assert.rejects(
      () => emitStartup(premier, found.config.render, report, { prod: true }),
      /recompilé avec d'autres empreintes/,
    )
    // aucun lien vers un fichier disparu n'a été écrit dans le fragment
    for (const h of hrefsDuFragment(readFileSync(report.generated[0].file, 'utf-8'))) assert.ok(existsSync(join(p.outDir, basename(h))), `${h} existe`)
    await premier.close()
  })

  it('sans divergence : latestBundler rend le dernier compile, tout est cohérent, aucune erreur', async () => {
    const p = projet('sain', 'bundle')
    const found = findConfig(p.root)!
    const premier = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
    await premier.compile()
    const report = await prerenderPages(found.config, found.configDir, () => {}, { env: 'prod' })
    await emitStartup(latestBundler(premier, report), found.config.render, report, { prod: true })
    assert.equal(fichiers(p).filter(f => /^mjs_page-/.test(f)).length, 1)
    await premier.close()
  })

  it('le dossier de sortie d\'un autre emplacement (fichier unique) : le premier bundler reste celui qui fait foi', async () => {
    const p = projet('unique', 'preload')
    const found = findConfig(p.root)!
    const premier = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
    const faux = { outputDir: join(p.root, 'ailleurs'), jsMode: 'split' } as any
    assert.equal(latestBundler(premier, { bundler: faux } as any), premier, 'dossier différent : le premier')
    await premier.close()
  })
})
