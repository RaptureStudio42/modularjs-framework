// transpiler/sugar — sucres du script, posés avant la compilation par le langage : dialecte Civet (applyCivetDialectSugar)
// et runes µ (applyMjsSugarToScript, µconsole), avec leurs scanners ; appelés par transpileImpl (index.ts)

import { MU_UNIVERSAL_BODY, MU_INSPECT_ARG_BODY, MU_INSPECT_ARG_OUT, opensRegex, scanRegexLiteral, componentTimer } from '../sigils.js'
import { skipQuotedSpan } from '../quoted-span.js'
import { maskNonCode } from './split-rune.js'
import { convertCoffeeInterpolations, scriptSpans, endOfHeregex, SPAN, opensHashBlock } from '../lexer/index.js'
import { rewritesOrRejectsRunePath, commaParenSpaceReject } from '../generator/utils.js'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { t } from '../messages/index.js'
import { maskStringsAndComments } from './lint.js'
import { shiftsPass, type PassDeclarations } from '../languages/civet-declarations.js'
import { dialectComments, type ScriptComments } from '../reader/script.js'

// ----------------------------------------------------------------------------
// sucre universel µfoo → µ.foo, MOINS les runes réservées au lexer (cf.
// sigils.ts, MU_SCRIPT_RUNES) ; bâtie UNE fois hors de la fonction. Corps PARTAGÉ
// avec cleanJs (generator/utils.ts, RE_MU_UNIVERSAL_G) — même texte, une seule
// source (sigils.ts) : c'est l'absence de ce partage qui laissait les runes
// minuscules hors liste blanche (µraw/µsnap/µplay/µinspect) littérales
// dans une expression HTML.
const MU_UNIVERSAL_RE = new RegExp(MU_UNIVERSAL_BODY, 'g')

// ----------------------------------------------------------------------------
// transformCodeOnly — applique `transform` au seul CODE du script : chaînes, gabarits, expressions régulières et commentaires gardés
// tels quels, le code de chaque interpolation transformé à part (ses chaînes restent inertes) — les plages du lecteur du script
// (scriptSpans, lexer), que partagent les passes de ce fichier : une regex globale ne mord jamais dans un texte (`for x in arr` écrit
// dans une chaîne, `#{x}` dans un commentaire). Utilisée par applyCivetDialectSugar (passes 2 et 2b) et par les réécritures µ
// d'applyMjsSugarToScript — source unique
// `dialecte` : Coffee ou Civet (heregex, regex passée sans parenthèses) ; faux pour un script JavaScript ou TypeScript ; `coffee` :
// CoffeeScript, où `#` ouvre toujours un commentaire
function transformCodeOnly(input: string, transform: (codeChunk: string) => string, dialect = true, coffee = false): string {
  let out = ''
  for (const [kind, start, end] of scriptSpans(input, dialect, coffee)) out += kind === SPAN.CODE ? transform(input.slice(start, end)) : input.slice(start, end)
  return out
}

// ----------------------------------------------------------------------------
// scanPatternHead / rewriteIndexTargets — motif de destructuration à INDEX
// CALCULÉ : la Pass 4
// ci-dessous (auto-déclaration scope-aware) ratait TOUT motif portant un crochet
// INTERNE — `[arr[0], tmp] = …`, `[$$liste[k], tmp] = …`, `[[a, b], c] = …`,
// `{a: {b}} = o` — l'ancienne regex `[^={}[\]]*` refusait le moindre `[`/`]` à
// l'intérieur du motif et ne matchait RIEN : `tmp`/`a`/`b`/`c` n'étaient JAMAIS
// déclarés → `ReferenceError` au premier clic, alors que le build restait VERT
// (mesuré : zéro erreur de compilation, panne muette à l'exécution seulement).
// scanPatternHead remplace la regex par un parcours équilibré (`[`/`{`/`(` …
// `]`/`}`/`)`, chaînes `'…'`/`"…"`/`` `…` `` sautées, échappements `\` compris) :
// exclut volontairement toute valeur par défaut dans le motif (`[a = 1, b]`, `=`
// nu hors chaîne détecté) — même périmètre minimal qu'avant. rewriteIndexTargets
// distingue ensuite, DANS le motif retenu, un MOTIF IMBRIQUÉ (`[[a, b], c]` — `[`
// précédé de `[`/`{`/`,`/`:`/début/blanc, reste en place) d'un ACCÈS MEMBRE indexé
// (`arr[0]`, `$$liste[k]`, `µ.store.x[k]`, `@items[i]` — `[` précédé d'un
// caractère d'identifiant/`)`/`]`) : ce dernier est réécrit en `.__` (pseudo-
// segment pointé) pour retomber sur dottedRe/memberRe plus bas (racine = cible
// MEMBRE, jamais une variable à déclarer) ; le nom lu DANS l'index (`k`, `i`)
// disparaît avec le crochet — une LECTURE, jamais une cible.
// ----------------------------------------------------------------------------
// skipCommentSpan — rend l'index JUSTE APRÈS un commentaire `//`/`/* … */` démarrant en `i`, ou -1
// si `i` n'ouvre aucun commentaire : un `/* … */`
// (mono-ligne OU multi-lignes, issu d'un `###…###` Coffee converti par la Pass 1) glissait dans les
// 4 scanners ci-dessous comme un LITTÉRAL REGEX (`opensRegex` vrai après une virgule,
// `scanRegexLiteral` refermé sur le `/` de `*/`) — la pièce de paramètre qui suivait, non séparée
// par une virgule, sortait GARBAGE et se faisait jeter en silence par `extractParamNames`. Posé
// AVANT le test `opensRegex` dans chaque scanner (même ordre que `noComments` plus bas et
// `transformCodeOnly` plus haut : `//`/`/*` toujours testés avant un littéral regex).
function skipCommentSpan(str: string, i: number): number {
  if (str[i] === '/' && str[i + 1] === '/') {
    const e = str.indexOf('\n', i)
    return e === -1 ? str.length : e
  }
  if (str[i] === '/' && str[i + 1] === '*') {
    const e = str.indexOf('*/', i + 2)
    return e === -1 ? str.length : e + 2
  }
  return -1
}

function balancedSpan(str: string, start: number): number {
  let depth = 0
  let i = start
  while (i < str.length) {
    const ch = str[i]
    // Littéral regex `/…/` : un `(`/`[` ÉCHAPPÉ ou en
    // classe À L'INTÉRIEUR faussait `depth` (`f = (re = /\(/) ->` ne refermait jamais son groupe,
    // span PERDU, `re` jamais enregistré) ; heuristique partagée `opensRegex`/`scanRegexLiteral`
    // (sigils.ts), même garde que transformCodeOnly plus haut
    // Commentaire `//`/`/* … */` sauté AVANT ce test : sinon un bloc
    // `/* … */` se faisait avaler comme un littéral regex (cf. bandeau skipCommentSpan ci-dessus)
    const cs = skipCommentSpan(str, i)
    if (cs !== -1) { i = cs; continue }
    if (ch === '/' && opensRegex(str.slice(0, i))) {
      const end = scanRegexLiteral(str, i)
      if (end !== -1) { i = end; continue }
    }
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(str, i); continue }
    if (ch === '[' || ch === '{' || ch === '(') { depth++; i++; continue }
    if (ch === ']' || ch === '}' || ch === ')') { depth--; i++; if (depth === 0) return i; continue }
    i++
  }
  return -1
}

function hasBareEquals(str: string): boolean {
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(str, i); continue }
    if (ch === '=') return true
    i++
  }
  return false
}

function scanPatternHead(line: string): { lead: string; pattern: string; sp: string; rest2: string } | null {
  const leadLen  = line.length - line.trimStart().length
  const lead     = line.slice(0, leadLen)
  if (line[leadLen] !== '[' && line[leadLen] !== '{') return null
  const end = balancedSpan(line, leadLen)
  if (end === -1) return null
  const pattern = line.slice(leadLen, end)
  if (hasBareEquals(pattern)) return null
  // `\s*` après le `=` (pas `\s+`) : un motif COLLÉ au signe (`[a,b]=x`) est une
  // affectation tout aussi valide qu'espacée (`[a, b] = x`) — exiger un espace
  // rejetait la forme collée avec un message trompeur (sans rapport avec l'espace).
  // `[^=>]` (pas `[^=]`) dans le repli : sans l'exclusion du `>`, un `=` DÉJÀ consommé comme
  // signe d'affectation suivi d'un `>` COLLÉ (`[a,b]=>expr`, flèche Civet, AUCUNE affectation
  // réelle — sucre d'appel « pattern => corps ») retombait dans ce repli (`>` accepté comme
  // « n'importe quel caractère sauf = ») : la flèche perdait son second caractère (`.=>`),
  // Civet refusait de parser. `=>` reste capturable EXPLICITEMENT via l'alternative de gauche
  // (cf. `nom = => expr`, plus bas) quand un ESPACE sépare vraiment le signe de la flèche.
  const rest = line.slice(end).match(/^(\s*)=(\s*(?:=>|[^=>]).*)$/)
  if (!rest) return null
  return { lead, pattern, sp: rest[1], rest2: rest[2] }
}

function rewriteIndexTargets(str: string): string {
  let result       = ''
  let lastNonBlank = ''
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = skipQuotedSpan(str, i)
      result       += str.slice(i, end)
      lastNonBlank  = str[end - 1] ?? ch
      i = end
      continue
    }
    if (ch === '[' && /[\w$)\]]/.test(lastNonBlank)) {
      const end = balancedSpan(str, i)
      if (end === -1) { result += ch; lastNonBlank = ch; i++; continue }
      result       += '.__'
      lastNonBlank  = '_'
      i = end
      continue
    }
    result += ch
    if (!/\s/.test(ch)) lastNonBlank = ch
    i++
  }
  return result
}

// Une racine APPEL (`globalGetPair()[0]`,
// `f()[0]`) n'est ni pointée ni membre : le `(` collé casse `dottedRe`/`memberRe` (leur tête
// `[a-zA-Z_µ][\w$]*` ne franchit jamais une parenthèse) → extraite comme nom neuf, déclarée ou
// promue à tort (`let [globalGetPair()[0], t] = …` — Civet refuse, « Failed to parse »). Un
// identifiant COLLÉ à `(` (`arr [0]` reste un accès Coffee, jamais un appel : `\s*` volontairement
// absent) voit son groupe de parenthèses équilibré réécrit en `.__` — la racine retombe sous
// dottedRe (cible MEMBRE). Tourne AVANT rewriteIndexTargets, qui traite l'éventuel `[index]` restant.
function rewriteCallRoots(str: string): string {
  let result = ''
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = skipQuotedSpan(str, i)
      result += str.slice(i, end)
      i = end
      continue
    }
    const head = /^[a-zA-Z_$][\w$]*/.exec(str.slice(i))
    if (head && str[i + head[0].length] === '(') {
      const end = balancedSpan(str, i + head[0].length)
      if (end !== -1) { result += head[0] + '.__'; i = end; continue }
    }
    result += ch
    i++
  }
  return result
}

// extractDestructuredNames — noms SIMPLES liés par un motif de déstructuration DÉJÀ déclaré
// (`{w, h} := f()` / `[a, b] := t` / clé renommée `{x: w}` / défaut `{w = 1}` / reste `{...r}` /
// clé chaîne `{'a-b': w}`) : mêmes règles que la promotion d'un motif NU plus bas dans la Pass 4
// (bandeau détaillé sur memberRe/dottedRe/rewriteIndexTargets/rewriteCallRoots juste avant son
// utilisation) — clés, `...`, accès indexé et toute cible MEMBRE (sigil $/$$/§/§§/@, chemin
// pointé) exclus. Sert à ENREGISTRER (jamais réécrire) les noms qu'un `:=`/`.=` vient de lier,
// pour qu'une réaffectation PLUS BAS (`w = 10`) les voie déjà déclarés au lieu de les repromouvoir
// en `.=` — sinon Civet émet `const {w,h} = f()` PUIS `let w = 10` dans le MÊME scope :
// « Identifier 'w' has already been declared ».
function extractDestructuredNames(pattern: string, reserved: Set<string>): string[] {
  const keyless  = rewriteIndexTargets(rewriteCallRoots(pattern.replace(/\[[^\[\]]*\]\s*:/g, '').replace(/[a-zA-Z_]\w*\s*:/g, '').replace(/\.\.\./g, ' ')))
  const memberRe = /(?<![\w$§@])(\$\$?|§§?|@)\.?([a-zA-Z_]\w*)/g
  const dottedRe = /(?<![\w$§@.])[a-zA-Z_µ][\w$]*(?:\s*\.\s*[a-zA-Z_]\w*)+/g
  return [...keyless.replace(dottedRe, '').replace(memberRe, '').matchAll(/(?<![\w$§@.])[a-zA-Z_]\w*/g)]
    .map(mm => mm[0]).filter(nm => !reserved.has(nm))
}

// Helpers PARAMÈTRES de fonction : la Pass 4
// n'enregistrait JAMAIS les paramètres d'une fonction (`(tmp) ->`) dans le scope qu'elle ouvre —
// trou PRÉEXISTANT (`f = (tmp) ->\n  tmp = 5` cassait déjà sur HEAD, même message), juste
// rendu visible par ce correctif sur un motif de déstructuration. Réutilisent le parcours équilibré de
// balancedSpan/skipQuotedSpan (chaînes sautées, valeurs par défaut et motifs déstructurés compris).
function outermostParenSpans(str: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(str, i); continue }
    if (ch === '(') {
      const end = balancedSpan(str, i)
      if (end === -1) { i++; continue }
      spans.push({ start: i, end })
      i = end
      continue
    }
    i++
  }
  return spans
}

function splitTopLevelCommas(str: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    // Commentaire sauté AVANT le test regex (cf. skipCommentSpan)
    const cs = skipCommentSpan(str, i)
    if (cs !== -1) { i = cs; continue }
    // Même garde que balancedSpan : virgule DANS un littéral regex
    // (`/a,b,c/`) n'est jamais un séparateur de paramètres
    if (ch === '/' && opensRegex(str.slice(0, i))) {
      const end = scanRegexLiteral(str, i)
      if (end !== -1) { i = end; continue }
    }
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(str, i); continue }
    if (ch === '[' || ch === '{' || ch === '(') { depth++; i++; continue }
    if (ch === ']' || ch === '}' || ch === ')') { depth--; i++; continue }
    if (ch === ',' && depth === 0) { parts.push(str.slice(start, i)); i++; start = i; continue }
    i++
  }
  parts.push(str.slice(start))
  return parts
}

function firstTopLevelEquals(str: string): number {
  let depth = 0
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    // Commentaire sauté AVANT le test regex (cf. skipCommentSpan)
    const cs = skipCommentSpan(str, i)
    if (cs !== -1) { i = cs; continue }
    // Même garde : `=` DANS un littéral regex n'est jamais le séparateur
    // nom/valeur par défaut
    if (ch === '/' && opensRegex(str.slice(0, i))) {
      const end = scanRegexLiteral(str, i)
      if (end !== -1) { i = end; continue }
    }
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(str, i); continue }
    if (ch === '[' || ch === '{' || ch === '(') { depth++; i++; continue }
    if (ch === ']' || ch === '}' || ch === ')') { depth--; i++; continue }
    if (ch === '=' && depth === 0) return i
    i++
  }
  return -1
}

// Noms de variables à enregistrer depuis une liste de paramètres (`tmp` / `a, b = 1, {c, d},
// ...rest`…) : valeur par défaut retirée (premier `=` de premier niveau), `...` retiré, morceau
// `@prop` ignoré (propriété this, PAS une variable — `(@x) ->` n'enregistre jamais `x`), morceau
// déstructuré (`{…}`/`[…]`) → tous ses identifiants hors clé (`clé:`) et hors mot réservé.
function extractParamNames(paramsSrc: string, reserved: Set<string>): string[] {
  const names: string[] = []
  for (const raw of splitTopLevelCommas(paramsSrc)) {
    const piece = raw.trim()
    if (piece === '' || piece.startsWith('@')) continue
    const eqIdx = firstTopLevelEquals(piece)
    const core  = (eqIdx === -1 ? piece : piece.slice(0, eqIdx)).replace(/\.\.\./g, '').trim()
    if (core === '') continue
    if (core[0] === '{' || core[0] === '[') {
      const inner = core.slice(1, -1).replace(/[a-zA-Z_]\w*\s*:/g, '')
      for (const mm of inner.matchAll(/[a-zA-Z_]\w*/g)) { if (!reserved.has(mm[0])) names.push(mm[0]) }
    } else if (/^[a-zA-Z_]\w*$/.test(core) && !reserved.has(core)) {
      names.push(core)
    }
  }
  return names
}

// La Pass 4 plus bas n'enregistrait les PARAMÈTRES d'une fonction
// que si son groupe `(…)` tenait sur l'UNIQUE ligne finissant par `->`/`=>` : une liste étalée sur
// PLUSIEURS lignes (`f = (\n  a,\n  b = 1\n) ->`) ne laisse voir devant la flèche que le `)` de
// fermeture, seul — `outermostParenSpans(')')` ne rend aucun span, `a`/`b` jamais enregistrés, puis
// réassignés dans le corps comme des variables NEUVES (Civet refuse : « Identifier 'a' has already
// been declared »), et la valeur par défaut (`b = 1`, ligne de continuation) se fait hisser en
// `.= undefined` fantôme comme une affectation de branche. `parenDeltaOutsideStrings` (delta `(`/`)`
// hors chaînes/regex/commentaire, même garde que balancedSpan) repère ces listes AVANT la boucle
// principale (cf. pré-passe `multiLineParams` plus bas) : continuation rendue inerte, fermeture
// mémorisée avec l'indentation de la ligne D'OUVERTURE, jamais celle de la fermeture.
// Un COMMENTAIRE sur une ligne de continuation
// d'une liste multi-lignes (`f = (\n  a,\n  // commentaire\n  b\n) ->`) faisait échouer la jonction
// plus bas : `joined` recollait les lignes BRUTES, commentaire compris, et `//` s'y faisait prendre
// pour un littéral regex VIDE par `balancedSpan`/`outermostParenSpans` (`opensRegex` vrai après
// une virgule) — le texte du commentaire ensuite scanné comme du CODE (apostrophe française →
// chaîne jamais refermée jusqu'à la fin de `joined`, ou parenthèse isolée → compte dépareillé).
// `withoutTrailingComment` retire ce commentaire de fin de ligne (scanner UNIQUE, réutilisé par
// `parenDeltaOutsideStrings` ci-dessous ET par la pré-passe `multiLineParams` plus bas).
// `withoutTrailingComment` ne connaissait que `//` :
// un commentaire de BLOC `/* … */` (mono-ligne OU multi-lignes, issu d'un `###…###` Coffee converti
// par la Pass 1) sur cette même ligne de continuation subissait EXACTEMENT le même sort qu'un `//`
// non traité — avalé comme un littéral regex par `scanRegexLiteral` (refermé sur le `/` de `*/`),
// pièce garbage jetée en silence par `extractParamNames`. `withoutTrailingComment` devient
// `noComments` (MULTI-LIGNES, retire aussi `/* … */`, remplacé par un espace pour ne jamais
// recoller deux jetons) — mêmes deux appelants, et réutilisée par les 4 scanners (balancedSpan,
// splitTopLevelCommas, firstTopLevelEquals, parenDeltaOutsideStrings) via le helper partagé
// `skipCommentSpan` posé plus haut à côté de `skipQuotedSpan`.
function noComments(src: string): string {
  let out = ''
  for (const [kind, start, end, depth] of scriptSpans(src)) {
    if (kind !== SPAN.COMMENT || depth > 0) out += src.slice(start, end)
    else if (src[start + 1] === '*') out += ' '
  }
  return out
}

// blankComments — variante de noComments qui CONSERVE la longueur et les indices de
// ligne/colonne : `noComments` ci-dessus
// SUPPRIME un `//` (rien émis) et REMPLACE un `/* … */` par UN SEUL espace (peu importe sa taille)
// — la position des caractères qui suivent GLISSE, illisible pour une passe qui doit ensuite
// RÉÉCRIRE la ligne D'ORIGINE à un index précis. Ici, chaque caractère de commentaire devient UN
// ESPACE (les `\n` internes à un bloc multi-lignes restent des `\n`, jamais blanchis) : même
// parcours que `noComments` (chaînes via `skipQuotedSpan`, regex via `opensRegex`/
// `scanRegexLiteral`, `//`/`/* … */` reconnus par `skipCommentSpan`), mais
// `blankComments(s).length === s.length` et le découpage par `\n` tombe sur le MÊME nombre
// de lignes — la Pass 4 plus bas DÉTECTE sur le texte blanchi et RÉÉCRIT sur la ligne brute, index
// par index. `noComments` reste inchangée pour ses appelants existants (parenDeltaOutsideStrings,
// région jointe de `multiLineParams`) : deux besoins différents, deux fonctions.
function blankComments(src: string): string {
  let out = ''
  for (const [kind, start, end, depth] of scriptSpans(src)) out += kind === SPAN.COMMENT && depth === 0 ? src.slice(start, end).replace(/[^\n]/g, ' ') : src.slice(start, end)
  return out
}

// les parenthèses de la ligne, hors des chaînes, des regex et des commentaires (plages du lecteur du script)
function parenDeltaOutsideStrings(line: string): number {
  let delta = 0
  for (const [kind, start, end, depth] of scriptSpans(line)) {
    if (kind !== SPAN.CODE || depth > 0) continue
    for (let k = start; k < end; k++) {
      if (line[k] === '(') delta++
      else if (line[k] === ')') delta--
    }
  }
  return delta
}

// ----------------------------------------------------------------------------
// applyCivetDialectSugar — sous-ensemble d'applyMjsSugarToScript : UNIQUEMENT les
// passes de dialecte Coffee/Civet des composants (commentaires `#`, `for…in`→`for…of`,
// `isnt`, interpolation `"#{}"`, auto-déclaration scope-aware des assignations nues) —
// AUCUNE transformation de symbole MJS ($x/@x/§/µ-runes, store µ$X, routage
// µ.emit→@_mjs_emit…), qui exigent un composant réactif (this, µ.state, template)
// absent d'un fichier serveur. Extraite pour réutilisation par `mjs ws` (compilation
// des `*.server.mjs`, cf. cli/server-entry.ts compileServerFile) SANS dupliquer cette logique :
// SOURCE UNIQUE — applyMjsSugarToScript l'appelle ci-dessous pour son propre usage
// composant (comportement 100% inchangé, cf. tests existants sur applyMjsSugarToScript).
// ----------------------------------------------------------------------------
// `firstLine` : la ligne du fichier où tombe la première ligne de `src` (la balise <script>), pour citer une faute à sa ligne réelle
// `passe` : chaque déclaration que la passe de déclaration pose (ligne, noms), vérifiée ensuite par l'arbre de Civet
// `commentaires` : les commentaires du script sous la lecture par l'arbre (reader/script.ts, ScriptComments) ; le
// balayeur ci-dessous par défaut
export function applyCivetDialectSugar(src: string, lang?: string, predeclared?: string[], firstLine = 1, declares?: Set<string>, pass?: PassDeclarations, comments: ScriptComments = 'scanner'): string {
  let out = src

  // ─── Pass 1 : conversion `#` Coffee comment → `//` JS comment ─────────────
  // Sauf cible Coffee ou champ privé `#identifier`. Civet/TS/JS parsent `# foo`
  // comme `this.length(foo)` — erreur runtime garantie. Cette pass DOIT
  // précéder transformCodeOnly puisque celui-ci s'appuie sur `//` JS comments.
  //
  // Scan caractère-par-caractère (PAS une regex `^...#` limitée au début de
  // ligne) : un commentaire `#` INLINE après du code (`$x = 'ds'  # note`)
  // était sinon laissé tel quel → Civet le compilait en JS valide mais FAUX
  // (`'ds'(this.length(note))`) sans aucune erreur. On convertit donc `#` et
  // `###` en commentaires JS partout, en préservant chaînes, heredocs
  // (`"""`/`'''`), template literals, `//`/`/* */` déjà présents, et les champs
  // privés `#identifier` (et `#!`).
  // Lecture du script par l'arbre (réglage interne, reader/script.ts) : le script d'un composant n'a plus de commentaire, il
  // reste tel quel ; repris, les commentaires que lit le vrai Civet, réécrits à leur position ; un script qu'il ne lit pas
  // sûrement, comme les gestionnaires, les modules et les fichiers serveur, passe par le balayeur ci-dessous
  const byTree = lang !== 'coffee' && lang !== 'js' && lang !== 'ts' ? dialectComments(out, comments) : null
  if (byTree !== null) out = byTree
  else if (lang !== 'coffee') {
    const dialect = lang !== 'js' && lang !== 'ts'
    // les plages du lecteur du script (scriptSpans, lexer) : une chaîne `"…"` ou `'…'` écrite sur plusieurs lignes, un gabarit, une
    // chaîne à trois guillemets gardent leur `#` (du texte, ou une interpolation `#{…}`) ; un commentaire `### … ###` devient
    // `/* … */` (un `*/` de son texte, motif de chemin `src/**/*.json`, devient `*\/`, sinon il refermait le commentaire au milieu ;
    // `####` en ouvre un d'une ligne), un `#` qui n'est pas un nom privé (`#id`, `#!`) devient `//` ; dans une regex étendue
    // `///…///`, un `#` précédé d'un blanc ouvre un commentaire (règle de CoffeeScript), converti en `//`, que Civet y lit ; un `\#`
    // reste un dièse
    let conv = ''
    let read = 0
    for (const [kind, start, end, depth] of scriptSpans(out, dialect)) {
      if (start < read) continue
      if (depth === 0 && kind === SPAN.COMMENT && out[start] === '#') {
        const block = opensHashBlock(out, start)
        const e     = block ? out.indexOf('###', start + 3) : -1
        conv       += block ? '/*' + out.slice(start + 3, e < 0 ? end : e).replace(/\*\//g, '*\\/') + '*/' : '//' + out.slice(start + 1, end)
      }
      else if (depth === 0 && kind === SPAN.REGEX && dialect && out.startsWith('///', start)) {
        const end = endOfHeregex(out, start)
        conv += out.slice(start, end).replace(/(\s)#(?!\{)/g, '$1//')
        read = end
        continue
      }
      else conv += out.slice(start, end)
      read = end
    }
    out = conv
  }

  // un <script lang="js"> ou lang="ts" est du JavaScript ou du TypeScript ordinaire : les passes 2 à 4 (dialecte
  // façon Coffee du Civet) n'y ont pas cours — un paramètre réaffecté y recevait `a .= undefined` (construction
  // refusée sur du code que l'auteur n'a pas écrit), une chaîne `"prix #{n}"` y devenait un gabarit qui évaluait `n`
  if (lang === 'js' || lang === 'ts') return out

  // ─── Pass 2 : `for X in Y` (Coffee values) → `for X of Y` (Civet/JS values).
  // Uniquement sur le CODE (transformCodeOnly évite les strings/comments). SKIP Coffee : `for x in` y parcourt déjà les
  // valeurs, et `for x of` les CLÉS d'un objet — la boucle recevait « 0 », « 1 »… au lieu des éléments.
  if (lang !== 'coffee') {
    out = transformCodeOnly(out, (code) =>
      code.replace(
        /\bfor(\s+(?:[a-zA-Z_]\w*|\{(?:[^{}\n]|\{[^{}\n]*\})*\}|\[(?:[^\[\]\n]|\[[^\[\]\n]*\])*\])(?:\s*,\s*[a-zA-Z_]\w*)?\s+)in(\s+)/g,
        'for$1of$2'
      )
    )
  }

  // ─── Pass 2b : `isnt` (Coffee) → `is not` (que Civet transforme en `!==`).
  // Civet ne connaît PAS `isnt` : il parse `a isnt b` comme l'appel
  // `a(isnt(b))` → `ReferenceError: isnt is not defined` au runtime.
  // Tourne avant la Pass 3 (interpolation) : les `"#{…}"` y sont encore des chaînes `"…"`, dont transformCodeOnly garde
  // le texte et lit le code des `#{…}` (`"#{a isnt b}"` y devient `"#{a is not b}"`). SKIP Coffee : `isnt` natif, et
  // `is not` y = `=== !`.
  //
  // Garde-fou AVANT le remplacement : `isnt` est aussi un identifiant JS valide
  // (nom de variable) — le replace texte aveugle mangerait `$isnt = 5` en
  // `$is not = 5` (ParseError Civet cryptique, « Found: "not" », loin de la
  // vraie faute). Sur les MÊMES segments code-only (même appel
  // transformCodeOnly) : `$isnt` en lecture, ou toute AFFECTATION à `isnt` nu
  // → erreur MJS explicite. L'usage OPÉRATEUR (`a isnt b`) n'est jamais capté
  // (jamais précédé d'un `$`, jamais suivi d'un opérateur d'affectation).
  if (lang !== 'coffee') {
    out = transformCodeOnly(out, (code) => {
      if (/\$isnt\b/.test(code) || /(^|[\n;({,])\s*isnt\s*(=(?!=)|\+=|-=|\*=|\/=|\|\|=|&&=|\?\?=|\+\+|--)/.test(code)) {
        throw new Error(t('transpiler.isnt-identifier-reserved'))
      }
      return code.replace(/\bisnt\b/g, 'is not')
    })
  }

  // ─── Pass 3 : interpolation Coffee `"...#{X}..."` → template `\`...${X}...\``
  // Spécifique aux double-quote strings (cohérent avec Coffee qui n'interpole
  // pas les single-quotes).
  // SKIP Coffee : il interpole `#{}` NATIVEMENT — convertir ici produisait des
  // backticks que Coffee insère VERBATIM comme du JS embarqué → sortie invalide
  // (tout composant coffee migré V1 utilisant l'interpolation était cassé).
  // Scan séquentiel CONTEXTE-AWARE : les `"…"` à l'intérieur de single-quotes,
  // commentaires, template literals ou heredocs `'''` restent intacts — avant,
  // une regex globale corrompait `'voir "#{x}"'` et transformait `"""…#{x}…"""`
  // en triple-backtick (SyntaxError Civet) : la cause racine du « Failed to
  // parse » historique sur les interpolations.
  // conversion partagée avec les expressions du gabarit : convertCoffeeInterpolations (lexer/index.ts)
  // (script Civet ici : JavaScript et TypeScript sont sortis plus haut)
  if (lang !== 'coffee') {
    out = convertCoffeeInterpolations(out, undefined, true)
  }

  // ─── Pass 4 : auto-déclaration scope-aware (mimique Coffee `var`-hoist) ───
  // SKIP pour Coffee (auto-déclare nativement et rejette `.=`).
  if (lang !== 'coffee') {
    // `from`, `of`, `async`, `then` et `when` n'y figurent pas : JavaScript et Civet les acceptent comme noms de variable,
    // ils se déclarent comme les autres (rangés ici, ils restaient sans déclaration : « ReferenceError » à l'exécution)
    const RESERVED = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'unless', 'try', 'catch', 'finally', 'throw',
      'new', 'class', 'extends', 'this', 'super', 'true', 'false', 'null',
      'undefined', 'typeof', 'instanceof', 'in', 'and', 'or', 'not', 'is',
      'isnt', 'function', 'let', 'const', 'var', 'export', 'import',
      'await', 'yield', 'delete', 'void',
    ])
    const lines = out.split('\n')
    // `codeLines` (blankComments, cf. son
    // bandeau plus haut) BLANCHIT les commentaires de tout `out` EN UNE SEULE PASSE (bloc multi-lignes
    // compris) avant que la Pass 4 ne détecte quoi que ce soit dessus : `inertLines`, la pré-passe
    // `multiLineParams` et la boucle principale plus bas lisent TOUTES `codeLines[li]`, jamais
    // `lines[li]` directement, sauf pour la RÉÉCRITURE finale qui vise la ligne D'ORIGINE (mêmes
    // indices, grâce au blanchiment qui préserve la longueur). Invariant vérifié une fois ici : une
    // divergence signale un bug du blanchiment, jamais une entrée utilisateur.
    const codeLines = blankComments(out).split('\n')
    if (codeLines.length !== lines.length) throw new Error('[transpiler] blankComments a changé le nombre de lignes — invariant Pass 4 rompu')
    // Lignes dont le DÉBUT tombe dans une CHAÎNE multi-ligne (template literal
    // ou heredoc) : INERTES pour cette passe — sinon un `foo = bar` à
    // l'intérieur d'une chaîne était réécrit `foo .= bar` (contenu corrompu en
    // silence) et ses `->`/`then` faussaient la pile de scopes.
    // Un bloc `/* … */` (issu d'un `###…###` Coffee,
    // converti par la Pass 1 plus haut) n'était JAMAIS suivi ici : une affectation À L'INTÉRIEUR
    // d'un tel commentaire (`###\n[arr[0], tmp] = x\n###`) était hissée comme du code réel — un
    // commentaire n'est jamais du code.
    // Le remède ci-dessus (`wasBlank`) marquait
    // inerte TOUTE ligne où un bloc `/* … */` OUVRE en tête, qu'il se REFERME ou non sur cette même
    // ligne : un commentaire MONO-ligne en tête (`/* c */ x = 1`) tombait dans le même sac qu'un
    // commentaire étalé sur plusieurs lignes — `x` jamais auto-déclaré, `ReferenceError` au montage.
    // Pire, une liste de paramètres multi-lignes refermée par un commentaire qui se clôt SUR la ligne
    // `) ->` (`b /* x\n  y */) ->`) rendait CETTE ligne de fermeture inerte : son `)` n'était jamais
    // compté par la pré-passe `multiLineParams` plus bas, `depth` ne retombait jamais à 0, la liste
    // entière disparaissait — `a`/`b` hissés en `.= undefined` fantômes. Un commentaire n'est plus une
    // raison de rendre une ligne inerte : c'est `codeLines` (blanchi à espaces, cf. plus haut) qui
    // absorbe désormais les commentaires pour la DÉTECTION ; seule une vraie CHAÎNE multi-lignes
    // (`` ` ``/`"""`/`'''`) encore ouverte à la fin de la ligne précédente reste inerte ici. Le mode
    // `/*` reste SUIVI dans cette IIFE (pour ne pas confondre un guillemet DANS un commentaire avec
    // l'ouverture d'une chaîne) mais ne marque plus jamais de ligne inerte lui-même. La passe finale
    // sur les lignes `//` pures a disparu : une telle ligne, une fois blanchie, est VIDE
    // (`codeLine.trim() === ''`), écartée par la boucle principale AVANT même de consulter
    // `inertLines` — même résultat, un test en moins.
    const inertLines = new Set<number>()
    {
      // ligne inerte : son début tombe dans une chaîne, une regex étendue ou le code d'une interpolation (plages du lecteur du script)
      let line = 0
      for (const [kind, start, end, depth] of scriptSpans(out)) {
        const inert = depth > 0 || kind === SPAN.STRING || kind === SPAN.REGEX
        for (let k = out.indexOf('\n', start); k !== -1 && k < end; k = out.indexOf('\n', k + 1)) {
          line++
          if (inert) inertLines.add(line)
        }
      }
    }
    // pré-passe liste de paramètres MULTI-LIGNES (cf. bandeau
    // `parenDeltaOutsideStrings` plus haut) : une région ouverte par un delta `(`/`)` positif et refermée
    // par une ligne `)…->`/`)…=>` devient une entrée de `multiLineParams` (clé = ligne de FERMETURE,
    // valeur = paramètres joints + indentation de la ligne D'OUVERTURE) ; ses lignes de continuation
    // rejoignent `inertLines`. Une région refermée SANS flèche (appel multi-lignes `foo(\n  a\n)`) ne
    // marque rien — comportement inchangé.
    const multiLineParams = new Map<number, { params: string; openIndent: number }>()
    {
      let openLine = -1
      let depth    = 0
      for (let li = 0; li < lines.length; li++) {
        if (inertLines.has(li)) continue
        // `codeLines[li]` (blanchi, cf. bandeau `codeLines` plus haut)
        // remplace `lines[li]` : un commentaire qui ferme EN COURS de ligne (`y */) ->`) laissait
        // passer un `/` isolé que l'heuristique regex de `parenDeltaOutsideStrings` pouvait à tort
        // apparier plus loin sur la ligne, avalant le `)` réel — le blanchiment retire le risque à la
        // source (plus aucun caractère de commentaire ne subsiste pour l'heuristique).
        const delta = parenDeltaOutsideStrings(codeLines[li])
        if (depth === 0) {
          if (delta > 0) { openLine = li; depth = delta }
          continue
        }
        depth += delta
        if (depth < 0) { depth = 0; openLine = -1; continue }
        if (depth === 0) {
          const trimmedEnd = codeLines[li].replace(/\s+$/, '')
          if (trimmedEnd.endsWith('->') || trimmedEnd.endsWith('=>')) {
            const beforeArrow = trimmedEnd.slice(0, -2).replace(/\s+$/, '')
            if (beforeArrow.endsWith(')')) {
              // `noComments` (remplace `withoutTrailingComment`) tourne
              // sur la région JOINTE en UN seul passage (MULTI-LIGNES) : un `/* … */` qui s'étale sur
              // plusieurs lignes de continuation (`###…###` Coffee) n'était sinon jamais reconnu par un
              // nettoyage LIGNE PAR LIGNE (chaque ligne isolée n'y voyait qu'un `/*` jamais refermé, ou
              // un `*/` jamais ouvert).
              const regionSrc = noComments(lines.slice(openLine, li + 1).join('\n')).split('\n').filter((l) => l.trim() !== '')
              const joinedRaw = regionSrc.join('\n').replace(/\s+$/, '')
              const joined    = joinedRaw.slice(0, -2).replace(/\s+$/, '')
              const spans     = outermostParenSpans(joined)
              const span      = spans[spans.length - 1]
              if (span && span.end === joined.length) {
                const params     = joined.slice(span.start + 1, span.end - 1)
                const openIndent = lines[openLine].length - lines[openLine].trimStart().length
                multiLineParams.set(li, { params, openIndent })
                for (let mi = openLine + 1; mi < li; mi++) inertLines.add(mi)
              }
            }
          }
          openLine = -1
          depth    = 0
        }
      }
    }
    // Seed le scope racine avec les vars déjà déclarées ailleurs (ex: les vars
    // top-level du `<script module>` partagé). Sinon une réassignation comme
    // `current = audio` dans le `<script>` composant est promue à tort en `.=`
    // (let block-scopé) → shadow + TDZ « Cannot access 'current' before
    // initialization » (cas vécu : tuto audio-player, `current` module-scope).
    // piège des branches — un `.=` posé DANS une branche if/else (au lieu du sommet de
    // la portée) déclare un `let` scopé au bloc : la branche sœur retombe sur
    // une var inexistante → ReferenceError. `bodyIndent`/`insertAt` mémorisent
    // où commence le CORPS de chaque portée (racine comprise) : une affectation
    // plus profonde que ce corps est HISSÉE (`pendingHoists`) plutôt que
    // déclarée sur place — if/else/for/switch/when ne poussent pas de portée
    // (cf. plus bas), donc « plus profond que le corps » ⇔ « dans une branche ».
    // `constDeclared` (sous-ensemble de `declared`) : les noms liés par `:=` (constante Civet),
    // jamais ceux liés par `.=` (mutable) — sert plus bas à refuser À LA COMPILATION la
    // réaffectation nue d'un nom const, plutôt que de laisser Civet produire un « TypeError:
    // Assignment to constant variable » seulement à l'exécution. Racine vide : un nom prédéclaré
    // (vars du `<script module>` partagé, d'un handler) n'est jamais connu comme const ICI —
    // le contrôle des gestionnaires (plus haut dans ce fichier) couvre déjà ce cas, sur sa
    // propre liste : les constantes du `<script>` et celles du `<script module>`.
    const scopes: { indent: number; declared: Set<string>; constDeclared: Set<string>; bodyIndent: number | null; insertAt: number | null }[] = [{ indent: -1, declared: new Set(predeclared ?? []), constDeclared: new Set(), bodyIndent: null, insertAt: null }]
    const pendingHoists: { insertAt: number; indent: number; name: string }[] = []
    // Refus IMMÉDIAT d'une constante réaffectée (avec la ligne de la source) seulement quand c'est
    // SÛR : au niveau du corps de la portée, sur une ligne qui n'ouvre à elle seule ni fonction ni
    // bloc. Plus profond (branche, `catch e`, corps d'une méthode `nom(x)` ou d'une `function`, que
    // cette passe ne sait pas reconnaître comme portées) ou à côté d'une fonction écrite en ligne,
    // un homonyme local est possible : le contrôle fait APRÈS compilation sur le JavaScript
    // (const-reassign.ts, portées exactes) tranche alors, sans faux refus.
    let safeLevel = false
    // déclarations posées ici, notées (ligne, noms) pour l'arbre de Civet, qui tranche ce que le texte ne dit pas : champ de
    // classe, bloc `do` ou `then`, corps d'une `function`, première affectation que cette passe ne voit pas
    const notesInPlace: { line: number; names: string[] }[] = []
    const hoistedNotes: { line: number; names: string[] }[] = []
    const safeConstant                                      = (name: string): boolean => safeLevel && scopes[scopes.length - 1].constDeclared.has(name)
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]
      // `codeLine` (blanchi, hissé ici EN TÊTE de boucle) sert à TOUTE
      // détection ci-dessous (vide, motif d'affectation, tête de destructuration, variante en ligne
      // if/unless/else, déclarations explicites, fin de bloc `->`/`=>`/`then`/`do`) ; `line` (brute)
      // ne sert plus qu'à la RÉÉCRITURE finale, par découpe à un index calculé sur `codeLine` — les
      // deux chaînes ont la MÊME longueur, le même index tombe donc au même endroit dans les deux.
      const codeLine = codeLines[li]
      if (codeLine.trim() === '') continue
      if (inertLines.has(li)) continue
      // un commentaire de bloc peut précéder le code SUR la même ligne (`/* c */ x = 1`) : son
      // indentation UTILE est celle du code, pas celle du premier caractère brut de la ligne —
      // `codeLine` blanchi (le commentaire y devient du blanc) donne directement la bonne valeur.
      const indent = codeLine.length - codeLine.trimStart().length
      // Pop les scopes dont l'indent est >= au courant
      while (scopes.length > 1 && scopes[scopes.length - 1].indent >= indent) {
        scopes.pop()
      }
      // 1re ligne du corps de la portée courante (racine comprise) → fige le
      // point de hissage (bodyIndent/insertAt) une fois pour toute la portée
      const topScope = scopes[scopes.length - 1]
      if (topScope.bodyIndent === null) {
        topScope.bodyIndent = indent
        topScope.insertAt = li
      }
      safeLevel = indent <= topScope.bodyIndent && !/->|=>|\b(?:function|class|catch)\b|\)\s*\{/.test(codeLine)
      // affectation COMPOSÉE ou incrément/décrément (`w += 1`, `w++`, `--w`) : jamais reconnue
      // par le motif d'affectation SIMPLE plus bas (son `=` n'y est jamais collé directement au
      // nom) — une réaffectation quand même, soumise à la MÊME garde de constance, restreinte à
      // CETTE portée (pas une ancêtre, cf. bandeau plus bas). Lookbehind qui exclut un `.`/`$`
      // immédiatement avant le nom : une PROPRIÉTÉ (`w.x += 1`) ou un état réactif (`$w += 1`,
      // mécanisme distinct) n'est jamais concerné.
      const compoundRe = /(?<![\w.$])([a-zA-Z_]\w*)\s*(?:\+\+|--|(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])=)|(?:\+\+|--)\s*([a-zA-Z_]\w*)(?![\w$])/g
      let cm: RegExpExecArray | null
      while ((cm = compoundRe.exec(codeLine)) !== null) {
        const compoundName = cm[1] ?? cm[2]
        if (RESERVED.has(compoundName)) continue
        if (safeConstant(compoundName)) {
          throw new Error(t('transpiler.civet-reassignment-constant', { name: compoundName, line: li + firstLine }))
        }
      }
      // "bonus mémoire" — `[^=]`
      // juste après le `\s+` visait à exclure un faux positif du style
      // `nom = = 5` (double `=` espacé) — mais `[^=]` exclut AUSSI le premier
      // caractère d'un `=>` (fat arrow) légitime : `nom = => expr` n'était
      // JAMAIS promu en déclaration `.=`, contrairement à `nom = -> expr` qui
      // fonctionnait très bien (aucun rapport avec `=>` spécifiquement dans le
      // reste de la passe — seul CE garde-fou le bloquait). **Vérifié
      // empiriquement** sur le compilateur Civet réel : sans `.=`, `nom = ...`
      // (les DEUX formes) compile en une assignation NUE `nom = function(){}`
      // sans aucun `var`/`let`/`const` → le module ES généré (toujours strict)
      // lève `ReferenceError: nom is not defined` dès l'exécution — un module
      // qui plante à l'init, pas juste "silencieusement inerte". Fix :
      // `(?:=>|[^=])` — autorise explicitement `=>` en plus de tout caractère
      // qui n'est pas `=`, en gardant l'exclusion originale d'un `=` nu.
      // `\s*` (pas `\s+`) avant ce groupe : `x=5`/`x =5` (collé au signe, espacé
      // avant seulement) sont des affectations tout aussi valides que `x = 5` —
      // exiger un espace les laissait NUES, avec un message trompeur en aval
      // (« nom jamais déclaré », qui ne dit jamais que l'espace en est la cause).
      // Toujours sans capturer `==`/`===`/`>=`/`<=`/`!=` : la position DEVANT ce
      // groupe exige déjà un `=` littéral juste après `(\s*)`, donc `>=`/`<=`/`!=`
      // ne matchent jamais ici (le caractère avant le `=` n'est pas un blanc), et
      // `[^=]` exclut toujours un second `=` nu juste après (`==`/`===`).
      // `[^=>]` (pas `[^=]`) : sans l'exclusion du `>`, une flèche Civet COLLÉE au nom
      // (`queueMicrotask =>`/`x=>y`, sucre d'appel « nom => corps », AUCUNE affectation) voyait
      // son `=` déjà consommé comme signe d'affectation, puis le `>` restant accepté par ce repli
      // (« n'importe quel caractère sauf = ») — la flèche perdait son second caractère (`.=>`),
      // Civet refusait de parser (cas réel : `queueMicrotask =>` suivi d'un bloc indenté).
      // `=>` reste capturable EXPLICITEMENT via l'alternative de gauche quand un ESPACE sépare
      // vraiment le signe d'affectation de la flèche (`nom = => expr`, cf. plus haut).
      const m = codeLine.match(/^(\s*)([a-zA-Z_]\w*)(\s*)=(\s*(?:=>|[^=>]).*)$/)
      if (m) {
        const [, lead, name, sp, rest2] = m
        if (!RESERVED.has(name) && !line.includes(':=') && !line.includes('.=')) {
          const alreadyDeclared = scopes.some(s => s.declared.has(name))
          if (!alreadyDeclared) {
            topScope.declared.add(name)
            // plus profond que le corps de la portée → dans une branche : hisser.
            // sinon, si `rest2` est un `if`/`unless` POSTFIX (pas préfixe : un
            // if-EXPRESSION `x = if a then 1 else 2` garde le `.=` en place,
            // comportement historique inchangé) → même hissage, le `.=` sous
            // postfix produirait le même let-scopé-au-bloc que le piège des branches.
            const startsIfUnless  = /^\s*(?:if|unless)\b/.test(rest2)
            const postfixIfUnless = !startsIfUnless && /\s(?:if|unless)\s/.test(rest2)
            if (indent > topScope.bodyIndent || postfixIfUnless) {
              pendingHoists.push({ insertAt: topScope.insertAt, indent: topScope.bodyIndent, name })
            } else {
              // réécriture par DÉCOUPE de `line` (brute), jamais par
              // concaténation de `lead`/`name`/`sp` (issus de `codeLine`, blanchi) : un commentaire en
              // tête (`/* c */ x = 1`) serait sinon remplacé par du blanc dans la sortie. `posEq` est
              // l'index du `=` dans `codeLine` — le MÊME index tombe sur le `=` de `line` (longueurs
              // identiques, cf. bandeau `blankComments`).
              const posEq = lead.length + name.length + sp.length
              lines[li] = line.slice(0, posEq) + '.=' + line.slice(posEq + 1)
              notesInPlace.push({ line: li, names: [name] })
            }
          } else if (safeConstant(name)) {
            // `name` lié par `:=` (constante) DANS CETTE MÊME portée (pas une ancêtre — même
            // politique que le bundler, « au même niveau » : une fonction imbriquée qui REÇOIT
            // juste une variable externe n'est pas suivie, seul le niveau qui a posé le `:=`
            // l'est). Civet compile `:=` en `const` : réaffecter planterait PROPREMENT mais
            // SEULEMENT à l'exécution (« Assignment to constant variable »), le build restant
            // vert. Refus À LA COMPILATION, message qui nomme l'identifiant, la ligne fautive et
            // la solution.
            throw new Error(t('transpiler.civet-reassignment-constant', { name, line: li + firstLine }))
          }
        }
      } else {
        // Destructuring : `{ a, b } = expr` / `[ a, b ] = expr` → déclaration
        // `.=` (Civet : `.=` → `let { a, b } = expr`). Sans ça Civet émet une
        // réassignation `({a,b} = expr)` à des vars non déclarées → ReferenceError
        // (`left is not defined`). Cas vécu : seek slider audio-player, bind-this.
        // Même fix `=>` que ci-dessus (cohérence, cf. commentaire détaillé).
        // L'ancienne regex `[^={}[\]]*` refusait tout crochet INTERNE au motif :
        // `[arr[0], tmp] = …`, `[$$liste[k], tmp] = …`, `[[a, b], c] = …`, `{a: {b}} = o` ne matchaient
        // PAS DU TOUT → `tmp`/`a`/`b`/`c` jamais déclarés → `ReferenceError` au premier clic, build VERT
        // (mesuré : zéro erreur de compilation). scanPatternHead (parcours équilibré, chaînes sautées,
        // cf. son bandeau plus haut) remplace la regex.
        const dm = scanPatternHead(codeLine)
        if (dm && !line.includes(':=') && !line.includes('.=')) {
          const { lead, pattern, sp } = dm
          // une cible MEMBRE du motif (`$a` état, `$$a` store, `§a`/`§§a` contexte, `@a` this) n'est pas une
          // variable : jamais à déclarer. `[$a, $b] = [$b, $a]` était promu `.=` → Civet émettait `let [$.a, $.b] = …`, JS
          // invalide, « [analyzer] parse error: Unexpected token » sans autre indice. Une `clé:` d'un motif objet n'est pas
          // une cible non plus (`{a: $a} = o`). Le `.` est OPTIONNEL après le sigil : un handler `@click={…}` arrive ici
          // déjà réécrit en pointillé (`$.a`) par une passe antérieure au `<script>` — sondé par exécution, sans ce `.?`
          // le nom après le point (`a`) retombait « bare » et se refaisait promouvoir en `.=` (même bogue, côté handler).
          // En handler, le STORE ($$) ne réécrit PAS en pointillé sigil comme $/§/@ mais
          // directement en `µ.store.x` (`µ` hors de portée de memberRe, jamais capturé) : `store`/`x`, précédés d'un `.`,
          // passaient pour des noms nus et se faisaient promouvoir → `let [µ.store.a, µ.store.b] = […]`, JS invalide,
          // écouteur posé mais cassé au premier clic (muet au build). Tout chemin pointé (`µ.store.a`, `this.a` — sortie
          // de `@a`, `_mjsThis.a` — sortie de `@@a`, `obj.k` déjà déclaré) est une cible MEMBRE, jamais une variable :
          // dottedRe retire le chemin ENTIER (racine comprise) avant l'extraction des noms ; le lookbehind `.` de la
          // regex `names` couvre en plus tout segment qui lui aurait échappé.
          // Un accès INDEXÉ dans le motif (`arr[0]`, `$$liste[k]`, `µ.store.x[k]`, `@items[i]`) n'est
          // ni une clé ni une variable à déclarer : un ACCÈS MEMBRE sur la racine, à un index calculé. rewriteIndexTargets
          // réécrit `racine[index]` en `racine.__` AVANT l'extraction des noms : la racine retombe sous dottedRe/memberRe
          // (cible MEMBRE), le nom lu DANS l'index (`k`, `i`) disparaît avec le crochet — une lecture, jamais une cible.
          // Un `[` précédé de `[`/`{`/`,`/`:`/début/blanc reste un motif IMBRIQUÉ, inchangé (`[[a, b], c]`, `{a: {b}}`).
          // Un REST sur une cible MEMBRE (`...arr[0]`) : les trois points COLLÉS devant
          // `arr` défont le lookbehind `(?<![\w$§@.])` de dottedRe/memberRe (le dernier `.` de `...` vaut comme si `arr`
          // était déjà pointé) → `arr` invisible de dottedRe ET de `names` (jamais déclaré NI reconnu membre) — motif
          // promu `.=` en entier, Civet refuse (`let [first, ...arr[0]] = a` invalide). `...`→blanc AVANT rewriteIndexTargets
          // (et rewriteCallRoots, décrit plus haut) rend la racine à dottedRe ; un `rest` SANS membre
          // (`[a, ...rest] = x`) redevient un nom neuf ordinaire, hissé comme les autres.
          const keyless    = rewriteIndexTargets(rewriteCallRoots(pattern.replace(/\[[^\[\]]*\]\s*:/g, '').replace(/[a-zA-Z_]\w*\s*:/g, '').replace(/\.\.\./g, ' ')))
          const memberRe   = /(?<![\w$§@])(\$\$?|§§?|@)\.?([a-zA-Z_]\w*)/g
          const dottedRe   = /(?<![\w$§@.])[a-zA-Z_µ][\w$]*(?:\s*\.\s*[a-zA-Z_]\w*)+/g
          const idents     = [...keyless.matchAll(memberRe)]
          const dotted     = [...keyless.matchAll(dottedRe)]
          const names      = [...keyless.replace(dottedRe, '').replace(memberRe, '').matchAll(/(?<![\w$§@.])[a-zA-Z_]\w*/g)].map(mm => mm[0]).filter(nm => !RESERVED.has(nm))
          const hasMember  = idents.length > 0 || dotted.length > 0
          // Ne promouvoir en `.=` (déclaration `let {…}=…`) QUE si AUCUNE cible n'est déjà déclarée. Sinon `[a, b] = [b, a]`
          // (swap, toutes déjà déclarées) reste nu (inchangé). Un motif MIXTE (une partie déjà déclarée, une
          // partie neuve — `[x, tmp] = [tmp, x]` avec `x` connu et `tmp` neuf) laissait `tmp` non déclaré (même bogue,
          // `ReferenceError` au clic) : on ne regarde plus « au moins une cible connue » mais CHAQUE nom individuellement —
          // seuls les noms neufs sont déclarés et, au besoin, hissés ; les noms déjà connus ne sont plus jamais retouchés.
          const undeclared = names.filter(nm => !scopes.some(s => s.declared.has(nm)))
          // chaque nom du motif déjà connu DANS CETTE MÊME portée (donc absent d'`undeclared`,
          // et sans passer par un ancêtre — même politique « au même niveau » que la cible
          // simple ci-dessus) est une RÉAFFECTATION : `{w, h} := f()` puis `{w, x} = g()` lié par
          // `:=` refuse de compiler plutôt que de planter au chargement.
          for (const nm of names) {
            if (undeclared.includes(nm)) continue
            if (safeConstant(nm)) {
              throw new Error(t('transpiler.civet-reassignment-constant', { name: nm, line: li + firstLine }))
            }
          }
          if (undeclared.length > 0) {
            for (const nm of undeclared) topScope.declared.add(nm)
            // branche plus profonde que le corps OU motif mixte membre + variable OU motif mixte déclaré/neuf
            // (`[$a, tmp] = …` / `[x, tmp] = […]` avec `x` connu) : hissage individuel par nom, l'affectation reste nue —
            // sinon `.=` sur le motif ENTIER re-déclarerait un nom déjà connu (« Identifier 'x' has already been declared »)
            if (indent > topScope.bodyIndent || hasMember || undeclared.length < names.length) {
              for (const nm of undeclared) pendingHoists.push({ insertAt: topScope.insertAt, indent: topScope.bodyIndent, name: nm })
            } else {
              // même remède que l'affectation simple plus haut : découpe de
              // `line` (brute) à un index calculé sur `codeLine`, jamais de reconstruction depuis
              // `lead`/`pattern`/`sp` (blanchis) qui effacerait un commentaire niché dans le motif.
              const posEq = lead.length + pattern.length + sp.length
              lines[li] = line.slice(0, posEq) + '.=' + line.slice(posEq + 1)
              notesInPlace.push({ line: li, names: [...undeclared] })
            }
          }
        } else if (/^\s*(?:if|unless|else|for|while|switch|when)\b/.test(codeLine) && !line.includes(':=') && !line.includes('.=')) {
          // variante EN LIGNE — `if a then x = 1` / `… else y = 2` sur une
          // seule ligne : le nom après `then`/`else` est une affectation de
          // branche comme les autres, même remède (hissage). Cette branche ne
          // RÉÉCRIT jamais `line` (seul `pendingHoists` reçoit le nom, cf. plus
          // bas) : tester/scanner sur `codeLine`
          // suffit, aucun index à reporter sur la ligne brute.
          const inlineRe = /(?:\bthen\b|\belse\b)\s+([a-zA-Z_]\w*)\s*=(?!=)/g
          let im: RegExpExecArray | null
          while ((im = inlineRe.exec(codeLine)) !== null) {
            const nm = im[1]
            if (RESERVED.has(nm)) continue
            if (!scopes.some(s => s.declared.has(nm))) {
              topScope.declared.add(nm)
              pendingHoists.push({ insertAt: topScope.insertAt, indent: topScope.bodyIndent, name: nm })
            } else if (safeConstant(nm)) {
              // même garde que l'affectation simple, restreinte à CETTE portée : `if a then x = 1`
              // reste une réaffectation, même écrite en ligne après `then`/`else`
              throw new Error(t('transpiler.civet-reassignment-constant', { name: nm, line: li + firstLine }))
            }
          }
        }
      }
      // Enregistre AUSSI les déclarations explicites Civet `IDENT .= expr`
      // et `IDENT := expr` dans le scope courant, sinon une réassignation
      // bare (`IDENT = expr`) dans un scope enfant croit que la var n'est
      // pas déclarée et se promeut à tort en `.=`, créant un shadow qui
      // casse la closure (régression `tuto#etat-brut`).
      const declMatch = codeLine.match(/^(\s*)([a-zA-Z_]\w*)\s*([.:])=/)
      if (declMatch && !RESERVED.has(declMatch[2])) {
        const scopeDecl = scopes[scopes.length - 1]
        scopeDecl.declared.add(declMatch[2])
        // `:=` lie une CONSTANTE (Civet → `const`), `.=` une mutable (`let`) — mémorisé pour
        // refuser plus haut la réaffectation nue d'un nom const (cf. bandeau `constDeclared`)
        if (declMatch[3] === ':') scopeDecl.constDeclared.add(declMatch[2])
        else scopeDecl.constDeclared.delete(declMatch[2])
      }
      // Même chose pour un motif de déstructuration DÉJÀ déclaré (`{w, h} := f()`,
      // `[a, b] := t`, clé renommée, défaut, reste `...`, clé chaîne — cf. bandeau
      // extractDestructuredNames plus haut) : invisible à declMatch ci-dessus (qui n'admet
      // qu'un IDENT nu juste après l'indentation). Sans cet enregistrement, `w`/`a`/`r` du
      // motif restent absents du scope — la même régression que declMatch corrige pour un
      // IDENT simple. Le motif peut s'ouvrir sur SA PROPRE ligne et ne se refermer que plus
      // bas (mise en forme multi-lignes, ex. `{\n  w,\n  h\n} := f()`) : balancedSpan sur la
      // seule `codeLine` ne referme alors jamais rien (fin hors de cette chaîne), le motif
      // entier échappait à l'enregistrement — même bogue que declMatch, non détecté par lui
      // (aucun IDENT nu en tête). On étend la recherche du point d'équilibre aux lignes
      // BLANCHIES suivantes, comme la pré-passe `multiLineParams` plus haut pour une liste de
      // paramètres ; le cas mono-ligne (immédiatement équilibré) n'entre jamais dans la boucle.
      if (codeLine[indent] === '[' || codeLine[indent] === '{') {
        let pattern = codeLine.slice(indent)
        let patEnd  = balancedSpan(pattern, 0)
        for (let lj = li + 1; patEnd === -1 && lj < codeLines.length; lj++) {
          pattern += '\n' + codeLines[lj]
          patEnd   = balancedSpan(pattern, 0)
        }
        const opMatch = patEnd !== -1 ? pattern.slice(patEnd).match(/^\s*([.:])=/) : null
        if (opMatch) {
          const scopeDecl = scopes[scopes.length - 1]
          // même distinction que declMatch ci-dessus pour un IDENT nu : `:=` lie une constante,
          // même déstructurée — `w`/`h` de `{w, h} := f()` refusent une réaffectation nue plus bas
          const isConst = opMatch[1] === ':'
          for (const nm of extractDestructuredNames(pattern.slice(0, patEnd), RESERVED)) {
            scopeDecl.declared.add(nm)
            if (isConst) scopeDecl.constDeclared.add(nm)
            else scopeDecl.constDeclared.delete(nm)
          }
        }
      }
      // Déclarations EXPLICITES `let/const/var IDENT[, {…}, […]]` : sans
      // ça, un `let x` PUIS un `x = 5` plus bas voyait `x` comme non déclaré et
      // le promouvait en `.=` → `let x` + `let x = 5` = « Identifier 'x' has
      // already been declared ». On n'extrait que les cibles AVANT le `=`
      // (`[^=\n]*`) pour ne pas polluer le scope avec les identifiants de la rhs.
      const kwDecl = codeLine.match(/^\s*(?:let|const|var)\b([^=\n]*)/)
      if (kwDecl) {
        for (const nm of kwDecl[1].match(/[a-zA-Z_]\w*/g) ?? []) {
          if (!RESERVED.has(nm)) scopes[scopes.length - 1].declared.add(nm)
        }
      }
      // Nouveau bloc (line finit par `->`/`=>`/`then`/`do`) → push scope enfant
      // `codeLine` (commentaire retiré, cf.
      // `noComments` plus haut) remplace `line` pour CE test ET pour `trimmedEnd`/`beforeArrow`
      // juste en dessous : un `//`/`/* … */` en QUEUE de ligne (`f = (a) -> // note`) faisait échouer
      // `/(?:->|=>|then|do)\s*$/` sur la ligne BRUTE (elle ne finit plus littéralement par `->`) →
      // aucune portée poussée, `a` traité comme une affectation de la portée racine et HISSÉ à tort
      // (`a .= undefined` fantôme) ; un `/* c */` ENTRE les paramètres (`f = (a, /* c */ b) ->`)
      // faussait de même `beforeArrow` plus bas. Les deux tests portent désormais sur la MÊME chaîne
      // nettoyée (la comparaison de longueur `params.end === beforeArrow.length` reste cohérente).
      // `codeLine` n'est plus recalculé ici : c'est
      // désormais la MÊME variable hissée en tête de boucle (`codeLines[li]`, blanchie — cf. son
      // bandeau plus haut), qui couvre en plus les blocs `/* … */` MULTI-LIGNES (`noComments`
      // ne reconnaissait qu'un commentaire ouvert ET refermé sur cette ligne isolée, jamais un bloc
      // ouvert sur une ligne précédente).
      if (/(?:->|=>|then|do)\s*$/.test(codeLine)) {
        // liste de paramètres MULTI-LIGNES (cf. bandeau
        // `parenDeltaOutsideStrings` plus haut) : la portée poussée hérite de l'indentation de la
        // ligne D'OUVERTURE (`multi.openIndent`), jamais de celle de la ligne de fermeture `) ->` —
        // sinon une fermeture indentée au niveau du corps ferait sauter la portée dès sa 1re ligne.
        const multi = multiLineParams.get(li)
        const child = { indent: multi ? multi.openIndent : indent, declared: new Set<string>(), constDeclared: new Set<string>(), bodyIndent: null as number | null, insertAt: null as number | null }
        scopes.push(child)
        if (multi) {
          for (const nm of extractParamNames(multi.params, RESERVED)) child.declared.add(nm)
        } else {
          // PARAMÈTRES de fonction enregistrés dans le scope qu'elle
          // ouvre (cf. bandeau extractParamNames plus haut) : seuls `->`/`=>` ouvrent une liste de
          // paramètres (`then`/`do` jamais). Le groupe `(…)` équilibré collé IMMÉDIATEMENT devant la
          // flèche (blancs tolérés entre `)` et la flèche) est cette liste ; sans parenthèses = aucun
          // paramètre (`k = ->` inchangé).
          const trimmedEnd = codeLine.replace(/\s+$/, '')
          if (trimmedEnd.endsWith('->') || trimmedEnd.endsWith('=>')) {
            const beforeArrow = trimmedEnd.slice(0, -2).replace(/\s+$/, '')
            if (beforeArrow.endsWith(')')) {
              const spans  = outermostParenSpans(beforeArrow)
              const params = spans[spans.length - 1]
              if (params && params.end === beforeArrow.length) {
                for (const nm of extractParamNames(beforeArrow.slice(params.start + 1, params.end - 1), RESERVED)) {
                  child.declared.add(nm)
                }
              }
            }
          }
        }
      }
    }
    // hissage (piège des branches) — dédoublonne (insertAt, nom), regroupe par point
    // d'insertion puis splice en DÉCROISSANT (une insertion plus haute ne
    // décale jamais un insertAt plus bas encore en attente) ; les noms d'un
    // même groupe sont insérés ENSEMBLE pour garder leur ordre d'origine
    // Les déclarations se posent sur une ligne existante, pour que les lignes du script restent celles du fichier (positions
    // des erreurs, carte de source) : la ligne vide juste au-dessus, sinon devant la ligne elle-même (`y .= undefined; if …`).
    // Une ligne qu'une passe suivante lit depuis son début (`µ$x = …`, `export`, `import`, `µdebug`, symbole) reçoit encore
    // ses déclarations sur une ligne à elles.
    if (pendingHoists.length) {
      const seen = new Set<string>()
      const byInsertAt = new Map<number, { indent: number; name: string }[]>()
      for (const h of pendingHoists) {
        const key = `${h.insertAt}\0${h.name}`
        if (seen.has(key)) continue
        seen.add(key)
        // nom rendu à l'appelant : le contrôle des noms de variable ne compte pas cette déclaration posée par ModularJS
        declares?.add(h.name)
        const group = byInsertAt.get(h.insertAt) ?? []
        group.push({ indent: h.indent, name: h.name })
        byInsertAt.set(h.insertAt, group)
      }
      for (const at of [...byInsertAt.keys()].sort((a, b) => b - a)) {
        const group  = byInsertAt.get(at)
        const decls  = group.map(h => `${h.name} .= undefined`)
        const indent = ' '.repeat(group[0].indent)
        const head   = lines[at].trimStart()
        const names  = group.map(h => h.name)
        if (at > 0 && lines[at - 1].trim() === '' && !inertLines.has(at - 1)) {
          lines[at - 1] = indent + decls.join('; ')
          hoistedNotes.push({ line: at - 1, names })
        }
        else if (/^[a-zA-Z_]/.test(head) && !/^(?:import|export)\b/.test(head)) {
          const margin = lines[at].length - head.length
          lines[at] = lines[at].slice(0, margin) + decls.join('; ') + '; ' + head
          hoistedNotes.push({ line: at, names })
        }
        else {
          lines.splice(at, 0, ...decls.map(d => indent + d))
          // lignes ajoutées : les déclarations déjà notées plus bas descendent d'autant
          for (const n of [...notesInPlace, ...hoistedNotes]) if (n.line >= at) n.line += decls.length
          names.forEach((name, k) => hoistedNotes.push({ line: at + k, names: [name] }))
        }
      }
    }
    if (pass) {
      for (const n of notesInPlace) pass.inPlace.set(n.line, [...(pass.inPlace.get(n.line) ?? []), ...n.names])
      for (const n of hoistedNotes) pass.hoisted.set(n.line, [...(pass.hoisted.get(n.line) ?? []), ...n.names])
    }
    out = lines.join('\n')
  }

  return out
}

// µconsole (ou `µ.console`) → ouvre le panneau d'inspection. Appel GARDÉ : le panneau n'existe
// qu'en développement (absent des builds de production), la rune n'y fait alors rien. Réécrite sur
// le texte ENTIER, chaînes et commentaires masqués : un argument en chaîne (`µconsole '.panier'`)
// serait sinon séparé du nom par transformCodeOnly. Trois formes :
//   µconsole          → sur CE composant (`_mjsThis` ; hors composant, `<script module>`, sans
//                       sélection plutôt qu'une ReferenceError)
//   µconsole(arg)     → l'argument tel quel : sélecteur, élément, valeur à inspecter, true/false
//   µconsole arg      → forme Civet sans parenthèses : UN argument, chaîne ou chemin (`$$panier.x`)
// Forme de sortie valable dans tous les dialectes (ni ternaire, absent de Coffee, ni `?.`)
const WORDS_AFTER_RUNE = new Set(['if', 'unless', 'and', 'or', 'then', 'else', 'when', 'for', 'while', 'until', 'not', 'is', 'isnt', 'in', 'of', 'instanceof'])

// la position `at` de la vue masquée (commentaires blanchis) finit-elle l'instruction ? blancs, puis
// fin du texte ou de la ligne, `;`, une fermante, ou un mot de la langue (`µconsole $x if debug`)
function statementEnd(src: string, blanked: string, at: number): boolean {
  let k = at
  while (k < blanked.length && (blanked[k] === ' ' || blanked[k] === '\t')) {
    // un blanc de la vue qui n'en est pas un dans le texte : un second texte (il continue l'instruction,
    // `µconsole 'a' 'b'`) ou un commentaire (il la finit)
    if (src[k] !== ' ' && src[k] !== '\t') return src[k] !== "'" && src[k] !== '"' && src[k] !== '`'
    k++
  }
  if (k >= blanked.length || '\n\r;)]}'.includes(blanked[k])) return true
  const word = /^[A-Za-z_]\w*/.exec(blanked.slice(k, k + 12))
  return !!word && WORDS_AFTER_RUNE.has(word[0])
}

function consoleWithoutParens(src: string, at: number): Error {
  const start = src.lastIndexOf('\n', at - 1) + 1
  const end   = src.indexOf('\n', at)
  return new Error(t('transpiler.console-parentheses', { written: src.slice(start, end === -1 ? src.length : end).trim() }))
}

function rewriteRuneConsole(src: string, lang?: string): string {
  const view = maskNonCode(src, lang ?? 'civet')
  const re   = /(?<![\w$.])µ\.?console(?![\w$])/g
  let output = '', last = 0, m: RegExpExecArray | null
  while ((m = re.exec(view))) {
    const afterName = m.index + m[0].length
    let i = afterName
    while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++
    const c = src[i]
    let end = afterName, arg: string | null = null
    if (view[i] === '(') {
      // parenthèse fermante du même niveau, cherchée sur la vue masquée (une parenthèse dans une
      // chaîne ne compte pas) ; jamais refermée : rien réécrit, le compilateur le dira
      let depth = 0, j = i
      for (; j < view.length; j++) {
        if (view[j] === '(') depth++
        else if (view[j] === ')' && --depth === 0) break
      }
      if (j >= view.length) continue
      arg = src.slice(i + 1, j).trim()
      end = j + 1
    }
    else if (c === '.' || c === '[') continue   // `µ.console.log(…)` : pas la rune
    else if ((c === "'" || c === '"') && i > afterName) {
      // un texte à triples guillemets se refermerait au premier guillemet
      if (src.startsWith(c.repeat(3), i)) throw consoleWithoutParens(src, m.index)
      end = skipQuotedSpan(src, i)
      arg = src.slice(i, end)
    }
    else if (i > afterName && /[$A-Za-z_]/.test(c ?? '')) {
      const token = /^[$\w.]+/.exec(src.slice(i))![0]
      if (!WORDS_AFTER_RUNE.has(token)) { arg = token; end = i + token.length }
    }
    // sans parenthèses, l'argument (ou la rune seule) finit l'instruction : `µconsole foo(1)`,
    // `µconsole @el`, `µconsole $x, 'label'` seraient mal découpés — les parenthèses sont demandées
    if (view[i] !== '(' && !statementEnd(src, view, end)) throw consoleWithoutParens(src, m.index)
    output += src.slice(last, m.index) + (arg ? `(µ.console && µ.console(${arg}))` : "(µ.console && µ.console((typeof _mjsThis != 'undefined' && _mjsThis) || null))")
    last    = end
  }
  return output + src.slice(last)
}

// singletons que déclare un module (`export µ$$X = …` en tête de ligne, hors chaînes et commentaires) : les seuls noms qu'il
// lit en `µ$$X`, dans son code (applyMjsSugarToScript ci-dessous) comme dans une interpolation (le lexeur, option
// `singletons`, que le bundler passe à un module autonome) — une seule lecture, un seul verdict
export function singletonsDeclares(src: string): string[] {
  return [...maskStringsAndComments(src).masked.matchAll(/^[ \t]*export[ \t]+µ\$\$([a-zA-Z0-9_]+)[ \t]*=/gm)].map((m) => m[1])
}

// ----------------------------------------------------------------------------
// applyMjsSugarToScript — préprocessing du script avant compilation langage.
// Reproduit les transformations CoffeeScript de transpiler.rb (µ. routing,
// runes µ$, µ.inspect). Appliquées sur la source brute (Coffee/Civet/TS/JS).
// ----------------------------------------------------------------------------
// ─── `µ$X = …` dans le corps d'une fonction : une ÉCRITURE, lue sur l'arbre du code compilé ───
// applyMjsSugarToScript écrit chaque ligne `µ$X = v` en déclaration, `µ_state.X ??= µ._mjs_univVal(v)` (Civet, JavaScript, TypeScript),
// que CoffeeScript compile en `if (µ_state.X == null) { µ_state.X = … }` ou, valeur rendue, en `µ_state.X != null ? µ_state.X : µ_state.X = …` :
// la première exécutée pose la valeur de départ, les suivantes gardent celle qui est là. Celle que l'arbre place dans le corps d'une
// fonction (méthode, flèche, rappel, `µeffect`, `µafter`, champ de classe) devient une écriture, `µ_state.X = µ._mjs_univVal(v)`, faite
// à chaque appel, quel que soit l'appelant ; le niveau du script (sous un `if`, un `for`, un `try`, dans un bloc, quel que soit le
// retrait des lignes, bloc `do` de Civet) et une fonction appelée là où elle est écrite (`(() => { … })()`, `do ->` et liste en
// compréhension de CoffeeScript), qui court en même temps que lui, gardent la déclaration. Les lignes restent celles du texte compilé ; un texte que l'arbre ne lit pas
// reste tel quel
export function writesInFunctions(js: string): string {
  if (!js.includes('µ._mjs_univVal(')) return js
  // `µ_state.X` : le nom X, sinon null
  const stateName = (n: any): string | null => n?.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === 'µ_state' && n.property.type === 'Identifier' ? n.property.name : null
  // la garde de CoffeeScript, `µ_state.X == null` (ou `!=`)
  const guard = (n: any, op: string, name: string): boolean => n?.type === 'BinaryExpression' && n.operator === op && stateName(n.left) === name && n.right.type === 'Literal' && n.right.value === null
  // un ancêtre fonction, sauf une fonction appelée là où elle est écrite (`f()`, `f.call(this)`) ; un générateur ne court qu'à son
  // premier `next()`
  const inFunction = (anc: any[]): boolean => {
    for (let i = anc.length - 2; i >= 0; i--) {
      const a = anc[i]
      if (a.type === 'PropertyDefinition' && !a.static && a.value === anc[i + 1]) return true
      if (a.type !== 'FunctionDeclaration' && a.type !== 'FunctionExpression' && a.type !== 'ArrowFunctionExpression') continue
      const p      = anc[i - 1]
      const called = !a.generator && ((p?.type === 'CallExpression' && p.callee === a) || (p?.type === 'MemberExpression' && p.object === a && !p.computed && /^(?:call|apply)$/.test(p.property.name) && anc[i - 2]?.type === 'CallExpression' && anc[i - 2].callee === p))
      if (!called) return true
    }
    return false
  }
  const patches: [number, number, string][] = []
  try {
    walk.ancestor(acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowImportExportEverywhere: true, allowAwaitOutsideFunction: true }), {
      CallExpression(n: any, _walkState: unknown, anc: any[]) {
        const f = n.callee
        if (f.type !== 'MemberExpression' || f.computed || f.object.type !== 'Identifier' || f.object.name !== 'µ' || f.property.name !== '_mjs_univVal' || n.arguments.length !== 1 || !inFunction(anc)) return
        const a    = anc[anc.length - 2]
        const name = a?.type === 'AssignmentExpression' && a.right === n ? stateName(a.left) : null
        if (!name) return
        if (a.operator === '??=') {
          const op = js.indexOf('??=', a.left.end)
          patches.push([op, op + 3, '='])
          return
        }
        if (a.operator !== '=') return
        const [g, block, ifNode] = [anc[anc.length - 3], anc[anc.length - 4], anc[anc.length - 5]]
        if (g?.type === 'ConditionalExpression' && g.alternate === a && guard(g.test, '!=', name)) patches.push([g.start, a.start, '('], [a.end, a.end, ')'])
        else if (g?.type === 'ExpressionStatement' && block?.type === 'BlockStatement' && block.body.length === 1 && ifNode?.type === 'IfStatement' && ifNode.consequent === block && !ifNode.alternate && guard(ifNode.test, '==', name)) patches.push([ifNode.start, block.start, ''])
      }
    })
  }
  catch {
    return js
  }
  for (const [start, end, text] of patches.sort((x, y) => y[0] - x[0])) js = js.slice(0, start) + text + js.slice(end)
  return js
}

export function applyMjsSugarToScript(src: string, lang?: string, predeclared?: string[], sectionLabel = '<script>', firstLine = 1, declares?: Set<string>, pass?: PassDeclarations, component = false, comments: ScriptComments = 'scanner'): string {
  // `µafter (d), fn` et ses sœurs (une espace avant la parenthèse, puis une virgule) : refusées dans le <script> d'un composant en Civet
  // ou en CoffeeScript, où elles se lisent de deux façons (generator/utils.ts) ; un script en JavaScript ou en TypeScript lit sa parenthèse
  // comme celle de l'appel. Ligne citée : `firstLine` est celle de la balise <script>, où tombe la première ligne de `src`
  if (component && lang !== 'js' && lang !== 'ts') commaParenSpaceReject(src, lang === 'coffee', false, (i) => firstLine + src.slice(0, i).split('\n').length - 1)
  // Sigil store CANONIQUE `µ$$X` / `$$X` : on DOUBLE le `$` de la variable
  // réactive (`µ$X`/`$X`). Même mécanisme runtime que `µ$` (universal state
  // partagé via `µ.state`), sigil distinct pour signaler la sémantique « store ».
  //   1. `export µ$$X = expr` → `export µ$X = expr` (route vers la déclaration
  //      universelle qui crée le proxy + l'export `$X`). Doit tourner AVANT la
  //      passe « Runes µ$ » (qui traite `export µ$X`).
  //   2. Toute autre occurrence `µ$$X` → `$X` (lecture du proxy exporté) SI `X`
  //      a été déclaré via `export µ$$X` PLUS HAUT dans ce MÊME source ;
  //      sinon erreur `singleton-sans-import`. Ce chemin (module autonome,
  //      `_compileScriptModuleInner` via bundler/index.ts) ne passe PAS par la
  //      pré-passe 0-bis de `transpile()` (qui connaît les `@import`) — un
  //      module ne peut de toute façon PAS importer de singleton (interdit,
  //      cf. bundler/index.ts) : la SEULE source légitime d'un `µ$$X` ici est
  //      donc sa propre déclaration `export µ$$X`, recollectée ICI pour
  //      recréer la même garantie qu'en 0-bis (ferme le même trou « µ$$Inconnu
  //      glisse en $Inconnu en silence »).
  // Le `$$X` NU (sans µ, en template/script) est géré dans le lexer (≡ `$X`).
  // MIROIR du fix 0-bis
  // de `transpile()` : ce chemin (module autonome `.module.civet`, PAS de HTML,
  // que du script) ne masquait RIEN — une chaîne/un commentaire qui mentionne
  // `µ$$X` en exemple était réécrit en silence ou faisait throw à tort. Même
  // remède, sans le volet HTML (absent ici) : masquer chaînes/commentaires
  // (maskStringsAndComments), réécrire, restaurer.
  const { masked: maskedForExports, restore: restoreExports } = maskStringsAndComments(src)
  const singletonExports = new Set(singletonsDeclares(src))
  // l'objet d'un magasin (`export µ$$X`) remplacé dans son fichier (`µ$X = …`, `µ$$X = …`, `µ$X ||= …`) : `µ$$X`, que lisent les
  // composants, garderait l'ancien objet (l'export n'est pas refait), une ligne `µ$X = …` seule ne remplace rien (`?=`) et `µ$$X = …`
  // dans une fonction n'écrit qu'une variable locale du même nom — refusé, l'objet se change sur place, clé par clé. La déclaration
  // du magasin (`export µ$$X = …`) reste permise
  for (const m of maskedForExports.matchAll(/(?<![\w$.])µ\$(\$?)([a-zA-Z0-9_]+)[ \t]*(?:\*\*|<<|>>>|>>|&&|\|\||\?\?|[-+*\/%&|^?])?=(?![=>])/g)) {
    if (m[1] && /^[ \t]*export[ \t]+$/.test(maskedForExports.slice(maskedForExports.lastIndexOf('\n', m.index) + 1, m.index))) continue
    if (singletonExports.has(m[2])) throw new Error(t('transpiler.store-object-replaced', { name: m[2], written: `µ$${m[1]}${m[2]}`, line: firstLine + restoreExports(maskedForExports.slice(0, m.index)).split('\n').length - 1 }))
  }
  // `µ$X++`, `--µ$X` remplacent l'objet de même (par un nombre) : même refus, la forme écrite citée ; un champ (`µ$X.n++`) reste permis
  for (const m of maskedForExports.matchAll(/(?<![\w$.])µ\$(\$?)([a-zA-Z0-9_]+)[ \t]*(\+\+|--)|(\+\+|--)[ \t]*µ\$(\$?)([a-zA-Z0-9_]+)(?![\w$]|[ \t]*(?:\?\.|\.|\[))/g)) {
    const name = m[2] ?? m[6]
    if (singletonExports.has(name)) throw new Error(t('transpiler.store-object-replaced', { name: name, written: `µ$${m[1] ?? m[5]}${name}`, shape: m[3] ? `µ$${m[1]}${name}${m[3]}` : `${m[4]}µ$${m[5]}${name}`, line: firstLine + restoreExports(maskedForExports.slice(0, m.index)).split('\n').length - 1 }))
  }
  let maskedOut = maskedForExports.replace(
    /^([ \t]*)export[ \t]+µ\$\$([a-zA-Z0-9_]+)([ \t]*=)/gm,
    '$1export µ$$$2$3'
  )
  maskedOut = maskedOut.replace(/µ\$\$([a-zA-Z0-9_]+)/g, (_m: string, name: string) => {
    if (singletonExports.has(name)) return '$' + name
    throw new Error(t('transpiler.singleton-no-import', { name: name }))
  })
  let out = restoreExports(maskedOut)

  // dialecte Coffee/Civet des composants (commentaires #, for…in→of, isnt,
  // interpolation "#{}", auto-déclaration scope-aware) — cf. applyCivetDialectSugar
  // ci-dessus, SOURCE UNIQUE partagée avec `mjs ws` (fichiers *.server.mjs).
  out = applyCivetDialectSugar(out, lang, predeclared, firstLine, declares, pass, comments)

  // ─── Runes µ$ ASSIGNEMENT (statement-level) — chaînes/commentaires masqués D'ABORD ───
  // Ces deux regex line-anchored réécrivent une LIGNE COMPLÈTE `µ$X = expr` (ou
  // `export µ$X = …`) dont la rhs peut CONTENIR une chaîne : transformCodeOnly
  // isolerait cette chaîne dans un chunk distinct (rhs tronquée), d'où l'application sur le texte
  // entier plutôt que via transformCodeOnly. Mais SANS masquage, une ligne `µ$x = 5` simplement
  // CITÉE dans une chaîne (gabarit multi-ligne affiché en exemple de doc) est une ligne comme une
  // autre pour un motif `^…$` : elle était réécrite en code réel, build vert, texte affiché
  // corrompu. Même remède que la passe sœur µ$$X plus haut (maskStringsAndComments) : une chaîne,
  // MÊME multi-ligne, s'efface en UN placeholder compact avant les deux regex — restauré à
  // l'identique en sortie, y compris quand il finit dans le rhs du code généré (`µ$X = 'texte'`).
  const { masked: maskedForDollar, restore: restoreDollar } = maskStringsAndComments(out)
  // commentaire de ligne en fin d'expression (`µ$n = 0  # compteur`) : laissé après la réécriture, sinon restauré dans
  // `µ.state(…)` il avale la `)` et le reste de la ligne
  const withoutTrailingComment = (rhs: string): [string, string] => {
    const m = /^(.*?\S)([ \t]+\x00MJSSTR\d+\x00)$/.exec(rhs)
    if (!m || !/^(?:\/\/|#(?!##))/.test(restoreDollar(m[2].trimStart()))) return [rhs, '']
    return [m[1], m[2]]
  }
  let maskedDollarOut = maskedForDollar
  if ((lang ?? 'civet') === 'civet' && pass) {
    // Civet, lu ensuite par son arbre : seule la tête est réécrite ici, `µ$X =` comme `export µ$X =` en `µ_state.X ?= `, notée à
    // sa ligne ; la valeur, telle que Civet la lit (sur la ligne, écrite dessous en retrait, liste ou objet sur plusieurs lignes,
    // suite en `.`), est entourée de `µ._mjs_univVal(…)` (`µ.state(…)` pour l'export) dans l'arbre (wrapsStates), suivie pour l'export de `export var $X = µ_state.X`,
    // relu par le getter de `µ_state` comme sur une ligne
    let line        = 0
    let read        = 0
    maskedDollarOut = maskedForDollar.replace(/^([ \t]*)(export[ \t]+)?µ\$([a-zA-Z0-9_]+)[ \t]*=(?!=)[ \t]*/gm, (head: string, indent: string, exported: string | undefined, name: string, pos: number) => {
      line         += restoreDollar(maskedForDollar.slice(read, pos)).split('\n').length - 1
      read          = pos
      const emitted = `µ_state.${name} ?= `
      pass.states.set(line, { target: `µ_state.${name}`, before: head.slice(indent.length), emitted: emitted, after: exported ? `; export var $${name} = µ_state.${name}` : '' })
      return indent + emitted
    })
  }
  else {
    //   `export µ$X = expr` → `µ_state.X ?= µ.state(expr); export $X = µ_state.X` (sur la même ligne : les lignes du script
    //   restent celles du fichier) ; la valeur s'écrit sur sa ligne ; en JavaScript et en TypeScript, où ni `?=` ni `export $X =`
    //   n'existent, `µ_state.X ??= µ.state(expr); export var $X = µ_state.X;`, le `;` qui finit la ligne gardé après la valeur
    const isJs = lang === 'js' || lang === 'ts'
    //   valeur sur plusieurs lignes en JavaScript et en TypeScript (`export µ$X = {`, ses champs dessous) : elle court jusqu'à la fin
    //   de la ligne où ses parenthèses, crochets et accolades se referment (chaînes et commentaires masqués), entourée de même, les
    //   lignes gardées ; le commentaire de sa dernière ligne reste après
    if (isJs) {
      let done = ''
      let read = 0
      for (const m of maskedDollarOut.matchAll(/^([ \t]*)export[ \t]+µ\$([a-zA-Z0-9_]+)[ \t]*=[ \t]*/gm)) {
        if (m.index! < read) continue
        const start = m.index! + m[0].length
        let open    = 0
        let end     = start
        for (; end < maskedDollarOut.length && (maskedDollarOut[end] !== '\n' || open > 0); end++) open += '([{'.includes(maskedDollarOut[end]) ? 1 : ')]}'.includes(maskedDollarOut[end]) ? -1 : 0
        const value = maskedDollarOut.slice(start, end).trimEnd()
        if (!value.includes('\n')) continue
        const last             = value.lastIndexOf('\n') + 1
        const [valueEnd, note] = withoutTrailingComment(value.slice(last))
        const pv               = /^(.*?)[ \t]*;$/.exec(valueEnd)
        done                  += maskedDollarOut.slice(read, m.index!) + `${m[1]}µ_state.${m[2]} ??= µ.state(${value.slice(0, last)}${pv ? pv[1] : valueEnd}); export var $${m[2]} = µ_state.${m[2]};${note}`
        read                   = start + value.length
      }
      maskedDollarOut = done + maskedDollarOut.slice(read)
    }
    maskedDollarOut = maskedDollarOut.replace(
      /^([ \t]*)export[ \t]+µ\$([a-zA-Z0-9_]+)[ \t]*=[ \t]*(.+?)[ \t]*$/gm,
      (_m, indent, name, rhs) => {
        const [expr, comment] = withoutTrailingComment(rhs)
        if (!isJs) return `${indent}µ_state.${name} ?= µ.state(${expr}); export $${name} = µ_state.${name}${comment}`
        const pv = /^(.*?)[ \t]*;$/.exec(expr)
        return `${indent}µ_state.${name} ??= µ.state(${pv ? pv[1] : expr}); export var $${name} = µ_state.${name};${comment}`
      }
    )
    //   `µ$X = expr` (sans export) → `µ_state.X ?= µ._mjs_univVal(expr)` (un nombre reste un nombre, mjs_state.ts) ; en JavaScript
    //   et en TypeScript, où `?=` n'existe pas, `µ_state.X ??= µ._mjs_univVal(expr)`, le `;` qui finit la ligne gardé après la valeur
    maskedDollarOut = maskedDollarOut.replace(
      /^([ \t]*)µ\$([a-zA-Z0-9_]+)[ \t]*=[ \t]*(.+?)[ \t]*$/gm,
      (_m, indent, name, rhs) => {
        const [value, comment] = withoutTrailingComment(rhs)
        const pv               = isJs ? /^(.*?)[ \t]*;$/.exec(value) : null
        return `${indent}µ_state.${name} ${isJs ? '??=' : '?='} µ._mjs_univVal(${pv ? pv[1] : value})${pv ? ';' : ''}${comment}`
      }
    )
  }
  out = restoreDollar(maskedDollarOut)

  // ─── Réécritures µ SENSIBLES aux chaînes/commentaires ─────────────
  // µfoo→µ.foo, routage API (µ.on/emit/…), runes µ$ en LECTURE, µdebug,
  // inspect/proxy s'appliquaient jusqu'ici en `.replace` GLOBAL → une
  // chaîne ou un commentaire contenant `µs`, `µ.on`, `µ$x`… était réécrit
  // (corruption silencieuse d'un texte affiché/logué : `'durée 12 µs'` →
  // `'durée 12 µ.s'`). On les passe toutes dans transformCodeOnly (mêmes chunks
  // code-only que les passes 2/2b) : strings/commentaires sautés. À ce stade
  // les commentaires sont déjà en `//`/`/* */` (Pass 1, hors Coffee — que
  // transformCodeOnly sait quand même sauter via son handler `#`). Les runes en
  // ASSIGNEMENT ont déjà tourné ci-dessus (rhs préservée).
  // `µinspect($x.chemin)` d'abord, sur le texte ENTIER : une clé en chaîne (`$x['cle']`) coupait
  // l'appel en morceaux dans transformCodeOnly, qui ne le reconnaissait plus — même réécriture
  // (et même refus d'un chemin invalide) que dans le gabarit, chaînes et commentaires masqués
  // (µminmax, retiré en V3, y est refusé avec la marche à suivre — d'où le second test)
  if (out.includes('inspect') || out.includes('minmax')) out = rewritesOrRejectsRunePath(out)
  // la rune seule (`µconsole`, `µ.console`) : un `console.log` ordinaire ne coûte pas un masquage du script
  if (/µ\.?console/.test(out)) out = rewriteRuneConsole(out, lang)
  out = transformCodeOnly(out, (code) => {
    let c = code
    // µproxy $.path → µ._mjs_makeDeepProxy(_mjsThis, ['path'])
    // Escape hatch manuel pour les cas où le compile-time path
    // tracker ne peut pas détecter l'escape (eval, new Function, dynamic etc.)
    // AVANT le sucre µfoo → µ.foo ci-dessous : passé après, il en faisait `µ.proxy(…)`, absent du runtime (TypeError à
    // l'appel, pour chaque forme)
    c = c.replace(
      /(?<!µ\.)µproxy\s+\$\.([a-zA-Z_$][\w$.]*)/g,
      (_m, path) => {
        const parts = path.split('.').map((p: string) => `'${p}'`).join(', ')
        return `µ._mjs_makeDeepProxy(_mjsThis, [${parts}])`
      }
    )
    // Variante : `µproxy $X`, `µproxy $X.a.b` (chemin entier, comme `µproxy $.X.a.b`) ; une variable du magasin (`$$x`)
    // n'en est pas une
    c = c.replace(
      /(?<!µ\.)µproxy\s+\$([a-zA-Z_][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)/g,
      (_m, path) => {
        const parts = path.split('.').map((p: string) => `'${p}'`).join(', ')
        return `µ._mjs_makeDeepProxy(_mjsThis, [${parts}])`
      }
    )
    // µfoo → µ.foo (sucre universel) — SAUF les runes à compilation LEXER
    // (µread/µwrite → _state brut, hooks µmount & co → _mjs_hook, liste unique
    // sigils.ts) : les pointer ici (`µ.read`, `µ.mount`) les rendait invisibles
    // au lexer qui tourne APRÈS, et indéfinies au runtime (TypeError µ.mount is
    // not a function — découvert à la migration des hooks en runes ;
    // µread/µwrite en <script> étaient cassés pareil depuis leur naissance,
    // seuls les tests unitaires du lexer — hors pipeline — passaient)
    // µevery / µafter du <script> d'un composant (`composant`) : le composant passe en tête de l'appel (sigils.ts)
    if (component) c = componentTimer(c)
    c = c.replace(MU_UNIVERSAL_RE, 'µ.$1')


    // µ.inspect($x) → µ.inspect('x') — corps PARTAGÉ avec cleanJs (sigils.ts,
    // MU_INSPECT_ARG_BODY), même texte des deux côtés.
    c = c.replace(new RegExp(MU_INSPECT_ARG_BODY, 'g'), MU_INSPECT_ARG_OUT)

    // µdebug $x → point d'arrêt RÉACTIF (équivalent de {@debug} de Svelte). Sucre
    // pur : se réécrit en effet qui log la valeur + `debugger;` À CHAQUE changement
    // de $x. Réutilise le même effet que les macros (<@element>/<@head>) → même
    // tracking de dépendances ($x lu dans le corps → re-run au changement).
    // NB : `µdebug` est DÉJÀ devenu `µ.debug` via le sucre universel µfoo→µ.foo
    // (ci-dessus) ; on matche donc `µ.debug` et on génère directement
    // `µ.effect`/`µ.log` (déjà pointés, comme le `µeffect` des macros post-sucre).
    //   µdebug $count   →   µ.effect => µ.log('[µdebug] count =', $count); debugger
    // Sur la même ligne (Civet et CoffeeScript mettent les deux instructions dans le corps de l'effet) : les lignes
    // du script restent celles du fichier.
    // Chemin `\$[\w$.]+` (pas seulement `$ident` simple) : `µdebug $obj.a`
    // devenait `µ.debug($.obj.a)` → TypeError à l'init (`µ.debug` est un booléen).
    c = c.replace(
      /^([ \t]*)µ\.debug[ \t]+\$([a-zA-Z_$][\w$.]*)[ \t]*$/gm,
      (_m, indent, name) => `${indent}µ.effect => µ.log('[µdebug] ${name} =', $${name}); debugger`
    )

    // Routage API instance vers méthodes privées (CoffeeScript : @ = this).
    // En Coffee on garde @_mjs_*. Le langage adapter compilera @ → this.
    //
    // µemit fait EXCEPTION à `@_mjs_*` : `@_mjs_emit` compile en
    // `this._mjs_emit`, et `this` n'est PAS fiable partout (objet utilisateur
    // imbriqué — `helper = { go: -> µemit 'x' }` — appelé `helper.go()` : `this`
    // y vaut `helper`, pas le composant ; rebindDetachedThis laisse SCIEMMENT ce
    // cas, cf. this-rebinding.ts, c'est une méthode réelle d'un objet).
    // `_mjsThis` (capturé en clôture à la construction, cf. template.ts) désigne
    // TOUJOURS le composant, quel que soit le site d'appel — direct en dur, pas
    // via `@`. `<script module>` (aucun `_mjsThis` en scope) refuse µemit à la
    // compilation, cf. lintEmitInModule plus bas — pas de repli runtime ici.
    c = c.replace(/µ\.?\s*emit\b/g, '_mjsThis._mjs_emit')
    // µon, µsetContext / µ.getContext : le composant dont le script les porte (`_mjsThis`), comme `§` — `@` valait l'état
    // dans une fonction rangée dans l'état (`$go = -> µsetContext 'x', 1`, appelée `$go()`). Un module n'a pas de
    // composant : `@` y reste
    const receiver = sectionLabel === '<script module>' ? '@' : '_mjsThis.'
    c = c.replace(/µ\.?\s*on\b/g, receiver + '_mjs_on')
    c = c.replace(/µ\.?\s*setContext\b/g, receiver + '_mjs_setContext')
    c = c.replace(/µ\.\s*getContext\b/g, receiver + '_mjs_getContext')

    // `µ$X` (lecture) → `µ_state.X`
    c = c.replace(/µ\$([a-zA-Z0-9_]+)/g, 'µ_state.$1')
    return c
  }, lang !== 'js' && lang !== 'ts', lang === 'coffee')


  // Si µ_state utilisé, prefix la DÉCLARATION de `µ_state` au top après imports.
  // LANG-AWARE : en Coffee l'assignation nue auto-déclare (`var µ_state`),
  // mais en Civet (défaut) / TS / JS une assignation NUE sort non déclarée →
  // `ReferenceError: µ_state is not defined` au runtime (module ES strict) ET
  // rejet par lintUndeclaredTopLevelAssignment (message trompeur : le dev n'a
  // jamais écrit `µ_state`). On émet donc `.=` (Civet let) ou `let` (js/ts).
  // Garde anti-doublon élargie à `=`/`:=`/`.=`. (`\b` ne marche pas sur `µ`,
  // U+00B5 pas word-char en JS regex.)
  // le `<script>` d'un composant dont le `<script module>` déclare déjà `µ_state` (dans `predeclared`) lit le sien : l'état du magasin
  // quand le module exporte un `µ$X` (`µ.state({})`, propre au fichier), celui de la page sinon (le même objet)
  if (out.includes('µ_state') && !(component && predeclared?.includes('µ_state')) && !/^\s*µ_state\s*[:.]?=\s*(?:\(µ\._mjs_univ \?\??= )?µ\.state/m.test(out)) {
    const lines = out.split('\n')
    let insertAt = 0
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*import\b/.test(lines[i])) insertAt = i + 1
      else if (lines[i].trim() !== '') break
    }
    // un seul état pour toute la page, posé sur `µ` par le premier script qui l'emploie : composants (chaque exemplaire) et
    // modules y lisent le même objet `µ$x`, et une écriture faite par l'un se voit chez tous ceux qui le tiennent ; un fichier
    // qui exporte un magasin (`export µ$$x`, ou `export µ$x` qu'en fait la passe du composant) garde le sien, que deux magasins
    // du même nom dans deux fichiers ne se confondent pas
    const state = !component && /^[ \t]*export[ \t]+µ\$\$?[a-zA-Z0-9_]+[ \t]*=/m.test(maskedForExports) ? 'µ.state({})'
               : lang === 'coffee'                   ? '(µ._mjs_univ ?= µ.state({}))'
               :                                       '(µ._mjs_univ ??= µ.state({}))'
    // en JavaScript et en TypeScript, la ligne finit par `;` : sans lui, une instruction suivante qui commence par `(` ou `[`
    // s'y collerait, et l'état serait appelé comme une fonction
    const decl = lang === 'coffee'              ? `µ_state = ${state}`
               : (lang === 'js' || lang === 'ts') ? `let µ_state = ${state};`
               :                                    `µ_state .= ${state}`
    // sur une ligne existante (les lignes du script restent celles du fichier) : la ligne vide où elle irait, sinon devant
    // la ligne elle-même (un nom, ou un `µ_state.x ?= …` déjà réécrit) ; une autre (symbole, `import`, `export`…) en reçoit
    // une à elle
    const head = insertAt < lines.length ? lines[insertAt].trimStart() : ''
    if (insertAt < lines.length && head === '') lines[insertAt] = decl
    else if (/^(?:[a-zA-Z_]|µ_state\.)/.test(head) && !/^(?:import|export)\b/.test(head)) lines[insertAt] = decl + (decl.endsWith(';') ? ' ' : '; ') + lines[insertAt]
    else {
      lines.splice(insertAt, 0, decl)
      // ligne ajoutée après que la passe de déclaration a noté les siennes : les notes de cette ligne et d'en dessous
      // descendent d'une ligne
      if (pass) shiftsPass(pass, insertAt, 1)
    }
    out = lines.join('\n')
  }

  // µimport('chemin.js') / mjsimport('chemin.js') — PLUS réécrit ICI depuis
  // `import` reste dans MU_SCRIPT_RUNES
  // (sigils.ts) juste au-dessus, donc `µimport(...)` traverse cette fonction
  // et Civet/Coffee tel quel (simple appel de fonction — bonus assumé : la
  // forme Coffee SANS parenthèses `µimport 'x.js'` devient valide, le
  // compilateur Coffee pose les parenthèses lui-même). La réécriture se fait
  // désormais en AVAL, en AST, sur le JS déjà COMPILÉ (rewriteMuImportAst,
  // sigils.ts) — cf. ses appelants (jsInitBase / moduleJs plus bas dans ce
  // fichier, et bundler/index.ts pour les modules .civet/.coffee autonomes).

  return out
}
