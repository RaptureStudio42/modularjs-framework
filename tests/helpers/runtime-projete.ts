// un fichier du runtime tel que le bundler le livre : `projeterPrecision` (bundler/index.ts) en tire la version par défaut (la règle de
// l'horloge, écrite en commentaire dans un fichier à blocs) ou, `precise` vrai, celle de l'option `derived: "precise"` — le texte brut
// d'un fichier à blocs n'est que la version de l'option
import { readFileSync } from 'node:fs'
import { projeterPrecision } from '../../src/bundler/index.js'

export function lireRuntime(chemin: string | URL, precise = false): string {
  return projeterPrecision(readFileSync(chemin, 'utf-8'), precise, true)
}

// le texte d'un bloc `// <nom>` … `// </nom>` d'un fichier du runtime tel que le bundler le livre : une part du cœur se charge seule,
// sans le reste de son fichier (le mur des prototypes, bloc `<mur>` de mjs_element.ts) ; un bloc introuvable lève
export function lireBloc(chemin: string | URL, nom: string): string {
  const src   = lireRuntime(chemin)
  const debut = src.indexOf('// <' + nom + '>\n')
  const fin   = src.indexOf('// </' + nom + '>', debut)
  if (debut < 0 || fin < 0) throw new Error('bloc <' + nom + '> introuvable dans ' + chemin)
  return src.slice(debut, fin)
}
