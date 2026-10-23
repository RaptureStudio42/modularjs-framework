// Les tables de motifs (`render.routes`, `props` et `actions` de l'entry serveur) étaient retriées par spécificité à chaque
// requête dans l'entry serveur, avec une copie de la règle de tri. Une seule règle, mémorisée par table : même ordre, aucun
// nouveau tri tant que la table ne change pas ; une table modifiée en place est triée de nouveau.

import assert from 'node:assert/strict'
import { patternsBySpecificity } from '../src/server/render-routes.js'

describe('tri des motifs par spécificité — mémorisé par table', () => {
  it('segments littéraux d\'abord, puis longueur ; même tableau tant que la table ne change pas', () => {
    const table: Record<string, unknown> = { '/blog/:slug': 1, '/blog/new': 2, '/*': 3, '/blog/:slug/edit': 4 }
    const premier = patternsBySpecificity(table)
    assert.deepEqual(premier, ['/blog/:slug/edit', '/blog/new', '/blog/:slug', '/*'])
    assert.equal(patternsBySpecificity(table), premier)
  })

  it('table modifiée en place : triée de nouveau', () => {
    const table: Record<string, unknown> = { '/a/:id': 1 }
    patternsBySpecificity(table)
    table['/a/edit'] = 2
    assert.deepEqual(patternsBySpecificity(table), ['/a/edit', '/a/:id'])
  })
})
