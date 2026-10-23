// `@flip` reconnaît chaque ligne d'un `{for … by clé}` par la clé du `by`, et chaque balise `@flip` racine d'une ligne par sa place dans le gabarit.
// Chromium et Firefox réels, en développement et en production (noms de propriétés raccourcis, code minifié).
// Le FLIP étiquette chaque balise `@flip` d'une ligne, mesure sa place avant la réconciliation puis après, et la fait glisser de
// l'ancienne place à la nouvelle : deux lignes qui portent la même étiquette se prennent leur place de départ.
//  1. `by cid` sur des objets SANS `id` : réordre, ligne neuve en tête, second réordre. La ligne neuve ne s'anime pas, chaque
//     autre part de SA place d'avant (l'indice de création, lui, redonnait à la ligne neuve l'étiquette d'une ancienne) ;
//  2. deux lignes au même `id` mais à `cid` différents : chacune part de sa place, pas de celle de l'autre ;
//  3. une clé calculée : la liste est faite de lignes dont `cle` est la concaténation du prénom et du nom (ni l'un ni l'autre
//     ne suffit seul), `by cle` ; la clé du `by` est un nom de propriété, la liste calcule la valeur qu'elle porte ;
//  4. une ligne qui rend DEUX balises racines `@flip` : côte à côte, sous un même `{if}`, ou chacune sous son `{if}` ;
//  5. une balise racine facultative placée avant une balise racine fixe : quand elle apparaît ou disparaît, la balise fixe garde sa
//     place et glisse depuis sa propre position ;
//  6. le témoin `by id`, dont le comportement ne change pas.
// Les animations se comptent par ligne (`getAnimations()`) 150 ms après le changement : la durée de 5 s les garde en vol. Le premier
// keyframe de chaque animation vaut l'écart entre l'ancienne et la nouvelle place de sa balise, à 1 px près, la nouvelle place
// étant mesurée animations coupées.
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

const LETTRES = 'abcdef'

// sept listes sur des données à part : chaque liste ne lit que la sienne, sans quoi la hauteur de l'une changerait la place de celles du dessous
const COMPOSANT = `<script>
  $sansid = [{ cid: 'a', t: 'a' }, { cid: 'b', t: 'b' }, { cid: 'c', t: 'c' }, { cid: 'd', t: 'd' }]
  $double = [{ cid: 'a', id: 7, t: 'a' }, { cid: 'b', id: 7, t: 'b' }, { cid: 'c', id: 3, t: 'c' }, { cid: 'd', id: 4, t: 'd' }]
  $gens   = [{ prenom: 'a', nom: 'x' }, { prenom: 'a', nom: 'y' }, { prenom: 'b', nom: 'x' }, { prenom: 'b', nom: 'y' }]
  $deux   = [{ cid: 'a', t: 'a' }, { cid: 'b', t: 'b' }, { cid: 'c', t: 'c' }, { cid: 'd', t: 'd' }]
  $sousif = [{ cid: 'a', t: 'a', on: true }, { cid: 'b', t: 'b', on: true }, { cid: 'c', t: 'c', on: true }, { cid: 'd', t: 'd', on: true }]
  $chacun = [{ cid: 'a', t: 'a', on: true }, { cid: 'b', t: 'b', on: true }, { cid: 'c', t: 'c', on: true }, { cid: 'd', t: 'd', on: true }]
  $facult = [{ cid: 'a', t: 'a', on: true }, { cid: 'b', t: 'b', on: true }, { cid: 'c', t: 'c', on: true }, { cid: 'd', t: 'd', on: true }]
  $temoin = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }, { id: 4, t: 'd' }]

  cles = (l) -> l.map((u) -> ({ cle: u.prenom + u.nom, t: u.prenom + u.nom }))

  @poseSansid = (l) -> $sansid = l
  @poseDouble = (l) -> $double = l
  @poseGens   = (l) -> $gens = l
  @poseDeux   = (l) -> $deux = l
  @poseSousif = (l) -> $sousif = l
  @poseChacun = (l) -> $chacun = l
  @poseFacult = (l) -> $facult = l
  @poseTemoin = (l) -> $temoin = l
</script>

<ul class="sans-id">
  {for s in $sansid by cid}
    <li @flip=5000 data-k="{s.t}">{s.t}</li>
  {end}
</ul>

<ul class="id-double">
  {for s in $double by cid}
    <li @flip=5000 data-k="{s.t}">{s.t}</li>
  {end}
</ul>

<ul class="calculee">
  {for u in cles($gens) by cle}
    <li @flip=5000 data-k="{u.t}">{u.t}</li>
  {end}
</ul>

<ul class="deux-racines">
  {for s in $deux by cid}
    <li @flip=5000 data-k="{s.t}">{s.t}</li>
    <li @flip=5000 data-k="{s.t}2">{s.t}2</li>
  {end}
</ul>

<ul class="deux-sous-if">
  {for s in $sousif by cid}
    {if s.on}
      <li @flip=5000 data-k="{s.t}">{s.t}</li>
      <li @flip=5000 data-k="{s.t}2">{s.t}2</li>
    {end}
  {end}
</ul>

<ul class="un-if-chacune">
  {for s in $chacun by cid}
    {if s.on}<li @flip=5000 data-k="{s.t}">{s.t}</li>{end}
    {if s.on}<li @flip=5000 data-k="{s.t}2">{s.t}2</li>{end}
  {end}
</ul>

<ul class="facultative">
  {for s in $facult by cid}
    {if s.on}<li @flip=5000 data-k="{s.t}">{s.t}</li>{end}
    <li @flip=5000 data-k="{s.t}2">{s.t}2</li>
  {end}
</ul>

<ul class="temoin">
  {for s in $temoin by id}
    <li @flip=5000 data-k="{s.t}">{s.t}</li>
  {end}
</ul>

<style>
  ul
    list-style: none
    padding: 0
    margin: 8px 0

  li
    min-height: 24px
</style>
`

const TAG       = 'mjs-flip-cle'
const CLASSES   = ['sans-id', 'id-double', 'calculee', 'deux-racines', 'deux-sous-if', 'un-if-chacune', 'facultative', 'temoin']
const ATTENDUES = { 'sans-id': 4, 'id-double': 4, calculee: 4, 'deux-racines': 8, 'deux-sous-if': 8, 'un-if-chacune': 8, facultative: 8, temoin: 4 }
const TOTAL     = Object.values(ATTENDUES).reduce((a, b) => a + b, 0)

// les lignes des listes, dans l'ordre demandé ; `plus` complète ou remplace des champs
const LIGNE   = (t: string, plus = {}) => ({ cid: t, t, id: LETTRES.indexOf(t) + 1, on: true, ...plus })
const ORDRE   = (...ts: string[]) => ts.map((t) => LIGNE(t))
const DOUBLE  = (...ts: string[]) => ts.map((t) => LIGNE(t, { id: { a: 7, b: 7, c: 3, d: 4 }[t] }))
const GENS    = (...ns: string[]) => ns.map((n) => ({ prenom: n[0], nom: n[1] }))
const SANS_ID = (...ts: string[]) => ts.map((t) => ({ cid: t, t }))

async function construire(c: Construction): Promise<{ root: string, outDir: string }> {
  const root   = mjsTmp('flip-cle-du-by')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'flip-cle.mjs'), COMPOSANT)
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

// le nombre de lignes `<li>` de chaque liste
const COMPTER = ([tag, classes]: [string, string[]]) => {
  const racine = (document.querySelector(tag) as any)?._shadow
  const out: Record<string, number> = {}
  for (const c of classes) out[c] = racine ? racine.querySelectorAll('.' + c + ' li').length : 0
  return out
}

// la place de chaque balise de la liste (par son `data-k`), à relever au repos avant un changement ; chaque `<li>` est marqué
// pour reconnaître ensuite ceux qui sont neufs
const PLACER = ([tag, classe]: [string, string]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const out    = {} as Record<string, number[]>
  for (const li of Array.from(racine.querySelectorAll('.' + classe + ' li')) as any[]) {
    const r              = li.getBoundingClientRect()
    li._avant            = true
    out[li.dataset.k]    = [r.left, r.top]
  }
  return out
}

// après le changement : le nombre d'animations de chaque balise (`k:n`), celles dont l'animation FLIP part de l'ancienne place
// (premier keyframe = ancienne place - nouvelle place, la nouvelle étant mesurée animations coupées), puis les balises neuves
const ANALYSER = ([tag, classe, avant]: [string, string, Record<string, number[]>]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const lus    = [] as any[]
  for (const li of Array.from(racine.querySelectorAll('.' + classe + ' li')) as any[]) {
    const flip = li.getAnimations().find((a: any) => a.id === 'mjs-flip')
    const m    = flip ? /translate\((-?[\d.e+-]+)px,\s*(-?[\d.e+-]+)px\)/.exec(String(flip.effect.getKeyframes()[0].transform)) : null
    lus.push({ li, k: li.dataset.k, n: li.getAnimations().length, depart: m ? [parseFloat(m[1]), parseFloat(m[2])] : null, neuf: !li._avant })
  }
  for (const li of Array.from(racine.querySelectorAll('li')) as any[]) li.getAnimations().forEach((a: any) => a.cancel())
  return {
    animations: lus.map((x) => x.k + ':' + x.n).join(' '),
    departs:    lus.filter((x) => x.n).map((x) => {
      if (!avant[x.k]) return x.k + '!(balise neuve animée)'
      const r  = x.li.getBoundingClientRect()
      const dx = avant[x.k][0] - r.left
      const dy = avant[x.k][1] - r.top
      return x.depart && Math.abs(x.depart[0] - dx) < 1 && Math.abs(x.depart[1] - dy) < 1 ? x.k : x.k + '!(' + x.depart + ' au lieu de ' + dx + ',' + dy + ')'
    }).join(' '),
    neufs:      lus.filter((x) => x.neuf).map((x) => x.k).join(' ')
  }
}

describe('@flip — chaque ligne reconnue par la clé du `by`, chaque balise racine par sa place (navigateurs réels)', function () {
  this.timeout(240000)
  const sorties = new Map<string, { root: string, outDir: string }>()

  before(async function () {
    this.timeout(120000)
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
          await page.waitForFunction(([tag, total]: [string, number]) => ((document.querySelector(tag) as any)?._shadow?.querySelectorAll('li').length ?? 0) === total, [TAG, TOTAL], { timeout: 90000 })
          await page.waitForTimeout(150)
        })

        after(async () => {
          await browser?.close()
          if (server) await new Promise((resolve) => server.close(() => resolve(null)))
        })

        // relève la place des balises d'une liste, pose les nouvelles lignes, puis rend l'analyse de la liste (animations, départs, balises neuves)
        const bouger = async (classe: string, pose: string, lignes: any[]) => {
          const avant = await page.evaluate(PLACER, [TAG, classe])
          await page.evaluate(([fn, l]: [string, any[]]) => { (document.querySelector('mjs-flip-cle') as any)[fn](l) }, [pose, lignes])
          await page.waitForTimeout(150)
          return page.evaluate(ANALYSER, [TAG, classe, avant])
        }

        beforeEach(() => { erreurs.length = 0 })

        it('au premier rendu, chaque liste a ses lignes et aucune ne s\'anime', async () => {
          assert.deepEqual(await page.evaluate(COMPTER, [TAG, CLASSES]), ATTENDUES)
          const animees = await page.evaluate(([tag]: [string]) => Array.from((document.querySelector(tag) as any)._shadow.querySelectorAll('li')).filter((li: any) => li.getAnimations().length).length, [TAG])
          assert.equal(animees, 0)
          assert.deepEqual(erreurs, [])
        })

        it('`by cid`, objets sans `id` : réordre, ligne neuve en tête, second réordre', async () => {
          assert.deepEqual(await bouger('sans-id', 'poseSansid', SANS_ID('d', 'b', 'a', 'c')), { animations: 'd:1 b:0 a:1 c:1', departs: 'd a c', neufs: '' }, 'réordre : chaque ligne qui bouge part de sa place')
          assert.deepEqual(await bouger('sans-id', 'poseSansid', SANS_ID('e', 'd', 'b', 'a', 'c')), { animations: 'e:0 d:1 b:1 a:1 c:1', departs: 'd b a c', neufs: 'e' }, 'ligne neuve en tête : elle ne s\'anime pas, les autres descendent d\'un cran')
          assert.deepEqual(await bouger('sans-id', 'poseSansid', SANS_ID('c', 'a', 'e', 'b', 'd')), { animations: 'c:1 a:1 e:1 b:1 d:1', departs: 'c a e b d', neufs: '' }, 'second réordre : la ligne née plus tard part de sa place comme les autres')
          assert.deepEqual(erreurs, [])
        })

        it('deux lignes au même `id` mais à `cid` différents : chacune part de SA place', async () => {
          assert.deepEqual(await bouger('id-double', 'poseDouble', DOUBLE('d', 'b', 'a', 'c')), { animations: 'd:1 b:0 a:1 c:1', departs: 'd a c', neufs: '' }, 'réordre : a (au même id que b) part de sa place, pas de celle de b')
          assert.deepEqual(await bouger('id-double', 'poseDouble', DOUBLE('d', 'a', 'b', 'c')), { animations: 'd:0 a:1 b:1 c:0', departs: 'a b', neufs: '' }, 'les deux lignes au même id échangent leurs places : chacune part de la sienne')
          assert.deepEqual(erreurs, [])
        })

        it('clé calculée (prénom + nom), `by cle` : réordre, ligne neuve en tête, second réordre', async () => {
          assert.deepEqual(await bouger('calculee', 'poseGens', GENS('by', 'ay', 'ax', 'bx')), { animations: 'by:1 ay:0 ax:1 bx:1', departs: 'by ax bx', neufs: '' }, 'réordre')
          assert.deepEqual(await bouger('calculee', 'poseGens', GENS('cx', 'by', 'ay', 'ax', 'bx')), { animations: 'cx:0 by:1 ay:1 ax:1 bx:1', departs: 'by ay ax bx', neufs: 'cx' }, 'ligne neuve en tête')
          assert.deepEqual(await bouger('calculee', 'poseGens', GENS('bx', 'ax', 'cx', 'ay', 'by')), { animations: 'bx:1 ax:1 cx:1 ay:1 by:1', departs: 'bx ax cx ay by', neufs: '' }, 'second réordre')
          assert.deepEqual(erreurs, [])
        })

        it('deux balises racines `@flip` côte à côte : chacune part de SA place', async () => {
          assert.deepEqual(await bouger('deux-racines', 'poseDeux', SANS_ID('d', 'b', 'a', 'c')), { animations: 'd:1 d2:1 b:0 b2:0 a:1 a2:1 c:1 c2:1', departs: 'd d2 a a2 c c2', neufs: '' }, 'réordre : les deux balises d\'une ligne glissent ensemble, chacune de sa place')
          assert.deepEqual(await bouger('deux-racines', 'poseDeux', SANS_ID('e', 'd', 'b', 'a', 'c')), { animations: 'e:0 e2:0 d:1 d2:1 b:1 b2:1 a:1 a2:1 c:1 c2:1', departs: 'd d2 b b2 a a2 c c2', neufs: 'e e2' }, 'ligne neuve en tête : ses deux balises ne s\'animent pas')
          assert.deepEqual(erreurs, [])
        })

        it('deux balises racines `@flip` sous un même `{if}` : chacune part de SA place', async () => {
          assert.deepEqual(await bouger('deux-sous-if', 'poseSousif', ORDRE('d', 'b', 'a', 'c')), { animations: 'd:1 d2:1 b:0 b2:0 a:1 a2:1 c:1 c2:1', departs: 'd d2 a a2 c c2', neufs: '' }, 'réordre')
          assert.deepEqual(await bouger('deux-sous-if', 'poseSousif', ORDRE('e', 'd', 'b', 'a', 'c')), { animations: 'e:0 e2:0 d:1 d2:1 b:1 b2:1 a:1 a2:1 c:1 c2:1', departs: 'd d2 b b2 a a2 c c2', neufs: 'e e2' }, 'ligne neuve en tête')
          assert.deepEqual(erreurs, [])
        })

        it('deux balises racines `@flip`, chacune sous son `{if}` : chacune part de SA place', async () => {
          assert.deepEqual(await bouger('un-if-chacune', 'poseChacun', ORDRE('d', 'b', 'a', 'c')), { animations: 'd:1 d2:1 b:0 b2:0 a:1 a2:1 c:1 c2:1', departs: 'd d2 a a2 c c2', neufs: '' }, 'réordre')
          assert.deepEqual(await bouger('un-if-chacune', 'poseChacun', ORDRE('e', 'd', 'b', 'a', 'c')), { animations: 'e:0 e2:0 d:1 d2:1 b:1 b2:1 a:1 a2:1 c:1 c2:1', departs: 'd d2 b b2 a a2 c c2', neufs: 'e e2' }, 'ligne neuve en tête')
          assert.deepEqual(erreurs, [])
        })

        it('une balise racine facultative avant une balise fixe : elle apparaît ou disparaît, la fixe glisse depuis SA place', async () => {
          assert.deepEqual(await bouger('facultative', 'poseFacult', ORDRE('d', 'b', 'a', 'c')), { animations: 'd:1 d2:1 b:0 b2:0 a:1 a2:1 c:1 c2:1', departs: 'd d2 a a2 c c2', neufs: '' }, 'réordre, les deux balises présentes')
          assert.deepEqual(await bouger('facultative', 'poseFacult', [LIGNE('d'), LIGNE('b', { on: false }), LIGNE('a'), LIGNE('c')]), { animations: 'd:0 d2:0 b2:1 a:1 a2:1 c:1 c2:1', departs: 'b2 a a2 c c2', neufs: '' }, 'la balise facultative de b disparaît : la fixe b2 et celles du dessous remontent chacune de leur place')
          assert.deepEqual(await bouger('facultative', 'poseFacult', ORDRE('d', 'b', 'a', 'c')), { animations: 'd:0 d2:0 b:0 b2:1 a:1 a2:1 c:1 c2:1', departs: 'b2 a a2 c c2', neufs: 'b' }, 'elle réapparaît : la fixe b2 et celles du dessous redescendent chacune de leur place, la balise neuve ne s\'anime pas')
          assert.deepEqual(erreurs, [])
        })

        it('le témoin `by id` : réordre, ligne neuve en tête, second réordre', async () => {
          assert.deepEqual(await bouger('temoin', 'poseTemoin', ORDRE('d', 'b', 'a', 'c')), { animations: 'd:1 b:0 a:1 c:1', departs: 'd a c', neufs: '' }, 'réordre')
          assert.deepEqual(await bouger('temoin', 'poseTemoin', ORDRE('e', 'd', 'b', 'a', 'c')), { animations: 'e:0 d:1 b:1 a:1 c:1', departs: 'd b a c', neufs: 'e' }, 'ligne neuve en tête')
          assert.deepEqual(await bouger('temoin', 'poseTemoin', ORDRE('c', 'a', 'e', 'b', 'd')), { animations: 'c:1 a:1 e:1 b:1 d:1', departs: 'c a e b d', neufs: '' }, 'second réordre')
          assert.deepEqual(erreurs, [])
        })
      })
    }
  }
})
