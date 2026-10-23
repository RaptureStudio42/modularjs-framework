// mjs_devpanel dans Chromium et Firefox réels : ce que le clavier et la sélection font au panneau.
//   - un réglage changé au clavier (une flèche sur un menu, Entrée dans un nombre) redessine le panneau : le focus
//     revient au contrôle redessiné — il tombait sur <body> —, Échap ferme encore le panneau, et le battement de
//     700 ms n'est pas figé pour autant (il redessine, le focus suit) ;
//   - la fermeture rend le focus là où il était, même dans l'ombre fermée d'un composant (`document.contains` ne
//     traverse pas l'ombre, `document.activeElement` s'y arrête à l'hôte) ;
//   - le repli de « copier l'écriture » (presse-papiers refusé) sélectionne la ligne pour Ctrl+C : le battement de 700 ms
//     et la remise à zéro du bouton, 1,6 s plus tard, n'effacent plus cette sélection tant qu'elle existe.
// WebKit n'est présent que si PLAYWRIGHT_BROWSERS_PATH le donne (le test est alors sauté).

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

const SOURCE = [
  '<script>',
  '$n = 1',
  '</script>',
  '<p class="t">Total : {$n}</p>',
  '<button class="b" @click={$n++}>+</button>',
  '<h1 class="h" *neon(#f0f, size: 2)>x</h1>',
  '<span class="l" *lift>l</span>',
].join('\n')

// la page : un bouton hors de tout composant, puis le composant (son ombre est fermée)
const pageHtml = (script: string) => `<!doctype html><html><head><meta charset="utf-8"></head><body><button id="avant">avant</button><mjs-dpb-page></mjs-dpb-page><script>${script}</script></body></html>`

describe('mjs_devpanel — focus et sélection, dans de vrais navigateurs', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('devpanel-focus-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'dpb-page.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom + ' réel', function () {
      let present = false

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) console.log(`  ℹ️  ${nom} non installé, test du panneau sauté. Activer : \`npx playwright install ${nom}\``)
      })

      // la page ouverte dans un navigateur neuf (une origine sûre : `navigator.clipboard` y existe), refermé après `fn`
      async function avec(fn: (page: any) => Promise<void>) {
        const lanceur = (await import('playwright'))[nom]
        const browser = await lanceur.launch()
        try {
          const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
          await page.route('http://localhost/**', (route: any) => {
            if (route.request().url() !== 'http://localhost/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: pageHtml(script) })
          })
          await page.goto('http://localhost/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!(document.querySelector('mjs-dpb-page') as any)?._shadow?.querySelector('.l'))
          await page.waitForTimeout(150)
          await fn(page)
        }
        finally {
          await browser.close()
        }
      }

      const ouvrirPanneau = async (page: any) => {
        await page.evaluate(() => (window as any).µ.console('mjs-dpb-page'))
        await page.waitForFunction(() => !!(document.querySelector('[data-mjs-devpanel]') as any)?.shadowRoot?.querySelector('[data-action="maj"]'))
      }
      // un clic du DOM sur un contrôle du panneau (le panneau se réécrit toutes les 700 ms : pas de souris réelle ici)
      const cliquer = (page: any, sel: string) => page.evaluate((s: string) => { (document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector(s).click() }, sel)
      // l'élément qui a le focus, en descendant dans les ombres (fermées des composants : `_shadow`, ouverte du panneau)
      const actif = (page: any) => page.evaluate(() => {
        let a: any = document.activeElement
        while (a) {
          const r = a._shadow || a.shadowRoot
          if (!r || !r.activeElement) break
          a = r.activeElement
        }
        if (!a) return null
        return a.tagName + (a.className && typeof a.className === 'string' ? '.' + a.className : '') + (a.id ? '#' + a.id : '') + (a.getAttribute('data-maj') ? '[data-maj=' + a.getAttribute('data-maj') + ']' : '') + (a.getAttribute('data-cle') ? '[data-cle=' + a.getAttribute('data-cle') + ']' : '')
      })
      const panneauPresent = (page: any) => page.evaluate(() => !!document.querySelector('[data-mjs-devpanel]'))

      it('un réglage de l\'éclair changé au clavier (flèche sur un menu) : le panneau est redessiné, le focus est sur le menu redessiné', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          await ouvrirPanneau(page)
          await cliquer(page, '[data-action="maj"]')
          await page.waitForFunction(() => !!(document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector('[data-maj="style"]'))
          await page.evaluate(() => { const s = (document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector('[data-maj="style"]'); (window as any).__vieux = s; (window as any).__valeur = s.value })
          await page.focus('[data-maj="style"]')
          await page.keyboard.press('ArrowDown')
          await page.waitForTimeout(100)
          const r = await page.evaluate(() => { const s = (document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector('[data-maj="style"]'); return { valeur: s.value, avant: (window as any).__valeur, redessine: s !== (window as any).__vieux } })
          assert.notEqual(r.valeur, r.avant, 'la flèche a changé le réglage')
          assert.equal(r.redessine, true, 'le panneau a été redessiné')
          assert.equal(await actif(page), 'SELECT[data-maj=style]', 'le focus est revenu au menu')
        })
      })

      it('… et Échap ferme le panneau ensuite, comme avant le réglage', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          await ouvrirPanneau(page)
          await cliquer(page, '[data-action="maj"]')
          await page.waitForFunction(() => !!(document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector('[data-maj="style"]'))
          await page.focus('[data-maj="style"]')
          await page.keyboard.press('ArrowDown')
          await page.waitForTimeout(100)
          await page.keyboard.press('Escape')
          await page.waitForTimeout(300)
          assert.equal(await panneauPresent(page), false, 'Échap venue du panneau le ferme')
        })
      })

      it('… le battement de 700 ms n\'est pas figé : il redessine, et le focus reste sur le menu', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          await ouvrirPanneau(page)
          await cliquer(page, '[data-action="maj"]')
          await page.waitForFunction(() => !!(document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector('[data-maj="style"]'))
          await page.focus('[data-maj="style"]')
          await page.keyboard.press('ArrowDown')
          await page.waitForTimeout(100)
          await page.evaluate(() => { (window as any).__vieux = (document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector('[data-maj="style"]') })
          await page.waitForTimeout(1500)
          const redessine = await page.evaluate(() => (document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector('[data-maj="style"]') !== (window as any).__vieux)
          assert.equal(redessine, true, 'le battement a redessiné le panneau')
          assert.equal(await actif(page), 'SELECT[data-maj=style]', 'le focus a suivi le menu redessiné')
        })
      })

      it('un réglage d\'un effet changé au clavier (onglet Effets : une flèche sur un menu, Entrée dans un nombre) : le focus est sur le contrôle redessiné, Échap ferme', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          await ouvrirPanneau(page)
          await cliquer(page, '.onglet[data-onglet="effets"]')
          const bloc = (effet: string) => page.evaluate((e: string) => Array.from((document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelectorAll('.fx')).findIndex((b: any) => b.querySelector('.fx-nom').textContent === '*' + e), effet)
          const lift = await bloc('lift')
          const neon = await bloc('neon')
          assert.ok(lift >= 0 && neon >= 0, 'les deux effets sont dans l\'onglet')
          // un menu : la flèche bas
          await page.focus(`.fx[data-fx="${lift}"] [data-cle="on"]`)
          await page.keyboard.press('ArrowDown')
          await page.waitForTimeout(100)
          assert.equal(await actif(page), 'SELECT[data-cle=on]', 'menu : le focus est revenu au contrôle')
          // un nombre : une valeur, puis Entrée
          await page.fill(`.fx[data-fx="${neon}"] [data-cle="size"]`, '3')
          await page.keyboard.press('Enter')
          await page.waitForTimeout(100)
          assert.equal(await actif(page), 'INPUT[data-cle=size]', 'nombre : le focus est revenu au contrôle')
          await page.keyboard.press('Escape')
          await page.waitForTimeout(300)
          assert.equal(await panneauPresent(page), false, 'Échap venue du panneau le ferme')
        })
      })

      it('après un réglage validé par Entrée, on retape dans le champ : le battement ne le réécrit pas sous la frappe', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          await ouvrirPanneau(page)
          await cliquer(page, '.onglet[data-onglet="effets"]')
          const neon = await page.evaluate(() => Array.from((document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelectorAll('.fx')).findIndex((b: any) => b.querySelector('.fx-nom').textContent === '*neon'))
          const champ = `.fx[data-fx="${neon}"] [data-cle="size"]`
          await page.fill(champ, '3')
          await page.keyboard.press('Enter')
          await page.waitForTimeout(100)
          assert.equal(await actif(page), 'INPUT[data-cle=size]', 'le focus est revenu au champ')
          await page.keyboard.type('1')
          await page.evaluate((sel: string) => { (window as any).__champ = (document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector(sel) }, champ)
          await page.waitForTimeout(1500)
          const r = await page.evaluate((sel: string) => { const c = (document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector(sel); return { memeChamp: c === (window as any).__champ, valeur: c.value } }, champ)
          assert.equal(r.memeChamp, true, 'le champ en cours de frappe n\'a pas été réécrit')
          assert.notEqual(r.valeur, '3', 'la frappe est toujours là : ' + r.valeur)
          assert.equal(await actif(page), 'INPUT[data-cle=size]', 'le focus est resté dans le champ')
        })
      })

      it('à la fermeture, le focus revient à l\'élément qu\'il avait quitté : un bouton de la page, et un bouton dans l\'ombre d\'un composant', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          // un bouton de la page
          await page.evaluate(() => (document.getElementById('avant') as any).focus())
          assert.equal(await actif(page), 'BUTTON#avant')
          await page.evaluate(() => (window as any).µ.console(true))
          await page.waitForFunction(() => !!document.querySelector('[data-mjs-devpanel]'))
          assert.equal(await page.evaluate(() => !!(document.activeElement as any)?.hasAttribute('data-mjs-devpanel')), true, 'le focus est entré dans le panneau')
          await page.keyboard.press('Escape')
          await page.waitForTimeout(200)
          assert.equal(await panneauPresent(page), false)
          assert.equal(await actif(page), 'BUTTON#avant', 'le bouton de la page')
          // un bouton dans l'ombre (fermée) d'un composant
          await page.evaluate(() => (document.querySelector('mjs-dpb-page') as any)._shadow.querySelector('.b').focus())
          assert.equal(await actif(page), 'BUTTON.b')
          await page.evaluate(() => (window as any).µ.console(true))
          await page.waitForFunction(() => !!document.querySelector('[data-mjs-devpanel]'))
          assert.equal(await page.evaluate(() => !!(document.activeElement as any)?.hasAttribute('data-mjs-devpanel')), true, 'le focus est entré dans le panneau')
          await page.keyboard.press('Escape')
          await page.waitForTimeout(200)
          assert.equal(await panneauPresent(page), false)
          assert.equal(await actif(page), 'BUTTON.b', 'le bouton dans l\'ombre du composant')
        })
      })

      it('« copier l\'écriture » refusé : la ligne reste sélectionnée pour Ctrl+C, que le battement et la remise à zéro du bouton passent ; la sélection retirée, le battement reprend', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('refusé')) }, configurable: true }) })
          await ouvrirPanneau(page)
          await cliquer(page, '.onglet[data-onglet="effets"]')
          await cliquer(page, '[data-action="fx-copier"]')
          await page.waitForFunction(() => /Ctrl\+C/.test((document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector('[data-action="fx-copier"]').textContent))
          const ligne = await page.evaluate(() => { const c = (document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector('.fx-code'); (window as any).__code = c; return c.textContent })
          assert.equal(await page.evaluate(() => String(window.getSelection())), ligne, 'la ligne est sélectionnée')
          // plus que les 700 ms du battement, plus que les 1,6 s de la remise à zéro du bouton
          await page.waitForTimeout(2500)
          assert.equal(await page.evaluate(() => String(window.getSelection())), ligne, 'la sélection tient')
          assert.equal(await page.evaluate(() => (window as any).__code.isConnected), true, 'le panneau n\'a pas été réécrit sous la sélection')
          // la sélection retirée : le battement reprend
          await page.evaluate(() => { window.getSelection()!.removeAllRanges() })
          await page.waitForTimeout(1000)
          assert.equal(await page.evaluate(() => (window as any).__code.isConnected), false, 'sans sélection, le panneau est de nouveau redessiné')
        })
      })
      it('la ligne sélectionnée à la souris (triple clic) n\'est pas effacée par le battement non plus', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          await ouvrirPanneau(page)
          await cliquer(page, '.onglet[data-onglet="effets"]')
          const pos = await page.evaluate(() => { const c = (document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector('.fx-code'); const r = c.getBoundingClientRect(); return { x: r.left + 12, y: r.top + r.height / 2, ligne: c.textContent } })
          await page.mouse.click(pos.x, pos.y, { clickCount: 3 })
          await page.evaluate(() => { (window as any).__code = (document.querySelector('[data-mjs-devpanel]') as any).shadowRoot.querySelector('.fx-code') })
          assert.ok((await page.evaluate(() => String(window.getSelection()))).includes(pos.ligne), 'la ligne est sélectionnée')
          await page.waitForTimeout(2000)
          assert.ok((await page.evaluate(() => String(window.getSelection()))).includes(pos.ligne), 'la sélection tient')
          assert.equal(await page.evaluate(() => (window as any).__code.isConnected), true, 'le panneau n\'a pas été réécrit sous la sélection')
        })
      })
    })
  }
})
