// *marquee dans Chromium, Firefox et WebKit réels (WebKit seulement s'il est installé) : des balises qui arrivent dans la balise APRÈS la pose rejoignent la piste, et une balise vidée d'un coup retrouve la sienne.
// Les quatre poses qui demandent le défilé des balises (`unit: child`, `drag: true`, `axis: both`, `on: scroll`), chacune dans sa propre application construite, en production
// (l'application ne porte que le code que sa pose demande) et en développement. Vingt-six balises par pose, vides à la pose (la vingt et unième porte aussi `*sparkles`).
// PREMIÈRE SÉRIE, des balises ajoutées :
//   1. remplie d'un coup par un script ;  2. remplie en deux fois (deux balises, puis une troisième) ;  3. remplie, vidée, puis remplie de nouveau ;
//   4. remplie, puis ses balises partent et du texte arrive à la place ;  5. une balise arrive avant la piste, deux après : l'ordre est celui de la balise ;
//   6. remplie, puis vidée d'un coup (`replaceChildren()` puis des ajouts) : la balise se remonte avec ce qu'elle contient.
// SECONDE SÉRIE, la balise vidée d'un coup emporte sa piste avec ses enfants ; elle se remonte avec ce qu'elle contient alors, comme si elle l'avait eu à la pose :
//   7. `innerHTML` de trois balises sur une balise vide ;  8. le même sur une balise qui défile déjà ;  9. `replaceChildren(a, b, c)` ;  10. `innerHTML = ''` puis, 200 ms plus tard, des ajouts ;
//   11. `textContent` ;  12. trois remplacements dans la même tâche (un seul remontage, une seule piste, aucun observateur de plus) ;
//   13. la main tient la piste pendant le remplacement (ni erreur ni écouteur laissé) ;  14. le retrait de l'effet après un remplacement rend la balise telle que le script l'a laissée.
// TROISIÈME SÉRIE, un script relit la balise puis la réécrit (`innerHTML +=`) : elle reçoit un clone de sa piste, avec ses copies, que la piste neuve ne doit pas ranger tel quel :
//   15. un ajout ;  16. deux ajouts dans la même tâche ;  17. deux ajouts dans deux tâches ;  18. du texte seul (comme après un `append` de texte, la balise 19) ;  20. des balises `span`, que rien dans leur nom ne distingue d'une piste ;
//   25. un composant ajouté par un script est connecté deux fois, déconnecté une fois ;  26. un composant relu par `innerHTML +=` est connecté trois fois, déconnecté deux fois.
// QUATRIÈME SÉRIE :
//   21. le calque de `*sparkles` reste dans la balise, hors de la piste ;  22. ce que d'autres effets posent dans leur balise sans l'attribut de calque (la toile de `*heatmap`, la goutte de `*goo`, la scène de `*react`,
//   la bande et le voile de `*offline`, le squelette d'attente d'un composant vide) y reste aussi ;  23. la piste ne se refait pas à chaque arrivée (même nœud de piste, dérive CSS gardée) ;  24. un texte réécrit (`textContent`, puis `innerHTML +=`) défile.
// Une garde est posée dans chaque page : si un remontage empile des pistes ou des observateurs sans fin, elle coupe tous les observateurs, et le test échoue avec ce qu'elle a vu au lieu de laisser la page tourner.
// Attendu : les balises sont dans la piste (une seule, aucune balise à côté), avec des copies, et elles défilent (la dérive pour `unit: child` et `drag`, le geste pour `axis: both` et `on: scroll`) ;
// le texte passe par la piste quand la pose la veut (`drag`, `axis: both`, `on: scroll`) et reprend le calque pour `unit: child` ; ni avertissement ni erreur.
// Et pour `unit: child`, dont la piste se défait quand la balise n'a plus de balises : chaque aller-retour entre le texte et la piste ne laisse aucun observateur de plus sur la balise.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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

const STYLE = '\n<style>\n:host\n  display: block\ndiv\n  box-sizing: border-box\n.a\n  width: 400px\n  height: 30px\n  margin: 4px\n.logo\n  width: 100px\n  height: 26px\n.pad\n  height: 3000px\n</style>\n'
const BALISES = 26
const ETINCELLES = 21
// ce que d'autres effets posent dans leur balise : l'attribut de leur calque (`mjs-fx-layer`, celui de presque tous) et, pour cinq d'entre eux, un autre (`*heatmap`, `*goo`, `*react`, `*offline` qui en pose deux, le squelette d'attente d'un composant vide)
const AUTRES = ['mjs-fx-layer', 'mjs-fx-heatmap-layer', 'mjs-fx-goo-drop', 'mjs-fx-react-stage', 'mjs-fx-offline-band', 'mjs-fx-offline-veil', 'mjs-skel-zone']
const AUTRES_SEL = AUTRES.map(n => '[' + n + ']').join(',')

// `geste` : ce qui fait défiler la piste (la dérive CSS toute seule pour unit: child et drag, la souris pour axis: both, la page pour on: scroll) ; `main` : la pose met la piste sous la main (drag, axis: both)
type Pose = { c: string, reglage: string, geste: 'derive' | 'souris' | 'page', main: boolean }
const POSES: Pose[] = [
  { c: 'c', reglage: 'unit: child', geste: 'derive', main: false },
  { c: 'd', reglage: 'drag: true', geste: 'derive', main: true },
  { c: 'x', reglage: 'axis: both', geste: 'souris', main: true },
  { c: 's', reglage: 'on: scroll', geste: 'page', main: false }
]

// une application = une pose, en production ou en développement (le fichier de l'effet entier)
type Appli = { nom: string, env: 'prod' | 'dev', pose: Pose, source: string }
const APPLIS: Appli[] = POSES.flatMap(pose => (['prod', 'dev'] as const).map(env => ({
  nom: `${pose.reglage}, ${env === 'prod' ? 'production' : 'développement'}`,
  env,
  pose,
  source: '<script>\n$l = []\n</script>\n' + Array.from({ length: BALISES }, (_, k) => `<div class="a ${pose.c}${k + 1}" *marquee(${pose.reglage}, speed: 4s, gap: 10)${k + 1 === ETINCELLES ? ' *sparkles' : ''}></div>`).join('') + '<div class="pad"></div>' + STYLE
})))

// le script de la page note les observateurs de changements en vie, tous ceux qui ont suivi une balise (ils ne se retirent jamais de la liste) et les écouteurs en vie
const SUIVI = `(() => {
  window.__suivis = []
  window.__observes = []
  window.__ecouteurs = []
  const observe = MutationObserver.prototype.observe
  const disconnect = MutationObserver.prototype.disconnect
  MutationObserver.prototype.observe = function(n, o) { window.__suivis.push([this, n]); window.__observes.push(n); return observe.call(this, n, o) }
  MutationObserver.prototype.disconnect = function() { window.__suivis = window.__suivis.filter(s => s[0] !== this); return disconnect.call(this) }
  const capture = (o) => typeof o === 'boolean' ? o : !!(o && o.capture)
  const ajoute = EventTarget.prototype.addEventListener
  const retire = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function(t, f, o) { if (!window.__ecouteurs.some(e => e[0] === this && e[1] === t && e[2] === f && e[3] === capture(o))) window.__ecouteurs.push([this, t, f, capture(o)]); return ajoute.call(this, t, f, o) }
  EventTarget.prototype.removeEventListener = function(t, f, o) { window.__ecouteurs = window.__ecouteurs.filter(e => !(e[0] === this && e[1] === t && e[2] === f && e[3] === capture(o))); return retire.call(this, t, f, o) }
  // la garde : un remontage qui ne défait pas l'ancienne piste empile des pistes (ou des observateurs) sans fin, et la page ne rend plus la main ; elle passe en premier, coupe tous les observateurs et note ce qu'elle a vu
  window.__boucle = ''
  window.__garde = (racine) => {
    // les rondes d'observateurs sont des micro-tâches : tant que la page boucle, la minuterie qui les remet à zéro ne passe pas
    let rondes = 0
    let attente = false
    const garde = new MutationObserver(() => {
      if (window.__boucle) return
      rondes++
      if (!attente) {
        attente = true
        setTimeout(() => { rondes = 0; attente = false }, 0)
      }
      const n = new Map()
      for (const s of window.__suivis) n.set(s[1], (n.get(s[1]) || 0) + 1)
      const max = Math.max(0, ...n.values())
      if (racine.querySelector('[mjs-fx-marquee-run] [mjs-fx-marquee-run] [mjs-fx-marquee-run] [mjs-fx-marquee-run]')) window.__boucle = "des pistes empilées sur quatre niveaux (le remontage ne défait pas l'ancienne piste)"
      else if (max > 8) window.__boucle = max + " observateurs sur un même nœud (un observateur de la balise n'est pas rendu au remontage)"
      else if (rondes > 200) window.__boucle = rondes + " rondes d'observateurs sans rendre la main (un remontage en défait un autre sans fin)"
      if (!window.__boucle) return
      for (const s of [...window.__suivis]) disconnect.call(s[0])
      window.__suivis = []
    })
    observe.call(garde, racine, { childList: true, subtree: true })
  }
})()`

const BOITE = (classe: string) => `window.__racine(TAG).querySelector('.${classe}')`
const logo = (t: string) => `<div class="logo">${t}</div>`
const logos = (lettres: string) => [...lettres].map(logo).join('')
const creer = (lettres: string[]) => `${JSON.stringify(lettres)}.map(t => { const d = document.createElement('div'); d.className = 'logo'; d.textContent = t; return d })`
// un script qui ajoute des balises dans la balise, en retire (celles de la piste, jamais ses copies), les remplace par du texte, ou vide la balise d'un coup
const remplir = (classe: string, lettres: string[]) => `(() => { ${BOITE(classe)}.append(...${creer(lettres)}) })()`
const enTete = (classe: string, lettre: string) => `(() => { const a = ${BOITE(classe)}; const d = document.createElement('div'); d.className = 'logo'; d.textContent = '${lettre}'; a.insertBefore(d, a.firstChild) })()`
const vider = (classe: string) => `(() => { const a = ${BOITE(classe)}; for (const d of [...a.querySelectorAll('.logo')]) if (!d.closest('[mjs-fx-marquee-copy]')) d.remove() })()`
const texte = (classe: string) => `(() => { const a = ${BOITE(classe)}; for (const d of [...a.querySelectorAll('.logo')]) if (!d.closest('[mjs-fx-marquee-copy]')) d.remove(); a.appendChild(document.createTextNode('Du texte')) })()`
const toutVider = (classe: string, lettres: string[]) => `(() => { const a = ${BOITE(classe)}; a.replaceChildren(); a.append(...${creer(lettres)}) })()`
const ecrire = (classe: string, contenu: string) => `(() => { ${BOITE(classe)}.innerHTML = ${JSON.stringify(contenu)} })()`
const remplacer = (classe: string, lettres: string[]) => `(() => { ${BOITE(classe)}.replaceChildren(...${creer(lettres)}) })()`
const ecrireTexte = (classe: string, t: string) => `(() => { ${BOITE(classe)}.textContent = ${JSON.stringify(t)} })()`
// un script relit la balise puis la réécrit avec ce qu'il ajoute (`innerHTML +=`) : elle reçoit un clone de sa piste, avec ses copies
const plus = (classe: string, html: string) => `(() => { ${BOITE(classe)}.innerHTML += ${JSON.stringify(html)} })()`
const plusDeux = (classe: string, un: string, deux: string) => `(() => { const a = ${BOITE(classe)}; a.innerHTML += ${JSON.stringify(un)}; a.innerHTML += ${JSON.stringify(deux)} })()`
const ajouter = (classe: string, html: string) => `(() => { ${BOITE(classe)}.insertAdjacentHTML('beforeend', ${JSON.stringify(html)}) })()`
const spans = (lettres: string) => [...lettres].map(t => `<span class="logo"><b>${t}</b></span>`).join('')
// un élément personnalisé qui compte ses connexions et ses déconnexions : un composant ajouté par un script, ou relu par innerHTML +=
const composant = `(() => { if (!customElements.get('x-compte')) customElements.define('x-compte', class extends HTMLElement { connectedCallback() { this.__co = (this.__co || 0) + 1 } disconnectedCallback() { this.__de = (this.__de || 0) + 1 } }) })()`
const ajouterComposant = (classe: string) => `(() => { ${BOITE(classe)}.append(document.createElement('x-compte')) })()`
const connexions = (classe: string) => `(() => [...${BOITE(classe)}.querySelectorAll('x-compte')].filter(x => !x.closest('[mjs-fx-marquee-copy]')).map(x => [x.__co || 0, x.__de || 0]))()`
const trois = (classe: string) => `(() => { const a = ${BOITE(classe)}; for (const l of ['JKL', 'MNO', 'PQR']) a.innerHTML = [...l].map(x => '<div class="logo">' + x + '</div>').join('') })()`
// où sont les balises à l'instant : dans la piste, à côté d'elle, le texte, les copies, la main
const etat = (classe: string) => `(() => {
  const a = ${BOITE(classe)}
  const pistes = [...a.children].filter(c => c.hasAttribute('mjs-fx-marquee-run'))
  const r = pistes[0]
  const propres = r ? [...r.childNodes].filter(n => !(n.nodeType === 1 && n.hasAttribute('mjs-fx-marquee-copy'))) : []
  return {
    strip: a.getAttribute('mjs-fx-marquee-strip'),
    piste: !!r,
    pistes: pistes.length,
    dansPiste: propres.filter(n => n.nodeType === 1 && n.classList.contains('logo')).length,
    dansBalise: [...a.children].filter(c => c.classList.contains('logo')).length,
    ordre: r ? [...r.children].filter(c => c.classList.contains('logo')).map(c => c.textContent).join('') : null,
    vues: [...a.querySelectorAll('.logo')].filter(l => !l.closest('[mjs-fx-marquee-copy]')).length,
    texteDansPiste: propres.some(n => n.nodeType === 3 && n.textContent.includes('Du texte')),
    texteDansBalise: [...a.childNodes].some(n => n.nodeType === 3 && n.textContent.includes('Du texte')),
    copies: r ? r.querySelectorAll(':scope > [mjs-fx-marquee-copy]').length : 0,
    calque: !!a.querySelector('[mjs-fx-marquee-track]'),
    imbriquees: a.querySelectorAll('[mjs-fx-marquee-run] [mjs-fx-marquee-run]').length,
    dedans: (() => { const b = a.getBoundingClientRect(); return [...a.querySelectorAll('.logo')].filter(l => !l.closest('[mjs-fx-marquee-copy]')).filter(l => { const q = l.getBoundingClientRect(); return q.top >= b.top - 1 && q.bottom <= b.bottom + 1 }).length })(),
    autres: [...a.children].filter(c => c.matches(${JSON.stringify(AUTRES_SEL)})).length,
    autresDansPiste: r ? [...r.children].filter(c => c.matches(${JSON.stringify(AUTRES_SEL)})).length : 0,
    sparkles: !!a.querySelector(':scope > [mjs-fx-layer="sparkles"]'),
    sparklesDansPiste: r ? !!r.querySelector('[mjs-fx-layer="sparkles"]') : false,
    texteRun: r ? propres.map(n => n.textContent).join('') : null,
    copiesOk: r ? [...r.querySelectorAll(':scope > [mjs-fx-marquee-copy]')].every(c => [...c.children].map(x => x.textContent).join('') === [...r.children].filter(x => !x.hasAttribute('mjs-fx-marquee-copy')).map(x => x.textContent).join('')) : true,
    calques: [...a.children].filter(c => c.hasAttribute('mjs-fx-layer') && c.firstElementChild && c.firstElementChild.hasAttribute('mjs-fx-marquee-track')).length,
    texteCalque: (() => { const p = a.querySelector(':scope > [mjs-fx-layer] > [mjs-fx-marquee-track] > span'); return p ? p.textContent : null })(),
    anim: (() => { const p = a.querySelector('[mjs-fx-marquee-track]'); const x = p ? p.getAnimations() : []; return x.length ? Math.round(x[0].currentTime) : null })(),
    main: a.hasAttribute('mjs-fx-marquee-drag'),
    tenue: a.hasAttribute('mjs-fx-marquee-held')
  }
})()`
// la piste de la balise, marquée d'une propriété (elle ne la porterait plus si elle était refaite), et où en est sa dérive CSS (-1 : aucune ; null : pas de piste)
const marquer = (classe: string) => `(() => { const r = ${BOITE(classe)}.querySelector(':scope > [mjs-fx-marquee-run]'); if (!r) return null; r.__garde = 1; const x = r.getAnimations(); return x.length ? Math.round(x[0].currentTime) : -1 })()`
const retrouver = (classe: string) => `(() => { const r = ${BOITE(classe)}.querySelector(':scope > [mjs-fx-marquee-run]'); if (!r) return null; const x = r.getAnimations(); return { meme: r.__garde === 1, temps: x.length ? Math.round(x[0].currentTime) : -1 } })()`
// la position de la première balise (celle de la piste, ou à côté d'elle si elle y est restée), à défaut la piste elle-même pour un texte
const gauche = (classe: string) => `(() => { const a = ${BOITE(classe)}; const l = a.querySelector('.logo') || a.querySelector('[mjs-fx-marquee-run]'); return l ? Math.round(l.getBoundingClientRect().left * 10) / 10 : null })()`
const coin = (classe: string) => `(() => { const r = ${BOITE(classe)}.getBoundingClientRect(); return { x: r.left, y: r.top } })()`
// les observateurs de changements qui suivent la balise à l'instant, tous ceux qui l'ont suivie, les écouteurs de la balise (d'un type) et ceux de la fenêtre qui servent au geste
const suivis = (classe: string) => `window.__suivis.filter(s => s[1] === ${BOITE(classe)}).length`
const montages = (classe: string) => `window.__observes.filter(n => n === ${BOITE(classe)}).length`
const ecouteurs = (classe: string, type: string) => `window.__ecouteurs.filter(e => e[0] === ${BOITE(classe)} && e[1] === '${type}').length`
// les observateurs de changements qui suivent encore un nœud sorti de la page (une piste défaite qui n'a pas rendu les siens)
const orphelins = 'window.__suivis.filter(s => !s[1].isConnected).length'
const ecouteursGeste = 'window.__ecouteurs.filter(e => e[0] === window && ["pointermove", "pointerup", "pointercancel", "lostpointercapture"].includes(e[1])).length'

// les constats d'un cas : tout est relevé, puis rendu d'un bloc
function bilan() {
  const echecs: string[] = []
  const ok = (cond: boolean, msg: string) => { if (!cond) echecs.push(msg) }
  // les balises dans l'ordre attendu, dans la piste (une seule), aucune à côté ni ailleurs, avec des copies
  const enPiste = (e: any, qui: string, ordre: string) => ok(e.piste && e.pistes === 1 && e.strip === 'kids' && e.dansPiste === ordre.length && e.dansBalise === 0 && e.ordre === ordre && e.vues === ordre.length && e.copies >= 1, `${qui} : « ${ordre} » doit être dans la piste, une seule, avec des copies : ${JSON.stringify(e)}`)
  return { echecs, ok, enPiste }
}

// la garde de la page a coupé les observateurs : le test échoue ici, en premier, avec ce qu'elle a vu
async function boucle(lit: (js: string) => Promise<any>, echecs: string[]) {
  const vu = await lit('window.__boucle')
  if (vu) echecs.unshift('le remontage boucle : ' + vu)
}

// la main tire la balise de 60 px vers la gauche
async function glisser(page: any, lit: (js: string) => Promise<any>, classe: string) {
  const p = await lit(coin(classe))
  await page.mouse.move(p.x + 300, p.y + 15)
  await page.mouse.down()
  await page.mouse.move(p.x + 240, p.y + 15, { steps: 6 })
  await page.mouse.up()
}

// elles défilent : la première balise de chacune change de place sous le geste de la pose (le texte : la piste)
async function defile(page: any, lit: (js: string) => Promise<any>, pose: Pose, noms: string[], ok: (cond: boolean, msg: string) => void) {
  const avant: Record<string, number> = {}
  for (const k of noms) avant[k] = await lit(gauche(k))
  if (pose.geste === 'page') await page.evaluate('window.scrollTo(0, 80)')
  for (const k of noms) {
    if (pose.geste === 'souris') await glisser(page, lit, k)
    let bouge = false
    for (let n = 0; n < 20 && !bouge; n++) {
      const l = await lit(gauche(k))
      if (l !== null && Math.abs(l - avant[k]) > 4) bouge = true
      else await page.waitForTimeout(150)
    }
    ok(bouge, `${k} défile (${pose.geste}) : sa première balise ne bouge pas, de ${avant[k]}`)
  }
}

// la page de l'application `tag` : les erreurs et les avertissements de la console sont relevés, TAG est remplacé par la balise du composant dans chaque expression lue dans la page
async function ouvrir(browser: any, script: string, tag: string) {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 1000 } })).newPage()
  const erreurs: string[] = []
  const avis: string[]    = []
  page.on('pageerror', (e: any) => erreurs.push(String(e)))
  page.on('console', (m: any) => {
    if (m.type() === 'error') erreurs.push(m.text())
    else if (m.type() === 'warning' && m.text().startsWith('[ModularJS]')) avis.push(m.text())
  })
  await page.addInitScript(`window.__racine = (tag) => {
    const el = document.querySelector(tag)
    if (!el) return null
    if (el.shadowRoot) return el.shadowRoot
    for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
    return el
  }`)
  await page.addInitScript(SUIVI)
  await page.route('http://t.test/**', (route: any) => {
    if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
  })
  await page.goto('http://t.test/', { waitUntil: 'load' })
  await page.waitForFunction(`!!window.__racine('${tag}')?.querySelector('.a')`, null, { timeout: 20000 })
  await page.waitForTimeout(300)
  await page.evaluate(`window.__garde(window.__racine('${tag}'))`)
  const lit = (js: string) => page.evaluate(js.replace(/TAG/g, `'${tag}'`))
  const evaluate = page.evaluate.bind(page)
  page.evaluate = (js: any, ...args: any[]) => evaluate(typeof js === 'string' ? js.replace(/TAG/g, `'${tag}'`) : js, ...args)
  return { page, lit, avis, erreurs }
}

describe('*marquee — des balises qui arrivent après la pose, une balise vidée d\'un coup : la piste (navigateurs réels)', function () {
  this.timeout(1800000)
  // chaque application est construite à la première page qui la demande (un essai ciblé ne construit que la sienne)
  const scripts: Record<number, string> = {}
  const construire = async (i: number): Promise<string> => {
    if (scripts[i]) return scripts[i]
    const appli  = APPLIS[i]
    const root   = mjsTmp('marquee-apres-nav-' + i)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'z-' + i + '.mjs'), appli.source)
    // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
    const manifeste = join(outDir, 'bundle.js')
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle' }
    if (appli.env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [], appli.nom)
    return scripts[i] = stripEsm(readFileSync(manifeste, 'utf-8'))
  }

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { await browser?.close() })

      APPLIS.forEach((appli, i) => {
        const { pose } = appli
        const tag      = 'mjs-z-' + i

        it(appli.nom, async () => {
          const { page, lit, avis, erreurs } = await ouvrir(browser, await construire(i), tag)
          try {
            const { echecs, ok, enPiste } = bilan()
            const [a, d, v, t, e, w] = [1, 2, 3, 4, 5, 6].map(n => pose.c + n)

            // 1 : remplie d'un coup ; 2 : deux balises ; 3 : remplie ; 4 : remplie (avant que ses balises partent) ; 5 : deux balises ; 6 : remplie (avant d'être vidée d'un coup)
            await page.evaluate(remplir(a, ['A', 'B', 'C']))
            await page.evaluate(remplir(d, ['A', 'B']))
            await page.evaluate(remplir(v, ['A', 'B', 'C']))
            await page.evaluate(remplir(t, ['A', 'B', 'C']))
            await page.evaluate(remplir(e, ['B', 'C']))
            await page.evaluate(remplir(w, ['A', 'B', 'C']))
            await page.waitForTimeout(700)
            // 2 : la troisième balise ; 3 : vidée ; 4 : ses balises partent et du texte arrive à la place ; 5 : une balise arrive avant la piste ; 6 : vidée d'un coup et remplie de trois autres balises
            await page.evaluate(remplir(d, ['C']))
            await page.evaluate(vider(v))
            await page.evaluate(texte(t))
            await page.evaluate(enTete(e, 'A'))
            await page.evaluate(toutVider(w, ['D', 'E', 'F']))
            await page.waitForTimeout(700)
            const videe = await lit(etat(v))
            ok(videe.dansPiste === 0 && videe.dansBalise === 0 && videe.copies === 0, `la balise vidée n'a plus de balise ni de copie : ${JSON.stringify(videe)}`)
            // 3 : remplie de nouveau
            await page.evaluate(remplir(v, ['G', 'H', 'I']))
            await page.waitForTimeout(700)

            enPiste(await lit(etat(a)), 'remplie après la pose', 'ABC')
            enPiste(await lit(etat(d)), 'remplie en deux fois', 'ABC')
            enPiste(await lit(etat(v)), 'vidée puis remplie', 'GHI')
            enPiste(await lit(etat(e)), 'une balise arrivée avant la piste est la première', 'ABC')
            enPiste(await lit(etat(w)), 'vidée d\'un coup puis remplie', 'DEF')
            const x = await lit(etat(t))
            if (pose.c === 'c') {
              // unit: child : le texte reprend le calque, la piste est partie
              ok(!x.piste && x.calque && x.texteDansBalise, `le texte qui remplace les balises reprend le calque : ${JSON.stringify(x)}`)
            }
            else {
              // drag, axis: both, on: scroll : le texte passe par la piste
              ok(x.piste && x.strip === 'text' && x.texteDansPiste && !x.texteDansBalise && x.copies >= 1, `le texte qui remplace les balises doit être dans la piste, avec des copies : ${JSON.stringify(x)}`)
            }

            await defile(page, lit, pose, pose.c === 'c' ? [a, d, v, w] : [a, d, v, w, t], ok)

            if (pose.c === 'c') {
              // la balise passe de la piste au texte puis revient, deux fois de plus : la piste défaite rend ses observateurs
              const base = await lit(suivis(v))
              for (let n = 0; n < 2; n++) {
                await page.evaluate(vider(v))
                await page.waitForTimeout(300)
                await page.evaluate(remplir(v, ['G', 'H', 'I']))
                await page.waitForTimeout(300)
              }
              const fin = await lit(suivis(v))
              ok(fin === base, `la piste défaite doit rendre ses observateurs : ${base} avant les allers-retours, ${fin} après`)
              enPiste(await lit(etat(v)), 'vidée puis remplie, deux fois de plus', 'GHI')
            }
            ok((await lit(orphelins)) === 0, `aucun observateur ne suit un nœud sorti de la page : ${await lit(orphelins)}`)

            await boucle(lit, echecs)
            assert.deepEqual(echecs, [])
            assert.deepEqual(avis, [], 'ni avertissement du développement ni message de production')
            assert.deepEqual(erreurs, [])
          }
          finally {
            await page.close()
          }
        })

        it(appli.nom + ' — après un vidage d\'un coup', async () => {
          const { page, lit, avis, erreurs } = await ouvrir(browser, await construire(i), tag)
          try {
            const { echecs, ok, enPiste } = bilan()
            const [b7, b8, b9, b10, b11, b12, b13, b14] = [7, 8, 9, 10, 11, 12, 13, 14].map(n => pose.c + n)

            // 7 : vide, un script écrit trois balises d'un coup ; 8 à 14 : trois balises ajoutées, elles défilent déjà avant d'être vidées
            await page.evaluate(ecrire(b7, logos('ABC')))
            for (const k of [b8, b9, b10, b11, b12, b13, b14]) await page.evaluate(remplir(k, ['A', 'B', 'C']))
            await page.waitForTimeout(700)
            const base = { suivis: await lit(suivis(b12)), montages: await lit(montages(b12)), geste: await lit(ecouteursGeste) }

            // 13 : la main tient la piste (au-delà de 5 px) avant que la balise soit vidée
            if (pose.main) {
              const p = await lit(coin(b13))
              await page.mouse.move(p.x + 300, p.y + 15)
              await page.mouse.down()
              await page.mouse.move(p.x + 240, p.y + 15, { steps: 6 })
              ok((await lit(etat(b13))).tenue, 'la main tient la piste avant le remplacement')
            }
            // 8 : innerHTML ; 9 : replaceChildren(x, y, z) ; 10 : innerHTML = '' ; 11 : textContent ; 12 : trois remplacements dans la même tâche ; 13 : innerHTML pendant le geste ; 14 : innerHTML
            await page.evaluate(ecrire(b8, logos('DEF')))
            await page.evaluate(remplacer(b9, ['X', 'Y', 'Z']))
            await page.evaluate(ecrire(b10, ''))
            await page.evaluate(ecrireTexte(b11, 'Du texte'))
            await page.evaluate(trois(b12))
            await page.evaluate(ecrire(b13, logos('JKL')))
            await page.evaluate(ecrire(b14, logos('GHI')))
            await page.waitForTimeout(700)
            if (pose.main) {
              await page.mouse.up()
              await page.waitForTimeout(300)
            }

            enPiste(await lit(etat(b7)), 'innerHTML sur une balise vide', 'ABC')
            enPiste(await lit(etat(b8)), 'innerHTML sur une balise qui défile déjà', 'DEF')
            enPiste(await lit(etat(b9)), 'replaceChildren(x, y, z)', 'XYZ')
            // 10 : vidée, la balise est prête à recevoir (une piste vide, ou le calque pour unit: child), comme à la pose d'une balise vide
            const prete = await lit(etat(b10))
            if (pose.c === 'c') ok(!prete.piste && prete.calque && prete.vues === 0, `la balise vidée est prête à recevoir (le calque) : ${JSON.stringify(prete)}`)
            else ok(prete.piste && prete.pistes === 1 && prete.strip === 'text' && prete.vues === 0 && prete.copies === 0, `la balise vidée est prête à recevoir (une piste vide) : ${JSON.stringify(prete)}`)
            const x = await lit(etat(b11))
            if (pose.c === 'c') {
              ok(!x.piste && x.calque && x.texteDansBalise, `textContent : le texte reprend le calque : ${JSON.stringify(x)}`)
            }
            else {
              ok(x.piste && x.pistes === 1 && x.strip === 'text' && x.texteDansPiste && !x.texteDansBalise && x.copies >= 1, `textContent : le texte doit être dans la piste, avec des copies : ${JSON.stringify(x)}`)
            }
            // 12 : un seul remontage (un observateur de plus à avoir suivi la balise), une seule piste, aucun observateur laissé
            enPiste(await lit(etat(b12)), 'trois remplacements dans la même tâche', 'PQR')
            const fin = { suivis: await lit(suivis(b12)), montages: await lit(montages(b12)) }
            ok(fin.suivis === base.suivis, `aucun observateur de plus sur la balise : ${base.suivis} avant, ${fin.suivis} après`)
            ok(fin.montages - base.montages === 1, `un seul remontage pour trois remplacements : ${fin.montages - base.montages}`)
            // 13 : la main a lâché, rien n'est resté (ni écouteur de la fenêtre ni marque de la main), la piste neuve a sa main
            if (pose.main) {
              const g = await lit(etat(b13))
              enPiste(g, 'innerHTML pendant que la main tient la piste', 'JKL')
              ok(!g.tenue && g.main, `la marque du geste est partie, celle de la main est posée : ${JSON.stringify(g)}`)
              ok((await lit(ecouteursGeste)) === base.geste, `aucun écouteur du geste n'est resté sur la fenêtre : ${base.geste} avant, ${await lit(ecouteursGeste)} après`)
              for (const type of ['pointerdown', 'click', 'dragstart']) ok((await lit(ecouteurs(b13, type))) === 1, `un seul écouteur ${type} sur la balise : ${await lit(ecouteurs(b13, type))}`)
            }

            // 10 : 200 ms plus tard, des ajouts
            await page.waitForTimeout(200)
            await page.evaluate(remplir(b10, ['G', 'H', 'I']))
            await page.waitForTimeout(700)
            enPiste(await lit(etat(b10)), 'innerHTML = \'\' puis des ajouts', 'GHI')

            await defile(page, lit, pose, pose.c === 'c' ? [b7, b8, b9, b10, b12] : [b7, b8, b9, b10, b12, b11], ok)

            // 14 : le retrait de l'effet rend la balise telle que le script l'a laissée
            enPiste(await lit(etat(b14)), 'innerHTML avant le retrait', 'GHI')
            // le registre des effets de la balise (son nom de propriété est réduit en production) rend le retrait de l'effet
            const retrait = await lit(`(() => { const a = ${BOITE(b14)}; const o = Object.getOwnPropertyNames(a).map(k => a[k]).find(x => x && typeof x.marquee === 'function'); if (!o) return { absent: true }; try { o.marquee() } catch (err) { return { erreur: String(err) } } return { html: a.innerHTML, marques: a.getAttributeNames().filter(n => n.startsWith('mjs-fx-marquee')) } })()`)
            ok(!retrait.absent && !retrait.erreur && retrait.html === logos('GHI') && retrait.marques.length === 0, `le retrait rend la balise telle que le script l'a laissée : ${JSON.stringify(retrait)}`)
            ok((await lit(orphelins)) === 0, `aucun observateur ne suit un nœud sorti de la page : ${await lit(orphelins)}`)

            await boucle(lit, echecs)
            assert.deepEqual(echecs, [])
            assert.deepEqual(avis, [], 'ni avertissement du développement ni message de production')
            assert.deepEqual(erreurs, [])
          }
          finally {
            await page.close()
          }
        })

        it(appli.nom + ' — innerHTML +=, la piste relue puis réécrite', async () => {
          const { page, lit, avis, erreurs } = await ouvrir(browser, await construire(i), tag)
          try {
            const { echecs, ok, enPiste } = bilan()
            const [b15, b16, b17, b18, b19, b20, b25, b26] = [15, 16, 17, 18, 19, 20, 25, 26].map(n => pose.c + n)
            // aucune piste dans la piste, et toutes les balises dans la balise (la nappe revient à la ligne : sa seconde ligne est rognée)
            const net = (e: any, qui: string) => ok(e.imbriquees === 0 && e.copiesOk && (pose.c === 'x' || e.dedans === e.vues), `${qui} : aucune piste dans la piste, des copies pareilles aux balises, les balises toutes dans la balise : ${JSON.stringify(e)}`)

            // A B C défilent déjà ; 20 : des span (la piste en est un : rien dans leur nom ne les distingue)
            for (const k of [b15, b16, b17, b18, b19, b25, b26]) await page.evaluate(remplir(k, ['A', 'B', 'C']))
            await page.evaluate(ajouter(b20, spans('ABC')))
            // 25 et 26 : un composant que le script ajoute à des balises qui défilent déjà
            await page.evaluate(composant)
            await page.evaluate(ajouterComposant(b25))
            await page.evaluate(ajouterComposant(b26))
            await page.waitForTimeout(700)
            // 15 : un ajout ; 16 : deux ajouts dans la même tâche ; 17 : deux ajouts dans deux tâches ; 18 : du texte seul ; 19 : le même texte par append (le témoin) ; 20 : un span de plus
            await page.evaluate(plus(b15, logo('Z')))
            await page.evaluate(plusDeux(b16, logo('Y'), logo('Z')))
            await page.evaluate(plus(b17, logo('Y')))
            await page.waitForTimeout(500)
            await page.evaluate(plus(b17, logo('Z')))
            await page.evaluate(plus(b18, 'Du texte'))
            await page.evaluate(`(() => { ${BOITE(b19)}.append(document.createTextNode('Du texte')) })()`)
            await page.evaluate(plus(b20, spans('Z')))
            await page.evaluate(plus(b26, logo('Z')))
            await page.waitForTimeout(900)

            for (const [k, ordre, qui] of [[b15, 'ABCZ', 'un ajout'], [b16, 'ABCYZ', 'deux ajouts dans la même tâche'], [b17, 'ABCYZ', 'deux ajouts dans deux tâches'], [b20, 'ABCZ', 'des balises span']]) {
              const e = await lit(etat(k))
              enPiste(e, 'innerHTML + : ' + qui, ordre)
              net(e, 'innerHTML + : ' + qui)
            }
            // un composant : ajouté par un script, il est connecté deux fois (il entre dans la page, puis dans le défilé) ; relu par innerHTML +=, trois fois (recréé, puis sorti du clone, puis dans la piste)
            const c25 = await lit(connexions(b25))
            const c26 = await lit(connexions(b26))
            ok(JSON.stringify(c25) === '[[2,1]]', `un composant ajouté par un script : connecté deux fois, déconnecté une fois : ${JSON.stringify(c25)}`)
            ok(JSON.stringify(c26) === '[[3,2]]', `un composant relu par innerHTML + : connecté trois fois, déconnecté deux fois : ${JSON.stringify(c26)}`)
            enPiste(await lit(etat(b25)), 'un composant ajouté', 'ABC')
            enPiste(await lit(etat(b26)), 'innerHTML + avec un composant', 'ABCZ')
            // du texte seul : la balise devient ce que append de texte en fait, sans piste dans la piste
            const t = await lit(etat(b18))
            const w = await lit(etat(b19))
            const cles = ['strip', 'piste', 'pistes', 'dansPiste', 'dansBalise', 'calque', 'texteDansPiste', 'texteDansBalise']
            ok(t.imbriquees === 0 && cles.every(c => t[c] === w[c]), `innerHTML + de texte : la balise est comme après un append de texte : ${JSON.stringify(t)} contre ${JSON.stringify(w)}`)
            if (pose.c !== 'c') ok(t.piste && t.dansPiste === 3 && t.texteDansPiste && t.copies >= 1, `innerHTML + de texte : les trois balises et le texte sont dans la piste, avec des copies : ${JSON.stringify(t)}`)

            await defile(page, lit, pose, [b15, b16, b17, b20], ok)

            await boucle(lit, echecs)
            assert.deepEqual(echecs, [])
            assert.deepEqual(avis, [], 'ni avertissement du développement ni message de production')
            assert.deepEqual(erreurs, [])
          }
          finally {
            await page.close()
          }
        })

        it(appli.nom + ' — calques d\'autres effets, piste gardée, texte réécrit', async () => {
          const { page, lit, avis, erreurs } = await ouvrir(browser, await construire(i), tag)
          try {
            const { echecs, ok, enPiste } = bilan()
            const [b21, b22, b23, b24] = [21, 22, 23, 24].map(n => pose.c + n)

            // 21 : *sparkles pose son calque dans la balise dès la pose, puis des balises arrivent ; 22 : cinq nœuds que d'autres effets posent dans leur balise, puis des balises ;
            // 23 : deux arrivées dans deux tâches, la piste est la même après la seconde ; 24 : le texte est réécrit deux fois
            ok((await lit(etat(b21))).sparkles, 'le calque de *sparkles est dans la balise dès la pose')
            await page.evaluate(remplir(b21, ['A', 'B', 'C']))
            await page.evaluate(`(() => { const a = ${BOITE(b22)}; for (const n of ${JSON.stringify(AUTRES)}) { const e = document.createElement('i'); e.setAttribute(n, ''); a.appendChild(e) } })()`)
            await page.waitForTimeout(300)
            await page.evaluate(remplir(b22, ['A', 'B', 'C']))
            await page.evaluate(remplir(b23, ['A', 'B']))
            await page.waitForTimeout(700)
            const avant = await lit(marquer(b23))
            await page.evaluate(remplir(b23, ['C']))
            await page.evaluate(ecrireTexte(b24, 'Du texte'))
            await page.waitForTimeout(700)
            await page.evaluate(ecrireTexte(b24, 'autre'))
            await page.waitForTimeout(700)

            const e21 = await lit(etat(b21))
            enPiste(e21, 'à côté du calque de *sparkles', 'ABC')
            ok(e21.sparkles && !e21.sparklesDansPiste && e21.autresDansPiste === 0, `le calque de *sparkles reste dans la balise, hors de la piste : ${JSON.stringify(e21)}`)
            const e22 = await lit(etat(b22))
            enPiste(e22, 'à côté de ce que d\'autres effets posent', 'ABC')
            ok(e22.autres === AUTRES.length && e22.autresDansPiste === 0, `les ${AUTRES.length} nœuds d'autres effets restent dans la balise, hors de la piste : ${JSON.stringify(e22)}`)
            enPiste(await lit(etat(b23)), 'deux arrivées', 'ABC')
            const apres = await lit(retrouver(b23))
            ok(avant !== null && apres && apres.meme, `la piste ne se refait pas à l'arrivée d'une balise : ${JSON.stringify(apres)}`)
            ok(!apres || avant === -1 || apres.temps >= avant, `la dérive de la piste ne repart pas de zéro : ${avant} puis ${apres && apres.temps}`)

            // 24 : un texte réécrit défile : sur son calque (unit: child) ou dans la piste, avant comme après un ajout de texte par innerHTML +=
            const e24 = await lit(etat(b24))
            if (pose.c === 'c') {
              ok(e24.calques === 1 && e24.texteCalque === 'autre' && !e24.piste, `le texte réécrit garde son calque : ${JSON.stringify(e24)}`)
              await page.waitForTimeout(500)
              const plus24 = await lit(etat(b24))
              ok(e24.anim !== null && plus24.anim !== null && plus24.anim > e24.anim, `le texte réécrit défile sur son calque : ${e24.anim} puis ${plus24.anim}`)
            }
            else {
              ok(e24.pistes === 1 && e24.strip === 'text' && e24.texteRun === 'autre' && e24.copies >= 1 && e24.imbriquees === 0, `le texte réécrit passe par la piste : ${JSON.stringify(e24)}`)
            }
            await page.evaluate(plus(b24, ' suite'))
            await page.waitForTimeout(700)
            const f24 = await lit(etat(b24))
            if (pose.c === 'c') ok(f24.calques === 1 && f24.texteCalque === 'autre suite' && !f24.piste, `innerHTML + sur le texte : un seul calque, avec le texte entier : ${JSON.stringify(f24)}`)
            else ok(f24.pistes === 1 && f24.texteRun === 'autre suite' && f24.imbriquees === 0, `innerHTML + sur le texte : le texte entier est dans la piste : ${JSON.stringify(f24)}`)

            await defile(page, lit, pose, pose.c === 'c' ? [b21, b22, b23] : [b21, b22, b23, b24], ok)

            await boucle(lit, echecs)
            assert.deepEqual(echecs, [])
            assert.deepEqual(avis, [], 'ni avertissement du développement ni message de production')
            assert.deepEqual(erreurs, [])
          }
          finally {
            await page.close()
          }
        })
      })
    })
  }
})
