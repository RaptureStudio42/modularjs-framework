// effects/settings-comment — un commentaire écrit dans les réglages d'un effet (`*nom(…)`, `@in=*nom(…)`, un alias ou un effet d'un fichier
// `*.effects.mjs`). Des réglages sont des mots, des nombres, des couleurs, des listes et des chemins : un commentaire n'y a aucun sens, et le laisser
// passer le fait devenir une valeur (`*fluid(background: red, // le fond` : la note est lue comme une seconde couleur et le réglage qui suit est perdu).
// La construction le refuse, en le citant.
//
// Un `//` ou un `/*` est un commentaire quand il commence un mot (au début des réglages, après un blanc, une virgule, une parenthèse, un crochet, un
// guillemet) ou qu'il est collé à un mot simple (`12// note`, `red/* note */`). Ce n'est pas un commentaire :
//   - dans une chaîne entre guillemets (`'// ici'`) ;
//   - collé à un chemin (`/img/*.png`, `/img//a.png`) ou à un protocole (`https://`) ;
//   - après `url(`, ou devant un nom d'hôte suivi de son chemin (`//cdn.exemple.fr/a.png`) : une adresse ;
//   - un `/*` jamais refermé (`[/*.png]`) ;
//   - la barre oblique d'une division ou d'une couleur (`hsl(210 50% 20% / .4)`), qu'aucune autre barre ni étoile ne suit.

export interface SettingsComment {
  /** sa place dans les réglages */
  at: number
  /** le commentaire tel que le message le cite : sur une ligne, raccourci à 40 caractères */
  text: string
}

// ce qui borne un mot
const BOUNDARY = /[\s,;()[\]{}'"`]/
// un nom d'hôte suivi de son chemin : `cdn.exemple.fr/…`, `localhost:3000/…`
const HOST     = /^(?:[\w-]+(?:\.[\w-]+)+|localhost)(?::\d+)?\//

// le commentaire sur une ligne, coupé par caractères entiers (jamais au milieu d'un émoji)
function short(text: string): string {
  const flat  = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > 40 ? chars.slice(0, 40).join('') + '…' : flat
}

/** le premier commentaire écrit dans `raw`, les réglages d'un effet (le texte entre ses parenthèses), sinon null */
export function settingsComment(raw: string): SettingsComment | null {
  let quote = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    const next = raw[i + 1]
    if (ch !== '/' || (next !== '/' && next !== '*')) continue
    // le mot auquel la barre est collée
    let from = i
    while (from > 0 && !BOUNDARY.test(raw[from - 1])) from--
    const word = raw.slice(from, i)
    if (next === '/') {
      // un chemin (`/img//a.png`), un protocole (`https://`), `url(//…)`, un hôte et son chemin (`//cdn.exemple.fr/a.png`) : une adresse
      if (word.includes('/') || word.endsWith(':')) continue
      if (word === '' && (/\burl\(\s*$/i.test(raw.slice(0, i)) || HOST.test(raw.slice(i + 2)))) continue
      const end = raw.indexOf('\n', i)
      return { at: i, text: short(raw.slice(i, end < 0 ? raw.length : end)) }
    }
    // `/*` collé à un chemin (`/img/*.png`) : c'est son joker ; jamais refermé, ce n'est pas un commentaire
    if (word.includes('/')) continue
    const end = raw.indexOf('*/', i + 2)
    if (end < 0) continue
    return { at: i, text: short(raw.slice(i, end + 2)) }
  }
  return null
}
