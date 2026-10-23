// *sprite et les sections de son fichier : fps, poses, rows/row, animate, hold et l'évènement de fin de tour ne partent que si une page
// de l'appli les écrit. Trois étages : le fichier filtré sans build (chaque variante reste du JavaScript valide, avec ce qu'elle demande et
// rien de plus), le signal de la fin de tour (`@mjs:sprite-end` écrit quelque part), et des builds réels (une appli à `*sprite` seul ne porte
// aucune de ces sections, ni l'écouteur d'itération).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as acorn from 'acorn'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures, fxSignal, fxUseSignal } from '../src/bundler/features.js'
import { selectFxSections } from '../src/bundler/fx-sections.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIER = 'mjs_fx_sprite.ts'
const compte  = (texte: string, motif: string) => texte.split(motif).length - 1

// le morceau que chaque section apporte (un texte qui ne se lit que dans cette section)
const MORCEAUX: Record<string, string> = {
  poses:   'function _mjsFxSpritePoses(',
  rows:    's.rows !== void 0',
  row:     "'spriteRow'",
  fps:     "'spriteFps'",
  animate: 's.animate === false',
  hold:    'mjs-fx-sprite-hold',
  end:     "new CustomEvent('mjs:sprite-end'"
}
const ECOUTEUR = "addEventListener('animationiteration'"

// [nom, les signaux écrits, les sections qui partent]
const CAS: Array<[string, string[], string[]]> = [
  ['rien',                 [fxUseSignal('sprite'), fxSignal('sprite', 'frames', '6')], []],
  ['fps',                  [fxSignal('sprite', 'fps', '12')], ['fps']],
  ['poses',                [fxSignal('sprite', 'poses', '*')], ['poses']],
  ['rows',                 [fxSignal('sprite', 'rows', '4')], ['rows']],
  ['row seul',             [fxSignal('sprite', 'row', '2')], ['row']],
  ['animate',              [fxSignal('sprite', 'animate', 'false')], ['animate']],
  ['hold',                 [fxSignal('sprite', 'hold', 'true')], ['hold']],
  ['hold + repeat',        [fxSignal('sprite', 'hold', 'true'), fxSignal('sprite', 'repeat', '3')], ['hold']],
  ['@mjs:sprite-end',      [fxSignal('sprite', 'end', 'listened')], ['end']],
  ['une variable (fps)',   [fxSignal('sprite', 'fps', '*')], ['fps']]
]

describe('*sprite — les sections de son fichier', function () {
  this.timeout(180000)
  const src = readFileSync(new URL('../src/runtime/' + FICHIER, import.meta.url), 'utf-8')
  const filtre = (signaux: string[], forcee = false) => selectFxSections(FICHIER, src, new Set(signaux), forcee)

  it('chaque variante du fichier reste du JavaScript valide, avec ce que la page écrit et rien de plus', () => {
    for (const [nom, signaux, gardees] of CAS) {
      const texte = filtre(signaux)
      acorn.parse(texte, { ecmaVersion: 'latest' })
      for (const [section, morceau] of Object.entries(MORCEAUX)) {
        assert.equal(compte(texte, morceau) > 0, gardees.includes(section), `${nom} : ${section} ${gardees.includes(section) ? 'doit partir' : 'ne doit pas partir'}`)
      }
      assert.equal(compte(texte, ECOUTEUR) > 0, gardees.includes('end'), `${nom} : l'écouteur d'itération ne part qu'avec l'évènement de fin`)
    }
  })

  it('rows apporte aussi le modèle d\'une planche à lignes, poses celui d\'une liste ; l\'un sans l\'autre marche', () => {
    const rows = filtre([fxSignal('sprite', 'rows', '4')])
    assert.ok(rows.includes('function _mjsFxSpriteModel(') && !rows.includes('function _mjsFxSpritePoses('))
    const poses = filtre([fxSignal('sprite', 'poses', '*')])
    assert.ok(poses.includes('function _mjsFxSpriteModel(') && poses.includes('function _mjsFxSpritePoses(') && !poses.includes('s.rows !== void 0'))
    const nu = filtre([])
    assert.ok(!nu.includes('function _mjsFxSpriteModel('), 'sans poses ni rows, le calcul des poses reste celui de frames et columns')
  })

  it('tout est demandé (demande explicite, effet choisi par une variable) : toutes les sections partent', () => {
    const tout = filtre([], true)
    acorn.parse(tout, { ecmaVersion: 'latest' })
    for (const [section, morceau] of Object.entries(MORCEAUX)) assert.ok(compte(tout, morceau) > 0, section)
    assert.ok(compte(tout, ECOUTEUR) > 0)
  })

  it('le signal de la fin de tour : `@mjs:sprite-end` ou un écouteur écrit en toutes lettres, jamais une pose sans écouteur', async () => {
    const signaux = async (source: string) => scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)
    const ecoute  = fxSignal('sprite', 'end', 'listened')
    assert.ok((await signaux('<script>\n$n = 0\n</script>\n<div *sprite(\'/m.png\', frames: 4) @mjs:sprite-end={$n++}>x</div>')).has(ecoute), 'sur la balise')
    assert.ok((await signaux('<script>\n$n = 0\n</script>\n<section @mjs:sprite-end={$n++}><div *sprite(\'/m.png\', frames: 4)>x</div></section>')).has(ecoute), 'sur un parent')
    assert.ok((await signaux('<script>\nonMount ->\n  document.addEventListener(\'mjs:sprite-end\', ->)\n</script>\n<div *sprite(\'/m.png\', frames: 4)>x</div>')).has(ecoute), 'dans un script')
    assert.equal((await signaux('<div *sprite(\'/m.png\', frames: 4, repeat: 3, hold: true, fps: 12)>x</div>')).has(ecoute), false, 'hold, repeat et fps n\'ont pas besoin de l\'évènement')
    assert.equal((await signaux('<div class="mjs-sprite" *fade>x</div>')).has(ecoute), false)
  })
})

describe('*sprite — des builds réels : une appli à *sprite seul ne porte que le défaut', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  // un build RÉEL de production dont le code reste lisible (`minify: false`) : le développement envoie les fichiers d'effets en entier, le tri des sections est celui de la production ; rend tout le JavaScript émis
  async function construire(nom: string, page: string): Promise<string> {
    const root   = mjsTmp('sprite-sections-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), page)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    return readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  }
  const balise = (reglages: string, extra = '') => `<script>\n$n = 0\n</script>\n<div class="a" *sprite('/m.png', ${reglages})${extra}></div>`

  it('`*sprite(\'/m.png\', frames: 6)` : ni cadence, ni poses, ni lignes, ni arrêt, ni dernière pose gardée, ni évènement, ni écouteur d\'itération', async () => {
    const texte = await construire('defaut', balise('frames: 6'))
    assert.ok(texte.includes('_mjs_fxDefs.sprite'), 'l\'effet est là')
    for (const [section, morceau] of Object.entries(MORCEAUX)) assert.equal(compte(texte, morceau), 0, section)
    assert.equal(compte(texte, ECOUTEUR) + compte(texte, 'animationiteration'), 0)
    assert.ok(texte.includes("addEventListener('animationend'"), 'la fin du dernier tour reste écoutée (will-change retiré)')
  })

  it('chaque réglage écrit apporte sa section, et seulement elle', async () => {
    const ecrits: Array<[string, string, string, string[]]> = [
      ['fps',     "frames: 6, fps: 12",              '',                                     ['fps']],
      ['poses',   "poses: [1, 2, 1, 0]",             '',                                     ['poses']],
      ['rows',    "columns: 3, rows: 4, row: 1",     '',                                     ['rows', 'row']],
      ['animate', "frames: 6, animate: false",       '',                                     ['animate']],
      ['hold',    "frames: 6, repeat: 2, hold: true", '',                                    ['hold']],
      ['fin',     "frames: 6, repeat: 2",            ' @mjs:sprite-end={$n++}',              ['end']]
    ]
    for (const [nom, reglages, extra, gardees] of ecrits) {
      const texte = await construire(nom, balise(reglages, extra))
      for (const [section, morceau] of Object.entries(MORCEAUX)) {
        if (section === 'row' && gardees.includes('rows')) continue
        assert.equal(compte(texte, morceau) > 0, gardees.includes(section), `${nom} : ${section}`)
      }
      assert.equal(compte(texte, ECOUTEUR) > 0, gardees.includes('end'), `${nom} : l'écouteur d'itération`)
    }
  })

  it('une variable pour un réglage et un effet choisi par une variable : la section part, jamais un réglage perdu', async () => {
    const variable = await construire('variable', `<script>\n$f = 12\n</script>\n<div class="a" *sprite('/m.png', frames: 6, fps: $f)></div>`)
    assert.ok(compte(variable, MORCEAUX.fps) > 0)
    const nomme = await construire('nomme', `<script>\n$e = 'sprite'\n</script>\n<div class="a" *delta(fx: $e)></div>`)
    for (const [section, morceau] of Object.entries(MORCEAUX)) assert.ok(compte(nomme, morceau) > 0, section)
  })
})
