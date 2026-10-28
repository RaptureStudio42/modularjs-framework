// µ.modal dans Chromium et Firefox réels : le focus qui part à l'ouverture et revient à la fermeture, et le piège de Tab.
// - le retour du focus ne fait pas défiler la page : l'élément qui avait le focus est loin sous la fenêtre (une balise de
//   composant, un bouton), la fenêtre se ferme, la page reste où elle était (`{ preventScroll: true }`) ;
// - le focus qui était dans l'ombre d'un composant dont la balise n'est pas focalisable (le cas ordinaire) revient à
//   l'élément, pas au corps de la page : la balise, seule, ne peut pas le recevoir. Aussi dans l'ombre d'un composant
//   imbriqué, sans appeler la méthode `@focus` du composant ;
// - le piège de Tab : sur le dernier élément, Tab passe au premier, même quand c'est la balise d'un composant à `tabindex`
//   qui définit `@focus` (sa méthode ne doit pas être appelée, le focus doit arriver) ; le défilement de la fenêtre suit
//   (un contenu plus haut que la boîte) ;
// - le plein écran pendant que le focus est dans un composant de la fenêtre : le focus lui revient sans appeler `@focus`
//   (plein écran simulé, voir le test).

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

// un hôte sans tabindex, avec un bouton et un composant imbriqué dans son ombre
const SCENE = '<div class="scene"><button id="b">ouvrir</button><@champ></@champ></div>\n'

// un composant dont l'auteur définit `@focus` pour son propre usage, avec un champ dans son ombre
const CHAMP = [
  '<script>',
  '@focus = (options) ->',
  '  window.__appels.push(\'champ.focus\')',
  '</script>',
  '<input id="i" type="text">',
  ''
].join('\n')

const PAGE = (script: string) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}.loin{height:3000px}</style></head><body><button id="haut">haut</button><mjs-scene></mjs-scene><div class="loin"></div><mjs-champ id="bas" tabindex="0"></mjs-champ><button id="bouton-bas">bas</button><div id="plein"></div><script>${script}</script></body></html>`

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`µ.modal, le focus et le piège de Tab (${nom} réel)`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let browser: any = null

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de µ.modal sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('modale-focus-piege-tab-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'scene.mjs'), SCENE)
      writeFileSync(join(srcDir, 'champ.mjs'), CHAMP)
      // le test appelle µ.modal depuis son propre code, hors des sources compilées (en production, une page n'atteint pas µ) : rien ne le révèle au repérage, 'all' rend le cœur complet
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: 'all' })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      browser = await (await import('playwright'))[nom].launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    async function ouvre() {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
      const erreurs: string[] = []
      await page.addInitScript('window.__appels = []')
      page.on('pageerror', (e: any) => erreurs.push(String(e && e.message)))
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: PAGE(script) })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(() => {
        const s: any = document.querySelector('mjs-scene')
        const c: any = document.getElementById('bas')
        return !!s?._shadow?.querySelector('mjs-champ')?._shadow?.querySelector('#i') && !!c?._shadow?.querySelector('#i')
      })
      return { page, erreurs }
    }

    // ouvre une fenêtre, la ferme par Échap, rend ce que `lire` constate ensuite
    async function ferme(page: any, ouvrir: () => void, lire: () => any) {
      await page.evaluate(ouvrir)
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => !!(window as any).__r, null, { timeout: 10000 })
      return page.evaluate(lire)
    }

    it('le focus revient à la balise d\'un composant très loin sous la fenêtre sans faire défiler la page', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvre()
      try {
        const r = await ferme(page, () => {
          const w: any = window
          HTMLElement.prototype.focus.call(document.getElementById('bas'), { preventScroll: true })
          w.scrollTo(0, 0)
          w.__p = w.µ.modal.fire({ title: 'Question' }).then((x: any) => { w.__r = x })
        }, () => ({ defilement: window.scrollY, focus: document.activeElement === document.getElementById('bas'), appels: Array.from((window as any).__appels) }))
        assert.deepEqual(r, { defilement: 0, focus: true, appels: [] })
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('le focus revient à un bouton très loin sous la fenêtre sans faire défiler la page', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvre()
      try {
        const r = await ferme(page, () => {
          const w: any = window
          document.getElementById('bouton-bas')!.focus({ preventScroll: true })
          w.scrollTo(0, 0)
          w.__p = w.µ.modal.fire({ title: 'Question' }).then((x: any) => { w.__r = x })
        }, () => ({ defilement: window.scrollY, focus: document.activeElement === document.getElementById('bouton-bas') }))
        assert.deepEqual(r, { defilement: 0, focus: true })
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('le focus qui était sur un bouton dans l\'ombre d\'un composant à la balise non focalisable revient au bouton, pas au corps', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvre()
      try {
        const r = await ferme(page, () => {
          const w: any = window
          const hote: any = document.querySelector('mjs-scene')
          hote._shadow.querySelector('#b').focus()
          w.__p = w.µ.modal.fire({ title: 'Question' }).then((x: any) => { w.__r = x })
        }, () => {
          const hote: any = document.querySelector('mjs-scene')
          return { bouton: hote._shadow.activeElement === hote._shadow.querySelector('#b'), hote: document.activeElement === hote }
        })
        assert.deepEqual(r, { bouton: true, hote: true })
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('le focus qui était dans l\'ombre d\'un composant imbriqué revient au champ le plus profond, sans appeler @focus', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvre()
      try {
        const r = await ferme(page, () => {
          const w: any = window
          const hote: any = document.querySelector('mjs-scene')
          hote._shadow.querySelector('mjs-champ')._shadow.querySelector('#i').focus()
          w.__p = w.µ.modal.fire({ title: 'Question' }).then((x: any) => { w.__r = x })
        }, () => {
          const hote: any  = document.querySelector('mjs-scene')
          const champ: any = hote._shadow.querySelector('mjs-champ')
          return { champ: champ._shadow.activeElement === champ._shadow.querySelector('#i'), appels: Array.from((window as any).__appels) }
        })
        assert.deepEqual(r, { champ: true, appels: [] })
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('Tab sur le dernier élément passe au premier, une balise de composant à tabindex qui définit @focus : le focus arrive, @focus n\'est pas appelée', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvre()
      try {
        await page.evaluate(() => {
          const w: any = window
          w.__p = w.µ.modal.fire({ title: 'T', html: '<mjs-champ tabindex="0" id="ch"></mjs-champ>', showCancelButton: true }).then((x: any) => { w.__r = x })
        })
        await page.waitForFunction(() => !!(document.getElementById('ch') as any)?._shadow?.querySelector('#i'))
        await page.keyboard.press('Tab')
        const milieu = await page.evaluate(() => (document.activeElement as any)?.textContent)
        await page.keyboard.press('Tab')
        const r = await page.evaluate(() => ({ actif: (document.activeElement as any)?.id, appels: Array.from((window as any).__appels) }))
        assert.equal(milieu, 'Annuler', 'le premier Tab va du bouton de confirmation au bouton d\'annulation')
        assert.deepEqual(r, { actif: 'ch', appels: [] })
        await page.keyboard.press('Shift+Tab')
        const retour = await page.evaluate(() => ({ actif: (document.activeElement as any)?.textContent, appels: Array.from((window as any).__appels) }))
        assert.deepEqual(retour, { actif: 'Annuler', appels: [] }, 'Maj+Tab sur le premier élément passe au dernier')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('le piège de Tab fait défiler la fenêtre jusqu\'à l\'élément qu\'il atteint (un contenu plus haut que la boîte)', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvre()
      try {
        await page.evaluate(() => {
          const w: any = window
          w.__p = w.µ.modal.fire({ title: 'T', html: '<button id="premier">premier</button><div style="height:2000px"></div>' }).then((x: any) => { w.__r = x })
        })
        const depart = await page.evaluate(() => (document.querySelector('.mjs-modal-box') as any).scrollTop)
        await page.keyboard.press('Tab')
        const sur = await page.evaluate(() => ({ actif: (document.activeElement as any)?.id, haut: (document.querySelector('.mjs-modal-box') as any).scrollTop }))
        await page.keyboard.press('Shift+Tab')
        const fin = await page.evaluate(() => ({ actif: (document.activeElement as any)?.textContent, haut: (document.querySelector('.mjs-modal-box') as any).scrollTop }))
        assert.equal(depart, 0, 'la boîte s\'ouvre en haut')
        assert.equal(sur.actif, 'premier', 'Tab sur le dernier élément passe au premier')
        assert.equal(sur.haut, 0, 'le premier élément est en haut : rien à faire défiler')
        assert.equal(fin.actif, 'OK', 'Maj+Tab sur le premier élément passe au dernier')
        assert.ok(fin.haut > 500, `le bouton du bas est amené à l'écran (défilement ${fin.haut})`)
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    // le plein écran est simulé (`fullscreenElement` posé, l'événement envoyé) : un navigateur réel défait parfois le focus à l'entrée en plein écran
    // avant d'envoyer l'événement (2 fois sur 10 dans Chromium), la fenêtre ne peut alors rendre le focus à personne. Ce que le test garde, c'est ce
    // qu'elle fait du focus qu'elle trouve ; le plein écran réel a ses propres tests (modale-par-dessus-le-plein-ecran, modale-methodes-du-composant-auteur-browser)
    it('le plein écran pendant que le focus est sur un composant de la fenêtre : le focus lui revient, @focus n\'est pas appelée', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvre()
      try {
        await page.evaluate(() => {
          const w: any = window
          w.__p = w.µ.modal.fire({ title: 'T', html: '<mjs-champ tabindex="0" id="ch"></mjs-champ>', allowOutsideClick: false }).then((x: any) => { w.__r = x })
        })
        await page.waitForFunction(() => !!(document.getElementById('ch') as any)?._shadow?.querySelector('#i'))
        const r = await page.evaluate(() => {
          const w: any = window
          HTMLElement.prototype.focus.call(document.getElementById('ch'))
          Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.getElementById('plein') })
          document.dispatchEvent(new Event('fullscreenchange'))
          return { actif: (document.activeElement as any)?.id, dansPlein: !!document.getElementById('plein')!.querySelector('.mjs-modal-backdrop'), appels: Array.from(w.__appels) }
        })
        assert.deepEqual(r, { actif: 'ch', dansPlein: true, appels: [] })
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })
  })
}
