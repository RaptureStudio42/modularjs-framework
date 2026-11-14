// Au réveil d'une page rendue par le serveur en `markers`, chaque commentaire repère n'est lu qu'autant de fois que de passages qui le regardent :
// une fois pour un repère de la racine (`mjs-h`, `mjs-e`), deux fois pour une tête de ligne (`mjs-l`, le relevé de la racine puis celui de la
// liste ; la première une fois de plus, quand la racine regarde si son bloc garde des lignes du serveur), deux fois pour le repère d'un texte
// de ligne (`mjs-r`, la racine puis le relevé de la ligne). Le texte lu est gardé d'une question à l'autre au lieu d'être relu. Le compte se fait sur la page réelle, dans Chromium et Firefox ; la page réveillée reste celle du
// serveur, et répond ensuite (un clic change le compteur, une ligne se coche).

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'p-fiche.mjs': `<script>
  $nom    = 'Ada'
  $compte = 0
  $taches = [0...20].map (i)-> { id: i + 1, label: 'tâche ' + (i + 1), fait: i % 3 == 0 }
  plus   = -> $compte++
  cocher = -> $taches[1].fait = not $taches[1].fait
</script>
<p class="nom">{$nom}</p><p class="compte">{$compte}</p>
<button class="plus" @click={plus()}>plus</button><button class="cocher" @click={cocher()}>cocher</button>
<ul>{for t in $taches by id}<li :class{t.fait}="fait"><span>{t.label}</span></li>{end}</ul>
`
}

// chaque lecture de `.data` d'un commentaire `mjs-…`, comptée par nœud ; la sorte du repère est la lettre qui suit `mjs-`
const SONDE = `(() => {
  const lus = window.__lus = new Map()
  const d   = Object.getOwnPropertyDescriptor(CharacterData.prototype, 'data')
  Object.defineProperty(CharacterData.prototype, 'data', {
    configurable: true,
    get() {
      const v = d.get.call(this)
      if (this.nodeType === 8 && v.slice(0, 4) === 'mjs-') {
        const e = lus.get(this)
        if (e) e.n++
        else lus.set(this, { k: v.charAt(4), n: 1 })
      }
      return v
    },
    set(v) { d.set.call(this, v) }
  })
})()`

// la plus forte relecture d'un même repère, par sorte, et le nombre de repères de chaque sorte
const LIRE = `(() => {
  const max = {}
  const nb  = {}
  const tot = {}
  for (const e of window.__lus.values()) {
    max[e.k] = Math.max(max[e.k] || 0, e.n)
    nb[e.k]  = (nb[e.k] || 0) + 1
    tot[e.k] = (tot[e.k] || 0) + e.n
  }
  const sh = document.querySelector('mjs-p-fiche')._shadow
  return { max, nb, tot, compte: sh.querySelector('.compte').textContent, nom: sh.querySelector('.nom').textContent, lignes: sh.querySelectorAll('li').length, faites: Array.from(sh.querySelectorAll('li')).map((l, i) => l.classList.contains('fait') ? i + 1 : 0).filter(Boolean).join(',') }
})()`

async function ouvrir(browser: any, cible: Cible) {
  const ctx  = await browser.newContext()
  const page = await ctx.newPage()
  const erreurs: string[] = []
  const avis: string[]    = []
  page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
  page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 200)) })
  await page.addInitScript('window.__name = (f) => f')
  await page.addInitScript(SONDE)
  await page.route('http://reveil.test/**', (route: any) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: cible.document('mjs-p-fiche', 'markers') })
    const fichier = join(cible.racine, normalize(chemin))
    if (existsSync(fichier)) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: readFileSync(fichier) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://reveil.test/', { waitUntil: 'load' })
  await page.waitForFunction(`(() => { const h = document.querySelector('mjs-p-fiche'); return !!(h && h._mjs_is_mounted) })()`, null, { timeout: 5000 })
  return { page, erreurs, avis, fermer: () => ctx.close() }
}

let cible: Promise<Cible> | null = null

for (const nom of ['chromium', 'firefox'] as const) describe(`réveil en markers : un repère lu une fois par passage (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test des repères sauté. Activer : \`npx playwright install ${nom}\``); return }
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('repère de la racine lu une fois, tête de ligne deux fois (la première trois), repère de texte de ligne deux fois ; la page reste celle du serveur et répond', async function () {
    if (!present) { this.skip(); return }
    cible ??= construire('ssr', SOURCES, ['mjs-p-fiche'])
    const o = await ouvrir(browser, await cible)
    try {
      const lu = await o.page.evaluate(LIRE)
      assert.deepEqual(graves(o as any), [], 'aucune erreur au réveil')
      assert.equal(lu.nb.l, 20, 'les vingt têtes de ligne du serveur sont vues')
      assert.equal(lu.nb.r, 20, 'les vingt repères de texte de ligne du serveur sont vus')
      assert.deepEqual(lu.max, { h: 1, e: 1, l: 3, r: 2 }, `relectures au plus, par sorte de repère : ${JSON.stringify(lu.max)}`)
      assert.equal(lu.tot.l, 2 * 20 + 1, `lectures des têtes de ligne : deux par tête, une de plus pour la première (${lu.tot.l})`)
      assert.deepEqual([lu.nom, lu.compte, lu.lignes, lu.faites], ['Ada', '0', 20, '1,4,7,10,13,16,19'], 'la page réveillée est celle du serveur')
      await o.page.evaluate(`document.querySelector('mjs-p-fiche')._shadow.querySelector('.plus').click()`)
      await o.page.evaluate(`document.querySelector('mjs-p-fiche')._shadow.querySelector('.cocher').click()`)
      await o.page.waitForTimeout(100)
      const apres = await o.page.evaluate(LIRE)
      assert.deepEqual([apres.compte, apres.faites], ['1', '1,2,4,7,10,13,16,19'], 'après le réveil, le clic change le compteur et la ligne reprise se coche')
      assert.deepEqual(graves(o as any), [], 'aucune erreur après les clics')
    } finally {
      await o.fermer()
    }
  })
})
