// Un composant pas encore rendu ne montre RIEN de ce qu'il contient, même un descendant en `visibility:visible` (classe `visible`
// de Tailwind, `.visible` de Bootstrap) ; la balise d'une autre bibliothèque n'est jamais touchée, et une balise `mjs-*` mal
// écrite s'affiche telle qu'elle est écrite. Vrais navigateurs (Chromium, Firefox, WebKit), vrai build en fichiers séparés servi
// par HTTP, module d'un composant et fragment de traduction retenus par le serveur.
//
// Pourquoi ce test existe : le bouclier du cœur (`µ._mjs_shield`, mjs_init.ts) cache par `visibility:hidden` pour garder la place
// d'un composant en attente. `visibility` s'hérite, mais un descendant qui écrit `visibility:visible` reparaît : il était peint,
// cliquable, pris par Tab et lu par un lecteur d'écran au milieu d'une balise cachée (avec `display:none`, rien de tout cela).
// Et le bouclier visait toute balise `:not(:defined)` : celle d'une autre bibliothèque (jamais définie, ou définie plus tard par
// elle) et une balise `mjs-*` mal écrite restaient des trous invisibles, à vie. Il vise désormais les seules balises que le
// chargeur va définir (celles du manifeste), elles et tout ce qu'elles contiennent, ombre comprise pour un module gelé par
// l'attente de sa langue.
//
// Ce que le test garde, pendant l'attente : les boutons en `visibility:visible` (normal et `!important`) dans `<mjs-lent>` (module
// retenu) et celui du gabarit de `<mjs-gele>` (défini, gelé par son fragment retenu) ne se voient pas, ne reçoivent pas le clic,
// ne prennent pas le focus au clavier, et (Chromium) ne sont pas exposés à l'arbre d'accessibilité ; `<mjs-lent>` garde la place
// de son contenu ; le contenu de `<autre-lib>` et de `<mjs-tyop>` se voit ; l'Autoloader dit `tyop` absent du manifeste. À
// l'arrivée du module, `<mjs-lent>` se rend et se voit.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const TETE  = '<style>body{margin:0;font:16px/1.4 sans-serif} .vis{visibility:visible} .vis-imp{visibility:visible!important}</style>'
const CORPS = [
  '<div id="m0">M0</div>',
  '<autre-lib id="ext"><p id="p-ext">Repli tiers</p><button id="b-ext" class="vis">tiers</button></autre-lib>',
  '<div id="m1">M1</div>',
  '<mjs-tyop id="typo"><p id="p-typo">Texte faute</p></mjs-tyop>',
  '<div id="m2">M2</div>',
  '<mjs-lent id="lent"><button id="b-lent" class="vis">dans lent</button><p>texte lent</p><div><button id="b-imp" class="vis-imp">important</button></div></mjs-lent>',
  '<div id="m3">M3</div>',
  '<mjs-gele id="gele"></mjs-gele>',
  '<div id="m4">M4</div>',
  '<input id="fin">'
].join('')

interface Serveur { base: string, server: Server, vus: Set<string>, liberer: () => void, retenir: () => void }

async function construire(): Promise<Serveur> {
  const root   = mjsTmp('bouclier-descendants')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'titre: Bonjour accueil\n')
  writeFileSync(join(srcDir, 'lent.mjs'), ['<p class="lent">LENT</p>', ''].join('\n'))
  writeFileSync(join(srcDir, 'gele.mjs'), ["@i18n 'accueil'", '', '<h2 class="t">{µt(\'titre\')}</h2>', '<button class="vis">dans gele</button>', '', '<style>', '  .vis', '    visibility: visible', '</style>', ''].join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n: { default: 'fr', placeholder: 'wait' } }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'dev' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  let attente: Array<() => void> = []
  let ouvert  = false
  const vus   = new Set<string>()
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html><head><meta charset="utf-8">${TETE}<script type="module" src="/out/bundle.js"></script></head><body>${CORPS}</body></html>`)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const envoyer = () => {
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
      res.end(readFileSync(fichier))
    }
    const quoi = /^lent-[0-9a-z]+\.js$/.test(basename(fichier)) ? 'lent' : /\/i18n\/fr\/[^/]+\.json$/.test(chemin) ? 'fragment' : ''
    if (quoi && !ouvert) { vus.add(quoi); attente.push(envoyer); return }
    envoyer()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const liberer = () => { ouvert = true; attente.forEach((f) => f()); attente = [] }
  const retenir = () => { ouvert = false; vus.clear() }
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server, vus, liberer, retenir }
}

// posée avant tout script : l'ombre d'un composant est fermée (`mode: 'closed'`), le test garde la main sur elle pour la regarder
function garderLesOmbres(): void {
  const attacher = Element.prototype.attachShadow
  Element.prototype.attachShadow = function (this: any, init: ShadowRootInit) { const r = attacher.call(this, init); this.__ombre = r; return r }
}

// l'état de la page pendant l'attente, en chaînes, nombres et booléens seulement
function relever(): any {
  const r      = (el: Element) => el.getBoundingClientRect()
  const vu     = (el: Element | null) => !!el && (el as any).checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })
  // le point du milieu de `el` le désigne-t-il ? (dans une ombre fermée, le document ne voit que l'hôte : on demande à l'ombre)
  const touche = (el: Element) => { const b = r(el); const racine: any = el.getRootNode(); const e = (racine.elementFromPoint ? racine : document).elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return e === el }
  const gele   = document.querySelector('mjs-gele')!
  const ombre  = (gele as any).__ombre as ShadowRoot | undefined
  const bGele  = ombre ? ombre.querySelector('button') : null
  const bLent  = document.getElementById('b-lent')!
  const bImp   = document.getElementById('b-imp')!
  return {
    lentDefini: !!customElements.get('mjs-lent'), geleDefini: !!customElements.get('mjs-gele'), geleGel: gele.hasAttribute('mjs-loading'), geleGabarit: !!bGele,
    vus: { bLent: vu(bLent), bImp: vu(bImp), bGele: vu(bGele), pExt: vu(document.getElementById('p-ext')), bExt: vu(document.getElementById('b-ext')), pTypo: vu(document.getElementById('p-typo')) },
    clic: { bLent: touche(bLent), bImp: touche(bImp), bGele: bGele ? touche(bGele) : false },
    placeLent: Math.round(r(document.getElementById('m3')!).top - r(document.getElementById('m2')!).bottom)
  }
}

async function navigateurPresent(nom: string): Promise<boolean> {
  try {
    const playwright: any = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

let serveur: Promise<Serveur> | null = null

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`bouclier : rien ne sort d'un composant en attente, rien n'est pris aux autres balises — ${nom} réel`, function () {
    this.timeout(120000)
    let browser: any = null
    let s: Serveur

    before(async function () {
      if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté`); this.skip() }
      serveur ??= construire()
      s = await serveur
      browser = await (await import('playwright'))[nom].launch()
    })

    after(async () => { await browser?.close() })

    it('descendants visibles cachés, ni clic ni focus ni lecteur d\'écran ; balises tierces et mal écrites intactes', async () => {
      const page   = await browser.newPage({ viewport: { width: 800, height: 900 } })
      const lignes: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') lignes.push(m.type() + ' ' + m.text()) })
      s.retenir()
      try {
        await page.addInitScript(garderLesOmbres)
        await page.goto(s.base + '/', { waitUntil: 'domcontentloaded' })
        const debut = Date.now()
        while (s.vus.size < 2 && Date.now() - debut < 15000) await page.waitForTimeout(50)
        assert.equal(s.vus.size, 2, 'le module de <mjs-lent> et le fragment de <mjs-gele> sont demandés, et retenus')
        await page.waitForTimeout(400)
        const attente = await page.evaluate(relever)
        await page.evaluate(() => { (document.activeElement as any)?.blur?.() })
        const tabs: string[] = []
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press('Tab')
          tabs.push(await page.evaluate(() => { const a = document.activeElement as any; return a ? (a.id || a.tagName) : '' }))
        }
        let ax: string[] = []
        if (nom === 'chromium') {
          const cdp = await page.context().newCDPSession(page)
          const { nodes } = await cdp.send('Accessibility.getFullAXTree')
          ax = nodes.filter((n: any) => !n.ignored && n.name && ['dans lent', 'important', 'dans gele'].includes(n.name.value)).map((n: any) => (n.role && n.role.value) + ':' + n.name.value)
        }
        console.log(`      ${nom} — attente ${JSON.stringify(attente)} tabs ${JSON.stringify(tabs)} ax ${JSON.stringify(ax)}`)

        assert.equal(attente.lentDefini, false, 'relevé pris pendant l\'attente du module')
        assert.deepEqual([attente.vus.bLent, attente.vus.bImp], [false, false], 'un descendant en visibility:visible (normal, !important) d\'un module en route ne se voit pas')
        assert.deepEqual([attente.clic.bLent, attente.clic.bImp], [false, false], 'il ne reçoit pas le clic')
        // le focus dans l'ombre (fermée) de <mjs-gele> se lit sur son hôte, `gele`
        assert.ok(!tabs.some((t) => t === 'b-lent' || t === 'b-imp' || (attente.geleGel && t === 'gele')), 'il ne prend pas le focus au clavier — ' + JSON.stringify(tabs))
        assert.deepEqual(ax, [], 'il n\'est pas exposé à l\'arbre d\'accessibilité')
        assert.ok(attente.placeLent > 20, `le module en route garde la place de son contenu : ${attente.placeLent} px`)
        assert.deepEqual([attente.geleDefini, attente.geleGel, attente.geleGabarit], [true, true, true], '<mjs-gele> est défini, gelé par son fragment retenu, son gabarit posé dans son ombre')
        assert.deepEqual([attente.vus.bGele, attente.clic.bGele], [false, false], 'le bouton visible du gabarit gelé ne se voit pas et ne reçoit pas le clic')
        assert.deepEqual([attente.vus.pExt, attente.vus.bExt], [true, true], 'la balise d\'une autre bibliothèque n\'est pas touchée : son contenu se voit')
        assert.equal(attente.vus.pTypo, true, 'une balise mjs-* mal écrite s\'affiche telle qu\'elle est écrite')
        assert.ok(lignes.some((l) => /^error \[Autoloader\].*'tyop'/.test(l)), 'l\'Autoloader la dit absente du manifeste — ' + JSON.stringify(lignes))

        s.liberer()
        await page.waitForFunction(() => !!customElements.get('mjs-lent') && !document.querySelector('mjs-lent')!.hasAttribute('mjs-loading'), null, { timeout: 15000 })
        await page.waitForTimeout(200)
        const fin = await page.evaluate(() => { const o = (document.querySelector('mjs-lent') as any).__ombre; const p = o && o.querySelector('p'); return !!p && p.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }) })
        assert.equal(fin, true, 'à l\'arrivée du module, <mjs-lent> se rend et se voit')
      }
      finally {
        s.liberer()
        await page.close()
      }
    })
  })
}

after(async () => {
  if (serveur) (await serveur).server.close()
  await terminateSharedWorkerPool()
})
