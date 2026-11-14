// réglage `proxy: false` au navigateur réel, contre l'enveloppe : une écriture par une clé ou un indice calculés (`$l[$i].n = 5`,
// `$o[$k]++`, `$l[$l.length] = x`), une méthode qui modifie une `Date`, le paramètre d'un rappel de liste (`forEach`, `map`), la tête
// d'une boucle du script, la variable d'une boucle `{for}` du gabarit, en JavaScript, CoffeeScript et Civet, redessine comme avec
// l'enveloppe : mêmes écrans, même valeur dérivée, mêmes passages du reffet, et une seule notification par écriture (jamais l'aide
// compilée puis le piège de l'enveloppe). Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const PAS = [
  '$l[$i].n = 5', '$l[$i].n += 1', '$d.setUTCDate(5)', '$o[$k]++', '$l[$l.length] = { n: 7, tags: [] }', '$l[$i].tags.push(1)',
  '$o.when.setUTCHours(3)', '$l.forEach((x) => x.n++)', '$l.map((x) => { x.n += 10; return x; })', 'for ($o.txt of [\'b\', \'c\']) {}',
  '$o.a.b.c += 2', 'for (let j = 0; j < 2; j++) $l[j].n++',
]

const SOURCES: Record<string, string> = {
  'fv-x.mjs': `<script lang="js">
  $o = { a: { b: { c: 0 } }, txt: 'a', n: 0, when: new Date(0) };
  $l = [{ n: 0, tags: [] }, { n: 10, tags: [] }];
  $i = 1;
  $k = 'n';
  $d = new Date(0);
  $total = $l.map((x) => x.n).join(',');
  µeffect(() => { if ($o.n >= 0) globalThis.vus = (globalThis.vus || 0) + 1; });
${PAS.map((f, k) => `  @f${k} = function() { ${f}; };`).join('\n')}
</script>
<p class="v">{[$l.map((x) => x.n).join(','), $l[1].tags.length, $d.getUTCDate(), $o.n, $o.when.getUTCHours(), $o.txt, $o.a.b.c, $total, $l.length].join(' ')}</p>
{for x in $l}<button class="lx" @click={x.n++}>{x.n}</button>{end}
<p class="pret">prêt</p>
`,
  'fv-c.mjs': `<script lang="coffee">
$l = [{ n: 0 }, { n: 10 }]
$i = 1
@f0 = ->
  $l[$i].n = 5
  return
@f1 = ->
  $l[$i].n += 1
  return
@f2 = ->
  $l.forEach (x) -> x.n++
  return
</script>
<p class="v">{$l.map((x) -> x.n).join(' ')}</p>
<p class="pret">prêt</p>
`,
  'fv-v.mjs': `<script>
$l = [{ n: 0 }, { n: 10 }]
$i = 1
@f0 = -> $l[$i].n = 5
@f1 = -> $l.forEach (x) => x.n++
@f2 = -> $l[$l.length] = { n: 3 }
</script>
<p class="v">{$l.map((x) => x.n).join(' ')}</p>
<p class="pret">prêt</p>
`,
}

const ATTENDU = {
  pas: ['0,10 0 1 0 0 a 0 0,10 2', '0,5 0 1 0 0 a 0 0,5 2', '0,6 0 1 0 0 a 0 0,6 2', '0,6 0 5 0 0 a 0 0,6 2', '0,6 0 5 1 0 a 0 0,6 2',
    '0,6,7 0 5 1 0 a 0 0,6,7 3', '0,6,7 1 5 1 0 a 0 0,6,7 3', '0,6,7 1 5 1 3 a 0 0,6,7 3', '1,7,8 1 5 1 3 a 0 1,7,8 3',
    '11,17,18 1 5 1 3 a 0 11,17,18 3', '11,17,18 1 5 1 3 c 0 11,17,18 3', '11,17,18 1 5 1 3 c 2 11,17,18 3', '12,18,18 1 5 1 3 c 2 12,18,18 3',
    'clic 13,18,18 1 5 1 3 c 2 13,18,18 3 13'],
  // une notification par écriture : les rappels sur trois lignes en font trois, la boucle de deux tours deux
  notes:  [1, 1, 1, 1, 1, 1, 1, 3, 3, 2, 1, 2, 1],
  coffee: ['0 10', '0 5', '0 6', '1 7'],
  civet:  ['0 10', '0 5', '1 6', '1 6 3'],
}

// sans minification : les noms internes restent lisibles, la notification se compte par son nom
async function construire(nom: string, opts: Record<string, unknown>): Promise<Cible> {
  const root   = mjsTmp('formes-vues-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', urlPrefix: '/out', minify: false, ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const page = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-fv-x></mjs-fv-x><mjs-fv-c></mjs-fv-c><mjs-fv-v></mjs-fv-v>${corps}</body></html>`
  return { mode: 'bundle', racine: root, document: () => page('<script type="module" src="/out/bundle.js"></script>') }
}

const cibles = new Map<string, Promise<Cible>>()
const cible  = (nom: string, opts: Record<string, unknown>) => {
  if (!cibles.has(nom)) cibles.set(nom, construire(nom, opts))
  return cibles.get(nom) as Promise<Cible>
}

// chaque pas suivi d'une image et d'une tâche ; les notifications comptées sur le composant (aide compilée et piège de l'enveloppe
// passent tous deux par `_mjs_notifyMutationAliased`)
async function parcours(browser: any, c: Cible) {
  const o = await charger(browser, c, 'mjs-fv-x')
  try {
    await o.page.waitForFunction('[\'fv-x\', \'fv-c\', \'fv-v\'].every((b) => !!document.querySelector(\'mjs-\' + b)?._shadow?.querySelector(\'.pret\'))', null, { timeout: 10000 })
    const r = await o.page.evaluate(`(async () => {
      const el = document.querySelector('mjs-fv-x'), cf = document.querySelector('mjs-fv-c'), cv = document.querySelector('mjs-fv-v')
      const pause = () => new Promise((fin) => setTimeout(() => requestAnimationFrame(() => setTimeout(fin, 0)), 20))
      const ecran = (x) => x._shadow.querySelector('p.v').textContent
      let n = 0
      const avant = el._mjs_notifyMutationAliased
      el._mjs_notifyMutationAliased = function (...a) { n++; return avant.apply(this, a) }
      await pause()
      const pas = [ecran(el)], notes = [], vus = [globalThis.vus]
      for (let k = 0; k < ${PAS.length}; k++) {
        n = 0
        el['f' + k]()
        await pause()
        pas.push(ecran(el))
        notes.push(n)
        vus.push(globalThis.vus)
      }
      n = 0
      el._shadow.querySelector('button.lx').click()
      await pause()
      pas.push('clic ' + ecran(el) + ' ' + el._shadow.querySelector('button.lx').textContent)
      notes.push(n)
      const coffee = [ecran(cf)], civet = [ecran(cv)]
      for (let k = 0; k < 3; k++) {
        cf['f' + k]()
        cv['f' + k]()
        await pause()
        coffee.push(ecran(cf))
        civet.push(ecran(cv))
      }
      return { pas, notes, coffee, civet, vus }
    })()`)
    assert.deepEqual(graves(o), [], 'aucune erreur')
    return r
  } finally {
    await o.fermer()
  }
}

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`état sans Proxy : formes vues par le compilateur, comme l'enveloppe (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) {
      this.skip()
      return
    }
    browser = await playwright[moteur].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('mêmes écrans, une notification par écriture, mêmes passages du reffet, avec et sans le réglage', async function () {
    const avec = await parcours(browser, await cible('avec', {}))
    const sans = await parcours(browser, await cible('sans', { proxy: false }))
    const { vus: vusAvec, ...resteAvec } = avec
    const { vus: vusSans, ...resteSans } = sans
    assert.deepEqual(resteAvec, ATTENDU, 'enveloppe')
    assert.deepEqual(resteSans, ATTENDU, 'sans le réglage')
    assert.deepEqual(vusSans, vusAvec, 'passages du reffet')
  })
})
