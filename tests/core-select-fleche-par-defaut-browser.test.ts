// <@@select> dans Chromium et Firefox, construit en développement et en production : une flèche ▾ au bout du bouton
// - elle est là sans rien écrire, du côté de fin de ligne (à gauche dans un bloc écrit de droite à gauche), à la couleur du texte, et tournée
//   tant que la liste est ouverte ; la plus longue étiquette, choisie, n'est pas coupée : la jauge de largeur compte la flèche ;
// - `--mjs-select-arrow-color` et `--mjs-select-arrow-size` la règlent, `--mjs-select-arrow: none` la retire et rend sa place à l'étiquette ;
// - un clic sur la flèche ouvre la liste puis la referme : la flèche ne prend jamais le clic à la place du bouton ;
// - sur les thèmes clair et sombre du cœur, au repos comme au survol, elle tient un contraste d'au moins 4,5 pour 1 sur le fond du bouton

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, fermer } from './helpers/sortable-navigateur.js'

const LONGUE = 'Une étiquette bien plus longue que les autres'

const PAGE = `<script>
  $a = 'b'
  $b = 'a'
  $c = 'b'
  $d = 'a'
</script>
<div class="ligne">
  <@@select class="s0" value=!{$a}>
    <@@option value="a">Pomme</@@option>
    <@@option value="b">${LONGUE}</@@option>
  </@@select>
</div>
<div class="ligne reglee">
  <@@select class="s1" value=!{$b}>
    <@@option value="a">Poire</@@option>
  </@@select>
</div>
<div class="ligne sans">
  <@@select class="s2" value=!{$c}>
    <@@option value="a">Prune</@@option>
    <@@option value="b">${LONGUE}</@@option>
  </@@select>
</div>
<div class="ligne" dir="rtl">
  <@@select class="s3" value=!{$d}>
    <@@option value="a">Figue</@@option>
    <@@option value="b">Datte</@@option>
  </@@select>
</div>
<style>
  :host
    display: block
  .ligne
    padding: 8px
  .reglee
    --mjs-select-arrow-color: rgb(200, 0, 0)
    --mjs-select-arrow-size: 24px
  .sans
    --mjs-select-arrow: none
</style>
`

const TAG = 'mjs-fl-page'

// luminance relative et contraste, au sens des règles d'accessibilité du web
const lum       = (c: string) => { const [r, g, b] = c.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// la place entre l'étiquette et le bord intérieur du bouton, de chaque côté ; le style calculé de la flèche ; le centre de la flèche
const mesure = (page: any, c: string) => page.evaluate(([t, c]: string[]) => {
  const S      = (document.querySelector(t) as any)._shadow.querySelector('.' + c)._shadow
  const btn    = S.querySelector('.select-btn')
  const lab    = S.querySelector('.select-label')
  const b      = btn.getBoundingClientRect()
  const r      = lab.getBoundingClientRect()
  const cs     = getComputedStyle(btn)
  const f      = getComputedStyle(btn, '::after')
  const bg     = parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)
  const bd     = parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingRight)
  const ecart  = parseFloat(cs.columnGap)
  const gauche = r.left - b.left - bg
  const droite = b.right - r.right - bd
  const x      = cs.direction === 'rtl' ? b.left + bg + (gauche - ecart) / 2 : b.right - bd - (droite - ecart) / 2
  return { gauche, droite, ecart, x, y: (b.top + b.bottom) / 2, sens: cs.direction, contenu: f.content, display: f.display, couleur: f.color, taille: f.fontSize, transform: f.transform, police: cs.fontSize, texte: cs.color, fond: cs.backgroundColor, coupe: lab.scrollWidth > lab.clientWidth, ouverte: btn.getAttribute('aria-expanded'), panneau: !!S.querySelector('.select-panel') }
}, [TAG, c])

// l'élément que le navigateur trouve sous le point, dans l'ombre de la liste
const sous = (page: any, c: string, x: number, y: number) => page.evaluate(([t, c, x, y]: any[]) => { const e = (document.querySelector(t) as any)._shadow.querySelector('.' + c)._shadow.elementFromPoint(x, y); return e ? e.className : null }, [TAG, c, x, y])

async function ouvrir(browser: any, built: { root: string, script: string }, prod: boolean, sombre = false): Promise<{ ctx: any, page: any, erreurs: string[] }> {
  const ctx  = await browser.newContext({ viewport: { width: 800, height: 600 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const erreurs: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e).slice(0, 300)))
  await page.addInitScript('window.__name = function (f) { return f };')
  const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
  await page.route('http://f.test/**', (route: any) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"${sombre ? ' data-mjs-theme="dark"' : ''}><head><meta charset="utf-8"></head><body style="margin:0;font:14px sans-serif"><${TAG}></${TAG}>${charge}</body></html>` })
    const fichier = join(built.root, normalize(chemin))
    if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://f.test/', { waitUntil: 'load' })
  await page.waitForFunction(`['s0', 's1', 's2', 's3'].every((c) => document.querySelector('${TAG}')?._shadow?.querySelector('.' + c)?._shadow?.querySelector('.select-btn'))`, null, { timeout: 15000 })
  await page.waitForTimeout(250)
  return { ctx, page, erreurs }
}

for (const nom of ['chromium', 'firefox'] as const) for (const prod of [false, true]) describe(`<@@select> : la flèche par défaut (${nom}, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let built = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await construire('select-fleche-' + nom, { 'fl-page.mjs': PAGE }, prod)
    browser = await (await import('playwright'))[nom].launch()
  })
  after(async () => { await browser?.close(); await fermer() })
  beforeEach(function () { if (!present) this.skip() })

  it('sans rien écrire, la flèche est au bout de la ligne, plus petite que le texte et à sa couleur ; la plus longue étiquette choisie n\'est pas coupée', async () => {
    const { ctx, page, erreurs } = await ouvrir(browser, built, prod)
    const m: any = await mesure(page, 's0')
    assert.ok(m.contenu.startsWith('"▾"') && m.display !== 'none', `la flèche est dessinée (${JSON.stringify(m)})`)
    assert.ok(m.droite - m.ecart > 2 && Math.abs(m.gauche) < 1, `elle prend sa place au bout de la ligne, à droite (${JSON.stringify(m)})`)
    assert.equal(m.couleur, m.texte, 'à la couleur du texte du bouton')
    assert.ok(parseFloat(m.taille) > 0 && parseFloat(m.taille) <= parseFloat(m.police), `plus petite que le texte (${m.taille} pour ${m.police})`)
    assert.equal(m.transform, 'none', 'liste fermée : la flèche n\'est pas tournée')
    assert.equal(m.coupe, false, `la plus longue étiquette, choisie, tient en entier à côté de la flèche (${JSON.stringify(m)})`)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('--mjs-select-arrow-color et --mjs-select-arrow-size la règlent ; --mjs-select-arrow: none la retire et rend sa place à l\'étiquette', async () => {
    const { ctx, page, erreurs } = await ouvrir(browser, built, prod)
    const d: any = await mesure(page, 's0')
    const r: any = await mesure(page, 's1')
    assert.equal(r.couleur, 'rgb(200, 0, 0)', 'la couleur suit --mjs-select-arrow-color')
    assert.equal(r.taille, '24px', 'la taille suit --mjs-select-arrow-size')
    assert.ok(r.droite > d.droite + 4, `une flèche plus grande prend plus de place (${r.droite} contre ${d.droite})`)
    const n: any = await mesure(page, 's2')
    assert.equal(n.display, 'none', 'retirée, la flèche n\'est plus dessinée')
    assert.ok(Math.abs(n.droite) < 1, `l'étiquette reprend toute la place (${JSON.stringify(n)})`)
    assert.equal(n.coupe, false, 'la plus longue étiquette tient en entier')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('écrite de droite à gauche (dir="rtl"), la flèche est à gauche', async () => {
    const { ctx, page, erreurs } = await ouvrir(browser, built, prod)
    const m: any = await mesure(page, 's3')
    assert.equal(m.sens, 'rtl')
    assert.ok(m.gauche - m.ecart > 2 && Math.abs(m.droite) < 1, `la flèche prend sa place à gauche (${JSON.stringify(m)})`)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  for (const c of ['s0', 's3']) it(`${c === 's3' ? 'de droite à gauche, ' : ''}un clic sur la flèche ouvre la liste, qui tourne la flèche, et un second la referme`, async () => {
    const { ctx, page, erreurs } = await ouvrir(browser, built, prod)
    const m: any = await mesure(page, c)
    assert.equal(await sous(page, c, m.x, m.y), 'select-btn', `sous la flèche, c'est le bouton qui reçoit le clic (${JSON.stringify(m)})`)
    await page.mouse.click(m.x, m.y)
    await page.waitForTimeout(250)
    const o: any = await mesure(page, c)
    assert.ok(o.ouverte === 'true' && o.panneau, `la liste est ouverte (${JSON.stringify(o)})`)
    assert.ok(/^matrix\(-1,/.test(o.transform), `liste ouverte, la flèche est tournée (${o.transform})`)
    await page.mouse.click(m.x, m.y)
    await page.waitForTimeout(250)
    const f: any = await mesure(page, c)
    assert.ok(f.ouverte === 'false' && !f.panneau && f.transform === 'none', `la liste est refermée, la flèche revenue (${JSON.stringify(f)})`)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  for (const sombre of [false, true]) it(`thème ${sombre ? 'sombre' : 'clair'} du cœur : la flèche tient 4,5 pour 1 sur le fond du bouton, au repos et au survol`, async () => {
    const { ctx, page, erreurs } = await ouvrir(browser, built, prod, sombre)
    const m: any = await mesure(page, 's0')
    assert.equal(m.fond, sombre ? 'rgb(35, 41, 54)' : 'rgb(255, 255, 255)', 'le fond du bouton est celui du thème')
    assert.ok(m.contenu.startsWith('"▾"'), `la flèche est dessinée (${m.contenu})`)
    assert.ok(contraste(m.couleur, m.fond) >= 4.5, `au repos : ${m.couleur} sur ${m.fond} = ${contraste(m.couleur, m.fond).toFixed(2)}`)
    await page.mouse.move(m.x, m.y)
    await page.waitForTimeout(150)
    const h: any = await mesure(page, 's0')
    assert.notEqual(h.fond, m.fond, 'le survol change le fond du bouton')
    assert.ok(contraste(h.couleur, h.fond) >= 4.5, `au survol : ${h.couleur} sur ${h.fond} = ${contraste(h.couleur, h.fond).toFixed(2)}`)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})
