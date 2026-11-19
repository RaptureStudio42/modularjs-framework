// cli/init — scaffold un projet ModularJS V2.
//
// Crée la structure standalone par défaut :
//   - mjs.config.json (à la racine)
//   - app/modularjs/ (sources)
//   - app/modularjs/styles/ (styles partagés)
//   - app/modularjs/hello.mjs (composant exemple)
//   - app/modularjs/examples/ (dossier d'exemples : hello-world.mjs + son README)
//   - AGENTS.md (le bloc MJS pour les assistants d'IA, cf. agents-md.ts — ajouté en fin d'un AGENTS.md déjà là)
//
// Universel : aucune dépendance à Rails/Sprockets ou autre framework. Le
// outputDir `public/modularjs/` est servi tel quel par n'importe quel serveur
// statique (nginx, Caddy, Express, Rails, ...).
//
// Skip si fichier/dossier existe déjà.

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { t } from '../messages/index.js'
import { syncAgentsMd } from './agents-md.js'

const DEFAULT_CONFIG = `{
  "sourceDir": "app/modularjs",
  "outputDir": "public/modularjs",
  "manifestPath": "public/modularjs/bundle.js",
  "stylesheetsDir": "app/modularjs/styles",
  "lang": "fr",
  "defaultScriptLang": "civet"
}
`

// Composant de démarrage — l'ORDRE des blocs est celui de la convention, décrit en
// long dans examples/README.md : script, HTML, theme, style.
const HELLO_MJS = `<script>
$count  = 0
$double = $count * 2
</script>

<button @click={$count++}>Clic — {$count} (×2 = {$double})</button>

<theme>
  $$brand: #3b82f6
</theme>

<style>
  :host
    display: inline-block
    padding: 8px 12px
    border-radius: 6px
    background: $$brand
    color: white
    font-family: ui-sans-serif, system-ui
    cursor: pointer
    user-select: none
  :host(:hover)
    filter: brightness(1.15)
</style>
`

// Exemple de référence — montre les CINQ blocs dans l'ordre canonique, et se
// documente lui-même : la page qu'il affiche EST la liste des blocs, dans l'ordre.
// noms de blocs SANS chevrons, volontairement : une chaîne qui ressemble à une balise
// de section dans le source d'une section est un piège classique du lexer
const EXAMPLE_MJS = `<script module>
export BLOCK_ORDER := [
  { tag: 'script module', role: 'partagé par toutes les instances du composant' },
  { tag: 'script',        role: 'la logique de cette instance' },
  { tag: 'html',          role: 'ce que la page affiche : tout ce qui vit hors des blocs' },
  { tag: 'theme',         role: 'les variables de thème du composant' },
  { tag: 'style',         role: 'le style, isolé, en SASS indenté' },
]
</script>

<script>
$name     = 'monde'
$greeting = "Bonjour, #{$name} !"
$blocks   = BLOCK_ORDER
</script>

<section class="hello">
  <h1>{$greeting}</h1>
  <label class="field">Votre prénom <input value=!{$name} placeholder="monde"></label>
  <p class="lead">Un module ModularJS range toujours ses blocs dans cet ordre :</p>
  <ol class="blocks">
    {for block in $blocks}
      <li><code>{block.tag}</code> — <span>{block.role}</span></li>
    {end}
  </ol>
</section>

<theme>
  $$accent: #6ea8fe
  $$ink:    #e6edf3
  $$paper:  #0d1117
</theme>

<style>
  :host
    display: block
    max-width: 46rem
    margin: 2rem auto
    font-family: ui-sans-serif, system-ui
    color: $$ink
  .hello
    padding: 1.75rem 2rem
    border-radius: 14px
    background: $$paper
    border: 1px solid rgba(110, 168, 254, .25)
  h1
    margin: 0 0 1rem
    font-size: 1.9rem
    color: $$accent
  .field
    display: flex
    gap: .6rem
    align-items: center
    margin-bottom: 1.5rem
  .field input
    flex: 1
    padding: .45rem .7rem
    border-radius: 8px
    border: 1px solid rgba(230, 237, 243, .2)
    background: rgba(230, 237, 243, .06)
    color: inherit
    font: inherit
  .lead
    margin: 0 0 .6rem
    opacity: .75
  .blocks
    margin: 0
    padding-left: 1.4rem
    line-height: 1.9
  .blocks code
    color: $$accent
    margin-right: .5rem
  .blocks span
    opacity: .75
</style>
`

const EXAMPLE_README = `# Exemples

## L'ordre des blocs dans un module

Un fichier \`.mjs\` est UN composant. Ses blocs se rangent toujours dans le même ordre —
\`hello-world.mjs\`, à côté, les montre tous les cinq, et affiche la liste à l'écran :

| ordre | bloc | rôle |
| --- | --- | --- |
| 1 | \`<script module>\` | partagé par toutes les instances du composant (au plus un par fichier) |
| 2 | \`<script>\` | la logique de cette instance (au plus un par fichier) |
| 3 | le HTML | ce que la page affiche : tout ce qui n'est dans aucun bloc |
| 4 | \`<theme>\` | les variables de thème du composant |
| 5 | \`<style>\` | le style, isolé, en SASS indenté (au plus un par fichier) |

Les cinq sont facultatifs : un composant qui n'affiche rien n'a pas de HTML, un composant
sans style n'a pas de \`<style>\`. Mais quand ils sont là, ils sont dans cet ordre.

Deux blocs supplémentaires vivent au même niveau, sans place fixe dans cette liste :
\`<style name="…">\` déclare un variant de style chargé à la demande (elle se pose à
côté du \`<style>\`), et un fichier \`*.theme.mjs\` déclare un thème pour toute l'application.

## Le style ne s'écrit jamais dans le HTML

Pas d'attribut \`style="…"\`, même calculé : tout passe par un sélecteur du bloc \`<style>\`.
Pour du style qui dépend de l'état, on écrit \`:style.prop={expr}\`, une variable
\`--maVar={expr}\` lue par \`var(--maVar)\`, ou une classe qu'on bascule.

## Lancer l'exemple

\`\`\`
npx --no -- mjs dev
\`\`\`

puis, dans votre page : \`<mjs-hello-world></mjs-hello-world>\`.
`

export function runInit(root: string): void {
  const dirs = [
    'app/modularjs',
    'app/modularjs/styles',
    'app/modularjs/examples',
    'public/modularjs',
  ]
  let created = 0
  let skipped = 0

  for (const d of dirs) {
    const path = join(root, d)
    if (existsSync(path)) {
      console.log(t('cli.init.dir-exists', { d }))
      skipped++
    } else {
      mkdirSync(path, { recursive: true })
      console.log(t('cli.init.dir-created', { d }))
      created++
    }
  }

  // mjs.config.json
  const configPath = join(root, 'mjs.config.json')
  if (existsSync(configPath)) {
    console.log(t('cli.init.config-exists'))
    skipped++
  } else {
    writeFileSync(configPath, DEFAULT_CONFIG)
    console.log(t('cli.init.config-created'))
    created++
  }

  // hello.mjs
  const helloPath = join(root, 'app/modularjs/hello.mjs')
  if (existsSync(helloPath)) {
    console.log(t('cli.init.hello-exists'))
    skipped++
  } else {
    writeFileSync(helloPath, HELLO_MJS)
    console.log(t('cli.init.hello-created'))
    created++
  }

  // dossier d'exemples — le composant de référence (les 5 blocs dans l'ordre) et le
  // README qui énonce la convention. Même politique que le reste : jamais d'écrasement
  for (const [rel, content] of [['app/modularjs/examples/hello-world.mjs', EXAMPLE_MJS], ['app/modularjs/examples/README.md', EXAMPLE_README]] as const) {
    const path = join(root, rel)
    if (existsSync(path)) {
      console.log(t('cli.init.file-exists', { f: rel }))
      skipped++
    } else {
      writeFileSync(path, content)
      console.log(t('cli.init.file-created', { f: rel }))
      created++
    }
  }

  // AGENTS.md : créé avec le bloc MJS, ou le bloc ajouté (mis à jour) dans celui qui est déjà là, sans toucher au reste
  if (syncAgentsMd(root, { create: true }) === 'created') created++

  console.log(``)
  console.log(t('cli.init.resume', { created, ignored: skipped }))
  console.log(``)
  console.log(t('cli.init.to-start'))
  // `./bin/mjs` n'existe QUE dans le
  // dépôt source de ModularJS lui-même : un projet consommateur installe le
  // package (bin `mjs` exposé via package.json → node_modules/.bin/mjs) et
  // l'invoque via `npx --no -- mjs`, jamais un chemin relatif littéral `./bin/mjs`
  // qui n'existe nulle part dans le projet scaffoldé (README officiel :
  // `npx --no -- mjs build`/`npx --no -- mjs dev`). `--no` : hors d'un projet où le
  // paquet est installé, npx n'installe pas à sa place un paquet nommé « mjs » qui
  // n'est pas ModularJS ; `--` : les options écrites après restent à `mjs`
  // l'installation d'abord : tant que le paquet n'est pas installé dans le projet, `npx --no -- mjs dev` répond par le refus de npm
  // (« npx canceled due to missing packages… »). Aucun commentaire en bout de ligne : zsh le prendrait pour des arguments
  console.log(`  npm install modularjs-framework`)
  console.log(`  npx --no -- mjs dev`)
  console.log(`  → http://127.0.0.1:3939`)
  console.log(``)
  console.log(t('cli.init.hmr-html'))
  console.log(`  <script src="http://127.0.0.1:3939/__mjs_hmr/client.js"></script>`)
  // l'ancien chemin
  // `/assets/javascripts/bundle_modular.js` est une convention Rails/
  // Sprockets d'une version antérieure, sans rapport avec le
  // `mjs.config.json` fraîchement scaffoldé juste au-dessus (`outputDir:
  // "public/modularjs"` + `manifestPath: "public/modularjs/bundle.js"` →
  // servi à la racine `/modularjs/bundle.js`, cf. `deriveUrlPrefix`). Un dev
  // qui copie-colle cette ligne obtient un 404 immédiat.
  console.log(`  <script type="module" src="/modularjs/bundle.js"></script>`)
  console.log(`  <mjs-hello></mjs-hello>`)
}
