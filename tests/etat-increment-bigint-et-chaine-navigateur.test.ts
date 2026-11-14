// `++` et `--` sur l'état gardent la sémantique de JavaScript : un `BigInt` reste un `BigInt` (`0n` → `1n`, jamais d'erreur), une
// chaîne devient un nombre (`'5'++` donne 6), l'ancienne valeur rendue par `x++` est convertie comme en JavaScript — à la racine
// (`$b++`, `$[k]++`), en profondeur (`$o.n++`), par la variable d'une boucle `{for}` et par le paramètre d'un rappel, en
// instruction comme en valeur lue, dans le script comme dans un gestionnaire. Avec et sans le réglage `proxy: false`, Chromium,
// Firefox et WebKit réels
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger, graves } from './helpers/liaison-navigateur.js'

const P = '<p class="pret">prêt</p>\n'
const SOURCES: Record<string, string> = {
  'bi-racine.mjs': `<script lang="js">
  $b = 0n;
  $s = '5';
  $n = 1.5;
  $r = '';
  @f = function() {
    $b++;
    let a = $b++;
    let c = ++$b;
    $b--;
    $s++;
    let d = $s++;
    $n++;
    $r = [typeof a, a, c, typeof d, d].join(',');
  };
  @g = function(k) { $[k]++; };
</script>
<p class="v">{String($b)} {$s} {$n} {$r}</p>
<button class="b" @click={$b++}>+</button>
${P}`,
  'bi-profond.mjs': `<script lang="js">
  $o = { n: 0n, s: '5', l: [{ n: 0n }] };
  @f = function() {
    $o.n++;
    let a = $o.n++;
    let c = ++$o.n;
    $o.s++;
    $o.l.forEach((x) => { x.n++; });
    $o.l.forEach((x) => x.n++);
    $o.r = [typeof a, a, c].join(',');
  };
</script>
<p class="v">{String($o.n)} {$o.s} {String($o.l[0].n)} {$o.r}</p>
{for x in $o.l}<button class="b" @click={x.n++}>+</button>{end}
${P}`,
}
const NOMS = Object.keys(SOURCES).map((f) => f.replace('.mjs', ''))

async function construire(nom: string, opts: Record<string, unknown>) {
  const root   = mjsTmp('increment-bigint-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', urlPrefix: '/out', minify: false, ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const page = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${NOMS.map((n) => `<mjs-${n}></mjs-${n}>`).join('')}${corps}</body></html>`
  return { mode: 'bundle', racine: root, document: () => page('<script type="module" src="/out/bundle.js"></script>') } as any
}

const SCENARIO = `(async () => {
  const q = (b) => document.querySelector('mjs-' + b)
  const ecran = (b) => q(b)._shadow.querySelector('p.v').textContent
  const bouton = (b) => q(b)._shadow.querySelector('button.b')
  const pause = () => new Promise((fin) => setTimeout(() => requestAnimationFrame(() => setTimeout(fin, 0)), 30))
  const r = {}
  try { q('bi-racine').f(); q('bi-racine').g('b'); r.racineErreur = 'aucune' } catch (e) { r.racineErreur = e.constructor.name + ' ' + e.message }
  await pause(); r.racine = ecran('bi-racine')
  bouton('bi-racine').click(); await pause(); r.racineClic = ecran('bi-racine')
  try { q('bi-profond').f(); r.profondErreur = 'aucune' } catch (e) { r.profondErreur = e.constructor.name + ' ' + e.message }
  await pause(); r.profond = ecran('bi-profond')
  bouton('bi-profond').click(); await pause(); r.profondClic = ecran('bi-profond')
  return r
})()`

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`++ et -- sur un BigInt et une chaîne : la sémantique de JavaScript (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) return this.skip()
    browser = await playwright[moteur].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })
  for (const [nom, opts] of [['avec l\'enveloppe', {}], ['avec "proxy": false', { proxy: false }]] as const) it(`un BigInt reste un BigInt, '5'++ donne 6 — ${nom}`, async function () {
    const c = await construire(moteur + (nom.includes('false') ? '-sans' : '-avec'), opts)
    const o = await charger(browser, c, 'mjs-bi-racine')
    try {
      await o.page.waitForFunction(`${JSON.stringify(NOMS)}.every((b) => !!document.querySelector('mjs-' + b)?._shadow?.querySelector('.pret'))`, null, { timeout: 10000 })
      const r: any = await o.page.evaluate(SCENARIO)
      assert.equal(r.racineErreur, 'aucune', 'racine : aucune erreur')
      assert.equal(r.racine, '3 7 2.5 bigint,1,3,number,6', 'racine : instruction, valeur lue, clé dynamique')
      assert.equal(r.racineClic, '4 7 2.5 bigint,1,3,number,6', 'racine : gestionnaire')
      assert.equal(r.profondErreur, 'aucune', 'profond : aucune erreur')
      assert.equal(r.profond, '3 6 2 bigint,1,3', 'profond : instruction, valeur lue, paramètre d\'un rappel')
      assert.equal(r.profondClic, '3 6 3 bigint,1,3', 'profond : variable d\'une boucle {for}')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
})
