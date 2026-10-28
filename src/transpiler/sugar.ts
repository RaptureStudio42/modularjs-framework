// transpiler/sugar — sucres du script, posés avant la compilation par le langage : dialecte Civet (applyCivetDialectSugar)
// et runes µ (applyMjsSugarToScript, µconsole), avec leurs scanners ; appelés par transpileImpl (index.ts)

import { MU_UNIVERSAL_BODY, MU_INSPECT_ARG_BODY, MU_INSPECT_ARG_OUT, ouvreUneRegex, scanRegexLiteral, finExpression } from '../sigils.js'
import { skipQuotedSpan } from '../quoted-span.js'
import { maskNonCode } from './split-rune.js'
import { scanDoubleQuoteAt, convertCoffeeInterpolations } from '../lexer/index.js'
import { reecritOuRejetteRuneChemin } from '../generator/utils.js'
import { t } from '../messages/index.js'
import { maskStringsAndComments } from './lint.js'

// ----------------------------------------------------------------------------
// sucre universel µfoo → µ.foo, MOINS les runes réservées au lexer (cf.
// sigils.ts, MU_SCRIPT_RUNES) ; bâtie UNE fois hors de la fonction. Corps PARTAGÉ
// avec cleanJs (generator/utils.ts, RE_MU_UNIVERSAL_G) — même texte, une seule
// source (sigils.ts) : c'est l'absence de ce partage qui laissait les runes
// minuscules hors liste blanche (µraw/µsnap/µplay/µinspect) littérales
// dans une expression HTML.
const MU_UNIVERSAL_RE = new RegExp(MU_UNIVERSAL_BODY, 'g')

// ----------------------------------------------------------------------------
// transformCodeOnly — hissée au niveau module (ex-closure locale
// d'applyMjsSugarToScript) : réutilisée à la fois par applyCivetDialectSugar
// (Pass 2/2b ci-dessous) et par les réécritures µ sensibles aux chaînes
// d'applyMjsSugarToScript (plus bas) — SOURCE UNIQUE, jamais deux copies.
// ─── Helper : applique une transformation uniquement sur le CODE ──────────
// Scan caractère par caractère en mémorisant si on est dans une string ou
// un commentaire — les transforms ne touchent jamais ces zones. Évite la
// corruption silencieuse des regex globales (ex: `for x in arr` dans une
// string littérale, `#{x}` dans un commentaire, etc.).
function transformCodeOnly(input: string, transform: (codeChunk: string) => string): string {
  const chunks: string[] = []
  let buf = ''
  let i = 0
  const n = input.length
  const flush = () => { if (buf) { chunks.push(transform(buf)); buf = '' } }
  while (i < n) {
    // Comments : préservés tels quels (transforms `#`→`//` et `###`→`/* */`
    //            ont déjà tourné via passes lang-aware ci-dessus).
    if (input[i] === '/' && input[i + 1] === '/') {
      flush()
      const end = input.indexOf('\n', i)
      const stop = end < 0 ? n : end
      chunks.push(input.slice(i, stop))
      i = stop
      continue
    }
    if (input[i] === '/' && input[i + 1] === '*') {
      flush()
      const end = input.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      chunks.push(input.slice(i, stop))
      i = stop
      continue
    }
    if (input[i] === '#' && input[i + 1] !== undefined && !/[a-zA-Z_!]/.test(input[i + 1])) {
      // Coffee line comment (Coffee target uniquement — le mode non-Coffee
      // a déjà converti `#` → `//` plus haut).
      flush()
      const end = input.indexOf('\n', i)
      const stop = end < 0 ? n : end
      chunks.push(input.slice(i, stop))
      i = stop
      continue
    }
    // littéral regex `/…/` : zone inerte, même branche que generator/utils.ts::mapCodeSegments
    // (quatrième scanner « code-only » du compilateur, même règle) — sans ce
    // garde-fou, `re = /µTotal/` ressortait réécrit `re = /µ.Total/` (MU_UNIVERSAL_RE mordait
    // DANS le littéral). `scanRegexLiteral` rend -1 si aucun `/` fermant avant la fin de ligne :
    // ce `/` retombe alors dans le code ordinaire (division), traité plus bas comme avant.
    if (input[i] === '/' && ouvreUneRegex(input.slice(0, i))) {
      const fin = scanRegexLiteral(input, i)
      if (fin !== -1) {
        flush()
        chunks.push(input.slice(i, fin))
        i = fin
        continue
      }
    }
    // Strings : `"..."`, `'...'`, `` `...` `` (template). Respect des escapes.
    const ch = input[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      flush()
      const quote = ch
      // `let`, pas `const` : réassigné plus bas à CHAQUE interpolation d'un
      // template literal (bug réel) —
      // avec un `const start` figé sur l'ouverture du template, la 2e
      // interpolation d'un même literal (`` `${a},${b}` ``) rejouait
      // `input.slice(start, i + 2)` depuis l'ouverture ORIGINALE au lieu de
      // la position courante, dupliquant tout le préfixe déjà flush dans
      // `chunks` (`` `${a},${b}` `` → `` `${a},`${a},${b}` ``, Civet
      // rejetait ensuite le `)` de trop en aval — « Failed to parse »
      // trompeur, loin du vrai point de faute). Fix : `start` suit la tête
      // de lecture (`start = i` juste après avoir flush le texte brut
      // post-interpolation, cf. plus bas) — la 1ère interpolation reste
      // inchangée (start = ouverture du literal, comme avant).
      let start = i
      i += 1
      while (i < n) {
        if (input[i] === '\\') { i += 2; continue }
        if (input[i] === quote) { i += 1; break }
        // Template literal `${...}` : recurse dans l'expression (qui est du code)
        if (quote === '`' && input[i] === '$' && input[i + 1] === '{') {
          // Capture le segment `...${` brut, puis recurse sur l'expression, dont la fin est lue par
          // finExpression : une accolade dans une chaîne ou une regex de l'expression (`${ $a ? '{' : '' }`)
          // ne compte pas. Jamais refermée : le reste est transformé tel quel, sans `}` ajoutée en fin de script
          chunks.push(input.slice(start, i + 2))
          const fin = finExpression(input, i + 1)
          const exprStart = i + 2
          if (fin < 0) {
            chunks.push(transform(input.slice(exprStart)))
            i = n
            start = n
            break
          }
          chunks.push(transform(input.slice(exprStart, fin - 1)))
          chunks.push('}')
          i = fin
          // Continue dans la string template
          const restStart = i
          while (i < n && input[i] !== '`') {
            if (input[i] === '\\') { i += 2; continue }
            if (input[i] === '$' && input[i + 1] === '{') break
            i += 1
          }
          chunks.push(input.slice(restStart, i))
          // Tout ce qui précède `i` est déjà dans `chunks` (texte brut tout
          // juste poussé ci-dessus) : une éventuelle 2e interpolation doit
          // repartir d'ici, pas de l'ouverture du template (cf. commentaire
          // de tête sur `let start`).
          start = i
          if (input[i] === '`') { chunks.push('`'); i += 1; break }
          continue
        }
        i += 1
      }
      if (i > start && !(quote === '`' && chunks[chunks.length - 1] === '`')) {
        chunks.push(input.slice(start, i))
      }
      continue
    }
    buf += ch
    i += 1
  }
  flush()
  return chunks.join('')
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
// 4 scanners ci-dessous comme un LITTÉRAL REGEX (`ouvreUneRegex` vrai après une virgule,
// `scanRegexLiteral` refermé sur le `/` de `*/`) — la pièce de paramètre qui suivait, non séparée
// par une virgule, sortait GARBAGE et se faisait jeter en silence par `extractParamNames`. Posé
// AVANT le test `ouvreUneRegex` dans chaque scanner (même ordre que `sansCommentaires` plus bas et
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
    // span PERDU, `re` jamais enregistré) ; heuristique partagée `ouvreUneRegex`/`scanRegexLiteral`
    // (sigils.ts), même garde que transformCodeOnly plus haut
    // Commentaire `//`/`/* … */` sauté AVANT ce test : sinon un bloc
    // `/* … */` se faisait avaler comme un littéral regex (cf. bandeau skipCommentSpan ci-dessus)
    const cs = skipCommentSpan(str, i)
    if (cs !== -1) { i = cs; continue }
    if (ch === '/' && ouvreUneRegex(str.slice(0, i))) {
      const fin = scanRegexLiteral(str, i)
      if (fin !== -1) { i = fin; continue }
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
    if (ch === '/' && ouvreUneRegex(str.slice(0, i))) {
      const fin = scanRegexLiteral(str, i)
      if (fin !== -1) { i = fin; continue }
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
    if (ch === '/' && ouvreUneRegex(str.slice(0, i))) {
      const fin = scanRegexLiteral(str, i)
      if (fin !== -1) { i = fin; continue }
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
// `.= undefined` fantôme comme une affectation de branche. `parenDeltaHorsChaines` (delta `(`/`)`
// hors chaînes/regex/commentaire, même garde que balancedSpan) repère ces listes AVANT la boucle
// principale (cf. pré-passe `multiLineParams` plus bas) : continuation rendue inerte, fermeture
// mémorisée avec l'indentation de la ligne D'OUVERTURE, jamais celle de la fermeture.
// Un COMMENTAIRE sur une ligne de continuation
// d'une liste multi-lignes (`f = (\n  a,\n  // commentaire\n  b\n) ->`) faisait échouer la jonction
// plus bas : `joined` recollait les lignes BRUTES, commentaire compris, et `//` s'y faisait prendre
// pour un littéral regex VIDE par `balancedSpan`/`outermostParenSpans` (`ouvreUneRegex` vrai après
// une virgule) — le texte du commentaire ensuite scanné comme du CODE (apostrophe française →
// chaîne jamais refermée jusqu'à la fin de `joined`, ou parenthèse isolée → compte dépareillé).
// `sansCommentaireFinal` retire ce commentaire de fin de ligne (scanner UNIQUE, réutilisé par
// `parenDeltaHorsChaines` ci-dessous ET par la pré-passe `multiLineParams` plus bas).
// `sansCommentaireFinal` ne connaissait que `//` :
// un commentaire de BLOC `/* … */` (mono-ligne OU multi-lignes, issu d'un `###…###` Coffee converti
// par la Pass 1) sur cette même ligne de continuation subissait EXACTEMENT le même sort qu'un `//`
// non traité — avalé comme un littéral regex par `scanRegexLiteral` (refermé sur le `/` de `*/`),
// pièce garbage jetée en silence par `extractParamNames`. `sansCommentaireFinal` devient
// `sansCommentaires` (MULTI-LIGNES, retire aussi `/* … */`, remplacé par un espace pour ne jamais
// recoller deux jetons) — mêmes deux appelants, et réutilisée par les 4 scanners (balancedSpan,
// splitTopLevelCommas, firstTopLevelEquals, parenDeltaHorsChaines) via le helper partagé
// `skipCommentSpan` posé plus haut à côté de `skipQuotedSpan`.
function sansCommentaires(src: string): string {
  let out = ''
  let i   = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === '`') { const e = skipQuotedSpan(src, i); out += src.slice(i, e); i = e; continue }
    if (ch === '/' && src[i + 1] === '/') { i = skipCommentSpan(src, i); continue }
    if (ch === '/' && src[i + 1] === '*') { i = skipCommentSpan(src, i); out += ' '; continue }
    if (ch === '/' && ouvreUneRegex(src.slice(0, i))) {
      const fin = scanRegexLiteral(src, i)
      if (fin !== -1) { out += src.slice(i, fin); i = fin; continue }
    }
    out += ch
    i++
  }
  return out
}

// blanchirCommentaires — variante de sansCommentaires qui CONSERVE la longueur et les indices de
// ligne/colonne : `sansCommentaires` ci-dessus
// SUPPRIME un `//` (rien émis) et REMPLACE un `/* … */` par UN SEUL espace (peu importe sa taille)
// — la position des caractères qui suivent GLISSE, illisible pour une passe qui doit ensuite
// RÉÉCRIRE la ligne D'ORIGINE à un index précis. Ici, chaque caractère de commentaire devient UN
// ESPACE (les `\n` internes à un bloc multi-lignes restent des `\n`, jamais blanchis) : même
// parcours que `sansCommentaires` (chaînes via `skipQuotedSpan`, regex via `ouvreUneRegex`/
// `scanRegexLiteral`, `//`/`/* … */` reconnus par `skipCommentSpan`), mais
// `blanchirCommentaires(s).length === s.length` et le découpage par `\n` tombe sur le MÊME nombre
// de lignes — la Pass 4 plus bas DÉTECTE sur le texte blanchi et RÉÉCRIT sur la ligne brute, index
// par index. `sansCommentaires` reste inchangée pour ses appelants existants (parenDeltaHorsChaines,
// région jointe de `multiLineParams`) : deux besoins différents, deux fonctions.
function blanchirCommentaires(src: string): string {
  let out = ''
  let i   = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === '`') { const e = skipQuotedSpan(src, i); out += src.slice(i, e); i = e; continue }
    if (ch === '/') {
      const cs = skipCommentSpan(src, i)
      if (cs !== -1) { for (let k = i; k < cs; k++) out += src[k] === '\n' ? '\n' : ' '; i = cs; continue }
      if (ouvreUneRegex(src.slice(0, i))) {
        const fin = scanRegexLiteral(src, i)
        if (fin !== -1) { out += src.slice(i, fin); i = fin; continue }
      }
    }
    out += ch
    i++
  }
  return out
}

function parenDeltaHorsChaines(line: string): number {
  const code = sansCommentaires(line)
  let delta  = 0
  let i      = 0
  while (i < code.length) {
    const ch = code[i]
    // Commentaire sauté AVANT le test regex (cf. skipCommentSpan) : sans
    // objet ici la plupart du temps (`code` déjà nettoyé ci-dessus), même garde que les 3 autres
    // scanners par cohérence — un appelant qui passerait un jour du texte NON nettoyé reste protégé
    const cs = skipCommentSpan(code, i)
    if (cs !== -1) { i = cs; continue }
    if (ch === '/' && ouvreUneRegex(code.slice(0, i))) {
      const fin = scanRegexLiteral(code, i)
      if (fin !== -1) { i = fin; continue }
    }
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(code, i); continue }
    if (ch === '(') delta++
    else if (ch === ')') delta--
    i++
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
export function applyCivetDialectSugar(src: string, lang?: string, predeclared?: string[], firstLine = 1): string {
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
  if (lang !== 'coffee') {
    let conv = ''
    let ci = 0
    const cn = out.length
    while (ci < cn) {
      const c = out[ci], c1 = out[ci + 1], c2 = out[ci + 2]
      // `### ... ###` (début de ligne OU inline) → `/* ... */` ; un `*/` du contenu (motif de chemin
      // `src/**/*.json`) devient `*\/`, sinon il refermait le commentaire au milieu
      if (c === '#' && c1 === '#' && c2 === '#') {
        const end = out.indexOf('###', ci + 3)
        conv += '/*' + out.slice(ci + 3, end < 0 ? cn : end).replace(/\*\//g, '*\\/') + '*/'
        ci = end < 0 ? cn : end + 3
        continue
      }
      // heredocs `"""..."""` / `'''...'''` → inchangés (un `#` dedans est du texte)
      if ((c === '"' && c1 === '"' && c2 === '"') || (c === "'" && c1 === "'" && c2 === "'")) {
        const q3 = c + c + c
        const end = out.indexOf(q3, ci + 3)
        const stop = end < 0 ? cn : end + 3
        conv += out.slice(ci, stop)
        ci = stop
        continue
      }
      // template literal `` `...` `` → MULTI-LIGNES, inchangé : un `#`
      // dans un backtick multi-ligne est du TEXTE (ou une interpolation `${…}`),
      // jamais un commentaire. Le borner au `\n` (comme les mono-lignes) faisait
      // scanner les lignes SUIVANTES comme du code et y convertir `#`→`//`,
      // corrompant silencieusement le contenu utilisateur.
      if (c === '`') {
        conv += c
        ci++
        while (ci < cn) {
          if (out[ci] === '\\') { conv += out.slice(ci, ci + 2); ci += 2; continue }
          conv += out[ci]
          if (out[ci] === '`') { ci++; break }
          ci++
        }
        continue
      }
      // chaîne `"…"` lue au niveau (lecteur du lexeur) : une interpolation `#{…}` y porte ses propres guillemets — le `#{`
      // d'une chaîne écrite DANS l'interpolation n'est pas un commentaire (il sortait en `//{…}`)
      if (c === '"') {
        const e = scanDoubleQuoteAt(out, ci)
        if (e > 0) { conv += out.slice(ci, e); ci = e; continue }
      }
      // chaînes mono-ligne `"..."` `'...'` → inchangées (escapes, bornées à la ligne)
      if (c === '"' || c === "'") {
        conv += c
        ci++
        while (ci < cn) {
          if (out[ci] === '\\') { conv += out.slice(ci, ci + 2); ci += 2; continue }
          if (out[ci] === '\n') break
          conv += out[ci]
          if (out[ci] === c) { ci++; break }
          ci++
        }
        continue
      }
      // `//` ligne et `/* */` bloc déjà-JS → inchangés
      if (c === '/' && c1 === '/') { const e = out.indexOf('\n', ci); const s = e < 0 ? cn : e; conv += out.slice(ci, s); ci = s; continue }
      if (c === '/' && c1 === '*') { const e = out.indexOf('*/', ci + 2); const s = e < 0 ? cn : e + 2; conv += out.slice(ci, s); ci = s; continue }
      // littéral regex `/…/` : zone inerte, même garde que transformCodeOnly plus bas —
      // sans ce garde-fou, `re = /#\d/` voyait son `#` (suivi
      // d'un `\`, non alphanumérique) converti par la branche `#` juste en dessous : `re = ///\d/`,
      // échec de compilation bruyant mais FAUX (`/#\d/` est un regex légitime). Contexte gauche lu sur
      // la source `out` : relire `conv`, en construction, l'aplatissait à chaque `/` (coût quadratique).
      // Les deux ne diffèrent que par la marque des commentaires déjà convertis (`#` ou `//`, `###` ou
      // `/* */`), ni signe ni mot-clé : ouvreUneRegex rend la même réponse.
      if (c === '/' && ouvreUneRegex(out.slice(0, ci))) {
        const fin = scanRegexLiteral(out, ci)
        if (fin !== -1) { conv += out.slice(ci, fin); ci = fin; continue }
      }
      // `#` commentaire (sauf champ privé `#id` / `#!`) → `//` jusqu'à la fin de ligne
      if (c === '#' && !(c1 !== undefined && /[a-zA-Z_!]/.test(c1))) {
        const e = out.indexOf('\n', ci); const s = e < 0 ? cn : e
        conv += '//' + out.slice(ci + 1, s)
        ci = s
        continue
      }
      conv += c
      ci++
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
        /\bfor(\s+[a-zA-Z_]\w*(?:\s*,\s*[a-zA-Z_]\w*)?\s+)in(\s+)/g,
        'for$1of$2'
      )
    )
  }

  // ─── Pass 2b : `isnt` (Coffee) → `is not` (que Civet transforme en `!==`).
  // Civet ne connaît PAS `isnt` : il parse `a isnt b` comme l'appel
  // `a(isnt(b))` → `ReferenceError: isnt is not defined` au runtime.
  // DOIT tourner AVANT la Pass 3 (interpolation) : à ce stade les `"#{…}"` sont
  // encore des strings double-quote que transformCodeOnly saute proprement —
  // après Pass 3 ce sont des template literals que transformCodeOnly corromprait
  // en les re-sérialisant. SKIP Coffee : `isnt` natif, et `is not` y = `=== !`.
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
        throw new Error(t('transpiler.isnt-identifiant-reserve'))
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
  if (lang !== 'coffee') {
    out = convertCoffeeInterpolations(out)
  }

  // ─── Pass 4 : auto-déclaration scope-aware (mimique Coffee `var`-hoist) ───
  // SKIP pour Coffee (auto-déclare nativement et rejette `.=`).
  if (lang !== 'coffee') {
    const RESERVED = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'unless', 'when', 'then', 'try', 'catch', 'finally', 'throw',
      'new', 'class', 'extends', 'this', 'super', 'true', 'false', 'null',
      'undefined', 'typeof', 'instanceof', 'in', 'of', 'and', 'or', 'not', 'is',
      'isnt', 'function', 'let', 'const', 'var', 'export', 'import', 'from',
      'await', 'async', 'yield', 'delete', 'void',
    ])
    const lines = out.split('\n')
    // `lignesCode` (blanchirCommentaires, cf. son
    // bandeau plus haut) BLANCHIT les commentaires de tout `out` EN UNE SEULE PASSE (bloc multi-lignes
    // compris) avant que la Pass 4 ne détecte quoi que ce soit dessus : `inertLines`, la pré-passe
    // `multiLineParams` et la boucle principale plus bas lisent TOUTES `lignesCode[li]`, jamais
    // `lines[li]` directement, sauf pour la RÉÉCRITURE finale qui vise la ligne D'ORIGINE (mêmes
    // indices, grâce au blanchiment qui préserve la longueur). Invariant vérifié une fois ici : une
    // divergence signale un bug du blanchiment, jamais une entrée utilisateur.
    const lignesCode = blanchirCommentaires(out).split('\n')
    if (lignesCode.length !== lines.length) throw new Error('[transpiler] blanchirCommentaires a changé le nombre de lignes — invariant Pass 4 rompu')
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
    // raison de rendre une ligne inerte : c'est `lignesCode` (blanchi à espaces, cf. plus haut) qui
    // absorbe désormais les commentaires pour la DÉTECTION ; seule une vraie CHAÎNE multi-lignes
    // (`` ` ``/`"""`/`'''`) encore ouverte à la fin de la ligne précédente reste inerte ici. Le mode
    // `/*` reste SUIVI dans cette IIFE (pour ne pas confondre un guillemet DANS un commentaire avec
    // l'ouverture d'une chaîne) mais ne marque plus jamais de ligne inerte lui-même. La passe finale
    // sur les lignes `//` pures a disparu : une telle ligne, une fois blanchie, est VIDE
    // (`codeLine.trim() === ''`), écartée par la boucle principale AVANT même de consulter
    // `inertLines` — même résultat, un test en moins.
    const inertLines = (() => {
      const inert = new Set<number>()
      let line = 0
      let i = 0
      const n = out.length
      let mode: '`' | '"""' | "'''" | '/*' | null = null
      while (i < n) {
        const ch = out[i]
        if (ch === '\n') { line++; if (mode && mode !== '/*') inert.add(line); i++; continue }
        if (mode) {
          if (mode === '`' && ch === '\\') { i += 2; continue }
          if (mode === '`' && ch === '`') { mode = null; i++; continue }
          if (mode === '"""' && out.startsWith('"""', i)) { mode = null; i += 3; continue }
          if (mode === "'''" && out.startsWith("'''", i)) { mode = null; i += 3; continue }
          if (mode === '/*' && out.startsWith('*/', i)) { mode = null; i += 2; continue }
          i++; continue
        }
        if (ch === '#' || (ch === '/' && out[i + 1] === '/')) { const e = out.indexOf('\n', i); i = e === -1 ? n : e; continue }
        if (out.startsWith('"""', i)) { mode = '"""'; i += 3; continue }
        if (out.startsWith("'''", i)) { mode = "'''"; i += 3; continue }
        if (ch === '`') { mode = '`'; i++; continue }
        if (ch === '/' && out[i + 1] === '*') { mode = '/*'; i += 2; continue }
        if (ch === '"' || ch === "'") {
          let j = i + 1
          while (j < n && out[j] !== ch && out[j] !== '\n') { if (out[j] === '\\') j++; j++ }
          i = (j < n && out[j] === ch) ? j + 1 : j
          continue
        }
        i++
      }
      return inert
    })()
    // pré-passe liste de paramètres MULTI-LIGNES (cf. bandeau
    // `parenDeltaHorsChaines` plus haut) : une région ouverte par un delta `(`/`)` positif et refermée
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
        // `lignesCode[li]` (blanchi, cf. bandeau `lignesCode` plus haut)
        // remplace `lines[li]` : un commentaire qui ferme EN COURS de ligne (`y */) ->`) laissait
        // passer un `/` isolé que l'heuristique regex de `parenDeltaHorsChaines` pouvait à tort
        // apparier plus loin sur la ligne, avalant le `)` réel — le blanchiment retire le risque à la
        // source (plus aucun caractère de commentaire ne subsiste pour l'heuristique).
        const delta = parenDeltaHorsChaines(lignesCode[li])
        if (depth === 0) {
          if (delta > 0) { openLine = li; depth = delta }
          continue
        }
        depth += delta
        if (depth < 0) { depth = 0; openLine = -1; continue }
        if (depth === 0) {
          const trimmedEnd = lignesCode[li].replace(/\s+$/, '')
          if (trimmedEnd.endsWith('->') || trimmedEnd.endsWith('=>')) {
            const beforeArrow = trimmedEnd.slice(0, -2).replace(/\s+$/, '')
            if (beforeArrow.endsWith(')')) {
              // `sansCommentaires` (remplace `sansCommentaireFinal`) tourne
              // sur la région JOINTE en UN seul passage (MULTI-LIGNES) : un `/* … */` qui s'étale sur
              // plusieurs lignes de continuation (`###…###` Coffee) n'était sinon jamais reconnu par un
              // nettoyage LIGNE PAR LIGNE (chaque ligne isolée n'y voyait qu'un `/*` jamais refermé, ou
              // un `*/` jamais ouvert).
              const regionSrc = sansCommentaires(lines.slice(openLine, li + 1).join('\n')).split('\n').filter((l) => l.trim() !== '')
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
    let niveauSur = false
    const constanteSure = (nom: string): boolean => niveauSur && scopes[scopes.length - 1].constDeclared.has(nom)
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]
      // `codeLine` (blanchi, hissé ici EN TÊTE de boucle) sert à TOUTE
      // détection ci-dessous (vide, motif d'affectation, tête de destructuration, variante en ligne
      // if/unless/else, déclarations explicites, fin de bloc `->`/`=>`/`then`/`do`) ; `line` (brute)
      // ne sert plus qu'à la RÉÉCRITURE finale, par découpe à un index calculé sur `codeLine` — les
      // deux chaînes ont la MÊME longueur, le même index tombe donc au même endroit dans les deux.
      const codeLine = lignesCode[li]
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
      niveauSur = indent <= topScope.bodyIndent && !/->|=>|\b(?:function|class|catch)\b|\)\s*\{/.test(codeLine)
      // affectation COMPOSÉE ou incrément/décrément (`w += 1`, `w++`, `--w`) : jamais reconnue
      // par le motif d'affectation SIMPLE plus bas (son `=` n'y est jamais collé directement au
      // nom) — une réaffectation quand même, soumise à la MÊME garde de constance, restreinte à
      // CETTE portée (pas une ancêtre, cf. bandeau plus bas). Lookbehind qui exclut un `.`/`$`
      // immédiatement avant le nom : une PROPRIÉTÉ (`w.x += 1`) ou un état réactif (`$w += 1`,
      // mécanisme distinct) n'est jamais concerné.
      const compoundRe = /(?<![\w.$])([a-zA-Z_]\w*)\s*(?:\+\+|--|(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])=)|(?:\+\+|--)\s*([a-zA-Z_]\w*)(?![\w$])/g
      let cm: RegExpExecArray | null
      while ((cm = compoundRe.exec(codeLine)) !== null) {
        const nomCompose = cm[1] ?? cm[2]
        if (RESERVED.has(nomCompose)) continue
        if (constanteSure(nomCompose)) {
          throw new Error(t('transpiler.civet-reaffectation-constante', { nom: nomCompose, ligne: li + firstLine }))
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
              // identiques, cf. bandeau `blanchirCommentaires`).
              const posEq = lead.length + name.length + sp.length
              lines[li] = line.slice(0, posEq) + '.=' + line.slice(posEq + 1)
            }
          } else if (constanteSure(name)) {
            // `name` lié par `:=` (constante) DANS CETTE MÊME portée (pas une ancêtre — même
            // politique que le bundler, « au même niveau » : une fonction imbriquée qui REÇOIT
            // juste une variable externe n'est pas suivie, seul le niveau qui a posé le `:=`
            // l'est). Civet compile `:=` en `const` : réaffecter planterait PROPREMENT mais
            // SEULEMENT à l'exécution (« Assignment to constant variable »), le build restant
            // vert. Refus À LA COMPILATION, message qui nomme l'identifiant, la ligne fautive et
            // la solution.
            throw new Error(t('transpiler.civet-reaffectation-constante', { nom: name, ligne: li + firstLine }))
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
            if (constanteSure(nm)) {
              throw new Error(t('transpiler.civet-reaffectation-constante', { nom: nm, ligne: li + firstLine }))
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
            } else if (constanteSure(nm)) {
              // même garde que l'affectation simple, restreinte à CETTE portée : `if a then x = 1`
              // reste une réaffectation, même écrite en ligne après `then`/`else`
              throw new Error(t('transpiler.civet-reaffectation-constante', { nom: nm, ligne: li + firstLine }))
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
        let motif  = codeLine.slice(indent)
        let patEnd = balancedSpan(motif, 0)
        for (let lj = li + 1; patEnd === -1 && lj < lignesCode.length; lj++) {
          motif  += '\n' + lignesCode[lj]
          patEnd  = balancedSpan(motif, 0)
        }
        const opMatch = patEnd !== -1 ? motif.slice(patEnd).match(/^\s*([.:])=/) : null
        if (opMatch) {
          const scopeDecl = scopes[scopes.length - 1]
          // même distinction que declMatch ci-dessus pour un IDENT nu : `:=` lie une constante,
          // même déstructurée — `w`/`h` de `{w, h} := f()` refusent une réaffectation nue plus bas
          const estConst = opMatch[1] === ':'
          for (const nm of extractDestructuredNames(motif.slice(0, patEnd), RESERVED)) {
            scopeDecl.declared.add(nm)
            if (estConst) scopeDecl.constDeclared.add(nm)
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
      // `sansCommentaires` plus haut) remplace `line` pour CE test ET pour `trimmedEnd`/`beforeArrow`
      // juste en dessous : un `//`/`/* … */` en QUEUE de ligne (`f = (a) -> // note`) faisait échouer
      // `/(?:->|=>|then|do)\s*$/` sur la ligne BRUTE (elle ne finit plus littéralement par `->`) →
      // aucune portée poussée, `a` traité comme une affectation de la portée racine et HISSÉ à tort
      // (`a .= undefined` fantôme) ; un `/* c */` ENTRE les paramètres (`f = (a, /* c */ b) ->`)
      // faussait de même `beforeArrow` plus bas. Les deux tests portent désormais sur la MÊME chaîne
      // nettoyée (la comparaison de longueur `params.end === beforeArrow.length` reste cohérente).
      // `codeLine` n'est plus recalculé ici : c'est
      // désormais la MÊME variable hissée en tête de boucle (`lignesCode[li]`, blanchie — cf. son
      // bandeau plus haut), qui couvre en plus les blocs `/* … */` MULTI-LIGNES (`sansCommentaires`
      // ne reconnaissait qu'un commentaire ouvert ET refermé sur cette ligne isolée, jamais un bloc
      // ouvert sur une ligne précédente).
      if (/(?:->|=>|then|do)\s*$/.test(codeLine)) {
        // liste de paramètres MULTI-LIGNES (cf. bandeau
        // `parenDeltaHorsChaines` plus haut) : la portée poussée hérite de l'indentation de la
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
        const group = byInsertAt.get(h.insertAt) ?? []
        group.push({ indent: h.indent, name: h.name })
        byInsertAt.set(h.insertAt, group)
      }
      for (const at of [...byInsertAt.keys()].sort((a, b) => b - a)) {
        const group  = byInsertAt.get(at)
        const decls  = group.map(h => `${h.name} .= undefined`)
        const indent = ' '.repeat(group[0].indent)
        const tete   = lines[at].trimStart()
        if (at > 0 && lines[at - 1].trim() === '' && !inertLines.has(at - 1)) {
          lines[at - 1] = indent + decls.join('; ')
        }
        else if (/^[a-zA-Z_]/.test(tete) && !/^(?:import|export)\b/.test(tete)) {
          const marge = lines[at].length - tete.length
          lines[at] = lines[at].slice(0, marge) + decls.join('; ') + '; ' + tete
        }
        else {
          lines.splice(at, 0, ...decls.map(d => indent + d))
        }
      }
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
const MOTS_APRES_UNE_RUNE = new Set(['if', 'unless', 'and', 'or', 'then', 'else', 'when', 'for', 'while', 'until', 'not', 'is', 'isnt', 'in', 'of', 'instanceof'])

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
  return !!word && MOTS_APRES_UNE_RUNE.has(word[0])
}

function consoleSansParentheses(src: string, at: number): Error {
  const debut = src.lastIndexOf('\n', at - 1) + 1
  const fin   = src.indexOf('\n', at)
  return new Error(t('transpiler.console-parentheses', { ecrit: src.slice(debut, fin === -1 ? src.length : fin).trim() }))
}

function reecritRuneConsole(src: string, lang?: string): string {
  const vue = maskNonCode(src, lang ?? 'civet')
  const re  = /(?<![\w$.])µ\.?console(?![\w$])/g
  let sortie = '', dernier = 0, m: RegExpExecArray | null
  while ((m = re.exec(vue))) {
    const apresNom = m.index + m[0].length
    let i = apresNom
    while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++
    const c = src[i]
    let fin = apresNom, arg: string | null = null
    if (vue[i] === '(') {
      // parenthèse fermante du même niveau, cherchée sur la vue masquée (une parenthèse dans une
      // chaîne ne compte pas) ; jamais refermée : rien réécrit, le compilateur le dira
      let prof = 0, j = i
      for (; j < vue.length; j++) {
        if (vue[j] === '(') prof++
        else if (vue[j] === ')' && --prof === 0) break
      }
      if (j >= vue.length) continue
      arg = src.slice(i + 1, j).trim()
      fin = j + 1
    }
    else if (c === '.' || c === '[') continue   // `µ.console.log(…)` : pas la rune
    else if ((c === "'" || c === '"') && i > apresNom) {
      // un texte à triples guillemets se refermerait au premier guillemet
      if (src.startsWith(c.repeat(3), i)) throw consoleSansParentheses(src, m.index)
      fin = skipQuotedSpan(src, i)
      arg = src.slice(i, fin)
    }
    else if (i > apresNom && /[$A-Za-z_]/.test(c ?? '')) {
      const jeton = /^[$\w.]+/.exec(src.slice(i))![0]
      if (!MOTS_APRES_UNE_RUNE.has(jeton)) { arg = jeton; fin = i + jeton.length }
    }
    // sans parenthèses, l'argument (ou la rune seule) finit l'instruction : `µconsole foo(1)`,
    // `µconsole @el`, `µconsole $x, 'label'` seraient mal découpés — les parenthèses sont demandées
    if (vue[i] !== '(' && !statementEnd(src, vue, fin)) throw consoleSansParentheses(src, m.index)
    sortie += src.slice(dernier, m.index) + (arg ? `(µ.console && µ.console(${arg}))` : "(µ.console && µ.console((typeof _mjsThis != 'undefined' && _mjsThis) || null))")
    dernier = fin
  }
  return sortie + src.slice(dernier)
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
export function applyMjsSugarToScript(src: string, lang?: string, predeclared?: string[], sectionLabel = '<script>', firstLine = 1): string {
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
  let maskedOut = maskedForExports.replace(
    /^([ \t]*)export[ \t]+µ\$\$([a-zA-Z0-9_]+)([ \t]*=)/gm,
    '$1export µ$$$2$3'
  )
  maskedOut = maskedOut.replace(/µ\$\$([a-zA-Z0-9_]+)/g, (_m: string, nom: string) => {
    if (singletonExports.has(nom)) return '$' + nom
    throw new Error(t('transpiler.singleton-sans-import', { nom }))
  })
  let out = restoreExports(maskedOut)

  // dialecte Coffee/Civet des composants (commentaires #, for…in→of, isnt,
  // interpolation "#{}", auto-déclaration scope-aware) — cf. applyCivetDialectSugar
  // ci-dessus, SOURCE UNIQUE partagée avec `mjs ws` (fichiers *.server.mjs).
  out = applyCivetDialectSugar(out, lang, predeclared, firstLine)

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
  const sansCommentaireFinal = (rhs: string): [string, string] => {
    const m = /^(.*?\S)([ \t]+\x00MJSSTR\d+\x00)$/.exec(rhs)
    if (!m || !/^(?:\/\/|#(?!##))/.test(restoreDollar(m[2].trimStart()))) return [rhs, '']
    return [m[1], m[2]]
  }
  //   `export µ$X = expr` → `µ_state.X ?= µ.state(expr); export $X = µ_state.X` (sur la même ligne : les lignes du script
  //   restent celles du fichier)
  let maskedDollarOut = maskedForDollar.replace(
    /^([ \t]*)export[ \t]+µ\$([a-zA-Z0-9_]+)[ \t]*=[ \t]*(.+?)[ \t]*$/gm,
    (_m, indent, name, rhs) => {
      const [expr, commentaire] = sansCommentaireFinal(rhs)
      return `${indent}µ_state.${name} ?= µ.state(${expr}); export $${name} = µ_state.${name}${commentaire}`
    }
  )
  //   `µ$X = expr` (sans export) → `µ_state.X ?= µ.state(expr)`
  maskedDollarOut = maskedDollarOut.replace(
    /^([ \t]*)µ\$([a-zA-Z0-9_]+)[ \t]*=[ \t]*(.+?)[ \t]*$/gm,
    (_m, indent, name, rhs) => {
      const [expr, commentaire] = sansCommentaireFinal(rhs)
      return `${indent}µ_state.${name} ?= µ.state(${expr})${commentaire}`
    }
  )
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
  if (out.includes('inspect') || out.includes('minmax')) out = reecritOuRejetteRuneChemin(out)
  // la rune seule (`µconsole`, `µ.console`) : un `console.log` ordinaire ne coûte pas un masquage du script
  if (/µ\.?console/.test(out)) out = reecritRuneConsole(out, lang)
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
    const recepteur = sectionLabel === '<script module>' ? '@' : '_mjsThis.'
    c = c.replace(/µ\.?\s*on\b/g, recepteur + '_mjs_on')
    c = c.replace(/µ\.?\s*setContext\b/g, recepteur + '_mjs_setContext')
    c = c.replace(/µ\.\s*getContext\b/g, recepteur + '_mjs_getContext')

    // `µ$X` (lecture) → `µ_state.X`
    c = c.replace(/µ\$([a-zA-Z0-9_]+)/g, 'µ_state.$1')
    return c
  })


  // Si µ_state utilisé, prefix la DÉCLARATION de `µ_state` au top après imports.
  // LANG-AWARE : en Coffee l'assignation nue auto-déclare (`var µ_state`),
  // mais en Civet (défaut) / TS / JS une assignation NUE sort non déclarée →
  // `ReferenceError: µ_state is not defined` au runtime (module ES strict) ET
  // rejet par lintUndeclaredTopLevelAssignment (message trompeur : le dev n'a
  // jamais écrit `µ_state`). On émet donc `.=` (Civet let) ou `let` (js/ts).
  // Garde anti-doublon élargie à `=`/`:=`/`.=`. (`\b` ne marche pas sur `µ`,
  // U+00B5 pas word-char en JS regex.)
  if (out.includes('µ_state') && !/^\s*µ_state\s*[:.]?=\s*µ\.state/m.test(out)) {
    const lines = out.split('\n')
    let insertAt = 0
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*import\b/.test(lines[i])) insertAt = i + 1
      else if (lines[i].trim() !== '') break
    }
    const decl = lang === 'coffee'              ? 'µ_state = µ.state({})'
               : (lang === 'js' || lang === 'ts') ? 'let µ_state = µ.state({})'
               :                                    'µ_state .= µ.state({})'
    // sur une ligne existante (les lignes du script restent celles du fichier) : la ligne vide où elle irait, sinon devant
    // la ligne elle-même (un nom, ou un `µ_state.x ?= …` déjà réécrit) ; une autre (symbole, `import`, `export`…) en reçoit
    // une à elle
    const tete = insertAt < lines.length ? lines[insertAt].trimStart() : ''
    if (insertAt < lines.length && tete === '') lines[insertAt] = decl
    else if (/^(?:[a-zA-Z_]|µ_state\.)/.test(tete) && !/^(?:import|export)\b/.test(tete)) lines[insertAt] = decl + '; ' + lines[insertAt]
    else lines.splice(insertAt, 0, decl)
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
