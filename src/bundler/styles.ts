// feuilles de style du Bundler : partagées (stylesheetsDir, `µ.CSS`), découpées (`css: 'split'`) et à la demande (`css: 'lazy'`)
// fonctions sorties de la classe Bundler, qui garde ses méthodes (mêmes noms, mêmes signatures) et leur passe l'instance : un membre
// privé de la classe s'y lit `bundler['nom']`, et tout appel de méthode passe par l'instance, comme avant la découpe
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileCss } from '../transpiler/css.js'
import { cssTrapWarnings } from '../transpiler/index.js'
import { t } from '../messages/index.js'
import { minifyJs } from './minify.js'
import type { Bundler } from './index.js'

// bundleSharedStyles() : compile les .sass/.scss/.css de stylesheetsDir et
// les expose via `µ.CSS[name] = sheet`. Le runtime les consomme à la demande
// via `_mjs_sharedCss`. Un fichier `mjs_root.{sass,scss}` est traité à part
// et adopté globalement (comme en V1).
// Retourne le nombre de stylesheets émis (0 si aucun) + les warnings
// `cssTrapWarnings` accumulés sur les feuilles NOMMÉES.
// --------------------------------------------------------------------------
export async function bundleSharedStyles(bundler: Bundler): Promise<{ count: number; warnings: string[] }> {
  // CSS de ce tour-ci par feuille (hors mjs_root) / de mjs_root, pour
  // le diff "css-only" (trackSharedCssDiff, appelé à CHAQUE sortie de fonction
  // ci-dessous, y compris les replis précoces — un stylesheetsDir qui disparaît
  // ou se vide doit aussi pouvoir disqualifier un lot en cours).
  const newSharedCss = new Map<string, string>()
  let newRootCss: string | undefined
  if (!existsSync(bundler.stylesheetsDir)) {
    bundler.manifest['__styles'] = ''
    bundler['trackSharedCssDiff'](newSharedCss, newRootCss)
    return { count: 0, warnings: [] }
  }

  // `readdirSync` NE GARANTIT AUCUN
  // ORDRE (dépend du filesystem/OS, peut différer entre deux machines ou
  // deux builds du même repo). Sans tri : (1) l'ORDRE DE CASCADE CSS entre
  // stylesheets partagés dépend de cet ordre arbitraire — deux règles
  // conflictuelles de même spécificité dans 2 fichiers différents peuvent
  // "gagner" différemment selon la machine, pour un SOURCE IDENTIQUE ;
  // (2) le hash de `mjs_styles-<hash>.js` (dérivé du JS concaténé DANS cet
  // ordre) devient non déterministe d'un build à l'autre — casse les
  // builds reproductibles. Même correctif déjà en place pour les
  // animations (`compileUsedAnimations`, tri explicite du Set avant
  // concaténation, cf. son propre commentaire) — mimé ici.
  const files = readdirSync(bundler.stylesheetsDir)
    .filter(f => /\.(sass|scss|css)$/.test(f))
    .sort()

  if (files.length === 0) {
    bundler.manifest['__styles'] = ''
    bundler['trackSharedCssDiff'](newSharedCss, newRootCss)
    return { count: 0, warnings: [] }
  }

  let js = `import { µ } from '${bundler.coreHashedPath}';\n`
  let rootCount = 0
  let sharedCount = 0
  // `compileCss` throw désormais
  // sur une erreur SASS/SCSS (cf. son propre commentaire) au lieu de
  // l'avaler. Isolé PAR FICHIER ici : un stylesheet partagé cassé ne doit
  // pas empêcher la compilation des AUTRES (contrairement au cas
  // composant, où laisser l'erreur du worker remonter telle quelle est le
  // comportement voulu) — les erreurs sont collectées et jetées ENSEMBLE
  // à la fin, remontées par le try/catch déjà en place chez le caller de
  // bundleSharedStyles() dans stats.errors.
  const cssErrors: string[] = []
  // une feuille NOMMÉE (`@css name`) atterrit, une fois
  // consommée, dans le SHADOW ROOT du composant consommateur (`_mjs_sharedCss`,
  // runtime/mjs_element.ts) : même piège @font-face/@import qu'un <style> de
  // composant (cf. cssTrapWarnings). `mjs_root.{sass,scss}` échappe au piège
  // (adopté en `document.adoptedStyleSheets`, HORS Shadow DOM) — volontairement
  // exclu du scan (branche `if baseName === 'mjs_root'` ci-dessous).
  const cssWarnings: string[] = []

  for (const file of files) {
    const path = join(bundler.stylesheetsDir, file)
    const baseName = file.replace(/\.(sass|scss|css)$/, '')
    const ext = file.match(/\.(sass|scss|css)$/)![1] as 'sass' | 'scss' | 'css'
    // Même garde que macros.ts/transpiler/index.ts :
    // ce chemin (feuille PARTAGÉE, mjs_root compris) ne passait JAMAIS par le
    // strip \x00 posé pour <@include> — un NUL réel + un mot-clé sentinel dans
    // CE fichier faisait passer STYLE_BLOCK_RE (transpiler/css.ts) pour un
    // découpage multi-lang légitime et INJECTAIT le texte encadré tel quel
    // dans le CSS livré (confirmé en conditions réelles). Un NUL n'est jamais un
    // caractère utile en CSS/SASS (même raisonnement, aucune perte).
    // Confinement RÉEL (cf. assertRealUnder) : un symlink DANS stylesheetsDir
    // pointant HORS de lui était lu tel quel, son contenu publié dans mjs_styles-<hash>.js.
    bundler['assertRealUnder'](path, bundler.stylesheetsDir)
    const src = readFileSync(path, 'utf-8').replace(/\x00/g, '')
    let css: string
    try {
      css = await bundler['compileSharedSheet'](path, src, ext)
    } catch (e: any) {
      cssErrors.push(`${file} : ${e?.message ?? e}`)
      continue
    }
    if (css.trim() === '') continue

    // mjs_root.{sass,scss} → adopté globalement
    if (baseName === 'mjs_root') {
      js += `{\n` +
            `  const _root = new CSSStyleSheet();\n` +
            `  _root.replaceSync(${JSON.stringify(css)});\n` +
            `  document.adoptedStyleSheets = [...document.adoptedStyleSheets, _root];\n` +
            // handle sinon perdu (scope de bloc) : nécessaire à
            // µ._hotCss (dev) pour un replaceSync ultérieur en place.
            `  µ._mjs_rootStyleSheet = _root;\n` +
            `}\n`
      rootCount++
      newRootCss = css
    } else {
      for (const w of cssTrapWarnings(css, bundler.lint)) cssWarnings.push(`[bundler] ${file} : ${w}`)
      const safeVar = baseName.replace(/[^a-zA-Z0-9]/g, '_')
      // FAILLE — la CLÉ était injectée
      // brute entre apostrophes (`µ.CSS['${baseName}']`) : un nom de fichier
      // stylesheet contenant une `'` (ou `\`) sortait de la chaîne et injectait
      // du JS arbitraire dans mjs_styles.js. `JSON.stringify` échappe la clé
      // (la VALEUR css l'était déjà). safeVar reste sûr (déjà assaini ci-dessus).
      const keyLit = JSON.stringify(baseName)
      js += `µ.CSS = µ.CSS || {};\n` +
            `if (!µ.CSS[${keyLit}]) {\n` +
            `  const s_${safeVar} = new CSSStyleSheet();\n` +
            `  s_${safeVar}.replaceSync(${JSON.stringify(css)});\n` +
            `  µ.CSS[${keyLit}] = s_${safeVar};\n` +
            `}\n`
      sharedCount++
      newSharedCss.set(baseName, css)
    }
  }

  if (rootCount + sharedCount === 0) {
    bundler.manifest['__styles'] = ''
    bundler['trackSharedCssDiff'](newSharedCss, newRootCss)
    // Si TOUS les fichiers ont échoué (aucun succès), pas de quoi écrire —
    // mais surtout ne PAS avaler l'erreur silencieusement.
    if (cssErrors.length > 0) {
      throw new Error(t('bundler.index.css-sass-erreurs', { erreurs: cssErrors.join('\n') }))
    }
    return { count: 0, warnings: cssWarnings }
  }

  const minified = await minifyJs(js, {
    force: bundler.shouldMinify(),
    filename: 'mjs_styles.js',
    mangleCache: bundler.mangleCache,
    logLevel: bundler['prodLogLevel'](),
    dev: !bundler['isProd'](),
  })
  // mode 'bundle' : jamais un fichier `mjs_styles-<hash>.js` — gardé en mémoire, résolu par
  // le plugin esbuild d'emitSingleFile() sous 'mjs:styles' (cf. bandeau de bundleRuntime()
  // pour la même logique côté cœur).
  let hashedPath: string
  if (bundler.jsMode === 'bundle') {
    bundler['bundleVirtualSources'].set('mjs_styles', bundler['withInlineSourceMap'](minified.code, minified.map))
    hashedPath = 'mjs:styles'
  } else {
    hashedPath = bundler.writeHashed('mjs_styles', '.js', minified.code)
  }
  bundler.manifest['__styles'] = hashedPath
  // diff sémantique feuille par feuille (avant le throw éventuel
  // ci-dessous : la baseline doit refléter ce qui vient d'être écrit, même
  // si un AUTRE fichier de stylesheetsDir a échoué — les erreurs, elles,
  // disqualifient déjà le verdict via stats.errors).
  bundler['trackSharedCssDiff'](newSharedCss, newRootCss)
  // Écrit d'abord le sous-ensemble RÉUSSI (comme pour les composants .mjs,
  // un fichier cassé ne doit pas priver les autres de leur sortie), PUIS
  // signale l'échec — remonté par le try/catch déjà en place chez le
  // caller dans stats.errors (le build ENTIER n'est pas vert pour autant).
  if (cssErrors.length > 0) {
    throw new Error(t('bundler.index.css-sass-erreurs', { erreurs: cssErrors.join('\n') }))
  }
  return { count: rootCount + sharedCount, warnings: cssWarnings }
}

export async function compileSharedSheet(bundler: Bundler, path: string, src: string, ext: 'sass' | 'scss' | 'css'): Promise<string> {
  const resolved = await bundler['resolveCssAssets'](src)
  const memo     = bundler['sharedSheetMemo'].get(path)
  if (memo !== undefined && memo.ext === ext && memo.src === resolved) return memo.css
  const css = compileCss(resolved, ext)
  bundler['sharedSheetMemo'].set(path, { ext, src: resolved, css })
  return css
}

// --------------------------------------------------------------------------
// trackSharedCssDiff : diff sémantique des feuilles partagées entre
// le compile PRÉCÉDENT et celui-ci. Une feuille présente des deux côtés avec un
// CSS différent est éligible au hot-swap (`µ.CSS[name].replaceSync` côté client) ;
// une feuille qui APPARAÎT ou DISPARAÎT disqualifie le lot (µ.CSS[name] naît au
// chargement de mjs_styles.js, un composant doit être recompilé pour la
// référencer — repli reload complet, au moindre doute). Idem pour mjs_root.
// Hors watch : simple mise à jour de baseline, aucun verdict.
// --------------------------------------------------------------------------
export function trackSharedCssDiff(bundler: Bundler, newSharedCss: Map<string, string>, newRootCss: string | undefined): void {
  if (bundler['cssOnlyTracking']) {
    for (const [name, css] of newSharedCss) {
      const prev = bundler['lastSharedCss'].get(name)
      if (prev === undefined) bundler['cssOnlyDisqualified'] = true
      else if (prev !== css) bundler['cssOnlySheets'][name] = css
    }
    for (const name of bundler['lastSharedCss'].keys()) {
      if (!newSharedCss.has(name)) bundler['cssOnlyDisqualified'] = true
    }
    if (newRootCss !== undefined && bundler['lastRootCss'] !== undefined) {
      if (newRootCss !== bundler['lastRootCss']) bundler['cssOnlyRoot'] = newRootCss
    } else if (newRootCss !== bundler['lastRootCss']) {
      bundler['cssOnlyDisqualified'] = true  // mjs_root apparu/disparu
    }
    // mjs_styles.js est RÉÉMIS dès qu'une feuille change : émission attendue
    // d'un lot css-only, exemptée du diff central de writeHashed (cf. compile()).
    bundler['cssOnlyAllowedWrites'].add('mjs_styles.js')
  }
  bundler['lastSharedCss'] = newSharedCss
  bundler['lastRootCss'] = newRootCss
}

// --------------------------------------------------------------------------
// emitSplitStyles() : mode css='split', étape « 1.5 » de compile()
// (AVANT les composants, même précédent que mjs_core/coreHashedPath). Compile
// CHAQUE feuille de stylesheetsDir dans SON PROPRE fichier `mjs_style_<nom>-<hash>.js`
// (au lieu du `mjs_styles-<hash>.js` unique de bundleSharedStyles) — c'est ce qui
// permet à un module de n'importer QUE les feuilles qu'il déclare (`@css`), plutôt
// que de faire voyager tout stylesheetsDir avec chaque page.
//
// Duplique VOLONTAIREMENT la boucle de compilation par fichier de bundleSharedStyles()
// (même lecture, même compileCss, même cssTrapWarnings, même gabarit `µ.CSS[nom] = …`)
// plutôt que de factoriser : bundleSharedStyles() reste la seule responsable du mode
// 'bundle' (défaut), et doit rester une sortie BYTE-IDENTIQUE à ce qu'elle a toujours
// produit — un refactor partagé ferait courir un risque de régression sur ce contrat.
//
// Ne fait AUCUNE hypothèse sur `requestedSharedSheets` (rempli PAR les composants,
// compilés APRÈS cette étape) : compile toutes les feuilles PRÉSENTES sur disque, sans
// savoir encore lesquelles seront déclarées — c'est finalizeSplitStyles() (étape 2c,
// après les composants) qui décide lesquelles restent eager.
// --------------------------------------------------------------------------
export async function emitSplitStyles(bundler: Bundler): Promise<{ warnings: string[] }> {
  bundler.splitStyleHashedPaths = {}
  bundler.splitRootHashedPath = undefined
  bundler['lastSharedCss'] = new Map()
  bundler['lastRootCss'] = undefined
  if (!existsSync(bundler.stylesheetsDir)) return { warnings: [] }
  const files = readdirSync(bundler.stylesheetsDir)
    .filter(f => /\.(sass|scss|css)$/.test(f))
    .sort()
  if (files.length === 0) return { warnings: [] }
  const cssErrors: string[] = []
  const cssWarnings: string[] = []
  // CSS de chaque feuille : le registre des variables (computeVarRegistry) les lit, comme en mode 'bundle'
  const newSharedCss = new Map<string, string>()
  let newRootCss: string | undefined
  for (const file of files) {
    const path = join(bundler.stylesheetsDir, file)
    const baseName = file.replace(/\.(sass|scss|css)$/, '')
    const ext = file.match(/\.(sass|scss|css)$/)![1] as 'sass' | 'scss' | 'css'
    // même garde \x00 que bundleSharedStyles() — cf. son commentaire.
    // Même confinement RÉEL que bundleSharedStyles() (cf. assertRealUnder).
    bundler['assertRealUnder'](path, bundler.stylesheetsDir)
    const src = readFileSync(path, 'utf-8').replace(/\x00/g, '')
    let css: string
    try {
      css = await bundler['compileSharedSheet'](path, src, ext)
    } catch (e: any) {
      cssErrors.push(`${file} : ${e?.message ?? e}`)
      continue
    }
    if (css.trim() === '') continue
    if (baseName === 'mjs_root') {
      // mjs_root : toujours eager (adopté sur le document, aucun composant ne le
      // déclare) — son propre fichier, importé par le manifeste dans TOUS les modes
      // qui splittent (jamais en mode 'bundle', où il reste dans mjs_styles.js).
      const js = `import { µ } from '${bundler.coreHashedPath}';\n` +
                 `{\n` +
                 `  const _root = new CSSStyleSheet();\n` +
                 `  _root.replaceSync(${JSON.stringify(css)});\n` +
                 `  document.adoptedStyleSheets = [...document.adoptedStyleSheets, _root];\n` +
                 `  µ._mjs_rootStyleSheet = _root;\n` +
                 `}\n`
      const minified = await minifyJs(js, { force: bundler.shouldMinify(), filename: 'mjs_style_root.js', mangleCache: bundler.mangleCache, logLevel: bundler['prodLogLevel'](), dev: !bundler['isProd']() })
      bundler.splitRootHashedPath = bundler.writeHashed('mjs_style_root', '.js', minified.code)
      newRootCss = css
    } else {
      for (const w of cssTrapWarnings(css, bundler.lint)) cssWarnings.push(`[bundler] ${file} : ${w}`)
      // safeVar sert AUSSI de base de nom de fichier ici (contrairement à
      // bundleSharedStyles, où il ne sert qu'à l'identifiant JS local) : un nom de
      // feuille avec espace/accent produirait sinon un chemin fragile.
      // MÊME DÉSAMBIGUÏSATION QU'EN 'lazy' : `dark-theme` et `dark_theme` se
      // normalisent tous deux en `mjs_style_dark_theme`. Ici le CONTENU diffère bien (le
      // module embarque `µ.CSS['<nom>']`), donc les hachages diffèrent — mais `writeHashed`
      // passe par `cleanupOldHashes`, qui balaie le STEM : écrire la seconde SUPPRIMAIT le
      // fichier de la première, le composant importait une URL morte (404 → tout le graphe
      // de modules de la page tombe), et le build annonçait 0 erreur, 0 avertissement.
      // Dès que la normalisation a changé le nom, on suffixe une empreinte du nom D'ORIGINE :
      // deux noms distincts ne peuvent plus jamais partager un stem.
      const safeVar = baseName.replace(/[^a-zA-Z0-9]/g, '_')
      const stem    = bundler['splitStyleStem'](baseName)
      const keyLit = JSON.stringify(baseName)
      const js = `import { µ } from '${bundler.coreHashedPath}';\n` +
                 `µ.CSS = µ.CSS || {};\n` +
                 `if (!µ.CSS[${keyLit}]) {\n` +
                 `  const s_${safeVar} = new CSSStyleSheet();\n` +
                 `  s_${safeVar}.replaceSync(${JSON.stringify(css)});\n` +
                 `  µ.CSS[${keyLit}] = s_${safeVar};\n` +
                 `}\n`
      const minified = await minifyJs(js, { force: bundler.shouldMinify(), filename: `mjs_style_${baseName}.js`, mangleCache: bundler.mangleCache, logLevel: bundler['prodLogLevel'](), dev: !bundler['isProd']() })
      bundler.splitStyleHashedPaths[baseName] = bundler.writeHashed(stem, '.js', minified.code)
      newSharedCss.set(baseName, css)
    }
  }
  // baseline seulement : en 'split' et 'lazy', le suivi « css seul » de trackSharedCssDiff ne s'applique pas
  bundler['lastSharedCss'] = newSharedCss
  bundler['lastRootCss'] = newRootCss
  if (cssErrors.length > 0) {
    throw new Error(t('bundler.index.css-sass-erreurs', { erreurs: cssErrors.join('\n') }))
  }
  return { warnings: cssWarnings }
}

// --------------------------------------------------------------------------
// finalizeSplitStyles() : mode css='split', étape « 2c » (même
// position que bundleSharedStyles() en mode 'bundle') — APRÈS les composants, donc
// `requestedSharedSheets` (feuilles déclarées par au moins un `@css`) ET
// `viewRequestedSheets` (feuilles réclamées par au moins un `<@view css="…">` littéral,
// cf. extractViewCssNames) sont désormais complets. DEUX FILETS DE SÉCURITÉ distincts,
// chacun forçant eager pour une raison différente :
//   1. une feuille compilée par emitSplitStyles() qu'AUCUN module ne déclare resterait
//      invisible de tout le monde si elle n'était importée par personne.
//   2. une feuille DÉCLARÉE par un module (donc PAS orpheline) mais réclamée AUSSI par
//      un `<@view css="…">` d'un AUTRE module — la page qui charge cette vue peut très
//      bien ne jamais charger le module déclarant, et hériterait alors d'un `µ.CSS[nom]`
//      vide (cf. runtime/mjs_element.ts, `_mjs_applyLayout`, avertissement « Orphelin CSS
//      hérité »). Rien ne relie ces deux modules au build : seul le fait de forcer la
//      feuille eager referme ce trou.
// Les deux restent importées par le MANIFESTE, exactement comme en mode 'bundle'. Deux
// avertissements DISTINCTS (un par raison) : l'auteur doit comprendre pourquoi son gain
// n'est pas total, et pourquoi ajouter `@css` ne suffit pas toujours (raison 2).
// --------------------------------------------------------------------------
export function finalizeSplitStyles(bundler: Bundler): { count: number; warnings: string[] } {
  const known = Object.keys(bundler.splitStyleHashedPaths).sort()
  // raison 1 — personne ne la déclare (@css) : le filet historique.
  const undeclared = known.filter(name => !bundler.requestedSharedSheets.has(name))
  // raison 2 — déclarée par un module, mais un <@view css="…">
  // la réclame AUSSI (disjoint de `undeclared` par construction : un nom ne peut pas
  // être à la fois « personne ne le déclare » et « un module le déclare »).
  const viewOnly = known.filter(name => bundler.requestedSharedSheets.has(name) && bundler.viewRequestedSheets.has(name))
  bundler.splitEagerHashedPaths = [...undeclared, ...viewOnly].sort().map(name => bundler.splitStyleHashedPaths[name])
  const warnings: string[] = []
  if (undeclared.length > 0) {
    bundler['lintPush'](warnings, 'cssSplit', t('bundler.index.css-split-feuilles-eager', { feuilles: undeclared.join(', ') }))
  }
  if (viewOnly.length > 0) {
    bundler['lintPush'](warnings, 'cssSplit', t('bundler.index.css-split-feuilles-eager-view', { feuilles: viewOnly.join(', ') }))
  }
  const count = known.length + (bundler.splitRootHashedPath ? 1 : 0)
  return { count, warnings }
}

// --------------------------------------------------------------------------
// emitLazyStyles() : mode css='lazy', étape « 1.5 » de compile(),
// à la même place que emitSplitStyles(). Différence de fond avec 'split' : la
// feuille n'est PAS emballée dans un module JS importé statiquement par le
// composant — elle devient un VRAI fichier `.css` haché, que le runtime va
// chercher au montage du PREMIER composant qui la déclare (`@css`), et garde en
// cache PAR URL : dix composants qui déclarent la même feuille = UNE requête.
//
// Conséquence sur la compilation des composants : rien à injecter en tête de
// leur JS (contrairement à prependSplitCssImports), donc AUCUN sel de cache à
// ajouter — le composant ne connaît que le NOM de la feuille, la table des URLs
// vit au manifeste (`µ._cssLazy`, cf. writeManifest).
//
// `mjs_root` reste EAGER, comme en 'split' : personne ne le déclare, il est
// adopté sur le document, et il porte typiquement les variables de thème — le
// charger en différé ferait clignoter TOUTE la page, pas un composant.
// --------------------------------------------------------------------------
export async function emitLazyStyles(bundler: Bundler): Promise<{ warnings: string[] }> {
  bundler.lazyStyleUrls = {}
  bundler.splitRootHashedPath = undefined
  bundler['lastSharedCss'] = new Map()
  bundler['lastRootCss'] = undefined
  if (!existsSync(bundler.stylesheetsDir)) return { warnings: [] }
  const files = readdirSync(bundler.stylesheetsDir).filter(f => /\.(sass|scss|css)$/.test(f)).sort()
  if (files.length === 0) return { warnings: [] }
  const cssErrors: string[]   = []
  const cssWarnings: string[] = []
  // CSS de chaque feuille : le registre des variables (computeVarRegistry) les lit, comme en mode 'bundle'
  const newSharedCss = new Map<string, string>()
  let newRootCss: string | undefined
  for (const file of files) {
    const path     = join(bundler.stylesheetsDir, file)
    const baseName = file.replace(/\.(sass|scss|css)$/, '')
    const ext      = file.match(/\.(sass|scss|css)$/)![1] as 'sass' | 'scss' | 'css'
    // même garde \x00 que bundleSharedStyles()/emitSplitStyles()
    // Même confinement RÉEL que bundleSharedStyles() (cf. assertRealUnder).
    bundler['assertRealUnder'](path, bundler.stylesheetsDir)
    const src = readFileSync(path, 'utf-8').replace(/\x00/g, '')
    let css: string
    try {
      css = await bundler['compileSharedSheet'](path, src, ext)
    } catch (e: any) {
      cssErrors.push(`${file} : ${e?.message ?? e}`)
      continue
    }
    if (css.trim() === '') continue
    if (baseName === 'mjs_root') {
      const js = `import { µ } from '${bundler.coreHashedPath}';\n` +
                 `{\n` +
                 `  const _root = new CSSStyleSheet();\n` +
                 `  _root.replaceSync(${JSON.stringify(css)});\n` +
                 `  document.adoptedStyleSheets = [...document.adoptedStyleSheets, _root];\n` +
                 `  µ._mjs_rootStyleSheet = _root;\n` +
                 `}\n`
      const minified = await minifyJs(js, { force: bundler.shouldMinify(), filename: 'mjs_style_root.js', mangleCache: bundler.mangleCache, logLevel: bundler['prodLogLevel'](), dev: !bundler['isProd']() })
      bundler.splitRootHashedPath = bundler.writeHashed('mjs_style_root', '.js', minified.code)
      newRootCss = css
    } else {
      for (const w of cssTrapWarnings(css, bundler.lint)) cssWarnings.push(`[bundler] ${file} : ${w}`)
      // même normalisation de nom qu'en 'split' : un nom de feuille avec espace ou
      // accent produirait un chemin fragile. MAIS ici le fichier écrit est le CSS NU,
      // sans le nom dedans (en 'split' le module JS embarque `µ.CSS['<nom>']`, ce qui
      // écarte les hachages tout seul) : `dark-theme.sass` et `dark_theme.sass` au
      // contenu identique se réduisaient au MÊME fichier, donc à la même URL pour deux
      // noms — et le second nom n'obtenait jamais sa feuille, en silence (défaut mesuré).
      // Dès que la normalisation a changé le nom,
      // on désambiguïse par une empreinte du nom D'ORIGINE : deux noms distincts ne
      // peuvent plus jamais tomber sur le même chemin
      const stem = bundler['splitStyleStem'](baseName)
      bundler.lazyStyleUrls[baseName] = bundler.writeHashed(stem, '.css', css)
      newSharedCss.set(baseName, css)
    }
  }
  // baseline seulement, comme en 'split'
  bundler['lastSharedCss'] = newSharedCss
  bundler['lastRootCss'] = newRootCss
  if (cssErrors.length > 0) {
    throw new Error(t('bundler.index.css-sass-erreurs', { erreurs: cssErrors.join('\n') }))
  }
  return { warnings: cssWarnings }
}

// --------------------------------------------------------------------------
// finalizeLazyStyles() : étape « 2c », APRÈS les composants (donc
// `requestedSharedSheets` est complet). Contrairement à 'split', il n'y a AUCUN
// filet à poser :
//   1. une feuille que personne ne déclare n'est tout simplement JAMAIS chargée
//      (décision explicite : c'est le sens même du mode). Le fichier est écrit et
//      son URL reste au manifeste — un `<@view css="…">` peut la réclamer à
//      l'exécution — mais aucune requête ne part tant que personne ne la demande.
//      Une information de build la nomme, pour que ce ne soit pas une surprise.
//   2. le trou « orphelin CSS hérité » de 'split' (une feuille déclarée par un
//      module A et réclamée par un `<@view css>` d'un module B jamais chargé) se
//      referme tout seul ici : le runtime résout par NOM dans `µ._cssLazy`, il n'a
//      besoin d'aucun module déclarant pour trouver l'URL.
// --------------------------------------------------------------------------
export function finalizeLazyStyles(bundler: Bundler): { count: number; warnings: string[] } {
  const known      = Object.keys(bundler.lazyStyleUrls).sort()
  const undeclared = known.filter(name => !bundler.requestedSharedSheets.has(name) && !bundler.viewRequestedSheets.has(name))
  const warnings: string[] = []
  if (undeclared.length > 0) {
    bundler['lintPush'](warnings, 'cssSplit', t('bundler.index.css-lazy-feuilles-jamais-reclamees', { feuilles: undeclared.join(', ') }))
  }
  const count = known.length + (bundler.splitRootHashedPath ? 1 : 0)
  return { count, warnings }
}

// --------------------------------------------------------------------------
// prependSplitCssImports() : mode css='split' — ajoute en tête du JS
// d'un composant les `import '<chemin>';` des feuilles qu'il déclare (`@css`,
// cf. sharedCssNames). `emitSplitStyles()` tourne désormais en PHASE C (après les
// composants, le cœur connu) : `this.splitStyleHashedPaths` est encore VIDE ici (phase A).
// Chaque nom demandé reçoit donc le REPÈRE de son propre stem (`splitStyleStem`, résolu en
// chemin réel par l'émission topologique de la phase C) — jamais filtré sur une existence
// qu'on ne peut pas encore connaître : une feuille demandée mais absente/en échec reste un
// dep jamais résolu, détecté par le garde-fou de compile() (§ 3.13), même sort qu'avant
// (validateSharedSheets()/erreurs SASS déjà couvertes par ailleurs). Tri alphabétique :
// ordre déterministe, sans effet sur la cascade (l'ordre qui compte pour le navigateur est
// celui de `_mjs_sharedCss`, posé par le transpiler — inchangé par cette méthode).
// --------------------------------------------------------------------------
export function prependSplitCssImports(bundler: Bundler, code: string, sharedCssNames: string[]): string {
  if (sharedCssNames.length === 0) return code
  const imports = [...sharedCssNames].sort()
    .map(name => `import '${bundler.placeholderPath(bundler['splitStyleStem'](name), '.js')}';`)
    .join('\n')
  return imports === '' ? code : `${imports}\n${code}`
}
