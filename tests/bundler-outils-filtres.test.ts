// Les outils partagés des effets suivent le CODE que la page emporte, pas le nom de l'effet écrit. En production, le fichier d'un effet est trié
// (bundler/fx-sections.ts : il ne garde que les sections que les pages demandent) et ses outils (bundler/fx-tools.ts) se lisent sur ce texte
// trié ; en développement le fichier part en entier, avec tous ses outils. Quatre effets ont des outils qui ne servent qu'à un réglage : *stagger
// (le défilement et la variable enregistrée : `on: scroll`), *goo (le défilement : `pointer`), *marquee (les parents et les racines :
// `on: scroll`) et *filter (le retard : `smooth`, dans la zone `spot`). Une garde du build refuse un cœur dont un module appelle un outil absent.

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { FX_TOOL_KEYS } from '../src/bundler/fx-tools.js'
import { FX_KEYS, FX_NAMED, scanCompiledFeatures } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const fichier = (k: string) => 'mjs_' + k + '.ts'
const outils  = (files: string[]) => FX_TOOL_KEYS.filter((k) => files.includes(fichier(k)))

// les signaux d'une pose écrite, tels que le build les lit sur le code compilé
const signaux = async (source: string) => scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)

const production    = (opts: Record<string, unknown> = {}) => new Bundler({ i18n: { default: 'fr' }, env: 'prod', ...opts } as any)
const developpement = () => new Bundler({ i18n: { default: 'fr' } })

// les outils que la page écrite embarque
const pour = async (bundler: Bundler, pose: string) => outils(bundler.resolveRuntimeFiles(await signaux(pose)).files)

const SCRIPT = (corps: string) => '<script>\n' + corps + '\n</script>\n'

// l'ordre de la table : parents, racines, variable enregistrée, défilement
const DEFILEMENT = ['fx_toolup', 'fx_toolroots', 'fx_toolregister', 'fx_toolscroll']
// *stagger et *marquee travaillent le texte de leur balise : le calque de texte vient avec eux (dans la table, il précède la reprise du décor)
const TEXTE = 'fx_tooltext'
// *filter lit le moteur WebKit et la couleur sur la balise hors de toute section : ces deux outils viennent toujours avec lui (dans la table, après la reprise du décor)
const FILTRE = ['fx_toolwebkit', 'fx_toolcolor']
// *annotate, qui se nomme, reprend son tracé après un chargement de police : la reprise des polices vient avec les effets nommés à l'exécution
const POLICES = 'fx_toolfonts'

describe('outils des effets — production : ceux que le fichier trié appelle encore', function () {
  this.timeout(60000)

  it('*stagger sans `on: scroll` : ni le défilement (avec ses parents et ses racines) ni la variable enregistrée, seulement le calque de texte', async () => {
    for (const pose of ['<p *stagger>x</p>', '<p *stagger(unit: line)>x</p>', '<p *stagger(unit: child, clip: true)>x</p>', '<p *stagger(on: hover)>x</p>', '<p *stagger(on: load, step: 20ms)>x</p>']) {
      assert.deepEqual(await pour(production(), pose), [TEXTE], pose)
    }
  })

  it('*stagger(on: scroll) : le défilement, ses parents, ses racines et la variable enregistrée ; la valeur d\'une variable les demande aussi', async () => {
    for (const pose of ['<p *stagger(on: scroll)>x</p>', '<p *stagger(unit: line, on: scroll)>x</p>', SCRIPT('$q = \'scroll\'') + '<p *stagger(on: $q)>x</p>']) {
      assert.deepEqual(await pour(production(), pose), [...DEFILEMENT, TEXTE], pose)
    }
  })

  it('*goo sans `pointer` : la garde de cadence seule (le défilement ne sert qu\'à la goutte qui revient sous la souris)', async () => {
    for (const pose of ['<div *goo><b></b></div>', '<div *goo(merge, count: 5)><b></b></div>', '<div *goo(drag: true)><b></b></div>']) {
      assert.deepEqual(await pour(production(), pose), ['fx_toolgauge', 'fx_toolkeep'], pose)
    }
  })

  it('*goo(pointer) : le défilement, ses parents et ses racines, en plus de la garde ; la valeur d\'une variable les demande aussi', async () => {
    for (const pose of ['<div *goo(pointer: 90)><b></b></div>', '<div *goo(merge, pointer: 90)><b></b></div>', SCRIPT('$p = 90') + '<div *goo(pointer: $p)><b></b></div>']) {
      assert.deepEqual(await pour(production(), pose), ['fx_toolup', 'fx_toolroots', 'fx_toolscroll', 'fx_toolgauge', 'fx_toolkeep'], pose)
    }
  })

  it('*marquee sans `on: scroll` : ni les parents ni les racines, seulement le calque de texte', async () => {
    for (const pose of ['<div *marquee><p>un</p></div>', '<div *marquee(drag: true, axis: both)><p>un</p></div>', '<div *marquee(direction: up, pause: true)><p>un</p></div>', '<div *marquee(on: hover, reverse: true)><p>un</p></div>']) {
      assert.deepEqual(await pour(production(), pose), [TEXTE], pose)
    }
  })

  it('*marquee(on: scroll) : les parents et les racines ; la valeur d\'une variable les demande aussi', async () => {
    for (const pose of ['<div *marquee(on: scroll)><p>un</p></div>', SCRIPT('$q = \'scroll\'') + '<div *marquee(on: $q)><p>un</p></div>']) {
      assert.deepEqual(await pour(production(), pose), ['fx_toolup', 'fx_toolroots', TEXTE], pose)
    }
  })

  it('*filter sans `smooth` : pas le retard ; l\'outil du <svg> reste, le chemin des styles en filtre SVG n\'est dans aucune section du fichier', async () => {
    for (const pose of ['<img alt="" *filter>', '<img alt="" *filter(sepia, amount: .5, on: hover)>', '<img alt="" *filter(spot: 280)>', '<img alt="" *filter(spot: 280, soft: 80)>', '<img alt="" *filter(smooth: .5)>', '<img alt="" *filter(style: duotone)>']) {
      assert.deepEqual(await pour(production(), pose), ['fx_toolsvg', ...FILTRE], pose)
    }
  })

  it('*filter(spot, smooth) : le retard, en plus de l\'outil du <svg> ; la valeur d\'une variable le demande aussi', async () => {
    for (const pose of ['<img alt="" *filter(spot: 280, smooth: .5)>', SCRIPT('$s = .5') + '<img alt="" *filter(spot: 280, smooth: $s)>']) {
      assert.deepEqual(await pour(production(), pose), ['fx_toolsmooth', 'fx_toolsvg', ...FILTRE], pose)
    }
  })

  it('plusieurs effets : l\'union de ce que chaque fichier trié appelle, rien de l\'un ne vient avec l\'autre', async () => {
    assert.deepEqual(await pour(production(), '<p *stagger>x</p><div *marquee(on: scroll)><p>un</p></div>'), ['fx_toolup', 'fx_toolroots', TEXTE])
    assert.deepEqual(await pour(production(), '<p *stagger(on: scroll)>x</p><div *goo><b></b></div>'), [...DEFILEMENT, 'fx_toolgauge', TEXTE, 'fx_toolkeep'])
    assert.deepEqual(await pour(production(), '<p *stagger>x</p><div *goo><b></b></div><div *marquee><p>un</p></div><img alt="" *filter>'), ['fx_toolsvg', 'fx_toolgauge', TEXTE, 'fx_toolkeep', ...FILTRE])
  })

  it('un effet dont aucune section n\'appelle d\'outil : les mêmes outils en production et en développement', async () => {
    for (const pose of ['<div *pointer(lens)>x</div>', '<div *pile>x</div>', '<div *velocity>x</div>', '<div *sprite(\'a.png\', frames: 6)>x</div>', '<div *travel(.b)>x</div><div class="b"></div>', '<div *sticky(300)>x</div>', '<img *liquid>', '<div *neon>x</div>']) {
      assert.deepEqual(await pour(production(), pose), await pour(developpement(), pose), pose)
    }
  })

  it('jamais plus d\'outils en production qu\'en développement, pour aucun des effets du catalogue (écrit sans réglage)', () => {
    for (const cle of FX_KEYS) {
      const used = new Set(['fx', cle, 'use:' + cle.slice(3)])
      const prod = outils(production().resolveRuntimeFiles(used).files)
      const dev  = outils(developpement().resolveRuntimeFiles(used).files)
      assert.deepEqual(prod.filter((k) => !dev.includes(k)), [], cle)
    }
  })

  it('un effet demandé au cœur (`runtime: [\'fx_marquee\']`) part en entier : tous ses outils, écrits ou non', () => {
    const { files } = production({ runtime: ['fx_marquee'] }).resolveRuntimeFiles(new Set(['fx', 'fx_marquee']))
    assert.deepEqual(outils(files), ['fx_toolup', 'fx_toolroots', TEXTE])
  })

  it('un effet nommé à l\'exécution (`fx: $effet`) : tous les fichiers partent en entier, donc les outils de tous les effets qui se nomment', () => {
    const { files } = production().resolveRuntimeFiles(new Set(['fx', FX_NAMED]))
    assert.deepEqual(outils(files), ['fx_toolup', 'fx_toolroots', 'fx_toolregister', 'fx_toolvisible', 'fx_toolscroll', 'fx_toolgauge', TEXTE, 'fx_toolkeep', POLICES, 'fx_toolbeat'])
  })

  it('les faits inconnus (aucun scan) : tous les outils, comme avant', () => {
    assert.deepEqual(outils(production().resolveRuntimeFiles().files), FX_TOOL_KEYS)
  })
})

describe('outils des effets — développement : le fichier part en entier, avec tous ses outils', function () {
  this.timeout(60000)

  it('chacun des quatre effets, écrit sans réglage, porte tous les outils de son fichier entier', async () => {
    assert.deepEqual(await pour(developpement(), '<p *stagger>x</p>'), [...DEFILEMENT, TEXTE])
    assert.deepEqual(await pour(developpement(), '<div *goo><b></b></div>'), ['fx_toolup', 'fx_toolroots', 'fx_toolscroll', 'fx_toolgauge', 'fx_toolkeep'])
    assert.deepEqual(await pour(developpement(), '<div *marquee><p>un</p></div>'), ['fx_toolup', 'fx_toolroots', TEXTE])
    assert.deepEqual(await pour(developpement(), '<img alt="" *filter>'), ['fx_toolsmooth', 'fx_toolsvg', ...FILTRE])
  })

  it('les réglages écrits n\'y changent rien : le panneau d\'inspection allume n\'importe quel réglage d\'un effet posé', async () => {
    assert.deepEqual(await pour(developpement(), '<p *stagger(on: scroll)>x</p>'), [...DEFILEMENT, TEXTE])
    assert.deepEqual(await pour(developpement(), '<img alt="" *filter(spot: 280, smooth: .5)>'), ['fx_toolsmooth', 'fx_toolsvg', ...FILTRE])
  })
})

describe('outils des effets — le cœur construit', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  // le cœur d'une page, non réduit : chaque module y a sa ligne `// === mjs_<clé>.ts ===`
  const coeur = async (pose: string, opts: Record<string, unknown> = {}) => {
    const out     = mjsTmp('outils-coeur')
    const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'prod', minify: false, ...opts } as any)
    const chemin  = await bundler.bundleRuntime(await signaux(pose))
    // en fichier unique le cœur reste en mémoire, sous un nom virtuel
    const texte   = chemin === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') : readFileSync(join(out, basename(chemin)), 'utf-8')
    return [...texte.matchAll(/^\/\/ === mjs_(fx_tool[a-z]+)\.ts ===$/gm)].map((m) => m[1])
  }

  it('production : le cœur n\'a que les outils que le fichier trié appelle', async () => {
    assert.deepEqual(await coeur('<p *stagger>x</p>'), [TEXTE])
    assert.deepEqual(await coeur('<p *stagger(on: scroll)>x</p>'), [...DEFILEMENT, TEXTE])
    assert.deepEqual(await coeur('<div *goo><b></b></div>'), ['fx_toolgauge', 'fx_toolkeep'])
    assert.deepEqual(await coeur('<div *goo(pointer: 90)><b></b></div>'), ['fx_toolup', 'fx_toolroots', 'fx_toolscroll', 'fx_toolgauge', 'fx_toolkeep'])
    assert.deepEqual(await coeur('<div *marquee><p>un</p></div>'), [TEXTE])
    assert.deepEqual(await coeur('<div *marquee(on: scroll)><p>un</p></div>'), ['fx_toolup', 'fx_toolroots', TEXTE])
    assert.deepEqual(await coeur('<img alt="" *filter>'), ['fx_toolsvg', ...FILTRE])
    assert.deepEqual(await coeur('<img alt="" *filter(spot: 280, smooth: .5)>'), ['fx_toolsmooth', 'fx_toolsvg', ...FILTRE])
  })

  it('production en un seul fichier (`js: \'bundle\'`) : les mêmes outils', async () => {
    assert.deepEqual(await coeur('<p *stagger>x</p>', { js: 'bundle' }), [TEXTE])
    assert.deepEqual(await coeur('<div *marquee(on: scroll)><p>un</p></div>', { js: 'bundle' }), ['fx_toolup', 'fx_toolroots', TEXTE])
  })

  it('développement : le cœur a tous les outils du fichier entier', async () => {
    assert.deepEqual(await coeur('<p *stagger>x</p>', { env: 'dev' }), [...DEFILEMENT, TEXTE])
    assert.deepEqual(await coeur('<div *goo><b></b></div>', { env: 'dev' }), ['fx_toolup', 'fx_toolroots', 'fx_toolscroll', 'fx_toolgauge', 'fx_toolkeep'])
  })
})

describe('outils des effets — la garde du build refuse un cœur dont un module appelle un outil absent', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  // une copie du dossier des modules où un fichier est remplacé : les autres y sont des liens (le build les lit, ne les écrit jamais)
  const runtimeAvec = (remplace: Record<string, (texte: string) => string>) => {
    const dir = mjsTmp('outils-runtime')
    for (const f of readdirSync(RUNTIME)) {
      if (remplace[f]) writeFileSync(join(dir, f), remplace[f](readFileSync(join(RUNTIME, f), 'utf-8')))
      else symlinkSync(join(RUNTIME, f), join(dir, f))
    }
    return dir
  }

  const construire = async (runtimeDir: string, used: ReadonlySet<string>, opts: Record<string, unknown> = {}) => {
    const out = mjsTmp('outils-garde')
    return new Bundler({ runtimeDir, outputDir: out, manifestPath: join(out, 'bundle.js'), minify: false, ...opts } as any).bundleRuntime(used)
  }

  it('un outil qui en appelle un autre sans le demander : le build est refusé et nomme l\'outil absent et le module qui l\'appelle', async () => {
    const runtimeDir = runtimeAvec({ 'mjs_fx_toolsmooth.ts': (t) => t + '\nµ._mjs_fxLagRoots = function(el) { return µ._mjs_fxRoots(el); };\n' })
    const used = await signaux('<img alt="" *filter(spot: 280, smooth: .5)>')
    await assert.rejects(construire(runtimeDir, used, { env: 'prod' }), (e: Error) => {
      assert.match(e.message, /^\[bundler\] Outil d'effet absent — build REFUSÉ/)
      assert.match(e.message, /fx_toolroots \(mjs_fx_toolsmooth\.ts\)/)
      return true
    })
  })

  it('un module de développement qui appelle un outil que la page n\'a pas demandé : refusé de même, dans les deux langues', async () => {
    const runtimeDir = runtimeAvec({ 'mjs_fx_flash.ts': (t) => t + '\nµ._mjs_fxLagRoots = function(el) { return µ._mjs_fxRoots(el); };\n' })
    try {
      setMessagesLang('fr')
      await assert.rejects(construire(runtimeDir, new Set(['fx'])), /Outil d'effet absent[^]*fx_toolroots \(mjs_fx_flash\.ts\)/)
      setMessagesLang('en')
      await assert.rejects(construire(runtimeDir, new Set(['fx'])), /Effect tool missing[^]*fx_toolroots \(mjs_fx_flash\.ts\)/)
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('la garde ne refuse pas un build sain : le moteur cite l\'outil de la garde de cadence sans l\'exiger, aucun effet lourd', async () => {
    const runtimeDir = runtimeAvec({})
    await construire(runtimeDir, await signaux('<div *neon>x</div>'), { env: 'prod' })
    await construire(runtimeDir, await signaux('<p *stagger(on: scroll)>x</p><div *goo(pointer: 90)><b></b></div>'))
  })
})

describe('outils des effets — un fichier d\'effet absent ou illisible : les outils que la table range sous cet effet', function () {
  this.timeout(60000)

  it('le build ne sait plus lire l\'effet : il garde les outils de la table (avec ce qu\'ils demandent) plutôt que ceux d\'un fichier qu\'il n\'a pas', () => {
    const dir = mjsTmp('outils-illisible')
    for (const f of readdirSync(RUNTIME)) if (f !== 'mjs_fx_stagger.ts') symlinkSync(join(RUNTIME, f), join(dir, f))
    const used = new Set(['fx', 'fx_stagger'])
    assert.deepEqual(outils(production().resolveRuntimeFiles(used).files), [TEXTE], 'le fichier lu, trié : *stagger sans `on: scroll` n\'appelle que le calque de texte')
    assert.deepEqual(outils(production({ runtimeDir: dir }).resolveRuntimeFiles(used).files), [...DEFILEMENT, TEXTE], 'le fichier absent : les outils que la table range sous *stagger, avec les parents et les racines que le défilement demande')
  })
})

describe('outils des effets — construction découpée (`js: \'split\'`) : le fichier d\'un effet écrit à part passe aussi par la garde', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  // un effet choisi par une variable : le fichier de chaque effet qui peut être nommé est écrit à part, et aucun n'est dans les modules du cœur
  const PROJET = '<script>\n$fx = \'none\'\n</script>\n<span *delta(fx: $fx)>x</span>\n'

  const construire = async (Classe: any) => {
    const root   = mjsTmp('outils-decoupe')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'carte.mjs'), PROJET)
    const bundler = new Classe({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), js: 'split', env: 'prod' })
    const stats   = await bundler.compile()
    await bundler.close()
    return { erreurs: stats.errors.map((e: any) => String(e.message)), fichiers: readdirSync(outDir) }
  }

  it('un build sain écrit le fichier de chaque effet qui peut être nommé, sans refus', async () => {
    const { erreurs, fichiers } = await construire(Bundler)
    assert.deepEqual(erreurs, [])
    for (const effet of ['marquee', 'stagger', 'crt']) assert.ok(fichiers.some((f) => f.startsWith('mjs_fx_' + effet + '-')), 'le fichier de *' + effet + ' est écrit à part')
  })

  it('la déduction des outils aveugle aux effets qui ne font que se nommer (un bogue du bundler) : le cœur n\'a que les outils des effets écrits, la garde de l\'effet écrit à part arrête le build en le nommant', async () => {
    // le cœur reçoit les outils des effets écrits dans la page (*delta : le calque de texte), jamais ceux des effets qu'une variable peut seulement nommer
    class DeductionAveugle extends (Bundler as any) { fxToolsCalledBy(cles: readonly string[], used: ReadonlySet<string>) { return super.fxToolsCalledBy(cles.filter((k) => used.has(k)), used) } }
    const { erreurs } = await construire(DeductionAveugle)
    // les erreurs suivantes ne sont que la suite du refus (le fichier de l'effet n'est jamais écrit : les entrées qui l'attendent sont retirées)
    assert.ok(erreurs.length > 0, 'aucune erreur : la garde n\'a rien refusé')
    assert.match(erreurs[0], /^\[bundler\] Outil d'effet absent — build REFUSÉ : fx_tool[a-z]+ \(mjs_fx_[a-z0-9_]+\.ts\)/)
    // le refus vient d'un effet qui n'est pas écrit dans la page (il n'est qu'à part, nommable) : la garde du cœur ne le lit pas
    assert.doesNotMatch(erreurs[0], /mjs_fx_delta\.ts/)
  })
})
