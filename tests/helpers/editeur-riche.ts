// harnais des tests de l'éditeur riche du cœur (<@@editor>, <@@toolbar>) : une page hôte compilée par le vrai Bundler, en
// construction de développement (un seul script en ligne) ou de production (un morceau par module, servi par adresse),
// ouverte dans Chromium, Firefox ou WebKit réels. La construction se fait une seule fois pour tous les fichiers de tests.
// - l'hôte porte six éditeurs en saisie (e1 à e6, dont un en lecture seule et un désactivé) et des barres séparées (tb3 à tb5), trois en mode « répondre » (e7 à e9) et leurs journaux ;
// - la page est servie sous http://localhost (un contexte sûr : le presse-papiers du navigateur n'existe pas ailleurs) ;
// - les aides injectées dans la page (`window.__…`) nomment les pièces de l'hôte : `__sf('e1')` est la surface de l'éditeur `.e1`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './tmp.js'
import { libellesDuManifeste } from './libelles-manifeste.js'
import { Bundler } from '../../src/bundler/index.js'
import { stripEsm } from '../../src/server/renderToString.js'

export type Moteur = 'chromium' | 'firefox' | 'webkit'
export type Build  = 'dev' | 'prod'

export const MOTEURS: Moteur[] = ['chromium', 'firefox', 'webkit']
export const BUILDS: Build[]   = ['dev', 'prod']

// le modèle écrit par l'auteur, pour le mode « répondre » : cinq lignes à cocher (positions 0 à 4, sous-liste comprise), une liste numérotée
export const MODELE = '<p>Cochez ce que vous acceptez</p><ul data-checklist><li data-checked>Un</li><li>Deux<ul data-checklist><li>Deux-un</li><li>Deux-deux</li></ul></li><li>Trois avec <a href="https://exemple.fr">un lien</a></li></ul><ol><li>numéro</li></ol>'

export const HOTE = `<script>
  $contrat = '<h2>Contrat</h2><p>Texte <b>gras</b> et <i>italique</i>.</p><ul><li>un</li><li>deux</li></ul>'
  $liste   = '<ul data-checklist><li data-checked>Fait</li><li>À faire</li></ul>'
  $notes   = ''
  $brut    = ''
  $fixe    = '<p>Texte figé</p>'
  $evts    = []
  $modele  = '${MODELE}'
  $coches  = [1]
  $reps    = []

  @remise = ->
    $contrat = '<p>Remis</p>'

  @noter = (e)->
    $evts = [...$evts, e.type + ':' + (e.data ?? '').length]

  @noterReps = (e)->
    $reps = [...$reps, e.type + ':' + JSON.stringify(e.data)]

  µmount ->
    window.__langue = (l)-> µlang = l
    window.__poser = (nom, v)->
      if nom == 'contrat' then $contrat = v
      else if nom == 'liste' then $liste = v
      else if nom == 'brut' then $brut = v
      else if nom == 'modele' then $modele = v
      else if nom == 'coches' then $coches = v
      else $notes = v
    window.__etat = -> { modele: $modele, coches: $coches }
</script>

<form class="f" @noUJS>
  <@@editor class="e1" name="contrat" value=!{$contrat} @input={@noter(e)} @change={@noter(e)}></@@editor>
  <@@editor class="e2" name="liste" value=!{$liste} toolbar="bold italic check ul link undo redo"></@@editor>
  <@@toolbar class="tb3" for="e3"></@@toolbar>
  <@@editor id="e3" class="e3" name="notes" toolbar="none" value=!{$notes}></@@editor>
  <@@toolbar class="tb4" for="e4"></@@toolbar>
  <@@editor id="e4" class="e4" name="fixe" readonly value={$fixe}></@@editor>
  <@@toolbar class="tb5" for="e5"></@@toolbar>
  <@@editor id="e5" class="e5" name="inerte" disabled value={$fixe}></@@editor>
  <@@editor class="e6" name="brut" toolbar="none" paste="text" value=!{$brut}></@@editor>
  <button type="reset" class="rz">reset</button>
</form>
<button type="button" class="ext" @click={@remise()}>remise</button>
<pre class="o1">{$contrat}</pre>
<pre class="o2">{$liste}</pre>
<pre class="o3">{$notes}</pre>
<pre class="o6">{$brut}</pre>
<pre class="ev">{$evts.join(',')}</pre>

<form class="fa" @noUJS>
  <@@toolbar class="tb7" for="e7"></@@toolbar>
  <@@editor id="e7" class="e7" name="reps[]" answer value={$modele} checked=!{$coches} @change={@noterReps(e)} @input={@noterReps(e)}></@@editor>
  <@@editor class="e8" name="lecture[]" answer readonly value={$modele} checked={[0, 2]}></@@editor>
  <@@editor class="e9" name="inerte[]" answer disabled value={$modele} checked={[0]}></@@editor>
  <button type="reset" class="rza">reset</button>
</form>
<pre class="o7">{JSON.stringify($coches)}</pre>
<pre class="evr">{$reps.join(',')}</pre>
`

// les aides injectées dans la page : les pièces de l'hôte, la sélection, le collage, le centre d'un élément
export const AIDES = `
window.__H = () => document.querySelector('mjs-hote')._shadow
window.__ed = (c) => __H().querySelector('.' + c)
window.__sf = (c) => __ed(c)._shadow.querySelector('.surface')
window.__bar = (c) => ['e3', 'e4', 'e5', 'e7'].includes(c) ? __H().querySelector('.tb' + c.slice(1)) : __ed(c)._shadow.querySelector('mjs-core-toolbar')
window.__btn = (c, t) => __bar(c)._shadow.querySelector('[data-tool="' + t + '"]')
window.__out = (n) => __H().querySelector('.o' + n).textContent
window.__hid = (c) => __ed(c).querySelector(':scope > input[type=hidden]')
window.__champs = (c) => [...__ed(c).querySelectorAll(':scope > input[type=hidden]')].map((i) => i.name + '=' + i.value)
window.__lignes = (c) => [...__sf(c).querySelectorAll('.line')]
window.__coche = (c, i) => { const li = __lignes(c)[i].parentNode; li.scrollIntoView({ block: 'center' }); const r = li.getBoundingClientRect(); return { x: r.left + 6, y: r.top + 12 } }
window.__etats = (c) => __lignes(c).map((l) => l.getAttribute('aria-checked')).join(',')
window.__selText = (c, txt) => {
  const sf = __sf(c); sf.focus()
  const w = document.createTreeWalker(sf, NodeFilter.SHOW_TEXT)
  let n
  while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(txt); if (i >= 0) { document.getSelection().setBaseAndExtent(n, i, n, i + txt.length); return true } }
  return false
}
window.__caret = (c, txt, off) => {
  const sf = __sf(c); sf.focus()
  const w = document.createTreeWalker(sf, NodeFilter.SHOW_TEXT)
  let n, last
  while ((n = w.nextNode())) { last = n; if (txt && n.nodeValue.includes(txt)) break }
  if (!last) return false
  const o = off === undefined ? last.nodeValue.length : off
  document.getSelection().setBaseAndExtent(last, o, last, o)
  return true
}
window.__deep = () => { let a = document.activeElement; while (a && (a._shadow || a.shadowRoot) && (a._shadow || a.shadowRoot).activeElement) a = (a._shadow || a.shadowRoot).activeElement; return a ? a.tagName.toLowerCase() + '.' + a.className : 'rien' }
window.__center = (el) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
window.__coller = (c, html, text) => {
  const dt = new DataTransfer()
  if (html) dt.setData('text/html', html)
  if (text) dt.setData('text/plain', text)
  const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'clipboardData', { value: dt })
  __sf(c).dispatchEvent(ev)
}
`

// les fichiers de développement en UN script, dans l'ordre du chargement : le cœur, les libellés du manifeste, les parties du moteur, puis les composants.
// Chaque composant (un module du cœur, la page) a sa propre portée, comme au vrai chargement où chaque fichier est un module : `select`, `sortable` et `toolbar`
// déclarent chacun, au niveau du module, un nom de même valeur (`told`), et un seul script les ferait se heurter (`SyntaxError`)
export function assembler(outDir: string, manifeste: string): string {
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
  const [coeur, ...reste] = ordre.map((f) => {
    const code = stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    return f.startsWith('mjs_') ? code : `{\n${code}\n}`
  })
  return coeur + '\n' + libellesDuManifeste(manifeste) + '\n' + reste.join('\n') + '\nglobalThis.µ = µ;'
}

export type Construction = { build: Build, script: string, fichiers: Map<string, Buffer> }

const construits: Record<string, Promise<Construction>> = {}

// la construction de l'hôte dans ce mode, une seule fois par page (`cle`) : en développement le script concaténé (le cœur, les libellés du
// manifeste, les modules, l'hôte), en production les morceaux du build lus en mémoire ; `source` remplace l'hôte commun par une page à part
export function construire(build: Build, source: string = HOTE, cle = 'editeur'): Promise<Construction> {
  construits[cle + '-' + build] ??= (async () => {
    const root   = mjsTmp(cle + '-' + build)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), source)
    const manifeste = join(root, 'bundle.js')
    const options: any = build === 'prod'
      ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), js: 'split', env: 'prod' }
      : { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste }
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const fichiers = new Map<string, Buffer>()
    if (build === 'prod') {
      for (const f of readdirSync(outDir)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(outDir, f)))
      assert.ok(fichiers.has('bundle.js') && [...fichiers.keys()].some((f) => /^core-editor-/.test(f)), 'le build de production sépare un morceau par module')
      return { build, script: '', fichiers }
    }
    return { build, script: assembler(outDir, manifeste), fichiers }
  })()
  return construits[cle + '-' + build]
}

export type Session = { page: any, ctx: any, browser: any, logs: string[], fermer: () => Promise<void> }

// une page à part : sa source, sa clé de construction, l'expression vraie quand elle est prête et ses aides (sinon l'hôte commun)
export type Page = { source: string, cle: string, attente: string, aides: string }

// la page de l'hôte ouverte dans ce moteur, les aides posées, la console écoutée ; `null` quand le moteur n'est pas installé
export async function ouvrir(nom: Moteur, build: Build, autre?: Page): Promise<Session | null> {
  const playwright: any = await import('playwright')
  if (!existsSync(playwright[nom].executablePath())) return null
  const fait    = await construire(build, autre?.source, autre?.cle)
  const browser = await playwright[nom].launch({ headless: true })
  const ctx     = await browser.newContext({ viewport: { width: 1000, height: 1400 } })
  const page    = await ctx.newPage()
  const logs: string[] = []
  await page.addInitScript('window.__name = (f) => f')
  page.on('console', (m: any) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 300)) })
  page.on('pageerror', (e: any) => logs.push('PAGEERROR: ' + String(e).slice(0, 300)))
  const corps = build === 'prod' ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${fait.script.replace(/<\/script/gi, '<\\/script')}</script>`
  await page.route('http://localhost/**', async (route: any) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/out/')) {
      const f = fait.fichiers.get(url.pathname.slice(5))
      if (!f) { await route.fulfill({ status: 404, body: '' }); return }
      await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: f })
      return
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote>${corps}</body></html>` })
  })
  await page.goto('http://localhost/page', { waitUntil: 'load' })
  await page.waitForFunction(autre?.attente ?? `(() => {
    const h = document.querySelector('mjs-hote')
    const e = h && h._shadow && h._shadow.querySelector('.e1')
    const r = h && h._shadow && h._shadow.querySelector('.e7')
    const b = e && e._shadow && e._shadow.querySelector('mjs-core-toolbar')
    return !!(b && b._shadow && b._shadow.querySelector('button') && r && r._shadow && r._shadow.querySelector('.line'))
  })()`, { timeout: 60000 })
  await page.evaluate(autre?.aides ?? AIDES)
  await page.waitForTimeout(300)
  return { page, ctx, browser, logs, fermer: async () => { await browser.close() } }
}

export const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// un hôte compilé par le vrai Bundler (développement) et monté dans happy-dom : le cœur, les libellés du manifeste, les modules du cœur
// appelés puis l'hôte, dans cet ordre. Les avertissements (`µ.warn`) sont recueillis au lieu d'aller à la console ; `donnees` est posé
// sur `window.__donnees` avant le montage (l'hôte le lit, ce qui évite d'écrire des textes hostiles dans ses sources)
export async function monter(source: string, prefixe: string, donnees: any = null): Promise<{ window: any, hote: any, avertissements: string[] }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source)
  const manifeste = join(root, 'bundle.js')
  const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste })
  const stats     = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(`${assembler(outDir, manifeste)}\nglobalThis.__avert = [];\nµ.warn = function(...a) { globalThis.__avert.push(a.map(String).join(' ')); };`)
  window.__donnees = donnees
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow)
  await new Promise((r) => setTimeout(r, 300))
  return { window, hote, avertissements: window.eval('globalThis.__avert') }
}
