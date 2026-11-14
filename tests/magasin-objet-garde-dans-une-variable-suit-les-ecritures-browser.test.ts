// Un objet du magasin `$$` gardé dans une variable d'un composant (`@click={$sel = $$m[0]}`) suit les écritures de ses champs
// (`$$m[0].nom = v`), comme l'enfant qui tient le même objet par une prop : la variable est prévenue, son écran change. Écritures jouées :
// par le composant lui-même, par un autre composant, par une fonction du fichier qui déclare le magasin ; puis le même objet repris dans la variable reste un écho
// (rien ne change, aucune erreur). Avec l'enveloppe (le défaut) et sans elle (`proxy: false`), en développement et en production,
// en navigateur réel (trois moteurs)
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const ECRAN = '<p class="vu">{$sel?.nom}</p>\n'
const SOURCES: Record<string, string> = {
  'mt-soi.mjs':    "<script>\n  $$mt1 = [{ nom: 'a' }]\n  $sel = null\n</script>\n\n" + ECRAN + "<button class=\"s\" type=\"button\" @click={$sel = $$mt1[0]}>s</button>\n<button class=\"p\" type=\"button\" @click={$$mt1[0].nom = 'Z'}>p</button>\n",
  'mt-autre.mjs':  "<script>\n  $$mt2 = [{ nom: 'a' }]\n  $sel = null\n</script>\n\n" + ECRAN + "<button class=\"s\" type=\"button\" @click={$sel = $$mt2[0]}>s</button>\n<@c-mt-editeur>\n",
  'c-mt-editeur.mjs': "<script>\n  agir = -> $$mt2[0].nom = 'Z'\n</script>\n\n<button class=\"p\" type=\"button\" @click={agir()}>p</button>\n",
  'mt-magasin.module.civet.mjs': "$$mt3 = [{ nom: 'a' }]\nexport renommer = (v) -> $$mt3[0].nom = v\n",
  'mt-magasin.mjs': "@import renommer 'mt-magasin.module.civet.mjs'\n\n<script>\n  $sel = null\n</script>\n\n" + ECRAN + "<button class=\"s\" type=\"button\" @click={$sel = $$mt3[0]}>s</button>\n<button class=\"p\" type=\"button\" @click={renommer('Z')}>p</button>\n",
}
const BALISES = ['mjs-mt-soi', 'mjs-mt-autre', 'mjs-mt-magasin']

// une construction : production en un seul fichier, ou développement (tout le JavaScript dans la page, le cœur d'abord)
async function construire(nom: string, opts: Record<string, unknown>, dev: boolean): Promise<Cible> {
  const root   = mjsTmp('magasin-variable-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(dev ? root : outDir, 'bundle.js'), ...(dev ? {} : { env: 'prod', js: 'bundle', urlPrefix: '/out' }), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const page = (balise: string, corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><${balise}></${balise}>${corps}</body></html>`
  if (!dev) return { mode: 'bundle', racine: root, document: (balise) => page(balise, '<script type="module" src="/out/bundle.js"></script>') }
  const rang   = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  const script = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  return { mode: 'dev-parents-avant', racine: root, document: (balise) => page(balise, `<script>${script}</script>`) }
}

const VARIANTES: Array<[string, Record<string, unknown>, boolean]> = [
  ['enveloppe, développement', {}, true],
  ['enveloppe, production', {}, false],
  ['proxy: false, développement', { proxy: false }, true],
  ['proxy: false, production', { proxy: false }, false],
]
const cibles = new Map<string, Promise<Cible>>()
const cible  = (nom: string, opts: Record<string, unknown>, dev: boolean) => {
  if (!cibles.has(nom)) cibles.set(nom, construire(nom.replace(/[^a-z]+/g, '-'), opts, dev))
  return cibles.get(nom) as Promise<Cible>
}

const VU    = (balise: string) => `document.querySelector('${balise}')?._shadow?.querySelector('.vu')?.textContent ?? '?'`
// le bouton `p` de l'autre composant pour la scène `mt-autre`, sinon celui du composant
const CLIC  = (balise: string, quoi: string) => quoi === 'p' && balise === 'mjs-mt-autre'
  ? `document.querySelector('${balise}')._shadow.querySelector('mjs-c-mt-editeur')._shadow.querySelector('.p').click()`
  : `document.querySelector('${balise}')._shadow.querySelector('.${quoi}').click()`

const NAVIGATEURS = (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>

for (const nav of NAVIGATEURS) describe(`magasin : l'objet gardé dans une variable suit les écritures de ses champs (${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const [nom, opts, dev] of VARIANTES) for (const balise of BALISES) it(`${balise.slice(7)} (${nom}) : la variable montre le champ écrit`, async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(nom, opts, dev), balise)
    try {
      await o.page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('.s')`, null, { timeout: 10000 })
      const vus = [await o.page.evaluate(VU(balise))]
      for (const quoi of ['s', 'p', 's']) {
        await o.page.evaluate(CLIC(balise, quoi))
        await o.page.waitForTimeout(120)
        vus.push(await o.page.evaluate(VU(balise)))
      }
      assert.deepEqual(vus, ['', 'a', 'Z', 'Z'], 'la variable : vide, prise, champ écrit, reprise')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
})
