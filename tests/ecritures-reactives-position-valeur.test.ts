// Réécriture des écritures réactives (`transformReactiveWrites` puis `applyPathTracking`, dans l'ordre
// du transpileur) : le code produit est EXÉCUTÉ contre un runtime factice qui rend ce que rend le vrai
// (`µ._set` rend `true`, `µ._storeSet` rien, `µ._mjs_deepSet` la valeur écrite). Chaque écriture doit
// valoir ce qu'elle vaut en JavaScript là où sa valeur est lue, garder la forme courte là où elle ne
// l'est pas, ne jamais ouvrir une instruction par une parenthèse (Civet n'écrit pas de point-virgule),
// garder son `?.`, n'évaluer qu'une fois une clé calculée, et écrire la DERNIÈRE valeur d'une
// expression à virgule entre parenthèses.

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { transformReactiveWrites } from '../src/generator/transform-reactive.js'
import { applyPathTracking } from '../src/generator/path-tracker.js'
import { annotateEffectDeps } from '../src/generator/effect-deps.js'

const compiler = (src: string) => applyPathTracking(transformReactiveWrites(src))

// le corps est celui d'une méthode, comme Civet l'écrit : sans point-virgule
function executer(corps: string, etat: any = {}, magasin: any = {}, globaux: Record<string, any> = {}) {
  const out = compiler(`_mjsThis.essai = function() {\n${corps}\n}`)
  acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'module' })
  const ecrit: any[] = []
  const naviguer = (o: any, p: any[]) => { for (const s of p) o = o[s]; return o }
  const µ: any = {
    store: magasin,
    _set(_el: any, k: string, v: any) { ecrit.push(['$' + k, v]); etat[k] = v; return true },
    _mjs_deepSet(_el: any, p: any[], v: any) { ecrit.push([p.join('.'), v]); naviguer(etat, p.slice(0, -1))[p[p.length - 1]] = v; return v },
    _mjs_deepCall(_el: any, p: any[], m: string, args: any[]) { ecrit.push([p.join('.') + '.' + m, args]); const o = naviguer(etat, p); return o[m](...args) },
    _storeSet(k: string, v: any) { ecrit.push(['$$' + k, v]); magasin[k] = v },
    _mjs_storeDeepSet(k: string, p: any[], v: any) { ecrit.push(['$$' + [k, ...p].join('.'), v]); naviguer(magasin[k], p.slice(0, -1))[p[p.length - 1]] = v },
    _mjs_storeDeepCall(k: string, p: any[], m: string, args: any[]) { ecrit.push(['$$' + [k, ...p].join('.') + '.' + m, args]); const o = naviguer(magasin[k], p); return o[m](...args) },
  }
  const cible: any = { _state: etat }
  const noms = Object.keys(globaux)
  new Function('µ', '$', '_mjsThis', ...noms, out)(µ, etat, cible, ...noms.map(n => globaux[n]))
  return { out, ecrit, r: cible.essai() }
}

const lignesOuvrantParParenthese = (out: string) => out.split('\n').map(l => l.trim()).filter(l => l.startsWith('('))

describe('écritures réactives — position, valeur rendue et forme du code produit', () => {

  describe('une écriture posée seule sur sa ligne n\'ouvre jamais l\'instruction par une parenthèse', () => {
    it('`$$x++`, `++$$x`, `--$$x`, `$$o.n++` après une autre ligne : forme directe, le code s\'exécute', () => {
      const trace: string[] = []
      const { out } = executer([
        "  trace.push('a')",
        '  µ.store.cpt++',
        "  trace.push('b')",
        '  ++µ.store.cpt',
        "  trace.push('c')",
        '  --µ.store.cpt',
        "  trace.push('d')",
        '  µ.store.o.n++',
        "  trace.push('e')",
      ].join('\n'), {}, { cpt: 0, o: { n: 0 } }, { trace })
      assert.deepEqual(lignesOuvrantParParenthese(out), [], out)
      assert.deepEqual(trace, ['a', 'b', 'c', 'd', 'e'])
      assert.match(out, /µ\._storeSet\("cpt", \(\+µ\.store\.cpt\) \+ 1\)/)
      assert.match(out, /µ\._mjs_storeDeepSet\("o", \["n"\], \(\+µ\.store\.o\.n\) \+ 1\)/)
    })

    it('valeur lue en tête d\'instruction (`$x++ || f()`) : point-virgule protecteur', () => {
      const trace: string[] = []
      const { out } = executer("  trace.push('a')\n  $.n++ || trace.push('zero')\n  µ.store.n++ || trace.push('zero$$')", { n: 0 }, { n: 0 }, { trace })
      assert.deepEqual(trace, ['a', 'zero', 'zero$$'])
      assert.deepEqual(lignesOuvrantParParenthese(out), [], out)
    })

    it('élément d\'une suite et pas d\'un `for` : forme directe (valeur jamais lue)', () => {
      const { out, ecrit } = executer('  for (let i = 0; i < 2; i++, $.k = i, µ.store.k = i) {}\n  $.a = 1, $.b = 2', {}, {})
      assert.doesNotMatch(out, /_v\)/, out)
      assert.deepEqual(ecrit.filter(e => e[0] === '$k' || e[0] === '$$k').length, 4)
    })
  })

  describe('une affectation d\'état utilisée comme valeur vaut la valeur affectée, partout', () => {
    it('condition d\'un `if`, d\'un `while`', () => {
      let appels = 0
      const file = [1, 2, null]
      const suivant = () => { if (++appels > 5) throw new Error('boucle sans fin'); return file.shift() }
      const { r } = executer([
        "  let branche = 'rien'",
        "  if ($.res = chercher('zz')) { branche = 'oui' } else { branche = 'non' }",
        '  let n = 0',
        '  while ($.m = suivant()) { n++ }',
        '  return [branche, n]',
      ].join('\n'), {}, {}, { chercher: () => undefined, suivant })
      assert.deepEqual(r, ['non', 2])
    })

    it('déclaration, flèche, tableau, négation, gabarit, objet', () => {
      const { r } = executer([
        '  const x = ($.n = 5)',
        '  const g = (v) => $.last = v',
        '  const t = [$.a = 1]',
        '  const u = !($.z = 0)',
        "  const s = `${$.w = 'w'}`",
        '  const o = { k: $.q = 3 }',
        '  return [x, g(7), t, u, s, o.k]',
      ].join('\n'))
      assert.deepEqual(r, [5, 7, [1], true, 'w', 3])
    })

    it('instruction seule : la forme courte, sans fermeture', () => {
      const out = compiler(`_mjsThis.essai = function() {\n  $.x = 1\n  $.y += 2\n}`)
      assert.match(out, /^\s*µ\._set\(_mjsThis, 'x', 1\)$/m)
      assert.match(out, /^\s*µ\._set\(_mjsThis, 'y', \$\.y \+ \(2\)\)$/m)
    })

    it('retour d\'un gestionnaire en ligne : forme directe (une fonction rangée n\'est jamais rendue au routeur), y compris compilé par groupes', () => {
      for (const src of [
        'this._mjs_inline = [(e, el) => { return $.cb = function() { return 1 } }]',
        'this._mjs_inline = []\nthis._mjs_inline[0] = (e, el) => { return $.cb = function() { return 1 } }',
        'this._mjs_inline[3] = (_mjs_e, _mjs_el) => { return µ.store.cb = function() { return 1 } }',
      ]) {
        const out = compiler(src)
        assert.doesNotMatch(out, /_v\)/, out)
        assert.match(out, /return µ\.(_set\(_mjsThis, 'cb'|_storeSet\("cb")/, out)
      }
    })
  })

  describe('une écriture du magasin utilisée comme valeur vaut la valeur écrite', () => {
    it('chaînes, retour, condition, composée, profonde', () => {
      const magasin: any = { b: 0, x: 0, y: 0, n: 1, sel: null, o: { k: 0 } }
      const { r } = executer([
        '  $.a = µ.store.b = 5',
        '  µ.store.x = µ.store.y = 7',
        "  const branche = (µ.store.sel = trouver()) ? 'oui' : 'non'",
        '  const n = (µ.store.n += 1)',
        '  const k = (µ.store.o.k = 3)',
        '  const f = (v) => { return µ.store.x = v }',
        '  return [branche, n, k, f(9)]',
      ].join('\n'), {}, magasin, { trouver: () => 'trouvé' })
      assert.deepEqual(r, ['oui', 2, 3, 9])
      assert.equal(magasin.b, 5)
      assert.equal(magasin.x, 9)
      assert.equal(magasin.sel, 'trouvé')
    })
  })

  describe('`?.` sur un appel mutant est gardé', () => {
    it('liste `null` : rien n\'est appelé, aucune erreur, la valeur vaut `undefined`', () => {
      const { r, ecrit } = executer([
        '  $.list?.push(1)',
        '  µ.store.l?.push(1)',
        '  $.o?.items.push(2)',
        '  const v = $.list?.push(3)',
        '  $.liste.push?.(4)',
        '  µ.store.o?.items.push(5)',
        '  µ.store.f.push?.(6)',
        '  const w = µ.store.l?.push(7).toFixed()',
        '  return [v, w]',
      ].join('\n'), { list: null, o: undefined, liste: {} }, { l: null, o: null, f: {} })
      assert.deepEqual(r, [undefined, undefined])
      assert.deepEqual(ecrit, [])
    })

    it('liste présente : l\'appel passe par l\'écriture notifiante et rend sa valeur', () => {
      const etat: any = { list: [], o: { items: [] } }
      const magasin: any = { l: [] }
      const { r, ecrit, out } = executer([
        "  trace.push('a')",
        '  $.list?.push(1)',
        '  µ.store.l?.push(2)',
        '  $.o?.items.push(3)',
        '  const w = µ.store.l?.push(7).toFixed()',
        '  return [$.list?.push(4), w]',
      ].join('\n'), etat, magasin, { trace: [] })
      assert.deepEqual(r, [2, '2'])
      assert.deepEqual(etat.list, [1, 4])
      assert.deepEqual(magasin.l, [2, 7])
      assert.deepEqual(etat.o.items, [3])
      assert.deepEqual(ecrit.map(e => e[0]), ['list.push', '$$l.push', 'o.items.push', '$$l.push', 'list.push'])
      assert.match(out, /^\s*_mjsThis\._state\.list == null \? void 0 : µ\._mjs_deepCall\(_mjsThis, \["list"\], 'push', \[1\]\)$/m)
      assert.match(out, /^\s*µ\.store\.l == null \? void 0 : µ\._mjs_storeDeepCall\("l", \[\], 'push', \[2\]\)$/m)
      assert.deepEqual(lignesOuvrantParParenthese(out), [], out)
    })

    it('dans un `µeffect`, pousser dans `$liste?.…` n\'en fait pas une dépendance (comme sans `?.`)', () => {
      const out = annotateEffectDeps(compiler('µ.effect(function() { $.journal?.push($.valeur); $.liste.push($.valeur) })'))
      assert.match(out, /, \["valeur"\]\)$/, out)
    })
  })

  describe('une clé calculée n\'est évaluée qu\'une fois', () => {
    it('`$[cle()] += 1`, `$[cle()]++`, `++$[cle()]`, en instruction et en valeur', () => {
      const cles = ['k1', 'k2', 'k1', 'k2', 'k1']
      let idx = 0
      const pick = () => cles[idx++]
      const etat: any = { k1: 0, k2: 10 }
      const { r, ecrit } = executer([
        '  $.vu = 1',
        '  $[pick()] += 1',
        '  $[pick()]++',
        '  const a = ($[pick()] += 5)',
        '  const b = $[pick()]++',
        '  const c = ++$[pick()]',
        '  return [a, b, c]',
      ].join('\n'), etat, {}, { pick })
      assert.equal(idx, 5, 'une évaluation de la clé par écriture')
      assert.deepEqual(r, [6, 11, 7])
      assert.deepEqual(etat, { vu: 1, k1: 7, k2: 12 })
      assert.deepEqual(ecrit.map(e => e[0]), ['$vu', '$k1', '$k2', '$k1', '$k2', '$k1'], 'chaque écriture passe par µ._set')
    })

    it('clé sans effet de bord : forme courte inchangée', () => {
      const out = compiler(`_mjsThis.essai = function() {\n  $.vu = 1\n  $[k] += 1\n  $[k]++\n}`)
      assert.match(out, /^\s*µ\._set\(_mjsThis, k, \$\[k\] \+ \(1\)\)$/m)
      assert.match(out, /^\s*µ\._set\(_mjsThis, k, \(\+\$\[k\]\) \+ 1\)$/m)
    })
  })

  describe('valeur entre parenthèses avec une virgule : la dernière valeur est écrite', () => {
    it('état, profond, magasin, motif, clé calculée, composée, appel mutant', () => {
      const etat: any = { x: 0, o: { k: 0 }, liste: [], y: 0, z: 1, d: 0 }
      const magasin: any = { k: 0, s: 0, m: 0, l: [] }
      executer([
        '  $.x = (0, 2)',
        '  $.o.k = (0, 2)',
        '  µ.store.k = (0, 2)',
        '  ;[$.y] = (0, [2])',
        '  ;[µ.store.m] = (0, [2])',
        "  $['d'] = (0, 2)",
        '  $.z += (0, 2)',
        '  µ.store.s += (0, 2)',
        '  $.liste.push((0, 5))',
        '  µ.store.l.push((0, 6))',
      ].join('\n'), etat, magasin)
      assert.deepEqual(etat, { x: 2, o: { k: 2 }, liste: [5], y: 2, z: 3, d: 2 })
      assert.deepEqual(magasin, { k: 2, s: 2, m: 2, l: [6] })
    })
  })

  describe('une variable qui garde un objet de l\'état n\'est plus réécrite en chemin', () => {
    it('`ancien = $.a ; ancien.on = false` reste une écriture sur l\'objet tenu (le filet de l\'état la notifie)', () => {
      const out = compiler(`const ancien = $.a\nµ._set(_mjsThis, 'a', $.b)\nancien.on = false\nconst p = $.items[0]\np.fait = true\np.tags.push(1)\ndelete p.n`)
      assert.doesNotMatch(out, /_mjs_deep(Set|Call|Delete)/, out)
      assert.match(out, /ancien\.on = false/)
    })

    it('l\'écriture directe par le chemin de l\'état reste compilée', () => {
      assert.match(compiler('$.a.on = false'), /µ\._mjs_deepSet\(_mjsThis, \["a", "on"\], false\)/)
    })
  })
})
