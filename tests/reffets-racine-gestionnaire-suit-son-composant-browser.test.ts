// Une racine `µeffect.root` écrite directement dans un gestionnaire du gabarit (dans l'accolade, affectée, dans une flèche, sous `void`)
// reçoit son composant, comme une racine du `<script>` ouverte par une méthode : ses reffets suivent les variables du composant (`$x`), les
// clés lues d'un `µStore` et du magasin (`$$k`), et finissent avec lui (composant retiré, une écriture du magasin ne les relance plus). Une
// clé `$$k` lue est notée au graphe des signaux : la lecture de `$x` doit l'être aussi, sinon son écriture ne relance plus le reffet.
// Une variable que le reffet lit par une fonction du script (`lireY = -> $y`) ou par une méthode compte de même, aussi quand le `<script>`
// n'a aucun reffet à lui (témoin : le même reffet dans une racine ouverte par une méthode).
// Gabarit Civet, réglage `"proxy": false`, production et développement,
// trois moteurs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SCRIPT = `<script>
vu = (k, v) ->
  window.__n[k] = (window.__n[k] or 0) + 1
  window.__v[k] = v
salon = window.__salon ||= new µStore(v: 0)
arretRange = null
$x = 0
@ouvrir = -> @arret = µeffect.root -> µeffect -> vu('methode', [$x, salon.data.v, $$k].join())
@ecrire = (v) -> $x = v
@ecrireCle = (v) -> $$k = v
</script>
`
// formes de chaque langue du gabarit : CoffeeScript n'a pas d'opérateur `void`
const BOUTONS = `<button class="directe" @click={µeffect.root -> µeffect -> vu('directe', [$x, salon.data.v, $$k].join())}>a</button>
<button class="affectee" @click={arretRange = µeffect.root -> µeffect -> vu('affectee', [$x, salon.data.v, $$k].join())}>b</button>
<button class="fleche" @click={-> @arretFleche = µeffect.root -> µeffect -> vu('fleche', [$x, salon.data.v, $$k].join())}>c</button>
<button class="methode" @click={@ouvrir()}>d</button>
`
const VIDE = `<button class="vide" @click={void (@arretVide = µeffect.root -> µeffect -> vu('vide', [$x, salon.data.v, $$k].join()))}>e</button>
`
const composant = (js: boolean): string => SCRIPT + BOUTONS + (js ? '' : VIDE) + '<p>{$x}</p>\n'

// lecture par une fonction ou une méthode du script : aucun reffet dans le `<script>` de `gest`, seules les racines de ses gestionnaires ;
// `meth`, témoin, ouvre le même reffet par une méthode
const VU = `vu = (k, v) ->
  window.__n[k] = (window.__n[k] or 0) + 1
  window.__v[k] = v
`
const GEST = `<script>
${VU}$x = 0
$y = 0
lireY = -> $y
@lireYParMethode = -> $y
@ecrireY = (v) -> $y = v
</script>
<button class="f" @click={µeffect.root -> µeffect -> vu('gestionnaire', [$x, lireY()].join())}>f</button>
<button class="k" @click={µeffect.root -> µeffect -> vu('gestionnaire et magasin', [lireY(), $$k].join())}>k</button>
<button class="m" @click={µeffect.root -> µeffect -> vu('gestionnaire et méthode', [$x, @lireYParMethode()].join())}>m</button>
<p>{$x}</p>
`
const METH = `<script>
${VU}$x = 0
$y = 0
lireY = -> $y
@ouvrir = -> µeffect.root -> µeffect -> vu('méthode', [$x, lireY()].join())
@ecrireY = (v) -> $y = v
</script>
<p>{$x}</p>
`
const SCENARIO_FONCTION = `
  const sh = (n) => el(n)._shadow || el(n)
  await pas('ouverture', () => { sh('gest').querySelector('button.f').click(); sh('gest').querySelector('button.k').click(); sh('gest').querySelector('button.m').click(); el('meth').ouvrir() })
  await pas('écriture de $y', () => { el('gest').ecrireY(5); el('meth').ecrireY(5) })
  R.push(['valeurs lues', [window.__v['gestionnaire'], window.__v['gestionnaire et méthode'], window.__v['méthode']].join(' ')])
`
const ATTENDU_FONCTION = [
  ['ouverture', { 'gestionnaire': 1, 'gestionnaire et magasin': 1, 'gestionnaire et méthode': 1, 'méthode': 1 }],
  ['écriture de $y', { 'gestionnaire': 1, 'gestionnaire et magasin': 1, 'gestionnaire et méthode': 1, 'méthode': 1 }],
  ['valeurs lues', '0,5 0,5 0,5'],
]

const scenario = (formes: string[]): string => `
  const re   = el('re')
  const clic = (k) => (re._shadow || re).querySelector('button.' + k).click()
  await pas('clics d\\'ouverture', () => { for (const k of ${JSON.stringify(formes)}) clic(k) })
  await pas('écriture de $x', () => re.ecrire(1))
  await pas('écriture du magasin', () => { window.__salon.data.v = 2 })
  await pas('écriture d\\'une clé $$k', () => re.ecrireCle(3))
  R.push(['valeurs lues', Object.keys(window.__v).sort().map((k) => k + '=' + window.__v[k]).join(' ')])
  await pas('composant retiré, écriture du magasin', () => { re.remove(); window.__salon.data.v = 4 })
  await pas('écritures du magasin, plus tard', () => { window.__salon.data.v = 5; re.ecrireCle(6) })
`
const attendu = (formes: string[]): any[] => {
  const tous = Object.fromEntries(formes.map((k) => [k, 1]))
  return [
    ['clics d\'ouverture', tous],
    ['écriture de $x', tous],
    ['écriture du magasin', tous],
    ['écriture d\'une clé $$k', tous],
    ['valeurs lues', [...formes].sort().map((k) => k + '=1,2,3').join(' ')],
    ['composant retiré, écriture du magasin', {}],
    ['écritures du magasin, plus tard', {}],
  ]
}

// [nom, langue du gabarit en "js", réglage `"proxy": false`]
const CAS: [string, boolean, boolean][] = [
  ['gabarit Civet', false, false],
  ['gabarit Civet, "proxy": false', false, true],
]

const construits = new Map<string, Promise<Buffer>>()
const construire = (env: string, js: boolean, sansProxy: boolean): Promise<Buffer> => {
  const cle = `${env}-${js ? 'js' : 'civet'}-${sansProxy ? 'sans' : 'avec'}`
  if (!construits.has(cle)) construits.set(cle, (async () => {
    const root   = mjsTmp('reffets-racine-gestionnaire-composant-' + cle)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 're.mjs'), composant(js))
    writeFileSync(join(srcDir, 'gest.mjs'), GEST)
    writeFileSync(join(srcDir, 'meth.mjs'), METH)
    const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'bundle', minify: env === 'prod' }
    if (sansProxy) opts.proxy = false
    const bundler = new Bundler(opts)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return readFileSync(join(outDir, 'bundle.js'))
  })())
  return construits.get(cle)!
}

after(async () => { await terminateSharedWorkerPool() })

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`µeffect.root écrite dans un gestionnaire du gabarit : elle suit son composant (${moteur})`, function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
    browser = await playwright[moteur].launch()
  })
  after(async () => { if (browser) await browser.close() })
  // la page avec ces composants (`noms`), puis le scénario (`corps`) : ce qui a passé à chaque pas, et les fautes de la page
  const jouer = async (bundle: Buffer, noms: string[], corps: string): Promise<{ vus: any, erreurs: string[] }> => {
    const page    = await browser.newPage()
    const erreurs: string[] = []
    try {
      page.setDefaultTimeout(8000)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text().slice(0, 200)) })
      await page.route('http://localhost/**', async (route: any) => {
        const chemin = new URL(route.request().url()).pathname
        if (chemin === '/out/bundle.js') { await route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle }); return }
        await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${noms.map((n) => `<mjs-${n}></mjs-${n}>`).join('')}<script>window.__n = {}; window.__v = {}</script><script type="module" src="/out/bundle.js"></script></body></html>` })
      })
      await page.goto('http://localhost/', { waitUntil: 'load' })
      const vus = await page.evaluate(`(async () => {
        const el  = (n) => document.querySelector('mjs-' + n)
        const t   = () => new Promise((r) => setTimeout(r, 0))
        const fin = Date.now() + 6000
        while (!${JSON.stringify(noms)}.every((n) => el(n) && (el(n)._shadow || el(n)).querySelector('p')) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        const R = []
        const pas = async (nom, geste) => {
          for (const k in window.__n) window.__n[k] = 0
          geste()
          await t()
          await t()
          await new Promise((r) => setTimeout(r, 30))
          const vu = {}
          for (const k in window.__n) if (window.__n[k] !== 0) vu[k] = window.__n[k]
          R.push([nom, vu])
        }
        ${corps}
        return R
      })()`)
      return { vus, erreurs }
    }
    finally {
      await page.close()
    }
  }
  for (const [nom, js, sansProxy] of CAS) for (const env of ['prod', 'dev']) it(`${nom}, ${env} : suit $x et le magasin, finit avec le composant`, async () => {
    const formes           = js ? ['directe', 'affectee', 'fleche', 'methode'] : ['directe', 'affectee', 'fleche', 'vide', 'methode']
    const { vus, erreurs } = await jouer(await construire(env, js, sansProxy), ['re'], scenario(formes))
    assert.deepEqual(vus, attendu(formes))
    assert.deepEqual(erreurs, [])
  })
  for (const [nom, js, sansProxy] of CAS) for (const env of ['prod', 'dev']) it(`${nom}, ${env} : suit une variable lue par une fonction du script, sans reffet dans le script`, async () => {
    const { vus, erreurs } = await jouer(await construire(env, js, sansProxy), ['gest', 'meth'], SCENARIO_FONCTION)
    assert.deepEqual(vus, ATTENDU_FONCTION)
    assert.deepEqual(erreurs, [])
  })
})
