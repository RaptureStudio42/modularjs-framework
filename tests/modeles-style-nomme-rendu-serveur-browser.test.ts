// Un modèle choisi par `layout` est appliqué pendant le rendu serveur, par les deux moteurs (happy-dom et navigateur) : la page
// servie montre déjà le bon modèle — le style nommé (`<style name="banner">`), le bloc `{? banner}`, le fichier à lui
// (`carte.compacte.mjs`). Le style nommé voyage dans l'ombre déclarative du composant, après sa feuille propre, sa balise portant
// l'adresse du fichier (`mjs-layout`) ; le runtime la relit avant la reprise. Dans Chromium, Firefox et WebKit réels, le composant
// repris garde son modèle à chaque image, même quand le fichier du style tarde à arriver. Avant, la page servie montrait le style
// par défaut, puis sautait au bon à l'arrivée du fichier
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

const BLEU  = 'rgb(0, 0, 255)'
const ROUGE = 'rgb(255, 0, 0)'

const CARTE   = `<p class="base">{µlayout}</p>\n{? banner}\n  <b class="bandeau">B</b>\n{end}\n\n<style>\n  :host\n    color: blue\n</style>\n\n<style name="banner">\n  :host\n    color: red\n</style>\n`
const COMPACT = `<p class="compacte">C</p>\n`
const PAGE    = `<@carte class="a" layout="banner"></@carte>\n<@carte class="b" layout="compacte"></@carte>\n<@carte class="c"></@carte>\n`

function projet(etiquette: string) {
  const root   = mjsTmp('modeles-rendu-serveur-' + etiquette)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'carte.mjs'), CARTE)
  writeFileSync(join(srcDir, 'carte.compacte.mjs'), COMPACT)
  writeFileSync(join(srcDir, 'page.mjs'), PAGE)
  return { root, srcDir, outDir: join(root, 'out') }
}

// le fragment d'ombre déclarative d'un hôte de la page servie (son `<template shadowrootmode>`), par sa classe
function ombre(html: string, balise: string, cls: string): string {
  const i = html.indexOf(`<${balise} class="${cls}"`)
  assert.ok(i >= 0, `<${balise} class="${cls}"> dans la page servie`)
  const debut = html.indexOf('<template shadowrootmode', i)
  return html.slice(debut, html.indexOf('</template>', debut))
}

function verifierPage(html: string, moteur: string) {
  const a = ombre(html, 'mjs-carte', 'a')
  const m = /<style[^>]*\smjs-layout="([^"]+)"[^>]*>([^<]*)<\/style>/.exec(a)
  assert.ok(m, `${moteur} : le style nommé est écrit dans l'ombre de la carte à layout="banner" : ${a}`)
  assert.match(m![1], /carte\.banner\.css(\?v=\w+)?$/, `${moteur} : la balise porte l'adresse du fichier du style nommé`)
  assert.match(m![2], /color:\s*red/)
  assert.ok(a.indexOf('color:blue') >= 0 && a.indexOf('color:blue') < a.indexOf('mjs-layout'), `${moteur} : après la feuille propre`)
  assert.match(a, /class="bandeau"/, `${moteur} : le bloc {? banner}`)
  assert.match(a, /<p class="base">banner<\/p>/, `${moteur} : µlayout`)
  const c = ombre(html, 'mjs-carte', 'c')
  assert.doesNotMatch(c, /mjs-layout|color:\s*red|bandeau/, `${moteur} : la carte sans layout garde le modèle par défaut`)
  assert.match(ombre(html, 'mjs-carte--compacte', 'b'), /<p class="compacte">C<\/p>/, `${moteur} : le fichier du modèle`)
}

// tous les fichiers d'un dossier de sortie, par chemin relatif
function fichiers(dossier: string, base = dossier, out: string[] = []): string[] {
  for (const f of readdirSync(dossier)) {
    const p = join(dossier, f)
    if (statSync(p).isDirectory()) fichiers(p, base, out)
    else out.push(relative(base, p).split(sep).join('/'))
  }
  return out
}

// relevé de la couleur des cartes `.a` (style nommé) et `.c` (défaut) à chaque image, de l'analyse de la page à 2,5 s : une carte
// cachée (balise pas encore définie, cf. le bouclier du cœur) n'est pas vue
const RELEVE = `
window.__couleurs = { a: [], c: [] }
;(function pas() {
  var page = document.querySelector('mjs-page')
  var racine = page && page.shadowRoot
  ;['a', 'c'].forEach(function (k) {
    var el = racine && racine.querySelector('.' + k)
    if (!el) return
    var cs = getComputedStyle(el)
    window.__couleurs[k].push(cs.visibility === 'hidden' ? 'cachée' : cs.color)
  })
  if (performance.now() < 2500) requestAnimationFrame(pas)
})()
`

describe('modèles layout : appliqués pendant le rendu serveur, gardés à la reprise', function () {
  this.timeout(240000)
  let html = ''
  let sortie = ''

  before(async () => {
    const p = projet('happy')
    const renderer = await createSSRRenderer({ sourceDir: p.srcDir, outputDir: p.outDir })
    try { html = (await renderer.renderToString('mjs-page')).html }
    finally { await renderer.close() }
    sortie = p.outDir
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('moteur happy-dom : le style nommé, le bloc {? nom} et le fichier du modèle sont dans la page servie', () => {
    verifierPage(html, 'happy-dom')
  })

  it('moteur navigateur : même page servie', async function () {
    let present = false
    try { present = existsSync((await import('playwright')).chromium.executablePath()) } catch { present = false }
    if (!present) this.skip()
    const p = projet('navigateur')
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out' } as any, { configDir: p.root } as any)
    try { verifierPage((await renderer.renderPage('mjs-page', { settleMs: 3000 })).html, 'navigateur') }
    finally { await renderer.close() }
  })

  for (const nom of ['chromium', 'firefox', 'webkit']) {
    it(`${nom} réel : la carte à style nommé est rouge à chaque image visible, de la page servie à la reprise, fichier du style en retard`, async function () {
      const playwright: any = await import('playwright')
      let present = false
      try { present = existsSync(playwright[nom].executablePath()) } catch { present = false }
      if (!present) this.skip()
      const navigateur = await playwright[nom].launch()
      try {
        const servis = fichiers(sortie)
        const page   = await navigateur.newPage()
        const erreurs: string[] = []
        const css: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        const contenu = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}\n<script>${RELEVE}</script>\n<script type="module" src="/out/bundle.js"></script></body></html>`
        await page.route('http://ssr.test/**', async (route: any) => {
          const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
          if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: contenu })
          const f = servis.filter((x) => chemin.endsWith('/' + x)).sort((a, b) => b.length - a.length)[0]
          if (!f) return route.fulfill({ status: 404, body: '' })
          // le fichier du style nommé tarde : la reprise a lieu avant son arrivée
          if (f.endsWith('.css')) { css.push(f); await new Promise((r) => setTimeout(r, 600)) }
          return route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript; charset=utf-8' : f.endsWith('.css') ? 'text/css' : 'application/json', body: readFileSync(join(sortie, f)) })
        })
        await page.goto('http://ssr.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!customElements.get('mjs-page') && !!customElements.get('mjs-carte'), null, { timeout: 15000 })
        await page.waitForFunction(() => performance.now() >= 2500, null, { timeout: 15000 })
        const releve = await page.evaluate(() => (window as any).__couleurs)
        const vues = (l: string[]) => l.filter((c) => c !== 'cachée')
        assert.ok(vues(releve.a).length >= 5, `des images relevées : ${releve.a.length}`)
        assert.deepEqual([...new Set(vues(releve.a))], [ROUGE], 'carte à layout="banner" : ' + releve.a.join(' '))
        assert.deepEqual([...new Set(vues(releve.c))], [BLEU], 'carte sans layout : ' + releve.c.join(' '))
        assert.equal(await page.evaluate(() => getComputedStyle((document.querySelector('mjs-page') as any).shadowRoot.querySelector('.a')).color), ROUGE, 'reprise faite, toujours rouge')
        assert.deepEqual(erreurs, [])
        assert.deepEqual(css, [], 'aucune requête du fichier du style nommé : la reprise le relit dans la page')
      }
      finally { await navigateur.close() }
    })
  }
})
