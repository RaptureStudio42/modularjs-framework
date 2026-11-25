// une ligne de `{for}` qui porte désormais un autre élément reçoit toutes ses props, même inchangées, comme une ligne neuve : la ligne d'une
// liste de valeurs simples sans `by` qui montre une autre valeur, composants d'un `{for}` imbriqué compris, et la ligne d'une liste `by id`
// rechargée (un autre objet à la même clé). Défauts garantis absents : le volet fermé par l'élément d'avant restait fermé sur la ligne
// qui montrait désormais un autre élément (composant d'un `{for}` imbriqué), ou sur la ligne rechargée.
// Restent : la ligne qu'un tri déplace, ou dont l'objet change sur place, garde ce que son composant a écrit lui-même.
// Chromium réel, développement

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'autre-element-page.mjs': `<script>
  $nums = ['a', 'b']
  $cols = [{ id: 1 }]
  $rows = [{ id: 1, on: false }, { id: 2, on: false }]
  $o    = true
</script>

<ul class="valeurs">{for v in $nums}<li>{for c in $cols}<@volet ouvert={$o}></@volet>{end}</li>{end}</ul>
<ul class="cle">{for r in $rows by id}<li><@volet ouvert={$o}></@volet>{if r.on}<b>!</b>{end}</li>{end}</ul>
<button class="tete" @click={$nums = ['z'].concat($nums)}>h</button>
<button class="recharger" @click={$rows = [{ id: 1, on: false }, { id: 2, on: false }]}>r</button>
<button class="trier" @click={$rows = $rows.slice().reverse()}>t</button>
<button class="sur-place" @click={$rows[1].on = !$rows[1].on}>p</button>
`,
  'volet.mjs': `<script>
  $ouvert ?= false
</script>

<p class="v">{$ouvert ? 'oui' : 'non'}</p><button class="f" @click={$ouvert = false}>f</button>
`
}

async function construire(): Promise<string> {
  const root   = mjsTmp('prop-liee-autre-element')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
}

describe('prop liée : la ligne qui porte un autre élément reçoit toutes ses props (chromium réel)', function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []

  beforeEach(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté')
      this.skip()
      return
    }
    const script = await construire()
    browser = await playwright.chromium.launch()
    page    = await browser.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-autre-element-page></mjs-autre-element-page><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => (document.querySelector('mjs-autre-element-page') as any)?._shadow?.querySelectorAll('mjs-volet').length === 4 && [...(document.querySelector('mjs-autre-element-page') as any)._shadow.querySelectorAll('mjs-volet')].every((v: any) => v._shadow?.querySelector('p.v')))
    await page.evaluate(`window.__h = () => document.querySelector('mjs-autre-element-page')._shadow`)
  })

  afterEach(async function () {
    if (browser) await browser.close()
    browser = null
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  const lus    = (l: string): Promise<string> => page.evaluate(`[...__h().querySelectorAll('ul.${l} mjs-volet')].map((x) => x._shadow.querySelector('p.v').textContent).join(',')`)
  const fermer = async (l: string, i: number) => {
    await page.evaluate(`__h().querySelectorAll('ul.${l} mjs-volet')[${i}]._shadow.querySelector('button.f').click()`)
    await page.waitForTimeout(80)
  }
  const clic   = async (sel: string) => {
    await page.evaluate(`__h().querySelector('${sel}').click()`)
    await page.waitForTimeout(80)
  }

  it('liste de valeurs simples sans `by`, insertion en tête : le composant d\'un {for} imbriqué de la ligne qui montre une autre valeur reprend la valeur du parent', async function () {
    await fermer('valeurs', 0)
    assert.equal(await lus('valeurs'), 'non,oui')
    await clic('button.tete')
    assert.equal(await lus('valeurs'), 'oui,oui,oui', 'aucune ligne ne garde le volet fermé par l\'élément d\'avant (avant : « non,oui,oui »)')
  })

  it('liste `by id` rechargée (autres objets, mêmes clés) : chaque ligne reprend la valeur du parent, comme une ligne neuve', async function () {
    await fermer('cle', 0)
    await clic('button.recharger')
    assert.equal(await lus('cle'), 'oui,oui', 'la ligne rechargée ne garde pas le volet fermé (avant : « non,oui »)')
  })

  it('liste `by id` triée, ou dont l\'objet change sur place : le composant garde ce qu\'il a écrit lui-même', async function () {
    await fermer('cle', 0)
    await clic('button.trier')
    assert.equal(await lus('cle'), 'oui,non', 'le volet fermé suit sa ligne')
    await clic('button.sur-place')
    assert.equal(await lus('cle'), 'oui,non', 'la ligne redessinée garde le volet fermé')
  })
})
