// un `{const}` déclaré dans un `{key}` placé dans une branche `{await}` (ou dans une ligne de `{for}`) se lit dans ce `{key}` : l'interpolation, l'attribut, la classe et la liaison deux sens
// qui le lisent le trouvent déclaré, à la création du bloc comme après le remplacement de la variable qu'il lit
// la déclaration était posée dans un bloc propre, refermé avant la première balise qui la lisait : le composant tombait au montage (« d is not defined »)
// chaque cas a son témoin, la même balise lisant la variable hors du bloc : un témoin faux dirait que le test lui-même est faux, il arrête donc le cas aussitôt
// les trois modes : développement, production en fichiers séparés, production en un seul fichier ; Chromium réel
// à la racine (hors `{await}` et hors `{for}`), un `{const}` reste refusé à la construction, dans un `{key}` comme dans un `{if}`

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { transpile } from '../src/transpiler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // interpolation, attribut et classe d'une balise du `{key}` : tous lisent le `{const}`
  'ck-lecture.mjs': `<script>
  $k   = 1
  $obj = { x: 'a' }
  $p   = Promise.resolve({ nom: 'N' })
  @changer = -> $obj = { x: 'b' }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {key $k}
    {const d = $obj}
    <b class="ok" data-x={d.x} @class{d.x === 'b'}="change">{d.x}</b>
  {end}
{end}
<b class="temoin" data-x={$obj.x} @class{$obj.x === 'b'}="change">{$obj.x}</b>
`,
  // texte d'une balise éditable, en liaison deux sens : il montre la propriété du `{const}`, que la variable remplace
  'ck-texte.mjs': `<script>
  $k   = 1
  $obj = { x: 'a' }
  $p   = Promise.resolve({ nom: 'N' })
  @changer = -> $obj = { x: 'b' }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {key $k}
    {const d = $obj}
    <div class="ok" contenteditable="true" @text=!{d.x}></div>
  {end}
{end}
<div class="temoin" contenteditable="true" @text=!{$obj.x}></div>
`,
  // des blocs l'un dans l'autre (`{key}`, `{if}`, `{key}`), un `{const}` à chaque niveau : chacun lit celui du dessus, à la création comme dans les effets de classe
  'ck-imbrique.mjs': `<script>
  $k   = 1
  $on  = true
  $obj = { x: 'a' }
  $p   = Promise.resolve({ nom: 'N' })
  @changer = -> $obj = { x: 'b' }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {key $k}
    {const d = $obj}
    <b class="n0">{d.x}</b>
    {if $on}
      {const mi = d.x + '!'}
      <b class="n1" data-mi={mi} @class{mi === 'b!'}="change">{d.x}{mi}</b>
      {key $on}
        {const bas = mi + '?'}
        <b class="n2" data-bas={bas} @class{bas === 'b!?'}="change">{d.x}{mi}{bas}</b>
      {end}
    {end}
  {end}
{end}
<b class="temoin">{$obj.x}</b>
`,
  // le même `{key}` dans une ligne de `{for}` : le chemin des blocs est le même que sous `{await}` ; la clé d'une ligne peut changer, le bloc est alors recréé
  'ck-pour.mjs': `<script>
  $rows = [{ id: 1, k: 1, o: { x: 'a' } }, { id: 2, k: 1, o: { x: 'b' } }]
  @changer = -> $rows = [{ id: 1, k: 1, o: { x: 'c' } }, { id: 2, k: 1, o: { x: 'd' } }]
  @recreer = -> $rows = [{ id: 1, k: 2, o: { x: 'e' } }, { id: 2, k: 2, o: { x: 'f' } }]
</script>
{for r in $rows by id}
  {key r.k}
    {const d = r.o}
    <b class="ok" data-x={d.x} @class{d.x === 'e'}="recree">{d.x}</b>
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

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`un {const} déclaré dans un {key} se lit dans ce {key} (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test du {const} dans un {key} sauté. Activer : `npx playwright install chromium`'); return }
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

  it('{success v} {key} {const d = $obj} : l\'interpolation, l\'attribut et la classe lisent d à la création, la classe suit l\'objet qui remplace l\'ancien', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-ck-lecture'
    await jouer(balise, async (page, ecarts) => {
      // le texte, l'attribut et la classe d'un bloc sont posés à sa création, puis suivent la variable ; ici la classe est relue après le remplacement de l'objet
      await parcours(page, balise, [['.temoin', 'n.textContent'], ['.ok', 'n.textContent'], ['.ok', 'n.getAttribute(\'data-x\')'], ['.ok', 'n.classList.contains(\'change\')']], [
        ['à la création', null, 'a', 'a', 'a', 'false']
      ], ecarts)
      await parcours(page, balise, [['.temoin', 'n.textContent'], ['.ok', 'n.classList.contains(\'change\')']], [
        ['objet remplacé', 'changer()', 'b', 'true']
      ], ecarts)
    })
  })

  it('{success v} {key} {const d = $obj} : @text=!{d.x} montre la propriété de d, et suit l\'objet qui remplace l\'ancien', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-ck-texte'
    await jouer(balise, async (page, ecarts) => {
      await parcours(page, balise, [['.temoin', 'n.textContent'], ['.ok', 'n.textContent']], [
        ['à la création',  null,        'a', 'a'],
        ['objet remplacé', 'changer()', 'b', 'b']
      ], ecarts)
    })
  })

  it('{success v} {key} {if} {key}, un {const} par niveau : chacun lit celui du dessus, et les classes suivent l\'objet qui remplace l\'ancien', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-ck-imbrique'
    const CHANGE = 'n.classList.contains(\'change\')'
    await jouer(balise, async (page, ecarts) => {
      await parcours(page, balise, [
        ['.temoin', 'n.textContent'], ['.n0', 'n.textContent'], ['.n1', 'n.textContent'], ['.n1', 'n.getAttribute(\'data-mi\')'], ['.n2', 'n.textContent'], ['.n2', 'n.getAttribute(\'data-bas\')'], ['.n1', CHANGE], ['.n2', CHANGE]
      ], [
        ['à la création', null, 'a', 'a', 'aa!', 'a!', 'aa!a!?', 'a!?', 'false', 'false']
      ], ecarts)
      await parcours(page, balise, [['.temoin', 'n.textContent'], ['.n1', CHANGE], ['.n2', CHANGE]], [
        ['objet remplacé', 'changer()', 'b', 'true', 'true']
      ], ecarts)
    })
  })

  it('{for} {key} {const d = r.o} : chaque ligne lit son d, le relit quand la liste est remplacée, et dans le bloc recréé quand sa clé change', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-ck-pour'
    // de chaque ligne `.ok` : le texte, l'attribut, et si la classe `recree` y est
    const TEXTES  = '[...n.parentNode.querySelectorAll(\'.ok\')].map((x) => x.textContent).join(\',\')'
    const ATTRS   = '[...n.parentNode.querySelectorAll(\'.ok\')].map((x) => x.getAttribute(\'data-x\')).join(\',\')'
    const CLASSES = '[...n.parentNode.querySelectorAll(\'.ok\')].map((x) => x.classList.contains(\'recree\')).join(\',\')'
    await jouer(balise, async (page, ecarts) => {
      await parcours(page, balise, [['.temoin', 'n.textContent'], ['.temoin', TEXTES], ['.temoin', ATTRS], ['.temoin', CLASSES]], [
        ['à la création',   null,        'témoin', 'a,b', 'a,b', 'false,false'],
        ['liste remplacée', 'changer()', 'témoin', 'c,d', 'c,d', 'false,false'],
        ['clé changée',     'recreer()', 'témoin', 'e,f', 'e,f', 'true,false']
      ], ecarts)
    })
  })
})

// hors d'une branche `{await}` et d'une ligne de `{for}`, la déclaration n'a pas de corps où se tenir : refus à la construction, avec le message du `{const}` hors `{for}`
const HAUT = ['<script>', '  $k   = 1', '  $on  = true', '  $obj = { x: \'a\' }', '  $p   = Promise.resolve(1)', '  $l   = [{ id: 1, k: 1, o: { x: \'a\' } }]', '</script>']

// le message de la construction d'un gabarit, ou null quand il se compile
async function refus(corps: string[]): Promise<string | null> {
  try { await transpile([...HAUT, ...corps].join('\n') + '\n', { moduleName: 'clef' }) }
  catch (e: any) { return String(e.message ?? e) }
  return null
}

describe('un {const} dans un {key} : refusé à la racine, permis dans une branche {await} et dans une ligne de {for}', () => {
  afterEach(() => setMessagesLang('fr'))

  const REFUSES: Array<[string, string[]]> = [
    ['un {key} de la racine', ['{key $k}', '  {const d = $obj}', '  <b>{d.x}</b>', '{end}']],
    ['un {key} placé dans un {if} de la racine', ['{if $on}', '  {key $k}', '    {const d = $obj}', '    <b>{d.x}</b>', '  {end}', '{end}']],
    ['un {if} de la racine, pour mémoire', ['{if $on}', '  {const d = $obj}', '  <b>{d.x}</b>', '{end}']]
  ]

  for (const [lieu, corps] of REFUSES) {
    it(`dans ${lieu} : refusé, avec le message du {const} hors {for}`, async () => {
      const message = await refus(corps)
      assert.notEqual(message, null, 'le gabarit se compilait sans erreur')
      assert.match(message!, /\{const d = …\} hors d'un \{for\} n'est pas supporté/)
    })
  }

  const PERMIS: Array<[string, string[]]> = [
    ['un {key} de la racine sans {const}', ['{key $k}', '  <b>{$obj.x}</b>', '{end}']],
    ['un {key} de la branche {success}', ['{await $p}', '  <i>attente</i>', '{success v}', '  {key $k}', '    {const d = $obj}', '    <b>{d.x}</b>', '  {end}', '{end}']],
    ['un {key} de la branche d\'attente', ['{await $p}', '  {key $k}', '    {const d = $obj}', '    <b>{d.x}</b>', '  {end}', '{success v}', '  <b>{v}</b>', '{end}']],
    ['un {key} de la branche {error}', ['{await $p}', '  <i>attente</i>', '{success v}', '  <b>{v}</b>', '{error err}', '  {key $k}', '    {const d = $obj}', '    <b>{d.x}</b>', '  {end}', '{end}']],
    ['un {key} placé dans un {if} de la branche {success}', ['{await $p}', '  <i>attente</i>', '{success v}', '  {if $on}', '    {key $k}', '      {const d = $obj}', '      <b>{d.x}</b>', '    {end}', '  {end}', '{end}']],
    ['un {key} d\'une ligne de {for}', ['{for r in $l by id}', '  {key r.k}', '    {const d = r.o}', '    <b>{d.x}</b>', '  {end}', '{end}']]
  ]

  for (const [lieu, corps] of PERMIS) {
    it(`dans ${lieu} : se compile`, async () => {
      assert.equal(await refus(corps), null)
    })
  }
})
