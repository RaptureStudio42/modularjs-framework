// La forme nue d'un gestionnaire (`<button @clic>`, sans valeur) appelait toujours la fonction `clic` du <script>, même quand
// seule une méthode `@clic` existait : la construction avertissait, et au clic rien ne se passait (« clic is not defined »).
// Sans l'une ni l'autre, rien n'était dit. Elle appelle la fonction du <script> du même nom si elle existe, sinon la méthode
// `@clic` du composant, avec l'événement puis l'élément ; sans l'une ni l'autre, la construction la refuse, comme `@click=nom`.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function construire(src: string, nom: string): Promise<{ output: string; avertissements: string[] }> {
  const avertissements: string[] = []
  const warn = console.warn
  console.warn = (...a: any[]) => { avertissements.push(String(a[0])) }
  try {
    const { output } = await transpile(src, { moduleName: nom })
    return { output, avertissements }
  }
  finally {
    console.warn = warn
  }
}

describe('gestionnaire en forme nue : la fonction du <script>, sinon la méthode, sinon refusé', () => {

  it('fonction seule : la forme nue appelle la fonction', async () => {
    const { output, avertissements } = await construire('<script>\n$x = 0\nclic = (e) -> $x = 1\n</script>\n<button @clic>a</button>', 'nue-fonction-seule')
    assert.match(output, /return clic\(e, el\)/)
    assert.deepEqual(avertissements.filter((a) => a.includes('clic')), [])
  })

  it('méthode seule : la forme nue appelle la méthode, avec l\'événement, sans avertissement', async () => {
    const { output, avertissements } = await construire('<script>\n$x = 0\n@clic = (e) -> $x = 2\n</script>\n<button @clic>a</button>', 'nue-methode-seule')
    assert.match(output, /return this\.clic\(e, el\)/)
    assert.doesNotMatch(output, /return clic\(e, el\)/)
    assert.deepEqual(avertissements.filter((a) => a.includes('clic')), [])
  })

  it('les deux : la fonction du <script> passe avant la méthode', async () => {
    const { output } = await construire('<script>\n$x = 0\nclic = (e) -> $x = 1\n@clic = (e) -> $x = 2\n</script>\n<button @clic>a</button>', 'nue-les-deux')
    assert.match(output, /return clic\(e, el\)/)
    assert.doesNotMatch(output, /this\.clic\(e, el\)/)
  })

  it('aucune : refusée à la construction, fichier et ligne nommés, comme @click=nom', async () => {
    await assert.rejects(construire('<script>\n$x = 0\n</script>\n<p>texte</p>\n<button @clic>a</button>', 'nue-aucune'), (e: any) => {
      assert.match(e.message, /'nue-aucune\.mjs' \(ligne 5\)/)
      assert.match(e.message, /« @clic »/)
      assert.match(e.message, /« @clic = \(e\) -> … »/)
      return true
    })
  })

  it('balise sur plusieurs lignes : le refus cite la ligne de l\'attribut, pas celle de la balise', async () => {
    await assert.rejects(construire('<script>\n$x = 0\n</script>\n<button\n  class="b"\n  @clic\n>a</button>', 'nue-plusieurs-lignes'), /'nue-plusieurs-lignes\.mjs' \(ligne 6\)/)
  })

  it('nom d\'événement qui ne peut pas être un nom de fonction (`@mon-evt`) : le conseil propose `@mon-evt=nom` ou `@mon-evt=@nom`', async () => {
    await assert.rejects(construire('<script>\n$x = 0\n</script>\n<div @mon-evt>a</div>', 'nue-nom-invalide'), (e: any) => {
      assert.match(e.message, /« @mon-evt=nom » ou « @mon-evt=@nom »/)
      assert.doesNotMatch(e.message, /mon-evt = \(e\)/)
      return true
    })
  })

  it('aucune, sur un nom que le navigateur fournit (`@focus` sans fonction ni méthode) : refusée aussi', async () => {
    await assert.rejects(construire('<script>\n$x = 0\n</script>\n<input @focus>', 'nue-focus'), /« @focus »/)
  })
})
