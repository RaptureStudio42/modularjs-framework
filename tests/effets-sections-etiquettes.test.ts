// Les étiquettes `// @@` des fichiers d'effet, une par une : pour chaque réglage (jeton d'étiquette), l'appli qui n'écrit QUE ce réglage est
// construite pour de vrai, et chaque section du fichier doit être dans la sortie si et seulement si ce réglage la demande. Une étiquette
// à laquelle on retire un jeton, ou qu'on remplace par celle d'une autre section, fait perdre ou ajoute du code sans qu'aucun test de
// comportement ne le voie : une page qui n'écrit que `*pixelate(steps: 4)` perdrait son code et resterait muette.
//
// La table de chaque fichier est la référence indépendante des étiquettes : des PAGES (chacune n'écrit qu'un réglage) et des TÉMOINS
// (un texte du fichier, avec les pages qui doivent l'embarquer). Trois gardes la tiennent : les jetons des étiquettes du fichier sont
// exactement ceux des pages, chaque section marquée porte au moins un témoin sur ses lignes propres, et chaque témoin est
// embarqué par ses pages et par elles seules.
//
// Ces tables ne couvrent que cinq fichiers. Tout autre module `src/runtime/mjs_fx_*.ts` qui porte une marque est DÉCOUVERT dans le dossier (le
// prochain module qu'on trie n'a rien à déclarer ici) et passe les contrôles qui ne demandent aucune table : chaque étiquette est bien formée et
// nomme un réglage que le catalogue connaît pour cet effet (une faute de nom ne fait rien d'autre que priver la section de tout demandeur, sans
// erreur de build), chaque section se ferme, le fichier filtré sans aucune demande et celui où tout est demandé sont du JavaScript valide, et
// aucune marque ne sort du filtre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as acorn from 'acorn'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures, SPRITE_END_LISTENED, fxSignal, fxUseSignal, FX_ANY } from '../src/bundler/features.js'
import { selectFxSections, fxEffectsOf, type FxClient } from '../src/bundler/fx-sections.js'
import { selectHologramStyles, hologramStylesWanted, hologramClient, HOLOGRAM_FILE } from '../src/bundler/hologram-styles.js'
import { EFFECTS } from '../src/effects/catalog.js'
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

const estMarque = (texte: string) => BLOC.test(texte) || FIN.test(texte)

// la grammaire d'un jeton d'étiquette, la même que celle du filtre : `réglage`, `réglage=a,b`, `réglage=*`, `effet.réglage[=valeur]`, `*effet`
const JETON = /^(?:\*([a-z][a-z0-9-]*)|(?:([a-z][a-z0-9-]*)\.)?([a-z][a-zA-Z0-9]*)(?:=(\*|[A-Za-z0-9.-]+(?:,[A-Za-z0-9.-]+)*))?)$/

// les « réglages » que features.ts demande au filtre sans qu'ils soient au catalogue : le signal `<effet>_<nom>:<valeur>` d'un évènement que la page écoute
const HORS_CATALOGUE = [SPRITE_END_LISTENED].map((signal) => {
  const [effet, nom] = signal.split(':')[0].split('_')
  return { effet, nom }
})

// la section du développement (l'avertissement que seul le fichier entier du développement porte) : le réglage `dev`, qu'aucun effet n'a au catalogue et qu'aucune page n'écrit.
// Le filtre de production ne la garde donc que lorsqu'il garde tout (demande explicite du fichier, effet choisi par une variable). Six fichiers l'écrivent, chacun sous la
// forme que son client lit : `dev` dans le moteur (`mjs_fx.ts`, l'avis d'une valeur ramenée ou refusée) et dans ceux de `*marquee`, de `*filter`, de `*autosize` et des transitions (`*crossfade`), `hologram.dev` dans celui de `*hologram`, où un mot seul est un style de carte. Dans un autre fichier d'effet,
// le même jeton reste une faute ; que les pages ne la demandent jamais est prouvé par un contrôle propre à chacun de ces fichiers
const JETONS_DEV: Record<string, string> = { 'mjs_fx.ts': 'dev', 'mjs_fx_marquee.ts': 'dev', 'mjs_fx_filter.ts': 'dev', 'mjs_fx_autosize.ts': 'dev', 'mjs_fx_transition.ts': 'dev', 'mjs_fx_hologram.ts': 'hologram.dev' }

// le client de sections que le build associe au fichier (table `FX_CLIENTS` de bundler/index.ts) : seul `mjs_fx_hologram.ts` a le sien
const clientDe = (fichier: string): FxClient | undefined => fichier === HOLOGRAM_FILE ? hologramClient : undefined

const DOSSIER_RUNTIME = join(import.meta.dirname, '../src/runtime')

// le moteur des effets : il ne porte aucun effet, sa seule section est celle du développement
const MOTEUR = 'mjs_fx.ts'

// tout module d'effet qui porte une marque, et le moteur, trouvés dans le dossier
const MODULES_MARQUES = readdirSync(DOSSIER_RUNTIME).filter((f) => f === MOTEUR || /^mjs_fx_.+\.ts$/.test(f)).sort().filter((f) => readFileSync(join(DOSSIER_RUNTIME, f), 'utf-8').split('\n').some(estMarque))

// les modules dont on sait qu'ils sont triés : la découverte doit les rendre, sinon elle est muette et ne contrôle plus rien — et un module qui perd toutes ses marques
// sort de la découverte sans que rien d'autre ne le dise : c'est cette liste qui le fait rougir. Elle compte les treize modules triés d'aujourd'hui ; un module trié plus tard
// n'a pas à s'y ajouter pour être contrôlé, il y entre quand on veut qu'il ne puisse plus perdre ses marques sans bruit
const MODULES_CONNUS = ['hologram', 'sprite', 'transition', 'liquid', 'pointer', 'marquee', 'stagger', 'goo', 'neon', 'parallax', 'filter', 'tilt', 'spotlight'].map((n) => 'mjs_fx_' + n + '.ts')

type Page    = { balise: string, jetons: string[] }
type Temoin  = { texte: string, pages: string[], n?: number }
type Fichier = { fichier: string, pages: Record<string, Page>, temoins: Temoin[] }

const REF = 'rien'

const TABLES: Fichier[] = [
  {
    fichier: 'mjs_fx_sprite.ts',
    pages: {
      [REF]:   { balise: "*sprite('/m.png', frames: 6)", jetons: [] },
      poses:   { balise: "*sprite('/m.png', poses: [1, 2, 1, 0])", jetons: ['poses'] },
      rows:    { balise: "*sprite('/m.png', columns: 3, rows: 4)", jetons: ['rows'] },
      row:     { balise: "*sprite('/m.png', frames: 6, row: 2)", jetons: ['row'] },
      fps:     { balise: "*sprite('/m.png', frames: 6, fps: 12)", jetons: ['fps'] },
      animate: { balise: "*sprite('/m.png', frames: 6, animate: false)", jetons: ['animate'] },
      hold:    { balise: "*sprite('/m.png', frames: 6, repeat: 2, hold: true)", jetons: ['hold'] },
      end:     { balise: "*sprite('/m.png', frames: 6) @mjs:sprite-end={$n++}", jetons: ['end'] }
    },
    temoins: [
      { texte: 'function _mjsFxSpritePoses(',                              pages: ['poses'] },
      { texte: 'function _mjsFxSpriteModel(',                              pages: ['poses', 'rows'] },
      { texte: 'poses = _mjsFxSpritePoses(s.poses);',                      pages: ['poses'] },
      { texte: 'if (s.rows !== void 0) {',                                 pages: ['rows'] },
      { texte: 'm.list.push(Math.min(poses[j], m.cap - 1));',              pages: ['poses'] },
      { texte: "m.list.join('_') + '-' + columns + '-' + grid",            pages: ['poses'] },
      { texte: 'animation-duration:var(--mjs-fx-sprite-dur',               pages: ['fps'] },
      { texte: '{top:calc(var(--mjs-fx-sprite-row,0) * -100%)}',           pages: ['rows'] },
      { texte: 'top:calc(var(--mjs-fx-sprite-row,0) * -1 * round(',        pages: ['rows'] },
      { texte: 'animation-fill-mode:forwards',                             pages: ['hold'] },
      { texte: 'm       = _mjsFxSpriteModel(s);',                          pages: ['poses', 'rows'] },
      { texte: "'spriteRow'",                                              pages: ['row'] },
      { texte: "if (s.hold) layer.setAttribute('mjs-fx-sprite-hold', '');", pages: ['hold'] },
      { texte: "st.setProperty('--mjs-fx-sprite-row', String(m.row));",  pages: ['rows'] },
      { texte: "String(Math.min(_mjsFxSpriteInt(v, 0, 0, 999), rows - 1))", pages: ['rows', 'row'] },
      { texte: 'var rate = function() {',                                  pages: ['fps'] },
      { texte: 'var lost  = false;',                                       pages: ['animate'] },
      { texte: 'var idle  = false;',                                       pages: ['animate'] },
      { texte: 'idle = s.animate === false;',                              pages: ['animate'] },
      { texte: 'if (lost || idle) {',                                      pages: ['animate'] },
      { texte: "new CustomEvent('mjs:sprite-end'",                         pages: ['end'] },
      { texte: '      signal();',                                          pages: ['end'] },
      { texte: "layer.addEventListener('animationiteration', signal",      pages: ['end'] },
      { texte: 'if (idle) pause();',                                       pages: ['animate'] },
      { texte: 'lost = true;',                                             pages: ['animate'] },
      { texte: "lost = true;\n        pause();",                           pages: ['animate'] },
      { texte: "layer.removeEventListener('animationiteration', signal",   pages: ['end'] },
      { texte: "else if (k === 'fps' || k === 'speed') {",                 pages: ['fps'] },
      { texte: "else if (k === 'row') {",                                  pages: ['rows', 'row'] },
      { texte: "else if (k === 'animate') {",                              pages: ['animate'] },
      { texte: "else if (k === 'hold') {",                                 pages: ['hold'] }
    ]
  },
  {
    fichier: 'mjs_fx_transition.ts',
    pages: {
      [REF]:              { balise: '*fade', jetons: [] },
      hover:              { balise: '*fade(on: hover)', jetons: ['on=hover'] },
      scroll:             { balise: '*fade(on: scroll)', jetons: ['on=scroll'] },
      of:                 { balise: "*fade(of: '.c')", jetons: ['of'] },
      typewriter:         { balise: '*typewriter', jetons: ['*typewriter'] },
      'typewriter-hover': { balise: '*typewriter(on: hover)', jetons: [] },
      pixelate:           { balise: '*pixelate', jetons: ['*pixelate'] },
      'pixelate.size':    { balise: '*pixelate(size: 80)', jetons: ['pixelate.size'] },
      'pixelate.steps':   { balise: '*pixelate(steps: 4)', jetons: ['pixelate.steps'] },
      'fly.rotate':       { balise: '*fly(rotate: 20)', jetons: ['fly.rotate'] },
      'iris.start':       { balise: '*iris(start: .3)', jetons: ['iris.start'] },
      'iris.angle':       { balise: '*iris(angle: 30)', jetons: ['iris.angle'] },
      'iris.pointer':     { balise: '*iris(origin: pointer)', jetons: ['iris.origin=pointer'] },
      'blocks.order':     { balise: '*blocks(order: random)', jetons: ['blocks.order'] },
      'blocks.seed':      { balise: '*blocks(seed: 5)', jetons: ['blocks.seed'] }
    },
    temoins: [
      // un texte aussi lu par d'autres transitions (rotate, start…) : ce qui compte est la ligne de plus que celle de la page de référence
      { texte: 'o.rotate = s.rotate',                  pages: ['fly.rotate'] },
      { texte: "o.origin = 'pointer'",                 pages: ['iris.pointer'] },
      { texte: 'o.start = s.start',                    pages: ['iris.start'] },
      { texte: 'o.angle = s.angle',                    pages: ['iris.angle'] },
      { texte: 'o.order = s.order',                    pages: ['blocks.order'] },
      { texte: 'o.seed = s.seed',                      pages: ['blocks.seed'] },
      { texte: "case 'pixelate':",                     pages: ['pixelate.size', 'pixelate.steps'] },
      { texte: "'pixelate',",                          pages: ['pixelate', 'pixelate.size', 'pixelate.steps'] },
      { texte: 'function _mjsFxScroller(',             pages: ['scroll'] },
      { texte: 'function _mjsFxScrub(',                pages: ['scroll'] },
      { texte: 'return _mjsFxScrub(el, pair.intro, cur);', pages: ['scroll'] },
      { texte: 'function _mjsFxHover(',                pages: ['hover', 'typewriter-hover'] },
      { texte: 'µ._mjs_fxDefs._hover = { css:',        pages: ['hover', 'typewriter-hover'] },
      { texte: 'function _mjsFxHoverUp(',              pages: ['hover', 'typewriter-hover'] },
      { texte: 'function _mjsFxHoverLeave(',           pages: ['hover', 'typewriter-hover'] },
      { texte: "if (s.on === 'hover') {",              pages: ['hover', 'typewriter-hover'] },
      { texte: 'if (s.of !== void 0) µ.warn(',         pages: ['of'] },
      { texte: 'function _mjsFxReread(',               pages: ['typewriter', 'typewriter-hover'] },
      { texte: 'function _mjsFxFinish(',               pages: ['typewriter-hover'] },
      { texte: 'else if (idle) _mjsFxReread(el, pair);', pages: ['typewriter-hover'] },
      { texte: "if (name === 'typewriter') {",         pages: ['typewriter-hover'] },
      { texte: '(held || !el._mjs_transition_state)) _mjsFxReread(el, pair);', pages: ['typewriter', 'typewriter-hover'] },
      // la section du développement (l'avertissement d'un groupe de *crossfade) : aucune page ne la demande
      { texte: 'else if (µ.instances && _mjsFxXf[g].s) {', pages: [] }
    ]
  },
  {
    fichier: 'mjs_fx_liquid.ts',
    pages: {
      [REF]:  { balise: '<img class="a" src="a.png" alt="" *liquid>', jetons: [] },
      cells:  { balise: '<img class="a" src="a.png" alt="" *liquid(cells: 12)>', jetons: ['cells'] },
      radius: { balise: '<img class="a" src="a.png" alt="" *liquid(radius: 200)>', jetons: ['radius'] },
      ghost:  { balise: '<img class="a" src="a.png" alt="" *liquid(ghost: #f00)>', jetons: ['ghost'] }
    },
    temoins: [
      { texte: 'why(el, s);',                                  pages: ['cells', 'radius', 'ghost'] },
      { texte: 'var EPS     = .05;',                           pages: ['cells', 'radius', 'ghost'] },
      { texte: 'var tiles = !broken',                          pages: ['cells', 'radius', 'ghost'] },
      { texte: 'if (tiles) return pixels(el, s);',             pages: ['cells', 'radius', 'ghost'] },
      { texte: '[mjs-fx-liquid-view]{object-fit:none',         pages: ['cells', 'radius', 'ghost'] }
    ]
  },
  {
    fichier: 'mjs_fx_pointer.ts',
    pages: {
      [REF]: { balise: '*pointer(lens, outside: true)', jetons: [] },
      soft:  { balise: '*pointer(lens, outside: true, soft: 40)', jetons: ['soft'] }
    },
    temoins: [
      { texte: "_mjs_fxRegister('--mjs-fx-pointer-e'",       pages: ['soft'] },
      { texte: 'var soften = function',                      pages: ['soft'] },
      { texte: 'soften(s.soft);',                            pages: ['soft'] },
      { texte: "if (k === 'soft') soften(v);",               pages: ['soft'] },
      { texte: '@supports (-moz-orient',                     pages: ['soft'] }
    ]
  }
]

describe('étiquettes `// @@` des fichiers d\'effet — chaque réglage seul embarque sa section et rien d\'autre', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  // un build RÉEL de production dont le code reste lisible (`minify: false`) : le développement envoie les fichiers d'effets en entier, le tri des sections est celui de la production ; rend tout le JavaScript émis
  async function construire(nom: string, source: string): Promise<string> {
    const root   = mjsTmp('etiquettes-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    return readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  }
  const appli = (balise: string) => balise.startsWith('<') ? balise : `<script>\n$n = 0\n</script>\n<div class="a" ${balise}>x</div>`

  for (const table of TABLES) {
    describe(table.fichier, () => {
      const src      = readFileSync(join(import.meta.dirname, '../src/runtime', table.fichier), 'utf-8')
      const sorties: Record<string, string> = {}

      before(async () => {
        for (const [nom, page] of Object.entries(table.pages)) sorties[nom] = await construire(nom.replace(/\W/g, '-'), appli(page.balise))
      })

      it('les jetons des étiquettes du fichier sont exactement ceux des pages de la table', () => {
        // la section du développement n'est le réglage d'aucune page : son propre contrôle le prouve (cf. JETONS_DEV)
        const dansLeFichier = [...new Set(unites(src).flatMap((u) => u.jetons))].filter((j) => j !== JETONS_DEV[table.fichier]).sort()
        const dansLaTable   = [...new Set(Object.values(table.pages).flatMap((p) => p.jetons))].sort()
        assert.deepEqual(dansLeFichier, dansLaTable)
      })

      it('chaque section marquée porte au moins un témoin sur ses lignes propres, et chaque témoin est dans une section', () => {
        const liste = unites(src)
        // un témoin sur plusieurs lignes couvre la section d'une seule ligne dont il contient la ligne
        const porte = (u: Unite, texte: string) => u.propres.join('\n').includes(texte) || (texte.includes('\n') && u.propres.length === 1 && texte.split('\n').some((l) => l === u.propres[0]))
        for (const u of liste) assert.ok(table.temoins.some((t) => porte(u, t.texte)), `la section « ${u.jetons.join(' ')} » (ligne ${u.ligne}) n'a aucun témoin`)
        for (const t of table.temoins) {
          assert.ok(liste.some((u) => porte(u, t.texte)), `le témoin « ${t.texte} » n'est dans aucune section marquée`)
          for (const p of t.pages) assert.ok(table.pages[p], `le témoin « ${t.texte} » cite la page ${p}, qui n'existe pas`)
        }
      })

      it('aucune marque ne sort, et chaque page porte les témoins de son réglage, et seulement eux', () => {
        for (const [nom, sortie] of Object.entries(sorties)) {
          assert.equal(sortie.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false, `${nom} : une marque de section sort`)
          for (const t of table.temoins) {
            const delta = compte(sortie, t.texte) - compte(sorties[REF], t.texte)
            assert.equal(delta, t.pages.includes(nom) ? (t.n ?? 1) : 0, `page « ${nom} » (${table.pages[nom].balise}) : « ${t.texte} » ${t.pages.includes(nom) ? 'doit partir' : 'ne doit pas partir'}`)
          }
        }
      })
    })
  }

  describe('mjs_fx_hologram.ts (mots d\'étiquette = styles de carte)', () => {
    const src = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_hologram.ts'), 'utf-8')
    // chaque style nommé par un appel `style('a b c', …)` de la feuille : la source indépendante des étiquettes
    const noms = [...new Set([...src.matchAll(/(?<![\w$.])style\('([a-z0-9 -]+)'/g)].flatMap((m) => m[1].split(' ')))].sort()

    // ce que le build fait d'une page : les poses compilées, les styles écrits, le fichier filtré
    async function filtre(page: string): Promise<string> {
      const compile = (await transpile(`<div class="a" *hologram${page}>x</div>`, { moduleName: 'c' })).output
      return selectHologramStyles(src, hologramStylesWanted(scanCompiledFeatures(compile), false))
    }
    const appels = (texte: string) => [...texte.matchAll(/(?<![\w$.])style\('([a-z0-9 -]+)'/g)].map((m) => m[1])

    it('on a trouvé les styles de carte du fichier', () => {
      assert.ok(noms.length >= 20, noms.join(' '))
    })

    it('chaque style de carte écrit seul garde sa définition, une seule, et le moteur de carte ; rien d\'écrit : aucune carte', async () => {
      const nu = await filtre('')
      acorn.parse(nu, { ecmaVersion: 'latest' })
      assert.deepEqual(appels(nu), [], 'sans style de carte écrit, aucune définition de carte')
      for (const nom of noms) {
        const texte = await filtre(`(${nom})`)
        acorn.parse(texte, { ecmaVersion: 'latest' })
        const dits = appels(texte)
        assert.ok(dits.length > 0 && dits.every((a) => a === nom), `${nom} : ses définitions seules (${dits.join(' | ')})`)
        assert.ok(texte.length > nu.length, `${nom} : le moteur de carte part avec lui`)
      }
    })

    it('chaque mot d\'étiquette du fichier est le nom d\'un style de carte (ou `cards`)', () => {
      const tous = [...new Set(unites(src).flatMap((u) => u.jetons))].filter((m) => m !== 'cards').sort()
      // `style=nom` est le style `nom` écrit en toutes lettres ; les autres jetons `réglage=valeur` et `effet.réglage` ne sont pas des styles :
      // le tour et le dos d'un zoom, la fenêtre de l'illustration, la section du développement
      assert.deepEqual(tous.filter((m) => /[=.]/.test(m) && !m.startsWith('style=')), ['hologram.back', 'hologram.dev', 'hologram.zone', 'zoom=spin'])
      const mots = tous.filter((m) => !/[=.]/.test(m) || m.startsWith('style=')).map((m) => m.replace(/^style=/, ''))
      for (const m of mots) assert.ok(noms.includes(m), `« ${m} » est écrit dans une étiquette et ne nomme aucun style de la feuille`)
    })
  })

  describe('tout module d\'effet marqué par `// @@` (trouvé dans src/runtime) — les contrôles qui ne demandent aucune table', () => {
    it('la découverte rend les modules qu\'on sait triés (une découverte muette ne contrôlerait rien)', () => {
      for (const f of MODULES_CONNUS) assert.ok(MODULES_MARQUES.includes(f), `${f} porte des marques et n'est pas découvert : ${MODULES_MARQUES.join(' ')}`)
      for (const t of TABLES) assert.ok(MODULES_MARQUES.includes(t.fichier), `${t.fichier} a une table et n'est pas découvert`)
    })

    for (const fichier of MODULES_MARQUES) {
      describe(fichier, () => {
        const src    = readFileSync(join(DOSSIER_RUNTIME, fichier), 'utf-8')
        const client = clientDe(fichier)
        const effets = fxEffectsOf(fichier)

        // du JavaScript brut (les modules runtime n'ont aucune annotation de type) : le filtre rend du texte, pas encore compilé
        const lisible = (texte: string, quoi: string) => {
          try {
            acorn.parse(texte, { ecmaVersion: 'latest' })
          }
          catch (e: any) {
            assert.fail(`${fichier}, ${quoi} : ce n'est pas du JavaScript valide (${e.message})`)
          }
        }

        it('chaque étiquette est bien formée et nomme un réglage que le catalogue connaît pour cet effet', () => {
          assert.ok(effets.length > 0 || fichier === MOTEUR, `le catalogue ne connaît aucun effet que ${fichier} porte`)
          const sait = (effet: string, nom: string) => Object.prototype.hasOwnProperty.call(EFFECTS[effet].settings, nom) || HORS_CATALOGUE.some((h) => h.effet === effet && h.nom === nom)
          const sections = unites(src)
          assert.ok(sections.length > 0, `${fichier} : aucune section lue`)
          for (const u of sections) {
            for (const mot of u.jetons) {
              for (const jeton of client?.word ? client.word(mot) : [mot]) {
                // la section du développement n'est le réglage d'aucun effet : le contrôle qui suit prouve qu'aucune page ne la demande
                if (jeton === JETONS_DEV[fichier]) continue
                const lieu = `${fichier}, ligne ${u.ligne} : l'étiquette « ${u.jetons.join(' ')} », jeton « ${jeton} »`
                const lu   = JETON.exec(jeton)
                assert.ok(lu, `${lieu} — illisible`)
                const [, etoile, effet, nom] = lu
                if (etoile) assert.ok(effets.includes(etoile), `${lieu} — ${etoile} n'est pas un effet de ce fichier (${effets.join(' ')})`)
                else if (effet) {
                  assert.ok(effets.includes(effet), `${lieu} — ${effet} n'est pas un effet de ce fichier (${effets.join(' ')})`)
                  assert.ok(sait(effet, nom), `${lieu} — ${effet} n'a pas de réglage « ${nom} » au catalogue`)
                }
                else assert.ok(effets.some((e) => sait(e, nom)), `${lieu} — aucun effet de ce fichier n'a de réglage « ${nom} » au catalogue`)
              }
            }
          }
          // une marque que la grammaire ne lit pas n'est pas une erreur de build : la ligne passerait comme une ligne ordinaire, marque comprise. Seul un commentaire peut en parler
          src.split('\n').forEach((texte, i) => {
            if (texte.includes('// @@') && !estMarque(texte)) assert.ok(/^\s*\/\//.test(texte), `${fichier}, ligne ${i + 1} : une marque que la grammaire ne lit pas`)
          })
        })

        if (JETONS_DEV[fichier]) {
          it('la section du développement : le fichier entier la porte, et aucune page ne la demande, quoi qu\'elle écrive', () => {
            const jeton   = JETONS_DEV[fichier]
            const lignes  = src.split('\n')
            const propres = unites(src).filter((u) => u.jetons.includes(jeton)).flatMap((u) => u.propres)
            // les lignes de code de la section que le fichier n'écrit qu'une fois : leur présence ou leur absence dit la section entière
            const temoins = propres.filter((l) => l.trim().length >= 25 && !/^\s*\/\//.test(l) && lignes.filter((x) => x === l).length === 1)
            assert.ok(temoins.length > 0, `${fichier} : la section « ${jeton} » n'a aucune ligne de code qui lui soit propre`)
            // tout ce qu'une page peut écrire : l'effet, et chaque réglage du catalogue avec une valeur que le build ne sait pas lire
            const ecrit = new Set<string>()
            // le moteur : tout ce qu'une page peut écrire, pour tous les effets
            for (const e of fichier === MOTEUR ? Object.keys(EFFECTS) : effets) {
              ecrit.add(fxUseSignal(e))
              for (const nom of Object.keys(EFFECTS[e].settings)) ecrit.add(fxSignal(e, nom, FX_ANY))
            }
            const entier = selectFxSections(fichier, src, new Set(), true, client)
            const filtre = selectFxSections(fichier, src, ecrit, false, client)
            for (const l of temoins) {
              assert.ok(entier.includes(l), `${fichier} : le fichier entier doit porter « ${l.trim()} »`)
              assert.ok(!filtre.includes(l), `${fichier} : une page qui écrit tout ce que le catalogue permet demande la section « ${jeton} » (« ${l.trim()} » part en production)`)
            }
          })
        }

        it('chaque section se ferme : aucune fermeture sans ouverture, aucune ouverture sans fermeture', () => {
          const ouvertes: number[] = []
          src.split('\n').forEach((texte, i) => {
            const b = BLOC.exec(texte)
            if (!b) return
            if (b[1]) ouvertes.push(i + 1)
            else assert.ok(ouvertes.pop() !== undefined, `${fichier}, ligne ${i + 1} : une fermeture sans section ouverte`)
          })
          assert.deepEqual(ouvertes, [], `${fichier} : des sections ouvertes et jamais fermées (lignes d'ouverture)`)
        })

        it('le fichier filtré sans aucune demande, et celui où tout est demandé, sont du JavaScript valide', () => {
          const nu   = selectFxSections(fichier, src, new Set(), false, client)
          const tout = selectFxSections(fichier, src, new Set(), true, client)
          lisible(nu, 'sans aucune demande')
          lisible(tout, 'avec tout demandé')
          assert.ok(tout.length > nu.length, `${fichier} : sans demande le filtre n'ôte aucune section (${nu.length} / ${tout.length} caractères)`)
        })

        it('aucune marque ne sort du filtre', () => {
          for (const [quoi, forcee] of [['sans aucune demande', false], ['avec tout demandé', true]] as const) {
            const sortie = selectFxSections(fichier, src, new Set(), forcee, client)
            const reste  = sortie.split('\n').findIndex(estMarque)
            assert.equal(reste, -1, `${fichier}, ${quoi} : une marque sort du filtre, ligne ${reste + 1} de la sortie`)
          }
        })
      })
    }
  })
})
