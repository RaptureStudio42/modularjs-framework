// render.forwardOrigin : le chemin de la requête s'ajoute à l'origine retenue ; un chemin qui ne commence pas par « / » (`@evil.example/`)
// composerait une adresse vers un autre hôte (`https://back.example@evil.example/`) — repli sûr, rien n'est relayé. Inatteignable
// par HTTP aujourd'hui (Node répond 400 à une telle cible), d'où un test de la fonction elle-même
import assert from 'node:assert/strict'
import { computeForwardedOrigin } from '../src/server/forward-origin.js'

describe('render.forwardOrigin — un chemin sans « / » initial ne compose aucune adresse', function () {
  it('origine fixe : `@evil.example/` ne relaie rien', function () {
    assert.deepEqual(computeForwardedOrigin({ forwardOrigin: 'https://back.example' } as any, '@evil.example/', {}), {})
  })

  it('origine fixe : un chemin ordinaire est toujours relayé', function () {
    assert.deepEqual(computeForwardedOrigin({ forwardOrigin: 'https://back.example/' } as any, '/p/1?x=2', {}), { forwardedUrl: 'https://back.example/p/1?x=2' })
  })

  it('hôtes de confiance : `@evil.example/` ne relaie rien non plus', function () {
    assert.deepEqual(computeForwardedOrigin({ forwardOrigin: { trustedHosts: ['site.example'] } } as any, '@evil.example/', { host: 'site.example' }), {})
  })
})
