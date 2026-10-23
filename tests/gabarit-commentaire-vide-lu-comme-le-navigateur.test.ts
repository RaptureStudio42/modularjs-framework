// Un commentaire HTML se lit comme le navigateur le lit : `<!-->` et `<!--->` sont des commentaires VIDES, refermés sur
// place (le standard HTML les accepte, avec une erreur d'analyse), et `--!>` referme un commentaire comme `-->`. Le
// compilateur cherchait toujours le `-->` suivant : `<div><!--><b>{$n}</b><!-- fin --></div>` devenait `<div></div>`,
// la valeur disparaissait sans un mot, là où le navigateur affiche le `<b>`. Toutes les passes qui sautent, masquent
// ou retirent un commentaire lisent désormais les mêmes bornes (motif partagé de mask.ts).

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extractPaths, generateCreateFnBody } from '../src/generator/paths.js'
import { extractDirectives } from '../src/transpiler/directives.js'
import * as masque from '../src/mask.js'
import { monterHote } from './helpers/coeur-monter.js'

// forme de l'arbre que bâtit le mode impératif : balises, `#t` texte, `#c` commentaire
function arbre(html: string): string {
  const { body } = generateCreateFnBody(html, { forceImperative: true })
  const fenetre = new Window()
  const doc     = fenetre.document
  const µ = { _mjs_getTextNode: (s: string) => doc.createTextNode(s), _mjs_updAttrNode: (el: any, k: string, v: any) => el.setAttribute(k, String(v)) }
  const { fragment } = new Function('µ', 'document', body)(µ, doc)
  const forme = (n: any): string => n.nodeType === 1 ? n.localName + '[' + [...n.childNodes].map(forme).join(',') + ']' : (n.nodeType === 3 ? '#t' : '#c')
  const rendu = [...fragment.childNodes].map(forme).join(',')
  fenetre.happyDOM.close()
  return rendu
}

describe('gabarit — un commentaire se referme là où le navigateur le referme', () => {
  it('composant : la valeur qui suit `<!-->`, `<!--->` ou un commentaire fermé par `--!>` s\'affiche', async () => {
    const source = [
      '<script>',
      '$n = 7',
      '</script>',
      '<div class="a"><!--><b>{$n}</b><!-- fin --></div>',
      '<div class="b"><!---><i>{$n}</i><!-- fin --></div>',
      '<div class="c"><!-- note --!><u>{$n}</u><!-- fin --></div>',
      '<div class="d"><!-- <s>{$n}</s> --></div>',
    ].join('\n')
    const { window, hote, erreurs } = await monterHote(source, 'commentaire-vide')
    try {
      const ombre = hote._shadow
      assert.equal(ombre.querySelector('.a b')?.textContent, '7')
      assert.equal(ombre.querySelector('.b i')?.textContent, '7')
      assert.equal(ombre.querySelector('.c u')?.textContent, '7')
      // contre-cas : un vrai commentaire reste inerte
      assert.equal(ombre.querySelectorAll('.d s').length, 0)
      assert.equal(erreurs.length, 0, erreurs.join('\n'))
    }
    finally {
      await window.happyDOM.close()
    }
  })

  it('lecture d\'un commentaire ouvert : fin et contenu', () => {
    assert.deepEqual(masque.readHtmlComment('a<!-->b', 1), { end: 6, data: '' })
    assert.deepEqual(masque.readHtmlComment('<!--->b', 0), { end: 6, data: '' })
    assert.deepEqual(masque.readHtmlComment('<!---->b', 0), { end: 7, data: '' })
    assert.deepEqual(masque.readHtmlComment('<!-- x --!>b-->', 0), { end: 11, data: ' x ' })
    assert.deepEqual(masque.readHtmlComment('<!-- x -- >b-->', 0), { end: 15, data: ' x -- >b' })
    assert.deepEqual(masque.readHtmlComment('<!--!>b-->', 0), { end: 10, data: '!>b' })
    assert.equal(masque.readHtmlComment('<!-- jamais refermé', 0), null)
  })

  it('masque des commentaires : rien d\'autre que le commentaire vide n\'est blanchi', () => {
    assert.equal(masque.maskHtmlComments('<!--><b>x</b><!-- y -->'), ' '.repeat(5) + '<b>x</b>' + ' '.repeat(10))
    assert.equal(masque.maskHtmlComments('<!---><b>x</b>'), ' '.repeat(6) + '<b>x</b>')
  })

  it('générateur, mode clone et mode impératif : le nœud qui suit le commentaire vide est à sa place', () => {
    assert.deepEqual(extractPaths("<div><!--><b mjs-id='x'>y</b><!-- fin --></div>").paths.x, [0, 1])
    assert.deepEqual(extractPaths("<div><!---><b mjs-id='x'>y</b></div>").paths.x, [0, 1])
    assert.equal(arbre('<div><!--><b>y</b><!-- fin --></div>'), 'div[#c,b[#t],#c]')
    assert.equal(arbre('<div><!-- a --!><b>y</b></div>'), 'div[#c,b[#t]]')
    // contre-cas : un commentaire ordinaire
    assert.deepEqual(extractPaths("<div><!-- a --><b mjs-id='x'>y</b></div>").paths.x, [0, 1])
  })

  it('directive racine écrite après un commentaire vide : prise en compte, comme le navigateur la verrait', () => {
    assert.equal(extractDirectives('<!-->\n@preload hover\n<!-- fin -->\n<p>ok</p>\n').modulePreload, 'hover')
    // contre-cas : dans un vrai commentaire, elle reste inerte
    assert.equal(extractDirectives('<!--\n@preload hover\n-->\n<p>ok</p>\n').modulePreload, null)
  })

  it('aucune passe du compilateur ne cherche plus le `-->` suivant à la main', () => {
    const racine = join(import.meta.dirname, '..', 'src')
    const fichiers: string[] = []
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom)
        if (statSync(chemin).isDirectory()) parcourir(chemin)
        else if (nom.endsWith('.ts')) fichiers.push(chemin)
      }
    }
    for (const d of ['analyzer', 'bundler', 'generator', 'lexer', 'parser', 'transpiler']) parcourir(join(racine, d))
    fichiers.push(join(racine, 'mask.ts'))
    const fautifs = fichiers.flatMap((f) => readFileSync(f, 'utf-8').split('\n').map((l, i) => ({ f, i, l })))
      .filter(({ l }) => !/^\s*(\/\/|\*)/.test(l) && (l.includes('<!--[\\s\\S]*?-->') || l.includes("indexOf('-->'")))
      .map(({ f, i }) => `${f.slice(racine.length + 1)}:${i + 1}`)
    assert.deepEqual(fautifs, [], 'lire un commentaire comme le navigateur : readHtmlComment (mask.ts), ou le motif `<!--(?:-?>|[\\s\\S]*?--!?>)`')
  })
})
