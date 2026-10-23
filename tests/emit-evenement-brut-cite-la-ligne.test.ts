// L'avertissement « µemit 'nom', e relaie l'événement reçu, pas sa charge » cite la ligne de la balise qui porte
// le gestionnaire, comme les autres avertissements du HTML : celle du fichier, lignes vides en tête comprises,
// en français (« ligne ») comme en anglais (« line »). Un gestionnaire sans événement brut n'avertit pas.

import assert from 'node:assert/strict'
import { setMessagesLang } from '../src/messages/index.js'
import { transpile } from '../src/transpiler/index.js'

async function evenements(src: string): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(src, { moduleName: 'relais' }) } finally { console.warn = orig }
  return vus.filter(m => m.includes('[lint.events]'))
}

describe('µemit \'x\', e dans un gestionnaire du HTML : la ligne est citée', () => {
  it('la ligne de la balise, avant le texte du message', async () => {
    const vus = await evenements('<p>un</p>\n<button @click={µemit \'x\', e}>b</button>\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /relais \(ligne 2\) : « µemit 'x', e »/)
  })

  it('deux gestionnaires fautifs : chacun sa ligne', async () => {
    const vus = await evenements('<button @click={µemit \'a\', e}>a</button>\n<p>au milieu</p>\n<button @click={µemit \'b\', e}>b</button>\n')
    assert.equal(vus.length, 2, vus.join('\n'))
    assert.match(vus[0], /\(ligne 1\) : « µemit 'a', e »/)
    assert.match(vus[1], /\(ligne 3\) : « µemit 'b', e »/)
  })

  it('un <script> avant le HTML : la ligne reste celle du fichier', async () => {
    const vus = await evenements('<script>\n$x = 1\n</script>\n<p>{$x}</p>\n<button @click={µemit \'x\', e}>b</button>\n')
    assert.match(vus[0], /\(ligne 5\)/)
  })

  it('des lignes vides en tête : la ligne du fichier', async () => {
    const vus = await evenements('\n\n\n<button @click={µemit \'x\', e}>b</button>\n')
    assert.match(vus[0], /\(ligne 4\)/)
  })

  it('une balise sur plusieurs lignes : la ligne où elle s\'ouvre', async () => {
    const vus = await evenements('<p>un</p>\n<button\n  class="a"\n  @click={µemit \'x\', e}>b</button>\n')
    assert.match(vus[0], /\(ligne 2\)/)
  })

  it('dans un {for} et dans un {if} : la ligne de la balise', async () => {
    const vus = await evenements('<script>\n$liste = [1, 2]\n$ok = true\n</script>\n{for n in $liste}\n  <button @click={µemit \'x\', e}>{n}</button>\n{end}\n{if $ok}\n  <a @click={µemit \'y\', e}>a</a>\n{end}\n')
    assert.equal(vus.length, 2, vus.join('\n'))
    assert.match(vus[0], /\(ligne 6\) : « µemit 'x', e »/)
    assert.match(vus[1], /\(ligne 9\) : « µemit 'y', e »/)
  })

  it('en anglais : « line » à la place de « ligne »', async () => {
    setMessagesLang('en')
    try {
      const vus = await evenements('<p>un</p>\n<button @click={µemit \'x\', e}>b</button>\n')
      assert.match(vus[0], /relais \(line 2\): "µemit 'x', e"/)
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('un gestionnaire qui envoie e.data : aucun avertissement', async () => {
    assert.deepEqual(await evenements('<button @click={µemit \'x\', e.data}>b</button>\n'), [])
  })

  it('un gestionnaire sans µemit, et un avant lui : seul le fautif avertit, à sa ligne', async () => {
    const vus = await evenements('<script>\n$n = 0\n</script>\n<button @click={$n++}>a</button>\n<button @click={µemit \'x\', e}>b</button>\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /\(ligne 5\)/)
  })
})
