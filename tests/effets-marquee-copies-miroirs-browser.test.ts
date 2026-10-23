// *marquee dans Chromium, Firefox et WebKit réels (WebKit seulement s'il est installé) : la copie d'un composant est le MIROIR VIVANT de l'original, une instance qui partage
// son état : un clic sur une copie agit partout. Une vitrine porte deux bandes, `.bande` (`unit: child`) et `.tiree` (`drag: true`), chacune avec une carte produit (`<@carte-produit prix={$prix}>`, qui
// porte une puce : un composant imbriqué) et un lien. En développement et en production (le cœur et l'effet minifiés ensemble).
//   1. les copies montrent le vrai prix (celui que la vitrine passe à sa carte), pas celui d'une carte neuve (0 €) ; la balise de la copie garde son nom (le style de la vitrine qui la vise
//      s'y applique), l'ombre de la copie a les styles adoptés de l'original ;
//   2. la vitrine change le prix : les copies suivent ;
//   3. un clic sur le bouton d'une copie : le gestionnaire du miroir tourne une fois, l'original et les copies se redessinent, la puce imbriquée aussi ; le bouton
//      d'une copie prend le focus (`focus()` par un script) : Entrée puis Espace y cliquent, comme sur l'original ;
//   4. montages, scripts, requêtes au montage : un par original et un par miroir (chaque miroir est une instance, son `µmount` tourne), aucun de plus ;
//   5. un clic sur le lien d'une copie mène où mène l'original ;
//   6. les copies ne sont ni `aria-hidden` ni `inert` : la touche Tab entre dans les copies (WebKit ne s'arrête pas sur un bouton ni sur un lien) ;
//   7. `drag` : tirer la piste depuis le bouton d'une copie ne clique pas ; un clic sans geste, si ;
//   8. (développement) le retrait de l'effet : copies et miroirs sortis de la page, aucun observateur de l'effet laissé, l'ombre de la carte jamais observée.
// Ni erreur ni avertissement dans la page.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'vitrine.mjs': [
    '<script>',
    '  $prix = 12',
    '  µmount ->',
    '    window.__prix = (v) -> $prix = v',
    '    return',
    '</script>',
    '<div class="bande" *marquee(unit: child, speed: 900s)>',
    '  <@carte-produit prix={$prix}></@carte-produit>',
    '  <a class="lien" href="#ailleurs">Ailleurs</a>',
    '</div>',
    '<div class="tiree" *marquee(drag: true, speed: 900s)>',
    '  <@carte-produit prix={$prix}></@carte-produit>',
    '  <a class="lien" href="#tiree">Tirée</a>',
    '</div>',
    '<style>',
    '.bande, .tiree',
    '  width: 760px',
    '  margin: 20px 0',
    'mjs-carte-produit',
    '  outline: 3px solid rgb(200, 0, 0)',
    '</style>',
    ''
  ].join('\n'),
  'carte-produit.mjs': [
    '<script>',
    '  $prix = 0',
    '  $clics = 0',
    '  window.__scripts = (window.__scripts || 0) + 1',
    '  @ajouter = ->',
    '    $clics++',
    '    window.__gestionnaire = (window.__gestionnaire || 0) + 1',
    '  µmount ->',
    '    window.__montages = (window.__montages || 0) + 1',
    '    fetch(\'/donnees\')',
    '    return',
    '</script>',
    '<div class="carte">',
    '  <span class="prix">{$prix} €</span>',
    '  <button class="ajouter" @click={@ajouter()}>Ajouter</button>',
    '  <span class="clics">{$clics}</span>',
    '  <@puce n={$clics}></@puce>',
    '</div>',
    '<style>',
    ':host',
    '  display: inline-block',
    '.carte',
    '  display: inline-block',
    '  width: 180px',
    '  padding: 4px',
    '</style>',
    ''
  ].join('\n'),
  'puce.mjs': [
    '<script>',
    '  $n = 0',
    '  µmount ->',
    '    window.__puces = (window.__puces || 0) + 1',
    '    return',
    '</script>',
    '<b class="puce">{$n}</b>',
    ''
  ].join('\n')
}

// les aides de la page : l'ombre d'une balise (ouverte, ou tenue par le composant), une bande, son original, ses copies, ce qu'elles montrent
const AIDES = `(() => {
  window.__ombre = (el) => {
    if (!el) return null
    if (el.shadowRoot) return el.shadowRoot
    for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
    return null
  }
  window.__bande = (c) => window.__ombre(document.querySelector('mjs-vitrine')).querySelector('.' + c)
  window.__original = (c) => window.__bande(c).querySelector(':scope > [mjs-fx-marquee-run] > mjs-carte-produit')
  window.__copies = (c) => [...window.__bande(c).querySelectorAll(':scope > [mjs-fx-marquee-run] > [mjs-fx-marquee-copy]')]
  const lire = (h) => {
    const r = window.__ombre(h)
    if (!r) return null
    const p = window.__ombre(r.querySelector('mjs-puce'))
    return { prix: r.querySelector('.prix')?.textContent ?? null, clics: r.querySelector('.clics')?.textContent ?? null, puce: p ? p.querySelector('.puce')?.textContent ?? null : null, largeur: r.querySelector('.carte') ? Math.round(r.querySelector('.carte').getBoundingClientRect().width) : null }
  }
  window.__etat = (c) => ({ original: lire(window.__original(c)), copies: window.__copies(c).map(k => lire(k.querySelector('mjs-carte-produit'))) })
  // le centre d'un bouton (dans l'ombre de la carte) ou du lien d'une copie entièrement visible dans la bande
  window.__cible = (c, quoi) => {
    const b = window.__bande(c).getBoundingClientRect()
    for (const k of window.__copies(c)) {
      const n = quoi === 'lien' ? k.querySelector('.lien') : window.__ombre(k.querySelector('mjs-carte-produit'))?.querySelector('.ajouter')
      if (!n) continue
      const r = n.getBoundingClientRect()
      if (r.width > 0 && r.left >= b.left + 4 && r.right <= b.right - 4) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }
    return null
  }
  // l'élément qui a le focus, au plus profond des ombres, est-il dans une copie ?
  window.__focusEnCopie = () => {
    let a = document.activeElement
    let profond = a
    while (a) {
      profond = a
      const r = window.__ombre(a)
      a = r && r.activeElement ? r.activeElement : null
    }
    for (let x = profond; x; x = x.parentNode || x.host) if (x.nodeType === 1 && x.hasAttribute('mjs-fx-marquee-copy')) return profond.localName
    return ''
  }
  // les observateurs de changements en vie : [observateur, nœud observé]
  window.__suivis = []
  const observe = MutationObserver.prototype.observe
  const disconnect = MutationObserver.prototype.disconnect
  MutationObserver.prototype.observe = function(n, o) { window.__suivis.push([this, n]); return observe.call(this, n, o) }
  MutationObserver.prototype.disconnect = function() { window.__suivis = window.__suivis.filter(s => s[0] !== this); return disconnect.call(this) }
})()`

type Appli = { nom: string, env: 'dev' | 'prod' }
const APPLIS: Appli[] = [{ nom: 'développement', env: 'dev' }, { nom: 'production', env: 'prod' }]

const scripts: Record<string, Promise<string>> = {}
function construire(appli: Appli): Promise<string> {
  scripts[appli.env] ??= (async () => {
    const root   = mjsTmp('marquee-miroirs-' + appli.env)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const manifeste = join(outDir, 'bundle.js')
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle' }
    if (appli.env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [], appli.nom)
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    assert.ok(fichiers.includes('bundle.js'), fichiers.join(' '))
    return stripEsm(readFileSync(manifeste, 'utf-8'))
  })()
  return scripts[appli.env]
}

describe('*marquee — les copies d\'un composant sont ses miroirs vivants, un clic sur une copie agit partout (navigateurs réels)', function () {
  this.timeout(600000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async () => { await browser?.close() })

      for (const appli of APPLIS) {
        it(appli.nom, async () => {
          const script = await construire(appli)
          const page   = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage()
          const erreurs: string[] = []
          const avis: string[]    = []
          let requetes            = 0
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => {
            if (m.type() === 'error') erreurs.push(m.text())
            else if (m.type() === 'warning' && m.text().startsWith('[ModularJS]')) avis.push(m.text())
          })
          await page.addInitScript(AIDES)
          await page.route('http://t.test/**', (route: any) => {
            const url = route.request().url()
            if (url === 'http://t.test/donnees') {
              requetes++
              return route.fulfill({ contentType: 'application/json', body: '{}' })
            }
            if (url !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><mjs-vitrine></mjs-vitrine><script>${script}</script></body></html>` })
          })
          try {
            await page.goto('http://t.test/', { waitUntil: 'load' })
            await page.waitForFunction(`!!window.__ombre(document.querySelector('mjs-vitrine'))?.querySelector('.bande [mjs-fx-marquee-copy]')`, null, { timeout: 20000 })
            await page.waitForTimeout(500)
            const echecs: string[] = []
            const ok = (cond: boolean, msg: string) => { if (!cond) echecs.push(msg) }
            const lit = (js: string) => page.evaluate(js)

            // 1 : le vrai prix, la balise gardée (le style de la vitrine la vise), les styles adoptés de l'ombre
            for (const c of ['bande', 'tiree']) {
              const e = await lit(`window.__etat('${c}')`)
              ok(e.original && e.original.prix === '12 €', `${c} : l'original montre 12 € : ${JSON.stringify(e.original)}`)
              ok(e.copies.length >= 1 && e.copies.every((k: any) => k && k.prix === '12 €' && k.puce === '0' && k.largeur === e.original.largeur), `${c} : chaque copie montre ce que montre l'original (12 €, la puce, sa largeur) : ${JSON.stringify(e)}`)
            }
            const balise = await lit(`(() => { const h = window.__copies('bande')[0]?.querySelector('mjs-carte-produit'); return h ? getComputedStyle(h).outlineWidth + ' ' + getComputedStyle(h).outlineColor : null })()`)
            ok(balise === '3px rgb(200, 0, 0)', `la copie garde la balise de la carte, le style de la vitrine qui la vise s'y applique : ${balise}`)

            // 2 : la vitrine change le prix
            await lit('window.__prix(15)')
            await page.waitForTimeout(300)
            for (const c of ['bande', 'tiree']) {
              const e = await lit(`window.__etat('${c}')`)
              ok(e.original.prix === '15 €' && e.copies.every((k: any) => k && k.prix === '15 €'), `${c} : après le changement de prix, original et copies montrent 15 € : ${JSON.stringify(e)}`)
            }

            // 3 : un clic sur le bouton d'une copie
            const bouton = await lit(`window.__cible('bande', 'bouton')`)
            ok(!!bouton, 'un bouton de copie visible dans la bande')
            if (bouton) {
              await page.mouse.click(bouton.x, bouton.y)
              await page.waitForTimeout(300)
              const n = await lit('window.__gestionnaire || 0')
              ok(n === 1, `le gestionnaire tourne une fois : ${n}`)
              const e = await lit(`window.__etat('bande')`)
              ok(e.original.clics === '1' && e.original.puce === '1', `l'original se redessine (et sa puce) : ${JSON.stringify(e.original)}`)
              ok(e.copies.every((k: any) => k && k.clics === '1' && k.puce === '1'), `les copies se redessinent (et leurs puces) : ${JSON.stringify(e.copies)}`)
              const t = await lit(`window.__etat('tiree')`)
              ok(t.original.clics === '0', `l'autre bande n'a pas bougé : ${JSON.stringify(t.original)}`)
              // au clavier : le bouton d'une copie prend le focus, Entrée puis Espace y cliquent
              await lit(`window.__ombre(window.__copies('bande')[0].querySelector('mjs-carte-produit')).querySelector('.ajouter').focus({ preventScroll: true })`)
              const pris = await lit('window.__focusEnCopie()')
              ok(pris === 'button', `focus() par un script prend sur le bouton d'une copie : ${pris}`)
              await page.keyboard.press('Enter')
              await page.waitForTimeout(150)
              await page.keyboard.press('Space')
              await page.waitForTimeout(300)
              const k = await lit('window.__gestionnaire || 0')
              const c = await lit(`window.__etat('bande')`)
              ok(k === 3 && c.original.clics === '3' && c.copies.every((x: any) => x && x.clics === '3'), `Entrée puis Espace après focus() sur le bouton d'une copie : deux clics de plus, partout : ${k}, ${JSON.stringify(c)}`)
              await page.mouse.click(5, 690)
            }

            // 4 : un montage, un script, une requête par original et par miroir
            const comptes = await lit(`({ montages: window.__montages || 0, scripts: window.__scripts || 0, puces: window.__puces || 0, miroirs: window.__copies('bande').concat(window.__copies('tiree')).map(k => k.querySelector('mjs-carte-produit')).filter(h => h && h.isMirror === true).length })`)
            ok(comptes.miroirs >= 2 && comptes.montages === 2 + comptes.miroirs && comptes.scripts === 2 + comptes.miroirs && comptes.puces === 2 + comptes.miroirs, `deux cartes, leurs miroirs et la puce de chacune montés, une fois chacun : ${JSON.stringify(comptes)}`)
            ok(requetes === 2 + comptes.miroirs, `une requête au montage par carte et par miroir : ${requetes} pour ${2 + comptes.miroirs}`)

            // 5 : le lien d'une copie mène où mène l'original
            const lien = await lit(`window.__cible('bande', 'lien')`)
            ok(!!lien, 'un lien de copie visible dans la bande')
            if (lien) {
              await page.mouse.click(lien.x, lien.y)
              await page.waitForTimeout(300)
              const h = await lit('location.hash')
              ok(h === '#ailleurs', `le lien de la copie mène où mène l'original : « ${h} »`)
            }

            // 6 : ni aria-hidden ni inert, dans la tabulation
            const marques = await lit(`window.__copies('bande').concat(window.__copies('tiree')).map(k => k.getAttribute('aria-hidden') + '/' + k.hasAttribute('inert'))`)
            ok(marques.length > 0 && marques.every((m: string) => m === 'null/false'), `les copies : ni aria-hidden ni inert : ${marques.join(' ')}`)
            await lit('document.activeElement && document.activeElement.blur && document.activeElement.blur()')
            const vus: string[] = []
            for (let i = 0; i < 14; i++) {
              await page.keyboard.press('Tab')
              const v = await lit('window.__focusEnCopie()')
              if (v) vus.push(v)
            }
            ok(vus.length > 0 || nom === 'webkit', `la touche Tab entre dans les copies : ${vus.join(' ')}`)

            // 7 : drag — tirer depuis le bouton d'une copie ne clique pas, un clic sans geste si
            const avant = await lit('window.__gestionnaire || 0')
            const prise = await lit(`window.__cible('tiree', 'bouton')`)
            ok(!!prise, 'un bouton de copie visible dans la bande tirée')
            if (prise) {
              await page.mouse.move(prise.x, prise.y)
              await page.mouse.down()
              await page.mouse.move(prise.x - 70, prise.y, { steps: 8 })
              await page.mouse.up()
              await page.waitForTimeout(400)
              const apres = await lit('window.__gestionnaire || 0')
              ok(apres === avant, `tirer la piste ne clique pas : ${avant} → ${apres}`)
              // la piste lâchée garde son élan : le clic attend qu'elle se pose (le bouton visé ne bouge plus)
              let encore: any = null
              for (let n = 0; n < 40; n++) {
                await page.waitForTimeout(100)
                const p = await lit(`window.__cible('tiree', 'bouton')`)
                const pose = p && encore && Math.abs(p.x - encore.x) < 0.5 && Math.abs(p.y - encore.y) < 0.5
                encore = p
                if (pose) break
              }
              if (encore) {
                await page.mouse.click(encore.x, encore.y)
                await page.waitForTimeout(300)
                const fin = await lit('window.__gestionnaire || 0')
                const t   = await lit(`window.__etat('tiree')`)
                ok(fin === avant + 1 && t.original.clics === '1' && t.copies.every((k: any) => k && k.clics === '1'), `un clic sans geste sur une copie de la bande tirée agit sur l'original : ${avant} → ${fin}, ${JSON.stringify(t)}`)
              }
              else ok(false, 'un bouton de copie visible après le geste')
            }

            // 8 : le retrait de l'effet (développement : la fonction de retrait est lisible)
            if (appli.env === 'dev') {
              const retrait = await lit(`(() => {
                const b = window.__bande('bande')
                const run = b.querySelector(':scope > [mjs-fx-marquee-run]')
                const ombre = window.__ombre(window.__original('bande'))
                const miroirs = window.__copies('bande').flatMap(k => [...k.querySelectorAll('mjs-carte-produit')])
                const effet = new Set(window.__suivis.filter(s => s[1] === run).map(s => s[0]))
                const suitOmbre = window.__suivis.some(s => effet.has(s[0]) && s[1] === ombre)
                b._mjs_fxOff.marquee()
                return { effet: effet.size, suitOmbre, miroirs: miroirs.length, connectes: miroirs.filter(h => h.isConnected).length, copies: b.querySelectorAll('[mjs-fx-marquee-copy]').length, restants: window.__suivis.filter(s => effet.has(s[0])).length, carte: !!b.querySelector(':scope > mjs-carte-produit') }
              })()`)
              ok(retrait.effet >= 1 && !retrait.suitOmbre, `l'effet n'observe pas l'ombre de la carte (son miroir se dessine lui-même) : ${JSON.stringify(retrait)}`)
              ok(retrait.miroirs >= 1 && retrait.connectes === 0 && retrait.copies === 0 && retrait.carte, `après le retrait, copies et miroirs sont sortis, la carte est rendue à la bande : ${JSON.stringify(retrait)}`)
              ok(retrait.restants === 0, `après le retrait, aucun observateur de l'effet : ${JSON.stringify(retrait)}`)
              await lit('window.__prix(21)')
              await page.waitForTimeout(300)
              const fin = await lit(`window.__etat('tiree')`)
              ok(fin.copies.every((k: any) => k && k.prix === '21 €'), `l'autre bande suit toujours : ${JSON.stringify(fin)}`)
            }

            ok(erreurs.length === 0, `aucune erreur dans la page : ${erreurs.join(' | ')}`)
            ok(avis.length === 0, `aucun avertissement : ${avis.join(' | ')}`)
            assert.deepEqual(echecs, [])
          }
          finally {
            await page.context().close()
          }
        })
      }
    })
  }
})
