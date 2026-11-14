// Valeurs dérivées précises (option `derived: "precise"`) : une méthode de parcours d'une liste (`filter`, `map`, `find`,
// `every`…) lue pendant le calcul contrôlé d'une valeur précise parcourt la liste brute, une seule entrée pour toute la liste,
// sans passer par l'enveloppe à chaque indice. Le résultat reste celui de la règle de toujours (le même paquet bâti sans
// l'option) : éléments rendus enveloppés (une écriture par le résultat se voit), édition d'une ligne suivie ; un accesseur
// posé sur une ligne lit une donnée de la page, changée hors de MJS : `µrefresh($rows)` juste après le changement, dans les
// deux paquets, et la valeur rend celle de la règle de toujours. Seule différence, voulue : relue après une écriture sans
// rapport, la valeur précise sert son dernier calcul. Développement et production ; happy-dom, Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const LISTE = `<script>
$rows = []
$pos = {x: 0}
$vis = $rows.filter((r) -> r.sel)
$noms = $rows.map((r) -> r.l)
$premier = $rows.find((r) -> r.sel)
$tous = $rows.every((r) -> r.id >= 0)
@choisir = (x) -> $rows = x
@bouger = (i) -> $pos = {x: i}
@editer = (i) -> $rows[i].sel = not $rows[i].sel
@rafraichir = -> µrefresh($rows)
</script>
<p class="v">{$vis.length} {$noms.length}</p>
`

const SCENARIO = `(async () => {
  const pause = () => new Promise((r) => setTimeout(r, 20))
  const m = document.querySelector('mjs-derive-parcours-liste')
  const R = {}
  m.choisir(Array.from({length: 200}, (_, i) => ({id: i, l: 'l' + i, sel: i % 2 === 0}))); await pause()
  const vis = m._state.vis
  R.vis = vis.length
  R.enveloppe = vis[1] === m._state.rows[2]
  R.noms = m._state.noms.slice(0, 3).join(',')
  R.premier = m._state.premier.l
  R.tous = m._state.tous
  m.bouger(1)
  R.memeApresAutre = m._state.vis === vis
  m.editer(0)
  R.visApresEdition = m._state.vis.length
  R.premierApresEdition = m._state.premier.l
  m._state.vis[0].sel = false; await pause()
  R.visApresEcritureParLeResultat = m._state.vis.length
  R.ecran = m._shadow.querySelector('.v').textContent
  window.__ext = {a: true}
  const rows = Array.from({length: 5}, (_, i) => ({id: i, l: 'a' + i, sel: false}))
  Object.defineProperty(rows[3], 'sel', {get: () => window.__ext.a, enumerable: true})
  m.choisir(rows); await pause()
  const avant = m._state.vis.length
  window.__ext.a = false
  m.rafraichir()
  m.bouger(2); await pause()
  R.accesseur = avant + ' → ' + m._state.vis.length + ' | écran ' + m._shadow.querySelector('.v').textContent
  return R
})()`

const CORPS = '<mjs-derive-parcours-liste></mjs-derive-parcours-liste>'

async function construire(prod: boolean, precise: boolean): Promise<string> {
  const root   = mjsTmp('derive-parcours')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-parcours-liste.mjs'), LISTE)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  opts.derivedMode = precise ? 'precise' : 'clock'
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

async function jouerHappyDom(code: string): Promise<any> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(code)
  window.document.body.innerHTML = CORPS
  const fin = Date.now() + 5000
  while (!window.document.querySelector('mjs-derive-parcours-liste')?._shadow?.querySelector('.v') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  // objets de la fenêtre de happy-dom : comparés par leur texte
  const r = JSON.parse(JSON.stringify(await window.eval(SCENARIO)))
  await window.happyDOM.close()
  return r
}

async function jouerMoteur(moteur: string, code: string): Promise<any> {
  const playwright: any = await import('playwright')
  const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  try {
    const page = await browser.newPage()
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${CORPS}<script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
    await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
    await page.goto('http://mjs.test/')
    await page.waitForFunction(() => !!(document.querySelector('mjs-derive-parcours-liste') as any)?._shadow?.querySelector('.v'))
    return await page.evaluate(SCENARIO)
  }
  finally {
    await browser.close()
  }
}

// la valeur précise rend ce que rend la règle de toujours ; relue après une écriture sans rapport, elle sert son dernier calcul
function verifier(precise: any, horloge: any) {
  const { memeApresAutre: mp, ...p } = precise
  const { memeApresAutre: mh, ...h } = horloge
  assert.deepEqual(p, h)
  assert.ok(mp === true && mh === false, `relue après une écriture sans rapport : précise ${mp}, horloge ${mh}`)
  assert.equal(p.vis, 100)
  assert.equal(p.enveloppe, true)
  assert.equal(p.visApresEdition, 99)
  assert.equal(p.visApresEcritureParLeResultat, 98)
  assert.match(p.accesseur, /^1 → 0/)
}

describe('valeurs dérivées précises : un parcours de liste en une seule entrée, le résultat de la règle de toujours', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let precise: string
      let horloge: string
      before(async () => {
        precise = await construire(prod, true)
        horloge = await construire(prod, false)
      })

      it('happy-dom : même résultat que sans l\'option, dernier calcul servi après une écriture sans rapport', async () => {
        verifier(await jouerHappyDom(precise), await jouerHappyDom(horloge))
      })

      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        it(`${moteur} : même résultat que sans l'option, dernier calcul servi après une écriture sans rapport`, async function () {
          const playwright: any = await import('playwright')
          if (!existsSync(playwright[moteur].executablePath())) return this.skip()
          verifier(await jouerMoteur(moteur, precise), await jouerMoteur(moteur, horloge))
        })
      }
    })
  }
})
