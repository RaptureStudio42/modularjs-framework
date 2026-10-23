// Dans un {for}, un gestionnaire reçoit la ligne où l'événement a eu lieu, même quand le nom de
// l'événement commence comme une directive : `@input` et `@invalid` (comme `@in`), `@transitionend`
// (comme `@transition`), un événement maison `@outcome` (comme `@out`) ou `@introduce` (comme les
// rappels `@introstart`…). Seuls `@in`, `@out`, `@transition` exacts, suivis ou non d'un
// modificateur (`.global`), sont des directives ; le reste est un événement, et sa ligne se retrouve
// par l'index posé sur la balise.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const EVENEMENTS = ['input', 'invalid', 'transitionend', 'outcome', 'introduce', 'change']

// une liste de trois lignes, un champ par ligne ; l'événement écrit le numéro de sa ligne
const composant = (evt: string) => `<script>\n$l = [{n: 1}, {n: 2}, {n: 3}]\n$v = 0\n</script>\n<ul>{for x in $l}<li><input class="c" aria-label="n" @${evt}={$v = x.n}></li>{end}</ul>\n<p class="v">{$v}</p>\n`

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('{for} : un événement au nom proche d\'une directive reçoit sa ligne', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('boucle-evenements-directives')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const evt of EVENEMENTS) writeFileSync(join(srcDir, `ev-${evt}.mjs`), composant(evt))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
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

  for (const evt of EVENEMENTS) {
    it(`@${evt} sur la 3e ligne écrit 3`, async () => {
      window.document.body.innerHTML = `<mjs-ev-${evt}></mjs-ev-${evt}>`
      const hote = window.document.querySelector(`mjs-ev-${evt}`)
      await attendre(() => (hote._shadow?.querySelectorAll('input.c').length ?? 0) === 3)
      const champs = hote._shadow.querySelectorAll('input.c')
      assert.equal(champs.length, 3)
      champs[2].dispatchEvent(new window.Event(evt, { bubbles: evt !== 'invalid' }))
      const texte = () => hote._shadow.querySelector('.v')?.textContent ?? ''
      await attendre(() => texte() !== '0')
      assert.equal(texte(), '3')
    })
  }
})
