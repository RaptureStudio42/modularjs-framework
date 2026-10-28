// les clés du groupe `err` que seuls des avertissements du runtime lisent, relevées dans les sources par acorn (animations
// comprises) : la liste que la construction retire des fichiers de messages aux niveaux 'error' et 'silent', où ces
// avertissements partent du code envoyé, est exactement celle-là
//
// un avertissement est un appel direct `µ.warn(…)` ; il lit un texte par `µ._mjs_txt('clé', …)` ou `µ._mjs_msg('clé', …)`.
// une clé lue aussi par une erreur, une trace, un module cœur, ou nommée ailleurs (une table, un autre fichier du framework)
// doit rester. si cette liste se désaccorde du runtime, une erreur perdrait son texte, ou un texte mort resterait dans les
// fichiers de messages

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { WARNING_ONLY_MESSAGES, TRACE_ONLY_MESSAGES, TRACE_READ_MESSAGES, DEV_ONLY_MESSAGES, messagesWithoutTraces } from '../src/bundler/minify.js'

const SRC         = join(dirname(fileURLToPath(import.meta.url)), '../src')
const RUNTIME_DIR = join(SRC, 'runtime')

const estMu     = (n: any): boolean => n?.type === 'Identifier' && n.name === 'µ'
const estMembre = (n: any, nom: string): boolean => n?.type === 'MemberExpression' && !n.computed && estMu(n.object) && n.property.name === nom

// les fichiers d'un dossier, sous-dossiers compris
function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap(n => statSync(join(dossier, n)).isDirectory() ? fichiers(join(dossier, n)) : [join(dossier, n)]).sort()
}

interface Lectures { avertissement: number, autre: number }

// pour chaque clé lue par `µ._mjs_txt` / `µ._mjs_msg` : combien de lectures dans les arguments d'un avertissement (l'appel
// console le plus proche qui l'enveloppe), combien ailleurs ; et le nombre de chaînes littérales de chaque valeur
function relever(): { lectures: Map<string, Lectures>, litteraux: Map<string, number>, calculees: string[] } {
  const lectures  = new Map<string, Lectures>()
  const litteraux = new Map<string, number>()
  const calculees: string[] = []
  for (const chemin of fichiers(RUNTIME_DIR).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))) {
    const code  = readFileSync(chemin, 'utf-8')
    const ast   = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as any
    const appels: Array<{ n: any, avertissement: boolean }> = []
    walk.full(ast, (n: any) => {
      if (n.type === 'Literal' && typeof n.value === 'string') litteraux.set(n.value, (litteraux.get(n.value) ?? 0) + 1)
      if (n.type !== 'CallExpression') return
      if (!n.optional && (estMembre(n.callee, 'warn') || estMembre(n.callee, 'error') || estMembre(n.callee, 'log'))) appels.push({ n, avertissement: estMembre(n.callee, 'warn') })
      else if (n.optional && n.callee.type === 'CallExpression' && n.callee.arguments.length === 0 && estMembre(n.callee.callee, '_mjs_logger')) appels.push({ n, avertissement: false })
    })
    const dansAvertissement = (n: any) => {
      const proches = appels.filter(a => a.n.arguments.some((x: any) => x.start <= n.start && n.end <= x.end)).sort((a, b) => (a.n.end - a.n.start) - (b.n.end - b.n.start))
      return proches.length > 0 && proches[0].avertissement
    }
    walk.full(ast, (n: any) => {
      if (n.type !== 'CallExpression' || !(estMembre(n.callee, '_mjs_txt') || estMembre(n.callee, '_mjs_msg'))) return
      const a = n.arguments[0]
      if (!(a?.type === 'Literal' && typeof a.value === 'string')) { calculees.push(`${relative(RUNTIME_DIR, chemin)} : ${code.slice(n.start, Math.min(n.end, n.start + 50))}`); return }
      const e = lectures.get(a.value) ?? { avertissement: 0, autre: 0 }
      if (dansAvertissement(n)) e.avertissement++
      else e.autre++
      lectures.set(a.value, e)
    })
  }
  return { lectures, litteraux, calculees }
}

const trier = (cles: Iterable<string>) => [...cles].sort()

describe('messages lus par les seuls avertissements du runtime — la liste de la construction suit les sources', () => {
  const { lectures, litteraux, calculees } = relever()
  // les autres sources du framework (compilateur, bundler, modules cœur…) : une clé qu'elles nomment reste
  const ailleurs = fichiers(SRC).filter(f => /\.(ts|mjs|js)$/.test(f) && !f.startsWith(RUNTIME_DIR + '/') && !/(^|\/)(runtime-labels\.ts|bundler\/minify\.ts)$/.test(relative(SRC, f))).map(f => [relative(SRC, f), readFileSync(f, 'utf-8')] as const)
  const nommeeAilleurs = (cle: string) => ailleurs.filter(([, t]) => ['\'', '"', '`'].some(q => t.includes(q + cle + q))).map(([r]) => r)

  it('les clés que seuls des avertissements lisent, et que rien d\'autre ne nomme, sont exactement WARNING_ONLY_MESSAGES', () => {
    const seules = [...lectures].filter(([cle, e]) => !cle.includes('.') && e.avertissement > 0 && e.autre === 0 && litteraux.get(cle) === e.avertissement && nommeeAilleurs(cle).length === 0).map(([cle]) => cle)
    assert.deepEqual(trier(seules), trier(WARNING_ONLY_MESSAGES))
  })

  it('aucune clé de la liste n\'est lue hors d\'un avertissement, ni nommée par une autre source du framework', () => {
    const fautes = WARNING_ONLY_MESSAGES.filter(cle => (lectures.get(cle)?.autre ?? 1) > 0 || nommeeAilleurs(cle).length > 0)
    assert.deepEqual(fautes, [])
  })

  it('aucune clé n\'est calculée hors des deux appels de l\'assistant du cœur (mjs_init.ts) : une clé calculée échapperait à la liste', () => {
    assert.deepEqual(calculees.filter(c => !c.startsWith('mjs_init.ts')), [])
  })

  it('l\'avis de développement sur $$mjs-fx-every en fait partie ; les textes des traces n\'y sont pas', () => {
    assert.ok(WARNING_ONLY_MESSAGES.includes('fxEveryRefused'))
    assert.deepEqual(WARNING_ONLY_MESSAGES.filter(k => TRACE_READ_MESSAGES.includes(k)), [])
  })

  it('chaque clé de la liste existe dans la table des messages, en français et en anglais', () => {
    for (const lang of ['fr', 'en'] as const) {
      const table = RUNTIME_LABELS[lang].err as Record<string, string>
      assert.deepEqual(WARNING_ONLY_MESSAGES.filter(k => typeof table[k] !== 'string'), [], lang)
    }
  })
})

describe('messages des avertissements — l\'aide de la construction', () => {
  const table = RUNTIME_LABELS.fr.err as Record<string, string>

  it('messagesWithoutTraces aux niveaux \'error\' et \'silent\' : ôte aussi les textes des seuls avertissements, rien d\'autre', () => {
    const avant = Object.keys(table).length
    for (const niveau of ['error', 'silent'] as const) {
      const reste = messagesWithoutTraces(table, niveau)
      assert.equal(Object.keys(reste).length, avant - TRACE_ONLY_MESSAGES.length - WARNING_ONLY_MESSAGES.length, niveau)
      for (const k of WARNING_ONLY_MESSAGES) assert.equal(k in reste, false, k)
      assert.ok(reste['fxLoad'], 'un texte lu par une erreur reste')
    }
    assert.equal(Object.keys(table).length, avant, 'la table d\'origine est intacte')
  })

  it('messagesWithoutTraces au niveau \'warn\' (et sans niveau) : les textes des avertissements restent, sauf ceux du développement seul', () => {
    for (const reste of [messagesWithoutTraces(table, 'warn'), messagesWithoutTraces(table)]) {
      for (const k of WARNING_ONLY_MESSAGES) assert.equal(typeof reste[k], DEV_ONLY_MESSAGES.includes(k) ? 'undefined' : 'string', k)
    }
  })
})
