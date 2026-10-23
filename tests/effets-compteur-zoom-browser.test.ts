// *count et *delta sous un ancêtre à `zoom` CSS, dans Chromium et Firefox réels. La place d'un nombre se mesure dans le repère de la
// fenêtre (la boîte d'un Range, zoom appliqué) et s'écrit en `em`, dans le repère de la mise en page (la taille du texte, que le zoom
// ne touche pas) : sans correction, l'`em` écrit est faux du facteur de zoom. Sous `zoom: 0.6` la balise est trop étroite et le nombre
// déborde sur le texte qui suit ; sous `zoom: 1.5` elle est trop large. Un nombre qui gagne des chiffres (9 → 12 480) et un nombre qui
// en perd (12 480 → 9) tiennent dans leur balise à CHAQUE image du compte, et à la fin la balise n'est pas plus large que le nombre
// (au pixel de mise en page près, soit `zoom` pixels de la fenêtre). La page relève, à la fin de chaque image, la boîte de la balise
// et celle du texte du nombre : tout est lu dans le repère de la fenêtre, où ces deux boîtes se comparent.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Moteur = 'chromium' | 'firefox'

async function navigateurPresent(nom: Moteur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// l'espace fine insécable que le séparateur par défaut écrit entre les milliers
const FINE  = ' '
const GRAND = `12${FINE}480`

// un composant : un compteur et un *delta sous un ancêtre à `zoom: 0.6`, les mêmes sous un ancêtre à `zoom: 1.5`, les mêmes encore sous un
// ancêtre sans zoom (le témoin : il doit rester comme il est), chacun suivi d'un élément de classe `suite` (le texte qui ne doit jamais
// être recouvert) ; sous chaque zoom, deux compteurs de plus à marges internes (7 px de chaque côté), l'un dont la largeur ne les compte
// pas (`p`), l'autre dont la largeur les compte (`b`, box-sizing: border-box) ; deux boutons qui commandent le nombre
const SOURCE = `<script>
$n = 9
</script>

<div class="z06">
  <p class="l">avant <span class="c06" *count(duration: 1200ms, on: load)>{$n}</span><span class="suite"> après</span></p>
  <p class="l">avant <span class="d06" *delta(duration: 1200ms)>{$n}</span><span class="suite"> après</span></p>
  <p class="l">avant <span class="p06" data-z="0.6" data-pad="7" *count(duration: 1200ms, on: load)>{$n}</span><span class="suite"> après</span></p>
  <p class="l">avant <span class="b06" data-z="0.6" data-pad="7" *count(duration: 1200ms, on: load)>{$n}</span><span class="suite"> après</span></p>
</div>
<div class="z15">
  <p class="l">avant <span class="c15" *count(duration: 1200ms, on: load)>{$n}</span><span class="suite"> après</span></p>
  <p class="l">avant <span class="d15" *delta(duration: 1200ms)>{$n}</span><span class="suite"> après</span></p>
  <p class="l">avant <span class="p15" data-z="1.5" data-pad="7" *count(duration: 1200ms, on: load)>{$n}</span><span class="suite"> après</span></p>
  <p class="l">avant <span class="b15" data-z="1.5" data-pad="7" *count(duration: 1200ms, on: load)>{$n}</span><span class="suite"> après</span></p>
</div>
<div class="z1">
  <p class="l">avant <span class="c1" *count(duration: 1200ms, on: load)>{$n}</span><span class="suite"> après</span></p>
  <p class="l">avant <span class="d1" *delta(duration: 1200ms)>{$n}</span><span class="suite"> après</span></p>
</div>
<button class="grand" @click={$n = 12480}>12480</button>
<button class="petit" @click={$n = 9}>9</button>

<style>
.z06
  zoom: 0.6
.z15
  zoom: 1.5
.l
  font: 32px sans-serif
  margin: 8px 20px
.p06, .p15, .b06, .b15
  padding: 0 7px
.b06, .b15
  box-sizing: border-box
button
  font: 12px sans-serif
</style>
`

const ZOOM: Record<string, number> = { c06: 0.6, d06: 0.6, c15: 1.5, d15: 1.5, c1: 1, d1: 1, p06: 0.6, b06: 0.6, p15: 1.5, b15: 1.5 }
// les marges internes (en pixels de mise en page, de chaque côté) des compteurs qui en ont
const MARGE: Record<string, number> = { p06: 7, b06: 7, p15: 7, b15: 7 }

// la page : relève, à la fin de chaque image, pour chaque balise `*count` ou `*delta` qui a une boîte, sa largeur, le bord droit de sa boîte,
// le texte du nombre et le bord droit de ce texte (`__traces`, par classe de la balise) ; le bord droit de la boîte est celui de la zone du texte
// (marge interne droite ôtée : `data-pad` pixels de mise en page, `data-z` le zoom) ; un nombre de *delta est dans `[mjs-fx-delta-val]`
// (sa flèche, hors du flux, n'en fait pas partie), celui de *count dans le calque
const ECHANTILLONNEUR = () => {
  const w: any = window
  w.__traces   = {}
  const releve = () => {
    const sh: any = (document.querySelector('mjs-cl-zoom') as any)?._shadow
    if (!sh) return
    for (const el of Array.from(sh.querySelectorAll('[mjs-fx~="count"],[mjs-fx~="delta"]')) as any[]) {
      const b = el.getBoundingClientRect()
      if (b.width <= 0) continue
      const nombre = el.querySelector('[mjs-fx-delta-val]') || el.querySelector('[mjs-fx-layer="text"]')
      if (!nombre || nombre.textContent === '') continue
      const r = document.createRange()
      r.selectNodeContents(nombre)
      ;(w.__traces[el.className] ||= []).push({ texte: nombre.textContent, largeur: b.width, droite: r.getBoundingClientRect().right, boite: b.right - parseFloat(el.dataset.pad || '0') * parseFloat(el.dataset.z || '1') })
    }
  }
  const image = () => requestAnimationFrame(() => { setTimeout(releve, 0); image() })
  image()
}

// la mesure d'une balise : le texte de son nombre, sa largeur, celle du texte
const MESURE = (a: { classe: string }) => {
  const sh: any = (document.querySelector('mjs-cl-zoom') as any)._shadow
  const el      = sh.querySelector('.' + a.classe)
  const nombre  = el.querySelector('[mjs-fx-delta-val]') || el.querySelector('[mjs-fx-layer="text"]')
  const r       = document.createRange()
  r.selectNodeContents(nombre)
  return { texte: nombre.textContent, largeur: el.getBoundingClientRect().width, largeurTexte: r.getBoundingClientRect().width }
}

const dort = (ms: number) => new Promise((r) => setTimeout(r, ms))

// relit `lire` jusqu'à ce que `ok` soit vrai (au plus `ms`) ; rend la dernière lecture dans tous les cas
async function jusque(lire: () => Promise<any>, ok: (v: any) => boolean, ms = 12000) {
  const fin = Date.now() + ms
  let v     = await lire()
  while (!ok(v) && Date.now() < fin) {
    await dort(40)
    v = await lire()
  }
  return v
}

const bundles: Record<string, Promise<string>> = {}
// le bundle du composant, construit une seule fois par réglage (développement, ou production d'une application) pour les deux moteurs
function construit(prod = false): Promise<string> {
  const cle = prod ? 'prod' : 'dev'
  bundles[cle] ||= (async () => {
    const root   = mjsTmp('effets-compteur-zoom-' + cle)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'cl-zoom.mjs'), SOURCE)
    const manifeste = join(root, 'bundle.js')
    const bundler   = new Bundler(prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any : { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste })
    const stats     = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    // la production : un seul fichier, le manifeste
    if (prod) return stripEsm(readFileSync(manifeste, 'utf-8'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return bundles[cle]
}

type Trace = { texte: string, largeur: number, droite: number, boite: number }

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*count et *delta sous un zoom CSS : la balise garde la place du nombre (${nom} réel)`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let produit = ''
    let browser: any = null

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      script  = await construit()
      produit = await construit(true)
      browser = await (await import('playwright'))[nom].launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    // une page neuve : le composant monté, les erreurs de la page gardées
    async function essai(fn: (page: any) => Promise<void>, options: { prod?: boolean } = {}) {
      const page = await browser.newPage({ viewport: { width: 800, height: 900 }, reducedMotion: 'no-preference' })
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
      page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push('console.error : ' + m.text()) })
      await page.addInitScript(ECHANTILLONNEUR)
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-cl-zoom></mjs-cl-zoom><script>${options.prod ? produit : script}</script></body></html>` })
      })
      try {
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => ((document.querySelector('mjs-cl-zoom') as any)?._shadow?.querySelectorAll('[mjs-fx-layer="text"]').length || 0) >= 10)
        await fn(page)
        assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      } finally {
        await page.close()
      }
    }

    const mesure = (page: any, classe: string) => page.evaluate(MESURE, { classe })
    const traces = (page: any, classe: string) => page.evaluate((c: string) => (window as any).__traces[c] || [], classe) as Promise<Trace[]>
    // les relevés repartent à zéro dans la même lecture que le clic : aucune image d'avant ne se mêle à celles d'après
    const clique = (page: any, bouton: string) => page.evaluate((b: string) => {
      ;(window as any).__traces = {}
      ;((document.querySelector('mjs-cl-zoom') as any)._shadow.querySelector('.' + b) as any).click()
    }, bouton)
    // le texte du nombre de chaque balise de `classes` est `texte`
    const tousFinis = (page: any, classes: string[], texte: string) => jusque(
      () => Promise.all(classes.map((c) => mesure(page, c))),
      (vus: any[]) => vus.every((v) => v.texte === texte)
    ) as Promise<any[]>

    // les défauts du nombre affiché : il tient dans sa balise à CHAQUE image relevée
    function debords(classe: string, t: Trace[]): string[] {
      if (t.length < 8) return [`${classe} : trop peu d'images relevées (${t.length})`]
      const debord = Math.max(...t.map((x) => x.droite - x.boite))
      const pire   = t.find((x) => x.droite - x.boite === debord) as Trace
      return debord <= 0.5 ? [] : [`${classe} : le nombre affiché déborde de sa balise de ${debord.toFixed(1)} px (« ${pire.texte} », balise ${pire.largeur.toFixed(1)} px, sur ${t.length} images)`]
    }
    // les défauts de la largeur finale : le nombre tient dans la balise, qui n'est pas plus large que lui d'un pixel de mise en page (`zoom` pixels de la fenêtre) et d'un peu d'arrondi
    function largeurs(classe: string, v: any): string[] {
      const out: string[] = []
      // la zone du texte : la balise moins ses marges internes (dans le repère de la fenêtre)
      const zone = v.largeur - 2 * (MARGE[classe] || 0) * ZOOM[classe]
      if (zone < v.largeurTexte - 0.5) out.push(`${classe} : la balise (${zone.toFixed(1)} px de zone) est plus étroite que « ${v.texte} » (${v.largeurTexte.toFixed(1)} px)`)
      if (zone > v.largeurTexte + ZOOM[classe] + 0.6) out.push(`${classe} : la balise (${zone.toFixed(1)} px de zone) réserve plus que « ${v.texte} » (${v.largeurTexte.toFixed(1)} px)`)
      return out
    }
    // tous les défauts des balises de `classes` : à chaque image, et (`fin`) à la fin — la largeur finale est attendue un instant : le texte final
    // s'écrit avant que la balise prenne sa dernière largeur
    const defauts = async (page: any, classes: string[], fin: boolean) => {
      const out: string[] = []
      for (const c of classes) out.push(...debords(c, await traces(page, c)))
      if (fin) {
        const finales = await jusque(async () => {
          const l: string[] = []
          for (const c of classes) l.push(...largeurs(c, await mesure(page, c)))
          return l
        }, (l: string[]) => l.length === 0, 4000)
        out.push(...finales)
      }
      return out
    }

    // le compte de départ (9) fini dans chaque balise de `classes`
    const departFini = async (page: any, classes: string[]) => {
      const vus = await tousFinis(page, classes, '9')
      for (const v of vus) assert.equal(v.texte, '9', 'le départ est affiché')
    }

    it('*count, 9 → 12 480 sous zoom: 0.6 et zoom: 1.5 : le nombre tient dans la balise à chaque image, la balise n\'est pas trop large à la fin', async function () {
      if (!present) return this.skip()
      await essai(async (page) => {
        await departFini(page, ['c06', 'c15', 'c1', 'p06', 'b06', 'p15', 'b15'])
        await clique(page, 'grand')
        await tousFinis(page, ['c06', 'c15', 'c1', 'p06', 'b06', 'p15', 'b15'], GRAND)
        assert.deepEqual(await defauts(page, ['c06', 'c15', 'c1', 'p06', 'b06', 'p15', 'b15'], true), [])
      })
    })

    it('*count, 12 480 → 9 sous zoom: 0.6 et zoom: 1.5 : le nombre tient dans la balise à chaque image, la balise prend la largeur du neuf à la fin', async function () {
      if (!present) return this.skip()
      await essai(async (page) => {
        await departFini(page, ['c06', 'c15', 'c1', 'p06', 'b06', 'p15', 'b15'])
        await clique(page, 'grand')
        await tousFinis(page, ['c06', 'c15', 'c1', 'p06', 'b06', 'p15', 'b15'], GRAND)
        await clique(page, 'petit')
        await tousFinis(page, ['c06', 'c15', 'c1', 'p06', 'b06', 'p15', 'b15'], '9')
        assert.deepEqual(await defauts(page, ['c06', 'c15', 'c1', 'p06', 'b06', 'p15', 'b15'], true), [])
      })
    })

    it('*delta, 9 → 12 480 sous zoom: 0.6 et zoom: 1.5 : le nombre tient dans la balise à chaque image, la balise n\'est pas trop large à la fin', async function () {
      if (!present) return this.skip()
      await essai(async (page) => {
        await clique(page, 'grand')
        await tousFinis(page, ['d06', 'd15', 'd1'], GRAND)
        assert.deepEqual(await defauts(page, ['d06', 'd15', 'd1'], true), [])
      })
    })

    it('*delta, 12 480 → 9 sous zoom: 0.6 et zoom: 1.5 : le nombre tient dans la balise à chaque image', async function () {
      if (!present) return this.skip()
      await essai(async (page) => {
        await clique(page, 'grand')
        await tousFinis(page, ['d06', 'd15', 'd1'], GRAND)
        await clique(page, 'petit')
        await tousFinis(page, ['d06', 'd15', 'd1'], '9')
        assert.deepEqual(await defauts(page, ['d06', 'd15', 'd1'], false), [])
      })
    })

    it('en production : *count et *delta, 9 → 12 480 sous zoom: 0.6 et zoom: 1.5', async function () {
      if (!present) return this.skip()
      await essai(async (page) => {
        await departFini(page, ['c06', 'c15', 'c1', 'p06', 'b06', 'p15', 'b15'])
        await clique(page, 'grand')
        await tousFinis(page, ['c06', 'c15', 'c1', 'p06', 'b06', 'p15', 'b15', 'd06', 'd15', 'd1'], GRAND)
        assert.deepEqual(await defauts(page, ['c06', 'c15', 'c1', 'p06', 'b06', 'p15', 'b15', 'd06', 'd15', 'd1'], true), [])
      }, { prod: true })
    })
  })
}
