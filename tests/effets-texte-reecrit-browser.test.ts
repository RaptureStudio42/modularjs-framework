// Un effet de texte reste posé quand un script réécrit le texte de sa balise (Chromium et Firefox réels).
// Après `el.textContent = …` ou `el.innerHTML = …`, la balise finit dans le même état qu'avec un texte changé par `{$x}` : un seul calque de texte, le dernier enfant de la balise, le même contenu, le texte visible (compté en pixels), l'effet qui joue sur le texte neuf avec ses réglages.
// Les douze effets qui passent par le calque de texte du moteur (*marquee *rainbow *count *scramble *bounce *wave *weight *stagger *delta *cycle (relais et cadre) *circular) passent ce scénario de base, dans une application de production.
// Quatre d'entre eux passent en plus tous les cas suivants : *marquee (un calque à lui, une piste CSS), *rainbow (le calque de lettres partagé, une minuterie), *count (un calque à lui, un nombre qui s'anime), *scramble (le calque de lettres, un brouillage qui se joue).
// Pour chacun, une balise par cas, que le script réécrit :
//   1. `textContent` ;  2. `innerHTML` avec des balises dedans (le texte de l'effet est celui de la balise, sans les balises) ;  3. plusieurs réécritures de suite (dans la même tâche, puis dans des tâches séparées) ;
//   4. `innerHTML +=` (la balise relit son calque et en reçoit une copie figée, qui ne doit pas rester à côté du vrai) ;  5. une réécriture pendant que l'effet joue ;
//   6. une réécriture puis le retrait de l'effet (aucun reste : marques, calque, style, observateur), la réécriture et le retrait dans la même tâche aussi ;  7. le témoin : le même texte changé par `{$x}` finit dans le même état.
// Et une balise qui porte deux effets de lettres (le calque partagé) : il revient une fois, les deux effets jouent, et il reste tant que l'un des deux est posé.
// La remise du calque ne retire que des calques de texte : le calque d'un autre effet (marqué `mjs-fx-layer`, pas du texte) reste dans la balise.
// Un `normalize()` de la page juste après une réécriture (ou un changement de `{$x}`) laisse leur texte à `*delta` (le nombre) et à `*cycle(style: type)` (le texte tapé) : un effet écrit dans un nœud de texte qui est dans sa balise, jamais dans un nœud que `normalize()` a retiré.
// Une application de production, une de développement, et une de production qui pose aussi un défilé de balises (`*marquee(drag: true)`) : le calque de `*marquee` y a un second observateur, qui ne doit pas le doubler.
// Au repos, rien ne tourne : une fois le texte joué, la balise passe 1,5 s sans rappel d'observateur, puis 6 s sans un seul rappel (un battement lent se voit).

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

// ce que la sonde lit sur une balise : ses calques de texte, leur contenu, les lettres et leurs couleurs, la piste du défilé, les animations qui courent, la place du calque
type Etat = { calques: number, calque: string | null, lettres: string, couleurs: string[], piste: boolean, anims: number, propre: string, invisible: boolean, enfants: number, largeur: string, dernier: boolean }

const sb = (t: string) => t.replace(/\s+/g, '')

type Effet = {
  nom: string
  pose: string
  poseLongue: string
  depart: string
  neuf: string
  balises: string
  baliseTexte: string
  plus: string
  // '' quand l'effet joue sur ce texte (celui de la balise, sans les balises dedans), sinon ce qui manque
  vivant: (s: Etat, texte: string) => string
}

// un seul calque de texte, vu (pas retiré de la balise), et le dernier enfant de la balise comme à la pose
const commun = (s: Etat) => s.calques !== 1 ? `${s.calques} calques de texte (un seul attendu)` : s.invisible ? 'le texte est invisible' : !s.dernier ? 'le calque n\'est pas le dernier enfant de la balise' : ''
const lettresDe = (s: Etat, t: string) => s.lettres !== sb(t) ? `les lettres ne sont pas celles de « ${t} » : « ${s.lettres} »` : ''
const deuxFois = (s: Etat, t: string) => sb(s.calque ?? '') !== sb(t + t) ? `le calque ne dit pas « ${t} » deux fois : « ${s.calque} »` : ''
const EFFETS: Effet[] = [
  {
    nom: 'marquee', pose: '*marquee(speed: 4s)', poseLongue: '*marquee(speed: 4s)', depart: 'Un texte', neuf: 'Un autre texte', balises: 'Un <b>autre</b> texte', baliseTexte: 'Un autre texte', plus: ' encore',
    vivant: (s, t) => commun(s) || (!s.piste ? 'la piste du défilé manque' : sb(s.calque ?? '') !== sb(t + t) ? `le défilé ne montre pas « ${t} » deux fois : « ${s.calque} »` : s.anims < 1 ? 'aucune animation ne court' : '')
  },
  {
    nom: 'rainbow', pose: '*rainbow(speed: 600ms)', poseLongue: '*rainbow(speed: 600ms)', depart: 'Un texte', neuf: 'Un autre texte', balises: 'Un <b>autre</b> texte', baliseTexte: 'Un autre texte', plus: ' encore',
    vivant: (s, t) => commun(s) || (s.lettres !== sb(t) ? `les lettres ne sont pas celles de « ${t} » : « ${s.lettres} »` : s.couleurs.length === 0 || s.couleurs.some(c => !c) ? 'des lettres sans couleur' : '')
  },
  {
    nom: 'count', pose: '*count(duration: 500ms, on: load)', poseLongue: '*count(duration: 2000ms, on: click)', depart: '1234', neuf: '56789012', balises: '<b>5678</b>9012', baliseTexte: '56789012', plus: '5',
    vivant: (s, t) => commun(s) || (sb(s.calque ?? '') !== t ? `le compteur n'est pas arrivé à ${t} : « ${s.calque} »` : '')
  },
  {
    nom: 'scramble', pose: '*scramble(speed: 20, on: load)', poseLongue: '*scramble(speed: 150, on: click)', depart: 'Un texte', neuf: 'Un autre texte', balises: 'Un <b>autre</b> texte', baliseTexte: 'Un autre texte', plus: ' encore',
    vivant: (s, t) => commun(s) || (s.lettres !== sb(t) ? `les lettres ne sont pas celles de « ${t} » : « ${s.lettres} »` : '')
  }
]

// les huit autres effets du calque de texte : le scénario de base seulement
const texte = (nom: string, pose: string, vivant: Effet['vivant']): Effet => ({ nom, pose, poseLongue: pose, depart: 'Un texte', neuf: 'Un autre texte', balises: 'Un <b>autre</b> texte', baliseTexte: 'Un autre texte', plus: ' encore', vivant })
const AUTRES: Effet[] = [
  texte('bounce', '*bounce(speed: 500ms)', (s, t) => commun(s) || lettresDe(s, t) || (s.anims < 1 ? 'aucune animation ne court' : '')),
  texte('wave', '*wave', (s, t) => commun(s) || deuxFois(s, t) || (s.anims < 1 ? 'aucune animation ne court' : '')),
  texte('weight', '*weight', (s, t) => commun(s) || lettresDe(s, t)),
  texte('stagger', '*stagger(on: load)', (s, t) => commun(s) || lettresDe(s, t)),
  {
    nom: 'delta', pose: '*delta', poseLongue: '*delta', depart: '1234', neuf: '5678', balises: '<b>56</b>78', baliseTexte: '5678', plus: '9',
    vivant: (s, t) => commun(s) || (sb((s.calque ?? '').replace(/[▲▼]/g, '')) !== t ? `le nombre n'est pas arrivé à ${t} : « ${s.calque} »` : '')
  },
  texte('frame', '*cycle.frame', (s, t) => commun(s) || deuxFois(s, t)),
  texte('cycle', '*cycle', (s, t) => commun(s) || (sb(s.calque ?? '') !== sb(t) ? `le mot affiché n'est pas « ${t} » : « ${s.calque} »` : '')),
  texte('circular', '*circular', (s, t) => commun(s) || (sb(s.lettres) !== sb(t) ? `les caractères ne sont pas ceux de « ${t} » : « ${s.lettres} »` : ''))
]
const DOUZE: Effet[] = [...EFFETS, ...AUTRES]

// ce qui doit être pareil avec une réécriture par un script et avec un texte changé par {$x}
const MEME = ['calques', 'calque', 'lettres', 'piste', 'invisible', 'largeur', 'dernier'] as const
// un texte vu : au moins ce nombre de pixels sombres dans la boîte de la balise (une balise sans calque ni texte en compte zéro)
const MIN_PIXELS = 30
// le repos : une fenêtre de calme, puis le repos strict
const FENETRE = 1500
const REPOS   = 6000

const CAS = ['tc', 'ih', 'suite', 'plus', 'joue', 'retrait', 'meme', 'var']
type Appli = { nom: string, env: 'prod' | 'dev', effets: Effet[], duo: boolean, piste: boolean }
const APPLIS: Appli[] = [
  { nom: 'production', env: 'prod', effets: EFFETS, duo: true, piste: false },
  { nom: 'développement', env: 'dev', effets: EFFETS, duo: true, piste: false },
  { nom: 'production, avec un défilé de balises dans l\'application', env: 'prod', effets: EFFETS.filter(e => e.nom === 'marquee'), duo: false, piste: true }
]

function source(appli: Appli): string {
  const lignes = ['<script>']
  for (const e of appli.effets) lignes.push(`$v_${e.nom} = '${e.depart}'`)
  if (appli.duo) lignes.push("$h = 'Un <b>texte</b>'")
  lignes.push('</script>')
  for (const e of appli.effets) {
    for (const c of CAS) {
      const pose = c === 'joue' ? e.poseLongue : e.pose
      lignes.push(c === 'var' ? `<p class="${e.nom}-var" ${pose}>{$v_${e.nom}}</p>` : `<p class="${e.nom}-${c}" ${pose}>${e.depart}</p>`)
    }
  }
  if (appli.duo) lignes.push('<p class="duo" *rainbow(speed: 600ms) *bounce(speed: 500ms)>Un texte</p>')
  if (appli.duo) lignes.push('<p class="duo2" *rainbow(speed: 600ms) *count(duration: 300ms, on: load)>1234</p>')
  if (appli.duo) lignes.push('<p class="decor" *rainbow(speed: 600ms)>Un texte</p>')
  if (appli.duo) lignes.push('<p class="html" *rainbow(speed: 600ms) @html=!{$h}></p>', "<button class=\"btn-html\" @click={$h = 'Un autre <i>texte</i>'}>x</button>")
  if (appli.piste) lignes.push('<div class="piste" *marquee(drag: true, speed: 4s)><div>A</div><div>B</div></div>')
  for (const e of appli.effets) lignes.push(`<button class="btn-${e.nom}" @click={$v_${e.nom} = '${e.neuf}'}>x</button>`)
  lignes.push('<style>', ':host', '  display: block', 'p', '  margin: 0', '  width: 220px', '  height: 20px', '  overflow: hidden', '  font: 14px sans-serif', '.piste', '  width: 220px', 'button', '  width: 14px', '  height: 14px', '  padding: 0', '</style>')
  return lignes.join('\n') + '\n'
}

// les douze effets : une rangée par effet (le témoin {$x}, une balise réécrite par textContent, une par innerHTML, un bouton), plus deux balises de *delta et deux de *cycle(style: type) pour normalize()
function sourceDouze(): string {
  const lignes = ['<script>']
  for (const e of DOUZE) lignes.push(`$v_${e.nom} = '${e.depart}'`)
  lignes.push('$n = 1234', "$t = 'Bonjour'", '</script>')
  for (const e of DOUZE) {
    lignes.push('<div class="ligne">')
    lignes.push(`  <p class="${e.nom}-var" ${e.pose}>{$v_${e.nom}}</p>`)
    lignes.push(`  <p class="${e.nom}-tc" ${e.pose}>${e.depart}</p>`)
    lignes.push(`  <p class="${e.nom}-ih" ${e.pose}>${e.depart}</p>`)
    lignes.push(`  <button class="btn-${e.nom}" @click={$v_${e.nom} = '${e.neuf}'}>x</button>`)
    lignes.push('</div>')
  }
  lignes.push('<div class="ligne">', '  <p class="delta-nvar" *delta>{$n}</p>', '  <p class="delta-ntc" *delta>1234</p>', '  <button class="btn-delta-n" @click={$n = 5678}>x</button>', '</div>')
  // la machine à écrire, avec une longue pause entre deux mots : son texte tapé (un nœud de texte) est vide presque tout le temps
  lignes.push('<div class="ligne">', '  <p class="frappe-nvar" *cycle(style: type, speed: 400ms, delay: 3000ms)>{$t}</p>', '  <p class="frappe-ntc" *cycle(style: type, speed: 400ms, delay: 3000ms)>Bonjour</p>', "  <button class=\"btn-frappe-n\" @click={$t = 'Salut'}>x</button>", '</div>')
  lignes.push('<style>', ':host', '  display: block', '.ligne', '  display: flex', '  gap: 10px', '  align-items: center', '  margin: 2px 0', 'p', '  margin: 0', '  width: 220px', '  font: 600 18px sans-serif', 'button', '  width: 14px', '  height: 14px', '  padding: 0', '</style>')
  return lignes.join('\n') + '\n'
}

// la page note les observateurs de changements en vie (ceux qui suivent un nœud) et compte, par balise de texte, les rappels qui la touchent
const SUIVI = `(() => {
  window.__suivis = []
  window.__rondes = new Map()
  const observe    = MutationObserver.prototype.observe
  const disconnect = MutationObserver.prototype.disconnect
  MutationObserver.prototype.observe = function(n, o) { window.__suivis.push([this, n]); return observe.call(this, n, o) }
  MutationObserver.prototype.disconnect = function() { window.__suivis = window.__suivis.filter(s => s[0] !== this); return disconnect.call(this) }
  const Natif = window.MutationObserver
  window.MutationObserver = class extends Natif {
    constructor(f) {
      super((liste, o) => {
        const touchees = new Set()
        for (const r of liste) { const n = r.target.nodeType === 1 ? r.target : r.target.parentElement; const p = n && n.closest ? n.closest('p') : null; if (p) touchees.add(p) }
        for (const p of touchees) window.__rondes.set(p, (window.__rondes.get(p) || 0) + 1)
        return f.call(o, liste, o)
      })
    }
  }
})()`

const BOITE = (c: string) => `window.__racine(TAG).querySelector('.${c}')`
const LIRE  = `(el) => {
  const calques = [...el.children].filter(c => c.getAttribute('mjs-fx-layer') === 'text')
  const c       = calques[0] || null
  const lettres = c ? [...c.querySelectorAll('[mjs-fx-letter]')] : []
  return {
    calques: calques.length,
    calque: c ? c.textContent : null,
    lettres: lettres.map(l => l.textContent).join(''),
    couleurs: lettres.map(l => l.style.color),
    piste: !!(c && c.querySelector('[mjs-fx-marquee-track]')),
    anims: c ? c.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length : 0,
    propre: [...el.childNodes].filter(n => !(n.nodeType === 1 && n.hasAttribute('mjs-fx-layer'))).map(n => n.textContent).join(''),
    invisible: !c && el.hasAttribute('mjs-fx-over'),
    enfants: el.querySelectorAll(':scope > b').length,
    largeur: el.style.minWidth,
    dernier: !!c && el.lastChild === c
  }
}`
const RESTE = `(el) => ({
  marques: el.getAttributeNames().filter(n => n.startsWith('mjs-fx')),
  calques: el.querySelectorAll('[mjs-fx-layer]').length,
  style: el.getAttribute('style') || '',
  suivis: window.__suivis.filter(s => s[1] === el).length,
  texte: el.textContent
})`
// la page de décodage dessine la capture sur un canvas et compte, par rectangle, les pixels sombres
const DECODER = `async ([b64, rects, ox, oy]) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + b64
  await img.decode()
  const cv = document.createElement('canvas')
  cv.width = img.width
  cv.height = img.height
  const g = cv.getContext('2d')
  g.drawImage(img, 0, 0)
  return rects.map(r => {
    const x = Math.max(0, Math.round(r.x - ox))
    const y = Math.max(0, Math.round(r.y - oy))
    const w = Math.max(1, Math.min(img.width - x, Math.round(r.w)))
    const h = Math.max(1, Math.min(img.height - y, Math.round(r.h)))
    const d = g.getImageData(x, y, w, h).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (Math.max(255 - d[i], 255 - d[i + 1], 255 - d[i + 2]) > 60) n++
    return n
  })
}`
const lire        = (c: string) => `(${LIRE})(${BOITE(c)})`
const reste       = (c: string) => `(${RESTE})(${BOITE(c)})`
const ecrireTexte = (c: string, t: string) => `${BOITE(c)}.textContent = ${JSON.stringify(t)}`
const ecrireHtml  = (c: string, h: string) => `${BOITE(c)}.innerHTML = ${JSON.stringify(h)}`
const ajouterHtml = (c: string, h: string) => `${BOITE(c)}.innerHTML += ${JSON.stringify(h)}`
// trois microtâches de suite : le temps que l'observateur de la balise (ou la mise à jour de {$x}) ait parlé, avant l'image suivante
const MICROTACHES = 'await Promise.resolve(); await Promise.resolve(); await Promise.resolve()'
// le registre des effets de la balise (son nom de propriété est réduit en production) rend le retrait de l'effet
const retirer = (c: string, nom: string) => `(() => { const a = ${BOITE(c)}; const o = Object.getOwnPropertyNames(a).map(k => a[k]).find(x => x && typeof x.${nom} === 'function'); o.${nom}() })()`
// la machine à écrire en pause (son calque est vide) : le changement de texte, puis un normalize() dès que l'effet a refait son mot ; ce que le calque montre est noté à chaque tâche qui le change (window.__tapes)
const taper = (c: string, changer: string) => `(async () => {
  const p      = ${BOITE(c)}
  const calque = () => [...p.children].find(x => x.getAttribute('mjs-fx-layer') === 'text')
  const mot    = () => { const l = calque(); return l ? l.querySelector('[mjs-fx-cycle-word]') : null }
  if (!calque() || calque().textContent !== '') return 'pas en pause'
  const vus = (window.__tapes = window.__tapes || {})[${JSON.stringify(c)}] = new Set()
  new MutationObserver(() => { const l = calque(); vus.add(l ? l.textContent : null) }).observe(p, { childList: true, characterData: true, subtree: true })
  const avant = mot()
  ${changer}
  for (let n = 0; n < 500 && (!mot() || mot() === avant); n++) await new Promise(r => setTimeout(r, 4))
  if (!mot() || mot() === avant) return 'le mot n\\'a pas été refait'
  p.normalize()
  return 'fait'
})()`

type Ctx = { page: any, lit: (js: string) => Promise<any>, erreurs: string[], avis: string[], decodeur: any }

// la page de l'application `tag` : les erreurs et les avertissements de la console sont relevés, TAG est remplacé par la balise du composant dans chaque expression lue dans la page
async function ouvrir(browser: any, script: string, tag: string, hauteur = 1000): Promise<Ctx> {
  const page              = await (await browser.newContext({ viewport: { width: 800, height: hauteur } })).newPage()
  const decodeur          = await (await browser.newContext()).newPage()
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
  await page.waitForFunction(`!!window.__racine('${tag}')?.querySelector('p')`, null, { timeout: 20000 })
  const lit = (js: string) => page.evaluate(js.replace(/TAG/g, `'${tag}'`))
  return { page, lit, erreurs, avis, decodeur }
}

// les balises ont leur calque : l'effet est posé (les effets partent à l'arrivée de la balise, certains après un rendu)
async function pretes(ctx: Ctx, classes: string[]) {
  await ctx.page.waitForFunction(`(() => { const r = window.__racine('${ctx.page.__tag}'); return ${JSON.stringify(classes)}.every(c => { const p = r.querySelector('.' + c); return p && p.querySelector(':scope > [mjs-fx-layer="text"]') }) })()`, null, { timeout: 20000 })
}

// attend (jusqu'à `delai`) que l'effet joue sur ce texte ; rend le dernier état lu et ce qui manque
async function attend(ctx: Ctx, c: string, e: Effet, texte: string, delai = 12000): Promise<{ etat: Etat, manque: string }> {
  const fin      = Date.now() + delai
  let etat: Etat = await ctx.lit(lire(c))
  let manque     = e.vivant(etat, texte)
  while (manque && Date.now() < fin) {
    await ctx.page.waitForTimeout(100)
    etat = await ctx.lit(lire(c))
    manque = e.vivant(etat, texte)
  }
  return { etat, manque }
}

// les pixels sombres dans la boîte de chaque balise, comptés dans UNE capture : le texte est vu, pas seulement présent dans le DOM
async function pixels(ctx: Ctx, classes: string[]): Promise<number[]> {
  const boites = await ctx.lit(`[${classes.map(c => BOITE(c)).join(',')}].map(el => { const b = el.getBoundingClientRect(); return { x: b.x + scrollX, y: b.y + scrollY, w: b.width, h: b.height } })`)
  const x0     = Math.max(0, Math.floor(Math.min(...boites.map((b: any) => b.x))))
  const y0     = Math.max(0, Math.floor(Math.min(...boites.map((b: any) => b.y))))
  const x1     = Math.ceil(Math.max(...boites.map((b: any) => b.x + b.w)))
  const y1     = Math.ceil(Math.max(...boites.map((b: any) => b.y + b.h)))
  const png    = await ctx.page.screenshot({ clip: { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) } })
  return ctx.decodeur.evaluate(`(${DECODER})(${JSON.stringify([png.toString('base64'), boites, x0, y0])})`)
}

// attend (jusqu'à `delai`) que chaque balise ait montré du texte : un effet qui joue a des images creuses (le cadre fermé, la lettre qui n'est pas arrivée), on garde le plus grand compte vu
async function visibles(ctx: Ctx, classes: string[], delai = 12000): Promise<number[]> {
  const fin = Date.now() + delai
  const vus = classes.map(() => 0)
  while (Date.now() < fin) {
    const n = await pixels(ctx, classes)
    n.forEach((p, i) => { vus[i] = Math.max(vus[i], p) })
    if (vus.every(p => p >= MIN_PIXELS)) break
    await ctx.page.waitForTimeout(150)
  }
  return vus
}

const dit = (qui: string, r: { etat: Etat, manque: string }) => `${qui} : ${r.manque} — ${JSON.stringify(r.etat)}`

describe('un effet de texte survit à la réécriture de son texte par un script (navigateurs réels)', function () {
  this.timeout(1800000)
  // chaque application est construite à la première page qui la demande (un essai ciblé ne construit que la sienne)
  const scripts: Record<number, string> = {}
  const construire = async (i: number, src: string, prod: boolean, nom: string): Promise<string> => {
    if (scripts[i]) return scripts[i]
    const root   = mjsTmp('texte-reecrit-' + i)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'z-' + i + '.mjs'), src)
    // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
    const manifeste    = join(outDir, 'bundle.js')
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle' }
    if (prod) options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [], nom)
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
          const tag = 'mjs-z-' + i
          let ctx: Ctx

          before(async function () {
            ctx = await ouvrir(browser, await construire(i, source(appli), appli.env === 'prod', appli.nom), tag)
            ;(ctx.page as any).__tag = tag
            await pretes(ctx, appli.effets.flatMap(e => CAS.map(c => `${e.nom}-${c}`)))
          })

          after(async () => {
            await ctx?.page.context().close()
            await ctx?.decodeur.context().close()
          })

          for (const e of appli.effets) {
            describe('*' + e.nom, function () {
              it('textContent : l\'effet revient sur le texte neuf, comme avec {$x}', async () => {
                const echecs: string[] = []
                await ctx.lit(ecrireTexte(`${e.nom}-tc`, e.neuf))
                await ctx.lit(`${BOITE(`btn-${e.nom}`)}.click()`)
                const tc  = await attend(ctx, `${e.nom}-tc`, e, e.neuf)
                const via = await attend(ctx, `${e.nom}-var`, e, e.neuf)
                if (tc.manque) echecs.push(dit('textContent', tc))
                if (via.manque) echecs.push(dit('{$x} (le témoin)', via))
                // le même état visible : les mêmes calques, le même contenu, la même piste, la même place gardée (la largeur d'un nombre se mesure dans le calque : il doit être en place), le calque en dernier
                for (const k of MEME) {
                  if (JSON.stringify(tc.etat[k]) !== JSON.stringify(via.etat[k])) echecs.push(`${k} : ${JSON.stringify(tc.etat[k])} avec textContent, ${JSON.stringify(via.etat[k])} avec {$x}`)
                }
                assert.deepEqual(echecs, [])
              })

              it('innerHTML avec des balises : le texte de l\'effet est celui de la balise, les balises restent dans la balise', async () => {
                const echecs: string[] = []
                await ctx.lit(ecrireHtml(`${e.nom}-ih`, e.balises))
                const r = await attend(ctx, `${e.nom}-ih`, e, e.baliseTexte)
                if (r.manque) echecs.push(dit('innerHTML', r))
                if (r.etat.enfants !== 1) echecs.push(`la balise écrite par le script n'est plus dans la balise : ${r.etat.enfants} <b>`)
                if (r.etat.propre !== e.baliseTexte) echecs.push(`le texte propre de la balise est « ${r.etat.propre} », attendu « ${e.baliseTexte} »`)
                assert.deepEqual(echecs, [])
              })

              it('plusieurs réécritures de suite (même tâche, puis tâches séparées) : un seul calque, le dernier texte', async () => {
                const echecs: string[] = []
                const c                = `${e.nom}-suite`
                await ctx.lit(`(() => { const el = ${BOITE(c)}; el.textContent = 'a'; el.innerHTML = 'b <i>c</i>'; el.textContent = ${JSON.stringify(e.neuf)} })()`)
                const un = await attend(ctx, c, e, e.neuf)
                if (un.manque) echecs.push(dit('trois réécritures dans la même tâche', un))
                await ctx.lit(ecrireTexte(c, 'x y'))
                await ctx.page.waitForTimeout(60)
                await ctx.lit(ecrireHtml(c, `<b>${e.baliseTexte}</b>`))
                await ctx.page.waitForTimeout(60)
                await ctx.lit(ecrireTexte(c, e.neuf))
                const deux = await attend(ctx, c, e, e.neuf)
                if (deux.manque) echecs.push(dit('trois réécritures dans des tâches séparées', deux))
                assert.deepEqual(echecs, [])
              })

              it('innerHTML += : la copie figée du calque que la relecture rend ne reste pas à côté du vrai', async () => {
                const echecs: string[] = []
                const c                = `${e.nom}-plus`
                await ctx.lit(ajouterHtml(c, e.plus))
                const r = await attend(ctx, c, e, e.depart + e.plus)
                if (r.manque) echecs.push(dit('innerHTML +=', r))
                // une seconde fois, deux fois dans la même tâche
                await ctx.lit(`(() => { const el = ${BOITE(c)}; el.innerHTML += ${JSON.stringify(e.plus)}; el.innerHTML += ${JSON.stringify(e.plus)} })()`)
                const deux = await attend(ctx, c, e, e.depart + e.plus + e.plus + e.plus)
                if (deux.manque) echecs.push(dit('trois innerHTML +=', deux))
                assert.deepEqual(echecs, [])
              })

              it('une réécriture pendant que l\'effet joue : il repart sur le texte neuf', async () => {
                const echecs: string[] = []
                const c                = `${e.nom}-joue`
                // le texte de départ joue : un compteur et un brouillage partent au clic (on attend qu'ils soient en route), un défilé et des couleurs courent sans fin
                const enRoute = (a: Etat) => e.nom === 'count' ? sb(a.calque ?? '') !== '' && sb(a.calque ?? '') !== '0' && sb(a.calque ?? '') !== e.depart : e.nom === 'scramble' ? a.lettres !== sb(e.depart) : a.calques === 1
                if (e.nom === 'count' || e.nom === 'scramble') await ctx.lit(`${BOITE(c)}.click()`)
                else await ctx.page.waitForTimeout(700)
                let avant: Etat = await ctx.lit(lire(c))
                for (let n = 0; n < 60 && !enRoute(avant); n++) {
                  await ctx.page.waitForTimeout(50)
                  avant = await ctx.lit(lire(c))
                }
                if (!enRoute(avant)) echecs.push(`l'effet n'est pas en route avant la réécriture (le cas ne joue pas) : ${JSON.stringify(avant)}`)
                await ctx.lit(ecrireTexte(c, e.neuf))
                const r = await attend(ctx, c, e, e.neuf, 20000)
                if (r.manque) echecs.push(dit('réécrit en cours de jeu', r))
                assert.deepEqual(echecs, [])
              })

              it('une réécriture puis le retrait de l\'effet : aucun reste (marques, calque, style, observateur)', async () => {
                const echecs: string[] = []
                const c                = `${e.nom}-retrait`
                await ctx.lit(ecrireTexte(c, e.neuf))
                const r = await attend(ctx, c, e, e.neuf)
                if (r.manque) echecs.push(dit('avant le retrait', r))
                await ctx.lit(retirer(c, e.nom))
                const apres = await ctx.lit(reste(c))
                if (apres.marques.length || apres.calques || apres.style || apres.suivis || apres.texte !== e.neuf) echecs.push(`ce qui reste après le retrait : ${JSON.stringify(apres)}`)
                // la réécriture et le retrait dans la même tâche (l'observateur n'a pas encore parlé)
                const m = `${e.nom}-meme`
                await ctx.lit(`(() => { ${ecrireTexte(m, e.neuf)}; ${retirer(m, e.nom)} })()`)
                await ctx.page.waitForTimeout(150)
                const meme = await ctx.lit(reste(m))
                if (meme.marques.length || meme.calques || meme.style || meme.suivis || meme.texte !== e.neuf) echecs.push(`ce qui reste après une réécriture et un retrait dans la même tâche : ${JSON.stringify(meme)}`)
                assert.deepEqual(echecs, [])
              })

              it('au repos, plus aucun rappel d\'observateur sur la balise : 1,5 s de calme, puis 6 s sans un seul rappel', async () => {
                const c = `${e.nom}-tc`
                await ctx.lit(ecrireTexte(c, e.neuf))
                const r = await attend(ctx, c, e, e.neuf)
                assert.equal(r.manque, '', dit('avant le repos', r))
                const rondes = () => ctx.lit(`window.__rondes.get(${BOITE(c)}) || 0`)
                // le jeu de l'effet finit (un compteur, un brouillage, une police qui arrive) : on attend une fenêtre de 1,5 s sans un rappel
                let avant = await rondes()
                let calme = false
                for (let n = 0; n < 20 && !calme; n++) {
                  await ctx.page.waitForTimeout(FENETRE)
                  const apres = await rondes()
                  calme = apres === avant
                  avant = apres
                }
                assert.ok(calme, `la balise n'est jamais au calme : ${avant} rappels d'observateur, aucune fenêtre de ${FENETRE / 1000} s sans rappel`)
                // puis le repos strict : aucun rappel pendant six secondes (un battement toutes les 1,5 s s'y voit)
                await ctx.page.waitForTimeout(REPOS)
                const fin = await rondes()
                assert.equal(fin, avant, `${fin - avant} rappel(s) d'observateur sur la balise pendant ${REPOS / 1000} s de repos`)
              })
            })
          }

          if (appli.duo) {
            it('deux effets de lettres sur une balise (le calque partagé) : il revient une fois, les deux jouent, il reste tant que l\'un des deux est posé', async () => {
              const echecs: string[] = []
              const lit              = async () => ctx.lit(lire('duo')) as Promise<Etat>
              await ctx.lit(ecrireTexte('duo', 'Un autre texte'))
              let s: Etat = await lit()
              for (let n = 0; n < 120 && (s.calques !== 1 || s.lettres !== 'Unautretexte'); n++) {
                await ctx.page.waitForTimeout(100)
                s = await lit()
              }
              if (s.calques !== 1 || s.lettres !== 'Unautretexte') echecs.push(`le calque partagé n'est pas revenu une fois, avec le texte neuf : ${JSON.stringify(s)}`)
              await ctx.page.waitForTimeout(400)
              s = await lit()
              if (s.couleurs.length === 0 || s.couleurs.some(c => !c)) echecs.push(`*rainbow ne peint pas les lettres : ${JSON.stringify(s.couleurs)}`)
              if (s.anims < 1) echecs.push(`*bounce n'anime pas les lettres : ${s.anims} animation(s)`)
              await ctx.lit(retirer('duo', 'rainbow'))
              s = await lit()
              if (s.calques !== 1 || s.anims < 1) echecs.push(`le calque doit rester pour *bounce : ${JSON.stringify(s)}`)
              await ctx.lit(retirer('duo', 'bounce'))
              const apres = await ctx.lit(reste('duo'))
              if (apres.marques.length || apres.calques || apres.style || apres.suivis) echecs.push(`ce qui reste après le retrait des deux effets : ${JSON.stringify(apres)}`)
              assert.deepEqual(echecs, [])
            })
          }

          if (appli.duo) {
            it('deux calques de texte sur une balise (lettres et compteur) : une relecture du HTML ne retire que les copies figées, les deux calques vivants reviennent', async () => {
              const echecs: string[] = []
              const lit2             = () => ctx.lit(`(() => { const el = ${BOITE('duo2')}; const c = [...el.children].filter(x => x.getAttribute('mjs-fx-layer') === 'text'); return { n: c.length, lettres: c.map(x => [...x.querySelectorAll('[mjs-fx-letter]')].map(l => l.textContent).join('')), textes: c.map(x => x.textContent.replace(/\\s+/g, '')) } })()`)
              await ctx.lit(ajouterHtml('duo2', '5'))
              const bon  = (v: any) => v.n === 2 && v.lettres.filter((l: string) => l === '12345').length === 1 && v.textes.every((t: string) => t === '12345')
              let v      = await lit2()
              for (let n = 0; n < 120 && !bon(v); n++) {
                await ctx.page.waitForTimeout(100)
                v = await lit2()
              }
              if (!bon(v)) echecs.push(`après innerHTML +=, attendu deux calques vivants (un de lettres, un de compteur) qui disent « 12345 » : ${JSON.stringify(v)}`)
              await ctx.lit(ecrireTexte('duo2', '5678'))
              v = await lit2()
              for (let n = 0; n < 120 && !(v.n === 2 && v.textes.every((t: string) => t === '5678')); n++) {
                await ctx.page.waitForTimeout(100)
                v = await lit2()
              }
              if (!(v.n === 2 && v.textes.every((t: string) => t === '5678'))) echecs.push(`après textContent, attendu deux calques qui disent « 5678 » : ${JSON.stringify(v)}`)
              assert.deepEqual(echecs, [])
            })
          }

          if (appli.duo) {
            it('le calque d\'un autre effet (marqué mjs-fx-layer, pas du texte) : la remise du calque de texte ne le retire pas, seule la copie figée du calque de texte part', async () => {
              const echecs: string[] = []
              const lit3             = () => ctx.lit(`(() => { const c = [...${BOITE('decor')}.children]; return { textes: c.filter(x => x.getAttribute('mjs-fx-layer') === 'text').length, decors: c.filter(x => x.getAttribute('mjs-fx-layer') === 'decor').length, dernier: c.length > 0 && c[c.length - 1].getAttribute('mjs-fx-layer') === 'text' } })()`)
              const attendre         = async (bon: (v: any) => boolean) => {
                let v = await lit3()
                for (let n = 0; n < 120 && !bon(v); n++) {
                  await ctx.page.waitForTimeout(100)
                  v = await lit3()
                }
                return v
              }
              // une relecture du HTML qui ramène un calque d'un autre effet (posé ici à la main), à côté de la copie figée du calque de texte
              await ctx.lit(ajouterHtml('decor', '<i mjs-fx-layer="decor"></i>'))
              let v = await attendre(x => x.textes === 1 && x.dernier)
              if (v.textes !== 1 || !v.dernier) echecs.push(`le calque de texte n'est pas revenu seul, en dernier : ${JSON.stringify(v)}`)
              if (v.decors !== 1) echecs.push(`le calque de l'autre effet a été retiré avec la copie figée du calque de texte : ${JSON.stringify(v)}`)
              // une seconde relecture : le calque de l'autre effet reste, un seul calque de texte
              await ctx.lit(ajouterHtml('decor', ' encore'))
              v = await attendre(x => x.textes === 1 && x.dernier)
              if (v.textes !== 1 || !v.dernier || v.decors !== 1) echecs.push(`après une seconde relecture : ${JSON.stringify(v)}`)
              assert.deepEqual(echecs, [])
            })
          }

          if (appli.duo) {
            it('un texte écrit par le framework (@html=!{$h}) a son effet à la pose et à chaque changement', async () => {
              const echecs: string[] = []
              const bon = async (lettres: string) => {
                let s: Etat = await ctx.lit(lire('html'))
                for (let n = 0; n < 120 && (s.calques !== 1 || s.lettres !== lettres || s.invisible); n++) {
                  await ctx.page.waitForTimeout(100)
                  s = await ctx.lit(lire('html'))
                }
                return s.calques === 1 && s.lettres === lettres && !s.invisible ? '' : JSON.stringify(s)
              }
              const pose = await bon('Untexte')
              if (pose) echecs.push(`à la pose : ${pose}`)
              await ctx.lit(`${BOITE('btn-html')}.click()`)
              const change = await bon('Unautretexte')
              if (change) echecs.push(`après le changement de la variable : ${change}`)
              assert.deepEqual(echecs, [])
            })
          }

          it('aucune erreur de console ni de page, aucun avertissement', async () => {
            assert.deepEqual(ctx.erreurs, [])
            assert.deepEqual(ctx.avis, [])
          })
        })
      })

      describe('les douze effets de texte, en production', function () {
        const i   = APPLIS.length
        const tag = 'mjs-z-' + i
        let ctx: Ctx

        before(async function () {
          ctx = await ouvrir(browser, await construire(i, sourceDouze(), true, 'les douze effets'), tag, 2400)
          ;(ctx.page as any).__tag = tag
          await pretes(ctx, DOUZE.flatMap(e => ['var', 'tc', 'ih'].map(c => `${e.nom}-${c}`)).concat(['delta-nvar', 'delta-ntc', 'frappe-nvar', 'frappe-ntc']))
        })

        after(async () => {
          await ctx?.page.context().close()
          await ctx?.decodeur.context().close()
        })

        for (const e of DOUZE) {
          it(`*${e.nom} : textContent et innerHTML finissent comme {$x} (un calque, en dernier, le même contenu, le texte visible)`, async () => {
            const echecs: string[] = []
            await ctx.lit(ecrireTexte(`${e.nom}-tc`, e.neuf))
            await ctx.lit(ecrireHtml(`${e.nom}-ih`, e.balises))
            await ctx.lit(`${BOITE(`btn-${e.nom}`)}.click()`)
            const via = await attend(ctx, `${e.nom}-var`, e, e.neuf)
            const tc  = await attend(ctx, `${e.nom}-tc`, e, e.neuf)
            const ih  = await attend(ctx, `${e.nom}-ih`, e, e.baliseTexte)
            if (via.manque) echecs.push(dit('{$x} (le témoin)', via))
            if (tc.manque) echecs.push(dit('textContent', tc))
            if (ih.manque) echecs.push(dit('innerHTML', ih))
            for (const k of MEME) {
              if (JSON.stringify(tc.etat[k]) !== JSON.stringify(via.etat[k])) echecs.push(`${k} : ${JSON.stringify(tc.etat[k])} avec textContent, ${JSON.stringify(via.etat[k])} avec {$x}`)
              if (JSON.stringify(ih.etat[k]) !== JSON.stringify(via.etat[k])) echecs.push(`${k} : ${JSON.stringify(ih.etat[k])} avec innerHTML, ${JSON.stringify(via.etat[k])} avec {$x}`)
            }
            const classes = ['var', 'tc', 'ih'].map(c => `${e.nom}-${c}`)
            const vus     = await visibles(ctx, classes)
            vus.forEach((p, k) => { if (p < MIN_PIXELS) echecs.push(`${classes[k]} : le texte ne se voit pas (${p} pixel(s) sombre(s), il en faut ${MIN_PIXELS})`) })
            assert.deepEqual(echecs, [])
          })
        }

        it('*delta : un normalize() juste après le changement ({$x} ou textContent) laisse le nombre visible, sans erreur de page', async () => {
          const echecs: string[] = []
          const delta            = DOUZE.find(e => e.nom === 'delta') as Effet
          const avant            = ctx.erreurs.length
          await ctx.lit(`(async () => { ${BOITE('btn-delta-n')}.click(); ${MICROTACHES}; ${BOITE('delta-nvar')}.normalize() })()`)
          await ctx.lit(`(async () => { const el = ${BOITE('delta-ntc')}; el.textContent = '5678'; ${MICROTACHES}; el.normalize() })()`)
          for (const c of ['delta-nvar', 'delta-ntc']) {
            const r = await attend(ctx, c, delta, '5678')
            if (r.manque) echecs.push(dit(c, r))
          }
          const vus = await visibles(ctx, ['delta-nvar', 'delta-ntc'])
          vus.forEach((p, k) => { if (p < MIN_PIXELS) echecs.push(`${['delta-nvar', 'delta-ntc'][k]} : le nombre ne se voit pas (${p} pixel(s) sombre(s), il en faut ${MIN_PIXELS})`) })
          const erreurs = ctx.erreurs.slice(avant)
          if (erreurs.length) echecs.push(`erreur de page : ${erreurs[0]}`)
          assert.deepEqual(echecs, [])
        })

        it('*cycle(style: type) : un normalize() juste après le changement ({$x} ou textContent) laisse le texte tapé visible, sans erreur de page', async () => {
          const echecs: string[] = []
          const avant            = ctx.erreurs.length
          const cas              = [
            { c: 'frappe-nvar', nom: '{$x}', changer: `${BOITE('btn-frappe-n')}.click()` },
            { c: 'frappe-ntc', nom: 'textContent', changer: `${BOITE('frappe-ntc')}.textContent = 'Salut'` }
          ]
          for (const { c, nom, changer } of cas) {
            // en pause : le texte tapé est vide, et son nœud de texte aussi
            let essai = 'pas en pause'
            for (let n = 0; n < 100 && essai === 'pas en pause'; n++) {
              essai = await ctx.lit(taper(c, changer))
              if (essai === 'pas en pause') await ctx.page.waitForTimeout(100)
            }
            if (essai !== 'fait') { echecs.push(`${nom} : ${essai}`); continue }
            // le mot reprend après la pause (3 s) : le texte tapé s'y montre, lettre à lettre
            let vus: Array<string | null> = []
            for (let n = 0; n < 150 && !vus.some(v => v); n++) {
              await ctx.page.waitForTimeout(100)
              vus = await ctx.lit(`[...window.__tapes[${JSON.stringify(c)}]]`)
            }
            if (!vus.some(v => v)) echecs.push(`${nom} : le texte tapé ne se montre jamais — vu ${JSON.stringify(vus)}`)
            else if (vus.some(v => v && !'Salut'.startsWith(v))) echecs.push(`${nom} : le texte tapé n'est pas un début de « Salut » — vu ${JSON.stringify(vus)}`)
          }
          const erreurs = ctx.erreurs.slice(avant)
          if (erreurs.length) echecs.push(`erreur de page : ${erreurs[0]}`)
          assert.deepEqual(echecs, [])
        })

        it('aucune erreur de console ni de page, aucun avertissement', async () => {
          assert.deepEqual(ctx.erreurs, [])
          assert.deepEqual(ctx.avis, [])
        })
      })
    })
  }
})
