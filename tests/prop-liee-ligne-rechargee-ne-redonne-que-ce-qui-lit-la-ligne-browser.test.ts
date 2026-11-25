// une ligne de liste à clé (`by`) rechargée — un autre objet à la même clé — ne redonne à ses composants, même à valeur égale, que les
// props qui lisent l'élément de la ligne : sa variable (`ouvert={r.open}`) ou un `{const}` qui la lit (`{const k = r.open}`, même écrit
// après le composant), dans la ligne comme dans un `{if}` qu'elle porte. Les autres restent ce que le composant a écrit lui-même tant que leur valeur ne change pas
// chez le parent : l'état du parent (`ouvert={$o}`), l'index seul (`ouvert={i === 0}`, redonné quand un tri change sa valeur). Boucles
// imbriquées : seule la ligne dont la prop lit l'élément la redonne. Une liste écrite dans le gabarit (`{for v in [ { key: $version } ] by
// key}`), rechargée à chaque rendu qui la rejoue, laisse au champ `<@@number value={$n}>` la frappe, qu'il annonce (`aria-valuenow`).
// La première recharge d'une ligne neuve se comporte comme la suivante. Défaut garanti absent : toute ligne à clé rechargée redonnait
// toutes ses props, le volet fermé par son composant se rouvrait et le champ annonçait la valeur du parent au lieu de la frappe.
// Chromium réel, développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'recharge-page.mjs': `<script>
  $rows    = [{ id: 1, open: true }, { id: 2, open: true }]
  $cols    = [{ id: 1, on: true }]
  $o       = true
  $n       = 4
  $version = 1
  $autre   = 0
</script>

<ul class="a">{for i, r in $rows by id}<li>{const k = r.open}<@volet class="o" ouvert={$o}></@volet><@volet class="r" ouvert={r.open}></@volet><@volet class="k" ouvert={k}></@volet><@volet class="i" ouvert={i === 0}></@volet></li>{end}</ul>
<ul class="b">{for r in $rows by id}<li>{if r.id > 0}<@volet class="o" ouvert={$o}></@volet><@volet class="r" ouvert={r.open}></@volet>{end}</li>{end}</ul>
<ul class="c">{for r in $rows by id}<li>{for c in $cols by id}<@trio a={r.open} b={c.on} d={$o}></@trio>{end}</li>{end}</ul>
<ul class="h">{for r in $rows by id}<li><@volet class="h" ouvert={k2}></@volet>{const k2 = r.open}</li>{end}</ul>
<div class="d">{for v in [ { key: $version } ] by key}<span class="vu">{$autre}</span><@volet class="o" ouvert={$o}></@volet><@@number value={$n}></@@number>{end}</div>
<button class="recharger" @click={$rows = $rows.map((r) => ({ ...r }))}>r</button>
<button class="trier" @click={$rows = $rows.slice().reverse()}>t</button>
<button class="colonnes" @click={$cols = $cols.map((c) => ({ ...c }))}>c</button>
<button class="ajouter" @click={$rows = $rows.concat([{ id: 3, open: true }])}>a</button>
<button class="autre" @click={$autre++}>x</button>
`,
  'volet.mjs': `<script>
  $ouvert ?= false
</script>

<p class="v">{$ouvert ? 'oui' : 'non'}</p><button class="f" @click={$ouvert = false}>f</button>
`,
  'trio.mjs': `<script>
  $a ?= false
  $b ?= false
  $d ?= false

  @fermer = ->
    $a = false
    $b = false
    $d = false
</script>

<p class="v">{($a ? 'A' : 'a') + ($b ? 'B' : 'b') + ($d ? 'D' : 'd')}</p><button class="f" @click={@fermer()}>f</button>
`
}

const construits: Record<string, Promise<string>> = {}

// développement : les fichiers du build, cœur d'abord ; production : le paquet unique, minifié, noms raccourcis (`µ` n'y est plus un nom global)
function construire(env: 'dev' | 'prod'): Promise<string> {
  construits[env] ??= (async () => {
    const root   = mjsTmp('prop-liee-ligne-rechargee-' + env)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const prod      = env === 'prod'
    const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js') }
    if (prod) Object.assign(opts, { env: 'prod', js: 'bundle' })
    const bundler = new Bundler(opts)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  })()
  return construits[env]
}

for (const env of ['dev', 'prod'] as const) {
  describe(`prop liée : la ligne à clé rechargée ne redonne que ce qui lit la ligne (chromium réel, ${env})`, function () {
    this.timeout(200000)
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
      const script = await construire(env)
      browser = await playwright.chromium.launch()
      page    = await browser.newPage()
      page.setDefaultTimeout(8000)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-recharge-page></mjs-recharge-page><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.evaluate(`window.__o = (x) => x._shadow || x.shadowRoot || x; window.__h = () => __o(document.querySelector('mjs-recharge-page')); window.__champ = () => __o(__h().querySelector('div.d mjs-core-number')).querySelector('input')`)
      await page.waitForFunction(() => {
        const w = window as any
        const h = w.__h()
        const kids = [...h.querySelectorAll('mjs-volet, mjs-trio')]
        return kids.length === 17 && kids.every((x: any) => w.__o(x).querySelector('p.v')) && !!h.querySelector('div.d mjs-core-number') && !!w.__champ()
      })
    })

    afterEach(async function () {
      if (browser) await browser.close()
      browser = null
      if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
    })

    after(async () => {
      await terminateSharedWorkerPool()
    })

    // ce que montrent les composants désignés, dans l'ordre de la page
    const lus    = (sel: string): Promise<string> => page.evaluate(`[...__h().querySelectorAll('${sel}')].map((x) => __o(x).querySelector('p.v').textContent).join(',')`)
    // chaque composant désigné écrit lui-même ses props (volet fermé, trio fermé)
    const fermer = async (sel: string) => {
      await page.evaluate(`__h().querySelectorAll('${sel}').forEach((x) => __o(x).querySelector('button.f').click())`)
      await page.waitForTimeout(80)
    }
    const clic   = async (sel: string) => {
      await page.evaluate(`__h().querySelector('${sel}').click()`)
      await page.waitForTimeout(80)
    }
    // ce que montre et annonce le champ : son texte, aria-valuenow
    const champ  = (): Promise<string> => page.evaluate(`(() => { const c = __champ(); return c.value + ' | ' + c.getAttribute('aria-valuenow') })()`)

    it('a. liste `by id` rechargée : ouvert={$o} et ouvert={i === 0} gardés, ouvert={r.open} et ouvert={k} redonnés à valeur égale ; un tri redonne ouvert={i === 0} quand sa valeur change', async function () {
      await fermer('ul.a mjs-volet')
      assert.equal(await lus('ul.a mjs-volet'), 'non,non,non,non,non,non,non,non')
      await clic('button.recharger')
      assert.equal(await lus('ul.a mjs-volet.o'), 'non,non', 'ouvert={$o} ne lit pas la ligne : le volet fermé le reste (avant : « oui,oui »)')
      assert.equal(await lus('ul.a mjs-volet.r'), 'oui,oui', 'ouvert={r.open} lit la ligne : redonné')
      assert.equal(await lus('ul.a mjs-volet.k'), 'oui,oui', 'ouvert={k}, {const k = r.open} : redonné')
      assert.equal(await lus('ul.a mjs-volet.i'), 'non,non', 'l\'index seul n\'est pas une lecture de la ligne (avant : « oui,non »)')
      await clic('button.trier')
      assert.equal(await lus('ul.a mjs-volet.i'), 'oui,non', 'le tri change i === 0 : redonné')
      assert.equal(await lus('ul.a mjs-volet.o'), 'non,non', 'le tri garde ouvert={$o}')
    })

    if (env === 'dev') it('b. composant dans un {if} de la ligne : même règle', async function () {
      await fermer('ul.b mjs-volet')
      await clic('button.recharger')
      assert.equal(await lus('ul.b mjs-volet.o'), 'non,non', 'ouvert={$o} gardé (avant : « oui,oui »)')
      assert.equal(await lus('ul.b mjs-volet.r'), 'oui,oui', 'ouvert={r.open} redonné')
    })

    if (env === 'dev') it('c. boucles imbriquées : la prop est redonnée par la seule ligne dont elle lit l\'élément, dans les deux sens', async function () {
      await fermer('ul.c mjs-trio')
      assert.equal(await lus('ul.c mjs-trio'), 'abd,abd')
      await clic('button.recharger')
      assert.equal(await lus('ul.c mjs-trio'), 'Abd,Abd', '$rows rechargé : a={r.open} redonné, b={c.on} et d={$o} gardés (avant : « ABD,ABD »)')
      await fermer('ul.c mjs-trio')
      await clic('button.colonnes')
      assert.equal(await lus('ul.c mjs-trio'), 'aBd,aBd', '$cols rechargé : b={c.on} redonné, a={r.open} et d={$o} gardés (avant : « ABD,ABD »)')
    })

    it('d. liste écrite dans le gabarit, rejouée par un autre état du parent : le volet et le champ <@@number value={$n}> gardent ce qu\'ils ont écrit', async function () {
      await fermer('div.d mjs-volet')
      await clic('button.autre')
      assert.equal(await page.evaluate(`__h().querySelector('div.d span.vu').textContent`), '1', 'la liste est rejouée')
      assert.equal(await lus('div.d mjs-volet'), 'non', 'ouvert={$o} gardé (avant : « oui »)')
      await page.evaluate(`(() => { const c = __champ(); c.focus(); c.select() })()`)
      await page.keyboard.type('7', { delay: 30 })
      await page.waitForTimeout(80)
      assert.equal(await champ(), '7 | 7')
      await clic('button.autre')
      assert.equal(await page.evaluate(`__h().querySelector('div.d span.vu').textContent`), '2', 'la liste est rejouée')
      assert.equal(await champ(), '7 | 7', 'la frappe reste, annoncée (avant : « 7 | 4 »)')
    })

    if (env === 'dev') it('e. première recharge d\'une ligne neuve, puis une seconde : même résultat les deux fois', async function () {
      await clic('button.ajouter')
      await page.waitForFunction(() => (window as any).__h().querySelectorAll('ul.a li:nth-child(3) mjs-volet').length === 4 && [...(window as any).__h().querySelectorAll('ul.a li:nth-child(3) mjs-volet')].every((x: any) => (window as any).__o(x).querySelector('p.v')))
      for (const fois of ['première', 'seconde']) {
        await fermer('ul.a li:nth-child(3) mjs-volet')
        assert.equal(await lus('ul.a li:nth-child(3) mjs-volet'), 'non,non,non,non')
        await clic('button.recharger')
        assert.equal(await lus('ul.a li:nth-child(3) mjs-volet'), 'non,oui,oui,non', `${fois} recharge : ouvert={$o} et ouvert={i === 0} gardés, ouvert={r.open} et ouvert={k} redonnés`)
      }
    })

    it('f. {const} écrit après le composant qui le lit (hissé en tête de la ligne) : redonné comme les autres lectures de la ligne', async function () {
      await fermer('ul.h mjs-volet')
      assert.equal(await lus('ul.h mjs-volet'), 'non,non')
      await clic('button.recharger')
      assert.equal(await lus('ul.h mjs-volet'), 'oui,oui', 'ouvert={k2}, {const k2 = r.open} écrit après le volet : redonné (une analyse qui ne voit que les {const} déjà lus le laissait fermé)')
    })
  })
}
