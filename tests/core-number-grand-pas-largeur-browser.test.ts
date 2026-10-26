// `<@@number big>` : quatre boutons de 40px au lieu de deux. Le champ gardait sa largeur par défaut (160px) : les quatre boutons
// la prenaient toute, la saisie tombait à une douzaine de pixels (la valeur ne se lisait plus) et « ++ » passait sous le bord arrondi.
// Avec `big`, le champ s'élargit de ces deux boutons (240px), la saisie garde la place qu'elle a sans `big`, et une largeur posée par
// `--mjs-number-width` reste celle du champ. Mesures dans Chromium et Firefox réels.

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
  'gl-page.mjs': `<script>
  $a = 2
  $b = 300
  $c = 300
</script>
<div class="ligne">
  <@@number class="a" value=!{$a} min="0" max="20"></@@number>
  <@@number class="b" value=!{$b} min="0" max="1000" step="10" big="100"></@@number>
  <@@number class="c" value=!{$c} big="100"></@@number>
</div>
<style>
  .ligne
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 22px

  mjs-core-number.c
    --mjs-number-width: 300px
</style>
`
}

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`<@@number big> : la saisie garde sa place à côté des quatre boutons (${nom} réel)`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de la largeur du grand pas sauté`)
        return
      }
      const root   = mjsTmp('number-grand-pas-largeur-' + nom)
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

    // largeurs du champ, de la saisie, et débord du dernier bouton hors du champ (bord droit du bouton moins bord intérieur du champ)
    async function mesures() {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await browser.newPage()
        page.setDefaultTimeout(5000)
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-gl-page></mjs-gl-page><script>${script}</script></body></html>` }))
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-gl-page') as any)?._shadow?.querySelector('mjs-core-number.c')?._shadow?.querySelector('input'))
        await page.waitForTimeout(150)
        const m = await page.evaluate(() => {
          const out: Record<string, any> = {}
          for (const cls of ['a', 'b', 'c']) {
            const sh     = (document.querySelector('mjs-gl-page') as any)._shadow.querySelector('mjs-core-number.' + cls)._shadow
            const champ  = sh.querySelector('.field').getBoundingClientRect()
            const saisie = sh.querySelector('input').getBoundingClientRect()
            const boutons = [...sh.querySelectorAll('button')]
            const dernier = boutons[boutons.length - 1].getBoundingClientRect()
            out[cls] = { champ: Math.round(champ.width), saisie: Math.round(saisie.width), boutons: boutons.length, debord: Math.round(dernier.right - (champ.right - 1)) }
          }
          return out
        })
        assert.deepEqual(erreurs, [], 'aucune erreur de page')
        return m
      } finally {
        await browser.close()
      }
    }

    it('sans `big` : 160px, deux boutons ; avec `big` : 240px, quatre boutons, la saisie aussi large que sans `big`, aucun bouton hors du champ', async function () {
      if (!present) { this.skip(); return }
      const m = await mesures()
      assert.equal(m.a.boutons, 2, 'sans big : deux boutons')
      assert.equal(m.a.champ, 160, 'sans big : 160px, inchangé')
      assert.equal(m.b.boutons, 4, 'big : quatre boutons')
      assert.equal(m.b.champ, 240, `big : le champ s'élargit des deux boutons du grand pas (${JSON.stringify(m.b)})`)
      assert.ok(m.b.saisie >= m.a.saisie, `big : la saisie garde sa place (${m.b.saisie}px avec big, ${m.a.saisie}px sans)`)
      assert.ok(m.b.debord <= 0, `big : « ++ » reste dans le champ (débord ${m.b.debord}px)`)
    })

    it('`--mjs-number-width` posé par la page reste la largeur du champ, avec `big` aussi', async function () {
      if (!present) { this.skip(); return }
      const m = await mesures()
      assert.equal(m.c.champ, 300, `largeur posée par la page (${JSON.stringify(m.c)})`)
      assert.ok(m.c.saisie > m.b.saisie, 'la saisie prend la place en plus')
    })
  })
}
