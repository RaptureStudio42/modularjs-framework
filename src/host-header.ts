// En-tête Host, lu de la même façon par les deux gardes contre le rebinding DNS : le serveur de développement
// (server/hmr.ts, createDevHostCheck) et la voie non signée du pont MJS WS (mjs-ws/bridge.ts : /stats, /metrics,
// /state en boucle locale). Chaque garde tient sa propre liste de noms admis ; seule la lecture est commune.

/** Nom de l'en-tête Host : minuscules, crochets d'une IPv6 retirés, sans le port. `undefined` si absent ou illisible
 *  (port non numérique, crochet non fermé, IPv6 sans crochets). Un tableau d'en-têtes : le premier. */
export function hostHeaderName(host: string | string[] | undefined): string | undefined {
  const v = Array.isArray(host) ? host[0] : host
  if (!v) return undefined
  const m = v.trim().toLowerCase().match(/^(?:\[([0-9a-f:.]+)\]|([^:\[\]]+))(?::\d*)?$/)
  return m ? (m[1] ?? m[2]) : undefined
}
