// une image donnée en réglage d'un effet (chemin entre guillemets que le build change en µimage, ou µimage('…') :
// { src, srcset }) se charge à la taille de la balise : la plus petite variante qui couvre sa largeur à l'écran × la
// densité de l'écran ; quand aucune ne la couvre, l'image d'origine (`src`), jamais une variante plus petite, agrandie
// donc floue. Le cas vu : un sujet de 800 px (une seule variante, 480 : 960 dépasse l'original) sur une balise de
// 800 px chargeait la variante de 480 px.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

describe('effets — image en réglage : l\'original quand aucune variante ne couvre la balise', () => {
  let fenetre: any
  const SRCSET = '/a-480.png 480w, /a-960.png 960w'
  const balise = (largeur: number) => ({ getBoundingClientRect: () => ({ width: largeur }) })
  const image  = (v: unknown, el: unknown, densite = 1) => {
    fenetre.devicePixelRatio = densite
    return fenetre.µ._mjs_fxImage(v, el)
  }

  before(async function () {
    this.timeout(120000)
    const root   = mjsTmp('effets-image-originale')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-o.mjs'), '<div class="a" *ink(on: load)>a</div>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    fenetre = new Window({ url: 'http://localhost/' })
    fenetre.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    fenetre?.close?.()
    await terminateSharedWorkerPool()
  })

  it('un sujet de 800 px (une seule variante, 480) sur une balise de 800 px : l\'original, pas la variante agrandie', () => {
    const sujet = { src: '/m/sujet-ab12cd34.png', srcset: '/m/sujet-480-0f1e2d3c.webp 480w' }
    assert.equal(image(sujet, balise(800)), '/m/sujet-ab12cd34.png')
  })

  it('une balise plus large que toutes les variantes, ou un écran dense : l\'original', () => {
    assert.equal(image({ src: '/a.png', srcset: SRCSET }, balise(2000)), '/a.png')
    assert.equal(image({ src: '/a.png', srcset: SRCSET }, balise(600), 2), '/a.png')
  })

  it('une balise pas encore mise en page, dans une fenêtre plus large que les variantes : l\'original', () => {
    fenetre.innerWidth = 1500
    assert.equal(image({ src: '/a.png', srcset: SRCSET }, balise(0)), '/a.png')
  })

  it('une variante qui couvre la balise : la plus petite qui la couvre, jamais l\'original', () => {
    const o = { src: '/a.png', srcset: '/a-960.png 960w, /a-480.png 480w' }
    assert.equal(image(o, balise(300)), '/a-480.png')
    assert.equal(image(o, balise(500)), '/a-960.png')
    assert.equal(image(o, balise(480), 2), '/a-960.png')
  })

  it('un objet sans image d\'origine (écrit à la main) : la plus grande variante, faute de mieux', () => {
    assert.equal(image({ srcset: SRCSET }, balise(2000)), '/a-960.png')
  })
})
