// Projet multi-langue (`render.locales`, ≥ 2 entrées) : le prérendu écrit chaque page SOUS un
// dossier de langue (`outDir/<langue>/<page>`, cf. server/prerender.ts), jamais à plat
// (`outDir/<page>`). Le rendu À LA DEMANDE (render-request.ts, `mjs serve`/`mjs dev`) cherchait
// pourtant TOUJOURS le chemin PLAT — introuvable dès que `locales` est configuré — et retombait
// systématiquement sur une recompilation SSR, ignorant la page déjà figée au build.
//
// Sous-processus RÉELS (`mjs build` puis `mjs serve`) sur un projet fixture, jamais dans le dépôt.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { PRERENDER_MARK } from '../src/server/prerender.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const COMPOSANT = [
  '<script>',
  "$titre = 'Accueil-locales'",
  '</script>',
  '',
  '<h1 class="t">{$titre}</h1>',
].join('\n') + '\n'

function fixtureProject(): string {
  const root = mjsTmp('render-request-locales')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'app-home.mjs'), COMPOSANT)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src',
    outputDir: 'public/modularjs',
    i18n: { default: 'fr' },
    render: { default: 'prerender', locales: ['fr', 'en'], routes: { '/': { component: 'mjs-app-home' } } },
  }, null, 2))
  return root
}

async function lanceServeEtLisPage(root: string): Promise<{ html: string; sortie: string; arreter: () => Promise<void> }> {
  const enfant = spawn(tsxBin, [cliPath, 'serve', '--root', root, '--port', '0'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  let sortie = ''
  enfant.stdout.on('data', (d: Buffer) => { sortie += d.toString() })
  enfant.stderr.on('data', (d: Buffer) => { sortie += d.toString() })
  const fini = new Promise<void>(resolve => enfant.on('exit', () => resolve()))
  const debut = Date.now()
  while (Date.now() - debut < 30000 && !/127\.0\.0\.1:(\d+)/.test(sortie) && enfant.exitCode === null) await new Promise(r => setTimeout(r, 100))
  assert.match(sortie, /127\.0\.0\.1:(\d+)/, `mjs serve doit démarrer. Sortie :\n${sortie}`)
  const port = Number(/127\.0\.0\.1:(\d+)/.exec(sortie)![1])
  const arreter = async () => {
    enfant.kill('SIGINT')
    await Promise.race([fini, new Promise<void>(r => setTimeout(r, 8000))])
    if (enfant.exitCode === null) { enfant.kill('SIGKILL'); await fini }
  }
  try {
    const rep = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(rep.status, 200, `page attendue en 200, sortie :\n${sortie}`)
    return { html: await rep.text(), sortie, arreter }
  } catch (e) {
    await arreter()
    throw e
  }
}

describe('render-request — prérendu multi-langue (render.locales) servi À LA DEMANDE', function () {
  this.timeout(60000)

  it('mjs build écrit bien un dossier PAR LANGUE, jamais de fichier plat (contrôle du contrat)', () => {
    const root = fixtureProject()
    const result = spawnSync(tsxBin, [cliPath, 'build', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
    assert.equal(result.status, 0, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`)
    // `outputDir: 'public/modularjs'` déclaré → `outDir` du prérendu = `dirname(outputDir)/mjs_pages`
    // = `public/mjs_pages` (cf. server/render-request.ts, `pagesDir`, même calcul des deux côtés).
    assert.ok(existsSync(join(root, 'public', 'mjs_pages', 'fr', 'index.html')), 'page prérendue fr attendue')
    assert.ok(existsSync(join(root, 'public', 'mjs_pages', 'en', 'index.html')), 'page prérendue en attendue')
    assert.ok(!existsSync(join(root, 'public', 'mjs_pages', 'index.html')), 'AUCUN chemin plat quand locales est configuré (contrat prerender.ts)')
  })

  it("GET '/' sert la page prérendue FIGÉE (langue par défaut), jamais une recompilation SSR à la volée", async () => {
    const root = fixtureProject()
    const build = spawnSync(tsxBin, [cliPath, 'build', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
    assert.equal(build.status, 0, `stderr:\n${build.stderr}`)

    const { html, sortie, arreter } = await lanceServeEtLisPage(root)
    try {
      // BUG confirmé si le marqueur du prérendu est absent : render-request.ts aurait cherché le
      // chemin PLAT (jamais écrit ici) et serait retombé sur une recompilation SSR à la volée.
      assert.ok(html.includes(PRERENDER_MARK), `BUG confirmé si la page prérendue (bandeau ${JSON.stringify(PRERENDER_MARK)}) n'est pas servie telle quelle. html :\n${html.slice(0, 400)}\nsortie serveur :\n${sortie}`)
      assert.match(html, /Accueil-locales/, `le contenu attendu doit être présent, html :\n${html.slice(0, 400)}`)
    } finally {
      await arreter()
    }
  })
})
