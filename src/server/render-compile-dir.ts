// Dossier de travail du rendu serveur — OÙ son Bundler interne a le droit d'écrire.
//
// Les deux moteurs (happy-dom, navigateur) RECOMPILENT le projet pour monter ses composants, et
// tous deux forcent `js: 'split'` : ils relisent le cœur et chaque composant FICHIER PAR FICHIER.
// Compiler dans le VRAI dossier de sortie est la bonne réponse quand le projet émet lui aussi des
// unités séparées (mêmes options, mêmes empreintes de contenu, mêmes octets — le prérendu réécrit
// à l'identique ce que le build vient d'écrire).
//
// Un projet en `js: 'bundle'`, lui, n'émet qu'UN fichier : le manifeste EST le bundle. La
// recompilation en `split` y remplaçait ce fichier unique par un manifeste éclaté et semait ses
// unités à côté — le build défait par son propre prérendu. Ce mode compile donc dans un dossier
// TEMPORAIRE, retiré à la fermeture.
//
// Deux choses ne suivent JAMAIS le dossier temporaire :
//   · le préfixe public (`urlPrefix`) — les URLs d'assets du HTML rendu (images `µasset`, feuilles
//     `csp`, liens) doivent rester celles que sert le back, pas celles d'un dossier éphémère ;
//   · les assets ÉCRITS POUR ÊTRE SERVIS (feuilles hachées du mode `csp`) — ils vont dans le vrai
//     dossier de sortie, sinon le `<link>` du fragment pointerait un fichier déjà supprimé.
//
// Au prérendu de `mjs build`, la construction vient d'écrire ce que le moteur compilerait dans le vrai
// dossier de sortie : le moteur la reprend telle quelle (cf. reusableCompile) au lieu de compiler le
// projet une seconde fois par-dessus.

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Bundler, deriveUrlPrefix, type CompileStats } from '../bundler/index.js'

/** Nom du cache de noms courts, tel que le Bundler le situe (`<outputDir>/.mangle-cache.json`). */
const MANGLE_CACHE = '.mangle-cache.json'

export interface RenderCompileDir {
  /** Dossier où le Bundler interne du rendu écrit (temporaire, ou le vrai dossier de sortie). */
  outputDir: string
  /** Manifeste du Bundler interne (dans le dossier ci-dessus). */
  manifestPath: string
  /** Préfixe public à IMPOSER au Bundler interne, ou `undefined` pour le laisser dériver comme
   *  avant (dossier de sortie non détourné). */
  urlPrefix?: string
  /** Où écrire un asset destiné à être SERVI (feuille hachée du mode `csp`) : toujours le vrai
   *  dossier de sortie. */
  assetsDir: string
  /** Retire le dossier temporaire (sans effet quand il n'y en a pas). À appeler aussi sur erreur. */
  cleanup(): void
}

export interface RenderCompileDirOptions {
  /** Mode d'émission du PROJET (`mjs.config.json` → `js`) ; seul `'bundle'` détourne l'écriture. */
  js?: 'split' | 'bundle'
  /** Vrai dossier de sortie du build (absolu). */
  outputDir: string
  /** Vrai manifeste du build (absolu). */
  manifestPath: string
  /** `urlPrefix` explicite du projet, s'il en pose un. */
  urlPrefix?: string
}

/**
 * Décide où le Bundler interne du rendu serveur écrit, et rend de quoi refermer proprement.
 *
 * Hors `js: 'bundle'` : rien ne change — mêmes chemins, même dérivation de `urlPrefix` par le
 * Bundler, sortie byte-identique à celle du build principal.
 *
 * En `js: 'bundle'` : dossier temporaire à nous (`mkdtemp` sous `$TMPDIR`), amorcé avec une COPIE
 * du cache de noms courts du projet — les propriétés internes y portent alors les mêmes noms que
 * dans le fichier unique servi, et le cache du projet, lui, ne voit jamais passer les entrées de
 * cette compilation de service.
 */
export function openRenderCompileDir(opts: RenderCompileDirOptions): RenderCompileDir {
  const assetsDir = opts.outputDir
  if (opts.js !== 'bundle') {
    return { outputDir: opts.outputDir, manifestPath: opts.manifestPath, urlPrefix: opts.urlPrefix, assetsDir, cleanup() { /* rien à retirer */ } }
  }
  const workspace = mkdtempSync(join(tmpdir(), 'mjs-render-'))
  // amorce du cache de noms courts : best-effort (cache absent au tout premier build, illisible,
  // disque plein) — sans lui la compilation de service repart de zéro, jamais un échec de rendu
  try {
    const source = join(opts.outputDir, MANGLE_CACHE)
    if (existsSync(source)) copyFileSync(source, join(workspace, MANGLE_CACHE))
  } catch { /* best-effort */ }
  return {
    outputDir: workspace,
    manifestPath: join(workspace, 'bundle.js'),
    urlPrefix: opts.urlPrefix ?? deriveUrlPrefix(opts.outputDir),
    assetsDir,
    cleanup() { try { rmSync(workspace, { recursive: true, force: true }) } catch { /* best-effort */ } },
  }
}

/** Compilation qu'une construction vient d'écrire dans le vrai dossier de sortie, avec le résultat de son `compile()` (cf. prerenderPages) */
export interface RenderCompiled {
  bundler: Bundler
  stats: CompileStats
}

/** Ce que le moteur de rendu compilerait lui-même : sources, dossier de sortie et manifeste résolus, préfixe public donné (ou rien), environnement */
export interface RenderCompileTarget {
  sourceDir: string
  outputDir: string
  manifestPath: string
  urlPrefix?: string
  env: 'dev' | 'prod'
}

/**
 * La compilation reçue sert-elle au moteur de rendu à la place de la sienne ? Oui quand il aurait écrit les mêmes octets au même
 * endroit : mêmes sources, même dossier de sortie, même manifeste, même préfixe public (un `--output` relatif sans `urlPrefix` dérive
 * le sien autrement que le moteur, qui part du chemin absolu), même environnement ; une construction en unités séparées
 * (`js: 'split'`, que le moteur relit fichier par fichier), qui garde ce que le rendu serveur relit (`canRenderOnServer`), sans
 * erreur. Le reste des options vient de la même configuration. Sinon `null` : le moteur compile à part, comme sans compilation reçue
 */
export function reusableCompile(compiled: RenderCompiled | undefined, target: RenderCompileTarget): RenderCompiled | null {
  if (!compiled) return null
  const { bundler, stats } = compiled
  const same               = (a: string, b: string): boolean => resolve(a) === resolve(b)
  if (stats.errors.length > 0 || bundler.jsMode !== 'split' || !bundler.canRenderOnServer || bundler.envMode !== target.env) return null
  if (!same(bundler.sourceDir, target.sourceDir) || !same(bundler.outputDir, target.outputDir) || !same(bundler.manifestPath, target.manifestPath)) return null
  return bundler.urlPrefix === Bundler.urlPrefixFor({ urlPrefix: target.urlPrefix, outputDir: target.outputDir }) ? compiled : null
}
