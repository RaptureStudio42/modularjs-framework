// Les fichiers d'effets dans un build de développement : le fichier part EN ENTIER, aucune section retirée, aucun style de carte de *hologram
// trié, aucun écouteur ni aucune règle ôtés. Le panneau « Effets » du mode développement allume n'importe quel réglage d'un effet posé, que la
// page l'écrive ou non : ce que la page n'écrit pas doit donc déjà être dans le fichier. En production, le tri est celui des pages, à l'octet
// (la grammaire et les signaux : bundler-sections-effets.test.ts ; les builds triés : bundler-sections-effets-build.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as acorn from 'acorn'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { selectFxSections } from '../src/bundler/fx-sections.js'
import { stripMsgFallbacks } from '../src/bundler/minify.js'
import { hologramClient, HOLOGRAM_FILE } from '../src/bundler/hologram-styles.js'
import { mjsTmp } from './helpers/tmp.js'

const compte = (texte: string, motif: string) => texte.split(motif).length - 1
const lire   = (fichier: string) => readFileSync(new URL('../src/runtime/' + fichier, import.meta.url), 'utf-8')
const client = (fichier: string) => fichier === HOLOGRAM_FILE ? hologramClient : undefined

// les cinq fichiers qui portent des sections : le fichier, et une page qui n'écrit presque rien de l'effet (aucune section demandée)
const PAGES: Array<[string, string, string]> = [
  ['*hologram', 'mjs_fx_hologram.ts',   '<div class="a" *hologram(rainbow)>x</div>'],
  ['*pointer',  'mjs_fx_pointer.ts',    '<div class="a" *pointer(lens)>x</div>'],
  ['*sprite',   'mjs_fx_sprite.ts',     '<div class="a" *sprite(\'/m.png\', frames: 6)></div>'],
  ['*liquid',   'mjs_fx_liquid.ts',     '<img class="a" src="a.png" *liquid>'],
  ['*fade',     'mjs_fx_transition.ts', '<div class="a" *fade>x</div>']
]

// le fichier entier, marques ôtées : ce que « tout demandé » rend (la demande explicite `runtime: ['fx_nom']` en rend autant)
const entier = (fichier: string) => selectFxSections(fichier, lire(fichier), new Set(), true, client(fichier))
// le fichier trié pour la page : ce que la production en garde (elle retire aussi le texte français de secours des messages)
const trie = async (fichier: string, page: string) => stripMsgFallbacks(selectFxSections(fichier, lire(fichier), scanCompiledFeatures((await transpile(page, { moduleName: 'c' })).output), false, client(fichier)))
// une ligne de marque (`// @@ étiquette`, `// @@`, ou l'étiquette en fin de ligne) : ne sort jamais
const MARQUES = [/^\s*\/\/ @@(?: [A-Za-z0-9 ._=,*-]+)?\s*$/m, /\S\s+\/\/ @@ [A-Za-z0-9 ._=,*-]+$/m]

// ce que chaque section apporte : un morceau qui ne se lit que dans cette section
const POINTEUR_SOFT = ["_mjs_fxRegister('--mjs-fx-pointer-e'", 'var soften = function', "if (k === 'soft') soften(v)", "'mjs-fx-pointer-soft'", '@supports (-moz-orient']
const SPRITE        = ['function _mjsFxSpritePoses(', 's.rows !== void 0', "'spriteRow'", "'spriteFps'", 's.animate === false', 'mjs-fx-sprite-hold', "new CustomEvent('mjs:sprite-end'", "addEventListener('animationiteration'"]
const TRANSITIONS   = ['function _mjsFxHover(', 'mjs-fx-hover="rest"', 'function _mjsFxScrub(', 'function _mjsFxReread(', 'function _mjsFxFinish(', 'hoverOfAlone', "case 'pixelate'", 'o.order = s.order', "o.origin = 'pointer'"]
const LIQUIDE       = ['uNoise', 'mjs-fx-layer="liquid"', 'if (tiles) return pixels(el, s)']
const CARTE         = ['_mjsFxHoloCard', '_mjsFxHoloSpring', '_mjsFxHoloSheet', 'mjs-fx-hologram-card']
// les styles de carte d'un texte : les noms de ses appels `style('a b c', …)`
const stylesDe = (texte: string) => [...new Set([...texte.matchAll(/(?<![\w$.])style\(['"]([a-z -]+)['"]/g)].flatMap((m) => m[1].split(' ')))].sort()

describe('fichiers d\'effets — développement : le fichier part en entier ; production : le tri des pages', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  // un build RÉEL : le code reste lisible (le développement n'est pas réduit ; la production l'est ici à la demande, `minify: false`)
  async function construire(nom: string, page: string, conf: any = {}): Promise<string> {
    const root   = mjsTmp('sections-dev-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), page)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...conf } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const noms = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // les adresses des images de motif que le build écrit dans le fichier de *hologram, ramenées à la déclaration vide de la source
    return [...noms.map((f) => readFileSync(join(outDir, f), 'utf-8')), ...(conf.js === 'bundle' ? [readFileSync(join(root, 'bundle.js'), 'utf-8')] : [])].join('\n').replace(/var _MJS_FX_HOLO_IMAGES = \{[^;]*\};/g, 'var _MJS_FX_HOLO_IMAGES = {};')
  }

  describe('développement', () => {
    for (const [effet, fichier, page] of PAGES) {
      it(`${effet} écrit sans réglage : le fichier de l'effet part en entier, sans une ligne de marque`, async () => {
        const texte = await construire('entier', page)
        assert.ok(texte.includes(entier(fichier)), `${fichier} : le fichier entier n'est pas dans la sortie`)
        for (const marque of MARQUES) assert.equal(marque.test(texte), false, `${fichier} : une marque de section sort (${marque})`)
      })
    }

    it('*hologram(rainbow) : le code de tous les styles de carte et le moteur de carte, comme pour une variable', async () => {
      const texte = await construire('holo', PAGES[0][2])
      const tous  = stylesDe(entier(HOLOGRAM_FILE))
      assert.ok(tous.length >= 20, `le fichier nomme ${tous.length} styles`)
      assert.deepEqual(stylesDe(texte), tous)
      for (const m of CARTE) assert.ok(texte.includes(m), m)
      const variable = await construire('holo-variable', '<script>\n$s = \'curtain\'\n</script>\n<div class="a" *hologram(style: $s)>x</div>')
      assert.deepEqual(stylesDe(variable), tous)
    })

    it('*pointer(lens) sans soft : les cinq morceaux de la section soft', async () => {
      const texte = await construire('pointer', PAGES[1][2])
      for (const m of POINTEUR_SOFT) assert.ok(texte.includes(m), m)
    })

    it('*sprite sans écouteur de fin ni aucun réglage : toutes les sections, l\'évènement de fin et l\'écouteur d\'itération', async () => {
      const texte = await construire('sprite', PAGES[2][2])
      for (const m of SPRITE) assert.ok(texte.includes(m), m)
    })

    it('*fade seul : le survol, le défilement, la relecture du texte, `of` et les réglages neufs des transitions', async () => {
      const texte = await construire('transition', PAGES[4][2])
      for (const m of TRANSITIONS) assert.ok(texte.includes(m), m)
    })

    it('*liquid lisse : le programme WebGL des carreaux est là, le choix lisse reste le défaut', async () => {
      const texte = await construire('liquid', PAGES[3][2])
      for (const m of LIQUIDE) assert.ok(texte.includes(m), m)
      assert.ok(texte.includes('feDisplacementMap'))
    })

    it('le fichier entier reste du JavaScript valide, effet par effet', () => {
      for (const [, fichier] of PAGES) acorn.parse(entier(fichier), { ecmaVersion: 'latest' })
    })

    it('en fichier unique (`js: \'bundle\'`) : tout aussi (le fichier est réécrit, guillemets doubles : les styles et les morceaux sans guillemet)', async () => {
      const carte = await construire('bundle', PAGES[0][2], { js: 'bundle' })
      assert.deepEqual(stylesDe(carte), stylesDe(entier(HOLOGRAM_FILE)))
      for (const m of CARTE) assert.ok(carte.includes(m), m)
      const pointeur = await construire('bundle-pointer', PAGES[1][2], { js: 'bundle' })
      for (const m of ['var soften = function', 'mjs-fx-pointer-soft', '@supports (-moz-orient']) assert.ok(pointeur.includes(m), m)
    })

    it('plusieurs effets dans la même page : chaque fichier part en entier', async () => {
      const texte = await construire('plusieurs', PAGES.map((p) => p[2]).join('\n'))
      for (const [, fichier] of PAGES) assert.ok(texte.includes(entier(fichier)), fichier)
    })
  })

  describe('production (`env: \'prod\'`, code lisible) : le tri ne change pas', () => {
    for (const [effet, fichier, page] of PAGES) {
      it(`${effet} : le fichier est celui que ses pages demandent, jamais l'entier, sans marque`, async () => {
        const texte = await construire('prod', page, { env: 'prod', minify: false })
        assert.ok(texte.includes(await trie(fichier, page)), `${fichier} : le fichier trié n'est pas dans la sortie`)
        assert.equal(texte.includes(stripMsgFallbacks(entier(fichier))), false, `${fichier} : la production envoie le fichier entier`)
        for (const marque of MARQUES) assert.equal(marque.test(texte), false, `${fichier} : une marque de section sort (${marque})`)
      })
    }

    it('ce que la page ne demande pas ne part pas : la carte, `soft`, le survol, les poses, les carreaux', async () => {
      const carte = await construire('prod-holo', PAGES[0][2], { env: 'prod', minify: false })
      assert.deepEqual(stylesDe(carte), [])
      for (const m of CARTE) assert.equal(carte.includes(m), false, m)
      const pointeur = await construire('prod-pointer', PAGES[1][2], { env: 'prod', minify: false })
      for (const m of POINTEUR_SOFT) assert.equal(pointeur.includes(m), false, m)
      const sprite = await construire('prod-sprite', PAGES[2][2], { env: 'prod', minify: false })
      for (const m of SPRITE) assert.equal(compte(sprite, m), 0, m)
      const transition = await construire('prod-transition', PAGES[4][2], { env: 'prod', minify: false })
      for (const m of TRANSITIONS) assert.equal(transition.includes(m), false, m)
      const liquide = await construire('prod-liquid', PAGES[3][2], { env: 'prod', minify: false })
      assert.equal(liquide.includes('uNoise'), false)
    })

    it('un réglage écrit garde sa section en production, comme avant', async () => {
      const soft = await construire('prod-soft', '<div class="a" *pointer(lens, outside: true, soft: 40)>x</div>', { env: 'prod', minify: false })
      for (const m of POINTEUR_SOFT) assert.ok(soft.includes(m), m)
      const carte = await construire('prod-carte', '<div class="a" *hologram(night-sky)>x</div>', { env: 'prod', minify: false })
      assert.deepEqual(stylesDe(carte), ['night-sky'])
    })
  })
})
