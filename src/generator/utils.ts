// utils — helpers cleanJs/cleanJsExpr, parseMixedString utilisés par le walker.
//
// `cleanJs(expr)` transforme une expression d'interpolation `{...}` ou de
// directive `@x={...}` en JS valide via une suite de regex — moteur HISTORIQUE
// « symboles + grammaire », utilisé tel quel en `templateLang: 'js'` (repli)
// et pour tous les sites FRAGMENT (têtes de {for}, corps de handlers déjà
// batchés en Civet/Coffee par transpiler/index.ts, callbacks @transition,
// heuristiques de détection filtered).
//
// `cleanJsExpr(expr, externalVars, templateLang, moduleName)` — brique
// finale : pour les sites qui
// manipulent une VRAIE expression autonome (interpolation texte, valeur
// d'attribut, condition {if}/{elsif}/@class{}/@style{}/@flip{}, itérable
// {for}, expression {key}/{const}/{await}), le traitement est SCINDÉ en deux
// passes :
//   (a) SYMBOLES — exactement les mêmes regex que `cleanJs` ($x/@x/§x/µXxx/
//       µread…), TOUJOURS appliquées quel que soit templateLang : leur sortie
//       est du Civet valide PAR CONSTRUCTION (`$.x`, `this.x`,
//       `µ.url.params.id`… — `µ` vérifié accepté comme identifiant Civet par
//       sonde directe, cf. tests/template-civet.test.ts).
//   (b) GRAMMAIRE — si `templateLang === 'js'`, les mêmes regex Coffee/Civet
//       que `cleanJs` (`->`, not/and/or, is/isnt, unless), INCHANGÉES ; si
//       'civet' (défaut), compilation Civet SYNCHRONE de l'expression
//       complète (`compile(src, {js: true, sync: true})`) — Civet comprend
//       nativement `->`/not/and/or/is/isnt/unless (grammaire idiomatique
//       complète, sonde directe) sans repasser par nos regex. Mémoïsée (Map
//       module-level, clé = sortie de la passe symboles) : les mêmes
//       expressions reviennent des centaines de fois sur un projet.
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

import { RAW_ACCESS_BODY, RAW_ACCESS_PAREN_BODY, RAW_ACCESS_MALFORME_BODY, rawAccessFormeError, RAW_WRITE_BODY, RAW_WRITE_PAREN_BODY, RAW_WRITE_PAREN_OUT_OPEN, RAW_WRITE_OLD_FORME_BODY, RAW_WRITE_OLD_FORME_PAREN_BODY, rawWriteAncienneFormeError, BARE_SECTION_BODY, bareSectionError, RAW_ACCESS_OUT, RAW_ACCESS_STORE_OUT, MU_PASCAL_BODY, MU_SHORT_BODY, MU_LANG_BODY, MU_LANG_OUT, MU_THEME_BODY, MU_THEME_OUT, MU_LAYOUT_BODY, MU_LAYOUT_WRITE_BODY, MU_LAYOUT_PREFIX_WRITE_BODY, MU_HOOKS_BODY, MU_DERIVED_BODY, MU_EVERY_BODY, MU_UNIVERSAL_BODY, MU_INSPECT_ARG_BODY, MU_INSPECT_ARG_OUT, MU_RUNE_STORE_BODY, MU_MINMAX_RETIRE_BODY, cheminInspectPlat, vaultRemovedError, importedSingletonError, rewriteMuImport, rewriteMuToggle, ouvreUneRegex, scanRegexLiteral } from '../sigils.js'
import { maskInertSameLength, finValeurContexte, ecritureContexte, incrementContexteRe, rewriteIncrement, convertCoffeeInterpolations } from '../lexer/index.js'
import { createRequire } from 'node:module'
import * as acorn from 'acorn'
import { t } from '../messages/index.js'
import { entiteNommee } from './entites-html.js'

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
const RE_MU_PASCAL_G  = new RegExp(`(?<![\\w.µ])${MU_PASCAL_BODY}`, 'g')
const RE_MU_SHORT_G   = new RegExp(`(?<![\\w.µ])${MU_SHORT_BODY}`, 'g')
const RE_MU_LANG_G    = new RegExp(`(?<![\\w.µ])${MU_LANG_BODY}`, 'g')
const RE_MU_THEME_G   = new RegExp(`(?<![\\w.µ])${MU_THEME_BODY}`, 'g')
const RE_MU_LAYOUT_G  = new RegExp(`(?<![\\w.µ])${MU_LAYOUT_BODY}`, 'g')
const RE_MU_LAYOUT_WRITE_G = new RegExp(`(?<![\\w.µ])${MU_LAYOUT_WRITE_BODY}`, 'g')
const RE_MU_LAYOUT_PREFIX_WRITE_G = new RegExp(`(?<![\\w.µ])${MU_LAYOUT_PREFIX_WRITE_BODY}`, 'g')
const RE_MU_HOOKS_G   = new RegExp(`(?<![\\w.µ])${MU_HOOKS_BODY}`, 'g')
const RE_MU_DERIVED_G = new RegExp(`(?<![\\w.µ])${MU_DERIVED_BODY}`, 'g')
const RE_MU_EVERY_G   = new RegExp(`(?<![\\w.µ])${MU_EVERY_BODY}`, 'g')
// sucre universel µfoo → µ.foo (runes hors liste blanche MU_SHORT_BODY — µraw/µsnap/
// µplay/µinspect, mjs_rare_runes.ts) : même garde de tête que les RE_MU_*_G
// ci-dessus, corps PARTAGÉ avec le script (transpiler/index.ts, MU_UNIVERSAL_RE).
const RE_MU_UNIVERSAL_G     = new RegExp(`(?<![\\w.µ])${MU_UNIVERSAL_BODY}`, 'g')
// remodelage d'arguments de µ.inspect — même corps que le script (aucune garde de tête
// supplémentaire : il cible la forme DÉJÀ pointée `µ.inspect`, avec ses propres gardes internes).
const RE_MU_INSPECT_ARG_G   = new RegExp(MU_INSPECT_ARG_BODY, 'g')

// Applique `fn` uniquement aux segments de CODE (hors littéraux '…', "…", `…`).
// Les regex de sucre ne doivent JAMAIS réécrire le contenu des chaînes :
// avant, `'this is fine'` devenait `'this === fine'` et `' and yet '`
// → `' && yet '` (corruption silencieuse de tout texte anglais).
function mapCodeSegments(src: string, fn: (code: string) => string): string {
  let res = ''
  let i = 0
  const n = src.length
  let codeStart = 0
  while (i < n) {
    const ch = src[i]
    if (ch === '"' || ch === "'") {
      // Chaîne littérale inerte : copiée verbatim (aucun sucre à l'intérieur).
      res += fn(src.slice(codeStart, i))
      let j = i + 1
      while (j < n && src[j] !== ch) { if (src[j] === '\\') j++; j++ }
      const end = Math.min(j + 1, n)
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
          res += '${' + mapCodeSegments(inner, fn) + '}'
          j = k + 1
        } else {
          res += src[j]
          j++
        }
      }
      if (j < n) res += '`'
      i = j + 1
      codeStart = i
    } else if (ch === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && ouvreUneRegex(src.slice(0, i))) {
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
// `applySymbolRegex`/la passe grammaire.
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

// Passe GRAMMAIRE — idiomes Coffee/Civet historiques, traduits par regex.
// Chemin `templateLang: 'js'` (repli) UNIQUEMENT : en 'civet', cette
// traduction est déléguée à une VRAIE compilation Civet (cf.
// compileGrammarViaCivet plus bas), qui comprend nativement ces mêmes
// idiomes sans repasser par ces regex.
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
// au clic, ou un échec de Civet sans rapport. Préfixe et condition sont relus dans le texte réel
function rewriteUnless(raw: string): string {
  const m = /^([\s\S]*?)(?<![\w.$])unless\s+(.+)$/d.exec(maskInertSameLength(raw))
  if (!m) return raw
  const pre  = raw.slice(...m.indices![1]).trim()
  const cond = raw.slice(...m.indices![2])
  return pre ? `(!(${cond}) && (${pre}))` : `!(${cond})`
}

// Passe SYMBOLES — sucre MJS ($x/@x/§x/µXxx/µread…), TOUJOURS appliquée quel
// que soit templateLang : sa sortie est du Civet valide par construction
// (accès `.`, `this.x`, `µ.foo` — de simples identifiants/membres, cf.
// header). C'est le chemin GRAMMAIRE qui bifurque, jamais celui-ci.
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
    if (nu.startsWith('#') && !nu.startsWith('#{')) { out.push(''); continue }   // commentaire Coffee (handlers en templateLang js), jamais `#{…}` d'interpolation
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
// (mapCodeSegments a déjà isolé la chaîne comme littéral INERTE avant d'appeler applySymbolRegex),
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
// applySymbolRegex/inspectArgHorsCommentaire plus loin — ceux-ci ne revoient plus jamais un
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

function applySymbolRegex(seg: string, externalVars: string[]): string {
  let res = seg

  // `@@` AVANT `@name` : sinon le 2e `@` de `@@x` était capturé par la
  // règle `@name` (son lookbehind « pas un mot » est satisfait par `@`)
  // → sortie `@this.x` au lieu de `_mjsThis.x`.
  res = res.replace(/(?<!\w|(?<!\.)\.)@@/g, '_mjsThis.')

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
  // µevery : timer POSÉ AU SETUP (file de montage du composant) — hors d'un <script>,
  // elle n'a personne à qui s'accrocher, et finirait en ReferenceError muet. Garde-fou
  // explicite comme µderived, mais testé HORS COMMENTAIRES (cf. sansCommentaires).
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

  // µwrite $x, v / µwrite($x, v) — corps arrêtés à la virgule (sigils.ts, RAW_WRITE_BODY) :
  // `v` n'est jamais capturé, il continue tel quel dans `res`. Forme parenthésée : une
  // parenthèse ouvrante FRAÎCHE remplace `µwrite(`, la fermante d'origine (non consommée)
  // referme celle-là.
  const rawWriteParenOut = (_m: string, dollar: string, name: string) =>
    RAW_WRITE_PAREN_OUT_OPEN + (dollar ? RAW_ACCESS_STORE_OUT : RAW_ACCESS_OUT) + name + ' = '
  const rawWriteOut = (_m: string, dollar: string, name: string) =>
    (dollar ? RAW_ACCESS_STORE_OUT : RAW_ACCESS_OUT) + name + ' = '
  res = res.replace(RE_RAW_WRITE_PAREN_G, rawWriteParenOut).replace(RE_RAW_WRITE_G, rawWriteOut)

  // Ancienne forme `µwrite $x = v` / `µwrite($x) = v` (RETIRÉE) : message dédié
  // AVANT la garde générique, plutôt que le message générique moins actionnable.
  RE_RAW_WRITE_OLD_FORME_PAREN_G.lastIndex = 0
  RE_RAW_WRITE_OLD_FORME_G.lastIndex = 0
  if (RE_RAW_WRITE_OLD_FORME_PAREN_G.test(sansCommentaires(res)) || RE_RAW_WRITE_OLD_FORME_G.test(sansCommentaires(res))) throw rawWriteAncienneFormeError()

  RE_RAW_ACCESS_MALFORME_G.lastIndex = 0
  if (RE_RAW_ACCESS_MALFORME_G.test(sansCommentaires(res))) throw rawAccessFormeError()

  // &$x / $$x / §§x / @x
  // &$x → µ.vault.x (store GLOBAL réactif, zéro import) — DOIT passer AVANT
  // la règle $x, sinon le `$` de `&$x` serait capturé (→ `&$.x`).
  res = res
    .replace(/(?<![\w.])&\$([a-zA-Z_][a-zA-Z0-9_$]*)/g, (_m: string, name: string) => { throw vaultRemovedError(name) })
    // &xxx → µ.url.params.xxx : PARAM DE ROUTE, lecture réactive. Même
    // désambiguïsation que le lexer (cf. lexer/index.ts §3.1c), en regex :
    //   • lookbehind : `&` PAS précédé d'un opérande (mot/`)`/`]`/guillemet/
    //     backtick), ni d'un autre `&` (→ `&&`), ni d'un `.` (member-access) ;
    //   • lookahead `(?![\w;])` : identifiant MAXIMAL et PAS une entité HTML
    //     (`&amp;` finit par `;` → non-match, sans backtracking).
    .replace(/(?<![\w)\]"'\x60&.])&([a-zA-Z_]\w*)(?![\w;])/g,
      (_m: string, name: string) => `µ.url.params.${name}`)
    // µ$$X : le singleton lu dans le code d'une interpolation de chaîne (`{"#{µ$$X.y}"}`) — hors chaîne, la pré-passe
    // 0-bis du transpileur l'a déjà réécrit en `$X`. Même verdict qu'elle, et que le lexer (règle 3.2-pré) : un nom
    // importé se lit `$X`, tout autre est refusé ; sans cette règle, celle du `$$X` juste en dessous refusait le singleton
    .replace(/µ\$\$([a-zA-Z0-9_]+)/g, (_m: string, name: string) => {
      if (externalVars.includes(`$${name}`)) return `$${name}`
      throw new Error(t('transpiler.singleton-sans-import', { nom: name }))
    })
    .replace(/(?<!\w|(?<!\.)\.)\$\$([a-zA-Z_][a-zA-Z0-9_$]*)/g, (_m: string, name: string) => {
      // Un singleton importé (`$X` ∈ externalVars, via `@import µ$$X`) se
      // consomme en `µ$$X`, pas en `$$X` (= store GLOBAL, autre espace).
      if (externalVars.includes(`$${name}`)) throw importedSingletonError(name)
      return `µ.store.${name}`
    })
    // §§X : TOUJOURS le contexte RÉACTIF de sous-arbre (plus aucune résolution
    // vers un singleton importé, cf. applyContextSetters) — setter `§§foo = expr`
    // → `_mjs_setRCtx`, getter `§§foo` → `_mjs_getRCtx` (remonte l'arbre + abonne).
    // §§ getter (le setter `§§x = …` est traité en pré-passe, cf. applyContextSetters)
    .replace(/(?<![\w§]|(?<!\.)\.)§§([a-zA-Z_][a-zA-Z0-9_$]*)/g, (_m: string, name: string) =>
      `this._mjs_getRCtx('${name}')`)
    .replace(/(?<![\w@]|(?<!\.)\.)@([a-zA-Z_][a-zA-Z0-9_$]*)/g, 'this.$1')
    // µXxx (PascalCase) → µ.Xxx et µurl/µonline/µvisible/µready/µserver + les
    // fabriques temps réel µsocket/µsmooth → µ.* : formes courtes des objets
    // framework, mêmes règles que le lexer (§3.8b/3.8c) PAR CONSTRUCTION
    // (corps sigils.ts). La forme déjà pointée (`µ.Router`, `µ.url`) ne
    // matche pas : il faut une lettre collée à `µ`.
    .replace(RE_MU_PASCAL_G, 'µ.$1')
    .replace(RE_MU_SHORT_G, 'µ.$1')
    // µlang → µ.store.__mjsLang (langue courante, clé store cachée) — même
    // sucre que le lexer (§3.8d), corps partagé sigils.ts.
    .replace(RE_MU_LANG_G, MU_LANG_OUT)
    // µtheme → µ.store.__mjsTheme — même sucre que le lexer (§3.8e), CALQUE de µlang.
    .replace(RE_MU_THEME_G, MU_THEME_OUT)
    // µlayout → la prop `layout` (« default » sans rien) : `$layout` devient `$.layout` plus bas
    .replace(RE_MU_LAYOUT_G, "($layout || 'default')")
    // sucre universel µfoo → µ.foo — runes minuscules HORS liste blanche ci-dessus
    // (µraw/µsnap/µplay/µinspect, mjs_rare_runes.ts) : AVANT ce filet, elles
    // ressortaient littérales dans le JS final (`µraw is not defined` au premier
    // rendu, repro `weatherData={µraw(result)}` en branche `{success result}`).
    // MÊME garde que le script (transpiler/index.ts, MU_UNIVERSAL_RE, corps partagé
    // sigils.ts) : un `µfoo` INCONNU (ni ci-dessus, ni sur `µ` au runtime) est pointé
    // quand même — échoue en `µ.foo is not a function` à l'EXÉCUTION, jamais à la
    // compilation, comportement IDENTIQUE aux deux moteurs (parité assumée, pas une
    // validation nouvelle). `µasset`/`µimage` DEVIENNENT AUSSI `µ.asset`/`µ.image` ici
    // (aucune exclusion pour eux, exactement comme dans le script) — sans danger : leur
    // RÉSOLUTION reste un mécanisme séparé (bundler, preResolveAssets/resolveMagicAssets)
    // dont les regex (ASSET_RE, ASSET_CALL_RE, IMAGE_CALL_RE) acceptent déjà LES DEUX
    // formes, pointée ou non (vérifié empiriquement). Un composant qui les MENTIONNE dans
    // une chaîne ou un commentaire reste hors de portée, comme pour PASCAL/SHORT ci-dessus
    // (`mapCodeSegments` a déjà isolé les chaînes).
    .replace(RE_MU_UNIVERSAL_G, 'µ.$1')
    // µ.inspect($x) → µ.inspect('x') : remodelage d'arguments identique au script
    // (transpiler/index.ts), sans quoi le préfixe pointé ci-dessus suffirait à éviter
    // le ReferenceError mais appellerait le runtime avec un typage difforme (clé manquante).
    .replace(RE_MU_INSPECT_ARG_G, inspectArgHorsCommentaire)

  // $x → $.x sauf si ∈ externalVars (singleton importé : garde `$x`, sa forme
  // compilée). La FAUTE de consommation `$x` au lieu de `µ$$x` est détectée en
  // amont par le lint singleton (sur le code SOURCE du dev), pas ici — cette
  // passe tourne aussi sur du code déjà transformé (double-passe analyzer).
  // `µread $x` / `µwrite $x` (et `$$x`) déjà consommés tout en tête de cette
  // fonction — cf. commentaire là-bas pour le pourquoi de l'ordre.

  // Snapshot `$xxx =: expr` → `$.xxx = µ.snap(expr)` (parité lexer §3.7,
  // incohérence — le lexer gère `=:` dans <script>,
  // cleanJs (interpolations `{...}`/`@x={...}`) l'ignorait, laissant un
  // `=:` littéral dans le JS final → SyntaxError). Contrairement au lexer
  // (dont la sortie repasse par Civet, qui accepte l'appel Coffee « nu »
  // `µ.snap expr`), la sortie de cleanJs est du JS FINAL non re-compilé :
  // parenthèses explicites obligatoires ici. Portée : toute l'expression
  // jusqu'à `;`/fin de ligne/fin de segment (même convention que le
  // pré-passe §x=/§§x= plus haut) — DOIT précéder la règle générique
  // `$x → $.x` juste en dessous, et tourne après le bloc $$/§§ ci-dessus
  // (garantit qu'un `$` restant ici est bien SIMPLE, jamais la queue d'un
  // `$$xxx` déjà consommé).
  res = res.replace(/(?<![\w$]|(?<!\.)\.)\$([a-zA-Z0-9_]+)[ \t]*=:[ \t]*(.+?)(?=\n|;|$)/g,
    (_m, name, valueExpr) => {
      const varName = `$${name}`
      const prefix = externalVars.includes(varName) ? varName : `$.${name}`
      return `${prefix} = µ.snap(${valueExpr})`
    })

  // Garde-fou JUMEAU de la règle 3.8-pré du lexer (src/lexer/index.ts) — même
  // collision `$xxx := expr`, ici côté GÉNÉRATEUR : une expression de template
  // (handler `@click={…}`, tête de {for}, callback @transition — les sites
  // FRAGMENT qui passent par `cleanJs`, PAS `tokenize()`) n'est JAMAIS vue par
  // le lexer. Sans ce garde-fou, la règle `$x → $.x` juste en dessous
  // réécrirait silencieusement en `$.x := expr` — que Civet compile SANS
  // broncher en `const $.x = expr` (cible non-identifiant d'un `const` : JS
  // invalide, mais Civet ne valide pas cette contrainte EN POSITION
  // STATEMENT, seul cas où `:=` est syntaxiquement permis) — filé TEL QUEL
  // dans le bundle, aucun throw (découvert via transpileFile sur `@click={$x
  // := 2}` : `const $.x = 2;return $.x` dans le handler compilé).
  // Portée identique à 3.8-pré : seulement si CE `$xxx` serait RÉELLEMENT
  // réécrit par la règle juste en dessous (donc pas pour un $xxx ∈
  // externalVars — singleton importé, identifiant Civet ordinaire, `:=` y
  // reste valide, aucun risque). Les sites EXPRESSION (interpolation {…},
  // valeur d'attribut — cleanJsExpr/compileGrammarViaCivet, expression
  // TOUJOURS enveloppée de parenthèses) n'ont même pas besoin de ce filet :
  // Civet y rejette déjà nativement `:=` (déclaration, pas une expression) —
  // ce garde-fou y transforme juste ce rejet générique en message pédagogique.
  res = res.replace(/(?<!\w|(?<!\.)\.)\$([a-zA-Z_][a-zA-Z0-9_$]*)[ \t]*:=/g,
    (m: string, name: string, offset: number, full: string) => {
      const varName = `$${name}`
      if (externalVars.includes(varName)) return m
      const preview = full.slice(offset + m.length).match(/^[ \t]*([^\n;]*)/)?.[1]?.trim() || '...'
      throw new Error(t('lexer.symbole-declare-civet', { varName, preview }))
    })

  // précédé d'un point, c'est une propriété (`obj.$x`) ; de deux, une plage ou une
  // décomposition (`[1..$n]`, `[...$items]`) : la variable
  // précédé d'un `$`, c'est la fin d'un `$$x` resté tel quel (propriété `obj.$$x`, laissée par la règle `$$` juste au-dessus) : pas un `$x`
  res = res.replace(/(?<![\w$]|(?<!\.)\.)\$([a-zA-Z_][a-zA-Z0-9_$]*)/g, (_m, name) => {
    const varName = `$${name}`
    return externalVars.includes(varName) ? varName : `$.${name}`
  })

  // § getContext (le setter `§x = …` est traité en pré-passe, cf. applyContextSetters)
  res = res.replace(
    /(?<![\w§]|(?<!\.)\.)§([a-zA-Z_]\w*)/g,
    (_m, name) => `this._mjs_getContext('${name}')`
  )

  // §/§§ NU (non suivi d'un nom) : survécu à applyContextSetters ET aux deux réécritures
  // ci-dessus (aucune ne consomme un §/§§ sans identifiant collé derrière) — refus explicite
  // plutôt qu'un caractère qui atteint Civet tel quel (message cryptique). Testé HORS
  // COMMENTAIRES (cf. sansCommentaires, même garde que RE_RAW_ACCESS_MALFORME_G plus haut) :
  // mapCodeSegments a déjà isolé les chaînes en amont, `res` ne peut donc plus en contenir.
  RE_BARE_SECTION_G.lastIndex = 0
  const bareSection = RE_BARE_SECTION_G.exec(sansCommentaires(res))
  if (bareSection) throw bareSectionError(bareSection[0])

  return res
}

// cleanJs : sucre MJS + idiomes Coffee/Civet courants → JS standard
//   - Runes : $$ / §§ / @ / @@ / § / $
//   - Coffee/Civet : not / and / or / is / isnt / unless / -> (thin arrow)
//
// Moteur HISTORIQUE inchangé (regex bout en bout) — utilisé pour le repli
// `templateLang: 'js'` ET pour tous les sites FRAGMENT (cf. header). Pour les
// sites EXPRESSION en `templateLang: 'civet'` (défaut), voir `cleanJsExpr`.
export function cleanJs(expr: string | null | undefined, externalVars: string[] = []): string {
  // µtoggle(…) EN TÊTE (à l'inverse de µimport, passe finale) : la rune rend une
  // AFFECTATION en syntaxe MJS (`$x = (…)`) — ce sont les passes qui suivent qui
  // la transforment en setter réactif. Sa place est donc avant elles, pas après.
  const raw = rewriteMuToggle((expr ?? '').toString().trim(), 'interpolation {…}/handler')
  const pre = reecritOuRejetteRuneChemin(applyContextSetters(raw, externalVars))
  const out = mapCodeSegments(rewriteUnless(pre), (seg) => applySymbolRegex(applyGrammarRegex(seg), externalVars))
  // µimport('chemin.js') / mjsimport('chemin.js') → µ._mjs_import(µasset('chemin.js'))
  // passe FINALE, sur `out` COMPLET : `mapCodeSegments` isole déjà les
  // chaînes littérales AVANT d'appeler `applySymbolRegex` par segment — or
  // l'argument de µimport EST une chaîne littérale, invisible à un `.replace()`
  // niché DANS ce découpage. rewriteMuImport masque elle-même chaînes/
  // commentaires — source unique sigils.ts, partagée avec
  // le moteur script (applyMjsSugarToScript, transpiler/index.ts).
  return rewriteMuImport(out, 'interpolation {…}/handler')
}

// Symboles SEULS (sans grammaire) — sortie civet-valide, grammaire Coffee/
// Civet (not/and/or/is/isnt/unless/->) laissée INTACTE pour que la vraie
// compilation Civet la traite ensuite (compileGrammarViaCivet) — `isnt` n'est
// PAS compris nativement par Civet (miscompile silencieux en `a(isnt(b))`),
// il y est normalisé en `is not` avant compilation, cf. compileGrammarViaCivet.
function cleanJsSymbolsOnly(expr: string | null | undefined, externalVars: string[]): string {
  // µtoggle(…) en tête — même raison qu'au-dessus (cleanJs)
  const raw = rewriteMuToggle((expr ?? '').toString().trim(), 'interpolation {…}/handler')
  const pre = reecritOuRejetteRuneChemin(applyContextSetters(raw, externalVars))
  const out = mapCodeSegments(pre, (seg) => applySymbolRegex(seg, externalVars))
  // µimport(...) — même passe finale que cleanJs ci-dessus, AVANT la
  // compilation Civet de la grammaire (compileGrammarViaCivet, appelant) :
  // `µ._mjs_import(µasset('x.js'))` est un simple appel de fonction, JS/Civet
  // valide par construction, aucune grammaire spéciale à y attendre.
  return rewriteMuImport(out, 'interpolation {…}/handler')
}

// ============================================================================
// cleanJsExpr — passe GRAMMAIRE branchée
// ============================================================================

// Civet chargé en SYNCHRONE via `require` (CJS, `createRequire` depuis ce
// module ESM) — `cleanJs`/`cleanJsExpr` sont appelés en profondeur dans des
// callbacks `.replace()` synchrones (compile.ts, attributes/index.ts) : un
// `await import()` est IMPOSSIBLE à ces call-sites. Chargement PARESSEUX (au
// premier appel civet réel) pour ne rien coûter aux projets `templateLang:
// 'js'` exclusif.
let _civetCompile: ((src: string, opts: Record<string, unknown>) => string) | null = null
function getCivetCompile(): (src: string, opts: Record<string, unknown>) => string {
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

  // `isnt` (Coffee) → `is not` : Civet ne le connaît pas — il parse `a isnt b` en
  // appel `a(isnt(b))`, miscompile silencieux. même
  // remède que la Pass 2b des <script> (transpiler/index.ts:866), hors chaînes/
  // commentaires (mapCodeSegments), regex prudente calquée sur applyGrammarRegex
  // (`.isnt` propriété intact)
  const normalized = mapCodeSegments(trimmed, (seg) => seg.replace(/(?<![\w.\$])\bisnt\b(?!\s*[:)\]},;])/g, 'is not'))

  const cached = civetExprCache.get(normalized)
  if (cached !== undefined) return cached

  let compiled: string
  try {
    // DRIFT SÉMANTIQUE ASSUMÉ — `coffeeEq: true` fait compiler `==`/`!=` en `===`/`!==`,
    // comme la convention stricte des `<script>` Civet du projet. Par défaut
    // Civet NE fait PAS cette conversion (vérifié par sonde directe :
    // `compile('($.n == 1)', {js:true, sync:true})` renvoie `==` inchangé
    // sans ce flag) — c'est un choix d'harmonisation ASSUMÉ ici, pas un
    // comportement natif Civet. Le repli `templateLang: 'js'` (cleanJs/
    // applyGrammarRegex) NE touche PAS `==` : il reste lâche, aucune
    // régression du repli. Attesté par tests/template-civet.test.ts.
    compiled = getCivetCompile()(`(${normalized})`, {
      js: true,
      sync: true,
      filename: moduleName ? `${moduleName}.expr` : 'mjs-expr',
      parseOptions: { coffeeEq: true },
    })
    _civetCompileMisses += 1
  } catch (err: any) {
    // Erreur orientante — calque le try/catch des handlers inline
    // (transpiler/index.ts:1538+, zone déjà livrée hors-périmètre de cette
    // brique) : même indice ternaire collé (`a?b:c`), même filler non-blanc.
    const civetMsg = err?.message ?? String(err)
    const codeOnly = trimmed.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => 'x'.repeat(m.length))
    const gluedTernaryHint = /\?[^\s?.:]/.test(codeOnly)
      ? t('generator.hint-ternaire-colle')
      : ''
    const moduleHint = moduleName ? t('generator.hint-dans-module', { moduleName }) : ''
    throw new Error(t('generator.interpolation-echec-civet', { moduleHint, rawExprForError, civetMsg, gluedTernaryHint }))
  }

  // Retire le `;`/saut de ligne final éventuel PUIS la parenthèse enveloppante
  // qu'on vient d'ajouter — sortie = expression JS nue, drop-in de cleanJs.
  const out    = compiled.replace(/;\s*$/, '').trim()
  const result = /^var [A-Za-z_$][\w$]* = /.test(out) ? withCivetHelpers(out) : stripOuterParens(out)
  civetExprCache.set(normalized, result)
  return result
}

// une aide de Civet (`[1..200]` → `var range = …`, `a %% b` → `var modulo = …`) est déclarée AVANT
// l'expression : elles partent ensemble, dans une fléchée appelée sur place (`this` inchangé)
function withCivetHelpers(out: string): string {
  const body = (acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true }) as any).body
  const last = body[body.length - 1]
  if (!last || last.type !== 'ExpressionStatement') return stripOuterParens(out)
  const expr = stripOuterParens(out.slice(last.expression.start, last.expression.end))
  return `(() => { ${out.slice(0, last.start).trim()} return (${expr}); })()`
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
// cartographie complète EXPR vs FRAGMENT. `templateLang`/`moduleName` sont
// transmis par l'appelant depuis `state`/`env.compiler` (CompilerState).
export function cleanJsExpr(
  expr: string | null | undefined,
  externalVars: string[] = [],
  templateLang: 'civet' | 'js' = 'civet',
  moduleName?: string
): string {
  if (templateLang === 'js') return cleanJs(expr, externalVars)
  const raw = (expr ?? '').toString().trim()
  if (raw === '') return raw
  const interpolated = convertCoffeeInterpolations(raw)
  const symbolsCleaned = cleanJsSymbolsOnly(interpolated, externalVars)
  return compileGrammarViaCivet(symbolsCleaned, raw, moduleName)
}

// parse_mixed_string : transforme un raw_val (chaîne avec {expr} interpolés)
// en template literal JS. Chaque `{expr}` est un site EXPRESSION (même
// nature qu'une interpolation texte) → passe par `cleanJsExpr`.
export function parseMixedString(
  rawVal: string,
  externalVars: string[] = [],
  templateLang: 'civet' | 'js' = 'civet',
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
    if (isPure) return cleanJsExpr(rawVal.slice(1, -1), externalVars, templateLang, moduleName)
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
      if (store) sortie += `\${${cleanJsExpr(`$$${store}`, externalVars, templateLang, moduleName)}}`
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

      jsEval += `\${${cleanJsExpr(expr, externalVars, templateLang, moduleName)}}`
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
