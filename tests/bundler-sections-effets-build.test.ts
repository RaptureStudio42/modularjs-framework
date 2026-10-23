// Les fichiers des transitions et de *liquid dans un build réel : le survol, le défilement, les réglages et les transitions neufs ne
// partent que si une page les écrit ; une variable, un effet choisi par une variable, une demande explicite ou un fichier d'effets du
// projet : ce qu'ils écrivent part, tout part quand le build ne sait pas lire. Ce que fait un effet sans rien écrire n'est dans aucune
// section. (La grammaire des étiquettes et les signaux sont dans bundler-sections-effets.test.ts.)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const compte = (texte: string, motif: string) => texte.split(motif).length - 1

describe('sections d\'un fichier d\'effet — les fichiers des transitions et de *liquid dans un build', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  // un build RÉEL de production dont le code reste lisible (`minify: false`) : le développement envoie les fichiers d'effets en entier, le tri des sections est celui de la production (les noms des fonctions aussi) ; rend tout le JavaScript émis
  async function construire(nom: string, fichiers: Record<string, string>, conf: any = {}): Promise<string> {
    const root   = mjsTmp('sections-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', minify: false, ...conf } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    return readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  }
  const page = (balise: string) => ({ 'p.mjs': balise })

  // ce que chaque section ajoute au code : un morceau qui lui est propre, ou le nombre de fois qu'un morceau partagé se lit
  const SURVOL     = 'function _mjsFxHover('
  const FEUILLE    = 'mjs-fx-hover="rest"'
  const DEFILEMENT = 'function _mjsFxScrub('
  const RELIRE     = 'function _mjsFxReread('
  const TERMINER   = 'function _mjsFxFinish('
  const DE         = 'hoverOfAlone'
  const PIXEL      = "case 'pixelate'"
  const LISTE      = "'pixelate'"
  const ORDRE      = 'o.order = s.order'
  const POINTEUR   = "o.origin = 'pointer'"
  // lus aussi par une autre transition : la ligne d'*iris, de *fly, de *blocks s'ajoute à celle de *scale, *ink, *shatter
  const ROTATION   = 'o.rotate = s.rotate'
  const DEPART     = 'o.start = s.start'
  const ANGLE      = 'o.angle = s.angle'
  const GRAINE     = 'o.seed = s.seed'
  const PROPRES    = [SURVOL, FEUILLE, DEFILEMENT, RELIRE, TERMINER, DE, PIXEL, ORDRE, POINTEUR]
  const PARTAGES   = [ROTATION, DEPART, ANGLE, GRAINE, LISTE]

  // [nom, la page, ce qui part, combien de fois de plus se lisent les morceaux partagés]
  const CAS: Array<[string, string, string[], Record<string, number>]> = [
    ['défaut',        '<div class="a" *fade>x</div><div class="b" *iris>y</div><div class="c" *blocks>z</div><div class="d" *fly>w</div>', [], {}],
    ['survol',        '<div class="a" *fade(on: hover)>x</div>', [SURVOL, FEUILLE], {}],
    ['défilement',    '<div class="a" *fade(on: scroll)>x</div>', [DEFILEMENT], {}],
    ['relire',        '<div class="a" *typewriter>texte</div>', [RELIRE], {}],
    ['relire+survol', '<div class="a" *typewriter(on: hover)>texte</div>', [SURVOL, FEUILLE, RELIRE, TERMINER], {}],
    ['de seul',       '<div class="a" *fade(of: \'.c\')>x</div>', [DE], {}],
    ['pixelate',      '<div class="a" *pixelate>x</div>', [], { [LISTE]: 1 }],
    ['pixelate.size', '<div class="a" *pixelate(size: 80)>x</div>', [PIXEL], { [LISTE]: 2 }],
    ['fly.rotate',    '<div class="a" *fly(rotate: 20)>x</div>', [], { [ROTATION]: 1 }],
    ['iris.start',    '<div class="a" *iris(start: .3)>x</div>', [], { [DEPART]: 1 }],
    ['iris.angle',    '<div class="a" *iris(angle: 30)>x</div>', [], { [ANGLE]: 1 }],
    ['iris.pointeur', '<div class="a" *iris(origin: pointer)>x</div>', [POINTEUR], {}],
    ['blocks.order',  '<div class="a" *blocks(order: random)>x</div>', [ORDRE], {}],
    ['blocks.seed',   '<div class="a" *blocks(seed: 5)>x</div>', [], { [GRAINE]: 1 }],
    ['cycle de vie',  '<script>\n$v = true\n</script>\n{if $v}<p class="a" @in=*fly(rotate: 20)>x</p>{end}', [], { [ROTATION]: 1 }]
  ]

  it('chaque section ne part que si une page écrit ce qui la demande : le code propre, et les lignes partagées en plus', async () => {
    const ref = await construire('ref', page('<div class="a" *fade>x</div>'))
    const base = Object.fromEntries(PARTAGES.map((m) => [m, compte(ref, m)]))
    assert.ok(PARTAGES.filter((m) => m !== LISTE).every((m) => base[m] >= 1), 'chaque ligne partagée est au moins celle d\'une transition du défaut : ' + JSON.stringify(base))
    for (const m of PROPRES) assert.equal(compte(ref, m), 0, m + ' ne part pas avec *fade')
    for (const [nom, balise, propres, partages] of CAS) {
      const texte = await construire('cas', page(balise))
      for (const m of PROPRES) assert.equal(compte(texte, m) > 0, propres.includes(m), `${nom} : ${m} ${propres.includes(m) ? 'doit partir' : 'ne doit pas partir'}`)
      for (const m of PARTAGES) assert.equal(compte(texte, m), base[m] + (partages[m] ?? 0), `${nom} : ${m}`)
    }
  })

  it('le défaut d\'une transition marche sans section : *fade, *iris, *blocks et *fly gardent leur traduction de réglages', async () => {
    const texte = await construire('defaut', page(CAS[0][1]))
    for (const reste of ['function _mjsFxAppear(', 'function _mjsFxHold(', 'case \'iris\':', 'case \'blocks\':', 'case \'fly\':']) assert.ok(texte.includes(reste), reste)
    for (const m of PROPRES) assert.equal(texte.includes(m), false, m)
  })

  it('un réglage tenu par une variable : toutes ses valeurs, donc le survol et le défilement', async () => {
    const texte = await construire('variable', { 'p.mjs': '<script>\n$o = \'view\'\n</script>\n<div class="a" *fade(on: $o)>x</div>' })
    assert.ok(texte.includes(SURVOL) && texte.includes(DEFILEMENT))
    assert.equal(texte.includes(PIXEL), false, 'un autre effet n\'est pas écrit pour autant')
    const autre = await construire('variable-duree', { 'p.mjs': '<script>\n$d = \'1s\'\n</script>\n<div class="a" *fade(duration: $d)>x</div>' })
    assert.equal(autre.includes(SURVOL) || autre.includes(DEFILEMENT), false, 'une durée en variable ne fait pas lire `on`')
  })

  it('un effet choisi par une variable, ou le fichier demandé au cœur (`runtime`) : tout part', async () => {
    const choisi = await construire('choisi', { 'p.mjs': '<div class="a" *fade>x</div>', 'q.mjs': '<script>\n$fx = \'none\'\n</script>\n<span *delta(fx: $fx)>x</span>' })
    for (const m of PROPRES) assert.ok(choisi.includes(m), m)
    const force = await construire('force', page('<div class="a" *fade>x</div>'), { runtime: ['fx_transition'] })
    for (const m of PROPRES) assert.ok(force.includes(m), m)
  })

  it('un effet réglé une fois dans un fichier d\'effets du projet : ce qu\'il écrit part ; deux pages : la réunion de leurs réglages', async () => {
    const projet = await construire('projet', { 'marque.effects.mjs': '<effects>\n  *entree = *fade(on: hover)\n</effects>', 'p.mjs': '<div class="a" *entree>x</div>' })
    assert.ok(projet.includes(SURVOL) && !projet.includes(DEFILEMENT))
    const deux = await construire('deux', { 'a.mjs': '<div class="a" *fade(on: hover)>x</div>', 'b.mjs': '<div class="b" *iris(on: scroll)>y</div>' })
    assert.ok(deux.includes(SURVOL) && deux.includes(DEFILEMENT))
  })

  it('*liquid : la déformation par carreaux (cells, radius, ghost) ne part que si une page l\'écrit', async () => {
    const COUCHE = 'mjs-fx-layer="liquid"'
    const PROGRAMME = 'uNoise'
    for (const balise of ['<img class="a" src="a.png" *liquid>', '<img class="a" src="a.png" *liquid(strength: 60, on: view)>']) {
      const texte = await construire('liquide-lisse', page(balise))
      assert.equal(texte.includes(PROGRAMME) || texte.includes(COUCHE), false, balise)
      assert.ok(texte.includes('feDisplacementMap'), 'la déformation lisse reste : ' + balise)
    }
    for (const reglage of ['cells: 12', 'radius: 200', 'ghost: #f00', 'cells: $c']) {
      const texte = await construire('liquide-carreaux', page(`<script>\n$c = 8\n</script>\n<img class="a" src="a.png" *liquid(${reglage})>`))
      assert.ok(texte.includes(PROGRAMME) && texte.includes(COUCHE) && texte.includes('feDisplacementMap'), reglage)
      assert.ok(texte.includes('if (tiles) return pixels(el, s)') && texte.includes('why(el, s)') && texte.includes('mjs-fx-liquid-view'), reglage + ' : le choix des carreaux, le repli expliqué et les règles de la toile')
    }
  })

  it('*pointer : chaque ligne de la section `soft` (variable du bord, définition, suivi sur place, règles) part avec soft et pas sans', async () => {
    const LIGNES = ["_mjs_fxRegister('--mjs-fx-pointer-e'", 'var soften = function', "if (k === 'soft') soften(v)", "'mjs-fx-pointer-soft'", '@supports (-moz-orient']
    const sans = await construire('pointeur-sans-soft', page('<div class="a" *pointer(lens, outside: true)>x</div>'))
    for (const l of LIGNES) assert.equal(sans.includes(l), false, 'sans soft : ' + l)
    for (const [nom, balise] of [['fixe', '*pointer(lens, outside: true, soft: 40)'], ['variable', '*pointer(lens, outside: true, soft: $s)']]) {
      const avec = await construire('pointeur-soft-' + nom, page(`<script>\n$s = 0\n</script>\n<div class="a" ${balise}>x</div>`))
      for (const l of LIGNES) assert.ok(avec.includes(l), nom + ' : ' + l)
    }
  })

  it('en production (code réduit) : la même règle, et le fichier du pont est plus léger sans le survol ni le défilement', async () => {
    const poids = async (nom: string, balise: string) => (await construire(nom, page(balise), { minify: true })).length
    const defaut   = await poids('prod-defaut', '<div class="a" *fade>x</div>')
    const survol   = await poids('prod-survol', '<div class="a" *fade(on: hover)>x</div>')
    const toutes   = await poids('prod-variable', '<script>\n$o = \'view\'\n</script>\n<div class="a" *fade(on: $o)>x</div>')
    assert.ok(survol > defaut + 2000, `${survol} octets avec le survol, ${defaut} sans`)
    assert.ok(toutes > survol, `${toutes} octets avec une variable, ${survol} avec le survol seul`)
    const texte = await construire('prod-marque', page('<div class="a" *fade>x</div>'), { minify: true })
    assert.equal(texte.includes('mjs-fx-hover'), false, 'la feuille du survol ne part pas')
    assert.equal(texte.includes('@@'), false, 'aucune marque ne sort')
  })
})
