// une transition à `tick` (`µanim.create`) sur une balise de bloc : hors de ses images, `tick` n'est appelé que là où la balise ne porte pas
// déjà l'image voulue. Entrée neuve : un appel, à la position 0, dans la tâche même du geste (la balise n'a jamais son état normal avant sa
// première image) ; sortie neuve : aucun (l'état normal est la position 1) ; balise remise en pleine sortie, par la même transition :
// aucun (sa dernière image est sur la balise) ; balise retirée une microtâche après une entrée neuve : aucun de plus que celui de l'entrée
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { charger, graves } from './helpers/liaison-navigateur.js'

const SOURCE = `<script>
  $v    = false
  @voir = (v) -> $v = v
  unless window.__tkPret
    window.__tkPret   = true
    window.__tkAppels = []
    µanim.create 'tkfondu', (node) ->
      duration: 200
      easing: 'linear'
      tick: (t) ->
        window.__tkAppels.push(Math.round(t * 1000) / 1000)
        node.style.opacity = String(t)
</script>
{if $v}<p class="p" :transition=*tkfondu>x</p>{end}
<p class="pret">prêt</p>
`

// joué dans la page : les appels de `tick` relevés dans la tâche même de chaque geste, avant toute image
async function jouer(): Promise<any> {
  const pause  = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const micro  = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
  const el     = document.querySelector('mjs-tk-bloc') as any
  const appels = (window as any).__tkAppels as number[]
  const r: any = {}
  el.voir(true)
  await micro()
  r.entree = appels.slice()
  await pause(500)
  appels.length = 0
  el.voir(false)
  await micro()
  r.sortie = appels.slice()
  await pause(100)
  const n = appels.length
  el.voir(true)
  await micro()
  r.images  = n > 0
  r.reprise = appels.length - n
  await pause(500)
  el.voir(false)
  await pause(500)
  appels.length = 0
  el.voir(true)
  await Promise.resolve()
  el.voir(false)
  await micro()
  r.aussitot = appels.slice()
  await pause(500)
  r.reste = el._shadow.querySelectorAll('p.p').length
  return r
}

let bati: Promise<{ racine: string, page: string }> | null = null
async function construire(): Promise<{ racine: string, page: string }> {
  const root   = mjsTmp('tk-appels')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tk-bloc.mjs'), SOURCE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const script = files.sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  return { racine: root, page: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-tk-bloc></mjs-tk-bloc><script>${script}</script></body></html>` }
}

for (const nav of ['chromium', 'firefox', 'webkit']) describe(`transition à tick sur une balise de bloc : appels de tick hors de ses images (${nav})`, function () {
  this.timeout(120000)
  let browser: any = null
  let present      = false
  before(async function () {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) return
    browser = await playwright[nav].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })
  it('un appel à 0 pour une entrée neuve, aucun pour une sortie neuve, pour une reprise par la même transition ni pour un retrait aussitôt après l\'entrée', async function () {
    if (!present) { this.skip(); return }
    if (!bati) bati = construire()
    const b = await bati
    const o = await charger(browser, { mode: 'dev-parents-avant' as any, racine: b.racine, document: () => b.page }, 'mjs-tk-bloc')
    try {
      await o.page.waitForFunction(`!!(document.querySelector('mjs-tk-bloc')._shadow && document.querySelector('mjs-tk-bloc')._shadow.querySelector('.pret'))`, null, { timeout: 30000 })
      await o.page.waitForTimeout(200)
      const r = await o.page.evaluate(jouer)
      assert.deepEqual(r, { entree: [0], sortie: [], images: true, reprise: 0, aussitot: [0], reste: 0 })
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })
})
