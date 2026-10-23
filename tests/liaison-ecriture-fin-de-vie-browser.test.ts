// Ce qu'un enfant écrit dans sa prop liée à deux sens remonte vers la variable de son parent TOUT AU LONG de sa vie, pas seulement tant que
// sa balise est dans le document : dans son `µsleep` et son `µdestroy` quand le parent est retiré du document avec lui, et chaque fois
// qu'il écrit pendant que son parent est détaché (page parquée en cache, composant remis plus tard). Seul ce qui n'est pas une écriture de l'enfant
// ne remonte pas : son défaut de construction, et les valeurs que le parent lui livre à sa mise à niveau. Au retour du parent dans le document,
// l'enfant ne reprend donc pas une valeur périmée du parent : le parent a suivi.
// Chaque cas se joue dans cinq modes de chargement (développement avec les parents définis avant ou après les enfants, production en un
// fichier ou en fichiers séparés, rendu serveur puis hydratation), dans Chromium et Firefox réels.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MODES, variantes, SHOW, construire, charger, attendre, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // un enfant qui écrit en s'endormant puis en se détruisant
  'c-fin.mjs': `<script>\n  µsleep -> $x = 'sleep'\n  µdestroy -> $x = 'bye'\n  ${SHOW}\n</script>\n<p class="vu">{show($x)}</p>\n`,
  'p-fin.mjs': `<script>\n  $v = 'init'\n  ${SHOW}\n</script>\n<@c-fin x=!{$v}></@c-fin>\n<p class="p0">{show($v)}</p>\n`,
  // un enfant qui compte à chaque clic de son bouton : le clic remplace la minuterie, sans attente ni hasard
  'c-tic.mjs': `<script>\n  tic = -> $x = ($x or 0) + 1\n</script>\n<button class="t" @click={tic()}>t</button><p class="vu">{$x}</p>\n`,
  'p-cache.mjs': `<script>\n  $v = 0\n</script>\n<@c-tic x=!{$v}></@c-tic>\n<p class="p0">{$v}</p>\n`
}

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, ['mjs-p-fin', 'mjs-p-cache']))
  return cibles.get(mode)!
}

const titre = (mode: Mode, variante: string) => mode + (variante ? ` (${variante})` : '')

for (const nom of ['chromium', 'firefox'] as const) describe(`écritures de l'enfant en fin de vie et pendant que son parent est détaché (${nom} réel)`, function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test des écritures de fin de vie sauté. Activer : \`npx playwright install ${nom}\``); return }
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) for (const variante of variantes(mode)) {
    it(`µsleep et µdestroy de l'enfant, parent retiré du document, ${titre(mode, variante)} : leurs écritures remontent dans la variable du parent`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-fin', variante)
      try {
        await attendre(o.page, 'mjs-p-fin', 1)
        assert.equal(await o.page.evaluate(`document.querySelector('mjs-p-fin')._state.v`), 'init', 'au départ, le parent garde sa valeur')
        await o.page.evaluate(`(() => { window.__p = document.querySelector('mjs-p-fin'); window.__p.remove() })()`)
        await o.page.waitForTimeout(300)
        assert.deepEqual(graves(o), [], 'aucune erreur, aucun plantage de composant')
        assert.equal(await o.page.evaluate('window.__p._state.v'), 'bye', 'le parent a reçu ce que l\'enfant a écrit en s\'endormant puis en se détruisant')
        const remontes = await o.page.evaluate('window.__binds') as string[]
        assert.ok(remontes.includes('c-fin.x="sleep" <string>') && remontes.includes('c-fin.x="bye" <string>'), `µsleep puis µdestroy ont écrit (remontés : ${remontes.join(' ; ')})`)
      } finally {
        await o.fermer()
      }
    })

    it(`enfant qui écrit pendant que son parent est détaché, ${titre(mode, variante)} : le parent suit, et au retour l'enfant garde sa valeur`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-cache', variante)
      const clic = (n: number) => o.page.evaluate(`(() => { const t = window.__c._shadow.querySelector('.t'); for (let i = 0; i < ${n}; i++) t.click() })()`)
      const lire = () => o.page.evaluate(`(() => { const h = document.querySelector('mjs-p-cache'); return { etat: h._state.v, parent: h._shadow.querySelector('.p0').textContent, enfant: h._shadow.querySelector('mjs-c-tic')._shadow.querySelector('.vu').textContent } })()`)
      try {
        await attendre(o.page, 'mjs-p-cache', 1)
        await o.page.evaluate(`window.__c = document.querySelector('mjs-p-cache')._shadow.querySelector('mjs-c-tic')`)
        await clic(2)
        await o.page.waitForTimeout(200)
        assert.deepEqual(await lire(), { etat: 2, parent: '2', enfant: '2' }, 'monté, chaque clic de l\'enfant remonte')
        await o.page.evaluate(`(() => { window.__p = document.querySelector('mjs-p-cache'); window.__p.remove() })()`)
        await clic(3)
        await o.page.waitForTimeout(200)
        assert.equal(await o.page.evaluate('window.__p._state.v'), 5, 'détaché, le parent suit encore ce que l\'enfant écrit')
        await o.page.evaluate('document.body.appendChild(window.__p)')
        await o.page.waitForTimeout(400)
        assert.deepEqual(graves(o), [], 'aucune erreur, aucun plantage de composant')
        assert.deepEqual(await lire(), { etat: 5, parent: '5', enfant: '5' }, 'au retour du parent dans le document, l\'enfant garde sa valeur : le parent a suivi')
      } finally {
        await o.fermer()
      }
    })
  }
})
