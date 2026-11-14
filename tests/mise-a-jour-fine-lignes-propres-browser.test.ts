// lignes propres, au navigateur réel (Chromium, Firefox, WebKit) : échange, retrait, ajout et écriture par l'enveloppe donnent l'écran de la
// variable entière prévenue ; un objet de la liste changé hors de MJS garde son ancienne valeur à l'échange suivant, un avertissement de
// développement le dit une fois, `µrefresh($data)` le montre. Après la reprise d'un rendu serveur (chaque ligne reprise posée par son
// gabarit avec l'objet du client), la liste est propre : l'échange ne relit aucune ligne, la règle de l'objet changé hors de MJS vaut

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MOTEURS, compilerScript, ouvrirPage } from './helpers/navigateurs-compiles.js'
import { mjsTmp } from './helpers/tmp.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const LISTE = [
  '<script lang="js">',
  '  let tenu = null;',
  '  function pick(a) { return a[3]; }',
  '  $data = [{ id: 1, label: \'a\' }, { id: 2, label: \'b\' }, { id: 3, label: \'c\' }, { id: 4, label: \'d\' }, { id: 5, label: \'e\' }];',
  '  @echanger = function() { const t = $data[1]; $data[1] = $data[3]; $data[3] = t; };',
  '  @retirer = function() { $data.splice(0, 1); };',
  '  @ajouter = function() { $data.push({ id: 9, label: \'i\' }); };',
  '  @dehors = function() { tenu = { id: 7000, label: \'h\' }; $data.push(tenu); };',
  '  @muter = function() { tenu.label = \'h2\'; };',
  '  @muterEchanger = function() { tenu.label = \'h3\'; const t = $data[1]; $data[1] = $data[3]; $data[3] = t; };',
  '  @rafraichir = function() { µrefresh($data); };',
  '  @fine = function() { $data[2].label += \'*\'; };',
  '  @filet = function() { const r = pick($data); r.label += \'!\'; const t = $data[1]; $data[1] = $data[2]; $data[2] = t; };',
  '</script>',
  '<ul>{for row in $data by id}<li>{row.label}</li>{end}</ul>',
].join('\n')

// [geste, écran attendu ensuite] ; `muter` ne prévient rien : l'écran ne bouge pas. Le champ écrit par `fine` (un chemin compilé) donne
// sa table à la variable : sans elle, la liste est relue entière à chaque passe, comme une liste ordinaire
const PAS: [string, string][] = [
  ['echanger', 'a d c b e'],
  ['retirer', 'd c b e'],
  ['ajouter', 'd c b e i'],
  ['dehors', 'd c b e i h'],
  ['muter', 'd c b e i h'],
  ['echanger', 'd e b c i h'],
  ['rafraichir', 'd e b c i h2'],
  ['muterEchanger', 'd c b e i h2'],
  ['rafraichir', 'd c b e i h3'],
  ['fine', 'd c b* e i h3'],
  ['echanger', 'd e b* c i h3'],
  ['filet', 'd b* e c! i h3'],
]

// l'écran de la liste, et les avertissements reçus (`µ.warn`, relevé posé avant le premier geste)
const OUTILS = `window.__ecran = () => Array.from(document.querySelector('mjs-liste')._shadow.querySelectorAll('li')).map((x) => x.textContent).join(' ')
window.__avis = []`

describe('mise à jour fine — lignes propres (trois moteurs)', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  it('échange, retrait, ajout, enveloppe ; objet changé hors de MJS : ancienne valeur, un avertissement, µrefresh', async () => {
    const script = await compilerScript('fine-lignes-propres-nav', { 'liste.mjs': LISTE })
    for (const moteur of MOTEURS) {
      const { browser, page, erreurs } = await ouvrirPage(moteur, '<mjs-liste></mjs-liste>', script + '\n' + OUTILS)
      try {
        await page.waitForFunction(() => (document.querySelector('mjs-liste') as any)?._shadow?.querySelector('li') != null)
        await page.evaluate(() => { const w = (window as any).µ.warn; (window as any).µ.warn = (...a: any[]) => { (window as any).__avis.push(a.join(' ')); return w(...a) } })
        const vus: string[] = []
        for (const [geste] of PAS) {
          await page.evaluate((g: string) => (document.querySelector('mjs-liste') as any)[g](), geste)
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
          vus.push(await page.evaluate(() => (window as any).__ecran()))
        }
        assert.deepEqual(vus, PAS.map((p) => p[1]), moteur)
        const avis = (await page.evaluate(() => (window as any).__avis)).filter((a: string) => a.includes('7000'))
        assert.equal(avis.length, 1, moteur)
        assert.match(avis[0], /<@liste> : la ligne de clé 7000 de \$data a changé sans passer par MJS : écrivez µrefresh\(\$data\) après ce changement\./, moteur)
        assert.deepEqual(erreurs, [], moteur)
      }
      finally {
        await browser.close()
      }
    }
  })

  it('reprise d\'un rendu serveur : liste propre dès la reprise, l\'échange ne relit aucune ligne ; objet changé hors de MJS, puis µrefresh', async () => {
    const root   = mjsTmp('fine-lignes-propres-reprise')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'liste.mjs'), LISTE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate'] } })
    const { html, hydrateScript } = await renderer.renderToString('mjs-liste', { ssrMode: 'markers' })
    await renderer.close()
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js') && f !== 'bundle.js')
    const ordre  = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const bundle = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright: any = await import('playwright')
    for (const moteur of MOTEURS) {
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}${hydrateScript}<script>${bundle}</script></body></html>`, { waitUntil: 'networkidle' })
        await page.waitForFunction(() => (document.querySelector('mjs-liste') as any)?._mjs_hydrated === true)
        const res = await page.evaluate(async () => {
          const el = document.querySelector('mjs-liste') as any
          const attendre = () => new Promise((r) => setTimeout(r, 30))
          const ecran = () => Array.from(el.shadowRoot.querySelectorAll('li')).map((x: any) => x.textContent).join(' ')
          const relues: number[] = []
          const espion = () => {
            const c = { n: 0 }
            for (const cache of Object.values(el._mjs_list_cache) as any[]) {
              for (const en of cache.values()) {
                const f = en._mjs_updFn
                if (f) en._mjs_updFn = (it: any, ix: any, m?: number) => { if (m === undefined) c.n++; return f(it, ix, m) }
              }
            }
            return c
          }
          const vus: string[] = [ecran()]
          for (const g of ['echanger', 'echanger', 'dehors', 'muterEchanger', 'rafraichir']) {
            const c = espion()
            el[g]()
            await attendre()
            relues.push(c.n)
            vus.push(ecran())
          }
          return { vus, relues }
        })
        assert.deepEqual(res.vus, ['a b c d e', 'a d c b e', 'a b c d e', 'a b c d e h', 'a d c b e h', 'a d c b e h3'], moteur)
        assert.deepEqual(res.relues, [0, 0, 0, 0, 6], moteur)
        assert.deepEqual(erreurs, [], moteur)
      }
      finally {
        await browser.close()
      }
    }
  })
})
