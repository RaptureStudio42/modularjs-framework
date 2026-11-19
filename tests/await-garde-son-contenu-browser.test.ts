// {await.keep expr} dans un vrai navigateur : la recherche à la frappe garde sa liste pendant la relecture (`µpending` le dit), la met à jour
// sur place à l'arrivée (la ligne gardée est la même balise, son champ tapé reste), la lecture dépassée a son signal annulé et sa réponse
// tardive n'écrase rien. Reprise d'une page servie : en `markers`, le contenu rendu par le serveur reste à l'écran sous `keep` jusqu'à
// l'arrivée de la lecture du navigateur, et part aussitôt sans `keep` (l'attente s'affiche) ; `replace` reconstruit la vue dans les deux cas.
// Sans option, l'attente refaite par une relecture reçoit son attache réactive (`@attach`), comme avant
// Un composant construit pour le développement, chargé sur un cœur qui n'a pas ses options (retirées comme d'un cœur de production), le dit,
// une fois par option, et s'affiche quand même
// les lectures du navigateur sont tenues par la page (`__tenir`, posé avant le composant) ; le serveur, lui, répond tout de suite
// Chromium, Firefox et WebKit ; développement et production (un seul fichier)

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const recherche = (option: string) => `<script>
  $q = 'a'
  chercher = (q, signal) -> if globalThis.__tenir then globalThis.__tenir(q, signal) else Promise.resolve([{ id: 1, pseudo: 'Ann' }, { id: 2, pseudo: 'Bob' }])
</script>
<input aria-label="recherche" class="q" value=!{$q}>
{await${option} chercher($q, µsignal)}
  <p class="att">Chargement</p>
{success membres}
  <p class="busy" hidden={not µpending}>Mise à jour</p>
  <ul>
  {for m in membres by id}
    <li class="m">{m.pseudo}<input aria-label="note" class="note"></li>
  {end}
  </ul>
{end}
`
const ATTACHE = `<script>
  $theme = 'clair'
  $p     = new Promise(->)
  window.__poses = []
  marque = (th) -> (n) ->
    window.__poses.push('pose ' + th)
    n.setAttribute('data-marque', th)
    ->
      window.__poses.push('defait ' + th)
  @relancer = -> $p = new Promise(->)
</script>
{await $p}
  <i class="att" :attach={marque($theme)}>attente</i>
{success}
  <b>ok</b>
{end}
`
const SOURCES: Record<string, string> = { 'agb-garde.mjs': recherche('.keep'), 'agb-sans.mjs': recherche(''), 'agb-attache.mjs': ATTACHE }
const BALISES = ['mjs-agb-garde', 'mjs-agb-sans', 'mjs-agb-attache']

// les lectures du navigateur attendent le test : `__appels[i].ok(valeur)`, ou `.ko(erreur)`
const TENIR = `<script>window.__appels = []; window.__tenir = (q, signal) => new Promise((ok, ko) => window.__appels.push({ q, signal, ok, ko }))</script>`
const tenue = (c: Cible): Cible => ({ ...c, document: (b, v) => c.document(b, v).replace('<body>', '<body>' + TENIR) })

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// ce que montre le composant : les pseudos des lignes, l'attente, « en cours », le champ de la ligne marquée et son identité
const lire = (page: any, balise: string) => page.evaluate(`(() => {
  const r = document.querySelector('${balise}')._shadow
  const lignes = Array.from(r.querySelectorAll('.m'))
  const marquee = lignes.find((l) => l.__marque)
  return { pseudos: lignes.map((l) => l.textContent.trim()).join(','), attente: !!r.querySelector('.att'), pending: r.querySelector('.busy') ? !r.querySelector('.busy').hidden : null, marquee: marquee ? marquee.querySelector('.note').value : null }
})()`)
const page$ = (page: any, js: string) => page.evaluate(`(() => { ${js}; return null })()`)
const attendre = (page: any, js: string) => page.waitForFunction(js, null, { timeout: 10000 })
const taper = async (page: any, balise: string, q: string) => {
  await page$(page, `const i = document.querySelector('${balise}')._shadow.querySelector('.q'); i.value = '${q}'; i.dispatchEvent(new Event('input', { bubbles: true, composed: true }))`)
  await page.waitForTimeout(80)
}

const moteurs = ['chromium', 'firefox', 'webkit'] as const

for (const moteur of moteurs) describe(`{await … keep} dans le navigateur (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { console.log(`  ℹ️  ${moteur} non installé, test sauté`); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev-parents-avant', 'bundle'] as const) it(`la recherche à la frappe (${mode})`, async function () {
    if (!browser) { this.skip(); return }
    const B = 'mjs-agb-garde'
    const o = await charger(browser, tenue(await cible(mode)), B)
    try {
      const p = o.page
      await attendre(p, 'window.__appels.length === 1')
      await page$(p, `window.__appels[0].ok([{ id: 1, pseudo: 'Ann' }, { id: 2, pseudo: 'Bob' }])`)
      await attendre(p, `document.querySelector('${B}')._shadow.querySelectorAll('.m').length === 2`)
      await page$(p, `const l = document.querySelector('${B}')._shadow.querySelectorAll('.m')[1]; l.__marque = 1; l.querySelector('.note').value = 'à rappeler'`)
      assert.deepEqual(await lire(p, B), { pseudos: 'Ann,Bob', attente: false, pending: false, marquee: 'à rappeler' })
      await taper(p, B, 'b')
      assert.deepEqual(await lire(p, B), { pseudos: 'Ann,Bob', attente: false, pending: true, marquee: 'à rappeler' }, 'pendant la relecture, la liste reste et µpending est vrai')
      await taper(p, B, 'bo')
      assert.equal(await p.evaluate('window.__appels.length'), 3)
      assert.equal(await p.evaluate('window.__appels[1].signal.aborted'), true, 'la lecture dépassée est annulée')
      await page$(p, `window.__appels[2].ok([{ id: 2, pseudo: 'Bob' }, { id: 3, pseudo: 'Cyd' }])`)
      await attendre(p, `document.querySelector('${B}')._shadow.querySelector('.m').textContent.trim() === 'Bob'`)
      assert.deepEqual(await lire(p, B), { pseudos: 'Bob,Cyd', attente: false, pending: false, marquee: 'à rappeler' }, 'mise à jour sur place : la ligne de Bob et son champ restent')
      await page$(p, `window.__appels[1].ok([{ id: 9, pseudo: 'Vieux' }])`)
      await p.waitForTimeout(150)
      assert.equal((await lire(p, B)).pseudos, 'Bob,Cyd', 'la réponse dépassée, arrivée en dernier, n\'écrase rien')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })

  for (const mode of ['dev-parents-avant', 'bundle'] as const) it(`sans option : l'attente refaite par une relecture reçoit son attache (${mode})`, async function () {
    if (!browser) { this.skip(); return }
    const B = 'mjs-agb-attache'
    const o = await charger(browser, await cible(mode), B)
    try {
      const p = o.page
      const marque = `document.querySelector('${B}')._shadow.querySelector('.att')?.getAttribute('data-marque') ?? 'aucune'`
      await attendre(p, `${marque} === 'clair'`)
      await page$(p, `document.querySelector('${B}').relancer()`)
      await p.waitForTimeout(80)
      assert.equal(await p.evaluate(marque), 'clair', 'l\'attente refaite porte son attache')
      const poses: string[] = await p.evaluate('window.__poses')
      assert.equal(poses.filter((j) => j.startsWith('pose')).length - poses.filter((j) => j.startsWith('defait')).length, 1, 'une seule attache vivante : ' + poses.join(', '))
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })

  it('un composant construit pour le développement, sur un cœur sans ses options : il le dit, une fois par option, et s\'affiche', async function () {
    if (!browser) { this.skip(); return }
    const { stripEsm } = await import('../src/server/renderToString.js')
    const c      = await cible('dev-parents-avant')
    const fichier = readdirSync(join(c.racine, 'out')).find((f) => /^mjs_core-.*\.js$/.test(f))!
    const coeur   = stripEsm(readFileSync(join(c.racine, 'out', fichier), 'utf-8'))
    const sans    = coeur.replace(/^[ \t]*\/\/ <(wait-kept|wait-pending|wait-signal)>\n[\s\S]*?^[ \t]*\/\/ <\/\1>\n/gm, '')
    assert.ok(sans !== coeur && !/_mjs_awaitHas/.test(sans), 'les trois blocs retirés du cœur de la page')
    const B = 'mjs-agb-garde'
    const o = await charger(browser, tenue({ ...c, document: (b, v) => c.document(b, v).replace(coeur, () => sans) }), B)
    try {
      const p = o.page
      await attendre(p, 'window.__appels.length === 1')
      await page$(p, `window.__appels[0].ok([{ id: 1, pseudo: 'Ann' }])`)
      await attendre(p, `document.querySelector('${B}')._shadow.querySelectorAll('.m').length === 1`)
      await taper(p, B, 'b')
      const dits = o.avis.filter((a) => a.includes('est ignoré'))
      for (const option of ['{await.keep}', 'µpending', 'µsignal']) assert.equal(dits.filter((a) => a.includes(`${option} est ignoré`)).length, 1, `${option} : dit une fois — ${JSON.stringify(o.avis)}`)
      assert.deepEqual(o.erreurs, [], 'aucune erreur de page')
    } finally {
      await o.fermer()
    }
  })

  for (const variante of ['markers', 'replace']) for (const [B, garde] of [['mjs-agb-garde', true], ['mjs-agb-sans', false]] as const) it(`page servie, ${variante}, ${garde ? 'avec' : 'sans'} keep`, async function () {
    if (!browser) { this.skip(); return }
    const o = await charger(browser, tenue(await cible('ssr')), B, variante)
    try {
      const p = o.page
      await attendre(p, `window.__appels.length === 1 && !!document.querySelector('${B}')._shadow`)
      await p.waitForTimeout(100)
      const avant = await lire(p, B)
      if (variante === 'markers' && garde) assert.deepEqual([avant.pseudos, avant.attente], ['Ann,Bob', false], 'sous keep, le contenu servi reste pendant la lecture du navigateur')
      else assert.deepEqual([avant.pseudos, avant.attente], ['', true], 'l\'attente s\'affiche pendant la lecture du navigateur')
      await page$(p, `window.__appels[0].ok([{ id: 1, pseudo: 'Ann' }, { id: 3, pseudo: 'Cyd' }])`)
      await attendre(p, `document.querySelector('${B}')._shadow.querySelectorAll('.m').length === 2 && !document.querySelector('${B}')._shadow.querySelector('.att')`)
      assert.equal((await lire(p, B)).pseudos, 'Ann,Cyd', 'à l\'arrivée, la branche du navigateur')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
})
