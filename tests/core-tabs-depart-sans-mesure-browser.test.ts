// module cœur tabs (<@@tabs>) : le module mesure sa barre (`getBoundingClientRect`) au premier rendu, à chaque
// changement de valeur et chaque fois que la barre change de taille (un ResizeObserver). Quand il quitte la page
// SANS être détruit — l'arbre est rangé dans le cache de pages (`µ._mjs_navHibernate`), ce que fait chaque lien
// interne du site —, `µdestroy` ne joue pas : l'observateur restait branché, il livrait au tour d'affichage suivant
// la taille 0×0 de la barre sortie de la page, et `sync` lisait `boxRef`, déjà remis à `null` :
// « Cannot read properties of null (reading 'getBoundingClientRect') ».
// Ce test garantit qu'à chaque départ (cache de pages, retrait pour de bon) aucune mesure ni aucun écouteur du module
// ne reste, que le retour depuis le cache remet le module au travail, et qu'un montage rejoué n'empile pas d'observateurs.
// Chromium et Firefox réels, pas happy-dom : le défaut tient à la livraison d'un ResizeObserver pour une barre sortie de la page.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const ONGLETS = '<a value="a" icon="⌂">Accueil</a><a value="b" icon="☺">Profil</a><a value="c" icon="?">Aide</a>'

const SOURCES: Record<string, string> = {
  'banc.mjs': [
    '<script>',
    '  $t = \'b\'',
    '</script>',
    '<div class="courbe"><@@tabs layout="curve" value=!{$t}>' + ONGLETS + '</@@tabs></div>',
    '<div class="barre"><@@tabs value=!{$t}>' + ONGLETS + '</@@tabs></div>',
    '<style>',
    '  a',
    '    transition: none',
    '  mjs-core-tabs::part(indicator)',
    '    transition: none',
    '  .courbe a.grand',
    '    min-height: 140px',
    '  .barre a.grand',
    '    font-size: 3em',
    '</style>',
    ''
  ].join('\n')
}

// posé dans la page AVANT le runtime : il note chaque cible qu'un ResizeObserver observe encore et chaque écouteur
// click/keydown/slotchange encore branché, puis rend ce que les modules tabs de la page en tiennent
const SUIVI = [
  '(function () {',
  '  var w = window',
  '  w.__ro = []',
  '  var RO = w.ResizeObserver',
  '  w.ResizeObserver = class extends RO {',
  '    constructor(cb) { super(cb); this.__cibles = new Set(); w.__ro.push(this) }',
  '    observe(el, o) { this.__cibles.add(el); return super.observe(el, o) }',
  '    unobserve(el) { this.__cibles.delete(el); return super.unobserve(el) }',
  '    disconnect() { this.__cibles.clear(); return super.disconnect() }',
  '  }',
  '  w.__ecoute = new Map()',
  '  var add = EventTarget.prototype.addEventListener',
  '  var rem = EventTarget.prototype.removeEventListener',
  '  var cle = function (type, o) { return type + \'|\' + (typeof o === \'boolean\' ? o : !!(o && o.capture)) }',
  '  EventTarget.prototype.addEventListener = function (type, l, o) {',
  '    if (l && (type === \'click\' || type === \'keydown\' || type === \'slotchange\')) {',
  '      var m = w.__ecoute.get(this); if (!m) w.__ecoute.set(this, m = new Map())',
  '      var s = m.get(cle(type, o)); if (!s) m.set(cle(type, o), s = new Set())',
  '      s.add(l)',
  '    }',
  '    return add.call(this, type, l, o)',
  '  }',
  '  EventTarget.prototype.removeEventListener = function (type, l, o) {',
  '    var m = w.__ecoute.get(this)',
  '    if (m) { var s = m.get(cle(type, o)); if (s) { s.delete(l); if (!s.size) m.delete(cle(type, o)) } }',
  '    return rem.call(this, type, l, o)',
  '  }',
  '  w.__banc = function () { return document.querySelector(\'mjs-banc\') || w.__rangee }',
  '  // ce que les modules tabs tiennent encore : cibles observées dans leur racine, écouteurs sur leur hôte et leur fente',
  '  w.__bilan = function () {',
  '    var cibles = [], hotes = [], fentes = []',
  '    w.__banc()._shadow.querySelectorAll(\'mjs-core-tabs\').forEach(function (tabs) {',
  '      w.__ro.forEach(function (o) { o.__cibles.forEach(function (el) { if (el.getRootNode() === tabs._shadow) cibles.push(el.className) }) })',
  '      var sur = function (cible) { var m = w.__ecoute.get(cible); return m ? Array.from(m.keys()) : [] }',
  '      hotes.push(sur(tabs).join())',
  '      fentes.push(sur(tabs._shadow.querySelector(\'slot\')).join())',
  '    })',
  '    return { cibles: cibles, hotes: hotes, fentes: fentes }',
  '  }',
  '  // l\'écart, en pixels d\'écran, entre l\'indicateur et l\'onglet actif de chaque bloc',
  '  w.__ecart = function () {',
  '    var out = {}',
  '    w.__banc()._shadow.querySelectorAll(\'div\').forEach(function (bloc) {',
  '      var tabs = bloc.querySelector(\'mjs-core-tabs\')',
  '      var actif = tabs.querySelector(\'[active]\').getBoundingClientRect()',
  '      var courbe = bloc.className === \'courbe\'',
  '      var ind = tabs._shadow.querySelector(courbe ? \'.pill\' : \'.bar\').getBoundingClientRect()',
  '      out[bloc.className] = courbe ? [ind.top - actif.top, ind.height - actif.height] : [ind.left - actif.left, ind.width - actif.width]',
  '    })',
  '    return out',
  '  }',
  '  // l\'onglet actif grandit : la barre du module change de taille, l\'indicateur doit suivre',
  '  w.__grossir = function () {',
  '    w.__banc()._shadow.querySelectorAll(\'mjs-core-tabs [active]\').forEach(function (a) { a.classList.add(\'grand\') })',
  '  }',
  '  // des gestes d\'utilisateur sur chaque module : un clic, une flèche, un onglet ajouté ; rend ce qui en est lu',
  '  w.__exercer = async function () {',
  '    var pause = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }',
  '    var sortie = {}',
  '    var tous = Array.from(w.__banc()._shadow.querySelectorAll(\'mjs-core-tabs\'))',
  '    for (var i = 0; i < tous.length; i++) {',
  '      var tabs = tous[i], onglets = Array.from(tabs.children), bloc = tabs.parentElement.className',
  '      var actif = function () { return onglets.map(function (o, k) { return o.hasAttribute(\'active\') ? k : -1 }).filter(function (k) { return k >= 0 }).join() }',
  '      sortie[bloc] = { depart: actif() }',
  '      onglets[2].click(); await pause(80)',
  '      sortie[bloc].clic = actif()',
  '      onglets[2].dispatchEvent(new KeyboardEvent(\'keydown\', { key: \'ArrowLeft\', bubbles: true, composed: true })); await pause(80)',
  '      sortie[bloc].fleche = actif()',
  '      var neuf = document.createElement(\'a\')',
  '      neuf.setAttribute(\'value\', \'n\' + Date.now())',
  '      tabs.appendChild(neuf); await pause(150)',
  '      sortie[bloc].roles = Array.from(tabs.children).map(function (o) { return o.getAttribute(\'role\') }).join()',
  '      sortie[bloc].nb = tabs.children.length',
  '    }',
  '    return sortie',
  '  }',
  '})()'
].join('\n')

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`mjs-core-tabs (${nom} réel) — le départ du module ne laisse ni mesure ni écouteur`, function () {
    this.timeout(90000)
    let present = false
    let script  = ''
    let browser: any

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test du départ des onglets sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('tabs-depart-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [fichier, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, fichier), source)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
      script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      const lanceur = (await import('playwright'))[nom]
      browser = await lanceur.launch()
    })

    after(async () => {
      await browser?.close()
      await terminateSharedWorkerPool()
    })

    // une page neuve, le banc monté dans une zone, les deux modules prêts ; les erreurs de la page sont recueillies
    const ouvrir = async () => {
      const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(e.message))
      await page.evaluate(SUIVI)
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="zone"><mjs-banc></mjs-banc></div><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => {
        const banc: any = document.querySelector('mjs-banc')
        const tous      = banc?._shadow ? [...banc._shadow.querySelectorAll('mjs-core-tabs')] : []
        return tous.length === 2 && tous.every((t: any) => t._shadow?.querySelector('.ready'))
      })
      await page.waitForTimeout(700)
      return { page, erreurs }
    }

    const bilan = (page: any) => page.evaluate('window.__bilan()')
    const ecart = (page: any) => page.evaluate('window.__ecart()')

    // la page est quittée comme le fait la navigation d'ujs : l'arbre est rangé dans le cache de pages, puis retiré
    const ranger = (page: any) => page.evaluate(() => {
      const w: any    = window
      const zone: any = document.getElementById('zone')
      w.__rangee = document.querySelector('mjs-banc')
      w.µ._mjs_navHibernate(zone, '/accueil')
      zone.replaceChildren()
    })

    // retour sur la page : l'arbre rangé revient tel quel dans la zone
    const rouvrir = (page: any) => page.evaluate(() => {
      const w: any    = window
      const zone: any = document.getElementById('zone')
      const noeuds    = w.µ.pageCache.get('/accueil')
      for (const n of noeuds) n._mjs_page_cached = false
      zone.append(...noeuds)
    })

    // retrait pour de bon : le banc quitte la page, rien ne le range
    const retirer = (page: any) => page.evaluate(() => {
      const w: any    = window
      const zone: any = document.getElementById('zone')
      w.__rangee = document.querySelector('mjs-banc')
      zone.replaceChildren()
    })

    const rien = { cibles: [], hotes: ['', ''], fentes: ['', ''] }

    const sansEcart = (lu: any, quand: string) => {
      for (const [bloc, ecarts] of Object.entries(lu)) {
        for (const e of ecarts as number[]) assert.ok(Math.abs(e) <= 1, `${quand} : ${bloc}, l'indicateur est à ${(ecarts as number[]).map((x) => x.toFixed(1)).join(' / ')} px de l'onglet actif (position / taille)`)
      }
    }

    // le module répond encore : l'indicateur suit un onglet qui grandit (le ResizeObserver), un clic et les flèches changent d'onglet,
    // un onglet ajouté est pris en compte (slotchange)
    const exercer = async (page: any, quand: string) => {
      await page.evaluate('window.__grossir()')
      await page.waitForTimeout(500)
      sansEcart(await ecart(page), `${quand}, l'onglet actif a grandi`)
      const lu: any = await page.evaluate('window.__exercer()')
      for (const bloc of ['courbe', 'barre']) {
        assert.deepEqual([lu[bloc].depart, lu[bloc].clic, lu[bloc].fleche], ['1', '2', '1'], `${quand}, ${bloc} : départ sur l'onglet 1, le clic mène au 2, la flèche gauche ramène au 1`)
        assert.equal(lu[bloc].roles, Array(lu[bloc].nb).fill('tab').join(), `${quand}, ${bloc} : l'onglet ajouté est pris en compte (slotchange)`)
      }
      await page.waitForTimeout(500)
      sansEcart(await ecart(page), `${quand}, après les gestes`)
    }

    it('rangé dans le cache de pages : aucune erreur, ni observateur ni écouteur du module', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvrir()
      try {
        const avant: any = await bilan(page)
        assert.equal(avant.cibles.length, 2, 'préalable : une barre observée par module')
        await ranger(page)
        await page.waitForTimeout(700)
        assert.deepEqual(erreurs, [], 'la barre sortie de la page ne doit rien faire mesurer')
        assert.deepEqual(await bilan(page), rien, 'ni observateur ni écouteur ne reste sur le module rangé')
      } finally {
        await page.close()
      }
    })

    it('retour depuis le cache de pages : le module est de nouveau à l\'écoute et suit ses onglets', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvrir()
      try {
        await exercer(page, 'avant le départ')
        await ranger(page)
        await page.waitForTimeout(500)
        await rouvrir(page)
        await page.waitForTimeout(800)
        assert.deepEqual(erreurs, [], 'ni au départ ni au retour')
        assert.equal(((await bilan(page)) as any).cibles.length, 2, 'au retour, une barre observée par module')
        await exercer(page, 'au retour')
        assert.deepEqual(erreurs, [], 'ni pendant les gestes du retour')
      } finally {
        await page.close()
      }
    })

    it('retiré pour de bon : ni erreur, ni observateur, ni écouteur, et les onglets rendus nus', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvrir()
      try {
        await retirer(page)
        await page.waitForTimeout(700)
        assert.deepEqual(erreurs, [])
        assert.deepEqual(await bilan(page), rien, 'ni observateur ni écouteur ne reste sur le module détruit')
        const nus = await page.evaluate(() => {
          const banc: any = (window as any).__rangee
          return [...banc._shadow.querySelectorAll('mjs-core-tabs > a')].map((o: any) => ['role', 'tabindex', 'aria-selected'].some((a) => o.hasAttribute(a)))
        })
        assert.deepEqual(nus, [false, false, false, false, false, false], 'role, tabindex et aria-selected retirés des onglets')
      } finally {
        await page.close()
      }
    })

    it('un montage rejoué ne laisse pas d\'observateur orphelin', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvrir()
      try {
        await page.evaluate(() => {
          const banc: any = (window as any).__banc()
          for (const tabs of banc._shadow.querySelectorAll('mjs-core-tabs')) { tabs._mjs_fireMount(); tabs._mjs_fireMount() }
        })
        await page.waitForTimeout(300)
        assert.equal(((await bilan(page)) as any).cibles.length, 2, 'après deux montages rejoués, toujours une barre observée par module')
        await retirer(page)
        await page.waitForTimeout(700)
        assert.deepEqual(erreurs, [])
        assert.deepEqual(await bilan(page), rien, 'le module détruit ne laisse aucun observateur, même après un montage rejoué')
      } finally {
        await page.close()
      }
    })
  })
}
