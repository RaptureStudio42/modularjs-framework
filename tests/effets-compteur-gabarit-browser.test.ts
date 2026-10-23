// *count dans Chromium et Firefox réels : les nombres INTERMÉDIAIRES d'un décompte peuvent être plus larges que ses deux bouts. Avec des
// chiffres proportionnels (la plupart des polices web : le « 1 » est étroit), « 11 111 » est étroit et « 10 523 » ne l'est pas ; même avec
// des chiffres tabulaires, le noyau « 11 » rapproche les deux 1 d'un nombre. La balise ne peut donc pas garder la place de ses deux bouts :
// pendant un décompte elle garde celle du nombre le plus large possible du même gabarit (le plus long des deux bouts, chaque chiffre
// remplacé par le chiffre le plus large de la police), puis prend d'un coup celle du nombre final. Les dix chiffres se lisent une seule fois
// par police, jamais par balise ni par image.
// La police à chiffres proportionnels est DejaVu Sans servie en deux faces : le « 1 » seul à 40 % de sa chasse, tout le reste à 100 %.
// La page relève, à la fin de chaque image, la boîte de la balise, celle du texte du calque et la position du texte qui suit.

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

const POLICE = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

// l'espace fine insécable (U+202F) que le séparateur par défaut écrit entre les milliers
const FINE = ' '

// a : chiffres proportionnels, nombre qui perd des chiffres (11 111 → 888), dans un paragraphe (1) et une ligne flex (2) ; b : chiffres
// proportionnels, nombre qui en gagne (9 → 11 111) ; c et d : les mêmes dans la police par défaut de la machine (le noyau « 11 »)
const SOURCE = `<script>
$bas = 11111
$haut = 9
</script>

<p class="l prop">avant <span class="a1" *count(duration: 800ms, on: load)>{$bas}</span><span class="suite"> après</span></p>
<div class="ligne prop"><span>avant</span><span class="a2" *count(duration: 800ms, on: load)>{$bas}</span><span class="suite">après</span></div>
<p class="l prop">avant <span class="b1" *count(duration: 800ms, on: load)>{$haut}</span><span class="suite"> après</span></p>
<div class="ligne prop"><span>avant</span><span class="b2" *count(duration: 800ms, on: load)>{$haut}</span><span class="suite">après</span></div>
<p class="l">avant <span class="c1" *count(duration: 800ms, on: load)>{$bas}</span><span class="suite"> après</span></p>
<p class="l">avant <span class="d1" *count(duration: 800ms, on: load)>{$haut}</span><span class="suite"> après</span></p>
<button class="vb" @click={$bas = 888}>888</button>
<button class="vh" @click={$haut = 11111}>11111</button>

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
.prop
  font-family: Prop, sans-serif
button
  font: 12px sans-serif
</style>
`

const PROPORTIONNELS = ['a1', 'a2', 'b1', 'b2']
const DEFAUT         = ['c1', 'd1']
const TEXTES: Record<string, string> = { 'bas-depart': `11${FINE}111`, 'bas-fin': '888', 'haut-depart': '9', 'haut-fin': `11${FINE}111` }

// la page : à la fin de chaque image, pour chaque balise `*count` qui a une boîte, sa largeur, le texte du calque, le bord droit de ce texte, le bord droit
// de la boîte de la balise (bordures et marges internes ôtées) et le bord gauche de l'élément qui suit (`__traces`, par classe de la balise)
const ECHANTILLONNEUR = () => {
  const w: any = window
  w.__traces   = {}
  const releve = () => {
    const sh: any = (document.querySelector('mjs-cl-gabarit') as any)?._shadow
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

// les lectures de la largeur d'un chiffre seul : un Range posé sur le nœud texte d'un calque, quand ce texte tient en un chiffre, au moment où on lit sa boîte
// (`__chiffres`) ; la mesure de la place d'un nombre, elle, prend tout le calque
const ESPION_CHIFFRES = () => {
  const w: any = window
  w.__chiffres = 0
  const lit    = Range.prototype.getBoundingClientRect
  Range.prototype.getBoundingClientRect = function (this: any) {
    if (this.commonAncestorContainer.nodeType === 3 && /^\d$/.test(this.toString())) w.__chiffres++
    return lit.call(this)
  }
}

// la mesure d'une balise : le texte de son calque, sa largeur, celle du texte, et celle d'un nombre sonde écrit dans la même police (sa chasse, comme le calque)
const MESURE = (a: { classe: string, sonde: string | null }) => {
  const sh: any = (document.querySelector('mjs-cl-gabarit') as any)._shadow
  const el      = sh.querySelector('.' + a.classe)
  const calque  = el.querySelector('[mjs-fx-layer="text"]')
  const r       = document.createRange()
  r.selectNodeContents(calque)
  let sonde = 0
  if (a.sonde) {
    const s = document.createElement('span')
    s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-variant-numeric:tabular-nums'
    s.textContent   = a.sonde
    el.parentNode.appendChild(s)
    sonde = s.getBoundingClientRect().width
    s.remove()
  }
  return { texte: calque.textContent, largeur: el.getBoundingClientRect().width, largeurTexte: r.getBoundingClientRect().width, minWidth: el.style.minWidth, sonde }
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

let bundle: Promise<string> | null = null
// le bundle du composant, construit une seule fois pour les deux moteurs
function construit(): Promise<string> {
  bundle ||= (async () => {
    const root   = mjsTmp('effets-compteur-gabarit')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'cl-gabarit.mjs'), SOURCE)
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

type Trace = { texte: string, largeur: number, droite: number, boite: number, suite: number | null }

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*count : la place d'un décompte est celle du nombre le plus large possible de son gabarit (${nom} réel)`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let browser: any = null

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      script  = await construit()
      browser = await (await import('playwright'))[nom].launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    // une page neuve : la police à chiffres proportionnels arrivée AVANT le composant (une lecture des chiffres faite police en route serait fausse),
    // puis le composant monté ; les erreurs de la page gardées
    async function essai(fn: (page: any) => Promise<void>, options: { echantillonne?: boolean } = {}) {
      const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
      page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push('console.error : ' + m.text()) })
      await page.addInitScript(options.echantillonne === false ? ESPION_CHIFFRES : ECHANTILLONNEUR)
      await page.addInitScript((code: string) => { (window as any).__bundle = code }, script)
      await page.route('http://t.test/**', (route: any) => {
        const url = route.request().url()
        if (url === 'http://t.test/dejavu.ttf') return route.fulfill({ contentType: 'font/ttf', body: readFileSync(POLICE) })
        if (url !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        const faces = '@font-face{font-family:Prop;src:url(/dejavu.ttf);unicode-range:U+0031;size-adjust:40%}@font-face{font-family:Prop;src:url(/dejavu.ttf);unicode-range:U+0000-0030,U+0032-FFFF}'
        const pose  = `document.fonts.load('32px Prop', '0123456789').then(function () { var s = document.createElement('script'); s.textContent = window.__bundle; document.body.appendChild(s) })`
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${faces}html,body{margin:0;background:#fff}</style></head><body><mjs-cl-gabarit></mjs-cl-gabarit><script>${pose}</script></body></html>` })
      })
      try {
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => ((document.querySelector('mjs-cl-gabarit') as any)?._shadow?.querySelectorAll('[mjs-fx-layer="text"]').length || 0) >= 6)
        await fn(page)
        assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      } finally {
        await page.close()
      }
    }

    const mesure = (page: any, classe: string, sonde: string | null = null) => page.evaluate(MESURE, { classe, sonde })
    const traces = (page: any, classe: string) => page.evaluate((c: string) => (window as any).__traces[c] || [], classe) as Promise<Trace[]>
    // les relevés repartent à zéro dans la même lecture que le clic : aucune image d'avant ne se mêle à celles d'après
    const clique = (page: any, bouton: string) => page.evaluate((b: string) => {
      ;(window as any).__traces = {}
      ;((document.querySelector('mjs-cl-gabarit') as any)._shadow.querySelector('.' + b) as any).click()
    }, bouton)
    // tous les compteurs de `classes` affichent le texte `final`
    const tousFinis = (page: any, classes: string[], final: string) => jusque(
      () => page.evaluate((cl: string[]) => cl.map((c) => {
        const el: any = (document.querySelector('mjs-cl-gabarit') as any)._shadow.querySelector('.' + c)
        return el.querySelector('[mjs-fx-layer="text"]').textContent
      }), classes),
      (textes: string[]) => textes.every((t) => t === final)
    ) as Promise<string[]>

    // les chiffres de la police d'essai sont bien proportionnels : sans eux le test ne prouve rien
    async function chiffresProportionnels(page: any) {
      const largeurs = await page.evaluate(() => {
        const s = document.createElement('span')
        s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:32px Prop, sans-serif'
        document.body.appendChild(s)
        const lit = (t: string) => { s.textContent = t; return s.getBoundingClientRect().width }
        const r = { un: lit('1111'), huit: lit('8888') }
        s.remove()
        return r
      })
      assert.ok(largeurs.un < largeurs.huit * 0.6, `la police d'essai a des chiffres proportionnels (« 1111 » ${largeurs.un.toFixed(1)} px, « 8888 » ${largeurs.huit.toFixed(1)} px)`)
    }

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

    // un décompte : à chaque image le nombre tient dans la balise ; pendant le décompte la balise garde UNE largeur, celle du plus large nombre
    // possible du gabarit (`sonde` : ce nombre, écrit dans la même police) ; à la fin elle a la largeur du nombre final et n'en change plus
    async function decompte(page: any, classes: string[], bouton: string, final: string, sonde: string) {
      await clique(page, bouton)
      assert.deepEqual(await tousFinis(page, classes, final), classes.map(() => final), 'tous les compteurs sont arrivés au nombre final')
      await dort(300)
      for (const c of classes) {
        const t = await traces(page, c)
        nedebordeJamais(c, t)
        const pendant = t.filter((x) => x.texte !== final)
        assert.ok(pendant.length >= 8, `${c} : assez d'images pendant le décompte (${pendant.length})`)
        const attendu = await mesure(page, c, sonde)
        const premiere = pendant[0].largeur
        const ecart = Math.max(...pendant.map((x) => Math.abs(x.largeur - premiere)))
        assert.ok(ecart <= 0.05, `${c} : la balise change de largeur pendant le décompte (écart ${ecart.toFixed(2)} px ; textes vus : ${[...new Set(pendant.map((x) => x.texte))].slice(0, 5).join(' | ')} …)`)
        assert.ok(premiere >= attendu.sonde - 0.5 && premiere <= attendu.sonde + 1.6, `${c} : pendant le décompte la balise (${premiere.toFixed(1)} px) a la place du plus large nombre possible (« ${sonde} », ${attendu.sonde.toFixed(1)} px)`)
        const v = await mesure(page, c)
        assert.equal(v.texte, final)
        aSaLargeur(c, v)
        const rendue = t.findIndex((x) => Math.abs(x.largeur - v.largeur) <= 0.05 && x.texte === final)
        assert.ok(rendue >= 0 && t.slice(rendue).every((x) => Math.abs(x.largeur - v.largeur) <= 0.05 && x.texte === final), `${c} : une fois rendue, la balise garde la largeur de « ${final} »`)
      }
    }

    it('11 111 → 888, chiffres proportionnels : « 10 523 » est plus large que « 11 111 », il tient pourtant dans la balise à chaque image ; la place est celle de « 00 000 », puis celle de « 888 »', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await chiffresProportionnels(page)
        await tousFinis(page, [...PROPORTIONNELS.slice(0, 2), ...DEFAUT.slice(0, 1)], TEXTES['bas-depart'])
        await tousFinis(page, [...PROPORTIONNELS.slice(2), DEFAUT[1]], '9')
        await dort(300)
        await decompte(page, ['a1', 'a2'], 'vb', TEXTES['bas-fin'], `00${FINE}000`)
      })
    })

    it('9 → 11 111, chiffres proportionnels : « 10 888 » dépasse « 11 111 », il tient dans la balise à chaque image ; la place est celle de « 00 000 », puis celle de « 11 111 »', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await chiffresProportionnels(page)
        await tousFinis(page, [...PROPORTIONNELS.slice(0, 2), DEFAUT[0]], TEXTES['bas-depart'])
        await tousFinis(page, [...PROPORTIONNELS.slice(2), DEFAUT[1]], '9')
        await dort(300)
        await decompte(page, ['b1', 'b2'], 'vh', TEXTES['haut-fin'], `00${FINE}000`)
      })
    })

    it('police par défaut de la machine (le noyau « 11 » rapproche les 1) : 11 111 → 888 et 9 → 11 111, le nombre tient dans sa balise à chaque image', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await tousFinis(page, [...PROPORTIONNELS.slice(0, 2), DEFAUT[0]], TEXTES['bas-depart'])
        await tousFinis(page, [...PROPORTIONNELS.slice(2), DEFAUT[1]], '9')
        await dort(300)
        await decompte(page, ['c1'], 'vb', TEXTES['bas-fin'], `00${FINE}000`)
        await decompte(page, ['d1'], 'vh', TEXTES['haut-fin'], `00${FINE}000`)
      })
    })

    it('les dix chiffres se lisent une seule fois par police : deux polices, six compteurs, deux décomptes — vingt lectures, jamais une de plus', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await tousFinis(page, [...PROPORTIONNELS.slice(0, 2), DEFAUT[0]], TEXTES['bas-depart'])
        await tousFinis(page, [...PROPORTIONNELS.slice(2), DEFAUT[1]], '9')
        await dort(300)
        const pose = await page.evaluate(() => (window as any).__chiffres)
        assert.equal(pose, 20, 'à la pose : dix chiffres pour la police à chiffres proportionnels, dix pour celle par défaut — pas dix par balise')
        await clique(page, 'vb')
        await clique(page, 'vh')
        await tousFinis(page, ['a1', 'a2', 'c1'], TEXTES['bas-fin'])
        await tousFinis(page, ['b1', 'b2', 'd1'], TEXTES['haut-fin'])
        await dort(300)
        assert.equal(await page.evaluate(() => (window as any).__chiffres), 20, 'les décomptes (nouvelle cible, images) ne relisent aucun chiffre')
      }, { echantillonne: false })
    })
  })
}
