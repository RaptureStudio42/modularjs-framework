// Une balise qui porte à la fois une classe calculée (`class="l{item.key}"`) et une classe basculée
// (`@class{$x is item.key}="on"`) : réécrire la classe calculée ne retire plus la classe basculée —
// avant, l'attribut `class` était remplacé en entier, et après un tri ou un filtre de la liste le
// choix courant n'était plus allumé. La classe calculée ne remplace que ce qu'elle avait posé.

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

describe('classe calculée et classe basculée sur la même balise', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('classe-dynamique-garde-basculee')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'liste-choix.mjs'), "<script>\n$items = [{key: 'a'}, {key: 'b'}, {key: 'c'}]\n$x = 'b'\n</script>\n<ul>{for item in $items}<li class=\"l{item.key}\" @class{$x is item.key}=\"on\">{item.key}</li>{end}</ul>\n<button class=\"inverse\" @click={$items = [...$items].reverse()}>i</button>\n<button class=\"choisit\" @click={$x = 'c'}>c</button>\n")
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

  it('la liste inversée, puis un autre choix : le choix courant reste allumé, la classe calculée aussi', async () => {
    window.document.body.innerHTML = '<mjs-liste-choix></mjs-liste-choix>'
    const comp = window.document.querySelector('mjs-liste-choix')
    await attendre(() => (comp._shadow?.querySelectorAll('li').length ?? 0) === 3)
    const sh     = comp._shadow
    const etat   = () => [...sh.querySelectorAll('li')].map((li: any) => li.textContent + ':' + li.className)
    const allume = () => [...sh.querySelectorAll('li.on')].map((li: any) => li.textContent)
    assert.deepEqual(allume(), ['b'], JSON.stringify(etat()))
    sh.querySelector('.inverse').click()
    await attendre(() => sh.querySelector('li')?.textContent === 'c')
    assert.deepEqual(allume(), ['b'], `après l'inversion : ${JSON.stringify(etat())}`)
    assert.ok([...sh.querySelectorAll('li')].every((li: any) => li.classList.contains('l' + li.textContent)), JSON.stringify(etat()))
    sh.querySelector('.choisit').click()
    await attendre(() => allume().join() === 'c')
    assert.deepEqual(allume(), ['c'], `après un autre choix : ${JSON.stringify(etat())}`)
  })
})
