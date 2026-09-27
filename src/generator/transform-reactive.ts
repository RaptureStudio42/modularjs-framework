// transform-reactive — supprime le Proxy `µ.state` en compile-time.
//
// Avant (V1, Proxy) :
//   $.count = $.count + 1     // get/set interceptés par Proxy → invalidate
//
// Après (V2, direct) :
//   µ._set(_mjsThis, 'count', $.count + 1)
//
// Reads restent directes (`$.x` lit `this._state.x` qui est un objet ordinaire).
// Seules les assignations passent par `µ._set` qui fait le `_mjs_invalidate(bit)`.
// Gain : 3-6× sur les renders bind-heavy car plus de trap handler par accès.
//
// Cas spéciaux :
//   - `$.derived = { _mjs_c: true, f: () => ... }` (computed) → on remplace par
//     `µ._mjs_setComputed(_mjsThis, 'derived', () => ...)` car le runtime doit détecter
//     les wrappers _mjs_c différemment sans Proxy.
//   - `$.x op= y` (compound) → expansé en `µ._set(_mjsThis, 'x', $.x op y)`.

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import MagicString from 'magic-string'
import { passResult, type PassResult } from './pass-map.js'

const COMPOUND_OPS = new Set([
  '+=', '-=', '*=', '/=', '%=', '**=',
  '&=', '|=', '^=', '<<=', '>>=', '>>>=',
  '&&=', '||=', '??=',
])

// retour IMPLICITE d'un gestionnaire en ligne — `(e, el) => { … }`, élément du tableau des
// gestionnaires (`_mjs_inline`) : sa valeur n'est lue que par le routeur d'événements, qui APPELLE
// une fonction renvoyée (forme référence `@click={save}`, docs/06-evenements.md). Rendre la valeur
// affectée y ferait exécuter sur-le-champ une fonction qu'on voulait seulement ranger
// (`@click={$cb = -> …}`) : ce retour-là garde la forme directe (non consommée), partout ailleurs
// l'affectation vaut exactement ce qu'elle vaut en JavaScript.
function isInlineHandlerReturn(ancestors: any[]): boolean {
  if (ancestors[ancestors.length - 2]?.type !== 'ReturnStatement') return false
  for (let i = ancestors.length - 3; i >= 1; i--) {
    const fn = ancestors[i]
    if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression' && fn.type !== 'FunctionDeclaration') continue
    const p = fn.params
    return fn.type === 'ArrowFunctionExpression' && ancestors[i - 1]?.type === 'ArrayExpression' &&
      p.length === 2 && p[0].type === 'Identifier' && p[0].name === 'e' && p[1].type === 'Identifier' && p[1].name === 'el'
  }
  return false
}

export function transformReactiveWrites(js: string): string {
  return transformReactiveWritesMapped(js).code
}

// Variante qui rend AUSSI la carte de source de cette passe — cf. pass-map.ts.
export function transformReactiveWritesMapped(js: string): PassResult {
  if (!js || !js.includes('$.')) return { code: js }

  let ast: acorn.Node
  try {
    ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch {
    return { code: js } // si ça parse pas, on laisse passer (on aura déjà eu une erreur en amont)
  }

  const ms = new MagicString(js)
  let changed = false

  // `ancestor` (et non `simple`) : on a besoin du PARENT pour distinguer une
  // assignation STATEMENT (`$.x = v`, valeur ignorée) d'une assignation en
  // position EXPRESSION (`$a = $b = v`, `notify($x = 5)`).
  // Même parcours post-ordre que `simple` (les transformations imbriquées
  // survivent), avec en plus la pile `ancestors` (dernier élément = node courant).
  walk.ancestor(ast, {
    AssignmentExpression(node: any, _st: any, ancestors: any[]) {
      // une AssignmentExpression dont `left` est un
      // motif (ArrayPattern/ObjectPattern) échappait à la garde MemberExpression
      // ci-dessous : `[$.a, $.b] = [$.b, $.a]` (échange, forme Civet `[$a, $b]
      // = [$b, $a]`) écrivait l'état À NU dans `_state` — aucun `_set`, aucune
      // invalidation, le DOM ne bougeait jamais, zéro erreur. On traite ce cas
      // À PART (édits de BORDURE autour du motif, qui reste en place) avant la
      // garde ci-dessous, qui ne sait matcher qu'une cible MemberExpression seule.
      //
      // Limite CONNUE : une valeur par défaut qui lit un état écrit plus tôt
      // dans le MÊME motif (`[$.a, $.b = $.a] = [1]`) lit l'état AVANT les
      // `_set` (les défauts s'évaluent pendant la déstructuration, les `_set`
      // après). Un `for ([$.a] of xs)` (ForOfStatement, pas une
      // AssignmentExpression) reste hors de portée de ce visiteur.
      if (node.operator === '=' && (node.left.type === 'ArrayPattern' || node.left.type === 'ObjectPattern')) {
        const targets: any[] = []
        collectStateTargets(node.left, targets)
        if (targets.length === 0) return // motif de variables ordinaires, intouché

        for (let i = 0; i < targets.length; i++) ms.overwrite(targets[i].start, targets[i].end, `_mjsD${i}`)

        const parent    = ancestors[ancestors.length - 2]
        const statement = !!parent && parent.type === 'ExpressionStatement'
        const decls     = targets.map((_t: any, i: number) => `_mjsD${i}`).join(', ')
        const sets      = targets.map((t: any, i: number) => `µ._set(_mjsThis, '${t.property.name}', _mjsD${i})`).join('; ')

        // ASI (même raisonnement que UpdateExpression, plus bas) — la forme commence par `(` : en position
        // STATEMENT, `void` coupe l'ASI (mot-clé, pas une parenthèse) et
        // reste valide comme corps d'un `if` sans accolades. Les parenthèses
        // autour du motif dans le corps sont obligatoires : `{a: _mjsD0} =
        // _mjsR` nu en tête d'instruction serait lu comme un BLOC.
        ms.prependLeft(node.start, `${statement ? 'void ' : ''}((_mjsR) => { let ${decls}; (`)
        ms.overwrite(node.left.end, node.right.start, ` = _mjsR); ${sets}${statement ? '' : '; return _mjsR'} })(`)
        closeResidualParens(ms, node, ')')

        changed = true
        return
      }

      // `$.x` (fixe) ET `$[k]` (COMPUTED — n'importe quelle expression comme clé) sont
      // toutes deux acceptées ici : seule `$.x` a un nom connu à la compilation
      // (`property.type === 'Identifier'` ET NON computed) ; `$[k]` garde sa clé en
      // clair, évaluée à l'exécution (cf. isDynamicKey plus bas).
      if (
        node.left.type !== 'MemberExpression' ||
        node.left.object.type !== 'Identifier' ||
        node.left.object.name !== '$' ||
        (!node.left.computed && node.left.property.type !== 'Identifier')
      ) return

      const isDynamicKey = node.left.computed
      const varName = isDynamicKey ? null : node.left.property.name
      const op = node.operator

      // NB : toutes les branches font des édits de BORDURE (préfixe/suffixe) —
      // le chunk RHS reste EN PLACE dans MagicString, donc les transformations
      // déjà appliquées à l'intérieur (walk post-ordre : `$.y++`, `$.obj.k = v`
      // imbriqués…) survivent. Avant, un overwrite GLOBAL du nœud recopiait le
      // source ORIGINAL du RHS : le `$.y++` interne repartait brut → écriture
      // directe de `_state.y` SANS invalidation (DOM jamais mis à jour).

      // --- `$[k] = expr` / `$[k] op= expr` : clé DYNAMIQUE, évaluée à l'exécution ---
      // `$[k]` compilait comme `$.k` (le nom LITTÉRAL de la variable `k`, jamais sa
      // valeur) — écriture silencieuse sur la MAUVAISE clé. La clé reste EN PLACE dans
      // le texte (elle sert de 1er argument à `µ._set`) ; une 2e occurrence est
      // injectée pour la forme composée (`ms.slice`, pas `js.slice` : capture le
      // texte déjà éventuellement réécrit par une passe interne, jamais le brut).
      if (isDynamicKey) {
        const keyNode = node.left.property
        const parent = ancestors[ancestors.length - 2]
        const consuming = !!parent && (
          parent.type === 'AssignmentExpression' || parent.type === 'CallExpression' ||
          parent.type === 'NewExpression' || parent.type === 'BinaryExpression' ||
          parent.type === 'LogicalExpression' || parent.type === 'ConditionalExpression' ||
          (parent.type === 'ReturnStatement' && !isInlineHandlerReturn(ancestors))
        )
        const prefix = consuming ? '((_v) => (µ._set(_mjsThis, ' : 'µ._set(_mjsThis, '
        if (op === '=') {
          ms.overwrite(node.start, keyNode.start, prefix)
          ms.overwrite(keyNode.end, node.right.start, consuming ? ', _v), _v))(' : ', ')
          closeResidualParens(ms, node, ')')
          changed = true
          return
        }
        if (COMPOUND_OPS.has(op)) {
          const baseOp = op.slice(0, -1)
          const keyText = ms.slice(keyNode.start, keyNode.end)
          ms.overwrite(node.start, keyNode.start, prefix)
          ms.overwrite(keyNode.end, node.right.start, (consuming ? ', _v), _v))(' : ', ') + `$[${keyText}] ${baseOp} (`)
          closeResidualParens(ms, node, '))')
          changed = true
          return
        }
        return // opérateur ni `=` ni composé : rien à faire (aucun cas connu)
      }

      // --- Computed : RHS = { _mjs_c: true, f: () => ... } ---
      if (op === '=' && isComputedWrapper(node.right)) {
        // On garde le chunk de la fonction en place et on remplace seulement
        // l'enveloppe (`$.x = { _mjs_c…, f:` … `}`).
        const fnNode = (node.right as any).properties.find(
          (p: any) => p.key && p.key.name === 'f'
        )
        if (fnNode) {
          ms.overwrite(node.start, fnNode.value.start, `µ._mjs_setComputed(_mjsThis, '${varName}', `)
          ms.overwrite(fnNode.value.end, node.end, ')')
          changed = true
          return
        }
      }

      // Une affectation réactive dont la valeur est CONSOMMÉE (`$a = $b = v`, `notify($x = 5)`,
      // `return $x = v`, une forme composée en argument…) vaut exactement ce que vaudrait la même
      // écriture en JavaScript natif. Seule exception : le retour implicite d'un gestionnaire en
      // ligne (cf. isInlineHandlerReturn), lu par le routeur d'événements et jamais par du code.
      const parent = ancestors[ancestors.length - 2]
      const VALUE_CONSUMING = parent && (
        parent.type === 'AssignmentExpression' ||   // $a = ($b = v)
        parent.type === 'CallExpression'       ||   // notify($x = 5)
        parent.type === 'NewExpression'        ||   // new F($x = 5)
        parent.type === 'BinaryExpression'     ||   // ($l = next()) != null
        parent.type === 'LogicalExpression'    ||   // a && ($x = v)
        parent.type === 'ConditionalExpression'||   // c ? ($x = v) : w
        (parent.type === 'ReturnStatement' && !isInlineHandlerReturn(ancestors))   // return $x = v
      )

      // --- Assignation simple `$.x = expr` ---
      if (op === '=') {
        if (VALUE_CONSUMING) {
          ms.overwrite(node.start, node.right.start, `((_v) => (µ._set(_mjsThis, '${varName}', _v), _v))(`)
          closeResidualParens(ms, node, ')')
        } else {
          ms.overwrite(node.start, node.right.start, `µ._set(_mjsThis, '${varName}', `)
          closeResidualParens(ms, node, ')')
        }
        changed = true
        return
      }

      // --- Compound `$.x op= expr` → `µ._set(_mjsThis, 'x', $.x op (expr))` ---
      // Valeur CONSOMMÉE : même IIFE fidèle que l'assignation simple, autour du calcul complet.
      if (COMPOUND_OPS.has(op)) {
        const baseOp = op.slice(0, -1) // '+=' → '+'
        if (VALUE_CONSUMING) {
          ms.overwrite(node.start, node.right.start, `((_v) => (µ._set(_mjsThis, '${varName}', _v), _v))($.${varName} ${baseOp} (`)
          closeResidualParens(ms, node, '))')
        } else {
          ms.overwrite(node.start, node.right.start, `µ._set(_mjsThis, '${varName}', $.${varName} ${baseOp} (`)
          closeResidualParens(ms, node, '))')
        }
        changed = true
      }
    },

    UpdateExpression(node: any, _st: any, ancestors: any[]) {
      // `$.x++` / `++$.x` → `µ._set(_mjsThis, 'x', $.x + 1)` (et retourne post-/pre-).
      // `$[k]++` (clé DYNAMIQUE) accepté de la même façon que dans AssignmentExpression.
      if (
        node.argument.type !== 'MemberExpression' ||
        node.argument.object.type !== 'Identifier' ||
        node.argument.object.name !== '$' ||
        (!node.argument.computed && node.argument.property.type !== 'Identifier')
      ) return

      const isDynamicKey = node.argument.computed
      const op = node.operator === '++' ? '+' : '-'
      const parent = ancestors[ancestors.length - 2]

      // --- `$[k]++` / `--$[k]` : clé dynamique — la clé reste en place (1er argument
      // de `_set`), une copie de son texte ACTUEL (`ms.slice`) est injectée pour la ou
      // les lectures `$[k]` (`+` unaire : même conversion numérique que la forme fixe).
      if (isDynamicKey) {
        const keyNode = node.argument.property
        const keyText = ms.slice(keyNode.start, keyNode.end)
        let suffix: string
        if (parent && parent.type === 'ExpressionStatement') {
          ms.overwrite(node.start, keyNode.start, 'µ._set(_mjsThis, ')
          suffix = `, (+$[${keyText}]) ${op} 1)`
        } else if (node.prefix) {
          ms.overwrite(node.start, keyNode.start, '(µ._set(_mjsThis, ')
          suffix = `, (+$[${keyText}]) ${op} 1), $[${keyText}])`
        } else {
          ms.overwrite(node.start, keyNode.start, '((_v) => (µ._set(_mjsThis, ')
          suffix = `, (+_v) ${op} 1), +_v))($[${keyText}])`
        }
        ms.overwrite(keyNode.end, node.end, suffix)
        changed = true
        return
      }

      const varName = node.argument.property.name

      // ASI. Les deux formes fidèles commencent par `(`,
      // et Civet n'émet pas de point-virgule en fin d'instruction : posée en
      // STATEMENT après une autre ligne, la parenthèse ouvrante était lue comme
      // un APPEL de la ligne précédente —
      //   µ._set(_mjsThis, 'edite', null)((_v => …)($.compteur))
      // → « µ._set(...) is not a function », à l'exécution seulement (le JS émis
      // est syntaxiquement valide : ni le build, ni les tests, ni le SSR ne le
      // voyaient). Le piège ne se manifestait qu'« une fois sur deux » : en
      // DERNIÈRE ligne d'un bloc, Civet préfixe d'un `return` qui coupe la
      // continuation. En position STATEMENT la valeur de retour est ignorée par
      // définition — on émet donc la forme DIRECTE, qui commence par `µ` (plus
      // d'aliment pour l'ASI) et n'alloue plus de fermeture au passage.
      // `(+$.x)` : sémantique JS de `++`/`--`, qui convertissent TOUJOURS l'opérande en
      // nombre avant de l'incrémenter (`ToNumeric`) — sans ce `+` unaire, `"2" + 1`
      // concatène ("21") au lieu d'incrémenter (`"2" - 1`, lui, convertit déjà tout seul :
      // seul `++` était affecté en pratique, `+` unaire reste sans risque pour `--`).
      if (parent && parent.type === 'ExpressionStatement') {
        ms.overwrite(node.start, node.end, `µ._set(_mjsThis, '${varName}', (+$.${varName}) ${op} 1)`)
        changed = true
        return
      }

      // Valeur CONSOMMÉE (return, argument d'appel, condition…) : forme fidèle.
      // Pre-fix `++$.x` rend la nouvelle valeur (déjà numérique, écrite par `_set`
      // ci-dessus) ; post-fix `$.x++` rend l'ANCIENNE valeur, elle aussi convertie en
      // nombre (`+_v`) — jamais la chaîne d'origine.
      // Aucun risque d'ASI ici : le nœud n'ouvre jamais une instruction.
      const replacement = node.prefix
        ? `(µ._set(_mjsThis, '${varName}', (+$.${varName}) ${op} 1), $.${varName})`
        : `((_v => (µ._set(_mjsThis, '${varName}', (+_v) ${op} 1), +_v))($.${varName}))`
      ms.overwrite(node.start, node.end, replacement)
      changed = true
    },
  })

  return passResult(ms, js, changed, 'transform-reactive')
}

// ----------------------------------------------------------------------------
// Détecte les ObjectExpression de la forme `{ _mjs_c: true, f: ... }`
// ----------------------------------------------------------------------------
function isComputedWrapper(node: any): boolean {
  if (!node || node.type !== 'ObjectExpression') return false
  const props = node.properties ?? []
  const hasMarker = props.some((p: any) =>
    p.type === 'Property' &&
    p.key && (p.key.name === '_mjs_c' || p.key.value === '_mjs_c') &&
    p.value && p.value.type === 'Literal' && p.value.value === true
  )
  const hasF = props.some((p: any) =>
    p.type === 'Property' && p.key && p.key.name === 'f'
  )
  return hasMarker && hasF
}

// ----------------------------------------------------------------------------
// collecte les cibles `$.x` d'un motif de destructuration (ArrayPattern /
// ObjectPattern), RÉCURSIF — jamais le RHS d'un AssignmentPattern (une valeur
// par défaut est une LECTURE, pas une cible d'écriture)
// ----------------------------------------------------------------------------
function collectStateTargets(pattern: any, out: any[]): void {
  if (!pattern) return // trou d'ArrayPattern ([a, , b]) ou branche absente

  switch (pattern.type) {
    case 'ArrayPattern':
      for (const el of pattern.elements) collectStateTargets(el, out)
      return

    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        collectStateTargets(prop.type === 'RestElement' ? prop.argument : prop.value, out)
      }
      return

    case 'AssignmentPattern': // `$.x = defaut` : cible = left, JAMAIS right (une lecture)
      collectStateTargets(pattern.left, out)
      return

    case 'RestElement':
      collectStateTargets(pattern.argument, out)
      return

    case 'MemberExpression':
      if (
        !pattern.computed &&
        pattern.object.type === 'Identifier' &&
        pattern.object.name === '$' &&
        pattern.property.type === 'Identifier'
      ) out.push(pattern)
      return
  }
}

// ----------------------------------------------------------------------------
// ferme un RHS potentiellement parenthésé dans le source
// acorn ne matérialise pas les parens en nœud AST : node.right reste borné à
// l'expression réelle, jamais aux parenthèses qui l'entourent — le résidu de
// `)` entre node.right.end et node.end (s'il existe) est écrasé plutôt que
// laissé survivre à côté de la fermeture ajoutée (overwrite d'une plage vide
// lève dans MagicString, d'où le repli appendLeft quand il n'y a pas de résidu)
// ----------------------------------------------------------------------------
function closeResidualParens(ms: MagicString, node: any, closer: string): void {
  if (node.right.end < node.end) ms.overwrite(node.right.end, node.end, closer)
  else ms.appendLeft(node.end, closer)
}
