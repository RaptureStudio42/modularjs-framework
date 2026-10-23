// effects/style-comment — le commentaire `//` d'une ligne de CSS d'un effet à soi (le bloc <effects> d'un fichier `*.effects.mjs`) :
//
//   *halo(color: #0ff, size: 12px) =
//     box-shadow: 0 0 $size $color // le halo
//
// Le CSS d'un effet part tel quel dans la feuille du navigateur, qui ne connaît pas `//` : il lisait « // le halo » comme une
// valeur, jugeait la déclaration fausse et la jetait, sans un mot. Le commentaire est retiré à la lecture, comme le fait un bloc
// `<style>` : il va jusqu'au bout de la ligne. Ce qui n'est pas un commentaire reste en place :
//   - un `//` dans un texte entre guillemets (`content: "//"`) ;
//   - un `//` dans `url(…)` (`url(//cdn/x.png)`), quoi que l'adresse y soit, guillemets ou non ;
//   - un `//` collé à un protocole (`https://exemple.fr/a.png`), hors du deux-points qui sépare la propriété de sa valeur ;
//   - un `/* … */`, qui est du CSS : le navigateur l'ignore, et le `//` qu'il contient n'est pas un commentaire.

// `url(` en tête de fonction (pas `curl(`) : l'adresse qui suit se lit jusqu'à la parenthèse fermante
const URL_RE    = /^url\(/i
const NAME_CHAR = /[\w-]/
// un protocole juste avant un `//` : `https:`, `file:`, `wss:`
const SCHEME_RE = /(?:^|[^\w+.-])[A-Za-z][A-Za-z0-9+.-]*:$/

/** la ligne de CSS sans son commentaire `//` (jusqu'au bout de la ligne) ni le blanc qui le précédait ; la ligne telle quelle quand elle n'en porte pas */
export function stripLineComment(line: string): string {
  // le deux-points qui sépare la propriété de sa valeur : il n'est jamais celui d'un protocole
  const separator = line.indexOf(':')
  let quote = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === '\'') {
      quote = ch
      continue
    }
    if (ch === '/' && line[i + 1] === '*') {
      // un commentaire CSS reste, avec ce qu'il contient ; jamais refermé, il court jusqu'au bout de la ligne
      const end = line.indexOf('*/', i + 2)
      if (end < 0) return line
      i = end + 1
      continue
    }
    if ((ch === 'u' || ch === 'U') && URL_RE.test(line.slice(i, i + 4)) && (i === 0 || !NAME_CHAR.test(line[i - 1]))) {
      // une adresse entre guillemets se lit comme un texte ; sans guillemets, elle va jusqu'à la parenthèse fermante
      let from = i + 4
      while (line[from] === ' ' || line[from] === '\t') from++
      if (line[from] === '"' || line[from] === '\'') {
        i = from - 1
        continue
      }
      const close = line.indexOf(')', from)
      if (close < 0) return line
      i = close
      continue
    }
    if (ch !== '/' || line[i + 1] !== '/') continue
    // une adresse à protocole (`https://…`) : le `//` n'ouvre pas de commentaire
    if (i - 1 > separator && SCHEME_RE.test(line.slice(0, i))) {
      i++
      continue
    }
    return line.slice(0, i).trimEnd()
  }
  return line
}

// vrai quand la ligne ne porte que des commentaires (`// …`, `/* … */`) et des blancs : il n'y a aucun CSS à y lire
export function isCommentLine(line: string): boolean {
  return stripLineComment(line).replace(/\/\*[\s\S]*?\*\//g, '').trim() === ''
}
