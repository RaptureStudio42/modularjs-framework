// Le reffet d'un magasin qui écrit ce qu'il lit ne se relance pas lui-même.
//
// Un `µeffect` écrit au premier niveau du fichier d'un magasin passe une fois à la création, puis une fois par rafale de
// changements venus d'ailleurs. Sa propre écriture ne le relance pas, quelle que soit la façon dont le magasin prévient ses
// abonnés : sur-le-champ (magasin léger `µ$$x`) ou en microtâche, une fois le passage fini (`µStore`). Deux magasins dont les
// reffets se lisent passent chacun une fois par changement : l'écriture de l'un relance l'autre, jamais lui-même.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // un `µStore` dont le reffet écrit ce qu'il lit, et deux `µStore` dont les reffets se lisent
  'ms-compte.module.civet.mjs': [
    'export compte = new µStore(n: 0, vus: 0)',
    'export a = new µStore(n: 0, double: 0, vus: 0)',
    'export b = new µStore(m: 0, somme: 0, vus: 0)',
    '',
    'µeffect ->',
    '  compte.data.n',
    '  compte.data.vus++',
    '',
    'µeffect ->',
    '  a.data.vus++',
    '  a.data.double = b.data.m * 2',
    '',
    'µeffect ->',
    '  b.data.vus++',
    '  b.data.somme = a.data.n + a.data.double',
    '',
    'window.__ms = { compte, a, b }',
  ].join('\n'),
  // un magasin léger dont le reffet écrit la clé qu'il lit
  'ms-leger.module.civet.mjs': [
    'export µ$$leger = { n: 0, vus: 0 }',
    '',
    'µeffect ->',
    '  µ$$leger.n',
    '  µ$$leger.vus++',
    '',
    'window.__msLeger = -> µ$$leger.n++',
    'window.__msLu = -> "#{µ$$leger.n} #{µ$$leger.vus}"',
  ].join('\n'),
  'ms-vitrine.mjs': [
    '@import compte \'ms-compte.module.civet.mjs\'',
    '@import µ$$leger \'ms-leger.module.civet.mjs\'',
    '<p class="c">{compte.data.n} {compte.data.vus}</p><p class="l">{µ$$leger.n} {µ$$leger.vus}</p>',
  ].join('\n'),
}

const ombre  = `document.querySelector('mjs-ms-vitrine')._shadow`
const vers   = (page: any, js: string) => page.evaluate(`(() => { ${js}; return null })()`)
const jusqua = (page: any, cond: string) => page.waitForFunction(cond, null, { timeout: 4000 }).catch(() => {})
// « n vus » du compte, « vus double » de a, « vus somme » de b, « n vus » du magasin léger
const etat   = (page: any) => page.evaluate(`(() => { const { compte: c, a, b } = window.__ms; return [c.data.n + ' ' + c.data.vus, a.data.vus + ' ' + a.data.double, b.data.vus + ' ' + b.data.somme, window.__msLu()] })()`)
const texte  = (page: any, sel: string) => page.evaluate(`${ombre}.querySelector('${sel}').textContent`)
const boucle = (avis: string[]) => avis.filter((a) => /Boucle réactive|Reactive loop|elLoop|10 000|10,000/.test(a))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, ['mjs-ms-vitrine']))
  return cibles.get(mode)!
}

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`le reffet d'un magasin qui écrit ce qu'il lit (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null

  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { console.log(`  ℹ️  ${moteur} non installé, test sauté`); return }
    browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev-parents-avant', 'bundle'] as const) {
    const nom = mode === 'bundle' ? 'production' : 'développement'

    it(`µStore prévenu en microtâche : un passage à la création, un par rafale venue d'ailleurs, jamais de rafale à lui (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-ms-vitrine')
      try {
        await jusqua(o.page, `window.__ms && window.__ms.compte.data.vus >= 1`)
        await o.page.waitForTimeout(200)
        assert.equal((await etat(o.page))[0], '0 1', 'une fois à la création : son écriture ne le relance pas')
        await vers(o.page, `window.__ms.compte.data.n++`)
        await jusqua(o.page, `window.__ms.compte.data.vus >= 2`)
        await o.page.waitForTimeout(200)
        assert.equal((await etat(o.page))[0], '1 2', 'un changement venu d\'ailleurs : un passage')
        await vers(o.page, `window.__ms.compte.data.n++; window.__ms.compte.data.n++`)
        await jusqua(o.page, `window.__ms.compte.data.vus >= 3`)
        await o.page.waitForTimeout(200)
        assert.equal((await etat(o.page))[0], '3 3', 'deux écritures dans la même rafale : un passage')
        assert.equal(await texte(o.page, '.c'), '3 3', 'le composant qui lit le magasin voit l\'écriture du reffet')
        assert.deepEqual(boucle(o.avis), [], 'aucune garde des 10 000 passages')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`deux µStore dont les reffets se lisent : chacun passe une fois par changement (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-ms-vitrine')
      try {
        await jusqua(o.page, `window.__ms && window.__ms.a.data.vus >= 1 && window.__ms.b.data.vus >= 1`)
        await o.page.waitForTimeout(200)
        assert.deepEqual((await etat(o.page)).slice(1, 3), ['1 0', '1 0'], 'une fois chacun à la création')
        await vers(o.page, `window.__ms.b.data.m = 5`)
        await jusqua(o.page, `window.__ms.b.data.somme === 10`)
        await o.page.waitForTimeout(200)
        assert.deepEqual((await etat(o.page)).slice(1, 3), ['2 10', '2 10'], 'b.m relance le reffet de a, dont l\'écriture relance celui de b : une fois chacun')
        await vers(o.page, `window.__ms.a.data.n = 1`)
        await jusqua(o.page, `window.__ms.b.data.somme === 11`)
        await o.page.waitForTimeout(200)
        assert.deepEqual((await etat(o.page)).slice(1, 3), ['2 10', '3 11'], 'a.n ne relance que le reffet de b')
        assert.deepEqual(boucle(o.avis), [], 'aucune garde des 10 000 passages')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`magasin léger µ$$x prévenu sur-le-champ : sa clé écrite par son reffet ne le relance pas (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-ms-vitrine')
      try {
        await jusqua(o.page, `window.__msLu && window.__msLu() !== '0 0'`)
        await o.page.waitForTimeout(200)
        assert.equal((await etat(o.page))[3], '0 1', 'une fois à la création')
        await vers(o.page, `window.__msLeger()`)
        await jusqua(o.page, `window.__msLu() !== '0 1'`)
        await o.page.waitForTimeout(200)
        assert.equal((await etat(o.page))[3], '1 2', 'un changement venu d\'ailleurs : un passage')
        assert.equal(await texte(o.page, '.l'), '1 2')
        assert.deepEqual(boucle(o.avis), [], 'aucune garde des 10 000 passages')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })
  }
})
