// `@flip` : chaque balise racine d'une ligne de `{for}` garde SA place d'une passe à l'autre, même quand une balise voisine de la
// même ligne disparaît ou revient (un `{if}` qui se ferme ou se rouvre).
// Chromium et Firefox réels, en développement et en production (noms de propriétés raccourcis, code minifié).
// Le FLIP étiquette chaque balise `@flip`, mesure sa place avant la réconciliation puis après, et la fait glisser de l'ancienne
// place à la nouvelle. Chaque scénario part de quatre lignes a b c d, pose un état de départ si besoin, relève la place de chaque
// balise (son `data-k`), pose l'état d'arrivée, et juge chaque balise 150 ms plus tard :
//  - une balise qui a bougé glisse, et son premier keyframe vaut l'écart entre l'ancienne et la nouvelle place, à 1,5 px près ;
//  - une balise qui n'a pas bougé reste immobile ; une balise neuve ne s'anime pas ; aucune balise n'a deux glissements.
// Les formes : deux, trois balises racines, chacune sous son `{if}` ; une balise fixe entre deux `{if}` ; une balise fixe avant deux
// `{if}` ; un `{if}` avec `{else}` ; un `{if}` dans un `{if}` ; `{elsif}` ; un `{if}` à deux balises et un `{else}` à une ; un `{key}`
// entre deux balises fixes ; une liste sans `by` ; une clé `0` et une clé vide.
// Sauté, avec un message, quand le navigateur n'est pas installé.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Construction = { nom: string, env: 'dev' | 'prod', runtime: 'all' | string[] }

const CONSTRUCTIONS: Construction[] = [
  { nom: 'développement', env: 'dev', runtime: 'all' },
  { nom: 'production', env: 'prod', runtime: 'all' },
  { nom: 'production, runtime réduit', env: 'prod', runtime: ['flip'] },
]

// la ligne d'une liste ; `a`, `b`, `c` commandent les `{if}`, `v` le `{key}`
const ligne = (t: string, plus: Record<string, unknown> = {}) => ({ cid: t, t, a: true, b: true, c: true, v: 1, ...plus })
const off   = (t: string, ...drapeaux: string[]) => ligne(t, Object.fromEntries(drapeaux.map((d) => [d, false])))
const L     = (...ts: string[]) => ts.map((t) => ligne(t))
const BASE  = L('a', 'b', 'c', 'd')

// une balise `@flip` : fixe (F), sous son `{if}` (R) ; `k` est le suffixe de son data-k
const F = (k: string) => `<li @flip=5000 data-k="{it.t}${k}">{it.t}${k}</li>`
const R = (drapeau: string, k: string) => `{if it.${drapeau}}${F(k)}{end}`

type Forme = { corps: string, v?: boolean }
const FORMES: Record<string, Forme> = {
  deuxIf:           { corps: `${R('a', '')}\n    ${R('b', '-2')}` },
  troisIf:          { corps: `${R('a', '')}\n    ${R('b', '-2')}\n    ${R('c', '-3')}` },
  troisMilieuIf:    { corps: `${F('')}\n    ${R('b', '-2')}\n    ${F('-3')}` },
  troisPremierFixe: { corps: `${F('')}\n    ${R('b', '-2')}\n    ${R('c', '-3')}` },
  deuxIfElse:       { corps: `{if it.a}<li @flip=5000 data-k="{it.t}">{it.t}</li>{else}<li @flip=5000 data-k="{it.t}">{it.t} off</li>{end}\n    {if it.b}<li @flip=5000 data-k="{it.t}-2">{it.t}-2</li>{else}<li @flip=5000 data-k="{it.t}-2">{it.t}-2 off</li>{end}` },
  ifDansIf:         { corps: `{if it.a}\n      ${F('')}\n      {if it.b}${F('-2')}{end}\n      ${F('-3')}\n    {end}` },
  elsif:            { corps: `{if it.a}<li @flip=5000 data-k="{it.t}">{it.t}</li>{elsif it.b}<li @flip=5000 data-k="{it.t}">{it.t} b</li>{else}<li @flip=5000 data-k="{it.t}">{it.t} off</li>{end}\n    ${F('-2')}` },
  ifDeuxElseUne:    { corps: `{if it.a}\n      ${F('')}\n      ${F('-2')}\n    {else}\n      <li @flip=5000 data-k="{it.t}">{it.t} off</li>\n    {end}` },
  keyEntreFixes:    { corps: `${F('')}\n    {key it.v}${F('-2')}{end}\n    ${F('-3')}`, v: true },
}

// scénarios : état de départ facultatif, état d'arrivée
type Scenario = { nom: string, avant?: any[], apres: any[] }
const SCENARIOS: Scenario[] = [
  { nom: 'réordre témoin',                          apres: L('d', 'b', 'a', 'c') },
  { nom: 'réordre + la première balise de b part',  apres: [ligne('d'), off('b', 'a'), ligne('a'), ligne('c')] },
  { nom: 'réordre + la deuxième balise de b part',  apres: [ligne('d'), off('b', 'b'), ligne('a'), ligne('c')] },
  { nom: 'la première balise de b part, sans réordre', apres: [ligne('a'), off('b', 'a'), ligne('c'), ligne('d')] },
  { nom: 'réordre + la troisième balise de b part', apres: [ligne('d'), off('b', 'c'), ligne('a'), ligne('c')] },
  { nom: 'réordre + la première balise de chaque ligne part', apres: [off('d', 'a'), off('b', 'a'), off('a', 'a'), off('c', 'a')] },
  { nom: 'b sans sa première balise, puis réordre et elle revient', avant: [ligne('a'), off('b', 'a'), ligne('c'), ligne('d')], apres: L('d', 'b', 'a', 'c') },
  { nom: 'réordre + les deux premières balises de b partent', apres: [ligne('d'), off('b', 'a', 'b'), ligne('a'), ligne('c')] },
  { nom: 'réordre + la clé du `{key}` de a et c change', apres: [ligne('d'), ligne('b'), ligne('a', { v: 2 }), ligne('c', { v: 2 })] },
]

// `lit` : un objet ou un tableau JavaScript, écrit en littéral du script du composant
const lit = (o: any): string => Array.isArray(o) ? '[' + o.map(lit).join(', ') + ']' : (o && typeof o === 'object') ? '{ ' + Object.entries(o).map(([k, v]) => k + ': ' + lit(v)).join(', ') + ' }' : typeof o === 'string' ? JSON.stringify(o) : String(o)
const maj = (n: string) => n[0].toUpperCase() + n.slice(1)

// une liste par forme (`by cid`), chacune sur ses données : une liste ne lit que les siennes, sans quoi la hauteur de l'une changerait la place de celles du dessous
const NOMS_FORMES = Object.keys(FORMES)
const SANS_BY     = { a: { id: 1, t: 'a' }, b: { id: 2, t: 'b' }, c: { id: 3, t: 'c' }, d: { id: 4, t: 'd' }, e: { id: 5, t: 'e' } }
// l'étiquette d'une ligne est fixée à sa création : une clé absente (`null`, `undefined`) y devient l'indice de création, une clé `0` ou vide reste elle-même.
// `1` avant `0` et `3` après `''` : si `0` ou `''` retombait sur l'indice de création (1 et 3), ces lignes prendraient l'étiquette des lignes de clé 1 et 3
const CLES        = [{ cid: 1, t: 'u' }, { cid: 0, t: 'z' }, { cid: 2, t: 'w' }, { cid: '', t: 'v' }, { cid: 3, t: 'x' }]

const script = `<script>
${NOMS_FORMES.map((n) => `  $${n} = ${lit(BASE)}`).join('\n')}
  sansByTous = ${lit(SANS_BY)}
  $sansBy    = [sansByTous.a, sansByTous.b, sansByTous.c, sansByTous.d]
  $cles0     = ${lit(CLES)}
  $cles0Deux = ${lit(CLES)}

${NOMS_FORMES.map((n) => `  @pose${maj(n)} = (l) -> $${n} = l`).join('\n')}
  @poseSansBy   = (ts) -> $sansBy = ts.map((t) -> sansByTous[t])
  @poseCles0    = (l) -> $cles0 = l
  @poseCles0Deux = (l) -> $cles0Deux = l
</script>
`

const listes = [
  ...NOMS_FORMES.map((n) => `<ul class="${n}">\n  {for it in $${n} by cid}\n    ${FORMES[n].corps}\n  {end}\n</ul>\n`),
  `<ul class="sansBy">\n  {for it in $sansBy}\n    ${F('')}\n    ${F('-2')}\n  {end}\n</ul>\n`,
  `<ul class="cles0">\n  {for it in $cles0 by cid}\n    ${F('')}\n  {end}\n</ul>\n`,
  `<ul class="cles0Deux">\n  {for it in $cles0Deux by cid}\n    ${F('')}\n    ${F('-2')}\n  {end}\n</ul>\n`,
]

const STYLE = `<style>
  ul
    list-style: none
    padding: 0
    margin: 8px 0

  li
    min-height: 24px
</style>
`

const COMPOSANT = script + '\n' + listes.join('\n') + '\n' + STYLE
const TAG       = 'mjs-flip-places'

async function construire(c: Construction): Promise<{ root: string, outDir: string }> {
  const root   = mjsTmp('flip-places-racines')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'flip-places.mjs'), COMPOSANT)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: c.env, runtime: c.runtime, js: 'split' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return { root, outDir }
}

async function servir(root: string, outDir: string): Promise<{ url: string, server: Server }> {
  const html   = `<!doctype html><html><head><meta charset="utf-8"></head><body><${TAG}></${TAG}><script type="module" src="/out/bundle.js"></script></body></html>`
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  return { url: `http://127.0.0.1:${(server.address() as any).port}/`, server }
}

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// le nombre de balises `data-k` de chaque liste
const COMPTER = ([tag, classes]: [string, string[]]) => {
  const racine = (document.querySelector(tag) as any)?._shadow
  const out: Record<string, number> = {}
  for (const c of classes) out[c] = racine ? racine.querySelectorAll('.' + c + ' [data-k]').length : 0
  return out
}

// coupe toutes les animations de la liste
const CALMER = ([tag, classe]: [string, string]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  for (const el of Array.from(racine.querySelectorAll('.' + classe + ' *')) as any[]) el.getAnimations().forEach((a: any) => a.cancel())
}

// la place de chaque balise de la liste, par son `data-k`
const MESURER = ([tag, classe]: [string, string]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const out    = {} as Record<string, number[]>
  for (const el of Array.from(racine.querySelectorAll('.' + classe + ' [data-k]')) as any[]) {
    const r = el.getBoundingClientRect()
    out[el.getAttribute('data-k')] = [r.left, r.top]
  }
  return out
}

// juge chaque balise après le changement, puis coupe les animations ; rend le détail et les cas mauvais
const JUGER = ([tag, classe, avant]: [string, string, Record<string, number[]>]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const lus    = (Array.from(racine.querySelectorAll('.' + classe + ' [data-k]')) as any[]).map((el) => {
    const flips  = el.getAnimations().filter((a: any) => a.id === 'mjs-flip')
    const m      = flips.length ? /translate\((-?[\d.e+-]+)px,\s*(-?[\d.e+-]+)px\)/.exec(String(flips[0].effect.getKeyframes()[0].transform || '')) : null
    return { el, k: el.getAttribute('data-k'), n: flips.length, depart: m ? [parseFloat(m[1]), parseFloat(m[2])] : null }
  })
  for (const el of Array.from(racine.querySelectorAll('.' + classe + ' *')) as any[]) el.getAnimations().forEach((a: any) => a.cancel())
  const verdicts = lus.map(({ el, k, n, depart }) => {
    const r = el.getBoundingClientRect()
    const a = avant[k]
    let v: string
    if (!a) v = n ? 'MAUVAIS neuve animée' : 'neuve'
    else {
      const dx    = a[0] - r.left
      const dy    = a[1] - r.top
      const bouge = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5
      if (!n) v = bouge ? 'MAUVAIS muette (a bougé de ' + Math.round(dx) + ',' + Math.round(dy) + ')' : 'immobile'
      else if (!bouge) v = 'MAUVAIS animée sans bouger'
      else if (!depart) v = 'MAUVAIS départ illisible'
      else if (Math.abs(depart[0] - dx) < 1.5 && Math.abs(depart[1] - dy) < 1.5) v = n > 1 ? 'MAUVAIS ' + n + ' glissements' : 'glisse'
      else v = 'MAUVAIS part de ' + Math.round(depart[0]) + ',' + Math.round(depart[1]) + ' au lieu de ' + Math.round(dx) + ',' + Math.round(dy)
    }
    return k + ':' + v
  })
  return { detail: verdicts.join(' | '), mauvais: verdicts.filter((v) => v.includes('MAUVAIS')) }
}

describe('@flip — chaque balise racine d\'une ligne garde sa place quand une voisine disparaît ou revient (navigateurs réels)', function () {
  this.timeout(240000)
  const sorties = new Map<string, { root: string, outDir: string }>()

  before(async function () {
    this.timeout(180000)
    for (const c of CONSTRUCTIONS) sorties.set(c.nom, await construire(c))
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const c of CONSTRUCTIONS) {
    for (const nav of ['chromium', 'firefox'] as const) {
      describe(`${c.nom} · ${nav}`, function () {
        let browser: any
        let page: any
        let server: Server
        let erreurs: string[]

        before(async function () {
          if (!(await navigateurPresent(nav))) {
            console.log(`  ℹ️  ${nav} non installé, test sauté. Activer : \`npx playwright install ${nav}\``)
            return this.skip()
          }
          const { root, outDir } = sorties.get(c.nom)!
          const serveur          = await servir(root, outDir)
          const playwright       = await import('playwright')
          server  = serveur.server
          browser = await playwright[nav].launch()
          page    = await (await browser.newContext({ viewport: { width: 800, height: 700 } })).newPage()
          erreurs = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
          await page.goto(serveur.url, { waitUntil: 'load' })
          const classes = [...NOMS_FORMES, 'sansBy', 'cles0', 'cles0Deux']
          await page.waitForFunction(([tag, cl]: [string, string[]]) => {
            const racine = (document.querySelector(tag) as any)?._shadow
            return !!racine && cl.every((n) => racine.querySelectorAll('.' + n + ' [data-k]').length > 0)
          }, [TAG, classes], { timeout: 90000 })
          await page.waitForTimeout(150)
        })

        after(async () => {
          await browser?.close()
          if (server) await new Promise((resolve) => server.close(() => resolve(null)))
        })

        beforeEach(() => { erreurs.length = 0 })

        const poser  = async (liste: string, lignes: any[]) => {
          await page.evaluate(([fn, l]: [string, any[]]) => { (document.querySelector('mjs-flip-places') as any)[fn](l) }, ['pose' + maj(liste), lignes])
          await page.waitForTimeout(150)
        }
        const calmer = (liste: string) => page.evaluate(CALMER, [TAG, liste])

        // joue un scénario : retour à la base, état de départ facultatif, relevé des places, état d'arrivée, jugement
        const jouer = async (liste: string, base: any[], sc: { avant?: any[], apres: any[] }) => {
          await poser(liste, base)
          await calmer(liste)
          if (sc.avant) {
            await poser(liste, sc.avant)
            await calmer(liste)
          }
          const avant = await page.evaluate(MESURER, [TAG, liste])
          await poser(liste, sc.apres)
          return page.evaluate(JUGER, [TAG, liste, avant])
        }

        // joue tous les scénarios d'une forme et rend les cas mauvais, scénario par scénario
        const rejouer = async (liste: string, scenarios: Scenario[], base: any[] = BASE) => {
          const problemes: string[] = []
          for (const sc of scenarios) {
            const r = await jouer(liste, base, sc)
            if (r.mauvais.length) problemes.push(sc.nom + ' → ' + r.detail)
          }
          return problemes
        }

        it('au premier rendu, chaque liste a ses balises et aucune ne s\'anime', async () => {
          const comptes = await page.evaluate(COMPTER, [TAG, NOMS_FORMES])
          for (const n of NOMS_FORMES) assert.ok(comptes[n] >= 4, `${n} : ${comptes[n]} balises`)
          const animees = await page.evaluate(([tag]: [string]) => Array.from((document.querySelector(tag) as any)._shadow.querySelectorAll('[data-k]')).filter((el: any) => el.getAnimations().length).length, [TAG])
          assert.equal(animees, 0)
          assert.deepEqual(erreurs, [])
        })

        for (const nom of NOMS_FORMES) {
          it(`${nom} : chaque balise glisse depuis sa propre place, quelle que soit la voisine qui part ou revient`, async () => {
            const scenarios = FORMES[nom].v ? SCENARIOS : SCENARIOS.filter((s) => !s.nom.includes('`{key}`'))
            assert.deepEqual(await rejouer(nom, scenarios), [])
            assert.deepEqual(erreurs, [])
          })
        }

        it('liste sans `by`, deux balises racines : chacune glisse depuis sa propre place', async () => {
          const scenarios: Scenario[] = [
            { nom: 'réordre', apres: ['d', 'b', 'a', 'c'] as any[] },
            { nom: 'ligne neuve en tête', apres: ['e', 'a', 'b', 'c', 'd'] as any[] },
            { nom: 'une ligne part', apres: ['a', 'c', 'd'] as any[] },
          ]
          assert.deepEqual(await rejouer('sansBy', scenarios, ['a', 'b', 'c', 'd']), [])
          assert.deepEqual(erreurs, [])
        })

        it('clés `0` et vide, une balise racine : chaque ligne glisse depuis sa propre place', async () => {
          const l = Object.fromEntries(CLES.map((x) => [x.t, x]))
          const scenarios: Scenario[] = [
            { nom: 'réordre', apres: ['v', 'x', 'z', 'u', 'w'].map((t) => l[t]) },
            { nom: 'second réordre', apres: ['w', 'u', 'x', 'v', 'z'].map((t) => l[t]) },
            { nom: 'ligne neuve en tête', apres: [{ cid: 4, t: 'y' }, ...['z', 'u', 'v', 'w', 'x'].map((t) => l[t])] },
          ]
          assert.deepEqual(await rejouer('cles0', scenarios, CLES), [])
          assert.deepEqual(erreurs, [])
        })

        it('clés `0` et vide, deux balises racines : chaque balise glisse depuis sa propre place', async () => {
          const l = Object.fromEntries(CLES.map((x) => [x.t, x]))
          const scenarios: Scenario[] = [
            { nom: 'réordre', apres: ['v', 'x', 'z', 'u', 'w'].map((t) => l[t]) },
            { nom: 'second réordre', apres: ['w', 'u', 'x', 'v', 'z'].map((t) => l[t]) },
          ]
          assert.deepEqual(await rejouer('cles0Deux', scenarios, CLES), [])
          assert.deepEqual(erreurs, [])
        })
      })
    }
  }
})
