// `{success}` et `{error}` écrits sans nom, au niveau des branches d'un `{await}`, ouvrent la branche : elle s'affiche à l'arrivée de la promesse (ou à son rejet), comme `{success }`.
// Ils étaient lus comme l'affichage d'une variable `success` / `error` : « success is not defined » dans la page, et le composant tombait dès son montage.
// Une variable `success` ou `error` du composant, affichée par `{success}` hors d'un `{await}` ou plus bas que ses branches (dans une balise, un `{if}`), s'affiche toujours.
// La promesse est tenue par le test (`finir()`), pour que la branche d'attente existe avant l'arrivée.
// Les trois modes : développement, production en fichiers séparés, production en un seul fichier. Chromium réel.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // les deux branches sans nom : la promesse tenue affiche {success}
  'sn-succes.mjs': `<script>
  fin = null
  $p  = new Promise((res) -> fin = res)
  @finir = -> fin('ok')
</script>
{await $p}
  <i class="att">attente</i>
{success}
  <b class="ok">arrivé</b>
{error}
  <s class="ko">raté</s>
{end}
<u class="temoin">témoin</u>
`,
  // les mêmes, la promesse rejetée affiche {error}
  'sn-erreur.mjs': `<script>
  fin = null
  $p  = new Promise((res, rej) -> fin = rej)
  @finir = -> fin(new Error('non'))
</script>
{await $p}
  <i class="att">attente</i>
{success}
  <b class="ok">arrivé</b>
{error}
  <s class="ko">raté</s>
{end}
<u class="temoin">témoin</u>
`,
  // {success} seul : la promesse remplacée réaffiche l'attente
  'sn-succes-seul.mjs': `<script>
  fin = null
  $p  = new Promise((res) -> fin = res)
  @attendre = -> $p = new Promise((res) -> fin = res)
  @finir    = -> fin('ok')
</script>
{await $p}
  <i class="att">attente</i>
{success}
  <b class="ok">arrivé</b>
{end}
<u class="temoin">témoin</u>
`,
  // {error} seul
  'sn-erreur-seule.mjs': `<script>
  fin = null
  $p  = new Promise((res, rej) -> fin = rej)
  @finir = -> fin(new Error('non'))
</script>
{await $p}
  <i class="att">attente</i>
{error}
  <s class="ko">raté</s>
{end}
<u class="temoin">témoin</u>
`,
  // {success v} nommé puis {error} sans nom
  'sn-nommes-a.mjs': `<script>
  fin = null
  $p  = new Promise((res, rej) -> fin = [res, rej])
  @attendre = -> $p = new Promise((res, rej) -> fin = [res, rej])
  @finir    = (x) -> fin[0](x)
  @refuser  = -> fin[1](new Error('non'))
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok">{v}</b>
{error}
  <s class="ko">raté</s>
{end}
<u class="temoin">témoin</u>
`,
  // {success} sans nom puis {error err} nommé
  'sn-nommes-b.mjs': `<script>
  fin = null
  $p  = new Promise((res, rej) -> fin = [res, rej])
  @attendre = -> $p = new Promise((res, rej) -> fin = [res, rej])
  @finir    = -> fin[0]('ok')
  @refuser  = (m) -> fin[1](new Error(m))
</script>
{await $p}
  <i class="att">attente</i>
{success}
  <b class="ok">arrivé</b>
{error err}
  <s class="ko">{err.message}</s>
{end}
<u class="temoin">témoin</u>
`,
  // une variable `success` et une variable `error` : affichées à la racine, dans une balise de la branche d'attente, dans une balise puis dans un {if} de {success}
  'sn-variable.mjs': `<script>
  success = 'bravo'
  error   = 'oups'
  $on     = true
  fin     = null
  $p      = new Promise((res) -> fin = res)
  @finir  = -> fin('ok')
</script>
<p class="v-racine">{success} {error}</p>
{await $p}
  <i class="att">{success}</i>
{success}
  <b class="ok">{success}{if $on} / {error}{end}</b>
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

// le composant est monté quand son témoin est dans l'ombre, ou quand il est tombé (la page montre alors un bandeau d'erreur) : le cas lit ensuite ce qui reste
const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`(() => {
    const h = document.querySelector('${balise}')
    return !!h && (h.classList.contains('mjs-error') || !!(h._shadow && h._shadow.querySelector('.temoin, .mjs-fatal-error')))
  })()`, null, { timeout: 10000 })
  await page.waitForTimeout(150)
}

// un appel sur le composant (`finir()`, `refuser()`…), puis le temps de la mise à jour ; la méthode rend parfois une promesse
// (`attendre()` rend celle qu'elle pose) et `evaluate` l'attendrait : rien n'est rendu à la page
const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(200)
}

// note un écart, sans arrêter le cas : tous les écarts d'un cas sont rendus ensemble
const verifier = (ecarts: string[], quoi: string, lu: unknown, attendu: unknown) => {
  if (lu !== attendu) ecarts.push(`${quoi} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lu) ?? 'rien'}`)
}

// le composant a survécu : un plantage vide son ombre, lui pose la classe `mjs-error` et y met un bandeau `mjs-fatal-error`
const vivant = (page: any, balise: string): Promise<boolean> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  return !h.classList.contains('mjs-error') && !h._shadow.querySelector('.mjs-fatal-error') && !!h._shadow.querySelector('.temoin')
})()`)

// les branches affichées, une classe par branche (`att`, `ok`, `ko`), dans cet ordre ; `rien` quand aucune ne l'est
const branches = (page: any, balise: string): Promise<string> => page.evaluate(`(() => {
  const o = document.querySelector('${balise}')._shadow
  const l = ['att', 'ok', 'ko'].filter((c) => !!o.querySelector('.' + c))
  return l.length ? l.join(' ') : 'rien'
})()`)

// le texte d'une balise de l'ombre, `absente` quand elle n'y est pas
const texte = (page: any, balise: string, sel: string): Promise<string> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  return n ? n.textContent : 'absente'
})()`)

// chaque étape : [nom, appel (ou null), branches affichées attendues] ; le composant est vivant à chaque étape
async function parcours(page: any, balise: string, etapes: Array<[string, string | null, string]>, ecarts: string[]) {
  for (const [nom, appel, attendu] of etapes) {
    if (appel) await regler(page, balise, appel)
    verifier(ecarts, `composant vivant, ${nom}`, await vivant(page, balise), true)
    verifier(ecarts, `branches affichées, ${nom}`, await branches(page, balise), attendu)
  }
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`{success} et {error} sans nom dans un {await} (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test des branches sans nom sauté. Activer : `npx playwright install chromium`'); return }
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

  it('{success} et {error} sans nom : l\'attente d\'abord, puis {success} quand la promesse est tenue', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sn-succes'
    await jouer(B, async (page, ecarts) => {
      await parcours(page, B, [
        ['à la création', null, 'att'],
        ['promesse tenue', 'finir()', 'ok']
      ], ecarts)
      verifier(ecarts, 'texte de {success}', await texte(page, B, '.ok'), 'arrivé')
    })
  })

  it('{success} et {error} sans nom : {error} quand la promesse est rejetée', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sn-erreur'
    await jouer(B, async (page, ecarts) => {
      await parcours(page, B, [
        ['à la création', null, 'att'],
        ['promesse rejetée', 'finir()', 'ko']
      ], ecarts)
      verifier(ecarts, 'texte de {error}', await texte(page, B, '.ko'), 'raté')
    })
  })

  it('{success} sans nom seul : la promesse remplacée réaffiche l\'attente, puis la nouvelle promesse affiche {success}', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sn-succes-seul'
    await jouer(B, async (page, ecarts) => {
      await parcours(page, B, [
        ['à la création', null, 'att'],
        ['promesse tenue', 'finir()', 'ok'],
        ['promesse remplacée', 'attendre()', 'att'],
        ['nouvelle promesse tenue', 'finir()', 'ok']
      ], ecarts)
    })
  })

  it('{error} sans nom seul : la promesse rejetée affiche {error}', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sn-erreur-seule'
    await jouer(B, async (page, ecarts) => {
      await parcours(page, B, [
        ['à la création', null, 'att'],
        ['promesse rejetée', 'finir()', 'ko']
      ], ecarts)
    })
  })

  it('{success v} nommé puis {error} sans nom : la valeur s\'affiche, le rejet affiche {error}', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sn-nommes-a'
    await jouer(B, async (page, ecarts) => {
      await parcours(page, B, [
        ['à la création', null, 'att'],
        ['promesse tenue', 'finir(\'valeur\')', 'ok'],
        ['promesse remplacée', 'attendre()', 'att'],
        ['promesse rejetée', 'refuser()', 'ko']
      ], ecarts)
      verifier(ecarts, 'texte de {error}', await texte(page, B, '.ko'), 'raté')
      await regler(page, B, 'attendre()')
      await regler(page, B, 'finir(\'autre\')')
      verifier(ecarts, 'valeur de {success v}', await texte(page, B, '.ok'), 'autre')
    })
  })

  it('{success} sans nom puis {error err} nommé : l\'erreur s\'affiche, la branche sans nom aussi', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sn-nommes-b'
    await jouer(B, async (page, ecarts) => {
      await parcours(page, B, [
        ['à la création', null, 'att'],
        ['promesse tenue', 'finir()', 'ok'],
        ['promesse remplacée', 'attendre()', 'att'],
        ['promesse rejetée « non »', 'refuser(\'non\')', 'ko']
      ], ecarts)
      verifier(ecarts, 'message de l\'erreur', await texte(page, B, '.ko'), 'non')
    })
  })

  it('une variable success et une variable error : affichées par {success} et {error} à la racine, dans une balise de l\'attente, dans une balise puis un {if} de {success}', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sn-variable'
    await jouer(B, async (page, ecarts) => {
      verifier(ecarts, 'composant vivant, à la création', await vivant(page, B), true)
      verifier(ecarts, 'racine', await texte(page, B, '.v-racine'), 'bravo oups')
      verifier(ecarts, 'balise de la branche d\'attente', await texte(page, B, '.att'), 'bravo')
      verifier(ecarts, 'branches avant l\'arrivée', await branches(page, B), 'att')
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
      verifier(ecarts, 'branches après l\'arrivée', await branches(page, B), 'ok')
      verifier(ecarts, 'balise et {if} de la branche {success}', await texte(page, B, '.ok'), 'bravo / oups')
      verifier(ecarts, 'racine, après l\'arrivée', await texte(page, B, '.v-racine'), 'bravo oups')
    })
  })
})
