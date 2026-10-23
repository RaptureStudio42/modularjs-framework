// Effets visuels — un réglage tenu par une variable, suivi en variable CSS ET dans la copie que l'effet
// en garde pour ses minuteries (le moteur prévient l'effet par son `set`) : de vrais composants
// compilés, chargés dans happy-dom. La durée de *annotate règle aussi la fin du tracé ; celle de
// *attention, la pause entre deux appels ; celle de *cycle, le départ de l'ancien mot ; le diamètre de
// *filter.lens, la zone où la loupe se montre ; la durée de *delta, celle de son compte.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { mesurer } from './helpers/mesure-balise.js'
import { assertAbsent } from './helpers/dom-assert.js'

const COMPOSANTS: Record<string, string> = {
  'fx-trait-var':  '<script>\n$d = "200ms"\n</script>\n<span class="a" *annotate(on: click, duration: $d)>mot</span>\n<button class="lent" @click={$d = "2s"}>b</button>',
  'fx-appel-var':  '<script>\n$d = "100ms"\n</script>\n<button class="a" *attention(on: always, duration: $d, every: 100ms)>A</button>\n<button class="lent" @click={$d = "1s"}>b</button>',
  'fx-relais-var': '<script>\n$d = "50ms"\n</script>\n<span class="w" *cycle([sites, applis], speed: 300ms, duration: $d)>logos</span>\n<button class="lent" @click={$d = "1s"}>b</button>',
  'fx-loupe-var':  '<script>\n$d = 100\n</script>\n<p class="l" *filter.lens(spot: $d)>Un texte flou</p>\n<button class="large" @click={$d = 600}>b</button>',
  'fx-ecart-var':  '<script>\n$d = "1s"\n$n = 10\n</script>\n<span class="n" *delta(duration: $d)>{$n}</span>\n<button class="vite" @click={$d = "100ms"}>b</button>\n<button class="plus" @click={$n = 20}>b</button>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets visuels — un réglage suivi par une variable, jusque dans les minuteries de l\'effet', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-reglages-suivis')
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

  it('*annotate(duration: $d) : la durée changée règle aussi la fin du tracé (le tracé n\'est pas fini d\'un coup)', async () => {
    const a = await monter('mjs-fx-trait-var', '.a')
    a.getRootNode().querySelector('.lent').click()
    await attendre(() => a.style.getPropertyValue('--mjs-annotate-duration') === '2s')
    assert.equal(a.style.getPropertyValue('--mjs-annotate-duration'), '2s', 'la variable CSS suit')
    a.click()
    await pause(600)
    assert.equal(a.hasAttribute('mjs-fx-annotate-done'), false, 'à 600 ms d\'un tracé de 2 s, il n\'est pas encore fini')
    await attendre(() => a.hasAttribute('mjs-fx-annotate-done'), 2500)
    assert.equal(a.hasAttribute('mjs-fx-annotate-done'), true, 'puis fini, au bout des 2 s')
  })

  it('*attention(on: always, duration: $d) : la durée changée allonge le tour (appel + pause)', async () => {
    const a = await monter('mjs-fx-appel-var', '.a')
    let appels = 0
    const mo = new window.MutationObserver((l: any[]) => {
      for (const m of l) if (m.oldValue === null) appels++
    })
    mo.observe(a, { attributes: true, attributeFilter: ['mjs-fx-play'], attributeOldValue: true })
    await pause(450)
    assert.ok(appels >= 1, `un tour de 200 ms : des appels — vu : ${appels}`)
    a.getRootNode().querySelector('.lent').click()
    await attendre(() => a.style.getPropertyValue('--mjs-attention-duration') === '1s')
    appels = 0
    await pause(700)
    mo.disconnect()
    assert.equal(appels, 0, 'un appel d\'une seconde, puis la pause : aucun nouvel appel dans les 700 ms qui suivent')
  })

  it('*cycle(duration: $d) : la durée changée garde l\'ancien mot le temps du nouveau relais', async () => {
    const w        = await monter('mjs-fx-relais-var', '.w')
    const sortants = () => Array.from(w.querySelectorAll('[mjs-fx-cycle-out]'))
    w.getRootNode().querySelector('.lent').click()
    await attendre(() => w.style.getPropertyValue('--mjs-cycle-duration') === '1s')
    assert.equal(w.style.getPropertyValue('--mjs-cycle-duration'), '1s', 'la variable CSS suit')
    // le mot qui part au premier relais d'après le changement (ceux d'avant partaient en 100 ms) : c'est lui
    // qu'on suit, jamais un autre — la phase du relais ne joue plus
    const avant = sortants()
    await attendre(() => sortants().some((m) => !avant.includes(m)), 1500)
    const vieux = sortants().find((m) => !avant.includes(m))
    assert.ok(vieux, 'un relais a lieu après le changement')
    const depart = Date.now()
    await pause(250)
    assert.ok(sortants().includes(vieux), 'à 250 ms d\'un relais d\'une seconde, l\'ancien mot part encore')
    await attendre(() => !sortants().includes(vieux), 2500)
    assert.ok(!sortants().includes(vieux), 'puis il est retiré')
    assert.ok(Date.now() - depart >= 700, `il part au bout de la nouvelle durée, pas avant : retiré à ${Date.now() - depart} ms`)
  })

  it('*filter.lens(spot: $d) : le diamètre changé agrandit aussi la zone où la loupe se montre', async () => {
    const l    = await monter('mjs-fx-loupe-var', '.l')
    const zone = () => l.getRootNode().querySelector('[mjs-fx-filter-lens]')
    // happy-dom ne met rien en page : la balise reçoit une boîte de 100 × 20 en (0, 0) ; le pointeur à 200 px à sa gauche, hors d'une zone de
    // 100 px de diamètre
    mesurer(window, l, () => ({ left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0 }))
    window.document.dispatchEvent(new window.PointerEvent('pointermove', { clientX: -200, clientY: 0 }))
    await pause(60)
    assertAbsent(zone(), 'hors de la zone de 100 px')
    l.getRootNode().querySelector('.large').click()
    await pause(30)
    window.document.dispatchEvent(new window.PointerEvent('pointermove', { clientX: -201, clientY: 0 }))
    await attendre(() => !!zone(), 500)
    assert.ok(zone(), 'à 200 px de la balise, dans une zone de 600 px de diamètre')
    assert.equal(zone().style.getPropertyValue('--mjs-fx-filter-d'), '600px', 'la zone a la taille neuve')
  })

  it('*delta(duration: $d) : la durée changée règle aussi le compte, pas seulement le clignotement', async () => {
    const n   = await monter('mjs-fx-ecart-var', '.n')
    const vu  = () => n.querySelector('[mjs-fx-delta-val]')?.textContent ?? ''
    const btn = (c: string) => n.getRootNode().querySelector(c)
    assert.equal(vu(), '10')
    btn('.vite').click()
    await attendre(() => n.style.getPropertyValue('--mjs-delta-duration') === '100ms')
    assert.equal(n.style.getPropertyValue('--mjs-delta-duration'), '100ms', 'la variable CSS suit')
    btn('.plus').click()
    await pause(400)
    assert.equal(vu(), '20', 'un compte de 100 ms : fini à 400 ms')
  })
})
