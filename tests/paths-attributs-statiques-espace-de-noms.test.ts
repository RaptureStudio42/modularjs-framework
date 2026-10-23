// voie impérative (corps d'une branche construite élément par élément) : un élément créé en espace de noms SVG ou MathML ne reçoit jamais
// une affectation de propriété mais `setAttribute` ; `className` et `href` n'ont qu'un accesseur de lecture sur un élément SVG (écrire lève
// une TypeError, la branche et le composant avec elle) et `title` n'y existe pas (l'affectation ne poserait aucun attribut)
// un élément HTML ne garde l'écriture de propriété que pour `class` et `id`, que tout élément reflète en attribut : les autres attributs
// statiques passent par `setAttribute`, comme les pose le navigateur à la lecture du HTML (`<div placeholder>` garde son attribut,
// `form.reset()` remet la valeur écrite d'un champ) ; rien d'autre ne change dans la sortie

import assert from 'node:assert/strict'
import { generateCreateFnBody } from '../src/generator/paths.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

// les attributs que la voie impérative écrivait en propriété sur un élément HTML (seuls `class` et `id` le restent)
const PROPRIETES = ['class', 'id', 'value', 'type', 'name', 'placeholder', 'title', 'alt', 'href', 'src', 'role', 'for']

const corps = (html: string, opts: object = {}): string => generateCreateFnBody(html, { forceImperative: true, ...opts }).body

describe('voie impérative : les attributs statiques selon l\'espace de noms de l\'élément', function () {
  for (const [nom, balise] of [['SVG', 'svg'], ['MathML', 'math']] as const) it(`un élément ${nom} reçoit chaque attribut par setAttribute, jamais par une propriété`, () => {
    const c = corps(`<${balise} ${PROPRIETES.map((n) => `${n}="x"`).join(' ')}></${balise}>`)
    for (const n of PROPRIETES) assert.match(c, new RegExp(`_mjs_e\\d+\\.setAttribute\\("${n}", "x"\\);`), `${n} par setAttribute`)
    assert.doesNotMatch(c, /_mjs_e\d+\.\w+ = /, 'aucune affectation de propriété')
  })

  it('un élément HTML : propriété pour `class` et `id` seulement, `setAttribute` pour les autres — rien d\'autre ne change dans la sortie', () => {
    assert.equal(corps('<div class="x" id="y" title="t"><a href="/u" role="r">z</a></div>'), [
      'const _mjs_fr = document.createDocumentFragment();',
      'const _mjs_e0 = document.createElement("div");',
      '_mjs_e0.className = "x";',
      '_mjs_e0.id = "y";',
      '_mjs_e0.setAttribute("title", "t");',
      '_mjs_fr.appendChild(_mjs_e0);',
      'const _mjs_e1 = document.createElement("a");',
      '_mjs_e1.setAttribute("href", "/u");',
      '_mjs_e1.setAttribute("role", "r");',
      '_mjs_e0.appendChild(_mjs_e1);',
      'const _mjs_e2 = document.createTextNode("z");',
      '_mjs_e1.appendChild(_mjs_e2);',
      'return { fragment: _mjs_fr, refs: {} };'
    ].join('\n'))
    assert.equal(corps('<form><input type="text" name="n" value="v" placeholder="p"><img src="s.png" alt="a"><label for="n">l</label></form>'), [
      'const _mjs_fr = document.createDocumentFragment();',
      'const _mjs_e0 = document.createElement("form");',
      '_mjs_fr.appendChild(_mjs_e0);',
      'const _mjs_e1 = document.createElement("input");',
      '_mjs_e1.setAttribute("type", "text");',
      '_mjs_e1.setAttribute("name", "n");',
      '_mjs_e1.setAttribute("value", "v");',
      '_mjs_e1.setAttribute("placeholder", "p");',
      '_mjs_e0.appendChild(_mjs_e1);',
      'const _mjs_e2 = document.createElement("img");',
      '_mjs_e2.setAttribute("src", "s.png");',
      '_mjs_e2.setAttribute("alt", "a");',
      '_mjs_e0.appendChild(_mjs_e2);',
      'const _mjs_e3 = document.createElement("label");',
      '_mjs_e3.setAttribute("for", "n");',
      '_mjs_e0.appendChild(_mjs_e3);',
      'const _mjs_e4 = document.createTextNode("l");',
      '_mjs_e3.appendChild(_mjs_e4);',
      'return { fragment: _mjs_fr, refs: {} };'
    ].join('\n'))
  })

  it('sous <foreignObject> l\'élément redevient HTML et garde l\'écriture de propriété, le <svg> lui reste en setAttribute', () => {
    const c = corps('<svg class="s"><foreignObject><div class="h"></div></foreignObject></svg>')
    assert.match(c, /_mjs_e0\.setAttribute\("class", "s"\);/, 'le <svg> : setAttribute')
    assert.match(c, /createElement\("div"\);\n_mjs_e\d+\.className = "h";/, 'le <div> sous foreignObject : propriété')
  })

  it('la racine d\'un fragment placé dans un <svg> du dehors (branche {await}) est un élément SVG : setAttribute', () => {
    assert.match(corps('<circle class="c" r="1"></circle>', { foreignNsRoot: SVG_NS }), /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "circle"\);\n_mjs_e0\.setAttribute\("class", "c"\);/)
  })
})
