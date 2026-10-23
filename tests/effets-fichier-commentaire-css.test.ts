// Les lignes de CSS d'un effet à soi (fichier `*.effects.mjs`, `*halo(color: #0ff, size: 12px) =` puis ses déclarations) : un `//` écrit en
// fin de ligne est un commentaire, retiré comme le fait un bloc `<style>` ; le navigateur ne le voyait pas ainsi et jetait la déclaration
// entière, sans un mot, si bien que l'effet ne se voyait pas. Ce qui n'est pas un commentaire reste tel quel : le `//` d'un texte entre
// guillemets, d'`url(…)` ou d'une adresse à protocole, et un `/* … */`, qui est du CSS. Les cas du navigateur sont dans
// effets-fichier-commentaire-css-browser.test.ts.

import assert from 'node:assert/strict'
import { parseEffectsBlock } from '../src/effects/project.js'

const FICHIER = 'mes.effects.mjs'

// l'effet `halo` écrit avec ces lignes de CSS ; rend ses déclarations
const lire = (lignes: string[]): Array<[string, string]> => {
  const bloc = parseEffectsBlock(['*halo(color: #0ff, size: 12px) =', ...lignes.map(l => '  ' + l)].join('\n'), 1, FICHIER)
  return bloc.halo.decls!
}

// le message de la faute que cette lecture lève
const refus = (lignes: string[]): string => {
  try {
    lire(lignes)
  }
  catch (e) {
    return String((e as Error).message)
  }
  return assert.fail('la lecture aurait dû être refusée')
}

describe('une ligne de CSS d\'un effet à soi : le commentaire `//` est retiré', () => {
  describe('les déclarations lues', () => {
    // [titre, lignes écrites, déclarations lues]
    const CAS: Array<[string, string[], Array<[string, string]>]> = [
      ['un `//` en fin de ligne', ['box-shadow: 0 0 $size $color // le halo'], [['box-shadow', '0 0 $size $color']]],
      ['un `//` collé à la variable qui le précède', ['box-shadow: 0 0 $size $color// le halo'], [['box-shadow', '0 0 $size $color']]],
      ['un `//` sans texte', ['box-shadow: 0 0 $size $color //'], [['box-shadow', '0 0 $size $color']]],
      ['un `//` suivi de deux fois ce signe', ['box-shadow: 0 0 $size $color //// le halo // encore'], [['box-shadow', '0 0 $size $color']]],
      ['une ligne entière en commentaire, entre deux déclarations', ['box-shadow: 0 0 $size $color', '// transition: none', 'transition: box-shadow 300ms'], [['box-shadow', '0 0 $size $color'], ['transition', 'box-shadow 300ms']]],
      ['une ligne entière en commentaire, en tête du corps', ['// la lueur', 'box-shadow: 0 0 $size $color'], [['box-shadow', '0 0 $size $color']]],
      ['une ligne entière en commentaire, moins en retrait que les déclarations', ['  box-shadow: 0 0 $size $color', '// la suite', '  transition: box-shadow 300ms'], [['box-shadow', '0 0 $size $color'], ['transition', 'box-shadow 300ms']]],
      ['une ligne entière en `/* … */`', ['box-shadow: 0 0 $size $color', '/* la suite */', 'transition: box-shadow 300ms'], [['box-shadow', '0 0 $size $color'], ['transition', 'box-shadow 300ms']]],
      ['un commentaire qui cite une variable inconnue, un point-virgule et des accolades', ['box-shadow: 0 0 $size $color // voir $autre ; {a}'], [['box-shadow', '0 0 $size $color']]],
      ['un `//` dans un texte entre guillemets doubles', ['font-family: "a // b", serif'], [['font-family', '"a // b", serif']]],
      ['un `//` dans un texte entre guillemets simples', ['font-family: \'a // b\', serif'], [['font-family', '\'a // b\', serif']]],
      ['`content: "//"`', ['content: "//"'], [['content', '"//"']]],
      ['`content: "//"` suivi d\'un commentaire', ['content: "//" // deux barres'], [['content', '"//"']]],
      ['un texte avec un guillemet échappé avant le `//`', ['content: "a\\"//b" // note'], [['content', '"a\\"//b"']]],
      ['`url(//cdn/x.png)`', ['background-image: url(//cdn/x.png)'], [['background-image', 'url(//cdn/x.png)']]],
      ['`url( //cdn/x.png )` avec des espaces', ['background-image: url( //cdn/x.png )'], [['background-image', 'url( //cdn/x.png )']]],
      ['`URL(//cdn/x.png)` en majuscules', ['background-image: URL(//cdn/x.png)'], [['background-image', 'URL(//cdn/x.png)']]],
      ['`url(//cdn/x.png)` suivi d\'un commentaire', ['background-image: url(//cdn/x.png) // le fond'], [['background-image', 'url(//cdn/x.png)']]],
      ['`url("//cdn/x.png")` suivi d\'un commentaire', ['background-image: url("//cdn/x.png") // le fond'], [['background-image', 'url("//cdn/x.png")']]],
      ['`url(https://exemple.fr/a.png)` suivi d\'un commentaire', ['background-image: url(https://exemple.fr/a.png) // le fond'], [['background-image', 'url(https://exemple.fr/a.png)']]],
      ['deux `url(…)` puis un commentaire', ['background-image: url(//cdn/a.png), url(//cdn/b.png) // les fonds'], [['background-image', 'url(//cdn/a.png), url(//cdn/b.png)']]],
      ['une adresse à protocole', ['background: https://exemple.fr/a.png'], [['background', 'https://exemple.fr/a.png']]],
      ['une adresse à protocole suivie d\'un commentaire', ['background: https://exemple.fr/a.png // le fond'], [['background', 'https://exemple.fr/a.png']]],
      ['un `/* … */` au milieu de la valeur reste tel quel', ['box-shadow: 0 0 $size /* l\'épaisseur */ $color'], [['box-shadow', '0 0 $size /* l\'épaisseur */ $color']]],
      ['un `/* … */` en fin de ligne reste tel quel', ['box-shadow: 0 0 $size $color /* le halo */'], [['box-shadow', '0 0 $size $color /* le halo */']]],
      ['un `//` dans un `/* … */` n\'est pas un commentaire', ['box-shadow: 0 0 $size $color /* voir http://exemple.fr ou // ici */'], [['box-shadow', '0 0 $size $color /* voir http://exemple.fr ou // ici */']]],
      ['un `/* … */` puis un `//`', ['box-shadow: 0 0 $size $color /* le halo */ // et sa note'], [['box-shadow', '0 0 $size $color /* le halo */']]],
      ['une division d\'une barre', ['width: calc(100% / 3) // le tiers'], [['width', 'calc(100% / 3)']]],
      ['la barre d\'une couleur', ['color: hsl(210 50% 20% / .4) // sombre'], [['color', 'hsl(210 50% 20% / .4)']]],
      ['plusieurs déclarations, un commentaire sur chacune', ['box-shadow: 0 0 $size $color // le halo', 'transition: box-shadow 300ms // la durée'], [['box-shadow', '0 0 $size $color'], ['transition', 'box-shadow 300ms']]]
    ]

    for (const [titre, lignes, attendu] of CAS) {
      it(titre, () => {
        assert.deepEqual(lire(lignes), attendu)
      })
    }

    it('sous @keyframes : l\'étape et la déclaration perdent leur commentaire', () => {
      const bloc = parseEffectsBlock(['*battement(scale: 1.2) =', '  @keyframes', '    50% // le milieu', '      transform: scale($scale) // la taille', '      // opacity: .5'].join('\n'), 1, FICHIER)
      assert.deepEqual(bloc.battement.keyframes, [['50%', [['transform', 'scale($scale)']]]])
    })

    it('un commentaire dans les lignes de plusieurs effets du même bloc', () => {
      const bloc = parseEffectsBlock(['*halo(color: #0ff) =', '  box-shadow: 0 0 4px $color // le halo', '*ombre(color: #000) =', '  text-shadow: 0 0 2px $color // l\'ombre'].join('\n'), 1, FICHIER)
      assert.deepEqual(bloc.halo.decls, [['box-shadow', '0 0 4px $color']])
      assert.deepEqual(bloc.ombre.decls, [['text-shadow', '0 0 2px $color']])
    })
  })

  describe('ce qui reste refusé, avec la ligne écrite', () => {
    it('une valeur que le commentaire vidait : la ligne est citée telle qu\'écrite', () => {
      assert.match(refus(['color: // la couleur']), /\(ligne 2\) : \*halo — « color: \/\/ la couleur » : une déclaration CSS s'écrit propriété: valeur/)
    })

    it('un corps qui n\'est que des commentaires : l\'effet est vide', () => {
      assert.match(refus(['// à faire', '/* bientôt */']), /\*halo = … sans rien/)
    })

    it('une variable inconnue hors du commentaire reste refusée', () => {
      assert.match(refus(['box-shadow: 0 0 $taille $color // le halo']), /\$taille n'est pas un réglage de l'effet/)
    })

    it('un réglage de l\'en-tête avec un commentaire reste refusé', () => {
      assert.throws(() => parseEffectsBlock('*halo(color: #0ff // la couleur) =\n  box-shadow: 0 0 4px $color', 1, FICHIER), /un commentaire ne s'écrit pas dans les réglages d'un effet/)
    })
  })
})
