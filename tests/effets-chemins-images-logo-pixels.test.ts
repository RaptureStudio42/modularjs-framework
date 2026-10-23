// *offline(logo:) et *pixels(swap, image:) reçoivent ce que le build pose pour un chemin de fichier : l'adresse publiée
// (ou, avec des variantes de largeur, { src, srcset }, dont le moteur choisit une). Le logo reste un texte ou un émoji
// quand ce n'est pas une adresse, la seconde image reste un dégradé ou un url(…) quand c'en est un. De vrais composants
// compilés, chargés dans happy-dom : on lit les nœuds posés, la géométrie n'est pas en jeu.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'lp-logo':        "<section class=\"z\" *offline(delay: 0s, logo: 'photo.png')><p>zone</p></section>",
  'lp-logo-texte':  "<section class=\"z\" *offline(delay: 0s, logo: '📡')><p>zone</p></section>",
  'lp-logo-racine': "<section class=\"z\" *offline(delay: 0s, logo: '/img/logo.png')><p>zone</p></section>",
  'lp-pixels':      "<div class=\"b\" *pixels(swap, image: 'photo.png')>x</div>",
  'lp-degrade':     "<div class=\"b\" *pixels(swap, image: 'linear-gradient(red, blue)')>x</div>",
  'lp-url':         "<div class=\"b\" *pixels(swap, image: 'url(/img/b.png)')>x</div>"
}

const u32  = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const PNG  = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(64), u32(8), Buffer.from([8, 2, 0, 0, 0]), u32(0)])

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*offline(logo:) et *pixels(swap, image:) — l\'adresse que le build pose, un texte ou une image CSS laissés tels quels', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-chemins-images-logo-pixels')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'photo.png'), PNG)
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

  // le réseau coupé : le bandeau se pose
  const reseau = (en: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => en, configurable: true })
    window.dispatchEvent(new window.Event(en ? 'online' : 'offline'))
  }

  afterEach(() => {
    reseau(true)
    window.document.body.innerHTML = ''
  })

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    return comp._shadow
  }

  async function logo(tag: string) {
    const racine = await monter(tag, '.z')
    reseau(false)
    await attendre(() => !!racine.querySelector('[mjs-fx-offline-logo]'))
    return racine.querySelector('[mjs-fx-offline-logo]')
  }

  async function seconde(tag: string) {
    const racine = await monter(tag, '.b')
    await attendre(() => !!racine.querySelector('[mjs-fx-layer="pixels"]'))
    return racine.querySelector('[mjs-fx-layer="pixels"]').style.getPropertyValue('--mjs-fx-pixels-img2')
  }

  it('*offline(logo: \'photo.png\') : une image, à l\'adresse publiée', async () => {
    const l = await logo('mjs-lp-logo')
    assert.ok(l, 'le logo est posé')
    assert.equal(l.tagName, 'IMG')
    assert.match(l.getAttribute('src'), /^\/[\w/-]*photo-[0-9a-f]{8}\.png$/)
  })

  it('*offline(logo: \'📡\') : un texte, pas une image', async () => {
    const l = await logo('mjs-lp-logo-texte')
    assert.equal(l.tagName, 'SPAN')
    assert.equal(l.textContent, '📡')
  })

  it('*offline(logo: \'/img/logo.png\') : une adresse de la racine, telle quelle', async () => {
    const l = await logo('mjs-lp-logo-racine')
    assert.equal(l.tagName, 'IMG')
    assert.equal(l.getAttribute('src'), '/img/logo.png')
  })

  it('*offline : ce que µimage pose avec des variantes ({ src, srcset }) se lit aussi, le moteur choisit l\'adresse', () => {
    const el = window.document.createElement('section')
    window.document.body.appendChild(el)
    reseau(false)
    const off = window.µ._mjs_fxDefs.offline.setup(el, { delay: '0s', logo: { src: '/l.png', srcset: '/l-100.webp 100w, /l-300.webp 300w' } }, null)
    const l = el.querySelector('[mjs-fx-offline-logo]')
    off()
    assert.ok(l, 'le logo est posé')
    assert.equal(l.tagName, 'IMG')
    // fenêtre de happy-dom (1024 px) plus large que les variantes : l'image d'origine
    assert.match(l.getAttribute('src'), /^\/l(-100\.webp|-300\.webp|\.png)$/)
  })

  it('*pixels(swap, image: \'photo.png\') : la seconde image est l\'adresse publiée', async () => {
    assert.match(await seconde('mjs-lp-pixels'), /^url\("\/[\w/-]*photo-[0-9a-f]{8}\.png"\)$/)
  })

  it('*pixels(swap, image: …) : un dégradé et un url(…) écrits tels quels ne sont pas enveloppés', async () => {
    assert.equal(await seconde('mjs-lp-degrade'), 'linear-gradient(red, blue)')
    assert.equal(await seconde('mjs-lp-url'), 'url(/img/b.png)')
  })

  it('*pixels : ce que µimage pose avec des variantes ({ src, srcset }) se lit aussi, le moteur choisit l\'adresse', () => {
    const el = window.document.createElement('div')
    window.document.body.appendChild(el)
    const off = window.µ._mjs_fxDefs.pixels.setup(el, { mode: 'swap', image: { src: '/a.png', srcset: '/a-100.webp 100w, /a-300.webp 300w' } }, null)
    const v = el.querySelector('[mjs-fx-layer="pixels"]').style.getPropertyValue('--mjs-fx-pixels-img2')
    off()
    assert.match(v, /^url\("\/a(-100\.webp|-300\.webp|\.png)"\)$/)
  })
})
