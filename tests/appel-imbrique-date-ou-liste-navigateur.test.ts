// appel d'une méthode qui change une `Date`, une liste ou un objet de l'état, passé en argument d'un autre (`$d.setTime($e.setDate(2))`,
// `$l.push($d.setDate(3))`, `$l.unshift($l.pop())`, trois niveaux) : le code compilé reste du JavaScript valide, et donne ce que donne
// le même code sur des objets ordinaires. Les deux modes (enveloppe et `"proxy": false`), Chromium réel
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger, graves } from './helpers/liaison-navigateur.js'

// le même corps, sur l'état (`$`) puis sur des objets ordinaires : les deux résultats doivent être égaux
const corps = (p: string) => `${p}d.setTime(${p}e.setDate(2)); ${p}l.push(${p}d.setDate(3)); ${p}d.setTime(${p}l.push(4) * 1000); ${p}e.setTime(${p}d.setTime(${p}e.setDate(5))); ${p}l.unshift(${p}l.pop()); ${p}l.push(${p}l.splice(0, 1)[0]); ${p}l.push(${p}b.push(${p}c.shift()));`

const SOURCE = `<script lang="js">
  $l = [1]; $b = [7]; $c = [8, 9]; $d = new Date(0); $e = new Date(0);
  @f = function() { ${corps('$')} };
  @attendu = function() { const o = { l: [1], b: [7], c: [8, 9], d: new Date(0), e: new Date(0) }; ${corps('o.')} return [o.l.join(), o.b.join(), o.c.join(), o.d.getTime(), o.e.getTime()].join(' '); };
</script>
<p class="v">{$l.join()} {$b.join()} {$c.join()} {$d.getTime()} {$e.getTime()}</p>
<p class="pret">prêt</p>
`

async function construire(nom: string, opts: Record<string, unknown>) {
  const root   = mjsTmp('appel-imbrique-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'ai-dates.mjs'), SOURCE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', urlPrefix: '/out', minify: false, ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [], 'le code compilé s\'assemble (JavaScript valide)')
  const page = (corpsPage: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-ai-dates></mjs-ai-dates>${corpsPage}</body></html>`
  return { mode: 'bundle', racine: root, document: () => page('<script type="module" src="/out/bundle.js"></script>') } as any
}

describe('appel imbriqué sur une Date, une liste, un objet de l\'état (chromium réel)', function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) return this.skip()
    browser = await playwright.chromium.launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const [nom, opts] of [['avec l\'enveloppe', {}], ['avec "proxy": false', { proxy: false }]] as const) {
    it(`${nom} : JavaScript valide, même résultat que sur des objets ordinaires`, async function () {
      const o = await charger(browser, await construire(nom === 'avec l\'enveloppe' ? 'avec' : 'sans', opts), 'mjs-ai-dates')
      try {
        await o.page.waitForFunction(`!!document.querySelector('mjs-ai-dates')?._shadow?.querySelector('.pret')`, null, { timeout: 10000 })
        const r: any = await o.page.evaluate(`(async () => {
          const h = document.querySelector('mjs-ai-dates')
          h.f()
          await new Promise((fin) => setTimeout(() => requestAnimationFrame(() => setTimeout(fin, 0)), 30))
          return { vu: h._shadow.querySelector('p.v').textContent, attendu: h.attendu() }
        })()`)
        assert.deepEqual(graves(o), [], 'aucune erreur')
        assert.equal(r.vu, r.attendu)
      }
      finally {
        await o.fermer()
      }
    })
  }
})
