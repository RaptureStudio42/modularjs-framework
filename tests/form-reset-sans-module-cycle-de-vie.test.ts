// la remise à zéro d'un formulaire (mjs_form_reset.ts, `µ._mjs_formReset`) suit son module d'un formulaire à l'autre à
// chaque connexion et déconnexion. Elle s'inscrivait par `_mjs_onAwake` / `_mjs_onSleep`, méthodes du fichier du cycle
// de vie (mjs_lifecycle.ts), que rien n'oblige à embarquer avec elle : sans lui, l'appel levait au montage du module.
// Elle s'inscrit désormais dans les files que le cœur rejoue lui-même à chaque connexion et déconnexion : elle marche
// avec comme sans ce fichier.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('µ._mjs_formReset — sans le fichier du cycle de vie', function () {
  this.timeout(60000)
  let window: any
  let code = ''

  before(async () => {
    const root   = mjsTmp('form-reset-sans-cycle')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    // aucune rune de cycle de vie : rien ne demande mjs_lifecycle.ts, la remise à zéro est demandée par la sélection
    writeFileSync(join(srcDir, 'saisie-nue.mjs'), '<script>\n$x = 0\n</script>\n<span class="v">{$x}</span>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: ['form_reset'] } as any)
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('le build porte la remise à zéro et pas le cycle de vie (le cas visé)', () => {
    assert.ok(code.includes('µ._mjs_formReset = function'), 'remise à zéro embarquée')
    assert.equal(code.includes('_mjs_onAwake = function'), false, 'fichier du cycle de vie absent')
  })

  it('le module s\'inscrit sans lever, se remet à zéro avec son formulaire, et le suit quand il change de formulaire', async () => {
    const document = window.document
    document.body.innerHTML = '<form id="f1"><mjs-saisie-nue></mjs-saisie-nue></form><form id="f2"></form>'
    await pause()
    const el: any = document.querySelector('mjs-saisie-nue')
    let departs = 0
    let remises = 0
    window.µ._mjs_formReset(el, () => {
      departs++
      return () => { remises++ }
    })
    await pause()
    assert.equal(departs, 1, 'état de départ pris une fois, un cran après le montage')
    const reset = async (id: string) => {
      document.getElementById(id).dispatchEvent(new window.Event('reset'))
      await pause()
    }
    await reset('f1')
    assert.equal(remises, 1, 'le reset de son formulaire le remet à zéro')
    document.getElementById('f2').appendChild(el)
    await pause()
    await reset('f1')
    assert.equal(remises, 1, 'parti du premier formulaire, son reset ne le touche plus')
    await reset('f2')
    assert.equal(remises, 2, 'il suit le formulaire qu\'il vient de rejoindre')
    el.remove()
    await pause()
    await reset('f2')
    assert.equal(remises, 2, 'retiré de la page, il quitte son formulaire')
  })
})
