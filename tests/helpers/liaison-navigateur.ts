// harnais des tests de liaison parent / enfant en navigateur réel : un même jeu de sources, compilé et servi dans cinq modes de
// chargement — développement avec les parents définis avant ou après leurs enfants, production en un seul fichier ou en fichiers
// séparés, rendu serveur puis hydratation — que les tests jouent dans Chromium et Firefox
// - les enfants du projet s'appellent `c-…` (le développement classe les fichiers par leur nom), les modules du cœur `core-…`
// - une sonde compte tout événement `mjs-bind:*` (ce par quoi un enfant écrit dans la variable de son parent), avec la valeur ET le type

import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { mjsTmp } from './tmp.js'
import { libellesDuManifeste } from './libelles-manifeste.js'
import { Bundler } from '../../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../../src/server/renderToString.js'

export const MODES = ['dev-parents-avant', 'dev-enfants-avant', 'bundle', 'split', 'ssr'] as const
export type Mode = typeof MODES[number]

// le rendu serveur se joue dans quatre modes de reprise : `markers`, `positional` et `diff` adoptent le HTML du serveur, `replace` le refait ;
// chaque cas se joue dans les quatre, à la racine du parent comme dans un `{if}` ou une ligne de `{for}`
export const VARIANTES: Record<Mode, string[]> = { 'dev-parents-avant': [''], 'dev-enfants-avant': [''], bundle: [''], split: [''], ssr: ['markers', 'positional', 'diff', 'replace'] }
export const variantes = (mode: Mode) => VARIANTES[mode]

// la valeur et son type : 7 et "7" ne se confondent pas, ni une date et sa chaîne
export const SHOW = "show = (v)-> (if v is undefined then 'undefined' else JSON.stringify(v)) + ' <' + (if v is null then 'null' else if v instanceof Date then 'Date' else typeof v) + '>'"
export const DBL  = "dbl = (l)-> l.map((v)-> v * 2).join(',')"

// la même écriture que SHOW, côté page : `<balise>.<clé>=<valeur> <type>`
const SONDE = `window.__binds = []
const orig = EventTarget.prototype.dispatchEvent
EventTarget.prototype.dispatchEvent = function (e) {
  if (e && typeof e.type === 'string' && e.type.startsWith('mjs-bind:')) {
    const v = e.data
    let texte
    try { texte = v === undefined ? 'undefined' : JSON.stringify(v) } catch (x) { texte = '?' }
    window.__binds.push((this.localName || '?').replace('mjs-', '') + '.' + e.type.slice(9) + '=' + texte + ' <' + (v === null ? 'null' : v instanceof Date ? 'Date' : typeof v) + '>')
  }
  return orig.call(this, e)
}`

export type Cible = { mode: Mode, racine: string, document: (balise: string, variante: string) => string }

// le cœur du runtime d'abord (il porte µ), puis le reste du runtime, puis les parents, les enfants et les modules du cœur dans l'ordre voulu
function ordonner(files: string[], parentsAvant: boolean): string[] {
  const rang = (f: string) => {
    if (/^mjs_core-/.test(f)) return 0
    if (f.startsWith('mjs_')) return 1
    const coeur  = f.startsWith('core-')
    const enfant = f.startsWith('c-')
    if (parentsAvant) return coeur ? 5 : enfant ? 4 : 3
    return coeur ? 3 : enfant ? 4 : 5
  }
  return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
}

const enveloppe = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}</body></html>`

// chaque enfant du projet est un fichier `c-….mjs` ; le développement les range avant ou après les parents
export async function construire(mode: Mode, sources: Record<string, string>, balises: string[]): Promise<Cible> {
  const root   = mjsTmp('liaison-' + mode)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom), source)

  if (mode === 'ssr') {
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const rendus: Record<string, string> = {}
    for (const balise of balises) {
      for (const variante of VARIANTES.ssr) {
        const { html, hydrateScript } = await renderer.renderToString(balise, { ssrMode: variante } as any)
        rendus[balise + '/' + variante] = `${html}\n${hydrateScript}\n`
      }
    }
    await renderer.close()
    // les parents définis AVANT leurs enfants : à l'hydratation, l'enfant du rendu serveur n'est pas encore mis à niveau
    const [coeur, ...autres] = ordonner(readdirSync(outDir).filter((f) => f.endsWith('.js') && f !== 'bundle.js'), true)
    const script = stripEsm(readFileSync(join(outDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + autres.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    return { mode, racine: root, document: (balise, variante) => enveloppe(`${rendus[balise + '/' + variante]}<script>${script}</script>`) }
  }

  const prod = mode === 'bundle' || mode === 'split'
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js') }
  if (prod) Object.assign(opts, { env: 'prod', js: mode, urlPrefix: '/out' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  if (prod) return { mode, racine: root, document: (balise) => enveloppe(`<${balise}></${balise}><script type="module" src="/out/bundle.js"></script>`) }

  // développement : tout dans un script, dans l'ordre voulu entre parents, enfants et modules du cœur
  const files  = ordonner(readdirSync(outDir).filter((f) => f.endsWith('.js')), mode === 'dev-parents-avant')
  const script = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  return { mode, racine: root, document: (balise) => enveloppe(`<${balise}></${balise}><script>${script}</script>`) }
}

export type Ouverture = { page: any, erreurs: string[], avis: string[], fermer: () => Promise<void> }

// la page est servie par un faux serveur : le document, puis les fichiers de `out/` en production
export async function charger(browser: any, cible: Cible, balise: string, variante = ''): Promise<Ouverture> {
  const ctx  = await browser.newContext({ viewport: { width: 900, height: 700 } })
  const page = await ctx.newPage()
  const erreurs: string[] = []
  const avis: string[]    = []
  page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
  page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 200)) })
  await page.addInitScript('window.__name = (f) => f')
  await page.addInitScript(SONDE)
  await page.route('http://liaison.test/**', (route: any) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: cible.document(balise, variante) })
    const fichier = join(cible.racine, normalize(chemin))
    if (chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://liaison.test/', { waitUntil: 'load' })
  return { page, erreurs, avis, fermer: () => ctx.close() }
}

// le parent monté, au moins `nb` enfants dans son ombre, tous montés et rendus ; un parent tombé n'atteint jamais cet état,
// l'attente cède au bout de cinq secondes et la lecture montre alors ce qui reste
export async function attendre(page: any, balise: string, nb: number) {
  await page.waitForFunction(`(() => {
    const h = document.querySelector('${balise}')
    const sh = h && h._shadow
    if (!h || !h._mjs_is_mounted || !sh) return false
    const enf = Array.from(sh.querySelectorAll('*')).filter((c) => /^mjs-(c-|core-)/.test(c.localName))
    return enf.length >= ${nb} && enf.every((c) => c._mjs_is_mounted && (c.localName.startsWith('mjs-core-') || (c._shadow && c._shadow.querySelector('.vu'))))
  })()`, null, { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(300)
}

export type Lecture = { ps: Record<string, string>, enf: string[], mods: string[], binds: string[] }

// ce que la page montre : les lignes `<p class="…">` du parent, la ligne `.vu` de chaque enfant du projet, l'état de chaque module du cœur
export const lire = (page: any, balise: string): Promise<Lecture> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  const sh = h && h._shadow
  const ps = {}
  if (sh) for (const p of sh.querySelectorAll('p[class]')) ps[p.className] = p.textContent
  const kids = sh ? Array.from(sh.querySelectorAll('*')).filter((c) => c.localName.startsWith('mjs-')) : []
  const enf = kids.filter((c) => c.localName.startsWith('mjs-c-')).map((c) => c.localName.slice(4) + '=' + (c._shadow && c._shadow.querySelector('.vu') ? c._shadow.querySelector('.vu').textContent : '(absent)'))
  const mods = kids.filter((c) => c.localName.startsWith('mjs-core-') && c.localName !== 'mjs-core-option').map((c) => c.localName.slice(4) + '=' + JSON.stringify({ value: c._state && c._state.value, checked: c._state && c._state.checked, index: c._state && c._state.index, group: c._state && c._state.group, open: c._state && c._state.open }))
  return { ps, enf, mods, binds: window.__binds }
})()`)

// ce que la page a dit de grave : une erreur non attrapée, ou un plantage de composant intercepté par le framework
export const graves = (o: Ouverture): string[] => [...o.erreurs, ...o.avis.filter((a) => /Crash intercepted|TypeError|ReferenceError|is not defined/.test(a))]

export type Liaison = { enfant: string, valeur: string, lit?: boolean }

// un parent qui lie chaque enfant à une variable (`x=!{…}`) : à la racine, dans un `{if}` levé par un bouton, ou dans une ligne de `{for}`.
// `lit` : le parent lit aussi la variable avec `.map`, SANS garde — un `null` y plante le rendu
export function parent(lieu: 'racine' | 'si' | 'pour', liaisons: Liaison[]): string {
  const noms   = liaisons.map((_, i) => 'v' + i)
  const lecture = (i: number) => lieu === 'pour' ? `$rows[0].v${i}` : `$v${i}`
  const lien   = (i: number) => lieu === 'pour' ? `r.v${i}` : `$v${i}`
  const balises = liaisons.map((l, i) => `<@${l.enfant} x=!{${lien(i)}}></@${l.enfant}>`)
  const vars   = lieu === 'pour' ? `  $rows = [{ ${noms.map((n, i) => `${n}: ${liaisons[i].valeur}`).join(', ')} }]\n` : noms.map((n, i) => `  $${n} = ${liaisons[i].valeur}\n`).join('')
  const entete = lieu === 'si' ? '  $show = false\n' : ''
  const corps  = lieu === 'racine' ? balises.join('\n') : lieu === 'si' ? `<button class="go" @click={$show = true}>go</button>\n{if $show}\n${balises.map((b) => '  ' + b).join('\n')}\n{end}` : `{for r in $rows}\n${balises.map((b) => '  ' + b).join('\n')}\n{end}`
  const lignes = liaisons.map((l, i) => `<p class="p${i}">{show(${lecture(i)})}</p>` + (l.lit ? `<p class="m${i}">{dbl(${lecture(i)})}</p>` : '')).join('\n')
  return `<script>\n${entete}${vars}  ${DBL}\n  ${SHOW}\n</script>\n${corps}\n${lignes}\n`
}

// un enfant du projet : son défaut (`init`, une ligne de script ou rien) et sa ligne `.vu` qui montre sa prop `x`
export const enfant = (init: string) => `<script>\n${init}  ${SHOW}\n</script>\n<p class="vu">{show($x)}</p>\n`

// le clic sur le bouton `.go` du parent (le `{if}` se lève)
export const lever = (page: any, balise: string) => page.evaluate(`document.querySelector('${balise}')._shadow.querySelector('.go').click()`)
