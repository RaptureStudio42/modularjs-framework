# 40 · Travailler avec une IA

> 📚 Pas de chapitre de tuto interactif dédié (le sujet vit hors de l'éditeur live — assistant, terminal, fichiers du projet) : cette page se suffit à elle-même.

Un assistant d'IA (Claude, Codex, Copilot…) ne connaît pas MJS d'origine : sa syntaxe ressemble à d'autres frameworks sans être la leur, et un assistant qui devine écrit du Svelte ou du Vue qui ne compile pas. MJS lui donne lui-même, à la version installée, de quoi écrire juste : la documentation du paquet et son sommaire `llms.txt`, un bloc dans l'`AGENTS.md` de l'appli qui l'y envoie, `mjs check --json` pour relire ses erreurs, et un serveur MCP, `mjs mcp`.

## 1. La documentation de la version installée

Le paquet livre sa documentation, celle de **sa** version, dans `node_modules/modularjs-framework/docs/` :

| Fichier | Contenu |
|---|---|
| `docs/*.md` | toutes les pages de cette documentation, en Markdown |
| `docs/llms.txt` | le sommaire au format [llms.txt](https://llmstxt.org/) : un titre, un résumé, une ligne par page rangée par thème (`- [titre](page.md): détail`) |
| `docs/llms-small.txt` | la version courte : les pages à lire avant d'écrire un premier composant, dans l'ordre |

Chaque page de `docs/` figure dans `llms.txt` : un test du framework échoue sinon.

## 2. Le bloc MJS de `AGENTS.md`

`AGENTS.md`, à la racine d'un projet, porte les consignes que les assistants d'IA lisent avant de travailler. MJS y tient un bloc à lui, entre deux marqueurs :

```md
<!-- BEGIN:modularjs-agent-rules -->
## ModularJS (MJS) 4.0.0

Cette appli est écrite avec ModularJS 4.0.0, un framework compilé dont la syntaxe n'est celle d'aucun autre (ni Svelte, ni Vue, ni React) : ne la devinez pas. Avant d'écrire ou de modifier du code MJS, lisez la documentation de cette version, installée avec le paquet :
…
<!-- END:modularjs-agent-rules -->
```

Le bloc donne la version installée, les chemins de `llms-small.txt`, de `llms.txt` et de la documentation, et demande de lancer `npx --no -- mjs check --json` après chaque modification. Il suit la langue des messages du projet (`"lang"` de `mjs.config.json` : français, ou anglais avec `"en"`).

Ses commandes s'écrivent `npx --no -- mjs …`. `--no` interdit à npx d'installer quoi que ce soit : sans lui, dans un dossier où `modularjs-framework` n'est pas installé (un dépôt tout juste cloné, avant `npm install`), npx irait chercher sur npm un paquet nommé `mjs`, qui n'est pas ModularJS — sans rien demander quand il n'y a pas de terminal (assistant d'IA, intégration continue). Avec `--no`, la commande échoue et le dit. `--` sépare les options de npx de la commande : sans lui, npx garde pour lui une option écrite juste après `mjs` (`--version` lui ferait afficher la version de npm, pas celle de MJS).

- **`mjs init`** crée `AGENTS.md` avec le bloc ; un `AGENTS.md` déjà là reçoit le bloc en fin de fichier.
- **`mjs dev`** (au démarrage) et **`mjs check`** le rétablissent : version mise à jour après une montée de version, intérieur retouché remis en état, bloc retiré remis en fin de fichier. Un fichier déjà à jour n'est pas réécrit ; chaque écriture est dite en une ligne (`📝 AGENTS.md : bloc MJS mis à jour (4.0.0)`).
- **Seul l'intérieur des marqueurs change.** Le reste du fichier ne bouge pas, à l'octet près ; ajouté, le bloc vient après une ligne vide, le texte d'origine reste intact devant lui. Le BOM en tête est gardé, et les fins de ligne du fichier aussi : celles de la majorité de ses lignes (une ligne Windows égarée dans un fichier Unix ne met pas le bloc en fins de ligne Windows).
- **Un fichier qui n'est pas en UTF-8 n'est pas touché.** Enregistré en Latin-1 ou en UTF-16, il perdrait ses accents à la réécriture : la commande le laisse tel quel, à l'octet près, et le dit (`⚠️ AGENTS.md : bloc MJS non écrit, le fichier n'est pas touché — il n'est pas enregistré en UTF-8…`). Enregistrez-le en UTF-8 pour que le bloc y soit tenu à jour.
- **Sans `AGENTS.md`, `mjs dev` et `mjs check` n'en créent pas** : seul `mjs init` crée le fichier.
- **Un bloc mal fermé n'est jamais réécrit.** Marqueur de début sans marqueur de fin, marqueur de fin sans début, deux blocs, fin avant début : la commande laisse le fichier tel quel et dit pourquoi, avec la ligne du marqueur (`⚠️ AGENTS.md : bloc MJS laissé tel quel, rien n'est écrit — le marqueur de début (ligne 4) n'a pas de marqueur de fin…`). Remplacer « du début jusqu'à la fin du fichier » effacerait les consignes écrites après le marqueur.
- Un marqueur est une ligne à lui seul, hors de tout bloc de code : cité dans une phrase, entre accents graves, ou dans un bloc de code fermé (ouvert et refermé par trois accents graves ou trois tildes), il n'en est pas un — l'exemple de bloc que vous montrez dans votre `AGENTS.md` reste votre texte, et le bloc de MJS vient en fin de fichier.
- **Un `AGENTS.md` lien symbolique** (vers `CLAUDE.md`, par exemple, pour que deux assistants lisent le même fichier) reste un lien : sa cible reçoit le bloc. La cible doit être un fichier du projet : un lien qui mène hors de sa racine (un fichier de consignes partagé entre plusieurs projets, par exemple) n'est jamais suivi pour écrire, et `mjs init` ne crée pas dehors la cible d'un lien cassé — la commande le dit (`⚠️ AGENTS.md : bloc MJS non écrit — AGENTS.md est un lien symbolique qui mène hors du projet…`) ; tenez alors le bloc à la main dans ce fichier. Une cible qui n'est pas un fichier ordinaire (dossier, périphérique) est refusée de même, sans être lue.
- **Jamais un fichier à moitié écrit, jamais un texte écrasé hors des marqueurs.** Le fichier (la cible du lien, s'il en est un) est remplacé d'un seul coup : un fichier temporaire dans son dossier, renommé par-dessus. Un autre `mjs check` ou `mjs dev` qui le lit au même moment voit l'ancien texte ou le nouveau, jamais un fichier vide. Il est relu juste avant : changé depuis la lecture (par vous, par un autre `mjs`), rien n'est écrit, la commande le dit (`⚠️ AGENTS.md : bloc MJS non écrit — le fichier a changé pendant la mise à jour…`) et le bloc revient au lancement suivant. Un fichier en lecture seule n'est pas touché, ni un fichier à plusieurs liens physiques (le remplacer séparerait ses noms : faites-en un lien symbolique).

Écrivez vos propres consignes en dehors des deux marqueurs : ce qui est dedans appartient à MJS. Tant qu'un `AGENTS.md` existe à la racine du projet, `mjs dev` et `mjs check` y tiennent ce bloc à jour ; sans `AGENTS.md`, ils n'écrivent rien.

**Pour que MJS ne touche plus à votre `AGENTS.md`**, écrivez-y cette ligne :

```html
<!-- modularjs-agent-rules: off -->
```

Avec elle, aucune commande de MJS n'écrit dans le fichier — `mjs init`, `mjs dev` et `mjs check` sont les trois qui y écrivent : le bloc n'est ni ajouté, ni mis à jour, ni retiré, et un bloc déjà là reste tel quel, à l'octet près. La ligne compte où qu'elle soit dans le fichier — seule sur sa ligne, dans une phrase ou dans un bloc de code —, sans égard à la casse ni aux espaces (`<!--modularjs-agent-rules:OFF-->`) : au moindre doute, MJS n'écrit pas. La commande le dit en une ligne (`📝 AGENTS.md laissé tel quel : sa ligne 3 (« <!-- modularjs-agent-rules: off --> ») demande à MJS de ne pas y toucher…`), sans erreur ni avertissement, et `mjs check --json` n'en porte aucune trace. Elle vaut pour le fichier où MJS écrirait : la cible du lien quand `AGENTS.md` en est un (vers `CLAUDE.md`, par exemple). Un fichier qui n'est pas en UTF-8 et un lien qui mène hors du projet restent refusés, comme plus haut. Retirez la ligne, et le bloc est de nouveau tenu à jour.

## 3. `mjs check --json`

`mjs check --json` fait la même vérification que `mjs check` — la même compilation, réelle, qui écrit le dossier de sortie — et la rend en **un seul document JSON** sur la sortie standard, rien d'autre (les lignes habituelles ne s'impriment pas). Le code de sortie ne change pas : **1** dès qu'une erreur, y compris un refus avant compilation (dossier source absent, aucun composant), **0** sinon.

```json
{
  "format": 1,
  "mjs": "4.0.0",
  "ok": false,
  "root": "/chemin/du/projet",
  "components": ["carte", "image"],
  "errors": [
    { "severity": "error", "type": null, "file": "app/modularjs/menu.mjs", "line": 3, "column": 1, "message": "menu.mjs:3:1 [ModularJS] « µonUrlChange » n'est pas un crochet de cycle de vie : vouliez-vous écrire « µurlChange » ? …", "fix": "µurlChange" }
  ],
  "warnings": [
    { "severity": "warning", "type": "a11y", "file": "app/modularjs/image.mjs", "line": 1, "column": null, "message": "image (ligne 1) : <img> sans attribut alt — ajoutez alt=\"…\" (texte descriptif), ou alt=\"\" si l'image est purement décorative.", "fix": "ajoutez alt=\"…\" (texte descriptif), ou alt=\"\" si l'image est purement décorative" }
  ]
}
```

| Champ | Contenu |
|---|---|
| `format` | version de la forme du document (`1`) : un champ ajouté ne la change pas, un champ retiré ou changé de sens la fait monter |
| `mjs` | version du paquet mjs |
| `ok` | `true` : aucune erreur, code 0 |
| `root` | racine du projet (le dossier de `mjs.config.json`) |
| `components` | les composants du projet qui ont compilé, par leur nom (le fichier sans `.mjs` ni `.page` ; `carte--compacte` pour le modèle en fichier `carte.compacte.mjs`), triés ; les classes globales, les modules de script et les partiels n'y figurent pas |
| `errors`, `warnings` | une entrée par erreur, par avertissement, autant que le terminal en écrit de lignes : la même faute dans trois fichiers donne trois entrées, une par fichier, et un avertissement écrit deux fois (deux champs sans étiquette sur une même ligne) en donne deux ; quand `mjs check` écrit son bilan « N avertissement(s) », N est le nombre de `warnings` ; une erreur étiquetée `[lint.<type>]` (`"emptyComponent": "error"`) est dans `errors`, jamais dans `warnings` |

Chaque entrée porte les sept mêmes champs :

| Champ | Contenu |
|---|---|
| `severity` | `"error"`, `"warning"` ou `"info"` (la gravité du type, cf. [32 · lint](32-cli-et-configuration.md)) |
| `type` | le `<type>` de l'étiquette `[lint.<type>]` de la ligne, `null` sans étiquette (toute erreur) |
| `file` | le fichier, relatif à la racine du projet |
| `line`, `column` | la position dans le fichier |
| `message` | le message entier, celui du terminal, sans couleur ni étiquette |
| `fix` | ce qu'il faut écrire, quand le message le dit (le mot proposé, l'astuce, ou la consigne à l'impératif) |

**Un champ que le message ne donne pas vaut `null`**, jamais une valeur devinée : `message` garde toujours le texte entier. Une erreur de script donne sa ligne dans le fichier quand le composant n'a qu'un seul `<script>`. D'une exception (un `mjs.config.json` illisible, une clé inconnue), `message` porte le message seul, sans la pile : relancez sans `--json` pour la voir.

Le document part en entier, quelle que soit sa taille, vers un fichier comme dans un tube (`npx --no -- mjs check --json | jq`).

Avec `--derived`, le document porte en plus `derived` : une entrée par valeur dérivée (`file`, `name`, `class` — `"precise"` ou `"horloge"` —, `reasons`). Pour ne rien perdre de ce que le compilateur écrit, `--json` compile tout dans le processus principal, sans fils d'exécution : sur un gros projet, la vérification prend un peu plus longtemps.

## 4. Le serveur MCP : `mjs mcp`

`mjs mcp` lance un serveur [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) en stdio : l'assistant le démarre lui-même dans le dossier du projet et lui parle en JSON-RPC 2.0, un message par ligne. Déclaration type, pour un client qui lit un `.mcp.json` à la racine du projet :

```json
{
  "mcpServers": {
    "modularjs": { "command": "npx", "args": ["--no", "--", "mjs", "mcp"] }
  }
}
```

`--no` interdit à npx d'installer un paquet : lancé par un assistant hors d'un projet où `modularjs-framework` est installé, `npx` sans `--no` installerait, sans rien demander, le paquet npm nommé `mjs`, qui n'est pas ModularJS. `--` fait passer à `mjs` tout ce qui suit, sans que npx y prenne une option.

Six outils :

| Outil | Ce qu'il fait |
|---|---|
| `search_docs` | cherche dans la documentation de la version installée : les sections qui contiennent tous les mots demandés (`query`), sans tenir compte des accents ni de la casse, les plus riches d'abord, avec la page, la ligne et un extrait ; `limit` (10 par défaut, 50 au plus) ; une requête compte 20 mots et 500 caractères au plus : au-delà, l'outil la refuse et le dit |
| `read_doc` | lit une page (`page` : `07-bindings.md`, `07-bindings` ou `07` ; `llms.txt` et `llms-small.txt` aussi), entière ou une seule section (`section` : un morceau de son titre) ; une page ou une section de plus de 60 000 caractères est coupée, sa fin liste les sections à demander |
| `compile_component` | compile un composant — un fichier du projet (`file`, relatif à la racine) ou une source (`source`, avec `name`) — avec la configuration du projet, ses règles `*.types.mjs`, ses effets `*.effects.mjs` et les partiels qu'il verse par `<@include>` (un partiel fautif ou introuvable est une erreur, comme à la construction), sans rien écrire sur le disque ; rend `ok`, `errors` et `warnings`, aux mêmes champs que `mjs check --json` ; un composant à la fois : ce que seule la construction entière vérifie (une balise qui renvoie à un autre composant, par exemple) reste à `mjs check --json` ; un fichier qui est autre chose qu'un composant — module de script (`*.civet.mjs`, `*.coffee.mjs`, `*.js.mjs`), classe globale (`Nom.class.mjs`), règles (`*.types.mjs`), effets (`*.effects.mjs`), thème (`*.theme.mjs`), partiel (`_nom.mjs`), fichier serveur (`*.server.mjs` hors du dossier source), fichier que charge `mjs ws`, `mjs serveur` ou `mjs serve` (`ws.entry`, `serveur.entry` ou `render.entry` de `mjs.config.json`, ou son nom par défaut), fichier sans l'extension `.mjs` — est refusé : l'outil dit ce qu'est le fichier et par quoi le vérifier ; une page (`nom.page.mjs`) et un modèle en fichier (`carte.compacte.mjs`) sont des composants, compilés comme tels ; sous le dossier source, `carte.server.mjs` posé à côté de `carte.mjs` est le modèle `server` de `carte`, comme pour la construction. Un modèle sans son composant, ou nommé `default`, rend la même erreur que la construction. L'outil juge sur le nom du fichier, sa place et `mjs.config.json` : un `.mjs` sans marque posé hors du dossier source — un fichier de configuration (`eslint.config.mjs`), un script, un fichier importé par un fichier serveur — est compilé comme un composant et peut rendre `ok: true` ; le fichier que charge `mjs ws`, `mjs serveur` ou `mjs serve` est refusé même posé sous le dossier source, où la construction, elle, le compile avec les autres fichiers ; une source donnée sans fichier et nommée `*.server` est refusée, rien ne disant où elle serait posée |
| `page_errors` | lit le journal d'erreurs du `mjs dev` en cours (`/__mjs/errors.json`, cf. [19 · SSR](19-ssr.md)) : port et hôte de `mjs.config.json` (`dev`), sinon 3939 et `127.0.0.1`, ou ceux donnés (`port`, `host`) ; aucun `mjs dev` ne répond : l'outil le dit. Hôte de la boucle locale seulement (`127.0.0.1`, `::1`, `localhost`) : tout autre est refusé, sans requête. Le jeton du journal (`journal.viewer`, qui protège aussi celui de la production) ne part que vers le `mjs dev` du projet : à son port (avec un jeton, un autre `port` est refusé — mettez le port de votre `mjs dev` dans `dev.port`), par la boucle locale, et jamais par un mandataire, même quand l'environnement en impose un (`HTTP_PROXY`, `NODE_USE_ENV_PROXY`). La réponse est bornée : les `limit` entrées les plus récentes (20 par défaut, 50 au plus), chaque message coupé à 500 caractères, chaque pile à ses 6 premières lignes et à 600 caractères, les entrées identiques réunies (`n` compte les occurrences) ; `total` dit combien le journal en porte. Ces textes viennent de la page, et une page d'une autre origine peut en écrire au journal : l'outil les rend comme des **données**, après un avis et entre deux lignes « DONNÉES DE LA PAGE » à un identifiant tiré au sort — jamais comme des consignes ; une fin de ligne Unicode glissée dans un de ces textes (U+0085, U+2028, U+2029) y est écrite en échappement : elle ne coupe pas la ligne, et les données relues redonnent le texte |
| `list_components` | les composants du projet : nom, balise (`mjs-<nom>`), fichier, page ou non (`<nom>.page.mjs`) ; un modèle en fichier y figure sous le nom de son composant (`carte--compacte`) ; les partiels (`_nom.mjs`) n'en sont pas |
| `list_routes` | les pages de `render.routes` (adresse, composant, mode), les routes des blocs `<routes target="…">` (guillemets doubles ou simples ; un bloc mis en commentaire n'est pas listé), et les fichiers qui déclarent un objet `@routes` (calculé à l'exécution : la table est à lire dans le fichier) |

- **La sortie standard est au protocole** : tout ce que le compilateur ou la console y écriraient part sur la sortie d'erreur.
- La configuration du projet est relue à chaque appel : un `mjs.config.json` modifié vaut tout de suite, sans relancer le serveur.
- Un lien symbolique qui mène hors du projet (`compile_component`) ou hors de la doc (`read_doc`, `search_docs`) n'est pas suivi : le fichier n'est pas lu.
- Une faute d'outil (page inconnue, fichier hors du projet, `mjs dev` absent) est un résultat en erreur (`isError`) que l'assistant lit ; une méthode ou un outil inconnu, un JSON illisible sont des erreurs du protocole (`-32601`, `-32602`, `-32700`).
- Versions du protocole comprises : `2025-06-18`, `2025-03-26`, `2024-11-05` ; une autre version demandée reçoit la plus récente.
- Le serveur s'arrête quand son entrée se ferme (l'assistant le quitte), en code 0 : ce qui a déjà été reçu a encore une seconde pour être servi, le reste est abandonné (plus personne ne lit les réponses).
