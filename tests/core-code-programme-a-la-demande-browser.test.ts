// <@@code> : le programme qui traduit les noms de son code (parcours, noms, colonnes, retour au texte d'origine) ne part au navigateur que quand
// il sert. En production, il vit dans son propre fichier, écrit seulement quand l'appli emploie <@@code> : aucune requête tant que la langue
// affichée n'a pas de table `mjs.core.code`, une seule à la première bascule vers une langue qui en a une, aucune aux suivantes ; un fichier
// injoignable laisse le code tel quel, sans erreur, et la bascule suivante le redemande. En développement, le programme est au cœur : aucune
// requête, aucun fichier. Une appli sans <@@code> n'a pas ce fichier. Coût d'une bascule : l'ensemble des textes dynamiques se bâtit une fois
// (les comparaisons croissent comme le nombre de blocs, pas comme son carré). L'écouteur `slotchange` du module se retire au démontage.
// Chromium, Firefox et WebKit réels, développement et production.

import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, type Moteur, type Page } from './helpers/graine-page.js'
import { attendreEtat, attendrePage } from './helpers/attente-page.js'

const HOME = `<script>
  µmount ->
    window.__lang = (l)-> µlang = l
</script>
<p class="titre">{µt('titre')}</p>
<@@code class="a">
  $panier = []
  µ.aide()
</@@code>
<@@code class="b">$liste.push(1)</@@code>
`

const RIEN = `<script>
  µmount ->
    window.__lang = (l)-> µlang = l
</script>
<p class="titre">{µt('titre')}</p>
`

// `b` blocs colorés de dix lignes, chacun précédé d'un texte µt de la page
const LIGNE = '<span class="variable">$panier</span> <span class="punctuation">=</span> <span class="number">1</span>'
const COUT  = (b: number) => `<script>
  µmount ->
    window.__lang = (l)-> µlang = l
</script>
<p class="titre">{µt('titre')}</p>
${Array.from({ length: b }, (_, i) => `<p>{µt('mot')}</p><@@code class="b${i}"><pre><code>${Array.from({ length: 10 }, () => LIGNE).join('\n')}</code></pre></@@code>`).join('\n')}
`

const FR      = 'mot: panier\n'
const NOMS    = { panier: 'cart', liste: 'list', aide: 'help' }
const AVEC    = { mot: 'panier', mjs: { core: { code: NOMS } } }
const SANS    = { mot: 'panier' }
const ORIGINE = { a: '$panier = []\nµ.aide()', b: '$liste.push(1)' }
const TRADUIT = { a: '$cart = []\nµ.help()', b: '$list.push(1)' }

// écouteurs `slotchange` posés et retirés sur le slot d'un <@@code> ; pendant une bascule comptée, les comparaisons de la recherche des textes
// dynamiques : éléments parcourus par `includes` sur une liste de nœuds, lectures et ajouts de nœuds dans un ensemble
const SONDES = `
  window.__ecoute = { pose: 0, retire: 0 }
  const duCode  = (s) => s instanceof HTMLSlotElement && s.getRootNode().host?.localName === 'mjs-core-code'
  const poser   = EventTarget.prototype.addEventListener
  const retirer = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (t, ...a) { if (t === 'slotchange' && duCode(this)) window.__ecoute.pose++; return poser.call(this, t, ...a) }
  EventTarget.prototype.removeEventListener = function (t, ...a) { if (t === 'slotchange' && duCode(this)) window.__ecoute.retire++; return retirer.call(this, t, ...a) }
  window.__cmp     = 0
  window.__compter = false
  const noeud = (x) => window.__compter && x && typeof x === 'object' && !!x.nodeType
  const inc   = Array.prototype.includes
  Array.prototype.includes = function (x, ...a) { if (noeud(x)) window.__cmp += this.length; return inc.call(this, x, ...a) }
  const ajout = Set.prototype.add
  Set.prototype.add = function (x) { if (noeud(x)) window.__cmp++; return ajout.call(this, x) }
  const lu = Set.prototype.has
  Set.prototype.has = function (x) { if (noeud(x)) window.__cmp++; return lu.call(this, x) }
`

const LIRE = `(() => {
  const h   = document.querySelector('mjs-home')?._shadow
  const out = { titre: h?.querySelector('p.titre')?.textContent }
  for (const c of h?.querySelectorAll('mjs-core-code') ?? []) out[c.classList[0]] = c.textContent
  return out
})()`

const programmes = (page: Page) => readdirSync(page.sortie).filter((n) => /^mjs_code-.*\.js$/.test(n))

describe('<@@code> : le programme de la traduction des noms se charge seulement quand il sert (Chromium, Firefox, WebKit)', function () {
  this.timeout(600000)
  const navigateurs: Partial<Record<Moteur, any>> = {}

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    await terminateSharedWorkerPool()
  })

  // une page de la construction, dans un contexte neuf, sondes posées ; ses erreurs relevées, les requêtes du fichier du programme comptées
  // (tentatives refusées comprises) ; montée
  const ouvrir = async (m: Moteur, page: Page) => {
    const ctx     = await navigateurs[m].newContext()
    const p       = await ctx.newPage()
    const erreurs: string[] = []
    let demandes  = 0
    p.on('pageerror', (e: any) => erreurs.push(String(e)))
    p.on('request', (r: any) => { if (/\/mjs_code-[^/]*\.js/.test(r.url())) demandes++ })
    await p.addInitScript(SONDES)
    await p.goto(page.base + '/', { waitUntil: 'load' })
    await attendrePage(p, () => typeof (window as any).__lang === 'function' && !!(document.querySelector('mjs-home') as any)?._shadow?.querySelector('mjs-core-code'), null, 'la page est montée', 3000)
    return { ctx, p, erreurs, demandes: () => demandes }
  }

  const lire     = async (p: any) => await p.evaluate(LIRE) as Record<string, any>
  const code     = (o: Record<string, any>) => ({ a: o.a, b: o.b })
  const basculer = async (p: any, l: string, titre: string) => {
    await p.evaluate((x: string) => (window as any).__lang(x), l)
    await attendreEtat(async () => (await lire(p)).titre === titre || null, 'la page passe en ' + l, 3000)
  }

  for (const env of ['dev', 'prod'] as const) {
    describe(`${env}`, function () {
      const pages: Record<string, Page> = {}

      before(async function () {
        pages.avec = await construire({ nom: 'code-programme-avec-' + env, composants: { home: HOME }, env, sansRendu: true, racine: { fr: FR, en: AVEC } })
        pages.sans = await construire({ nom: 'code-programme-sans-' + env, composants: { home: HOME }, env, sansRendu: true, racine: { fr: FR, en: SANS } })
        pages.rien = await construire({ nom: 'code-programme-rien-' + env, composants: { home: RIEN }, env, sansRendu: true, racine: { fr: FR, en: AVEC } })
        pages.c10  = await construire({ nom: 'code-programme-c10-' + env, composants: { home: COUT(10) }, env, sansRendu: true, racine: { fr: FR, en: AVEC } })
        pages.c50  = await construire({ nom: 'code-programme-c50-' + env, composants: { home: COUT(50) }, env, sansRendu: true, racine: { fr: FR, en: AVEC } })
      })

      after(async function () {
        for (const page of Object.values(pages)) await page.fermer()
      })

      it(`fichier du programme : ${env === 'prod' ? 'un seul, écrit pour une appli qui emploie <@@code>, même sans table' : 'aucun, le programme est au cœur'} ; aucun pour une appli sans <@@code>`, function () {
        assert.equal(programmes(pages.avec).length, env === 'prod' ? 1 : 0)
        assert.equal(programmes(pages.sans).length, env === 'prod' ? 1 : 0)
        assert.equal(programmes(pages.rien).length, 0)
      })

      for (const m of MOTEURS) {
        it(`${m} : aucune requête du programme en français, ${env === 'prod' ? 'une seule à la première bascule vers l\'anglais (qui a une table)' : 'aucune à la bascule (programme au cœur)'}, aucune aux suivantes ; code traduit puis rendu`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.avec.poser({})
          const { ctx, p, erreurs, demandes } = await ouvrir(m, pages.avec)
          try {
            assert.deepEqual(code(await lire(p)), ORIGINE)
            assert.equal(demandes(), 0, 'aucune requête en français')
            await basculer(p, 'en', 'Title')
            const en = await attendreEtat(async () => { const o = await lire(p); return o.a === TRADUIT.a && o.b === TRADUIT.b ? o : null }, 'le code est traduit', 3000).catch(() => lire(p))
            assert.deepEqual(code(en), TRADUIT)
            assert.equal(demandes(), env === 'prod' ? 1 : 0, 'une requête à la première bascule')
            await basculer(p, 'fr', 'Titre')
            assert.deepEqual(code(await attendreEtat(async () => { const o = await lire(p); return o.a === ORIGINE.a ? o : null }, 'le texte d\'origine est rendu', 3000).catch(() => lire(p))), ORIGINE)
            await basculer(p, 'en', 'Title')
            assert.deepEqual(code(await attendreEtat(async () => { const o = await lire(p); return o.a === TRADUIT.a ? o : null }, 'le code est traduit une seconde fois', 3000).catch(() => lire(p))), TRADUIT)
            assert.equal(demandes(), env === 'prod' ? 1 : 0, 'aucune requête aux bascules suivantes')
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : langue sans table — la bascule ne demande pas le programme, le code reste tel quel`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.sans.poser({})
          const { ctx, p, erreurs, demandes } = await ouvrir(m, pages.sans)
          try {
            await basculer(p, 'en', 'Title')
            // pause gardée : une requête qui partirait après l'arrivée du fichier anglais (réveil des lecteurs de libellés) serait comptée
            await p.waitForTimeout(300)
            assert.equal(demandes(), 0)
            assert.deepEqual(code(await lire(p)), ORIGINE)
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : programme injoignable (réseau) — le code reste tel quel, aucune erreur ; la bascule suivante le redemande et traduit`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.avec.poser({})
          const { ctx, p, erreurs, demandes } = await ouvrir(m, pages.avec)
          let couper = true
          await ctx.route(/\/mjs_code-[^/]*\.js/, (r: any) => couper ? r.abort() : r.continue())
          try {
            await basculer(p, 'en', 'Title')
            // pause gardée : le refus du fichier arrive, ou une traduction qui viendrait quand même, dans ce délai ; en développement, le
            // programme est au cœur, rien à refuser : le code est traduit
            await p.waitForTimeout(400)
            assert.deepEqual(code(await lire(p)), env === 'prod' ? ORIGINE : TRADUIT)
            assert.equal(demandes(), env === 'prod' ? 1 : 0)
            couper = false
            await basculer(p, 'fr', 'Titre')
            await basculer(p, 'en', 'Title')
            const en = await attendreEtat(async () => { const o = await lire(p); return o.a === TRADUIT.a && o.b === TRADUIT.b ? o : null }, 'le code est traduit au nouvel essai', 3000).catch(() => lire(p))
            assert.deepEqual(code(en), TRADUIT)
            assert.equal(demandes(), env === 'prod' ? 2 : 0)
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : coût d'une bascule — les comparaisons de la recherche des textes dynamiques croissent comme le nombre de blocs (10 puis 50 blocs de dix lignes, chacun avec un texte µt)`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          const compter = async (page: Page, b: number) => {
            page.poser({})
            const { ctx, p, erreurs } = await ouvrir(m, page)
            try {
              await p.evaluate(() => { (window as any).__cmp = 0; (window as any).__compter = true })
              await basculer(p, 'en', 'Title')
              await attendreEtat(async () => { const o = await lire(p); return o.b0?.startsWith('$cart') && o['b' + (b - 1)]?.startsWith('$cart') || null }, 'les blocs sont traduits', 4000)
              // pause gardée : une recherche qui viendrait après la traduction serait comptée
              await p.waitForTimeout(300)
              assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
              return await p.evaluate(() => { (window as any).__compter = false; return (window as any).__cmp }) as number
            } finally {
              await ctx.close()
            }
          }
          const c10 = await compter(pages.c10, 10)
          const c50 = await compter(pages.c50, 50)
          console.log(`      comparaisons ${m} ${env} : 10 blocs ${c10}, 50 blocs ${c50}`)
          assert.ok(c50 < 8 * c10, `50 blocs : ${c50} comparaisons pour ${c10} à 10 blocs (×${(c50 / c10).toFixed(1)})`)
        })

        it(`${m} : l'écouteur slotchange de <@@code> se retire au démontage`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.avec.poser({})
          const { ctx, p, erreurs } = await ouvrir(m, pages.avec)
          try {
            const avant = await p.evaluate(() => ({ ...(window as any).__ecoute }))
            assert.ok(avant.pose >= 2, `écouteurs posés : ${avant.pose}`)
            await p.evaluate(() => { (document.querySelector('mjs-home') as any)._shadow.querySelector('mjs-core-code.a').remove() })
            const retire = await attendreEtat(() => p.evaluate(() => (window as any).__ecoute.retire || null), 'l\'écouteur est retiré', 2000).catch(() => 0)
            assert.equal(retire, avant.retire + 1)
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })
      }
    })
  }
})
