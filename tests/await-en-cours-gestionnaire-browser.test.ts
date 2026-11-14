// `µpending` lu par un gestionnaire dans l'interpolation d'une chaîne double (`"état #{µpending}"`), sous {await.keep …}, dans un vrai
// navigateur : faux avant une relecture, vrai pendant, comme lu dans le code (`['nu', µpending]`) ; un `{const}` de la branche qui
// l'interpole, recalculé dans le gestionnaire, aussi.
// Script en Civet, en CoffeeScript et en JavaScript ; développement et production ;
// Chromium, Firefox et WebKit. Les lectures du navigateur sont tenues par la page (`__tenir`, posé avant le composant)

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const SCRIPTS: Record<string, string> = {
  civet:  `<script>\n  $q = 'a'\n  window.__logs = []\n  chercher = (q) -> if globalThis.__tenir then globalThis.__tenir(q) else Promise.resolve([{ id: 1, pseudo: 'Ann' }])\n</script>`,
  coffee: `<script lang="coffee">\n  $q = 'a'\n  window.__logs = []\n  chercher = (q) -> if globalThis.__tenir then globalThis.__tenir(q) else Promise.resolve([{ id: 1, pseudo: 'Ann' }])\n</script>`,
  js:     `<script lang="js">\n  $q = 'a'\n  window.__logs = []\n  const chercher = (q) => globalThis.__tenir ? globalThis.__tenir(q) : Promise.resolve([{ id: 1, pseudo: 'Ann' }])\n</script>`
}

// `constante` : le {const} de la branche et le bouton qui le lit
const composant = (script: string, constante: boolean) => `${script}
<input aria-label="recherche" class="q" value=!{$q}>
{await.keep chercher($q)}
  <p class="att">Chargement</p>
{success membres}
${constante ? '  {const etat = "état #{µpending}"}\n' : ''}  <button class="b" @click={window.__logs.push ['nu', µpending]}>1</button>
  <button class="b" @click={window.__logs.push ['chaine', "état #{µpending}"]}>2</button>
${constante ? '  <button class="b" @click={window.__logs.push [\'const\', etat]}>3</button>\n' : ''}  <ul>
  {for m in membres by id}
    <li class="m">{m.pseudo}</li>
  {end}
  </ul>
{end}
`
const sources = (constante: boolean) => Object.fromEntries(Object.entries(SCRIPTS).map(([lang, script]) => [`agp-${lang}.mjs`, composant(script, constante)]))
const BALISES = Object.keys(SCRIPTS).map((lang) => `mjs-agp-${lang}`)

const CONSTRUCTIONS = { 'civet, développement': () => construire('dev-parents-avant', sources(true), BALISES), 'civet, production': () => construire('bundle', sources(true), BALISES)}
const cibles = new Map<string, Promise<Cible>>()
const cible  = (nom: keyof typeof CONSTRUCTIONS) => {
  if (!cibles.has(nom)) cibles.set(nom, CONSTRUCTIONS[nom]())
  return cibles.get(nom)!
}

// les lectures du navigateur attendent le test : `__appels[i].ok(valeur)`
const TENIR = `<script>window.__appels = []; window.__tenir = (q) => new Promise((ok) => window.__appels.push({ q, ok }))</script>`
const tenue = (c: Cible): Cible => ({ ...c, document: (b, v) => c.document(b, v).replace('<body>', '<body>' + TENIR) })
const page$ = (page: any, js: string) => page.evaluate(`(() => { ${js}; return null })()`)

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`µpending dans l'interpolation d'une chaîne d'un gestionnaire (${moteur} réel)`, function () {
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

  for (const construction of Object.keys(CONSTRUCTIONS) as Array<keyof typeof CONSTRUCTIONS>) it(`faux avant une relecture, vrai pendant, script en Civet, CoffeeScript et JavaScript (gabarit ${construction})`, async function () {
    if (!browser) { this.skip(); return }
    const constante = !construction.startsWith('js')
    for (const B of BALISES) {
      const o = await charger(browser, tenue(await cible(construction)), B)
      try {
        const p = o.page
        const ombre = `document.querySelector('${B}')._shadow`
        await p.waitForFunction('window.__appels && window.__appels.length === 1', null, { timeout: 10000 })
        await page$(p, `window.__appels[0].ok([{ id: 1, pseudo: 'Ann' }])`)
        await p.waitForFunction(`${ombre}.querySelectorAll('.m').length === 1`, null, { timeout: 10000 })
        await page$(p, `${ombre}.querySelectorAll('.b').forEach((b) => b.click())`)
        await page$(p, `const i = ${ombre}.querySelector('.q'); i.value = 'b'; i.dispatchEvent(new Event('input', { bubbles: true, composed: true }))`)
        await p.waitForFunction('window.__appels.length === 2', null, { timeout: 10000 })
        await page$(p, `${ombre}.querySelectorAll('.b').forEach((b) => b.click())`)
        const lu = (en: boolean) => [['nu', en], ['chaine', `état ${en}`], ...(constante ? [['const', `état ${en}`]] : [])]
        assert.deepEqual(await p.evaluate('window.__logs'), [...lu(false), ...lu(true)], `${B} : la valeur de la branche, avant puis pendant la relecture`)
        assert.deepEqual(graves(o), [], `${B} : aucune erreur`)
      } finally {
        await o.fermer()
      }
    }
  })
})
