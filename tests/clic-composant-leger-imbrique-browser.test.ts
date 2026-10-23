// Un clic dans un composant léger (`@lightDom`, sans ombre) posé chez un autre composant ne doit jouer
// que les gestionnaires du composant qui a écrit l'élément cliqué. Défaut garanti absent : les
// identifiants de routage sont numérotés composant par composant (`e1`, `e2`…) ; sans ombre pour les
// séparer, le routeur du composant qui contient le léger lisait ceux du léger, et le bouton `+1` du
// compteur vidait aussi le panier. Même croisement dans l'autre sens : le léger jouait son propre
// gestionnaire pour un bouton que le composant qui le contient lui a confié.
// Gardes : le gestionnaire posé sur la balise du léger joue toujours (le clic remonte jusqu'à elle),
// et chaque composant répond toujours à ses propres boutons.
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

const SOURCES: Record<string, string> = {
  'compteur.mjs': '<script>\n$n = 0\n</script>\n<button class="plus" @click={$n++}>+1</button>\n<p class="n">{$n}</p>\n',
  'panier.mjs': '<script>\n$v = 0\n</script>\n<button class="vider" @click={$v++}>vider</button>\n<@compteur @lightDom/>\n<p class="v">{$v}</p>\n',
  'boite.mjs': '<script>\n$b = 0\n</script>\n<button class="interne" @click={$b++}>interne</button>\n<p class="b">{$b}</p>\n',
  'atelier.mjs': '<script>\n$a = 0\n</script>\n<@boite @lightDom><button class="auteur" @click={$a++}>confié</button></@boite>\n<p class="a">{$a}</p>\n',
  'hote.mjs': '<script>\n$h = 0\n</script>\n<@compteur @lightDom @click={$h++}/>\n<p class="h">{$h}</p>\n',
  'liste.mjs': '<script>\n$c = 0\n$items = [1, 2]\n</script>\n{for i in $items}<button class="ligne" @click={$c++}>{i}</button>{end}\n<p class="c">{$c}</p>\n',
  'rayon.mjs': '<script>\n$r = 0\n$xs = [1]\n</script>\n{for x in $xs}<button class="rayon" @click={$r++}>{x}</button>{end}\n<@liste @lightDom/>\n<p class="r">{$r}</p>\n'
}

const CORPS = '<mjs-panier class="ombre"></mjs-panier><mjs-panier class="leger" mjs-light></mjs-panier><mjs-atelier></mjs-atelier><mjs-hote></mjs-hote><mjs-rayon></mjs-rayon>'

describe('clic dans un composant léger imbriqué (Chromium réel) — seul le composant qui a écrit l\'élément joue', function () {
  this.timeout(60000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test des clics de composant léger sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('clic-leger')
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
  })

  after(async () => { await terminateSharedWorkerPool() })

  // cherche dans la page et dans toutes les ombres des composants (`_shadow`), en partant d'une balise
  const OUTILS = `
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
    window.__texte = (hote, sel) => window.__trouve(document.querySelector(hote), sel).textContent
    window.__clic = (hote, sel) => window.__trouve(document.querySelector(hote), sel).click()
    window.__ids = (hote, sel) => JSON.stringify(window.__trouve(document.querySelector(hote), sel)._mjs_ids)
  `

  async function ouvrir(browser: any) {
    const page = await browser.newPage()
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${CORPS}<script>${script}</script><script>${OUTILS}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => {
      const w: any = window
      return !!w.__trouve(document.querySelector('mjs-panier.ombre'), '.plus') && !!w.__trouve(document.querySelector('mjs-panier.leger'), '.plus') && !!w.__trouve(document.querySelector('mjs-atelier'), '.interne') && !!w.__trouve(document.querySelector('mjs-hote'), '.plus') && !!w.__trouve(document.querySelector('mjs-rayon'), '.ligne')
    })
    return page
  }

  const texte = (page: any, hote: string, sel: string) => page.evaluate(([h, s]: string[]) => (window as any).__texte(h, s), [hote, sel])
  const clic  = async (page: any, hote: string, sel: string) => { await page.evaluate(([h, s]: string[]) => (window as any).__clic(h, s), [hote, sel]); await page.waitForTimeout(50) }
  const ids   = (page: any, hote: string, sel: string) => page.evaluate(([h, s]: string[]) => (window as any).__ids(h, s), [hote, sel])

  it('léger dans un composant à ombre : `+1` du compteur ne vide pas le panier ; `vider` répond toujours', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await ouvrir(browser)
      assert.equal(await ids(page, 'mjs-panier.ombre', '.plus'), await ids(page, 'mjs-panier.ombre', '.vider'), 'précondition : `+1` et `vider` portent le même identifiant de routage')
      await clic(page, 'mjs-panier.ombre', '.plus')
      assert.deepEqual([await texte(page, 'mjs-panier.ombre', '.n'), await texte(page, 'mjs-panier.ombre', '.v')], ['1', '0'], 'seul le compteur joue')
      await clic(page, 'mjs-panier.ombre', '.vider')
      assert.deepEqual([await texte(page, 'mjs-panier.ombre', '.n'), await texte(page, 'mjs-panier.ombre', '.v')], ['1', '1'], 'le bouton du panier répond toujours')
    } finally {
      await browser.close()
    }
  })

  it('léger dans un léger, posés dans la page : même séparation', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await ouvrir(browser)
      await clic(page, 'mjs-panier.leger', '.plus')
      assert.deepEqual([await texte(page, 'mjs-panier.leger', '.n'), await texte(page, 'mjs-panier.leger', '.v')], ['1', '0'], 'seul le compteur joue')
      await clic(page, 'mjs-panier.leger', '.vider')
      assert.deepEqual([await texte(page, 'mjs-panier.leger', '.n'), await texte(page, 'mjs-panier.leger', '.v')], ['1', '1'], 'le bouton du panier répond toujours')
    } finally {
      await browser.close()
    }
  })

  it('un bouton confié au léger par le composant qui le contient : seul celui qui l\'a écrit joue, dans les deux sens', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await ouvrir(browser)
      assert.equal(await ids(page, 'mjs-atelier', '.auteur'), await ids(page, 'mjs-atelier', '.interne'), 'précondition : le bouton confié et le bouton interne portent le même identifiant de routage')
      await clic(page, 'mjs-atelier', '.auteur')
      assert.deepEqual([await texte(page, 'mjs-atelier', '.a'), await texte(page, 'mjs-atelier', '.b')], ['1', '0'], 'bouton confié : seul l\'atelier joue')
      await clic(page, 'mjs-atelier', '.interne')
      assert.deepEqual([await texte(page, 'mjs-atelier', '.a'), await texte(page, 'mjs-atelier', '.b')], ['1', '1'], 'bouton interne : seule la boîte joue')
    } finally {
      await browser.close()
    }
  })

  it('lignes de liste (`{for}`) des deux côtés : même séparation', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await ouvrir(browser)
      assert.equal(await ids(page, 'mjs-rayon', '.ligne'), await ids(page, 'mjs-rayon', '.rayon'), 'précondition : les lignes des deux listes portent le même identifiant de routage')
      await clic(page, 'mjs-rayon', '.ligne')
      assert.deepEqual([await texte(page, 'mjs-rayon', '.c'), await texte(page, 'mjs-rayon', '.r')], ['1', '0'], 'ligne du léger : seule la liste joue')
      await clic(page, 'mjs-rayon', '.rayon')
      assert.deepEqual([await texte(page, 'mjs-rayon', '.c'), await texte(page, 'mjs-rayon', '.r')], ['1', '1'], 'ligne du rayon : seul le rayon joue')
    } finally {
      await browser.close()
    }
  })

  it('garde : le gestionnaire posé sur la balise du léger joue quand on clique dedans, comme un clic qui remonte', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await ouvrir(browser)
      await clic(page, 'mjs-hote', '.plus')
      assert.deepEqual([await texte(page, 'mjs-hote', '.n'), await texte(page, 'mjs-hote', '.h')], ['1', '1'], 'le compteur et la balise jouent chacun une fois')
    } finally {
      await browser.close()
    }
  })
})
