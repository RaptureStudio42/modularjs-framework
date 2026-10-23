// Un effet qui pose un décor dans sa balise survit à la réécriture du contenu de cette balise par un script (Chromium et Firefox réels, WebKit s'il est installé).
// Un script qui écrit `el.textContent = …`, `el.innerHTML = …` ou `el.innerHTML += …` emporte avec le texte les calques que l'effet avait posés dans la balise : le décor ne revenait jamais
// (la toile de `*scratch` partait et le secret se dévoilait, le texte de `*spoiler` restait transparent sans rien devant, les barres de `*skeleton` disparaissaient).
// L'effet est reposé sur le contenu neuf : la balise finit comme une balise où l'effet vient d'être posé, avec les mêmes réglages. Le témoin de chaque cas est une seconde balise
// où l'effet est posé d'emblée sur le contenu final : le même état visible (calques, animations, couleurs), pas seulement la présence d'un nœud.
// Les 21 effets à décor, un composant par effet (une page par effet), et pour chacun :
//   1. `textContent` ;  2. `innerHTML` avec une balise dedans ;  3. dix réécritures dans la même tâche (une seule nouvelle pose) ;  4. `innerHTML +=` (la copie figée du décor ne reste pas à côté du vrai) ;
//   5. un texte lié par `{$x}` (le décor n'est pas reposé) ;  5 bis. un script qui réécrit à chaque changement des enfants (la boucle s'arrête) ;  6. une réécriture puis le retrait de l'effet (aucun reste : nœuds, marques, style, observateur) ;
//   7. au repos après une réécriture (les quatre effets sans boucle JS ; un effet lourd, une fois finie la salve de la garde de cadence) : aucun rappel d'observateur, aucune minuterie, aucune image demandée ;  7 bis. un effet qui retire lui-même un de ses calques (le teint de `*crt`, le bandeau de `*offline` quand le réseau revient) n'est pas reposé ;  8. aucune erreur de page.
//   9. une balise qui ne contenait que le décor, vidée puis écrite dans une autre tâche (le décor perdu reste à reposer jusqu'à l'écriture suivante) ;  10. la garde coupe une boucle, jamais pour toujours (une écriture faite plus tard remet le décor) ;
//   11. des écritures dans des tâches distinctes ne sont jamais coupées, minuteries bridées ou non (onglet caché : une minuterie de 0 ms attend 1,5 s).
// Une page à part pour la reprise elle-même (`*scratch`) : la pose différée d'un effet à image loin de l'écran, un réglage lié à une variable changée avant la réécriture, des calques déplacés ou posés puis retirés dans le même lot.
// Pour `*scratch`, `*spoiler` et `*skeleton`, ce qui se voit : la toile recouvre tout, le texte caché a ses grains, les barres sont là et brillent.
// Une application de production (tous les cas) et une de développement (réécritures de base).

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

// ce que la sonde lit sur une balise : ses calques (nom, balise, boîte, opacité, affichage, animations qui courent, pixels opaques d'une toile), ses marques, son texte propre, sa couleur de texte, ce qui est au centre
type Calque = { n: string, t: string, w: number, h: number, op: number, d: string, v: string, enfants: number, barres: number[], anims: number, px: number }
type Etat   = { calques: Calque[], marques: string, propre: string, couleur: string, centre: string }

type Effet = {
  nom: string
  pose: string
  depart?: string
  neuf?: string
  html?: string
  // les effets sans boucle JS : au repos, rien ne tourne
  repos?: boolean
  // un effet lourd (définition `heavy`) : la garde de cadence demande ses images jusqu'à son verdict, le repos se mesure sa salve finie
  lourd?: boolean
  // le réseau est coupé (l'effet n'a de décor que hors ligne)
  coupure?: boolean
  // l'effet retire lui-même un de ses calques (le registre `o` de la balise donne son retrait et ses réglages) : il n'est pas reposé
  soi?: string
  // ce qui se voit, en plus de l'équivalence avec le témoin ('' quand c'est bon)
  voit?: (e: Etat) => string
}

const voitScratch = (e: Etat) => {
  const c = e.calques[0]
  if (!c) return 'aucune toile'
  if (!(c.px > 0.95)) return `la toile ne recouvre pas tout (${c.px} de pixels opaques)`
  if (e.centre !== 'scratch') return `le centre de la balise n'est pas recouvert par la toile (${e.centre})`
  return ''
}
const voitSpoiler = (e: Etat) => {
  const c = e.calques[0]
  if (!/mjs-fx-spoiler-hidden/.test(e.marques)) return 'le texte n\'est pas caché'
  if (!/rgba\(0, 0, 0, 0\)/.test(e.couleur)) return `le texte n'est pas transparent (${e.couleur})`
  if (!c) return 'le texte est transparent et rien ne le couvre'
  if (!(c.op > 0.99)) return `le calque des grains n'est pas visible (opacité ${c.op})`
  if (!(c.px > 0.005)) return `aucun grain dessiné (${c.px})`
  return ''
}
const voitSkeleton = (e: Etat) => {
  const c = e.calques[0]
  if (!c) return 'aucune barre'
  if (c.barres.length !== 3 || c.barres.some(h => !(h > 4))) return `les barres ne sont pas là : ${JSON.stringify(c.barres)}`
  if (!(c.anims > 0)) return 'les barres ne brillent pas (aucune animation)'
  return ''
}

const EFFETS: Effet[] = [
  { nom: 'annotate', pose: '*annotate(on: load, duration: 300ms)' },
  { nom: 'beam', pose: '*beam(on: load, delay: 0s, duration: 400ms)', repos: true },
  { nom: 'behind', pose: '*behind(depth: 12)' },
  { nom: 'crt', pose: '*crt(tint: red)', soi: 'o.crt._hot(\'tint\', \'\')' },
  { nom: 'fluid', pose: '*fluid' },
  { nom: 'gauge', pose: '*gauge', depart: '42', neuf: '77', html: '<b>77</b>', repos: true },
  { nom: 'goo', pose: '*goo' },
  { nom: 'grid', pose: '*grid' },
  { nom: 'loader', pose: '*loader(dots)' },
  { nom: 'matrix', pose: '*matrix' },
  { nom: 'mesh', pose: '*mesh', repos: true, lourd: true },
  { nom: 'offline', pose: '*offline(delay: 0s)', coupure: true },
  { nom: 'particles', pose: '*particles' },
  { nom: 'peel', pose: '*peel', repos: true },
  { nom: 'pixels', pose: '*pixels(fill)' },
  { nom: 'scratch', pose: '*scratch', voit: voitScratch },
  { nom: 'scrollprogress', pose: '*scrollprogress' },
  { nom: 'skeleton', pose: '*skeleton', voit: voitSkeleton },
  { nom: 'smoke', pose: '*smoke' },
  { nom: 'sparkles', pose: '*sparkles' },
  { nom: 'spoiler', pose: '*spoiler', voit: voitSpoiler }
]

const depart  = (e: Effet) => e.depart ?? 'Un texte'
const neuf    = (e: Effet) => e.neuf ?? 'Un autre texte'
const balises = (e: Effet) => e.html ?? 'Un <b>autre</b> texte'
// le texte propre d'une balise écrite avec des balises dedans
const aplat   = (e: Effet) => e.neuf ?? 'Un autre texte'

type Appli = { nom: string, env: 'prod' | 'dev', complet: boolean }
const APPLIS: Appli[] = [
  { nom: 'production', env: 'prod', complet: true },
  { nom: 'développement', env: 'dev', complet: false }
]

// le composant d'un effet : une balise par cas (tc, ih, dix, plus, repos, retrait, var) et deux témoins posés d'emblée sur le contenu final (tt, ti)
function source(e: Effet): string {
  const b = (c: string, contenu: string) => `<div class="${c}" ${e.pose}>${contenu}</div>`
  const lignes = ['<script>', `$x = '${depart(e)}'`, '</script>']
  lignes.push(b('tc', depart(e)), b('ih', depart(e)), b('tt', neuf(e)), b('ti', balises(e)), b('dix', depart(e)), b('plus', depart(e)), b('repos', depart(e)), b('retrait', depart(e)), b('boucle', depart(e)), b('var', '{$x}'), b('vide', ''), b('coupe', depart(e)), b('lent', depart(e)), b('rafale', depart(e)))
  lignes.push(`<button class="btn" @click={$x = '${neuf(e)}'}>x</button>`)
  lignes.push('<style>', ':host', '  display: block', 'div', '  width: 220px', '  height: 40px', '  margin: 4px', '  font: 14px sans-serif', '  color: #000', '  background: #fff', 'button', '  width: 14px', '  height: 14px', '  padding: 0', '</style>')
  return lignes.join('\n') + '\n'
}

// la page note les observateurs de changements en vie (ceux qui suivent un nœud), compte les rappels qui touchent chaque nœud, et compte les minuteries et les images demandées ;
// les images de la garde de cadence des effets lourds se comptent aussi à part, demandées et jouées (sa fonction d'image se reconnaît à son seuil, 60 images à 28 ms : 1680) : sa salve est finie quand plus aucune n'attend
const SUIVI = `(() => {
  window.__suivis = []
  window.__rondes = new Map()
  window.__tm = { to: 0, iv: 0, raf: 0 }
  window.__NatifMO = window.MutationObserver
  const observe    = MutationObserver.prototype.observe
  const disconnect = MutationObserver.prototype.disconnect
  MutationObserver.prototype.observe = function(n, o) { window.__suivis.push([this, n]); return observe.call(this, n, o) }
  MutationObserver.prototype.disconnect = function() { window.__suivis = window.__suivis.filter(s => s[0] !== this); return disconnect.call(this) }
  const Natif = window.MutationObserver
  window.MutationObserver = class extends Natif {
    constructor(f) {
      super((liste, o) => {
        for (const t of new Set(liste.map(r => r.target))) window.__rondes.set(t, (window.__rondes.get(t) || 0) + 1)
        return f.call(o, liste, o)
      })
    }
  }
  const st = window.setTimeout
  const si = window.setInterval
  const ra = window.requestAnimationFrame
  window.setTimeout = function(...a) { window.__tm.to++; return st.apply(this, a) }
  window.setInterval = function(...a) { window.__tm.iv++; return si.apply(this, a) }
  window.__jauge = { demandees: 0, jouees: 0 }
  window.requestAnimationFrame = function(f, ...a) {
    window.__tm.raf++
    if (typeof f === 'function' && /\\b1680\\b/.test(f)) {
      const g = f
      window.__jauge.demandees++
      f = function(t) { window.__jauge.jouees++; return g.call(this, t) }
    }
    return ra.call(this, f, ...a)
  }
})()`

const BOITE = (c: string) => `window.__racine(TAG).querySelector('.${c}')`
const LIRE  = `(el) => {
  const cs      = getComputedStyle(el)
  const est     = (c) => c.hasAttribute('mjs-fx-layer') || c.hasAttribute('mjs-fx-offline-band') || c.hasAttribute('mjs-fx-offline-veil')
  const nom     = (c) => c.getAttribute('mjs-fx-layer') || (c.hasAttribute('mjs-fx-offline-band') ? 'offline-band' : 'offline-veil')
  const calques = [...el.children].filter(est).map(c => {
    const s = getComputedStyle(c)
    const r = c.getBoundingClientRect()
    let px  = -1
    if (c.localName === 'canvas' && c.width && c.height) {
      try {
        const x = c.getContext('2d')
        if (x) {
          const d = x.getImageData(0, 0, c.width, c.height).data
          let n   = 0
          for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++
          px = Math.round(n / (d.length / 4) * 100) / 100
        }
      }
      catch (e) {}
    }
    return { n: nom(c), t: c.localName, w: Math.round(r.width), h: Math.round(r.height), op: Math.round(+s.opacity * 100) / 100, d: s.display, v: s.visibility, enfants: c.childElementCount, barres: [...c.children].slice(0, 6).map(b => Math.round(b.getBoundingClientRect().height)), anims: c.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length, px }
  })
  const r   = el.getBoundingClientRect()
  const top = el.getRootNode().elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return {
    calques,
    marques: el.getAttributeNames().filter(n => n.startsWith('mjs-fx')).sort().join(' '),
    propre: [...el.childNodes].filter(n => !(n.nodeType === 1 && est(n))).map(n => n.textContent).join(''),
    couleur: cs.color + '|' + cs.webkitTextFillColor,
    centre: top ? (top.getAttribute('mjs-fx-layer') || top.localName) : 'rien'
  }
}`
const RESTE = `(el) => ({
  marques: el.getAttributeNames().filter(n => n.startsWith('mjs-fx')),
  calques: el.querySelectorAll('[mjs-fx-layer],[mjs-fx-offline-band],[mjs-fx-offline-veil]').length,
  style: el.getAttribute('style') || '',
  suivis: window.__suivis.filter(s => s[1] === el).length,
  texte: el.textContent
})`
const lire        = (c: string) => `(${LIRE})(${BOITE(c)})`
const reste       = (c: string) => `(${RESTE})(${BOITE(c)})`
const ecrireTexte = (c: string, t: string) => `${BOITE(c)}.textContent = ${JSON.stringify(t)}`
const ecrireHtml  = (c: string, h: string) => `${BOITE(c)}.innerHTML = ${JSON.stringify(h)}`
const ajouterHtml = (c: string, h: string) => `${BOITE(c)}.innerHTML += ${JSON.stringify(h)}`
// la coupure du réseau (ou son retour) : l'état que lit l'effet, et l'événement qu'il écoute (le navigateur d'essai de Chromium est déjà hors ligne : setOffline ne change rien)
const COUPURE = (hors: boolean) => `(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => ${!hors} }); window.dispatchEvent(new Event('${hors ? 'offline' : 'online'}')) })()`
// un observateur à moi sur la balise, qui compte les calques ajoutés ; les nœuds de décor d'avant sont gardés
const SEMER = (c: string) => `(() => { const el = ${BOITE(c)}; window.__aj = window.__aj || {}; window.__ref = window.__ref || {}; window.__aj['${c}'] = 0; window.__ref['${c}'] = [...el.children].filter(k => k.hasAttribute('mjs-fx-layer')); new window.__NatifMO(l => { for (const r of l) for (const n of r.addedNodes) if (n.nodeType === 1 && n.hasAttribute('mjs-fx-layer')) window.__aj['${c}']++ }).observe(el, { childList: true, subtree: true }) })()`
// le registre des effets de la balise (son nom de propriété est réduit en production) rend le retrait de l'effet
const retirer = (c: string, nom: string) => `(() => { const a = ${BOITE(c)}; const o = Object.getOwnPropertyNames(a).map(k => a[k]).find(x => x && typeof x.${nom} === 'function'); o.${nom}() })()`

// une rafale de n écritures, chacune dans sa tâche (un message que la page s'envoie à elle-même : aucune minuterie), la dernière avec le texte final
const rafale = (c: string, n: number, final: string) => `(() => new Promise((ok) => { const el = ${BOITE(c)}; const mc = new MessageChannel(); let i = 0; mc.port1.onmessage = () => { if (i < ${n}) { el.textContent = 'm ' + (++i); mc.port2.postMessage(0) } else { el.textContent = ${JSON.stringify(final)}; mc.port1.close(); ok(i) } }; mc.port2.postMessage(0) }))()`
// des minuteries bridées comme dans un onglet caché, poussé à l'extrême pour ne pas dépendre de la charge de la machine : une minuterie de 0 ms ne part plus avant `__relacher()` (elle garde son identifiant, `clearTimeout` la retire) ;
// puis n écritures espacées de 5 ms, chacune dans sa tâche, la dernière avec le texte final ; les minuteries tenues repartent à la fin, les minuteries redeviennent normales
const BRIDER   = `(() => { const st = window.setTimeout; const ct = window.clearTimeout; window.__stOrig = st; window.__tenues = new Map(); window.setTimeout = function(f, t, ...a) { if (t !== 0 && t !== undefined) return st.call(this, f, t, ...a); const id = st.call(this, () => {}, 1e9); window.__tenues.set(id, [f, a]); return id }; window.clearTimeout = function(id) { window.__tenues.delete(id); return ct.call(this, id) }; window.__relacher = () => { const l = [...window.__tenues]; window.__tenues.clear(); window.setTimeout = st; window.clearTimeout = ct; for (const [id, [f, a]] of l) { ct.call(window, id); st.call(window, f, 0, ...a) } } })()`
const espacees = (c: string, n: number, final: string) => `(() => new Promise((ok) => { const el = ${BOITE(c)}; let i = 0; const pas = () => { if (i < ${n}) { el.textContent = 'b ' + (++i); window.__stOrig.call(window, pas, 5) } else { el.textContent = ${JSON.stringify(final)}; ok(i) } }; pas() }))()`
// les effets dont la rafale de quatre-vingts écritures se joue (les moins coûteux à poser) ; les autres jouent la rafale espacée
const RAFALE = ['scratch', 'spoiler', 'skeleton', 'sparkles', 'grid']

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
// la page de la reprise elle-même : une balise à image loin de l'écran (pose différée), deux paires de balises au réglage lié à la même variable (la couleur : l'effet repart ; la durée : suivie sur place), une balise dont on déplace les calques, une où l'on pose puis retire un calque
function sourceOutil(): string {
  const lignes = ['<script>', `$c = '#ff0000'`, `$d = '1s'`, 'setc = -> $c = \'#00ff00\'', 'setd = -> $d = \'3s\'', '</script>']
  lignes.push('<div class="sc" *scratch(color: $c)>Le secret</div>', '<div class="sw" *scratch(color: $c)>Le secret</div>', '<div class="sd" *scratch(duration: $d)>Le secret</div>', '<div class="sv" *scratch(duration: $d)>Le secret</div>', '<div class="depl" *scratch>Le secret</div>', '<div class="sonde" *scratch>Le secret</div>')
  lignes.push('<div class="gap"></div>', `<div class="far" *scratch(image: '${PNG}')>Le secret</div>`, '<div class="gap"></div>')
  lignes.push('<button class="btn" @click={setc}>x</button>', '<button class="btd" @click={setd}>x</button>', '<span class="pret"></span>')
  lignes.push('<style>', ':host', '  display: block', 'div', '  width: 220px', '  height: 40px', '  margin: 4px', '  font: 14px sans-serif', '  color: #000', '  background: #fff', '.gap', '  height: 3000px', 'button', '  width: 14px', '  height: 14px', '  padding: 0', '</style>')
  return lignes.join('\n') + '\n'
}
// le pixel au centre de la toile d'une balise
const PIXEL = (c: string) => `(() => { const k = ${BOITE(c)}.querySelector(':scope > canvas'); if (!k) return 'pas de toile'; const d = k.getContext('2d').getImageData(Math.floor(k.width / 2), Math.floor(k.height / 2), 1, 1).data; return [d[0], d[1], d[2], d[3]].join(',') })()`

type Ctx = { page: any, lit: (js: string) => Promise<any>, erreurs: string[], avis: string[] }

// la page de l'application pour la balise `tag` : les erreurs de la console et de la page sont relevées, TAG est remplacé par la balise du composant dans chaque expression lue dans la page
async function ouvrir(browser: any, script: string, tag: string, pret = '.var'): Promise<Ctx> {
  const page              = await (await browser.newContext({ viewport: { width: 800, height: 1000 } })).newPage()
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
  await page.waitForFunction(`!!window.__racine('${tag}')?.querySelector('${pret}')`, null, { timeout: 20000 })
  const lit = (js: string) => page.evaluate(js.replace(/TAG/g, `'${tag}'`))
  return { page, lit, erreurs, avis }
}

// les balises sont là et le témoin a son décor (un effet peut se poser après un rendu ; sans WebGL, `*fluid` n'en pose pas : le cas se saute)
async function pretes(ctx: Ctx, tag: string) {
  await ctx.page.waitForFunction(`(() => { const t = window.__racine('${tag}').querySelector('.tt'); return t && t.querySelector(':scope > [mjs-fx-layer],:scope > [mjs-fx-offline-band]') })()`, null, { timeout: 8000 }).catch(() => {})
  await ctx.page.waitForTimeout(400)
}

const noms = (e: Etat) => JSON.stringify(e.calques.map(c => c.n + '/' + c.t))

// ce que la balise a de plus ou de moins que le témoin (le même contenu, l'effet posé d'emblée) : '' quand c'est le même état visible
function manque(a: Etat, t: Etat, propre: string, voit?: (e: Etat) => string): string {
  const m: string[] = []
  if (t.calques.length === 0) m.push('le témoin n\'a aucun décor')
  if (noms(a) !== noms(t)) m.push(`calques ${noms(a)}, attendu ${noms(t)}`)
  else {
    t.calques.forEach((c, i) => {
      const x = a.calques[i]
      if (x.d !== c.d || x.v !== c.v) m.push(`${c.n} : affichage ${x.d}/${x.v}, attendu ${c.d}/${c.v}`)
      if (Math.abs(x.w - c.w) > 3 || Math.abs(x.h - c.h) > 3) m.push(`${c.n} : boîte ${x.w}x${x.h}, attendu ${c.w}x${c.h}`)
      if ((x.anims > 0) !== (c.anims > 0)) m.push(`${c.n} : ${x.anims} animation(s) qui courent, ${c.anims} chez le témoin`)
      if ((x.enfants > 0) !== (c.enfants > 0)) m.push(`${c.n} : ${x.enfants} enfant(s), ${c.enfants} chez le témoin`)
      if (c.px > 0.01 && !(x.px > 0.01)) m.push(`${c.n} : toile vide (${x.px}), ${c.px} chez le témoin`)
      if (Math.abs(x.op - c.op) > 0.1) m.push(`${c.n} : opacité ${x.op}, ${c.op} chez le témoin`)
    })
  }
  if (a.marques !== t.marques) m.push(`marques « ${a.marques} », attendu « ${t.marques} »`)
  if (a.couleur !== t.couleur) m.push(`couleur du texte ${a.couleur}, ${t.couleur} chez le témoin`)
  if (a.centre !== t.centre) m.push(`au centre : ${a.centre}, ${t.centre} chez le témoin`)
  if (a.propre !== propre) m.push(`texte propre « ${a.propre} », attendu « ${propre} »`)
  const v = voit ? voit(a) : ''
  if (v) m.push(v)
  return m.join(' ; ')
}

// attend (jusqu'à `delai`) que la balise `c` soit comme son témoin `ref` ; rend le dernier état lu et ce qui manque
async function attend(ctx: Ctx, c: string, ref: string, propre: string, e: Effet, delai = Number(process.env.MJS_ATTENTE_MS ?? 12000)): Promise<{ etat: Etat, manque: string }> {
  const fin = Date.now() + delai
  let etat: Etat
  let dit: string
  do {
    etat = await ctx.lit(lire(c))
    dit  = manque(etat, await ctx.lit(lire(ref)), propre, e.voit)
    if (dit) await ctx.page.waitForTimeout(100)
  } while (dit && Date.now() < fin)
  return { etat, manque: dit }
}

// attend (jusqu'à `delai`) qu'une expression lue dans la page soit vraie ; rend sa dernière valeur
async function jusqua(ctx: Ctx, js: string, delai = Number(process.env.MJS_ATTENTE_MS ?? 12000)): Promise<any> {
  const fin = Date.now() + delai
  let v: any
  do {
    v = await ctx.lit(js)
    if (!v) await ctx.page.waitForTimeout(100)
  } while (!v && Date.now() < fin)
  return v
}

const dit = (qui: string, r: { etat: Etat, manque: string }) => `${qui} : ${r.manque} — ${JSON.stringify(r.etat)}`

describe('un effet à décor survit à la réécriture du contenu de sa balise (navigateurs réels)', function () {
  this.timeout(1800000)
  // chaque application est construite à la première page qui la demande
  const scripts: Record<number, string> = {}
  const construire = async (i: number): Promise<string> => {
    if (scripts[i]) return scripts[i]
    const appli  = APPLIS[i]
    const root   = mjsTmp('decor-reecrit-' + i)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const e of EFFETS) writeFileSync(join(srcDir, 'z-' + e.nom + '.mjs'), source(e))
    writeFileSync(join(srcDir, 'z-outil.mjs'), sourceOutil())
    // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
    const manifeste    = join(outDir, 'bundle.js')
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle' }
    if (appli.env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((x: any) => x.message), [], appli.nom)
    return scripts[i] = stripEsm(readFileSync(manifeste, 'utf-8'))
  }

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox']) as Array<'chromium' | 'firefox' | 'webkit'>) {
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
        describe(appli.nom, function () {
          for (const e of EFFETS) {
            describe('*' + e.nom, function () {
              const tag = 'mjs-z-' + e.nom
              let ctx: Ctx
              let sansDecor = false

              before(async function () {
                ctx = await ouvrir(browser, await construire(i), tag)
                if (e.coupure) await ctx.lit(COUPURE(true))
                await pretes(ctx, tag)
                sansDecor = (await ctx.lit(lire('tt'))).calques.length === 0
              })

              after(async () => { await ctx?.page.context().close() })

              // sans WebGL (navigateur d'essai sans carte graphique), `*fluid` ne pose rien : rien à perdre
              const jouable = (t: Mocha.Context) => { if (e.nom === 'fluid' && sansDecor) t.skip() }

              it('textContent : le décor revient, un seul exemplaire, l\'effet joue comme posé d\'emblée', async function () {
                jouable(this)
                await ctx.lit(ecrireTexte('tc', neuf(e)))
                const r = await attend(ctx, 'tc', 'tt', neuf(e), e)
                assert.equal(r.manque, '', dit('textContent', r))
              })

              it('innerHTML avec une balise dedans : le décor revient, la balise reste dans la balise', async function () {
                jouable(this)
                await ctx.lit(ecrireHtml('ih', balises(e)))
                const r = await attend(ctx, 'ih', 'ti', aplat(e), e)
                assert.equal(r.manque, '', dit('innerHTML', r))
                assert.equal(await ctx.lit(`${BOITE('ih')}.querySelectorAll(':scope > b').length`), 1, 'la balise écrite par le script n\'est plus dans la balise')
              })

              it('une balise qui ne contenait que le décor, vidée puis écrite dans une autre tâche : le décor revient', async function () {
                jouable(this)
                await ctx.lit(`${BOITE('vide')}.innerHTML = ''`)
                await ctx.page.waitForTimeout(150)
                await ctx.lit(`${BOITE('vide')}.append(${JSON.stringify(neuf(e))})`)
                const r = await attend(ctx, 'vide', 'tt', neuf(e), e)
                assert.equal(r.manque, '', dit('vider puis écrire', r))
              })

              if (!appli.complet) return

              it('dix réécritures dans la même tâche : une seule nouvelle pose du décor', async function () {
                jouable(this)
                await ctx.lit(SEMER('dix'))
                await ctx.lit(`(() => { const el = ${BOITE('dix')}; for (let i = 0; i < 9; i++) el.textContent = 'essai ' + i; el.textContent = ${JSON.stringify(neuf(e))} })()`)
                const r     = await attend(ctx, 'dix', 'tt', neuf(e), e)
                const pose  = (await ctx.lit(lire('tt'))).calques.length
                const ajout = await ctx.lit(`window.__aj['dix']`)
                assert.equal(r.manque, '', dit('dix réécritures', r))
                assert.equal(ajout, pose, `${ajout} calque(s) posé(s) pour ${pose} attendu(s) : une seule nouvelle pose`)
              })

              it('innerHTML += : la copie figée du décor ne reste pas à côté du vrai', async function () {
                jouable(this)
                await ctx.lit(ajouterHtml('plus', '<i>x</i>'))
                const r = await attend(ctx, 'plus', 'tt', depart(e) + 'x', e)
                // le témoin porte le texte final : seule la liste des calques et leur état se comparent
                assert.equal(r.manque.replace(/ ; texte propre[^;]*/, ''), '', dit('innerHTML +=', r))
                assert.equal(noms(r.etat), noms(await ctx.lit(lire('tt'))), 'un seul exemplaire de chaque calque')
                // le décor est celui de l'effet, pas une copie figée : le retrait de l'effet n'en laisse rien
                await ctx.lit(retirer('plus', e.nom))
                assert.equal((await ctx.lit(reste('plus'))).calques, 0, 'une copie figée du décor reste après le retrait de l\'effet')
              })

              it('{$x} : le texte lié ne retire pas le décor, il n\'est pas reposé', async function () {
                await ctx.lit(SEMER('var'))
                await ctx.lit(`${BOITE('btn')}.click()`)
                await ctx.page.waitForTimeout(500)
                const garde = await ctx.lit(`window.__ref['var'].every(n => n.parentNode === ${BOITE('var')})`)
                const ajout = await ctx.lit(`window.__aj['var']`)
                const propre = (await ctx.lit(lire('var'))).propre
                assert.equal(garde, true, 'les nœuds de décor d\'avant sont partis')
                assert.equal(ajout, 0, `${ajout} calque(s) posé(s) de nouveau`)
                assert.equal(propre, neuf(e))
              })

              it('un script qui réécrit à chaque changement des enfants : la boucle s\'arrête, la page répond', async function () {
                jouable(this)
                await ctx.lit(`(() => { const el = ${BOITE('boucle')}; window.__boucle = 0; new window.__NatifMO((l) => { if (window.__boucle < 300 && l.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && n.hasAttribute('mjs-fx-layer')))) el.textContent = 'tour ' + (++window.__boucle) }).observe(el, { childList: true }); el.textContent = 'départ' })()`)
                await ctx.page.waitForTimeout(800)
                const n = await ctx.lit('window.__boucle')
                assert.ok(n >= 1 && n <= 60, `${n} réécritures : la boucle ne s'est pas arrêtée (le script réécrit chaque fois que l'effet remet un calque)`)
                assert.equal(await ctx.lit('1 + 1'), 2)
              })

              it('la garde coupe une boucle mais jamais pour toujours : une écriture faite plus tard, dans une autre tâche, remet le décor', async function () {
                jouable(this)
                await ctx.lit(`(() => { const el = ${BOITE('coupe')}; window.__coupe = 0; window.__moCoupe = new window.__NatifMO((l) => { if (window.__coupe < 300 && l.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && n.hasAttribute('mjs-fx-layer')))) el.textContent = 'tour ' + (++window.__coupe) }); window.__moCoupe.observe(el, { childList: true }); el.textContent = 'départ' })()`)
                await ctx.page.waitForTimeout(800)
                const n = await ctx.lit('window.__coupe')
                assert.ok(n >= 1 && n <= 60, `${n} réécritures : la boucle ne s'est pas arrêtée`)
                await ctx.lit('window.__moCoupe.disconnect()')
                await ctx.lit(ecrireTexte('coupe', neuf(e)))
                const r = await attend(ctx, 'coupe', 'tt', neuf(e), e)
                assert.equal(r.manque, '', dit('écriture après la coupure', r))
              })

              it('quarante écritures dans quarante tâches, les minuteries de 0 ms bridées : le décor est gardé', async function () {
                jouable(this)
                await ctx.lit(BRIDER)
                await ctx.lit(espacees('lent', 40, neuf(e)))
                await ctx.lit('window.__relacher()')
                const r = await attend(ctx, 'lent', 'tt', neuf(e), e)
                assert.equal(r.manque, '', dit('écritures espacées', r))
              })

              if (RAFALE.includes(e.nom)) {
                it('quatre-vingts écritures dans quatre-vingts tâches : le décor est gardé, un seul exemplaire', async function () {
                  await ctx.lit(SEMER('rafale'))
                  await ctx.lit(rafale('rafale', 80, neuf(e)))
                  const r = await attend(ctx, 'rafale', 'tt', neuf(e), e)
                  assert.equal(r.manque, '', dit('rafale', r))
                  assert.equal(noms(r.etat), noms(await ctx.lit(lire('tt'))), 'un seul exemplaire de chaque calque')
                })
              }

              it('une réécriture puis le retrait de l\'effet : aucun reste (nœuds, marques, style, observateur)', async function () {
                jouable(this)
                await ctx.lit(ecrireTexte('retrait', neuf(e)))
                const r = await attend(ctx, 'retrait', 'tt', neuf(e), e)
                assert.equal(r.manque, '', dit('avant le retrait', r))
                await ctx.lit(retirer('retrait', e.nom))
                const reste_ = await ctx.lit(reste('retrait'))
                assert.deepEqual(reste_, { marques: [], calques: 0, style: '', suivis: 0, texte: neuf(e) })
              })

              it('la réécriture et le retrait dans la même tâche : l\'effet ne revient pas', async function () {
                jouable(this)
                await ctx.lit(`(() => { const a = ${BOITE('repos')}; a.textContent = ${JSON.stringify(neuf(e))}; const o = Object.getOwnPropertyNames(a).map(k => a[k]).find(x => x && typeof x.${e.nom} === 'function'); o.${e.nom}() })()`)
                await ctx.page.waitForTimeout(700)
                assert.deepEqual(await ctx.lit(reste('repos')), { marques: [], calques: 0, style: '', suivis: 0, texte: neuf(e) })
              })

              if (e.repos) {
                it('au repos après une réécriture : aucun rappel d\'observateur, aucune minuterie, aucune image demandée', async function () {
                  await ctx.lit(ecrireTexte('tc', neuf(e)))
                  const r = await attend(ctx, 'tc', 'tt', neuf(e), e)
                  assert.equal(r.manque, '', dit('avant le repos', r))
                  if (e.lourd) {
                    // la salve de la garde de cadence court depuis la pose jusqu'à son verdict (une quinzaine de secondes sans carte graphique) : 150 images qui comptent (moins de 250 ms chacune) et 150 pauses au plus, 120 s couvrent une page à deux images par seconde
                    assert.ok((await ctx.lit('window.__jauge.demandees')) > 0, 'la garde de cadence n\'a demandé aucune image : sa fonction d\'image n\'est plus reconnue')
                    const finie = await jusqua(ctx, 'window.__jauge.demandees === window.__jauge.jouees', 120000)
                    assert.ok(finie, `la salve de la garde de cadence ne finit pas : ${JSON.stringify(await ctx.lit(`({ ...window.__jauge, econome: document.documentElement.hasAttribute('mjs-fx-lite') })`))}`)
                  }
                  await ctx.page.waitForTimeout(1500)
                  const avant = await ctx.lit(`({ rondes: window.__rondes.get(${BOITE('tc')}) || 0, tm: { ...window.__tm } })`)
                  await ctx.page.waitForTimeout(1500)
                  const apres = await ctx.lit(`({ rondes: window.__rondes.get(${BOITE('tc')}) || 0, tm: { ...window.__tm } })`)
                  assert.deepEqual(apres, avant, 'quelque chose a tourné pendant 1,5 s de repos')
                })
              }

              if (e.soi) {
                it('un effet qui retire lui-même un de ses calques : il n\'est pas reposé', async function () {
                  await ctx.lit(SEMER('dix'))
                  const avant = (await ctx.lit(lire('dix'))).calques.length
                  // un enfant de la balise (une balise du script) ; son contenu s'écrit dans la même tâche que le retrait : l'écriture ne touche pas aux enfants de la balise, elle ne compte pas
                  await ctx.lit(`${BOITE('dix')}.append(document.createElement('p'))`)
                  await ctx.page.waitForTimeout(200)
                  await ctx.lit(`(() => { const a = ${BOITE('dix')}; const o = Object.getOwnPropertyNames(a).map(k => a[k]).find(x => x && typeof x.${e.nom} === 'function'); a.querySelector('p').textContent = 'écrit dans l\\'enfant'; ${e.soi} })()`)
                  await ctx.page.waitForTimeout(500)
                  assert.equal((await ctx.lit(lire('dix'))).calques.length, avant - 1, 'le calque que l\'effet a retiré n\'est pas parti')
                  assert.equal(await ctx.lit(`window.__aj['dix']`), 0, 'l\'effet a été reposé')
                  // une écriture qui ne retire rien, faite plus tard : il lui reste un calque, rien n'est dû
                  await ctx.lit(`${BOITE('dix')}.append(' et une suite')`)
                  await ctx.page.waitForTimeout(500)
                  assert.equal(await ctx.lit(`window.__aj['dix']`), 0, 'l\'effet a été reposé par une écriture qui ne retire rien, alors qu\'il lui restait un calque')
                })
              }

              if (e.coupure) {
                it('le réseau revient : l\'effet retire lui-même son décor, sans être reposé', async function () {
                  await ctx.lit(SEMER('var'))
                  assert.ok((await ctx.lit(lire('var'))).calques.length > 0, 'pas de décor à retirer')
                  await ctx.lit(COUPURE(false))
                  await ctx.page.waitForTimeout(2500)
                  const etat  = await ctx.lit(lire('var'))
                  const ajout = await ctx.lit(`window.__aj['var']`)
                  assert.equal(etat.calques.length, 0, 'le décor est resté après le retour du réseau')
                  assert.equal(ajout, 0, `${ajout} calque(s) posé(s) de nouveau : l'effet a été reposé`)
                })
              }

              it('aucune erreur de page', async () => {
                assert.deepEqual(ctx.erreurs, [])
              })
            })
          }

          describe('la reprise elle-même (réglage lié, calques déplacés, sonde, pose différée)', function () {
            const tag = 'mjs-z-outil'
            let ctx: Ctx

            before(async () => {
              ctx = await ouvrir(browser, await construire(i), tag, '.pret')
              await ctx.page.waitForTimeout(500)
            })

            after(async () => { await ctx?.page.context().close() })

            it('un réglage qui fait repartir l\'effet (la couleur), changé avant la réécriture : l\'effet est reposé avec la valeur courante', async function () {
              const avant = await ctx.lit(PIXEL('sc'))
              await ctx.lit(`${BOITE('btn')}.click()`)
              const temoin = await jusqua(ctx, `(() => { const p = ${PIXEL('sw')}; return p !== ${JSON.stringify(avant)} && p })()`)
              assert.ok(temoin, 'le témoin ne prend pas la nouvelle couleur')
              assert.equal(await ctx.lit(PIXEL('sc')), temoin, 'avant la réécriture, la toile n\'a pas pris la nouvelle couleur')
              await ctx.lit(ecrireTexte('sc', 'Nouveau secret'))
              const suite = await jusqua(ctx, `${PIXEL('sc')} === ${JSON.stringify(temoin)}`)
              assert.ok(suite, `après la réécriture la toile est ${await ctx.lit(PIXEL('sc'))} (couleur d'origine ${avant}, couleur courante ${temoin})`)
            })

            it('un réglage suivi sur place (variable CSS) changé avant la réécriture : l\'effet est reposé avec la valeur courante', async function () {
              const lis = (c: string) => `${BOITE(c)}.style.getPropertyValue('--mjs-scratch-duration')`
              const avant = await ctx.lit(lis('sd'))
              await ctx.lit(`${BOITE('btd')}.click()`)
              const courante = await jusqua(ctx, `(() => { const v = ${lis('sv')}; return v !== ${JSON.stringify(avant)} && v })()`)
              assert.ok(courante, 'le témoin ne prend pas la nouvelle durée')
              assert.equal(await ctx.lit(lis('sd')), courante, 'avant la réécriture, la balise n\'a pas pris la nouvelle durée')
              await ctx.lit(SEMER('sd'))
              await ctx.lit(ecrireTexte('sd', 'Nouveau secret'))
              const repose = await jusqua(ctx, `(() => { const k = [...${BOITE('sd')}.children].filter(n => n.hasAttribute('mjs-fx-layer')); return k.length === 1 && !window.__ref['sd'].includes(k[0]) })()`)
              assert.ok(repose, 'le décor n\'est pas revenu après la réécriture')
              assert.equal(await ctx.lit(lis('sd')), courante, `après la réécriture la durée est « ${await ctx.lit(lis('sd'))} » (celle d'origine : « ${avant} », la courante : « ${courante} »)`)
            })

            it('des calques déplacés avec le reste du contenu (replaceChildren) : le décor n\'est pas reposé', async function () {
              await ctx.lit(SEMER('depl'))
              await ctx.lit(`(() => { const el = ${BOITE('depl')}; el.replaceChildren(...el.childNodes, document.createTextNode(' et une suite')) })()`)
              await ctx.page.waitForTimeout(500)
              const etat = await ctx.lit(`({ garde: window.__ref['depl'].every(n => n.parentNode === ${BOITE('depl')}), calques: ${BOITE('depl')}.querySelectorAll(':scope > [mjs-fx-layer]').length, n: window.__ref['depl'].length, texte: ${BOITE('depl')}.textContent })`)
              assert.deepEqual(etat, { garde: true, calques: etat.n, n: etat.n, texte: 'Le secret et une suite' }, 'le décor a été reposé alors que ses calques étaient encore là')
              assert.ok(etat.n > 0)
            })

            it('un calque posé puis retiré dans le même lot (une sonde de mesure), avec du texte écrit : le décor n\'est pas reposé', async function () {
              await ctx.lit(SEMER('sonde'))
              await ctx.lit(`(() => { const el = ${BOITE('sonde')}; const p = document.createElement('i'); p.setAttribute('mjs-fx-layer', 'scratch-probe'); el.append(p); p.remove(); el.append(' et une suite') })()`)
              await ctx.page.waitForTimeout(500)
              const etat = await ctx.lit(`({ garde: window.__ref['sonde'].every(n => n.parentNode === ${BOITE('sonde')}), calques: ${BOITE('sonde')}.querySelectorAll(':scope > [mjs-fx-layer]').length, n: window.__ref['sonde'].length })`)
              assert.deepEqual(etat, { garde: true, calques: etat.n, n: etat.n }, 'le décor a été reposé pour une sonde qui n\'était déjà plus là')
              assert.ok(etat.n > 0)
            })

            it('une pose différée (image loin de l\'écran) : le décor est reposé après une réécriture comme une pose directe', async function () {
              assert.equal((await ctx.lit(lire('far'))).calques.length, 0, 'la pose n\'était pas différée')
              await ctx.lit(`${BOITE('far')}.scrollIntoView()`)
              assert.ok(await jusqua(ctx, `!!${BOITE('far')}.querySelector(':scope > [mjs-fx-layer]')`), 'la pose différée ne vient pas')
              await ctx.lit(SEMER('far'))
              await ctx.lit(ecrireTexte('far', 'Nouveau secret'))
              const neuf_ = await jusqua(ctx, `(() => { const k = [...${BOITE('far')}.children].filter(n => n.hasAttribute('mjs-fx-layer')); return k.length === 1 && !window.__ref['far'].includes(k[0]) })()`)
              assert.ok(neuf_, 'le décor n\'est pas revenu après la réécriture')
              assert.equal((await ctx.lit(lire('far'))).centre, 'scratch')
            })

            it('aucune erreur de page', async () => {
              assert.deepEqual(ctx.erreurs, [])
            })
          })
        })
      })
    })
  }
})
