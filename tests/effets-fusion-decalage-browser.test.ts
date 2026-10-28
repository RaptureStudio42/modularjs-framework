// *blend : une balise que la mise en page décale APRÈS la pose, sans changer sa taille (une image au-dessus
// ou à côté qui arrive, par exemple 10,5 px plus haut et 20,5 px plus à gauche), garde un calque collé à la
// boîte que le navigateur peint à sa nouvelle position : la page ainsi décalée est identique, pixel pour
// pixel, à la page chargée directement dans l'état final. Les bornes se calent sur les pixels d'appareil où
// la boîte tombe ; une boîte qui bouge d'une fraction de pixel sans changer de taille ne réveille pas
// l'observateur de taille : la position se relit à ce qui peut la décaler (une image ou une police qui
// arrive, la page qui grandit ou se redimensionne), pas à chaque image.
// La région du filtre de chaque boîte dépasse le cadre du calque d'un cinquième de pixel d'appareil, à droite et en bas, quelle que
// soit la taille que la page en lit (40,4 px dans le style, 40,39 dans l'observateur, 40,390625 en mise en page dans Chromium) :
// au ras du cadre ou en deçà, Chromium peignait les coins arrondis autrement aux densités fractionnaires (6 à 21 pixels), de temps
// en temps, selon que la première région posée venait du style (en deçà) ou de l'observateur (d'un cheveu au-delà).
// Chromium et Firefox, densités 1, 1,25, 1,5, 1,75 et 2.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { attendre } from './helpers/attendre.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const G = '#b4b4b4'
const BLEND = '*blend(multiply, color: #ff0000, order: under)'
// les deux images arrivent tard : 10,5 px de haut pour celle du dessus, 20,5 px de large pour celle de gauche
const SVG_HAUT   = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="10.5"></svg>'
const SVG_GAUCHE = '<svg xmlns="http://www.w3.org/2000/svg" width="20.5" height="10"></svg>'

const STYLE = [
  '.row',
  '  display: flex',
  '  align-items: flex-start',
  '.t',
  '  flex: none',
  '  margin-left: 10px',
  '  width: 40.4px',
  '  height: 30.4px',
  `  background: ${G}`,
  '  border-radius: 12px',
  '.u',
  '  flex: none',
  '  margin-left: 10px',
  '  width: 40px',
  '  height: 30px',
  `  background: ${G}`,
  `  border: 3px solid ${G}`,
  '  box-sizing: border-box',
  '.v',
  '  flex: none',
  '  margin-left: 10px',
  '  width: 40.6px',
  '  height: 30.6px',
  `  background: ${G}`,
  '  border-radius: 12px',
  '.x',
  '  flex: none',
  '  margin-left: 10px',
  '  width: 40.5px',
  '  height: 30.5px',
  `  background: ${G}`,
  '.large',
  '  width: 44px'
].join('\n')
// la page décalée : les images arrivent après la pose
const DECALEE = [
  '<img class="haut" src="http://t.test/haut.svg" alt="">',
  '<div class="row">',
  '<img class="gauche" src="http://t.test/gauche.svg" alt="">',
  `<div class="t" ${BLEND}></div>`,
  `<div class="u" ${BLEND}></div>`,
  `<div class="v" ${BLEND}></div>`,
  `<div class="x" ${BLEND}></div>`,
  '</div>',
  '<style>',
  'img',
  '  display: block',
  '  visibility: hidden',
  '.gauche',
  '  flex: none',
  STYLE,
  '</style>',
  ''
].join('\n')
// la page de l'état final : mêmes dimensions, tenues par des blocs vides
const FINALE = [
  '<div class="haut"></div>',
  '<div class="row">',
  '<div class="gauche"></div>',
  `<div class="t" ${BLEND}></div>`,
  `<div class="u" ${BLEND}></div>`,
  `<div class="v" ${BLEND}></div>`,
  `<div class="x" ${BLEND}></div>`,
  '</div>',
  '<style>',
  '.haut',
  '  height: 10.5px',
  '.gauche',
  '  flex: none',
  '  width: 20.5px',
  '  height: 10px',
  STYLE,
  '</style>',
  ''
].join('\n')

// la page à variables : la même mise en page, que deux variables de la page décalent (`--h` au-dessus, `--l` à gauche) ;
// la page de l'état final les reçoit dès le départ, la page décalée après la pose
const VARIABLES = [
  '<div class="haut"></div>',
  '<div class="row">',
  '<div class="gauche"></div>',
  `<div class="t" ${BLEND}></div>`,
  `<div class="u" ${BLEND}></div>`,
  `<div class="v" ${BLEND}></div>`,
  `<div class="x" ${BLEND}></div>`,
  '</div>',
  '<style>',
  '.haut',
  '  height: var(--h, 0px)',
  '.gauche',
  '  flex: none',
  '  width: var(--l, 0px)',
  '  height: 10px',
  STYLE,
  '</style>',
  ''
].join('\n')

// ce qui décale la boîte : la variable posée, puis ce que le navigateur ou la page signale (ou rien)
const SCENARIOS: { nom: string, vars: Record<string, string>, signal: string }[] = [
  { nom: 'la page grandit au-dessus (aucun signal)', vars: { '--h': '10.5px' }, signal: '' },
  { nom: 'la fenêtre se redimensionne', vars: { '--l': '20.5px' }, signal: 'window.dispatchEvent(new Event("resize"))' },
  { nom: 'une police finit de se charger', vars: { '--l': '20.5px' }, signal: 'document.fonts.dispatchEvent(new Event("loadingdone"))' },
  { nom: 'l\'onglet redevient visible', vars: { '--l': '20.5px' }, signal: 'document.dispatchEvent(new Event("visibilitychange"))' },
  { nom: 'une image de la même racine finit de se charger', vars: { '--l': '20.5px' }, signal: 'document.querySelector("mjs-fb-decale-var")._shadow.querySelector(".gauche").dispatchEvent(new Event("load"))' }
]

// une balise qui part : l'observateur de la page et les écouteurs partent avec la dernière
const RETRAIT = [
  '<script>',
  '$on = true',
  '</script>',
  `{if $on}<div class="t" ${BLEND}></div>{end}`,
  '<button class="b" @click={$on = !$on}>b</button>',
  '<style>',
  '.t',
  '  width: 40.4px',
  '  height: 30.4px',
  `  background: ${G}`,
  '</style>',
  ''
].join('\n')
// compte les observateurs de taille vivants
const COMPTE = `(() => { const R = window.ResizeObserver; const live = new Set(); window.__ro = () => live.size
 window.ResizeObserver = class extends R { observe(e, o) { super.observe(e, o); live.add(this) } disconnect() { super.disconnect(); live.delete(this) } } })()`

type Config = { nom: string, dpr: number }
const CONFIGS: Config[] = [{ nom: 'densité 1', dpr: 1 }, { nom: 'densité 1,25', dpr: 1.25 }, { nom: 'densité 1,5', dpr: 1.5 }, { nom: 'densité 1,75', dpr: 1.75 }, { nom: 'densité 2', dpr: 2 }]

// la région du filtre de chaque boîte à région bornée, rapportée à la boîte du navigateur : de combien le cadre du calque (en px)
// dépasse ce que la région en dit, la fraction posée fois la mesure de mise en page de la boîte ; négatif, la région est plus large
// que le cadre
type Ecart = { boite: string, largeur: number, hauteur: number }
async function ecartsRegion(page: any): Promise<Ecart[]> {
  return await page.evaluate(() => {
    const sh  = (document.querySelector('mjs-fb-decale-fin') as any)._shadow
    const out = [] as any[]
    for (const c of ['t', 'u', 'v', 'x']) {
      const el = sh.querySelector('.' + c)
      const r  = el.getBoundingClientRect()
      const m  = /#([^"')]+)/.exec(getComputedStyle(el).filter)
      const f  = m && sh.querySelector('#' + m[1])
      const k  = f && f.querySelector('feFlood')
      if (!k || f.getAttribute('filterUnits') !== 'objectBoundingBox') continue
      const n = (e: any, a: string) => parseFloat(e.getAttribute(a))
      out.push({ boite: c, largeur: n(k, 'width') + Math.abs(n(k, 'x')) - n(f, 'width') * r.width, hauteur: n(k, 'height') + Math.abs(n(k, 'y')) - n(f, 'height') * r.height })
    }
    return out
  })
}
// les bornes que l'effet pose sur chaque boîte d'une page (région du filtre et de son remplissage) : une page décalée a
// fini de suivre ses boîtes quand elle porte les mêmes que la page chargée dans l'état final
async function bornes(page: any, tag: string): Promise<string> {
  return await page.evaluate((t: string) => {
    const sh = (document.querySelector(t) as any)._shadow
    return ['t', 'u', 'v', 'x'].map((c) => {
      const el = sh.querySelector('.' + c)
      const m  = /#([^"')]+)/.exec(getComputedStyle(el).filter)
      const f  = m && sh.querySelector('#' + m[1])
      const a  = (e: any) => e ? ['x', 'y', 'width', 'height'].map((n) => e.getAttribute(n)).join(',') : '-'
      return f ? `${c} ${a(f)} ${a(f.querySelector('feFlood'))}` : `${c} sans filtre`
    }).join(' | ')
  }, tag)
}
// les deux pages portent les mêmes bornes, relues tant qu'elles diffèrent (une porte : sous charge, l'effet relit la
// position de ses boîtes plus tard que les 500 ms qu'on lui laissait)
async function memesBornes(fin: any, tagFin: string, autre: any, tagAutre: string): Promise<void> {
  let lu = ['', '']
  await attendre(async () => {
    lu = [await bornes(fin, tagFin), await bornes(autre, tagAutre)]
    return lu[0] === lu[1]
  }, () => `les bornes de la page décalée suivent ses boîtes — état final : ${lu[0]} ; page décalée : ${lu[1]}`)
}

// les boîtes élargies ou ramenées à leur taille : l'observateur de chacune relit la sienne
const bascule = (page: any, ajoute: boolean) => page.evaluate((a: boolean) => {
  const sh = (document.querySelector('mjs-fb-decale-fin') as any)._shadow
  for (const c of ['t', 'u', 'v', 'x']) sh.querySelector('.' + c).classList[a ? 'add' : 'remove']('large')
}, ajoute)

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*blend (${nom} réel) — une balise décalée après la pose, sans changer de taille`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test du décalage de *blend sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-fusion-decalage-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fb-decale-img.mjs'), DECALEE)
      writeFileSync(join(srcDir, 'fb-decale-fin.mjs'), FINALE)
      writeFileSync(join(srcDir, 'fb-decale-var.mjs'), VARIABLES)
      writeFileSync(join(srcDir, 'fb-decale-retrait.mjs'), RETRAIT)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    async function ouvre(contexte: any, tag: string, racine = '') {
      const page = await contexte.newPage()
      await page.route('http://t.test/**', async (route: any) => {
        const url = route.request().url()
        if (url === 'http://t.test/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html style="${racine}"><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
        if (url === 'http://t.test/haut.svg' || url === 'http://t.test/gauche.svg') {
          await new Promise((r) => setTimeout(r, 700))
          return route.fulfill({ contentType: 'image/svg+xml', body: url.endsWith('haut.svg') ? SVG_HAUT : SVG_GAUCHE })
        }
        return route.fulfill({ status: 404, body: '' })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.u'), tag)
      // les images tardives sont arrivées : la boîte a bougé
      await page.waitForFunction((t: string) => Array.from((document.querySelector(t) as any)._shadow.querySelectorAll('img')).every((i: any) => i.complete && i.naturalWidth > 0), tag)
      await page.waitForTimeout(900)
      return page
    }

    // les pixels qui diffèrent d'une page à l'autre : leur nombre, et les premiers (position, couleur dans chaque page)
    async function ecart(p: any, q: any): Promise<{ n: number, premiers: string }> {
      const a = (await p.screenshot()).toString('base64')
      const b = (await q.screenshot()).toString('base64')
      return await q.evaluate(async ([a64, b64]: string[]) => {
        const charge = async (s: string) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D; x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height) }
        const A = await charge(a64)
        const B = await charge(b64)
        let n = 0
        const premiers: string[] = []
        for (let i = 0; i < A.data.length; i += 4) {
          if (Math.abs(A.data[i] - B.data[i]) > 8 || Math.abs(A.data[i + 1] - B.data[i + 1]) > 8 || Math.abs(A.data[i + 2] - B.data[i + 2]) > 8) {
            n++
            if (premiers.length < 12) premiers.push(`(${(i / 4) % A.width},${Math.floor(i / 4 / A.width)}) ${A.data.slice(i, i + 3).join('.')}≠${B.data.slice(i, i + 3).join('.')}`)
          }
        }
        return { n, premiers: premiers.join(' ') }
      }, [a, b])
    }

    for (const config of CONFIGS) {
      it(`${config.nom} : la page décalée par des images tardives est identique à la page chargée dans l'état final`, async function () {
        if (!present) { this.skip(); return }
        const lanceur = (await import('playwright'))[nom]
        const browser = await lanceur.launch()
        try {
          const contexte = await browser.newContext({ viewport: { width: 320, height: 120 }, deviceScaleFactor: config.dpr })
          const fin = await ouvre(contexte, 'mjs-fb-decale-fin')
          const img = await ouvre(contexte, 'mjs-fb-decale-img')
          const pos = await img.evaluate(() => { const sh = (document.querySelector('mjs-fb-decale-img') as any)._shadow; const r = sh.querySelector('.t').getBoundingClientRect(); return [r.left, r.top] })
          assert.deepEqual(pos, [30.5, 10.5], 'les images tardives ont décalé la boîte de 20,5 px et 10,5 px')
          await memesBornes(fin, 'mjs-fb-decale-fin', img, 'mjs-fb-decale-img')
          const diff = await ecart(fin, img)
          assert.equal(diff.n, 0, `${diff.n} pixels diffèrent entre la page décalée par des images tardives et la page chargée dans l'état final : ${diff.premiers}`)
        } finally {
          await browser.close()
        }
      })
      it(`${config.nom} : la région du filtre dépasse le cadre du calque d'un cinquième de pixel d'appareil, que la taille se lise dans le style ou dans l'observateur`, async function () {
        if (!present) { this.skip(); return }
        const lanceur = (await import('playwright'))[nom]
        const browser = await lanceur.launch()
        try {
          const contexte = await browser.newContext({ viewport: { width: 320, height: 120 }, deviceScaleFactor: config.dpr })
          const page     = await ouvre(contexte, 'mjs-fb-decale-fin')
          // la région dépasse le cadre d'un cinquième de pixel d'appareil, à un vingtième près (la mesure de mise en page n'est pas la
          // taille lue) : ni au ras du cadre, que le navigateur arrondit à l'entier supérieur et dont une balise peinte par une couche
          // à part perd une colonne, ni plus d'une demi-rangée au-delà
          const verifie = (ecarts: Ecart[], quand: string) => {
            for (const e of ecarts) for (const axe of ['largeur', 'hauteur'] as const) {
              const px = -e[axe] * config.dpr
              assert.ok(px > 0.15 && px < 0.25, `la région du filtre de la boîte .${e.boite} dépasse le cadre du calque de ${px} px d'appareil en ${axe} (${quand}) : elle doit le dépasser d'un cinquième de pixel`)
            }
          }
          const charge = await ecartsRegion(page)
          if (nom === 'chromium') assert.equal(charge.length, 4, 'les quatre boîtes ont une région bornée')
          verifie(charge, 'à la première lecture')
          await bascule(page, true)
          await page.waitForTimeout(400)
          await bascule(page, false)
          await page.waitForTimeout(400)
          const relu = await ecartsRegion(page)
          if (nom === 'chromium') assert.equal(relu.length, 4, 'les quatre boîtes ont une région bornée après avoir été élargies puis ramenées')
          verifie(relu, 'après avoir élargi les boîtes puis les avoir ramenées')
        } finally {
          await browser.close()
        }
      })
      for (const sc of SCENARIOS) {
        it(`${config.nom} : ${sc.nom} — les bornes suivent la boîte décalée d'une fraction de pixel`, async function () {
          if (!present) { this.skip(); return }
          const lanceur = (await import('playwright'))[nom]
          const browser = await lanceur.launch()
          try {
            const contexte = await browser.newContext({ viewport: { width: 320, height: 120 }, deviceScaleFactor: config.dpr })
            const racine = Object.entries(sc.vars).map(([k, v]) => `${k}:${v}`).join(';')
            const fin = await ouvre(contexte, 'mjs-fb-decale-var', racine)
            const pose = await ouvre(contexte, 'mjs-fb-decale-var')
            await pose.evaluate((vars: Record<string, string>) => { for (const k in vars) document.documentElement.style.setProperty(k, vars[k]) }, sc.vars)
            if (sc.signal) await pose.evaluate(sc.signal)
            await memesBornes(fin, 'mjs-fb-decale-var', pose, 'mjs-fb-decale-var')
            const diff = await ecart(fin, pose)
            assert.equal(diff.n, 0, `${diff.n} pixels diffèrent entre la page décalée (${sc.nom}) et la page chargée dans l'état final : ${diff.premiers}`)
          } finally {
            await browser.close()
          }
        })
      }
    }

    it('la balise retirée ne laisse aucun observateur de taille vivant, celui de la page compris', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 320, height: 120 } })
        await page.addInitScript(COMPTE)
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fb-decale-retrait></mjs-fb-decale-retrait><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fb-decale-retrait') as any)?._shadow?.querySelector('.b'))
        await page.waitForTimeout(900)
        assert.equal(await page.evaluate('window.__ro()'), 2, 'la balise (1) et la page (1) sont observées')
        await page.evaluate(() => (document.querySelector('mjs-fb-decale-retrait') as any)._shadow.querySelector('.b').click())
        await page.waitForFunction(() => !(document.querySelector('mjs-fb-decale-retrait') as any)._shadow.querySelector('.t'))
        await page.waitForTimeout(400)
        assert.equal(await page.evaluate('window.__ro()'), 0, 'retirée, la balise ne laisse aucun observateur')
      } finally {
        await browser.close()
      }
    })
  })
}
