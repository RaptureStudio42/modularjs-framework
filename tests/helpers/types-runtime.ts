// le runtime des types (src/runtime/mjs_types.ts) chargé seul, avec un µ minimal, pour les tests des
// listes typées : de quoi écrire une règle comme dans <vars>, monter un composant réduit à ses règles,
// et appeler une méthode de liste comme le font les écritures compilées

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRule, parseTypesBlock, parseVarsBlock, resolveRule, emitRuntimeRule, ruleText, type RuleAst } from '../../src/transpiler/var-types.js'
import { poserMessages } from './messages-stub.js'

const ICI = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(ICI, '../../src/runtime/mjs_types.ts'), 'utf-8')

// `mode` : le réglage que pose le manifeste de développement ('warn' ou 'error') ; sans lui, la production
export function makeMu(mode?: 'warn' | 'error'): any {
  const µ: any = {
    warnings: [] as string[],
    warn(m: string) { this.warnings.push(m) },
    _mjs_toRaw: (x: any) => x,
    _mjs_interpolatorSet: new WeakSet(),
    _mjs_storeRaw: {},
    _mjs_storeNotifyKey() {},
    _runtimeLabelsLang: 'fr',
  }
  if (mode) µ._typesMode = mode
  poserMessages(µ)
  new Function('µ', SRC)(µ)
  return µ
}

// les types nommés des essais, en retrait, un champ par ligne : une liste d'objets passe par un type nommé
export const TYPES_ESSAI: Record<string, string> = {
  Id:        'id  int',
  Message:   'id  int\nt  string',
  Ligne:     'id  int\nt  string\ntags  string[]',
  Cellule:   'v  int',
  Rangee:    'cells  Cellule[]',
  Plateau:   'rows  Rangee[]',
  Rangee3:   'cells  Cellule[] 0..3',
  Plateau3:  'rows  Rangee3[]',
  Bulletin:  'notes  int 0..100[]',
  Carnet:    'rows  Bulletin[]',
  Etiquette: 'label  string',
  Proche:    'nom  string',
  Fils:      'nom  string\nparent\n  nom  string',
  Enfant:    'nom  string\nparent\n  nom  string\namis  Proche[]',
  Note:      'id  int\nt  string\npar\n  nom  string\n  rang  int\ntags  string[]',
  Nomme:     'name  string',
  Choix:     'choix  Item\nnote  string',
  Boite:     'contenu  Contenu',
  C:         'c  int',
  RangAB:    "'a-b'\n  c  int",
  Rangs:     'rows  RangAB[]',
}

// un texte de plusieurs lignes : les champs d'un objet en retrait, un par ligne, comme sous une variable du <vars>
const enRetrait = (nom: string, texte: string): string => `${nom}\n${texte.split('\n').map(l => '  ' + l).join('\n')}`

// une règle écrite comme dans <vars>, compilée comme le fait le build (textes compris) : sur une ligne, ou un objet en retrait sur
// plusieurs ; `defs` : les types nommés qu'elle emploie, en plus des objets de TYPES_ESSAI — chacun sur une ligne, ou un objet en
// retrait sur plusieurs (`{ Item: 'Id | Nomme' }` pour écrire `Item[]`)
export function regle(texte: string, defs: Record<string, string> = {}): any {
  const ou = { bloc: '<vars>', ligne: 1 }
  const D: Record<string, RuleAst> = {}
  for (const [k, v] of Object.entries(TYPES_ESSAI)) D[k] = parseTypesBlock(enRetrait(k, v), 0)[0].rule
  for (const [k, v] of Object.entries(defs)) D[k] = v.includes('\n') ? parseTypesBlock(enRetrait(k, v), 0)[0].rule : parseRule(v, ou)
  const ecrite = texte.includes('\n') ? parseVarsBlock(enRetrait('$v', texte), 0)[0].rule : parseRule(texte, ou)
  const ast    = resolveRule(ecrite, D, ou)
  return new Function(`return ${emitRuntimeRule(ast, true, texte.includes('\n') ? ruleText(ecrite, { names: true }) : texte)}`)()
}

// un composant réduit à ce que lit le contrôle : ses règles et son nom de balise
export function composant(regles: Record<string, string>, defs: Record<string, string> = {}): any {
  const T: any = {}
  for (const [k, v] of Object.entries(regles)) T[k] = regle(v, defs)
  return { _mjs_types: T, localName: 'mjs-essai' }
}

// ce que font µ._mjs_deepCall (composant) et µ._mjs_storeDeepCall (store) autour d'une méthode de liste :
// l'état d'avant, la méthode, le contrôle d'après — rend `true` si la liste est gardée
export function appeler(µ: any, el: any, reg: any, liste: any[], nom: string, ...args: any[]): boolean {
  const avant = µ._mjs_tbefore(liste, nom)
  const res   = (liste as any)[nom](...args)
  return µ._mjs_tafter(el, reg, liste, avant, nom, args, res)
}

// nombre de lectures du registre (WeakMap.get) pendant `fn` : une remontée de liens qui ne s'arrête pas, ou une
// opération qui reparcourt une liste, se voit à ce compte plutôt qu'à une durée
export function lectures(fn: () => void): number {
  const get0 = WeakMap.prototype.get
  let n = 0
  WeakMap.prototype.get = function (this: any, cle: any) { n++; return get0.call(this, cle) }
  try {
    fn()
  }
  finally {
    WeakMap.prototype.get = get0
  }
  return n
}

// écrit une valeur refusée dans un champ du conteneur, et rend le chemin que le message nomme : l'avertissement
// du développement, ou le texte de l'erreur quand le mode est 'error'
export function refuser(µ: any, el: any, reg: any, objet: any, champ: string | number, valeur: any = 'zz'): string {
  µ.warnings.length = 0
  let rendu: any
  let texte: string | undefined
  try {
    rendu = µ._mjs_tdeep(el, reg, objet, champ, valeur)
  }
  catch (e: any) {
    texte = String(e.message)
  }
  if (texte === undefined) {
    assert.ok(rendu === µ._mjs_TNO, 'un refus attendu pour ' + String(champ))
    texte = µ.warnings[0]
  }
  const m = /^\[ModularJS\] (.+?) refuse /.exec(texte ?? '')
  assert.ok(m, 'un message de refus attendu, reçu : ' + texte)
  return m![1]
}
