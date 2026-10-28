// transpiler/lint — contrôles du script d'un composant ou d'un module, appelés par transpileImpl (index.ts) : refus
// (erreurs de compilation) et avertissements, avec leurs aides (AST acorn, ligne du .mjs d'une position du JS compilé) ;
// masques des chaînes et des commentaires, partagés avec les sucres (sugar.ts) et l'orchestrateur

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { decode } from '@jridgewell/sourcemap-codec'

import { ouvreUneRegex, scanRegexLiteral } from '../sigils.js'
import { maskNonCode } from './split-rune.js'
import { analyserConstReassign } from './const-reassign.js'
import { scanTemplateAt } from '../lexer/index.js'
import { findScriptMatches, findStyleMatches, extractLang } from './sections.js'
import { typedLine, printDiagnostic, type LintToggles } from '../diagnostics.js'
import { t, type MsgKey } from '../messages/index.js'

// ----------------------------------------------------------------------------
// lintSingletonConsume — un singleton importé (`@import µ$$X`) se consomme
// UNIQUEMENT en `µ$$X`. Toute lecture `$X` / `$$X` / `§§X` dans le code SOURCE du
// dev est une faute → erreur de compilation explicite (`§§X` est le piège de
// migration nº1 : un vieux fichier à moitié migré doit CLAQUER, pas retomber
// en silence sur le contexte d'ancêtres — `§§X` désigne TOUJOURS ce contexte,
// plus jamais un singleton). Fait sur le SOURCE BRUT (et non dans les passes
// de transfo) car `$X` est AUSSI la forme compilée légitime du singleton (le
// routage `µ$$X`→`$X`, l'`import { $X }`) — l'y détecter donnerait des faux
// positifs (double-passe analyzer `cleanJs∘tokenize`).
// `@import §§X` (ancienne écriture) est lui-même flaggé EN PREMIER, avant
// toute autre vérification — un singleton s'importe désormais en `µ$$X`,
// jamais en `§§X` (réservé au contexte d'ancêtres).
// ----------------------------------------------------------------------------
// le masquage ne couvrait
// QUE le HTML (`<pre>`/`<code>`/`<!-- -->`) : une CHAÎNE littérale (message
// d'erreur/log qui mentionne "$X" en exemple) ou un COMMENTAIRE de script
// (`// …`, `# …`, `/* … */`, `### … ###` Coffee) qui documente la migration
// (« ancien : $user, nouveau : µ$$user ») étaient scannés comme du VRAI code —
// une simple explication en commentaire ou un message de log faisait échouer
// la compilation d'un projet par ailleurs correct. Fix : même technique de
// masquage « par alternation » que compile.ts — les motifs de chaînes/
// commentaires sont posés EN PREMIER dans l'alternation, l'un d'eux consomme
// tout le bloc (chaîne entière ou commentaire jusqu'à sa fin) avant que le nom
// du singleton ne puisse y être testé. `###…###` AVANT le `#…` générique
// (sinon le `#` générique, essayé en premier dans l'ordre naturel du texte,
// ne consommerait qu'UNE ligne du bloc Coffee multi-ligne). Remplacement par
// des espaces (pas une suppression) : préserve les positions et évite de
// recoller accidentellement deux fragments en un nouveau motif involontaire.
export const MASK_STRINGS_AND_COMMENTS_RE =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|###[\s\S]*?###|\/\/[^\n]*|#[^\n]*/g

// Une chaîne se blanchit sauf ses interpolations, qui sont du code : `"#{$X.a}"`
// lit vraiment `$X` (même refus qu'hors d'une chaîne), le texte autour non. Le
// gabarit (tout ce qui n'est pas un bloc <script>) se lit comme ses expressions :
// `#{…}` entre guillemets doubles et dans `"""…"""`, `${…}` dans un gabarit à
// backtick, imbriqués à toute profondeur (une chaîne écrite dans l'interpolation
// garde ses propres interpolations) ; `'…'` et `'''…'''` restent du texte, une
// interpolation échappée (`\#{…}`) aussi. Une chaîne entre guillemets simples ou
// doubles tient sur sa ligne (sinon ce n'est pas une chaîne : une apostrophe de la
// prose n'avale pas les lignes suivantes) ; commentaires `/*…*/` blanchis, `//…`
// dans le code d'une interpolation (`#{…}`, `${…}`) seulement : ailleurs dans le
// gabarit (la prose, une valeur d'attribut, une expression `{…}`, que ce lecteur ne
// distingue pas de la prose), `//` est une adresse (`https://…`, `//cdn…`), pas un
// commentaire — blanchi jusqu'à la fin de la ligne, il cacherait la lecture qui le
// suit. Le corps d'un bloc <style> (`feuille`) blanchit `//…` partout : c'est le
// commentaire de SASS et de SCSS.
// `#` n'y ouvre pas de commentaire : la prose l'écrit (« N° #1 », « C# ») et les
// expressions du gabarit sont du Civet, où il vaut `this.length` — blanchi, il
// cacherait la lecture qui le suit sur sa ligne. Longueur préservée
function maskTemplateKeepInterpolations(src: string, feuille = false): string {
  const n     = src.length
  const chars = src.split('')
  const blank = (from: number, to: number): void => { for (let k = from; k < to && k < n; k++) if (chars[k] !== '\n') chars[k] = ' ' }
  // la chaîne ouverte en `open` (texte dès `j`) jusqu'à son délimiteur, interpolations gardées comme code ; -1 si une chaîne d'une
  // ligne n'est pas refermée sur sa ligne (rien n'est alors blanchi)
  const text = (open: number, j: number, close: string, interp: string | null, uneLigne: boolean): number => {
    const vides: Array<[number, number]> = []
    let from = open
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue }
      if (uneLigne && src[j] === '\n') return -1
      if (src.startsWith(close, j)) {
        for (const [a, b] of vides) blank(a, b)
        blank(from, j + close.length)
        return j + close.length
      }
      if (interp && src.startsWith(interp, j)) {
        vides.push([from, j + interp.length])
        const end = code(j + interp.length, true)
        from = end
        j    = end + 1
        continue
      }
      j++
    }
    if (uneLigne) return -1
    for (const [a, b] of vides) blank(a, b)
    blank(from, n)
    return n
  }
  const closeAt = (j: number, close: string): number => { const e = src.indexOf(close, j); return e < 0 ? n : e + close.length }
  const lineEnd = (j: number): number => { const e = src.indexOf('\n', j); return e < 0 ? n : e }
  // code dès `i` ; dans une interpolation, s'arrête sur l'accolade fermante appariée et rend son index
  const code = (i: number, inside: boolean): number => {
    let depth = 0
    while (i < n) {
      const c = src[i]
      if (inside && c === '{') depth++
      if (inside && c === '}') {
        if (depth === 0) return i
        depth--
      }
      if (src.startsWith('"""', i)) { i = text(i, i + 3, '"""', '#{', false); continue }
      if (src.startsWith("'''", i)) { i = text(i, i + 3, "'''", null, false); continue }
      if (src.startsWith('/*', i)) { const e = closeAt(i + 2, '*/'); blank(i, e); i = e; continue }
      if ((inside || feuille) && src.startsWith('//', i)) { const e = lineEnd(i); blank(i, e); i = e; continue }
      if (c === '`') { i = text(i, i + 1, '`', '${', false); continue }
      if (c === '"' || c === "'") {
        const e = text(i, i + 1, c, c === '"' ? '#{' : null, true)
        i = e === -1 ? i + 1 : e
        continue
      }
      i++
    }
    return i
  }
  code(0, false)
  return chars.join('')
}

// le fichier tel que le lit le refus des singletons, même longueur : chaque bloc <script> dans son langage (maskNonCode — `#{…}`
// n'interpole qu'en Civet et en Coffee, jamais en JavaScript ni en TypeScript, où une chaîne entre guillemets doubles reste du texte),
// le corps de chaque bloc <style> avec ses commentaires SASS (`//…`, `/*…*/`), le reste par maskTemplateKeepInterpolations. Les blocs
// sont ceux que trouve extractSections (findScriptMatches et findStyleMatches, sur une vue masquée : attributs relus dans le texte par
// leurs positions), langage lu par extractLang
function maskLiteralsKeepInterpolations(source: string, defaultScriptLang: string): string {
  const { moduleScripts, scripts } = findScriptMatches(source)
  const lu    = (plage: [number, number]): string => source.slice(plage[0], plage[1])
  const blocs = [
    ...moduleScripts.map(m => ({ attrs: lu(m.indices![1]) + ' ' + lu(m.indices![2]), corps: m.indices![3], feuille: false })),
    ...scripts.map(m => ({ attrs: lu(m.indices![1]), corps: m.indices![2], feuille: false })),
    ...findStyleMatches(source, [...moduleScripts, ...scripts]).matches.map(m => ({ attrs: '', corps: m.indices![2], feuille: true })),
  ].sort((a, b) => a.corps[0] - b.corps[0])
  let out = ''
  let pos = 0
  for (const { attrs, corps: [debut, fin], feuille } of blocs) {
    if (debut < pos) continue
    const corps = source.slice(debut, fin)
    out += maskTemplateKeepInterpolations(source.slice(pos, debut)) + (feuille ? maskTemplateKeepInterpolations(corps, true) : maskNonCode(corps, extractLang(attrs) ?? defaultScriptLang))
    pos  = fin
  }
  return out + maskTemplateKeepInterpolations(source.slice(pos))
}

// Retourne les noms importés (`singletonImports`) — réutilisés par la
// pré-passe 0-bis de `transpile()` juste en dessous (µ$$X → $X), pour ne pas
// rescanner deux fois les mêmes lignes `@import`.
export function lintSingletonConsume(source: string, defaultScriptLang = 'civet'): Set<string> {
  // « @import §§NOM » (ancienne écriture) : un singleton s'importe désormais
  // en `µ$$NOM` — erreur de migration immédiate, AVANT toute réécriture (la
  // pré-passe 0-bis n'a pas encore tourné). Masque `<pre>`/`<code>` d'abord :
  // un tuto qui AFFICHE `@import §§X` comme exemple ne doit pas throw.
  const docless = source
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '')
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, '')
  for (const line of docless.match(/^[ \t]*@import\b[^\n]*$/gm) ?? []) {
    const bad = line.match(/§§([a-zA-Z0-9_]+)/)
    if (bad) {
      throw new Error(t('transpiler.import-singleton-ancienne-forme', { nom: bad[1] }))
    }
  }

  const singletonImports = new Set<string>()
  source.replace(/^[ \t]*@import\b[^\n]*$/gm, (line: string) => {
    for (const mm of line.matchAll(/µ\$\$([a-zA-Z0-9_]+)/g)) singletonImports.add(mm[1])
    return line
  })
  if (singletonImports.size === 0) return singletonImports
  // Masque ce qui n'est PAS une consommation réelle : lignes @import (l'import
  // lui-même), blocs de doc `<pre>`/`<code>`, commentaires HTML, texte littéral
  // des chaînes (leurs interpolations restent) et commentaires de script (cf. plus haut).
  const sansDoc = source
    .replace(/^[ \t]*@import\b[^\n]*$/gm, '')
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '')
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, '')
    .replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, '')
  const scan    = maskLiteralsKeepInterpolations(sansDoc, defaultScriptLang)
  // `$$NOM` ne se cherche que hors des chaînes : dans une interpolation, le lexeur (script) et le générateur (gabarit)
  // le refusent eux-mêmes, avec le message du store global et, dans un script, la position de la faute
  const scanHorsChaines = sansDoc.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => ' '.repeat(m.length))
  for (const name of singletonImports) {
    // Interdits : `$NOM` (bare), `$$NOM` (store global) — jamais `µ$$NOM`
    // (désormais la forme CORRECTE, exclue via le lookbehind `(?<!µ)`) — et
    // `§§NOM` (piège de migration nº1, cf. header).
    const storeGlobal = new RegExp(`(?<!µ)(?<![\\w§$])\\$\\$${name}(?![\\w])`)
    const re          = new RegExp(
      `(?<![\\w§$])\\$${name}(?![\\w])` +
      `|(?<![\\w.§])§§${name}(?![\\w])`
    )
    if (storeGlobal.test(scanHorsChaines) || re.test(scan)) {
      throw new Error(t('transpiler.singleton-mauvaise-consommation', { nom: name }))
    }
  }
  return singletonImports
}

// ----------------------------------------------------------------------------
// lintImportDollarName — un NOM importé ne porte jamais `$` seul : un singleton s'importe et
// se consomme UNIQUEMENT par `µ$$X` (docs/14-stores.md
// § « Un seul symbole, un seul rôle »), jamais `@import $X`. DOIT tourner ICI, AVANT la pré-passe
// 0-bis (µ$$X → $X, juste en dessous) : sur le source déjà aplati par 0-bis, un `$counter` issu de
// `µ$$counter` serait indiscernable d'un `$counter` tapé à la main (la garde
// avait alors été revertée faute de cette place — remise ici). Blocs de doc (`<pre>`/`<code>`/
// commentaires HTML) masqués via maskDocBlocks : un tuto qui AFFICHE `@import $x` en exemple ne
// doit jamais throw.
// ----------------------------------------------------------------------------
export function lintImportDollarName(source: string): void {
  const { masked } = maskDocBlocks(source)
  const bad = masked.match(/^[ \t]*@import\s+(?:default\s+)?[^'"]*?(?<![µ$])(\$[a-zA-Z_]\w*)/m)
  if (!bad) return
  const nom = bad[1]
  throw new Error(t('transpiler.import-nom-dollar', { nom, base: nom.slice(1) }))
}

// ----------------------------------------------------------------------------
// lintEffectTopLevel — µeffect/µinspect (formes pointées µ.effect/µ.inspect
// comprises) ne sont valides qu'au TOP-LEVEL du <script> d'un composant :
// l'enregistrement runtime exige `µ.activeComponent` (mjs_runes.ts), posé
// pendant l'init (jsInit) et les batchs de render — un appel depuis un
// handler/@méthode/setTimeout arrive HORS de ces fenêtres → `µ.warn` + effet
// IGNORÉ en silence. Pire dans un hook : `µmount` est invoqué tantôt dans le
// batch microtask (activeComponent posé, mjs_element.ts ~1931), tantôt dans le
// fast-path sync (PAS posé, ~1812) — l'effet s'enregistre ou se perd selon
// le CHEMIN de rendu. On tranche à la COMPILATION, sur le SOURCE (Civet/Coffee,
// indentation significative), tout juste extrait par extractSections (donc
// post-dedent) et AVANT les appends générés (persist/macros/includes émettent
// leurs propres µeffect, légitimes, jamais scannés ici) :
//   - occurrence dans une enveloppe (méthode, hook, cb, objet), quel que soit son retrait, sauf sous des blocs de
//     contrôle (`if`, `for`, `try`…) tous ouverts depuis le premier niveau (effetImbrique) ;
//   - occurrence précédée sur SA ligne de `->` / `=>` / `do` → callback inline
//     même en colonne 0 (`setTimeout -> µeffect ->`).
// Le <script module>, lui, s'exécute à l'IMPORT du fichier généré (jsModule
// émis AVANT la classe, cf. injectTemplate) : JAMAIS de composant actif →
// TOUTE occurrence y est invalide, top-level compris. Chaînes et commentaires
// neutralisés par MASK_STRINGS_AND_COMMENTS_RE, remplacement espace-à-espace
// qui PRÉSERVE les `\n` (numéro de ligne exact dans le message) — même limite
// assumée que lintSingletonConsume sur les heredocs `"""…"""`.
const EFFECT_RUNE_RE   = /(?<![\w$.])(µ\.?(?:effect|inspect))(?![\w$])/g
const NESTED_BEFORE_RE = /->|=>|(?<![\w$])do(?![\w$])/
// ligne qui ouvre un bloc de contrôle (condition, boucle, essai), `}` d'un bloc js précédent toléré en tête
const BLOC_DE_CONTROLE_RE = /^[ \t]*(?:\}[ \t]*)?(?:if|else|unless|for|while|until|loop|switch|when|case|default|try|catch|finally)(?![\w$])/

// le corps d'un `if` ou d'un `for` de premier niveau s'exécute à l'initialisation, comme le premier niveau lui-même : un
// µeffect y fonctionne. Toute autre enveloppe (fonction, méthode, hook, rappel, objet, expression sur plusieurs lignes) garde
// le refus. Le jugement suit la structure du script (structureDuScript) et non le texte d'une ligne : une accolade se juge sur
// l'instruction qu'elle ouvre, une regex n'ouvre ni ne ferme rien, et le corps d'une fonction est refusé quel que soit le retrait
const FONCTION_RE         = /(?<![\w$])function(?![\w$])/
const ouvreUneFonction    = (texte: string): boolean => NESTED_BEFORE_RE.test(texte) || FONCTION_RE.test(texte)
const ouvreBlocDeControle = (texte: string): boolean => BLOC_DE_CONTROLE_RE.test(texte) && !ouvreUneFonction(texte)

// masque de MASK_STRINGS_AND_COMMENTS_RE, sauf un `#` qui suit un point (`this.#n`) : champ privé du JavaScript, jamais un
// commentaire CoffeeScript — masqué jusqu'à la fin de la ligne, il emportait l'accolade qui le suit (`get n() { return this.#n }`).
// Une chaîne sur plusieurs lignes (`"""…"""`, `'''…'''`) se lit d'un bloc, et un gabarit jusqu'à l'accent grave de son niveau
// (`${…}` imbriqués compris, scanTemplateAt du lexeur) : une accolade écrite dedans n'ouvre ni ne ferme rien
const MASQUE_EFFET_RE = /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`|\/\*[\s\S]*?\*\/|###[\s\S]*?###|\/\/[^\n]*|(?<!\.)#[^\n]*/g
// gabarit lu comme avant (jusqu'à l'accent grave suivant) quand ses `${…}` ne se referment pas
const GABARIT_SIMPLE_RE = /`(?:[^`\\]|\\.)*`/y

function masqueEffet(src: string): string {
  let out = ''
  let pos = 0
  MASQUE_EFFET_RE.lastIndex = 0
  for (let m = MASQUE_EFFET_RE.exec(src); m !== null; m = MASQUE_EFFET_RE.exec(src)) {
    let fin = m.index + m[0].length
    if (m[0] === '`') {
      fin = scanTemplateAt(src, m.index)
      if (fin === -1) {
        GABARIT_SIMPLE_RE.lastIndex = m.index
        fin = GABARIT_SIMPLE_RE.exec(src) ? GABARIT_SIMPLE_RE.lastIndex : -1
      }
      // accent grave jamais refermé : du texte
      if (fin === -1) continue
    }
    out += src.slice(pos, m.index) + src.slice(m.index, fin).replace(/[^\n]/g, ' ')
    pos = fin
    MASQUE_EFFET_RE.lastIndex = fin
  }
  return out + src.slice(pos)
}

interface Accolade { ouvre: number, ferme: number, controle: boolean }
interface StructureDuScript { texte: string, accolades: Accolade[], suites: boolean[] }

// script masqué de ses chaînes et commentaires, lu caractère par caractère : ses regex sont masquées à leur tour (même lecture
// que finExpression, `/\{/`, `/[{]/` ou `/}/` n'ouvrent ni ne ferment rien) et chaque accolade est jugée sur l'instruction
// qu'elle ouvre, lue depuis son début — dernier `;`, `{` ou `}`, ou fin de ligne hors parenthèse —, condition sur plusieurs
// lignes comprise (`if (a &&` puis `    b) {`). Rend le texte sans ses regex, les accolades et, par ligne, si elle continue une
// parenthèse ouverte plus haut
function structureDuScript(masque: string): StructureDuScript {
  let texte = masque
  const accolades: Accolade[] = []
  const pile: { accolade: Accolade, parens: number, debut: number, precedente: string }[] = []
  const suites = [false]
  let parens     = 0    // parenthèses et crochets ouverts depuis l'accolade englobante
  let debut      = 0    // début de l'instruction en cours
  let precedente = ''   // instruction de la ligne d'avant : celle d'une accolade seule sur sa ligne
  for (let p = 0; p < texte.length; p++) {
    const c = texte[p]
    if (c === '/' && ouvreUneRegex(texte.slice(0, p))) {
      const fin = scanRegexLiteral(texte, p)
      if (fin !== -1) {
        texte = texte.slice(0, p) + ' '.repeat(fin - p) + texte.slice(fin)
        p = fin - 1
        continue
      }
    }
    if (c === '(' || c === '[') parens++
    else if ((c === ')' || c === ']') && parens > 0) parens--
    else if (c === '{') {
      const accolade = { ouvre: p, ferme: -1, controle: ouvreBlocDeControle(texte.slice(debut, p).trim() || precedente) }
      accolades.push(accolade)
      pile.push({ accolade, parens, debut, precedente })
      parens     = 0
      debut      = p + 1
      precedente = ''
    }
    else if (c === '}') {
      const ouverte = pile.pop()
      if (ouverte) {
        ouverte.accolade.ferme = p
        parens = ouverte.parens
      }
      // accolade prise dans une parenthèse (objet en argument, rappel) : l'instruction qui l'englobe continue
      if (ouverte && ouverte.parens > 0) {
        debut      = ouverte.debut
        precedente = ouverte.precedente
      }
      else {
        debut      = p + 1
        precedente = ''
      }
    }
    else if (c === ';' && parens === 0) {
      debut      = p + 1
      precedente = ''
    }
    else if (c === '\n') {
      suites.push(parens > 0)
      if (parens === 0) {
        const instruction = texte.slice(debut, p).trim()
        if (instruction) precedente = instruction
        debut = p + 1
      }
    }
  }
  return { texte, accolades, suites }
}

// imbriqué si une accolade encore ouverte à la `position` de l'occurrence n'ouvre pas un bloc de contrôle, ou, pour une ligne
// indentée, si une ligne qui l'englobe (moins indentée, en remontant jusqu'au premier niveau) n'en ouvre pas un — retraits de
// Civet et de CoffeeScript. Une ligne qui continue une parenthèse ouverte plus haut appartient à l'instruction de sa première
// ligne, jugée à sa place ; une fonction ouverte dans cette suite garde le refus
function effetImbrique(lines: string[], li: number, position: number, structure: StructureDuScript): boolean {
  if (structure.accolades.some(a => !a.controle && a.ouvre < position && (a.ferme === -1 || a.ferme > position))) return true
  let retrait = /^[ \t]*/.exec(lines[li])![0].length
  for (let k = li - 1; k >= 0 && retrait > 0; k--) {
    const ligne = lines[k]
    if (ligne.trim() === '') continue
    const r = /^[ \t]*/.exec(ligne)![0].length
    if (r >= retrait) continue
    if (structure.suites[k]) {
      if (ouvreUneFonction(ligne)) return true
      continue
    }
    if (!ouvreBlocDeControle(ligne)) return true
    retrait = r
  }
  return retrait > 0
}

// `firstLine` : ligne du fichier où commence `scriptSource` (le refus dans <script module> cite la ligne du `.mjs`)
export function lintEffectTopLevel(scriptSource: string, isModule = false, firstLine = 1): void {
  if (!scriptSource) return
  const masked = masqueEffet(scriptSource)
  if (!masked.includes('effect') && !masked.includes('inspect')) return
  const structure = structureDuScript(masked)
  const lines     = structure.texte.split('\n')
  let debutLigne  = 0
  for (let li = 0; li < lines.length; debutLigne += lines[li].length + 1, li++) {
    const line = lines[li]
    if (!line.includes('effect') && !line.includes('inspect')) continue
    EFFECT_RUNE_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = EFFECT_RUNE_RE.exec(line)) !== null) {
      const rune = m[1]
      if (isModule) {
        throw new Error(t('transpiler.rune-effect-dans-module', { rune, ligne: li + firstLine }))
      }
      if (effetImbrique(lines, li, debutLigne + m.index, structure) || NESTED_BEFORE_RE.test(line.slice(0, m.index))) {
        throw new Error(t('transpiler.rune-effect-imbriquee', { rune, ligne: li + firstLine }))
      }
    }
  }
}

// ----------------------------------------------------------------------------
  // lintEmitInModule — µemit/µ.emit interdit dans <script module> :
// this-rebinding.ts/template.ts) N'EXISTE PAS dans le module — code partagé
// exécuté à l'import, SANS instance de composant, donc sans aucun élément à
// qui faire émettre l'événement. Contrairement à lintEffectTopLevel, PAS de
// restriction « top-level seulement » : µemit reste légitime imbriqué dans un
// <script> normal (méthode, handler, objet utilisateur…) — c'est le
// <script module> ENTIER qui est refusé, toute profondeur confondue. Même
// masquage chaînes/commentaires que lintEffectTopLevel, même regex que la
// réécriture réelle (transformCodeOnly plus haut) : ce que la réécriture
// toucherait, ce lint le voit aussi — aucun écart entre détection et effet.
// ----------------------------------------------------------------------------
const EMIT_RUNE_RE = /µ\.?\s*emit\b/g

export function lintEmitInModule(moduleSource: string, firstLine = 1): void {
  if (!moduleSource) return
  const masked = moduleSource.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => m.replace(/[^\n]/g, ' '))
  const lines = masked.split('\n')
  for (let li = 0; li < lines.length; li++) {
    if (!lines[li].includes('emit')) continue
    EMIT_RUNE_RE.lastIndex = 0
    const m = EMIT_RUNE_RE.exec(lines[li])
    if (m) throw new Error(t('transpiler.rune-emit-dans-module', { rune: m[0], ligne: li + firstLine }))
  }
}

// ----------------------------------------------------------------------------
// lintOnUrlChangeLegacy — AVERTIT si le SOURCE du dev pose `@onUrlChange = ` /
// `this.onUrlChange = ` : c'est l'ancien slot V1 direct — mjs_router.ts, lui,
// n'appelle plus QUE `_mjs_hooks.urlChange`, posé par la rune
// `µurlChange (path, params) -> …` (cf. lexer §3.8c-pré). `@onUrlChange = ->`
// reste du Coffee/Civet banal (`@` = `this.`) : ça COMPILE sans erreur, mais le
// hook n'est alors JAMAIS invoqué par le routeur — panne SILENCIEUSE (aucune
// exception, juste une navigation qui n'atteint jamais le composant). Simple
// AVERTISSEMENT, pas une erreur : `onUrlChange` reste un nom de propriété légal
// pour tout autre usage (collision jugée assez improbable pour ne mériter qu'un
// signal). Même masquage chaînes/commentaires que lintEffectTopLevel (scan sur
// le source AVANT compilation, cf. MASK_STRINGS_AND_COMMENTS_RE).
// ----------------------------------------------------------------------------
const ON_URL_CHANGE_LEGACY_RE = /(?<![\w$])(?:@|this\.)onUrlChange\b\s*=(?!=)/

export function lintOnUrlChangeLegacy(scriptSource: string, moduleName: string, lint?: LintToggles, colorsEnabled = false, firstLine?: number): void {
  if (!scriptSource) return
  const masked = scriptSource.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => m.replace(/[^\n]/g, ' '))
  const found = ON_URL_CHANGE_LEGACY_RE.exec(masked)
  if (found) {
    // la ligne du .mjs quand on connaît celle où commence le script
    const ligne = firstLine === undefined ? '' : firstLine + (masked.slice(0, found.index).match(/\n/g)?.length ?? 0)
    const line = typedLine('legacy', t('transpiler.on-url-change-legacy', { moduleName, ligne }), lint)
    if (line !== null) printDiagnostic(line, colorsEnabled)
  }
}

// ----------------------------------------------------------------------------
// lintUndeclaredTopLevelAssignment — "bonus mémoire" : Civet (contrairement à Coffee) n'auto-déclare
// JAMAIS un nom via une simple assignation `nom = expr` — SEUL `nom := expr`
// déclare une NOUVELLE variable. **Vérifié empiriquement** (compilateur Civet
// direct) : `nom = -> ...` ET `nom = => ...` (les DEUX formes de fonction, pas
// spécifique à `=>` contrairement à ce que suggérait la mémoire d'origine)
// SANS `:=` compilent TOUS LES DEUX en une assignation NUE `nom = function(){}`,
// sans aucun `var`/`let`/`const` — au runtime, le module ES généré (TOUJOURS en
// mode strict) lève `ReferenceError: nom is not defined` dès l'exécution de
// cette ligne (pas juste un "module silencieusement inerte" : un CRASH garanti
// à l'init du composant). Les vars `$xxx` réactives échappent totalement à ce
// piège (compilées en `$.xxx`, un MemberExpression, jamais une assignation nue
// sur un Identifier) — seuls les noms LOCAUX PURS (fonctions/vars normales)
// sont concernés.
//
// Fix : détection SEULE (pas de réécriture automatique — décider entre "1ère
// déclaration, ajouter :=" et "ré-assignation d'un nom déclaré ailleurs dans
// une portée qu'on n'a pas vue" demanderait une analyse de scope complète,
// hors de portée d'un simple lint ; mieux vaut un signal explicite et sûr
// qu'une réécriture qui pourrait masquer un autre bug ou introduire un
// shadowing involontaire). Ne s'applique qu'à Civet (Coffee auto-déclare tout,
// aucun risque). Conservateur par construction : un nom déclaré N'IMPORTE OÙ
// dans le script (n'importe quelle portée) n'est PAS flaggé, pour zéro faux
// positif — au prix de rater d'éventuels vrais bugs de shadowing profond
// (compromis délibéré, cf. philosophie déjà établie de path-tracker.ts : mieux
// vaut sous-détecter que produire un faux positif qui casse un build correct).
// Parse acorn (sourceType module) mutualisé par les deux lints — `null` si le
// JS est vide ou ne parse pas (sortie langage exotique). PERF : permet de
// PARTAGER l'AST entre lintUndeclaredTopLevelAssignment et lintNoRawImport (2
// parse du même texte par section, ×2 avec le module → jusqu'à 4/composant).
// `locations` : positions de ligne dans l'AST, celles que lit le contrôle des constantes (findConstReassignment) quand il
// reçoit cet AST au lieu de relire le texte
export function parseModuleAst(js: string, locations = false): acorn.Node | null {
  if (!js) return null
  try {
    return acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', locations })
  } catch {
    return null
  }
}

// `preAst` (optionnel) : AST déjà parsé à réutiliser. `undefined` → la fonction
// parse elle-même (appel autonome/tests) ; `null` → parse déjà tenté et échoué
// en amont → no-op silencieux (mêmes sémantiques que l'ancien `catch { return }`).
export function lintUndeclaredTopLevelAssignment(js: string, lang: string, externalVars: string[] = [], preAst?: acorn.Node | null): void {
  if (lang !== 'civet' || !js) return

  const ast: acorn.Node | null = preAst !== undefined ? preAst : parseModuleAst(js)
  if (!ast) return

  // Passe 1 — collecte TOUS les noms déclarés n'importe où (var/let/const,
  // function, paramètres) : un nom déclaré QUELQUE PART n'est jamais suspect.
  const declared = new Set<string>()
  const collectPatternNames = (pat: any) => {
    if (!pat) return
    switch (pat.type) {
      case 'Identifier': declared.add(pat.name); break
      case 'ObjectPattern': for (const p of pat.properties ?? []) collectPatternNames(p.value ?? p.argument); break
      case 'ArrayPattern': for (const el of pat.elements ?? []) collectPatternNames(el); break
      case 'AssignmentPattern': collectPatternNames(pat.left); break
      case 'RestElement': collectPatternNames(pat.argument); break
    }
  }
  walk.full(ast, (node: any) => {
    switch (node.type) {
      case 'VariableDeclarator': collectPatternNames(node.id); break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) declared.add(node.id.name)
        for (const p of node.params ?? []) collectPatternNames(p)
        break
      case 'ClassDeclaration':
        if (node.id) declared.add(node.id.name)
        break
      case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier':
        if (node.local) declared.add(node.local.name)
        break
      case 'CatchClause': collectPatternNames(node.param); break
    }
  })
  for (const v of externalVars) declared.add(v.replace(/^\$+/, ''))

  // Passe 2 — assignations NUES au niveau PROGRAMME (jamais dans une fonction/
  // bloc : une assignation locale dans une fonction est un tout autre sujet,
  // hors de portée de ce lint qui cible spécifiquement le "module mort" au
  // top-level de <script>).
  for (const stmt of (ast as any).body) {
    if (stmt.type !== 'ExpressionStatement') continue
    const expr = stmt.expression
    if (!expr || expr.type !== 'AssignmentExpression' || expr.operator !== '=') continue
    if (expr.left.type !== 'Identifier') continue
    const name = expr.left.name
    if (declared.has(name)) continue
    throw new Error(t('transpiler.nom-jamais-declare', { nom: name }))
  }
}

// ----------------------------------------------------------------------------
// lintElementPropertyAtConstruction — le `<script>` tourne pendant la CONSTRUCTION de la balise du
// composant : `@title = …` à son premier niveau n'y pose pas une donnée mais la propriété `title`
// de la balise elle-même (HTMLElement). Deux familles, mesurées dans Chromium :
//   - lecture seule (`@children`, `@dataset`, `@offsetWidth`…) : l'écriture lève (module strict),
//     le composant tombe au montage, quel que soit son chemin de création — refusé au build ;
//     `Reflect.set` n'est pas de ceux-là : il rend `false` sans lever, jamais refusé pour cela ;
//   - reflet ou contenu (`@title`, `@id`, `@hidden`, `@part`, `@ariaLabel`, `@textContent`…) :
//     l'écriture pose un attribut ou un enfant sur la balise. Créée par `document.createElement`
//     (le routeur pour une page, `<@element>`, la relance d'un `<@failed>`), la balise est alors
//     refusée par le navigateur (« The result must not have attributes ») ; tirée d'un gabarit ou
//     de la page, elle vit, l'attribut en plus ; au rendu serveur, rien ne casse. Selon la valeur
//     même (`@hidden = false` ne pose rien) : averti, jamais refusé.
// Plus loin (µmount, méthode, écouteur) : libre.
// Une MÉTHODE de la balise que ModularJS appelle lui-même (`@setAttribute = …`, cf.
// ELEMENT_FRAMEWORK_METHODS) : refusée où que `this` soit la balise, pas seulement à la construction.
// ----------------------------------------------------------------------------
// propriétés en lecture seule de la balise : les écrire lève
const ELEMENT_READONLY_PROPS = new Set([
  'attributes', 'children', 'childNodes', 'firstChild', 'lastChild', 'firstElementChild', 'lastElementChild',
  'previousSibling', 'nextSibling', 'previousElementSibling', 'nextElementSibling', 'parentNode', 'parentElement',
  'childElementCount', 'nodeName', 'nodeType', 'tagName', 'localName', 'namespaceURI', 'prefix', 'ownerDocument',
  'isConnected', 'baseURI', 'shadowRoot', 'assignedSlot', 'dataset', 'attributeStyleMap', 'isContentEditable',
  'clientWidth', 'clientHeight', 'clientTop', 'clientLeft', 'offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft',
  'offsetParent', 'scrollWidth', 'scrollHeight',
])
// propriétés de la balise qui, écrites, posent un attribut (reflet) ou des enfants
const ELEMENT_REFLECTED_PROPS = new Set([
  'id', 'className', 'classList', 'slot', 'part', 'style', 'title', 'lang', 'translate', 'dir', 'hidden', 'inert',
  'accessKey', 'draggable', 'spellcheck', 'autocapitalize', 'autocorrect', 'autofocus', 'contentEditable',
  'enterKeyHint', 'inputMode', 'popover', 'tabIndex', 'writingSuggestions', 'role',
  'innerHTML', 'outerHTML', 'textContent', 'innerText', 'outerText',
])
// méthodes de la balise que ModularJS appelle lui-même sur une balise de composant, APRÈS son
// <script> — noms techniques, que personne ne prend pour une méthode à soi : masquées, c'est la
// fonction de l'auteur qui part à leur place et le composant cesse de marcher (runtime/) :
//   - attributs : setAttribute, getAttribute, removeAttribute au montage de chaque composant
//     (mjs_element.ts, connectedCallback), hasAttribute (slots indexés, @flip, @title) ;
//   - événements : dispatchEvent (µemit, liaisons), add/removeEventListener (µon d'un composant
//     léger, effets, transitions) ;
//   - contenu : appendChild, insertBefore, removeChild, replaceChild, replaceChildren (blocs du
//     contenu que la page lui confie, <@element>, <@failed>, zone de navigation), querySelector
//     (<@view> du routeur), querySelectorAll (retrait), getRootNode (événements délégués) ;
//   - mesure et animation : getBoundingClientRect, getClientRects, getAnimations (transitions,
//     @flip, effets), setPointerCapture (*goo), cloneNode (@viewTransition, couche de lévitation).
// Les noms naturels que le cadre appelle aussi (remove, contains, replaceWith, matches, closest,
// focus, click, animate) restent libres : un auteur les prend pour ses propres méthodes, c'est au
// cadre de ne pas dépendre d'eux. attachShadow et getAttributeNames ne servent qu'au constructeur,
// avant le <script> : libres aussi.
const ELEMENT_FRAMEWORK_METHODS = new Set([
  'setAttribute', 'getAttribute', 'removeAttribute', 'hasAttribute', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'appendChild', 'insertBefore', 'removeChild', 'replaceChild', 'replaceChildren', 'querySelector', 'querySelectorAll', 'getRootNode',
  'getBoundingClientRect', 'getClientRects', 'getAnimations', 'setPointerCapture', 'cloneNode',
])

// où `this` désigne le composant : le premier niveau du <script>, une flèche, une méthode posée sur lui
// (`@f = ->`), ou une fonction sans propriétaire (le rappel de `µmount ->`, `f = ->`) que le compilateur lit
// comme le composant (cf. generator/this-rebinding.ts). Une méthode de classe ou d'objet, un champ de
// classe : `this` y est autre chose. Une fonction que le <script> construit avec `new` ou rebranche (`f.call(obj)`)
// pose aussi ses propriétés ailleurs que sur le composant. `ancestors` : ceux du nœud, lui-même en dernier
function thisIsComponent(ancestors: any[], foreign: ForeignThis): boolean {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const a = ancestors[i]
    if (a.type === 'PropertyDefinition' || a.type === 'StaticBlock') return false
    if (a.type !== 'FunctionExpression' && a.type !== 'FunctionDeclaration') continue
    const parent = ancestors[i - 1]
    if (parent?.type === 'MethodDefinition' || parent?.type === 'Property') return false
    if (parent?.type === 'AssignmentExpression' && parent.right === a && parent.left?.type === 'MemberExpression') {
      const owner  = parent.left.object
      const direct = owner?.type === 'ThisExpression'
      if (!direct && !(owner?.type === 'Identifier' && owner.name === '_mjsThis')) return false
      if (!parent.left.computed && foreign.members.has(parent.left.property?.name)) return false
      if (direct) continue
      return true
    }
    const names = [a.id?.name, parent?.type === 'VariableDeclarator' && parent.init === a ? parent.id?.name : undefined, parent?.type === 'AssignmentExpression' && parent.right === a ? parent.left?.name : undefined]
    return !names.some(n => n !== undefined && foreign.names.has(n))
  }
  return true
}

// les fonctions que le <script> ne laisse pas être le composant : celles qu'il construit avec `new` (`new Fake 1`,
// `new @Emitter`) ou appelle avec un autre `this` (`f.call(obj)`, `.apply`, `.bind`) ; `call(@)` garde le composant.
// Lues par leur nom, sans portée : un homonyme construit ailleurs la dispense aussi — un contrôle peut manquer une
// écriture, jamais refuser à tort
interface ForeignThis { names: Set<string>, members: Set<string> }

function collectForeignThis(ast: acorn.Node): ForeignThis {
  const names   = new Set<string>()
  const members = new Set<string>()
  const retain  = (target: any): void => {
    if (target?.type === 'Identifier') names.add(target.name)
    else if (target?.type === 'MemberExpression' && !target.computed && target.property?.type === 'Identifier' && (target.object?.type === 'ThisExpression' || (target.object?.type === 'Identifier' && target.object.name === '_mjsThis'))) members.add(target.property.name)
  }
  walk.simple(ast, {
    NewExpression(node: any) { retain(node.callee) },
    CallExpression(node: any) {
      const c = node.callee
      if (c?.type !== 'MemberExpression' || c.computed || !['call', 'apply', 'bind'].includes(c.property?.name)) return
      const first = node.arguments[0]
      if (first?.type === 'ThisExpression' || (first?.type === 'Identifier' && first.name === '_mjsThis')) return
      retain(c.object)
    },
  })
  return { names, members }
}

// ce que le <script> dit de `this` : les fonctions qui ne sont pas le composant, et les alias du composant
// (`self = @`, `self := @`) — `self.nom = …` écrit sur lui. Un alias suit sa portée, à la fonction près : un
// nom lié dans une fonction (variable, paramètre, fonction, classe) lui appartient ; l'alias n'en est un que si
// toutes ses écritures de cette portée sont `= this` — réaffecté à autre chose (`self = {}`, une variable de
// boucle, un paramètre), il cesse d'en être un
interface ThisInfo { foreign: ForeignThis, isAlias: (name: string, ancestors: any[]) => boolean }

const FUNCTION_NODES = new Set(['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'])

// les noms que lie un motif (paramètre, déclaration, déstructuration)
function patternNames(pat: any, out: string[] = []): string[] {
  switch (pat?.type) {
    case 'Identifier':        out.push(pat.name); break
    case 'ObjectPattern':     for (const p of pat.properties) patternNames(p.type === 'RestElement' ? p.argument : p.value, out); break
    case 'ArrayPattern':      for (const el of pat.elements) patternNames(el, out); break
    case 'AssignmentPattern': patternNames(pat.left, out); break
    case 'RestElement':       patternNames(pat.argument, out); break
  }
  return out
}

function analyzeThis(ast: acorn.Node): ThisInfo {
  const foreign = collectForeignThis(ast)
  const bound   = new Map<any, Set<string>>()
  const defs    = new Map<any, Set<string>>()
  const others  = new Map<any, Set<string>>()
  const add     = (table: Map<any, Set<string>>, scope: any, names: string[]): void => {
    if (!table.has(scope)) table.set(scope, new Set())
    for (const n of names) table.get(scope)!.add(n)
  }
  // la fonction englobante (ou la racine) d'un nœud : `ancestors`, lui-même en dernier
  const scopeOfNode = (ancestors: any[]): any => {
    for (let i = ancestors.length - 1; i > 0; i--) if (FUNCTION_NODES.has(ancestors[i].type)) return ancestors[i]
    return ancestors[0]
  }
  // la portée où `name` est lié, vu d'un nœud : la fonction la plus proche qui le lie, sinon la racine
  const scopeOfName = (name: string, ancestors: any[]): any => {
    for (let i = ancestors.length - 1; i > 0; i--) if (FUNCTION_NODES.has(ancestors[i].type) && bound.get(ancestors[i])?.has(name)) return ancestors[i]
    return ancestors[0]
  }
  walk.ancestor(ast, {
    VariableDeclarator(node: any, _st: unknown, ancestors: any[]) { add(bound, scopeOfNode(ancestors), patternNames(node.id)) },
    FunctionDeclaration(node: any, _st: unknown, ancestors: any[]) {
      add(bound, scopeOfNode(ancestors.slice(0, -1)), patternNames(node.id))
      add(bound, node, node.params.flatMap((p: any) => patternNames(p)))
    },
    FunctionExpression(node: any) { add(bound, node, node.params.flatMap((p: any) => patternNames(p))) },
    ArrowFunctionExpression(node: any) { add(bound, node, node.params.flatMap((p: any) => patternNames(p))) },
    ClassDeclaration(node: any, _st: unknown, ancestors: any[]) { add(bound, scopeOfNode(ancestors.slice(0, -1)), patternNames(node.id)) },
    CatchClause(node: any, _st: unknown, ancestors: any[]) { add(bound, scopeOfNode(ancestors), patternNames(node.param)) },
  })
  // les noms liés qui ne sont pas un alias : paramètres, fonctions, classes, imports, variables de boucle et toute écriture d'autre chose
  const other = (name: string, ancestors: any[]): void => add(others, scopeOfName(name, ancestors), [name])
  const write = (target: any, ancestors: any[], alias: boolean): void => {
    for (const name of patternNames(target)) {
      if (alias && target.type === 'Identifier') add(defs, scopeOfName(name, ancestors), [name])
      else other(name, ancestors)
    }
  }
  walk.ancestor(ast, {
    VariableDeclarator(node: any, _st: unknown, ancestors: any[]) {
      const head = ancestors.at(-3)
      if (node.init) write(node.id, ancestors, node.init.type === 'ThisExpression' && thisIsComponent(ancestors, foreign))
      else if ((head?.type === 'ForInStatement' || head?.type === 'ForOfStatement') && head.left === ancestors.at(-2)) write(node.id, ancestors, false)
    },
    AssignmentExpression(node: any, _st: unknown, ancestors: any[]) { write(node.left, ancestors, node.operator === '=' && node.right?.type === 'ThisExpression' && thisIsComponent(ancestors, foreign)) },
    UpdateExpression(node: any, _st: unknown, ancestors: any[]) { write(node.argument, ancestors, false) },
    ForInStatement(node: any, _st: unknown, ancestors: any[]) { if (node.left.type !== 'VariableDeclaration') write(node.left, ancestors, false) },
    ForOfStatement(node: any, _st: unknown, ancestors: any[]) { if (node.left.type !== 'VariableDeclaration') write(node.left, ancestors, false) },
    FunctionDeclaration(node: any, _st: unknown, ancestors: any[]) {
      if (node.id) other(node.id.name, ancestors.slice(0, -1))
      for (const name of node.params.flatMap((p: any) => patternNames(p))) add(others, node, [name])
    },
    FunctionExpression(node: any) { for (const name of node.params.flatMap((p: any) => patternNames(p))) add(others, node, [name]) },
    ArrowFunctionExpression(node: any) { for (const name of node.params.flatMap((p: any) => patternNames(p))) add(others, node, [name]) },
    ClassDeclaration(node: any, _st: unknown, ancestors: any[]) { if (node.id) other(node.id.name, ancestors.slice(0, -1)) },
    CatchClause(node: any, _st: unknown, ancestors: any[]) { for (const name of patternNames(node.param)) other(name, ancestors) },
    ImportSpecifier(node: any, _st: unknown, ancestors: any[]) { other(node.local.name, ancestors) },
    ImportDefaultSpecifier(node: any, _st: unknown, ancestors: any[]) { other(node.local.name, ancestors) },
    ImportNamespaceSpecifier(node: any, _st: unknown, ancestors: any[]) { other(node.local.name, ancestors) },
  })
  const isAlias = (name: string, ancestors: any[]): boolean => {
    const scope = scopeOfName(name, ancestors)
    return defs.get(scope)?.has(name) === true && !others.get(scope)?.has(name)
  }
  return { foreign, isAlias }
}

// `obj` désigne-t-il le composant : `this` (partout, ou seulement là où il vaut le composant), `_mjsThis`
// (forme compilée de `@@`), un alias de `this`
function isComponentRef(obj: any, ancestors: any[], info: ThisInfo, everywhere = false): boolean {
  if (obj?.type === 'ThisExpression') return everywhere || thisIsComponent(ancestors, info.foreign)
  return obj?.type === 'Identifier' && (obj.name === '_mjsThis' || info.isAlias(obj.name, ancestors))
}

// les accès `obj.nom` que écrit une cible d'affectation : elle-même, ou ceux d'un motif de déstructuration
// (`[@a, { k: @b }, ...@c] = …`)
function memberTargets(target: any): any[] {
  if (!target) return []
  switch (target.type) {
    case 'MemberExpression':  return [target]
    case 'ArrayPattern':      return target.elements.flatMap((el: any) => memberTargets(el))
    case 'ObjectPattern':     return target.properties.flatMap((p: any) => memberTargets(p.type === 'RestElement' ? p.argument : p.value))
    case 'AssignmentPattern': return memberTargets(target.left)
    case 'RestElement':       return memberTargets(target.argument)
  }
  return []
}

// le texte d'une clé écrite en dur : `'nom'`, `"nom"`, un gabarit sans expression ; null sinon
function literalKey(k: any): string | null {
  if (k?.type === 'Literal' && typeof k.value === 'string') return k.value
  if (k?.type === 'TemplateLiteral' && k.expressions.length === 0 && k.quasis.length === 1) return k.quasis[0].value.cooked
  return null
}

// le nom qu'écrit un accès `obj.nom`, `obj['nom']` ; null quand il ne se lit pas (clé calculée à l'exécution)
function memberName(m: any): string | null {
  if (!m.computed) return m.property?.type === 'Identifier' ? m.property.name : null
  return literalKey(m.property)
}

// `Object.assign(obj, { nom: … })`, `Object.defineProperty(obj, 'nom', …)`, `Object.defineProperties`,
// `Reflect.set` : l'objet visé et les noms posés dessus ; `open` quand un nom ne se lit pas (un spread, un
// objet construit ailleurs, une clé calculée) ; `definition` quand l'appel redéfinit la propriété sans l'écrire
// (`defineProperty`, `defineProperties`) : rien ne lève, rien n'est posé sur la balise ; `withoutThrow` pour
// `Reflect.set`, qui écrit mais rend `false` sur une propriété en lecture seule au lieu de lever
function callWrites(call: any): { target: any, names: string[], open: boolean, definition: boolean, withoutThrow: boolean } | null {
  const c = call.callee
  if (c?.type !== 'MemberExpression' || c.computed || c.object?.type !== 'Identifier' || c.property?.type !== 'Identifier') return null
  const args: any[] = call.arguments
  if (args.length === 0) return null
  const names: string[] = []
  let open = false
  const listKeys = (o: any): void => {
    if (o?.type !== 'ObjectExpression') { open = true; return }
    for (const p of o.properties) {
      const name = p.type !== 'Property' ? null : !p.computed && p.key?.type === 'Identifier' ? p.key.name : literalKey(p.key)
      if (name === null) open = true
      else names.push(name)
    }
  }
  const addKey = (k: any): void => {
    const name = literalKey(k)
    if (name === null) open = true
    else names.push(name)
  }
  switch (`${c.object.name}.${c.property.name}`) {
    case 'Object.assign':           for (const a of args.slice(1)) listKeys(a); break
    case 'Object.defineProperties': listKeys(args[1]); break
    case 'Object.defineProperty':
    case 'Reflect.defineProperty':
    case 'Reflect.set':             addKey(args[1]); break
    default:                        return null
  }
  return { target: args[0], names, open, definition: c.property.name.startsWith('define'), withoutThrow: c.property.name === 'set' && c.object.name === 'Reflect' }
}

// les noms que le <script> pose sur l'instance (`@sock = …`), où que ce soit : en tête, ou dans une
// fonction (une connexion ouverte une fois l'utilisateur connecté) — `this.nom` ou `_mjsThis.nom`, par une
// affectation, une déstructuration (`[@sock] = …`), `Object.assign @, { sock }`, un alias (`self = @`).
// Une écriture dont le nom ne se lit pas au build (`@[nom] = …`, `Object.assign @, reglages`) pourrait poser
// n'importe lequel : `sock` est alors compté, plutôt qu'une fausse erreur
export function collectInstanceProps(ast: acorn.Node | null): string[] {
  const names = new Set<string>()
  if (!ast) return []
  const info = analyzeThis(ast)
  let open = false
  const written = (target: any, ancestors: any[]): void => {
    for (const m of memberTargets(target)) {
      if (!isComponentRef(m.object, ancestors, info, true)) continue
      const name = memberName(m)
      if (name === null) open = true
      else names.add(name)
    }
  }
  walk.ancestor(ast, {
    AssignmentExpression(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    ForInStatement(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    ForOfStatement(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    CallExpression(node: any, _st: unknown, ancestors: any[]) {
      const w = callWrites(node)
      if (!w || !isComponentRef(w.target, ancestors, info, true)) return
      for (const name of w.names) names.add(name)
      if (w.open) open = true
    },
  })
  if (open) names.add('sock')
  return [...names]
}

// les noms que le code d'un gestionnaire du HTML pose sur le composant (`@sock = …`, `[@sock] = …`,
// `{ k: @sock } = …`), lus sur le texte : ce code n'est compilé qu'après le HTML, qui a besoin de ces noms
export function collectHandlerInstanceProps(code: string, lang: string): string[] {
  const names = new Set<string>()
  const stripped = maskNonCode(code, lang)
  for (const m of stripped.matchAll(/(?<![\w$.@])@@?([A-Za-z_]\w*)/g)) {
    const start = m.index!
    const end   = start + m[0].length
    if (/^\s*(?:\*\*|\?\?|\|\||&&|<<|>>>?|[-+*/%&|^?])?[:.]?=(?![=>])/.test(stripped.slice(end))) { names.add(m[1]); continue }
    // dans un motif de déstructuration : le groupe `[…]` ou `{…}` qui l'entoure est suivi d'un `=`
    const opening = Math.max(stripped.lastIndexOf('[', start), stripped.lastIndexOf('{', start))
    if (opening === -1) continue
    const closing = stripped.indexOf(stripped[opening] === '[' ? ']' : '}', end)
    if (closing !== -1 && !/[\]}]/.test(stripped.slice(opening + 1, start)) && /^\s*=(?![=>])/.test(stripped.slice(closing + 1))) names.add(m[1])
  }
  return [...names]
}

// Les écritures lues : `@nom = …`, `@['nom'] = …`, une déstructuration (`[@nom] = …`), `Object.assign @, { nom }`,
// `Object.defineProperty(@, 'nom', …)`, `Reflect.set`, par `@` ou par un alias (`self = @`) ; ce qui ne se
// voit pas au build reste libre : une clé calculée à l'exécution (`@[nom] = …`), un objet construit ailleurs
// (`Object.assign @, reglages`), le composant passé à une fonction. `lineOf(position du JS)` : la ligne du .mjs
export function lintElementPropertyAtConstruction(ast: acorn.Node | null, moduleName: string | undefined, lint?: LintToggles, colorsEnabled = false, lineOf?: (offset: number) => number | null): void {
  if (!ast) return
  const info    = analyzeThis(ast)
  const avertis = new Set<string>()
  // un nom écrit sur `obj` ; `ancestors` : ceux de l'écriture, `at` : sa position dans le JS compilé ;
  // `definition` : redéfini sans être écrit (defineProperty) — les méthodes du cadre y sont masquées comme
  // ailleurs, mais ni la lecture seule ni le reflet ne s'y appliquent ; `withoutThrow` : écrit par `Reflect.set`,
  // qui rend `false` sur une propriété en lecture seule au lieu de lever — le reflet, lui, s'écrit bel et bien
  const check = (obj: any, nom: string | null, ancestors: any[], at: number, definition = false, withoutThrow = false): void => {
    if (nom === null || !isComponentRef(obj, ancestors, info)) return
    if (ELEMENT_FRAMEWORK_METHODS.has(nom)) throw new Error(t('transpiler.methode-balise-masquee', { moduleName: moduleName ?? '?', nom }))
    if (definition) return
    // propriété : hors de toute fonction (flèche comprise), jouée pendant la construction
    if (ancestors.some((a: any) => a.type === 'FunctionExpression' || a.type === 'FunctionDeclaration' || a.type === 'ArrowFunctionExpression')) return
    if (ELEMENT_READONLY_PROPS.has(nom) && !withoutThrow) throw new Error(t('transpiler.propriete-balise-lecture-seule', { moduleName: moduleName ?? '?', nom }))
    if ((ELEMENT_REFLECTED_PROPS.has(nom) || /^aria[A-Z]/.test(nom)) && !avertis.has(nom)) {
      avertis.add(nom)
      const line = typedLine('naming', t('transpiler.propriete-balise-construction', { moduleName: moduleName ?? '?', nom, ligne: lineOf?.(at) ?? '' }), lint)
      if (line !== null) printDiagnostic(line, colorsEnabled)
    }
  }
  const written = (target: any, ancestors: any[]): void => {
    for (const m of memberTargets(target)) check(m.object, memberName(m), ancestors, m.start)
  }
  walk.ancestor(ast, {
    AssignmentExpression(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    UpdateExpression(node: any, _st: unknown, ancestors: any[]) { written(node.argument, ancestors) },
    ForInStatement(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    ForOfStatement(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    CallExpression(node: any, _st: unknown, ancestors: any[]) {
      const w = callWrites(node)
      if (w) for (const nom of w.names) check(w.target, nom, ancestors, node.start, w.definition, w.withoutThrow)
    },
  })
}

// la ligne du .mjs d'une position du JS compilé du <script>, lue dans la carte de source du compilateur (déjà
// décalée à la ligne du bloc) ; null sans carte ou sans repère : jamais une ligne inventée
export function sourceLineOf(js: string, mapJson: string | undefined, offset: number): number | null {
  if (!mapJson) return null
  const segments = decode(JSON.parse(mapJson).mappings ?? '')[js.slice(0, offset).split('\n').length - 1] ?? []
  const col      = offset - (offset > 0 ? js.lastIndexOf('\n', offset - 1) + 1 : 0)
  const marks    = segments.filter(s => s.length >= 4)
  const mark     = [...marks].reverse().find(s => s[0] <= col) ?? marks[0]
  return mark ? (mark[2] as number) + 1 : null
}

// ----------------------------------------------------------------------------
// lintNoRawImport — demande utilisateur :
// SEULE la directive `@import nom 'chemin'` (racine du fichier, résolue par
// le bundler → graphe de dépendances/watch) est un import MJS valide. Un
// `import … from …` ES classique écrit DANS un <script>/<script module> est
// syntaxiquement accepté par Civet/TS/JS (passe tel quel) et fonctionne même
// souvent (esbuild le résout ensuite comme un import Node/ESM normal) — mais
// échappe TOTALEMENT au graphe `partialDependents`/watch du bundler : deux
// mécanismes d'import parallèles et incohérents dans le même projet,
// silencieusement. Fix : erreur de compilation explicite dès qu'un import ES
// natif (statique OU dynamique) est détecté dans le JS déjà compilé d'un
// script/module — AST (acorn), jamais une regex sur le source Civet/Coffee
// brut (évite tout faux positif sur un commentaire/chaîne qui mentionne le
// mot "import"). Universel (pas de garde par langage comme
// lintUndeclaredTopLevelAssignment) : la règle porte sur la CONVENTION MJS
// elle-même, pas sur une particularité de compilation Civet — s'applique
// identiquement en js/ts/coffee/civet, tous compilés vers le même JS final
// à ce stade du pipeline. `@import` lui-même n'est jamais vu tel quel ici :
// c'est une directive RACINE, extraite du markup AVANT que script.raw/
// moduleSection.raw ne soient même isolés (cf. directives.ts) — MAIS sa
// RÉSOLUTION (`dir.pendingAutoImports`) est un VRAI `import ... from ...`
// préinjecté en tête de `moduleSection.raw` (seul endroit légal pour un
// import ES réel — cf. transpiler/index.ts "3. Auto-imports"), donc présent
// tel quel dans `moduleJs` : `allowedLeadingImports` exempte ces N premières
// `ImportDeclaration` (position de tête garantie par construction, jamais
// réordonnées par Civet/TS qui ne font que passthrough sur du JS déjà
// valide) — tout import AU-DELÀ de ce compte reste banni.
// `import()` dynamique — ASSOUPLI : la version précédente
// bannissait tout appel, littéral OU calculé. Doctrine affinée : seul un
// chemin LITTÉRAL (`node.source` de type `Literal`, ou `TemplateLiteral` SANS
// expression — équivalent à une chaîne figée) reste banni — le graphe de
// dépendances DOIT le voir passer par `@import`/`µimport` (cf. sigils.ts,
// rewriteMuImport) pour bénéficier du hash/watch. Un argument CALCULÉ
// (`Identifier`, `MemberExpression`, `CallExpression`, template AVEC
// expression…) est de toute façon INVISIBLE à ce graphe, quel que soit le
// verdict — l'interdire n'apportait donc aucune garantie, seulement une porte
// fermée sur le SEUL cas légitime restant : une URL connue exclusivement à
// l'exécution (jamais un chemin de fichier du projet, qui lui doit toujours
// passer par `@import`/`µimport`).
// ----------------------------------------------------------------------------
// clés catalogue substituables (entry serveur : cli.entry-*)
export function lintNoRawImport(js: string, sectionLabel: string, allowedLeadingImports = 0, preAst?: acorn.Node | null, keys?: { static?: MsgKey, dynamic?: MsgKey, reexport?: MsgKey }): void {
  if (!js) return
  // Early-out : sans `import` NI `from` dans le texte, aucun import ES
  // (statique/dynamique) ni ré-export `… from` n'est possible → inutile de
  // parser (cas ultra-majoritaire). Seulement en appel AUTONOME (preAst absent) ;
  // quand l'AST est partagé il est déjà disponible, on le réutilise.
  if (preAst === undefined && !js.includes('import') && !js.includes('from')) return
  const ast: acorn.Node | null = preAst !== undefined ? preAst : parseModuleAst(js)
  if (!ast) return
  let seenImports = 0
  for (const stmt of (ast as any).body) {
    // `export … from '…'` et `export * from '…'` résolvent un
    // spécificateur de module EXACTEMENT comme un import (échappent au graphe
    // partialDependents/watch) : bannis pareillement. Aucune exemption : la
    // directive `@import` ne génère JAMAIS de ré-export, seulement des imports.
    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportAllDeclaration') {
      if (stmt.source) {
        throw new Error(t(keys?.reexport ?? 'transpiler.reexport-es-interdit', { section: sectionLabel, source: stmt.source?.value ?? '?' }))
      }
      continue
    }
    if (stmt.type !== 'ImportDeclaration') continue
    seenImports++
    if (seenImports <= allowedLeadingImports) continue
    throw new Error(t(keys?.static ?? 'transpiler.import-es-classique-interdit', { section: sectionLabel, source: stmt.source?.value ?? '?' }))
  }
  walk.full(ast, (node: any) => {
    if (node.type !== 'ImportExpression') return
    // seule la forme STATIQUE reste interdite : `Literal` (`import('x')`)
    // ou `TemplateLiteral` SANS expression (`` import(`x.js`) ``, équivalent à
    // une chaîne figée). Tout le reste (Identifier, MemberExpression,
    // CallExpression, template AVEC expression…) est un argument CALCULÉ,
    // invisible au graphe de dépendances de toute façon — cf. commentaire de
    // doctrine ci-dessus.
    const spec = node.source
    const isStatic = spec?.type === 'Literal' || (spec?.type === 'TemplateLiteral' && spec.expressions.length === 0)
    if (!isStatic) return
    throw new Error(t(keys?.dynamic ?? 'transpiler.import-dynamique-interdit', { section: sectionLabel }))
  })
}

// ----------------------------------------------------------------------------
// controlerGestionnairesInline — refuse le lot de gestionnaires inline qui ne peut pas être émis
// tel quel. Deux refus, dans cet ordre :
//   — un gestionnaire qui réaffecte une CONSTANTE visible par closure (`compteur := 0` en Civet,
//     donc `const compteur` en JS), du `<script>` comme du `<script module>` : ces noms sont
//     prédéclarés comme les autres — sans quoi l'écriture partirait dans un `let` local,
//     silencieusement perdue — mais leur réaffectation lèverait « Assignment to constant
//     variable » au premier clic. Autant le dire au build, en nommant l'opérateur à changer ;
//   — un gestionnaire qui réaffecte un nom que le GABARIT lui met en portée (variable ou index
//     d'un `{for}`, `{const}`, valeur `{success}`/`{error}`, `locauxDuGabarit`) : le gestionnaire
//     n'en a qu'une copie, recréée en tête de son code — l'écriture serait perdue sans un mot ;
//   — un lot dont le JavaScript compilé ne s'analyse pas : émis d'un bloc, il ferait refuser le
//     fichier ENTIER au chargement (SyntaxError, page morte) alors que le build était vert.
// Contrôle sur le JavaScript COMPILÉ, par résolution de portée : la recherche du nom dans le texte
// brut refusait à tort un gestionnaire qui déclarait sa propre liaison homonyme (`let compteur` ou
// un paramètre), laissait passer la constante du `<script module>`, absente de sa liste, et
// ratait une cible déstructurée (`[compteur] = …`).
// ----------------------------------------------------------------------------
// défaut de Civet : une flèche `=>` à corps en ligne qui affecte un if/unless/switch/try sort sa variable temporaire derrière la
// flèche, sans accolades (`() =>let ref;if (a) ref = …`), un for ou un while y devient `return for (…)` — signature lue sur la
// ligne de JavaScript produite qui ne s'analyse pas (gestionnaires inline, `<script>`)
export const FLECHE_EN_LIGNE_CIVET_RE = /=>\s*let ref\d*;|\breturn (?:for|while) \(/

export function controlerGestionnairesInline(js: string, consts: string[], moduleName: string | undefined, locauxDuGabarit: Iterable<string> = []): void {
  const { violation, analysable, erreur } = analyserConstReassign(js, consts, locauxDuGabarit)
  if (violation?.gabarit) throw new Error(t('transpiler.handler-local-gabarit-reaffecte', { moduleName: moduleName ?? '?', nom: violation.name }))
  if (violation) throw new Error(t('transpiler.handler-const-reaffectee', { moduleName: moduleName ?? '?', nom: violation.name }))
  if (!analysable) {
    const vars = { moduleName: moduleName ?? '?', ligne: erreur?.ligne ?? 0, extrait: erreur?.extrait ?? '' }
    // défaut de Civet (FLECHE_EN_LIGNE_CIVET_RE) — la flèche fine d'un gestionnaire est une `=>`. Message de cette forme, avec
    // les deux écritures qui passent
    if (FLECHE_EN_LIGNE_CIVET_RE.test(js.split('\n')[vars.ligne - 1] ?? '')) throw new Error(t('transpiler.handler-fleche-en-ligne', vars))
    throw new Error(t('transpiler.handler-js-invalide', vars))
  }
}

// ----------------------------------------------------------------------------
// lintHandlerSelfRefDeclaration — refuse un handler qui SE LIT lui-même dans sa
// propre déclaration. Tourne sur le batch inline APRÈS l'auto-déclaration (Pass 4) :
// une ligne `nom .= … nom …` veut dire que `nom` n'existe NULLE PART (ni dans le
// `<script>`, ni dans le `<script module>`, ni posé par le template) — le `let` posé
// ici est donc local au handler, et son initialiseur lit une variable encore dans sa
// zone morte : « Cannot access 'nom' before initialization » AU PREMIER CLIC, jamais
// à la compilation. C'est la signature du `$` oublié (`µtoggle(mode, …)` au lieu de
// `µtoggle($mode, …)`). Une locale de travail ordinaire (`tmp .= 3`) ne se relit pas
// elle-même : zéro faux positif par construction.
// ----------------------------------------------------------------------------
export function lintHandlerSelfRefDeclaration(src: string, moduleName: string | undefined): void {
  if (!src.includes('.=')) return
  const { masked } = maskStringsAndComments(src)
  for (const ligne of masked.split('\n')) {
    const m = ligne.match(/^\s*([a-zA-Z_]\w*)\s*\.=\s*(.+)$/)
    if (!m) continue
    const [, nom, reste] = m
    // seul l'INITIALISEUR compte : le générateur colle les instructions d'un handler sur
    // une ligne (`tmp .= 3;console.log(tmp)`) — une locale de travail relue PLUS LOIN est
    // parfaitement saine, c'est se relire DANS sa propre valeur qui condamne.
    // Et seule la part ÉVALUÉE TOUT DE SUITE compte : dans `fact .= (n) => … fact(n - 1)`
    // la relecture vit dans un CORPS DE FONCTION, jouée à l'appel, bien après la fin de
    // l'affectation — un helper récursif local est parfaitement valide (faux positif déjà rencontré). On s'arrête donc au premier
    // marqueur de fonction rencontré.
    const rhs = reste.split(';')[0].split(/=>|->|\bfunction\b/)[0]
    // le nom doit apparaître à DROITE en identifiant entier, jamais en propriété (`x.nom`)
    if (!new RegExp(`(?<![\\w.$])${nom}(?![\\w$])`).test(rhs)) continue
    throw new Error(t('transpiler.handler-var-jamais-declaree', { moduleName: moduleName ?? '?', nom }))
  }
}

// ----------------------------------------------------------------------------
// lintHandlerBareMethod — avertit (lint.events, jamais bloquant) d'un gestionnaire (`@click=valider`,
// `@click={valider}`, `@click={valider(1)}`) qui cite NU le nom d'une méthode du composant
// (`@valider = ->`, posée sur l'instance, jamais une variable) alors que ni le `<script>`, ni le
// `<script module>`, ni un import, ni le gestionnaire lui-même ne déclare ce nom : au clic,
// « valider is not defined » en console, rien à l'écran, et le build ne disait rien. Lit le JS
// compilé des gestionnaires : seuls les identifiants en position d'EXPRESSION comptent (jamais une
// propriété `o.valider`, une clé `{ valider: 1 }` ni une déclaration). Un homonyme déclaré dans un
// gestionnaire le masque (faux négatif possible, jamais de fausse alerte). `alreadySaid` : un
// avertissement par nom et par composant, quel que soit le nombre de gestionnaires qui le citent.
// ----------------------------------------------------------------------------
// les fonctions de la fenêtre que le navigateur offre sous leur nom nu : une méthode du composant qui porte
// ce nom ne les masque pas dans un gestionnaire, qui appelle alors la fonction du navigateur
const WINDOW_FUNCTIONS = new Set([
  'alert', 'confirm', 'prompt', 'print', 'open', 'close', 'stop', 'focus', 'blur', 'find', 'scroll', 'scrollTo', 'scrollBy',
  'moveTo', 'moveBy', 'resizeTo', 'resizeBy', 'fetch', 'postMessage', 'atob', 'btoa', 'getSelection', 'getComputedStyle', 'matchMedia',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'structuredClone',
])

export function lintHandlerBareMethod(inlinesJs: string, methodNames: Set<string>, declared: Set<string>, moduleName: string | undefined, alreadySaid: Set<string>, lint?: LintToggles, colorsEnabled = false, lineOf?: (nom: string) => number | ''): void {
  const cite   = (n: string): boolean => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(inlinesJs)
  const cibles = new Set([...methodNames].filter(n => !declared.has(n) && cite(n)))
  if (cibles.size === 0) return
  let ast: acorn.Node
  try {
    ast = acorn.parse(inlinesJs, { ecmaVersion: 'latest', sourceType: 'module' })
  }
  catch {
    return
  }
  const locaux = new Set<string>()
  const noter = (pat: any): void => {
    if (!pat) return
    switch (pat.type) {
      case 'Identifier':        locaux.add(pat.name); break
      case 'ObjectPattern':     for (const p of pat.properties ?? []) noter(p.type === 'RestElement' ? p.argument : p.value); break
      case 'ArrayPattern':      for (const el of pat.elements ?? []) noter(el); break
      case 'AssignmentPattern': noter(pat.left); break
      case 'RestElement':       noter(pat.argument); break
    }
  }
  walk.full(ast, (node: any) => {
    if (node.type === 'VariableDeclarator') noter(node.id)
    else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      noter(node.id)
      for (const p of node.params ?? []) noter(p)
    }
    else if (node.type === 'CatchClause') noter(node.param)
    else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') noter(node.id)
  })
  // `Identifier` de acorn-walk : les seuls identifiants en position d'expression (une propriété
  // non calculée, une clé, un motif de déclaration passent par d'autres visiteurs)
  walk.simple(ast, {
    Identifier(node: any) {
      if (!cibles.has(node.name) || locaux.has(node.name) || alreadySaid.has(node.name)) return
      alreadySaid.add(node.name)
      const line = typedLine('events', t('transpiler.handler-methode-nue', { moduleName: moduleName ?? '?', nom: node.name, ligne: lineOf?.(node.name) ?? '', fenetre: WINDOW_FUNCTIONS.has(node.name) }), lint)
      if (line !== null) printDiagnostic(line, colorsEnabled)
    },
  })
}

// ----------------------------------------------------------------------------
// maskDocBlocks — soustrait les blocs de DOCUMENTATION (`<pre>`, `<code>`,
// commentaires HTML) avant une passe de réécriture de sigils sur le SOURCE BRUT,
// puis les restaure à l'identique. Objectif : le code d'AFFICHAGE des tutos/doc
// (qui montre LITTÉRALEMENT `µ$$X`, `§§X`…) ne doit jamais être transformé comme
// du code exécuté. Le lexer masque déjà pre/code pour ses propres sigils ; ce
// helper étend la même garantie à la passe transpiler amont `µ$$` (0-bis), qui
// opère sur le source complet, template compris.
export function maskDocBlocks(src: string): { masked: string; restore: (s: string) => string } {
  const blocks: string[] = []
  const stash = (m: string): string => `\x00MJSDOC${blocks.push(m) - 1}\x00`
  const masked = src
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, stash)
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, stash)
    .replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, stash)
  const restore = (s: string): string =>
    s.replace(/\x00MJSDOC(\d+)\x00/g, (_m, i) => blocks[Number(i)])
  return { masked, restore }
}

// ----------------------------------------------------------------------------
// maskStringsAndComments — variante RÉVERSIBLE (stash + restore, même forme que
// maskDocBlocks) de MASK_STRINGS_AND_COMMENTS_RE : gèle les chaînes littérales
// et commentaires JS/Coffee/Civet le temps d'une passe de réécriture de sigils
// sur le CODE SEUL, puis les restaure À L'IDENTIQUE. `lintSingletonConsume`
// (plus haut) applique la MÊME regex mais en lecture seule (un `scan` jetable,
// jamais réinjecté) — ici le texte doit survivre pour la suite du pipeline,
// d'où stash+restore plutôt que blanchiment espace-à-espace.
// La pré-passe 0-bis de
// `transpile()` (µ$$X→$X) et son miroir `applyMjsSugarToScript` ne masquaient
// QUE `maskDocBlocks` (pre/code/commentaires HTML) : une chaîne JS qui MENTIONNE
// `µ$$X` en exemple (« le singleton s'appelle µ$$count ») était réécrite en
// silence (texte affiché corrompu), un COMMENTAIRE JS qui la mentionne faisait
// throw à tort (`singleton-sans-import`) faute d'usage réel. Même remède que
// (lintSingletonConsume) : masquer AVANT la réécriture, restaurer après.
// ----------------------------------------------------------------------------
export function maskStringsAndComments(src: string): { masked: string; restore: (s: string) => string } {
  const blocks: string[] = []
  const stash = (m: string): string => `\x00MJSSTR${blocks.push(m) - 1}\x00`
  const masked = src.replace(MASK_STRINGS_AND_COMMENTS_RE, stash)
  const restore = (s: string): string =>
    s.replace(/\x00MJSSTR(\d+)\x00/g, (_m, i) => blocks[Number(i)])
  return { masked, restore }
}
