// La lecture des réglages d'un effet qui trouve un commentaire (`settingsComment`) : le texte des réglages, tel que le parseur ou le fichier d'effets
// le rend, entre les parenthèses. Un `//` ou un `/*` y est un commentaire quand il commence un mot (début des réglages, après un blanc, une virgule,
// une parenthèse, un crochet, un guillemet) ou qu'il est collé à un mot simple (`12// note`, `red/* note */`). Ce n'est pas un commentaire dans une chaîne
// entre guillemets, collé à un chemin (`/img/*.png`, `/img//a.png`) ou à un protocole (`https://`), après `url(`, ni devant un nom d'hôte et son chemin
// (`//cdn.exemple.fr/a.png`) ; un `/*` jamais refermé n'en est pas un non plus. La barre oblique d'une division ou d'une couleur n'ouvre rien.

import assert from 'node:assert/strict'
import { settingsComment } from '../src/effects/settings-comment.js'

// [titre, réglages, [place du commentaire, commentaire tel que le message le cite]]
const TROUVES: Array<[string, string, [number, string]]> = [
  ['`//` après une virgule', 'max: 12, // la pente', [9, '// la pente']],
  ['`//` jusqu\'au bout de sa ligne seulement', 'max: 12, // la pente\n  scale: 1.1', [9, '// la pente']],
  ['`/* */` entre deux réglages', 'max: 12, /* la pente */ scale: 1.1', [9, '/* la pente */']],
  ['`//` collé à la virgule', 'max: 12,// la pente', [8, '// la pente']],
  ['`//` collé à une valeur', 'max: 12// la pente', [7, '// la pente']],
  ['`/* */` collé à une valeur', 'background: red/* le fond */, size: 2', [15, '/* le fond */']],
  ['`//` en tête', '// la pente\nmax: 12', [0, '// la pente']],
  ['`/*` en tête', '/* la pente */ max: 12', [0, '/* la pente */']],
  ['`//` seul', 'max: 12 //', [8, '//']],
  ['`/* */` dans une couleur', 'color: rgb(0 0 /* b */ 0)', [15, '/* b */']],
  ['`/* */` sur plusieurs lignes : le texte tient sur une ligne', 'a: 1, /* la\n   pente\tdouce */ c: 2', [6, '/* la pente douce */']],
  ['le premier de deux commentaires', 'a: 1, // un\n b: 2, /* deux */', [6, '// un']],
  ['après une chaîne refermée', '\'a\' // note', [4, '// note']],
  ['collé à une chaîne refermée', '\'a\'// note', [3, '// note']],
  ['une apostrophe dans le commentaire', 'a: 1 // l\'été', [5, '// l\'été']],
  ['un guillemet double dans le commentaire', 'a: 1 /* le "fond" */', [5, '/* le "fond" */']],
  ['après une adresse', 'image: https://exemple.fr/a.png // l\'adresse', [32, '// l\'adresse']],
  ['après un `url(//…)`', 'url(//cdn.exemple.fr/a.png) // x', [28, '// x']],
  ['après un joker de chemin', 'images: [/img/*.png, /* le dossier */ /b.png]', [21, '/* le dossier */']],
  ['une adresse sans protocole qui n\'a pas d\'hôte : `//b`', 'a: //b', [3, '//b']],
  ['une note sans espace derrière `//`', 'a: //la pente', [3, '//la pente']],
  ['une note qui a une barre mais pas de point : `//et/ou`', 'a: //et/ou', [3, '//et/ou']],
  ['la première de deux notes avant une adresse', 'a: 1 /* x */, image: https://exemple.fr/a.png', [5, '/* x */']],
  ['un commentaire long est raccourci à 40 caractères', '// ' + 'abcdefghij'.repeat(10), [0, ('// ' + 'abcdefghij'.repeat(10)).slice(0, 40) + '…']],
  ['un commentaire de 40 caractères n\'est pas raccourci', '// ' + 'a'.repeat(37), [0, '// ' + 'a'.repeat(37)]],
  ['un commentaire de 41 caractères l\'est', '// ' + 'a'.repeat(38), [0, '// ' + 'a'.repeat(37) + '…']],
  ['la coupe respecte les caractères de deux unités', '// ' + 'a'.repeat(36) + '😀bbbb', [0, '// ' + 'a'.repeat(36) + '😀…']]
]

// des réglages sans commentaire
const SANS: Array<[string, string]> = [
  ['rien', ''],
  ['des réglages simples', 'max: 12, scale: 1.1'],
  ['`//` dans une chaîne entre apostrophes', 'words: [\'// pas un commentaire\']'],
  ['`/*` dans une chaîne entre guillemets doubles', 'words: ["/* non plus */"]'],
  ['`//` dans un texte entre accents graves', 'text: `// non`'],
  ['une apostrophe échappée dans une chaîne', String.raw`words: ['it\'s // non']`],
  ['une chaîne jamais refermée avale la suite (le parseur la refuse avant)', 'words: l\'été // non'],
  ['une couleur à barre oblique', 'color: hsl(210 50% 20% / .4)'],
  ['une couleur à barre oblique, collée', 'color: rgb(0 0 0/50%)'],
  ['une division', 'origin: 50% / 10%'],
  ['une division sans espaces', 'ratio: 1/2'],
  ['une division dans calc()', 'color: rgb(calc(100% / 2) 0 0)'],
  ['un nom divisé par un autre', 'group: a / b'],
  ['une adresse `https://`', 'image: https://exemple.fr/a.png'],
  ['une adresse `http://`', 'image: http://exemple.fr/a.png'],
  ['une adresse `wss://`', 'server: wss://demo.mjs'],
  ['une adresse `file:///`', 'image: file:///a.png'],
  ['une adresse dans une liste', 'images: [https://exemple.fr/a.png, /b.png]'],
  ['un protocole collé : `a://b`', 'a://b'],
  ['`url(//…)`', 'background: url(//cdn.exemple.fr/a.png)'],
  ['`url( //…)` avec un blanc', 'background: url( //cdn.exemple.fr/a.png )'],
  ['`URL(//…)` en majuscules, hôte sans point', 'background: URL(//localhost/a.png)'],
  ['`url(//…)` dont l\'hôte n\'a ni point ni port', 'background: url(//cdn/a.png)'],
  ['`url(https://…)`', 'background: url(https://exemple.fr/a.png)'],
  ['une adresse sans protocole, seule', 'image: //cdn.exemple.fr/a.png'],
  ['une adresse sans protocole, dans une liste', 'images: [//cdn.exemple.fr/a.png, /b.png]'],
  ['une adresse sans protocole, collée à la virgule', 'images: [a.png,//cdn.exemple.fr/b.png]'],
  ['une adresse sans protocole, avec un port', 'image: //localhost:3000/a.png'],
  ['un chemin à joker', 'images: [/img/*.png]'],
  ['deux chemins à joker', 'images: [/img/*.png, /b/*.png]'],
  ['un joker de dossier, `*/` compris', 'images: [/img/*/a.png]'],
  ['un chemin à joker relatif', 'images: [img/*.png]'],
  ['deux barres dans un chemin', 'images: [/img//a.png]'],
  ['un `/*` jamais refermé n\'est pas un commentaire', 'images: [/*.png]'],
  ['une variable', 'max: $pente, scale: $echelle'],
  ['une variable de store et un champ', 'max: $$pente, scale: item.echelle'],
  ['une connexion', 'sock: @sock'],
  ['des étoiles et des barres sans rapport', 'a: 2 * 3, b: 4 / 5']
]

describe('settingsComment : le commentaire écrit dans les réglages d\'un effet', () => {
  describe('trouvé', () => {
    for (const [titre, reglages, [at, text]] of TROUVES) {
      it(titre, () => {
        assert.deepEqual(settingsComment(reglages), { at, text })
      })
    }
  })

  describe('pas un commentaire', () => {
    for (const [titre, reglages] of SANS) {
      it(titre, () => {
        assert.equal(settingsComment(reglages), null)
      })
    }
  })
})
