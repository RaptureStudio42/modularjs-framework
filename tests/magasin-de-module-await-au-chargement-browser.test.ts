// un `await` au premier niveau d'un fichier de module ou d'un <script module> n'est pas une valeur qui attend : la ligne tourne une
// fois, au chargement du module, et le magasin reçoit la réponse (`$$liste = await f(1)`, `export µ$$feed = await g(1)`,
// `export µ$$feed = new µStore(liste: await f(1))`). La construction l'accepte et la page l'affiche, en production comme dans un vrai
// `mjs dev` (sortie en modules ES, servie sur 127.0.0.1), dans chaque moteur ; dans le <script> d'un composant, la même ligne serait
// une valeur qui attend, refusée (derivee-await-dans-un-magasin-refusee.test.ts)

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cliPath  = join(repoRoot, 'src', 'cli.ts')
const F        = 'f = (q) -> Promise.resolve([q, q + 1])\ng = (q) -> Promise.resolve({ n: q + 1 })\n'
const VUE      = (lu: string) => `<script>\n  @import µ$$feed 'mag.module.civet.mjs'\n</script>\n<i class="l">{${lu}}</i>\n`

// la scène : ses sources, la balise affichée, le texte attendu
const SCENES: Record<string, [Record<string, string>, string, string]> = {
  'fichier de module, $$liste = await f(1)': [{ 'mag.module.civet.mjs': `${F}$$liste = await f(1)\nexport µ$$feed = new µStore(n: 1)\n`, 'vue.mjs': VUE('JSON.stringify($$liste)') }, 'mjs-vue', '[1,2]'],
  'fichier de module, export µ$$feed = await g(1)': [{ 'mag.module.civet.mjs': `${F}export µ$$feed = await g(1)\n`, 'vue.mjs': VUE('µ$$feed.n') }, 'mjs-vue', '2'],
  'fichier de module, new µStore(liste: await f(1))': [{ 'mag.module.civet.mjs': `${F}export µ$$feed = new µStore(liste: await f(1))\n`, 'vue.mjs': VUE('JSON.stringify(µ$$feed.data.liste)') }, 'mjs-vue', '[1,2]'],
  '<script module>, $$liste = await f(1)': [{ 'sm.mjs': `<script module>\n  ${F.replace(/\n(?=.)/g, '\n  ')}  $$liste = await f(1)\n</script>\n<script>\n  $x = 1\n</script>\n<i class="l">{JSON.stringify($$liste)}</i>\n` }, 'mjs-sm', '[1,2]'],
}

const lire = (b: string) => `(() => { const e = document.querySelector('${b}'); const r = e && (e._shadow || e.shadowRoot || e); const x = r && r.querySelector('.l'); return x ? x.textContent : '(absent)' })()`

type Dev = { port: number, sortie: () => string, arreter: () => Promise<void> }

// un vrai `mjs dev` sur 127.0.0.1, la page `/` rendue côté client : rendu dès son premier build écrit (ou au bout de 40 s)
function lancerDev(sources: Record<string, string>, balise: string): Promise<Dev> {
  const root = mjsTmp('magasin-module-await-dev')
  mkdirSync(join(root, 'src'), { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(root, 'src', nom), source)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/manifest.js', render: { default: 'csr', routes: { '/': { component: balise, mode: 'csr' } } } }))
  const port = 22000 + Math.floor(Math.random() * 8000)
  // la CLI lue par Node avec le chargeur TypeScript du projet
  const proc = spawn(process.execPath, ['--import', 'tsx', cliPath, 'dev', '--root', root, '--port', String(port)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  let sortie = ''
  proc.stdout!.on('data', (d) => { sortie += String(d) })
  proc.stderr!.on('data', (d) => { sortie += String(d) })
  const arreter = () => new Promise<void>((done) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return done()
    proc.once('close', () => done())
    proc.kill('SIGINT')
    setTimeout(() => proc.kill('SIGKILL'), 5000)
  })
  return new Promise((resolve) => {
    const debut = Date.now()
    const tour  = setInterval(() => {
      if (/✅|❌/.test(sortie) || Date.now() - debut > 40000 || proc.exitCode !== null) {
        clearInterval(tour)
        setTimeout(() => resolve({ port, sortie: () => sortie, arreter }), 500)
      }
    }, 200)
  })
}

describe('magasin écrit par un await au premier niveau d\'un module : une fois, au chargement (navigateur réel)', function () {
  this.timeout(240000)
  const navigateurs: Record<string, any> = {}

  before(async () => {
    const playwright: any = await import('playwright')
    for (const moteur of ['chromium', 'firefox', 'webkit']) {
      if (existsSync(playwright[moteur].executablePath())) navigateurs[moteur] = await playwright[moteur].launch()
    }
    assert.ok(Object.keys(navigateurs).length > 0, 'aucun moteur de Playwright installé')
  })

  after(async () => {
    for (const b of Object.values(navigateurs)) await b.close()
    await terminateSharedWorkerPool()
  })

  for (const [quoi, [sources, balise, attendu]] of Object.entries(SCENES)) {
    it(`${quoi} : construit et affiché « ${attendu} » en production`, async () => {
      const cible = await construire('bundle', sources, [balise])
      for (const [moteur, b] of Object.entries(navigateurs)) {
        const o = await charger(b, cible, balise)
        try {
          await o.page.waitForFunction(`${lire(balise)} === ${JSON.stringify(attendu)}`, null, { timeout: 5000 }).catch(() => {})
          assert.equal(await o.page.evaluate(lire(balise)), attendu, `${moteur} : ${graves(o).join(' | ')}`)
          assert.deepEqual(graves(o), [], moteur)
        }
        finally {
          await o.fermer()
        }
      }
    })

    it(`${quoi} : construit et affiché « ${attendu} » par mjs dev`, async () => {
      const dev = await lancerDev(sources, balise)
      try {
        assert.doesNotMatch(dev.sortie(), /❌|magasin ne garde pas/, dev.sortie())
        for (const [moteur, b] of Object.entries(navigateurs)) {
          const page    = await b.newPage()
          const erreurs = [] as string[]
          page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
          try {
            await page.goto(`http://127.0.0.1:${dev.port}/`)
            await page.waitForFunction(`${lire(balise)} === ${JSON.stringify(attendu)}`, null, { timeout: 10000 }).catch(() => {})
            assert.equal(await page.evaluate(lire(balise)), attendu, `${moteur} : ${erreurs.join(' | ')}\n--- mjs dev ---\n${dev.sortie()}`)
            assert.deepEqual(erreurs, [], moteur)
          }
          finally {
            await page.close()
          }
        }
      }
      finally {
        await dev.arreter()
      }
    })
  }
})
