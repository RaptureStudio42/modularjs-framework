// expression qui désigne le <mjs-core-select> d'un hôte <mjs-p-select> : à lire avant le montage, elle rend `undefined` (jamais d'exception)
export const SELECT_DE_HOTE = `(document.querySelector('mjs-p-select')?._shadow?.querySelector('mjs-core-select'))`
