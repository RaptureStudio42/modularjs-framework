// Le lien piégé `$$prefs[section][champ] = v` (et `$prefsLoc`), `section` valant `'__proto__'` : l'écriture est refusée,
// `Object.prototype.html` reste absent. Un prototype pollué par une autre source (le code de la page) : la modale du
// cœur ne lit que les options propres de son appelant, `µ.modal.fire({ title, text })` montre son texte et ne pose
// aucun HTML hérité. Dans les deux cas aucun script de la donnée ne tourne (navigateurs réels, production)
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger } from './helpers/liaison-navigateur.js'

const BALISE = 'mjs-modale-options-propres'
const SOURCES: Record<string, string> = {
  'modale-options-propres.mjs': `<script>
  $$prefs = { affichage: { theme: 'clair' } }
  $prefsLoc = { affichage: { theme: 'clair' } }
  @regler = (section, champ, valeur) -> $$prefs[section][champ] = valeur
  @reglerLocal = (section, champ, valeur) -> $prefsLoc[section][champ] = valeur
  @ouvrir = -> µ.modal.fire({ title: 'Info', text: 'Bonjour' })
</script>
<p class="pret">pret</p>
`,
}
const PAYLOAD = '<img src=x onerror="window.__xss = (window.__xss || 0) + 1">'

describe('prototype pollué par une clé de données : µ.modal ne pose aucun HTML hérité (navigateurs réels, production)', function () {
  this.timeout(180000)
  let cible: any = null
  before(async function () { this.timeout(240000); cible = await construire('bundle', SOURCES, [BALISE]) })
  after(async () => { await terminateSharedWorkerPool() })
  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    for (const voie of ['regler', 'reglerLocal', 'page']) {
      // `page` : le code de la page pollue lui-même le prototype, le témoin d'une source que MJS ne contrôle pas
      const pollue = voie === 'page'
      it(`${moteur} : ${pollue ? 'prototype pollué par la page' : voie + '(\'__proto__\', \'html\', charge)'} puis µ.modal.fire({ title, text })`, async function () {
        const playwright: any = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) { console.log('      non installé : ' + moteur); this.skip() }
        const browser = await playwright[moteur].launch()
        try {
          const o = await charger(browser, cible, BALISE)
          try {
            await o.page.waitForFunction(`(() => { const e = document.querySelector('${BALISE}'); return !!(e && e._shadow && e._shadow.querySelector('.pret')) })()`, null, { timeout: 10000 })
            const r: any = await o.page.evaluate(`(async () => {
              const el = document.querySelector('${BALISE}')
              let erreur = ''
              try { ${pollue ? `Object.prototype.html = ${JSON.stringify(PAYLOAD)}` : `el['${voie}']('__proto__', 'html', ${JSON.stringify(PAYLOAD)})`} } catch (e) { erreur = e.name + ': ' + e.message }
              const pollue = Object.prototype.hasOwnProperty('html')
              try { el.ouvrir() } catch (e) { erreur += ' | ouvrir ' + e.name + ': ' + e.message }
              await new Promise((ok) => setTimeout(ok, 800))
              const box = document.querySelector('.mjs-modal-content')
              return { erreur, modalPresent: typeof µ !== 'undefined' && !!µ.modal, pollue, contenu: box ? box.innerHTML.slice(0, 160) : null, xss: window.__xss || 0 }
            })()`)
            console.log('      ' + JSON.stringify(r))
            assert.equal(r.erreur, '')
            assert.equal(r.pollue, pollue, pollue ? 'le prototype est bien pollué par la page (le témoin du test)' : 'le lien piégé est refusé : Object.prototype.html reste absent')
            assert.equal(r.contenu, 'Bonjour', 'le texte de l\'appelant, posé en texte')
            assert.equal(r.xss, 0, 'aucun script de la donnée ne tourne')
          }
          finally { await o.fermer() }
        }
        finally { await browser.close() }
      })
    }
  }
})
