// Avec `resolveAsset`, un appel `µasset('x')` du script est remplacé à sa place, même quand le même texte est cité
// plus haut dans un commentaire : avant, c'est la première occurrence du texte (celle du commentaire) qui recevait
// l'adresse résolue, et l'appel réel restait non résolu.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const resolveAsset = async (p: string) => '/a/' + p + '?v=1'

describe('µasset — remplacement à la place de l\'appel retenu', () => {
  it('appel cité d\'abord dans un commentaire : l\'appel réel est résolu', async () => {
    const src = "<script>\n# exemple : µasset('logo.png')\n$src = µasset('logo.png')\n</script>\n<img src={$src} alt=\"x\">"
    const r = await transpile(src, { moduleName: 'asset', resolveAsset })
    assert.match(r.output, /'\/a\/logo\.png\?v=1'/)
    assert.doesNotMatch(r.output, /µ\.asset\('logo\.png'\)/)
  })

  it('deux appels réels identiques : tous deux résolus', async () => {
    const src = "<script>\n$a = µasset('logo.png')\n$b = µasset('logo.png')\n</script>\n<img src={$a} alt=\"x\"><img src={$b} alt=\"y\">"
    const r = await transpile(src, { moduleName: 'asset', resolveAsset })
    assert.equal(r.output.split("'/a/logo.png?v=1'").length - 1 >= 2, true)
    assert.doesNotMatch(r.output, /µ\.?asset\('logo\.png'\)/)
  })

  it('chaîne qui cite l\'appel avant l\'appel réel : la chaîne reste telle quelle', async () => {
    const src = "<script>\n$aide = \"écrivez µasset('logo.png')\"\n$src = µasset('logo.png')\n</script>\n<img src={$src} alt={$aide}>"
    const r = await transpile(src, { moduleName: 'asset', resolveAsset })
    assert.match(r.output, /écrivez µasset\('logo\.png'\)/)
    assert.match(r.output, /'\/a\/logo\.png\?v=1'/)
  })
})
