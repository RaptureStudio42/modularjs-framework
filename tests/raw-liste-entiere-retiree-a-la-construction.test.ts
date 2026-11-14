// le carnet des listes marquées avec leurs lignes (`µraw(liste, true)`), sa lecture par `{for}` et le second argument de µraw ne servent
// qu'à l'appli qui écrit cet appel. Une construction de production qui ne l'écrit nulle part ne les emporte pas : µraw et la passe des
// lignes y gardent leur texte. Le relevé lit l'arbre du code compilé : un appel de µraw à un seul argument ne demande rien ; un second
// argument, quel qu'il soit, ou un usage qu'il ne sait pas compter (µraw passé comme valeur, appelé par `call`, tiré d'un motif, appelé
// sous un autre nom de µ, code illisible) garde le bloc — jamais un faux « non ». Il reste aussi dans tout build de développement, avec
// le cœur demandé tout entier, et quand la clé `runtime` nomme `rare_runes`

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as acorn from 'acorn'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures, scanRawRows, RAW_ROWS, FINE } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'

const LIST = '<ul>{for r in $l by id}<li>{r.t}</li>{end}</ul>'
const unit = (script: string, html = LIST) => `<script lang="js">\n${script}\n</script>\n${html}\n`

// µraw appelé avec un seul argument, sous toutes ses formes : rien à garder
const ONE_ARGUMENT: [string, string][] = [
  ['une liste', unit('$l = µ.raw([]);')],
  ['un objet littéral à virgules', unit('$l = µ.raw([]);\n@add = function() { $l = µ.raw([...$l, µ.raw({ id: 1, t: \'a, b\' })]); };')],
  ['un appel imbriqué à deux arguments', unit('const pair = (a, b) => [a, b];\n$l = µ.raw(pair(1, 2));')],
  ['une suite entre parenthèses', unit('let k = 0;\n$l = µ.raw((k++, []));')],
  ['un choix', unit('$l = µ.raw(Math.random() > 2 ? [1] : []);')],
  ['un texte qui cite l\'appel', unit('$l = µ.raw([]);\nconst doc = \'µ.raw(liste, true)\';')],
  ['un commentaire qui cite l\'appel', unit('$l = µ.raw([]); // µ.raw(liste, true)')],
  ['String.raw', unit('$l = µ.raw([]);\nconst t = String.raw`ab`;')],
  ['aucun µraw', unit('$l = [];')],
  ['la rune en Civet', '<script>\n$l = µraw([])\n</script>\n' + LIST + '\n'],
]
// un second argument, ou un usage que le relevé ne sait pas compter : le bloc reste
const SECOND_ARGUMENT: [string, string][] = [
  ['true', unit('$l = µ.raw([], true);')],
  ['une variable', unit('const all = true;\n$l = µ.raw([], all);')],
  ['des arguments étalés', unit('const args = [[], true];\n$l = µ.raw(...args);')],
  ['µraw passé comme valeur', unit('const mark = µ.raw;\n$l = mark([], true);')],
  ['µraw donné à map', unit('$l = [[1], [2]].map(µ.raw);')],
  ['call', unit('$l = µ.raw.call(null, [], true);')],
  ['apply', unit('$l = µ.raw.apply(null, [[], true]);')],
  ['chaînage optionnel', unit('$l = µ?.raw([], true);')],
  ['clé entre crochets', unit('$l = µ[\'raw\']([], true);')],
  ['par window', unit('$l = window.µ.raw([], true);')],
  ['tiré d\'un motif', unit('const { raw } = µ;\n$l = raw([], true);')],
  ['sous un autre nom de µ', unit('const m = µ;\n$l = m.raw([], true);')],
  ['dans le gabarit', unit('$l = [];', '<ul>{for r in µ.raw($l.slice(), true) by id}<li>{r.t}</li>{end}</ul>')],
  ['la rune en Civet', '<script>\n$l = µraw([], true)\n</script>\n' + LIST + '\n'],
]
const ROW_BY_ROW = ONE_ARGUMENT[1][1]
const WHOLE_LIST = SECOND_ARGUMENT[0][1]

// le code compilé d'un composant, et ses signaux comme le build les relève
const compiled = async (source: string) => (await transpile(source, { moduleName: 'c' })).output
const signals  = async (source: string) => scanCompiledFeatures(await compiled(source))

// le cœur assemblé, non minifié
const core = async (used: Set<string>, opts: Record<string, unknown> = {}) => {
  const out     = mjsTmp('lignes-brutes')
  const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), minify: false, ...opts } as any)
  const path    = await bundler.bundleRuntime(used)
  return path === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') as string : readFileSync(join(out, basename(path)), 'utf-8')
}

// le carnet, la note posée par µraw et sa lecture par la passe des lignes
const KEPT    = ['µ._mjs_rawRows = new WeakSet();', 'µ.raw = function(target, rows) {', 'if (rows === true) µ._mjs_rawRows.add(target);']
// µraw à un seul argument
const WITHOUT = ['µ.raw = function(target) {']
// la marque de la liste lue par la passe, et le saut d'une ligne pure, dans leurs quatre textes : mise à jour fine ou non, note ou non
const LIST_MARK = {
  plain:     'let __raw = µ._mjs_rawSet.has(col);',
  fine:      'let __raw = µ._mjs_rawSet.has(col) || _mjs_propre(this, cacheId);',
  noted:     'let __raw = µ._mjs_rawRows.has(items) ? 2 : µ._mjs_rawSet.has(col);',
  notedFine: 'let __raw = µ._mjs_rawRows.has(items) ? 2 : µ._mjs_rawSet.has(col) || _mjs_propre(this, cacheId);',
}
const SKIP_PLAIN = 'else if (raw && p && (p > 1 || en._mjs_ix === x) && (en._mjs_br || Object(it) !== it || µ._mjs_rawSet.has(it) && !it[µ._mjs_RAW] && (en._mjs_br = 1))) {'
const SKIP_TWO   = 'else if (raw && p && (p > 1 || en._mjs_ix === x) && (en._mjs_br || raw === 2 || Object(it) !== it || µ._mjs_rawSet.has(it) && !it[µ._mjs_RAW] && (en._mjs_br = 1))) {'

const all   = (text: string, marks: string[], what: string) => { for (const m of marks) assert.ok(text.includes(m), `${what} : « ${m} » manque`) }
const none  = (text: string, marks: string[], what: string) => { for (const m of marks) assert.ok(!text.includes(m), `${what} : « ${m} » est encore là`) }
const valid = (text: string) => assert.doesNotThrow(() => acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' }), 'le cœur n\'est plus du JavaScript valide')
const clean = (text: string) => assert.doesNotMatch(text, /^[ \t]*(?:\/\/ )+<\/?(?:sans-)?lignes-brutes>$/m, 'une marque du bloc lignes-brutes est restée')
// lignes de code (hors commentaire) qui commencent par ce texte
const lines = (text: string, start: string) => text.split('\n').filter((l) => l.trimStart().startsWith(start)).map((l) => l.trim())

describe('µraw(liste, true) : le carnet des listes marquées avec leurs lignes est retiré à la construction quand l\'appli n\'écrit pas cet appel', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  it('le relevé : µraw à un seul argument ne donne jamais le signal', async () => {
    for (const [what, source] of ONE_ARGUMENT) assert.ok(!(await signals(source)).has(RAW_ROWS), `${what} : donne le signal`)
    for (const js of ['export const x = 1', 'const a = µ.raw(rows)', 'const a = µ.raw({ a: 1, b: [2, 3] })', 'const t = String.raw`a`', 'const brut = reponse.raw', 'knex.raw(sql)']) assert.deepEqual(scanRawRows(js), [], js)
  })

  it('le relevé : un second argument, ou un usage qu\'il ne sait pas compter, donne le signal', async () => {
    for (const [what, source] of SECOND_ARGUMENT) assert.ok((await signals(source)).has(RAW_ROWS), `${what} : pas de signal`)
    // µ écrit par son échappement, et un code qu'acorn ne lit pas
    const escaped = 'const a = ' + String.fromCharCode(92) + 'u00B5.raw(rows, true)'
    for (const js of ['const a = µ.raw(rows, true)', 'const a = µ.raw(rows, false)', escaped, 'const a = µ.raw(rows) }{', 'const f = (m) => m.raw(rows, true)']) assert.deepEqual(scanRawRows(js), [RAW_ROWS], js)
  })

  it('production, appli qui marque ses lignes une à une : ni carnet, ni note, ni second argument — µraw et la passe gardent leur texte', async () => {
    const used = await signals(ROW_BY_ROW)
    assert.ok(used.has('rare_runes'), 'témoin : l\'appli écrit µraw')
    for (const [what, fine] of [['sans mise à jour fine', false], ['avec mise à jour fine', true]] as const) {
      const text = await core(fine ? new Set([...used, FINE]) : used, { env: 'prod' })
      none(text, [...KEPT, '_mjs_rawRows'], `production, ${what}`)
      all(text, WITHOUT, `production, ${what}`)
      assert.deepEqual(lines(text, 'let __raw = '), [fine ? LIST_MARK.fine : LIST_MARK.plain], `production, ${what} : la marque de la liste`)
      assert.deepEqual(lines(text, 'else if (raw && p && '), [fine ? SKIP_TWO : SKIP_PLAIN], `production, ${what} : le saut d'une ligne pure`)
      clean(text)
      valid(text)
    }
  })

  it('production, appli qui écrit µraw(liste, true) : carnet, note et lecture par la passe, sans leurs remplaçants', async () => {
    const used = await signals(WHOLE_LIST)
    for (const [what, fine] of [['sans mise à jour fine', false], ['avec mise à jour fine', true]] as const) {
      const text = await core(fine ? new Set([...used, FINE]) : used, { env: 'prod' })
      all(text, KEPT, `production, ${what}`)
      none(text, WITHOUT, `production, ${what}`)
      assert.deepEqual(lines(text, 'let __raw = '), [fine ? LIST_MARK.notedFine : LIST_MARK.noted], `production, ${what} : la marque de la liste`)
      assert.deepEqual(lines(text, 'else if (raw && p && '), [SKIP_TWO], `production, ${what} : le saut d'une ligne pure`)
      clean(text)
      valid(text)
    }
  })

  it('production avec le cœur demandé tout entier ou `rare_runes` nommé par la clé runtime, et développement : gardé', async () => {
    const used = await signals(ROW_BY_ROW)
    for (const [what, opts] of [['production, runtime: \'all\'', { env: 'prod', runtime: 'all' }], ['production, runtime: [\'rare_runes\']', { env: 'prod', runtime: ['rare_runes'] }], ['développement', {}]] as const) {
      const text = await core(used, opts as Record<string, unknown>)
      all(text, KEPT, what)
      none(text, WITHOUT, what)
      clean(text)
    }
  })

  it('une bibliothèque .js importée, qui reçoit µ et écrit l\'appel, garde le bloc', async () => {
    const root = mjsTmp('lignes-brutes-js')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'donnees.js'), 'export function build(m) { return m.raw([{ id: 1, t: \'a\' }], true); }\n')
    writeFileSync(join(src, 'hote.mjs'), unit('@import { build } \'./donnees.js\'\n$l = µ.raw([]);\n@fill = function() { $l = build(µ); };'))
    const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, 'bundle.js'), env: 'prod', minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const text = readdirSync(out).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(out, f), 'utf-8')).join('\n')
    assert.ok(!(await signals(readFileSync(join(src, 'hote.mjs'), 'utf-8'))).has(RAW_ROWS), 'témoin : le composant seul ne donne pas le signal')
    all(text, KEPT, 'production, appel écrit dans une bibliothèque .js importée')
  })
})
