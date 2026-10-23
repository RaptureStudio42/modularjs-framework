// les outils partagés des effets (runtime/mjs_fx_tool*.ts, bundler/fx-tools.ts) ne pèsent que sur les applis dont un effet s'en sert :
// une petite appli sans effet n'en porte aucun, une appli à un effet n'en porte que ce que cet effet appelle ; en 'all' ils viennent tous.
// Le jour où un effet appelle un outil, il doit se ranger dans la liste de cet outil : le test le réclame.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { Bundler } from '../src/bundler/index.js'
import { DETECTED_CORE_MODULES } from '../src/bundler/config.js'
import { FX_KEYS, FX_NAMED, FX_NAMEABLE_KEYS, FX_ANY, fxSignal, fxUseSignal } from '../src/bundler/features.js'
import { FX_TOOLS, FX_TOOL_KEYS, fxToolsWanted, fxToolsCalled, fxToolsMissing } from '../src/bundler/fx-tools.js'
import { selectFxSections, fxEffectsOf } from '../src/bundler/fx-sections.js'
import { hologramClient, HOLOGRAM_FILE } from '../src/bundler/hologram-styles.js'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const fichier = (k: string) => 'mjs_' + k + '.ts'
const outils  = (files: string[]) => FX_TOOL_KEYS.filter((k) => files.includes(fichier(k)))
const lire    = (f: string) => readFileSync(join(RUNTIME, f), 'utf-8')
// les noms qu'un outil définit (`µ._mjs_fxX = …`)
const definis = (k: string) => [...lire(fichier(k)).matchAll(/^µ\.(_mjs_fx\w+) = /gm)].map((m) => m[1])

// les façons de nommer un outil, appelé à la lettre ou non : la détection doit toutes les compter (un outil nommé et absent donnerait « is not a function »)
const FORMES: Array<[string, string]> = [
  ['appel ordinaire', 'µ._mjs_fxRoots(el);'],
  ['alias local', 'var rr = µ._mjs_fxRoots; rr(el);'],
  ['crochets, guillemets simples', 'µ[\'_mjs_fxRoots\'](el);'],
  ['crochets, guillemets doubles', 'µ["_mjs_fxRoots"](el);'],
  ['crochets, gabarit', 'µ[`_mjs_fxRoots`](el);'],
  ['crochets, espaces autour', 'µ[ \'_mjs_fxRoots\' ](el);'],
  ['call', 'µ._mjs_fxRoots.call(null, el);'],
  ['apply', 'µ._mjs_fxRoots.apply(null, [el]);'],
  ['espace avant la parenthèse', 'µ._mjs_fxRoots (el);'],
  ['appel optionnel', 'µ._mjs_fxRoots?.(el);'],
  ['extraction', 'var { _mjs_fxRoots: rr } = µ; rr(el);'],
  ['passé en argument', 'list.forEach(µ._mjs_fxRoots);'],
  ['test d\'existence', 'var la = \'_mjs_fxRoots\' in µ;']
]

// TÉMOIN INDÉPENDANT de fxToolsCalled (ni blankNonCode ni `uses`) : les outils dont le nom est mentionné dans le CODE d'un texte, lu dans l'arbre
// syntaxique. Un identifiant (`µ._mjs_fxRoots`, un alias, une extraction) ou une chaîne qui est ce nom (`µ['_mjs_fxRoots']`, `'_mjs_fxRoots' in µ`) ;
// la garde de cadence se lit aussi dans la déclaration `heavy` d'un effet lourd (un identifiant, ou une clé écrite entre guillemets)
const NOMS_D_OUTILS = new Map<string, string>(FX_TOOL_KEYS.flatMap((k) => definis(k).map((n) => [n, k] as [string, string])))
NOMS_D_OUTILS.set('heavy', 'fx_toolgauge')
// la reprise du décor se lit dans la déclaration `decor` d'un effet qui pose un calque dans sa balise
NOMS_D_OUTILS.set('decor', 'fx_toolkeep')
const mentionnes = (texte: string): Set<string> => {
  const vus = new Set<string>()
  if (![...NOMS_D_OUTILS.keys()].some((n) => texte.includes(n))) return vus
  const source = ts.createSourceFile('module.js', texte, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const visite = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && NOMS_D_OUTILS.has(n.text)) vus.add(NOMS_D_OUTILS.get(n.text)!)
    else if (ts.isStringLiteralLike(n) && NOMS_D_OUTILS.has(n.text) && (n.text.startsWith('_mjs_') || (ts.isPropertyAssignment(n.parent) && n.parent.name === n))) vus.add(NOMS_D_OUTILS.get(n.text)!)
    ts.forEachChild(n, visite)
  }
  visite(source)
  return vus
}
// les outils que le témoin voit dans un texte et que la détection ne compte pas ; l'outil du fichier lui-même ne compte pas (un outil ne se réclame pas)
const manques = (texte: string, tools: typeof FX_TOOLS = FX_TOOLS, fichierDuTexte = ''): string[] => {
  const comptes = fxToolsCalled(texte, tools)
  return [...mentionnes(texte)].filter((k) => !comptes.has(k) && fichierDuTexte !== fichier(k)).sort()
}

// les signaux qu'un jeton d'étiquette de section (`on=scroll`, `*pixelate`, `iris.start`) demande, pour les effets d'un fichier
const signauxDuJeton = (jeton: string, effets: string[]): string[] => {
  const m = /^(?:\*([a-z][a-z0-9-]*)|(?:([a-z][a-z0-9-]*)\.)?([a-z][a-zA-Z0-9]*)(?:=(.+))?)$/.exec(jeton)
  if (!m) return []
  if (m[1]) return [fxUseSignal(m[1])]
  const valeurs = m[4] && m[4] !== '*' ? m[4].split(',') : [FX_ANY]
  return (m[2] ? [m[2]] : effets).flatMap((e) => valeurs.map((v) => fxSignal(e, m[3], v)))
}
// les textes qu'un fichier d'effet peut devenir dans le build : entier, sans réglage écrit, tous les réglages écrits, chaque jeton d'étiquette seul
const rendus = (f: string): Array<[string, string]> => {
  const src     = lire(f)
  const sorties = [['fichier entier', src]] as Array<[string, string]>
  if (!src.includes('// @@')) return sorties
  const client = f === HOLOGRAM_FILE ? hologramClient : undefined
  const effets = fxEffectsOf(f)
  const ecrits = new Set(['fx', ...effets.map(fxUseSignal)])
  sorties.push(['tout demandé', selectFxSections(f, src, ecrits, true, client)])
  // les mots d'étiquette de *hologram ont leur vocabulaire (ses styles de carte) : ses textes triés se lisent dans son propre test
  if (f === HOLOGRAM_FILE) return sorties
  sorties.push(['rien demandé', selectFxSections(f, src, ecrits, false)])
  const jetons = new Set([...src.matchAll(/\/\/ @@ ([A-Za-z0-9 ._=,*-]+)$/gm)].flatMap((m) => m[1].trim().split(' ')).filter(Boolean))
  for (const jeton of jetons) sorties.push(['seul : ' + jeton, selectFxSections(f, src, new Set([...ecrits, ...signauxDuJeton(jeton, effets)]), false)])
  return sorties
}

describe('les outils partagés des effets — le poids suit l\'usage', () => {
  it('chaque outil a son fichier, est un module détecté du cœur, et ne demande que des outils qui existent', () => {
    for (const k of FX_TOOL_KEYS) {
      assert.ok(existsSync(join(RUNTIME, fichier(k))), k + ' : fichier absent')
      assert.ok((DETECTED_CORE_MODULES as readonly string[]).includes(k), k + ' absent de DETECTED_CORE_MODULES')
      for (const n of FX_TOOLS[k].needs) assert.ok(FX_TOOL_KEYS.includes(n), k + ' demande ' + n + ', qui n\'existe pas')
    }
    const fichiers = readdirSync(RUNTIME).filter((f) => /^mjs_fx_tool[a-z]+\.ts$/.test(f))
    assert.deepEqual(fichiers.sort(), FX_TOOL_KEYS.map(fichier).sort(), 'un fichier d\'outil que le bundler ignore')
  })

  it('une petite appli sans effet : aucun outil, ni en détection, ni avec le moteur seul', () => {
    for (const used of [new Set<string>(), new Set(['title']), new Set(['fx'])]) {
      const { files } = new Bundler({ i18n: { default: 'fr' } }).resolveRuntimeFiles(used)
      assert.deepEqual(outils(files), [], [...used].join(' '))
    }
  })

  it('une appli à effets légers qui n\'appellent aucun outil : aucun outil (le poids d\'aujourd\'hui ne change pas, la garde de cadence non plus)', () => {
    const { files } = new Bundler({ i18n: { default: 'fr' } }).resolveRuntimeFiles(new Set(['fx', 'fx_neon', 'fx_tilt']))
    assert.deepEqual(outils(files), [])
    assert.ok(files.includes('mjs_fx_neon.ts'))
  })

  it('la garde de cadence ne vient qu\'avec un effet lourd, quel que soit celui des sept ; la reprise du décor, avec ceux des sept qui posent un décor dans leur balise', () => {
    const decor = ['fx_crt', 'fx_fluid', 'fx_goo', 'fx_mesh', 'fx_particles', 'fx_sparkles']
    for (const k of ['fx_crt', 'fx_fluid', 'fx_goo', 'fx_mesh', 'fx_noise', 'fx_particles', 'fx_sparkles']) {
      // en développement le fichier de *goo part en entier : il suit aussi le défilement (la goutte revient sous la souris quand la balise passe), il porte l'outil du défilement,
      // avec les deux outils que celui-ci demande (parents, racines) ; en production, trié, ces trois outils ne viennent qu'avec `pointer` (bundler-outils-filtres.test.ts)
      const dev  = new Bundler({ i18n: { default: 'fr' } }).resolveRuntimeFiles(new Set(['fx', k]))
      const prod = new Bundler({ i18n: { default: 'fr' }, env: 'prod' } as any).resolveRuntimeFiles(new Set(['fx', k]))
      const reprise = decor.includes(k) ? ['fx_toolkeep'] : []
      assert.deepEqual(outils(dev.files), [...(k === 'fx_goo' ? ['fx_toolup', 'fx_toolroots', 'fx_toolscroll', 'fx_toolgauge'] : ['fx_toolgauge']), ...reprise], k)
      assert.deepEqual(outils(prod.files), ['fx_toolgauge', ...reprise], k + ' en production')
    }
  })

  it('la reprise du décor ne vient qu\'avec un effet qui déclare `decor: true` : seule, quel que soit l\'effet, en production comme en développement ; jamais avec un effet sans décor', () => {
    for (const k of ['fx_scratch', 'fx_spoiler', 'fx_skeleton', 'fx_beam', 'fx_peel', 'fx_gauge']) {
      const dev  = new Bundler({ i18n: { default: 'fr' } }).resolveRuntimeFiles(new Set(['fx', k]))
      const prod = new Bundler({ i18n: { default: 'fr' }, env: 'prod' } as any).resolveRuntimeFiles(new Set(['fx', k]))
      // *spoiler porte aussi le libellé dans la langue de la page, qu'il nomme lui-même (µ._mjs_fxLabel)
      const attendu = k === 'fx_spoiler' ? ['fx_toolkeep', 'fx_toollabel'] : ['fx_toolkeep']
      assert.deepEqual(outils(dev.files), attendu, k)
      assert.deepEqual(outils(prod.files), attendu, k + ' en production')
    }
    for (const k of ['fx_neon', 'fx_tilt', 'fx_underline']) {
      assert.deepEqual(outils(new Bundler({ i18n: { default: 'fr' }, env: 'prod' } as any).resolveRuntimeFiles(new Set(['fx', k])).files), [], k)
    }
  })

  it('un effet nommé à l\'exécution (`fx: $effet`) : seulement les outils d\'un effet qui peut être nommé, et ceux que ces outils demandent', () => {
    const nomme = new Bundler({ i18n: { default: 'fr' } }).resolveRuntimeFiles(new Set(['fx', FX_NAMED]))
    // écrit en clair : marquee (up, roots), stagger (register, scroll), path (scroll), sprite (visible) et les deux effets lourds qui se nomment (crt,
    // sparkles : la garde), ceux qui posent un décor dans leur balise (la reprise du décor), ceux qui travaillent le texte de leur balise (le calque de texte), annotate (la reprise
    // après un chargement de police) et les effets qui se répètent, shine, attention, glitch et annotate (la cadence et son horloge commune). Ni box, watch, lag, smooth, svg, webkit, color ni label : leurs effets (pointer, spotlight, filter, liquid, blend, guard, offline, loader) ne se nomment pas
    assert.deepEqual(outils(nomme.files), ['fx_toolup', 'fx_toolroots', 'fx_toolregister', 'fx_toolvisible', 'fx_toolscroll', 'fx_toolgauge', 'fx_tooltext', 'fx_toolkeep', 'fx_toolfonts', 'fx_toolbeat'])
    // la même règle, lue dans la table et la liste des effets nommables
    const utiles = new Set(FX_TOOL_KEYS.filter((k) => FX_TOOLS[k].effects.some((e) => FX_NAMEABLE_KEYS.includes(e))))
    for (const k of [...utiles]) for (const n of FX_TOOLS[k].needs) utiles.add(n)
    assert.deepEqual(outils(nomme.files), FX_TOOL_KEYS.filter((k) => utiles.has(k)))
  })

  it('un effet nommé à l\'exécution ET un effet écrit dans la page : les outils de l\'effet écrit viennent aussi, même s\'il ne se nomme pas', () => {
    const { files } = new Bundler({ i18n: { default: 'fr' } }).resolveRuntimeFiles(new Set(['fx', FX_NAMED, 'fx_pointer']))
    for (const k of ['fx_toolbox', 'fx_toolwatch', 'fx_toolroots', 'fx_toollag', 'fx_toolregister', 'fx_toolup']) assert.ok(outils(files).includes(k), k)
  })

  it('un effet qui appelle un outil : cet outil et ceux qu\'il demande, pas les autres', () => {
    const vide  = Object.fromEntries(Object.entries(FX_TOOLS).map(([k, v]) => [k, { ...v, effects: [] as string[] }])) as typeof FX_TOOLS
    const table = { ...vide, fx_toolbox: { ...vide.fx_toolbox, effects: ['fx_pointer'] }, fx_toolwatch: { ...vide.fx_toolwatch, effects: ['fx_pointer'] }, fx_toollag: { ...vide.fx_toollag, effects: ['fx_pointer', 'fx_velocity'] } }
    assert.deepEqual([...fxToolsWanted((k) => k === 'fx_pointer', table)].sort(), ['fx_toolbox', 'fx_toollag', 'fx_toolroots', 'fx_toolwatch'])
    assert.deepEqual([...fxToolsWanted((k) => k === 'fx_velocity', table)], ['fx_toollag'])
    assert.deepEqual([...fxToolsWanted((k) => k === 'fx_neon', table)], [])
    assert.deepEqual([...fxToolsWanted(() => false, table)], [])
  })

  it('un outil demandé par son nom (runtime: [\'fx_toolbox\']) vient avec le cœur', () => {
    const { files } = new Bundler({ runtime: ['fx_toolvisible'] as any, i18n: { default: 'fr' } }).resolveRuntimeFiles(new Set(['fx']))
    assert.ok(files.includes('mjs_fx_toolvisible.ts'))
    assert.equal(outils(files).length, 1)
  })

  it('un outil demandé par son nom, sans aucun effet dans la page : le moteur des effets (µ._mjs_dom) et les outils qu\'il demande viennent avec lui, avant lui', () => {
    for (const k of FX_TOOL_KEYS) {
      const { files } = new Bundler({ runtime: [k] as any, i18n: { default: 'fr' } }).resolveRuntimeFiles(new Set())
      assert.ok(files.includes('mjs_fx.ts'), k + ' : le moteur manque')
      assert.ok(files.indexOf('mjs_fx.ts') < files.indexOf(fichier(k)), k + ' : le moteur doit précéder l\'outil')
      for (const n of FX_TOOLS[k].needs) assert.ok(outils(files).includes(n), k + ' demande ' + n + ', absent')
    }
  })

  it('en \'all\' : tous les outils, avant les effets ; le moteur d\'abord', () => {
    const { files } = new Bundler({ runtime: 'all', i18n: { default: 'fr' } }).resolveRuntimeFiles()
    assert.deepEqual(outils(files), FX_TOOL_KEYS)
    assert.ok(files.indexOf('mjs_fx.ts') < files.indexOf(fichier(FX_TOOL_KEYS[0])))
  })

  it('les fichiers des outils se posent juste après le moteur, d\'un seul tenant, avant le premier effet : voisins du moteur par le texte, la compression (fenêtre de 32 Ko) les paie moins cher', () => {
    const { files } = new Bundler({ runtime: 'all', i18n: { default: 'fr' } }).resolveRuntimeFiles()
    const m = files.indexOf('mjs_fx.ts')
    assert.deepEqual(files.slice(m + 1, m + 1 + FX_TOOL_KEYS.length), FX_TOOL_KEYS.map(fichier), 'les outils, dans l\'ordre de la table, tout de suite après mjs_fx.ts')
    assert.equal(files[m + 1 + FX_TOOL_KEYS.length], fichier(FX_KEYS[0]), 'puis le premier effet du catalogue')
    // une page qui n'a besoin que de quelques outils : le moteur, ces outils d'un seul tenant, puis l'effet
    const { files: une } = new Bundler({ i18n: { default: 'fr' } }).resolveRuntimeFiles(new Set(['fx', 'fx_pointer']))
    const n = outils(une).length
    assert.ok(n > 1, 'le banc : *pointer appelle plusieurs outils')
    assert.deepEqual(une.slice(une.indexOf('mjs_fx.ts') + 1, une.indexOf('mjs_fx.ts') + 1 + n), outils(une).map(fichier))
    assert.equal(une[une.indexOf('mjs_fx.ts') + 1 + n], 'mjs_fx_pointer.ts')
  })

  it('fxToolsCalled : les outils que le code d\'un module appelle, jamais ceux que ses commentaires ou ses chaînes citent', () => {
    const texte = [
      '// la distance vient de µ._mjs_fxBox(el), comme avant',
      'var a = \'µ._mjs_fxLag(1, 2, 3)\';',
      '/* µ._mjs_fxRoots(el) */',
      'var b = µ._mjs_fxWatch(el, f);',
      'var d = { heavy: true };'
    ].join('\n')
    assert.deepEqual([...fxToolsCalled(texte)], ['fx_toolwatch', 'fx_toolgauge'])
    assert.deepEqual([...fxToolsCalled('var rien = 1;')], [])
  })

  it('fxToolsCalled : toute mention du nom d\'un outil dans le code vaut usage, appelé à la lettre ou non (alias, crochets, call, apply, espace avant la parenthèse, appel optionnel, extraction)', () => {
    for (const [nom, code] of FORMES) assert.deepEqual([...fxToolsCalled(code)], ['fx_toolroots'], nom)
  })

  it('fxToolsCalled : un nom qui n\'est que le début ou la fin d\'un autre ne compte pas, ni celui d\'un commentaire ou d\'une chaîne', () => {
    assert.deepEqual([...fxToolsCalled('var s = µ._mjs_fxLagSetting(1, 0);')], ['fx_toolsmooth'], '_mjs_fxLag n\'est pas _mjs_fxLagSetting')
    assert.deepEqual([...fxToolsCalled('µ._mjs_fxGaugeProp = true;')], [], '_mjs_fxGaugeProp n\'est pas la garde de cadence')
    assert.deepEqual([...fxToolsCalled('var a = µ._mjs_fxRootsOf(el), b = ex_mjs_fxRoots;')], [], 'ni un nom plus long, ni un nom collé à un autre mot')
    assert.deepEqual([...fxToolsCalled('// µ._mjs_fxRoots\nvar s = \'µ._mjs_fxBox\'; /* µ._mjs_fxWatch */')], [], 'ni un commentaire ni une chaîne')
  })

  it('fxToolsCalled : la garde de cadence se lit dans la déclaration `heavy` d\'un effet lourd, écrite comme on veut, ou dans son nom', () => {
    for (const code of ['var d = { heavy: true };', 'var d = { heavy:true };', 'var d = { heavy : true };', 'd.heavy = true;', 'var { heavy } = d;', 'if (µ._mjs_fxGauge) µ._mjs_fxGauge(h);']) {
      assert.deepEqual([...fxToolsCalled(code)], ['fx_toolgauge'], code)
    }
  })

  it('fxToolsCalled : le texte d\'un gabarit est lu comme du code (comme le contrat du cœur le lit) : une mention y compte, au pire un outil de trop', () => {
    assert.deepEqual([...fxToolsCalled('var t = `µ._mjs_fxBox(el)`;')], ['fx_toolbox'])
    assert.deepEqual([...fxToolsCalled('var t = `a ${µ._mjs_fxWatch(el)} b`;')], ['fx_toolwatch'])
  })

  it('fxToolsWanted avec le code des effets : les outils appelés et ceux qu\'ils demandent ; la liste des effets de la table ne compte plus', () => {
    assert.deepEqual([...fxToolsWanted(() => true, FX_TOOLS, [], new Set(['fx_toolwatch']))].sort(), ['fx_toolroots', 'fx_toolwatch'])
    assert.deepEqual([...fxToolsWanted(() => true, FX_TOOLS, [], new Set())], [], 'le code n\'appelle rien : aucun outil, même si la table range des effets sous des outils')
    assert.deepEqual([...fxToolsWanted(() => false, FX_TOOLS, ['fx_toolbox'], new Set(['fx_toolsvg']))].sort(), ['fx_toolbox', 'fx_toolsvg'], 'un outil demandé par son nom vient aussi')
  })

  it('fxToolsMissing : les outils qu\'un module appelle sans qu\'ils soient là, avec les modules qui les appellent ; un outil ne se réclame pas lui-même', () => {
    const modules: Array<[string, string]> = [['mjs_fx_a.ts', 'µ._mjs_fxRoots(el); µ._mjs_fxBox(el);'], ['mjs_fx_b.ts', 'µ._mjs_fxRoots(el);'], ['mjs_fx_c.ts', 'var x = 1;']]
    assert.deepEqual(fxToolsMissing(modules, ['fx_toolbox']), [{ tool: 'fx_toolroots', files: ['mjs_fx_a.ts', 'mjs_fx_b.ts'] }])
    assert.deepEqual(fxToolsMissing(modules, ['fx_toolbox', 'fx_toolroots']), [])
    assert.deepEqual(fxToolsMissing(modules, []).map((m) => m.tool), ['fx_toolbox', 'fx_toolroots'])
    assert.deepEqual(fxToolsMissing([['mjs_fx_toolup.ts', 'µ._mjs_fxParent = function(n) { return n; }; µ._mjs_fxWithin = function(r, n) { return µ._mjs_fxParent(n); };']], []), [], 'l\'outil du parent s\'appelle lui-même')
    assert.deepEqual(fxToolsMissing([['mjs_fx_a.ts', '// µ._mjs_fxRoots(el)\nvar s = \'µ._mjs_fxBox(el)\';']], []), [], 'ni un commentaire ni une chaîne')
  })

  it('un outil ne demande que les outils que son code appelle : ni plus (il pèserait pour rien), ni moins (il appellerait une fonction absente)', () => {
    for (const k of FX_TOOL_KEYS) {
      const appeles = [...fxToolsCalled(readFileSync(join(RUNTIME, fichier(k)), 'utf-8'))].filter((n) => n !== k).sort()
      assert.deepEqual(appeles, [...FX_TOOLS[k].needs].sort(), k)
    }
  })

  it('chaque module d\'effet du dépôt, entier, avec les outils qu\'il appelle et ceux que ceux-ci demandent : aucun outil ne manque', () => {
    const effets = readdirSync(RUNTIME).filter((f) => /^mjs_fx_[a-z0-9_]+\.ts$/.test(f) && !/^mjs_fx_tool[a-z]+\.ts$/.test(f))
    const lire   = (f: string) => readFileSync(join(RUNTIME, f), 'utf-8')
    for (const f of effets) {
      const venus   = fxToolsWanted(() => false, FX_TOOLS, [], fxToolsCalled(lire(f)))
      const modules = [[f, lire(f)], ...[...venus].map((k) => [fichier(k), lire(fichier(k))])] as Array<[string, string]>
      assert.deepEqual(fxToolsMissing(modules, venus), [], f)
    }
  })

  it('le témoin (arbre syntaxique) voit ce que l\'ancienne détection, le nom suivi d\'une parenthèse, ne voyait pas : il fait échouer le test des modules', () => {
    const ancienne = Object.fromEntries(Object.entries(FX_TOOLS).map(([k, v]) => [k, { ...v, uses: k === 'fx_toolgauge' ? /\bheavy: true\b/ : new RegExp('(?:' + definis(k).join('|') + ')\\(') }])) as typeof FX_TOOLS
    for (const [nom, code] of FORMES) {
      assert.deepEqual([...mentionnes(code)], ['fx_toolroots'], nom + ' : le témoin la voit')
      assert.deepEqual(manques(code, ancienne), nom === 'appel ordinaire' ? [] : ['fx_toolroots'], nom + ' : l\'ancienne détection la manquait')
      assert.deepEqual(manques(code), [], nom + ' : la détection d\'aujourd\'hui la compte')
    }
    // le même module rendu par le filtre : l\'alias d\'une section non demandée n\'est pas dans le texte trié, celui d\'une section demandée y est
    const avecSection = 'var a = 1;\nvar rr = µ._mjs_fxRoots; // @@ on=scroll\n'
    assert.deepEqual(mentionnes(selectFxSections('mjs_fx_pile.ts', avecSection, new Set(['fx']), false)), new Set())
    assert.deepEqual(mentionnes(selectFxSections('mjs_fx_pile.ts', avecSection, new Set(['fx', fxSignal('pile', 'on', 'scroll')]), false)), new Set(['fx_toolroots']))
    // la garde de cadence : le témoin lit aussi une clé `heavy` écrite entre guillemets
    assert.deepEqual([...mentionnes('var d = { \'heavy\': true };')], ['fx_toolgauge'])
  })

  it('aucun module ne mentionne le nom d\'un outil dans son code sans que la détection le compte, sur chaque texte que le filtre peut rendre', function () {
    this.timeout(300000)
    const modules = readdirSync(RUNTIME).filter((f) => /^mjs_fx_[a-z0-9_]+\.ts$/.test(f))
    let textes = 0
    let trie   = 0
    for (const f of modules) {
      for (const [rendu, texte] of rendus(f)) {
        textes++
        if (rendu !== 'fichier entier') trie++
        const absents = manques(texte, FX_TOOLS, f)
        assert.deepEqual(absents, [], f + ' (' + rendu + ') nomme ' + absents.join(', ') + ' d\'une façon que fx-tools.ts ne compte pas : l\'outil ne serait pas embarqué')
      }
    }
    // la garde ne doit pas dormir : le banc a bien lu les fichiers entiers et leurs textes triés, au moins un outil nommé dans chaque famille
    assert.ok(modules.length > 100, 'modules lus : ' + modules.length)
    assert.ok(trie > 50, 'textes triés lus : ' + trie + ' sur ' + textes)
    const nommes = new Set(modules.flatMap((f) => [...mentionnes(lire(f))]))
    for (const k of FX_TOOL_KEYS.filter((k) => FX_TOOLS[k].effects.length > 0)) assert.ok(nommes.has(k), k + ' : la table range des effets sous cet outil, le témoin n\'en voit aucun le nommer')
  })

  it('aucun module ne bâtit à l\'exécution un nom `_mjs_…` (`\'_mjs_fx\' + n`, `_mjs_fx${n}`) : un nom écrit nulle part ne se reconnaît pas, l\'outil ne serait pas embarqué', () => {
    for (const f of readdirSync(RUNTIME).filter((f) => /^mjs_fx_[a-z0-9_]+\.ts$/.test(f))) {
      const texte = lire(f)
      if (!texte.includes('_mjs_')) continue
      const source = ts.createSourceFile(f, texte, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
      const visite = (n: ts.Node): void => {
        const bati = (ts.isTemplateExpression(n) && n.head.text.includes('_mjs_')) || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && ts.isStringLiteralLike(n.left) && n.left.text.startsWith('_mjs_'))
        assert.ok(!bati, f + ' : `' + n.getText(source).slice(0, 60) + '` bâtit un nom `_mjs_…` à l\'exécution')
        ts.forEachChild(n, visite)
      }
      visite(source)
    }
  })

  it('garde anti-oubli : un effet qui appelle un outil est dans la liste de cet outil', () => {
    const effets = readdirSync(RUNTIME).filter((f) => /^mjs_fx_[a-z0-9_]+\.ts$/.test(f) && !/^mjs_fx_tool[a-z]+\.ts$/.test(f))
    for (const f of effets) {
      const texte = readFileSync(join(RUNTIME, f), 'utf-8')
      const cle   = f.slice(4, -3)
      for (const outil of fxToolsCalled(texte)) {
        assert.ok(FX_TOOLS[outil].effects.includes(cle), f + ' appelle ' + outil + ' sans être dans sa liste (bundler/fx-tools.ts) : la liste sert quand le fichier de l\'effet est illisible')
      }
    }
  })

  it('garde anti-oubli, l\'autre sens : un effet inscrit dans la liste d\'un outil l\'appelle bien (sinon l\'outil pèse pour rien dans sa page)', () => {
    for (const [outil, t] of Object.entries(FX_TOOLS)) {
      for (const cle of t.effects) {
        const source = join(RUNTIME, 'mjs_' + cle + '.ts')
        assert.ok(existsSync(source), outil + ' liste ' + cle + ', qui n\'a pas de fichier')
        assert.ok(fxToolsCalled(readFileSync(source, 'utf-8')).has(outil), cle + ' est dans la liste de ' + outil + ' mais ne l\'appelle pas : la liste mentirait quand le fichier de l\'effet est illisible')
      }
    }
  })

  it('les effets de la garde de cadence sont exactement les effets lourds du code (heavy: true), ni plus ni moins', () => {
    const effets = readdirSync(RUNTIME).filter((f) => /^mjs_fx_[a-z0-9_]+\.ts$/.test(f) && !/^mjs_fx_tool[a-z]+\.ts$/.test(f))
    const lourds = effets.filter((f) => /\bheavy: true\b/.test(readFileSync(join(RUNTIME, f), 'utf-8'))).map((f) => f.slice(4, -3)).sort()
    assert.deepEqual([...FX_TOOLS.fx_toolgauge.effects].sort(), lourds)
  })

  it('les effets de la reprise du décor sont exactement ceux qui déclarent le décor (decor: true), ni plus ni moins', () => {
    const effets = readdirSync(RUNTIME).filter((f) => /^mjs_fx_[a-z0-9_]+\.ts$/.test(f) && !/^mjs_fx_tool[a-z]+\.ts$/.test(f))
    const decor  = effets.filter((f) => /\bdecor: true\b/.test(readFileSync(join(RUNTIME, f), 'utf-8'))).map((f) => f.slice(4, -3)).sort()
    assert.deepEqual([...FX_TOOLS.fx_toolkeep.effects].sort(), decor)
  })

  it('les effets de l\'outil du texte sont exactement ceux qui appellent l\'un de ses noms (le calque, les lettres, la place d\'un nombre), ni plus ni moins : les onze effets qui travaillent le texte de leur balise', () => {
    const effets = readdirSync(RUNTIME).filter((f) => /^mjs_fx_[a-z0-9_]+\.ts$/.test(f) && !/^mjs_fx_tool[a-z]+\.ts$/.test(f))
    const texte  = effets.filter((f) => fxToolsCalled(readFileSync(join(RUNTIME, f), 'utf-8')).has('fx_tooltext')).map((f) => f.slice(4, -3)).sort()
    assert.deepEqual([...FX_TOOLS.fx_tooltext.effects].sort(), texte)
    assert.deepEqual(texte, ['fx_bounce', 'fx_circular', 'fx_count', 'fx_cycle', 'fx_delta', 'fx_marquee', 'fx_rainbow', 'fx_scramble', 'fx_stagger', 'fx_wave', 'fx_weight'])
  })

  it('l\'outil du texte définit exactement six noms, chacun le réclame, et le moteur n\'en définit aucun', () => {
    const noms = ['_mjs_fxLayer', '_mjs_fxLetters', '_mjs_fxNumWidth', '_mjs_fxOrderCss', '_mjs_fxRanks', '_mjs_fxSplit']
    assert.deepEqual(definis('fx_tooltext').sort(), noms)
    for (const n of noms) assert.deepEqual([...fxToolsCalled('var f = µ.' + n + ';')], ['fx_tooltext'], n)
    assert.deepEqual(noms.filter((n) => lire('mjs_fx.ts').includes('µ.' + n + ' = ')), [], 'le moteur ne définit plus ce que l\'outil du texte porte')
  })

  it('le calque de texte ne vient qu\'avec un effet qui travaille le texte de sa balise, en production comme en développement ; jamais avec un autre effet, ni sans effet', () => {
    const avec = (k: string, prod: boolean) => outils(new Bundler(prod ? { i18n: { default: 'fr' }, env: 'prod' } as any : { i18n: { default: 'fr' } }).resolveRuntimeFiles(new Set(['fx', k])).files)
    for (const k of FX_TOOLS.fx_tooltext.effects) {
      assert.ok(avec(k, false).includes('fx_tooltext'), k + ' en développement')
      assert.ok(avec(k, true).includes('fx_tooltext'), k + ' en production')
    }
    for (const k of ['fx_neon', 'fx_tilt', 'fx_underline', 'fx_split', 'fx_glitch', 'fx_flash', 'fx_gauge', 'fx_fluid', 'fx_spotlight', 'fx_pointer', 'fx_scratch', 'fx_filter']) {
      assert.ok(!avec(k, false).includes('fx_tooltext'), k + ' en développement')
      assert.ok(!avec(k, true).includes('fx_tooltext'), k + ' en production')
    }
    for (const used of [new Set<string>(), new Set(['fx'])]) assert.deepEqual(outils(new Bundler({ i18n: { default: 'fr' }, env: 'prod' } as any).resolveRuntimeFiles(used).files), [])
  })

  it('le calque de texte vient seul, sans les autres outils, avec un effet de texte qui ne défile pas (la liste des outils d\'un effet de lettres est celle du calque ; *weight et *delta, qui remesurent après un chargement de police, y ajoutent la reprise des polices)', () => {
    for (const k of ['fx_rainbow', 'fx_bounce', 'fx_wave', 'fx_weight', 'fx_scramble', 'fx_count', 'fx_delta', 'fx_cycle', 'fx_circular']) {
      const attendus = k === 'fx_weight' || k === 'fx_delta' ? ['fx_tooltext', 'fx_toolfonts'] : ['fx_tooltext']
      assert.deepEqual(outils(new Bundler({ i18n: { default: 'fr' }, env: 'prod' } as any).resolveRuntimeFiles(new Set(['fx', k])).files), attendus, k)
    }
  })

  it('l\'expression qui reconnaît la mention d\'un outil reconnaît tous les noms qu\'il définit, sous chacune des formes', () => {
    for (const [outil, t] of Object.entries(FX_TOOLS)) {
      const noms = definis(outil)
      assert.ok(noms.length > 0, outil)
      for (const n of noms) {
        for (const [forme, code] of FORMES) assert.ok(fxToolsCalled(code.replaceAll('_mjs_fxRoots', n), FX_TOOLS).has(outil), outil + ' : ' + n + ' n\'est pas reconnu (' + forme + ')')
        assert.ok(t.uses.test(n), outil + ' : ' + n + ' n\'est pas reconnu seul')
      }
    }
  })
})
