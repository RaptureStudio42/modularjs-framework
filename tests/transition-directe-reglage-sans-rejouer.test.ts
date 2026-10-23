// Transition posée directement (`*fade(on: load, duration: $d)`) dont un réglage est tenu par une
// variable : le changer met l'animation à jour pour ses prochains jeux, sans rejouer l'entrée — la
// balise ne disparaît pas pour réapparaître à chaque changement. Le déclencheur (`on`, `once`,
// `range`, `zone`) changé, lui, repose l'effet.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fondu-reglable': "<script>\n$d = '300ms'\n$o = 'load'\n</script>\n<p class=\"f\" *fade(on: $o, duration: $d)>fondu</p>\n<button class=\"lent\" @click={$d = '900ms'}>l</button>\n<button class=\"vue\" @click={$o = 'view'}>v</button>",
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('transition posée directement : un réglage changé ne rejoue pas l\'entrée', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any
  const anims: any[] = []

  before(async () => {
    const root   = mjsTmp('transition-reglable')
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
    window.Element.prototype.animate = function (keyframes: any, opts: any) {
      let fin: any
      const a: any = { el: this, keyframes, opts, finished: new Promise((r) => { fin = r }), cancel() { fin(a) }, pause() {}, play() {}, finish() { fin(a) }, effect: { getComputedTiming: () => ({ progress: 1 }) } }
      anims.push(a)
      setTimeout(() => fin(a), 5)
      return a
    }
    // un observateur qui ne voit rien : la balise attend l'écran, cachée
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    if (animateAvant === undefined) delete window?.Element?.prototype?.animate
    else if (window) window.Element.prototype.animate = animateAvant
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // les entrées jouées sur la balise (hors tenue de départ, deux images seulement)
  const entrees = (el: any) => anims.filter((a) => a.el === el && a.keyframes.length > 2)

  it('duration: $d changé après l\'entrée : pas de nouvelle entrée ; on: $o changé : l\'effet repart', async () => {
    window.document.body.innerHTML = '<mjs-fondu-reglable></mjs-fondu-reglable>'
    const comp = window.document.querySelector('mjs-fondu-reglable')
    await attendre(() => !!comp._shadow?.querySelector('.f') && entrees(comp._shadow.querySelector('.f')).length > 0)
    const f = comp._shadow.querySelector('.f')
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(entrees(f).length, 1, 'une entrée à l\'apparition')
    comp._shadow.querySelector('.lent').click()
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(entrees(f).length, 1, 'le réglage changé ne rejoue pas l\'entrée')
    assert.equal(f._mjs_fxOff.fade._s.duration, '900ms', 'le nouveau réglage est retenu')
    const avant = f._mjs_fxOff.fade
    comp._shadow.querySelector('.vue').click()
    await attendre(() => f._mjs_fxOff?.fade !== avant)
    assert.equal(f._mjs_fxOff.fade !== avant, true, 'le déclencheur changé : l\'effet est reposé')
  })
})
