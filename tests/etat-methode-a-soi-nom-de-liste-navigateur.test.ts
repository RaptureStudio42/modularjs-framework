// méthode d'un objet de l'appli qui porte le nom d'une méthode de liste, de Map ou de Set (`push`, `set`, `add`, `delete`, `clear`…),
// appelée par une variable `$` ou par la variable d'une boucle `{for}` : avec l'enveloppe, elle est appelée comme JavaScript l'appelle,
// sur l'enveloppe — ses écritures, même celles d'après un `await`, sont vues. Une vraie liste, une Map, un Set, une liste typée gardent
// l'appel compilé. Avec `"proxy": false`, l'appel compilé prévient après la méthode : ce qu'elle écrit avant son `await` est vu, la suite
// est un changement fait hors de MJS, que l'écran montre ou non selon le moment de son redessin. Chromium réel
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger, graves } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'ms-panier.mjs': `<script lang="js">
  class Panier { constructor() { this.n = 0; this.fini = 'non'; } async add(x) { this.n += x; await null; this.fini = 'oui'; } }
  $p = new Panier();
  $o = { s: 0, fini: 'non', async push(x) { this.s = x; await null; this.fini = 'oui'; }, async clear() { await null; this.s = 0; } };
  $items = [new Panier()];
  $l = [1];
  $m = new Map();
  $s = new Set();
  $t = new Uint8Array(2);
  @f = function() { $p.add(5); $o.push(7); $l.push(2); $m.set('a', 1); $s.add('x'); $t.fill(3); };
  @g = function() { $o.clear(); };
</script>
<p class="v">{$p.n} {$p.fini} {$o.s} {$o.fini} {$l.length} {$m.size} {$s.size} {$t[0]}</p>
{for it in $items}<button class="b" @click={it.add(3)}>{it.n} {it.fini}</button>{end}
<p class="pret">prêt</p>
`
}

async function construire(nom: string, opts: Record<string, unknown>) {
  const root   = mjsTmp('methode-a-soi-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', urlPrefix: '/out', minify: false, ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const page = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-ms-panier></mjs-ms-panier>${corps}</body></html>`
  return { mode: 'bundle', racine: root, document: () => page('<script type="module" src="/out/bundle.js"></script>') } as any
}

const SCENARIO = `(async () => {
  const h = document.querySelector('mjs-ms-panier'), sh = h._shadow
  const pause = () => new Promise((fin) => setTimeout(() => requestAnimationFrame(() => setTimeout(fin, 0)), 30))
  h.f(); await pause(); await pause()
  const apres = sh.querySelector('p.v').textContent
  sh.querySelector('button.b').click(); await pause(); await pause()
  const ligne = sh.querySelector('button.b').textContent
  h.g(); await pause(); await pause()
  return { apres, ligne, vide: sh.querySelector('p.v').textContent }
})()`

describe('méthode à soi nommée comme une méthode de liste, de Map ou de Set (chromium réel)', function () {
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

  it('avec l\'enveloppe : appelée sur l\'enveloppe, ses écritures d\'après l\'attente sont vues ; les vraies collections restent compilées', async function () {
    const o = await charger(browser, await construire('avec', {}), 'mjs-ms-panier')
    try {
      await o.page.waitForFunction(`!!document.querySelector('mjs-ms-panier')?._shadow?.querySelector('.pret')`, null, { timeout: 10000 })
      const r: any = await o.page.evaluate(SCENARIO)
      assert.deepEqual(graves(o), [], 'aucune erreur')
      assert.deepEqual(r, { apres: '5 oui 7 oui 2 1 1 3', ligne: '3 oui', vide: '5 oui 0 oui 2 1 1 3' })
    }
    finally {
      await o.fermer()
    }
  })

  it('avec "proxy": false : l\'appel compilé prévient après la méthode, ce qu\'elle écrit avant son attente est vu', async function () {
    const o = await charger(browser, await construire('sans', { proxy: false }), 'mjs-ms-panier')
    try {
      await o.page.waitForFunction(`!!document.querySelector('mjs-ms-panier')?._shadow?.querySelector('.pret')`, null, { timeout: 10000 })
      const r: any = await o.page.evaluate(SCENARIO)
      assert.deepEqual(graves(o), [], 'aucune erreur')
      // ce qu'écrit la méthode avant son attente, et les vraies collections ; la suite de l'attente peut paraître ou non, selon
      // que l'écran est redessiné avant ou après elle
      const [n, , s, , l, m, e, t] = r.apres.split(' ')
      assert.deepEqual([n, s, l, m, e, t, r.ligne.split(' ')[0]], ['5', '7', '2', '1', '1', '3', '3'], JSON.stringify(r))
    }
    finally {
      await o.fermer()
    }
  })
})
