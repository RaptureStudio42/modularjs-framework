// mjs-ws/packages — paquets ACTIVABLES : regrouper les briques en paquets qui marchent
// ensemble. Symétrique CÔTÉ SERVEUR des
// préréglages `runtime` déjà livrés côté CLIENT (mjs.config.json, cf. bundler/config.ts) : LÀ, on
// choisit quelles briques du CORE embarquer dans le bundle ; ICI, on active des briques SERVEUR
// cohérentes au-dessus de `mjsWs()`/`mjsServer()`, composées SUR l'API PUBLIQUE (app.serve/on/
// room/stream/schema…) — jamais par accès à l'interne de core.ts.
//
// Ce fichier pose l'INTERFACE + `app.use` (branché dans core.ts) + UN exemple de référence
// (echoPackage) qui PROUVE le contrat. Les paquets applicatifs (chat, comptes, lobby)
// vivent chacun dans leur propre fichier, composés de la MÊME façon — jamais de
// logique dupliquée ici.

import type { MjsWsApp } from './core.js'

/**
 * Contrat d'un paquet serveur. `name` l'identifie pour `app.use` (double installation du MÊME
 * nom = warn, ignorée — cf. son commentaire dans core.ts) ; `install` enregistre ses handlers/
 * conventions sur l'app REÇUE. Il peut rendre une promesse (installation asynchrone, par exemple une base ouverte
 * au démarrage) : `app.use` reste synchrone et chaînable, le nom n'est inscrit qu'à la résolution (une seconde
 * installation du même nom encore en vol est ignorée), un rejet est journalisé, jamais relancé — cf. `use` dans core.ts.
 */
export interface MjsPackage {
  name: string
  install(app: MjsWsApp): void
}

/** fabrique ergonomique — `definePackage('name', app => { ... })` ≡ littéral `{ name, install }`. */
export function definePackage(name: string, install: (app: MjsWsApp) => void): MjsPackage {
  return { name, install }
}

// --- exemple de RÉFÉRENCE ---------------------------------------------------------------------
// echoPackage — exemple/patron pour les futurs paquets (chat/comptes/lobby) : PROUVE l'interface
// (un paquet enregistre un handler via app.serve, `app.use` le branche) sans rien décider côté
// jeu/métier. 'echo' renvoie sa charge telle quelle — trivial par construction, jamais destiné à
// un usage réel au-delà de la démonstration/du test du mécanisme lui-même.
export function echoPackage(): MjsPackage {
  return definePackage('echo', app => {
    app.serve('echo', p => p)
  })
}
