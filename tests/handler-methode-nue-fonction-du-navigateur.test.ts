// `@alert = -> …` avec `<button @click={alert('x')}>` : le gestionnaire appelle la fonction du navigateur,
// que l'avertissement annonçait « is not defined ». Pour une méthode dont le nom est celui d'une fonction
// de la fenêtre (alert, confirm, prompt, print…), l'avertissement dit les deux écritures : `window.alert`
// pour la fonction du navigateur, `@alert` pour la méthode du composant. Un autre nom garde son message.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

// les avertissements `[lint.events]` d'une compilation qui doit passer
async function avertissements(src: string): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(src, { moduleName: 'carte' }) } finally { console.warn = orig }
  return vus.filter(m => m.includes('[lint.events]'))
}

describe('gestionnaire qui cite nu le nom d\'une fonction de la fenêtre', () => {
  for (const nom of ['alert', 'print', 'confirm', 'prompt']) {
    it(`@${nom} = … et @click={${nom}(…)} : l'avertissement dit window.${nom}`, async () => {
      const vus = await avertissements(`<script>\n@${nom} = -> 1\n</script>\n<button @click={${nom}('x')}>go</button>\n`)
      assert.equal(vus.length, 1, vus.join(' | '))
      assert.ok(vus[0].includes(`window.${nom}`), vus[0])
      assert.ok(vus[0].includes(`@${nom}`), vus[0])
    })
  }

  it('la forme `@click=nom` aussi', async () => {
    const vus = await avertissements('<script>\n@print = -> 1\n</script>\n<button @click=print>go</button>\n')
    assert.equal(vus.length, 1, vus.join(' | '))
    assert.ok(vus[0].includes('window.print'), vus[0])
  })

  it('un autre nom : le message d\'avant, sans window.', async () => {
    const vus = await avertissements('<script>\n@valider = -> 1\n</script>\n<button @click={valider()}>go</button>\n')
    assert.equal(vus.length, 1, vus.join(' | '))
    assert.ok(vus[0].includes('@valider') && vus[0].includes('is not defined'), vus[0])
    assert.ok(!vus[0].includes('window.'), vus[0])
  })

  it('écrit comme il faut (@alert, window.alert, ou déclaré) : aucun avertissement', async () => {
    assert.deepEqual(await avertissements('<script>\n@alert = -> 1\n</script>\n<button @click={@alert()}>go</button>\n'), [])
    assert.deepEqual(await avertissements('<script>\n@alert = -> 1\n</script>\n<button @click={window.alert(\'x\')}>go</button>\n'), [])
    assert.deepEqual(await avertissements('<script>\nalert = -> 1\n@alert = alert\n</script>\n<button @click={alert()}>go</button>\n'), [])
  })
})
