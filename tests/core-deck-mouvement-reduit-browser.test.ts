// module cœur deck (<@@deck>, en éventail) dans Chromium réel, sous mouvement réduit (prefers-reduced-motion: reduce) : le titre de la
// carte (::before) et sa barre de couleur (::after, dépliée par sa taille de fond) paraissent d'un coup, comme la carte elle-même, sans le
// fondu d'une demi-seconde.
// Sans mouvement réduit, les deux gardent leur fondu (témoin : le test lit bien ces deux pseudo-éléments).

import assert from 'node:assert/strict'
import { construire, navigateurPresent } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'dkm-page.mjs': `<button class="avant">avant</button>
<@@deck><a class="c1" href="#un" title="un">1</a><a class="c2" href="#deux" title="deux">2</a><a class="c3" href="#trois" title="trois">3</a></@@deck>
`,
}

type Lecture = { carte: string, titre: string, barre: string }
type Apparition = { titre: string, barre: string }

describe('<@@deck> : sous mouvement réduit, le titre et la barre perdent leur fondu (chromium réel)', function () {
  this.timeout(120000)
  let present = false
  let browser: any = null
  let script = ''
  const erreurs: string[] = []

  before(async function () {
    present = await navigateurPresent('chromium')
    if (!present) return
    script  = (await construire('deck-mouvement-reduit', SOURCES, false)).script
    browser = await (await import('playwright')).chromium.launch({ args: ['--no-proxy-server'] })
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  async function ouvrir(reducedMotion: 'reduce' | 'no-preference') {
    const ctx  = await browser.newContext({ viewport: { width: 900, height: 700 }, reducedMotion })
    const page = await ctx.newPage()
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.addInitScript('window.__name = function (f) { return f };')
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding-top:200px"><mjs-dkm-page></mjs-dkm-page><script>${script}</script></body></html>`)
    await page.waitForFunction(() => !!(document.querySelector('mjs-dkm-page') as any)?._shadow?.querySelector('mjs-core-deck')?._shadow?.querySelector('slot'))
    await page.waitForTimeout(150)
    return { ctx, page }
  }

  // durée de transition calculée de la carte, de son titre et de sa barre
  const durees = (page: any) => page.evaluate(() => {
    const el = (document.querySelector('mjs-dkm-page') as any)._shadow.querySelector('.c1')
    return { carte: getComputedStyle(el).transitionDuration, titre: getComputedStyle(el, '::before').transitionDuration, barre: getComputedStyle(el, '::after').transitionDuration }
  }) as Promise<Lecture>

  // le focus posé sur la carte, puis le titre et la barre lus dans la même tâche, sans laisser passer de temps
  const apparition = (page: any) => page.evaluate(() => {
    const el = (document.querySelector('mjs-dkm-page') as any)._shadow.querySelector('.c1')
    el.focus()
    return { titre: getComputedStyle(el, '::before').opacity, barre: getComputedStyle(el, '::after').backgroundSize }
  }) as Promise<Apparition>

  it('mouvement réduit : la carte, son titre et sa barre n\'ont aucune transition', async () => {
    const { ctx, page } = await ouvrir('reduce')
    assert.deepEqual(await durees(page), { carte: '0s', titre: '0s', barre: '0s' })
    await ctx.close()
  })

  it('mouvement réduit : au focus, le titre est opaque et la barre dépliée tout de suite', async () => {
    const { ctx, page } = await ouvrir('reduce')
    assert.deepEqual(await apparition(page), { titre: '1', barre: '50px 500px' })
    await ctx.close()
  })

  it('témoin, sans mouvement réduit : le titre et la barre gardent leur fondu d\'une demi-seconde', async () => {
    const { ctx, page } = await ouvrir('no-preference')
    const d = await durees(page)
    assert.equal(d.titre, '0.5s')
    assert.equal(d.barre, '0.5s')
    const a = await apparition(page)
    assert.notEqual(a.titre, '1', 'le titre est encore en fondu juste après le focus')
    await ctx.close()
    assert.deepEqual(erreurs, [])
  })
})
