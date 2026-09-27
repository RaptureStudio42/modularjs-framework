// replaceMagicAssets résolvait µasset(...)/µ.asset(...) sur tout le texte, sans distinguer un
// VRAI appel d'une simple MENTION dans une chaîne (script) ou un exemple de doc affiché dans un
// <pre>/<code> (HTML) : le chemin cité était résolu quand même (texte affiché corrompu, ou pire,
// une ressource inexistante référencée comme si elle existait).

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.ts'

describe('replaceMagicAssets : jamais résolu à l\'intérieur d\'une chaîne/d\'un exemple de doc', function () {
  this.timeout(8000)

  it('un `console.log` citant µasset(\'doc.png\') en exemple (script) n\'appelle jamais resolveAsset', async function () {
    const calls: string[] = []
    const resolveAsset = async (p: string) => { calls.push(p); return `/resolved/${p}` }
    const src = [
      '<script>',
      `console.log("exemple : µasset('doc.png') resout un asset")`,
      '</script>',
      '<p>hi</p>',
    ].join('\n')
    const { output } = await transpile(src, { moduleName: 'muasset-script-string', resolveAsset })
    assert.ok(!calls.includes('doc.png'), 'la mention en chaîne ne doit jamais déclencher resolveAsset')
    assert.ok(output.includes("µasset('doc.png')"), 'le texte cité doit survivre tel quel')
  })

  it('un VRAI `µasset(\'logo.png\')` dans le script est toujours résolu', async function () {
    const calls: string[] = []
    const resolveAsset = async (p: string) => { calls.push(p); return `/resolved/${p}` }
    const src = [
      '<script>',
      "$logo = µasset('logo.png')",
      '</script>',
      '<p>{$logo}</p>',
    ].join('\n')
    const { output } = await transpile(src, { moduleName: 'muasset-script-reel', resolveAsset })
    assert.ok(calls.includes('logo.png'), 'un vrai appel doit toujours déclencher resolveAsset')
    assert.ok(output.includes('/resolved/logo.png'), 'le chemin résolu doit apparaître dans la sortie')
  })

  it('un exemple de doc `<pre><code>µasset(\'x.png\')</code></pre>` (HTML) n\'appelle jamais resolveAsset', async function () {
    const calls: string[] = []
    const resolveAsset = async (p: string) => { calls.push(p); return `/resolved/${p}` }
    const src = "<pre><code>µasset('x.png')</code></pre>\n<p>hi</p>"
    const { output } = await transpile(src, { moduleName: 'muasset-html-precode', resolveAsset })
    assert.ok(!calls.includes('x.png'), 'l\'exemple de doc ne doit jamais déclencher resolveAsset')
    assert.ok(output.includes("µasset('x.png')"), 'le texte cité doit survivre tel quel')
  })

  it('non-régression — un VRAI `µasset(...)` en attribut HTML direct (sans accolades) reste résolu', async function () {
    const calls: string[] = []
    const resolveAsset = async (p: string) => { calls.push(p); return `/resolved/${p}` }
    const src = `<img src="µasset('img.png')">`
    const { output } = await transpile(src, { moduleName: 'muasset-html-attr-direct', resolveAsset })
    assert.ok(calls.includes('img.png'), 'un vrai attribut direct doit toujours déclencher resolveAsset')
    assert.ok(output.includes('/resolved/img.png'), 'le chemin résolu doit apparaître dans la sortie')
  })
})
