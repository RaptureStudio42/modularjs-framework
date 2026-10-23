// <@@field label="…"> nomme le champ qu'il enveloppe (le libellé posé en `aria-label` à l'exécution,
// s'il n'a pas déjà de nom) : le contrôle d'accessibilité ne dit plus « champ sans étiquette » pour
// lui. Sans `label`, ou pour un champ hors de lui, l'alerte reste.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function alertesEtiquette(src: string): Promise<string[]> {
  const orig   = console.warn
  const alertes: string[] = []
  console.warn = (...a: unknown[]) => { alertes.push(String(a[0])) }
  try { await transpile(src, { moduleName: 'champ-nomme' }) } finally { console.warn = orig }
  return alertes.filter(m => /sans étiquette|without a label/.test(m))
}

describe('lint.a11y — un champ nommé par <@@field label>', () => {
  it('label écrit ou lié : pas d\'alerte', async () => {
    assert.deepEqual(await alertesEtiquette('<@@field label="Nom">\n  <input name="nom">\n</@@field>\n'), [])
    assert.deepEqual(await alertesEtiquette('<script>\n$l = \'Message\'\n</script>\n<@@field label={$l}><textarea name="m"></textarea></@@field>\n'), [])
  })

  it('sans label, ou un champ hors du <@@field> : l\'alerte reste', async () => {
    assert.equal((await alertesEtiquette('<@@field><input name="nom"></@@field>\n')).length, 1)
    assert.equal((await alertesEtiquette('<@@field label="A"><input name="a"></@@field>\n<input name="b">\n')).length, 1)
  })
})
