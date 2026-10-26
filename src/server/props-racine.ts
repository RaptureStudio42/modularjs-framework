// Props de la balise RACINE d'un rendu serveur (`RenderOptions.props`), communes aux deux moteurs (renderToString.ts,
// render-browser.ts).
//
// Le texte d'un attribut ne dit pas tout : la balise relit `true`, `false`, `null`, `undefined` et le JSON d'un objet ou
// d'une liste comme tels, tout le reste en chaîne. Un nombre posé en attribut (`a="5"`) arrivait donc en chaîne, sur le
// serveur comme au client : `$a + $b` rendait « 57 », là où un parent qui passe `a={5}` donne 12. Une chaîne `'true'` ou
// `'[1]'` arrivait, elle, en booléen ou en liste.
//
// RÈGLE — chaque prop garde son attribut texte, comme avant. Celles que ce texte ne redonne pas telles quelles (un nombre,
// une chaîne que la balise relirait autrement) voyagent EN PLUS, typées, en JSON, dans le seul attribut `mjs-props`.
// `connectedCallback` (runtime, mjs_element.ts) le verse au registre des props en attente à chaque connexion : au serveur
// au branchement de la racine, au client à son démarrage comme pour une balise posée plus tard (navigation d'une page
// rendue par requête). C'est le chemin des props qu'un parent pose avant la mise à niveau d'un enfant : elles l'emportent
// sur leur attribut, que le montage ne relit pas, et le serveur rend ce que le client reprend, avec la même limite JSON
// (cf. docs/19-ssr.md, pièges).
//
// NOMS — la balise lit un nom d'attribut en camelCase (`user-id` → `userId`), les clés de `mjs-props` aussi. Le nom
// d'un attribut ne garde pas sa casse (`userId` y devient `userid`) : une majuscule s'écrit donc en kebab-case.

/** Nom de prop accepté : concaténé dans le markup, une clé `x><img onerror=…>` y injecterait du HTML (XSS réfléchi). */
export const PROP_NAME_RE = /^[A-Za-z_][\w:.-]*$/

/** Nom d'attribut d'une prop, celui que la balise relit en ce nom : `userId` → `user-id` (cf. en-tête, NOMS). Une
 * majuscule en tête reste telle quelle : aucun nom d'attribut ne la redonne. */
export function nomAttribut(k: string): string {
  return k.replace(/(?<=.)[A-Z]/g, (c) => '-' + c.toLowerCase())
}

/** Texte d'attribut d'une prop : objets et listes en JSON, le reste en chaîne. */
export function serializeProp(v: unknown): string {
  return (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v)
}

// la valeur que la balise relit d'un texte d'attribut, sans schéma de props : les règles de la lecture des attributs du
// runtime (`connectedCallback`, mjs_element.ts)
function relu(texte: string): unknown {
  if (texte === 'true') return true
  if (texte === 'false') return false
  if (texte === 'null') return null
  if (texte === 'undefined') return undefined
  if (texte.length > 1 && (texte[0] === '{' || texte[0] === '[')) {
    try {
      return JSON.parse(texte)
    } catch {
      return texte
    }
  }
  return texte
}

export interface PropsRacine {
  /** Attributs de la balise, nom → texte non échappé, `mjs-props` compris. */
  attrs: Record<string, string>
  /** Clés refusées (nom invalide), à signaler par l'appelant. */
  refusees: string[]
}

/** Attributs texte des props, plus `mjs-props` pour celles que ce texte ne redonne pas (cf. en-tête). */
export function propsRacine(props: Record<string, unknown>): PropsRacine {
  const attrs: Record<string, string>   = Object.create(null)
  const typees: Record<string, unknown> = Object.create(null)
  const refusees: string[]              = []
  let typeesVues                        = false
  for (const [k, v] of Object.entries(props)) {
    if (!PROP_NAME_RE.test(k)) {
      refusees.push(k)
      continue
    }
    attrs[nomAttribut(k)] = serializeProp(v)
    if (typeof v === 'number' || (typeof v === 'string' && relu(v) !== v)) {
      typees[k]  = v
      typeesVues = true
    }
  }
  if (typeesVues) attrs['mjs-props'] = JSON.stringify(typees)
  return { attrs, refusees }
}
