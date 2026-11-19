// une clé que seul un bloc du développement du runtime lit — `<wait-dev>` (`awaitedRefused`, l'erreur d'une réponse que la règle du
// <vars> refuse, mjs_await_derived.ts) ou `<derived-check>` (`typesDerived`, une variable dérivée hors de sa règle, mjs_types.ts ;
// `derivedPrecise` et `derivedAccessor`, une valeur dérivée qui a servi un calcul que son recalcul dément, mjs_element.ts) : aucune construction
// de production n'emporte ces blocs, ces messages ne peuvent pas s'y écrire ; leur texte quitte donc les fichiers de messages de
// production à TOUS les niveaux de console, 'log' compris ; la table d'origine, que lit le développement, le garde

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as minify from '../src/bundler/minify.js'
import { runtimeMessagesFor } from '../src/runtime-labels.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const { messagesWithoutTraces, messagesWithoutDevBlocks, DEV_BLOCK_MESSAGES, DEV_ONLY_MESSAGES } = minify as any
const RUNTIME  = new URL('../src/runtime/', import.meta.url)
const SOURCES  = readdirSync(RUNTIME).filter((n) => n.endsWith('.ts')).map((n) => [n, readFileSync(new URL(n, RUNTIME), 'utf8')] as const)
const BLOCK_RE = /\/\/ <(wait-dev|derived-check)>\n[\s\S]*?\/\/ <\/\1>/g
const KEYS     = ['awaitedRefused', 'derivedAccessor', 'derivedPrecise', 'typesDerived']

// une appli dont le cœur porte les deux blocs : une dérivée réglée (mjs_types.ts) et une dérivée qui attend sous sa règle (mjs_await_derived.ts)
const APP = [
  '<vars>',
  '  $total  int 0..100',
  '  $r      int 0..100',
  '</vars>',
  '',
  '<script>',
  '  $a      = 80',
  '  $q      = 0',
  '  $total  = $a * 2',
  '  load    = (q) -> Promise.resolve(30)',
  '  $r      = await load($q)',
  '</script>',
  '',
  '<p>{$total} {$r}</p>',
].join('\n') + '\n'

interface Built { code: string, messages: Record<string, Record<string, string>> }

async function build(name: string, opts: Record<string, unknown>): Promise<Built> {
  const root   = mjsTmp(name)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'dist', 'assets')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derived.mjs'), APP)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files    = readdirSync(outDir).sort()
  const read     = (f: string) => readFileSync(join(outDir, f), 'utf-8')
  const messages = {} as Record<string, Record<string, string>>
  for (const lang of ['fr', 'en']) {
    const file = files.find(f => new RegExp(`^mjs_err-${lang}-.*\\.json$`).test(f))
    if (file) messages[lang] = JSON.parse(read(file))
  }
  return { code: files.filter(f => f.endsWith('.js')).map(read).join('\n'), messages }
}

describe('messages lus par un seul bloc du développement (<wait-dev>, <derived-check>) : hors des fichiers de messages de production', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la liste porte les quatre clés ; chacune est lue dans un de ces blocs, et nulle part ailleurs dans le runtime', () => {
    assert.deepEqual([...DEV_BLOCK_MESSAGES].sort(), KEYS)
    for (const k of DEV_BLOCK_MESSAGES) {
      const inside = SOURCES.filter(([, t]) => (t.match(BLOCK_RE) ?? []).some((b) => b.includes(`µ._mjs_msg('${k}'`)))
      assert.ok(inside.length > 0, `${k} : aucune lecture dans un bloc <wait-dev> ou <derived-check>`)
      for (const [n, t] of SOURCES) assert.ok(!t.replace(BLOCK_RE, '').includes(`'${k}'`), `${k} nommé hors d'un bloc du développement (${n})`)
      assert.ok(!DEV_ONLY_MESSAGES.includes(k), `${k} est aussi dans DEV_ONLY_MESSAGES`)
    }
  })

  it('les aides de la construction : le texte part à chaque niveau, \'log\' compris, en français et en anglais ; la table d\'origine le garde', () => {
    for (const lang of ['fr', 'en']) {
      const table = runtimeMessagesFor(lang, new Set(['mjs_await_derived.ts', 'mjs_types.ts']))
      for (const k of KEYS) assert.equal(typeof table[k], 'string', `${lang} : ${k} absent de la table`)
      const rests = [['log', messagesWithoutDevBlocks(table)], ...['warn', 'error', 'silent'].map((level) => [level, messagesWithoutTraces(table, level)])]
      for (const [level, rest] of rests) {
        assert.deepEqual(KEYS.filter((k) => k in rest), [], `${lang}, ${level}`)
        for (const k of KEYS) assert.equal(typeof table[k], 'string', `${lang}, ${level} : table d'origine intacte`)
      }
      // au niveau 'log', rien d'autre ne part
      assert.deepEqual(Object.keys(table).filter((k) => !(k in messagesWithoutDevBlocks(table)) && !KEYS.includes(k)), [], `${lang}, log`)
    }
  })

  it('construction réelle : en production, à chaque niveau de console, ni le code ni le texte de ces messages ; en développement, tout reste', async () => {
    const dev = await build('dev-block-messages-dev', { env: 'dev' })
    for (const k of KEYS) assert.ok(dev.code.includes(`'${k}'`), `garde muette : le cœur de développement de cette appli lit ${k}`)
    const levels: Array<[string, Record<string, unknown>]> = [['log', { logLevel: { prod: 'log' } }], ['défaut', {}], ['warn', { logLevel: { prod: 'warn' } }], ['silent', { logLevel: { prod: 'silent' } }]]
    const sizes = {} as Record<string, number>
    for (const [level, opts] of levels) {
      const prod = await build('dev-block-messages-' + level.replace(/\W/g, ''), { env: 'prod', ...opts })
      for (const k of KEYS) assert.equal(prod.code.includes(k), false, `${level} : le code envoyé nomme ${k}`)
      for (const lang of ['fr', 'en']) {
        assert.ok(prod.messages[lang] && Object.keys(prod.messages[lang]).length > 0, `${level} : fichier de messages ${lang} absent`)
        assert.deepEqual(KEYS.filter((k) => k in prod.messages[lang]), [], `${level}, ${lang}`)
      }
      sizes[level] = Object.keys(prod.messages.fr).length
    }
    // au niveau 'log', les textes des traces et des avertissements restent : le fichier est plus complet qu'au niveau 'warn'
    assert.ok(sizes.log > sizes.warn, JSON.stringify(sizes))
  })
})
