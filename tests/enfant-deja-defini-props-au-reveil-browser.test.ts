// un composant déjà chargé, posé plus tard avec des props dynamiques, les a dès son `µawake` : branche de `{if}`, nouvelle clé de `{key}`,
// racine d'un composant posé plus tard (petits-enfants), contenu glissé dans `<@slot>`, page d'une route, rendu du serveur hydraté ;
// développement, un fichier, découpe en modules, réglage `"proxy": false` ; l'ordre des hooks (`µawake`, `µmount`, `µsleep`, `µdestroy`)
// reste celui d'avant, valeurs mises à part, et un enfant retiré par le `µawake` de son parent joue encore `µsleep` et `µdestroy`. Le
// contenu d'un parent qui attend ses props garde ses liens préchargés dès leur apparition (`:preload="on"`), et une prop encore nulle lue
// par sa racine ne le fait pas planter, ni dans la page ni au rendu du serveur.
// Navigateur choisi par MJS_NAV (chromium par défaut, firefox, webkit ; happy-dom : ses seuls volets), modes par MJS_MODES
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { construire as construireServeur, charger as chargerServeur } from './helpers/liaison-navigateur.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const NOTE = "  note  = (q) -> window.__aw = (window.__aw or []).concat([$lib + ' ' + q + ' ' + $game])\n"
const BTN  = '<button class="p1" @click={pageOne()}>1</button><button class="off" @click={leave()}>0</button><button class="p2" @click={pageTwo()}>2</button>\n'
const NAV3 = '  pageOne = -> $on = true\n  leave   = -> $on = false\n  pageTwo = -> $on = true\n'
const RIEN = '  pageOne = -> null\n  leave   = -> null\n  pageTwo = -> null\n'

const SOURCES: Record<string, string> = {
  'c-k.mjs': "<script>\n  $game = ''\n  $lib  = ''\n" + NOTE + "  µawake -> note('awake')\n  µmount -> note('mount')\n  µsleep -> note('sleep')\n  µdestroy -> note('destroy')\n</script>\n<p class=\"vu\">{$game}</p>\n",
  'c-n.mjs': "<script>\n  $lib = ''\n  note = (q) -> window.__aw = (window.__aw or []).concat([$lib + ' ' + q])\n  µawake -> note('awake')\n  µmount -> note('mount')\n</script>\n<p>n</p>\n",
  'c-par.mjs': "<script>\n  $g   = 'prefer'\n  note = (q) -> window.__aw = (window.__aw or []).concat(['PAR ' + q])\n  µawake -> note('awake')\n  µmount -> note('mount')\n</script>\n<@c-k lib=\"par\" game={$g}></@c-k><@c-n lib=\"parn\"></@c-n>\n",
  'c-ret.mjs': "<script>\n  $g = 'prefer'\n  µawake -> document.querySelector('mjs-p-ret')._shadow.querySelector('mjs-c-ret').remove()\n</script>\n<@c-k lib=\"ret\" game={$g}></@c-k>\n",
  'c-ret2.mjs': "<script>\n  $g = 'prefer'\n  µawake -> document.querySelector('mjs-p-ret2')._shadow.querySelector('mjs-c-ret2')._shadow.querySelector('mjs-c-k').remove()\n</script>\n<@c-k lib=\"ret2\" game={$g}></@c-k>\n",
  'c-box.mjs': '<div class="b"><@slot></div>\n',
  'c-frame.mjs': "<script>\n  $game = ''\n  µawake -> µ.ajax.get(\"/app/duels/#{$game}\", (-> null), (-> null))\n</script>\n<p>{$game}</p>\n",
  'p-casc.mjs': "<script>\n  $g   = 'prefer'\n  note = (q) -> window.__aw = (window.__aw or []).concat(['ROOT ' + q])\n  µawake -> note('awake')\n  µmount -> note('mount')\n" + RIEN + "</script>\n<@c-k lib=\"casc\" game={$g}></@c-k><@c-n lib=\"cascn\"></@c-n>\n" + BTN,
  'p-cascif.mjs': "<script>\n  $on = false\n" + NAV3 + "</script>\n{if $on}<@c-par></@c-par>{end}\n" + BTN,
  'p-key.mjs': "<script>\n  $n = 0\n  $g = 'none'\n  pageOne = -> $g = 'prefer'; $n = 1\n  leave   = -> $n = 0\n  pageTwo = -> $g = 'wavelength'; $n = 2\n</script>\n{key $n}<@c-k lib=\"key\" game={$g}></@c-k>{end}\n" + BTN,
  'p-await.mjs': "<script>\n  $p = new Promise(-> null)\n  $g = 'none'\n  pageOne = -> $g = 'prefer'; $p = Promise.resolve(1)\n  leave   = -> $p = new Promise(-> null)\n  pageTwo = -> $g = 'wavelength'; $p = Promise.resolve(2)\n</script>\n{await $p}<p>...</p>{success v}<@c-k lib=\"await\" game={$g}></@c-k>{end}\n" + BTN,
  'p-sifast.mjs': "<script>\n  $on = false\n  $g  = 'prefer'\n" + NAV3 + "</script>\n{if $on}<@c-k lib=\"sifast\" game={$g}></@c-k>{end}\n" + BTN,
  'p-ret.mjs': "<script>\n  $on = false\n" + NAV3 + "</script>\n{if $on}<@c-ret></@c-ret>{end}\n" + BTN,
  'p-ret2.mjs': "<script>\n  $on = false\n" + NAV3 + "</script>\n{if $on}<@c-ret2></@c-ret2>{end}\n" + BTN,
  'p-slot.mjs': "<script>\n  $on = false\n  $g  = 'none'\n  pageOne = -> $g = 'prefer'; $on = true\n  leave   = -> $on = false\n  pageTwo = -> $g = 'wavelength'; $on = true\n</script>\n{if $on}<@c-box><@c-k lib=\"slot\" game={$g}></@c-k></@c-box>{end}\n" + BTN,
  'p-bd.page.mjs': "<routes target=\"main\">\n/a  pa-page\n/b  pb-page\n/  home-page\n</routes>\n<script>\n  pageOne = -> µRouter.to('/a')\n  leave   = -> µRouter.to('/')\n  pageTwo = -> µRouter.to('/b')\n</script>\n<@view main>\n" + BTN,
  'pa-page.mjs': "<script>\n  $game = 'prefer'\n  frame = null\n</script>\n<@c-frame :this=!{frame} game={$game}></@c-frame>\n",
  'pb-page.mjs': "<script>\n  $game = 'wavelength'\n  frame = null\n</script>\n<@c-frame :this=!{frame} game={$game}></@c-frame>\n",
  'home-page.mjs': '<p>accueil</p>\n',
  // relais : la prop reçue par un composant passe à l'enfant de sa racine ; `c-uc` en a une par défaut à `null`, qu'il lit dans sa racine
  'c-relay.mjs': "<script>\n  $game = ''\n</script>\n<@c-k lib=\"relay\" game={$game}></@c-k>\n",
  'c-uc.mjs': "<script>\n  $user = null\n</script>\n<@c-k lib=\"uc\" game={$user.name}></@c-k>\n",
  'c-ud.mjs': "<script>\n  $user = {}\n</script>\n<@c-k lib=\"ud\" game={$user.profil.name}></@c-k>\n",
  'c-ul.mjs': "<script>\n  $list = null\n</script>\n<@c-k lib=\"ul\" game={$list.join('+')}></@c-k>\n",
  'c-err.mjs': "<script>\n  $u = JSON.parse('null')\n</script>\n<@c-k lib=\"err2\" game={$u.name}></@c-k><p class=\"t\">t</p>\n",
  'p-relay.mjs': "<script>\n  $g  = 'prefer'\n  $on = false\n" + NAV3 + "</script>\n{if $on}<@c-relay game={$g}></@c-relay>{end}\n" + BTN,
  'p-tri.mjs': "<script>\n  $g = 'prefer'\n" + RIEN + "</script>\n<@c-relay game={$g}></@c-relay>\n" + BTN,
  'p-light.mjs': "<script>\n  $g  = 'prefer'\n  $on = false\n" + NAV3 + "</script>\n{if $on}<@c-relay :lightDom game={$g}></@c-relay>{end}\n" + BTN,
  'p-lroot.mjs': "<script>\n  $g = 'prefer'\n" + RIEN + "</script>\n<@c-k lib=\"lroot\" game={$g}></@c-k>\n" + BTN,
  'p-mod.mjs': "<script>\n  $comp = 'c-uc'\n  $u    = { name: 'prefer' }\n  $on   = false\n" + NAV3 + "</script>\n<@module $comp user={$u}></@module>{if $on}<@module $comp user={$u}></@module>{end}\n" + BTN,
  'p-uc2.mjs': "<script>\n  $u  = { name: 'prefer' }\n  $on = true\n" + NAV3 + "</script>\n{if $on}<@c-uc user={$u}></@c-uc>{end}\n" + BTN,
  // les mêmes à la racine d'une page chargée, ou réveillés à la vue
  'p-ucr.mjs': "<script>\n  $u = { name: 'prefer', profil: { name: 'prefer' } }\n  $l = ['pre', 'fer']\n" + RIEN + "</script>\n<@c-uc user={$u}></@c-uc><@c-ud user={$u}></@c-ud><@c-ul list={$l}></@c-ul>\n" + BTN,
  'p-wakeuc.mjs': "<script>\n  $u  = { name: 'prefer' }\n  $on = false\n" + NAV3 + "</script>\n<@c-uc :wake=view user={$u}></@c-uc>{if $on}<@c-uc :wake=view user={$u}></@c-uc>{end}\n" + BTN,
  // un lien préchargé dès son apparition, dans le contenu d'une page qui attend la reprise de ses props ; le témoin n'attend rien
  'p-pre.mjs': "<script>\n  $g = 'prefer'\n" + RIEN + "</script>\n<a class=\"lien\" href=\"/app/pre\" :preload=\"on\">x</a>\n<@c-k lib=\"pre\" game={$g}></@c-k>\n" + BTN,
  // le même lien dans le contenu léger d'un enfant, à props ou non (`:lightDom`), ou dans l'ombre d'un enfant à props
  'c-lpre.mjs': "<script>\n  $game = ''\n</script>\n<a class=\"lien\" href=\"/app/lpre\" :preload=\"on\">x</a>\n<@c-k lib=\"lpre\" game={$game}></@c-k>\n",
  'c-lpre0.mjs': "<script>\n  $game = ''\n</script>\n<a class=\"lien\" href=\"/app/lpre0\" :preload=\"on\">x</a>\n<p>{$game}</p>\n",
  'p-lpre.mjs': "<script>\n  $g = 'prefer'\n" + RIEN + "</script>\n<@c-lpre :lightDom game={$g}></@c-lpre><@c-lpre0 :lightDom game={$g}></@c-lpre0>\n" + BTN,
  'p-spre.mjs': "<script>\n  $g = 'prefer'\n" + RIEN + "</script>\n<@c-lpre game={$g}></@c-lpre><@c-lpre0 game={$g}></@c-lpre0>\n" + BTN,
  'p-pre0.mjs': "<script>\n  $g = 'prefer'\n" + RIEN + "</script>\n<a class=\"lien\" href=\"/app/pre0\" :preload=\"on\">x</a>\n<@c-k lib=\"pre0\" game=\"prefer\"></@c-k>\n" + BTN,
  // une liaison de la racine qui lève : la frontière `<@failed>` du composant, ou celle de son parent, montre son repli
  'p-errf.mjs': "<script>\n  $u = JSON.parse('null')\n" + RIEN + "</script>\n<@c-k lib=\"errf\" game={$u.name}></@c-k><p class=\"t\">texte</p>\n<@failed err reset><p class=\"boom\">Oups {err.message}</p></@failed>\n" + BTN,
  'p-errf2.mjs': "<script>\n  $on = false\n" + NAV3 + "</script>\n{if $on}<@c-err></@c-err>{end}\n<@failed err reset><p class=\"boom\">Oups {err.message}</p></@failed>\n" + BTN
}
// hôte de la page en Shadow DOM léger
const ATTRS: Record<string, string> = { 'mjs-p-lroot': ' mjs-light' }
const balisee                       = (balise: string) => `<${balise}${ATTRS[balise] || ''}></${balise}>`
// racines dont la liaison lève : leur repli est affiché, `mjs-loading` retiré
const ERREURS = ['p-errf', 'p-errf2']

// ordre des hooks d'avant la correction, valeurs retirées (`casc awake prefer` → `casc awake`) : le même dans chaque navigateur, happy-dom compris
const ORDRE: Record<string, string[]> = {
  'p-casc': ['casc awake', 'cascn awake', 'ROOT awake', 'casc mount', 'cascn mount', 'ROOT mount', '-- p1', '-- off', '-- p2'],
  'p-cascif': ['-- p1', 'par awake', 'parn awake', 'PAR awake', 'par mount', 'parn mount', 'PAR mount', '-- off', 'par sleep', 'par destroy', '-- p2', 'par awake', 'parn awake', 'PAR awake', 'par mount', 'parn mount', 'PAR mount'],
  'p-key': ['key awake', 'key mount', '-- p1', 'key sleep', 'key awake', 'key destroy', 'key mount', '-- off', 'key sleep', 'key awake', 'key destroy', 'key mount', '-- p2', 'key sleep', 'key awake', 'key destroy', 'key mount'],
  'p-await': ['-- p1', 'await awake', 'await mount', '-- off', 'await sleep', 'await destroy', '-- p2', 'await awake', 'await mount'],
  'p-sifast': ['-- p1', 'sifast awake', 'sifast mount', '-- off', 'sifast sleep', 'sifast destroy', '-- p2', 'sifast awake', 'sifast mount'],
  'p-ret': ['-- p1', 'ret awake', 'ret sleep', 'ret destroy', '-- off', '-- p2', 'ret awake', 'ret sleep', 'ret destroy'],
  'p-ret2': ['-- p1', 'ret2 awake', 'ret2 sleep', 'ret2 destroy', '-- off', '-- p2', 'ret2 awake', 'ret2 sleep', 'ret2 destroy'],
  'p-slot': ['-- p1', 'slot awake', 'slot mount', '-- off', 'slot sleep', 'slot destroy', '-- p2', 'slot awake', 'slot mount'],
  'p-bd': ['-- p1', '-- off', '-- p2'],
  'p-relay': ['-- p1', 'relay awake', 'relay mount', '-- off', 'relay sleep', 'relay destroy', '-- p2', 'relay awake', 'relay mount'],
  'p-tri': ['relay awake', 'relay mount', '-- p1', '-- off', '-- p2'],
  'p-light': ['-- p1', 'relay awake', 'relay mount', '-- off', 'relay sleep', 'relay destroy', '-- p2', 'relay awake', 'relay mount'],
  'p-lroot': ['lroot awake', 'lroot mount', '-- p1', '-- off', '-- p2'],
  'p-mod': ['uc awake', 'uc mount', '-- p1', 'uc awake', 'uc mount', '-- off', 'uc sleep', 'uc destroy', '-- p2', 'uc awake', 'uc mount'],
  'p-uc2': ['uc awake', 'uc mount', '-- p1', '-- off', 'uc sleep', 'uc destroy', '-- p2', 'uc awake', 'uc mount'],
  'p-ucr': ['uc awake', 'ud awake', 'ul awake', 'uc mount', 'ud mount', 'ul mount', '-- p1', '-- off', '-- p2'],
  'p-wakeuc': ['uc awake', 'uc mount', '-- p1', 'uc awake', 'uc mount', '-- off', 'uc sleep', 'uc destroy', '-- p2', 'uc awake', 'uc mount'],
  'p-pre': ['pre awake', 'pre mount', '-- p1', '-- off', '-- p2'],
  'p-pre0': ['pre0 awake', 'pre0 mount', '-- p1', '-- off', '-- p2'],
  'p-lpre': ['lpre awake', 'lpre mount', '-- p1', '-- off', '-- p2'],
  'p-spre': ['lpre awake', 'lpre mount', '-- p1', '-- off', '-- p2'],
  'p-errf': ['errf awake', 'errf mount', 'errf sleep', 'errf destroy', '-- p1', 'bouton absent', '-- off', 'bouton absent', '-- p2', 'bouton absent'],
  'p-errf2': ['-- p1', 'err2 awake', 'err2 mount', 'err2 sleep', 'err2 destroy', '-- off', 'bouton absent', '-- p2', 'bouton absent']
}
// ce que voit le `µawake` de l'enfant à props, dans l'ordre
const REVEILS: Record<string, string[]> = {
  'p-casc': ['casc awake prefer'],
  'p-cascif': ['par awake prefer', 'par awake prefer'],
  'p-key': ['key awake none', 'key awake prefer', 'key awake prefer', 'key awake wavelength'],
  'p-await': ['await awake prefer', 'await awake wavelength'],
  'p-sifast': ['sifast awake prefer', 'sifast awake prefer'],
  'p-ret': ['ret awake prefer', 'ret awake prefer'],
  'p-ret2': ['ret2 awake prefer', 'ret2 awake prefer'],
  'p-slot': ['slot awake prefer', 'slot awake wavelength'],
  'p-bd': [],
  'p-relay': ['relay awake prefer', 'relay awake prefer'],
  'p-tri': ['relay awake prefer'],
  'p-light': ['relay awake prefer', 'relay awake prefer'],
  'p-lroot': ['lroot awake prefer'],
  'p-mod': ['uc awake prefer', 'uc awake prefer', 'uc awake prefer'],
  'p-uc2': ['uc awake prefer', 'uc awake prefer'],
  'p-ucr': ['uc awake prefer', 'ud awake prefer', 'ul awake pre+fer'],
  'p-wakeuc': ['uc awake prefer', 'uc awake prefer', 'uc awake prefer'],
  'p-pre': ['pre awake prefer'],
  'p-pre0': ['pre0 awake prefer'],
  'p-lpre': ['lpre awake prefer'],
  'p-spre': ['lpre awake prefer'],
  // la liaison lève avant de rien livrer : l'enfant se réveille sans sa prop, comme sans elle
  'p-errf': ['errf awake '],
  'p-errf2': ['err2 awake ']
}
// les demandes de la page : celles du `µawake` d'une page de route, le lien préchargé dès son apparition
const DEMANDES: Record<string, string[]> = { 'p-bd': ['/app/duels/prefer', '/app/duels/wavelength'], 'p-pre': ['/app/pre'], 'p-pre0': ['/app/pre0'], 'p-lpre': ['/app/lpre', '/app/lpre0'], 'p-spre': ['/app/lpre', '/app/lpre0'] }
const sansValeur = (aw: string[]) => aw.map((x) => x.replace(/^(\S+ (?:awake|mount|sleep|destroy)) .*$/, '$1').trim())
const reveils    = (aw: string[]) => aw.filter((x) => / awake( |$)/.test(x) && !/^(ROOT|PAR|cascn|parn) /.test(x))

// premier montage d'une page découpée en modules : l'enfant arrive après son parent (ordre d'avant, valeurs justes). Les hooks de cette
// première arrivée suivent celle des modules, qui change d'un moteur à l'autre (Firefox définit les deux enfants dans la même tâche) : ils
// se comparent sans leur ordre (cf. verifier) ; l'enfant retiré par le `µawake` de son parent n'y est pas joué
const ORDRE_SPLIT: Record<string, string[]> = {
  'p-casc': ['ROOT awake', 'ROOT mount', 'casc awake', 'casc mount', 'cascn awake', 'cascn mount', '-- p1', '-- off', '-- p2'],
  'p-cascif': ['-- p1', 'PAR awake', 'PAR mount', 'par awake', 'par mount', 'parn awake', 'parn mount', '-- off', 'par sleep', 'par destroy', '-- p2', 'par awake', 'parn awake', 'PAR awake', 'par mount', 'parn mount', 'PAR mount'],
  // l'enfant de la racine qui lève arrive après le plantage : il ne se réveille pas
  'p-errf': ['-- p1', 'bouton absent', '-- off', 'bouton absent', '-- p2', 'bouton absent'],
  'p-errf2': ['-- p1', '-- off', 'bouton absent', '-- p2', 'bouton absent']
}
const REVEILS_SPLIT: Record<string, string[]> = { 'p-errf': [], 'p-errf2': [] }
// rendu du serveur hydraté (`ssr:markers`, parents définis avant leurs enfants) : la racine se réveille la première
const ORDRE_SSR: Record<string, string[]> = {
  'p-casc': ['ROOT awake', 'casc awake', 'cascn awake', 'ROOT mount', 'casc mount', 'cascn mount', '-- p1', '-- off', '-- p2']
}

const NAV   = (process.env.MJS_NAV || 'chromium') as 'chromium' | 'firefox' | 'webkit' | 'happy-dom'
const MODES = (process.env.MJS_MODES || 'dev-enfants-avant,bundle,split,dev-enfants-avant-proxyoff,ssr').split(',')
// MJS_RACINES : quelques racines seulement (passe découpée)
const SEULES  = process.env.MJS_RACINES ? process.env.MJS_RACINES.split(',') : null
const RACINES = Object.keys(ORDRE).filter((r) => !SEULES || SEULES.includes(r))

const enveloppe = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}</body></html>`
function ordonner(files: string[]): string[] {
  const rang = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : f.startsWith('c-') ? 4 : 5
  return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
}

type Cible = { racine: string, document: (balise: string) => string }
// développement : enfants définis avant leurs parents, tout dans un script ; production : un fichier ou des modules
async function construire(mode: string): Promise<Cible> {
  const root   = mjsTmp('props-reveil-' + mode)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  const prod = mode === 'bundle' || mode === 'split'
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js') }
  if (prod) Object.assign(opts, { env: 'prod', js: mode, urlPrefix: '/out' })
  if (mode.endsWith('-proxyoff')) opts.proxy = false
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  if (prod) return { racine: root, document: (balise) => enveloppe(`${balisee(balise)}<script type="module" src="/out/bundle.js"></script>`) }
  const files  = ordonner(readdirSync(outDir).filter((f) => f.endsWith('.js')))
  const script = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  return { racine: root, document: (balise) => enveloppe(`${balisee(balise)}<script>${script}</script>`) }
}

async function charger(browser: any, cible: Cible, balise: string) {
  const ctx  = await browser.newContext({ viewport: { width: 900, height: 700 } })
  const page = await ctx.newPage()
  const erreurs: string[] = []
  const reqs: string[]    = []
  page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
  page.on('request', (r: any) => { const u = new URL(r.url()); if (u.pathname.startsWith('/app/')) reqs.push(u.pathname) })
  await page.addInitScript('window.__name = (f) => f')
  await page.route('http://liaison.test/**', (route: any) => {
    const chemin  = decodeURIComponent(new URL(route.request().url()).pathname)
    const fichier = join(cible.racine, normalize(chemin))
    if (chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
    if (chemin.startsWith('/app/')) return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
    return route.fulfill({ contentType: 'text/html', body: cible.document(balise) })
  })
  await page.goto('http://liaison.test/', { waitUntil: 'load' })
  return { page, erreurs, reqs, fermer: () => ctx.close() }
}

const lire = (page: any) => page.evaluate('JSON.stringify(window.__aw || [])')
// la page au repos : deux relevés de suite identiques
async function reposee(page: any) {
  let avant = await lire(page)
  for (let i = 0, pareil = 0; i < 40 && pareil < 2; i++) {
    await new Promise((fini) => setTimeout(fini, 120))
    const apres = await lire(page)
    pareil = apres === avant ? pareil + 1 : 0
    avant = apres
  }
}
// bouton absent : le repli d'une frontière `<@failed>` a remplacé le contenu
const clic    = (r: string, b: string) => `window.__aw = (window.__aw || []).concat(['-- ${b}']); (() => { const h = document.querySelector('mjs-${r}'); const x = h && h._shadow && h._shadow.querySelector('.${b}'); if (x) x.click(); else window.__aw.push('bouton absent') })()`
const cliquer = (page: any, r: string, b: string) => page.evaluate(clic(r, b))
// l'hôte au repos : repli affiché, `mjs-loading` retiré, plus de contenu retenu hors de la page
const etat = (r: string) => `(() => { const h = document.querySelector('mjs-${r}'); const s = h._shadow; return { loading: h.hasAttribute('mjs-loading'), retenu: !!h._mjs_kf, repli: !!(s && s.querySelector('.boom')) } })()`

// `souple` : la première arrivée de la page découpée (cf. ORDRE_SPLIT), comparée sans son ordre ; le reste, dans l'ordre
function verifier(quoi: string, r: string, aw: string[], ordre: string[], souple = false) {
  const vu = JSON.stringify(aw)
  const premiere = (l: string[]) => {
    const debut = l.findIndex((x) => !x.startsWith('-- '))
    const fin   = debut < 0 ? -1 : l.findIndex((x, i) => i > debut && x.startsWith('-- '))
    return debut < 0 ? l : [...l.slice(0, debut), ...l.slice(debut, fin < 0 ? l.length : fin).sort(), ...(fin < 0 ? [] : l.slice(fin))]
  }
  assert.deepEqual(souple ? premiere(sansValeur(aw)) : sansValeur(aw), souple ? premiere(ordre) : ordre, `${quoi} ${r} : ordre des hooks changé — ${vu}`)
  assert.deepEqual(reveils(souple ? premiere(aw) : aw), (souple && REVEILS_SPLIT[r]) || REVEILS[r], `${quoi} ${r} : props absentes au réveil — ${vu}`)
}

describe(`composant déjà chargé, props dès son µawake (${NAV})`, function () {
  this.timeout(280000)
  let browser: any
  before(async function () {
    // happy-dom : ses volets plus bas
    if (NAV === 'happy-dom') return this.skip()
    const playwright = await import('playwright')
    browser = await playwright[NAV].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) {
    it(`${mode} : µawake voit la prop, ordre des hooks inchangé`, async function () {
      const serveur = mode === 'ssr'
      // découpe : le lien du contenu léger d'un enfant défini après l'entrée du contenu de son parent n'est cherché par personne, limite
      // sans rapport avec les props (`p-lpre` n'y est pas joué)
      const roots   = serveur ? ['p-casc', 'p-cascif', 'p-key', 'p-sifast', 'p-ret', 'p-ret2', 'p-slot'] : RACINES.filter((r) => (r !== 'p-bd' || mode === 'bundle' || mode === 'split') && (mode !== 'split' || (!r.startsWith('p-ret') && r !== 'p-lpre')))
      const cible   = serveur ? null : await construire(mode)
      const ssr     = serveur ? await construireServeur('ssr', SOURCES, roots.map((r) => 'mjs-' + r)) : null
      const fautes: string[] = []
      for (const r of roots) {
        const o: any = ssr ? await chargerServeur(browser, ssr, 'mjs-' + r, 'markers') : await charger(browser, cible!, 'mjs-' + r)
        try {
          await reposee(o.page)
          for (const b of ['p1', 'off', 'p2']) {
            await cliquer(o.page, r, b)
            await reposee(o.page)
          }
          const aw: string[] = JSON.parse(await lire(o.page))
          const ordre        = (mode === 'split' && ORDRE_SPLIT[r]) || (serveur && ORDRE_SSR[r]) || ORDRE[r]
          const vu           = ERREURS.includes(r) ? await o.page.evaluate(etat(r)) : null
          if (process.env.MJS_RELEVE) console.log('VR§' + JSON.stringify({ nav: NAV, mode, r, aw, vu, err: o.erreurs }))
          try {
            if (vu) assert.deepEqual(vu, { loading: false, retenu: false, repli: true }, `${mode} ${r} : repli absent ou contenu retenu — ${JSON.stringify(vu)}`)
            verifier(mode, r, aw, ordre, mode === 'split')
            if (DEMANDES[r]) assert.deepEqual(o.reqs, DEMANDES[r], `${mode} ${r} : demandes ${JSON.stringify(o.reqs)}`)
            assert.deepEqual(o.erreurs, [], `${mode} ${r} : erreurs ${JSON.stringify(o.erreurs)}`)
          }
          catch (e: any) {
            fautes.push(e.message.split('\n')[0])
          }
        }
        finally {
          await o.fermer()
        }
      }
      assert.deepEqual(fautes, [])
    })
  }
})

describe('composant déjà chargé, props dès son µawake (happy-dom)', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('développement, enfants définis avant : µawake voit la prop, ordre des hooks inchangé', async function () {
    if (process.env.MJS_NAV && process.env.MJS_NAV !== 'happy-dom') return this.skip()
    const root = mjsTmp('props-reveil-happy')
    mkdirSync(join(root, 'src'), { recursive: true })
    for (const [nom, s] of Object.entries(SOURCES)) if (!/^(p-bd|pa-|pb-|home-)/.test(nom)) writeFileSync(join(root, 'src', nom), s)
    // le cœur bâti pour happy-dom, comme celui du harnais de test (`createHarness`)
    const b  = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), happyDom: true } as any)
    const st = await b.compile()
    await b.close()
    assert.equal(st.errors.length, 0)
    const files  = ordonner(readdirSync(join(root, 'out')).filter((f) => f.endsWith('.js')))
    const script = files.map((f) => stripEsm(readFileSync(join(root, 'out', f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
    const pause  = (ms: number) => new Promise((fini) => setTimeout(fini, ms))
    const fautes: string[] = []
    for (const r of RACINES.filter((x) => x !== 'p-bd')) {
      const w: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
      try {
        w.document.body.innerHTML = balisee('mjs-' + r)
        w.eval(script)
        for (let i = 0; i < 10; i++) await pause(20)
        for (const bt of ['p1', 'off', 'p2']) {
          w.eval(clic(r, bt))
          for (let i = 0; i < 10; i++) await pause(20)
        }
        const aw = JSON.parse(w.eval('JSON.stringify(window.__aw || [])'))
        // objet de la fenêtre happy-dom : relu en JSON (autre prototype)
        const vu = ERREURS.includes(r) ? JSON.parse(w.eval(`JSON.stringify(${etat(r)})`)) : null
        if (process.env.MJS_RELEVE) console.log('VR§' + JSON.stringify({ nav: 'happy-dom', r, aw, vu }))
        try {
          if (vu) assert.deepEqual(vu, { loading: false, retenu: false, repli: true }, `happy-dom ${r} : repli absent ou contenu retenu — ${JSON.stringify(vu)}`)
          verifier('happy-dom', r, aw, ORDRE[r])
        }
        catch (e: any) {
          fautes.push(e.message.split('\n')[0])
        }
      }
      finally {
        await w.happyDOM.close()
      }
    }
    assert.deepEqual(fautes, [])
  })

  it('rendu du serveur : un composant à prop par défaut nulle, lue par sa racine, se rend avec la prop de son parent, à la racine d\'une page comprise', async function () {
    if (process.env.MJS_NAV && process.env.MJS_NAV !== 'happy-dom') return this.skip()
    const root = mjsTmp('props-reveil-serveur')
    mkdirSync(join(root, 'src'), { recursive: true })
    for (const [nom, s] of Object.entries(SOURCES)) if (!/^(p-bd|pa-|pb-|home-)/.test(nom)) writeFileSync(join(root, 'src', nom), s)
    const renderer         = await createSSRRenderer({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    const rendus: string[] = []
    try {
      for (const r of ['p-uc2', 'p-mod', 'p-tri', 'p-ucr', 'p-wakeuc']) {
        try {
          const { html } = await renderer.renderToString('mjs-' + r, { ssrMode: 'markers' } as any)
          rendus.push(r + ' ' + [...html.matchAll(/<p class="vu">(?:<!--[^>]*-->)?([^<]*)<\/p>/g)].map((m) => m[1] || 'sans la prop').join(' '))
        }
        catch (e: any) {
          rendus.push(r + ' en erreur : ' + String(e.message).slice(0, 120))
        }
      }
    }
    finally {
      await renderer.close()
    }
    assert.deepEqual(rendus, ['p-uc2 prefer', 'p-mod prefer', 'p-tri prefer', 'p-ucr prefer prefer pre+fer', 'p-wakeuc prefer'])
  })
})
