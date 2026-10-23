// mjs_devpanel — « mises à jour » joué par un autre effet que *flash : l'effet posé par le panneau
// écrit dans le style de la balise, et son retrait l'efface ; ces écritures-là ne sont pas des mises
// à jour de MJS — les compter relançait l'effet à chaque retrait, sans fin. Même chose pour les
// calques qu'un effet glisse dans une balise puis retire.
// happy-dom n'a pas d'Element.animate : un faux compte les éclairs.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

const SOURCE = [
  '<script>',
  '$n = 1',
  '</script>',
  '<p class="t">Total : {$n}</p>',
  '<b class="fixe">fixe</b>',
  '<i class="p" *pulse>p</i>',
  '<button class="plus" @click={$n++}>+</button>',
].join('\n')

describe('mjs_devpanel — mises à jour : l\'effet du panneau ne se relance pas lui-même', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any
  const eclairs: any[] = []

  before(async () => {
    const root   = mjsTmp('devpanel-maj-une-fois')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'maj-boucle.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${lire(files.find((f) => /^mjs_core-/.test(f))!)}\nglobalThis.µ = µ;`)
    for (const f of files.filter((f) => /^mjs_fx_[a-z_]+-[0-9a-z]{5}\.js$/.test(f))) window.eval(lire(f))
    window.eval(lire(files.find((f) => /^maj-boucle-[0-9a-z]{5}\.js$/.test(f))!))
    animateAvant = window.Element.prototype.animate
    window.Element.prototype.animate = function(kf: any, o: any) {
      eclairs.push({ el: this, kf, o })
      return { cancel() {}, finished: Promise.resolve(), onfinish: null }
    }
  })

  after(async () => {
    // happy-dom partage la classe Element entre ses fenêtres : rendre `animate` aux fichiers suivants
    if (animateAvant === undefined) delete window.Element.prototype.animate
    else window.Element.prototype.animate = animateAvant
    if (window?.µ?.console) window.µ.console(false)
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const racine = () => window.document.querySelector('[data-mjs-devpanel]')?.shadowRoot
  const clic   = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const regler = (cle: string, valeur: string) => {
    const el = racine().querySelector(`[data-maj="${cle}"]`)
    el.value = valeur
    el.dispatchEvent(new window.Event('change', { bubbles: true }))
  }

  const monter = async () => {
    window.document.body.innerHTML = '<mjs-maj-boucle></mjs-maj-boucle>'
    const comp = window.document.querySelector('mjs-maj-boucle')
    await attendre(() => !!comp._shadow?.querySelector('.t'))
    window.µ.console()
    await attendre(() => !!racine()?.querySelector('[data-action="maj"]'))
    if (racine().querySelector('[data-action="maj"]').getAttribute('aria-pressed') !== 'true') clic(racine().querySelector('[data-action="maj"]'))
    await attendre(() => !!racine().querySelector('[data-maj="color"]'))
    return comp._shadow
  }

  it('*pulse à la place de l\'éclair : une mise à jour, l\'effet posé une seule fois (panneau fermé compris)', async () => {
    const sh = await monter()
    regler('duration', '100')
    regler('fx', 'pulse')
    await pause(30)
    const t      = sh.querySelector('.t')
    const poses: number[] = []
    const orig   = window.µ._mjs_fx
    const depart = Date.now()
    window.µ._mjs_fx = function(this: any, comp: any, el: any, name: string, ...rest: any[]) {
      if (el === t) poses.push(Date.now() - depart)
      return orig.call(this, comp, el, name, ...rest)
    }
    try {
      window.µ.console(false)
      clic(sh.querySelector('.plus'))
      await pause(1800)
      assert.equal(poses.length, 1, `poses de *pulse (ms depuis le clic) : ${JSON.stringify(poses)}`)
      // une vraie mise à jour suivante, elle, compte toujours
      clic(sh.querySelector('.plus'))
      await attendre(() => poses.length > 1)
      assert.equal(poses.length, 2)
    }
    finally {
      window.µ._mjs_fx = orig
      window.µ.console()
      await attendre(() => !!racine()?.querySelector('[data-maj="fx"]'))
      regler('fx', 'flash')
      regler('duration', '600')
      window.µ.console(false)
    }
  })

  it('un calque d\'effet glissé dans une balise puis retiré ne l\'éclaire pas', async () => {
    const sh = await monter()
    window.µ.console(false)
    // le mode déjà coché, la racine d'un composant neuf n'est suivie qu'au tour suivant (1 s)
    await pause(1100)
    const fixe = sh.querySelector('.fixe')
    // témoin : un vrai changement de la balise l'éclaire
    eclairs.length = 0
    fixe.appendChild(window.document.createTextNode('!'))
    await attendre(() => eclairs.some((e) => e.el === fixe))
    assert.ok(eclairs.some((e) => e.el === fixe), 'préalable : la balise est suivie')
    await pause(60)
    eclairs.length = 0
    const calque = window.document.createElement('span')
    calque.setAttribute('mjs-fx-layer', 'essai')
    fixe.appendChild(calque)
    await pause(80)
    calque.remove()
    await pause(80)
    assert.equal(eclairs.filter((e) => e.el === fixe).length, 0)
    fixe.appendChild(window.document.createTextNode('!'))
    await attendre(() => eclairs.some((e) => e.el === fixe))
    assert.ok(eclairs.some((e) => e.el === fixe), 'un vrai changement suivant compte toujours')
  })
})
