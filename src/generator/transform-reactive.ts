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
//
// Formes d'écriture et règles de POSITION communes aux deux passes d'écriture (celle-ci et
// path-tracker.ts) : emit-write.ts.

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import MagicString from 'magic-string'
import { passResult, type PassResult } from './pass-map.js'
import { COMPOUND_OPS, forEachPatternLeaf, parseModule } from './ast-helpers.js'
import { asiGuard, closeRhs, emitAssign, emitPattern, emitUpdate, rhsStart, writeValueUnused, type WriteTarget } from './emit-write.js'

// historique : path-tracker.ts et des appelants les importaient d'ici
export { asiGuard, closeRhs, isInlineHandlerReturn, rhsStart, writeValueUnused } from './emit-write.js'

// clé calculée qu'on peut relire sans rien changer (identifiant, littéral, membre de ces formes…) :
// la forme courte la relit ; toute autre (appel, `i++`…) est évaluée UNE fois
function isPureKey(n: any): boolean {
  switch (n?.type) {
    case 'Identifier': case 'Literal': case 'ThisExpression': return true
    case 'MemberExpression': return isPureKey(n.object) && (!n.computed || isPureKey(n.property))
    case 'TemplateLiteral': return n.expressions.every(isPureKey)
    case 'UnaryExpression': return n.operator !== 'delete' && isPureKey(n.argument)
    case 'BinaryExpression': case 'LogicalExpression': return isPureKey(n.left) && isPureKey(n.right)
  }
  return false
}

// `await` / `yield` hors d'une fonction imbriquée : une valeur qui en contient ne peut pas passer dans
// une flèche
function hasAwaitOrYield(n: any): boolean {
  let trouve = false
  walk.recursive(n, null, {
    Function() {},
    AwaitExpression() { trouve = true },
    YieldExpression() { trouve = true },
  })
  return trouve
}

export function transformReactiveWrites(js: string): string {
  return transformReactiveWritesMapped(js).code
}

// Variante qui rend AUSSI la carte de source de cette passe — cf. pass-map.ts.
export function transformReactiveWritesMapped(js: string): PassResult {
  // `$[` aussi : un bloc qui n'écrit l'état que par une clé calculée (`$[k] = v`) n'a aucun `$.`
  if (!js || (!js.includes('$.') && !js.includes('$['))) return { code: js }

  let ast: acorn.Node
  try {
    ast = parseModule(js)
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

        // ASI, `void`, parenthèses du motif : cf. emitPattern
        emitPattern(ms, js, node, ancestors, targets, targets.map((t: any) => `µ._set(_mjsThis, '${t.property.name}', `), '_mjsD', '_mjsR')
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
      // Le préfixe court jusqu'à `rhsStart`, la fermeture passe par `closeRhs` (parenthèses autour
      // de la valeur : cf. rhsStart).
      //
      // Valeur LUE (cf. writeValueUnused) : l'écriture vaut exactement ce que vaudrait la même
      // écriture en JavaScript natif (`µ._set` rend un drapeau, jamais la valeur) ; non lue, la
      // forme directe, qui commence par `µ`.
      const unused = writeValueUnused(ancestors)
      const guard  = unused ? '' : asiGuard(ancestors)
      const start  = rhsStart(js, node)

      // --- `$[k] = expr` / `$[k] op= expr` : clé DYNAMIQUE, évaluée à l'exécution ---
      // `$[k]` compilait comme `$.k` (le nom LITTÉRAL de la variable `k`, jamais sa
      // valeur) — écriture silencieuse sur la MAUVAISE clé. La clé reste EN PLACE dans
      // le texte (elle sert de 1er argument à `µ._set`) ; une 2e occurrence est
      // injectée pour la forme composée (`ms.slice`, pas `js.slice` : capture le
      // texte déjà éventuellement réécrit par une passe interne, jamais le brut).
      // Clé à effet de bord (`$[cle()] += 1`) : jamais recopiée, elle passe UNE fois en argument
      // (`_k`) ; la valeur d'une forme composée devient une flèche (`_f`) appelée APRÈS la lecture de
      // `$[_k]`, comme en JavaScript (et seulement si `||=`/`&&=`/`??=` le demandent). Limite : une
      // valeur qui contient `await`/`yield` ne peut pas passer dans une flèche — forme courte, la clé
      // y est relue.
      if (isDynamicKey) {
        const keyNode = node.left.property
        const once    = !isPureKey(keyNode)
        let prefix: string, middle: string, closer: string
        if (op === '=') {
          if (unused) [prefix, middle] = ['µ._set(_mjsThis, ', ', ']
          else if (once) [prefix, middle] = [guard + '((_k, _v) => (µ._set(_mjsThis, _k, _v), _v))(', ', ']
          else [prefix, middle] = [guard + '((_v) => (µ._set(_mjsThis, ', ', _v), _v))(']
          closer = ')'
        }
        else if (COMPOUND_OPS.has(op)) {
          const baseOp = op.slice(0, -1)
          if (once && !hasAwaitOrYield(node.right)) {
            prefix = unused
              ? `void ((_k, _f) => µ._set(_mjsThis, _k, $[_k] ${baseOp} _f()))(`
              : `${guard}((_k, _f, _v) => (µ._set(_mjsThis, _k, _v = $[_k] ${baseOp} _f()), _v))(`
            middle = ', () => ('
          }
          else {
            const keyText = ms.slice(keyNode.start, keyNode.end)
            prefix = unused ? 'µ._set(_mjsThis, ' : guard + '((_v) => (µ._set(_mjsThis, '
            middle = (unused ? ', ' : ', _v), _v))(') + `$[${keyText}] ${baseOp} (`
          }
          closer = '))'
        }
        else return // opérateur ni `=` ni composé : rien à faire (aucun cas connu)
        ms.overwrite(node.start, keyNode.start, prefix)
        ms.overwrite(keyNode.end, start, middle)
        closeRhs(ms, node, start, closer)
        changed = true
        return
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

      // `$a = $b = v`, `notify($x = 5)`, `return $x = v`, `if $res = chercher(k)`… : valeur LUE, la
      // fermeture rend la valeur écrite. Seule exception à « lue » : le retour implicite d'un
      // gestionnaire en ligne (cf. isInlineHandlerReturn), lu par le routeur d'événements et jamais par du code.
      // Assignation simple `$.x = expr`, composée `$.x op= expr` → `µ._set(_mjsThis, 'x', $.x op (expr))` (cf. emitAssign)
      if (op === '=' || COMPOUND_OPS.has(op)) {
        emitAssign(ms, js, node, ancestors, localTarget(varName))
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
      const unused = writeValueUnused(ancestors)
      const guard = unused ? '' : asiGuard(ancestors)

      // --- `$[k]++` / `--$[k]` : clé dynamique — la clé reste en place (1er argument
      // de `_set`), une copie de son texte ACTUEL (`ms.slice`) est injectée pour la ou
      // les lectures `$[k]` (`+` unaire : même conversion numérique que la forme fixe).
      // Clé à effet de bord (`$[cle()]++`) : passée UNE fois en argument (`_k`), jamais recopiée.
      if (isDynamicKey) {
        const keyNode = node.argument.property
        let prefix: string, suffix: string
        if (!isPureKey(keyNode)) {
          prefix = unused ? `void ((_k) => µ._set(_mjsThis, _k, (+$[_k]) ${op} 1))(`
            : node.prefix ? `${guard}((_k) => (µ._set(_mjsThis, _k, (+$[_k]) ${op} 1), $[_k]))(`
            : `${guard}((_k, _v = +$[_k]) => (µ._set(_mjsThis, _k, _v ${op} 1), _v))(`
          suffix = ')'
        }
        else {
          const keyText = ms.slice(keyNode.start, keyNode.end)
          if (unused) {
            prefix = 'µ._set(_mjsThis, '
            suffix = `, (+$[${keyText}]) ${op} 1)`
          }
          else if (node.prefix) {
            prefix = guard + '(µ._set(_mjsThis, '
            suffix = `, (+$[${keyText}]) ${op} 1), $[${keyText}])`
          }
          else {
            prefix = guard + '((_v) => (µ._set(_mjsThis, '
            suffix = `, (+_v) ${op} 1), +_v))($[${keyText}])`
          }
        }
        ms.overwrite(node.start, keyNode.start, prefix)
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
      // continuation. Valeur non lue (instruction, élément d'une suite, pas d'un
      // `for`, cf. writeValueUnused) : on émet donc la forme DIRECTE, qui commence par `µ` (plus
      // d'aliment pour l'ASI) et n'alloue plus de fermeture au passage.
      // `(+$.x)` : sémantique JS de `++`/`--`, qui convertissent TOUJOURS l'opérande en
      // nombre avant de l'incrémenter (`ToNumeric`) — sans ce `+` unaire, `"2" + 1`
      // concatène ("21") au lieu d'incrémenter (`"2" - 1`, lui, convertit déjà tout seul :
      // seul `++` était affecté en pratique, `+` unaire reste sans risque pour `--`).
      // Valeur LUE (return, argument d'appel, condition…) : forme fidèle.
      // Pre-fix `++$.x` rend la nouvelle valeur (déjà numérique, écrite par `_set`) ; post-fix `$.x++` rend
      // l'ANCIENNE valeur, elle aussi convertie en nombre (`+_v`) — jamais la chaîne d'origine.
      // En tête d'instruction (`$x++ || f()`), le point-virgule protecteur coupe l'ASI. Cf. emitUpdate
      emitUpdate(ms, node, ancestors, localTarget(varName))
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
  forEachPatternLeaf(pattern, (leaf: any) => {
    if (
      leaf.type === 'MemberExpression' &&
      !leaf.computed &&
      leaf.object.type === 'Identifier' &&
      leaf.object.name === '$' &&
      leaf.property.type === 'Identifier'
    ) out.push(leaf)
  })
}

// cible `$.x` de l'état local (cf. emit-write.ts)
function localTarget(varName: string): WriteTarget {
  return { set: `µ._set(_mjsThis, '${varName}', `, read: `$.${varName}` }
}
