// Textes racine de la graine `#__mjs_i18n` : les clés hors section que la page a lues pendant son rendu (`µ._i18nUsedRoot`,
// noté par `µ.t`), rangées en arbre partiel par langue, `{fr: {titre: '…', landing: {haut: '…'}}}`. Jamais le dictionnaire racine entier.
// Les deux moteurs de rendu l'exécutent dans la page (happy-dom par `eval`, navigateur par `evaluate`) : elle est donc écrite
// seule, sans rien qui vienne d'ailleurs, et injectée par son texte (`buildSeedRoot.toString()`).

/** `used` : `{langue: {clé: true}}` ; `langs` : `µ._i18nLangs` (`{langue: {root}}`). Rend `null` si rien n'est à semer. */
export function buildSeedRoot(used: any, langs: any): any {
  let out: any = null
  for (const lang in used) {
    const root = langs && langs[lang] && langs[lang].root
    if (!root) { continue }
    for (const cle in used[lang]) {
      const parts = cle.split('.')
      if (parts.indexOf('__proto__') !== -1) { continue }
      let src = root
      for (let i = 0; i < parts.length && src != null; i++) {
        src = typeof src === 'object' && Object.prototype.hasOwnProperty.call(src, parts[i]) ? src[parts[i]] : undefined
      }
      if (src == null) { continue }
      out = out || {}
      let dst = out[lang] = out[lang] || {}
      for (let j = 0; j < parts.length - 1; j++) {
        dst = dst[parts[j]] = (dst[parts[j]] && typeof dst[parts[j]] === 'object') ? dst[parts[j]] : {}
      }
      dst[parts[parts.length - 1]] = src
    }
  }
  return out
}
