// *goo(merge, halo) et *offline(veil) réglés par une variable : le réglage est suivi, pas seulement lu
// à la pose. À halo 0, les formes ne se soudent qu'au contact (pas de halo) : la variable qui passe à 0
// puis revient les suit. Au voile 0 (aucun voile), la zone n'est pas grisée : la variable qui passe à 0
// ôte le voile qui était là, et qui revient à une valeur le remet, derrière le bandeau. De vrais
// composants compilés, chargés dans happy-dom : on lit les attributs et les nœuds posés, la géométrie
// n'est pas en jeu.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mjsTmp } from './helpers/tmp.js'

const FORMES = '<b>un</b><b>deux</b>'

const COMPOSANTS: Record<string, string> = {
  'hv-halo':      `<script>\n$h = 50\n</script>\n<div class="m" *goo(merge, halo: $h)>${FORMES}</div>\n<button class="nul" @click={$h = 0}>n</button>\n<button class="large" @click={$h = 80}>l</button>`,
  'hv-halo-nul':  `<script>\n$h = 0\n</script>\n<div class="m" *goo(merge, halo: $h)>${FORMES}</div>\n<button class="large" @click={$h = 30}>l</button>`,
  'hv-voile':     '<script>\n$v = 0.8\n</script>\n<section class="z" *offline(delay: 0s, veil: $v)><p>zone</p></section>\n<button class="nul" @click={$v = 0}>n</button>\n<button class="gris" @click={$v = 0.6}>g</button>',
  'hv-voile-nul': '<script>\n$v = 0\n</script>\n<section class="z" *offline(delay: 0s, veil: $v)><p>zone</p></section>\n<button class="gris" @click={$v = 0.6}>g</button>'
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('*goo(halo) et *offline(veil) réglés par une variable — suivis, pas seulement lus à la pose', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-goo-halo-offline-voile')
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

  // le réseau coupé, puis rétabli, tel que le voit la page
  const reseau = (en: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => en, configurable: true })
    window.dispatchEvent(new window.Event(en ? 'online' : 'offline'))
  }

  afterEach(() => {
    reseau(true)
    window.document.body.innerHTML = ''
  })

  const halo = (m: any) => m.style.getPropertyValue('--mjs-goo-halo')
  const voile = (z: any) => z.style.getPropertyValue('--mjs-offline-veil')

  it('*goo(merge, halo: $h) : la variable à 0 ne soude plus qu\'au contact (pas de halo), remise à 80 le halo revient', async () => {
    const m = await monter('mjs-hv-halo', '.m')
    assert.equal(m.hasAttribute('mjs-fx-goo-bare'), false, 'halo 50 : les formes portent leur halo')
    m.getRootNode().querySelector('.nul').click()
    await attendre(() => halo(m) === '0px')
    assert.equal(halo(m), '0px', 'la variable CSS suit')
    assert.equal(m.hasAttribute('mjs-fx-goo-bare'), true, 'halo 0 : plus de halo, les formes ne se soudent qu\'au contact')
    m.getRootNode().querySelector('.large').click()
    await attendre(() => halo(m) === '80px')
    assert.equal(halo(m), '80px', 'la variable CSS suit')
    assert.equal(m.hasAttribute('mjs-fx-goo-bare'), false, 'halo 80 : le halo revient')
  })

  it('*goo(merge, halo: $h) posé à 0 : la variable remontée à 30 donne un halo aux formes', async () => {
    const m = await monter('mjs-hv-halo-nul', '.m')
    assert.equal(m.hasAttribute('mjs-fx-goo-bare'), true, 'halo 0 à la pose : au contact seulement')
    m.getRootNode().querySelector('.large').click()
    await attendre(() => halo(m) === '30px')
    assert.equal(halo(m), '30px', 'la variable CSS suit')
    assert.equal(m.hasAttribute('mjs-fx-goo-bare'), false, 'halo 30 : le halo vient')
  })

  it('*offline(veil: $v) : la variable à 0 ôte le voile, remise à 0.6 elle le rend, derrière le bandeau', async () => {
    const z = await monter('mjs-hv-voile', '.z')
    window.µ._mjs_sockets = {}
    reseau(false)
    await attendre(() => !!z.querySelector('[mjs-fx-offline-band][mjs-fx-offline-in]'))
    assert.ok(z.querySelector('[mjs-fx-offline-veil][mjs-fx-offline-in]'), 'voile 0.8 : la zone se voile')
    z.getRootNode().querySelector('.nul').click()
    await attendre(() => voile(z) === '0')
    assert.equal(voile(z), '0', 'la variable CSS suit')
    assertAbsent(z.querySelector('[mjs-fx-offline-veil]'), 'voile 0 : plus de voile')
    assert.ok(z.querySelector('[mjs-fx-offline-band][mjs-fx-offline-in]'), 'le bandeau reste')
    z.getRootNode().querySelector('.gris').click()
    await attendre(() => voile(z) === '0.6')
    assert.equal(voile(z), '0.6', 'la variable CSS suit')
    const calque = z.querySelector('[mjs-fx-offline-veil]')
    assert.ok(calque, 'voile 0.6 : le voile revient')
    assert.ok(calque.hasAttribute('mjs-fx-offline-in'), 'il se montre')
    assert.ok(calque.nextElementSibling === z.querySelector('[mjs-fx-offline-band]'), 'derrière le bandeau, comme à la pose : le bandeau n\'est pas grisé')
    reseau(true)
    await attendre(() => !z.querySelector('[mjs-fx-offline-band]'), 2000)
    assertAbsent(z.querySelector('[mjs-fx-offline-veil]'), 'réseau rétabli : le voile part aussi')
  })

  it('*offline(veil: $v) posé à 0 : aucun voile à la coupure ; la variable à 0.6 pendant la coupure le pose', async () => {
    const z = await monter('mjs-hv-voile-nul', '.z')
    window.µ._mjs_sockets = {}
    reseau(false)
    await attendre(() => !!z.querySelector('[mjs-fx-offline-band][mjs-fx-offline-in]'))
    assertAbsent(z.querySelector('[mjs-fx-offline-veil]'), 'voile 0 à la pose : aucun voile')
    z.getRootNode().querySelector('.gris').click()
    await attendre(() => !!z.querySelector('[mjs-fx-offline-veil]'), 1000)
    const calque = z.querySelector('[mjs-fx-offline-veil]')
    assert.ok(calque, 'voile 0.6 : le voile vient')
    assert.ok(calque.hasAttribute('mjs-fx-offline-in'), 'il se montre')
    assert.ok(calque.nextElementSibling === z.querySelector('[mjs-fx-offline-band]'), 'derrière le bandeau')
  })

  it('*offline(veil: $v) : la variable mise à 0 avant la coupure, la coupure ne pose aucun voile', async () => {
    const z = await monter('mjs-hv-voile', '.z')
    window.µ._mjs_sockets = {}
    z.getRootNode().querySelector('.nul').click()
    await attendre(() => voile(z) === '0')
    assert.equal(voile(z), '0', 'la variable CSS suit')
    reseau(false)
    await attendre(() => !!z.querySelector('[mjs-fx-offline-band][mjs-fx-offline-in]'))
    assertAbsent(z.querySelector('[mjs-fx-offline-veil]'), 'voile 0 avant la coupure : aucun voile')
  })
})
