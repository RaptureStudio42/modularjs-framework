// Éditeur de texte riche du cœur (<@@editor>) : le nettoyeur de HTML, joué dans happy-dom.
// Tout HTML qui entre (la valeur posée par la page) est lu dans un <template> inerte, réduit à un petit modèle de blocs (paragraphes,
// titres h2 et h3, citation, listes, passages en gras, italique, souligné, barré, lien) puis RÉÉCRIT : la sortie est la même quel que soit
// le navigateur qui a fabriqué le DOM, et rien d'autre que la liste permise n'en sort. Le champ caché du formulaire porte ce HTML
// propre ; la valeur de la page, elle, n'est pas réécrite à l'affichage.
// - balises ramenées aux quatre marques (b, i, strike, del, ins, cite, ou un style `font-weight`…), titres h1 à h6 ramenés à h2 et h3 ;
// - attributs retirés (class, style, id, dir, target, onclick…), seul `href` reste sur un lien, `data-checklist` et `data-checked` sur les listes ;
// - adresses : http, https, mailto, tel et les relatives ; `javascript:`, `data:`, `vbscript:` (même coupés d'une tabulation) font disparaître le lien ;
// - script, style, cadre, svg, formulaire… partent avec leur contenu, une balise inconnue garde son texte, un tableau devient des paragraphes ;
// - listes à cocher : `data-checked="false"` est décoché, une liste GitHub (case native) est reconnue, `ul > ul` est rangé dans la ligne d'avant ;
// - jamais de balise en ligne vide (une espace de queue marquée tombe avec sa balise), le gras de Word (`mso-bidi-font-weight`) n'est pas du
//   poids de police, ni `mso-bidi-font-style` du style de police, un bloc `<pre>` garde le retour à la ligne de chaque ligne ;
// - nettoyer deux fois donne la même chose que nettoyer une fois : chaque sortie, remise en entrée, ressort à l'identique.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monter } from './helpers/editeur-riche.js'

const HOTE = `<script>
  $cas = window.__donnees ?? []
</script>

{for i, c in $cas by i}
  <@@editor name={"n" + i} toolbar="none" value={c}></@@editor>
{end}
`

// [ce que le test vérifie, le HTML qui entre, le HTML propre attendu]
const CAS: Array<[string, string, string]> = [
  ['b et i deviennent strong et em, dans un paragraphe', '<b>a</b> <i>b</i>', '<p><strong>a</strong> <em>b</em></p>'],
  ['div devient paragraphe', '<div>a</div><div>b</div>', '<p>a</p><p>b</p>'],
  ['h1 devient h2, h4 à h6 deviennent h3, h2 et h3 restent', '<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>', '<h2>a</h2><h2>b</h2><h3>c</h3><h3>d</h3><h3>e</h3><h3>f</h3>'],
  ['les espaces insécables et les blancs en trop se replient', '<p>a&nbsp;&nbsp;b</p><p>  c \n  d  </p>', '<p>a b</p><p>c d</p>'],
  ['paragraphes vides, saut de ligne de tête et de queue disparaissent', '<p></p><p>   </p><p><br></p><p><br>x<br></p>', '<p>x</p>'],
  ['les balises en doublon fusionnent', '<strong>a</strong><strong>b</strong><em>c</em><em>d</em>', '<p><strong>ab</strong><em>cd</em></p>'],
  ['l\'ordre des marques est toujours gras, italique, souligné, barré', '<s><u><em><strong>x</strong></em></u></s>', '<p><strong><em><u><s>x</s></u></em></strong></p>'],
  ['strike, del, ins et cite sont ramenés à s, u et em', '<strike>a</strike><del>b</del><ins>c</ins><cite>d</cite>', '<p><s>ab</s><u>c</u><em>d</em></p>'],
  ['le gras écrit en style est reconnu, le « normal » non', '<span style="font-weight:700">a</span><span style="font-weight:bold">b</span><span style="font-weight:normal">c</span>', '<p><strong>ab</strong>c</p>'],
  ['le gras de Word (mso-bidi-font-weight:normal sur un <b>) est gardé', "<b style='mso-bidi-font-weight:normal'>Titre</b>", '<p><strong>Titre</strong></p>'],
  ['une propriété qui finit par font-weight n\'est pas le poids de police (mso-bidi-, -webkit-)', '<span style="-webkit-font-weight:700">a</span><span style="mso-bidi-font-weight:bold">b</span><span style="color:red;font-weight:700">c</span>', '<p>ab<strong>c</strong></p>'],
  ['la propriété de Word avant font-weight ne masque pas le gras', "<span style='mso-bidi-font-weight:normal;font-weight:bold'>x</span><span style='font-weight : 700 !important'>y</span>", '<p><strong>xy</strong></p>'],
  ['l\'enveloppe de Google Docs n\'est pas du gras', '<b style="font-weight:normal" id="docs-internal-guid-1"><p dir="ltr">a <span style="font-weight:700">b</span></p></b>', '<p>a <strong>b</strong></p>'],
  ['italique, souligné et barré écrits en style', '<span style="font-style:italic">i</span><span style="text-decoration:underline">u</span><span style="text-decoration: line-through">s</span>', '<p><em>i</em><u>u</u><s>s</s></p>'],
  ['une propriété qui finit par font-style n\'est pas le style de police (mso-bidi-)', '<span style="mso-bidi-font-style:italic">a</span><span style="color:red;font-style : oblique">b</span>', '<p>a<em>b</em></p>'],
  ['class, id, style, dir et gestionnaires disparaissent', '<p class="x" id="y" style="color:red" dir="rtl" onclick="globalThis.__pwn=1">t</p>', '<p>t</p>'],
  ['un lien garde son seul href (échappé), pas target ni rel ni class', '<a href="https://a.fr/x?y=1&amp;z=2" target="_blank" rel="noopener" class="c">l</a>', '<p><a href="https://a.fr/x?y=1&amp;z=2">l</a></p>'],
  ['http, https, mailto, tel et les adresses relatives sont permis', '<a href="http://a.fr">1</a> <a href="mailto:a@b.fr">2</a> <a href="tel:+33123">3</a> <a href="/chemin">4</a> <a href="page.html">5</a> <a href="#ancre">6</a>', '<p><a href="http://a.fr">1</a> <a href="mailto:a@b.fr">2</a> <a href="tel:+33123">3</a> <a href="/chemin">4</a> <a href="page.html">5</a> <a href="#ancre">6</a></p>'],
  ['javascript:, data:, vbscript: (même coupés d\'une tabulation ou en majuscules) font disparaître le lien, le texte reste', '<a href="javascript:globalThis.__pwn=2">j</a><a href="  JaVa\tScRiPt:globalThis.__pwn=3">k</a><a href="data:text/html;base64,AAA">d</a><a href="vbscript:x">v</a><a href="java&#9;script:x">e</a>', '<p>jkdve</p>'],
  ['une espace dans l\'adresse est codée', '<a href="https://a.fr/a b">x</a>', '<p><a href="https://a.fr/a%20b">x</a></p>'],
  ['script, style, cadre, svg, champs et boutons partent avec leur contenu', '<div>a<script>globalThis.__pwn=4</script>b<style>x{}</style><iframe src="//e"></iframe><svg onload="globalThis.__pwn=5"><circle></circle></svg><textarea>t</textarea><select><option>o</option></select><button>b</button>c</div>', '<p>abc</p>'],
  ['un formulaire entier est retiré', '<form action="/x"><input value="z"><p>dedans</p></form><p>dehors</p>', '<p>dehors</p>'],
  ['une image disparaît sans laisser de trace, son gestionnaire ne joue pas', '<p>a<img src="x" onerror="globalThis.__pwn=6">b</p>', '<p>ab</p>'],
  ['une balise inconnue ou ancienne garde son texte', '<custom-tag>t</custom-tag><font color="red">f</font><center>c</center>', '<p>tf</p><p>c</p>'],
  ['un tableau devient une suite de paragraphes', '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>', '<p>a</p><p>b</p><p>c</p>'],
  ['listes à puces et numérotées imbriquées', '<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><ol><li>1</li></ol>', '<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><ol><li>1</li></ol>'],
  ['liste à cocher : data-checklist et data-checked gardés', '<ul data-checklist><li data-checked>a</li><li>b</li></ul>', '<ul data-checklist><li data-checked>a</li><li>b</li></ul>'],
  ['data-checked="false" se lit « décoché », data-checklist="false" est une liste ordinaire', '<ul data-checklist><li data-checked="false">a</li></ul><ul data-checklist="false"><li data-checked>b</li></ul>', '<ul data-checklist><li>a</li></ul><ul><li>b</li></ul>'],
  ['une liste GitHub (case native) devient une liste à cocher', '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked disabled> fait</li><li class="task-list-item"><input type="checkbox"> à faire</li></ul>', '<ul data-checklist><li data-checked>fait</li><li>à faire</li></ul>'],
  ['une sous-liste de liste à cocher reste à cocher, une ul posée dans une ul se range dans la ligne d\'avant', '<ul data-checklist><li>a</li><ul data-checklist><li data-checked>b</li></ul></ul>', '<ul data-checklist><li>a<ul data-checklist><li data-checked>b</li></ul></li></ul>'],
  ['citation : ses lignes sont des paragraphes', '<blockquote>a<p>b</p></blockquote>', '<blockquote><p>a</p><p>b</p></blockquote>'],
  ['un titre garde ses marques', '<h2><b>x</b> y</h2>', '<h2><strong>x</strong> y</h2>'],
  ['les caractères de largeur nulle sont retirés', '<p>a​b﻿c</p>', '<p>abc</p>'],
  ['des marques imbriquées ne ferment que la différence', '<b>a <i>b</i> c</b>', '<p><strong>a <em>b</em> c</strong></p>'],
  ['un texte sans balise devient un paragraphe, ses caractères spéciaux sont échappés', 'a &lt;b&gt; &amp; c', '<p>a &lt;b&gt; &amp; c</p>'],
  ['une espace de queue marquée en gras ne laisse pas de balise vide', '<p>gamma delta<b> </b></p>', '<p>gamma delta</p>'],
  ['en italique, souligné, barré : aucune balise vide', '<p>x<em> </em></p><p>y<u> </u><s> </s></p>', '<p>x</p><p>y</p>'],
  ['un lien réduit à une espace disparaît avec elle', '<p>a<a href="https://x.test/"> </a></p>', '<p>a</p>'],
  ['aucune balise vide au bout d\'une ligne de liste ni d\'un titre', '<ul><li>a<b> </b></li></ul><h2>titre<b> </b></h2>', '<ul><li>a</li></ul><h2>titre</h2>'],
  ['une espace marquée entre deux mots reste (la balise n\'est pas vide)', '<p>a<b> </b> b</p>', '<p>a<strong> </strong>b</p>'],
  ['un lien, une espace et un retour à la ligne', '<p><a href="https://x.test/">lien</a> <br>suite</p>', '<p><a href="https://x.test/">lien<br></a>suite</p>'],
  ['un bloc <pre> garde le retour à la ligne de chaque ligne, lignes vides comprises', '<pre>a\nb\n\nc</pre>', '<p>a<br>b<br><br>c</p>'],
  ['un <pre><code> aussi, et le paragraphe qui suit reste à part', '<p>avant</p><pre><code>x\ny</code></pre><p>z</p>', '<p>avant</p><p>x<br>y</p><p>z</p>'],
  ['les retours à la ligne d\'un <pre> en fin de bloc ne laissent pas de <br> final', '<pre>a\nb\n</pre>', '<p>a<br>b</p>'],
  ['une valeur vide donne la chaîne vide', '', ''],
  ['un paragraphe vide donne la chaîne vide', '<p><br></p>', ''],
  ['seulement des blancs donne la chaîne vide', '   ', ''],
  ['seulement un script donne la chaîne vide', '<script>globalThis.__pwn=7</script>', '']
]

describe('éditeur riche : le nettoyeur de HTML (happy-dom)', function () {
  this.timeout(120000)
  let window: any
  let hote: any
  let hote2: any

  const editeur  = (i: number) => hote._shadow.querySelectorAll('mjs-core-editor')[i]
  const editeur2 = (i: number) => hote2._shadow.querySelectorAll('mjs-core-editor')[i]
  const champ    = (i: number) => Array.from(editeur(i).children).find((c: any) => c.localName === 'input' && c.type === 'hidden') as any
  const champ2   = (i: number) => Array.from(editeur2(i).children).find((c: any) => c.localName === 'input' && c.type === 'hidden') as any
  const surface  = (i: number) => editeur(i)._shadow.querySelector('.surface')

  before(async () => {
    ;({ window, hote } = await monter(HOTE, 'editeur-nettoyeur', CAS.map((c) => c[1])))
    await attendre(() => CAS.every((_, i) => !!editeur(i)?._shadow?.querySelector('.surface')), 10000)
    const sorties = CAS.map((_, i) => champ(i)?.value ?? '')
    ;({ hote: hote2 } = await monter(HOTE, 'editeur-nettoyeur-bis', sorties))
    await attendre(() => CAS.every((_, i) => !!editeur2(i)?._shadow?.querySelector('.surface')), 10000)
  })

  after(async () => { await terminateSharedWorkerPool() })

  CAS.forEach(([nom, , attendu], i) => it(nom, function () {
    assert.equal(champ(i)?.value, attendu, 'le champ du formulaire porte le HTML propre')
    assert.equal(surface(i).innerHTML.replace(/ aria-description="[^"]*"/g, '').replace(/=""/g, ''), attendu || '<p><br></p>', 'la surface montre le même HTML (un document vide reste un paragraphe vide)')
  }))

  CAS.forEach(([nom], i) => it(`nettoyer deux fois = nettoyer une fois : ${nom}`, function () {
    assert.equal(champ2(i)?.value, champ(i)?.value, 'la sortie remise en entrée ressort à l\'identique')
  }))

  it('rien de ce qui entre ne s\'exécute', function () {
    assert.equal(window.eval('typeof globalThis.__pwn'), 'undefined')
  })

  it('un éditeur sans valeur donne un champ vide et une surface vide', function () {
    assert.equal(CAS.filter((c) => c[1] === '').length, 1)
  })
})
