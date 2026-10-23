// Une erreur du lexeur levée DANS une interpolation (`"x #{&$v} y"`, `` `…${…}` ``) cite la ligne et la colonne de
// la faute dans le fichier, comme hors de l'interpolation ; un `µeffect` imbriqué cite la ligne du `.mjs` même
// quand le <script> ne commence pas à la ligne 1.
//
// Défaut : le contenu d'une interpolation était relu comme un texte neuf, sans sa place dans le script : l'erreur
// citait toujours `<fichier>.script:1:1`. Le refus d'un `µeffect` imbriqué comptait les lignes depuis la balise
// <script> (« ligne 4 du <script> »), pas depuis le haut du fichier comme les autres refus.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function erreurDe(source: string): Promise<string> {
  try {
    await transpile(source, { moduleName: 'sonde' })
  }
  catch (e: any) {
    return String(e?.message ?? e)
  }
  assert.fail('la compilation aurait dû échouer')
}

const script = (lignes: string[], gabarit = '<div>{$a}</div>') => `<script>\n${lignes.join('\n')}\n</script>\n${gabarit}\n`

describe('erreurs du lexeur situées — aussi dans une interpolation', () => {
  it('témoin hors interpolation : ligne 5', async () => {
    assert.match(await erreurDe(script([ '$a = 1', 'b = 2', 'c = 3', 'd = &$v' ])), /sonde\.script:5:6 /)
  })

  it('dans `"x #{…} y"` : ligne 5, même colonne que hors interpolation (celle du `$`)', async () => {
    assert.match(await erreurDe(script([ '$a = 1', 'b = 2', 'c = 3', 'd = "x #{&$v} y"' ])), /sonde\.script:5:11 /)
  })

  it('crochet mal écrit dans une interpolation : ligne 5', async () => {
    assert.match(await erreurDe(script([ '$a = 1', 'b = 2', 'c = 3', 'd = "x #{µmounted -> 1} y"' ])), /sonde\.script:5:\d+ /)
  })

  it('gabarit à backtick, interpolation sur sa 2e ligne : ligne 6', async () => {
    assert.match(await erreurDe(script([ '$a = 1', 'b = 2', 'c = 3', 'd = `x', '${&$v} y`' ])), /sonde\.script:6:3 /)
  })
})

describe('µeffect imbriqué — la ligne du fichier', () => {
  it('<script> après le gabarit : la ligne du `.mjs`', async () => {
    const source = '<p>{$a}</p>\n\n<script>\n$a = 1\nf = ->\n  µeffect ->\n    console.log 1\n</script>\n'
    assert.match(await erreurDe(source), /µeffect[^\n]*\(ligne 6\)/)
  })

  it('témoin : <script module>, la ligne du `.mjs`', async () => {
    const source = '<script module>\nx = 1\nµeffect -> 1\n</script>\n<script>\n$a = 1\n</script>\n<p>{$a}</p>\n'
    assert.match(await erreurDe(source), /µeffect[^\n]*\(ligne 3\)/)
  })
})
