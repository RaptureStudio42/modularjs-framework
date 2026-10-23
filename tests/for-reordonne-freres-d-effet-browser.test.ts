// une liste `{for}` à clé qui se réordonne, dans Chromium et Firefox réels : le frère qu'un effet a posé à côté de la
// balise d'une ligne (le reflet de *reflect — une boîte -moz-element dans Firefox, une copie quand on demande du flou —,
// la bulle d'un refus de *guard) suit sa ligne, dans le DOM ET à l'écran. La liste ne déplace que les nœuds de la ligne ;
// la boîte du reflet et la bulle, posées en absolu d'après la place de la balise, restaient à l'ancienne place :
// le reflet d'une ligne s'affichait sous une autre. Les rectangles sont lus à l'écran : le reflet à 4 px sous sa ligne
// (réglage `gap`), la bulle à 6 px sous son champ, à la même abscisse. *reflect sans réglage ne pose rien dans
// Chromium (reflet natif) : ce cas sert de témoin, il ne change pas de forme d'un navigateur à l'autre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// trois lignes de hauteurs différentes : une ligne qui change de place change de hauteur sous elle
const LIGNES: Record<number, { id: number, t: string }> = {
  1: { id: 1, t: 'un' },
  2: { id: 2, t: 'deux deux deux deux deux deux deux' },
  3: { id: 3, t: 'trois trois trois' },
}
const DONNEES = '[' + [1, 2, 3].map((i) => `{id: ${i}, t: '${LIGNES[i].t}'}`).join(', ') + ']'
const STYLE   = '\n<style>\n:host\n  display: block\n.p\n  position: relative\n  padding: 10px 10px 60px\n  width: 220px\n  background: #fff\n.row\n  box-sizing: border-box\n  width: 140px\n  margin: 0 0 30px\n  padding: 4px\n  background: #cde\n  font: 16px/20px sans-serif\n</style>\n'
const GARDE   = 'type="number" min="1" max="10" aria-label="nombre" *guard(delay: 0, duration: 30s)'

const liste = (ligne: string) => `<script>\n$l = ${DONNEES}\n</script>\n<div class="p">{for r in $l by id}${ligne}{end}</div>${STYLE}`

const COMPOSANTS: Record<string, string> = {
  'fx-ordre-reflet': liste('<p class="row" *reflect>{r.t}</p>'),
  'fx-ordre-flou':   liste('<p class="row" *reflect(blur: 2)>{r.t}</p>'),
  'fx-ordre-garde':  liste(`<input class="row" ${GARDE}>`),
}

type Groupe = { tete: string, top: number, bottom: number, left: number, height: number, freres: { nom: string, top: number, left: number, height: number }[] }

describe('{for} à clé — le frère d\'un effet suit sa balise à l\'écran quand la liste se réordonne (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('for-reordonne-freres-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis le runtime, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let browser: any
      let page: any
      let erreurs: string[]

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
        page    = await (await browser.newContext({ viewport: { width: 800, height: 700 } })).newPage()
        erreurs = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        const balises = Object.keys(COMPOSANTS).map((c) => `<mjs-${c}></mjs-${c}>`).join('')
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${balises}<script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((tags: string[]) => tags.every((t) => ((document.querySelector(t) as any)?._shadow?.querySelectorAll('.p .row:not([mjs-fx-layer])').length ?? 0) === 3), Object.keys(COMPOSANTS).map((c) => 'mjs-' + c), { timeout: 90000 })
        await page.evaluate(() => new Promise((r) => setTimeout(r, 300)))
      })

      after(async () => { await browser?.close() })

      // chaque balise de ligne du parent `.p` avec sa boîte, suivie de ses frères d'effet (le reflet se lit « calque »,
      // la bulle de *guard « bulle ») et leur boîte ; une ligne se reconnaît à son premier mot (un champ, à `data-nom`)
      const lire = (tag: string): Promise<Groupe[]> => page.evaluate((tag: string) => {
        const racine  = (document.querySelector(tag) as any)._shadow
        const r2      = (x: number) => Math.round(x * 100) / 100
        const groupes: any[] = []
        for (const c of Array.from(racine.querySelector('.p').children) as any[]) {
          const b      = c.getBoundingClientRect()
          const couche = c.getAttribute('mjs-fx-layer') ? 'calque' : c.hasAttribute('mjs-fx-guard-tip') ? 'bulle' : ''
          if (couche) groupes[groupes.length - 1].freres.push({ nom: couche, top: r2(b.top), left: r2(b.left), height: r2(b.height) })
          else groupes.push({ tete: c.getAttribute('data-nom') || c.textContent.split(' ')[0], top: r2(b.top), bottom: r2(b.bottom), left: r2(b.left), height: r2(b.height), freres: [] })
        }
        return groupes
      }, tag)

      const poser = (tag: string, ids: number[]) => page.evaluate(([tag, lignes]: [string, any[]]) => new Promise<void>((fin) => {
        (document.querySelector(tag) as any)._set('l', lignes)
        setTimeout(fin, 400)
      }), [tag, ids.map((i) => LIGNES[i])])

      const proche = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) <= 1.5, `${msg} : ${a} au lieu de ${b}`)
      const noms   = (groupes: Groupe[]) => groupes.map((g) => g.tete).join(',')

      // chaque ligne porte un reflet unique, à 4 px sous elle, de même abscisse et de même hauteur
      const refletsJustes = (groupes: Groupe[]) => {
        for (const g of groupes) {
          assert.equal(g.freres.length, 1, 'un seul reflet derrière la ligne ' + g.tete)
          const f = g.freres[0]
          proche(f.top, g.bottom + 4, 'le reflet de la ligne ' + g.tete + ' est à 4 px sous elle')
          proche(f.left, g.left, 'le reflet de la ligne ' + g.tete + ' est à son abscisse')
          proche(f.height, g.height, 'le reflet de la ligne ' + g.tete + ' en a la hauteur')
        }
      }

      const permutations: Array<[number[], string]> = [[[3, 2, 1], 'trois,deux,un'], [[2, 3, 1], 'deux,trois,un'], [[1, 2, 3], 'un,deux,trois']]

      it('*reflect sans réglage : après chaque permutation, le reflet de chaque ligne est sous elle (Firefox : sa boîte ; Chromium : natif, aucun frère)', async () => {
        const tag = 'mjs-fx-ordre-reflet'
        for (const [ids, attendu] of permutations) {
          await poser(tag, ids)
          const g = await lire(tag)
          assert.equal(noms(g), attendu, 'ordre des lignes ' + ids.join(','))
          if (nom === 'firefox') refletsJustes(g)
          else assert.deepEqual(g.map((x) => x.freres.length), [0, 0, 0], 'reflet natif : aucun frère')
        }
      })

      it('*reflect(blur: 2) : après chaque permutation, la copie du reflet de chaque ligne est à 4 px sous elle', async () => {
        const tag = 'mjs-fx-ordre-flou'
        const avant = await lire(tag)
        assert.equal(noms(avant), 'un,deux,trois', 'au départ')
        refletsJustes(avant)
        for (const [ids, attendu] of permutations) {
          await poser(tag, ids)
          const g = await lire(tag)
          assert.equal(noms(g), attendu, 'ordre des lignes ' + ids.join(','))
          refletsJustes(g)
        }
      })

      it('*guard : la bulle du refus suit son champ, à 6 px dessous, quand la liste se réordonne', async () => {
        const tag = 'mjs-fx-ordre-garde'
        await page.evaluate((tag: string) => {
          const champs = Array.from((document.querySelector(tag) as any)._shadow.querySelectorAll('.row:not([mjs-fx-layer])')) as any[]
          champs.forEach((c, i) => c.setAttribute('data-nom', ['un', 'deux', 'trois'][i]))
          champs[0].value = '99'
          champs[0].dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        }, tag)
        // le premier réordonnancement tombe en plein tremblement (il dure 450 ms), le champ est alors décalé de quelques pixels
        await page.waitForTimeout(100)
        const avant = await lire(tag)
        assert.equal(avant[0].freres.length, 1, 'une bulle derrière le premier champ')
        for (const [ids, attendu] of permutations) {
          await poser(tag, ids)
          // le tremblement du refus (une transformation) fausse la mesure du champ à l'écran : on attend sa fin ; la bulle,
          // elle, a été posée pendant le tremblement et doit être juste une fois le champ au repos
          await page.waitForFunction((tag: string) => (document.querySelector(tag) as any)._shadow.querySelectorAll('.row').length > 0 && Array.from((document.querySelector(tag) as any)._shadow.querySelectorAll('.row')).every((c: any) => c.getAnimations().length === 0), tag, { timeout: 10000 })
          const g = await lire(tag)
          assert.equal(noms(g), attendu, 'ordre des champs ' + ids.join(','))
          assert.deepEqual(g.map((x) => x.freres.length), g.map((x) => x.tete === 'un' ? 1 : 0), 'la bulle est derrière le champ refusé, seul')
          const un = g.find((x) => x.tete === 'un') as Groupe
          proche(un.freres[0].top, un.bottom + 6, 'la bulle est à 6 px sous le champ refusé (' + ids.join(',') + ')')
          proche(un.freres[0].left, un.left, 'la bulle est à l\'abscisse du champ refusé (' + ids.join(',') + ')')
        }
      })

      it('aucune erreur de page', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
