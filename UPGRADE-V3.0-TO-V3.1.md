# Passer de la 3.0 à la 3.1

Ce que la 3.1 change pour une application écrite en 3.0, et comment retrouver l'ancien comportement quand il le faut. Le détail de chaque changement est dans le [journal des modifications](CHANGELOG.md).

## Les ancres d'une page

Les ancres d'une même page n'ajoutent plus d'entrée à l'historique : chaque clic sur un lien `#section` remplace l'adresse de l'entrée courante, et « Précédent » ramène à la page d'avant au lieu de remonter d'ancre en ancre.

Si votre interface comptait sur ce retour (onglets ou panneaux pilotés par `:target` qu'on ferme avec « Précédent »), ajoutez la clé suivante à `mjs.config.json` : chaque ancre redevient une entrée de l'historique, comme avec le navigateur seul.

```json
{
  "anchorHistory": true
}
```

## Les écritures faites dans un appel de liste

Un `.forEach`, un `.map` ou un `.reduce` (et leurs voisins : `.filter`, `.some`, `.find`…) dont le rappel écrit l'état est regroupé comme une boucle `for` : les textes et les attributs de la page ne sont écrits qu'une fois, après l'appel. Dans le rappel lui-même, le DOM n'est donc pas encore à jour ; l'instruction qui suit l'appel lit le DOM final.

Si votre code lisait le DOM à l'intérieur du rappel, juste après une écriture, faites cette lecture après l'appel.

## Les modules du cœur, sans clé `runtime`

Sans clé `runtime` dans `mjs.config.json`, le cœur ne prend plus tous les modules : seulement ceux dont votre projet se sert, repérés dans le code compilé. Un projet qui a des vues servies par son serveur (bloc `render`, dossier `app/views`, `resources/views`, `templates` ou `views`) garde la navigation, le routeur, ajax, les modales, le coffre et le journal.

La construction écrit une ligne d'information quand des modules restent de côté. Si vos pages se servent d'un module que le code compilé ne montre pas (par exemple des liens interceptés par la navigation dans des pages HTML écrites hors de ces dossiers), écrivez la liste voulue, ou gardez tout :

```json
{
  "runtime": "all"
}
```

Un serveur temps réel qui parle à la page peut, lui aussi, demander un module que le code de la page ne montre pas. Un serveur MJS WS qui déclare un schéma (`app.schema`) encode ses messages en binaire, que la page déclare ce schéma ou non : le module `schema`, qui les décode, part donc avec `socket`. Si vous écrivez une liste `runtime`, gardez-y `"schema"` à côté de `"socket"` ; sans lui, la console de développement signale la première trame binaire ignorée. La ligne d'information donne la liste des modules gardés, prête à coller.

## Les composants pas encore chargés

Une balise de composant pas encore rendue est invisible mais garde sa place (elle était retirée de la mise en page) : la page ne saute plus à son arrivée. Seules les balises des composants de votre projet sont concernées : une balise d'une autre bibliothèque pas encore définie n'est plus cachée par MJS, et son contenu de repli se voit jusqu'à sa définition. Pour retrouver l'ancien comportement sur une telle balise :

```css
autre-lib:not(:defined) { visibility: hidden; }
```

Un import qui échoue sans réponse du serveur (connexion coupée, départ de la page) ne recharge plus la page : seule une réponse qui n'est pas un module (404, page HTML) la fait recharger.

## Les singletons importés lus dans une chaîne

Un singleton importé (`@import µ$$Boite`) lu par erreur en `$Boite`, `$$Boite` ou `§§Boite` dans l'interpolation d'une chaîne (`"#{$Boite.a}"`, interpolation imbriquée et `"""…"""` compris) arrête désormais la construction, comme hors d'une chaîne : écrivez `µ$$Boite`. Dans un `<script lang="js">` ou `"ts"`, `"#{…}"` n'est pas une interpolation et n'est pas touché.

## Les attributs calculés sur un composant

Un attribut global calculé sur la balise d'un composant (`id`, `class`, `title`, `role`, `hidden`, `tabindex`, `lang`, `dir`, `slot`) se pose désormais sur la balise, comme une valeur écrite en clair, et part aussi en prop : `<@@editor id={'ck-' + t.key}>` est trouvé par `<@@toolbar for>` et par `<label for>`. Un `class={…}` habille donc la balise, et un `hidden={…}` la cache. Un composant qui déclare une prop de ce nom (comparé sans la casse) la garde pour lui, sans attribut. Écrit en clair aussi, `hidden` cache désormais la balise d'un composant : retirez-le d'un composant que la page doit afficher. Si une feuille de style vise la balise d'un tel composant, vérifiez son rendu.

## Le jeton CSRF en mode JSON

Si votre serveur répond en JSON à la navigation et fait tourner le jeton CSRF à la connexion ou à la déconnexion, envoyez le nouveau jeton dans l'en-tête de réponse `X-CSRF-Token` : la page le reprend pour les envois suivants. Une réponse HTML n'a rien à changer.

## Les formulaires déclarés multipart

Un formulaire `enctype="multipart/form-data"` (ou envoyé par un bouton `formenctype`) part désormais en multipart, même sans fichier ; il partait en `x-www-form-urlencoded`. Un serveur qui lit les deux formats (Rails, Laravel…) n'a rien à changer ; si un point d'entrée n'accepte que l'encodage d'URL, faites-lui accepter aussi le multipart, ou retirez l'`enctype` du formulaire.

## MJS WS : les gardes des flux et le désabonnement

Une garde `canSubscribe` asynchrone a désormais un délai : 5 000 ms par défaut (`guardTimeout`). Passé ce délai, elle compte comme un refus : une demande dont la garde répond en 6 s est refusée à 5 s, et le « oui » qui arrive ensuite ne sert plus ; un abonné qui repasse une garde posée ou resserrée après coup, et qu'elle laisse attendre, perd le flux. En 3.0, ces connexions attendaient sans limite. Si votre garde est lente pour de bon, allongez son délai :

```js
app.stream('fil', { canSubscribe, guardTimeout: 10000 })
```

Tout refus d'un flux le nomme : `µ:error { message, code: 'stream-denied', stream }`. Côté client, `lastError.stream` dit lequel ; un flux refusé n'est plus redemandé à chaque reconnexion, `sock.stream(nom)` le redemande.

`sock.unstream(nom)` envoie `µ:unsub-stream { stream }`. Un serveur 3.0 ne le connaît pas et continue de pousser le flux ; la page 3.1 n'en livre plus rien. Un client écrit à la main qui reprend une session doit renvoyer ce désabonnement après le `welcome` et ignorer les trames du flux quitté.

## MJS-Server : redémarrage, minuteries et sauvegardes

- Après un redémarrage, le `seq` d'une partie restaurée repart de l'heure du serveur en millisecondes, multipliée par 2 000 (vers 3,6 × 10¹⁵ aujourd'hui, un entier exact jusqu'en 2112) : il ordonne les trames, ce n'est pas un compte. Ne vous en servez pas comme d'un numéro de coup.
- `app.stop()` attend une sauvegarde abandonnée qui pourrait encore aboutir, au plus le délai d'une écriture (30 secondes par défaut) : avec un stockage qui ne répond plus, l'arrêt peut durer jusqu'à ce délai de plus.
- Une minuterie de votre application qui ne change rien ne fait plus écrire la partie ; en mode action, une partie identique n'est pas réécrite. Un changement que MJS-Server ne voit pas seul (la suite d'une promesse que personne ne rend au serveur) s'annonce par `game.changed()`, qui remplace `game.to(game.phase)` employé pour forcer une diffusion.
- Un rappel réarmé sous son nom part une fois, tout de suite, au redémarrage.
- `hooks.onDestroy` n'est jamais appelé à l'arrêt, et aucune minuterie de partie ne part pendant l'arrêt.
- Sans `turns.timeout`, la minuterie de tour reste de 30 secondes ; `turns.timeout: null` la retire.
- Une écriture restée sans réponse et une suppression refusée sont retentées (après 1 s, puis le double, une minute au plus).

## MJS-Server : instantanés lockstep

Avec `lockstepJournal.snapshotEvery`, une page 3.0 encore ouverte suspend les coupes du journal jusqu'à son départ (elle ne sait pas lire un instantané) ; arrivée après une coupe, elle reçoit une erreur qui invite à recharger la page : rien à changer dans votre code. Un client écrit à la main doit envoyer `snapshots: true` dans `µgame:play` et `µgame:resync`, et savoir repartir d'un instantané. Pour revenir à un serveur 3.0 : une sauvegarde 3.1 y perd son instantané et ne garde que le journal qui le suit ; terminez ces parties ou retirez leurs sauvegardes avant de revenir en arrière.
