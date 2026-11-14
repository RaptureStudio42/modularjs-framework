// réglage `proxy: false` au navigateur réel, contre l'enveloppe : des écritures d'un élément de liste que le compilateur écrit en
// appels de MJS redessinent comme avec l'enveloppe — la variable d'une boucle `{for}` du gabarit sur une liste calculée qui garde ses
// objets (`{for x in $l.filter(f)}` puis `@click={x.n++}`), une valeur lue en tête d'instruction (`x.n++ || …`), une clé qui agit
// (`x.t[k++] = 1`, suivie de `µrefresh($l)`, la garde ne la compilant pas) — et le champ écrit par un éditeur lié à la liste
// (`<@editeur items=!{$rows}>`, qui écrit `$items[0].nom = v`) se voit chez le parent, chez l'enfant d'une ligne qui tient l'objet et chez
// un second éditeur lié au même objet. Mêmes écrans avec et sans le réglage. Chromium, Firefox et
// WebKit réels

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'el-liste.mjs': `<script lang="js">
  $l = [{ n: 0, t: [0, 0] }, { n: 10, t: [0, 0] }];
  @tete = function() { $l.forEach((x) => { x.n++ || void 0; }); };
  @cle = function() { let k = 0; $l.forEach((x) => { x.t[k++] = 1; }); µrefresh($l); };
</script>
<p class="v">{$l.map((z) => z.n + ':' + z.t.join('')).join(' ')}</p>
{for x in $l.filter((z) => z.n >= 0)}<button class="lf" @click={x.n++}>{x.n}</button>{end}
{for x in $l}<button class="lt" @click={x.n++ || void 0; void 0}>{x.n}</button>{end}
<p class="pret">prêt</p>
`,
  'el-frere.mjs': "<script>\n  $rows = [{ nom: 'a' }]\n</script>\n\n{for r in $rows}\n  <@c-el-enfant item={r}>\n{end}\n<@c-el-editeur items=!{$rows}>\n<@c-el-editeur class=\"deux\" items=!{$rows}>\n<p class=\"etat\">{$rows[0].nom}</p>\n",
  'c-el-enfant.mjs':  "<p class=\"vu\">{JSON.stringify($item)}</p>\n",
  'c-el-editeur.mjs': "<script>\n  agir = -> $items[0].nom = 'Z'\n</script>\n\n<p class=\"vu\">{$items[0].nom}</p>\n<button class=\"x\" type=\"button\" @click={agir()}>x</button>\n",
}

// écrans de la liste après chaque pas, puis la ligne de l'enfant, l'éditeur et le parent avant et après l'écriture de l'éditeur
const ATTENDU = {
  liste:  ['0:00 10:00 | 0 10 | 0 10', '0:00 11:00 | 0 11 | 0 11', '1:00 11:00 | 1 11 | 1 11', '2:00 12:00 | 2 12 | 2 12', '2:10 12:01 | 2 12 | 2 12'],
  editeur: [['{"nom":"a"}', 'a', 'a', 'a'], ['{"nom":"Z"}', 'Z', 'Z', 'Z']],
}

async function construire(nom: string, opts: Record<string, unknown>): Promise<Cible> {
  const root   = mjsTmp('elements-de-liste-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', urlPrefix: '/out', minify: false, ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const page = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-el-liste></mjs-el-liste><mjs-el-frere></mjs-el-frere>${corps}</body></html>`
  return { mode: 'bundle', racine: root, document: () => page('<script type="module" src="/out/bundle.js"></script>') }
}

const cibles = new Map<string, Promise<Cible>>()
const cible  = (nom: string, opts: Record<string, unknown>) => {
  if (!cibles.has(nom)) cibles.set(nom, construire(nom, opts))
  return cibles.get(nom) as Promise<Cible>
}

// chaque pas suivi d'une image et d'une tâche
async function parcours(browser: any, c: Cible) {
  const o = await charger(browser, c, 'mjs-el-liste')
  try {
    await o.page.waitForFunction('!!document.querySelector(\'mjs-el-liste\')?._shadow?.querySelector(\'.pret\') && !!document.querySelector(\'mjs-el-frere\')?._shadow?.querySelector(\'mjs-c-el-editeur\')?._shadow?.querySelector(\'.vu\')', null, { timeout: 10000 })
    const r = await o.page.evaluate(`(async () => {
      const el = document.querySelector('mjs-el-liste'), fr = document.querySelector('mjs-el-frere')._shadow
      const pause = () => new Promise((fin) => setTimeout(() => requestAnimationFrame(() => setTimeout(fin, 0)), 20))
      const textes = (s) => [...el._shadow.querySelectorAll(s)].map((b) => b.textContent).join(' ')
      const ecran = () => el._shadow.querySelector('p.v').textContent + ' | ' + textes('button.lf') + ' | ' + textes('button.lt')
      const vus = () => [fr.querySelector('mjs-c-el-enfant')._shadow.querySelector('.vu').textContent, fr.querySelector('mjs-c-el-editeur')._shadow.querySelector('.vu').textContent, fr.querySelector('mjs-c-el-editeur.deux')._shadow.querySelector('.vu').textContent, fr.querySelector('.etat').textContent]
      await pause()
      const liste = [ecran()]
      el._shadow.querySelectorAll('button.lf')[1].click()
      await pause()
      liste.push(ecran())
      el._shadow.querySelectorAll('button.lt')[0].click()
      await pause()
      liste.push(ecran())
      el.tete()
      await pause()
      liste.push(ecran())
      el.cle()
      await pause()
      liste.push(ecran())
      const editeur = [vus()]
      fr.querySelector('mjs-c-el-editeur')._shadow.querySelector('.x').click()
      await pause()
      editeur.push(vus())
      return { liste, editeur }
    })()`)
    assert.deepEqual(graves(o), [], 'aucune erreur')
    return r
  } finally {
    await o.fermer()
  }
}

const NAVIGATEURS = ['chromium', 'firefox', 'webkit'] as const

for (const nav of NAVIGATEURS) describe(`réglage proxy: false — éléments de liste écrits et éditeur lié, comme avec l'enveloppe (${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const [nom, opts] of [['enveloppe', {}], ['sans-enveloppe', { proxy: false }]] as const) it(`${nom} : chaque écriture redessine la liste, l'éditeur lié est vu par le parent et la ligne`, async function () {
    if (!present) { this.skip(); return }
    const r = await parcours(browser, await cible(nom, opts))
    // écrans de la liste ; la ligne, l'éditeur et le parent, avant et après l'écriture de l'éditeur
    assert.deepEqual(r, ATTENDU)
  })
})
