// production — étalement `{...o}` sur une balise TIERCE (élément à tiret absent du manifeste) : la balise reçoit chaque clé de la donnée
// en propriété propre (cas documenté, docs/15-elements-speciaux.md), et le cœur y pose aussi la classe et les attributs que le
// navigateur lit sur la balise (µ._mjs_spWc, µ._mjs_spCls). En production, les noms internes du cœur prennent des noms courts
// (`.mangle-cache.json`) : une clé de la donnée qui porte le même nom court ne doit ni remplacer ce que le cœur range pour la balise
// (attente de sa définition, part étalée de la classe, props déclarées), ni être remplacée par lui : ce que l'étalement range pour la
// balise vit dans des tables du cœur, jamais sur elle. De même pour un attribut global calculé (`title={$t}`, `class={$c}`) écrit avec
// l'étalement, avant ou après lui : sa dernière valeur, l'attente de la définition de la balise et la classe écrite que l'écriture suivante
// remplace vivent dans des tables du cœur, et les props déclarées ne se lisent que sur un composant du projet.
//
// Les clés d'exécution sont relevées dans le cache d'une PREMIÈRE construction puis injectées en base64 dans la source : elles
// n'apparaissent jamais en clair dans le code compilé. Trois témoins (un texte, un nombre, `false`), toutes les clés courtes à la fois.
// Montage dans un Chromium réel ; Chromium absent : les montages sont sautés, les assertions de construction restent.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type JsMode = 'split' | 'bundle'
type Moteur = 'chromium' | 'firefox' | 'webkit'

const TEMOINS: unknown[] = ['polluant', 7, false]
const BASE              = { name: 'Ana', class: 'cl-etalee', title: 'titre-etale', 'data-x': 'dx' }
// chaque ligne : la balise tierce définie par la page avant le cœur (avec et sans classe écrite), la balise tierce jamais définie, la
// balise `mjs-` absente du manifeste
const LIGNE = '<x-def {...r}></x-def><x-def class="cl-ecrite" {...r}></x-def><x-tiers {...r}></x-tiers><mjs-absent {...r}></mjs-absent>'
// ce que pose l'étalement sans aucune clé courte : la balise définie reçoit la classe étalée (union avec la classe écrite) ; une balise
// jamais définie ne la reçoit pas (elle attend sa définition) ; `title` passe par la propriété native, `data-*` tout de suite
const ATTENDU = [
  { tag: 'x-def', cls: 'cl-etalee' },
  { tag: 'x-def', cls: 'cl-ecrite cl-etalee' },
  { tag: 'x-tiers', cls: null },
  { tag: 'mjs-absent', cls: null },
]

function ecrire(src: string, cles: string[]): void {
  mkdirSync(join(src, 'doc'), { recursive: true })
  writeFileSync(join(src, 'doc', 'doc-carte.mjs'), ['<script>', "$name = 'defaut'", '</script>', '<p>{$name}</p>', ''].join('\n'))
  const rows = TEMOINS.map((t) => {
    const r: Record<string, unknown> = {}
    for(const c of cles) r[c] = t
    return { ...r, ...BASE }
  })
  const b64 = Buffer.from(JSON.stringify(rows), 'utf-8').toString('base64')
  writeFileSync(join(src, 'parent.mjs'), `<script>\n$rows = JSON.parse(atob('${b64}'))\n</script>\n<mjs-doc-carte name="x"></mjs-doc-carte>{for r in $rows}${LIGNE}{end}\n`)
}

async function construire(root: string, js: JsMode): Promise<string[]> {
  const out     = join(root, 'out')
  const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', env: 'prod', js })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const cache: Record<string, string | false> = JSON.parse(readFileSync(join(out, '.mangle-cache.json'), 'utf-8'))
  return [...new Set(Object.values(cache).filter((c): c is string => typeof c === 'string'))].sort()
}

async function servir(root: string): Promise<{ url: string; server: Server }> {
  const outDir = join(root, 'out')
  const html   = '<!doctype html><html><head><meta charset="utf-8"><script>customElements.define(\'x-def\', class extends HTMLElement {})</script></head><body><mjs-parent></mjs-parent><script type="module" src="/out/bundle.js"></script></body></html>'
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if(chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    const fichier = join(root, normalize(chemin))
    if(!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { url: `http://127.0.0.1:${(server.address() as any).port}/`, server }
}

// par balise relevée : sa classe, son titre, son `data-x`, et les clés courtes de la donnée dont la propriété propre ne vaut plus le
// témoin de sa ligne — des chaînes seulement, jamais un nœud
function releverPage(cles: string[]): Array<{ tag: string; cls: string | null; title: string | null; dx: string | null; ecrasees: string[] }> {
  const p: any = document.querySelector('mjs-parent')
  const rows   = (p && p._state && p._state.rows) || []
  const tags   = p && p._shadow ? Array.from(p._shadow.querySelectorAll('x-def, x-tiers, mjs-absent')) as any[] : []
  return tags.map((el, i) => {
    const t = rows[Math.floor(i / 4)][cles[0]]
    return {
      tag: el.localName,
      cls: el.getAttribute('class'),
      title: el.getAttribute('title'),
      dx: el.getAttribute('data-x'),
      ecrasees: cles.filter(c => !Object.prototype.hasOwnProperty.call(el, c) || el[c] !== t).map(c => `${c}=${typeof el[c] === 'object' && el[c] ? 'objet' : String(el[c])}`),
    }
  })
}

async function moteurDisponible(nom: Moteur = 'chromium'): Promise<any> {
  try {
    const playwright = await import('playwright')
    if(!existsSync(playwright[nom].executablePath())) return null
    return await playwright[nom].launch(nom === 'chromium' ? { chromiumSandbox: false } : {})
  }
  catch {
    return null
  }
}

describe('production — étalement sur une balise tierce : les clés aux noms courts du cœur', function () {
  this.timeout(180000)
  let browser: any = null

  before(async function () {
    this.timeout(30000)
    browser = await moteurDisponible()
    if(!browser) console.log('  ℹ️  Chromium non installé : montages sautés, assertions de construction gardées. Activer : `npx playwright install chromium`')
  })

  after(async () => {
    if(browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for(const js of ['bundle', 'split'] as JsMode[]) {
    it(`js: '${js}' — chaque clé reste sur la balise, la classe et les attributs étalés se posent comme sans elles`, async function () {
      const root = mjsTmp(`etale-tierce-${js}`)
      ecrire(join(root, 'src'), [])
      const cles = await construire(root, js)
      assert.ok(cles.length > 0, 'la construction doit avoir donné des noms courts à des propriétés internes')
      ecrire(join(root, 'src'), cles)
      assert.deepEqual(await construire(root, js), cles, 'les noms courts ne doivent pas changer d\'une construction à l\'autre')
      if(!browser) return
      const { url, server } = await servir(root)
      const page              = await browser.newPage()
      const erreurs: string[] = []
      page.on('pageerror', (e: Error) => erreurs.push(e.message))
      page.on('console', (m: any) => { if(m.type() === 'error') erreurs.push(m.text()) })
      try {
        await page.goto(url, { waitUntil: 'load' })
        await page.waitForTimeout(700)
        const releve = await page.evaluate(releverPage, cles)
        assert.equal(releve.length, TEMOINS.length * ATTENDU.length, `balises rendues — erreurs de page : ${erreurs.join(' / ') || 'aucune'}`)
        releve.forEach((r, i) => {
          const a = ATTENDU[i % ATTENDU.length], t = TEMOINS[Math.floor(i / ATTENDU.length)]
          const ou = `<${r.tag}> n° ${i % ATTENDU.length}, témoin ${JSON.stringify(t)}`
          assert.equal(r.tag, a.tag, ou)
          assert.deepEqual(r.ecrasees, [], `${ou} : clés de la donnée remplacées sur la balise`)
          assert.equal(r.cls, a.cls, `${ou} : classe`)
          assert.equal(r.title, 'titre-etale', `${ou} : titre`)
          assert.equal(r.dx, 'dx', `${ou} : data-x`)
        })
        // seul message toléré : le refus de l'autoloader (balise absente du manifeste, découpage éclaté)
        assert.deepEqual(erreurs.filter(e => !e.includes('[Autoloader]')), [], 'aucune erreur de page hors le refus attendu de l\'autoloader')
      }
      finally {
        await page.close()
        await new Promise(resolve => server.close(() => resolve(null)))
      }
    })
  }
})

// l'attribut global calculé avec l'étalement : chaque cas est un composant enfant (sa racine porte la balise), monté dans une ligne de
// {for} du parent, qui lui passe la donnée, la classe et le titre ; une ligne sans clé courte, puis une par témoin
const MOTEURS: Moteur[] = ['chromium', 'firefox', 'webkit']
const CAS               = ['x-def', 'x-tiers', 'mjs-absent'].flatMap(b => ['title', 'class'].flatMap(a => [true, false].map(avant => ({ b, a, avant, nom: `sc-${b.replace(/^(?:x|mjs)-/, '')}-${a}-${avant ? 'avant' : 'apres'}` }))))

function ecrireCas(src: string, cles: string[]): void {
  mkdirSync(src, { recursive: true })
  for(const c of CAS) {
    const attr = `${c.a}={$${c.a === 'title' ? 't' : 'c'}}`
    writeFileSync(join(src, `${c.nom}.mjs`), ['<script>', '$d = {}', "$c = ''", "$t = ''", '</script>', c.avant ? `<${c.b} ${attr} {...$d}></${c.b}>` : `<${c.b} {...$d} ${attr}></${c.b}>`, ''].join('\n'))
  }
  const rows = [{ ...BASE }, ...TEMOINS.map((t) => {
    const r: Record<string, unknown> = {}
    for(const c of cles) r[c] = t
    return { ...r, ...BASE }
  })]
  const b64 = Buffer.from(JSON.stringify(rows), 'utf-8').toString('base64')
  writeFileSync(join(src, 'parent.mjs'), `<script>\n$rows = JSON.parse(atob('${b64}'))\n$c = 'cl-ecrite'\n$t = 'titre-ecrit'\n</script>\n{for r in $rows}${CAS.map(c => `<mjs-${c.nom} d={r} c={$c} t={$t}></mjs-${c.nom}>`).join('')}{end}\n`)
}

// ce que pose le cas sans aucune clé courte : le titre écrit gagne sur celui de la donnée ; la classe (écrite et étalée) ne se pose que
// sur la balise définie ; `data-*` tout de suite
function attenduCas(c: typeof CAS[number], titre: string, classe: string): Record<string, unknown> {
  const definie = c.b === 'x-def'
  return { nom: `mjs-${c.nom}`, rendu: true, cls: definie ? (c.a === 'class' ? [classe, 'cl-etalee'].sort().join(' ') : 'cl-etalee') : null, title: c.a === 'title' ? titre : 'titre-etale', dx: 'dx' }
}

// par composant enfant : la balise de sa racine (classe en jetons triés, titre, `data-x`) et les clés courtes de la donnée dont la
// propriété propre ne vaut plus le témoin de sa ligne — des chaînes seulement, jamais un nœud
function releverCas(arg: { cles: string[]; temoins: unknown[]; n: number }): Array<Record<string, unknown>> {
  const p: any  = document.querySelector('mjs-parent')
  const enfants = p && p._shadow ? (Array.from(p._shadow.querySelectorAll('*')) as any[]).filter(k => k.localName.startsWith('mjs-sc-')) : []
  return enfants.map((k, i) => {
    const ligne = Math.floor(i / arg.n)
    const el    = k._shadow ? k._shadow.querySelector('x-def, x-tiers, mjs-absent') : null
    if(!el) return { nom: k.localName, rendu: false, cls: null, title: null, dx: null, ecrasees: [] }
    const cls = el.getAttribute('class')
    const t   = arg.temoins[ligne - 1]
    return {
      nom: k.localName,
      rendu: true,
      cls: cls === null ? null : cls.split(/\s+/).filter(Boolean).sort().join(' '),
      title: el.getAttribute('title'),
      dx: el.getAttribute('data-x'),
      ecrasees: ligne === 0 ? [] : arg.cles.filter(c => !Object.prototype.hasOwnProperty.call(el, c) || el[c] !== t).map(c => `${c}=${typeof el[c] === 'object' && el[c] ? 'objet' : String(el[c])}`),
    }
  })
}

function changerClasseEtTitre(): void {
  const p: any = document.querySelector('mjs-parent')
  p._set('c', 'cl-deux')
  p._set('t', 'titre-deux')
}

// les composants enfants rendus, chacun avec son ombre
function enfantsRendus(total: number): boolean {
  const p: any = document.querySelector('mjs-parent')
  return !!(p && p._shadow) && (Array.from(p._shadow.querySelectorAll('*')) as any[]).filter(k => k.localName.startsWith('mjs-sc-') && k._shadow).length === total
}

describe('production — attribut global calculé avec l\'étalement sur une balise tierce : les clés aux noms courts du cœur', function () {
  this.timeout(240000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for(const js of ['bundle', 'split'] as JsMode[]) {
    describe(`js: '${js}'`, function () {
      let root           = ''
      let cles: string[] = []

      before(async function () {
        this.timeout(120000)
        root = mjsTmp(`etale-tierce-attr-${js}`)
        ecrireCas(join(root, 'src'), [])
        cles = await construire(root, js)
        assert.ok(cles.length > 0, 'la construction doit avoir donné des noms courts à des propriétés internes')
        ecrireCas(join(root, 'src'), cles)
        assert.deepEqual(await construire(root, js), cles, 'les noms courts ne doivent pas changer d\'une construction à l\'autre')
      })

      for(const moteur of MOTEURS) {
        it(`${moteur} — montage et mise à jour de l'attribut : chaque clé reste sur la balise, le titre et la classe se posent comme sans elles`, async function () {
          const browser = await moteurDisponible(moteur)
          if(!browser) this.skip()
          const { url, server } = await servir(root)
          const erreurs: string[] = []
          try {
            const page = await browser.newPage()
            page.on('pageerror', (e: Error) => erreurs.push(e.message))
            page.on('console', (m: any) => { if(m.type() === 'error') erreurs.push(m.text()) })
            await page.goto(url, { waitUntil: 'load' })
            const n     = CAS.length
            const total = (TEMOINS.length + 1) * n
            await page.waitForFunction(enfantsRendus, total, { timeout: 10000 }).catch(() => null)
            await page.waitForTimeout(400)
            for(const [etape, titre, classe] of [['montage', 'titre-ecrit', 'cl-ecrite'], ['mise à jour', 'titre-deux', 'cl-deux']]) {
              if(etape !== 'montage') {
                await page.evaluate(changerClasseEtTitre)
                await page.waitForTimeout(500)
              }
              const releve = await page.evaluate(releverCas, { cles, temoins: TEMOINS, n })
              assert.equal(releve.length, total, `${etape} : composants rendus — erreurs de page : ${erreurs.join(' / ') || 'aucune'}`)
              releve.forEach((r, i) => {
                const c                   = CAS[i % n]
                const ligne               = Math.floor(i / n)
                const ou                  = `${etape}, <${c.b} ${c.avant ? `${c.a}={…} {...d}` : `{...d} ${c.a}={…}`}>, ${ligne ? `témoin ${JSON.stringify(TEMOINS[ligne - 1])}` : 'sans clé courte'}`
                const { ecrasees, ...vu } = r
                assert.deepEqual(ecrasees, [], `${ou} : clés de la donnée remplacées sur la balise`)
                assert.deepEqual(vu, attenduCas(c, titre, classe), `${ou} — erreurs de page : ${erreurs.join(' / ') || 'aucune'}`)
              })
            }
            // seul message toléré : le refus de l'autoloader (balise absente du manifeste, découpage éclaté)
            assert.deepEqual(erreurs.filter(e => !e.includes('[Autoloader]')), [], 'aucune erreur de page hors le refus attendu de l\'autoloader')
          }
          finally {
            await browser.close()
            await new Promise(resolve => server.close(() => resolve(null)))
          }
        })
      }
    })
  }
})
