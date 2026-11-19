// les blocs `// <no-x>` … `// </no-x>` du cœur sont écrits en commentaire : la construction les décommente quand elle retire le
// bloc `<x>` (réglage proxy à false, aucun composant qui redessine…). Un renommage ne voit pas ce texte : un nom changé dans le
// code vivant y reste sous son ancienne forme, et l'appli construite sans `<x>` lève une ReferenceError (ou écrit une globale).
// Chaque nom nu que lit un bloc décommenté doit être nommé dans le code vivant du même fichier, déclaré par un bloc <no-x> ou au premier
// niveau d'un fichier du cœur, ou global

import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const runtime = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime')
const BLOC    = /^[ \t]*\/\/ <(no-[\w-]+)>\n([\s\S]*?)^[ \t]*\/\/ <\/\1>\n/gm
const MOTS_JS = new Set('arguments async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield'.split(' '))
const GLOBAUX = new Set('µ window document globalThis self navigator location history console Object Array Math JSON Promise Symbol Map Set WeakMap WeakSet WeakRef Number String Boolean Error TypeError RangeError Date RegExp Reflect Proxy NaN Infinity isNaN parseInt parseFloat queueMicrotask setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame performance Node Element HTMLElement Event CustomEvent MutationObserver structuredClone'.split(' '))

// sans commentaires, ni textes entre guillemets, ni gabarits littéraux : il ne reste que du code
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""').replace(/\/\/.*$/gm, '')
// noms nus : ni après un point (membre), ni clé d'objet suivie de deux-points
// corps d'un bloc <no-x> tel que la construction le rend : marques de blocs imbriqués ôtées, une marque de commentaire retirée
const decommente = (corps: string): string => code(corps.replace(/^[ \t]*\/\/ <\/?[\w-]+>[ \t]*\n/gm, '').replace(/^([ \t]*)\/\/ ?/gm, '$1'))
const nus = (t: string): Set<string> => new Set([...t.matchAll(/(?<![\w$.µ])([A-Za-z_$][\w$]*)(?![\w$])(?!\s*:(?!:))/g)].map(m => m[1]))

// noms que déclare un morceau de code : var, let, const (chaque déclarateur, déstructuration comprise), function, class, paramètres
// d'une fonction ou d'une flèche, variable d'un catch
function declares(t: string, sansParametres = false): Set<string> {
  const out = new Set<string>()
  const ids = (s: string) => { for (const m of s.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$])/g)) out.add(m[1]) }
  for (const m of t.matchAll(/\b(?:var|let|const)\s+([^;\n]*)/g)) {
    let prof = 0, part = ''
    const parts: string[] = []
    for (const c of m[1]) {
      if ('([{'.includes(c)) prof++
      if (')]}'.includes(c)) prof--
      if (c === ',' && prof === 0) { parts.push(part); part = '' }
      else part += c
    }
    parts.push(part)
    // un déclarateur nomme son premier mot, ou chaque mot de sa déstructuration
    for (const x of parts) { const g = x.split('=')[0].trim(); if (/^[{[]/.test(g)) ids(g); else { const n = /^[A-Za-z_$][\w$]*/.exec(g); if (n) out.add(n[0]) } }
  }
  for (const m of t.matchAll(/\b(?:function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1])
  if (sansParametres) return out
  for (const m of t.matchAll(/\bfunction\b[^(]*\(([^)]*)\)|\(([^()]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>|\bcatch\s*\(([^)]*)\)/g)) ids((m[1] ?? m[2] ?? m[3] ?? m[4]).replace(/=[^,]*/g, ''))
  return out
}

describe('cœur : un bloc <no-x> décommenté ne lit aucun nom disparu du code vivant', () => {
  const fichiers = readdirSync(runtime).filter(f => f.endsWith('.ts'))
  // le cœur est un seul fichier une fois bâti : un nom déclaré au premier niveau d'un fichier, ou par un bloc <no-x>, se voit de tous
  const globaux  = new Set<string>()
  for (const f of fichiers) {
    const t = readFileSync(join(runtime, f), 'utf8')
    for (const m of t.matchAll(/^(?:async\s+)?(?:var|let|const|function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) globaux.add(m[1])
    for (const b of t.matchAll(BLOC)) for (const n of declares(decommente(b[2]))) globaux.add(n)
  }
  it('les fichiers du cœur portent des blocs <no-x> (la garde voit quelque chose)', () => {
    const n = fichiers.reduce((s, f) => s + [...readFileSync(join(runtime, f), 'utf8').matchAll(BLOC)].length, 0)
    assert.ok(n > 50, `${n} blocs <no-x> seulement`)
  })
  for (const f of fichiers) {
    const texte = readFileSync(join(runtime, f), 'utf8')
    const blocs = [...texte.matchAll(BLOC)]
    if (blocs.length === 0) continue
    it(`${f} : chaque nom lu par un bloc <no-x> existe`, () => {
      const vivant            = nus(code(texte.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')))
      const absents: string[] = []
      for (const b of blocs) {
        const corps = decommente(b[2])
        const ligne = texte.slice(0, b.index).split('\n').length
        for (const nom of nus(corps)) if (!MOTS_JS.has(nom) && !GLOBAUX.has(nom) && !vivant.has(nom) && !globaux.has(nom)) absents.push(`${nom} (<${b[1]}>, ligne ${ligne})`)
      }
      assert.deepEqual(absents, [], `noms lus par un bloc décommenté, que le code vivant ne nomme plus : ${absents.join(', ')}`)
    })
    it(`${f} : chaque nom que déclare un bloc <no-x> est lu (sinon le code d'autour en lit un autre)`, () => {
      // un bloc <no-x> remplace un bloc <x> : le nom qu'il déclare est celui que lit le code d'autour ; déclaré puis jamais lu, il a
      // divergé du nom que le code vivant emploie (le code lit alors un nom que plus rien ne déclare une fois <x> retiré)
      const tout            = code(texte.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')) + '\n' + blocs.map(b => decommente(b[2])).join('\n')
      const compte          = (n: string): number => [...tout.matchAll(new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`, 'g'))].length
      const muets: string[] = []
      for (const b of blocs) {
        const ligne = texte.slice(0, b.index).split('\n').length
        for (const n of declares(decommente(b[2]), true)) if (!MOTS_JS.has(n) && compte(n) < 2) muets.push(`${n} (<${b[1]}>, ligne ${ligne})`)
      }
      assert.deepEqual(muets, [], `noms déclarés par un bloc <no-x> que rien ne lit : ${muets.join(', ')}`)
    })
  }
})
