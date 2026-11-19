// Un composant caché par le bouclier du cœur (`visibility: hidden`, sa place gardée) paraît d'un coup, sans qu'aucune transition
// de sa feuille ne se joue sous les yeux du visiteur. Vrais navigateurs (Chromium, Firefox, WebKit), vrai build servi par HTTP.
//
// Pourquoi ce test existe : sous le bouclier, le premier rendu change des styles (classes, effets, état coché) pendant que le
// composant est invisible, et le retrait du bouclier change sa visibilité. Sans précaution, ces changements partaient en
// transition : un élément en `transition: opacity .3s, visibility 0s .3s` (le motif classique d'un fondu de sortie) paraissait
// 300 ms après le reste de son composant, puisque son passage de caché à visible attendait son délai. Le bouclier coupe désormais
// les transitions pendant l'attente et à l'apparition.
//
// Les chemins de retrait gardés : la fin du premier rendu, en fichiers séparés comme en fichier unique (`"js": "bundle"`) ; la fin
// de l'attente des textes traduits (`wait`), où le gabarit du module, déjà dans son ombre, a été stylé caché pendant toute
// l'attente ; et son secours (`i18n.timeout`) — le module dont les textes n'arrivent pas paraît quand même au bout du délai. Dans
// les deux derniers, le composant glissé dans la balise du module (contenu projeté par `<slot>`), défini pendant l'attente, paraît
// à la même image que lui : il attendait le retrait du bouclier de son hôte.
//
// Le contenu que la page glisse dans un composant, et que celui-ci transmet par son propre `<slot>` à un composant placé dans son
// ombre (`<@relais><slot></slot></@relais>`), tient sa visibilité du second dans l'arbre aplati sans être son descendant dans le
// DOM : il paraît à la même image que le second, sans transition, que celui-ci soit prêt dans la même tâche (fichier unique), qu'il
// arrive plus tard (fichier séparé, servi en retard) ou qu'il attende ses textes ; le composant glissé de la même façon attend lui
// aussi le second, et paraît avec lui.
//
// Les pseudo-éléments (`::before`, `::after`) sont coupés comme le reste : la coche d'un interrupteur (`<@@switch layout="glow">`)
// d'un module qui attendait ses textes est à sa place dès la première image où il se voit. La coupure ne tient que jusqu'au
// premier calcul de style de l'apparition, puis part dans la même tâche : une animation d'entrée lancée par `µmount` dans un ou
// deux `requestAnimationFrame`, sur un élément ou sur la balise, fait son fondu, et une classe posée directement est déjà en
// place. Rien n'attend d'image : sans `requestAnimationFrame` (un onglet en arrière-plan), le composant paraît, ses transitions
// reprennent, et aucune image n'est demandée.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Mode = 'split' | 'bundle'
interface Construction { base: string, retenues: Array<() => void>, server: Server }

const SECTION = /\/i18n\/[^/]+\/[^/]+\.json$/
const RETARD  = ['  .v', '    transition: opacity .3s, visibility 0s .3s']

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

const constructions = new Map<Mode, Promise<Construction>>()

async function bati(mode: Mode): Promise<Construction> {
  const root   = mjsTmp('bouclier-sans-transition-' + mode)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'titre: Bonjour accueil\n')
  writeFileSync(join(srcDir, 'retard.mjs'), ['<p class="f">fixe</p>', '<p class="v">retard</p>', '<style>', ...RETARD, '</style>', ''].join('\n'))
  writeFileSync(join(srcDir, 'hote.mjs'), ["@i18n 'accueil'", '<h1 class="t">{µt(\'titre\')}</h1>', '<p class="v">retard</p>', '<div class="boite"><slot></slot></div>', '<style>', ...RETARD, '</style>', ''].join('\n'))
  writeFileSync(join(srcDir, 'enfant.mjs'), ['<p class="e">enfant</p>', ''].join('\n'))
  // le contenu glissé dans `passe` (ou `passe-mot`) est transmis par son slot à `relais` (ou `traduit`, qui attend ses textes)
  writeFileSync(join(srcDir, 'passe.mjs'), ['<p class="pa">A</p>', '<@relais><slot></slot></@relais>', ''].join('\n'))
  writeFileSync(join(srcDir, 'relais.mjs'), ['<p class="pb">B</p>', '<div class="boite"><slot></slot></div>', ''].join('\n'))
  writeFileSync(join(srcDir, 'passe-mot.mjs'), ['<p class="pa">A</p>', '<@traduit><slot></slot></@traduit>', ''].join('\n'))
  writeFileSync(join(srcDir, 'traduit.mjs'), ["@i18n 'accueil'", '<p class="pb">{µt(\'titre\')}</p>', '<div class="boite"><slot></slot></div>', ''].join('\n'))
  writeFileSync(join(srcDir, 'glisse.mjs'), ['<p class="f">fixe</p>', '<p class="v">glissé</p>', '<style>', ...RETARD, '</style>', ''].join('\n'))
  // module qui attend ses textes : la coche de `<@@switch layout="glow">` (ses `::before` et `::after`) et le `::after` d'un
  // paragraphe changent au rendu qui suit l'arrivée des textes
  writeFileSync(join(srcDir, 'coche.mjs'), ["@i18n 'accueil'", '<script>', '  $on = true', '</script>', '<p class={$on ? "x on" : "x"}>{µt(\'titre\')}</p>', '<@@switch layout="glow" checked={$on}></@@switch>', '<style>', '  .x::after', "    content: '•'", '    display: inline-block', '    transition: transform .5s', '  .on::after', '    transform: translateX(40px)', '</style>', ''].join('\n'))
  // animation d'entrée lancée depuis µmount : par un et par deux `requestAnimationFrame`, sur la balise elle-même, et une classe
  // posée directement
  writeFileSync(join(srcDir, 'entree.mjs'), ['<script>', '  µmount ->', '    hote = @', '    sh   = @_shadow or @shadowRoot', "    sh.querySelector('.d').classList.add('in')", "    requestAnimationFrame(-> sh.querySelector('.c').classList.add('in'))", "    requestAnimationFrame(-> requestAnimationFrame(-> sh.querySelector('.b').classList.add('in')))", "    requestAnimationFrame(-> hote.classList.add('in'))", '</script>', '<p class="b">b</p>', '<p class="c">c</p>', '<p class="d">d</p>', '<style>', '  .b, .c, .d', '    opacity: 0', '    transition: opacity .5s', '  .in', '    opacity: 1', '</style>', ''].join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', js: mode,
    i18n: { default: 'fr', timeout: '400ms' },
    effects: { skeleton: [] },
  }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const retenues: Array<() => void> = []
  const tete     = '<meta charset="utf-8"><script type="module" src="/out/bundle.js"></script>'
  // le composant glissé dans la balise de l'hôte n'est posé qu'une fois l'hôte défini : il est défini pendant l'attente des textes
  const glisser  = '<script type="module">customElements.whenDefined(\'mjs-hote\').then(() => { document.querySelector(\'mjs-hote\').innerHTML = \'<mjs-enfant></mjs-enfant>\' })</script>'
  const fondu    = '<style>.v{transition:opacity .3s, visibility 0s .3s}</style>'
  const entree   = '<style>mjs-entree{display:block;opacity:0;transition:opacity .5s}mjs-entree.in{opacity:1}</style>'
  const pages: Record<string, string> = {
    '/coche': `<!doctype html><html><head>${tete}</head><body><mjs-coche></mjs-coche><p>après</p></body></html>`,
    '/entree': `<!doctype html><html><head>${tete}${entree}</head><body><mjs-entree></mjs-entree><p>après</p></body></html>`,
    '/retard': `<!doctype html><html><head>${tete}</head><body><mjs-retard></mjs-retard><p>après</p></body></html>`,
    '/attente': `<!doctype html><html><head>${tete}${glisser}</head><body><mjs-hote></mjs-hote><p>après</p></body></html>`,
    '/slot': `<!doctype html><html><head>${tete}${fondu}</head><body><mjs-passe><p class="v">transmis</p></mjs-passe><p>après</p></body></html>`,
    '/slot-attente': `<!doctype html><html><head>${tete}${fondu}</head><body><mjs-passe-mot><p class="v">transmis</p><mjs-glisse></mjs-glisse></mjs-passe-mot><p>après</p></body></html>`,
  }
  // en fichiers séparés, `glisse` n'arrive qu'une fois `traduit` en attente de ses textes, dans l'ombre de `passe-mot` déjà rendu
  const glisses: Array<() => void> = []
  let attendTextes = false
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (pages[chemin]) {
      attendTextes = false
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(pages[chemin])
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const envoyer = () => {
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
      res.end(readFileSync(fichier))
    }
    // le fragment de traduction ne répond pas : seul le secours fait paraître l'hôte
    if (SECTION.test(chemin)) {
      attendTextes = true
      retenues.push(envoyer)
      glisses.splice(0).forEach(f => f())
    }
    // en fichiers séparés, `relais` arrive bien après `passe`, qui l'attend déjà dans son ombre
    else if (/\/relais-[^/]*\.js$/.test(chemin)) setTimeout(envoyer, 400)
    else if (/\/glisse-[^/]*\.js$/.test(chemin) && !attendTextes) glisses.push(envoyer)
    else envoyer()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, retenues, server }
}

// à chaque image (lu dans la boucle d'images, avant son rendu) : l'instant où chaque élément suivi se voit pour la première fois
// et chaque transition lancée (`transitionrun`), dans la page comme dans chaque ombre, fermées comprises (relevées à leur création)
const SONDE = () => {
  const w       = window as any
  const t0      = performance.now()
  w.__seenMark  = {}
  w.__tr        = []
  const note    = (e: any) => w.__tr.push(e.target.localName + (e.target.className ? '.' + e.target.className : '') + (e.pseudoElement || '') + ' : ' + e.propertyName)
  const attache = Element.prototype.attachShadow
  document.addEventListener('transitionrun', note, true)
  Element.prototype.attachShadow = function (o: ShadowRootInit) {
    const r = attache.call(this, o)
    r.addEventListener('transitionrun', note, true)
    return r
  }
  // chemin d'un élément suivi : les balises dont on traverse l'ombre, une à une, puis l'élément dans la dernière
  const suivis: Array<[string, string[]]> = [
    ['f', ['mjs-retard', '.f']], ['v', ['mjs-retard', '.v']], ['t', ['mjs-hote', 'h1.t']], ['v2', ['mjs-hote', '.v']], ['e', ['mjs-enfant', '.e']],
    ['pa', ['mjs-passe, mjs-passe-mot', '.pa']], ['pb', ['mjs-passe, mjs-passe-mot', 'mjs-relais, mjs-traduit', '.pb']],
    ['pv', ['mjs-passe > .v, mjs-passe-mot > .v']], ['rv', ['mjs-passe-mot > mjs-glisse', '.v']], ['gx', ['mjs-coche', '.x']],
  ]
  // l'instant où l'élément devient visible pour de bon (`__fin`) : le contenu de la page se voit déjà avant l'arrivée du runtime
  w.__fin = {}
  const vis: Record<string, boolean> = {}
  const trouve = (chemin: string[]) => {
    let r: any = document
    for (let i = 0; i < chemin.length - 1; i++) {
      const h: any = r.querySelector(chemin[i])
      r = h && (h._shadow || h.shadowRoot)
      if (!r) return null
    }
    return r.querySelector(chemin[chemin.length - 1])
  }
  // les pseudo-éléments suivis : le `::after` du paragraphe, la coche de l'interrupteur (`::before`, `::after` de sa pilule)
  w.__lireCoche = () => {
    const x = trouve(['mjs-coche', '.x'])
    const p = trouve(['mjs-coche', 'mjs-core-switch', '.pill'])
    return [x && getComputedStyle(x, '::after').transform, p && getComputedStyle(p, '::before').left, p && getComputedStyle(p, '::after').left].join(' / ')
  }
  const tick = () => {
    const t = Math.round(performance.now() - t0)
    for (const [cle, chemin] of suivis) {
      const el = trouve(chemin)
      const vu = !!el && el.getClientRects().length > 0 && el.checkVisibility({ visibilityProperty: true })
      if (vu && !vis[cle]) w.__fin[cle] = t
      vis[cle] = vu
      if (!vu || w.__seenMark[cle] !== undefined) continue
      w.__seenMark[cle] = t
      if (cle === 't') w.__titre = el.textContent
      if (cle === 'gx') w.__coche = w.__lireCoche()
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

describe('bouclier du cœur : aucune transition pendant l\'attente ni à l\'apparition — dans de vrais navigateurs', function () {
  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(`bouclier sans transition — ${nom} réel`, function () {
      this.timeout(120000)
      let browser: any = null

      before(async function () {
        if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async function () {
        if (browser) await browser.close()
      })

      for (const mode of ['split', 'bundle'] as const) {
        it(`"js": "${mode}" — un élément en \`transition: opacity .3s, visibility 0s .3s\` paraît avec son composant, sans retard`, async () => {
          if (!constructions.has(mode)) constructions.set(mode, bati(mode))
          const c    = await constructions.get(mode)!
          const page = await browser.newPage()
          await page.addInitScript(SONDE)
          try {
            await page.goto(c.base + '/retard', { waitUntil: 'load' })
            await page.waitForFunction(() => (window as any).__seenMark.f !== undefined, null, { timeout: 20000 })
            // le retard à mesurer serait de 300 ms : on attend au-delà
            await page.waitForTimeout(500)
            const vu: any = await page.evaluate(() => (window as any).__seenMark)
            console.log(`      ${nom} ${mode} — première image visible : ${JSON.stringify(vu)}`)
            assert.ok(vu.v !== undefined, 'l\'élément en fondu de sortie finit par se voir')
            assert.equal(vu.v - vu.f, 0, `l'élément en fondu de sortie paraît à la même image que son composant (retard ${vu.v - vu.f} ms)`)
          }
          finally { await page.close() }
        })
      }

      for (const mode of ['split', 'bundle'] as const) {
        it(`"js": "${mode}" — le contenu transmis par un slot au composant placé dans l'ombre paraît avec lui, sans transition`, async () => {
          if (!constructions.has(mode)) constructions.set(mode, bati(mode))
          const c    = await constructions.get(mode)!
          const page = await browser.newPage()
          await page.addInitScript(SONDE)
          try {
            await page.goto(c.base + '/slot', { waitUntil: 'load' })
            await page.waitForFunction(() => (window as any).__seenMark.pb !== undefined, null, { timeout: 20000 })
            await page.waitForTimeout(500)
            const vu: any = await page.evaluate(() => (window as any).__fin)
            const tr: any = await page.evaluate(() => (window as any).__tr)
            console.log(`      ${nom} ${mode} slot transmis — visible pour de bon : ${JSON.stringify(vu)}, transitions lancées : ${JSON.stringify(tr)}`)
            assert.ok(vu.pa !== undefined && vu.pb !== undefined, 'les deux composants se voient')
            // en fichier unique, rien ne cache le contenu de la page avant les définitions : il peut se voir dès la première image
            assert.ok(vu.pv <= vu.pb, `le contenu transmis se voit pour de bon au plus tard à l'image où paraît le composant qui le reçoit (écart ${vu.pv - vu.pb} ms)`)
            assert.deepEqual(tr, [], 'aucune transition ne se lance')
          }
          finally { await page.close() }
        })

        it(`"js": "${mode}" — le composant qui reçoit le slot attend ses textes : le contenu transmis et le composant glissé paraissent avec lui, sans transition`, async () => {
          if (!constructions.has(mode)) constructions.set(mode, bati(mode))
          const c    = await constructions.get(mode)!
          const page = await browser.newPage()
          await page.addInitScript(SONDE)
          try {
            await page.goto(c.base + '/slot-attente', { waitUntil: 'load' })
            const debut = Date.now()
            while (c.retenues.length === 0 && Date.now() - debut < 15000) await page.waitForTimeout(20)
            assert.ok(c.retenues.length > 0, 'le fragment de traduction est demandé, et retenu')
            // le composant qui transmet paraît tout de suite ; celui qui reçoit, quelques images plus tard, avec ses textes
            await page.waitForFunction(() => !!customElements.get('mjs-glisse'), null, { timeout: 20000 })
            await page.waitForTimeout(150)
            c.retenues.splice(0).forEach(f => f())
            await page.waitForFunction(() => (window as any).__seenMark.pb !== undefined, null, { timeout: 20000 })
            await page.waitForTimeout(500)
            const vu: any = await page.evaluate(() => (window as any).__fin)
            const tr: any = await page.evaluate(() => (window as any).__tr)
            console.log(`      ${nom} ${mode} slot transmis, textes attendus — visible pour de bon : ${JSON.stringify(vu)}, transitions lancées : ${JSON.stringify(tr)}`)
            assert.ok(vu.pa !== undefined && vu.pb !== undefined && vu.pa < vu.pb, 'le composant qui transmet paraît sans attendre les textes du second')
            assert.equal(vu.pv - vu.pb, 0, `le contenu transmis paraît à la même image que le composant qui le reçoit (écart ${vu.pv - vu.pb} ms)`)
            assert.equal(vu.rv - vu.pb, 0, `le composant glissé et transmis paraît à la même image que celui qui le reçoit (écart ${vu.rv - vu.pb} ms)`)
            assert.deepEqual(tr, [], 'aucune transition ne se lance')
          }
          finally {
            c.retenues.splice(0).forEach(f => f())
            await page.close()
          }
        })
      }

      for (const mode of ['split', 'bundle'] as const) {
        it(`"js": "${mode}" — un module qui attend ses textes paraît sans qu'aucun pseudo-élément ne glisse (coche de \`<@@switch layout="glow">\`, \`::after\` d'un paragraphe)`, async () => {
          if (!constructions.has(mode)) constructions.set(mode, bati(mode))
          const c    = await constructions.get(mode)!
          const page = await browser.newPage()
          await page.addInitScript(SONDE)
          try {
            await page.goto(c.base + '/coche', { waitUntil: 'load' })
            const debut = Date.now()
            while (c.retenues.length === 0 && Date.now() - debut < 15000) await page.waitForTimeout(20)
            assert.ok(c.retenues.length > 0, 'le fragment de traduction est demandé, et retenu')
            // le gabarit gelé (interrupteur décoché, paragraphe sans `on`) reste quelques images sous le bouclier
            await page.waitForTimeout(150)
            c.retenues.splice(0).forEach(f => f())
            await page.waitForFunction(() => (window as any).__seenMark.gx !== undefined, null, { timeout: 20000 })
            await page.waitForTimeout(800)
            const premiere: string = await page.evaluate(() => (window as any).__coche)
            const finale: string   = await page.evaluate(() => (window as any).__lireCoche())
            const tr: string[]     = await page.evaluate(() => (window as any).__tr)
            console.log(`      ${nom} ${mode} coche — à la première image : ${premiere}, au repos : ${finale}, transitions lancées : ${JSON.stringify(tr)}`)
            assert.equal(premiere, finale, 'les pseudo-éléments sont à leur place dès la première image où le module se voit')
            assert.deepEqual(tr, [], 'aucune transition ne se lance')
          }
          finally {
            c.retenues.splice(0).forEach(f => f())
            await page.close()
          }
        })

        it(`"js": "${mode}" — animation d'entrée lancée depuis µmount : par un ou deux \`requestAnimationFrame\`, et sur la balise, le fondu se joue ; une classe posée directement est déjà en place`, async () => {
          if (!constructions.has(mode)) constructions.set(mode, bati(mode))
          const c    = await constructions.get(mode)!
          const page = await browser.newPage()
          await page.addInitScript(SONDE)
          try {
            await page.goto(c.base + '/entree', { waitUntil: 'load' })
            await page.waitForFunction(() => !!document.querySelector('mjs-entree.in'), null, { timeout: 20000 })
            await page.waitForTimeout(300)
            const tr: string[] = await page.evaluate(() => (window as any).__tr)
            console.log(`      ${nom} ${mode} entrée — transitions lancées : ${JSON.stringify(tr)}`)
            assert.ok(tr.includes('p.c in : opacity'), 'un requestAnimationFrame depuis µmount : le fondu se joue')
            assert.ok(tr.includes('p.b in : opacity'), 'deux requestAnimationFrame depuis µmount : le fondu se joue')
            assert.ok(tr.some(t => t.startsWith('mjs-entree') && t.endsWith(' : opacity')), 'la classe posée sur la balise dans un requestAnimationFrame : le fondu se joue')
            assert.ok(!tr.some(t => t.startsWith('p.d')), 'la classe posée directement dans µmount est déjà en place à l\'apparition')
          }
          finally { await page.close() }
        })

        it(`"js": "${mode}" — sans image (onglet en arrière-plan, \`requestAnimationFrame\` suspendu) : le composant paraît, ses transitions reprennent, aucune image n'est demandée`, async () => {
          if (!constructions.has(mode)) constructions.set(mode, bati(mode))
          const c    = await constructions.get(mode)!
          const page = await browser.newPage()
          // aucun rappel d'image ne vient jamais ; chaque demande est comptée
          await page.addInitScript(() => {
            const w: any = window
            w.__images   = 0
            w.requestAnimationFrame = () => ++w.__images
          })
          try {
            await page.goto(c.base + '/retard', { waitUntil: 'load' })
            await page.waitForFunction(() => !!customElements.get('mjs-retard') && !document.querySelector('[mjs-loading]'), null, { timeout: 20000, polling: 50 })
            await page.waitForTimeout(200)
            const etat: any = await page.evaluate(() => {
              const h: any = document.querySelector('mjs-retard')
              const o: any = h._shadow || h.shadowRoot
              const v: any = o.querySelector('.v')
              const restes = [h, ...o.querySelectorAll('*')].filter((e: any) => e.hasAttribute('mjs-loading') || e.hasAttribute('mjs-appearing')).length
              return { vu: v.checkVisibility({ visibilityProperty: true }), restes, duree: getComputedStyle(v).transitionDuration, images: (window as any).__images }
            })
            console.log(`      ${nom} ${mode} sans image — ${JSON.stringify(etat)}`)
            assert.equal(etat.vu, true, 'le composant paraît')
            assert.equal(etat.restes, 0, 'ni `mjs-loading` ni `mjs-appearing` ne reste')
            assert.equal(etat.duree, '0.3s, 0s', 'ses transitions reprennent')
            assert.equal(etat.images, 0, 'aucune image n\'est demandée')
          }
          finally { await page.close() }
        })
      }

      it('textes arrivés pendant l\'attente : le module paraît avec eux, sans retard, et le composant glissé dans sa balise avec lui', async () => {
        if (!constructions.has('split')) constructions.set('split', bati('split'))
        const c    = await constructions.get('split')!
        const page = await browser.newPage()
        await page.addInitScript(SONDE)
        try {
          await page.goto(c.base + '/attente', { waitUntil: 'load' })
          const debut = Date.now()
          while (c.retenues.length === 0 && Date.now() - debut < 15000) await page.waitForTimeout(20)
          assert.ok(c.retenues.length > 0, 'le fragment de traduction est demandé, et retenu')
          // le gabarit gelé reste quelques images sous le bouclier, puis les textes arrivent avant le délai de secours (400 ms)
          await page.waitForTimeout(150)
          c.retenues.splice(0).forEach(f => f())
          await page.waitForFunction(() => (window as any).__seenMark.t !== undefined, null, { timeout: 20000 })
          await page.waitForTimeout(500)
          const vu: any   = await page.evaluate(() => (window as any).__seenMark)
          const titre     = await page.evaluate(() => (window as any).__titre)
          const enAttente = await page.evaluate(() => { const e = document.querySelector('mjs-enfant'); return !!e && e.hasAttribute('mjs-loading') })
          console.log(`      ${nom} arrivée — première image visible : ${JSON.stringify(vu)}, titre « ${titre} », enfant encore caché par son bouclier : ${enAttente}`)
          assert.equal(titre, 'Bonjour accueil', 'le module paraît avec ses vrais textes')
          assert.equal(enAttente, false, 'le composant glissé ne garde pas son bouclier')
          assert.ok(vu.e !== undefined, 'le composant glissé se voit')
          assert.equal(vu.e - vu.t, 0, `le composant glissé paraît à la même image que son hôte (écart ${vu.e - vu.t} ms)`)
          assert.ok(vu.v2 !== undefined, 'l\'élément en fondu de sortie de l\'hôte finit par se voir')
          assert.equal(vu.v2 - vu.t, 0, `l'élément en fondu de sortie paraît à la même image que son hôte (retard ${vu.v2 - vu.t} ms)`)
        }
        finally {
          c.retenues.splice(0).forEach(f => f())
          await page.close()
        }
      })

      it('secours de l\'attente des textes : le module paraît sans retard, et le composant glissé dans sa balise avec lui', async () => {
        if (!constructions.has('split')) constructions.set('split', bati('split'))
        const c    = await constructions.get('split')!
        const page = await browser.newPage()
        await page.addInitScript(SONDE)
        try {
          await page.goto(c.base + '/attente', { waitUntil: 'load' })
          await page.waitForFunction(() => (window as any).__seenMark.t !== undefined, null, { timeout: 20000 })
          await page.waitForTimeout(500)
          const vu: any      = await page.evaluate(() => (window as any).__seenMark)
          const enAttente    = await page.evaluate(() => { const e = document.querySelector('mjs-enfant'); return !!e && e.hasAttribute('mjs-loading') })
          const enfantDefini = await page.evaluate(() => !!customElements.get('mjs-enfant'))
          console.log(`      ${nom} secours — première image visible : ${JSON.stringify(vu)}, enfant encore caché par son bouclier : ${enAttente}`)
          assert.ok(vu.t >= 350, `l'hôte attend le délai de secours (paru à ${vu.t} ms)`)
          assert.equal(enfantDefini, true, 'le composant glissé est défini pendant l\'attente')
          assert.equal(enAttente, false, 'le composant glissé ne garde pas son bouclier après le secours de son hôte')
          assert.ok(vu.e !== undefined, 'le composant glissé se voit après le secours de son hôte')
          assert.equal(vu.e - vu.t, 0, `le composant glissé paraît à la même image que son hôte (écart ${vu.e - vu.t} ms)`)
          assert.ok(vu.v2 !== undefined, 'l\'élément en fondu de sortie de l\'hôte finit par se voir')
          assert.equal(vu.v2 - vu.t, 0, `l'élément en fondu de sortie paraît à la même image que son hôte (retard ${vu.v2 - vu.t} ms)`)
        }
        finally {
          c.retenues.splice(0).forEach(f => f())
          await page.close()
        }
      })
    })
  }

  after(async function () {
    for (const p of constructions.values()) {
      const k = await p
      await new Promise(resolve => k.server.close(() => resolve(null)))
    }
    constructions.clear()
    await terminateSharedWorkerPool()
  })
})
