// utils — helpers cleanJs/cleanJsExpr, parseMixedString utilisés par le walker.
//
// `cleanJs(expr)` : un FRAGMENT du gabarit (corps de gestionnaire, liaison `!{…}`, attache, valeur d'un `{const}` relue par un
// gestionnaire, rappel de transition), rendu sans être compilé ici : du JavaScript lu par acorn (fragmentParLArbre), sinon le
// dialecte lu par l'arbre de Civet (gestionnaireDuDialecte) ; le code d'un gestionnaire est compilé plus loin, avec les autres
// (transpiler/index.ts).
//
// `cleanJsExpr(expr, externalVars, moduleName)` — pour les sites qui manipulent une VRAIE expression autonome (interpolation
// texte, valeur d'attribut, condition {if}/{elsif}/@class{}/@style{}/@flip{}, itérable {for}, expression {key}/{const}/{await}) :
// l'expression est lue par l'arbre (expressionDuGabarit) et compilée par Civet en SYNCHRONE (`compile(src, {js: true, sync:
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

import { RAW_ACCESS_BODY, RAW_ACCESS_PAREN_BODY, RAW_ACCESS_MALFORME_BODY, rawAccessFormeError, MU_REFRESH_PAREN_BODY, MU_REFRESH_BODY, MU_REFRESH_RESTE_BODY, MU_REFRESH_NUE_BODY, MU_REFRESH_OUT, MU_REFRESH_STORE_OUT, refreshFormeError, refreshNueError, RAW_WRITE_BODY, RAW_WRITE_PAREN_BODY, RAW_WRITE_PAREN_OUT_OPEN, RAW_WRITE_OLD_FORME_BODY, RAW_WRITE_OLD_FORME_PAREN_BODY, rawWriteAncienneFormeError, BARE_SECTION_BODY, bareSectionError, RAW_ACCESS_OUT, RAW_ACCESS_STORE_OUT, RAW_WRITE_OUT, RAW_WRITE_STORE_OUT, MU_LAYOUT_WRITE_BODY, MU_LAYOUT_PREFIX_WRITE_BODY, MU_HOOKS_BODY, MU_DERIVED_BODY, MU_EVERY_BODY, minuterieDuComposant, MU_INSPECT_ARG_BODY, MU_INSPECT_ARG_OUT, MU_RUNE_STORE_BODY, MU_MINMAX_RETIRE_BODY, cheminInspectPlat, vaultRemovedError, importedSingletonError, rewriteMuImport, rewriteMuToggle, ouvreUneRegex, regexEnArgument, scanRegexLiteral } from '../sigils.js'
import { skipQuotedSpan } from '../quoted-span.js'
import { maskInertSameLength, inertRanges, finValeurContexte, ecritureContexte, incrementContexteRe, rewriteIncrement, convertCoffeeInterpolations, codeDesInterpolations } from '../lexer/index.js'
import { createRequire } from 'node:module'
import * as acorn from 'acorn'
import { t } from '../messages/index.js'
import { minuteriesBrutes } from '../transpiler/minuteries.js'
import { parametreLuAutrement, ErreurParametreLuAutrement } from '../languages/civet-parametres.js'
import { entiteNommee } from './entites-html.js'
import { compteursCode } from '../reader/code.js'
import { DIRECTIVE_GESTIONNAIRE, GESTIONNAIRE_ILLISIBLE, REFUS_DU_GESTIONNAIRE, RUNES_A_FORME, compteursExpressions, deguiserExpression, enveloppe, expressionParLArbre, fragmentDuDialecte, fragmentParLArbre, lettreReserveeEcrite, refuserDeclaration, signesRepris } from '../reader/expression.js'

// regex globales des runes µ — bâties UNE fois sur les corps partagés
// (sigils.ts, source unique lexer↔cleanJs) ; seule la GARDE (lookbehind)
// reste locale à ce moteur
const RE_RAW_ACCESS_G = new RegExp(`(?<![\\w.])${RAW_ACCESS_BODY}`, 'g')
const RE_RAW_ACCESS_PAREN_G = new RegExp(`(?<![\\w.])${RAW_ACCESS_PAREN_BODY}`, 'g')
const RE_RAW_ACCESS_MALFORME_G = new RegExp(`(?<![\\w.])${RAW_ACCESS_MALFORME_BODY}`, 'g')
const RE_RAW_WRITE_G = new RegExp(`(?<![\\w.])${RAW_WRITE_BODY}`, 'g')
const RE_RAW_WRITE_PAREN_G = new RegExp(`(?<![\\w.])${RAW_WRITE_PAREN_BODY}`, 'g')
const RE_RAW_WRITE_OLD_FORME_G = new RegExp(`(?<![\\w.])${RAW_WRITE_OLD_FORME_BODY}`, 'g')
const RE_RAW_WRITE_OLD_FORME_PAREN_G = new RegExp(`(?<![\\w.])${RAW_WRITE_OLD_FORME_PAREN_BODY}`, 'g')
const RE_BARE_SECTION_G = new RegExp(`(?<![\\w.§])${BARE_SECTION_BODY}`, 'g')
const RE_MU_LAYOUT_WRITE_G = new RegExp(`(?<![\\w.µ])${MU_LAYOUT_WRITE_BODY}`, 'g')
const RE_MU_LAYOUT_PREFIX_WRITE_G = new RegExp(`(?<![\\w.µ])${MU_LAYOUT_PREFIX_WRITE_BODY}`, 'g')
const RE_MU_HOOKS_G   = new RegExp(`(?<![\\w.µ])${MU_HOOKS_BODY}`, 'g')
const RE_MU_HOOKS     = new RegExp(`(?<![\\w.µ])${MU_HOOKS_BODY}`)
const RE_MU_DERIVED_G = new RegExp(`(?<![\\w.µ])${MU_DERIVED_BODY}`, 'g')
const RE_MU_EVERY_G   = new RegExp(`(?<![\\w.µ])${MU_EVERY_BODY}`, 'g')
// remodelage d'arguments de µ.inspect — même corps que le script (aucune garde de tête
// supplémentaire : il cible la forme DÉJÀ pointée `µ.inspect`, avec ses propres gardes internes).
const RE_MU_INSPECT_ARG_G   = new RegExp(MU_INSPECT_ARG_BODY, 'g')
const RE_MU_REFRESH_PAREN_G = new RegExp(`(?<![\\w.])${MU_REFRESH_PAREN_BODY}`, 'g')
const RE_MU_REFRESH_G       = new RegExp(`(?<![\\w.])${MU_REFRESH_BODY}`, 'g')
const RE_MU_REFRESH_RESTE_G = new RegExp(`(?<![\\w.])${MU_REFRESH_RESTE_BODY}`, 'g')
const RE_MU_REFRESH_NUE     = new RegExp(`(?<![\\w.])${MU_REFRESH_NUE_BODY}`)
// `µrefresh` permis dans le code d'un gestionnaire d'événement seulement (cf. cleanJsGestionnaire) : ailleurs dans le gabarit, c'est le
// rendu qui l'évalue, et le redessin qu'il demande relancerait ce rendu — une boucle de rendu
let refreshPermis = false

// Applique `fn` uniquement aux segments de CODE (hors littéraux '…', "…", `…`).
// Les regex de sucre ne doivent JAMAIS réécrire le contenu des chaînes :
// avant, `'this is fine'` devenait `'this === fine'` et `' and yet '`
// → `' && yet '` (corruption silencieuse de tout texte anglais).
// `dialecte` : code Civet, où une regex se passe aussi sans parenthèses (`s.replace /"/g, 'R'`, regexEnArgument) — lue comme une
// division, son guillemet ouvrait une fausse chaîne, qui cachait la suite aux réécritures et la rendait à Civet coupée en deux
function mapCodeSegments(src: string, fn: (code: string) => string, dialecte = false): string {
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
          res += '${' + mapCodeSegments(inner, fn, dialecte) + '}'
          j = k + 1
        } else {
          res += src[j]
          j++
        }
      }
      if (j < n) res += '`'
      i = j + 1
      codeStart = i
    } else if (ch === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && (ouvreUneRegex(src.slice(0, i)) || (dialecte && regexEnArgument(src, i)))) {
      // littéral regex `/…/` : ZONE INERTE comme une chaîne — sans ce garde-fou, `/§/` levait la
      // garde « § nu » et `/µTotal/` sortait réécrit `/µ.Total/` EN PLEIN MILIEU du littéral.
      // `src[i + 1] !== '/'/'*'` écarte D'ABORD un commentaire (`//`/`/*`, jamais
      // masqués ICI — hors périmètre de ce correctif, cf. sansCommentaires) : un `/*…*/` pris pour
      // une regex s'arrêterait au premier `/` interne, pas à son vrai `*/`. `scanRegexLiteral`
      // rend -1 si aucun `/` fermant n'apparaît avant la fin de ligne (une division ne se referme
      // jamais) : ce `/` retombe alors sur le `i++` générique, code normal.
      const fin = scanRegexLiteral(src, i)
      if (fin === -1) { i++ }
      else { res += fn(src.slice(codeStart, i)); res += src.slice(i, fin); i = fin; codeStart = i }
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
// (finValeurContexte, lexer/index.ts, partagé avec le <script>) ; la suite se relit alors : elle peut
// porter un autre setter (`if $ok then §x = 1 else §x = 2`).
function rewriteMasked(raw: string, re: RegExp, build: (name: string, op: string | undefined, rhs: string) => string): string {
  const masked = maskInertSameLength(raw)
  let out    = ''
  let cursor = 0
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(masked)) !== null) {
    const idx = m.indices!
    const [start, end]       = idx[0]
    const [rhsStart, rhsEnd] = idx[3]
    let fin = end
    const coupe = rhsStart + finValeurContexte(masked.slice(rhsStart, rhsEnd), raw.slice(rhsStart, rhsEnd))
    if (coupe < rhsEnd) {
      fin = coupe
      while (fin > rhsStart && /\s/.test(raw[fin - 1])) fin--
      re.lastIndex = fin
    }
    out += raw.slice(cursor, start) + build(raw.slice(...idx[1]), m[2], raw.slice(rhsStart, fin))
    cursor = fin
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
// (ecritureContexte, rewriteIncrement, lexer/index.ts) — laissés au getter, ils donnaient
// `this._mjs_getContext('x') += 1`, que Civet refusait
function applyContextSetters(raw: string, _externalVars: string[]): string {
  const avecIncr = incrementsContexte(incrementsContexte(raw, '§§', '_mjs_setRCtx', '_mjs_getRCtx'), '§', '_mjs_setContext', '_mjs_getContext')
  const avecRCtx = rewriteMasked(avecIncr, /(?<![\w.§])§§([a-zA-Z_][a-zA-Z0-9_$]*)\s*(\*\*|\|\||&&|\?\?|>>>|<<|>>|[-+*/%|&^])?=(?!=|>)(.+?)(?=\n|;|$)/gd,
    (name, op, rhs) => ecritureContexte('this', '_mjs_setRCtx', '_mjs_getRCtx', name, op, rhs.trim()))
  return rewriteMasked(avecRCtx, /(?<![\w.§])§([a-zA-Z_]\w*)\s*(\*\*|\|\||&&|\?\?|>>>|<<|>>|[-+*/%|&^])?=(?!=|>)(.+?)(?=\n|;|$)/gd,
    (name, op, rhs) => ecritureContexte('this', '_mjs_setContext', '_mjs_getContext', name, op, rhs.trim()))
}

// `§x++`, `--§x`… cherchés sur la vue masquée (jamais dans une chaîne ni un commentaire), réécrits par la règle du
// <script> ; un incrément ne contient que des signes de code, le masquage (même longueur) laisse ses positions intactes
function incrementsContexte(raw: string, marque: string, appel: string, lecture: string): string {
  const masked = maskInertSameLength(raw)
  let out    = ''
  let cursor = 0
  for (const m of masked.matchAll(incrementContexteRe(marque))) {
    out += raw.slice(cursor, m.index) + rewriteIncrement(m[0], marque, appel, lecture, 'this')
    cursor = m.index! + m[0].length
  }
  return out + raw.slice(cursor)
}

// Passe GRAMMAIRE — idiomes Coffee/Civet (`->`, not/and/or, is/isnt), traduits par regex : sur un gestionnaire du dialecte après sa
// lecture par l'arbre (gestionnaireDuDialecte), et pour le test de forme formeDeJavaScript ; une expression est compilée par Civet
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
// ligne d'un corps de plusieurs lignes (cf. finitUneInstruction) : `$a = 1` suivi à la ligne de `$b = 2 unless $c` exécute toujours
// `$a = 1` (tout le corps passait sous la condition, ou Civet le compilait en gestionnaire vide). Un préfixe qui est une instruction
// (`return`, `break`, `continue`, `throw`) ne s'enveloppe pas : `(!(c) && (return))` est refusé par Civet et par CoffeeScript, qui
// lisent tous deux `return unless c` tel qu'écrit. Le `unless` réécrit : celui dont la condition va jusqu'à la fin du corps, ou celui
// qu'un `;` de sa ligne suit derrière un préfixe, sur toute ligne — Civet compile `x unless c; y` en JavaScript invalide
// (`x((!c?():void 0)); y`) ; un `unless` d'une ligne d'avant sans `;`, Civet et CoffeeScript le lisent bien. `script` : le corps d'un
// gestionnaire versé au script que Civet compile (cf. unlessSuivisDUnPointVirgule), seuls ces `;` comptent et aucune ligne n'est ajoutée
function rewriteUnless(raw: string, retraitDeTete = '', script = false): string {
  const vu      = maskInertSameLength(raw)
  const valeurs = vueDesValeurs(raw)
  for (const u of vu.matchAll(/(?<![\w.$])unless\s+/g)) {
    const finPre    = u.index
    const debutCond = finPre + 'unless'.length + /^\s*/.exec(raw.slice(finPre + 'unless'.length))![0].length
    const avant     = finsDInstruction(valeurs, 0, finPre, true)
    // `unless` dans une parenthèse ouverte (`f(a unless b)`) : rien n'est coupé
    const debut     = avant.profondeur === 0 ? debutDeLInstruction(valeurs, avant.points, finPre) : -1
    const fin       = avant.profondeur === 0 ? finsDInstruction(valeurs, debutCond, raw.length).points[0] ?? raw.length : raw.length
    const debutPre  = avant.profondeur === 0 ? flecheDeLaLigne(valeurs, debut + 1, finPre) : 0
    const pre       = raw.slice(debutPre, finPre).trim()
    const tete      = raw.slice(0, debutPre) + /^\s*/.exec(raw.slice(debutPre, finPre))![0]
    if ((script || !/^unless\s+.+$/.test(vu.slice(finPre))) && (fin === raw.length || valeurs.slice(debutCond, fin).includes('\n') || pre === '')) continue
    // une regex en tête de la condition passe entre crochets : Civet lit `(/a/.test(s))` comme la section d'opérateur `(/ a / …)`, une
    // flèche, et de même `(/a/i)` entre parenthèses (`a => a/a/i`) ; `[/a/i][0]` se lit pareil en Civet et en CoffeeScript (la fin de la
    // regex : le premier signe que la vue masquée garde après elle)
    const regex     = raw[debutCond] === '/' ? (/\S/.exec(vu.slice(debutCond, fin))?.index ?? fin - debutCond) : 0
    const cond      = regex > 0 ? `[${raw.slice(debutCond, debutCond + regex).trimEnd()}][0]${raw.slice(debutCond + regex, fin)}` : raw.slice(debutCond, fin)
    if (INSTRUCTION_DE_SAUT_RE.test(pre.slice(pre.lastIndexOf('\n') + 1).trim())) {
      // Civet lit `return unless c; y` comme `return (…); y` : la suite passe à la ligne, au retrait de la ligne de l'instruction ; dans le
      // corps d'une flèche écrite sur sa ligne, ce corps passe en bloc, un cran plus loin, la suite avec lui. Au script, sur la même
      // ligne : `if (!(c)) { return }; y` — `unless c then return 0; y` ne rendait plus `y`, dernière valeur d'une flèche (`$l.filter (z) ->
      // return false unless z > 1; z < 3` gardait `[]`)
      if (fin === raw.length) return raw
      if (script) return tete + `if (!(${cond.trim()})) { ${pre} }` + rewriteUnless(raw.slice(fin), '', true)
      const fleche  = debutPre > debut + 1
      const retrait = retraitDeLigne(raw, tete.length, retraitDeTete) + (fleche ? '  ' : '')
      return (fleche ? tete.trimEnd() + '\n' + retrait + raw.slice(tete.length, fin).trim() : raw.slice(0, fin).trimEnd()) + '\n' + retrait + rewriteUnless(raw.slice(fin + 1).trimStart(), retrait)
    }
    return tete + (pre ? `(!(${cond}) && (${pre}))` : `!(${cond})`) + (fin < raw.length ? rewriteUnless(raw.slice(fin), retraitDeLigne(raw, fin, retraitDeTete), script) : '')
  }
  return raw
}

// le corps d'un gestionnaire de <@window>, <@document> ou <@body>, versé au script que Civet compile : ses `x unless c; y`, que Civet
// compile en JavaScript invalide (« parse error » à la construction), sont réécrits sans changer de ligne (cf. rewriteUnless)
export function unlessSuivisDUnPointVirgule(corps: string): string {
  return rewriteUnless(corps, '', true)
}

// le début du corps de la dernière flèche (`->`, `=>`) écrite sur la ligne de `fin`, entre `debut` et `fin`, hors de toute parenthèse,
// crochet ou accolade ouverts depuis `debut` ; `debut` sans flèche. `unless` ne prend que ce corps, comme en Civet et en CoffeeScript :
// dans `$l.forEach (z) -> $d += z unless z == 2`, tout l'appel passait sous la condition, qui lisait `z` hors de la flèche. Une virgule à
// son niveau finit ce corps (`$l.reduce (s, z) -> s + z, 0`, l'argument suivant de l'appel), un `else` aussi quand aucun `then` du corps
// ne l'ouvre (`if $v then -> 1 else 2`) : `unless` prend alors toute l'instruction, comme Civet
function flecheDeLaLigne(valeurs: string, debut: number, fin: number): number {
  const ligne = valeurs.lastIndexOf('\n', fin - 1) + 1
  let corps   = debut
  let n       = 0
  let alors   = 0
  for (let k = debut; k < fin; k++) {
    const c = valeurs[k]
    if (c === '(' || c === '[' || c === '{') n++
    else if (c === ')' || c === ']' || c === '}') n--
    else if (n !== 0 || k < ligne) continue
    else if ((c === '-' || c === '=') && valeurs[k + 1] === '>' && valeurs[k - 1] !== '-' && valeurs[k - 1] !== '=') {
      corps = k + 2
      alors = 0
    }
    else if (corps === debut) continue
    else if (c === ',') corps = debut
    else if (/[\w$]/.test(valeurs[k - 1]) || !/^(?:then|else)(?![\w$])/.test(valeurs.slice(k, k + 5))) continue
    else if (c === 't') alors++
    else if (alors-- === 0) corps = debut
  }
  return corps
}

// le dernier des `points` (cf. finsDInstruction) où commence l'instruction qui finit en `fin` : le premier signe qui le suit est sur une
// ligne qu'aucune ligne de code d'après, jusqu'à `fin`, ne dépasse vers la gauche ; un point dans un bloc qu'une ligne moins en retrait
// continue (le corps du rappel de `.map (z) ->`, puis `.length unless c`) ne coupe pas, toute la chaîne est l'instruction ; -1 sans point
function debutDeLInstruction(valeurs: string, points: number[], fin: number): number {
  for (let i = points.length - 1; i >= 0; i--) {
    const debut   = points[i] + 1 + /^\s*/.exec(valeurs.slice(points[i] + 1, fin))![0].length
    const retrait = /^[ \t]*/.exec(valeurs.slice(valeurs.lastIndexOf('\n', debut - 1) + 1))![0].length
    if (valeurs.slice(debut, fin).split('\n').slice(1).every((l) => l.trim() === '' || /^[ \t]*/.exec(l)![0].length >= retrait)) return points[i]
  }
  return -1
}

// une instruction qui quitte le gestionnaire ou la boucle : jamais une expression
const INSTRUCTION_DE_SAUT_RE = /^(?:return|break|continue|throw)(?![\w$])/

// le retrait de la ligne qui porte l'indice `i` de `raw` ; `tete` pour sa première ligne, quand `raw` est la suite d'une ligne (`; …`)
function retraitDeLigne(raw: string, i: number, tete: string): string {
  const d = raw.lastIndexOf('\n', i - 1)
  return d < 0 ? tete : /^[ \t]*/.exec(raw.slice(d + 1))![0]
}

// les fins d'instruction hors de toute parenthèse, crochet ou accolade ouverts entre `debut` et `fin` (cf. vueDesValeurs) : les `;`, et
// avec `lignes` les sauts de ligne qui finissent une instruction (cf. finitUneInstruction) ; et la profondeur atteinte à `fin`
function finsDInstruction(valeurs: string, debut: number, fin: number, lignes = false): { points: number[]; profondeur: number } {
  const points: number[] = []
  let n = 0
  for (let k = debut; k < fin; k++) {
    const c = valeurs[k]
    if (c === '(' || c === '[' || c === '{') n++
    else if (c === ')' || c === ']' || c === '}') n--
    else if (n === 0 && (c === ';' || (lignes && c === '\n' && finitUneInstruction(valeurs, k)))) points.push(k)
  }
  return { points, profondeur: n }
}

// le code de `raw` à même longueur, pour lire où finit une instruction : un commentaire en espaces (sauts de ligne gardés), une chaîne,
// une regex ou un gabarit en `0` (une valeur), sauts de ligne compris — seuls les sauts de ligne du code et des commentaires restent
function vueDesValeurs(raw: string): string {
  let vue = ''
  let at  = 0
  for (const [debut, fin] of inertRanges(raw)) {
    const jeton = raw.slice(debut, fin)
    vue += raw.slice(at, debut) + (/^(?:#|\/[/*])/.test(jeton) ? jeton.replace(/[^\n]/g, ' ') : '0'.repeat(jeton.length))
    at   = fin
  }
  return vue + raw.slice(at)
}

// une ligne qui attend la suite : elle s'arrête sur un opérateur, une virgule ou un mot qui en attend une (jamais `x++`, une flèche, `a?`)
const LIGNE_OUVERTE_RE = /(?:(?<![+-])[+-]|[*/%=<&|^~,\\:]|(?<![-=])>|(?<![\w$])(?:and|or|not|is|isnt|in|of|instanceof|new|typeof|delete|void|await|yield|throw|extends))$/
// une ligne qui continue la précédente : un accès (`.length`, `?.x`, `::x`), une virgule, un opérateur binaire, la suite d'un `if`, d'un
// `try` ou d'un `switch` (`else`, `catch`, `when`…), une clé d'objet (l'appel sans parenthèses `e.push` puis `  id: 1`)
const LIGNE_SUITE_RE = /^(?:[.,*/%&|^=<>?:+-]|!=|(?:and|or|is|isnt|instanceof|in|of|then|else|catch|finally|when)(?![\w$])|[\w$]+[ \t]*:(?![:=]))/
// une ligne qui ouvre un bloc : les lignes en retrait qui la suivent sont son corps
const OUVRE_UN_BLOC_RE = /^(?:if|unless|for|while|until|loop|switch|try|catch|finally|else|when|do|class)(?![\w$])|(?:[-=]>|(?<![\w$])(?:then|else|do|try|finally))$/

// le saut de ligne en `k` (cf. vueDesValeurs) finit l'instruction de la ligne de code d'avant : elle n'attend pas de suite, et la ligne
// de code d'après ne la continue pas ; une ligne vide ou de commentaire ne compte pas
function finitUneInstruction(valeurs: string, k: number): boolean {
  const avant = valeurs.slice(0, k).trimEnd()
  const apres = valeurs.slice(k + 1).trimStart()
  return avant !== '' && apres !== '' && !LIGNE_OUVERTE_RE.test(avant) && !LIGNE_SUITE_RE.test(apres)
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
export function aligneSurLaPremiereLigne(corps: string): string {
  const k = corps.indexOf('\n')
  if (k < 0 || corps.slice(0, k).trim() === '') return corps
  const valeurs = vueDesValeurs(corps)
  // une première ligne qui finit son bloc sur elle-même (`if $c then $a = 1`, `while $n < 3 then $n++`) n'en ouvre pas, sauf si elle finit sur ce
  // qui en ouvre un (`… else`, une flèche) : la ligne d'après en était l'argument (`1(…)`) ou restait sous la condition, sans erreur
  const bloc    = OUVRE_UN_BLOC_RE.test(valeurs.slice(0, k).trim()) && (!/(?<![\w$])then[ \t]+\S/.test(valeurs.slice(0, k)) || /(?:[-=]>|(?<![\w$])(?:else|do|try|finally))$/.test(valeurs.slice(0, k).trim()))
  if (valeurs[k] !== '\n' || finsDInstruction(valeurs, 0, k).profondeur !== 0 || (!bloc && !finitUneInstruction(valeurs, k))) return corps
  // les lignes d'après, et le retrait de celles de code (ni commencées dans une chaîne ou un gabarit, ni de commentaire)
  const lignes = corps.slice(k + 1).split('\n')
  const debuts = [k + 1]
  for (const l of lignes.slice(0, -1)) debuts.push(debuts[debuts.length - 1] + l.length + 1)
  const codes  = lignes.map((l) => l.search(/\S/)).filter((q, i) => q >= 0 && valeurs[debuts[i] - 1] === '\n' && valeurs[debuts[i] + q] !== ' ')
  if (bloc && !(Math.min(...codes) < codes[0])) return corps
  const pas    = codes.length > 0 ? Math.min(...codes) - corps.search(/\S/) : 0
  if (pas <= 0) return corps
  return corps.slice(0, k + 1) + lignes.map((l, i) => valeurs[debuts[i] - 1] === '\n' ? l.slice(Math.min(pas, l.search(/\S|$/))) : l).join('\n')
}

// sansCommentaires — texte JETABLE (jamais émis) pour les GARDES qui REFUSENT une
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
function sansCommentaires(code: string): string {
  const lignes = code.split('\n')
  const out: string[] = []
  for (let i = 0; i < lignes.length; i++) {
    const nu = lignes[i].trimStart()
    if (nu.startsWith('//')) { out.push(''); continue }
    if (nu.startsWith('#') && !nu.startsWith('#{')) { out.push(''); continue }   // commentaire `#` d'un gestionnaire, jamais `#{…}` d'interpolation
    if (nu.startsWith('/*')) {
      // On cherche la FERMETURE avant d'effacer quoi que ce soit. Un drapeau « on est
      // dans un bloc » qui reste collé faute de `*/` effacerait tout le reste du segment
      // — garde aveugle sur des dizaines de lignes de vrai code. Sans fermeture, on ne
      // neutralise RIEN : un commentaire jamais fermé
      // est du code cassé de toute façon, et refuser est le bon côté de l'erreur.
      let j   = i
      let fin = lignes[i].indexOf('*/', lignes[i].indexOf('/*') + 2)
      while (fin < 0 && j + 1 < lignes.length) { j++; fin = lignes[j].indexOf('*/') }
      if (fin < 0) { out.push(lignes[i]); continue }
      for (let k = i; k < j; k++) out.push('')
      out.push(lignes[j].slice(fin + 2))
      i = j
      continue
    }
    out.push(lignes[i])
  }
  return out.join('\n')
}

// inspectArgHorsCommentaire — enveloppe MU_INSPECT_ARG_OUT (sigils.ts, corps PARTAGÉ avec le
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
function inspectArgHorsCommentaire(m: string, nomParen: string | undefined, cheminParen: string | undefined, nomNu: string | undefined, cheminNu: string | undefined, offset: number, chaine: string): string {
  const masque = maskInertSameLength(chaine)
  if (masque[offset] !== chaine[offset]) return m
  return MU_INSPECT_ARG_OUT(m, nomParen, cheminReel(cheminParen), nomNu, cheminReel(cheminNu))
}
// un « chemin » fait seulement de commentaires (`µinspect($x /* suivi */)`) n'en est pas un :
// rien n'y est exécuté, l'argument reste la variable entière
function cheminReel(chemin: string | undefined): string | undefined {
  return chemin && maskInertSameLength(chemin).trim() !== '' ? chemin : undefined
}

// reecritOuRejetteRuneChemin — µinspect(...) : un chemin/appel/indexation dont la
// clé est une chaîne littérale (`$x['a']`, `$x.foo('a')`) échappe encore à
// inspectArgHorsCommentaire plus haut : celui-ci tourne PAR SEGMENT
// (mapCodeSegments a déjà isolé la chaîne comme littéral INERTE avant d'appeler la passe des runes),
// coupant l'appel en morceaux disjoints (`µinspect($x[` / `'a'` / `])`) — aucun des deux ne
// correspond plus au corps ENTIER de MU_INSPECT_ARG_BODY (sigils.ts,
// gabarit LISTE BLANCHE argTermineOuChemin) : une forme INVALIDE ressortirait intacte, une forme
// VALIDE (chemin FIXE, cf. cheminInspectPlat) ne serait jamais réécrite. Scan donc AVANT ce
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
// runesAForme/inspectArgHorsCommentaire plus loin — ceux-ci ne revoient plus jamais un
// µinspect(...) à chemin, déjà tranché ici).
export function reecritOuRejetteRuneChemin(raw: string): string {
  const masque = maskInertSameLength(raw)
  // µminmax n'existe plus (V3) : la marche à suivre plutôt que `µ.minmax is not a function` au navigateur
  if (new RegExp(MU_MINMAX_RETIRE_BODY).test(masque)) throw new Error(t('transpiler.minmax-retire'))
  // un store (`$$x`) n'est pas l'état d'un composant : refus clair, jamais un appel à la valeur
  for (const m of masque.matchAll(new RegExp(MU_RUNE_STORE_BODY, 'g'))) {
    throw new Error(t('transpiler.rune-store', { rune: m[1], nom: m[2] }))
  }
  // positions relevées sur `raw` par les passes, appliquées ensuite en une seule fois : une
  // réécriture de l'une ne décale jamais les positions d'une autre
  const remplacements: Array<[number, number, string]> = []
  for (const m of masque.matchAll(new RegExp(MU_INSPECT_ARG_BODY, 'gd'))) {
    const idx    = m.indices!
    const nomIdx = (idx[1] ?? idx[3])!
    const chemin = cheminApresNom(raw, masque, nomIdx[1], idx[2] ?? idx[4])
    if (!chemin) continue
    const plat = cheminInspectPlat(chemin)
    if (plat === undefined) throw new Error(t('transpiler.rune-inspect-chemin', { nom: raw.slice(...nomIdx), chemin }))
    remplacements.push([idx[0][0], idx[0][1], `µ.inspect('${raw.slice(...nomIdx)}', '${plat}')`])
  }
  remplacements.sort((a, b) => a[0] - b[0])
  let out     = ''
  let curseur = 0
  for (const [debut, fin, texte] of remplacements) {
    out += raw.slice(curseur, debut) + texte
    curseur = fin
  }
  return out + raw.slice(curseur)
}
// chemin refusé derrière `$nom`, relu dans le texte RÉEL : celui capturé sur la vue masquée, ou
// sinon un gabarit collé au nom (`` $x`t` ``, appel étiqueté) que la vue masquée réduit à des
// espaces et fait passer pour un simple espacement
function cheminApresNom(raw: string, masque: string, finNom: number, cheminIdx: [number, number] | undefined): string {
  if (cheminIdx && cheminIdx[0] !== cheminIdx[1]) return raw.slice(...cheminIdx)
  let fin = finNom
  while (masque[fin] === ' ' || masque[fin] === '\t') fin++
  const entre = raw.slice(finNom, fin)
  return entre.includes('`') ? entre.trim() : ''
}

// `µpending` et `µsignal` d'un bloc `{await}` (cf. compileAwait) : vrais noms de la fonction de la branche et de la lecture de l'expression
// seulement pendant que le générateur compile ce bloc ; ailleurs ils restent des runes ordinaires (`µ.pending`, `µ.signal`)
export const runesAwait = { pending: false, signal: false }
const RE_MU_PENDING_G = /(?<![\w.µ$])µpending(?![\w$µ])/g
const RE_MU_PENDING   = /(?<![\w.µ$])µpending(?![\w$µ])/
// commentaires d'un morceau de code, ses chaînes déjà retirées (mapCodeSegments), lus de gauche à droite ; un commentaire non refermé court
// jusqu'au bout du morceau. Expression : `//` et `/* */` ; gestionnaire en grammaire civet : aussi `#` et `### ###`, que le lot des
// gestionnaires change en commentaires (applyCivetDialectSugar), sauf `#nom`
const COMMENTAIRES_EXPRESSION   = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g
const COMMENTAIRES_GESTIONNAIRE = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|###[\s\S]*?(?:###|$)|#(?![a-zA-Z_!])[^\n]*/g

// `µpending` écrit dans le code de `code`, là où les runes sont lues : hors des chaînes, le dedans d'un `${…}` et d'un `#{…}` compris
// (cleanJsExpr convertit ces interpolations d'abord) ; un texte cité dans une chaîne ne compte pas, ni un commentaire. Dans une
// expression Civet, `#` est du code (`this.length`). `gestionnaire` : le code d'un gestionnaire d'événement, que compile le lot des
// gestionnaires
export function litMuPending(code: string | null | undefined, gestionnaire = false): boolean {
  if (!code || !code.includes('µpending')) return false
  const commentaires = gestionnaire ? COMMENTAIRES_GESTIONNAIRE : COMMENTAIRES_EXPRESSION
  let lu = false
  mapCodeSegments(convertCoffeeInterpolations(code, undefined, true), (seg) => {
    if (RE_MU_PENDING.test(seg.replace(commentaires, ' '))) lu = true
    return seg
  })
  return lu
}

// `µpending` lu dans l'interpolation d'une chaîne double d'un gestionnaire (`"état #{µpending}"`), que Coffee interpole et que le lot Civet
// des gestionnaires convertit : le nom de la valeur de la branche, comme dans le code — cleanJs ne lit pas les chaînes. Le texte, une
// chaîne simple et une chaîne citée dans l'interpolation restent tels quels
export function pendingDesChaines(code: string): string {
  if (!runesAwait.pending || !code.includes('µpending')) return code
  const remplace = (interpolation: string): string => codeDesInterpolations(mapCodeSegments(interpolation, (seg) => seg.replace(RE_MU_PENDING_G, '_mjs_pnd')), remplace)
  return codeDesInterpolations(code, remplace)
}

// le code d'un gestionnaire d'événement passé par cleanJs : `µpending` n'y prend le nom de la valeur de la branche que si le gestionnaire
// le lit hors de ses commentaires (cf. litMuPending), et jusque dans l'interpolation d'une chaîne double (pendingDesChaines) ;
// `µrefresh` y est permis (refreshPermis). Une regex s'y passe aussi sans parenthèses (`$v.replace /"/g, 'R'`, regexEnArgument) :
// lue comme une division, son guillemet ouvrait une fausse chaîne qui cachait la suite (`$k = $k + 1`) aux réécritures
export function cleanJsGestionnaire(code: string, externalVars: string[], moduleName?: string, ecrit?: string): string {
  const pendingBranche = runesAwait.pending
  const refreshAvant   = refreshPermis
  runesAwait.pending &&= litMuPending(code, true)
  refreshPermis        = true
  try {
    // µevery / µafter d'un gestionnaire : le composant passe en tête de l'appel (sigils.ts), chaînes laissées intactes
    return cleanJs(pendingDesChaines(mapCodeSegments(code, minuterieDuComposant, true)), externalVars, true, moduleName, ecrit)
  }
  finally {
    runesAwait.pending = pendingBranche
    refreshPermis      = refreshAvant
  }
}

// les runes à forme d'un segment de code (refus des runes du script, `µread`, `µrefresh`, `µwrite` et leurs fautes de forme),
// avant les raccourcis : `µread $x` doit y rester entier
function runesAForme(seg: string, externalVars: string[]): string {
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
  // d'un gestionnaire sont déjà réécrits ici (cleanJsGestionnaire) : ce qui reste est refusé, testé HORS COMMENTAIRES
  // (cf. sansCommentaires), comme µderived.
  RE_MU_EVERY_G.lastIndex = 0
  if (RE_MU_EVERY_G.test(sansCommentaires(res))) throw new Error(t('generator.every-hors-script'))

  // hooks de cycle de vie (µmount & co) et µderived : réservés au <script> — dans une
  // interpolation ou un handler, erreur claire plutôt qu'un ReferenceError cryptique au
  // runtime. Testés ICI, HORS COMMENTAIRES et AVANT toute la chaîne de sucre (donc a
  // fortiori avant µ-short, cf. µurlChange ⊃ µurl) : posés en `.replace` levant au milieu
  // de la chaîne, ils faisaient échouer le build sur un `// hook : µmount -> foo`
  // simplement CITÉ — même trou que µevery, corrigé du même geste.
  RE_MU_HOOKS_G.lastIndex = 0
  const hookCite = RE_MU_HOOKS_G.exec(sansCommentaires(res))
  if (hookCite) throw new Error(t('generator.hook-cycle-vie-interpolation', { nom: hookCite[1] }))
  RE_MU_DERIVED_G.lastIndex = 0
  if (RE_MU_DERIVED_G.test(sansCommentaires(res))) throw new Error(t('generator.derived-hors-script'))
  RE_MU_LAYOUT_WRITE_G.lastIndex = 0
  RE_MU_LAYOUT_PREFIX_WRITE_G.lastIndex = 0
  if (RE_MU_LAYOUT_WRITE_G.test(sansCommentaires(res)) || RE_MU_LAYOUT_PREFIX_WRITE_G.test(sansCommentaires(res))) throw new Error(t('lexer.mu-layout-ecrit'))

  const rawAccessOut = (_m: string, dollar: string, name: string) =>
    (dollar ? RAW_ACCESS_STORE_OUT : RAW_ACCESS_OUT) + name
  res = res.replace(RE_RAW_ACCESS_PAREN_G, rawAccessOut).replace(RE_RAW_ACCESS_G, rawAccessOut)
  // µrefresh($x) / µrefresh $x → µ._mjs_refresh(_mjsThis, 'x'), µrefresh($$x) → µ._mjs_storeRefresh("x") (sigils.ts), AVANT les
  // règles `$x → $.x` et `$$x → µ.store.x` (un singleton importé écrit `$$X` y est refusé de même), dans un gestionnaire
  // d'événement seulement (refreshPermis) ; ce qui reste est refusé
  RE_MU_REFRESH_RESTE_G.lastIndex = 0
  if (!refreshPermis && RE_MU_REFRESH_RESTE_G.test(sansCommentaires(res))) throw new Error(t('generator.refresh-hors-gestionnaire'))
  const refreshOut = (_m: string, dollar: string, nom: string) => {
    if (dollar && externalVars.includes(`$${nom}`)) throw importedSingletonError(nom)
    return dollar ? MU_REFRESH_STORE_OUT(nom) : MU_REFRESH_OUT(nom)
  }
  res = res.replace(RE_MU_REFRESH_PAREN_G, refreshOut).replace(RE_MU_REFRESH_G, refreshOut)
  const nue = RE_MU_REFRESH_NUE.exec(sansCommentaires(res))
  if (nue) throw refreshNueError(nue[1] + nue[2])
  RE_MU_REFRESH_RESTE_G.lastIndex = 0
  if (RE_MU_REFRESH_RESTE_G.test(sansCommentaires(res))) throw refreshFormeError()

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
  RE_RAW_WRITE_OLD_FORME_PAREN_G.lastIndex = 0
  RE_RAW_WRITE_OLD_FORME_G.lastIndex = 0
  if (RE_RAW_WRITE_OLD_FORME_PAREN_G.test(sansCommentaires(res)) || RE_RAW_WRITE_OLD_FORME_G.test(sansCommentaires(res))) throw rawWriteAncienneFormeError()

  RE_RAW_ACCESS_MALFORME_G.lastIndex = 0
  if (RE_RAW_ACCESS_MALFORME_G.test(sansCommentaires(res))) throw rawAccessFormeError()
  return res
}

// cleanJs : un fragment du gabarit (corps de gestionnaire, liaison `!{…}`, attache, valeur d'un `{const}` relue par un gestionnaire,
// rappel de transition) : du JavaScript, lu par acorn, ses raccourcis réécrits sur son arbre (fragmentParLArbre) ; sinon du dialecte
// (Civet : `@x`, `->`, `not`, `is`, appel sans parenthèses, rune à forme), lu par l'arbre de Civet (gestionnaireDuDialecte). Une
// expression autonome passe par `cleanJsExpr`. `dialecte` : le code d'un gestionnaire, que compile le lot des gestionnaires (une barre
// après un nom et une espace y ouvre une regex passée en argument, cf. fragmentParLArbre) ; `moduleName` : le composant, cité par un
// refus ; `ecrit` : le gestionnaire tel qu'écrit dans le fichier, retrait compris, quand c'est lui que l'on compile : une vraie faute
// de syntaxe y est dite et située
export function cleanJs(expr: string | null | undefined, externalVars: string[] = [], dialecte = false, moduleName?: string, ecrit?: string): string {
  const texte    = (expr ?? '').toString().trim()
  const parArbre = fragmentParLArbre(texte, externalVars, runesAwait, dialecte)
  if (parArbre !== null) return parArbre
  return gestionnaireDuDialecte(texte, externalVars, moduleName, ecrit)
}

// les runes à forme d'une expression (`µtoggle`, `µinspect` et son chemin, `µread`, `µwrite`, `µrefresh`, refus des runes du
// script, hooks de cycle de vie compris), réécrites dans le texte écrit par les passes de l'ancienne lecture (cleanJs), dans le même ordre : leur forme dépend du
// texte qui les suit (`µread $x + 1` lit `$x` seul), pas de l'arbre ; l'arbre lit ensuite le reste (`µimport`, passe finale,
// est réécrit après lui) ; `apres` : passe de chaque segment de code, après ses runes (refus des signes d'un gestionnaire)
function runesAFormeEcrites(expr: string, externalVars: string[], apres: (seg: string) => string = (seg) => seg): string {
  const raw = rewriteMuToggle(expr, 'interpolation {…}/handler')
  const pre = reecritOuRejetteRuneChemin(applyContextSetters(raw, externalVars))
  return mapCodeSegments(pre, (seg) => apres(runesAForme(seg, externalVars).replace(RE_MU_INSPECT_ARG_G, inspectArgHorsCommentaire)), true)
}

// un fragment du dialecte qu'acorn ne lit pas, gestionnaire ou autre (Civet, CoffeeScript : `@x`, `->`, `not`, appel sans parenthèses, commentaire `#`,
// regex étendue, rune à forme, raccourci), lu par l'arbre de bout en bout, dans l'ordre de l'ancienne lecture : (a) ses refus d'abord
// (rune en clé, lettre réservée écrite, puis segment de code après segment de code : runes à forme, puis signes, refusDesSignes) ;
// (b) runes à forme et écritures de contexte réécrites dans le texte écrit, `unless` comme l'ancienne lecture ; (c) ses noms lus par
// Civet et sa carte (fragmentDuDialecte), la grammaire `->`, `not`, `is` ensuite, qui ne touche à aucun nom, µimport en dernier ; un
// nom que le gabarit ne lit pas est refusé à la place du gestionnaire (refusSitue) ; (d) un texte que Civet ne lit pas est une vraie
// faute, dite sur le texte écrit (fauteDuGestionnaire) et levée avec le texte rendu (`texteRendu`) : le générateur garde l'une et
// l'autre, le transpileur la dit après les refus qui la précèdent (nom seul). Sans texte écrit (code que la construction fabrique,
// rappel de transition), le texte est rendu tel quel : sa compilation dit la faute, à la place de l'attribut
function gestionnaireDuDialecte(texte: string, externalVars: string[], moduleName: string | undefined, ecrit: string | undefined): string {
  const code  = maskInertSameLength(texte)
  const refus = RUNE_EN_CLE_RE.test(code) ? t('reader.expression-rune-en-cle') : lettreReserveeEcrite(texte) ? t('reader.expression-lettre-reservee-ecrite') : null
  if (refus !== null) throw refusSitue(refus, texte, moduleName)
  // µlayout écrit (`µlayout ?= v`, `µlayout++`, `++µlayout`), lu dans le code seul : son refus précis passe avant les runes à forme et
  // l'arbre, qui n'y verrait qu'une écriture de contexte
  if (code.search(RE_MU_LAYOUT_WRITE_G) >= 0 || code.search(RE_MU_LAYOUT_PREFIX_WRITE_G) >= 0) throw new Error(t('lexer.mu-layout-ecrit'))
  const signes  = (seg: string): string => refusDesSignes(seg, externalVars)
  const runes   = RUNES_A_FORME.test(texte) || RE_MU_HOOKS.test(texte) || texte.includes('§') ? runesAFormeEcrites(texte, externalVars, signes) : null
  if (runes === null) mapCodeSegments(texte, signes, true)
  const lisible = rewriteUnless(runes ?? texte)
  let lu: string | null
  try {
    lu = fragmentDuDialecte(lisible, externalVars, runesAwait)
  }
  catch (err: any) {
    // `µ$x`, l'état universel, n'est lu que dans le <script> : refusé comme dans une expression, à la place du gestionnaire
    if (err?.etatUniversel === undefined) throw err
    throw Object.assign(new Error(t('reader.expression-etat-universel', { nom: err.etatUniversel, place: placeDuRefus(moduleName) })), { expressionEcrite: texte, expressionCompilee: `(${texte})` })
  }
  if (lu !== null) return rewriteMuImport(mapCodeSegments(lu, applyGrammarRegex, true), 'interpolation {…}/handler', true)
  const raison = REFUS_DU_GESTIONNAIRE.get(compteursExpressions.derniere)
  if (raison !== undefined) throw refusSitue(t(raison), texte, moduleName)
  const faute = ecrit !== undefined && compteursExpressions.derniere === GESTIONNAIRE_ILLISIBLE ? fauteDuGestionnaire(texte, moduleName, ecrit) : null
  if (faute !== null) throw Object.assign(faute, { texteRendu: lisible })
  return lisible
}

// les refus de signes de l'ancienne lecture sur un segment de code d'un gestionnaire, dans son ordre et
// sans rien réécrire : `&$x` (coffre retiré), `µ$$X` sans import, `$$X` d'un singleton importé, `$x := v`, `§` ou `§§` sans nom
function refusDesSignes(seg: string, externalVars: string[]): string {
  const coffre = /(?<![\w.])&\$([a-zA-Z_][a-zA-Z0-9_$]*)/.exec(seg)
  if (coffre) throw vaultRemovedError(coffre[1])
  // un `µ$$X` importé se lit `$X`, qui n'est plus un `$$X`
  const lu = seg.replace(/µ\$\$([a-zA-Z0-9_]+)/g, (_m: string, nom: string) => {
    if (externalVars.includes(`$${nom}`)) return `$${nom}`
    throw new Error(t('transpiler.singleton-sans-import', { nom }))
  })
  for (const m of lu.matchAll(/(?<!\w|(?<!\.)\.)\$\$([a-zA-Z_][a-zA-Z0-9_$]*)/g)) {
    if (externalVars.includes(`$${m[1]}`)) throw importedSingletonError(m[1])
  }
  refuserDeclaration(lu, externalVars)
  RE_BARE_SECTION_G.lastIndex = 0
  const seul = RE_BARE_SECTION_G.exec(sansCommentaires(lu))
  if (seul) throw bareSectionError(seul[0])
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
function compileGrammarViaCivet(symbolsCleaned: string, rawExprForError: string, moduleName: string | undefined): string {
  const trimmed = symbolsCleaned.trim()
  if (trimmed === '') return trimmed

  const normalized = isntNormalise(trimmed)

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
    compiled = civetDeLExpression(normalized, moduleName)
    _civetCompileMisses += 1
  } catch (err: any) {
    throw erreurDeCivet(err, trimmed, normalized, rawExprForError, moduleName)
  }

  const result = finirExpressionCivet(compiled, rawExprForError, moduleName)
  civetExprCache.set(normalized, result)
  return result
}

// `isnt` (Coffee) → `is not` : Civet ne le connaît pas — il parse `a isnt b` en
// appel `a(isnt(b))`, miscompile silencieux. même
// remède que la Pass 2b des <script> (transpiler/index.ts:866), hors chaînes/
// commentaires (mapCodeSegments), regex prudente calquée sur applyGrammarRegex
// (`.isnt` propriété intact)
function isntNormalise(texte: string): string {
  return mapCodeSegments(texte, (seg) => seg.replace(/(?<![\w.\$])\bisnt\b(?!\s*[:)\]},;])/g, 'is not'), true)
}

// DRIFT SÉMANTIQUE ASSUMÉ — `coffeeEq: true` fait compiler `==`/`!=` en `===`/`!==`,
// comme la convention stricte des `<script>` Civet du projet (cf. compileGrammarViaCivet)
function civetDeLExpression(normalized: string, moduleName: string | undefined): string {
  return getCivetCompile()(enveloppe(normalized), {
    js: true,
    sync: true,
    filename: moduleName ? `${moduleName}.expr` : 'mjs-expr',
    parseOptions: { coffeeEq: true },
  })
}

// Erreur orientante — calque le try/catch des handlers inline
// (transpiler/index.ts:1538+, zone déjà livrée hors-périmètre de cette
// brique) : même indice ternaire collé (`a?b:c`), même filler non-blanc.
function erreurDeCivet(err: any, trimmed: string, normalized: string, rawExprForError: string, moduleName: string | undefined): Error {
  const civetMsg = err?.message ?? String(err)
  const codeOnly = trimmed.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => 'x'.repeat(m.length))
  const gluedTernaryHint = /\?[^\s?.:]/.test(codeOnly)
    ? t('generator.hint-ternaire-colle')
    : ''
  const moduleHint = moduleName ? t('generator.hint-dans-module', { moduleName }) : ''
  // le texte écrit et celui donné à Civet : le transpileur ramène la position de Civet au fichier où l'expression est écrite
  return Object.assign(new Error(t('generator.interpolation-echec-civet', { moduleHint, rawExprForError, civetMsg, gluedTernaryHint })), { expressionEcrite: rawExprForError, expressionCompilee: enveloppe(normalized) })
}

// une expression que l'arbre ne lit pas : illisible, le message de Civet sur le texte écrit (sa ligne, sa colonne), ses signes
// déguisés le temps de la compilation (Civet ne lit pas `§`, même longueur) ; lisible, un refus de construction avec la raison
// de l'arbre, plutôt qu'une sortie fausse
function expressionNonLue(texte: string, rawExprForError: string, moduleName: string | undefined): Error {
  const normalized = isntNormalise(texte)
  try {
    civetDeLExpression(isntNormalise(deguiserExpression(texte)), moduleName)
  }
  catch (err: any) {
    return erreurDeCivet({ message: signesRepris(String(err?.message ?? err)) }, texte, normalized, rawExprForError, moduleName)
  }
  return refusSitue(compteursExpressions.derniere, rawExprForError, moduleName)
}

// refus d'une expression lisible, situé comme une faute de Civet : le repère `module.expr:1:2` (début de l'expression, après la
// parenthèse ouvrante) devient le fichier, la ligne et la colonne où elle est écrite (situerExpression, transpileur)
function refusSitue(raison: string, rawExprForError: string, moduleName: string | undefined): Error {
  const moduleHint = moduleName ? t('generator.hint-dans-module', { moduleName }) : ''
  return Object.assign(new Error(t('generator.expression-non-lue', { moduleHint, rawExprForError, raison, place: placeDuRefus(moduleName) })), { expressionEcrite: rawExprForError, expressionCompilee: `(${rawExprForError})` })
}

function placeDuRefus(moduleName: string | undefined): string {
  return moduleName ? `${moduleName}.expr:1:2 — ` : ''
}

// une vraie faute de syntaxe dans un gestionnaire du dialecte (`$x = not`) : l'erreur de Civet sur le texte écrit, lu dans la
// grammaire du lot des gestionnaires, ses signes déguisés le temps de la compilation (même longueur), située comme celle d'une
// expression (fichier, ligne, colonne : situerExpression, transpileur, sur le texte `ecrit` dans le fichier, retrait compris) avec le
// nom du composant ; null quand Civet lit ce texte
function fauteDuGestionnaire(texte: string, moduleName: string | undefined, ecrit: string): Error | null {
  const nom = moduleName ? `${moduleName}.expr` : 'mjs-expr'
  try {
    getCivetCompile()(DIRECTIVE_GESTIONNAIRE + deguiserExpression(texte), { js: true, sync: true, filename: nom })
    return null
  }
  catch (err: any) {
    // la directive occupe la ligne 1 ; sur la première ligne écrite, la colonne compte la parenthèse que situerExpression suppose devant
    const position = new RegExp(`${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)`)
    const civetMsg = signesRepris(String(err?.message ?? err)).replace(position, (_m: string, l: string, c: string) => `${nom}:${Number(l) - 1}:${Number(l) === 2 ? Number(c) + 1 : Number(c)}`)
    const codeOnly = texte.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => 'x'.repeat(m.length))
    const gluedTernaryHint = /\?[^\s?.:]/.test(codeOnly) ? t('generator.hint-ternaire-colle') : ''
    return Object.assign(new Error(t('transpiler.handler-inline-echec-civet', { moduleName: moduleName ?? '', lineHint: '', civetMsg, gluedTernaryHint })), { expressionEcrite: ecrit, expressionCompilee: `(${texte})` })
  }
}

// la sortie de Civet d'une expression, lue par l'arbre, rendue au générateur
function finirExpressionCivet(compiled: string, rawExprForError: string, moduleName: string | undefined): string {
  // paramètre que Civet lit autrement (`{$l.map((x, readonly) -> x)}`) : même refus que dans le <script> ; la ligne du
  // fichier est cherchée par le transpileur, au texte écrit de l'expression (avecLigneDuGabarit)
  const fautif = parametreLuAutrement(compiled, () => null)
  if (fautif) {
    const erreur      = new ErreurParametreLuAutrement(fautif, moduleName ? `${moduleName}.mjs` : 'mjs-expr', compiled, null, null)
    erreur.expression = rawExprForError
    throw erreur
  }

  // Retire le `;`/saut de ligne final éventuel PUIS la parenthèse enveloppante
  // qu'on vient d'ajouter — sortie = expression JS nue, drop-in de cleanJs.
  const out = compiled.replace(/;\s*$/, '').trim()
  return out.includes(';') && !estUneExpression(out) ? fonctionAppeleeSurPlace(out) : stripOuterParens(out)
}

// Civet déclare devant l'expression ce qu'elle emprunte : une aide (`[1..200]` → `var range = …`, `a %% b` → `var modulo = …`),
// une variable (`0 < $x < 5` → `let ref;`), la boucle d'une compréhension écrite seule (`(e for e of $l)` → `const results=[];for …`).
// Ces instructions et l'expression partent ensemble dans une fléchée appelée sur place, qui rend la valeur (`this` inchangé) ;
// avec un `await` hors des fonctions écrites, la fléchée est async, attendue à la place de l'expression
function fonctionAppeleeSurPlace(out: string): string {
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
  const expr  = stripOuterParens(out.slice(last.expression.start, last.expression.end))
  const corps = `{ ${out.slice(0, last.start).trim()} return (${expr}); }`
  return attendAuPremierNiveau(out) ? `(await (async () => ${corps})())` : `(() => ${corps})()`
}

// un `await` (ou `for await`) au premier niveau du code, hors des fonctions qu'il écrit (rappel d'un gestionnaire, instructions
// d'une expression)
export function attendAuPremierNiveau(js: string): boolean {
  if (!/\bawait\b/.test(js)) return false
  let arbre: any
  try {
    arbre = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })
  }
  catch {
    return false
  }
  const visite = (n: any): boolean => !/Function/.test(n.type) && (n.type === 'AwaitExpression' || (n.type === 'ForOfStatement' && n.await) || Object.values(n).some((v: any) => (Array.isArray(v) ? v : [v]).some((c: any) => c && typeof c.type === 'string' && visite(c))))
  return visite(arbre)
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
const FLECHE_ACCOLADE_RE = /^\s*(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)?\s*=>\s*\{/
const FLECHE_OBJET_RE    = /^\(*\s*(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)?\s*=>\s*\(\s*\{/
const MOT_DE_CONTROLE_RE = /\s*(?:if|unless|while|until|for|switch|try|do|loop|with)(?![\w$])/y
export function corpsDeFlecheEnBloc(js: string): string {
  const tete = FLECHE_ACCOLADE_RE.exec(js)
  if (!tete) return js
  const fin = js.trimEnd().length - 1
  if (js[fin] !== '}') return js
  // l'accolade finale doit refermer celle de la flèche (chaînes et commentaires masqués) ; au premier niveau du corps (accolades
  // de la flèche, hors parenthèses et crochets), le mot qui commence chaque instruction
  const masque = maskInertSameLength(js)
  let profondeur = 0
  let groupes    = 0
  let controle   = false
  for (let i = tete[0].length - 1; i <= fin; i++) {
    const c = masque[i]
    if (c === '(' || c === '[') groupes++
    else if (c === ')' || c === ']') groupes--
    else if (c === '{') profondeur++
    else if (c === '}') {
      profondeur--
      if (profondeur === 0 && i < fin) return js
    }
    if (profondeur === 1 && groupes === 0 && (c === '{' || c === '\n' || c === ';') && !controle) {
      MOT_DE_CONTROLE_RE.lastIndex = i + 1
      controle = MOT_DE_CONTROLE_RE.test(masque)
    }
  }
  if (profondeur !== 0 || !controle) return js
  let lu: string
  try {
    lu = getCivetCompile()(`(${js})`, { js: true, sync: true, parseOptions: { coffeeEq: true } })
  }
  catch {
    return js
  }
  if (!FLECHE_OBJET_RE.test(lu.trim())) return js
  // `;` collé à la dernière instruction (sur sa propre ligne, il casserait l'indentation lue par Civet), lue sur le masque : un
  // commentaire final l'aurait avalé
  let k = fin - 1
  while (/\s/.test(masque[k])) k--
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
  const js           = expressionDuGabarit(interpolated, raw, externalVars, moduleName)
  refuserMinuterieDuGabarit(js)
  return js
}

// un texte du gabarit passé par le lexeur (`$x` écrit `$.x`) a-t-il la forme d'un JavaScript, sa grammaire du dialecte réécrite
// (`is`, `not`, `and`, `or`, `->`, `unless`) et les signes de MJS (`@x`, `§x`, `@@x`, `&id`) pris pour des lettres d'un nom ? Un test
// de forme seul, sans Civet, qui lit presque tout (`pill p_{$x}` y devient un appel, dont l'effet se perd)
export function formeDeJavaScript(tokenise: string): boolean {
  const texte = deguiserExpression(mapCodeSegments(rewriteUnless(tokenise), applyGrammarRegex)).replace(/@/g, 'µ')
  try {
    acorn.parse(texte, { ecmaVersion: 'latest', sourceType: 'module' })
    return true
  }
  catch {
    return false
  }
}

function estUneExpression(js: string): boolean {
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
export function jsDesDependances(tokenise: string, morceaux: string[], externalVars: string[], moduleName?: string): string | null {
  return fragmentParLArbre(tokenise.trim(), externalVars, runesAwait) ?? codeEmisDesDependances(morceaux, externalVars, moduleName)
}

// le code que des expressions écrites émettent, en éléments d'un tableau à analyser (cf. jsDesDependances) ; null quand l'une ne se
// compile pas
export function codeEmisDesDependances(morceaux: string[], externalVars: string[], moduleName?: string): string | null {
  const blocs: string[]    = []
  const elements: string[] = []
  try {
    for (const morceau of morceaux) {
      const emis   = cleanJsExpr(morceau, externalVars, moduleName)
      // `µinspect` (rune de la console) lit l'état par son nom : il ne fait pas de dépendance, comme avant
      const js     = emis
      if (estUneExpression(js)) elements.push(js)
      else blocs.push(`{ ${js}\n}`)
    }
  }
  catch {
    return null
  }
  return `${blocs.join('\n')}${blocs.length > 0 ? '\n' : ''}[${elements.join(', ')}]`
}

// le JavaScript d'une condition du gabarit (`@class{$x is item}`), où chercher un motif filtré (attributes/index.ts) : du JavaScript,
// lu par acorn ; sinon le code qu'elle émet (cleanJsExpr) ; null quand elle ne se compile pas (pas de motif filtré, la liaison
// ordinaire la compile et dit sa faute)
export function jsDeLaCondition(texte: string, externalVars: string[], moduleName?: string): string | null {
  const parArbre = fragmentParLArbre(texte.trim(), externalVars, runesAwait)
  if (parArbre !== null) return parArbre.trim()
  try {
    return cleanJsExpr(texte, externalVars, moduleName).trim()
  }
  catch {
    return null
  }
}

const RUNE_EN_CLE_RE = /(?:^|[{,])\s*µ[\w$]+\s*:(?!:)/

// une expression lue par l'arbre (reader/expression.ts : une compilation Civet du texte écrit, raccourcis réécrits sur
// l'arbre ESTree) ; ses compilations Civet sont comptées avec les autres (_civetExprCacheMisses). Le texte que l'arbre a
// réécrit à la place des noms (`reecrit` : comparaison chaînée, nom en clé ou en paramètre, rune à forme, faute de Civet)
// est compilé comme celui de l'ancienne lecture, même sortie, même message ; une expression qu'il ne lit pas est refusée
function expressionDuGabarit(interpolated: string, raw: string, externalVars: string[], moduleName: string | undefined): string {
  // une rune en clé d'objet (`{µread: 1}`) : la passe des runes la réécrirait en appel, Civet n'en dirait qu'une faute obscure
  if (RUNE_EN_CLE_RE.test(maskInertSameLength(interpolated))) throw refusSitue(t('reader.expression-rune-en-cle'), raw, moduleName)
  const avant = compteursCode.compilations
  const runes = RUNES_A_FORME.test(interpolated) || RE_MU_HOOKS.test(interpolated) ? runesAFormeEcrites(interpolated.trim(), externalVars) : null
  let lu: ReturnType<typeof expressionParLArbre>
  try {
    lu = expressionParLArbre(runes ?? interpolated.trim(), externalVars, runesAwait, runes !== null)
  }
  catch (err: any) {
    if (err?.etatUniversel === undefined) throw err
    throw Object.assign(new Error(t('reader.expression-etat-universel', { nom: err.etatUniversel, place: placeDuRefus(moduleName) })), { expressionEcrite: raw, expressionCompilee: `(${raw})` })
  }
  _civetCompileMisses += compteursCode.compilations - avant
  if (typeof lu === 'string') return finirExpressionCivet(lu, raw, moduleName)
  if (lu !== null) return compileGrammarViaCivet(runes === null ? lu.reecrit : rewriteMuImport(lu.reecrit, 'interpolation {…}/handler', true), raw, moduleName)
  throw expressionNonLue(interpolated.trim(), raw, moduleName)
}

// noms que le composant déclare hors de l'accolade (racine du <script>, <script module>, `@import`), posés par le
// transpileur le temps de compiler son gabarit : une accolade qui appelle le `setTimeout` du composant n'appelle pas la
// minuterie globale
let nomsDuComposant: string[] = []

// noms que le gabarit met en portée à l'endroit compilé (variable et index des `{for}` englobants, valeur d'une branche
// `{success}` / `{error}`, `{const}` du bloc), posés par le parcours du gabarit (walk, generator/compile.ts) :
// `{for top in $l}` puis `{top.setTimeout()}` lit la variable de la boucle, pas l'objet global ; hors du bloc, le nom
// redevient global
let locauxDuGabarit: Set<string> | null = null

/** pose les noms du gabarit en portée du nœud parcouru ; rend ceux d'avant, reposés en sortant du nœud */
export function poserLocauxDuGabarit(noms: Set<string> | null): Set<string> | null {
  const avant     = locauxDuGabarit
  locauxDuGabarit = noms
  return avant
}

export function avecNomsDuComposant<T>(noms: string[], construire: () => T): T {
  const avant     = nomsDuComposant
  nomsDuComposant = noms
  try {
    return construire()
  }
  finally {
    nomsDuComposant = avant
  }
}

// setTimeout / setInterval dans une accolade du gabarit (interpolation, attribut lié, condition, `@attach`) : recalculée
// à chaque rendu ou rejouée à chaque pose de la balise, elle poserait une minuterie à chaque passage, que rien n'arrête —
// refusée comme dans le <script>, par la même lecture (transpiler/minuteries.ts), avec les noms du composant et ceux que
// le gabarit met en portée. Relue seulement si son texte nomme l'une des deux, ou lit un membre par une chaîne ET nomme
// l'objet global ou le document qui y mène (`window['set' + 'Timeout']`, `document['default' + 'View']['set' + 'Timeout']`, le
// `ownerDocument` d'un nœud : seules formes qui l'assemblent, `defaultView` n'y est jamais écrit d'un tenant) : `{$t['cle']}`,
// courant, n'est pas relue ; illisible par acorn (aucune des trois formes), refusée dès que son texte, chaînes ôtées, nomme l'une
// des deux
const MINUTERIE_RE     = /set(?:Timeout|Interval)/
const MEMBRE_CHAINE_RE = /\[[^\]]*['"`]/
const OBJET_GLOBAL_RE  = /\b(?:window|globalThis|self|top|parent|frames|defaultView|document|ownerDocument)\b/
export function refuserMinuterieDuGabarit(js: string): void {
  if (!MINUTERIE_RE.test(js) && !(MEMBRE_CHAINE_RE.test(js) && OBJET_GLOBAL_RE.test(js))) return
  const corps = js.replace(/;\s*$/, '')
  let ast: any = null
  for (const source of [js, '(' + corps + '\n)', '[' + corps + '\n]']) {
    try { ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); break }
    catch { ast = null }
  }
  const libres = locauxDuGabarit ? [...nomsDuComposant, ...locauxDuGabarit] : nomsDuComposant
  const nom    = ast ? minuteriesBrutes(ast, libres)[0]?.nom : js.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''").match(/\bset(?:Timeout|Interval)\b/)?.[0]
  if (nom) throw new Error(t('generator.minuterie-gabarit', { nom }))
}

// setTimeout / setInterval dans un rappel de transition (`@introend={…}`, sa fonction entière), avec les noms du composant et ceux que
// le gabarit met en portée : le nom de la première, refusée comme dans un gestionnaire (cf. fonctionDeRappel) ; null sans minuterie
export function minuterieDuRappel(fonction: string, locaux: Iterable<string>): string | null {
  if (!MINUTERIE_RE.test(fonction) && !(MEMBRE_CHAINE_RE.test(fonction) && OBJET_GLOBAL_RE.test(fonction))) return null
  let ast: any
  try {
    ast = acorn.parse(fonction, { ecmaVersion: 'latest', sourceType: 'module' })
  }
  catch {
    return null
  }
  return minuteriesBrutes(ast, [...nomsDuComposant, ...locaux])[0]?.nom ?? null
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
    if (isPure) return cleanJsExpr(rawVal.slice(1, -1), externalVars, moduleName)
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
  const fixe = (s: string): string => decodeHtmlEntities(s).replace(/[\\`]|\$(?=\{)/g, (c) => '\\' + c)
  const raccourci = (texte: string): string => {
    let sortie = ''
    let debut  = 0
    for (const m of texte.matchAll(/(?<![\w$]|(?<!\.)\.)(?:\$\$([a-zA-Z_]\w*)|\$([a-zA-Z_][a-zA-Z0-9_$]*))/g)) {
      const [vu, store, name] = m
      const varName = `$${name}`
      sortie += fixe(texte.slice(debut, m.index))
      if (store) sortie += `\${${cleanJsExpr(`$$${store}`, externalVars, moduleName)}}`
      else sortie += externalVars.includes(varName) ? `\${${varName}}` : `\${$.${name}}`
      debut = m.index! + vu.length
    }
    return sortie + fixe(texte.slice(debut))
  }

  let jsEval = ''
  let texte  = ''
  let i = 0
  const n = rawVal.length

  while (i < n) {
    if (rawVal[i] === '{') {
      jsEval += raccourci(texte)
      texte = ''
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

      jsEval += `\${${cleanJsExpr(expr, externalVars, moduleName)}}`
    } else {
      texte += rawVal[i]
      i += 1
    }
  }
  jsEval += raccourci(texte)

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
// impératif, cf. appendTextNode). Toutes les entités nommées du standard (entites-html.ts)
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
const ENTITES_HERITEES = new Set('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml amp lt gt quot AMP LT GT QUOT COPY REG'.split(' '))
// références numériques 128 à 159 : le standard HTML les lit par la table windows-1252 (`&#128;` → €, `&#150;` → –) ;
// les cinq codes qu'elle ne définit pas (129, 141, 143, 144, 157) restent tels quels
const WINDOWS_1252 = '€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8DŽ\x8F\x90‘’“”•–—˜™š›œ\x9DžŸ'

// noms d'attribut que le filtre du runtime (`µ._mjs_safeAttr`, mjs_init.ts) peut refuser, comparés en minuscules comme lui :
// gestionnaire `on…`, `srcdoc`, adresse (`µ._mjs_URL_ATTRS`, et `data`, `codebase` d'un <object>)
const ATTR_A_RISQUE = /^(?:on[a-z][\s\S]*|srcdoc|href|src|xlink:href|action|formaction|poster|ping|background|data|codebase)$/

/** Dernier argument d'une écriture d'attribut calculé (`µ._mjs_updAttrNode(n, nom, v, 1)`, `this._mjs_updAttr(id, nom, v, 1)`) :
 * `, 1` quand le nom, écrit dans le gabarit, n'a rien à faire refuser au filtre du runtime, qui pose alors la valeur sans lui ;
 * rien pour un nom à risque, ni pour `class`, que le runtime écrit déjà sans ce filtre. Un nom calculé (étalement, balise
 * dynamique) n'arrive jamais ici : il garde le filtre. */
export function attrSur(nom: string): string {
  return nom === 'class' || ATTR_A_RISQUE.test(nom.toLowerCase()) ? '' : ', 1'
}

export function decodeHtmlEntities(s: string, texte = false): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*)(;?)/g, (match, body, pv, offset) => {
    if (body[0] !== '#' && !(pv && entiteNommee(body) !== undefined)) {
      for (let n = Math.min(body.length, 6); n >= 2; n--) {
        if (!ENTITES_HERITEES.has(body.slice(0, n))) continue
        const suite = n < body.length ? body[n] : pv || s[offset + match.length]
        if (!texte && suite !== undefined && /[=a-zA-Z0-9]/.test(suite)) return match
        return entiteNommee(body.slice(0, n)) + body.slice(n) + pv
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
    const named = entiteNommee(body)
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
  type Portee = { noms: Set<string>, parent: Portee | null }
  const libres = new Set<string>()
  const FONCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
  const nouvelle = (parent: Portee | null): Portee => ({ noms: new Set(), parent })
  const declare = (motif: any, portee: Portee): void => {
    if (!motif) return
    switch (motif.type) {
      case 'Identifier': portee.noms.add(motif.name); break
      case 'ObjectPattern': for (const p of motif.properties) declare(p.type === 'RestElement' ? p.argument : p.value, portee); break
      case 'ArrayPattern': for (const e of motif.elements) declare(e, portee); break
      case 'AssignmentPattern': declare(motif.left, portee); break
      case 'RestElement': declare(motif.argument, portee); break
    }
  }
  const connu = (nom: string, portee: Portee | null): boolean => {
    for (let p = portee; p; p = p.parent) if (p.noms.has(nom)) return true
    return false
  }
  // déclarations d'un bloc : let/const, fonctions et classes (les `var` remontent à la fonction)
  const hisseBloc = (instructions: any[], portee: Portee): void => {
    for (const s of instructions) {
      if (s.type === 'VariableDeclaration' && s.kind !== 'var') for (const d of s.declarations) declare(d.id, portee)
      else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) portee.noms.add(s.id.name)
    }
  }
  const hisseVar = (noeud: any, portee: Portee): void => {
    if (!noeud || typeof noeud.type !== 'string' || FONCTIONS.has(noeud.type)) return
    if (noeud.type === 'VariableDeclaration' && noeud.kind === 'var') for (const d of noeud.declarations) declare(d.id, portee)
    for (const cle of Object.keys(noeud)) {
      const v = noeud[cle]
      if (Array.isArray(v)) for (const e of v) hisseVar(e, portee)
      else if (v && typeof v.type === 'string') hisseVar(v, portee)
    }
  }
  // un motif de déclaration ne lit que ses valeurs par défaut et ses clés calculées
  const motif = (m: any, portee: Portee): void => {
    if (!m) return
    switch (m.type) {
      case 'ObjectPattern':
        for (const p of m.properties) {
          if (p.type === 'RestElement') { motif(p.argument, portee); continue }
          if (p.computed) visite(p.key, portee)
          motif(p.value, portee)
        }
        break
      case 'ArrayPattern': for (const e of m.elements) motif(e, portee); break
      case 'AssignmentPattern': motif(m.left, portee); visite(m.right, portee); break
      case 'RestElement': motif(m.argument, portee); break
    }
  }
  const fonction = (f: any, portee: Portee): void => {
    let p = portee
    if (f.type === 'FunctionExpression' && f.id) {
      p = nouvelle(portee)
      p.noms.add(f.id.name)
    }
    const corps = nouvelle(p)
    if (f.type !== 'ArrowFunctionExpression') corps.noms.add('arguments')
    for (const prm of f.params) declare(prm, corps)
    for (const prm of f.params) motif(prm, corps)
    if (f.body.type === 'BlockStatement') {
      hisseBloc(f.body.body, corps)
      hisseVar(f.body, corps)
      for (const s of f.body.body) visite(s, corps)
    }
    else visite(f.body, corps)
  }
  const visite = (n: any, portee: Portee): void => {
    if (!n || typeof n.type !== 'string') return
    switch (n.type) {
      case 'Identifier':
        if (!connu(n.name, portee)) libres.add(n.name)
        return
      case 'Program': {
        const p = nouvelle(portee)
        hisseBloc(n.body, p)
        hisseVar(n, p)
        for (const s of n.body) visite(s, p)
        return
      }
      case 'BlockStatement':
      case 'StaticBlock': {
        const p = nouvelle(portee)
        hisseBloc(n.body, p)
        for (const s of n.body) visite(s, p)
        return
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        fonction(n, portee)
        return
      case 'ClassDeclaration':
      case 'ClassExpression': {
        let p = portee
        if (n.type === 'ClassExpression' && n.id) {
          p = nouvelle(portee)
          p.noms.add(n.id.name)
        }
        visite(n.superClass, p)
        for (const m of n.body.body) {
          if (m.type === 'StaticBlock') visite(m, p)
          else {
            if (m.computed) visite(m.key, p)
            visite(m.value, p)
          }
        }
        return
      }
      case 'VariableDeclaration':
        for (const d of n.declarations) {
          motif(d.id, portee)
          visite(d.init, portee)
        }
        return
      case 'ForStatement': {
        const p = nouvelle(portee)
        if (n.init && n.init.type === 'VariableDeclaration') for (const d of n.init.declarations) declare(d.id, p)
        visite(n.init, p)
        visite(n.test, p)
        visite(n.update, p)
        visite(n.body, p)
        return
      }
      case 'ForInStatement':
      case 'ForOfStatement': {
        const p = nouvelle(portee)
        if (n.left.type === 'VariableDeclaration') for (const d of n.left.declarations) declare(d.id, p)
        visite(n.left, p)
        visite(n.right, p)
        visite(n.body, p)
        return
      }
      case 'CatchClause': {
        const p = nouvelle(portee)
        declare(n.param, p)
        motif(n.param, p)
        visite(n.body, p)
        return
      }
      case 'SwitchStatement': {
        visite(n.discriminant, portee)
        const p = nouvelle(portee)
        for (const c of n.cases) hisseBloc(c.consequent, p)
        for (const c of n.cases) {
          visite(c.test, p)
          for (const s of c.consequent) visite(s, p)
        }
        return
      }
      case 'MemberExpression':
        visite(n.object, portee)
        if (n.computed) visite(n.property, portee)
        return
      case 'Property':
        if (n.computed) visite(n.key, portee)
        visite(n.value, portee)
        return
      case 'LabeledStatement':
        visite(n.body, portee)
        return
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
        return
    }
    for (const cle of Object.keys(n)) {
      const v = n[cle]
      if (Array.isArray(v)) for (const e of v) visite(e, portee)
      else if (v && typeof v.type === 'string') visite(v, portee)
    }
  }
  visite(ast, nouvelle(null))
  return libres
}
