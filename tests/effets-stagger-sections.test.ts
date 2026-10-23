// Les étiquettes `// @@` de mjs_fx_stagger.ts, une par une : ce qu'un réglage seul commande (`unit: line`, `unit: child`, `clip`, `on: scroll`) ne part
// dans une application de production que si une page l'écrit. Une application qui écrit `*stagger` sans rien de plus reçoit les lettres et les
// mots, les six styles, le pas et la courbe d'avant, et rien d'autre.
//
// Trois gardes sur des builds réels de production (une page par réglage, code lisible) : les jetons des étiquettes du fichier sont exactement ceux
// des pages ; chaque section marquée porte au moins un témoin ; chaque témoin est embarqué par ses pages et par elles seules. Puis le filtre seul
// sur TOUTES les combinaisons de réglages écrits : le fichier filtré est du JavaScript valide, sans variable inconnue (une section qui réclame ce
// qu'une autre ne déclare pas) ni variable déclarée et jamais lue (un reste qu'aucun réglage n'utilise plus).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as acorn from 'acorn'
import { Linter } from 'eslint'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { selectFxSections } from '../src/bundler/fx-sections.js'
import { mjsTmp } from './helpers/tmp.js'

const compte = (texte: string, motif: string) => texte.split(motif).length - 1

// la grammaire des marques, la même que celle du filtre (bundler/fx-sections.ts)
const LABEL = '[A-Za-z0-9 ._=,*-]+'
const BLOC  = new RegExp('^\\s*// @@(?: (' + LABEL + '))?\\s*$')
const FIN   = new RegExp('^(.*\\S)\\s+// @@ (' + LABEL + ')$')

type Unite = { jetons: string[], propres: string[], ligne: number }

// les sections marquées du fichier : leurs jetons et leurs lignes propres (sans celles des sections emboîtées)
function unites(src: string): Unite[] {
  const sortie: Unite[] = []
  const pile: Unite[]   = []
  src.split('\n').forEach((texte, i) => {
    const b = BLOC.exec(texte)
    if (b) {
      if (b[1]) {
        const u = { jetons: b[1].split(' '), propres: [], ligne: i + 1 }
        pile.push(u)
        sortie.push(u)
      }
      else pile.pop()
      return
    }
    const l = FIN.exec(texte)
    if (l) sortie.push({ jetons: l[2].split(' '), propres: [l[1]], ligne: i + 1 })
    else if (pile.length > 0) pile[pile.length - 1].propres.push(texte)
  })
  return sortie
}

type Page   = { balise: string, jetons: string[], contenu?: string }
type Temoin = { texte: string, pages: string[], n?: Record<string, number> }

const REF = 'rien'

// chaque page n'écrit qu'un réglage (ou deux, pour du code qui ne sert qu'aux deux ensemble) ; les jetons sont ceux que ce réglage demande
const PAGES: Record<string, Page> = {
  [REF]:       { balise: '*stagger', jetons: [] },
  word:        { balise: '*stagger(unit: word)', jetons: [] },
  line:        { balise: '*stagger(unit: line)', jetons: ['unit=line', 'unit=line,child'] },
  child:       { balise: '*stagger(unit: child)', jetons: ['unit=child'], contenu: '<b>un</b><b>deux</b>' },
  clip:        { balise: '*stagger(clip: true)', jetons: ['clip=true'] },
  scroll:      { balise: '*stagger(on: scroll)', jetons: ['on=scroll'] },
  lineclip:    { balise: '*stagger(unit: line, clip: true)', jetons: [] },
  childclip:   { balise: '*stagger(unit: child, clip: true)', jetons: [], contenu: '<b>un</b><b>deux</b>' },
  linescroll:  { balise: '*stagger(unit: line, on: scroll)', jetons: [] },
  childscroll: { balise: '*stagger(unit: child, on: scroll)', jetons: [], contenu: '<b>un</b><b>deux</b>' }
}

// les pages qui écrivent des lignes, des enfants, le défilement, le cache
const L   = ['line', 'lineclip', 'linescroll']
const CH  = ['child', 'childclip', 'childscroll']
const LC  = [...L, ...CH]
const SC  = ['scroll', 'linescroll', 'childscroll']
const CL  = ['clip', 'lineclip', 'childclip']
const LCS = ['linescroll', 'childscroll']
const LCC = [...LC, ...CL]
const TOUS = [...SC, ...LC, ...CL]

const TEMOINS: Temoin[] = [
  // le CSS
  { texte: '{--mjs-fx-stagger-sp:var(--mjs-stagger-step,45ms)}',                                                    pages: LC },
  { texte: '[mjs-fx-stagger-unit="line"][mjs-fx-play~="stagger"] [mjs-fx-word]{animation:var',                       pages: L },
  { texte: '> [mjs-fx-child]{animation:var(--mjs-fx-stagger-name',                                                    pages: CH },
  { texte: '[mjs-fx-stagger-scroll] [mjs-fx-layer="text"]{--mjs-fx-stagger-total',                                   pages: SC },
  { texte: '[mjs-fx-stagger-scroll][mjs-fx-stagger-unit="child"]{--mjs-fx-stagger-total',                            pages: ['childscroll'] },
  { texte: '[mjs-fx-stagger-scroll][mjs-fx-stagger-unit="line"][mjs-fx-play~="stagger"] [mjs-fx-word],',            pages: LCS },
  { texte: '[mjs-fx-stagger-style="flip"][mjs-fx-stagger-unit="child"][mjs-fx-play~="stagger"] > [mjs-fx-child]{transform-origin', pages: CH },
  { texte: '@keyframes mjs-fx-stagger-child-flip{',                                                                  pages: CH },
  { texte: '@keyframes mjs-fx-stagger-clip-move{',                                                                   pages: CL },
  { texte: 'l\'enfant, lui, glisse et sa découpe se contre-déplace',                                                  pages: CL },
  { texte: '@keyframes mjs-fx-stagger-clip-box{',                                                                    pages: ['childclip'] },
  { texte: '[mjs-fx-stagger-rest][mjs-fx-stagger-rest][mjs-fx-stagger-rest] [mjs-fx-letter]',                        pages: LC },
  { texte: '[mjs-fx-word][mjs-fx-word]{will-change:auto}}',                                                          pages: L },
  { texte: '> [mjs-fx-child][mjs-fx-child]{animation:none;will-change:auto}}',                                       pages: CH },
  // les drapeaux et leurs attributs
  { texte: 'var line   = s.unit === \'line\';',                                                                      pages: LC },
  { texte: 'var scroll = s.on === \'scroll\';',                                                                      pages: [...SC, ...LC] },
  { texte: 'var cut    = s.clip === true',                                                                           pages: CL },
  { texte: 'if (rests) µ._mjs_dom.setAttribute(el, \'mjs-fx-stagger-unit\', s.unit);',                              pages: LC },
  { texte: 'if (cut && slide) µ._mjs_dom.setAttribute(el, \'mjs-fx-stagger-clip\', \'\');',                         pages: CL },
  { texte: 'var dflts = {};',                                                                                        pages: LCC },
  { texte: 'if (rests) dflts.step = ',                                                                               pages: LC },
  { texte: 'if (cut && slide) dflts.distance = ',                                                                    pages: CL },
  { texte: 'var fall = function(k, x) {',                                                                            pages: LCC },
  // l'état
  { texte: 'var units  = 0;',                                                                                        pages: LC },
  { texte: 'var ended  = 0;',                                                                                        pages: L },
  { texte: 'var rested = false;',                                                                                    pages: LCC },
  { texte: 'var played = false;',                                                                                    pages: CH },
  { texte: 'var alive  = true;',                                                                                     pages: L },
  { texte: 'var kids   = [];',                                                                                       pages: CH },
  { texte: 'var cells  = null;',                                                                                     pages: SC },
  { texte: 'le calque des lignes et des enfants pendant l\'arrivée, rendu à sa fin',                                 pages: LC },
  { texte: 'var live   = false;',                                                                                    pages: LCS },
  { texte: 'var feed   = function(p) {',                                                                             pages: SC },
  { texte: 'if (child) us = kids;',                                                                                  pages: ['childscroll'] },
  { texte: 'if (rested) return;',                                                                                    pages: LCS },
  // les enfants, les lignes, le cache
  { texte: 'var mine = function(n) {',                                                                               pages: CH },
  { texte: 'fed = 0;',                                                                                               pages: SC, n: { childscroll: 3 } },
  { texte: 'feed(prog);',                                                                                            pages: SC, n: { childscroll: 2 } },
  { texte: 'var lines = function(ws) {',                                                                             pages: L },
  { texte: 'var wrap = function() {',                                                                                pages: CL },
  { texte: 'wrap();',                                                                                                pages: CL, n: { clip: 3, lineclip: 5, childclip: 3 } },
  // le repos
  { texte: 'il n\'existe que pour une ligne, ou pour un enfant dont l\'arrivée suit le défilement',                  pages: LC },
  { texte: 'var settle = function(yes) {',                                                                           pages: ['line', 'lineclip', 'linescroll', 'childscroll'] },
  { texte: 'if (!yes) return rankAll();',                                                                            pages: ['childscroll'] },
  { texte: 'µ._mjs_dom.setAttribute(el, \'mjs-fx-stagger-rest\', \'\');',                                            pages: L },
  { texte: 'unwrap();',                                                                                              pages: CL, n: { lineclip: 2 } },
  { texte: 'dim(cells);',                                                                                            pages: LCS, n: { linescroll: 2 } },
  // la lecture
  { texte: 'played = true;',                                                                                         pages: CH },
  { texte: 'ended  = 0;',                                                                                            pages: L, n: { line: 2, lineclip: 2, linescroll: 2 } },
  { texte: 'if (child) rankAll();',                                                                                  pages: CH },
  { texte: 'if (line) {\n        rested = false;',                                                                   pages: L },
  { texte: 'if (child && µ._mjs_fxCalm()) unmark();',                                                                pages: CH },
  { texte: 'var over = function(t) {',                                                                               pages: LC },
  { texte: 'unflag(t);',                                                                                             pages: CH },
  { texte: '++ended >= units',                                                                                       pages: L },
  { texte: 'var mo = null;',                                                                                         pages: CH },
  { texte: 'var ro = null;',                                                                                         pages: L },
  { texte: 'new MutationObserver(function(list) {',                                                                  pages: CH },
  // le texte (lettres, mots, lignes)
  { texte: 'cells = ls;',                                                                                            pages: SC },
  { texte: 'if (line) n = lines(ws);',                                                                               pages: L },
  { texte: 'units = words ? ws.length : n;',                                                                         pages: LC },
  { texte: 'ended = 0;',                                                                                             pages: L },
  { texte: 'if (rested && !scroll) play();',                                                                         pages: L },
  { texte: 'if (!rested) wrap();',                                                                                   pages: CL },
  { texte: 'var regroup = function() {',                                                                             pages: L },
  // les évènements d'animation, le défilement
  { texte: 'if (rests) µ._mjs_dom.addEventListener(el, \'animationend\', onEnd);',                                  pages: LC },
  { texte: 'au défilement l\'animation de chaque unité est en pause',                                                pages: LC },
  { texte: 'var kinds = [\'animationstart\'',                                                                        pages: LCS },
  { texte: 'var regular = function(k, v) {',                                                                         pages: SC },
  { texte: 'settle(p >= 1);',                                                                                        pages: LCS },
  { texte: 'var now = rests && p > 0 && p < 1;',                                                                     pages: LCS },
  // le retrait
  { texte: 'alive = false;',                                                                                         pages: L },
  { texte: 'if (mo) mo.disconnect();',                                                                               pages: CH },
  { texte: 'if (ro) ro.disconnect();',                                                                               pages: L },
  { texte: 'µ._mjs_dom.removeEventListener(el, \'animationend\', onEnd);',                                           pages: LC },
  { texte: 'les unités qui avaient leur calque le rendent',                                                          pages: LC },
  { texte: 'kinds.forEach(function(k) { µ._mjs_dom.removeEventListener(el, k, lit); });',                            pages: LCS },
  { texte: 'if (cells) for (var i = 0; i < cells.length; i++) cells[i].style.removeProperty',                         pages: SC },
  { texte: 'if (child) unmark();',                                                                                   pages: CH },
  { texte: 'µ._mjs_dom.removeAttribute(el, \'mjs-fx-stagger-scroll\');',                                             pages: SC },
  { texte: 'µ._mjs_dom.removeAttribute(el, \'mjs-fx-stagger-clip\');',                                               pages: CL },
  { texte: 'µ._mjs_dom.removeAttribute(el, \'mjs-fx-stagger-rest\');\n      µ._mjs_dom.removeAttribute(el, \'mjs-fx-stagger-live\');', pages: LC },
  { texte: 'el.style.removeProperty(\'--mjs-fx-stagger-st\');',                                                      pages: SC },
  { texte: 'el.style.removeProperty(\'--mjs-fx-stagger-sp\');',                                                      pages: LC },
  { texte: 'el.style.removeProperty(\'--mjs-fx-stagger-d\');',                                                       pages: CL },
  { texte: 'el.style.removeProperty(\'--mjs-fx-stagger-c\');',                                                       pages: CH },
  // les réglages suivis sans reposer l'effet
  { texte: 'off.set = function(k, v) {',                                                                             pages: TOUS },
  { texte: 'fall(k, v);',                                                                                            pages: LCC },
  { texte: 'if (scroll && k !== \'distance\') regular(k, v);',                                                       pages: SC }
]

// les signaux de build des réglages (features.ts : `<effet>_<réglage>:<valeur>`)
const SIGNAUX = ['stagger_unit:word', 'stagger_unit:line', 'stagger_unit:child', 'stagger_clip:true', 'stagger_on:scroll']
const GLOBALES = ['µ', 'window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'MutationObserver', 'ResizeObserver', 'Math', 'Array', 'Object', 'String', 'parseFloat', 'CustomEvent', 'Promise']

describe('étiquettes `// @@` de mjs_fx_stagger.ts — chaque réglage seul embarque sa section et rien d\'autre', function () {
  this.timeout(600000)
  after(async () => { await terminateSharedWorkerPool() })

  const src = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_stagger.ts'), 'utf-8')

  // un build RÉEL dont le code reste lisible (`minify: false`) ; `env: 'prod'` : le développement envoie le fichier en entier, le tri est celui de la production
  async function construire(nom: string, source: string, env = 'prod'): Promise<string> {
    const root   = mjsTmp('stagger-sections-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), source)
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false }
    if (env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    return readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  }
  const appli = (balise: string, contenu = 'Un texte de plusieurs mots') => `<script>\n$u = 'word'\n$o = 'view'\n$c = true\n</script>\n<div class="a" ${balise}>${contenu}</div>`

  describe('les builds de production, une page par réglage', () => {
    const sorties: Record<string, string> = {}

    before(async () => {
      for (const [nom, page] of Object.entries(PAGES)) sorties[nom] = await construire(nom, appli(page.balise, page.contenu))
    })

    it('les jetons des étiquettes du fichier sont exactement ceux des pages de la table', () => {
      const dansLeFichier = [...new Set(unites(src).flatMap((u) => u.jetons))].sort()
      const dansLaTable   = [...new Set(Object.values(PAGES).flatMap((p) => p.jetons))].sort()
      assert.deepEqual(dansLeFichier, dansLaTable)
    })

    it('chaque section marquée porte au moins un témoin sur ses lignes propres, et chaque témoin est dans une section', () => {
      const liste = unites(src)
      for (const u of liste) assert.ok(TEMOINS.some((t) => u.propres.join('\n').includes(t.texte)), `la section « ${u.jetons.join(' ')} » (ligne ${u.ligne}) n'a aucun témoin`)
      for (const t of TEMOINS) {
        assert.ok(liste.some((u) => u.propres.join('\n').includes(t.texte)), `le témoin « ${t.texte} » n'est dans aucune section marquée`)
        for (const p of t.pages) assert.ok(PAGES[p], `le témoin « ${t.texte} » cite la page ${p}, qui n'existe pas`)
      }
    })

    it('aucune marque ne sort, et chaque page porte les témoins de son réglage, et seulement eux', () => {
      for (const [nom, sortie] of Object.entries(sorties)) {
        assert.equal(sortie.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false, `${nom} : une marque de section sort`)
        for (const t of TEMOINS) {
          const delta = compte(sortie, t.texte) - compte(sorties[REF], t.texte)
          assert.equal(delta, t.pages.includes(nom) ? (t.n?.[nom] ?? 1) : 0, `page « ${nom} » (${PAGES[nom].balise}) : « ${t.texte} » ${t.pages.includes(nom) ? 'doit partir' : 'ne doit pas partir'}`)
        }
      }
    })

    it('ce que fait `*stagger` sans rien écrire part toujours : les lettres, les mots, les styles, le pas et la courbe', () => {
      for (const reste of ['var count = function() {', 'tx.onBuild(count);', 'var play = function() {', 'var off = function() {', 'mjs-fx-stagger-style="zoom"', '@keyframes mjs-fx-stagger-move{', 'stop = µ._mjs_fxWhen(el, s.on, function() { play(); });']) {
        assert.ok(sorties[REF].includes(reste), reste)
      }
    })

    it('un réglage tenu par une variable : toutes ses valeurs, et rien des autres réglages', async () => {
      const unite = await construire('variable-unit', appli('*stagger(unit: $u)'))
      assert.ok(unite.includes('var lines = function(ws) {') && unite.includes('var mine = function(n) {'))
      assert.equal(unite.includes('var wrap = function() {') || unite.includes('var feed   = function(p) {'), false, 'l\'unité n\'est ni le cache ni le défilement')
      const cache = await construire('variable-clip', appli('*stagger(clip: $c)'))
      assert.ok(cache.includes('var wrap = function() {'))
      assert.equal(cache.includes('var lines = function(ws) {') || cache.includes('var mine = function(n) {'), false, 'le cache n\'est ni une ligne ni un enfant')
      const defile = await construire('variable-on', appli('*stagger(on: $o)'))
      assert.ok(defile.includes('var feed   = function(p) {') && defile.includes('var regular = function(k, v) {'))
      assert.equal(defile.includes('var wrap = function() {') || defile.includes('var lines = function(ws) {'), false, 'le défilement n\'est ni le cache ni une ligne')
    })

    it('le développement envoie le fichier en entier, sans une marque (le panneau allume n\'importe quel réglage)', async () => {
      const dev = await construire('developpement', appli('*stagger'), 'dev')
      assert.equal(dev.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false)
      for (const t of TEMOINS) assert.ok(dev.includes(t.texte), `développement : « ${t.texte} »`)
    })
  })

  describe('le filtre seul, toutes les combinaisons de réglages écrits', () => {
    const linter = new Linter()
    const config: any = [{
      languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: Object.fromEntries(GLOBALES.map((n) => [n, 'readonly'])) },
      rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { vars: 'all', args: 'none', caughtErrors: 'none' }] }
    }]

    it(`les ${1 << SIGNAUX.length} combinaisons donnent du JavaScript valide, sans variable inconnue ni variable jamais lue`, () => {
      const mauvais: string[] = []
      for (let masque = 0; masque < 1 << SIGNAUX.length; masque++) {
        const ecrits = SIGNAUX.filter((_, i) => masque & (1 << i))
        const texte  = selectFxSections('mjs_fx_stagger.ts', src, new Set(['use:stagger', ...ecrits]), false)
        try {
          acorn.parse(texte, { ecmaVersion: 'latest' })
        }
        catch (e: any) {
          mauvais.push(`[${ecrits.join(' ')}] ${e.message}`)
          continue
        }
        for (const m of linter.verify(texte, config)) mauvais.push(`[${ecrits.join(' ')}] ${m.ruleId} : ${m.message}`)
      }
      assert.deepEqual(mauvais, [])
    })

    it('sans aucun réglage écrit, le fichier est bien plus court que le fichier entier', () => {
      const nu   = selectFxSections('mjs_fx_stagger.ts', src, new Set(['use:stagger']), false)
      const tout = selectFxSections('mjs_fx_stagger.ts', src, new Set(), true)
      assert.ok(nu.length < tout.length * 0.6, `${nu.length} octets sans réglage, ${tout.length} avec tout`)
    })
  })
})
