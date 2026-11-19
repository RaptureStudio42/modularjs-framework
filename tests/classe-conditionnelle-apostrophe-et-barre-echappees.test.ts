// Une classe conditionnelle dont le nom porte une apostrophe ou une barre oblique inverse (`:class{$on}="content-['x']"`, les
// classes à crochets de Tailwind) : le nom est écrit échappé dans le code produit, qui reste du JavaScript valide (la
// construction de toute l'appli était refusée), en développement comme en production ; la bascule reçoit le nom exact

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { transpile } from '../src/transpiler/index.js'

async function sortie(classe: string, dev: boolean): Promise<string> {
  const src  = `<script>\n$on = true\n</script>\n<div :class{$on}="${classe}">x</div>\n`
  const r: any = await transpile(src, { moduleName: 'cas', devWarnings: dev })
  return String(r.output)
}

describe('classe conditionnelle : apostrophe et barre oblique inverse échappées', function () {
  this.timeout(60000)

  for (const dev of [true, false]) {
    const mode = dev ? 'développement' : 'production'
    for (const classe of ["content-['x']", 'a\\b', "before:content-['a\\\\b']"]) {
      it(`${classe} : code produit valide, bascule du nom exact (${mode})`, async () => {
        const out = await sortie(classe, dev)
        const appel = /[\w.]+\.classList\.toggle\(('(?:[^'\\]|\\.)*'), [\w$.]+\);/.exec(out)
        assert.ok(appel, 'une bascule écrite, son nom entre apostrophes de bout en bout')
        assert.doesNotThrow(() => acorn.parse(appel![0], { ecmaVersion: 'latest' }))
        assert.equal(new Function('return ' + appel![1])(), classe)
      })
    }
  }
})
