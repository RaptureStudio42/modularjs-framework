// `*stagger`, les unités qui se VOIENT — Chromium, Firefox et WebKit réels (une vraie mise en page est nécessaire :
// pas de happy-dom) :
//   - `unit: line` : les lignes que le moteur de mise en page fait tomber, relues quand la balise s'étrécit ;
//   - `clip` : chaque unité est rognée par sa propre boîte — au départ elle est tout entière derrière son cache,
//     à la fin dedans ; l'enveloppe ne bouge pas le texte d'un pixel ; l'enfant, lui, est rogné par sa
//     découpe (un point sous la boîte ne touche plus l'enfant tant qu'il est caché) ;
//   - au repos d'une ligne : plus d'animation, plus de will-change, plus d'enveloppe, le texte où il était ;
//   - un enfant venu plus tard arrive seul ; au défilement : une variable d'avancée, aucune unité réécrite ;
//   - lettre et mot comme avant : une fois l'arrivée finie (au chargement, au clic, à la vue, au bout du défilement),
//     les styles calculés de tout ce que l'effet touche sont ceux que donne le fichier d'avant les variantes
//     (tests/fixtures/stagger-avant-les-variantes.mts), posé à sa place dans une seconde page ;
//   - « réduire les animations » : les enfants ne gardent ni marque ni variable, aucune fin d'animation ne venant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { poseDeuxImages } from './helpers/images-navigateur.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// le fichier d'effet d'avant les variantes, lu comme un texte
const REFERENCE = new URL('./fixtures/stagger-avant-les-variantes.mts', import.meta.url)

const TEXTE = 'Un paragraphe qui tient sur plusieurs lignes dans une boîte étroite, pour que la mise en page fasse tomber les mots où elle veut.'

const SOURCE = [
  '<section class="scene">',
  `  <p id="lignes" class="para" *stagger(unit: line, clip: true, opacity: 1, easing: linear, duration: 1000ms, step: 500ms, on: click)>${TEXTE}</p>`,
  `  <p id="libre" class="para" *stagger(unit: line, opacity: 1, on: click)>${TEXTE}</p>`,
  `  <p id="vite" class="para" *stagger(unit: line, clip: true, opacity: 1, duration: 120ms, step: 30ms, on: click)>${TEXTE}</p>`,
  '  <div id="cartes" class="grille" *stagger(unit: child, clip: true, opacity: 1, easing: linear, duration: 1000ms, step: 500ms, on: click)><div class="carte">Un</div><div class="carte">Deux</div><div class="carte">Trois</div></div>',
  '  <div id="vives" class="grille" *stagger(unit: child, opacity: 1, duration: 120ms, step: 30ms, on: click)><div class="carte">Un</div><div class="carte">Deux</div></div>',
  '  <div id="defile" class="defile"><div class="espace"></div><div id="suite" class="grille" *stagger(unit: child, on: scroll, opacity: 0.2)><div class="carte">Un</div><div class="carte">Deux</div><div class="carte">Trois</div></div><div class="espace"></div></div>',
  '  <div class="loin"></div>',
  '  <div id="attente" class="grille" *stagger(unit: child, duration: 400ms, step: 100ms, on: view)><div class="carte">Un</div><div class="carte">Deux</div><div class="carte">Trois</div></div>',
  '</section>',
  '<style>',
  '  .scene',
  '    display: block',
  '    width: 380px',
  '    padding: 8px',
  '    font: 20px/1.4 sans-serif',
  '  .para',
  '    margin: 0 0 16px',
  '    width: 280px',
  '  .grille',
  '    display: grid',
  '    grid-template-columns: repeat(3, 1fr)',
  '    gap: 10px',
  '    margin-bottom: 16px',
  '  .carte',
  '    padding: 30px 6px',
  '    background: #1f6feb',
  '    color: #fff',
  '    text-align: center',
  '  .defile',
  '    height: 220px',
  '    overflow: auto',
  '  .espace',
  '    height: 700px',
  '  .loin',
  '    height: 1600px',
  '</style>'
].join('\n')

// lettre et mot, tels que la balise les a toujours écrits : des arrivées de toutes les sortes (au chargement, au clic, à la
// vue, au défilement) ; le même texte joue dans deux pages, l'une avec le fichier d'aujourd'hui, l'autre avec celui d'avant
const AVANT = [
  '<p id="l1" class="t" *stagger(on: load)>Salut toi</p>',
  '<p id="m1" class="t" *stagger(unit: word, on: load)>un deux trois</p>',
  '<p id="l2" class="t" *stagger(style: zoom, order: center, on: load, duration: 200ms, step: 20ms)>Zoom centre</p>',
  '<p id="m2" class="t" *stagger(unit: word, style: rotate, order: left, delay: 50ms, opacity: .3, on: load, duration: 200ms)>Rotation des mots</p>',
  '<p id="l3" class="t" *stagger(direction: left, distance: 30, easing: linear, on: click, duration: 200ms, step: 20ms)>Au clic</p>',
  '<p id="m3" class="t" *stagger(unit: word, style: flip, on: click, duration: 200ms)>Basculer au clic</p>',
  '<div class="cale"></div>',
  '<p id="l4" class="t" *stagger(duration: 200ms, step: 20ms)>Par défaut, à la vue</p>',
  '<p id="m4" class="t" *stagger(unit: word, style: blur, duration: 200ms)>Mots à la vue</p>',
  '<div class="cale"></div>',
  '<p id="l5" class="t s" *stagger(on: scroll)>Lettres au défilement</p>',
  '<p id="m5" class="t s" *stagger(on: scroll, unit: word)>Mots au défilement de la page</p>',
  '<p id="l6" class="t s" *stagger(on: scroll, step: 30ms, easing: ease-in, style: zoom, order: center)>Pas et courbe écrits</p>',
  '<div class="cale"></div>',
  '<style>',
  '  :host',
  '    display: block',
  '  .t',
  '    width: 300px',
  '    margin: 0 0 40px',
  '    font: 22px/1.4 sans-serif',
  '  .s',
  '    margin-bottom: 400px',
  '  .cale',
  '    height: 1000px',
  '</style>'
].join('\n')

// « réduire les animations » : des enfants qui arrivent au chargement, au clic, à la vue
const CALME = [
  '<div id="charge" class="grille" *stagger(unit: child, opacity: 1, on: load)><div class="carte">Un</div><div class="carte">Deux</div><div class="carte">Trois</div></div>',
  '<div id="clic" class="grille" *stagger(unit: child, opacity: 1, on: click)><div class="carte">Un</div><div class="carte">Deux</div></div>',
  '<div class="loin"></div>',
  '<div id="vue" class="grille" *stagger(unit: child, opacity: 1, on: view)><div class="carte">Un</div><div class="carte">Deux</div></div>',
  '<style>',
  '  :host',
  '    display: block',
  '  .grille',
  '    display: grid',
  '    grid-template-columns: repeat(3, 1fr)',
  '    gap: 10px',
  '    width: 380px',
  '    margin-bottom: 16px',
  '  .carte',
  '    padding: 30px 6px',
  '    background: #1f6feb',
  '  .loin',
  '    height: 1600px',
  '</style>'
].join('\n')

// le parcours d'une page de la comparaison : les arrivées jouées l'une après l'autre ; après chacune, le relevé de tout
// ce que l'effet touche (balises, attributs, style, styles calculés, animations en cours, boîte)
const PARCOURS = async () => {
  const w      = window as any
  const racine = (document.querySelector('mjs-stagger-avant') as any)._shadow
  const t      = (id: string) => racine.querySelector('#' + id)
  const pause  = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
  const PROPS  = ['display', 'position', 'overflow', 'width', 'height', 'opacity', 'transform', 'translate', 'animationName', 'animationDuration', 'animationDelay', 'animationFillMode', 'animationPlayState', 'animationTimingFunction', 'animationIterationCount', 'animationDirection', 'willChange', 'filter', 'perspective', 'transformOrigin', 'whiteSpace', 'verticalAlign', 'visibility', 'color', 'webkitTextFillColor', 'pointerEvents', 'userSelect']
  const until = async (f: () => boolean) => {
    const debut = Date.now()
    while (!f() && Date.now() - debut < 8000) await pause(30)
  }
  // deux images dessinées (aide partagée, posée dans la page par `ouvre`) : WebKit ne recalcule le style d'une animation, et ne livre
  // un défilement, qu'en dessinant une image ; sous charge il n'en dessine plus pendant des secondes (2,5 s mesurées), et une lecture
  // faite entre-temps rend l'état de la dernière image (des lettres encore cachées, une avancée d'avant le défilement) quand
  // l'animation se dit déjà finie
  const deuxImages = () => w.deuxImages()
  // plus aucune arrivée en route, puis le temps que les écouteurs de fin d'animation passent
  const enCours = () => (Array.from(racine.querySelectorAll('[mjs-fx]')) as any[]).some((el) => el.getAnimations({ subtree: true }).some((a: any) => a.playState === 'running'))
  const fini = async () => {
    const debut = Date.now()
    // un repos qui dure : six relevés de suite sans animation en route (une page de WebKit sous charge crée les animations de l'arrivée après la marque `mjs-fx-play`, et un seul relevé voit alors un repos qui n'en est pas un)
    let calme = 0
    while (calme < 6 && Date.now() - debut < 10000) {
      calme = enCours() ? 0 : calme + 1
      await pause(40)
    }
    await pause(250)
    await deuxImages()
  }
  // l'avancée de chaque élément au défilement n'a plus bougé depuis deux lectures
  const stable = async () => {
    const lit = () => Array.from(racine.querySelectorAll('[mjs-fx-stagger-scroll]')).map((n: any) => n.style.getPropertyValue('--mjs-fx-stagger-p')).join('|')
    let avant = ''
    for (let i = 0; i < 40; i++) {
      await pause(100)
      await deuxImages()
      const a = lit()
      if (a === avant && i > 2) return
      avant = a
    }
  }
  const releve = () => {
    const out: any = {}
    for (const el of Array.from(racine.querySelectorAll('[mjs-fx]')) as any[]) {
      out[el.id] = ([el, ...Array.from(el.querySelectorAll('*'))] as any[]).map((n) => {
        const cs = getComputedStyle(n) as any
        const b  = n.getBoundingClientRect()
        const o: any = { tag: n.localName, attrs: n.getAttributeNames().sort().join(','), style: (n.getAttribute('style') ?? '').replace(/--xi:\s*\d+/g, '--xi:N').replace(/\s*--mjs-fx-stagger-p:[^;]*;?/g, ''), animations: n.getAnimations().length, boite: [b.x, b.y, b.width, b.height].map((v: number) => Math.round(v * 100) / 100).join(',') }
        for (const p of PROPS) o[p] = cs[p]
        // le délai d'une animation absente (une lettre dans un mot) ne sert à rien : il suivait l'avancée héritée, plus maintenant
        if (cs.animationName === 'none') o.animationDelay = '*'
        return o
      })
    }
    return out
  }
  // l'avancée au défilement : sur la balise dans le fichier d'avant les variantes, sur chaque lettre ou mot dans celui d'aujourd'hui
  const avance = (n: any) => n.style.getPropertyValue('--mjs-fx-stagger-p') || n.querySelector(n.getAttribute('mjs-fx-stagger-unit') === 'word' ? '[mjs-fx-word]' : '[mjs-fx-letter]')?.style.getPropertyValue('--mjs-fx-stagger-p') || ''
  // le haut du texte à `part` de la hauteur de l'écran
  const place = (id: string, part: number) => window.scrollTo(0, window.scrollY + t(id).getBoundingClientRect().top - part * innerHeight)
  const R: any = { connaitLeRepos: w.µ._mjs_fxDefs.stagger.css.includes('mjs-fx-stagger-rest') }
  await until(() => ['l1', 'm1', 'l2', 'm2'].every((id) => t(id).hasAttribute('mjs-fx-play')))
  await fini()
  R.charge = releve()
  t('l3').click()
  t('m3').click()
  await fini()
  R.clic = releve()
  for (const id of ['l4', 'm4']) {
    t(id).scrollIntoView({ block: 'center' })
    await until(() => t(id).hasAttribute('mjs-fx-play'))
  }
  await fini()
  R.vue = releve()
  place('m5', 0.5)
  await stable()
  R.milieu = releve()
  R.milieuAvance = ['l5', 'm5', 'l6'].map((id) => avance(t(id)))
  place('l6', 0.1)
  await stable()
  R.bout = releve()
  R.avancees = Array.from(racine.querySelectorAll('[mjs-fx-stagger-scroll]')).map(avance)
  return R
}

describe('*stagger — les unités, rognées et au repos (navigateurs réels)', function () {
  this.timeout(240000)
  let script      = ''
  let scriptAvant = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-stagger-unites-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'stagger-ecran.mjs'), SOURCE)
    writeFileSync(join(srcDir, 'stagger-avant.mjs'), AVANT)
    writeFileSync(join(srcDir, 'stagger-calme.mjs'), CALME)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const tries = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
    const effet = (f: string) => f.startsWith('mjs_fx_stagger-')
    const avant = readFileSync(REFERENCE, 'utf-8')
    assert.equal(tries.filter(effet).length, 1, 'le fichier de l\'effet est dans la page, une seule fois')
    const page  = (remplace?: string) => tries.map((f) => stripEsm(remplace !== undefined && effet(f) ? remplace : readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    script      = page()
    scriptAvant = page(avant)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let browser: any = null
      let page: any = null
      // l'écart permis entre un mot du calque (boîte en ligne) et le même mot du texte d'origine : sous Chromium et Firefox, moins d'un pixel et demi.
      // WebKit sous Linux donne aux mots du texte d'origine des largeurs entières (les avances des glyphes y sont arrondies) et à ceux du calque, des
      // boîtes en ligne, leur largeur fractionnaire : l'écart croît mot à mot sur la ligne (1,78 px au plus mesuré sur ce paragraphe de 20 px, l'interligne
      // n'y est pour rien : 0 en hauteur), un mot sauté ou une espace perdue en feraient dix fois plus
      const SEUIL = nom === 'webkit' ? 3 : 1.5

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
        page = await browser.newPage({ viewport: { width: 420, height: 900 } })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-stagger-ecran></mjs-stagger-ecran><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => {
          const sh = (document.querySelector('mjs-stagger-ecran') as any)?._shadow
          return !!sh?.querySelector('#suite[mjs-fx]') && !!sh.querySelector('#lignes[mjs-fx]') && !!sh.querySelector('#cartes[mjs-fx]')
        })
        await page.evaluate(() => {
          const w = window as any
          w.__r = () => (document.querySelector('mjs-stagger-ecran') as any)._shadow
          w.__t = (id: string) => w.__r().querySelector('#' + id)
          // les mots du texte d'origine (invisible) tels que la mise en page les pose : { x, w, y } au milieu de la ligne
          w.__mots = (id: string) => {
            const el    = w.__t(id)
            const noeud = Array.from(el.childNodes).find((n: any) => n.nodeType === 3) as any
            const out: any[] = []
            const re = /\S+/g
            let m: RegExpExecArray | null
            while ((m = re.exec(noeud.data))) {
              const r = document.createRange()
              r.setStart(noeud, m.index)
              r.setEnd(noeud, m.index + m[0].length)
              const b = r.getBoundingClientRect()
              out.push({ x: b.left, w: b.width, y: b.top + b.height / 2 })
            }
            return out
          }
          // les mots du calque, au même format (une boîte en ligne : milieu de sa hauteur)
          w.__calque = (id: string) => Array.from(w.__t(id).querySelectorAll('[mjs-fx-word]')).map((n: any) => {
            const b = n.getBoundingClientRect()
            return { x: b.left, w: b.width, y: b.top + b.height / 2, k: Number(n.style.getPropertyValue('--mjs-fx-stagger-k')) }
          })
          // fige les animations de l'unité, au progrès `p` de chacune (0 : avant, 1 : fini) ; rend le nombre figé
          w.__fige = (el: any, sel: string, p: number) => {
            let n = 0
            for (const u of Array.from(el.querySelectorAll(sel)) as any[]) {
              for (const a of u.getAnimations()) {
                const t = a.effect.getComputedTiming()
                a.pause()
                a.currentTime = t.delay + p * t.duration
                n++
              }
            }
            return n
          }
        })
      })

      after(async () => { if (browser) await browser.close() })

      it('line : les mots d\'une même ligne portent le même rang, un rang de plus à la ligne suivante — comme la mise en page les a posés', async () => {
        const r = await page.evaluate(() => {
          const w     = window as any
          const vrais = w.__mots('lignes')
          const lignes: number[] = []
          for (const m of vrais) if (!lignes.some((y) => Math.abs(y - m.y) < 4)) lignes.push(m.y)
          return { rangs: w.__calque('lignes').map((m: any) => m.k), lignes: vrais.map((m: any) => lignes.findIndex((y) => Math.abs(y - m.y) < 4)) }
        })
        assert.ok(Math.max(...r.lignes) >= 3, 'le texte tient sur plus de trois lignes : ' + JSON.stringify(r.lignes))
        assert.deepEqual(r.rangs, r.lignes, 'le rang de chaque mot est le numéro de sa ligne')
      })

      it('clip : l\'enveloppe ne déplace pas le texte d\'un pixel — chaque mot du calque est où le texte d\'origine l\'écrit', async () => {
        const r = await page.evaluate(() => {
          const w     = window as any
          const ecart = (a: any[], b: any[]) => Math.max(...a.map((m, i) => Math.max(Math.abs(m.x - b[i].x), Math.abs(m.w - b[i].w), Math.abs(m.y - b[i].y))))
          const vrais = w.__mots('lignes')
          return { n: w.__t('lignes').querySelectorAll('[mjs-fx-cut]').length, mots: vrais.length, ecart: ecart(w.__calque('lignes'), vrais), ecartSans: ecart(w.__calque('libre'), w.__mots('libre')) }
        })
        assert.equal(r.n, r.mots, 'un cache par mot')
        assert.ok(r.ecartSans < SEUIL, `témoin : sans clip le calque est à ${r.ecartSans} px du texte`)
        assert.ok(r.ecart < SEUIL, `avec clip le calque est à ${r.ecart} px du texte d'origine (le témoin : ${r.ecartSans})`)
      })

      it('clip : au départ chaque mot est tout entier derrière son cache, à la fin dedans — jamais visible hors de sa boîte', async () => {
        await page.evaluate(() => (window as any).__t('lignes').click())
        const r = await page.evaluate(() => {
          const w      = window as any
          const el     = w.__t('lignes')
          const sel    = '[mjs-fx-word]'
          const mesure = (p: number) => {
            w.__fige(el, sel, p)
            return Array.from(el.querySelectorAll('[mjs-fx-cut]')).map((c: any) => {
              const m = c.firstElementChild.getBoundingClientRect()
              const b = c.getBoundingClientRect()
              return { dehors: m.top >= b.bottom - 0.5 || m.bottom <= b.top + 0.5, dedans: m.top >= b.top - 0.5 && m.bottom <= b.bottom + 0.5 }
            })
          }
          const avant = mesure(0)
          const fin   = mesure(1)
          return { n: avant.length, toutDehors: avant.every((x: any) => x.dehors), toutDedans: fin.every((x: any) => x.dedans) }
        })
        assert.ok(r.n > 10, 'des caches posés : ' + r.n)
        assert.equal(r.toutDehors, true, 'au progrès 0, aucun mot n\'est dans sa boîte')
        assert.equal(r.toutDedans, true, 'au progrès 1, tous y sont')
      })

      it('clip : au progrès 0 la zone du paragraphe est vide — la même image que le calque caché (le cache rogne vraiment, pas seulement sa place)', async () => {
        const zone = await page.evaluate(() => {
          const w  = window as any
          const el = w.__t('lignes')
          el.click()
          w.__fige(el, '[mjs-fx-word]', 0)
          const b = el.getBoundingClientRect()
          return { x: Math.floor(b.left) - 4, y: Math.floor(b.top) - 4, width: Math.ceil(b.width) + 8, height: Math.ceil(b.height) + 60 }
        })
        const vide = await page.screenshot({ clip: zone })
        await page.evaluate(() => { (window as any).__t('lignes').querySelector('[mjs-fx-layer]').style.visibility = 'hidden' })
        const temoin = await page.screenshot({ clip: zone })
        await page.evaluate(() => {
          const w  = window as any
          const el = w.__t('lignes')
          el.querySelector('[mjs-fx-layer]').style.visibility = ''
          w.__fige(el, '[mjs-fx-word]', 1)
        })
        const plein = await page.screenshot({ clip: zone })
        assert.equal(vide.equals(temoin), true, 'rien ne dépasse des caches au progrès 0')
        assert.equal(plein.equals(temoin), false, 'témoin : au progrès 1 le texte se voit')
      })

      it('child + clip : l\'enfant est rogné par sa découpe — caché, un point de sa boîte ne le touche plus ; à mi-course, seule la part dans sa boîte le touche', async () => {
        const r = await page.evaluate(() => {
          const w     = window as any
          const el    = w.__t('cartes')
          const carte = el.firstElementChild
          const r0    = carte.getBoundingClientRect()
          el.click()
          const touche = (x: number, y: number) => {
            const e = w.__r().elementFromPoint(x, y)
            return e === carte || carte.contains(e)
          }
          const cx = r0.left + r0.width / 2
          const h  = r0.height
          w.__fige(el, ':scope > *', 0)
          const caches = touche(cx, r0.top + h / 2)
          w.__fige(el, ':scope > *', 0.5)
          const mi = { hautDeLaBoite: touche(cx, r0.top + 0.25 * h), basDeLaBoite: touche(cx, r0.top + 0.85 * h), sousLaBoite: touche(cx, r0.bottom + 0.3 * h) }
          w.__fige(el, ':scope > *', 1)
          const fini = touche(cx, r0.top + h / 2)
          return { caches, mi, fini, h }
        })
        assert.equal(r.caches, false, 'au progrès 0, rien de l\'enfant n\'est touchable dans sa boîte')
        assert.equal(r.mi.hautDeLaBoite, false, 'à mi-course le haut de la boîte est encore vide')
        assert.equal(r.mi.basDeLaBoite, true, 'à mi-course le bas de la boîte est rempli')
        assert.equal(r.mi.sousLaBoite, false, 'et rien ne dépasse sous la boîte : la découpe la tient')
        assert.equal(r.fini, true, 'à la fin l\'enfant est là')
      })

      it('line : la balise s\'étrécit — les lignes sont relues (un rang de plus), sans que l\'arrivée soit rejouée', async () => {
        const r = await page.evaluate(async () => {
          const w     = window as any
          const el    = w.__t('libre')
          const avant = Math.max(...w.__calque('libre').map((m: any) => m.k))
          const joue  = el.getAttribute('mjs-fx-play')
          el.style.width = '150px'
          await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 60))))
          const vrais = w.__mots('libre')
          const lignes: number[] = []
          for (const m of vrais) if (!lignes.some((y) => Math.abs(y - m.y) < 4)) lignes.push(m.y)
          const apres = w.__calque('libre').map((m: any) => m.k)
          return { avant, apres: Math.max(...apres), egal: JSON.stringify(apres) === JSON.stringify(vrais.map((m: any) => lignes.findIndex((y) => Math.abs(y - m.y) < 4))), joue: el.getAttribute('mjs-fx-play') === joue }
        })
        assert.ok(r.apres > r.avant, `plus de lignes à 150 px qu'à 280 px : ${r.avant} → ${r.apres}`)
        assert.equal(r.egal, true, 'les rangs suivent les lignes d\'après')
        assert.equal(r.joue, true, 'l\'arrivée n\'est pas rejouée')
      })

      it('au repos : plus d\'animation, plus de will-change, plus d\'enveloppe, le texte où il était ; l\'unité rejouée repart', async () => {
        const r = await page.evaluate(async () => {
          const w     = window as any
          const el    = w.__t('vite')
          const avant = w.__mots('vite')
          el.click()
          const jouee   = el.querySelectorAll('[mjs-fx-word]')[0].getAnimations().length
          const pendant = getComputedStyle(el.querySelectorAll('[mjs-fx-word]')[0]).willChange
          const debut   = Date.now()
          while (!el.hasAttribute('mjs-fx-stagger-rest') && Date.now() - debut < 5000) await new Promise((ok) => setTimeout(ok, 30))
          const mots  = Array.from(el.querySelectorAll('[mjs-fx-word]')) as any[]
          const ecart = Math.max(...w.__calque('vite').map((m: any, i: number) => Math.max(Math.abs(m.x - avant[i].x), Math.abs(m.y - avant[i].y))))
          const repos = {
            fini: el.hasAttribute('mjs-fx-stagger-rest'),
            animations: mots.reduce((n, u) => n + u.getAnimations().length, 0),
            willChange: Array.from(new Set(mots.map((u) => getComputedStyle(u).willChange))),
            caches: el.querySelectorAll('[mjs-fx-cut]').length,
            ecart
          }
          el.click()
          const rejoue = { caches: el.querySelectorAll('[mjs-fx-cut]').length, anim: el.querySelectorAll('[mjs-fx-word]')[0].getAnimations().length, repos: el.hasAttribute('mjs-fx-stagger-rest') }
          return { jouee, pendant, repos, rejoue }
        })
        assert.equal(r.jouee, 1, 'pendant l\'arrivée, une animation par mot')
        assert.match(r.pendant, /transform/, 'will-change posé pendant le mouvement')
        assert.equal(r.repos.fini, true, 'l\'arrivée finit et le repos se pose')
        assert.equal(r.repos.animations, 0, 'au repos plus aucune animation')
        assert.deepEqual(r.repos.willChange, ['auto'], 'au repos plus de will-change')
        assert.equal(r.repos.caches, 0, 'au repos plus d\'enveloppe')
        assert.ok(r.repos.ecart < SEUIL, `le texte n'a pas bougé de plus de ${r.repos.ecart} px`)
        assert.equal(r.rejoue.caches > 10, true, 'rejoué : les caches reviennent')
        assert.equal(r.rejoue.anim, 1, 'rejoué : les animations repartent')
        assert.equal(r.rejoue.repos, false, 'rejoué : le repos part')
      })

      it('child : au repos plus rien sur les enfants ; un enfant venu plus tard arrive seul, les autres ne rejouent pas', async () => {
        const r = await page.evaluate(async () => {
          const w  = window as any
          const el = w.__t('vives')
          el.click()
          const debut = Date.now()
          const reste = () => Array.from(el.children).filter((c: any) => c.hasAttribute('mjs-fx-child')).length
          while (reste() > 0 && Date.now() - debut < 5000) await new Promise((ok) => setTimeout(ok, 30))
          const repos = { marques: reste(), animations: el.getAnimations({ subtree: true }).length, willChange: Array.from(el.children).map((c: any) => getComputedStyle(c).willChange), style: Array.from(el.children).map((c: any) => c.getAttribute('style')) }
          const neuf  = document.createElement('div')
          neuf.className = 'carte'
          neuf.textContent = 'Trois'
          el.appendChild(neuf)
          await new Promise((ok) => setTimeout(ok, 40))
          const tard = { neuf: neuf.getAnimations().length, autres: Array.from(el.children).slice(0, 2).reduce((n: number, c: any) => n + c.getAnimations().length, 0) }
          return { repos, tard }
        })
        assert.equal(r.repos.marques, 0, 'les enfants sont démarqués')
        assert.equal(r.repos.animations, 0, 'plus aucune animation')
        assert.deepEqual(r.repos.willChange, ['auto', 'auto'], 'plus de will-change')
        assert.deepEqual(r.repos.style, [null, null], 'aucun style laissé sur les enfants')
        assert.equal(r.tard.neuf, 1, 'le nouvel enfant s\'anime')
        assert.equal(r.tard.autres, 0, 'les autres ne rejouent pas')
      })

      it('child : une animation rembobinée dans son attente (le pas change, un retour en arrière) ne finit pas l\'arrivée de l\'enfant — seule une vraie fin le rend naturel', async () => {
        const r = await page.evaluate(async () => {
          const w  = window as any
          const el = w.__t('cartes')
          el.click()
          await new Promise((ok) => setTimeout(ok, 60))
          const carte = el.children[1]
          const a     = carte.getAnimations()[0]
          // l'animation de la deuxième carte (500 ms d'attente) est mise en cours, puis ramenée avant son départ : elle dit
          // « animationend » sans l'avoir finie
          a.pause()
          a.currentTime = 700
          await new Promise((ok) => setTimeout(ok, 60))
          a.currentTime = 100
          await new Promise((ok) => setTimeout(ok, 120))
          const rembobinee = carte.hasAttribute('mjs-fx-child')
          const encore     = carte.getAnimations().length
          // puis la vraie fin : l'animation va au bout
          a.finish()
          await new Promise((ok) => setTimeout(ok, 120))
          return { rembobinee, encore, fini: carte.hasAttribute('mjs-fx-child') }
        })
        assert.equal(r.rembobinee, true, 'rembobinée avant son départ, la carte garde sa marque : elle n\'a pas fini')
        assert.equal(r.encore, 1, 'et son animation')
        assert.equal(r.fini, false, 'allée au bout, la carte redevient naturelle')
      })

      it('child, on: view : avant d\'être vus les enfants attendent à leur état de départ ; vus, ils arrivent l\'un après l\'autre', async () => {
        const r = await page.evaluate(async () => {
          const w       = window as any
          const el      = w.__t('attente')
          const enfants = Array.from(el.children) as any[]
          const avant   = { attend: el.hasAttribute('mjs-fx-wait'), opacites: enfants.map((c) => getComputedStyle(c).opacity), animations: enfants.map((c) => c.getAnimations().length) }
          el.scrollIntoView()
          const debut = Date.now()
          while (el.hasAttribute('mjs-fx-wait') && Date.now() - debut < 3000) await new Promise((ok) => setTimeout(ok, 20))
          const apres = { attend: el.hasAttribute('mjs-fx-wait'), animations: enfants.map((c) => c.getAnimations().length), delais: enfants.map((c) => c.getAnimations()[0].effect.getComputedTiming().delay) }
          return { avant, apres }
        })
        assert.equal(r.avant.attend, true, 'la balise attend d\'être vue')
        assert.deepEqual(r.avant.opacites, ['0', '0', '0'], 'les enfants attendent invisibles, à leur état de départ')
        assert.deepEqual(r.avant.animations, [0, 0, 0], 'rien ne tourne en attendant')
        assert.equal(r.apres.attend, false)
        assert.deepEqual(r.apres.animations, [1, 1, 1], 'vus, chaque enfant s\'anime')
        assert.deepEqual(r.apres.delais, [0, 100, 200], 'l\'un après l\'autre, au pas écrit')
      })

      it('child, line : le pas du thème l\'emporte sur le pas par défaut de l\'unité (90 ms, 130 ms) ; sans lui, c\'est celui de l\'unité', async () => {
        const r = await page.evaluate(async () => {
          const w      = window as any
          const delais = async (unite: string) => {
            const el = document.createElement(unite === 'child' ? 'div' : 'p')
            el.innerHTML = unite === 'child' ? '<p>a</p><p>b</p><p>c</p>' : 'un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize'
            el.style.width = '120px'
            document.body.appendChild(el)
            const off = w.µ._mjs_fx(null, el, 'stagger', { unit: unite, on: 'click' })
            el.click()
            await new Promise((ok) => setTimeout(ok, 30))
            const cibles = unite === 'child' ? Array.from(el.children) : Array.from(el.querySelectorAll('[mjs-fx-word]'))
            const d      = Array.from(new Set(cibles.map((c: any) => Math.round(c.getAnimations()[0].effect.getComputedTiming().delay)))).sort((a: number, b: number) => a - b)
            off()
            el.remove()
            return d
          }
          const sans = { child: await delais('child'), line: await delais('line') }
          document.documentElement.style.setProperty('--mjs-stagger-step', '70ms')
          try {
            return { sans, avec: { child: await delais('child'), line: await delais('line') } }
          }
          finally {
            document.documentElement.style.removeProperty('--mjs-stagger-step')
          }
        })
        assert.deepEqual(r.sans.child, [0, 90, 180], 'enfants : 90 ms')
        assert.deepEqual(r.sans.line.slice(0, 3), [0, 130, 260], 'lignes : 130 ms')
        assert.deepEqual(r.avec.child, [0, 70, 140], 'le thème : 70 ms')
        assert.deepEqual(r.avec.line.slice(0, 3), [0, 70, 140], 'le thème : 70 ms pour les lignes aussi')
      })

      it('on: scroll : l\'avancée est écrite sur chaque enfant, jamais sur la balise ; au bout les enfants sont naturels, en remontant ils reviennent', async () => {
        const r = await page.evaluate(async () => {
          const w     = window as any
          const zone  = w.__t('defile')
          const el    = w.__t('suite')
          const pause = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 50))))
          zone.scrollTop = 0
          await pause()
          // l'avancée de chaque enfant (la même pour tous), et ce que porte la balise
          const lit    = () => { const v = Array.from(el.children).map((c: any) => c.style.getPropertyValue('--mjs-fx-stagger-p')); return v.every((x: string) => x === v[0]) ? v[0] : 'divers : ' + v.join(' ') }
          const p0     = lit()
          const vus: string[] = []
          let balise = el.style.getPropertyValue('--mjs-fx-stagger-p')
          for (const y of [520, 560, 600]) {
            zone.scrollTop = y
            await pause()
            vus.push(lit())
            balise += el.style.getPropertyValue('--mjs-fx-stagger-p')
          }
          zone.scrollTop = 700
          await pause()
          const bout = { p: lit(), marques: Array.from(el.children).filter((c: any) => c.hasAttribute('mjs-fx-child')).length }
          zone.scrollTop = 0
          await pause()
          const retour = { p: lit(), marques: Array.from(el.children).filter((c: any) => c.hasAttribute('mjs-fx-child')).length }
          return { p0, vus, balise, bout, retour }
        })
        assert.equal(r.p0, '', 'avant l\'arrivée, rien n\'est écrit sur les enfants (la variable enregistrée vaut 0 sans écriture)')
        assert.ok(r.vus.every((x: string) => x !== '' && !isNaN(Number(x))) && new Set(r.vus).size > 1, 'l\'avancée suit le défilement : ' + r.vus.join(' '))
        assert.equal(r.balise, '', 'rien n\'est écrit sur la balise pendant le défilement')
        assert.equal(r.bout.p, '', 'au bout les enfants sont naturels : plus d\'avancée écrite')
        assert.equal(r.bout.marques, 0, 'au bout les enfants sont naturels')
        assert.equal(r.retour.p, '', 'revenus avant l\'arrivée, les enfants n\'ont plus rien d\'écrit')
        assert.equal(r.retour.marques, 3, 'en remontant les enfants reviennent à la cascade')
      })

      // une page neuve : le code donné, la balise du composant, des options de contexte (réduire les animations)
      const ouvre = async (code: string, tag: string, options: any = {}) => {
        const p = await browser.newPage({ viewport: { width: 420, height: 900 }, ...options })
        const erreurs: string[] = []
        p.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        await poseDeuxImages(p)
        await p.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${code}</script></body></html>` })
        })
        await p.goto('http://t.test/', { waitUntil: 'load' })
        await p.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx]'), tag)
        return { p, erreurs }
      }
      // un nombre dans un texte vaut son voisin à 0,05 près ; le reste doit être le même texte
      const NOMBRE = /-?\d+(\.\d+)?(e-?\d+)?/g
      const proche = (x: any, y: any) => {
        if (x === y) return true
        const nx = String(x).match(NOMBRE) ?? []
        const ny = String(y).match(NOMBRE) ?? []
        if (nx.length !== ny.length || nx.length === 0 || String(x).replace(NOMBRE, 'N') !== String(y).replace(NOMBRE, 'N')) return false
        return nx.every((v, i) => Math.abs(parseFloat(v) - parseFloat(ny[i])) < 0.05)
      }
      // ce qui diffère d'un relevé à l'autre, regroupé par état, balise de l'effet et propriété
      const ETATS  = ['charge', 'clic', 'vue', 'milieu', 'bout']
      const ecarts = (a: any, b: any) => {
        const sorties: Record<string, string> = {}
        const compte: Record<string, number>  = {}
        for (const etat of ETATS) {
          for (const id of Object.keys(a[etat])) {
            const x = a[etat][id]
            const y = b[etat][id]
            if (!y || x.length !== y.length) {
              sorties[`${etat} ${id}`] = `${x.length} nœuds → ${y ? y.length : 'rien'}`
              continue
            }
            for (let i = 0; i < x.length; i++) {
              for (const k of Object.keys(x[i])) {
                if (proche(x[i][k], y[i][k])) continue
                const cle = `${etat} ${id} ${k}`
                compte[cle] = (compte[cle] ?? 0) + 1
                if (!sorties[cle]) sorties[cle] = `nœud ${i} (${x[i].tag}) : ${JSON.stringify(x[i][k]).slice(0, 90)} → ${JSON.stringify(y[i][k]).slice(0, 90)}`
              }
            }
          }
        }
        return Object.keys(sorties).map((cle) => `${cle} (${compte[cle] ?? 1}) ${sorties[cle]}`)
      }

      it('lettre et mot comme avant : une fois l\'arrivée finie — au chargement, au clic, à la vue, au bout du défilement —, les styles calculés de tout ce que l\'effet touche sont ceux que donne le fichier d\'avant les variantes', async () => {
        const nouveau = await ouvre(script, 'mjs-stagger-avant')
        const ancien  = await ouvre(scriptAvant, 'mjs-stagger-avant')
        try {
          const a = await nouveau.p.evaluate(PARCOURS)
          const b = await ancien.p.evaluate(PARCOURS)
          assert.equal(a.connaitLeRepos, true, 'témoin : la première page joue le fichier d\'aujourd\'hui (il connaît le repos)')
          assert.equal(b.connaitLeRepos, false, 'témoin : la seconde page joue le fichier d\'avant')
          assert.deepEqual(nouveau.erreurs.concat(ancien.erreurs), [], 'aucune erreur de page')
          const compares = ETATS.reduce((n, etat) => n + Object.keys(a[etat]).reduce((m, id) => m + a[etat][id].length, 0), 0)
          assert.ok(compares > 700, `de quoi comparer : ${compares} nœuds relevés`)
          // le défilement est bien allé jusqu'au bout pour l'un et mi-chemin pour l'autre : des avancées différentes, les mêmes dans les deux pages
          assert.deepEqual(a.avancees, b.avancees, 'les deux pages ont la même avancée au défilement')
          assert.deepEqual(a.avancees, ['1', '1', '1'], 'au bout du défilement les trois avancées sont à 1')
          const mi = (x: any) => x.milieuAvance
          assert.equal(mi(a)[0], '1', 'à mi-parcours le premier est fini')
          assert.ok(Number(mi(a)[1]) > 0 && Number(mi(a)[1]) < 1, 'et le deuxième est en route : ' + mi(a)[1])
          assert.ok(Number(mi(a)[2]) < 0.2, 'et le troisième est à peine commencé : ' + mi(a)[2])
          assert.deepEqual(ecarts(a, b), [], 'les styles calculés ne diffèrent en rien de ceux du fichier d\'avant')
        }
        finally {
          await nouveau.p.close()
          await ancien.p.close()
        }
      })

      it('« réduire les animations », child : les enfants redeviennent naturels dès que l\'arrivée est jouée — ni marque ni variable laissées (au chargement, au clic, à la vue), pas plus sur un enfant venu plus tard', async () => {
        const calme = await ouvre(script, 'mjs-stagger-calme', { reducedMotion: 'reduce' })
        try {
          const r = await calme.p.evaluate(async () => {
            const racine = (document.querySelector('mjs-stagger-calme') as any)._shadow
            const t      = (id: string) => racine.querySelector('#' + id)
            const pause  = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
            // ce qui reste sur les enfants de l'auteur : marques de l'effet, styles en ligne
            const reste  = (el: any) => ({ marques: Array.from(el.children).filter((c: any) => c.hasAttribute('mjs-fx-child')).length, styles: Array.from(el.children).filter((c: any) => c.getAttribute('style') !== null).length })
            await pause(400)
            const charge    = reste(t('charge'))
            const avantClic = reste(t('clic'))
            t('clic').click()
            await pause(300)
            const clic = reste(t('clic'))
            t('clic').click()
            await pause(300)
            const reclic = reste(t('clic'))
            const neuf = document.createElement('div')
            neuf.className = 'carte'
            t('clic').appendChild(neuf)
            await pause(200)
            const tard = { marque: neuf.hasAttribute('mjs-fx-child'), style: neuf.getAttribute('style'), autres: reste(t('clic')) }
            t('vue').scrollIntoView()
            await pause(800)
            const vue = reste(t('vue'))
            return { calme: matchMedia('(prefers-reduced-motion: reduce)').matches, charge, avantClic, clic, reclic, tard, vue, animations: (Array.from(racine.querySelectorAll('[mjs-fx]')) as any[]).reduce((n, el) => n + el.getAnimations({ subtree: true }).length, 0) }
          })
          assert.equal(r.calme, true, 'témoin : le navigateur demande bien moins d\'animations')
          assert.equal(r.animations, 0, 'témoin : aucune animation ne tourne, aucune fin ne viendra')
          assert.deepEqual(r.avantClic, { marques: 2, styles: 2 }, 'témoin : avant l\'arrivée jouée, les enfants attendent leur rang')
          assert.deepEqual(r.charge, { marques: 0, styles: 0 }, 'au chargement : aucune marque ni style laissés')
          assert.deepEqual(r.clic, { marques: 0, styles: 0 }, 'au clic : de même')
          assert.deepEqual(r.reclic, { marques: 0, styles: 0 }, 'au second clic : de même')
          assert.deepEqual(r.tard, { marque: false, style: null, autres: { marques: 0, styles: 0 } }, 'l\'enfant venu plus tard n\'est pas marqué, les autres restent naturels')
          assert.deepEqual(r.vue, { marques: 0, styles: 0 }, 'à la vue : de même')
        }
        finally {
          await calme.p.close()
        }
      })
    })
  }
})
