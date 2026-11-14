// transpiler/mu-escapes — `µ` tel qu'un code compilé peut l'écrire : en clair, ou échappé. Tout échappement valide d'un identifiant
// le désigne, écrit à la main ou par un outil (`\u00B5`, `\u00b5`, `\u{B5}`, `\u{b5}`, zéros en tête
// compris). Les relevés qui cherchent `µ` dans un code compilé (repère des appels de µload, choix des modules du cœur, clés du magasin
// global lues par un module, ligne `µ.debug = …` retirée en production) lisent le texte où ces formes sont écrites en clair ; le code
// produit, lui, ne change pas. Faux positif accepté : un `µ` écrit dans une chaîne compte comme `µ`

const MU_ECHAPPE = /\\u(?:00[bB]5|\{0*[bB]5\})/g

/** `js` où chaque forme échappée de `µ` est écrite en clair ; le même texte quand il n'en porte aucune. `memeLongueur` : chaque forme
 *  devient `µ` précédé d'espaces, le texte garde sa longueur et ses positions (relevé qui retire du texte réel aux positions trouvées) */
export function unescapeMu(js: string, memeLongueur = false): string {
  if (!js.includes('\\u')) return js
  return memeLongueur ? js.replace(MU_ECHAPPE, (forme) => ' '.repeat(forme.length - 1) + 'µ') : js.replace(MU_ECHAPPE, 'µ')
}
