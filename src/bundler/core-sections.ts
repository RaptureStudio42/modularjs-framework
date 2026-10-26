// bundler/core-sections — un module cœur (src/core-modules/*.mjs) porte, en plus de ce qui sert à toute liste, des MORCEAUX REPÉRÉS qui ne
// servent qu'à un attribut (`other` de <@@select> : la réponse libre « Autre » ; `group` de <@@sortable> : les groupes). Le build ne garde que ce que l'appli demande : un morceau
// reste dès qu'une page écrit l'attribut (ou que le build ne sait pas : étalement `{...p}`), en développement comme en production (cf. STRICT_ATTRS) ; seuls les
// morceaux d'un fait de l'appli (`transition`) ou d'un réglage (`reprise`) restent tous en développement.
// Tel quel, le fichier porte tout et marche seul (tests, éditeur, copie dans un projet : les repères y sont des commentaires). Ici il est
// filtré, et les repères ne sortent jamais. Un fichier sans repère passe tel quel.
//
// Les repères, dans le langage de la zone ; ils s'emboîtent et s'écrivent au retrait du code voisin (en colonne 0, un commentaire casse le
// script et le style) :
//   script (Civet)  `# @@ <étiquette>` sur sa ligne, jusqu'à la ligne `# @@` ; ou `code # @@ <étiquette>` en fin de ligne pour cette ligne seule
//   gabarit         `<!-- @@ <étiquette> -->` sur sa ligne, jusqu'à `<!-- @@ -->` ; ou la paire sur une même ligne, autour d'un bout de ligne
//   style (SASS)    `// @@ <étiquette>` sur sa ligne, jusqu'à la ligne `// @@`
// L'étiquette nomme l'attribut qui demande le morceau, le module est celui du fichier (select.mjs : `other`, sortable.mjs : `group`) ; ci-dessous avec `other` :
//   other           le morceau est propre à l'attribut : il part quand aucune page ne l'écrit
//   !other          l'autre forme des lignes qui existent avec et sans l'attribut : écrite en commentaire (`# ` ou `// ` devant), elle est
//                   décommentée quand `other` part, et retirée quand il reste
//   dev other       l'avertissement du développement : gardé en développement seulement, et seulement quand aucune page n'écrit `other` ; pour un
//                   attribut de STRICT_ATTRS, son code s'écrit en commentaire sous `!other`, réveillé quand le morceau part (une copie du module
//                   posée dans un projet garde tout et ne le dit jamais)
// Une étiquette peut nommer un FAIT de l'appli plutôt qu'un attribut : `transition` (TRANSITION_LABEL) veut dire « une page du projet écrit une
// transition (`@in`, `@out`, `@transition`) », décision `Bundler.coreTransitionWritten()`. Elle s'écrit comme les autres (`transition`, `!transition`,
// `dev transition`) et s'emboîte avec elles : un morceau de sortable.mjs cerné par `group` puis par `transition` n'est gardé que si l'appli
// écrit un attribut `group` ET une transition.
// `reprise` (RESUME_LABEL) nomme un autre fait : « l'appli reprend des pages rendues par le serveur » (une page rendue dans un mode qui adopte le DOM du
// serveur, ou le moteur de reprise demandé par `runtime`), décision `Bundler.coreResumeWanted()` — le signal même qui embarque le moteur de reprise
// (mjs_hydrate.ts). Les modules de saisie (case, interrupteur, radio, nombre, jauge, bouton rotatif, liste) y rangent le code qui écrit leur état de départ
// dans leur balise : seul le serveur l'exécute, et l'appli qui ne reprend aucune page du serveur n'a pas à le recevoir.
// `tool-<nom>` (TOOL_PREFIX) nomme un outil de la barre de l'éditeur riche (`tool-link`, `tool-check`…) : « l'appli peut afficher cet outil », décision
// `Bundler.coreToolShown()`. Une page le peut quand une de ses balises <@@editor> n'a pas d'attribut `toolbar` (ou <@@toolbar> pas de `tools`), a une valeur
// calculée ou un étalement (le build ne sait pas), ou nomme l'outil. Comme `reprise`, c'est un fait de l'appli pris sur les seules pages du projet, avant qu'aucun
// module cœur ne soit compilé : l'éditeur écrit lui-même une <@@toolbar tools={…}> dans son gabarit, qui ne compte pas. Les morceaux d'un outil sont son entrée et son
// icône dans la barre (toolbar.mjs), et ce qui ne sert qu'à le faire agir (editor.mjs) ; ce qui affiche et coche une liste à cocher déjà dans la valeur n'en dépend jamais.
// Une étiquette peut aussi nommer un groupe d'outils (`tool-icons`, `tool-glyphs`, `tool-heads`, `tool-keys`), le séparateur d'une liste (`tool-separator`), ou aucun outil
// (`tool-script` : l'avertissement d'un outil qu'une barre reçoit d'un script) : TOOL_GROUPS.
// Un attribut de STRICT_ATTRS se tranche partout pareil : son morceau part dès qu'aucune page ne l'écrit, en développement comme en production, pour que
// le rendu serveur et le navigateur, le développement et la production emportent le même gabarit (`toolbar` de <@@chart>, `other` de <@@select>, `answer`
// de <@@editor>, `group` de <@@sortable>). Le doute y est plus large que pour un autre attribut (Bundler.coreAttrWrittenStrict) : une balise dynamique qui
// écrit l'attribut ou un étalement, un script qui nomme la balise du module gardent le morceau. Un outil (`tool-<nom>`) se tranche de même, sur
// Bundler.coreToolShown, avec le même doute pour les balises <@@editor> (`toolbar`) et <@@toolbar> (`tools`).
// Une ligne retirée, ou de repère, est remplacée par une ligne VIDE : les numéros de ligne des messages du compilateur sont ceux du fichier.

import { t } from '../messages/index.js'

/** l'étiquette qui ne nomme pas un attribut mais un fait de l'appli : une page du projet écrit une transition (`@in`, `@out`, `@transition`) */
export const TRANSITION_LABEL = 'transition'

/** l'étiquette qui nomme un autre fait de l'appli : elle reprend des pages rendues par le serveur (un mode de rendu qui adopte le DOM du serveur, ou `runtime: ['hydrate']`) */
export const RESUME_LABEL = 'reprise'

/** le début des étiquettes qui nomment un outil de la barre de l'éditeur riche (`tool-link`) : l'appli peut-elle afficher cet outil ? */
export const TOOL_PREFIX = 'tool-'

/**
 * Les groupes d'outils : `tool-<groupe>` est vraie quand l'appli peut afficher l'un des outils du groupe (un morceau qui sert plusieurs outils, comme le style des
 * icônes). `keys` : les deux outils dont le raccourci n'agit que si une barre de l'éditeur montre l'outil (l'éditeur interroge ses barres, elles s'inscrivent auprès de lui).
 * `separator` n'est pas un outil mais le séparateur `|` d'une liste : vrai quand une barre en écrit un.
 * `script` n'a aucun outil : jamais vrai, il répond « non » dès que la construction tranche les outils (toutes les barres disent leur liste, aucun doute). Il cerne
 * l'avertissement du développement d'un outil qu'une barre reçoit d'un script alors que la construction l'a ôté (`dev tool-script`, toolbar.mjs) : présent dès qu'un outil peut manquer.
 */
export const TOOL_GROUPS: Readonly<Record<string, readonly string[]>> = {
  icons:     ['ul', 'ol', 'check', 'link', 'undo', 'redo', 'clear'],
  glyphs:    ['h2', 'h3', 'quote', 'bold', 'italic', 'underline', 'strike'],
  heads:     ['h2', 'h3'],
  keys:      ['link', 'check'],
  separator: ['|'],
  script:    [],
}

/**
 * Les attributs que le développement tranche comme la production, par module : leur morceau part dès qu'aucune page ne les écrit (cf.
 * Bundler.coreAttrWrittenStrict, qui en décide), leur autre forme (`!attr`) revient alors partout. `toolbar` de <@@chart> : la barre d'outils,
 * ses fonctions, son gabarit, son style et ses icônes (ses libellés : CORE_LABEL_PARTS, runtime-labels.ts) ; `answer` de <@@editor> : le mode
 * « répondre » ; `other` de <@@select> : la réponse libre « Autre » ; `group` de <@@sortable> : les groupes.
 */
export const STRICT_ATTRS: Readonly<Record<string, readonly string[]>> = {
  chart:    ['toolbar'],
  editor:   ['answer'],
  select:   ['other'],
  sortable: ['group'],
}

/** ce que demande une étiquette : le morceau propre à l'attribut, son autre forme, l'avertissement du développement */
export type CoreKind = 'piece' | 'alt' | 'dev'

type Open = { syntax: string, keep: boolean, alt: boolean }

const REGEX_LABEL  = /^(?:(dev) |(!))?([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/
const REGEX_MARKS  = [
  { syntax: '#',    regex: /^\s*# @@(?: ([^<>]*?))?\s*$/ },
  { syntax: '//',   regex: /^\s*\/\/ @@(?: ([^<>]*?))?\s*$/ },
  { syntax: '<!--', regex: /^\s*<!-- @@(?: ([^<>]*?))? -->\s*$/ },
]
const REGEX_TRAIL  = /^(.*\S)\s+# @@ ([^<>]+?)\s*$/
const REGEX_INLINE = /<!-- @@ ([^<>]*?) -->(.*?)<!-- @@ -->/g
const REGEX_ANY    = /(?:#|\/\/|<!--) @@/
const REGEX_NOTE   = /^(\s*)(?:#|\/\/)(?: |$)/
const REGEX_HTML   = /^(\s*)<!-- (.*) -->\s*$/

/**
 * Le texte du module réduit aux morceaux que `decide` garde ; les repères ne sortent jamais. `file` : le fichier (pour les messages),
 * `decide(genre, attribut)` : ce morceau reste-t-il (`attribut` est le nom de l'étiquette : un attribut, ou TRANSITION_LABEL). Une marque mal
 * fermée, ou une étiquette illisible, est une erreur de build : jamais un morceau manquant ou retenu en silence.
 */
export function selectCoreSections(file: string, src: string, decide: (kind: CoreKind, attr: string) => boolean): string {
  if (!REGEX_ANY.test(src)) return src
  const stack: Open[] = []
  const out: string[] = []
  const read = (label: string): { kind: CoreKind, attr: string } => {
    const m = REGEX_LABEL.exec(label)
    if (!m) throw new Error(t('bundler.core-sections.etiquette-illisible', { fichier: file, jeton: label }))
    return { kind: m[1] ? 'dev' : m[2] ? 'alt' : 'piece', attr: m[3] }
  }
  const inside = () => stack.length === 0 || stack[stack.length - 1].keep
  // l'autre forme revient en code : le commentaire de la ligne (`# `, `// ` ou `<!-- … -->`) s'en va, le retrait reste
  const awake = (text: string) => text.replace(REGEX_NOTE, '$1').replace(REGEX_HTML, '$1$2')
  for (const line of src.split('\n')) {
    const mark = REGEX_MARKS.map(({ syntax, regex }) => ({ syntax, hit: regex.exec(line) })).find(m => m.hit)
    if (mark) {
      const label = mark.hit![1]
      if (label) {
        const { kind, attr } = read(label)
        stack.push({ syntax: mark.syntax, keep: inside() && decide(kind, attr), alt: kind === 'alt' })
      }
      else {
        const open = stack.pop()
        if (!open) throw new Error(t('bundler.core-sections.section-sans-ouverture', { fichier: file }))
        if (open.syntax !== mark.syntax) throw new Error(t('bundler.core-sections.section-non-fermee', { fichier: file }))
      }
      out.push('')
      continue
    }
    if (!inside()) {
      out.push('')
      continue
    }
    const trail = REGEX_TRAIL.exec(line)
    if (trail) {
      const { kind, attr } = read(trail[2])
      out.push(decide(kind, attr) ? (kind === 'alt' ? awake(trail[1]) : trail[1]) : '')
      continue
    }
    let text = line
    if (!REGEX_NOTE.test(line) && text.includes('<!-- @@')) {
      text = text.replace(REGEX_INLINE, (_all, label: string, body: string) => {
        const { kind, attr } = read(label)
        return decide(kind, attr) ? body : ''
      })
      if (text.includes('<!-- @@')) throw new Error(t('bundler.core-sections.section-non-fermee', { fichier: file }))
    }
    out.push(stack.some(s => s.alt) ? awake(text) : text)
  }
  if (stack.length > 0) throw new Error(t('bundler.core-sections.section-non-fermee', { fichier: file }))
  return out.join('\n')
}
