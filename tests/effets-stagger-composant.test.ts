// `*stagger(unit: child)` sur un composant : accepté, les enfants glissés dedans arrivent un par un ; les autres unités
// (lettre, mot, ligne), l'absence de réglage et une unité tenue par une variable restent refusées, avec le message d'avant

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

describe('*stagger(unit: child) — posé sur un composant', () => {
  it('accepté : les enfants d\'un composant arrivent un par un', async () => {
    const js = await compiler('<@liste *stagger(unit: child)><li>Un</li><li>Deux</li></@liste>')
    assert.match(js, /"stagger", \{[^}]*"unit": ?"child"/)
  })

  it('accepté aussi avec le reste des réglages', async () => {
    const js = await compiler('<@liste class="l" *stagger(unit: child, step: 120ms, clip: true, on: load)><li>Un</li></@liste>')
    assert.match(js, /"stagger"/)
  })

  it('les autres unités, l\'absence de réglage et une variable restent refusées sur un composant', async () => {
    const refus = /\*stagger travaille le texte de sa balise, et <@liste> n'a pas de texte à elle/
    await assert.rejects(compiler('<@liste *stagger(unit: letter)></@liste>'), refus)
    await assert.rejects(compiler('<@liste *stagger(unit: word)></@liste>'), refus)
    await assert.rejects(compiler('<@liste *stagger(unit: line)></@liste>'), refus)
    await assert.rejects(compiler('<@liste *stagger></@liste>'), refus)
    await assert.rejects(compiler('<script>\n$u = \'child\'\n</script>\n<@liste *stagger(unit: $u)></@liste>'), refus)
  })

  it('un autre effet de texte reste refusé sur un composant, même avec unit: child', async () => {
    await assert.rejects(compiler('<@liste *bounce></@liste>'), /\*bounce travaille le texte de sa balise/)
    await assert.rejects(compiler('<@liste *scramble(unit: child)></@liste>'), /\*scramble|unit/)
  })
})
