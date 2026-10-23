// Navigateurs réels (Chromium, Firefox, WebKit), build de production : le filtre des attributs calculés ne court plus que
// pour un nom à risque (cf. attributs-filtre-pour-les-seuls-noms-a-risque.test.ts). La page ne porte aucune valeur
// dangereuse (adresse `javascript:`, gestionnaire `on…`, `srcdoc`, nom calculé d'un étalement), et les attributs sans
// risque (`class`, `data-id`, `aria-label`, `title`, `alt`, `aria-*` à `false`) portent leur valeur, à la racine comme
// dans une ligne de `{for}`.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'

const BALISE = 'mjs-attr-sur-nav'
const SOURCES: Record<string, string> = {
  'attr-sur-nav.mjs': `<script lang="coffee">
$u = 'javascript:alert(1)'
$c = 'actif'
$d = 7
$a = 'etiquette'
$t = 'titre'
$o = 'alert(2)'
$s = '<script>alert(3)</script>'
$f = false
$lignes = [{id: 1, u: 'javascript:alert(4)', d: 8, c: 'ligne'}]
$etale = {onclick: 'alert(5)', 'data-x': 'x'}
</script>
<a id="lien" href={$u} class={$c} data-id={$d} aria-label={$a} aria-expanded={$f} title={$t} onclick={$o} onMouseOver={$o} srcdoc={$s} formaction={$u} ping={$u}>x</a>
<img src={$u} alt={$t}>
<object data={$u}></object>
<p class="etale" {...$etale}>e</p>
<ul>{for l in $lignes by id}<li class={l.c} data-id={l.d} title={l.c}><a href={l.u}>l</a></li>{end}</ul>
<p class="etat">pret</p>
`,
}

const LIRE = `(() => {
  const sh = document.querySelector('${BALISE}')._shadow
  const a  = sh.querySelector('#lien')
  const li = sh.querySelector('li')
  const at = (n, x) => n.getAttribute(x)
  return {
    href: at(a, 'href'), formaction: at(a, 'formaction'), ping: at(a, 'ping'), onclick: at(a, 'onclick'), onmouseover: at(a, 'onmouseover'), srcdoc: at(a, 'srcdoc'),
    src: at(sh.querySelector('img'), 'src'), data: at(sh.querySelector('object'), 'data'), ligneHref: at(sh.querySelector('li a'), 'href'), etaleClic: at(sh.querySelector('p.etale'), 'onclick'),
    sur: [at(a, 'class'), at(a, 'data-id'), at(a, 'aria-label'), at(a, 'aria-expanded'), at(a, 'title'), at(sh.querySelector('img'), 'alt'), at(sh.querySelector('p.etale'), 'data-x'), at(li, 'class'), at(li, 'data-id'), at(li, 'title')]
  }
})()`

describe('attributs calculés, navigateurs réels (production) : le filtre pour les seuls noms à risque', function () {
  this.timeout(180000)
  let cible: any = null

  before(async function () {
    this.timeout(240000)
    cible = await construire('bundle', SOURCES, [BALISE])
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur} : aucune valeur dangereuse posée, les attributs sans risque portent leur valeur`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) {
        console.log(`  ℹ️  ${moteur} non installé, test sauté. Activer : \`npx playwright install ${moteur}\``)
        this.skip()
      }
      const browser = await playwright[moteur].launch()
      try {
        const o = await charger(browser, cible, BALISE)
        try {
          await o.page.waitForFunction(`(() => { const e = document.querySelector('${BALISE}'); return !!(e && e._shadow && e._shadow.querySelector('li')) })()`, null, { timeout: 10000 })
          const lu: any = await o.page.evaluate(LIRE)
          for (const nom of ['href', 'formaction', 'ping', 'src', 'data', 'ligneHref']) assert.ok(!/javascript:/.test(lu[nom] ?? ''), `${nom} : adresse javascript: refusée (${lu[nom]})`)
          for (const nom of ['onclick', 'onmouseover', 'etaleClic']) assert.ok(!/alert/.test(lu[nom] ?? ''), `${nom} : gestionnaire refusé (${lu[nom]})`)
          assert.ok(!/script/.test(lu.srcdoc ?? ''), 'srcdoc refusé')
          assert.deepEqual(lu.sur, ['actif', '7', 'etiquette', 'false', 'titre', 'titre', 'x', 'ligne', '8', 'ligne'])
          assert.deepEqual(graves(o), [])
        }
        finally {
          await o.fermer()
        }
      }
      finally {
        await browser.close()
      }
    })
  }
})
