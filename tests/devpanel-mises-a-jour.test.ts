// mjs_devpanel — « mises à jour » : chaque morceau de la page que MJS réécrit (un texte, un attribut)
// s'éclaire un instant, par l'effet choisi (*flash par défaut), sa couleur, sa durée, son style ; ce
// qui ne change pas reste sombre. Le mode tient panneau fermé, jusqu'à ce qu'on le coupe.
// happy-dom n'a pas d'Element.animate : un faux compte les éclairs.
//
// Pipeline RÉEL (Bundler → cœur de développement + composant compilé, monté dans happy-dom).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = [
  '<script>',
  '$n = 1',
  "$c = 'a'",
  '</script>',
  '<p class="t">Total : {$n}</p>',
  '<span class="k" data-etat={$c}>k</span>',
  '<b class="fixe">fixe</b>',
  '<i class="p" *pulse>p</i>',
  '<button class="plus" @click={$n++}>+</button>',
  "<button class=\"cls\" @click={$c = 'b'}>c</button>",
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('mjs_devpanel — montrer les mises à jour', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any
  const eclairs: any[] = []

  before(async () => {
    const root   = mjsTmp('devpanel-maj')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'maj-carte.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${lire(files.find((f) => /^mjs_core-/.test(f))!)}\nglobalThis.µ = µ;`)
    // les fichiers des effets, importés par les composants qui les écrivent
    for (const f of files.filter((f) => /^mjs_fx_[a-z_]+-[0-9a-z]{5}\.js$/.test(f))) window.eval(lire(f))
    window.eval(lire(files.find((f) => /^maj-carte-[0-9a-z]{5}\.js$/.test(f))!))
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

  it('coché : le texte réécrit et l\'attribut réécrit s\'éclairent, pas le reste ; panneau fermé, ça continue ; décoché, plus rien', async () => {
    window.document.body.innerHTML = '<mjs-maj-carte></mjs-maj-carte>'
    const comp = window.document.querySelector('mjs-maj-carte')
    await attendre(() => !!comp._shadow?.querySelector('.t'))
    const sh = comp._shadow
    window.µ.console()
    await attendre(() => !!racine()?.querySelector('[data-action="maj"]'))
    clic(racine().querySelector('[data-action="maj"]'))
    await attendre(() => !!racine().querySelector('[data-maj="color"]'))
    await new Promise((r) => setTimeout(r, 50))
    eclairs.length = 0
    clic(sh.querySelector('.plus'))
    await attendre(() => eclairs.some((e) => e.el === sh.querySelector('.t')))
    assert.ok(eclairs.some((e) => e.el === sh.querySelector('.t')), 'le texte réécrit')
    assert.ok(!eclairs.some((e) => e.el === sh.querySelector('.fixe')), 'ce qui ne change pas reste sombre')
    clic(sh.querySelector('.cls'))
    await attendre(() => eclairs.some((e) => e.el === sh.querySelector('.k')))
    assert.ok(eclairs.some((e) => e.el === sh.querySelector('.k')), 'l\'attribut réécrit')
    // panneau fermé
    window.µ.console(false)
    eclairs.length = 0
    clic(sh.querySelector('.plus'))
    await attendre(() => eclairs.some((e) => e.el === sh.querySelector('.t')))
    assert.ok(eclairs.some((e) => e.el === sh.querySelector('.t')), 'le mode tient, panneau fermé')
    // décoché
    window.µ.console()
    await attendre(() => !!racine()?.querySelector('[data-action="maj"]'))
    clic(racine().querySelector('[data-action="maj"]'))
    await new Promise((r) => setTimeout(r, 50))
    eclairs.length = 0
    clic(sh.querySelector('.plus'))
    await new Promise((r) => setTimeout(r, 120))
    assert.equal(eclairs.filter((e) => e.el === sh.querySelector('.t')).length, 0, 'décoché : plus rien')
  })

  it('réglé : la couleur, la durée, le style de l\'éclair ; un autre effet de l\'appli à la place', async () => {
    window.document.body.innerHTML = '<mjs-maj-carte></mjs-maj-carte>'
    const comp = window.document.querySelector('mjs-maj-carte')
    await attendre(() => !!comp._shadow?.querySelector('.t'))
    const sh = comp._shadow
    window.µ.console()
    await attendre(() => !!racine()?.querySelector('[data-action="maj"]'))
    if (!racine().querySelector('[data-maj="color"]')) clic(racine().querySelector('[data-action="maj"]'))
    await attendre(() => !!racine().querySelector('[data-maj="color"]'))
    regler('color', '#ff00ff')
    regler('duration', '900')
    regler('style', 'glow')
    await new Promise((r) => setTimeout(r, 30))
    eclairs.length = 0
    clic(sh.querySelector('.plus'))
    await attendre(() => eclairs.some((e) => e.el === sh.querySelector('.t')))
    const e = eclairs.find((x) => x.el === sh.querySelector('.t'))
    assert.match(JSON.stringify(e.kf), /#ff00ff/)
    assert.match(JSON.stringify(e.kf), /boxShadow/, 'style glow : un halo')
    assert.equal(e.o.duration, 900)
    // un autre effet : *pulse, écrit dans l'appli (son fichier est connu)
    const choix = Array.from(racine().querySelector('[data-maj="fx"]').options as ArrayLike<any>).map((o: any) => o.value)
    assert.ok(choix.includes('flash') && choix.includes('pulse'), `les effets proposés : ${choix}`)
    regler('fx', 'pulse')
    await new Promise((r) => setTimeout(r, 30))
    clic(sh.querySelector('.plus'))
    await attendre(() => (sh.querySelector('.t').getAttribute('mjs-fx') || '').includes('pulse'))
    assert.ok((sh.querySelector('.t').getAttribute('mjs-fx') || '').includes('pulse'), 'le texte réécrit joue *pulse')
    regler('fx', 'flash')
    window.µ.console(false)
  })
})
