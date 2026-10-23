// Garde : les deux marcheurs de paths.ts confrontés à Chromium sur un échantillon fixe de gabarits — cas limites du
// standard HTML (fermetures implicites, fermantes en trop, tableaux, `<template>`, SVG/MathML, instructions de
// traitement…) et gabarits réels des tutos. Pour chaque gabarit : (1) chaque chemin du mode clone, suivi dans l'arbre
// que Chromium bâtit pour le HTML émis, mène au nœud qu'il vise (élément marqué, commentaire du jalon, texte seul) ;
// (2) l'arbre du mode impératif a la forme de celui que Chromium bâtit pour le même HTML (balises, espaces de noms,
// textes, commentaires ; blancs ignorés). Un écart = un composant qui planterait au montage ou écrirait dans le
// mauvais nœud. Sans Chromium installé, la garde est sautée.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { extractPaths, generateCreateFnBody, SVG_NS, RUNTIME_SVG_HEAD_RE as TETE_SVG } from '../src/generator/paths.js'

const M = (id: string) => `<script type='mjs/marker' mjs-t='${id}'></script>`

// [gabarit tel qu'il arrive au générateur, espace de noms ambiant]
const GABARITS: Record<string, [string, string | null]> = {
  'li': ["<ul><li>a<li mjs-id='x'>b</ul>", null],
  'li-fermante-en-trop': ["<div><ul><li>a<li>b</li></li></ul><p mjs-id='x'>c</p></div>", null],
  'p-vide': ["<div><ul><li><p>a<li>b</li></p></li></ul><b mjs-id='x'>c</b></div>", null],
  'td': ["<table><tr><td>a<td mjs-id='x'>b</table>", null],
  'option': ["<select><option>a<option mjs-id='x'>b</select>", null],
  'optgroup': ["<select><optgroup label=a><option>1<optgroup label=b><option mjs-id='x'>2</select>", null],
  'dl': ["<dl><dt>a<dd>b<dt mjs-id='x'>c</dl>", null],
  'dd-imbrique': ["<dl><dt>a<dl><dt>b<dd mjs-id='x'>c</dl></dl>", null],
  'template': ["<div><template><b>z</b></template><p mjs-id='x'>q</p></div>", null],
  'template-imbrique': ["<div><template><template><i>z</i></template><b>y</b></template><p mjs-id='x'>q</p></div>", null],
  'bouton-imbrique': ["<div><button>a<button>b</button>" + M('t1') + "<i mjs-id='x'>c</i></button></div>", null],
  'bouton-p': ["<p>T <button><div mjs-id='x'>y</div></button></p>", null],
  'titres': ["<div><h1>a<h2 mjs-id='x'>b</h2></h1></div>", null],
  'a-imbrique': ["<div><a href=1>a<a mjs-id='x' href=2>b</a></a></div>", null],
  'ruby': ["<ruby>a<rt>b<rt mjs-id='x'>c</rt></rt></ruby><b mjs-id='y'>d</b>", null],
  'pi': ["<div><?x?><b mjs-id='x'>y</b></div>", null],
  'declaration': ["<div><!x><![CDATA[y]]><b mjs-id='x'>y</b></div>", null],
  'commentaire': ["<div>a<!-- c --><b mjs-id='x'>b</b></div>", null],
  'fermante-orpheline': ["<section><div>a</div></div><p mjs-id='x'>b</p></section>", null],
  'fermante-i': ["<div><span>a</i><b mjs-id='x'>b</b></span></div>", null],
  'fermante-vide': ["<div><span>a</><b mjs-id='x'>y</b></span></div>", null],
  'fermante-p': ["<div><p>a</p></p><b mjs-id='x'>y</b></div>", null],
  'table-sans-tbody': ["<table><tr><td mjs-id='x'>a</td></tr></table>", null],
  'table-col': ["<table><col><col><tr><td mjs-id='x'>a</td></tr></table>", null],
  'table-caption': ["<table><caption>c<tr><td mjs-id='x'>a</td></tr></table>", null],
  'table-tbody-puis-tr': ["<table><tbody><tr><td>a</td></tr></tbody><tr mjs-id='x'><td>b</td></tr></table>", null],
  'table-thead-tbody': ["<table><thead><tr><th>a</th></tr><tbody><tr mjs-id='x'><td>b</td></tr></table>", null],
  'table-tr-tr': ["<table><tr><td>a</td><tr><td mjs-id='x'>b</td></table>", null],
  'table-marqueur': ["<table><tr>" + M('t1') + "<td mjs-id='x'>b</td></tr></table>", null],
  'table-cache': ["<table><input type='hidden' name='a'><tr><td mjs-id='x'>b</td></tr></table>", null],
  'svg': ["<svg><circle></circle><g mjs-id='x'></g></svg>", null],
  'svg-fo': ["<svg><foreignObject><div mjs-id='x'>a</div></foreignObject></svg>", null],
  'svg-sortie': ["<div><svg><span>a</span><g mjs-id='x'><text>b</text></g></svg></div>", null],
  'svg-title': ["<svg><title>" + M('t1') + "</title><g mjs-id='x'></g></svg>", null],
  'svg-cdata': ["<svg><![CDATA[x]]><g mjs-id='x'></g></svg>", null],
  'svg-casse': ["<svg><lineargradient id='d'></lineargradient><g mjs-id='x'></g></svg>", null],
  'math': ["<math><mi>x</mi><mo mjs-id='x'>+</mo></math>", null],
  'html-body': ["<html><body><div mjs-id='x'>a</div></body></html>", null],
  'image': ["<div><image src='a'><b mjs-id='x'>y</b></image></div>", null],
  'inferieur': ["<div>si a < b alors<b mjs-id='x'>c</b></div>", null],
  'texte-marqueurs': ["<div>a" + M('t1') + "<b mjs-id='x'>b</b>" + M('t2') + "</div>", null],
  'textarea': ["<div><textarea>a<b>x</b></textarea><b mjs-id='x'>y</b></div>", null],
  'select-div': ["<select><div>a</div><option mjs-id='x'>b</option></select>", null],
  'pre-saut': ["<pre>\n<b mjs-id='x'>a</b></pre>", null],
  'noscript': ["<div><noscript><b>a</b></noscript><p mjs-id='x'>b</p></div>", null],
  'option-hors-select': ["<div><option>a<option mjs-id='x'>b</div>", null],
  'reel-table': ["\n\n<div class='pane'>\n  <h3>👥 Utilisateurs</h3>\n  <table>\n    <thead>\n      <tr><th>Nom</th><th>Rôle</th><th>État</th></tr>\n    </thead>\n    <tbody>\n      <script type='mjs/marker' mjs-t='s-for1'></script><script type='mjs/marker' mjs-t='e-for1'></script>\n    </tbody>\n  </table>\n  <p class='url'>Route <code>/admin/users</code> — injectée dans la vue interne de <code>admin-layout</code>.</p>\n</div>\n\n", null],
  'reel-tr-racine': ["\n        <tr mjs-l-id='l2'>\n          <td mjs-l-id='l3'><script type='mjs/marker' mjs-l-t='t4'></script></td>\n          <td mjs-l-id='l5'><script type='mjs/marker' mjs-l-t='t6'></script></td>\n          <td mjs-l-id='l7'>\n            <span class='dot' mjs-id='c9' mjs-l-id='l8'></span>\n            <script type='mjs/marker' mjs-l-t='t10'></script>\n          </td>\n        </tr>\n      ", null],
  'reel-svg': ["\n\n\n\n<div class='outer'>\n  <svg mjs-id='d1'>\n    <line mjs-id='e2'></line>\n\n    <script type='mjs/marker' mjs-t='s-for3'></script><script type='mjs/marker' mjs-t='e-for3'></script>\n\n    <polyline mjs-id='e8'></polyline>\n\n    <text class='title' x='10' y='10' font-size='36'>$MJS</text>\n  </svg>\n</div>", null],
  'reel-ns': ["\n      <g class='tick' transform='' mjs-l-id='l4'>\n        <line x2='' mjs-l-id='l5'></line>\n        <text x='-5' mjs-l-id='l6'><script type='mjs/marker' mjs-l-t='t7'></script></text>\n      </g>\n    ", SVG_NS],
  'reel-select': ["\n\n<h2>Insecurity questions</h2>\n\n<form mjs-id='e1'>\n  <select value='' mjs-id='b2'>\n    <script type='mjs/marker' mjs-t='s-for3'></script><script type='mjs/marker' mjs-t='e-for3'></script>\n  </select>\n\n  <input value='' mjs-id='b7'>\n\n  <button disabled='' type='submit' mjs-id='a8'>\n    Submit\n  </button>\n</form>\n\n<p>\n  selected question <script type='mjs/marker' mjs-t='t9'></script>\n</p>\n\n", null],
  'reel-pre': ["<div class='text'><h1><script type='mjs/marker' mjs-t='t1'></script></h1><p><span mjs-id='t2'></span></p><div class='note'><span mjs-id='t3'></span><mjs-core-code><pre><code>&lt;p @in=*fly(down, distance: 20) @out=*fade&gt;\n  Entre vite, sort doucement\n&lt;/p&gt;</code></pre></mjs-core-code><span mjs-id='t4'></span>\n  </div><div class='note'><span mjs-id='t5'></span></div></div>", null],
  'reel-ul': ["<div class='text'>\n<h1><script type='mjs/marker' mjs-t='t1'></script></h1>\n<p><span mjs-id='t2'></span></p>\n<div class='note'><span mjs-id='t3'></span>\n<ul>\n<li><span mjs-id='t4'></span></li>\n<li><span mjs-id='t5'></span></li>\n</ul></div>\n<p><span mjs-id='t6'></span></p>\n</div>", null],
  'reel-button': ["\n\n<div class='demo'>\n  <p class='tag'><span mjs-id='t1'></span></p>\n\n  <p class='etat'>µres.favoris = <code><script type='mjs/marker' mjs-t='t2'></script></code></p>\n\n  <button mjs-id='e3'><script type='mjs/marker' mjs-t='t4'></script></button>\n\n  <p class='hint'><span mjs-id='t5'></span></p>\n</div>\n\n", null],
  'reel-h2': ["\n\n<h2 class='titre'><span mjs-id='t1'></span></h2>\n\n<select aria-label='' value='' mjs-id='a2'>\n  <script type='mjs/marker' mjs-t='s-for3'></script><script type='mjs/marker' mjs-t='e-for3'></script>\n</select>\n\n<div mjs-el='0'>\n  <script type='mjs/marker' mjs-t='t7'></script> <code>&lt;<script type='mjs/marker' mjs-t='t8'></script>&gt;</code>\n</div>\n\n", null],
  'reel-textarea': ["\n\n<div class='grid'>\n  <label for='markdown-input'><script type='mjs/marker' mjs-t='t1'></script></label>\n  <textarea id='markdown-input' rows='8' value='' mjs-id='a2'></textarea>\n\n  <script type='mjs/marker' mjs-t='t3'></script>\n  <div><span mjs-id='t4'></span></div>\n</div>\n\n", null],
  'reel-interp': ["\n          <li mjs-flip='200' mjs-key='${todo?.id ?? index}' mjs-id='t13' mjs-l-id='l12'>\n            <input type='checkbox' id='' checked='' mjs-id='a15' mjs-l-id='l14'>\n            <label for='' mjs-id='a17' mjs-l-id='l16'><script type='mjs/marker' mjs-l-t='t18'></script></label>\n            <button aria-label='Remove' mjs-id='e20' mjs-l-id='l19'></button>\n          </li>\n        ", null],
  'reel-label': ["\n\n<label>\n  <input type='range' value='' min='0' max='' mjs-id='b1'>\n  <script type='mjs/marker' mjs-t='t2'></script>\n</label>\n\n<label>\n  <input type='range' value='' min='0' max='' mjs-id='b3'>\n  <script type='mjs/marker' mjs-t='t4'></script>\n</label>\n\n<button mjs-id='e5'>Agrandir</button>\n\n<hr>\n\n<div class='box' mjs-id='s6'>\n  <script type='mjs/marker' mjs-t='t7'></script>\n</div>\n\n", null]
}

// motif `µ._mjs_svgTagRe` du runtime (mjs_init.ts), tel que le générateur le garde : un HTML qui s'ouvre sur l'une de
// ces balises est lu dans un `<svg>`

// ce que la page reçoit pour un gabarit : HTML du mode clone (chaque jalon texte nommé, chaque élément marqué d'un attribut
// à son nom — sans effet sur l'analyse), chemins, corps du mode impératif, HTML de référence (jalons en commentaires)
function preparer(nom: string, html: string, ns: string | null) {
  const marque = (id: string) => 'data-mjsv-' + id.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
  const info   = extractPaths(html.replace(/(\s+mjs-(?:l-)?id\s*=\s*(['"])([^'"]+)\2)/g, (m, _a, _q, id) => m + ' ' + marque(id)), { stripWhitespace: true })
  const textes = Object.keys(info.paths).filter(id => info.kinds[id] === 'text')
  let k = 0
  const clone = info.cleanHtml.replace(/<!--\$-->/g, () => '<!--$' + (textes[k++] ?? '?') + '-->')
  const enveloppe = !ns || !/<[a-zA-Z]/.test(clone) ? null : (ns === SVG_NS ? (TETE_SVG.test(clone) ? null : 'svg') : 'math')
  const corps = generateCreateFnBody(html.replace(/\$\{[^}]*\}/g, '0'), { forceImperative: true, foreignNsRoot: ns }).body
  const reference = html.replace(/\$\{[^}]*\}/g, '0').replace(/<script\b[^>]*?type\s*=\s*['"]mjs\/marker['"][^>]*?>(?:<\/script>)?/g, '<!--M-->')
  return { nom, ns, clone, enveloppe, chemins: info.paths, natures: info.kinds, marques: Object.fromEntries(Object.keys(info.paths).map(id => [id, marque(id)])), corps, reference }
}

// exécuté dans la page (texte brut : aucune aide du compilateur de test n'y existe)
const VERIFIER = String.raw`(function (lot, teteSrc) {
  var TETE = new RegExp(teteSrc)
  function lire(src) { var t = document.createElement('template'); if (TETE.test(src)) { var w = document.createElement('template'); w.innerHTML = '<svg>' + src + '</svg>'; var s = w.content.firstChild; if (s) while (s.firstChild) t.content.appendChild(s.firstChild) } else t.innerHTML = src; return t.content }
  function sortir(fr) { var f = document.createDocumentFragment(); var w = fr.firstChild; while (w && w.firstChild) f.appendChild(w.firstChild); return f }
  function forme(n) {
    if (n.nodeType === 1) { var p = n.namespaceURI === 'http://www.w3.org/2000/svg' ? 's:' : n.namespaceURI === 'http://www.w3.org/1998/Math/MathML' ? 'm:' : ''; return p + n.localName + '[' + formes(n.localName === 'template' && n.content ? n.content.childNodes : n.childNodes) + ']' }
    if (n.nodeType === 3) return /^[ \t\n\r\f]*$/.test(n.data) ? '' : '#t'
    return n.nodeType === 8 ? (n.data === 'M' ? '#m' : '#c') : '#' + n.nodeType
  }
  function formes(l) { var o = []; for (var c of l) { var s = forme(c); if (!s || (s === '#t' && o[o.length - 1] === '#t')) continue; o.push(s) } return o.join(',') }
  return lot.map(function (c) {
    var fr = c.enveloppe ? sortir(lire('<' + c.enveloppe + '>' + c.clone + '</' + c.enveloppe + '>')) : lire(c.clone)
    var fautes = []
    for (var id of Object.keys(c.chemins)) {
      var n = fr
      for (var k of c.chemins[id]) n = n && n.childNodes[k]
      var nature = c.natures[id]
      var ok = !!n && (nature === 'text' ? n.nodeType === 8 && n.data === '$' + id : nature === 'textslot' ? n.nodeType === 3 && n.data === ' ' && n.parentNode.childNodes.length === 1 : n.nodeType === 1 && n.hasAttribute(c.marques[id]))
      if (!ok) fautes.push(id + ' [' + c.chemins[id] + '] mène à ' + (!n ? 'rien' : n.nodeType === 1 ? '<' + n.localName + '>' : n.nodeType === 8 ? 'un commentaire' : 'un texte'))
    }
    var µ = new Proxy({ _mjs_getTextNode: function () { return document.createComment('M') }, _mjs_updAttrNode: function (el, k, v) { el.setAttribute(k, String(v)) } }, { get: function (o, k) { return (k in o) ? o[k] : function () {} } })
    var imperatif = formes(new Function('µ', 'document', c.corps)(µ, document).fragment.childNodes)
    var ref = c.ns === 'http://www.w3.org/2000/svg' ? sortir(lire('<svg>' + c.reference + '</svg>')) : c.ns ? sortir(lire('<math>' + c.reference + '</math>')) : lire(c.reference)
    return { nom: c.nom, fautes: fautes, imperatif: imperatif, navigateur: formes(ref.childNodes) }
  })
})`

describe('gabarits confrontés à Chromium — chemins du mode clone et arbre du mode impératif', function () {
  this.timeout(120000)
  const resultats: Record<string, any> = {}
  let absent = false

  before(async function () {
    let playwright: any
    try { playwright = await import('playwright') } catch { absent = true; return }
    if (!existsSync(playwright.chromium.executablePath())) { absent = true; return }
    const navigateur = await playwright.chromium.launch()
    try {
      const page = await navigateur.newPage()
      await page.setContent('<!doctype html><html><body></body></html>')
      const lot = Object.entries(GABARITS).map(([nom, [html, ns]]) => preparer(nom, html, ns))
      for (const r of await page.evaluate(([code, l, tete]: any) => (0, eval)(code)(l, tete), [VERIFIER, lot, TETE_SVG.source])) resultats[r.nom] = r
    }
    finally { await navigateur.close() }
  })

  for (const nom of Object.keys(GABARITS)) {
    it(nom, function () {
      if (absent) this.skip()
      const r = resultats[nom]
      assert.deepEqual(r.fautes, [], `chemins du mode clone faux pour ${GABARITS[nom][0]}`)
      assert.equal(r.imperatif, r.navigateur, `arbre du mode impératif différent de celui du navigateur pour ${GABARITS[nom][0]}`)
    })
  }
})
