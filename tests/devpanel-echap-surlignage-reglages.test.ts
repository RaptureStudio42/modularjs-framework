// mjs_devpanel — trois gênes du panneau pour l'application qu'il inspecte :
//   - Échap n'importe où dans la page fermait le panneau et prenait la touche (une modale, un menu de
//     l'appli ne se fermaient plus) : seule une Échap venue du panneau, ou pendant une visée, compte ;
//   - « mises à jour » éclairait ses propres écritures — le calque de surlignage ajouté à la page ;
//   - un réglage changé laissait le focus dans son champ, et le panneau figé tant qu'il y restait ;
//   - la réécriture périodique remplaçait le bouton sous le pointeur entre l'appui et le relâcher : le
//     clic était perdu — elle attend maintenant que le bouton du pointeur soit relâché.
// happy-dom n'a pas d'Element.animate : un faux compte les éclairs.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

describe('mjs_devpanel — Échap, surlignage et réglages', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any
  const eclairs: any[] = []

  before(async () => {
    const root   = mjsTmp('devpanel-echap')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'dp-page.mjs'), '<script>\n$n = 1\n</script>\n<p class="t">{$n}</p>\n<button class="b">b</button>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${lire(files.find((f) => /^mjs_core-/.test(f))!)}\nglobalThis.µ = µ;`)
    window.eval(lire(files.find((f) => /^dp-page-[0-9a-z]{5}\.js$/.test(f))!))
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
  const echap  = (el: any) => {
    const ev = new window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, composed: true, cancelable: true })
    el.dispatchEvent(ev)
    return ev.defaultPrevented
  }

  const monter = async () => {
    window.document.body.innerHTML = '<mjs-dp-page></mjs-dp-page>'
    const comp = window.document.querySelector('mjs-dp-page')
    await attendre(() => !!comp._shadow?.querySelector('.t'))
    return comp
  }

  it('Échap dans la page : le panneau reste ouvert et la touche reste à l\'application', async () => {
    const comp = await monter()
    window.µ.console(true)
    const prise = echap(comp._shadow.querySelector('.b'))
    assert.ok(racine(), 'le panneau reste ouvert')
    assert.equal(prise, false, 'la touche n\'est pas prise')
    window.µ.console(false)
  })

  it('Échap dans le panneau : il se ferme', async () => {
    await monter()
    window.µ.console(true)
    const prise = echap(racine().querySelector('[data-action="refresh"]'))
    assert.ok(racine() === undefined, 'fermé')
    assert.equal(prise, true)
  })

  it('mises à jour : survoler une ligne de l\'arbre n\'éclaire ni la page ni le calque de surlignage', async () => {
    await monter()
    window.µ.console(true)
    if (racine().querySelector('[data-action="maj"]').getAttribute('aria-pressed') !== 'true') clic(racine().querySelector('[data-action="maj"]'))
    await pause(80)
    eclairs.length = 0
    const ligne = racine().querySelector('.arbre .ligne:not(.ligne-stores):not(.ligne-effets)')
    ligne.dispatchEvent(new window.MouseEvent('mouseenter'))
    await pause(80)
    ligne.dispatchEvent(new window.MouseEvent('mouseleave'))
    await pause(80)
    const touches = eclairs.map((e) => e.el.tagName + (e.el.hasAttribute('data-mjs-devpanel-highlight') ? '[calque]' : ''))
    assert.deepEqual(touches, [])
    clic(racine().querySelector('[data-action="maj"]'))
    window.µ.console(false)
  })

  it('un bouton du pointeur enfoncé dans le panneau : pas de réécriture avant le relâcher', async () => {
    await monter()
    window.µ.console(true)
    await pause(50)
    const b = racine().querySelector('[data-action="refresh"]')
    b.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0 }))
    await pause(900)
    assert.equal(racine().contains(b), true, 'le bouton sous le pointeur est toujours là')
    b.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, composed: true, button: 0 }))
    await pause(900)
    assert.equal(racine().contains(b), false, 'relâché : le rafraîchissement reprend')
    window.µ.console(false)
  })

  it('un réglage changé : le panneau se redessine et reprend ses rafraîchissements', async () => {
    await monter()
    window.µ.console(true)
    if (racine().querySelector('[data-action="maj"]').getAttribute('aria-pressed') !== 'true') clic(racine().querySelector('[data-action="maj"]'))
    await attendre(() => !!racine().querySelector('[data-maj="duration"]'))
    const champ = racine().querySelector('[data-maj="duration"]')
    champ.focus()
    champ.value = '800'
    champ.dispatchEvent(new window.Event('change', { bubbles: true }))
    // un composant de plus dans la page : le compte du bandeau doit suivre au tour suivant
    window.document.body.appendChild(window.document.createElement('mjs-dp-page'))
    await pause(900)
    assert.match(racine().querySelector('.compte').textContent, /^2 composants/)
    clic(racine().querySelector('[data-action="maj"]'))
    window.µ.console(false)
  })
})
