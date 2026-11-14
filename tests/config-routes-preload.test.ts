// mjs.config.json — `"routes": { "preload": "idle" | "on" | "off" }` : chargement des pages d'une table de routes.
// Toute autre forme est refusée avec un message qui cite les trois valeurs ; la valeur lue va au compilateur
// (option `routesPreload` de la construction)

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

function lire(routes: unknown) {
  const root = mjsTmp('config-routes-preload')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ routes }))
  const found = findConfig(root)
  return resolveBundlerOpts(found!.config, root)
}

describe('mjs.config.json — routes.preload', () => {
  for (const mauvais of ['idle', { preload: 'eager' }, { x: 1 }, null, ['on']]) {
    it(`refuse ${JSON.stringify(mauvais)}`, () => {
      assert.throws(() => lire(mauvais), (e: any) => {
        assert.match(e.message, /routes doit être un objet/)
        assert.match(e.message, /"idle"/)
        assert.match(e.message, /"on"/)
        assert.match(e.message, /"off"/)
        assert.match(e.message, /vos tables de routes/)
        return true
      })
    })
  }

  for (const valeur of ['on', 'idle', 'off'] as const) {
    it(`accepte "${valeur}" et le transmet à la construction`, () => {
      assert.equal((lire({ preload: valeur }) as any).routesPreload, valeur)
    })
  }

  it('sans réglage : rien n\'est transmis (le compilateur prend "idle")', () => {
    assert.equal((lire({}) as any).routesPreload, undefined)
  })
})
