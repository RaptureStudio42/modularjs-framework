// Les sections `// @@` de mjs_fx_goo.ts : la goutte qui suit la souris (`pointer`) ne part que dans une appli dont une page écrit `pointer`.
// Les réglages que `*goo` connaissait avant (mode, color, strength, halo, count, distance, on, drag) ne portent aucune section : l'appli qui
// n'écrit que ceux-là reçoit le fichier d'avant, sans une ligne de la goutte (ni son style, ni sa variable, ni son suivi, ni sa branche de `set`).
//
// La table est la référence indépendante des étiquettes : des PAGES (chacune écrit ce qu'elle écrit) et des TÉMOINS (un texte du fichier, avec
// les pages qui doivent l'embarquer). Trois gardes la tiennent : les jetons des étiquettes du fichier sont exactement ceux des pages, chaque
// section marquée porte au moins un témoin sur ses lignes propres, et chaque témoin est embarqué par ses pages et par elles seules.
// (Le test systématique des étiquettes, effets-sections-etiquettes, a une table par fichier : celle de *goo est ici.)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as acorn from 'acorn'
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

const REF = 'rien'

// ce que chaque page écrit : le réglage `pointer` (avec n'importe quelle valeur, même 0 ou une variable) demande la goutte, rien d'autre
const PAGES: Record<string, { balise: string, jetons: string[] }> = {
  [REF]:            { balise: '*goo(merge)', jetons: [] },
  'goutte-seule':   { balise: '*goo', jetons: [] },
  'reglages-merge': { balise: '*goo(merge, halo: 0, strength: 14, drag: true, color: #0af)', jetons: [] },
  'reglages-drip':  { balise: '*goo(on: hover, count: 5, distance: 300, color: #0af, strength: 8)', jetons: [] },
  pointer:          { balise: '*goo(merge, pointer: 90)', jetons: ['pointer'] },
  'pointer-zero':   { balise: '*goo(merge, pointer: 0)', jetons: ['pointer'] },
  'pointer-var':    { balise: '<script>\n$p = 90\n</script>\n<div class="a" *goo(merge, pointer: $p)>x</div>', jetons: ['pointer'] },
  'pointer-drag':   { balise: '*goo(merge, pointer: 60, drag: true, halo: 20)', jetons: ['pointer'] }
}
const AVEC = Object.keys(PAGES).filter((p) => PAGES[p].jetons.includes('pointer'))

// les textes du fichier qui ne sont que dans une section `pointer`, et les pages qui doivent les embarquer
const TEMOINS: Array<{ texte: string, pages: string[] }> = [
  { texte: '[mjs-fx-goo-drop]{position:absolute',                   pages: AVEC },
  { texte: "pointer: 'px'",                                         pages: AVEC },
  { texte: 'var paint = function(node) {',                          pages: AVEC },
  { texte: 'var dot     = null;',                                   pages: AVEC },
  { texte: 'var place = function(e) {',                             pages: AVEC },
  { texte: "dot.style.setProperty('--mjs-fx-goo-pc'",               pages: AVEC },
  { texte: 'unwatch = µ._mjs_fxScroll(el, again);',                 pages: AVEC },
  { texte: "µ._mjs_dom[f](el, 'pointermove', follow, { passive: true });", pages: AVEC },
  { texte: 'if (s.pointer > 0) track(true);',                       pages: AVEC },
  { texte: 'undo.push(function() { track(false); });',              pages: AVEC },
  { texte: "if (k === 'pointer') {",                                pages: AVEC },
  { texte: 'if (s.mode === \'merge\') track(v > 0);',               pages: AVEC }
]

// ce que fait `*goo` sans rien écrire de neuf, et que les sections ne touchent pas : le défaut, le halo, le glisser, la goutte du mode drip
const GARDES = [
  "layer.setAttribute('mjs-fx-layer', 'goo');",
  "µ._mjs_dom.setAttribute(el, 'mjs-fx-goo', 'merge');",
  "if (s.drag) {",
  "var cs    = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;",
  "if (k !== 'halo') return false;",
  "vars: {",
  "halo: 'px'"
]

describe('mjs_fx_goo.ts — la goutte du pointeur ne part que si une page écrit `pointer`', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const src = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_goo.ts'), 'utf-8')

  // un build RÉEL de production dont le code reste lisible (`minify: false`) : le développement envoie les fichiers d'effets en entier, le tri des sections est celui de la production ; rend tout le JavaScript émis
  async function construire(nom: string, fichiers: Record<string, string>, conf: any = {}): Promise<string> {
    const root   = mjsTmp('goo-sections-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, texte] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), texte)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', minify: false, ...conf } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    return readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  }
  const appli = (balise: string) => balise.startsWith('<') ? balise : `<div class="a" ${balise}>x</div>`
  const page  = (balise: string) => ({ 'p.mjs': appli(balise) })

  const sorties: Record<string, string> = {}
  before(async () => {
    for (const [nom, p] of Object.entries(PAGES)) sorties[nom] = await construire(nom, page(p.balise))
  })

  it('les jetons des étiquettes du fichier sont exactement ceux des pages de la table', () => {
    const dansLeFichier = [...new Set(unites(src).flatMap((u) => u.jetons))].sort()
    const dansLaTable   = [...new Set(Object.values(PAGES).flatMap((p) => p.jetons))].sort()
    assert.deepEqual(dansLeFichier, dansLaTable)
  })

  it('chaque section marquée porte au moins un témoin sur ses lignes propres, et chaque témoin est dans une section', () => {
    const liste = unites(src)
    assert.ok(liste.length >= 5, 'la goutte tient en plusieurs sections : son style, sa variable, son assistant de couleur, son suivi, sa branche de set')
    for (const u of liste) assert.ok(TEMOINS.some((t) => u.propres.join('\n').includes(t.texte)), `la section « ${u.jetons.join(' ')} » (ligne ${u.ligne}) n'a aucun témoin`)
    for (const t of TEMOINS) {
      assert.ok(liste.some((u) => u.propres.join('\n').includes(t.texte)), `le témoin « ${t.texte} » n'est dans aucune section marquée`)
      for (const p of t.pages) assert.ok(PAGES[p], `le témoin « ${t.texte} » cite la page ${p}, qui n'existe pas`)
    }
  })

  it('le défaut et les réglages d\'avant ne sont dans aucune section : ils sont dans le fichier, hors des marques', () => {
    const marques = unites(src).map((u) => u.propres.join('\n')).join('\n')
    for (const g of GARDES) {
      assert.ok(src.includes(g), `« ${g} » est dans le fichier`)
      assert.equal(marques.includes(g), false, `« ${g} » ne doit être dans aucune section`)
    }
  })

  it('aucune marque ne sort, et chaque page porte les témoins de la goutte si elle écrit `pointer`, et seulement alors', () => {
    for (const [nom, sortie] of Object.entries(sorties)) {
      assert.equal(sortie.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false, `${nom} : une marque de section sort`)
      for (const t of TEMOINS) {
        const delta = compte(sortie, t.texte) - compte(sorties[REF], t.texte)
        assert.equal(delta, t.pages.includes(nom) ? 1 : 0, `page « ${nom} » (${PAGES[nom].balise}) : « ${t.texte} » ${t.pages.includes(nom) ? 'doit partir' : 'ne doit pas partir'}`)
      }
    }
  })

  it('les pages sans `pointer` ne portent aucun témoin de la goutte, ni la page de référence : le fichier d\'avant, et le défaut y est', () => {
    for (const nom of Object.keys(PAGES).filter((p) => !AVEC.includes(p))) {
      for (const t of TEMOINS) assert.equal(sorties[nom].includes(t.texte), false, `page « ${nom} » : « ${t.texte} » ne part pas`)
      for (const g of GARDES) assert.ok(sorties[nom].includes(g), `page « ${nom} » : « ${g} » part`)
    }
    for (const nom of AVEC) for (const g of GARDES) assert.ok(sorties[nom].includes(g), `page « ${nom} » : « ${g} » part aussi`)
  })

  it('un build de développement envoie le fichier en entier (le panneau d\'inspection peut allumer `pointer`), sans une marque', async () => {
    const dev = await construire('dev', page('*goo(merge)'), { env: undefined })
    for (const t of TEMOINS) assert.ok(dev.includes(t.texte), `développement : « ${t.texte} » part`)
    assert.equal(dev.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false, 'aucune marque ne sort')
  })

  it('tout part quand le build ne sait pas lire : un effet choisi par une variable, le fichier demandé au cœur, un fichier d\'effets qui écrit `pointer`', async () => {
    const choisi = await construire('choisi', { 'p.mjs': '<div class="a" *goo(merge)>x</div>', 'q.mjs': '<script>\n$fx = \'none\'\n</script>\n<span *delta(fx: $fx)>x</span>' })
    for (const t of TEMOINS) assert.ok(choisi.includes(t.texte), `effet choisi par une variable : « ${t.texte} »`)
    const force = await construire('force', page('*goo(merge)'), { runtime: ['fx_goo'] })
    for (const t of TEMOINS) assert.ok(force.includes(t.texte), `demande explicite : « ${t.texte} »`)
    const projet = await construire('projet', { 'marque.effects.mjs': '<effects>\n  *gluant = *goo(merge, pointer: 60)\n</effects>', 'p.mjs': '<div class="a" *gluant>x</div>' })
    for (const t of TEMOINS) assert.ok(projet.includes(t.texte), `fichier d'effets : « ${t.texte} »`)
    const calme = await construire('projet-calme', { 'marque.effects.mjs': '<effects>\n  *gluant = *goo(merge, halo: 20)\n</effects>', 'p.mjs': '<div class="a" *gluant>x</div>' })
    for (const t of TEMOINS) assert.equal(calme.includes(t.texte), false, `fichier d'effets sans pointer : « ${t.texte} »`)
  })

  it('deux pages, une seule écrit `pointer` : la réunion de leurs réglages', async () => {
    const deux = await construire('deux', { 'a.mjs': '<div class="a" *goo(merge)>x</div>', 'b.mjs': '<div class="b" *goo(merge, pointer: 40)>y</div>' })
    for (const t of TEMOINS) assert.equal(compte(deux, t.texte), 1, `« ${t.texte} » part une fois`)
  })

  it('le fichier filtré est du JavaScript valide pour chaque demande (rien, mode, pointer fixe, nul, tenu par une variable, tout)', () => {
    const DEMANDES: Array<[string[], boolean]> = [
      [[], false], [['use:goo'], false], [['use:goo', 'goo_mode:merge'], false], [['use:goo', 'goo_mode:merge', 'goo_halo:0', 'goo_drag:true'], false],
      [['use:goo', 'goo_pointer:90'], false], [['use:goo', 'goo_pointer:0'], false], [['use:goo', 'goo_pointer:*'], false], [[], true]
    ]
    for (const [signaux, tout] of DEMANDES) {
      const texte = selectFxSections('mjs_fx_goo.ts', src, new Set(signaux), tout)
      acorn.parse(texte, { ecmaVersion: 'latest' })
      assert.equal(texte.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false, `${signaux.join(' ')} : aucune marque`)
      const pointeur = signaux.some((s) => s.startsWith('goo_pointer:')) || tout
      assert.equal(texte.includes('track(true)'), pointeur, `${signaux.join(' ') || 'rien'}${tout ? ' (tout)' : ''} : la goutte ${pointeur ? 'part' : 'ne part pas'}`)
    }
  })

  it('en production (code réduit) : le fichier sans `pointer` est plus léger de plus de 900 octets, et aucune marque ne sort', async () => {
    const poids = async (nom: string, balise: string) => (await construire(nom, page(balise), { minify: true })).length
    const sans = await poids('prod-sans', '*goo(merge)')
    const avec = await poids('prod-avec', '*goo(merge, pointer: 90)')
    assert.ok(avec > sans + 900, `${avec} octets avec pointer, ${sans} sans`)
    const texte = await construire('prod-marque', page('*goo(merge)'), { minify: true })
    assert.equal(texte.includes('@@'), false, 'aucune marque ne sort')
    // « mjs-fx-goo-drop » nomme aussi l'animation des gouttes du mode drip : la goutte du pointeur, c'est sa règle et sa couleur
    assert.equal(texte.includes('[mjs-fx-goo-drop]') || texte.includes('--mjs-fx-goo-pc'), false, 'la goutte ne part pas')
  })
})
