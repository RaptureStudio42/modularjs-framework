// `hidden` sur la balise d'un composant le cache, comme sur une balise HTML, dans Chromium, Firefox et WebKit, en production : calculé
// (`hidden={$h}`) ou écrit en clair (`hidden`), sur un composant sans style, sur un composant qui pose lui-même `:host { display: block }`,
// sur un composant monté sans Shadow DOM (`@lightDom`) et sur `<@@select>` ; `hidden={false}` le montre. Un composant qui déclare une prop
// `hidden` la garde pour lui : une fiche qui lit `$hidden` et `<@@chart hidden>` restent affichés. Le style de la page passe encore devant,
// comme pour une balise HTML (`display: flex` sur la balise d'un composant caché le montre). `hidden="until-found"` reste au navigateur, comme
// sur une balise HTML : la balise garde son affichage, son contenu est caché par le navigateur et la recherche de la page le trouve et le révèle

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS, fermer } from './helpers/sortable-navigateur.js'

const SOURCES: Record<string, string> = {
  'hid-page.mjs': `<script>
  $h = true
</script>
<@hid-carte class="a" hidden={$h}></@hid-carte>
<@hid-bloc class="b" hidden></@hid-bloc>
<@hid-leger class="l" @lightDom hidden={$h}></@hid-leger>
<@@select class="s" hidden={$h}>
  <@@option value="a">A</@@option>
</@@select>
<@hid-fiche class="f" hidden></@hid-fiche>
<@@chart class="g" hidden></@@chart>
<@hid-carte class="p" hidden></@hid-carte>
<button class="go" @click={$h = false}>montrer</button>
<style>
  :host
    display: block
  .p
    display: flex
</style>
`,
  'hid-carte.mjs': '<p class="c">carte</p>\n',
  'hid-bloc.mjs': '<p class="c">bloc</p>\n<style>\n  :host\n    display: block\n</style>\n',
  'hid-leger.mjs': '<p class="c">léger</p>\n',
  'hid-fiche.mjs': '<script>\n  $hidden = []\n</script>\n<p class="c">fiche {$hidden}</p>\n',
  'hid-cherche.mjs': '<script>\n  $mot = \'\'\n</script>\n<p class="c">{$mot}</p>\n',
  'hid-trouve-page.mjs': `<@hid-cherche class="u" mot="motombre" hidden="until-found"></@hid-cherche>
<@hid-cherche class="U" mot="motcasse" hidden="UNTIL-FOUND"></@hid-cherche>
<@hid-cherche class="v" mot="motleger" @lightDom hidden="until-found"></@hid-cherche>
<@hid-cherche class="h" mot="motcache" hidden></@hid-cherche>
<div class="n" hidden="until-found"><p class="c">motnatif</p></div>
`,
}

// la page de la recherche : chaque balise, son affichage, la visibilité du contenu (checkVisibility) et son attribut `hidden`
const TROUVE_PRETE = `(() => { const S = document.querySelector('mjs-hid-trouve-page')?._shadow; if (!S) return false; return ['u', 'U', 'h'].every((c) => S.querySelector('.' + c)?._shadow?.querySelector('.c')?.textContent) && !!S.querySelector('.v .c')?.textContent })()`
const TROUVE_LIRE  = `(async () => { const img = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const S = document.querySelector('mjs-hid-trouve-page')._shadow; const vu = () => JSON.stringify(['u', 'U', 'v', 'h', 'n'].map((c) => { const n = S.querySelector('.' + c); const p = (n._shadow ?? n).querySelector('.c'); const st = getComputedStyle(n); return c + ':' + st.display + ':' + st.contentVisibility + ':' + (p.checkVisibility() ? 'vu' : 'caché') + ':' + (n.hasAttribute('hidden') ? (n.getAttribute('hidden') || 'hidden') : 'révélé') })); let v = vu(), k = 0; for (let i = 0; i < 100 && k < 2; i++) { await img(); const w = vu(); if (w === v) k++; else { v = w; k = 0 } } return JSON.parse(v) })()`
const TROUVE_HTML  = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"><mjs-hid-trouve-page></mjs-hid-trouve-page><script type="module" src="/out/bundle.js"></script></body></html>'

const CLASSES = ['a', 'b', 'l', 's', 'f', 'g', 'p']
const PRETE   = `(() => { const S = document.querySelector('mjs-hid-page')?._shadow; if (!S) return false; const q = (c) => S.querySelector('.' + c); return !!(q('a')?._shadow?.querySelector('.c') && q('b')?._shadow?.querySelector('.c') && q('l')?.querySelector('.c') && q('s')?._shadow?.querySelector('.select-btn') && q('f')?._shadow?.querySelector('.c') && q('p')?._shadow?.querySelector('.c') && customElements.get('mjs-core-chart') && q('g')?._shadow?.firstElementChild) })()`
// ce qui manque quand la page ne démarre pas
const DIAG    = `(() => { const S = document.querySelector('mjs-hid-page')?._shadow; if (!S) return 'pas de page'; return ${JSON.stringify(CLASSES)}.map((c) => { const n = S.querySelector('.' + c); return c + ':' + (n ? (customElements.get(n.localName) ? 'défini' : 'non défini') + (n._shadow ? ' rendu ' + n._shadow.childElementCount : ' sans rendu') : 'absent') }) })()`
// l'affichage de chaque balise, relu jusqu'à deux images de suite identiques (jamais une durée fixe)
const LIRE    = `(async () => { const S = document.querySelector('mjs-hid-page')._shadow; const vu = () => JSON.stringify(${JSON.stringify(CLASSES)}.map((c) => { const n = S.querySelector('.' + c); return c + ':' + getComputedStyle(n).display + (n.hasAttribute('hidden') ? ':hidden' : '') })); const image = () => new Promise((r) => requestAnimationFrame(() => r(null))); let avant = vu(); for (let i = 0; i < 300; i++) { await image(); const ici = vu(); if (ici === avant) return JSON.parse(ici); avant = ici } throw new Error('aucun état stable en 300 images') })()`

for (const nom of NAVIGATEURS) describe(`hidden sur la balise d'un composant : caché comme une balise HTML (${nom}, production)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let built = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await construire('hidden-cache-la-balise', SOURCES, true)
    browser = await (await import('playwright'))[nom].launch()
  })
  after(async () => { await browser?.close(); await fermer() })
  beforeEach(function () { if (!present) this.skip() })

  it('caché quand il porte `hidden`, montré quand `hidden={false}` le retire ; une prop `hidden` déclarée et le style de la page le gardent affiché', async () => {
    const ctx  = await browser.newContext({ viewport: { width: 900, height: 700 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e).slice(0, 300)))
    await page.addInitScript('window.__name = function (f) { return f };')
    await page.route('http://h.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"><mjs-hid-page></mjs-hid-page><script type="module" src="/out/bundle.js"></script></body></html>' })
      const fichier = join(built.root, normalize(chemin))
      if (chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    try {
      await page.goto('http://h.test/', { waitUntil: 'load' })
      await page.waitForFunction(PRETE, null, { timeout: 15000 }).catch(async () => { throw new Error('la page ne démarre pas : ' + (erreurs.join(' | ') || 'aucune erreur de page') + ' / ' + JSON.stringify(await page.evaluate(DIAG))) })
      assert.deepEqual(await page.evaluate(LIRE), ['a:none:hidden', 'b:none:hidden', 'l:none:hidden', 's:none:hidden', 'f:block:hidden', 'g:block:hidden', 'p:flex:hidden'], 'au départ, `hidden` posé')
      await page.evaluate(`document.querySelector('mjs-hid-page')._shadow.querySelector('.go').click()`)
      assert.deepEqual(await page.evaluate(LIRE), ['a:block', 'b:none:hidden', 'l:block', 's:inline-block', 'f:block:hidden', 'g:block:hidden', 'p:flex:hidden'], 'après `$h = false`')
      assert.deepEqual(erreurs, [], 'aucune erreur de page')
    }
    finally {
      await ctx.close()
    }
  })

  it('`hidden="until-found"` : la balise garde son affichage, le navigateur cache le contenu, et la recherche de la page le révèle comme sur une balise HTML', async () => {
    const ctx  = await browser.newContext({ viewport: { width: 900, height: 700 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e).slice(0, 300)))
    await page.addInitScript('window.__name = function (f) { return f };')
    await page.route('http://h.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/trouve') return route.fulfill({ contentType: 'text/html', body: TROUVE_HTML })
      const fichier = join(built.root, normalize(chemin))
      if (chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    // la page ouverte sur un fragment de texte (`#:~:text=…`) : ce que la recherche du navigateur trouve, il le révèle
    const ouvrir = async (fragment: string): Promise<string[]> => {
      await page.goto('http://h.test/trouve' + fragment, { waitUntil: 'load' })
      await page.waitForFunction(TROUVE_PRETE, null, { timeout: 15000 })
      return page.evaluate(TROUVE_LIRE)
    }
    try {
      const depart = await ouvrir('')
      assert.deepEqual(depart, ['u:block:hidden:caché:until-found', 'U:block:hidden:caché:UNTIL-FOUND', 'v:block:hidden:caché:until-found', 'h:none:visible:caché:true', 'n:block:hidden:caché:until-found'], 'au départ, comme la balise HTML `n`')
      const natif = (await ouvrir('#:~:text=motnatif')).find((x) => x.startsWith('n:'))!
      for (const [classe, mot] of [['u', 'motombre'], ['v', 'motleger']]) {
        const vu = (await ouvrir('#:~:text=' + mot)).find((x) => x.startsWith(classe + ':'))!
        assert.equal(vu.slice(1), natif.slice(1), `${classe} trouvé par la recherche comme la balise HTML : ${vu} / ${natif}`)
      }
      if (nom === 'chromium') assert.equal(natif, 'n:block:visible:vu:révélé', 'Chromium révèle ce que sa recherche trouve')
      assert.deepEqual(erreurs, [], 'aucune erreur de page')
    }
    finally {
      await ctx.close()
    }
  })
})
