// Page servie en flux, vue d'un vrai navigateur (Chromium, Firefox, WebKit) : la coquille est lue avant la fin du chargeur de
// données, la page finale est adoptée par la reprise `ssr:markers` sans nœud recréé et répond au clic, comme la même page servie
// d'un bloc ; une erreur de rendu une fois la coquille partie donne la page d'erreur d'un bloc, bundle lancé compris.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'
import { startRenderServer, type RunningServer } from '../src/server/render-server.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const COMPTEUR = `<script>
$n = 0
</script>
<button class="b" @click={$n = $n + 1}>n={$n}</button>
<p class="t">{$titre}</p>
`

const CHARGEUR = `export default {
  props: {
    '/flux-m': (params, req) -> new Promise((r) -> setTimeout(r, 700)).then(-> { titre: 'Charge' }),
    '/bloc-m': (params, req) -> new Promise((r) -> setTimeout(r, 700)).then(-> { titre: 'Charge' })
  }
}
`

let serveur: RunningServer | null = null
let base = ''

after(async () => {
  if (serveur) await serveur.close()
  await terminateSharedWorkerPool()
  sweepRegistered()
})

// charge la page bundle retenu, note si la coquille a été lue seule, marque le bouton venu du serveur, libère le bundle, attend la
// reprise puis clique
async function adopter(page: any, chemin: string): Promise<{ coquilleSeule: boolean, marque: boolean, avant: string, apres: string }> {
  let liberer: () => void = () => {}
  const retenu = new Promise<void>((r) => { liberer = r })
  await page.unrouteAll()
  await page.route('**/__mjs/bundle.js', async (route: any) => { await retenu; await route.continue() })
  await page.goto(base + chemin, { waitUntil: 'commit' })
  // coquille lue seule : la feuille du `<head>` déjà là, aucun `<mjs-compteur>` encore (relevé toutes les 20 ms, 3 s au plus)
  let coquilleSeule = false
  for (let i = 0; i < 150 && !coquilleSeule; i++) {
    const etat = await page.evaluate(() => document.querySelector('mjs-compteur') !== null ? 'corps' : document.querySelector('style[data-mjs-ssr-head]') !== null ? 'coquille' : 'rien').catch(() => 'rien')
    if (etat === 'corps') break
    coquilleSeule = etat === 'coquille'
    if (!coquilleSeule) await new Promise((r) => setTimeout(r, 20))
  }
  await page.waitForFunction(() => !!document.querySelector('mjs-compteur')?.shadowRoot?.querySelector('button.b'), null, { timeout: 15000 })
  await page.evaluate(() => { (document.querySelector('mjs-compteur')!.shadowRoot!.querySelector('button.b') as any).__serveur = true })
  liberer()
  await page.waitForFunction(() => !!customElements.get('mjs-compteur') && !!(window as any).µ, null, { timeout: 15000 })
  await page.waitForLoadState('load')
  const avant = await page.evaluate(() => document.querySelector('mjs-compteur')!.shadowRoot!.querySelector('button.b')!.textContent + '|' + document.querySelector('mjs-compteur')!.shadowRoot!.querySelector('p.t')!.textContent)
  await page.evaluate(() => (document.querySelector('mjs-compteur')!.shadowRoot!.querySelector('button.b') as HTMLElement).click())
  await page.waitForFunction(() => document.querySelector('mjs-compteur')!.shadowRoot!.querySelector('button.b')!.textContent === 'n=1', null, { timeout: 15000 })
  const marque = await page.evaluate(() => (document.querySelector('mjs-compteur')!.shadowRoot!.querySelector('button.b') as any).__serveur === true)
  const apres  = await page.evaluate(() => document.querySelector('mjs-compteur')!.shadowRoot!.innerHTML.replace(/<!--[^>]*-->/g, ''))
  return { coquilleSeule, marque, avant, apres }
}

describe('serve-page-en-flux-browser', function () {
  before(async function () {
    this.timeout(120000)
    const root = mjsTmp('page-en-flux-nav')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'compteur.mjs'), COMPTEUR)
    writeFileSync(join(root, 'serve.server.mjs'), CHARGEUR)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
      sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out',
      render: {
        routes: {
          '/flux-m': { component: 'mjs-compteur', mode: 'ssr:markers', stream: true },
          '/bloc-m': { component: 'mjs-compteur', mode: 'ssr:markers' },
          '/casse':  { component: 'mjs-absent', mode: 'ssr', stream: true },
        },
      },
    }, null, 2))
    const found   = findConfig(root)!
    const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'dev' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    serveur = await startRenderServer(found.config, found.configDir, { port: 0 })
    base    = `http://127.0.0.1:${serveur.port}`
  })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(`page servie en flux — reprise côté client (${nom} réel)`, function () {
      this.timeout(120000)
      let present = false

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) this.skip()
      })

      it('ssr:markers en flux : coquille lue avant la fin du chargeur, page adoptée sans nœud recréé, interactive, comme d\'un bloc', async () => {
        const browser = await (await import('playwright'))[nom].launch()
        try {
          const page = await browser.newPage()
          const bloc = await adopter(page, '/bloc-m')
          const flux = await adopter(page, '/flux-m')
          assert.equal(bloc.avant, 'n=0|Charge')
          assert.equal(flux.avant, 'n=0|Charge')
          assert.ok(bloc.marque, 'contrôle : la reprise d\'un bloc adopte le bouton du serveur')
          assert.ok(flux.marque, 'la reprise de la page en flux adopte le bouton du serveur, sans le recréer')
          assert.equal(flux.apres, bloc.apres, 'même vue après la reprise et le clic')
          assert.ok(flux.coquilleSeule, 'le navigateur lit la coquille avant le corps, pendant que le chargeur attend encore')
        } finally {
          await browser.close()
        }
      })

      it('erreur de rendu une fois la coquille partie : la page d\'erreur s\'affiche et le bundle démarre, comme d\'un bloc', async () => {
        const browser = await (await import('playwright'))[nom].launch()
        try {
          const page = await browser.newPage()
          await page.goto(base + '/casse', { waitUntil: 'load' }).catch(() => null)
          await page.waitForFunction(() => !!(window as any).µ, null, { timeout: 15000 })
          const html = await page.evaluate(() => document.body.innerHTML)
          assert.match(html, /échec du rendu de mjs-absent/)
          assert.match(html, /<script type="module" src="\/__mjs\/bundle\.js"><\/script>/)
        } finally {
          await browser.close()
        }
      })
    })
  }
})
