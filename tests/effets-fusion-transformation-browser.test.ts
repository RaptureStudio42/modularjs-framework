// *blend sur une balise transformée ou composée par le navigateur : le calque couvre la boîte peinte et la région du filtre ne rogne
// pas la balise. Une transformation presque nulle (rotation de 0,4°, échelle de 1,008) laisse la boîte à moins d'un demi-pixel de sa
// mise en page ; `*tilt` au repos, `will-change: transform` et `perspective(...)` font peindre la balise par une couche à part, dont
// l'origine est arrondie avant qu'on lui ajoute sa taille (38 + 50,5 donne 89, là où la boîte seule s'arrondit à 88) : elle a une
// colonne de plus que le cadre du calque. Une région au ras du cadre, ou un cheveu en deçà, la rogne (la colonne devient blanche) ;
// une bordure droite d'1 px disparaîtrait avec elle. Chaque cas est comparé à la même page sans *blend : pas de pixel de la balise
// rogné, pas plus de pixels faux (gris non teinté, blanc teinté) que le plafond de sa forme, et le même rendu à chaque chargement.
// Chromium en densité réelle (--force-device-scale-factor : la page se met en page au pixel d'appareil) et Firefox, 1,25 et 1,5.
//
// La fin ou l'annulation d'une transition ou d'une animation relit le cadre des balises touchées, sauf celles qui portent une
// transformation ou dont un ancêtre en porte une : leur cadre reste celui du repos tant que la transformation n'est pas revenue à
// l'identité, et la fin de la transition qui la rend relit et recale le cadre. 1) `*tilt` au survol, Chromium : le premier signal d'un
// survol arrive quand la boîte inclinée est encore à un demi-pixel de sa mise en page, un cadre alors calculé sur elle serait gardé pour
// tout le survol, et le cadre de repli (pixels CSS entiers) rogne ou déborde d'un pixel d'appareil selon la forme et la densité ; le
// plafond de chaque forme (balise, carte, enfant d'une carte `*tilt`) est le nombre de pixels faux qu'elle avait avant ces écouteurs, au
// pointeur rapide (4 pas) comme au pointeur lent (40 pas), en densité réelle comme à la densité 1 et en émulation. 2) une transformation
// posée sur l'hôte du composant, hors de la racine où vit la balise : la fin de sa transition relit encore la balise, une fois la
// transformation revenue à l'identité. 3) le coût : une fin de transition ne relit que la cible de l'événement et les balises qui en
// descendent (racines d'ombre comprises), jamais les autres, ni celles qu'une transformation tient en place.

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

const G = '#b4b4b4'
const BLEND = '*blend(multiply, color: #ff0000, order: under)'

type Cas = { id: string, quoi: string, fx?: string, css: string[], plus?: string[], plafond: Record<'chromium' | 'firefox', [number, number]> }
const CAS: Cas[] = [
  { id: 'plein', quoi: 'sans transformation', css: [], plafond: { chromium: [0, 0], firefox: [64, 12] } },
  { id: 'rotation', quoi: 'rotation de 0,4°', css: ['transform: rotate(.4deg)'], plafond: { chromium: [6, 14], firefox: [58, 130] } },
  { id: 'echelle1', quoi: 'échelle de 1,008', css: ['transform: scale(1.008)'], plafond: { chromium: [8, 34], firefox: [168, 250] } },
  { id: 'echelle2', quoi: 'échelle de 1,012', css: ['transform: scale(1.012)'], plafond: { chromium: [16, 32], firefox: [215, 272] } },
  { id: 'tilt', quoi: '*tilt au repos', fx: '*tilt', css: [], plafond: { chromium: [64, 74], firefox: [64, 12] } },
  { id: 'will', quoi: 'will-change: transform', css: ['will-change: transform'], plafond: { chromium: [64, 74], firefox: [64, 12] } },
  { id: 'persp', quoi: 'perspective(800px)', css: ['transform: perspective(800px) rotateX(0deg) rotateY(0deg) scale(1)'], plafond: { chromium: [64, 74], firefox: [64, 12] } },
  { id: 'bordure', quoi: 'bordure droite d\'1 px', css: ['box-sizing: border-box', `border-right: 1px solid ${G}`], plafond: { chromium: [0, 0], firefox: [66, 12] } },
  { id: 'bordurewill', quoi: 'bordure droite d\'1 px et will-change: transform', css: ['box-sizing: border-box', `border-right: 1px solid ${G}`, 'will-change: transform'], plafond: { chromium: [66, 78], firefox: [66, 12] } },
  { id: 'echellefranche', quoi: 'échelle de 1,5', css: ['transform: scale(1.5)'], plafond: { chromium: [290, 400], firefox: [330, 350] } },
  { id: 'rotationfranche', quoi: 'rotation de 10°', css: ['transform: rotate(10deg)'], plafond: { chromium: [120, 190], firefox: [125, 190] } }
]

// où la boîte se pose : dans Chromium entre deux pixels d'appareil (37,9375 à 1,25), là où une couche à part arrondit autrement que la
// boîte ; dans Firefox au pixel CSS dont le produit par la densité est entier (32 × 1,25 = 40, 32 × 1,5 = 48), où son repère de filtre tombe juste
const ORIGINES = { chromium: { left: 30.35, top: 25.65 }, firefox: { left: 32, top: 24 } }

// la balise qu'une classe agrandit, avec une transition : pour la transformation qui finit pendant que la page vit
const CYCLE: Omit<Cas, 'plafond'> = { id: 'cycle', quoi: 'une échelle de 1,5 qui finit', css: ['transition: transform 150ms linear'], plus: ['.on', '  transform: scale(1.5)'] }

function source(c: Pick<Cas, 'fx' | 'css' | 'plus'>, blend: boolean, origine: { left: number, top: number }): string {
  const fx  = c.fx ? c.fx + ' ' : ''
  const css = ['.w', '  position: absolute', `  left: ${origine.left}px`, `  top: ${origine.top}px`, '.t', '  display: block', '  width: 40.4px', '  height: 30.4px', `  background: ${G}`, '  border-radius: 12px', ...c.css.map((l) => '  ' + l), ...(c.plus || [])].join('\n')
  return `<div class="w"><div class="t" ${fx}${blend ? BLEND : ''}></div></div>\n<style>\n${css}\n</style>\n`
}

// le script que les pages chargent : le bundle des composants donnés (nom de fichier → source)
async function compile(etiquette: string, sources: Record<string, string>): Promise<string> {
  const root   = mjsTmp(etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, contenu] of Object.entries(sources)) writeFileSync(join(srcDir, nom), contenu)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
}

// une page vide qui monte le composant `tag` du script, à la densité du contexte
async function ouvre(ctx: any, script: string, tag: string) {
  const page = await ctx.newPage()
  await page.route('http://t.test/**', (route: any) => {
    if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
  })
  await page.goto('http://t.test/', { waitUntil: 'load' })
  await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.t'), tag)
  await page.waitForTimeout(400)
  return page
}

// les pixels faux d'une capture contre la même page sans *blend (gris → teinté, blanc → blanc) : manquants (gris de la
// référence resté non teinté), débordants (blanc de la référence teinté), rognés (la balise elle-même, grise dans la
// référence, devenue blanche) ; et combien de pixels diffèrent de la première capture, d'un chargement à l'autre
async function mesure(page: any, capture: string, reference: string, autres: string[]) {
  return await page.evaluate(async ([a64, r64, autres64]: [string, string, string[]]) => {
    const charge = async (s: string) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D; x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height) }
    const P = await charge(a64)
    const R = await charge(r64)
    let manquants  = 0
    let debordants = 0
    let rognes     = 0
    for (let i = 0; i < R.data.length; i += 4) {
      const al = Math.min(1, Math.max(0, (255 - R.data[i]) / 75))
      const d  = Math.max(Math.abs(P.data[i] - (255 - 75 * al)), Math.abs(P.data[i + 1] - (255 - 255 * al)), Math.abs(P.data[i + 2] - (255 - 255 * al)))
      if (d > 40) { if (al > 0.5) manquants++; else debordants++ }
      if (al > 0.999 && P.data[i + 1] > 235) rognes++
    }
    let variables = 0
    for (const s of autres64) {
      const Q = await charge(s)
      let n = 0
      for (let i = 0; i < P.data.length; i += 4) if (Math.abs(P.data[i] - Q.data[i]) > 8 || Math.abs(P.data[i + 1] - Q.data[i + 1]) > 8 || Math.abs(P.data[i + 2] - Q.data[i + 2]) > 8) n++
      variables = Math.max(variables, n)
    }
    return { manquants, debordants, rognes, variables }
  }, [capture, reference, autres] as [string, string, string[]])
}

type Config = { nom: string, dpr: number }
const CONFIGS: Config[] = [{ nom: 'densité 1,25', dpr: 1.25 }, { nom: 'densité 1,5', dpr: 1.5 }]

for (const nom of ['chromium', 'firefox'] as const) {
  for (const config of CONFIGS) {
    describe(`*blend (${nom} réel, ${config.nom}) — une balise transformée ou composée`, function () {
      this.timeout(120000)
      let present = false
      let script  = ''
      let browser = null as any

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test de *blend sur une balise transformée sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const sources = {} as Record<string, string>
        for (const c of [...CAS, CYCLE]) {
          sources[`fb-trf-${c.id}-bl.mjs`] = source(c, true, ORIGINES[nom])
          sources[`fb-trf-${c.id}-rf.mjs`] = source(c, false, ORIGINES[nom])
        }
        script = await compile('effets-fusion-transformation-' + nom, sources)
        const lanceur = (await import('playwright'))[nom]
        // Chromium réel : la densité vient du drapeau, la page se met en page au pixel d'appareil ; Firefox : la densité du contexte
        browser = await lanceur.launch(nom === 'chromium' ? { args: [`--force-device-scale-factor=${config.dpr}`, '--window-size=260,240'] } : {})
      })

      after(async () => {
        if (browser) await browser.close()
        await terminateSharedWorkerPool()
      })

      const contexte = () => nom === 'chromium' ? browser.newContext({ viewport: null }) : browser.newContext({ viewport: { width: 260, height: 240 }, deviceScaleFactor: config.dpr })

      for (const c of CAS) {
        it(`${c.quoi} : la balise n'est pas rognée, les pixels faux tiennent sous le plafond et le rendu est le même à chaque chargement`, async function () {
          if (!present) { this.skip(); return }
          const ctx = await contexte()
          try {
            const rf        = await ouvre(ctx, script, `mjs-fb-trf-${c.id}-rf`)
            const reference = (await rf.screenshot()).toString('base64')
            const captures  = [] as string[]
            for (let n = 0; n < 3; n++) {
              const page = await ouvre(ctx, script, `mjs-fb-trf-${c.id}-bl`)
              captures.push((await page.screenshot()).toString('base64'))
              await page.close()
            }
            const m = await mesure(rf, captures[0], reference, captures.slice(1))
            if (process.env.MJS_TEST_TOTAUX) console.log(`TRANSFORMATION ${nom} ${config.dpr} ${c.id} ${JSON.stringify(m)}`)
            assert.equal(m.rognes, 0, `${m.rognes} pixels de la balise sont rognés (devenus blancs) : la région du filtre coupe la balise elle-même`)
            const plafond = c.plafond[nom][CONFIGS.indexOf(config)]
            assert.ok(m.manquants + m.debordants <= plafond, `${m.manquants} pixels manquants et ${m.debordants} débordants, ${plafond} faux au plus`)
            assert.equal(m.variables, 0, `${m.variables} pixels diffèrent d'un chargement à l'autre`)
          } finally {
            await ctx.close()
          }
        })
      }

      // la fenêtre se redimensionne pendant que la balise est agrandie, puis la transformation finit : rien d'autre ne signale la
      // fin, la page doit relire le cadre à la fin de la transition, et la balise reprendre exactement le rendu de la page chargée à plat
      it(`${CYCLE.quoi} après un redimensionnement : au repos, le rendu est celui de la page chargée à plat`, async function () {
        if (!present) { this.skip(); return }
        const ctx = await contexte()
        try {
          const plat      = await ouvre(ctx, script, 'mjs-fb-trf-plein-bl')
          const attendue  = (await plat.screenshot()).toString('base64')
          const reference = (await (await ouvre(ctx, script, 'mjs-fb-trf-plein-rf')).screenshot()).toString('base64')
          const page      = await ouvre(ctx, script, `mjs-fb-trf-${CYCLE.id}-bl`)
          const classe    = (ajoute: boolean) => page.evaluate((a: boolean) => (document.querySelector('mjs-fb-trf-cycle-bl') as any)._shadow.querySelector('.t').classList[a ? 'add' : 'remove']('on'), ajoute)
          await classe(true)
          await page.waitForTimeout(400)
          await page.evaluate('window.dispatchEvent(new Event("resize"))')
          await page.waitForTimeout(300)
          await classe(false)
          await page.waitForTimeout(600)
          const m = await mesure(page, (await page.screenshot()).toString('base64'), reference, [attendue])
          assert.equal(m.variables, 0, `${m.variables} pixels diffèrent de la page chargée à plat : le calque est resté calé sur la balise agrandie`)
        } finally {
          await ctx.close()
        }
      })

      // la même échelle posée sur l'hôte du composant, hors de la racine où vit la balise : la fin de sa transition ne traverse pas la
      // racine d'ombre, c'est l'écoute de la page qui la reçoit, et la balise (descendante de l'hôte) doit être relue
      it('une échelle de 1,5 sur l\'hôte du composant, hors de sa racine : au repos, le rendu est celui de la page chargée à plat', async function () {
        if (!present) { this.skip(); return }
        const ctx = await contexte()
        try {
          const plat      = await ouvre(ctx, script, 'mjs-fb-trf-plein-bl')
          const attendue  = (await plat.screenshot()).toString('base64')
          const reference = (await (await ouvre(ctx, script, 'mjs-fb-trf-plein-rf')).screenshot()).toString('base64')
          const page      = await ouvre(ctx, script, 'mjs-fb-trf-plein-bl')
          await page.addStyleTag({ content: 'mjs-fb-trf-plein-bl{display:block;transition:transform 150ms linear}mjs-fb-trf-plein-bl.on{transform:scale(1.5)}' })
          const classe    = (ajoute: boolean) => page.evaluate((a: boolean) => (document.querySelector('mjs-fb-trf-plein-bl') as any).classList[a ? 'add' : 'remove']('on'), ajoute)
          await classe(true)
          await page.waitForTimeout(400)
          await page.evaluate('window.dispatchEvent(new Event("resize"))')
          await page.waitForTimeout(300)
          await classe(false)
          await page.waitForTimeout(600)
          const m = await mesure(page, (await page.screenshot()).toString('base64'), reference, [attendue])
          assert.equal(m.variables, 0, `${m.variables} pixels diffèrent de la page chargée à plat : le calque est resté calé sur la balise agrandie`)
        } finally {
          await ctx.close()
        }
      })
    })
  }
}

// `*tilt` au survol, Chromium : la souris se pose à 20 % de la largeur et 25 % de la hauteur de la balise, et y reste le temps que
// l'inclinaison finisse ; la même page sans *blend, survolée de même, sert de référence. Les plafonds sont ceux d'avant les écouteurs de
// fin de transition, que le survol n'écrit pas : en densité réelle, le cadre calé du repos colle mieux à la couche inclinée que le cadre
// de repli (0 à 1,75 pour la balise et l'enfant ; 277 pour la carte, que ce cadre rate déjà à cette densité) ; à la densité 1, c'est
// l'inverse pour la balise et l'enfant (79 et 92 pixels faux), mais le cadre de repli y perdrait une rangée de la carte (aucun pixel
// faux sans lui)
type Survol = { id: string, quoi: string, w: number, h: number, left: number, top: number, enfant?: boolean, plafond: number[] }
const DENSITES          = [1, 1.25, 1.5, 1.75, 2]
const SURVOLS: Survol[] = [
  { id: 'balise', quoi: 'une balise de 40,4 × 30,4 en (30,35 ; 25,65)', w: 40.4, h: 30.4, left: 30.35, top: 25.65, plafond: [83, 81, 101, 4, 127] },
  { id: 'carte', quoi: 'une carte de 150,7 × 90,3 en (12,4 ; 14,6)', w: 150.7, h: 90.3, left: 12.4, top: 14.6, plafond: [4, 4, 4, 281, 4] },
  { id: 'enfant', quoi: 'l\'enfant de 60,4 × 40,4 d\'une carte *tilt', w: 60.4, h: 40.4, left: 30.35, top: 25.65, enfant: true, plafond: [96, 109, 124, 4, 124] }
]

// la balise de 45,3 × 40,2 : une boîte dont les bords tombent entre deux pixels d'appareil à chaque densité
const DECALEE: Omit<Survol, 'plafond'> = { id: 'decalee', quoi: 'une balise de 45,3 × 40,2 en (13,34 ; 6,86)', w: 45.3, h: 40.2, left: 13.34, top: 6.86 }

// le pointeur lent : 40 pas au lieu de 4, donc autant d'annulations de la transition de l'inclinaison avant qu'elle se pose ; chaque
// forme à des densités réelles, la carte aussi à la densité 1 et en émulation de 1,5. Les plafonds sont ceux d'avant les écouteurs
type Lent = { forme: Omit<Survol, 'plafond'>, dpr: number, reel: boolean, plafond: number }
const LENTS: Lent[] = [
  { forme: SURVOLS[0], dpr: 1.25, reel: true, plafond: 81 },
  { forme: SURVOLS[0], dpr: 1.75, reel: true, plafond: 4 },
  { forme: SURVOLS[0], dpr: 2, reel: true, plafond: 127 },
  { forme: DECALEE, dpr: 1.25, reel: true, plafond: 107 },
  { forme: DECALEE, dpr: 1.75, reel: true, plafond: 158 },
  { forme: DECALEE, dpr: 2, reel: true, plafond: 150 },
  { forme: SURVOLS[1], dpr: 1, reel: true, plafond: 4 },
  { forme: SURVOLS[1], dpr: 1.5, reel: false, plafond: 78 }
]

function sourceSurvol(s: Omit<Survol, 'plafond'>, blend: boolean): string {
  const css = ['.w', '  position: absolute', `  left: ${s.left}px`, `  top: ${s.top}px`, '.t', '  display: block', `  width: ${s.w}px`, `  height: ${s.h}px`, `  background: ${G}`, '  border-radius: 12px'].join('\n')
  return `<div class="w"${s.enfant ? ' *tilt' : ''}><div class="t" ${s.enfant ? '' : '*tilt '}${blend ? BLEND : ''}></div></div>\n<style>\n${css}\n</style>\n`
}

async function survole(page: any, tag: string, pas: number) {
  const r = await page.evaluate((t: string) => { const b = (document.querySelector(t) as any)._shadow.querySelector('.t').getBoundingClientRect(); return [b.left, b.top, b.width, b.height] }, tag)
  await page.mouse.move(r[0] + r[2] * 0.2, r[1] + r[3] * 0.25, { steps: pas })
  await page.waitForTimeout(500)
}

// la forme survolée en `pas` déplacements, sur la page *blend et sur la même sans : ses pixels faux contre la référence, et ceux qui
// diffèrent d'un chargement à l'autre
async function mesureSurvol(ctx: any, script: string, s: Omit<Survol, 'plafond'>, pas: number) {
  const rf = await ouvre(ctx, script, `mjs-fb-sv-${s.id}-rf`)
  await survole(rf, `mjs-fb-sv-${s.id}-rf`, pas)
  const reference = (await rf.screenshot()).toString('base64')
  const captures  = [] as string[]
  for (let n = 0; n < 3; n++) {
    const page = await ouvre(ctx, script, `mjs-fb-sv-${s.id}-bl`)
    await survole(page, `mjs-fb-sv-${s.id}-bl`, pas)
    captures.push((await page.screenshot()).toString('base64'))
    await page.close()
  }
  return await mesure(rf, captures[0], reference, captures.slice(1))
}

describe('*blend (chromium réel) — une balise *tilt au survol', function () {
  this.timeout(180000)
  let present = false
  let script  = ''

  before(async function () {
    present = await navigateurPresent('chromium')
    if (!present) {
      console.log('  ℹ️  chromium non installé, test de *blend sur une balise *tilt survolée sauté. Activer : `npx playwright install chromium`')
      return
    }
    const sources = {} as Record<string, string>
    for (const s of [...SURVOLS, DECALEE]) {
      sources[`fb-sv-${s.id}-bl.mjs`] = sourceSurvol(s, true)
      sources[`fb-sv-${s.id}-rf.mjs`] = sourceSurvol(s, false)
    }
    script = await compile('effets-fusion-survol', sources)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const dpr of DENSITES) {
    describe(`densité ${dpr}`, function () {
      let browser = null as any

      before(async function () {
        if (!present) return
        browser = await (await import('playwright')).chromium.launch({ args: [`--force-device-scale-factor=${dpr}`, '--window-size=260,240'] })
      })

      after(async () => { if (browser) await browser.close() })

      for (const s of SURVOLS) {
        const plafond = s.plafond[DENSITES.indexOf(dpr)]
        it(`${s.quoi} au survol : au plus ${plafond} pixels faux, le rendu est le même à chaque chargement`, async function () {
          if (!present) { this.skip(); return }
          const ctx = await browser.newContext({ viewport: null })
          try {
            const m = await mesureSurvol(ctx, script, s, 4)
            if (process.env.MJS_TEST_TOTAUX) console.log(`SURVOL ${dpr} ${s.id} ${JSON.stringify(m)}`)
            assert.ok(m.manquants + m.debordants <= plafond, `${m.manquants} pixels manquants et ${m.debordants} débordants, ${plafond} faux au plus : le cadre a été réécrit pendant l'inclinaison`)
            assert.equal(m.variables, 0, `${m.variables} pixels diffèrent d'un chargement à l'autre`)
          } finally {
            await ctx.close()
          }
        })
      }
    })
  }

  // le pointeur lent : chaque déplacement annule la transition de l'inclinaison en cours, le premier signal arrive quand la boîte est encore
  // à un demi-pixel de sa mise en page
  for (const l of LENTS) {
    const densite = `${l.reel ? 'densité réelle' : 'densité émulée'} ${l.dpr}`
    it(`${l.forme.quoi} au survol d'un pointeur lent, ${densite} : au plus ${l.plafond} pixels faux, le rendu est le même à chaque chargement`, async function () {
      if (!present) { this.skip(); return }
      const browser = await (await import('playwright')).chromium.launch(l.reel ? { args: [`--force-device-scale-factor=${l.dpr}`, '--window-size=260,240'] } : {})
      try {
        const ctx = await browser.newContext(l.reel ? { viewport: null } : { viewport: { width: 260, height: 240 }, deviceScaleFactor: l.dpr })
        const m   = await mesureSurvol(ctx, script, l.forme, 40)
        if (process.env.MJS_TEST_TOTAUX) console.log(`SURVOL LENT ${l.dpr} ${l.reel ? 'reel' : 'emule'} ${l.forme.id} ${JSON.stringify(m)}`)
        assert.ok(m.manquants + m.debordants <= l.plafond, `${m.manquants} pixels manquants et ${m.debordants} débordants, ${l.plafond} faux au plus : le cadre a été réécrit pendant l'inclinaison`)
        assert.equal(m.variables, 0, `${m.variables} pixels diffèrent d'un chargement à l'autre`)
      } finally {
        await browser.close()
      }
    })
  }
})

// le coût : 300 balises *blend, et des fins de transition qui ne les touchent pas. Les lectures de boîte (getBoundingClientRect et
// getClientRects) que l'effet fait par le prototype se comptent par balise
const BALISES  = 300
const LECTURES = `(() => {
  const lectures = new Map()
  window.__zero = () => lectures.clear()
  window.__lectures = () => [...lectures.entries()].map(([el, n]) => [el.className, n[0], n[1]])
  ;['getBoundingClientRect', 'getClientRects'].forEach((nom, k) => {
    const natif = Element.prototype[nom]
    Element.prototype[nom] = function () {
      if (this.hasAttribute('mjs-fx-blend-use')) { const n = lectures.get(this) || [0, 0]; n[k]++; lectures.set(this, n) }
      return natif.apply(this, arguments)
    }
  })
})()`
const balises = (n: number, fx = '', depart = 0) => Array.from({ length: n }, (_, i) => `<div class="t t${i + depart}" ${fx}${BLEND}></div>`)
// la balise t0 vit dans un conteneur que sa classe `go` décale sans transformation ; les balises t1 à t5 dans un conteneur que `go`
// transforme, chacun à sa façon : `transform`, puis les propriétés `rotate`, `scale` et `translate`, et enfin le retour de `transform` à une
// matrice qui n'est pas `none` (la perspective seule, que `*tilt` pose au repos) ; cent éléments sans rapport avec une balise *blend se
// déplacent à tour de rôle
const TENUES      = [['q', 't1'], ['r', 't2'], ['u', 't3'], ['v', 't4'], ['p', 't5']]
const COUT_AUTRES = [
  `<div class="s"><div class="t t0" ${BLEND}></div></div>`,
  ...TENUES.map(([c, t]) => `<div class="${c}"><div class="t ${t}" ${BLEND}></div></div>`),
  ...balises(BALISES - 6, '', 6),
  ...Array.from({ length: 100 }, () => '<div class="a"></div>'),
  '<style>',
  '.t', '  display: inline-block', '  width: 20.4px', '  height: 12.4px', '  margin: 2px', `  background: ${G}`,
  '.s', '  display: inline-block', '  position: relative', '  left: 0', '  transition: left 100ms linear',
  '.s.go', '  left: 14px',
  '.q', '  display: inline-block', '  transition: transform 100ms linear',
  '.q.go', '  transform: scale(1.1)',
  '.r', '  display: inline-block', '  transition: rotate 100ms linear',
  '.r.go', '  rotate: 20deg',
  '.u', '  display: inline-block', '  transition: scale 100ms linear',
  '.u.go', '  scale: 1.1',
  '.v', '  display: inline-block', '  transition: translate 100ms linear',
  '.v.go', '  translate: 6px 0',
  '.p', '  display: inline-block', '  transform: perspective(800px) rotateX(0deg)', '  transition: transform 100ms linear',
  '.p.go', '  transform: perspective(800px) rotateX(20deg)',
  '.a', '  display: inline-block', '  width: 10px', '  height: 10px', '  margin: 2px', '  background: #888', '  transition: transform 100ms linear',
  '.a.go', '  transform: translateX(20px)',
  '</style>', ''
].join('\n')
// 300 cartes *tilt, sous une bande vide où la souris quitte les cartes
const COUT_TILT = [
  '<div class="vide"></div>',
  ...balises(BALISES, '*tilt '),
  '<style>',
  '.vide', '  height: 30px',
  '.t', '  display: inline-block', '  width: 60.4px', '  height: 40.4px', '  margin: 4px', `  background: ${G}`, '  border-radius: 8px',
  '</style>', ''
].join('\n')

// les lectures de la balise de classe `classe` (t0 par défaut), et celles de toutes les autres
const lecturesDe = (lignes: [string, number, number][], classe = 't t0') => {
  const somme = (garde: (c: string) => boolean) => lignes.filter(([c]) => garde(c)).reduce((s, [, r, k]) => s + r + k, 0)
  return { cible: somme((c) => c === classe), autres: somme((c) => c !== classe) }
}

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*blend (${nom} réel) — une fin de transition ne relit que les balises qu'elle touche`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''
    let browser = null as any

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test du coût des relectures de *blend sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      script  = await compile('effets-fusion-cout-' + nom, { 'fb-cout-autres.mjs': COUT_AUTRES, 'fb-cout-tilt.mjs': COUT_TILT })
      browser = await (await import('playwright'))[nom].launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    // la page montée, ses 300 balises posées, les compteurs à zéro
    async function prete(ctx: any, tag: string) {
      await ctx.addInitScript(LECTURES)
      const page = await ouvre(ctx, script, tag)
      await page.waitForFunction(([t, n]: [string, number]) => (document.querySelector(t) as any)._shadow.querySelectorAll('[mjs-fx-blend-use]').length === n, [tag, BALISES] as [string, number])
      await page.waitForTimeout(700)
      return page
    }

    it('cent fins de transition étalées sur des éléments sans rapport ne relisent aucune balise ; celle d\'un conteneur relit la balise qu\'il porte, sauf tant qu\'une transformation la tient', async function () {
      if (!present) { this.skip(); return }
      const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } })
      try {
        const page   = await prete(ctx, 'mjs-fb-cout-autres')
        const classe = (sel: string, ajoute: boolean) => page.evaluate(async ([s, a]: [string, boolean]) => {
          (document.querySelector('mjs-fb-cout-autres') as any)._shadow.querySelector(s).classList[a ? 'add' : 'remove']('go')
          await new Promise((r) => setTimeout(r, 700))
        }, [sel, ajoute] as [string, boolean])
        await page.evaluate('window.__zero()')
        await page.evaluate(async () => {
          const els = Array.from((document.querySelector('mjs-fb-cout-autres') as any)._shadow.querySelectorAll('.a')) as HTMLElement[]
          els.forEach((e, i) => setTimeout(() => e.classList.add('go'), i * 20))
          await new Promise((r) => setTimeout(r, els.length * 20 + 700))
        })
        const sansRapport = lecturesDe(await page.evaluate('window.__lectures()'))
        if (process.env.MJS_TEST_TOTAUX) console.log(`COUT sans rapport ${nom} ${JSON.stringify(sansRapport)}`)
        assert.equal(sansRapport.cible + sansRapport.autres, 0, `cent éléments sans rapport avec une balise *blend : ${sansRapport.cible + sansRapport.autres} lectures de boîte de balises *blend, aucune attendue`)
        await page.evaluate('window.__zero()')
        await classe('.s', true)
        const conteneur = lecturesDe(await page.evaluate('window.__lectures()'))
        if (process.env.MJS_TEST_TOTAUX) console.log(`COUT conteneur ${nom} ${JSON.stringify(conteneur)}`)
        assert.ok(conteneur.cible >= 1, 'le conteneur de la balise t0 finit sa transition : la balise est relue')
        assert.equal(conteneur.autres, 0, `${conteneur.autres} lectures de boîte des ${BALISES - 1} balises qui ne sont ni la cible ni ses descendantes`)
        // le conteneur d'une balise t1 à t5 se transforme : sa transformation tient la balise, qui garde le cadre de son repos ; il revient à
        // l'identité (pour `p`, une matrice qui n'est pas `none`), la fin de sa transition relit la balise
        for (const [boite, balise] of TENUES) {
          await page.evaluate('window.__zero()')
          await classe('.' + boite, true)
          const tenue = lecturesDe(await page.evaluate('window.__lectures()'), 't ' + balise)
          if (process.env.MJS_TEST_TOTAUX) console.log(`COUT tenue ${nom} ${boite} ${JSON.stringify(tenue)}`)
          assert.equal(tenue.cible, 0, `${tenue.cible} lectures de la balise ${balise}, dont le conteneur .${boite} est transformé : aucune attendue`)
          assert.equal(tenue.autres, 0, `${tenue.autres} lectures de boîte des ${BALISES - 1} balises qui ne sont ni la cible ni ses descendantes`)
          await page.evaluate('window.__zero()')
          await classe('.' + boite, false)
          const rendue = lecturesDe(await page.evaluate('window.__lectures()'), 't ' + balise)
          if (process.env.MJS_TEST_TOTAUX) console.log(`COUT rendue ${nom} ${boite} ${JSON.stringify(rendue)}`)
          assert.ok(rendue.cible >= 1, `la transformation du conteneur .${boite} est revenue à l'identité : la balise ${balise} est relue`)
          assert.equal(rendue.autres, 0, `${rendue.autres} lectures de boîte des ${BALISES - 1} balises qui ne sont ni la cible ni ses descendantes`)
        }
      } finally {
        await ctx.close()
      }
    })

    it('un survol de 2 s sur 300 cartes *tilt ne relit que la carte survolée, quand elle est revenue au repos', async function () {
      if (!present) { this.skip(); return }
      const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } })
      try {
        const page = await prete(ctx, 'mjs-fb-cout-tilt')
        const r    = await page.evaluate(() => { const b = ((document.querySelector('mjs-fb-cout-tilt') as any)._shadow.querySelector('.t0') as HTMLElement).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })
        await page.mouse.move(r[0], r[1])
        await page.waitForTimeout(600)
        await page.evaluate('window.__zero()')
        const mouvements = 120
        for (let i = 0; i < mouvements; i++) {
          await page.mouse.move(r[0] + 20 * Math.sin(i / 6), r[1] + 12 * Math.cos(i / 5))
          await page.waitForTimeout(16)
        }
        await page.mouse.move(10, 10)
        await page.waitForTimeout(900)
        const l = lecturesDe(await page.evaluate('window.__lectures()'))
        if (process.env.MJS_TEST_TOTAUX) console.log(`COUT survol ${nom} ${JSON.stringify(l)}`)
        assert.ok(l.cible >= 1 && l.cible <= 12, `la carte survolée est relue ${l.cible} fois (de 1 à 12 attendues : à la fin du retour au repos, jamais à chaque image de l'inclinaison)`)
        assert.equal(l.autres, 0, `${l.autres} lectures de boîte des ${BALISES - 1} autres cartes, que le survol ne touche pas`)
      } finally {
        await ctx.close()
      }
    })
  })
}
