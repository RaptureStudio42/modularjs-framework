// un attribut global écrit en clair sur la balise d'un composant (`tabIndex="0"`) va à la prop que le composant déclare, quelle que soit la casse,
// dans Chromium, Firefox et WebKit, en production : le HTML du navigateur écrit le nom de l'attribut en minuscules (`tabindex`), la prop `$tabIndex`
// comme la prop `$tabindex` reçoit la valeur, à la racine comme dans un {for}, puis la suit quand la page change l'attribut. La balise ne porte que
// les attributs que la page écrit ; un composant qui ne déclare pas la prop ne la reçoit pas

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS, fermer } from './helpers/sortable-navigateur.js'

const SOURCES: Record<string, string> = {
  'tab-page.mjs': `<script>
  $liste = [{ key: 'k' }]
</script>
<@tab-haut class="a" tabIndex="0"></@tab-haut>
<@tab-bas class="b" TABINDEX="-1"></@tab-bas>
<@tab-rien class="d" tabIndex="-3"></@tab-rien>
{for x in $liste by key}<@tab-haut class="e" tabIndex="-4"></@tab-haut>{end}
`,
  'tab-haut.mjs': '<script>\n  $tabIndex = 1\n</script>\n<p class="v">{$tabIndex}</p>\n',
  'tab-bas.mjs': '<script>\n  $tabindex = 1\n</script>\n<p class="v">{$tabindex}</p>\n',
  'tab-rien.mjs': '<p class="v">rien</p>\n',
}

// la prop que chaque balise déclare (`tab-rien` : aucune, sa clé n'est lue que pour dire qu'elle n'existe pas)
const CLE     = { a: 'tabIndex', b: 'tabindex', d: 'tabIndex', e: 'tabIndex' }
const PRETE   = `(() => { const S = document.querySelector('mjs-tab-page')?._shadow; if (!S) return false; return ${JSON.stringify(Object.keys(CLE))}.every((c) => !!S.querySelector('.' + c)?._shadow?.querySelector('.v')) })()`
// chaque balise : son attribut tabindex, sa prop, ce qu'elle affiche, et les noms de ses attributs hors de ceux du framework
const LIRE    = `(() => { const S = document.querySelector('mjs-tab-page')._shadow; const cle = ${JSON.stringify(CLE)}; return Object.keys(cle).map((c) => { const n = S.querySelector('.' + c); return c + ' attribut=' + JSON.stringify(n.getAttribute('tabindex')) + ' ' + cle[c] + '=' + JSON.stringify(n._state[cle[c]]) + ' affiché=' + JSON.stringify(n._shadow.querySelector('.v').textContent) + ' [' + Array.from(n.attributes).map((a) => a.name).filter((m) => !m.startsWith('mjs-')).sort().join(' ') + ']' }) })()`

for (const nom of NAVIGATEURS) describe(`attribut global écrit en clair sur un composant : la prop déclarée le reçoit sans la casse (${nom}, production)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let built = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await construire('attribut-en-clair-casse', SOURCES, true)
    browser = await (await import('playwright'))[nom].launch()
  })
  after(async () => { await browser?.close(); await fermer() })
  beforeEach(function () { if (!present) this.skip() })

  it('la prop déclarée reçoit la valeur écrite en clair et suit l\'attribut ; aucun autre attribut sur la balise', async () => {
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 600 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e).slice(0, 300)))
    await page.addInitScript('window.__name = function (f) { return f };')
    await page.route('http://h.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"><mjs-tab-page></mjs-tab-page><script type="module" src="/out/bundle.js"></script></body></html>' })
      const fichier = join(built.root, normalize(chemin))
      if (chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    try {
      await page.goto('http://h.test/', { waitUntil: 'load' })
      await page.waitForFunction(PRETE, null, { timeout: 15000 }).catch(() => { throw new Error('la page ne démarre pas : ' + (erreurs.join(' | ') || 'aucune erreur de page')) })
      assert.deepEqual(await page.evaluate(LIRE), [
        'a attribut="0" tabIndex="0" affiché="0" [class tabindex]',
        'b attribut="-1" tabindex="-1" affiché="-1" [class tabindex]',
        'd attribut="-3" tabIndex=undefined affiché="rien" [class tabindex]',
        'e attribut="-4" tabIndex="-4" affiché="-4" [class tabindex]',
      ], 'au départ')
      await page.evaluate(`(() => { const S = document.querySelector('mjs-tab-page')._shadow; S.querySelector('.a').setAttribute('tabindex', '-6'); S.querySelector('.e').setAttribute('tabindex', '-7') })()`)
      await page.waitForFunction(`(() => { const S = document.querySelector('mjs-tab-page')._shadow; return S.querySelector('.a')._shadow.querySelector('.v').textContent === '-6' && S.querySelector('.e')._shadow.querySelector('.v').textContent === '-7' })()`, null, { timeout: 5000 }).catch(() => { throw new Error('la prop ne suit pas l\'attribut changé') })
      assert.deepEqual((await page.evaluate(LIRE)).filter((l: string) => /^[ae] /.test(l)), [
        'a attribut="-6" tabIndex="-6" affiché="-6" [class tabindex]',
        'e attribut="-7" tabIndex="-7" affiché="-7" [class tabindex]',
      ], 'après le changement de l\'attribut')
      assert.deepEqual(erreurs, [], 'aucune erreur de page')
    }
    finally {
      await ctx.close()
    }
  })
})
