// libellés par défaut des modules cœur dans une page RENDUE PAR LE SERVEUR : le texte du graphique vide, les noms de la barre
// d'outils du graphique (et le texte de ses cases), le texte d'attente de <@@select> et les noms des boutons de <@@number> sont
// écrits dans la page servie, dans la langue de la page (français par défaut, anglais par µlang ou par la langue du projet),
// surcharges du projet comprises (`mjs.core.<clé>` du dictionnaire racine) ; puis la page est reprise dans Chromium réel (mode
// « markers »), en développement et en production : aucun de ces textes ne change, et les nœuds qui les portent restent ceux
// du serveur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'

const PAGE = `<script>
  $series = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
  $rows   = [{ id: 'a', x: '2026-09-01', poids: 72 }, { id: 'b', x: '2026-09-03', poids: 73 }, { id: 'c', x: '2026-09-05', poids: 71 }]
  $vide   = []
  $choix  = null
  $n      = 3
</script>
<@@chart class="vide" rows={$vide} series={$series}></@@chart>
<@@chart class="barre" rows={$rows} series={$series} toolbar="legend stats"></@@chart>
<@@select class="liste" value=!{$choix}>
  <@@option value="a">Alpha</@@option>
  <@@option value="b">Bêta</@@option>
</@@select>
<@@number class="nombre" value=!{$n}></@@number>
`

type Cas = { nom: string, prod: boolean, langue: 'fr' | 'en', store?: Record<string, unknown>, i18n?: Record<string, unknown>, dico?: Record<string, unknown>, surcharge?: Record<string, string>, runtime?: string[] }

const SURCHARGE = { chartEmpty: 'Rien à montrer', selectPlaceholder: 'Votre choix' }

const CAS: Cas[] = [
  { nom: 'français, langue par défaut', prod: false, langue: 'fr' },
  { nom: 'français, langue par défaut', prod: true, langue: 'fr' },
  { nom: 'anglais par µlang', prod: false, langue: 'en', store: { __mjsLang: 'en' } },
  { nom: 'anglais par la langue du projet', prod: true, langue: 'en', i18n: { default: 'en' } },
  { nom: 'français, surcharges du projet', prod: false, langue: 'fr', i18n: { default: 'fr' }, dico: { fr: { mjs: { core: SURCHARGE } }, en: { titre: 'Hello' } }, surcharge: SURCHARGE, runtime: ['hydrate', 'i18n'] },
]

type Rendu = { html: string, sharedScript: string, hydrateScript: string }
type Construit = { rendu: Rendu, sortie: string }

const construits = new Map<Cas, Promise<Construit>>()

function construire(cas: Cas): Promise<Construit> {
  if (!construits.has(cas)) construits.set(cas, (async () => {
    const root   = mjsTmp('libelles-rendu-serveur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'lib-ssr.mjs'), PAGE)
    if (cas.dico) {
      mkdirSync(join(srcDir, 'i18n'), { recursive: true })
      for (const [langue, dico] of Object.entries(cas.dico)) writeFileSync(join(srcDir, 'i18n', langue + '.json'), JSON.stringify(dico))
    }
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, ...(cas.prod ? { env: 'prod' } : {}), bundlerOpts: { runtime: cas.runtime ?? ['hydrate'], ...(cas.i18n ? { i18n: cas.i18n } : {}) } } as any)
    try {
      const rendu: Rendu = await renderer.renderToString('mjs-lib-ssr', { ssrMode: 'markers', ...(cas.store ? { store: cas.store } : {}) } as any)
      return { rendu, sortie: outDir }
    }
    finally {
      await renderer.close()
    }
  })())
  return construits.get(cas)!
}

// les textes attendus : la table du framework dans la langue du cas, puis les surcharges du projet
function attendus(cas: Cas): Record<string, string> {
  return { ...(RUNTIME_LABELS as any)[cas.langue].core, ...(cas.surcharge ?? {}) }
}

const motif = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const attribut = (s: string): string => motif(s.replace(/&/g, '&amp;').replace(/"/g, '&quot;'))

// le contenu d'un module cœur dans le HTML servi (son ombre déclarative), repéré par sa classe, sans les marqueurs de reprise
function module(html: string, balise: string, cls: string): string {
  const debut = html.indexOf(`<${balise} class="${cls}"`)
  assert.ok(debut >= 0, `${balise}.${cls} absent de la page servie`)
  return html.slice(debut, html.indexOf(`</${balise}>`, debut)).replace(/<!--[\s\S]*?-->/g, '')
}

describe('modules cœur : la page servie porte leurs libellés par défaut', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const cas of CAS) it(`${cas.nom} (${cas.prod ? 'production' : 'développement'})`, async () => {
    const { rendu } = await construire(cas)
    const t = attendus(cas)
    assert.match(module(rendu.html, 'mjs-core-chart', 'vide'), new RegExp(`<p class="empty" part="empty">${motif(t.chartEmpty)}</p>`), 'le graphique vide le dit')
    const barre = module(rendu.html, 'mjs-core-chart', 'barre')
    assert.match(barre, new RegExp(`<div class="tools" part="tools" role="group" aria-label="${attribut(t.chartTools)}"`), 'le nom de la barre d\'outils')
    assert.match(barre, new RegExp(`<div class="kit" role="group" aria-label="${attribut(t.chartLegend)}"`), 'le nom de la légende')
    assert.match(barre, new RegExp(`<div class="kit" role="group" aria-label="${attribut(t.chartStats)}"`), 'le nom des statistiques')
    assert.match(barre, new RegExp(`</svg>${motif(t.chartMean)}</label>`), 'le texte d\'une case de statistique')
    assert.match(module(rendu.html, 'mjs-core-select', 'liste'), new RegExp(`<span class="select-label[^"]*"[^>]*>${motif(t.selectPlaceholder)}</span>`), 'le texte d\'attente de la liste')
    const nombre = module(rendu.html, 'mjs-core-number', 'nombre')
    assert.match(nombre, new RegExp(`role="group" aria-label="${attribut(t.numberLabel)}"`), 'le nom du champ nombre')
    assert.match(nombre, new RegExp(`class="step less" part="button" tabindex="-1" aria-label="${attribut(t.numberLess)}"`), 'le bouton moins')
    assert.match(nombre, new RegExp(`class="step more" part="button" tabindex="-1" aria-label="${attribut(t.numberMore)}"`), 'le bouton plus')
    assert.doesNotMatch(rendu.html, /aria-label=""/, 'aucun nom vide')
  })
})

// tous les fichiers d'un dossier de sortie, par chemin relatif
function fichiers(dossier: string, base = dossier, out: string[] = []): string[] {
  for (const f of readdirSync(dossier)) {
    const p = join(dossier, f)
    if (statSync(p).isDirectory()) fichiers(p, base, out)
    else out.push(relative(base, p).split(sep).join('/'))
  }
  return out
}

// relevé, dans la page, des nœuds qui portent un libellé du cœur (nom d'accessibilité, texte du graphique vide, texte
// d'attente de la liste, texte des cases) : le nœud, ce qu'il porte, sa valeur, le module qui le dessine ; et un observateur
// qui note, à partir de la
// pose, tout libellé qui bouge — un nom changé, un texte réécrit, un texte ajouté ou retiré. Les marqueurs de reprise (des
// commentaires, que la reprise remplace par des ancres de texte vides) ne sont pas des textes ; un élément retiré compte dans
// le relevé des nœuds refaits
const RELEVE = `
window.__libelles = function () {
  var out = []
  var voir = function (racine, module) {
    racine.querySelectorAll('*').forEach(function (el) {
      if (el.shadowRoot) voir(el.shadowRoot, el.localName)
      if (el.hasAttribute('aria-label')) out.push([el, 'aria-label', el.getAttribute('aria-label'), module])
      if (el.matches('p.empty, span.select-label, label.pill')) out.push([el, 'texte', el.textContent, module])
    })
  }
  voir(document, '')
  return out
}
window.__avant = window.__libelles()
window.__sauts = []
var __texte = function (n) { return n.nodeType === 3 && n.textContent.trim() !== '' }
var __obs = new MutationObserver(function (liste) {
  liste.forEach(function (m) {
    var ajoutes = [].slice.call(m.addedNodes).filter(__texte)
    var retires = [].slice.call(m.removedNodes).filter(__texte)
    if (m.type === 'childList' && !ajoutes.length && !retires.length) return
    var cible = m.target.nodeType === 1 ? m.target : m.target.parentNode
    window.__sauts.push(m.type + ' ' + (m.attributeName || '') + ' sur ' + (cible && cible.localName) + '.' + (cible && cible.getAttribute('class')) + ' : ' + (m.type === 'attributes' ? m.target.getAttribute(m.attributeName) : m.target.textContent) + ajoutes.map(function (n) { return ' +' + n.textContent }).join('') + retires.map(function (n) { return ' -' + n.textContent }).join(''))
  })
})
window.__avant.forEach(function (x) { __obs.observe(x[0], { attributes: true, attributeFilter: ['aria-label'], characterData: true, childList: true, subtree: true }) })
`

describe('modules cœur : la page servie reprise dans Chromium réel garde leurs libellés', function () {
  this.timeout(180000)
  let present = false
  let browser: any = null

  before(async function () {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright.chromium.executablePath())
    } catch { present = false }
    if (!present) return
    browser = await (await import('playwright')).chromium.launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  for (const cas of CAS) it(`${cas.nom} (${cas.prod ? 'production' : 'développement'}) : mêmes textes, mêmes nœuds, aucun saut`, async () => {
    const { rendu, sortie } = await construire(cas)
    const servis = fichiers(sortie)
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 900 } })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    const avis: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 300)) })
    page.on('requestfailed', (r: any) => avis.push('échec ' + r.url()))
    const contenu = `<!doctype html><html lang="${cas.langue}"><head><meta charset="utf-8"></head><body>${rendu.sharedScript}\n${rendu.html}\n<script>${RELEVE}</script>\n${rendu.hydrateScript}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    await page.route('http://ssr.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: contenu })
      // le manifeste et ses morceaux, servis depuis le dossier de sortie du rendu, par la fin de leur chemin
      const f = servis.filter((x) => chemin.endsWith('/' + x)).sort((a, b) => b.length - a.length)[0]
      if (f) return route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(join(sortie, f)) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://ssr.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => ['mjs-lib-ssr', 'mjs-core-chart', 'mjs-core-select', 'mjs-core-number'].every((n) => !!customElements.get(n)), null, { timeout: 15000 }).catch(() => { throw new Error(`la page servie ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur'} / console : ${avis.join(' | ') || 'rien'}`) })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    // nœud refait : sorti de la page, ou remplacé à sa place dans le relevé. Le graphique refait à la reprise son texte vide et
    // sa barre d'outils (mêmes textes, mêmes classes), que le rendu serveur pose ses libellés ou non : défaut à part, sans
    // rapport avec les libellés — ses nœuds ne sont comparés que par leurs textes
    const etat = await page.evaluate(() => {
      const w = window as any
      const apres = w.__libelles()
      const ecrit = (l: any[]) => l.map((x: any) => x[0].localName + '.' + x[1] + '=' + x[2])
      const refaits = w.__avant.filter((x: any, i: number) => x[3] !== 'mjs-core-chart' && (!x[0].isConnected || !apres[i] || apres[i][0] !== x[0])).map((x: any) => x[3] + ' ' + x[0].localName + '.' + x[0].getAttribute('class'))
      const gardes  = w.__avant.filter((x: any) => x[3] !== 'mjs-core-chart').length
      return { avant: ecrit(w.__avant), apres: ecrit(apres), refaits, gardes, sauts: w.__sauts, hydrate: (document.querySelector('mjs-lib-ssr') as any)._mjs_hydrated }
    })
    if (!cas.prod) assert.equal(etat.hydrate, true, 'la page est reprise, pas refaite')
    const t = attendus(cas)
    assert.ok(etat.avant.includes('p.texte=' + t.chartEmpty), `la page servie porte le texte du graphique vide : ${etat.avant.join(' | ')}`)
    assert.ok(etat.avant.includes('button.aria-label=' + t.numberMore), `la page servie porte le nom du bouton plus : ${etat.avant.join(' | ')}`)
    assert.deepEqual(etat.apres, etat.avant, 'la reprise ne change aucun libellé')
    assert.deepEqual(etat.sauts, [], 'aucun libellé ne bouge pendant la reprise')
    assert.ok(etat.gardes >= 5, `la liste et le champ nombre portent des libellés relevés : ${etat.gardes}`)
    assert.deepEqual(etat.refaits, [], 'les nœuds qui portent les libellés de la liste et du champ nombre restent ceux du serveur')
    // la page reprise répond : le bouton plus du champ nombre avance la valeur
    await page.locator('mjs-core-number.nombre button.step.more').click()
    await page.waitForTimeout(150)
    assert.equal(await page.evaluate(() => ((document.querySelector('mjs-lib-ssr') as any).shadowRoot.querySelector('mjs-core-number').shadowRoot.querySelector('input.input') as HTMLInputElement).value), '4', 'le champ nombre répond après la reprise')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})
