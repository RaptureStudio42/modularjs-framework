// Le calcul des chemins (mode clone) et l'arbre construit élément par élément (mode impératif) suivent l'arbre que le
// navigateur bâtit pour le même HTML. Écarts trouvés en confrontant les deux marcheurs de paths.ts à Chromium, tous
// atteints par un composant (le gabarit arrive tel quel au générateur, fermantes ajoutées par le compilateur comprises) :
// - une fermante sans élément ouvert de ce nom (celle qui suit un `<li>`, un `<rt>` refermés d'office, `</image>`)
//   refermait tout jusqu'à la racine : la suite du gabarit changeait de parent ; un `</p>` sans `<p>` ouvert donne un
//   `<p>` vide, comme dans le navigateur ;
// - `<button>` dans un `<button>`, `<h2>` dans un `<h1>`, `<rt>` après `<rt>`, `<a>` dans un `<a>` : le navigateur
//   referme le premier, les deux sont frères ;
// - `<col>` directement dans un `<table>` : le navigateur ouvre un `<colgroup>` ; `<tbody>` après un `<thead>` non
//   refermé referme ce dernier ;
// - un élément (composant compris) ou du texte placé directement dans un `<table>`, `<tbody>`, `<tr>` est sorti du
//   tableau par le navigateur : refusé à la construction, avec la raison ;
// - `<span>` (et les autres balises HTML qui en sortent) dans un `<svg>` : le navigateur referme le `<svg>` ;
//   `<![CDATA[…]]>` dans un `<svg>` y devient du texte ;
// - `<li>`, `<dd>`, `<dt>` dans un `<p>` le referment : refusés comme les autres éléments de bloc ;
// - `<html>`, `<head>`, `<body>` sont ignorés par le navigateur dans un gabarit ; `<image>` y devient `<img>` ;
// - `a < b` dans un texte reste UN nœud texte ;
// - `<form>` dans un `<form>`, `<select>` dans un `<select>`, `<a>` dans un `<a>` à travers un bloc : refusés ;
// - mode impératif : le contenu d'un `<template>` va dans `template.content`, là où le navigateur le range.
// La garde Chromium (gabarit-confronte-au-navigateur-browser.test.ts) rejoue ces cas dans un vrai navigateur.

import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { extractPaths, generateCreateFnBody } from '../src/generator/paths.js'
import { transpile } from '../src/transpiler/index.js'

const chemin = (html: string, id = 'x') => extractPaths(html).paths[id]

// forme de l'arbre que bâtit le mode impératif : balises, `#t` texte, `#c` commentaire (contenu d'un `<template>` lu
// dans `template.content`, comme le navigateur le range)
function arbre(html: string): string {
  const { body } = generateCreateFnBody(html, { forceImperative: true })
  const fenetre = new Window()
  const doc     = fenetre.document
  const µ = { _mjs_getTextNode: (s: string) => doc.createTextNode(s), _mjs_updAttrNode: (el: any, k: string, v: any) => el.setAttribute(k, String(v)) }
  const { fragment } = new Function('µ', 'document', body)(µ, doc)
  const forme = (n: any): string => n.nodeType === 1 ? n.localName + '[' + [...(n.localName === 'template' ? n.content.childNodes : n.childNodes)].map(forme).join(',') + ']' : (n.nodeType === 3 ? '#t' : '#c')
  const rendu = [...fragment.childNodes].map(forme).join(',')
  fenetre.happyDOM.close()
  return rendu
}

describe('gabarit — écarts du mini-analyseur avec le standard HTML', () => {
  describe('fermantes que le navigateur ignore', () => {
    it('une fermante en trop après un `<li>` refermé d\'office ne sort pas du parent', () => {
      assert.deepEqual(chemin("<div><ul><li>a<li>b</li></li></ul><p mjs-id='x'>c</p></div>"), [0, 1])
      assert.equal(arbre("<div><ul><li>a<li>b</li></li></ul><p>c</p></div>"), 'div[ul[li[#t],li[#t]],p[#t]]')
    })
    it('une fermante sans élément ouvert de ce nom est ignorée', () => {
      assert.deepEqual(chemin("<section><div>a</div></div><p mjs-id='x'>b</p></section>"), [0, 1])
      assert.deepEqual(chemin("<div><span>a</i><b mjs-id='x'>b</b></span></div>"), [0, 0, 1])
      assert.deepEqual(chemin("<div><span>a</><b mjs-id='x'>b</b></span></div>"), [0, 0, 1])
    })
    it('un `</p>` sans `<p>` ouvert pose un `<p>` vide', () => {
      assert.deepEqual(chemin("<div><ul><li><p>a<li>b</li></p></li></ul><b mjs-id='x'>c</b></div>"), [0, 1])
      assert.deepEqual(chemin("<div><p>a</p></p><b mjs-id='x'>y</b></div>"), [0, 2])
      assert.equal(arbre("<div><p>a</p></p><b>y</b></div>"), 'div[p[#t],p[],b[#t]]')
    })
  })

  describe('éléments que le navigateur referme en ouvrant le suivant', () => {
    it('`<button>` dans un `<button>`, `<h2>` dans un `<h1>`, `<a>` dans un `<a>`, `<rt>` après `<rt>` : frères', () => {
      assert.deepEqual(chemin("<div><button>a<button mjs-id='x'>b</button></button></div>"), [0, 1])
      assert.deepEqual(chemin("<div><h1>a<h2 mjs-id='x'>b</h2></h1></div>"), [0, 1])
      assert.deepEqual(chemin("<div><a href='1'>a<a mjs-id='x' href='2'>b</a></a></div>"), [0, 1])
      assert.deepEqual(chemin("<ruby>a<rt>b<rt mjs-id='x'>c</rt></rt></ruby><b mjs-id='y'>d</b>"), [0, 2])
      assert.deepEqual(chemin("<ruby>a<rt>b<rt>c</rt></rt></ruby><b mjs-id='y'>d</b>", 'y'), [1])
      assert.equal(arbre("<div><button>a<button>b</button></button></div>"), 'div[button[#t],button[#t]]')
      assert.equal(arbre("<div><h1>a<h2>b</h2></h1></div>"), 'div[h1[#t],h2[#t]]')
    })
    it('`<col>` dans un `<table>` ouvre un `<colgroup>` ; `<tbody>` referme un `<thead>` encore ouvert', () => {
      assert.deepEqual(chemin("<table><col><col><tr><td mjs-id='x'>a</td></tr></table>"), [0, 1, 0, 0])
      assert.deepEqual(chemin("<table><thead><tr><th>a</th></tr><tbody><tr><td mjs-id='x'>b</td></tr></table>"), [0, 1, 0, 0])
      assert.deepEqual(chemin("<table><caption>c<tr><td mjs-id='x'>b</td></tr></table>"), [0, 1, 0, 0])
      assert.equal(arbre("<table><col><col><tr><td>a</td></tr></table>"), 'table[colgroup[col[],col[]],tbody[tr[td[#t]]]]')
      assert.equal(arbre("<table><thead><tr><th>a</th></tr><tbody><tr><td>b</td></tr></table>"), 'table[thead[tr[th[#t]]],tbody[tr[td[#t]]]]')
    })
  })

  describe('contenu étranger (SVG)', () => {
    it('`<span>` dans un `<svg>` le referme : la suite est sœur du `<svg>`', () => {
      assert.deepEqual(chemin("<div><svg><span>a</span><g mjs-id='x'><text>b</text></g></svg></div>"), [0, 2])
      assert.equal(arbre("<div><svg><span>a</span><g><text>b</text></g></svg></div>"), 'div[svg[],span[#t],g[text[#t]]]')
    })
    it('`<![CDATA[…]]>` dans un `<svg>` est un nœud texte', () => {
      assert.deepEqual(chemin("<svg><![CDATA[x]]><g mjs-id='x'></g></svg>"), [0, 1])
      assert.equal(arbre("<svg><![CDATA[x]]><g></g></svg>"), 'svg[#t,g[]]')
    })
  })

  describe('balises que le navigateur réécrit', () => {
    it('`<html>`, `<head>`, `<body>` sont ignorés ; `<image>` devient un `<img>`, sans enfant', () => {
      assert.deepEqual(chemin("<html><body><div mjs-id='x'>a</div></body></html>"), [0])
      assert.equal(arbre("<html><body><div>a</div></body></html>"), 'div[#t]')
      assert.deepEqual(chemin("<div><image src='a'><b mjs-id='x'>y</b></image></div>"), [0, 1])
      assert.equal(arbre("<div><image src='a'><b>y</b></image></div>"), 'div[img[],b[#t]]')
    })
    it('`a < b` dans un texte reste un seul nœud texte', () => {
      assert.deepEqual(chemin("<div>si a < b alors<b mjs-id='x'>c</b></div>"), [0, 1])
    })
    it('mode impératif : le contenu d\'un `<template>` va dans `template.content`', () => {
      assert.equal(arbre("<div><template><b>z</b></template><p>q</p></div>"), 'div[template[b[#t]],p[#t]]')
    })
  })

  describe('formes refusées à la construction, avec la raison', () => {
    it('un élément ou un composant placé directement dans un tableau', async () => {
      assert.throws(() => extractPaths('<table><tbody><mjs-ligne></mjs-ligne></tbody></table>'), /<mjs-ligne> \(ligne 1\) ne peut pas être placé directement dans un <tbody>/)
      assert.throws(() => generateCreateFnBody('<table><tr><td>a</td></tr><div>b</div></table>', { forceImperative: true }), /<div> \(ligne 1\) ne peut pas être placé directement dans un <tbody>/)
      await assert.rejects(() => transpile('<script>\n$n = 7\n</script>\n<table><tbody><@ligne/></tbody></table><p>{$n}</p>', { moduleName: 'tableau-composant' }), /ne peut pas être placé directement dans un <tbody>/)
    })
    it('du texte placé directement dans un tableau', () => {
      assert.throws(() => extractPaths('<table><tr><td>a</td></tr>\ntexte<tr><td>b</td></tr></table>'), /du texte \(ligne 2\) ne peut pas être placé directement dans un <tbody>/)
    })
    it('le contenu permis d\'un tableau passe', () => {
      assert.deepEqual(chemin("<table><input type='hidden' name='a'><tbody><script type='mjs/marker' mjs-t='s1'></script>\n  <tr mjs-id='x'><td>a</td></tr></tbody></table>"), [0, 1, 2])
    })
    it('`<li>`, `<dd>`, `<dt>` dans un `<p>`', () => {
      assert.throws(() => extractPaths('<p>a<li>b</li></p>'), /<li> ne peut pas être un enfant d'un <p>/)
      assert.throws(() => generateCreateFnBody('<p>a<dd>b</dd></p>', { forceImperative: true }), /<dd> ne peut pas être un enfant d'un <p>/)
    })
    it('`<form>` dans un `<form>`, `<select>` dans un `<select>`, `<a>` dans un `<a>` à travers un bloc', () => {
      assert.throws(() => extractPaths('<form><div><form>a</form></div></form>'), /<form> \(ligne 1\) : un <form> ne peut pas être placé dans un autre <form>/)
      assert.throws(() => extractPaths('<select><option>a<select><option>b</option></select></option></select>'), /un <select> ne peut pas être placé dans un autre <select>/)
      assert.throws(() => generateCreateFnBody("<a href='1'><div><a href='2'>b</a></div></a>", { forceImperative: true }), /un <a> ne peut pas être placé dans un autre <a>/)
    })
  })
})
