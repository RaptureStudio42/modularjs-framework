// Composant léger (`mjs-light`) posé dans l'ombre d'un composant hôte, sous CSP (`µ._csp`), dans Chromium, Firefox et
// WebKit réels : sa feuille est une CSSStyleSheet construite, adoptée par l'ombre de l'hôte. Le léger, créé par le
// constructeur de l'hôte, se connecte AVANT lui : l'hôte, en posant ensuite ses propres feuilles, écrasait celle du léger,
// resté sans style jusqu'à une reconnexion. Règle : dès le premier montage (balise posée par le code, ou présente dans
// la page avant le script), le style du léger s'applique, sa feuille est adoptée une seule fois, et elle le reste quand
// l'hôte change de place. Sans CSP, le `<style>` du léger posé dans l'ombre de l'hôte fait de même (témoin).

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

const ENFANT = [
  '<script lang="coffee">',
  '$titre = "salut"',
  '</script>',
  '<p class="t">{$titre}</p>',
  '<style>',
  ':host',
  '  padding: 1px',
  '.t',
  '  color: rgb(200, 10, 20)',
  '</style>',
].join('\n')

const HOTE = [
  '<div class="cadre">',
  '  <@enfantcsp mjs-light>',
  '</div>',
  '<style>',
  '.cadre',
  '  margin: 2px',
  '</style>',
].join('\n')

const ROUGE = 'rgb(200, 10, 20)'

// le code des composants, le cœur d'abord (développement : runtime en clair), `µ._csp` posé avant leur définition
let code = ''

describe('léger dans une ombre : son style dès le premier montage (navigateurs réels)', function () {
  this.timeout(120000)

  before(async () => {
    const root   = mjsTmp('leger-csp-premier-montage')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'enfantcsp.mjs'), ENFANT)
    writeFileSync(join(srcDir, 'hotecsp.mjs'), HOTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const ordre = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
    assert.ok(ordre.some((f) => f.startsWith('enfantcsp')) && ordre.some((f) => f.startsWith('hotecsp')), `sortie du build inattendue : ${files.join(', ')}`)
    code = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8')) + (rang(f) === 0 ? '\nglobalThis.µ = µ;\nif (globalThis.__csp) µ._csp = true;\n' : '')).join('\n')
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false
      before(async () => { present = await navigateurPresent(nom) })

      // `corps` : le HTML de la page avant le script ; `fn` reçoit la page, les composants définis
      async function essai(csp: boolean, corps: string, fn: (page: any) => Promise<void>) {
        const playwright = await import('playwright')
        const browser    = await playwright[nom].launch()
        try {
          const page = await browser.newPage()
          const erreurs: string[] = []
          page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${corps}<script>globalThis.__csp = ${csp};</script><script>${code}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!customElements.get('mjs-hotecsp') && !!customElements.get('mjs-enfantcsp'))
          await fn(page)
          assert.deepEqual(erreurs, [], 'aucune erreur en console')
          await page.close()
        } finally {
          await browser.close()
        }
      }

      // le léger rendu dans l'ombre de l'hôte, puis le temps que tout se pose
      const pret = async (page: any) => {
        await page.waitForFunction(() => {
          const h: any = document.querySelector('mjs-hotecsp')
          return !!h && !!h._shadow && !!h._shadow.querySelector('mjs-enfantcsp .t')
        })
        await page.waitForTimeout(100)
      }

      // ce que voit l'ombre de l'hôte : couleur calculée du paragraphe du léger, adoptions de sa feuille, `<style>` posés
      const etat = (page: any) => page.evaluate(() => {
        const h: any = document.querySelector('mjs-hotecsp')
        const p = h._shadow.querySelector('mjs-enfantcsp .t')
        const texte = (s: any) => Array.from(s.cssRules).map((r: any) => r.cssText).join(' ')
        return {
          couleur: getComputedStyle(p).color,
          adoptions: h._shadow.adoptedStyleSheets.filter((s: any) => texte(s).indexOf('mjs-enfantcsp') !== -1).length,
          styles: h._shadow.querySelectorAll('style[data-mjs-light="mjs-enfantcsp"]').length
        }
      })

      // l'hôte déplacé dix fois entre deux boîtes
      const deplacer = async (page: any) => {
        for (let i = 0; i < 10; i++) {
          await page.evaluate((n: number) => { document.getElementById(n % 2 ? 'a' : 'b')!.appendChild(document.querySelector('mjs-hotecsp')!) }, i)
          await page.waitForTimeout(20)
        }
        await page.waitForTimeout(100)
      }

      it('sous CSP, hôte posé par le code : le style du léger s\'applique dès le premier montage, feuille adoptée une fois', async function () {
        if (!present) { this.skip(); return }
        await essai(true, '<div id="a"></div><div id="b"></div>', async (page) => {
          await page.evaluate(() => { document.getElementById('a')!.innerHTML = '<mjs-hotecsp></mjs-hotecsp>' })
          await pret(page)
          assert.deepEqual(await etat(page), { couleur: ROUGE, adoptions: 1, styles: 0 }, 'premier montage')
          await deplacer(page)
          assert.deepEqual(await etat(page), { couleur: ROUGE, adoptions: 1, styles: 0 }, 'après dix déplacements de l\'hôte')
        })
      })

      it('sous CSP, hôte présent dans la page avant le script : même règle', async function () {
        if (!present) { this.skip(); return }
        await essai(true, '<div id="a"><mjs-hotecsp></mjs-hotecsp></div><div id="b"></div>', async (page) => {
          await pret(page)
          assert.deepEqual(await etat(page), { couleur: ROUGE, adoptions: 1, styles: 0 }, 'premier montage')
          await deplacer(page)
          assert.deepEqual(await etat(page), { couleur: ROUGE, adoptions: 1, styles: 0 }, 'après dix déplacements de l\'hôte')
        })
      })

      it('sans CSP (témoin) : le `<style>` du léger dans l\'ombre de l\'hôte, posé une fois, dès le premier montage', async function () {
        if (!present) { this.skip(); return }
        await essai(false, '<div id="a"></div><div id="b"></div>', async (page) => {
          await page.evaluate(() => { document.getElementById('a')!.innerHTML = '<mjs-hotecsp></mjs-hotecsp>' })
          await pret(page)
          assert.deepEqual(await etat(page), { couleur: ROUGE, adoptions: 0, styles: 1 }, 'premier montage')
          await deplacer(page)
          assert.deepEqual(await etat(page), { couleur: ROUGE, adoptions: 0, styles: 1 }, 'après dix déplacements de l\'hôte')
        })
      })
    })
  }
})
