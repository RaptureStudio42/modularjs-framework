// En production, Chromium. Une racine `µ.effect.root` écrite dans un fichier `.js` importé, copié tel quel et jamais compilé, n'a
// jamais de composant : la construction relève ce fichier comme les unités compilées, et le cœur garde la racine et la mécanique des
// reffets de module, même quand les seules autres racines de l'appli sont dans des composants, ou qu'aucun composant n'écrit de reffet.
// Mêmes passages pour un `.js` importé par un `.js`, par un module `.civet.mjs`, et pour les bibliothèques `.civet` et `.coffee`. Un
// `.js` qui reçoit µ sous un autre nom et y écrit un reffet sans racine (`m.effect(…)`), appelé par le `<script>` d'un composant, emmène
// le module des reffets dans une appli dont aucun composant n'en écrit. Une racine prise autrement que par `.effect.root(` (destructuration
// `const { effect } = µ`, clé entre crochets `µ['effect']`, accès optionnel `µ.effect?.root(`) passe de même, sans `TypeError`
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// le `.js` reçoit µ et le magasin de son appelant (en production, µ n'est pas une variable globale) ; son reffet compte ses passages
// et lit le magasin
const RACINE_JS = (k: string): string => `export const ouvrir = (µ, salon) => µ.effect.root(() => {\n  µ.effect(() => { window.__n.${k} = (window.__n.${k} || 0) + 1; window.__v.${k} = salon.data.v })\n})\n`
// la même racine dans une bibliothèque `.civet` ou `.coffee`, qui reçoit µ de son appelant (elle ne peut pas le nommer)
const RACINE_BIBLIOTHEQUE = (k: string): string => `export ouvrir = (m, salon) -> m.effect.root -> m.effect -> window.__n.${k} = (window.__n.${k} or 0) + 1; window.__v.${k} = salon.data.v\n`
// la même racine prise autrement que par `.effect.root(`, chacune seule dans son appli
const COMPTE = (k: string): string => `window.__n.${k} = (window.__n.${k} || 0) + 1; window.__v.${k} = salon.data.v`
const RACINES_INDIRECTES: Record<string, string> = {
  destructuration: `export const ouvrir = (µ, salon) => {\n  const { effect } = µ\n  return effect.root(() => {\n    effect(() => { ${COMPTE('destructuration')} })\n  })\n}\n`,
  crochets: `export const ouvrir = (µ, salon) => µ['effect'].root(() => {\n  µ['effect'](() => { ${COMPTE('crochets')} })\n})\n`,
  optionnel: `export const ouvrir = (µ, salon) => µ.effect?.root(() => {\n  µ.effect(() => { ${COMPTE('optionnel')} })\n})\n`,
}

// composant qui ouvre une racine à lui (ou aucune) puis celles des fichiers importés, `ouvertures` : les lignes qui les ouvrent
const COMPOSANT = (racine: boolean, ouvertures: string): string => `<script>
$n = 0
salon = new µStore(v: 0)
arrets = []
@ouvrirComposant = -> ${racine ? 'arrets.push µeffect.root -> µeffect -> window.__n.c = (window.__n.c or 0) + 1 if $n >= 0' : 'null'}
@ouvrirFichiers = ->
  try
${ouvertures.split('\n').map(l => '    ' + l).join('\n')}
  catch e
    window.__err = String(e)
@fermer = -> arrets.forEach (a) -> a()
@ecrire = (v) -> salon.data.v = v
</script>
<p>{$n}</p>
`

// `scenario`, `pas` : scénario et passages propres à l'appli ; `options` : réglages de construction en plus
type Appli = { fichiers: Record<string, string>, racine: boolean, attendu: Record<string, number>, scenario?: string, pas?: unknown[], options?: Record<string, unknown> }

const APPLIS: Record<string, Appli> = {
  // une racine dans le composant ; d'autres dans un `.js`, dans un `.js` importé par un `.js`, dans un `.js` importé par un module `.civet.mjs`
  composant: {
    racine: true,
    fichiers: {
      'rj.mjs': COMPOSANT(true, "m = await µimport('./aide.js')\narrets.push m.ouvrir(µ, salon)\nr = await µimport('./relais.js')\narrets.push r.ouvrir(µ, salon)\np = await µimport('passe.civet.mjs')\narrets.push await p.ouvrir(µ, salon)"),
      'aide.js': RACINE_JS('js'),
      'relais.js': "import { ouvrir as profond } from './profond.js'\nexport const ouvrir = (µ, salon) => profond(µ, salon)\n",
      'profond.js': RACINE_JS('profond'),
      'passe.civet.mjs': "export ouvrir = (µ, salon) ->\n  s := await µimport('./sous.js')\n  s.ouvrir(µ, salon)\n",
      'sous.js': RACINE_JS('sous'),
    },
    attendu: { js: 1, profond: 1, sous: 1 },
  },
  // aucun composant n'écrit de reffet : seul le `.js` en a
  seul: {
    racine: false,
    fichiers: { 'rj.mjs': COMPOSANT(false, "m = await µimport('./aide.js')\narrets.push m.ouvrir(µ, salon)"), 'aide.js': RACINE_JS('js') },
    attendu: { js: 1 },
  },
  // bibliothèques `.civet` et `.coffee`, et module `.coffee.mjs` : compilés, relevés comme un composant
  civet: {
    racine: true,
    fichiers: { 'rj.mjs': COMPOSANT(true, "b = await µimport('outil.civet')\narrets.push b.ouvrir(µ, salon)"), 'outil.civet': RACINE_BIBLIOTHEQUE('civet') },
    attendu: { civet: 1 },
  },
  coffee: {
    racine: true,
    fichiers: { 'rj.mjs': COMPOSANT(true, "l = await µimport('lib.coffee')\narrets.push l.ouvrir(µ, salon)"), 'lib.coffee': RACINE_BIBLIOTHEQUE('coffee') },
    attendu: { coffee: 1 },
  },
  coffeemjs: {
    racine: true,
    fichiers: { 'rj.mjs': COMPOSANT(true, "c = await µimport('racine.coffee.mjs')\narrets.push c.ouvrir(salon)"), 'racine.coffee.mjs': 'export ouvrir = (salon) -> µeffect.root -> µeffect -> window.__n.coffeemjs = (window.__n.coffeemjs or 0) + 1; window.__v.coffeemjs = salon.data.v\n' },
    attendu: { coffeemjs: 1 },
  },
  // µ reçu sous un autre nom, reffet sans racine appelé au premier niveau du `<script>` (import statique, mode `js` par défaut) ; aucun
  // composant n'écrit de reffet
  renomme: {
    racine: false,
    fichiers: {
      'rj.mjs': "<script>\n@import suivre './suivi.js'\n$n = 0\nsalon = new µStore(v: 0)\nsuivre(µ, salon)\n@ecrire = (v) -> salon.data.v = v\n</script>\n<p>{$n}</p>\n",
      'suivi.js': 'export const suivre = (m, salon) => m.effect(() => { window.__n.renomme = (window.__n.renomme || 0) + 1; window.__v.renomme = salon.data.v })\n',
    },
    attendu: {},
    scenario: "R.push(['premier passage', window.__n.renomme || 0])\n  if (typeof el('rj').ecrire === 'function') await pas('écriture du magasin', () => el('rj').ecrire(1))\n  R.push(['valeur lue', window.__v.renomme])",
    pas: [['premier passage', 1], ['écriture du magasin', { renomme: 1 }], ['valeur lue', 1]],
    options: { js: undefined },
  },
  // racine prise autrement que par `.effect.root(` ; aucun composant n'écrit de reffet
  ...Object.fromEntries(Object.entries(RACINES_INDIRECTES).map(([k, js]): [string, Appli] => [k, { racine: false, fichiers: { 'rj.mjs': COMPOSANT(false, "m = await µimport('./aide.js')\narrets.push m.ouvrir(µ, salon)"), 'aide.js': js }, attendu: { [k]: 1 } }])),
}

const SCENARIO = `
  await pas('racine du composant', () => el('rj').ouvrirComposant())
  await pas('racines des fichiers', () => el('rj').ouvrirFichiers(), 150)
  await pas('écriture du magasin', () => el('rj').ecrire(1))
  await pas('arrêt puis écriture', () => { el('rj').fermer(); el('rj').ecrire(2) })
  R.push(['erreur', window.__err || ''])
`
const attendu = (a: Appli): unknown[] => [['racine du composant', a.racine ? { c: 1 } : {}], ['racines des fichiers', a.attendu], ['écriture du magasin', a.attendu], ['arrêt puis écriture', {}], ['erreur', '']]

const construits = new Map<string, Promise<Map<string, Buffer>>>()
const construire = (nom: string): Promise<Map<string, Buffer>> => {
  if (!construits.has(nom)) construits.set(nom, (async () => {
    const root   = mjsTmp('reffets-js-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, texte] of Object.entries(APPLIS[nom].fichiers)) writeFileSync(join(srcDir, n), texte)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/' + nom + '/out', env: 'prod', js: 'bundle', minify: true, ...APPLIS[nom].options } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const fichiers = new Map<string, Buffer>()
    for (const f of readdirSync(outDir, { recursive: true }) as string[]) if (f.endsWith('.js')) fichiers.set(f.split('\\').join('/'), readFileSync(join(outDir, f)))
    return fichiers
  })())
  return construits.get(nom)!
}

after(async () => { await terminateSharedWorkerPool() })

describe('µ.effect.root dans un fichier .js copié tel quel (production, chromium)', function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { this.skip(); return }
    browser = await playwright.chromium.launch()
  })
  after(async () => { if (browser) await browser.close() })
  for (const nom of Object.keys(APPLIS)) it(nom + ' : passages comptés pas à pas', async () => {
    const appli    = APPLIS[nom]
    const fichiers = await construire(nom)
    const page     = await browser.newPage()
    const erreurs: string[] = []
    try {
      page.setDefaultTimeout(8000)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text().slice(0, 200)) })
      await page.route('http://localhost/**', async (route: any) => {
        const chemin  = new URL(route.request().url()).pathname
        const prefixe = '/' + nom + '/out/'
        if (chemin.startsWith(prefixe)) { const f = fichiers.get(chemin.slice(prefixe.length)); await route.fulfill(f ? { status: 200, contentType: 'text/javascript', body: f } : { status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-rj></mjs-rj><script>window.__n = {}; window.__v = {}</script><script type="module" src="${prefixe}bundle.js"></script></body></html>` })
      })
      await page.goto('http://localhost/' + nom, { waitUntil: 'load' })
      const vus = await page.evaluate(`(async () => {
        const el  = (n) => document.querySelector('mjs-' + n)
        const t   = () => new Promise((r) => setTimeout(r, 0))
        const fin = Date.now() + 6000
        while ([...document.body.children].some((e) => e.localName.startsWith('mjs-') && !(e._shadow || e).querySelector('p')) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        const R = []
        const pas = async (nom, geste, attente = 0) => {
          for (const k in window.__n) window.__n[k] = 0
          geste()
          await t()
          await t()
          if (attente) await new Promise((r) => setTimeout(r, attente))
          const vu = {}
          for (const k in window.__n) if (window.__n[k] !== 0) vu[k] = window.__n[k]
          R.push([nom, vu])
        }
        ${appli.scenario ?? SCENARIO}
        return R
      })()`)
      assert.deepEqual(vus, appli.pas ?? attendu(appli))
      assert.deepEqual(erreurs, [])
    }
    finally {
      await page.close()
    }
  })
})
