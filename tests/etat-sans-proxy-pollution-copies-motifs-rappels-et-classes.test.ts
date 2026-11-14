// réglage `proxy: false` : une écriture par un objet de l'état que le compilateur ne suit pas n'atteint jamais `Object`,
// `Object.prototype`, `Array.prototype` ni `Function.prototype`, quand une clé venue de l'extérieur vaut `'constructor'` ou
// `'__proto__'` — copies (`Object.values`, `Object.entries`, `Array.from`, étalement), motifs d'une boucle ou d'un rappel, rappel de
// comparaison de `sort` et `toSorted`, cible d'un motif ou tête d'une boucle, nom lié par `||=`, `??=`, `&&=`, prototype lu par
// `Object.getPrototypeOf`, `||= yield`, `@t` de CoffeeScript, `??=` de Civet, premier argument d'`Object.assign` ; le magasin aussi
// (`map(f)[0]`, rappels de comparaison, `||= yield`) ; avec l'enveloppe, `Object.getPrototypeOf($o).x = v` et le rappel de `sort`.
// Une clé réservée dans la chaîne (`$l.find(f)[k].x = v`) est refusée même quand elle mène à une classe de l'appli ; `constructor`
// écrit dans le code y écrit. L'écriture gardée écrit comme JavaScript (`set` appelé à valeur égale, `-0` gardé) ; un objet refusé
// passé à `Object.assign` & co. est gelé. Aussi : valeur rendue par `pop`, `splice`, `sort`, `reverse` ; accumulateur de `reduce` et
// `reduceRight` sans valeur de départ ; copies par `map`, `flatMap`, `concat`, étalement d'un objet ; `Array.prototype.forEach.call` et
// `find.call` ; `[t] = [$l.find(f)]` ; trois noms liés écrits dans le désordre ; `Reflect.get` ; `?.[k]` et clé calculée d'un motif vers
// une classe de l'appli ; `Object.freeze`, `Object.seal`, `Object.preventExtensions` (deux modes) ; avec l'enveloppe, valeur rendue par
// `pop`, `splice`, `sort`, `reverse`, nom qui reçoit un élément du rappel de `sort`, chaîne qui part de `Object.getPrototypeOf` ; magasin,
// deux modes. Limites hors du test : objet passé à une fonction, valeur rendue par une fonction, objet littéral, expression à virgule,
// valeur attendue. Joué dans happy-dom (production et développement), puis dans Chromium, Firefox et WebKit (les deux modes)

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { charger } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const TACHES = '[{ id: 1, n: 0 }, { id: 2, n: 0 }]'
const F1     = '((t) => t.id == 1)'

// chaque forme, une méthode `(k, v)` : `k` vaut `'constructor'` puis `'__proto__'`, `v` vaut 1
const FORMES_JS: Record<string, string> = {
  ref:         `$taches.find${F1}[k].polluK = v`,
  oValeurs:    'Object.values($taches)[0][k].polluK = v',
  oValeursO:   'Object.values($o)[0][k].polluK = v',
  oEntrees:    'Object.entries($o)[0][1][k].polluK = v',
  etale:       '[...$taches][0][k].polluK = v',
  depuis:      'Array.from($taches)[0][k].polluK = v',
  carte:       '$taches.map((t) => t)[0][k].polluK = v',
  optPousse:   '$listes.find((l) => l.length)?.[k].push(v)',
  optEfface:   `delete $taches.find${F1}?.[k].polluD`,
  pourMotif:   'for (const { constructor: c } of $taches) { c.polluK = v; break; }',
  pourEntr:    'for (const [i, t] of $taches.entries()) { t[k].polluK = v; break; }',
  pourValO:    'for (const t of Object.values($o)) { t[k].polluK = v; break; }',
  rappelMotif: '$taches.forEach(({ constructor: c }) => { c.polluK = v; })',
  rappelTri:   '$taches.toSorted((a, b) => { a[k].polluK = v; return 0; })',
  motifAff:    `[$taches.find${F1}[k].polluK] = [v]`,
  motifObj:    `({ a: $taches.find${F1}[k].polluK } = { a: v })`,
  pourTete:    `for ($taches.find${F1}[k].polluK of [v]);`,
  ctorPousse:  '$listes.find((l) => l.length).constructor.prototype.push(v)',
  assignVal:   'Object.assign(Object.values($taches)[0][k], { polluK: v })',
  defProp:     `Object.defineProperty($taches.find${F1}[k], 'polluK', { value: v, configurable: true, writable: true })`,
  reflSet:     `Reflect.set($taches.find${F1}[k], 'polluK', v)`,
  protoDe:     `Object.getPrototypeOf($taches.find${F1}).polluK = v`,
  protoDeR:    'Reflect.getPrototypeOf($o).polluK = v',
  protoVar:    'const p = Object.getPrototypeOf($o); p.polluK = v',
  ouAff:       'let t; t ??= $taches.find((x) => x.id == 1); t[k].polluK = v',
  ouOu:        'let t = null; t ||= $taches.find((x) => x.id == 1); t[k].polluK = v',
  etEt:        'let t = 1; t &&= $taches.find((x) => x.id == 1); t[k].polluK = v',
  attenteVar:  'const t = await $taches.find((x) => x.id == 1); t[k].polluK = v',
  seq:         'const t = (0, $taches.find((x) => x.id == 1)); t[k].polluK = v',
  objLit:      'const o = { t: $taches.find((x) => x.id == 1) }; o.t[k].polluK = v',
  fnRet:       'const g = () => $taches.find((x) => x.id == 1); g()[k].polluK = v',
  fonction:    'const ecrire = (o) => { o[k].polluK = v; }; ecrire($taches.find((x) => x.id == 1))',
  yieldEg:     `$taches.find${F1}[k].polluK = yield v`,
  yieldOu:     `$taches.find${F1}[k].polluK ||= yield v`,
  sortCb:      '$taches.sort((a, b) => { a[k].polluK = v; return 0; })',
  reduce:      '$taches.reduce((acc, t) => { t[k].polluK = v; return acc; }, 0)',
  bonValeurs:  'Object.values($taches)[0].n = v',
  reduceSansInit: '$taches.reduce((a, t) => { a[k].polluK = v; return a; })',
  reduceDroite:   '$taches.reduceRight((a, t) => { a[k].polluK = v; return a; })',
  carteVar:       'const c = $taches.map((t) => t); c[0][k].polluK = v',
  flatVar:        'const c = $taches.flatMap((t) => [t]); c[0][k].polluK = v',
  carteRappel:    '$taches.map((t) => t).forEach((t) => { t[k].polluK = v; })',
  appelCall:      'Array.prototype.forEach.call($taches, (t) => { t[k].polluK = v; })',
  findCall:       `Array.prototype.find.call($taches, ${F1})[k].polluK = v`,
  motifTab:       `let t; [t] = [$taches.find${F1}]; t[k].polluK = v`,
  reflGet:        `Reflect.get($taches.find${F1}, k).polluK = v`,
  etaleObj:       '({ ...$o }).a[k].polluK = v',
  chaine3:        'this.h1(); this.h2(); this.h3(); c3[k].polluK = v',
  popRendu:       '$taches.pop()[k].polluK = v',
  spliceRendu:    '$taches.splice(0, 1)[0][k].polluK = v',
  triRendu:       '$taches.sort(() => 0)[0][k].polluK = v',
  inverseRendu:   '$taches.reverse()[0][k].polluK = v',
  protoChaine:    'Object.getPrototypeOf($o).constructor.polluK = v',
  protoFn:        'Object.getPrototypeOf($o).toString.polluK = v',
  triAlias:       '$taches.sort((a, b) => { const c = a; c[k].polluK = v; return 0; })',
  triSorti:       'let s; $taches.sort((a, b) => { s = a; return 0; }); s[k].polluK = v',
  bonCarteVar:    'const c = $taches.map((t) => t); c[0].n = v',
  bonTri:         '$taches.sort((a, b) => b.id - a.id)[0].n = v',
}
const FORMES_MAGASIN: Record<string, string> = {
  ref:         `$$tm.find${F1}[k].polluK = v`,
  oValeurs:    'Object.values($$tm)[0][k].polluK = v',
  etale:       '[...$$tm][0][k].polluK = v',
  carte:       '$$tm.map((t) => t)[0][k].polluK = v',
  optPousse:   '$$tl.find((l) => l.length)?.[k].push(v)',
  optEfface:   `delete $$tm.find${F1}?.[k].polluD`,
  pourMotif:   'for (const { constructor: c } of $$tm) { c.polluK = v; break; }',
  rappelMotif: '$$tm.forEach(({ constructor: c }) => { c.polluK = v; })',
  rappelTri:   '$$tm.toSorted((a, b) => { a[k].polluK = v; return 0; })',
  motifAff:    `[$$tm.find${F1}[k].polluK] = [v]`,
  ctorPousse:  '$$tl.find((l) => l.length).constructor.prototype.push(v)',
  protoDe:     `Object.getPrototypeOf($$tm.find${F1}).polluK = v`,
  ouAff:       'let t; t ??= $$tm.find((x) => x.id == 1); t[k].polluK = v',
  seq:         'const t = (0, $$tm.find((x) => x.id == 1)); t[k].polluK = v',
  yieldEg:     `$$tm.find${F1}[k].polluK = yield v`,
  yieldOu:     `$$tm.find${F1}[k].polluK ||= yield v`,
  assignC:     `Object.assign($$tm.find${F1}.constructor, { polluK: v })`,
  sortCb:      '$$tm.sort((a, b) => { a[k].polluK = v; return 0; })',
  mReduce:     '$$tm.reduce((a, t) => { a[k].polluK = v; return a; })',
  mPop:        '$$tm.pop()[k].polluK = v',
  mSplice:     '$$tm.splice(0, 1)[0][k].polluK = v',
  mTri:        '$$tm.sort(() => 0)[0][k].polluK = v',
  mInverse:    '$$tm.reverse()[0][k].polluK = v',
  mEtaleObj:   '({ ...$$mo }).a[k].polluK = v',
  mReflGet:    `Reflect.get($$tm.find${F1}, k).polluK = v`,
  mMotifTab:   `let t; [t] = [$$tm.find${F1}]; t[k].polluK = v`,
}
const FORMES_COFFEE: Record<string, string> = {
  cProto:   '$taches.find((t) -> t.id == 1)[k]::polluK = v',
  cValeurs: 'Object.values($taches)[0][k].polluK = v',
  cPour:    'for t in $taches then t[k].polluK = v',
  cPourDe:  'for own kk, t of $o then t[k].polluK = v',
  cSoak:    '$taches.find((t) -> t.id == 1)?[k].polluK = v',
  cMotif:   '{constructor: c} = $taches.find((t) -> t.id == 1); c.polluK = v',
  cEfface:  'delete $taches.find((t) -> t.id == 1)[k].polluD',
  cPousse:  '$listes.find((l) -> l.length)[k].push v',
  cProtoDe: 'Object.getPrototypeOf($taches.find((t) -> t.id == 1)).polluK = v',
  cOu:      't = null; t ?= $taches.find((x) -> x.id == 1); t[k].polluK = v',
  cArobase: '@t = $taches.find((x) -> x.id == 1); @t[k].polluK = v',
  cReduce:  '$taches.reduce ((a, t) -> a[k].polluK = v; a)',
  cCarte:   'c = $taches.map((t) -> t); c[0][k].polluK = v',
  cComp:    '(t[k].polluK = v for t in $taches.map((x) -> x))',
}
const FORMES_CIVET: Record<string, string> = {
  vValeurs: 'Object.values($taches)[0][k].polluK = v',
  vPour:    '\n    for t of $taches\n      t[k].polluK = v',
  vMotif:   '\n    [first] := $taches\n    first[k].polluK = v',
  vProtoDe: 'Object.getPrototypeOf($taches.find((t) => t.id == 1)).polluK = v',
  vOu:      '\n    t .= null\n    t ??= $taches.find((x) => x.id == 1)\n    t[k].polluK = v',
  vPipe:    '\n    t := $taches |> .find((x) => x.id == 1)\n    t[k].polluK = v',
  vReduce:  '$taches.reduce(((a, t) => { a[k].polluK = v; return a }))',
  vCarte:   '\n    c := $taches.map((t) => t)\n    c[0][k].polluK = v',
}
// limites écrites dans la doc : MJS ne voit pas l'objet (fonction, valeur rendue, objet littéral, virgule, attente)
const LIMITES = /^mjs-sz-js (?:fonction|fnRet|objLit|seq|attenteVar) /

const gen = (n: string) => n.startsWith('yield')
const asy = (n: string) => n === 'attenteVar'

const SOURCES: Record<string, string> = {
  'sz-js.mjs': `<script lang="js">
  $taches = ${TACHES};
  $listes = [[1], [2]];
  $o = { a: { n: 0 }, b: { n: 1 } };
  let a3, b3, c3;
  @h3 = function() { c3 = b3; };
  @h2 = function() { b3 = a3; };
  @h1 = function() { a3 = $taches.find((x) => x.id == 1); };
  @remettre = function() { $taches = ${TACHES}; $listes = [[1], [2]]; $o = { a: { n: 0 }, b: { n: 1 } }; };
  @lire = function() { return JSON.stringify([$taches, $listes, $o]); };
${Object.entries(FORMES_JS).map(([n, f]) => `  @${n} = ${asy(n) ? 'async ' : ''}function${gen(n) ? '*' : ''}(k, v) { ${f}; };`).join('\n')}
</script>
<p class="etat">{$taches.length}</p>
`,
  'sz-magasin.mjs': `<script lang="js">
  $$tm = ${TACHES};
  $$tl = [[1], [2]];
  $$mo = { a: { n: 0 } };
  @remettre = function() { $$tm = ${TACHES}; $$tl = [[1], [2]]; $$mo = { a: { n: 0 } }; };
  @lire = function() { return JSON.stringify([$$tm, $$tl]); };
${Object.entries(FORMES_MAGASIN).map(([n, f]) => `  @${n} = function${gen(n) ? '*' : ''}(k, v) { ${f}; };`).join('\n')}
</script>
<p class="etat">{$$tm.length}</p>
`,
  'sz-coffee.mjs': `<script lang="coffee">
  $taches = ${TACHES}
  $listes = [[1], [2]]
  $o = { a: { n: 0 }, b: { n: 1 } }
  @remettre = -> $taches = ${TACHES}; $listes = [[1], [2]]; $o = { a: { n: 0 }, b: { n: 1 } }
  @lire = -> JSON.stringify([$taches, $listes, $o])
${Object.entries(FORMES_COFFEE).map(([n, f]) => `  @${n} = (k, v) -> ${f}`).join('\n')}
</script>
<p class="etat">{$taches.length}</p>
`,
  'sz-civet.mjs': `<script>
  $taches = ${TACHES}
  @remettre = -> $taches = ${TACHES}
  @lire = -> JSON.stringify([$taches])
${Object.entries(FORMES_CIVET).map(([n, f]) => `  @${n} = (k, v) -> ${f}`).join('\n')}
</script>
<p class="etat">{$taches.length}</p>
`,
  // classe de l'appli atteinte par une clé calculée ou par `constructor` écrit ; `set` à valeur égale, `-0` ; objet refusé passé à
  // `Object.assign` et `Reflect.set`
  'sz-classe.mjs': `<script lang="js">
  class Tache { constructor(id) { this.id = id; this.n = 0; } }
  Tache.liste = [];
  Tache.marque = 1;
  $$cl = [new Tache(2)];
  const lu = (k) => { const r = Tache[k] === true; delete Tache[k]; return r; };
  @optPousse = function(k) { try { $classes.find((t) => t.id == 1)?.[k].liste.push(1); } catch (e) { } const r = Tache.liste.length; Tache.liste.length = 0; return r; };
  @optEfface = function(k) { try { delete $classes.find((t) => t.id == 1)?.[k].marque; } catch (e) { } const r = 'marque' in Tache; Tache.marque = 1; return r; };
  @motifCle = function(k) { try { const { [k]: c } = $classes.find((x) => x.id == 1); c.isAdmin = true; } catch (e) { } return lu('isAdmin'); };
  @magasinClair = function() { $$cl.find((t) => t.id == 2).constructor.isAdminClair = true; return lu('isAdminClair'); };
  class Compteur { constructor() { this._v = 0; this.appels = 0; } get v() { return this._v; } set v(x) { this.appels++; this._v = x; } }
  $classes = [new Tache(1)];
  $compteurs = [new Compteur()];
  $zeros = [{ z: 0 }];
  @cleCalculee = function(k) { try { $classes.find((t) => t.id == 1)[k].isAdmin = true; } catch (e) { } const r = Tache.isAdmin === true; delete Tache.isAdmin; return r; };
  @cleEcrite = function() { $classes.find((t) => t.id == 1).constructor.isAdminClair = true; const r = Tache.isAdminClair === true; delete Tache.isAdminClair; return r; };
  @valeurEgale = function() { $compteurs.find((c) => c).v = 0; return $compteurs[0].appels; };
  @moinsZero = function() { $zeros.find((z) => z).z = -0; return Object.is($zeros[0].z, -0); };
  @assignRefuse = function(k) { try { Object.assign(Object.values($zeros)[0][k], { polluA: 1 }); return 'écrit'; } catch (e) { return e.name; } };
  @reflectRefuse = function(k) { return Reflect.set($zeros.find((z) => z)[k], 'polluR', 1); };
  @reflectObjet = function() { return Reflect.set($zeros.find((z) => z).constructor, 'polluR', 1); };
</script>
<p class="etat">{$zeros.length}</p>
`,
}
// `Object.freeze`, `Object.seal`, `Object.preventExtensions` sur un objet atteint par une clé venue de l'extérieur : ni `Object` ni
// `Object.prototype` ne doivent être figés (composant et magasin) ; un cas par page, un gel ne se défait pas
const GELS = ['freeze', 'seal', 'preventExtensions']
SOURCES['sz-gel.mjs'] = `<script lang="js">
  $taches = ${TACHES};
  $$tg = ${TACHES};
${GELS.map((g) => `  @${g} = function(k) { try { Object.${g}($taches.find${F1}[k]); } catch (e) { } };\n  @${g}M = function(k) { try { Object.${g}($$tg.find${F1}[k]); } catch (e) { } };`).join('\n')}
</script>
<p class="etat">{$taches.length}</p>
`

async function gelsNode(code: string, dev: boolean): Promise<string[]> {
  const figes: string[] = []
  for (const m of GELS.flatMap((g) => [g, g + 'M'])) for (const k of ['constructor', '__proto__']) {
    const w: any = new Window({ url: 'http://localhost/' })
    w.eval(dev ? code : code.replace(/import\.meta\.url/g, '\'http://localhost/\'').replace(/export\s*\{[^}]*\}\s*;?/g, ''))
    if (dev) w.µ.warn = () => {}
    w.document.body.innerHTML = '<mjs-sz-gel></mjs-sz-gel>'
    const fin = Date.now() + 5000
    while (!w.document.querySelector('mjs-sz-gel')?._shadow?.querySelector('.etat') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    w.document.querySelector('mjs-sz-gel')[m](k)
    if (!w.eval('Object.isExtensible(Object) && Object.isExtensible(Object.prototype)')) figes.push(`${m} ${k}`)
    await w.happyDOM.close()
  }
  return figes
}

const BALISES: Record<string, string[]> = {
  'mjs-sz-js': Object.keys(FORMES_JS),
  'mjs-sz-magasin': Object.keys(FORMES_MAGASIN),
  'mjs-sz-coffee': Object.keys(FORMES_COFFEE),
  'mjs-sz-civet': Object.keys(FORMES_CIVET),
}

// chaque forme jouée deux fois, `k` réservé ; une trace posée sur six objets de la page, `polluD` à garder, `polluK` à ne jamais voir
const TRACEUR = `globalThis.__parcours = async (balise, formes) => {
  const c = document.querySelector(balise)
  const T = [Object.prototype, Object, Array.prototype, Array, Function.prototype, Function, Object.prototype.toString, Object.keys, Array.prototype.push]
  const N = ['Object.prototype', 'Object', 'Array.prototype', 'Array', 'Function.prototype', 'Function', 'Object.prototype.toString', 'Object.keys', 'Array.prototype.push']
  const own = (t, p) => Object.prototype.hasOwnProperty.call(t, p)
  const r = {}
  for (const f of formes) for (const k of ['constructor', '__proto__']) {
    for (const t of T) Object.defineProperty(t, 'polluD', { value: 1, configurable: true, writable: true })
    let erreur = ''
    try {
      const x = c[f](k, 1)
      if (x && typeof x.next === 'function') { x.next(); x.next(1) }
      else await x
    }
    catch (e) { erreur = e.name + ': ' + String(e.message).slice(0, 80) }
    const pollue = [...N.filter((n, i) => own(T[i], 'polluK') || own(T[i], 'polluA') || own(T[i], 'polluR')).map((n) => n + '.polluK'), ...(Array.prototype.length ? ['Array.prototype[0]'] : []), ...N.filter((n, i) => !own(T[i], 'polluD')).map((n) => n + '.polluD retiré'), ...(Object.getPrototypeOf(Object) !== Function.prototype ? ['proto(Object)'] : [])]
    for (const t of T) { delete t.polluK; delete t.polluD; delete t.polluA; delete t.polluR }
    Array.prototype.length = 0
    let donnees = ''
    try { donnees = c.lire() } catch (e) { donnees = 'lire: ' + e.message }
    r[f + ' ' + k] = { pollue, erreur, donnees }
    try { c.remettre() } catch (e) {}
  }
  return r
}
globalThis.__classe = () => {
  const c     = document.querySelector('mjs-sz-classe')
  const essai = (f) => { try { return f() } catch (e) { return e.name } }
  const r     = { cleCalculee: essai(() => c.cleCalculee('constructor')), cleEcrite: essai(() => c.cleEcrite()), valeurEgale: essai(() => c.valeurEgale()), moinsZero: essai(() => c.moinsZero()) }
  for (const m of ['optPousse', 'optEfface', 'motifCle']) r[m] = essai(() => c[m]('constructor'))
  r.magasinClair = essai(() => c.magasinClair())
  r.reflectObjet  = essai(() => c.reflectObjet())
  for (const k of ['constructor', '__proto__']) {
    r['assignRefuse ' + k]  = essai(() => c.assignRefuse(k))
    r['reflectRefuse ' + k] = essai(() => c.reflectRefuse(k))
  }
  r.pollue = [Object.prototype, Object].some((t) => 'polluA' in t || 'polluR' in t)
  return r
}`

// production en un seul fichier, ou développement (tout le JavaScript, le cœur d'abord)
async function construire(nom: string, opts: Record<string, unknown>, dev: boolean): Promise<{ racine: string, code: string }> {
  const root   = mjsTmp('sans-proxy-copies-motifs-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(dev ? root : outDir, 'bundle.js'), ...(dev ? {} : { env: 'prod', js: 'bundle', urlPrefix: '/out' }), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  if (!dev) return { racine: root, code: readFileSync(join(outDir, 'bundle.js'), 'utf-8') }
  const rang  = (f: string) => /^mjs_core/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  return { racine: root, code: files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' }
}

const constructions = new Map<string, Promise<{ racine: string, code: string }>>()
const construction  = (nom: string, opts: Record<string, unknown>, dev = false) => {
  if (!constructions.has(nom)) constructions.set(nom, construire(nom, opts, dev))
  return constructions.get(nom)!
}

// happy-dom : le code dans la page, les composants montés ; en développement, les avertissements de `µ.warn` relevés
async function parcoursNode(code: string, dev: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  window.eval(dev ? code : code.replace(/import\.meta\.url/g, '\'http://localhost/\'').replace(/export\s*\{[^}]*\}\s*;?/g, ''))
  if (dev) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = [...Object.keys(BALISES), 'mjs-sz-classe'].map((b) => `<${b}></${b}>`).join('')
  const pret = () => [...Object.keys(BALISES), 'mjs-sz-classe'].every((b) => window.document.querySelector(b)?._shadow?.querySelector('.etat')?.textContent)
  const fin  = Date.now() + 5000
  while (!pret() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  window.eval(TRACEUR)
  const traces: Record<string, any> = {}
  for (const [b, formes] of Object.entries(BALISES)) for (const [f, t] of Object.entries(await window.__parcours(b, formes))) traces[`${b} ${f}`] = t
  // relu hors de la page : l'objet de happy-dom n'a pas le prototype de node
  const classe = JSON.parse(JSON.stringify(window.__classe()))
  await window.happyDOM.close()
  return { traces, classe, avis }
}

// aucune trace sur un prototype ni sur une fonction de la page, hors des limites écrites
function aucunePollution(traces: Record<string, any>) {
  const pollues = Object.entries(traces).filter(([f, t]) => !LIMITES.test(f) && t.pollue.length).map(([f, t]) => `${f} → ${t.pollue.join(', ')}`)
  assert.deepEqual(pollues, [], 'écritures qui ont atteint un prototype ou une fonction de la page')
}

// l'écriture légitime par une copie va à l'objet ; classe de l'appli, `set`, `-0`, objet refusé gelé
function ecrituresJustes(traces: Record<string, any>, classe: Record<string, any>) {
  assert.match(traces['mjs-sz-js bonValeurs constructor'].donnees, /^\[\[\{"id":1,"n":1\},\{"id":2,"n":0\}\]/, 'l\'écriture par Object.values va à l\'objet')
  assert.match(traces['mjs-sz-js bonCarteVar constructor'].donnees, /^\[\[\{"id":1,"n":1\},\{"id":2,"n":0\}\]/, 'l\'écriture par une copie de `map` va à l\'objet')
  assert.match(traces['mjs-sz-js bonTri constructor'].donnees, /^\[\[\{"id":2,"n":1\},\{"id":1,"n":0\}\]/, 'l\'écriture par le retour de `sort` va à l\'objet')
  assert.deepEqual(classe, {
    cleCalculee: false, cleEcrite: true, valeurEgale: 1, moinsZero: true, optPousse: 0, optEfface: true, motifCle: false, magasinClair: true,
    'assignRefuse constructor': 'TypeError', 'reflectRefuse constructor': false, 'assignRefuse __proto__': 'TypeError', 'reflectRefuse __proto__': false, reflectObjet: false,
    pollue: false,
  })
}

describe('état sans Proxy : copies, motifs, rappels et classes de l\'appli — aucune écriture n\'atteint un prototype ni une fonction de la page (happy-dom)', function () {
  this.timeout(180000)
  after(() => terminateSharedWorkerPool())

  it('production, proxy: false : aucune forme ne pollue, l\'écriture légitime va à l\'objet', async () => {
    const { code }           = await construction('sans-prod', { proxy: false })
    const { traces, classe } = await parcoursNode(code, false)
    aucunePollution(traces)
    ecrituresJustes(traces, classe)
    assert.deepEqual(await gelsNode(code, false), [], 'gels qui ont figé Object ou Object.prototype')
  })

  it('développement, proxy: false : aucune forme ne pollue, le refus d\'une clé réservée de la chaîne est dit', async () => {
    const { traces, classe, avis } = await parcoursNode((await construction('sans-dev', { proxy: false }, true)).code, true)
    aucunePollution(traces)
    ecrituresJustes(traces, classe)
    assert.ok(avis.some((a) => a.includes('« constructor »')), `segment constructor dit : ${JSON.stringify(avis.slice(0, 5))}`)
  })
})

describe('enveloppe (sans le réglage) : prototype lu par `Object.getPrototypeOf`, éléments du rappel de `sort` (happy-dom)', function () {
  this.timeout(180000)
  after(() => terminateSharedWorkerPool())

  it('production : aucune forme n\'atteint un prototype ni une fonction de la page, le magasin non plus ; l\'écriture légitime va à l\'objet', async () => {
    const { code }           = await construction('avec-prod', {})
    const { traces, classe } = await parcoursNode(code, false)
    aucunePollution(Object.fromEntries(Object.entries(traces).filter(([f]) => f.startsWith('mjs-sz-js ') || f.startsWith('mjs-sz-magasin '))))
    for (const [f, attendu] of [['bonValeurs', '[[{"id":1,"n":1},{"id":2,"n":0}]'], ['bonCarteVar', '[[{"id":1,"n":1},{"id":2,"n":0}]'], ['bonTri', '[[{"id":2,"n":1},{"id":1,"n":0}]']]) assert.ok(traces[`mjs-sz-js ${f} constructor`].donnees.startsWith(attendu), `${f} : ${traces[`mjs-sz-js ${f} constructor`].donnees}`)
    assert.equal(classe.magasinClair, true, 'magasin : `constructor` écrit dans le code y écrit')
    assert.deepEqual(await gelsNode(code, false), [], 'gels qui ont figé Object ou Object.prototype')
  })
})

describe('état sans Proxy : copies, motifs, rappels et classes de l\'appli (navigateurs réels)', function () {
  this.timeout(180000)
  after(() => terminateSharedWorkerPool())

  // avec le réglage : toutes les formes ; avec l'enveloppe (sans le réglage) : celles du composant en JavaScript et du magasin
  for (const moteur of ['chromium', 'firefox', 'webkit']) for (const [mode, nom, opts] of [['proxy: false', 'sans-prod', { proxy: false }], ['enveloppe', 'avec-prod', {}]] as [string, string, Record<string, unknown>][]) {
    it(`${moteur}, production, ${mode} : aucune forme ne pollue, l'écriture légitime va à l'objet`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
      const browser = await playwright[moteur].launch()
      try {
        const { racine } = await construction(nom, opts)
        const balises    = [...Object.keys(BALISES), 'mjs-sz-classe']
        const page: Cible = { mode: 'bundle', racine, document: () => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${balises.map((b) => `<${b}></${b}>`).join('')}<script type="module" src="/out/bundle.js"></script></body></html>` }
        const o = await charger(browser, page, 'mjs-sz-js')
        try {
          await o.page.waitForFunction(`${JSON.stringify(balises)}.every((b) => !!document.querySelector(b)?._shadow?.querySelector('.etat'))`, null, { timeout: 10000 })
          await o.page.evaluate(TRACEUR)
          const traces: Record<string, any> = {}
          for (const [b, formes] of Object.entries(BALISES)) for (const [f, t] of Object.entries(await o.page.evaluate(([x, y]: any) => (globalThis as any).__parcours(x, y), [b, formes]) as any)) traces[`${b} ${f}`] = t
          const classe = await o.page.evaluate(() => (globalThis as any).__classe())
          if (nom === 'sans-prod') {
            aucunePollution(traces)
            ecrituresJustes(traces, classe)
          }
          else {
            aucunePollution(Object.fromEntries(Object.entries(traces).filter(([f]) => f.startsWith('mjs-sz-js ') || f.startsWith('mjs-sz-magasin '))))
            for (const [f, attendu] of [['bonValeurs', '[[{"id":1,"n":1},{"id":2,"n":0}]'], ['bonCarteVar', '[[{"id":1,"n":1},{"id":2,"n":0}]'], ['bonTri', '[[{"id":2,"n":1},{"id":1,"n":0}]']]) assert.ok(traces[`mjs-sz-js ${f} constructor`].donnees.startsWith(attendu), `${f} : ${traces[`mjs-sz-js ${f} constructor`].donnees}`)
            assert.equal(classe.magasinClair, true, 'magasin : `constructor` écrit dans le code y écrit')
          }
          assert.deepEqual(o.erreurs, [], 'aucune erreur de page')
        } finally {
          await o.fermer()
        }
      } finally {
        await browser.close()
      }
    })
  }
})
