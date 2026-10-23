// *flipcard(on: hover | click) au clavier, dans Chromium et WebKit réels : la carte ne se dit jamais bouton — elle porte souvent des
// contrôles (un lien au recto, un bouton au verso), qu'un bouton ne peut contenir (motif « nested-interactive » : un lecteur d'écran
// les tait, ou les lit tous dans le nom du bouton). L'effet place dans la carte une commande à elle, « Retourner la carte » (« Flip the
// card » sur une page en anglais) : la première que Tab atteint, pressée quand le verso est montré (`aria-pressed`), cachée hors du focus.
// Entrée et Espace sur elle retournent la carte (on: click) ; avec on: hover, son focus la retourne, Entrée la bascule, Échap la remet.
// Un clic sur un lien d'une face garde son action sans la retourner. Au retrait, la commande part. L'arbre d'accessibilité est lu :
// celui de Chromium (CDP), et l'instantané ARIA que Playwright calcule, dans les deux moteurs.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const CARTE = '<div id="c" style="width:300px;height:120px"><div><h3>Offre</h3><a id="lien" href="#x">En savoir plus</a></div><div><p>Verso</p><button id="achat">Acheter</button></div></div>'

// les contrôles d'un instantané ARIA rangés sous un bouton (chaque ligne : `- rôle "nom"`, l'indentation dit l'imbrication)
function imbriques(snap: string): string[] {
  const lignes = snap.split('\n').map((l) => ({ ind: l.search(/\S/), txt: l.trim() }))
  const out: string[] = []
  lignes.forEach((l, i) => {
    if (!/^- (link|button|textbox|checkbox)\b/.test(l.txt)) return
    let ind = l.ind
    for (let j = i - 1; j >= 0; j--) {
      if (lignes[j].ind >= ind) continue
      ind = lignes[j].ind
      if (/^- button\b/.test(lignes[j].txt)) out.push(lignes[j].txt + ' > ' + l.txt)
    }
  })
  return out
}

// l'arbre d'accessibilité de Chromium sous la carte : chaque bouton qui contient un contrôle, et le rôle de la carte
async function arbreChromium(page: any): Promise<{ carte: string, imbriques: string[] }> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Accessibility.enable')
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.getElementById("c")' })
  const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId })
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  const parId  = new Map<string, any>(nodes.map((n: any) => [n.nodeId, n]))
  const racine = nodes.find((n: any) => n.backendDOMNodeId === node.backendNodeId)
  const out: string[] = []
  const controles = (n: any): string[] => (n?.childIds || []).flatMap((id: string) => {
    const k = parId.get(id)
    if (!k) return []
    const ici = !k.ignored && ['link', 'button', 'textbox', 'checkbox'].includes(k.role?.value) ? [k.role.value + ' "' + (k.name?.value || '') + '"'] : []
    return [...ici, ...controles(k)]
  })
  const visite = (n: any) => {
    if (!n) return
    if (!n.ignored && n.role?.value === 'button') for (const c of controles(n)) out.push('button "' + (n.name?.value || '') + '" > ' + c)
    for (const id of n.childIds || []) visite(parId.get(id))
  }
  visite(racine)
  return { carte: racine ? (racine.ignored ? 'ignoré' : racine.role?.value) : 'absent', imbriques: out }
}

describe('*flipcard au clavier — une commande dans la carte, jamais une carte bouton', function () {
  this.timeout(240000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('effets-carte-commande-retourner')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-carte.mjs'), '<div *flipcard(on: click)><div>r</div><div>v</div></div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const libelles = /µ\._runtimeLabels = (\{[\s\S]*?\});\n/.exec(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    if (libelles) script += ` µ._runtimeLabels = ${libelles[1]};`
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of ['chromium', 'webkit'] as const) {
    describe(`${moteur} réel`, function () {
      let browser: any = null
      let ctx: any = null
      let page: any = null

      before(async function () {
        const playwright = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) {
          console.log(`  ℹ️  ${moteur} non installé, test sauté. Activer : \`npx playwright install ${moteur}\``)
          return this.skip()
        }
        browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async () => {
        if (browser) await browser.close()
      })

      beforeEach(async () => {
        ctx  = await browser.newContext({ viewport: { width: 900, height: 700 } })
        page = await ctx.newPage()
      })

      afterEach(async () => {
        if (ctx) await ctx.close()
        ctx = null
      })

      async function poser(on: string, lang = 'fr') {
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"></head><body>${CARTE}<script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.evaluate((on: string) => { (window as any).off = (window as any).µ._mjs_fx(null, document.getElementById('c'), 'flipcard', { on, duration: '0s' }) }, on)
        await page.waitForTimeout(150)
      }

      const etat = () => page.evaluate(() => {
        const c = document.getElementById('c')!
        const b = c.querySelector(':scope > [mjs-fx-flipcard-turn]')
        return {
          carte: [c.getAttribute('role'), c.getAttribute('tabindex'), c.getAttribute('aria-pressed')],
          commande: b ? b.localName + ' ' + (b.textContent || '') : null,
          premiere: !!b && c.firstElementChild === b,
          pressee: b ? b.getAttribute('aria-pressed') : null,
          t: c.style.getPropertyValue('--mjs-fx-flipcard-t'),
          focus: !!b && document.activeElement === b,
          largeur: b ? Math.round(b.getBoundingClientRect().width) : 0
        }
      })

      const pause = (ms = 120) => page.waitForTimeout(ms)

      it('on: click — la carte n\'est pas un bouton ; la commande nommée, la première, cachée hors du focus ; Entrée et Espace la retournent', async () => {
        await poser('click')
        let e = await etat()
        assert.deepEqual(e.carte, [null, null, null], 'ni rôle, ni tabindex, ni état de bouton sur la carte : ' + JSON.stringify(e))
        assert.equal(e.commande, 'button Retourner la carte', JSON.stringify(e))
        assert.equal(e.premiere, true, 'la commande est le premier enfant : Tab l\'atteint avant le contenu')
        assert.equal(e.pressee, 'false')
        assert.ok(e.largeur <= 1, 'cachée hors du focus : ' + JSON.stringify(e))
        await page.keyboard.press('Tab')
        e = await etat()
        assert.equal(e.focus, true, 'Tab atteint la commande : ' + JSON.stringify(e))
        assert.ok(e.largeur > 1, 'montrée au focus : ' + JSON.stringify(e))
        await page.keyboard.press('Enter')
        await pause()
        e = await etat()
        assert.deepEqual([e.t, e.pressee], ['1', 'true'], 'Entrée retourne la carte : ' + JSON.stringify(e))
        await page.keyboard.press(' ')
        await pause()
        e = await etat()
        assert.deepEqual([e.t, e.pressee], ['0', 'false'], 'Espace la remet : ' + JSON.stringify(e))
        await page.click('#lien')
        await pause()
        assert.equal((await etat()).t, '0', 'un clic sur le lien du recto garde son action, la carte reste')
        await page.evaluate(() => (window as any).off())
        assert.equal(await page.evaluate(() => document.querySelectorAll('#c [mjs-fx-flipcard-turn]').length), 0, 'la commande part au retrait')
      })

      it('on: hover — le focus de la commande retourne la carte, Entrée la bascule, Échap la remet', async () => {
        await poser('hover')
        assert.deepEqual((await etat()).carte, [null, null, null])
        await page.keyboard.press('Tab')
        await pause()
        let e = await etat()
        assert.deepEqual([e.focus, e.t, e.pressee], [true, '1', 'true'], 'le focus pris au clavier la retourne : ' + JSON.stringify(e))
        await page.keyboard.press('Enter')
        await pause()
        e = await etat()
        assert.deepEqual([e.t, e.pressee], ['0', 'false'], JSON.stringify(e))
        await page.keyboard.press('Enter')
        await pause()
        assert.equal((await etat()).t, '1')
        await page.keyboard.press('Escape')
        await pause()
        e = await etat()
        assert.deepEqual([e.focus, e.t], [true, '0'], 'Échap la remet, le focus reste sur la commande : ' + JSON.stringify(e))
      })

      it('l\'arbre d\'accessibilité : aucun contrôle dans un bouton, le lien du recto et la commande exposés', async () => {
        await poser('click')
        const snap = await page.locator('#c').ariaSnapshot()
        assert.deepEqual(imbriques(snap), [], snap)
        assert.match(snap, /- button "Retourner la carte"/, snap)
        assert.match(snap, /- link "En savoir plus"/, snap)
        if (moteur === 'chromium') {
          const ax = await arbreChromium(page)
          assert.notEqual(ax.carte, 'button', 'la carte n\'est pas un bouton dans l\'arbre de Chromium')
          assert.deepEqual(ax.imbriques, [])
        }
        await page.keyboard.press('Tab')
        await page.keyboard.press('Enter')
        await pause()
        const verso = await page.locator('#c').ariaSnapshot()
        assert.deepEqual(imbriques(verso), [], verso)
        assert.match(verso, /- button "Acheter"/, verso)
        if (moteur === 'chromium') assert.deepEqual((await arbreChromium(page)).imbriques, [])
      })

      it('page en anglais : « Flip the card »', async () => {
        await poser('click', 'en')
        assert.equal((await etat()).commande, 'button Flip the card')
      })
    })
  }
})
