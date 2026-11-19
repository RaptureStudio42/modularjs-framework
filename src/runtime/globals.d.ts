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
  // `$x = await f($q, µsignal)` (mjs_await_derived.ts, écrit `µ._mjs_setAwait(composant, 'x', async (signal) => …, ['q'], lu)` par le
  // compilateur) : `f` reçoit le signal de l'appel (`µsignal`, lu dans l'expression seule), `suivies` les variables dont l'écriture
  // relance la demande, vide quand l'expression n'en cite aucune (`$moi = await charger()` : un seul appel) ; `lu` : 1 quand le
  // composant lit l'erreur. La valeur ne s'écrit pas à la main, ni dans un magasin, et ne se cite pas : refusé à la construction. Retiré
  // de la page, le composant ne demande plus rien ; remis dans la page, il refait la demande coupée ; son script rejoué à chaud garde la
  // valeur affichée et refait la demande une fois
  type MjsSetAwait = (el: HTMLElement, name: string, f: (signal: AbortSignal) => Promise<unknown>, tracked: string[], read?: 1) => void
  // µpending($x) (mjs_await_derived.ts, écrit `µ._mjs_awPending(composant, 'x')` par le compilateur) : vrai tant que la valeur dérivée
  // qui attend `$x` attend une réponse, avant la première puis pendant chaque nouvelle demande, suivi par les dérivées et le gabarit qui
  // le lisent ; sur une variable qui n'attend pas, ou mal écrit (`µpending()`, `µpending($$x)`, `µpending($x.a)`), refusé à la construction
  type MjsPending = (el: HTMLElement, name: string) => boolean
  // µfailed($x) (`µ._mjs_awFailed(composant, 'x')`) : l'erreur de la dernière demande de `$x`, sinon null — une réponse que la règle
  // du <vars> refuse en est une ; la réponse juste suivante l'efface, la valeur d'avant reste ; sur une variable qui n'attend pas, refusé
  // à la construction. Une erreur que le composant ne lit pas va à la console d'erreurs (`µ.error`)
  type MjsFailed = (el: HTMLElement, name: string) => unknown
}

export {}
