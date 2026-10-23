// bundler/hologram-motifs — les images des motifs de *hologram. Le framework les livre (src/assets/hologram/<motif>.<ext>) ; le build
// n'en copie dans la sortie de l'appli que celles que le fichier de l'effet, déjà réduit aux styles écrits, lit : un style de carte
// porte sa section, la section nomme ses motifs (`tex('sky-far')`, `pat('grain')`), donc le fichier réduit EST la liste des images
// à copier. Un style que le build ne sait pas lire garde toutes les sections, donc toutes les images.
//
// Le fichier de l'effet déclare `var _MJS_FX_HOLO_IMAGES = {};` ; le build y écrit l'adresse publiée de chaque image copiée. Tel quel
// (tests, éditeur) la table reste vide : un motif sans image est absent, et la feuille lit toujours la variable du thème d'abord.

/** les onze motifs que le paquet livre (un fichier par motif dans src/assets/hologram/) : tous, quand le fichier de l'effet part en entier */
export const HOLOGRAM_MOTIFS = ['sparkles', 'grain', 'sky-far', 'sky-mid', 'sky-near', 'ripples', 'ripples-mask', 'waves', 'discs', 'maze', 'weave']

/** la déclaration, dans le fichier de l'effet, de la table des images livrées */
export const HOLOGRAM_IMAGES_DECL = 'var _MJS_FX_HOLO_IMAGES = {};'

// un motif lu par la feuille : `tex('sky-far')` ou `pat('grain')`
const REGEX_MOTIF = /(?<![\w$.])(?:tex|pat)\('([a-z0-9-]+)'\)/g

/** les motifs que le texte d'un fichier d'effet (réduit aux styles demandés) lit, triés */
export function hologramMotifsOf(text: string): string[] {
  return [...new Set([...text.matchAll(REGEX_MOTIF)].map((m) => m[1]))].sort()
}

/** le fichier de l'effet avec, dans sa table, l'adresse de chaque image livrée (motif -> adresse) */
export function injectHologramImages(text: string, urls: Record<string, string>): string {
  if (Object.keys(urls).length === 0) return text
  return text.replace(HOLOGRAM_IMAGES_DECL, () => `var _MJS_FX_HOLO_IMAGES = ${JSON.stringify(urls)};`)
}
