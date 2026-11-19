// <@@code> dans une langue qui a une table de noms : une bascule refait chaque bloc UNE fois, dans tous les moteurs (WebKit lève `slotchange`
// quand un texte projeté change sans que les nœuds projetés changent : la réécriture du programme ne relance pas une passe par bloc) ; les
// affectations `:=` (Civet) alignées se réalignent ensemble, comme `=` ; une ligne dont un blanc d'alignement porte une tabulation garde tous
// ses blancs (seuls ses noms changent), une tabulation d'indentation ne compte pas. Chromium, Firefox et WebKit réels, développement et production.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, type Moteur, type Page } from './helpers/graine-page.js'
import { attendreEtat, attendrePage } from './helpers/attente-page.js'

const NOMS = { panier: 'cart', liste: 'list', qte: 'quantity' }
const HOME = [
  '<script>',
  '  µmount ->',
  '    window.__lang = (l)-> µlang = l',
  '</script>',
  "<p class=\"titre\">{µt('titre')}</p>",
  '<@@code class="civet">',
  '  liste  := []',
  '  panier := 0',
  '</@@code>',
  '<@@code class="tab"><pre><code>$panier\t= 1  # a',
  '$qte\t= 2  # b</code></pre></@@code>',
  '<@@code class="indente"><pre><code>\t$panier = 1  # a',
  '\t$qte = 2</code></pre></@@code>',
].join('\n') + '\n'
const BLOCS = (n: number) => "<script>\n  µmount ->\n    window.__lang = (l)-> µlang = l\n</script>\n<p class=\"titre\">{µt('titre')}</p>\n" + Array.from({ length: n }, (_, i) => `<p>{µt('mot')}</p><@@code class="k${i}">\n  $panier = 1\n  $liste  = 2\n</@@code>`).join('\n') + '\n'

// pendant une bascule comptée : appels du programme (développement, µ joint à la page) et lectures / ajouts de nœuds dans un ensemble
const SONDES = `
  window.__n = 0; window.__compter = false
  const noeud = (x) => window.__compter && x && typeof x === 'object' && !!x.nodeType
  const lu = Set.prototype.has, ajout = Set.prototype.add
  Set.prototype.has = function (x) { if (noeud(x)) window.__n++; return lu.call(this, x) }
  Set.prototype.add = function (x) { if (noeud(x)) window.__n++; return ajout.call(this, x) }
`
const LIRE = `(() => {
  const h = document.querySelector('mjs-home')?._shadow
  const out = { titre: h?.querySelector('p.titre')?.textContent }
  for (const c of h?.querySelectorAll('mjs-core-code') ?? []) out[c.classList[0]] = c.textContent
  return out
})()`

describe('<@@code> : une passe par bloc à la bascule, colonnes des :=, lignes à tabulation (Chromium, Firefox, WebKit)', function () {
  this.timeout(280000)
  const navigateurs: Partial<Record<Moteur, any>> = {}

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    await terminateSharedWorkerPool()
  })

  const ouvrir = async (m: Moteur, page: Page) => {
    const ctx     = await navigateurs[m].newContext()
    const p       = await ctx.newPage()
    const erreurs: string[] = []
    p.on('pageerror', (e: any) => erreurs.push(String(e)))
    await p.addInitScript(SONDES)
    await p.goto(page.base + '/', { waitUntil: 'load' })
    await attendrePage(p, () => typeof (window as any).__lang === 'function' && !!(document.querySelector('mjs-home') as any)?._shadow?.querySelector('mjs-core-code'), null, 'la page est montée', 3000)
    return { ctx, p, erreurs }
  }
  const lire     = async (p: any) => await p.evaluate(LIRE) as Record<string, any>
  const basculer = async (p: any, l: string, titre: string, pret: (o: Record<string, any>) => boolean) => {
    await p.evaluate((x: string) => (window as any).__lang(x), l)
    await attendreEtat(async () => { const o = await lire(p); return o.titre === titre && pret(o) ? o : null }, 'la page passe en ' + l, 4000)
    // pause gardée : une passe qui viendrait après la traduction serait comptée
    await p.waitForTimeout(400)
  }

  for (const env of ['dev', 'prod'] as const) {
    describe(env, function () {
      const pages: Record<string, Page> = {}

      before(async function () {
        const racine = { fr: 'mot: panier\n', en: { mot: 'panier', mjs: { core: { code: NOMS } } } }
        pages.home = await construire({ nom: 'code-passe-home-' + env, composants: { home: HOME }, env, sansRendu: true, racine })
        pages.b10  = await construire({ nom: 'code-passe-b10-' + env, composants: { home: BLOCS(10) }, env, sansRendu: true, racine })
        pages.b50  = await construire({ nom: 'code-passe-b50-' + env, composants: { home: BLOCS(50) }, env, sansRendu: true, racine })
      })

      after(async function () {
        for (const page of Object.values(pages)) await page.fermer()
      })

      for (const m of MOTEURS) {
        it(`${m} : := aligné comme = ; ligne à tabulation d'alignement gardée telle quelle, tabulation d'indentation sans effet ; retour au texte d'origine`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          try {
            const avant = await lire(p)
            const en    = await basculer(p, 'en', 'Title', (o) => o.civet?.startsWith('list')).then(() => lire(p))
            assert.equal(en.civet, 'list := []\ncart := 0')
            assert.equal(en.tab, '$cart\t= 1  # a\n$quantity\t= 2  # b')
            assert.equal(en.indente, '\t$cart = 1    # a\n\t$quantity = 2')
            await basculer(p, 'fr', 'Titre', (o) => o.civet?.startsWith('liste'))
            const fr = await lire(p)
            for (const k of ['civet', 'tab', 'indente']) assert.equal(fr[k], avant[k], k)
            assert.deepEqual(erreurs, [])
          }
          finally {
            await ctx.close()
          }
        })

        it(`${m} : une bascule refait chaque bloc une fois — ${env === 'dev' ? 'dix appels du programme pour dix blocs' : 'les opérations croissent comme le nombre de blocs (10 puis 50)'}`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          const compter = async (page: Page, b: number) => {
            const { ctx, p, erreurs } = await ouvrir(m, page)
            try {
              const traduit = (o: Record<string, any>) => !!o['k' + (b - 1)]?.includes('$cart')
              await basculer(p, 'en', 'Title', traduit)
              await basculer(p, 'fr', 'Titre', (o) => !!o['k' + (b - 1)]?.includes('$panier'))
              const appels = await p.evaluate(() => {
                const w = window as any
                if (!w.µ?._codeNames) return null
                const brut = w.µ._codeNames
                w.__appels = 0
                w.µ._codeNames = function (...a: any[]) { w.__appels++; return brut.apply(this, a) }
                return 0
              })
              await p.evaluate(() => { (window as any).__n = 0; (window as any).__compter = true })
              await basculer(p, 'en', 'Title', traduit)
              assert.deepEqual(erreurs, [])
              return await p.evaluate((x: any) => { const w = window as any; w.__compter = false; return { n: w.__n, appels: x === null ? null : w.__appels } }, appels)
            }
            finally {
              await ctx.close()
            }
          }
          const c10 = await compter(pages.b10, 10)
          const c50 = await compter(pages.b50, 50)
          console.log(`      ${m} ${env} : 10 blocs ${JSON.stringify(c10)}, 50 blocs ${JSON.stringify(c50)}`)
          if (env === 'dev') assert.deepEqual([c10.appels, c50.appels], [10, 50])
          assert.ok(c50.n < 6 * c10.n, `50 blocs : ${c50.n} opérations pour ${c10.n} à 10 blocs (×${(c50.n / c10.n).toFixed(1)})`)
        })
      }
    })
  }
})
