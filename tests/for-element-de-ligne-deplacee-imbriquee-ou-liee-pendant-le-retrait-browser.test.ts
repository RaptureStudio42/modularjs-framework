// {for … by clé} rendu pendant qu'un champ d'une ligne a le focus : Chromium envoie `blur` (et `focusout`) à ce champ quand sa ligne
// quitte le document, même pour y revenir aussitôt (ligne déplacée), le nœud encore en place. Le gestionnaire de la ligne reçoit
// l'élément de SA ligne, jamais celui de même rang dans la nouvelle liste : ligne ordinaire qui bouge sans partir, boucle extérieure de
// boucles imbriquées (nouvelle liste plus courte comprise), et la liaison à deux sens d'une ligne qui part n'écrit dans aucun autre
// élément. Le gestionnaire posé dans un bloc de la ligne (`{if}`) aussi ; et un `{const}` de la ligne intérieure qui porte le nom de
// l'élément extérieur reste ce `{const}`, à l'arrêt comme pendant un retrait. Firefox et WebKit n'envoient rien au retrait. Navigateurs
// réels, Chromium, Firefox et WebKit quand ils sont installés

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger } from './helpers/liaison-navigateur.js'

const script = `<script lang="coffee">
  $rows = [ { id: 1, label: 'A' }, { id: 2, label: 'B' }, { id: 3, label: 'C' }, { id: 4, label: 'D' } ]
  $groupes = [ { id: 1, nom: 'G1', rows: [ { id: 11, label: 'A' }, { id: 12, label: 'B' } ] }, { id: 2, nom: 'G2', rows: [ { id: 21, label: 'C' } ] } ]
  $suffixe = ''
  $gs = [ { id: 1, nom: 'G1', rows: [ { id: 11, label: 'A', sous: { nom: 'S11' } }, { id: 12, label: 'B', sous: { nom: 'S12' } } ] } ]
  nom = (x, champ) -> if x? and x[champ]? then x[champ] else 'autre'
  noter = (r) -> window.__seenMark.push(nom(r, 'label'))
  noterDeux = (g, r) -> window.__seenMark.push(nom(g, 'nom') + '/' + nom(r, 'label'))
  @bouge = -> $rows = [ $rows[0], $rows[2], $rows[3], $rows[1] ]
  @tout = -> $rows = [ { id: 5, label: 'E' }, { id: 6, label: 'F' }, { id: 7, label: 'G' }, { id: 8, label: 'H' } ]
  @prendre = -> window.__pris = $rows[1]
  @groupesTout = -> $groupes = [ { id: 3, nom: 'G3', rows: [ { id: 31, label: 'E' }, { id: 32, label: 'F' } ] }, { id: 4, nom: 'G4', rows: [ { id: 41, label: 'G' } ] } ]
  @groupesCourt = -> $groupes = [ { id: 5, nom: 'G5', rows: [ { id: 51, label: 'H' } ] } ]
</script>`
const SOURCES: Record<string, string> = {
  // ligne ordinaire (elle lit aussi une variable du composant) qui bouge : B passe en dernier, les autres restent en place
  'bouge-ordinaire.mjs': `${script}\n<div>\n  {for row in $rows by id}\n    <section class="row"><input class="f" aria-label="saisie" @blur={-> noter(row)} /><span class="lbl">{row.label}{$suffixe}</span></section>\n  {end}\n</div>\n`,
  // boucles imbriquées : le gestionnaire lit l'élément de la boucle extérieure et celui de la boucle intérieure
  'imbrique-groupes.mjs': `${script}\n<div>\n  {for g in $groupes by id}\n    <div class="g">\n      {for row in g.rows by id}\n        <section class="row"><input class="f" aria-label="saisie" @blur={-> noterDeux(g, row)} /><span class="lbl">{row.label}{$suffixe}</span></section>\n      {end}\n    </div>\n  {end}\n</div>\n`,
  // gestionnaire dans un bloc `{if}` de la ligne : la table de la balise est celle du bloc
  'dans-un-bloc.mjs': `${script}\n<div>\n  {for row in $rows by id}\n    <section class="row">{if row.id > 0}<input class="f" aria-label="saisie" @blur={-> noter(row)} />{end}<span class="lbl">{row.label}{$suffixe}</span></section>\n  {end}\n</div>\n`,
  // `{const}` de la ligne intérieure du même nom que l'élément extérieur : le gestionnaire lit ce `{const}`, comme le gabarit
  'const-meme-nom.mjs': `${script}\n<div>\n  {for g in $gs by id}\n    <div class="g">\n      {for row in g.rows by id}\n        {const g = row.sous}\n        <section class="row"><input class="f" aria-label="saisie" @blur={-> noterDeux(g, row)} /><span class="lbl">{row.label}{g.nom}{$suffixe}</span></section>\n      {end}\n    </div>\n  {end}\n</div>\n`,
  // liaison à deux sens d'une ligne qui part pendant que son champ a le focus
  'liaison-ligne.mjs': `${script}\n<div>\n  {for row in $rows by id}\n    <section class="row"><input class="f" aria-label="saisie" value=!{row.label} /><span class="lbl">{row.label}{$suffixe}</span></section>\n  {end}\n</div>\n`,
}
const BALISES = ['mjs-bouge-ordinaire', 'mjs-imbrique-groupes', 'mjs-liaison-ligne', 'mjs-dans-un-bloc', 'mjs-const-meme-nom']

const cible = construire('dev-parents-avant', SOURCES, BALISES)

// focus dans le champ de rang `rang`, puis le geste ; rend les libellés affichés et ce que les gestionnaires ont reçu
const jouer = (balise: string, rang: number, geste: string) => `(async () => {
  window.__seenMark = []
  const h = document.querySelector('${balise}'), sh = h._shadow
  sh.querySelectorAll('input.f')[${rang}].focus()
  h.${geste}()
  await new Promise((r) => setTimeout(r, 150))
  return { lignes: [...sh.querySelectorAll('.lbl')].map((s) => s.textContent).join(','), vu: window.__seenMark }
})()`

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`{for} : ligne déplacée, boucle extérieure, liaison — l'élément de la ligne pendant son retrait (${moteur} réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('ligne ordinaire qui bouge sans partir, focus dans la ligne B : `row` vaut l\'élément B', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible, 'mjs-bouge-ordinaire')
    try {
      await o.page.waitForFunction(`document.querySelector('mjs-bouge-ordinaire')?._shadow?.querySelectorAll('section.row').length === 4`, null, { timeout: 10000 })
      const vu = await o.page.evaluate(jouer('mjs-bouge-ordinaire', 1, 'bouge'))
      assert.equal(vu.lignes, 'A,C,D,B', 'liste réordonnée')
      assert.ok(vu.vu.every((x: string) => x === 'B'), `le gestionnaire de la ligne déplacée lit l'élément de sa ligne : ${JSON.stringify(vu.vu)}`)
      if (moteur === 'chromium') assert.deepEqual(vu.vu, ['B'], 'Chromium envoie blur au déplacement (sinon le test ne prouve rien)')
      assert.deepEqual(o.erreurs, [])
    }
    finally {
      await o.fermer()
    }
  })

  for (const [geste, rang, attendu, lignes] of [['groupesTout', 1, 'G1/B', 'E,F,G'], ['groupesCourt', 2, 'G2/C', 'H']] as const) {
    it(`boucles imbriquées, ${geste} : le gestionnaire de la ligne qui part lit ${attendu}`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible, 'mjs-imbrique-groupes')
      try {
        await o.page.waitForFunction(`document.querySelector('mjs-imbrique-groupes')?._shadow?.querySelectorAll('section.row').length === 3`, null, { timeout: 10000 })
        const vu = await o.page.evaluate(jouer('mjs-imbrique-groupes', rang, geste))
        assert.equal(vu.lignes, lignes, 'groupes remplacés')
        assert.ok(vu.vu.every((x: string) => x === attendu), `le gestionnaire parti pendant le retrait lit le groupe et l'élément de sa ligne : ${JSON.stringify(vu.vu)}`)
        if (moteur === 'chromium') assert.deepEqual(vu.vu, [attendu], 'Chromium envoie blur au retrait (sinon le test ne prouve rien)')
        assert.deepEqual(o.erreurs, [])
      }
      finally {
        await o.fermer()
      }
    })
  }

  it('gestionnaire dans un `{if}` de la ligne, toute la liste remplacée, focus dans la ligne B : `row` vaut l\'élément B', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible, 'mjs-dans-un-bloc')
    try {
      await o.page.waitForFunction(`document.querySelector('mjs-dans-un-bloc')?._shadow?.querySelectorAll('section.row').length === 4`, null, { timeout: 10000 })
      const vu = await o.page.evaluate(jouer('mjs-dans-un-bloc', 1, 'tout'))
      assert.equal(vu.lignes, 'E,F,G,H', 'liste remplacée')
      assert.ok(vu.vu.every((x: string) => x === 'B'), `le gestionnaire du bloc lit l'élément de sa ligne : ${JSON.stringify(vu.vu)}`)
      if (moteur === 'chromium') assert.deepEqual(vu.vu, ['B'], 'Chromium envoie blur au retrait (sinon le test ne prouve rien)')
      assert.deepEqual(o.erreurs, [])
    }
    finally {
      await o.fermer()
    }
  })

  it('`{const}` de la ligne intérieure du nom de l\'élément extérieur, à l\'arrêt : le gestionnaire lit le `{const}`, sans erreur', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible, 'mjs-const-meme-nom')
    try {
      await o.page.waitForFunction(`document.querySelector('mjs-const-meme-nom')?._shadow?.querySelectorAll('section.row').length === 2`, null, { timeout: 10000 })
      const vu = await o.page.evaluate(`(async () => {
        window.__seenMark = []
        const champ = document.querySelector('mjs-const-meme-nom')._shadow.querySelectorAll('input.f')[1]
        champ.focus()
        champ.blur()
        await new Promise((r) => setTimeout(r, 60))
        return window.__seenMark
      })()`)
      assert.deepEqual(vu, ['S12/B'])
      assert.deepEqual(o.erreurs, [])
    }
    finally {
      await o.fermer()
    }
  })

  it('liaison à deux sens : la ligne B part pendant que son champ a le focus, aucun autre élément n\'est écrit', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible, 'mjs-liaison-ligne')
    try {
      await o.page.waitForFunction(`document.querySelector('mjs-liaison-ligne')?._shadow?.querySelectorAll('section.row').length === 4`, null, { timeout: 10000 })
      await o.page.evaluate(`(() => { const h = document.querySelector('mjs-liaison-ligne'); h.prendre(); h._shadow.querySelectorAll('input.f')[1].focus() })()`)
      await o.page.keyboard.type('x')
      const vu = await o.page.evaluate(`(async () => {
        const h = document.querySelector('mjs-liaison-ligne'), sh = h._shadow
        const avant = window.__pris.label
        h.tout()
        await new Promise((r) => setTimeout(r, 150))
        return { avant, apres: window.__pris.label, lignes: [...sh.querySelectorAll('.lbl')].map((s) => s.textContent).join(','), champs: [...sh.querySelectorAll('input.f')].map((i) => i.value).join(',') }
      })()`)
      assert.equal(vu.avant, 'Bx', 'la frappe écrit dans l\'élément de sa ligne')
      assert.equal(vu.apres, 'Bx', 'l\'élément parti garde ce qui a été tapé')
      assert.equal(vu.lignes, 'E,F,G,H', 'aucun élément de la nouvelle liste n\'est écrit')
      assert.equal(vu.champs, 'E,F,G,H')
      assert.deepEqual(o.erreurs, [])
    }
    finally {
      await o.fermer()
    }
  })
})
