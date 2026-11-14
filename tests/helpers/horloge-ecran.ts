// valeurs dérivées à l'horloge montrées par l'écran, après une écriture faite par une autre variable : la valeur relue est juste
// (refaite à sa lecture après toute écriture du composant), l'écran doit la montrer aussi. Cas : fonction rangée comme clé, valeur
// ou élément d'une `Map` ou d'un `Set` ; accesseur d'une classe, objet gelé, champ posé sur une `Map`, qui lisent un objet tenu par
// une autre variable ; accesseur propre à l'objet (posé avant que la variable le reçoive, lit un autre objet) après `µrefresh`, puis
// une seconde écriture sans lui ; objet clé, valeur ou élément d'une `Map` ou d'un `Set` (réglage `proxy: false`) ; champ montré
// champ par champ, bloc piloté par la valeur, boucle qui écrit l'état (la valeur se refait une fois, à sa sortie) ; ligne d'une
// liste écrite champ par champ que lit l'accesseur d'une classe ; `Map` rangée dans un objet, que suit un `µrefresh` écrit une fois.
// Sous l'enveloppe, une collection dont elle suit toutes les entrées n'est pas à risque ; elle le reste quand elle range une fonction
// (lue ou appelée), l'instance d'une classe, un objet gelé, une autre collection qui en range, ou quand c'est une `WeakMap`.
// Puis les écritures elles-mêmes (SCENARIO_ECRITURES) : un calcul refait qui lève, des frappes sans rapport à côté d'une `Date`,
// d'une `URL`, d'une expression régulière, d'un objet du navigateur ou d'une collection (FRAPPES), et ce que relit une écriture servie
// champ par champ (liaisons, lignes d'une liste)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler } from '../../src/bundler/index.js'
import { stripEsm } from '../../src/server/renderToString.js'
import { mjsTmp } from './tmp.js'

// `attendus[0]` : la valeur au montage, puis celle qui suit chaque écriture ; `compte` : calculs de la valeur pendant la première
// écriture (accesseur compté), `gabarit` et `lire` : la vue et la valeur relue quand ce n'est pas `{$v}`
export interface CasHorloge { nom: string, decl: string, expr: string, ecrits: string[], attendus: string[], gabarit?: string, lire?: string, compte?: number }

const CLASSE = 'l = {prix: 2}\n$ligne = l\n$c = window.mk.classe(l)'
const PRIX   = ['$ligne.prix = 10', '$ligne.prix = 20']
const CLE    = ['$cle.prix = 10', '$cle.prix = 20']
const L      = (fab: string) => ['l = {prix: 2}\n$ligne = l\n$p = window.mk.' + fab + '(l)', "[$p.total].join('')", ['$ligne.prix = 10\n  µrefresh($p)', '$ligne.prix = 20', '$ligne.prix = 30\n  µrefresh($p)', '$ligne.prix = 40'], ['6', '30', '60', '90', '120']] as const

export const CAS: CasHorloge[] = [
  { nom: 'fonction-cle', decl: 'f = window.fnNom()\n$f = f\n$m = new Map([[f, 1]])', expr: "[...$m].map((e) -> e[0].nom).join(',')", ecrits: ["$f.nom = 'z'", "$f.nom = 'y'"], attendus: ['a', 'z', 'y'] },
  { nom: 'fonction-valeur', decl: "f = window.fnNom()\n$f = f\n$m = new Map([['a', f]])", expr: "[...$m].map((e) -> e[1].nom).join(',')", ecrits: ["$f.nom = 'z'", "$f.nom = 'y'"], attendus: ['a', 'z', 'y'] },
  { nom: 'fonction-element', decl: 'f = window.fnNom()\n$f = f\n$s = new Set([f])', expr: "[...$s].map((g) -> g.nom).join(',')", ecrits: ["$f.nom = 'z'", "$f.nom = 'y'"], attendus: ['a', 'z', 'y'] },
  { nom: 'accesseur-classe', decl: CLASSE, expr: "[$c.total].join('')", ecrits: PRIX, attendus: ['6', '30', '60'] },
  { nom: 'objet-gele', decl: 'l = {prix: 2}\n$ligne = l\n$g = window.mk.lib(l)', expr: "[$g.ligne.prix].join('')", ecrits: PRIX, attendus: ['2', '10', '20'] },
  { nom: 'champ-de-map', decl: 'l = {prix: 2}\n$ligne = l\n$m = window.mapChamp(l)', expr: "[$m.meta.prix].join('')", ecrits: PRIX, attendus: ['2', '10', '20'] },
  ...(['limite', 'litteral'] as const).map((fab) => { const [decl, expr, ecrits, attendus] = L(fab); return { nom: 'accesseur-' + fab, decl, expr, ecrits: [...ecrits], attendus: [...attendus] } }),
  { nom: 'accesseur-copie', decl: 'l = {items: [1]}\n$autreL = l\n$p = window.mk.limiteCopie(l)', expr: "$p.liste.join(',')", ecrits: ['$autreL.items.push(2)\n  µrefresh($p)', '$autreL.items.push(3)', '$autreL.items.push(4)\n  µrefresh($p)', '$autreL.items.push(5)'], attendus: ['1', '1,2', '1,2,3', '1,2,3,4', '1,2,3,4,5'] },
  { nom: 'cle-objet', decl: 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', expr: "[...$m.keys()].map((x) -> x.prix).join(',')", ecrits: CLE, attendus: ['2', '10', '20'] },
  { nom: 'entree-objet', decl: 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', expr: "[...$m.entries()].map((e) -> e[0].prix).join(',')", ecrits: CLE, attendus: ['2', '10', '20'] },
  { nom: 'paire-objet', decl: 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', expr: "[...$m].map((e) -> e[0].prix).join(',')", ecrits: CLE, attendus: ['2', '10', '20'] },
  { nom: 'valeur-objet', decl: "l = {prix: 2}\n$ligne = l\n$m = new Map([['a', l]])", expr: "[...$m.values()].map((x) -> x.prix).join(',')", ecrits: PRIX, attendus: ['2', '10', '20'] },
  { nom: 'element-objet', decl: 'l = {prix: 2}\n$ligne = l\n$s = new Set([l])', expr: "[...$s].map((x) -> x.prix).join(',')", ecrits: PRIX, attendus: ['2', '10', '20'] },
  { nom: 'cle-rafraichie', decl: 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', expr: "[...$m].map((e) -> e[0].prix).join(',')", ecrits: ['$cle.prix = 10\n  µrefresh($m)', '$cle.prix = 20'], attendus: ['2', '10', '20'] },
  { nom: 'champ-montre', decl: CLASSE, expr: "[$c.total].join('')", ecrits: PRIX, attendus: ['6', '30', '60'], gabarit: '<p class="v">{$v}</p><p class="f">{$ligne.prix}</p>' },
  { nom: 'bloc', decl: CLASSE, expr: "[$c.total].join('')", ecrits: PRIX, attendus: ['autre', 'trente', 'autre'], gabarit: "<p class=\"v\">{if $v is '30'}trente{else}autre{end}</p>", lire: "(if $v is '30' then 'trente' else 'autre')" },
  { nom: 'boucle', decl: CLASSE, expr: "[$c.total].join('')", ecrits: ['for i in [1..3]\n    $ligne.prix = i * 10'], attendus: ['6', '90'], compte: 1 },
  { nom: 'fin-classe-lue', decl: "l = [{label: 'a'}, {label: 'b'}]\n$rows = l\n$c = window.mk.etiquettes(l)", expr: "[$c.total].join('')", ecrits: ["$rows[1].label = 'x'", "$rows[0].label = 'y'"], attendus: ['ab', 'ax', 'yx'], gabarit: '<p class="v">{$v}</p><ul>{for r in $rows}<li>{r.label}</li>{end}</ul>' },
  { nom: 'imbrique-rafraichi', decl: 'f = window.fnNom()\n$f = f\n$d = {m: new Map([[f, 1]])}', expr: "[...$d.m].map((e) -> e[0].nom).join(',')", ecrits: ["$f.nom = 'z'\n  µrefresh($d)", "$f.nom = 'y'", "$f.nom = 'x'"], attendus: ['a', 'z', 'y', 'x'] },
  { nom: 'fonction-appelee', decl: "l = {prix: 2}\n$ligne = l\n$m = new Map([['total', () -> l.prix * 3]])", expr: "[$m.get('total')()].join('')", ecrits: PRIX, attendus: ['6', '30', '60'] },
  { nom: 'instance-rangee', decl: "l = {prix: 2}\n$ligne = l\n$m = new Map([['a', window.mk.classe(l)]])", expr: "[...$m.values()].map((c) -> c.total).join(',')", ecrits: PRIX, attendus: ['6', '30', '60'] },
  { nom: 'gele-range', decl: 'l = {prix: 2}\n$ligne = l\n$s = new Set([window.mk.lib(l)])', expr: "[...$s].map((g) -> g.ligne.prix).join(',')", ecrits: PRIX, attendus: ['2', '10', '20'] },
  { nom: 'fonction-map-de-map', decl: "f = window.fnNom()\n$f = f\n$mm = new Map([['a', new Map([[f, 1]])]])", expr: "[...$mm.get('a')].map((e) -> e[0].nom).join(',')", ecrits: ["$f.nom = 'z'", "$f.nom = 'y'"], attendus: ['a', 'z', 'y'] },
  { nom: 'valeur-weakmap', decl: 'k = window.fnNom()\nl = {prix: 2}\n$ligne = l\n$wm = new WeakMap([[k, l]])', expr: "[$wm.get(k).prix].join('')", ecrits: PRIX, attendus: ['2', '10', '20'] },
  { nom: 'fonction-weakmap', decl: 'k = {}\nf = window.fnNom()\n$f = f\n$wm = new WeakMap([[k, f]])', expr: "[$wm.get(k).nom].join('')", ecrits: ["$f.nom = 'z'", "$f.nom = 'y'"], attendus: ['a', 'z', 'y'] },
  // l'entrée d'une collection qui refuse d'être regardée (Proxy de l'application dont un piège lève) : l'écriture d'une autre variable va au bout
  { nom: 'entree-qui-refuse', decl: "l = {prix: 2}\n$ligne = l\n$m = new Map([['a', window.refus()]])", expr: "[$m.size].join('')", ecrits: PRIX, attendus: ['1', '1', '1'] }
]

export const PAGE = `window.__W = []; window.__E = [];
window.__calc = 0;
window.nReq = 0; window.requete = (x) => { window.nReq += 1; return 'r' + window.nReq };
window.lignes = (n) => Array.from({ length: n }, (_, i) => ({ label: 'l' + i }));
window.fnNom = () => { const f = () => 1; f.nom = 'a'; return f };
window.mk = {
  limite: (l) => Object.defineProperty({}, 'total', { get() { return l.prix * 3 }, enumerable: true }),
  litteral: (l) => ({ get total() { return l.prix * 3 } }),
  limiteCopie: (l) => Object.defineProperty({}, 'liste', { get() { return l.items.slice() }, enumerable: true }),
  classe: (l) => new (class { get total() { window.__calc++; return l.prix * 3 } })(),
  lib: (l) => Object.freeze({ ligne: l, nom: 'x' }),
  etiquettes: (l) => new (class { get total() { window.__calc++; return l.map((r) => r.label).join('') } })()
};
window.mapChamp = (l) => { const m = new Map(); m.meta = l; return m };
window.sousMap = () => new (class extends Map { get total() { return 1 } })();
window.refus = () => new Proxy({}, { getPrototypeOf() { throw new Error('refus') } });
(function () {
  var w = console.warn;
  console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); return w.apply(console, arguments); };
  var e = console.error;
  console.error = function () { window.__E.push(Array.prototype.map.call(arguments, (x) => x && x.message ? x.message : String(x)).join(' ').slice(0, 160)); return e.apply(console, arguments); };
  window.addEventListener('error', (ev) => { window.__E.push('onerror ' + String(ev.message).slice(0, 160)); });
})();`

function source(c: CasHorloge): string {
  const ecrits = c.ecrits.map((w, i) => '@w' + (i + 1) + ' = ->\n  ' + w + '\n').join('')
  return '<script>\n' + c.decl + '\n$v = ' + c.expr + '\n' + ecrits + '@lire = -> ' + (c.lire || 'String($v)') + '\n</script>\n' + (c.gabarit || '<p class="v">{$v}</p>') + '\n'
}

// chaque cas monté, puis ses écritures une à une : l'écran et la valeur relue après chacune (une pause laisse passer un rendu en
// microtâche) ; les avertissements de cycle d'une relecture faite pendant l'écriture
export const SCENARIO = `(async () => {
  const CAS = ${JSON.stringify(CAS.map((c) => ({ nom: c.nom, n: c.ecrits.length, compte: c.compte !== void 0 })))}
  const pause = (ms = 60) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const ecran = (el) => el._shadow.querySelector('.v').textContent
  const lire = (el) => { try { return String(el.lire()) } catch (e) { return 'ERREUR ' + e.message } }
  const els = {}
  for (const c of CAS) els[c.nom] = document.body.appendChild(document.createElement('mjs-horloge-' + c.nom))
  for (const c of CAS) await attendre(() => els[c.nom]._shadow?.querySelector('.v'))
  await pause(100)
  const R = {}
  for (const c of CAS) {
    const el = els[c.nom], r = { e: [ecran(el)], l: [lire(el)] }
    for (let i = 1; i <= c.n; i++) {
      const avant = window.__calc
      try { el['w' + i]() } catch (e) { r.err = e.message }
      await pause()
      if (c.compte && i === 1) r.n = window.__calc - avant
      r.e.push(ecran(el))
      r.l.push(lire(el))
    }
    R[c.nom] = r
  }
  R.W = window.__W.filter((w) => w.includes('Cycle'))
  return R
})()`

// écarts au résultat attendu, une ligne par cas : l'écran et la valeur relue après chaque écriture
export function ecarts(r: any): string[] {
  const out: string[] = []
  for (const c of CAS) {
    const x = r[c.nom] || {}
    if (JSON.stringify(x.e) !== JSON.stringify(c.attendus) || JSON.stringify(x.l) !== JSON.stringify(c.attendus) || x.err || (c.compte !== void 0 && x.n !== c.compte)) {
      out.push(c.nom + ' : écran ' + JSON.stringify(x.e) + ', relu ' + JSON.stringify(x.l) + ', attendu ' + JSON.stringify(c.attendus) + (c.compte !== void 0 ? ', calculs ' + x.n + ' (attendu ' + c.compte + ')' : '') + (x.err ? ', erreur ' + x.err : ''))
    }
  }
  if (r.W && r.W.length) out.push('avertissements : ' + JSON.stringify(r.W))
  return out
}

// composants des écritures : `@w(i, x)` écrit la ligne `i` d'une liste de 50, le champ `a` d'un objet montré champ par champ, ou
// un champ de formulaire ; `$v` une valeur à l'horloge (à la compilation, ou passée à l'horloge en route) qui lit autre chose
const LIGNES   = '$rows = window.lignes(50)\n@w = (i, x) -> $rows[i].label = x\n'
const CHAMPS   = '$o = {a: 1, b: 2, c: 3, d: 4, e: 5}\n@w = (i, x) -> $o.a = x\n'
const CLASSE_V = "l = {prix: 2}\n$ligne = l\n$c = window.mk.classe(l)\n$v = [$c.total].join('')\n"
const OBJET_V  = "$o2 = {a: 1}\n$v = [$o2.a].join('')\n"
const VUE_L    = '<p class="v">{$v}</p>\n<ul>{for r in $rows}<li>{r.label}</li>{end}</ul>\n'
const VUE_C    = '<p class="v">{$v}</p><p class="o">{$o.a} {$o.b} {$o.c} {$o.d} {$o.e}</p>\n'
const FRAPPE   = (x: string) => "<script>\n$x = " + x + "\n$v = window.requete($x)\n$form = {q: ''}\n@w = (i, x) -> $form.q = x\n</script>\n<p class=\"v\">{$v}</p><p class=\"q\">{$form.q}</p>\n"

// deux frappes sans rapport à côté d'une valeur qui fait une requête et lit `$x` : `jamais`, ce que MJS suit ou qui ne tient aucun objet
// du composant (aucune requête refaite, tous modes) ; `suivies`, les collections dont l'enveloppe suit toutes les entrées (aucune sous
// l'enveloppe, une par frappe avec le réglage `proxy: false`) ; `risque`, ce qui peut cacher une lecture (une par frappe, tous modes)
export const FRAPPES = {
  jamais: { date: 'new Date(0)', url: "new URL('http://a.test/')", regexp: '/a/', dataset: "document.createElement('div').dataset", attributs: "document.createElement('div').attributes" },
  suivies: { map: "new Map([['a', 1]])", 'map-objets': 'new Map([[{k: 1}, {v: 1}]])', set: 'new Set([1, {a: 1}])', weakset: 'new WeakSet([{}])', 'map-de-map': "new Map([['a', new Map([['b', {v: 1}]])]])" },
  risque: { weakmap: 'new WeakMap()', 'map-fonction': "new Map([['a', window.fnNom()]])", 'set-fonction': 'new Set([window.fnNom()])', 'map-champ': 'window.mapChamp({prix: 2})', 'map-instance': "new Map([['a', window.mk.classe({prix: 2})]])", 'set-gele': 'new Set([window.mk.lib({prix: 2})])', 'map-de-map-fonction': "new Map([['a', new Map([[window.fnNom(), 1]])]])", 'sous-classe': 'window.sousMap()', 'map-brute': "µraw(new Map([['a', 1]]))" }
}
const FORMES: Record<string, string> = { ...FRAPPES.jamais, ...FRAPPES.suivies, ...FRAPPES.risque }

export const ECRITURES: Record<string, string> = {
  'horloge-leve-ordinaire': "<script>\n$n = 'a'\n$v = [$n.toUpperCase()].join('')\n@w1 = ->\n  $n = null\n  window.__apres1 = 1\n</script>\n<p class=\"v\">{$v}</p>\n",
  'horloge-leve-cache': "<script>\nf = window.fnNom()\n$f = f\n$s = new Set([f])\n$v = [...$s].map((g) -> g.nom.toUpperCase()).join(',')\n@w1 = ->\n  $f.nom = null\n  window.__apres2 = 1\n</script>\n<p class=\"v\">{$v}</p>\n",
  ...Object.fromEntries(Object.entries(FORMES).map(([n, x]) => ['horloge-frappe-' + n, FRAPPE(x)])),
  'horloge-fin-sans': '<script>\n' + LIGNES + '</script>\n' + VUE_L.replace('{$v}', 'x'),
  'horloge-fin-classe': '<script>\n' + CLASSE_V + LIGNES + '</script>\n' + VUE_L,
  'horloge-fin-objet': '<script>\n' + OBJET_V + LIGNES + '</script>\n' + VUE_L,
  'horloge-fin-lue': "<script>\nl = window.lignes(50)\n$rows = l\n$c = window.mk.etiquettes(l)\n$v = [$c.total].join('')\n@w = (i, x) -> $rows[i].label = x\n@lire = -> String($v)\n</script>\n" + VUE_L,
  'horloge-champ-sans': '<script>\n' + CHAMPS + '</script>\n' + VUE_C.replace('{$v}', 'x'),
  'horloge-champ-classe': '<script>\n' + CLASSE_V + CHAMPS + '</script>\n' + VUE_C,
  'horloge-champ-objet': '<script>\n' + OBJET_V + CHAMPS + '</script>\n' + VUE_C
}

// les écritures : un calcul refait qui lève (écriture ordinaire, puis cachée), deux frappes sans rapport (requêtes faites, écran), ce
// que relit une écriture d'un champ (liaisons appelées `n`, lignes d'une liste relues `r`, calculs de l'accesseur compté)
export const SCENARIO_ECRITURES = `(async () => {
  const pause = (ms = 60) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const monter = async (t) => { const el = document.body.appendChild(document.createElement('mjs-horloge-' + t)); await attendre(() => el._shadow?.querySelector('.v')); await pause(80); return el }
  const R = { leve: {}, frappe: {}, cout: {} }
  for (const nom of ['leve-ordinaire', 'leve-cache']) {
    const el = await monter(nom)
    window.__E.length = 0
    let err = null
    try { el.w1() } catch (e) { err = String(e && e.message) }
    await pause()
    R.leve[nom] = { err, apres: (nom === 'leve-ordinaire' ? window.__apres1 : window.__apres2) || 0, crash: !!el._mjs_has_crashed, erreurs: window.__E.length }
  }
  for (const nom of ${JSON.stringify(Object.keys(FORMES))}) {
    const el = await monter('frappe-' + nom), req0 = window.nReq, avant = el._shadow.querySelector('.v').textContent
    el.w(0, 'a')
    await pause()
    el.w(0, 'b')
    await pause()
    R.frappe[nom] = { requetes: window.nReq - req0, ecranGarde: el._shadow.querySelector('.v').textContent === avant, q: el._shadow.querySelector('.q').textContent }
  }
  const compter = (el) => {
    const box = { n: 0, r: 0 }, vus = new Map()
    const w = (f) => { if (typeof f !== 'function') return f; if (!vus.has(f)) { const g = function () { box.n++; return f.apply(this, arguments) }; vus.set(f, g) } return vus.get(f) }
    const enPlace = (a) => { if (Array.isArray(a)) for (let i = 0; i < a.length; i++) a[i] = w(a[i]) }
    const ebv = el._mjs_effectsByVar || {}
    for (const k in ebv) enPlace(ebv[k])
    const fine = el._mjs_fine || {}
    for (const k in fine) { const fv = fine[k]; if (fv && fv.f) for (const c in fv.f) enPlace(fv.f[c]); if (fv) enPlace(fv.d) }
    const caches = el._mjs_list_cache || {}
    for (const id in caches) { const c = caches[id]; if (c && c.forEach) c.forEach((en) => { if (en && en._mjs_updFn) { const f = en._mjs_updFn; en._mjs_updFn = function () { box.r++; return f.apply(this, arguments) } } }) }
    return box
  }
  for (const nom of ['fin-sans', 'fin-classe', 'fin-objet', 'fin-lue', 'champ-sans', 'champ-classe', 'champ-objet']) {
    const el = await monter(nom), box = compter(el), c0 = window.__calc
    el.w(3, 'x')
    await pause()
    const vue = el._shadow.querySelectorAll('li')[3]?.textContent ?? el._shadow.querySelector('.o')?.textContent
    R.cout[nom] = { n: box.n, r: box.r, calculs: window.__calc - c0, fine: !!el._mjs_fine, vue, ecran: el._shadow.querySelector('.v').textContent, lu: el.lire ? String(el.lire()) : null }
  }
  return R
})()`

// ce que relit une écriture de champ à côté d'une valeur à l'horloge, comme sans elle (`fin-lue` : la valeur qui lit la ligne écrite se
// redessine, une liaison) ; production : les champs internes comptés sont renommés, l'écran seul se compare
export function coutsVus(r: any, dev: boolean): { vu: Record<string, any>, attendu: Record<string, any> } {
  const attendu: Record<string, any> = {
    'fin-sans': { n: 0, r: 1, fine: true, vue: 'x' },
    'fin-classe': { n: 0, r: 1, fine: true, vue: 'x' },
    'fin-objet': { n: 0, r: 1, fine: true, vue: 'x' },
    'fin-lue': { n: 1, r: 1, fine: true, vue: 'x' },
    'champ-sans': { n: 1, r: 0, fine: true, vue: 'x 2 3 4 5' },
    'champ-classe': { n: 1, r: 0, fine: true, vue: 'x 2 3 4 5' },
    'champ-objet': { n: 1, r: 0, fine: true, vue: 'x 2 3 4 5' }
  }
  const vu: Record<string, any> = {}
  for (const nom in r.cout) vu[nom] = dev ? { n: r.cout[nom].n, r: r.cout[nom].r, fine: r.cout[nom].fine, vue: r.cout[nom].vue } : { vue: r.cout[nom].vue }
  if (!dev) for (const nom in attendu) attendu[nom] = { vue: attendu[nom].vue }
  return { vu, attendu }
}

// requêtes refaites par deux frappes sans rapport, forme par forme : attendu selon le mode (cf. FRAPPES)
export function frappesAttendues(mode: string): Record<string, number> {
  const n: Record<string, number> = {}
  for (const nom in FRAPPES.jamais) n[nom] = 0
  for (const nom in FRAPPES.suivies) n[nom] = mode.startsWith('proxy false') ? 2 : 0
  for (const nom in FRAPPES.risque) n[nom] = 2
  return n
}
export function frappesVues(r: any): Record<string, number> {
  return Object.fromEntries(Object.keys(FORMES).map((nom) => [nom, r.frappe[nom].requetes]))
}

// écarts des écritures au résultat attendu, une ligne par écart (les navigateurs ; happy-dom les vérifie un à un)
export function ecartsEcritures(r: any, mode: string): string[] {
  const out: string[] = [], o = r.leve['leve-ordinaire'], dev = !mode.endsWith('production')
  if (o.err !== null || o.apres !== 1 || dev && !o.crash) out.push('écriture ordinaire qui lève : ' + JSON.stringify(o))
  if (JSON.stringify(r.leve['leve-cache']) !== JSON.stringify(o)) out.push('écriture qui fait lever une valeur à l\'horloge : ' + JSON.stringify(r.leve['leve-cache']))
  const attendues = frappesAttendues(mode)
  for (const nom in attendues) if (JSON.stringify(r.frappe[nom]) !== JSON.stringify({ requetes: attendues[nom], ecranGarde: attendues[nom] === 0, q: 'b' })) out.push('frappes à côté de ' + nom + ' (' + attendues[nom] + ' requête attendue) : ' + JSON.stringify(r.frappe[nom]))
  if (!mode.startsWith('horloge')) {
    const { vu, attendu } = coutsVus(r, dev), f = r.cout['fin-lue']
    if (JSON.stringify(vu) !== JSON.stringify(attendu)) out.push('écriture de champ : ' + JSON.stringify(vu))
    if (f.ecran !== f.lu) out.push('ligne lue par une classe : écran ' + f.ecran + ', relu ' + f.lu)
  }
  return out
}

export const MODES = ['enveloppe développement', 'enveloppe production', 'proxy false développement', 'proxy false production', 'horloge développement']

export async function construire(mode: string, extra: Record<string, string> = {}): Promise<{ code: string, sortie: string }> {
  const prod   = mode.endsWith('production')
  const root   = mjsTmp('horloge-ecran')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const c of CAS) writeFileSync(join(srcDir, 'horloge-' + c.nom + '.mjs'), source(c))
  for (const [n, t] of Object.entries(extra)) writeFileSync(join(srcDir, n + '.mjs'), t)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  if (mode.startsWith('proxy false')) opts.proxy = false
  // `derived: "clock"` : toutes les valeurs dérivées à l'horloge, le cœur sans la précision
  if (mode.startsWith('horloge')) opts.derivedMode = 'clock'
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const sortie = files.filter((f) => !f.startsWith('mjs_')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  return { code, sortie }
}
