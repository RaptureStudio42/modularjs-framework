// Le rendu serveur note le texte que reçoit `replaceSync` (le texte compilé, à l'octet) et le réécrit dans la page. Une règle
// ajoutée ou retirée ensuite (`insertRule`, `deleteRule`, ou un `replace`) ne changeait pas ce texte noté : la page recevait la
// feuille d'avant. Le cœur le fait lui-même (le thème embarqué ajoute sa règle du thème en cercle par `insertRule`). Une règle
// ajoutée en fin s'ajoute maintenant au texte noté ; autrement, le texte noté est oublié et la feuille se relit par ses règles.

import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { noterTexteFeuilles, texteFeuille } from '../src/server/renderToString.js'

describe('rendu serveur — texte d\'une feuille modifiée après replaceSync', () => {
  const feuille = (css: string): any => {
    const w: any = new Window()
    noterTexteFeuilles(w)
    const f = new w.CSSStyleSheet()
    f.replaceSync(css)
    return f
  }

  it('insertRule en fin : la règle s\'ajoute au texte noté, à l\'octet', () => {
    const f = feuille(':where(:root){--mjs-surface:#fff}')
    f.insertRule('.b{color:blue}', f.cssRules.length)
    assert.equal(texteFeuille(f), ':where(:root){--mjs-surface:#fff}\n.b{color:blue}')
  })

  it('insertRule en tête : la règle ressort', () => {
    const f = feuille('.a{color:red}')
    f.insertRule('.b{color:blue}', 0)
    assert.match(texteFeuille(f), /\.b\s*\{/)
    assert.match(texteFeuille(f), /\.a\s*\{/)
  })

  it('deleteRule : la règle retirée ne ressort plus', () => {
    const f = feuille('.a{color:red}.b{color:blue}')
    f.deleteRule(0)
    assert.doesNotMatch(texteFeuille(f), /\.a\s*\{/)
    assert.match(texteFeuille(f), /\.b\s*\{/)
  })

  it('replace après replaceSync : le nouveau texte', async () => {
    const f = feuille('.a{color:red}')
    await f.replace('.c{color:green}')
    assert.equal(texteFeuille(f), '.c{color:green}')
  })
})
