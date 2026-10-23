// un `@attach` posé dans une branche nommée d'un `{await}` (`{success v}`, `{error err}`) et qui lit une variable (ou un `{const}` qui en lit une) est appelé UNE fois quand la branche apparaît :
// la fabrique n'est pas appelée deux fois, son nettoyage ne court pas pour rien (avant : pose à la création de la branche, nettoyage, nouvelle pose par l'effet de la passe qui suit le règlement)
// quand la variable change, l'ancienne pose est nettoyée puis la nouvelle est faite, une fois chacune
// le journal de la page note chaque pose et chaque nettoyage (`pose ok clair`, `defait ok clair`) ; le témoin est la même balise hors de `{await}`, dont on lit l'attribut posé
// les trois modes : développement, production en fichiers séparés, production en un seul fichier ; Chromium réel

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

// la fabrique : pose l'attribut `data-marque` et note la pose ; son nettoyage retire l'attribut et note le nettoyage
const FABRIQUE = `  window.__j = []
  marque = (qui, th) -> (n) ->
    window.__j.push('pose ' + qui + ' ' + th)
    n.setAttribute('data-marque', th)
    ->
      window.__j.push('defait ' + qui + ' ' + th)
      n.removeAttribute('data-marque')
  @habiller = (x) -> $theme = x
`

const SOURCES: Record<string, string> = {
  // `{success v}` : un `@attach` qui lit la variable, un autre qui lit un `{const}` qui la lit
  'at-succes.mjs': `<script>
  $theme = 'clair'
  $p     = Promise.resolve({ label: 'A' })
${FABRIQUE}</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {const t = $theme}
  <b class="ok" @attach={marque('ok', $theme)}>{v.label}</b>
  <b class="okc" @attach={marque('okc', t)}>{v.label}</b>
{end}
<u class="temoin" @attach={marque('tem', $theme)}>témoin</u>
`,
  // `{error err}` : la promesse est rejetée après un court délai, pour que le composant la tienne déjà
  'at-erreur.mjs': `<script>
  $theme = 'clair'
  $p     = new Promise((res, rej) -> setTimeout((-> rej('boom')), 40))
${FABRIQUE}</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok">{v}</b>
{error err}
  <b class="ko" @attach={marque('ko', $theme)}>{err}</b>
{end}
<u class="temoin" @attach={marque('tem', $theme)}>témoin</u>
`
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// le composant est monté quand la balise de la branche est dans l'ombre, ou quand il est tombé (la page montre alors un bandeau d'erreur) ; la pose a le temps de se faire
const pret = async (page: any, balise: string, branche: string) => {
  await page.waitForFunction(`(() => {
    const h = document.querySelector('${balise}')
    return !!h && (h.classList.contains('mjs-error') || !!(h._shadow && h._shadow.querySelector('${branche}, .mjs-fatal-error')))
  })()`, null, { timeout: 10000 })
  await page.waitForTimeout(300)
}

// le composant a survécu : un plantage vide son ombre, lui pose la classe `mjs-error` et y met un bandeau `mjs-fatal-error`
const vivant = (page: any, balise: string): Promise<boolean> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  return !h.classList.contains('mjs-error') && !h._shadow.querySelector('.mjs-fatal-error') && !!h._shadow.querySelector('.temoin')
})()`)

// l'attribut `data-marque` du témoin, ou `absente`
const marque = (page: any, balise: string): Promise<string> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('.temoin')
  return n ? String(n.getAttribute('data-marque')) : 'absente'
})()`)

// les entrées du journal de la page qui parlent de `qui` (`pose ok clair`, `defait ok clair`…), dans l'ordre
const journal = async (page: any, qui: string): Promise<string[]> => {
  const tout = await page.evaluate('window.__j.slice()') as string[]
  return tout.filter((e) => e.split(' ')[1] === qui)
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`un @attach d'une branche nommée de {await} n'est posé qu'une fois à la création (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de la pose des @attach de branche sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre le composant, joue le scénario, puis exige qu'aucun écart n'ait été noté et qu'aucune erreur n'ait été dite par la page
  const jouer = async (balise: string, branche: string, scenario: (page: any, ecarts: string[]) => Promise<void>) => {
    const o      = await charger(browser, await cible(mode), balise)
    const ecarts = [] as string[]
    try {
      await pret(o.page, balise, branche)
      assert.equal(await vivant(o.page, balise), true, 'le composant est tombé')
      assert.equal(await marque(o.page, balise), 'clair', 'le témoin hors de {await} est faux : le test lui-même est à revoir')
      await scenario(o.page, ecarts)
      assert.deepEqual([...ecarts, ...graves(o).map((g) => `erreur de la page : ${g}`)], [])
    } finally {
      await o.fermer()
    }
  }

  // le journal de `qui` est celui qu'on attend
  const verifier = async (page: any, ecarts: string[], qui: string, etape: string, attendu: string[]) => {
    const lu = await journal(page, qui)
    if (lu.join(' | ') !== attendu.join(' | ')) ecarts.push(`${qui}, ${etape} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lu)}`)
  }

  const habiller = async (page: any, balise: string, theme: string) => {
    await page.evaluate(`(() => { document.querySelector('${balise}').habiller('${theme}'); return null })()`)
    await page.waitForTimeout(250)
    assert.equal(await vivant(page, balise), true, 'le composant est tombé')
    assert.equal(await marque(page, balise), theme, 'le témoin hors de {await} est faux : le test lui-même est à revoir')
  }

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it('{success v} : @attach={marque($theme)} et @attach={marque(t)} avec {const t = $theme} : une pose à la création, puis un nettoyage et une pose par changement', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-at-succes'
    await jouer(balise, '.ok', async (page, ecarts) => {
      for (const qui of ['ok', 'okc']) await verifier(page, ecarts, qui, 'à la création', [`pose ${qui} clair`])
      await habiller(page, balise, 'sombre')
      for (const qui of ['ok', 'okc']) await verifier(page, ecarts, qui, 'thème sombre', [`pose ${qui} clair`, `defait ${qui} clair`, `pose ${qui} sombre`])
      await habiller(page, balise, 'nuit')
      for (const qui of ['ok', 'okc']) await verifier(page, ecarts, qui, 'thème nuit', [`pose ${qui} clair`, `defait ${qui} clair`, `pose ${qui} sombre`, `defait ${qui} sombre`, `pose ${qui} nuit`])
    })
  })

  it('{error err} : @attach={marque($theme)} : une pose à la création, puis un nettoyage et une pose par changement', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-at-erreur'
    await jouer(balise, '.ko', async (page, ecarts) => {
      await verifier(page, ecarts, 'ko', 'à la création', ['pose ko clair'])
      await habiller(page, balise, 'sombre')
      await verifier(page, ecarts, 'ko', 'thème sombre', ['pose ko clair', 'defait ko clair', 'pose ko sombre'])
    })
  })
})
