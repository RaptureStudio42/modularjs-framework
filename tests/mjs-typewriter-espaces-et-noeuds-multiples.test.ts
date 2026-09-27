// Régression — animations/typewriter.ts, deux défauts du même setup() :
//
// 1. Les espaces significatifs de DÉBUT/FIN du texte animé disparaissaient définitivement :
//    `node._mjs_text_cache = textNode.textContent.trim()` tronquait le cache lui-même (pas
//    seulement une lecture ponctuelle) — même après un tick(1) (texte "complet"), les espaces
//    étaient partis pour de bon.
// 2. Un élément à PLUSIEURS nœuds texte RÉELS (ex. « Bonjour {$nom} ! » — l'interpolation crée
//    son propre nœud texte, distinct du texte statique voisin) n'était pas détecté comme tel :
//    seul le premier nœud s'animait, les autres restaient affichés intégralement dès le départ,
//    SANS l'erreur explicite que docs/10-transitions.md promet pourtant pour toute structure que
//    ce tick ne sait pas restituer proprement (au même titre que le markup imbriqué, déjà couvert
//    par anim-typewriter-text-node-guard.test.ts).
//
// Chargement du factory : même mécanisme que anim-typewriter-text-node-guard.test.ts (cf. son
// en-tête) — le fichier est une expression IIFE, `new Function('µ', 'return (...)')`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'animations', 'typewriter.ts'), 'utf-8')

function loadFactory(µMock: any) {
  return new Function('µ', 'return (' + SRC.trim().replace(/;\s*$/, '') + ')')(µMock)
}

describe('animations/typewriter.ts — espaces de début/fin conservés', function () {
  let win: any
  beforeEach(() => {
    win = new Window({ url: 'http://localhost/' })
    ;(globalThis as any).Node = win.Node // `child.nodeType === Node.ELEMENT_NODE` lit le global bare
  })

  it('texte "  Bonjour  " (espaces significatifs, pas de l\'indentation compilateur) : intacts à t=1', function () {
    const node = win.document.createElement('p')
    node.textContent = '  Bonjour  '
    const factory = loadFactory({})
    const { intro } = factory({ speed: 1 })
    const cfg = intro(node)
    cfg.tick(1, 0)
    assert.equal(node.textContent, '  Bonjour  ', 'AVANT le fix : .trim() sur le cache perdait les espaces de début/fin')
  })

  it('texte "  Bonjour  " : à t=0.5, les caractères révélés comptent aussi les espaces de tête', function () {
    const node = win.document.createElement('p')
    node.textContent = '  Bonjour  ' // 11 caractères
    const factory = loadFactory({})
    const { intro } = factory({ speed: 1 })
    const cfg = intro(node)
    assert.equal(cfg.duration, 11 * 1, 'la durée doit compter TOUS les caractères, espaces compris')
    cfg.tick(2 / 11, 1 - 2 / 11) // 2 premiers caractères révélés = les 2 espaces de tête
    assert.equal(node.textContent, '  ')
  })

  it('outro (effacement) : repart bien du texte complet AVEC ses espaces d\'origine', function () {
    const node = win.document.createElement('p')
    node.textContent = ' Salut'
    const factory = loadFactory({})
    const { outro } = factory({ speed: 1 })
    const cfg = outro(node)
    cfg.tick(1, 0)
    assert.equal(node.textContent, ' Salut')
    cfg.tick(0, 1)
    assert.equal(node.textContent, '')
  })
})

describe('animations/typewriter.ts — plusieurs nœuds texte RÉELS (ex. texte + interpolation adjacents)', function () {
  let win: any
  beforeEach(() => {
    win = new Window({ url: 'http://localhost/' })
    ;(globalThis as any).Node = win.Node
  })

  it('deux nœuds texte non-blancs adjacents ("Bonjour " + " !") : lève, comme le markup imbriqué', function () {
    const node = win.document.createElement('p')
    node.appendChild(win.document.createTextNode('Bonjour '))
    node.appendChild(win.document.createTextNode(' !'))
    const factory = loadFactory({})
    const { intro } = factory({ speed: 1 })
    assert.throws(
      () => intro(node),
      (e: any) => e instanceof Error && e.message === '@transition.typewriter exige un unique nœud texte',
      'AVANT le fix : aucune erreur, seul le 1er nœud animait, le 2e restait affiché intégralement dès le départ',
    )
  })

  it('trois nœuds texte non-blancs adjacents (ex. deux interpolations sans séparateur) : lève aussi', function () {
    const node = win.document.createElement('p')
    node.appendChild(win.document.createTextNode('Hello'))
    node.appendChild(win.document.createTextNode('World'))
    node.appendChild(win.document.createTextNode('!'))
    const factory = loadFactory({})
    const { intro } = factory({})
    assert.throws(() => intro(node), /exige un unique nœud texte/)
  })

  it('un seul nœud réel entouré de blancs d\'indentation (doc 225-231) : PAS de throw (non-régression)', function () {
    const node = win.document.createElement('p')
    node.appendChild(win.document.createTextNode('\n  '))
    node.appendChild(win.document.createTextNode('Bonjour'))
    node.appendChild(win.document.createTextNode('\n  '))
    const factory = loadFactory({})
    const { intro } = factory({ speed: 1 })
    assert.doesNotThrow(() => intro(node))
  })

  it('avant le throw : aucun nœud texte n\'est touché (pas de mutation partielle)', function () {
    const node = win.document.createElement('p')
    node.appendChild(win.document.createTextNode('Bonjour '))
    node.appendChild(win.document.createTextNode(' !'))
    const factory = loadFactory({})
    const { intro } = factory({ speed: 1 })
    try { intro(node) } catch (_e) { /* attendu */ }
    assert.equal(node.textContent, 'Bonjour  !', 'le contenu doit rester EXACTEMENT celui de départ')
  })
})
