// *spoiler, *weight, *delta et *count dans Chromium, Firefox et WebKit réels : une police web qui
// arrive après la pose (demandée par la balise elle-même, ou `font-family` changé vers une police qui
// se charge) recale l'effet. WebKit n'émet jamais `loadingdone` sur `document.fonts` : il émet
// `loading`, puis résout `ready` ; les deux autres moteurs émettent les deux. Les polices sont servies
// par le test (trois fichiers du système, en retard sur demande). Pour chaque effet : le recalage
// (une police plus large, puis plus étroite ; pour *weight, une police variable, puis une sans axe),
// le repos (aucune mesure, aucune minuterie sans événement) et le retrait (aucun écouteur de
// `document.fonts` ne reste, et une police qui arrive ensuite ne réveille rien). Le coût : une police qui
// arrive fait reprendre la mesure UNE fois (un journal des signaux de `document.fonts` et des reprises de
// chaque effet dit leur ordre : aucune reprise avant que la police soit prête, une seule après), y compris
// pour un effet posé alors que sa police est déjà en route (son `loading` est parti avant lui). WebKit est
// sauté quand il est absent : `PLAYWRIGHT_BROWSERS_PATH=<dossier qui l'a>` ou `npx playwright install webkit`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Moteur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Moteur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// trois polices du système, servies à la page en @font-face : une variable (axe wght), une large et
// une étroite (sans axe) ; aucune n'est utilisée avant que le test la demande
const POLICES: Record<string, string> = {
  'variable.ttf': '/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf',
  'large.ttf':    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'etroite.ttf':  '/usr/share/fonts/truetype/ubuntu/Ubuntu-C.ttf'
}

// la police de la balise qui porte l'effet vient de `--pf-police` (posée sur la page avant la pose) ;
// un `font-family` en ligne la remplace ensuite. Le bouton `.t` pose l'effet (ou le retire).
const BASCULE = '<script>\n$on = false\n</script>\n<button class="t" @click={$on = !$on}>t</button>\n'
const SOURCES: Record<string, string> = {
  'pf-masque.mjs':  BASCULE + '<p class="p1">Au début, {if $on}<span class="x" *spoiler(bar, duration: 100ms)>un long secret qui court sur plusieurs lignes du paragraphe sans jamais tenir sur une seule</span>{end} puis la fin.</p>\n<style>\n.p1\n  font: 24px sans-serif\n  width: 400px\n  height: 200px\n  margin: 20px\n.x\n  font-family: var(--pf-police, sans-serif)\n</style>\n',
  'pf-graisse.mjs': BASCULE + '{if $on}<h1 class="g" *weight(160, idle: false, duration: 80ms, fallback: stretch)>Ondulation</h1>{end}\n<style>\n.g\n  font-size: 56px\n  font-weight: 400\n  font-family: var(--pf-police, sans-serif)\n  margin: 20px\n</style>\n',
  'pf-delta.mjs':   BASCULE.replace('$on = false', '$on = false\n$cours = 12480.5') + '<p class="p">Cours {if $on}<span class="d" *delta(duration: 100ms)>{$cours}</span>{end} points</p>\n<style>\n.p\n  font: 32px sans-serif\n  margin: 20px\n.d\n  font-family: var(--pf-police, sans-serif)\n</style>\n',
  'pf-compte.mjs':  BASCULE.replace('$on = false', '$on = false\n$total = 12480') + '<p class="p">Total {if $on}<span class="c" *count(duration: 100ms, on: load)>{$total}</span>{end} points</p>\n<style>\n.p\n  font: 32px sans-serif\n  margin: 20px\n.c\n  font-family: var(--pf-police, sans-serif)\n</style>\n'
}

// ce que le test regarde de chaque effet, lu dans la page : `lire` rend { charge, marque, … } où `charge` dit
// si la police est arrivée et `marque` ce qui change quand la police change ; `juste(v, i)` dit si l'effet est
// calé sur la police `i` (0 : celle de la pose, 1 : celle d'un `font-family` mis ensuite)
type Effet = {
  nom:      string
  tag:      string
  cible:    string
  pose:     string
  polices:  [string, string]
  taille:   string
  suivante: string
  lire:     (arg: string[]) => any
  juste:    (v: any, i: number) => boolean
  // pose dans la page, avant ou après l'effet, de quoi inscrire `recalage` au journal chaque fois que l'effet reprend sa mesure
  espion:   () => void
  // ce que la page doit avoir avant la pose pour que seule la police fasse reprendre la mesure
  prepare?: () => void
}

// la largeur de la balise du nombre : le minimum réservé (en em, rendu en px) doit couvrir le nombre
// écrit, à un pixel près (l'arrondi au pixel supérieur)
const nombreJuste = (v: any) => v.fini && v.largeur > 0 && v.reserve >= v.largeur - 0.6 && v.reserve <= v.largeur + 1.6

// la reprise de *count et de *delta : la mesure de la place du nombre, une fois par reprise
const ESPION_NOMBRE = () => {
  const w: any = window
  const o      = w.µ._mjs_fxNumWidth
  w.µ._mjs_fxNumWidth = function (this: any, ...a: any[]) {
    w.__note()
    return o.apply(this, a)
  }
}

const EFFETS: Effet[] = [
  {
    nom: '*spoiler', tag: 'mjs-pf-masque', cible: '.x', pose: '.x canvas[mjs-fx-layer="spoiler"]', polices: ['Large', 'Etroite'], taille: '24px', suivante: 'Variable',
    lire: ([tag, police]: string[]) => {
      const sh: any = (document.querySelector(tag) as any)._shadow
      const rs      = (Array.from(sh.querySelector('.x').getClientRects()) as any[]).filter((r) => r.width > 0 && r.height > 0)
      const b       = sh.querySelector('.x canvas[mjs-fx-layer="spoiler"]').getBoundingClientRect()
      const texte   = [Math.min(...rs.map((r) => r.left)), Math.min(...rs.map((r) => r.top)), Math.max(...rs.map((r) => r.right)), Math.max(...rs.map((r) => r.bottom))].map(Math.round)
      return { charge: document.fonts.check('24px ' + police), marque: texte, lignes: rs.length, texte, calque: [b.left, b.top, b.right, b.bottom].map(Math.round) }
    },
    // le calque couvre les lignes du texte (la boîte qui les entoure)
    juste: (v: any) => v.texte.every((n: number, i: number) => Math.abs(n - v.calque[i]) <= 2),
    // l'observateur de taille ajuste aussi le calque quand la mise en page bouge (WebKit en prévient à chaque
    // relayout du texte, la police qui charge comprise) : il est retiré ici, pour ne compter que ce que la police déclenche
    prepare: () => { (window as any).ResizeObserver = undefined },
    // la reprise : les rectangles de ligne de la balise, relus à chaque ajustement du calque
    espion: () => {
      const w: any = window
      const o      = Element.prototype.getClientRects
      Element.prototype.getClientRects = function (this: any) {
        if (this.matches('.x')) w.__note()
        return o.call(this)
      }
    }
  },
  {
    nom: '*weight', tag: 'mjs-pf-graisse', cible: '.g', pose: '.g[mjs-fx-weight-mode]', polices: ['Variable', 'Large'], taille: '56px', suivante: 'Etroite',
    lire: ([tag, police]: string[]) => {
      const g: any = (document.querySelector(tag) as any)._shadow.querySelector('.g')
      return { charge: document.fonts.check('56px ' + police), marque: g.getAttribute('mjs-fx-weight-mode'), mode: g.getAttribute('mjs-fx-weight-mode') }
    },
    // une police variable : le mode `variable` ; une police sans axe : le repli demandé (`stretch`)
    juste: (v: any, i: number) => v.mode === ['variable', 'stretch'][i],
    // la reprise : le mode de graisse, écrit sur la balise à chaque mesure de la police
    espion: () => {
      const w: any = window
      const o      = Element.prototype.setAttribute
      Element.prototype.setAttribute = function (this: any, nom: string, v: string) {
        if (nom === 'mjs-fx-weight-mode') w.__note()
        return o.call(this, nom, v)
      }
    }
  },
  {
    nom: '*delta', tag: 'mjs-pf-delta', cible: '.d', pose: '.d [mjs-fx-delta-val]', polices: ['Large', 'Etroite'], taille: '32px', suivante: 'Variable',
    lire: ([tag, police]: string[]) => {
      const el: any = (document.querySelector(tag) as any)._shadow.querySelector('.d')
      const r = document.createRange()
      r.selectNodeContents(el.querySelector('[mjs-fx-delta-val]'))
      const largeur = r.getBoundingClientRect().width
      const reserve = parseFloat(el.style.minWidth) * parseFloat(getComputedStyle(el).fontSize)
      return { charge: document.fonts.check('32px ' + police), marque: el.style.minWidth, fini: true, largeur, reserve, minWidth: el.style.minWidth }
    },
    juste: nombreJuste,
    espion: ESPION_NOMBRE
  },
  {
    nom: '*count', tag: 'mjs-pf-compte', cible: '.c', pose: '.c [mjs-fx-layer="text"]', polices: ['Large', 'Etroite'], taille: '32px', suivante: 'Variable',
    lire: ([tag, police]: string[]) => {
      const el: any = (document.querySelector(tag) as any)._shadow.querySelector('.c')
      const calque  = el.querySelector('[mjs-fx-layer="text"]')
      const r = document.createRange()
      r.selectNodeContents(calque)
      const largeur = r.getBoundingClientRect().width
      const reserve = parseFloat(el.style.minWidth) * parseFloat(getComputedStyle(el).fontSize)
      // le compte est arrivé au bout : le nombre le plus large est écrit
      return { charge: document.fonts.check('32px ' + police), marque: el.style.minWidth, fini: calque.textContent.replace(/\s/g, '') === '12480', largeur, reserve, minWidth: el.style.minWidth }
    },
    juste: nombreJuste,
    espion: ESPION_NOMBRE
  }
]

// le registre des écouteurs posés sur `document.fonts`, tenu depuis le début de la page
const ESPIONNE_POLICES = () => {
  const f: any = document.fonts
  const reg    = new Map<string, Set<any>>()
  const ajoute = f.addEventListener.bind(f)
  const retire = f.removeEventListener.bind(f)
  f.addEventListener = function(type: string, fn: any, o: any) {
    if (!reg.has(type)) reg.set(type, new Set())
    reg.get(type)!.add(fn)
    return ajoute(type, fn, o)
  }
  f.removeEventListener = function(type: string, fn: any, o: any) {
    if (reg.has(type)) reg.get(type)!.delete(fn)
    return retire(type, fn, o)
  }
  ;(window as any).__ecouteurs = () => {
    const out: Record<string, number> = {}
    reg.forEach((s, t) => { if (s.size) out[t] = s.size })
    return out
  }
}

// le compte des mesures de mise en page et des minuteries, remis à zéro à chaque appel
const ESPIONNE_MESURES = () => {
  const w: any = window
  w.__mesures = { rect: 0, rects: 0, range: 0, intervalle: 0, image: 0 }
  if (w.__espions) return
  w.__espions = true
  const enveloppe = (proto: any, nom: string, cle: string) => {
    const o = proto[nom]
    proto[nom] = function(...a: any[]) {
      w.__mesures[cle]++
      return o.apply(this, a)
    }
  }
  enveloppe(Element.prototype, 'getBoundingClientRect', 'rect')
  enveloppe(Element.prototype, 'getClientRects', 'rects')
  enveloppe(Range.prototype, 'getBoundingClientRect', 'range')
  enveloppe(window, 'setInterval', 'intervalle')
  enveloppe(window, 'requestAnimationFrame', 'image')
}
const AUCUNE_MESURE = { rect: 0, rects: 0, range: 0, intervalle: 0, image: 0 }

// le journal de ce que fait `document.fonts` et de ce que font les effets : `loading` (un chargement commence), `ready`
// (la promesse armée à ce moment se résout : WebKit n'émet jamais `loadingdone`) ; chaque effet y inscrit aussi ses
// reprises de mesure (`espion`) : `recalage` quand la police est prête, `precoce` quand `status` dit qu'elle charge
// encore. C'est l'état de la police AU MOMENT de la reprise qui la classe : l'ordre des écouteurs ne compte pas
const ESPIONNE_JOURNAL = () => {
  const w: any = window
  const f: any = document.fonts
  w.__journal  = []
  w.__note     = () => w.__journal.push(f.status === 'loading' ? 'precoce' : 'recalage')
  f.addEventListener('loading', () => {
    w.__journal.push('loading')
    f.ready.then(() => w.__journal.push('ready'))
  })
}

// ce que le journal dit de l'arrivée d'une police : tout ce qui suit le premier `loading`
function arrivee(j: string[]) {
  const debut = j.indexOf('loading')
  return { debut, apres: j.slice(debut + 1) }
}
const reprises = (l: string[]) => l.filter((t) => t === 'recalage').length
const precoces = (l: string[]) => l.filter((t) => t === 'precoce').length

const dort = (ms: number) => new Promise((r) => setTimeout(r, ms))

// relit `lire` jusqu'à ce que `ok` soit vrai (au plus `ms`) ; rend la dernière lecture dans tous les cas
async function jusque(lire: () => Promise<any>, ok: (v: any) => boolean, ms = 4000) {
  const fin = Date.now() + ms
  let v     = await lire()
  while (!ok(v) && Date.now() < fin) {
    await dort(60)
    v = await lire()
  }
  return v
}

let bundle: Promise<string> | null = null
// le bundle des quatre composants, construit une seule fois pour les trois moteurs
function construit(): Promise<string> {
  bundle ||= (async () => {
    const root   = mjsTmp('effets-police-tardive')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return bundle
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`une police qui arrive tard (${nom} réel) — *spoiler, *weight, *delta, *count`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const manque = Object.values(POLICES).filter((f) => !existsSync(f))
      if (manque.length) {
        present = false
        console.log(`  ℹ️  police absente du système (${manque.join(', ')}), test sauté`)
        return
      }
      script = await construit()
    })

    after(async () => { await terminateSharedWorkerPool() })

    // une page neuve : les polices servies (en retard de `retard.ms`), le registre des écouteurs de `document.fonts`
    async function ouvre(browser: any, tag: string) {
      const retard = { ms: 400 }
      const page   = await browser.newPage({ viewport: { width: 640, height: 400 } })
      await page.addInitScript(ESPIONNE_POLICES)
      await page.route('http://t.test/**', async (route: any) => {
        const url     = route.request().url()
        const fichier = url.replace('http://t.test/', '')
        if (POLICES[fichier]) {
          await dort(retard.ms)
          try {
            await route.fulfill({ contentType: 'font/ttf', body: readFileSync(POLICES[fichier]) })
          } catch {
            // page fermée entre-temps
          }
          return
        }
        if (url !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:Variable;src:url(/variable.ttf);font-weight:100 900}@font-face{font-family:Large;src:url(/large.ttf)}@font-face{font-family:Etroite;src:url(/etroite.ttf)}html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.t'), tag)
      return { page, retard }
    }

    // le bouton `.t` : pose l'effet, ou le retire
    const bascule = (page: any, tag: string) => page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.t').click(), tag)
    const attendPose = (page: any, e: Effet) => page.waitForFunction(([t, s]: string[]) => !!(document.querySelector(t) as any)._shadow.querySelector(s), [e.tag, e.pose])

    async function essai(e: Effet, fn: (page: any, retard: { ms: number }) => Promise<void>) {
      const playwright = await import('playwright')
      const browser    = await playwright[nom].launch()
      try {
        const { page, retard } = await ouvre(browser, e.tag)
        await fn(page, retard)
      } finally {
        await browser.close()
      }
    }

    for (const e of EFFETS) {
      const lit = (page: any, police: string) => page.evaluate(e.lire as any, [e.tag, police])

      it(`${e.nom} : une police arrivée après la pose (celle de la balise, puis un font-family changé) recale l'effet`, async function () {
        if (!present) { this.skip(); return }
        await essai(e, async (page) => {
          const [p1, p2] = e.polices
          // la balise demande sa police dès la pose : elle arrive 400 ms plus tard
          await page.evaluate((p: string) => document.documentElement.style.setProperty('--pf-police', p), p1)
          await bascule(page, e.tag)
          await attendPose(page, e)
          const avant = await lit(page, p1)
          const v1    = await jusque(() => lit(page, p1), (v) => v.charge && e.juste(v, 0))
          assert.ok(v1.charge, `la police ${p1} est arrivée : ${JSON.stringify(v1)}`)
          assert.ok(e.juste(v1, 0), `l'effet est calé sur ${p1} : ${JSON.stringify(v1)}`)
          // la police était bien en route à la pose : la lecture d'alors n'est pas celle d'après
          if (!avant.charge) assert.notDeepEqual(v1.marque, avant.marque, `${p1} change ce que l'effet mesure : ${JSON.stringify(avant)}`)
          // un font-family changé vers une police qui se charge
          await page.evaluate(([s, t, p]: string[]) => { ((document.querySelector(t) as any)._shadow.querySelector(s) as any).style.fontFamily = p }, [e.cible, e.tag, p2])
          const v2 = await jusque(() => lit(page, p2), (v) => v.charge && e.juste(v, 1))
          assert.ok(v2.charge, `la police ${p2} est arrivée : ${JSON.stringify(v2)}`)
          assert.ok(e.juste(v2, 1), `l'effet est calé sur ${p2} : ${JSON.stringify(v2)} (avant : ${JSON.stringify(v1)})`)
          assert.notDeepEqual(v2.marque, v1.marque, `${p2} change ce que l'effet mesure`)
        })
      })

      it(`${e.nom} : au repos, une fois la police arrivée, aucune mesure ni minuterie`, async function () {
        if (!present) { this.skip(); return }
        await essai(e, async (page) => {
          const p1 = e.polices[0]
          await page.evaluate((p: string) => document.documentElement.style.setProperty('--pf-police', p), p1)
          await bascule(page, e.tag)
          await attendPose(page, e)
          await jusque(() => lit(page, p1), (v) => v.charge && e.juste(v, 0))
          await dort(900)
          await page.evaluate(ESPIONNE_MESURES)
          await dort(900)
          assert.deepEqual(await page.evaluate(() => (window as any).__mesures), AUCUNE_MESURE, 'rien ne se mesure ni ne tourne au repos')
        })
      })

      it(`${e.nom} : retiré, aucun écouteur de document.fonts ne reste, et une police qui arrive ensuite ne réveille rien`, async function () {
        if (!present) { this.skip(); return }
        await essai(e, async (page, retard) => {
          const ecouteurs = () => page.evaluate(() => (window as any).__ecouteurs())
          const avant     = await ecouteurs()
          await bascule(page, e.tag)
          await attendPose(page, e)
          const pose = await ecouteurs()
          assert.notDeepEqual(pose, avant, `l'effet écoute document.fonts : ${JSON.stringify(pose)}`)
          // une police en route (demandée à la main, en retard de 2,5 s) quand l'effet est retiré
          retard.ms = 2500
          await page.evaluate(([t, s, f]: string[]) => {
            const w: any = window
            w.__tenu     = (document.querySelector(t) as any)._shadow.querySelector(s)
            w.__en_route = document.fonts.load(f + ' Etroite')
          }, [e.tag, e.cible, e.taille])
          await dort(100)
          await bascule(page, e.tag)
          await page.waitForFunction(([t, s]: string[]) => !(document.querySelector(t) as any)._shadow.querySelector(s), [e.tag, e.cible])
          assert.deepEqual(await ecouteurs(), avant, 'après le retrait, aucun écouteur de document.fonts ne reste')
          await page.evaluate(ESPIONNE_MESURES)
          // la police arrive, l'effet n'est plus là : aucune mesure, aucune marque reposée sur la balise retirée
          await page.evaluate(async () => { await (window as any).__en_route; await document.fonts.ready })
          await dort(600)
          assert.deepEqual(await page.evaluate(() => (window as any).__mesures), AUCUNE_MESURE, 'la police arrivée après le retrait ne déclenche aucune mesure')
          const reste = await page.evaluate(() => {
            const el: any = (window as any).__tenu
            return { marques: Array.from(el.attributes).map((a: any) => a.name).filter((n: string) => n.startsWith('mjs-fx')), minWidth: el.style.minWidth }
          })
          assert.deepEqual(reste, { marques: [], minWidth: '' }, 'la balise retirée n\'a rien repris')
        })
      })

      // la page prête à compter : le journal d'abord (ses écouteurs passent avant ceux de l'effet), puis ce que l'effet demande avant sa pose
      const prepare = async (page: any) => {
        await page.evaluate(ESPIONNE_JOURNAL)
        if (e.prepare) await page.evaluate(e.prepare)
      }
      // la police est arrivée (le journal l'a vu) et les signaux tardifs ont eu le temps de passer (Firefox envoie
      // `loadingdone` dans une tâche à part) : le journal
      const arrive = async (page: any) => {
        await page.waitForFunction(() => (window as any).__journal.includes('ready'), null, { timeout: 20000 })
        await dort(600)
        return await page.evaluate(() => (window as any).__journal) as string[]
      }
      const demande = (page: any, police: string) => page.evaluate((p: string) => document.documentElement.style.setProperty('--pf-police', p), police)

      it(`${e.nom} : une police qui arrive ne fait reprendre la mesure qu'une fois, une fois la police prête`, async function () {
        if (!present) { this.skip(); return }
        await essai(e, async (page, retard) => {
          const p1 = e.polices[0]
          retard.ms = 800
          // l'effet est posé et calme (rien n'est en route, la pose a fini de mesurer) : la police est demandée ensuite
          await prepare(page)
          await bascule(page, e.tag)
          await attendPose(page, e)
          await dort(500)
          await page.evaluate(e.espion)
          await demande(page, p1)
          const j = await arrive(page)
          const a = arrivee(j)
          assert.ok(a.debut >= 0 && j.includes('ready'), `une police a commencé puis fini d'arriver (journal : ${j.join(' ')})`)
          assert.equal(precoces(a.apres), 0, `aucune reprise de la mesure tant que la police charge (journal : ${j.join(' ')})`)
          assert.equal(reprises(a.apres), 1, `une seule reprise de la mesure à l'arrivée de la police (journal : ${j.join(' ')})`)
          const v = await jusque(() => lit(page, p1), (v) => v.charge && e.juste(v, 0))
          assert.ok(e.juste(v, 0), `l'effet est calé sur ${p1} : ${JSON.stringify(v)}`)
        })
      })

      it(`${e.nom} : une police que la pose elle-même demande ne fait reprendre la mesure qu'une fois, une fois la police prête`, async function () {
        if (!present) { this.skip(); return }
        await essai(e, async (page, retard) => {
          const p1 = e.polices[0]
          retard.ms = 1500
          // le cas courant : la balise demande sa police en se posant ; son `loading` arrive après la pose, `status` est déjà `loading`
          await prepare(page)
          await page.evaluate(e.espion)
          await demande(page, p1)
          await bascule(page, e.tag)
          await attendPose(page, e)
          const j = await arrive(page)
          const a = arrivee(j)
          assert.ok(a.debut >= 0 && j.includes('ready'), `une police a commencé puis fini d'arriver (journal : ${j.join(' ')})`)
          assert.equal(precoces(a.apres), 0, `aucune reprise de la mesure tant que la police charge (journal : ${j.join(' ')})`)
          assert.equal(reprises(a.apres), 1, `une seule reprise de la mesure à l'arrivée de la police (journal : ${j.join(' ')})`)
          const v = await jusque(() => lit(page, p1), (v) => v.charge && e.juste(v, 0))
          assert.ok(e.juste(v, 0), `l'effet est calé sur ${p1} : ${JSON.stringify(v)}`)
        })
      })

      it(`${e.nom} : posé alors que sa police est déjà en route, l'effet reprend sa mesure une fois, à l'arrivée`, async function () {
        if (!present) { this.skip(); return }
        await essai(e, async (page, retard) => {
          const p1 = e.polices[0]
          retard.ms = 2500
          // la police part avant la pose, et son `loading` aussi : l'effet posé ensuite ne l'entend pas
          await prepare(page)
          await page.evaluate(([p, t]: string[]) => { document.documentElement.style.setProperty('--pf-police', p); document.fonts.load(t + ' ' + p) }, [p1, e.taille])
          await page.waitForFunction(() => (window as any).__journal.includes('loading'), null, { timeout: 20000 })
          await page.evaluate(e.espion)
          await bascule(page, e.tag)
          await attendPose(page, e)
          const avant = await lit(page, p1)
          assert.ok(!avant.charge, `la police ${p1} est encore en route à la pose : ${JSON.stringify(avant)}`)
          const j = await arrive(page)
          const a = arrivee(j)
          // la mesure de la pose se fait police en route (`precoce`, faute de mieux) : une seule reprise police prête
          assert.ok(a.debut >= 0 && j.includes('ready'), `la police est arrivée (journal : ${j.join(' ')})`)
          assert.equal(reprises(a.apres), 1, `une seule reprise de la mesure à l'arrivée de la police (journal : ${j.join(' ')})`)
          const v = await jusque(() => lit(page, p1), (v) => v.charge && e.juste(v, 0))
          assert.ok(e.juste(v, 0), `l'effet est calé sur ${p1} : ${JSON.stringify(v)} (avant : ${JSON.stringify(avant)})`)
          assert.notDeepEqual(v.marque, avant.marque, `${p1} change ce que l'effet mesure : ${JSON.stringify(avant)}`)
        })
      })
    }
  })
}
