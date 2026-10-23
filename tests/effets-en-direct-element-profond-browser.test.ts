// *cursors, *follow, *heatmap dans Chromium et Firefox réels (la mise en page est vraie) : sous la souris, ou
// en haut de la zone, il y a une balise DANS un composant imbriqué — `document.elementFromPoint` s'arrête à la
// balise du composant le plus extérieur ; les trois effets demandent la balise la plus profonde (µ.elementAt),
// jusque dans les composants :
//   - *cursors : le chemin envoyé entre dans les composants (-1) et désigne le bouton sous la souris ;
//   - *follow (qui mène) : la balise en haut de sa zone est le bouton du composant, pas la première balise de
//     la zone dans l'ordre du document (la mise en page la place plus bas) ;
//   - *heatmap : les zones du point nomment les deux composants traversés, le plus large d'abord.
// Remettre `document.elementFromPoint` dans l'un des trois fait échouer le test de cet effet.

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
  }
  catch {
    return false
  }
}

// le composant imbriqué : un bouton qui remplit sa boîte (40 px de haut)
const ENFANT = '<button class="b">Bouton</button>\n<style>\n.b\n  display: block\n  box-sizing: border-box\n  width: 100%\n  height: 40px\n  margin: 0\n  padding: 0\n</style>\n'

// l'hôte : trois zones l'une sous l'autre ; dans chacune, une cale (en premier dans le document, en bas à
// l'affichage : `order`) et le composant imbriqué (en haut à l'affichage)
const HOTE = [
  '<script>',
  '@sock = µsocket \'wss://x.fr/ws\'',
  '</script>',
  '<@document *heatmap></@document>',
  '<div class="m" *cursors(cursor: normal, selection: false, focus: false)><div class="cale"></div><@fx-ep-enfant class="e"></@fx-ep-enfant></div>',
  '<div class="s" *follow(lead: true, cursor: none, selection: false, focus: false)><div class="cale"></div><@fx-ep-enfant class="e"></@fx-ep-enfant><div class="long"></div></div>',
  '<style>',
  '.m, .s',
  '  display: flex',
  '  flex-direction: column',
  '  width: 280px',
  '  height: 200px',
  '.s',
  '  overflow: auto',
  '.cale',
  '  order: 2',
  '  flex: none',
  '  height: 100px',
  '.e',
  '  order: 1',
  '  display: block',
  '  flex: none',
  '  height: 40px',
  '.long',
  '  order: 3',
  '  flex: none',
  '  height: 800px',
  '</style>',
  ''
].join('\n')

// la connexion simulée, posée dans la page avant les composants : tout ce que les effets envoient est gardé
const STUB = `(() => {
  window.__envoyes = []
  const s = {
    _mjs_refs: 1,
    send(type, p) { window.__envoyes.push([type, p]) },
    on() { return () => {} },
    room() { return { presence: () => ({ '7': true }), leave() {} } },
    destroy() {}, request() { return Promise.resolve(null) }, release() {}
  }
  µ.socket = () => s
  µ._mjs_sockets = { 'wss://x.fr/ws': s }
  // le nœud qu'un chemin désigne depuis une zone : les rangs des enfants, -1 pour entrer dans un composant
  window.__nodeAt = (zone, path) => { let n = zone; for (let i = 0; n && i < path.length; i++) n = path[i] === -1 ? (n._shadow || n.shadowRoot) : n.childNodes[path[i]]; return n || null }
  window.__envoyesDe = (type) => window.__envoyes.filter((e) => e[0] === type).map((e) => e[1])
})()`

describe('*cursors, *follow, *heatmap — la balise la plus profonde, dans les composants (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('effets-en-direct-element-profond-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-ep-enfant.mjs'), ENFANT)
    writeFileSync(join(srcDir, 'fx-ep-hote.mjs'), HOTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test de la balise la plus profonde sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { await browser?.close() })

      async function ouvre() {
        const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${'<script>' + script + '</script>'}</body></html>`, { waitUntil: 'load' })
        await page.evaluate(STUB)
        await page.evaluate(() => { document.body.appendChild(document.createElement('mjs-fx-ep-hote')) })
        await page.waitForFunction(() => { const h: any = document.querySelector('mjs-fx-ep-hote'); return !!h?._shadow?.querySelector('.s .e')?._shadow?.querySelector('.b') && !!h._shadow.querySelector('.m .e')?._shadow?.querySelector('.b') })
        await page.waitForTimeout(150)
        return { page, erreurs }
      }

      // la boîte d'une balise de l'hôte, dans la fenêtre
      const boite = (page: any, sel: string) => page.evaluate((s: string) => {
        const r = (document.querySelector('mjs-fx-ep-hote') as any)._shadow.querySelector(s).getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      }, sel)

      // le nœud que désigne un chemin de la zone `sel` : son nom, et celui de son composant
      const designe = (page: any, sel: string, chemin: number[]) => page.evaluate(([s, c]: [string, number[]]) => {
        const zone = (document.querySelector('mjs-fx-ep-hote') as any)._shadow.querySelector(s)
        const n: any = (window as any).__nodeAt(zone, c)
        const racine = n && n.getRootNode ? n.getRootNode() : null
        return n ? { balise: n.localName, classe: n.className, hote: racine && racine.host ? racine.host.localName : null } : null
      }, [sel, chemin] as [string, number[]])

      it('*cursors : sous la souris, le bouton d\'un composant imbriqué — le chemin envoyé y entre et le désigne', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre()
        const z = await boite(page, '.m')
        await page.mouse.move(z.x + 140, z.y + 20)
        await page.mouse.move(z.x + 142, z.y + 21)
        await page.waitForFunction(() => (window as any).__envoyesDe('cursors:move').some((p: any) => p.p), null, { timeout: 5000 }).catch(() => {})
        const envoyes = await page.evaluate(() => (window as any).__envoyesDe('cursors:move').filter((p: any) => p.p))
        assert.ok(envoyes.length > 0, 'la position de la souris est partie, avec son chemin (rien ne part si la balise sous la souris n\'est pas dans la zone)')
        const chemin = envoyes.at(-1).p.a
        assert.ok(chemin.includes(-1), 'le chemin entre dans un composant : ' + JSON.stringify(chemin))
        assert.deepEqual(await designe(page, '.m', chemin), { balise: 'button', classe: 'b', hote: 'mjs-fx-ep-enfant' }, 'et désigne le bouton du composant imbriqué')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('*follow : en haut de la zone qui défile, la balise de qui mène est le bouton du composant, pas la première balise du document', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre()
        await page.evaluate(() => { ((document.querySelector('mjs-fx-ep-hote') as any)._shadow.querySelector('.s') as HTMLElement).scrollTop = 10 })
        await page.waitForFunction(() => (window as any).__envoyesDe('follow:at').length > 0, null, { timeout: 5000 }).catch(() => {})
        const envoyes = await page.evaluate(() => (window as any).__envoyesDe('follow:at'))
        assert.ok(envoyes.length > 0, 'la position de qui mène est partie')
        const chemin = envoyes.at(-1).a
        assert.ok(chemin.includes(-1), 'le chemin entre dans un composant : ' + JSON.stringify(chemin))
        assert.deepEqual(await designe(page, '.s', chemin), { balise: 'button', classe: 'b', hote: 'mjs-fx-ep-enfant' }, 'et désigne le bouton du composant imbriqué')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('*heatmap : un clic sur le bouton du composant imbriqué — les zones du point nomment les deux composants, le plus large d\'abord', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre()
        const z = await boite(page, '.m')
        await page.mouse.click(z.x + 140, z.y + 20)
        await page.waitForFunction(() => (window as any).__envoyesDe('heatmap:point').length > 0, null, { timeout: 5000 }).catch(() => {})
        const envoyes = await page.evaluate(() => (window as any).__envoyesDe('heatmap:point'))
        assert.ok(envoyes.length > 0, 'le point est parti')
        const point = envoyes[0].pts ? envoyes[0].pts[0] : envoyes[0]
        assert.deepEqual(point.z.map((x: any[]) => x[0]), ['document', 'mjs-fx-ep-hote', 'mjs-fx-ep-enfant'], 'la page, le composant hôte, le composant imbriqué')
        assert.deepEqual(erreurs, [])
        await page.close()
      })
    })
  }
})
