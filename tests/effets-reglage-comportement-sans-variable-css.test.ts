// Un réglage de COMPORTEMENT tenu par une variable (`*fade(on: load, duration: $d)` : sa durée n'est pas
// une variable CSS) se suit sur place par le `set` de l'effet, sans variable CSS ni relance : changer
// `$d` n'écrit aucune propriété `--mjs-fade-duration` sur la balise — surtout pas une valeur « undefined »
// (la durée suivie d'une unité absente). Un réglage visuel, lui, écrit sa variable CSS, la valeur juste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'reglage-suivi': "<script>\n$d = '300ms'\n$c = '#ff0000'\n</script>\n<p class=\"f\" *fade(on: load, duration: $d)>fondu</p>\n<h2 class=\"n\" *neon($c)>lueur</h2>\n<button class=\"lent\" @click={$d = '900ms'}>l</button>\n<button class=\"vide\" @click={$d = undefined}>v</button>\n<button class=\"bleu\" @click={$c = '#0000ff'}>b</button>",
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('réglage de comportement suivi sur place : aucune variable CSS « undefined »', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any

  before(async () => {
    const root   = mjsTmp('reglage-comportement-sans-variable')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    animateAvant = window.Element.prototype.animate
    window.Element.prototype.animate = function () {
      let fin: any
      const a: any = { el: this, finished: new Promise((r) => { fin = r }), cancel() { fin(a) }, pause() {}, play() {}, finish() { fin(a) }, effect: { getComputedTiming: () => ({ progress: 1 }) } }
      setTimeout(() => fin(a), 5)
      return a
    }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    if (animateAvant === undefined) delete window?.Element?.prototype?.animate
    else if (window) window.Element.prototype.animate = animateAvant
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter() {
    window.document.body.innerHTML = '<mjs-reglage-suivi></mjs-reglage-suivi>'
    const comp = window.document.querySelector('mjs-reglage-suivi')
    await attendre(() => !!comp._shadow?.querySelector('.f[mjs-fx]') && !!comp._shadow?.querySelector('.n[mjs-fx]'))
    await new Promise((r) => setTimeout(r, 30))
    return comp
  }

  it('durée suivie sur place : retenue par l\'effet, aucune propriété --mjs-fade-duration, aucun « undefined »', async () => {
    const comp = await monter()
    const f = comp._shadow.querySelector('.f')
    assert.equal(f.style.getPropertyValue('--mjs-fade-duration'), '', 'rien avant')
    comp._shadow.querySelector('.lent').click()
    await attendre(() => f._mjs_fxOff?.fade?._s.duration === '900ms')
    assert.equal(f._mjs_fxOff.fade._s.duration, '900ms', 'le réglage est retenu')
    assert.equal(f.style.getPropertyValue('--mjs-fade-duration'), '', 'pas de variable CSS pour un réglage de comportement')
    assert.equal(f.style.cssText.includes('undefined'), false, 'aucune valeur « undefined » : ' + f.style.cssText)
  })

  it('durée effacée (undefined) : toujours aucune variable CSS', async () => {
    const comp = await monter()
    const f = comp._shadow.querySelector('.f')
    comp._shadow.querySelector('.vide').click()
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(f.style.getPropertyValue('--mjs-fade-duration'), '')
    assert.equal(f.style.cssText.includes('undefined'), false, f.style.cssText)
  })

  it('réglage visuel (couleur de *neon) : sa variable CSS suit, avec la valeur juste', async () => {
    const comp = await monter()
    const n = comp._shadow.querySelector('.n')
    assert.equal(n.style.getPropertyValue('--mjs-neon-color').trim(), '#ff0000')
    comp._shadow.querySelector('.bleu').click()
    await attendre(() => n.style.getPropertyValue('--mjs-neon-color').trim() === '#0000ff')
    assert.equal(n.style.getPropertyValue('--mjs-neon-color').trim(), '#0000ff')
    assert.equal(n.style.cssText.includes('undefined'), false, n.style.cssText)
  })
})
