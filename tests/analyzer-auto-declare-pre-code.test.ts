// autoDeclareFromTemplate (analyzer/index.ts) ne retirait que les commentaires HTML avant de
// scanner `$xxx` dans le template — un exemple de documentation affichant `$__proto__` (nom
// réservé) en texte, à l'intérieur d'un <pre>/<code>, faisait échouer la compilation d'une page
// qui ne fait qu'illustrer la garde en prose, sans aucune vraie liaison. Un `$xxx` dans un
// <pre>/<code> qui n'est PAS un nom réservé était lui aussi auto-déclaré à tort (state var
// fantôme, jamais dans aucun effect) — même famille, moins visible (pas d'erreur).

import assert from 'node:assert/strict'
import { Analyzer } from '../src/analyzer/index.js'
import { transpile } from '../src/transpiler/index.js'

describe('analyzer — autoDeclareFromTemplate ignore <pre>/<code> (documentation, jamais du code)', () => {
  it('un $var mentionné dans <pre><code> ne casse plus la compilation, même un nom réservé', async () => {
    const src = '<pre><code>$__proto__ = 1 // nom refuse</code></pre>\n<script>\n$compte = 0\n</script>'
    await assert.doesNotReject(transpile(src, { moduleName: 'preCodeReserve' }))
  })

  it('un $var mentionné dans <code> seul (hors <pre>) n\'est pas auto-déclaré', () => {
    const a = new Analyzer('', [])
    a.autoDeclareFromTemplate('<p>Exemple : <code>$exempleDoc</code></p>')
    assert.equal(a.stateVars.includes('exempleDoc'), false)
  })

  it('un $var mentionné dans <pre> seul (hors <code>) n\'est pas auto-déclaré', () => {
    const a = new Analyzer('', [])
    a.autoDeclareFromTemplate('<pre>$exemplePre = 1</pre>')
    assert.equal(a.stateVars.includes('exemplePre'), false)
  })

  it('non-régression — un $var utilisé HORS <pre>/<code> reste auto-déclaré', () => {
    const a = new Analyzer('', [])
    a.autoDeclareFromTemplate('<p>{$compteurReel}</p>')
    assert.equal(a.stateVars.includes('compteurReel'), true)
  })

  // le TEXTE d'un <pre>/<code> est verbatim, mais une interpolation `{…}` y reste compilée comme
  // partout (le gabarit la rend vivante) : ses `$x` sont de vrais liens, déclarés et réactifs
  it('une interpolation {$x} DANS un <code> ou un <pre> est déclarée (lien vivant)', () => {
    const a = new Analyzer('', [])
    a.autoDeclareFromTemplate('<p>Le paquet <code>{$nomPaquet}</code> ; <pre>$brut et {$interp}</pre></p>')
    assert.equal(a.stateVars.includes('nomPaquet'), true)
    assert.equal(a.stateVars.includes('interp'), true)
    assert.equal(a.stateVars.includes('brut'), false, 'le texte hors accolades reste verbatim')
  })

  it('accolade DANS une chaîne d\'une interpolation : ni liaison perdue, ni texte qui redevient du code', async () => {
    const a = new Analyzer('', [])
    a.autoDeclareFromTemplate('<code>{"a}" + $apresBrace}</code><code>{$avantOrphelin + "{"}\ntexte $texteApres en prose</code>')
    assert.equal(a.stateVars.includes('apresBrace'), true, 'le } de la chaîne ne referme pas l\'interpolation')
    assert.equal(a.stateVars.includes('avantOrphelin'), true)
    assert.equal(a.stateVars.includes('texteApres'), false, 'le { de la chaîne n\'ouvre pas le texte qui suit')
    const src = '<code>{$avantOrphelin + "{"} puis en texte $__proto__</code>\n<script>\n$avantOrphelin = 1\n</script>'
    await assert.doesNotReject(transpile(src, { moduleName: 'preCodeAccoladeChaine' }))
  })

  it('une interpolation {$x} dans un <code> suit les changements de $x (composant compilé)', async () => {
    const { output } = await transpile('<p>Le paquet <code>{$nomPaquet}</code>.</p>', { moduleName: 'preCodeInterp' })
    assert.match(output, /_mjs_var_bits = \{[^}]*"nomPaquet": 1/)
    assert.match(output, /"nomPaquet": \[_mjs_eff\[\d+\]\]/, 'l\'effet d\'affichage est rattaché à $nomPaquet')
  })

  it('non-régression — un $var mentionné dans un commentaire HTML reste ignoré', () => {
    const a = new Analyzer('', [])
    a.autoDeclareFromTemplate('<!-- $fantome -->')
    assert.equal(a.stateVars.includes('fantome'), false)
  })
})
