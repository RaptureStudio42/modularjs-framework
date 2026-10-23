// *fluid dans un Chromium réel (WebGL en logiciel : lent, mais juste) : l'encre se voit après des
// mouvements de souris, la boucle ne demande plus d'image une fois l'encre effacée et repart au geste
// suivant, le retrait ne laisse rien (ni toile, ni contexte, ni écouteur), chaque réglage suivi par
// `set` agit sans reposer l'effet, `where: text` ne montre l'encre que dans les lettres — qui sont
// celles du texte à moins d'un pixel — et « réduire les animations » fige quelques taches. Une vraie
// mise en page et une vraie toile sont nécessaires : pas de happy-dom. Les captures sont déposées dans
// le dossier nommé par la variable d'environnement CAPTURES_EFFETS, quand elle existe.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

// le navigateur essayé : Chromium, ou Firefox ou WebKit avec NAVIGATEUR=firefox ou NAVIGATEUR=webkit (WebGL en logiciel dans les trois)
const NAVIGATEUR = process.env.NAVIGATEUR === 'firefox' ? 'firefox' : process.env.NAVIGATEUR === 'webkit' ? 'webkit' : 'chromium'
const NOM       = { chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit' }[NAVIGATEUR]

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright: any = await import('playwright')
    return existsSync(playwright[NAVIGATEUR].executablePath())
  } catch {
    return false
  }
}

const BOITE = 'width: 400px\n  height: 240px\n  margin: 0\n  color: #fff\n  background: #000'
const RAPIDE = 'quality: 96, detail: 16, glow: 0, rays: 0'
const GROS = 'font: 900 150px sans-serif\n  width: 500px\n  margin: 0\n  line-height: 1.1'
// les séances à horloge tenue : l'encre est blanche et ne s'efface pas, le halo et les rayons sont éteints ; quatre balises par réglage éprouvé,
// toutes visibles à la fois : a (une valeur posée), b (l'autre valeur posée), c (la valeur de a, puis celle de b dans set), d (le défaut)
const SEANCE = `quality: 128, detail: 16, glow: 0, rays: 0, fade: 0, colors: ['#fff']`
const quatre = (fixe: string, a: string, b: string) => ['a', 'b', 'c', 'd'].map((k) => `<div class="${k}" *fluid(${SEANCE}${fixe ? ', ' + fixe : ''}${k === 'd' ? '' : ', ' + (k === 'b' ? b : a)})></div>\n`).join('') + '<style>\n.a, .b, .c, .d\n  float: left\n  width: 360px\n  height: 220px\n  margin: 0\n  background: #000\n</style>\n'

// les scènes de physique : l'encre est blanche et ne s'efface pas (la masse d'encre est alors celle de la matière transportée), sans halo ni rayons, au
// défaut de finesse du mouvement ; une balise par scène, toutes visibles à la fois
const ENCRE        = `quality: 128, detail: 32, glow: 0, rays: 0, fade: 0, colors: ['#fff']`
const scene        = (classe: string, reglage = '') => `<div class="s ${classe}" *fluid(${ENCRE}${reglage ? ', ' + reglage : ''})></div>\n`
const STYLE_SCENES = '<style>\n.s\n  float: left\n  width: 360px\n  height: 220px\n  margin: 0\n  background: #000\n</style>\n'
const TEINTES      = ['#333333', '#8b0000', '#1a1a40', '#ff3d81']

// les écritures de `background` essayées sur une balise à fond rgb(200, 30, 30) : [classe, écriture dans l'effet, couleur vue au repos]. Une couleur à barre
// oblique s'écrit telle quelle ou entre guillemets : les deux passent
const ECRITURES_FOND: Array<[string, string, number[]]> = [
  ['rgba', 'rgba(0, 0, 0, .5)', [100, 15, 15]],
  ['barre', 'rgb(0 0 0 / 50%)', [100, 15, 15]],
  ['hsla', 'hsla(210, 50%, 20%, .4)', [130, 38, 49]],
  ['hslbarre', '\'hsl(210 50% 20% / .4)\'', [130, 38, 49]],
  ['hex8', '#00000080', [100, 15, 15]],
  ['hex4', '#0008', [93, 14, 14]],
  ['nom', 'rebeccapurple', [102, 51, 153]],
  ['transp', 'transparent', [200, 30, 30]],
  ['variable', 'var(--teinte)', [100, 15, 15]]
]
// la feuille de la page de la suite des couleurs : <html> porte la couleur du texte (hérité par les titres), la bascule du thème la change
const CSS_SUITE = 'html{color:rgb(20,60,140)}html[data-mjs-theme="sombre"]{color:rgb(250,220,90)}body.sombre{color:rgb(200,40,40)}body.lent{transition:color 1.2s linear}html[data-theme="sombre"]{color:rgb(250,220,90)}body[data-autre]{color:rgb(200,40,40)}@media (prefers-color-scheme:dark){html.suit{color:rgb(250,220,90)}}'

const SOURCES: Record<string, string> = {
  'fl-boite.mjs':   `<div class="f" *fluid(${RAPIDE}, fade: 0.4)></div>\n<style>\n.f\n  ${BOITE}\n</style>\n`,
  'fl-vite.mjs':    `<div class="f" *fluid(${RAPIDE}, fade: 10)></div>\n<style>\n.f\n  ${BOITE}\n</style>\n`,
  'fl-clic.mjs':    `<div class="f" *fluid(${RAPIDE}, fade: 0.4, on: click)></div>\n<style>\n.f\n  ${BOITE}\n</style>\n`,
  'fl-halo.mjs':    `<div class="f" *fluid(quality: 96, detail: 16, fade: 0.4)></div>\n<style>\n.f\n  ${BOITE}\n</style>\n`,
  'fl-texte.mjs':   `<h1 class="f" *fluid(where: text, ${RAPIDE}, fade: 0.4)>MMM</h1>\n<style>\n.f\n  ${GROS}\n  color: #00ff00\n</style>\n`,
  'fl-auto.mjs':    `<div class="f" *fluid(${RAPIDE}, auto: true)></div>\n<style>\n.f\n  ${BOITE}\n</style>\n`,
  'fl-bas.mjs':     `<div class="f" *fluid(${RAPIDE}, auto: true)></div>\n<style>\n.f\n  ${BOITE}\n  margin-top: 4000px\n</style>\n`,
  'fl-bas-texte.mjs': `<h1 class="f" *fluid(where: text, ${RAPIDE}, auto: true)>MMM</h1>\n<style>\n.f\n  ${GROS}\n  color: #fff\n  margin-top: 4000px\n</style>\n`,
  'fl-calme.mjs':   `<div class="f" *fluid(${RAPIDE})></div>\n<style>\n.f\n  ${BOITE}\n</style>\n`,
  'fl-retrait.mjs': `<script>\n$on = true\n</script>\n{if $on}\n<div class="f" *fluid(${RAPIDE})></div>\n<h1 class="g" *fluid(where: text, ${RAPIDE})>MMM</h1>\n{end}\n<button class="t" @click={$on = !$on}>t</button>\n<style>\n.f\n  ${BOITE}\n.g\n  ${GROS}\n</style>\n`,
  'fl-enfant.mjs':  '<p class="x">Bonjour</p>\n<style>\n.x\n  margin: 0\n  color: #fff\n  font: 700 40px sans-serif\n</style>\n',
  'fl-compose.mjs': `<mjs-fl-enfant class="f" *fluid(where: text, ${RAPIDE}, fade: 0.4, colors: ['#00ff00'])></mjs-fl-enfant>\n<style>\n.f\n  display: block\n  width: 400px\n  height: 240px\n  margin: 0\n</style>\n`,
  'fl-var.mjs':     `<div class="f" *fluid(${RAPIDE}, fade: 0.4, colors: ['var(--accent)'])></div>\n<div class="g" *fluid(${RAPIDE}, fade: 0.4)></div>\n<div class="h" *fluid(${RAPIDE}, fade: 0.4, colors: ['var(--absente)'])></div>\n<style>\n.f, .g, .h\n  ${BOITE}\n.f\n  --accent: #00ff00\n.g\n  --autre: #0000ff\n</style>\n`,
  'fl-typo.mjs':    `<h1 class="f" *fluid(where: text, ${RAPIDE}, fade: 0.4)>MMM</h1>\n<div class="sp"></div>\n<style>\n.f\n  ${GROS}\n  color: #00ff00\n.sp\n  height: 3000px\n</style>\n`,
  'fl-nombreux.mjs': `${Array.from({ length: 18 }, () => '<div class="f" *fluid(quality: 64, detail: 16, glow: 0, rays: 0, auto: true)></div>\n').join('')}<style>\n.f\n  display: inline-block\n  width: 150px\n  height: 90px\n  margin: 4px\n  vertical-align: top\n  background: #000\n</style>\n`,
  'fl-defile.mjs':  `<div class="f" *fluid(${RAPIDE}, fade: 0.4)></div>\n<style>\n.f\n  ${BOITE}\n  height: 400px\n  margin-top: 600px\n  margin-bottom: 1500px\n</style>\n`,
  'fl-nu.mjs':      `<div class="f"></div>\n<style>\n.f\n  ${BOITE}\n</style>\n`,
  'fl-s-size.mjs':     quatre('strength: 0, curl: 0, friction: 10', 'size: 0.05', 'size: 2'),
  'fl-s-strength.mjs': quatre('curl: 0, friction: 1', 'strength: 0', 'strength: 5000'),
  'fl-s-friction.mjs': quatre('curl: 0', 'friction: 10', 'friction: 0'),
  'fl-s-curl.mjs':     quatre('friction: 3', 'curl: 50', 'curl: 0'),
  'fl-s-rayons.mjs':   `<div class="f" *fluid(quality: 128, detail: 16, glow: 0, rays: 0, fade: 0, friction: 10, colors: ['#ff8800'])></div>\n<style>\n.f\n  width: 360px\n  height: 220px\n  margin: 0\n  background: #000\n</style>\n`,
  'fl-phys.mjs':    [scene('pousse'), scene('arc', 'curl: 0'), scene('arcmax', 'curl: 50'), scene('arcfrot', 'curl: 0, friction: 8'), scene('arcfort', 'curl: 0, strength: 5000'), scene('jetd'), scene('jetb')].join('') + STYLE_SCENES,
  'fl-dose.mjs':    [scene('vite'), scene('lent'), scene('dense')].join('') + STYLE_SCENES,
  'fl-resol.mjs':   [['d', ''], ['a', ', resolution: 1'], ['b', ', resolution: 4'], ['c', ', resolution: 0.5']].map(([c, r]) => `<div class="s ${c}" *fluid(quality: 96, detail: 16, glow: 0, rays: 0${r})></div>\n`).join('') + STYLE_SCENES,
  'fl-fond.mjs':    `<div class="s temoin"></div>\n<div class="s sans" *fluid(${RAPIDE})></div>\n<div class="s ecrit" *fluid(${RAPIDE}, background: '#220000')></div>\n<div class="s transp" *fluid(${RAPIDE}, background: transparent)></div>\n<h1 class="lettres ecrit2" *fluid(where: text, ${RAPIDE}, background: '#220000')>MMM</h1>\n<h1 class="lettres demi2" *fluid(where: text, ${RAPIDE}, background: rgba(0, 0, 0, .5))>MMM</h1>\n<h1 class="lettres sans2" *fluid(where: text, ${RAPIDE})>MMM</h1>\n<style>\n.s\n  float: left\n  width: 180px\n  height: 100px\n  margin: 0\n.temoin, .sans, .ecrit, .transp\n  background: rgb(200, 30, 30)\n.lettres\n  clear: both\n  width: 500px\n  margin: 0\n  font: 900 150px/1.1 sans-serif\n  color: #fff\n</style>\n`,
  'fl-transparent.mjs': `<div class="s temoin"></div>\n<div class="s vif" *fluid(${RAPIDE}, colors: ['#00ffff'])></div>\n<div class="s vif2" *fluid(${RAPIDE}, colors: ['#00ffff'])></div>\n<div class="s defaut" *fluid></div>\n<h1 class="lettres" *fluid(where: text, ${RAPIDE}, colors: ['#00ffff'])>MMM</h1>\n<h1 class="lettres lettres2" *fluid(where: text, ${RAPIDE}, colors: ['#00ffff'])>MMM</h1>\n<style>\n.s\n  float: left\n  width: 360px\n  height: 220px\n  margin: 0\n.vif, .vif2, .defaut, .temoin, .lettres\n  background: rgb(200, 30, 30)\n.lettres\n  clear: both\n  width: 500px\n  margin: 0\n  font: 900 150px/1.1 sans-serif\n  color: #fff\n</style>\n`,
  'fl-fond-var.mjs': `<script>\n$bg = ''\n</script>\n<div class="s dyn" *fluid(${RAPIDE}, background: $bg)></div>\n<div class="s theme" *fluid(${RAPIDE}, background: $bg)></div>\n<h1 class="lettres" *fluid(where: text, ${RAPIDE}, background: $bg)>MMM</h1>\n<button class="rouge" @click={$bg = '#220000'}>r</button>\n<button class="vide" @click={$bg = ''}>v</button>\n<button class="transp" @click={$bg = 'transparent'}>t</button>\n<button class="demi" @click={$bg = 'rgba(0, 0, 0, .5)'}>d</button>\n<style>\n.s\n  float: left\n  width: 360px\n  height: 220px\n  margin: 0\n.theme\n  --mjs-fluid-background: #003300\n.lettres\n  clear: both\n  width: 500px\n  margin: 0\n  font: 900 150px/1.1 sans-serif\n  color: #fff\n</style>\n`,
  'fl-texte-fond.mjs': `<h1 class="f" *fluid(where: text, quality: 96, detail: 16, glow: 0, rays: 0)></h1>\n<style>\n.f\n  ${GROS}\n  color: #000\n</style>\n`.replace('></h1>', '>MMM</h1>'),
  'fl-defaut.mjs':  '<div class="s defaut" *fluid></div>\n' + STYLE_SCENES,
  'fl-hasard.mjs':  '<div class="s defaut" *fluid(fade: 10, friction: 10, glow: 0, rays: 0)></div>\n' + STYLE_SCENES,
  'fl-blanc.mjs':   '<div class="s vite" *fluid></div>\n<div class="s lent" *fluid></div>\n' + STYLE_SCENES,
  'fl-lisse.mjs':   [0, 2, 10, 50].map((c) => scene('c' + c, 'curl: ' + c)).join('') + STYLE_SCENES,
  'fl-teinte.mjs':  [...TEINTES, TEINTES[2]].map((c, i) => `<div class="s t${i}" *fluid(${ENCRE.replace(`'#fff'`, `'${c}'`)})></div>\n`).join('') + STYLE_SCENES,
  'fl-bas-texte-seul.mjs': `<h1 class="f" *fluid(where: text, ${RAPIDE}, fade: 0.4)>MMM</h1>\n<style>\n.f\n  ${GROS}\n  color: #00ff00\n  margin-top: 4000px\n</style>\n`,
  'fl-deux.mjs':    `<div class="s deux" *fluid(${ENCRE.replace(`'#fff'`, `'#ff0000', '#0000ff'`)})></div>\n` + STYLE_SCENES,
  'fl-s-halo.mjs':  [['nul', 'glow: 0'], ['doux', 'glow: 0.4'], ['fort', 'glow: 1.6']].map(([c, g]) => `<div class="s ${c}" *fluid(quality: 128, detail: 16, rays: 0, fade: 0, friction: 10, colors: ['#ff8800'], ${g})></div>\n`).join('') + STYLE_SCENES,
  'fl-lettres.mjs': `<h1 class="m clair" *fluid(where: text, ${RAPIDE})>MMM</h1>\n<h1 class="m sombre" *fluid(where: text, ${RAPIDE})>MMM</h1>\n<h1 class="m mots" *fluid(where: text, ${RAPIDE})>AB <span class="autre">CD</span></h1>\n<h1 class="m trans" *fluid(where: text, ${RAPIDE})>MMM</h1>\n<h1 class="m fin" *fluid(where: text, ${RAPIDE})>MMM</h1>\n<style>\n.m\n  font: 900 90px/1.1 sans-serif\n  width: 360px\n  margin: 0\n.clair, .fin\n  background: rgb(235, 232, 220)\n  color: rgb(20, 60, 140)\n.sombre\n  background: rgb(12, 14, 30)\n  color: rgb(250, 220, 90)\n.mots\n  background: rgb(235, 232, 220)\n  color: rgb(30, 90, 30)\n.autre\n  color: rgb(200, 40, 40)\n.trans\n  background: rgb(0, 0, 0)\n  color: rgba(255, 255, 255, .5)\n</style>\n`,
  'fl-suite.mjs':   `<h1 class="m theme" *fluid(where: text, ${RAPIDE})>MMM</h1>\n<h1 class="m classe" *fluid(where: text, ${RAPIDE})>MMM</h1>\n<h1 class="m desc" *fluid(where: text, ${RAPIDE})><span class="s">MMM</span></h1>\n<h1 class="m trans" *fluid(where: text, ${RAPIDE})>MMM</h1>\n<h1 class="m dt" *fluid(where: text, ${RAPIDE})><span class="s2">MMM</span></h1>\n<h1 class="m ecrit" *fluid(where: text, ${RAPIDE}, background: rgba(10, 20, 30, .25))>MMM</h1>\n<div class="sp"></div>\n<style>\n.m\n  font: 900 70px/1.1 sans-serif\n  width: 300px\n  margin: 0\n  background: rgb(235, 232, 220)\n.classe\n  color: rgb(20, 60, 140)\n.classe.b\n  color: rgb(200, 40, 40)\n.desc .s\n  color: rgb(20, 60, 140)\n.desc .s.b\n  color: rgb(200, 40, 40)\n.trans\n  color: rgb(20, 60, 140)\n  transition: color 3s linear\n.trans.b\n  color: rgb(250, 220, 90)\n.dt .s2\n  color: rgb(20, 60, 140)\n  transition: color 3s linear\n.dt .s2.b\n  color: rgb(250, 220, 90)\n.sp\n  height: 3000px\n</style>\n`,
  'fl-fond-contexte.mjs': `<h1 class="m courant" *fluid(where: text, ${RAPIDE}, background: currentColor)>MMM</h1>\n<h1 class="m clair" *fluid(where: text, ${RAPIDE}, background: light-dark(rgb(17, 17, 17), rgb(238, 238, 238)))>MMM</h1>\n<h1 class="m melange" *fluid(where: text, ${RAPIDE}, background: 'color-mix(in srgb, rgb(200, 0, 0) 50%, rgb(0, 0, 200))')>MMM</h1>\n<h1 class="m variable" *fluid(where: text, ${RAPIDE}, background: var(--teinte))>MMM</h1>\n<h1 class="m degrade" *fluid(where: text, ${RAPIDE}, background: 'linear-gradient(90deg, red, blue)')>MMM</h1>\n<h1 class="m image" *fluid(where: text, ${RAPIDE}, background: 'url(x.gif)')>MMM</h1>\n<h1 class="m jumelle" *fluid(where: text, ${RAPIDE}, background: 'linear-gradient(90deg, red, blue)')>MMM</h1>\n<style>\n.m\n  font: 900 90px/1.1 sans-serif\n  width: 360px\n  margin: 0\n  background: rgb(235, 232, 220)\n  color: rgb(20, 60, 140)\n  color-scheme: light dark\n.clair\n  background: rgb(128, 128, 128)\n.variable\n  --teinte: rgb(0, 120, 60)\n.degrade, .image, .jumelle\n  color: rgb(30, 90, 30)\n</style>\n`,
  'fl-fond-transition.mjs': `<h1 class="m fige" *fluid(where: text, ${RAPIDE}, background: rgba(10, 20, 30, .25))>MMM</h1>\n<style>\n.m\n  font: 900 70px/1.1 sans-serif\n  width: 300px\n  margin: 0\n  background: rgb(235, 232, 220)\n  color: rgb(20, 60, 140)\n  transition: color 3s linear\n.m.b\n  color: rgb(250, 220, 90)\n</style>\n`,
  'fl-fond-forme.mjs': `<div class="s temoin"></div>\n<div class="s sans" *fluid(${RAPIDE})></div>\n${ECRITURES_FOND.map(([c, e]) => `<div class="s ${c}" *fluid(${RAPIDE}, background: ${e})></div>\n`).join('')}<style>\n.s\n  float: left\n  width: 150px\n  height: 90px\n  margin: 0\n  background: rgb(200, 30, 30)\n.variable\n  --teinte: rgba(0, 0, 0, .5)\n</style>\n`,
  'fl-fond-texte.mjs': `<h1 class="m ecrit" *fluid(where: text, ${RAPIDE}, background: rgba(10, 20, 30, .25))>MMM</h1>\n<h1 class="m ecrit2" *fluid(where: text, ${RAPIDE}, background: rgba(10, 20, 30, .25))>MMM</h1>\n<h1 class="m sans" *fluid(where: text, ${RAPIDE})>MMM</h1>\n<style>\n.m\n  font: 900 150px/1.1 sans-serif\n  width: 500px\n  margin: 0\n  background: rgb(235, 232, 220)\n  color: #fff\n</style>\n`,
  'fl-fond-faux.mjs': `<script>\n$bg = 'rien-non-plus'\n</script>\n<div class="s a" *fluid(${RAPIDE}, background: pas-une-couleur)></div>\n<div class="s b" *fluid(${RAPIDE}, background: pas-une-couleur)></div>\n<div class="s c" *fluid(${RAPIDE}, background: $bg)></div>\n<h1 class="lettres d" *fluid(where: text, ${RAPIDE}, background: ceci-non-plus)>MMM</h1>\n<button class="x" @click={$bg = 'autre-faux'}>x</button>\n<button class="y" @click={$bg = 'rien-non-plus'}>y</button>\n<button class="z" @click={$bg = 'rgba(0, 0, 0, .5)'}>z</button>\n<style>\n.s\n  float: left\n  width: 150px\n  height: 90px\n  margin: 0\n  background: rgb(200, 30, 30)\n.lettres\n  clear: both\n  width: 500px\n  margin: 0\n  font: 900 150px/1.1 sans-serif\n  color: #fff\n  background: rgb(200, 30, 30)\n</style>\n`,
  'fl-masque.mjs':  '<h1 class="m">Voyez <span class="p">la lune</span> briller très fort</h1>\n<style>\n.m\n  font: 700 56px serif\n  letter-spacing: 2px\n  width: 520px\n  margin: 0\n  color: #000\n  background: #fff\n.p\n  font: italic 900 80px sans-serif\n</style>\n',
}

describe(`*fluid (${NOM} réel)`, function () {
  this.timeout(240000)
  let script = ''
  let present = false
  let browser: any = null
  const dossier = process.env.CAPTURES_EFFETS || ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log(`  ℹ️  ${NAVIGATEUR} non installé, tests sautés. Activer : \`npx playwright install ${NAVIGATEUR}\``)
      return
    }
    const root   = mjsTmp('effets-fluid-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    if (dossier) mkdirSync(dossier, { recursive: true })
    const pw: any = await import('playwright')
    browser = await pw[NAVIGATEUR].launch(NAVIGATEUR === 'chromium' ? { args: ['--no-sandbox', '--enable-unsafe-swiftshader'] } : {})
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // une page : les images d'animation demandées, les contextes WebGL créés et les écouteurs vivants sont comptés dès le départ
  async function ouvre(tag: string, options: { calme?: boolean, dpr?: number, econome?: boolean, webgl1?: boolean, tenue?: boolean, css?: string, html?: string } = {}) {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: options.dpr ?? 1 })
    if (options.calme) await page.emulateMedia({ reducedMotion: 'reduce' })
    const erreurs: string[] = []
    const avertissements: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    page.on('console', (m: any) => {
      if (m.type() === 'error') erreurs.push(m.text())
      if (m.type() === 'warning' && m.text().includes('*fluid')) avertissements.push(m.text())
    })
    await page.addInitScript((sans2: boolean) => {
      const w: any = window
      w.__sans2 = sans2
      w.__raf = 0
      // les lectures de style calculé : leur nombre, et la date de la première qui suit une marque posée par le test
      w.__styles = 0
      w.__marque = null
      w.__apres = null
      const vraiStyle = w.getComputedStyle.bind(w)
      w.getComputedStyle = (...a: any[]) => {
        w.__styles++
        if (w.__marque !== null && w.__apres === null) w.__apres = performance.now()
        return vraiStyle(...a)
      }
      // l'horloge des images : celle du navigateur, ou (`__manuel`) celle du test, qui l'avance de soixante images par seconde
      // avec `__avance(n)` — une séance qui ne dépend ni de la vitesse de la machine ni de la cadence des évènements
      const vrai = w.requestAnimationFrame.bind(w)
      const vraiAnnule = w.cancelAnimationFrame.bind(w)
      const attente = new Map<number, any>()
      let numero = 1e9
      w.__manuel = false
      w.__temps = 0
      w.requestAnimationFrame = (f: any) => {
        w.__raf++
        if (!w.__manuel) return vrai(f)
        attente.set(++numero, f)
        return numero
      }
      w.cancelAnimationFrame = (id: number) => { if (!attente.delete(id)) vraiAnnule(id) }
      w.__vide = () => attente.clear()
      w.__avance = (n: number) => {
        for (let i = 0; i < n && attente.size; i++) {
          w.__temps += 1000 / 60
          const rappels = [...attente.values()]
          attente.clear()
          for (const f of rappels) f(w.__temps)
        }
        return attente.size
      }
      // les observateurs vivants (posés et pas encore déconnectés), par sorte
      w.__obs = {}
      for (const nom of ['IntersectionObserver', 'ResizeObserver', 'MutationObserver']) {
        const Vrai = w[nom]
        const vivants = new Set<any>()
        w.__obs[nom] = vivants
        w[nom] = class extends Vrai {
          observe(...a: any[]) { vivants.add(this); return super.observe(...a) }
          disconnect() { vivants.delete(this); return super.disconnect() }
        }
      }
      // un navigateur qui n'a plus de contexte WebGL à donner : `getContext` rend null (et les refus sont comptés)
      w.__plein = false
      w.__refus = 0
      // les dessins de la simulation : chaque appel de `drawArrays` d'un contexte WebGL (une image d'effet en fait une vingtaine)
      w.__dessins = 0
      for (const nom of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
        const proto = (w as any)[nom]?.prototype
        const vrai = proto?.drawArrays
        if (proto && vrai) proto.drawArrays = function (this: any, ...a: any[]) { w.__dessins++; return vrai.apply(this, a) }
      }
      w.__gl = []
      w.__textures = []
      for (const nom of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
        const proto = (w as any)[nom]?.prototype
        const vrai = proto?.texImage2D
        if (proto && vrai) proto.texImage2D = function (this: any, ...a: any[]) { if (a.length === 9 && a[3] > 4) w.__textures.push([a[3], a[4]]); return vrai.apply(this, a) }
      }
      const ouvrir = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: any, type: string, ...rest: any[]) {
        // un navigateur qui ne connaît que WebGL1 : le contexte WebGL2 est refusé
        if (w.__sans2 && type === 'webgl2') return null
        if (w.__plein && /webgl/.test(type)) { w.__refus++; return null }
        const c = (ouvrir as any).call(this, type, ...rest)
        if (c && /webgl/.test(type) && !w.__gl.includes(c)) w.__gl.push(c)
        return c
      } as any
      const vivants = new Map<any, Array<{ type: string, fn: any, cap: boolean }>>()
      const cap = (o: any) => typeof o === 'object' && o ? !!o.capture : !!o
      const ajoute = EventTarget.prototype.addEventListener
      EventTarget.prototype.addEventListener = function (this: any, type: string, fn: any, opt?: any) {
        if (!vivants.has(this)) vivants.set(this, [])
        vivants.get(this)!.push({ type, fn, cap: cap(opt) })
        return ajoute.call(this, type, fn, opt)
      }
      const retire = EventTarget.prototype.removeEventListener
      EventTarget.prototype.removeEventListener = function (this: any, type: string, fn: any, opt?: any) {
        const liste = vivants.get(this)
        const i = liste ? liste.findIndex((x) => x.type === type && x.fn === fn && x.cap === cap(opt)) : -1
        if (i >= 0) liste!.splice(i, 1)
        return retire.call(this, type, fn, opt)
      }
      w.__ecouteurs = (cible: any) => (vivants.get(cible) || []).map((x) => x.type)
      w.__cibles = vivants
      // une scène scriptée sur l'effet de la balise `el`, à horloge tenue : le pointeur entre en `plan.depart`, s'y pose, puis suit `plan.pas` à raison d'un point et
      // d'une image à chaque fois ; ensuite l'horloge avance jusqu'à chaque instant de `plan.lectures` (en images depuis le dernier point) et la toile est lue : masse
      // d'encre (la composante la plus vive de chaque point, de 0 à 1), centre, rayon quadratique, angle et distance moyenne autour de `plan.centre`, grain (ce qui
      // dépasse la moyenne glissante sur 9 points, rapporté à l'énergie de la carte), mouvement depuis la lecture précédente et teintes
      w.__jouer = (el: any, plan: any) => {
        w.__manuel = true
        if (plan.reglage) w.µ._mjs_fxSet(el, 'fluid', plan.reglage, null)
        const r = el.getBoundingClientRect()
        const evt = (type: string, p: number[]) => el.dispatchEvent(new PointerEvent(type, { clientX: r.left + p[0], clientY: r.top + p[1], isPrimary: true, bubbles: type === 'pointermove' }))
        const lis = () => {
          const c = el.querySelector('canvas[mjs-fx-layer]')
          const gl = w.__gl.find((x: any) => x.canvas === c)
          const px = new Uint8Array(c.width * c.height * 4)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
          const L  = c.width
          const Ht = c.height
          const d  = new Float32Array(L * Ht)
          for (let y = 0; y < Ht; y++) {
            const rang = (Ht - 1 - y) * L * 4
            for (let x = 0; x < L; x++) { const i = rang + x * 4; d[y * L + x] = Math.max(px[i], px[i + 1], px[i + 2]) / 255 }
          }
          return { px, d, L, Ht }
        }
        const grain = (d: Float32Array, L: number, Ht: number) => {
          const h = new Float32Array(L * Ht)
          const v = new Float32Array(L * Ht)
          for (let y = 0; y < Ht; y++) for (let x = 0; x < L; x++) { let s = 0, n = 0; for (let k = -4; k <= 4; k++) { if (x + k >= 0 && x + k < L) { s += d[y * L + x + k]; n++ } } h[y * L + x] = s / n }
          for (let y = 0; y < Ht; y++) for (let x = 0; x < L; x++) { let s = 0, n = 0; for (let k = -4; k <= 4; k++) { if (y + k >= 0 && y + k < Ht) { s += h[(y + k) * L + x]; n++ } } v[y * L + x] = s / n }
          let e = 0, t = 0
          for (let i = 0; i < d.length; i++) { const u = d[i] - v[i]; e += u * u; t += d[i] * d[i] }
          return t ? e / t : 0
        }
        const mesure = (carte: any, f: number, avant: any) => {
          const { px, d, L, Ht } = carte
          let m = 0, sx = 0, sy = 0
          for (let y = 0; y < Ht; y++) for (let x = 0; x < L; x++) { const v = d[y * L + x]; if (v) { m += v; sx += v * (x + 0.5); sy += v * (y + 0.5) } }
          const cx = m ? sx / m : 0
          const cy = m ? sy / m : 0
          let rg = 0, rad = 0, bouge = 0, avmasse = 0
          for (let y = 0; y < Ht; y++) for (let x = 0; x < L; x++) {
            const i = y * L + x
            const v = d[i]
            if (v) { rg += v * ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2); if (plan.centre) rad += v * Math.hypot(x + 0.5 - plan.centre[0], y + 0.5 - plan.centre[1]) }
            if (avant) { bouge += Math.abs(v - avant.d[i]); avmasse += avant.d[i] }
          }
          let lum = 0, haut = 0, vus = 0, satur = 0
          for (let i = 0; i < px.length; i += 4) {
            const mx = Math.max(px[i], px[i + 1], px[i + 2])
            lum += mx / 255
            if (mx > haut) haut = mx
            if (mx > 30) { vus++; satur += (mx - Math.min(px[i], px[i + 1], px[i + 2])) / mx }
          }
          const maxs = new Uint8Array(px.length / 4)
          for (let i = 0; i < px.length; i += 4) maxs[i / 4] = Math.max(px[i], px[i + 1], px[i + 2])
          maxs.sort()
          const o: any = { f, mediane: maxs[maxs.length >> 1], lum, haut, couvert: vus / (px.length / 4), sat: vus ? satur / vus : 0, masse: m, cx, cy, rg: m ? Math.sqrt(rg / m) : 0, grain: grain(d, L, Ht), mouvement: avant ? bouge / Math.max(1, avmasse) : 0 }
          if (plan.centre && m) { o.angle = Math.atan2(cy - plan.centre[1], cx - plan.centre[0]); o.rayon = rad / m }
          if (plan.teintes) {
            const canaux: number[][] = [[], [], []]
            let haut = 0
            for (let i = 0; i < px.length; i += 4) { const mx = Math.max(px[i], px[i + 1], px[i + 2]); if (mx > 6) { for (let c = 0; c < 3; c++) canaux[c].push(px[i + c]); if (mx > haut) haut = mx } }
            const p99 = (a: number[]) => { const t = [...a].sort((x, y) => x - y); return t.length ? t[Math.min(t.length - 1, Math.floor(t.length * 0.99))] : 0 }
            const cur = [0, 0, 0]
            let nc = 0
            for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) >= 0.9 * haut) { cur[0] += px[i]; cur[1] += px[i + 1]; cur[2] += px[i + 2]; nc++ }
            o.teinte = { max: canaux.map((a) => Math.max(0, ...a)), p99: canaux.map(p99), coeur: cur.map((v) => nc ? v / nc : 0), points: canaux[0].length }
          }
          return o
        }
        evt('pointerenter', plan.depart)
        evt('pointermove', plan.depart)
        for (let i = 0; i < plan.pas.length; i++) {
          // `plan.change` = [pas, réglage] : le réglage est mis (comme le ferait une variable) avant ce pas
          if (plan.change && plan.change[0] === i) w.µ._mjs_fxSet(el, 'fluid', plan.change[1], null)
          evt('pointermove', plan.pas[i])
          if ((i + 1) % (plan.groupe || 1) === 0) w.__avance(1)
        }
        const out: any[] = []
        let fait = 0
        let prec: any = null
        for (const f of plan.lectures) {
          w.__avance(f - fait)
          fait = f
          const carte = lis()
          out.push(mesure(carte, f, prec))
          prec = carte
        }
        // `plan.rappel` : l'image en attente (le rappel de la dernière image) passe à l'horloge réelle, car certains WebKit ne montrent une image qu'avec la suivante
        if (plan.rappel) {
          for (const f of attente.values()) vrai(f)
          attente.clear()
        }
        else w.__vide()
        w.__manuel = false
        // l'angle déroulé : la somme des écarts successifs, chacun ramené entre -π et π
        let cumul = 0
        for (let i = 0; i < out.length; i++) {
          if (out[i].angle === undefined) continue
          if (i > 0) { let dlt = out[i].angle - out[i - 1].angle; while (dlt > Math.PI) dlt -= 2 * Math.PI; while (dlt < -Math.PI) dlt += 2 * Math.PI; cumul += dlt }
          out[i].tour = cumul
        }
        return out
      }
    }, !!options.webgl1)
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html${options.html ?? ''}><head><meta charset="utf-8"><style>html,body{margin:0;background:#f00}${options.css ?? ''}</style></head><body><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    // le composant arrive après la page, effets économes éteints : la mesure des images du moteur ne compte pas parmi les nôtres
    await page.evaluate(([t, econome, tenue]: [string, boolean, boolean]) => {
      const w: any = window
      w.µ._fxConf = { lite: 'off' }
      if (econome) w.µ._mjs_fxLite = true
      // l'horloge des images tenue dès la pose : le test avance lui-même chaque image, dès la première
      if (tenue) w.__manuel = true
      document.body.insertAdjacentHTML('beforeend', `<${t}></${t}>`)
    }, [tag, !!options.econome, !!options.tenue])
    await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.f, .m, .a, .s'), tag)
    return { page, erreurs, avertissements }
  }

  const SEL = '.f, .m'
  // la boîte de l'effet dans la page (amenée à l'écran)
  const rect = (page: any, tag: string, sel = SEL) => page.evaluate(([t, s]: [string, string]) => {
    const b: any = (document.querySelector(t) as any)._shadow.querySelector(s)
    b.scrollIntoView({ block: 'start' })
    const r = b.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }, [tag, sel])
  const photo = async (page: any, r: any, nom = '') => {
    const png = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.width, height: r.height } })
    if (dossier && nom) writeFileSync(join(dossier, `fluid-${nom}.png`), png)
    return png.toString('base64')
  }
  // les pixels d'une capture : du fond (noirs : les balises des scènes ont un fond noir), rouges (la page), verts, autres — et le premier pixel
  const lit = (page: any, b64: string) => page.evaluate(async (b: string) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b
    await img.decode()
    const cv = document.createElement('canvas')
    cv.width = img.width; cv.height = img.height
    const c = cv.getContext('2d') as CanvasRenderingContext2D
    c.drawImage(img, 0, 0)
    const d = c.getImageData(0, 0, cv.width, cv.height).data
    let noir = 0, rouge = 0, vert = 0, vif = 0, autres = 0
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], bl = d[i + 2]
      if (r < 16 && g < 16 && bl < 16) noir++
      else if (r > 240 && g < 15 && bl < 15) rouge++
      else if (g > 240 && r < 15 && bl < 15) vert++
      else autres++
      if (Math.max(r, g, bl) > 50) vif++
    }
    // les pixels dont le vert domine nettement le rouge et le bleu (l'encre verte sur le noir)
    let encreVerte = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 40 && d[i + 1] > d[i] + 30 && d[i + 1] > d[i + 2] + 30) encreVerte++
    let encreBleue = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 40 && d[i + 2] > d[i] + 30 && d[i + 2] > d[i + 1] + 30) encreBleue++
    return { total: d.length / 4, noir, rouge, vert, vif, autres, encreVerte, encreBleue, coin: [d[0], d[1], d[2]] }
  }, b64)
  // le nombre de points et le centre de tout ce qui n'est pas la couleur de la page (les lettres vues à travers le masque)
  const centre = (page: any, b64: string) => page.evaluate(async (b: string) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b
    await img.decode()
    const cv = document.createElement('canvas')
    cv.width = img.width; cv.height = img.height
    const c = cv.getContext('2d') as CanvasRenderingContext2D
    c.drawImage(img, 0, 0)
    const d = c.getImageData(0, 0, cv.width, cv.height).data
    let n = 0, sx = 0, sy = 0
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4
      if (d[i] > 240 && d[i + 1] < 15 && d[i + 2] < 15) continue
      n++; sx += x; sy += y
    }
    return { n, x: n ? sx / n : 0, y: n ? sy / n : 0 }
  }, b64)
  // un geste de souris sur la boîte : une boucle qui la traverse
  const geste = async (page: any, r: any, tours = 1) => {
    const cx = r.x + r.width / 2
    const cy = r.y + r.height / 2
    await page.mouse.move(r.x + 12, cy)
    for (let i = 0; i <= 28 * tours; i++) {
      const a = i / 28 * Math.PI * 2
      await page.mouse.move(cx + Math.cos(a) * r.width * 0.36, cy + Math.sin(a) * r.height * 0.34)
      await page.waitForTimeout(8)
    }
  }
  const raf = (page: any) => page.evaluate(() => (window as any).__raf)
  // les contextes WebGL vivants (celui de l'essai de prise en charge est rendu aussitôt)
  const vivants = (page: any) => page.evaluate(() => (window as any).__gl.filter((g: any) => !g.isContextLost()).length)
  // la boucle demande-t-elle encore des images ? deux relevés distants de `ms`
  const calme = async (page: any, ms = 700) => {
    const a = await raf(page)
    await page.waitForTimeout(ms)
    return (await raf(page)) === a
  }
  // attend (au plus `max` ms) que `ok(stats)` soit vrai pour la boîte
  const jusqua = async (page: any, r: any, ok: (p: any) => boolean, max = 30000) => {
    const fin = Date.now() + max
    let p = await lit(page, await photo(page, r))
    while (!ok(p) && Date.now() < fin) {
      await page.waitForTimeout(250)
      p = await lit(page, await photo(page, r))
    }
    return p
  }
  const nonUni = (p: any) => p.vif > 400
  // la couleur que l'écran montre d'une fenêtre de la balise `classe` ([gauche, haut, droite, bas], en parts de sa largeur et de sa hauteur) : la valeur médiane
  // de chaque canal, et le nombre de points qui s'écartent de plus de deux niveaux de la couleur `ref`
  const couleurEcran = async (page: any, tag: string, classe: string, fenetre: number[] = [0, 0, 1, 1], ref: number[] = [200, 30, 30], nom = '') => {
    const r = await rect(page, tag, '.' + classe)
    const b64 = await photo(page, r, nom)
    return page.evaluate(async ([b, f, ref]: [string, number[], number[]]) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width; cv.height = img.height
      const c = cv.getContext('2d') as CanvasRenderingContext2D
      c.drawImage(img, 0, 0)
      const x0 = Math.round(f[0] * cv.width), y0 = Math.round(f[1] * cv.height)
      const d = c.getImageData(x0, y0, Math.round(f[2] * cv.width) - x0, Math.round(f[3] * cv.height) - y0).data
      const canaux: number[][] = [[], [], []]
      const largeur = Math.round(f[2] * cv.width) - x0
      let hors = 0
      let premier: number[] | null = null
      for (let i = 0; i < d.length; i += 4) {
        for (let k = 0; k < 3; k++) canaux[k].push(d[i + k])
        if (Math.abs(d[i] - ref[0]) > 2 || Math.abs(d[i + 1] - ref[1]) > 2 || Math.abs(d[i + 2] - ref[2]) > 2) {
          hors++
          if (!premier) premier = [(i / 4) % largeur, Math.floor(i / 4 / largeur), d[i], d[i + 1], d[i + 2]]
        }
      }
      const med = (a: number[]) => { a.sort((x, y) => x - y); return a[a.length >> 1] }
      return { rgb: [med(canaux[0]), med(canaux[1]), med(canaux[2])], hors, total: d.length / 4, premier }
    }, [b64, fenetre, ref])
  }
  const proche = (a: number[], b: number[], tol: number) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol)
  // les lettres de la balise `classe` : les points qui s'écartent du `fond` de plus de 60 niveaux (tous canaux ensemble), sur une fenêtre ([gauche, haut, droite, bas] en
  // parts de la balise) : leur nombre, leur couleur médiane et, pour chaque couleur de `refs`, combien sont à moins de 6 niveaux d'elle
  const lettresCouleur = async (page: any, tag: string, classe: string, fond: number[], fenetre: number[] = [0, 0, 1, 1], nom = '', refs: number[][] = []) => {
    const r = await rect(page, tag, '.' + classe)
    const b64 = await photo(page, r, nom)
    return page.evaluate(async ([b, f, fd, rf]: [string, number[], number[], number[][]]) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width; cv.height = img.height
      const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      c.drawImage(img, 0, 0)
      const x0 = Math.round(f[0] * cv.width), y0 = Math.round(f[1] * cv.height)
      const d = c.getImageData(x0, y0, Math.round(f[2] * cv.width) - x0, Math.round(f[3] * cv.height) - y0).data
      const canaux: number[][] = [[], [], []]
      const proches = rf.map(() => 0)
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - fd[0]) + Math.abs(d[i + 1] - fd[1]) + Math.abs(d[i + 2] - fd[2]) <= 60) continue
        for (let k = 0; k < 3; k++) canaux[k].push(d[i + k])
        rf.forEach((q, j) => { if (Math.abs(d[i] - q[0]) <= 6 && Math.abs(d[i + 1] - q[1]) <= 6 && Math.abs(d[i + 2] - q[2]) <= 6) proches[j]++ })
      }
      const med = (a: number[]) => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : -1 }
      return { n: canaux[0].length, rgb: [med(canaux[0]), med(canaux[1]), med(canaux[2])], proches }
    }, [b64, fenetre, fond, refs])
  }
  // attend (au plus `max` ms) que les lettres de la balise `classe` aient la couleur `vers` ; rend la dernière mesure
  const jusquaLettres = async (page: any, tag: string, classe: string, fond: number[], vers: number[], nom = '', max = 8000) => {
    const fin = Date.now() + max
    let m = await lettresCouleur(page, tag, classe, fond)
    while (!(m.n > 1000 && proche(m.rgb, vers, 3)) && Date.now() < fin) {
      await page.waitForTimeout(150)
      m = await lettresCouleur(page, tag, classe, fond)
    }
    if (nom) await lettresCouleur(page, tag, classe, fond, undefined, nom)
    return m
  }

  it('boîte : au fond sombre au départ, de l\'encre après des mouvements de souris, sans erreur', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-boite')
    try {
      const r = await rect(page, 'mjs-fl-boite')
      const avant = await lit(page, await photo(page, r, 'boite-avant'))
      assert.equal(avant.noir, avant.total, `la boîte a le fond sombre et uni : ${avant.noir} / ${avant.total}`)
      assert.equal(await vivants(page), 0, 'aucun contexte avant le premier geste')
      await geste(page, r)
      const apres = await lit(page, await photo(page, r, 'boite-apres'))
      assert.ok(nonUni(apres), `de l'encre : ${apres.vif} pixels vifs`)
      // une petite boîte (400 × 240) : le tour de la souris et son voile en couvrent plus de la moitié ; une boîte inondée n'aurait plus aucun point noir
      assert.ok(apres.noir > apres.total * 0.15, 'le fond reste sombre autour de l\'encre')
      assert.equal(await vivants(page), 1, 'un seul contexte')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('boucle : zéro image demandée une fois l\'encre effacée, elle repart au geste suivant', async function () {
    if (!present) { this.skip(); return }
    const { page } = await ouvre('mjs-fl-vite')
    try {
      const r = await rect(page, 'mjs-fl-vite')
      assert.ok(await calme(page, 500), 'rien ne tourne avant le premier geste')
      await geste(page, r)
      assert.ok(!(await calme(page, 300)), 'la boucle tourne pendant que l\'encre vit')
      // l'encre s'efface (fade 10), puis la boucle s'arrête d'elle-même
      const fin = Date.now() + 60000
      let seul = false
      while (!seul && Date.now() < fin) seul = await calme(page, 700)
      assert.ok(seul, 'la boucle a fini par s\'arrêter')
      assert.ok(await calme(page, 1800), 'toujours aucune image demandée, 1,8 s plus tard')
      // et aucun dessin non plus : une minuterie qui redessinerait sans demander d'image passerait le test des images
      const dessins = () => page.evaluate(() => (window as any).__dessins)
      const d0 = await dessins()
      await page.waitForTimeout(600)
      assert.equal(await dessins(), d0, 'au repos, aucun dessin en 600 ms')
      const p = await lit(page, await photo(page, r))
      assert.ok(p.vif < 100, `l'encre est effacée : ${p.vif} pixels vifs`)
      await geste(page, r)
      assert.ok(!(await calme(page, 300)), 'un nouveau geste relance la boucle')
    } finally {
      await page.close()
    }
  })

  it('« click » : sans bouton enfoncé la souris ne brasse rien ; bouton enfoncé, oui', async function () {
    if (!present) { this.skip(); return }
    const { page } = await ouvre('mjs-fl-clic')
    try {
      const r = await rect(page, 'mjs-fl-clic')
      await geste(page, r)
      const sans = await lit(page, await photo(page, r))
      assert.equal(sans.noir, sans.total, 'rien sans bouton')
      assert.equal(await vivants(page), 0)
      await page.mouse.move(r.x + 40, r.y + r.height / 2)
      await page.mouse.down()
      await geste(page, r)
      await page.mouse.up()
      const avec = await lit(page, await photo(page, r, 'clic'))
      assert.ok(nonUni(avec), `de l'encre bouton enfoncé : ${avec.vif}`)
    } finally {
      await page.close()
    }
  })

  it('le halo et les rayons : les passes se posent, l\'encre se voit, sans erreur ; à zéro, elles s\'arrêtent', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-halo')
    try {
      const r = await rect(page, 'mjs-fl-halo')
      await geste(page, r)
      const p = await lit(page, await photo(page, r, 'halo'))
      assert.ok(nonUni(p), `de l'encre avec halo et rayons : ${p.vif}`)
      await page.evaluate(() => {
        const el = (document.querySelector('mjs-fl-halo') as any)._shadow.querySelector('.f')
        const µ = (window as any).µ
        µ._mjs_fxSet(el, 'fluid', { glow: 0, rays: 0 }, null)
      })
      await geste(page, r)
      const q = await lit(page, await photo(page, r, 'sans-halo'))
      assert.ok(nonUni(q), 'toujours de l\'encre sans halo ni rayons')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('WebGL1 seul (textures demi-flottantes) : l\'encre se voit, avec le halo et les rayons', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-halo', { webgl1: true })
    try {
      const r = await rect(page, 'mjs-fl-halo')
      await geste(page, r)
      const p = await lit(page, await photo(page, r, 'webgl1'))
      assert.ok(nonUni(p), `de l'encre en WebGL1 : ${p.vif}`)
      const types = await page.evaluate(() => (window as any).__gl.map((g: any) => g instanceof (window as any).WebGL2RenderingContext ? 2 : 1))
      assert.ok(types.length >= 2 && types.every((t: number) => t === 1), `que du WebGL1 : ${types}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('off.set : colors, size, strength, fade, friction, curl, glow, rays, auto — suivis sans reposer l\'effet', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-boite')
    try {
      const r = await rect(page, 'mjs-fl-boite')
      await geste(page, r)
      const etat = () => page.evaluate(() => {
        const el = (document.querySelector('mjs-fl-boite') as any)._shadow.querySelector('.f')
        const w: any = window
        w.__off = w.__off || el._mjs_fxOff.fluid
        w.__cv = w.__cv || el.querySelector('canvas')
        return { memeEffet: el._mjs_fxOff.fluid === w.__off, memeToile: el.querySelector('canvas') === w.__cv, contextes: w.__gl.filter((g: any) => !g.isContextLost()).length }
      })
      await etat()
      const poser = (d: any) => page.evaluate((x: any) => {
        const el = (document.querySelector('mjs-fl-boite') as any)._shadow.querySelector('.f')
        ;(window as any).µ._mjs_fxSet(el, 'fluid', x, null)
      }, d)
      for (const d of [{ size: 1.2 }, { strength: 3000 }, { friction: 3 }, { curl: 20 }, { glow: 1.5 }, { rays: 0.9 }, { glow: 0 }, { rays: 0 }]) {
        await poser(d)
        const e = await etat()
        assert.ok(e.memeEffet && e.memeToile, `${Object.keys(d)[0]} : l'effet a été reposé`)
        assert.equal(e.contextes, 1, `${Object.keys(d)[0]} : un autre contexte`)
      }
      // colors : les gestes qui suivent sont verts
      await poser({ colors: ['#00ff00'] })
      // fade : plus rapide, la boucle (qui durait 17 s de temps simulé) s'arrête vite
      await poser({ fade: 10 })
      let e = await etat()
      assert.ok(e.memeEffet && e.memeToile, 'colors / fade : l\'effet a été reposé')
      const fin = Date.now() + 90000
      let seul = false
      while (!seul && Date.now() < fin) seul = await calme(page, 700)
      assert.ok(seul, 'fade 10 : la boucle s\'arrête, elle durait bien plus longtemps avec 0.4')
      await poser({ fade: 0.4 })
      await geste(page, r)
      const vert = await lit(page, await photo(page, r, 'colors-vert'))
      assert.ok(vert.encreVerte > 300, `l'encre est verte : ${vert.encreVerte} pixels`)
      assert.ok(vert.encreVerte > vert.vif * 0.7, `presque que du vert : ${vert.encreVerte} / ${vert.vif}`)
      // auto : le fluide bouge seul, sans souris
      await page.mouse.move(790, 590)
      await poser({ auto: false })
      await jusqua(page, r, (p) => p.vif < 100, 90000)
      await poser({ auto: true })
      const seule = await jusqua(page, r, nonUni, 60000)
      assert.ok(nonUni(seule), `auto : de l'encre sans souris : ${seule.vif}`)
      e = await etat()
      assert.ok(e.memeEffet && e.memeToile && e.contextes === 1)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : l\'encre n\'est que dans les lettres, le reste est à la couleur de la page ; le texte reste du texte', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-texte')
    try {
      await page.waitForFunction(() => (document.querySelector('mjs-fl-texte') as any)._shadow.querySelector('.f').hasAttribute('mjs-fx-fluid-text'))
      const r = await rect(page, 'mjs-fl-texte')
      const avant = await lit(page, await photo(page, r, 'texte-avant'))
      assert.ok(avant.vert > 3000, `les lettres au fond vert : ${avant.vert}`)
      assert.ok(avant.rouge > 20000, `le reste à la couleur de la page : ${avant.rouge}`)
      assert.deepEqual(avant.coin, [255, 0, 0], 'un pixel hors des lettres a la couleur de la page')
      assert.ok((avant.vert + avant.rouge) / avant.total > 0.93, `lettres nettes : ${avant.vert + avant.rouge} / ${avant.total}`)
      await geste(page, r)
      const apres = await lit(page, await photo(page, r, 'texte-apres'))
      assert.ok(apres.autres > avant.autres + 800, `de l'encre dans les lettres : ${apres.autres} contre ${avant.autres}`)
      assert.deepEqual(apres.coin, [255, 0, 0], 'toujours la couleur de la page hors des lettres')
      assert.ok(apres.rouge > avant.rouge * 0.97, `l'encre ne déborde pas des lettres : ${apres.rouge} contre ${avant.rouge}`)
      const t = await page.evaluate(() => {
        const el = (document.querySelector('mjs-fl-texte') as any)._shadow.querySelector('.f')
        const sel = window.getSelection()!
        sel.selectAllChildren(el)
        return { texte: el.textContent, choisi: sel.toString(), calque: el.querySelectorAll('[mjs-fx-layer]').length }
      })
      assert.equal(t.texte, 'MMM')
      assert.equal(t.choisi, 'MMM', 'le texte reste sélectionnable')
      assert.equal(t.calque, 1)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  for (const dpr of [1, 2]) {
    it(`where: text : les lettres du masque sont celles du texte à moins d'un pixel (densité ${dpr}, deux polices, deux lignes, un espacement)`, async function () {
      if (!present) { this.skip(); return }
      const { page } = await ouvre('mjs-fl-masque', { dpr })
      try {
        const r = await rect(page, 'mjs-fl-masque')
        const png = await photo(page, r, `masque-texte-${dpr}`)
        const m = await page.evaluate(async ([b64, d]: [string, number]) => {
          const el: any = (document.querySelector('mjs-fl-masque') as any)._shadow.querySelector('.m')
          const w = el.clientWidth * d
          const h = el.clientHeight * d
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const lire = (src: any, ww: number, hh: number) => {
            const cv = document.createElement('canvas')
            cv.width = ww; cv.height = hh
            const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
            c.drawImage(src, 0, 0)
            return c.getImageData(0, 0, ww, hh).data
          }
          const A = lire(img, img.width, img.height)
          const mask = (window as any).µ._mjs_fxTextMask(el, w, h)
          const B = lire(mask, w, h)
          // le texte vu : le noir sur blanc ; le masque : l'opacité
          const va = new Float32Array(w * h)
          const vb = new Float32Array(w * h)
          for (let i = 0; i < w * h; i++) {
            va[i] = 1 - A[i * 4] / 255
            vb[i] = B[i * 4 + 3] / 255
          }
          const bilan = (v: Float32Array) => {
            let s = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
              const c = v[y * w + x]
              s += c; sx += c * x; sy += c * y
              if (c > 0.5) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
            }
            return { cx: sx / s, cy: sy / s, x0, x1, y0, y1, encre: s }
          }
          // le recouvrement (intersection sur union) pour un décalage entier du masque
          const iou = (dx: number, dy: number) => {
            let i = 0, u = 0
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
              const a = va[y * w + x] > 0.5
              const xx = x - dx, yy = y - dy
              const b = xx >= 0 && xx < w && yy >= 0 && yy < h && vb[yy * w + xx] > 0.5
              if (a && b) i++
              if (a || b) u++
            }
            return i / u
          }
          const meilleur = { dx: 0, dy: 0, iou: 0 }
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const v = iou(dx, dy)
            if (v > meilleur.iou) { meilleur.dx = dx; meilleur.dy = dy; meilleur.iou = v }
          }
          return { texte: bilan(va), masque: bilan(vb), meilleur, nul: iou(0, 0), d, w, h }
        }, [png, dpr])
        const px = (v: number) => Math.abs(v) / dpr
        console.log(`  ℹ️  masque, densité ${dpr} : centres à ${px(m.texte.cx - m.masque.cx).toFixed(2)} / ${px(m.texte.cy - m.masque.cy).toFixed(2)} px, bords ${['x0', 'x1', 'y0', 'y1'].map((k) => px((m.texte as any)[k] - (m.masque as any)[k]).toFixed(2)).join(' / ')} px, meilleur décalage ${m.meilleur.dx},${m.meilleur.dy}, recouvrement ${m.nul.toFixed(3)}`)
        assert.ok(m.texte.encre > 500 && m.masque.encre > 500, `des lettres des deux côtés : ${m.texte.encre} / ${m.masque.encre}`)
        assert.ok(px(m.texte.cx - m.masque.cx) < 0.6 && px(m.texte.cy - m.masque.cy) < 0.6, `centres à moins de 0,6 px : dx ${px(m.texte.cx - m.masque.cx).toFixed(2)}, dy ${px(m.texte.cy - m.masque.cy).toFixed(2)}`)
        for (const k of ['x0', 'x1', 'y0', 'y1']) assert.ok(px((m.texte as any)[k] - (m.masque as any)[k]) <= 1, `bord ${k} à moins d'un pixel : ${(m.texte as any)[k]} contre ${(m.masque as any)[k]}`)
        assert.ok(Math.abs(m.meilleur.dx) <= dpr && Math.abs(m.meilleur.dy) <= dpr, `le meilleur décalage est d'au plus un pixel : ${m.meilleur.dx}, ${m.meilleur.dy}`)
        assert.ok(m.nul > 0.8, `les lettres se recouvrent : ${m.nul.toFixed(3)}`)
      } finally {
        await page.close()
      }
    })
  }

  it('retrait ({if} refermé) : ni toile, ni marque, ni variable, ni contexte, ni écouteur', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-retrait')
    try {
      const rb = await rect(page, 'mjs-fl-retrait', '.f')
      await geste(page, rb)
      await page.waitForFunction(() => (document.querySelector('mjs-fl-retrait') as any)._shadow.querySelector('.g').hasAttribute('mjs-fx-fluid-text'))
      const avant = await page.evaluate(() => {
        const w: any = window
        const sh = (document.querySelector('mjs-fl-retrait') as any)._shadow
        w.__els = [sh.querySelector('.f'), sh.querySelector('.g')]
        return { contextes: w.__gl.filter((g: any) => !g.isContextLost()).length, ecouteursFenetre: w.__ecouteurs(window).length, toiles: sh.querySelectorAll('canvas[mjs-fx-layer]').length, ecouteursBoite: w.__ecouteurs(w.__els[0]), ecouteursTitre: w.__ecouteurs(w.__els[1]), observateurs: { io: w.__obs.IntersectionObserver.size, ro: w.__obs.ResizeObserver.size, mo: w.__obs.MutationObserver.size }, polices: w.__ecouteurs(document.fonts).length, transitions: w.__ecouteurs(document).filter((t: string) => /^transition/.test(t)).length, schema: [...w.__cibles.entries()].filter(([k, v]: [any, any[]]) => k instanceof MediaQueryList && v.some((x) => x.type === 'change')).length }
      })
      assert.equal(avant.contextes, 2, 'un contexte pour la boîte, un pour le titre')
      assert.equal(avant.toiles, 2)
      assert.ok(avant.ecouteursBoite.includes('pointermove') && avant.ecouteursBoite.includes('pointerleave'), 'écouteurs posés sur la balise : ' + avant.ecouteursBoite)
      await page.evaluate(() => (document.querySelector('mjs-fl-retrait') as any)._shadow.querySelector('.t').click())
      await page.waitForFunction(() => !(document.querySelector('mjs-fl-retrait') as any)._shadow.querySelector('.f'))
      await page.waitForTimeout(100)
      const apres = await page.evaluate(() => {
        const w: any = window
        const sh = (document.querySelector('mjs-fl-retrait') as any)._shadow
        const reste = (el: any) => el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx'))
        return {
          toiles: sh.querySelectorAll('canvas[mjs-fx-layer]').length,
          vivants: w.__gl.filter((g: any) => !g.isContextLost()).length,
          marques: w.__els.map(reste),
          styles: w.__els.map((el: any) => el.getAttribute('style') ?? ''),
          retraits: w.__els.map((el: any) => el._mjs_fxOff ?? null),
          ecouteursBoite: w.__ecouteurs(w.__els[0]),
          ecouteursTitre: w.__ecouteurs(w.__els[1]),
          ecouteursFenetre: w.__ecouteurs(window).length,
          toilesRestantes: w.__els.map((el: any) => el.querySelectorAll('canvas').length),
          observateurs: { io: w.__obs.IntersectionObserver.size, ro: w.__obs.ResizeObserver.size, mo: w.__obs.MutationObserver.size },
          polices: w.__ecouteurs(document.fonts).length,
          transitions: w.__ecouteurs(document).filter((t: string) => /^transition/.test(t)).length,
          schema: [...w.__cibles.entries()].filter(([k, v]: [any, any[]]) => k instanceof MediaQueryList && v.some((x) => x.type === 'change')).length
        }
      })
      assert.equal(apres.toiles, 0, 'plus de toile')
      assert.equal(avant.schema - apres.schema, 1, `le guetteur du schéma de couleurs est posé avec le titre et part avec la dernière balise en texte (écouteurs de la préférence : ${avant.schema} puis ${apres.schema})`)
      assert.equal(avant.transitions - apres.transitions, 2, `les deux écouteurs de fin de transition du document partent avec la dernière balise en texte : ${avant.transitions} puis ${apres.transitions}`)
      assert.ok(avant.observateurs.mo - apres.observateurs.mo >= 3, `les observateurs de mutations du titre sont déconnectés (son texte, ses classes et styles, le thème de la page) : ${avant.observateurs.mo} puis ${apres.observateurs.mo}`)
      assert.deepEqual(apres.toilesRestantes, [0, 0], 'la toile est retirée de chaque balise elle-même, pas seulement avec la balise entière')
      for (const st of apres.styles) assert.ok(!/position|display/.test(st), 'position ou affichage posés par l\'effet et restés : ' + st)
      assert.ok(apres.observateurs.io <= avant.observateurs.io - 2, `observateurs d'intersection déconnectés : ${avant.observateurs.io} puis ${apres.observateurs.io}`)
      assert.ok(apres.observateurs.ro <= avant.observateurs.ro - 2, `observateurs de taille déconnectés : ${avant.observateurs.ro} puis ${apres.observateurs.ro}`)
      assert.ok(apres.observateurs.mo <= avant.observateurs.mo - 1, `observateur de texte déconnecté : ${avant.observateurs.mo} puis ${apres.observateurs.mo}`)
      assert.ok(apres.polices <= avant.polices - 1, `écouteur des polices retiré : ${avant.polices} puis ${apres.polices}`)
      assert.equal(apres.vivants, 0, 'les deux contextes sont rendus')
      assert.deepEqual(apres.marques, [[], []], 'ni marque ni attribut mjs-fx')
      for (const st of apres.styles) assert.ok(!/--mjs-/.test(st), 'variable restée : ' + st)
      assert.deepEqual(apres.retraits, [null, null])
      assert.deepEqual(apres.ecouteursBoite.filter((t: string) => /^pointer/.test(t)), [], 'plus d\'écouteur du pointeur sur la boîte')
      assert.deepEqual(apres.ecouteursTitre.filter((t: string) => /^pointer/.test(t)), [], 'plus d\'écouteur du pointeur sur le titre')
      assert.ok(apres.ecouteursFenetre <= avant.ecouteursFenetre - 1, `l'écouteur de redimensionnement de la fenêtre est retiré : ${avant.ecouteursFenetre} puis ${apres.ecouteursFenetre}`)
      assert.ok(await calme(page, 800), 'plus aucune image demandée')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('perte de contexte : arrêt propre, puis reprise au retour du contexte', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-boite')
    try {
      const r = await rect(page, 'mjs-fl-boite')
      await geste(page, r)
      await page.evaluate(() => {
        const w: any = window
        w.__cible = w.__gl.find((g: any) => !g.isContextLost())
        w.__perte = w.__cible.getExtension('WEBGL_lose_context')
        w.__perte.loseContext()
      })
      await page.waitForTimeout(300)
      assert.ok(await calme(page, 700), 'la boucle s\'arrête avec le contexte')
      await geste(page, r)
      assert.ok(await calme(page, 300), 'rien ne tourne pendant la perte')
      await page.evaluate(() => { (window as any).__perte.restoreContext() })
      await page.waitForFunction(() => !(window as any).__cible.isContextLost())
      await page.waitForTimeout(300)
      await geste(page, r)
      const p = await lit(page, await photo(page, r, 'contexte-repris'))
      assert.ok(nonUni(p), `l'encre revient après la reprise : ${p.vif}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('auto : hors écran, ni contexte ni image demandée ; à l\'écran, le fluide bouge seul', async function () {
    if (!present) { this.skip(); return }
    const { page } = await ouvre('mjs-fl-bas')
    try {
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(1500)
      assert.equal(await vivants(page), 0, 'aucun contexte pour une balise hors écran')
      assert.ok(await calme(page, 800), 'aucune image demandée hors écran')
      const r = await rect(page, 'mjs-fl-bas')
      const p = await jusqua(page, r, nonUni, 60000)
      assert.ok(nonUni(p), `de l'encre sans souris, à l'écran : ${p.vif}`)
      assert.equal(await vivants(page), 1)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(600)
      assert.ok(await calme(page, 900), 'la boucle s\'arrête quand la balise sort de l\'écran')
    } finally {
      await page.close()
    }
  })

  it('hors écran : aucune image dessinée ni demandée, avant la première vue comme après être sorti de l\'écran (mouvement seul, texte, geste en cours) ; le mouvement reprend au retour', async function () {
    if (!present) { this.skip(); return }
    const dessins = (page: any) => page.evaluate(() => (window as any).__dessins)
    // les dessins de la simulation et les images demandées entre deux instants distants de `ms`
    const immobile = async (page: any, ms: number) => {
      const a = [await dessins(page), await raf(page)]
      await page.waitForTimeout(ms)
      const b = [await dessins(page), await raf(page)]
      return { dessins: b[0] - a[0], images: b[1] - a[1] }
    }
    const rien = { dessins: 0, images: 0 }
    for (const tag of ['mjs-fl-bas', 'mjs-fl-bas-texte']) {
      const { page, erreurs } = await ouvre(tag)
      try {
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForTimeout(800)
        assert.deepEqual(await immobile(page, 1000), rien, `${tag} : jamais vue, rien ne se dessine`)
        await rect(page, tag)
        await page.waitForFunction(() => (window as any).__dessins > 40, null, { timeout: 60000 })
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForTimeout(600)
        assert.deepEqual(await immobile(page, 1200), rien, `${tag} : sortie de l'écran, rien ne se dessine`)
        const avant = await dessins(page)
        await rect(page, tag)
        await page.waitForFunction((d: number) => (window as any).__dessins > d + 20, avant, { timeout: 60000 })
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    }
    // un geste en cours (l'encre a encore des dizaines de secondes à vivre) puis la balise sort de l'écran : plus rien ne se dessine
    const { page, erreurs } = await ouvre('mjs-fl-defile')
    try {
      const r = await rect(page, 'mjs-fl-defile')
      await geste(page, r)
      assert.ok((await dessins(page)) > 20, 'le geste a dessiné')
      await page.evaluate(() => window.scrollTo(0, 5000))
      await page.waitForTimeout(600)
      assert.deepEqual(await immobile(page, 1200), rien, 'geste en cours puis sortie de l\'écran : rien ne se dessine')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  // [composant, nom du cas, jusqu'où défiler pour sortir de l'écran, réglages changés pendant que la balise est hors de l'écran]
  const SORTIES: Array<[string, string, number, any]> = [
    ['mjs-fl-bas', 'auto, boîte', 0, { glow: 0.9, rays: 0.2 }],
    ['mjs-fl-bas-texte', 'auto, texte', 0, { glow: 0.9, rays: 0.2 }],
    ['mjs-fl-bas-texte-seul', 'texte sans auto', 0, { glow: 0.9, rays: 0.2 }],
    ['mjs-fl-defile', 'geste en cours', 5000, { glow: 0.9, rays: 0.2, auto: true }]
  ]
  for (const [tag, nom, loin, reglage] of SORTIES) {
    it(`hors écran (${nom}) : un redimensionnement, un réglage changé ou un réveil ne dessinent ni ne demandent aucune image ; au retour à l'écran la taille est relue, l'image refaite et le mouvement repart`, async function () {
      if (!present) { this.skip(); return }
      const compte            = (page: any) => page.evaluate(() => [(window as any).__dessins, (window as any).__raf])
      const { page, erreurs } = await ouvre(tag)
      try {
        const r = await rect(page, tag)
        if (tag === 'mjs-fl-defile') await geste(page, r)
        else if (tag === 'mjs-fl-bas-texte-seul') await jusqua(page, r, (p) => p.vert > 3000)
        else await page.waitForFunction(() => (window as any).__dessins > 40, null, { timeout: 60000 })
        await page.evaluate((y: number) => window.scrollTo(0, y), loin)
        await page.waitForTimeout(800)
        // trois réveils pendant que la balise est hors de l'écran : sa largeur change, la fenêtre change de taille, des réglages tenus par une variable changent
        const avant = await compte(page)
        await page.evaluate((t: string) => { const b: any = (document.querySelector(t) as any)._shadow.querySelector('.f'); b.style.width = (b.offsetWidth - 40) + 'px' }, tag)
        await page.setViewportSize({ width: 700, height: 600 })
        await page.evaluate(([t, g]: [string, any]) => { (window as any).µ._mjs_fxSet((document.querySelector(t) as any)._shadow.querySelector('.f'), 'fluid', g, null) }, [tag, reglage])
        await page.waitForTimeout(1500)
        const apres = await compte(page)
        console.log(`  ℹ️  ${nom} : dessins / images demandées pendant les réveils hors écran : ${apres[0] - avant[0]} / ${apres[1] - avant[1]}`)
        assert.deepEqual([apres[0] - avant[0], apres[1] - avant[1]], [0, 0], `${nom} : hors écran, un réveil ne dessine rien et ne demande aucune image`)
        // le retour à l'écran : la toile a la largeur de la balise redimensionnée, l'image est refaite (les lettres se voient), le mouvement repart
        const r2    = await rect(page, tag)
        const toile = await page.evaluate((t: string) => { const b: any = (document.querySelector(t) as any)._shadow.querySelector('.f'); return [b.querySelector('canvas[mjs-fx-layer]').width, b.clientWidth] }, tag)
        assert.equal(toile[0], toile[1], `${nom} : la toile a la largeur de la balise redimensionnée`)
        if (tag === 'mjs-fl-bas-texte-seul') {
          const p = await jusqua(page, r2, (x) => x.vert > 3000, 8000)
          assert.ok(p.vert > 3000, `${nom} : au retour à l'écran les lettres se voient : ${p.vert}`)
        }
        else await page.waitForFunction((d: number) => (window as any).__dessins > d + 20, apres[0], { timeout: 60000 })
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })
  }

  it('hors écran : une image demandée juste avant de sortir de l\'écran n\'est pas perdue, au retour les lettres reviennent', async function () {
    if (!present) { this.skip(); return }
    const tag               = 'mjs-fl-bas-texte-seul'
    const { page, erreurs } = await ouvre(tag)
    try {
      const r = await rect(page, tag)
      await jusqua(page, r, (p) => p.vert > 3000)
      // l'horloge des images est celle du test : la demande d'image du changement de largeur reste en attente, le temps de sortir de l'écran
      await page.evaluate((t: string) => {
        (window as any).__manuel = true
        const b: any = (document.querySelector(t) as any)._shadow.querySelector('.f')
        b.style.width = (b.offsetWidth - 40) + 'px'
      }, tag)
      await page.waitForFunction(() => (window as any).__avance(0) > 0, null, { polling: 50, timeout: 10000 })
      await page.evaluate(() => window.scrollTo(0, 0))
      // l'observateur de visibilité retire la demande en attente
      await page.waitForFunction(() => (window as any).__avance(0) === 0, null, { polling: 50, timeout: 10000 })
      await page.evaluate(() => { (window as any).__vide(); (window as any).__manuel = false })
      const r2 = await rect(page, tag)
      const p = await jusqua(page, r2, (x) => x.vert > 3000, 8000)
      assert.ok(p.vert > 3000, `au retour à l'écran les lettres se voient : ${p.vert}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('effets économes : la grille de l\'encre au tiers, ni halo ni rayons, l\'encre se voit encore', async function () {
    if (!present) { this.skip(); return }
    const plus = async (econome: boolean) => {
      const { page, erreurs } = await ouvre('mjs-fl-halo', { econome })
      try {
        const r = await rect(page, 'mjs-fl-halo')
        await geste(page, r)
        const p = await lit(page, await photo(page, r, econome ? 'econome' : 'normal'))
        const largeurs: number[] = await page.evaluate(() => (window as any).__textures.map((t: number[]) => t[0]))
        assert.deepEqual(erreurs, [])
        return { vif: p.vif, large: Math.max(...largeurs) }
      } finally {
        await page.close()
      }
    }
    const normal  = await plus(false)
    const econome = await plus(true)
    assert.ok(normal.large >= 400, `en temps normal, le halo a ses textures (256 de côté court) : ${normal.large}`)
    assert.ok(econome.large <= normal.large / 3, `économe : des textures plus petites : ${econome.large} contre ${normal.large}`)
    assert.ok(econome.vif > 400, `et de l'encre : ${econome.vif}`)
  })

  it('« réduire les animations » : quelques taches figées, aucun mouvement, aucune image, la souris ne brasse rien', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-calme', { calme: true })
    try {
      const r = await rect(page, 'mjs-fl-calme')
      const p = await jusqua(page, r, nonUni, 30000)
      assert.ok(nonUni(p), `quelques taches posées : ${p.vif}`)
      await photo(page, r, 'calme')
      assert.ok(await calme(page, 1200), 'aucune image demandée')
      const a = await photo(page, r)
      await geste(page, r)
      const b = await photo(page, r)
      assert.equal(a, b, 'la souris ne change rien')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : l\'auteur remplace le contenu de la balise — la toile revient dans le même tour, le masque suit le nouveau texte', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-texte')
    try {
      await page.waitForFunction(() => (document.querySelector('mjs-fl-texte') as any)._shadow.querySelector('.f').hasAttribute('mjs-fx-fluid-text'))
      const r = await rect(page, 'mjs-fl-texte')
      const avant = await lit(page, await photo(page, r, 'remplace-avant'))
      assert.ok(avant.vert > 3000, `les lettres au fond vert : ${avant.vert}`)
      // le contenu est remplacé : la toile (premier enfant) part avec l'ancien texte ; les observateurs de mutations passent avant tout dessin
      const meme = await page.evaluate(async () => {
        const el = (document.querySelector('mjs-fl-texte') as any)._shadow.querySelector('.f')
        el.textContent = 'WWW'
        await Promise.resolve()
        return { toiles: el.querySelectorAll('canvas[mjs-fx-layer]').length, texte: el.textContent, marque: el.hasAttribute('mjs-fx-fluid-text') }
      })
      assert.equal(meme.texte, 'WWW')
      assert.equal(meme.toiles, 1, 'la toile est remise dans le même tour')
      assert.equal(meme.marque, true, 'le texte reste rendu par le fluide')
      const images = () => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))))
      await images()
      const apres = await lit(page, await photo(page, r, 'remplace-apres'))
      assert.ok(apres.vert > 3000, `les lettres du nouveau texte sont visibles, au fond vert : ${apres.vert}`)
      // un nœud de texte réécrit (ce que fait {$t}) : le masque est refait, une lettre au lieu de trois
      await page.evaluate(() => { [...(document.querySelector('mjs-fl-texte') as any)._shadow.querySelector('.f').childNodes].find((n: any) => n.nodeType === 3).data = 'W' })
      await images()
      const une = await lit(page, await photo(page, r, 'remplace-une'))
      assert.ok(une.vert > 500 && une.vert < apres.vert * 0.6, `une lettre au lieu de trois : ${une.vert} contre ${apres.vert}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : un changement de typographie qui laisse la boîte intacte est suivi au réveil suivant (entrée de la souris, retour à l\'écran)', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-typo')
    try {
      await page.waitForFunction(() => (document.querySelector('mjs-fl-typo') as any)._shadow.querySelector('.f').hasAttribute('mjs-fx-fluid-text'))
      const r = await rect(page, 'mjs-fl-typo')
      await page.mouse.move(790, 590)
      const poser = (css: string) => page.evaluate((c: string) => { Object.assign((document.querySelector('mjs-fl-typo') as any)._shadow.querySelector('.f').style, JSON.parse(c)) }, css)
      const centrer = async (ok: (c: any) => boolean, max = 20000) => {
        const fin = Date.now() + max
        let c = await centre(page, await photo(page, r))
        while (!ok(c) && Date.now() < fin) {
          await page.waitForTimeout(250)
          c = await centre(page, await photo(page, r))
        }
        return c
      }
      const gauche = await centre(page, await photo(page, r, 'typo-gauche'))
      assert.ok(gauche.n > 3000, `les lettres sont là : ${gauche.n}`)
      // à droite et espacé : la boîte ne bouge pas (pas d'observateur de taille qui réponde), seule la place des lettres change
      await poser('{"textAlign":"right","letterSpacing":"3px"}')
      await page.mouse.move(r.x + 40, r.y + 20)
      await page.mouse.move(r.x + 60, r.y + 30)
      const droite = await centrer((c) => c.x > gauche.x + 60)
      await photo(page, r, 'typo-droite')
      assert.ok(droite.x > gauche.x + 60, `à l'entrée de la souris, le masque suit le texte à droite : centre ${gauche.x.toFixed(0)} puis ${droite.x.toFixed(0)}`)
      // retour à gauche pendant que la balise est hors de l'écran : le retour à l'écran refait le masque
      await page.mouse.move(790, 590)
      await page.evaluate(() => window.scrollTo(0, 2500))
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(ok)))))
      await poser('{"textAlign":"left","letterSpacing":"0px"}')
      await page.evaluate(() => window.scrollTo(0, 0))
      const retour = await centrer((c) => c.x < droite.x - 60)
      assert.ok(retour.x < droite.x - 60, `au retour à l'écran, le masque suit le texte à gauche : centre ${droite.x.toFixed(0)} puis ${retour.x.toFixed(0)}`)
      // départ de auto : la même relecture
      await poser('{"textAlign":"right","letterSpacing":"3px"}')
      await page.evaluate(() => { (window as any).µ._mjs_fxSet((document.querySelector('mjs-fl-typo') as any)._shadow.querySelector('.f'), 'fluid', { auto: true }, null) })
      const seul = await centrer((c) => c.x > retour.x + 60)
      assert.ok(seul.x > retour.x + 60, `au départ de auto, le masque suit le texte à droite : centre ${retour.x.toFixed(0)} puis ${seul.x.toFixed(0)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  // une séance déterministe sur la balise `sel` du composant `tag` : l'horloge des images est celle du test (soixante par seconde), les
  // évènements du pointeur sont écrits à la main — ni la vitesse de la machine ni la cadence des évènements n'y comptent. Un balayage
  // de quinze mouvements, puis trente images, une première lecture de la toile, soixante images, une seconde. Rend le mouvement de
  // l'encre entre les deux lectures, le nombre de points vifs de la seconde et la blancheur de son point le plus vif
  const seance = (page: any, tag: string, sel: string, reglage: any = null) => page.evaluate(([t, s, g]: [string, string, any]) => {
    const w: any = window
    const el = (document.querySelector(t) as any)._shadow.querySelector(s)
    w.__manuel = true
    if (g) w.µ._mjs_fxSet(el, 'fluid', g, null)
    const r = el.getBoundingClientRect()
    const evt = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, isPrimary: true, bubbles: type === 'pointermove' }))
    const lis = () => {
      const c = el.querySelector('canvas[mjs-fx-layer]')
      const gl = w.__gl.find((x: any) => x.canvas === c)
      const px = new Uint8Array(c.width * c.height * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return px
    }
    evt('pointerenter', 30, r.height / 2)
    for (let x = 40; x <= 320; x += 20) { evt('pointermove', x, r.height / 2); w.__avance(1) }
    w.__avance(30)
    const a = lis()
    w.__avance(60)
    const b = lis()
    let somme = 0, delta = 0, vifs = 0, max = 0, clair = [0, 0, 0]
    for (let i = 0; i < b.length; i += 4) {
      delta += Math.abs(b[i] - a[i]) + Math.abs(b[i + 1] - a[i + 1]) + Math.abs(b[i + 2] - a[i + 2])
      somme += a[i] + a[i + 1] + a[i + 2]
      const m = Math.max(b[i], b[i + 1], b[i + 2])
      if (m >= 32) vifs++
      if (m > max) { max = m; clair = [b[i], b[i + 1], b[i + 2]] }
    }
    w.__vide()
    w.__manuel = false
    return { mouvement: delta / Math.max(1, somme), vifs, blanc: max ? Math.min(...clair) / max : 0, max }
  }, [tag, sel, reglage])

  // [réglage, valeur posée sur a, valeur mise par set sur c et posée sur b]
  for (const [cle, , haut] of [['size', 0.05, 2], ['strength', 0, 5000], ['friction', 10, 0], ['curl', 50, 0]] as Array<[string, number, number]>) {
    it(`${cle} : suivi à la pose et dans set — séance à horloge tenue, quatre balises`, async function () {
      if (!present) { this.skip(); return }
      const tag = `mjs-fl-s-${cle}`
      const { page, erreurs } = await ouvre(tag)
      try {
        const m: Record<string, any> = {}
        for (const k of ['a', 'b', 'd']) m[k] = await seance(page, tag, '.' + k)
        m.c = await seance(page, tag, '.c', { [cle]: haut })
        console.log(`  ℹ️  ${cle} : ` + Object.entries(m).map(([k, v]: [string, any]) => `${k} mouvement ${v.mouvement.toFixed(3)} vifs ${v.vifs} blanc ${v.blanc.toFixed(2)}`).join(' · '))
        // l'encre posée est blanche (colors suivi à la pose : une teinte vive a toujours un canal à zéro) et se voit
        for (const k of ['a', 'b', 'c', 'd']) assert.ok(m[k].blanc > 0.95 && m[k].vifs > 1000, `${k} : de l'encre blanche : blanc ${m[k].blanc.toFixed(2)}, vifs ${m[k].vifs}`)
        // size : la surface de la tache ; les autres : le mouvement de l'encre entre deux lectures
        const mesure = cle === 'size' ? 'vifs' : 'mouvement'
        const v = (k: string) => m[k][mesure] as number
        const plus = (k: string, que: string, fois: number, plancher = 0) => assert.ok(v(k) > fois * v(que) + plancher, `${cle} : ${k} (${v(k).toFixed(3)}) doit dépasser ${fois} fois ${que} (${v(que).toFixed(3)})`)
        if (cle === 'curl') {
          // posé à 50 : les tourbillons sont plus compacts et durent plus (le renfort se resserre sans jamais ajouter de vitesse : le mouvement entre
          // deux lectures reste du même ordre, mais il est au-dessus du défaut, lui-même au-dessus de curl 0, posé ou mis par set)
          // (à la force d'un geste d'aujourd'hui : posé à 50 contre posé à 0, 1,45 fois dans Chromium et 1,16 fois dans Firefox)
          plus('a', 'b', 1.1)
          plus('a', 'c', 1.1)
          plus('d', 'c', 1.1)
          plus('d', 'b', 1.1)
        } else {
          // posé à la valeur basse : bien en dessous du défaut ; posé à la haute, ou mise par set : bien au-dessus
          plus('d', 'a', cle === 'size' ? 2.5 : 3, cle === 'size' ? 0 : 0.1)
          // à friction 0 le renfort des tourbillons ne s'applique pas (rien ne calme l'eau que le transport) : au défaut il entretient les tourbillons, si bien
          // que l'écart avec friction 0 est mince ; la force par contre porte l'encre loin au-delà du défaut
          const marge = cle === 'friction' ? 1.03 : cle === 'strength' ? 1.2 : 1.5
          plus('b', 'd', marge)
          plus('c', 'd', marge)
        }
        // la valeur mise par set donne la même séance que la même valeur posée
        assert.ok(Math.abs(v('c') - v('b')) <= 0.1 * Math.max(v('b'), 0.05), `${cle} : set (${v('c').toFixed(3)}) donne la séance de la pose (${v('b').toFixed(3)})`)
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })
  }

  it('rays et glow : chaque passe change l\'image (séance à horloge tenue), et rien ne tourne une fois l\'encre posée', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-s-rayons')
    try {
      const m = await page.evaluate(() => {
        const w: any = window
        const el = (document.querySelector('mjs-fl-s-rayons') as any)._shadow.querySelector('.f')
        w.__manuel = true
        const r = el.getBoundingClientRect()
        const evt = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, isPrimary: true, bubbles: type === 'pointermove' }))
        const lis = () => {
          const c = el.querySelector('canvas[mjs-fx-layer]')
          const gl = w.__gl.find((x: any) => x.canvas === c)
          const px = new Uint8Array(c.width * c.height * 4)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
          return px
        }
        // les points qui changent d'une lecture à l'autre
        const diff = (a: Uint8Array, b: Uint8Array) => {
          let n = 0
          for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++
          return n
        }
        const regler = (g: any) => { w.µ._mjs_fxSet(el, 'fluid', g, null); w.__avance(3); return lis() }
        evt('pointerenter', 30, 110)
        for (let x = 40; x <= 320; x += 20) { evt('pointermove', x, 110); w.__avance(1) }
        // l'encre ne s'efface pas (fade 0) : la boucle s'arrête quand le mouvement est calmé
        w.__avance(120)
        const enAttente = w.__avance(0)
        const nu = lis()
        const rayons = regler({ rays: 0.9 })
        const sans = regler({ rays: 0 })
        const halo = regler({ glow: 1.5 })
        return { enAttente, rayons: diff(nu, rayons), retour: diff(nu, sans), halo: diff(nu, halo) }
      })
      console.log(`  ℹ️  rayons et halo : ${JSON.stringify(m)}`)
      assert.equal(m.enAttente, 0, 'la boucle est arrêtée une fois le mouvement calmé')
      assert.ok(m.rayons > 300, `les rayons changent l'image : ${m.rayons} points`)
      assert.ok(m.halo > 300, `le halo change l'image : ${m.halo} points`)
      assert.ok(m.retour < 30, `rays à zéro rend l'image d'avant : ${m.retour} points de différence`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('halo : un voile serré autour d\'un trait court (loin de lui le fond reste noir), d\'une intensité réglée (glow fort contre aucun halo)', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-s-rayons')
    try {
      const m = await page.evaluate(() => {
        const w: any = window
        const el = (document.querySelector('mjs-fl-s-rayons') as any)._shadow.querySelector('.f')
        w.__manuel = true
        const r = el.getBoundingClientRect()
        const evt = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, isPrimary: true, bubbles: type === 'pointermove' }))
        const lis = () => {
          const c = el.querySelector('canvas[mjs-fx-layer]')
          const gl = w.__gl.find((x: any) => x.canvas === c)
          const px = new Uint8Array(c.width * c.height * 4)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
          return { px, w: c.width, h: c.height }
        }
        // la somme des valeurs, sur toute l'image et sur son tiers droit (le trait est tout à gauche)
        const somme = (l: any) => {
          let tout = 0, droite = 0
          for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) {
            const i = 4 * (y * l.w + x)
            const v = l.px[i] + l.px[i + 1] + l.px[i + 2]
            tout += v
            if (x > 0.66 * l.w) droite += v
          }
          return { tout, droite }
        }
        evt('pointerenter', 30, 110)
        for (let x = 40; x <= 80; x += 10) { evt('pointermove', x, 110); w.__avance(1) }
        w.__avance(120)
        w.µ._mjs_fxSet(el, 'fluid', { glow: 0 }, null); w.__avance(3)
        const nu = somme(lis())
        w.µ._mjs_fxSet(el, 'fluid', { glow: 2 }, null); w.__avance(3)
        const halo = somme(lis())
        return { nu, halo }
      })
      // la part de lumière que le halo ajoute à glow 2 (0,415 mesuré ; cinq niveaux de réduction : le voile reste près du trait)
      const PART_HALO = 0.415
      const part = (m.halo.tout - m.nu.tout) / m.nu.tout
      console.log(`  ℹ️  halo à glow 2 : lumière de l'image ${m.nu.tout} puis ${m.halo.tout} (part ajoutée ${part.toFixed(3)}), tiers droit ${m.nu.droite} puis ${m.halo.droite}`)
      assert.ok(m.halo.droite - m.nu.droite < 0.005 * (m.halo.tout - m.nu.tout), `le halo reste près de l'encre : ${m.halo.droite - m.nu.droite} de lumière ajoutée dans le tiers droit sur ${m.halo.tout - m.nu.tout} en tout`)
      assert.ok(part > 0 && Math.abs(part - PART_HALO) < 0.08 * PART_HALO, `l'intensité du halo à glow 2 : ${part.toFixed(3)} de la lumière de l'encre (attendu ${PART_HALO} à 8 % près)`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('glow posé : le halo suit la valeur écrite à la pose (nulle, douce, forte), pas seulement celle que set met ensuite', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-s-halo')
    try {
      // le même tour de souris, à horloge tenue, sur trois balises qui ne diffèrent que par glow ; ni rayons ni effacement de l'encre : la lumière lue est celle de l'encre et de son halo
      const m: Record<string, any> = {}
      for (const c of ['nul', 'doux', 'fort']) {
        const [lect] = await scenes(page, 'mjs-fl-s-halo', c, { depart: CERCLE[0], pas: CERCLE.slice(1), lectures: [0] })
        m[c]         = lect
      }
      console.log(`  ℹ️  glow posé à 0 / 0,4 / 1,6 : lumière lue ${m.nul.lum.toFixed(0)} / ${m.doux.lum.toFixed(0)} / ${m.fort.lum.toFixed(0)} · part éclairée ${m.nul.couvert.toFixed(3)} / ${m.doux.couvert.toFixed(3)} / ${m.fort.couvert.toFixed(3)}`)
      assert.ok(m.doux.lum > 1.06 * m.nul.lum, `glow 0,4 posé éclaire plus que glow 0 posé : ${m.doux.lum.toFixed(0)} contre ${m.nul.lum.toFixed(0)} (attendu plus de 1,06 fois : Chromium donne 1,13)`)
      assert.ok(m.fort.lum > 1.1 * m.doux.lum, `glow 1,6 posé éclaire plus que glow 0,4 posé : ${m.fort.lum.toFixed(0)} contre ${m.doux.lum.toFixed(0)} (attendu plus de 1,1 fois : l'intensité du halo suit la valeur posée, Chromium donne 1,22)`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('resolution : la toile ne dépasse pas cette densité de pixels, 1,5 fois la taille CSS par défaut, sur un écran très fin, à la pose et dans set', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-resol', { dpr: 3 })
    try {
      const largeur = (c: string) => page.evaluate(([t, k]: [string, string]) => ((document.querySelector(t) as any)._shadow.querySelector('.' + k) as HTMLElement).querySelector<HTMLCanvasElement>('canvas[mjs-fx-layer]')!.width, ['mjs-fl-resol', c])
      // la toile n'existe qu'au premier geste : une entrée et un mouvement de souris sur chaque balise
      for (const c of ['d', 'a', 'b', 'c']) {
        await page.evaluate(([t, k]: [string, string]) => {
          const el = (document.querySelector(t) as any)._shadow.querySelector('.' + k)
          const r = el.getBoundingClientRect()
          for (const type of ['pointerenter', 'pointermove']) el.dispatchEvent(new PointerEvent(type, { clientX: r.left + 20, clientY: r.top + 20, isPrimary: true, bubbles: type === 'pointermove' }))
        }, ['mjs-fl-resol', c])
      }
      const l = { d: await largeur('d'), a: await largeur('a'), b: await largeur('b'), c: await largeur('c') }
      console.log(`  ℹ️  résolution, écran à 3 pixels par point, balise de 360 px : défaut ${l.d}, 1 : ${l.a}, 4 : ${l.b}, 0,5 : ${l.c}`)
      assert.equal(l.d, 540, `par défaut la toile vaut 1,5 fois la taille CSS (360 px) : ${l.d}`)
      assert.equal(l.a, 360, `resolution: 1 : ${l.a}`)
      assert.equal(l.b, 1080, `resolution: 4 laisse la densité de l'écran (3) : ${l.b}`)
      assert.equal(l.c, 180, `resolution: 0.5 : ${l.c}`)
      await page.evaluate(() => { const el = ((document.querySelector('mjs-fl-resol') as any)._shadow.querySelector('.d')); (window as any).µ._mjs_fxSet(el, 'fluid', { resolution: 2 }, null) })
      await page.waitForTimeout(300)
      assert.equal(await largeur('d'), 720, 'set resolution : la toile suit la nouvelle densité')
      // hors des bornes (0,5 à 4), set écrit la borne : la densité est celle de la borne, pas la valeur écrite
      await page.evaluate(() => { const el = ((document.querySelector('mjs-fl-resol') as any)._shadow.querySelector('.d')); (window as any).µ._mjs_fxSet(el, 'fluid', { resolution: 0.1 }, null) })
      await page.waitForTimeout(300)
      assert.equal(await largeur('d'), 180, 'set resolution 0,1 : la toile prend la densité de la borne basse (0,5), 180')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
    const fine = await ouvre('mjs-fl-resol', { dpr: 6 })
    try {
      const geste = () => fine.page.evaluate(() => {
        const el = ((document.querySelector('mjs-fl-resol') as any)._shadow.querySelector('.d'))
        const r = el.getBoundingClientRect()
        for (const type of ['pointerenter', 'pointermove']) el.dispatchEvent(new PointerEvent(type, { clientX: r.left + 20, clientY: r.top + 20, isPrimary: true, bubbles: type === 'pointermove' }))
      })
      const larg = () => fine.page.evaluate(() => ((document.querySelector('mjs-fl-resol') as any)._shadow.querySelector('.d').querySelector('canvas[mjs-fx-layer]') as HTMLCanvasElement).width)
      await geste()
      await fine.page.evaluate(() => { const el = ((document.querySelector('mjs-fl-resol') as any)._shadow.querySelector('.d')); (window as any).µ._mjs_fxSet(el, 'fluid', { resolution: 100 }, null) })
      await fine.page.waitForTimeout(300)
      assert.equal(await larg(), 1440, 'set resolution 100 sur un écran à 6 pixels par point : la toile prend la densité de la borne haute (4), 1440')
    } finally {
      await fine.page.close()
    }
    const fin = await ouvre('mjs-fl-resol', { dpr: 1 })
    try {
      await fin.page.evaluate(() => {
        const el = ((document.querySelector('mjs-fl-resol') as any)._shadow.querySelector('.d'))
        const r = el.getBoundingClientRect()
        for (const type of ['pointerenter', 'pointermove']) el.dispatchEvent(new PointerEvent(type, { clientX: r.left + 20, clientY: r.top + 20, isPrimary: true, bubbles: type === 'pointermove' }))
      })
      const w = await fin.page.evaluate(() => ((document.querySelector('mjs-fl-resol') as any)._shadow.querySelector('.d').querySelector('canvas[mjs-fx-layer]') as HTMLCanvasElement).width)
      assert.equal(w, 360, `sur un écran ordinaire la densité reste celle de l'écran : ${w}`)
    } finally {
      await fin.page.close()
    }
  })

  it('fond transparent : sans réglage, la balise montre son propre fond avant tout geste, pendant un geste (loin de l\'encre) et une fois l\'encre effacée', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-transparent')
    try {
      const VIF     = [200, 30, 30]
      const couleur = (classe: string, fenetre?: number[], nom = '') => couleurEcran(page, 'mjs-fl-transparent', classe, fenetre, VIF, nom)
      // avant tout geste : la balise a exactement l'aspect qu'elle a sans l'effet, partout (la valeur médiane, et aucun point écarté)
      const repos = { vif: await couleur('vif', undefined, 'transparent-vif-repos'), defaut: await couleur('defaut', undefined, 'transparent-defaut-repos'), temoin: await couleur('temoin', undefined, 'transparent-temoin') }
      console.log(`  ℹ️  fond de la balise (médiane de chaque canal, points écartés) avant tout geste : ${JSON.stringify(repos)}`)
      assert.deepEqual(repos.temoin.rgb, VIF, `la balise témoin (sans l'effet) montre son fond : ${repos.temoin.rgb}`)
      assert.deepEqual([repos.vif.rgb, repos.vif.hors], [VIF, 0], `avec *fluid et des réglages de finesse, avant tout geste : ${JSON.stringify(repos.vif)}`)
      assert.deepEqual([repos.defaut.rgb, repos.defaut.hors], [VIF, 0], `avec *fluid sans aucun réglage, avant tout geste : ${JSON.stringify(repos.defaut)}`)
      // pendant un geste, à la souris : loin de l'encre (la moitié droite, le geste est à gauche) le fond de la balise reste partout, près de l'encre elle se voit
      const r = await rect(page, 'mjs-fl-transparent', '.vif')
      await page.mouse.move(r.x + 85, r.y + 110)
      for (let k = 1; k <= 24; k++) {
        await page.mouse.move(r.x + 60 + 25 * Math.cos(k / 24 * 2 * Math.PI), r.y + 110 + 25 * Math.sin(k / 24 * 2 * Math.PI))
        await page.waitForTimeout(8)
      }
      const loin = await couleur('vif', [0.5, 0, 1, 1], 'transparent-vif-geste')
      const pres = await couleur('vif', [0, 0, 0.5, 1])
      console.log(`  ℹ️  pendant le geste : loin de l'encre ${JSON.stringify(loin)} · près de l'encre ${JSON.stringify(pres)}`)
      assert.deepEqual([loin.rgb, loin.hors], [VIF, 0], `pendant un geste, loin de l'encre, la balise montre son fond : ${JSON.stringify(loin)}`)
      assert.ok(pres.hors > 200, `l'encre se voit près du geste : ${pres.hors} points écartés du fond`)
      // une fois l'encre effacée (dix secondes, six cents images) : de nouveau l'aspect de la balise sans l'effet, partout
      const GESTE_LOIN = Array.from({ length: 13 }, (_, k) => point([300, 110], 25, k * 30))
      await scenes(page, 'mjs-fl-transparent', 'vif2', { depart: GESTE_LOIN[0], pas: GESTE_LOIN.slice(1), lectures: [600], rappel: true })
      await scenes(page, 'mjs-fl-transparent', 'defaut', { depart: GESTE_LOIN[0], pas: GESTE_LOIN.slice(1), lectures: [600], rappel: true })
      await page.waitForTimeout(300)
      const apres = { vif2: await couleur('vif2', undefined, 'transparent-vif2-apres'), defaut: await couleur('defaut', undefined, 'transparent-defaut-apres') }
      console.log(`  ℹ️  dix secondes après le geste : ${JSON.stringify(apres)}`)
      assert.deepEqual([apres.vif2.rgb, apres.vif2.hors], [VIF, 0], `une fois l'encre effacée, la balise montre son fond : ${JSON.stringify(apres.vif2)}`)
      assert.deepEqual([apres.defaut.rgb, apres.defaut.hors], [VIF, 0], `sans aucun réglage, une fois l'encre effacée : ${JSON.stringify(apres.defaut)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('fond transparent en texte : sans fond écrit, la balise montre son fond et les lettres ont la couleur du texte ; l\'encre coule dans les lettres seulement ; une fois l\'encre effacée, il ne reste que les lettres', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-transparent')
    try {
      const VIF   = [200, 30, 30]
      const BLANC = [255, 255, 255]
      // le bas de la balise n'a pas de lettre : il montre le fond de la balise ; une fenêtre qui couvre toute la balise montre les lettres
      const BAS = [0, 0.92, 1, 1]
      await page.waitForFunction(() => { const r = (document.querySelector('mjs-fl-transparent') as any)._shadow; return r.querySelector('.lettres').hasAttribute('mjs-fx-fluid-text') && r.querySelector('.lettres2').hasAttribute('mjs-fx-fluid-text') })
      // une balise par scène : une scène à horloge tenue ne se rejoue pas sur la même balise
      const fond    = (nom = '', classe = 'lettres') => couleurEcran(page, 'mjs-fl-transparent', classe, BAS, VIF, nom)
      const lettres = (nom = '', classe = 'lettres') => lettresCouleur(page, 'mjs-fl-transparent', classe, VIF, undefined, nom, [BLANC])
      const repos = { fond: await fond('transparent-lettres-fond'), lettres: await lettres('transparent-lettres-repos'), fond2: await fond('', 'lettres2'), lettres2: await lettres('', 'lettres2') }
      console.log(`  ℹ️  texte, avant tout geste : ${JSON.stringify(repos)}`)
      assert.deepEqual([repos.fond.rgb, repos.fond.hors, repos.fond2.rgb, repos.fond2.hors], [VIF, 0, VIF, 0], `en texte, la balise montre son propre fond, sans rectangle de plus : ${JSON.stringify(repos)}`)
      for (const l of [repos.lettres, repos.lettres2]) assert.ok(l.n > 1500 && proche(l.rgb, BLANC, 2) && l.proches[0] > 0.8 * l.n, `avant tout geste, les lettres ont la couleur du texte : ${JSON.stringify(l)}`)
      // un geste à travers les lettres : l'encre coule dedans, le reste de la balise garde son fond
      const TRAIT = Array.from({ length: 25 }, (_, k) => [40 + 16 * k, 80 + 30 * Math.sin(k / 3)])
      await scenes(page, 'mjs-fl-transparent', 'lettres', { depart: TRAIT[0], pas: TRAIT.slice(1), lectures: [8], rappel: true })
      await page.waitForTimeout(300)
      const pendant = await lettres('transparent-lettres-geste')
      const bas     = await fond()
      const encre   = (l: any) => l.n - l.proches[0]
      console.log(`  ℹ️  texte, pendant le geste : ${JSON.stringify(pendant)} · bas ${JSON.stringify(bas)}`)
      assert.ok(encre(pendant) > encre(repos.lettres) + 300, `l'encre coule dans les lettres : ${encre(pendant)} points qui ne sont plus à la couleur du texte, contre ${encre(repos.lettres)} avant`)
      assert.deepEqual([bas.rgb, bas.hors], [VIF, 0], `l'encre ne déborde pas des lettres : ${JSON.stringify(bas)}`)
      // une fois l'encre effacée : de nouveau les lettres à la couleur du texte, et rien d'autre
      await scenes(page, 'mjs-fl-transparent', 'lettres2', { depart: TRAIT[0], pas: TRAIT.slice(1), lectures: [600], rappel: true })
      await page.waitForTimeout(300)
      const apres = await lettres('transparent-lettres2-apres', 'lettres2')
      const bas2  = await fond('', 'lettres2')
      console.log(`  ℹ️  texte, dix secondes après le geste : ${JSON.stringify(apres)} · bas ${JSON.stringify(bas2)}`)
      assert.ok(apres.n > 1500 && proche(apres.rgb, BLANC, 2) && encre(apres) <= encre(repos.lettres2) + 40, `une fois l'encre effacée, les lettres ont la couleur du texte : ${JSON.stringify(apres)}`)
      assert.deepEqual([bas2.rgb, bas2.hors], [VIF, 0], `et la balise montre son fond : ${JSON.stringify(bas2)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('fond écrit : en boîte il colore la toile (par-dessus le fond de la balise, sous l\'encre) et transparent laisse voir la balise ; en texte il remplit les lettres à la place de la couleur du texte, sans rien colorer derrière elles', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-fond')
    try {
      await rect(page, 'mjs-fl-fond', '.demi2')
      await page.waitForFunction(() => { const r = (document.querySelector('mjs-fl-fond') as any)._shadow; return ['ecrit2', 'demi2', 'sans2'].every((c) => r.querySelector('.' + c).hasAttribute('mjs-fx-fluid-text')) })
      const couleur = (classe: string, ref: number[]) => couleurEcran(page, 'mjs-fl-fond', classe, [0, 0, 1, 1], ref)
      const vu = { sans: await couleur('sans', [200, 30, 30]), ecrit: await couleur('ecrit', [34, 0, 0]), transp: await couleur('transp', [200, 30, 30]) }
      console.log(`  ℹ️  fond écrit (médiane de chaque canal, points écartés) : ${JSON.stringify(vu)}`)
      assert.deepEqual([vu.sans.rgb, vu.sans.hors], [[200, 30, 30], 0], `sans fond écrit, la balise montre le sien : ${JSON.stringify(vu.sans)}`)
      assert.deepEqual([vu.ecrit.rgb, vu.ecrit.hors], [[34, 0, 0], 0], `un fond écrit (#220000) colore toute la toile, par-dessus celui de la balise : ${JSON.stringify(vu.ecrit)}`)
      assert.deepEqual([vu.transp.rgb, vu.transp.hors], [[200, 30, 30], 0], `transparent laisse voir la balise : ${JSON.stringify(vu.transp)}`)
      // en texte : le bas de la balise n'a pas de lettre, c'est la page rouge, intacte ; les lettres sont remplies du fond écrit à la place du blanc du texte
      const BLANC = [255, 255, 255]
      const BAS   = [0, 0.92, 1, 1]
      const bas   = (classe: string) => couleurEcran(page, 'mjs-fl-fond', classe, BAS, [255, 0, 0])
      const rect2 = { ecrit2: await bas('ecrit2'), demi2: await bas('demi2'), sans2: await bas('sans2') }
      const let2  = { ecrit2: await lettresCouleur(page, 'mjs-fl-fond', 'ecrit2', [255, 0, 0], undefined, 'fond-ecrit2'), demi2: await lettresCouleur(page, 'mjs-fl-fond', 'demi2', [255, 0, 0], undefined, 'fond-demi2'), sans2: await lettresCouleur(page, 'mjs-fl-fond', 'sans2', [255, 0, 0], undefined, 'fond-sans2') }
      console.log(`  ℹ️  texte : bas de la balise ${JSON.stringify(rect2)} · lettres ${JSON.stringify(let2)}`)
      for (const [k, r] of Object.entries(rect2)) assert.deepEqual([r.rgb, r.hors], [[255, 0, 0], 0], `${k} : rien n'est coloré derrière les lettres, la page reste telle quelle : ${JSON.stringify(r)}`)
      assert.ok(let2.ecrit2.n > 1500 && proche(let2.ecrit2.rgb, [34, 0, 0], 2), `un fond écrit (#220000) remplit les lettres à la place du blanc du texte : ${JSON.stringify(let2.ecrit2)}`)
      assert.ok(let2.demi2.n > 1500 && proche(let2.demi2.rgb, [127, 0, 0], 2), `un fond translucide remplit les lettres, transparence comprise (la page rouge à travers) : ${JSON.stringify(let2.demi2)}`)
      assert.ok(let2.sans2.n > 1500 && proche(let2.sans2.rgb, BLANC, 2), `sans fond écrit, les lettres gardent la couleur du texte : ${JSON.stringify(let2.sans2)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('fond tenu par une variable : chaque valeur écrite se voit aussitôt (couleur, fond translucide, transparent, retour à l\'absence de fond), sans geste — en boîte comme dans les lettres, qui reprennent la couleur du texte quand plus rien n\'est écrit ; une variable de la feuille de style est suivie de même', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-fond-var')
    try {
      const T      = 'mjs-fl-fond-var'
      const BAS    = [0, 0.92, 1, 1]
      const BLANC  = [255, 255, 255]
      // la page est rouge pur : le plus fort des trois canaux est son rouge, 255 ; un fond noir à moitié le laisse à 127,5
      const niveau = async (classe: string, fenetre = [0, 0, 1, 1]) => Math.max(...(await couleurEcran(page, T, classe, fenetre, [0, 0, 0])).rgb)
      const clic   = (classe: string) => page.evaluate((c: string) => ((document.querySelector('mjs-fl-fond-var') as any)._shadow.querySelector('.' + c) as HTMLElement).click(), classe)
      // les vues : la boîte écrite, la boîte qui reçoit en plus une variable de la feuille de style (#003300 : 51, que le fond écrit recouvre et que son retrait rend), le bas du titre (aucune lettre : la page), les lettres
      const vues = async () => [await niveau('dyn'), await niveau('theme'), await niveau('lettres', BAS), await lettresCouleur(page, T, 'lettres', [255, 0, 0])] as const
      const d = await vues()
      assert.deepEqual([d[0], d[1], d[2]], [255, 51, 255], `au départ, la page, la variable de la feuille, la page derrière les lettres : ${d.slice(0, 3)}`)
      assert.ok(d[3].n > 1500 && proche(d[3].rgb, BLANC, 2), `au départ, les lettres ont la couleur du texte : ${JSON.stringify(d[3])}`)
      // [bouton, ce qui s'est passé, niveau d'une boîte écrite, niveau de la boîte qui a aussi une variable de feuille, ce que les lettres montrent : leur couleur, ou null (rien : elles sont transparentes)]
      const passages: Array<[string, string, number, number, number[] | null]> = [
        ['rouge', '#220000, rien avant', 34, 34, [34, 0, 0]],
        ['vide', 'plus de fond écrit, une couleur avant', 255, 51, BLANC],
        ['transp', 'transparent, rien avant', 255, 255, null],
        ['vide', 'plus de fond écrit, transparent avant', 255, 51, BLANC],
        ['rouge', '#220000, rien avant', 34, 34, [34, 0, 0]],
        ['demi', 'rgba(0, 0, 0, .5), une couleur avant', 128, 128, [127, 0, 0]],
        ['transp', 'transparent, une couleur translucide avant', 255, 255, null],
        ['demi', 'rgba(0, 0, 0, .5), transparent avant', 128, 128, [127, 0, 0]],
        ['vide', 'plus de fond écrit, une couleur translucide avant', 255, 51, BLANC]
      ]
      for (const [bouton, quand, sans, feuille, lettres] of passages) {
        await clic(bouton)
        await page.waitForTimeout(150)
        const v = await vues()
        assert.ok(Math.abs(v[0] - sans) <= 1 && Math.abs(v[1] - feuille) <= 1 && v[2] === 255, `${quand} : boîte écrite ${sans}, avec variable de feuille ${feuille}, derrière les lettres la page (255) ; vu ${v.slice(0, 3)}`)
        if (lettres) assert.ok(v[3].n > 1500 && proche(v[3].rgb, lettres, 2), `${quand} : les lettres sont ${lettres} ; vu ${JSON.stringify(v[3])}`)
        else assert.ok(v[3].n < 200, `${quand} : les lettres sont transparentes, la page à travers ; vu ${JSON.stringify(v[3])}`)
      }
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : un fond écrit remplit les lettres à la place de la couleur du texte, transparence comprise ; l\'encre coule dedans ; aucun point hors des lettres ne change', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-fond-texte')
    try {
      const T = 'mjs-fl-fond-texte'
      await page.waitForFunction(() => { const r = (document.querySelector('mjs-fl-fond-texte') as any)._shadow; return ['ecrit', 'ecrit2', 'sans'].every((c) => r.querySelector('.' + c).hasAttribute('mjs-fx-fluid-text')) })
      const CREME  = [235, 232, 220]
      // rgba(10, 20, 30, .25) sur rgb(235, 232, 220)
      const REMPLI = [179, 179, 173]
      const BLANC  = [255, 255, 255]
      // hors des lettres : le bas de la balise et son bord droit n'ont aucune lettre, ils montrent le fond de la balise
      const dehors = async (classe: string) => [await couleurEcran(page, T, classe, [0, 0.92, 1, 1], CREME), await couleurEcran(page, T, classe, [0.85, 0, 1, 1], CREME)]
      const encre  = (l: any) => l.n - l.proches[0]
      const repos  = { ecrit: await lettresCouleur(page, T, 'ecrit', CREME, undefined, 'fond-texte-ecrit', [REMPLI]), sans: await lettresCouleur(page, T, 'sans', CREME, undefined, 'fond-texte-sans', [BLANC]), ecrit2: await lettresCouleur(page, T, 'ecrit2', CREME, undefined, '', [REMPLI]) }
      const d0     = await dehors('ecrit')
      console.log(`  ℹ️  fond écrit en texte, au repos : ${JSON.stringify(repos)} · hors des lettres ${JSON.stringify(d0)}`)
      assert.ok(repos.ecrit.n > 1500 && proche(repos.ecrit.rgb, REMPLI, 2), `avec un fond écrit, les lettres ont cette couleur (transparence comprise), pas celle du texte : ${JSON.stringify(repos.ecrit)}`)
      assert.ok(repos.sans.n > 1500 && proche(repos.sans.rgb, BLANC, 2), `sans fond écrit, les lettres gardent la couleur du texte : ${JSON.stringify(repos.sans)}`)
      for (const f of d0) assert.deepEqual([f.rgb, f.hors], [CREME, 0], `rien ne change hors des lettres : ${JSON.stringify(f)}`)
      // un geste : l'encre coule dans les lettres, rien ne change hors d'elles
      const TRAIT = Array.from({ length: 25 }, (_, k) => [40 + 16 * k, 80 + 30 * Math.sin(k / 3)])
      await scenes(page, T, 'ecrit', { depart: TRAIT[0], pas: TRAIT.slice(1), lectures: [8], rappel: true })
      await page.waitForTimeout(300)
      const pendant = await lettresCouleur(page, T, 'ecrit', CREME, undefined, 'fond-texte-ecrit-geste', [REMPLI])
      const d1      = await dehors('ecrit')
      assert.ok(encre(pendant) > encre(repos.ecrit) + 300, `l'encre coule dans les lettres : ${encre(pendant)} points qui ne sont plus au remplissage, contre ${encre(repos.ecrit)} avant`)
      for (const f of d1) assert.deepEqual([f.rgb, f.hors], [CREME, 0], `pendant le geste, rien ne change hors des lettres : ${JSON.stringify(f)}`)
      // une fois l'encre effacée : de nouveau le remplissage, rien d'autre
      await scenes(page, T, 'ecrit2', { depart: TRAIT[0], pas: TRAIT.slice(1), lectures: [600], rappel: true })
      await page.waitForTimeout(300)
      const apres = await lettresCouleur(page, T, 'ecrit2', CREME, undefined, '', [REMPLI])
      const d2    = await dehors('ecrit2')
      assert.ok(apres.n > 1500 && proche(apres.rgb, REMPLI, 2) && encre(apres) <= encre(repos.ecrit2) + 40, `une fois l'encre effacée, les lettres ont de nouveau le remplissage : ${JSON.stringify(apres)}`)
      for (const f of d2) assert.deepEqual([f.rgb, f.hors], [CREME, 0], `une fois l'encre effacée, rien ne change hors des lettres : ${JSON.stringify(f)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : sans fond écrit, chaque lettre a la couleur de son élément (un mot d\'une autre couleur garde la sienne, une couleur translucide reste exacte), avant tout geste, pendant un geste loin de l\'encre et une fois l\'encre effacée', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-lettres')
    try {
      const T = 'mjs-fl-lettres'
      await page.waitForFunction(() => { const r = (document.querySelector('mjs-fl-lettres') as any)._shadow; return ['clair', 'sombre', 'mots', 'trans', 'fin'].every((c) => r.querySelector('.' + c).hasAttribute('mjs-fx-fluid-text')) })
      const FOND = [235, 232, 220]
      const CLAIR = [20, 60, 140]
      // au repos : chaque balise montre ses lettres dans la couleur de son texte (valeur médiane de chaque canal, à deux niveaux près)
      const repos = { clair: await lettresCouleur(page, T, 'clair', FOND, undefined, 'lettres-clair-repos', [CLAIR]), sombre: await lettresCouleur(page, T, 'sombre', [12, 14, 30], undefined, 'lettres-sombre-repos'), trans: await lettresCouleur(page, T, 'trans', [0, 0, 0], undefined, 'lettres-translucide-repos') }
      console.log(`  ℹ️  lettres au repos : ${JSON.stringify(repos)}`)
      for (const [k, att] of [['clair', CLAIR], ['sombre', [250, 220, 90]], ['trans', [128, 128, 128]]] as Array<[string, number[]]>) {
        const m = (repos as any)[k]
        assert.ok(m.n > 1500 && proche(m.rgb, att, 2), `${k} : les lettres ont la couleur du texte ${att} (transparence comprise) ; vu ${JSON.stringify(m)}`)
      }
      // un mot d'une autre couleur garde la sienne, le reste garde celle de la balise
      const mot = await page.evaluate(() => {
        const b = (document.querySelector('mjs-fl-lettres') as any)._shadow.querySelector('.mots')
        const s = b.querySelector('.autre')
        b.scrollIntoView({ block: 'start' })
        const rb = b.getBoundingClientRect()
        const rs = s.getBoundingClientRect()
        return [(rs.left - rb.left) / rb.width, 0, (rs.right - rb.left) / rb.width, 1]
      })
      const dans  = await lettresCouleur(page, T, 'mots', FOND, mot, 'lettres-mots')
      const avant = await lettresCouleur(page, T, 'mots', FOND, [0, 0, mot[0] - 0.01, 1])
      console.log(`  ℹ️  deux couleurs dans un titre : le mot ${JSON.stringify(dans)} · avant lui ${JSON.stringify(avant)}`)
      assert.ok(dans.n > 800 && proche(dans.rgb, [200, 40, 40], 2), `le mot d'une autre couleur a la sienne : ${JSON.stringify(dans)}`)
      assert.ok(avant.n > 800 && proche(avant.rgb, [30, 90, 30], 2), `le reste du titre a la couleur de la balise : ${JSON.stringify(avant)}`)
      // pendant un geste (tout à gauche) : loin de l'encre, les lettres gardent la couleur du texte ; près d'elle l'encre coule dedans
      const TOUR = Array.from({ length: 25 }, (_, k) => point([50, 50], 30, k * 30))
      const gaucheAv = await lettresCouleur(page, T, 'clair', FOND, [0, 0, 0.3, 1], '', [CLAIR])
      await scenes(page, T, 'clair', { depart: TOUR[0], pas: TOUR.slice(1), lectures: [8], rappel: true })
      await page.waitForTimeout(300)
      const loin   = await lettresCouleur(page, T, 'clair', FOND, [0.5, 0, 1, 1], 'lettres-clair-geste-loin', [CLAIR])
      const pres   = await lettresCouleur(page, T, 'clair', FOND, [0, 0, 0.3, 1], 'lettres-clair-geste', [CLAIR])
      console.log(`  ℹ️  pendant le geste : loin de l'encre ${JSON.stringify(loin)} · près d'elle ${JSON.stringify(pres)}`)
      assert.ok(loin.n > 800 && proche(loin.rgb, CLAIR, 2) && loin.proches[0] > 0.75 * loin.n, `loin de l'encre, les lettres gardent la couleur du texte : ${JSON.stringify(loin)}`)
      assert.ok(pres.n - pres.proches[0] > gaucheAv.n - gaucheAv.proches[0] + 200, `près de l'encre, elle coule dans les lettres : ${pres.n - pres.proches[0]} points qui ne sont plus à la couleur du texte, contre ${gaucheAv.n - gaucheAv.proches[0]} avant le geste`)
      // une fois l'encre effacée (dix secondes) : les lettres ont de nouveau la couleur du texte
      await scenes(page, T, 'fin', { depart: TOUR[0], pas: TOUR.slice(1), lectures: [600], rappel: true })
      await page.waitForTimeout(300)
      const fin = await lettresCouleur(page, T, 'fin', FOND, undefined, 'lettres-clair-fin', [CLAIR])
      console.log(`  ℹ️  dix secondes après : ${JSON.stringify(fin)}`)
      assert.ok(fin.n > 1500 && proche(fin.rgb, CLAIR, 2) && fin.proches[0] > 0.8 * fin.n, `une fois l'encre effacée, les lettres ont la couleur du texte : ${JSON.stringify(fin)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  // ---- les lettres suivent la couleur du texte quand elle change, au repos : aucun geste, aucune souris
  const A_SUITE = [20, 60, 140]
  const B_SUITE = [250, 220, 90]
  const R_SUITE = [200, 40, 40]
  const FOND_SUITE = [235, 232, 220]
  const pretes = (page: any) => page.waitForFunction(() => { const r = (document.querySelector('mjs-fl-suite') as any)._shadow; return ['theme', 'classe', 'desc', 'trans', 'dt', 'ecrit'].every((c) => r.querySelector('.' + c).hasAttribute('mjs-fx-fluid-text')) })
  const dans   = (sel: string, code: string) => `(() => { const b = document.querySelector('mjs-fl-suite')._shadow.querySelector('${sel}'); ${code} })()`

  it('where: text : les lettres suivent la couleur du texte au repos, sans geste — bascule du thème (data-mjs-theme, class ou style de <html> ou de <body>) et schéma de couleurs du système', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-suite', { css: CSS_SUITE })
    try {
      const T = 'mjs-fl-suite'
      await pretes(page)
      const avant = await lettresCouleur(page, T, 'theme', FOND_SUITE, undefined, 'suite-theme-avant')
      assert.ok(avant.n > 1000 && proche(avant.rgb, A_SUITE, 2), `au départ, les lettres ont la couleur de la page : ${JSON.stringify(avant)}`)
      const faire = (f: string | (() => Promise<void>)) => typeof f === 'string' ? page.evaluate(f) : f()
      const bascule = async (nom: string, aller: string | (() => Promise<void>), retour: string | (() => Promise<void>), cible: number[], capture = '') => {
        await faire(aller)
        const la = await jusquaLettres(page, T, 'theme', FOND_SUITE, cible, capture)
        assert.ok(la.n > 1000 && proche(la.rgb, cible, 3), `${nom} : sans geste, les lettres prennent ${cible} ; vu ${JSON.stringify(la)}`)
        // un fond écrit remplit les lettres à la place de la couleur du texte : la balise qui en a un n'a rien à suivre
        const fixe = await lettresCouleur(page, T, 'ecrit', FOND_SUITE)
        assert.ok(fixe.n > 1000 && proche(fixe.rgb, [179, 179, 173], 3), `${nom} : les lettres au fond écrit gardent leur remplissage : ${JSON.stringify(fixe)}`)
        await faire(retour)
        const ici = await jusquaLettres(page, T, 'theme', FOND_SUITE, A_SUITE)
        assert.ok(ici.n > 1000 && proche(ici.rgb, A_SUITE, 3), `${nom} : et reviennent à ${A_SUITE} ; vu ${JSON.stringify(ici)}`)
      }
      await bascule('data-mjs-theme de <html>', `document.documentElement.setAttribute('data-mjs-theme', 'sombre')`, `document.documentElement.removeAttribute('data-mjs-theme')`, B_SUITE, 'suite-theme-apres')
      await bascule('class de <body>', `document.body.classList.add('sombre')`, `document.body.classList.remove('sombre')`, R_SUITE)
      // un thème dont <body> fait glisser la couleur : la balise en hérite sans transition à elle, la couleur n'est lue qu'à la fin de la transition de <body>
      await page.evaluate(`document.body.classList.add('lent')`)
      await bascule('class de <body>, transition de color sur <body>', `document.body.classList.add('sombre')`, `document.body.classList.remove('sombre')`, R_SUITE)
      await page.evaluate(`document.body.classList.remove('lent')`)
      await bascule('style de <html>', `document.documentElement.style.color = 'rgb(250, 220, 90)'`, `document.documentElement.style.color = ''`, B_SUITE)
      await bascule('style de <body>', `document.body.style.color = 'rgb(250, 220, 90)'`, `document.body.style.color = ''`, B_SUITE)
      // le schéma de couleurs du système : aucune mutation du document, seul l'écouteur de la préférence peut le voir
      await page.evaluate(`document.documentElement.className = 'suit'`)
      await bascule('prefers-color-scheme', () => page.emulateMedia({ colorScheme: 'dark' }), () => page.emulateMedia({ colorScheme: 'light' }), B_SUITE)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : les lettres suivent un changement de class ou de style de la balise ou d\'un de ses descendants ; une mutation qui ne change aucune couleur ne redessine rien', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-suite', { css: CSS_SUITE })
    try {
      const T = 'mjs-fl-suite'
      await pretes(page)
      const vers = async (classe: string, faire: string, cible: number[], nom: string) => {
        await page.evaluate(faire)
        const m = await jusquaLettres(page, T, classe, FOND_SUITE, cible)
        assert.ok(m.n > 1000 && proche(m.rgb, cible, 3), `${nom} : les lettres prennent ${cible} sans geste ; vu ${JSON.stringify(m)}`)
      }
      const ini = await lettresCouleur(page, T, 'classe', FOND_SUITE)
      assert.ok(ini.n > 1000 && proche(ini.rgb, A_SUITE, 2), `au départ : ${JSON.stringify(ini)}`)
      await vers('classe', dans('.classe', `b.classList.add('b')`), R_SUITE, 'class de la balise')
      await vers('classe', dans('.classe', `b.classList.remove('b')`), A_SUITE, 'class de la balise retirée')
      await vers('desc', dans('.desc .s', `b.classList.add('b')`), R_SUITE, 'class d\'un descendant')
      await vers('desc', dans('.desc .s', `b.classList.remove('b'); b.style.color = 'rgb(250, 220, 90)'`), B_SUITE, 'style d\'un descendant')
      await vers('desc', dans('.desc .s', `b.style.color = ''`), A_SUITE, 'style d\'un descendant retiré')
      await vers('classe', dans('.classe', `b.style.color = 'rgb(250, 220, 90)'`), B_SUITE, 'style de la balise')
      // une classe, un style ou une variable qui ne changent aucune couleur : la signature est relue, rien n'est redessiné
      await vers('classe', dans('.classe', `b.style.color = ''`), A_SUITE, 'style de la balise retiré')
      assert.ok(await calme(page, 700), 'plus aucune image demandée avant la mutation neutre')
      const dessins = () => page.evaluate(() => (window as any).__dessins)
      const d0 = await dessins()
      await page.evaluate(dans('.classe', `b.classList.add('neutre'); b.style.setProperty('--zz', '1'); b.style.margin = '0px'`))
      await page.evaluate(dans('.desc .s', `b.classList.add('neutre'); b.style.setProperty('--zz', '1')`))
      await page.waitForTimeout(700)
      assert.equal(await dessins(), d0, 'une mutation qui ne change aucune couleur ne redessine rien')
      assert.ok(await calme(page, 500), 'et ne demande aucune image')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : pendant une transition CSS de color (sur la balise ou sur un descendant), les lettres suivent la couleur image par image jusqu\'à la couleur d\'arrivée', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-suite', { css: CSS_SUITE })
    try {
      const T = 'mjs-fl-suite'
      await pretes(page)
      // la transition est posée sur la balise (`trans`) ou sur son descendant (`dt`) ; `cible` : l'élément dont la couleur est lue
      for (const [classe, cible] of [['trans', '.trans'], ['dt', '.dt .s2']]) {
        const calcule = () => page.evaluate((sel: string) => getComputedStyle((document.querySelector('mjs-fl-suite') as any)._shadow.querySelector(sel)).color.match(/\d+/g)!.slice(0, 3).map(Number), cible)
        const ini = await lettresCouleur(page, T, classe, FOND_SUITE)
        assert.ok(ini.n > 1000 && proche(ini.rgb, A_SUITE, 2), `${classe} au départ : ${JSON.stringify(ini)}`)
        // trois secondes, linéaire, de (20, 60, 140) à (250, 220, 90) : pendant qu'elle court, les lettres sont à la couleur calculée au même instant
        await page.evaluate(dans(cible, `b.classList.add('b')`))
        const vus: Array<{ c1: number[], c2: number[], rgb: number[], n: number }> = []
        const fin = Date.now() + 5000
        while (Date.now() < fin) {
          const c1 = await calcule()
          const m  = await lettresCouleur(page, T, classe, FOND_SUITE, undefined, classe === 'trans' && vus.length === 3 ? 'suite-transition-milieu' : '')
          const c2 = await calcule()
          vus.push({ c1, c2, rgb: m.rgb, n: m.n })
          if (proche(c2, B_SUITE, 1)) break
        }
        const entre = (v: { c1: number[], c2: number[], rgb: number[] }) => v.rgb.every((x, k) => x >= Math.min(v.c1[k], v.c2[k]) - 6 && x <= Math.max(v.c1[k], v.c2[k]) + 6)
        const milieu = vus.filter((v) => v.c1[0] > A_SUITE[0] + 0.15 * (B_SUITE[0] - A_SUITE[0]) && v.c2[0] < A_SUITE[0] + 0.85 * (B_SUITE[0] - A_SUITE[0]))
        console.log(`  ℹ️  transition de color (${classe}) : ${vus.length} lectures dont ${milieu.length} entre 15 et 85 % ; ` + vus.slice(0, 8).map((v) => `${v.rgb} dans [${v.c1} ; ${v.c2}]`).join(' · '))
        assert.ok(milieu.length >= 1, `${classe} : au moins une lecture pendant la transition (entre 15 et 85 % du chemin), où des lettres restées à la couleur de départ seraient hors de l'intervalle : ${milieu.length} sur ${vus.length}`)
        for (const v of vus) if (v.n > 1000) assert.ok(entre(v), `${classe} : pendant la transition, les lettres sont à la couleur du texte au même instant : lettres ${v.rgb}, couleur calculée de ${v.c1} à ${v.c2}`)
        const arrivee = await jusquaLettres(page, T, classe, FOND_SUITE, B_SUITE)
        assert.ok(arrivee.n > 1000 && proche(arrivee.rgb, B_SUITE, 3), `${classe} : à la fin de la transition, la couleur d'arrivée : ${JSON.stringify(arrivee)}`)
        // la transition finie (plus aucune animation en cours), la série d'images qui lit la couleur d'arrivée finit à son tour (la relecture, puis l'image de rappel) : ensuite plus rien
        await page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 8000 })
        await page.waitForTimeout(400)
        assert.ok(await calme(page, 900), `${classe} : puis plus aucune image demandée`)
      }
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : hors écran un changement de couleur ne dessine ni ne demande aucune image ; au retour à l\'écran les lettres ont la nouvelle couleur', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-suite', { css: CSS_SUITE })
    try {
      const T = 'mjs-fl-suite'
      await pretes(page)
      assert.ok(await calme(page, 700), 'rien ne tourne avant')
      await page.evaluate(() => window.scrollTo(0, 2500))
      await page.waitForTimeout(800)
      const compte = () => page.evaluate(() => [(window as any).__dessins, (window as any).__raf])
      const a = await compte()
      await page.evaluate(`document.documentElement.setAttribute('data-mjs-theme', 'sombre')`)
      await page.evaluate(dans('.classe', `b.classList.add('b')`))
      await page.waitForTimeout(1200)
      const b = await compte()
      assert.deepEqual([b[0] - a[0], b[1] - a[1]], [0, 0], 'hors écran, un changement de couleur ne dessine rien et ne demande aucune image')
      await page.evaluate(() => window.scrollTo(0, 0))
      const theme = await jusquaLettres(page, T, 'theme', FOND_SUITE, B_SUITE)
      const classe = await jusquaLettres(page, T, 'classe', FOND_SUITE, R_SUITE)
      assert.ok(theme.n > 1000 && proche(theme.rgb, B_SUITE, 3), `au retour à l'écran, le thème a changé les lettres : ${JSON.stringify(theme)}`)
      assert.ok(classe.n > 1000 && proche(classe.rgb, R_SUITE, 3), `au retour à l'écran, la classe a changé les lettres : ${JSON.stringify(classe)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : un thème posé par un autre attribut que data-mjs-theme (data-theme de <html>, un attribut de <body>) est suivi au repos, sans geste', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-suite', { css: CSS_SUITE })
    try {
      const T = 'mjs-fl-suite'
      await pretes(page)
      const bascule = async (nom: string, aller: string, retour: string, cible: number[]) => {
        await page.evaluate(aller)
        const la = await jusquaLettres(page, T, 'theme', FOND_SUITE, cible)
        assert.ok(la.n > 1000 && proche(la.rgb, cible, 3), `${nom} : sans geste, les lettres prennent ${cible} ; vu ${JSON.stringify(la)}`)
        await page.evaluate(retour)
        const ici = await jusquaLettres(page, T, 'theme', FOND_SUITE, A_SUITE)
        assert.ok(ici.n > 1000 && proche(ici.rgb, A_SUITE, 3), `${nom} : et reviennent à ${A_SUITE} ; vu ${JSON.stringify(ici)}`)
      }
      await bascule('data-theme de <html>', `document.documentElement.setAttribute('data-theme', 'sombre')`, `document.documentElement.removeAttribute('data-theme')`, B_SUITE)
      await bascule('un attribut de <body>', `document.body.setAttribute('data-autre', '1')`, `document.body.removeAttribute('data-autre')`, R_SUITE)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : une variable de <html> réécrite soixante fois par seconde ne fait relire les balises que toutes les 150 ms au plus, sans dessin ni image ; le dernier changement n\'est jamais perdu et se voit en moins de 250 ms', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-suite', { css: CSS_SUITE })
    try {
      const T = 'mjs-fl-suite'
      await pretes(page)
      assert.ok(await calme(page, 700), 'rien ne tourne avant')
      const lectures = () => page.evaluate(() => (window as any).__styles)
      const compte   = () => page.evaluate(() => [(window as any).__dessins, (window as any).__raf])
      // une relecture isolée : ce qu'elle coûte en lectures de style pour les balises à l'écran
      const l0 = await lectures()
      await page.evaluate(`document.documentElement.style.setProperty('--p', '0')`)
      await page.waitForTimeout(500)
      const une = (await lectures()) - l0
      assert.ok(une >= 6, `une relecture lit le style de chaque balise à l'écran : ${une} lectures`)
      // cent vingt réécritures, à soixante par seconde : la première relecture part aussitôt, puis une par fenêtre de 150 ms, la dernière à la fermeture de la dernière fenêtre
      const a  = await compte()
      const l1 = await lectures()
      const duree = await page.evaluate(() => new Promise<number>((fin) => {
        const debut = performance.now()
        let i = 0
        const iv = setInterval(() => {
          document.documentElement.style.setProperty('--p', String(++i))
          if (i >= 120) { clearInterval(iv); fin(performance.now() - debut) }
        }, 1000 / 60)
      }))
      await page.waitForTimeout(400)
      const lues  = (await lectures()) - l1
      const borne = une * (2 + duree / 150)
      const b     = await compte()
      console.log(`  ℹ️  ${une} lectures par relecture ; 120 réécritures en ${Math.round(duree)} ms : ${lues} lectures (au plus ${Math.round(borne)}), dessins et images en plus : ${b[0] - a[0]}, ${b[1] - a[1]}`)
      assert.ok(lues <= borne, `relectures regroupées : ${lues} lectures de style pour ${Math.round(duree)} ms de réécritures, au plus ${Math.round(borne)} (${une} par relecture, une par fenêtre de 150 ms)`)
      assert.ok(lues >= 2 * une, `et elles ont lieu : ${lues} lectures`)
      assert.deepEqual([b[0] - a[0], b[1] - a[1]], [0, 0], 'rien n\'a changé : aucun dessin, aucune image demandée')
      // le dernier changement tombe dans une fenêtre ouverte : il est relu à sa fermeture, en moins de 250 ms, et les lettres le montrent
      await page.evaluate(async () => {
        const w: any = window
        document.documentElement.style.setProperty('--p', 'y')
        await new Promise((r) => setTimeout(r, 30))
        w.__marque = performance.now()
        w.__apres = null
        document.documentElement.setAttribute('data-mjs-theme', 'sombre')
      })
      await page.waitForTimeout(400)
      const delai = await page.evaluate(() => (window as any).__apres === null ? null : (window as any).__apres - (window as any).__marque)
      assert.notEqual(delai, null, 'le dernier changement, arrivé pendant une fenêtre ouverte, est relu à sa fermeture : il n\'est jamais relu')
      assert.ok(delai >= 0 && delai < 250, `le dernier changement est relu en moins de 250 ms : ${delai} ms`)
      const fin = await jusquaLettres(page, T, 'theme', FOND_SUITE, B_SUITE)
      assert.ok(fin.n > 1000 && proche(fin.rgb, B_SUITE, 3), `et les lettres le montrent : ${JSON.stringify(fin)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : le schéma de couleurs du système, seul (aucune mutation du document), change les lettres : l\'écouteur de la préférence est le seul à le voir', async function () {
    if (!present) { this.skip(); return }
    // la page pose son thème : le cœur ne recopie pas la préférence du système dans `data-mjs-theme`
    const { page, erreurs } = await ouvre('mjs-fl-suite', { css: CSS_SUITE, html: ' data-mjs-theme="light"' })
    try {
      const T = 'mjs-fl-suite'
      await pretes(page)
      // la règle de la préférence ne s'applique qu'avec cette classe ; elle ne change encore rien (schéma clair)
      await page.evaluate(`document.documentElement.className = 'suit'`)
      const clair = await jusquaLettres(page, T, 'theme', FOND_SUITE, A_SUITE)
      assert.ok(clair.n > 1000 && proche(clair.rgb, A_SUITE, 3), `schéma clair : les lettres gardent ${A_SUITE} ; vu ${JSON.stringify(clair)}`)
      await page.waitForTimeout(500)
      await page.emulateMedia({ colorScheme: 'dark' })
      const sombre = await jusquaLettres(page, T, 'theme', FOND_SUITE, B_SUITE)
      assert.ok(sombre.n > 1000 && proche(sombre.rgb, B_SUITE, 3), `schéma sombre : les lettres prennent ${B_SUITE} sans qu'aucun attribut ne bouge ; vu ${JSON.stringify(sombre)}`)
      assert.equal(await page.evaluate(`document.documentElement.getAttribute('data-mjs-theme')`), 'light', 'le document n\'a pas bougé : seule la préférence du système a changé')
      await page.emulateMedia({ colorScheme: 'light' })
      const retour = await jusquaLettres(page, T, 'theme', FOND_SUITE, A_SUITE)
      assert.ok(retour.n > 1000 && proche(retour.rgb, A_SUITE, 3), `et revient à ${A_SUITE} ; vu ${JSON.stringify(retour)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : hors écran, un changement de thème ne lit aucun style calculé (ni relecture, ni image, ni dessin) ; au retour à l\'écran les lettres ont la nouvelle couleur', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-suite', { css: CSS_SUITE })
    try {
      const T = 'mjs-fl-suite'
      await pretes(page)
      assert.ok(await calme(page, 700), 'rien ne tourne avant')
      await page.evaluate(() => window.scrollTo(0, 2500))
      await page.waitForTimeout(800)
      const compte = () => page.evaluate(() => [(window as any).__styles, (window as any).__dessins, (window as any).__raf])
      const a = await compte()
      await page.evaluate(`document.documentElement.setAttribute('data-mjs-theme', 'sombre')`)
      await page.evaluate(`document.body.setAttribute('data-autre', '1')`)
      await page.evaluate(`document.documentElement.style.setProperty('--p', '1')`)
      await page.evaluate(dans('.classe', `b.classList.add('b')`))
      await page.waitForTimeout(1200)
      const b = await compte()
      assert.deepEqual([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [0, 0, 0], 'hors écran : aucune lecture de style, aucun dessin, aucune image demandée')
      await page.evaluate(() => window.scrollTo(0, 0))
      const retour = await jusquaLettres(page, T, 'classe', FOND_SUITE, R_SUITE)
      assert.ok(retour.n > 1000 && proche(retour.rgb, R_SUITE, 3), `au retour à l'écran, les lettres ont la couleur du corps de page : ${JSON.stringify(retour)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : une transition de color annulée en route (transitioncancel) arrête la lecture image par image : plus aucune image demandée, les lettres ont la couleur d\'arrivée', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-suite', { css: CSS_SUITE })
    try {
      const T = 'mjs-fl-suite'
      await pretes(page)
      assert.ok(await calme(page, 700), 'rien ne tourne avant')
      await page.evaluate(dans('.trans', `b.classList.add('b')`))
      await page.waitForTimeout(500)
      assert.equal(await calme(page, 300), false, 'la transition court (trois secondes) : la boucle lit la couleur à chaque image')
      // le navigateur annule la transition : elle ne se termine pas, elle est annulée
      assert.ok(await page.evaluate(dans('.trans', `return b.getAnimations().length`)) > 0, 'une transition court sur la balise')
      await page.evaluate(dans('.trans', `b.style.transition = 'none'`))
      await page.waitForFunction(`document.querySelector('mjs-fl-suite')._shadow.querySelector('.trans').getAnimations().length === 0`, null, { timeout: 8000 })
      await page.waitForTimeout(500)
      assert.ok(await calme(page, 900), 'la transition est annulée : plus aucune image demandée')
      const arrivee = await jusquaLettres(page, T, 'trans', FOND_SUITE, B_SUITE)
      assert.ok(arrivee.n > 1000 && proche(arrivee.rgb, B_SUITE, 3), `et les lettres ont la couleur d'arrivée : ${JSON.stringify(arrivee)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : sous un fond écrit, une transition de color ne fait demander aucune image (la couleur du texte ne se voit pas) ; le remplissage reste celui qui est écrit', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-fond-transition')
    try {
      const T = 'mjs-fl-fond-transition'
      await page.waitForFunction(() => (document.querySelector('mjs-fl-fond-transition') as any)._shadow.querySelector('.fige').hasAttribute('mjs-fx-fluid-text'))
      assert.ok(await calme(page, 700), 'rien ne tourne avant')
      const REMPLI = [179, 179, 173]
      const avant = await lettresCouleur(page, T, 'fige', FOND_SUITE)
      assert.ok(avant.n > 1000 && proche(avant.rgb, REMPLI, 3), `au départ, les lettres ont le remplissage écrit : ${JSON.stringify(avant)}`)
      await page.evaluate(`document.querySelector('mjs-fl-fond-transition')._shadow.querySelector('.fige').classList.add('b')`)
      await page.waitForTimeout(200)
      const r0 = await raf(page)
      await page.waitForTimeout(1000)
      const r1 = await raf(page)
      const anims = `document.querySelector('mjs-fl-fond-transition')._shadow.querySelector('.fige').getAnimations().length`
      assert.ok(await page.evaluate(anims) > 0, 'la transition court encore (trois secondes)')
      assert.ok(r1 - r0 <= 2, `pendant la transition, ${r1 - r0} images demandées (aucune : la couleur du texte ne se voit pas sous un fond écrit)`)
      await page.waitForFunction(anims + ' === 0', null, { timeout: 8000 })
      await page.waitForTimeout(400)
      const apres = await lettresCouleur(page, T, 'fige', FOND_SUITE)
      assert.ok(apres.n > 1000 && proche(apres.rgb, REMPLI, 3), `la transition finie, les lettres ont toujours le remplissage écrit : ${JSON.stringify(apres)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text : un fond écrit est résolu par le navigateur dans le contexte de la balise (currentColor, light-dark(), color-mix(), var()) et suit le schéma de couleurs du système', async function () {
    if (!present) { this.skip(); return }
    // la page pose son thème : le cœur ne recopie pas la préférence du système dans `data-mjs-theme`, seul l'écouteur de la préférence peut voir le changement
    const { page, erreurs, avertissements } = await ouvre('mjs-fl-fond-contexte', { html: ' data-mjs-theme="light"' })
    try {
      const T = 'mjs-fl-fond-contexte'
      await page.waitForFunction(() => { const r = (document.querySelector('mjs-fl-fond-contexte') as any)._shadow; return ['courant', 'clair', 'melange', 'variable', 'degrade', 'image', 'jumelle'].every((c) => r.querySelector('.' + c).hasAttribute('mjs-fx-fluid-text')) })
      const CREME = [235, 232, 220]
      const GRIS  = [128, 128, 128]
      // [balise, fond de la balise, couleur des lettres] : currentColor = la couleur du texte de la balise ; un dégradé et une image valent « rien d'écrit » : la couleur du texte
      const attendu: Array<[string, number[], number[]]> = [['courant', CREME, [20, 60, 140]], ['clair', GRIS, [17, 17, 17]], ['melange', CREME, [100, 0, 100]], ['variable', CREME, [0, 120, 60]], ['degrade', CREME, [30, 90, 30]], ['image', CREME, [30, 90, 30]]]
      for (const [classe, fond, rgb] of attendu) {
        const m = await lettresCouleur(page, T, classe, fond, undefined, classe === 'courant' || classe === 'clair' ? 'fond-contexte-' + classe : '')
        assert.ok(m.n > 1000 && proche(m.rgb, rgb, 3), `${classe} : les lettres sont ${rgb} ; vu ${JSON.stringify(m)}`)
      }
      // le schéma de couleurs du système bascule sans qu'aucun attribut du document ne bouge : light-dark() prend sa seconde couleur
      await page.emulateMedia({ colorScheme: 'dark' })
      const sombre = await jusquaLettres(page, T, 'clair', GRIS, [238, 238, 238], 'fond-contexte-clair-sombre')
      assert.ok(sombre.n > 1000 && proche(sombre.rgb, [238, 238, 238], 3), `light-dark() en schéma sombre : les lettres sont 238 ; vu ${JSON.stringify(sombre)}`)
      await page.emulateMedia({ colorScheme: 'light' })
      const clair = await jusquaLettres(page, T, 'clair', GRIS, [17, 17, 17])
      assert.ok(clair.n > 1000 && proche(clair.rgb, [17, 17, 17], 3), `et de nouveau 17 en schéma clair ; vu ${JSON.stringify(clair)}`)
      // le dégradé (deux balises) et l'image : pas des couleurs, un avertissement chacun ; aucun pour les couleurs
      const dits = (mot: string) => avertissements.filter((a) => a.includes(mot)).length
      assert.deepEqual([dits('linear-gradient'), dits('url(x.gif)'), avertissements.length], [2, 1, 3], `un avertissement par balise et par valeur qui n'est pas une couleur (le dégradé sur deux balises, l'image), aucun pour les couleurs : ${JSON.stringify(avertissements)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text et « réduire les animations » : aucun mouvement, mais les lettres suivent encore la couleur du texte', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-suite', { css: CSS_SUITE, calme: true })
    try {
      const T = 'mjs-fl-suite'
      await pretes(page)
      // les taches figées recouvrent une bonne part des lettres (près de neuf sur dix) : on compte ce qui reste à la couleur attendue, et rien à l'autre
      const part = async (vers: number[], autre: number[]) => {
        const fin = Date.now() + 8000
        let m = await lettresCouleur(page, T, 'theme', FOND_SUITE, undefined, '', [vers, autre])
        while (!(m.n > 1000 && m.proches[0] > 0.05 * m.n) && Date.now() < fin) {
          await page.waitForTimeout(150)
          m = await lettresCouleur(page, T, 'theme', FOND_SUITE, undefined, '', [vers, autre])
        }
        return m
      }
      const avant = await part(A_SUITE, B_SUITE)
      assert.ok(avant.n > 1000 && avant.proches[0] > 0.05 * avant.n && avant.proches[1] < 0.01 * avant.n, `en mode calme, les lettres ont la couleur de la page : ${JSON.stringify(avant)}`)
      await page.evaluate(`document.documentElement.setAttribute('data-mjs-theme', 'sombre')`)
      const apres = await part(B_SUITE, A_SUITE)
      assert.ok(apres.n > 1000 && apres.proches[0] > 0.05 * apres.n && apres.proches[1] < 0.01 * apres.n, `en mode calme, la bascule du thème change les lettres : ${JSON.stringify(apres)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('background : toute couleur CSS s\'écrit en clair (rgba, barre oblique, hsl, hexadécimal avec transparence, nom, transparent, var()) et se voit au repos par-dessus le fond de la balise ; l\'encre se dessine par-dessus', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, avertissements } = await ouvre('mjs-fl-fond-forme')
    try {
      const T = 'mjs-fl-fond-forme'
      const BASE = [200, 30, 30]
      const vu: Record<string, any> = { temoin: await couleurEcran(page, T, 'temoin', undefined, BASE, 'forme-temoin'), sans: await couleurEcran(page, T, 'sans', undefined, BASE, 'forme-sans') }
      for (const [c, , att] of ECRITURES_FOND) vu[c] = await couleurEcran(page, T, c, undefined, att, c === 'rgba' ? 'forme-rgba-repos' : '')
      console.log(`  ℹ️  fond écrit, au repos (médiane de chaque canal, points écartés) : ${Object.entries(vu).map(([k, v]) => `${k} ${v.rgb} (${v.hors})`).join(' · ')}`)
      assert.deepEqual([vu.temoin.rgb, vu.temoin.hors], [BASE, 0], `la balise témoin, sans l'effet, garde son fond : ${JSON.stringify(vu.temoin)}`)
      assert.deepEqual([vu.sans.rgb, vu.sans.hors], [BASE, 0], `sans fond écrit, la balise montre exactement son propre fond : ${JSON.stringify(vu.sans)}`)
      for (const [c, e, att] of ECRITURES_FOND) assert.ok(proche(vu[c].rgb, att, 2) && vu[c].hors === 0, `${e} sur ${BASE} : ${att} à deux niveaux près, partout ; vu ${JSON.stringify(vu[c])}`)
      // l'encre se dessine par-dessus le fond écrit
      const r = await rect(page, T, '.rgba')
      await geste(page, r)
      const pres = await couleurEcran(page, T, 'rgba', undefined, [100, 15, 15], 'forme-rgba-geste')
      assert.ok(pres.hors > 100, `l'encre se voit par-dessus le fond écrit : ${pres.hors} points écartés`)
      assert.deepEqual(avertissements, [], 'aucune de ces écritures ne prévient')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('background : un texte qui n\'est pas une couleur vaut « rien d\'écrit » (fond transparent) et prévient une fois par balise et par valeur, en boîte comme en texte ; une valeur qui change prévient de nouveau', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, avertissements } = await ouvre('mjs-fl-fond-faux')
    try {
      const T = 'mjs-fl-fond-faux'
      await page.waitForFunction(() => (document.querySelector('mjs-fl-fond-faux') as any)._shadow.querySelector('.d').hasAttribute('mjs-fx-fluid-text'))
      const BASE = [200, 30, 30]
      const clic = (classe: string) => page.evaluate((c: string) => ((document.querySelector('mjs-fl-fond-faux') as any)._shadow.querySelector('.' + c) as HTMLElement).click(), classe)
      await page.waitForTimeout(300)
      const dit = () => avertissements.filter((m) => /la\scouleur\s«/.test(m)).map((m) => m.replace(/^.*la\scouleur\s«\s([^»]*?)\s».*$/, '$1'))
      // à la pose : une fois par balise et par valeur, deux balises de même valeur préviennent chacune
      assert.deepEqual([...dit()].sort(), ['ceci-non-plus', 'pas-une-couleur', 'pas-une-couleur', 'rien-non-plus'], `à la pose : ${avertissements.join(' | ')}`)
      const a = await couleurEcran(page, T, 'a', undefined, BASE, 'faux-a')
      const c = await couleurEcran(page, T, 'c', undefined, BASE)
      assert.deepEqual([a.rgb, a.hors, c.rgb, c.hors], [BASE, 0, BASE, 0], `traité comme « rien d'écrit » : la balise montre son propre fond : ${JSON.stringify([a, c])}`)
      // en texte : les lettres gardent la couleur du texte, aucun rectangle de plus
      const d = await lettresCouleur(page, T, 'd', BASE, undefined, 'faux-d', [[255, 255, 255]])
      const bas = await couleurEcran(page, T, 'd', [0, 0.92, 1, 1], BASE)
      assert.ok(d.n > 1500 && proche(d.rgb, [255, 255, 255], 2) && bas.hors === 0, `en texte aussi : lettres blanches, pas de rectangle : ${JSON.stringify([d, bas])}`)
      // une autre valeur fausse prévient ; la première revenue, déjà dite pour cette balise, ne prévient plus ; une couleur valide ne prévient pas
      await clic('x')
      await page.waitForTimeout(200)
      assert.equal(dit().length, 5, `une valeur fausse de plus : ${dit()}`)
      assert.equal(dit()[4], 'autre-faux')
      await clic('y')
      await page.waitForTimeout(200)
      assert.equal(dit().length, 5, `la valeur déjà dite pour cette balise ne prévient pas de nouveau : ${dit()}`)
      await clic('z')
      await page.waitForTimeout(200)
      assert.equal(dit().length, 5, 'une couleur valide ne prévient pas')
      const demi = await couleurEcran(page, T, 'c', undefined, [100, 15, 15])
      assert.deepEqual([demi.rgb, demi.hors], [[100, 15, 15], 0], `et elle se voit : ${JSON.stringify(demi)}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('texte posé : sans aucun geste, les lettres se voient peu après la pose (la dernière image dessinée est présentée, même par un navigateur qui ne la montre qu\'avec la suivante), puis plus aucune image ne vient', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-texte-fond')
    try {
      await page.waitForFunction(() => (document.querySelector('mjs-fl-texte-fond') as any)._shadow.querySelector('.f').hasAttribute('mjs-fx-fluid-text'))
      const r = await rect(page, 'mjs-fl-texte-fond')
      // aucune souris : rien ne dessine une seconde image à la place de l'auteur, et pourtant les lettres sont là (noires sur la page rouge)
      const p = await jusqua(page, r, (q) => q.noir > 2000, 4000)
      assert.ok(p.noir > 2000 && p.rouge > 2000, `les lettres se voient sans geste : ${JSON.stringify(p)}`)
      // l'image de rappel est faite : plus aucune image demandée, plus aucun dessin
      assert.ok(await calme(page, 700), 'plus aucune image demandée')
      const dessins = await page.evaluate(() => (window as any).__dessins)
      await page.waitForTimeout(700)
      assert.equal(await page.evaluate(() => (window as any).__dessins), dessins, 'plus aucun dessin au repos')
      console.log(`  ℹ️  texte posé sans geste : ${dessins} dessins en tout (l'image et son rappel ; un de plus quand une police finit de charger entre les deux)`)
      // l'image et son rappel font deux dessins ; une police qui finit de charger entre les deux refait le masque, et le rappel devient une vraie image qu'un rappel suit : trois.
      // Ce plafond de 3 suppose des polices déjà prêtes à la pose (la balise est ajoutée après le chargement) : avec une police web lente, qui finit de charger après le rappel,
      // une série de plus se dessine, 4 dessins (mesuré dans Chromium, Firefox et WebKit)
      assert.ok(dessins >= 2 && dessins <= 3, `l'image et son rappel, trois dessins au plus : ${dessins}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('texte posé : le texte ne devient transparent qu\'à l\'image qui suit la première — la première image est présentée avec les lettres, jamais une page sans lettres', async function () {
    if (!present) { this.skip(); return }
    // horloge tenue dès la pose : le test avance chaque image, et lit l'état de la balise entre deux
    const { page, erreurs } = await ouvre('mjs-fl-texte-fond', { tenue: true })
    try {
      await page.waitForFunction(() => (window as any).__avance(0) > 0, null, { polling: 50, timeout: 10000 })
      const etat = () => page.evaluate(() => {
        const f = (document.querySelector('mjs-fl-texte-fond') as any)._shadow.querySelector('.f')
        return { dessins: (window as any).__dessins as number, transparent: f.hasAttribute('mjs-fx-fluid-text') as boolean }
      })
      const avance = () => page.evaluate(() => (window as any).__avance(1))
      const pose = await etat()
      await avance()
      const premiere = await etat()
      await avance()
      const seconde = await etat()
      await page.evaluate(() => { (window as any).__vide(); (window as any).__manuel = false })
      console.log(`  ℹ️  texte posé, image par image : ${pose.dessins} dessin(s) à la pose, ${premiere.dessins} après la première image (texte transparent : ${premiere.transparent}), ${seconde.dessins} après la suivante (texte transparent : ${seconde.transparent})`)
      assert.equal(pose.transparent, false, 'avant toute image, les lettres sont du texte')
      assert.ok(premiere.dessins > pose.dessins, 'la première image est dessinée')
      assert.equal(premiere.transparent, false, 'avec la première image les lettres sont encore du texte : un navigateur qui ne la montre qu\'avec la suivante ne laisse pas la page sans lettres')
      assert.equal(seconde.transparent, true, 'à l\'image qui suit, le texte devient transparent')
      assert.ok(seconde.dessins > premiere.dessins, 'et cette image est dessinée avec le texte devenu transparent')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('image de rappel : un geste qui arrive entre la fin du mouvement et le rappel donne une vraie image, le rappel n\'avale rien', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-vite')
    try {
      const r = await page.evaluate(() => {
        const w: any = window
        const el = (document.querySelector('mjs-fl-vite') as any)._shadow.querySelector('.f')
        const b = el.getBoundingClientRect()
        const evt = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { clientX: b.left + x, clientY: b.top + y, isPrimary: true, bubbles: type === 'pointermove' }))
        const trait = (x: number) => { evt('pointerenter', 20, 20); evt('pointermove', 20, 20); evt('pointermove', x, 80) }
        // une image à horloge tenue : le nombre de dessins qu'elle fait, et ce qui reste en attente
        const image = () => { const avant = w.__dessins; const reste = w.__avance(1); return [w.__dessins - avant, reste] }
        w.__manuel = true
        // une série entière : des images de mouvement, puis le rappel (un seul dessin) et plus rien
        trait(120)
        const dessins: number[] = []
        for (let i = 0; i < 600; i++) {
          const [d, reste] = image()
          dessins.push(d)
          if (!reste) break
        }
        const reelles = dessins.length - 1
        // la même série, arrêtée juste avant le rappel : il attend ; un nouveau geste arrive, l'image suivante doit être une vraie image
        trait(120)
        for (let i = 0; i < reelles; i++) image()
        const enAttente = w.__avance(0)
        trait(200)
        const [suivante] = image()
        w.__vide()
        w.__manuel = false
        return { fin: dessins.slice(-2), reelles, enAttente, suivante }
      })
      assert.equal(r.fin[1], 1, `la série finit par le rappel, un seul dessin : ${JSON.stringify(r)}`)
      assert.ok(r.reelles > 10 && r.fin[0] > 1, `des images de mouvement avant le rappel : ${JSON.stringify(r)}`)
      assert.equal(r.enAttente, 1, `le rappel attend : ${JSON.stringify(r)}`)
      assert.ok(r.suivante > 1, `l'image qui suit le geste est une vraie image, pas le rappel : ${r.suivante} dessin(s)`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('effets économes : quand le moteur passe en mode économe, l\'effet posé repart avec une grille de l\'encre au tiers', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-halo')
    try {
      const r = await rect(page, 'mjs-fl-halo')
      await geste(page, r)
      const normal = await page.evaluate(() => Math.max(...(window as any).__textures.map((t: number[]) => t[0])))
      assert.ok(normal >= 400, `en temps normal, le halo a ses textures : ${normal}`)
      const etat = await page.evaluate(() => {
        const w: any = window
        const el = (document.querySelector('mjs-fl-halo') as any)._shadow.querySelector('.f')
        w.__cv = el.querySelector('canvas')
        w.__retrait = el._mjs_fxOff.fluid
        w.__textures.length = 0
        // la mesure du moteur conclut que l'appareil peine
        w.µ._mjs_fxGoLite()
        return { autreToile: el.querySelector('canvas') !== w.__cv, ancienneRetiree: !w.__cv.isConnected, autreRetrait: el._mjs_fxOff.fluid !== w.__retrait }
      })
      assert.deepEqual(etat, { autreToile: true, ancienneRetiree: true, autreRetrait: true }, 'l\'effet lourd est retiré puis reposé par le moteur')
      await geste(page, r)
      const econome = await page.evaluate(() => Math.max(...(window as any).__textures.map((t: number[]) => t[0])))
      assert.ok(econome > 0 && econome <= normal / 3, `économe : des textures plus petites : ${econome} contre ${normal}`)
      assert.ok(nonUni(await lit(page, await photo(page, r))), 'de l\'encre malgré tout')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('la boîte se lit à l\'entrée de la souris, pas à chaque mouvement', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-boite')
    try {
      const r = await rect(page, 'mjs-fl-boite')
      // les mesures de la boîte (rectangle, largeur, hauteur, bordure) sont comptées pendant un geste de trente mouvements
      await page.evaluate(() => {
        const w: any = window
        const el = (document.querySelector('mjs-fl-boite') as any)._shadow.querySelector('.f')
        w.__lectures = 0
        const vrai = Element.prototype.getBoundingClientRect
        Element.prototype.getBoundingClientRect = function (this: any) { if (this === el) w.__lectures++; return vrai.call(this) }
        for (const [proto, nom] of [[HTMLElement.prototype, 'offsetWidth'], [HTMLElement.prototype, 'offsetHeight'], [Element.prototype, 'clientLeft'], [Element.prototype, 'clientTop']] as any) {
          const d = Object.getOwnPropertyDescriptor(proto, nom)!
          Object.defineProperty(proto, nom, { configurable: true, get(this: any) { if (this === el) w.__lectures++; return d.get!.call(this) } })
        }
      })
      await page.mouse.move(790, 590)
      await geste(page, r)
      const lectures = await page.evaluate(() => (window as any).__lectures)
      console.log(`  ℹ️  mesures de la boîte pour trente mouvements : ${lectures}`)
      // sept lectures par mesure de la boîte : à l'entrée de la souris, puis une fois de plus quand le premier geste crée le contexte (la taille est relue) ;
      // lue à chaque mouvement, la boîte coûterait deux cent dix lectures
      assert.ok(lectures <= 40, `la boîte est lue à l'entrée de la souris, pas à chaque mouvement : ${lectures} mesures pour trente mouvements`)
      assert.ok(nonUni(await lit(page, await photo(page, r, 'lectures'))), 'de l\'encre malgré tout')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('la boîte lue à l\'entrée est relue après un défilement de la page : l\'encre tombe là où est la souris', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-defile')
    try {
      const r = await rect(page, 'mjs-fl-defile')
      const images = () => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))))
      // la souris entre dans la boîte (haute de 400 px, en haut de la fenêtre) et y balaie à 60 px du haut, puis la page défile de 150 px
      // sous elle : la souris est toujours dans la boîte, qui est montée de 150 px — son premier encrage est hors de la fenêtre
      await page.mouse.move(790, 590)
      for (let i = 0; i <= 12; i++) {
        await page.mouse.move(r.x + 40 + i * 26, 60)
        await page.waitForTimeout(8)
      }
      await page.evaluate(() => window.scrollBy(0, 150))
      await images()
      // un second balayage à la même hauteur de la fenêtre : la boîte relue y met l'encre ; la boîte d'avant le défilement la mettrait
      // à 150 px plus haut, hors de la fenêtre
      for (let i = 0; i <= 20; i++) {
        await page.mouse.move(r.x + 40 + i * 16, 60)
        await page.waitForTimeout(8)
      }
      const bande = await lit(page, await photo(page, { x: 0, y: 10, width: 400, height: 100 }, 'defile'))
      assert.ok(bande.vif > 1500, `l'encre est sous la souris après le défilement : ${bande.vif} points vifs dans la bande`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('plus de contexte à donner : la balise reste comme sans effet, un seul avertissement, pas de nouvelle demande à chaque mouvement ; elle retente à son prochain réveil', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, avertissements } = await ouvre('mjs-fl-boite')
    try {
      const r = await rect(page, 'mjs-fl-boite')
      const toiles = () => page.evaluate(() => (document.querySelector('mjs-fl-boite') as any)._shadow.querySelector('.f').querySelectorAll('canvas').length)
      const refus = () => page.evaluate(() => (window as any).__refus)
      // le navigateur n'a plus de contexte à donner : le premier geste le demande
      await page.evaluate(() => { (window as any).__plein = true })
      await geste(page, r)
      const sans = await lit(page, await photo(page, r, 'sans-contexte'))
      assert.equal(sans.noir, sans.total, `comme sans effet : la boîte garde son fond d'origine (celui de la balise, noir) : ${sans.noir} / ${sans.total}`)
      assert.equal(await toiles(), 0, 'plus de toile')
      assert.equal(avertissements.length, 1, avertissements.join('\n'))
      assert.match(avertissements[0], /contexte/)
      const demandes = await refus()
      assert.ok(demandes >= 1, 'le contexte a bien été demandé')
      await geste(page, r, 2)
      assert.equal(await refus(), demandes, 'pas de nouvelle demande à chaque mouvement')
      // un contexte redevient disponible : au prochain réveil (la souris sort puis rentre), la balise retente
      await page.evaluate(() => { (window as any).__plein = false })
      await page.mouse.move(790, 590)
      await geste(page, r)
      const avec = await lit(page, await photo(page, r, 'contexte-retrouve'))
      assert.ok(nonUni(avec), `l'encre est de retour : ${avec.vif}`)
      assert.equal(await toiles(), 1)
      assert.equal(await vivants(page), 1)
      assert.equal(avertissements.length, 1, 'toujours un seul avertissement')
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('contexte perdu que le navigateur ne rend pas : la balise reste comme sans effet, puis une toile neuve au réveil', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, avertissements } = await ouvre('mjs-fl-boite')
    try {
      const r = await rect(page, 'mjs-fl-boite')
      await geste(page, r)
      assert.ok(nonUni(await lit(page, await photo(page, r))), 'de l\'encre avant la perte')
      await page.evaluate(() => {
        const w: any = window
        w.__ancienne = (document.querySelector('mjs-fl-boite') as any)._shadow.querySelector('.f').querySelector('canvas')
        w.__gl.find((g: any) => !g.isContextLost()).getExtension('WEBGL_lose_context').loseContext()
      })
      await page.waitForFunction(() => !(document.querySelector('mjs-fl-boite') as any)._shadow.querySelector('.f').querySelector('canvas'), null, { timeout: 5000 })
      const sans = await lit(page, await photo(page, r, 'perdu-sans-effet'))
      assert.equal(sans.noir, sans.total, `comme sans effet : ${sans.noir} / ${sans.total}`)
      assert.equal(avertissements.length, 1, avertissements.join('\n'))
      await page.mouse.move(790, 590)
      await geste(page, r)
      const avec = await lit(page, await photo(page, r, 'perdu-repris'))
      assert.ok(nonUni(avec), `l'encre est de retour : ${avec.vif}`)
      const neuve = await page.evaluate(() => {
        const w: any = window
        const c = (document.querySelector('mjs-fl-boite') as any)._shadow.querySelector('.f').querySelector('canvas')
        return { autre: c !== w.__ancienne, vivants: w.__gl.filter((g: any) => !g.isContextLost()).length }
      })
      assert.deepEqual(neuve, { autre: true, vivants: 1 }, 'une toile neuve, un seul contexte vivant')
      assert.equal(avertissements.length, 1)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('au-delà de la limite de contextes du navigateur : chaque balise montre son fluide ou reste comme sans effet, jamais noire et morte', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, avertissements } = await ouvre('mjs-fl-nombreux')
    try {
      // chaque balise : sans toile (comme sans effet), ou avec une toile dont le contexte vit
      const bilan = () => page.evaluate(() => {
        const w: any = window
        const boites = [...(document.querySelector('mjs-fl-nombreux') as any)._shadow.querySelectorAll('.f')]
        let vivantes = 0, sans = 0, mortes = 0
        for (const b of boites) {
          const c = b.querySelector('canvas')
          if (!c) { sans++; continue }
          const g = w.__gl.find((x: any) => x.canvas === c)
          if (g && !g.isContextLost()) vivantes++
          else mortes++
        }
        return { vivantes, sans, mortes, total: boites.length }
      })
      const fin = Date.now() + 40000
      let b = await bilan()
      while (b.mortes > 0 && Date.now() < fin) {
        await page.waitForTimeout(300)
        b = await bilan()
      }
      assert.equal(b.mortes, 0, `aucune balise noire et morte : ${JSON.stringify(b)}`)
      assert.equal(b.vivantes + b.sans, b.total)
      if (b.sans === 0) { this.skip(); return }
      assert.ok(b.vivantes >= 8, `les autres balises vivent : ${JSON.stringify(b)}`)
      assert.equal(avertissements.length, 1, avertissements.join('\n'))
      // cette page dépasse la limite exprès : le navigateur le dit lui-même quand il perd le plus ancien contexte (WebKit en erreur, les autres en avertissement), et
      // WebKit ajoute que le contexte de l'essai de prise en charge, que l'effet avait déjà rendu, l'est aussi (« context already lost ») ; rien d'autre ne doit être dit
      assert.deepEqual(erreurs.filter((e) => !/too many active WebGL contexts|loseContext: context already lost/.test(e)), [])
    } finally {
      await page.close()
    }
  })

  it('colors écrites avec var(…) : lues dans la portée de la balise, à la pose et dans set ; une couleur qui ne se résout pas prévient une fois', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, avertissements } = await ouvre('mjs-fl-var')
    try {
      // à la pose : --accent est vert
      const rf = await rect(page, 'mjs-fl-var', '.f')
      await geste(page, rf)
      const vert = await lit(page, await photo(page, rf, 'var-pose'))
      assert.ok(vert.encreVerte > 300, `à la pose, l'encre est verte (--accent) : ${vert.encreVerte}`)
      assert.ok(vert.encreVerte > vert.vif * 0.7, `presque que du vert : ${vert.encreVerte} / ${vert.vif}`)
      // dans set : --autre est bleu
      await page.evaluate(() => {
        const g = (document.querySelector('mjs-fl-var') as any)._shadow.querySelector('.g')
        ;(window as any).µ._mjs_fxSet(g, 'fluid', { colors: ['var(--autre)'] }, null)
      })
      const rg = await rect(page, 'mjs-fl-var', '.g')
      await geste(page, rg)
      const bleu = await lit(page, await photo(page, rg, 'var-set'))
      assert.ok(bleu.encreBleue > 300, `après set, l'encre est bleue (--autre) : ${bleu.encreBleue}`)
      assert.ok(bleu.encreBleue > bleu.vif * 0.7, `presque que du bleu : ${bleu.encreBleue} / ${bleu.vif}`)
      assert.equal(avertissements.length, 1, 'une seule couleur ne se résout pas : ' + avertissements.join('\n'))
      // une variable absente : un avertissement qui la nomme, jamais une encre noire (les teintes vives reprennent)
      assert.match(avertissements[0], /var\(--absente\)/)
      const rh = await rect(page, 'mjs-fl-var', '.h')
      await geste(page, rh)
      const vive = await lit(page, await photo(page, rh, 'var-absente'))
      assert.ok(nonUni(vive), `la couleur écartée ne laisse pas une encre noire : ${vive.vif}`)
      await page.evaluate(() => {
        const h = (document.querySelector('mjs-fl-var') as any)._shadow.querySelector('.h')
        ;(window as any).µ._mjs_fxSet(h, 'fluid', { colors: ['var(--absente)'] }, null)
      })
      assert.equal(avertissements.length, 1, 'le même reproche n\'est pas répété : ' + avertissements.join('\n'))
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('where: text sur un composant : le texte du composant reste tel quel, le fluide se pose en box, un avertissement', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, avertissements } = await ouvre('mjs-fl-compose')
    try {
      await page.waitForFunction(() => !!(document.querySelector('mjs-fl-compose') as any)._shadow.querySelector('.f')?._shadow?.querySelector('.x'))
      // le cas fautif rend le texte transparent dès la première image du fluide : on lui laisse le temps de le faire
      await page.waitForFunction(() => (document.querySelector('mjs-fl-compose') as any)._shadow.querySelector('.f').hasAttribute('mjs-fx-fluid-text'), null, { timeout: 2500 }).catch(() => null)
      const etat = await page.evaluate(() => {
        const comp = (document.querySelector('mjs-fl-compose') as any)._shadow.querySelector('.f')
        const p = comp._shadow.querySelector('.x')
        return { marque: comp.hasAttribute('mjs-fx-fluid-text'), remplissage: getComputedStyle(p).webkitTextFillColor, couleur: getComputedStyle(p).color, toiles: comp._shadow.querySelectorAll('canvas[mjs-fx-layer]').length, texte: p.textContent }
      })
      assert.equal(etat.marque, false, 'le texte du composant n\'est pas rendu transparent')
      assert.equal(etat.remplissage, etat.couleur, 'le texte du composant garde sa couleur')
      assert.equal(etat.texte, 'Bonjour')
      assert.equal(etat.toiles, 1, 'le fluide est posé dans le composant')
      assert.equal(avertissements.length, 1, avertissements.join('\n'))
      assert.match(avertissements[0], /composant/)
      // en box : de l'encre verte, par-dessus le fond, après des mouvements de souris
      const r = await rect(page, 'mjs-fl-compose')
      await geste(page, r)
      const p = await lit(page, await photo(page, r, 'composant'))
      assert.ok(p.encreVerte > 300, `de l'encre verte en box : ${p.encreVerte}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  // ---- la physique de l'encre, jugée sur ce qu'on voit : une scène à horloge tenue par balise (le résultat ne dépend ni de la vitesse de la machine ni
  // de la cadence des évènements), l'encre blanche qui ne s'efface pas, aucun crochet dans l'effet
  const scenes = (page: any, tag: string, classe: string, plan: any) => page.evaluate(([t, c, p]: [string, string, any]) => {
    const el = (document.querySelector(t) as any)._shadow.querySelector('.' + c)
    return (window as any).__jouer(el, p)
  }, [tag, classe, plan])
  const point  = (centre: number[], rayon: number, degres: number) => [centre[0] + rayon * Math.cos(degres * Math.PI / 180), centre[1] + rayon * Math.sin(degres * Math.PI / 180)]
  const CENTRE = [180, 110]
  // un demi-cercle de 65 px de rayon, du haut vers le bas par la droite (le sens des aiguilles d'une montre à l'écran), en huit pas
  const DEMI     = Array.from({ length: 9 }, (_, k) => point(CENTRE, 65, -90 + k * 22.5))
  const LECT_ARC = [0, 6, 12, 18, 24, 30, 36, 60, 90, 120, 180, 240]
  const lecture  = (liste: any[], f: number) => liste.find((x) => x.f === f)
  const brut     = (liste: any[], cles: string[]) => liste.map((x) => `${x.f}:` + cles.map((k) => (+x[k]).toFixed(3)).join('/')).join(' ')

  it('une tache poussée : sa taille est celle du réglage, elle avance au rythme de la poussée, la matière se conserve', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-phys')
    try {
      // un seul évènement du pointeur de 7,9 px vers la droite : une seule tache, d'encre et de vitesse, centrée en 157,9
      const m      = await scenes(page, 'mjs-fl-phys', 'pousse', { depart: [150, 110], pas: [[157.9, 110]], lectures: [0, 5, 11, 29, 59] })
      const avance = (f: number) => lecture(m, f).cx - 157.9
      console.log(`  ℹ️  tache poussée (f:rayon/avance/masse) : ` + m.map((x: any) => `${x.f}:${x.rg.toFixed(2)}/${(x.cx - 157.9).toFixed(2)}/${x.masse.toFixed(1)}`).join(' '))
      // la gaussienne exp(-r²/(size/100 × L × H)) a pour rayon quadratique la racine de sa surface : √(0,005 × 360 × 220) = 19,9 px
      assert.ok(Math.abs(m[0].rg - 19.9) <= 1.6, `la tache a la taille du réglage size : rayon quadratique ${m[0].rg.toFixed(2)} px au lieu de 19,9`)
      // la tache est poussée vers la droite, au rythme de la poussée : un cinquième de seconde plus tard, deux pixels (deux fois plus vite : l'eau transportée trop vite ; en arrière : à contre-courant)
      assert.ok(avance(11) > 0, `l'encre avance dans le sens de la poussée : ${avance(11).toFixed(2)} px`)
      assert.ok(avance(11) >= 1.7 && avance(11) <= 3.1, `à 0,2 s l'encre a avancé de ${avance(11).toFixed(2)} px (attendu entre 1,7 et 3,1 : l'eau la porte à la vitesse de la poussée)`)
      // une seconde plus tard le frottement a calmé l'eau : l'encre n'a avancé que de 6 à 10 px (sans frottement : près de 12)
      assert.ok(avance(59) >= 6 && avance(59) <= 10, `à 1 s l'encre a avancé de ${avance(59).toFixed(2)} px (attendu entre 6 et 10 : le frottement calme l'eau)`)
      // la matière se conserve et la tache ne s'étale pas
      assert.ok(lecture(m, 59).masse >= 0.95 * m[0].masse && lecture(m, 59).masse <= 1.03 * m[0].masse, `la masse d'encre se conserve : ${lecture(m, 59).masse.toFixed(1)} contre ${m[0].masse.toFixed(1)}`)
      assert.ok(lecture(m, 59).rg <= 31, `la tache ne s'étale pas : rayon ${lecture(m, 59).rg.toFixed(2)} px`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('une encre qui tourne : le sens, le rythme, l\'arrêt sous le frottement, la matière et les tourbillons sont ceux de l\'eau', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-phys')
    try {
      const plan = (lectures: number[]) => ({ depart: DEMI[0], pas: DEMI.slice(1), centre: CENTRE, lectures })
      const arc  = await scenes(page, 'mjs-fl-phys', 'arc', plan(LECT_ARC))
      const max  = await scenes(page, 'mjs-fl-phys', 'arcmax', plan(LECT_ARC))
      const frot = await scenes(page, 'mjs-fl-phys', 'arcfrot', plan([0, 6, 12, 24, 36, 60, 120]))
      const fort = await scenes(page, 'mjs-fl-phys', 'arcfort', plan([0, 6, 12, 24, 36, 60, 120]))
      console.log(`  ℹ️  arc (f:tour/rayon/masse) : ${brut(arc, ['tour', 'rayon', 'masse'])}`)
      console.log(`  ℹ️  arc curl 50 : ${brut(max, ['tour', 'rayon', 'masse'])}`)
      console.log(`  ℹ️  arc frottement 8 : ${brut(frot, ['tour', 'rayon', 'masse'])}`)
      console.log(`  ℹ️  arc brassé fort : ${brut(fort, ['tour', 'rayon', 'masse'])}`)
      // le sens : un demi-cercle tracé dans le sens des aiguilles d'une montre est emporté dans ce sens (l'angle de son centre augmente à l'écran)
      assert.ok(lecture(arc, 36).tour > 0.3, `l'encre tourne dans le sens du geste : ${lecture(arc, 36).tour.toFixed(2)} rad à 0,6 s`)
      // le rythme : la poussée du geste fait tourner l'arc de 0,15 rad dans le dixième de seconde qui suit, plus d'un demi-radian à 0,6 s
      assert.ok(lecture(arc, 6).tour >= 0.12 && lecture(arc, 6).tour <= 0.23, `à 0,1 s l'arc a tourné de ${lecture(arc, 6).tour.toFixed(3)} rad (attendu entre 0,12 et 0,23 : l'eau transporte l'encre à la vitesse qu'elle a)`)
      assert.ok(lecture(arc, 36).tour >= 0.5 && lecture(arc, 36).tour <= 0.85, `à 0,6 s l'arc a tourné de ${lecture(arc, 36).tour.toFixed(3)} rad (attendu entre 0,5 et 0,85)`)
      // la matière ne se tasse ni ne se creuse : la masse d'encre est celle du début, à 7 % près, une seconde plus tard (Firefox en perd un peu à chaque pas : 3 % de plus
      // par seconde que Chromium, l'arrondi du demi-flottant n'y est pas au plus proche) ; l'arc s'écarte peu du centre
      const masse = lecture(arc, 60).masse / lecture(arc, 0).masse
      assert.ok(masse >= 0.93 && masse <= 1.06, `la masse d'encre se conserve : ${masse.toFixed(3)} de celle du début après 1 s (attendu entre 0,93 et 1,06)`)
      assert.ok(lecture(arc, 240).rayon / lecture(arc, 0).rayon <= 1.5, `l'arc ne s'éloigne pas du centre : ${(lecture(arc, 240).rayon / lecture(arc, 0).rayon).toFixed(3)} fois son rayon`)
      // le renfort des tourbillons entretient le tourbillon : à curl 50 l'arc tourne plus vite qu'à curl 0 dans la première demi-seconde (jamais moins)
      const gain = lecture(max, 36).tour - lecture(arc, 36).tour
      assert.ok(gain > 0.05, `curl 50 entretient le tourbillon : ${gain.toFixed(3)} rad de plus qu'à curl 0 à 0,6 s (attendu plus de 0,05)`)
      // l'arrêt : un frottement fort arrête la rotation en un instant (sans frottement elle durerait plus de deux secondes)
      assert.ok(lecture(frot, 120).tour > 0 && lecture(frot, 120).tour <= 0.9, `à friction 8 l'arc s'arrête vite : ${lecture(frot, 120).tour.toFixed(3)} rad après 2 s (attendu entre 0 et 0,9, contre 2 rad sans frottement)`)
      // brassée cinq fois plus fort, l'encre tourne vite sans spiraler et sans perdre de matière
      const masseFort = lecture(fort, 120).masse / lecture(fort, 0).masse
      assert.ok(lecture(fort, 120).tour > 1.5, `brassée fort, l'encre tourne : ${lecture(fort, 120).tour.toFixed(2)} rad (attendu plus de 1,5)`)
      assert.ok(masseFort >= 0.92 && masseFort <= 1.08, `brassée fort, la masse d'encre se conserve : ${masseFort.toFixed(3)} (attendu entre 0,92 et 1,08)`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('un jet contre une paroi : l\'eau ne la traverse pas, la matière se conserve et suit le jet', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-phys')
    try {
      const lectures = [0, 6, 18, 36, 60, 120]
      // un jet vers la droite (le mur de droite est à 360) et un jet vers le bas (le mur du bas est à 220)
      const d = await scenes(page, 'mjs-fl-phys', 'jetd', { depart: [40, 110], pas: Array.from({ length: 10 }, (_, k) => [66 + 26 * k, 110]), lectures })
      const b = await scenes(page, 'mjs-fl-phys', 'jetb', { depart: [180, 20], pas: Array.from({ length: 10 }, (_, k) => [180, 20 + 16.9 * (k + 1)]), lectures })
      console.log(`  ℹ️  jet vers la droite (f:centre x/masse) : ${brut(d, ['cx', 'masse'])}`)
      console.log(`  ℹ️  jet vers le bas (f:centre y/masse) : ${brut(b, ['cy', 'masse'])}`)
      assert.ok(Math.max(...d.map((x: any) => x.cx)) - lecture(d, 0).cx > 60, `l'encre est portée vers la droite : de ${lecture(d, 0).cx.toFixed(1)} à ${Math.max(...d.map((x: any) => x.cx)).toFixed(1)} px au plus loin`)
      assert.ok(Math.max(...b.map((x: any) => x.cy)) - lecture(b, 0).cy > 25, `l'encre est portée vers le bas : de ${lecture(b, 0).cy.toFixed(1)} à ${Math.max(...b.map((x: any) => x.cy)).toFixed(1)} px au plus loin`)
      for (const [nom, liste] of [['droite', d], ['bas', b]] as Array<[string, any[]]>) {
        const rapport = lecture(liste, 120).masse / lecture(liste, 0).masse
        assert.ok(rapport >= 0.92 && rapport <= 1.06, `jet vers la paroi de ${nom} : la matière se conserve, ${rapport.toFixed(3)} de la masse d'encre du début après 2 s (attendu entre 0,92 et 1,06 : l'eau ne traverse pas la paroi)`)
      }
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  // trois tours d'une ellipse de 260 × 150 px autour du centre de la balise, vingt-huit points par tour
  const TOURS = Array.from({ length: 85 }, (_, k) => [180 + 130 * Math.cos(k / 28 * 2 * Math.PI), 110 + 75 * Math.sin(k / 28 * 2 * Math.PI)])
  const hex   = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))

  it('colors : un trait tend vers la couleur demandée, sombre ou vive, sans la dépasser ; une autre couleur recouvre celle en place', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-teinte')
    try {
      const rendu: any[] = []
      for (let i = 0; i < TEINTES.length; i++) {
        const voulu = hex(TEINTES[i])
        const [lect] = await scenes(page, 'mjs-fl-teinte', 't' + i, { depart: TOURS[0], pas: TOURS.slice(1), teintes: true, lectures: [6] })
        rendu.push(lect.teinte)
        console.log(`  ℹ️  ${TEINTES[i]} demandé ${voulu} : maximum ${lect.teinte.max} · 99e centile ${lect.teinte.p99} · cœur ${lect.teinte.coeur.map((v: number) => v.toFixed(0))}`)
        for (let c = 0; c < 3; c++) assert.ok(lect.teinte.max[c] <= voulu[c] + 3, `${TEINTES[i]} : le trait n'est jamais plus clair que la couleur demandée : canal ${c} à ${lect.teinte.max[c]} pour ${voulu[c]}`)
        const k = voulu.indexOf(Math.max(...voulu))
        assert.ok(lect.teinte.p99[k] >= 0.8 * voulu[k], `${TEINTES[i]} : le trait atteint la couleur demandée : 99e centile ${lect.teinte.p99[k]} pour ${voulu[k]}`)
      }
      // l'encre recouvre celle en place : trois tours d'une autre couleur (mise par set) sur trois tours de bleu nuit, le cœur du trait n'a plus de bleu
      const rouge = hex('#8b0000')
      const [apres] = await scenes(page, 'mjs-fl-teinte', 't4', { depart: TOURS[0], pas: [...TOURS.slice(1), ...TOURS.slice(1)], change: [TOURS.length - 1, { colors: ['#8b0000'] }], teintes: true, lectures: [6] })
      const coeur = apres.teinte.coeur
      console.log(`  ℹ️  #8b0000 par-dessus #1a1a40 : cœur ${coeur.map((v: number) => v.toFixed(0))}`)
      assert.ok(coeur[0] >= 0.8 * rouge[0], `la nouvelle couleur atteint le cœur du trait : rouge ${coeur[0].toFixed(0)} pour ${rouge[0]}`)
      assert.ok(coeur[2] <= 12, `la nouvelle couleur recouvre l'ancienne, elle ne s'y ajoute pas : bleu ${coeur[2].toFixed(0)} au cœur du trait (le bleu nuit en avait 64 : il en reste au plus un cinquième)`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('colors : deux couleurs imposées — le trait passe de l\'une à l\'autre le long de la liste, la seconde apparaît (un tour de la liste en quatre-vingts pièces de geste)', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-deux')
    try {
      // le hasard est celui d'une suite fixée (le point de départ sur la liste de couleurs se tire au hasard)
      await page.evaluate((g: number) => { let a = g; Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }, 777)
      // trois tours d'ellipse (plus de deux cents pièces de geste) : au moins deux tours de la liste, rouge puis bleu ; une teinte qui ne glisse pas ne donne jamais les deux à la fois
      // (entre le rouge et le bleu la somme des deux canaux vaut 255 : deux canaux à 170 ou plus ne viennent jamais d'une seule teinte)
      const [lect] = await scenes(page, 'mjs-fl-deux', 'deux', { depart: TOURS[0], pas: TOURS.slice(1), teintes: true, lectures: [6] })
      const max    = lect.teinte.max
      console.log(`  ℹ️  rouge puis bleu : canaux les plus vifs ${max}`)
      assert.ok(max[0] >= 170, `la première couleur apparaît : rouge ${max[0]} au plus vif (attendu au moins 170 : Chromium donne 219)`)
      assert.ok(max[2] >= 170, `la seconde couleur apparaît : bleu ${max[2]} au plus vif (attendu au moins 170 : Chromium donne 229)`)
      assert.ok(max[1] <= 20, `aucune autre couleur que les deux demandées : vert ${max[1]}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('la dose d\'encre suit la longueur du trait, pas le nombre d\'évènements : un trait quatre fois plus court dépose quatre fois moins, quatre évènements par image déposent autant qu\'un', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-dose')
    try {
      // dix images chacune : un trait de 200 px (un évènement par image), un de 50 px (idem), un de 200 px en quarante évènements (quatre par image)
      const ligne = (pas: number, n: number) => Array.from({ length: n }, (_, k) => [60 + pas * (k + 1), 110])
      const [vite]  = await scenes(page, 'mjs-fl-dose', 'vite', { depart: [60, 110], pas: ligne(20, 10), lectures: [0] })
      const [lent]  = await scenes(page, 'mjs-fl-dose', 'lent', { depart: [60, 110], pas: ligne(5, 10), lectures: [0] })
      const [dense] = await scenes(page, 'mjs-fl-dose', 'dense', { depart: [60, 110], pas: ligne(5, 40), groupe: 4, lectures: [0] })
      console.log(`  ℹ️  masse d'encre après dix images : trait rapide ${vite.masse.toFixed(1)} · lent ${lent.masse.toFixed(1)} · dense ${dense.masse.toFixed(1)}`)
      assert.ok(vite.masse > 20, `de l'encre est déposée : ${vite.masse.toFixed(1)}`)
      assert.ok(lent.masse >= 0.15 * vite.masse && lent.masse <= 0.4 * vite.masse, `un trait quatre fois plus court dépose environ quatre fois moins : ${lent.masse.toFixed(1)} contre ${vite.masse.toFixed(1)} (attendu entre 0,15 et 0,4 fois)`)
      assert.ok(dense.masse >= 0.75 * vite.masse && dense.masse <= 1.3 * vite.masse, `quatre évènements par image déposent autant qu'un : ${dense.masse.toFixed(1)} contre ${vite.masse.toFixed(1)} (attendu entre 0,75 et 1,3 fois)`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('sans couleurs imposées, un geste qui reprend après une pause (0,3 s) tire sa teinte au hasard, puis elle glisse doucement le long du trait (sans halo ni rayons, l\'encre s\'efface vite : la teinte lue est celle du coup)', async function () {
    if (!present) { this.skip(); return }
    // treize coups loin les uns des autres (l'encre d'un coup n'atteint pas celle du suivant), `ecart` images entre deux ; la teinte (en degrés) est lue
    // au point le plus vif près du coup, une image après lui ; le hasard est celui d'une suite fixée ; une page neuve par série (la boucle d'une
    // série, vidée à la main, ne repartirait pas)
    const teintes = async (ecart: number): Promise<number[]> => {
      const { page, erreurs } = await ouvre('mjs-fl-hasard')
      try {
        const h = await page.evaluate(([t, e]: [string, number]) => {
        const w: any = window
        let a = 12345
        Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
        w.__manuel = true
        const el = (document.querySelector(t) as any)._shadow.querySelector('.defaut')
        const r = el.getBoundingClientRect()
        const evt = (type: string, p: number[]) => el.dispatchEvent(new PointerEvent(type, { clientX: r.left + p[0], clientY: r.top + p[1], isPrimary: true, bubbles: type === 'pointermove' }))
        const c = el.querySelector('canvas[mjs-fx-layer]')
        let gl: any = null
        const pts = Array.from({ length: 13 }, (_, i) => [30 + 25 * i, i % 2 ? 40 : 170])
        evt('pointerenter', pts[0])
        evt('pointermove', pts[0])
        const out: number[] = []
        for (let i = 1; i < pts.length; i++) {
          evt('pointermove', pts[i])
          w.__avance(1)
          // le contexte WebGL naît au premier geste
          if (!gl) gl = w.__gl.find((x: any) => x.canvas === c)
          const px = new Uint8Array(c.width * c.height * 4)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
          let haut = -1, k = 0
          for (let y = pts[i][1] - 25; y <= pts[i][1] + 25; y++) for (let x = pts[i][0] - 25; x <= pts[i][0] + 25; x++) {
            const j = ((c.height - 1 - y) * c.width + x) * 4
            const v = Math.max(px[j], px[j + 1], px[j + 2])
            if (v > haut) { haut = v; k = j }
          }
          const rr = px[k] / 255, gg = px[k + 1] / 255, bb = px[k + 2] / 255
          const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb)
          let h = 0
          if (mx > mn) {
            h = mx === rr ? ((gg - bb) / (mx - mn)) % 6 : mx === gg ? (bb - rr) / (mx - mn) + 2 : (rr - gg) / (mx - mn) + 4
            h = (h * 60 + 360) % 360
          }
          out.push(Math.round(h))
          w.__avance(e - 1)
        }
        w.__vide()
        w.__manuel = false
        return out
      }, ['mjs-fl-hasard', ecart])
        assert.deepEqual(erreurs, [])
        return h
      } finally {
        await page.close()
      }
    }
    {
      // le nombre de changements de teinte (plus de 30° d'écart, sur le cercle) entre deux coups qui se suivent
      const changements = (h: number[]) => h.slice(1).filter((x, i) => { const d = Math.abs(x - h[i]) % 360; return Math.min(d, 360 - d) > 30 }).length
      const serre = await teintes(1)
      const espace = await teintes(30)
      console.log(`  ℹ️  teintes d'un coup par image : ${serre.join(' ')} (${changements(serre)} changements) · d'un coup toutes les trente images : ${espace.join(' ')} (${changements(espace)} changements)`)
      assert.ok(changements(serre) <= 3, `douze coups en douze images : la teinte glisse sans sauter, au plus trois changements : ${changements(serre)}`)
      assert.ok(changements(espace) >= 8, `un coup toutes les trente images (0,5 s, une pause) : chacun a sa teinte, au moins huit changements sur onze : ${changements(espace)}`)
      assert.ok(new Set(espace.map((x) => Math.round(x / 60))).size >= 4, `les teintes tirées font le tour de la roue : ${espace.join(' ')}`)
    }
  })

  it('un trait lent garde ses couleurs : à trajet égal, sa saturation reste celle du trait rapide (l\'encre recouvre celle en place, elle ne s\'additionne pas jusqu\'au blanc)', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-blanc')
    try {
      await page.evaluate((g: number) => { let a = g; Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }, 777)
      // le même trajet (une sinusoïde qui traverse la balise), parcouru en 30 images ou en 150, un évènement par image
      const trace = (n: number) => Array.from({ length: n + 1 }, (_, k) => { const u = k / n; return [40 + 280 * u, 110 + 60 * Math.sin(2 * Math.PI * 1.25 * u)] })
      const [vite] = await scenes(page, 'mjs-fl-blanc', 'vite', { depart: trace(30)[0], pas: trace(30).slice(1), lectures: [0] })
      const [lent] = await scenes(page, 'mjs-fl-blanc', 'lent', { depart: trace(150)[0], pas: trace(150).slice(1), lectures: [0] })
      console.log(`  ℹ️  à la fin du geste, saturation du trait rapide ${vite.sat.toFixed(3)} · du trait lent ${lent.sat.toFixed(3)}`)
      assert.ok(lent.sat >= 0.9 * vite.sat && lent.sat >= 0.85, `le trait lent garde ses couleurs : saturation ${lent.sat.toFixed(3)} contre ${vite.sat.toFixed(3)} pour le trait rapide (attendu au moins 0,9 fois et 0,85)`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('au réglage par défaut, l\'encre est vive après le geste, elle se voit encore une seconde plus tard et elle finit de s\'effacer avant l\'arrêt de la boucle', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-defaut')
    try {
      await page.evaluate((g: number) => { let a = g; Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }, 777)
      // un tour de cercle en soixante images, sans aucun réglage écrit (le fond noir, les teintes vives, le halo et les rayons du défaut)
      const m = await scenes(page, 'mjs-fl-defaut', 'defaut', { depart: CERCLE[0], pas: CERCLE.slice(1), lectures: [0, 60, 150, 480] })
      console.log(`  ℹ️  défaut (f:somme des valeurs/point le plus vif/part éclairée) : ` + m.map((x: any) => `${x.f}:${x.lum.toFixed(1)}/${x.haut}/${x.couvert.toFixed(3)}`).join(' '))
      assert.ok(lecture(m, 0).haut >= 200, `l'encre est vive après le geste : point le plus vif ${lecture(m, 0).haut} sur 255`)
      // à la fin du geste l'encre et son halo éclairent plus de la moitié de la balise (0,60 mesuré), une seconde plus tard presque plus rien
      assert.ok(lecture(m, 0).couvert >= 0.45 && lecture(m, 0).couvert <= 0.8, `à la fin du geste l'encre et son halo éclairent la balise : ${lecture(m, 0).couvert.toFixed(3)} des points sont éclairés (attendu entre 0,45 et 0,8, Chromium donne 0,60)`)
      assert.ok(lecture(m, 60).couvert <= 0.5 * lecture(m, 0).couvert, `et la part éclairée retombe vite : ${lecture(m, 60).couvert.toFixed(3)} une seconde plus tard (attendu au plus la moitié de ${lecture(m, 0).couvert.toFixed(3)})`)
      // une seconde plus tard il reste un peu de lumière, sans plus : l'encre s'efface vite (un vingtième de la lumière de la fin du geste, mesuré 0,046)
      assert.ok(lecture(m, 60).lum >= 0.02 * lecture(m, 0).lum && lecture(m, 60).lum <= 0.2 * lecture(m, 0).lum && lecture(m, 60).haut <= 90, `une seconde plus tard : ${(lecture(m, 60).lum / lecture(m, 0).lum).toFixed(3)} de la lumière de la fin du geste (attendu entre 0,02 et 0,2) et un point le plus vif de ${lecture(m, 60).haut} sur 255 (attendu au plus 90)`)
      assert.ok(lecture(m, 150).lum <= 0.06 * lecture(m, 0).lum, `elle s'efface : ${(lecture(m, 150).lum / lecture(m, 0).lum).toFixed(3)} de la lumière de la fin du geste à 2,5 s (attendu au plus 0,06)`)
      // la boucle ne s'arrête pas sur de l'encre encore visible : la toile est noire à l'arrêt
      assert.ok(lecture(m, 480).haut <= 3, `à l'arrêt de la boucle plus rien ne se voit : point le plus vif ${lecture(m, 480).haut} sur 255`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  // soixante pas de douze pixels autour d'un cercle de 65 px : un trait qui crée des tourbillons
  const CERCLE = Array.from({ length: 61 }, (_, k) => point(CENTRE, 65, k * 12 / 65 * 180 / Math.PI))

  it('curl : sur toute la plage le mouvement reste lisse (aucun grain de la taille d\'une case) et, sans geste, il se calme au frottement', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-lisse')
    try {
      const mesures: Record<number, any[]> = {}
      for (const c of [0, 2, 10, 50]) {
        mesures[c] = await scenes(page, 'mjs-fl-lisse', 'c' + c, { depart: CERCLE[0], pas: CERCLE.slice(1), lectures: [0, 6, 60, 144, 150] })
        console.log(`  ℹ️  curl ${c} (f:grain/mouvement) : ` + mesures[c].map((x: any) => `${x.f}:${x.grain.toFixed(5)}/${x.mouvement.toFixed(3)}`).join(' '))
      }
      for (const c of [0, 2, 10, 50]) {
        const m = mesures[c]
        // le mouvement de l'encre sur un dixième de seconde, juste après le geste puis deux secondes et demie plus tard : l'eau s'est calmée
        const calme = lecture(m, 150).mouvement / lecture(m, 6).mouvement
        assert.ok(calme <= 0.25, `curl ${c} : l'eau se calme au frottement par défaut, le mouvement de l'encre tombe à ${calme.toFixed(3)} de ce qu'il était (attendu au plus 0,25)`)
        // le grain, en valeur absolue : à la fin du geste au plus 0,0025 (mesuré : 0,0021 au plus à curl 50 ; sans douceur du renfort 0,003 à 0,005), à curl 2 au plus 0,0022 (mesuré : 0,0013 ; sans douceur 0,0034),
        // et au plus 0,0075 partout (mesuré : 0,0067 à curl 50 à 60 images ; la mise à l'écran des captures montre des tourbillons lisses sur toute la plage)
        for (const f of [0, 60, 150]) {
          const borne = f === 0 ? 0.0025 : c <= 2 ? 0.0022 : 0.0075
          assert.ok(lecture(m, f).grain <= borne, `curl ${c} : l'encre reste lisse à ${f} images, grain ${lecture(m, f).grain.toFixed(5)} (attendu au plus ${borne} ; ${lecture(mesures[0], f).grain.toFixed(5)} sans renfort)`)
        }
      }
      // plus de renfort, des tourbillons qui durent plus : le mouvement tardif (le mouvement de l'encre sur un dixième de seconde, à 2,5 s) croît avec curl
      const tard = (c: number) => lecture(mesures[c], 150).mouvement
      assert.ok(tard(2) > 1.3 * tard(0) && tard(10) >= 0.9 * tard(2) && tard(50) >= 1.6 * tard(0), `plus curl est fort, plus les tourbillons durent (Chromium : ${[0, 2, 10, 50].map((c) => tard(c).toFixed(3)).join(', ')} pour curl 0, 2, 10 et 50) : ${[0, 2, 10, 50].map((c) => tard(c).toFixed(3))}`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })

  it('curl : le défaut du code est 4, sans passer par le catalogue — setup avec des réglages vides, et set d\'une valeur absente', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvre('mjs-fl-nu')
    try {
      // la poussée du renfort des tourbillons (uKick), lue sur la carte graphique : elle ne dépend que de curl (le côté et l'image sont ceux de la séance à horloge tenue)
      const kicks = await page.evaluate(() => {
        const w: any = window
        const noms = new WeakMap<any, string>()
        let lus: number[] = []
        for (const nom of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
          const proto = (w as any)[nom]?.prototype
          if (!proto) continue
          const place = proto.getUniformLocation
          proto.getUniformLocation = function (this: any, ...a: any[]) { const l = place.apply(this, a); if (l) noms.set(l, a[1]); return l }
          const pose = proto.uniform1f
          proto.uniform1f = function (this: any, l: any, v: number) { if (noms.get(l) === 'uKick') lus.push(v); return pose.call(this, l, v) }
        }
        const el = (document.querySelector('mjs-fl-nu') as any)._shadow.querySelector('.f')
        const r = el.getBoundingClientRect()
        const evt = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, isPrimary: true, bubbles: type === 'pointermove' }))
        // l'effet posé directement par son `setup` avec ces réglages, un geste, quelques images à horloge tenue ; rend la dernière poussée
        const seance = (reglages: any, apres?: any) => {
          lus = []
          w.__manuel = true
          const off = w.µ._mjs_fxDefs.fluid.setup(el, reglages)
          evt('pointerenter', 100, 120)
          evt('pointermove', 100, 120)
          for (let i = 1; i <= 8; i++) { evt('pointermove', 100 + 20 * i, 120); w.__avance(1) }
          if (apres) { off.set(apres.cle, apres.valeur); lus = []; w.__avance(4) }
          const dernier = lus[lus.length - 1]
          w.__vide()
          w.__manuel = false
          off()
          return dernier
        }
        return {
          defaut: seance({}),
          quatre: seance({ curl: 4 }),
          deux: seance({ curl: 2 }),
          // un curl à 50, puis la valeur retirée : le défaut revient
          retrait: seance({ curl: 50 }, { cle: 'curl', valeur: undefined }),
          cinquante: seance({ curl: 50 })
        }
      })
      assert.ok(kicks.defaut > 0 && kicks.quatre > 0 && kicks.deux > 0 && kicks.cinquante > 0, 'la poussée est lue : ' + JSON.stringify(kicks))
      const proche = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(a, b)
      assert.ok(proche(kicks.defaut, kicks.quatre), `réglages vides : la poussée de curl 4 (${kicks.defaut} contre ${kicks.quatre})`)
      assert.ok(Math.abs(kicks.defaut - kicks.deux) > 0.2 * kicks.defaut, `curl 2 est une autre poussée (${kicks.deux} contre ${kicks.defaut})`)
      assert.ok(kicks.cinquante > 1.2 * kicks.defaut, `curl 50 pousse plus que le défaut (${kicks.cinquante} contre ${kicks.defaut})`)
      assert.ok(proche(kicks.retrait, kicks.quatre), `set d'une valeur absente : le défaut 4 revient (${kicks.retrait} contre ${kicks.quatre})`)
      assert.deepEqual(erreurs, [])
    } finally {
      await page.close()
    }
  })
})
