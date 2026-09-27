// resolvePage (render-routes.ts) retriait Object.keys(render.routes) par spécificité À CHAQUE
// appel — donc à CHAQUE requête HTTP — alors que le tri ne dépend que de render.routes, fixe pour
// la durée de vie d'une configuration compilée. Mémoïsé par référence d'objet (WeakMap) : un
// NOUVEAU render.routes (recompilation) invalide le cache tout seul, jamais de mutation en place à
// craindre pour une config déjà résolue.
import assert from 'node:assert/strict'
import { resolvePage } from '../src/server/render-routes.js'
import type { RenderConfig } from '../src/bundler/config.js'

describe('resolvePage — le tri des routes reste correct, appelé plusieurs fois sur le même render', function () {
  it('la spécificité continue de départager /blog/new et /blog/:slug après plusieurs appels', function () {
    const render: RenderConfig = {
      routes: {
        '/blog/:slug': { component: 'mjs-blog-post' },
        '/blog/new': { component: 'mjs-blog-new' },
      },
    } as any
    for (let i = 0; i < 5; i++) {
      assert.equal(resolvePage('/blog/new', render)?.component, 'mjs-blog-new', `appel ${i} : la route littérale doit toujours gagner`)
      assert.equal(resolvePage('/blog/autre', render)?.component, 'mjs-blog-post', `appel ${i} : le paramètre doit toujours matcher le reste`)
    }
  })

  it('deux render.routes DISTINCTS (deux configs) gardent chacun leur propre tri', function () {
    const renderA: RenderConfig = { routes: { '/a/:id': { component: 'mjs-a-param' }, '/a/fixe': { component: 'mjs-a-fixe' } } } as any
    const renderB: RenderConfig = { routes: { '/a/fixe': { component: 'mjs-b-fixe-seul' } } } as any
    assert.equal(resolvePage('/a/fixe', renderA)?.component, 'mjs-a-fixe')
    assert.equal(resolvePage('/a/fixe', renderB)?.component, 'mjs-b-fixe-seul')
    // ré-interroge A APRÈS B : le cache de B ne doit jamais avoir contaminé celui de A.
    assert.equal(resolvePage('/a/fixe', renderA)?.component, 'mjs-a-fixe')
  })
})
