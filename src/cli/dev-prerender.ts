// cli/dev-prerender — relance le prérendu des pages `render.routes` après une
// recompilation de `mjs dev`.
//
// `prerenderPages`
// n'était appelé QUE dans `mjs build` : une page en mode `prerender`
// (render.routes) éditée pendant `mjs dev` déclenchait bien la recompilation
// + le reload HMR du JS, mais le HTML FIGÉ déjà écrit sur disque (généré une
// seule fois, potentiellement AVANT `mjs dev`, ou jamais du tout) ne se
// rafraîchissait JAMAIS — un dev qui travaille sur une page prérendue voyait
// un contenu PÉRIMÉ tant qu'il ne relançait pas `mjs build` manuellement.
//
// Extrait de cli.ts (même précédent que cli/dev-lock.ts) pour permettre un
// test direct — cli.ts exécute `run(process.argv)` inconditionnellement à son
// top-level, l'importer déclencherait une vraie exécution CLI.

import type { MjsConfig } from '../bundler/config.js'
import type { Bundler } from '../bundler/index.js'
import { prerenderPages, type PrerenderReport } from '../server/prerender.js'
import { emitStartup } from '../bundler/startup.js'
import { t } from '../messages/index.js'

export interface PrerenderOnDevRecompileOpts {
  log?: (msg: string) => void
  warn?: (msg: string) => void
  /** Injectable pour les tests — évite de monter un vrai SSR/happy-dom. */
  prerenderFn?: typeof prerenderPages
  /** Bundler du `mjs dev` en cours : ses chemins hachés sont ceux que les fragments
   *  préchargent (cf. bundler/startup.ts). Absent : aucun en-tête de démarrage posé. */
  bundler?: Bundler
  /** Injectable pour les tests, comme `prerenderFn`. */
  startupFn?: typeof emitStartup
}

/**
 * Relance le prérendu après une recompilation RÉUSSIE de `mjs dev` — même
 * mécanisme qu'en `mjs build`. Pensé pour être appelé en fire-and-forget (SANS
 * await) : ne bloque jamais le reload HMR du cas commun (la majorité des
 * recompiles dev ne touchent aucune route prérendue) — n'échoue JAMAIS
 * (try/catch interne, symétrique au comportement `build` : une panne du
 * prérendu, ex. happy-dom absent, n'interrompt jamais le dev loop, juste un
 * avertissement). Sans bloc `render`, no-op silencieux (comportement build).
 */
export async function prerenderOnDevRecompile(
  config: MjsConfig | null | undefined,
  configDir: string,
  opts: PrerenderOnDevRecompileOpts = {},
): Promise<PrerenderReport | undefined> {
  if (!config?.render) return undefined
  const log = opts.log ?? (() => {})
  const warn = opts.warn ?? (() => {})
  const fn = opts.prerenderFn ?? prerenderPages
  try {
    const report = await fn(config, configDir, log)
    // En dev, `render.startup: 'bundle'` se comporte comme `'preload'` (liens seuls, cf.
    // bundler/startup.ts) : `prod: false`. Un recompile qui ne change rien ne touche AUCUN fichier :
    // le prérendu saute l'écriture d'un fragment dont le corps est déjà sur disque (cf.
    // server/prerender.ts) et `emitStartup` celle d'un en-tête identique — deux gardes distinctes,
    // il faut les deux pour que le watcher ne se redéclenche pas sur sa propre écriture.
    if (opts.bundler) await (opts.startupFn ?? emitStartup)(opts.bundler, config.render, report, { prod: false, log })
    return report
  } catch (e: any) {
    warn(t('cli.dev-prerender.echec', { erreur: e?.message || e }))
    return undefined
  }
}

/** Programme une passe de `prerenderOnDevRecompile`, SÉRIALISÉE avec toute passe déjà en vol —
 *  jamais deux prérendus simultanés vers le MÊME dossier de sortie (deux recompiles rapprochés,
 *  le 2e plus rapide que le rendu HTML du 1er, sinon se chevauchaient). `schedule()` rend une
 *  promesse résolue quand LA PASSE couvrant cet appel est terminée (jamais rejetée :
 *  `prerenderOnDevRecompile` absorbe déjà ses propres échecs, cf. son commentaire) — l'appelant
 *  (cli.ts) attend cette promesse AVANT de notifier le rechargement du navigateur : un reload
 *  déclenché avant la fin de la passe pouvait faire recharger le navigateur sur le HTML FIGÉ
 *  d'AVANT ce changement (fichier pas encore réécrit sur disque). */
export interface DevPrerenderScheduler {
  schedule(): Promise<void>
}

export function createDevPrerenderScheduler(
  config: MjsConfig | null | undefined,
  configDir: string,
  opts: PrerenderOnDevRecompileOpts = {},
): DevPrerenderScheduler {
  // Chaîne de promesses : chaque `schedule()` s'attache à la fin de la précédente — AUCUNE
  // coalescence (une rafale de N changements produit N passes en série, jamais en parallèle) :
  // choix le plus simple et le plus sûr, le debounce du bundler (chokidar) amortit déjà la
  // fréquence des recompiles réels avant qu'ils n'atteignent ce planificateur.
  let chain: Promise<void> = Promise.resolve()
  return {
    schedule(): Promise<void> {
      const run = chain
        // Une passe précédente qui rejetterait (jamais censé arriver, cf. commentaire ci-dessus)
        // ne doit pas bloquer la CHAÎNE pour de bon — chaque `schedule()` reste indépendant.
        .catch(() => {})
        .then(() => prerenderOnDevRecompile(config, configDir, opts))
        .then(() => undefined)
      chain = run
      return run
    },
  }
}
