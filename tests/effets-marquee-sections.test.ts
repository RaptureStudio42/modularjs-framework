// Les étiquettes `// @@` de mjs_fx_marquee.ts, une par une : ce qu'un réglage seul commande (la main `drag`, la nappe `axis: both`, le défilement
// `on: scroll`, le sens verticaux, la pause, l'espace `gap`, le sens inverse `reverse`) ne part dans une application de production que si une page
// l'écrit. Une application qui écrit `*marquee` sur un texte, sans rien de plus, reçoit le texte et ses deux copies, la dérive suspendue hors de l'écran,
// et rien d'autre : la piste des enfants ne part que si une pose la demande (`unit: child`, ou la main, la nappe, le défilement) — voir
// `effets-marquee-tri.test.ts` pour ce que le compilateur y voit.
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

type Page   = { balise: string, jetons: string[] }
type Temoin = { texte: string, pages: string[], n?: Record<string, number> }

const REF = 'rien'

// chaque page n'écrit qu'un réglage (ou deux, pour une règle qui ne sert qu'aux deux ensemble) ; les jetons sont ceux que ce réglage demande
const PAGES: Record<string, Page> = {
  [REF]:   { balise: '*marquee', jetons: [] },
  drag:    { balise: '*marquee(drag: true)', jetons: ['drag=true'] },
  both:    { balise: '*marquee(axis: both)', jetons: ['axis=both'] },
  scroll:  { balise: '*marquee(on: scroll)', jetons: ['on=scroll'] },
  reverse: { balise: '*marquee(reverse: true)', jetons: ['reverse'] },
  up:      { balise: '*marquee(direction: up)', jetons: ['direction=up,down'] },
  down:    { balise: '*marquee(direction: down)', jetons: ['direction=up,down'] },
  pause:   { balise: '*marquee(pause: true)', jetons: ['pause'] },
  gap:     { balise: '*marquee(gap: 20)', jetons: ['gap'] },
  enfants: { balise: '*marquee(unit: child)', jetons: ['unit=child'] },
  dragup:  { balise: '*marquee(drag: true, direction: up)', jetons: [] },
  revscroll: { balise: '*marquee(on: scroll, reverse: true)', jetons: [] },
  pausedrag: { balise: '*marquee(drag: true, pause: true)', jetons: [] },
  gapdrag: { balise: '*marquee(drag: true, gap: 20)', jetons: [] }
}

// les pages qui demandent la main (drag, ou la nappe), le défilement ou l'une des deux, le sens vertical, le contrôle de la piste
const MAIN = ['drag', 'dragup', 'both', 'pausedrag', 'gapdrag']
const DEFIL = ['scroll', 'revscroll']
const TOUT = [...MAIN, ...DEFIL]
const VERT = ['up', 'down', 'dragup']
const CTRL = [...TOUT, 'gap']
// les pages qui demandent le mode « balises » : `unit: child`, la main, le défilement, la nappe (et leurs croisements)
const PISTE = [...TOUT, 'enfants']
const DEUX = Object.fromEntries(PISTE.map((p) => [p, 2]))

const TEMOINS: Temoin[] = [
  { texte: 'function _mjsFxMarqueeWrap(u, tour) {',                                          pages: TOUT },
  { texte: '[mjs-fx-marquee-axis="y"] [mjs-fx-marquee-track]{flex-direction:column',          pages: VERT },
  { texte: '[mjs-fx-marquee-pause]:hover [mjs-fx-marquee-track]{animation-play-state:paused}', pages: ['pause', 'pausedrag'] },
  { texte: '@keyframes mjs-fx-marquee-y{',                                                    pages: VERT },
  { texte: '{flex-direction:column;align-items:stretch}',                                     pages: ['dragup'] },
  { texte: '{flex-wrap:wrap}',                                                                pages: ['both'] },
  { texte: '[mjs-fx-marquee-still] > [mjs-fx-marquee-run]{animation:none}',                   pages: [...DEFIL, 'both'] },
  { texte: '[mjs-fx-marquee-pause]:hover > [mjs-fx-marquee-run]{animation-play-state:paused}', pages: ['pausedrag'] },
  { texte: '[mjs-fx-marquee-held] > [mjs-fx-marquee-run]{animation-play-state:paused}',       pages: MAIN },
  { texte: '[mjs-fx-marquee-drag]{cursor:grab',                                               pages: MAIN },
  // la main tirée en colonne : ni la main seule ni la direction seule ne la demandent
  { texte: '[mjs-fx-marquee-drag][mjs-fx-marquee-axis="y"]{touch-action:pan-x}',              pages: ['dragup'] },
  { texte: '[mjs-fx-marquee-drag][mjs-fx-marquee-axis="both"]{touch-action:none}',            pages: ['both'] },
  { texte: '@keyframes mjs-fx-marquee-run-y{',                                                pages: ['dragup'] },
  { texte: 'var ctl;',                                                                        pages: CTRL },
  { texte: "s.axis === 'both';",                                                              pages: TOUT },
  { texte: 'µ._mjs_fxMs(s.speed, 12000)',                                                     pages: DEFIL },
  { texte: 's.reverse === true',                                                              pages: DEFIL },
  { texte: "if (vertical) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-axis', 'y');",          pages: VERT },
  { texte: "if (both) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-axis', 'both');",           pages: ['both'] },
  { texte: "if (s.pause) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-pause', '');",           pages: ['pause', 'pausedrag'] },
  { texte: "var shown   = '';",                                                               pages: TOUT },
  { texte: 'var swallow = false;',                                                            pages: MAIN },
  { texte: 'if (!swallow) return;',                                                           pages: MAIN },
  { texte: 'var hooked  = false;',                                                            pages: DEFIL },
  { texte: "if (hand) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-drag', '');",              pages: MAIN },
  { texte: "if (scroll || both) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-still', '');",    pages: [...DEFIL, 'both'] },
  { texte: "if (needs) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-drive', '');",             pages: TOUT },
  { texte: 'var bars  = [];',                                                                 pages: DEFIL },
  { texte: 'var place = function() {',                                                        pages: TOUT },
  { texte: 'if (scroll) sc = (',                                                              pages: DEFIL },
  { texte: 'if (both) {',                                                                     pages: ['both'] },
  { texte: 'while ((nx + 1) * (ny + 1) > 120',                                                pages: ['both'] },
  { texte: 'if (scroll) look();',                                                             pages: DEFIL },
  { texte: 'if (needs) place();',                                                             pages: TOUT },
  { texte: 'var settle = function() {',                                                       pages: TOUT },
  { texte: 'Math.min(4, (now - last) / 16.667)',                                              pages: MAIN },
  { texte: "if (go && typeof requestAnimationFrame === 'function')",                          pages: MAIN },
  { texte: 'var move = function(e) {',                                                        pages: MAIN },
  { texte: 'var onScroll = function() {',                                                     pages: DEFIL },
  { texte: 'ctl = {};',                                                                       pages: TOUT },
  { texte: 'ctl.move = function() { if (needs) ask(); };',                                    pages: TOUT },
  { texte: 'ctl.measure = function() {',                                                      pages: ['gapdrag'] },
  { texte: 'arrive = attach;',                                                                pages: DEFIL },
  { texte: 'detach();',                                                                       pages: DEFIL },
  { texte: 'ctl = null;',                                                                     pages: TOUT },
  { texte: 'clearTimeout(rest);',                                                             pages: TOUT },
  { texte: 'releasePointerCapture(el, g.id)',                                                 pages: MAIN },
  { texte: "['drag', 'still', 'drive', 'held'].forEach",                                      pages: TOUT },
  { texte: "if (scroll) mode = 'always';",                                                    pages: DEFIL },
  { texte: "µ._mjs_dom.removeAttribute(el, 'mjs-fx-marquee-pause');",                         pages: ['pause', 'pausedrag'] },
  { texte: "µ._mjs_dom.removeAttribute(el, 'mjs-fx-marquee-axis');",                          pages: [...VERT, 'both'] },
  { texte: 'off.set = function(k, v) {',                                                      pages: ['gap', 'gapdrag', 'reverse', ...DEFIL] },
  { texte: "if (k === 'speed') {",                                                            pages: DEFIL },
  { texte: "if (k === 'reverse') {",                                                          pages: ['reverse', 'revscroll'] },
  { texte: 'rev = v === true;',                                                               pages: ['revscroll'] },
  { texte: 'if (ctl) ctl.move();',                                                            pages: DEFIL, n: { revscroll: 2 } },
  { texte: "if (k === 'gap') {",                                                              pages: ['gap', 'gapdrag'] },
  // le mode « balises » : ce que `unit: child` et les réglages qui s'appuient sur la piste embarquent, et que le texte seul ne reçoit pas
  { texte: 'var _MJS_FX_MARQUEE_RUN',                                                         pages: PISTE },
  { texte: 'function _mjsFxMarqueeKids(',                                                     pages: PISTE },
  { texte: 'function _mjsFxMarqueeMirror(',                                                   pages: PISTE },
  { texte: '[mjs-fx-marquee-strip="kids"]{white-space:normal}',                               pages: PISTE },
  { texte: '@keyframes mjs-fx-marquee-run{',                                                  pages: PISTE },
  { texte: '[mjs-fx-marquee-strip] > [mjs-fx-marquee-run][mjs-fx-marquee-run]{animation:none}', pages: PISTE },
  { texte: "var vertical = s.direction === 'up' || s.direction === 'down';",                  pages: [...PISTE, ...VERT] },
  { texte: 'var ax       = !vertical;',                                                       pages: PISTE },
  { texte: 'var ay       = vertical;',                                                        pages: PISTE },
  { texte: 'var needs    = false;',                                                           pages: PISTE },
  { texte: 'var extra    = 0;',                                                               pages: PISTE },
  { texte: 'var kids   = function() {',                                                       pages: PISTE },
  { texte: 'var swap;',                                                                       pages: PISTE },
  { texte: 'swap = function() {',                                                           pages: PISTE },
  { texte: 'if (tx.layer.parentNode === el) return;',                                       pages: PISTE },
  { texte: 'function _mjsFxMarqueeUnwrap(el) {',                                              pages: PISTE },
  { texte: "var _MJS_FX_MARQUEE_APART = '[mjs-fx-layer],[mjs-fx-heatmap-layer],[mjs-fx-goo-drop],[mjs-fx-react-stage],[mjs-fx-offline-band],[mjs-fx-offline-veil],[mjs-skel-zone]';", pages: PISTE },
  { texte: '_mjsFxMarqueeUnwrap(el);',                                                       pages: PISTE },
  { texte: 'if (mo) mo.disconnect();',                                                        pages: PISTE, n: DEUX },
  { texte: 'var stripSetup = function() {',                                                   pages: PISTE },
  { texte: 'needs || kids() ? stripSetup() :',                                                pages: PISTE },
  // l'avertissement du développement : aucune page ne le demande, seul le développement le reçoit
  { texte: 'function _mjsFxMarqueeTell(el, comp) {',                                          pages: [] },
  { texte: "if (!needs && s.unit === void 0 && kids()) _mjsFxMarqueeTell(el, comp);",        pages: [] }
]

// les signaux de build des sept réglages (features.ts : `<effet>_<réglage>:<valeur>`)
const SIGNAUX = ['marquee_drag:true', 'marquee_axis:both', 'marquee_on:scroll', 'marquee_reverse:true', 'marquee_direction:up', 'marquee_pause:true', 'marquee_gap:20', 'marquee_unit:child']
const GLOBALES = ['µ', 'window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'MutationObserver', 'ResizeObserver', 'Math', 'Array', 'Object', 'String', 'parseFloat', 'CustomEvent', 'Promise']

describe('étiquettes `// @@` de mjs_fx_marquee.ts — chaque réglage seul embarque sa section et rien d\'autre', function () {
  this.timeout(600000)
  after(async () => { await terminateSharedWorkerPool() })

  const src = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_marquee.ts'), 'utf-8')

  // un build RÉEL dont le code reste lisible (`minify: false`) ; `env: 'prod'` : le développement envoie le fichier en entier, le tri est celui de la production
  async function construire(nom: string, source: string, env = 'prod'): Promise<string> {
    const root   = mjsTmp('marquee-sections-' + nom)
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
  const appli = (balise: string) => `<script>\n$d = true\n$o = 'view'\n$g = 20\n</script>\n<p class="a" ${balise}>Un texte</p>`

  describe('les builds de production, une page par réglage', () => {
    const sorties: Record<string, string> = {}

    before(async () => {
      for (const [nom, page] of Object.entries(PAGES)) sorties[nom] = await construire(nom, appli(page.balise))
    })

    it('les jetons des étiquettes du fichier sont exactement ceux des pages de la table', () => {
      // le jeton `dev` : la section que seul le développement reçoit, aucune page ne l'écrit
      const dansLeFichier = [...new Set(unites(src).flatMap((u) => u.jetons))].filter((j) => j !== 'dev').sort()
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

    it('ce que fait `*marquee` sur un texte, sans rien écrire, part toujours : le texte et ses copies, la suspension hors de l\'écran ; la piste des enfants, non', () => {
      for (const reste of ['function _mjsFxMarqueeAway(', 'var layerSetup = function() {', 'part.textContent = txt.trim();', '[mjs-fx~="marquee"] [mjs-fx-marquee-track] > span + span{opacity:0']) {
        assert.ok(sorties[REF].includes(reste), reste)
      }
      for (const absent of ['function _mjsFxMarqueeMirror(', 'function _mjsFxMarqueeKids(', 'var stripSetup = function() {', '[mjs-fx-marquee-strip="kids"]', '@keyframes mjs-fx-marquee-run{']) {
        assert.equal(sorties[REF].includes(absent), false, absent)
      }
    })

    it('un réglage tenu par une variable : toutes ses valeurs, et rien des autres réglages', async () => {
      const main = await construire('variable-drag', appli('*marquee(drag: $d)'))
      assert.ok(main.includes('var down = function(e) {') && main.includes('var place = function() {'))
      assert.equal(main.includes('var onScroll = function() {') || main.includes('if (both) {'), false, 'la main n\'est pas le défilement ni la nappe')
      const defile = await construire('variable-on', appli('*marquee(on: $o)'))
      assert.ok(defile.includes('var onScroll = function() {') && defile.includes('function _mjsFxMarqueeWrap('))
      assert.equal(defile.includes('var down = function(e) {'), false, 'le défilement n\'est pas la main')
      // l'espace relu n'a de sens que pour la piste des enfants : sur un texte seul, la variable ne demande rien de plus
      const espace = await construire('variable-gap', appli('*marquee(gap: $g, drag: true)'))
      assert.ok(espace.includes('ctl.measure = function() {'))
      const texte = await construire('variable-gap-texte', appli('*marquee(gap: $g)'))
      assert.equal(texte.includes('ctl.measure = function() {'), false, 'sur un texte, la mesure de la piste ne part pas')
    })

    it('le développement envoie le fichier en entier, sans une marque (le panneau allume n\'importe quel réglage)', async () => {
      const dev = await construire('developpement', appli('*marquee'), 'dev')
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
        const texte  = selectFxSections('mjs_fx_marquee.ts', src, new Set(['use:marquee', ...ecrits]), false)
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
      const nu   = selectFxSections('mjs_fx_marquee.ts', src, new Set(['use:marquee']), false)
      const tout = selectFxSections('mjs_fx_marquee.ts', src, new Set(), true)
      assert.ok(nu.length < tout.length * 0.7, `${nu.length} octets sans réglage, ${tout.length} avec tout`)
    })
  })
})
