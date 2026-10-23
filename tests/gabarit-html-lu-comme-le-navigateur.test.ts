// Le gabarit d'un composant est lu comme le lit le navigateur : les chemins calculés au build (mode clone)
// et l'arbre construit élément par élément (mode impératif, branches `{await}`) doivent être l'arbre que
// le navigateur bâtit pour le même HTML, sinon le composant plante au montage ou écrit dans le mauvais nœud.
//
// Défauts garantis absents :
// - `<li>`, `<dt>`/`<dd>`, `<td>`/`<th>`, `<tr>`, `<option>` non refermés (HTML valide) étaient imbriqués
//   dans leur prédécesseur au lieu d'en être les frères : plantage au montage ;
// - une valeur `{…}` placée dans un `<template>` plantait au montage (le navigateur range ce contenu à part) :
//   refusée désormais à la construction, avec un message clair ;
// - une instruction de traitement `<?x?>` (ou `<!…>`, `<![CDATA[…]]>` hors SVG), que le navigateur change en
//   commentaire, n'était pas comptée : la valeur suivante disparaissait ;
// - `<p>Texte <button><div>…</div></button></p>` était refusé alors qu'un `<button>` arrête la recherche du `<p>` ;
// - la ligne citée par l'erreur du `<p>` était recalculée depuis le début du gabarit à chaque balise.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extractPaths, generateCreateFnBody } from '../src/generator/paths.js'
import { transpile } from '../src/transpiler/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

// construit le fragment d'un corps impératif dans un vrai document, rend le HTML de son premier enfant
function construire(html: string): string {
  const { body } = generateCreateFnBody(html, { forceImperative: true })
  const fenetre = new Window()
  const doc     = fenetre.document
  const µ = { _mjs_getTextNode: (s: string) => doc.createTextNode(s), _mjs_updAttrNode: (el: any, k: string, v: any) => el.setAttribute(k, String(v)) }
  const { fragment } = new Function('µ', 'document', body)(µ, doc)
  const conteneur = doc.createElement('div')
  conteneur.appendChild(fragment)
  const rendu = conteneur.innerHTML
  fenetre.happyDOM.close()
  return rendu
}

const COMPOSANTS: Record<string, string[]> = {
  'nav-li': ['<script>', '$n = 7', '</script>', '<ul class="u"><li>a<li class="x">{$n}</ul>'],
  'nav-td': ['<script>', '$n = 7', '</script>', '<table><tr><td>a<td class="x">{$n}</tr></table>'],
  'nav-option': ['<script>', '$n = 7', '</script>', '<select class="s"><option>a<option class="x">{$n}</select>'],
  'nav-dl': ['<script>', '$n = 7', '</script>', '<dl><dt>a<dd class="x">{$n}</dl>'],
  'nav-pi': ['<script>', '$n = 7', '</script>', '<div class="pi"><?x?><b class="x">{$n}</b></div>'],
  'nav-template': ['<script>', '$n = 7', '</script>', '<div class="w"><template class="tp"><b>fixe</b></template><p class="x">{$n}</p></div>'],
  'nav-bouton': ['<script>', '$n = 1', '</script>', '<p class="p">Texte <button class="b"><div class="x">{$n}</div></button></p>'],
}

function projetTemporaire(): string {
  const root   = mjsTmp('gabarit-navigateur')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, lignes] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), lignes.join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('gabarit lu comme le navigateur — chemins et arbre impératif', () => {
  describe('éléments non refermés (fermeture implicite du standard HTML)', () => {
    it('un `<li>` ouvert referme le `<li>` précédent : les deux sont frères', () => {
      assert.deepEqual(extractPaths("<ul><li>a<li mjs-id='x'>b</ul>").paths.x, [0, 1])
      assert.equal(construire("<ul><li>a<li mjs-id='x'>b</ul>"), '<ul><li>a</li><li>b</li></ul>')
    })
    it('une liste imbriquée garde ses `<li>` dans la liste intérieure', () => {
      assert.deepEqual(extractPaths("<ul><li>a<ul><li>b<li mjs-id='n'>c</ul></ul>").paths.n, [0, 0, 1, 1])
    })
    it('`<td>`, `<tr>`, `<option>`, `<dt>`/`<dd>` se referment de même', () => {
      assert.deepEqual(extractPaths("<table><tr><td>a<td mjs-id='y'>b</tr></table>").paths.y, [0, 0, 0, 1])
      assert.deepEqual(extractPaths("<table><tr><td>a<tr mjs-id='v'><td>b</table>").paths.v, [0, 0, 1])
      assert.deepEqual(extractPaths("<select><option>a<option mjs-id='z'>b</select>").paths.z, [0, 1])
      assert.deepEqual(extractPaths("<dl><dt>a<dd mjs-id='w'>b</dl>").paths.w, [0, 1])
      assert.equal(construire("<table><tr><td>a<td mjs-id='y'>b</tr></table>"), '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>')
      assert.equal(construire("<select><option>a<option mjs-id='z'>b</select>"), '<select><option>a</option><option>b</option></select>')
    })
  })

  describe('`<template>`', () => {
    it('une valeur placée dans un `<template>` est refusée à la construction, avec la raison', async () => {
      const src = '<script>\n$n = 7\n</script>\n<div class="w"><template class="tp"><b>{$n}</b></template><p class="after">{$n}</p></div>'
      await assert.rejects(() => transpile(src, { moduleName: 'gabarit-template' }), /<template>.*template\.content/s)
      assert.throws(() => generateCreateFnBody("<div><template><b>${v.x}</b></template></div>", { forceImperative: true }), /<template>/)
    })
    it('un `<template>` sans valeur reste permis et la suite de son parent garde ses chemins', () => {
      assert.deepEqual(extractPaths("<div><template><b>z</b></template><p mjs-id='r'>q</p></div>").paths.r, [0, 1])
    })
  })

  describe('instructions de traitement et déclarations', () => {
    it('`<?x?>`, `<!x>` et `<![CDATA[…]]>` hors SVG comptent comme le commentaire que le navigateur en fait', () => {
      assert.deepEqual(extractPaths("<div><?x?><b mjs-id='s'>y</b></div>").paths.s, [0, 1])
      assert.deepEqual(extractPaths("<div><!x><b mjs-id='s'>y</b></div>").paths.s, [0, 1])
      assert.deepEqual(extractPaths("<div><![CDATA[x]]><b mjs-id='s'>y</b></div>").paths.s, [0, 1])
      assert.equal(construire("<div><?x?><b>y</b></div>"), '<div><!--?x?--><b>y</b></div>')
    })
    it('un `<!DOCTYPE>` reste sans nœud', () => {
      assert.deepEqual(extractPaths("<div><!DOCTYPE html><b mjs-id='s'>y</b></div>").paths.s, [0, 0])
    })
  })

  describe('`<p>` et la portée d\'un `<button>`', () => {
    it('`<p>… <button><div>` est accepté : le `<button>` arrête la recherche du `<p>`', () => {
      assert.deepEqual(extractPaths("<p>T <button><div mjs-id='u'>y</div></button></p>").paths.u, [0, 1, 0])
      assert.equal(construire("<p>T <button><div>y</div></button></p>"), '<p>T <button><div>y</div></button></p>')
    })
    it('`<p><span><div>` reste refusé, avec la bonne ligne', () => {
      assert.throws(() => extractPaths('<p>T <span><div>y</div></span></p>'), /<div> ne peut pas être un enfant d'un <p>/)
      assert.throws(() => extractPaths('<section>\n<p>\na\n<span>\n<div>y</div></span></p></section>'), /ligne 5/)
      assert.throws(() => generateCreateFnBody('<section>\n<p>\na\n<span>\n<div>y</div></span></p></section>', { forceImperative: true }), /ligne 5/)
    })
  })

  describe('composants montés', function () {
    this.timeout(90000)
    let app: any

    before(async () => { app = await createHarness({ root: projetTemporaire() }) })
    after(async () => { if (app) await app.destroy() })

    for (const [nom, attendu] of [['nav-li', '7'], ['nav-td', '7'], ['nav-option', '7'], ['nav-dl', '7'], ['nav-pi', '7'], ['nav-template', '7'], ['nav-bouton', '1']]) {
      it(`${nom} monte et affiche ${attendu}`, async () => {
        const c = await app.mount(nom)
        try { assert.equal(c.text('.x'), attendu) }
        finally { c.destroy() }
      })
    }
  })
})
