// *hologram : un seul module, mais le build n'embarque, des vingt styles de carte, que ceux écrits dans les
// pages de l'appli (`*hologram(night-sky)`, `*hologram(style: 'shiny')`, un effet de l'appli qui en règle un, `@in=*hologram(…)`,
// un effet donné en réglage) ; tous quand le style vient d'une variable (que le build ne peut pas lire), d'un effet
// choisi par une variable ou d'une demande explicite (`runtime: ['fx_hologram']`) ; aucun quand seul un style simple
// est écrit, et alors le moteur de carte ne part pas non plus. Le signal vient de la POSE compilée de l'effet, jamais
// d'un texte qui lui ressemble.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures, HOLOGRAM_STYLE_PREFIX, HOLOGRAM_STYLE_ANY } from '../src/bundler/features.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const STYLES = ['sheen', 'frame', 'curtain', 'night-sky', 'frost', 'lattice', 'opal', 'streaks', 'rays', 'rays-window', 'rays-cloud', 'rays-fade', 'rays-wide', 'haze', 'haze-deep', 'dust-dark', 'dust', 'glint', 'glint-dark', 'bloom']

const trier = (liste: string[]) => [...new Set(liste)].sort()

async function signaux(source: string): Promise<Set<string>> {
  return scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)
}

// les styles que le signal nomme ('*' : tous, le build ne sait pas lire le style)
const nommes = (used: Set<string>) => trier([...used].filter((s) => s.startsWith(HOLOGRAM_STYLE_PREFIX)).map((s) => s.slice(HOLOGRAM_STYLE_PREFIX.length)))

// un build RÉEL de production dont le code reste lisible (`minify: false`) : le développement envoie les fichiers d'effets en entier, le tri des styles est celui de la production ; rend le JavaScript émis et les styles de carte qu'il porte
async function construire(nom: string, fichiers: Record<string, string>, conf: any = {}) {
  const root   = mjsTmp('detect-hologram-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', minify: false, ...conf } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  const noms = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code = [...noms].sort((a, b) => rang(a) - rang(b)).map((f) => readFileSync(join(outDir, f), 'utf-8'))
  try { code.push(readFileSync(join(root, 'bundle.js'), 'utf-8')) }
  catch { }
  const texte  = code.join('\n')
  const styles = trier([...texte.matchAll(/(?<![\w$.])style\(['"]([a-z -]+)['"]/g)].flatMap((m) => m[1].split(' ')))
  // le fichier de l'effet seul (en construction découpée), pour le peser
  const effet = noms.filter((f) => f.startsWith('mjs_fx_hologram')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  return { texte, styles, effet, code: code.map(stripEsm).join('\n') }
}

// les styles de carte dont la feuille de l'effet porte une règle, une fois le code chargé dans une fenêtre
function feuille(code: string): { styles: string[], css: string } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  const css = window.µ._mjs_fxDefs.hologram.css
  window.close?.()
  return { styles: trier(STYLES.filter((s) => css.includes(`[mjs-fx-hologram-style="${s}"]`))), css }
}

// les motifs que la feuille d'un style lit dans le thème (`--mjs-hologram-pattern-<nom>`)
const motifsDe = (css: string) => trier([...css.matchAll(/var\(--mjs-hologram-pattern-([a-z-]+)/g)].map((m) => m[1]))

describe('signal des styles de carte de *hologram', function () {
  this.timeout(60000)

  it('un style écrit en toutes lettres : son nom', async () => {
    assert.deepEqual(nommes(await signaux('<div *hologram(night-sky)>x</div>')), ['night-sky'])
    assert.deepEqual(nommes(await signaux('<div *hologram(style: rays, zone: inset(9.85% 8% 52.85% 8%))>x</div>')), ['rays'])
    assert.deepEqual(nommes(await signaux('<div *hologram(night-sky)>x</div><div *hologram(curtain)>y</div>')), ['curtain', 'night-sky'])
  })

  it('aucun style écrit : aucun nom (le style simple par défaut ne demande rien)', async () => {
    assert.deepEqual(nommes(await signaux('<div *hologram>x</div>')), [])
    assert.deepEqual(nommes(await signaux('<div *neon>x</div>')), [])
  })

  it('un style donné par une variable : tous (le build ne sait pas le lire)', async () => {
    const used = await signaux('<script>\n$s = \'curtain\'\n</script>\n<div *hologram(style: $s)>x</div>')
    assert.ok(used.has(HOLOGRAM_STYLE_ANY))
    assert.deepEqual(nommes(used), ['*'])
  })

  it('un autre réglage tenu par une variable ne fait pas lire le style comme variable', async () => {
    const used = await signaux('<script>\n$f = 0.5\n</script>\n<div *hologram(night-sky, strength: $f)>x</div>')
    assert.deepEqual(nommes(used), ['night-sky'])
  })

  it('un effet donné en réglage (`*delta(fx: *hologram(…))`) et un effet sur le cycle de vie (`@in=*hologram(…)`) : leur style', async () => {
    assert.deepEqual(nommes(await signaux('<div *delta(fx: *hologram(rays-fade))>x</div>')), ['rays-fade'])
    assert.deepEqual(nommes(await signaux('<script>\n$v = true\n</script>\n{if $v}<p @in=*hologram(glint)>x</p>{end}')), ['glint'])
  })

  it('une mention de "hologram" qui n\'est pas une pose reconnue : tous (jamais de style manquant)', async () => {
    const used = await signaux('<script>\n$nom = "hologram"\n</script>\n<div *hologram(night-sky)>x</div><p>{$nom}</p>')
    assert.ok(used.has(HOLOGRAM_STYLE_ANY))
  })
})

describe('*hologram — les styles de carte embarqués par le build', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une carte écrite (`*hologram(night-sky)`) : ce style seulement, à l\'exécution comme dans le fichier, et rien qui dessine un motif', async () => {
    const b = await construire('carte', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' })
    assert.deepEqual(b.styles, ['night-sky'])
    for (const reste of ['toBlob', 'createObjectURL', '_mjsFxHoloDraw', 'img-src blob']) assert.equal(b.texte.includes(reste), false, reste + ' : plus aucun motif n\'est dessiné')
    const f = feuille(b.code)
    assert.deepEqual(f.styles, ['night-sky'])
    assert.deepEqual(motifsDe(f.css), ['sky-far', 'sky-mid', 'sky-near'], 'les trois plans du ciel, lus dans le thème')
  })

  it('le style simple seul (par défaut ou nommé) : aucun style de carte, pas le moteur de carte', async () => {
    const b = await construire('simple', { 'carte.mjs': '<div class="a" *hologram>x</div><div class="b" *hologram(gold)>y</div>' })
    assert.deepEqual(b.styles, [])
    for (const reste of ['_mjsFxHoloCard', '_mjsFxHoloSpring', '_mjsFxHoloSheet', 'mjs-fx-hologram-card']) assert.equal(b.texte.includes(reste), false, reste + ' ne sert à aucune carte')
    const f = feuille(b.code)
    assert.deepEqual(f.styles, [])
    assert.ok(f.css.includes('[mjs-fx-hologram-style="gold"]'), 'le style simple reste')
  })

  it('un style donné par une variable : les vingt styles', async () => {
    const b = await construire('variable', { 'carte.mjs': '<script>\n$s = \'curtain\'\n</script>\n<div class="a" *hologram(style: $s)>x</div>' })
    assert.deepEqual(b.styles, trier(STYLES))
    assert.deepEqual(feuille(b.code).styles, trier(STYLES))
  })

  it('deux cartes, dans deux composants : la réunion de leurs styles', async () => {
    const b = await construire('deux', { 'a.mjs': '<div class="a" *hologram(night-sky)>x</div>', 'b.mjs': '<div class="b" *hologram(rays)>y</div>' })
    assert.deepEqual(b.styles, ['night-sky', 'rays'])
    assert.deepEqual(feuille(b.code).styles, ['night-sky', 'rays'])
  })

  it('un style qui en partage le code avec d\'autres (`rays-window` avec rays) : le sien seulement', async () => {
    const b = await construire('groupe', { 'carte.mjs': '<div class="a" *hologram(rays-window)>x</div>' })
    assert.deepEqual(b.styles, ['rays-window'])
    const f = feuille(b.code)
    assert.deepEqual(f.styles, ['rays-window'])
    assert.deepEqual(motifsDe(f.css), ['ripples'])
  })

  it('un effet donné en réglage, un effet sur le cycle de vie, un effet de l\'appli : leur style', async () => {
    const imbrique = await construire('imbrique', { 'carte.mjs': '<div class="a" *delta(fx: *hologram(rays-fade))>x</div>' })
    assert.deepEqual(imbrique.styles, ['rays-fade'])
    const vie = await construire('vie', { 'carte.mjs': '<script>\n$v = true\n</script>\n{if $v}<p class="a" @in=*hologram(glint)>x</p>{end}' })
    assert.deepEqual(vie.styles, ['glint'])
    const appli = await construire('appli', { 'marque.effects.mjs': '<effects>\n  *brillante = *hologram(night-sky, zone: inset(9.85% 8% 52.85% 8%))\n</effects>', 'carte.mjs': '<div class="a" *brillante>x</div>' })
    assert.deepEqual(appli.styles, ['night-sky'])
  })

  it('un effet choisi par une variable (il peut nommer *hologram), ou demandé au cœur (`runtime: [\'fx_hologram\']`) : tous les styles', async () => {
    const choisi = await construire('choisi', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>', 'choix.mjs': '<script>\n$fx = \'none\'\n</script>\n<span *delta(fx: $fx)>x</span>' })
    assert.deepEqual(choisi.styles, trier(STYLES))
    const force = await construire('force', { 'carte.mjs': '<p>x</p>' }, { runtime: ['fx_hologram'] })
    assert.deepEqual(force.styles, trier(STYLES))
  })

  it('en fichier unique (`js: \'bundle\'`) : la même règle', async () => {
    const carte = await construire('unique-carte', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' }, { js: 'bundle' })
    assert.deepEqual(carte.styles, ['night-sky'])
    const simple = await construire('unique-simple', { 'carte.mjs': '<div class="a" *hologram(gold)>x</div>' }, { js: 'bundle' })
    assert.deepEqual(simple.styles, [])
  })

  it('en production (code réduit) : la même règle, le fichier de la carte est plus léger que celui des vingt', async () => {
    const carte = await construire('prod-carte', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' }, { minify: true })
    const tous  = await construire('prod-tous', { 'carte.mjs': '<script>\n$s = \'curtain\'\n</script>\n<div class="a" *hologram(style: $s)>x</div>' }, { minify: true })
    // une marque propre à un style, qui survit à la réduction : la palette de cosmos, les tailles de vmax
    assert.ok(carte.texte.includes('hsl(53,65%,60%)'), 'cosmos est là')
    assert.equal(carte.texte.includes('1100% 1100%'), false, 'vmax n\'y est pas')
    assert.equal(carte.texte.includes('rays-cloud'), false, 'le nom d\'un autre style ne reste pas dans le fichier réduit')
    assert.ok(tous.texte.includes('hsl(53,65%,60%)') && tous.texte.includes('1100% 1100%'), 'les vingt sont là')
    assert.ok(carte.effet.length > 0 && tous.effet.length > 0, 'le fichier de l\'effet')
    assert.ok(carte.effet.length < tous.effet.length * 0.7, `${carte.effet.length} octets contre ${tous.effet.length}`)
  })
})
