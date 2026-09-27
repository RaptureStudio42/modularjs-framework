// `_mjs_destroyNodeAndChildren` (mesure de perf, A5b) : son chemin DOMINANT (composant sans
// `@transition`/`@in`/`@out`/`@attach`/`@this=!`/`@flip`) est 100 % synchrone — il n'a plus
// besoin d'être `async` (qui allouerait une Promise NEUVE à chaque destruction). Le contrat
// pour les appelants (mjs_if.ts/mjs_key.ts/mjs_html.ts enchaînent un `.catch` sur le retour,
// sans `await`) doit rester identique : toujours un objet Promise-like, jamais `undefined`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const SANS_HOOKS = '<script>\n$items = [1, 2, 3]\n$visible = true\n</script>\n{if $visible}<p class="v">visible</p>{end}\n{for it in $items}<span class="it">{it}</span>{end}\n'

function projetTemporaire(): string {
  const root   = mjsTmp('destroy-contrat')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'sans-hooks.mjs'), SANS_HOOKS)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('_mjs_destroyNodeAndChildren — contrat Promise préservé (chemin rapide non-async)', function () {
  this.timeout(60000)

  let root: string
  let app: any

  before(async () => {
    root = projetTemporaire()
    app  = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('le retour est un objet Promise-like (.then et .catch), sur le chemin rapide comme sur un nœud texte', async () => {
    const c = await app.mount('sans-hooks')
    try {
      const el = c.el
      const div = app.window.document.createElement('div')
      const r1 = el._mjs_destroyNodeAndChildren(div)
      assert.equal(typeof r1.then, 'function', 'doit rester thenable (chemin élément, no-destroy-hooks)')
      assert.equal(typeof r1.catch, 'function', 'doit rester catchable — mjs_if.ts/mjs_key.ts/mjs_html.ts enchaînent .catch SANS await')
      await r1

      const texte = app.window.document.createTextNode('x')
      const r2 = el._mjs_destroyNodeAndChildren(texte)
      assert.equal(typeof r2.catch, 'function', 'doit rester catchable — chemin nœud texte (nodeType !== 1)')
      await r2
    } finally {
      c.destroy()
    }
  })

  it('un {if} qui bascule plusieurs fois de suite continue de fonctionner (destruction réelle via mjs_if.ts)', async () => {
    const c = await app.mount('sans-hooks')
    try {
      assert.equal(c.text('.v'), 'visible')
      c.el._set('visible', false)
      await c.tick()
      assertAbsent(c.find('.v'), 'le nœud doit avoir été retiré du DOM')
      c.el._set('visible', true)
      await c.tick()
      assert.equal(c.text('.v'), 'visible', 'et pouvoir revenir sans erreur après la destruction')
    } finally {
      c.destroy()
    }
  })

  it('un {for} qui retire des éléments continue de fonctionner (destruction réelle via mjs_for.ts)', async () => {
    const c = await app.mount('sans-hooks')
    try {
      assert.equal(c.findAll('.it').length, 3)
      c.el._set('items', [1])
      await c.tick()
      assert.equal(c.findAll('.it').length, 1, 'les deux éléments retirés de la liste doivent avoir été détruits sans erreur')
    } finally {
      c.destroy()
    }
  })
})
