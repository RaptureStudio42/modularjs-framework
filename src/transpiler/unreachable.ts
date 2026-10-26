// code inaccessible — une instruction posée, dans le MÊME bloc, après un `return`, un `throw`, un
// `break` ou un `continue` ne s'exécute jamais. Le développement la garde (Civet et CoffeeScript la
// recopient) ; la production la retire sans rien dire (esbuild minifie avec `treeShaking`, ses
// avertissements ne sont pas relus) : un `return` oublié par une substitution de texte vidait une
// méthode, construction verte.
//
// Lu sur l'AST du JavaScript que le compilateur du langage vient de produire, AVANT toute réécriture
// propre à ModularJS (mêmes garanties que const-reassign.ts) : les fonctions générées par le cadre n'y
// sont pas encore. Le `return` implicite de Civet et de CoffeeScript tombe sur la DERNIÈRE instruction
// d'une fonction, rien ne le suit. L'appelant ne cite que les positions que la carte de source rend à
// une ligne écrite par l'auteur : une zone générée n'a pas de ligne, elle n'est jamais signalée.

import type * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { t } from '../messages/index.js'
import { typedLine, printDiagnostic, type LintToggles } from '../diagnostics.js'

export type UnreachableKeyword = 'return' | 'throw' | 'break' | 'continue'

export interface UnreachableCode {
  /** position, dans le JavaScript analysé, de la première instruction jamais exécutée */
  offset: number
  /** l'instruction qui coupe le bloc */
  keyword: UnreachableKeyword
}

const CUTS: Record<string, UnreachableKeyword> = {
  ReturnStatement:   'return',
  ThrowStatement:    'throw',
  BreakStatement:    'break',
  ContinueStatement: 'continue',
}

// rien à exécuter : une fonction déclarée (remontée en tête de sa portée, appelable plus haut), un
// `var` sans valeur (remonté de même, CoffeeScript les pose ainsi), un `;` seul
function inert(stmt: any): boolean {
  if (stmt.type === 'FunctionDeclaration' || stmt.type === 'EmptyStatement') return true
  return stmt.type === 'VariableDeclaration' && stmt.kind === 'var' && stmt.declarations.every((d: any) => d.init === null)
}

// la première instruction exécutable qui suit la première coupure de la liste — une par bloc : la
// suite du même bloc est morte avec elle
function deadAfterCut(body: any[], found: UnreachableCode[]): void {
  for (let i = 0; i < body.length - 1; i++) {
    const keyword = CUTS[body[i].type]
    if (!keyword) continue
    const dead = body.slice(i + 1).find(s => !inert(s))
    if (dead) found.push({ offset: dead.start, keyword })
    return
  }
}

/** Le code qui suit une coupure (`return`, `throw`, `break`, `continue`) dans le même bloc. Un
 *  `if … return` puis la suite : deux blocs, rien à signaler. */
export function findUnreachableCode(ast: acorn.Node | null): UnreachableCode[] {
  const found: UnreachableCode[] = []
  if (!ast) return found
  walk.simple(ast, {
    Program(n: any)        { deadAfterCut(n.body, found) },
    BlockStatement(n: any) { deadAfterCut(n.body, found) },
    StaticBlock(n: any)    { deadAfterCut(n.body, found) },
    SwitchCase(n: any)     { deadAfterCut(n.consequent, found) },
  })
  return found
}

/** Un avertissement `[lint.unreachable]` par ligne de code inaccessible : `lineOf` rend la ligne du
 *  fichier source d'une position du JavaScript analysé, `null` hors du code écrit par l'auteur (zone
 *  générée, carte de source muette) — rien n'est dit alors. `fichier` : le nom cité. Imprimé ici,
 *  comme les autres avertissements de compilation (printDiagnostic compte aussi dans un thread de
 *  travail) ; `lint.unreachable: false` coupe avant même la lecture de l'arbre. */
export function warnUnreachableCode(ast: acorn.Node | null, lineOf: (offset: number) => number | null, fichier: string, lint?: LintToggles, colorsEnabled = false): void {
  if (!ast || lint?.unreachable === false) return
  const said = new Set<number>()
  for (const code of findUnreachableCode(ast)) {
    const ligne = lineOf(code.offset)
    if (ligne === null || said.has(ligne)) continue
    said.add(ligne)
    const line = typedLine('unreachable', t('transpiler.code-inaccessible', { fichier, ligne, mot: code.keyword }), lint)
    if (line !== null) printDiagnostic(line, colorsEnabled)
  }
}
