// Les étiquettes `// @@` de mjs_fx_fluid.ts : tout ce que ne sert qu'au mode texte (`where: text`) — le masque des lettres, la signature de la typographie, le guetteur du
// thème, la lecture du fond écrit, la branche du programme d'affichage, le suivi des transitions de couleur — ne part dans une application de production que si une page
// écrit `where: text`, ou un `where` que le build ne sait pas lire (une variable). Une application qui n'écrit que `*fluid`, ou `where: box`, n'en reçoit rien ;
// le développement envoie tout (le panneau d'inspection peut allumer `where: text` sur une balise qui ne l'écrit pas).
//
// Trois gardes sur des builds réels de production (une page par cas, code lisible) : les jetons des étiquettes du fichier sont exactement ceux des pages ; chaque section
// marquée porte au moins un témoin ; chaque témoin est embarqué par les pages du texte et par elles seules. Puis le filtre seul, avec et sans la demande du texte : le fichier
// filtré est du JavaScript valide, sans variable inconnue (une section qui réclame ce qu'une autre ne déclare pas) ni variable déclarée et jamais lue (un reste que plus rien
// n'utilise).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
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
type Temoin = { texte: string, n?: number }

const REF = 'rien'

// les pages : celles du texte (`TEXTE`) demandent la section, les autres non. Les jetons sont ceux que la page demande au fichier
const PAGES: Record<string, Page> = {
  [REF]:      { balise: '*fluid', jetons: [] },
  boite:      { balise: '*fluid(where: box)', jetons: [] },
  reglages:   { balise: '*fluid(auto: true, size: 1, background: #000)', jetons: [] },
  alias_box:  { balise: '*fluid.two_colors', jetons: [] },
  texte:      { balise: '*fluid(where: text)', jetons: ['where=text'] },
  variable:   { balise: '*fluid(where: $w)', jetons: [] },
  alias_text: { balise: '*fluid.ink_title', jetons: [] }
}
const TEXTE = ['texte', 'variable', 'alias_text']

// des textes qui ne sont que dans les sections du texte (un par section, au moins) : ils partent avec les pages du texte, de `n` exemplaires, et nulle part ailleurs
const TEMOINS: Temoin[] = [
  { texte: "'uniform sampler2D uMask;'" },
  { texte: "'  vec4 pen = texture2D(uMask, vUv);'" },
  { texte: 'var textless   = false;' },
  { texte: 'function warnComponent() {' },
  { texte: 'µ._mjs_fxTextMask = function(el, bw, bh, plain) {' },
  { texte: 'function resolve(raw, host) {' },
  { texte: 'var TYPO = [' },
  { texte: 'function signature(el) {' },
  { texte: 'function watchTheme(f) {' },
  { texte: '[mjs-fx-layer="fluid"][mjs-fx-fluid-mask]{background:none}' },
  { texte: '[mjs-fx~="fluid"][mjs-fx-fluid-text]{-webkit-text-fill-color:transparent}' },
  { texte: '[mjs-fx~="fluid"][mjs-fx-fluid-text]{-webkit-text-fill-color:currentColor}' },
  { texte: "text        = s.where === 'text' && host === el;" },
  { texte: "if (s.where === 'text' && !text) warnComponent();" },
  { texte: "if (text) c.setAttribute('mjs-fx-fluid-mask', '');" },
  { texte: 'var maskT  = null;' },
  { texte: 'var maskDirty = true;' },
  { texte: "var signed    = '';" },
  { texte: 'var backStale = true;' },
  { texte: 'var textOn    = 0;' },
  { texte: 'var back      = null;' },
  { texte: 'if (text) maskDirty = true;' },
  { texte: 'maskT     = null;' },
  { texte: "µ._mjs_dom.removeAttribute(el, 'mjs-fx-fluid-text');", n: 3 },
  { texte: 'if (textOn) {' },
  { texte: '        maskDirty = true;\n        kick();\n      };\n\n      // ---- une image : on avance le fluide d\'un pas, puis on l\'affiche' },
  { texte: 'var loadMask = function() {' },
  { texte: 'if (text && (backStale || maskDirty)) {' },
  { texte: 'var bk = back || [0, 0, 0, 0];' },
  { texte: 'if (text && !textOn) textOn = 1;' },
  { texte: 'if (textOn === 1) {' },
  { texte: 'for (var t = fading.length - 1; t >= 0; t--) {' },
  { texte: 'var reread = function() {\n        if (!text || !gl || lost || signature(el) === signed) return;' },
  { texte: 'var rouse = function() {\n        reread();' },
  { texte: 'var redo = function() {' },
  { texte: 'var recheck = function() {' },
  { texte: 'var tintRun = function(e) {' },
  { texte: 'var tintEnd = function(e) {' },
  { texte: 'var unthem  = text ? watchTheme(recheck) : null;' },
  { texte: "hear('transitionrun', tintRun);" },
  { texte: 'var unwatch = text ? µ._mjs_fxOnText(el, redo) : null;' },
  { texte: 'if (fonts) {' },
  { texte: "if (text) hear('resize', redo, window);" },
  { texte: 'if (unwatch) unwatch();' },
  { texte: 'if (tinted) tinted.disconnect();' },
  { texte: '          backStale = true;\n          kick();' }
]

// ce que `*fluid` en boîte fait sans rien écrire : cela part toujours
const RESTE = ['function substitute(raw, host) {', 'function inks(list, host) {', 'function paint(str, strict) {', 'var make = function() {', 'var first = function() {', 'var fit = function() {', '[mjs-fx-layer="fluid"]{position:absolute;inset:0']

const SIGNAUX_TEXTE = ['use:fluid', 'fluid_where:text']
const GLOBALES = ['µ', 'window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'matchMedia', 'CSS', 'devicePixelRatio', 'Float32Array', 'Uint8Array', 'Math', 'Array', 'Object', 'String', 'parseFloat', 'isFinite', 'PointerEvent']

describe('étiquettes `// @@` de mjs_fx_fluid.ts — le mode texte ne part que si une page écrit `where: text`', function () {
  this.timeout(600000)
  after(async () => { await terminateSharedWorkerPool() })

  const src = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_fluid.ts'), 'utf-8')

  // un build RÉEL dont le code reste lisible (`minify: false`) ; `env: 'prod'` : le développement envoie le fichier en entier, le tri est celui de la production
  async function construire(nom: string, source: string, env = 'prod', minify = false): Promise<string> {
    const root   = mjsTmp('fluid-sections-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), source)
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify }
    if (env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    return readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  }
  const appli = (balise: string) => `<script>\n$w = 'text'\n</script>\n<div class="a" ${balise}>Un texte</div>`

  describe('les builds de production, une page par cas', () => {
    const sorties: Record<string, string> = {}

    before(async () => {
      for (const [nom, page] of Object.entries(PAGES)) sorties[nom] = await construire(nom, appli(page.balise))
    })

    it('les jetons des étiquettes du fichier sont exactement ceux des pages de la table', () => {
      const dansLeFichier = [...new Set(unites(src).flatMap((u) => u.jetons))].sort()
      const dansLaTable   = [...new Set(Object.values(PAGES).flatMap((p) => p.jetons))].sort()
      assert.deepEqual(dansLeFichier, dansLaTable)
    })

    it('chaque section marquée porte au moins un témoin sur ses lignes propres, et chaque témoin est dans une section', () => {
      const liste = unites(src)
      // un témoin sur plusieurs lignes couvre la section d'une seule ligne dont il contient la ligne
      const porte = (u: Unite, texte: string) => u.propres.join('\n').includes(texte) || (texte.includes('\n') && u.propres.length === 1 && texte.split('\n').some((l) => l === u.propres[0]))
      for (const u of liste) assert.ok(TEMOINS.some((t) => porte(u, t.texte)), `la section « ${u.jetons.join(' ')} » (ligne ${u.ligne}) n'a aucun témoin`)
      for (const t of TEMOINS) assert.ok(liste.some((u) => porte(u, t.texte)), `le témoin « ${t.texte} » n'est dans aucune section marquée`)
    })

    it('aucune marque ne sort, et seules les pages du texte portent les témoins du texte (la boîte, un autre réglage, un alias en boîte : aucun)', () => {
      for (const [nom, sortie] of Object.entries(sorties)) {
        assert.equal(sortie.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false, `${nom} : une marque de section sort`)
        for (const t of TEMOINS) {
          const delta = compte(sortie, t.texte) - compte(sorties[REF], t.texte)
          assert.equal(delta, TEXTE.includes(nom) ? (t.n ?? 1) : 0, `page « ${nom} » (${PAGES[nom].balise}) : « ${t.texte} » ${TEXTE.includes(nom) ? 'doit partir' : 'ne doit pas partir'}`)
        }
      }
    })

    it('une application en boîte ne contient plus le code du mode texte, et une application qui écrit `where: $w` (ou `where: text`) le contient', () => {
      for (const nom of [REF, 'boite', 'reglages', 'alias_box']) {
        assert.equal(sorties[nom].includes('µ._mjs_fxTextMask'), false, `${nom} : le masque du texte ne part pas`)
        assert.equal(sorties[nom].includes('function watchTheme('), false, `${nom} : le guetteur du thème ne part pas`)
      }
      for (const nom of TEXTE) {
        assert.ok(sorties[nom].includes('µ._mjs_fxTextMask = function('), `${nom} : le masque du texte part`)
        assert.ok(sorties[nom].includes('function watchTheme('), `${nom} : le guetteur du thème part`)
      }
    })

    it('ce que `*fluid` fait en boîte part dans toutes les pages, texte comprise', () => {
      for (const [nom, sortie] of Object.entries(sorties)) for (const t of RESTE) assert.ok(sortie.includes(t), `${nom} : « ${t} » doit partir`)
    })

    it('le code du mode texte pèse plus de 2 Ko de gzip dans une application en boîte construite sans lui (et une application en texte ne perd rien)', async () => {
      const [boite, texte] = [await construire('poids-boite', appli('*fluid'), 'prod', true), await construire('poids-texte', appli('*fluid(where: text)'), 'prod', true)]
      const [gb, gt] = [gzipSync(boite, { level: 9 }).length, gzipSync(texte, { level: 9 }).length]
      assert.ok(gt - gb > 2048, `la boîte pèse ${gb} octets gzip, le texte ${gt} : ${gt - gb} octets de gzip en moins pour la boîte`)
    })

    it('le développement envoie le fichier en entier, sans une marque (le panneau allume n\'importe quel réglage)', async () => {
      const dev = await construire('developpement', appli('*fluid'), 'dev')
      assert.equal(dev.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false)
      for (const t of TEMOINS) assert.equal(compte(dev, t.texte), t.n ?? 1, `développement : « ${t.texte} »`)
    })
  })

  describe('le filtre seul, avec et sans la demande du texte', () => {
    const linter = new Linter()
    const config: any = [{
      languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: Object.fromEntries(GLOBALES.map((n) => [n, 'readonly'])) },
      rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { vars: 'all', args: 'none', caughtErrors: 'none' }] }
    }]

    for (const [quoi, signaux, forcee] of [['sans la demande du texte', ['use:fluid'], false], ['avec `where: text`', SIGNAUX_TEXTE, false], ['avec `where: $w`', ['use:fluid', 'fluid_where:*'], false], ['tout demandé', [], true]] as const) {
      it(`${quoi} : du JavaScript valide, sans variable inconnue ni variable jamais lue`, () => {
        const texte = selectFxSections('mjs_fx_fluid.ts', src, new Set(signaux), forcee)
        acorn.parse(texte, { ecmaVersion: 'latest' })
        assert.deepEqual(linter.verify(texte, config).map((m) => `${m.line} ${m.ruleId} : ${m.message}`), [])
      })
    }

    it('sans la demande du texte, le fichier est plus court de plus de 15 % que le fichier entier ; la demande du texte rend le fichier entier', () => {
      const nu    = selectFxSections('mjs_fx_fluid.ts', src, new Set(['use:fluid']), false)
      const texte = selectFxSections('mjs_fx_fluid.ts', src, new Set(SIGNAUX_TEXTE), false)
      const tout  = selectFxSections('mjs_fx_fluid.ts', src, new Set(), true)
      assert.ok(nu.length < tout.length * 0.85, `${nu.length} octets sans le texte, ${tout.length} avec tout`)
      assert.equal(texte, tout)
    })
  })
})
