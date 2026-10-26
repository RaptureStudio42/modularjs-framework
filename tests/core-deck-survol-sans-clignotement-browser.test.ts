// module cœur deck (<@@deck>, en éventail) dans Chromium, Firefox et WebKit réels, en développement et en production : la carte survolée se
// soulève de 50 px et glisse de côté ; le pointeur posé près de son bord bas ne la voit plus filer sous lui. Elle garde le survol, soulevée,
// tant que le pointeur reste sur la place qu'elle a quittée ; avant, elle sortait de sous le pointeur, retombait, se soulevait encore, sans
// fin (un clignotement). Deux paquets : une carte seule (elle monte tout droit), et trois cartes, dont la dernière, survolée près de son
// coin bas, monte et glisse de côté. Le pointeur tremble d'un pixel, comme une main : le navigateur relit le survol à chaque pas. Sous la
// carte, le pointeur immobile à 10 px de sa place de repos la garde soulevée ; à 30, 50 et 70 px il ne touche plus rien : la carte retombe et
// la zone invisible qu'elle traîne s'en va avec le survol, au lieu de rester touchable pendant la chute (qui balayait le pointeur, la
// relevait, et ainsi de suite : un clignotement en dehors de la carte)

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'dks-page.mjs': `<@@deck class="seule"><a class="s1" href="#un" title="un">1</a></@@deck>
<@@deck class="trois"><a class="c1" href="#un" title="un">1</a><a class="c2" href="#deux" title="deux">2</a><a class="c3" href="#trois" title="trois">3</a></@@deck>
`,
}

type Carte = { haut: number, bas: number, survol: boolean }
type Point = { x: number, y: number }

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('deck-survol', SOURCES, prod))

// une carte : le haut et le bas de sa boîte à l'écran, et si elle est survolée
const carte = (page: any, c: string): Promise<Carte> => page.evaluate((c: string) => {
  const el = (document.querySelector('mjs-dks-page') as any)._shadow.querySelector('.' + c)
  const r  = el.getBoundingClientRect()
  return { haut: r.top, bas: r.bottom, survol: el.matches(':hover') }
}, c)

// un point du paquet, loin des cartes : à gauche ou à droite, à mi-hauteur
const horsDesCartes = (page: any, paquet: string, cote: 'gauche' | 'droite'): Promise<Point> => page.evaluate(([p, cote]: string[]) => {
  const r = (document.querySelector('mjs-dks-page') as any)._shadow.querySelector('mjs-core-deck.' + p).getBoundingClientRect()
  return { x: cote === 'gauche' ? r.left + 5 : r.right - 5, y: r.top + r.height / 2 }
}, [paquet, cote])

// le point visé : à `dx` du bord gauche (positif) ou droit (négatif) de la boîte de la carte, 15 px au-dessus de son bord bas tel que le
// pointeur le trouve à cet endroit (une carte de côté est inclinée) ; seule cette carte s'y trouve, aucune voisine dessous
const pres = (page: any, c: string, dx: number): Promise<Point | null> => page.evaluate(([c, dx]: [string, number]) => {
  const root = (document.querySelector('mjs-dks-page') as any)._shadow
  const el   = root.querySelector('.' + c)
  const r    = el.getBoundingClientRect()
  const x    = Math.round(dx > 0 ? r.left + dx : r.right + dx)
  for (let y = Math.round(r.bottom) + 2; y > r.top; y--) {
    if (root.elementFromPoint(x, y) !== el) continue
    const cible = { x, y: y - 15 }
    const sous  = root.elementsFromPoint(cible.x, cible.y).filter((n: any) => n.localName === 'a')
    return sous.length === 1 && sous[0] === el ? cible : null
  }
  return null
}, [c, dx])

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@deck> : la carte survolée près de son bord ne clignote pas (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let built: { root: string, script: string } = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await bati(prod)
    browser = await (await import('playwright'))[nom].launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  async function ouvrir() {
    const ctx  = await browser.newContext({ viewport: { width: 900, height: 1200 } })
    const page = await ctx.newPage()
    const plantages: string[] = []
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://d.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding-top:120px"><mjs-dks-page></mjs-dks-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://d.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => [...((document.querySelector('mjs-dks-page') as any)?._shadow?.querySelectorAll('mjs-core-deck') ?? [])].filter((d: any) => d._shadow?.querySelector('slot')).length === 2, null, { timeout: 15000 })
    await page.waitForTimeout(200)
    return { ctx, page, plantages }
  }

  // l'éventail ouvert par le pointeur posé loin des cartes, puis le pointeur près du bord bas de la carte : il tremble d'un pixel pendant
  // 2 s ; une fois soulevée (0,5 s de transition), la carte ne bouge plus et garde le survol. Le pointeur parti, elle retombe à sa place
  async function survolerPresDuBord(page: any, paquet: string, c: string, cote: 'gauche' | 'droite', dx: number) {
    const depart = await horsDesCartes(page, paquet, cote)
    await page.mouse.move(depart.x, depart.y)
    await page.waitForTimeout(700)
    const ouverte = await carte(page, c)
    assert.equal(ouverte.survol, false, 'éventail ouvert, la carte n\'est pas encore survolée')
    const p = await pres(page, c, dx)
    assert.ok(p, 'un point près du bord bas, sur cette carte seule')
    await page.mouse.move(p!.x, p!.y, { steps: 4 })
    const releves: Carte[] = []
    for (let k = 0; k < 40; k++) {
      await page.mouse.move(p!.x + (k % 2), p!.y)
      await page.waitForTimeout(50)
      releves.push(await carte(page, c))
    }
    const posee = releves.slice(15)
    const hauts = posee.map((r) => Math.round(r.haut))
    const dit   = JSON.stringify(releves.map((r) => `${Math.round(r.haut)}${r.survol ? 's' : '-'}`))
    assert.ok(posee.every((r) => r.survol), `la carte garde le survol : ${dit}`)
    assert.ok(Math.max(...hauts) - Math.min(...hauts) <= 1, `la carte ne retombe pas : ${dit}`)
    assert.ok(ouverte.haut - posee[0].haut >= 45, `la carte est bien soulevée : ${Math.round(ouverte.haut)} → ${dit}`)
    await page.mouse.move(depart.x, depart.y, { steps: 4 })
    await page.waitForTimeout(700)
    const quittee = await carte(page, c)
    assert.equal(quittee.survol, false, 'pointeur parti : plus de survol')
    assert.ok(Math.abs(quittee.haut - ouverte.haut) <= 1, `pointeur parti : la carte retombe à sa place (${Math.round(ouverte.haut)} → ${Math.round(quittee.haut)})`)
  }

  it('une carte seule, le pointeur à 15 px de son bord bas : elle reste soulevée, sans retomber', async () => {
    const { ctx, page, plantages } = await ouvrir()
    await survolerPresDuBord(page, 'seule', 's1', 'gauche', 30)
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('la dernière de trois cartes, le pointeur près de son coin bas : soulevée et glissée de côté, elle reste sous le pointeur', async () => {
    const { ctx, page, plantages } = await ouvrir()
    await survolerPresDuBord(page, 'trois', 'c3', 'droite', -40)
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  // l'éventail ouvert, la carte survolée (elle se soulève), puis le pointeur glissé à `distance` px sous son bord bas de repos et laissé
  // immobile 3 s : le nombre de fois où le survol bascule, et la place de la carte à la fin. Le pointeur parti, la carte retombe à sa place
  async function immobileSousLaCarte(page: any, paquet: string, c: string, distance: number) {
    const depart = await horsDesCartes(page, paquet, 'gauche')
    await page.mouse.move(depart.x, depart.y)
    await page.waitForTimeout(700)
    const repos = await carte(page, c)
    assert.equal(repos.survol, false, `à ${distance} px : éventail ouvert, la carte n'est pas encore survolée`)
    const milieu = await page.evaluate((c: string) => {
      const r = (document.querySelector('mjs-dks-page') as any)._shadow.querySelector('.' + c).getBoundingClientRect()
      return r.left + r.width / 2
    }, c)
    await page.mouse.move(milieu, repos.bas - 30, { steps: 3 })
    await page.waitForTimeout(800)
    const soulevee = await carte(page, c)
    assert.ok(soulevee.survol && repos.haut - soulevee.haut >= 45, `à ${distance} px : la carte survolée se soulève (${Math.round(repos.haut)} → ${Math.round(soulevee.haut)})`)
    await page.mouse.move(milieu, repos.bas + distance, { steps: 6 })
    await page.waitForTimeout(200)
    const releves: Carte[] = []
    let bascules = 0
    for (let k = 0; k < 60; k++) {
      await page.waitForTimeout(50)
      const r = await carte(page, c)
      if (releves.length > 0 && r.survol !== releves[releves.length - 1].survol) bascules++
      releves.push(r)
    }
    const dit      = JSON.stringify(releves.filter((_, k) => k % 6 === 0).map((r) => `${Math.round(r.haut)}${r.survol ? 's' : '-'}`))
    const fin      = releves.slice(-10)
    const hauts    = fin.map((r) => Math.round(r.haut))
    const retombee = fin.every((r) => !r.survol) && Math.abs(fin[0].haut - repos.haut) <= 1
    const gardee   = fin.every((r) => r.survol) && repos.haut - fin[0].haut >= 45
    assert.equal(bascules, 0, `à ${distance} px, pointeur immobile : le survol ne bascule pas (${bascules} bascules en 3 s) : ${dit}`)
    assert.ok(Math.max(...hauts) - Math.min(...hauts) <= 1, `à ${distance} px : la carte ne bouge plus à la fin : ${dit}`)
    assert.ok(retombee || gardee, `à ${distance} px : la carte est soulevée sous le pointeur, ou retombée à sa place (pas entre les deux) : ${dit}`)
    if (distance === 10) assert.ok(gardee, `à ${distance} px : la place que la carte a quittée tient encore le pointeur, elle reste soulevée : ${dit}`)
    if (distance >= 50) assert.ok(retombee, `à ${distance} px : le pointeur ne touche plus rien, la carte retombe : ${dit}`)
    await page.mouse.move(depart.x, depart.y, { steps: 4 })
    await page.waitForTimeout(900)
    const quittee = await carte(page, c)
    assert.equal(quittee.survol, false, `à ${distance} px, pointeur parti : plus de survol`)
    assert.ok(Math.abs(quittee.haut - repos.haut) <= 1, `à ${distance} px, pointeur parti : la carte retombe à sa place (${Math.round(repos.haut)} → ${Math.round(quittee.haut)})`)
  }

  it('une carte seule, le pointeur immobile sous sa place de repos : soulevée à 10 px, retombée plus bas, et le survol ne bascule jamais', async () => {
    const { ctx, page, plantages } = await ouvrir()
    for (const distance of [10, 30, 50, 70]) await immobileSousLaCarte(page, 'seule', 's1', distance)
    assert.deepEqual(plantages, [])
    await ctx.close()
  })
})
