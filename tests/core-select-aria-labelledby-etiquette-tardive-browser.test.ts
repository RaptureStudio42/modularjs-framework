// <@@select aria-labelledby="…"> vers une étiquette qui n'existe pas encore au montage (dans un {if} affiché plus
// tard) : la liste restait sans nom, l'identifiant n'étant résolu qu'une fois, au montage. Elle est nommée dès que
// l'étiquette paraît. La page n'est pas observée en profondeur en permanence : le module ne guette l'arrivée des
// balises (la racine de la liste, sous-arbre compris) que le temps qu'une étiquette citée manque ; dès qu'elles
// sont toutes là, il ne surveille plus que les parents de chaque étiquette, sans leur sous-arbre.
// Chromium et Firefox réels : le bouton interne reçoit les étiquettes par `ariaLabelledByElements` ; dans Chromium,
// le nom se lit aussi dans l'arbre d'accessibilité (CDP).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = `<script>
  $show = false
</script>
<@@select id="tard" name="t" aria-labelledby="tard-t"><@@option value="x">X</@@option></@@select>
<@@select id="deux" name="d" aria-labelledby="un-t deux-t"><@@option value="x">X</@@option></@@select>
<@@select id="ctl" name="c" aria-labelledby="ctl-t"><@@option value="x">X</@@option></@@select>
<span id="un-t">Un</span>
<span id="ctl-t">Témoin</span>
{if $show}<span id="tard-t">Étiquette tardive</span><span id="deux-t">Deux</span>{end}
`

// les observateurs de mutations vivants (observe posé, disconnect pas encore passé) : le test les compte, et
// relève ceux de la liste qui guettent un sous-arbre (leur rappel est celui qui pose `ariaLabelledByElements`,
// et ils observent les enfants : l'observateur de l'hôte, lui, ne lit que des attributs)
const ESPION = `(() => {
  const Natif = window.MutationObserver
  window.__vivants = new Set()
  window.MutationObserver = class extends Natif {
    constructor(cb) { super(cb); this.desEtiquettes = String(cb).includes('ariaLabelledByElements'); this.profond = false }
    observe(cible, options) { window.__vivants.add(this); if (options && options.subtree) this.profond = true; return super.observe(cible, options) }
    disconnect() { window.__vivants.delete(this); this.profond = false; return super.disconnect() }
  }
})()`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte), compilé une fois pour les deux navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('select-labelledby-tardif')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return compile
}

for (const nom of ['chromium', 'firefox'] as const) describe(`<@@select aria-labelledby> : étiquette qui paraît après le montage (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any

  // les ids des étiquettes que porte le bouton interne de chaque liste (tard, deux, ctl)
  const etiquettes = async () => JSON.parse(await page.evaluate(`JSON.stringify(['#tard', '#deux', '#ctl'].map((s) => {
    const btn = document.querySelector('mjs-hote')._shadow.querySelector(s)._shadow.querySelector('.select-btn')
    return (btn.ariaLabelledByElements || []).map((e) => e.id)
  }))`))
  // les guetteurs d'étiquettes qui regardent un sous-arbre en ce moment : autant de listes qui attendent une étiquette
  const profonds = async () => await page.evaluate(`[...window.__vivants].filter((o) => o.desEtiquettes && o.profond).length`) as number

  // le nom accessible de chaque combobox, dans l'ordre de la page (arbre d'accessibilité de Chromium)
  async function noms() {
    const client = await page.context().newCDPSession(page)
    await client.send('Accessibility.enable')
    const { nodes } = await client.send('Accessibility.getFullAXTree')
    await client.detach()
    return nodes.filter((n: any) => !n.ignored && n.role?.value === 'combobox').map((n: any) => n.name?.value ?? '')
  }

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const code = await script()
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
      await page.addInitScript('window.__name = (f) => f')
      await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><script>${ESPION}</script><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('#ctl')?._shadow?.querySelector('.select-btn'))
      await page.waitForTimeout(500)
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('au montage : la liste dont l\'étiquette existe est nommée, les autres attendent leur étiquette', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await etiquettes(), [[], ['un-t'], ['ctl-t']], 'seules les étiquettes déjà là sont reliées')
    if (nom === 'chromium') assert.deepEqual(await noms(), ['', 'Un', 'Témoin'], 'le nom dans l\'arbre d\'accessibilité')
  })

  it('l\'étiquette paraît plus tard (dans un {if}) : la liste est nommée aussitôt, y compris la liste qui n\'en avait qu\'une sur deux', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`document.querySelector('mjs-hote')._set('show', true)`)
    await page.waitForTimeout(600)
    assert.deepEqual(await etiquettes(), [['tard-t'], ['un-t', 'deux-t'], ['ctl-t']], 'chaque liste est reliée à toutes ses étiquettes')
    if (nom === 'chromium') assert.deepEqual(await noms(), ['Étiquette tardive', 'Un Deux', 'Témoin'], 'le nom dans l\'arbre d\'accessibilité')
  })

  it('une fois toutes les étiquettes trouvées, plus aucune racine n\'est guettée en profondeur ; retirée puis remise, l\'étiquette est retrouvée', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await profonds(), 0, 'toutes les étiquettes sont là : aucune racine guettée en profondeur')
    await page.evaluate(`document.querySelector('mjs-hote')._set('show', false)`)
    await page.waitForTimeout(400)
    assert.equal(await profonds(), 2, 'l\'étiquette retirée : les deux listes qui la citent la guettent de nouveau')
    await page.evaluate(`document.querySelector('mjs-hote')._set('show', true)`)
    await page.waitForTimeout(600)
    assert.equal(await profonds(), 0, 'l\'étiquette remise : plus aucune racine guettée en profondeur')
    assert.deepEqual(await etiquettes(), [['tard-t'], ['un-t', 'deux-t'], ['ctl-t']], 'les listes tiennent les étiquettes neuves')
  })
})
