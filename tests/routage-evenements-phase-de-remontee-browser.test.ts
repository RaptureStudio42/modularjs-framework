// Les gestionnaires routés (`@click`…) d'un événement qui remonte jouent à la remontée, comme un écouteur posé
// sur la balise — au navigateur réel. Défaut garanti absent : le routeur écoutait en capture, avant les écouteurs
// de la cible : un `stopPropagation()` natif d'un descendant n'arrêtait pas le `@click` de l'ancêtre, `@click.stop`
// sur l'ancêtre privait le descendant cliqué de son écouteur natif, et le gestionnaire qu'un composant pose sur
// la balise d'un enfant (à ombre ou léger) jouait AVANT ceux de l'enfant, sans qu'un `.stop` de l'enfant l'arrête.
// Gardes : le contenu glissé garde sa règle (le bouton glissé qui a son `@click` joue seul, un titre glissé
// laisse le clic au cadre, `.propagate` joue le bouton puis le cadre) ; `@focus`, qui ne remonte pas, reste routé.
// Chromium et pas happy-dom, comme les autres tests de routage des clics entre composants.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const NOTE = 'note = (x) -> window.__ordre.push(x)'

const SOURCES: Record<string, string> = {
  'rb-menu.mjs': '<script>\n$n = 0\n$m = 0\n$f = 0\n</script>\n<div class="outer" @click={$n++}><button class="in">x</button></div>\n<div class="outer2" @click.stop={$m++}><button class="in2">y</button></div>\n<input class="f" @focus={$f++}>\n',
  'rb-enfant.mjs': `<script>\n${NOTE}\n</script>\n<button class="dedans" @click.stop={note('enfant-stop')}>s</button>\n<button class="libre" @click={note('enfant')}>l</button>\n`,
  'rb-parent.mjs': `<script>\n${NOTE}\n</script>\n<@rb-enfant @click={note('parent')}/>\n`,
  'rb-leger.mjs': `<script>\n${NOTE}\n</script>\n<button class="lb" @click={note('leger')}>l</button>\n<button class="ls" @click.stop={note('leger-stop')}>s</button>\n`,
  'rb-hote.mjs': `<script>\n${NOTE}\n</script>\n<@rb-leger @lightDom @click={note('hote')}/>\n`,
  'rb-cadre.mjs': `<script>\n${NOTE}\n</script>\n<div class="cadre" @click={note('cadre')}><@slot/></div>\n`,
  'rb-page.mjs': `<script>\n${NOTE}\n</script>\n<@rb-cadre><button class="gl" @click={note('glisse')}>g</button><h3 class="titre">t</h3><button class="glp" @click.propagate={note('glisse-propage')}>p</button></@rb-cadre>\n`,
}

const CORPS = '<mjs-rb-menu></mjs-rb-menu><mjs-rb-parent></mjs-rb-parent><mjs-rb-hote></mjs-rb-hote><mjs-rb-page></mjs-rb-page>'

// cherche dans la page et dans toutes les ombres des composants (`_shadow`), en partant d'une balise
const OUTILS = `
  window.__ordre = []
  window.__trouve = (depart, sel) => {
    const file = [depart]
    while (file.length) {
      const r = file.shift()
      const hit = r.querySelector(sel)
      if (hit) return hit
      for (const el of r.querySelectorAll('*')) if (el._shadow && el._shadow !== el) file.push(el._shadow)
      if (r._shadow && r._shadow !== r && !file.includes(r._shadow)) file.push(r._shadow)
    }
    return null
  }
  window.__clic = (hote, sel) => { window.__ordre = []; window.__trouve(document.querySelector(hote), sel).click(); return window.__ordre.slice() }
`

describe('routage des événements à la remontée (Chromium réel)', function () {
  this.timeout(90000)
  let present = false
  let script  = ''
  let browser: any
  let page: any

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test du routage à la remontée sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('routage-remontee-nav')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const { chromium } = await import('playwright')
    browser = await chromium.launch()
    page    = await browser.newPage()
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${CORPS}<script>${OUTILS}</script><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => {
      const w: any = window
      return !!w.__trouve(document.querySelector('mjs-rb-menu'), '.in') && !!w.__trouve(document.querySelector('mjs-rb-parent'), '.libre') && !!w.__trouve(document.querySelector('mjs-rb-hote'), '.lb') && !!w.__trouve(document.querySelector('mjs-rb-page'), '.gl')
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  const clic = (hote: string, sel: string) => page.evaluate(([h, s]: string[]) => (window as any).__clic(h, s), [hote, sel])

  it('un `stopPropagation()` natif sur un descendant arrête le `@click` de l\'ancêtre ; `@click.stop` sur l\'ancêtre laisse son clic au descendant', async function () {
    if (!present) { this.skip(); return }
    const r = await page.evaluate(() => {
      const c: any = document.querySelector('mjs-rb-menu')
      const sh = c._shadow
      sh.querySelector('.in').addEventListener('click', (e: any) => e.stopPropagation())
      sh.querySelector('.in').click()
      let recu = 0
      sh.querySelector('.in2').addEventListener('click', () => { recu++ })
      sh.querySelector('.in2').click()
      return { n: c._state.n, recu, m: c._state.m }
    })
    assert.deepEqual(r, { n: 0, recu: 1, m: 1 })
  })

  it('composant à ombre : les gestionnaires de l\'enfant jouent avant celui que le parent pose sur sa balise, et `.stop` de l\'enfant l\'arrête', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await clic('mjs-rb-parent', '.libre'), ['enfant', 'parent'])
    assert.deepEqual(await clic('mjs-rb-parent', '.dedans'), ['enfant-stop'])
  })

  it('composant léger : même règle — le léger d\'abord, puis la balise posée par son hôte ; `.stop` du léger arrête l\'hôte', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await clic('mjs-rb-hote', '.lb'), ['leger', 'hote'])
    assert.deepEqual(await clic('mjs-rb-hote', '.ls'), ['leger-stop'])
  })

  it('garde : contenu glissé — le bouton glissé joue seul, le titre glissé laisse le clic au cadre, `.propagate` joue le bouton puis le cadre', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await clic('mjs-rb-page', '.gl'), ['glisse'])
    assert.deepEqual(await clic('mjs-rb-page', '.titre'), ['cadre'])
    assert.deepEqual(await clic('mjs-rb-page', '.glp'), ['glisse-propage', 'cadre'])
  })

  it('garde : `@focus`, qui ne remonte pas, reste routé', async function () {
    if (!present) { this.skip(); return }
    const f = await page.evaluate(() => {
      const c: any = document.querySelector('mjs-rb-menu')
      c._shadow.querySelector('.f').focus()
      return c._state.f
    })
    assert.equal(f, 1)
  })
})
