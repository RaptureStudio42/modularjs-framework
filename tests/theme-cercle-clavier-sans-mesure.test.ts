// Thème en cercle au clavier : Entrée ou Espace retient l'élément actif, qui n'est mesuré que si le
// thème bascule vraiment — taper des espaces dans un champ ne force plus une mise en page à chaque
// frappe. La bascule par Entrée part toujours du centre de l'élément actif.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'theme-clavier': '<input class="champ" aria-label="texte">\n<button class="nuit" @click={µtheme = \'dark\'}>🌙</button>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('thème en cercle au clavier : mesuré seulement à la bascule', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('theme-clavier')
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

  async function monter() {
    window.document.body.innerHTML = '<mjs-theme-clavier></mjs-theme-clavier>'
    const comp = window.document.querySelector('mjs-theme-clavier')
    await attendre(() => !!comp._shadow?.querySelector('.nuit'))
    await new Promise((r) => setTimeout(r, 20))
    return comp
  }

  const touche = (el: any, key: string) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, composed: true }))

  it('dix espaces tapés dans un champ : aucune mesure', async () => {
    const comp  = await monter()
    const champ = comp._shadow.querySelector('.champ')
    let mesures = 0
    champ.getBoundingClientRect = () => { mesures++; return { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0 } }
    champ.focus()
    for (let i = 0; i < 10; i++) touche(champ, ' ')
    assert.equal(mesures, 0)
  })

  it('Entrée sur le bouton qui bascule le thème : le cercle part de son centre', async () => {
    const comp = await monter()
    const nuit = comp._shadow.querySelector('.nuit')
    nuit.getBoundingClientRect = () => ({ left: 200, top: 100, width: 40, height: 20, right: 240, bottom: 120, x: 200, y: 100 })
    window.innerWidth  = 1000
    window.innerHeight = 600
    const animations: any[] = []
    window.document.startViewTransition = (maj: () => void) => { maj(); return { ready: Promise.resolve(), finished: Promise.resolve() } }
    window.document.documentElement.animate = (images: any, opts: any) => { animations.push({ images, opts }); return {} }
    nuit.focus()
    touche(nuit, 'Enter')
    nuit.click()
    await attendre(() => animations.length > 0)
    assert.equal(window.document.documentElement.dataset.mjsTheme, 'dark')
    assert.equal(animations[0].images.clipPath[0], 'circle(0px at 220px 110px)')
  })
})
