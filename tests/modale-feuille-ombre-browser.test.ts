// µ.modal et µ.modal.notify dans Chromium, Firefox et WebKit réels, en plein écran RÉEL (API Fullscreen). Pendant un plein
// écran, la modale (et le conteneur des notifications) se pose dans l'ombre du composant qui contient l'élément plein
// écran, et y adopte sa feuille. ModularJS remet à zéro les feuilles d'un composant à chaque variante de mise en page et
// à chaque connexion, et ne garde que les feuilles marquées : celle de la modale doit y survivre, sinon la boîte ouverte
// (ou le conteneur des notifications, resté dans l'ombre) perd d'un coup toute sa mise en forme, `position: fixed` compris.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SCENE = `<script>
@ask  = -> µ.modal.fire({ title: 'Question' })
@tell = -> µ.modal.notify({ title: 'Info', text: 'bonjour' })
</script>
<div class="scene"><p class="a">scène</p></div>
<style>
.a
  color: rgb(1, 2, 3)
</style>
<style name="large">
.a
  color: rgb(9, 9, 9)
</style>
`

const BASE  = 'rgb(1, 2, 3)'
const LARGE = 'rgb(9, 9, 9)'

// le build de développement (le runtime en clair) comme celui de production (minifié, un seul module : les noms internes
// sont raccourcis, la marque de conservation posée par la modale et sa lecture par le cœur doivent s'accorder)
for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ['dev', 'prod'] as const) {
  describe(`feuille de la modale dans l'ombre d'un composant (${nom} réel, build de ${env === 'prod' ? 'production' : 'développement'})`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let prod    = ''
    let outDir  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de la feuille de la modale sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('modale-feuille-ombre-' + nom)
      const srcDir = join(root, 'src')
      outDir       = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'scene.mjs'), SCENE)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(env === 'prod' ? { env: 'prod', js: 'bundle' } : {}) } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      if (env === 'prod') {
        prod = readFileSync(join(root, 'bundle.js'), 'utf-8')
        assert.equal(prod.includes('_mjs_keep'), false, 'les noms internes sont bien raccourcis dans ce build')
        return
      }
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    async function essai(fn: (page: any) => Promise<void>) {
      const playwright = await import('playwright')
      const browser    = await playwright[nom].launch()
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        // le seul avertissement attendu : Firefox note la sortie du plein écran quand l'élément qui l'occupe quitte la page
        page.on('console', (m: any) => { if ((m.type() === 'error' || m.type() === 'warning') && !/Exited fullscreen because fullscreen element was removed/.test(m.text())) erreurs.push(m.text()) })
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        const code = env === 'prod' ? '<script type="module" src="/bundle.js"></script>' : `<script>${script}</script>`
        await page.route('http://t.test/**', (route: any) => {
          const url = new URL(route.request().url())
          if (env === 'prod' && url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: prod })
          if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-scene></mjs-scene>${code}</body></html>` })
          // le fichier du variant de mise en page, demandé à l'exécution
          const fichier = join(outDir, url.pathname.split('/').pop() || '')
          if (/\.css$/.test(fichier) && existsSync(fichier)) return route.fulfill({ contentType: 'text/css', body: readFileSync(fichier, 'utf-8') })
          return route.fulfill({ status: 404, body: '' })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-scene') as any)?._shadow?.querySelector('.a'))
        await page.waitForTimeout(150)
        await fn(page)
        assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement en console')
        await page.close()
      } finally {
        await browser.close()
      }
    }

    // l'élément de l'ombre passe en plein écran (vrai plein écran du navigateur) : l'hôte est alors `document.fullscreenElement`
    const pleinEcran = async (page: any) => {
      await page.evaluate(() => (document.querySelector('mjs-scene') as any)._shadow.querySelector('.scene').requestFullscreen())
      await page.waitForFunction(() => document.fullscreenElement === document.querySelector('mjs-scene'))
    }

    // où est le nœud demandé (l'ombre du composant, le corps, nulle part) et ce que le navigateur calcule pour sa position :
    // `fixed` quand la feuille de la modale s'applique, `static` sans elle
    const etat = (page: any, selecteur: string): Promise<{ lieu: string, position: string }> => page.evaluate((sel: string) => {
      const dansOmbre = (document.querySelector('mjs-scene') as any)._shadow.querySelector(sel)
      const dansCorps = document.body.querySelector(sel)
      const noeud     = dansOmbre || dansCorps
      return { lieu: dansOmbre ? 'ombre' : dansCorps ? 'corps' : 'nulle part', position: noeud ? getComputedStyle(noeud).position : 'sans objet' }
    }, selecteur)

    const couleur = (page: any): Promise<string> => page.evaluate(() => getComputedStyle((document.querySelector('mjs-scene') as any)._shadow.querySelector('.a')).color)

    // le composant prend la variante de mise en page `large` : ses feuilles sont reposées, la sienne arrive par le réseau
    const variante = async (page: any) => {
      await page.evaluate(() => document.querySelector('mjs-scene')!.setAttribute('layout', 'large'))
      await page.waitForFunction((attendu: string) => getComputedStyle((document.querySelector('mjs-scene') as any)._shadow.querySelector('.a')).color === attendu, LARGE)
    }

    // sort le composant de la page puis le remet : ModularJS rejoue l'adoption de ses feuilles
    const sortirRemettre = async (page: any) => {
      await page.evaluate(() => { const h = document.querySelector('mjs-scene') as any; (window as any).__h = h; h.remove() })
      await page.waitForTimeout(150)
      await page.evaluate(() => document.body.appendChild((window as any).__h))
      await page.waitForTimeout(400)
    }

    it('la modale ouverte dans l\'ombre garde sa mise en forme quand le composant change de variante de mise en page', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        assert.equal(await couleur(page), BASE)
        await pleinEcran(page)
        await page.evaluate(() => { (document.querySelector('mjs-scene') as any).ask() })
        await page.waitForFunction(() => !!(document.querySelector('mjs-scene') as any)._shadow.querySelector('.mjs-modal-backdrop'))
        assert.deepEqual(await etat(page, '.mjs-modal-backdrop'), { lieu: 'ombre', position: 'fixed' }, 'ouverte : posée dans l\'ombre, mise en forme')
        await variante(page)
        assert.deepEqual(await etat(page, '.mjs-modal-backdrop'), { lieu: 'ombre', position: 'fixed' }, 'après la variante : toujours mise en forme')
      })
    })

    it('le conteneur des notifications resté dans l\'ombre garde sa mise en forme, et la suivante aussi', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await pleinEcran(page)
        await page.evaluate(() => { (document.querySelector('mjs-scene') as any).tell() })
        await page.waitForFunction(() => !!(document.querySelector('mjs-scene') as any)._shadow.querySelector('.mjs-toasts'))
        assert.deepEqual(await etat(page, '.mjs-toasts'), { lieu: 'ombre', position: 'fixed' }, 'posé dans l\'ombre, mis en forme')
        await variante(page)
        assert.deepEqual(await etat(page, '.mjs-toasts'), { lieu: 'ombre', position: 'fixed' }, 'après la variante : toujours mis en forme')
        await page.evaluate(() => { (document.querySelector('mjs-scene') as any).tell() })
        await page.waitForFunction(() => (document.querySelector('mjs-scene') as any)._shadow.querySelectorAll('.mjs-toast').length === 2)
        assert.deepEqual(await etat(page, '.mjs-toasts'), { lieu: 'ombre', position: 'fixed' }, 'une deuxième notification : le conteneur reste mis en forme')
      })
    })

    it('le composant sort de la page puis revient pendant que la modale est ouverte : elle garde sa mise en forme, où qu\'elle soit', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await pleinEcran(page)
        await page.evaluate(() => { (document.querySelector('mjs-scene') as any).ask() })
        await page.waitForFunction(() => !!(document.querySelector('mjs-scene') as any)._shadow.querySelector('.mjs-modal-backdrop'))
        assert.deepEqual(await etat(page, '.mjs-modal-backdrop'), { lieu: 'ombre', position: 'fixed' })
        await sortirRemettre(page)
        // le plein écran se termine avec la sortie de la page ; selon le navigateur et le moment, la modale est déjà revenue dans le corps
        // (feuille du document) ou attend encore dans l'ombre du composant remis (WebKit n'annonce pas toujours la fin du plein écran)
        const apres = await etat(page, '.mjs-modal-backdrop')
        assert.equal(apres.position, 'fixed', `après la sortie et le retour de la page : modale dans ${apres.lieu}, position ${apres.position}`)
      })
    })

    it('la fin du plein écran n\'est pas annoncée (WebKit la perd parfois) : la modale restée dans l\'ombre du composant remis garde sa mise en forme', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await pleinEcran(page)
        // l'annonce de la fin du plein écran n'atteint pas la modale, comme dans un WebKit qui la perd
        await page.evaluate(() => document.addEventListener('fullscreenchange', (e) => e.stopImmediatePropagation(), true))
        await page.evaluate(() => { (document.querySelector('mjs-scene') as any).ask() })
        await page.waitForFunction(() => !!(document.querySelector('mjs-scene') as any)._shadow.querySelector('.mjs-modal-backdrop'))
        await sortirRemettre(page)
        assert.deepEqual(await etat(page, '.mjs-modal-backdrop'), { lieu: 'ombre', position: 'fixed' }, 'composant remis : la modale est toujours dans son ombre, mise en forme')
      })
    })

    it('la modale ouverte dans le corps, sans plein écran, n\'est pas touchée par une variante du composant', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await page.evaluate(() => { (document.querySelector('mjs-scene') as any).ask() })
        await page.waitForFunction(() => !!document.body.querySelector('.mjs-modal-backdrop'))
        assert.deepEqual(await etat(page, '.mjs-modal-backdrop'), { lieu: 'corps', position: 'fixed' })
        await variante(page)
        assert.deepEqual(await etat(page, '.mjs-modal-backdrop'), { lieu: 'corps', position: 'fixed' })
      })
    })
  })
}
