// les messages du développement seul ne partent pas en production
//
// un message du développement seul (conseil d'écriture, mauvaise utilisation que la construction de développement signale déjà, ou
// message qui ne peut s'écrire qu'en développement) a sa clé dans DEV_ONLY_MESSAGES (bundler/minify.ts) ou dans le groupe `dev` des
// libellés : dès que le niveau de console de production retire les traces ('warn', 'error' — le défaut —, 'silent'), la construction
// retire du code envoyé chaque appel µ.warn / µ.error du runtime qui lit l'un de ces textes, avec ses arguments, et ces textes des
// fichiers de messages. Au niveau 'log', rien ne part ; la construction de développement les garde tous, texte compris
//
// trois parties : la liste suit les sources du runtime (relues par acorn) ; le réécrivain, prouvé sur du texte écrit pour l'occasion ;
// une construction réelle d'une appli qui écrit µevery (mjs_every.ts au cœur : quatre messages du développement seul, cinq de production)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import * as minify from '../src/bundler/minify.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const { DEV_ONLY_MESSAGES, TRACE_READ_MESSAGES, cutRuntimeTraces, runtimeCallsCut, messagesWithoutTraces, minifyJs } = minify as any

const SRC         = join(dirname(fileURLToPath(import.meta.url)), '../src')
const RUNTIME_DIR = join(SRC, 'runtime')

const estMu     = (n: any): boolean => n?.type === 'Identifier' && n.name === 'µ'
const estMembre = (n: any, nom: string): boolean => n?.type === 'MemberExpression' && !n.computed && estMu(n.object) && n.property.name === nom

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap(n => statSync(join(dossier, n)).isDirectory() ? fichiers(join(dossier, n)) : [join(dossier, n)]).sort()
}

// pour chaque clé lue par µ._mjs_txt / µ._mjs_msg dans le runtime : l'appel console le plus proche qui l'enveloppe (`warn`, `error`,
// `log`, `logger`, ou `autre` hors de tout appel), et le nombre de chaînes littérales de chaque valeur
function relever(): { lectures: Map<string, string[]>, litteraux: Map<string, number> } {
  const lectures  = new Map<string, string[]>()
  const litteraux = new Map<string, number>()
  for (const chemin of fichiers(RUNTIME_DIR).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))) {
    const ast    = acorn.parse(readFileSync(chemin, 'utf-8'), { ecmaVersion: 'latest', sourceType: 'module' }) as any
    const appels: Array<{ n: any, m: string }> = []
    walk.full(ast, (n: any) => {
      if (n.type === 'Literal' && typeof n.value === 'string') litteraux.set(n.value, (litteraux.get(n.value) ?? 0) + 1)
      if (n.type !== 'CallExpression') return
      const m = ['warn', 'error', 'log'].find(x => estMembre(n.callee, x))
      if (!n.optional && m) appels.push({ n, m })
      else if (n.optional && n.callee.type === 'CallExpression' && estMembre(n.callee.callee, '_mjs_logger')) appels.push({ n, m: 'logger' })
    })
    walk.full(ast, (n: any) => {
      if (n.type !== 'CallExpression' || !(estMembre(n.callee, '_mjs_txt') || estMembre(n.callee, '_mjs_msg'))) return
      const a = n.arguments[0]
      if (!(a?.type === 'Literal' && typeof a.value === 'string')) return
      const proche = appels.filter(c => c.n.arguments.some((x: any) => x.start <= n.start && n.end <= x.end)).sort((x, y) => (x.n.end - x.n.start) - (y.n.end - y.n.start))[0]
      lectures.set(a.value, [...(lectures.get(a.value) ?? []), `${proche ? proche.m : 'autre'}@${relative(RUNTIME_DIR, chemin)}`])
    })
  }
  return { lectures, litteraux }
}

describe('messages du développement seul — la liste de la construction suit les sources', () => {
  const { lectures, litteraux } = relever()
  const ailleurs = fichiers(SRC).filter(f => /\.(ts|mjs|js)$/.test(f) && !f.startsWith(RUNTIME_DIR + '/') && !/(^|\/)(runtime-labels\.ts|bundler\/minify\.ts)$/.test(relative(SRC, f))).map(f => [relative(SRC, f), readFileSync(f, 'utf-8')] as const)

  it('chaque clé de la liste est lue par le runtime, et seulement dans les arguments d\'un µ.warn ou d\'un µ.error (le build retire cet appel)', () => {
    const fautes = DEV_ONLY_MESSAGES.filter((k: string) => (lectures.get(k) ?? ['jamais lue']).some(l => !/^(warn|error)@/.test(l)))
    assert.deepEqual(fautes, [])
  })

  it('aucune clé de la liste n\'est nommée ailleurs : ni hors d\'une lecture dans le runtime, ni par une autre source du framework', () => {
    assert.deepEqual(DEV_ONLY_MESSAGES.filter((k: string) => litteraux.get(k) !== lectures.get(k)?.length), [], 'runtime')
    assert.deepEqual(DEV_ONLY_MESSAGES.filter((k: string) => ailleurs.some(([, t]) => ['\'', '"', '`'].some(q => t.includes(q + k + q)))), [], 'autres sources')
  })

  it('chaque clé existe en français et en anglais, aucune n\'est un texte de trace, aucune n\'est en double', () => {
    for (const lang of ['fr', 'en'] as const) assert.deepEqual(DEV_ONLY_MESSAGES.filter((k: string) => typeof (RUNTIME_LABELS[lang].err as Record<string, string>)[k] !== 'string'), [], lang)
    assert.deepEqual(DEV_ONLY_MESSAGES.filter((k: string) => TRACE_READ_MESSAGES.includes(k)), [])
    assert.equal(new Set(DEV_ONLY_MESSAGES).size, DEV_ONLY_MESSAGES.length)
  })

  it('les avis connus du développement en font partie, les pannes vues par le visiteur non', () => {
    for (const k of ['everyInit', 'everyUnknownOpt', 'vtUnknownKey', 'ujsVerbUnknown', 'i18nMissing']) assert.ok(DEV_ONLY_MESSAGES.includes(k), k)
    for (const k of ['everyError', 'everyOptType', 'fxLoad', 'lazyCss', 'storeGKey', 'ujsSubmitFailed', 'i18nLoadLang']) assert.ok(!DEV_ONLY_MESSAGES.includes(k), k)
  })
})

describe('messages du développement seul — le réécrivain, prouvé sur du texte écrit pour l\'occasion', () => {
  const LIGNES = [
    'µ.warn(µ._mjs_msg(\'everyInit\', null, \'a\'));',
    'µ.warn(µ._mjs_msg(\'everyOptType\', { opt: o }, \'b\'), v, µ._mjs_txt(\'everyIgnored\', null, \'c\'));',
    'if (x) µ.warn(\'[x] \' + µ._mjs_txt(\'ujsVerbUnknown\', { verb: (v) }));',
    'µ.error(µ._mjs_msg(\'fxLoad\', { name: n }));',
    'µ.warn(µ._mjs_msg(\'dev.autosizeField\', { tag: t }), el);',
    'µ.error(µ._mjs_msg("vtDupKey", { key: k }));',
    'var s = "µ.warn(µ._mjs_msg(\'everyInit\'))"; // µ.warn(µ._mjs_msg(\'everyInit\'))',
    'µ._mjs_logger()?.(µ._mjs_txt(\'routerLogInit\'));',
  ]
  const TEXTE = LIGNES.join('\n')
  const coupee = (sortie: string, i: number) => sortie.split('\n')[i] !== LIGNES[i]

  it('avec `dev` : seuls les appels qui lisent un message du développement seul (liste ou groupe dev) sont réécrits, où que la clé soit dans les arguments', () => {
    const sortie = cutRuntimeTraces(TEXTE, ['log', 'dev'])
    assert.deepEqual(LIGNES.map((_l, i) => coupee(sortie, i)), [true, false, true, false, true, true, false, true])
    assert.equal(sortie.split('\n')[0], 'MJS_TRACE?.(µ._mjs_msg(\'everyInit\', null, \'a\'));')
    assert.equal(sortie.split('\n')[2], 'if (x) MJS_TRACE?.(\'[x] \' + µ._mjs_txt(\'ujsVerbUnknown\', { verb: (v) }));')
  })

  it('sans `dev` : rien de plus que les méthodes nommées', () => {
    const sortie = cutRuntimeTraces(TEXTE, ['log'])
    assert.deepEqual(LIGNES.map((_l, i) => coupee(sortie, i)), [false, false, false, false, false, false, false, true])
  })

  it('les niveaux de production qui retirent les traces retirent aussi les messages du développement ; \'log\' ne retire rien', () => {
    assert.deepEqual(runtimeCallsCut('log'), [])
    for (const [niveau, journal] of [['warn', true], ['error', true], ['silent', true], ['silent', false]] as const) assert.ok(runtimeCallsCut(niveau, journal).includes('dev'), niveau)
  })

  it('minifyJs du runtime au niveau \'warn\' : les appels du développement partent avec leurs arguments ; en développement, tout reste', async () => {
    const prod = (await minifyJs(TEXTE, { force: true, runtimeSource: true, logLevel: 'warn' })).code
    for (const k of ['everyInit', 'ujsVerbUnknown', 'autosizeField', 'vtDupKey']) assert.equal(prod.replace(/var s=.*$/m, '').includes(k), false, k)
    for (const k of ['everyOptType', 'everyIgnored', 'fxLoad']) assert.ok(prod.includes(k), k)
    const dev = (await minifyJs(TEXTE, { force: true, runtimeSource: true, dev: true })).code
    for (const k of ['everyInit', 'ujsVerbUnknown', 'autosizeField', 'vtDupKey', 'everyOptType', 'fxLoad', 'routerLogInit']) assert.ok(dev.includes(k), k)
  })

  it('messagesWithoutTraces : les textes du développement seul partent à tout niveau qui retire les traces, la table d\'origine reste intacte', () => {
    const table = RUNTIME_LABELS.fr.err as Record<string, string>
    const avant = Object.keys(table).length
    for (const niveau of ['warn', 'error', 'silent'] as const) {
      const reste = messagesWithoutTraces(table, niveau)
      assert.deepEqual(DEV_ONLY_MESSAGES.filter((k: string) => k in reste), [], niveau)
      assert.ok(reste['fxLoad'] && reste['ifDestroy'], niveau)
    }
    assert.ok(messagesWithoutTraces(table, 'warn')['everyOptType'] && messagesWithoutTraces(table, 'warn')['lazyCss'], 'un avertissement de production garde son texte au niveau \'warn\'')
    assert.equal(Object.keys(table).length, avant)
  })
})

// construction réelle : une page qui écrit µevery embarque mjs_every.ts au cœur
const DEVELOPPEMENT = ['everyInit', 'everyHash', 'everyUnknownOpt', 'everyWhileAsync']
const PRODUCTION    = ['everySyntax', 'everyOptType', 'everyTimes', 'everyIgnored', 'everyError']

interface Built { code: string, coeur: string, messagesFr: Record<string, string> }

async function build(opts: Record<string, unknown>): Promise<Built> {
  const root   = mjsTmp('messages-developpement')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'dist', 'assets')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'app.page.mjs'), ['<script lang="coffee">', '@x = 1', 'µevery 1000, -> @x++', '</script>', '<p>{$x}</p>'].join('\n') + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), ...opts } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).sort()
  const lire  = (f: string) => readFileSync(join(outDir, f), 'utf-8')
  const fr    = files.find(f => /^mjs_err-fr-.*\.json$/.test(f))
  const coeur = files.find(f => /^mjs_core.*\.js$/.test(f))
  return { code: files.filter(f => f.endsWith('.js')).map(lire).join('\n'), coeur: coeur ? lire(coeur) : '', messagesFr: fr ? JSON.parse(lire(fr)) : {} }
}

describe('messages du développement seul — construction réelle (µevery au cœur)', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const built: Record<string, Built> = {}
  before(async () => {
    built['prod-warn'] = await build({ env: 'prod', logLevel: { prod: 'warn' } })
    built['défaut']    = await build({ env: 'prod' })
    built['prod-log']  = await build({ env: 'prod', logLevel: { prod: 'log' } })
    built['dev']       = await build({ env: 'dev' })
  })

  it('la page embarque bien mjs_every.ts (la lecture ne passe pas à vide)', () => {
    assert.ok(built['dev'].coeur.includes('everyInit') && built['prod-warn'].coeur.includes('everyError'))
  })

  it('production au niveau \'warn\' : ni l\'appel ni le texte d\'un message du développement ; ceux de production restent', () => {
    const { code, messagesFr } = built['prod-warn']
    assert.deepEqual(DEVELOPPEMENT.filter(k => code.includes(k)), [], 'appels dans le code envoyé')
    assert.deepEqual(DEVELOPPEMENT.filter(k => k in messagesFr), [], 'textes dans le fichier de messages')
    assert.deepEqual(PRODUCTION.filter(k => !code.includes(k)), [], 'appels de production')
    assert.deepEqual(PRODUCTION.filter(k => !(k in messagesFr)), [], 'textes de production')
  })

  it('production au défaut : aucun message du développement, ni appel ni texte ; les textes des erreurs restent', () => {
    const { code, messagesFr } = built['défaut']
    assert.deepEqual(DEVELOPPEMENT.filter(k => code.includes(k) || k in messagesFr), [])
    assert.ok(messagesFr['fxLoad'] && messagesFr['ifDestroy'])
  })

  it('production au niveau \'log\' : rien ne part, appels et textes', () => {
    const { code, messagesFr } = built['prod-log']
    assert.deepEqual([...DEVELOPPEMENT, ...PRODUCTION].filter(k => !code.includes(k) || !(k in messagesFr)), [])
  })

  it('développement : chaque appel reste, avec son texte de secours', () => {
    const { coeur } = built['dev']
    assert.deepEqual([...DEVELOPPEMENT, ...PRODUCTION].filter(k => !coeur.includes(k)), [])
    assert.ok(coeur.includes('µevery doit être appelé'), 'le texte du message est dans le cœur de développement')
  })
})
