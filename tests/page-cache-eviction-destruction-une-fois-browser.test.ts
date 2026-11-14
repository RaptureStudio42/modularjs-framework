// page évincée du cache de pages : chaque composant de l'arbre passe UNE fois par sa destruction. Un composant léger n'a
// pas d'ombre (son `_shadow` est l'élément lui-même) : ses enfants et ceux de son « ombre » sont la même liste, et
// `µ._mjs_destroyEvictedTree` la parcourait deux fois — chaque enfant d'un parent léger passait deux fois par sa
// destruction, un petit-enfant sous un enfant léger quatre fois, le parcours doublant à chaque étage léger (`µdestroy`
// lui-même restait gardé, une fois par montage). Témoins : le parent ordinaire, et les chemins sans cache (`{if}` qui
// retire les parents, page quittée) où chaque composant se détruit lui-même. Chromium, Firefox et WebKit réels, vrais composants compilés ;
// le parcours seul se vérifie aussi sur happy-dom, sans navigateur

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { MOTEURS, monterComposants, type Composants } from './helpers/composants-navigateur.js'

const L       = (...l: string[]) => l.join('\n') + '\n'
const DETRUIT = (nom: string) => `  µdestroy -> window.__k.push('${nom}') if window.__k`
const SOURCES: Record<string, string> = {
  hote: L('<script>', '  $montre = true', '</script>', '<button class="cacher" @click={$montre = false}>c</button>', '{if $montre}', '  <mjs-pl mjs-light></mjs-pl>', '  <mjs-po></mjs-po>', '{end}')
}
// deux parents, léger et ordinaire (témoin) ; chacun : un enfant léger qui porte un petit-enfant, un enfant ordinaire
for (const p of ['pl', 'po']) {
  SOURCES[p]            = L('<script>', DETRUIT(p), '</script>', `<mjs-${p}-kl mjs-light></mjs-${p}-kl>`, `<mjs-${p}-ko></mjs-${p}-ko>`)
  SOURCES[`${p}-kl`]    = L('<script>', DETRUIT(`${p}-kl`), '</script>', `<mjs-${p}-kl-pf></mjs-${p}-kl-pf>`)
  SOURCES[`${p}-ko`]    = L('<script>', DETRUIT(`${p}-ko`), '</script>', `<p>${p}-ko</p>`)
  SOURCES[`${p}-kl-pf`] = L('<script>', DETRUIT(`${p}-kl-pf`), '</script>', `<p>${p}-kl-pf</p>`)
}
const NOMS = Object.keys(SOURCES).filter(n => n !== 'hote').sort()
const UNE  = Object.fromEntries(NOMS.map(n => [n, 1]))
const fois = (l: string[]) => Object.fromEntries(NOMS.map(n => [n, l.filter(x => x === n).length]))
const ici    = dirname(fileURLToPath(import.meta.url))
const source = (f: string) => readFileSync(join(ici, '../src/runtime', f), 'utf-8')

// `__tous` : les composants de la page, ombres comprises ; l'espion : `__k` note les `µdestroy`, `__r` chaque passage par
// la destruction
const OUTILS = `(() => {
  window.__tous = () => { const t = [], voir = r => { for (const e of r.querySelectorAll('*')) { if (e.tagName.startsWith('MJS-')) t.push(e); const o = e._shadow !== e && e._shadow || e.shadowRoot; if (o) voir(o) } }; voir(document); return t }
})()`
const ESPION = `(() => {
  if (typeof µ === 'undefined' || typeof µ._mjs_destroyEvictedTree !== 'function') throw new Error('µ._mjs_destroyEvictedTree absent de la construction')
  window.__k = []
  window.__r = []
  const P = µ.Element.prototype, o = P._mjs_runDestroyCallbacks
  P._mjs_runDestroyCallbacks = function () { window.__r.push(this.tagName.toLowerCase().slice(4)); return o.apply(this, arguments) }
})()`
// hibernation comme le cache de pages : racines de la page marquées, puis sorties du document
const HIBERNER = `(() => { const sh = document.querySelector('mjs-hote')._shadow; window.__racines = [sh.querySelector('mjs-pl'), sh.querySelector('mjs-po')]; for (const n of window.__racines) { n._mjs_page_cached = true; n.remove() } })()`

for (const moteur of MOTEURS) describe(`page évincée du cache : chaque composant détruit une fois, parent léger comme ordinaire — ${moteur}`, function () {
  this.timeout(180000)
  let c: Composants | null = null

  before(async function () {
    c = await monterComposants(SOURCES, moteur)
    if (!c) { console.log(`  ℹ️  ${moteur} non installé : test sauté. Activer : \`npx playwright install ${moteur}\``); this.skip() }
  })

  after(async function () {
    if (c) await c.fermer()
  })

  async function ouvrir() {
    const page    = await c!.client('hote', 'mjs-po')
    const erreurs = [] as string[]
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.evaluate(OUTILS)
    // le cache de pages n'entre dans une construction qu'avec le routeur, ujs ou une modale : son module est joué tel quel
    // dans la page, après le bundle
    await page.evaluate(source('mjs_page_cache.ts') + '\n;0')
    await page.waitForFunction(`window.__tous().length === ${NOMS.length + 1} && window.__tous().every(e => e._mjs_is_mounted)`, null, { timeout: 15000 })
    await page.evaluate(ESPION)
    return { page, erreurs }
  }

  const releve = async (page: any) => {
    await page.waitForTimeout(150)
    return page.evaluate(() => ({ k: (window as any).__k.slice().sort(), r: (window as any).__r.slice().sort() }))
  }

  it('hibernée, remise dans la page, un enfant déplacé, de nouveau hibernée puis évincée : un passage et un µdestroy par composant', async () => {
    const { page, erreurs } = await ouvrir()
    try {
      await page.evaluate(HIBERNER)
      assert.deepEqual(await releve(page), { k: [], r: [] }, 'une page hibernée garde ses composants')
      await page.evaluate(`(() => { const sh = document.querySelector('mjs-hote')._shadow; for (const n of window.__racines) { n._mjs_page_cached = false; sh.appendChild(n) } })()`)
      await releve(page)
      // l'enfant ordinaire du parent ordinaire déplacé sous l'enfant léger du parent léger
      await page.evaluate(`(() => { const [pl, po] = window.__racines; pl.querySelector('mjs-pl-kl').appendChild(po._shadow.querySelector('mjs-po-ko')) })()`)
      await page.evaluate(HIBERNER)
      assert.deepEqual(await releve(page), { k: [], r: [] }, 'remise du cache, déplacement, nouvelle hibernation : rien de détruit')
      // ce que fait le cache de pages (et celui des vues du routeur) d'une page qu'il abandonne
      await page.evaluate('for (const n of window.__racines) µ._mjs_destroyEvictedTree(n)')
      const r = await releve(page)
      assert.deepEqual(fois(r.k), UNE, 'µdestroy : une fois par composant, aucun perdu')
      assert.deepEqual(fois(r.r), UNE, 'AVANT : sous un parent léger, chaque enfant passait deux fois par sa destruction, un petit-enfant quatre fois')
      assert.deepEqual(erreurs, [])
    }
    finally { await page.close() }
  })

  it('témoin sans cache : `{if}` qui retire les parents, chaque composant détruit une fois', async () => {
    const { page, erreurs } = await ouvrir()
    try {
      await page.evaluate(`document.querySelector('mjs-hote')._shadow.querySelector('.cacher').click()`)
      const r = await releve(page)
      assert.deepEqual(fois(r.k), UNE)
      assert.deepEqual(fois(r.r), UNE)
      assert.deepEqual(erreurs, [])
    }
    finally { await page.close() }
  })

  it('témoin sans cache : page quittée (hôte retiré du document), chaque composant détruit une fois', async () => {
    const { page, erreurs } = await ouvrir()
    try {
      await page.evaluate(`document.querySelector('mjs-hote').remove()`)
      const r = await releve(page)
      assert.deepEqual(fois(r.k), UNE)
      assert.deepEqual(fois(r.r), UNE)
      assert.deepEqual(erreurs, [])
    }
    finally { await page.close() }
  })
})

// le parcours seul, sur happy-dom : douze composants imbriqués, chacun dans le précédent (léger : dans ses enfants ;
// ordinaire : dans son ombre) ; rend le nombre de passages par la destruction de chacun
describe('µ._mjs_destroyEvictedTree — un passage par composant, sans navigateur', function () {
  function chaine(leger: boolean) {
    const win: any = new Window({ url: 'http://localhost/' })
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const µ        = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', `${source('mjs_init.ts').replace(/export\s*\{[^}]*\}/, '')}\n${source('mjs_page_cache.ts')}\nreturn µ;`)(win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet)
      const racine   = win.document.createElement('div')
      const passages = [] as number[]
      let lieu       = racine
      for (let i = 0; i < 12; i++) {
        const n = win.document.createElement('div')
        n._shadow = leger ? n : n.attachShadow({ mode: 'open' })
        n._mjs_runDestroyCallbacks = () => { passages[i] = (passages[i] || 0) + 1 }
        lieu.appendChild(n)
        lieu = n._shadow
      }
      µ._mjs_destroyEvictedTree(racine)
      return passages
    }
    finally { win.close?.() }
  }

  it('douze composants légers imbriqués : un passage chacun (AVANT : 1, 2, 4… jusqu\'à 2 048)', () => {
    assert.deepEqual(chaine(true), Array(12).fill(1))
  })

  it('témoin : douze composants ordinaires imbriqués, un passage chacun', () => {
    assert.deepEqual(chaine(false), Array(12).fill(1))
  })
})
