// `@flip` : chaque balise d'une ligne de `{for}` garde SA place d'une passe à l'autre, à n'importe quelle profondeur du gabarit de la ligne
// et dans une liste imbriquée.
// Chromium et Firefox réels, en développement et en production (noms de propriétés raccourcis, code minifié).
// Le FLIP étiquette chaque balise `@flip`, mesure sa place avant la réconciliation puis après, et la fait glisser de l'ancienne
// place à la nouvelle. Chaque scénario part de l'état de base, relève la place de chaque balise (son `data-k`), pose l'état d'arrivée,
// et juge chaque balise 150 ms plus tard :
//  - une balise qui a bougé glisse, et son premier keyframe vaut l'écart entre l'ancienne et la nouvelle place, à 1,5 px près ;
//  - une balise qui n'a pas bougé reste immobile ; une balise neuve ne s'anime pas ; aucune balise n'a deux glissements.
// Les formes : deux balises sous une même balise de la ligne ; une balise racine qui en porte une autre ; deux balises sous un `{if}` …
// `{else}` ; une liste dans une liste, la ligne extérieure sans `@flip` puis avec ; trois niveaux de listes ; le même nom d'élément à
// deux niveaux.
// Puis les cas où la clé ne dit pas tout : deux éléments de même clé `by` (la ligne qui porte la clé n'a pas d'identité sûre, elle ne
// s'anime pas), un `mjs-key` vide écrit à la main (aucune identité commune), un `mjs-key` écrit à la main sur une seule racine, une liste
// de valeurs simples sans `by`.
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

// la ligne d'une liste ; `on` commande le `{if}`
const ligne = (t: string, plus: Record<string, unknown> = {}) => ({ cid: t, t, on: true, ...plus })
const L     = (...ts: string[]) => ts.map((t) => ligne(t))
const BASE  = L('a', 'b', 'c', 'd')

// un groupe de lignes `1`, `2`… sous un identifiant de groupe : les clés des lignes se répètent d'un groupe à l'autre ; la ligne `11` du groupe `A`
// et la ligne `1` du groupe `A1` ne se distinguent que par le séparateur de leur étiquette ; les lignes portent aussi une propriété `gid`
// (la même partout), que le nom du groupe masqué ne doit jamais faire lire à la place de celui du groupe
const groupe  = (gid: string, ...cids: number[]) => ({ gid, items: cids.map((cid) => ({ cid, gid: 'z', t: gid + '/' + cid })) })
const GROUPES = [groupe('A', 1, 2, 11), groupe('A1', 1), groupe('B', 1, 2, 3), groupe('C', 1)]
const par     = <T>(l: T[], ...ordre: number[]) => ordre.map((i) => l[i])

// les mêmes groupes, chacun dans un `{if}` de sa ligne extérieure
const avecIf   = (g: any, on = true) => ({ ...g, on })
const GROUPES_IF = GROUPES.map((g) => avecIf(g))

// trois niveaux : les clés des sous-groupes et des lignes se répètent d'un parent à l'autre
const sous      = (sid: string, ...cids: number[]) => ({ sid, items: cids.map((cid) => ({ cid })) })
const groupe3   = (gid: string, ...subs: any[]) => ({ gid, subs })
const TROIS     = [groupe3('A', sous('s1', 1, 2), sous('s2', 1)), groupe3('B', sous('s1', 1)), groupe3('C', sous('s1', 1, 2))]

// le même nom d'élément à deux niveaux : la ligne intérieure ne voit plus la ligne extérieure
const MEME_NOM = GROUPES

// deux éléments de même clé `by` (`1` et `'1'` : la réconciliation compare les clés en chaîne) : le moteur ne rend que le premier de chaque clé
const DOUBLES = [ligne('a', { cid: 1 }), ligne('b', { cid: '1' }), ligne('c', { cid: 2 }), ligne('d', { cid: 3 })]
// les mêmes, dans un objet : la collection d'une liste peut être un objet
const OBJET   = { p: DOUBLES[0], q: DOUBLES[1], r: DOUBLES[2], s: DOUBLES[3] }

// un `mjs-key` vide écrit à la main sur chaque ligne
const VIDES = BASE.map((l) => ({ ...l, k: '' }))

const VALEURS = ['a', 'b', 'c', 'd']

// `lit` : un objet ou un tableau JavaScript, écrit en littéral du script du composant
const lit = (o: any): string => Array.isArray(o) ? '[' + o.map(lit).join(', ') + ']' : (o && typeof o === 'object') ? '{ ' + Object.entries(o).map(([k, v]) => k + ': ' + lit(v)).join(', ') + ' }' : typeof o === 'string' ? JSON.stringify(o) : String(o)
const maj = (n: string) => n[0].toUpperCase() + n.slice(1)

// les listes : nom, données de départ, gabarit ; chacune sur ses données, une liste ne lit que les siennes
type Liste = { nom: string, donnees: any, gabarit: string }
const LISTES: Liste[] = [
  { nom: 'profondes', donnees: BASE, gabarit: '<div class="profondes">\n  {for it in $profondes by cid}\n    <section><h4 @flip=5000 data-k="{it.t}-h">{it.t}-h</h4><p @flip=5000 data-k="{it.t}-p">{it.t}-p</p></section>\n  {end}\n</div>' },
  { nom: 'racineProfonde', donnees: BASE, gabarit: '<ul class="racineProfonde">\n  {for it in $racineProfonde by cid}\n    <li @flip=5000 data-k="{it.t}">{it.t} <span @flip=5000 data-k="{it.t}-s">{it.t}-s</span></li>\n  {end}\n</ul>' },
  { nom: 'profondesIf', donnees: BASE, gabarit: '<div class="profondesIf">\n  {for it in $profondesIf by cid}\n    <section>{if it.on}<h4 @flip=5000 data-k="{it.t}-h">{it.t} on</h4>{else}<h4 @flip=5000 data-k="{it.t}-h">{it.t} off</h4>{end}<p @flip=5000 data-k="{it.t}-p">{it.t}-p</p></section>\n  {end}\n</div>' },
  { nom: 'imbriqueeSans', donnees: GROUPES, gabarit: '<div class="imbriqueeSans">\n  {for g in $imbriqueeSans by gid}\n    <div class="grp">{for it in g.items by cid}<p @flip=5000 data-k="{g.gid}/{it.cid}">{g.gid}/{it.cid}</p>{end}</div>\n  {end}\n</div>' },
  { nom: 'imbriqueeAvec', donnees: GROUPES, gabarit: '<div class="imbriqueeAvec">\n  {for g in $imbriqueeAvec by gid}\n    <div class="grp" @flip=5000 data-k="G{g.gid}">{for it in g.items by cid}<p @flip=5000 data-k="{g.gid}/{it.cid}">{g.gid}/{it.cid}</p>{end}</div>\n  {end}\n</div>' },
  { nom: 'imbriqueeDansIf', donnees: GROUPES_IF, gabarit: '<div class="imbriqueeDansIf">\n  {for g in $imbriqueeDansIf by gid}\n    <div class="grp">{if g.on}<section>{for it in g.items by cid}<p @flip=5000 data-k="{g.gid}/{it.cid}">{g.gid}/{it.cid}</p>{end}</section>{end}</div>\n  {end}\n</div>' },
  { nom: 'troisNiveaux', donnees: TROIS, gabarit: '<div class="troisNiveaux">\n  {for g in $troisNiveaux by gid}\n    <div class="grp">{for s in g.subs by sid}<div class="sous">{for it in s.items by cid}<p @flip=5000 data-k="{g.gid}/{s.sid}/{it.cid}">{g.gid}/{s.sid}/{it.cid}</p>{end}</div>{end}</div>\n  {end}\n</div>' },
  { nom: 'memeNom', donnees: MEME_NOM, gabarit: '<div class="memeNom">\n  {for x in $memeNom by gid}\n    <div class="grp">{for x in x.items by cid}<p @flip=5000 data-k="{x.t}">{x.t}</p>{end}</div>\n  {end}\n</div>' },
  { nom: 'doubles', donnees: DOUBLES, gabarit: '<ul class="doubles">\n  {for it in $doubles by cid}\n    <li @flip=5000 data-k="{it.t}">{it.t}</li>\n  {end}\n</ul>' },
  { nom: 'objet', donnees: OBJET, gabarit: '<ul class="objet">\n  {for k, it in $objet by cid}\n    <li @flip=5000 data-k="{it.t}">{it.t}</li>\n  {end}\n</ul>' },
  { nom: 'vides', donnees: VIDES, gabarit: '<ul class="vides">\n  {for it in $vides by cid}\n    <li @flip=5000 mjs-key="{it.k}" data-k="{it.t}">{it.t}</li>\n  {end}\n</ul>' },
  { nom: 'videsProfonds', donnees: VIDES, gabarit: '<div class="videsProfonds">\n  {for it in $videsProfonds by cid}\n    <section><h4 @flip=5000 mjs-key="{it.k}" data-k="{it.t}">{it.t}</h4></section>\n  {end}\n</div>' },
  { nom: 'explicite', donnees: BASE, gabarit: '<ul class="explicite">\n  {for it in $explicite by cid}\n    <li @flip=5000 mjs-key="{it.cid}" data-k="{it.t}">{it.t}</li>\n  {end}\n</ul>' },
  { nom: 'valeurs', donnees: VALEURS, gabarit: '<ul class="valeurs">\n  {for v in $valeurs}\n    <li @flip=5000 data-k="{v}">{v}</li>\n  {end}\n</ul>' },
]
const NOMS = LISTES.map((l) => l.nom)

const COMPOSANT = `<script>
${LISTES.map((l) => `  $${l.nom} = ${lit(l.donnees)}`).join('\n')}

${LISTES.map((l) => `  @pose${maj(l.nom)} = (l) -> $${l.nom} = l`).join('\n')}
</script>

${LISTES.map((l) => l.gabarit).join('\n\n')}

<style>
  ul
    list-style: none
    padding: 0
    margin: 8px 0

  li
    min-height: 24px

  section
    margin: 6px 0
    min-height: 40px

  .grp
    margin: 6px 0

  .sous
    margin: 4px 0
</style>
`
const TAG = 'mjs-flip-profonde'

async function construire(c: Construction): Promise<{ root: string, outDir: string }> {
  const root   = mjsTmp('flip-identite-profonde')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'flip-profonde.mjs'), COMPOSANT)
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

// coupe toutes les animations de la liste
const CALMER = ([tag, classe]: [string, string]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  for (const el of Array.from(racine.querySelectorAll('.' + classe + ' *')) as any[]) el.getAnimations().forEach((a: any) => a.cancel())
}

// la place de chaque balise de la liste, par son `data-k` ; chaque balise est marquée pour reconnaître ensuite celles qui sont neuves
const MESURER = ([tag, classe]: [string, string]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const out    = {} as Record<string, number[]>
  for (const el of Array.from(racine.querySelectorAll('.' + classe + ' [data-k]')) as any[]) {
    const r    = el.getBoundingClientRect()
    el._avant  = true
    out[el.getAttribute('data-k')] = [r.left, r.top]
  }
  return out
}

// lit après le changement : pour chaque balise, ses glissements et le départ du premier ; coupe ensuite les animations
const LIRE = ([tag, classe]: [string, string]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const lus    = (Array.from(racine.querySelectorAll('.' + classe + ' [data-k]')) as any[]).map((el) => {
    const flips = el.getAnimations().filter((a: any) => a.id === 'mjs-flip')
    const m     = flips.length ? /translate\((-?[\d.e+-]+)px,\s*(-?[\d.e+-]+)px\)/.exec(String(flips[0].effect.getKeyframes()[0].transform || '')) : null
    return { el, k: el.getAttribute('data-k'), n: flips.length, depart: m ? [parseFloat(m[1]), parseFloat(m[2])] : null, neuf: !el._avant }
  })
  for (const el of Array.from(racine.querySelectorAll('.' + classe + ' *')) as any[]) el.getAnimations().forEach((a: any) => a.cancel())
  return lus.map(({ k, n, depart, neuf }) => ({ k, n, depart, neuf }))
}

// juge chaque balise après le changement ; rend le détail et les cas mauvais
const JUGER = ([tag, classe, avant]: [string, string, Record<string, number[]>]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const lus    = (Array.from(racine.querySelectorAll('.' + classe + ' [data-k]')) as any[]).map((el) => {
    const flips = el.getAnimations().filter((a: any) => a.id === 'mjs-flip')
    const m     = flips.length ? /translate\((-?[\d.e+-]+)px,\s*(-?[\d.e+-]+)px\)/.exec(String(flips[0].effect.getKeyframes()[0].transform || '')) : null
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
  return { detail: verdicts.join(' | '), mauvais: verdicts.filter((v) => v.includes('MAUVAIS')), glissent: verdicts.filter((v) => v.endsWith(':glisse')).length }
}

describe('@flip — chaque balise garde sa place à toute profondeur d\'une ligne et dans une liste imbriquée (navigateurs réels)', function () {
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
          page    = await (await browser.newContext({ viewport: { width: 800, height: 900 } })).newPage()
          erreurs = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
          await page.goto(serveur.url, { waitUntil: 'load' })
          await page.waitForFunction(([tag, cl]: [string, string[]]) => {
            const racine = (document.querySelector(tag) as any)?._shadow
            return !!racine && cl.every((n) => racine.querySelectorAll('.' + n + ' [data-k]').length > 0)
          }, [TAG, NOMS], { timeout: 90000 })
          await page.waitForTimeout(150)
        })

        after(async () => {
          await browser?.close()
          if (server) await new Promise((resolve) => server.close(() => resolve(null)))
        })

        beforeEach(() => { erreurs.length = 0 })

        const poser  = async (liste: string, lignes: any[]) => {
          await page.evaluate(([fn, l]: [string, any[]]) => { (document.querySelector('mjs-flip-profonde') as any)[fn](l) }, ['pose' + maj(liste), lignes])
          await page.waitForTimeout(150)
        }
        const calmer = (liste: string) => page.evaluate(CALMER, [TAG, liste])

        // retour à la base, relevé des places, état d'arrivée ; rend ce que la page lit ensuite (balise par balise)
        const jouer = async (liste: string, base: any[], apres: any[], lecteur: any = JUGER) => {
          await poser(liste, base)
          await calmer(liste)
          const avant = await page.evaluate(MESURER, [TAG, liste])
          await poser(liste, apres)
          return page.evaluate(lecteur, lecteur === JUGER ? [TAG, liste, avant] : [TAG, liste])
        }

        // joue tous les scénarios d'une liste et rend les cas mauvais, scénario par scénario
        const rejouer = async (liste: string, base: any[], scenarios: Record<string, any[]>) => {
          const problemes: string[] = []
          for (const [nom, apres] of Object.entries(scenarios)) {
            const r = await jouer(liste, base, apres)
            if (r.mauvais.length) problemes.push(nom + ' → ' + r.detail)
          }
          return problemes
        }

        // ce que la page lit pour une balise : 'k:n' (nombre de glissements), puis les balises neuves
        const resume = (lus: any[]) => ({ animations: lus.map((x) => x.k + ':' + x.n).join(' '), neufs: lus.filter((x) => x.neuf).map((x) => x.k).join(' ') })

        it('au premier rendu, chaque liste a ses balises et aucune ne s\'anime', async () => {
          const animees = await page.evaluate(([tag]: [string]) => Array.from((document.querySelector(tag) as any)._shadow.querySelectorAll('[data-k]')).filter((el: any) => el.getAnimations().length).length, [TAG])
          assert.equal(animees, 0)
          assert.deepEqual(erreurs, [])
        })

        it('deux balises sous une même balise de la ligne : chacune glisse depuis sa propre place', async () => {
          assert.deepEqual(await rejouer('profondes', BASE, { 'réordre': L('d', 'b', 'a', 'c'), 'second réordre': L('c', 'a', 'd', 'b'), 'ligne neuve en tête': [ligne('e'), ...L('d', 'b', 'a', 'c')] }), [])
          assert.deepEqual(erreurs, [])
        })

        it('une balise racine qui en porte une autre : chacune glisse depuis sa propre place', async () => {
          assert.deepEqual(await rejouer('racineProfonde', BASE, { 'réordre': L('d', 'b', 'a', 'c'), 'second réordre': L('c', 'a', 'd', 'b') }), [])
          assert.deepEqual(erreurs, [])
        })

        it('deux balises sous un `{if}` … `{else}` et une fixe : chacune glisse depuis sa propre place, même quand la ligne bascule', async () => {
          const bascule = [ligne('d'), ligne('b', { on: false }), ligne('a'), ligne('c', { on: false })]
          assert.deepEqual(await rejouer('profondesIf', BASE, { 'réordre': L('d', 'b', 'a', 'c'), 'réordre et bascule': bascule }), [])
          assert.deepEqual(erreurs, [])
        })

        it('une liste dans une liste, la ligne extérieure sans `@flip` : au réordre des groupes, chaque ligne intérieure glisse depuis sa propre place', async () => {
          assert.deepEqual(await rejouer('imbriqueeSans', GROUPES, { 'réordre des groupes': par(GROUPES, 3, 0, 2, 1), 'second réordre': par(GROUPES, 1, 3, 0, 2), 'réordre dans B': [GROUPES[0], GROUPES[1], groupe('B', 3, 1, 2), GROUPES[3]] }), [])
          assert.deepEqual(erreurs, [])
        })

        it('une liste dans une liste, `@flip` aux deux niveaux : chaque balise des deux niveaux glisse depuis sa propre place', async () => {
          assert.deepEqual(await rejouer('imbriqueeAvec', GROUPES, { 'réordre des groupes': par(GROUPES, 3, 0, 2, 1), 'second réordre': par(GROUPES, 1, 3, 0, 2), 'réordre dans B': [GROUPES[0], GROUPES[1], groupe('B', 3, 1, 2), GROUPES[3]] }), [])
          assert.deepEqual(erreurs, [])
        })

        it('une liste dans un `{if}` de la ligne extérieure : chaque ligne intérieure glisse depuis sa propre place, même quand un groupe se ferme ou se rouvre', async () => {
          const ferme = GROUPES_IF.map((g) => (g.gid === 'B' ? avecIf(g, false) : g))
          assert.deepEqual(await rejouer('imbriqueeDansIf', GROUPES_IF, { 'réordre des groupes': par(GROUPES_IF, 3, 0, 2, 1), 'un groupe se ferme': ferme, 'réordre et un groupe se ferme': par(ferme, 3, 0, 2, 1), 'réordre dans B': [GROUPES_IF[0], GROUPES_IF[1], avecIf(groupe('B', 3, 1, 2)), GROUPES_IF[3]] }), [])
          assert.deepEqual(erreurs, [])
        })

        it('trois niveaux de listes : chaque ligne glisse depuis sa propre place, au réordre des groupes comme à celui des sous-groupes', async () => {
          assert.deepEqual(await rejouer('troisNiveaux', TROIS, { 'réordre des groupes': par(TROIS, 2, 0, 1), 'réordre des sous-groupes de A': [groupe3('A', TROIS[0].subs[1], TROIS[0].subs[0]), TROIS[1], TROIS[2]] }), [])
          assert.deepEqual(erreurs, [])
        })

        it('le même nom d\'élément aux deux niveaux : chaque ligne intérieure glisse depuis sa propre place', async () => {
          assert.deepEqual(await rejouer('memeNom', MEME_NOM, { 'réordre des groupes': par(MEME_NOM, 3, 0, 2, 1), 'second réordre': par(MEME_NOM, 1, 3, 0, 2) }), [])
          assert.deepEqual(erreurs, [])
        })

        it('deux éléments de même clé : la ligne qui porte la clé ne s\'anime pas, les autres glissent depuis leur place', async () => {
          const lire = async (apres: any[]) => resume(await jouer('doubles', DOUBLES, apres, LIRE))
          // c reste en place, d monte, la ligne de clé 1 (le moteur rend le premier : b) descend sans glisser
          assert.deepEqual(await lire([DOUBLES[3], DOUBLES[2], DOUBLES[1], DOUBLES[0]]), { animations: 'd:1 c:0 b:0', neufs: '' }, 'réordre : b prend la place de a, sans glisser depuis elle')
          // c et d montent, la ligne de clé 1 (a) descend sans glisser
          assert.deepEqual(await lire([DOUBLES[2], DOUBLES[3], DOUBLES[0], DOUBLES[1]]), { animations: 'c:1 d:1 a:0', neufs: '' }, 'la ligne de clé 1 descend : muette')
          // plus de doublon : la ligne de clé 1 est sûre, elle glisse comme les autres
          assert.deepEqual(await lire([DOUBLES[2], DOUBLES[3], DOUBLES[0]]), { animations: 'c:1 d:1 a:1', neufs: '' }, 'sans doublon, elle glisse')
          assert.deepEqual(erreurs, [])
        })

        it('deux éléments de même clé dans un objet : la ligne qui porte la clé ne s\'anime pas, les autres glissent depuis leur place', async () => {
          const lire = async (apres: any) => resume(await jouer('objet', OBJET, apres, LIRE))
          assert.deepEqual(await lire({ s: DOUBLES[3], r: DOUBLES[2], q: DOUBLES[1], p: DOUBLES[0] }), { animations: 'd:1 c:0 b:0', neufs: '' }, 'réordre')
          assert.deepEqual(await lire({ r: DOUBLES[2], s: DOUBLES[3], p: DOUBLES[0] }), { animations: 'c:1 d:1 a:1', neufs: '' }, 'sans doublon, la ligne de clé 1 glisse')
          assert.deepEqual(erreurs, [])
        })

        it('deux éléments de même clé : jugé balise par balise, aucune ne part de la place d\'une autre', async () => {
          const r = await jouer('doubles', DOUBLES, [DOUBLES[3], DOUBLES[2], DOUBLES[1], DOUBLES[0]])
          assert.deepEqual(r.mauvais, [], r.detail)
          assert.equal(r.glissent, 1, r.detail)
          assert.deepEqual(erreurs, [])
        })

        it('un `mjs-key` vide écrit à la main sur chaque ligne : aucune identité commune, chaque ligne glisse depuis sa propre place', async () => {
          assert.deepEqual(await rejouer('vides', VIDES, { 'réordre': par(VIDES, 3, 1, 0, 2), 'second réordre': par(VIDES, 2, 0, 3, 1) }), [])
          assert.deepEqual(erreurs, [])
        })

        it('un `mjs-key` vide écrit à la main sur une balise plus profonde que la racine : aucune identité commune non plus', async () => {
          assert.deepEqual(await rejouer('videsProfonds', VIDES, { 'réordre': par(VIDES, 3, 1, 0, 2), 'second réordre': par(VIDES, 2, 0, 3, 1) }), [])
          assert.deepEqual(erreurs, [])
        })

        it('un `mjs-key` écrit à la main sur une seule racine : il reste l\'identité de la ligne', async () => {
          assert.deepEqual(await rejouer('explicite', BASE, { 'réordre': L('d', 'b', 'a', 'c'), 'ligne neuve en tête': [ligne('e'), ...L('d', 'b', 'a', 'c')] }), [])
          assert.deepEqual(erreurs, [])
        })

        it('une liste de valeurs simples sans `by` : jamais animée, les lignes changent de texte sur place', async () => {
          await poser('valeurs', VALEURS)
          await calmer('valeurs')
          await poser('valeurs', ['d', 'b', 'a', 'c'])
          const lus: any[] = await page.evaluate(LIRE, [TAG, 'valeurs'])
          assert.deepEqual(lus.map((x) => x.k + ':' + x.n), ['d:0', 'b:0', 'a:0', 'c:0'])
          assert.deepEqual(erreurs, [])
        })
      })
    }
  }
})
