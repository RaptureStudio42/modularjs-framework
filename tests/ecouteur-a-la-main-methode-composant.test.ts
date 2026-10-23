// Un écouteur posé à la main (`bouton.addEventListener 'click', -> …`) : le navigateur l'appelle avec
// `this` = l'élément. `@x` y lit l'élément, quel que soit le nom (`@classList`, `@nodeName`, et même
// `@compte` que le <script> pose sur le composant) : `@x` est le `this` que donne l'appelant, partout.
// Le composant s'y écrit `@@x` (`@@valider()`, `@@compte++`). Avant, un nom posé sur le composant
// lisait le composant et un autre l'élément, dans le même rappel : ajouter `@value = …` ailleurs dans
// le script changeait ce que lisait un écouteur existant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = [
  '<script>',
  '$n = 0',
  '@compte = 0',
  '@valider = -> $n++',
  'µmount ->',
  '  bouton.addEventListener \'click\', -> @@valider()',
  '  bouton.addEventListener \'mjs-essai\', -> @@compte++',
  '  bouton.addEventListener \'focus\', -> @classList.add(\'vu\')',
  '  bouton.addEventListener \'mjs-lire\', -> window.__lu = [@nodeName, @compte]',
  '</script>',
  '<button class="b" @this=!{bouton}>{$n}</button>',
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('écouteur posé à la main — @x lit l\'élément, @@x le composant', function () {
  this.timeout(60000)
  let window: any
  const erreurs: string[] = []

  before(async () => {
    const root   = mjsTmp('ecouteur-a-la-main-methode-composant')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'bouton-main.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.addEventListener('error', (e: any) => erreurs.push(String(e.error?.message ?? e.message)))
    window.console.error = (...a: unknown[]) => { erreurs.push(a.map(String).join(' ')) }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('clic : @@valider tourne ; @@compte suit ; @classList, @nodeName et @compte sont ceux de l\'élément', async () => {
    window.document.body.innerHTML = '<mjs-bouton-main></mjs-bouton-main>'
    const comp = window.document.querySelector('mjs-bouton-main')
    await attendre(() => comp._shadow?.querySelector('.b')?.textContent === '0')
    const b = comp._shadow.querySelector('.b')
    b.dispatchEvent(new window.MouseEvent('click'))
    await attendre(() => b.textContent === '1')
    assert.equal(b.textContent, '1', 'le clic appelle @valider du composant')
    b.dispatchEvent(new window.Event('mjs-essai'))
    assert.equal(comp.compte, 1, '@compte est celui du composant')
    assert.equal(b.compte, undefined, 'rien de posé sur l\'élément')
    b.dispatchEvent(new window.FocusEvent('focus'))
    assert.equal(b.classList.contains('vu'), true, '@classList : l\'élément qui a reçu l\'événement')
    b.dispatchEvent(new window.Event('mjs-lire'))
    assert.deepEqual([...window.__lu], ['BUTTON', undefined], '@compte lit l\'élément, même si le <script> pose @compte sur le composant')
    assert.deepEqual(erreurs, [])
  })
})
