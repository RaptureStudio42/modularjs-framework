// transpiler/directives — extraction et traitement des directives racines (@css, @display, @persist, @import).
// Port de la section directives de la V1 Ruby, transpiler.rb.

import { parseVtValue, suggestKey } from '../bundler/config.js'
import { t } from '../messages/index.js'
import { maskNonCode, maskHtmlComments } from '../mask.js'
import { findScriptMatches, findStyleMatches } from './sections.js'
import { parsePlaceholder, PLACEHOLDER_DIRECTIVE } from '../effects/placeholder.js'
import type { EffectValue } from '../effects/catalog.js'

export interface PersistEntry {
  var: string
  suffix: string | null
}

export interface DirectivesResult {
  /** Contenu source nettoyé des directives. */
  cleaned: string
  /** Mode de préchargement par défaut de TOUS les liens du module (`@preload`). */
  modulePreload: string | null
  /** Le composant est un élément associé au formulaire (`@formAssociated`) : le compilateur écrit l'appel du socle
   *  (`µ._mjs_formClass`, runtime mjs_form_associated.ts) juste avant l'enregistrement de sa balise. */
  moduleFormAssociated: boolean
  /** `@formAssociated` écrit plus d'une fois : un seul sens, un avertissement le dit (transpiler/index.ts). */
  moduleFormAssociatedTwice: boolean
  /** Vars persistées dans localStorage. */
  persistLocalVars: PersistEntry[]
  /** Vars persistées dans sessionStorage. */
  persistSessionVars: PersistEntry[]
  /** Imports auto-injectés en haut du module. */
  pendingAutoImports: string[]
  /** Vars `$xxx` importées (à exclure du store local). */
  externalReactives: Set<string>
  /** Section i18n du module (`@i18n 'panier'`) — préfixe les clés `µt(...)`
   *  RELATIVES à la COMPILATION ('clé' → 'panier.clé') ; null si absente
   *  (clés inchangées). Un chemin ABSOLU (`µt('/nav.fermer')`) n'est JAMAIS
   *  préfixé, section ou pas. */
  moduleI18nSection: string | null
  /** Sections en plus de la première (`@i18n 'accueil' 'onglets'` → `['onglets']`), dans l'ordre écrit : le module les
   *  demande avec la sienne (même vague de requêtes, attente commune) et une clé relative se cherche dans toutes, la
   *  première qui la porte gagne. Vide pour un module à une seule section. */
  moduleI18nExtraSections: string[]
  /** Override de l'attente des textes traduits (`@i18nPlaceholder <valeur>`,
   *  wait|key|*skeleton|*loader) — voyage en 3e argument LITTÉRAL de chaque `µ.t(...)` du
   *  module ; null si absente (2 arguments max, jamais de 3e). */
  moduleI18nPlaceholder: string | null
  /** Les réglages écrits de l'effet (`*loader(bloom)` → `{ style: 'bloom' }`) ; null sans effet ou sans réglage. */
  moduleI18nPlaceholderFx: Record<string, EffectValue> | null
}

export function extractDirectives(content: string): DirectivesResult {
  let modulePreload: string | null = null
  let moduleFormAssociated = false
  let moduleFormAssociatedTwice = false
  let moduleI18nSection: string | null = null
  let moduleI18nExtraSections: string[] = []
  let moduleI18nPlaceholder: string | null = null
  let moduleI18nPlaceholderFx: Record<string, EffectValue> | null = null
  const persistLocalVars: PersistEntry[] = []
  const persistSessionVars: PersistEntry[] = []
  const pendingAutoImports: string[] = []
  const externalReactives = new Set<string>()

  // Les directives racines (`@css`, `@display`, `@persist`, `@import`) peuvent
  // apparaître n'importe où dans le fichier : avant/après `<style>`/`<script>`/HTML au niveau
  // racine, ET au niveau du CODE dans un `<script>` (`@import µ$$draft '…'`, `@preload on` —
  // cf. docs/21-navigation.md, docs/17-router.md, échantillons Linguist : `@persist` idem).
  // JAMAIS dans `<style>` (une directive MJS n'y vit pas, `@import` y est une RÈGLE CSS). Pour
  // éviter les faux positifs sur les exemples `@persist $foo` à l'intérieur de `<pre><code>`
  // dans les docs/tutos, on masque ces blocs pendant le scan, puis on les restaure à la fin.
  const masks: string[] = []
  // NONCE — le jeton portait un compteur LITTÉRAL (`\x00MASK0\x00`) :
  // un source qui contenait cette suite exacte se faisait remplacer par le contenu d'un <pre>/<code>/
  // commentaire SANS RAPPORT, ailleurs dans le fichier — corruption silencieuse. Le nonce (aléatoire,
  // tiré à chaque appel) rend la collision inatteignable depuis le source.
  const nonce = Math.random().toString(36).slice(2, 12)
  const mask = (m: string) => {
    masks.push(m)
    return `\x00MASK${nonce}_${masks.length - 1}\x00`
  }
  // les COMMENTAIRES HTML rejoignent <pre>/<code> dans ce masquage.
  // Trou de fond (présent sur @viewTransition, mais commun à TOUTES les
  // directives racines lues ici) : ce scan voyait l'intérieur des commentaires, donc mettre une
  // directive de côté en la commentant — `<!-- @viewTransition={x} -->`, `<!-- @persist $x -->` —
  // la RALLUMAIT (ou, pour les formes relogées, faisait échouer la compilation sur une ligne
  // pourtant neutralisée). Traité ICI, en amont et une seule fois, plutôt que directive par
  // directive : le même remède que <routes> (sections.ts § 3-ter) et que les macros <@…>
  // (macros.ts, processGlobalMacros).
  //
  // `<style>` REJOINT aussi ce masquage EN BLOC : une directive MJS n'y vit JAMAIS. `<script>`,
  // LUI, N'EST PAS masqué ici — il accueille légitimement des directives au niveau du CODE (voir
  // le bandeau ci-dessus). Le masquer en bloc cacherait aussi bien les vraies directives que les
  // fausses (régression constatée : `@import '../dehors/x.civet'` DANS un <script> devenait
  // invisible, le confinement sourceDir qui doit le refuser ne le voyait plus DU TOUT). Voir
  // `scriptInertMask`/`activeDirective` plus bas : un filtre de POSITION, jamais une mutation du
  // texte réel du script (mutation impossible ici : l'argument quoté d'un `@import`/`@i18n`
  // légitime EST une chaîne, exactement comme celle qu'on veut neutraliser ailleurs — seule la
  // POSITION du mot-clé `@directive` lui-même permet de trancher, jamais un masquage aveugle).
  // findScriptStyleMatches — bornes des <script module>/<script>/<style> du texte COURANT
  // (recalculées à chaque appel : le texte raccourcit à mesure que les blocs déjà traités sont
  // masqués). MÊME logique que sections.ts (findScriptMatches/findStyleMatches, transpiler/
  // sections.ts) — SEULE recherche de ces bornes, plus de regex paresseuse propre à ce fichier :
  // avant, une recherche DIFFÉRENTE (vue Civet pour <style> aussi) prenait un `#123` CSS pour un
  // commentaire Civet et avalait tout jusqu'au `</style>` SUIVANT (couleur hexadécimale sur la
  // ligne de fermeture). `caseInsensitive` TOUJOURS vrai ICI (`true` en 3e argument), contrairement
  // à extractSections : une balise mal casée (`<SCRIPT>`) qui deviendra une ERREUR DE COMPILATION
  // plus tard (garde-fou orphelin, sections.ts) doit quand même voir son CONTENU traité comme un
  // script/style tant que la compilation n'a pas encore tranché — sinon un exemple documenté à
  // l'intérieur de cette fausse casse (chaîne, gabarit) fuit comme texte actif avant même
  // d'atteindre l'erreur. `allScripts` triée : `findScriptMatches` rend module et non-module en
  // deux tableaux séparés, un `<script>` pouvant précéder textuellement un `<script module>`.
  // le texte ne change qu'au retrait d'une directive : sur le même texte, mêmes bornes, sans relire tout le fichier
  // (lexer Civet et masque CSS) — la recherche revenait sinon une quinzaine de fois par composant
  let lastText: string | null = null
  let lastMatches: { scripts: RegExpMatchArray[], styles: RegExpMatchArray[] } = { scripts: [], styles: [] }
  const findScriptStyleMatches = (text: string): { scripts: RegExpMatchArray[], styles: RegExpMatchArray[] } => {
    if (text === lastText) return lastMatches
    const { moduleScripts, scripts } = findScriptMatches(text, true)
    const allScripts = [...moduleScripts, ...scripts].sort((a, b) => a.indices![0][0] - b.indices![0][0])
    const { matches: styles } = findStyleMatches(text, allScripts, true)
    lastText    = text
    lastMatches = { scripts: allScripts, styles }
    return lastMatches
  }

  // maskStyleBlocks — remplace chaque <style>…</style> RÉEL par le même jeton opaque que
  // <pre>/<code>/commentaires ; la borne de fermeture vient de findScriptStyleMatches (ci-dessus),
  // jamais d'une regex paresseuse sur le texte réel — qui se laissait tromper par un `</style>`
  // littéral dans une chaîne CSS (`content: "</style>"`), fermant la zone trop tôt et laissant
  // fuir la suite du fichier hors masque. Le texte poussé dans `masks[]` reste le texte RÉEL,
  // jamais altéré — la vue ne sert QU'à trouver l'étendue du bloc.
  const maskStyleBlocks = (text: string): string => {
    const { styles } = findScriptStyleMatches(text)
    let out    = ''
    let cursor = 0
    for (const m of styles) {
      const [start, end] = m.indices![0]
      out += text.slice(cursor, start) + mask(text.slice(start, end))
      cursor = end
    }
    out += text.slice(cursor)
    return out
  }

  // blankRange — neutralise [start,end) en espaces même-longueur (préserve les `\n`) — même
  // utilitaire qu'en interne à sections.ts (non exporté là-bas, dupliqué ici : un remplacement
  // d'un `[^\n]` par un espace, rien de plus lourd à partager).
  const blankRange = (src: string, start: number, end: number): string =>
    src.slice(0, start) + src.slice(start, end).replace(/[^\n]/g, ' ') + src.slice(end)

  // blankScriptStyleRanges — neutralise, sur une COPIE de `text`, les plages <script>/<style>
  // RÉELLES (findScriptStyleMatches) — sert de base à la vue de recherche de borne des blocs
  // <pre>/<code>/commentaires HTML plus bas ; le texte réel (celui poussé dans `masks[]`) ressort
  // intact, cette copie ne sert QU'à repérer où couper.
  const blankScriptStyleRanges = (text: string): string => {
    const { scripts, styles } = findScriptStyleMatches(text)
    let view = text
    for (const m of [...scripts, ...styles]) {
      const [start, end] = m.indices![0]
      view = blankRange(view, start, end)
    }
    return view
  }

  // maskInterpolationContent — blanchit (même longueur) le CONTENU de chaque interpolation `{…}`
  // de PREMIER NIVEAU du texte HTML (accolades imbriquées comptées en profondeur, chaînes internes
  // `'…'`/`"…"`/`` `…` `` traversées sans compter leurs accolades) — sert UNIQUEMENT à construire
  // une vue de recherche de borne : un `</pre>`/`</code>`/`-->` LITTÉRAL écrit comme DONNÉE dans
  // une chaîne passée à une interpolation (`<pre>{ f("</pre>") }`) n'est pas du balisage ; le
  // laisser visible referme la recherche trop tôt et laisse fuir la suite (directive comprise)
  // hors masque.
  const maskInterpolationContent = (text: string): string => {
    const chars = text.split('')
    const n     = text.length
    let i = 0
    while (i < n) {
      if (text[i] !== '{') { i++; continue }
      const open = i
      let depth  = 1
      i++
      while (i < n && depth > 0) {
        const c = text[i]
        if (c === '\'' || c === '"' || c === '`') {
          const quote = c
          i++
          while (i < n && text[i] !== quote) i += text[i] === '\\' ? 2 : 1
          i++
          continue
        }
        if (c === '{') depth++
        else if (c === '}') depth--
        i++
      }
      const contentEnd = Math.min(depth === 0 ? i - 1 : i, n)
      for (let k = open + 1; k < contentEnd; k++) if (chars[k] !== '\n') chars[k] = ' '
    }
    return chars.join('')
  }

  // maskDocBlock — remplace chaque bloc `<pre>…</pre>`/`<code>…</code>` RÉEL trouvé par `re` par
  // le même jeton opaque que <style>/commentaires. La borne de fermeture est cherchée sur une vue
  // où les plages <script>/<style> et le contenu des interpolations `{…}` (et leurs chaînes) sont
  // neutralisés, PUIS les commentaires HTML (maskHtmlComments) — jamais sur le texte réel : un
  // `</pre>` littéral, DONNÉE de code dans une interpolation (`<pre>{ f("</pre>") }`), referme
  // sinon la zone trop tôt et laisse fuir la suite (une directive citée juste après redevient active).
  const maskDocBlock = (text: string, re: RegExp): string => {
    const view = maskHtmlComments(maskInterpolationContent(blankScriptStyleRanges(text)))
    let out    = ''
    let cursor = 0
    for (const m of view.matchAll(re)) {
      const start = m.index!
      const end   = start + m[0].length
      out += text.slice(cursor, start) + mask(text.slice(start, end))
      cursor = end
    }
    out += text.slice(cursor)
    return out
  }

  // maskCommentBlocks — même principe que maskDocBlock pour `<!-- … -->`, sur une vue où les
  // plages <script>/<style> et le contenu des interpolations `{…}` sont neutralisés (PAS les
  // commentaires eux-mêmes : c'est ce qu'on cherche). La fermeture `-->` reste celle de
  // maskHtmlComments (mask.ts, motif LAZY, même tolérance que le HTML natif) : un `<!--` jamais
  // refermé ne masque toujours rien (limite assumée, cf. directives-commentaires-html.test.ts).
  const maskCommentBlocks = (text: string): string => {
    const view = maskInterpolationContent(blankScriptStyleRanges(text))
    let out    = ''
    let cursor = 0
    for (const m of view.matchAll(/<!--(?:-?>|[\s\S]*?--!?>)/g)) {
      const start = m.index!
      const end   = start + m[0].length
      out += text.slice(cursor, start) + mask(text.slice(start, end))
      cursor = end
    }
    out += text.slice(cursor)
    return out
  }

  let cleaned = maskStyleBlocks(content)
  cleaned = maskDocBlock(cleaned, /<pre\b[^>]*>[\s\S]*?<\/pre>/gi)
  cleaned = maskDocBlock(cleaned, /<code\b[^>]*>[\s\S]*?<\/code>/gi)
  cleaned = maskCommentBlocks(cleaned)

  // scriptInertMask — même longueur que le texte reçu, blancs UNIQUEMENT dans les zones INERTES
  // (chaînes, gabarits, commentaires, regex — maskNonCode, src/mask.ts) des `<script>` restés en
  // clair ci-dessus ; identique au texte reçu partout ailleurs (racine, et `<style>`/`<pre>`/
  // `<code>`/commentaires déjà remplacés par un jeton opaque, donc hors-jeu ici). RECALCULÉE à
  // chaque appel d'`activeDirective` (le texte raccourcit à mesure que les directives reconnues
  // sont retirées : ses offsets doivent rester alignés sur le texte COURANT, jamais figés). Même
  // remède que `maskStyleBlocks` pour la BORNE de fermeture : trouvée par findScriptStyleMatches,
  // jamais sur `text` directement — un `</script>` littéral dans une chaîne ou un gabarit DU
  // script referme sinon la zone trop tôt, et tout ce qui suit (code réel compris) ressort non
  // masqué, ce qui rallumait une directive citée en exemple plus loin dans le même script.
  const scriptInertMask = (text: string): string => {
    const { scripts } = findScriptStyleMatches(text)
    let out    = ''
    let cursor = 0
    for (const m of scripts) {
      const [start, end] = m.indices![0]
      if (start < cursor) continue
      const real        = text.slice(start, end)
      const openEnd     = real.indexOf('>') + 1
      const closeStart  = real.length - '</script>'.length
      const openTag     = real.slice(0, openEnd)
      const closeTag    = real.slice(closeStart)
      const langMatch   = openTag.match(/lang[ \t]*=[ \t]*['"]([^'"]+)['"]/)
      out += text.slice(cursor, start) + openTag + maskNonCode(real.slice(openEnd, closeStart), langMatch ? langMatch[1] : 'civet') + closeTag
      cursor = end
    }
    out += text.slice(cursor)
    return out
  }

  // activeDirective — exécute `re` (globale) sur LE TEXTE RÉEL `text` (captures/arguments
  // INTACTS, y compris une chaîne quotée qui EST l'argument d'un `@import`/`@i18n` légitime —
  // `maskNonCode` la verrait sinon comme une chaîne de code ordinaire et l'effacerait). Un match
  // dont le mot-clé `@directive` tombe sur une position blanchie de `scriptInertMask` (DANS un
  // <script>, en chaîne/gabarit/commentaire) est ignoré : texte laissé TEL QUEL, comme au niveau
  // racine un exemple caché dans `<pre>`/`<code>`/un commentaire HTML. Un match hors zone inerte
  // (racine, ou CODE réel dans un <script>) est passé à `replacer`, comme un `String.replace` ordinaire.
  const activeDirective = (text: string, re: RegExp, replacer: (...args: any[]) => string): string => {
    const mask = scriptInertMask(text)
    let out    = ''
    let cursor = 0
    for (const m of text.matchAll(re)) {
      const at = m.index! + Math.max(m[0].indexOf('@'), 0)
      if (mask[at] !== text[at]) continue
      out += text.slice(cursor, m.index!) + replacer(...(m as unknown as string[]), m.index!, text)
      cursor = m.index! + m[0].length
    }
    out += text.slice(cursor)
    return out
  }

  // ----- @css ----- RELOGÉ : `@css` quitte la racine du fichier,
  // c'est désormais un attribut du `<style>` de base (`<style @css="nom1 nom2">`,
  // cf. sections.ts). La forme racine est une ERREUR DE COMPILATION explicite.
  cleaned = activeDirective(cleaned, /^[ \t]*@css[ \t]+([a-zA-Z0-9_ \t-]+?)[ \t]*$/gm, (_m, names) => {
    const clean = (names as string).trim()
    throw new Error(t('transpiler.css-racine-interdite', { ligne: `@css ${clean}`, remplacement: `<style @css="${clean}">` }))
  })

  // ----- @display ----- RELOGÉ : attribut du `<style>` de
  // base (`<style @display="inline-block">`, cf. sections.ts). Forme racine =
  // erreur de compilation explicite.
  cleaned = activeDirective(cleaned, /^[ \t]*@display[ \t]+([a-zA-Z-]+)[ \t]*$/gm, (_m, val) => {
    throw new Error(t('transpiler.display-racine-interdite', { ligne: `@display ${val}`, remplacement: `<style @display="${val}">` }))
  })

  // ----- @i18n ----- (sections i18n du module, la première préfixe les clés `µt(...)` relatives)
  // `@i18n 'panier'` ou `@i18n "panier"` — section validée /^[a-z0-9_-]+$/
  // (mêmes guillemets simples/doubles que `@import`, cf. plus bas).
  // plusieurs sections sur la MÊME ligne (`@i18n 'accueil' 'onglets-admin'`) : la première est celle du module,
  // les autres se demandent avec elle ; chacune est validée comme une section seule, un nom répété est refusé.
  // 2 directives @i18n dans le même module écrasaient la
  // 1ère en silence (`moduleI18nSection` réassigné sans vérif) : erreur de
  // compilation EXPLICITE dès la 2e occurrence.
  cleaned = activeDirective(
    cleaned,
    /^[ \t]*@i18n((?:[ \t]+['"][^'"]+['"])+)[ \t]*$/gm,
    (_m, noms) => {
      const sections = [...(noms as string).matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
      if (moduleI18nSection !== null) {
        throw new Error(t('transpiler.i18n-double', { ancienneSection: [moduleI18nSection, ...moduleI18nExtraSections].join(' '), section: sections.join(' ') }))
      }
      sections.forEach((section, i) => {
        if (!/^[a-z0-9_-]+$/.test(section)) {
          throw new Error(t('transpiler.i18n-section-invalide', { section }))
        }
        if (sections.indexOf(section) !== i) {
          throw new Error(t('transpiler.i18n-section-ecrite-deux-fois', { section }))
        }
      })
      moduleI18nSection       = sections[0]
      moduleI18nExtraSections = sections.slice(1)
      return ''
    }
  )
  // une ligne `@i18n` restée après la lecture ci-dessus n'a pas la forme de la directive (virgule entre les noms, deux noms collés,
  // nom sans guillemets, commentaire en fin de ligne, aucune section…) : sans ce refus, la ligne ne posait aucune section et sortait
  // en texte dans la page. Ni `@i18nPlaceholder` (lu plus bas : un caractère de nom suit `@i18n`), ni un membre ou un appel
  // (`@i18n.x`, `@i18n(…)` : code d'un script) ne sont concernés ; mêmes zones inertes que les autres directives
  cleaned = activeDirective(
    cleaned,
    /^[ \t]*@i18n(?![A-Za-z0-9_$.(\[?!])[^\n]*$/gm,
    (m: string) => {
      throw new Error(t('transpiler.i18n-ligne-invalide', { ligne: m.trim() }))
    }
  )

  // ----- @i18nPlaceholder ----- (l'attente des textes traduits)
  // `@i18nPlaceholder <valeur>`, valeur ∈ wait|key|*skeleton|*loader(…) (cf. effects/placeholder.ts ;
  // `auto` n'existe plus, l'erreur donne `*skeleton`). `wait` et `*loader` exigent une
  // section `@i18n` à attendre (validé après extraction, une fois les deux
  // directives lues quel que soit leur ordre d'écriture dans le fichier).
  cleaned = activeDirective(
    cleaned,
    /^[ \t]*@i18nPlaceholder[ \t]+(\S[^\n]*?)[ \t]*$/gm,
    (_m, valeur) => {
      const lu = parsePlaceholder(valeur, PLACEHOLDER_DIRECTIVE)
      moduleI18nPlaceholder   = lu.mode
      moduleI18nPlaceholderFx = lu.settings
      return ''
    }
  )

  // ----- @preload ----- (défaut de préchargement des liens du module ; niveau 2)
  // Formes acceptées : `@preload on`, `@preload = "hover"`, `@preload="off"`.
  // `eager` n'est plus une valeur : refus explicite qui donne le nom retenu
  cleaned = activeDirective(
    cleaned,
    /^[ \t]*@preload(?:[ \t]*=)?[ \t]*["']?eager["']?[ \t]*$/gm,
    () => { throw new Error(t('transpiler.preload-eager-renomme', { ou: 'directive racine @preload' })) },
  )
  cleaned = activeDirective(
    cleaned,
    /^[ \t]*@preload(?:[ \t]*=)?[ \t]*["']?(on|hover|off)["']?[ \t]*$/gm,
    (_m, val) => { modulePreload = val; return '' },
  )

  // ----- @formAssociated ----- (le composant devient un élément associé au formulaire, cf. mjs_form_associated.ts)
  // Forme unique, nue : `@formAssociated` seul sur sa ligne. Une valeur ou un mot de plus (`@formAssociated true`) est refusé : la
  // directive ne se règle pas, et la ligne sortait sinon en texte dans la page
  cleaned = activeDirective(
    cleaned,
    /^[ \t]*@formAssociated(?![A-Za-z0-9_$.(\[?!])([^\n]*)$/gm,
    (m: string, reste: string) => {
      if (reste.trim() !== '') throw new Error(t('transpiler.form-associated-ligne-invalide', { ligne: m.trim() }))
      if (moduleFormAssociated) moduleFormAssociatedTwice = true
      moduleFormAssociated = true
      return ''
    }
  )

  // ----- @viewTransition ----- RELOGÉ : `@viewTransition` quitte
  // la racine du fichier, c'est désormais un attribut POINTÉ du `<style>` de base
  // (`<style @viewTransition.cube={ dir: left }>`, forme nue → `<style @viewTransition>`,
  // cf. sections.ts, même grammaire `parseVtValue`, bundler/config.ts). L'ALIAS `@vt`
  // reste capturé ICI (racine) pour un message clair, mais n'existe plus comme
  // attribut de `<style>` — cf. sections.ts. Toute forme racine — nue ou à point —
  // est une ERREUR DE COMPILATION explicite qui pointe vers l'attribut. La grammaire
  // des options (dont le rejet du suffixe `:direction` dans le nom) reste validée
  // ICI via `parseVtValue` avant le message de relogement, pour un diagnostic
  // précis même sur une valeur fautive. Les erreurs `off`/`on` explicites et
  // l'ancienne écriture ESPACE restent signalées telles quelles (indépendantes
  // du lieu d'écriture).
  cleaned = activeDirective(
    cleaned,
    /^[ \t]*@(viewTransition|vt)\b(.*)$/gm,
    (_m: string, directive: string, restRaw: string) => {
      const label = `@${directive}`
      // `@vt` n'est plus un alias sur `<style>` : le remplacement propose TOUJOURS
      // le nom long, sinon le lecteur corrige et retombe aussitot sur une 2e erreur.
      const cible = '@viewTransition'
      const rest  = restRaw.replace(/[ \t]+$/, '')

      // Forme nue : rien après la directive (à l'espace près) → attribut nu.
      if (rest.trim() === '') {
        throw new Error(t('transpiler.viewtransition-racine-interdite', { label, ligne: label, remplacement: `<style ${cible}>` }))
      }

      // Forme à POINT (canonique) : `.<nom>[:dir][={ ... }]`.
      const dotMatch = rest.match(/^\.([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?)(?:[ \t]*=[ \t]*\{([^}]*)\})?[ \t]*$/)
      if (dotMatch) {
        const nameAndDir = dotMatch[1]
        const optsRaw: string | undefined = dotMatch[2]
        const base = nameAndDir.split(':')[0]
        if (base === 'off') {
          throw new Error(t('transpiler.vt-off-nexiste-pas', { label }))
        }
        if (base === 'on') {
          throw new Error(t('transpiler.vt-on-implicite', { label }))
        }
        // Le suffixe `:direction` n'existe plus, la SEULE façon
        // d'orienter est la clé d'option (`${label}.cube={ dir: left }`).
        if (nameAndDir.includes(':')) {
          throw new Error(t('transpiler.vt-direction-plus-dans-nom', { label, example: `${label}.cube={ dir: left }` }))
        }
        const verbatim = optsRaw !== undefined ? `${nameAndDir}={${optsRaw}}` : nameAndDir
        const parsed = parseVtValue(verbatim)
        // Cast explicite : strictNullChecks:false (tsconfig du projet) désactive le
        // narrowing natif des unions discriminées — cf. le même commentaire dans config.ts.
        if (!parsed.ok) {
          throw new Error(t('transpiler.vt-nom-erreur-parsing', { label, nameAndDir, erreur: (parsed as { ok: false; error: string }).error }))
        }
        throw new Error(t('transpiler.viewtransition-racine-interdite', { label, ligne: `${label}.${verbatim}`, remplacement: `<style ${cible}.${verbatim}>` }))
      }

      // Ancienne écriture (espace, ou `=`/`= "nom"` sans point) — détecte
      // d'abord les littéraux on/off explicites (message dédié, prioritaire).
      const legacyMatch = rest.match(/^(?:[ \t]*=)?[ \t]*["']?([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?)["']?(?:[ \t]+\d+)?[ \t]*$/)
      const legacyName = legacyMatch ? legacyMatch[1] : null
      if (legacyName === 'off') {
        throw new Error(t('transpiler.vt-off-nexiste-pas', { label }))
      }
      if (legacyName === 'on') {
        throw new Error(t('transpiler.vt-on-implicite', { label }))
      }
      throw new Error(t('transpiler.vt-ancienne-ecriture-remplacee', { label }))
    },
  )

  // ----- @persist avec suffixe `by:` (matché en premier) -----
  cleaned = activeDirective(
    cleaned,
    /^[ \t]*@persist(?:[ \t]+(session|local):)?[ \t]+(\$[a-zA-Z0-9_]+)[ \t]+by:[ \t]+(.+?)[ \t]*$/gm,
    (_m, scope, varName, suffix) => {
      const target = scope === 'session' ? persistSessionVars : persistLocalVars
      target.push({ var: varName, suffix: suffix.trim() })
      return ''
    }
  )

  // ----- @persist multi-vars sans suffixe ----- (séparateur
  // ESPACE, pas virgule : `@persist $a $b`. Le charset de CAPTURE garde la
  // virgule (elle doit encore matcher la ligne, sinon un @persist écrit à
  // l'ANCIENNE — `@persist $a, $b` — ne serait plus reconnu DU TOUT comme une
  // directive et filerait tel quel dans le HTML, erreur bien plus confuse) :
  // seul le SPLIT change, une virgule résiduelle reste collée à son nom
  // (`$a,`) et échoue déjà le garde-fou de validation existant
  // (`^[a-zA-Z_]\w*$`, cf. buildPersistCode plus bas) — message à jour vers
  // l'espace (messages/fr.ts « persist-nom-invalide »).
  cleaned = activeDirective(
    cleaned,
    /^[ \t]*@persist(?:[ \t]+(session|local):)?[ \t]+([\$a-zA-Z0-9_,\s]+?)[ \t]*$/gm,
    (_m, scope, vars) => {
      const target = scope === 'session' ? persistSessionVars : persistLocalVars
      const list = vars.split(/[ \t]+/).map((s: string) => s.trim()).filter((s: string) => s.length > 0)
      for (const v of list) target.push({ var: v, suffix: null })
      return ''
    }
  )

  // ----- @import ----- (noms séparés par ESPACE ; le
  // DERNIER token de la ligne reste TOUJOURS le chemin quoté (déjà isolé par
  // sa PROPRE capture `(['"])(.+?)\3` en fin de regex — aucune ambiguïté avec
  // les noms, qui ne portent jamais de guillemets). Garde explicite : une
  // virgule résiduelle entre deux noms (ancienne écriture) est rejetée avec un
  // message orientant vers la nouvelle syntaxe — même esprit que le garde-fou
  // @persist (persist-nom-invalide), mais ICI en amont (import n'a pas de
  // validation par nom en aval comme buildPersistCode).
  // DEUX défauts corrigés ICI :
  // (a) l'ancienne capture `['"](.+?)['"]` acceptait un guillemet d'OUVERTURE
  //     et de FERMETURE différents (pas de backreference) : un chemin délimité
  //     par `'…'` contenant un `"` littéral s'arrêtait au premier `"` rencontré
  //     au lieu du `'` réel de fermeture, tronquant la cible et laissant le
  //     reste fuir dans le HTML (ParseError Civet illisible en aval). Backreference
  //     `\3` posée : le guillemet de fermeture est TOUJOURS le même que l'ouvrant.
  // (b) même une fois (a) posé, `targetPath` s'insère tel quel, SANS échappement,
  //     dans `fromClause` (chaîne DOUBLE-QUOTE) : un `"` littéral dans une cible
  //     `'…'` referme la chaîne prématurément, le texte qui suit devient du code
  //     Civet/JS exécuté au chargement du module (injection prouvée avec
  //     `@import Foo 'x"; globalThis.__PWNED__=1337; "'`). Un guillemet,
  //     un antislash, un retour à la ligne ou un NUL dans la cible est donc
  //     désormais une erreur de compilation explicite, AVANT toute interpolation.
  // DEUX trous en plus de (a)/(b)
  // ci-dessus : cible VIDE (`@import x ''`/`""`) — la capture exigeait avant au moins 1
  // caractère (`.+?`), cette ligne ne matchait pas DU TOUT (ni retirée, ni rejetée) et FUYAIT en
  // texte brut dans le template rendu (_mjs_cloneTpl) ; `.*?` matche maintenant aussi la cible vide,
  // rejetée dans le corps ci-dessous. Et `#{…}`/`${…}`/un backtick DANS la cible : elle
  // s'insère dans `fromClause` (DOUBLE guillemet, cf. plus bas), et la Pass 3 du transpiler
  // (convertCoffeeInterpolations, transpiler/index.ts ~1730) réécrit ensuite `"…#{X}…"` en
  // gabarit — `@import Foo 'x#{1+1}y'` compilait SANS erreur en import mort (spécificateur
  // littéral jamais résolu par Node), et une charge à effet de bord
  // (`#{globalThis.__PWNED__=1337}`) ne rejetait que par accident (ParseError Civet illisible,
  // jamais ce message).
  cleaned = activeDirective(
    cleaned,
    /^[ \t]*@import\s+(?:(default)\s+)?([a-zA-Z0-9_$,\s]+?)\s+(['"])(.*?)\3[ \t]*$/gm,
    (_m, isDefault, rawVars, _quote, targetPath) => {
      if ((rawVars as string).includes(',')) {
        throw new Error(t('transpiler.import-virgule-interdite', { rawVars: (rawVars as string).trim(), targetPath }))
      }
      if (targetPath === '' || /['"\\\n\0`]|#\{|\$\{/.test(targetPath as string)) {
        throw new Error(t('transpiler.import-cible-invalide', { cible: targetPath }))
      }
      const cleanVars: string[] = rawVars.split(/[ \t]+/).map((s: string) => s.trim()).filter((s: string) => s.length > 0)
      for (const v of cleanVars) {
        if (v.startsWith('$')) externalReactives.add(v)
      }

      const isUrl = /^https?:\/\//.test(targetPath)
      const fromClause = isUrl ? `'${targetPath}'` : `"µasset('${targetPath}')"`
      const importClause = isDefault
        ? `import ${cleanVars[0]} from ${fromClause}`
        : `import { ${cleanVars.join(', ')} } from ${fromClause}`

      pendingAutoImports.push(importClause)
      return ''
    }
  )

  // directive racine mal écrite (`@improt`, `@persit`) = ERREUR — la garde exige
  // la FORME de la directive (cible entre guillemets / variable `$`), pas seulement un mot proche : une ligne
  // de prose qui commence par `@importe` ou `@persil` compile (faux positif prouvé)
  const horsSections = cleaned.replace(/<(script|style|theme)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ' '))
  for (const m of horsSections.matchAll(/^[ \t]*@([a-zA-Z][a-zA-Z0-9]*)\s+(?:default\s+)?[a-zA-Z0-9_$,\s]+?\s+(['"]).*?\2[ \t]*$/gm)) {
    const nom = m[1]
    if (nom === 'import') continue
    const suggestion = suggestKey(nom, ['import'])
    if (suggestion) throw new Error(t('transpiler.directive-racine-inconnue', { nom, suggestion }))
  }
  for (const m of horsSections.matchAll(/^[ \t]*@([a-zA-Z][a-zA-Z0-9]*)(?:[ \t]+(?:session|local):)?[ \t]+\$[a-zA-Z0-9_]/gm)) {
    const nom = m[1]
    if (nom === 'persist') continue
    const suggestion = suggestKey(nom, ['persist'])
    if (suggestion) throw new Error(t('transpiler.directive-racine-inconnue', { nom, suggestion }))
  }

  // `wait` et `*loader` diffèrent le premier rendu tant que la section n'est pas chargée —
  // sans section @i18n, rien à attendre. key/*skeleton restent autorisés seuls
  // (ils agissent sur les clés racine, hors scope de section).
  if ((moduleI18nPlaceholder === 'wait' || moduleI18nPlaceholder === '*loader') && moduleI18nSection === null) {
    throw new Error(t('transpiler.i18n-placeholder-wait-sans-section', { mode: moduleI18nPlaceholder }))
  }

  // Restaure les blocs <pre>/<code>/commentaires HTML masqués pendant le scan. Boucle, car les
  // masques peuvent s'IMBRIQUER depuis l'ajout des commentaires : `<!-- <pre>x</pre> -->` masque
  // d'abord le <pre>, puis le commentaire AVEC son placeholder dedans — une passe unique laisserait
  // un `\x00MASK0\x00` en clair dans la sortie.
  // Bornée à `masks.length + 1` tours : imbrication réelle = profondeur finie, et un source qui
  // porterait un `\x00MASK…\x00` littéral ne peut pas faire tourner la boucle sans fin.
  const maskRe = new RegExp(`\\x00MASK${nonce}_(\\d+)\\x00`, 'g')
  for (let tour = 0; tour <= masks.length && maskRe.test(cleaned); tour++) {
    maskRe.lastIndex = 0
    cleaned = cleaned.replace(maskRe, (_, i) => masks[+i])
  }

  return {
    cleaned,
    modulePreload,
    moduleFormAssociated,
    moduleFormAssociatedTwice,
    persistLocalVars,
    persistSessionVars,
    pendingAutoImports,
    externalReactives,
    moduleI18nSection,
    moduleI18nExtraSections,
    moduleI18nPlaceholder,
    moduleI18nPlaceholderFx,
  }
}

// ----------------------------------------------------------------------------
// Génération du code de persistance (CoffeeScript) à appendre au script du
// composant. La var doit déjà être déclarée dans le script user (l'init sert
// de défaut), le stored la remplace seulement si typeof correspond.
// ----------------------------------------------------------------------------
export function buildPersistCode(
  moduleName: string,
  localVars: PersistEntry[],
  sessionVars: PersistEntry[]
): string {
  const tagKeyPrefix = `mjs-${moduleName.toLowerCase()}`
  let code = ''
  const sets: [PersistEntry[], string][] = [
    [localVars, 'localStorage'],
    [sessionVars, 'sessionStorage'],
  ]
  // noms de temporaires UNIQUES par entrée. Le suffixe par nom de var
  // (`_mjs_p_key_a`) règle le cas multi-vars DISTINCTES, mais la MÊME var
  // persistée deux fois (local+session, ou doublon `@persist $a` ×2) recréait la
  // collision `_mjs_p_key_a` ×2 dans le même scope. On désambiguïse UNIQUEMENT
  // les répétitions (`_a`, puis `_a_2`, `_a_3`…) : la 1ʳᵉ occurrence garde
  // `_mjs_p_key_<var>` (compat + lisibilité), les suivantes reçoivent un indice.
  const usedNames = new Set<string>()
  const uniqueClean = (clean: string): string => {
    let name = clean
    let n = 2
    while (usedNames.has(name)) name = `${clean}_${n++}`
    usedNames.add(name)
    return name
  }
  for (const [vars, backend] of sets) {
    for (const entry of vars) {
      const clean = entry.var.replace(/^\$/, '')
      if (clean === '') continue
      // un nom invalide (`@persist $a $b` sans virgule → UNE entrée
      // « $a $b ») fabriquait `_mjs_p_key_a $b` → erreur lexer Civet
      // indéchiffrable (ni @persist ni la var cités). Message clair à la place.
      if (!/^[a-zA-Z_]\w*$/.test(clean)) {
        throw new Error(t('transpiler.persist-nom-invalide', { nomVar: entry.var.trim() }))
      }
      const keyExpr = entry.suffix
        ? `"${tagKeyPrefix}:${clean}:" + (${entry.suffix})`
        : `'${tagKeyPrefix}:${clean}'`
      // `.=` (Civet let) pour la clé du bloc — Coffee auto-déclarait,
      // Civet exige la déclaration explicite. Les temporaires sont
      // suffixés par le nom UNIQUE (cf. uniqueClean ci-dessus) : sans ça, un nom
      // partagé produisait un second `let _mjs_p_key_…` dans le même scope →
      // « Identifier has already been declared » (bug vécu, régression
      // verrouillée par tests/persist-multi-vars.test.ts). NB : la CLÉ de stockage
      // (`keyExpr`) et la var réactive (`$${clean}`) gardent le nom RÉEL.
      // Le navigateur peut refuser le stockage (navigation privée, accès bloqué, quota plein) : l'accès
      // à `localStorage`/`sessionStorage`, `getItem` et `JSON.parse` sont sous UNE garde (la var garde sa
      // valeur de départ) ; l'accès et `setItem` sous une autre, dans le rappel de l'effet (la sauvegarde
      // est perdue, l'état continue de changer). Le `catch` ne dit rien : ni message, ni relance. La garde
      // ne couvre QUE le stockage : restent HORS garde la clé de la lecture, la clé de l'écriture et
      // `JSON.stringify` (une faute dans `by:` ou un état non sérialisable sort comme sans garde, au montage
      // ou à chaque passage de l'effet ; tests/persist-stockage-refuse*.test.ts). Clé statique : l'effet
      // reprend la clé déjà lue, un seul littéral dans le code émis ; clé dynamique (`by:`) : l'effet la
      // recalcule à chaque passage, avant `JSON.stringify` et avant le `try`
      // `if stored` et non `stored?` : "" n'est pas du JSON (JSON.parse lèverait, le catch l'avalait),
      // même effet pour 6 octets de moins
      // La valeur stockée n'est reprise que de la même forme que la valeur de départ : `typeof` vaut 'object'
      // pour une liste, un objet et `null` — une valeur laissée par une version précédente (objet là où la
      // variable attend une liste, `null` qui plantait au premier rendu) est ignorée. Une variable partie
      // de `null` (rien encore) reprend un objet ou une liste, comme avant ; `not cur` vaut `cur is null` une fois
      // les `typeof` égaux (un 0, un '' ou un false de départ n'a pas de forme à vérifier), plus court
      const uname     = uniqueClean(clean)
      const keyVar    = `_mjs_p_key_${uname}`
      const storedVar = `_mjs_p_stored_${uname}`
      const parsedVar = `_mjs_p_parsed_${uname}`
      const curVar    = `_mjs_p_cur_${uname}`
      const jsonVar   = `_mjs_p_json_${uname}`
      const writeKey  = entry.suffix ? `_mjs_p_wkey_${uname}` : keyVar
      const writeDecl = entry.suffix ? `  ${writeKey} := ${keyExpr}\n` : ''
      code += `\n${keyVar} .= ${keyExpr}\n` +
              `try\n` +
              `  ${storedVar} := ${backend}.getItem(${keyVar})\n` +
              `  if ${storedVar}\n` +
              `    ${parsedVar} := JSON.parse(${storedVar})\n` +
              `    ${curVar} := $${clean}\n` +
              `    if ${curVar} is undefined or (typeof ${parsedVar} is typeof ${curVar} and (not ${curVar} or (${parsedVar} isnt null and Array.isArray(${parsedVar}) is Array.isArray(${curVar}))))\n` +
              `      $${clean} = ${parsedVar}\n` +
              `catch _e\n` +
              `  null\n` +
              `µ.effect =>\n` +
              writeDecl +
              `  ${jsonVar} := JSON.stringify($${clean})\n` +
              `  try\n` +
              `    ${backend}.setItem(${writeKey}, ${jsonVar})\n` +
              `  catch _e\n` +
              `    null\n` +
              `  return\n`
    }
  }
  return code
}
