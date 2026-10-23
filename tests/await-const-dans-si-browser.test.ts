// un `{const}` déclaré dans un `{if}` placé dans une branche `{await}` (ou dans une ligne de `{for}`) se lit dans ce `{if}` : l'interpolation, l'attribut, la classe et la liaison deux sens
// qui le lisent le trouvent déclaré, à la création de la branche comme après le remplacement de la variable qu'il lit
// la déclaration était posée dans un bloc propre, refermé avant la première balise qui la lisait : le composant tombait au montage (« d is not defined »)
// chaque cas a son témoin, la même balise lisant la variable hors du bloc : un témoin faux dirait que le test lui-même est faux, il arrête donc le cas aussitôt
// les trois modes : développement, production en fichiers séparés, production en un seul fichier ; Chromium réel

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // interpolation, attribut et classe d'une balise du `{if}` : tous lisent le `{const}`
  'cs-lecture.mjs': `<script>
  $on  = true
  $obj = { x: 'a' }
  $p   = Promise.resolve({ nom: 'N' })
  @changer = -> $obj = { x: 'b' }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {if $on}
    {const d = $obj}
    <b class="ok" data-x={d.x} @class{d.x === 'b'}="change">{d.x}</b>
  {end}
{end}
<b class="temoin" data-x={$obj.x} @class{$obj.x === 'b'}="change">{$obj.x}</b>
`,
  // texte d'une balise éditable, en liaison deux sens : il montre la propriété du `{const}`, que la variable remplace
  'cs-texte.mjs': `<script>
  $on  = true
  $obj = { x: 'a' }
  $p   = Promise.resolve({ nom: 'N' })
  @changer = -> $obj = { x: 'b' }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {if $on}
    {const d = $obj}
    <div class="ok" contenteditable="true" @text=!{d.x}></div>
  {end}
{end}
<div class="temoin" contenteditable="true" @text=!{$obj.x}></div>
`,
  // le même `{if}` dans une ligne de `{for}` : le chemin des blocs est le même que sous `{await}`
  'cs-pour.mjs': `<script>
  $rows = [{ id: 1, on: true, o: { x: 'a' } }, { id: 2, on: true, o: { x: 'b' } }]
  @changer = -> $rows = [{ id: 1, on: true, o: { x: 'c' } }, { id: 2, on: true, o: { x: 'd' } }]
</script>
{for r in $rows by id}
  {if r.on}
    {const d = r.o}
    <b class="ok">{d.x}</b>
  {end}
{end}
<u class="temoin">témoin</u>
`
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// le composant est monté quand son témoin est dans l'ombre, ou quand il est tombé (la page montre alors un bandeau d'erreur) ; la branche a le temps d'arriver
const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`(() => {
    const h = document.querySelector('${balise}')
    return !!h && (h.classList.contains('mjs-error') || !!(h._shadow && h._shadow.querySelector('.temoin, .mjs-fatal-error')))
  })()`, null, { timeout: 10000 })
  await page.waitForTimeout(300)
}

// un appel sur le composant (`changer()`), puis le temps de la mise à jour
const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(250)
}

// le composant a survécu : un plantage vide son ombre, lui pose la classe `mjs-error` et y met un bandeau `mjs-fatal-error`
const vivant = (page: any, balise: string): Promise<boolean> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  return !h.classList.contains('mjs-error') && !h._shadow.querySelector('.mjs-fatal-error') && !!h._shadow.querySelector('.temoin')
})()`)

// ce que lit une expression sur une balise (`n` est la balise), ou `absente` quand elle n'est pas dans la page
const lu = (page: any, balise: string, sel: string, expr: string): Promise<string> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  return n ? String(${expr}) : 'absente'
})()`)

// les lectures [sélecteur, expression] après chaque geste, le composant vivant à chaque étape ; la première lecture est celle du témoin : fausse, elle arrête le cas aussitôt
async function parcours(page: any, balise: string, lectures: Array<[string, string]>, etapes: Array<[string, string | null, ...string[]]>, ecarts: string[]) {
  for (const [nom, appel, ...attendus] of etapes) {
    if (appel) await regler(page, balise, appel)
    const vif = await vivant(page, balise)
    if (!vif) {
      ecarts.push(`composant tombé, ${nom} : ${(await lu(page, balise, '.mjs-fatal-error', 'n.textContent')).slice(0, 200)}`)
      return
    }
    for (let i = 0; i < lectures.length; i++) {
      const lecture = await lu(page, balise, lectures[i][0], lectures[i][1])
      if (i === 0) assert.equal(lecture, attendus[0], `le témoin est faux (${nom}) : le test lui-même est à revoir`)
      else if (lecture !== attendus[i]) ecarts.push(`${lectures[i][0]} ${lectures[i][1]}, ${nom} : attendu ${attendus[i]}, lu ${lecture}`)
    }
  }
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`un {const} déclaré dans un {if} se lit dans ce {if} (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test du {const} dans un {if} sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre le composant, joue le scénario, puis exige qu'aucun écart n'ait été noté et qu'aucune erreur n'ait été dite par la page
  const jouer = async (balise: string, scenario: (page: any, ecarts: string[]) => Promise<void>) => {
    const o      = await charger(browser, await cible(mode), balise)
    const ecarts = [] as string[]
    try {
      await pret(o.page, balise)
      await scenario(o.page, ecarts)
      assert.deepEqual([...ecarts, ...graves(o).map((g) => `erreur de la page : ${g}`)], [])
    } finally {
      await o.fermer()
    }
  }

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it('{success v} {if} {const d = $obj} : l\'interpolation, l\'attribut et la classe lisent d à la création, la classe suit l\'objet qui remplace l\'ancien', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-cs-lecture'
    await jouer(balise, async (page, ecarts) => {
      // le texte, l'attribut et la classe d'une branche sont posés à sa création, puis suivent la variable ; ici la classe est relue après le remplacement de l'objet
      await parcours(page, balise, [['.temoin', 'n.textContent'], ['.ok', 'n.textContent'], ['.ok', 'n.getAttribute(\'data-x\')'], ['.ok', 'n.classList.contains(\'change\')']], [
        ['à la création', null, 'a', 'a', 'a', 'false']
      ], ecarts)
      await parcours(page, balise, [['.temoin', 'n.textContent'], ['.ok', 'n.classList.contains(\'change\')']], [
        ['objet remplacé', 'changer()', 'b', 'true']
      ], ecarts)
    })
  })

  it('{success v} {if} {const d = $obj} : @text=!{d.x} montre la propriété de d, et suit l\'objet qui remplace l\'ancien', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-cs-texte'
    await jouer(balise, async (page, ecarts) => {
      await parcours(page, balise, [['.temoin', 'n.textContent'], ['.ok', 'n.textContent']], [
        ['à la création',  null,        'a', 'a'],
        ['objet remplacé', 'changer()', 'b', 'b']
      ], ecarts)
    })
  })

  it('{for} {if} {const d = r.o} : chaque ligne lit son d, et le relit quand la liste est remplacée', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-cs-pour'
    const TOUS    = '[...n.parentNode.querySelectorAll(\'.ok\')].map((x) => x.textContent).join(\',\')'
    await jouer(balise, async (page, ecarts) => {
      await parcours(page, balise, [['.temoin', 'n.textContent'], ['.temoin', TOUS]], [
        ['à la création',   null,        'témoin', 'a,b'],
        ['liste remplacée', 'changer()', 'témoin', 'c,d']
      ], ecarts)
    })
  })
})
