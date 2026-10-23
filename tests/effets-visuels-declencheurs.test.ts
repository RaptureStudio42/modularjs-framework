// Effets visuels — leurs déclencheurs et leurs minuteries, sur de vrais composants compilés chargés
// dans happy-dom : *glitch joue sa salve à la fin d'une action (on: success, on: error) ; *confetti
// garde chaque gerbe le temps de son vol (le filet d'une gerbe ne vide pas les suivantes) et part du
// milieu de la balise pour un clic venu du clavier (sans point) ; *attention(on: always) garde une
// pause entre deux appels même réglé à zéro ; *cycle démarre son relais quand le texte arrive après
// la pose et fait enfin deux mots.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { mesurer } from './helpers/mesure-balise.js'

const COMPOSANTS: Record<string, string> = {
  'fx-glitch-fin': '<button class="ok" *glitch(on: success, burst: 300ms)>Envoyer</button>\n<button class="ko" *glitch(on: error, burst: 300ms)>Envoyer</button>',
  'fx-gerbe':      '<button class="c" *confetti(count: 6)>Bravo</button>',
  'fx-appel-zero': '<button class="a" *attention(on: always, duration: 0s, every: 0s)>A</button>',
  'fx-relais-tard': '<script>\n$mot = ""\n</script>\n<span class="w" *cycle([applis], speed: 300ms, duration: 50ms)>{$mot}</span>\n<button class="b" @click={$mot = "sites"}>b</button>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets visuels — déclencheurs et minuteries', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-declencheurs')
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
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause()
    return comp._shadow.querySelector(sel)
  }

  const confettis = () => window.document.querySelectorAll('[mjs-fx-confetto]').length

  it('*glitch(on: success) et (on: error) : une salve à la fin de l\'action, tout de suite, qui dure `burst`', async () => {
    const ok = await monter('mjs-fx-glitch-fin', '.ok')
    const ko = ok.getRootNode().querySelector('.ko')
    assert.equal(ok.hasAttribute('mjs-fx-glitch-burst'), false, 'rien avant la fin de l\'action')
    window.µ._mjs_fxTell(ok, true, null)
    window.µ._mjs_fxTell(ko, false, null)
    await pause(60)
    assert.equal(ok.hasAttribute('mjs-fx-glitch-burst'), true, 'on: success : la salve part à la réussite')
    assert.equal(ko.hasAttribute('mjs-fx-glitch-burst'), true, 'on: error : la salve part à l\'échec')
    await attendre(() => !ok.hasAttribute('mjs-fx-glitch-burst') && !ko.hasAttribute('mjs-fx-glitch-burst'), 1500)
    assert.equal(ok.hasAttribute('mjs-fx-glitch-burst'), false, 'la salve s\'arrête au bout de burst')
  })

  it('*confetti : deux gerbes à 1,5 s d\'écart — le filet de la première ne vide pas la seconde', async () => {
    const c = await monter('mjs-fx-gerbe', '.c')
    c.click()
    assert.equal(confettis(), 6)
    await pause(1500)
    c.click()
    assert.equal(confettis(), 12, 'happy-dom ne joue pas l\'animation : la première gerbe attend son filet')
    await pause(700)
    assert.equal(confettis(), 6, 'à 2,2 s, seule la première gerbe est partie ; la seconde vole encore')
    await attendre(() => confettis() === 0, 2500)
    assert.equal(confettis(), 0, 'la seconde part à son tour, 2 s après elle')
  })

  it('*confetti : un clic venu du clavier (sans point) part du milieu de la balise, un clic de souris du point cliqué', async () => {
    const c = await monter('mjs-fx-gerbe', '.c')
    mesurer(window, c, () => ({ left: 100, top: 40, width: 80, height: 30, right: 180, bottom: 70, x: 100, y: 40 }))
    const depart = () => {
      const p = window.document.querySelector('[mjs-fx-confetto]')
      const d = p ? p.style.left + ' ' + p.style.top : 'aucun'
      window.document.querySelectorAll('[mjs-fx-confetto]').forEach((x: any) => x.remove())
      return d
    }
    c.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0, clientX: 0, clientY: 0 }))
    assert.equal(depart(), '140px 55px', 'Entrée ou Espace : le milieu de la balise, pas le coin de l\'écran')
    c.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1, clientX: 120, clientY: 50 }))
    assert.equal(depart(), '120px 50px', 'la souris : le point cliqué')
  })

  it('*attention(on: always) réglé à zéro (duration: 0s, every: 0s) : une pause gardée entre deux appels', async () => {
    const a = await monter('mjs-fx-appel-zero', '.a')
    // un appel = le jeton reposé (l'attribut revient, sans valeur d'avant)
    let appels = 0
    const mo = new window.MutationObserver((l: any[]) => {
      for (const m of l) if (m.oldValue === null) appels++
    })
    mo.observe(a, { attributes: true, attributeFilter: ['mjs-fx-play'], attributeOldValue: true })
    await pause(300)
    mo.disconnect()
    assert.ok(appels <= 5, `au plus un appel tous les 100 ms — vu : ${appels} appels en 300 ms`)
  })

  it('*cycle : balise vide à la pose, un seul mot dans `words` ; le texte arrive — le relais démarre', async () => {
    const w   = await monter('mjs-fx-relais-tard', '.w')
    const mot = () => w.querySelector('[mjs-fx-cycle-word]:not([mjs-fx-cycle-out])')?.textContent ?? ''
    assert.equal(mot(), 'applis', 'un seul mot : il reste affiché')
    w.getRootNode().querySelector('.b').click()
    await attendre(() => mot() === 'sites', 1000)
    assert.equal(mot(), 'sites', 'le texte arrivé devient le premier mot')
    await attendre(() => mot() === 'applis', 1500)
    assert.equal(mot(), 'applis', 'puis le relais passe au mot suivant')
  })
})
