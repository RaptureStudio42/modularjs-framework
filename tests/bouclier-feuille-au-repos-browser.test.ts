// Le bouclier du cœur cache ce qu'une balise qui attend contient, ombre comprise, et la feuille qu'il donne à la page ne porte
// aucune règle qui passe par l'hôte d'une ombre. Vrais navigateurs (Chromium, Firefox, WebKit), vrai build en fichiers séparés servi par HTTP ; le module d'un
// composant, le fragment de traduction d'un autre et la variante de mise en page d'un troisième sont retenus par le serveur.
//
// Pourquoi ce test existe : les règles du bouclier visent tout ce que contient une balise qui attend (` *`), et le moteur essaie
// chaque règle ` *` sur chaque élément qu'il restyle. Celles qui passent par l'hôte d'une ombre (`:host([mjs-loading]) *`) ne sont
// écartées par aucun filtre ; dans la page, où `:host` ne vise jamais rien, elles coûtaient de 7 à 13 % du recalcul de style
// d'une liste de mille à dix mille lignes (Chromium). La page prend une feuille sans elles ; les ombres gardent la feuille entière,
// qui cache ce que l'ombre d'une balise qui attend porte déjà, quel que soit le chemin qui pose ou retire l'attribut.
//
// Ce que le test garde. Pendant l'attente : le contenu de l'ombre d'un module qui attend ses textes (`<mjs-gele>`) et celle d'un
// module rendu dans cette ombre, qui attend l'apparition de son hôte (`<mjs-enfant>`), restent cachés, même un bouton en
// `visibility: visible !important`, et sans transition, y compris après un déplacement de `<mjs-gele>` dans la page ; le même
// bouton glissé dans une balise dont le module est en route reste caché, dans la page comme dans l'ombre d'un composant affiché
// (`<mjs-hote>`). Après l'apparition : aucune feuille adoptée par la page ne porte `:host(`, la feuille de l'ombre d'un
// composant garde ses règles `:host([mjs-loading`, y compris celle dont la variante de mise en page arrive après son apparition,
// et ce qui était caché se voit, ses transitions rendues.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const VISIBLE = ['  .vis-imp', '    visibility: visible !important', '  .tr', '    transition: opacity .3s']
const TETE    = '<style>body{margin:0;font:16px/1.4 sans-serif} .vis-imp{visibility:visible!important}</style>'
const CORPS   = [
  '<mjs-lent id="lent"><button id="b-lent" class="vis-imp">dans lent</button></mjs-lent>',
  '<mjs-hote id="hote"></mjs-hote>',
  '<div id="ailleurs"></div>',
  '<mjs-gele id="gele"></mjs-gele>',
  '<mjs-variante id="variante" layout="compact"></mjs-variante>',
  '<input id="fin">'
].join('')

interface Serveur { base: string, server: Server, vus: Set<string>, liberer: () => void, retenir: () => void }

async function construire(): Promise<Serveur> {
  const root   = mjsTmp('bouclier-feuille-au-repos')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'titre: Bonjour accueil\n')
  writeFileSync(join(srcDir, 'lent.mjs'), ['<p class="lent">LENT</p>', '<slot></slot>', ''].join('\n'))
  writeFileSync(join(srcDir, 'hote.mjs'), ['<p>hôte</p>', '<@lent><button class="vis-imp">dans lent, ombre</button></@lent>', '', '<style>', ...VISIBLE, '</style>', ''].join('\n'))
  writeFileSync(join(srcDir, 'gele.mjs'), ["@i18n 'accueil'", '', '<h2>{µt(\'titre\')}</h2>', '<button class="vis-imp">dans gele</button>', '<p class="tr">fondu</p>', '<@enfant></@enfant>', '', '<style>', ...VISIBLE, '</style>', ''].join('\n'))
  writeFileSync(join(srcDir, 'enfant.mjs'), ['<button class="vis-imp">dans enfant</button>', '<p class="tr">fondu enfant</p>', '', '<style>', ...VISIBLE, '</style>', ''].join('\n'))
  writeFileSync(join(srcDir, 'variante.mjs'), ['<p class="tr">variante</p>', '', '<style>', '  .tr', '    color: red', '</style>', '', '<style name="compact">', '  .tr', '    color: blue', '</style>', ''].join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n: { default: 'fr', placeholder: 'wait', timeout: '30s' } }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
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
      const type = extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : extname(fichier) === '.css' ? 'text/css' : 'application/json'
      res.writeHead(200, { 'content-type': type })
      res.end(readFileSync(fichier))
    }
    const nom  = basename(fichier)
    const quoi = /^lent-[0-9a-z]+\.js$/.test(nom) ? 'lent' : /\/i18n\/fr\/[^/]+\.json$/.test(chemin) ? 'fragment' : /\.compact\.css$/.test(nom) ? 'variante' : ''
    if (quoi && !ouvert) { vus.add(quoi); attente.push(envoyer); return }
    envoyer()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const liberer = () => { ouvert = true; attente.forEach((f) => f()); attente = [] }
  const retenir = () => { ouvert = false; vus.clear() }
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server, vus, liberer, retenir }
}

// posée avant tout script : l'ombre d'un composant est fermée (`mode: 'closed'`), le test garde la main sur chacune pour la regarder
function garderLesOmbres(): void {
  const attacher = Element.prototype.attachShadow
  const w        = window as any
  w.__ombres     = []
  Element.prototype.attachShadow = function (this: any, init: ShadowRootInit) { const r = attacher.call(this, init); this.__ombre = r; w.__ombres.push(r); return r }
}

// ce qui se voit et ce qui garde une transition, dans la page et dans chaque ombre, en chaînes, nombres et booléens seulement
function relever(): any {
  const vu     = (el: Element | null | undefined) => !!el && (el as any).checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })
  const duree  = (el: Element | null | undefined) => el ? parseFloat(getComputedStyle(el).transitionDuration) : -1
  const ombre  = (el: Element | null | undefined) => el ? (el as any).__ombre as ShadowRoot | undefined : undefined
  const gele   = document.querySelector('mjs-gele')
  const oGele  = ombre(gele)
  const enfant = oGele ? oGele.querySelector('mjs-enfant') : null
  const oEnf   = ombre(enfant)
  const oHote  = ombre(document.querySelector('mjs-hote'))
  const oVar   = ombre(document.querySelector('mjs-variante'))
  const tr     = oVar ? oVar.querySelector('.tr') : null
  return {
    lentDefini: !!customElements.get('mjs-lent'), enfantDefini: !!customElements.get('mjs-enfant'), hoteDefini: !!customElements.get('mjs-hote'),
    attend: { gele: !!gele && gele.getAttribute('mjs-loading') === '', enfant: !!enfant && enfant.getAttribute('mjs-loading') === '', hote: !!document.querySelector('mjs-hote[mjs-loading]') },
    geleDeplace: !!gele && gele.parentElement!.id === 'ailleurs',
    vus: { page: vu(document.getElementById('b-lent')), ombreHote: vu(oHote?.querySelector('.vis-imp')), gele: vu(oGele?.querySelector('.vis-imp')), geleFondu: vu(oGele?.querySelector('.tr')), enfant: vu(oEnf?.querySelector('.vis-imp')) },
    durees: { gele: duree(oGele?.querySelector('.tr')), enfant: duree(oEnf?.querySelector('.tr')) },
    couleurVariante: tr ? getComputedStyle(tr).color : ''
  }
}

// les règles qui passent par l'hôte d'une ombre : celles des feuilles adoptées par la page, et les ombres qui n'en ont aucune
function feuilles(): any {
  const textes = (f: CSSStyleSheet) => { try { return Array.from(f.cssRules).map((r) => r.cssText) } catch { return [] as string[] } }
  const w      = window as any
  const page   = document.adoptedStyleSheets.flatMap(textes).filter((t) => t.includes(':host('))
  const sans   = w.__ombres.filter((o: ShadowRoot) => !o.adoptedStyleSheets.flatMap(textes).some((t) => t.includes(':host([mjs-loading'))).map((o: ShadowRoot) => o.host.localName)
  return { page, sans, n: w.__ombres.length }
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
  describe(`bouclier : caché pendant l'attente, aucune règle par l'hôte d'une ombre dans la page — ${nom} réel`, function () {
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

    it('ombre qui attend cachée et sans transition, descendant visible caché partout ; après l\'apparition, aucun `:host(` dans la page, les ombres gardent la feuille entière', async () => {
      const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
      s.retenir()
      try {
        await page.addInitScript(garderLesOmbres)
        await page.goto(s.base + '/', { waitUntil: 'domcontentloaded' })
        const debut = Date.now()
        while (s.vus.size < 3 && Date.now() - debut < 15000) await page.waitForTimeout(50)
        assert.equal(s.vus.size, 3, 'le module de <mjs-lent>, le fragment de <mjs-gele> et la variante de <mjs-variante> sont demandés, et retenus — ' + JSON.stringify([...s.vus]))
        await page.waitForFunction(() => { const g: any = document.querySelector('mjs-gele'); const e = g && g.__ombre && g.__ombre.querySelector('mjs-enfant'); return !!e && !!customElements.get('mjs-enfant') && e.getAttribute('mjs-loading') === '' }, null, { timeout: 15000 })
        // déplacé pendant l'attente : déconnecté puis reconnecté, son ombre repose ses feuilles
        await page.evaluate(() => { document.getElementById('ailleurs')!.appendChild(document.querySelector('mjs-gele')!) })
        await page.waitForTimeout(400)
        const attente = await page.evaluate(relever)
        console.log(`      ${nom} — attente ${JSON.stringify(attente)}`)

        assert.equal(attente.lentDefini, false, 'relevé pris pendant l\'attente du module de <mjs-lent>')
        assert.deepEqual([attente.hoteDefini, attente.attend.hote], [true, false], '<mjs-hote> est affiché')
        assert.deepEqual([attente.attend.gele, attente.geleDeplace, attente.enfantDefini, attente.attend.enfant], [true, true, true, true], '<mjs-gele> attend ses textes, déplacé ; <mjs-enfant>, rendu dans son ombre, attend son apparition')
        assert.deepEqual(attente.vus, { page: false, ombreHote: false, gele: false, geleFondu: false, enfant: false }, 'rien ne se voit de ce qui attend, même en visibility: visible !important, dans la page comme dans une ombre')
        assert.deepEqual(attente.durees, { gele: 0, enfant: 0 }, 'le contenu de l\'ombre qui attend n\'a aucune transition')

        s.liberer()
        await page.waitForFunction(() => {
          const w: any = window
          const tr     = (document.querySelector('mjs-variante') as any)?.__ombre?.querySelector('.tr')
          return !!customElements.get('mjs-lent') && !document.querySelector('[mjs-loading]') && w.__ombres.every((o: ShadowRoot) => !o.querySelector('[mjs-loading]')) && !!tr && getComputedStyle(tr).color === 'rgb(0, 0, 255)'
        }, null, { timeout: 15000 })
        await page.waitForTimeout(200)
        const apres = await page.evaluate(relever)
        const regles = await page.evaluate(feuilles)
        console.log(`      ${nom} — après ${JSON.stringify(apres)} règles ${JSON.stringify(regles)}`)

        assert.ok(regles.n >= 6, `les ombres de la page sont toutes relevées : ${regles.n}`)
        assert.deepEqual(regles.page, [], 'aucune feuille adoptée par la page ne porte :host(')
        assert.deepEqual(regles.sans, [], 'chaque ombre garde les règles :host([mjs-loading du bouclier')
        assert.deepEqual(apres.vus, { page: true, ombreHote: true, gele: true, geleFondu: true, enfant: true }, 'tout se voit après l\'apparition')
        assert.deepEqual(apres.durees, { gele: 0.3, enfant: 0.3 }, 'les transitions du composant sont rendues')
        assert.equal(apres.couleurVariante, 'rgb(0, 0, 255)', 'la variante de mise en page, arrivée après l\'apparition, est appliquée')
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
