// transpiler/macro-tag — `findMacroTagEnd`
// déplacée ICI depuis macros.ts. Raison d'être de ce module à part : sections.ts
// a besoin de la même fonction pour son propre masquage <@head>/<@failed>, mais
// macros.ts IMPORTE déjà sections.ts (`extractSections`) — un import retour de
// sections.ts vers macros.ts créerait un cycle. Fonction PURE, aucune dépendance
// sur le reste du transpileur (ni messages, ni sections, ni macros).

// findMacroTagEnd — localise le `>` qui ferme RÉELLEMENT une
// balise de macro `<@nom …>`, à partir de `from` (index juste après `<@nom`).
// AVANT : chaque site ci-dessous utilisait une regex `[^>]*`/`[^>]+?` qui
// s'arrêtait au PREMIER `>` textuel — y compris niché dans un `{…}`
// (comparaison `a > b`, `if…then…else`, flèche `->`/`=>`) : panne MUETTE, le
// handler tronqué et un résidu texte (`100}/>`) qui fuit dans le HTML rendu.
// Règle : profondeur `{`/`}` suivie en permanence ; chaînes `"…"`/`'…'`
// reconnues UNIQUEMENT hors accolade (profondeur 0, attribut littéral au
// top-level de la balise) — DANS une accolade, seule la profondeur `{`/`}`
// compte, jamais les guillemets (cas limite : `{a = '}'}`, le `}` du littéral
// `'}'` referme prématurément l'accolade extérieure — mais le `'` isolé qui
// suit ne trouvant PAS de guillemet partenaire plus loin (cf. règle
// ci-dessous), il n'est PAS traité comme une ouverture, et le `}` réel qui le
// suit referme correctement : `>` final retrouvé quand même, cf. test dédié).
// GUILLEMET (hors accolade) JAMAIS REFERMÉ plus loin dans `html` : PAS traité
// comme une ouverture — même tolérance que l'ancien scan `[^>]*` (aveugle aux
// guillemets), exigée par un test existant (macros globales — modificateur
// toujours vu même si un attribut littéral plus tôt sur la balise oublie son
// guillemet fermant).
// Profondeur > 0 et une `{` d'attribut JAMAIS refermée : sans borne, le scan
// continuait jusqu'au premier `}` suivi d'un `>` n'importe où PLUS LOIN dans le document,
// avalant tout le HTML intermédiaire (balises entières comprises) comme « attrs » de la macro,
// réinjecté ensuite comme corps de handler Civet — panne muette, aucune erreur. `looksLikeOpenTag`
// signale qu'une AUTRE balise s'ouvre plus loin (donc que la `{` courante ne se refermera
// jamais) : un `<` en DÉBUT DE LIGNE (espaces/tabs seuls depuis le dernier `\n`), suivi d'une
// lettre, `/`, `@` ou `!` — jamais un `<` de comparaison en plein milieu d'une expression
// (`if a < b`), qui n'est précédé que de code sur sa ligne, pas d'un retour à la ligne.
function looksLikeOpenTag(html: string, i: number): boolean {
  if (!/[a-zA-Z/@!]/.test(html[i + 1] ?? '')) return false
  let j = i - 1
  while (j >= 0 && (html[j] === ' ' || html[j] === '\t')) j--
  return j >= 0 && html[j] === '\n'
}

// Régression (sur du Civet VALIDE) — le
// scan à profondeur > 0 ne suivait AUCUN contexte de chaîne : un heredoc Civet `'''…'''` (ou
// `"""…"""`, ou un gabarit `` ` ``) niché dans un attribut (`@click={ html := '''<b>gras</b>''' }`)
// contient un `<tag>` en tête de ligne qui déclenchait `looksLikeOpenTag` (faux « balise jamais
// refermée »), et une accolade LITTÉRALE dans une chaîne (`{ s := "}" }`) pouvait décrémenter la
// profondeur en plein milieu d'un guillemet non fermé. Suit désormais le guillemet ACTIF pendant
// tout le temps qu'il reste ouvert (échappement `\` compris) : ni `looksLikeOpenTag` ni le
// comptage `{`/`}` ne s'appliquent DANS une chaîne — seule la recherche de son propre délimiteur
// de fermeture avance le scan. Le repli « guillemet jamais refermé » de la profondeur 0
// (ci-dessous, INCHANGÉ) reste hors de ce mécanisme : il vit AVANT toute ouverture d'accolade,
// jamais en profondeur.
function stringDelimAt(html: string, i: number): string | null {
  const three = html.slice(i, i + 3)
  if (three === "'''" || three === '"""') return three
  const c = html[i]
  return c === '\'' || c === '"' || c === '`' ? c : null
}

// scanTemplateLiteral — backtick ouvrant en `openIdx` : rend l'offset APRÈS le backtick fermant
// du MÊME niveau, en traversant les interpolations `${…}` (qui peuvent elles-mêmes contenir des
// gabarits, chaînes et accolades imbriqués), ou -1 si jamais refermé. Port LOCAL du même
// algorithme que src/lexer/index.ts (scanTemplateAt/scanInterpAt) — dupliqué plutôt qu'importé
// pour garder ce module SANS DÉPENDANCE (cf. commentaire de tête du fichier).
// AVANT : le scan `{`/`}` de findMacroTagEnd traitait un gabarit comme une chaîne ORDINAIRE via
// stringDelimAt/strDelim, refermée au PREMIER backtick littéral — un backtick niché dans une
// interpolation (`` `a${ `x}y` }b` ``) la refermait TROP TÔT, laissant le `}` de "x}y" (qui
// aurait dû rester protégé DANS la chaîne nichée) décrémenter la profondeur `{`/`}` de la balise
// elle-même : panne muette, balise tronquée, reliquat de code fuyant comme texte du document
// (trouvé en revue le 23/09/2026, cf. test dédié).
function scanTemplateLiteral(html: string, openIdx: number): number {
  let j = openIdx + 1
  while (j < html.length) {
    const c = html[j]
    if (c === '\\') { j += 2; continue }
    if (c === '`') return j + 1
    if (c === '$' && html[j + 1] === '{') {
      let d = 1
      j += 2
      while (j < html.length && d > 0) {
        const e = html[j]
        if (e === '\\') { j += 2; continue }
        if (e === '{') { d++; j++; continue }
        if (e === '}') { d--; j++; continue }
        if (e === '`') { const end = scanTemplateLiteral(html, j); if (end < 0) return -1; j = end; continue }
        if (e === '"' || e === "'") {
          const q = e
          j++
          while (j < html.length && html[j] !== q) { if (html[j] === '\\') j++; j++ }
          j++
          continue
        }
        j++
      }
      if (d > 0) return -1
      continue
    }
    j++
  }
  return -1
}

// minuscules ASCII seulement, même longueur que le texte : une position trouvée dans la copie vaut dans le texte
// d'origine. `toLowerCase()` change des longueurs (`'İ'.toLowerCase()` fait deux unités) et décalait tout ce qui
// suit — un « İstanbul » écrit avant `<@window>` faisait refuser une balise bien fermée. Les noms cherchés sont ASCII
export function asciiLower(s: string): string {
  return s.replace(/[A-Z]+/g, m => m.toLowerCase())
}

// accolades d'attribut sans fin dans `unclosedText` : positions (juste après la `{`) d'où la lecture ne revient
// jamais au niveau de la balise. Ce qui se lit dans une accolade ne dépend que du texte et de cette position : une
// balise suivante qui retombe sur l'une d'elles sait d'avance qu'elle ne se referme pas, sans relire tout le reste
// du texte (un gabarit en cours de frappe, tout sur une ligne, coûtait un temps quadratique)
let unclosedText   = ''
let unclosedBraces = new Set<number>()
// positions lues au niveau de la balise (hors accolade) par une lecture qui n'a pas trouvé son `>` : la suite de la lecture ne
// dépend que du texte et de la position, une autre balise qui y passe ne le trouvera pas non plus (des balises sans `>`, tout un
// texte, coûtaient chacune une lecture jusqu'à la fin)
let sansFin: Uint8Array | null = null

export function findMacroTagEnd(html: string, from: number): number {
  if (html !== unclosedText) {
    unclosedText   = html
    unclosedBraces = new Set()
    sansFin        = null
  }
  // accolades ouvertes, de l'extérieure à l'intérieure : quand la lecture échoue, aucune ne se refermait
  const open: number[] = []
  // positions lues au niveau de la balise par cette lecture
  const lues: number[] = []
  const fail = (): number => {
    for (const o of open) unclosedBraces.add(o)
    if (lues.length > 0) {
      sansFin ??= new Uint8Array(html.length)
      for (const p of lues) sansFin[p] = 1
    }
    return -1
  }
  let depth = 0
  let i = from
  let strDelim: string | null = null   // guillemet ACTIF en profondeur > 0, ou null hors chaîne
  while (i < html.length) {
    const c = html[i]
    if (depth === 0) {
      if (sansFin !== null && sansFin[i] === 1) return fail()
      lues.push(i)
    }
    if (strDelim !== null) {
      if (c === '\\') { i += 2; continue }
      if (html.slice(i, i + strDelim.length) === strDelim) { i += strDelim.length; strDelim = null; continue }
      i++
      continue
    }
    if (depth === 0 && (c === '"' || c === '\'')) {
      // guillemet JAMAIS refermé plus loin → PAS traité comme une ouverture (même
      // tolérance que l'ancien scan `[^>]*`, aveugle aux guillemets) : la garde
      // « macro globale — modificateur » (plus bas, parseListeners) a un test dédié
      // qui exige que ce cas ne rende pas le scan aveugle au reste de la balise —
      // on avance d'un cran et on continue à chercher le `>` réel normalement.
      const closeIdx = html.indexOf(c, i + 1)
      if (closeIdx === -1) { i++; continue }
      i = closeIdx + 1
      continue
    }
    if (depth > 0) {
      const delim = stringDelimAt(html, i)
      if (delim !== null) {
        if (delim === '`') {
          const end = scanTemplateLiteral(html, i)
          if (end < 0) return fail()   // gabarit jamais refermé : même repli que looksLikeOpenTag plus bas
          i = end
          continue
        }
        strDelim = delim; i += delim.length; continue
      }
      // commentaires DANS l'expression d'attribut : `//`/`/* … */` ignorés au même titre qu'une
      // chaîne — leurs `{`/`}`/`>` internes ne doivent PAS compter dans la profondeur de la balise.
      // AVANT : `/* } > */` refermait l'accolade PUIS la balise elle-même au mauvais endroit — un
      // résidu de texte fuyait dans le HTML rendu, et <@@img> y perdait carrément son `src`.
      if (c === '/' && html[i + 1] === '/') {
        const nl = html.indexOf('\n', i)
        i = nl === -1 ? html.length : nl
        continue
      }
      if (c === '/' && html[i + 1] === '*') {
        const end = html.indexOf('*/', i + 2)
        if (end === -1) return fail()   // commentaire jamais refermé : même repli que le gabarit plus haut
        i = end + 2
        continue
      }
    }
    // balise ouverte détectée EN PROFONDEUR (accolade d'attribut jamais refermée) : signal de
    // fin de scan, l'appelant lève déjà `macro-balise-non-fermee` sur un -1.
    if (depth > 0 && c === '<' && looksLikeOpenTag(html, i)) return fail()
    if (c === '{') {
      if (unclosedBraces.has(i + 1)) return fail()
      depth++
      open.push(i + 1)
      i++
      continue
    }
    if (c === '}') {
      if (depth > 0) open.pop()
      depth = Math.max(0, depth - 1)
      i++
      continue
    }
    if (c === '>' && depth === 0) return i
    i++
  }
  return fail()
}
