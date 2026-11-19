// `####…` est un commentaire d'une ligne dans un module CoffeeScript ou Civet, dans Chromium et dans Firefox (modules en mode
// strict) : le code qui suit s'exécute ; un vrai bloc `###…###` reste un bloc. Un composant importe chaque module et affiche ce
// qu'il rend

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

// commentaire posé avant le code : ligne de titre, ligne de dièses, fin de ligne, six dièses, vrai bloc
const FORMES: Record<string, string> = {
  titre:    '#### Section\n',
  ligne:    '##########\n',
  finligne: 'x = 1 #### fin\n',
  six:      '######\n',
  bloc:     "###\n  L'etat du panier\n###\n"
}

// fichier → code (un composant par forme et par langage, et le module qu'il importe) ; composant → texte attendu
const FICHIERS: Record<string, string> = {}
const ATTENDUS: Record<string, string> = {}
for (const [forme, commentaire] of Object.entries(FORMES)) {
  FICHIERS[`zq${forme}.coffee.mjs`]      = `${commentaire}µ$zq${forme} = { n: 2 }\nexport lire = -> µ$zq${forme}.n\n`
  FICHIERS[`zv${forme}.civet.mjs`]       = `${commentaire}export lire = -> 'vu'\n`
  FICHIERS[`dieses-coffee-${forme}.mjs`] = `@import { lire } 'zq${forme}.coffee.mjs'\n<script>\n$n = lire()\n</script>\n<p>{$n}</p>\n`
  FICHIERS[`dieses-civet-${forme}.mjs`]  = `@import { lire } 'zv${forme}.civet.mjs'\n<script>\n$n = lire()\n</script>\n<p>{$n}</p>\n`
  ATTENDUS[`dieses-coffee-${forme}`]     = '2'
  ATTENDUS[`dieses-civet-${forme}`]      = 'vu'
}

// le build de développement de tous les fichiers, servi fichier par fichier
async function construire(): Promise<Map<string, Buffer>> {
  const root = mjsTmp('dieses-navigateur')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [f, code] of Object.entries(FICHIERS)) writeFileSync(join(src, f), code)
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', js: 'split', env: 'dev' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.map((e: any) => e.message).join('\n'), '', 'construction')
  const fichiers = new Map<string, Buffer>()
  for (const n of readdirSync(out)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(out, n)))
  return fichiers
}

for (const moteur of ['chromium', 'firefox'] as const) {
  describe(`commentaires de quatre dièses ou plus dans un module : une ligne, pas un bloc (${moteur} réel)`, function () {
    this.timeout(280000)
    let navigateur: any = null
    let fichiers = new Map<string, Buffer>()

    before(async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      fichiers   = await construire()
      navigateur = await playwright[moteur].launch()
    })

    after(async () => {
      if (navigateur) await navigateur.close()
      await terminateSharedWorkerPool()
    })

    for (const [nom, attendu] of Object.entries(ATTENDUS)) {
      it(`${nom} : le client affiche « ${attendu} »`, async function () {
        const page    = await navigateur.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message || e)))
        try {
          await page.route('http://composants.test/**', async (route: any) => {
            const url = new URL(route.request().url())
            if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body><mjs-${nom}></mjs-${nom}><script type="module" src="/out/bundle.js"></script></body>` }); return }
            const corps = fichiers.get(url.pathname.slice(5))
            if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
            await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
          })
          await page.goto('http://composants.test/page')
          try { await page.waitForFunction(`(() => { const e = document.querySelector('mjs-${nom}'); return !!e && !!e._shadow && e._mjs_is_mounted && !!e._shadow.querySelector('p') })()`, null, { timeout: 6000 }) } catch { /* rendu absent : lu plus bas */ }
          const vu = await page.evaluate(`(() => { const e = document.querySelector('mjs-${nom}'); return e && e._shadow && e._shadow.querySelector('p') ? e._shadow.querySelector('p').textContent : '(rien)' })()`)
          assert.equal(vu, attendu, erreurs.join(' | '))
        }
        finally { await page.close() }
      })
    }
  })
}
