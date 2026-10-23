// Une balise `mjs-…` qui n'est pas un composant du projet (un web component tiers, absent du manifeste) lié à deux sens (`x=!{$v}`) reçoit la
// valeur en ATTRIBUT, comme toute balise qui n'est pas un composant MJS : texte pour une valeur simple, JSON pour un objet, mis à jour à chaque
// changement de la variable. Le composant du projet, lui, reçoit la valeur TYPÉE par le registre des props en attente (cf. les autres tests de
// liaison). Une liaison à un sens (`x={$n}`) pose toujours une PROPRIÉTÉ sur la balise tierce.
// Le manifeste est ce qui dit qu'une balise est un composant du projet : les cas se jouent en production (un fichier, fichiers séparés), dans
// Chromium et Firefox réels. Sans manifeste (développement et rendu serveur du harnais), une balise `mjs-…` pas encore définie passe pour un
// composant du projet : ce cas n'est pas joué ici.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { SHOW, construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'p-tiers.mjs': `<script>\n  $v = 7\n  $o = { a: 1 }\n  $n = 3\n  ${SHOW}\n</script>\n<mjs-tiers x=!{$v} o=!{$o}></mjs-tiers>\n<mjs-tiers-un x={$n}></mjs-tiers-un>\n<button class="g" @click={$v = 8}>g</button>\n<p class="p0">{show($v)}</p>\n`
}

const MODES_TIERS: Mode[] = ['bundle', 'split']

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, ['mjs-p-tiers']))
  return cibles.get(mode)!
}

// ce que la balise tierce porte AVANT d'être définie : ses attributs et ses propriétés
const AVANT = `(() => {
  const e = document.querySelector('mjs-p-tiers')._shadow.querySelector('mjs-tiers')
  const u = document.querySelector('mjs-p-tiers')._shadow.querySelector('mjs-tiers-un')
  return { attrX: e.getAttribute('x'), attrO: e.getAttribute('o'), propX: e.x === undefined ? 'undefined' : JSON.stringify(e.x), unSensAttr: u.getAttribute('x'), unSensProp: u.x }
})()`

// la page définit la balise tierce après coup : elle lit ses attributs à sa connexion et note chaque changement
const DEFINIR = `(() => {
  window.__changements = []
  customElements.define('mjs-tiers', class extends HTMLElement {
    static get observedAttributes() { return ['x'] }
    connectedCallback() { this.setAttribute('data-lu', 'x=' + this.getAttribute('x') + ' o=' + this.getAttribute('o')) }
    attributeChangedCallback(nom, avant, apres) { window.__changements.push(nom + ':' + avant + '>' + apres) }
  })
})()`

for (const nom of ['chromium', 'firefox'] as const) describe(`liaison à deux sens vers une balise mjs-… hors du manifeste (${nom} réel)`, function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test des éléments tiers sauté. Activer : \`npx playwright install ${nom}\``); return }
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES_TIERS) {
    it(`${mode} : la balise tierce reçoit un attribut, mis à jour avec la variable ; à un sens, une propriété`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-tiers')
      try {
        await o.page.waitForFunction(`!!(document.querySelector('mjs-p-tiers') && document.querySelector('mjs-p-tiers')._shadow && document.querySelector('mjs-p-tiers')._shadow.querySelector('.p0'))`, null, { timeout: 5000 }).catch(() => {})
        await o.page.waitForTimeout(300)
        const avant = await o.page.evaluate(AVANT)
        assert.deepEqual(avant, { attrX: '7', attrO: '{"a":1}', propX: 'undefined', unSensAttr: null, unSensProp: 3 }, 'à deux sens, la valeur est un attribut (JSON pour l\'objet) ; à un sens, une propriété typée')
        await o.page.evaluate(DEFINIR)
        await o.page.waitForTimeout(200)
        assert.equal(await o.page.evaluate(`document.querySelector('mjs-p-tiers')._shadow.querySelector('mjs-tiers').getAttribute('data-lu')`), 'x=7 o={"a":1}', 'la balise définie après coup lit ses attributs')
        await o.page.evaluate(`document.querySelector('mjs-p-tiers')._shadow.querySelector('.g').click()`)
        await o.page.waitForTimeout(300)
        const apres: any = await o.page.evaluate(`(() => ({ attrX: document.querySelector('mjs-p-tiers')._shadow.querySelector('mjs-tiers').getAttribute('x'), changements: window.__changements.slice(), parent: document.querySelector('mjs-p-tiers')._shadow.querySelector('.p0').textContent }))()`)
        assert.deepEqual(graves(o), [], 'aucune erreur, aucun plantage de composant')
        assert.equal(apres.attrX, '8', 'l\'attribut suit la variable')
        assert.ok(apres.changements.includes('x:7>8'), `la balise tierce voit le changement (vu : ${apres.changements.join(' ; ')})`)
        assert.equal(apres.parent, '8 <number>', 'le parent garde sa valeur')
      } finally {
        await o.fermer()
      }
    })
  }
})
