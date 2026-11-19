// un composant léger est sa propre ombre (`_shadow`, la balise elle-même) ; quand il porte aussi une racine d'ombre native, c'est elle
// qui s'affiche, ses enfants glissés par son `<slot>`. Les parcours qui entrent dans un composant prenaient la balise du léger pour son
// ombre et s'y arrêtaient. Chromium, Firefox et WebKit réels, le code même du runtime (chaque parcours tiré de sa source) :
//   - *follow : la balise sous une ligne (l'ombre native d'un léger, ce qu'un `<slot>` reçoit, son contenu de repli, un slot dans un
//     slot, un slot qui reçoit du dehors de la zone), l'ancre au point, le chemin envoyé retrouvé chez le public ;
//   - µ.elementAt et *pointer : la balise sous un point de l'ombre native ;
//   - *sticky : le champ de l'ombre native qui a le focus ; la marge que la barre reprend, celle du premier enfant affiché (un `<slot>`
//     en tête d'une ombre montre ce qu'il reçoit, ou son repli ; une feuille `<style>` est sautée) ;
//   - l'ancrage de la navigation : le champ autofocus de l'ombre native qui a le focus n'arrête pas le suivi de l'ancre ;
//   - le panneau de développement : le focus rendu à sa fermeture, les changements de l'ombre native éclairés ;
//   - le démarrage : une balise glissée dans un léger à ombre native monte par le slot qui la reçoit ;
//   - le coût, 3 000 balises glissées, 3 000 slots nommés ou à repli, un repli épais au démarrage : des lectures comptées (`parentNode`, rangs cherchés dans une liste d'enfants, balises fouillées
//     par `querySelectorAll`, balises rendues par un slot), au plus trois par balise glissée — chercher le chemin de chaque balise
//     glissée coûtait comme le carré de leur nombre ; des lectures plutôt qu'un temps : le verdict ne dépend pas de la charge.
// Puis la même scène sur une vraie construction de production (minifiée, noms internes raccourcis) : `µ.elementAt` et l'ancre de
// *follow (celui qui mène envoie le chemin de la balise en haut de sa zone, sous un bandeau fixe ou non) tournent dans le code
// construit ; les autres parcours sur l'aide commune de cette construction, retrouvée sous son nom raccourci

import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const MOTEURS  = ['chromium', 'firefox', 'webkit'] as const
const N        = 3000
const L        = (...l: string[]) => l.join('\n') + '\n'
const ici      = dirname(fileURLToPath(import.meta.url))
const source   = (f: string) => readFileSync(join(ici, '../src/runtime', f), 'utf-8')
const tirer    = (texte: string, motif: RegExp) => (texte.match(motif) || [''])[0]
const SUIVI    = source('mjs_fx_follow.ts')
const BARRE    = source('mjs_fx_sticky.ts')
const PANNEAU  = source('mjs_devpanel.ts')
const DEPART   = source('mjs_init.ts')
const fonction = (nom: string, args: string) => tirer(SUIVI, new RegExp(`var ${nom} = function\\(${args}\\) \\{(?:[^\\n]*\\};|[\\s\\S]*?\\n\\s*\\};)`))

// le code de chaque parcours, tiré de sa source ; `ombre` : l'ombre d'un composant, commune aux parcours (absente, chacun a la sienne)
const CODES = {
  ombre:    tirer(DEPART, /µ\._mjs_shadowOf = function\(n\) \{[^\n]*\};/),
  point:    tirer(source('mjs_element_at.ts'), /µ\._mjs_elementAt = function\(x, y, root\) \{[\s\S]*?\n\};/),
  suivi:    [['pathOf', 'n'], ['nodeAt', 'path'], ['floats', 'e, alone'], ['under', 'y']].map(([n, a]) => fonction(n, a)).join('\n'),
  barre:    tirer(BARRE, /for \(var sh = a && [^\n]*\n/),
  marge:    tirer(BARRE, /var flows = function\(c\) \{[^\n]*\};/) + '\n' + tirer(BARRE, /var spill = function\(box, cs, r, top\) \{[\s\S]*?\n {4}\};/),
  pointeur: tirer(source('mjs_fx_pointer.ts'), /var n = tg \|\| [^\n]*\n\s*for \(var i = 0; n && i < 32; i\+\+\) \{[\s\S]*?\n\s*\}\n/),
  panneau:  tirer(PANNEAU, /function _dpActiveDeep\(\) \{[\s\S]*?\n\}\n/),
  suivre:   tirer(PANNEAU, /function _dpUpdTrack\(\) \{[\s\S]*?\n\}\n/),
  depart:   tirer(DEPART, /function _mjsFlatParent\(n\) \{[\s\S]*?\n\}\n/),
  ancrage:  tirer(source('mjs_ujs.ts'), /focused = function\(e\) \{[\s\S]*?\n  \};/)
}

const STYLE = 'body{margin:0}.z{width:400px}x-o,x-l{display:block}p{margin:12px 0;height:20px}textarea{display:block;height:20px}.bandeau{position:fixed;top:0;left:0;right:0;height:30px;background:#fff}'
const PAGE  = `<!doctype html><html><head><style>${STYLE}</style></head><body></body></html>`

// joué dans la page : un ordinaire (ombre fermée, `_shadow`), un léger à ombre native ouverte, un léger sans ombre ; chaque parcours
// rend le nom de la balise trouvée. `reel` : l'aide commune et µ._mjs_elementAt d'une vraie construction (sinon, tirées de leur source)
const JEU = `async (codes, reel) => {
  const mu = { _mjs_dom: { getBoundingClientRect: e => e.getBoundingClientRect(), matches: (e, s) => e.matches(s) } }
  if (reel) {
    mu._mjs_shadowOf  = reel.shadowOf
    mu._mjs_elementAt = reel.elementAt
  }
  else {
    if (codes.ombre) new Function('µ', codes.ombre)(mu)
    new Function('µ', codes.point)(mu)
  }
  const suivi     = zone => new Function('zone', 'µ', codes.suivi + ';return { pathOf, nodeAt, floats, under }')(zone, mu)
  const barre     = new Function('µ', 'var a = document.activeElement;\\n' + codes.barre + ';return a;')
  const marge     = new Function('µ', 'dom', codes.marge + ';return spill;')(mu, mu._mjs_dom)
  const pointeur  = new Function('µ', 'tg', 'tx', 'ty', codes.pointeur + ';return n;')
  const panneau   = new Function('µ', codes.panneau + ';return _dpActiveDeep;')(mu)
  const suivre    = (instances, obs, file) => new Function('µ', '_dpUpdObs', '_dpUpdQueue', '_dpUpdTarget', '_dpUpdHighlight', '_dpUpdImage', codes.suivre + ';return _dpUpdTrack;')({ instances, _mjs_shadowOf: mu._mjs_shadowOf }, obs, file, m => m.target, () => {}, 0)
  const depart    = new Function('µ', codes.depart + ';return _mjsFlatParent;')(mu)
  const ancrage   = arret => new Function('µ', 'stop', 'var focused;\\n' + codes.ancrage + ';return focused;')(mu, arret)
  const ordinaire = (parent, ombre, clair, tag) => { const h = parent.appendChild(document.createElement(tag || 'x-o')); h._shadow = h.attachShadow({ mode: 'closed' }); h._shadow.innerHTML = ombre; h.innerHTML = clair; return h }
  const leger     = (parent, clair, natif) => { const l = parent.appendChild(document.createElement('x-l')); l._shadow = l; l.innerHTML = clair; if (natif !== undefined) l.attachShadow({ mode: 'open' }).innerHTML = natif; return l }
  const zoneNeuve = () => { const z = document.body.appendChild(document.createElement('div')); z.className = 'z'; return z }
  const nomDe     = (e, c) => { if (!e) return String(e); for (const k in c) if (c[k] === e) return k; return e.localName + (e.id ? '#' + e.id : '') }
  const centre    = e => { const r = e.getBoundingClientRect(); return { x: r.left + Math.min(5, r.width / 2), y: r.top + r.height / 2 } }
  const sortie    = { sous: {}, ancre: {}, retour: {}, point: {}, pointeur: {}, depart: {}, slots: {}, marge: {}, cout: {} }
  {
    const z  = zoneNeuve()
    const o  = ordinaire(z, '<p id="t">tête de o</p><slot></slot>', '<p id="g">glissé dans o</p>')
    const l  = leger(z, '<p id="cl">clair de n</p>', '<p id="nat">ombre native de n</p><textarea id="champ"></textarea><slot></slot>')
    const s  = leger(z, '<p id="ls">dans un léger sans ombre</p>')
    const sr = l.shadowRoot
    const c  = { zone: z, 'tête de o': o._shadow.getElementById('t'), 'glissé dans o': o.querySelector('#g'), 'ombre native de n': sr.getElementById('nat'), 'clair de n': l.querySelector('#cl'), 'dans un léger sans ombre': s.querySelector('#ls'), champ: sr.getElementById('champ'), 'ordinaire entier': o, 'léger entier': l, 'léger sans ombre': s, 'slot de o': o._shadow.querySelector('slot'), 'slot de l’ombre native': sr.querySelector('slot') }
    const F  = suivi(z)
    for (const k of ['tête de o', 'glissé dans o', 'ombre native de n', 'clair de n', 'dans un léger sans ombre']) {
      const p  = centre(c[k])
      const ea = mu._mjs_elementAt(p.x, p.y, document)
      const ch = F.pathOf(c[k])
      sortie.sous[k]     = nomDe(F.under(p.y), c)
      sortie.ancre[k]    = nomDe(ea && ea !== z && F.pathOf(ea) && !F.floats(ea) ? ea : F.under(p.y), c)
      sortie.retour[k]   = ch ? nomDe(F.nodeAt(ch), c) : 'sans chemin'
      sortie.point[k]    = nomDe(ea, c)
      sortie.pointeur[k] = nomDe(pointeur(mu, null, p.x, p.y), c)
    }
    c.champ.setAttribute('autofocus', '')
    c.champ.focus()
    sortie.barre   = nomDe(barre(mu), c)
    sortie.panneau = nomDe(panneau(), c)
    const arrets   = []
    ancrage(() => arrets.push(1))({ target: document.activeElement })
    sortie.ancrage = arrets.length ? 'arrêté' : 'gardé'
    c.champ.blur()
    for (const k of ['clair de n', 'glissé dans o', 'dans un léger sans ombre']) sortie.depart[k] = nomDe(depart(c[k]), c)
    z.remove()
  }
  {
    const z  = zoneNeuve()
    const l  = leger(z, '<p style="margin:0">clair de n</p>', '<p style="margin:40px 0;height:20px">ombre native de n</p><slot></slot>')
    const o  = ordinaire(z, '<p style="margin:30px 0;height:20px">ombre de o</p><slot></slot>', '')
    const s  = leger(z, '<p style="margin:25px 0;height:20px">dans un léger sans ombre</p>')
    const m1 = leger(z, '<p style="margin:40px 0;height:20px">glissé 40</p>', '<slot></slot>')
    const m2 = leger(z, '<p style="margin:40px 0;height:20px">glissé 40</p>', '<style>:host{color:red}</style><slot></slot>')
    const m3 = ordinaire(z, '<slot></slot>', '<p style="margin:30px 0;height:20px">glissé 30</p>')
    const m4 = ordinaire(z, '<slot><p style="margin:35px 0;height:20px">repli 35</p></slot>', '')
    for (const [k, b] of [['léger à ombre native', l], ['ordinaire', o], ['léger sans ombre', s], ['léger, ombre native = slot', m1], ['léger, ombre native = style puis slot', m2], ['ordinaire, ombre = slot', m3], ['ordinaire, ombre = slot à repli', m4]]) sortie.marge[k] = marge(b, getComputedStyle(b), b.getBoundingClientRect(), true)
    z.remove()
  }
  const scenes = {
    'repli': z => { const h = ordinaire(z, '<slot><p id="f1">repli 1</p><p id="f2">repli 2</p></slot>', ''); return { c: { 'ordinaire entier': h, 'repli 1': h._shadow.getElementById('f1'), 'repli 2': h._shadow.getElementById('f2') } } },
    'nommés hors ordre': z => { const h = ordinaire(z, '<slot name="b"></slot><slot></slot><slot name="a"></slot>', '<p slot="a" id="pa">a</p><p id="pd">défaut</p><p slot="b" id="pb">b</p>'); return { c: { 'ordinaire entier': h, b: h.querySelector('#pb'), 'défaut': h.querySelector('#pd'), a: h.querySelector('#pa') } } },
    'slot dans un slot': z => { const a = ordinaire(z, '<x-o2><slot></slot></x-o2>', '<p id="d1">profond 1</p><p id="d2">profond 2</p>'); const b = a._shadow.querySelector('x-o2'); b._shadow = b.attachShadow({ mode: 'closed' }); b._shadow.innerHTML = '<p id="bh">tête de b</p><slot></slot>'; return { c: { 'ordinaire entier': a, 'x-o2 entier': b, 'tête de b': b._shadow.getElementById('bh'), 'profond 1': a.querySelector('#d1'), 'profond 2': a.querySelector('#d2') } } },
    'zone dans une ombre, slot vers le dehors': z => { const h = ordinaire(z, '<div class="z2"><p id="o1">propre</p><slot></slot></div>', '<p id="x1">dehors</p>'); const zone = h._shadow.querySelector('.z2'); return { zone, c: { zone, propre: h._shadow.getElementById('o1'), dehors: h.querySelector('#x1') } } }
  }
  for (const [nom, f] of Object.entries(scenes)) {
    const z = zoneNeuve()
    const s = f(z)
    const F = suivi(s.zone || z)
    for (const k in s.c) if (!/entier$|^zone$/.test(k)) sortie.slots[nom + ' > ' + k] = nomDe(F.under(centre(s.c[k]).y), s.c)
    z.remove()
  }
  // les lectures comptées pendant un parcours, les accesseurs rendus en finally
  const compter = fn => {
    const pn  = Object.getOwnPropertyDescriptor(Node.prototype, 'parentNode')
    const io  = Array.prototype.indexOf
    const qe  = Element.prototype.querySelectorAll
    const qf  = DocumentFragment.prototype.querySelectorAll
    const ae  = HTMLSlotElement.prototype.assignedElements
    const s1  = Element.prototype.querySelector
    const s2  = DocumentFragment.prototype.querySelector
    const pas = { parentNode: 0, rangs: 0, fouille: 0, recus: 0 }
    let rendu
    Object.defineProperty(Node.prototype, 'parentNode', { ...pn, get() { pas.parentNode++; return pn.get.call(this) } })
    Array.prototype.indexOf = function (...a) { const r = io.apply(this, a); if (this instanceof NodeList || this instanceof HTMLCollection) pas.rangs += r < 0 ? this.length : r + 1; return r }
    Element.prototype.querySelectorAll = function (q) { pas.fouille += qe.call(this, '*').length; return qe.call(this, q) }
    DocumentFragment.prototype.querySelectorAll = function (q) { pas.fouille += qf.call(this, '*').length; return qf.call(this, q) }
    HTMLSlotElement.prototype.assignedElements = function (...a) { const r = ae.apply(this, a); pas.recus += r.length; return r }
    // un querySelector s'arrête à la première balise trouvée : compté jusqu'à elle, dans l'ordre de l'arbre
    Element.prototype.querySelector = function (q) { const r = s1.call(this, q); pas.fouille += r ? io.call(qe.call(this, '*'), r) + 1 : qe.call(this, '*').length; return r }
    DocumentFragment.prototype.querySelector = function (q) { const r = s2.call(this, q); pas.fouille += r ? io.call(qf.call(this, '*'), r) + 1 : qf.call(this, '*').length; return r }
    try { rendu = fn() }
    finally {
      Object.defineProperty(Node.prototype, 'parentNode', pn)
      Array.prototype.indexOf = io
      Element.prototype.querySelectorAll = qe
      DocumentFragment.prototype.querySelectorAll = qf
      HTMLSlotElement.prototype.assignedElements = ae
      Element.prototype.querySelector = s1
      DocumentFragment.prototype.querySelector = s2
    }
    return { rendu, pas: pas.parentNode + pas.rangs + pas.fouille + pas.recus, detail: pas }
  }
  const mesure = (nom, c, fn) => { const r = compter(fn); sortie.cout[nom] = { rendu: typeof r.rendu === 'string' ? r.rendu : nomDe(r.rendu, c), pas: r.pas, detail: r.detail } }
  {
    const z     = zoneNeuve()
    const o     = ordinaire(z, '<slot></slot>', '<p>g</p>'.repeat(${N}))
    const cible = o.children[${N} >> 1]
    cible.scrollIntoView({ block: 'center' })
    const y = centre(cible).y
    const F = suivi(z)
    mesure('*follow, ordinaire à slot', { 'ordinaire entier': o, 'la balise glissée du milieu': cible }, () => F.under(y))
    z.remove()
  }
  {
    const z     = zoneNeuve()
    const l     = leger(z, '<p>g</p>'.repeat(${N}), '<textarea id="champ"></textarea><slot></slot>')
    const sr    = l.shadowRoot
    const cible = l.children[${N} >> 1]
    cible.scrollIntoView({ block: 'center' })
    const p    = centre(cible)
    const F    = suivi(z)
    const c    = { 'léger entier': l, 'la balise glissée du milieu': cible, champ: sr.getElementById('champ'), 'slot de l’ombre native': sr.querySelector('slot') }
    const kids = Array.from(l.children)
    mesure('*follow, léger à ombre native', c, () => F.under(p.y))
    mesure('µ.elementAt', c, () => mu._mjs_elementAt(p.x, p.y, document))
    mesure('*pointer', c, () => pointeur(mu, null, p.x, p.y))
    c.champ.focus()
    mesure('*sticky', c, () => barre(mu))
    mesure('panneau de développement', c, () => panneau())
    c.champ.blur()
    mesure('démarrage', c, () => kids.filter(k => depart(k) === c['slot de l’ombre native']).length + ' balises montent par le slot')
    z.remove()
  }
  {
    const z     = zoneNeuve()
    const o     = ordinaire(z, Array.from({ length: ${N} }, (_, i) => '<slot name="s' + i + '"></slot>').join(''), Array.from({ length: ${N} }, (_, i) => '<p slot="s' + i + '">g</p>').join(''))
    const cible = o.children[${N} - 1]
    cible.scrollIntoView({ block: 'center' })
    const y = centre(cible).y
    const F = suivi(z)
    mesure('*follow, ${N} slots nommés', { 'ordinaire entier': o, 'la dernière balise': cible }, () => F.under(y))
    z.remove()
  }
  {
    const z     = zoneNeuve()
    const o     = ordinaire(z, Array.from({ length: ${N} }, (_, i) => '<slot name="r' + i + '"><p>f</p></slot>').join(''), '')
    const cible = o._shadow.lastElementChild.firstElementChild
    cible.scrollIntoView({ block: 'center' })
    const y = centre(cible).y
    const F = suivi(z)
    mesure('*follow, ${N} slots à repli', { 'ordinaire entier': o, 'la dernière balise': cible }, () => F.under(y))
    z.remove()
  }
  for (const [nom, fab] of [['démarrage, léger à repli épais', z => { const l = leger(z, '<p>g</p>'.repeat(${N}), '<slot>' + '<p>f</p>'.repeat(${N}) + '</slot>'); return [l, l.shadowRoot] }], ['démarrage, ordinaire à repli épais', z => { const o = ordinaire(z, '<slot>' + '<p>f</p>'.repeat(${N}) + '</slot>', '<p>g</p>'.repeat(${N})); return [o, o._shadow] }]]) {
    const z      = zoneNeuve()
    const [h, r] = fab(z)
    const slot   = r.querySelector('slot')
    const kids   = Array.from(h.children)
    mesure(nom, {}, () => kids.filter(k => depart(k) === slot).length + ' balises montent par le slot')
    z.remove()
  }
  window.scrollTo(0, 0)
  {
    const z    = zoneNeuve()
    const l    = leger(z, '<p>clair de n</p>', '<p id="nat">ombre native de n</p><slot></slot>')
    const s    = leger(z, '<p>dans un léger sans ombre</p>')
    const obs  = new Map()
    const file = new Set()
    const c    = { page: document.body, 'ombre native de n': l.shadowRoot, 'léger entier': l, 'léger sans ombre': s, 'texte de l’ombre native': l.shadowRoot.getElementById('nat') }
    suivre(new Set([l, s]), obs, file)()
    sortie.suivies = Array.from(obs.keys()).map(r => nomDe(r, c))
    c['texte de l’ombre native'].textContent = 'changé'
    await new Promise(r => setTimeout(r, 0))
    sortie.vues = Array.from(file).map(t => nomDe(t, c))
    obs.forEach(mo => mo.disconnect())
    z.remove()
  }
  return sortie
}`

// une vraie construction de production : celui qui mène, sa connexion remplacée par un relevé (l'effet envoie le chemin de la balise
// en haut de sa zone) ; la scène sous le haut de la zone : l'ombre native du léger
const PROD = `async (noms) => {
  const mu   = window.__mu
  const nm   = k => noms[k] || k
  const hote = document.querySelector('mjs-hote')
  const z    = hote._shadow.querySelector('.z')
  const n    = z.querySelector('mjs-n')
  n.attachShadow({ mode: 'open' }).innerHTML = '<p id="nat" style="margin:0;height:20px">ombre native de n</p><slot></slot>'
  const nat    = n.shadowRoot.getElementById('nat')
  const cl     = n.querySelector('.cl')
  const nom    = e => e === nat ? 'ombre native de n' : e === cl ? 'clair de n' : e === n ? 'léger entier' : e ? e.localName : String(e)
  const sortie = {}
  const r      = nat.getBoundingClientRect()
  sortie.point = nom(mu.elementAt(r.left + 5, r.top + r.height / 2))
  const envois = []
  const faux   = { send: (t, p) => { envois.push([t, p]) }, on: () => () => {}, request: () => new Promise(() => {}) }
  mu[nm('_mjs_fxSock')]    = (a, b, c, quand) => { const fin = quand(faux); return () => { if (typeof fin === 'function') fin() } }
  mu[nm('_mjs_fxPackage')] = () => {}
  mu[nm('_mjs_fxRoom')]    = () => ({ presence: () => ({}), leave: () => {} })
  const stop    = mu[nm('_mjs_fxDefs')].follow.setup(z, { lead: true, cursor: 'none', selection: false, focus: false }, hote)
  const image   = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)))
  const vers    = ch => { let x = z; for (const i of ch) x = x && (i === -1 ? (x._shadow !== x && x._shadow || x.shadowRoot) : x.childNodes[i]); return x }
  const dernier = () => { const e = envois.filter(e => e[0] === 'follow:at').pop(); return e ? nom(vers(e[1].a)) : 'rien envoyé' }
  z.dispatchEvent(new Event('scroll'))
  await image()
  sortie.ancre = dernier()
  const bandeau = document.body.appendChild(document.createElement('div'))
  bandeau.className = 'bandeau'
  envois.length = 0
  z.dispatchEvent(new Event('scroll'))
  await image()
  sortie.sous = dernier()
  bandeau.remove()
  stop()
  return sortie
}`

const SOURCES_PROD: Record<string, string> = {
  hote: L('<script>', "@sock = µsocket 'wss://x.fr/ws'", 'window.__mu = µ', '</script>', '<div class="z" *follow(cursor: none, selection: false, focus: false)><mjs-n mjs-light></mjs-n></div>', '<style>', '.z', '  width: 400px', '  height: 200px', '  overflow: auto', 'mjs-n', '  display: block', '</style>'),
  n:    '<p class="cl">clair de n</p>\n'
}

async function construireProduction() {
  const root = mjsTmp('leger-ombre-native-production')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  for (const [nom, code] of Object.entries(SOURCES_PROD)) writeFileSync(join(src, `${nom}.mjs`), code)
  const dossier = join(root, 'out')
  const bundler = new Bundler({ sourceDir: src, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', js: 'bundle', env: 'prod' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(dossier, n)))
  const cache = fichiers.get('.mangle-cache.json')
  return { fichiers, noms: cache ? JSON.parse(cache.toString()) : {} }
}

const VUS  = ['tête de o', 'glissé dans o', 'ombre native de n', 'clair de n', 'dans un léger sans ombre']
const tous = (l: string[]) => Object.fromEntries(l.map(k => [k, k]))

function verifierCodes() {
  for (const [k, v] of Object.entries(CODES)) if (k !== 'ombre' && !v) throw new Error(`code introuvable dans sa source : ${k}`)
  for (const f of ['pathOf', 'nodeAt', 'floats', 'under']) if (!CODES.suivi.includes(`var ${f} = function`)) throw new Error(`*follow : ${f} introuvable dans sa source`)
  for (const f of ['flows', 'spill']) if (!CODES.marge.includes(`var ${f} = function`)) throw new Error(`*sticky : ${f} introuvable dans sa source`)
}

async function navigateurDe(moteur: typeof MOTEURS[number]) {
  const playwright = await import('playwright')
  return existsSync(playwright[moteur].executablePath()) ? playwright[moteur].launch() : null
}

// les sites, leurs résultats lus après la scène (`r()`)
function lesSites(r: () => any) {
  it('*follow : la balise sous une ligne, l\'ancre au point et le chemin retrouvé chez le public, jusque dans l\'ombre native d\'un léger et ce qu\'un slot reçoit', () => {
    assert.deepEqual(r().sous, tous(VUS), 'AVANT : l\'ombre native d\'un léger et ce qu\'un slot reçoit étaient sautées, la ligne rendait le composant entier')
    assert.deepEqual(r().ancre, tous(VUS), 'AVANT : l\'ancre au point s\'arrêtait au léger qui porte une ombre native')
    assert.deepEqual(r().retour, tous(VUS), 'AVANT : le chemin d\'une balise de l\'ombre native désignait, chez le public, une balise du léger')
    assert.deepEqual(r().slots, {
      'repli > repli 1': 'repli 1',
      'repli > repli 2': 'repli 2',
      'nommés hors ordre > b': 'b',
      'nommés hors ordre > défaut': 'défaut',
      'nommés hors ordre > a': 'a',
      'slot dans un slot > tête de b': 'tête de b',
      'slot dans un slot > profond 1': 'profond 1',
      'slot dans un slot > profond 2': 'profond 2',
      'zone dans une ombre, slot vers le dehors > propre': 'propre',
      'zone dans une ombre, slot vers le dehors > dehors': 'propre'
    }, 'un slot montre ce qu\'il reçoit, ou son contenu de repli ; ce qu\'il reçoit du dehors de la zone n\'a pas de chemin depuis elle')
    assert.deepEqual(r().erreurs, [])
  })

  it('µ.elementAt : la balise sous un point de l\'ombre native d\'un léger', () => {
    assert.deepEqual(r().point, tous(VUS), 'AVANT : le léger entier, son ombre native jamais interrogée')
  })

  it('*pointer : la balise sous la souris dans l\'ombre native d\'un léger', () => {
    assert.deepEqual(r().pointeur, tous(VUS), 'AVANT : le léger entier, son ombre native jamais interrogée')
  })

  it('*sticky : le champ de l\'ombre native d\'un léger qui a le focus', () => {
    assert.equal(r().barre, 'champ', 'AVANT : le léger entier, la barre se cachait sous un champ en cours de saisie')
  })

  it('*sticky : la marge que la barre reprend, celle du premier enfant affiché (l\'ombre native d\'un léger, ce que montre un slot en tête de l\'ombre) fusionnée avec la sienne', () => {
    assert.deepEqual(r().marge, { 'léger à ombre native': 40, ordinaire: 30, 'léger sans ombre': 25, 'léger, ombre native = slot': 40, 'léger, ombre native = style puis slot': 40, 'ordinaire, ombre = slot': 30, 'ordinaire, ombre = slot à repli': 35 }, 'AVANT : le premier enfant cherché parmi les enfants du léger, ou pris au `<slot>` en tête de l\'ombre (display: contents) : la marge perdue')
  })

  it('ancrage de la navigation : le champ autofocus de l\'ombre native d\'un léger n\'arrête pas le suivi de l\'ancre', () => {
    assert.equal(r().ancrage, 'gardé', 'AVANT : le léger entier, son champ autofocus pris pour un geste du visiteur')
  })

  it('panneau de développement : le focus rendu à sa fermeture, jusque dans l\'ombre native d\'un léger', () => {
    assert.equal(r().panneau, 'champ', 'AVANT : le léger entier')
  })

  it('panneau de développement : les mises à jour de l\'ombre native d\'un léger sont suivies, un léger sans ombre n\'est pas suivi à part', () => {
    assert.deepEqual(r().suivies, ['page', 'ombre native de n'], 'AVANT : le léger pris pour une racine, posé puis retiré au même tour, son ombre native jamais suivie')
    assert.deepEqual(r().vues, ['texte de l’ombre native'], 'AVANT : un changement dans l\'ombre native d\'un léger n\'était pas éclairé')
  })

  it('démarrage : une balise glissée dans un léger à ombre native monte par le slot qui la reçoit', () => {
    assert.deepEqual(r().depart, { 'clair de n': 'slot de l’ombre native', 'glissé dans o': 'slot de o', 'dans un léger sans ombre': 'léger sans ombre' }, 'AVANT : par le léger, l\'ombre native sautée (le bouclier n\'y voyait pas ce qui l\'entoure)')
  })

  it(`le coût, ${N} balises glissées, ${N} slots, un repli épais : au plus trois lectures par balise glissée, aucune lecture de liste pour un point ou un focus`, () => {
    for (const [nom, v] of Object.entries(r().cout) as [string, any][]) console.log(`  ${nom} : ${v.pas} lectures ${JSON.stringify(v.detail)}`)
    const rendus = Object.fromEntries(Object.entries(r().cout).map(([k, v]: [string, any]) => [k, v.rendu]))
    assert.deepEqual(rendus, {
      '*follow, ordinaire à slot': 'la balise glissée du milieu',
      '*follow, léger à ombre native': 'la balise glissée du milieu',
      'µ.elementAt': 'la balise glissée du milieu',
      '*pointer': 'la balise glissée du milieu',
      '*sticky': 'champ',
      'panneau de développement': 'champ',
      'démarrage': `${N} balises montent par le slot`,
      [`*follow, ${N} slots nommés`]: 'la dernière balise',
      [`*follow, ${N} slots à repli`]: 'la dernière balise',
      'démarrage, léger à repli épais': `${N} balises montent par le slot`,
      'démarrage, ordinaire à repli épais': `${N} balises montent par le slot`
    })
    for (const nom of ['*follow, ordinaire à slot', '*follow, léger à ombre native', `*follow, ${N} slots nommés`, `*follow, ${N} slots à repli`, 'démarrage', 'démarrage, léger à repli épais', 'démarrage, ordinaire à repli épais']) assert.ok(r().cout[nom].pas <= 3 * N, `${nom} : ${r().cout[nom].pas} lectures pour ${N} balises, au plus trois par balise ; le chemin de chaque balise cherché à part, un rang relu à chaque slot ou l'ombre entière fouillée à chaque balise glissée : le coût croissait comme le carré`)
    for (const nom of ['µ.elementAt', '*pointer', '*sticky', 'panneau de développement']) assert.ok(r().cout[nom].pas <= 10, `${nom} : ${r().cout[nom].pas} lectures, un point ou un focus ne lit aucune liste`)
  })
}

for (const moteur of MOTEURS) describe(`composant léger à ombre native : chaque parcours entre dans son ombre et ses enfants glissés — ${moteur}`, function () {
  this.timeout(120000)
  let navigateur: any = null
  let r: any = null

  before(async function () {
    verifierCodes()
    navigateur = await navigateurDe(moteur)
    if (!navigateur) { console.log(`  ℹ️  ${moteur} non installé : test sauté. Activer : \`npx playwright install ${moteur}\``); this.skip() }
    const page    = await navigateur.newPage()
    const erreurs = [] as string[]
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.setContent(PAGE)
    r = await page.evaluate(`(${JEU})(${JSON.stringify(CODES)})`)
    r.erreurs = erreurs
    await page.close()
  })

  after(async function () {
    if (navigateur) await navigateur.close()
  })

  lesSites(() => r)
})

describe('composant léger à ombre native, vraie construction de production', function () {
  this.timeout(180000)
  let prod: { fichiers: Map<string, Buffer>, noms: Record<string, string> } | null = null

  before(async function () {
    verifierCodes()
    prod = await construireProduction()
  })

  after(async function () {
    await terminateSharedWorkerPool()
  })

  for (const moteur of MOTEURS) describe(moteur, function () {
    let navigateur: any = null
    let r: any = null

    before(async function () {
      navigateur = await navigateurDe(moteur)
      if (!navigateur) { console.log(`  ℹ️  ${moteur} non installé : test sauté. Activer : \`npx playwright install ${moteur}\``); this.skip() }
      const page    = await navigateur.newPage()
      const erreurs = [] as string[]
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      if (typeof page.routeWebSocket === 'function') await page.routeWebSocket(/x\.fr/, () => {})
      await page.route('http://composants.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (!url.pathname.startsWith('/out/')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><mjs-hote></mjs-hote><script type="module" src="/out/bundle.js"></script></body></html>` })
        const corps = prod!.fichiers.get(url.pathname.slice(5))
        return corps ? route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps }) : route.fulfill({ status: 404, body: '' })
      })
      await page.goto('http://composants.test/page')
      await page.waitForFunction(`(() => { const h = document.querySelector('mjs-hote'); const n = h && h._shadow && h._shadow.querySelector('mjs-n'); return !!window.__mu && !!n && n._shadow === n })()`, null, { timeout: 30000 })
      const noms = JSON.stringify(prod!.noms)
      r = await page.evaluate(`(${JEU})(${JSON.stringify(CODES)}, { shadowOf: window.__mu[(${noms})._mjs_shadowOf || '_mjs_shadowOf'], elementAt: window.__mu[(${noms})._mjs_elementAt || '_mjs_elementAt'] })`)
      r.construit = await page.evaluate(`(${PROD})(${noms})`)
      r.erreurs = erreurs
      await page.close()
    })

    after(async function () {
      if (navigateur) await navigateur.close()
    })

    it('production : µ.elementAt et l\'ancre de *follow, dans le code construit, jusque dans l\'ombre native d\'un léger', () => {
      assert.deepEqual(r.construit, { point: 'ombre native de n', ancre: 'ombre native de n', sous: 'ombre native de n' }, 'AVANT : le léger entier, au point comme sous le bandeau')
    })

    lesSites(() => r)
  })
})
