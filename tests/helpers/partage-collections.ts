// composants, scénario et valeurs attendues partagés par derive-precise-classe-prototype-map-set-donnee-ecrite-par-mjs (happy-dom)
// et derive-precise-classe-prototype-map-set-ecran-browser (Chromium, Firefox, WebKit) : une `Map` ou un `Set` qui tient des objets
// de l'état sous leur enveloppe (`new Set([$rows[0]])`, `new Map([[$rows[0], 1]])` faits dans un composant ou un magasin), rangé dans
// l'état, reste la MÊME collection — choisi dans une liste, donné à deux enfants, tenu par un magasin et un composant, par deux
// composants, gardé dans une variable sans `$` puis signalé par `µrefresh`, rangé dans un objet, avec ses champs et son gel :
// l'écriture faite par l'un se voit de tous, une seule entrée par objet, aucun recalcul quand on range la même ; `WeakMap` et
// `WeakSet` de l'état retrouvent l'entrée par la clé enveloppée comme par la brute (`get`, `has`, `set`, `delete`, `add`), et la
// valeur sortie de `get` est enveloppée : une écriture faite à travers elle fait suivre l'écran — dans un composant, `µ.state` et
// `µ.Store` ; une bibliothèque qui appelle leurs méthodes natives (`WeakMap.prototype.get.call(…)`) reçoit la vraie collection de `µraw`
export const PAGE_PARTAGE = `window.__W = []; window.__C = 0; window.compte = (x) => { window.__C++; return x }; window.partage = null;
(function () {
  var w = console.warn;
  console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); return w.apply(console, arguments); };
})();`
const SEL = (l: string, n: string) => `@choisir = -> $sel = ${l}[0]\n@lire = -> [String(${l}.indexOf($sel)), String(${l}[0] is $sel), String(${l}[0].${n}), String($sel.${n})].join('/')\n</script>\n<p class="v">{${l}[0].${n}}</p>\n`
export const PARTAGE: Record<string, string> = {
  'pa-sel': `<script>\n$rows = [{nom: 'a'}, {nom: 'bb'}]\ng0 = new Set([$rows[0]])\n$groupes = [g0, new Set()]\n$sel = null\n@ajouter = -> $sel.add($rows[1])\n${SEL('$groupes', 'size')}`,
  'pa-selm': `<script>\n$rows = [{nom: 'a'}, {nom: 'bb'}]\nf0 = new Map([[$rows[0], 'x']])\n$fiches = [f0]\n$sel = null\n@ajouter = -> $sel.set($rows[1], 'y')\n${SEL('$fiches', 'size')}`,
  'pa-parent': `<script>\n$rows = [{nom: 'a'}, {nom: 'bb'}]\nm0 = new Map([[$rows[0], 1]])\n$o = {m: m0, t: 0}\n@lire = -> [...$o.m.values()].join(',') + '/' + String($o.m.size)\n@toucher = -> $o.t += 1\n</script>\n<p class="v">{[...$o.m.values()].join(',')}</p><@pa-enfant m={$o.m}></@pa-enfant><@pa-enfant m={$o.m}></@pa-enfant>\n`,
  'pa-enfant': `<script>\n$m = null\n@ecrire = ->\n  k = [...$m.keys()][0]\n  $m.set(k, 7)\n@lire = -> (if $m then [...$m.values()].join(',') + '/' + String($m.size) else '-')\n</script>\n<p class="v">{if $m}{[...$m.values()].join(',')}{end}</p>\n`,
  'pa-deep': `<script>\n$rows = [{nom: 'a'}, {nom: 'bb'}]\nmap = new Map([[$rows[0], 1]])\nlit = new Map([[$rows[0], 1]])\n$o = {m: null}\n$p = {m: lit}\n@poser = -> $o.m = map\n@ecrire = ->\n  $o.m.set($rows[1], 2)\n  $p.m.set($rows[1], 2)\n@lire = -> [String($o.m.size), String(map.size), String($p.m.size), String(lit.size), String($o.m.get($rows[0])), String($o.m.get($rows[1]))].join('/')\n</script>\n<p class="v">-</p>\n`,
  'pa-store': `<script>\ns = new µ.Store({rows: [{nom: 'a'}, {nom: 'bb'}], sel: null}).data\nsel = new Set([s.rows[0]])\ns.sel = sel\n$sel = sel\n@ecrire = -> $sel.add(s.rows[1])\n@lire = -> String(s.sel.size) + '/' + String($sel.size) + '/' + String(sel.size)\n</script>\n<p class="v">{$sel.size}</p>\n`,
  'pa-a': `<script>\n$rows = [{nom: 'a'}]\nwindow.partage = new Map([[$rows[0], 1]])\n$m = window.partage\n@ecrire = -> $m.set([...$m.keys()][0], 9)\n@lire = -> [...$m.values()].join(',')\n</script>\n<p class="v">{[...$m.values()].join(',')}</p>\n`,
  'pa-b': `<script>\n$m = window.partage\n@lire = -> [...$m.values()].join(',') + '/' + [...window.partage.values()].join(',')\n</script>\n<p class="v">{[...$m.values()].join(',')}</p>\n`,
  'pa-lib': `<script>\nr1 = {nom: 'bb'}\n$rows = [{nom: 'a'}, r1]\nlib = new Map([[$rows[0], 1]])\n$m = lib\n$v = $m.size\n@ecrire = ->\n  a = $m.has(r1)\n  lib.set($rows[1], 2)\n  µrefresh($m)\n  [String(a), String($m.size), String(lib.size), String($m.get(r1)), String($m.has(r1))].join('/')\n</script>\n<p class="v">{$v}</p>\n`,
  'pa-meta': `<script>\n$rows = [{nom: 'a'}]\nm = new Map([[$rows[0], 1]])\nm.titre = 'T'\n$m = m\nf = Object.freeze(new Set([$rows[0]]))\n$f = f\n@lire = -> String($m.titre) + '/' + String(Object.isFrozen($f))\n</script>\n<p class="v">{$m.titre}</p>\n`,
  'pa-deux': `<script>\n$rows = [{nom: 'a'}, {nom: 'bb'}]\nm = new Map([[$rows[0], 1]])\n$a = m\n$b = m\n@ecrire = -> $a.set($rows[0], 5)\n@lire = -> [String($b.get($rows[0])), String($a.get($rows[0])), String($a is $b), String(m.get($rows[0])), String(m.size)].join('/')\n</script>\n<p class="v">{$b.get($rows[0])}</p>\n`,
  'pa-reaff': `<script>\n$rows = [{nom: 'a'}]\nm = new Map([[$rows[0], 1]])\n$m = m\n$v = window.compte($m.size)\n@reaff = ->\n  $m = m\n  $m = m\n  $m = m\n</script>\n<p class="v">{$v}</p>\n`,
  'pa-formes': `<script>\nr = {nom: 'a'}\n$rows = [r]\nm = new Map([[r, 1], [$rows[0], 2]])\n$m = m\n@lire = -> String($m.size) + '/' + String($m.get(r))\n</script>\n<p class="v">{$m.size}</p>\n`,
  'pa-weak': `<script>\nr0 = {nom: 'a'}\nr1 = {nom: 'bb'}\n$rows = [r0, r1]\nwm = new WeakMap([[r0, {prix: 2}]])\nws = new WeakSet([r0])\n$wm = wm\n$ws = ws\n$v = String($wm.get($rows[0])?.prix) + '/' + String($ws.has($rows[0]))\n@lire = -> [String($wm.get($rows[0])?.prix), String($wm.has($rows[0])), String($ws.has($rows[0])), String($wm.get(r0)?.prix), String($ws.has(r0))].join('/')\n@ecrire = ->\n  $wm.set($rows[1], {prix: 3})\n  $ws.add($rows[1])\n  [String(wm.get(r1)?.prix), String(ws.has(r1)), String($wm.get($rows[1])?.prix), String($ws.has($rows[1]))].join('/')\n@prix = -> $wm.get($rows[0]).prix = 10\n@suppr = -> [String($wm.delete($rows[0])), String($ws.delete($rows[0])), String(wm.has(r0)), String(ws.has(r0))].join('/')\n</script>\n<p class="v">{$v}</p>\n`,
  'pa-wetat': `<script>\nr0 = {nom: 'a'}\n$rows = [r0]\nst = µ.state({wm: new WeakMap(), ws: new WeakSet()})\nsto = new µ.Store({wm: new WeakMap(), ws: new WeakSet()}).data\n@ecrire = ->\n  st.wm.set($rows[0], {prix: 1})\n  st.ws.add($rows[0])\n  sto.wm.set($rows[0], {prix: 2})\n  sto.ws.add($rows[0])\n@lire = -> [String(st.wm.get(r0)?.prix), String(st.wm.get($rows[0])?.prix), String(st.ws.has(r0)), String(st.ws.has($rows[0])), String(sto.wm.get(r0)?.prix), String(sto.wm.get($rows[0])?.prix), String(sto.ws.has(r0)), String(sto.ws.has($rows[0]))].join('/')\n@prix = ->\n  st.wm.get($rows[0]).prix = 5\n  sto.wm.get(r0).prix = 6\n@suppr = -> [String(st.wm.delete(r0)), String(st.ws.delete($rows[0])), String(sto.wm.delete($rows[0])), String(sto.ws.delete(r0)), String(st.wm.has($rows[0])), String(sto.ws.has($rows[0]))].join('/')\n</script>\n<p class="v">{st.wm.get(r0)?.prix}/{sto.wm.get(r0)?.prix}</p>\n`,
  'pa-wlib': `<script>\nr0 = {nom: 'a'}\n$rows = [r0]\nwm = new WeakMap([[r0, 3]])\n$wm = wm\nws = new WeakSet([r0])\n$ws = ws\nst = µ.state({wm: new WeakMap([[r0, 4]])})\nsto = new µ.Store({ws: new WeakSet([r0])}).data\nt = (f) ->\n  try\n    String(f())\n  catch e\n    e.constructor.name\n@direct = -> [t(-> WeakMap.prototype.get.call($wm, r0)), t(-> WeakSet.prototype.has.call($ws, r0)), t(-> WeakMap.prototype.get.call(st.wm, r0)), t(-> WeakSet.prototype.has.call(sto.ws, r0))].join('/')\n@brut = -> [t(-> WeakMap.prototype.get.call(µraw($wm), r0)), t(-> WeakSet.prototype.has.call(µraw($ws), r0)), t(-> WeakMap.prototype.get.call(µraw(st.wm), r0)), t(-> WeakSet.prototype.has.call(µraw(sto.ws), r0)), t(-> µraw($wm) is wm), t(-> WeakMap.prototype.get.call($wm, r0))].join('/')\n</script>\n<p class="v">{$wm.get($rows[0])}</p>\n`
}
const RACINES = ['pa-sel', 'pa-selm', 'pa-parent', 'pa-deep', 'pa-store', 'pa-a', 'pa-b', 'pa-lib', 'pa-meta', 'pa-deux', 'pa-reaff', 'pa-formes', 'pa-weak', 'pa-wetat', 'pa-wlib']
export const SCENARIO_PARTAGE = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const essai = (f) => { try { return String(f()) } catch (e) { return 'ERREUR ' + e.message } }
  const ecran = (el) => essai(() => el._shadow.querySelector('.v').textContent)
  const c = {}
  for (const n of ${JSON.stringify(RACINES)}) { c[n] = document.body.appendChild(document.createElement('mjs-' + n)); await attendre(() => c[n]._shadow?.querySelector('.v')) }
  await pause(100)
  const R = {}
  const pas = async (n, f) => { const r = essai(() => c[n][f]()); await pause(60); return r }
  for (const n of ['pa-sel', 'pa-selm']) { await pas(n, 'choisir'); const a = essai(() => c[n].lire()); await pas(n, 'ajouter'); R[n] = [a, essai(() => c[n].lire()), ecran(c[n])] }
  const par = c['pa-parent'], enfs = [...par._shadow.querySelectorAll('mjs-pa-enfant')]
  await attendre(() => enfs.length === 2 && enfs.every((e) => e._shadow?.querySelector('.v')))
  await pause(60)
  R['pa-parent'] = [essai(() => par.lire())]
  essai(() => enfs[0].ecrire()); await pause(60)
  R['pa-parent'].push(essai(() => par.lire()), essai(() => enfs[0].lire()), essai(() => enfs[1].lire()))
  essai(() => par.toucher()); await pause(60)
  R['pa-parent'].push(essai(() => par.lire()), essai(() => enfs[0].lire()), String(window.__W.some((w) => w.includes('<@pa-enfant>') && w.includes('<@pa-parent>'))))
  await pas('pa-deep', 'poser'); await pas('pa-deep', 'ecrire'); R['pa-deep'] = [essai(() => c['pa-deep'].lire())]
  await pas('pa-store', 'ecrire'); R['pa-store'] = [essai(() => c['pa-store'].lire()), ecran(c['pa-store'])]
  await pas('pa-a', 'ecrire'); R['pa-ab'] = [essai(() => c['pa-a'].lire()), essai(() => c['pa-b'].lire()), ecran(c['pa-a'])]
  R['pa-lib'] = [await pas('pa-lib', 'ecrire'), ecran(c['pa-lib'])]
  R['pa-meta'] = [essai(() => c['pa-meta'].lire()), ecran(c['pa-meta'])]
  R['pa-deux'] = [essai(() => c['pa-deux'].lire())]; await pas('pa-deux', 'ecrire'); R['pa-deux'].push(essai(() => c['pa-deux'].lire()), ecran(c['pa-deux']))
  const c0 = window.__C; await pas('pa-reaff', 'reaff'); R['pa-reaff'] = [String(window.__C - c0), ecran(c['pa-reaff'])]
  R['pa-formes'] = [essai(() => c['pa-formes'].lire())]
  const w = c['pa-weak']
  R['pa-weak'] = [essai(() => w.lire()), ecran(w), await pas('pa-weak', 'ecrire')]
  await pas('pa-weak', 'prix'); R['pa-weak'].push(ecran(w), await pas('pa-weak', 'suppr'), ecran(w))
  const we = c['pa-wetat']
  R['pa-wetat'] = [essai(() => we.lire()), ecran(we)]
  await pas('pa-wetat', 'ecrire'); R['pa-wetat'].push(essai(() => we.lire()), ecran(we))
  await pas('pa-wetat', 'prix'); R['pa-wetat'].push(ecran(we), await pas('pa-wetat', 'suppr'), essai(() => we.lire()), ecran(we))
  R['pa-wlib'] = [await pas('pa-wlib', 'direct'), await pas('pa-wlib', 'brut'), ecran(c['pa-wlib'])]
  return R
})()`
// [choisie, après l'ajout, écran] ; parent : [avant, après l'écriture d'un enfant : parent, enfant, frère ; après une écriture du
// parent : parent, enfant ; avertissement de développement « modifie un objet que … lui a passé »] ; deux composants : [a, b, écran
// de a] ; WeakMap / WeakSet : [lecture, écran, écriture, écran après une écriture par la valeur sortie, retrait, écran] ; ceux de
// µ.state et µ.Store : [lecture, écran, après l'écriture : lecture, écran ; écran après une écriture par la valeur sortie, retrait,
// lecture, écran] ; bibliothèque : [méthode native appelée sur la variable, sur la collection de µraw, puis de nouveau sur la variable,
// qui garde son enveloppe ; écran]
const ATTENDU_PARTAGE: Record<string, string[]> = {
  'pa-sel': ['0/true/1/1', '0/true/2/2', '2'],
  'pa-selm': ['0/true/1/1', '0/true/2/2', '2'],
  'pa-parent': ['1/1', '7/1', '7/1', '7/1', '7/1', '7/1', 'true'],
  'pa-deep': ['2/2/2/2/1/2'],
  'pa-store': ['2/2/2', '2'],
  'pa-ab': ['9', '9/9', '9'],
  'pa-lib': ['false/2/2/2/true', '2'],
  'pa-meta': ['T/true', 'T'],
  'pa-deux': ['1/1/true/1/1', '5/5/true/5/1', '5'],
  'pa-reaff': ['0', '1'],
  'pa-formes': ['2/1'],
  'pa-weak': ['2/true/true/2/true', '2/true', '3/true/3/true', '10/true', 'true/true/false/false', 'undefined/false'],
  'pa-wetat': ['undefined/undefined/false/false/undefined/undefined/false/false', '/', '1/1/true/true/2/2/true/true', '1/2', '5/6', 'true/true/true/true/false/false', 'undefined/undefined/false/false/undefined/undefined/false/false', '/'],
  'pa-wlib': ['TypeError/TypeError/TypeError/TypeError', '3/true/4/true/true/TypeError', '3']
}

// relevé du scénario et ce qu'il doit valoir : l'avertissement de développement ne se dit pas en production. Sans l'enveloppe, l'objet
// n'a qu'une forme (la `Map` de `pa-formes` n'en tient qu'une entrée), et deux relevés ne se comparent pas : l'écran de la liste qui tient la
// collection choisie, après l'ajout fait par `$sel`, et l'écran après l'écriture faite à travers la valeur sortie de `get`, que rien n'enveloppe
export function partage(R: Record<string, string[]>, prod: boolean, proxy: boolean): [Record<string, string[]>, Record<string, string[]>] {
  const attendu = { ...ATTENDU_PARTAGE, 'pa-parent': [...ATTENDU_PARTAGE['pa-parent']] }
  if (prod) attendu['pa-parent'][6] = 'false'
  if (!proxy) {
    attendu['pa-formes'] = ['1/2']
    // la variable d'un composant tient la vraie collection ; µ.state et µ.Store gardent leur enveloppe
    attendu['pa-wlib'] = ['3/true/TypeError/TypeError', '3/true/4/true/true/3', '3']
    for (const [n, i] of [['pa-sel', 2], ['pa-selm', 2], ['pa-weak', 3]] as [string, number][]) {
      R[n]       = R[n].filter((_, j) => j !== i)
      attendu[n] = attendu[n].filter((_, j) => j !== i)
    }
  }
  return [R, attendu]
}
