// *count dans Chromium, Firefox et WebKit réels : un nombre qui PERD des chiffres (12 480 → 9). Le calque montre encore l'ancien
// nombre pendant le décompte : la balise garde la place du plus large du départ et de l'arrivée, de sorte que le nombre affiché
// ne déborde jamais de sa balise ni sur le texte qui suit, à aucune image ; à la dernière image du décompte elle prend d'un
// coup la largeur du nombre final. Les mises en forme (séparateur de milliers, séparateur choisi, décimales, préfixe et
// suffixe) sont éprouvées dans un paragraphe (la balise y devient « inline-block ») et dans une ligne `flex`. Une nouvelle cible
// donnée en plein décompte part du nombre affiché à cet instant (plus étroite : la balise rétrécit à ce nombre, pas à l'ancienne
// place ; plus large : elle s'élargit tout de suite). Un nombre qui gagne des chiffres (9 → 12 480) garde sa place d'avant. Avec
// « réduire les animations » le nombre final est écrit tout de suite, à sa largeur. Retiré en plein décompte, l'effet ne laisse
// ni style en ligne, ni marque, ni image en attente.
// La page relève, à la fin de chaque image, la boîte de la balise, celle du texte du calque et la position du texte qui suit.
// WebKit est sauté quand il est absent : `PLAYWRIGHT_BROWSERS_PATH=<dossier qui l'a>` ou `npx playwright install webkit`.

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

// l'espace fine insécable (U+202F) que le séparateur par défaut écrit entre les milliers
const FINE = ' '

// un composant : huit compteurs, quatre mises en forme (a : séparateur par défaut, b : séparateur choisi, c : décimales, d : préfixe,
// suffixe et séparateur) chacune dans un paragraphe (1) et dans une ligne flex (2) ; r1 : un compteur qu'un bouton retire ; deux nombres
// qui commandent le tout. Chaque compteur est suivi d'un élément de classe `suite` : le texte qui ne doit jamais être recouvert
const SOURCE = `<script>
$grand = 12480
$dec = 12480.5
$vu = true
</script>

<p class="l">avant <span class="a1" *count(duration: 1500ms, on: load)>{$grand}</span><span class="suite"> après</span></p>
<div class="ligne"><span>avant</span><b class="a2" *count(duration: 1500ms, on: load)>{$grand}</b><span class="suite">après</span></div>
<p class="l">avant <span class="b1" *count(duration: 1500ms, on: load, separator: "-")>{$grand}</span><span class="suite"> après</span></p>
<div class="ligne"><span>avant</span><b class="b2" *count(duration: 1500ms, on: load, separator: "-")>{$grand}</b><span class="suite">après</span></div>
<p class="l">avant <span class="c1" *count(duration: 1500ms, on: load)>{$dec}</span><span class="suite"> après</span></p>
<div class="ligne"><span>avant</span><b class="c2" *count(duration: 1500ms, on: load)>{$dec}</b><span class="suite">après</span></div>
<p class="l">avant <span class="d1" *count(duration: 1500ms, on: load, separator: ".", prefix: "~ ", suffix: " €")>{$grand}</span><span class="suite"> après</span></p>
<div class="ligne"><span>avant</span><b class="d2" *count(duration: 1500ms, on: load, separator: ".", prefix: "~ ", suffix: " €")>{$grand}</b><span class="suite">après</span></div>
{if $vu}<p class="l">avant <span class="r1" *count(duration: 1500ms, on: load)>{$grand}</span><span class="suite"> après</span></p>{end}
<button class="v9" @click={$grand = 9; $dec = 9.5}>9</button>
<button class="v8" @click={$grand = 8; $dec = 8.5}>8</button>
<button class="v4" @click={$grand = 4; $dec = 4.5}>4</button>
<button class="vg" @click={$grand = 12480; $dec = 12480.5}>12480</button>
<button class="vl" @click={$grand = 123456; $dec = 123456.5}>123456</button>
<button class="cache" @click={$vu = false}>retirer</button>

<style>
.l
  font: 32px sans-serif
  margin: 8px 20px
.ligne
  display: flex
  align-items: baseline
  gap: 8px
  font: 32px sans-serif
  margin: 8px 20px
button
  font: 12px sans-serif
</style>
`

const TOUS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2']

// le texte final de chaque compteur, pour chaque nombre
const TEXTES: Record<string, Record<string, string>> = {
  grand: { a: `12${FINE}480`, b: '12-480', c: `12${FINE}480,5`, d: '~ 12.480 €' },
  neuf:  { a: '9', b: '9', c: '9,5', d: '~ 9 €' },
  huit:  { a: '8', b: '8', c: '8,5', d: '~ 8 €' },
  quatre: { a: '4', b: '4', c: '4,5', d: '~ 4 €' },
  large: { a: `123${FINE}456`, b: '123-456', c: `123${FINE}456,5`, d: '~ 123.456 €' }
}
const finale = (classe: string, nombre: string) => TEXTES[nombre][classe[0]]

// la page : relève, à la fin de chaque image, pour chaque balise `*count` qui a une boîte, sa largeur, le texte du calque, le bord droit
// de ce texte, le bord droit de la boîte de la balise (bordures et marges internes ôtées) et le bord gauche de l'élément qui suit
// (`__traces`, par classe de la balise)
const ECHANTILLONNEUR = () => {
  const w: any = window
  w.__traces   = {}
  const releve = () => {
    const sh: any = (document.querySelector('mjs-cl-retrecit') as any)?._shadow
    if (!sh) return
    for (const el of Array.from(sh.querySelectorAll('[mjs-fx~="count"]')) as any[]) {
      const b = el.getBoundingClientRect()
      if (b.width <= 0) continue
      const calque = el.querySelector('[mjs-fx-layer="text"]')
      if (!calque || calque.textContent === '') continue
      const r = document.createRange()
      r.selectNodeContents(calque)
      const t  = r.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const suite = el.nextElementSibling
      ;(w.__traces[el.className] ||= []).push({
        texte:   calque.textContent,
        largeur: b.width,
        droite:  t.right,
        boite:   b.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
        suite:   suite ? suite.getBoundingClientRect().left : null
      })
    }
  }
  const image = () => requestAnimationFrame(() => { setTimeout(releve, 0); image() })
  image()
}

// la mesure d'une balise : le texte de son calque, sa largeur, celle du texte, et son min-width
const MESURE = (a: { classe: string }) => {
  const sh: any = (document.querySelector('mjs-cl-retrecit') as any)._shadow
  const el      = sh.querySelector('.' + a.classe)
  const calque  = el.querySelector('[mjs-fx-layer="text"]')
  const r       = document.createRange()
  r.selectNodeContents(calque)
  return { texte: calque.textContent, largeur: el.getBoundingClientRect().width, largeurTexte: r.getBoundingClientRect().width, minWidth: el.style.minWidth }
}

const dort = (ms: number) => new Promise((r) => setTimeout(r, ms))

// le nombre de chiffres du texte d'un calque (un calque vide, entre la reconstruction et la première image du décompte, en compte zéro)
const chiffres = (texte: string) => texte.replace(/\D/g, '').length

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
// le bundle du composant, construit une seule fois par réglage (développement, ou production d'une application) pour les trois moteurs
function construit(prod = false): Promise<string> {
  const cle = prod ? 'prod' : 'dev'
  bundles[cle] ||= (async () => {
    const root   = mjsTmp('effets-compteur-retrecit-' + cle)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'cl-retrecit.mjs'), SOURCE)
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

type Trace = { texte: string, largeur: number, droite: number, boite: number, suite: number | null }

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`*count : un nombre qui perd des chiffres garde la place de l'ancien jusqu'à la fin du décompte (${nom} réel)`, function () {
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
    async function essai(fn: (page: any) => Promise<void>, options: { prod?: boolean, calme?: boolean } = {}) {
      const page = await browser.newPage({ viewport: { width: 800, height: 900 }, reducedMotion: options.calme ? 'reduce' : 'no-preference' })
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
      page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push('console.error : ' + m.text()) })
      await page.addInitScript(ECHANTILLONNEUR)
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-cl-retrecit></mjs-cl-retrecit><script>${options.prod ? produit : script}</script></body></html>` })
      })
      try {
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => ((document.querySelector('mjs-cl-retrecit') as any)?._shadow?.querySelectorAll('[mjs-fx-layer="text"]').length || 0) >= 9)
        await fn(page)
        assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      } finally {
        await page.close()
      }
    }

    const mesure  = (page: any, classe: string) => page.evaluate(MESURE, { classe })
    const traces  = (page: any, classe: string) => page.evaluate((c: string) => (window as any).__traces[c] || [], classe) as Promise<Trace[]>
    // les relevés repartent à zéro dans la même lecture que le clic : aucune image d'avant ne se mêle à celles d'après
    const clique  = (page: any, bouton: string) => page.evaluate((b: string) => {
      ;(window as any).__traces = {}
      ;((document.querySelector('mjs-cl-retrecit') as any)._shadow.querySelector('.' + b) as any).click()
    }, bouton)
    // le texte du calque de chaque compteur et sa largeur au moment du clic, lus dans la même tâche que lui : aucune image ne passe entre les deux
    const litEtClique = (page: any, bouton: string) => page.evaluate((b: string) => {
      const sh: any = (document.querySelector('mjs-cl-retrecit') as any)._shadow
      const vu: Record<string, { texte: string, largeurTexte: number }> = {}
      for (const el of Array.from(sh.querySelectorAll('[mjs-fx~="count"]')) as any[]) {
        const calque = el.querySelector('[mjs-fx-layer="text"]')
        const r      = document.createRange()
        r.selectNodeContents(calque)
        vu[el.className] = { texte: calque.textContent, largeurTexte: r.getBoundingClientRect().width }
      }
      ;(window as any).__traces = {}
      ;(sh.querySelector('.' + b) as any).click()
      return vu
    }, bouton) as Promise<Record<string, { texte: string, largeurTexte: number }>>
    // tous les compteurs de `classes` affichent le texte final du nombre `nombre`
    const tousFinis = (page: any, classes: string[], nombre: string) => jusque(
      () => page.evaluate((cl: string[]) => cl.map((c) => {
        const el: any = (document.querySelector('mjs-cl-retrecit') as any)._shadow.querySelector('.' + c)
        return el.querySelector('[mjs-fx-layer="text"]').textContent
      }), classes),
      (textes: string[]) => textes.every((t, i) => t === finale(classes[i], nombre))
    ) as Promise<string[]>

    // le nombre affiché tient dans sa balise et ne recouvre pas le texte qui suit, à CHAQUE image relevée
    function nedebordeJamais(classe: string, t: Trace[]) {
      assert.ok(t.length >= 8, `${classe} : assez d'images relevées (${t.length})`)
      const debord   = Math.max(...t.map((x) => x.droite - x.boite))
      const pire     = t.find((x) => x.droite - x.boite === debord) as Trace
      assert.ok(debord <= 0.5, `${classe} : le nombre affiché déborde de sa balise de ${debord.toFixed(1)} px (« ${pire.texte} », balise ${pire.largeur.toFixed(1)} px, sur ${t.length} images)`)
      const recouvre = Math.max(...t.map((x) => x.suite === null ? -1e9 : x.droite - x.suite))
      const gene     = t.find((x) => x.suite !== null && x.droite - x.suite === recouvre) as Trace
      assert.ok(recouvre <= 0.5, `${classe} : le nombre affiché recouvre le texte qui suit de ${recouvre.toFixed(1)} px (« ${gene.texte} »)`)
    }
    // le texte final tient dans la balise, qui n'est pas plus large qu'un pixel au-delà du nombre (l'arrondi au pixel supérieur)
    function aSaLargeur(classe: string, v: any) {
      assert.ok(v.largeur >= v.largeurTexte - 0.5, `${classe} : la balise (${v.largeur.toFixed(1)} px) est plus étroite que « ${v.texte} » (${v.largeurTexte.toFixed(1)} px)`)
      assert.ok(v.largeur <= v.largeurTexte + 1.6, `${classe} : la balise (${v.largeur.toFixed(1)} px) réserve plus que « ${v.texte} » (${v.largeurTexte.toFixed(1)} px)`)
    }

    // le décompte 12 480 → 9, relevé dans chaque mise en forme et chaque disposition
    for (const prod of [false, true]) {
      it(`12 480 → 9 (${prod ? 'production' : 'développement'}) : la balise garde la place de l'ancien nombre jusqu'à la fin, il ne déborde jamais, puis elle prend la largeur de « 9 »`, async function () {
        if (!present) { this.skip(); return }
        await essai(async (page) => {
          await tousFinis(page, TOUS, 'grand')
          await dort(300)
          const avant: Record<string, any> = {}
          for (const c of TOUS) avant[c] = await mesure(page, c)
          await clique(page, 'v9')
          const textes = await tousFinis(page, TOUS, 'neuf')
          assert.deepEqual(textes, TOUS.map((c) => finale(c, 'neuf')), 'tous les compteurs sont arrivés au nombre final')
          await dort(300)
          for (const c of TOUS) {
            const t = await traces(page, c)
            nedebordeJamais(c, t)
            const fin = finale(c, 'neuf')
            // tant que le calque n'a pas son texte final, la balise garde la largeur de l'ancien nombre
            const pendant = t.filter((x) => x.texte !== fin)
            assert.ok(pendant.length >= 8, `${c} : assez d'images pendant le décompte (${pendant.length})`)
            const ecart = Math.max(...pendant.map((x) => Math.abs(x.largeur - avant[c].largeur)))
            assert.ok(ecart <= 0.05, `${c} : la balise change de largeur pendant le décompte (écart ${ecart.toFixed(2)} px avec les ${avant[c].largeur.toFixed(2)} px d'avant ; textes vus : ${[...new Set(pendant.map((x) => x.texte))].slice(0, 5).join(' | ')} …)`)
            // à la fin : la largeur du nombre final
            const v = await mesure(page, c)
            assert.equal(v.texte, fin)
            aSaLargeur(c, v)
            assert.ok(v.largeur < avant[c].largeur - 20, `${c} : la balise a rendu la place (${avant[c].largeur.toFixed(1)} → ${v.largeur.toFixed(1)} px)`)
            // la balise ne rétrécit qu'une fois : elle ne reprend jamais la place de l'ancien nombre ensuite
            const rendue = t.findIndex((x) => Math.abs(x.largeur - v.largeur) <= 0.05)
            assert.ok(rendue >= 0 && t.slice(rendue).every((x) => Math.abs(x.largeur - v.largeur) <= 0.05 && x.texte === fin), `${c} : une fois rendue, la balise garde la largeur de « ${fin} » (images : ${t.slice(rendue).map((x) => x.texte + ' ' + x.largeur.toFixed(1)).slice(0, 4).join(' | ')} …)`)
          }
        }, { prod })
      })
    }

    it('un nombre qui gagne des chiffres (9 → 12 480), le cas déjà réglé : la place suit le nouveau nombre, le nombre tient dans sa balise à chaque image', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await tousFinis(page, TOUS, 'grand')
        await clique(page, 'v9')
        await tousFinis(page, TOUS, 'neuf')
        await dort(300)
        const avant: Record<string, any> = {}
        for (const c of TOUS) avant[c] = await mesure(page, c)
        await clique(page, 'vg')
        await tousFinis(page, TOUS, 'grand')
        await dort(300)
        for (const c of TOUS) {
          const t = await traces(page, c)
          nedebordeJamais(c, t)
          const v = await mesure(page, c)
          aSaLargeur(c, v)
          assert.ok(v.largeur > avant[c].largeur + 20, `${c} : la balise a grandi avec le nombre (${avant[c].largeur.toFixed(1)} → ${v.largeur.toFixed(1)} px)`)
          const ecart = Math.max(...t.map((x) => Math.abs(x.largeur - v.largeur)))
          assert.ok(ecart <= 0.05, `${c} : la balise garde une seule largeur pendant le décompte (écart ${ecart.toFixed(2)} px)`)
        }
      })
    })

    it('une cible changée en plein décompte : plus large, la place s\'élargit tout de suite ; plus étroite, la balise garde la place du nombre affiché à cet instant (pas de l\'ancienne place), puis rend celle du nombre final', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await tousFinis(page, TOUS, 'grand')
        await dort(300)
        // 12 480 → 9, puis en plein décompte une cible plus large (123 456)
        await clique(page, 'v9')
        await jusque(() => mesure(page, 'a1'), (v) => chiffres(v.texte) >= 1 && chiffres(v.texte) <= 4 && v.texte !== '9')
        await clique(page, 'vl')
        await tousFinis(page, TOUS, 'large')
        await dort(300)
        for (const c of TOUS) {
          const t = await traces(page, c)
          nedebordeJamais(c, t)
          const v = await mesure(page, c)
          aSaLargeur(c, v)
          const ecart = Math.max(...t.map((x) => Math.abs(x.largeur - v.largeur)))
          assert.ok(ecart <= 0.05, `${c} : vers une cible plus large, la balise a pris tout de suite la largeur de l'arrivée (écart ${ecart.toFixed(2)} px sur ${t.length} images)`)
        }
        // 123 456 → 8, puis en plein décompte une cible plus étroite (4), donnée quand le nombre affiché a cinq chiffres ou moins
        await clique(page, 'v8')
        await jusque(() => mesure(page, 'a1'), (v) => chiffres(v.texte) >= 1 && chiffres(v.texte) <= 5 && v.texte !== '8')
        const vu = await litEtClique(page, 'v4')
        await tousFinis(page, TOUS, 'quatre')
        await dort(300)
        for (const c of TOUS) {
          const t = await traces(page, c)
          nedebordeJamais(c, t)
          const fin = finale(c, 'quatre')
          const pendant = t.filter((x) => x.texte !== fin)
          assert.ok(pendant.length >= 8, `${c} : assez d'images pendant le décompte (${pendant.length})`)
          // la place tenue est celle du nombre affiché au moment du changement : ni celle de « 123 456 », ni celle de « 4 »
          const premiere = pendant[0].largeur
          const ecart = Math.max(...pendant.map((x) => Math.abs(x.largeur - premiere)))
          assert.ok(ecart <= 0.05, `${c} : la balise change de largeur pendant le décompte (écart ${ecart.toFixed(2)} px)`)
          assert.ok(premiere >= vu[c].largeurTexte - 0.5 && premiere <= vu[c].largeurTexte + 1.6, `${c} : la balise tient la place du nombre affiché au changement (« ${vu[c].texte} », ${vu[c].largeurTexte.toFixed(1)} px), pas ${premiere.toFixed(1)} px`)
          const v = await mesure(page, c)
          assert.equal(v.texte, fin)
          aSaLargeur(c, v)
        }
      })
    })

    it('« réduire les animations » : le nombre final est écrit tout de suite, à sa largeur', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await tousFinis(page, TOUS, 'grand')
        await dort(300)
        for (const c of TOUS) aSaLargeur(c, await mesure(page, c))
        await clique(page, 'v9')
        await tousFinis(page, TOUS, 'neuf')
        await dort(300)
        for (const c of TOUS) {
          const t = await traces(page, c)
          assert.ok(t.length >= 8, `${c} : assez d'images relevées (${t.length})`)
          // aucune image à l'ancien nombre ni à une largeur d'entre-deux : « 9 » à sa largeur dès la première
          assert.deepEqual([...new Set(t.map((x) => x.texte))], [finale(c, 'neuf')], `${c} : le nombre final est écrit tout de suite`)
          nedebordeJamais(c, t)
          const v = await mesure(page, c)
          aSaLargeur(c, v)
          assert.ok(Math.max(...t.map((x) => Math.abs(x.largeur - v.largeur))) <= 0.05, `${c} : la balise a tout de suite la largeur du nombre final`)
        }
      }, { calme: true })
    })

    it('retiré en plein décompte : aucun style en ligne, aucune marque, aucune image en attente', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await tousFinis(page, ['r1'], 'grand')
        await dort(300)
        await clique(page, 'v9')
        await jusque(() => mesure(page, 'r1'), (v) => chiffres(v.texte) >= 1 && chiffres(v.texte) <= 4 && v.texte !== '9')
        const milieu = await mesure(page, 'r1')
        assert.notEqual(milieu.minWidth, '', 'en plein décompte, la place est écrite')
        // la balise et son calque sont gardés, puis la balise est retirée
        await page.evaluate(() => {
          const w: any = window
          const sh: any = (document.querySelector('mjs-cl-retrecit') as any)._shadow
          w.__tenu   = sh.querySelector('.r1')
          w.__calque = w.__tenu.querySelector('[mjs-fx-layer="text"]')
          ;(sh.querySelector('.cache') as any).click()
        })
        await page.waitForFunction(() => !(document.querySelector('mjs-cl-retrecit') as any)._shadow.querySelector('.r1'))
        const vu = await page.evaluate(() => (window as any).__calque.textContent)
        await dort(500)
        const reste = await page.evaluate(() => {
          const w: any = window
          const el = w.__tenu
          return { texte: w.__calque.textContent, marques: Array.from(el.attributes).map((a: any) => a.name).filter((n: string) => n.startsWith('mjs-fx')), style: el.style.cssText }
        })
        assert.equal(reste.texte, vu, 'le calque retiré ne reçoit plus de nombre : aucune image ne reste en attente')
        assert.deepEqual({ marques: reste.marques, style: reste.style }, { marques: [], style: '' }, 'la balise retirée n\'a gardé ni marque ni style en ligne')
      })
    })
  })
}
