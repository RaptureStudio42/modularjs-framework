// `<@@number big>` : un grand pas à côté du petit. « −− » et « ++ » ne paraissent que si `big` est écrit
// (`big` seul : 10, `big="100"` : 100) ; `step` règle le petit pas (1 par défaut). Clic, appui long qui accélère,
// bornes `min` / `max`, Page haut / Page bas (grand pas) et flèches (petit pas), remise à zéro du formulaire.
// Vrais clics et vraies touches dans Chromium et Firefox.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'gp-page.mjs': `<script>
  $a = 5
  $b = 240
  $c = 0
  $d = 5
  $e = 0
  $changes = 0
  count = -> $changes++
</script>
<form>
  <@@number class="a" value=!{$a} big @change={count()}></@@number>
  <@@number class="b" value=!{$b} min="0" max="250" big="100"></@@number>
  <@@number class="c" value=!{$c} step="0.5" big="5"></@@number>
  <@@number class="d" value=!{$d}></@@number>
  <@@number class="e" value=!{$e} step="0.5"></@@number>
  <button type="reset" class="r">raz</button>
</form>
<p class="mod"><b class="va">{$a}</b>|<b class="vb">{$b}</b>|<b class="vc">{$c}</b>|<b class="vd">{$d}</b>|<b class="ve">{$e}</b>|<b class="ch">{$changes}</b></p>
`
}

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`<@@number big> : le grand pas (${nom} réel)`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test du grand pas sauté`)
        return
      }
      const root   = mjsTmp('number-grand-pas-' + nom)
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
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
    })

    after(async () => { await terminateSharedWorkerPool() })

    async function essai(fn: (page: any) => Promise<void>) {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await browser.newPage()
        page.setDefaultTimeout(5000)
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-gp-page></mjs-gp-page><script>${script}</script></body></html>` }))
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-gp-page') as any)?._shadow?.querySelector('mjs-core-number.d')?._shadow?.querySelector('input'))
        await page.waitForTimeout(150)
        await fn(page)
        assert.deepEqual(erreurs, [], 'aucune erreur de page')
      } finally {
        await browser.close()
      }
    }

    const modele = (page: any, cls: string) => page.evaluate((c: string) => (document.querySelector('mjs-gp-page') as any)._shadow.querySelector('b.' + c).textContent as string, cls)
    // les boutons du champ, dans l'ordre du DOM : leurs textes
    const boutons = (page: any, cls: string) => page.evaluate((c: string) => [...(document.querySelector('mjs-gp-page') as any)._shadow.querySelector('mjs-core-number.' + c)._shadow.querySelectorAll('button')].map((b: any) => b.textContent as string), cls)
    const dedans = (cls: string, sel: string) => `(document.querySelector('mjs-gp-page')._shadow.querySelector('mjs-core-number.${cls}')._shadow.querySelector('button.${sel}'))`
    const centre = (page: any, cls: string, sel: string) => page.evaluate(`(() => { const r = ${dedans(cls, sel)}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`) as Promise<{ x: number, y: number }>
    const clic   = async (page: any, cls: string, sel: string) => { const c = await centre(page, cls, sel); await page.mouse.click(c.x, c.y) }
    const grise  = (page: any, cls: string, sel: string) => page.evaluate(`${dedans(cls, sel)}.disabled`) as Promise<boolean>
    const focus   = (page: any, cls: string) => page.evaluate((c: string) => (document.querySelector('mjs-gp-page') as any)._shadow.querySelector('mjs-core-number.' + c)._shadow.querySelector('input').focus(), cls)

    it('sans `big` : deux boutons ; avec `big` : quatre, « −− » et « ++ » aux bords, libellés au vouvoiement sans objet', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        assert.deepEqual(await boutons(page, 'd'), ['−', '+'], 'sans big : − et +')
        assert.deepEqual(await boutons(page, 'a'), ['−−', '−', '+', '++'], 'big seul')
        const labels = await page.evaluate(() => [...(document.querySelector('mjs-gp-page') as any)._shadow.querySelector('mjs-core-number.a')._shadow.querySelectorAll('button')].map((b: any) => b.getAttribute('aria-label')))
        assert.deepEqual(labels, ['Diminuer de 10', 'Moins', 'Plus', 'Augmenter de 10'])
        const labelsB = await page.evaluate(() => [...(document.querySelector('mjs-gp-page') as any)._shadow.querySelector('mjs-core-number.b')._shadow.querySelectorAll('button')].map((b: any) => b.getAttribute('aria-label')))
        assert.deepEqual([labelsB[0], labelsB[3]], ['Diminuer de 100', 'Augmenter de 100'])
      })
    })

    it('clic : ++ et −− bougent de 10 (big seul) ou de 100 (big="100") ; « change » part une fois par clic', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await clic(page, 'a', 'more.big')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'va'), '15')
        await clic(page, 'a', 'less.big')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'va'), '5')
        assert.equal(await modele(page, 'ch'), '2', 'un change par clic')
        await clic(page, 'a', 'more')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'va'), '6', 'le petit pas reste 1')
      })
    })

    it('bornes : le grand pas s\'arrête à max et à min, le bouton se grise', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await clic(page, 'b', 'more.big')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'vb'), '250', '240 + 100 est borné à 250')
        assert.ok(await grise(page, 'b', 'more.big'), '++ grisé à max')
        await clic(page, 'b', 'less.big')
        await clic(page, 'b', 'less.big')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'vb'), '50')
        await clic(page, 'b', 'less.big')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'vb'), '0', '50 - 100 est borné à 0')
        assert.ok(await grise(page, 'b', 'less.big'), '−− grisé à min')
      })
    })

    it('step décimal : step="0.5" big="5" : − vaut 0,5 et ++ vaut 5, sans dérive de virgule', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await clic(page, 'c', 'more')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'vc'), '0.5')
        await clic(page, 'c', 'more.big')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'vc'), '5.5')
        await clic(page, 'c', 'less.big')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'vc'), '0.5')
      })
    })

    it('clavier : Page haut / Page bas = grand pas, flèches = petit pas', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await focus(page, 'a')
        await page.keyboard.press('PageUp')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'va'), '15')
        await page.keyboard.press('ArrowDown')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'va'), '14')
        await focus(page, 'c')
        await page.keyboard.press('PageUp')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'vc'), '5', 'big="5" : Page haut ajoute 5')
        await page.keyboard.press('ArrowUp')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'vc'), '5.5', 'step="0.5" : flèche ajoute 0,5')
        await focus(page, 'b')
        await page.keyboard.press('PageDown')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'vb'), '140', 'big="100" : Page bas retire 100')
      })
    })

    it('sans big : Page haut et Page bas gardent leur ancien pas, dix fois step (step="0.5" : 5)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await focus(page, 'e')
        await page.keyboard.press('PageUp')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 've'), '5')
        await page.keyboard.press('PageDown')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 've'), '0')
      })
    })

    it('appui long sur ++ : un grand pas tout de suite, puis de plus en plus vite, par multiples du grand pas', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const c = await centre(page, 'a', 'more.big')
        await page.mouse.move(c.x, c.y)
        await page.mouse.down()
        await page.waitForTimeout(1800)
        await page.mouse.up()
        await page.waitForTimeout(100)
        const v = Number(await modele(page, 'va'))
        assert.ok(v > 15 + 30, `l'appui long accélère (${v})`)
        assert.equal((v - 5) % 10, 0, `toujours par multiples de 10 (${v})`)
        const arret = await modele(page, 'va')
        await page.waitForTimeout(400)
        assert.equal(await modele(page, 'va'), arret, 'relâché : plus rien ne bouge')
        assert.equal(await modele(page, 'ch'), '1', 'un seul change à la fin du geste')
      })
    })

    it('form.reset() rend le champ à sa valeur de départ', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await clic(page, 'a', 'more.big')
        await page.waitForTimeout(60)
        assert.equal(await modele(page, 'va'), '15')
        await page.evaluate("document.querySelector('mjs-gp-page')._shadow.querySelector('button.r').click()")
        await page.waitForTimeout(120)
        assert.equal(await modele(page, 'va'), '5')
      })
    })
  })
}
