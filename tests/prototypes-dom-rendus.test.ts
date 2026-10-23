// les prototypes de happy-dom (Node, Element, HTMLElement…) sont ceux de TOUTES les fenêtres du processus : un fichier de test qui y remplace une méthode et ne la
// remet pas tout à fait (propriété propre en plus, descripteur changé) fausse les fichiers qui tournent après lui, selon l'ordre où mocha les joue
// ce fichier charge ceux qui le faisaient (leurs groupes se jouent donc avant le sien, dans le même processus) puis vérifie que les prototypes sont tels qu'au départ
// du run : aucune propriété propre en plus ou en moins, mêmes descripteurs ; le relevé se prend à la racine, avant le premier groupe

import assert from 'node:assert/strict'
import * as HappyDOM from 'happy-dom'
import { guardStyleValues } from '../src/server/renderToString.js'
import { releverPrototypes, ecartsPrototypes, type Releve } from './helpers/prototypes-etat.js'
import './curseurs-trousse-par-variable.test.js'
import './effets-compteur-gabarit.test.js'
import './effets-compteur-largeur.test.js'
import './effets-compteur-retrecit.test.js'
import './effets-exclusivites.test.js'
import './effets-methodes-auteur-prototype.test.js'
import './ssr-closed-shadow-mode.test.js'

let avant: Releve

// crochet racine : tourne avant le premier groupe du run, donc avant toute retouche d'un prototype
// la garde de style du rendu serveur est posée d'abord : le renderer la pose exprès, une fois par processus, sur la classe que partagent
// toutes les fenêtres (une valeur refusée par le navigateur ne change rien) ; elle fait partie de l'état de départ, ce n'est pas la fuite d'un test
before(() => {
  guardStyleValues(HappyDOM.CSSStyleDeclaration)
  avant = releverPrototypes()
})

describe('prototypes de happy-dom — rendus tels quels par les fichiers de test qui les retouchent', () => {
  it('après leurs groupes : aucune propriété propre en plus ou en moins, mêmes descripteurs', () => {
    assert.deepEqual(ecartsPrototypes(avant), [], 'un fichier de test a retouché un prototype partagé sans le rendre tel qu\'il était : garder le descripteur d\'avant, le remettre dans un after (ou delete si la propriété n\'existait pas)')
  })
})
