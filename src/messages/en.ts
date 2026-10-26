// catalogue EN — miroir clé à clé de fr.ts (parité imposée par le satisfies ci-dessous).

import type { MsgEntry, MsgVars } from './index.js'
import type { fr } from './fr.js'

export const en = {

  // ═══ CLI (src/cli.ts, src/cli/) ══════════════════════════════════════════════════════════
  'cli.flag-valeur-manquante': ({ flag }: MsgVars) => `⚠️  ${flag} ignored: missing value.`,
  // — cli.ts
  // printed BEFORE 'cli.build-rapport' when stats.errors is non-empty:
  // without it, the ✅ line still showed up on a partially failed build.
  'cli.build-rapport-echecs': ({ nb }: MsgVars) => `✗ ${nb} failed`,
  'cli.build-rapport': ({ nb, ms }: MsgVars) => `\n✅ ${nb} file${Number(nb) === 1 ? '' : 's'} written in ${ms}ms`,
  // outputDir orphan purge after an error-free build (cli.ts case 'build' → Bundler.pruneOrphans)
  'cli.build-purge': ({ nb, dossier }: MsgVars) => `🧹 ${nb} orphan ${Number(nb) > 1 ? 'files' : 'file'} removed from ${dossier} (no longer produced by any build)`,
  'cli.build-purge-fichier': ({ fichier }: MsgVars) => `   – ${fichier}`,
  'cli.build-purge-echec': ({ fichier }: MsgVars) => `⚠️  ${fichier}: orphan not removed (deletion refused by the file system)`,
  // `skipped` (Bundler.pruneOrphans) was never shown on the
  // CLI (only { removed, failed } were destructured): an unreadable/empty registry or a cache hit
  // silently skipped the purge, indistinguishable from a healthy "nothing to purge" run.
  'cli.build-purge-registre-illisible': ({ dossier }: MsgVars) => `⚠️  purge skipped: the '.mjs-outputs.json' registry in ${dossier} is unreadable or malformed — rerun a build to regenerate it`,
  'cli.build-purge-registre-vide': ({ dossier }: MsgVars) => `⚠️  purge skipped: the '.mjs-outputs.json' registry in ${dossier} lists no usable extension — rerun a build to regenerate it`,
  'cli.build-purge-cache': ({ dossier }: MsgVars) => `⚠️  purge skipped: this build reused at least one component from cache — its side assets were not all re-emitted, pruning ${dossier} now could remove a still-used file`,
  'cli.plus-n-autres': ({ nb }: MsgVars) => `+ ${nb} other${Number(nb) === 1 ? '' : 's'}`,
  'cli.usage': `
mjs — ModularJS V3 compiler

Commands:
  mjs init        Scaffold mjs.config.json + project structure
  mjs build       Compile once and exit
  mjs dev         Watch + HMR (HTTP+WS on --port, default 3939)
  mjs check       Check the config and list the detected components (compiles for real, like 'build')
  mjs serve       Serve SSR/prerendered output per request (render.routes) — render block required in mjs.config.json (port 3000 by default)
  mjs ws          Start the realtime server (MJS-WS) — entry file ws.js/server/ws.js, see docs/23-mjs-ws.md
  mjs serveur     Start the game server (MJS-Server, mjsServer + app.game) — entry file serveur.js/server/serveur.js, see docs/24-mjs-server.md

Options:
  --root <dir>    Project root path (default: cwd)
  --manifest <p>  Path to bundle_modular.js (entrypoint)
  --output <p>    Output directory for compiled files
  --port <n>      Dev server port (default 3939), ws server port (default 4000), or game server port (default 4001)
  --entry <p>     Entry file for the ws/serveur server (mjs ws/mjs serveur) — defaults specific to each command
  --once          Compile and exit, alias for build
  --dev           Force a DEVELOPMENT build (inspection panel, not minified unless "minify": true)
  --prod          Force a PRODUCTION build (minified unless "minify": false, hashed i18n, no dev tooling)
                  With neither: the 'env' key of mjs.config.json, otherwise NODE_ENV.
  -v, --version   Print the mjs version and exit
  -h, --help      Print this help and exit
`,
  // same output as fr on purpose: a script parsing `mjs --version` must not depend on the language
  'cli.version': ({ version }: MsgVars) => `mjs ${version}`,
  'cli.version-illisible': `❌ Version not found: the mjs package.json is unreadable or has no "version" field.`,
  'cli.port-invalide': ({ valeur }: MsgVars) => `⚠️  --port ignored: "${valeur}" is not a valid number (default kept).`,
  'cli.flag-inconnu': ({ arg }: MsgVars) => `⚠️  Unknown flag ignored: "${arg}" (check the spelling — see 'mjs --help').`,
  'cli.config-trouve': ({ dossier }: MsgVars) => `📋 mjs.config.json: ${dossier}/mjs.config.json`,
  'cli.env-dev': ({ origine, minifie }: MsgVars) => `🛠️  DEVELOPMENT build (${origine}) — ${minifie ? 'minified' : 'not minified'}, inspection panel included (Ctrl+Shift+Space).`,
  'cli.source-origine-config': `"sourceDir" from mjs.config.json`,
  'cli.source-origine-defaut': `default path, no "sourceDir" in config`,
  'cli.build-racine-vide': ({ commande, racine, source, origine }: MsgVars) => `
❌ [ModularJS] Source directory NOT FOUND — "mjs ${commande}" CANCELLED, no file written.
   Looked for: ${source}
   (${origine})
   Started from: ${racine}

   You are probably in the wrong directory, "--root <project>" is missing, or the config
   path no longer matches what is on disk.
   Without this refusal, the build would have written an EMPTY manifest (µ.paths = {}) over
   a live site's: not a single component left, blank page, and exit code 0.`,
  'cli.build-aucun-composant': ({ commande, source }: MsgVars) => `
❌ [ModularJS] No component to build — "mjs ${commande}" CANCELLED, no file written.
   Source directory: ${source}
   It exists, but holds not a single ".mjs" file.

   Check "sourceDir" in mjs.config.json, or the root you are targeting.
   This is exactly the case that replaces a manifest with an empty one.`,
  'cli.env-prod': ({ origine, minifie }: MsgVars) => `🚀 PRODUCTION build (${origine}) — ${minifie ? 'minified' : 'not minified'}, hashed i18n fragments, no development tooling.`,
  'cli.env-origine-flag': 'forced by --dev/--prod',
  'cli.env-origine-defaut': 'default for `mjs build` — use `--prod` for a production build',
  'cli.avertissements-titre': ({ nb }: MsgVars) => `\n⚠️  ${nb} warning(s):`,
  'cli.lint-aide-desactivation': 'To turn off a type: "lint": { "<type>": false } in mjs.config.json — the type is in brackets at the end of the line.',
  'cli.prerendu-debut': `\n🖨️  Prerendering pages (render.routes) …`,
  'cli.prerendu-resultat': ({ nb, dossier }: MsgVars) => `   → ${nb} page(s) written to ${dossier}`,
  'cli.prerendu-page-ignoree': ({ url, raison }: MsgVars) => `   – ${url} skipped: ${raison}`,
  'cli.prerendu-aucune-page': `   (no page declared in prerender mode)`,
  'cli.prerendu-echec': ({ erreur }: MsgVars) => `⚠️  Prerendering skipped: ${erreur}`,
  'cli.prerendu-echec-build': ({ erreur }: MsgVars) => `✗ Prerendering or page startup failed — build failed: ${erreur}`,
  'cli.ssr-requiert-happy-dom': '   (SSR requires happy-dom: `npm i -D happy-dom`)',
  'cli.css-seul-recharge': '🎨 CSS only — hot reloaded (no page reload)',
  'cli.serve-bloc-render-requis': '⚠️  `mjs serve` requires a `render` block in mjs.config.json.',
  'cli.serve-demarre': ({ hote, port }: MsgVars) => `\n🖥️  mjs serve — request-time rendering on http://${hote}:${port}`,
  'cli.serve-mode-info': '   Per-URL mode (render.routes) · override via X-MJS-Render header · Ctrl+C to stop.',
  'cli.serve-arret-echec': ({ erreur }: MsgVars) => `❌ mjs serve — shutdown could not close everything: ${erreur}`,
  'cli.check-compile-reel': ({ dossier }: MsgVars) => `⚠️  'mjs check' actually compiles (like 'build') — the files in ${dossier} will be written/overwritten.`,
  'cli.composants-detectes': ({ nb }: MsgVars) => `📦 ${nb} component${Number(nb) === 1 ? '' : 's'} detected`,
  'cli.et-n-autres': ({ nb }: MsgVars) => `   ... and ${nb} other${Number(nb) === 1 ? '' : 's'}`,
  'cli.erreurs-compilation': ({ nb }: MsgVars) => `❌ ${nb} compilation error${Number(nb) === 1 ? '' : 's'}:`,
  'cli.tout-compile-ok': ({ nb }: MsgVars) => `✅ Everything compiles with no errors (${nb} file${Number(nb) === 1 ? '' : 's'} written).`,
  'cli.commande-inconnue': ({ commande }: MsgVars) => `Unknown command: ${commande}`,
  'cli.commande-suggestion': ({ commande }: MsgVars) => `   Did you mean: mjs ${commande}?`,
  'cli.commande-voir-aide': "   Commands: init, build, dev, check, serve, ws, serveur — see 'mjs --help'.",
  'cli.racine-introuvable': ({ racine }: MsgVars) => `❌ [mjs] project root not found (not a directory): ${racine}`,
  // a DECLARED render.routes page whose RENDER fails (as opposed to a
  // parameterized route/non-buildable mode, expected skips) fails the build.
  'cli.prerendu-echec-fatal': ({ nb }: MsgVars) => `✗ ${nb} prerendered page(s) failed — build failed.`,
  // i18n.default with no real dictionary under sourceDir/i18n/.
  'cli.i18n-default-sans-dictionnaire': ({ defaut, langues }: MsgVars) => `⚠️  i18n.default: '${defaut}' matches NO dictionary found under sourceDir/i18n/ (languages found: ${langues}) — visitors landing on the default language will get NO translation.`,
  // --output/--manifest: guard BEFORE compiling + catalogue fallback.
  'cli.chemin-non-inscriptible': ({ cle, chemin, ancetre, erreur }: MsgVars) => `❌ ${cle} (${chemin}): directory not writable (${ancetre}) — ${erreur}`,
  // --output points to an existing FILE.
  'cli.output-doit-etre-dossier': ({ cle, chemin }: MsgVars) => `❌ ${cle} (${chemin}): must be a directory — a FILE already exists at this path.`,
  // --manifest points to an existing DIRECTORY (symmetric guard).
  'cli.manifest-doit-etre-fichier': ({ cle, chemin }: MsgVars) => `❌ ${cle} (${chemin}): must be a file — a DIRECTORY already exists at this path.`,
  // --output and --manifest resolve to the same path.
  'cli.output-manifest-identiques': ({ chemin }: MsgVars) => `❌ --output and --manifest point to the SAME path (${chemin}) — one would overwrite the other mid-compile. Pick two distinct paths.`,
  'cli.manifest-refuse-extension': ({ chemin, extension }: MsgVars) => `❌ The produced manifest (${chemin}) would have the extension of a source file (${extension}): every build would overwrite this file. Give --manifest (or manifestPath) a .js name, next to the produced files; the manifest you write yourself is declared in manifestExternal.`,
  'cli.manifest-refuse-externe': ({ chemin }: MsgVars) => `❌ The produced manifest (${chemin}) would be the manifestExternal file: the build would read it as the external manifest, then overwrite it. Give --manifest (or manifestPath) another path, next to the produced files.`,
  'cli.output-contient-racine': ({ chemin, racine }: MsgVars) => `❌ The output folder (${chemin}) contains the project root (${racine}): mjs dev and mjs serve would serve that whole folder, the private files of a neighbouring application included (secrets, server code). Give outputDir (or --output) a folder inside the project, for example public/modularjs.`,
  'cli.manifest-refuse-sources': ({ chemin, sourceDir, outputDir }: MsgVars) => `❌ The produced manifest (${chemin}) would be inside the source folder (${sourceDir}) while the produced files go elsewhere (${outputDir}): every build would write it in the middle of your code, over any file of the same name (a symbolic link, or another letter case on macOS and Windows, lead to the same folder). Give --manifest (or manifestPath) a path next to the produced files.`,
  'cli.erreur-ecriture': ({ code, chemin, erreur }: MsgVars) => `❌ [mjs] failed to write (${code}): ${chemin}\n   ${erreur}`,

  // — testing/index.ts (application test harness)
  'testing.pas-de-projet': ({ racine }: MsgVars) => `[mjs/testing] no mjs.config.json found from ${racine}, and no sourceDir given — pass { root: '…' } or { sourceDir: '…' } to createHarness().`,
  'testing.compilation-en-echec': ({ detail }: MsgVars) => `[mjs/testing] the project does not compile, the harness cannot mount anything:\n${detail}`,
  'testing.happy-dom-absent': `[mjs/testing] the simulated DOM is missing — install it: npm i -D happy-dom (optional dependency, the framework imposes it on no one).`,
  'testing.happy-dom-trop-ancien': ({ found, required }: MsgVars) => `[mjs/testing] application tests require happy-dom ${required} or later (installed version: ${found}). Below that, happy-dom loses the callback of a MutationObserver to garbage collection: a component stops seeing its attributes change and a test passes or fails at random. Upgrade it: npm i -D happy-dom@^${required}`,
  'testing.runtime-introuvable': ({ dossier }: MsgVars) => `[mjs/testing] no mjs_core-<hash>.js in ${dossier} — the build wrote nothing where the harness looks (check outputDir).`,
  'testing.composant-en-echec': ({ nom, detail }: MsgVars) => `[mjs/testing] component '${nom}' could not be loaded: ${detail}`,
  'testing.composant-inconnu': ({ nom, connus }: MsgVars) => `[mjs/testing] no component '${nom}' in the compiled project. Known: ${connus}`,
  'testing.selecteur-sans-noeud': ({ selecteur, tag }: MsgVars) => `[mjs/testing] no node matches '${selecteur}' in <${tag}>.`,
  // — cli/init.ts
  'cli.init.dossier-existe': ({ d }: MsgVars) => `  ↪️  ${d} (already exists)`,
  'cli.init.dossier-cree': ({ d }: MsgVars) => `  ✅ ${d}/ created`,
  'cli.init.config-existe': '  ↪️  mjs.config.json (already exists)',
  'cli.init.config-cree': '  ✅ mjs.config.json created',
  'cli.init.hello-existe': '  ↪️  app/modularjs/hello.mjs (already exists)',
  'cli.init.hello-cree': '  ✅ app/modularjs/hello.mjs created',
  'cli.init.fichier-existe': ({ f }: MsgVars) => `  ↪️  ${f} (already exists)`,
  'cli.init.fichier-cree': ({ f }: MsgVars) => `  ✅ ${f} created`,
  'cli.init.resume': ({ cree, ignores }: MsgVars) => `📦 ${cree} file${Number(cree) === 1 ? '' : 's'}/director${Number(cree) === 1 ? 'y' : 'ies'} created, ${ignores} skipped`,
  'cli.init.pour-demarrer': 'To get started:',
  'cli.init.hmr-html': 'Include the HMR client in your HTML:',

  // — cli/ws.ts (+ clés partagées avec cli/server.ts, cf. risques §8)
  'cli.entry-cli-introuvable': ({ cliEntry, chemin }: MsgVars) => `--entry '${cliEntry}' → '${chemin}' not found.`,
  'cli.entry-config-introuvable': ({ champ, valeur, chemin }: MsgVars) => `${champ} '${valeur}' (mjs.config.json) → '${chemin}' not found.`,
  'cli.entry-aucun-trouve': ({ liste, racine }: MsgVars) => `no entry file found (looked for: ${liste}, relative to the project root '${racine}').`,
  'cli.ws.entry-introuvable': ({ raison, squelette }: MsgVars) => `[mjs ws] ${raison}\n\nCreate an entry file to get started, for example 'ws.server.mjs' at the project root (same dialect as your components' <script>):\n\n${squelette}\nThen restart 'mjs ws' (or specify --entry <path>).`,
  'cli.aucun-export-defaut': 'no default export',
  'cli.un-tableau': 'an array',
  'cli.entry-doit-export-default': ({ produit, entryPath, recu }: MsgVars) => `[${produit}] the '${entryPath}' entry must do 'export default { ... }' (an OBJECT) — received: ${recu}`,
  'cli.entry-cle-ignoree': ({ cle }: MsgVars) => `entry.${cle} ignored: handled by the CLI/config`,
  'cli.entry-setup-doit-etre-fonction': ({ produit, entryPath, recu }: MsgVars) => `[${produit}] the '${entryPath}' entry: 'setup' must be a function (app) => … , received: ${recu}`,
  'cli.entry-config-doublon': ({ champ, chemin }: MsgVars) => `${champ} defined both in the entry and in mjs.config.json (${chemin}) — the entry takes priority`,
  // — cli/server-entry.ts (@import grammar for a server entry)
  'cli.entry-directive-interdite': ({ entryPath, directive }: MsgVars) => `'${entryPath}': the ${directive} directive makes no sense in a server entry — only @import is allowed.`,
  'cli.entry-import-cycle': ({ entryPath, chaine }: MsgVars) => `'${entryPath}': import cycle detected between server entry files (${chaine}).`,
  'cli.entry-cache-non-sur': ({ dossier }: MsgVars) => `❌ [mjs] cache directory refused: ${dossier}\n   It must be a directory (not a link) that you own, not writable by other users. Remove it or install the project dependencies (node_modules) to keep the cache inside the project.`,
  'cli.entry-import-introuvable': ({ entryPath, cible }: MsgVars) => `'${entryPath}': @import target '${cible}' not found (neither next to the entry, nor under --root).`,
  'cli.entry-import-natif-interdit': ({ section, source }: MsgVars) => `'${section}': native ES import is not allowed in a server entry ("import … from '${source}'") — write @import name '${source}' at the top of the file, as in a component.`,
  'cli.entry-import-dynamique-interdit': ({ section }: MsgVars) => `'${section}': import('…') of a literal path is not allowed in a server entry — write @import name 'path' at the top of the file; import(variable) stays allowed.`,
  'cli.entry-reexport-interdit': ({ section, source }: MsgVars) => `'${section}': ES re-export is not allowed in a server entry ("export … from '${source}'") — import the name with @import, then export it.`,
  'cli.transport-ws': "ws (the 'ws' library)",
  'cli.transport-personnalise': 'custom (instance provided by the entry)',
  'cli.banniere-port': ({ port, hote }: MsgVars) => `listening on port ${port}${hote}`,
  'cli.desactive': 'disabled',
  'cli.banniere-heartbeat': ({ etat }: MsgVars) => `heartbeat ${etat}`,
  'cli.illimite': 'unlimited',
  // effective host always shown in the banner, even the default (mjs ws)
  'cli.toutes-interfaces': 'all interfaces',
  'cli.banniere-limites': ({ rate, burst, kickAfter, maxPayload, maxBuffered, maxConnections, maxConnectionsPerIp }: MsgVars) => `limits: rate=${rate}/s burst=${burst} kickAfter=${kickAfter} maxPayload=${maxPayload}B maxBuffered=${maxBuffered}B maxConnections=${maxConnections} maxConnectionsPerIp=${maxConnectionsPerIp}`,
  'cli.banniere-salons-proxy': ({ url }: MsgVars) => `rooms (join): proxy ${url}`,
  'cli.banniere-jeton': ({ sweep, marge }: MsgVars) => `token: sweep ${sweep}s (margin ${marge}s)`,
  'cli.banniere-pont': ({ host, port }: MsgVars) => `universal bridge: http://${host}:${port}`,
  'cli.banniere-webhooks-actifs': ({ url, evenements }: MsgVars) => `webhooks → ${url} (events: ${evenements})`,
  'cli.banniere-webhooks-desactives': 'webhooks disabled (opts.bridge.webhooks missing)',
  'cli.banniere-rate-limit-actif': ({ capacite, fenetre, echecsCapacite, echecsFenetre }: MsgVars) => `rate limit: ${capacite} req/${fenetre}s per IP (signature failures: ${echecsCapacite}/${echecsFenetre}s)`,
  'cli.banniere-rate-limit-desactive': 'rate limit disabled (opts.bridge.rateLimit === false)',
  'cli.banniere-nonce-exige': 'anti-replay nonce: required (x-mjs-ws-nonce header on every signed request)',
  'cli.banniere-nonce-coupe': 'anti-replay nonce: off (opts.bridge.nonce === false)',
  'cli.banniere-etat': ({ host, port }: MsgVars) => `status: http://${host}:${port}/state`,
  'cli.banniere-reprise-session': ({ grace, maxBuffered, maxBytes }: MsgVars) => `session resume: ${grace} s (buffer ${maxBuffered} frame${Number(maxBuffered) === 1 ? '' : 's'} / ${maxBytes}B)`,
  'cli.banniere-multi-processus-redis': ({ redis, prefixe }: MsgVars) => `multi-process: ${redis} (prefix ${prefixe})`,
  'cli.banniere-multi-processus-custom': ({ prefixe }: MsgVars) => `multi-process: custom adapter provided (prefix ${prefixe})`,
  'cli.ctrl-c-arreter': 'Ctrl-C to stop',
  'cli.arret-forcer-indice': '[mjs] shutting down — press Ctrl+C again to stop immediately',
  'cli.ws.erreur-compilation-civet': ({ entryPath, erreur }: MsgVars) => `[mjs ws] Civet compilation error in '${entryPath}': ${erreur}`,
  'cli.ws.entry-markup-composant': ({ entryPath, indice }: MsgVars) => `[mjs ws] '${entryPath}' contains component markup (${indice}) — a '*.server.mjs' server file is not a .mjs component: no <template>/<style>/HTML, only Civet/JS ('export default { setup(app) { … } }').`,
  'cli.ws.erreur-compilation': ({ entryPath, erreur }: MsgVars) => `[mjs ws] compilation error in '${entryPath}': ${erreur}`,
  // --port out of range — same rule as ws.port (bundler/config.ts)
  'cli.ws.port-hors-plage': ({ valeur }: MsgVars) => `[mjs ws] port ${valeur} out of range — expected an integer between 1 and 65535 (same rule as ws.port in mjs.config.json)`,
  // --port out of range for `mjs serveur` — SAME rule as ws.port-hors-plage above
  'cli.serveur.port-hors-plage': ({ valeur }: MsgVars) => `[mjs serveur] port ${valeur} out of range — expected an integer between 1 and 65535 (same rule as serveur.port in mjs.config.json)`,
  'cli.reload-import-echec': ({ erreur }: MsgVars) => `reload skipped — entry import failed: ${erreur} (the old server keeps running)`,
  'cli.reload-echec-generique': ({ erreur }: MsgVars) => `reload skipped — ${erreur} (the old server keeps running)`,
  'cli.redemarre': ({ chemin }: MsgVars) => `♻️  restarted (${chemin})`,
  'cli.reload-echec-fatal': ({ erreur }: MsgVars) => `reload failed after stopping the old server — no server active anymore: ${erreur}`,
  'cli.reload-setup-echec': ({ erreur }: MsgVars) => `reload refused — setup() of the new version failed, the previous version keeps running: ${erreur}`,

  // — cli/server.ts (clés propres ; réutilise aussi les clés partagées ci-dessus)
  'cli.serveur.entry-introuvable': ({ raison, squelette }: MsgVars) => `[mjs serveur] ${raison}\n\nCreate an entry file to get started, for example 'serveur.server.mjs' at the project root (same dialect as your components' <script>; the mjsServer() app is built by the CLI and passed to setup(app) — no import to write):\n\n${squelette}\nThen restart 'mjs serveur' (or specify --entry <path>).`,
  'cli.serveur.anti-triche': ({ n, fenetre }: MsgVars) => `anti-cheat: quota ${n} move${Number(n) === 1 ? '' : 's'}/identity per ${fenetre}s (across all games)`,

  // — cli/dev-lock.ts
  'cli.dev-lock.deja-actif': ({ pid }: MsgVars) => `❌ Another 'mjs dev' is already running (PID ${pid}).`,
  'cli.dev-lock.lockfile-chemin': ({ chemin }: MsgVars) => `   Lockfile: ${chemin}`,
  'cli.dev-lock.pour-forcer': ({ pid }: MsgVars) => `   To force it: 'kill ${pid}' (or delete the lockfile if it's stale).`,
  'cli.dev-lock.orphelin': ({ pid }: MsgVars) => `⚠️  Orphaned lockfile (PID ${pid} dead or recycled) — recovering.`,
  'cli.dev-lock.echec-acquisition': ({ chemin }: MsgVars) => `❌ Could not acquire the dev lock (${chemin}) — another process just claimed it.`,

  // — cli/dev-prerender.ts
  'cli.dev-prerender.echec': ({ erreur }: MsgVars) => `⚠️  Prerendering (dev) skipped: ${erreur}`,

  // ═══ SIGILS (src/sigils.ts) ══════════════════════════════════════════════════════════════
  // — sigils.ts
  'sigils.vault-retire': ({ nom }: MsgVars) => `[ModularJS] "&$${nom}": the "&$" symbol (vault) has been removed — use "$$${nom}" (reactive global store, zero import).`,
  'sigils.singleton-importe': ({ nom }: MsgVars) => `[ModularJS] "$$${nom}": "${nom}" is an imported singleton (@import µ$$${nom}) — use it with "µ$$${nom}", not "$$${nom}" (which refers to the GLOBAL store, a different space).`,

  // ═══ BUNDLER (src/bundler/) ════════════════════════════════════════════════════════════════════
  // — config.ts
  'bundler.config.runtime-paquet-non-implemente': ({ paquet }: MsgVars) => `[mjs.config.json] runtime: package '${paquet}' not implemented yet`,
  'bundler.config.vt-valeur-vide': 'empty value',
  'bundler.config.vt-valeur-malformee': ({ valeur }: MsgVars) => `malformed value '${valeur}'`,
  'bundler.config.vt-direction-dans-nom': ({ nom, avant }: MsgVars) => `direction can no longer be written in the name ('${nom}') — use the 'direction'/'dir' option instead (e.g. ${avant}={ dir: left }).`,
  'bundler.config.vt-nom-invalide': ({ nom }: MsgVars) => `invalid name '${nom}'`,
  'bundler.config.vt-option-malformee': ({ option }: MsgVars) => `malformed option '${option}' — expected 'key: value'`,
  'bundler.config.vt-option-cle-inconnue': ({ cle, hint, valides }: MsgVars) => `unknown key '${cle}'${hint} (valid keys: ${valides})`,
  'bundler.config.vt-cle-double': ({ cle, court }: MsgVars) => `duplicate key '${cle}' — '${cle}' and '${court}' refer to the SAME option, set it only once`,
  'bundler.config.vt-direction-non-directionnelle': ({ base, bases }: MsgVars) => `'direction' key invalid on base '${base}' (non-directional) — directional bases: ${bases}`,
  'bundler.config.vt-direction-invalide': ({ valeur, valides }: MsgVars) => `invalid direction '${valeur}' — valid values: ${valides}`,
  'bundler.config.vt-duration-invalide': `duration: a bare number in milliseconds (like setTimeout) — e.g. dur: 600`,
  'bundler.config.vt-priority-invalide': ({ valeur }: MsgVars) => `invalid priority '${valeur}' — integer ≥ 0 expected`,
  'bundler.config.doit-etre-objet-racine': ({ chemin }: MsgVars) => `[mjs.config.json] must be an object (${chemin})`,
  'bundler.config.env-vient-de-la-commande': ({ chemin }: MsgVars) => `[mjs.config.json] there is no 'env' key: the build environment comes from the COMMAND.\n  \`mjs build\` builds for development, \`mjs build --prod\` for production.\n  Remove the key from ${chemin}.`,
  'bundler.config.cle-inconnue-racine': ({ cle, chemin, valides }: MsgVars) => `[mjs.config.json] unknown key '${cle}' in ${chemin}\n  Valid keys: ${valides}`,
  'bundler.config.valeur-invalide-simple': ({ cle, valeur, valides }: MsgVars) => `[mjs.config.json] invalid ${cle}: '${valeur}'\n  Valid values: ${valides}`,
  'bundler.config.sigil-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] invalid \`sigil\` value: '${valeur}'\n  Valid values: ${valides}`,
  'bundler.config.doit-etre-chaine': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} must be a string, got: ${valeur} (${type})`,
  'bundler.config.manifestpath-extension-source': ({ valeur, extension }: MsgVars) => `[mjs.config.json] manifestPath ('${valeur}') has the extension of a source file (${extension}): the produced manifest is JavaScript, and every build would overwrite this file. Give it a .js name (e.g. public/modularjs/bundle.js); the manifest you write yourself is declared in manifestExternal.`,
  'bundler.config.manifestpath-egal-externe': ({ valeur }: MsgVars) => `[mjs.config.json] manifestPath ('${valeur}') points to the same file as manifestExternal: the build would read it as the external manifest, then overwrite it with the produced manifest. Give manifestPath another path (e.g. public/modularjs/bundle.js).`,
  'bundler.config.manifestpath-dans-sources': ({ valeur, sourceDir, outputDir }: MsgVars) => `[mjs.config.json] manifestPath ('${valeur}') is inside the source folder (sourceDir: '${sourceDir}') while the produced files go elsewhere (outputDir: '${outputDir}'): every build would write the manifest in the middle of your code, over any file of the same name. Put it next to the produced files (e.g. '${outputDir}/bundle.js').`,
  // assetDirs: a list of folder paths that exist (relative to the folder of mjs.config.json)
  'bundler.config.asset-dirs-doit-etre-liste': ({ valeur, type }: MsgVars) => `[mjs.config.json] assetDirs must be a list of folders (for example ["app/assets/images"]), got: ${valeur} (${type})`,
  'bundler.config.asset-dirs-element-invalide': ({ index, valeur, type }: MsgVars) => `[mjs.config.json] assetDirs[${index}] must be a folder path (a non-empty string), got: ${valeur} (${type})`,
  'bundler.config.asset-dirs-dossier-absent': ({ index, dossier, chemin }: MsgVars) => `[mjs.config.json] assetDirs[${index}]: the folder '${dossier}' does not exist (looked in ${chemin}). Create it, or remove it from the list.`,
  'bundler.config.asset-dirs-pas-un-dossier': ({ index, dossier, chemin }: MsgVars) => `[mjs.config.json] assetDirs[${index}]: '${dossier}' is not a folder (${chemin}). Give the folder that holds the images.`,
  // urlPrefix without a leading slash (ambiguous path).
  'bundler.config.urlprefix-slash-initial-exige': ({ valeur }: MsgVars) => `[mjs.config.json] urlPrefix must start with '/', got: ${valeur}`,
  'bundler.config.doit-etre-booleen': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} must be a boolean (true/false), got: ${valeur} (${type})`,
  'bundler.config.dev-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'dev' must be an object { port?, host?, allowedHosts? } (${chemin})`,
  'bundler.config.dev-cle-inconnue': ({ cle }: MsgVars) => `[mjs.config.json] dev.${cle}: unknown key (valid: port, host, allowedHosts)`,
  'bundler.config.dev-allowed-hosts-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] dev.allowedHosts: ${valeur} is not accepted. Write true to accept every name, or a list of host names, without http:// or port: ["abc.ngrok-free.app", ".example.com"] (a name starting with a dot covers that domain and its subdomains).`,
  'bundler.config.dev-port-doit-etre-nombre': ({ valeur, type }: MsgVars) => `[mjs.config.json] dev.port must be a number, got: ${valeur} (${type})`,
  'bundler.config.port-hors-plage': ({ cle, valeur }: MsgVars) => `[mjs.config.json] ${cle} must be an integer between 1 and 65535, got: ${valeur}`,
  'bundler.config.view-transition-invalide-generique': ({ valeur, bases, basesDir }: MsgVars) => `[mjs.config.json] invalid viewTransition: '${valeur}'\n  Expected value: "none", a base (${bases}), optionally followed by options "base={ direction: …, duration: …, priority: … }" (direction reserved for directional bases: ${basesDir}) — no boolean accepted`,
  'bundler.config.view-transition-invalide-detail': ({ valeur, erreur }: MsgVars) => `[mjs.config.json] invalid viewTransition: '${valeur}' — ${erreur}`,
  'bundler.config.default-script-lang-conflit': ({ a, b }: MsgVars) => `[mjs.config.json] defaultScriptLang ('${a}') and languages.script ('${b}') differ — keep only one of the two keys.`,
  'bundler.config.runtime-invalide-chaine': ({ valeur, modules }: MsgVars) => `[mjs.config.json] invalid runtime: '${valeur}'\n  Valid values: 'all', 'core', or an array of optional modules (${modules})`,
  'bundler.config.runtime-doit-etre-tableau': ({ valeur, type, chemin }: MsgVars) => `[mjs.config.json] runtime must be 'all', 'core' or an array of modules, got: ${valeur} (${type}) (${chemin})`,
  'bundler.config.runtime-module-doit-etre-chaine': ({ valeur, type }: MsgVars) => `[mjs.config.json] runtime[]: each module must be a string, got: ${valeur} (${type})`,
  'bundler.config.runtime-module-core': ({ module, modules }: MsgVars) => `[mjs.config.json] runtime: '${module}' is already part of the CORE (always included) — do not list it.\n  Valid optional modules: ${modules}`,
  'bundler.config.runtime-module-inconnu': ({ module, modules, presets }: MsgVars) => `[mjs.config.json] runtime: unknown module '${module}'\n  Valid optional modules: ${modules} — or a preset: ${presets}`,
  'bundler.config.runtime-module-remplace': ({ module, nouveau }: MsgVars) => `\n  '${module}' no longer exists: its effect is now part of '${nouveau}'.`,
  'bundler.config.preload-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] invalid preload: '${valeur}'\n  Valid values: ${valides} (or an object { view?, page? })`,
  'bundler.config.preload-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'preload' must be a string or an object { view?, page? } (${chemin})`,
  'bundler.config.preload-axes-renommes': `[mjs.config.json] preload: the "local"/"server" axes were renamed — write "view" (view-module preload) and "page" (server-page preload).`,
  'bundler.config.cle-inconnue': ({ cle, valides }: MsgVars) => `[mjs.config.json] ${cle}: unknown key\n  Valid keys: ${valides}`,
  'bundler.config.preload-axis-invalide': ({ axe, valeur, valides }: MsgVars) => `[mjs.config.json] invalid preload.${axe}: '${valeur}'\n  Valid values: ${valides}`,
  'bundler.config.css-mode-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] invalid css: '${valeur}'\n  Valid values: ${valides}`,
  'bundler.config.js-mode-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] invalid js: '${valeur}'\n  Valid values: ${valides}`,
  'bundler.config.js-bundle-exige-css-bundle': () => `[mjs.config.json] js: 'bundle' is incompatible with css: 'split'/'lazy'.\n  Bundle mode merges EVERYTHING (core, styles, animations, components) into a single file — an already-split CSS would contradict "a single JS file".\n  Fix: remove the css key (default 'bundle') or set js: 'split'.`,
  'bundler.config.csp-incompatible-js-bundle': () => `[mjs.config.json] csp: true is incompatible with js: 'bundle'.\n  Strict mode requires a SPLIT CSS (<link> tags to separate stylesheets) ; bundle JS mode conversely requires a MERGED CSS (css: 'bundle', a single JS file) — no css value can ever satisfy both at once.\n  Fix: remove csp (or set it to false), or switch js back to 'split'.`,
  'bundler.config.source-map-mode-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] invalid sourceMap: ${valeur}\n  Valid values: ${valides}`,
  'bundler.config.types-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] "types" is "warn" (default: a console warning) or "error" (an error that stops the faulty write), in development only — got ${valeur}.`,
  'bundler.config.effects-objet': ({ valeur }: MsgVars) => `[mjs.config.json] "effects" is an object: { "theme": "circle" | "none", "lite": "auto" | "on" | "off", "skeleton": ["await", "components"], "guard": true | false | { "delay": "1s" }, "rate": 4 } — got ${valeur}.`,
  'bundler.config.effects-cle': ({ cle, valides }: MsgVars) => `[mjs.config.json] "effects": unknown key "${cle}" — allowed keys: ${valides}.`,
  'bundler.config.effects-liste': ({ cle, valeur, valides }: MsgVars) => `[mjs.config.json] "effects.${cle}" is a list — got ${valeur}; allowed words: ${valides} ("skeleton": ["await", "components"]; []: none).`,
  'bundler.config.effects-element': ({ cle, valeur, valides }: MsgVars) => `[mjs.config.json] "effects.${cle}": "${valeur}" — allowed: ${valides}.`,
  'bundler.config.effects-valeur': ({ cle, valeur, valides }: MsgVars) => `[mjs.config.json] "effects.${cle}" is ${valides} — got ${valeur}.`,
  'bundler.config.effects-guard': ({ valeur }: MsgVars) => `[mjs.config.json] "effects.guard" is true, false or { "delay": "1s" } — got ${valeur}.`,
  'bundler.config.effects-guard-delay': ({ valeur }: MsgVars) => `[mjs.config.json] "effects.guard.delay" is a duration: a number of milliseconds (800), or "800ms", "1.5s" — got ${valeur}.`,
  'bundler.config.effects-guard-delay-trop-long': ({ valeur }: MsgVars) => `[mjs.config.json] "effects.guard.delay" cannot exceed 24 hours (86,400,000 ms). Give a shorter duration, for example 1000, "1s" or "800ms" — got ${valeur}.`,
  'bundler.config.effects-skeleton-i18n': () => `[mjs.config.json] "effects.skeleton" no longer takes "i18n": the bars of translated texts are set by "i18n.placeholder" (*skeleton) and by the fallback delay "i18n.timeout" — remove "i18n" from the list.`,
  'bundler.config.effects-rate': ({ valeur }: MsgVars) => `[mjs.config.json] "effects.rate" is the live effects' share, in messages per second: an integer from 1 to 1000 (4 by default) — got ${valeur}.`,
  'bundler.config.csp-exige-css-decoupe': () => `[mjs.config.json] csp: true is incompatible with css: 'bundle'.\n  Strict mode replaces the server-rendered inline <style> tags with <link> tags pointing at the emitted stylesheets, which only exist when CSS is split.\n  Fix: set css: 'split' (one stylesheet per module) or css: 'lazy' (loaded on demand).`,
  'bundler.config.lint-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'lint' must be an object, for example { "a11y": false, "maxStateVars": 60 } (${chemin})`,
  'bundler.config.lint-max-state-vars-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] lint.maxStateVars must be an integer ≥ 0 (0 disables the warning), got: ${valeur} (${type})`,
  'bundler.config.lint-empty-component-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] lint.emptyComponent must be true, false or "error" (build error), received: ${valeur}`,
  'bundler.config.lint-type-invalide': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] lint.${cle} must be a boolean (true/false), got: ${valeur} (${type})`,
  'bundler.config.log-level-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'logLevel' must be a string or an object { dev?, prod? } (${chemin})`,
  'bundler.config.log-level-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] logLevel invalid: '${valeur}'\n  Valid values: ${valides} (or an object { dev?, prod? })`,
  'bundler.config.messages-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] messages invalid: '${valeur}'\n  Valid values: ${valides}`,
  'bundler.config.log-level-env-invalide': ({ env, valeur, valides }: MsgVars) => `[mjs.config.json] logLevel.${env} invalid: '${valeur}'\n  Valid values: ${valides}`,
  'bundler.config.ws-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'ws' must be an object { entry?, transport?, port?, host?, heartbeat?, limits?, resume?, bridge? } (${chemin})`,
  'bundler.config.cle-inconnue-hint': ({ cle, hint, valides }: MsgVars) => `[mjs.config.json] ${cle}: unknown key${hint}\n  Valid keys: ${valides}`,
  'bundler.config.transport-invalide': ({ cle, valeur, hint, valides }: MsgVars) => `[mjs.config.json] invalid ${cle}: ${valeur}${hint}\n  Valid values: ${valides} (a custom MjsWsTransport instance is supplied from the entry, not the config)`,
  'bundler.config.codec-invalide': ({ cle, valeur, hint, valides }: MsgVars) => `[mjs.config.json] invalid ${cle}: ${valeur}${hint}\n  Valid values: ${valides}`,
  'bundler.config.entier-positif-ms-invalide': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} must be an integer > 0 (ms), got: ${valeur} (${type})`,
  'bundler.config.limits-doit-etre-objet': ({ cle, chemin }: MsgVars) => `[mjs.config.json] ${cle} must be an object { rate?, burst?, kickAfter?, maxPayload?, maxBuffered?, maxConnections?, maxConnectionsPerIp?, maxRoomsPerClient? } (${chemin})`,
  'bundler.config.limits-cle-invalide': ({ cle, suffixe, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} must be an integer > 0${suffixe}, got: ${valeur} (${type})`,
  'bundler.config.adapter-doit-etre-objet': ({ cle, chemin }: MsgVars) => `[mjs.config.json] '${cle}' must be an object { redis, prefix?, antiEntropy? } (${chemin})`,
  'bundler.config.adapter-redis-requis': ({ cle }: MsgVars) => `[mjs.config.json] ${cle} is required (non-empty string, e.g. 'redis://127.0.0.1:6379')`,
  'bundler.config.chaine-non-vide-invalide': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} must be a non-empty string, got: ${valeur} (${type})`,
  'bundler.config.entier-ou-false-invalide': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} must be an integer > 0 (ms) or false, got: ${valeur} (${type})`,
  'bundler.config.token-doit-etre-objet': ({ cle, valeur, type, chemin }: MsgVars) => `[mjs.config.json] '${cle}' must be an object { sweep?, slack? }, got: ${valeur} (${type}) (${chemin})`,
  'bundler.config.entier-positif-invalide': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} must be an integer > 0, got: ${valeur} (${type})`,
  'bundler.config.rate-by-invalide': ({ cle, valeur, hint, valides }: MsgVars) => `[mjs.config.json] invalid ${cle}: ${valeur}${hint}\n  Valid values: ${valides}`,
  'bundler.config.ban-doit-etre': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} must be true, false or an object { after?, within?, duration?, by? }, got: ${valeur} (${type})`,
  'bundler.config.ban-by-invalide': ({ cle, valeur, hint, valides }: MsgVars) => `[mjs.config.json] invalid ${cle}: ${valeur}${hint}\n  Valid values: ${valides}`,
  'bundler.config.resume-doit-etre-objet': ({ cle, valeur, type, chemin }: MsgVars) => `[mjs.config.json] ${cle} must be true, false or an object { grace?, maxBuffered?, maxBytes? }, got: ${valeur} (${type}) (${chemin})`,
  'bundler.config.bridge-doit-etre-objet': ({ cle, chemin }: MsgVars) => `[mjs.config.json] '${cle}' must be an object { port?, host?, secret?, webhooks?, rateLimit?, nonce? } (${chemin})`,
  'bundler.config.webhooks-doit-etre-objet': ({ cle, chemin }: MsgVars) => `[mjs.config.json] ${cle} must be an object { url, secret?, events, timeoutMs? } (${chemin})`,
  'bundler.config.webhooks-url-requis': ({ cle }: MsgVars) => `[mjs.config.json] ${cle} is required (non-empty string)`,
  'bundler.config.webhooks-events-invalide': ({ cle }: MsgVars) => `[mjs.config.json] ${cle} must be a NON-EMPTY array of strings (e.g. ['connect', 'message:chat'])`,
  'bundler.config.doit-etre-booleen-simple': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} must be a boolean, got: ${valeur} (${type})`,
  'bundler.config.bundles-objet': ({ valeur }: MsgVars) => `[mjs.config.json] "bundles" is an object: { "group-name": ["root-component", …] } or { "group-name": { "roots": ["root-component", …], "except": ["component-left-out", …] } } — got ${valeur}.`,
  'bundler.config.bundles-nom': ({ nom }: MsgVars) => `[mjs.config.json] bundles: the group name '${nom}' is invalid — it becomes part of the emitted file name: lowercase letters, digits and hyphens only, no leading hyphen.`,
  'bundler.config.bundles-liste': ({ nom, valeur }: MsgVars) => `[mjs.config.json] bundles: group '${nom}' expects a list of root components (["component", …]) or an object { "roots": [...], "except": [...] }, got: ${valeur}`,
  'bundler.config.bundles-vide': ({ nom }: MsgVars) => `[mjs.config.json] bundles: group '${nom}' is empty — list at least one root component.`,
  'bundler.config.bundles-cle-inconnue': ({ nom, cle, valides }: MsgVars) => `[mjs.config.json] bundles: group '${nom}' contains the unknown key '${cle}' — valid keys: ${valides}.`,
  'bundler.config.bundles-except': ({ nom, valeur }: MsgVars) => `[mjs.config.json] bundles: group '${nom}' expects, in "except", a list of component names (non-empty strings), got: ${valeur}`,
  'bundler.config.bundles-element': ({ nom, valeur }: MsgVars) => `[mjs.config.json] bundles: group '${nom}' lists component names only (non-empty strings), got: ${valeur}`,
  'bundler.config.route-light-sans-effet-csr': ({ url }: MsgVars) => `[mjs.config.json] render.routes['${url}'].light has no effect on a 'csr' route: the server renders nothing there, the client mounts the root on its own.`,
  'bundler.config.ratelimit-doit-etre-objet': ({ cle, valeur, type, chemin }: MsgVars) => `[mjs.config.json] ${cle} must be 'false' or an object { perIp?, fails? }, got: ${valeur} (${type}) (${chemin})`,
  'bundler.config.ratelimit-tuple-invalide': ({ cle, valeur }: MsgVars) => `[mjs.config.json] ${cle} must be an array [capacity, windowMs] of 2 integers > 0, got: ${valeur}`,
  'bundler.config.serveur-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'serveur' must be an object { entry?, transport?, port?, host?, heartbeat?, limits?, resume?, bridge?, antiCheat? } (${chemin})`,
  'bundler.config.session-exclusive-invalide': ({ cle, valeur, hint, valides }: MsgVars) => `[mjs.config.json] invalid ${cle}: ${valeur}${hint}\n  Valid values: true, false, ${valides}`,
  'bundler.config.verify-origin-invalide': ({ cle, valeur }: MsgVars) => `[mjs.config.json] ${cle} must be a non-empty array of non-empty strings, got: ${valeur}`,
  'bundler.config.antitriche-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'serveur.antiCheat' must be an object { movesPerIdentity?, codePerIp?, privateGamesPerCreator? } (${chemin})`,
  'bundler.config.moves-per-identity-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] serveur.antiCheat.movesPerIdentity must be [n integer ≥ 1, windowMs integer > 0] or null, got: ${valeur}`,
  'bundler.config.code-per-ip-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] serveur.antiCheat.codePerIp must be [n integer ≥ 1, windowMs integer > 0] or null, got: ${valeur}`,
  'bundler.config.private-games-per-creator-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] serveur.antiCheat.privateGamesPerCreator must be an integer ≥ 1 or null, got: ${valeur}`,
  'bundler.config.languages-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'languages' must be an object { script?, template? } (${chemin})`,
  'bundler.config.i18n-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'i18n' must be an object { default?, placeholder?, hash? } (${chemin})`,
  'bundler.config.i18n-default-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] i18n.default must be a non-empty string (language code), got: ${valeur}`,
  'bundler.config.i18n-timeout-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] "i18n.timeout" is a duration: a number of milliseconds (800), or "800ms", "1.5s" (3 s by default) — got ${valeur}.`,
  'bundler.config.i18n-timeout-trop-long': ({ valeur }: MsgVars) => `[mjs.config.json] "i18n.timeout" cannot exceed 2147483647 ms (about 24.8 days), the limit of a timer: beyond it the rescue would fire at once instead of waiting. Give a shorter duration, for example 5000, "5s" or "800ms" — got ${valeur}.`,
  'bundler.config.i18n-source-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] i18n.source must be a non-empty string (language code), got: ${valeur}`,
  'bundler.config.journal-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'journal' must be an object { server?, client?, viewer?, maxEntries?, maxBytes? } (${chemin})`,
  'bundler.config.journal-trust-proxy-invalide': ({ chemin, erreur }: MsgVars) => `[mjs.config.json] invalid journal.trustProxy in ${chemin}: ${erreur}`,
  'bundler.config.journal-viewer-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] journal.viewer must be a boolean or a non-empty string (token), got: ${valeur} (${type})`,
  'bundler.config.booleen-defaut-invalide': ({ cle, defaut, valeur }: MsgVars) => `[mjs.config.json] ${cle} must be a boolean (default ${defaut}), got: ${valeur}`,
  'bundler.config.forward-origin-vide': `[mjs.config.json] render.forwardOrigin (origin) cannot be an empty string — expected an origin URL, e.g. 'https://example.com'`,
  'bundler.config.forward-origin-url-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] render.forwardOrigin must be a valid origin URL (e.g. 'https://example.com'), got: ${valeur}`,
  'bundler.config.forward-origin-cle-inconnue': ({ cle }: MsgVars) => `[mjs.config.json] ${cle}: unknown key\n  Valid key: trustedHosts`,
  'bundler.config.trusted-hosts-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] render.forwardOrigin.trustedHosts must be a non-empty array of hostnames (strings), got: ${valeur}`,
  'bundler.config.trusted-host-item-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.forwardOrigin.trustedHosts[]: each host must be a non-empty string, got: ${valeur} (${type})`,
  'bundler.config.forward-origin-trusted-host-invalide': ({ index, valeur }: MsgVars) => `[mjs.config.json] render.forwardOrigin.trustedHosts[${index}]: ${valeur} — expected a bare hostname, without port, brackets or path ; a mapped IPv4 is written in hexadecimal (\`::ffff:102:304\`), never dotted (\`::ffff:1.2.3.4\`)`,
  'bundler.config.forward-origin-trusted-host-non-canonique': ({ index, valeur, canonique }: MsgVars) => `[mjs.config.json] render.forwardOrigin.trustedHosts[${index}]: ${valeur} is not the canonical form of this host — write "${canonique}" (this normalized form is what the server compares to the Host header)`,
  // non-blocking warning (not a throw): an ACCEPTED host
  // (regex + canonical form) that still designates an internal target stays listed, the build
  // continues — cf. `validateForwardOrigin`, bundler/config.ts.
  'bundler.config.forward-origin-trusted-host-interne': ({ index, valeur }: MsgVars) => `[mjs.config.json] render.forwardOrigin.trustedHosts[${index}]: ${valeur} is an internal host (loopback, private network, link-local, metadata) — listed here but still blocked at runtime by the forwarding's defense in depth: this entry will never activate anything`,
  'bundler.config.forward-origin-type-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.forwardOrigin must be a boolean, an origin (string, e.g. 'https://example.com') or { trustedHosts: string[] }, got: ${valeur} (${type})`,
  'bundler.config.render-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'render' must be an object (${chemin})`,
  'bundler.config.doit-etre-chaine-simple': ({ cle, chemin }: MsgVars) => `[mjs.config.json] ${cle} must be a string (${chemin})`,
  'bundler.config.render-outdir-hors-projet': ({ valeur, chemin }: MsgVars) => `[mjs.config.json] render.outDir must stay inside the project directory (${chemin}) — the prerender writes its fragments there AND removes the stale ones; got: '${valeur}'`,
  'bundler.config.render-target-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] render.target must be a non-empty string (CSS selector of the container), got: ${valeur}`,
  'bundler.config.render-cache-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] invalid render.cache: '${valeur}'\n  Valid values: ${valides}`,
  'bundler.config.startup-bundle-avec-js-bundle': () => `[mjs.config.json] render.startup: 'bundle' together with js: 'bundle': incompatible.\n  js: 'bundle' already ships the WHOLE project as a single file — a page file would have nothing left to assemble.\n  Keep one of the two: js: 'split' (default) with render.startup: 'bundle', or js: 'bundle' with render.startup: 'preload'.`,
  'bundler.config.startup-slug-collision': ({ slug, urls }: MsgVars) => `[mjs.config.json] render.startup: 'bundle' — these routes yield the same page file name (mjs_page-${slug}): ${urls}\n  The name comes from the URL (anything that is not a letter or a digit becomes a dash): only one of them would keep its file.\n  Change one of the URLs, or set "startup": "preload" on one of them.`,
  'bundler.config.render-routes-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] render.routes must be an object { "<url>": { component, mode? } } (${chemin})`,
  'bundler.config.route-doit-etre-objet': ({ url }: MsgVars) => `[mjs.config.json] render.routes['${url}'] must be an object { component, mode? }`,
  'bundler.config.route-hors-dossier': ({ url }: MsgVars) => `[mjs.config.json] render.routes['${url}']: this address would leave the prerender folder (".." segment, backslash "\\" or absolute path) — write an address that starts with "/", made of plain segments (e.g. "/blog/article")`,
  'bundler.config.route-component-requis': ({ url }: MsgVars) => `[mjs.config.json] render.routes['${url}'].component (component name) is required`,
  'bundler.config.locales-invalide': ({ valeur, type, chemin }: MsgVars) => `[mjs.config.json] render.locales must be an array of languages (strings), got: ${valeur} (${type}) (${chemin})`,
  'bundler.config.locale-item-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.locales[]: each language must be a non-empty string, got: ${valeur} (${type})`,
  'bundler.config.locale-hors-dossier': ({ valeur }: MsgVars) => `[mjs.config.json] render.locales: the language '${valeur}' would leave the prerender folder (".." segment, backslash "\\" or absolute path) — write a language code (e.g. "fr", "en-US")`,
  'bundler.config.render-engine-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] render.engine must be an object { prerender?, request? } (${chemin})`,
  'bundler.config.browserpool-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] render.browserPool must be an object { size?, keepAlive?, maxAgeMs?, renderTimeoutMs? } (${chemin})`,
  'bundler.config.browserpool-size-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.browserPool.size must be an integer ≥ 1, got: ${valeur} (${type})`,
  'bundler.config.browserpool-maxagems-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.browserPool.maxAgeMs must be an integer ≥ 0, got: ${valeur} (${type})`,
  'bundler.config.browserpool-rendertimeoutms-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.browserPool.renderTimeoutMs must be an integer ≥ 1, got: ${valeur} (${type})`,
  'bundler.config.renderqueue-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] render.renderQueue must be an object { concurrency?, maxQueue? } (${chemin})`,
  'bundler.config.renderqueue-concurrency-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.renderQueue.concurrency must be an integer ≥ 1, got: ${valeur} (${type})`,
  'bundler.config.renderqueue-maxqueue-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.renderQueue.maxQueue must be an integer ≥ 0, got: ${valeur} (${type})`,
  'bundler.config.image-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] image must be an object { widths?, formats?, quality? } (${chemin})`,
  'bundler.config.image-widths-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] image.widths must be a non-empty list of integers ≥ 1, got: ${valeur}`,
  'bundler.config.image-widths-doublon': ({ valeur, largeur }: MsgVars) => `[mjs.config.json] image.widths lists the width ${largeur} twice, got: ${valeur} — write each width only once`,
  'bundler.config.image-widths-trop-grande': ({ valeur, largeur, max }: MsgVars) => `[mjs.config.json] image.widths: the width ${largeur} exceeds ${max} pixels, got: ${valeur} — write screen widths (e.g. [480, 960, 1920])`,
  'bundler.config.image-formats-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] image.formats must be a non-empty list among ${valides}, got: ${valeur}`,
  'bundler.config.image-quality-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] image.quality must be an integer from 1 to 100, got: ${valeur}`,
  'bundler.config.suggestion-hint': ({ suggestion }: MsgVars) => ` — did you mean '${suggestion}'?`,
  'bundler.config.limite-nullable-suffixe': ' (or null = unlimited)',
  'bundler.config.allowed-origins-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.allowedOrigins must be an array of strings (or false), got: ${valeur} (${type})`,
  'bundler.config.allowed-origins-item-invalide': ({ index, valeur, type }: MsgVars) => `[mjs.config.json] render.allowedOrigins[${index}] must be a non-empty string, got: ${valeur} (${type})`,
  'bundler.config.parse-error': ({ chemin, erreur }: MsgVars) => `[mjs.config.json] JSON syntax error in ${chemin}: ${erreur}`,
  // — index.ts
  'bundler.index.collision-basename-tag': ({ cle, prev, fichier }: MsgVars) => `[bundler] Basename collision: '${cle}' is published by both ${prev} AND ${fichier} (tag <mjs-${cle}>). The autoloader will only be able to resolve one of the two components (the last compiled) — the other will remain inert, silently. Rename one of the files.`,
  'bundler.index.erreur-fichier': ({ fichier, raison }: MsgVars) => `[bundler] ${fichier}: ${raison}`,
  // successful recovery: the failed component's old hashed file is
  // still served, no outage for the user (just a frozen version).
  'bundler.index.composant-echec-ancienne-version': ({ nom, fichier }: MsgVars) => `[bundler] ${nom}: compilation failed — the previous version (${fichier}) is still served.`,
  'bundler.index.composant-echec-non-repeche': ({ nom }: MsgVars) => `[bundler] ${nom}: compilation failed — the build fails without publishing anything, the site already built is still served as is; fix the component, or run \`mjs dev\`, which keeps its previous version while you fix it.`,
  'bundler.index.composant-echec-reprise-impossible': ({ nom, fichier }: MsgVars) => `[bundler] ${nom}: compilation failed — the previous version (${fichier}) is no longer served: it imports a file this build replaces (the core, a module…). Fix the component to get it back.`,
  'bundler.index.animation-inconnue': ({ nom, dossier }: MsgVars) => `[bundler] Unknown animation: '${nom}' referenced via @transition/@in/@out but missing from ${dossier} (typo?). The component using it will fail SILENTLY at runtime ('µ.anim.${nom}' is undefined).`,
  'bundler.index.animation-inconnue-lieu': ({ lieux, suggestion }: MsgVars) => ` Written in ${lieux}.${suggestion}`,
  'bundler.index.transition-inconnue': ({ nom }: MsgVars) => `[ModularJS] *${nom}: unknown transition — neither a library effect, nor an effect of your project, nor an animation created by µanim.create.`,
  'bundler.index.transition-inconnue-creer': ({ nom }: MsgVars) => ` To create it: *${nom} = *fade(…) in a *.effects.mjs file of your project, or µanim.create '${nom}', … (µanim.crossfade 'base' for the baseSend and baseReceive pair) in a <script>, written exactly like that with the name between quotes: the build reads neither a computed name, nor a call made through a variable (a = µ.anim) or a destructuring ({ create } = µ.anim).`,
  'bundler.index.collision-basename-module': ({ nom, precedent, fichier }: MsgVars) => `[bundler] Basename collision: '${nom}' present in both ${precedent} AND ${fichier}. Both modules compile to the same file → overwrite + 404 import in the .mjs that references the loser. Rename one of the files.`,
  'bundler.index.runtime-module-inconnu-ignore': ({ module, modules }: MsgVars) => `[bundler] runtime: unknown module '${module}' ignored (optional: ${modules})`,
  'bundler.index.runtime-hint-ujs': `[bundler] runtime: 'ujs' intercepts links to µ.Router, absent from your selection — the interception will remain inert. Add 'router' (and 'ajax' for preloading) for SPA navigation.`,
  'bundler.index.runtime-hint-game': `[bundler] runtime: 'game' adds sock.game() to µ.socket, absent from your selection — sock.game will remain undefined. Add 'socket'.`,
  'bundler.index.runtime-hint-chat': `[bundler] runtime: 'chat' adds sock.chat() to µ.socket, absent from your selection — sock.chat will remain undefined. Add 'socket'.`,
  'bundler.index.runtime-hint-accounts': `[bundler] runtime: 'accounts' adds sock.account to µ.socket, absent from your selection — sock.account will remain undefined. Add 'socket'.`,
  'bundler.index.runtime-hint-lobby': `[bundler] runtime: 'lobby' adds sock.lobby() to µ.socket, absent from your selection — sock.lobby will remain undefined. Add 'socket'.`,
  'bundler.index.runtime-hint-schema': `[bundler] runtime: 'schema' adds schema-aware binary encoding to µ.socket, absent from your selection — µ.schema() remains usable (pure registry) but never wired to the network. Add 'socket'.`,
  'bundler.index.runtime-hint-optimistic': `[bundler] runtime: 'optimistic' is typically used with sock.request(), 'socket' absent from your selection — µ.optimistic() remains usable alone (e.g. via: -> fetch(...)) but never with sock.request. Add 'socket' if needed.`,
  'bundler.index.runtime-hint-interp': `[bundler] runtime: 'interp' interpolates sock.game() matches, 'game' absent from your selection — µ.interp() will have no match to observe. Add 'game'.`,
  'bundler.index.runtime-hint-predict': `[bundler] runtime: 'predict' predicts/reconciles sock.game() intents, 'game' absent from your selection — µ.predict() will have no match to drive. Add 'game'.`,
  'bundler.index.runtime-hint-lockstep-game': `[bundler] runtime: 'lockstep' drives sock.game() matches, 'game' absent from your selection — µ.lockstep() will have no match to drive. Add 'game'.`,
  'bundler.index.runtime-hint-lockstep-det': `[bundler] runtime: 'lockstep' uses µ.random (deterministic seed) to replay the journal, 'det' absent from your selection — µ.lockstep will remain undefined. Add 'det'.`,
  'bundler.index.runtime-sans-i18n-liste': ({ liste }: MsgVars) => `[bundler] runtime: your application translates texts (µt or @i18n), but 'i18n' is absent from your selection — µ.t would remain undefined and rendering would crash on the first translated text. Add 'i18n' in your mjs.config.json: "runtime": ${liste}`,
  'bundler.index.runtime-sans-i18n-core': `[bundler] runtime: your application translates texts (µt or @i18n), but "runtime": "core" does not include translation — µ.t would remain undefined and rendering would crash on the first translated text. Write in your mjs.config.json: "runtime": ["i18n"]`,
  'bundler.index.runtime-introuvable': ({ manquants, total, dossier, liste }: MsgVars) => `[bundler] Runtime not found: ${manquants}/${total} file(s) missing in '${dossier}' (${liste}). Check 'runtimeDir' in mjs.config.json or your ModularJS installation.`,
  'bundler.index.contrat-coeur-rompu': ({ manquants, modules, core }: MsgVars) => {
    const noms      = String(manquants).split(', ')
    const publiques = noms.filter(n => n.startsWith('µ.'))
    const internes  = noms.filter(n => !n.startsWith('µ.'))
    const lignes    = [`[bundler] Incomplete core — build REFUSED: the produced mjs_core.js (${modules} modules assembled) lacks what your components call: ${manquants}.`]
    if (publiques.length > 0) {
      const nature = (n: string) => n === 'µ.Store' ? `the class ${n}` : n === 'µ.Ticker' ? `the object ${n}` : `the function ${n}`
      const erreur = (n: string) => n === 'µ.Store' ? `"${n} is not a constructor"` : n === 'µ.Ticker' ? `"Cannot read properties of undefined"` : `"${n} is not a function"`
      const mods   = publiques.map(n => `'${n.slice(2).toLowerCase()}'`).join(', ')
      const liste  = publiques.map(n => `${nature(n)} ('${n.slice(2).toLowerCase()}' module)`).join(', ')
      const plus   = publiques.length > 1
      lignes.push(`The produced core lacks ${liste}: at runtime, the first view that uses ${plus ? 'them' : 'it'} would stop on ${publiques.map(erreur).join(', ')}. Two causes, in this order: ${core ? `either 'runtime' (mjs.config.json) is "core", which does not include ${plus ? 'them' : 'it'} — write "runtime": [${publiques.map(n => `"${n.slice(2).toLowerCase()}"`).join(', ')}];` : `either 'runtime' (mjs.config.json) drops ${plus ? 'these modules' : 'this module'} — name ${mods} in the array;`} or module detection no longer recognizes ${plus ? 'these uses' : 'this use'}, which is a framework bug: please report it.`)
    }
    if (internes.length > 0) lignes.push(`${internes.length > 1 ? 'Internal symbols' : 'Internal symbol'}: ${internes.join(', ')} — at runtime each one would throw "this.<name> is not a function" on the first view that uses it. Two causes, in this order: ${core ? 'either \'runtime\' (mjs.config.json) is "core", which does not include a module you actually use — replace "core" with the list of modules you need;' : 'either \'runtime\' (mjs.config.json) drops a module you actually use — name it in the array;'} or the compiler emits a name detection no longer recognizes, which is a framework bug: please report it.`)
    return lignes.join('\n')
  },
  'bundler.index.outil-effet-absent': ({ liste }: MsgVars) => `[bundler] Effect tool missing — build REFUSED: ${liste}.\nEach tool above (src/runtime/mjs_fx_tool*.ts) is named in the code of the modules listed in parentheses, and this build does not ship it: at runtime the call would throw "is not a function" the first time the effect is applied — except the frame-rate guard (fx_toolgauge), which would be missing silently: a heavy effect would run with no frame rate measured.\nThis is a framework bug (the tool list in bundler/fx-tools.ts, or the section sorting of the effect): please report it.`,
  'bundler.index.cycle-import-detecte': ({ chaine }: MsgVars) => `[bundler] @import/µasset cycle detected: ${chaine}. A module cannot import itself, directly or indirectly.`,
  'bundler.index.cycle-import-js-copies': ({ chaine }: MsgVars) => `[bundler] Import cycle between copied .js files: ${chaine}. A fingerprinted file cannot import a file that imports it back.`,
  'bundler.index.dep-jamais-resolue': ({ unite, deps }: MsgVars) => `[bundler] '${unite}': emission impossible — dependency never resolved (${deps}). The dependency likely failed to compile elsewhere; fix it first.`,
  'bundler.index.repere-jamais-resolu-manifeste': ({ cle }: MsgVars) => `[bundler] '${cle}': internal placeholder never resolved in the manifest — the entry is dropped rather than published broken. Report this, it's a bundler bug.`,
  'bundler.index.repere-non-resolu-emission': ({ unite }: MsgVars) => `[bundler] '${unite}': internal placeholder still present after resolving its dependencies — write refused. Report this, it's a bundler bug.`,
  'bundler.index.repere-non-resolu-ecriture': ({ fichier }: MsgVars) => `[bundler] '${fichier}': write refused — still contains an unresolved internal placeholder. Report this, it's a bundler bug.`,
  'bundler.index.js-bundle-module-virtuel-introuvable': ({ specificateur }: MsgVars) => `[bundler] js: 'bundle' — virtual specifier '${specificateur}' has no in-memory content. Report this, it's a bundler bug.`,
  'bundler.index.js-bundle-echec': ({ raison }: MsgVars) => `[bundler] js: 'bundle' — single-file assembly failed: ${raison}`,
  'bundler.startup.echec': ({ page, raison }: MsgVars) => `[bundler] startup of '${page}' — page file assembly failed: ${raison}`,
  'bundler.startup.recompile-empreintes': ({ fichier }: MsgVars) => `[bundler] the output folder was recompiled with other fingerprints — sources changed during the build ('${fichier}' no longer exists); run the build again.`,
  'bundler.startup.fichier-de-page': ({ page, fichier, nb }: MsgVars) => `   ✓ ${page} → ${fichier} (${nb} component${Number(nb) > 1 ? 's' : ''} assembled)`,
  'bundler.startup.bundle-hors-production': () => `   ℹ️  render.startup: 'bundle' — development build: preloading only, the page file is assembled by \`--prod\` alone.`,
  'bundler.groupes.racine-inconnue': ({ groupe, racine }: MsgVars) => `[bundler] group '${groupe}' (bundles): '${racine}' is not a component of the project — give the name of a .mjs file, without extension (a .civet/.coffee module cannot be a root).`,
  // a component can belong to one group only: the error lists ALL the offending components at once (one line each, with its
  // groups), then what to write: the "except" line to add to the groups that have none, the completed list of those that already
  // have one, a root's own advice, a word on the object form if a group to change is written as a list.
  // Lines after the first carry three spaces: the CLI prints the first one after a three-column indent
  'bundler.groupes.plusieurs-groupes': ({ nb, composants }: MsgVars) => `[bundler] ✗ ${Number(nb) > 1 ? `${nb} components are` : '1 component is'} in several groups: ${composants}`,
  'bundler.groupes.plusieurs-groupes-ligne': ({ composant, nb, groupes }: MsgVars) => `   ${composant}: ${nb} groups: ${groupes}`,
  'bundler.groupes.plusieurs-groupes-conseil': ({ nb, nbGroupes, groupes, except }: MsgVars) => `   To take ${Number(nb) > 1 ? 'them' : 'it'} out of these groups, add to ${Number(nbGroupes) > 1 ? 'each of these groups' : 'this group'} (${groupes}):\n   "except": [${except}]`,
  'bundler.groupes.plusieurs-groupes-existant': () => `   A group that already has an "except" completes it, without adding a second one that would replace the first:`,
  'bundler.groupes.plusieurs-groupes-existant-ligne': ({ groupe, except }: MsgVars) => `   ${groupe}: "except": [${except}]`,
  'bundler.groupes.plusieurs-groupes-forme-liste': () => `   A group written as a list, ["root"], becomes { "roots": ["root"], "except": [...] }.`,
  'bundler.groupes.plusieurs-groupes-racine': ({ composant, racines, nbRacines, autres, nbAutres }: MsgVars) => {
    if (Number(nbRacines) > 1) return `   ${composant} is a root of groups ${racines}: "except" cannot leave a root out. Keep it as a root of one of these groups only (or merge them); in each of the others, remove it from "roots" and add it to "except".${Number(nbAutres) > 0 ? ` Also add it to "except" of ${Number(nbAutres) > 1 ? `groups (${autres})` : `group ${autres}`}.` : ''}`
    return `   ${composant} is a root of group ${racines}, where it stays: add it to "except" of ${Number(nbAutres) > 1 ? `the other groups (${autres})` : `group ${autres}`} only.`
  },
  'bundler.groupes.utilise-hors-groupe': ({ composant, groupe, appelants }: MsgVars) => `[bundles] '${composant}' is in group '${groupe}' but also used outside the group (${appelants}): it stays in the group, and any page that uses it loads the whole group — add it to "except" of group '${groupe}' (form { "roots": [...], "except": ["${composant}"] }) to keep it as a separate file, take it out of the group, or accept that loading.`,
  'bundler.groupes.except-inconnu': ({ groupe, composant }: MsgVars) => `[bundler] group '${groupe}' (bundles): '${composant}', listed in "except", is not a component of the project — give the name of a .mjs file, without extension (a .civet/.coffee module is never in a group, it has nothing to leave out).`,
  'bundler.groupes.except-racine': ({ groupe, composant }: MsgVars) => `[bundler] group '${groupe}' (bundles): '${composant}' is a root of the group and is also listed in "except" — a root cannot be left out: remove it from "except", or from "roots" if you do not want it grouped.`,
  'bundler.groupes.fichier-de-groupe': ({ groupe, fichier, nb }: MsgVars) => `   ✓ group ${groupe} → ${fichier} (${nb} component${Number(nb) > 1 ? 's' : ''} assembled)`,
  'bundler.groupes.hors-production': () => `   ℹ️  bundles — development build: no grouping, groups are assembled by \`--prod\` alone.`,
  'bundler.groupes.fichier-unique': () => `   ℹ️  bundles — js: 'bundle': the single file already delivers the whole project, no group is assembled.`,
  'bundler.groupes.echec': ({ groupe, raison }: MsgVars) => `[bundler] group '${groupe}' — assembling the group file failed: ${raison}`,
  'bundler.startup.fichier-unique': () => `   ℹ️  js: 'bundle' — the single file already carries the core and every component: no startup header in the fragments.`,
  'bundler.index.compilation-bloquee': ({ fichier, timeout, chaine }: MsgVars) => `[bundler] Compilation of '${fichier}' stuck for ${timeout}ms waiting for a compilation already in flight — likely circular dependency between modules BOTH top-level (each waiting for the other via @import/µasset). Current chain: ${chaine}.`,
  'bundler.index.erreur-fichier-detail': ({ fichier, detail }: MsgVars) => `[bundler] ${fichier}: ${detail}`,
  'bundler.transpile-msg.effet-ligne': ({ ligne }: MsgVars) => ` (line ${ligne})`,
  'bundler.transpile-msg.effet-lignes': ({ lignes }: MsgVars) => ` (lines ${lignes})`,
  'bundler.index.voisin-js-absent': ({ fichier, voisin, chemin }: MsgVars) => `"${fichier}" imports "${voisin}", but ${chemin} cannot be found: the import is left as is and will fail (404) at load time — fix the path or add the file.`,
  'bundler.index.singleton-import-module-ligne': ({ fichier, ligne }: MsgVars) => `[ModularJS] ${fichier}: "${ligne}" — an exported reactive singleton (µ$$, formerly §§) is a COMPONENT mechanism (.mjs), not a standalone module (.civet/.coffee) — replace with \`@import name 'path'\` (simple, non-reactive value).`,
  'bundler.index.singleton-import-module-dollar': ({ fichier, noms }: MsgVars) => `[ModularJS] ${fichier}: @import of a reactive singleton ("${noms}") — reserved for .mjs components, not a standalone module (.civet/.coffee) — replace with \`@import name 'path'\` (simple, non-reactive value).`,
  'bundler.index.civet-reaffectation-constante': ({ fichier, nom, ligne }: MsgVars) => `[bundler] ${fichier}: reassignment of '${nom}' (line ${ligne}) refused — declared with ':=' (constant): use '.=' to be able to reassign it.`,
  'bundler.index.css-sass-erreurs': ({ erreurs }: MsgVars) => `[bundler] CSS/SASS compilation error(s) in stylesheetsDir:\n${erreurs}`,
  'bundler.index.feuille-partagee-manquante': ({ themes, dossier }: MsgVars) => `[bundler] @css: missing shared stylesheet(s) in ${dossier}: ${themes} (no matching .sass/.scss/.css file). Check the name, or add the missing file.`,
  'bundler.index.precache-echec': ({ raison }: MsgVars) => `[bundler] mjs-precache.json could not be written: ${raison}. The build is still valid — only the precache list is missing.`,
  'bundler.index.image-sharp-absent': `[bundler] Images: 'sharp' is not installed — images (µimage, <@@img>, effect image settings) pass through as-is, without width variants. Native dimensions are still written (no layout shift). To produce the variants: npm i -D sharp`,
  'bundler.index.img-largeur-infinie': ({ chemin, valeur }: MsgVars) => `[bundler] µimage('${chemin}'): invalid width (${valeur}) — expected a finite, positive number.`,
  'bundler.index.image-animee-trop-grosse': ({ chemin, erreur }: MsgVars) => `[bundler] µimage('${chemin}'): this animated image has too many pixels in total (all its frames counted) for 'sharp' to make variants of it — it passes through as-is, without variants, and its animation is kept. To get variants, reduce its size or its number of frames. Detail: ${erreur}`,
  'bundler.index.image-animee-illisible': ({ chemin, erreur }: MsgVars) => `[bundler] µimage('${chemin}'): this animated image could not be read (detail: ${erreur}); it is published as-is, without variants, and its animation is kept. Check the file.`,
  'bundler.index.img-variante-echec': ({ chemin, erreur }: MsgVars) => `[bundler] µimage('${chemin}'): failed to generate a variant — ${erreur}`,
  // `dossiers`: sourceDir then assetDirs, in search order (absent without assetDirs: the earlier message)
  'bundler.index.img-src-introuvable': ({ chemin, extrait, dossiers }: MsgVars) => `[bundler] <@@img src="${chemin}">: file not found ${dossiers ? `(folders searched, in order: ${dossiers})` : 'in sourceDir'} — ${extrait}`,
  'bundler.index.img-widths-invalide': ({ valeur, extrait }: MsgVars) => `[bundler] <@@img widths="${valeur}">: invalid widths — integers ≥ 1 separated by spaces or commas — ${extrait}`,
  'bundler.index.img-attribut-duplique': ({ attribut, extrait }: MsgVars) => `[bundler] <@@img>: the "${attribut}" attribute is written twice — keep only one — ${extrait}`,
  // `racine`: the folder that holds the link, `assetDirs` when the image comes from a folder of that list (absent: sourceDir)
  'bundler.index.img-src-symlink-hors-racine': ({ chemin, cible, extrait, racine }: MsgVars) => `[bundler] <@@img src="${chemin}">: this path is a symbolic link whose real target ('${cible}') is OUTSIDE ${racine ?? 'sourceDir'} — never copied, to avoid publishing a file outside the project. Remove this link or point it to a path inside ${racine ?? 'sourceDir'} — ${extrait}`,
  'bundler.index.css-lazy-feuilles-jamais-reclamees': ({ feuilles }: MsgVars) => `[bundler] css lazy: shared stylesheet(s) that no module declares (@css) and no view claims — written to disk but NEVER loaded: ${feuilles}. Add '@css <name>' to the module(s) that use them, or delete the file.`,
  'bundler.index.css-split-feuilles-eager': ({ feuilles }: MsgVars) => `[bundler] css split: shared stylesheet(s) that no module declares (@css) — still imported eagerly by the manifest: ${feuilles}. Add '@css <name>' to the module(s) that use them to shrink the CSS shipped per page.`,
  'bundler.index.css-split-feuilles-eager-view': ({ feuilles }: MsgVars) => `[bundler] css split: shared stylesheet(s) claimed by a '<@view css="…">' — still imported eagerly by the manifest even when a module already declares them via @css elsewhere: ${feuilles}. A page that loads that view without loading that module would otherwise inherit them empty (cf. runtime/mjs_element.ts, "Orphelin CSS hérité" warning).`,
  'bundler.index.image-effet-fichier-introuvable': ({ effet, reglage, chemin, fichier, ligne, dossiers }: MsgVars) => `[bundler] *${effet} (${fichier}, line ${ligne}): the image file "${chemin}" (setting ${reglage}) was not found ${dossiers ? `(folders searched, in order: ${dossiers})` : 'in the source folder'}. Check the path, or give the full address of the image (https://…).`,
  'bundler.index.image-effet-introuvable': ({ effet, reglage, chemin, dossiers }: MsgVars) => `[bundler] *${effet}: the image file "${chemin}" (setting ${reglage}) was not found ${dossiers ? `(folders searched, in order: ${dossiers})` : 'in the source folder'}. Check the path, or give the full address of the image (https://…).`,
  'bundler.index.asset-introuvable': ({ chemin, dossiers }: MsgVars) => `[bundler] Asset not found: '${chemin}' referenced via µasset()/µimage()/µ.asset()/mjs.asset() could not be resolved (file missing from disk, or dynamic path not pre-resolvable). Check the path or that the file exists.${dossiers ? ` Folders searched, in order: ${dossiers}.` : ''}`,
  // assetDirs: the same path exists in two image folders — the first of the search order (sourceDir, then the list) is used
  'bundler.index.asset-doublon': ({ chemin, retenu, ecarte }: MsgVars) => `[bundler] The image "${chemin}" exists in two folders: ${retenu} is used, ${ecarte} is ignored (sourceDir comes first, then assetDirs in order). Rename or remove one of the two files to remove the doubt.`,
  'bundler.index.collision-empreinte': ({ fichier }: MsgVars) => `[bundler] '${fichier}': two different contents got the same short fingerprint (1 chance in 60 million). No file was overwritten: change one of the two source files slightly (a space is enough) and run the build again.`,
  // `racine`: the folder that holds the link, `assetDirs` for an image of a folder of that list (absent: sourceDir)
  'bundler.index.symlink-hors-racine': ({ lien, cible, racine }: MsgVars) => `[bundler] '${lien}' is a symbolic link whose real target ('${cible}') is OUTSIDE ${racine ?? 'sourceDir'} — never followed nor copied, to avoid publishing a file outside the project into outputDir. Remove this link or point it to a path inside ${racine ?? 'sourceDir'}.`,
  // DANGLING link (missing
  // target): realpathSync used to throw a raw Node ENOENT, never catalogued.
  'bundler.index.symlink-pendant': ({ lien }: MsgVars) => `[bundler] '${lien}' is a DANGLING symbolic link (its target does not exist) — never followed, its containment cannot be verified. Remove this link or repair its target.`,
  'bundler.index.module-nom-invalide': ({ fichier, nom }: MsgVars) => `[bundler] module name refused '${nom}' (${fichier}) — letters, digits, '_', '.' and '-' only (no space, '#' or '?'), and never the 'mjs_' prefix, reserved for the framework's internal files. Rename this file.`,
  'bundler.index.collision-composant-module': ({ nom, composant, module }: MsgVars) => `[bundler] The component ${composant} and the module ${module} share the name '${nom}': the module would take the component's place, the component would never be written, and <mjs-${nom}> would stay inert. Rename one of the two files (the module, for instance: ${nom}-logic).`,
  'bundler.index.manifeste-refuse-extension': ({ chemin, extension }: MsgVars) => `[bundler] The produced manifest (manifestPath: ${chemin}) would have the extension of a source file (${extension}): every build would overwrite this file. Nothing was written. Give manifestPath a .js name, next to the produced files; the manifest you write yourself is declared in manifestExternal.`,
  'bundler.index.manifeste-refuse-externe': ({ chemin }: MsgVars) => `[bundler] The produced manifest (manifestPath: ${chemin}) would be the manifestExternal file: the build would read it as the external manifest, then overwrite it. Nothing was written. Give manifestPath another path, next to the produced files.`,
  'bundler.index.manifeste-refuse-sources': ({ chemin, sourceDir, outputDir }: MsgVars) => `[bundler] The produced manifest (manifestPath: ${chemin}) would be inside the source folder (${sourceDir}) while the produced files go elsewhere (${outputDir}): every build would write it in the middle of your code, over any file of the same name. Nothing was written. Give manifestPath a path next to the produced files.`,
  'bundler.index.require-introuvable': ({ spec, dossier }: MsgVars) => `[bundler] require not found: '${spec}' (from ${dossier})`,
  'bundler.index.require-dir-introuvable': ({ spec, dossier }: MsgVars) => `[bundler] require_dir not found: '${spec}' (from ${dossier})`,
  'bundler.index.require-hors-projet': ({ directive, fichier, cible }: MsgVars) => `[bundler] external manifest: '${directive}' (${fichier}) reads '${cible}', outside the project — only project files (folder of mjs.config.json, parent folder of sourceDir or folder of the manifest) can be gathered. Copy this file into the project.`,
  'bundler.index.i18n-yaml-manquant': ({ fichier }: MsgVars) => `[bundler] i18n: YAML dictionary detected (${fichier}) but the 'yaml' package is not installed — install it (npm i -D yaml) or convert your dictionaries to .json`,
  'bundler.index.i18n-fichier-invalide': ({ chemin, erreur }: MsgVars) => `[bundler] i18n: invalid file '${chemin}' — ${erreur}`,
  'bundler.index.i18n-pas-un-dictionnaire': () => `the content must be a dictionary of keys (object), not a list, a number, a text or null`,
  'bundler.index.i18n-langue-invalide': ({ langue, chemin }: MsgVars) => `[bundler] i18n: invalid language name '${langue}' (${chemin}) — expected a language tag such as fr, en, pt-BR or zh_Hant. Rename this file or folder, or move it out of i18n/.`,
  'bundler.index.i18n-dossier-absent': ({ dossier }: MsgVars) => `[bundler] i18n: config.i18n is set but '${dossier}' is missing — no i18n dictionary will be emitted.`,
  'bundler.index.i18n-default-manquant': `[mjs.config.json] i18n/ present: specify i18n.default in mjs.config.json`,
  'bundler.index.i18n-section-invalide': ({ section, chemin }: MsgVars) => `[bundler] i18n: invalid section name '${section}' (${chemin}) — must match /^[a-z0-9_-]+$/`,
  'bundler.index.i18n-sortie-dans-sources': ({ dossier, sources }: MsgVars) => `[bundler] i18n: the output folder leads to the folder of your translations (${sources}) — the translation fragments would be written to '${dossier}': every build would rewrite your files there, and its fragments would be read back as sections. Nothing was written to your translations; give outputDir a folder distinct from sourceDir (e.g. public/modularjs).`,
  'bundler.index.manifeste-fichier-auteur': ({ chemin }: MsgVars) => `[bundler] The manifest (manifestPath) would replace a file that already exists and was not produced by ModularJS: ${chemin}. It may be one of your files. Nothing was written.\nChoose another manifestPath, or rename or move this file; if it comes from a build by an earlier version, delete it and build again.`,
  'bundler.index.sorties-fichiers-auteur': ({ nb, fichiers, sources, marque, cle, avant, raison }: MsgVars) => `[bundler] The build writes into the source folder (${sources}) and would replace ${nb === 1 ? 'a file that already exists and' : `${nb} files that already exist and`} ${raison === 'forme' ? (nb === 1 ? 'does not have the shape of the one it writes under this name' : 'do not have the shape of the ones it writes under these names') : raison === 'les-deux' ? `carry neither the mark of the files it produces (first line ${marque}, "${cle}" key of mjs-precache.json) nor the shape of the ones it writes under these names` : `${nb === 1 ? 'does not carry' : 'do not carry'} the mark of the files it produces (first line ${marque}, "${cle}" key of mjs-precache.json)`}: ${nb === 1 ? 'it may be one of your files' : 'they may be your files'}. ${avant ? 'Nothing was written.' : nb === 1 ? 'This file was not replaced.' : 'These files were not replaced.'}${fichiers}\nRename or move ${nb === 1 ? 'this file' : 'these files'}, or make the build write elsewhere (outputDir, manifestPath); if ${nb === 1 ? 'it comes' : 'they come'} from a build by an earlier version, delete ${nb === 1 ? 'it' : 'them'} and build again.`,
  'bundler.index.registre-theme-garde': ({ chemin }: MsgVars) => `[bundler] ${chemin} was not removed: a production build does not publish the theme variable registry, and this file does not have the shape of the one ModularJS writes under this name. It may be one of your files; if it comes from a development build, delete it.`,
  'bundler.index.i18n-source-langue-inconnue': ({ langue }: MsgVars) => `[mjs.config.json] i18n.source is '${langue}' but no dictionary for this language exists in i18n/`,
  'bundler.index.i18n-source-scellee': ({ fichier }: MsgVars) => `[bundler] i18n: '${fichier}' carries a __source — the source language is never sealed, key removed`,
  'bundler.index.i18n-source-introuvable': ({ fichier, langue }: MsgVars) => `[bundler] i18n: '${fichier}' rejected — no matching source '${langue}', dictionary not emitted`,
  'bundler.index.i18n-empreinte-absente': ({ fichier, attendu }: MsgVars) => `[bundler] i18n: '${fichier}' rejected — __source missing, expected fingerprint: ${attendu}`,
  'bundler.index.i18n-fragment-collision': ({ empreinte }: MsgVars) => `[bundler] i18n: two different translation fragments share the same full fingerprint (${empreinte}) — slightly change one of the two texts`,
  'bundler.index.i18n-empreinte-perimee': ({ fichier, attendu }: MsgVars) => `[bundler] i18n: '${fichier}' rejected — __source stale, expected fingerprint: ${attendu}`,
  'bundler.index.watch-erreur': '💥 [mjs watch] watcher error:',
  'bundler.index.watch-deja-actif': () => `[bundler] watch() is already running on this Bundler: call close() before starting another one.`,
  'bundler.index.watch-recompilation': ({ fichier }: MsgVars) => `\n⚡ ${fichier} — recompiling...`,
  'bundler.index.watch-build-initial': `\n⚡ Initial build...`,
  'bundler.index.watch-build-termine': ({ ecrits, duree, erreurs }: MsgVars) => `✅ ${ecrits} file${Number(ecrits) === 1 ? '' : 's'} in ${duree}ms (errors: ${erreurs})`,
  'bundler.index.watch-recompilation-echouee': '💥 [mjs watch] recompile failed:',
  'bundler.index.watch-watching': ({ chemins }: MsgVars) => `👀 Watching ${chemins}...`,
  'bundler.index.esm-check-ni-esm-ni-script': ({ filename, line, col, erreur, src }: MsgVars) => `[bundler/esm-check] ${filename}${line ? `:${line}:${col}` : ''} — ${erreur} (neither ESM module nor classic script)\n  ${src}`,
  // wording generalized: the pattern isn't always a literal
  // <script> anymore (encoded entity, SMIL injection, <foreignObject>/<iframe> embedding another
  // origin) — "executable"/"Remove the script" no longer accurately described every case.
  'bundler.index.svg-script-refuse': ({ fichier, motif }: MsgVars) => `[bundler] ${fichier}: SVG rejected — contains ${motif}, dangerous if the file is served directly (top-level navigation, <object>, <iframe>) or via <img>. Remove this content before referencing it via µasset()/µimage()/<@@img>.`,
  'bundler.index.svg-entite-hors-plage': ({ fichier, entite }: MsgVars) => `[bundler] ${fichier}: SVG rejected — the entity ${entite} points to a character outside the Unicode range. Fix or remove this entity.`,
  'bundler.index.mangle-cache-ecarte': ({ fichier, cles }: MsgVars) => `[bundler] ${fichier}: entries discarded (value that is not a string, or a short name held by several properties, for example after a git merge): ${cles}. They will be recomputed by this build.`,
  // <@nom> shortcut (resolveTagShortcuts) ; UNIQUE notation (project
  // THEN core resolution), <@mjs-nom> removed (tag-raccourci-mjs-retire)
  'bundler.index.tag-nom-reserve': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier}: '${nom}' is a RESERVED ModularJS tag (<@${nom}>) — a component (basename or short alias) cannot claim this name. Rename the file.`,
  'bundler.index.tag-nom-core-prefixe': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier}: '${nom}' starts with 'core-', a prefix RESERVED for core modules (tag <mjs-core-name>, written <@@name>) — a project component (basename or short alias) cannot use it. Rename the file.`,
  'bundler.index.tag-nom-mjs-prefixe': ({ fichier, nom, propre }: MsgVars) => `[bundler] ${fichier}: '${nom}' starts with 'mjs-', a prefix RESERVED for the framework — a component's tag is ALREADY 'mjs-<file name>' (this one would give <mjs-${nom}>), and every 'mjs-*' attribute is reserved for internals. Rename the file to '${propre}.mjs': its tag will be <mjs-${propre}>.`,
  // short alias (shortName) colliding with a reserved/core- name: dropped + warning (never blocking, unlike the basename)
  'bundler.index.tag-alias-reserve-ignore': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier}: the short alias '${nom}' is ignored — reserved name; the component remains usable by its full name.`,
  'bundler.index.tag-raccourci-mjs-retire': ({ fichier, nom, forme }: MsgVars) => `[bundler] ${fichier}: "<@mjs-${nom}>" has been removed — write "${forme}" (<@name> for a project component, <@@name> for a core module).`,
  'bundler.index.tag-coeur-litteral-inconnu': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier}: <mjs-core-${nom}>: no "${nom}" core module — the mjs-core- prefix is reserved for core modules (written <@@name>).`,
  'bundler.index.tag-coeur-inconnu': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier}: "<@@${nom}>": no "${nom}" core module.`,
  'bundler.index.tag-coeur-est-projet': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier}: "<@@${nom}>": no "${nom}" core module — the project component is written "<@${nom}>".`,
  'bundler.index.tag-coeur-reservee': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier}: "<@@${nom}>": a language tag is written with a single @ — "<@${nom}>".`,
  'bundler.index.tag-coeur-sans-arobase': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier}: "<@${nom}>": no "${nom}" component in the project. The core module is written with two @: "<@@${nom}>".`,
  'bundler.index.tag-litteral-coeur-migration': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier}: <mjs-${nom}>: no "${nom}" component in the project. The core module is written "<@@${nom}>" (tag <mjs-core-${nom}>).`,
  'bundler.index.tag-dev-inconnu': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier}: unknown tag <@${nom}> — neither a language tag nor a project component.`,
  'bundler.index.tag-suggestion': ({ nom, nature }: MsgVars) => {
    const label = nature === 'coeur' ? 'core module' : nature === 'reservee' ? 'reserved tag' : 'project component'
    return ` Did you mean <${nature === 'coeur' ? '@@' : '@'}${nom}> (${label})?`
  },
  'bundler.index.tag-litteral-dev-inconnue': ({ fichier, tag }: MsgVars) => `[bundler] ${fichier}: <${tag}> does not match any compiled component (neither basename nor short alias) — inert tag at runtime if it's a typo on a project component.`,
  'bundler.index.tag-sans-prefixe': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier}: <${nom}> is written without a prefix — the browser binds it to no component, it stays empty. For the project's ${nom} component, write <mjs-${nom}> or <@${nom}>.`,
  // ambiguous short alias: two components claim it, nobody publishes it (claimShortName,
  // kind 'poisoned') — the short tag is never registered, it stays inert
  'bundler.index.tag-alias-ambigu': ({ fichier, tag, sources, premier }: MsgVars) => `[bundler] ${fichier}: <${tag}> — ambiguous alias: ${sources} compete for this shortcut, none publishes it (tag never registered, inert at runtime). Write the full tag instead, e.g. <mjs-${premier}>.`,
  // variants — literal layout="x"/template="x" whose name isn't a known
  // <style name="…"> layout of the targeted module (parser/index.ts, TagRef.layoutLiteral)
  'bundler.index.tag-layout-litteral-inconnue': ({ fichier, tag, nom, connus }: MsgVars) => `[bundler] ${fichier}: <${tag} layout="${nom}"> — unknown variant '${nom}' for this component (known: ${connus}). Fix the typo or add <style name="${nom}"> to this component.`,
  // <@@chart>: values written on the tag (bundler/core-chart.ts) — an unknown word, a refused color, an impossible combination
  'bundler.index.chart-mot-inconnu': ({ fichier, tag, attribut, valeur, mot, connus }: MsgVars) => `[bundler] ${fichier}: <${tag} ${attribut}="${valeur}"> — "${mot}" is not a known value of ${attribut} (known values: ${connus}). Fix the typo.`,
  'bundler.index.chart-couleur-refusee': ({ fichier, tag, couleur, teintes }: MsgVars) => `[bundler] ${fichier}: <${tag} series={…}> — the color "${couleur}" is refused: write a theme hue name (${teintes}), an integer of 1 or more (past 6, the hues start over) or a CSS color the browser can read, without ";", ":", quote, brace, "<", ">", "\\", "/*" or url(…).`,
  'bundler.index.chart-sans-statistiques': ({ fichier, tag, forme, valeur, mots, formes, tendance }: MsgVars) => `[bundler] ${fichier}: <${tag} shape="${forme}" stats="${valeur}"> — the ${forme} shape does not draw stats "${mots}" (shapes that draw statistics: ${formes}; trend: ${tendance}). Remove "${mots}" from stats or change the shape.`,
  'bundler.index.chart-combinaison': ({ fichier, tag, forme, attribut, valeur, connus }: MsgVars) => `[bundler] ${fichier}: <${tag} shape="${forme}" ${attribut}="${valeur}"> — ${attribut}="${valeur}" does not go with the ${forme} shape (possible values: ${connus}).`,
  'bundler.index.coeur-attribut-camel': ({ fichier, tag, attribut, kebab, minuscules }: MsgVars) => `[bundler] ${fichier}: <${tag} ${attribut}=…> — write ${kebab}: HTML lowercases attribute names, and ${attribut} written as is would arrive as ${minuscules}, ignored.`,
  'bundler.index.chart-fuseau-inconnu': ({ fichier, tag, valeur }: MsgVars) => `[bundler] ${fichier}: <${tag} timezone="${valeur}"> — "${valeur}" is not a known time zone: write local (the visitor's screen time) or the name of an IANA zone (Europe/Paris, America/New_York, UTC…), or remove timezone to show the hours as they are written.`,
  'bundler.index.chart-decimales': ({ fichier, tag, ecrit, valeur }: MsgVars) => `[bundler] ${fichier}: <${tag} ${ecrit}> — decimals expects a whole number from 0 to 10, the number of digits after the decimal point: "${valeur}" does not fit.`,
  'bundler.index.chart-radar-axes': ({ fichier, tag, nb }: MsgVars) => `[bundler] ${fichier}: <${tag} shape="radar" rows={…}> — a radar needs at least 3 rows, one per axis: ${nb} written.`,
  // — minify.ts
  'bundler.minify.label-acces-indexe': "indexed access `obj['_mjs_X']`",
  'bundler.minify.label-acces-template': 'template literal access `obj[`_mjs_${...}`]`',
  'bundler.minify.label-define-property': "Object.defineProperty(*, '_mjs_X', ...) — string not mangled",
  'bundler.minify.label-reflect': "Reflect.X(*, '_mjs_X', ...) — string not mangled",
  'bundler.minify.label-concat': "concatenation `'_mjs_' + X` — name built at runtime",
  'bundler.minify.label-in': "`'_mjs_X' in obj` test — string not mangled",
  'bundler.minify.label-has-own': "`Object.hasOwn(*, '_mjs_X')` / `hasOwnProperty.call(*, '_mjs_X')` test — string not mangled",
  'bundler.minify.label-cle-guillemets': "quoted object key `{ '_mjs_X': … }` — string not mangled",
  'bundler.minify.mjs-prop-access-invalide': ({ fichier, ligne, label, contenu }: MsgVars) => `[bundler/minify] ${fichier}:${ligne} — ${label}\n  → ${contenu}\n  \`_mjs_*\` properties are mangled by esbuild via mangleCache for cross-file consistency.\n  An indirect access does NOT participate in mangling → runtime crash.\n  Fix: use dotted notation (\`obj._mjs_X\`) instead of string access.`,
  // — worker-pool.ts
  'bundler.worker-pool.worker-sorti': ({ code }: MsgVars) => `WorkerPool: worker exited with code ${code}`,
  'bundler.worker-pool.deja-termine': `WorkerPool: already terminated`,
  'bundler.worker-pool.aucun-worker-vivant': `WorkerPool: no worker alive (pool needs recreating)`,
  'bundler.worker-pool.erreur-inconnue': `worker: unknown error`,
  'bundler.worker-pool.plus-aucun-worker': ({ message }: MsgVars) => `WorkerPool: no worker alive anymore (${message})`,
  'bundler.worker-pool.terminate-queue': `WorkerPool: terminate() during queued task`,
  'bundler.worker-pool.terminate-inflight': `WorkerPool: terminate() during in-flight task`,
  'bundler.worker-pool.worker-ts-introuvable': ({ chemin }: MsgVars) => `[worker-pool] worker.ts not found: ${chemin}`,
  // maximum delay per dispatched task
  'bundler.worker-pool.tache-timeout': ({ fichier, ms }: MsgVars) => `WorkerPool: task '${fichier}' got no response after ${ms}ms — worker removed from pool`,
  // — worker.ts
  'bundler.worker.parent-port-manquant': `worker.ts must be run inside a Worker (parentPort missing)`,
  // — fx-sections.ts
  'bundler.fx-sections.section-sans-ouverture': ({ fichier }: MsgVars) => `[bundler] ${fichier}: a section is closed without having been opened`,
  'bundler.fx-sections.section-non-fermee': ({ fichier }: MsgVars) => `[bundler] ${fichier}: a marked section is not closed`,
  'bundler.fx-sections.etiquette-illisible': ({ fichier, jeton }: MsgVars) => `[bundler] ${fichier}: the label "${jeton}" of a section cannot be read — write a setting, setting=value, effect.setting or *effect`,
  // — core-sections.ts
  'bundler.core-sections.section-sans-ouverture': ({ fichier }: MsgVars) => `[bundler] ${fichier}: a core-module mark closes a section that was never opened`,
  'bundler.core-sections.section-non-fermee': ({ fichier }: MsgVars) => `[bundler] ${fichier}: a core-module mark opens a section that is not closed (or closes it in another language)`,
  'bundler.core-sections.etiquette-illisible': ({ fichier, jeton }: MsgVars) => `[bundler] ${fichier}: the label "${jeton}" of a core-module mark cannot be read — write an attribute name, !attribute or dev attribute`,
  // — hologram-motifs.ts
  'bundler.hologram-motifs.image-introuvable': ({ motif, dossier }: MsgVars) => `[bundler] the image of the "${motif}" pattern of *hologram is missing from ${dossier}`,
  // — hologram-styles.ts
  'bundler.hologram-styles.appel-sans-style': ({ fichier, noms }: MsgVars) => `[bundler] ${fichier}: "style('${noms}'" is kept with no style requested`,
  'bundler.hologram-styles.style-sans-section': ({ fichier, style }: MsgVars) => `[bundler] ${fichier}: the style "${style}" has no section`,

  'bundler.theme-nom-fichier': ({ nom, fichier }: MsgVars) => `[ModularJS] ${fichier}: "${nom}" is not a valid theme name — lowercase letters, digits and dashes only (the file name IS the theme name: dark.theme.mjs gives the "dark" theme).`,
  'bundler.theme-fichier-sans-bloc': ({ fichier }: MsgVars) => `[ModularJS] ${fichier}: no <theme> block — a theme file contains nothing else.`,
  'bundler.theme-fichier-impur': ({ fichier, quoi }: MsgVars) => `[ModularJS] ${fichier} contains ${quoi} — a theme file only contains a <theme> block: it declares variables, it renders nothing. For style or markup, write a component.`,
  'bundler.theme-fichier-multi': ({ fichier }: MsgVars) => `[ModularJS] ${fichier} contains several <theme> blocks — one file, one theme. For a second theme, use a second file.`,
  // *.types.mjs files (bundler/types-files.ts)
  'bundler.types-fichier-sans-bloc': ({ fichier }: MsgVars) => `[ModularJS] ${fichier}: no <types> block — a *.types.mjs file declares its named rules in a <types> block (e.g. Percent  int 0..100).`,
  'bundler.types-fichier-multi': ({ fichier }: MsgVars) => `[ModularJS] ${fichier} contains several <types> blocks — one block per file.`,
  'bundler.types-fichier-impur': ({ fichier, quoi }: MsgVars) => `[ModularJS] ${fichier}: a *.types.mjs file only holds its <types> block (and comments) — ${quoi} does not belong there.`,
  'bundler.types-nom-double': ({ nom, fichier1, fichier2 }: MsgVars) => `[ModularJS] the rule "${nom}" is declared twice: ${fichier1} and ${fichier2} — one name per app.`,
  'bundler.types-store-conflit': ({ store, regle1, fichier1, regle2, fichier2 }: MsgVars) => `[ModularJS] the store $$${store} has two different rules: "${regle1}" (${fichier1}) and "${regle2}" (${fichier2}) — a store is app-wide, so is its rule: keep the same one everywhere, or declare it only once.`,
  'bundler.theme-fichier-name': ({ fichier, nom }: MsgVars) => `[ModularJS] ${fichier}: <theme name="${nom}"> — in a theme file the name comes from the FILE, not from the attribute. Remove name="${nom}" (or rename the file to ${nom}.theme.mjs). The name attribute is only for a variant inside a component.`,
  'bundler.page-nom-fichier-vide': ({ fichier }: MsgVars) => `[ModularJS] ${fichier}: empty page name — once the ".page" marker is stripped, nothing is left (the file name IS the component name: accueil.page.mjs gives 'accueil'). Rename the file.`,
  'bundler.page-marqueur-double': ({ fichier, reste, suggestion }: MsgVars) => `[ModularJS] ${fichier}: doubled ".page" marker — only one is stripped, "${reste}" still ends with ".page". Rename the file to '${suggestion}'.`,
  'bundler.composant-nom-fichier': ({ nom, fichier, suggestion }: MsgVars) => `[ModularJS] ${fichier}: "${nom}" is not a valid component name — lowercase letters, digits and dashes only (the file name drives both the manifest key AND the <mjs-…> tag). Rename the file to '${suggestion}'.`,

  'bundler.variable-inconnue': ({ nom, lus }: MsgVars) => `[ModularJS] $$${nom} is read by ${lus}, but nobody declares it — no application theme, no component, not the framework. Most likely a typo: the value will be empty on screen. Declare it in a <theme>, or fix the name.`,
  'bundler.variable-partagee': ({ nom, modules }: MsgVars) => `[ModularJS] $$${nom} is declared by ${modules} — reminder: a theme variable belongs to nobody, it cascades. Each of these components imposes its value on its whole subtree; the closest one wins.`,
  'bundler.variable-effet-fondu': ({ nom, effet, alias, nouveau }: MsgVars) => `[ModularJS] $$${nom}: this theme variable is no longer read — *${effet} is now part of ${alias}; write $$${nouveau}.`,
  'bundler.variable-effet-fondu-sans': ({ nom, effet, alias }: MsgVars) => `[ModularJS] $$${nom}: this theme variable is no longer read — *${effet} is now part of ${alias}, which has no theme variable for this setting; write it on the tag.`,

  // ═══ COMPILATEUR (lexer/parser/generator/analyzer/transpiler/languages/schema) ═══════════

  // — src/lexer/index.ts —
  'lexer.hook-arobase-retire': ({ hook }: MsgVars) => `[ModularJS] "@${hook} ->": the @ form of hooks has been removed — write "µ${hook} ->" (lifecycle rune). The name "${hook}" remains free for your own methods ("@${hook} = ->").`,
  'lexer.crochet-inconnu': ({ nom, proche }: MsgVars) => `[ModularJS] "µ${nom}" is not a lifecycle hook: did you mean "µ${proche}"? The hooks are µmount, µawake, µsleep, µdestroy, µurlChange and µfailed.`,
  'parser.bloc-modele-nom': ({ ecrit, ligne }: MsgVars) => `[ModularJS] ${ecrit} line ${ligne}: a model (layout) name, or several separated by commas — {? timer}, {? chrono, minuteur}, {? default}.`,
  'parser.modele-fichier-calcule': ({ tag, nom, modeles, premier, ligne }: MsgVars) => `[ModularJS] <${tag}> line ${ligne}: ${nom} has models in their own file (${modeles}); a computed value goes between braces, without quotes — layout={$view}: the compiler puts the tag of the chosen model. Literally: layout="${premier}".`,
  'bundler.modele-default': ({ fichier }: MsgVars) => `[ModularJS] ${fichier}: "default" is the base model (the component itself, the one of {? default}) — give this model another name.`,
  'bundler.modele-sans-composant': ({ fichier, base }: MsgVars) => `[ModularJS] ${fichier}: a model of "${base}", but ${base}.mjs does not exist — a model file sits next to its component.`,
  'bundler.modele-double': ({ base, nom, fichier }: MsgVars) => `[ModularJS] ${base}: the model "${nom}" is both a file (${fichier}) and a named style (<style name="${nom}">) — keep one of the two.`,
  'lexer.mu-layout-ecrit': `[ModularJS] "µlayout" is read-only: the model is chosen on the component's tag (\`<@card layout="compact">\`, or \`layout={$x}\`).`,
  'lexer.mu-layout-module': `[ModularJS] "µlayout" outside a component's <script> (<script module>, imported module): this code is shared by every instance, and the chosen model belongs to one instance — read µlayout in the component's <script>, or pass it as an argument.`,
  'lexer.symbole-declare-civet': ({ varName, preview }: MsgVars) => `[ModularJS] "${varName} := ${preview}": ":=" is the Civet declaration operator, invalid on a $ symbol — write "${varName} = ${preview}" ($ symbols are auto-declared, ":=" is always superfluous there).`,
  'lexer.derived-expr-vide': ({ varName }: MsgVars) => `[ModularJS] "µderived $${varName} =": missing expression before the forced dependency list.`,
  'lexer.derived-dep-invalide': ({ varName, dep }: MsgVars) => `[ModularJS] "µderived $${varName} = …, ${dep}": each forced dependency must be a bare $ symbol (e.g. $a), got "${dep}".`,

  // — src/parser/index.ts —
  'parser.nom-reserve': ({ ligne, bloc, nom, alt, listeNoms }: MsgVars) => `

🚨 [RESERVED NAME] Line ${ligne}, \`{${bloc}}\` block: the name \`${nom}\` is used
   internally by the JS code generated by ModularJS. Choosing it as a
   template variable causes a silent collision at runtime.
👉 Rename this variable (e.g.: \`${nom}\` → \`${alt}\`).
   Reserved names: ${listeNoms}

`,
  'parser.symbole-reserve-template': ({ ligne, nom, kind }: MsgVars) => `[ModularJS] line ${ligne}: "${nom}" is a framework symbol — $ (state), $$ (store), µ (runtime) — it cannot name a variable of a {${kind}} block. Rename it (for instance "item").`,
  'parser.astuce-if-ternaire': `Tip: for an inline ternary (a value, not a block), use\n   the JS syntax \`{cond ? a : b}\` — an interpolation \`{…}\` is JS;\n   otherwise close the \`{if …}\` block with \`{end}\`.`,
  'parser.astuce-bloc-modele-end': `Tip: a {? name} block is closed by {end}; inside it, another {? name} opens the next branch and {else} the one for the other models.`,
  'parser.astuce-for-end': `Tip: each \`{for item in list}\` must be closed by \`{end}\` on a separate line.`,
  'parser.astuce-await-end': `Tip: each \`{await promise}\` must be closed by \`{end}\` (after \`{success}\` / \`{error}\`).`,
  'parser.astuce-key-end': `Tip: \`{key expr}\` delimits a subtree recreated when \`expr\` changes; it must be closed by \`{end}\`.`,
  'parser.chaine-non-fermee': ({ ligne, quote, extrait }: MsgVars) => `

🚨 [UNCLOSED STRING] The string opened by \`${quote}\` at line ${ligne} is never closed.
   End of file reached: all the HTML that follows was swallowed by the expression.
👉 Close the string. Careful, \`\\\\\` is a LITERAL backslash: it does not escape the
   quote that follows it (\`'c:\\\\'\` closes the string, \`'c:\\'\` does not).
   Swallowed from: ${extrait}

`,
  'parser.delimiteur-non-ferme': ({ ligne, ouvrant, fermant, extrait }: MsgVars) => `

🚨 [UNCLOSED EXPRESSION] \`${ouvrant}\` opened at line ${ligne} has no matching \`${fermant}\`.
   End of file reached: all the HTML that follows was swallowed by the expression.
👉 Close the expression with \`${fermant}\` (a literal brace is written \`&#123;\`).
   Swallowed from: ${extrait}

`,
  'parser.fermeture-bloc-slash': ({ ecrit, ligne }: MsgVars) => `[ModularJS] line ${ligne}: "${ecrit}" does not exist in ModularJS — a block ({if}, {for}, {await}, {key}) is closed with {end}. Replace "${ecrit}" with {end}.`,
  'parser.squelette-attente-ecrite': ({ ligne }: MsgVars) => `[ModularJS] line ${ligne}: {await … *skeleton} — the pending branch is already written (before {success}): the skeleton would replace it. Keep one or the other.`,
  'parser.squelette-sans-success': ({ ligne }: MsgVars) => `[ModularJS] line ${ligne}: {await … *skeleton} — the skeleton is drawn from the {success name} branch: write it.`,
  'parser.squelette-svg': ({ balise, ligne }: MsgVars) => `[ModularJS] line ${ligne}: {await … *skeleton} inside <${balise}> — the skeleton is HTML and has no place inside <${balise}>. Write the pending branch yourself (before {success}), or put the whole <${balise}> inside the {await}.`,
  'parser.bloc-non-ferme': ({ kind, expr, ligne, astuce }: MsgVars) => `

🚨 [UNCLOSED BLOCK] \`{${kind} ${expr}}\` opened at line ${ligne} has no matching \`{end}\`.
   End of file reached before closing.
👉 ${astuce}

`,
  'parser.attribut-nu-non-supporte': ({ expr, ligne, tag }: MsgVars) => `🚨 [parser] bare \`{${expr}}\` (line ${ligne}): a lone \`{expr}\` is only an attribute on \`<@slot {…}>\` (evaluated slot name). On <${tag}>, write \`name={${expr}}\` (named attribute).`,
  'parser.const-syntaxe-invalide': ({ ligne }: MsgVars) => `🚨 [parser] invalid {const …} (line ${ligne}): expected syntax "{const NAME = EXPR}"`,
  'parser.const-expression-vide': ({ nom, ligne }: MsgVars) => `🚨 [parser] {const ${nom} = …} (line ${ligne}): empty expression.`,
  'parser.for-item-index-homonyme': ({ item, index, ligne }: MsgVars) => `[ModularJS] {for ${item}, ${index} in …} (line ${ligne}): the item and the index cannot share the same name "${item}".`,
  'parser.for-syntaxe-invalide': ({ expr, ligne, astuceOf }: MsgVars) => `🚨 [parser] invalid {for ${expr}} (line ${ligne}): expected syntax "{for [idx,] item in list [by key]}"${astuceOf}`,
  'parser.for-astuce-in-pas-of': ` — use "in", not "of"`,
  // JSX/Svelte habit: `{else if cond}` isn't recognized by `{elsif ...}`
  // nor `{else}` (both strict) → fell through as a raw Civet expression,
  // cryptic error far from the real cause.
  'parser.else-if-non-supporte': ({ expr, ligne }: MsgVars) => `🚨 [parser] {${expr}} (line ${ligne}): \`{else if …}\` doesn't exist in MJS — use \`{elsif …}\`.`,
  'parser.erreur-fatale': ({ extrait }: MsgVars) => `

🚨 [FATAL PARSING ERROR]
The ModularJS compiler is stuck on invalid syntax or an illegal character.
Offending excerpt: ${extrait}
👉 Diagnosis: the lexical analyzer cannot consume the string.

`,
  'parser.balise-fermante-orpheline': ({ nom, ligne }: MsgVars) => `

🚨 [ORPHAN CLOSING TAG] \`</${nom}>\` line ${ligne}: no matching opening tag.
   Without an error, all the template following this tag would be silently ignored.
👉 Remove this extra closing tag, or add the missing opening tag.

`,
  // symmetrical to parser.balise-fermante-orpheline, for a FLOW TOKEN ({end}, {else}, {elsif …},
  // {success …}, {error …}) left over at the root, instead of an HTML tag — same risk
  // (following content silently lost).
  'parser.jeton-flux-orphelin': ({ jeton, ligne }: MsgVars) => `

🚨 [ORPHAN TOKEN] \`${jeton}\` line ${ligne}: no opening block ({if}/{for}/{await}/{key}) to close.
   Without an error, all the template following this token would be silently ignored.
👉 Remove this extra ${jeton}, or add the missing opening block.

`,
  // same token at the very end of the template: nothing is lost, warning only (often a block
  // closed twice)
  'parser.jeton-flux-orphelin-fin': ({ jeton, ligne }: MsgVars) => `[ModularJS] ⚠️  \`${jeton}\` line ${ligne}: no opening block ({if}/{for}/{await}/{key}) to close — extra token at the end of the template, no effect. Check your block nesting.`,
  // call stack exhausted by a template nested thousands of levels deep (parsing or generation)
  'parser.imbrication-trop-profonde': ({ ligne }: MsgVars) => `

🚨 [NESTING TOO DEEP] around line ${ligne}: the template is nested too many levels deep
   (tags inside tags, or {if}/{for}/{await}/{key} blocks inside other blocks) and the build ran out of call stack.
👉 Reduce the nesting to a few hundred levels at most, for example by splitting this part into components.

`,
  // branch token inside a block that does not expect it (`{else}` in a `{for}`, `{success …}` in an `{if}`) or
  // inside a tag: its content merged into the block, silently
  'parser.jeton-flux-hors-bloc': ({ jeton, bloc, ligneBloc, ligne }: MsgVars) => `

🚨 [TOKEN OUTSIDE ITS BLOCK] \`${jeton}\` line ${ligne} has no meaning inside \`${bloc}\` (opened line ${ligneBloc}).
   {else} and {elsif …} only follow an {if}, {success …} and {error …} only an {await}: without an error, its content would merge into the block.
👉 Close \`${bloc}\` first, or move this token into the block that expects it.${bloc === '{for}' && jeton === '{else}' ? ' For an empty list, wrap the {for} in an {if $list.length}…{else}…{end}.' : ''}

`,
  'parser.for-by-chemin': ({ expr, cle, champ, ligne }: MsgVars) => `🚨 [parser] {for ${expr}} (line ${ligne}): "by ${cle}" — by expects the name of a field of the item, with no prefix or expression, like "by ${champ}".`,
  // opening tag with neither `>` nor `/>` (most often on the last line): it disappeared from the component
  'parser.balise-ouvrante-non-terminee': ({ nom, ligne }: MsgVars) => `

🚨 [UNTERMINATED TAG] \`<${nom}\` opened at line ${ligne} is never ended by \`>\`.
   Without an error, this tag and its content would disappear from the component.
👉 Add the \`>\` (or \`/>\`) that ends the opening tag.

`,
  'parser.view-auto-fermeture-interdite': ({ nom, ligne }: MsgVars) => `🚨 [parser] <@view${nom ? ' ' + nom : ''}/> (line ${ligne}): self-closing not allowed — <@view> receives its content from the router at runtime, write <@view${nom ? ' ' + nom : ''}></@view>.`,
  // Fill block <@fill name>…</@fill> (PROVISIONAL name, see FILL_DIRECTIVE): the 6 messages
  // below all take `directive` (never a hardcoded "fill") and the `ligne` of the offending node.
  'parser.fill-sans-nom': ({ directive, ligne }: MsgVars) => `🚨 [parser] <@${directive}> without a name (line ${ligne}): the slot block requires a literal name, like <@slot name> — write <@${directive} name>…</@${directive}>.`,
  'parser.fill-nom-dynamique': ({ directive, expr, ligne }: MsgVars) => `🚨 [parser] <@${directive} {${expr}}> (line ${ligne}): dynamic name rejected — the slot block requires a LITERAL name (bare identifier), like <@slot name>.`,
  // A second attribute (extra name, `class=`, `{...$rest}`…) was silently dropped
  // by expandFillBlock; `extrait` mirrors the attributes AS WRITTEN (describeFillAttr).
  'parser.fill-un-seul-nom': ({ directive, ligne, extrait }: MsgVars) => `🚨 [parser] <@${directive} …> (line ${ligne}): one slot name, nothing else — "${extrait}"`,
  'parser.fill-texte-nu': ({ directive, nom, ligne }: MsgVars) => `🚨 [parser] bare text inside <@${directive} ${nom}> (line ${ligne}): text cannot target a named slot — wrap it in an element (e.g. <span slot="${nom}">…</span>).`,
  'parser.fill-slot-deja-pose': ({ directive, nom, tag, ligne }: MsgVars) => `🚨 [parser] <${tag} slot="…"> (line ${ligne}): this child of <@${directive} ${nom}> already carries its own slot= — remove one of the two.`,
  'parser.fill-imbrique': ({ directive, ligne }: MsgVars) => `🚨 [parser] nested <@${directive}> (line ${ligne}): a <@${directive}> block cannot contain another one — split them into direct children of the called component.`,
  // Closing tag that does NOT match the most recently opened tag — WARNING only (never an
  // error, so no existing site breaks): respects HTML's legitimate implicit closes
  // (cf. IMPLICIT_CLOSE_TAGS, parser/index.ts), otherwise the expected tag really was left open.
  'parser.fermeture-mal-appariee': ({ attendu, trouve, ligneOuverture, ligneFermeture }: MsgVars) => `[ModularJS] ⚠️  <${attendu}> opened line ${ligneOuverture} is not closed by </${attendu}>: </${trouve}> found line ${ligneFermeture} instead. Check the tag nesting.`,
  // `{{expr}}` (raw HTML, docs/07-bindings.md) requires TWO closing braces. Only one
  // (`{{value}`) is not a documented form: an ERROR rather than a silently truncated raw HTML.
  'parser.html-brut-mal-ferme': ({ ligne }: MsgVars) => `

🚨 [INCOMPLETE DOUBLE BRACE] \`{{…}\` line ${ligne}: only one closing brace found.
   The raw HTML interpolation \`{{ expr }}\` requires TWO closing braces.
👉 Add the missing brace (\`{{expr}}\`), or write \`&#123;\` for a literal \`{\`.

`,

  // — src/generator/compile.ts —
  'generator.const-hors-for': ({ nom, expr }: MsgVars) => `
🚨 [ModularJS] {const ${nom} = …} outside a {for} is not supported.
   At the root level, declare a reactive derived value in <script> instead:
   \`$${nom} = ${expr}\`  (auto-derived), then read \`{$${nom}}\`.
   Local {const} remains reserved for {for} blocks (Svelte {@const} case).
`,
  // STATIC attribute literally containing `#{…}` (Civet interpolation,
  // reserved for <script>): does NOT interpolate, warning only (never blocking).
  'generator.interpolation-civet-attribut': ({ module, attr, valeur, ligne }: MsgVars) => `[ModularJS] ${module}${ligne ? ` (line ${ligne})` : ''}: attribute "${attr}" — "#{ … }" is not attribute interpolation: the "#" will show up as-is before the value (${valeur}). Write { … } without "#"; #{ } only exists in the Civet <script>.`,
  'generator.attribut-booleen-false': ({ module, balise, attr, ligne }: MsgVars) => `[ModularJS] ${module}${ligne ? ` (line ${ligne})` : ''}: <${balise} ${attr}="false"> keeps "${attr}" on — for an HTML boolean attribute, its mere presence means true, whatever the written value. Remove the attribute, or bind it to a value: ${attr}={false}.`,
  'generator.diese-dans-le-html': ({ module, extrait, ligne }: MsgVars) => `[ModularJS] ${module}${ligne ? ` (line ${ligne})` : ''}: "${extrait}" — outside the <script>, a "#" at the start of a line is not a comment: this text shows on screen. A comment in the HTML is written <!-- … -->.`,

  // — src/generator/paths.ts —
  'generator.extract-paths-boucle-infinie': ({ i, len, extrait }: MsgVars) => `[ModularJS] extractPaths: infinite loop detected (index stuck at ${i}/${len}). HTML likely malformed near: ${extrait}`,
  'generator.create-fn-body-boucle-infinie': ({ i, len, extrait }: MsgVars) => `[ModularJS] generateCreateFnBodyImperative: infinite loop detected (index stuck at ${i}/${len}). HTML likely malformed near: ${extrait}`,

  // — src/generator/utils.ts —
  'generator.hook-cycle-vie-interpolation': ({ nom }: MsgVars) => `[ModularJS] "µ${nom}": lifecycle hooks are declared in the component's <script>, not in a {…} interpolation or a handler.`,
  // (src/generator/utils.ts:312 reuses 'lexer.symbole-declare-civet' — twin guard, identical text)
  // (also reused by src/transpiler/index.ts:2062)
  'generator.every-hors-script': `[ModularJS] "µevery": declared in the component's <script> (root level), not in a {…} interpolation or a handler.`,
  'generator.derived-hors-script': `[ModularJS] "µderived": declared in the component's <script> (root level), not in a {…} interpolation or a handler.`,
  'generator.hint-ternaire-colle': ` Hint: glued ternary "a?b:c" detected — add spaces ("a ? b : c"); the Coffee existential operator "a ? b" (without ":") is written "a ?? b" in Civet.`,
  'generator.hint-dans-module': ({ moduleName }: MsgVars) => ` in "${moduleName}"`,
  'generator.interpolation-echec-civet': ({ moduleHint, rawExprForError, civetMsg, gluedTernaryHint }: MsgVars) => `[ModularJS] interpolation: Civet compilation failed${moduleHint} — "${rawExprForError}" — ${civetMsg}${gluedTernaryHint}`,

  // — src/generator/attributes/index.ts —
  'generator.this-sans-point-exclamation': ({ expr }: MsgVars) => `[ModularJS] "@this={${expr}}": a node reference is written with an exclamation mark, write @this=!{${expr}}. Without it, @this would be read as a listener for an event named "this", and ${expr} would never receive the node. See docs/09-directives-dom.md.`,
  'generator.this-sans-reference': ({ ecrit, ref }: MsgVars) => `[ModularJS] ${String(ecrit).includes('"') ? `'${ecrit}'` : `"${ecrit}"`}: a node reference is written @this=!{${ref}}, a variable in braces after an exclamation mark. Without it, @this would be read as a listener for an event named "this", and no variable would receive the node. See docs/09-directives-dom.md.`,
  'generator.preload-sans-valeur': () => `[ModularJS] "@preload" without a value: a link's preloading is set by a value, write @preload="hover" (on hover), @preload="on" (as soon as the link appears) or @preload="off" (never). Without a value, @preload would be read as a listener for an event named "preload", and nothing would be preloaded; to listen to such an event, write @preload={…}. See docs/17-router.md.`,
  'generator.this-ref-reactive': ({ varExpr, plain }: MsgVars) => `[mjs] @this=!{${varExpr}}: DOM reference bound to a REACTIVE variable "$". Every write (${varExpr}.style.x = …) then goes through reactivity (µ._mjs_deepSet cost). For a plain DOM reference, use a variable WITHOUT "$": @this=!{${plain}}. See docs/09-directives-dom.md.`,
  // literal emitted INSIDE the generated code (browser) — cf. risques §5, ${JSON.stringify(t(...))} at the call site
  'generator.erreur-intro': `[ModularJS] Intro error:`,
  'generator.echec-intro': `[ModularJS] Intro failed:`,
  'generator.hint-cast-suffixe-nom': ({ attrName, cast }: MsgVars) => ` For a type cast, the suffix goes on the attribute NAME: "${attrName}.${cast}=!{…}" (not "${attrName}=!.${cast}{…}").`,
  'generator.hint-syntaxe-two-way': ({ attrName }: MsgVars) => ` The syntax for a two-way binding is "${attrName}=!{expression}" (braces around the expression).`,
  'generator.liaison-two-way-malformee': ({ attrName, rawVal, hint }: MsgVars) => `[ModularJS] Malformed two-way binding: "${attrName}=${rawVal}".${hint}`,
  'generator.emit-forme-non-reconnue': ({ attrName }: MsgVars) => `[ModularJS] "${attrName}": unrecognized emit form — use @emit.EVENT_NAME={expr} or @emit.once.EVENT_NAME={expr}.`,
  'generator.emit-evenement-brut': ({ module, nomEvenement, ligne }: MsgVars) => `[ModularJS] ${module}${ligne ? ` (line ${ligne})` : ''}: "µemit '${nomEvenement}', e" relays the received EVENT, not its payload — the parent will read "e.data" on the CustomEvent and find undefined. Send "e.data" (or the intended expression), not "e" as-is.`,
  // "Emit on the gesture" sugar (@click.emit.NAME) + anti-typo guard on event modifiers —
  // both BLOCKING.
  'generator.event-emit-forme': ({ attrName, evt }: MsgVars) => `[ModularJS] "${attrName}": unrecognized emit-on-gesture form — write "@${evt}.emit.NAME" (with a payload: "@${evt}.emit.NAME={expr}"). The emitted name is the LAST segment: modifiers go before it ("@${evt}.stop.emit.NAME"), and that name may contain neither a dot nor a quote.`,
  'generator.event-modificateur-inconnu': ({ attrName, mod, hint }: MsgVars) => `[ModularJS] "${attrName}": ".${mod}" is not an event modifier — the only recognized ones are .prevent, .stop, .self, .once, .propagate, plus the .emit.NAME sugar.${hint} An event name cannot contain a dot either: the dot separates segments.`,
  'generator.attach-modificateur-inconnu': ({ attrName, mod, hint }: MsgVars) => `[ModularJS] "${attrName}": ".${mod}" is not an attach modifier — the only recognized one is .once (the factory is called only once per tag): write @attach.once={factory(args)}.${hint}`,
  'generator.hint-modificateur-suggestion': ({ suggestion }: MsgVars) => ` Did you mean ".${suggestion}"?`,
  'generator.macro-modificateur-non-gere': ({ evt, suffixe }: MsgVars) => `[ModularJS] "@${evt}.${suffixe}" on a global macro (<@window>/<@document>/<@body>/<@head>): modifiers and the emit sugar are NOT supported there — those listeners are attached directly, outside the delegated router. Write "@${evt}={…}" and call "µemit" in the body if you want to emit.`,
  'generator.event-deux-points-abrege': ({ evt }: MsgVars) => `[ModularJS] "@${evt}": shorthand form not allowed for a colon-namespaced event — write "@${evt}={…}" with the code to run. The shorthand calls the method named after the event, and "${evt}" cannot be a method name (the colon used to compile into a discarded object, without a single error).`,

  // — src/analyzer/index.ts —
  'analyzer.prefixe-mjs-reserve': ({ varName, nomCourt }: MsgVars) => `[ModularJS] ⚠️  $.${varName}: prefix '_mjs_' is reserved for the framework. Rename to $.${nomCourt} or similar to avoid a collision with internal props.`,
  'analyzer.effect-lit-ecrit-boucle': ({ liste }: MsgVars) => `[ModularJS] ⚠️  µeffect that READS and WRITES ${liste} — risk of a reactive loop (the effect re-triggers itself). Write to a DIFFERENT variable (e.g. $double = $n * 2), or guarantee convergence. Otherwise the runtime guard abandons the render.`,
  'analyzer.resolve-dependance-non-convergent': `[ModularJS] resolveDependencyGraph: >100 passes without convergence — dependency closure possibly incomplete (abnormally deep reactive graph).`,
  'analyzer.cycle-reactif-detecte': ({ func }: MsgVars) => `[ModularJS] Reactive cycle: '${func}' reads itself, directly or through another derived value — its value cannot be computed (undefined, NaN in arithmetic). For a computation done once at start, write \`$${func} =: …\`; otherwise, give the result another name.`,
  'transpiler.etat-premiere-lettre-accentuee': ({ nom, suggestion }: MsgVars) => `🚨 [ModularJS] \`${nom}\`: a reactive variable name starts with an unaccented letter (a-z, A-Z) or "_" — write \`${suggestion}\`.`,
  'analyzer.derived-hors-racine': `[ModularJS] "µderived" must be declared at the root level of the component's <script>, not inside a function.`,

  // — src/transpiler/directives.ts —
  'transpiler.i18n-double': ({ ancienneSection, section }: MsgVars) => `[ModularJS] duplicate @i18n: "${ancienneSection}" then "${section}" — only one \`@i18n\` per module; to ask for several sections, name them on the same line: @i18n 'a' 'b'.`,
  'transpiler.i18n-ligne-invalide': ({ ligne }: MsgVars) => `[ModularJS] @i18n: the line "${ligne}" is not in the form of the directive — write the sections between quotes, separated by spaces (no comma), alone on the line: @i18n 'accueil' 'onglets-admin'.`,
  'transpiler.form-associated-plusieurs-fois': ({ moduleName }: MsgVars) => `[ModularJS] ${moduleName}: @formAssociated is written more than once — one line is enough, remove the others.`,
  'transpiler.form-associated-ligne-invalide': ({ ligne }: MsgVars) => `[ModularJS] @formAssociated: the line "${ligne}" is not in the form of the directive — it takes no value, write @formAssociated alone on its line.`,
  'transpiler.i18n-section-ecrite-deux-fois': ({ section }: MsgVars) => `[ModularJS] @i18n: "${section}" is written twice — name each section only once.`,
  'transpiler.i18n-section-invalide': ({ section }: MsgVars) => `[ModularJS] @i18n: "${section}" is not a valid section name — lowercase letters, digits, hyphens and underscores only (e.g. @i18n 'panier').`,
  'i18n.attente-invalide': ({ ou, valeur, valides }: MsgVars) => `${ou}: "${valeur}" is not an allowed wait — allowed values: ${valides} (only loading effects are allowed).`,
  'i18n.attente-auto': ({ ou, exemple }: MsgVars) => `${ou}: "auto" no longer exists — write ${exemple} for the grey bars in place of each text (the former rendering). Without anything written, the module waits for its texts before it appears (wait).`,
  'i18n.attente-variable': ({ ou, effet, valeur }: MsgVars) => `${ou}: *${effet}(${valeur}) — settings are written as fixed values, for example *loader(bloom); a variable has nothing to follow here.`,
  'i18n.attente-reglage-sans-sens': ({ ou, effet, reglage, valides }: MsgVars) => `${ou}: *${effet}(${reglage}) — this setting makes no sense for texts: they are plain bars painted behind each text, without movement or rounding. Allowed setting: ${valides}.`,
  // shared with src/transpiler/index.ts:1348,1378 (identical text)
  'transpiler.vt-off-nexiste-pas': ({ label }: MsgVars) => `[ModularJS] ${label}: 'off' does not exist — bare form to activate, 'none' to disable.`,
  // shared with src/transpiler/index.ts:1349,1379 (identical text)
  'transpiler.vt-on-implicite': ({ label }: MsgVars) => `[ModularJS] ${label}: 'on' is implicit — write the bare directive to activate.`,
  // shared with src/transpiler/index.ts:1353 (identical text):
  // `example` is now OWNED by each caller, @pageTransition (link, STRING form) doesn't share the
  // same syntax as the 4 @viewTransition positions (DOT form) — one example for both was
  // misleading (@pageTransition.cube={...} doesn't exist)
  'transpiler.vt-direction-plus-dans-nom': ({ label, example }: MsgVars) => `[ModularJS] ${label}: direction is no longer written in the name — write ${example}.`,
  'transpiler.vt-nom-erreur-parsing': ({ label, nameAndDir, erreur }: MsgVars) => `[ModularJS] ${label}.${nameAndDir}: ${erreur}`,
  'transpiler.vt-ancienne-ecriture-remplacee': ({ label }: MsgVars) => `[ModularJS] ${label}: the old '${label} <name> [priority]' syntax has been replaced — write ${label}.<name>={ direction: …, duration: …, priority: … } (optional options).`,
  'transpiler.i18n-placeholder-wait-sans-section': ({ mode }: MsgVars) => `[ModularJS] @i18nPlaceholder ${mode}: requires an @i18n section to wait for — add @i18n 'name' (or use key or *skeleton, which don't depend on a section).`,
  // RELOCATION — @css/@display/@viewTransition/@vt leave the file root,
  // they're now attributes of <style> (cf. transpiler/sections.ts).
  'transpiler.css-racine-interdite': ({ ligne, remplacement }: MsgVars) => `[ModularJS] @css is no longer written at the file root: it's an attribute of <style>.\nReplace the line "${ligne}" with: ${remplacement}`,
  'transpiler.display-racine-interdite': ({ ligne, remplacement }: MsgVars) => `[ModularJS] @display is no longer written at the file root: it's an attribute of <style>.\nReplace the line "${ligne}" with: ${remplacement}`,
  'transpiler.viewtransition-racine-interdite': ({ label, ligne, remplacement }: MsgVars) => `[ModularJS] ${label} is no longer written at the file root: it's an attribute of <style>.\nReplace the line "${ligne}" with: ${remplacement}`,
  'transpiler.style-attr-sur-layout': ({ attribut, nom }: MsgVars) => `[ModularJS] ${attribut} is only valid on the base <style> (without name=) — found on <style name="${nom}">.`,
  'transpiler.viewtransition-guillemets-sur-style': ({ label }: MsgVars) => `[ModularJS] ${label}="…" with quotes no longer exists on <style> — write ${label}.<name>={ direction: …, duration: …, priority: … } (optional options).`,
  'transpiler.viewtransition-forme-invalide-sur-style': ({ label, rest }: MsgVars) => `[ModularJS] ${label}${rest} on <style>: invalid form — write ${label}.<name>={ direction: …, duration: …, priority: … }, or a bare ${label}.`,
  'transpiler.vt-alias-sur-style-interdit': `[ModularJS] @vt is not an alias on <style> — write @viewTransition.<name>={ … } (or bare @viewTransition).`,
  // RENAMING — @vt on <a> becomes @pageTransition, the sole spelling
  // of the page-level UJS transition mechanism (cf. transpiler/index.ts).
  'transpiler.vt-renomme-pagetransition': ({ ligne, remplacement }: MsgVars) => `[ModularJS] @vt is no longer written this way: it's now @pageTransition.\nReplace the line "${ligne}" with: ${remplacement}`,
  // @pageTransition (link) also accepts the OBJECT syntax `name={ direction: …, duration: … }`
  // (SAME mini-grammar as <@view>/<style> above, parseVtValue). `priority`/`p`
  // REFUSED here (not a grammar gap, a deliberate refusal): a link's cascade only has 2 levels
  // (link, config, cf. µ._mjs_vtResolvePage), nothing to arbitrate between departure/arrival
  // (_vtWinner/_vtResolveWithPriority are reserved for the router/<@view>, mjs_router.ts).
  'transpiler.pagetransition-forme-invalide': ({ label, val }: MsgVars) => `[ModularJS] ${label}="${val}": invalid form — write ${label}="<name>", "on", "off", or ${label}="<name>={ direction: …, duration: … }".`,
  'transpiler.pagetransition-erreur-parsing': ({ label, valeur, erreur }: MsgVars) => `[ModularJS] ${label}="${valeur}": ${erreur}`,
  'transpiler.pagetransition-priority-sans-effet': ({ label, valeur }: MsgVars) => `[ModularJS] ${label}="${valeur}": 'priority'/'p' has no effect on a link — the cascade only has 2 levels (link, config), nothing to arbitrate (_vtWinner/_vtResolveWithPriority are reserved for the router/<@view>); remove the option.`,
  'transpiler.persist-nom-invalide': ({ nomVar }: MsgVars) => `[ModularJS] @persist: "${nomVar}" is not a valid variable name — separate variables with a space (@persist $a $b).`,
  'transpiler.import-virgule-interdite': ({ rawVars, targetPath }: MsgVars) => `[ModularJS] @import ${rawVars} '${targetPath}': comma not allowed between names — separate them with a space (@import nameA nameB '${targetPath}').`,
  // section blocks (<style>/<script>/<theme>/<routes>) never
  // reach the DOM: an attribute they do not recognise, or a misspelled root directive
  // (@improt, @persit), now stops compilation
  'transpiler.section-attribut-inconnu': ({ tag, attribut, attendus }: MsgVars) => `[ModularJS] <${tag} ${attribut}>: unknown attribute — a <${tag}> block never reaches the DOM, only ${attendus} mean anything there.`,
  'transpiler.section-attribut-inconnu-suggestion': ({ tag, attribut, suggestion, attendus }: MsgVars) => `[ModularJS] <${tag} ${attribut}>: unknown attribute — did you mean "${suggestion}"? On <${tag}>, only ${attendus} mean anything.`,
  'transpiler.directive-racine-inconnue': ({ nom, suggestion }: MsgVars) => `[ModularJS] "@${nom}" at the start of a line is not a root directive — did you mean "@${suggestion}"? (root directives: @import, @persist)`,

  // — src/transpiler/sections.ts —
  'transpiler.script-module-double': ({ n, nAutres }: MsgVars) => `[ModularJS] ${n} <script module> tags found — only one block is allowed per component: merge them into one (before this rule, the content of the other ${nAutres} was silently dropped).`,
  'transpiler.script-double': ({ n, nAutres }: MsgVars) => `[ModularJS] ${n} <script> tags (non-module) found — only one block is allowed per component: merge them into one (before this rule, the content of the other ${nAutres} was silently dropped).`,
  'transpiler.style-double': ({ n, nAutres }: MsgVars) => `[ModularJS] ${n} <style> tags found — only one block is allowed per component: merge them into one, or use several selectors in the same block (before this rule, the content of the other ${nAutres} was silently dropped).`,
  'transpiler.theme-double': ({ nom }: MsgVars) => `[ModularJS] two <theme${nom === '' ? '' : ` name="${nom}"`}> blocks in the same component — only one unnamed block, and only one per name.`,
  'transpiler.theme-name-invalide': ({ nom }: MsgVars) => `[ModularJS] <theme name="${nom}">: invalid variant name — lowercase letters, digits and dashes only (e.g. <theme name="gold">).`,
  'transpiler.layout-name-invalide': ({ nom }: MsgVars) => `[ModularJS] <style name="${nom}">: invalid variant name — lowercase letters, digits and dashes only (e.g. <style name="banner">).`,
  'transpiler.layout-double': ({ nom }: MsgVars) => `[ModularJS] two <style name="${nom}"> blocks in the same component — one variant per name.`,
  'transpiler.layout-default': `[ModularJS] <style name="default">: "default" is the base model (the component itself, the one of {? default}) — give this model another name.`,
  'transpiler.variable-racine-sans-selecteur': ({ nom, ligne, bloc }: MsgVars) => `[ModularJS] $$${nom} is declared at the root of ${bloc} (line ${ligne}) — an override needs a selector (:host, a class…) to attach to. Move the line under a selector, or declare the variable in a <theme> if it should apply to the whole component.`,
  'transpiler.balise-orpheline-html': ({ balise }: MsgVars) => `[ModularJS] an orphan ${balise} is loose in the component's HTML — section extraction went off the rails. Likely causes: an unterminated string that contains ${balise} by typo, or an uppercase opening tag not recognized (e.g. <SCRIPT>/<STYLE>). Fix: escape/split the tag inside the string (e.g. '</scr' + 'ipt>'), check that your strings are closed, or lowercase the opening tag.`,
  'transpiler.routes-target-manquant': `[ModularJS] <routes>: the target="…" attribute is required — it's the id of the <@view id="…"> (outlet) these routes feed.`,
  'transpiler.routes-target-double': ({ target }: MsgVars) => `[ModularJS] two <routes target="${target}"> blocks in the same component — one block per target.`,
  // types and allowed values: <vars> (component) and <types> (*.types.mjs file), transpiler/var-types.ts
  'transpiler.vars-double': ({ n }: MsgVars) => `[ModularJS] ${n} <vars> blocks in the same component — only one, which declares all its typed variables, props and stores.`,
  'transpiler.section-sans-attribut': ({ tag, attributs }: MsgVars) => `[ModularJS] <${tag} ${attributs}>: a <${tag}> block takes no attribute.`,
  'transpiler.vars-apres-script': ({ ligne }: MsgVars) => `[ModularJS] <vars> (line ${ligne}) after the <script> — put the <vars> block before the <script>: a variable's rule reads before the code that writes it.`,
  'transpiler.composant-sans-html': ({ moduleName }: MsgVars) => `[ModularJS] ${moduleName}: this component has no HTML — it renders nothing. Add its HTML; if it only holds script, a .civet module fits better.`,
  'transpiler.types-dans-composant': ({ ligne }: MsgVars) => `[ModularJS] line ${ligne}: a <types> block in a component — named rules live in a *.types.mjs file, valid across the whole app; the component declares its variables in its <vars>.`,
  'transpiler.effets-dans-composant': ({ ligne }: MsgVars) => `[ModularJS] line ${ligne}: an <effects> block in a component — the app's effects live in an *.effects.mjs file, valid in all its components.`,
  'transpiler.include-vars': `an included partial carries no <vars>, <types> or <effects> — declare the types in the <vars> of the component that includes it, and the app's effects in a *.effects.mjs file.`,
  'transpiler.routes-ligne-invalide': ({ target, ligne, texte }: MsgVars) => `[ModularJS] <routes target="${target}">, line ${ligne}: "${texte}" — expected a path then a component name, separated by a space (e.g. /guide/:id  guide-page).`,
  'transpiler.routes-chemin-sans-slash': ({ target, ligne, chemin }: MsgVars) => `[ModularJS] <routes target="${target}">, line ${ligne}: path "${chemin}" must start with /.`,
  'transpiler.routes-chemin-mal-forme': ({ target, ligne, chemin }: MsgVars) => `[ModularJS] <routes target="${target}">, line ${ligne}: malformed path "${chemin}" — accepted segments: literal, :param, (:param) or (literal) optional (at any position), * catch-all at the end of the route only.`,
  'transpiler.routes-composant-invalide': ({ target, ligne, composant }: MsgVars) => `[ModularJS] <routes target="${target}">, line ${ligne}: "${composant}" is not a valid component name — lowercase letters, digits and dashes, without the mjs- prefix (e.g. guide-page).`,
  'transpiler.routes-chemin-double': ({ target, chemin }: MsgVars) => `[ModularJS] <routes target="${target}">: path "${chemin}" appears twice in the same block.`,
  'transpiler.routes-script-reassigne': `[ModularJS] ⚠️ the script REASSIGNS @routes while a <routes> block exists: the declarative table is replaced. To merely extend it, complete it (@routes['target']['/x'] = 'component') instead of reassigning it.`,

  // — src/transpiler/macros.ts —
  'transpiler.failed-retry-invalide': ({ valeur }: MsgVars) => `[ModularJS] <@failed>: "${valeur}" — retry expects a non-negative integer (e.g. retry="3", retry="0" to forbid any retry).`,
  'transpiler.failed-boundary-retry-epuise': ({ limit }: MsgVars) => `[ModularJS] <@failed>: retry limit reached (${limit}) — giving up, no further automatic attempt.`,
  'transpiler.head-attr-interpolation-sans-guillemets': ({ macro, ligne, forme, correction }: MsgVars) => `[ModularJS] <@${macro}> line ${ligne}: "${forme}" — inside a tag, an interpolation must be quoted, otherwise a space in the value adds an attribute. Write ${correction}.`,
  'transpiler.head-interpolation-position-attribut': ({ macro, ligne, forme }: MsgVars) => `[ModularJS] <@${macro}> line ${ligne}: "${forme}" — an expression cannot stand in for an attribute inside a tag. Name the attribute and quote the value: <meta name="…" content="{$x}">.`,
  'transpiler.head-interpolation-position-balise': ({ macro, ligne, forme }: MsgVars) => `[ModularJS] <@${macro}> line ${ligne}: "${forme}" — an expression cannot stand in for a tag name. Write the tag explicitly and put the data in a quoted attribute or in text.`,
  'transpiler.head-script-inerte': ({ ligne }: MsgVars) => `[ModularJS] <@head> line ${ligne}: this <script> will be added to <head> but will never run — the browser does not run a script inserted as HTML content. Load it in the page that hosts the application (index.html), import it in the component's <script>, or create it when the component mounts with document.createElement('script'). Only a data script (type="application/ld+json") belongs in <@head>.`,
  'transpiler.include-slash-final-interdit': ({ target, selfClose, clean }: MsgVars) => `<@include ${target}${selfClose}>: trailing slash not allowed — write <@include ${clean}>`,
  'transpiler.include-partial-introuvable': ({ target, baseDir }: MsgVars) => `Partial not found: <@include ${target}> (from ${baseDir})`,
  'transpiler.include-circulaire': ({ target }: MsgVars) => `<@include> circular reference detected on "${target}" — inclusion skipped.`,
  'transpiler.include-sans-basedir': ({ target }: MsgVars) => `<@include ${target}> ignored: compiling without a file path (baseDir missing), the partial cannot be resolved`,
  'transpiler.include-hors-racine': ({ target, chemin }: MsgVars) => `<@include ${target}>: this path ('${chemin}') is OUTSIDE sourceDir — never followed nor inlined, to avoid publishing a file outside the project. Remove this path or point it to a partial inside sourceDir.`,
  'transpiler.window-propriete-non-liable': ({ prop, liables }: MsgVars) => `<@window ${prop}=!{…}>: property not bindable. Bindable: ${liables}`,
  'transpiler.liaison-reservee-window': ({ macro, prop, liables }: MsgVars) => `<@${macro} ${prop}=!{…}>: a \`name=!{…}\` binding only exists on <@window> (bindable properties: ${liables}) — write it on <@window>.`,
  'transpiler.macro-class-interpolation-non-supportee': ({ macro }: MsgVars) => `<@${macro} class="…{…}…">: interpolation not supported in class= of a global macro — use @class{cond}="class".`,
  'transpiler.macro-style-inline-interdit': ({ macro }: MsgVars) => `<@${macro} style="…">: inline style forbidden (MJS zero-inline-CSS rule). Use @style.prop={expr}, --var={expr}, or the global stylesheet.`,
  'transpiler.macro-class-non-supportee-cible': ({ macro }: MsgVars) => `<@${macro} class=…>: class/style bindings not supported on this target (reserved for <@body>/<@html>).`,
  'transpiler.macro-auto-fermeture-interdite': ({ macro }: MsgVars) => `<@${macro}/>: self-closing not allowed — <@${macro}> expects content, close it explicitly (<@${macro}>…</@${macro}>).`,
  'transpiler.macro-balise-non-fermee': ({ macro, extrait }: MsgVars) => `<@${macro}> tag never closed (an opened brace or quote was never closed): "${extrait}…"`,
  'transpiler.include-malforme': ({ extrait }: MsgVars) => `<@include> malformed: "${extrait}…" — the expected form is <@include path> (a single path, no attributes)`,
  'transpiler.element-accept-invalide': ({ valeur }: MsgVars) => `attribute accept="${valeur}" invalid on <@element>/<@module>: a space-separated list of tag names, literal (e.g. accept="iframe style").`,
  'transpiler.element-variable-attendue': ({ macro, extrait }: MsgVars) => `<@${macro}>: the tag variable must come first, before the attributes (${extrait})`,
  'transpiler.element-expression-interdite': ({ macro, extrait }: MsgVars) => `<@${macro}>: the tag is a variable ($tag), not an expression in braces — compute the value in a derived var (${extrait})`,

  // — src/transpiler/index.ts —
  'transpiler.import-singleton-ancienne-forme': ({ nom }: MsgVars) => `[ModularJS] "@import §§${nom}": this form no longer exists — a singleton is now imported with "@import µ$$${nom}", then consumed as "µ$$${nom}" (§§${nom} remains reserved for the reactive ancestor context, never for import).`,
  'transpiler.singleton-mauvaise-consommation': ({ nom }: MsgVars) => `[ModularJS] The imported singleton "${nom}" is consumed with "µ$$${nom}", not "$${nom}" / "$$${nom}" / "§§${nom}" (@import µ$$${nom} = the import; µ$$${nom} = the reactive read; §§${nom} remains the reactive ancestor context, a different space).`,
  'transpiler.singleton-sans-import': ({ nom }: MsgVars) => `[ModularJS] "µ$$${nom}" used without a matching "@import µ$$${nom}" (nor an "export µ$$${nom}" in this file) — µ$$ can only be read for a name explicitly imported, or exported from this same module.`,
  'transpiler.rune-effect-dans-module': ({ rune, ligne }: MsgVars) => `[ModularJS] "${rune}" in <script module> (line ${ligne}) — the module runs at import time, with no active component: µeffect/µinspect must be called at the TOP-LEVEL of the component's <script>.`,
  'transpiler.rune-effect-imbriquee': ({ rune, ligne }: MsgVars) => `[ModularJS] "${rune}" nested (line ${ligne}) — µeffect/µinspect must be called at the component's TOP-LEVEL: move the call to the root of <script> (nested — handler, hook, setTimeout… — it was silently ignored at runtime).`,
  'transpiler.rune-emit-dans-module': ({ rune, ligne }: MsgVars) => `[ModularJS] "${rune}" in <script module> (line ${ligne}) — the module runs at import time, with no active component: there is no element to make emit the event. The emit call belongs in the <script> (or in a method called from it).`,
  'transpiler.rune-separee-du-symbole': ({ symbole, rune, lieu, ligne }: MsgVars) => `[ModularJS] "${symbole}" separated from its rune "${rune}" by a space or a line break (${lieu}, line ${ligne}) — write ${symbole}.${rune} in one piece, on a single line: split this way, the rune escapes the compiler's rewriting and detection, and the code may crash at runtime.`,
  'transpiler.on-url-change-legacy': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ⚠️  ${moduleName}${ligne ? ` (line ${ligne})` : ''}: "@onUrlChange = ->": V1 form removed — the router no longer calls it; write the rune "µurlChange (path, params) ->".`,
  'transpiler.code-inaccessible': ({ fichier, ligne, mot }: MsgVars) => `[ModularJS] '${fichier}'${ligne ? ` (line ${ligne})` : ''}: this code follows a "${mot}" in the same block, it will never run — the production build removes it silently. Remove this code or this "${mot}", or put the "${mot}" under a condition.`,
  // "Form found" fragments, interpolated in
  // transpiler.page-marqueur-manquant below (same pattern as hint-ligne-civet further down).
  'transpiler.page-forme-bloc-routes': `the "<routes>" block`,
  'transpiler.page-forme-directive-routes': `the "@routes" directive`,
  'transpiler.page-forme-vue': `the "<@view>" tag`,
  'transpiler.page-marqueur-manquant': ({ moduleName, suggestion, forme }: MsgVars) => `[ModularJS] '${moduleName}.mjs' uses ${forme} without carrying the ".page.mjs" marker — outside a .page.mjs file, this form is a compile-time refusal. Rename the file to '${suggestion}'.`,
  'transpiler.nom-jamais-declare': ({ nom }: MsgVars) => `[ModularJS] "${nom} = …": name never declared (Civet doesn't auto-declare, unlike Coffee) — will cause a "ReferenceError: ${nom} is not defined" at runtime. Use "${nom} := …" to declare a new variable (works equally well with -> and =>).`,
  'transpiler.reexport-es-interdit': ({ section, source }: MsgVars) => `[ModularJS] ES re-export forbidden in ${section} ("export … from '${source}'") — only the "@import name 'path'" directive (file root, outside <script>) is a valid MJS import.`,
  'transpiler.import-es-classique-interdit': ({ section, source }: MsgVars) => `[ModularJS] classic ES import forbidden in ${section} ("import ... '${source}'") — only the "@import name 'path'" directive (file root, outside <script>) is a valid MJS import.`,
  'transpiler.import-dynamique-interdit': ({ section }: MsgVars) => `[ModularJS] import('…') with a literal path forbidden in ${section} — file known at build time: "@import name 'path'" (main bundle) or "await µimport('path.js')" (lazy loading, fingerprint resolved at build) ; runtime-computed URL: import(variable) is allowed as-is.`,
  'transpiler.rune-import-litteral-requis': ({ section }: MsgVars) => `[ModularJS] µimport requires a literal path in ${section} (file known at build time, fingerprint resolved for you) — for a runtime-computed URL, write import(variable) directly.`,
  'transpiler.rune-import-extension': ({ chemin, section }: MsgVars) => `[ModularJS] µimport only loads a module: an ES ".js" file, or a module MJS compiles (".civet", ".coffee") — path received in ${section}: ${chemin}.`,
  'transpiler.rune-import-composant': ({ chemin, section }: MsgVars) => `[ModularJS] µimport does not load an ".mjs" component (path received in ${section}: ${chemin}) — a component is placed with its <@name> tag; for code to load on a click, write a ".civet" or ".coffee" module.`,
  // µinspect watches a variable or a FIXED PATH (`$x.a.b`) — a call or a computed index makes no sense there
  'transpiler.rune-inspect-chemin': ({ nom, chemin }: MsgVars) => `[ModularJS] µinspect watches a variable or a fixed path ($x.a.b): a call or a computed index is not accepted (received "$${nom}${chemin}").`,
  'transpiler.minmax-retire': `[ModularJS] µminmax no longer exists in 3.0: a variable's range is declared in the component's <vars> block, placed before the <script> — e.g. $volume  int 0..10 (for a field: $settings  { volume: int 0..10 }).`,
  'transpiler.console-parentheses': ({ ecrit }: MsgVars) => `[ModularJS] "${ecrit}": without parentheses, µconsole takes a single simple argument — a text ('.cart') or a name ($$cart, false) — at the end of the statement; otherwise, write µconsole(…).`,
  'transpiler.rune-store': ({ rune, nom }: MsgVars) => `[ModularJS] µ${rune} applies to a component's state ($x), not to a store: "$$${nom}" is not accepted. To follow a store: µconsole $$${nom} (panel); to constrain it: its rule in a <vars>.`,
  'transpiler.rune-toggle-cible': ({ section, recu }: MsgVars) => `[ModularJS] µtoggle expects an assignable path as its first argument in ${section} ("$x", "$$x", "§x", "µtheme", "@prop", a variable name, optionally followed by ".key" or "[0]"), got "${recu}" — that's what gets reassigned: no call, no "++", no computed index, because the toggle reads it once per test.`,
  'transpiler.rune-toggle-valeur': ({ section, recu }: MsgVars) => `[ModularJS] µtoggle only accepts literal values in ${section} (string, number, true/false, null), got "${recu}" — an expression would be evaluated twice by the toggle.`,
  'transpiler.rune-toggle-doublon': ({ section, recu }: MsgVars) => `[ModularJS] µtoggle: value ${recu} appears twice in the cycle (${section}) — the cycle would stop there for good.`,
  'transpiler.rune-acces-brut-forme': `[ModularJS] µread/µwrite targets a state symbol: "µread $x" or "µread($x)", nothing else between the parentheses. To write: "µwrite $x, v" or "µwrite($x, v)".`,
  'transpiler.rune-write-ancienne-forme': `[ModularJS] µwrite writes a state symbol with a comma: "µwrite $x, v" or "µwrite($x, v)", never an equals sign.`,
  'transpiler.rune-toggle-appel': ({ section }: MsgVars) => `[ModularJS] µtoggle is always written as a parenthesised call in ${section}: "µtoggle($x, 'a', 'b')" — never bare, never without parentheses.`,
  'transpiler.handler-var-jamais-declaree': ({ moduleName, nom }: MsgVars) => `[ModularJS] '${moduleName}.mjs': inside an event handler, "${nom}" reads itself in its own declaration — that name exists nowhere (neither <script>, nor <script module>, nor a loop variable). It would be recreated on every call and throw "Cannot access '${nom}' before initialization" on the first click. Declare it at the top of your <script> ("${nom} = …"), or write "$${nom}" if you want reactive state.`,
  'transpiler.handler-methode-nue': ({ moduleName, nom, ligne, fenetre }: MsgVars) => `[ModularJS] '${moduleName}.mjs'${ligne ? ` (line ${ligne})` : ''}: an event handler names "${nom}" as is, but neither the <script> nor the <script module> declares "${nom}": it is the component method, "@${nom}". ${fenetre ? `Written bare, this name is also a browser function: the handler calls that one, not your method. Write "window.${nom}" for the browser function, or "@${nom}" for the component method (for example "@click={@${nom}}").` : `Written bare, this name does not exist — on click nothing would happen ("${nom} is not defined" in the console). Write "@${nom}" (for example "@click={@${nom}}"), or declare "${nom} = -> …" in your <script>.`}`,
  'transpiler.propriete-balise-construction': ({ moduleName, nom, ligne }: MsgVars) => `[ModularJS] '${moduleName}.mjs'${ligne ? ` (line ${ligne})` : ''}: "@${nom} = …" at the top of the <script> is not component data: it is the "${nom}" property of its tag (HTMLElement), written while the browser builds it — it changes the tag (an attribute or content), and when the component is created by the router, <@element> or document.createElement, the browser refuses it ("Fatal Error" on mount). For data, pick another name or the "$${nom}" state; to act on the tag itself, write it in "µmount ->".`,
  'transpiler.propriete-balise-lecture-seule': ({ moduleName, nom }: MsgVars) => `[ModularJS] '${moduleName}.mjs': "@${nom} = …" at the top of the <script> writes the "${nom}" property of the component tag (HTMLElement), which is read-only: the write throws during construction and the component falls on mount ("Fatal Error"). For data, pick another name or the "$${nom}" state.`,
  'transpiler.methode-balise-masquee': ({ moduleName, nom }: MsgVars) => `[ModularJS] '${moduleName}.mjs': "@${nom} = …" in the <script> replaces the "${nom}()" method of the component tag (HTMLElement), which ModularJS itself calls on component tags — on mount, for their attributes, their events, their content, their transitions and their effects: your function would run instead of it, and the component would stop working. Rename it: any name that is not a method of the tag will do ("@setField" rather than "@setAttribute", for example).`,
  'transpiler.handler-const-reaffectee': ({ moduleName, nom }: MsgVars) => `[ModularJS] '${moduleName}.mjs': an event handler reassigns "${nom}", declared CONSTANT in the <script> ("${nom} := …"). JavaScript would throw "Assignment to constant variable" on the first click. Declare it with "=" if you want to change it, or write "$${nom}" for reactive state.`,
  'transpiler.handler-local-gabarit-reaffecte': ({ moduleName, nom }: MsgVars) => `[ModularJS] '${moduleName}.mjs': an event handler or a two-way binding reassigns "${nom}", set by the template ({for}, {const} or {success}/{error}). It only holds a copy of it: the write would be silently lost. To change a list item, write into the list ("$list[index] = …", or "value=!{$list[index]}" for a binding) or change one of its properties ("${nom}.field = …"); for a value you want to keep, use a state variable ("$${nom} = …").`,
  'transpiler.handler-js-invalide': ({ moduleName, ligne, extrait }: MsgVars) => `[ModularJS] '${moduleName}.mjs': this component's event handlers compile to invalid JavaScript — the whole file would be refused at load time (dead page) while the build stayed green. The produced line, quoted at the end of this message, points to the faulty handler. Write its body directly between the braces, without an arrow ("@click={if a then x = 1}"); if you keep the arrow, move its body to the next line, indented. For longer code, call a function of the <script> ("@click={myFunction}"). Produced line ${ligne}: ${extrait}`,
  'transpiler.handler-fleche-en-ligne': ({ moduleName, ligne, extrait }: MsgVars) => `[ModularJS] '${moduleName}.mjs': an event handler returns an arrow written on a single line whose body assigns an "if … then … else" (or an unless, a switch, a try, a for), as in "@click={-> x = if a then 'b' else 'c'}" — Civet compiles this form to invalid JavaScript, and the whole file would be refused at load time. Put the value in parentheses ("-> x = (if a then 'b' else 'c')"), or write the arrow's body on the next line, indented. Produced line ${ligne}: ${extrait}`,
  'transpiler.script-fleche-en-ligne': ({ moduleName, ligne, extrait, section }: MsgVars) => `[ModularJS] '${moduleName}.mjs': the ${section ?? '<script>'} contains an arrow written on a single line whose body assigns an "if … then … else" (or an unless, a switch, a try, a for, a while), as in "f = => x = if a then 'b' else 'c'" — Civet compiles this form to invalid JavaScript. Put the value in parentheses ("f = => x = (if a then 'b' else 'c')"), or write the arrow's body on the next line, indented. Produced line ${ligne}: ${extrait}`,
  // scope-aware auto-declaration of a <script> (or a standalone .civet module): `nom := …`
  // binds a Civet CONSTANT — reassigning it bare (`nom = …`, `nom += …`) would compile fine
  // then crash at load time ("Assignment to constant variable"). `code` (optional): the line
  // comes from the scope-resolution check (const-reassign.ts), on the already-compiled JS —
  // never guaranteed to match the Civet source line, say so rather than lie.
  'transpiler.civet-reaffectation-constante': ({ nom, ligne, code }: MsgVars) => `[ModularJS] reassignment of "${nom}" (line ${ligne}${code ? ' of the compiled code' : ''}) refused — declared with ":=" (constant): use ".=" to be able to reassign it.`,
  // — src/generator/reserved-symbols.ts —
  'transpiler.symbole-reserve-declare': ({ moduleName, section, nom, extrait }: MsgVars) => `[ModularJS] '${moduleName}.mjs' (${section}): "${nom}" is a framework symbol — $ (state), $$ (store), µ (runtime) — it cannot be used as a variable, parameter or import name: "${extrait}". Rename it (for instance "el" for a DOM element).`,
  'transpiler.symbole-reserve-nu': ({ nom }: MsgVars) => `[ModularJS] "${nom}" alone is not a name: it is a framework symbol (§ frozen context, §§ reactive context) — it is always followed by a name ("§theme", "§§count") and cannot be used as a variable, a parameter or a value.`,
  'transpiler.isnt-identifiant-reserve': `[ModularJS] "isnt" is a Coffee/Civet operator (≡ is not) — reserved identifier, rename it (e.g. "isnt_", "notIt").`,
  'transpiler.desequilibre-structurel': ({ moduleName, tag, opens, closes }: MsgVars) => `
❌ [ModularJS Syntax Error] In '${moduleName}.mjs':
   Component <${tag}> has a structural imbalance.
   Openings: ${opens}, Closings: ${closes}.
   Solution: use <${tag} /> for empty components.`,
  // @callback (forbidden brace form AND invalid name, same message for both traps)
  'transpiler.callback-nom-attendu': ({ valeur }: MsgVars) => `[ModularJS] @callback=${valeur}: the directive expects a METHOD NAME in quotes (e.g. @callback="myMethod") — not an expression in braces, not a compound identifier.`,
  // @permanent: bare form only, matching between navigations is done by id
  'transpiler.permanent-valeur-refusee': ({ valeur }: MsgVars) => `[ModularJS] @permanent=${valeur}: this directive never takes a value — matching between two navigations is done by the element's id, never by a name carried on @permanent; write @permanent alone, with a stable id on the element.`,
  'transpiler.preload-eager-renomme': ({ ou }: MsgVars) => `[ModularJS] @preload: the "eager" value does not exist — write "on" (${ou}).`,
  // @confirm object form (static literal text/ok/cancel only): only talks about
  // the CONTENT of an options hash now, an expression WITHOUT a "key:" is a separate reactive
  // attribute (mjs-confirm={expr}), which no longer goes through this message
  'transpiler.confirm-objet-invalide': ({ raw }: MsgVars) => `[ModularJS] @confirm={${raw}}: invalid object form — inside an options hash, only the text/ok/cancel keys are accepted, as string literal values in single or double quotes, or a µt(…) call to follow the language (e.g. @confirm={ text: µt('delete_question'), ok: 'Delete' }) — no other expression or variable for these keys (a bare expression, without a "key:", is a reactive attribute: @confirm={myVar}).`,
  // @title object form (same spirit as @confirm: static literal, one SHARED catalogue key
  // for every error of this form — missing text, unknown key, non-literal value, side/transition
  // outside the enum)
  'transpiler.title-objet-invalide': ({ raw }: MsgVars) => `[ModularJS] @title={${raw}}: invalid object form — accepted keys text (required)/delay/side/dur/transition, as literal string or number values (side: 'top'/'bottom', transition: 'fade'/'slide'); only the text key also accepts a µt(…) call to follow the language (e.g. @title={ text: µt('help'), side: 'top' }) — no other expression or variable allowed.`,
  // @title={{ expr }} (HTML form): the two adjacent opening braces require two adjacent
  // closing braces symmetrically — a body never closed (end of file) or closed by a single
  // brace both hit this SAME message.
  'transpiler.title-html-non-ferme': ({ raw }: MsgVars) => `[ModularJS] @title={{${raw}}}: the HTML form is never closed by a double closing brace "}}" — two adjacent closing braces are expected, symmetric with the two opening ones (@title={{ expression }}).`,
  'transpiler.title-html-triple-accolade': ({ extrait }: MsgVars) => `[ModularJS] ${extrait}…: three adjacent opening braces ("{{{") — neither the text form (@title={expr}, one brace) nor the HTML form (@title={{expr}}, two): the third would slide into the body as an object literal, shown as "[object Object]" on hover. Use ONE brace or TWO, never more.`,
  // @flash (closed vocabulary popup/console/silent, same anti-ghost-listener guard as @callback)
  'transpiler.flash-valeur-invalide': ({ valeur }: MsgVars) => `[ModularJS] @flash=${valeur}: the directive expects "popup", "console" or "silent" in quotes (e.g. @flash="popup") — not an expression in braces, not another value.`,
  'transpiler.viewtransition-nu-sur-view': ({ label }: MsgVars) => `[ModularJS] bare ${label} on a <@view> has no effect of its own — specify a name (${label}.fade); the bare form (activate with inheritance) only exists at a module's root.`,
  'transpiler.viewtransition-forme-invalide-sur-view': ({ label, rest }: MsgVars) => `[ModularJS] ${label}${rest} on <@view>: invalid form — write ${label}.<name>={ direction: …, duration: …, priority: … } (optional options).`,
  'transpiler.viewtransition-erreur-parsing-sur-view': ({ label, nameAndDir, erreur }: MsgVars) => `[ModularJS] ${label}.${nameAndDir} on <@view>: ${erreur}`,
  'transpiler.viewtransition-ancienne-forme-view': ({ label, val, nameOnly }: MsgVars) => {
    const nom = nameOnly || '<name>'
    return `[ModularJS] ${label}="${val}" replaced — write ${label}.${nom}; the dynamic form ${label}={expr} remains valid.`
  },
  'transpiler.viewtransition-morph-options-interdites': ({ morphName }: MsgVars) => `[ModularJS] @viewTransition.${morphName}={...}: options reserved for navigation levels (config, module, <@view>) for now.`,
  'transpiler.viewtransition-ancienne-forme': ({ val }: MsgVars) => {
    const nom = val || '<name>'
    return `[ModularJS] @viewTransition="${val}" replaced — write @viewTransition.${nom}.`
  },
  'transpiler.viewtransition-etiquette-calculee-interdite': ({ expr }: MsgVars) => `[ModularJS] @viewTransition={${expr}}: computed tag label removed — @viewTransition.<name> stays fixed. For a computed value, write @style.view-transition-name={${expr}}.`,
  'transpiler.viewtransition-etiquette-conditionnelle-interdite': ({ cond, val }: MsgVars) => `[ModularJS] @viewTransition{${cond}}="${val}": conditional tag label removed — @viewTransition.<name> stays fixed. For a conditional value, write @style.view-transition-name{${cond}}="${val}".`,
  'transpiler.css-trap-fontface': `<style> component: @font-face in Shadow DOM does NOT load the font (browser limitation). Declare it at document level: <@head><style>@font-face { font-family: '…'; src: url(µasset('fonts/….woff2')) }</style></@head>. (Not applicable if the component is mounted as mjs-light.)`,
  'transpiler.css-trap-import': `<style> component: @import is ignored in a constructed stylesheet (adoptedStyleSheets). External sheet (Google Fonts…) → <@head><link rel="stylesheet" href="…"></@head>; local file → url(µasset('…')).`,
  'transpiler.hint-spread-else-civet': ` Lead: "if … then {…} else {...x}" (100% spread object in else) triggers an upstream Civet bug — work around it with "Object.assign({}, x)", an explicit key ("{…, k: v}"), or a classic if/else.`,
  // same lead, second pattern: spread in a thin-arrow `->` object body
  // (`(x) -> { ...x, k: v }`) — same upstream Civet bug, two workarounds.
  'transpiler.hint-spread-fleche-fine-civet': ` Lead: "(x) -> { ...x, k: v }" (spread in a thin-arrow object body) triggers an upstream Civet bug — work around it with explicit parentheses "-> ({ ...x, k: v })" or a fat arrow "=>".`,
  'transpiler.mu-layout-homonyme': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ${moduleName}: "µlayout" reads the chosen model (the layout prop), and this component has its own $layout variable${ligne ? ` (line ${ligne})` : ''} — the two would be confused. Rename the variable.`,
  'transpiler.trop-de-variables-etat': ({ moduleName, n, seuil }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} declares ${n} state variables ($) — threshold ${seuil}: split into sub-components/screens or structure the state (objects/arrays); tune lint.maxStateVars (0 to disable).`,
  // — a11y lint (transpiler/a11y.ts), enabled by default —
  'transpiler.a11y-img-alt-manquant': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (line ${ligne}): <img> without an alt attribute — add alt="…" (descriptive text), or alt="" if the image is purely decorative.`,
  'transpiler.a11y-iframe-title-manquant': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (line ${ligne}): <iframe> without a title attribute — add title="…" describing the embedded content.`,
  'transpiler.a11y-tabindex-positif': ({ moduleName, ligne, valeur }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (line ${ligne}): positive tabindex="${valeur}" breaks the natural tab order — use tabindex="0" (DOM order) or reorder the HTML, never a positive tabindex.`,
  'transpiler.a11y-click-non-interactif': ({ moduleName, ligne, tag }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (line ${ligne}): @click on non-interactive <${tag}>, without role or tabindex — add role="button" tabindex="0" (+ keyboard handling), or use a <button>/<a>.`,
  'transpiler.a11y-bouton-nom-manquant': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (line ${ligne}): <button> without an accessible name (only icons or empty) — add aria-label="…" or visible text.`,
  'transpiler.a11y-lien-nom-manquant': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (line ${ligne}): <a> without an accessible name (only icons or empty) — add aria-label="…" or visible text.`,
  'transpiler.a11y-champ-etiquette-manquante': ({ moduleName, ligne, tag }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (line ${ligne}): <${tag}> without an associated label — add <label for="…">…</label> (or aria-label="…").`,
  // — ujs-form lint (transpiler/ujs-form.ts), enabled by default —
  'transpiler.lint.ujs-form': ({ file, ligne }: MsgVars) => `[ModularJS] ⚠️  ${file}:${ligne} — this <form> has neither action nor @method: UJS intercepts it anyway, and the submission turns into a navigation to the current URL. If it is purely local, hold the submission in your handler (@submit.prevent) or add @noUJS.`,
  'transpiler.hint-ligne-civet': ({ ligne, ligneFautive }: MsgVars) => ` (line ${ligne} reported by Civet: \`${ligneFautive}\`)`,
  // (transpiler/index.ts:2062 reuses 'generator.hint-ternaire-colle' — identical text, cf. risques §8)
  'transpiler.handler-inline-echec-civet': ({ moduleName, lineHint, civetMsg, gluedTernaryHint }: MsgVars) => `[ModularJS] inline handler: Civet compilation failed in "${moduleName}"${lineHint} — ${civetMsg}${gluedTernaryHint}`,

  // — src/languages/coffee.ts —
  'languages.source-coffee-depreciee': ({ fichier }: MsgVars) => `[ModularJS] ⚠️  deprecated CoffeeScript source (${fichier}) — migrate to .civet; the Coffee adapter will be removed in a future version.`,
  'languages.js-erreur-syntaxe': ({ detail }: MsgVars) => `JavaScript syntax error: ${detail}`,

  // — src/languages/index.ts —
  'languages.langage-inconnu': ({ lang, supportes }: MsgVars) => `[languages] unknown language: "${lang}". Supported: ${supportes}`,

  // — src/schema/core.ts —
  'schema.type-inconnu': ({ schema, champ, type, indice, valides }: MsgVars) => `[µschema] schema '${schema}', field '${champ}': unknown type '${type}'${indice} — valid types: ${valides}, list(type), bits([names])`,
  'schema.suggestion-type': ({ suggestion }: MsgVars) => ` — did you mean '${suggestion}'?`,
  'schema.list-type-scalaire': ({ schema, champ, valides, typeDe }: MsgVars) => `[µschema] schema '${schema}', field '${champ}': list() expects a scalar type (${valides}) — nested sub-schemas/list not supported in v1, received '${typeDe}'`,
  'schema.bits-noms-vides': ({ schema, champ }: MsgVars) => `[µschema] schema '${schema}', field '${champ}': bits() expects a non-empty array of names`,
  'schema.bits-trop-de-noms': ({ schema, champ, nb }: MsgVars) => `[µschema] schema '${schema}', field '${champ}': bits() accepts at most 8 booleans in its byte (received ${nb})`,
  'schema.bits-noms-double': ({ schema, champ }: MsgVars) => `[µschema] schema '${schema}', field '${champ}': bits() — duplicate names`,
  'schema.type-champ-invalide': ({ schema, champ }: MsgVars) => `[µschema] schema '${schema}', field '${champ}': invalid field type (neither a scalar string, nor list(), nor bits())`,
  'schema.nom-champ-invalide': ({ schema, champ }: MsgVars) => `[µschema] schema '${schema}': invalid field name '${champ}' — does not survive a plain object ({}[name] = value), e.g. '__proto__'`,
  'schema.forme-differente': ({ nom, ancien, nouveau }: MsgVars) => `[µschema] schema '${nom}' already declared with a different shape — ADD-ONLY guard: an existing schema is IMMUTABLE (no field ever added/removed/retyped/reordered). Declare a schema under a NEW name to evolve the protocol.
  old      : ${ancien}
  new      : ${nouveau}`,
  'schema.registre-plein': ({ nom }: MsgVars) => `[µschema] registry full — 256 schemas already declared (u8 id exhausted), cannot add '${nom}'`,
  'schema.chaine-trop-longue': ({ type, octets, max }: MsgVars) => `[µschema] string too long for ${type} (${octets} UTF-8 bytes, max ${max})`,
  'schema.valeur-hors-plage': ({ schema, champ, type, valeur, min, max }: MsgVars) => `[µschema] schema '${schema}', field '${champ}': ${valeur} is out of range for ${type} (${min} to ${max}) — the value would arrive wrapped. Choose a wider type, or clamp the value before sending.`,
  'schema.list-trop-longue': ({ of, n }: MsgVars) => `[µschema] list(${of}): ${n} elements, max 65535 (u16 counter)`,
  'schema.decode-hors-bornes': `[µschema] decode: truncated/malformed frame — read out of bounds`,
  'schema.encode-schema-inconnu': ({ nom }: MsgVars) => `[µschema] encode(): unknown schema '${nom}' — declare it first (defSchema/app.schema)`,
  'schema.decode-trame-vide': `[µschema] decode(): empty frame, schema id byte expected`,
  'schema.decode-id-inconnu': ({ id }: MsgVars) => `[µschema] decode(): unknown schema id (${id}) — local registry incomplete or out of sync`,

  // ═══ SERVEURS (src/server/, src/mjs-server/) ════════════════════════════════════════════

  // --- src/server/index.ts ---
  'server.index-hmr-actif': ({ host, port }: MsgVars) => `🔥 HMR enabled (ws://${host}:${port}/__mjs_hmr)`,
  'server.index-ecoute': ({ host, port, pathPrefix }: MsgVars) => `📡 ModularJS server : http://${host}:${port}${pathPrefix}/...`,
  'server.hote-refuse': ({ nom }: MsgVars) => `Host not allowed: “${nom}”. This development server only answers localhost and its subdomains, 127.0.0.1, [::1], this machine's name and the \`dev.host\` host. To open this name (tunnel, proxy), add it in mjs.config.json: "dev": { "allowedHosts": ["${nom}"] }.`,
  'server.origine-nom-exact': ({ nom, motif, hote }: MsgVars) => `Origin refused: “${nom}” is only covered by “${motif}” in dev.allowedHosts, and the received Host header (“${hote}”) does not name it: a tunnel rewrote it. An entry that starts with a dot also covers the pages of this domain's other users; behind a rewritten Host, hot reload and mjs dev forms therefore only accept an exact name. Add it in mjs.config.json: "dev": { "allowedHosts": ["${nom}"] }.`,
  'server.origine-refus-tus': ({ max }: MsgVars) => `Origins refused: ${max} names already reported in this terminal; further refusals are no longer shown until mjs dev restarts. The 403 response of a refused form still gives the exact name to write.`,
  'server.journal-viewer-ignore-en-prod': "[ModularJS] ⚠️  journal.viewer: true is ignored in production: the error journal viewer page is not served (404). To open it in production, set a token (`journal.viewer: \"<token>\"`, page opened with `?token=<token>`).",

  // --- src/server/hmr.ts ---
  'server.hmr-connecte': '[HMR] connected',
  'server.hmr-deconnecte': '[HMR] disconnected — retry in {wait}ms',
  'server.hmr-compilation-echouee': '[ModularJS HMR] Compilation failed:',
  'server.hmr-aucun-message': '(no message)',

  // --- src/server/prerender.ts ---
  'server.prerender-route-parametree': 'parameterized route → build prerender impossible (switch to ssr + server mode)',
  'server.prerender-mode-non-buildable': ({ mode }: MsgVars) => `mode ${mode} (rendered client/server-side, not at build)`,
  'server.prerender-banner': ({ url, lang }: MsgVars) => `Page pre-rendered by MJS (mjs build) for '${url}'${lang ? ` (language '${lang}')` : ''} — do not edit by hand.`,
  'server.prerender-echec-rendu': ({ component, langTag, err }: MsgVars) => `render failure (${component}${langTag}): ${err}`,
  'server.prerender-hors-dossier': ({ url, file, outDir }: MsgVars) => `page '${url}' not prerendered: its file (${file}) would leave render.outDir (${outDir}) — nothing is written`,

  // --- src/server/render-request.ts ---
  'server.render-handler-ferme': '[mjs] render handler already closed',
  'server.render-erreur-interne': 'internal error',
  'server.render-echec-html': ({ component, pathname, detail }: MsgVars) => `<!-- [mjs] render failure for ${component} on '${pathname}': ${detail} -->`,

  // --- src/server/render-browser.ts ---
  'server.browser-erreurs-compilation': ({ errors }: MsgVars) => `[mjs-ssr-browser] compilation errors:\n${errors}`,
  'server.browser-core-introuvable': '[mjs-ssr-browser] mjs_core not found after compilation',
  'server.browser-playwright-manquant': "[mjs-ssr-browser] the browser engine requires Playwright — install it: npm i -D playwright (or configure render.engine.prerender / render.engine.request: 'happy-dom').",
  'server.browser-deja-ferme': '[mjs-ssr-browser] renderer already closed',
  'server.browser-forward-refuse-interne': ({ tag, host }: MsgVars) => `[mjs-ssr-browser] render.forwardOrigin denied for <${tag}>: internal network target blocked (${host}) — proxy disabled.`,
  'server.browser-forward-url-invalide': ({ tag }: MsgVars) => `[mjs-ssr-browser] render.forwardOrigin denied for <${tag}>: invalid forwardedUrl — proxy disabled.`,
  'server.browser-prop-invalide': ({ keyJson }: MsgVars) => `[mjs-ssr-browser] invalid prop name ignored: ${keyJson}`,
  'server.browser-composant-non-enregistre': ({ tag }: MsgVars) => `[mjs-ssr-browser] component <${tag}> not registered (check the filename is lowercase kebab-case)`,
  'server.browser-non-stabilise': ({ tag, settleMs }: MsgVars) => `[mjs-ssr-browser] render of <${tag}> not settled within ${settleMs}ms (scheduler busy or {await} still pending) — HTML potentially incomplete, hydration divergence possible.`,
  'server.browser-erreur-page': ({ tag, err }: MsgVars) => `[mjs-ssr-browser] uncaught error in the page for <${tag}>: ${err}`,
  'server.browser-erreur-non-geree': ({ tag }: MsgVars) => `[mjs-ssr-browser] unhandled error while rendering <${tag}> (crash caught by the framework with no <@failed> boundary to absorb it) — this render failed.`,
  'server.browser-shadow-closed': ({ tag }: MsgVars) => `[mjs-ssr-browser] shadowMode:'closed' for <${tag}>: the client CANNOT take over this render (closed Shadow DOM not detectable/adoptable) — the component will fail to hydrate. Use shadowMode:'open' (default) if this component must remain interactive on the client.`,
  'server.browser-demarrage-trop-long': ({ ms }: MsgVars) => `[mjs-ssr-browser] the browser did not start within ${ms}ms (launch or page creation stuck) — render abandoned (limit: twice render.browserPool.renderTimeoutMs).`,
  'server.browser-fermeture-navigateur-trop-long': ({ ms }: MsgVars) => `[mjs-ssr-browser] closing the browser did not complete within ${ms}ms (limit: twice render.browserPool.renderTimeoutMs, never under 10 s) — abandoned, the Chromium process is left to Playwright.`,
  'server.browser-fermeture-contexte-trop-long': ({ ms }: MsgVars) => `[mjs-ssr-browser] closing a slot context did not complete within ${ms}ms (limit: twice render.browserPool.renderTimeoutMs, never under 10 s) — abandoned, that context may stay alive inside Playwright.`,
  'server.browser-fermeture-attente-navigateur-trop-long': ({ ms }: MsgVars) => `[mjs-ssr-browser] waiting for the browser did not complete within ${ms}ms (engine resolution or launch stuck, limit: twice render.browserPool.renderTimeoutMs, never under 10 s) — abandoned, the browser will still be closed if it eventually arrives.`,
  'server.browser-fermeture-bundler-trop-long': ({ ms }: MsgVars) => `[mjs-ssr-browser] closing the bundler did not complete within ${ms}ms (limit: twice render.browserPool.renderTimeoutMs, never under 10 s) — abandoned, the shared worker pool may keep the process alive.`,
  'server.browser-render-timeout': ({ tag, renderTimeoutMs }: MsgVars) => `[mjs-ssr-browser] render of <${tag}> abandoned after ${renderTimeoutMs}ms (render timeout — mount/proxied fetch likely stuck).`,
  'server.browser-prerender-happydom-fallback': '[mjs] happy-dom prerender: install playwright for the browser engine (npm i -D playwright).',
  'server.browser-plusieurs-core': ({ files, first }: MsgVars) => `[mjs-ssr-browser] multiple mjs_core-*.js present (${files}) — deterministic load of ${first}.`,
  'server.browser-popup-fermee': ({ tag }: MsgVars) => `[mjs-ssr-browser] popup closed (window.open not tracked, never closed by Playwright) for <${tag}>`,
  'server.browser-route-echec': ({ url, erreur }: MsgVars) => `[mjs-ssr-browser] resource ${url} could not be served to the page (${erreur}): 500 response, rendering continues.`,
  'server.browser-releve-racine-echec': ({ tag, err }: MsgVars) => `[mjs-ssr-browser] reading the root keys read by <${tag}> failed (${err}) — the seed goes out without them: those texts will only arrive with the language file and may flicker on load.`,

  // --- src/server/renderToString.ts ---
  'server.ssr-import-circulaire': ({ names }: MsgVars) => `[mjs-ssr] circular @import detected — these modules cannot be ordered for server rendering: ${names}. Unlike the client bundle (live native ESM bindings), the SSR evaluates each module in a sequential IIFE and does not support circular dependencies. Remove the cycle between these files.`,
  'server.ssr-erreurs-compilation': ({ errors }: MsgVars) => `[mjs-ssr] compilation errors:\n${errors}`,
  'server.ssr-core-introuvable': '[mjs-ssr] mjs_core not found after compilation',
  'server.ssr-plusieurs-core': ({ files, first }: MsgVars) => `[mjs-ssr] multiple mjs_core-*.js present (${files}) — deterministic load of ${first}; clean up old hashed files in outputDir to avoid a stale core.`,
  'server.ssr-happydom-manquant': '[mjs-ssr] server rendering requires "happy-dom". Install it: npm i happy-dom',
  'server.ssr-happydom-trop-ancien': ({ found, required }: MsgVars) => `[mjs-ssr] server rendering requires happy-dom ${required} or later (installed version: ${found}). Below that, happy-dom loses the callback of a MutationObserver to garbage collection: a component stops seeing its attributes change and the render varies from one run to the next. Upgrade it: npm i happy-dom@^${required}`,
  'server.ssr-eval-echec': ({ message }: MsgVars) => `[mjs-ssr] bundle eval in happy-dom: ${message}`,
  'server.ssr-composant-non-enregistre': ({ tag }: MsgVars) => `[mjs-ssr] component <${tag}> not registered (check the filename is lowercase kebab-case)`,
  'server.ssr-erreur-non-geree': ({ tag }: MsgVars) => `[mjs-ssr] unhandled error while rendering <${tag}> (crash caught by the framework with no <@failed> boundary to absorb it) — this render failed.`,
  'server.ssr-injection-store-echec': ({ message }: MsgVars) => `[mjs-ssr] global store injection: ${message}`,
  'server.ssr-prop-invalide': ({ keyJson }: MsgVars) => `[mjs-ssr] invalid prop name ignored: ${keyJson}`,
  'server.ssr-serialisation-echec': ({ expr, errMsg }: MsgVars) => `[mjs-ssr] serialization failure for ${expr} (client will start without this state): ${errMsg}`,
  'server.ssr-non-stabilise': ({ tag, settleMs }: MsgVars) => `[mjs-ssr] render of <${tag}> not settled within ${settleMs}ms (scheduler busy or {await} still pending) — HTML potentially incomplete, hydration divergence possible.`,
  'server.ssr-shadow-closed': ({ tag }: MsgVars) => `[mjs-ssr] shadowMode:'closed' for <${tag}>: the client CANNOT take over this render (closed Shadow DOM not detectable/adoptable) — the component will fail to hydrate. Use shadowMode:'open' (default) if this component must remain interactive on the client.`,
  'server.ssr-forward-refuse-interne': ({ tag, host }: MsgVars) => `[mjs-ssr] render.forwardOrigin denied for <${tag}>: internal network target blocked (${host}) — falling back to the local origin.`,
  'server.ssr-forward-url-invalide': ({ tag }: MsgVars) => `[mjs-ssr] render.forwardOrigin denied for <${tag}>: invalid forwardedUrl — falling back to the local origin.`,
  'server.ssr-await-rejete-sans-branche': ({ tag, message }: MsgVars) => `[mjs-ssr] {await} rejected in <${tag}> with no {error} branch to consume it (${message}) — empty render server-side, add {error err}…{end} to display it.`,

  // --- src/server/serve-entry.ts (props/actions .server.mjs loaders) ---
  'server.entry-charge': ({ fichier }: MsgVars) => `[mjs serve] server loaders: ${fichier}`,
  'server.entry-echec': ({ fichier, erreur, actif }: MsgVars) => `[mjs serve] failed to load '${fichier}': ${erreur} — ${actif ? 'keeping previous loader' : 'loader inactive'}`,
  'server.entry-cle-ignoree': ({ cle }: MsgVars) => `[mjs serve] key '${cle}' ignored in server entry (expected: props/actions)`,
  'server.entry-props-invalides': ({ pathname }: MsgVars) => `[mjs serve] invalid props returned for '${pathname}' (expected an object) — ignored`,
  'server.entry-props-echec': ({ pathname, erreur }: MsgVars) => `[mjs serve] props loader failed for '${pathname}': ${erreur}`,

  // --- src/server/render-server.ts (POST forms) ---
  'server.form-cible-invalide': ({ pathname, cible }: MsgVars) => `[mjs serve] action for '${pathname}': invalid redirect (expected a string starting with '/'), received: ${cible}`,
  'server.form-resultat-invalide': ({ pathname }: MsgVars) => `[mjs serve] action for '${pathname}': invalid return shape (expected { redirect } or { errors })`,
  'server.form-fichier-ignore': ({ pathname, champ }: MsgVars) => `[mjs serve] action for '${pathname}': file field '${champ}' ignored (files not supported yet)`,
  'server.form-champ-reserve-ignore': ({ pathname, champ }: MsgVars) => `[mjs serve] action for '${pathname}': field '${champ}' rejected (reserved name) — value ignored`,
  // action execution catch log (unexpected 500, most common case in dev).
  'server.action-exception': ({ pathname, erreur }: MsgVars) => `[mjs serve] action for '${pathname}': uncaught exception (${erreur})`,
  // global catch log (last-resort net, any unexpected 500).
  'server.erreur-imprevue': ({ url, erreur }: MsgVars) => `[mjs serve] unexpected error for '${url}': ${erreur}`,
  // µres on first HTML load: serialization failure (circular reference...), never a 500.
  'server.res-serialisation-echec': ({ pathname, erreur }: MsgVars) => `[mjs serve] failed to serialize µres for '${pathname}' (page served without this state): ${erreur}`,

  // --- src/server/journal.ts (3-tier error journal) ---
  'server.journal-ecriture-echec': ({ erreur }: MsgVars) => `[mjs] error journal: write failed (${erreur}) — will retry silently on the next reports`,
  'server.journal-viewer-compile-echec': ({ erreur }: MsgVars) => `[mjs] error journal viewer: compilation failed (${erreur})`,
  // journal and theme viewers (marks in their source, see server/viewer-page.ts)
  'viewer.journal.titre': 'Error log',
  'viewer.journal.tous': 'All',
  'viewer.journal.serveur': 'Server',
  'viewer.journal.client': 'Client',
  'viewer.journal.rafraichir': 'Refresh',
  'viewer.journal.purger-serveur': 'Purge server',
  'viewer.journal.purger-client': 'Purge client',
  'viewer.journal.purger-tout': 'Purge all',
  'viewer.journal.purger-source-question': 'Purge the {source} entries from the log?',
  'viewer.journal.purger-tout-question': 'Purge ALL entries from the log?',
  'viewer.journal.echec': 'Loading failed — try again with Refresh.',
  'viewer.journal.vide': 'No errors — all is well.',
  'viewer.journal.premier': 'first',
  'viewer.journal.dernier': 'last',
  'viewer.theme.titre': 'Theme variables',
  'viewer.theme.kind-module': 'module',
  'viewer.theme.kind-theme': 'theme',
  'viewer.theme.kind-framework': 'framework',
  'viewer.theme.kind-stylesheet': 'shared stylesheet',
  'viewer.theme.motif-introuvable': 'declaration not found in the file — rebuild?',
  'viewer.theme.motif-ambigu': 'several declarations in this file, the line cannot be decided',
  'viewer.theme.motif-inchange': 'already this color',
  'viewer.theme.motif-hors-projet': 'file outside the project (framework, symbolic link)',
  'viewer.theme.motif-racine-inconnue': 'project root unknown to the server',
  'viewer.theme.motif-valeur-refusee': 'value refused by the filter',
  'viewer.theme.motif-nom-refuse': 'variable name refused',
  'viewer.theme.motif-fichier-manquant': 'no known declaring file',
  'viewer.theme.ecrit-dans': 'written to',
  'viewer.theme.compte-source-1': '{n} source',
  'viewer.theme.compte-source-n': '{n} sources',
  'viewer.theme.compte-variable-1': '{n} variable',
  'viewer.theme.compte-variable-n': '{n} variables',
  'viewer.theme.compte-declaration-1': '{n} declaration',
  'viewer.theme.compte-declaration-n': '{n} declarations',
  'viewer.theme.compte-defaut-1': '{n} component default value',
  'viewer.theme.compte-defaut-n': '{n} component default values',
  'viewer.theme.compte-posee-1': '{n} variable set by the component',
  'viewer.theme.compte-posee-n': '{n} variables set by the component',
  'viewer.theme.compte-lue-1': '{n} variable read by at least one component',
  'viewer.theme.compte-lue-n': '{n} variables read by at least one component',
  'viewer.theme.compte-direct-1': 'Live preview — {n} page listening',
  'viewer.theme.compte-direct-n': 'Live preview — {n} pages listening',
  'viewer.theme.compte-retablir-1': 'Reset the modified color',
  'viewer.theme.compte-retablir-n': 'Reset the {n} modified colors',
  'viewer.theme.compte-lecteur-1': '{n} reader',
  'viewer.theme.compte-lecteur-n': '{n} readers',
  'viewer.theme.enregistrer': 'Save to the source',
  'viewer.theme.precision-ecrit': 'Each chosen color is written to the exact line where its source declares it. Reset only undoes the preview: what is written stays written.',
  'viewer.theme.precision-apercu': 'Nothing is written to disk: close the tab and everything comes back.',
  'viewer.theme.lecture-seule-direct': 'Read only — the live preview needs mjs dev.',
  'viewer.theme.vide': "This project declares and reads no theme variable ($$) yet — that is the compiler's default silence, not a failure.",
  'viewer.theme.recherche-label': 'Search a theme variable',
  'viewer.theme.recherche-placeholder': 'Search a variable, a declarer, a reader…',
  'viewer.theme.filtre-tous': 'All',
  'viewer.theme.filtre-themes': 'Themes',
  'viewer.theme.filtre-modules': 'Modules',
  'viewer.theme.filtre-feuilles': 'Shared stylesheets',
  'viewer.theme.filtre-framework': 'Framework',
  'viewer.theme.aucune': 'No variable matches the search.',
  'viewer.theme.variante': 'variant',
  'viewer.theme.badge-defauts': 'default values',
  'viewer.theme.badge-posees': 'set by the component',
  'viewer.theme.badge-lecture-seule': 'read-only',
  'viewer.theme.plier': 'Fold or unfold the variables set by',
  'viewer.theme.couleur-de': 'Color of',
  'viewer.theme.source': 'source',
  'viewer.theme.retablir-nom': 'Reset',
  'viewer.theme.retablir': 'reset',
  'viewer.theme.par-defaut': 'default',
  'viewer.theme.ligne': 'line',
  'viewer.theme.ligne-inconnue': 'unknown line',
  'viewer.theme.ailleurs': 'elsewhere',
  'viewer.theme.doc-posee': 'sets this variable itself, in its script, template or CSS: what you declare on it may change nothing.',
  'viewer.theme.doc-lue': 'reads this variable with this default, written in its CSS. To set it, declare it in the application theme, on :root or on an ancestor of the component.',
  'viewer.theme.cible-posee': 'No write possible: this variable is set by the component.',
  'viewer.theme.cible-defaut': 'No write possible: this default is not a declaration.',
  'viewer.theme.cible-vers': 'Saving to',
  'viewer.theme.cible-ligne-cherchee': 'line searched in the file',
  'viewer.theme.cible-framework': 'No write possible: this declaration belongs to the framework.',
  'viewer.theme.cascade-lue': 'Declarations exist for this name — the cascade applies, the one closest to the component wins over this default.',
  'viewer.theme.cascade-ailleurs': 'This name is also declared elsewhere — the cascade applies, the closest wins, and the live preview repaints them all together. Saving only touches the line above.',
  'viewer.theme.sans-lecteur': 'No reader — declared but never used.',
  'viewer.theme.lu-par': 'Read by',
  'server.journal-viewer-manifest-absent': `manifest not found (mjs build required)`,
  'server.journal-viewer-core-introuvable': `core import not found in the manifest`,
  'server.viewer-runtime-introuvable': ({ fichier, dossier }: MsgVars) => `runtime file '${fichier}' not found in ${dossier}: the viewer cannot bring what your bare core does not include`,
  'server.viewer-import-coeur-introuvable': `core import not found at the top of the viewer script: cannot add what your bare core does not include`,

  // --- src/server/theme-viewer.mjs / viewer-page.ts (/__mjs/theme workshop) ---
  'server.theme-viewer-compile-echec': ({ erreur }: MsgVars) => `[mjs] theme variables workshop: compilation failed (${erreur})`,

  // --- src/server/ssr-head.ts (SSR themed <head> anti-flash) ---
  'server.ssr-head-echec': ({ erreur }: MsgVars) => `[mjs] SSR themed <head> construction: failed (${erreur}) — page served without inlined theme`,

  // --- src/server/prerender.ts ---
  'server.prerender-fichier-perime-supprime': ({ file }: MsgVars) => `stale file removed (${file})`,
  'server.prerender-fragment-sans-route': ({ file }: MsgVars) => `fragment with no route removed (${file})`,
  'server.prerender-dossier-vide-retire': ({ dir }: MsgVars) => `directory emptied of its fragments removed (${dir})`,
  'server.prerender-echec-suppression': ({ file, err }: MsgVars) => `failed to remove stale file ${file}: ${err}`,

  // --- src/mjs-server/index.ts ---
  'serveur.index-movesperidentity-invalide': ({ received }: MsgVars) => `[MJS-Server] opts.antiCheat.movesPerIdentity must be [integer n ≥ 1, finite windowMs > 0] or null/absent (disables the quota), received: ${received}`,
  'serveur.index-codeperip-invalide': ({ received }: MsgVars) => `[MJS-Server] opts.antiCheat.codePerIp must be [integer n ≥ 1, finite windowMs > 0] or null (disables the lock) or absent (default), received: ${received}`,
  'serveur.index-privategamespercreator-invalide': ({ received }: MsgVars) => `[MJS-Server] opts.antiCheat.privateGamesPerCreator must be an integer ≥ 1, or null (disables the limit) or absent (default: 5), received: ${received}`,
  'serveur.index-serve-prefixe-reserve': ({ type, prefix }: MsgVars) => `[MJS-Server] app.serve('${type}', …): reserved prefix — '${prefix}' is MJS-Server's internal plumbing, invisible to the host app`,
  'serveur.index-on-prefixe-reserve': ({ type, prefix }: MsgVars) => `[MJS-Server] app.on('${type}', …): reserved prefix — '${prefix}' is MJS-Server's internal plumbing, invisible to the host app`,
  'serveur.index-schema-prefixe-reserve': ({ type, prefix }: MsgVars) => `[MJS-Server] schema '${type}': reserved prefix — '${prefix}' cannot travel in binary, its payload carries a game view (an object) that µschema v1 cannot describe; the view would encode to an empty value WITHOUT throwing`,
  'serveur.index-game-deja-declare': ({ type }: MsgVars) => `[MJS-Server] app.game('${type}', …): already declared`,

  // --- src/mjs-server/history.ts ---
  'serveur.histo-ticks-invalide': ({ received }: MsgVars) => `[MJS-Server] history.ticks must be an integer ≥ 1, received: ${received}`,
  'serveur.histo-tampon-vide': "[MJS-Server] game.rewind(): empty buffer (no tick elapsed yet, or game destroyed)",
  'serveur.histo-instant-invalide': ({ received }: MsgVars) => `[MJS-Server] game.rewind(): the instant must be a finite number (timestamp in ms, see game.timeSeenBy), received: ${received}`,

  // --- src/mjs-server/space.ts ---
  'serveur.space-cell-invalide': ({ received }: MsgVars) => `[MJS-Server] space.cell must be a number > 0, received: ${received}`,
  'serveur.space-query-invalide': ({ x, y, radius }: MsgVars) => `[MJS-Server] space.query(${x}, ${y}, ${radius}): non-finite coordinates/radius — empty result`,

  // --- src/mjs-server/matchmaking.ts ---
  // public queue full (DEFAULT_QUEUE_CAP cap)
  'serveur.matchmaking-file-pleine': ({ type }: MsgVars) => `queue full for '${type}' — try again later`,
  'serveur.matchmaking-parties-privees-limite': ({ max }: MsgVars) => `limit of private games in progress reached (${max}): wait until one of your games ends before creating another`,
  'serveur.matchmaking-parties-privees-siege-limite': ({ max }: MsgVars) => `you already have a seat in ${max} private games in progress (limit reached): leave one, or wait until one ends, before creating or joining another`,
  'serveur.matchmaking-arret-en-cours': 'the server is shutting down: your move was not played — play it again once it has restarted',
  'serveur.matchmaking-trop-tentatives-code': 'too many code attempts — please wait',
  'serveur.matchmaking-code-inconnu': ({ code }: MsgVars) => `unknown code '${code}'`,
  'serveur.matchmaking-play-type-manquant': 'µgame:play: missing game type',
  'serveur.matchmaking-type-jeu-inconnu': ({ type }: MsgVars) => `unknown game type '${type}'`,
  'serveur.matchmaking-spectateur-doit-etre-bool': 'µgame:play: spectator must be true or absent',
  'serveur.matchmaking-spectateur-sans-code-prive': ({ type }: MsgVars) => `game '${type}' does not support private games — a spectator must target an existing game by code`,
  'serveur.matchmaking-spectateur-code-requis': 'µgame:play: spectator requires an existing game code',
  'serveur.matchmaking-jeu-sans-parties-privees': ({ type }: MsgVars) => `game '${type}' does not support private games`,
  'serveur.matchmaking-code-invalide': 'invalid code',
  'serveur.matchmaking-move-partie-manquante': 'µgame:move: missing game',
  'serveur.matchmaking-move-coup-manquant': 'µgame:move: missing move',
  'serveur.matchmaking-partie-introuvable': 'game not found',
  'serveur.matchmaking-leave-partie-manquante': 'µgame:leave: missing game',
  'serveur.matchmaking-resync-partie-manquante': 'µgame:resync: missing game',
  'serveur.matchmaking-entree-refusee': 'your entry into the game was refused',
  'serveur.matchmaking-appariement-echoue': ({ msg }: MsgVars) => `[MJS-Server] matching a queue group failed: ${msg}`,

  // --- src/mjs-server/persist.ts ---
  'serveur.cle-inconnue': ({ prefix, k, hint, clesValides }: MsgVars) => `${prefix}.${k}: unknown key${hint}\n  Valid keys: ${clesValides}`,
  'serveur.cle-inconnue-suggestion': ({ suggestion }: MsgVars) => ` — did you mean '${suggestion}'?`,
  'serveur.persist-option-invalide': ({ prefix, received }: MsgVars) => `${prefix}: expected an adapter { load, save, remove } or { adapter, debounce?, snapshotEvery? }, received: ${received}`,
  'serveur.persist-adaptateur-invalide': ({ prefix, received }: MsgVars) => `${prefix}.adapter must expose { load(), save(id, data), remove(id) }, received: ${received}`,
  'serveur.persist-debounce-invalide': ({ prefix, received }: MsgVars) => `${prefix}.debounce must be a number ≥ 0 (ms), received: ${received}`,
  'serveur.persist-snapshotevery-invalide': ({ prefix, received }: MsgVars) => `${prefix}.snapshotEvery must be a number ≥ 0 (ms, 0 = disabled), received: ${received}`,
  'serveur.persist-save-echoue': ({ id }: MsgVars) => `[MJS-Server] persist.save('${id}') failed`,
  'serveur.persist-remove-echoue': ({ id }: MsgVars) => `[MJS-Server] persist.remove('${id}') failed`,
  'serveur.persist-save-sans-reponse': ({ id, delai }: MsgVars) => `[MJS-Server] persist.save('${id}'): no response from the adapter within ${Math.round(Number(delai) * 10) / 10} s — write abandoned, saving of the game carries on; if it eventually completes, the current state of the game is written again over it (check your storage)`,
  'serveur.persist-remove-sans-reponse': ({ id, delai }: MsgVars) => `[MJS-Server] persist.remove('${id}'): no response from the adapter within ${Math.round(Number(delai) * 10) / 10} s — removal abandoned, the game may come back at the next start; if it eventually completes after the identifier was reused, the new game is written again (check your storage)`,
  'serveur.persist-flush-sans-reponse': ({ delai }: MsgVars) => `[MJS-Server] persist.flush(): no response from the adapter within ${Math.round(Number(delai) * 10) / 10} s — the shutdown carries on without waiting for it (check your storage)`,
  'serveur.persist-save-tardive': ({ id }: MsgVars) => `[MJS-Server] persist.save('${id}'): the abandoned write finally answered and may have replaced a more recent state — the current state of the game is written again`,
  'serveur.persist-remove-tardive': ({ id }: MsgVars) => `[MJS-Server] persist.remove('${id}'): the abandoned removal finally answered and may have erased the game recreated under the same identifier — its current state is written again`,
  'serveur.persist-save-tardive-partie-finie': ({ id }: MsgVars) => `[MJS-Server] persist.save('${id}'): the abandoned write finally answered after the end of the game and may have recreated its row — the removal is sent again`,
  'serveur.persist-ecriture-tardive-arret': ({ id }: MsgVars) => `[MJS-Server] persist('${id}'): an abandoned write answered during the shutdown and may have replaced a more recent state, which the shutdown does not write again (check your storage)`,
  'serveur.persist-load-echoue': '[MJS-Server] persist.load() failed — starting WITHOUT restoration',
  'serveur.persist-load-pas-un-tableau': ({ recu }: MsgVars) => `[MJS-Server] persist.load() must return an array of saves { id, data } — received: ${recu}; starting WITHOUT restoration`,
  'serveur.persist-partie-ignoree': ({ id, type }: MsgVars) => `[MJS-Server] persist: game '${id}' ignored — type '${type}' not declared (missing app.game()?)`,
  'serveur.persist-restauration-echouee': ({ id }: MsgVars) => `[MJS-Server] persist: restoring '${id}' failed`,
  'serveur.persist-restauration-doublon': ({ id }: MsgVars) => `[MJS-Server] persist: game '${id}' is already restored from another save returned by load() — this one is ignored (a backup copy in your storage?)`,

  // --- src/mjs-server/persist-sql.ts ---
  'serveur.persist-sql-query-manquant': '[MJS-Server] persist-sql: opts.query missing — expected (sql, params) => Promise',
  'serveur.persist-sql-dialect-invalide': ({ received }: MsgVars) => `[MJS-Server] persist-sql: opts.dialect must be '?' or '$', received: ${received}`,
  'serveur.persist-sql-table-invalide': ({ table }: MsgVars) => `[MJS-Server] persist-sql: opts.table '${table}' is not a valid SQL identifier`,

  // --- src/mjs-server/persist-bridge.ts ---
  'serveur.persist-bridge-delai-depasse': 'request timeout exceeded',
  'serveur.persist-bridge-url-manquant': '[MJS-Server] persist-bridge: opts.url missing',
  'serveur.persist-bridge-secret-manquant': '[MJS-Server] persist-bridge: opts.secret missing',
  'serveur.persist-bridge-http-non-loopback': ({ url }: MsgVars) => `[MJS-Server] persist-bridge (${url}): http:// non-loopback = risk of MITM-forged restored state — use https:// or, knowingly, { allowInsecure: true }`,
  'serveur.persist-bridge-reponse-http': ({ status }: MsgVars) => `HTTP response ${status}`,
  'serveur.persist-bridge-reponse-trop-grande': ({ max }: MsgVars) => `[MJS-Server] persist-bridge: response too large (> ${max} bytes), aborting`,
  'serveur.persist-bridge-delai-global-depasse': '[MJS-Server] persist-bridge: global timeout exceeded',

  // --- src/mjs-server/persist-file.ts ---
  'serveur.persist-file-dir-manquant': '[MJS-Server] persist-file: opts.dir missing',
  'serveur.persist-file-id-invalide': ({ id }: MsgVars) => `[MJS-Server] persist-file: invalid game id: '${id}'`,
  'serveur.persist-file-id-hors-dossier': ({ id }: MsgVars) => `[MJS-Server] persist-file: invalid game id: '${id}' (resolved path outside the storage directory)`,

  // --- src/mjs-server/game.ts ---
  'serveur.game-def-invalide': ({ prefix }: MsgVars) => `${prefix}: the definition must be an object { seats, state, moves, ... }`,
  'serveur.game-places-invalide': ({ prefix, received }: MsgVars) => `${prefix}.seats must be an integer ≥ 1, received: ${received}`,
  'serveur.game-code-invalide': ({ prefix, received, receivedType }: MsgVars) => `${prefix}.code must be a boolean, received: ${received} (${receivedType})`,
  'serveur.game-seatttl-invalide': ({ prefix, received }: MsgVars) => `${prefix}.seatTtl must be a number > 0 (ms), received: ${received}`,
  'serveur.game-tick-invalide': ({ prefix, received }: MsgVars) => `${prefix}.tick must be a number ≥ 0, received: ${received}`,
  'serveur.game-tick-hors-plage': ({ prefix, tickHz }: MsgVars) => `${prefix}.tick must be 0 (event-driven) or between 1 and 60 (Hz), received: ${tickHz}`,
  'serveur.game-mode-invalide': ({ prefix, received }: MsgVars) => `${prefix}.mode must be 'authoritative' or 'lockstep', received: ${received}`,
  'serveur.game-tick-requis-lockstep': ({ prefix }: MsgVars) => `${prefix}.tick must be > 0 in 'lockstep' mode — order-batching cadence, cf. def.mode`,
  'serveur.game-state-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.state forbidden in 'lockstep' mode — the room simulates nothing (no server state), cf. def.mode`,
  'serveur.game-state-requis': ({ prefix, received }: MsgVars) => `${prefix}.state is required — function (game) => initial state, received: ${received}`,
  'serveur.game-moves-requis': ({ prefix }: MsgVars) => `${prefix}.moves is required — object { name: (game, player, p) => result }`,
  'serveur.game-moves-nom-invalide': ({ prefix, nom, received }: MsgVars) => `${prefix}.moves.${nom} must be a function, received: ${received}`,
  'serveur.game-view-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.view forbidden in 'lockstep' mode — no server state to filter, cf. def.mode`,
  'serveur.game-view-invalide': ({ prefix, received }: MsgVars) => `${prefix}.view must be a function (game, player) => view, received: ${received}`,
  'serveur.game-ondivergence-hors-lockstep': ({ prefix }: MsgVars) => `${prefix}.onDivergence requires mode: 'lockstep' — no divergence detection outside lockstep`,
  'serveur.game-ondivergence-invalide': ({ prefix, received }: MsgVars) => `${prefix}.onDivergence must be a function (game, {tick, suspects, reason}) => void, received: ${received}`,
  'serveur.game-lockstepjournal-hors-lockstep': ({ prefix }: MsgVars) => `${prefix}.lockstepJournal requires mode: 'lockstep' — no order journal outside lockstep`,
  'serveur.game-lockstepjournal-invalide': ({ prefix }: MsgVars) => `${prefix}.lockstepJournal must be an object { maxTicks?, maxBytes?, maxOrderBytes? }`,
  'serveur.game-lockstepjournal-maxticks-invalide': ({ prefix, received }: MsgVars) => `${prefix}.lockstepJournal.maxTicks must be an integer ≥ 1, received: ${received}`,
  'serveur.game-lockstepjournal-maxbytes-invalide': ({ prefix, received }: MsgVars) => `${prefix}.lockstepJournal.maxBytes must be an integer ≥ 1 (bytes), received: ${received}`,
  'serveur.game-lockstepjournal-maxorderbytes-invalide': ({ prefix, received }: MsgVars) => `${prefix}.lockstepJournal.maxOrderBytes must be an integer ≥ 1 (bytes), received: ${received}`,
  'serveur.game-phases-invalide': ({ prefix }: MsgVars) => `${prefix}.phases must be an object { phase: [allowed moves] }`,
  'serveur.game-phases-valeur-invalide': ({ prefix, phase, received }: MsgVars) => `${prefix}.phases.${phase} must be an array of move names (string[]), received: ${received}`,
  'serveur.game-turns-invalide': ({ prefix }: MsgVars) => `${prefix}.turns must be an object { order?, timeout? }`,
  'serveur.game-turns-order-invalide': ({ prefix, received }: MsgVars) => `${prefix}.turns.order must be 'roundrobin' or a function (game) => player, received: ${received}`,
  'serveur.game-turns-timeout-invalide': ({ prefix, received }: MsgVars) => `${prefix}.turns.timeout must be a number > 0 (ms), received: ${received}`,
  'serveur.game-timers-invalide': ({ prefix }: MsgVars) => `${prefix}.timers must be an object { name: (game) => void }`,
  'serveur.game-timers-nom-reserve': ({ prefix, nom }: MsgVars) => `${prefix}.timers.${nom}: RESERVED timer name (internal to MJS-Server) — choose another name`,
  'serveur.game-timers-nom-invalide': ({ prefix, nom, received }: MsgVars) => `${prefix}.timers.${nom} must be a function, received: ${received}`,
  'serveur.game-limits-invalide': ({ prefix }: MsgVars) => `${prefix}.limits must be an object { moves?: [n, windowMs], moveIntervalMs?: ms, moveWaitMs?: ms }`,
  'serveur.game-limits-moves-invalide': ({ prefix, received }: MsgVars) => `${prefix}.limits.moves must be [integer n ≥ 1, finite windowMs > 0] or null (disables the rate limit), received: ${received}`,
  'serveur.game-limits-moveintervalms-invalide': ({ prefix, received }: MsgVars) => `${prefix}.limits.moveIntervalMs must be a number > 0 (ms), received: ${received}`,
  'serveur.game-limits-movewaitms-invalide': ({ prefix, received }: MsgVars) => `${prefix}.limits.moveWaitMs must be a finite number > 0 and at most 2147483647 (ms, about 24.8 days: the longest Node timer delay), received: ${received}`,
  'serveur.game-emptyttl-invalide': ({ prefix, received }: MsgVars) => `${prefix}.emptyTtl must be a number > 0 (ms), received: ${received}`,
  'serveur.game-endttl-invalide': ({ prefix, received }: MsgVars) => `${prefix}.endTtl must be a number > 0 (ms), received: ${received}`,
  'serveur.valeur-recue-fonction': '[function]',
  'serveur.valeur-recue-objet': '[object]',
  'serveur.game-hooks-invalide': ({ prefix }: MsgVars) => `${prefix}.hooks must be an object { onCreate?, onJoin?, onLeave?, onEnd?, onTurnTimeout? }`,
  'serveur.game-hooks-nom-invalide': ({ prefix, nom, received }: MsgVars) => `${prefix}.hooks.${nom} must be a function, received: ${received}`,
  'serveur.game-intents-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.intents forbidden in 'lockstep' mode — every µgame:move becomes an ORDER broadcast as-is, cf. def.mode`,
  'serveur.game-intents-invalide': ({ prefix }: MsgVars) => `${prefix}.intents must be an object { name: (game, player, p) => void }`,
  'serveur.game-intents-tick-requis': ({ prefix }: MsgVars) => `${prefix}.intents requires tick > 0 (action mode) — without a loop, intents would never be applied`,
  'serveur.game-intents-nom-invalide': ({ prefix, nom, received }: MsgVars) => `${prefix}.intents.${nom} must be a function, received: ${received}`,
  'serveur.game-intents-nom-collision': ({ prefix, nom }: MsgVars) => `${prefix}.intents.${nom}: name already used by moves.${nom} — a move cannot be both a classic move and an intent`,
  'serveur.game-simulate-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.simulate forbidden in 'lockstep' mode — the server computes nothing, cf. def.mode`,
  'serveur.game-simulate-invalide': ({ prefix, received }: MsgVars) => `${prefix}.simulate must be a function (game, dt) => void, received: ${received}`,
  'serveur.game-simulate-tick-requis': ({ prefix }: MsgVars) => `${prefix}.simulate requires tick > 0 (action mode)`,
  'serveur.game-slowtick-invalide': ({ prefix }: MsgVars) => `${prefix}.slowTick must be an object { hz, fn }`,
  'serveur.game-slowtick-hz-invalide': ({ prefix, received }: MsgVars) => `${prefix}.slowTick.hz must be a number > 0, received: ${received}`,
  'serveur.game-slowtick-fn-invalide': ({ prefix, received }: MsgVars) => `${prefix}.slowTick.fn must be a function (game) => void, received: ${received}`,
  'serveur.game-slowtick-tick-requis': ({ prefix }: MsgVars) => `${prefix}.slowTick requires tick > 0 (action mode)`,
  'serveur.game-deltas-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.deltas forbidden in 'lockstep' mode — nothing to broadcast as a delta (no state), cf. def.mode`,
  'serveur.game-deltas-invalide': ({ prefix, received }: MsgVars) => `${prefix}.deltas must be a boolean, received: ${received}`,
  'serveur.game-space-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.space forbidden in 'lockstep' mode — no area of interest without server state, cf. def.mode`,
  'serveur.game-space-invalide': ({ prefix }: MsgVars) => `${prefix}.space must be an object { cell }`,
  'serveur.game-space-cell-invalide': ({ prefix, received }: MsgVars) => `${prefix}.space.cell must be a number > 0, received: ${received}`,
  'serveur.game-histo-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.history forbidden in 'lockstep' mode — no server positions to log, cf. def.mode`,
  'serveur.game-histo-invalide': ({ prefix }: MsgVars) => `${prefix}.history must be an object { ticks, extract?, interp? }`,
  'serveur.game-histo-tick-requis': ({ prefix }: MsgVars) => `${prefix}.history requires tick > 0 (action mode) — without a loop, no tick to log`,
  'serveur.game-histo-ticks-invalide': ({ prefix, received }: MsgVars) => `${prefix}.history.ticks must be an integer ≥ 1, received: ${received}`,
  'serveur.game-histo-extraire-invalide': ({ prefix, received }: MsgVars) => `${prefix}.history.extract must be a function (game) => positions, received: ${received}`,
  'serveur.game-histo-extraire-requis': ({ prefix }: MsgVars) => `${prefix}.history.extract is required when def.space is not declared — no default extractor without an area of interest`,
  'serveur.game-histo-interp-invalide': ({ prefix, received }: MsgVars) => `${prefix}.history.interp must be a number ≥ 0 (ms) — 0 = no interpolation delay declared, received: ${received}`,
  'serveur.game-suspect-invalide': ({ prefix, received }: MsgVars) => `${prefix}.suspect must be a function (move, context) => result, received: ${received}`,
  'serveur.game-antirejeu-invalide': ({ prefix, received }: MsgVars) => `${prefix}.antiReplay must be true (or absent), received: ${received}`,
  'serveur.game-onsuspicion-invalide': ({ prefix, received }: MsgVars) => `${prefix}.onSuspicion must be a function (event) => void, received: ${received}`,
  'serveur.game-spectatorview-invalide': ({ prefix, received }: MsgVars) => `${prefix}.spectatorView must be a function (game) => view, received: ${received}`,
  'serveur.game-view-absente-avertissement': ({ type }: MsgVars) => `game('${type}'): def.view absent — the FULL state is broadcast to every seat; define def.view to hide secret state`,

  // --- src/mjs-server/game.ts ---
  'serveur.partie-phase-inconnue': ({ phase, phases }: MsgVars) => `[MJS-Server] game.to('${phase}'): unknown phase — declared phases: ${phases}`,
  'serveur.partie-timer-nom-reserve': ({ nom }: MsgVars) => `[MJS-Server] game.timer('${nom}', …): reserved name (internal to MJS-Server)`,
  'serveur.partie-timer-inconnu': ({ nom, timers }: MsgVars) => `[MJS-Server] game.timer('${nom}', …): undeclared timer — declare it in timers (declared timers: ${timers})`,
  'serveur.partie-timer-aucun': 'none',
  'serveur.partie-vuede-lockstep': "[MJS-Server] game.viewFor(): unavailable in 'lockstep' mode (no server state, cf. def.mode)",
  'serveur.partie-rembobiner-sans-histo': '[MJS-Server] game.rewind() requires def.history — cf. game.ts',
  'serveur.partie-instantvupar-sans-histo': '[MJS-Server] game.timeSeenBy() requires def.history — cf. game.ts',
  'serveur.partie-complete': 'game full',
  'serveur.partie-pas-dans-partie': 'you are not in this game',
  'serveur.partie-spectateur-sans-vue': ({ type }: MsgVars) => `game('${type}'): spectator without def.spectatorView/def.view — no state broadcast (anti-leak)`,
  'serveur.partie-pas-assis': 'you are not seated in this game',
  'serveur.partie-terminee': 'game ended',
  'serveur.partie-spectateur-lecture-seule': 'spectator: read-only',
  'serveur.partie-coup-interdit-phase': ({ coup, phase }: MsgVars) => `move '${coup}' forbidden in phase '${phase}'`,
  'serveur.partie-pas-votre-tour': 'it is not your turn',
  'serveur.partie-trop-de-coups': 'too many moves, slow down',
  'serveur.partie-coup-sans-fin': ({ coup, ms }: MsgVars) => `[MJS-Server] move '${coup}' still not settled after ${ms} ms (limits.moveWaitMs): its request gets an error, and the player's next moves are refused until it ends`,
  'serveur.partie-coup-sans-reponse': ({ coup, ms }: MsgVars) => `your move '${coup}' got no answer within ${ms} ms (limits.moveWaitMs): it keeps running on the server, and your next moves are refused until it ends`,
  'serveur.partie-coup-precedent-en-cours': 'your previous move is still in progress',
  'serveur.partie-ordre-trop-gros': ({ taille, max }: MsgVars) => `order too large (${taille} bytes, ${max} at most): it was not sent — reduce its payload or raise lockstepJournal.maxOrderBytes`,
  'serveur.partie-journal-lockstep-plein': ({ id, max }: MsgVars) => `game ${id} ended: its lockstep journal would exceed ${max} bytes (lockstepJournal.maxBytes) — reason 'journal-full'`,
  'serveur.partie-coup-inconnu': ({ coup }: MsgVars) => `unknown move '${coup}'`,
  'serveur.partie-tick-rejete': ({ quoi, msg }: MsgVars) => `tick loop — ${quoi} rejected: ${msg}`,
  'serveur.partie-tick-leve': ({ quoi, msg }: MsgVars) => `tick loop — ${quoi} threw: ${msg}`,
  'serveur.partie-coup-rejete-suspect': ({ coup, raison }: MsgVars) => `[MJS-Server] move '${coup}' rejected — suspect (${raison})`,
  'serveur.partie-coup-rejete-rejeu': ({ coup, seq, dernier }: MsgVars) => `[MJS-Server] move '${coup}' rejected — replay detected (seq ${seq} ≤ ${dernier})`,
  'serveur.partie-coup-rejete-sequence-avance': ({ coup, seq, dernier }: MsgVars) => `[MJS-Server] move '${coup}' rejected — sequence too far ahead (seq ${seq}, last ${dernier})`,
  'serveur.partie-coup-rejete-cadence': ({ coup }: MsgVars) => `[MJS-Server] move '${coup}' rejected — too fast a pace`,
  'serveur.partie-coup-rejete-quota-identite': ({ coup }: MsgVars) => `[MJS-Server] move '${coup}' rejected — per-identity move quota exceeded`,
  'serveur.partie-timer-applicatif-rejete': ({ nom, msg }: MsgVars) => `[MJS-Server] timer('${nom}') rejected: ${msg}`,
  'serveur.partie-timer-applicatif-leve': ({ nom, msg }: MsgVars) => `[MJS-Server] timer('${nom}') threw: ${msg}`,
  'serveur.partie-vue-leve': ({ msg }: MsgVars) => `[MJS-Server] def.view threw — frame skipped for this seat: ${msg}`,
  'serveur.partie-spectatorview-leve': ({ msg }: MsgVars) => `[MJS-Server] def.spectatorView threw (or def.view called without a player, when it is missing) — frame skipped for the spectators: ${msg}`,
  'serveur.partie-onturntimeout-leve': ({ msg }: MsgVars) => `[MJS-Server] hooks.onTurnTimeout threw at the turn deadline — the game carries on: ${msg}`,
  'serveur.partie-onturntimeout-rejete': ({ msg }: MsgVars) => `[MJS-Server] hooks.onTurnTimeout rejected at the turn deadline — the game carries on: ${msg}`,
  'serveur.partie-turns-order-timeout-leve': ({ msg }: MsgVars) => `[MJS-Server] turns.order threw on the automatic turn change (turns.timeout expired) — the turn stays with the same seat, no new deadline is armed: ${msg}`,
  'serveur.partie-turns-order-depart-leve': ({ msg }: MsgVars) => `[MJS-Server] turns.order threw when the player whose turn it was left — the departure ran to completion, the error of hooks.onLeave was returned to the leaving player: ${msg}`,
  'serveur.partie-turns-order-refus-leve': ({ msg }: MsgVars) => `[MJS-Server] turns.order threw when the player whose turn it was was refused — the refusal ran to completion, the turn did not change hands: ${msg}`,
  'serveur.partie-onleave-rejete': ({ msg }: MsgVars) => `[MJS-Server] hooks.onLeave rejected — the departure ran to completion, the leaving player has already been answered: ${msg}`,
  'serveur.partie-onjoin-rejete': ({ msg }: MsgVars) => `[MJS-Server] hooks.onJoin rejected — player refused after the fact: ${msg}`,
  'serveur.partie-onjoin-rejete-code': ({ msg }: MsgVars) => `[MJS-Server] hooks.onJoin rejected — player refused: ${msg}`,
  'serveur.partie-onjoin-rejete-file': ({ msg }: MsgVars) => `[MJS-Server] hooks.onJoin rejected — player refused, the queue group is not announced: ${msg}`,
  'serveur.partie-onend-rejete': ({ msg }: MsgVars) => `[MJS-Server] hooks.onEnd rejected — the game end went through: ${msg}`,
  'serveur.partie-oncreate-rejete': ({ msg }: MsgVars) => `[MJS-Server] hooks.onCreate rejected — the game is created anyway: ${msg}`,
  'serveur.partie-histo-extraire-leve': ({ msg }: MsgVars) => `[MJS-Server] def.history.extract threw — tick skipped for history: ${msg}`,
  'serveur.restore-invalide': ({ champ, attendu }: MsgVars) => `[MJS-Server] restoreGame(): invalid field '${champ}' (expected ${attendu})`,
  'serveur.restore-attendu-objet': 'an object',
  'serveur.restore-champ-racine': 'root',
  'serveur.restore-attendu-chaine-non-vide': 'a non-empty string',
  'serveur.restore-attendu-tableau': 'an array',
  'serveur.restore-attendu-siege': '{seat:number, id:string} or null',
  'serveur.restore-attendu-minuterie': '{name:string, at:number}',

  // --- src/mjs-server/persist-redis.ts + persist-bridge.ts + persist-sql.ts + persist-file.ts (mutualisées) ---
  'serveur.persist-backend-rejet-non-intercepte': ({ backend, label }: MsgVars) => `persist-${backend}: ${label} — uncaught rejection`,
  'serveur.persist-backend-load-echoue': ({ backend }: MsgVars) => `persist-${backend}: load() failed — starting WITHOUT restoration`,
  'serveur.persist-backend-save-echouee': ({ backend, id }: MsgVars) => `persist-${backend}: save('${id}') failed`,
  'serveur.persist-backend-remove-echouee': ({ backend, id }: MsgVars) => `persist-${backend}: remove('${id}') failed`,
  'serveur.persist-backend-entree-illisible': ({ backend, id }: MsgVars) => `persist-${backend}: entry '${id}' unreadable (invalid JSON) — ignored`,
  'serveur.persist-backend-flush-sans-reponse': ({ backend, nb, delai }: MsgVars) => `persist-${backend}: flush() — ${nb} write(s) without a response after ${delai} s, the shutdown carries on without waiting for them (check your storage)`,

  // --- src/mjs-server/persist-redis.ts ---
  'serveur.persist-redis-operation-echouee': ({ label }: MsgVars) => `persist-redis: ${label} failed`,
  'serveur.persist-redis-connexion-indisponible': ({ label, timeout }: MsgVars) => `persist-redis: ${label} given up — Redis connection unavailable after ${timeout} ms (the next save() will catch up the state)`,
  'serveur.persist-redis-load-delai-depasse': ({ timeout }: MsgVars) => `persist-redis: load() Redis connection timeout exceeded (${timeout} ms) — starting WITHOUT restoration`,

  // --- src/mjs-server/persist-bridge.ts ---
  'serveur.persist-bridge-load-tentative-echouee': ({ tentative }: MsgVars) => `persist-bridge: load() attempt ${tentative} failed`,
  'serveur.persist-bridge-load-abandonne': 'persist-bridge: load() given up — starting WITHOUT restoration',
  'serveur.persist-bridge-load-reponse-illisible': 'persist-bridge: load() response unreadable',
  // malformed {id,data} entries received from the back, filtered before returning
  'serveur.persist-bridge-load-entrees-invalides': ({ nb }: MsgVars) => `persist-bridge: load() ${nb} malformed entrie(s) ignored (invalid id/data)`,
  'serveur.persist-bridge-tentative-echouee': ({ label, tentative }: MsgVars) => `persist-bridge: ${label} attempt ${tentative} failed`,
  'serveur.persist-bridge-abandonne-apres-tentatives': ({ label, tentatives }: MsgVars) => `persist-bridge: ${label} given up after ${tentatives} attempt(s)`,

  // --- src/mjs-server/persist-sql.ts (suite) ---
  'serveur.persist-sql-table-creation-echouee': ({ table }: MsgVars) => `persist-sql: creating table '${table}' failed`,
  'serveur.persist-sql-sqlite-non-pris-en-charge': "persist-sql: SQLite is not supported — the '?' dialect writes the MySQL/MariaDB upsert (ON DUPLICATE KEY UPDATE), which SQLite rejects: no game is saved",

  // --- src/mjs-server/persist-file.ts (suite) ---
  'serveur.persist-file-fichier-corrompu': ({ fichier }: MsgVars) => `persist-file: corrupted file ignored '${fichier}'`,
  'serveur.persist-file-copie-ignoree': ({ fichier, id }: MsgVars) => `persist-file: file '${fichier}' ignored — it holds game '${id}', whose save is '${id}.json' (a backup copy? rename it or move it out of the folder)`,

  // ═══ MJS-WS (src/mjs-ws/) ════════════════════════════════════════════════════════════════

  'ws.core.origine-non-verifiee-avec-cookie': "[mjs-ws] ⚠️  cookie-based authentication WITHOUT verifyOrigin: any third-party page can open an authenticated connection on behalf of your visitors (the browser attaches the cookie by itself). Set verifyOrigin to your application's origins — see docs/23-mjs-ws.md § Verifying the origin.",

  // — adapter-redis.ts
  'ws.adapter-redis.entier-invalide': ({ line }: MsgVars) => `[mjs-ws/adapter-redis] invalid RESP integer '${line}' — corrupted stream or not RESP`,
  'ws.adapter-redis.longueur-bulk-invalide': ({ line }: MsgVars) => `[mjs-ws/adapter-redis] invalid RESP bulk length '${line}' — corrupted stream or not RESP`,
  'ws.adapter-redis.longueur-tableau-invalide': ({ line }: MsgVars) => `[mjs-ws/adapter-redis] invalid RESP array length '${line}' — corrupted stream or not RESP`,
  'ws.adapter-redis.octet-inattendu': ({ hex }: MsgVars) => `[mjs-ws/adapter-redis] unexpected RESP byte 0x${hex} — corrupted stream or not RESP`,
  'ws.adapter-redis.url-invalide': ({ raw }: MsgVars) => `[mjs-ws/adapter-redis] invalid Redis URL '${raw}'`,
  'ws.adapter-redis.url-schema-invalide': ({ raw, protocol }: MsgVars) => `[mjs-ws/adapter-redis] invalid Redis URL '${raw}' — expected scheme 'redis://' (or 'rediss://'), got '${protocol}'`,
  'ws.adapter-redis.url-base-invalide': ({ raw, path }: MsgVars) => `[mjs-ws/adapter-redis] invalid Redis URL '${raw}' — database '${path}' is not an integer`,
  'ws.adapter-redis.auth-echec': ({ role, err }: MsgVars) => `[mjs-ws/adapter-redis] Redis authentication failed (${role}): ${err}`,
  'ws.adapter-redis.auth-sans-utilisateur': ({ role, username }: MsgVars) => `[mjs-ws/adapter-redis] ${role}: this Redis does not accept a username in AUTH (version before 6) — connected with the password only, the username "${username}" from the URL is ignored`,
  'ws.adapter-redis.flux-corrompu': ({ role, err }: MsgVars) => `[mjs-ws/adapter-redis] corrupted RESP stream (${role}) — connection closed for a clean reconnect: ${err}`,
  'ws.adapter-redis.reconnexion-backoff': ({ role, delay }: MsgVars) => `[mjs-ws/adapter-redis] Redis reconnect (${role}) in ${delay} ms`,
  'ws.adapter-redis.connexion-perdue': ({ role }: MsgVars) => `Redis connection lost (${role})`,
  'ws.adapter-redis.connexion-indisponible': ({ role }: MsgVars) => `Redis connection unavailable (${role})`,
  'ws.adapter-redis.adaptateur-arrete': ({ role }: MsgVars) => `adapter stopped (${role})`,
  'ws.adapter-redis.commande-sans-reponse': ({ role, delai }: MsgVars) => `Redis command with no reply after ${delai} s (${role}) — connection closed, the order of replies is no longer reliable`,
  'ws.adapter-redis.commande-delai-depasse': ({ role, nb, delai }: MsgVars) => `[mjs-ws/adapter-redis] Redis is not answering (${role}): ${nb} command(s) with no reply after ${delai} s — connection closed for a clean reconnect (check your Redis server)`,
  'ws.adapter-redis.connexion-pas-prete': ({ role, delai }: MsgVars) => `Redis connection (${role}) not ready ${delai} s after it was opened (connect, TLS handshake, AUTH or SELECT with no reply) — connection closed, reconnecting`,
  'ws.adapter-redis.connexion-delai-depasse': ({ role, nb, delai }: MsgVars) => `[mjs-ws/adapter-redis] Redis connection (${role}) not ready ${delai} s after it was opened: ${nb} waiting command(s) rejected — connection closed for a clean reconnect (check your Redis server's address, TLS and password)`,
  'ws.adapter-redis.messages-ignores': ({ channel, n, cause }: MsgVars) => `[mjs-ws/adapter-redis] message ignored on '${channel}': ${cause} — ${n} ignored on this channel since its last warning (one per minute at most)`,
  'ws.adapter.rappel-a-leve': ({ channel, n, cause }: MsgVars) => `[mjs-ws/adapter] a callback of channel '${channel}' threw: ${cause} — message skipped for that callback; ${n} on this channel since the last warning (one per minute at most)`,
  'ws.adapter-redis.publish-echec': ({ channel, err }: MsgVars) => `[mjs-ws/adapter-redis] publish('${channel}') failed: ${err}`,
  'ws.adapter-redis.subscribe-echec': ({ channel, err }: MsgVars) => `[mjs-ws/adapter-redis] subscribe('${channel}') failed: ${err}`,

  // — bridge.ts
  'ws.bridge.secret-manquant': ({ label }: MsgVars) => `[MJS-WS] ${label} missing — a secret is REQUIRED to enable the bridge (literal string, or 'env:VAR_NAME')`,
  'ws.bridge.secret-court': ({ label, length, min }: MsgVars) => `[MJS-WS] ${label} is only ${length} characters long — at least ${min} are recommended (openssl rand -hex 32, for example): a short secret can be guessed offline from a single intercepted signed request. This message appears only once`,
  'ws.bridge.secret-env-absent': ({ label, varName }: MsgVars) => `[MJS-WS] ${label} references environment variable '${varName}' — missing or empty`,
  'ws.bridge.webhooks-url-manquant': '[MJS-WS] opts.bridge.webhooks.url missing',
  'ws.bridge.webhooks-events-vide': "[MJS-WS] opts.bridge.webhooks.events must be a non-empty array (e.g. ['connect', 'message:chat'])",
  'ws.bridge.webhooks-forward-headers-invalide': ({ received }: MsgVars) => `[MJS-WS] opts.bridge.webhooks.forwardHeaders must be a list of HTTP header names (e.g. ['x-remote-user']), received: ${received}`,
  'ws.bridge.signature-manquante': 'missing signature (headers x-mjs-ws-timestamp / x-mjs-ws-signature required)',
  'ws.bridge.timestamp-invalide': 'invalid x-mjs-ws-timestamp (unix seconds expected)',
  'ws.bridge.horodatage-hors-fenetre': 'timestamp out of window — request too old or suspected replay',
  'ws.bridge.nonce-requis': ({ min, max }: MsgVars) => `x-mjs-ws-nonce required (string from ${min} to ${max} characters) — anti-replay nonce active (ws.bridge.nonce)`,
  'ws.bridge.nonce-manquant': ({ min, max }: MsgVars) => `missing nonce: add the x-mjs-ws-nonce header (a fresh string of ${min} to ${max} characters for each request, for example 32 random hexadecimal characters) and place it as the last field of the signed string — the bridge requires it by default`,
  'ws.bridge.signature-invalide': 'invalid signature',
  'ws.bridge.corps-trop-volumineux': 'request body too large (max 1 MB)',
  'ws.bridge.erreur-lecture-corps': 'error reading the request body',
  'ws.bridge.type-requis': "'type' required (non-empty string)",
  'ws.bridge.except-invalide': "'except' must be a person (a string), a connection ({ client: id }) or an array of both",
  'ws.bridge.client-ou-user': "provide exactly one of 'client' or 'user' (not both, not neither)",
  'ws.bridge.client-user-chaine': "'client'/'user' must be a non-empty string",
  'ws.bridge.room-requis': "'room' required (non-empty string)",
  'ws.bridge.name-requis': "'name' required (non-empty string)",
  'ws.bridge.op-invalide': "'op' must be 'add', 'update', 'remove' or 'reset'",
  'ws.bridge.id-requis-add': "'id' required for op 'add'",
  'ws.bridge.value-requis-add': "'value' required for op 'add'",
  'ws.bridge.id-requis-update': "'id' required for op 'update'",
  'ws.bridge.value-objet-update': "'value' must be an object (the patch) for op 'update'",
  'ws.bridge.id-requis-remove': "'id' required for op 'remove'",
  'ws.bridge.values-objet-reset': "'values' must be an object for op 'reset'",
  'ws.bridge.chemin-inconnu': ({ route }: MsgVars) => `unknown path '${route}'`,
  'ws.bridge.requete-refusee': ({ error }: MsgVars) => `bridge: request refused (${error})`,
  'ws.bridge.json-invalide': 'Invalid JSON',
  'ws.bridge.erreur-interne': 'bridge: internal error',
  'ws.bridge.delai-webhook-depasse': 'webhook timeout exceeded',
  'ws.bridge.reponse-http-non-2xx': 'non-2xx HTTP response',
  'ws.bridge.webhook-abandonne': ({ event, tentative }: MsgVars) => `bridge: webhook '${event}' given up after ${tentative} attempt(s)`,
  'ws.bridge.file-webhooks-pleine': ({ max, event }: MsgVars) => `bridge: webhook queue full (${max}) — event '${event}' dropped`,
  'ws.bridge.file-webhooks-pleine-compte': ({ max, event, perdus }: MsgVars) => `bridge: webhook queue full (${max}) — events dropped since the last warning: ${perdus} (last: '${event}'); at most one warning per minute, check that the webhook back end responds`,
  'ws.bridge.webhook-non-serialisable': ({ event }: MsgVars) => `bridge: webhook '${event}' dropped — its payload cannot be serialized to JSON (a BigInt or a circular object in the identity or meta?); make it serializable`,
  'ws.bridge.hote-refuse': 'Host header refused — without a signature, the loopback bridge only answers to localhost, 127.0.0.1 and [::1] (DNS rebinding protection)',
  'ws.bridge.erreur-interne-non-geree': 'bridge: unhandled internal error',
  'ws.bridge.ecoute-pont': ({ host, port, nonce }: MsgVars) => `universal bridge listening on http://${host}:${port}${nonce ? ' (nonce: required)' : ''}`,
  // input validation BEFORE any send (broadcast/send/room-send/stream)
  'ws.bridge.charge-non-serialisable': ({ depth }: MsgVars) => `payload ('p'/'value'/'values') not serializable or too deeply nested (> ${depth} levels)`,
  'ws.bridge.echec-envoi': 'bridge: send failed — network encoding of the message failed server-side',

  // — chat.ts
  // canJoin/moderators throwing: detail to the server log (these
  // 2 keys), GENERIC message to the client ('chat-denied', already catalogued by the caller handler)
  'ws.chat.canjoin-a-leve': 'canJoin() threw',
  'ws.cursors.canjoin-a-leve': 'canJoin() threw',
  'ws.reactions.canjoin-a-leve': 'canJoin() threw',
  'ws.follow.canlead-a-leve': 'canLead() threw',
  'ws.heatmap.exclude-a-leve': 'exclude() threw',
  'ws.heatmap.onpoint-a-leve': 'onPoint() threw',
  'ws.heatmap.unit-inconnue': ({ unit, liste }: MsgVars) => `[mjs-ws:heatmap] unknown unit "${unit}" — one of: ${liste}`,
  'ws.heatmap.maxage-invalide': ({ valeur }: MsgVars) => `[mjs-ws:heatmap] maxAge "${valeur}": a number greater than 0 (the age beyond which a point is erased, in unit)`,
  'ws.heatmap.file-invalide': ({ valeur }: MsgVars) => `[mjs-ws:heatmap] file is the path of a file (e.g. 'heatmap.json') — got ${valeur}`,
  'ws.heatmap.saveevery-invalide': ({ valeur }: MsgVars) => `[mjs-ws:heatmap] saveEvery "${valeur}": a number of milliseconds greater than 0 (default 60000, one minute)`,
  'ws.heatmap.origins-manquantes': `[mjs-ws:heatmap] origins is missing: the list of the origins of your pages, e.g. heatmapPackage({ origins: ['https://mysite.com'] }) — the Origin header can be forged by a script: without this whitelist, anyone could fill the map with addresses of their choice, which the admin page then loads`,
  'ws.heatmap.origine-invalide': ({ valeur }: MsgVars) => `[mjs-ws:heatmap] origins: ${valeur} is not an origin — an http or https address without a path, e.g. 'https://mysite.com' ('https://mysite.com/' works too)`,
  'ws.heatmap.plafond-invalide': ({ nom, valeur }: MsgVars) => `[mjs-ws:heatmap] ${nom} "${valeur}": a whole number greater than 0 (a safety cap on memory)`,
  'ws.heatmap.debit-adresse-invalide': ({ cle, valeur }: MsgVars) => `[mjs-ws:heatmap] addressRateLimit.${cle} "${valeur}": a number greater than 0 (the points per second, or the burst, of one address) — or addressRateLimit: false for the connection bucket alone`,
  'ws.heatmap.file-relu': ({ file, n }: MsgVars) => `${n} point${Number(n) === 1 ? '' : 's'} read back from ${file}`,
  'ws.heatmap.file-adresses-ecartees': ({ file, n }: MsgVars) => `pages dropped when reading ${file}: ${n} — their address is not an http or https address, or is longer than 2000 characters (the admin page would load them in a frame)`,
  'ws.heatmap.file-origines-ecartees': ({ file, n }: MsgVars) => `pages dropped when reading ${file}: ${n} — their origin is not in origins (heatmapPackage({ origins }) lists the origins of your pages)`,
  'ws.heatmap.file-plafonds-ecartes': ({ file, pages, zones, maxPages, maxZones }: MsgVars) => `dropped when reading ${file}: ${pages} page${Number(pages) === 1 ? '' : 's'} beyond maxPages (${maxPages}), ${zones} zone${Number(zones) === 1 ? '' : 's'} beyond maxZones (${maxZones} per page) — heatmapPackage({ maxPages, maxZones }) set them`,
  'ws.heatmap.file-lecture': ({ file }: MsgVars) => `cannot read ${file}: the map starts from scratch`,
  'ws.heatmap.file-illisible': ({ file, aside }: MsgVars) => `${file} is unreadable: set aside as ${aside}, the map starts from scratch`,
  'ws.heatmap.file-intouchable': ({ file }: MsgVars) => `${file} is unreadable and cannot be set aside: it will not be overwritten — the points stay in memory, without a file`,
  'ws.heatmap.file-ecriture': ({ file }: MsgVars) => `cannot write ${file}: the points stay in memory, next try at the next save`,
  'ws.heatmap.plafond-points': ({ max }: MsgVars) => `safety cap reached: ${max} point${Number(max) === 1 ? '' : 's'} — the oldest go first (heatmapPackage({ maxPoints }) sets it; onPoint keeps everything in a database)`,
  'ws.heatmap.plafond-pages': ({ max }: MsgVars) => `safety cap reached: ${max} page${Number(max) === 1 ? '' : 's'} — the least recent page makes room for a new address (heatmapPackage({ maxPages }) sets it)`,
  'ws.heatmap.plafond-zones': ({ max, url }: MsgVars) => `safety cap reached: ${max} zone${Number(max) === 1 ? '' : 's'} on ${url} — the least recent zone of the page makes room for a new one (heatmapPackage({ maxZones }) sets it)`,
  'ws.chat.moderators-a-leve': 'moderators() threw',

  // — accounts.ts
  'ws.accounts.dir-manquant': '[MJS-WS] FileAccountsPersistAdapter: opts.dir missing',
  'ws.accounts.fichier-corrompu-ignore': ({ fichier }: MsgVars) => `comptes:file: corrupted file ignored '${fichier}'`,
  'ws.accounts.remove-echoue': ({ id }: MsgVars) => `comptes:file: remove('${id}') failed`,
  'ws.accounts.rejet-non-intercepte': ({ label }: MsgVars) => `comptes:file: ${label} — uncaught rejection`,
  'ws.accounts.save-echoue': ({ id }: MsgVars) => `comptes:file: save('${id}') failed`,
  'ws.accounts.secret-manquant': '[MJS-WS] accountsPackage: opts.secret missing — MUST be the SAME secret passed to accountsAuth(secret) in mjsWs({ auth }) (see docs/27-accounts.md "Elevation")',
  'ws.accounts.adaptateur-memoire-defaut': 'memory adapter (default) — accounts DO NOT SURVIVE a restart. DEV ONLY: supply opts.persist (FileAccountsPersistAdapter, or a custom adapter) in production.',
  'ws.accounts.persist-load-echoue': 'persist.load() failed — starting up WITHOUT restored accounts',
  'ws.accounts.persist-echec': ({ name }: MsgVars) => `persist.save() failed — account '${name}' not created`,
  'ws.accounts.enregistrement-incomplet-ignore': ({ id }: MsgVars) => `incomplete account record ignored (id '${id}'): id, name, hash and salt must be strings — its name, if readable, stays reserved`,
  'ws.accounts.date-connexion-echec': ({ name }: MsgVars) => `persist.save() failed for the last-login date of '${name}' — login accepted anyway`,

  // — core.ts
  'ws.core.envoi-ignore-contre-pression': ({ clientId }: MsgVars) => `send dropped (backpressure) to ${clientId}`,
  'ws.core.close-contre-pression-persistante': 'persistent backpressure',
  'ws.core.echec-envoi-binaire': 'send failed (binary)',
  'ws.core.echec-serialisation': ({ type }: MsgVars) => `serialization failed (type '${type}')`,
  'ws.core.echec-envoi': 'send failed',
  'ws.core.client-expulse': ({ clientId, reason }: MsgVars) => `client ${clientId} kicked (${reason})`,
  'ws.core.close-jeton-expire': 'token expired',
  'ws.core.connexion-refusee-origine': ({ origin, address }: MsgVars) => `connection refused — unauthorized origin (${origin ?? 'missing'}, ${address ?? 'unknown ip'})`,
  'ws.core.close-origine-refusee': 'origin refused',
  'ws.core.plafond-global-atteint': ({ max }: MsgVars) => `global connection cap reached (${max})`,
  'ws.core.plafond-par-ip-atteint': ({ ip, max }: MsgVars) => `per-IP cap reached (${ip}, ${max})`,
  'ws.core.connexion-refusee-raison': ({ reason }: MsgVars) => `connection refused — ${reason}`,
  'ws.core.refus-semblables-tus': ({ n }: MsgVars) => `(and ${n} more similar refusals since the previous line, not logged)`,
  'ws.core.close-reessayez-plus-tard': 'try again later',
  'ws.core.verifyorigin-exception': 'connection refused — verifyOrigin threw an exception',
  'ws.core.close-inactivite': 'inactivity',
  'ws.core.erreur-interne-non-geree': 'unhandled internal error',
  'ws.core.close-payload-trop-volumineux': 'payload too large',
  'ws.core.hello-attendu-premier': 'µ:hello expected as first message',
  'ws.core.hello-deja-recu': 'hello already received',
  'ws.core.type-inconnu': ({ type }: MsgVars) => `unknown type '${type}'`,
  'ws.core.json-invalide-recu': ({ clientId }: MsgVars) => `invalid JSON received from ${clientId}`,
  'ws.core.close-trop-messages-invalides': 'too many invalid messages',
  'ws.core.debit-depasse-ralentis': 'rate exceeded, slow down',
  'ws.core.close-debit-depasse': 'rate exceeded',
  'ws.core.close-trame-binaire-trop-volumineuse': 'binary frame too large',
  'ws.core.accroche-binaire-a-leve': 'internal binary hook threw',
  'ws.core.close-protocole-non-supporte': 'unsupported protocol',
  'ws.core.auth-exception-interne': ({ clientId, err }: MsgVars) => `opts.auth threw an internal exception for ${clientId} — message hidden from client: ${err}`,
  'ws.core.close-authentification-refusee': 'authentication refused',
  'ws.core.close-session-deja-active': 'session already active for this identity',
  'ws.core.close-id-anon-reserve': 'account id refused: "anon:" is reserved for visitors without an account',
  'ws.core.auth-id-anon-reserve': ({ clientId, id }: MsgVars) => `opts.auth returned the id "${id}" for ${clientId}: an account id cannot start with "anon:", reserved for visitors without an account — connection refused; give your accounts ids without this prefix`,
  'ws.core.close-banni': 'temporarily banned',
  'ws.core.close-au-banc': ({ minutes }: MsgVars) => `temporarily banned for repeated abuse — try again in ${minutes} min`,
  'ws.core.banc-comptes-seulement': ({ minutes }: MsgVars) => `address temporarily banned for repeated abuse — sign in to your account to continue, or try again in ${minutes} min`,
  'ws.core.mise-au-banc-ip': ({ ip, fautes, minutes }: MsgVars) => `IP ${ip} banned for ${minutes} min (${fautes} kick${Number(fautes) === 1 ? '' : 's'} for abuse)`,
  'ws.core.mise-au-banc-ip-anonymes': ({ ip, fautes, minutes }: MsgVars) => `IP ${ip} banned for ${minutes} min for anonymous connections (${fautes} kick${Number(fautes) === 1 ? '' : 's'} for abuse) — accounts from this address are still welcome`,
  'ws.core.mise-au-banc-compte': ({ compte, fautes, minutes }: MsgVars) => `account ${compte} banned for ${minutes} min (${fautes} kick${Number(fautes) === 1 ? '' : 's'} for abuse)`,
  'ws.core.welcome-a-leve': 'welcome() threw — µ:welcome sent anyway (payload {})',
  'ws.core.client-repris': ({ clientId, sessionId, count }: MsgVars) => `client ${clientId} resumed (session ${sessionId}, ${count} frame(s) replayed)`,
  'ws.core.serve-a-leve': ({ type }: MsgVars) => `serve('${type}') threw`,
  'ws.core.on-a-leve': ({ type }: MsgVars) => `on('${type}') threw`,
  'ws.core.serve-a-refuse': ({ type, message }: MsgVars) => `serve('${type}') refused: ${message}`,
  'ws.core.on-a-refuse': ({ type, message }: MsgVars) => `on('${type}') refused: ${message}`,
  'ws.core.erreur-interne-client': 'internal server error',
  'ws.core.uncaught-exception-survit': 'uncaughtException — process survives',
  'ws.core.unhandled-rejection-survit': 'unhandledRejection — process survives',
  'ws.core.paquet-deja-installe': ({ nom }: MsgVars) => `package '${nom}' already installed — install skipped`,
  'ws.core.depart-salon-a-leve': ({ room }: MsgVars) => `a package threw while handling a departure from room '${room}' — the departure is still recorded`,
  'ws.core.installer-a-leve': ({ nom }: MsgVars) => `installer('${nom}') threw — package NOT installed`,
  'ws.core.ondisconnect-a-leve': ({ clientId }: MsgVars) => `opts.onDisconnect threw for ${clientId} — the connection cleanup ran to completion`,
  'ws.core.ondisconnect-a-rejete': ({ clientId }: MsgVars) => `opts.onDisconnect rejected for ${clientId} — no effect on the connection cleanup`,
  'ws.core.process-distant-bail-expire': ({ pid }: MsgVars) => `[MJS-WS] remote process '${pid}' — lease expired, purging its presence peers`,
  'ws.core.verification-baux-echec': ({ err }: MsgVars) => `[MJS-WS] remote lease check failed: ${err}`,
  'ws.core.message-canal-malforme': ({ channel, n }: MsgVars) => `[MJS-WS] message with an unexpected shape ignored on channel '${channel}' (another application on the same Redis, an admin tool, a neighbouring version during an update?) — ${n} ignored on this channel since its last warning (one per minute at most)`,
  'ws.core.renouvellement-bail-echec': ({ err }: MsgVars) => `[MJS-WS] lease renewal failed: ${err}`,

  // — index.ts
  'ws.index.adapter-redis-manquant': "[MJS-WS] opts.adapter.redis missing — expected a 'redis://...' URL (or an already-built MjsWsAdapter instance)",
  'ws.index.transport-invalide': ({ raw }: MsgVars) => `[MJS-WS] invalid transport: '${raw}' — valid values: 'ws', 'uws', or an MjsWsTransport instance`,
  'ws.index.session-exclusive-invalide': ({ raw }: MsgVars) => `[MJS-WS] invalid sessionExclusive: ${raw} — valid values: true, false, 'replace', 'refuse'`,
  'ws.index.ban-invalide': ({ cle, raw, attendu }: MsgVars) => `[MJS-WS] invalid ${cle}: ${raw} — expected: ${attendu}`,
  'ws.index.entier-positif': 'an integer ≥ 1',
  'ws.index.rate-by-invalide': ({ raw, valides }: MsgVars) => `[MJS-WS] invalid limits.rateBy: ${raw} — valid values: ${valides}`,
  'ws.index.reglage-invalide': ({ cle, raw, attendu }: MsgVars) => `[MJS-WS] invalid ${cle}: ${raw} — expected: ${attendu}`,
  'ws.index.nombre-positif-ou-nul': 'a finite number ≥ 0',
  'ws.index.nombre-positif-ou-nul-ou-null': 'a finite number ≥ 0, or null (unlimited)',
  'ws.index.entier-positif-ou-false': 'an integer ≥ 1, or false (disabled)',

  // — lobby.ts
  // key kept as-is (lobby.ts references it verbatim) — only the
  // TEXT is fixed: the real option is `opts.onJoin`, never `onRejoindre`.
  'ws.lobby.onrejoindre-a-leve': 'onJoin threw',
  // moderators throwing (lobby:withdraw): detail to the server
  // log (this key), GENERIC message to the client ('lobby-denied', already catalogued by the handler)
  'ws.lobby.moderators-a-leve': 'moderators() threw',

  // — proxy.ts
  'ws.proxy.secret-manquant': ({ label }: MsgVars) => `[MJS-WS] ${label}: 'secret' missing — REQUIRED (literal string, or 'env:VAR_NAME')`,
  'ws.proxy.secret-env-absent': ({ label, varName }: MsgVars) => `[MJS-WS] ${label}: 'secret' references environment variable '${varName}' — missing or empty`,
  'ws.proxy.url-manquante': "[MJS-WS] decision proxy: 'url' missing (non-empty string expected)",
  'ws.proxy.url-invalide': ({ url }: MsgVars) => `[MJS-WS] decision proxy: invalid 'url': ${url}`,
  'ws.proxy.http-non-loopback': ({ url }: MsgVars) => `[MJS-WS] decision proxy (${url}): non-loopback http:// = risk of identity spoofing via MITM — use https:// or, knowingly, { allowInsecure: true }`,
  'ws.proxy.cache-ttl-invalide': ({ url }: MsgVars) => `[MJS-WS] decision proxy (${url}): 'cache.ttl' must be an integer > 0 (ms)`,
  'ws.proxy.signature-absente': 'unsigned (headers x-mjs-ws-timestamp/x-mjs-ws-signature missing)',
  'ws.proxy.timestamp-invalide': 'invalid x-mjs-ws-timestamp',
  'ws.proxy.horodatage-hors-fenetre': 'timestamp out of window (suspected replay)',
  'ws.proxy.reponse-statut-refus': ({ url, status, event }: MsgVars) => `decision proxy — ${url} replied ${status} (event '${event}') — refusal decision`,
  'ws.proxy.reponse-signature-refus': ({ url, erreur, event }: MsgVars) => `decision proxy — ${url}: response ${erreur} (event '${event}') — refusal decision`,
  'ws.proxy.reponse-json-invalide': ({ url, event }: MsgVars) => `decision proxy — ${url}: invalid JSON response (event '${event}') — refusal decision`,
  'ws.proxy.requete-en-echec': ({ url, event }: MsgVars) => `decision proxy — ${url} failed (event '${event}') — refusal decision`,
  'ws.proxy.authentification-refusee': 'authentication refused (proxy)',
  // cap on the back's response (same spirit as the bridge's incoming body)
  'ws.proxy.reponse-trop-volumineuse': ({ url, event, max }: MsgVars) => `decision proxy — ${url}: response too large (cap ${max} bytes, event '${event}') — refusal decision`,

  // — token.ts
  'ws.token.secret-manquant': ({ fn }: MsgVars) => `[MJS-WS] ${fn}: secret missing or empty — a secret is REQUIRED to sign and verify tokens (a non-empty string). With an empty secret, anyone could forge a valid token: check that the environment variable holding it (JWT_SECRET, for example) is set`,
  // emitted ONCE per process, on the first token secret that is too short
  'ws.token.secret-court': ({ fn, length, min }: MsgVars) => `[MJS-WS] ${fn}: the token secret is only ${length} characters long — at least ${min} are recommended (openssl rand -hex 32, for example): a short secret can be guessed offline from a single intercepted token. This message appears only once`,
  // jwtAuth/verifyToken/accountsAuth options, accountsPackage audience, issuer and unknown keys — refused at construction
  'ws.token.options-invalides': ({ fn, received }: MsgVars) => `[MJS-WS] ${fn}: options must be an object ({ audience, issuer, clockTolerance }, each optional), received: ${received}`,
  'ws.token.audience-invalide': ({ fn, received }: MsgVars) => `[MJS-WS] ${fn}: audience must be a non-empty string or a non-empty list of non-empty strings (the site the tokens are made for, for example 'boutique' or ['boutique', 'boutique-admin']), received: ${received}. If the value comes from an environment variable, check that it is set`,
  'ws.token.issuer-invalide': ({ fn, received }: MsgVars) => `[MJS-WS] ${fn}: issuer must be a non-empty string or a non-empty list of non-empty strings (the expected issuer of the tokens, for example 'https://boutique.fr'), received: ${received}. If the value comes from an environment variable, check that it is set`,
  'ws.token.tolerance-invalide': ({ fn, received }: MsgVars) => `[MJS-WS] ${fn}: clockTolerance must be a finite number of seconds, zero or more (the clock tolerance applied to exp and nbf, for example 30; 0 by default), received: ${received}`,
  'ws.token.option-inconnue': ({ fn, key, hint, known }: MsgVars) => `[MJS-WS] ${fn}: unknown option '${key}'${hint}\n  Valid options: ${known}`,
  'ws.token.option-inconnue-suggestion': ({ suggestion }: MsgVars) => ` — did you mean '${suggestion}'?`,

  // — rooms.ts
  'ws.rooms.meta-a-leve': 'rooms.meta() threw',
  // join/canSeePresence throwing: detail to the server log (these
  // 2 keys), same GENERIC message to the client as the explicit refusal (false), right below
  'ws.rooms.join-a-leve': 'join() threw',
  'ws.rooms.acces-salon-refuse': 'room access refused',
  'ws.rooms.can-see-presence-a-leve': 'canSeePresence() threw',
  'ws.rooms.acces-presence-refuse': 'room presence access refused',
  'ws.rooms.presence-reservee-aux-membres': 'room presence is for members only: join the room first',
  'ws.rooms.presence-globale-fermee': `global presence is closed on this server: open it with mjsWs({ presence: 'public' })`,
  'ws.rooms.trop-de-salons': 'too many rooms',
  'ws.rooms.nom-trop-long': ({ max }: MsgVars) => `room name too long (${max} characters at most)`,

  // — schema.ts
  'ws.schema.codec-invalide': ({ raw }: MsgVars) => `[MJS-WS] invalid ws.codec: '${raw}' — valid values: 'auto', 'binary', 'json'`,
  'ws.schema.binaire-strict-refuse': ({ type }: MsgVars) => `[MJS-WS] ws.codec 'binary' strict — sending application type '${type}' WITHOUT a declared schema. Declare it first: app.schema('${type}', { ... }) (or opts.schemas in bulk), or switch back to ws.codec 'auto'/'json' if this type should really travel as JSON.`,
  'ws.schema.decodage-echec': 'µschema — decoding failed (corrupted frame?)',
  'ws.schema.id-inconnu-desynchronise': ({ id }: MsgVars) => `unknown schema id (${id}) — local registry out of sync, see µ:schema`,
  'ws.schema.trame-binaire-corrompue': 'corrupted binary frame',
  'ws.schema.texte-strict-rejete': ({ type }: MsgVars) => `ws.codec 'binary' strict — text application type '${type}' rejected, declare it via app.schema() (or switch back to 'auto'/'json' codec)`,

  // — sessions.ts
  'ws.sessions.expiree-purge-differee': ({ id, clientId }: MsgVars) => `session ${id} expired without return — deferred purge of ${clientId}`,
  'ws.sessions.client-parque': ({ clientId, id, grace }: MsgVars) => `client ${clientId} parked (session ${id}, grace ${grace} ms)`,
  'ws.sessions.tampon-reprise-deborde': ({ clientId, id }: MsgVars) => `resume buffer overflowed for ${clientId} (session ${id}) — session not resumable`,
  'ws.sessions.session-revoquee': ({ id, clientId }: MsgVars) => `session ${id} revoked (identity already reconnected elsewhere) — purging ${clientId}`,

  // — streams.ts
  'ws.streams.mutation-clusterisee-echec': ({ name }: MsgVars) => `stream '${name}' — clustered mutation failed`,
  'ws.streams.flux-non-declare': ({ via, name }: MsgVars) => `${via} to an undeclared stream '${name}' — empty reset returned`,
  'ws.streams.ecriture-apres-destroy': ({ name, op }: MsgVars) => `'${op}' write on stream '${name}' after its destroy() — ignored: this stream is gone; to serve it again, declare it with app.stream('${name}') and write through that new handle`,
  'ws.streams.application-avec-trou': ({ name, reason, count }: MsgVars) => `stream '${name}' — ${reason}: applying with a gap (${count} delta(s) pending)`,
  'ws.streams.tampon-reordonnancement-plein': ({ max }: MsgVars) => `reorder buffer full (${max})`,
  'ws.streams.delai-reordonnancement-depasse': ({ ms }: MsgVars) => `reorder delay exceeded (${ms} ms)`,
  // SUBSCRIBE guard (canSubscribe/room, cf. MjsWsStreamOptions)
  'ws.streams.room-sans-accroche': ({ name, room }: MsgVars) => `stream '${name}' — 'room' option ('${room}') requires a hook the engine does not wire yet (createStreamsEngine, hasRoomMember parameter missing): app.stream() refuses to start rather than leave 'room' silently inactive — use canSubscribe: (client) => app.room('${room}').has(client) in the meantime`,
  'ws.streams.abonnement-refuse': ({ via, name }: MsgVars) => `${via} refused to stream '${name}' — access guard not satisfied (canSubscribe/room)`,
  'ws.streams.flux-pont-non-declare': ({ via, name }: MsgVars) => `${via} refused to stream '${name}' — written by the bridge but never declared in this process: declare it with app.stream() (and its guard if it is private); a bridge stream is never public by default`,
  'ws.streams.acces-flux-refuse': 'stream access refused',
  'ws.streams.flux-ferme-a-la-declaration': ({ name }: MsgVars) => `stream '${name}' is closed: declared without access, it is served to no one — write app.stream('${name}', { public: true }) to open it to everyone, or { room } / { canSubscribe } to restrict it`,
  'ws.streams.abonnement-flux-ferme': ({ via, name }: MsgVars) => `${via} refused to stream '${name}' — closed stream, declared without access: write app.stream('${name}', { public: true }) to open it to everyone, or { room } / { canSubscribe } to restrict it`,
  'ws.streams.flux-non-declare-nom-trop-long': ({ via, name, max }: MsgVars) => `${via} to an undeclared stream whose name is too long '${name}' (${max} characters at most) — error returned`,
  'ws.streams.nom-trop-long': ({ max }: MsgVars) => `stream name too long (${max} characters at most)`,
  // depth/serializability guard (add/update/reset)
  'ws.streams.entree-non-serialisable': ({ name, op, depth }: MsgVars) => `stream '${name}' — ${op}() refused: value not serializable or too deeply nested (> ${depth} levels) — never stored (would durably poison snapshot()/µ:sub-stream for every future subscriber)`,

  // — transport-uws.ts
  'ws.transport-uws.paquet-requis': "the uWebSockets.js package is required for transport: 'uws' — npm install uNetworking/uWebSockets.js#v20.52.0",
  'ws.transport-uws.echec-ecoute': ({ port, host }: MsgVars) => `[mjs-ws/transport-uws] failed to listen on port ${port}${host ? ` (${host})` : ''} — port already in use?`,
  'ws.transport-uws.echec-ecoute-socket': ({ path }: MsgVars) => `[mjs-ws/transport-uws] failed to bind unix socket ${path} — missing directory, permission denied, or a process already listening there?`,
  'ws.transport-uws.socket-trop-longue': ({ path, bytes, max }: MsgVars) => `[mjs-ws/transport-uws] unix socket path too long (${bytes} bytes, ${max} max): ${path}`,

  // — transport-ws.ts
  'ws.watchdog.arme': ({ periode, fenetre }: MsgVars) => `[mjs-ws/watchdog] systemd watchdog armed — heartbeat every ${periode} ms (window ${fenetre} ms)`,
  'ws.watchdog.fenetre-trop-courte': ({ periode, fenetre }: MsgVars) => `[mjs-ws/watchdog] very short watchdog window (WatchdogSec = ${fenetre} ms): the heartbeat, at half the window, spawns systemd-notify every ${periode} ms, and an event-loop delay of more than ${periode} ms will get the service killed; set WatchdogSec to at least 1 s`,
  'ws.watchdog.notifier-introuvable': ({ notifier }: MsgVars) => `[mjs-ws/watchdog] ${notifier} not found while systemd arms a watchdog (WATCHDOG_USEC): without it the service would be killed every WatchdogSec seconds, silently — aborting now`,
  'ws.watchdog.notifier-refuse': ({ notifier, code }: MsgVars) => `[mjs-ws/watchdog] ${notifier} exited ${code} on the first heartbeat — check NotifyAccess=all in the systemd unit (the default, main, REJECTS a child's message and gets a healthy service killed) — aborting now`,

  'ws.transport-ws.paquet-requis': 'the "ws" package is required for mjs ws — npm install ws',

  // — trust-proxy.ts
  'ws.trust-proxy.vrai-refuse': "[MJS-WS] trustProxy: true is refused — believing the headers of any peer would let every visitor pick the address they want. Choose 'loopback' (your proxy runs on the same machine) or the list of your proxies, for example ['10.0.0.0/8', '192.168.1.5']",
  'ws.trust-proxy.valeur-invalide': ({ raw }: MsgVars) => `[MJS-WS] invalid trustProxy: ${raw} — valid values: false, 'loopback', or a list of addresses or ranges, for example ['10.0.0.0/8', '192.168.1.5']`,
  'ws.trust-proxy.entree-invalide': ({ entry }: MsgVars) => `[MJS-WS] trustProxy: ${entry} is neither an IP address nor a range (10.0.0.0/8, fd12:3456::/32) — expected: 'loopback', or a list such as ['10.0.0.0/8', '192.168.1.5']`,
  'ws.trust-proxy.plage-trop-etendue': ({ entry, family, max }: MsgVars) => `[MJS-WS] trustProxy: the range ${entry} is too wide — wider than /${max} in ${family}. A direct visitor whose address falls inside a trusted range is believed on its word: it picks any address it wants in X-Forwarded-For, and the per-address limits (connections, ban, game code lockout) no longer hold. List your actual proxies, for example ['10.0.0.0/8', '192.168.1.5']`,
  'ws.trust-proxy.plage-trop-large': ({ entry }: MsgVars) => `[MJS-WS] trustProxy: the range ${entry} covers every address — it is true under another name, refused the same way. List your actual proxies, for example ['10.0.0.0/8', '192.168.1.5']`,
  // emitted ONCE, on the first proxy header coming from a local address while trustProxy is not set
  'ws.trust-proxy.proxy-sans-reglage': "[MJS-WS] proxy headers (X-Forwarded-For or X-Real-IP) are arriving from a local address: you appear to be behind a proxy (nginx, for example). Without trustProxy, all your visitors share the proxy's address, and per-address limits (connections per address, private-game code lockout, ban) apply to everyone at once. Set trustProxy: 'loopback' (or trustProxy: false to keep this behavior and silence this message) — see docs/23-mjs-ws.md § Behind a reverse proxy.",
  // emitted ONCE for the whole process, when X-Real-IP and X-Forwarded-For from a trusted proxy do not name the same visitor
  'ws.trust-proxy.en-tetes-contradictoires': "[MJS-WS] trustProxy: X-Real-IP and X-Forwarded-For, received from a trusted proxy, do not name the same visitor. Your proxy probably writes only one of them and passes the other one through exactly as the visitor sent it, and a visitor can put any address in it: when in doubt, the connection carries the proxy's address. Have your proxy write both headers (nginx: proxy_set_header X-Real-IP $remote_addr; and proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;), or have it remove the one it does not write (HAProxy: http-request del-header X-Real-IP) — see docs/23-mjs-ws.md § Behind a reverse proxy. This message appears only once.",

  // — transport.ts
  'ws.transport.send-non-ouvert': '[MemoryTransport] send() on a WebSocket that is not open',
  'ws.transport.arrete': 'transport stopped',
  'ws.transport.connect-avant-start': '[MemoryTransport] connect() before start()',

  // ═══ MJS-WS — dashboard d'état (src/mjs-ws/stats-page.ts, hors inventaire, cf. risques §6) ═══

  'ws.stats.titre-page': 'µWS — server status',
  'ws.stats.pied-de-page': 'auto-refreshes every 2 s — last update',
  'ws.stats.titre-connexions': 'Connections',
  'ws.stats.titre-salons': 'Rooms',
  'ws.stats.titre-flux': 'Streams',
  'ws.stats.titre-messages': 'Messages',
  'ws.stats.titre-garde': 'Guard (kicks)',
  'ws.stats.titre-pont': 'Bridge',
  'ws.stats.titre-adaptateur': 'Adapter',
  'ws.stats.titre-sessions': 'Sessions',
  'ws.stats.titre-intervalle-ping': 'Interval between two pings (ms)',
  'ws.stats.titre-memoire': 'Memory / uptime',
  'ws.stats.champ-actives': 'active',
  'ws.stats.champ-parquees': 'parked',
  'ws.stats.champ-accueillies': 'accepted',
  'ws.stats.champ-refusees': 'refused',
  'ws.stats.champ-refusees-plafond': 'refused (cap)',
  'ws.stats.champ-refusees-origine': 'refused (origin)',
  'ws.stats.champ-refusees-ban': 'refused (banned)',
  'ws.stats.champ-fermees': 'closed',
  'ws.stats.champ-nombre': 'count',
  'ws.stats.champ-membres-total': 'members total',
  'ws.stats.champ-abonnes-presence': 'presence subscribers',
  'ws.stats.champ-deltas-emis': 'deltas emitted',
  'ws.stats.champ-resyncs-rejeu': 'resyncs (replay)',
  'ws.stats.champ-resyncs-reset': 'resyncs (reset)',
  'ws.stats.champ-recus': 'received',
  'ws.stats.champ-envoyes': 'sent',
  'ws.stats.champ-tamponnes': 'buffered',
  'ws.stats.champ-rejoues': 'replayed',
  'ws.stats.champ-rejetes': 'dropped',
  'ws.stats.champ-binaire-recues': 'binary received',
  'ws.stats.champ-binaire-ignorees': 'binary ignored',
  'ws.stats.champ-kicks-debit': 'rate',
  'ws.stats.champ-kicks-silence': 'silence',
  'ws.stats.champ-kicks-engorgement': 'congestion',
  'ws.stats.champ-kicks-charge-utile': 'payload',
  'ws.stats.champ-mises-au-banc': 'bans',
  'ws.stats.champ-expirations-jeton': 'token expired',
  'ws.stats.champ-rate-limited': 'limited (429)',
  'ws.stats.champ-webhooks-envoyes': 'webhooks sent',
  'ws.stats.champ-webhooks-echoues': 'webhooks failed',
  'ws.stats.champ-webhooks-abandonnes': 'webhooks given up',
  'ws.stats.champ-publies': 'published',
  'ws.stats.champ-ignores-origin': 'ignored (origin)',
  'ws.stats.champ-reordonnances': 'reordered',
  'ws.stats.champ-reconnexions': 'reconnects',
  'ws.stats.champ-emises': 'issued',
  'ws.stats.champ-reprises': 'resumed',
  'ws.stats.champ-expirees': 'expired',
  'ws.stats.champ-debordees': 'overflowed',
  'ws.stats.champ-echantillon': 'sample',
  'ws.stats.sub-process': 'process ',
  'ws.stats.sub-depuis': ' — active for ',
  'ws.stats.sub-s': ' s',

  // unclosed HTML comment `<!-- … -->`: same family as parser.chaine-non-fermee/
  // delimiteur-non-ferme ("end of file reached" banner).
  'parser.commentaire-non-ferme': ({ ligne }: MsgVars) => `

🚨 [UNCLOSED COMMENT] \`<!--\` opened at line ${ligne} has no matching \`-->\`.
   End of file reached: all the HTML that follows was swallowed by the comment.
👉 Close the comment with \`-->\`.

`,
  'parser.cdata-non-fermee': ({ ligne }: MsgVars) => `

🚨 [UNCLOSED CDATA] \`<![CDATA[\` opened at line ${ligne} inside an <svg> or a <math> has no matching \`]]>\`.
   The browser would read the whole rest of the component as text: tags and values would disappear.
👉 Close the section with \`]]>\`.

`,
  // HTML tag never closed until end of file: same family as
  // parser.balise-fermante-orpheline (symmetrical case, closing tag with no opening one).
  'parser.balise-non-fermee': ({ nom, ligne }: MsgVars) => `

🚨 [UNCLOSED TAG] \`<${nom}>\` opened at line ${ligne} has no matching \`</${nom}>\`.
   End of file reached before closing.
👉 Add the missing closing tag, or make the tag self-closing (\`<${nom} />\`) if it has no content.

`,
  // GENERIC parser-side filet: an attribute
  // name seen twice on the same tag, whatever its original form (an already-rewritten `@…=`
  // directive, a duplicated native attribute, a form not covered by preprocessHtml's textual
  // detection which only sees ITS OWN recognized markers). `@class{cond}`/`@style.prop{cond}`
  // fold the condition into the name: two different conditions never collide.
  'parser.attribut-duplique': ({ attribut, tag, ligne }: MsgVars) => `

🚨 [DUPLICATE ATTRIBUTE] \`${attribut}\` appears twice on <${tag}> (line ${ligne}).
   A duplicate HTML attribute only keeps the FIRST value in the DOM; the second is silently ignored.
👉 Remove one of the two.

`,
  // @import $X (bare dollar, no µ$): an imported name never carries
  // `$` on its own, a singleton is imported and consumed ONLY via `µ$$X` (docs/14-stores.md
  // § "One symbol, one role") — `@import $counter` used to compile silently.
  'transpiler.import-nom-dollar': ({ nom, base }: MsgVars) => `[ModularJS] @import ${nom}: an imported name never carries "$" — a singleton is imported and consumed as "µ$$${base}" (declared as "export µ$$${base} = …" in the module).`,
  // @no-ujs/@noUJS: bare form only, same policy as @permanent (transpiler/index.ts)
  // — UJS pairing carries no value, a leftover value would be a silent bug (mjs-no-ujs='value'
  // attribute posed instead of the expected bare marker).
  'transpiler.no-ujs-valeur-refusee': ({ valeur }: MsgVars) => `[ModularJS] @no-ujs=${valeur}: this directive never takes a value — it disables UJS interception for the whole element, nothing to specify; write @no-ujs alone (or @noUJS).`,
  // prefixes the module name in front of ANY error message from the
  // transpile()/transpileFile() pipeline that doesn't already carry it (~25 preprocessHtml errors
  // with no file or line, analyzer error with no file) — on a multi-file build, know WHICH
  // component failed.
  'transpiler.erreur-dans-module': ({ moduleName, message }: MsgVars) => `'${moduleName}': ${message}`,
  // the same directive set twice on the SAME tag (ex. @confirm=… @confirm=…):
  // only the first value survives in the DOM (duplicate HTML attribute), the second one, written
  // by the dev, is silently ignored — rejected at build time instead of staying silent.
  'transpiler.directive-dupliquee': ({ directive, balise }: MsgVars) => `[ModularJS] ${directive} is set twice on <${balise}> — a duplicate HTML attribute only keeps the FIRST value in the DOM; remove one of the two.`,
  // two hooks with the same name (µmount/µawake/µsleep/µdestroy/µfailed/
  // µurlChange) in the same <script>: `_mjs_hooks[name]` is a SINGLE slot at runtime, the second
  // overwrites the first WITHOUT any signal — rejected HERE, at compile time.
  'transpiler.hook-duplique': ({ moduleName, hook }: MsgVars) => `[ModularJS] '${moduleName}.mjs' declares µ${hook} twice — the second overwrites the first at runtime (a single slot per hook), the first never runs; merge the two blocks into one.`,
  // @import target holding a quote/backslash/newline/NUL: this value is inserted
  // as-is into the generated double-quote string (fromClause) — never accepted.
  'transpiler.import-cible-invalide': ({ cible }: MsgVars) => `[ModularJS] @import: target '${cible}' is invalid — it can be neither empty nor contain a quote, a backslash, a backtick, a #{…}/\${…} interpolation or a newline (expected form: @import name 'path').`,
  // RAW '.civet' entry (compileRawCivetFile): an MJS directive (@import, @css…)
  // at column 0 compiles as plain Civet without ever doing what it promises (silent runtime
  // failure only) — rejected before compilation, points to '.server.mjs'.
  'cli.entry-civet-brut-directive': ({ entryPath, directive }: MsgVars) => `'${entryPath}': the ${directive} directive doesn't exist in a raw '.civet' entry (no MJS pre-pass) — rename the file to '.server.mjs' to use ${directive}.`,
  // $__proto__/$constructor/$prototype: reserved state name, rejected BEFORE
  // analysis (otherwise expandOneDep silently crashes on the JS prototype, an unoriented TypeError).
  'analyzer.nom-etat-reserve': ({ name }: MsgVars) => `[ModularJS] $${name}: reserved state name — "${name}" belongs to the JavaScript prototype, pick another name.`,
  // dependency-tracking Civet fallback (getEffectVars) exhausted:
  // last warning before the effect gets wrongly classed "mountOnly" (the view never re-renders).
  'generator.deps-non-analysables': ({ expr, moduleHint }: MsgVars) => `[ModularJS] ⚠️  unable to analyze dependencies for "${expr}"${moduleHint} — the view will never update.`,
  // a function imported from a .js module writes into the $$x store (or a path inside it) it receives as an argument:
  // MJS never rewrites that module, so the write it makes on its parameter tells nobody
  'generator.magasin-vers-module-js': ({ moduleName, ligne, fonction, fichier, magasin, ligneJs }: MsgVars) => `[ModularJS] '${moduleName}.mjs'${ligne ? ` (line ${ligne})` : ''}: ${fonction} writes to ${magasin}, received as an argument (line ${ligneJs} of '${fichier}'). MJS copies a .js module as is and never rewrites it: this write changes the store value but redraws nothing. Write to the store from the component, or have ${fonction} return the value and write it in the component.`,
  // @__proto__/@constructor/@prototype: reserved METHOD
  // name, rejected BEFORE analysis (otherwise methodReads['__proto__'] falls back to
  // Object.prototype, an unoriented "reads is not iterable" TypeError).
  'analyzer.nom-methode-reserve': ({ name }: MsgVars) => `[ModularJS] @${name}: reserved method name — "${name}" belongs to the JavaScript prototype, pick another name.`,
  // <p> closed by the browser in front of a flow content element
  // (div, section, table…): the path computed at build time targeted a child
  // that never exists in the real tree (crash on mount). Rejected at compile time.
  'generator.p-contenu-interdit': ({ tag, ligne }: MsgVars) => `[ModularJS] <p> (line ${ligne}): <${tag}> cannot be a child of a <p> — the browser closes the <p> on its own before opening <${tag}>, and the path computed at build time would then target a child that no longer exists. Close the <p> before <${tag}>, or use an inline element instead (span, a, em…).`,
  'generator.template-dynamique': ({ ligne }: MsgVars) => `[ModularJS] <template> (line ${ligne}): a {…} value, a block or a handler cannot be placed inside a <template> — the browser stores its content apart (template.content), outside the page, and the component could never reach it. Move the dynamic part out of the <template>, or display it in a child component.`,
  'generator.hors-tableau': ({ tag, parent, ligne }: MsgVars) => `[ModularJS] <${tag}> (line ${ligne}) cannot be placed directly inside a <${parent}> — the browser takes it out of the table and puts it before it, and the path computed at build time would then target a node that is not there. Put it inside a <td> cell, or outside the <table>.`,
  'generator.hors-tableau-form': ({ parent, ligne }: MsgVars) => `[ModularJS] <form> (line ${ligne}) cannot be placed directly inside a <${parent}> — the browser leaves an empty <form> there, closed on the spot, and takes its content out of the form (rows stay in the table, everything else goes before it): the path computed at build time would then target a node that is not there. Put the <form> around the <table>, or inside a <td> cell.`,
  'generator.texte-hors-tableau': ({ parent, ligne }: MsgVars) => `[ModularJS] text (line ${ligne}) cannot be placed directly inside a <${parent}> — the browser takes it out of the table and puts it before it, and the path computed at build time would then target a node that is not there. Put it inside a <td> cell, or outside the <table>.`,
  'generator.imbrication-refusee': ({ tag, ligne }: MsgVars) => `[ModularJS] <${tag}> (line ${ligne}): a <${tag}> cannot be placed inside another <${tag}> — depending on the case, the browser closes the first one, ignores the second one or moves its content, and the path computed at build time would then target a node that is not there. Close the first <${tag}> before opening the next one.`,
  // {await} nested in {for} silently degraded into a placeholder
  // visible to end users, with no compile-time error at all.
  'generator.await-imbrique-dans-await': ({ ligne }: MsgVars) => `[ModularJS] {await} (line ${ligne}): an {await} nested inside a branch of another {await} is not supported, even deep inside an {if} or a {key} of that branch — move it into a child component that this branch displays (<@component-name>): that component then holds its own {await}.`,
  'generator.await-imbrique-interdit': ({ ligne }: MsgVars) =>`[ModularJS] {await} (line ${ligne}): an {await} nested inside a {for} is not supported — move it out of the {for} (an {await} nested inside a root-level {if} is still allowed).`,
  // attribute quote left open until the end of the template: the
  // faulty tag AND everything after it vanished from the generated fragment, silently.
  'generator.attribut-guillemet-non-ferme': ({ tag }: MsgVars) => `[ModularJS] <${tag}>: a quote left open in an attribute is never closed before the end of the template — check that tag's attribute quotes/apostrophes.`,
  'transpiler.derived-await-interdit': ({ varName }: MsgVars) => `[ModularJS] "µderived $${varName} = …": a µderived is synchronous — for an asynchronous value, write a µeffect that awaits, then writes a state variable.`,

  // ═══ Types and allowed values (transpiler/var-types.ts) ══════════════════════════════════
  'types.regle-invalide': ({ bloc, ligne, texte, detail }: MsgVars) => `[ModularJS] ${bloc}, line ${ligne}: "${texte}" — ${detail}`,
  'types.detail-chaine-non-fermee': ({ texte }: MsgVars) => `the text ${texte} has no closing quote — close it.`,
  'types.detail-forme-non-fermee': ({ texte }: MsgVars) => `the pattern ${texte} has no closing / — close it.`,
  'types.detail-forme-drapeau': ({ texte, drapeau }: MsgVars) => `the ${drapeau} flag of ${texte} would make the result change from one test to the next — remove it.`,
  'types.detail-forme-invalide': ({ texte, erreur }: MsgVars) => `the pattern ${texte} is invalid (${erreur}).`,
  'types.detail-forme-vide': ({ texte }: MsgVars) => `the pattern ${texte} is empty: it constrains nothing — write it between the two /, or remove it (a comment starts with #).`,
  'types.detail-caractere': ({ car }: MsgVars) => `unexpected character "${car}".`,
  'types.detail-fin': ({ attendu }: MsgVars) => `the rule stops too early — "${attendu}" is missing.`,
  'types.detail-jeton': ({ jeton, attendu }: MsgVars) => `unexpected "${jeton}" — expected "${attendu}".`,
  'types.detail-jeton-seul': ({ jeton }: MsgVars) => `unexpected "${jeton}" here.`,
  'types.detail-interdits-conteneur': `forbidden values apply to a simple value, not to a list or an object — put them on its items or its fields (a named rule helps: Nick  string ! 'admin', then Nick[]).`,
  'types.detail-interdits-vides': `nothing after the "!" — write the forbidden values, separated by | (e.g. ! 'admin' | 'root').`,
  'types.detail-interdit-invalide': ({ jeton }: MsgVars) => `"${jeton}" cannot be forbidden — a forbidden value is a text, a number, true, false, null, or a number range (40..60).`,
  'types.detail-plage-vide': `a range has at least one bound (0..10, 0.. or ..10).`,
  'types.detail-bornes-inversees': ({ plage }: MsgVars) => `bounds in the wrong order (${plage}) — smallest first.`,
  'types.detail-plage-sans-type': ({ plage }: MsgVars) => `a number range says what it accepts: int ${plage} (whole number) or float ${plage} (decimal number).`,
  'types.detail-plage-hors-nombre': ({ type }: MsgVars) => `no range on a ${type}.`,
  'types.detail-plage-regle-nommee': ({ nom }: MsgVars) => `"${nom}" takes no range: a named rule carries its own in its definition (*.types.mjs file) — or "${nom}" is a misspelled type (int, float, string, bool, any).`,
  'types.detail-fin-regle': `the rule is empty.`,
  'types.detail-forme-hors-string': ({ texte }: MsgVars) => `a ${texte} pattern only applies to a string.`,
  'types.detail-deux-plages': `two ranges for the same value — keep one.`,
  'types.detail-bornes-entieres': `an int has whole-number bounds.`,
  'types.detail-longueur': `a length (of a text or a list) has whole, zero or positive bounds.`,
  'types.detail-deux-formes': `two /…/ patterns for the same text — keep one.`,
  'types.detail-accolade': `brace never closed — add the closing }.`,
  'types.detail-cle': ({ jeton }: MsgVars) => `"${jeton}" is not a field name.`,
  'types.detail-cle-double': ({ cle }: MsgVars) => `the field "${cle}" appears twice.`,
  'types.detail-cle-reservee': ({ cle }: MsgVars) => `"${cle}" cannot be a field name.`,
  'types.ligne-invalide': ({ bloc, ligne, texte }: MsgVars) => `[ModularJS] ${bloc}, line ${ligne}: "${texte}" — a line starts with a name, then its rule.`,
  'types.regle-nommee-dans-vars': ({ ligne, nom }: MsgVars) => `[ModularJS] <vars>, line ${ligne}: "${nom}" — a named rule is declared in a *.types.mjs file, valid across the whole app; <vars> declares the component's variables ($name) and stores ($$name).`,
  'types.deux-points': ({ bloc, ligne, nom, regle }: MsgVars) => `[ModularJS] ${bloc}, line ${ligne}: no colon after the name — write \`${nom}  ${regle}\`.`,
  'types.regle-manquante': ({ bloc, ligne, nom }: MsgVars) => `[ModularJS] ${bloc}, line ${ligne}: "${nom}" has no rule — write its rule after the name (e.g. ${nom}  int 0..100).`,
  'types.double': ({ bloc, ligne, nom }: MsgVars) => `[ModularJS] ${bloc}, line ${ligne}: "${nom}" is already declared earlier in the block.`,
  'types.variable-dans-types': ({ ligne, nom }: MsgVars) => `[ModularJS] <types>, line ${ligne}: "${nom}" — a variable is declared in its component's <vars>; a *.types.mjs file only holds named rules (e.g. Percent  int 0..100).`,
  'types.mot-reserve': ({ ligne, nom }: MsgVars) => `[ModularJS] <types>, line ${ligne}: "${nom}" is a word of the grammar — pick another name.`,
  'types.regle-inconnue-suggestion': ({ bloc, ligne, nom, suggestion }: MsgVars) => `[ModularJS] ${bloc}, line ${ligne}: unknown rule "${nom}" — did you mean "${suggestion}"? Named rules are declared in a *.types.mjs file.`,
  'types.regle-inconnue': ({ bloc, ligne, nom }: MsgVars) => `[ModularJS] ${bloc}, line ${ligne}: unknown rule "${nom}" — declare it in a *.types.mjs file (e.g. ${nom}  int 0..100).`,
  'types.regle-boucle': ({ bloc, ligne, chaine }: MsgVars) => `[ModularJS] ${bloc}, line ${ligne}: these named rules go round in circles (${chaine}).`,
  'types.ressort': ({ nom, rune, signature, ligne }: MsgVars) => `[ModularJS] <vars>: "${nom}" receives a ${rune} on line ${ligne} — an animated value already has its own bounds: ${signature}. Remove ${nom} from the <vars>.`,
  'effets.inconnu': ({ nom, liste }: MsgVars) => `[ModularJS] *${nom}: unknown effect — available effects: ${liste}.`,
  'effets.alias-inconnu': ({ nom, effet, liste }: MsgVars) => `[ModularJS] *${nom}: no alias of that name for *${effet} — known aliases: ${liste}. Declare it in an *.effects.mjs file: *${nom} = *${effet}(settings).`,
  'effets.alias-nom': ({ nom, liste, exemple }: MsgVars) => `[ModularJS] *${nom}: an alias name is written with lowercase letters, digits and _ only, and starts with a letter (${exemple}) — known aliases: ${liste}.`,
  'effets.retire': ({ nom, liste }: MsgVars) => `[ModularJS] *${nom}: unknown effect — it was removed from the library; available effects: ${liste}.`,
  'effets.remplace': ({ nom, effet, reglages }: MsgVars) => `[ModularJS] *${nom} no longer exists: it is now part of another effect — write ${effet}, which renders the same${reglages}.`,
  'effets.remplace-reglages': ({ nom, effet, reglages }: MsgVars) => `[ModularJS] *${nom} no longer exists: it is now part of another effect — write ${effet}, with the settings translated${reglages}.`,
  'effets.remplace-correspondance': ({ liste }: MsgVars) => ` (settings correspondence: ${liste})`,
  'effets.remplace-sans-equivalent': ({ alias, liste }: MsgVars) => ` No direct equivalent in ${alias}, carry it over using the correspondence or remove it: ${liste}.`,
  'effets.pseudo-partage': ({ balise, liste }: MsgVars) => `<${balise}>: two effects draw in the same pseudo-element — ${liste}; only one will show. Put one of them on a tag that wraps this one.`,
  'effets.remplace-ramene': ({ alias, liste }: MsgVars) => ` Value outside the range of ${alias}, brought back to its bound in the suggested writing: ${liste}.`,
  'effets.alias-retire': ({ nom, effet, ecriture }: MsgVars) => `[ModularJS] *${nom}: no alias of that name for *${effet} — it was removed from the library: write ${ecriture} instead.`,
  'effets.valeur-retiree': ({ nom, reglage, valeur, nouveau, note, regle }: MsgVars) => `[ModularJS] *${nom}: ${reglage} = ${valeur} no longer exists — write ${reglage}: ${nouveau}${note}; allowed: ${regle}.`,
  'effets.valeur-meme-dessin': ' (the same drawing)',
  'effets.valeur-mesh-aurora': ' (the aurora palette is now called boreal; *mesh.aurora is the former *aurora effect, not this palette)',
  'effets.valeur-attention-flash': ' (the blinking style is now called blink, so it is not confused with the *flash effect)',
  'effets.suggestion': ({ nom }: MsgVars) => ` Did you mean *${nom}?`,
  'effets.reglage-inconnu': ({ nom, reglage, liste }: MsgVars) => `[ModularJS] *${nom}: unknown setting "${reglage}" — settings of *${nom}: ${liste}.`,
  'effets.reglage-renomme': ({ reglage, nouveau }: MsgVars) => ` "${reglage}" was replaced — use instead: ${nouveau}.`,
  'effets.valeur': ({ nom, reglage, valeur, regle }: MsgVars) => `[ModularJS] *${nom}: ${reglage} = ${valeur} — allowed: ${regle}.`,
  'effets.positionnel': ({ nom, principal }: MsgVars) => `[ModularJS] *${nom}: only one unnamed value is allowed (it sets "${principal}"); name the others: *${nom}(value, setting: value).`,
  'effets.double': ({ nom, reglage }: MsgVars) => `[ModularJS] *${nom}: "${reglage}" is written twice.`,
  'effets.valeur-calculee': ({ nom, reglage }: MsgVars) => `[ModularJS] *${nom}: ${reglage} — no braces inside the parentheses: write the value, or the variable as is (*${nom}(${reglage}: $x)).`,
  'effets.image-longue': ({ nom, reglage, longueur }: MsgVars) => `[ModularJS] *${nom}: ${reglage} — an image fits in 2000 characters at most, this one has ${longueur}: put the file in the source folder and write its path ('photo.png'), or give its full address (https://…).`,
  'effets.image-non-resolue': ({ nom, reglage, valeur }: MsgVars) => `[ModularJS] *${nom}: ${reglage} — ${valeur} was not replaced at build time: write the image path in quotes, ${reglage}: 'path.png', with the file in the source folder; µimage('path.png', 480, 960) remains available to choose the variant widths, the path in quotes as well.`,
  'effets.variable-seule': ({ nom, reglage, valeur }: MsgVars) => `[ModularJS] *${nom}: ${reglage} = ${valeur} — a variable is written alone ($x, $$x, $x.field); for a computation, use a derived variable.`,
  'effets.manque': ({ nom, reglage }: MsgVars) => `[ModularJS] *${nom}: the key is missing — *${nom}(${reglage === 'key' ? 'p.id' : reglage}): it pairs the tag on one page with the one on the other.`,
  'effets.sock-variable': ({ nom, valeur }: MsgVars) => `[ModularJS] *${nom}: sock takes the variable that holds the connection — sock: $$sock (a store: one connection for the whole app) or sock: @sock; got ${valeur}. Another address is written server: 'wss://…'.`,
  'effets.sock-absent': ({ nom, ecriture }: MsgVars) => `[ModularJS] *${nom} takes its connection from @sock, which this component does not set: write @sock = µsocket 'wss://…' in its <script>, or pass it: *${nom}(${ecriture}).`,
  'effets.egal': ({ nom, ligne }: MsgVars) => `[ModularJS] *${nom}=… (line ${ligne}): an effect's settings go inside parentheses — *${nom}(setting: value).`,
  'effets.espace': ({ nom, ligne }: MsgVars) => `[ModularJS] *${nom} (…)${ligne ? ` (line ${ligne})` : ''}: an effect's settings stick to its name — write *${nom}(…), with no space before the parenthesis.`,
  'effets.point-espace': ({ nom, point, exemple, ligne }: MsgVars) => `[ModularJS] *${nom} ${point}${ligne ? ` (line ${ligne})` : ''}: a space separates "${point}" from its effect — an alias name sticks to its effect, with no space (${exemple}).`,
  'effets.point-reglages': ({ nom, blanc, point, exemple, ligne }: MsgVars) => `[ModularJS] *${nom}(…)${blanc}${point}${ligne ? ` (line ${ligne})` : ''}: "${point}" follows the settings — an alias name goes before them, stuck to its effect: ${exemple}(settings).`,
  'effets.point-sans-effet': ({ point, ligne }: MsgVars) => `[ModularJS] *${point}${ligne ? ` (line ${ligne})` : ''}: the effect name is missing before the dot — an alias is written *effect.name (the effect, a dot, then the alias name, with no space).`,
  'effets.commentaire': ({ nom, ligne, commentaire }: MsgVars) => `[ModularJS] *${nom}${ligne ? ` (line ${ligne})` : ''}: "${commentaire}" — a comment cannot be written in an effect's settings: remove it. If it is an address, put it between quotes: image: '//cdn/a.png'.`,
  'effets.balise': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} cannot go on <${balise}>, which renders nothing itself: put it on a tag around it.`,
  'effets.svg': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} on <${balise}>: inside an <svg> or a <math>, an effect goes on the <svg> or <math> tag itself, or on a tag around it.`,
  'effets.contenu': ({ quoi, balise }: MsgVars) => `[ModularJS] ${quoi} draws inside its tag, and <${balise}> renders no content: put the effect on a tag around it.`,
  'effets.texte': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} works on the text of its tag, and <${balise}> has no text of its own (an image, a field, or a component that shows its own): put the effect on a text tag — inside the component, if need be.`,
  'effets.balise-speciale': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} cannot go on <@${balise}>: an effect goes on an HTML tag or a component.`,
  'effets.parenthese': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} on <@${balise}>: the parenthesis of its settings is never closed — add the closing ).`,
  'effets.guillemet-ouvert': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} on <@${balise}>: a double quote in its settings is never closed — add the closing ".`,
  'effets.texte-ouvert': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} on <@${balise}>: a quoted text in its settings is never closed — an apostrophe inside a word (l'été) opens one. Wrap the value in double quotes: *${nom}(setting: "l'été").`,
  'effets.document': ({ nom, liste }: MsgVars) => `[ModularJS] *${nom} cannot go on <@document>: only whole-page effects go there (${liste}). Put *${nom} on an HTML tag or a component.`,
  'effets.document-variable': ({ nom }: MsgVars) => `[ModularJS] *${nom} on <@document>: fixed values only — no template tag follows a variable here. Write the value, or put the effect on a tag.`,
  'effets.regle-duree': () => `a duration (300ms, 1.5s, 0)`,
  'effets.regle-couleurs': () => `a list of colors ([#f0f, #0ff, gold])`,
  'effets.regle-mots': () => `a list of words ([Coder., 'Designer, web.'])`,
  'effets.regle-direction': () => `right, left, up, down, up-right, up-left, down-right, down-left, or an angle in degrees (0 = up, 90 = right, from -360 to 360)`,
  'effets.regle-origine': () => `center, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right, or "x% y%" (20% 80%)`,
  'effets.regle-origine-pointeur': () => `center, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right, "x% y%" (20% 80%), or pointer (the point under the mouse)`,
  'effets.regle-courbe': () => `linear, ease, ease-in, ease-out, ease-in-out, cubic-bezier(…), or a curve: back, bounce, circ, cubic, elastic, expo, quad, quart, quint, sine, followed by -in, -out or -in-out (bounce-out, elastic-out)`,
  'effets.regle-longueur': () => `a length: a number (in px) or a CSS value (40px, 100%, 2em)`,
  'effets.regle-plage': () => `two page scroll positions, "start end", in px or vh (0 1000px, 100vh 200vh)`,
  'effets.regle-zone': () => `two screen heights, "start end", in % (0% at the top, 100% at the bottom) or top, center, bottom (70% 40%, bottom center)`,
  'effets.regle-cle': () => `what identifies the tag from one list to the other: a variable (item.id, $choice) or a value`,
  'effets.regle-css': () => `a CSS value (#0ff, 12px, 0 0 20px red), without ; or braces`,
  'effets.regle-image': () => `an image: its address, µasset('…') or µimage('…'), or the path of a file in the source folder or in one of the \`assetDirs\` folders ('photo.jpg')`,
  'effets.regle-images': () => `a list of images: their addresses, µasset('…') or µimage('…'), or the path of a file in the source folder or in one of the \`assetDirs\` folders ([a.jpg, 'b.jpg'])`,
  'effets-fichier.retrait': ({ fichier, ligne, texte }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): "${texte}" — unexpected indentation. An effect starts at the edge of the block (*name = … or *name(settings) =), its CSS lines below, all at the same indentation.`,
  'effets-fichier.ligne': ({ fichier, ligne, texte }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): "${texte}" — expected: *name = *effect(settings) (a library effect, set), or *name(setting: default) = followed by its CSS lines.`,
  'effets-fichier.double': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} is already defined above.`,
  'effets-fichier.alias-reglages': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom}(…) = *… — a set effect takes its settings on the right: *${nom} = *effect(settings).`,
  'effets-fichier.alias-corps': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): CSS under *${nom}, which sets a library effect — for your own CSS effect, write *${nom} = followed by its lines.`,
  'effets-fichier.vide': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} = … with nothing: write the effect it sets (*${nom} = *fade(300ms)), or its CSS lines below.`,
  'effets-fichier.reglage': ({ fichier, ligne, nom, reglage }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} — setting "${reglage}": write name: default value (color: #0ff, size: 12px), a CSS value without ; or braces.`,
  'effets-fichier.reserve': ({ fichier, ligne, nom, reglage, liste }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} — "${reglage}" is a setting every effect already has (${liste}): don't declare it, write it where the effect is placed.`,
  'effets-fichier.declaration': ({ fichier, ligne, texte, nom }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} — "${texte}": a CSS declaration is written property: value, on one line, without ; or braces.`,
  'effets-fichier.inconnu': ({ fichier, ligne, nom, reglage, liste }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} — $${reglage} is not a setting of the effect (settings: ${liste}). Declare it in the parentheses: *${nom}(${reglage}: value) =.`,
  'effets-fichier.images-cles': ({ fichier, ligne, texte, nom }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} — "${texte}": under @keyframes, a step (from, to, 50%) then its declarations, further indented.`,
  'effets-fichier.nom-pris': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} is already a library effect — pick another name.`,
  'effets-fichier.nom-double': ({ nom, fichier1, fichier2 }: MsgVars) => `[ModularJS] *${nom} is defined twice: in ${fichier1} and in ${fichier2}. One name per app.`,
  'effets-fichier.boucle': ({ fichier, ligne, chaine }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): effects that set each other in a loop — ${chaine}.`,
  'effets-fichier.variable': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} — a fixed value only: the file is for the whole app, no variable is followed there. Pass the variable where the effect is placed: *${nom}(setting: $x).`,
  'effets-fichier.cible-inconnue': ({ fichier, ligne, nom, cible, suggestion }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} = *${cible} — *${cible} is neither a library effect nor an app effect${suggestion}.`,
  'effets-fichier.alias-nom': ({ fichier, ligne, effet, alias, exemple }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${effet}.${alias} — an alias name is written with lowercase letters, digits and _ only, and starts with a letter (${exemple}).`,
  'effets-fichier.alias-cible': ({ fichier, ligne, effet, alias }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${effet}.${alias} — an alias belongs to its effect: write *${effet}.${alias} = *${effet}(settings), *${effet} being a library effect.`,
  'effets-fichier.alias-fondu': ({ fichier, ligne, effet, alias, nouveau, ecriture }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${effet}.${alias} — *${effet} no longer exists: it is now part of *${nouveau}; write ${ecriture}.`,
  'effets-fichier.alias-remplace': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} replaces the alias of the same name that ModularJS ships.`,
  'effets-fichier.commentaire': ({ fichier, ligne, nom, commentaire }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} — "${commentaire}": a comment cannot be written in an effect's settings: remove it. If it is an address, put it between quotes: image: '//cdn/a.png'.`,
  'effets-fichier.reglage-faux': ({ fichier, ligne, detail }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): ${detail}`,
  'effets-fichier.non-ferme': ({ fichier, ligne, texte, nom }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} — "${texte}": a quote or a parenthesis is left open (or a backslash ends the value); in the effect's stylesheet, it would swallow what follows. Close it.`,
  'effets-fichier.nom-js': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (line ${ligne}): "${nom}" — this name is already taken by JavaScript (constructor, toString, valueOf…): pick another one.`,
  'bundler.effets-fichier-sans-bloc': ({ fichier }: MsgVars) => `[ModularJS] ${fichier}: an *.effects.mjs file contains an <effects>…</effects> block.`,
  'bundler.effets-fichier-multi': ({ fichier }: MsgVars) => `[ModularJS] ${fichier}: one <effects> block per file.`,
  'bundler.effets-fichier-impur': ({ fichier, quoi }: MsgVars) => `[ModularJS] ${fichier}: an *.effects.mjs file only contains its <effects> block — ${quoi} does not belong there.`,
  'transitions.cycle-seul': ({ nom }: MsgVars) => `[ModularJS] *${nom} links a leaving tag to an entering one: it goes on its lifecycle, @transition=*${nom}(key: …) (or @in, @out), not directly on the tag.`,
  'transitions.declencheur': ({ nom, reglage, directive }: MsgVars) => `[ModularJS] ${directive}=*${nom}: "${reglage}" makes no sense here — ${directive} triggers the effect (the tag entering or leaving). Remove it, or put the effect directly on the tag: *${nom}(${reglage}: …).`,
  'transitions.declencheur-alias': ({ nom, reglage, valeur, directive }: MsgVars) => `[ModularJS] ${directive}=*${nom}: the alias *${nom} carries a trigger (${reglage}: ${valeur}) — so it cannot be used after ${directive}=, ${directive} is what triggers the effect. Put it directly on the tag: *${nom}, or declare an alias without ${reglage} in an *.effects.mjs file.`,
  'transitions.continu': ({ nom, directive }: MsgVars) => `[ModularJS] ${directive}=*${nom}: *${nom} is a continuous (or stateful) effect, it does not play once when a tag enters or leaves. Put it directly on the tag: *${nom}.`,
  'transitions.ancienne': ({ ecrite, directive, nom, reglage, modificateurs }: MsgVars) => `[ModularJS] ${ecrite}: a transition is an effect — write ${directive}=*${nom}, with its settings in parentheses (${directive}=*${nom}(${reglage}))${modificateurs ? '' : `; modifiers stay on the directive (${directive}.global=*${nom})`}.`,
  'transitions.retiree': ({ ecrite, directive, effet }: MsgVars) => `[ModularJS] ${ecrite}: this animation no longer exists — write ${directive}=${effet}.`,
  'transitions.attend-effet': ({ directive }: MsgVars) => `[ModularJS] ${directive} expects an effect: ${directive}=*fade, ${directive}=*fly(up, distance: 40px).`,
  'transitions.guillemets': ({ directive, effet }: MsgVars) => `[ModularJS] ${directive}="${effet}": an effect is written without quotes — ${directive}=${effet}.`,
  'transitions.modificateur': ({ directive, mod }: MsgVars) => `[ModularJS] ${directive}.${mod}: unknown modifier — a transition knows only two, .global and .shared (${directive}.global=*fade).`,
  'transitions.maison-positionnel': ({ nom }: MsgVars) => `[ModularJS] *${nom}: a transition created by µanim.create has no main setting — name each setting (*${nom}(duration: 400ms)).`,
  'transitions.maison-valeur': ({ nom, reglage, valeur }: MsgVars) => `[ModularJS] *${nom}: ${reglage} = ${valeur} — a fixed value (400ms, 12, right, 'text', [a, b]) or a variable ($x, item.id); no computation inside the parentheses.`,
  'effets.regle-effet': () => `an effect that plays once (*scramble, *fly(up), *count…), or none`,
  'effets.regle-connexion': () => `the variable that holds a µsocket connection ($$sock, @sock)`,
  'effets.fx-effet': ({ nom, reglage, valeur }: MsgVars) => `[ModularJS] *${nom}: ${reglage} = ${valeur} — ${reglage} expects an effect, written with its star: ${reglage}: *scramble, ${reglage}: *fly(up); or none.`,
  'effets.fx-une-fois': ({ nom, reglage, effet }: MsgVars) => `[ModularJS] *${nom}: ${reglage}: *${effet} — *${effet} does not play once (it is a continuous or stateful effect): ${reglage} takes a transition (*fade, *fly…) or an effect that plays (*scramble, *stagger, *count…).`,
  'effets.fx-variable': ({ nom, reglage, effet }: MsgVars) => `[ModularJS] *${nom}: ${reglage} = ${effet} — the effect given to ${reglage} is written in full, with fixed values (${reglage}: *scramble(20)); no variable.`,
  'effets.champ': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} goes on a field (<input>, <textarea>, <select>), not on <${balise}>.`,
  'effets.regle-couleur': () => `a CSS color`,

} satisfies Record<keyof typeof fr, MsgEntry>
