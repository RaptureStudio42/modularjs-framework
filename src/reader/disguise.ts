// reader/disguise — les raccourcis de MJS que Civet ne lit pas, déguisés à longueur égale avant Civet
// chaque raccourci devient une lettre que tout lecteur JavaScript prend dans un nom : un indice du texte déguisé est
// l'indice du fichier, et un déguisement tombé dans une chaîne ou un commentaire retrouve son écriture (rendre)
// lettres du bloc latin étendu D (U+A720-A7FF), sans écriture vivante, une unité UTF-16 chacune ; vérifiées dans un
// nom au début comme au milieu par acorn, Civet, esbuild et Terser

// écriture de MJS → lettre ; `@@` devient deux lettres, `@import` (en tête de ligne d'un script) une lettre suivie
// du nom de la directive
export const RESERVED_LETTERS: Readonly<Record<string, string>> = Object.freeze({
  '§':       'Ꞩ',                  // Ꞩ, S barré en oblique
  '@@':      'Ꜳ',                  // Ꜳ, ligature AA
  '#':       'Ꞥ',                  // Ꞥ, N barré en oblique
  '&':       'Ꞁ',                  // Ꞁ, L culbuté
  '@import': 'Ꜷ',                  // Ꜷ, ligature AU
})

const SECTION_SIGN = RESERVED_LETTERS['§']
const AROBASE      = RESERVED_LETTERS['@@']
const HASH         = RESERVED_LETTERS['#']
const ESPERLUETTE  = RESERVED_LETTERS['&']
const DIRECTIVE    = RESERVED_LETTERS['@import']

// lettre déguisée → écriture rendue (un caractère chacune)
const RESTORED: Readonly<Record<string, string>> = { [SECTION_SIGN]: '§', [AROBASE]: '@', [HASH]: '#', [ESPERLUETTE]: '&', [DIRECTIVE]: '@' }

export const RE_RESERVED_LETTER = new RegExp(`[${Object.values(RESERVED_LETTERS).join('')}]`, 'g')

// directives qu'un script écrit en tête de ligne ; lues par Civet comme un appel `Ꜷimport(…)`
const DIRECTIVES_SCRIPT = /^([ \t]*)@(import|i18n|persist|preload)(?=[ \t]+[^=\s])/gm

// déguise un morceau de code ; `=:` (valeur figée) devient `:=`, que la passe relit à la même position
// `#` collé à une lettre seulement s'il n'en suit pas un autre : `###Note` ouvre un bloc, `####Titre` est une bannière
export function disguise(code: string): string {
  return code
    .replace(/§/g, SECTION_SIGN)
    .replace(/@@/g, AROBASE + AROBASE)
    .replace(/(?<!#)#(?=[A-Za-z_])/g, HASH)
    .replace(/(?<![\w$&)\]])&(?=[A-Za-z_])/g, ESPERLUETTE)
    .replace(/(?<=[\w$\]) ])=:(?=[ \t])/g, ':=')
    .replace(DIRECTIVES_SCRIPT, `$1${DIRECTIVE}$2`)
}

// rend les raccourcis déguisés d'un texte ; `only` : ne rendre que ces lettres (celles écrites telles quelles dans
// le texte brut d'une chaîne, et non par un échappement `Ꞩ`)
export function reveal(text: string, only?: Set<string>): string {
  return text.replace(RE_RESERVED_LETTER, (l) => !only || only.has(l) ? RESTORED[l] : l)
}

export function presentLetters(text: string): Set<string> {
  return new Set(text.match(RE_RESERVED_LETTER) ?? [])
}

// indices des lettres réservées déjà présentes dans une source (une source qui en contient est refusée)
export function reservedLettersOf(source: string): number[] {
  return [...source.matchAll(RE_RESERVED_LETTER)].map((m) => m.index)
}

// message de refus d'une lettre réservée, avec la correction
export function reservedLetterMessage(letter: string): string {
  const code = letter.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
  return `la lettre « ${letter} » (U+${code}) est réservée à la lecture des raccourcis de ModularJS : écrivez-la \\u${code} dans une chaîne du code, ou &#x${code}; dans le texte du gabarit`
}
