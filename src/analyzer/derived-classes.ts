// ============================================================================
// Classement des valeurs dérivées : « précise » ou « horloge » (lu par `mjs check --derived`).
//
// PRÉCISE : le compilateur prouve ce qu'elle lit (cf. deriveesPrecises plus bas : variables `$` du composant, littéraux,
// opérateurs, champs lus, appels de la liste courte) ; au runtime, elle suit ses sources, sauf quand elle repasse à l'horloge (docs/03-reactivite.md).
// HORLOGE : tout le reste ; elle garde la règle de toujours (refaite à sa lecture après toute écriture du composant).
// Chaque valeur à l'horloge donne sa raison — une lecture qui échappe à l'analyse des lectures ci-dessous, ou à défaut la
// première forme hors de la liste courte :
//   import      fonction ou valeur importée (`@import`)
//   variable    variable ordinaire changée ailleurs : par une fonction, une valeur dérivée, un gestionnaire du
//               gabarit, `@this=!{nom}` ; ou locale d'une fonction qui entoure la valeur lue
//   globale     nom hors du composant et hors de la liste du langage (`window`, `document`, `localStorage`…)
//   instance    propriété ou méthode du composant (`@x`, `@@x`, `this`)
//   heure       `Date.now()`, `Date()`, `new Date()` sans argument, `performance.now()`, `format()` sans argument
//   hasard      `Math.random()`
//   methode     méthode hors de la liste du langage sur une valeur dont on ne connaît pas l'objet
//   fonction    fonction non suivie : rangée dans l'état (`$f()`), locale ou paramètre appelé, appel calculé
//   rune        rune du framework (`µ.…`, hors `µ.store.nom`)
//   contexte    contexte non réactif (`§x`)
//   cle         clé calculée (`$[k]`, `$$[k]`)
//   etat        l'état entier (`$` nu, `$$` nu)
//   alias       variable du `<script>` qui garde une valeur de l'état lue au premier niveau
//   attente     `await` : ce qui se lit après l'attente échappe au calcul
//   derivee     autre valeur dérivée à l'horloge
//   double      valeur dérivée définie plusieurs fois
//   inconnue    forme non suivie (classe, `arguments`, `import.meta`, motif inconnu…)
//   liste       forme hors de la liste courte des valeurs précises (fonction ou constante du `<script>`, magasin, contexte,
//               méthode hors de la liste, `µderived`…)
//   garde       variable `$` qui reçoit un objet que le script garde (`$x = nom`, `nom` hors des paramètres de la fonction
//               qui écrit) : le script peut le changer sans que MJS le voie
//   simple      calcul plus court que sa vérification (lectures, `.length`, opérateurs, `Math.*`, conversions) : la refaire
//               coûte moins que vérifier ses sources
// `par` : la fonction ou la variable du composant par laquelle passe la lecture.
// Calculé seulement sur demande (`TranspileOpts.derived`) : le code produit n'en dépend jamais.
// ============================================================================

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { collecter, porteeFonction, porteeBloc, porteeDeclaration, chercher, nomsMotif, racine, estMagasin, GLOBAUX, ESPACES, METHODES, MUTATEURS, type Portee, type Affectation, type Changement, type DeriveCandidat } from './derived-reads.js'

export type RaisonCode = 'import' | 'variable' | 'globale' | 'instance' | 'heure' | 'hasard' | 'methode' | 'fonction' | 'rune' | 'contexte' | 'cle' | 'etat' | 'alias' | 'attente' | 'derivee' | 'double' | 'inconnue' | 'liste' | 'garde' | 'simple'

export interface RaisonHorloge { code: RaisonCode; nom?: string; par?: string }

export interface DeriveeClassee {
  /** nom sans `$` */
  nom: string
  classe: 'precise' | 'horloge'
  /** vide pour une valeur précise */
  raisons: RaisonHorloge[]
}

export interface EntreeClassement {
  /** AST du JS compilé du `<script>` (null : aucun) */
  script: any
  /** AST du JS compilé du `<script module>`, imports de `@import` compris (null : aucun) */
  module: any
  candidats: DeriveCandidat[]
  moduleVars: string[]
  /** variables externes, avec leur `$` (`µ$$x` importé : `$x`) */
  externalVars: string[]
  /** noms posés par les imports du `<script module>` */
  imports: string[]
  /** JS compilé des gestionnaires du gabarit (vide : aucun) */
  gestionnaires: string
  /** variables nues de `@this=!{nom}` */
  refs: string[]
  /** le composant écrit l'état sans MJS (cf. ECRITURE_BRUTE) : aucune valeur précise */
  brut?: boolean
  /** méthodes du composant (`@m = ->`, écrites une seule fois, au premier niveau) suivies comme les fonctions du
   *  `<script>` ; sans lui, une valeur qui en appelle une est à l'horloge (propriété du composant) */
  suivreMethodes?: boolean
}

interface Ctx {
  // 'derive' : l'expression ; 'script' : valeur d'une variable du `<script>` ; 'module' : du `<script module>`
  mode: 'derive' | 'script' | 'module'
  // portées d'indice inférieur : locales d'une fonction qui entoure la valeur lue (provenance inconnue)
  borne: number
  dansFonction: boolean
  raisons: RaisonHorloge[]
  script: Map<string, RaisonHorloge[]>
  module: Map<string, RaisonHorloge[]>
  imports: Set<string>
  externes: Set<string>
  // noms que le gabarit change sans que le `<script>` les déclare (`@this=!{nom}` auto-déclaré…)
  gabarit: Set<string>
}

const CLES = new Set(['type', 'start', 'end', 'loc', 'range'])

function noter(c: Ctx, r: RaisonHorloge): void {
  c.raisons.push(r)
}

// raisons d'une variable du composant, lue par la valeur : la lecture passe par elle
function reprendre(c: Ctx, liste: RaisonHorloge[], par: string): void {
  for (const r of liste) c.raisons.push(r.code === 'variable' && r.nom === par ? r : { ...r, par })
}

function lireNom(nom: string, portees: Portee[], c: Ctx, appele: boolean): void {
  if (nom === '$') return noter(c, { code: 'etat', nom: '$' })
  if (nom === 'µ') return noter(c, { code: 'rune', nom: 'µ' })
  if (nom === '_mjsThis') return noter(c, { code: 'instance', nom: '@@' })
  if (nom === 'arguments') return noter(c, { code: 'inconnue', nom: 'arguments' })
  const r = chercher(nom, portees)
  if (r) {
    if (r.i < c.borne) return noter(c, { code: 'variable', nom })
    if (appele && r.nature !== 'fn') noter(c, { code: 'fonction', nom: nom + '()' })
    return
  }
  if (c.script.has(nom)) return reprendre(c, c.script.get(nom)!, nom)
  if (c.gabarit.has(nom)) return noter(c, { code: 'variable', nom })
  if (c.module.has(nom)) return reprendre(c, c.module.get(nom)!, nom)
  // `µ$$x` importé : un magasin, donc une source
  if (c.externes.has(nom)) return
  if (c.imports.has(nom)) return noter(c, { code: 'import', nom })
  if (GLOBAUX.has(nom)) return
  noter(c, { code: 'globale', nom })
}

// l'heure et le hasard : une valeur qui change sans aucune écriture
function heureOuHasard(n: any): RaisonHorloge | null {
  const f = n.callee
  if (f.type === 'Identifier') return f.name === 'Date' && (n.type === 'CallExpression' || n.arguments.length === 0) ? { code: 'heure', nom: n.type === 'NewExpression' ? 'new Date()' : 'Date()' } : null
  if (f.type !== 'MemberExpression' || f.computed || f.property.type !== 'Identifier') return null
  const m = f.property.name
  const o = f.object.type === 'Identifier' ? f.object.name : null
  if (o === 'Date' && m === 'now') return { code: 'heure', nom: 'Date.now()' }
  if (o === 'performance' && m === 'now') return { code: 'heure', nom: 'performance.now()' }
  if (o === 'Math' && m === 'random') return { code: 'hasard', nom: 'Math.random()' }
  if ((m === 'format' || m === 'formatToParts') && n.arguments.length === 0) return { code: 'heure', nom: m + '()' }
  return null
}

// `§x` : la clé lue, quand elle est écrite en toutes lettres
function cleContexte(appel: any): string {
  const a = appel.arguments[0]
  return a && a.type === 'Literal' && typeof a.value === 'string' ? a.value : '…'
}

function appeler(f: any, portees: Portee[], c: Ctx, appel: any): void {
  if (f.type === 'Identifier') return lireNom(f.name, portees, c, true)
  // fonction appelée sur place : son corps tourne au moment de l'appel
  if (f.type === 'FunctionExpression' || f.type === 'ArrowFunctionExpression') return fonction(f, portees, c, false)
  if (f.type !== 'MemberExpression') {
    noter(c, { code: 'fonction', nom: '…()' })
    return parcourir(f, portees, c, appel)
  }
  const o = f.object
  if (f.computed || f.property.type !== 'Identifier') {
    noter(c, { code: 'fonction', nom: '[…]()' })
    parcourir(o, portees, c, f)
    return parcourir(f.property, portees, c, f)
  }
  const m = f.property.name
  if (o.type === 'Identifier') {
    if (o.name === '$') return noter(c, { code: 'fonction', nom: '$' + m + '()' })
    if (o.name === '_mjsThis') {
      // `§§x` : contexte réactif, une source
      if (m === '_mjs_getRCtx') return
      if (m === '_mjs_getContext') return noter(c, { code: 'contexte', nom: '§' + cleContexte(appel) })
      if (c.script.has('@' + m)) return reprendre(c, c.script.get('@' + m)!, '@@' + m)
      return noter(c, { code: 'instance', nom: '@@' + m + '()' })
    }
    if (o.name === 'µ') return noter(c, { code: 'rune', nom: 'µ.' + m })
    // `Math.max`, `JSON.stringify`, `Object.keys`… (`Math.random` : cf. heureOuHasard)
    if (ESPACES.has(o.name) && !chercher(o.name, portees) && !c.script.has(o.name) && !c.module.has(o.name) && !c.imports.has(o.name)) return
  }
  if (o.type === 'ThisExpression') return c.script.has('@' + m) ? reprendre(c, c.script.get('@' + m)!, '@' + m) : noter(c, { code: 'instance', nom: '@' + m + '()' })
  if (estMagasin(o)) return noter(c, { code: 'fonction', nom: '$$' + m + '()' })
  const avant = c.raisons.length
  parcourir(o, portees, c, f)
  // receveur déjà à l'horloge : la méthode n'ajoute rien
  if (c.raisons.length > avant) return
  if (o.type === 'Literal' || o.type === 'TemplateLiteral' || o.type === 'ArrayExpression' || o.type === 'ObjectExpression') return
  if (METHODES.has(m) || MUTATEURS.has(m)) return
  // receveur pris d'une constante du `<script>` ou du module, ou d'un espace du langage (`Math.max.apply`) : ses
  // méthodes sont des valeurs qu'on a lues
  const r = racine(o)
  if (r !== null && !chercher(r, portees) && (c.script.has(r) || c.module.has(r) || (ESPACES.has(r) && !c.imports.has(r)))) return
  noter(c, { code: 'methode', nom: '.' + m + '()' })
}

// `differee` : fonction définie ici, appelée plus tard (rappel, fonction rangée) ; faux : appelée sur place
function fonction(n: any, portees: Portee[], c: Ctx, differee = true): void {
  const pp = [...portees, porteeFonction(n)]
  const c2 = differee && !c.dansFonction ? { ...c, dansFonction: true } : c
  for (const p of n.params) motif(p, pp, c2)
  parcourir(n.body, pp, c2, n)
}

function motif(p: any, portees: Portee[], c: Ctx): void {
  if (!p) return
  switch (p.type) {
    case 'Identifier':        return
    case 'AssignmentPattern': motif(p.left, portees, c); return parcourir(p.right, portees, c, p)
    case 'RestElement':       return motif(p.argument, portees, c)
    case 'ArrayPattern':      for (const q of p.elements) motif(q, portees, c); return
    case 'ObjectPattern':
      for (const q of p.properties) {
        if (q.type === 'RestElement') motif(q.argument, portees, c)
        else {
          if (q.computed) parcourir(q.key, portees, c, q)
          motif(q.value, portees, c)
        }
      }
      return
    case 'MemberExpression':  return parcourir(p, portees, c, null)
    default:                  return noter(c, { code: 'inconnue', nom: p.type })
  }
}

// cible d'une écriture faite par la valeur lue elle-même
function cible(t: any, portees: Portee[], c: Ctx): void {
  if (t.type !== 'Identifier') return motif(t, portees, c)
  const r = chercher(t.name, portees)
  if (r) {
    if (r.i < c.borne) noter(c, { code: 'variable', nom: t.name })
    return
  }
  // variable du composant écrite ici : `collecter` l'a déjà comptée comme changée
  if (c.script.has(t.name)) return reprendre(c, c.script.get(t.name)!, t.name)
  if (c.module.has(t.name)) return reprendre(c, c.module.get(t.name)!, t.name)
  noter(c, { code: 'globale', nom: t.name })
}

function parcourir(n: any, portees: Portee[], c: Ctx, parent: any): void {
  if (!n || typeof n.type !== 'string') return
  switch (n.type) {
    case 'Literal': case 'TemplateElement': case 'EmptyStatement': case 'DebuggerStatement': case 'BreakStatement': case 'ContinueStatement':
      return
    case 'Identifier':
      return lireNom(n.name, portees, c, false)
    case 'ThisExpression':
      return noter(c, { code: 'instance', nom: '@' })
    case 'Super': case 'ClassExpression': case 'ClassDeclaration': case 'WithStatement':
      return noter(c, { code: 'inconnue', nom: n.type === 'Super' ? 'super' : n.type === 'WithStatement' ? 'with' : 'class' })
    case 'MetaProperty':
      return noter(c, { code: 'inconnue', nom: `${n.meta.name}.${n.property.name}` })
    case 'ImportExpression':
      noter(c, { code: 'import', nom: 'import()' })
      return parcourir(n.source, portees, c, n)
    case 'AwaitExpression':
      noter(c, { code: 'attente', nom: 'await' })
      return parcourir(n.argument, portees, c, n)
    case 'MemberExpression': {
      const o = n.object
      if (o.type === 'Identifier' && o.name === '$') {
        if (n.computed) {
          noter(c, { code: 'cle', nom: '$[…]' })
          return parcourir(n.property, portees, c, n)
        }
        // lue une fois, au premier niveau : la variable garde la valeur (un objet de l'état, par alias)
        if (c.mode === 'script' && !c.dansFonction) noter(c, { code: 'alias', nom: '$' + n.property.name })
        else if (c.mode === 'module') noter(c, { code: 'etat', nom: '$' })
        return
      }
      if (o.type === 'Identifier' && o.name === 'µ') {
        const nomme = parent != null && parent.type === 'MemberExpression' && parent.object === n
        if (estMagasin(n)) {
          if (!nomme) return noter(c, { code: 'etat', nom: '$$' })
          if (parent.computed) return noter(c, { code: 'cle', nom: '$$[…]' })
          if (c.mode !== 'derive' && !c.dansFonction) noter(c, { code: 'alias', nom: '$$' + parent.property.name })
          return
        }
        // `µread $$x` : le magasin lu sans s'abonner
        if (!n.computed && (n.property.name === '_mjs_storeRaw' || n.property.name === '_stateRaw') && nomme && !parent.computed) return
        noter(c, { code: 'rune', nom: 'µ.' + (n.computed ? '[…]' : n.property.name) })
        if (n.computed) parcourir(n.property, portees, c, n)
        return
      }
      if (o.type === 'ThisExpression' || (o.type === 'Identifier' && o.name === '_mjsThis')) {
        // `µread $x` (`_mjsThis._state.x`) : lu sans s'abonner
        if (o.type === 'Identifier' && !n.computed && n.property.name === '_state' && parent != null && parent.type === 'MemberExpression' && parent.object === n && !parent.computed) return
        noter(c, { code: 'instance', nom: (o.type === 'ThisExpression' ? '@' : '@@') + (n.computed ? '[…]' : n.property.name) })
        if (n.computed) parcourir(n.property, portees, c, n)
        return
      }
      parcourir(o, portees, c, n)
      if (n.computed) parcourir(n.property, portees, c, n)
      return
    }
    case 'CallExpression': case 'NewExpression': {
      const h = heureOuHasard(n)
      if (h) noter(c, h)
      else appeler(n.callee, portees, c, n)
      for (const a of n.arguments) parcourir(a, portees, c, n)
      return
    }
    case 'TaggedTemplateExpression':
      appeler(n.tag, portees, c, n)
      return parcourir(n.quasi, portees, c, n)
    case 'FunctionExpression': case 'ArrowFunctionExpression': case 'FunctionDeclaration':
      return fonction(n, portees, c)
    case 'BlockStatement': case 'StaticBlock': {
      const pp = [...portees, porteeBloc(n.body)]
      for (const s of n.body) parcourir(s, pp, c, n)
      return
    }
    case 'SwitchStatement': {
      parcourir(n.discriminant, portees, c, n)
      const pp = [...portees, porteeBloc(n.cases.flatMap((k: any) => k.consequent))]
      for (const k of n.cases) parcourir(k, pp, c, n)
      return
    }
    case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
      if (n.type === 'ForOfStatement' && n.await) noter(c, { code: 'attente', nom: 'for await' })
      const init = n.type === 'ForStatement' ? n.init : n.left
      const pp   = init && init.type === 'VariableDeclaration' && init.kind !== 'var' ? [...portees, porteeDeclaration(init)] : portees
      if (n.type !== 'ForStatement' && init && init.type !== 'VariableDeclaration') cible(init, pp, c)
      else parcourir(init, pp, c, n)
      for (const k of ['test', 'update', 'right', 'body']) parcourir(n[k], pp, c, n)
      return
    }
    case 'CatchClause': {
      const m: Portee = new Map()
      const t: string[] = []
      nomsMotif(n.param, t)
      for (const x of t) m.set(x, 'var')
      return parcourir(n.body, [...portees, m], c, n)
    }
    case 'VariableDeclarator':
      motif(n.id, portees, c)
      return parcourir(n.init, portees, c, n)
    case 'AssignmentExpression':
      cible(n.left, portees, c)
      return parcourir(n.right, portees, c, n)
    case 'UpdateExpression':
      return cible(n.argument, portees, c)
    case 'Property':
      if (n.computed) parcourir(n.key, portees, c, n)
      return parcourir(n.value, portees, c, n)
    case 'LabeledStatement':
      return parcourir(n.body, portees, c, n)
  }
  for (const k of Object.keys(n)) {
    if (CLES.has(k)) continue
    const v = n[k]
    if (Array.isArray(v)) { for (const x of v) parcourir(x, portees, c, n) }
    else if (v && typeof v.type === 'string') parcourir(v, portees, c, n)
  }
}

function dedoublonner(liste: RaisonHorloge[]): RaisonHorloge[] {
  const vues = new Set<string>()
  const out: RaisonHorloge[] = []
  for (const r of liste) {
    const cle = `${r.code}\u0000${r.nom ?? ''}\u0000${r.par ?? ''}`
    if (vues.has(cle)) continue
    vues.add(cle)
    out.push(r)
  }
  return out
}

// changements comptés : hors du premier niveau (`premierNiveau` : lui aussi), sauf une fonction passée en rappel
// (`setTimeout(f)`, `$l.map(f)`)
function changee(l: Changement[] | undefined, valeurs: Affectation[] | undefined, premierNiveau = false): boolean {
  if (!l) return false
  const fn          = (valeurs ?? []).filter((a) => a.valeur != null)
  const estFonction = fn.length > 0 && fn.every((a) => /Function/.test(a.valeur.type))
  return l.some((x) => (premierNiveau || !x.haut) && !(x.passe && estFonction))
}

// raisons de chaque variable d'un programme (`<script>` ou `<script module>`) : point fixe sur ses valeurs, celles
// qu'on lui affecte et celles qu'on range dedans ; une variable changée ou inconnue garde sa raison telle quelle
function pointFixe(noms: string[], col: ReturnType<typeof collecter>, fixes: Map<string, RaisonHorloge[]>, mode: 'script' | 'module', base: Omit<Ctx, 'mode' | 'borne' | 'dansFonction' | 'raisons'>, etats: Map<string, RaisonHorloge[]>): void {
  for (const v of noms) etats.set(v, fixes.get(v) ?? [])
  let encore = true
  while (encore) {
    encore = false
    for (const v of noms) {
      if (fixes.has(v)) continue
      const raisons: RaisonHorloge[] = []
      for (const a of [...(col.table.get(v) ?? []), ...(col.membres.get(v) ?? [])]) {
        if (a.valeur == null) continue
        parcourir(a.valeur, a.portees, { ...base, mode, borne: a.portees.length, dansFonction: false, raisons }, null)
      }
      const d = dedoublonner(raisons)
      if (d.length !== etats.get(v)!.length) {
        etats.set(v, d)
        encore = true
      }
    }
  }
}

// variables `$` qu'un nœud lit (`$.x`), et variables du composant qu'il cite
function lectures(n: any, etat: Set<string>, cites: Set<string>, connues: Set<string>): void {
  if (!n || typeof n.type !== 'string') return
  if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === '$' && n.property.type === 'Identifier') etat.add(n.property.name)
  else if (n.type === 'MemberExpression' && !n.computed && (n.object.type === 'ThisExpression' || (n.object.type === 'Identifier' && n.object.name === '_mjsThis')) && connues.has('@' + n.property.name)) cites.add('@' + n.property.name)
  else if (n.type === 'Identifier' && connues.has(n.name)) cites.add(n.name)
  for (const k of Object.keys(n)) {
    if (CLES.has(k)) continue
    const v = n[k]
    if (Array.isArray(v)) { for (const x of v) lectures(x, etat, cites, connues) }
    else if (v && typeof v.type === 'string') lectures(v, etat, cites, connues)
  }
}

// méthodes du composant que la valeur peut suivre : `this.m = fonction` (ou `_mjsThis.m`), écrite une seule fois, au
// premier niveau du `<script>` ; rangées sous `@m`, avec les variables
function methodesSuivies(ast: any): Map<string, Affectation[]> {
  const ecrites = new Map<string, number>()
  const out     = new Map<string, Affectation[]>()
  const visiter = (n: any, haut: boolean): void => {
    if (!n || typeof n.type !== 'string') return
    const l = n.type === 'AssignmentExpression' ? n.left : null
    if (l && l.type === 'MemberExpression' && !l.computed && l.property.type === 'Identifier' && (l.object.type === 'ThisExpression' || (l.object.type === 'Identifier' && l.object.name === '_mjsThis'))) {
      const m = l.property.name
      ecrites.set(m, (ecrites.get(m) ?? 0) + 1)
      if (haut && n.operator === '=' && /Function/.test(n.right.type)) out.set('@' + m, [{ valeur: n.right, portees: [] }])
    }
    const dedans = haut && !/Function/.test(n.type)
    for (const k of Object.keys(n)) {
      if (CLES.has(k)) continue
      const v = n[k]
      if (Array.isArray(v)) { for (const x of v) visiter(x, dedans) }
      else if (v && typeof v.type === 'string') visiter(v, dedans)
    }
  }
  visiter(ast, true)
  for (const [m, nb] of ecrites) if (nb > 1) out.delete('@' + m)
  return out
}

function analyserGestionnaires(js: string): ReturnType<typeof collecter> | null {
  if (!js.trim()) return null
  try {
    return collecter(acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' }), new Set(), new Set())
  }
  catch {
    return null
  }
}

export function classerDerivees(e: EntreeClassement): DeriveeClassee[] {
  const imports   = new Set(e.imports)
  const externes  = new Set(e.externalVars)
  const refs      = new Set(e.refs)
  const noeuds    = new Set(e.candidats.map((k) => k.noeud))
  const vide      = { table: new Map(), membres: new Map(), inconnues: new Set<string>(), changes: new Map(), confies: [] } as ReturnType<typeof collecter>
  const colScript = e.script ? collecter(e.script, new Set(), noeuds) : vide
  const colModule = e.module ? collecter(e.module, new Set(), new Set()) : vide
  // gestionnaires illisibles : on ne sait pas ce qu'ils changent, toute variable compte comme changée
  const colGabarit     = analyserGestionnaires(e.gestionnaires)
  const gabaritInconnu = colGabarit === null && e.gestionnaires.trim() !== ''
  const parGabarit     = (v: string, valeurs: Affectation[] | undefined): boolean => refs.has(v) || gabaritInconnu || changee(colGabarit?.changes.get(v), valeurs)

  // méthodes suivies : rangées avec les variables du `<script>`, sous `@m`
  const methodes    = e.suivreMethodes && e.script ? methodesSuivies(e.script) : new Map<string, Affectation[]>()
  const tableScript = new Map([...colScript.table, ...methodes])
  const scriptNoms  = [...tableScript.keys()]
  const scriptSet   = new Set(scriptNoms)
  const moduleNoms  = e.moduleVars.filter((v) => !scriptSet.has(v))
  const gabarit     = new Set([...refs, ...(colGabarit ? colGabarit.changes.keys() : [])].filter((v) => !scriptSet.has(v) && !moduleNoms.includes(v)))

  const etatsModule = new Map<string, RaisonHorloge[]>()
  const etatsScript = new Map<string, RaisonHorloge[]>()
  const base        = { script: etatsScript, module: etatsModule, imports, externes, gabarit }

  // le `<script module>` : ses variables, changées par ses fonctions, par le `<script>` (même au premier niveau : chaque
  // instance le rejoue) ou par le gabarit
  const fixesModule = new Map<string, RaisonHorloge[]>()
  for (const v of moduleNoms) {
    const valeurs = colModule.table.get(v)
    if (changee(colModule.changes.get(v), valeurs) || changee(colScript.changes.get(v), valeurs, true) || parGabarit(v, valeurs)) fixesModule.set(v, [{ code: 'variable', nom: v }])
    else if (colModule.inconnues.has(v)) fixesModule.set(v, [{ code: 'inconnue', nom: v }])
  }
  pointFixe(moduleNoms, colModule, fixesModule, 'module', { ...base, script: new Map() }, etatsModule)

  const fixesScript = new Map<string, RaisonHorloge[]>()
  for (const v of scriptNoms) {
    const valeurs = colScript.table.get(v)
    if (changee(colScript.changes.get(v), valeurs) || parGabarit(v, valeurs)) fixesScript.set(v, [{ code: 'variable', nom: v }])
    else if (colScript.inconnues.has(v)) fixesScript.set(v, [{ code: 'inconnue', nom: v }])
  }
  pointFixe(scriptNoms, { ...colScript, table: tableScript }, fixesScript, 'script', base, etatsScript)

  // les valeurs dérivées, dans l'ordre où elles sont écrites (une définie deux fois : une seule entrée)
  const definitions = new Map<string, number>()
  for (const k of e.candidats) definitions.set(k.nom, (definitions.get(k.nom) ?? 0) + 1)
  const raisons          = new Map<string, RaisonHorloge[]>()
  const lus              = new Map<string, Set<string>>()
  const composant        = new Set([...scriptNoms, ...moduleNoms])
  const citesParVariable = new Map<string, { etat: Set<string>; cites: Set<string> }>()
  for (const v of composant) {
    const etat  = new Set<string>()
    const cites = new Set<string>()
    for (const a of [...(tableScript.get(v) ?? []), ...(colScript.membres.get(v) ?? []), ...(colModule.table.get(v) ?? []), ...(colModule.membres.get(v) ?? [])]) lectures(a.valeur, etat, cites, composant)
    citesParVariable.set(v, { etat, cites })
  }
  for (const k of e.candidats) {
    const l = raisons.get(k.nom) ?? []
    raisons.set(k.nom, l)
    if (definitions.get(k.nom)! > 1 && l.length === 0) l.push({ code: 'double', nom: '$' + k.nom })
    const locaux: Portee[] = k.locaux ? [new Map(k.locaux.map((x) => [x, 'var'] as [string, 'var']))] : []
    parcourir(k.noeud, locaux, { ...base, mode: 'derive', borne: 0, dansFonction: false, raisons: l }, null)
    // variables `$` lues, en toutes lettres ou par une fonction du composant qu'elle cite
    const etat = lus.get(k.nom) ?? new Set<string>()
    lus.set(k.nom, etat)
    const cites = new Set<string>()
    lectures(k.noeud, etat, cites, composant)
    const aVoir = [...cites]
    for (let i = 0; i < aVoir.length; i++) {
      const x = citesParVariable.get(aVoir[i])
      if (!x) continue
      for (const s of x.etat) etat.add(s)
      for (const y of x.cites) if (!cites.has(y)) { cites.add(y); aVoir.push(y) }
    }
  }
  // une valeur dérivée qui en lit une autre à l'horloge l'est aussi, la raison notée même quand elle en a déjà une
  const horloges = new Set([...raisons].filter(([, l]) => l.length > 0).map(([nom]) => nom))
  let encore     = true
  while (encore) {
    encore = false
    for (const [nom, l] of raisons) {
      for (const x of lus.get(nom)!) {
        if (x === nom || !horloges.has(x) || l.some((r) => r.code === 'derivee' && r.nom === '$' + x)) continue
        l.push({ code: 'derivee', nom: '$' + x })
        if (!horloges.has(nom)) {
          horloges.add(nom)
          encore = true
        }
      }
    }
  }
  // la classe : celle du runtime (deriveesPrecises) ; ses raisons, celles de l'analyse des lectures ou la forme refusée
  const precision = deriveesPrecises(e.candidats, e.externalVars, variablesDouteuses(e.script, e.brut === true))
  return [...raisons].map(([nom, l]) => {
    if (precision.sources.has(nom)) return { nom, classe: 'precise', raisons: [] }
    const d = dedoublonner(l)
    return { nom, classe: 'horloge', raisons: d.length > 0 ? d : [precision.refus.get(nom) ?? { code: precision.simples.has(nom) ? 'simple' : 'liste', nom: '$' + nom }] }
  })
}

// ============================================================================
// Valeurs dérivées PRÉCISES — celles qui suivent leurs sources au runtime, sauf quand elles repassent à l'horloge. Le compilateur
// PROUVE ce qu'elles lisent : leur expression n'est faite que de variables `$` du composant (les autres valeurs précises
// comprises), de littéraux, d'opérateurs, de champs lus sur ces valeurs et d'appels de la liste courte ci-dessous ; une
// fonction écrite sur place n'y entre qu'en argument d'une méthode de liste, faite des mêmes briques, ses paramètres en
// plus. Ses sources : les variables `$` qu'elle lit, celles des valeurs précises qu'elle lit comprises, et les noms des
// champs qu'elle lit ailleurs (`.nom`). Toute autre forme
// (fonction ou constante du `<script>`, magasin, contexte, rune, `this`, `new`, écriture, `in`…) laisse la valeur à la
// règle de toujours : refaite à sa lecture après toute écriture du composant. Dans le doute à l'exécution, le runtime la
// repasse à cette règle (mjs_element.ts)
// ============================================================================

// méthodes de liste et de chaîne de la liste courte (aucune ne change son receveur)
const PURES_METHODES = new Set(['filter', 'map', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'includes', 'indexOf', 'lastIndexOf', 'join', 'slice', 'concat', 'at', 'flat', 'toUpperCase', 'toLowerCase', 'trim', 'trimStart', 'trimEnd', 'startsWith', 'endsWith', 'padStart', 'padEnd', 'repeat', 'substring', 'charAt', 'split', 'toFixed'])
// celles qui reçoivent une fonction écrite sur place
const PURES_RAPPELS = new Set(['filter', 'map', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap'])
const PURES_FONCTIONS = new Set(['String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite'])
const PURES_MATH = new Set(['abs', 'ceil', 'floor', 'round', 'trunc', 'sign', 'min', 'max', 'pow', 'sqrt'])
const PURES_NOMS = new Set(['undefined', 'NaN', 'Infinity'])
// champs qui mènent aux objets partagés du langage
const PURES_INTERDITS = new Set(['constructor', 'prototype', '__proto__'])

export interface Precision {
  /** valeurs précises : nom sans `$` → ses sources (variables `$`, sans `$`) */
  sources: Map<string, string[]>
  /** valeurs à l'horloge : la première forme hors de la liste courte */
  refus: Map<string, RaisonHorloge>
  /** valeurs prouvées mais laissées à l'horloge : leur calcul coûte moins que leur vérification (cf. couteuse) */
  simples: Set<string>
}

// calcul qui coûte plus que la vérification de ses sources : un appel de méthode (liste, chaîne), un appel sur une liste
// étalée, une liste ou un objet bâti (la précision garde aussi son identité) ; lectures, `.length`, opérateurs, `Math.*` et
// conversions (`String`, `Number`…) non — refaits à chaque lecture après une écriture, ils coûtent moins que leur vérification
function couteuse(n: any): boolean {
  let oui = false
  walk.full(n, (x: any) => {
    if (oui) return
    if (x.type === 'ArrayExpression' || x.type === 'ObjectExpression') oui = true
    else if (x.type === 'CallExpression') oui = (x.callee.type === 'MemberExpression' && !(x.callee.object.type === 'Identifier' && x.callee.object.name === 'Math')) || x.arguments.some((a: any) => a.type === 'SpreadElement')
  })
  return oui
}

// la forme refusée, en quelques mots, pour `mjs check --derived`
function decrire(n: any): string {
  if (n.type === 'Identifier') return n.name === '_mjsThis' ? '@@' : n.name
  if (n.type === 'ThisExpression') return '@'
  if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && decrire(n.callee) === '§§') return '§§' + (n.arguments[0]?.type === 'Literal' ? n.arguments[0].value : '…')
  if (n.type === 'CallExpression' || n.type === 'NewExpression') return (n.type === 'NewExpression' ? 'new ' : '') + decrire(n.callee) + '()'
  if (n.type === 'MemberExpression') {
    if (estMagasin(n.object) && !n.computed) return '$$' + n.property.name
    const o = n.object
    if (o.type === 'MemberExpression' && !o.computed && o.object.type === 'Identifier' && o.object.name === '_mjsThis' && o.property.name === '_state' && !n.computed) return 'µread $' + n.property.name
    if (o.type === 'Identifier' && o.name === '_mjsThis' && !n.computed && n.property.name === '_mjs_getRCtx') return '§§'
    if (o.type === 'Identifier' && o.name === 'µ') return 'µ.' + (n.computed ? '…' : n.property.name)
    return n.computed ? decrire(n.object) + '[…]' : '.' + n.property.name
  }
  return n.type
}

// variables `$` lues par l'expression `n` (ajoutées à `lus`), ou la forme refusée ; `locaux` : paramètres des fonctions
// écrites sur place qui l'entourent
function prouver(n: any, locaux: Set<string>, lus: Set<string>): any {
  if (!n) return null
  switch (n.type) {
    case 'Literal': return null
    case 'Identifier': return locaux.has(n.name) || PURES_NOMS.has(n.name) ? null : n
    case 'TemplateLiteral': {
      for (const x of n.expressions) { const r = prouver(x, locaux, lus); if (r) return r }
      return null
    }
    case 'ChainExpression': case 'ParenthesizedExpression': return prouver(n.expression, locaux, lus)
    case 'UnaryExpression': return n.operator === 'delete' ? n : prouver(n.argument, locaux, lus)
    case 'BinaryExpression':
      if (n.operator === 'in' || n.operator === 'instanceof') return n
      return prouver(n.left, locaux, lus) || prouver(n.right, locaux, lus)
    case 'LogicalExpression': return prouver(n.left, locaux, lus) || prouver(n.right, locaux, lus)
    case 'ConditionalExpression': return prouver(n.test, locaux, lus) || prouver(n.consequent, locaux, lus) || prouver(n.alternate, locaux, lus)
    case 'SpreadElement': return prouver(n.argument, locaux, lus)
    case 'ArrayExpression': {
      for (const x of n.elements) { const r = x && prouver(x, locaux, lus); if (r) return r }
      return null
    }
    case 'ObjectExpression': {
      for (const p of n.properties) {
        if (p.type === 'SpreadElement') { const r = prouver(p.argument, locaux, lus); if (r) return r; continue }
        if (p.kind !== 'init' || p.method) return p
        const r = (p.computed && prouver(p.key, locaux, lus)) || prouver(p.value, locaux, lus)
        if (r) return r
      }
      return null
    }
    case 'MemberExpression': {
      const o = n.object
      if (o.type === 'Identifier' && o.name === '$') {
        if (n.computed || n.property.type !== 'Identifier') return n
        lus.add(n.property.name)
        return null
      }
      if (n.property.type === 'PrivateIdentifier' || (!n.computed && PURES_INTERDITS.has(n.property.name))) return n
      // champ lu sur autre chose que l'état : son nom, que le runtime cherche sur les prototypes du langage (une donnée que
      // l'application y aurait posée), noté `.nom` parmi les sources
      if (!n.computed && n.property.name !== 'length') lus.add('.' + n.property.name)
      // magasin, `µread $x`, rune, composant : nommés par la lecture entière
      if ((o.type === 'Identifier' && (o.name === 'µ' || o.name === '_mjsThis')) || (o.type === 'MemberExpression' && (estMagasin(o) || (o.object.type === 'Identifier' && o.object.name === '_mjsThis')))) return n
      return prouver(o, locaux, lus) || (n.computed ? prouver(n.property, locaux, lus) : null)
    }
    case 'CallExpression': {
      if (n.optional) return n
      const f = n.callee
      let rappels = false
      if (f.type === 'Identifier') {
        if (!PURES_FONCTIONS.has(f.name) || locaux.has(f.name)) return n
      }
      else if (f.type === 'MemberExpression' && !f.computed && f.property.type === 'Identifier') {
        if (f.object.type === 'Identifier' && f.object.name === 'Math' && !locaux.has('Math')) {
          if (!PURES_MATH.has(f.property.name)) return n
        }
        else {
          if (!PURES_METHODES.has(f.property.name)) return n
          const r = prouver(f.object, locaux, lus)
          if (r) return r
          rappels = PURES_RAPPELS.has(f.property.name)
        }
      }
      else return n
      for (const a of n.arguments) {
        if (rappels && (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression')) {
          const r = rappel(a, locaux, lus)
          if (r) return r
          continue
        }
        const r = prouver(a, locaux, lus)
        if (r) return r
      }
      return null
    }
  }
  return n
}

// fonction écrite sur place, argument d'une méthode de liste : paramètres simples, un seul retour
function rappel(f: any, locaux: Set<string>, lus: Set<string>): any {
  if (f.async || f.generator || !f.params.every((p: any) => p.type === 'Identifier')) return f
  let corps = f.body
  if (corps.type === 'BlockStatement') {
    if (corps.body.length !== 1 || corps.body[0].type !== 'ReturnStatement' || !corps.body[0].argument) return f
    corps = corps.body[0].argument
  }
  return prouver(corps, new Set([...locaux, ...f.params.map((p: any) => p.name)]), lus)
}

// écriture de l'état qui contourne MJS, lue dans le texte du composant (`<script>` et gabarit) : `_state`, `µread($x) += 1`,
// `µread($x)++`, le composant passé à une fonction (`ecrire @, 7`, `f(this)`) qui peut écrire son `_state`
export const ECRITURE_BRUTE = /_state\b|µread\s*\(?\s*\$[\w$]+\s*\)?\s*(?:\+\+|--|(?:[-+*\/%&|^]|\*\*|<<|>>>?|\?\?|\|\||&&)?=(?!=))|(?:\+\+|--)\s*µread|(?:^|[(,\s])(?:@|this)\s*(?:,|\)|$)/m

// variables `$` que le compilateur ne peut pas prouver (null : toutes, le composant écrit l'état sans MJS) : `$x = nom`, où
// `nom` n'est pas un paramètre de la fonction qui écrit — le script garde l'objet brut, qu'il peut changer sans que MJS le
// voie
export function variablesDouteuses(script: any, brut: boolean): Set<string> | null {
  if (brut) return null
  const out = new Set<string>()
  if (!script) return out
  walk.ancestor(script, {
    AssignmentExpression(n: any, _st: any, anc: any[]) {
      const l = n.left
      if (n.operator !== '=' || l.type !== 'MemberExpression' || l.computed || l.object.type !== 'Identifier' || l.object.name !== '$' || n.right.type !== 'Identifier') return
      const f = [...anc].reverse().find((a: any) => /Function/.test(a.type))
      if (!f || !f.params.some((p: any) => p.type === 'Identifier' && p.name === n.right.name)) out.add(l.property.name)
    },
  })
  return out
}

// valeurs précises d'un composant et leurs sources (celles des valeurs précises qu'elles lisent comprises, et leurs noms :
// une valeur dérivée réécrite devient une variable) ; `externes` : variables externes, avec leur `$`, et `douteuses` (cf.
// variablesDouteuses) — une valeur qui en lit une reste à l'horloge
export function deriveesPrecises(candidats: DeriveCandidat[], externes: string[] = [], douteuses: Set<string> | null = new Set()): Precision {
  const definitions = new Map<string, number>()
  for (const k of candidats) definitions.set(k.nom, (definitions.get(k.nom) ?? 0) + 1)
  const dehors = new Set(externes.map((v) => v.replace(/^\$+/, '')))
  const lus    = new Map<string, Set<string>>()
  const refus  = new Map<string, RaisonHorloge>()
  for (const k of candidats) {
    if (refus.has(k.nom) || lus.has(k.nom)) continue
    if (definitions.get(k.nom)! > 1) { refus.set(k.nom, { code: 'double', nom: '$' + k.nom }); continue }
    if (douteuses === null) { refus.set(k.nom, { code: 'liste', nom: '_state' }); continue }
    if (k.force || (k.locaux && k.locaux.length > 0)) { refus.set(k.nom, { code: 'liste', nom: k.force ? 'µderived' : 'if' }); continue }
    const l = new Set<string>()
    const r = prouver(k.noeud, new Set(), l)
    if (r) { refus.set(k.nom, { code: 'liste', nom: decrire(r) }); continue }
    const ext = [...l].find((x) => dehors.has(x) || douteuses.has(x))
    if (ext !== undefined) { refus.set(k.nom, { code: douteuses.has(ext) ? 'garde' : 'liste', nom: '$' + ext }); continue }
    lus.set(k.nom, l)
  }
  // une valeur qui en lit une autre à l'horloge y reste aussi ; ses sources : aplaties, cycle refusé
  const sources = new Map<string, string[]>()
  const aplatir = (nom: string, pile: Set<string>): string[] | null => {
    if (sources.has(nom)) return sources.get(nom)!
    if (refus.has(nom) || pile.has(nom)) return null
    pile.add(nom)
    const out = new Set<string>()
    for (const x of lus.get(nom)!) {
      out.add(x)
      if (!definitions.has(x)) continue
      const s = aplatir(x, pile)
      if (s === null) {
        if (!refus.has(nom)) refus.set(nom, { code: 'derivee', nom: '$' + x })
        pile.delete(nom)
        return null
      }
      for (const y of s) out.add(y)
    }
    pile.delete(nom)
    const liste = [...out].sort()
    sources.set(nom, liste)
    return liste
  }
  for (const nom of lus.keys()) aplatir(nom, new Set())
  for (const nom of [...sources.keys()]) if (refus.has(nom)) sources.delete(nom)
  // suivies : les valeurs au calcul coûteux (cf. couteuse) et les valeurs qu'elles lisent ; les autres, prouvées, restent à
  // l'horloge (`simples`) — la refaire coûte moins que vérifier ses sources
  const suivies = new Set<string>()
  const suivre = (nom: string) => {
    if (suivies.has(nom) || !sources.has(nom)) return
    suivies.add(nom)
    for (const x of lus.get(nom)!) if (definitions.has(x)) suivre(x)
  }
  for (const k of candidats) if (sources.has(k.nom) && couteuse(k.noeud)) suivre(k.nom)
  const simples = new Set<string>()
  for (const nom of [...sources.keys()]) {
    if (suivies.has(nom)) continue
    sources.delete(nom)
    simples.add(nom)
  }
  return { sources, refus, simples }
}

// cible d'une écriture : `$.x` (affectation, `+=`, `++`, motif de déstructuration, tête de `for…of`) ou `µwrite $x`
// (`µ._mjs_rawWrite(_mjsThis).x`) ; `noms` : les valeurs dérivées cherchées
function cibleChoisie(t: any, noms: Set<string>, out: Set<string>): void {
  if (!t) return
  switch (t.type) {
    case 'MemberExpression': {
      const o      = t.object
      const dollar = o.type === 'Identifier' && o.name === '$'
      const brute  = o.type === 'CallExpression' && o.callee.type === 'MemberExpression' && !o.callee.computed && o.callee.property.type === 'Identifier' && o.callee.property.name === '_mjs_rawWrite'
      if (!t.computed && t.property.type === 'Identifier' && noms.has(t.property.name) && (dollar || brute)) out.add(t.property.name)
      return
    }
    case 'ArrayPattern': for (const x of t.elements) cibleChoisie(x, noms, out); return
    case 'ObjectPattern': for (const p of t.properties) cibleChoisie(p.type === 'RestElement' ? p.argument : p.value, noms, out); return
    case 'AssignmentPattern': cibleChoisie(t.left, noms, out); return
    case 'RestElement': cibleChoisie(t.argument, noms, out); return
  }
}

// valeurs dérivées que le code écrit : dans une fonction du `<script>` (son premier niveau les définit), partout dans les
// gestionnaires du gabarit (`partout`)
function choixEcrits(ast: any, noms: Set<string>, out: Set<string>, partout: boolean): void {
  const visiter = (n: any, dedans: boolean): void => {
    if (!n || typeof n.type !== 'string') return
    if (dedans) {
      if (n.type === 'AssignmentExpression') cibleChoisie(n.left, noms, out)
      else if (n.type === 'UpdateExpression') cibleChoisie(n.argument, noms, out)
      else if ((n.type === 'ForOfStatement' || n.type === 'ForInStatement') && n.left.type !== 'VariableDeclaration') cibleChoisie(n.left, noms, out)
    }
    const d = dedans || /Function/.test(n.type)
    for (const k of Object.keys(n)) {
      if (CLES.has(k)) continue
      const v = n[k]
      if (Array.isArray(v)) { for (const x of v) visiter(x, d) }
      else if (v && typeof v.type === 'string') visiter(v, d)
    }
  }
  visiter(ast, partout)
}

// dépendances nommées des `µderived $x = expr, $a` que le composant écrit (dans une fonction du `<script>` ou un gestionnaire
// du gabarit) : texte d'une `Map` nom → dépendances, lue par le runtime à l'écriture (`_mjs_computedSrc`,
// runtime/mjs_element.ts). Null sans `µderived` écrite : le code produit ne change pas
export function deriveesChoisies(script: any, candidats: DeriveCandidat[], gestionnaires: string): string | null {
  const nommees = new Map<string, string[]>()
  for (const k of candidats) if (k.nommees) nommees.set(k.nom, k.nommees)
  if (nommees.size === 0) return null
  const noms = new Set(nommees.keys())
  const out  = new Set<string>()
  if (script) choixEcrits(script, noms, out, false)
  if (gestionnaires.trim()) {
    try {
      choixEcrits(acorn.parse(gestionnaires, { ecmaVersion: 'latest', sourceType: 'module' }), noms, out, true)
    }
    catch {
      // gestionnaires illisibles : leurs écritures ne sont pas vues, la valeur écrite par eux seuls devient une variable ordinaire
    }
  }
  const table = [...out].map((nom) => [nom, nommees.get(nom)!.filter((s) => s !== nom)] as const).filter(([, s]) => s.length > 0)
  return table.length > 0 ? `new Map(${JSON.stringify(table)})` : null
}
