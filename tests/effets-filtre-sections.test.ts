// Les étiquettes `// @@` de mjs_fx_filter.ts, une par une : ce que commandent les six réglages de la zone sans filtre (`spot` : la zone
// elle-même, sa lentille, son double, ses règles CSS ; `soft` : son bord ; `smooth` : son retard ; `ring` : son cercle ; `near` : son approche ;
// `parallax` : sa dérive) ne part dans une application de production que si une page l'écrit (`*filter.lens` les écrit tous). Une application qui écrit `*filter` avec les réglages que la V3 connaissait (`style`, `amount`, `colors`, les réglages
// fins, `duration`, `easing`, `on`) reçoit l'atelier de retouche et rien de la zone.
//
// Trois gardes sur des builds réels de production (une page par réglage, code lisible) : les jetons des étiquettes du fichier sont exactement ceux
// des pages ; chaque section marquée porte au moins un témoin ; chaque témoin est embarqué par ses pages et par elles seules. Puis le filtre seul
// sur TOUTES les combinaisons des six réglages : le fichier filtré est du JavaScript valide, sans variable inconnue (une section qui réclame ce
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

type Sortie = { tout: string, filtre: string }
type Page   = { balise: string, jetons: string[] }
type Temoin = { texte: string, pages: string[], n?: Record<string, number> }

const REF = 'rien'

// chaque page n'écrit que ce qu'elle nomme ; les jetons sont ceux que ses réglages demandent. `soft`, `smooth`, `ring`, `near` et `parallax` seuls ne
// demandent rien d'embarqué : ils n'ont de sens qu'avec une zone (`spot`)
const PAGES: Record<string, Page> = {
  [REF]:      { balise: '*filter', jetons: [] },
  v3:         { balise: '*filter(style: duotone, amount: .8, colors: [\'#123456\', \'#fedcba\'], brightness: 1.1, contrast: 1.2, saturate: 1.1, hue: 10, blur: 1, sepia: .1, grayscale: .1, invert: .1, opacity: .9, duration: 300ms, easing: ease-out, on: hover)', jetons: [] },
  spot:       { balise: '*filter(spot: 200)', jetons: ['spot'] },
  soft:       { balise: '*filter(soft: 20)', jetons: ['soft'] },
  smooth:     { balise: '*filter(smooth: .5)', jetons: ['smooth'] },
  spotsoft:   { balise: '*filter(spot: 200, soft: 20)', jetons: ['spot', 'soft'] },
  spotsmooth: { balise: '*filter(spot: 200, smooth: .5)', jetons: ['spot', 'smooth'] },
  tout:       { balise: '*filter(spot: 200, soft: 20, smooth: .5)', jetons: ['spot', 'soft', 'smooth'] },
  ring:       { balise: '*filter(spot: 200, ring: true, color: #f00)', jetons: ['spot', 'ring'] },
  near:       { balise: '*filter(spot: 200, near: true)', jetons: ['spot', 'near'] },
  parallax:   { balise: '*filter(spot: 200, parallax: .04)', jetons: ['spot', 'parallax'] },
  lens:       { balise: '*filter.lens', jetons: ['spot', 'soft', 'smooth', 'ring', 'near', 'parallax'] },
  sanszone:   { balise: '*filter(ring: true, color: #f00, near: true, parallax: .04)', jetons: ['ring', 'near', 'parallax'] }
}

// les pages qui demandent la zone, son bord, son retard
const ZONE     = ['spot', 'spotsoft', 'spotsmooth', 'tout', 'ring', 'near', 'parallax', 'lens']
const BORD     = ['spotsoft', 'tout', 'lens']
const RETARD   = ['spotsmooth', 'tout', 'lens']
const CERCLE   = ['ring', 'lens']
const APPROCHE = ['near', 'lens']
const DERIVE   = ['parallax', 'lens']

// ce qui part avec la zone, et avec elle seule
const TEMOINS: Temoin[] = [
  { texte: "var _mjsFxSpotMedia = /^(video|audio|canvas|iframe|object|embed)$/;",           pages: ZONE },
  { texte: "var _mjsFxSpotMoves = ['transform', 'translate', 'rotate', 'scale', 'transform-origin'];", pages: ZONE },
  { texte: "var _mjsFxSpotLook = ['object-fit', 'object-position',",                         pages: ZONE },
  { texte: 'function _mjsFxSpotRelay() {',                                                    pages: ZONE },
  { texte: 'function _mjsFxSpotUnrelay() {',                                                  pages: ZONE },
  { texte: 'function _mjsFxSpot(el, cur) {',                                                  pages: ZONE },
  { texte: 'var diameter = function() {',                                                     pages: ZONE },
  { texte: 'var fine = function(cs) {',                                                       pages: ZONE },
  { texte: 'var _mjsFxSpotHolds = function(ps) {',                                            pages: ZONE },
  { texte: 'var free = function(h, hs) {',                                                    pages: ZONE },
  { texte: 'var hold = function(h) {',                                                        pages: ZONE },
  { texte: 'var place = function(c, r) {',                                                    pages: ZONE },
  { texte: 'var tick = function(now) {',                                                      pages: ZONE },
  { texte: 'relay = _mjsFxSpotRelay();',                                                      pages: ZONE },
  { texte: "µ._mjs_dom.setAttribute(c, 'mjs-fx-filter-copy', '');",                          pages: ZONE },
  { texte: 'var zone = _mjsFxSpot(el, cur);',                                                 pages: ZONE },
  { texte: 'zone.off();',                                                                     pages: ZONE },
  { texte: 'zone.set(k);',                                                                    pages: ZONE },
  { texte: '[mjs-fx-filter-lens][mjs-fx-filter-lens]{left:0;top:0;width:calc(',               pages: ZONE },
  { texte: '[mjs-fx-filter-lens][mjs-fx-filter-lens]>div{position:absolute;',                 pages: ZONE },
  { texte: '[mjs-fx-filter-lens="out"][mjs-fx-filter-lens="out"]{animation:mjs-fx-filter-out', pages: ZONE },
  { texte: '@keyframes mjs-fx-filter-in{from{opacity:0}to{opacity:1}}',                       pages: ZONE },
  { texte: '@keyframes mjs-fx-filter-out{from{opacity:1}to{opacity:0}}',                      pages: ZONE },
  { texte: '[mjs-fx-filter-lens][mjs-fx-filter-lens]{animation:none}',                        pages: ZONE },
  // le bord : la fonction qui le lit, et les deux endroits où il est écrit sur la lentille (à la pose, puis quand une variable le change)
  { texte: 'cur.soft === void 0',                                                             pages: BORD },
  { texte: "lens.style.setProperty('--mjs-fx-filter-s', edge() + 'px');",                     pages: BORD, n: { spotsoft: 2, tout: 2, lens: 2 } },
  { texte: "else if (k === 'soft' && lens)",                                                  pages: BORD },
  // le retard : l'appel de l'outil qui le ramène entre 0.01 et 1, et le suivi sur place
  { texte: 'µ._mjs_fxLagSetting(cur.smooth, 0.2)',                                            pages: RETARD },
  { texte: "else if (k === 'smooth') smooth = rate();",                                       pages: RETARD },
  // le cercle : sa pose juste après la lentille, sa place et son translate, son départ (avec la zone, ou en fondu seul), sa couleur et sa feuille
  { texte: 'var ring    = null;',                                                             pages: CERCLE },
  { texte: 'var pin = function() {',                                                          pages: CERCLE },
  { texte: 'pin();',                                                                          pages: CERCLE, n: { ring: 2, lens: 2 } },
  { texte: "if (ring) ring.style.setProperty('translate', at);",                              pages: CERCLE },
  { texte: "ring = document.createElement('div');",                                           pages: CERCLE },
  { texte: 'if (ring) ring.remove();',                                                        pages: CERCLE },
  { texte: 'ring  = null;',                                                                   pages: CERCLE, n: { ring: 2, lens: 2 } },
  { texte: 'var g = ring;',                                                                   pages: CERCLE },
  { texte: 'if (g) g.remove();',                                                              pages: CERCLE },
  { texte: "if (g) fade(g, 'mjs-fx-filter-ring');",                                           pages: CERCLE },
  { texte: "else if (k === 'ring') redo();",                                                  pages: CERCLE },
  { texte: "else if (k === 'color' && ring)",                                                 pages: CERCLE },
  { texte: '[mjs-fx-filter-ring][mjs-fx-filter-ring]{left:0;top:0;',                          pages: CERCLE },
  { texte: '[mjs-fx-filter-ring][mjs-fx-filter-ring]{animation:none}',                        pages: CERCLE },
  // l'approche : la lecture des mouvements de la page, une fois par image, la zone sans fondu qui part d'un coup, l'écoute posée et retirée
  { texte: 'var nearby  = false;',                                                            pages: APPROCHE },
  { texte: 'var pend    = null;',                                                             pages: APPROCHE },
  { texte: 'var scan    = 0;',                                                                pages: APPROCHE },
  { texte: "µ._mjs_dom.setAttribute(lens, 'mjs-fx-filter-lens', cut ? 'sharp' : 'near');",    pages: APPROCHE },
  { texte: '[mjs-fx-filter-lens="sharp"][mjs-fx-filter-lens="sharp"]{animation:none;',       pages: APPROCHE },
  { texte: "else if (k === 'soft' && nearby) redo();",                                        pages: APPROCHE },
  { texte: 'var sense = function() {',                                                        pages: APPROCHE },
  { texte: 'if (!fading.length) release();',                                                  pages: APPROCHE },
  { texte: "µ._mjs_dom.addEventListener(document, 'pointermove', seek, { passive: true });",  pages: APPROCHE },
  { texte: "µ._mjs_dom.removeEventListener(document, 'pointermove', seek);",                  pages: APPROCHE },
  { texte: "else if (k === 'near' && bound) {",                                               pages: APPROCHE },
  { texte: '[mjs-fx-filter-lens="near"][mjs-fx-filter-lens="near"]{animation:none}',          pages: APPROCHE },
  // le bord de la zone compte dans la distance de l'approche : avec l'un et l'autre seulement
  { texte: 's = edge();',                                                                     pages: ['lens'] },
  { texte: 'cut = !edge();',                                                                  pages: ['lens'] },
  // le cercle ou l'approche changés par une variable : la zone repart
  { texte: 'var redo = function() {',                                                         pages: ['ring', 'near', 'lens'] },
  // la dérive : son calcul, le décalage SVG posé une fois, l'ancrage du double, son retrait, la règle qui la met avant le filtre
  { texte: 'var drift   = null;',                                                             pages: DERIVE },
  { texte: 'var wx      = 0;',                                                                pages: DERIVE },
  { texte: 'var wy      = 0;',                                                                pages: DERIVE },
  { texte: 'var sway = function() {',                                                         pages: DERIVE },
  { texte: 'ax = wx - +gx.toFixed(1);',                                                       pages: DERIVE },
  { texte: '((r.left - o.left) / ax + wx)',                                                   pages: DERIVE },
  { texte: 'drift.svg.remove();',                                                             pages: DERIVE },
  { texte: '[mjs-fx~="filter"][mjs-fx-on~="filter"][mjs-fx-filter-drift]{filter:',           pages: DERIVE },
  // l'avertissement du développement (un parent qui rogne et qu'on ne peut pas positionner) : aucune page ne le demande, seul le développement le reçoit
  { texte: "var _mjsFxSpotTold = typeof WeakSet === 'function'",                              pages: [] },
  { texte: 'var tell = function(h) {',                                                        pages: [] },
  { texte: 'tell(a);',                                                                        pages: [] }
]

// ce que fait `*filter` sans rien écrire : l'atelier de retouche, la pose et le retrait du filtre, le suivi d'une variable
const RESTE = [
  'function _mjsFxHolder(el, id) {',
  'var _mjsFxFilN = 0;',
  'function _mjsFxPlan(',
  'var _MJS_FX_FILTERS = {',
  'µ._mjs_fxDefs.filter = {',
  '[mjs-fx~="filter"]{transition:filter var(--mjs-filter-duration,400ms) var(--mjs-filter-easing,ease)}',
  '[mjs-fx~="filter"][mjs-fx-on~="filter"]{filter:var(--mjs-fx-filter-value)}',
  '@media (prefers-reduced-motion:reduce){[mjs-fx~="filter"][mjs-fx~="filter"]{transition:none}',
  "gate = µ._mjs_fxState(el, 'filter', cur.on || 'always');",
  'stop.set = function(k, v) {',
  "else if (k !== 'duration' && k !== 'easing') paint();",
  "el.style.removeProperty('--mjs-fx-filter-value');"
]

// les signaux de build des six réglages (features.ts : `<effet>_<réglage>:<valeur>`)
const SIGNAUX  = ['filter_spot:200', 'filter_soft:20', 'filter_smooth:0.5', 'filter_ring:true', 'filter_near:true', 'filter_parallax:0.04']
const GLOBALES = ['µ', 'window', 'document', 'navigator', 'devicePixelRatio', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'MutationObserver', 'ResizeObserver', 'Element', 'WeakMap', 'Map', 'Set', 'Math', 'Array', 'Object', 'String', 'Date', 'isNaN', 'parseFloat', 'Promise']

describe('étiquettes `// @@` de mjs_fx_filter.ts — chaque réglage de la zone embarque sa section et rien d\'autre', function () {
  this.timeout(600000)
  after(async () => { await terminateSharedWorkerPool() })

  const src = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_filter.ts'), 'utf-8')

  // un build RÉEL dont le code reste lisible (`minify: false`) ; `env: 'prod'` : le développement envoie le fichier en entier, le tri est celui de la production.
  // `tout` : tous les .js émis ; `filtre` : le fichier de l'effet seul (`mjs_fx_filter-<empreinte>.js`), le même d'une page à l'autre quand rien ne le change
  async function construire(nom: string, source: string | Record<string, string>, env = 'prod', plus: Record<string, unknown> = {}): Promise<Sortie> {
    const root   = mjsTmp('filtre-sections-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [fichier, texte] of Object.entries(typeof source === 'string' ? { 'p.mjs': source } : source)) writeFileSync(join(srcDir, fichier), texte)
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...plus }
    if (env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire     = (liste: string[]) => liste.map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
    return { tout: lire(fichiers), filtre: lire(fichiers.filter((f) => f.startsWith('mjs_fx_filter-'))) }
  }
  const appli = (balise: string) => `<script>\n$s = 200\n$f = 20\n$m = .5\n</script>\n<div class="a" ${balise}>Un cadre</div>`

  describe('les builds de production, une page par réglage', () => {
    const sorties: Record<string, Sortie> = {}

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
        assert.equal(sortie.tout.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false, `${nom} : une marque de section sort`)
        assert.ok(sortie.filtre.includes('µ._mjs_fxDefs.filter = {'), `${nom} : le fichier de l'effet est à part`)
        for (const t of TEMOINS) {
          const delta = compte(sortie.filtre, t.texte) - compte(sorties[REF].filtre, t.texte)
          assert.equal(delta, t.pages.includes(nom) ? (t.n?.[nom] ?? 1) : 0, `page « ${nom} » (${PAGES[nom].balise}) : « ${t.texte} » ${t.pages.includes(nom) ? 'doit partir' : 'ne doit pas partir'}`)
        }
      }
    })

    it('`*filter` sans réglage de la zone garde tout son atelier, sur toutes les pages : rien de ce qui sert au défaut n\'est dans une section', () => {
      for (const [nom, sortie] of Object.entries(sorties)) {
        for (const reste of RESTE) assert.ok(sortie.filtre.includes(reste), `page « ${nom} » : « ${reste} » manque`)
      }
      const liste = unites(src)
      for (const reste of RESTE) assert.equal(liste.some((u) => u.propres.join('\n').includes(reste)), false, `« ${reste} » est dans une section`)
    })

    it('les réglages de la V3 ne font rien partir de la zone : même fichier que `*filter` seul, à l\'octet', () => {
      assert.equal(sorties.v3.filtre, sorties[REF].filtre)
    })

    it('`soft`, `smooth`, `ring`, `color`, `near` ou `parallax` écrits sans `spot` : rien de plus qu\'`*filter` seul', () => {
      assert.equal(sorties.soft.filtre, sorties[REF].filtre)
      assert.equal(sorties.smooth.filtre, sorties[REF].filtre)
      assert.equal(sorties.sanszone.filtre, sorties[REF].filtre)
    })

    it('un réglage tenu par une variable : toutes ses valeurs, et rien des autres réglages', async () => {
      const zone = await construire('variable-spot', appli('*filter(spot: $s)'))
      for (const t of TEMOINS.filter((x) => x.pages.includes('spot'))) assert.ok(zone.filtre.includes(t.texte), `spot tenu par une variable : « ${t.texte} » manque`)
      assert.equal(zone.filtre.includes('cur.soft === void 0') || zone.filtre.includes('µ._mjs_fxLagSetting('), false, 'la zone n\'est ni son bord ni son retard')
      const bord = await construire('variable-soft', appli('*filter(spot: 200, soft: $f)'))
      assert.ok(bord.filtre.includes('cur.soft === void 0') && bord.filtre.includes('function _mjsFxSpot(el, cur) {'))
      assert.equal(bord.filtre.includes('µ._mjs_fxLagSetting('), false, 'le bord n\'est pas le retard')
      const retard = await construire('variable-smooth', appli('*filter(spot: 200, smooth: $m)'))
      assert.ok(retard.filtre.includes('µ._mjs_fxLagSetting(cur.smooth, 0.2)') && retard.filtre.includes("else if (k === 'smooth') smooth = rate();"))
      assert.equal(retard.filtre.includes('cur.soft === void 0'), false, 'le retard n\'est pas le bord')
      const seul = await construire('variable-smooth-seul', appli('*filter(smooth: $m)'))
      assert.equal(seul.filtre, sorties[REF].filtre, 'un retard sans zone ne fait rien partir')
    })

    it('un effet réglé une fois dans un `*.effects.mjs` : ce qu\'il écrit part (la zone et son bord), et rien de plus', async () => {
      const projet = await construire('alias', { 'marque.effects.mjs': '<effects>\n  *lampe = *filter(spot: 160, soft: 20)\n</effects>', 'p.mjs': '<div class="a" *lampe>x</div>' })
      assert.ok(projet.filtre.includes('function _mjsFxSpot(el, cur) {') && projet.filtre.includes('cur.soft === void 0'))
      assert.equal(projet.filtre.includes('µ._mjs_fxLagSetting('), false, 'le retard n\'est pas écrit')
    })

    it('la demande explicite du fichier (`runtime: [\'fx_filter\']`) garde tout, comme un effet choisi par une variable', async () => {
      const tout = await construire('demande', appli('*filter'), 'prod', { runtime: ['fx_filter'] })
      for (const t of TEMOINS) assert.ok(tout.tout.includes(t.texte), `demande explicite : « ${t.texte} » manque`)
    })

    it('le développement envoie le fichier en entier, sans une marque (le panneau allume n\'importe quel réglage)', async () => {
      const dev = await construire('developpement', appli('*filter'), 'dev')
      assert.equal(dev.tout.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false)
      for (const t of TEMOINS) assert.ok(dev.tout.includes(t.texte), `développement : « ${t.texte} »`)
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
        const texte  = selectFxSections('mjs_fx_filter.ts', src, new Set(['use:filter', ...ecrits]), false)
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

    it('le fichier entier (développement, demande explicite) est lui aussi du JavaScript valide', () => {
      const texte = selectFxSections('mjs_fx_filter.ts', src, new Set(), true)
      acorn.parse(texte, { ecmaVersion: 'latest' })
      assert.deepEqual(linter.verify(texte, config).map((m) => `${m.ruleId} : ${m.message}`), [])
    })

    it('sans aucun réglage de la zone, le fichier est bien plus court que le fichier entier', () => {
      const nu   = selectFxSections('mjs_fx_filter.ts', src, new Set(['use:filter']), false)
      const tout = selectFxSections('mjs_fx_filter.ts', src, new Set(), true)
      assert.ok(nu.length < tout.length * 0.7, `${nu.length} octets sans réglage, ${tout.length} avec tout`)
    })
  })
})
