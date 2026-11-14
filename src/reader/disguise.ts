// reader/disguise — les raccourcis de MJS que Civet ne lit pas, déguisés à longueur égale avant Civet
// chaque raccourci devient une lettre que tout lecteur JavaScript prend dans un nom : un indice du texte déguisé est
// l'indice du fichier, et un déguisement tombé dans une chaîne ou un commentaire retrouve son écriture (rendre)
// lettres du bloc latin étendu D (U+A720-A7FF), sans écriture vivante, une unité UTF-16 chacune ; vérifiées dans un
// nom au début comme au milieu par acorn, Civet, esbuild et Terser

// écriture de MJS → lettre ; `@@` devient deux lettres, `@import` (en tête de ligne d'un script) une lettre suivie
// du nom de la directive
export const LETTRES_RESERVEES: Readonly<Record<string, string>> = Object.freeze({
  '§':       'Ꞩ',                  // Ꞩ, S barré en oblique
  '@@':      'Ꜳ',                  // Ꜳ, ligature AA
  '#':       'Ꞥ',                  // Ꞥ, N barré en oblique
  '&':       'Ꞁ',                  // Ꞁ, L culbuté
  '@import': 'Ꜷ',                  // Ꜷ, ligature AU
})

const PARAGRAPHE  = LETTRES_RESERVEES['§']
const AROBASE     = LETTRES_RESERVEES['@@']
const DIESE       = LETTRES_RESERVEES['#']
const ESPERLUETTE = LETTRES_RESERVEES['&']
const DIRECTIVE   = LETTRES_RESERVEES['@import']

// lettre déguisée → écriture rendue (un caractère chacune)
const RENDU: Readonly<Record<string, string>> = { [PARAGRAPHE]: '§', [AROBASE]: '@', [DIESE]: '#', [ESPERLUETTE]: '&', [DIRECTIVE]: '@' }

export const RE_LETTRE_RESERVEE = new RegExp(`[${Object.values(LETTRES_RESERVEES).join('')}]`, 'g')

// directives qu'un script écrit en tête de ligne ; lues par Civet comme un appel `Ꜷimport(…)`
const DIRECTIVES_SCRIPT = /^([ \t]*)@(import|i18n|persist|preload)(?=[ \t]+[^=\s])/gm

// déguise un morceau de code ; `=:` (valeur figée) devient `:=`, que la passe relit à la même position
// `#` collé à une lettre seulement s'il n'en suit pas un autre : `###Note` ouvre un bloc, `####Titre` est une bannière
export function deguiser(code: string): string {
  return code
    .replace(/§/g, PARAGRAPHE)
    .replace(/@@/g, AROBASE + AROBASE)
    .replace(/(?<!#)#(?=[A-Za-z_])/g, DIESE)
    .replace(/(?<![\w$&)\]])&(?=[A-Za-z_])/g, ESPERLUETTE)
    .replace(/(?<=[\w$\]) ])=:(?=[ \t])/g, ':=')
    .replace(DIRECTIVES_SCRIPT, `$1${DIRECTIVE}$2`)
}

// rend les raccourcis déguisés d'un texte ; `seules` : ne rendre que ces lettres (celles écrites telles quelles dans
// le texte brut d'une chaîne, et non par un échappement `Ꞩ`)
export function rendre(texte: string, seules?: Set<string>): string {
  return texte.replace(RE_LETTRE_RESERVEE, (l) => !seules || seules.has(l) ? RENDU[l] : l)
}

export function lettresPresentes(texte: string): Set<string> {
  return new Set(texte.match(RE_LETTRE_RESERVEE) ?? [])
}

// indices des lettres réservées déjà présentes dans une source (une source qui en contient est refusée)
export function lettresReserveesDe(source: string): number[] {
  return [...source.matchAll(RE_LETTRE_RESERVEE)].map((m) => m.index)
}

// message de refus d'une lettre réservée, avec la correction
export function messageLettreReservee(lettre: string): string {
  const code = lettre.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
  return `la lettre « ${lettre} » (U+${code}) est réservée à la lecture des raccourcis de ModularJS : écrivez-la \\u${code} dans une chaîne du code, ou &#x${code}; dans le texte du gabarit`
}
