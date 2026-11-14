// Reference Target : là où le navigateur l'offre (`referenceTarget` sur l'ombre), le socle des champs du cœur le pose vers le champ
// réel de l'ombre, et une `<label for>`, un `aria-labelledby` ou un `aria-describedby` de la page qui visent la balise l'atteignent ;
// ailleurs, rien ne change. Aucun moteur de Playwright ne l'offre encore : un faux minimal tient lieu de navigateur

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const SOURCE = transformSync(readFileSync(new URL('../src/runtime/mjs_form_associated.ts', import.meta.url), 'utf8'), { loader: 'ts' }).code

// le socle chargé sur un faux `µ`
const socle = (): any => {
  const µ: any = {}
  new Function('µ', SOURCE)(µ)
  return µ
}

// balise, ombre et champ réel ; `offert` : l'ombre porte `referenceTarget`, comme dans un navigateur qui l'offre
const faux = (offert: boolean, id = '') => {
  const ombre: any = { addEventListener() {} }
  if (offert) ombre.referenceTarget = null
  const el: any    = { _shadow: ombre, internals: {}, addEventListener() {} }
  const champ: any = { id, focus() {}, click() {} }
  return { el, ombre, champ }
}

describe('champs du cœur : Reference Target là où le navigateur l\'offre', () => {
  it('pose referenceTarget vers le champ de l\'ombre, qui reçoit un id', () => {
    const { el, ombre, champ } = faux(true)
    socle()._mjs_formLabel(el, champ, true)
    assert.ok(champ.id !== '', 'le champ reçoit un id')
    assert.equal(ombre.referenceTarget, champ.id)
  })

  it('garde l\'id que le champ porte déjà', () => {
    const { el, ombre, champ } = faux(true, 'saisie')
    socle()._mjs_formLabel(el, champ, false)
    assert.equal(champ.id, 'saisie')
    assert.equal(ombre.referenceTarget, 'saisie')
  })

  it('ne pose rien quand le navigateur ne l\'offre pas', () => {
    const { el, ombre, champ } = faux(false)
    socle()._mjs_formLabel(el, champ, true)
    assert.equal('referenceTarget' in ombre, false)
    assert.equal(champ.id, '')
  })

  it('ne pose rien sur une balise sans ombre', () => {
    const { el, champ } = faux(false)
    el._shadow          = el
    el.referenceTarget  = undefined
    socle()._mjs_formLabel(el, champ, true)
    assert.equal(el.referenceTarget, undefined)
    assert.equal(champ.id, '')
  })
})
