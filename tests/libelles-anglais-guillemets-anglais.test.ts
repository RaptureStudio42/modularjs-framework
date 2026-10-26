// Les textes anglais du runtime s'écrivent avec des guillemets anglais ("…"), comme leurs voisins : les guillemets français (« … »)
// restent au texte français. Vérifié sur les avertissements du développement (groupe `dev`), sur tous les messages de console (groupe
// `err` : `µ.modal.fire`, `µ.store`, `µevery`, i18n, le graphique…) et sur les libellés du graphique (`<@@chart>`)

import assert from 'node:assert/strict'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'

const en = RUNTIME_LABELS.en as any

// clé → texte, pour un groupe entier ou pour les clés d'un groupe qui commencent par un préfixe
const textes = (groupe: string, prefixe = ''): [string, string][] => Object.entries(en[groupe] as Record<string, unknown>).filter(([k, v]) => k.startsWith(prefixe) && typeof v === 'string').map(([k, v]) => [groupe + '.' + k, v as string])

describe('libellés anglais : guillemets anglais', () => {
  const cas: Record<string, [string, string][]> = {
    'avertissements du développement (dev)': textes('dev'),
    'messages de console (err)': textes('err'),
    'libellés du graphique (core.chart…)': textes('core', 'chart'),
  }

  for (const [nom, liste] of Object.entries(cas)) it(`${nom} : aucun guillemet français`, () => {
    assert.ok(liste.length > 0, 'des textes sont lus')
    const fautifs = liste.filter(([, v]) => /[«»]/.test(v)).map(([k, v]) => `${k} : ${v}`)
    assert.deepEqual(fautifs, [])
  })

  it('la prop écrite par l\'enfant est nommée entre guillemets anglais', () => {
    assert.ok(en.dev.propOneWay.includes('"{prop}"'), en.dev.propOneWay)
  })
})
