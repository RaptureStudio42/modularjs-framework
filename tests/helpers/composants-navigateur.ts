// compile des composants .mjs et les montre de trois façons : le client seul (build de développement servi fichier par fichier dans un
// navigateur réel), la page que rend le serveur happy-dom, la page que rend le serveur navigateur. La page du serveur est lue
// telle que le navigateur l'analyse (`photo`) : rien ne démarre, c'est le cliché du HTML écrit.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../../src/bundler/index.js'
import { createSSRRenderer } from '../../src/server/renderToString.js'
import { createBrowserRenderer } from '../../src/server/render-browser.js'

export interface Composants {
  // le HTML écrit par chaque serveur, par nom de composant (`mjs-<nom>`)
  serveur: { happy: Record<string, string>, navigateur: Record<string, string> }
  // le composant `nom` monté par le client seul, prêt quand `attente` (sélecteur dans son ombre) existe
  client: (nom: string, attente: string) => Promise<any>
  // une page qui n'est que ce HTML, analysé par le navigateur
  photo: (html: string) => Promise<any>
  fermer: () => Promise<void>
}

// `sources` : nom du composant sans extension → son code ; null quand le navigateur n'est pas installé (le test se saute)
export async function monterComposants(sources: Record<string, string>): Promise<Composants | null> {
  const playwright = await import('playwright')
  if (!existsSync(playwright.chromium.executablePath())) return null
  const root = mjsTmp('composants-navigateur')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  for (const [nom, code] of Object.entries(sources)) writeFileSync(join(src, `${nom}.mjs`), code)
  // client seul : le build de développement, servi fichier par fichier
  const dossier = join(root, 'out')
  const bundler = new Bundler({ sourceDir: src, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', js: 'split', env: 'dev' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(dossier, n)))
  // les deux moteurs de rendu du serveur
  const happy: Record<string, string> = {}
  const rendeurHappy = await createSSRRenderer({ sourceDir: src, outputDir: join(root, 'out-happy') })
  try { for (const nom of Object.keys(sources)) happy[nom] = (await rendeurHappy.renderToString(`mjs-${nom}`, {})).html } finally { await rendeurHappy.close() }
  const navigateurServeur: Record<string, string> = {}
  const rendeurNavigateur = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur' }, { configDir: root })
  try { for (const nom of Object.keys(sources)) navigateurServeur[nom] = (await rendeurNavigateur.renderPage(`mjs-${nom}`, {})).html } finally { await rendeurNavigateur.close() }
  const navigateur = await playwright.chromium.launch()
  return {
    serveur: { happy, navigateur: navigateurServeur },
    async client(nom: string, attente: string) {
      const page = await navigateur.newPage()
      await page.route('http://composants.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (!url.pathname.startsWith('/out/')) {
          await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body><mjs-${nom}></mjs-${nom}><script type="module" src="/out/bundle.js"></script></body>` })
          return
        }
        const corps = fichiers.get(url.pathname.slice(5))
        if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
      })
      await page.goto('http://composants.test/page')
      await page.waitForFunction(`(() => { const e = document.querySelector('mjs-${nom}'); return !!e && !!e._shadow && e._mjs_is_mounted && !!e._shadow.querySelector('${attente}') })()`, null, { timeout: 30000 })
      await page.waitForTimeout(200)
      return page
    },
    async photo(html: string) {
      const page = await navigateur.newPage()
      try {
        await page.setContent(`<body>${html}</body>`)
        return page
      } catch (erreur) {
        await page.close()
        throw erreur
      }
    },
    async fermer() {
      await navigateur.close()
      await terminateSharedWorkerPool()
    }
  }
}

// à placer devant un texte de script lu dans la page : `visiter(racine, fn)` parcourt la page et chaque racine d'ombre
export const VISITER = `const visiter = (racine, fn) => {
  fn(racine)
  for (const el of racine.querySelectorAll('*')) {
    const ombre = el.shadowRoot || el._shadow
    if (ombre && ombre !== el) visiter(ombre, fn)
  }
}`
