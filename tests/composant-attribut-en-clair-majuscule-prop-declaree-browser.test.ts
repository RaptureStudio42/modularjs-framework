// une prop au nom en camelCase écrite EN CLAIR sur la balise d'un composant (`<@fiche userName="u">`) : le HTML du navigateur écrit le nom de
// l'attribut en minuscules (`username`), et la prop que l'enfant déclare (`$userName`, dans son script ou lue par son gabarit) reçoit la valeur sous
// son nom, puis la suit quand la page change l'attribut. Seule une prop déclarée est visée : sans prop de ce nom, l'attribut reste ce qu'il est (la
// prop `autrenom` d'un `autreNom="x"`) ; un enfant qui déclare deux props qui ne diffèrent que par la casse (`$userName`, `$username`) donne la valeur à
// celle dont le nom est exactement celui de l'attribut (`$username`). En développement, en production, et rendu par le serveur puis repris (`markers`,
// production) : le serveur écrit déjà la valeur, la reprise garde ses nœuds. Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, normalize, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { construire, navigateurPresent, NAVIGATEURS, fermer } from './helpers/sortable-navigateur.js'
import { Bundler } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

// la page a un état à elle : rendue par le serveur, elle est reprise avec ses nœuds, ceux de ses enfants aussi
const SOURCES: Record<string, string> = {
  'fiche-page.mjs': '<script>\n  $titre = \'fiches\'\n</script>\n<p class="t">{$titre}</p>\n<@fiche-nom class="a" userName="u"></@fiche-nom>\n<@fiche-lue class="b" userName="v"></@fiche-lue>\n<@fiche-deux class="c" userName="w"></@fiche-deux>\n<@fiche-nom class="d" autreNom="x"></@fiche-nom>\n',
  'fiche-nom.mjs':  '<script>\n  $userName = \'défaut\'\n</script>\n<p class="v">{$userName}</p>\n',
  'fiche-lue.mjs':  '<p class="v">{$userName}</p>\n',
  'fiche-deux.mjs': '<script>\n  $userName = \'camel\'\n  $username = \'bas\'\n</script>\n<p class="v">{$userName}|{$username}</p>\n',
}

const CLASSES = ['a', 'b', 'c', 'd']
const PRETE   = `(() => { const S = document.querySelector('mjs-fiche-page')?._shadow; return !!S && ${JSON.stringify(CLASSES)}.every((c) => { const n = S.querySelector('.' + c); return !!n && n.matches(':defined') && !n.hasAttribute('mjs-loading') && !!n._shadow?.querySelector('.v') }) })()`
// chaque balise : ses props visées, ce qu'elle affiche, et les noms de ses attributs hors de ceux du framework
const LIRE    = `(() => { const S = document.querySelector('mjs-fiche-page')._shadow; const v = (x) => x === undefined ? 'undefined' : JSON.stringify(x); return ${JSON.stringify(CLASSES)}.map((c) => { const n = S.querySelector('.' + c); const cles = c === 'd' ? ['userName', 'autrenom', 'autreNom'] : ['userName', 'username']; return c + ' ' + cles.map((k) => k + '=' + v(n._state[k])).join(' ') + ' affiché=' + JSON.stringify(n._shadow.querySelector('.v').textContent) + ' [' + Array.from(n.attributes).map((a) => a.name).filter((m) => !m.startsWith('mjs-')).sort().join(' ') + ']' }) })()`
const ATTENDU = [
  'a userName="u" username=undefined affiché="u" [class username]',
  'b userName="v" username=undefined affiché="v" [class username]',
  'c userName="camel" username="w" affiché="camel|w" [class username]',
  'd userName="défaut" autrenom="x" autreNom=undefined affiché="défaut" [autrenom class]',
]

// avant le bundle de la page servie : chaque élément écrit par le serveur porte un tampon, et le texte que le serveur a écrit dans chaque enfant est relevé
const TAMPON = `<script>(function () { function t(r) { r.querySelectorAll('*').forEach(function (n) { n.__srv = true; if (n.shadowRoot) t(n.shadowRoot) }) } document.querySelectorAll('*').forEach(function (h) { if (h.shadowRoot) t(h.shadowRoot) }); var S = document.querySelector('mjs-fiche-page').shadowRoot; window.__servi = ${JSON.stringify(CLASSES)}.map(function (c) { var n = S && S.querySelector('.' + c); var p = n && n.shadowRoot && n.shadowRoot.querySelector('.v'); return c + '=' + (p ? JSON.stringify(p.textContent) : 'absent') }) })()</script>`

type Mode      = 'développement' | 'production' | 'serveur puis reprise'
type Construit = Record<Mode, { corps: string, fichier: (chemin: string) => Buffer | null }>
let construit: Promise<Construit> | null = null

// les trois builds, faits une fois pour les trois navigateurs
function toutConstruire(): Promise<Construit> {
  construit ??= (async () => {
    const dev    = await construire('attribut-majuscule', SOURCES, false)
    const prod   = await construire('attribut-majuscule', SOURCES, true)
    const root   = mjsTmp('attribut-majuscule-serveur')
    const srcDir = join(root, 'src')
    const rendu  = join(root, 'rendu')
    const out    = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: rendu, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const r        = await renderer.renderToString('mjs-fiche-page', { ssrMode: 'markers' } as any)
    await renderer.close()
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env: 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const feuilles = new Set(readdirSync(rendu).filter((n) => /^mjs_ssr_style_.*\.css$/.test(n)))
    const servi    = (dossier: string) => (chemin: string): Buffer | null => {
      if (feuilles.has(basename(chemin))) return readFileSync(join(rendu, basename(chemin)))
      const f = join(dossier, normalize(chemin))
      return chemin.startsWith('/out/') && existsSync(f) ? readFileSync(f) : null
    }
    return {
      'développement':        { corps: `<mjs-fiche-page></mjs-fiche-page><script>${dev.script}</script>`, fichier: () => null },
      'production':           { corps: '<mjs-fiche-page></mjs-fiche-page><script type="module" src="/out/bundle.js"></script>', fichier: servi(prod.root) },
      'serveur puis reprise': { corps: `${r.html}\n${r.hydrateScript}\n${TAMPON}\n<script type="module" src="/out/bundle.js"></script>`, fichier: servi(root) },
    }
  })()
  return construit
}

for (const nom of NAVIGATEURS) describe(`attribut en camelCase écrit en clair sur un composant : la prop déclarée le reçoit (${nom})`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let builds: Construit

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    builds  = await toutConstruire()
    browser = await (await import('playwright'))[nom].launch()
  })
  after(async () => { await browser?.close(); await fermer() })
  beforeEach(function () { if (!present) this.skip() })

  for (const mode of ['développement', 'production', 'serveur puis reprise'] as Mode[]) {
    it(`${mode} : la prop déclarée reçoit la valeur et suit l'attribut ; sans prop déclarée, rien ne change ; deux props à la casse près : l'exacte`, async () => {
      const { corps, fichier } = builds[mode]
      const ctx  = await browser.newContext({ viewport: { width: 800, height: 600 } })
      const page = await ctx.newPage()
      page.setDefaultTimeout(8000)
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e).slice(0, 300)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
      await page.addInitScript('window.__name = function (f) { return f };')
      await page.route('http://m.test/**', (route: any) => {
        const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
        if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0">${corps}</body></html>` })
        const contenu = fichier(chemin)
        if (contenu) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : chemin.endsWith('.css') ? 'text/css' : 'application/json', body: contenu })
        return route.fulfill({ status: 404, body: '' })
      })
      try {
        await page.goto('http://m.test/', { waitUntil: 'load' })
        await page.waitForFunction(PRETE, null, { timeout: 15000 }).catch(() => { throw new Error('la page ne démarre pas : ' + (erreurs.join(' | ') || 'aucune erreur de page')) })
        if (mode === 'serveur puis reprise') {
          assert.deepEqual(await page.evaluate('window.__servi'), ['a="u"', 'b="v"', 'c="camel|w"', 'd="défaut"'], 'le texte que le serveur écrit')
          assert.deepEqual(await page.evaluate(`(() => { const S = document.querySelector('mjs-fiche-page')._shadow; return ${JSON.stringify(CLASSES)}.filter((c) => S.querySelector('.' + c)._shadow.querySelector('.v').__srv !== true) })()`), [], 'les enfants reprennent les nœuds du serveur')
        }
        assert.deepEqual(await page.evaluate(LIRE), ATTENDU, 'au départ')
        await page.evaluate(`document.querySelector('mjs-fiche-page')._shadow.querySelector('.a').setAttribute('username', 'u2')`)
        await page.waitForFunction(`document.querySelector('mjs-fiche-page')._shadow.querySelector('.a')._shadow.querySelector('.v').textContent === 'u2'`, null, { timeout: 5000 }).catch(() => { throw new Error('la prop ne suit pas l\'attribut changé') })
        assert.equal((await page.evaluate(LIRE))[0], 'a userName="u2" username=undefined affiché="u2" [class username]', 'après le changement de l\'attribut')
        assert.deepEqual(erreurs, [], 'aucune erreur de page')
      }
      finally {
        await ctx.close()
      }
    })
  }
})
