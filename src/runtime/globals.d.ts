// Globals injectés au runtime ModularJS — `µ` est l'objet API exposé sur
// `globalThis` après que `mjs_init.ts` se soit exécuté. Les fichiers du
// runtime peuvent le référencer librement, ce fichier les en informe TS.

declare global {
  // eslint-disable-next-line no-var
  var µ: any
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    µ: any
  }
  // µ.adoptSheet(el, feuille) (mjs_adopt_sheet.ts) : colle une feuille de style dans l'ombre d'un composant et rend la fonction
  // qui la retire ; `feuille` : une CSSStyleSheet ou un texte CSS. Rien n'est collé (et la fonction rendue ne fait rien) pour une
  // balise sans ombre (`mjs-light`) ou qui n'est pas un composant
  type MjsAdoptSheet = (el: HTMLElement, sheet: CSSStyleSheet | string) => () => void
}

export {}
