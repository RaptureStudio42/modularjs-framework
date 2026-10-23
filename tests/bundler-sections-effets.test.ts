// Les sections marquées d'un fichier d'effet (src/bundler/fx-sections.ts) : un fichier d'effet ne garde que ce que les pages de l'appli
// écrivent. Deux étages ici : la grammaire des étiquettes (sur des textes courts) et les signaux que les poses compilées écrivent
// (features.ts : un signal par réglage écrit, `<effet>_<réglage>:<valeur>`, et `use:<effet>`), puis les vrais fichiers des transitions
// et de *liquid filtrés sans build (chaque variante doit rester du JavaScript valide). Les fichiers dans un build réel sont dans
// bundler-sections-effets-build.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as acorn from 'acorn'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures, FX_NAMED, fxSignal, fxUseSignal } from '../src/bundler/features.js'
import { selectFxSections, fxEffectsOf } from '../src/bundler/fx-sections.js'
import { setMessagesLang } from '../src/messages/index.js'

const TRANSITION = 'mjs_fx_transition.ts'

describe('sections d\'un fichier d\'effet — la grammaire des étiquettes', () => {
  const source = (...sections: string[]) => ['var base = 1', ...sections, 'var fin = 1'].join('\n') + '\n'
  const gardee = (signaux: string[], src: string, fichier = TRANSITION, forcee = false) => selectFxSections(fichier, src, new Set(signaux), forcee).includes('var dedans')

  it('un fichier sans marque passe tel quel', () => {
    assert.equal(selectFxSections(TRANSITION, 'var a = 1\n', new Set(), false), 'var a = 1\n')
  })

  it('les fichiers portent les effets qu\'on attend : une transition pour le pont, l\'effet lui-même sinon', () => {
    assert.ok(fxEffectsOf(TRANSITION).includes('fade') && fxEffectsOf(TRANSITION).includes('pixelate') && !fxEffectsOf(TRANSITION).includes('liquid'))
    assert.deepEqual(fxEffectsOf('mjs_fx_liquid.ts'), ['liquid'])
    assert.deepEqual(fxEffectsOf('mjs_fx_hologram.ts'), ['hologram'])
  })

  it('`réglage=valeur` : gardée pour cette valeur, pour une valeur illisible, jamais pour une autre valeur ni pour le réglage d\'un effet que le fichier ne porte pas', () => {
    const src = source('// @@ on=hover', 'var dedans = 1', '// @@')
    assert.equal(gardee([], src), false)
    assert.equal(gardee([fxSignal('fade', 'on', 'hover')], src), true)
    assert.equal(gardee([fxSignal('iris', 'on', 'hover')], src), true, 'sur n\'importe quelle transition du pont')
    assert.equal(gardee([fxSignal('fade', 'on', 'scroll')], src), false)
    assert.equal(gardee([fxSignal('fade', 'on', '*')], src), true, 'valeur tenue par une variable')
    assert.equal(gardee([fxSignal('liquid', 'on', 'hover')], src), false, '*liquid n\'est pas une transition')
  })

  it('`réglage` : écrit avec n\'importe quelle valeur ; `a,b` : l\'une des deux ; `réglage=*` : une valeur que le fichier nomme', () => {
    assert.equal(gardee([], source('// @@ range', 'var dedans = 1', '// @@')), false)
    assert.equal(gardee([fxSignal('fade', 'range', '0 100px')], source('// @@ range', 'var dedans = 1', '// @@')), true)
    const deux = source('// @@ on=hover,scroll', 'var dedans = 1', '// @@')
    assert.equal(gardee([fxSignal('fly', 'on', 'scroll')], deux), true)
    assert.equal(gardee([fxSignal('fly', 'on', 'load')], deux), false)
    // `style=*` : un style que le fichier nomme ailleurs (a ou b), pas un style qu'il ne nomme nulle part
    const connu = source('// @@ style=a,b', 'var autre = 1', '// @@', '// @@ style=*', 'var dedans = 1', '// @@')
    assert.equal(gardee([fxSignal('hologram', 'style', 'a')], connu, 'mjs_fx_hologram.ts'), true)
    assert.equal(gardee([fxSignal('hologram', 'style', 'gold')], connu, 'mjs_fx_hologram.ts'), false)
    assert.equal(gardee([fxSignal('hologram', 'style', '*')], connu, 'mjs_fx_hologram.ts'), true)
  })

  it('`effet.réglage` : cet effet seulement ; `*effet` : l\'effet écrit, avec ou sans réglage', () => {
    const iris = source('// @@ iris.start', 'var dedans = 1', '// @@')
    assert.equal(gardee([fxSignal('iris', 'start', '0.5')], iris), true)
    assert.equal(gardee([fxSignal('scale', 'start', '0.5')], iris), false)
    const pixel = source('// @@ *pixelate', 'var dedans = 1', '// @@')
    assert.equal(gardee([fxUseSignal('pixelate')], pixel), true)
    assert.equal(gardee([fxUseSignal('fade'), fxSignal('fade', 'on', 'hover')], pixel), false)
  })

  it('une ligne à marque de fin, des jetons en alternative, des sections emboîtées', () => {
    const fin = selectFxSections(TRANSITION, 'var a = 1\nvar dedans = 2 // @@ on=scroll\nvar b = 3\n', new Set([fxSignal('fade', 'on', 'scroll')]), false)
    assert.equal(fin, 'var a = 1\nvar dedans = 2\nvar b = 3\n')
    assert.equal(selectFxSections(TRANSITION, 'var a = 1\nvar dedans = 2 // @@ on=scroll\n', new Set(), false), 'var a = 1\n')
    const alt = source('// @@ on=scroll *pixelate', 'var dedans = 1', '// @@')
    assert.equal(gardee([fxUseSignal('pixelate')], alt), true)
    assert.equal(gardee([fxSignal('fade', 'on', 'scroll')], alt), true)
    assert.equal(gardee([fxUseSignal('fade')], alt), false)
    const emboite = source('// @@ on=hover', 'var dehors = 1', '// @@ *typewriter', 'var dedans = 1', '// @@', '// @@')
    assert.equal(gardee([fxUseSignal('typewriter')], emboite), false, 'la section de dehors n\'est pas demandée')
    assert.equal(gardee([fxSignal('fade', 'on', 'hover')], emboite), false, 'celle de dedans non plus')
    assert.equal(gardee([fxSignal('typewriter', 'on', 'hover'), fxUseSignal('typewriter')], emboite), true)
  })

  it('tout est gardé quand le projet demande le fichier ou qu\'une variable choisit l\'effet', () => {
    const src = source('// @@ on=hover', 'var dedans = 1', '// @@')
    assert.equal(gardee([], src, TRANSITION, true), true)
    assert.equal(gardee([FX_NAMED], src), true)
  })

  it('une marque mal fermée ou une étiquette illisible est une erreur de build, dans les deux langues', () => {
    const cas: Array<[string, RegExp, RegExp]> = [
      ['var a = 1\n// @@\n', /sans avoir été ouverte/, /closed without having been opened/],
      ['// @@ on=hover\nvar a = 1\n', /pas fermée/, /is not closed/],
      ['// @@ on=\nvar a = 1\n// @@\n', /ne se lit pas/, /cannot be read/],
      ['// @@ =hover\nvar a = 1\n// @@\n', /ne se lit pas/, /cannot be read/],
      ['// @@ Iris.start\nvar a = 1\n// @@\n', /ne se lit pas/, /cannot be read/],
      ['// @@ *\nvar a = 1\n// @@\n', /ne se lit pas/, /cannot be read/]
    ]
    try {
      for (const [src, enFrancais, enAnglais] of cas) {
        const lance = () => selectFxSections(TRANSITION, src, new Set(), false)
        setMessagesLang('fr')
        assert.throws(lance, enFrancais)
        assert.throws(lance, (e: Error) => /^\[bundler\] mjs_fx_transition\.ts/.test(e.message))
        setMessagesLang('en')
        assert.throws(lance, enAnglais)
        assert.throws(lance, (e: Error) => !enFrancais.test(e.message), 'plus un mot de français en anglais')
      }
    }
    finally {
      setMessagesLang('fr')
    }
  })
})

describe('sections d\'un fichier d\'effet — les signaux des poses compilées', function () {
  this.timeout(60000)
  const signaux = async (source: string) => scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)
  const de = (used: Set<string>, effet: string) => [...used].filter((s) => s.startsWith(effet + '_')).sort()

  it('chaque réglage écrit : son signal et sa valeur ; l\'effet écrit : use:<effet>', async () => {
    const used = await signaux('<div *fade(on: hover, duration: 600ms, once: false)>x</div>')
    assert.deepEqual(de(used, 'fade'), ['fade_duration:600ms', 'fade_on:hover', 'fade_once:false'])
    assert.ok(used.has(fxUseSignal('fade')))
  })

  it('un effet sans réglage écrit : seulement use:<effet> (rien n\'est demandé de plus que son défaut)', async () => {
    const used = await signaux('<div *fade>x</div>')
    assert.deepEqual(de(used, 'fade'), [])
    assert.ok(used.has(fxUseSignal('fade')))
  })

  it('un réglage tenu par une variable : toutes ses valeurs ; les autres réglages gardent leur valeur', async () => {
    const used = await signaux('<script>\n$o = \'hover\'\n</script>\n<div *fade(on: $o, duration: 600ms)>x</div>')
    assert.deepEqual(de(used, 'fade'), ['fade_duration:600ms', 'fade_on:*'])
  })

  it('une transition sur le cycle de vie, un nombre négatif, un effet donné en réglage', async () => {
    const vie = await signaux('<script>\n$v = true\n</script>\n{if $v}<p @in=*fly(up, rotate: -30)>x</p>{end}')
    assert.deepEqual(de(vie, 'fly'), ['fly_direction:up', 'fly_rotate:-30'])
    const imbrique = await signaux('<div *delta(fx: *fade(on: hover))>x</div>')
    assert.ok(imbrique.has(fxSignal('fade', 'on', 'hover')))
  })

  it('un nom d\'effet qui n\'est qu\'un réglage ou une classe ne fait pas lire l\'effet', async () => {
    const used = await signaux('<p class="fade">a</p><div *fly(blur: 3)>x</div>')
    assert.deepEqual(de(used, 'fade'), [])
    assert.deepEqual(de(used, 'blur'), [])
    assert.ok(!used.has(fxUseSignal('fade')) && !used.has(fxUseSignal('blur')))
  })

  it('une mention de l\'effet qui n\'est pas une pose reconnue : tous ses réglages (jamais une section manquante)', async () => {
    const used = await signaux('<script>\n$nom = "fade"\n</script>\n<div *iris>x</div><p>{$nom}</p>')
    assert.ok(used.has(fxSignal('fade', 'on', '*')) && used.has(fxSignal('fade', 'duration', '*')))
    assert.deepEqual(de(used, 'iris'), [])
  })
})

describe('sections d\'un fichier d\'effet — les vrais fichiers des transitions et de *liquid, filtrés sans build', () => {
  const lire = (f: string) => readFileSync(new URL('../src/runtime/' + f, import.meta.url), 'utf-8')
  const transition = lire(TRANSITION)
  const liquide    = lire('mjs_fx_liquid.ts')
  const filtre     = (fichier: string, src: string, signaux: string[], forcee = false) => selectFxSections(fichier, src, new Set(signaux), forcee)
  const compte     = (texte: string, motif: string) => texte.split(motif).length - 1
  const ecrit      = (effet: string, reglage: string, valeur: string) => fxSignal(effet, reglage, valeur)

  // les morceaux propres à une section, et ceux qu'une autre transition lit aussi (comptés : la ligne d'*iris s'ajoute à celle de *scale)
  const PROPRES  = ['function _mjsFxHover(', 'mjs-fx-hover="rest"', 'function _mjsFxScrub(', 'function _mjsFxReread(', 'function _mjsFxFinish(', 'hoverOfAlone', "case 'pixelate'", 'o.order = s.order', "o.origin = 'pointer'"]
  const PARTAGES = ['o.rotate = s.rotate', 'o.start = s.start', 'o.angle = s.angle', 'o.seed = s.seed', "'pixelate'"]
  const CAS: Array<[string, string[], string[], Record<string, number>]> = [
    ['fade seul',     [fxUseSignal('fade')], [], {}],
    ['survol',        [ecrit('fade', 'on', 'hover')], [PROPRES[0], PROPRES[1]], {}],
    ['défilement',    [ecrit('fade', 'on', 'scroll')], [PROPRES[2]], {}],
    ['relire',        [fxUseSignal('typewriter')], [PROPRES[3]], {}],
    ['relire+survol', [fxUseSignal('typewriter'), ecrit('typewriter', 'on', 'hover')], [PROPRES[0], PROPRES[1], PROPRES[3], PROPRES[4]], {}],
    ['of',            [ecrit('fade', 'of', '.c')], [PROPRES[5]], {}],
    ['pixelate',      [fxUseSignal('pixelate')], [], { "'pixelate'": 1 }],
    ['pixelate.size', [fxUseSignal('pixelate'), ecrit('pixelate', 'size', '80')], [PROPRES[6]], { "'pixelate'": 2 }],
    ['fly.rotate',    [ecrit('fly', 'rotate', '20')], [], { 'o.rotate = s.rotate': 1 }],
    ['iris.start',    [ecrit('iris', 'start', '0.3')], [], { 'o.start = s.start': 1 }],
    ['iris.angle',    [ecrit('iris', 'angle', '30')], [], { 'o.angle = s.angle': 1 }],
    ['iris.pointeur', [ecrit('iris', 'origin', 'pointer')], [PROPRES[8]], {}],
    ['blocks.order',  [ecrit('blocks', 'order', 'random')], [PROPRES[7]], {}],
    ['blocks.seed',   [ecrit('blocks', 'seed', '5')], [], { 'o.seed = s.seed': 1 }],
    ['variable',      [ecrit('fade', 'on', '*')], [PROPRES[0], PROPRES[1], PROPRES[2]], {}]
  ]

  it('chaque variante des transitions reste du JavaScript valide, avec ce qu\'elle demande et rien de plus', () => {
    const nu = filtre(TRANSITION, transition, [])
    acorn.parse(nu, { ecmaVersion: 'latest' })
    for (const m of PROPRES) assert.equal(compte(nu, m), 0, m + ' ne part pas sans rien écrire')
    for (const [nom, signaux, propres, partages] of CAS) {
      const texte = filtre(TRANSITION, transition, signaux)
      acorn.parse(texte, { ecmaVersion: 'latest' })
      for (const m of PROPRES) assert.equal(compte(texte, m) > 0, propres.includes(m), `${nom} : ${m}`)
      for (const m of PARTAGES) assert.equal(compte(texte, m), compte(nu, m) + (partages[m] ?? 0), `${nom} : ${m}`)
    }
    const tout = filtre(TRANSITION, transition, [], true)
    acorn.parse(tout, { ecmaVersion: 'latest' })
    for (const m of PROPRES) assert.ok(compte(tout, m) > 0, m)
  })

  it('*liquid : sans cells, radius ni ghost, la déformation lisse seule ; avec l\'un d\'eux (ou une variable), les carreaux en plus', () => {
    const lisse = filtre('mjs_fx_liquid.ts', liquide, [ecrit('liquid', 'strength', '60'), fxUseSignal('liquid')])
    acorn.parse(lisse, { ecmaVersion: 'latest' })
    assert.equal(compte(lisse, 'uNoise') + compte(lisse, 'mjs-fx-layer="liquid"') + compte(lisse, 'var pixels'), 0)
    assert.ok(lisse.includes('feDisplacementMap') && lisse.includes('return smooth(el, s)'))
    assert.equal(compte(lisse, 'why(el, s)') + compte(lisse, 'if (tiles)') + compte(lisse, 'mjs-fx-liquid-view'), 0)
    for (const reglage of ['cells', 'radius', 'ghost']) {
      const tuile = filtre('mjs_fx_liquid.ts', liquide, [ecrit('liquid', reglage, reglage === 'ghost' ? '#f00' : '*')])
      acorn.parse(tuile, { ecmaVersion: 'latest' })
      assert.ok(tuile.includes('uNoise') && tuile.includes('mjs-fx-layer="liquid"') && tuile.includes('var pixels') && tuile.includes('feDisplacementMap'), reglage)
      // les quatre sections portent la même étiquette : le choix des carreaux, son repli expliqué, les règles de la toile, le programme
      assert.ok(tuile.includes('if (tiles) return pixels(el, s)') && tuile.includes('why(el, s)') && tuile.includes('mjs-fx-liquid-view'), reglage + ' : le choix des carreaux, le repli expliqué et les règles de la toile')
    }
  })
})
