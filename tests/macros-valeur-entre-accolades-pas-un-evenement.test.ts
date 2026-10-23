// sur une balise globale, une valeur `!{…}` ou `{…}` n'est jamais lue comme un nom d'événement : le `@y` de
// `<@window scrollY=!{@y}>` posait en plus un écouteur fantôme `window.addEventListener('y', …)`, sur un
// événement qui n'existe pas

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

describe('balises globales — une valeur entre accolades n\'est pas un événement', () => {
  it('<@window scrollY=!{@y}> : le seul écouteur est scroll', () => {
    assert.deepEqual(evenements('<@window scrollY=!{@y}>'), ['scroll'])
  })

  it('liaison puis écouteur : scroll et resize, rien d\'autre', () => {
    assert.deepEqual(evenements('<@window scrollY=!{@y} @resize={@w = window.innerWidth}>').sort(), ['resize', 'scroll'])
  })

  it('écouteur puis liaison : resize et scroll, rien d\'autre', () => {
    assert.deepEqual(evenements('<@window @resize={@w = window.innerWidth} scrollY=!{@y}>').sort(), ['resize', 'scroll'])
  })

  it('<@body data-x={@v}> : aucun écouteur', () => {
    assert.deepEqual(evenements('<@body data-x={@v}>'), [])
  })

  it('témoin : <@document @click={@n++}> écoute click', () => {
    assert.deepEqual(evenements('<@document @click={@n++}>'), ['click'])
  })

  it('témoin : <@window @resize=onResize> écoute resize', () => {
    assert.deepEqual(evenements('<@window @resize=onResize>'), ['resize'])
  })

  it('témoin : forme abrégée <@window @scroll> écoute scroll', () => {
    assert.deepEqual(evenements('<@window @scroll>'), ['scroll'])
  })
})
