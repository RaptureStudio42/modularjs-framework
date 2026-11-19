// i18n — sous `@i18n 'page'`, les clés relatives d'un `<script module>` reçoivent le préfixe de la section, comme celles du script et
// du gabarit (une clé absolue `/…` reste entière), et le contrôle de la construction les lit sous ce nom : une clé du module absente
// du dictionnaire est signalée avec sa section ; vraie construction (Bundler), puis le rendu (happy-dom) : le texte traduit à l'écran
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { write } from './helpers/construction-cache.js'
import { attendreEgal } from './helpers/attendre.js'
import { projet } from './helpers/i18n-rendu-projet.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = "@i18n 'page'\n<script module>\nexport titre = -> µt('module')\nexport manque = -> µt('absente')\nexport racine = -> µt('/titre')\n</script>\n<p>{titre()} {manque()} {racine()} {µt('gabarit')}</p>\n"

// construit le composant avec un dictionnaire français (racine et section `page`) : clés lues dans le code produit, avis de la construction
async function construire(texte: string): Promise<{ cles: string[], avis: string[] }> {
  const root   = mjsTmp('i18n-script-module')
  const srcDir = join(root, 'app')
  const outDir = join(root, 'out')
  write(join(srcDir, 'i18n/fr.yml'), 'titre: Bienvenue\n')
  write(join(srcDir, 'i18n/fr/page.yml'), 'module: Texte du module\ngabarit: Texte du gabarit\n')
  write(join(srcDir, 'vue.mjs'), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), i18n: { default: 'fr' } } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const code = readdirSync(outDir).filter(f => f.startsWith('vue') && f.endsWith('.js')).map(f => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  const cles = [...code.matchAll(/µ\??\.t\(\s*(['"`])([^'"`]*)\1/g)].map(m => m[2]).sort()
  return { cles, avis: (stats.warnings ?? []).map((w: any) => String(w.message ?? w)) }
}

describe('i18n — clés d\'un <script module> préfixées par la section', function () {
  this.timeout(120_000)
  after(async () => { await terminateSharedWorkerPool() })

  it('les clés relatives du module reçoivent la section, la clé absolue reste entière', async () => {
    const { cles } = await construire(SOURCE)
    assert.deepEqual(cles, ['page.absente', 'page.gabarit', 'page.module', 'titre'])
  })

  it('le contrôle de la construction lit la clé du module avec sa section', async () => {
    const { avis } = await construire(SOURCE)
    const cles     = avis.filter(a => a.includes('— la clé « '))
    assert.equal(cles.length, 1, cles.join('\n'))
    assert.match(cles[0], /« page\.absente »/)
  })

  it('rendu : le texte d\'une clé du module traduit à l\'écran', async () => {
    const p  = await projet({ graine: true, sources: { vue: "@i18n 'panier'\n<script module>\nexport resume = -> µt('resume')\n</script>\n<p class=\"t\">{resume()}</p>\n" } })
    const el = p.monte('vue')
    await attendreEgal(() => el._shadow?.querySelector('p.t')?.textContent.trim(), 'Résumé du panier', 'le texte de la section panier', 5000)
  })
})
