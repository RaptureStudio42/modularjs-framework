// utils — helpers cleanJs/cleanJsExpr, parseMixedString utilisés par le walker.
//
// `cleanJs(expr)` : un FRAGMENT du gabarit (corps de gestionnaire, liaison `!{…}`, attache, valeur d'un `{const}` relue par un
// gestionnaire, rappel de transition), rendu sans être compilé ici : du JavaScript lu par acorn (fragmentByTree), sinon le
// dialecte lu par l'arbre de Civet (dialectHandler) ; le code d'un gestionnaire est compilé plus loin, avec les autres
// (transpiler/index.ts).
//
// `cleanJsExpr(expr, externalVars, moduleName)` — pour les sites qui manipulent une VRAIE expression autonome (interpolation
// texte, valeur d'attribut, condition {if}/{elsif}/@class{}/@style{}/@flip{}, itérable {for}, expression {key}/{const}/{await}) :
// l'expression est lue par l'arbre (templateExpression) et compilée par Civet en SYNCHRONE (`compile(src, {js: true, sync:
// true})`), qui comprend nativement `->`/not/and/or/is/isnt/unless. Mémoïsée (Map module-level) : les mêmes expressions
// reviennent des centaines de fois sur un projet.
//
// Pourquoi `compile({sync:true})` et pas le duo `parse()`+`generate()` déjà
// écarté (« bug d'état partagé global » —
// `parseProgram()` pose des variables de MODULE (filename/config/sync) et ne
// les nettoie qu'en sortie de SA branche : un `parse()` isolé rappelé ensuite
// hérite d'un état non nettoyé, « Unconsumed input ») ? Parce que `compile()`
// EST déjà le chemin utilisé pour les `<script>` et les handlers inline
// (`civetAdapter.compileToJs`, languages/civet.ts) sans jamais rouvrir ce
// bug — la fonction reste sur SA branche synchrone de bout en bout (pose →
// utilise → nettoie dans le MÊME tour d'exécution) tant que `comptime` n'est
// pas actif (vérifié dans `@danielx/civet/dist/main.js` : seul `comptime`,
// jamais utilisé par ce projet, introduit un `await` avant le nettoyage).
// Seule différence ici : `sync: true` — `cleanJs`/`cleanJsExpr` sont appelés
// en SYNCHRONE (des centaines de fois depuis des callbacks de `.replace()`),
// aucun point d'`await` possible dans leur pile d'appel.

import { FaultFix } from '../fault-fix.js'
import { MU_FAILED_MALFORMED, failedWritten, RAW_ACCESS_BODY, RAW_ACCESS_PAREN_BODY, RAW_ACCESS_MALFORMED_BODY, rawAccessShapeError, MU_REFRESH_PAREN_BODY, MU_REFRESH_BODY, MU_REFRESH_REST_BODY, MU_REFRESH_BARE_BODY, MU_REFRESH_OUT, MU_REFRESH_STORE_OUT, refreshShapeError, refreshBareError, RAW_WRITE_BODY, RAW_WRITE_PAREN_BODY, RAW_WRITE_PAREN_OUT_OPEN, RAW_WRITE_OLD_SHAPE_BODY, RAW_WRITE_OLD_SHAPE_PAREN_BODY, rawWriteOldShapeError, BARE_SECTION_BODY, bareSectionError, RAW_ACCESS_OUT, RAW_ACCESS_STORE_OUT, RAW_WRITE_OUT, RAW_WRITE_STORE_OUT, MU_LAYOUT_WRITE_BODY, MU_LAYOUT_PREFIX_WRITE_BODY, MU_HOOKS_BODY, MU_DERIVED_BODY, MU_EVERY_BODY, componentTimer, MU_INSPECT_ARG_BODY, MU_INSPECT_ARG_OUT, MU_RUNE_STORE_BODY, MU_MINMAX_REMOVED_BODY, flatInspectPath, vaultRemovedError, importedSingletonError, rewriteMuImport, rewriteMuToggle, opensRegex, regexInArgument, scanRegexLiteral } from '../sigils.js'
import { skipQuotedSpan } from '../quoted-span.js'
import { stringEnd, hashCommentEnd, noHashComment, scanInertAt, maskInertSameLength, inertRanges, contextValueEnd, contextWrite, incrementContextRe, rewriteIncrement, convertCoffeeInterpolations, interpolationCode } from '../lexer/index.js'
import { createRequire } from 'node:module'
import * as acorn from 'acorn'
import { t } from '../messages/index.js'
import { rawTimers } from '../transpiler/timers.js'
import { paramReadOtherwise, ParamReadOtherwiseError } from '../languages/civet-params.js'
import { namedEntity } from './html-entities.js'
import { codeCounters } from '../reader/code.js'
import { HANDLER_DIRECTIVE, UNREADABLE_HANDLER, HANDLER_REJECT, SHAPED_RUNES, expressionCounters, disguiseExpression, wrapper, expressionByTree, dialectFragment, fragmentByTree, writtenReservedLetter, rejectDeclaration, reusedSigns } from '../reader/expression.js'

// regex globales des runes µ — bâties UNE fois sur les corps partagés
// (sigils.ts, source unique lexer↔cleanJs) ; seule la GARDE (lookbehind)
// reste locale à ce moteur
const RE_RAW_ACCESS_G                = new RegExp(`(?<![\\w.])${RAW_ACCESS_BODY}`, 'g')
const RE_RAW_ACCESS_PAREN_G          = new RegExp(`(?<![\\w.])${RAW_ACCESS_PAREN_BODY}`, 'g')
const RE_RAW_ACCESS_MALFORMED_G      = new RegExp(`(?<![\\w.])${RAW_ACCESS_MALFORMED_BODY}`, 'g')
const RE_RAW_WRITE_G                 = new RegExp(`(?<![\\w.])${RAW_WRITE_BODY}`, 'g')
const RE_RAW_WRITE_PAREN_G           = new RegExp(`(?<![\\w.])${RAW_WRITE_PAREN_BODY}`, 'g')
const RE_RAW_WRITE_OLD_SHAPE_G       = new RegExp(`(?<![\\w.])${RAW_WRITE_OLD_SHAPE_BODY}`, 'g')
const RE_RAW_WRITE_OLD_SHAPE_PAREN_G = new RegExp(`(?<![\\w.])${RAW_WRITE_OLD_SHAPE_PAREN_BODY}`, 'g')
const RE_BARE_SECTION_G              = new RegExp(`(?<![\\w.§])${BARE_SECTION_BODY}`, 'g')
const RE_MU_LAYOUT_WRITE_G           = new RegExp(`(?<![\\w.µ])${MU_LAYOUT_WRITE_BODY}`, 'g')
const RE_MU_LAYOUT_PREFIX_WRITE_G    = new RegExp(`(?<![\\w.µ])${MU_LAYOUT_PREFIX_WRITE_BODY}`, 'g')
const RE_MU_HOOKS_G                  = new RegExp(`(?<![\\w.µ])${MU_HOOKS_BODY}`, 'g')
const RE_FAILED_MALFORMED            = new RegExp(`(?<![\\w.µ])${MU_FAILED_MALFORMED}`)
const RE_MU_HOOKS                    = new RegExp(`(?<![\\w.µ])${MU_HOOKS_BODY}`)
const RE_MU_DERIVED_G                = new RegExp(`(?<![\\w.µ])${MU_DERIVED_BODY}`, 'g')
const RE_MU_EVERY_G                  = new RegExp(`(?<![\\w.µ])${MU_EVERY_BODY}`, 'g')
// remodelage d'arguments de µ.inspect — même corps que le script (aucune garde de tête
// supplémentaire : il cible la forme DÉJÀ pointée `µ.inspect`, avec ses propres gardes internes).
const RE_MU_INSPECT_ARG_G   = new RegExp(MU_INSPECT_ARG_BODY, 'g')
const RE_MU_REFRESH_PAREN_G = new RegExp(`(?<![\\w.])${MU_REFRESH_PAREN_BODY}`, 'g')
const RE_MU_REFRESH_G       = new RegExp(`(?<![\\w.])${MU_REFRESH_BODY}`, 'g')
const RE_MU_REFRESH_REST_G  = new RegExp(`(?<![\\w.])${MU_REFRESH_REST_BODY}`, 'g')
const RE_MU_REFRESH_BARE    = new RegExp(`(?<![\\w.])${MU_REFRESH_BARE_BODY}`)
// `µrefresh` permis dans le code d'un gestionnaire d'événement seulement (cf. cleanJsHandler) : ailleurs dans le gabarit, c'est le
// rendu qui l'évalue, et le redessin qu'il demande relancerait ce rendu — une boucle de rendu
let refreshAllowed = false

// Applique `fn` uniquement aux segments de CODE (hors littéraux '…', "…", `…`).
// Les regex de sucre ne doivent JAMAIS réécrire le contenu des chaînes :
// avant, `'this is fine'` devenait `'this === fine'` et `' and yet '`
// → `' && yet '` (corruption silencieuse de tout texte anglais).
// `dialecte` : code Civet, où une regex se passe aussi sans parenthèses (`s.replace /"/g, 'R'`, regexInArgument) — lue comme une
// division, son guillemet ouvrait une fausse chaîne, qui cachait la suite aux réécritures et la rendait à Civet coupée en deux
function mapCodeSegments(src: string, fn: (code: string) => string, dialect = false): string {
  let res = ''
  let i = 0
  const n = src.length
  let codeStart = 0
  while (i < n) {
    const ch = src[i]
    if (ch === '"' || ch === "'") {
      // Chaîne littérale inerte : copiée verbatim (aucun sucre à l'intérieur).
      res += fn(src.slice(codeStart, i))
      const end = skipQuotedSpan(src, i)
      res += src.slice(i, end)
      i = end
      codeStart = i
    } else if (ch === '`') {
      // Template literal : le TEXTE est inerte, mais chaque `${…}` contient
      // du CODE qui doit passer par le sucre (sinon `` `hi ${$x}` `` laisse `$x`
      // nu → ReferenceError). On récurse via mapCodeSegments sur le contenu du
      // `${…}` (pour re-découper ses propres chaînes correctement).
      res += fn(src.slice(codeStart, i))
      res += '`'
      let j = i + 1
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { res += src[j] + (src[j + 1] ?? ''); j += 2; continue }
        if (src[j] === '$' && src[j + 1] === '{') {
          // comptage des `{}` CONSCIENT des chaînes : sans ça,
          // un `}` littéral dans une chaîne de la fenêtre (`` `hi ${fn('}')}` ``)
          // décrémentait `depth` et fermait trop tôt (fin réelle copiée
          // verbatim hors zone traitée par `fn`) — même modèle qu'interpolateSigils
          // (lexer/index.ts:91-123, LE modèle à suivre).
          let k = j + 2, depth = 1, inner = ''
          let inStr = false
          let strCh = ''
          while (k < n && depth > 0) {
            const c = src[k]
            if (inStr) {
              if (c === '\\') { inner += c + (src[k + 1] ?? ''); k += 2; continue }
              if (c === strCh) inStr = false
            } else if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c }
            else if (c === '{') depth++
            else if (c === '}') { depth--; if (depth === 0) break }
            inner += c
            k++
          }
          res += '${' + mapCodeSegments(inner, fn, dialect) + '}'
          j = k + 1
        } else {
          res += src[j]
          j++
        }
      }
      if (j < n) res += '`'
      i = j + 1
      codeStart = i
    } else if (ch === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && (opensRegex(src.slice(0, i)) || (dialect && regexInArgument(src, i)))) {
      // littéral regex `/…/` : ZONE INERTE comme une chaîne — sans ce garde-fou, `/§/` levait la
      // garde « § nu » et `/µTotal/` sortait réécrit `/µ.Total/` EN PLEIN MILIEU du littéral.
      // `src[i + 1] !== '/'/'*'` écarte D'ABORD un commentaire (`//`/`/*`, jamais
      // masqués ICI — hors périmètre de ce correctif, cf. noComments) : un `/*…*/` pris pour
      // une regex s'arrêterait au premier `/` interne, pas à son vrai `*/`. `scanRegexLiteral`
      // rend -1 si aucun `/` fermant n'apparaît avant la fin de ligne (une division ne se referme
      // jamais) : ce `/` retombe alors sur le `i++` générique, code normal.
      const end = scanRegexLiteral(src, i)
      if (end === -1) { i++ }
      else { res += fn(src.slice(codeStart, i)); res += src.slice(i, end); i = end; codeStart = i }
    } else {
      i++
    }
  }
  res += fn(src.slice(codeStart))
  return res
}

// rewriteMasked — applique `build(name, op, rhs)` à CHAQUE occurrence de `re` (groupe 1 =
// nom, groupe 2 = opérateur d'une affectation composée, groupe 3 = RHS) trouvée sur une VUE MASQUÉE de `raw` (chaînes/gabarits/
// commentaires neutralisés en espaces MÊME LONGUEUR, `maskInertSameLength`) — jamais à
// l'intérieur d'un littéral. Les offsets restant alignés sur `raw`, `name`/`rhs` sont
// relus dans `raw` via `m.indices` (drapeau `d`) : toujours le texte RÉEL, y compris
// quand le RHS EST une chaîne littérale (`'fr'`), qui n'apparaît qu'en espaces dans la
// vue masquée. Même technique que transpiler/sections.ts (maskInertSameLength + `d`).
// Le RHS s'arrête avant un `if`/`unless` postfixe ou le `then`/`else` d'un `if` qui englobe le setter
// (contextValueEnd, lexer/index.ts, partagé avec le <script>) ; la suite se relit alors : elle peut
// porter un autre setter (`if $ok then §x = 1 else §x = 2`).
function rewriteMasked(raw: string, re: RegExp, build: (name: string, op: string | undefined, rhs: string) => string): string {
  const masked = maskInertSameLength(raw)
  let out    = ''
  let cursor = 0
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(masked)) !== null) {
    const idx                = m.indices!
    const [start, end]       = idx[0]
    const [rhsStart, rhsEnd] = idx[3]
    let stop                  = end
    const cut              = rhsStart + contextValueEnd(masked.slice(rhsStart, rhsEnd), raw.slice(rhsStart, rhsEnd))
    if (cut < rhsEnd) {
      stop = cut
      while (stop > rhsStart && /\s/.test(raw[stop - 1])) stop--
      re.lastIndex = stop
    }
    out += raw.slice(cursor, start) + build(raw.slice(...idx[1]), m[2], raw.slice(rhsStart, stop))
    cursor = stop
  }
  return out + raw.slice(cursor)
}

// Setters de contexte `§x = …`/`§§x = …` — communs aux DEUX moteurs (passe SYMBOLES,
// TOUJOURS appliquée), traités AVANT le découpage des chaînes (mapCodeSegments) pour
// la même raison qu'avant : le RHS peut ÊTRE une chaîne littérale (`§§lang = 'fr'`) —
// une fois isolé par mapCodeSegments, le setter capturerait un RHS vide →
// `_mjs_setRCtx('lang', )'fr'` (SyntaxError). Recherche sur une VUE MASQUÉE
// (rewriteMasked, ci-dessus) plutôt que sur `raw` tel quel : un texte de PROSE dans un
// gestionnaire (`@click={$msg = 'Exemple : §theme = "sombre" définit un contexte
// partagé'}`) contient la SOUS-CHAÎNE « §theme = … » — le scan naïf la prenait pour un
// VRAI setter et injectait `this._mjs_setContext(...)` EN PLEIN MILIEU de la chaîne
// littérale (échec Civet explicite en aval). Le masquage neutralise chaînes/gabarits/
// commentaires ; les offsets restant alignés, le RHS relu dans `raw` reste verbatim
// (chaîne comprise) — le RHS reste brut, ses sigils sont convertis ensuite par
// la lecture par l'arbre et la passe grammaire.
// `\s*` n'est PAS repris devant le groupe RHS (contrairement à l'ancien scan sur `raw`
// nu) : gourmand, il mangerait tout un RHS masqué en espaces (une chaîne littérale) avant
// même que `(.+?)` ne démarre — le groupe ne capturait plus que son DERNIER caractère
// (`'theme', ')` au lieu de `'theme', 'dark')`). Le RHS est donc capturé DEPUIS le `=`,
// espace de séparation compris, puis `.trim()` ôte cet unique espace de tête — les
// espaces internes d'une chaîne (`'  fr  '`) restent, eux, intacts.
// Affectation composée (`§x += v`, `§x ||= v`), incrément et décrément (`§x++`, `--§x`) : la règle du <script>
// (contextWrite, rewriteIncrement, lexer/index.ts) — laissés au getter, ils donnaient
// `this._mjs_getContext('x') += 1`, que Civet refusait
function applyContextSetters(raw: string, _externalVars: string[]): string {
  const withIncr = contextIncrements(contextIncrements(raw, '§§', '_mjs_setRCtx', '_mjs_getRCtx'), '§', '_mjs_setContext', '_mjs_getContext')
  const withRCtx = rewriteMasked(withIncr, /(?<![\w.§])§§([a-zA-Z_][a-zA-Z0-9_$]*)\s*(\*\*|\|\||&&|\?\?|>>>|<<|>>|[-+*/%|&^])?=(?!=|>)(.+?)(?=\n|;|$)/gd,
    (name, op, rhs) => contextWrite('this', '_mjs_setRCtx', '_mjs_getRCtx', name, op, rhs.trim()))
  return rewriteMasked(withRCtx, /(?<![\w.§])§([a-zA-Z_]\w*)\s*(\*\*|\|\||&&|\?\?|>>>|<<|>>|[-+*/%|&^])?=(?!=|>)(.+?)(?=\n|;|$)/gd,
    (name, op, rhs) => contextWrite('this', '_mjs_setContext', '_mjs_getContext', name, op, rhs.trim()))
}

// `§x++`, `--§x`… cherchés sur la vue masquée (jamais dans une chaîne ni un commentaire), réécrits par la règle du
// <script> ; un incrément ne contient que des signes de code, le masquage (même longueur) laisse ses positions intactes
function contextIncrements(raw: string, mark: string, call: string, read: string): string {
  const masked = maskInertSameLength(raw)
  let out    = ''
  let cursor = 0
  for (const m of masked.matchAll(incrementContextRe(mark))) {
    out += raw.slice(cursor, m.index) + rewriteIncrement(m[0], mark, call, read, 'this')
    cursor = m.index! + m[0].length
  }
  return out + raw.slice(cursor)
}

// Passe GRAMMAIRE — idiomes Coffee/Civet (`->`, not/and/or, is/isnt), traduits par regex : sur un gestionnaire du dialecte après sa
// lecture par l'arbre (dialectHandler), et pour le test de forme javaScriptShape ; une expression est compilée par Civet
// (compileGrammarViaCivet), qui comprend nativement ces mêmes idiomes
function applyGrammarRegex(seg: string): string {
  let res = seg

  // Coffee thin arrow `->` → JS arrow `=>`. Couvre les expressions inline
  // dans les blocs flow ({for X in $.list.filter (t) -> not t.done}, etc.)
  // où le user écrit du Coffee. Le lookbehind exclut aussi `-` : sinon
  // `$count-->0` (post-décrément) devenait `$count-=>0`.
  res = res.replace(/(?<![=-])->/g, '=>')

  // not / and / or — d'abord car `not` peut affecter les comparaisons qui suivent.
  // Lookahead `(?!\s*[:)\]},;])` : ne PAS transformer quand le mot est une CLÉ
  // d'objet (`{is: 1}`, `{not: 2}`) ou un identifiant isolé (`foo(is)`, `[and]`) —
  // seulement en position d'opérateur. Sans ça, `{is:1,not:2}` → `{===:1,!:2}` (invalide).
  //
  // Analyse du corpus réel (429 fixtures tuto/doc capturées
  // dans tests/snapshots/, via tests/snapshot-stats.mjs) — `not $x`
  // (espace naturel après le mot) devenait `! $x` : l'espace SURVIT au
  // remplacement (seul le mot `not` est substitué par le caractère `!`).
  // CoffeeScript tolère `! x` (opérateur unaire espacé) mais Civet rejette
  // net (« Failed to parse » — vérifié empiriquement, 4 tutos réels cassés :
  // tuto-13-13-7-bindings-instances, tuto-14-14-1/14-2 transitions/animations,
  // tuto-8-8-1 directive-attach, tous des `not $x`/`not item.x` dans un
  // handler inline ou un `{for}.filter`). On consomme aussi l'espace/tab
  // suivant (`[ \t]*`, jamais `\s*` — ne PAS avaler un saut de ligne, qui
  // décalerait les positions dans une grammaire sensible à l'indentation) :
  // `!x` collé reste valide JS/Coffee/Civet dans tous les cas.
  res = res.replace(/(?<![\w.\$])not\b(?!\s*[:)\]},;])[ \t]*/g, '!')
  res = res.replace(/(?<![\w.\$])and\b(?!\s*[:)\]},;])/g, '&&')
  res = res.replace(/(?<![\w.\$])or\b(?!\s*[:)\]},;])/g, '||')

  // `a is b` / `a isnt b` → `===` / `!==` (équivalent Coffee générique)
  res = res.replace(/(?<![\w.\$])\bis\b(?!\s*[:)\]},;])/g, '===')
  res = res.replace(/(?<![\w.\$])\bisnt\b(?!\s*[:)\]},;])/g, '!==')

  return res
}

// unless cond → !(cond) ; MAIS `expr unless cond` (postfix, idiome Coffee/
// Civet natif : « fais expr sauf si cond ») doit envelopper le préfixe, pas
// juste la partie après « unless » — sinon le préfixe intact + le `!(cond)`
// produit du JS juxtaposé invalide (`$n++ unless
// $locked` → `$.n++ !($.locked)`, SyntaxError).
// Forme émise : `(!(cond) && (pre))` — VALIDE en JS ET en CoffeeScript
// (cleanJs alimente AUSSI les inlines d'événements
// recompilés en Coffee, où le ternaire `?:` et `void` n'existent pas → tout
// handler `@event={… unless …}` échouait à la compilation). `pre` s'exécute
// (effet) seulement si cond est faux, exactement comme le ternaire ; la
// valeur devient `false` (vs `undefined`) quand cond vrai — sans usage connu.
// Sur l'expression ENTIÈRE, vue masquée (chaînes et commentaires en espaces de même longueur), avant le
// découpage par chaînes : fait segment par segment, un préfixe ou une condition qui contient une chaîne
// (`$msg = 'oui' unless $bloque`, `alert('x') unless $ok`) n'était vu qu'en partie — `'oui'($.bloque)`
// au clic, ou un échec de Civet sans rapport. Préfixe et condition sont relus dans le texte réel ; la condition commence au premier
// signe écrit après `unless` : une regex ou une chaîne en tête (`unless /a/.test($s)`), blanchie dans la vue masquée, en fait partie
// (sans elle, `(.test($s))` devenait pour Civet une flèche jamais appelée, sans erreur).
// Le préfixe et la condition s'arrêtent aux `;` de premier niveau, comme `unless` en Civet et en CoffeeScript : dans
// `t := $o; t.c = 3 unless t.c`, seule `t.c = 3` dépend de la condition (l'enveloppe de toute la liste était refusée par Civet,
// lue en suite d'expressions par CoffeeScript) ; dans `$x = 1 unless $v; $y = 2`, `$y = 2` suit, sans condition. De même aux fins de
// ligne d'un corps de plusieurs lignes (cf. endsStatement) : `$a = 1` suivi à la ligne de `$b = 2 unless $c` exécute toujours
// `$a = 1` (tout le corps passait sous la condition, ou Civet le compilait en gestionnaire vide). Un préfixe qui est une instruction
// (`return`, `break`, `continue`, `throw`) ne s'enveloppe pas : `(!(c) && (return))` est refusé par Civet et par CoffeeScript, qui
// lisent tous deux `return unless c` tel qu'écrit. Le `unless` réécrit : celui dont la condition va jusqu'à la fin du corps, ou celui
// qu'un `;` de sa ligne suit derrière un préfixe, sur toute ligne — Civet compile `x unless c; y` en JavaScript invalide
// (`x((!c?():void 0)); y`) ; un `unless` d'une ligne d'avant sans `;`, Civet et CoffeeScript le lisent bien. `script` : le corps d'un
// gestionnaire versé au script que Civet compile (cf. unlessFollowedBySemicolon), seuls ces `;` comptent et aucune ligne n'est ajoutée
function rewriteUnless(raw: string, headIndent = '', script = false): string {
  const seen   = maskInertSameLength(raw)
  const values = valuesView(raw)
  for (const u of seen.matchAll(/(?<![\w.$])unless\s+/g)) {
    const preEnd    = u.index
    const startCond = preEnd + 'unless'.length + /^\s*/.exec(raw.slice(preEnd + 'unless'.length))![0].length
    const before    = statementEnds(values, 0, preEnd, true)
    // `unless` dans une parenthèse ouverte (`f(a unless b)`) : rien n'est coupé
    const start    = before.depth === 0 ? statementStart(values, before.points, preEnd) : -1
    const end      = before.depth === 0 ? statementEnds(values, startCond, raw.length).points[0] ?? raw.length : raw.length
    const preStart = before.depth === 0 ? lineArrow(values, start + 1, preEnd) : 0
    const pre      = raw.slice(preStart, preEnd).trim()
    const head     = raw.slice(0, preStart) + /^\s*/.exec(raw.slice(preStart, preEnd))![0]
    if ((script || !/^unless\s+.+$/.test(seen.slice(preEnd))) && (end === raw.length || values.slice(startCond, end).includes('\n') || pre === '')) continue
    // une regex en tête de la condition passe entre crochets : Civet lit `(/a/.test(s))` comme la section d'opérateur `(/ a / …)`, une
    // flèche, et de même `(/a/i)` entre parenthèses (`a => a/a/i`) ; `[/a/i][0]` se lit pareil en Civet et en CoffeeScript (la fin de la
    // regex : le premier signe que la vue masquée garde après elle)
    const regex = raw[startCond] === '/' ? (/\S/.exec(seen.slice(startCond, end))?.index ?? end - startCond) : 0
    const cond  = regex > 0 ? `[${raw.slice(startCond, startCond + regex).trimEnd()}][0]${raw.slice(startCond + regex, end)}` : raw.slice(startCond, end)
    if (JUMP_STATEMENT_RE.test(pre.slice(pre.lastIndexOf('\n') + 1).trim())) {
      // Civet lit `return unless c; y` comme `return (…); y` : la suite passe à la ligne, au retrait de la ligne de l'instruction ; dans le
      // corps d'une flèche écrite sur sa ligne, ce corps passe en bloc, un cran plus loin, la suite avec lui. Au script, sur la même
      // ligne : `if (!(c)) { return }; y` — `unless c then return 0; y` ne rendait plus `y`, dernière valeur d'une flèche (`$l.filter (z) ->
      // return false unless z > 1; z < 3` gardait `[]`)
      if (end === raw.length) return raw
      if (script) return head + `if (!(${cond.trim()})) { ${pre} }` + rewriteUnless(raw.slice(end), '', true)
      const arrow  = preStart > start + 1
      const indent = lineIndent(raw, head.length, headIndent) + (arrow ? '  ' : '')
      return (arrow ? head.trimEnd() + '\n' + indent + raw.slice(head.length, end).trim() : raw.slice(0, end).trimEnd()) + '\n' + indent + rewriteUnless(raw.slice(end + 1).trimStart(), indent)
    }
    return head + (pre ? `(!(${cond}) && (${pre}))` : `!(${cond})`) + (end < raw.length ? rewriteUnless(raw.slice(end), lineIndent(raw, end, headIndent), script) : '')
  }
  return raw
}

// le corps d'un gestionnaire de <@window>, <@document> ou <@body>, versé au script que Civet compile : ses `x unless c; y`, que Civet
// compile en JavaScript invalide (« parse error » à la construction), sont réécrits sans changer de ligne (cf. rewriteUnless)
export function unlessFollowedBySemicolon(body: string): string {
  return rewriteUnless(body, '', true)
}

// le début du corps de la dernière flèche (`->`, `=>`) écrite sur la ligne de `fin`, entre `debut` et `fin`, hors de toute parenthèse,
// crochet ou accolade ouverts depuis `debut` ; `debut` sans flèche. `unless` ne prend que ce corps, comme en Civet et en CoffeeScript :
// dans `$l.forEach (z) -> $d += z unless z == 2`, tout l'appel passait sous la condition, qui lisait `z` hors de la flèche. Une virgule à
// son niveau finit ce corps (`$l.reduce (s, z) -> s + z, 0`, l'argument suivant de l'appel), un `else` aussi quand aucun `then` du corps
// ne l'ouvre (`if $v then -> 1 else 2`) : `unless` prend alors toute l'instruction, comme Civet
function lineArrow(values: string, start: number, end: number): number {
  const line = values.lastIndexOf('\n', end - 1) + 1
  let body   = start
  let n      = 0
  let then   = 0
  for (let k = start; k < end; k++) {
    const c = values[k]
    if (c === '(' || c === '[' || c === '{') n++
    else if (c === ')' || c === ']' || c === '}') n--
    else if (n !== 0 || k < line) continue
    else if ((c === '-' || c === '=') && values[k + 1] === '>' && values[k - 1] !== '-' && values[k - 1] !== '=') {
      body = k + 2
      then = 0
    }
    else if (body === start) continue
    else if (c === ',') body = start
    else if (/[\w$]/.test(values[k - 1]) || !/^(?:then|else)(?![\w$])/.test(values.slice(k, k + 5))) continue
    else if (c === 't') then++
    else if (then-- === 0) body = start
  }
  return body
}

// le dernier des `points` (cf. finsDInstruction) où commence l'instruction qui finit en `fin` : le premier signe qui le suit est sur une
// ligne qu'aucune ligne de code d'après, jusqu'à `fin`, ne dépasse vers la gauche ; un point dans un bloc qu'une ligne moins en retrait
// continue (le corps du rappel de `.map (z) ->`, puis `.length unless c`) ne coupe pas, toute la chaîne est l'instruction ; -1 sans point
function statementStart(values: string, points: number[], end: number): number {
  for (let i = points.length - 1; i >= 0; i--) {
    const start  = points[i] + 1 + /^\s*/.exec(values.slice(points[i] + 1, end))![0].length
    const indent = /^[ \t]*/.exec(values.slice(values.lastIndexOf('\n', start - 1) + 1))![0].length
    if (values.slice(start, end).split('\n').slice(1).every((l) => l.trim() === '' || /^[ \t]*/.exec(l)![0].length >= indent)) return points[i]
  }
  return -1
}

// une instruction qui quitte le gestionnaire ou la boucle : jamais une expression
const JUMP_STATEMENT_RE = /^(?:return|break|continue|throw)(?![\w$])/

// le retrait de la ligne qui porte l'indice `i` de `raw` ; `tete` pour sa première ligne, quand `raw` est la suite d'une ligne (`; …`)
function lineIndent(raw: string, i: number, head: string): string {
  const d = raw.lastIndexOf('\n', i - 1)
  return d < 0 ? head : /^[ \t]*/.exec(raw.slice(d + 1))![0]
}

// les fins d'instruction hors de toute parenthèse, crochet ou accolade ouverts entre `debut` et `fin` (cf. valuesView) : les `;`, et
// avec `lignes` les sauts de ligne qui finissent une instruction (cf. endsStatement) ; et la profondeur atteinte à `fin`
function statementEnds(values: string, start: number, end: number, lines = false): { points: number[]; depth: number } {
  const points: number[] = []
  let n = 0
  for (let k = start; k < end; k++) {
    const c = values[k]
    if (c === '(' || c === '[' || c === '{') n++
    else if (c === ')' || c === ']' || c === '}') n--
    else if (n === 0 && (c === ';' || (lines && c === '\n' && endsStatement(values, k)))) points.push(k)
  }
  return { points, depth: n }
}

// le code de `raw` à même longueur, pour lire où finit une instruction : un commentaire en espaces (sauts de ligne gardés), une chaîne,
// une regex ou un gabarit en `0` (une valeur), sauts de ligne compris — seuls les sauts de ligne du code et des commentaires restent
function valuesView(raw: string): string {
  let view = ''
  let at   = 0
  for (const [start, end] of inertRanges(raw)) {
    const token = raw.slice(start, end)
    view       += raw.slice(at, start) + (/^(?:#|\/[/*])/.test(token) ? token.replace(/[^\n]/g, ' ') : '0'.repeat(token.length))
    at          = end
  }
  return view + raw.slice(at)
}

// une ligne qui attend la suite : elle s'arrête sur un opérateur, une virgule ou un mot qui en attend une (jamais `x++`, une flèche, `a?`)
const OPEN_LINE_RE = /(?:(?<![+-])[+-]|[*/%=<&|^~,\\:]|(?<![-=])>|(?<![\w$])(?:and|or|not|is|isnt|in|of|instanceof|new|typeof|delete|void|await|yield|throw|extends))$/
// une ligne qui continue la précédente : un accès (`.length`, `?.x`, `::x`), une virgule, un opérateur binaire, la suite d'un `if`, d'un
// `try` ou d'un `switch` (`else`, `catch`, `when`…), une clé d'objet (l'appel sans parenthèses `e.push` puis `  id: 1`)
const CONTINUATION_LINE_RE = /^(?:[.,*/%&|^=<>?:+-]|!=|(?:and|or|is|isnt|instanceof|in|of|then|else|catch|finally|when)(?![\w$])|[\w$]+[ \t]*:(?![:=]))/
// une ligne qui ouvre un bloc : les lignes en retrait qui la suivent sont son corps
const OPENS_BLOCK_RE = /^(?:if|unless|for|while|until|loop|switch|try|catch|finally|else|when|do|class)(?![\w$])|(?:[-=]>|(?<![\w$])(?:then|else|do|try|finally))$/

// le saut de ligne en `k` (cf. valuesView) finit l'instruction de la ligne de code d'avant : elle n'attend pas de suite, et la ligne
// de code d'après ne la continue pas ; une ligne vide ou de commentaire ne compte pas
function endsStatement(values: string, k: number): boolean {
  const before = values.slice(0, k).trimEnd()
  const after  = values.slice(k + 1).trimStart()
  return before !== '' && after !== '' && !OPEN_LINE_RE.test(before) && !CONTINUATION_LINE_RE.test(after)
}

// le corps d'un gestionnaire, d'un rappel de transition ou d'une balise globale dont la première ligne est collée à `{` (`@click={$a = 1`,
// la suite en retrait) : cette ligne n'a pas de retrait à elle, les lignes qui la suivent sont ramenées au sien (leur retrait mesuré sur
// leurs lignes de code, comme pour le script d'un partiel) quand elle finit une instruction — Civet lisait la ligne d'après comme
// l'argument de la première (`1(…)`), CoffeeScript la refusait. Une première ligne qui ouvre un bloc (`if $c`, `f = ->`) a pour corps
// la première ligne de code d'après et celles de son retrait ; une ligne moins en retrait qu'elle est au niveau de la première (`if $c`,
// `$a = 1` en retrait, puis `$b = 2` moins loin : hors du bloc), comme quand l'accolade est seule — Civet en faisait l'argument du bloc
// (`$l.forEach(…)(…)`) ou un second gestionnaire, sans erreur. Une première ligne qui attend la suite (`a +`), une ligne d'après qui la
// continue (`.length`, `id: 1`), un bloc dont le corps garde un seul retrait : rien ne change ; une ligne commencée dans une chaîne
// garde son texte
export function alignsOnFirstLine(body: string): string {
  const k = body.indexOf('\n')
  if (k < 0 || body.slice(0, k).trim() === '') return body
  const values = valuesView(body)
  // une première ligne qui finit son bloc sur elle-même (`if $c then $a = 1`, `while $n < 3 then $n++`) n'en ouvre pas, sauf si elle finit sur ce
  // qui en ouvre un (`… else`, une flèche) : la ligne d'après en était l'argument (`1(…)`) ou restait sous la condition, sans erreur
  const block    = OPENS_BLOCK_RE.test(values.slice(0, k).trim()) && (!/(?<![\w$])then[ \t]+\S/.test(values.slice(0, k)) || /(?:[-=]>|(?<![\w$])(?:else|do|try|finally))$/.test(values.slice(0, k).trim()))
  if (values[k] !== '\n' || statementEnds(values, 0, k).depth !== 0 || (!block && !endsStatement(values, k))) return body
  // les lignes d'après, et le retrait de celles de code (ni commencées dans une chaîne ou un gabarit, ni de commentaire)
  const lines  = body.slice(k + 1).split('\n')
  const starts = [k + 1]
  for (const l of lines.slice(0, -1)) starts.push(starts[starts.length - 1] + l.length + 1)
  const codes  = lines.map((l) => l.search(/\S/)).filter((q, i) => q >= 0 && values[starts[i] - 1] === '\n' && values[starts[i] + q] !== ' ')
  if (block && !(Math.min(...codes) < codes[0])) return body
  const step    = codes.length > 0 ? Math.min(...codes) - body.search(/\S/) : 0
  if (step <= 0) return body
  return body.slice(0, k + 1) + lines.map((l, i) => values[starts[i] - 1] === '\n' ? l.slice(Math.min(step, l.search(/\S|$/))) : l).join('\n')
}

// noComments — texte JETABLE (jamais émis) pour les GARDES qui REFUSENT une
// forme. mapCodeSegments masque les chaînes, pas les commentaires : un `µevery` ou un
// `µread(` simplement CITÉ dans un `//…` faisait échouer le build (les commentaires
// inline sont la norme du projet).
//
// Ne neutralise QUE des LIGNES DE COMMENTAIRE ENTIÈRES — première chose non blanche de
// la ligne = `//` ou `/*`. Volontairement plus étroit qu'un `replace` de tout `//…` :
// un littéral REGEX finissant par un
// slash échappé collé au délimiteur (`/http:\/\//`, motif banal pour une URL) fabrique
// un `//` FANTÔME — la version large effaçait alors la fin de la ligne, garde aveugle,
// et un `µread(compteur)` malformé repartait dans le JS émis. Build vert, ReferenceError
// au clic : la régression était PIRE que le faux refus qu'elle corrigeait.
// Un `//` ou un `/*` en TÊTE de ligne, lui, ne peut PAS être un regex (JS lirait déjà un
// commentaire), donc aucun faux négatif possible par ce chemin. Reste hors périmètre le
// commentaire de FIN de ligne (`a = 1  // µread(x)`) : encore refusé — un faux refus, du
// bon côté de l'erreur.
function noComments(code: string): string {
  const lines = code.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const bare = lines[i].trimStart()
    if (bare.startsWith('//')) { out.push(''); continue }
    if (bare.startsWith('#') && !bare.startsWith('#{')) { out.push(''); continue }   // commentaire `#` d'un gestionnaire, jamais `#{…}` d'interpolation
    if (bare.startsWith('/*')) {
      // On cherche la FERMETURE avant d'effacer quoi que ce soit. Un drapeau « on est
      // dans un bloc » qui reste collé faute de `*/` effacerait tout le reste du segment
      // — garde aveugle sur des dizaines de lignes de vrai code. Sans fermeture, on ne
      // neutralise RIEN : un commentaire jamais fermé
      // est du code cassé de toute façon, et refuser est le bon côté de l'erreur.
      let j   = i
      let end = lines[i].indexOf('*/', lines[i].indexOf('/*') + 2)
      while (end < 0 && j + 1 < lines.length) { j++; end = lines[j].indexOf('*/') }
      if (end < 0) { out.push(lines[i]); continue }
      for (let k = i; k < j; k++) out.push('')
      out.push(lines[j].slice(end + 2))
      i = j
      continue
    }
    out.push(lines[i])
  }
  return out.join('\n')
}

// inspectArgOutsideComment — enveloppe MU_INSPECT_ARG_OUT (sigils.ts, corps PARTAGÉ avec le
// script) : un match qui COMMENCE
// dans un commentaire est laissé EXACTEMENT tel quel, jamais l'occasion de lever une erreur
// pour une forme simplement CITÉE en prose (`// µinspect($x.foo) est refusé`). `offset`/
// `chaine` : les DEUX arguments supplémentaires que `.replace(regex, fn)` passe déjà à `fn`
// (position du match, texte COMPLET en cours de réécriture) — jamais utilisés jusqu'ici par ces
// deux fonctions. RÉUTILISE le masqueur du lexer (maskInertSameLength, source unique) pour
// savoir si `offset` tombe dans une zone inerte : ni chaîne ni gabarit n'y survit à ce stade
// (mapCodeSegments les a déjà isolés), le SEUL écart possible entre `chaine` et sa vue masquée
// est donc un commentaire `//`/`/* */`/`#` Civet. Portée VOLONTAIREMENT limitée à ces deux
// fonctions (pas à toute la passe symboles) : les autres gardes de cette même fonction
// (µevery/hooks/µderived/…) continuent de considérer un commentaire de FIN de ligne comme
// refusé — comportement voulu ailleurs (cf. gardes-hors-script-commentaires.test.ts, « le bon
// côté de l'erreur »), pas un défaut à corriger ici. Le script (transpiler/index.ts,
// transformCodeOnly) ne voit lui-même plus aucun commentaire à ce stade : cette enveloppe y est
// un no-op garanti, elle n'y change donc rien (ces fonctions restent utilisées BRUTES là-bas).
function inspectArgOutsideComment(m: string, parenName: string | undefined, parenPath: string | undefined, bareName: string | undefined, barePath: string | undefined, offset: number, str: string): string {
  const mask = maskInertSameLength(str)
  if (mask[offset] !== str[offset]) return m
  return MU_INSPECT_ARG_OUT(m, parenName, realPath(parenPath), bareName, realPath(barePath))
}
// un « chemin » fait seulement de commentaires (`µinspect($x /* suivi */)`) n'en est pas un :
// rien n'y est exécuté, l'argument reste la variable entière
function realPath(path: string | undefined): string | undefined {
  return path && maskInertSameLength(path).trim() !== '' ? path : undefined
}

// rewritesOrRejectsRunePath — µinspect(...) : un chemin/appel/indexation dont la
// clé est une chaîne littérale (`$x['a']`, `$x.foo('a')`) échappe encore à
// inspectArgOutsideComment plus haut : celui-ci tourne PAR SEGMENT
// (mapCodeSegments a déjà isolé la chaîne comme littéral INERTE avant d'appeler la passe des runes),
// coupant l'appel en morceaux disjoints (`µinspect($x[` / `'a'` / `])`) — aucun des deux ne
// correspond plus au corps ENTIER de MU_INSPECT_ARG_BODY (sigils.ts,
// gabarit LISTE BLANCHE argEndOrPath) : une forme INVALIDE ressortirait intacte, une forme
// VALIDE (chemin FIXE, cf. flatInspectPath) ne serait jamais réécrite. Scan donc AVANT ce
// découpage, sur le texte ENTIER (`pre`, juste avant mapCodeSegments) — vue MASQUÉE
// (maskInertSameLength, même technique que rewriteMasked/applyContextSetters plus haut) : la
// chaîne à l'intérieur devient des espaces MÊME LONGUEUR, invisibles au motif mais le reste de la
// forme (point, parenthèses, crochets) reste visible — et un commentaire qui CITE une forme
// (valide ou refusée) est masqué de la même façon (le `µ` lui-même disparaît en espace) :
// comment-safe PAR CONSTRUCTION, aucun besoin du détour offset/chaine des deux fonctions
// ci-dessus. Le nom et le chemin RÉELS (guillemets compris) sont relus dans `raw` via
// `m.indices` — pour un message d'erreur fidèle (chemin invalide) OU pour la réécriture (chemin
// valide : µinspect filtre son affichage, cf. sigils.ts). Rend le
// texte reconstruit segment par segment (identique à `raw` sauf aux positions réécrites) ; lève à
// la PREMIÈRE forme invalide
// rencontrée (l'exception interrompt tout le reste, aucun risque de double message avec
// shapedRunes/inspectArgOutsideComment plus loin — ceux-ci ne revoient plus jamais un
// µinspect(...) à chemin, déjà tranché ici).
export function rewritesOrRejectsRunePath(raw: string): string {
  const mask = maskInertSameLength(raw)
  // µminmax n'existe plus (V3) : la marche à suivre plutôt que `µ.minmax is not a function` au navigateur
  if (new RegExp(MU_MINMAX_REMOVED_BODY).test(mask)) throw new Error(t('transpiler.minmax-removed'))
  // un store (`$$x`) n'est pas l'état d'un composant : refus clair, jamais un appel à la valeur
  for (const m of mask.matchAll(new RegExp(MU_RUNE_STORE_BODY, 'g'))) {
    throw new Error(t('transpiler.rune-store', { rune: m[1], name: m[2] }))
  }
  // positions relevées sur `raw` par les passes, appliquées ensuite en une seule fois : une
  // réécriture de l'une ne décale jamais les positions d'une autre
  const replacements: Array<[number, number, string]> = []
  for (const m of mask.matchAll(new RegExp(MU_INSPECT_ARG_BODY, 'gd'))) {
    const idx     = m.indices!
    const nameIdx = (idx[1] ?? idx[3])!
    const path    = pathAfterName(raw, mask, nameIdx[1], idx[2] ?? idx[4])
    if (!path) continue
    const flat = flatInspectPath(path)
    if (flat === undefined) throw new Error(t('transpiler.rune-inspect-path', { name: raw.slice(...nameIdx), path: path }))
    replacements.push([idx[0][0], idx[0][1], `µ.inspect('${raw.slice(...nameIdx)}', '${flat}')`])
  }
  replacements.sort((a, b) => a[0] - b[0])
  let out    = ''
  let cursor = 0
  for (const [start, end, text] of replacements) {
    out += raw.slice(cursor, start) + text
    cursor = end
  }
  return out + raw.slice(cursor)
}
// chemin refusé derrière `$nom`, relu dans le texte RÉEL : celui capturé sur la vue masquée, ou
// sinon un gabarit collé au nom (`` $x`t` ``, appel étiqueté) que la vue masquée réduit à des
// espaces et fait passer pour un simple espacement
function pathAfterName(raw: string, mask: string, nameEnd: number, pathIdx: [number, number] | undefined): string {
  if (pathIdx && pathIdx[0] !== pathIdx[1]) return raw.slice(...pathIdx)
  let end = nameEnd
  while (mask[end] === ' ' || mask[end] === '\t') end++
  const between = raw.slice(nameEnd, end)
  return between.includes('`') ? between.trim() : ''
}

// `µpending` et `µsignal` d'un bloc `{await}` (cf. compileAwait) : vrais noms de la fonction de la branche et de la lecture de l'expression
// seulement pendant que le générateur compile ce bloc ; ailleurs ils restent des runes ordinaires (`µ.pending`, `µ.signal`)
export const runesAwait = { pending: false, signal: false }
const RE_MU_PENDING_G = /(?<![\w.µ$])µpending(?![\w$µ])/g
const RE_MU_PENDING   = /(?<![\w.µ$])µpending(?![\w$µ])/
// commentaires d'un morceau de code, ses chaînes déjà retirées (mapCodeSegments), lus de gauche à droite ; un commentaire non refermé court
// jusqu'au bout du morceau. Expression : `//` et `/* */` ; gestionnaire en grammaire civet : aussi `#` et `### ###`, que le lot des
// gestionnaires change en commentaires (applyCivetDialectSugar), sauf `#nom`
const EXPRESSION_COMMENTS = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g
const HANDLER_COMMENTS    = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|###[\s\S]*?(?:###|$)|#(?![a-zA-Z_!])[^\n]*/g

// `µpending` écrit dans le code de `code`, là où les runes sont lues : hors des chaînes, le dedans d'un `${…}` et d'un `#{…}` compris
// (cleanJsExpr convertit ces interpolations d'abord) ; un texte cité dans une chaîne ne compte pas, ni un commentaire. Dans une
// expression Civet, `#` est du code (`this.length`). `gestionnaire` : le code d'un gestionnaire d'événement, que compile le lot des
// gestionnaires
export function readsMuPending(code: string | null | undefined, handler = false): boolean {
  if (!code || !code.includes('µpending')) return false
  const comments = handler ? HANDLER_COMMENTS : EXPRESSION_COMMENTS
  let read = false
  mapCodeSegments(convertCoffeeInterpolations(code, undefined, true), (seg) => {
    if (RE_MU_PENDING.test(seg.replace(comments, ' '))) read = true
    return seg
  })
  return read
}

// `µpending` lu dans l'interpolation d'une chaîne double d'un gestionnaire (`"état #{µpending}"`), que Coffee interpole et que le lot Civet
// des gestionnaires convertit : le nom de la valeur de la branche, comme dans le code — cleanJs ne lit pas les chaînes. Le texte, une
// chaîne simple et une chaîne citée dans l'interpolation restent tels quels
export function pendingInStrings(code: string): string {
  if (!runesAwait.pending || !code.includes('µpending')) return code
  const replaces = (interpolation: string): string => interpolationCode(mapCodeSegments(interpolation, (seg) => seg.replace(RE_MU_PENDING_G, '_mjs_pnd')), replaces)
  return interpolationCode(code, replaces)
}

// `µafter (d), fn`, `µevery (d), fn`, `µtoggle ($x), 'a'` : une espace avant la parenthèse, puis une virgule juste après la parenthèse
// fermante. Civet et CoffeeScript lisent cette virgule comme un séparateur des arguments de la rune (`µafter((d), fn)`) ; le compilateur
// prend la parenthèse pour celle de l'appel (`µafter(d), fn`, sigils.ts) : la forme se lit de deux façons, elle est refusée, avec sa
// ligne et les deux écritures sans doute. Toute autre forme garde sa lecture (`µafter (d).then(f)`, `µafter (d) and x`, `µafter (d, fn)`).
// Lue sur le texte masqué (chaînes, commentaires et regex blanchis, même longueur, `\n` gardés) : rien d'écrit dans un littéral ne compte.
// Appelée pour le <script> d'un composant en Civet ou en CoffeeScript (transpiler/sugar.ts), et pour ses gestionnaires et ses rappels de
// transition (cleanJsHandler) ; dans un composant en JavaScript ou en TypeScript, la parenthèse est celle de l'appel : rien n'est refusé
const RE_RUNE_SPACE_PAREN = /(?<![\w.µ$])µ(after|every|toggle)[ \t]+\(/g
const RE_COMMA_AFTER      = /[ \t]*,/y
export function commaParenSpaceReject(code: string, coffee: boolean, handler: boolean, lineOf: (index: number) => number | undefined): void {
  if (!/µ(?:after|every|toggle)[ \t]+\(/.test(code)) return
  const mask = maskInertSameLength(code, true, coffee)
  for (const m of mask.matchAll(RE_RUNE_SPACE_PAREN)) {
    let depth = 0
    let i     = m.index + m[0].length
    for (; i < mask.length; i++) {
      const c = mask[i]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break
        depth--
      }
    }
    RE_COMMA_AFTER.lastIndex = i + 1
    if (mask[i] === ')' && RE_COMMA_AFTER.test(mask)) throw new Error(t('transpiler.rune-space-comma', { rune: 'µ' + m[1], line: lineOf(m.index), handler: handler }))
  }
}

// le code d'un gestionnaire d'événement passé par cleanJs : `µpending` n'y prend le nom de la valeur de la branche que si le gestionnaire
// le lit hors de ses commentaires (cf. litMuPending), et jusque dans l'interpolation d'une chaîne double (pendingInStrings) ;
// `µrefresh` y est permis (refreshAllowed). Une regex s'y passe aussi sans parenthèses (`$v.replace /"/g, 'R'`, regexInArgument) :
// lue comme une division, son guillemet ouvrait une fausse chaîne qui cachait la suite (`$k = $k + 1`) aux réécritures.
// `ligne` : celle où le gestionnaire est écrit, citée par le refus de `µafter (d), fn` (commaParenSpaceReject) ; `lang` : la langue
// du <script> du composant (CompilerState.scriptLang) — en JavaScript ou en TypeScript, la forme garde sa lecture, comme dans le script
// (transpiler/sugar.ts) ; sans langue, hors du transpileur, elle est refusée comme en Civet
export function cleanJsHandler(code: string, externalVars: string[], moduleName?: string, written?: string, line?: number, lang?: string): string {
  if (lang !== 'js' && lang !== 'ts') commaParenSpaceReject(code, false, true, () => line)
  const pendingBranch  = runesAwait.pending
  const refreshBefore  = refreshAllowed
  runesAwait.pending &&= readsMuPending(code, true)
  refreshAllowed       = true
  try {
    // µevery / µafter d'un gestionnaire : le composant passe en tête de l'appel (sigils.ts), chaînes laissées intactes
    return cleanJs(pendingInStrings(mapCodeSegments(code, componentTimer, true)), externalVars, true, moduleName, written)
  }
  finally {
    runesAwait.pending = pendingBranch
    refreshAllowed     = refreshBefore
  }
}

// les runes à forme d'un segment de code (refus des runes du script, `µread`, `µrefresh`, `µwrite` et leurs fautes de forme),
// avant les raccourcis : `µread $x` doit y rester entier
function shapedRunes(seg: string, externalVars: string[]): string {
  let res = seg

  // `µread $x`/`µwrite $x` (et statisation $$ : `µread $$x`/`µwrite $$x` →
  // accès BRUT au store, groupe 1 = '$') — DOIT passer ICI, AVANT la règle
  // `$$x → µ.store.x` juste en dessous : sinon celle-ci consomme le `$$x`
  // de `µread $$x` la première (aucun garde ne l'en empêche, son lookbehind
  // `$` n'exclut pas un `µread ` précédent), laissant `µread µ.store.x`
  // littéral dans le JS final → `ReferenceError: µread is not defined`.
  // Même raisonnement pour `µread $x`/la règle générique `$x → $.x` (plus
  // bas) — parité lexer (règle 3.5) PAR CONSTRUCTION (corps sigils.ts).
  // Parenthèses OPTIONNELLES : `µread($x)` puis `µread $x` — parité lexer
  // (règle 3.5) PAR CONSTRUCTION, corps partagés sigils.ts. Ce qui survit aux deux
  // est une faute de forme, refusée bruyamment plutôt que laissée littérale.
  // µevery / µafter dans une interpolation {…} : recalculée à chaque rendu, elle poserait une minuterie par rendu. Ceux
  // d'un gestionnaire sont déjà réécrits ici (cleanJsHandler) : ce qui reste est refusé, testé HORS COMMENTAIRES
  // (cf. noComments), comme µderived.
  RE_MU_EVERY_G.lastIndex = 0
  if (RE_MU_EVERY_G.test(noComments(res))) throw new Error(t('generator.every-outside-script'))

  // hooks de cycle de vie (µmount & co) et µderived : réservés au <script> — dans une
  // interpolation ou un handler, erreur claire plutôt qu'un ReferenceError cryptique au
  // runtime. Testés ICI, HORS COMMENTAIRES et AVANT toute la chaîne de sucre (donc a
  // fortiori avant µ-short, cf. µurlChange ⊃ µurl) : posés en `.replace` levant au milieu
  // de la chaîne, ils faisaient échouer le build sur un `// hook : µmount -> foo`
  // simplement CITÉ — même trou que µevery, corrigé du même geste.
  // `µfailed` mal écrit (MU_FAILED_MALFORMED) : la forme juste dite, plutôt que le refus des crochets ; sa ligne, que le générateur ne
  // connaît pas, est cherchée par le transpileur à la forme écrite (`failedMalformed`, cf. locateBadFailed)
  const badFailed    = RE_FAILED_MALFORMED.exec(noComments(res))
  const badlyWritten = badFailed ? failedWritten(noComments(res).slice(badFailed.index)) : ''
  if (badFailed) throw Object.assign(new Error(t('lexer.failed-misspelled', { written: badlyWritten })), { failedMalformed: badlyWritten })
  RE_MU_HOOKS_G.lastIndex = 0
  const hookCite = RE_MU_HOOKS_G.exec(noComments(res))
  if (hookCite) throw new Error(t('generator.hook-lifecycle-interpolation', { name: hookCite[1] }))
  RE_MU_DERIVED_G.lastIndex = 0
  if (RE_MU_DERIVED_G.test(noComments(res))) throw new Error(t('generator.derived-outside-script'))
  RE_MU_LAYOUT_WRITE_G.lastIndex = 0
  RE_MU_LAYOUT_PREFIX_WRITE_G.lastIndex = 0
  if (RE_MU_LAYOUT_WRITE_G.test(noComments(res)) || RE_MU_LAYOUT_PREFIX_WRITE_G.test(noComments(res))) throw new Error(t('lexer.mu-layout-written'))

  const rawAccessOut = (_m: string, dollar: string, name: string) =>
    (dollar ? RAW_ACCESS_STORE_OUT : RAW_ACCESS_OUT) + name
  res = res.replace(RE_RAW_ACCESS_PAREN_G, rawAccessOut).replace(RE_RAW_ACCESS_G, rawAccessOut)
  // µrefresh($x) / µrefresh $x → µ._mjs_refresh(_mjsThis, 'x'), µrefresh($$x) → µ._mjs_storeRefresh("x") (sigils.ts), AVANT les
  // règles `$x → $.x` et `$$x → µ.store.x` (un singleton importé écrit `$$X` y est refusé de même), dans un gestionnaire
  // d'événement seulement (refreshAllowed) ; ce qui reste est refusé
  RE_MU_REFRESH_REST_G.lastIndex = 0
  if (!refreshAllowed && RE_MU_REFRESH_REST_G.test(noComments(res))) throw new Error(t('generator.refresh-outside-handler'))
  const refreshOut = (_m: string, dollar: string, name: string) => {
    if (dollar && externalVars.includes(`$${name}`)) throw importedSingletonError(name)
    return dollar ? MU_REFRESH_STORE_OUT(name) : MU_REFRESH_OUT(name)
  }
  res = res.replace(RE_MU_REFRESH_PAREN_G, refreshOut).replace(RE_MU_REFRESH_G, refreshOut)
  const bare = RE_MU_REFRESH_BARE.exec(noComments(res))
  if (bare) throw refreshBareError(bare[1] + bare[2])
  RE_MU_REFRESH_REST_G.lastIndex = 0
  if (RE_MU_REFRESH_REST_G.test(noComments(res))) throw refreshShapeError()

  // µwrite $x, v / µwrite($x, v) — corps arrêtés à la virgule (sigils.ts, RAW_WRITE_BODY) :
  // `v` n'est jamais capturé, il continue tel quel dans `res`. Forme parenthésée : une
  // parenthèse ouvrante FRAÎCHE remplace `µwrite(`, la fermante d'origine (non consommée)
  // referme celle-là.
  const rawWriteParenOut = (_m: string, dollar: string, name: string) =>
    RAW_WRITE_PAREN_OUT_OPEN + (dollar ? RAW_WRITE_STORE_OUT : RAW_WRITE_OUT) + name + ' = '
  const rawWriteOut = (_m: string, dollar: string, name: string) =>
    (dollar ? RAW_WRITE_STORE_OUT : RAW_WRITE_OUT) + name + ' = '
  res = res.replace(RE_RAW_WRITE_PAREN_G, rawWriteParenOut).replace(RE_RAW_WRITE_G, rawWriteOut)

  // Ancienne forme `µwrite $x = v` / `µwrite($x) = v` (RETIRÉE) : message dédié
  // AVANT la garde générique, plutôt que le message générique moins actionnable.
  RE_RAW_WRITE_OLD_SHAPE_PAREN_G.lastIndex = 0
  RE_RAW_WRITE_OLD_SHAPE_G.lastIndex = 0
  if (RE_RAW_WRITE_OLD_SHAPE_PAREN_G.test(noComments(res)) || RE_RAW_WRITE_OLD_SHAPE_G.test(noComments(res))) throw rawWriteOldShapeError()

  RE_RAW_ACCESS_MALFORMED_G.lastIndex = 0
  if (RE_RAW_ACCESS_MALFORMED_G.test(noComments(res))) throw rawAccessShapeError()
  return res
}

// cleanJs : un fragment du gabarit (corps de gestionnaire, liaison `!{…}`, attache, valeur d'un `{const}` relue par un gestionnaire,
// rappel de transition) : du JavaScript, lu par acorn, ses raccourcis réécrits sur son arbre (fragmentByTree) ; sinon du dialecte
// (Civet : `@x`, `->`, `not`, `is`, appel sans parenthèses, rune à forme), lu par l'arbre de Civet (dialectHandler). Une
// expression autonome passe par `cleanJsExpr`. `dialecte` : le code d'un gestionnaire, que compile le lot des gestionnaires (une barre
// après un nom et une espace y ouvre une regex passée en argument, cf. fragmentByTree) ; `moduleName` : le composant, cité par un
// refus ; `ecrit` : le gestionnaire tel qu'écrit dans le fichier, retrait compris, quand c'est lui que l'on compile : une vraie faute
// de syntaxe y est dite et située
export function cleanJs(expr: string | null | undefined, externalVars: string[] = [], dialect = false, moduleName?: string, written?: string): string {
  const text   = (expr ?? '').toString().trim()
  const byTree = fragmentByTree(text, externalVars, runesAwait, dialect)
  if (byTree !== null) return byTree
  return dialectHandler(text, externalVars, moduleName, written)
}

// les runes à forme d'une expression (`µtoggle`, `µinspect` et son chemin, `µread`, `µwrite`, `µrefresh`, refus des runes du
// script, hooks de cycle de vie compris), réécrites dans le texte écrit par les passes de l'ancienne lecture (cleanJs), dans le même ordre : leur forme dépend du
// texte qui les suit (`µread $x + 1` lit `$x` seul), pas de l'arbre ; l'arbre lit ensuite le reste (`µimport`, passe finale,
// est réécrit après lui) ; `apres` : passe de chaque segment de code, après ses runes (refus des signes d'un gestionnaire)
function writtenShapedRunes(expr: string, externalVars: string[], after: (seg: string) => string = (seg) => seg): string {
  const raw = rewriteMuToggle(expr, 'interpolation {…}/handler')
  const pre = rewritesOrRejectsRunePath(applyContextSetters(raw, externalVars))
  return mapCodeSegments(pre, (seg) => after(shapedRunes(seg, externalVars).replace(RE_MU_INSPECT_ARG_G, inspectArgOutsideComment)), true)
}

// un fragment du dialecte qu'acorn ne lit pas, gestionnaire ou autre (Civet, CoffeeScript : `@x`, `->`, `not`, appel sans parenthèses, commentaire `#`,
// regex étendue, rune à forme, raccourci), lu par l'arbre de bout en bout, dans l'ordre de l'ancienne lecture : (a) ses refus d'abord
// (rune en clé, lettre réservée écrite, puis segment de code après segment de code : runes à forme, puis signes, rejectSigns) ;
// (b) runes à forme et écritures de contexte réécrites dans le texte écrit, `unless` comme l'ancienne lecture ; (c) ses noms lus par
// Civet et sa carte (dialectFragment), la grammaire `->`, `not`, `is` ensuite, qui ne touche à aucun nom, µimport en dernier ; un
// nom que le gabarit ne lit pas est refusé à la place du gestionnaire (locatedReject) ; (d) un texte que Civet ne lit pas est une vraie
// faute, dite sur le texte écrit (handlerFault) et levée avec le texte rendu (`renderedText`) : le générateur garde l'une et
// l'autre, le transpileur la dit après les refus qui la précèdent (nom seul). Sans texte écrit (code que la construction fabrique,
// rappel de transition), le texte est rendu tel quel : sa compilation dit la faute, à la place de l'attribut
function dialectHandler(text: string, externalVars: string[], moduleName: string | undefined, written: string | undefined): string {
  const code   = maskInertSameLength(text)
  const reject = RUNE_AS_KEY_RE.test(code) ? t('reader.expression-rune-as-key') : writtenReservedLetter(text) ? t('reader.expression-letter-reserved-written') : null
  if (reject !== null) throw locatedReject(reject, text, moduleName)
  // µlayout écrit (`µlayout ?= v`, `µlayout++`, `++µlayout`), lu dans le code seul : son refus précis passe avant les runes à forme et
  // l'arbre, qui n'y verrait qu'une écriture de contexte
  if (code.search(RE_MU_LAYOUT_WRITE_G) >= 0 || code.search(RE_MU_LAYOUT_PREFIX_WRITE_G) >= 0) throw new Error(t('lexer.mu-layout-written'))
  const signs = (seg: string): string => rejectSigns(seg, externalVars)
  const runes = SHAPED_RUNES.test(text) || RE_MU_HOOKS.test(text) || text.includes('§') ? writtenShapedRunes(text, externalVars, signs) : null
  if (runes === null) mapCodeSegments(text, signs, true)
  const readable = rewriteUnless(runes ?? text)
  let read: string | null
  try {
    read = dialectFragment(readable, externalVars, runesAwait)
  }
  catch (err: any) {
    // `µ$x`, l'état universel, n'est lu que dans le <script> : refusé comme dans une expression, à la place du gestionnaire
    if (err?.universalState === undefined) throw err
    throw Object.assign(new Error(t('reader.expression-state-universal', { name: err.universalState, place: rejectPlace(moduleName) })), { writtenExpression: text, compiledExpression: `(${text})` })
  }
  if (read !== null) return rewriteMuImport(mapCodeSegments(read, applyGrammarRegex, true), 'interpolation {…}/handler', true)
  const reason = HANDLER_REJECT.get(expressionCounters.last)
  if (reason !== undefined) throw locatedReject(t(reason), text, moduleName)
  const fault = written !== undefined && expressionCounters.last === UNREADABLE_HANDLER ? handlerFault(text, moduleName, written) : null
  if (fault !== null) throw Object.assign(fault, { renderedText: readable })
  return readable
}

// les refus de signes de l'ancienne lecture sur un segment de code d'un gestionnaire, dans son ordre et
// sans rien réécrire : `&$x` (coffre retiré), `µ$$X` sans import, `$$X` d'un singleton importé, `$x := v`, `§` ou `§§` sans nom
function rejectSigns(seg: string, externalVars: string[]): string {
  const vault = /(?<![\w.])&\$([a-zA-Z_][a-zA-Z0-9_$]*)/.exec(seg)
  if (vault) throw vaultRemovedError(vault[1])
  // un `µ$$X` importé se lit `$X`, qui n'est plus un `$$X`
  const read = seg.replace(/µ\$\$([a-zA-Z0-9_]+)/g, (_m: string, name: string) => {
    if (externalVars.includes(`$${name}`)) return `$${name}`
    throw new Error(t('transpiler.singleton-no-import', { name: name }))
  })
  for (const m of read.matchAll(/(?<!\w|(?<!\.)\.)\$\$([a-zA-Z_][a-zA-Z0-9_$]*)/g)) {
    if (externalVars.includes(`$${m[1]}`)) throw importedSingletonError(m[1])
  }
  rejectDeclaration(read, externalVars)
  RE_BARE_SECTION_G.lastIndex = 0
  const alone = RE_BARE_SECTION_G.exec(noComments(read))
  if (alone) throw bareSectionError(alone[0])
  return seg
}

// ============================================================================
// cleanJsExpr — passe GRAMMAIRE branchée
// ============================================================================

// Civet chargé en SYNCHRONE via `require` (CJS, `createRequire` depuis ce
// module ESM) — `cleanJs`/`cleanJsExpr` sont appelés en profondeur dans des
// callbacks `.replace()` synchrones (compile.ts, attributes/index.ts) : un
// `await import()` est IMPOSSIBLE à ces call-sites. Chargement PARESSEUX (au
// premier appel civet réel).
let _civetCompile: ((src: string, opts: Record<string, unknown>) => string) | null = null
export function getCivetCompile(): (src: string, opts: Record<string, unknown>) => string {
  if (!_civetCompile) {
    const req = createRequire(import.meta.url)
    _civetCompile = req('@danielx/civet').compile
  }
  return _civetCompile!
}

// Cache mémo module-level : les mêmes expressions (post-passe symboles)
// reviennent des centaines de fois sur un projet réel (ex. `$.active`,
// `$.items.length > 0`…) — évite de rappeler Civet à chaque occurrence.
// Jamais invalidé : fonction PURE de (texte, options Civet FIXES) → (JS),
// aucune raison de rater le cache entre deux composants/compiles.
const civetExprCache = new Map<string, string>()
// Compteur d'appels RÉELS à Civet (cache MISS) — exposé pour les tests
// (préfixé `_`, jamais consommé en prod) : cf. tests/template-civet.test.ts,
// vérifie que 2 composants partageant la même expression ne recompilent pas.
let _civetCompileMisses = 0
export function _civetExprCacheMisses(): number {
  return _civetCompileMisses
}

// Masque chaînes/commentaires par un filler NON-BLANC (`x`) avant de chercher
// un ternaire collé — DUPLIQUÉ volontairement de
// `MASK_STRINGS_AND_COMMENTS_RE`/l'heuristique des handlers inline
// (transpiler/index.ts:1538-1608, hors-périmètre de cette brique — zone déjà
// livrée, on n'y touche pas ; l'importer depuis là créerait en plus un cycle
// transpiler→generator/compile→generator/utils→transpiler). Un filler ESPACE
// ferait disparaître le caractère juste après le `?` (souvent un guillemet,
// `a?'x':'y'`), rendant le motif `\?[^\s?.:]` aveugle à sa propre cible.
const MASK_STRINGS_AND_COMMENTS_RE =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|###[\s\S]*?###|\/\/[^\n]*|#[^\n]*/g

// Retire l'UNIQUE couche de parenthèses qu'on vient d'ajouter soi-même pour
// donner à Civet une position d'expression valide (`(${expr})`) — la sortie
// reste ainsi un DROP-IN de l'ancien `cleanJs` (bare expression) pour les
// callers qui l'utilisent en cible d'assignation (bindingStandard, etc.) ou
// la ré-enveloppent eux-mêmes (`(${cleanJsExpr(...)}) ? a : b`, compile.ts).
// Scan conscient des chaînes (un `)` DANS une chaîne, ex. un smiley « :) »,
// ne doit jamais compter comme fermeture) ; ne retire QUE si le PREMIER `(`
// ferme EXACTEMENT sur le DERNIER caractère (un seul groupe enveloppant
// l'expression ENTIÈRE, pas deux groupes juxtaposés `(a)+(b)`). Limite
// assumée : ne traque pas les literals regex (`/…/`) — un `)` à l'intérieur
// d'un tel literal fait décliner le strip (branche `return s`), jamais une
// corruption (l'échec de cette fonction est TOUJOURS du côté sûr :
// parenthèses superflues gardées, jamais du JS cassé).
function stripOuterParens(s: string): string {
  if (s.length < 2 || s[0] !== '(' || s[s.length - 1] !== ')') return s
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i += 1
      while (i < s.length && s[i] !== quote) { if (s[i] === '\\') i += 1; i += 1 }
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i === s.length - 1 ? s.slice(1, -1) : s
    }
  }
  return s
}

// Compile la passe GRAMMAIRE d'une expression déjà nettoyée par la passe
// SYMBOLES (`symbolsCleaned`) via une VRAIE compilation Civet synchrone.
// `rawExprForError` = texte tel qu'écrit par l'utilisateur (avant TOUTE
// passe) — le plus reconnaissable pour un message d'erreur orientant.
// le texte écrit d'une expression du gabarit, ses chaînes, gabarits et regex blanchis (même longueur), ses commentaires `# …` en blancs
// (hashCommentEnd) : un opérateur écrit avant un commentaire reste le dernier
function readExpression(text: string): string {
  let mask = ''
  let i    = 0
  while (i < text.length) {
    const c = text[i]
    const f = hashCommentEnd(text, i)
    const e = f > i ? f : c === '"' || c === "'" ? stringEnd(text, i) : c === '`' || c === '/' ? scanInertAt(text, i, true) : -1
    if (e > i) {
      mask += (f > i ? ' ' : 'x').repeat(e - i)
      i = e
      continue
    }
    mask += c
    i++
  }
  return mask
}

// les opérateurs qu'une expression ne laisse pas en fin : Civet ferait de `$a +` une fonction (`b => $.a + b`), affichée telle quelle,
// ou toujours vraie dans un `{if}` ; `++`, `--`, `?` (existence) et les flèches `->`, `=>` ne comptent pas
const TRAILING_OPERATOR = /(?:(?<!\+)\+|(?<!-)-|\*\*?|\/|%|\^|&&?|\|\|?|\?\?|<<|>>>?|(?<![-=])>=?|<=?|===?|!==?|(?<![\w$.])(?:and|or|isnt|is|instanceof|in))$/

// l'opérateur laissé en fin d'expression, ou null ; un `>` qui ferme un `<` ouvert (générique TypeScript : `$o as Record<string, number>`,
// `Array<number>`) n'en est pas un
function trailingOperator(mask: string): string | null {
  const text = mask.trimEnd()
  const op   = TRAILING_OPERATOR.exec(text)
  if (!op || op[0][0] !== '>') return op ? op[0] : null
  let open   = 0
  let closes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '<' && text[i + 1] !== '=' && text[i + 1] !== '<' && text[i - 1] !== '<') {
      open++
      closes = false
    }
    else if (c === '>' && text[i - 1] !== '-' && text[i - 1] !== '=' && text[i + 1] !== '=') {
      closes = open > 0
      if (closes) open--
    }
    else if (!/\s/.test(c)) closes = false
  }
  return closes ? null : op[0]
}

// un paramètre de rappel nommé `$nom` (`($v) => …`, `(x, $v) -> …`, `$v => …`) : `$` y désigne l'état, le rappel l'écrirait à chaque appel ;
// un `$x` lu dans la valeur par défaut d'un paramètre (`(x = $d) => …`) reste permis
const ARROW_PARAMS = /\(([^()]*)\)\s*[-=]>|(?<![\w$.])(\$[A-Za-z_]\w*)\s*=>/g

// faute d'une expression du gabarit que Civet compile sans un mot (une fonction affichée, une écriture de l'état), ou null
function writtenExpressionFault(text: string): string | null {
  const mask = readExpression(text)
  const op   = trailingOperator(mask)
  if (op) return t('generator.reason-operator-final', { op, written: text.trim().replace(/\s+/g, ' ') })
  for (const m of mask.matchAll(ARROW_PARAMS)) {
    const name = m[2] ?? m[1].split(',').map((p) => /^\s*(?:\.\.\.)?(\$[A-Za-z_]\w*)\s*(?:=|$)/.exec(p)?.[1]).find(Boolean)
    if (name) return t('generator.reason-param-dollar', { name: name, bare: name.slice(1) })
  }
  return null
}

function compileGrammarViaCivet(symbolsCleaned: string, rawExprForError: string, moduleName: string | undefined): string {
  const trimmed = symbolsCleaned.trim()
  if (trimmed === '') return trimmed

  const normalized = isntNormalized(trimmed)

  const cached = civetExprCache.get(normalized)
  if (cached !== undefined) return cached

  let compiled: string
  try {
    // DRIFT SÉMANTIQUE ASSUMÉ — `coffeeEq: true` fait compiler `==`/`!=` en `===`/`!==`,
    // comme la convention stricte des `<script>` Civet du projet. Par défaut
    // Civet NE fait PAS cette conversion (vérifié par sonde directe :
    // `compile('($.n == 1)', {js:true, sync:true})` renvoie `==` inchangé
    // sans ce flag) — c'est un choix d'harmonisation ASSUMÉ ici, pas un
    // comportement natif Civet. Attesté par tests/template-civet.test.ts.
    compiled = civetOfExpression(normalized, moduleName)
    _civetCompileMisses += 1
  } catch (err: any) {
    throw civetError(err, trimmed, normalized, rawExprForError, moduleName)
  }

  const result = finishCivetExpression(compiled, rawExprForError, moduleName)
  civetExprCache.set(normalized, result)
  return result
}

// `isnt` (Coffee) → `is not` : Civet ne le connaît pas — il parse `a isnt b` en
// appel `a(isnt(b))`, miscompile silencieux. même
// remède que la Pass 2b des <script> (transpiler/index.ts:866), hors chaînes/
// commentaires (mapCodeSegments), regex prudente calquée sur applyGrammarRegex
// (`.isnt` propriété intact)
function isntNormalized(text: string): string {
  return mapCodeSegments(text, (seg) => seg.replace(/(?<![\w.\$])\bisnt\b(?!\s*[:)\]},;])/g, 'is not'), true)
}

// DRIFT SÉMANTIQUE ASSUMÉ — `coffeeEq: true` fait compiler `==`/`!=` en `===`/`!==`,
// comme la convention stricte des `<script>` Civet du projet (cf. compileGrammarViaCivet)
function civetOfExpression(normalized: string, moduleName: string | undefined): string {
  return getCivetCompile()(wrapper(normalized), {
    js: true,
    sync: true,
    filename: moduleName ? `${moduleName}.expr` : 'mjs-expr',
    parseOptions: { coffeeEq: true },
  })
}

// Erreur orientante — calque le try/catch des handlers inline
// (transpiler/index.ts:1538+, zone déjà livrée hors-périmètre de cette
// brique) : même indice ternaire collé (`a?b:c`), même filler non-blanc.
function civetError(err: any, trimmed: string, normalized: string, rawExprForError: string, moduleName: string | undefined): Error {
  const civetMsg = err?.message ?? String(err)
  const codeOnly = trimmed.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => 'x'.repeat(m.length))
  const gluedTernaryHint = /\?[^\s?.:]/.test(codeOnly)
    ? t('generator.hint-ternary-glued')
    : ''
  const moduleHint = moduleName ? t('generator.hint-in-module', { moduleName }) : ''
  // le texte écrit et celui donné à Civet : le transpileur ramène la position de Civet au fichier où l'expression est écrite
  return Object.assign(new Error(t('generator.interpolation-failed-civet', { moduleHint, rawExprForError, civetMsg, gluedTernaryHint })), { writtenExpression: rawExprForError, compiledExpression: wrapper(normalized) })
}

// une expression que l'arbre ne lit pas : illisible, le message de Civet sur le texte écrit (sa ligne, sa colonne), ses signes
// déguisés le temps de la compilation (Civet ne lit pas `§`, même longueur) ; lisible, un refus de construction avec la raison
// de l'arbre, plutôt qu'une sortie fausse
function unreadExpression(text: string, rawExprForError: string, moduleName: string | undefined): Error {
  const normalized = isntNormalized(text)
  try {
    civetOfExpression(isntNormalized(disguiseExpression(text)), moduleName)
  }
  catch (err: any) {
    return civetError({ message: reusedSigns(String(err?.message ?? err)) }, text, normalized, rawExprForError, moduleName)
  }
  return locatedReject(expressionCounters.last, rawExprForError, moduleName)
}

// refus d'une expression lisible, situé comme une faute de Civet : le repère `module.expr:1:2` (début de l'expression, après la
// parenthèse ouvrante) devient le fichier, la ligne et la colonne où elle est écrite (locateExpression, transpileur) ; introuvable, il est
// retiré (`loneLandmark`) : il n'est la place de rien
function locatedReject(reason: string, rawExprForError: string, moduleName: string | undefined): Error {
  const moduleHint = moduleName ? t('generator.hint-in-module', { moduleName }) : ''
  return Object.assign(new Error(t('generator.expression-not-read', { moduleHint, rawExprForError, reason: reason, place: rejectPlace(moduleName) })), { writtenExpression: rawExprForError, compiledExpression: `(${rawExprForError})`, loneLandmark: true })
}

function rejectPlace(moduleName: string | undefined): string {
  return moduleName ? `${moduleName}.expr:1:2 — ` : ''
}

// une vraie faute de syntaxe dans un gestionnaire du dialecte (`$x = not`) : l'erreur de Civet sur le texte écrit, lu dans la
// grammaire du lot des gestionnaires, ses signes déguisés le temps de la compilation (même longueur), située comme celle d'une
// expression (fichier, ligne, colonne : locateExpression, transpileur, sur le texte `ecrit` dans le fichier, retrait compris) avec le
// nom du composant ; null quand Civet lit ce texte
function handlerFault(text: string, moduleName: string | undefined, written: string): Error | null {
  const name = moduleName ? `${moduleName}.expr` : 'mjs-expr'
  try {
    getCivetCompile()(HANDLER_DIRECTIVE + disguiseExpression(text), { js: true, sync: true, filename: name })
    return null
  }
  catch (err: any) {
    // `$x =: v # note` : `=:` enveloppe la valeur jusqu'au bout de sa ligne, le commentaire en avale la parenthèse fermante ; refus qui le
    // dit, situé comme la faute de Civet (le repère `module.expr:1:2` devient le fichier, la ligne et la colonne écrits)
    if (/=:[^\n]*\s#(?:\s|$)/m.test(written)) return Object.assign(new Error(t('transpiler.snap-and-comment', { moduleName: moduleName ?? '', lineHint: ` (${name}:1:2)` })), { writtenExpression: written, compiledExpression: `(${text})` })
    // la directive occupe la ligne 1 ; sur la première ligne écrite, la colonne compte la parenthèse que locateExpression suppose devant
    const position = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)`)
    const civetMsg = reusedSigns(String(err?.message ?? err)).replace(position, (_m: string, l: string, c: string) => `${name}:${Number(l) - 1}:${Number(l) === 2 ? Number(c) + 1 : Number(c)}`)
    const codeOnly = text.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => 'x'.repeat(m.length))
    const gluedTernaryHint = /\?[^\s?.:]/.test(codeOnly) ? t('generator.hint-ternary-glued') : ''
    return Object.assign(new Error(t('transpiler.handler-inline-failed-civet', { moduleName: moduleName ?? '', lineHint: '', civetMsg, gluedTernaryHint })), { writtenExpression: written, compiledExpression: `(${text})` })
  }
}

// la sortie de Civet d'une expression, lue par l'arbre, rendue au générateur
function finishCivetExpression(compiled: string, rawExprForError: string, moduleName: string | undefined): string {
  // paramètre que Civet lit autrement (`{$l.map((x, readonly) -> x)}`) : même refus que dans le <script> ; la ligne du
  // fichier est cherchée par le transpileur, au texte écrit de l'expression (withTemplateLine)
  const faulty = paramReadOtherwise(compiled, () => null)
  if (faulty) {
    const error      = new ParamReadOtherwiseError(faulty, moduleName ? `${moduleName}.mjs` : 'mjs-expr', compiled, null, null)
    error.expression = rawExprForError
    throw error
  }

  // Retire le `;`/saut de ligne final éventuel PUIS la parenthèse enveloppante
  // qu'on vient d'ajouter — sortie = expression JS nue, drop-in de cleanJs.
  const out = compiled.replace(/;\s*$/, '').trim()
  return out.includes(';') && !isExpression(out) ? asIife(out) : stripOuterParens(out)
}

// Civet déclare devant l'expression ce qu'elle emprunte : une aide (`[1..200]` → `var range = …`, `a %% b` → `var modulo = …`),
// une variable (`0 < $x < 5` → `let ref;`), la boucle d'une compréhension écrite seule (`(e for e of $l)` → `const results=[];for …`).
// Ces instructions et l'expression partent ensemble dans une fléchée appelée sur place, qui rend la valeur (`this` inchangé) ;
// avec un `await` hors des fonctions écrites, la fléchée est async, attendue à la place de l'expression
function asIife(out: string): string {
  let body: any[]
  try {
    body = (acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true }) as any).body
  }
  catch {
    return stripOuterParens(out)
  }
  const last = body[body.length - 1]
  // une seule instruction (ou des `;` seuls devant elle) : la sortie reste telle quelle
  if (last?.type !== 'ExpressionStatement' || body.slice(0, -1).every((s: any) => s.type === 'EmptyStatement')) return stripOuterParens(out)
  const expr     = stripOuterParens(out.slice(last.expression.start, last.expression.end))
  const bodyCode = `{ ${out.slice(0, last.start).trim()} return (${expr}); }`
  return awaitsAtTopLevel(out) ? `(await (async () => ${bodyCode})())` : `(() => ${bodyCode})()`
}

// un `await` (ou `for await`) au premier niveau du code, hors des fonctions qu'il écrit (rappel d'un gestionnaire, instructions
// d'une expression)
export function awaitsAtTopLevel(js: string): boolean {
  if (!/\bawait\b/.test(js)) return false
  let tree: any
  try {
    tree = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })
  }
  catch {
    return false
  }
  const visit = (n: any): boolean => !/Function/.test(n.type) && (n.type === 'AwaitExpression' || (n.type === 'ForOfStatement' && n.await) || Object.values(n).some((v: any) => (Array.isArray(v) ? v : [v]).some((c: any) => c && typeof c.type === 'string' && visit(c))))
  return visit(tree)
}

// conversion Coffee `"…#{X}…"` → gabarit : une seule fonction, dans le lexeur (partagée avec la Pass 3 du <script>).
// Sans elle, une interpolation `#{}` DANS une expression de template (`{"val: #{$x}"}`) atteint Civet, qui ne la lit
// pas : `$x` reste du texte inerte, jamais suivi (cf. docs/03-reactivite.md)
export { convertCoffeeInterpolations }

// `() => { if ($a) { $x = 5 } }` : Civet lit les accolades d'une flèche comme un OBJET dès que leur contenu en forme un
// (`if (a) {…}` y devient une méthode nommée `if`) — la flèche rendait cet objet, le clic restait sans effet, sans
// erreur. Un `;` collé à la dernière instruction, avant un commentaire final, en fait un bloc, comme en JavaScript ;
// posé seulement quand la lecture de Civet donne un objet, tout autre gestionnaire reste tel qu'écrit. Civet n'est
// consulté que si une instruction du premier niveau commence par un mot de contrôle : sans lui, une lecture en objet
// garde le code exécuté (`{ foo() }` y vaut `{ foo: foo() }`), quand un `;` en ferait une méthode (`foo();` y devient
// `foo() {;}`, l'appel n'a plus lieu)
const ARROW_BRACE_RE  = /^\s*(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)?\s*=>\s*\{/
const ARROW_OBJECT_RE = /^\(*\s*(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)?\s*=>\s*\(\s*\{/
const CONTROL_WORD_RE = /\s*(?:if|unless|while|until|for|switch|try|do|loop|with)(?![\w$])/y
export function blockArrowBody(js: string): string {
  const head = ARROW_BRACE_RE.exec(js)
  if (!head) return js
  const end = js.trimEnd().length - 1
  if (js[end] !== '}') return js
  // l'accolade finale doit refermer celle de la flèche (chaînes et commentaires masqués) ; au premier niveau du corps (accolades
  // de la flèche, hors parenthèses et crochets), le mot qui commence chaque instruction
  const mask  = maskInertSameLength(js)
  let depth   = 0
  let groups  = 0
  let control = false
  for (let i = head[0].length - 1; i <= end; i++) {
    const c = mask[i]
    if (c === '(' || c === '[') groups++
    else if (c === ')' || c === ']') groups--
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0 && i < end) return js
    }
    if (depth === 1 && groups === 0 && (c === '{' || c === '\n' || c === ';') && !control) {
      CONTROL_WORD_RE.lastIndex = i + 1
      control = CONTROL_WORD_RE.test(mask)
    }
  }
  if (depth !== 0 || !control) return js
  let read: string
  try {
    read = getCivetCompile()(`(${js})`, { js: true, sync: true, parseOptions: { coffeeEq: true } })
  }
  catch {
    return js
  }
  if (!ARROW_OBJECT_RE.test(read.trim())) return js
  // `;` collé à la dernière instruction (sur sa propre ligne, il casserait l'indentation lue par Civet), lue sur le masque : un
  // commentaire final l'aurait avalé
  let k = end - 1
  while (/\s/.test(mask[k])) k--
  return js.slice(0, k + 1) + ';' + js.slice(k + 1)
}

// cleanJsExpr : variante « site EXPRESSION » de cleanJs — cf. header pour la
// cartographie complète EXPR vs FRAGMENT. `moduleName` est transmis par
// l'appelant depuis `state`/`env.compiler` (CompilerState).
export function cleanJsExpr(
  expr: string | null | undefined,
  externalVars: string[] = [],
  moduleName?: string
): string {
  const raw = (expr ?? '').toString().trim()
  if (raw === '') return raw
  const interpolated = convertCoffeeInterpolations(raw, undefined, true)
  const js           = templateExpression(interpolated, raw, externalVars, moduleName)
  rejectTemplateTimer(js)
  return js
}

// un texte du gabarit passé par le lexeur (`$x` écrit `$.x`) a-t-il la forme d'un JavaScript, sa grammaire du dialecte réécrite
// (`is`, `not`, `and`, `or`, `->`, `unless`) et les signes de MJS (`@x`, `§x`, `@@x`, `&id`) pris pour des lettres d'un nom ? Un test
// de forme seul, sans Civet, qui lit presque tout (`pill p_{$x}` y devient un appel, dont l'effet se perd)
export function javaScriptShape(tokenise: string): boolean {
  const text = disguiseExpression(mapCodeSegments(rewriteUnless(tokenise), applyGrammarRegex)).replace(/@/g, 'µ')
  try {
    acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' })
    return true
  }
  catch {
    return false
  }
}

function isExpression(js: string): boolean {
  try {
    acorn.parse(`(${js}\n)`, { ecmaVersion: 'latest', sourceType: 'module' })
    return true
  }
  catch {
    return false
  }
}

// le JavaScript d'un texte du gabarit, pour l'analyse de ses dépendances (generator/state.ts) : `tokenise`, le texte passé par le
// lexeur, quand il est du JavaScript (acorn le lit, raccourcis réécrits sur son arbre) ; sinon le code que chacun de ses `morceaux`,
// tels qu'écrits, émet (cleanJsExpr), en éléments d'un tableau : ses lectures sont celles du code exécuté, par construction. Un code
// émis qui n'est pas une expression (`let ref;` d'une comparaison chaînée, boucle d'une compréhension) se lit dans un bloc devant le
// tableau ; l'état que `µ.inspect` lit par son nom y est écrit `$.x`, à la place de l'appel. null quand un morceau ne se compile pas
export function dependenciesJs(tokenise: string, pieces: string[], externalVars: string[], moduleName?: string): string | null {
  return fragmentByTree(tokenise.trim(), externalVars, runesAwait) ?? emittedDepCode(pieces, externalVars, moduleName)
}

// le code que des expressions écrites émettent, en éléments d'un tableau à analyser (cf. dependenciesJs) ; null quand l'une ne se
// compile pas
export function emittedDepCode(pieces: string[], externalVars: string[], moduleName?: string): string | null {
  const blocks: string[]   = []
  const elements: string[] = []
  try {
    for (const piece of pieces) {
      const emitted   = cleanTemplateExpr(piece, externalVars, moduleName)
      // `µinspect` (rune de la console) lit l'état par son nom : il ne fait pas de dépendance, comme avant
      const js     = emitted
      if (isExpression(js)) elements.push(js)
      else blocks.push(`{ ${js}\n}`)
    }
  }
  catch {
    return null
  }
  return `${blocks.join('\n')}${blocks.length > 0 ? '\n' : ''}[${elements.join(', ')}]`
}

// une expression du gabarit compilée (cleanJsExpr) sans ses commentaires `# …` et `### … ###` (noHashComment, lexeur) : la règle
// unique des endroits où le générateur compile une expression écrite dans le gabarit, où un commentaire se lit comme un commentaire ;
// cleanJsExpr seul garde la lecture d'avant, que figent les tests de l'ancienne lecture
export function cleanTemplateExpr(expr: string, externalVars: string[], moduleName?: string): string {
  return cleanJsExpr(noHashComment(expr), externalVars, moduleName)
}

// le JavaScript d'une condition du gabarit (`@class{$x is item}`), où chercher un motif filtré (attributes/index.ts) : du JavaScript,
// lu par acorn ; sinon le code qu'elle émet (cleanJsExpr) ; null quand elle ne se compile pas (pas de motif filtré, la liaison
// ordinaire la compile et dit sa faute)
export function conditionJs(text: string, externalVars: string[], moduleName?: string): string | null {
  text = noHashComment(text)
  const byTree = fragmentByTree(text.trim(), externalVars, runesAwait)
  if (byTree !== null) return byTree.trim()
  try {
    return cleanJsExpr(text, externalVars, moduleName).trim()
  }
  catch {
    return null
  }
}

// l'expression sans l'opérateur qui la finit, la correction que propose son refus (cf. FaultFix) ; telle quelle sinon
function withoutTrailingOperator(text: string): string {
  const written = text.trim()
  const op      = trailingOperator(readExpression(text))
  return op && written.endsWith(op) ? written.slice(0, -op.length).trimEnd() : written
}

const RUNE_AS_KEY_RE = /(?:^|[{,])\s*µ[\w$]+\s*:(?!:)/

// une expression lue par l'arbre (reader/expression.ts : une compilation Civet du texte écrit, raccourcis réécrits sur
// l'arbre ESTree) ; ses compilations Civet sont comptées avec les autres (_civetExprCacheMisses). Le texte que l'arbre a
// réécrit à la place des noms (`reecrit` : comparaison chaînée, nom en clé ou en paramètre, rune à forme, faute de Civet)
// est compilé comme celui de l'ancienne lecture, même sortie, même message ; une expression qu'il ne lit pas est refusée
function templateExpression(interpolated: string, raw: string, externalVars: string[], moduleName: string | undefined): string {
  // refusée, située comme une faute de Civet : une expression qui finit par un opérateur, ou qui nomme un paramètre de rappel `$nom`
  const fault = writtenExpressionFault(raw)
  if (fault) throw FaultFix.attach(locatedReject(fault, raw, moduleName), raw.trim(), withoutTrailingOperator(raw))
  // une rune en clé d'objet (`{µread: 1}`) : la passe des runes la réécrirait en appel, Civet n'en dirait qu'une faute obscure
  if (RUNE_AS_KEY_RE.test(maskInertSameLength(interpolated))) throw locatedReject(t('reader.expression-rune-as-key'), raw, moduleName)
  const before = codeCounters.compilations
  const runes  = SHAPED_RUNES.test(interpolated) || RE_MU_HOOKS.test(interpolated) ? writtenShapedRunes(interpolated.trim(), externalVars) : null
  let read: ReturnType<typeof expressionByTree>
  try {
    read = expressionByTree(runes ?? interpolated.trim(), externalVars, runesAwait, runes !== null)
  }
  catch (err: any) {
    if (err?.universalState === undefined) throw err
    throw Object.assign(new Error(t('reader.expression-state-universal', { name: err.universalState, place: rejectPlace(moduleName) })), { writtenExpression: raw, compiledExpression: `(${raw})` })
  }
  _civetCompileMisses += codeCounters.compilations - before
  if (typeof read === 'string') return finishCivetExpression(read, raw, moduleName)
  if (read !== null) return compileGrammarViaCivet(runes === null ? read.rewritten : rewriteMuImport(read.rewritten, 'interpolation {…}/handler', true), raw, moduleName)
  throw unreadExpression(interpolated.trim(), raw, moduleName)
}

// noms que le composant déclare hors de l'accolade (racine du <script>, <script module>, `@import`), posés par le
// transpileur le temps de compiler son gabarit : une accolade qui appelle le `setTimeout` du composant n'appelle pas la
// minuterie globale
let componentNames: string[] = []

// noms que le gabarit met en portée à l'endroit compilé (variable et index des `{for}` englobants, valeur d'une branche
// `{success}` / `{error}`, `{const}` du bloc), posés par le parcours du gabarit (walk, generator/compile.ts) :
// `{for top in $l}` puis `{top.setTimeout()}` lit la variable de la boucle, pas l'objet global ; hors du bloc, le nom
// redevient global
let templateLocals: Set<string> | null = null

/** les noms du gabarit en portée du nœud parcouru (cf. setTemplateLocals) : une fonction du `<script>` du même nom n'est pas
 * celle qu'appelle une expression de ce nœud (Analyzer.getEffectVars) */
export function templateLocalsInScope(): Set<string> | null {
  return templateLocals
}

/** pose les noms du gabarit en portée du nœud parcouru ; rend ceux d'avant, reposés en sortant du nœud */
export function setTemplateLocals(names: Set<string> | null): Set<string> | null {
  const before   = templateLocals
  templateLocals = names
  return before
}

export function withComponentNames<T>(names: string[], build: () => T): T {
  const before   = componentNames
  componentNames = names
  try {
    return build()
  }
  finally {
    componentNames = before
  }
}

// setTimeout / setInterval dans une accolade du gabarit (interpolation, attribut lié, condition, `@attach`) : recalculée
// à chaque rendu ou rejouée à chaque pose de la balise, elle poserait une minuterie à chaque passage, que rien n'arrête —
// refusée comme dans le <script>, par la même lecture (transpiler/timers.ts), avec les noms du composant et ceux que
// le gabarit met en portée. Relue seulement si son texte nomme l'une des deux, ou lit un membre par une chaîne ET nomme
// l'objet global ou le document qui y mène (`window['set' + 'Timeout']`, `document['default' + 'View']['set' + 'Timeout']`, le
// `ownerDocument` d'un nœud : seules formes qui l'assemblent, `defaultView` n'y est jamais écrit d'un tenant) : `{$t['cle']}`,
// courant, n'est pas relue ; illisible par acorn (aucune des trois formes), refusée dès que son texte, chaînes ôtées, nomme l'une
// des deux
const TIMER_RE         = /set(?:Timeout|Interval)/
const STRING_MEMBER_RE = /\[[^\]]*['"`]/
const GLOBAL_OBJECT_RE = /\b(?:window|globalThis|self|top|parent|frames|defaultView|document|ownerDocument)\b/
export function rejectTemplateTimer(js: string): void {
  if (!TIMER_RE.test(js) && !(STRING_MEMBER_RE.test(js) && GLOBAL_OBJECT_RE.test(js))) return
  const body = js.replace(/;\s*$/, '')
  let ast: any = null
  for (const source of [js, '(' + body + '\n)', '[' + body + '\n]']) {
    try { ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); break }
    catch { ast = null }
  }
  const free = templateLocals ? [...componentNames, ...templateLocals] : componentNames
  const name = ast ? rawTimers(ast, free)[0]?.name : js.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''").match(/\bset(?:Timeout|Interval)\b/)?.[0]
  if (name) throw new Error(t('generator.timer-template', { name: name }))
}

// setTimeout / setInterval dans un rappel de transition (`@introend={…}`, sa fonction entière), avec les noms du composant et ceux que
// le gabarit met en portée : le nom de la première, refusée comme dans un gestionnaire (cf. callbackFunction) ; null sans minuterie
export function callbackTimer(fn: string, locals: Iterable<string>): string | null {
  if (!TIMER_RE.test(fn) && !(STRING_MEMBER_RE.test(fn) && GLOBAL_OBJECT_RE.test(fn))) return null
  let ast: any
  try {
    ast = acorn.parse(fn, { ecmaVersion: 'latest', sourceType: 'module' })
  }
  catch {
    return null
  }
  return rawTimers(ast, [...componentNames, ...locals])[0]?.name ?? null
}

// parse_mixed_string : transforme un raw_val (chaîne avec {expr} interpolés)
// en template literal JS. Chaque `{expr}` est un site EXPRESSION (même
// nature qu'une interpolation texte) → passe par `cleanJsExpr`.
export function parseMixedString(
  rawVal: string,
  externalVars: string[] = [],
  moduleName?: string
): string {
  // Cas pur : si tout est dans des braces équilibrées { ... } sans rien autour.
  // Comptage CONSCIENT des chaînes (comme le scanner voisin juste en dessous et
  // mapCodeSegments plus haut) : un `}` littéral DANS une chaîne de l'expression
  // (`{$flag != '}'}`) fermait sinon le comptage AVANT la vraie fin — la valeur
  // repartait « mixte » (template literal, coercion en chaîne) et un booléen
  // s'inversait en silence au rendu. Trouvé en testant.
  if (rawVal.startsWith('{') && rawVal.endsWith('}')) {
    let balance    = 0
    let isPure     = true
    let inString   = false
    let stringChar = ''
    for (let i = 0; i < rawVal.length; i++) {
      const c = rawVal[i]
      if (inString && c === '\\') { i += 1; continue }
      if (c === '"' || c === "'" || c === '`') {
        if (!inString) { inString = true; stringChar = c }
        else if (stringChar === c) inString = false
      } else if (!inString) {
        if (c === '{') balance += 1
        if (c === '}') balance -= 1
      }
      if (balance === 0 && i < rawVal.length - 1) {
        isPure = false
        break
      }
    }
    if (isPure) return cleanTemplateExpr(rawVal.slice(1, -1), externalVars, moduleName)
  }

  // Application du bouclier sur les chaînes mixtes.
  // exiger une lettre/`_` en tête : un `$5` littéral (prix, "5$") n'est PAS
  // une variable et ne doit pas devenir `${$.5}` (SyntaxError). Aligné sur
  // la porte d'aiguillage (`\$[a-zA-Z_]`). `$$nom` (store, thème) se lit comme
  // `{$$nom}` : compilé par cleanJsExpr, comme l'expression entre accolades.
  // Appliqué au seul TEXTE de l'attribut, segment par segment : passé sur le résultat entier, il
  // réécrivait aussi le code déjà compilé des `{…}` — un `$US` dans une chaîne de l'expression
  // (`{$n + ' $US'}`), le `$count` d'un singleton importé (`{µ$$count.value}`, enveloppé deux fois)
  // Le texte fixe a ses entités décodées, comme le ferait le navigateur (l'attribut est posé par `setAttribute`, qui ne décode
  // rien), puis il est échappé pour le gabarit : un `${` que seul le décodage fait apparaître (`&#36;&#123;`) reste du texte, et
  // un `$nom` écrit en entité n'est pas une variable
  const fixed = (s: string): string => decodeHtmlEntities(s).replace(/[\\`]|\$(?=\{)/g, (c) => '\\' + c)
  const shorthand = (text: string): string => {
    let output = ''
    let start  = 0
    for (const m of text.matchAll(/(?<![\w$]|(?<!\.)\.)(?:\$\$([a-zA-Z_]\w*)|\$([a-zA-Z_][a-zA-Z0-9_$]*))/g)) {
      const [seen, store, name] = m
      const varName = `$${name}`
      output += fixed(text.slice(start, m.index))
      if (store) output += `\${${cleanJsExpr(`$$${store}`, externalVars, moduleName)}}`
      else output += externalVars.includes(varName) ? `\${${varName}}` : `\${$.${name}}`
      start = m.index! + seen.length
    }
    return output + fixed(text.slice(start))
  }

  let jsEval = ''
  let text   = ''
  let i      = 0
  const n    = rawVal.length

  while (i < n) {
    if (rawVal[i] === '{') {
      jsEval += shorthand(text)
      text = ''
      const opens = i
      i += 1
      let expr = ''
      let balance = 1
      let inString = false
      let stringChar: string | null = null

      while (i < n && !(balance === 0 && !inString)) {
        const ch = rawVal[i]

        // échappement en SAUT AVANT (jamais un regard arrière) : un
        // `\\` (antislash ÉCHAPPÉ, deux caractères) juste avant un guillemet
        // faisait croire, avec l'ancien regard arrière (`expr[expr.length-1]
        // !== '\\'`), à un guillemet lui-même échappé → la chaîne n'était
        // jamais refermée, la fenêtre entière avalée. Consomme les DEUX
        // caractères d'un coup, même modèle qu'interpolateSigils
        // (lexer/index.ts:91-123).
        if (inString && ch === '\\') {
          expr += ch + (rawVal[i + 1] ?? '')
          i += 2
          continue
        }

        if (ch === '"' || ch === "'" || ch === '`') {
          if (!inString) { inString = true; stringChar = ch }
          else if (stringChar === ch) { inString = false; stringChar = null }
        }

        if (!inString) {
          if (ch === '{') balance += 1
          if (ch === '}') balance -= 1
        }

        if (balance > 0 || inString) expr += ch
        i += 1
      }

      // le quantifieur d'une expression régulière, écrit juste après un caractère (`[0-9]{5}`, `\d{2,4}`, `a{3,}`), et des accolades vides
      // restent du texte, comme dans splitBraceSegments (attributes/index.ts) : aussi dans une valeur qui cite une variable
      // (`pattern="[0-9]{5}-{$n}"`) ; en tête de valeur, des chiffres seuls sont une expression (`tabindex="{0}"` vaut 0)
      if (balance === 0 && ((opens > 0 && /^\s*\d+\s*(?:,\s*\d*\s*)?$/.test(expr)) || expr.trim() === '')) {
        text += `{${expr}}`
        continue
      }
      jsEval += `\${${cleanTemplateExpr(expr, externalVars, moduleName)}}`
    } else {
      text += rawVal[i]
      i += 1
    }
  }
  jsEval += shorthand(text)

  return `\`${jsEval}\``
}

// V2 — plus de `getCond`. Les updates n'ont plus de condition `dirty & mask` :
// ils sont enregistrés dans `effectsByVar` indexés par leur liste de deps, et
// le runtime n'invoque que ceux abonnés à la var muée. Les blocs structurels
// (`{if}`, `{for}`, `{await}`, `{key}`) sont émis sans condition aussi —
// regroupés dans `_mjs_renderStruct` qui est rejoué à chaque mutation (coût négligé,
// la structure mute rarement).

// decodeHtmlEntities — même sémantique que le parseur HTML natif pour un attribut
// STATIQUE : le chemin HTML (`staticAttr`, attributes/index.ts) laisse les entités
// telles quelles dans la chaîne injectée (le navigateur les décode LUI-MÊME au parse,
// via innerHTML/`µ._mjs_cloneTpl`) — le chemin DOM (`emitAttrSet`, paths.ts : setAttribute/
// prop directe construits par appel, jamais parsés) ne bénéficie d'AUCUN décodage
// natif, il faut donc le faire ICI, avant `JSON.stringify` (de même pour le texte du mode
// impératif, cf. appendTextNode). Toutes les entités nommées du standard (html-entities.ts)
// + numériques décimales (`&#123;`) et hexadécimales (`&#x7B;`/`&#X7B;`) ; un `&` qui
// n'amorce pas une entité reconnue, ou un nom inconnu, reste intact (jamais de
// décodage agressif qui altérerait un texte contenant un `&` nu).
// Les 106 noms historiques se lisent aussi SANS `;`, le plus long en tête (`&notit;` → `¬it;`), comme le
// navigateur : partout dans un texte (`texte`), et dans un attribut sauf devant une lettre, un chiffre
// ou `=` (`?a=1&copy=2` reste tel quel). Une référence numérique se lit aussi sans `;`, dans un texte comme dans un
// attribut (cette exception ne vaut que pour les noms) : elle s'arrête au premier caractère qui n'est pas un chiffre
// de sa base (`&#65x` → `Ax`)
// noms d'entités que le standard HTML lit aussi sans `;` (héritage) : les 96 caractères de U+00A0 à U+00FF,
// `amp` `lt` `gt` `quot`, et six formes en capitales
const LEGACY_ENTITIES = new Set('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml amp lt gt quot AMP LT GT QUOT COPY REG'.split(' '))
// références numériques 128 à 159 : le standard HTML les lit par la table windows-1252 (`&#128;` → €, `&#150;` → –) ;
// les cinq codes qu'elle ne définit pas (129, 141, 143, 144, 157) restent tels quels
const WINDOWS_1252 = '€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8DŽ\x8F\x90‘’“”•–—˜™š›œ\x9DžŸ'

// noms d'attribut que le filtre du runtime (`µ._mjs_safeAttr`, mjs_init.ts) peut refuser, comparés en minuscules comme lui :
// gestionnaire `on…`, `srcdoc`, adresse (`µ._mjs_URL_ATTRS`, et `data`, `codebase` d'un <object>)
const RISKY_ATTR = /^(?:on[a-z][\s\S]*|srcdoc|href|src|xlink:href|action|formaction|poster|ping|background|data|codebase)$/

/** Dernier argument d'une écriture d'attribut calculé (`µ._mjs_updAttrNode(n, nom, v, 1)`, `this._mjs_updAttr(id, nom, v, 1)`) :
 * `, 1` quand le nom, écrit dans le gabarit, n'a rien à faire refuser au filtre du runtime, qui pose alors la valeur sans lui ;
 * rien pour un nom à risque, ni pour `class`, que le runtime écrit déjà sans ce filtre. Un nom calculé (étalement, balise
 * dynamique) n'arrive jamais ici : il garde le filtre. */
export function safeAttrFlag(name: string): string {
  return name === 'class' || RISKY_ATTR.test(name.toLowerCase()) ? '' : ', 1'
}

export function decodeHtmlEntities(s: string, text = false): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*)(;?)/g, (match, body, pv, offset) => {
    if (body[0] !== '#' && !(pv && namedEntity(body) !== undefined)) {
      for (let n = Math.min(body.length, 6); n >= 2; n--) {
        if (!LEGACY_ENTITIES.has(body.slice(0, n))) continue
        const rest = n < body.length ? body[n] : pv || s[offset + match.length]
        if (!text && rest !== undefined && /[=a-zA-Z0-9]/.test(rest)) return match
        return namedEntity(body.slice(0, n)) + body.slice(n) + pv
      }
      return match
    }
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (Number.isNaN(code)) return match
      // hors plage Unicode (> U+10FFFF) : String.fromCodePoint lève un RangeError qui
      // plantait toute la compilation, sans composant ni ligne — le HTML remplace ces
      // entités par U+FFFD plutôt que de refuser le document, même remède ici.
      // `&#0;` et une demi-paire de substitution (U+D800 à U+DFFF) aussi, comme le parseur HTML
      if (code <= 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return String.fromCharCode(0xFFFD)
      if (code >= 0x80 && code <= 0x9F) return WINDOWS_1252[code - 0x80]
      return String.fromCodePoint(code)
    }
    const named = namedEntity(body)
    return named !== undefined ? named : match
  })
}

// identifiants LIBRES d'un code JS : noms lus ou écrits qui ne sont déclarés nulle part au-dessus
// d'eux (paramètres, `const`/`let`/`var`, fonctions, classes, `catch`, boucles), propriétés et
// étiquettes exclues. null quand le code ne se parse pas
export function freeIdentifiers(code: string): Set<string> | null {
  let ast: any
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
  }
  catch {
    return null
  }
  type Scope = { names: Set<string>, parent: Scope | null }
  const free = new Set<string>()
  const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
  const newScope = (parent: Scope | null): Scope => ({ names: new Set(), parent })
  const declare = (pattern: any, scope: Scope): void => {
    if (!pattern) return
    switch (pattern.type) {
      case 'Identifier': scope.names.add(pattern.name); break
      case 'ObjectPattern': for (const p of pattern.properties) declare(p.type === 'RestElement' ? p.argument : p.value, scope); break
      case 'ArrayPattern': for (const e of pattern.elements) declare(e, scope); break
      case 'AssignmentPattern': declare(pattern.left, scope); break
      case 'RestElement': declare(pattern.argument, scope); break
    }
  }
  const known = (name: string, scope: Scope | null): boolean => {
    for (let p = scope; p; p = p.parent) if (p.names.has(name)) return true
    return false
  }
  // déclarations d'un bloc : let/const, fonctions et classes (les `var` remontent à la fonction)
  const hoistBlock = (instructions: any[], scope: Scope): void => {
    for (const s of instructions) {
      if (s.type === 'VariableDeclaration' && s.kind !== 'var') for (const d of s.declarations) declare(d.id, scope)
      else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) scope.names.add(s.id.name)
    }
  }
  const hoistVar = (node: any, scope: Scope): void => {
    if (!node || typeof node.type !== 'string' || FUNCTIONS.has(node.type)) return
    if (node.type === 'VariableDeclaration' && node.kind === 'var') for (const d of node.declarations) declare(d.id, scope)
    for (const key of Object.keys(node)) {
      const v = node[key]
      if (Array.isArray(v)) for (const e of v) hoistVar(e, scope)
      else if (v && typeof v.type === 'string') hoistVar(v, scope)
    }
  }
  // un motif de déclaration ne lit que ses valeurs par défaut et ses clés calculées
  const pattern = (m: any, scope: Scope): void => {
    if (!m) return
    switch (m.type) {
      case 'ObjectPattern':
        for (const p of m.properties) {
          if (p.type === 'RestElement') { pattern(p.argument, scope); continue }
          if (p.computed) visit(p.key, scope)
          pattern(p.value, scope)
        }
        break
      case 'ArrayPattern': for (const e of m.elements) pattern(e, scope); break
      case 'AssignmentPattern': pattern(m.left, scope); visit(m.right, scope); break
      case 'RestElement': pattern(m.argument, scope); break
    }
  }
  const fn = (f: any, scope: Scope): void => {
    let p = scope
    if (f.type === 'FunctionExpression' && f.id) {
      p = newScope(scope)
      p.names.add(f.id.name)
    }
    const body = newScope(p)
    if (f.type !== 'ArrowFunctionExpression') body.names.add('arguments')
    for (const prm of f.params) declare(prm, body)
    for (const prm of f.params) pattern(prm, body)
    if (f.body.type === 'BlockStatement') {
      hoistBlock(f.body.body, body)
      hoistVar(f.body, body)
      for (const s of f.body.body) visit(s, body)
    }
    else visit(f.body, body)
  }
  const visit = (n: any, scope: Scope): void => {
    if (!n || typeof n.type !== 'string') return
    switch (n.type) {
      case 'Identifier':
        if (!known(n.name, scope)) free.add(n.name)
        return
      case 'Program': {
        const p = newScope(scope)
        hoistBlock(n.body, p)
        hoistVar(n, p)
        for (const s of n.body) visit(s, p)
        return
      }
      case 'BlockStatement':
      case 'StaticBlock': {
        const p = newScope(scope)
        hoistBlock(n.body, p)
        for (const s of n.body) visit(s, p)
        return
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        fn(n, scope)
        return
      case 'ClassDeclaration':
      case 'ClassExpression': {
        let p = scope
        if (n.type === 'ClassExpression' && n.id) {
          p = newScope(scope)
          p.names.add(n.id.name)
        }
        visit(n.superClass, p)
        for (const m of n.body.body) {
          if (m.type === 'StaticBlock') visit(m, p)
          else {
            if (m.computed) visit(m.key, p)
            visit(m.value, p)
          }
        }
        return
      }
      case 'VariableDeclaration':
        for (const d of n.declarations) {
          pattern(d.id, scope)
          visit(d.init, scope)
        }
        return
      case 'ForStatement': {
        const p = newScope(scope)
        if (n.init && n.init.type === 'VariableDeclaration') for (const d of n.init.declarations) declare(d.id, p)
        visit(n.init, p)
        visit(n.test, p)
        visit(n.update, p)
        visit(n.body, p)
        return
      }
      case 'ForInStatement':
      case 'ForOfStatement': {
        const p = newScope(scope)
        if (n.left.type === 'VariableDeclaration') for (const d of n.left.declarations) declare(d.id, p)
        visit(n.left, p)
        visit(n.right, p)
        visit(n.body, p)
        return
      }
      case 'CatchClause': {
        const p = newScope(scope)
        declare(n.param, p)
        pattern(n.param, p)
        visit(n.body, p)
        return
      }
      case 'SwitchStatement': {
        visit(n.discriminant, scope)
        const p = newScope(scope)
        for (const c of n.cases) hoistBlock(c.consequent, p)
        for (const c of n.cases) {
          visit(c.test, p)
          for (const s of c.consequent) visit(s, p)
        }
        return
      }
      case 'MemberExpression':
        visit(n.object, scope)
        if (n.computed) visit(n.property, scope)
        return
      case 'Property':
        if (n.computed) visit(n.key, scope)
        visit(n.value, scope)
        return
      case 'LabeledStatement':
        visit(n.body, scope)
        return
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
        return
    }
    for (const key of Object.keys(n)) {
      const v = n[key]
      if (Array.isArray(v)) for (const e of v) visit(e, scope)
      else if (v && typeof v.type === 'string') visit(v, scope)
    }
  }
  visit(ast, newScope(null))
  return free
}
