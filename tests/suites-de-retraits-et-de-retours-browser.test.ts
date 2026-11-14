// une balise à transition retirée, remise, retirée, remise : toutes les suites de un à quatre gestes alternés, à tous les écarts (une
// microtâche, une tâche, une image, 100 ms en pleine sortie, 450 ms quand la sortie de la balise est finie et qu'une sortie intérieure
// plus longue la retient encore, après la fin de tout), sont fabriquées et jouées, chacune sur sa propre balise, toutes ensemble dans la
// page. Le geste qui suit 450 ms se fait dans une image, celui qui suit 100 ms dans une tâche ; quelques suites de plus font l'inverse.
// Transitions : `:out` seul, `:in` + `:out`, `:transition`, en `*fade` et avec un effet à `tick` (qui anime l'opacité et l'espacement des
// lettres), avec ou sans balise intérieure `.global` à sortie plus longue, sur une ligne de `{for}` et sur une branche de `{if}` ; en plus,
// `*pixelate` (son filtre et sa balise cachée sont relevés) et un effet CSS de l'appli à `@keyframes`.
// À chaque image, ce que la page a peint est relevé (dans une tâche lancée depuis l'image) ; aucune suite n'a de résultat écrit à la main,
// toutes doivent tenir les mêmes règles : jamais deux balises de même clé ; aucun saut entre deux images au-delà de ce que la durée
// permet, ni apparition ni disparition d'un coup ; pendant un retrait la balise ne remonte jamais, pendant un retour elle ne redescend
// jamais ; sa sortie finie, elle reste invisible tant qu'elle est retenue, puis elle part ; revenue, elle n'est jamais invisible pendant
// son entrée et finit nette ; encore dans la page au retour, c'est la même balise qui revient ; à la fin la page montre les données,
// aucune animation ne reste sur une balise retirée, et `µdestroy` d'un composant de la balise a joué une fois s'il est parti, jamais
// s'il est là.
// Un tirage à graine fixe (les suites des défauts déjà vus y sont toujours) est joué sous Chromium en développement, en production et en
// production `"proxy": false`, et sous Firefox et WebKit en développement. `MJS_SUITES_TOUTES=1` fait jouer à Chromium, en développement,
// TOUTES les suites, un lot par balise : plusieurs passes, choisies par `MJS_SUITES_LOTS` (parts de titres séparées par `|`) ;
// `MJS_SUITES_NAVS` choisit les moteurs ; `MJS_SUITES_JOURNAL=<fichier>` y écrit les relevés bruts, une ligne JSON par lot, et
// `MJS_SUITES_REJEU=<fichier>` rejuge un tel journal sans navigateur ; `MJS_SUITES_TRACES` : le nombre de traces écrites par lot (3) ;
// `MJS_SUITES_SEULES` : les seules suites jouées (écarts joints par `|`, suites séparées par des virgules : `450|tache,450|image`),
// `MJS_SUITES_FOIS` : le nombre de balises par suite ; `MJS_SUITES_MOD=.shared` pose ce modificateur sur les transitions `*fade` de toutes les balises.
// `MJS_SUITES_CHARGE` fabrique dans la page la charge d'une page occupée (`avant:80,entre:120,image:60,apres:60,depart:40`, au choix) : le
// fil principal bloqué tant de millisecondes avant chaque retrait, entre un retour et le retrait qui le suit, pendant la première image
// qui suit un geste, dans la tâche qui suit chacune des deux premières images (leur relevé fait une tâche plus tard) ; `depart` : l'heure
// de départ que le navigateur donne aux animations nées d'un geste, repoussée d'autant, comme il le fait quand il est en retard sur ses
// images — l'animation attend alors son heure, et la balise doit garder son image ; chaque lancement en attente est repoussé une fois, et
// seulement celui d'une animation qui joue : retournée à sa borne, donc finie d'emblée, Chromium la dit prête dans la tâche même, à l'heure
// courante — elle n'attend rien. Les suites partent alors plus espacées ; les règles sont les mêmes. Sous Chromium, en développement, le tirage rejoue
// toujours ainsi son lot `{if}` à sortie intérieure (`depart: 40`). `hasard:<graine>,min:15,max:70,trou:150` : une page vraiment occupée,
// sans heure écrite par le test — le fil principal bloqué de `min` à `max` ms, toutes les 4 à `trou` ms, à des instants tirés au hasard.
// Le mode partagé (`.shared`) a aussi ses balises à lui, `{if}` à sortie intérieure, dans les trois écritures : leur tirage est joué sous
// Chromium en développement, et sous les trois moteurs avec l'heure de départ repoussée
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { charger, graves } from './helpers/liaison-navigateur.js'

// durées : sortie de la balise, son entrée quand elle est écrite à part, sortie de la balise intérieure, attente « après la fin »
const D_OUT   = 200
const D_IN    = 300
const D_INNER = 700
const FIN     = 1000

type Config = { nom: string, balise: string, si: boolean, tr: string, effet: string, inner: boolean, mod?: string }
const TRS: Record<string, string>    = { out: ':out', 'in-out': ':in + :out', tr: ':transition' }
const EFFETS: Record<string, string> = { fade: '*fade', tic: 'effet à tick', pixel: '*pixelate', appli: 'effet CSS de l\'appli' }
const CONFIGS: Config[]              = []
for (const effet of Object.keys(EFFETS)) for (const tr of Object.keys(TRS)) {
  // `*pixelate` en `:in` + `:out` : deux réglages distincts qui se passent la balise, hors de ce test ; l'effet de l'appli : `:transition`
  if ((effet === 'pixel' && tr === 'in-out') || (effet === 'appli' && tr !== 'tr')) continue
  for (const si of [false, true]) for (const inner of [false, true]) CONFIGS.push({ nom: `${si ? '{if}' : '{for}'} ${TRS[tr]} ${EFFETS[effet]}${inner ? ', sortie intérieure .global plus longue' : ''}`, balise: 'sr-' + CONFIGS.length, si, tr, effet, inner })
}
// le mode partagé : ses balises viennent après les autres, dont les suites et le tirage ne changent pas
const SANS_PARTAGE = CONFIGS.length
for (const tr of Object.keys(TRS)) CONFIGS.push({ nom: `{if} ${TRS[tr]} *fade .shared, sortie intérieure .global plus longue`, balise: 'sr-' + CONFIGS.length, si: true, tr, effet: 'fade', inner: true, mod: '.shared' })

const SCRIPT = (plus: string) => `<script>
  $l     = []
  $v     = true
  @poser = (l) -> $l = l
  @voir  = (v) -> $v = v
${plus}</script>
`
// l'effet à tick : créé une fois par page, il écrit l'opacité et l'espacement des lettres
const TIC = (nom: string, d: number) => `  unless window.__${nom}\n    window.__${nom} = true\n    µanim.create '${nom}', (node) ->\n      duration: ${d}\n      easing: 'linear'\n      tick: (t) ->\n        node.style.opacity = String(t)\n        node.style.letterSpacing = ((1 - t) * 8) + 'px'\n`

const MOD = process.env.MJS_SUITES_MOD || ''

function source(c: Config, i: number): string {
  const m     = c.effet === 'fade' ? c.mod || MOD : ''
  const e     = (d: number, sens: string) => c.effet === 'fade' ? `*fade(duration: ${d}ms)` : c.effet === 'pixel' ? `*pixelate(duration: ${d}ms)` : c.effet === 'appli' ? `*srclef(duration: ${d}ms, easing: linear)` : `*srt${i}${sens}`
  const attrs = c.tr === 'out' ? `:out${m}=${e(D_OUT, 'o')}` : c.tr === 'tr' ? `:transition${m}=${e(D_OUT, 'o')}` : `:in${m}=${e(D_IN, 'i')} :out${m}=${e(D_OUT, 'o')}`
  const plus  = c.effet === 'tic' ? TIC(`srt${i}o`, D_OUT) + (c.tr === 'in-out' ? TIC(`srt${i}i`, D_IN) : '') : ''
  const corps = `<b>${c.si ? '2' : '{r.id}'}</b><mjs-sr-temoin></mjs-sr-temoin>${c.inner ? `<span class="s" :out.global=*fade(duration: ${D_INNER}ms)>s</span>` : ''}`
  return SCRIPT(plus) + (c.si ? `{if $v}<p class="p" ${attrs}>${corps}</p>{end}` : `<ul class="l">{for r in $l by id}<li ${attrs}>${corps}</li>{end}</ul>`) + '\n<p class="pret">prêt</p>\n'
}

const SOURCES: Record<string, string> = {
  'sr.effects.mjs': '<effects>\n  *srclef(o: 0) =\n    @keyframes\n      from\n        opacity: $o\n      to\n        opacity: 1\n</effects>\n',
  // le composant de la balise : il se range à son arrivée et compte ses `µdestroy`
  'sr-temoin.mjs': `<script>
  µmount ->
    @_hote             = @getRootNode().host
    @_ligne            = @parentNode
    window.__srTemoins = window.__srTemoins ?? []
    window.__srTemoins.push(@)
  µdestroy ->
    @_morts = (@_morts ?? 0) + 1
</script>
<i class="t">t</i>
`
}
CONFIGS.forEach((c, i) => { SOURCES[c.balise + '.mjs'] = source(c, i) })

// les suites : un retrait, puis jusqu'à trois gestes alternés (retour, retrait, retour), chacun après l'un des six écarts
const ECARTS: Record<string, string> = { microtache: 'une microtâche', tache: 'une tâche', image: 'une image', 100: '100 ms', 450: '450 ms puis une image', fin: 'après la fin', '450t': '450 ms, dans une tâche', '100i': '100 ms puis une image' }
const SUITES: string[][]             = [[]]
for (let n = 1; n <= 3; n++) for (const s of SUITES.filter((x) => x.length === n - 1)) for (const e of ['microtache', 'tache', 'image', '100', '450', 'fin']) SUITES.push([...s, e])
// l'origine inverse du geste (tâche après 450 ms, image après 100 ms), sur les suites les plus courtes
for (const s of [['450t'], ['450t', 'microtache'], ['450t', 'tache'], ['100i'], ['100i', 'microtache']]) SUITES.push(s)
const enMots = (ecarts: string[]) => 'retrait' + ecarts.map((e, i) => ` · ${ECARTS[e]} · ${i % 2 ? 'retrait' : 'retour'}`).join('')

type Scenario = { id: number, config: number, ecarts: string[] }
const TOUS: Scenario[] = []
CONFIGS.forEach((_, config) => { for (const ecarts of SUITES) TOUS.push({ id: TOUS.length, config, ecarts }) })

// tirage à graine fixe : le même sous chaque moteur et dans chaque mode ; les suites des défauts déjà vus y sont toujours
function hasard(graine: number): () => number {
  let a = graine
  return () => {
    a |= 0
    a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
const TOUJOURS = ['450', '450t', '450|microtache', '450|tache', '450|image', '450t|microtache', 'fin|microtache', 'fin|tache', '100|microtache']
const alea     = hasard(20261110)
const TIRAGE   = TOUS.filter((s) => alea() < 0.02 || TOUJOURS.includes(s.ecarts.join('|')))

type Lot = { nom: string, scenarios: Scenario[], charge?: Record<string, number> }
const COMPLETS: Lot[] = CONFIGS.map((c, i) => ({ nom: c.nom + ' : toutes les suites', scenarios: TOUS.filter((s) => s.config === i) }))
const TIRES: Lot[]    = [0, 1, 2, 3].map((p) => ({ nom: `tirage à graine fixe, ${p > 1 ? '{if}' : '{for}'} ${p % 2 ? 'avec' : 'sans'} sortie intérieure`, scenarios: TIRAGE.filter((s) => s.config < SANS_PARTAGE && s.config % 4 === p) }))
// le lot `{if}` à sortie intérieure, rejoué avec l'heure de départ des animations repoussée (cf. l'en-tête) : Chromium, en développement
const RETARDE: Lot    = { nom: TIRES[3].nom + ', heure de départ des animations repoussée de 40 ms', scenarios: TIRES[3].scenarios, charge: { depart: 40 } }
// le mode partagé : son tirage, puis le même avec l'heure de départ repoussée
const PARTAGE: Lot         = { nom: 'tirage à graine fixe, mode partagé (.shared), {if} avec sortie intérieure', scenarios: TIRAGE.filter((s) => s.config >= SANS_PARTAGE) }
const PARTAGE_RETARDE: Lot = { nom: PARTAGE.nom + ', heure de départ des animations repoussée de 40 ms', scenarios: PARTAGE.scenarios, charge: { depart: 40 } }

type Bati = { racine: string, mode: string, page: (corps: string) => string }
// chaque balise hôte petite, à côté des autres : peu à peindre, même avec le filtre de `*pixelate`
const enveloppe = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>[data-cas] { display: block; float: left; width: 64px; height: 48px; overflow: hidden }</style></head><body>${corps}</body></html>`

async function construire(prod: boolean, proxy: boolean): Promise<Bati> {
  const root   = mjsTmp('sr-' + (prod ? 'prod' : 'dev') + (proxy ? '' : '-sans-proxy'))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, texte] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), texte)
  const base: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js') }
  if (prod) Object.assign(base, { env: 'prod', js: 'bundle', urlPrefix: '/out' })
  if (!proxy) base.proxy = false
  const bundler = new Bundler(base)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  if (prod) return { mode: 'bundle', racine: root, page: (corps) => enveloppe(`${corps}<script type="module" src="/out/bundle.js"></script>`) }
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const script = files.sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  return { mode: 'dev-parents-avant', racine: root, page: (corps) => enveloppe(`${corps}<script>${script}</script>`) }
}

// joué dans la page : toutes les suites du lot ensemble. Une image, un relevé par suite, fait dans une tâche lancée depuis l'image (ce
// qu'elle vient de peindre) : [heure de l'image, balises de la clé, opacité, second style (-1 sans), numéro de la balise, opacité de la
// balise intérieure (-1 sans), rang, heure du relevé, heure des animations] ; un geste : [heure, 0 retrait ou 1 retour, numéro de la balise
// encore là (0 sinon), rang]. L'heure des animations (`document.timeline.currentTime`) est celle où elles lisent leur position : celle de
// l'image le plus souvent, parfois plus tardive sur une page occupée ; gestes et relevés sont rangés par leur rang, dans l'ordre où la page
// les a faits : un relevé suit un geste quand il est fait après lui, quelle que soit l'heure de son image. Les suites partent l'une après l'autre, à quelques millisecondes d'écart : jamais toutes dans la même tâche
async function jouer(arg: any): Promise<any> {
  const pause  = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const image  = () => new Promise<number>((r) => requestAnimationFrame(r))
  const apres  = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(null); ch.port2.postMessage(0) })
  const arr    = (x: number) => Math.round(x * 100) / 100
  const op     = (n: any) => arr(Number(getComputedStyle(n).opacity))
  let serie    = 0
  let rang     = 0
  const numero = (n: any) => n.__sr || (n.__sr = ++serie)
  // la charge fabriquée (cf. l'en-tête) : le fil principal bloqué, ou l'heure de départ des animations nées d'un geste repoussée
  const charge  = arg.charge || {}
  const bloquer = (ms: number) => { const t = performance.now(); while (performance.now() - t < ms); }
  let occupees  = 0
  const charger = (x: any) => {
    if (charge.image) requestAnimationFrame(() => bloquer(charge.image))
    if (charge.apres) occupees = 2
    // une fois par lancement en attente (sa promesse `ready`), et seulement tant que l'animation n'a pas avancé d'autant : jamais une
    // animation partie n'est ramenée en arrière ; finie quand elle devient prête (retournée à sa borne), elle n'attendait aucune heure de départ
    if (charge.depart) setTimeout(() => {
      for (const b of x.balises()) for (const a of b.getAnimations({ subtree: true })) {
        if (!a.pending || a.__srDepart === a.ready) continue
        const h      = Number(a.currentTime)
        a.__srDepart = a.ready
        a.ready.then(() => { if (a.playState === 'running' && a.startTime != null && Math.abs(Number(a.currentTime) - h) < charge.depart) a.startTime = Number(a.startTime) + charge.depart }, () => null)
      }
    })
  }
  // le second style : l'espacement des lettres ramené de 0 (8 px) à 1 (aucun) ; `*pixelate` : 0 cachée, 0.5 filtrée, 1 nette
  const second = (n: any, effet: string) => {
    if (effet === 'tic') return arr(1 - (parseFloat(getComputedStyle(n).letterSpacing) || 0) / 8)
    if (effet === 'pixel') return getComputedStyle(n).visibility === 'hidden' ? 0 : /url\(/.test(n.style.filter || '') ? 0.5 : 1
    return -1
  }
  const suivis = arg.liste.map((s: any) => {
    const el     = document.querySelector('[data-cas="' + s.id + '"]') as any
    const om     = el._shadow
    const objets = {} as any
    const lignes = (ids: number[]) => ids.map((i) => objets[i] || (objets[i] = { id: i }))
    return {
      s, el, om, traj: [] as any[], gestes: [] as any[], vues: new Set<any>(), fin: null as any, parti: false, fini: false,
      balises: (): any[] => s.si ? Array.from(om.querySelectorAll('p.p')) : Array.from(om.querySelectorAll('ul.l > li')).filter((n: any) => n.firstElementChild.textContent === '2'),
      retirer: () => s.si ? el.voir(false) : el.poser(lignes([1, 3])),
      remettre: () => s.si ? el.voir(true) : el.poser(lignes([1, 2, 3]))
    }
  })
  for (const x of suivis) if (!x.s.si) x.remettre()
  await pause(900)
  let actif = true
  // une page vraiment occupée : le fil principal bloqué à des instants tirés au hasard, sans heure écrite par le test
  if (charge.hasard) {
    let g      = charge.hasard
    const rnd  = () => (g = (g * 48271) % 2147483647) / 2147483647
    const tour = () => {
      if (!actif) return
      bloquer((charge.min || 15) + rnd() * ((charge.max || 70) - (charge.min || 15)))
      setTimeout(tour, 4 + rnd() * (charge.trou || 150))
    }
    setTimeout(tour, 30)
  }
  const relever = (t: number) => {
    for (const x of suivis) {
      if (!x.parti || x.fini) continue
      const tous = x.balises()
      const b    = tous[0]
      const g    = b && x.s.inner ? b.querySelector('.s') : null
      if (b) x.vues.add(b)
      x.traj.push([arr(t), tous.length, b ? op(b) : -1, b ? second(b, x.s.effet) : -1, b ? numero(b) : 0, g ? op(g) : -1, ++rang, arr(performance.now()), arr(Number(document.timeline.currentTime))])
    }
  }
  void (async () => {
    while (actif) {
      const t = await image()
      await apres()
      if (occupees > 0) {
        occupees--
        bloquer(charge.apres)
        await apres()
      }
      if (actif) relever(t)
    }
  })()
  const attendre = (e: string): Promise<any> => {
    if (e === 'tache') return pause(0)
    if (e === 'image') return image()
    if (e === '100') return pause(100)
    if (e === '100i') return pause(100).then(image)
    if (e === '450') return pause(450).then(image)
    if (e === '450t') return pause(450)
    return pause(arg.FIN)
  }
  const jouerUne = async (x: any) => {
    for (let i = 0; i <= x.s.ecarts.length; i++) {
      if (i > 0) {
        if (x.s.ecarts[i - 1] === 'microtache') await Promise.resolve()
        else await attendre(x.s.ecarts[i - 1])
      }
      if (charge.avant && i % 2 === 0) bloquer(charge.avant)
      const b = x.balises()[0]
      if (b) x.vues.add(b)
      x.gestes.push([performance.now(), i % 2, b ? numero(b) : 0, ++rang])
      if (i % 2) x.remettre()
      else x.retirer()
      if (charge.entre && i % 2 && i < x.s.ecarts.length) setTimeout(() => bloquer(charge.entre))
      charger(x)
    }
    await pause(arg.FIN)
    // machine chargée : jusqu'à 3 s de plus pour que les animations de la balise finissent ; une animation restée pour de bon se voit encore
    for (let k = 0; k < 30 && x.balises().some((b: any) => b.getAnimations({ subtree: true }).length); k++) await pause(100)
    const tous = x.balises()
    const b    = tous[0]
    // ce qui reste sur les balises retirées : rien ne doit y jouer ni y tenir une image
    const restes = Array.from(x.vues).filter((n: any) => !n.isConnected).reduce((k: number, n: any) => k + n.getAnimations({ subtree: true }).length, 0)
    x.fin  = { n: tous.length, op: b ? op(b) : -1, v2: b ? second(b, x.s.effet) : -1, anims: b ? b.getAnimations({ subtree: true }).length : 0, svg: x.om.querySelectorAll('svg').length, restes }
    x.fini = true
  }
  await image()
  await pause(30)
  await Promise.all(suivis.map((x: any, j: number) => pause(j * arg.pas).then(() => {
    x.parti = true
    return pause(50)
  }).then(() => jouerUne(x))))
  actif = false
  await pause(50)
  const temoins = Array.from(new Set((window as any).__srTemoins || [])) as any[]
  return suivis.map((x: any) => ({ id: x.s.id, gestes: x.gestes, traj: x.traj, fin: { ...x.fin, temoins: temoins.filter((t) => t._hote === x.el && t._ligne && t._ligne.firstElementChild && t._ligne.firstElementChild.textContent === '2').map((t) => [t.isConnected ? 1 : 0, t._morts || 0]) } }))
}

// les règles que toute suite doit tenir ; rend les manquements, en mots (aucun : la suite est juste)
function manquements(c: Config, r: any): string[] {
  const v: string[]      = []
  const traj: number[][] = r.traj
  const T: number[]      = r.gestes.map((g: any) => g[0])
  const dire             = (t: number) => Math.round(t - T[0]) + ' ms'
  const dEntree          = c.tr === 'in-out' ? D_IN : D_OUT
  // les relevés faits après le geste `k` et avant le suivant ; une animation lancée par un geste est partie à la quatrième image qui le
  // suit au plus tard (une image pour naître, deux pour l'attente du mode css) : les délais se comptent depuis l'heure de cette image
  const R: number[]      = r.gestes.map((g: any) => g[3])
  const phases           = R.map((rang, k) => traj.filter((y) => y[6] > rang && (k + 1 >= R.length || y[6] < R[k + 1])))
  const partie           = (phase: number[][]) => phase[Math.min(3, phase.length - 1)][0]
  // ce qui est animé : [nom, rang dans le relevé, durée de sortie, durée de retour, palier d'un style à états, entrée écrite]
  const series: [string, number, number, number, number, boolean][] = []
  if (c.effet !== 'pixel') series.push(['opacité', 2, D_OUT, dEntree, 0, c.tr !== 'out'])
  if (c.effet === 'tic') series.push(['espacement', 3, D_OUT, dEntree, 0, c.tr !== 'out'])
  if (c.effet === 'pixel') series.push(['pixellisation', 3, D_OUT, dEntree, 0.5, c.tr !== 'out'])
  if (c.inner) series.push(['opacité de la balise intérieure', 5, D_INNER, D_INNER, 0, false])
  const double = traj.find((y) => y[1] > 1)
  if (double) v.push(`${double[1]} balises de même clé à ${dire(double[0])}`)
  for (const [nom, rang, dOut, dIn, palier, entree] of series) {
    // d'une image à la suivante : pas plus que ce que la durée permet (deux fois la pente, 0,08 de marge, un palier pour un style à
    // états) ; la durée écoulée : celle des images, celle de la page (une transition à tick part de l'heure de la page) ou celle que lisent
    // les animations (sur une page occupée, leur heure avance par à-coups), la plus longue. Aux six premières images qui suivent un geste,
    // la durée écoulée depuis ce geste : une animation née du geste reste à
    // sa première image tant que le navigateur ne lui a pas donné son heure de départ, puis rattrape d'un coup le temps passé
    for (let i = 1; i < traj.length; i++) {
      const p = traj[i - 1]
      const q = traj[i]
      if (q[6] < R[0]) continue
      const a     = p[rang]
      const b     = q[rang]
      const meme  = p[4] === q[4]
      const geste = R.filter((x) => x < q[6]).length - 1
      const avant = R.filter((x) => x < p[6]).length - 1
      const tot   = geste >= 0 && phases[geste].indexOf(q) < 6 ? q[7] - T[geste] : 0
      // de part et d'autre d'un geste : l'animation née du geste d'avant, que tous les relevés faits depuis (moins de six) montrent encore
      // à sa première image, a pu avancer sans que la page le voie (fil principal arrêté, heure de départ donnée après coup) ; le geste
      // lit sa position vraie et le relevé d'après la montre d'un coup : la durée écoulée depuis ce geste d'avant
      const fige  = avant >= 0 && avant < geste && phases[avant].length < 6 && phases[avant].every((y) => y[4] === p[4] && Math.abs(y[rang] - p[rang]) < 0.02) ? q[7] - T[avant] : 0
      const borne = palier + 2 * Math.max(q[0] - p[0], q[7] - p[7], (q[8] ?? 0) - (p[8] ?? 0), tot, fige) / Math.min(dOut, dIn) + 0.08
      let mot     = ''
      if (a >= 0 && b >= 0 && meme && Math.abs(b - a) > borne) mot = `saut de ${a} à ${b} en ${Math.round(q[0] - p[0])} ms`
      else if (a >= 0 && (b < 0 || !meme) && a > borne) mot = `balise disparue d'un coup à ${a}`
      else if ((a < 0 || !meme) && b >= 0 && entree && b > borne) mot = `balise apparue d'un coup à ${b}`
      if (mot) {
        v.push(`${nom} : ${mot}, à ${dire(q[0])}`)
        break
      }
    }
    for (let k = 0; k < T.length; k++) {
      const retour = k % 2 === 1
      const phase  = phases[k]
      // le sens : deux images de la même balise après le même geste ; l'heure de départ donnée par le navigateur corrige parfois la
      // position d'une image (25 ms de course au plus)
      const jeu = 0.04 + 25 / Math.min(dOut, dIn)
      for (let i = 1; i < phase.length; i++) {
        const a = phase[i - 1][rang]
        const b = phase[i][rang]
        if (a < 0 || b < 0 || phase[i - 1][4] !== phase[i][4]) continue
        if (retour ? b < a - jeu : b > a + jeu) {
          v.push(`${nom} : ${retour ? 'redescend pendant un retour' : 'remonte pendant un retrait'}, de ${a} à ${b}, à ${dire(phase[i][0])}`)
          break
        }
      }
      if (phase.length < 5) continue
      if (retour) {
        const tard = phase.find((y, i) => i > 3 && y[0] > partie(phase) + dIn + 80 && y[rang] >= 0 && y[rang] < 0.94)
        const vus  = phase.filter((y, i) => i >= 3 && y[0] <= partie(phase) + dIn * 0.7 && y[rang] >= 0)
        if (tard) v.push(`${nom} : encore à ${tard[rang]}, ${Math.round(tard[0] - partie(phase))} ms après le départ d'un retour (à ${dire(tard[0])})`)
        if (vus.length > 2 && vus.every((y) => y[rang] < 0.05)) v.push(`${nom} : invisible pendant son retour, ${vus.length} images de suite (à ${dire(vus[0][0])})`)
      }
      else {
        const tard = phase.find((y, i) => i > 3 && y[0] > partie(phase) + dOut + 80 && y[rang] > 0.06)
        if (tard) v.push(`${nom} : encore à ${tard[rang]}, ${Math.round(tard[0] - partie(phase))} ms après le départ d'un retrait (à ${dire(tard[0])})`)
      }
    }
  }
  for (let k = 0; k < T.length; k++) {
    const phase = phases[k]
    if (k % 2) {
      const absente = phase.find((y) => y[1] !== 1)
      const revenue = phase.find((y) => y[1] > 0)
      if (absente) v.push(`${absente[1]} balise pendant un retour, à ${dire(absente[0])}`)
      if (r.gestes[k][2] && revenue && revenue[4] !== r.gestes[k][2]) v.push(`balise refaite alors qu'elle était encore dans la page au retour, à ${dire(revenue[0])}`)
    }
    else {
      const reste = phase.find((y, i) => i > 3 && y[0] > partie(phase) + (c.inner ? D_INNER : D_OUT) + 150 && y[1] > 0)
      if (reste) v.push(`balise encore dans la page ${Math.round(reste[0] - partie(phase))} ms après le départ d'un retrait (à ${dire(reste[0])})`)
    }
  }
  // l'état final : les données
  const f  = r.fin
  const la = T.length % 2 === 0
  if (la && (f.n !== 1 || f.op < 0.99 || f.anims !== 0 || (c.effet === 'tic' && f.v2 < 0.99) || (c.effet === 'pixel' && f.v2 !== 1))) v.push(`à la fin : ${f.n} balise, opacité ${f.op}, second style ${f.v2}, ${f.anims} animation en cours — attendu : une balise nette, au repos`)
  if (!la && f.n !== 0) v.push(`à la fin : ${f.n} balise — attendu : aucune`)
  if (c.effet === 'pixel' && f.svg !== 0) v.push(`à la fin : ${f.svg} filtre de *pixelate resté dans la page`)
  if (f.restes) v.push(`à la fin : ${f.restes} animation restée sur une balise retirée`)
  const vivants = f.temoins.filter((t: number[]) => t[0])
  if (vivants.length !== (la ? 1 : 0)) v.push(`à la fin : ${vivants.length} composant dans la page — attendu : ${la ? 1 : 0}`)
  if (vivants.some((t: number[]) => t[1] !== 0)) v.push('µdestroy a joué sur un composant resté dans la page')
  if (f.temoins.some((t: number[]) => !t[0] && t[1] !== 1)) v.push(`µdestroy joué ${f.temoins.filter((t: number[]) => !t[0]).map((t: number[]) => t[1]).join(', ')} fois sur les composants partis — attendu : une fois chacun`)
  return v
}

// la trace d'une suite, image par image : `ms depuis le premier retrait:opacité/second style[opacité de la balise intérieure]`
function trace(r: any): string {
  const mots: string[] = []
  let k                = 0
  for (const y of r.traj) {
    if (y[0] < r.gestes[0][0] - 40) continue
    while (k < r.gestes.length && r.gestes[k][3] < y[6]) mots.push(r.gestes[k++][1] ? '«retour»' : '«retrait»')
    mots.push(Math.round(y[0] - r.gestes[0][0]) + ':' + (y[1] === 1 ? '' : y[1] + '×') + (y[2] < 0 ? '-' : y[2]) + (y[3] >= 0 ? '/' + y[3] : '') + (y[5] >= 0 ? '[' + y[5] + ']' : ''))
  }
  return mots.join(' ')
}

// le jugement d'un lot : chaque suite qui manque à une règle est nommée, avec ses gestes ; les premières avec leur trace
function juger(releves: any[]): void {
  const traces           = Number(process.env.MJS_SUITES_TRACES || 3)
  const rouges: string[] = []
  for (const r of releves) {
    const s = TOUS[r.id % TOUS.length]
    const v = manquements(CONFIGS[s.config], r)
    if (v.length) rouges.push(`${CONFIGS[s.config].nom} | ${enMots(s.ecarts)}\n    ${v.join('\n    ')}` + (rouges.length < traces ? `\n    trace : ${trace(r)}` : ''))
  }
  if (rouges.length) assert.fail(`${rouges.length} suites sur ${releves.length} manquent à une règle :\n  ` + rouges.slice(0, 60).join('\n  '))
}

const MODES       = [{ nom: 'développement', prod: false, proxy: true }, { nom: 'production', prod: true, proxy: true }, { nom: 'production, "proxy": false', prod: true, proxy: false }]
const NAVIGATEURS = (process.env.MJS_SUITES_NAVS || 'chromium,firefox,webkit').split(',')
const GARDES      = (process.env.MJS_SUITES_LOTS || '').split('|').filter(Boolean)
const SEULES      = (process.env.MJS_SUITES_SEULES || '').split(',').filter(Boolean)
const FOIS        = Number(process.env.MJS_SUITES_FOIS || 1)
const CHARGE: Record<string, number> = {}
for (const mot of (process.env.MJS_SUITES_CHARGE || '').split(',').filter(Boolean)) CHARGE[mot.split(':')[0]] = Number(mot.split(':')[1])
// sous charge fabriquée, les suites partent assez espacées pour que la page ne soit bloquée que la moitié du temps au plus
const pasDe       = (c: Record<string, number>) => 12 + 2 * (2 * (c.avant || 0) + (c.entre || 0) + 3 * (c.image || 0) + 4 * (c.apres || 0))
const batis       = new Map<string, Promise<Bati>>()
const bati        = (prod: boolean, proxy: boolean) => {
  const k = prod + '-' + proxy
  if (!batis.has(k)) batis.set(k, construire(prod, proxy))
  return batis.get(k) as Promise<Bati>
}
const PRET_JS = `Array.from(document.querySelectorAll('[data-cas]')).every((e) => !!(e._shadow && e._shadow.querySelector('.pret')))`

if (process.env.MJS_SUITES_REJEU) describe('suites de retraits et de retours : relevés d\'un journal, rejugés', function () {
  for (const ligne of readFileSync(process.env.MJS_SUITES_REJEU as string, 'utf-8').split('\n').filter(Boolean)) {
    const j = JSON.parse(ligne)
    it(`${j.nav}, ${j.mode} : ${j.lot} (${j.releves.length} suites)`, () => juger(j.releves))
  }
})
else for (const nav of NAVIGATEURS) describe(`suites de retraits et de retours d'une balise à transition (${nav})`, function () {
  this.timeout(240000)
  let browser: any = null
  let present      = false
  before(async function () {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) return
    browser = await playwright[nav].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })
  for (const m of MODES) {
    const complet = !!process.env.MJS_SUITES_TOUTES && nav === 'chromium' && !m.prod
    if (nav !== 'chromium' && m.prod) continue
    for (const lot of complet ? COMPLETS : m.prod ? TIRES : nav === 'chromium' ? [...TIRES, RETARDE, PARTAGE, PARTAGE_RETARDE] : [...TIRES, PARTAGE_RETARDE]) {
      const titre = `${m.nom} : ${lot.nom} (${lot.scenarios.length} suites)`
      if (GARDES.length && !GARDES.some((g) => titre.includes(g))) continue
      it(titre, async function () {
        if (!present) { this.skip(); return }
        const b     = await bati(m.prod, m.proxy)
        const joues: Scenario[] = []
        for (let k = 0; k < FOIS; k++) for (const s of lot.scenarios) if (!SEULES.length || SEULES.includes(s.ecarts.join('|'))) joues.push({ ...s, id: s.id + k * TOUS.length })
        const corps = joues.map((s) => `<mjs-${CONFIGS[s.config].balise} data-cas="${s.id}"></mjs-${CONFIGS[s.config].balise}>`).join('')
        const o     = await charger(browser, { mode: b.mode as any, racine: b.racine, document: () => b.page(corps) }, 'mjs-sr-0')
        try {
          await o.page.waitForFunction(PRET_JS, null, { timeout: 30000 })
          await o.page.waitForTimeout(300)
          const liste   = joues.map((s) => ({ id: s.id, si: CONFIGS[s.config].si, effet: CONFIGS[s.config].effet, inner: CONFIGS[s.config].inner, ecarts: s.ecarts }))
          const charge  = lot.charge || CHARGE
          const releves = await o.page.evaluate(jouer, { liste, FIN, pas: pasDe(charge), charge })
          if (process.env.MJS_SUITES_JOURNAL) appendFileSync(process.env.MJS_SUITES_JOURNAL, JSON.stringify({ nav, mode: m.nom, lot: lot.nom, releves }) + '\n')
          juger(releves)
          assert.deepEqual(graves(o), [], 'aucune erreur')
        } finally { await o.fermer() }
      })
    }
  }
})
