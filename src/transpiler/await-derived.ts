// valeur dérivée qui attend (`$resultats = await rechercher($q)`) : la dérivée que le compilateur a faite de la ligne
// (`µ._mjs_setComputed(_mjsThis, 'resultats', async () => …)`, une flèche `async` parce que son expression attend, hors de toute
// fonction qu'elle contient) devient `µ._mjs_setAwait(_mjsThis, 'resultats', async (_mjs_sig) => …, ['q'], lu)`
// (runtime/mjs_await_derived.ts). Le 4e argument : les variables suivies, toutes celles que l'expression cite (`$.x`, `$$x` du
// magasin), même après le premier `await`, et ce que lisent les dérivées ordinaires citées, jusqu'à la première valeur qui attend
// (`$b = await g($a)` suit `$a`, pas ce que `$a` cite) ; le 5e : 1 quand le composant lit l'erreur. Les lectures directes d'une valeur
// qui attend (`$.x.length`, `$.x[0]`, `$.x.map(…)`) se font comme avec `?.` : avant la première réponse, elles rendent undefined ;
// la source d'une boucle, d'un étalement ou d'une décomposition se lit vide (`[]`, `{}`) ;
// en développement (`dev`), la valeur passe par `µ._mjs_awSeen`, qui dit une fois par variable et par composant quoi écrire, le conseil de la forme lue. `µsignal` lu dans l'expression y
// est le signal de l'appel. `µpending($resultats)` et `µfailed($resultats)`, partout dans le composant, lisent son état
// (`µ._mjs_awPending(_mjsThis, 'resultats')`, `µ._mjs_awFailed(…)`) ; `µerror(…)` reste la fonction du journal. Posé sur le texte
// fini, comme le repère de µload (load-sites.ts). Refusés à la construction, avec la forme juste : la valeur qui attend écrite à la main
// (`µ._set(_mjsThis, 'resultats', …)` : la réponse suivante l'écraserait), un bloc {await} qui traite la valeur qui attend
// comme une promesse (`{await $resultats}`, `{await $resultats ?? []}`, `{await $resultats.then(…)}`, `{await Promise.all([$resultats])}` : jamais une promesse, sa branche d'attente ne se montrait pas), `µsignal` lu hors de son expression (il n'y vaut rien),
// `µpending($n)` et `µfailed($n)` sur une variable qui n'attend pas (« µ.pending is not a function » à l'affichage), `µpending` mal
// écrit (`µpending()`, `µpending($$x)`, `µpending($x.a)` ; `µfailed` mal écrit l'est au lexeur) ; ces refus-là même sans valeur qui
// attend dans le composant. Chaque refus cite sa ligne du fichier tel qu'écrit (`ecrit`, gabarit compris), cherchée sur le code, chaînes
// et commentaires masqués, et seulement avec certitude ; le champ lié qui écrit la valeur est nommé tel qu'écrit (`:group=!{$r}`), avec la
// ligne de sa balise, par le générateur (`champs`) ; le conseil suit la langue du script (`($r or [])`, `($r || [])` en JavaScript) et
// sa boucle (`for … from` en CoffeeScript) ; un champ qui n'est pas celui d'une liste (`$r.nom`) n'en reçoit aucun : il rend
// undefined avec ou sans `or []`

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import MagicString from 'magic-string'
import { readableAssetImports } from './load-sites.js'
import { t } from '../messages/index.js'
import { writtenLine, writtenName, type WrittenScript } from '../analyzer/await-outside-derived.js'

const AWAIT_RE = /µ\._mjs_setComputed\(_mjsThis, '[^']+', async\b/
// `µpending(…)`, `µfailed($x)`, `µsignal` lus hors d'un bloc {await}
const RUNES_RE = /µ\.(?:pending\(|failed\(\$)|µ\.signal(?![\w$])/
// les champs d'une liste (`length`, `map`, `filter`…) : là, `($r or [])` change ce que rend la lecture faite avant la réponse
const LIST_FIELDS = new Set(Object.getOwnPropertyNames(Array.prototype))

// `µ.nom` (membre direct, non calculé)
const mu = (n: any, name?: string) => n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === 'µ' && n.property.type === 'Identifier' && (name === undefined || n.property.name === name)

// le nom de la variable du composant que lit `n` : `$.x`, `$['x']`, ou la lecture suivie par un reffet
// (`$[(µ._mjs_sigCur && µ._mjs_sigRead(_mjsThis, 'x'), 'x')]`) ; null sinon
function dollarName(n: any): string | null {
  if (n.type !== 'MemberExpression' || n.object.type !== 'Identifier' || n.object.name !== '$') return null
  if (!n.computed) return n.property.type === 'Identifier' ? n.property.name : null
  const p = n.property.type === 'SequenceExpression' ? n.property.expressions[n.property.expressions.length - 1] : n.property
  return p.type === 'Literal' && typeof p.value === 'string' ? p.value : null
}
const dollar = (n: any) => dollarName(n) !== null

// le nom de la valeur qui attend (parmi `noms`) que l'expression `n` peut rendre telle quelle : la variable seule (entre parenthèses aussi),
// un opérande de `??`, de `||` ou de `&&` (le premier de `&&`, vide jusqu'à la réponse, est alors rendu tel quel, ce qu'une promesse,
// jamais fausse, n'était pas), une branche de `? :` ; null pour un appel qui la cite, un champ, une promesse
function rendered(n: any, names: Set<string>): string | null {
  if (n.type === 'LogicalExpression') return rendered(n.left, names) ?? rendered(n.right, names)
  if (n.type === 'ConditionalExpression') return rendered(n.consequent, names) ?? rendered(n.alternate, names)
  const name = dollarName(n)
  return name !== null && names.has(name) ? name : null
}

// les valeurs qu'un appel `Promise.*` attend : ses arguments, et les éléments d'une liste écrite (`Promise.all([$a, $b])`)
const awaitedBy = (args: any[]) => args.flatMap((a) => a.type === 'ArrayExpression' ? a.elements : [a]).filter((e) => e !== null && e.type !== 'SpreadElement')

// un élément de liste qui ne peut pas être une promesse : un trou, une valeur écrite (`1`, `'a'`, `null`, `-1`, une chaîne sans
// expression), une valeur qui attend rendue telle quelle (cf. rendue) ; un appel, une variable, un champ, un étalement en sont peut-être une
function fixed(e: any, names: Set<string>): boolean {
  if (e === null || e.type === 'Literal' || (e.type === 'TemplateLiteral' && e.expressions.length === 0) || (e.type === 'Identifier' && e.name === 'undefined')) return true
  return e.type === 'UnaryExpression' ? fixed(e.argument, names) : rendered(e, names) !== null
}

// le nom de la valeur qui attend qu'un appel `Promise.<methode>(args)` reçoit sans rien pouvoir attendre : `Promise.resolve($fiche)` ;
// une liste de `Promise.all` ou `allSettled` qui la porte seule, ou avec des valeurs écrites (`[$fiche]`, `[$fiche, 1]` : un succès tout
// de suite ; un appel ou une autre promesse dans la liste la fait attendre, puis donne la fiche) ; une liste de `Promise.race` ou `any`
// qui la porte (jamais une promesse, elle est rendue tout de suite, avant tout appel) ; null sinon
function promiseOn(method: string, args: any[], names: Set<string>): string | null {
  let name: string | null = null
  for (const v of awaitedBy(args)) name ??= rendered(v, names)
  if ((method === 'all' || method === 'allSettled') && args[0]?.type === 'ArrayExpression' && !args[0].elements.every((e: any) => fixed(e, names))) return null
  return name
}

// le parcours d'une tête sans entrer dans ses fonctions : le corps d'un rappel (`.then((r) -> …)`) court plus tard, sur d'autres valeurs
const outsideCallbacks = { ...walk.base, Function() {} }

// le nom de la valeur qui attend que la tête `tete` d'un bloc {await} traite comme une promesse : rendue telle quelle (cf. rendue), ou,
// dans la tête hors du corps de ses rappels, sa méthode de promesse appelée (`$fiche.then(…)`, `.catch`, `.finally` : « … is not a
// function » à la réponse) ou donnée à `Promise.*` sans rien d'autre à attendre (cf. promiseOn : un succès tout de suite, sans la
// réponse) ; null pour un appel ordinaire qui la cite (il reçoit undefined jusqu'à la réponse, puis la réponse), un champ, une promesse
function asPromise(head: any, names: Set<string>): string | null {
  let name = rendered(head, names)
  walk.simple(head, {
    CallExpression(c: any) {
      if (name !== null || c.callee.type !== 'MemberExpression' || c.callee.computed) return
      if (['then', 'catch', 'finally'].includes(c.callee.property.name)) name = rendered(c.callee.object, names)
      else if (c.callee.object.type === 'Identifier' && c.callee.object.name === 'Promise') name = promiseOn(c.callee.property.name, c.arguments, names)
    },
  }, outsideCallbacks)
  return name
}

// les variables qu'une expression lit : `$.x` → `x`, `µ.store.x` → `$$x` (les clés que le cœur invalide)
function readsOf(fn: any): Set<string> {
  const seen = new Set<string>()
  walk.simple(fn.body, {
    MemberExpression(m: any) {
      const v = dollarName(m)
      if (v !== null) seen.add(v)
      else if (!m.computed && mu(m.object, 'store') && m.property.type === 'Identifier') seen.add('$$' + m.property.name)
    },
  })
  return seen
}

export function awaitDerived(js: string, module: string, dev = false, written?: WrittenScript, lang = 'civet', fields: Array<{ field: string, written: string, line?: number }> = [], writtenBlocks: Array<{ id: string, expr: string, keep: boolean }> = []): { code: string, map?: string } {
  if (!AWAIT_RE.test(js) && !RUNES_RE.test(js)) return { code: js }
  let ast: acorn.Node
  try {
    ast = acorn.parse(readableAssetImports(js), { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true })
  }
  catch {
    return { code: js }
  }
  const derived     = new Map<string, Set<string>>()
  const waits        = [] as any[]
  const runes        = [] as any[]
  const writes       = [] as any[]
  const signals      = [] as any[]
  const functions    = [] as any[]
  const badlyWritten = [] as any[]
  const blocks       = [] as any[]
  walk.simple(ast, {
    MemberExpression(m: any) {
      if (mu(m, 'signal')) signals.push(m)
    },
    // les fonctions du texte, les plus profondes d'abord (le parcours les voit en sortant)
    Function(f: any) {
      functions.push(f)
    },
    CallExpression(node: any) {
      const args = node.arguments
      // un bloc {await} du gabarit : `this._mjs_updAwait(id, () => (…), …)`
      if (node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.object.type === 'ThisExpression' && node.callee.property.name === '_mjs_updAwait') blocks.push(node)
      if (!mu(node.callee)) return
      const name = node.callee.property.name
      if (name === '_mjs_setComputed' && args.length >= 3 && args[1].type === 'Literal' && /Function/.test(args[2].type)) {
        derived.set(args[1].value, readsOf(args[2]))
        if (args[2].async) waits.push(node)
      }
      else if ((name === 'pending' || name === 'failed') && args.length === 1 && dollar(args[0])) runes.push(node)
      else if (name === 'pending') badlyWritten.push(node)
      else if (name === '_set' && args.length >= 3 && args[0].type === 'Identifier' && args[0].name === '_mjsThis' && args[1].type === 'Literal') writes.push(node)
    },
  })
  const names = new Set(waits.map((n) => n.arguments[1].value as string))
  // `µpending` sans variable seule entre ses parenthèses : la forme écrite, redite comme dans la source (`$$x`, `$x.a`)
  if (badlyWritten.length > 0) {
    const forms = badlyWritten.map((n) => 'µpending(' + (n.arguments.length ? js.slice(n.arguments[0].start, n.arguments[n.arguments.length - 1].end) : '').replace(/µ\.store\./g, '$$$$').replace(/\$\./g, '$') + ')')
    // la ligne seulement quand toutes les formes mal écrites sont la même : sinon, laquelle citer ?
    const { moduleName, line } = writtenLine(written, /µpending\s*\((?!\s*\$\w+\s*\))/, forms.every((f) => f === forms[0]) ? forms.length : -1)
    throw new Error(t('transpiler.await-pending-misspelled', { written: forms[0], moduleName, line: line }))
  }
  for (const r of runes) {
    const name = dollarName(r.arguments[0])!
    const rune = r.callee.property.name
    if (names.has(name)) continue
    const same = runes.filter((x) => x.callee.property.name === rune && dollarName(x.arguments[0]) === name).length
    const { moduleName, line } = writtenLine(written, new RegExp(`µ${rune}\\s*\\(\\s*` + writtenName('$' + name) + '\\s*\\)'), same)
    throw new Error(t('transpiler.await-rune-variable-ordinary', { rune, name: name, moduleName, line: line }))
  }
  // le gestionnaire que le compilateur écrit à une liaison (`value=!{$r}`, `:group=!{$r}`…) : `(_mjs_e, _mjs_el) => …`
  const bound = (e: any) => functions.some((f) => f.start <= e.start && e.end <= f.end && f.params.length === 2 && f.params[1].type === 'Identifier' && f.params[1].name === '_mjs_el')
  for (const e of writes) {
    const name = e.arguments[1].value
    if (!names.has(name)) continue
    // un champ lié : le champ et la ligne de sa balise tels que le générateur les connaît
    const field = bound(e) ? fields.find((c) => c.written === '$' + name) : undefined
    if (field !== undefined) {
      // son nom tel qu'écrit sur la ligne de la balise : le gabarit lu range `:group` sous `@group`, la même liaison
      const fieldLine = field.line === undefined || written === undefined ? undefined : written.lines[field.line - written.first]
      const writtenAs = fieldLine === undefined ? null : new RegExp('(?<![\\w-])([:@]?' + field.field.replace(/^[:@]/, '') + ')\\s*=\\s*!\\{\\s*' + writtenName('$' + name) + '\\s*\\}').exec(fieldLine)
      throw new Error(t('transpiler.await-field-bound', { field: writtenAs?.[1] ?? field.field, name: name, moduleName: written?.moduleName ?? '', line: field.line ?? '' }))
    }
    // une écriture à la main (`=`, `?=`, `+=`, `++`…), jamais la valeur elle-même (`$r = await …`, sur une ligne ou deux) ; citée si le texte
    // en porte autant que le code
    const main = bound(e) ? -1 : writes.filter((x) => x.arguments[1].value === name && !bound(x)).length
    const { moduleName, line } = writtenLine(written, new RegExp(writtenName('$' + name) + '\\s*(?:(?:[-+*/%?]|\\|\\||&&|\\?\\?)?=(?![=>:])(?!\\s*await\\b)|\\+\\+|--)|(?:\\+\\+|--)\\s*' + writtenName('$' + name)), main)
    throw new Error(t('transpiler.await-written-by-hand', { name: name, where: lang === 'civet' || lang === 'coffee' ? 'or' : '||', moduleName, line: line }))
  }
  const free = signals.filter((s) => !waits.some((n) => n.arguments[2].start <= s.start && s.end <= n.arguments[2].end))
  if (free.length > 0) {
    // le premier µsignal fautif : les µsignal du texte et ceux du code, dans le même ordre, tous dans les scripts et aussi nombreux des deux
    // côtés (un µsignal permis, plus haut, compte : sa place dit celle du fautif)
    const all                  = [...signals].sort((a, b) => a.start - b.start)
    const k                    = all.indexOf([...free].sort((a, b) => a.start - b.start)[0])
    const { moduleName, line } = writtenLine(written, /µsignal(?![\w$])/, all.length, k, true)
    throw new Error(t('transpiler.await-signal-outside-expression', { moduleName, line: line }))
  }
  // un bloc {await} qui traite une valeur qui attend comme une promesse (`{await $fiche}`, `{await ($fiche)}`, `{await $fiche ?? null}`,
  // `{await $ok ? $fiche : null}`, `{await $fiche.then(…)}`, `{await Promise.all([$fiche])}`, cf. asPromise) : elle vaut undefined
  // jusqu'à la réponse, jamais une promesse, et le bloc ne montrait pas sa branche d'attente. Refusé, avec les deux formes à écrire ; la
  // tête du bloc citée telle qu'écrite, effet compris (`writtenBlocks`, du générateur, par l'id du bloc), sa ligne si le fichier écrit porte
  // cette tête autant de fois que le générateur
  const read         = (b: any) => b.arguments[1]?.type === 'ArrowFunctionExpression' && b.arguments[1].expression ? asPromise(b.arguments[1].body, names) : null
  const awaitedBlock = blocks.find((b) => read(b) !== null)
  if (awaitedBlock !== undefined) {
    const name                 = read(awaitedBlock)!
    const head                 = writtenBlocks.find((b) => b.id === awaitedBlock.arguments[0]?.value)
    const word                 = head?.keep ? 'await.keep' : 'await'
    const same                 = head === undefined ? -1 : writtenBlocks.filter((b) => b.expr === head.expr && b.keep === head.keep).length
    const shape                = new RegExp('\\{\\s*' + word.replace('.', '\\.') + '\\s+' + (head?.expr ?? '').replace(/[$.*+?^()[\]{}|\\]/g, '\\$&') + '\\s*\\}')
    const { moduleName, line } = writtenLine(written, shape, same)
    throw new Error(t('transpiler.await-block-on-pending-value', { written: head === undefined ? '{await …}' : `{${word} ${head.expr.replace(/\s*\n\s*/g, ' ')}}`, name: name, moduleName, line: line }))
  }
  if (waits.length === 0) return { code: js }
  // ce qu'une valeur qui attend suit : ce qu'elle lit, et ce que lisent les dérivées ordinaires lues, jusqu'à une valeur qui attend
  const tracked = (k: string, seen = new Set<string>()) => {
    for (const d of derived.get(k) ?? []) {
      if (seen.has(d)) continue
      seen.add(d)
      if (derived.has(d) && !names.has(d)) tracked(d, seen)
    }
    return seen
  }
  const ms         = new MagicString(js)
  const readErrors = new Set<string>()
  for (const r of runes) {
    const variable = dollarName(r.arguments[0])!
    if (!names.has(variable)) continue
    const read = r.callee.property.name === 'pending' ? '_mjs_awPending' : '_mjs_awFailed'
    if (read === '_mjs_awFailed') readErrors.add(variable)
    ms.overwrite(r.start, r.end, `µ.${read}(_mjsThis, '${variable}')`)
  }
  for (const node of waits) {
    const args = node.arguments
    const fn   = args[2]
    const k    = args[1].value as string
    ms.overwrite(node.callee.property.start, node.callee.property.end, '_mjs_setAwait')
    // la fonction reçoit le signal de l'appel ; des sources de valeur précise (4e argument) ne servent pas ici
    if (fn.params.length === 0) ms.appendLeft(js.indexOf('(', fn.start) + 1, '_mjs_sig')
    if (args.length > 3) ms.remove(fn.end, args[args.length - 1].end)
    ms.appendLeft(fn.end, ', ' + JSON.stringify([...tracked(k)]).replace(/"/g, '\'') + (readErrors.has(k) ? ', 1' : ''))
    walk.simple(fn.body, {
      MemberExpression(m: any) {
        if (mu(m, 'signal')) ms.overwrite(m.start, m.end, '_mjs_sig')
      },
    })
  }
  // la valeur qui attend au pied d'une chaîne (`$.x`, `$.x.a`, `$.x.map(…)`) ; null sinon, et pour un appel (`compter($.x)`)
  const root = (e: any): string | null => {
    for (;;) {
      if (e.type === 'ChainExpression') e = e.expression
      else if (e.type === 'CallExpression' && e.callee.type === 'MemberExpression') e = e.callee.object
      else if (e.type === 'MemberExpression' && dollarName(e) === null) e = e.object
      else break
    }
    const v = dollarName(e)
    return v !== null && names.has(v) ? v : null
  }
  // la source d'une boucle, d'un étalement ou d'une décomposition, lue vide (`[]`, `{}`) tant qu'elle vaut undefined ; nue, elle passe
  // aussi par `µ._mjs_awSeen` en développement
  // `conseil` : la forme à écrire, dans la langue du script (`($r or [])`, `($r || [])` en JavaScript)
  const where = lang === 'civet' || lang === 'coffee' ? 'or' : '||'
  const safe  = (v: string, empty: string) => `($${v} ${where} ${empty})`
  const wrap  = (e: any, v: string, empty: string, text: string, tip: string) => {
    if (dev && dollarName(e) !== null) {
      ms.prependRight(e.start, 'µ._mjs_awSeen(')
      ms.appendLeft(e.end, `, _mjsThis, '${v}', '${text}', '${tip}')`)
    }
    ms.prependRight(e.start, '(')
    ms.appendLeft(e.end, ' ?? ' + empty + ')')
  }
  // la lecture directe d'une valeur qui attend, protégée ; le haut de sa chaîne (`$.x.a.b`, `$.x.map(…).length`) écrit
  // (`$.x.a = …`, `$.x.n++`) : laissée telle quelle
  walk.ancestor(ast, {
    MemberExpression(m: any, _walkState: any, parents: any[]) {
      const v = dollarName(m.object)
      if (v === null || !names.has(v) || m.optional) return
      let top = m
      for (let i = parents.length - 2; i >= 0; i--) {
        const p = parents[i]
        if ((p.type === 'MemberExpression' && p.object === top) || (p.type === 'CallExpression' && p.callee === top) || p.type === 'ChainExpression') {
          top = p
          continue
        }
        if ((p.type === 'AssignmentExpression' && p.left === top) || p.type === 'UpdateExpression' || ((p.type === 'ForInStatement' || p.type === 'ForOfStatement') && p.left === top)) return
        break
      }
      if (dev) {
        ms.prependRight(m.object.start, 'µ._mjs_awSeen(')
        const rest = m.computed ? '[…]' : '.' + m.property.name
        // `($r or [])` là où une liste est attendue (un index, `.length`, `.map(…)`) ; un autre champ (`$r.nom`) : sans conseil, l'avis dit
        // ce que rend la lecture
        const tip = m.computed || LIST_FIELDS.has(m.property.name) ? `, '${safe(v, '[]')}${rest}'` : ''
        ms.appendLeft(m.object.end, `, _mjsThis, '${v}', '$${v}${rest}'${tip})`)
      }
      ms.appendLeft(m.object.end, m.computed ? '?.' : '?')
    },
    // ce qu'une boucle parcourt (`for (const v of $.x)`, une compréhension) : une liste vide ; écrite `for … from` en CoffeeScript, où
    // `for … of` parcourt les clés
    ForOfStatement(n: any) {
      const v    = root(n.right)
      const loop = lang === 'coffee' ? 'for … from ' : 'for … of '
      if (v !== null) wrap(n.right, v, '[]', loop + '$' + v, loop + safe(v, '[]'))
    },
    // un étalement dans une liste ou un appel (`[...$.x]`, `f(...$.x)`) : une liste vide ; dans un objet, undefined ne lève pas
    SpreadElement(n: any, _walkState: any, parents: any[]) {
      const v = root(n.argument)
      if (v !== null && parents[parents.length - 2].type !== 'ObjectExpression') wrap(n.argument, v, '[]', '...$' + v, '...' + safe(v, '[]'))
    },
    // la source d'une décomposition (`{nom} = $.x`, `[a] = $.x`) : un objet ou une liste vide
    VariableDeclarator(n: any) {
      const v = n.init && (n.id.type === 'ObjectPattern' || n.id.type === 'ArrayPattern') ? root(n.init) : null
      const empty = n.id.type === 'ObjectPattern' ? '{}' : '[]'
      if (v !== null) wrap(n.init, v, empty, (empty === '{}' ? '{…}' : '[…]') + ' = $' + v, (empty === '{}' ? '{…}' : '[…]') + ' = ' + safe(v, empty))
    },
    AssignmentExpression(n: any) {
      const v = n.left.type === 'ObjectPattern' || n.left.type === 'ArrayPattern' ? root(n.right) : null
      const empty = n.left.type === 'ObjectPattern' ? '{}' : '[]'
      if (v !== null) wrap(n.right, v, empty, (empty === '{}' ? '{…}' : '[…]') + ' = $' + v, (empty === '{}' ? '{…}' : '[…]') + ' = ' + safe(v, empty))
    },
  })
  return { code: ms.toString(), map: ms.generateMap({ hires: true, source: module + '.js', file: module + '.js' }).toString() }
}
