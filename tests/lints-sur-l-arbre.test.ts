// Les contrôles du gabarit (accessibilité, <form> sans action) et les relevés d'images (`<@@img>`, réglages d'image
// des effets) lisent l'arbre du lecteur unique : une balise n'existe que dans le balisage. Écrite dans une chaîne
// d'une expression `{…}`, dans un <textarea>, un <script> ou un <style>, elle n'est qu'un texte ; le relevé par le
// texte brut la prenait pour une vraie balise (alerte fausse, image cherchée pour rien, construction refusée quand
// le fichier n'existait pas).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkA11y } from '../src/transpiler/a11y.js'
import { checkUjsForm } from '../src/transpiler/ujs-form.js'
import { scanEffectImages } from '../src/transpiler/effect-images.js'
import { scanImgTags } from '../src/transpiler/img-tag.js'
import { t } from '../src/messages/index.js'

describe('contrôles et relevés du gabarit lus sur l\'arbre', () => {
  it('a11y : une balise écrite dans une chaîne d\'une expression n\'est pas contrôlée', () => {
    const html = '<p>{$aide or \'<img src="a.png">\'}</p>\n<p>{µt(\'lien\', { a: \'<a href="/x"></a>\' })}</p>\n'
    assert.deepEqual(checkA11y(html, 'expression'), [])
  })

  it('a11y : un <img> écrit dans un <textarea> est son texte', () => {
    assert.deepEqual(checkA11y('<label for="n">Note</label>\n<textarea id="n"><img src="a.png"></textarea>\n', 'zone'), [])
  })

  it('a11y : la vraie balise qui suit l\'expression reste contrôlée, à sa ligne', () => {
    const attendu = [t('transpiler.a11y-img-alt-manquant', { moduleName: 'suite', ligne: 3 })]
    assert.deepEqual(checkA11y('<p>{\'<b>\'}</p>\n<p>texte</p>\n<img src="a.png">\n', 'suite'), attendu)
  })

  it('<form> : une balise écrite dans une chaîne d\'une expression ou dans un <textarea> n\'est pas un formulaire', () => {
    assert.deepEqual(checkUjsForm('<p>{$modele or \'<form>\'}</p>\n', 'expression'), [])
    assert.deepEqual(checkUjsForm('<textarea name="x"><form></textarea>\n', 'zone'), [])
    assert.deepEqual(checkUjsForm('<p>{\'<b>\'}</p>\n<form></form>\n', 'suite'), [t('transpiler.lint.ujs-form', { file: 'suite', ligne: 2 })])
  })

  it('effets : un réglage d\'image écrit dans une chaîne d\'une expression n\'est pas relevé', () => {
    assert.deepEqual(scanEffectImages('<p>{$fond or \'<div *behind("a.jpg")>\'}</p>\n'), [])
    const vrai = scanEffectImages('<p>{\'<b>\'}</p>\n<div *behind(\'a.jpg\')></div>\n')
    assert.deepEqual(vrai.map(e => [e.effet, e.chemin]), [['behind', 'a.jpg']])
  })

  it('<@@img> : une balise écrite dans une chaîne d\'une expression n\'est pas relevée', () => {
    assert.deepEqual(scanImgTags('<p>{$photo or \'<@@img src="a.png">\'}</p>\n'), [])
  })

  it('<@@img> : seul le balisage d\'un composant entier est lu (script, style, commentaire, pre, code sautés)', () => {
    const source = [
      '<script>',
      '  $modele = "<@@img src=\'script.png\'>"',
      '</script>',
      '<style>',
      '  /* <@@img src="style.png"> */',
      '</style>',
      '<!-- <@@img src="commentaire.png"> -->',
      '<pre><@@img src="pre.png"></pre>',
      '<code><@@img src="code.png"></code>',
      '<@@img src="vrai.png" alt="">',
      '',
    ].join('\n')
    const tags = scanImgTags(source)
    assert.deepEqual(tags.map(x => x.src), ['vrai.png'])
    assert.equal(tags[0].text, '<@@img src="vrai.png" alt="">')
    assert.equal(source.slice(tags[0].start, tags[0].end), tags[0].text)
  })

  it('les quatre fichiers lisent l\'arbre, plus aucun masque ni découpage de texte à eux', () => {
    for (const f of ['a11y', 'ujs-form', 'effect-images', 'img-tag']) {
      const code = readFileSync(new URL(`../src/transpiler/${f}.ts`, import.meta.url), 'utf8')
      assert.ok(!/from '\.\.\/mask\.js'|from '\.\/tag-reader\.js'|from '\.\/macro-tag\.js'/.test(code), `${f}.ts importe encore un masque ou un découpage de texte`)
      assert.ok(/from '\.\/template-tree\.js'/.test(code), `${f}.ts ne lit pas l'arbre`)
    }
  })
})
