// paramètres que Civet lit autrement, sans erreur : `(t, readonly) -> t` devient l'appel `(t, readonly)(function() { return t })`
// (`readonly` est un mot de TypeScript), `(son, loop) -> son` une boucle sans fin lancée dès que la ligne s'exécute,
// `(fenetre, undefined) -> fenetre` une affectation de `undefined` ; contrôle sur l'arbre du JavaScript produit (acorn),
// jamais sur des lignes de texte : une chaîne, un commentaire, une regex, une clé, une propriété, un champ de classe, un
// attribut du gabarit ou un appel voulu (`(readonly)(1)`) qui portent le même mot ne déclenchent rien

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { t } from '../messages/index.js'

export type SorteLecture = 'appel' | 'boucle' | 'affectation'

export interface ParametreLuAutrement {
  nom: string
  sorte: SorteLecture
  ligne: number | null
  colonne: number | null
  // indice du nœud fautif dans le JavaScript produit (la ligne d'un gestionnaire du gabarit s'y lit)
  decalage: number
}

// erreur de construction qui garde le paramètre trouvé et le JavaScript produit : l'appelant qui connaît la vraie ligne
// du fichier (imports ajoutés devant, gestionnaires du gabarit compilés ensemble) refait le message avec elle
export class ErreurParametreLuAutrement extends Error {
  parametre: ParametreLuAutrement
  js: string
  // texte d'une expression du gabarit refusée : le transpileur y cherche sa ligne dans le fichier
  expression?: string
  // `partiel` : l'expression vient d'un partiel inclus, dont la ligne n'est pas connue
  constructor(parametre: ParametreLuAutrement, fichier: string, js: string, ligne: number | null = parametre.ligne, colonne: number | null = parametre.colonne, partiel = false) {
    const position = ligne === null ? fichier : colonne === null ? `${fichier}:${ligne}` : `${fichier}:${ligne}:${colonne}`
    super(t('languages.civet-parametre-lu-autrement', { position, nom: parametre.nom, sorte: parametre.sorte, partiel }))
    this.parametre = parametre
    this.js        = js
  }
}

// noms valides en JavaScript strict que Civet ne lit pas comme des noms dans une liste de paramètres : le mot de TypeScript
// `readonly` partout, les mots de Civet dans une décomposition (`({unless}) ->`, `({loop}) ->`) ou devant un type
// (`(t, not: number) ->`, `(son, loop: boolean) ->`)
const MOTS = new Set(['readonly', 'loop', 'until', 'unless', 'not', 'is', 'and', 'or'])

// tri rapide du JavaScript produit : sans l'un de ces mots, ni boucle vide, ni affectation de `undefined`, aucun arbre à lire
// (le tri seul ne refuse jamais rien)
const TRI = /\b(?:readonly|loop|until|unless|not|is|and|or)\b|while\s*\(\s*true\s*\)\s*;|\bundefined\s*=[^=]/

type Noeud = any

// boucle produite par le mot `loop` de Civet, `(()=>{const results=[];while(true);;return results})()` : sans fin
function boucleDeCivet(n: Noeud): boolean {
  if (n.type !== 'CallExpression' || n.arguments.length > 0) return false
  const f = n.callee.type === 'ParenthesizedExpression' ? n.callee.expression : n.callee
  return f.type === 'ArrowFunctionExpression' && f.body.type === 'BlockStatement' && f.body.body.some((s: Noeud) => s.type === 'WhileStatement' && s.test.type === 'Literal' && s.test.value === true && s.body.type === 'EmptyStatement')
}

// un élément de la liste entre parenthèses lu comme un paramètre (nom, défaut, décomposition, reste, `x?`) : `false` si ce
// n'en est pas un (appel, propriété, opération : l'appel est alors voulu), sinon le nœud du mot lu autrement, ou `null`
function motDuParametre(n: Noeud): Noeud | null | false {
  switch (n.type) {
    case 'Identifier':
      return MOTS.has(n.name) ? n : null
    case 'AssignmentExpression':
      return n.operator === '=' ? motDuParametre(n.left) : false
    case 'AssignmentPattern':
      return motDuParametre(n.left)
    case 'SpreadElement':
    case 'RestElement':
      return motDuParametre(n.argument)
    case 'ParenthesizedExpression': {
      // `(t, readonly?) ->` : Civet en fait la comparaison `(readonly != null)`
      const e = n.expression
      return e.type === 'BinaryExpression' && e.operator === '!=' && e.right.type === 'Literal' && e.right.value === null ? motDuParametre(e.left) : false
    }
    case 'ArrayExpression':
    case 'ArrayPattern':
      return premierMot(n.elements.filter((e: Noeud) => e !== null))
    case 'ObjectExpression':
    case 'ObjectPattern': {
      let mot: Noeud | null = null
      for (const p of n.properties) {
        if (p.type !== 'Property') {
          const r = motDuParametre(p)
          if (r === false) return false
          mot ??= r
          continue
        }
        if (p.computed || p.kind !== 'init' || p.method) return false
        const r = motDuParametre(p.value)
        if (r === false) return false
        // `(t, readonly: boolean) ->` : Civet en fait l'objet `{readonly: boolean}`, le mot devient la clé
        mot ??= r ?? (p.key.type === 'Identifier' && MOTS.has(p.key.name) ? p.key : null)
      }
      return mot
    }
    case 'CallExpression':
      return boucleDeCivet(n) ? n : false
    default:
      return false
  }
}

// la liste entière : chaque élément doit être un paramètre ; rend le premier mot lu autrement
function premierMot(elements: Noeud[]): Noeud | null | false {
  let mot: Noeud | null = null
  for (const e of elements) {
    const r = motDuParametre(e)
    if (r === false) return false
    mot ??= r
  }
  return mot
}

// noms liés par un paramètre : nom, défaut, reste, décomposition
function nomsLies(p: Noeud, noms: Set<string>): Set<string> {
  if (!p) return noms
  if (p.type === 'Identifier') noms.add(p.name)
  else if (p.type === 'AssignmentPattern') nomsLies(p.left, noms)
  else if (p.type === 'RestElement') nomsLies(p.argument, noms)
  else if (p.type === 'ArrayPattern') for (const e of p.elements) nomsLies(e, noms)
  else if (p.type === 'ObjectPattern') for (const q of p.properties) nomsLies(q.type === 'Property' ? q.value : q.argument, noms)
  return noms
}

const estFonction = (n: Noeud): boolean => n?.type === 'FunctionExpression' || n?.type === 'FunctionDeclaration' || n?.type === 'ArrowFunctionExpression'

// premier paramètre lu autrement dans le JavaScript que Civet vient de produire, avec sa position dans la source (carte de
// Civet) ; `carte` n'est lue que si un paramètre est trouvé
export function parametreLuAutrement(js: string, carte: () => unknown): ParametreLuAutrement | null {
  if (!TRI.test(js)) return null
  let trouve: { noeud: Noeud, nom: string, sorte: SorteLecture } | null = null
  try {
    const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', locations: true, preserveParens: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true })
    walk.ancestor(ast, {
      CallExpression(n: Noeud) {
        if (trouve || n.arguments.length !== 1) return
        // la lecture fautive de Civet : la liste entre parenthèses appelée avec la fonction qui la suivait (`-> t`), seul
        // argument ; tout autre appel est voulu (`(readonly)(1)`). `function m(t, readonly)` suivi de son corps n'est pas
        // reconnu : Civet en fait `function m() {return (t, readonly)(…) }`, que rien ne sépare d'un appel voulu
        const arg = n.arguments[0]
        if (arg.type !== 'FunctionExpression' && arg.type !== 'ArrowFunctionExpression') return
        // `(loop) -> 1` : la boucle elle-même est appelée
        if (boucleDeCivet(n.callee)) {
          trouve = { noeud: n.callee, nom: 'loop', sorte: 'boucle' }
          return
        }
        if (n.callee.type !== 'ParenthesizedExpression') return
        const dedans = n.callee.expression
        const mot    = premierMot(dedans.type === 'SequenceExpression' ? dedans.expressions : [dedans])
        if (mot) trouve = mot.type === 'Identifier' ? { noeud: mot, nom: mot.name, sorte: 'appel' } : { noeud: mot, nom: 'loop', sorte: 'boucle' }
      },
      // `(fenetre, undefined) -> fenetre` (de même avec un défaut, un reste, une décomposition) : Civet renomme le paramètre
      // et affecte `undefined` en tête du corps
      AssignmentExpression(n: Noeud, _etat: unknown, ancetres: Noeud[]) {
        if (trouve || n.operator !== '=' || n.left.type !== 'Identifier' || n.left.name !== 'undefined' || n.right.type !== 'Identifier') return
        const fonction = [...ancetres].reverse().find(estFonction)
        if (fonction?.params.some((p: Noeud) => nomsLies(p, new Set()).has(n.right.name))) trouve = { noeud: n, nom: 'undefined', sorte: 'affectation' }
      },
    })
  }
  catch {
    // JavaScript qu'acorn ne lit pas (les contrôles du compilateur qui suivent le disent), ou arbre trop profond pour la
    // pile : le contrôle se tait
    return null
  }
  if (!trouve) return null
  const { noeud, nom, sorte } = trouve as { noeud: Noeud, nom: string, sorte: SorteLecture }
  let ligne: number | null   = null
  let colonne: number | null = null
  try {
    const o = positionDansLaSource(new TraceMap(carte() as ConstructorParameters<typeof TraceMap>[0]), noeud)
    if (o) {
      ligne   = o.line
      colonne = o.column + 1
    }
  }
  catch {
    // carte illisible : le message garde le nom, sans la ligne
  }
  return { nom, sorte, ligne, colonne, decalage: noeud.start }
}

// position du nœud dans la source, sinon celle du premier de ses descendants que la carte de Civet situe (la boucle de
// `loop` est un code ajouté par Civet : seuls certains de ses morceaux portent la position du mot)
function positionDansLaSource(trace: TraceMap, noeud: Noeud): { line: number, column: number } | null {
  const candidats: Noeud[] = []
  walk.full(noeud, (d: Noeud) => {
    candidats.push(d)
  })
  candidats.sort((a, b) => a.start - b.start)
  for (const c of candidats) {
    const o = originalPositionFor(trace, { line: c.loc.start.line, column: c.loc.start.column })
    if (o.line !== null) return { line: o.line, column: o.column }
  }
  return null
}
