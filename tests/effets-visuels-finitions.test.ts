// Effets visuels — finitions, sur de vrais composants compilés chargés dans happy-dom : *glitch ne
// recopie que le texte de sa balise (pas les lettres qu'un autre effet y a posées) ; *border(wave) sur
// une page sans fond découpe sa dentelle dans la couleur de la page ; *autosize posé sur un composant
// voit arriver l'image de son intérieur. Ce qui ne se voit qu'à l'écran (un mot qui tremble, un
// arrondi, une couleur de filtre) : banc navigateur effets-visuels-rendu.browser.mts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-glitch-lettres': '<script>\n$titre = "Titre"\n</script>\n<h2 class="t" *glitch *bounce>{$titre}</h2>\n<button class="b" @click={$titre = "Nouveau"}>b</button>',
  'fx-dentelle':       '<div class="d" *border(wave)>Dentelle</div>',
  'fx-photo':          '<img class="i" src="x.png" alt="">',
  'fx-cadre':          '<@fx-photo class="c" *autosize></@fx-photo>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets visuels — finitions', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-finitions')
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

  it('*glitch avec un autre effet de lettres : ses copies ne recopient que le texte de la balise, même changé', async () => {
    const t = await monter('mjs-fx-glitch-lettres', '.t')
    assert.ok(t.querySelector('[mjs-fx-layer="text"]'), '*bounce a posé ses lettres dans la balise')
    assert.equal(t.getAttribute('mjs-fx-glitch-text'), 'Titre')
    t.getRootNode().querySelector('.b').click()
    await attendre(() => (t.getAttribute('mjs-fx-glitch-text') ?? '').startsWith('Nouveau'))
    await pause(30)
    assert.equal(t.getAttribute('mjs-fx-glitch-text'), 'Nouveau', 'pas « NouveauNouveau »')
  })

  it('*border(wave) sur une page sans fond : la dentelle prend la couleur de la page (Canvas), pas un gris foncé', async () => {
    const d = await monter('mjs-fx-dentelle', '.d')
    const l = d.querySelector('[mjs-fx-layer="border"]')
    assert.ok(l, 'le calque de la dentelle')
    assert.equal(l.style.getPropertyValue('--mjs-fx-border-c'), 'Canvas')
  })

  it('*autosize sur un composant : l\'image qui arrive dans son intérieur fait glisser la boîte', async () => {
    const c = await monter('mjs-fx-cadre', '.c')
    await attendre(() => !!c._shadow?.querySelector('.i'))
    // happy-dom ne met rien en page : la boîte mesure 40 px, puis 140 px une fois l'image arrivée
    let h = 40
    const boite = () => ({ left: 0, top: 0, width: 200, height: h, right: 200, bottom: h, x: 0, y: 0 })
    c.getBoundingClientRect = boite
    Object.defineProperty(c, 'offsetWidth', { configurable: true, get: () => 200 })
    Object.defineProperty(c, 'offsetHeight', { configurable: true, get: () => h })
    const glisses: any[] = []
    // le cœur appelle animate par le prototype (un composant peut masquer celui de sa balise) quand il existe — happy-dom 20.14 l'a, 20.11 non : l'espion s'y pose le temps du test, filtré sur la balise
    const proto = window.Element.prototype
    const avant = Object.getOwnPropertyDescriptor(proto, 'animate')
    const natif = proto.animate
    proto.animate = function (this: any, k: any[], opts: any) {
      if (this !== c) return natif?.call(this, k, opts)
      glisses.push(k.map((x) => x.height))
      return { cancel() {}, onfinish: null }
    }
    try {
      // la taille de départ, relue quand rien ne glisse (fenêtre, police…)
      c._mjs_fxOff.autosize()
      window.µ._mjs_fx(null, c, 'autosize', {})
      h = 140
      c._shadow.querySelector('.i').dispatchEvent(new window.Event('load'))
      await pause()
      assert.equal(JSON.stringify(glisses), JSON.stringify([['40px', '140px']]), 'la boîte glisse de 40 à 140 px')
    }
    finally {
      if (avant) Object.defineProperty(proto, 'animate', avant)
      else delete proto.animate
    }
  })
})
