// magasin global : `$$valueOf` ou `$$toString` jamais posés se lisent comme toute clé absente ; la lecture rendait la méthode héritée
// de l'objet, et la page affichait le texte de la fonction native (« function valueOf() { [native code] } »)
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote } from './helpers/coeur-monter.js'

describe('magasin global : les noms de l\'objet jamais posés', function () {
  this.timeout(40000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('$$valueOf et $$toString jamais posés n\'affichent rien, comme $$absent', async () => {
    const { hote, erreurs } = await monterHote('<p class="a">{$$valueOf}</p><p class="b">{$$toString}</p><p class="c">{$$absent}</p>\n', 'magasin-noms-objet')
    const lu = (c: string) => hote._shadow.querySelector('.' + c).textContent
    assert.equal(lu('a'), lu('c'), 'valueOf')
    assert.equal(lu('b'), lu('c'), 'toString')
    assert.doesNotMatch(lu('a') + lu('b'), /native code|function/)
    assert.equal(erreurs.length, 0, erreurs.join('\n'))
  })
})
