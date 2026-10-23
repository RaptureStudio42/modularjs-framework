// les clés du groupe `err` que lisent les traces du runtime, relevées dans les sources par acorn : la liste que la
// construction retire des fichiers de messages (traces coupées) et pose au manifeste (traces gardées) est exactement celle-là
//
// une trace est un appel `µ.log(…)` ou `µ._mjs_logger()?.(…)` ; elle lit un texte par `µ._mjs_txt('clé', …)`. une clé
// lue par une trace et par rien d'autre ne sert plus à personne quand les traces partent ; une clé lue aussi par un
// avertissement doit rester. si cette liste se désaccorde du runtime, un avertissement perdrait son texte, ou un texte
// mort resterait dans les fichiers de messages

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { TRACE_ONLY_MESSAGES, TRACE_READ_MESSAGES, levelCutsTraces, messagesWithoutTraces, traceMessages, traceKeysIn } from '../src/bundler/minify.js'

const SRC         = join(dirname(fileURLToPath(import.meta.url)), '../src')
const RUNTIME_DIR = join(SRC, 'runtime')

const estMu     = (n: any): boolean => n?.type === 'Identifier' && n.name === 'µ'
const estMembre = (n: any, nom: string): boolean => n?.type === 'MemberExpression' && !n.computed && estMu(n.object) && n.property.name === nom

interface Releve {
  dansTrace: Map<string, Set<string>>
  horsTrace: Map<string, Set<string>>
  calculees: string[]
}

// les clés lues par `µ._mjs_txt` / `µ._mjs_msg` dans les fichiers du runtime, selon que l'appel est ou non dans les
// arguments d'une trace
function relever(): Releve {
  const dansTrace = new Map<string, Set<string>>()
  const horsTrace = new Map<string, Set<string>>()
  const calculees: string[] = []
  const noter = (m: Map<string, Set<string>>, cle: string, fichier: string) => { if (!m.has(cle)) m.set(cle, new Set()); m.get(cle)!.add(fichier) }
  for (const fichier of readdirSync(RUNTIME_DIR).filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts')).sort()) {
    const code = readFileSync(join(RUNTIME_DIR, fichier), 'utf-8')
    const ast  = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as any
    const traces: any[] = []
    walk.full(ast, (n: any) => {
      if (n.type !== 'CallExpression') return
      if (!n.optional && estMembre(n.callee, 'log')) traces.push(n)
      else if (n.optional && n.callee.type === 'CallExpression' && n.callee.arguments.length === 0 && estMembre(n.callee.callee, '_mjs_logger')) traces.push(n)
    })
    const dedans = (n: any) => traces.some((t) => t.arguments.some((a: any) => a.start <= n.start && n.end <= a.end))
    walk.full(ast, (n: any) => {
      if (n.type !== 'CallExpression' || !(estMembre(n.callee, '_mjs_txt') || estMembre(n.callee, '_mjs_msg'))) return
      const a = n.arguments[0]
      if (a?.type === 'Literal' && typeof a.value === 'string') noter(dedans(n) ? dansTrace : horsTrace, a.value, fichier)
      else calculees.push(`${fichier} : ${code.slice(n.start, Math.min(n.end, n.start + 50))}`)
    })
  }
  return { dansTrace, horsTrace, calculees }
}

const trier = (cles: Iterable<string>) => [...cles].sort()

describe('messages lus par les traces du runtime — la liste de la construction suit les sources', () => {
  const releve = relever()

  it('les clés qu\'une trace lit sont exactement TRACE_READ_MESSAGES', () => {
    assert.deepEqual(trier(releve.dansTrace.keys()), trier(TRACE_READ_MESSAGES))
  })

  it('les clés que seules des traces lisent sont exactement TRACE_ONLY_MESSAGES', () => {
    const seules = [...releve.dansTrace.keys()].filter((k) => !releve.horsTrace.has(k))
    assert.deepEqual(trier(seules), trier(TRACE_ONLY_MESSAGES))
  })

  it('aucune clé n\'est calculée hors des deux appels de l\'assistant du cœur (mjs_init.ts) : une clé calculée échapperait à la liste', () => {
    assert.deepEqual(releve.calculees.filter((c) => !c.startsWith('mjs_init.ts')), [])
  })

  it('aucune autre source du framework ne nomme une clé que seules des traces lisent', () => {
    const fautes: string[] = []
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom)
        if (statSync(chemin).isDirectory()) { parcourir(chemin); continue }
        const rel = relative(SRC, chemin)
        if (rel === 'runtime-labels.ts' || rel === 'runtime/mjs_router.ts' || rel === 'runtime/mjs_await.ts' || rel === 'runtime/mjs_socket.ts' || rel === 'runtime/mjs_state.ts' || rel === 'runtime/mjs_smooth.ts' || rel === 'bundler/minify.ts' || !/\.(ts|mjs|js)$/.test(nom)) continue
        const texte = readFileSync(chemin, 'utf-8')
        for (const cle of TRACE_ONLY_MESSAGES) if (texte.includes(cle)) fautes.push(`${rel} : ${cle}`)
      }
    }
    parcourir(SRC)
    assert.deepEqual(fautes, [])
  })

  it('chaque clé de la liste existe dans la table des messages, en français et en anglais', () => {
    for (const lang of ['fr', 'en'] as const) {
      const table = RUNTIME_LABELS[lang].err as Record<string, string>
      assert.deepEqual(TRACE_READ_MESSAGES.filter((k) => typeof table[k] !== 'string'), [], lang)
    }
  })

  it('les clés que seules des traces lisent sont aussi des clés lues par une trace', () => {
    assert.deepEqual(TRACE_ONLY_MESSAGES.filter((k) => !TRACE_READ_MESSAGES.includes(k)), [])
  })
})

describe('messages des traces — les aides de la construction', () => {
  const table = RUNTIME_LABELS.fr.err as Record<string, string>

  it('levelCutsTraces : tous les niveaux sauf log retirent les traces', () => {
    assert.equal(levelCutsTraces('log'), false)
    for (const niveau of ['warn', 'error', 'silent'] as const) assert.equal(levelCutsTraces(niveau), true, niveau)
  })

  it('messagesWithoutTraces : ôte les clés que seules des traces lisent, rien d\'autre, sans toucher à la table', () => {
    const avant = Object.keys(table).length
    const reste = messagesWithoutTraces(table)
    assert.equal(Object.keys(reste).length, avant - TRACE_ONLY_MESSAGES.length)
    for (const k of TRACE_ONLY_MESSAGES) assert.equal(k in reste, false, k)
    assert.ok(reste['ujsNoPage'], 'le texte que lit aussi un avertissement reste')
    assert.equal(Object.keys(table).length, avant, 'la table d\'origine est intacte')
  })

  it('traceMessages : ne rend que les clés demandées qui existent', () => {
    assert.deepEqual(traceMessages(table, ['routerLogInit', 'ujsNoPage', 'cleInconnue']), { routerLogInit: table.routerLogInit, ujsNoPage: table.ujsNoPage })
    assert.deepEqual(traceMessages(table, []), {})
  })

  it('traceKeysIn : les clés des traces que le texte du cœur nomme, dans l\'ordre de la liste', () => {
    assert.deepEqual(traceKeysIn('rien ici'), [])
    assert.deepEqual(traceKeysIn('µ._mjs_txt(\'routerLogInit\'); µ._mjs_txt(\'ujsNoPage\')'), ['routerLogInit', 'ujsNoPage'])
    assert.deepEqual(traceKeysIn('µ._mjs_txt(\'ujsNoPage\')'), ['ujsNoPage'])
  })
})
