// une balise globale (`<@window>`, `<@document>`) lit ses écouteurs dans les NOMS de ses attributs : un `@foo` écrit dans une valeur entre
// guillemets (`title="@foo"`) posait un écouteur fantôme `addEventListener('foo', …)`, sur un événement qui n'existe pas

import assert from 'node:assert/strict'
import { processGlobalMacros } from '../src/transpiler/macros.js'

function evenements(gabarit: string): string[] {
  const avant = console.error
  console.error = () => {}
  try {
    const r = processGlobalMacros(gabarit)
    return [...r.setup.matchAll(/addEventListener\('([^']+)'/g)].map(m => m[1])
  }
  finally {
    console.error = avant
  }
}

describe('balises globales — une valeur entre guillemets n\'est pas un événement', () => {
  it('<@window title="@foo"> : aucun écouteur', () => {
    assert.deepEqual(evenements('<@window title="@foo">'), [])
  })

  it("<@window title='@foo' @resize={go()}> : resize seul", () => {
    assert.deepEqual(evenements("<@window title='@foo' @resize={go()}>"), ['resize'])
  })

  it('<@document data-x="@a @b" @click={go()}> : click seul', () => {
    assert.deepEqual(evenements('<@document data-x="@a @b" @click={go()}>'), ['click'])
  })
})
