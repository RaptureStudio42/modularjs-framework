// µafter et µevery appelés par un module (`<script module>`) depuis un gestionnaire, hors de tout composant actif : la
// minuterie vit au niveau de la page, avec ou sans nom (`id:`), `await µafter` compris, sans avertissement « il ne fait
// rien » — en développement et en production, dans les trois moteurs réels
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

// un module cœur dans la page : l'aide des navigateurs bâtit la production en un morceau par module
const SOURCE = `<p class="etat">{$go}</p>
<button class="apres" @click={-> window.__modApres()}>après</button>
<button class="nomme" @click={-> window.__modNomme()}>nommé</button>
<button class="every" @click={-> window.__modEvery()}>every</button>
<button class="attente" @click={-> window.__modAttente()}>attente</button>
<button class="go" @click={-> $go = $go + 1}>go</button>
<@@editor class="g" name="g" toolbar="bold"></@@editor>

<script module>
  window.__modApres = -> µafter 30, -> window.__j.push('apres')
  window.__modNomme = -> µafter 60, id: 'module', -> window.__j.push('nomme')
  window.__modEvery = -> µevery 20, times: 3, -> window.__j.push('every')
  window.__modAttente = ->
    await µafter 30
    window.__j.push('attente')
</script>

<script>
  window.__j = window.__j or []
  $go = 0
</script>
`
const PAGE: Page = {
  cle:     'minuteries-hors-composant',
  attente: `(() => { const h = document.querySelector('mjs-hote'); return !!(h && h._shadow && h._shadow.querySelector('button.go')) })()`,
  aides:   `window.__clic = (cls) => document.querySelector('mjs-hote')._shadow.querySelector('button.' + cls).click(); window.__compte = (x) => window.__j.filter((y) => y === x).length; 0`,
  source:  SOURCE,
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

for (const build of ['dev', 'prod'] as const) for (const nom of MOTEURS) describe(`µafter / µevery hors de tout composant actif (${build}, ${nom} réel)`, function () {
  this.timeout(60000)
  let s: Session | null = null
  const E = (expr: string): Promise<any> => s!.page.evaluate(expr)
  before(async function () {
    s = await ouvrir(nom, build, PAGE)
    if (!s) this.skip()
  })
  after(async () => {
    if (s) await s.fermer()
    s = null
    await terminateSharedWorkerPool()
  })

  it('module appelé depuis un gestionnaire : µafter tire, µevery répète, un nom vaut pour la page, `await µafter` reprend', async () => {
    await E(`__clic('apres'); __clic('nomme'); __clic('nomme'); __clic('every'); __clic('attente')`)
    await dormir(400)
    const r = await E(`({ apres: __compte('apres'), nomme: __compte('nomme'), every: __compte('every'), attente: __compte('attente') })`)
    assert.deepEqual(r, { apres: 1, nomme: 1, every: 3, attente: 1 }, `console : ${JSON.stringify(s!.logs)}`)
    assert.deepEqual(s!.logs.filter((l) => /hors de tout composant|outside any component/.test(l)), [], 'aucun avertissement « il ne fait rien »')
  })
})
