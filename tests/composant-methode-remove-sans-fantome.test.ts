// Un composant qui déclare une méthode `@remove` (`@remove = (todo) -> …`, le nom le plus naturel d'une
// liste de tâches) quitte la page quand ModularJS le retire : un {if} qui se referme, une ligne de {for}
// qui part. Dans un composant, `this` EST la balise : la méthode masque `remove()` de la balise
// (HTMLElement), et le retrait, qui appelait `remove()` sur la balise, faisait partir la méthode de
// l'auteur à la place — le composant restait affiché, en fantôme, sans la moindre erreur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const ENFANT = "<script>\n$todos   = ['a', 'b']\n$retires = []\n@remove = (todo) -> $retires = [...$retires, todo]\n</script>\n<p class=\"dedans\">{$todos.length}</p>\n"
const PARENT = "<script>\n$montre = true\n$lignes = [1, 2]\n</script>\n{if $montre}<@enfant class=\"seul\"></@enfant>{end}\n<div class=\"liste\">{for l in $lignes}<@enfant class=\"ligne\"></@enfant>{end}</div>\n"

describe('un composant qui déclare @remove quitte la page quand ModularJS le retire', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('composant-methode-remove')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'parent.mjs'), PARENT)
    writeFileSync(join(srcDir, 'enfant.mjs'), ENFANT)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // la page montée, ses trois enfants rendus
  async function monter() {
    window.document.body.innerHTML = '<mjs-parent></mjs-parent>'
    const p = window.document.querySelector('mjs-parent')
    await attendre(() => [...(p._shadow?.querySelectorAll('mjs-enfant') ?? [])].filter((e: any) => e._shadow?.querySelector('.dedans')).length === 3)
    return p
  }

  it('un {if} qui se referme : le composant part, sa méthode n\'est pas appelée', async () => {
    const p      = await monter()
    const enfant = p._shadow.querySelector('mjs-enfant.seul')
    p._set('montre', false)
    await attendre(() => !enfant.isConnected)
    assert.equal(enfant.isConnected, false, 'fantôme : le composant est resté dans la page après la fermeture du {if}')
    assert.equal(enfant._state.retires.length, 0, 'la méthode @remove de l\'auteur a été appelée par le retrait')
  })

  it('une ligne de {for} qui part : son composant part avec elle', async () => {
    const p       = await monter()
    const lignes  = p._shadow.querySelectorAll('mjs-enfant.ligne')
    const partant = lignes[1]
    p._set('lignes', [1])
    await attendre(() => !partant.isConnected)
    assert.equal(partant.isConnected, false, 'fantôme : le composant de la ligne retirée est resté dans la page')
    assert.equal(p._shadow.querySelectorAll('mjs-enfant.ligne').length, 1)
    assert.equal(partant._state.retires.length, 0, 'la méthode @remove de l\'auteur a été appelée par le retrait')
  })
})
