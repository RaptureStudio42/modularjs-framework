// µ.modal.notify(message, { icon }) dans Chromium, Firefox et WebKit réels : la MISE EN PAGE du toast (happy-dom n'a pas de géométrie).
// - une chaîne SVG, une image (adresse) et un élément sont chacun posés dans la case d'icône ; le SVG et l'image y prennent la
//   taille de l'icône (--mjs-toast-icon-size, 28px par défaut), comme l'icône du type ;
// - `icon: false` : le contenu commence là où la case d'icône commençait et en prend la largeur, la croix reste dans sa colonne,
//   sur la même ligne, et la hauteur du toast ne change pas.
// Le runtime est chargé tel quel dans la page (init, cache de pages, modale), comme le font les tests happy-dom voisins.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function stripEsm(s: string): string {
  return s
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
}

const lire = (f: string) => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const SCRIPT = `${stripEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_modal.ts')}\nglobalThis.µ = µ;`

const SVG = '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="currentColor"/></svg>'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`µ.modal.notify, icône à soi — mise en page (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []

  // pose un toast permanent, attend la fin de son entrée (il glisse depuis le bord), mesure la case d'icône, sa pièce, le contenu et la croix, puis le retire
  const mesurer = (opts: string): Promise<any> => page.evaluate(`(async () => {
    const poignee = µ.modal.notify('mesure', Object.assign({ duration: 0 }, ${opts}))
    await new Promise((r) => setTimeout(r, 700))
    const boite = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } }
    const t     = document.querySelector('.mjs-toast')
    const cote  = t.querySelector('.mjs-toast-icon')
    const piece = cote && cote.firstElementChild
    const res   = { toast: boite(t), cote: boite(cote), piece: boite(piece), balise: piece ? piece.tagName.toLowerCase() : null, html: piece ? piece.outerHTML : null, contenu: boite(t.querySelector('.mjs-toast-content')), croix: boite(t.querySelector('.mjs-toast-close')) }
    poignee.close()
    return res
  })()`)

  const proche = (a: number, b: number, msg: string, ecart = 1) => assert.ok(Math.abs(a - b) <= ecart, `${msg} : ${a} contre ${b}`)

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.setContent('<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body></body></html>')
    await page.addScriptTag({ content: SCRIPT })
  })

  after(async () => {
    if (browser) await browser.close()
  })

  afterEach(function () {
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  it('chaîne SVG : le SVG de l\'appli prend la taille de l\'icône', async function () {
    if (!present) { this.skip(); return }
    const m = await mesurer(`{ icon: ${JSON.stringify(SVG)} }`)
    assert.equal(m.balise, 'svg')
    assert.ok(m.html.includes('<rect'), 'c\'est le SVG de l\'appli, pas celui du type')
    proche(m.piece.width, 28, 'largeur du SVG')
    proche(m.piece.height, 28, 'hauteur du SVG')
  })

  it('adresse : l\'image prend la taille de l\'icône', async function () {
    if (!present) { this.skip(); return }
    const m = await mesurer(`{ icon: ${JSON.stringify(PNG)} }`)
    assert.equal(m.balise, 'img')
    proche(m.piece.width, 28, 'largeur de l\'image')
    proche(m.piece.height, 28, 'hauteur de l\'image')
  })

  it('élément : posé dans la case d\'icône, visible', async function () {
    if (!present) { this.skip(); return }
    const m = await mesurer(`{ icon: (() => { const e = document.createElement('span'); e.textContent = '★'; return e })() }`)
    assert.equal(m.balise, 'span')
    assert.ok(m.piece.width > 0 && m.piece.height > 0, 'l\'élément a une taille')
    assert.ok(m.piece.left >= m.cote.left - 1 && m.piece.right <= m.cote.right + 1, 'il est dans la case')
  })

  it('false : le contenu prend la place de la case d\'icône, la croix reste à sa place, la hauteur ne change pas', async function () {
    if (!present) { this.skip(); return }
    const avec = await mesurer('{}')
    const sans = await mesurer('{ icon: false }')
    assert.equal(sans.cote, null, 'aucune case d\'icône')
    proche(avec.toast.width, sans.toast.width, 'largeur du toast')
    proche(sans.contenu.left - sans.toast.left, avec.cote.left - avec.toast.left, 'le contenu commence où la case commençait')
    proche(sans.contenu.width, avec.contenu.width + avec.cote.width, 'le contenu prend aussi la largeur de la case')
    proche(sans.toast.right - sans.croix.right, avec.toast.right - avec.croix.right, 'la croix reste dans sa colonne')
    assert.ok(sans.croix.top >= sans.toast.top - 1 && sans.croix.bottom <= sans.toast.bottom + 1, 'la croix reste sur la ligne du toast')
    proche(sans.toast.height, avec.toast.height, 'hauteur du toast', 2)
  })
})
