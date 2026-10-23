// rendu serveur puis reprise dans un navigateur réel (les quatre modes de reprise : markers, positional, diff, replace) d'un `{await}` dont la
// branche affichée par le serveur porte un `@class` / `@style` qui lit la valeur de la branche : le HTML du serveur porte la classe et la couleur,
// la reprise ne fait pas tomber le composant (les nœuds du serveur sont repris alors que la promesse du navigateur n'est pas encore réglée : la
// valeur de la branche n'existe pas encore), puis la classe suit la variable. Même reprise pour un `@attach` et un `@text=!{v.titre}` qui lisent la valeur de la branche,
// et pour un `@attach` qui ne la lit pas (il attend, lui aussi, que la branche soit affichée).
// Chromium réel, composants du projet servis en un seul script.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { VARIANTES, construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // la promesse est réglée avant le rendu serveur : le serveur écrit la branche `{success}` avec sa classe et sa couleur
  'aw-ssr-succes.mjs': `<script>
  $on = true
  $p  = Promise.resolve({ n: 7 })
  @allumer = (x) -> $on = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" @class{v.n > 5 and $on}="actif" @style.color={v.n > 5 ? 'red' : 'blue'}>{v.n}</b>
{end}
<u class="temoin" @class{$on}="actif">témoin</u>
`,
  // la promesse est rejetée avant le rendu serveur : le serveur écrit la branche `{error}`
  'aw-ssr-erreur.mjs': `<script>
  $on = true
  $p  = Promise.reject(new Error('non'))
  @allumer = (x) -> $on = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok">{v}</b>
{error err}
  <b class="ko" @class{err.message === 'non' and $on}="actif" @style.color={err.message === 'non' ? 'red' : 'blue'}>{err.message}</b>
{end}
<u class="temoin" @class{$on}="actif">témoin</u>
`,
  // un `@attach` dont la fabrique lit la valeur de la branche et le thème : le serveur écrit la branche `{success}`, l'attache n'existe que dans le navigateur
  'aw-ssr-attache.mjs': `<script>
  $theme = 'clair'
  $p     = Promise.resolve({ label: 'A' })
  marque = (txt, th) -> (n) ->
    n.setAttribute('data-marque', txt + '/' + th)
    -> n.removeAttribute('data-marque')
  @habiller = (x) -> $theme = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" @attach={marque(v.label, $theme)}>{v.label}</b>
{error err}
  <b class="ko">{err.message}</b>
{end}
<u class="temoin">témoin</u>
`,
  // un `@attach` dont la fabrique ne lit PAS la valeur de la branche : le serveur écrit la branche `{success}`, l'attache n'existe que dans le navigateur ;
  // elle attend que la branche soit affichée (promesse réglée), suit le thème, puis se retire avec la branche
  'aw-ssr-libre.mjs': `<script>
  $theme = 'clair'
  $p     = Promise.resolve({ label: 'A' })
  marque = (th) -> (n) ->
    n.setAttribute('data-marque', th)
    -> n.removeAttribute('data-marque')
  @attendre = -> $p = new Promise(() -> null)
  @habiller = (x) -> $theme = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" @attach={marque($theme)}>{v.label}</b>
{error err}
  <b class="ko">{err.message}</b>
{end}
<u class="temoin">témoin</u>
`,
  // un `@text=!{v.titre}` : le serveur écrit le texte de la valeur dans la balise de la branche `{success}`
  'aw-ssr-texte.mjs': `<script>
  fin = null
  $p  = Promise.resolve({ titre: 'Ada' })
  @attendre = -> $p = new Promise((res) -> fin = res)
  @finir    = (x) -> fin(x)
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <div class="ce" contenteditable="true" @text=!{v.titre}></div>
{error err}
  <b class="ko">{err.message}</b>
{end}
<u class="temoin">témoin</u>
`
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

let construit: Promise<Cible> | null = null
const cible = (): Promise<Cible> => (construit ??= construire('ssr', SOURCES, BALISES))

// l'état d'une balise du composant : sa classe `actif` et sa couleur en ligne, ou null quand elle n'est pas dans la page
const etat = (page: any, balise: string, sel: string): Promise<{ actif: boolean, couleur: string } | null> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  return n ? { actif: n.classList.contains('actif'), couleur: n.style.color } : null
})()`)

// le composant a survécu : un plantage vide son ombre, lui pose la classe `mjs-error` et y met un bandeau `mjs-fatal-error`
const vivant = (page: any, balise: string): Promise<boolean> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  return !h.classList.contains('mjs-error') && !h._shadow.querySelector('.mjs-fatal-error') && !!h._shadow.querySelector('.temoin')
})()`)

// un appel sur le composant, puis le temps de la mise à jour (rien n'est rendu à la page)
const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(200)
}

// ce que lit une expression sur une balise (`n` est la balise : `n.textContent`, `n.getAttribute('data-marque')`…), ou `absente` quand elle n'est pas dans la page
const lu = (page: any, balise: string, sel: string, expr: string): Promise<string> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  return n ? String(${expr}) : 'absente'
})()`)

// note un écart, sans arrêter le cas : tous les écarts d'un cas sont rendus ensemble
const verifier = (ecarts: string[], quoi: string, lu: unknown, attendu: unknown) => {
  if (lu !== attendu) ecarts.push(`${quoi} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lu) ?? 'rien (balise absente)'}`)
}

describe('@class et @style qui lisent la valeur d\'une branche de {await} : rendu serveur puis reprise (Chromium réel)', function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de la reprise des branches de {await} sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const variante of VARIANTES.ssr) for (const [balise, sel, branche, couleur] of [['mjs-aw-ssr-succes', '.ok', '{success}', 'red'], ['mjs-aw-ssr-erreur', '.ko', '{error}', 'red']]) {
    it(`reprise « ${variante} » : la branche ${branche} garde sa classe et sa couleur, le composant reste vivant, la classe suit la variable`, async function () {
      if (!present) { this.skip(); return }
      const c       = await cible()
      const ecarts  = [] as string[]
      const serveur = c.document(balise, variante)
      assert.match(serveur, new RegExp(`<b class="${sel.slice(1)} actif"`), 'le HTML du serveur porte la classe de la branche')
      const o = await charger(browser, c, balise, variante)
      try {
        // un composant tombé à la reprise n'atteint jamais cet état : l'attente cède au bout de cinq secondes et la lecture montre ce qui reste
        await o.page.waitForFunction(`(() => { const h = document.querySelector('${balise}'); return !!h && h._mjs_is_mounted === true && !!h._shadow && !!h._shadow.querySelector('.temoin') })()`, null, { timeout: 5000 }).catch(() => {})
        await o.page.waitForTimeout(300)
        const etapes: Array<[string, string | null, boolean]> = [['après la reprise', null, true], ['$on = false', 'allumer(false)', false], ['$on = true', 'allumer(true)', true]]
        for (const [nom, appel, actif] of etapes) {
          if (appel) await regler(o.page, balise, appel)
          verifier(ecarts, `composant vivant, ${nom}`, await vivant(o.page, balise), true)
          verifier(ecarts, `${sel}, ${nom}`, JSON.stringify(await etat(o.page, balise, sel)), JSON.stringify({ actif, couleur }))
        }
        for (const g of graves(o)) ecarts.push(`la page a dit : ${g}`)
        assert.deepEqual(ecarts, [])
      } finally {
        await o.fermer()
      }
    })
  }

  // la reprise d'un composant dont la branche `{success}` lit sa valeur par un `@attach` ou un `@text` : le HTML du serveur porte la branche, la reprise ne fait pas
  // tomber le composant (la promesse du navigateur n'est pas encore réglée, la valeur n'existe pas encore), puis la liaison suit ; chaque étape lit `.ok` / `.ce`
  const reprendre = async (balise: string, variante: string, motif: RegExp, sel: string, expr: string, etapes: Array<[string, string | null, string]>) => {
    const c       = await cible()
    const ecarts  = [] as string[]
    const serveur = c.document(balise, variante)
    assert.match(serveur, motif, 'le HTML du serveur porte la branche {success}')
    const o = await charger(browser, c, balise, variante)
    try {
      await o.page.waitForFunction(`(() => { const h = document.querySelector('${balise}'); return !!h && h._mjs_is_mounted === true && !!h._shadow && !!h._shadow.querySelector('.temoin') })()`, null, { timeout: 5000 }).catch(() => {})
      await o.page.waitForTimeout(300)
      for (const [nom, appel, attendu] of etapes) {
        if (appel) await regler(o.page, balise, appel)
        verifier(ecarts, `composant vivant, ${nom}`, await vivant(o.page, balise), true)
        verifier(ecarts, `${sel}, ${nom}`, await lu(o.page, balise, sel, expr), attendu)
      }
      for (const g of graves(o)) ecarts.push(`la page a dit : ${g}`)
      assert.deepEqual(ecarts, [])
    } finally {
      await o.fermer()
    }
  }

  for (const variante of VARIANTES.ssr) {
    it(`reprise « ${variante} » : un @attach qui lit la valeur de la branche et une variable ne fait pas tomber le composant, et la marque suit la variable`, async function () {
      if (!present) { this.skip(); return }
      await reprendre('mjs-aw-ssr-attache', variante, /<b class="ok"[^>]*>A<\/b>/, '.ok', 'n.getAttribute(\'data-marque\')', [
        ['après la reprise', null,                   'A/clair'],
        ['$theme = sombre',  'habiller(\'sombre\')', 'A/sombre'],
        ['$theme = clair',   'habiller(\'clair\')',  'A/clair']
      ])
    })

    it(`reprise « ${variante} » : un @attach qui ne lit pas la valeur de la branche attend que la branche soit affichée, suit la variable, puis se retire avec la branche`, async function () {
      if (!present) { this.skip(); return }
      await reprendre('mjs-aw-ssr-libre', variante, /<b class="ok"[^>]*>A<\/b>/, '.ok', 'n.getAttribute(\'data-marque\')', [
        ['après la reprise',           null,                   'clair'],
        ['$theme = sombre',            'habiller(\'sombre\')', 'sombre'],
        ['promesse remplacée',         'attendre()',           'absente'],
        ['$theme = clair, en attente', 'habiller(\'clair\')',  'absente']
      ])
    })

    it(`reprise « ${variante} » : un @text=!{v.titre} ne fait pas tomber le composant, et reprend quand la promesse est remplacée`, async function () {
      if (!present) { this.skip(); return }
      await reprendre('mjs-aw-ssr-texte', variante, /<div class="ce"[^>]*>Ada<\/div>/, '.ce', 'n.textContent', [
        ['après la reprise',      null,                          'Ada'],
        ['promesse remplacée',    'attendre()',                  'absente'],
        ['réglée avec Bob',       'finir({ titre: \'Bob\' })',   'Bob']
      ])
    })
  }
})
