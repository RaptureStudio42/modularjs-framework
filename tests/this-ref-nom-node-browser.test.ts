// Une variable de l'auteur nommée `node` se lie comme n'importe quelle autre : `@this=!{node}` lui donne l'élément, et
// `@class{node is 'U'}` lit sa valeur. Le code que le compilateur écrit autour de ces liaisons garde ses propres noms à
// lui (préfixe `_mjs`) : rien de ce qu'il déclare ne cache une variable du script. Chaque cas se joue à la racine du
// composant, dans une ligne de `{for}` et dans la branche d'un `{await}`, dans les trois modes : développement,
// production en fichiers séparés, production en un seul fichier (où un `const` cachant la variable cassait la compilation
// sur « Cannot assign to … because it is a constant »). Chromium réel.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, attendre, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // deux références dans un même composant : `node` (le nom en cause) et `cardEl` (témoin), chacune sur son élément
  'ref-racine.mjs': `<script>
  node   = null
  cardEl = null
  µmount -> $lu = "node=#{node?.localName or 'null'} cardEl=#{cardEl?.localName or 'null'}"
</script>
<div class="cible" @this=!{node}>a</div>
<span class="autre" @this=!{cardEl}>b</span>
<p class="vu">{$lu}</p>
`,
  // la variable n'est pas déclarée dans le script : le compilateur la déclare, et le script s'en sert pour agir sur l'élément
  'ref-auto.mjs': `<script>
  µmount ->
    node.dataset.vu = 'oui'
    $lu = "node=#{node.localName}"
</script>
<div class="cible" @this=!{node}>a</div>
<p class="vu">{$lu}</p>
`,
  'ref-boucle.mjs': `<script>
  node    = null
  $lignes = ['a', 'b']
  lire    = -> $lu = "node=#{node?.localName or 'null'} texte=#{node?.textContent}"
</script>
{for l in $lignes}
  <li @this=!{node}>{l}</li>
{end}
<button class="lire" @click={lire()}>lire</button>
<p class="vu">{$lu}</p>
`,
  'ref-attente.mjs': `<script>
  node = null
  $p   = Promise.resolve('ok')
  lire = -> $lu = "node=#{node?.localName or 'null'}"
</script>
{await $p}
  <i>attente</i>
{success valeur}
  <b @this=!{node}>{valeur}</b>
{end}
<button class="lire" @click={lire()}>lire</button>
<p class="vu">{$lu}</p>
`,
  // la condition d'une classe lit `node` : la variable du script, pas l'élément
  'ref-classe.mjs': `<script>
  node    = 'U'
  autre   = 'U'
  $lignes = [1]
</script>
<div class="n1" @class{node is 'U'}="on">1</div>
<div class="n2" @class{autre is 'U'}="on">2</div>
<div class="n3" title={node}>3</div>
<div class="n4" data-v={node + '!'}>4</div>
<div class="n5" title="a-{node}">5</div>
{for l in $lignes}
  <div class="n6" @class{node is 'U'}="on">6</div>
  <div class="n7" @class{autre is 'U'}="on">7</div>
{end}
`
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

const lireTexte = (page: any, balise: string, sel: string) => page.evaluate(`document.querySelector('${balise}')._shadow.querySelector('${sel}').textContent`)

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`@this=!{node} et variable de l'auteur nommée node (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de la variable node sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('le composant se compile', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it('à la racine : node et cardEl reçoivent chacun leur élément', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), 'mjs-ref-racine')
    try {
      await attendre(o.page, 'mjs-ref-racine', 0)
      assert.equal(await lireTexte(o.page, 'mjs-ref-racine', '.vu'), 'node=div cardEl=span')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })

  it('variable non déclarée dans le script : node.dataset agit sur l\'élément lié', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), 'mjs-ref-auto')
    try {
      await attendre(o.page, 'mjs-ref-auto', 0)
      assert.equal(await o.page.evaluate(`document.querySelector('mjs-ref-auto')._shadow.querySelector('.cible').dataset.vu || '(absent)'`), 'oui')
      assert.equal(await lireTexte(o.page, 'mjs-ref-auto', '.vu'), 'node=div')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })

  it('dans une ligne de {for} : node reçoit l\'élément de la ligne', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), 'mjs-ref-boucle')
    try {
      await attendre(o.page, 'mjs-ref-boucle', 0)
      await o.page.evaluate(`document.querySelector('mjs-ref-boucle')._shadow.querySelector('.lire').click()`)
      await o.page.waitForTimeout(200)
      assert.match(await lireTexte(o.page, 'mjs-ref-boucle', '.vu'), /^node=li texte=[ab]$/)
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })

  it('dans la branche d\'un {await} : node reçoit l\'élément de la branche', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), 'mjs-ref-attente')
    try {
      await attendre(o.page, 'mjs-ref-attente', 0)
      await o.page.waitForTimeout(200)
      await o.page.evaluate(`document.querySelector('mjs-ref-attente')._shadow.querySelector('.lire').click()`)
      await o.page.waitForTimeout(200)
      assert.equal(await lireTexte(o.page, 'mjs-ref-attente', '.vu'), 'node=b')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })

  it('@class{node is …}, title={node} et data-*={node} lisent la variable du script, à la racine comme dans une ligne', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), 'mjs-ref-classe')
    try {
      await attendre(o.page, 'mjs-ref-classe', 0)
      const lu = JSON.parse(await o.page.evaluate(`(() => { const s = document.querySelector('mjs-ref-classe')._shadow; const g = (c, a) => s.querySelector(c) ? s.querySelector(c).getAttribute(a) : '(absent)'; const on = (c) => s.querySelector(c) ? s.querySelector(c).classList.contains('on') : '(absent)'; return JSON.stringify({ n1: on('.n1'), n2: on('.n2'), n3: g('.n3', 'title'), n4: g('.n4', 'data-v'), n5: g('.n5', 'title'), n6: on('.n6'), n7: on('.n7') }) })()`))
      assert.equal(lu.n2, true, 'le témoin, nommé autrement, a bien sa classe')
      assert.equal(lu.n1, true, '@class{node is …} donne le rendu de @class{autre is …}')
      assert.equal(lu.n3, 'U')
      assert.equal(lu.n4, 'U!')
      assert.equal(lu.n5, 'a-U')
      assert.equal(lu.n7, true)
      assert.equal(lu.n6, true, 'dans une ligne : même rendu avec node et avec autre')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
})
