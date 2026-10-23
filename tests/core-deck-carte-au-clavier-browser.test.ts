// module cœur deck (<@@deck>, en éventail) dans Chromium réel : la carte atteinte au clavier se soulève comme celle qu'on survole (devant
// les autres, en couleur, son titre affiché), et l'éventail s'ouvre tant que le focus est dans le paquet — il ne s'ouvrait qu'au survol.
// Une carte qui contient l'élément focalisé (un bouton dans la carte) se soulève aussi ; le focus parti, tout revient au repos.

import assert from 'node:assert/strict'
import { construire, navigateurPresent } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'dk-page.mjs': `<button class="avant">avant</button>
<@@deck><a class="c1" href="#un" title="un">1</a><a class="c2" href="#deux" title="deux">2</a><div class="c3" title="trois"><button class="dedans">x</button></div></@@deck>
<button class="apres">après</button>
`,
}

describe('<@@deck> : la carte atteinte au clavier se soulève (chromium réel)', function () {
  this.timeout(120000)
  let present = false
  let browser: any = null
  let page: any = null
  const erreurs: string[] = []

  before(async function () {
    present = await navigateurPresent('chromium')
    if (!present) return
    const b = await construire('deck-clavier', SOURCES, false)
    browser = await (await import('playwright')).chromium.launch({ args: ['--no-proxy-server'] })
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, reducedMotion: 'reduce' })
    page = await ctx.newPage()
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.addInitScript('window.__name = function (f) { return f };')
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding-top:200px"><mjs-dk-page></mjs-dk-page><script>${b.script}</script></body></html>`)
    await page.waitForFunction(() => !!(document.querySelector('mjs-dk-page') as any)?._shadow?.querySelector('mjs-core-deck')?._shadow?.querySelector('slot'))
    await page.waitForTimeout(150)
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  // on lit l'état après le temps d'un fondu complet du titre (::before, une demi-seconde) : juste aussi sans mouvement réduit
  const etat = async (c: string) => (await page.waitForTimeout(600), page.evaluate((k: string) => {
    const el = (document.querySelector('mjs-dk-page') as any)._shadow.querySelector('.' + k)
    const s  = getComputedStyle(el)
    return { z: s.zIndex, op: s.opacity, filtre: s.filter, titre: getComputedStyle(el, '::before').opacity }
  }, c)) as { z: string, op: string, filtre: string, titre: string }
  const actif = () => page.evaluate(() => (document.querySelector('mjs-dk-page') as any)._shadow.activeElement?.className ?? null)
  const REPOS = { z: 'auto', op: '1', filtre: 'grayscale(1) contrast(2)', titre: '0' }
  const HAUTE = { z: '100', op: '1', filtre: 'none', titre: '1' }

  it('au repos, aucune carte n\'est soulevée', async () => {
    for (const c of ['c1', 'c2', 'c3']) assert.deepEqual(await etat(c), REPOS, c)
  })

  it('Tab mène à une carte : elle se soulève, son titre paraît, l\'éventail s\'ouvre (les autres en retrait)', async () => {
    await page.evaluate(() => (document.querySelector('mjs-dk-page') as any)._shadow.querySelector('.avant').focus())
    await page.keyboard.press('Tab')
    assert.equal(await actif(), 'c1')
    assert.deepEqual(await etat('c1'), HAUTE)
    assert.equal((await etat('c2')).op, '0.5', 'l\'éventail est ouvert : les autres cartes en retrait')
    await page.keyboard.press('Tab')
    assert.equal(await actif(), 'c2')
    assert.deepEqual(await etat('c2'), HAUTE)
    assert.equal((await etat('c1')).z, 'auto', 'la carte quittée redescend')
  })

  it('le focus dans une carte (son bouton) la soulève ; sorti du paquet, tout revient au repos', async () => {
    await page.keyboard.press('Tab')
    assert.equal(await actif(), 'dedans')
    assert.deepEqual(await etat('c3'), HAUTE)
    await page.keyboard.press('Tab')
    assert.equal(await actif(), 'apres')
    for (const c of ['c1', 'c2', 'c3']) assert.deepEqual(await etat(c), REPOS, c)
    assert.deepEqual(erreurs, [])
  })
})
