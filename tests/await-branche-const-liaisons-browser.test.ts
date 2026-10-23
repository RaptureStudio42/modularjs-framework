// un `{const}` de la branche `{success}` qui lit une variable (`{const t = $theme}`) fait suivre cette variable aux liaisons qui le lisent : l'effet que la branche pose à la racine
// recrée le `{const}` avant de lire la liaison, il doit donc aussi se réveiller quand la variable que ce `{const}` lit change. Sans cela l'effet est posé sans variable (ou ne suit que les
// variables écrites dans la liaison elle-même) et la liaison reste sur la valeur d'avant. Trois liaisons : `@attach={marque(t)}` (l'effet n'était même pas posé, l'expression ne lit aucune
// variable), `value=!{c.x}` d'un champ de saisie et `@group=!{eta.choix}` d'une case radio, avec `{const c = $obj}` / `{const eta = $etat}`.
// Même règle pour les liaisons qui n'ont pas le même chemin : `@text=!{c.x}` et `@html=!{c.h}` d'une balise éditable, `@emit.ok={c.x}` (l'événement repart
// avec la nouvelle valeur) et les props et attributs natifs d'un `<@module>` (`x={c.x}`, `data-v={c.x}`).
// Chaque cas a son témoin, la même balise hors de `{await}` : un témoin faux dirait que le test lui-même est faux, il arrête donc le cas aussitôt.
// Les trois modes : développement, production en fichiers séparés, production en un seul fichier. Chromium réel.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // `@attach` : la fabrique lit le `{const}`, et lui seul ; elle est rappelée quand le thème change, le nettoyage de la pose d'avant efface sa marque
  'ac-attache.mjs': `<script>
  $theme = 'clair'
  $p     = Promise.resolve({ label: 'A' })
  marque = (th) -> (n) ->
    n.setAttribute('data-marque', th)
    -> n.removeAttribute('data-marque')
  @habiller = (x) -> $theme = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {const t = $theme}
  <b class="ok" @attach={marque(t)}>{v.label}</b>
{end}
<u class="temoin" @attach={marque($theme)}>témoin</u>
`,
  // liaison deux sens d'un champ de saisie : le champ montre la propriété du `{const}`, que la variable remplace
  'ac-valeur.mjs': `<script>
  $obj = { x: 'a' }
  $p   = Promise.resolve({ nom: 'N' })
  @changer = -> $obj = { x: 'b' }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {const c = $obj}
  <input class="ok" aria-label="x" value=!{c.x}>
{end}
<input class="temoin" aria-label="x" value=!{$obj.x}>
`,
  // liaison de groupe de cases radio : la case cochée suit la propriété du `{const}`
  'ac-groupe.mjs': `<script>
  $etat = { choix: 'a' }
  $p    = Promise.resolve({ nom: 'N' })
  @changer = -> $etat = { choix: 'b' }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {const eta = $etat}
  <input class="ra" aria-label="a" type="radio" value="a" @group=!{eta.choix}>
  <input class="rb" aria-label="b" type="radio" value="b" @group=!{eta.choix}>
{end}
<input class="temoin" aria-label="a" type="radio" value="a" @group=!{$etat.choix}>
`,
  // texte d'une balise éditable : il suit la propriété du `{const}`, que la variable remplace
  'ac-texte.mjs': `<script>
  $obj = { x: 'a' }
  $p   = Promise.resolve({ nom: 'N' })
  @changer = -> $obj = { x: 'b' }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {const c = $obj}
  <div class="ok" contenteditable="true" @text=!{c.x}></div>
{end}
<div class="temoin" contenteditable="true" @text=!{$obj.x}></div>
`,
  // HTML d'une balise éditable : même chose
  'ac-html.mjs': `<script>
  $obj = { h: '<i>a</i>' }
  $p   = Promise.resolve({ nom: 'N' })
  @changer = -> $obj = { h: '<b>b</b>' }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {const c = $obj}
  <div class="ok" contenteditable="true" @html=!{c.h}></div>
{end}
<div class="temoin" contenteditable="true" @html=!{$obj.h}></div>
`,
  // événement : il repart avec la valeur du `{const}` quand la variable est remplacée ; deux noms, un par balise, pour les compter séparément
  'ac-emit.mjs': `<script>
  $obj = { x: 'a' }
  $p   = Promise.resolve({ nom: 'N' })
  @changer = -> $obj = { x: 'b' }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {const c = $obj}
  <b class="ok" @emit.ok={c.x}>ok</b>
{end}
<u class="temoin" @emit.tem={$obj.x}>témoin</u>
`,
  // module : sa prop (`x`) et son attribut natif (`data-v`) lisent le `{const}` ; l'enfant montre sa prop
  'c-ac-mod.mjs': `<script>
  $x = ''
</script>
<p class="vu">{$x}</p>
`,
  'ac-module.mjs': `<script>
  $comp = 'mjs-c-ac-mod'
  $obj  = { x: 'a' }
  $p    = Promise.resolve({ nom: 'N' })
  @changer = -> $obj = { x: 'b' }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {const c = $obj}
  <@module $comp class="ok" x={c.x} data-v={c.x}></@module>
{end}
<@module $comp class="temoin" x={$obj.x} data-v={$obj.x}></@module>
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

// un appel sur le composant (`habiller('sombre')`…), puis le temps de la mise à jour
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

// les lectures [sélecteur, expression] après chaque geste, le composant vivant à chaque étape ; la première lecture est celle du témoin hors de {await} : fausse, elle arrête le cas aussitôt
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
      if (i === 0) assert.equal(lecture, attendus[0], `le témoin hors de {await} est faux (${nom}) : le test lui-même est à revoir`)
      else if (lecture !== attendus[i]) ecarts.push(`${lectures[i][0]}, ${nom} : attendu ${attendus[i]}, lu ${lecture}`)
    }
  }
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`un {const} de la branche {success} fait suivre sa variable aux liaisons qui le lisent (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test des liaisons à {const} sauté. Activer : `npx playwright install chromium`'); return }
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

  it('@attach={marque(t)} avec {const t = $theme} : la fabrique est rappelée quand le thème change', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-ac-attache'
    await jouer(balise, async (page, ecarts) => {
      const marque = 'n.getAttribute(\'data-marque\')'
      await parcours(page, balise, [['.temoin', marque], ['.ok', marque]], [
        ['à la création',     null,                 'clair',  'clair'],
        ['thème sombre',      'habiller(\'sombre\')', 'sombre', 'sombre'],
        ['thème nuit',        'habiller(\'nuit\')',   'nuit',   'nuit']
      ], ecarts)
    })
  })

  it('value=!{c.x} avec {const c = $obj} : le champ montre la propriété de l\'objet qui remplace l\'ancien', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-ac-valeur'
    await jouer(balise, async (page, ecarts) => {
      await parcours(page, balise, [['.temoin', 'n.value'], ['.ok', 'n.value']], [
        ['à la création', null,         'a', 'a'],
        ['objet remplacé', 'changer()', 'b', 'b']
      ], ecarts)
    })
  })

  it('@group=!{eta.choix} avec {const eta = $etat} : la case cochée suit l\'objet qui remplace l\'ancien', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-ac-groupe'
    await jouer(balise, async (page, ecarts) => {
      await parcours(page, balise, [['.temoin', 'n.checked'], ['.ra', 'n.checked'], ['.rb', 'n.checked']], [
        ['à la création',  null,        'true',  'true',  'false'],
        ['objet remplacé', 'changer()', 'false', 'false', 'true']
      ], ecarts)
    })
  })

  it('@text=!{c.x} avec {const c = $obj} : le texte suit l\'objet qui remplace l\'ancien', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-ac-texte'
    await jouer(balise, async (page, ecarts) => {
      await parcours(page, balise, [['.temoin', 'n.textContent'], ['.ok', 'n.textContent']], [
        ['à la création',  null,        'a', 'a'],
        ['objet remplacé', 'changer()', 'b', 'b']
      ], ecarts)
    })
  })

  it('@html=!{c.h} avec {const c = $obj} : le HTML suit l\'objet qui remplace l\'ancien', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-ac-html'
    await jouer(balise, async (page, ecarts) => {
      await parcours(page, balise, [['.temoin', 'n.innerHTML'], ['.ok', 'n.innerHTML']], [
        ['à la création',  null,        '<i>a</i>', '<i>a</i>'],
        ['objet remplacé', 'changer()', '<b>b</b>', '<b>b</b>']
      ], ecarts)
    })
  })

  it('@emit.ok={c.x} avec {const c = $obj} : l\'événement repart avec la valeur de l\'objet qui remplace l\'ancien', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-ac-emit'
    await jouer(balise, async (page, ecarts) => {
      // les événements sont comptés à partir d'ici : ceux de la création sont déjà partis
      await page.evaluate(`(() => { window.__emis = []; const h = document.querySelector('${balise}'); for (const nom of ['ok', 'tem']) h.addEventListener(nom, (e) => window.__emis.push(nom + ':' + e.data)); return null })()`)
      await regler(page, balise, 'changer()')
      assert.equal(await vivant(page, balise), true, 'le composant est tombé')
      const emis = await page.evaluate('window.__emis.slice().sort()') as string[]
      assert.deepEqual(emis.filter((e) => e.startsWith('tem:')), ['tem:b'], 'le témoin hors de {await} est faux : le test lui-même est à revoir')
      const ok = emis.filter((e) => e.startsWith('ok:'))
      if (ok.join(' ') !== 'ok:b') ecarts.push(`@emit.ok, objet remplacé : attendu ["ok:b"], lu ${JSON.stringify(ok)}`)
    })
  })

  it('<@module $comp x={c.x} data-v={c.x}> avec {const c = $obj} : la prop et l\'attribut natif suivent l\'objet qui remplace l\'ancien', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-ac-module'
    const VU     = 'n._shadow.querySelector(\'.vu\').textContent'
    const DV     = 'n.getAttribute(\'data-v\')'
    await jouer(balise, async (page, ecarts) => {
      await parcours(page, balise, [['.temoin', VU], ['.ok', VU], ['.temoin', DV], ['.ok', DV]], [
        ['à la création',  null,        'a', 'a', 'a', 'a'],
        ['objet remplacé', 'changer()', 'b', 'b', 'b', 'b']
      ], ecarts)
    })
  })
})
