// *count dans Chromium, Firefox et WebKit réels : la balise du nombre prend la place du nombre MIS EN FORME
// (séparateur des milliers, décimales, préfixe, suffixe), le texte final tient dans sa balise et la balise ne
// change pas de largeur pendant tout le décompte — pas de saut de mise en page, la suite du texte ne bouge pas.
// Cas : l'effet posé au premier rendu du composant (qui est encore masqué : aucune boîte à mesurer, la place est
// prise dès que la balise en a une) avec un séparateur, des décimales, un préfixe et un suffixe ; une balise
// d'abord cachée par la feuille de style, puis montrée ; un nombre qui gagne des chiffres (9 → 12 480) ; un
// séparateur qui change (la langue) et rejoue le décompte ; un parent que la page elle-même observe (un observateur
// de taille de la page, qui voit le parent changer de taille quand la place est prise : le navigateur ne doit
// signaler aucune erreur « ResizeObserver loop » sur la fenêtre), posé au premier rendu (aucune image à la largeur
// brute) ou dans une zone cachée puis montrée. Un observateur de la page relève la largeur de la
// balise à la fin de chaque image ; la première image où la balise se voit n'est pas comptée (la lecture force
// la mise en page avant que l'observateur de taille de l'effet n'ait servi, ce que l'écran ne montre pas).
// Le chargement normal d'un composant mesure la place deux fois par compteur (la pose, puis le micro-tâche où l'hôte se montre) et ne laisse aucun
// observateur de taille en vie : celui que la pose arme quand la balise n'a pas encore de boîte est débranché dès que la mesure du micro-tâche en trouve une,
// son premier avis ne redemande pas une troisième mesure. Dans la zone cachée puis montrée, la page numérote elle-même ses images et repère l'image où la balise
// reçoit sa boîte (l'avis d'un observateur de taille de la page, livré dans la même image que celui de la balise) et celle où sa largeur change : la place s'écrit
// à l'image qui suit, exactement — une seule image à la largeur du nombre brut. La charge de la machine décale les deux repères ensemble, jamais leur écart.
// Un nombre qui perd sa boîte puis la retrouve en s'allongeant retrouve sa place : l'observateur d'attente est réarmé.
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

// l'espace fine insécable que le séparateur par défaut écrit entre les milliers
const FINE = ' '

// un composant, des balises `*count` posées dès son premier rendu : a (séparateur), b (décimales), c (préfixe et
// suffixe), d (un nombre réactif qui gagne des chiffres), e (un séparateur réactif), f (cachée par la feuille de
// style jusqu'à ce que le test la montre)
const SOURCE = `<script>
$grand = 9
$sep = ' '
</script>

<p class="l"><span class="a" *count(duration: 1500ms, on: load, separator: "-")>12480</span> clients</p>
<p class="l"><span class="b" *count(duration: 1500ms, on: load)>12480.5</span> points</p>
<p class="l"><span class="c" *count(duration: 1500ms, on: load, separator: ".", prefix: "~ ", suffix: " €")>12480</span> en tout</p>
<p class="l"><span class="d" *count(duration: 1500ms, on: load)>{$grand}</span> visites</p>
<p class="l"><span class="e" *count(duration: 1500ms, on: load, separator: $sep)>12480</span> abonnés</p>
<div class="cache"><p class="l"><span class="f" *count(duration: 1500ms, on: load, suffix: " %")>12480</span> cachés</p></div>
<button class="g" @click={$grand = 12480}>grand</button>
<button class="s" @click={$sep = ','}>langue</button>

<style>
.l
  font: 32px sans-serif
  margin: 12px 20px
.cache
  display: none
</style>
`

// un composant dont la balise `*count` vit dans un parent en ligne-bloc (il prend la largeur de la balise) que la page
// observe elle-même
const SOURCE_ANCETRE = `<p class="l"><span class="parent"><b class="h" *count(duration: 1500ms, on: load, separator: ".", suffix: " €")>12480</b></span> en tout</p>
<div class="cache"><p class="l"><span class="parent2"><b class="i" *count(duration: 1500ms, on: load, separator: ".", suffix: " €")>12480</b></span> cachés</p></div>

<style>
.l
  font: 32px sans-serif
  margin: 12px 20px
.parent, .parent2
  display: inline-block
  border: 1px solid #888
.cache
  display: none
</style>
`

// un composant à deux compteurs visibles dès le premier rendu : chacun mesure la place deux fois, et son observateur d'attente n'a plus rien à attendre
const SOURCE_MESURES = `<p class="l"><span class="m1" *count(duration: 500ms, on: load)>12480</span> clients, <span class="m2" *count(duration: 500ms, on: load, separator: ".", suffix: " €")>3500</span></p>

<style>
.l
  font: 28px sans-serif
  margin: 12px 20px
</style>
`

// la page : relève, à la fin de chaque image, la largeur de chaque balise `*count` qui a une boîte et le texte de
// son calque (`__traces`, par classe de la balise)
const ECHANTILLONNEUR = () => {
  const w: any = window
  w.__traces   = {}
  const releve = () => {
    const sh: any = (document.querySelector('mjs-cl-compte') as any)?._shadow
    if (!sh) return
    for (const el of Array.from(sh.querySelectorAll('[mjs-fx~="count"]')) as any[]) {
      const b = el.getBoundingClientRect()
      if (b.width <= 0) continue
      const calque = el.querySelector('[mjs-fx-layer="text"]')
      ;(w.__traces[el.className] ||= []).push({ largeur: b.width, texte: calque ? calque.textContent : '' })
    }
  }
  const image = () => requestAnimationFrame(() => { setTimeout(releve, 0); image() })
  image()
}

// les observateurs de taille de la page : combien en sont créés, combien d'avis ils reçoivent (`__observateurs`).
// Un observateur reçoit toujours un premier avis, balise masquée et taille nulle : l'effet qui s'en servirait pour
// rearmer un observateur neuf à chaque avis en créerait un à chaque image
const ESPION_OBSERVATEURS = () => {
  const w: any = window
  const Vrai   = w.ResizeObserver
  w.__observateurs = { crees: 0, avis: 0 }
  w.ResizeObserver = class extends Vrai {
    constructor(rappel: any) {
      super((...a: any[]) => {
        w.__observateurs.avis++
        rappel(...a)
      })
      w.__observateurs.crees++
    }
  }
}

// chaque mesure de la place, par classe de la balise (`__mesuresPlace`) : `_mjs_fxNumWidth` lit le nombre de départ puis celui d'arrivée, deux
// `selectNodeContents` sur le calque de la balise par mesure ; et les observateurs de taille encore en vie qui regardent un compteur (`__observateursVivants`)
const ESPION_MESURES = () => {
  const w: any = window
  w.__mesuresPlace = {}
  const Vrai    = w.ResizeObserver
  const vivants = new Set<any>()
  w.ResizeObserver = class extends Vrai {
    constructor(rappel: any) {
      super(rappel)
      ;(this as any).cibles = new Set()
    }
    observe(cible: any, options?: any) {
      ;(this as any).cibles.add(cible)
      vivants.add(this)
      return super.observe(cible, options)
    }
    unobserve(cible: any) {
      ;(this as any).cibles.delete(cible)
      if (!(this as any).cibles.size) vivants.delete(this)
      return super.unobserve(cible)
    }
    disconnect() {
      ;(this as any).cibles.clear()
      vivants.delete(this)
      return super.disconnect()
    }
  }
  w.__observateursVivants = () => Array.from(vivants).filter((o: any) => Array.from(o.cibles).some((c: any) => c.matches && c.matches('[mjs-fx~="count"]'))).length
  const lit = Range.prototype.selectNodeContents
  Range.prototype.selectNodeContents = function (noeud: any) {
    const el = noeud && noeud.getAttribute && noeud.getAttribute('mjs-fx-layer') === 'text' ? noeud.parentElement : null
    if (el) w.__mesuresPlace[el.className] = (w.__mesuresPlace[el.className] || 0) + 1
    return lit.call(this, noeud)
  }
}

// les images de la page, numérotées (`__image`) : chaque demande d'image passe par ici, et les rappels d'une même image (même horodatage) reçoivent le même numéro.
// Une boucle permanente compte chaque image, même quand rien d'autre n'en demande. L'avis d'un observateur de taille est livré après les rappels de son image :
// le numéro lu dans l'avis est celui de l'image qui l'a livré
const ESPION_IMAGES = () => {
  const w: any = window
  const vrai   = w.requestAnimationFrame.bind(w)
  let dernier  = -1
  w.__image    = 0
  w.requestAnimationFrame = (rappel: any) => vrai((t: number) => {
    if (t !== dernier) {
      dernier = t
      w.__image++
    }
    return rappel(t)
  })
  const boucle = () => w.requestAnimationFrame(boucle)
  boucle()
}

// les largeurs de la balise d'une zone cachée puis montrée, notées par un observateur de taille de la page avec le numéro de l'image qui a livré chaque avis (`__avis`).
// Le sien et celui de l'effet arrivent dans la même image, celle où la balise reçoit sa boîte ; une largeur nulle (la zone cachée) n'est pas notée
const SUIT_LARGEUR = (a: { tag: string, classe: string }) => {
  const w: any  = window
  const el: any = (document.querySelector(a.tag) as any)._shadow.querySelector('.' + a.classe)
  w.__avis      = []
  new w.ResizeObserver((liste: any[]) => {
    for (const x of liste) if (x.contentRect.width > 0) w.__avis.push({ image: w.__image, largeur: Math.round(x.contentRect.width * 100) / 100 })
  }).observe(el)
}

// une page sans `document.fonts` : l'effet ne reprend pas la place sur les événements de polices (Firefox émet un `loadingdone` environ 60 ms après le début
// de la page, qui fait mesurer une fois de plus : c'est la reprise sur les polices, couverte par effets-police-tardive-browser, pas l'attente de la boîte)
const SANS_POLICES = () => {
  Object.defineProperty(document, 'fonts', { value: undefined, configurable: true })
}

// la page observe les parents de la balise (`.parent` et `.parent2`, nés avec le composant) : ses avis et la largeur du
// parent à chacun (`__avisPage`, par classe), et les erreurs que la fenêtre reçoit (`__erreurs`, dont « ResizeObserver
// loop completed with undelivered notifications. » : Playwright ne la remonte comme erreur de page qu'avec WebKit)
const ESPION_ANCETRE = () => {
  const w: any = window
  w.__erreurs  = []
  w.__avisPage = { parent: [], parent2: [] }
  w.addEventListener('error', (e: any) => w.__erreurs.push(String(e.message)))
  const page = new w.ResizeObserver((liste: any[]) => {
    for (const x of liste) w.__avisPage[x.target.className].push(Math.round(x.contentRect.width * 100) / 100)
  })
  const cherche = () => {
    const sh: any = (document.querySelector('mjs-cl-ancetre') as any)?._shadow
    const parents = sh ? sh.querySelectorAll('.parent, .parent2') : []
    if (parents.length === 2) for (const p of parents) page.observe(p)
    else requestAnimationFrame(cherche)
  }
  requestAnimationFrame(cherche)
}

// la mesure d'une balise : son texte, ses lignes, et la boîte de la balise comparée à celle du texte du calque
const MESURE = (a: { classe: string, tag: string }) => {
  const sh: any = (document.querySelector(a.tag) as any)._shadow
  const el      = sh.querySelector('.' + a.classe)
  const calque  = el.querySelector('[mjs-fx-layer="text"]')
  const r       = document.createRange()
  r.selectNodeContents(calque)
  const t  = r.getBoundingClientRect()
  const b  = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return {
    texte:        calque.textContent,
    lignes:       new Set(Array.from(r.getClientRects()).map((x: any) => Math.round(x.top))).size,
    gauche:       t.left,
    droite:       t.right,
    largeurTexte: t.width,
    boiteGauche:  b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
    boiteDroite:  b.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
    largeur:      b.width,
    minWidth:     el.style.minWidth
  }
}

const dort = (ms: number) => new Promise((r) => setTimeout(r, ms))

// relit `lire` jusqu'à ce que `ok` soit vrai (au plus `ms`) ; rend la dernière lecture dans tous les cas
async function jusque(lire: () => Promise<any>, ok: (v: any) => boolean, ms = 8000) {
  const fin = Date.now() + ms
  let v     = await lire()
  while (!ok(v) && Date.now() < fin) {
    await dort(60)
    v = await lire()
  }
  return v
}

const bundles: Record<string, Promise<string>> = {}
// le bundle des composants, construit une seule fois par réglage (développement, ou production d'une application) pour les trois moteurs
function construit(prod = false): Promise<string> {
  const cle = prod ? 'prod' : 'dev'
  bundles[cle] ||= (async () => {
    const root   = mjsTmp('effets-compteur-largeur-' + cle)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'cl-compte.mjs'), SOURCE)
    writeFileSync(join(srcDir, 'cl-ancetre.mjs'), SOURCE_ANCETRE)
    writeFileSync(join(srcDir, 'cl-mesures.mjs'), SOURCE_MESURES)
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

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`*count : la place du nombre mis en forme, sans saut de mise en page (${nom} réel)`, function () {
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
    async function ouvre(tag = 'mjs-cl-compte', classe = 'a', prod = false, sansPolices = false, images = false) {
      const page = await browser.newPage({ viewport: { width: 800, height: 700 } })
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
      page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push('console.error : ' + m.text()) })
      await page.addInitScript(ECHANTILLONNEUR)
      await page.addInitScript(ESPION_OBSERVATEURS)
      await page.addInitScript(ESPION_ANCETRE)
      await page.addInitScript(ESPION_MESURES)
      if (sansPolices) await page.addInitScript(SANS_POLICES)
      if (images) await page.addInitScript(ESPION_IMAGES)
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${prod ? produit : script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((a: string[]) => !!(document.querySelector(a[0]) as any)?._shadow?.querySelector('.' + a[1] + ' [mjs-fx-layer="text"]'), [tag, classe])
      return { page, erreurs }
    }
    async function essai(fn: (page: any) => Promise<void>, tag = 'mjs-cl-compte', classe = 'a', prod = false, sansPolices = false, images = false) {
      const { page, erreurs } = await ouvre(tag, classe, prod, sansPolices, images)
      try {
        await fn(page)
        assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      } finally {
        await page.close()
      }
    }

    const mesure  = (page: any, classe: string, tag = 'mjs-cl-compte') => page.evaluate(MESURE, { classe, tag })
    const traces  = (page: any, classe: string) => page.evaluate((c: string) => (window as any).__traces[c] || [], classe) as Promise<{ largeur: number, texte: string }[]>
    // les relevés repartent à zéro dans la même lecture que le clic : aucune image d'avant ne se mêle à celles d'après
    const clique  = (page: any, bouton: string) => page.evaluate((b: string) => {
      ;(window as any).__traces = {}
      ;((document.querySelector('mjs-cl-compte') as any)._shadow.querySelector(b) as any).click()
    }, bouton)
    // la balise est arrivée au bout de son compte : le texte final est écrit
    const fini    = (page: any, classe: string, final: string, tag = 'mjs-cl-compte') => jusque(() => mesure(page, classe, tag), (v) => v.texte === final)

    // le texte final tient dans la balise, sur une ligne, et la place réservée n'est pas plus large qu'un pixel
    // au-delà du nombre (l'arrondi au pixel supérieur)
    function tient(classe: string, v: any) {
      assert.equal(v.lignes, 1, `${classe} : « ${v.texte} » s'affiche sur ${v.lignes} lignes`)
      assert.ok(v.gauche >= v.boiteGauche - 0.5 && v.droite <= v.boiteDroite + 0.5, `${classe} : « ${v.texte} » (${v.gauche.toFixed(1)} → ${v.droite.toFixed(1)}) déborde de sa balise (${v.boiteGauche.toFixed(1)} → ${v.boiteDroite.toFixed(1)}), min-width « ${v.minWidth} »`)
      assert.ok(v.largeur <= v.largeurTexte + 1.6, `${classe} : la balise (${v.largeur.toFixed(1)} px) réserve plus que « ${v.texte} » (${v.largeurTexte.toFixed(1)} px)`)
    }
    // la balise garde une seule largeur d'une image à l'autre, la première où elle se voit exceptée
    function stable(classe: string, t: { largeur: number, texte: string }[], largeurFinale: number) {
      const vues = t.slice(1)
      assert.ok(vues.length >= 10, `${classe} : assez d'images relevées (${vues.length})`)
      const largeurs = vues.map((x) => x.largeur)
      const bas      = Math.min(...largeurs)
      const haut     = Math.max(...largeurs)
      assert.ok(haut - bas <= 0.05, `${classe} : la balise change de largeur pendant le compte (de ${bas.toFixed(2)} à ${haut.toFixed(2)} px sur ${vues.length} images ; textes vus : ${[...new Set(vues.map((x) => x.texte))].slice(0, 6).join(' | ')} …)`)
      assert.ok(Math.abs(haut - largeurFinale) <= 0.05, `${classe} : la largeur tenue pendant le compte (${haut.toFixed(2)} px) est celle de la fin (${largeurFinale.toFixed(2)} px)`)
    }
    // le compte a passé par des nombres intermédiaires, sous les yeux (la balise avait une boîte)
    function compte(classe: string, t: { largeur: number, texte: string }[]) {
      const textes = new Set(t.map((x) => x.texte))
      assert.ok(textes.size >= 3, `${classe} : le compte se voit (${textes.size} textes relevés : ${[...textes].join(' | ')})`)
    }

    // le chargement normal, sans événement de polices : deux mesures de la place par compteur, puis plus rien (aucune mesure à l'image suivante, aucun observateur en vie)
    const MESURES_DEUX_FOIS = async (page: any) => {
      await page.waitForFunction(() => !!(document.querySelector('mjs-cl-mesures') as any)?._shadow?.querySelector('.m1 [mjs-fx-layer="text"]'))
      await dort(1500)
      // lu avant toute mesure de ce test : `MESURE` lit lui aussi les calques
      const vu      = await page.evaluate(() => ({ lectures: (window as any).__mesuresPlace, vivants: (window as any).__observateursVivants() }))
      const mesures = Object.fromEntries(Object.entries(vu.lectures as Record<string, number>).map(([c, n]) => [c, n / 2]))
      assert.deepEqual(mesures, { m1: 2, m2: 2 }, `mesures de la place par compteur : la pose et le micro-tâche, pas une troisième à l'image suivante (${JSON.stringify(vu.lectures)} lectures)`)
      assert.equal(vu.vivants, 0, 'aucun observateur de taille ne reste en vie : celui de la pose est débranché dès que la mesure du micro-tâche trouve une boîte')
    }

    const FINALS: Record<string, string> = { a: '12-480', b: `12${FINE}480,5`, c: '~ 12.480 €', e: `12${FINE}480` }

    it('posé au premier rendu du composant : séparateur, décimales, préfixe et suffixe tiennent dans la balise, qui garde sa largeur tout le décompte', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const fin: Record<string, any> = {}
        for (const [c, texte] of Object.entries(FINALS)) fin[c] = await fini(page, c, texte)
        await dort(300)
        for (const [c, texte] of Object.entries(FINALS)) {
          assert.equal(fin[c].texte, texte, `${c} est arrivée au bout de son compte`)
          const v = await mesure(page, c)
          tient(c, v)
          const t = await traces(page, c)
          compte(c, t)
          stable(c, t, v.largeur)
        }
      })
    })

    it('un nombre qui gagne des chiffres (9 → 12 480) : la place suit le nouveau nombre dès son écriture, puis ne bouge plus', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const avant = await fini(page, 'd', '9')
        tient('d', avant)
        await dort(200)
        await clique(page, '.g')
        const apres = await fini(page, 'd', `12${FINE}480`)
        await dort(300)
        const v = await mesure(page, 'd')
        tient('d', v)
        assert.ok(v.largeur > avant.largeur + 20, `la balise a grandi avec le nombre (${avant.largeur.toFixed(1)} → ${v.largeur.toFixed(1)} px)`)
        const t = await traces(page, 'd')
        compte('d', t)
        stable('d', t, v.largeur)
        assert.equal(apres.texte, `12${FINE}480`)
      })
    })

    it('un séparateur qui change (la langue) : le décompte rejoué tient dans la balise, qui garde sa largeur', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const avant = await fini(page, 'e', `12${FINE}480`)
        tient('e', avant)
        await dort(200)
        await clique(page, '.s')
        await fini(page, 'e', '12,480')
        await dort(300)
        const v = await mesure(page, 'e')
        tient('e', v)
        assert.ok(v.largeur > avant.largeur + 1, `la virgule est plus large que l'espace fine (${avant.largeur.toFixed(1)} → ${v.largeur.toFixed(1)} px)`)
        const t = await traces(page, 'e')
        compte('e', t)
        stable('e', t, v.largeur)
      })
    })

    it('posé dans une zone cachée par la feuille de style, puis montrée : la place du nombre est écrite à l\'image qui suit l\'avis de l\'observateur de taille de la balise — une seule image à la largeur du nombre brut, à toute cadence', async function () {
      if (!present) { this.skip(); return }
      // sans `document.fonts` : aucun événement de police ne peut reprendre la place avant l'avis de l'observateur ; avec les images numérotées de la page
      await essai(async (page) => {
        // l'effet est posé, la zone n'a aucune boîte : le décompte court sans qu'on le voie
        const cache = await page.evaluate(() => {
          const el: any = (document.querySelector('mjs-cl-compte') as any)._shadow.querySelector('.f')
          return { boite: el.getClientRects().length, calque: !!el.querySelector('[mjs-fx-layer="text"]') }
        })
        assert.deepEqual(cache, { boite: 0, calque: true }, 'la balise est posée mais sans boîte')
        await dort(1800)
        // six balises, un observateur chacune, un premier avis chacun : rien ne se relance pendant que la zone est cachée
        const obs = await page.evaluate(() => (window as any).__observateurs)
        assert.ok(obs.crees <= 6, `un observateur par balise au plus, aucun rearmé à chaque avis (${obs.crees} créés)`)
        assert.ok(obs.avis <= 14, `quelques avis seulement, pas un par image (${obs.avis} avis)`)
        // le compte arrive au bout pendant que la zone est cachée (sur une machine chargée, on l'attend)
        const cachee = await jusque(() => mesure(page, 'f'), (x) => x.texte === `12${FINE}480 %`, 15000)
        assert.equal(cachee.texte, `12${FINE}480 %`, 'le compte est arrivé au bout pendant que la zone était cachée')
        // la page note les largeurs de la balise, avec le numéro de l'image de chaque avis ; puis la zone est montrée
        await page.evaluate(SUIT_LARGEUR, { tag: 'mjs-cl-compte', classe: 'f' })
        await page.evaluate(() => { ;((document.querySelector('mjs-cl-compte') as any)._shadow.querySelector('.cache') as any).style.display = 'block' })
        // l'avis de la boîte, celui de la place, puis une dizaine d'images au repos : la largeur ne change plus
        const vu = await jusque(() => page.evaluate(() => ({ avis: (window as any).__avis, image: (window as any).__image })), (x) => x.avis.length >= 2 && x.image >= x.avis[1].image + 10, 15000) as { avis: { image: number, largeur: number }[], image: number }
        const liste = vu.avis.map((x) => `image ${x.image} : ${x.largeur} px`).join(' ; ')
        assert.equal(vu.avis.length, 2, `la balise n'a que deux largeurs, celle du nombre brut puis sa place (${liste})`)
        assert.equal(vu.avis[1].image - vu.avis[0].image, 1, `la place est écrite à l'image qui suit l'avis de la boîte, ni plus tôt ni plus tard (${liste})`)
        const v = await mesure(page, 'f')
        assert.notEqual(v.minWidth, '', 'la place est écrite')
        tient('f', v)
        assert.ok(vu.avis[0].largeur < vu.avis[1].largeur - 0.05, `la première largeur est celle du nombre brut, plus étroite que la place (${liste})`)
        assert.ok(Math.abs(vu.avis[1].largeur - v.largeur) <= 0.05, `la seconde est la largeur finale, qui ne change plus (${v.largeur.toFixed(2)} px ; ${liste})`)
      }, 'mjs-cl-compte', 'a', false, true, true)
    })

    it('un nombre qui perd sa boîte (son paragraphe est caché), s\'allonge, puis la retrouve : l\'observateur d\'attente est réarmé, la place suit le nouveau nombre à l\'affichage', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const avant = await fini(page, 'a', '12-480')
        tient('a', avant)
        const montre = (visible: boolean) => page.evaluate((v: boolean) => { ;((document.querySelector('mjs-cl-compte') as any)._shadow.querySelector('.a') as any).closest('p').style.display = v ? '' : 'none' }, visible)
        // l'hôte s'était montré au micro-tâche qui suit la pose (l'observateur de la pose débranché) ; la balise perd sa boîte, son nombre s'allonge sans qu'on le voie
        await montre(false)
        await page.evaluate(() => { ;(((document.querySelector('mjs-cl-compte') as any)._shadow.querySelector('.a') as any).firstChild as any).nodeValue = '999999999' })
        const cache = await jusque(() => mesure(page, 'a'), (x) => x.texte === '999-999-999', 15000)
        assert.equal(cache.texte, '999-999-999', 'le compte est arrivé au bout pendant que la balise était cachée')
        // la boîte revient : la place est reprise pour le nouveau nombre
        await montre(true)
        const v = await jusque(() => mesure(page, 'a'), (x) => x.largeur > 0 && x.minWidth !== avant.minWidth, 8000)
        assert.notEqual(v.minWidth, avant.minWidth, 'la place est reprise à l\'affichage pour le nouveau nombre')
        tient('a', v)
        assert.ok(v.largeur > avant.largeur + 20, `la balise a grandi avec le nombre (${avant.largeur.toFixed(1)} → ${v.largeur.toFixed(1)} px)`)
      })
    })

    it(`posé au premier rendu : la place se mesure deux fois par compteur (la pose, puis le micro-tâche), et plus aucun observateur de taille ne reste en vie — développement`, async function () {
      if (!present) { this.skip(); return }
      await essai(MESURES_DEUX_FOIS, 'mjs-cl-mesures', 'm2', false, true)
    })

    it(`posé au premier rendu : la place se mesure deux fois par compteur (la pose, puis le micro-tâche), et plus aucun observateur de taille ne reste en vie — production`, async function () {
      if (!present) { this.skip(); return }
      await essai(MESURES_DEUX_FOIS, 'mjs-cl-mesures', 'm2', true, true)
    })

    it('posé au premier rendu dans un parent que la page observe : la place est prise avant la première image — le parent n\'a qu\'une largeur, aucune erreur « ResizeObserver loop » sur la fenêtre', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await fini(page, 'h', '12.480 €', 'mjs-cl-ancetre')
        await dort(300)
        const v = await mesure(page, 'h', 'mjs-cl-ancetre')
        tient('h', v)
        const vu = await page.evaluate(() => ({ erreurs: (window as any).__erreurs, avis: (window as any).__avisPage.parent }))
        assert.deepEqual(vu.erreurs, [], 'aucune erreur « ResizeObserver loop » sur la fenêtre')
        assert.equal(vu.avis.length, 1, `le parent n'a eu qu'une largeur sous les yeux de la page, jamais celle du nombre brut (${vu.avis.join(' → ')} px)`)
        assert.ok(Math.abs(vu.avis[0] - v.largeur) <= 0.5, `et c'est la largeur finale (${vu.avis[0]} px, la balise fait ${v.largeur.toFixed(1)} px)`)
      }, 'mjs-cl-ancetre', 'h')
    })

    it('posé dans une zone cachée puis montrée, dans un parent que la page observe : la place est écrite hors du rappel de l\'observateur de la balise — aucune erreur « ResizeObserver loop » sur la fenêtre, au plus une image à la largeur brute', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        // la zone est cachée pendant tout le décompte ; la page voit sa boîte naître avec l'affichage
        await dort(1800)
        const cache = await page.evaluate(() => ({ boite: ((document.querySelector('mjs-cl-ancetre') as any)._shadow.querySelector('.i') as any).getClientRects().length }))
        assert.equal(cache.boite, 0, 'la balise est posée mais sans boîte')
        await page.evaluate(() => { ;((document.querySelector('mjs-cl-ancetre') as any)._shadow.querySelector('.cache') as any).style.display = 'block' })
        await jusque(() => mesure(page, 'i', 'mjs-cl-ancetre'), (x) => x.largeur > 0 && x.texte === `12.480 €`)
        await dort(300)
        const w = await mesure(page, 'i', 'mjs-cl-ancetre')
        tient('i', w)
        const vu = await page.evaluate(() => ({ erreurs: (window as any).__erreurs, avis: (window as any).__avisPage.parent2 }))
        assert.deepEqual(vu.erreurs, [], 'aucune erreur « ResizeObserver loop » sur la fenêtre')
        assert.ok(vu.avis.length >= 1 && vu.avis.length <= 3, `la page a suivi son parent, une image à la largeur brute au plus (${vu.avis.join(' → ')} px)`)
        assert.ok(Math.abs(vu.avis[vu.avis.length - 1] - w.largeur) <= 0.5, `le dernier avis de la page donne la largeur finale du parent (${vu.avis.join(' → ')} px, la balise fait ${w.largeur.toFixed(1)} px)`)
        assert.ok(w.minWidth.length > 0, 'la place est écrite')
      }, 'mjs-cl-ancetre', 'h')
    })
  })
}
