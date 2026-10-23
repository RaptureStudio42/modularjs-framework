// *count(style: flip) dans Chromium, Firefox et WebKit réels : chaque chiffre du nombre est une carte qui bascule quand il change. Seuls les chiffres
// qui changent basculent (129 → 130 : les deux derniers) ; l'état final est juste ; un nombre qui gagne ou perd des chiffres (9 → 10, 100 → 99) garde
// la place du plus large des deux jusqu'à la fin du décompte, puis prend celle du nombre final, sans que les cartes débordent de la balise. Le texte
// écrit reste là, lisible, et les cartes sont décoratives (calque caché aux lecteurs d'écran, aucun chiffre en texte). Avec « réduire les animations »
// le chiffre change sans bascule. `pad` écrit les zéros de tête, `background` et `color` peignent les cartes, un `*count` sans `style` reste du texte.
// Une balise retirée en plein basculement ne laisse ni marque ni style en ligne. Le tout se rejoue sur la production, en fichier unique (`bundle`) et en
// fichiers découpés (`split`).
// WebKit est sauté quand il est absent : `PLAYWRIGHT_BROWSERS_PATH=<dossier qui l'a>` ou `npx playwright install webkit`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
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

// un composant : le compteur de référence (a), un compteur à zéros de tête (p), un témoin sans volets (t), des cartes de couleurs écrites (c), des cartes
// peintes par les variables de thème d'un parent (m), un compteur dont le décompte dure (d), un compteur qu'un bouton retire (r) ; le nombre $n commande tous ceux qui ne sont pas p, l'heure $h commande p
const SOURCE = `<script>
$n = 129
$h = 7
$vu = true
$neg = -3.5
</script>

<p class="l">Total <span class="a" *count(style: flip, duration: 0, speed: 120ms, on: load)>{$n}</span><span class="suite"> après</span></p>
<p class="l">Heures <span class="p" *count(style: flip, duration: 0, speed: 120ms, on: load, pad: 2)>{$h}</span></p>
<p class="l">Texte <span class="t" *count(duration: 0, on: load)>{$n}</span></p>
<p class="l">Couleurs <span class="c" *count(style: flip, duration: 0, speed: 120ms, on: load, background: #123456, color: #abcdef)>{$n}</span></p>
<p class="l">Zéros <span class="z1" *count(pad: 4, separator: '.', prefix: '~ ', suffix: ' €', duration: 0, on: load)>{$n}</span> <span class="z2" *count(pad: 3, duration: 0, on: load)>{$neg}</span> <span class="z3" *count(pad: 3, duration: 0, on: load)>{$h}</span> <span class="z4" *count(pad: 3, duration: 0, on: load)>12480</span></p>
<p class="l theme">Thème <span class="m" *count(style: flip, duration: 0, speed: 120ms, on: load)>{$n}</span></p>
<p class="l">Décompte <span class="d" *count(style: flip, duration: 700ms, speed: 120ms, on: load)>{$n}</span><span class="suite"> après</span></p>
{if $vu}<p class="l">Retrait <span class="r" *count(style: flip, duration: 0, speed: 120ms, on: load)>{$n}</span></p>{end}
<button class="n130" @click={$n = 130}>130</button>
<button class="n129" @click={$n = 129}>129</button>
<button class="n131" @click={$n = 131}>131</button>
<button class="n9" @click={$n = 9}>9</button>
<button class="n10" @click={$n = 10}>10</button>
<button class="n100" @click={$n = 100}>100</button>
<button class="n99" @click={$n = 99}>99</button>
<button class="h8" @click={$h = 8}>8</button>
<button class="cache" @click={$vu = false}>retirer</button>

<style>
.l
  font: 40px sans-serif
  margin: 8px 20px
.theme
  --mjs-count-background: #0a0b0c
  --mjs-count-color: #ff8800
button
  font: 12px sans-serif
</style>
`

const dort = (ms: number) => new Promise((r) => setTimeout(r, ms))

// la page : pose une sonde sur chaque racine d'ombre (les cartes qui commencent à basculer : la classe de la balise, le rang de la carte) et relève, à chaque
// image, pour chaque balise à volets, les chiffres des cartes, la largeur de la balise, le bord droit de la dernière carte et celui de la boîte de la balise
const SONDE = () => {
  const w: any = window
  w.__bascules = {}
  w.__images   = {}
  const garde = (racine: any) => new MutationObserver((liste: any[]) => {
    for (const m of liste) {
      const t: any = m.target
      if (!t.hasAttribute('mjs-fx-count-flip')) continue
      const hote: any = t.closest('[mjs-fx~="count"]')
      const rang      = Array.from(t.parentNode.querySelectorAll('[mjs-fx-count-card]')).indexOf(t)
      ;(w.__bascules[hote.className] ||= []).push(rang)
    }
  }).observe(racine, { attributes: true, attributeFilter: ['mjs-fx-count-flip'], subtree: true })
  const origine = Element.prototype.attachShadow
  Element.prototype.attachShadow = function (this: any, init: any) {
    const racine = origine.call(this, init)
    garde(racine)
    return racine
  }
  const releve = () => {
    const sh: any = (document.querySelector('mjs-cl-volets') as any)?._shadow
    if (!sh) return
    for (const el of Array.from(sh.querySelectorAll('[mjs-fx~="count"]')) as any[]) {
      const cartes = Array.from(el.querySelectorAll('[mjs-fx-count-card]')) as any[]
      const b      = el.getBoundingClientRect()
      if (b.width <= 0 || cartes.length === 0) continue
      const cs = getComputedStyle(el)
      ;(w.__images[el.className] ||= []).push({
        chiffres: cartes.map((c) => c.getAttribute('mjs-fx-count-card')).join(''),
        largeur:  b.width,
        droite:   cartes[cartes.length - 1].getBoundingClientRect().right,
        boite:    b.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight)
      })
    }
  }
  const image = () => requestAnimationFrame(() => { setTimeout(releve, 0); image() })
  image()
}

// l'état d'une balise : les chiffres de ses cartes, combien basculent, le texte du calque, le texte écrit, l'aria-hidden du calque, la largeur
const ETAT = (a: { classe: string }) => {
  const sh: any = (document.querySelector('mjs-cl-volets') as any)._shadow
  const el      = sh.querySelector('.' + a.classe)
  if (!el) return null
  const calque = el.querySelector('[mjs-fx-layer="text"]')
  const cartes = Array.from(el.querySelectorAll('[mjs-fx-count-card]')) as any[]
  const carte  = cartes[0]
  return {
    chiffres:  cartes.map((c) => c.getAttribute('mjs-fx-count-card')).join(''),
    bascule:   el.querySelectorAll('[mjs-fx-count-flip]').length,
    calque:    calque ? calque.textContent : null,
    cache:     calque ? calque.getAttribute('aria-hidden') : null,
    ecrit:     el.firstChild ? el.firstChild.nodeValue : null,
    largeur:   el.getBoundingClientRect().width,
    fond:      carte ? getComputedStyle(carte).backgroundColor : null,
    couleur:   carte ? getComputedStyle(carte).color : null,
    cartes:    cartes.length
  }
}

type Etat = { chiffres: string, bascule: number, calque: string | null, cache: string | null, ecrit: string | null, largeur: number, fond: string | null, couleur: string | null, cartes: number }
type Image = { chiffres: string, largeur: number, droite: number, boite: number }

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

const bundles: Record<string, Promise<any>> = {}
// le composant construit une seule fois par réglage (développement, production en fichier unique, production découpée) pour les trois moteurs
function construit(mode: 'dev' | 'bundle' | 'split'): Promise<any> {
  bundles[mode] ||= (async () => {
    const root   = mjsTmp('effets-compteur-volets-' + mode)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'cl-volets.mjs'), SOURCE)
    const manifeste = join(mode === 'dev' ? root : outDir, 'bundle.js')
    const conf: any = mode === 'dev' ? {} : mode === 'bundle' ? { js: 'bundle', env: 'prod' } : { js: 'split', env: 'prod', urlPrefix: '/out' }
    const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, ...conf })
    const stats     = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    if (mode === 'split') return { dossier: outDir }
    if (mode === 'bundle') return { script: stripEsm(readFileSync(manifeste, 'utf-8')) }
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return { script: [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;' }
  })()
  return bundles[mode]
}

for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Moteur[]) {
  describe(`*count(style: flip) : des cartes qui basculent (${nom} réel)`, function () {
    this.timeout(180000)
    let present = false
    let browser: any = null

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      browser = await (await import('playwright'))[nom].launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    // une page neuve : le composant monté, les erreurs de la page gardées
    async function essai(fn: (page: any) => Promise<void>, options: { mode?: 'dev' | 'bundle' | 'split', calme?: boolean } = {}) {
      const mode   = options.mode ?? 'dev'
      const prete  = await construit(mode)
      const page   = await browser.newPage({ viewport: { width: 900, height: 900 }, reducedMotion: options.calme ? 'reduce' : 'no-preference' })
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
      page.on('console', (m: any) => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource/.test(m.text())) erreurs.push('console.' + m.type() + ' : ' + m.text()) })
      await page.addInitScript(SONDE)
      await page.route('http://t.test/**', (route: any) => {
        const chemin = new URL(route.request().url()).pathname
        if (mode === 'split' && chemin.startsWith('/out/')) {
          const fichier = join(prete.dossier, basename(chemin))
          if (!existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: fichier.endsWith('.json') ? 'application/json' : 'text/javascript', body: readFileSync(fichier) })
        }
        if (chemin !== '/') return route.fulfill({ status: 404, body: '' })
        const script = mode === 'split' ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${prete.script}</script>`
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-cl-volets></mjs-cl-volets>${script}</body></html>` })
      })
      try {
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => ((document.querySelector('mjs-cl-volets') as any)?._shadow?.querySelectorAll('[mjs-fx-count-card]').length || 0) >= 9, null, { timeout: 20000 })
        await dort(250)
        await fn(page)
        assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement dans la page')
      } finally {
        await page.close()
      }
    }

    const etat    = (page: any, classe: string) => page.evaluate(ETAT, { classe }) as Promise<Etat>
    const images  = (page: any, classe: string) => page.evaluate((c: string) => (window as any).__images[c] || [], classe) as Promise<Image[]>
    const rangs   = (page: any, classe: string) => page.evaluate((c: string) => Array.from(new Set((window as any).__bascules[c] || [])).sort(), classe) as Promise<number[]>
    // les relevés repartent à zéro dans la même tâche que le clic : aucune image d'avant ne se mêle à celles d'après
    const clique  = (page: any, bouton: string) => page.evaluate((b: string) => {
      const w: any = window
      w.__bascules = {}
      w.__images   = {}
      ;((document.querySelector('mjs-cl-volets') as any)._shadow.querySelector('.' + b) as any).click()
    }, bouton)
    // la balise montre ces chiffres, plus aucune carte ne bascule
    const arrive  = (page: any, classe: string, chiffres: string) => jusque(() => etat(page, classe), (v: Etat) => v !== null && v.chiffres === chiffres && v.bascule === 0) as Promise<Etat>

    // les cartes tiennent dans la balise à chaque image relevée
    function nedebordeJamais(classe: string, t: Image[]) {
      assert.ok(t.length >= 6, `${classe} : assez d'images relevées (${t.length})`)
      const debord = Math.max(...t.map((x) => x.droite - x.boite))
      assert.ok(debord <= 0.6, `${classe} : les cartes débordent de leur balise de ${debord.toFixed(1)} px`)
    }

    for (const mode of ['dev', 'bundle', 'split'] as const) {
      const lieu = mode === 'dev' ? 'développement' : mode === 'bundle' ? 'production, fichier unique' : 'production, fichiers découpés'

      it(`${lieu} — au repos : une carte par chiffre, le texte écrit reste lisible, le calque est caché, aucune bascule au premier affichage`, async function () {
        if (!present) { this.skip(); return }
        await essai(async (page) => {
          const v = await arrive(page, 'a', '129')
          assert.equal(v.ecrit, '129', 'le texte écrit est intact, lisible par un lecteur d\'écran')
          assert.equal(v.cache, 'true', 'le calque des cartes est caché aux lecteurs d\'écran')
          assert.equal(v.calque, '', 'aucun chiffre écrit en texte dans les cartes (rien à lire en double, rien à copier)')
          assert.equal(v.cartes, 3)
          // `d` compte au chargement (sept cents millisecondes) : ses cartes basculent ; les autres posent leur nombre d'un coup, sans bascule
          const sans = await page.evaluate(() => Object.keys((window as any).__bascules).filter((c) => c !== 'd'))
          assert.deepEqual(sans, [], 'aucune carte ne bascule au premier affichage')
          // un `*count` sans style : du texte, jamais de carte
          const t = await etat(page, 't')
          assert.equal(t.cartes, 0)
          assert.equal(t.calque, '129')
        }, { mode })
      })

      it(`${lieu} — 129 → 130 : seuls les deux chiffres qui changent basculent, l'état final est juste`, async function () {
        if (!present) { this.skip(); return }
        await essai(async (page) => {
          await arrive(page, 'a', '129')
          await clique(page, 'n130')
          const v = await arrive(page, 'a', '130')
          assert.equal(v.ecrit, '130')
          assert.deepEqual(await rangs(page, 'a'), [1, 2], 'la carte du 1 ne bascule jamais, celles du 2 → 3 et du 9 → 0 basculent')
          // ... et sans le ramener à 129 en route : un second changement ne fait basculer que ce qui change
          await clique(page, 'n131')
          await arrive(page, 'a', '131')
          assert.deepEqual(await rangs(page, 'a'), [2], 'seul le dernier chiffre bascule')
          // le témoin sans volets suit le même nombre en texte
          assert.equal((await etat(page, 't')).calque, '131')
        }, { mode })
      })
    }

    it('9 → 10 puis 100 → 99 : le nombre gagne puis perd des chiffres, les cartes ne débordent jamais, la balise prend la place du nombre final', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await clique(page, 'n9')
        const neuf = await arrive(page, 'a', '9')
        assert.equal(neuf.cartes, 1)
        await dort(200)
        const largeurNeuf = (await etat(page, 'a')).largeur
        await clique(page, 'n10')
        const dix = await arrive(page, 'a', '10')
        assert.equal(dix.cartes, 2)
        assert.deepEqual(await rangs(page, 'a'), [0, 1], 'le 9 bascule en 1, la carte du 0 arrive en basculant')
        await dort(200)
        const t = await images(page, 'a')
        nedebordeJamais('a', t)
        // une carte de plus : la balise a grandi de la largeur d'une carte et de son intervalle
        assert.ok((await etat(page, 'a')).largeur > largeurNeuf + 20, `la balise a la place de deux cartes (${largeurNeuf.toFixed(1)} → ${(await etat(page, 'a')).largeur.toFixed(1)} px)`)
        // la place prise d'avance : dès la première image relevée, la balise a la largeur de « 10 »
        const ecart = Math.max(...t.map((x) => Math.abs(x.largeur - (t[t.length - 1].largeur))))
        assert.ok(ecart <= 0.05, `la balise garde une seule largeur pendant le changement (écart ${ecart.toFixed(2)} px)`)
        await clique(page, 'n100')
        await arrive(page, 'a', '100')
        const large = (await etat(page, 'a')).largeur
        await clique(page, 'n99')
        const fin = await arrive(page, 'a', '99')
        assert.equal(fin.cartes, 2)
        await dort(200)
        nedebordeJamais('a', await images(page, 'a'))
        const v = await etat(page, 'a')
        assert.ok(v.largeur < large - 20, `la balise a rendu la place d'une carte (${large.toFixed(1)} → ${v.largeur.toFixed(1)} px)`)
      })
    })

    it('un décompte qui perd des chiffres (129 → 9) : la balise garde la place du plus large jusqu\'à la fin, puis ne rétrécit qu\'une fois', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await arrive(page, 'd', '129')
        const avant = (await etat(page, 'd')).largeur
        await clique(page, 'n9')
        await arrive(page, 'd', '9')
        await dort(300)
        const t = await images(page, 'd')
        nedebordeJamais('d', t)
        const fin    = (await etat(page, 'd')).largeur
        assert.ok(fin < avant - 40, `la balise a rendu la place de deux cartes (${avant.toFixed(1)} → ${fin.toFixed(1)} px)`)
        // pendant le décompte : tant que la rangée a plus d'une carte (une carte qui finit sa bascule vers le « 9 » n'est plus le décompte)
        const pendant = t.filter((x) => x.chiffres.length > 1)
        assert.ok(pendant.length >= 4, `assez d'images pendant le décompte (${pendant.length})`)
        const ecart = Math.max(...pendant.map((x) => Math.abs(x.largeur - avant)))
        assert.ok(ecart <= 0.05, `la balise garde la largeur de l'ancien nombre pendant le décompte (écart ${ecart.toFixed(2)} px ; chiffres vus : ${[...new Set(pendant.map((x) => x.chiffres))].slice(0, 6).join(' | ')})`)
        const rendue = t.findIndex((x) => Math.abs(x.largeur - fin) <= 0.05)
        assert.ok(rendue >= 0 && t.slice(rendue).every((x) => Math.abs(x.largeur - fin) <= 0.05), 'une fois rendue, la balise garde la largeur du nombre final')
      })
    })

    it('un changement en plein basculement : le dernier nombre gagne, aucune carte ne reste à mi-chemin', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await arrive(page, 'a', '129')
        await clique(page, 'n130')
        await dort(30)
        await page.evaluate(() => ((document.querySelector('mjs-cl-volets') as any)._shadow.querySelector('.n129') as any).click())
        await dort(30)
        await page.evaluate(() => ((document.querySelector('mjs-cl-volets') as any)._shadow.querySelector('.n130') as any).click())
        const v = await arrive(page, 'a', '130')
        assert.equal(v.ecrit, '130')
        // au repos, les quatre moitiés de chaque carte montrent le même chiffre
        const moities = await page.evaluate(() => {
          const el = (document.querySelector('mjs-cl-volets') as any)._shadow.querySelector('.a')
          return Array.from(el.querySelectorAll('[mjs-fx-count-card]')).map((c: any) => Array.from(c.children).map((i: any) => i.getAttribute('mjs-fx-count-d')).join(''))
        })
        assert.deepEqual(moities, ['1111', '3333', '0000'])
      })
    })

    it('« réduire les animations » : le chiffre change sans bascule, l\'état final est juste tout de suite', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await arrive(page, 'a', '129')
        await clique(page, 'n130')
        const v = await arrive(page, 'a', '130')
        assert.equal(v.ecrit, '130')
        assert.deepEqual(await rangs(page, 'a'), [], 'aucune carte ne bascule')
        await clique(page, 'n10')
        await arrive(page, 'a', '10')
        assert.deepEqual(await rangs(page, 'a'), [], 'même en perdant des chiffres')
        // rien ne bouge : le navigateur dessine peu d'images, on attend d'en avoir relevé assez
        nedebordeJamais('a', await jusque(() => images(page, 'a'), (t: Image[]) => t.length >= 6, 6000))
      }, { calme: true })
    })

    it('pad: 2 écrit le zéro de tête, et seule la carte du chiffre qui change bascule', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await arrive(page, 'p', '07')
        assert.equal(v.cartes, 2)
        assert.equal(v.ecrit, '7', 'le texte écrit n\'est pas touché')
        await clique(page, 'h8')
        await arrive(page, 'p', '08')
        assert.deepEqual(await rangs(page, 'p'), [1], 'la carte du zéro de tête ne bascule pas')
      })
    })

    it('les cartes se peignent : background et color écrits ; les variables de thème d\'un parent à défaut ; sans eux, les deux couleurs par défaut', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const c = await etat(page, 'c')
        assert.equal(c.fond, 'rgb(18, 52, 86)')
        assert.equal(c.couleur, 'rgb(171, 205, 239)')
        // les variables de thème (`$$count-background`, `$$count-color` : `--mjs-count-background`, `--mjs-count-color`) posées sur un parent
        const m = await etat(page, 'm')
        assert.equal(m.fond, 'rgb(10, 11, 12)')
        assert.equal(m.couleur, 'rgb(255, 136, 0)')
        const a = await etat(page, 'a')
        assert.equal(a.fond, 'rgb(31, 38, 51)')
        assert.equal(a.couleur, 'rgb(245, 247, 250)')
      })
    })

    it('pad écrit les zéros de tête dans le nombre, séparateurs, préfixe, suffixe, signe et décimales compris (un nombre déjà assez long ne change pas)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const textes = await jusque(() => page.evaluate(() => {
          const sh: any = (document.querySelector('mjs-cl-volets') as any)._shadow
          return ['z1', 'z2', 'z3', 'z4'].map((c) => sh.querySelector('.' + c + ' [mjs-fx-layer="text"]')?.textContent)
        }), (t: string[]) => t.every((x) => typeof x === 'string' && x !== ''))
        // le séparateur par défaut des milliers est l'espace fine insécable
        assert.deepEqual(textes, ['~ 0.129 €', '-003,5', '007', '12\u202f480'])
      })
    })

    it('retirée en plein basculement : ni marque, ni style en ligne, ni erreur', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await arrive(page, 'r', '129')
        await page.evaluate(() => {
          const w: any = window
          const sh: any = (document.querySelector('mjs-cl-volets') as any)._shadow
          w.__tenu = sh.querySelector('.r')
          ;(sh.querySelector('.n130') as any).click()
        })
        await dort(20)
        await page.evaluate(() => ((document.querySelector('mjs-cl-volets') as any)._shadow.querySelector('.cache') as any).click())
        await page.waitForFunction(() => !(document.querySelector('mjs-cl-volets') as any)._shadow.querySelector('.r'))
        await dort(500)
        const reste = await page.evaluate(() => {
          const el = (window as any).__tenu
          return { marques: Array.from(el.attributes).map((a: any) => a.name).filter((n: string) => n.startsWith('mjs-fx')), style: el.style.cssText, calques: el.querySelectorAll('[mjs-fx-layer]').length }
        })
        assert.deepEqual(reste, { marques: [], style: '', calques: 0 }, 'la balise retirée n\'a gardé ni marque, ni style en ligne, ni calque')
      })
    })
  })
}
