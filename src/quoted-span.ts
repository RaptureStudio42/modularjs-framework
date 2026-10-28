// quoted-span — le balayeur de chaînes commun du transpileur, du générateur, du lexeur, des runes (sigils.ts), des balises <img> et
// macros, du bundler (registre des variables de thème, motifs de déstructuration) et du rendu serveur (CSS des composants légers).
// Aucune dépendance : macro-tag.ts, qui ne dépend de rien d'autre, s'en sert aussi

// index du guillemet fermant de la chaîne `'…'`/`"…"`/`` `…` `` ouverte en `i` (échappements `\` sautés, un gabarit ne s'y
// lit pas plus loin que son guillemet), `str.length` si elle ne se ferme pas
export function quoteClose(str: string, i: number): number {
  const quote = str[i]
  let j = i + 1
  while (j < str.length && str[j] !== quote) { if (str[j] === '\\') j++; j++ }
  return Math.min(j, str.length)
}

// l'index juste après cette chaîne, `str.length` si elle ne se ferme pas
export function skipQuotedSpan(str: string, i: number): number {
  return Math.min(quoteClose(str, i) + 1, str.length)
}
