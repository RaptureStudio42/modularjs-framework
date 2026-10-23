// Le survol (`@pointerenter`, `@pointerleave`) d'un composant ne lit que les nœuds qu'IL a écrits. Sans
// ombre pour séparer deux composants (un composant léger posé chez un autre), leurs nœuds se côtoient dans
// le même arbre, et leurs identifiants de routage (numérotés par composant : « e1 » chez l'un comme chez
// l'autre) se confondent : entrer dans un nœud du composant léger ne doit pas jouer le gestionnaire du
// nœud du parent qui porte le même identifiant. Défaut garanti absent : le filtre « nœud écrit par moi »
// du routeur de survol retiré ne faisait rougir aucun test.
// Gardes : entrer dans son propre nœud joue son gestionnaire, une fois ; le parent garde son survol.
// Chromium et Firefox, vraie souris (Playwright) : c'est le navigateur qui fabrique les événements de survol.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const STYLE = '<style>\n.zone\n  display: block\n  width: 200px\n  height: 60px\n</style>\n'

const SOURCES: Record<string, string> = {
  'survol-feuille.mjs': [
    '<script>',
    '$entrees = 0',
    '$sorties = 0',
    '</script>',
    '<div class="zone feuille" @pointerenter={$entrees++} @pointerleave={$sorties++}>feuille</div>',
    '<p class="r">{$entrees}/{$sorties}</p>'
  ].join('\n') + '\n' + STYLE,
  'survol-hote.mjs': [
    '<script>',
    '$entrees = 0',
    '$sorties = 0',
    '</script>',
    '<div class="zone hote" @pointerenter={$entrees++} @pointerleave={$sorties++}>hôte</div>',
    '<@survol-feuille @lightDom/>',
    '<p class="r">{$entrees}/{$sorties}</p>'
  ].join('\n') + '\n' + STYLE
}

for (const nomNavigateur of ['chromium', 'firefox'] as const) {
  describe('survol d\'un composant léger posé chez un autre : chacun ses nœuds (' + nomNavigateur + ' réel)', function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let navigateur: any

    before(async function () {
      present = await navigateurPresent(nomNavigateur)
      if (!present) {
        console.log('  ℹ️  ' + nomNavigateur + ' non installé, test du survol sauté. Activer : `npx playwright install ' + nomNavigateur + '`')
        return
      }
      const root   = mjsTmp('survol-voisins')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
      script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      const playwright = await import('playwright')
      navigateur = await playwright[nomNavigateur].launch()
    })

    after(async () => {
      if (navigateur) await navigateur.close()
      await terminateSharedWorkerPool()
    })

    it('entrer dans le nœud du composant léger ne joue pas le gestionnaire du parent qui porte le même identifiant ; sortir non plus', async function () {
      if (!present) { this.skip(); return }
      const page = await navigateur.newPage()
      try {
        const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><mjs-survol-hote></mjs-survol-hote><script>${script}</script></body></html>`
        await page.route('http://mjs.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
        await page.goto('http://mjs.test/')
        await page.waitForFunction(() => !!(document.querySelector('mjs-survol-hote') as any)?._shadow?.querySelector('mjs-survol-feuille .feuille'))
        const centre = (sel: string) => page.evaluate((s: string) => {
          const r = (document.querySelector('mjs-survol-hote') as any)._shadow.querySelector(s).getBoundingClientRect()
          return [r.x + r.width / 2, r.y + r.height / 2]
        }, sel)
        const compteurs = () => page.evaluate(() => {
          const racine = (document.querySelector('mjs-survol-hote') as any)._shadow
          return { parent: ([...racine.children] as any[]).find((n) => n.matches('p.r')).textContent, feuille: racine.querySelector('mjs-survol-feuille .r').textContent }
        })
        // le pointeur part de la page (hors des zones), puis entre dans la feuille
        await page.mouse.move(400, 400)
        const [fx, fy] = await centre('mjs-survol-feuille .feuille')
        await page.mouse.move(fx, fy, { steps: 4 })
        await page.waitForTimeout(100)
        assert.deepEqual(await compteurs(), { parent: '0/0', feuille: '1/0' }, 'entrée dans la feuille : seule la feuille la compte')
        // le pointeur sort de la feuille vers le nœud du parent
        const [px, py] = await centre('.hote')
        await page.mouse.move(px, py, { steps: 4 })
        await page.waitForTimeout(100)
        assert.deepEqual(await compteurs(), { parent: '1/0', feuille: '1/1' }, 'la feuille a perdu le pointeur, le parent l\'a reçu')
        // le pointeur quitte la page : seul le parent le perdait
        await page.mouse.move(400, 400, { steps: 4 })
        await page.waitForTimeout(100)
        assert.deepEqual(await compteurs(), { parent: '1/1', feuille: '1/1' }, 'sortie du parent : un seul compte de plus')
      } finally { await page.close() }
    })
  })
}
