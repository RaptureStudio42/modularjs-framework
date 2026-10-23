// Moteur navigateur : un emplacement du réservoir (contexte + page Chromium) sert plusieurs rendus
// de suite, souvent pour des visiteurs différents. Deux fuites entre visiteurs :
//   1. IndexedDB et `window.name` survivaient d'un rendu au suivant (seuls localStorage,
//      sessionStorage et les cookies étaient vidés) — ce qu'un visiteur écrivait pendant son rendu
//      se lisait au rendu du visiteur suivant, jusque dans le HTML servi ;
//   2. un en-tête Cookie forgé (`=x`, nom vide) était accepté tel quel, puis le nettoyage des
//      cookies échouait à CHAQUE rendu suivant de l'emplacement : un emplacement cassé pour de bon,
//      N requêtes suffisaient à casser tout le réservoir.
//
// Garde de disponibilité — même motif que tests/render-browser.test.ts : Chromium optionnel.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

async function isChromiumAvailable(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

function projet(): string {
  const root = mjsTmp('render-browser-emplacement')
  mkdirSync(join(root, 'src'), { recursive: true })
  return root
}

const borne = <T>(p: Promise<T>, ms: number, quoi: string): Promise<T> => Promise.race([
  p,
  new Promise<T>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT — ' + quoi)), ms)),
])

describe('render-browser — un emplacement réutilisé ne garde rien du visiteur précédent', function () {
  let chromiumReady = false

  before(async function () {
    this.timeout(10000)
    chromiumReady = await isChromiumAvailable()
    if (!chromiumReady) {
      console.log('  ℹ️  Chromium non installé, test render-browser-emplacement-reutilise-remis-a-neuf sauté.')
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('IndexedDB et window.name écrits au rendu 1 sont invisibles au rendu 2 (réservoir de taille 1)', async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(60000)
    const root = projet()
    writeFileSync(join(root, 'src', 'fuite.mjs'), `
<script lang="coffee">
$p = new Promise (resolve) ->
  avant = 'name=' + (window.name or 'vide')
  window.name = 'secret-' + Date.now()
  req = indexedDB.open('db', 1)
  req.onupgradeneeded = -> req.result.createObjectStore('s')
  req.onerror = -> resolve(avant + ' idb=erreur')
  req.onsuccess = ->
    st = req.result.transaction('s', 'readwrite').objectStore('s')
    g = st.get('k')
    g.onsuccess = ->
      st.put('idb-secret-' + Date.now(), 'k')
      resolve(avant + ' idb=' + (g.result or 'vide'))
</script>
{await $p}<span class="pending">attente</span>{success v}<span class="seen">{v}</span>{end}
`)
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', render: { browserPool: { size: 1 } } }, { configDir: root })
    try {
      const vu = (html: string) => (html.match(/<span class="seen">([^<]*)<\/span>/) || [])[1]
      const r1 = await renderer.renderPage('mjs-fuite', { settleMs: 5000 })
      assert.equal(vu(r1.html), 'name=vide idb=vide')
      const r2 = await borne(renderer.renderPage('mjs-fuite', { settleMs: 5000 }), 30000, 'le 2e rendu ne s\'est jamais terminé')
      assert.equal(vu(r2.html), 'name=vide idb=vide', 'le visiteur suivant ne doit rien lire de ce que le précédent a écrit')
    } finally {
      await renderer.close()
    }
  })

  it('un cookie de nom vide envoyé par un visiteur ne casse pas l\'emplacement : les rendus suivants aboutissent', async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(60000)
    const root = projet()
    writeFileSync(join(root, 'src', 'simple.mjs'), '<p class="x">OK</p>\n')
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', render: { browserPool: { size: 1 } } }, { configDir: root })
    try {
      for (const cookie of ['=x', 'a=1', 'a=1']) {
        const res = await borne(renderer.renderPage('mjs-simple', { forwardedCookie: cookie }), 30000, `rendu avec le cookie ${JSON.stringify(cookie)}`)
        assert.match(res.html, /OK/, `rendu avec le cookie ${JSON.stringify(cookie)}`)
      }
    } finally {
      await renderer.close()
    }
  })

  it('les paires de cookie invalides sont écartées, les valides restent visibles à la page', async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(60000)
    const root = projet()
    writeFileSync(join(root, 'src', 'biscuits.mjs'), `
<script lang="coffee">
$c = document.cookie.split('; ').sort().join(' ; ')
</script>
<span class="c">{$c}</span>
`)
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', render: { browserPool: { size: 1 } } }, { configDir: root })
    try {
      const res = await renderer.renderPage('mjs-biscuits', { forwardedCookie: '=x; a=1; b\u0001c=2; b=2' })
      assert.equal((res.html.match(/<span class="c">([^<]*)<\/span>/) || [])[1], 'a=1 ; b=2')
    } finally {
      await renderer.close()
    }
  })
})
