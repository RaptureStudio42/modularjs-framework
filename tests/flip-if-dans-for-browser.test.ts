// `@flip` sur une ligne de `{for}` dont la racine porte un `{if}`, un `{else}` ou un `{key}`, avec ou sans texte autour : au
// réordre, la ligne s'anime comme une ligne sans bloc, en partant de son ancienne place. Chromium et Firefox réels, en
// développement et en production (noms de propriétés raccourcis, code minifié).
// Le FLIP relève les nœuds d'une ligne dans le DOM vivant, d'un bout à l'autre de la ligne, avant la réconciliation puis après :
// ce qu'un bloc de la racine insère entre ses marqueurs, ou remplace pendant le réordre, est relevé comme le reste.
//  1. cinq formes de liste, même réordre : seule `{for}` > `{if}` > `<li @flip>` change de compte ; les quatre autres (ligne
//     seule, `.filter(…)`, `{if}` DANS la ligne, `{if}` dans un `<div>` de la ligne) gardent exactement le leur ;
//  2. une ligne née plus tard (sa condition passe à vrai) : ses voisins glissent à sa naissance, puis elle s'anime à son
//     tour au réordre suivant, comme la liste filtrée qui sert de témoin ;
//  3. du texte autour du `{if}` : la ligne compte plus de deux nœuds à la racine, tous relevés ;
//  4. un `{if}{else}` dont les deux branches portent `@flip` : une ligne qui change de branche en bougeant s'anime, dans un
//     sens comme dans l'autre, alors que son `<li>` est recréé ;
//  5. un `{key}` à la racine de la ligne : une ligne dont la clé change pendant le réordre s'anime de même.
// Les animations se comptent par ligne (`getAnimations()`) 150 ms après le changement : la durée de 5 s les garde en vol. Pour
// les cas 3 à 5, le premier keyframe de l'animation vaut aussi l'écart entre l'ancienne et la nouvelle place de la ligne.
// Sauté, avec un message, quand le navigateur n'est pas installé.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Construction = { nom: string, env: 'dev' | 'prod', runtime: 'all' | string[] }

const CONSTRUCTIONS: Construction[] = [
  { nom: 'développement', env: 'dev', runtime: 'all' },
  { nom: 'production', env: 'prod', runtime: 'all' },
  { nom: 'production, runtime réduit', env: 'prod', runtime: ['flip'] },
]

const TOUS   = '[{ id: 1, t: \'a\', on: true }, { id: 2, t: \'b\', on: true }, { id: 3, t: \'c\', on: true }, { id: 4, t: \'d\', on: true }]'
const SANS_B = '[{ id: 1, t: \'a\', on: true }, { id: 2, t: \'b\', on: false }, { id: 3, t: \'c\', on: true }, { id: 4, t: \'d\', on: true }]'
const STYLE  = '\n<style>\n  ul\n    list-style: none\n    padding: 0\n    margin: 8px 0\n\n  li, div\n    min-height: 24px\n</style>\n'

// les quatre lignes de RACINES : `on` commande le `{if}` entouré de texte, `v` la clé du `{key}`, `b` la branche du `{if}{else}` ; chaque
// liste ne lit que son champ, sans quoi la hauteur de l'une changerait la place de celles du dessous, ce que le FLIP d'une liste ne voit pas
const TOUS_R = '[{ id: 1, t: \'a\', on: true, v: 1, b: true }, { id: 2, t: \'b\', on: true, v: 1, b: true }, { id: 3, t: \'c\', on: true, v: 1, b: true }, { id: 4, t: \'d\', on: true, v: 1, b: true }]'

// cinq listes sur les mêmes données : la forme visée, le témoin, et les trois autres places possibles du `{if}`
const FORMES = `<script>
  $items = ${TOUS}
  @pose = (l) -> $items = l
</script>

<ul class="if-in-for">
  {for it in $items by id}
    {if it.on}
      <li @flip=5000>{it.t}</li>
    {end}
  {end}
</ul>

<ul class="plain">
  {for it in $items by id}
    <li @flip=5000>{it.t}</li>
  {end}
</ul>

<ul class="filtered">
  {for it in $items.filter((x)-> x.on) by id}
    <li @flip=5000>{it.t}</li>
  {end}
</ul>

<ul class="inside-row">
  {for it in $items by id}
    <li @flip=5000>{if it.on}<b>{it.t}</b>{end}</li>
  {end}
</ul>

<ul class="inside-div">
  {for it in $items by id}
    <div>
      {if it.on}
        <li @flip=5000>{it.t}</li>
      {end}
    </div>
  {end}
</ul>
${STYLE}`

// la ligne `b` démarre cachée : la forme visée et la liste filtrée montrent les mêmes lignes à chaque étape
const NAISSANCE = `<script>
  $items = ${SANS_B}
  @pose = (l) -> $items = l
</script>

<ul class="if-in-for">
  {for it in $items by id}
    {if it.on}
      <li @flip=5000>{it.t}</li>
    {end}
  {end}
</ul>

<ul class="filtered">
  {for it in $items.filter((x)-> x.on) by id}
    <li @flip=5000>{it.t}</li>
  {end}
</ul>
${STYLE}`

// trois listes sur les mêmes données, dont la racine de ligne n'est pas un simple `{if}` : du texte autour du `{if}`, un `{if}{else}`
// dont les deux branches portent `@flip`, un `{key}` ; `data-k` nomme la ligne d'une branche ou d'une clé à l'autre, le `<li>` étant recréé
const RACINES = `<script>
  $items = ${TOUS_R}
  @pose = (l) -> $items = l
</script>

<ul class="text-around">
  {for it in $items by id}
    avant {if it.on}<li @flip=5000 data-k="{it.t}">{it.t}</li>{end} apres
  {end}
</ul>

<ul class="if-else">
  {for it in $items by id}
    {if it.b}
      <li @flip=5000 data-k="{it.t}">{it.t}</li>
    {else}
      <li @flip=5000 data-k="{it.t}">{it.t} off</li>
    {end}
  {end}
</ul>

<ul class="key-root">
  {for it in $items by id}
    {key it.v}
      <li @flip=5000 data-k="{it.t}">{it.t}</li>
    {end}
  {end}
</ul>
${STYLE}`

const COMPOSANTS: Record<string, string> = { 'flip-formes': FORMES, 'flip-naissance': NAISSANCE, 'flip-racines': RACINES }

const FORMES_TAG    = 'mjs-flip-formes'
const NAISSANCE_TAG = 'mjs-flip-naissance'
const CLASSES       = ['if-in-for', 'plain', 'filtered', 'inside-row', 'inside-div']
const CLASSES_NAISS = ['if-in-for', 'filtered']

const RACINES_TAG     = 'mjs-flip-racines'
const CLASSES_RACINES = ['text-around', 'if-else', 'key-root']

const LIGNE = (t: string, on = true, plus = {}) => ({ id: 'abcd'.indexOf(t) + 1, t, on, v: 1, b: true, ...plus })
const ORDRE = (...ts: string[]) => ts.map((t) => LIGNE(t))

async function construire(c: Construction): Promise<{ root: string, outDir: string }> {
  const root   = mjsTmp('flip-if-dans-for')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: c.env, runtime: c.runtime, js: 'split' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return { root, outDir }
}

async function servir(root: string, outDir: string): Promise<{ url: string, server: Server }> {
  const html   = `<!doctype html><html><head><meta charset="utf-8"></head><body><${FORMES_TAG}></${FORMES_TAG}><${NAISSANCE_TAG}></${NAISSANCE_TAG}><${RACINES_TAG}></${RACINES_TAG}><script type="module" src="/out/bundle.js"></script></body></html>`
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

// le texte de chaque ligne de chaque liste, suivi de son nombre d'animations en cours : `d:1 b:0 a:1 c:1`
const LIRE = ([tag, classes]: [string, string[]]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const out: Record<string, string> = {}
  for (const c of classes) out[c] = Array.from(racine.querySelectorAll('.' + c + ' li')).map((li: any) => li.textContent.trim() + ':' + li.getAnimations().length).join(' ')
  return out
}

// la place de chaque ligne des listes (par son `data-k`), à relever au repos avant un changement ; chaque `<li>` est marqué
// pour reconnaître ensuite ceux qui ont été recréés
const PLACER = ([tag, classes]: [string, string[]]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const out    = {} as Record<string, Record<string, number[]>>
  for (const c of classes) {
    out[c] = {}
    for (const li of Array.from(racine.querySelectorAll('.' + c + ' li')) as any[]) {
      const r              = li.getBoundingClientRect()
      li._avant            = true
      out[c][li.dataset.k] = [r.left, r.top]
    }
  }
  return out
}

// après le changement, pour chaque liste : le nombre d'animations de chaque ligne (`k:n`), les lignes dont l'animation FLIP part
// de l'ancienne place (premier keyframe = ancienne place - nouvelle place, la nouvelle étant mesurée animations coupées), puis
// les lignes dont le `<li>` est recréé
const ANALYSER = ([tag, classes, avant]: [string, string[], Record<string, Record<string, number[]>>]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const lus    = [] as any[]
  for (const c of classes) {
    for (const li of Array.from(racine.querySelectorAll('.' + c + ' li')) as any[]) {
      const flip = li.getAnimations().find((a: any) => a.id === 'mjs-flip')
      const m    = flip ? /translate\((-?[\d.e+-]+)px,\s*(-?[\d.e+-]+)px\)/.exec(String(flip.effect.getKeyframes()[0].transform)) : null
      lus.push({ c, li, k: li.dataset.k, n: li.getAnimations().length, depart: m ? [parseFloat(m[1]), parseFloat(m[2])] : null, neuf: !li._avant })
    }
  }
  for (const li of Array.from(racine.querySelectorAll('li')) as any[]) li.getAnimations().forEach((a: any) => a.cancel())
  const out = {} as Record<string, { animations: string, departs: string, neufs: string }>
  for (const c of classes) {
    const l = lus.filter((x) => x.c === c)
    out[c] = {
      animations: l.map((x) => x.k + ':' + x.n).join(' '),
      departs:    l.filter((x) => x.n).map((x) => {
        const r  = x.li.getBoundingClientRect()
        const dx = avant[c][x.k][0] - r.left
        const dy = avant[c][x.k][1] - r.top
        return x.depart && Math.abs(x.depart[0] - dx) < 1 && Math.abs(x.depart[1] - dy) < 1 ? x.k : x.k + '!(' + x.depart + ' au lieu de ' + dx + ',' + dy + ')'
      }).join(' '),
      neufs:      l.filter((x) => x.neuf).map((x) => x.k).join(' ')
    }
  }
  return out
}

describe('@flip — ligne sous un bloc ({if}, {else}, {key}) à la racine d\'un {for} (navigateurs réels)', function () {
  this.timeout(180000)
  const sorties = new Map<string, { root: string, outDir: string }>()

  before(async function () {
    this.timeout(120000)
    for (const c of CONSTRUCTIONS) sorties.set(c.nom, await construire(c))
  })

  after(async () => { await terminateSharedWorkerPool() })

  describe('constructions', () => {
    // le nom que l'enveloppe FLIP appelle est défini dans un autre fichier du runtime : en production il est raccourci
    // des deux côtés ou nulle part, et la preuve que la production teste bien le raccourcissement est dans le texte construit
    const NOM   = '_mjs_liveEntryNodes'
    const texte = (outDir: string) => readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')

    it('développement : le nom est écrit en clair', () => {
      assert.ok(texte(sorties.get('développement')!.outDir).includes(NOM + ' = function'), 'définition en clair')
    })

    for (const nom of ['production', 'production, runtime réduit']) {
      it(`${nom} : le nom est raccourci, il n'en reste aucune trace en clair`, () => {
        const t = texte(sorties.get(nom)!.outDir)
        assert.ok(!t.includes(NOM), 'le raccourcissement des noms de propriétés a bien eu lieu')
      })
    }
  })

  for (const c of CONSTRUCTIONS) {
    for (const nav of ['chromium', 'firefox'] as const) {
      describe(`${c.nom} · ${nav}`, function () {
        let browser: any
        let page: any
        let server: Server
        let erreurs: string[]
        let depart: Record<string, string>

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
          await page.waitForFunction(([f, n, r]: [string, string, string]) => ((document.querySelector(f) as any)?._shadow?.querySelectorAll('li').length ?? 0) === 20 && ((document.querySelector(n) as any)?._shadow?.querySelectorAll('li').length ?? 0) === 6 && ((document.querySelector(r) as any)?._shadow?.querySelectorAll('li').length ?? 0) === 12, [FORMES_TAG, NAISSANCE_TAG, RACINES_TAG], { timeout: 90000 })
          await page.waitForTimeout(150)
          depart = { ...(await lire(FORMES_TAG, CLASSES)), ...Object.fromEntries(Object.entries(await lire(NAISSANCE_TAG, CLASSES_NAISS)).map(([k, v]) => ['naissance ' + k, v])), ...(await lire(RACINES_TAG, CLASSES_RACINES)) }
        })

        after(async () => {
          await browser?.close()
          if (server) await new Promise((resolve) => server.close(() => resolve(null)))
        })

        const lire   = (tag: string, classes: string[]): Promise<Record<string, string>> => page.evaluate(LIRE, [tag, classes])
        const poser  = async (tag: string, lignes: any[]) => {
          await page.evaluate(([tag, lignes]: [string, any[]]) => { (document.querySelector(tag) as any).pose(lignes) }, [tag, lignes])
          await page.waitForTimeout(150)
        }
        // coupe les animations en vol : chaque étape part d'une page au repos
        const calmer = (tag: string) => page.evaluate((tag: string) => {
          for (const li of Array.from((document.querySelector(tag) as any)._shadow.querySelectorAll('li')) as any[]) li.getAnimations().forEach((a: any) => a.cancel())
        }, tag)
        // relève la place des lignes d'une liste de RACINES, pose les nouvelles lignes, puis rend l'analyse de la liste (animations, départs, `<li>` recréés)
        const bouger = async (classe: string, lignes: any[]) => {
          const avant = await page.evaluate(PLACER, [RACINES_TAG, [classe]])
          await poser(RACINES_TAG, lignes)
          return (await page.evaluate(ANALYSER, [RACINES_TAG, [classe], avant]))[classe]
        }

        // chaque test repart des données d'origine, sans animation en vol
        beforeEach(async () => {
          await poser(FORMES_TAG, ORDRE('a', 'b', 'c', 'd'))
          await poser(NAISSANCE_TAG, [LIGNE('a'), LIGNE('b', false), LIGNE('c'), LIGNE('d')])
          await poser(RACINES_TAG, ORDRE('a', 'b', 'c', 'd'))
          await calmer(FORMES_TAG)
          await calmer(NAISSANCE_TAG)
          await calmer(RACINES_TAG)
          erreurs.length = 0
        })

        it('au premier rendu, aucune ligne ne s\'anime, sous un {if} ou non', () => {
          assert.deepEqual(depart, {
            'if-in-for': 'a:0 b:0 c:0 d:0', plain: 'a:0 b:0 c:0 d:0', filtered: 'a:0 b:0 c:0 d:0', 'inside-row': 'a:0 b:0 c:0 d:0', 'inside-div': 'a:0 b:0 c:0 d:0',
            'naissance if-in-for': 'a:0 c:0 d:0', 'naissance filtered': 'a:0 c:0 d:0',
            'text-around': 'a:0 b:0 c:0 d:0', 'if-else': 'a:0 b:0 c:0 d:0', 'key-root': 'a:0 b:0 c:0 d:0'
          })
        })

        it('{for} > {if} > <li @flip> : après un réordre, les lignes qui bougent s\'animent, celle qui reste en place non', async () => {
          assert.equal((await lire(FORMES_TAG, CLASSES))['if-in-for'], 'a:0 b:0 c:0 d:0', 'au repos avant le réordre')
          await poser(FORMES_TAG, ORDRE('d', 'b', 'a', 'c'))
          assert.equal((await lire(FORMES_TAG, CLASSES))['if-in-for'], 'd:1 b:0 a:1 c:1', 'aucune animation : les lignes sous le {if} ne sont pas relevées')
          assert.deepEqual(erreurs, [])
        })

        it('les quatre autres formes gardent exactement leur compte d\'animations', async () => {
          await poser(FORMES_TAG, ORDRE('d', 'b', 'a', 'c'))
          const { 'if-in-for': _visee, ...autres } = await lire(FORMES_TAG, CLASSES)
          assert.deepEqual(autres, { plain: 'd:1 b:0 a:1 c:1', filtered: 'd:1 b:0 a:1 c:1', 'inside-row': 'd:1 b:0 a:1 c:1', 'inside-div': 'd:1 b:0 a:1 c:1' })
          assert.deepEqual(erreurs, [])
        })

        it('une ligne née plus tard : ses voisins glissent à sa naissance, puis elle s\'anime au réordre suivant, comme la liste filtrée', async () => {
          const T = NAISSANCE_TAG
          assert.deepEqual(await lire(T, CLASSES_NAISS), { 'if-in-for': 'a:0 c:0 d:0', filtered: 'a:0 c:0 d:0' }, 'départ : la ligne b est cachée')
          // premier réordre, b toujours cachée
          await poser(T, [LIGNE('d'), LIGNE('b', false), LIGNE('a'), LIGNE('c')])
          assert.deepEqual(await lire(T, CLASSES_NAISS), { 'if-in-for': 'd:1 a:1 c:1', filtered: 'd:1 a:1 c:1' }, 'premier réordre : les trois lignes visibles bougent')
          await calmer(T)
          // naissance de b : sa condition passe à vrai, l'ordre ne change pas
          await poser(T, [LIGNE('d'), LIGNE('b'), LIGNE('a'), LIGNE('c')])
          assert.deepEqual(await lire(T, CLASSES_NAISS), { 'if-in-for': 'd:0 b:0 a:1 c:1', filtered: 'd:0 b:0 a:1 c:1' }, 'naissance de b : les lignes sous elle glissent d\'un cran')
          await calmer(T)
          // second réordre : b change de place avec les autres
          await poser(T, [LIGNE('b'), LIGNE('d'), LIGNE('c'), LIGNE('a')])
          assert.deepEqual(await lire(T, CLASSES_NAISS), { 'if-in-for': 'b:1 d:1 c:1 a:1', filtered: 'b:1 d:1 c:1 a:1' }, 'second réordre : les quatre lignes bougent, b née plus tard comprise')
          assert.deepEqual(erreurs, [])
        })

        it('du texte autour du {if} : après un réordre, les lignes qui bougent s\'animent de leur ancienne place, celle qui reste en place non', async () => {
          assert.deepEqual(await bouger('text-around', ORDRE('d', 'b', 'a', 'c')), { animations: 'd:1 b:0 a:1 c:1', departs: 'd a c', neufs: '' }, 'la ligne compte quatre nœuds à la racine : les <li> entre les marqueurs du {if} sont relevés')
          assert.deepEqual(erreurs, [])
        })

        it('{if}{else}, les deux branches en @flip : une ligne qui change de branche en bougeant s\'anime de son ancienne place, dans un sens comme dans l\'autre', async () => {
          // d et a passent à la branche {else} en changeant de place : leur <li> est recréé
          assert.deepEqual(await bouger('if-else', [LIGNE('d', true, { b: false }), LIGNE('b'), LIGNE('a', true, { b: false }), LIGNE('c')]), { animations: 'd:1 b:0 a:1 c:1', departs: 'd a c', neufs: 'd a' }, 'vers la branche {else} : le <li> de la nouvelle branche est relevé après le réordre')
          // retour à la branche {if} en changeant de place encore : c'est le <li> de la branche {else} qui est relevé avant le réordre
          assert.deepEqual(await bouger('if-else', [LIGNE('a'), LIGNE('b'), LIGNE('d'), LIGNE('c')]), { animations: 'a:1 b:0 d:1 c:0', departs: 'a d', neufs: 'a d' }, 'retour à la branche {if} : le <li> de la branche {else} est relevé avant le réordre')
          assert.deepEqual(erreurs, [])
        })

        it('{key} à la racine de la ligne : une ligne dont la clé change pendant le réordre s\'anime de son ancienne place', async () => {
          // a et c changent de clé en bougeant : leur <li> est recréé
          assert.deepEqual(await bouger('key-root', [LIGNE('d'), LIGNE('b'), LIGNE('a', true, { v: 2 }), LIGNE('c', true, { v: 2 })]), { animations: 'd:1 b:0 a:1 c:1', departs: 'd a c', neufs: 'a c' }, 'la clé change : le <li> recréé est relevé après le réordre, à la place de l\'ancien')
          assert.deepEqual(erreurs, [])
        })
      })
    }
  }
})
