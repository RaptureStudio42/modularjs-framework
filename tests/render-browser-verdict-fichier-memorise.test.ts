// Moteur navigateur : chaque fichier du dossier de sortie que la page demande passait, à CHAQUE demande, par toute la chaîne de ses
// contrôles (dans le dossier par son texte, puis par son chemin réel : des résolutions de chemin réel). Le verdict est gardé par
// chemin demandé, comme pour `mjs serve` et `mjs dev`, et repris seulement si ce chemin mène toujours au même fichier, inchangé :
// un lien symbolique posé après une première vérification est refusé comme avant.
//
// Garde de disponibilité — même motif que tests/render-browser.test.ts : Chromium optionnel.
import assert from 'node:assert/strict'
import fs, { mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

async function isChromiumAvailable(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

describe('render-browser — le verdict d\'un fichier servi à la page est gardé, jamais pour un chemin devenu dangereux', function () {
  let chromiumReady = false

  before(async function () {
    this.timeout(10000)
    chromiumReady = await isChromiumAvailable()
    if (!chromiumReady) {
      console.log('  ℹ️  Chromium non installé, test render-browser-verdict-fichier-memorise sauté.')
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('un fichier demandé deux fois : la seconde demande ne refait pas la vérification complète ; un lien posé ensuite sur lui est refusé', async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(90000)
    const root   = mjsTmp('render-browser-verdict')
    const donnee = join(root, 'out', 'donnees.txt')
    const secret = join(root, 'dehors', 'secret.txt')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'out'), { recursive: true })
    mkdirSync(join(root, 'dehors'), { recursive: true })
    writeFileSync(donnee, 'DONNEE')
    writeFileSync(secret, 'SECRET HORS DU DOSSIER SERVI')
    writeFileSync(join(root, 'src', 'lecture.mjs'), `
<script>
$p = fetch('/donnees.txt', { cache: 'no-store' }).then((r) -> r.text()).then((a) -> fetch('/donnees.txt', { cache: 'no-store' }).then((r) -> r.text()).then((b) -> a + '|' + b))
</script>
{await $p}<span class="pending">attente</span>{success s}<span class="lu">{s}</span>{end}
`)
    // compte les vérifications complètes du chemin réel du fichier demandé (forme JavaScript) ; la forme native relit seulement,
    // à chaque reprise du verdict, le chemin demandé et le dossier servi
    const vrai      = fs.realpathSync
    let resolutions = 0
    const espion: any = (p: fs.PathLike, o?: any) => { if (String(p).endsWith('donnees.txt')) resolutions++; return vrai(p, o) }
    espion.native   = (p: fs.PathLike, o?: any) => vrai.native(p, o)
    const renderer  = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', render: { browserPool: { size: 1 } } }, { configDir: root })
    try {
      ;(fs as any).realpathSync = espion
      syncBuiltinESMExports()
      const lu = (html: string) => (html.match(/<span class="lu">([^<]*)<\/span>/) || [])[1]
      const r1 = await renderer.renderPage('mjs-lecture', { settleMs: 5000 })
      assert.equal(lu(r1.html), 'DONNEE|DONNEE', 'html : ' + r1.html.slice(0, 300))
      assert.equal(resolutions, 1, 'une seule vérification complète du chemin réel pour deux demandes')
      // le fichier remplacé par un lien vers un fichier hors du dossier servi, après la première vérification
      rmSync(donnee)
      symlinkSync(secret, donnee)
      const r2 = await renderer.renderPage('mjs-lecture', { settleMs: 5000 })
      const vu2 = lu(r2.html)
      assert.ok(vu2 !== undefined, 'rendu abouti : ' + r2.html.slice(0, 300))
      assert.ok(!vu2.includes('SECRET') && !r2.html.includes('SECRET'), 'le lien posé après coup est refusé : ' + vu2)
    } finally {
      ;(fs as any).realpathSync = vrai
      syncBuiltinESMExports()
      await renderer.close()
    }
  })
})
