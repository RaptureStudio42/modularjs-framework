// Un `{await}` encore en attente au rendu serveur n'écrit plus sa zone de squelette (`mjs-skel-zone`) dans
// le HTML prérendu : elle y arrivait sans sa feuille de style (l'effet *skeleton ne tourne pas au serveur),
// barres vides et saut de mise en page à l'hydratation. Vaut pour les deux moteurs de prérendu : happy-dom
// (`µ._isServer`) et le navigateur de prérendu (`µ.server`). Dans le navigateur de l'utilisateur, la zone
// reste. Une branche d'attente écrite à la main reste écrite dans le HTML prérendu.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { renderToString, stripEsm } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mjsTmp } from './helpers/tmp.js'

// une promesse qui n'aboutit jamais : le bloc reste en attente
const SCRIPT = '<script lang="coffee">\n$p = new Promise (resolve) -> null\n</script>\n'

const AUTO    = SCRIPT + '<div class="wrap">\n{await $p}\n{success v}\n  <p class="ok">{v}</p>\n{end}\n</div>\n'
const SKEL    = SCRIPT + '<div class="wrap">\n{await $p *skeleton(color: red)}\n{success v}\n  <h2 class="titre">{v.titre}</h2>\n  <p class="ok">{v.texte}</p>\n{end}\n</div>\n'
const ECRITE  = SCRIPT + '<div class="wrap">\n{await $p}\n  <p class="pending">chargement…</p>\n{success v}\n  <p class="ok">{v}</p>\n{end}\n</div>\n'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// le composant construit puis monté dans happy-dom ; `serveur` pose `µ.server = true` avant le montage,
// comme le fait le navigateur de prérendu
async function monter(prefixe: string, fichier: string, source: string, serveur: boolean) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, fichier), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  if (serveur) window.eval('µ.server = true;')
  const tag = 'mjs-' + fichier.replace(/\.mjs$/, '')
  window.document.body.innerHTML = `<${tag}></${tag}>`
  const c = window.document.querySelector(tag)
  await attendre(() => !!c._shadow?.querySelector('.wrap'))
  await new Promise((r) => setTimeout(r, 60))
  return { window, c }
}

async function prerendre(nom: string, source: string) {
  const root   = mjsTmp('squelette-prerendu-' + nom)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  return renderToString({ sourceDir: srcDir, tag: 'mjs-' + nom, settleMs: 300 })
}

describe('{await} en attente : la zone de squelette n\'est pas prérendue', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('rendu serveur (happy-dom), squelette d\'office : pas de zone dans le HTML', async () => {
    const res = await prerendre('att-auto', AUTO)
    assert.ok(res.html.includes('class="wrap"'), 'le composant est bien rendu : ' + res.html.slice(0, 200))
    assert.ok(!res.html.includes('mjs-skel-zone'), 'la zone de squelette ne part pas au HTML prérendu : ' + res.html.slice(0, 400))
    assert.ok(!res.html.includes('mjs-skel='), 'ni ses barres : ' + res.html.slice(0, 400))
  })

  it('rendu serveur (happy-dom), {await … *skeleton(réglages)} : pas de zone non plus', async () => {
    const res = await prerendre('att-skel', SKEL)
    assert.ok(res.html.includes('class="wrap"'), 'le composant est bien rendu')
    assert.ok(!res.html.includes('mjs-skel-zone'), 'la zone de squelette ne part pas au HTML prérendu : ' + res.html.slice(0, 400))
  })

  it('rendu serveur : une branche d\'attente écrite à la main reste dans le HTML prérendu', async () => {
    const res = await prerendre('att-ecrite', ECRITE)
    assert.ok(res.html.includes('class="pending"'), 'l\'attente écrite est prérendue : ' + res.html.slice(0, 400))
    assert.ok(!res.html.includes('mjs-skel-zone'), 'et il n\'y a jamais de zone')
  })

  it('navigateur de prérendu (µ.server = true) : pas de zone, l\'attente écrite reste', async () => {
    const auto = await monter('squelette-server-auto', 'att-auto.mjs', AUTO, true)
    try {
      assertAbsent(auto.c._shadow.querySelector('[mjs-skel-zone]'), 'zone de squelette absente quand µ.server est vrai')
      assertAbsent(auto.c._shadow.querySelector('[mjs-skel]'), 'barres absentes')
    }
    finally {
      auto.window.close()
    }
    const ecrite = await monter('squelette-server-ecrite', 'att-ecrite.mjs', ECRITE, true)
    try {
      assert.ok(ecrite.c._shadow.querySelector('.pending') !== null, 'l\'attente écrite à la main est montrée')
    }
    finally {
      ecrite.window.close()
    }
  })

  it('prérendu par Chromium (render-browser) : pas de zone dans le HTML, l\'attente écrite reste', async function () {
    let chromium = false
    try { chromium = existsSync((await import('playwright')).chromium.executablePath()) } catch { chromium = false }
    if (!chromium) return this.skip()
    const root = mjsTmp('squelette-prerendu-chromium')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'att-auto.mjs'), AUTO)
    writeFileSync(join(root, 'src', 'att-ecrite.mjs'), ECRITE)
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out' }, { configDir: root })
    try {
      const auto = await renderer.renderPage('mjs-att-auto', { settleMs: 300 })
      assert.ok(auto.html.includes('class="wrap"'), 'le composant est bien rendu : ' + auto.html.slice(0, 200))
      assert.ok(!auto.html.includes('mjs-skel-zone'), 'la zone de squelette ne part pas au HTML prérendu : ' + auto.html.slice(0, 400))
      const ecrite = await renderer.renderPage('mjs-att-ecrite', { settleMs: 300 })
      assert.ok(ecrite.html.includes('class="pending"'), 'l\'attente écrite reste : ' + ecrite.html.slice(0, 400))
    }
    finally {
      await renderer.close()
    }
  })

  it('navigateur de l\'utilisateur (µ.server faux) : la zone reste, ses barres aussi', async () => {
    const auto = await monter('squelette-client-auto', 'att-auto.mjs', AUTO, false)
    try {
      assert.ok(auto.c._shadow.querySelector('[mjs-skel-zone]') !== null, 'la zone de squelette est montrée au client')
      assert.ok(auto.c._shadow.querySelector('[mjs-skel="m"], [mjs-skel="lines"], [mjs-skel="l"], [mjs-skel="s"], [mjs-skel="title"], [mjs-skel="block"]') !== null, 'avec ses barres')
    }
    finally {
      auto.window.close()
    }
    const skel = await monter('squelette-client-skel', 'att-skel.mjs', SKEL, false)
    try {
      assert.ok(skel.c._shadow.querySelector('[mjs-skel-zone] h2[class="titre"]') !== null, 'la silhouette garde sa balise et sa classe')
    }
    finally {
      skel.window.close()
    }
  })
})
