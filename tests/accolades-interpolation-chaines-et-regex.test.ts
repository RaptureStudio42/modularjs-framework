// La fin d'une expression `{…}` (interpolation de gabarit `${…}` d'un script, expression du HTML) se
// trouve en lisant ses chaînes, ses commentaires et ses littéraux regex : une accolade ou un guillemet
// qu'ils contiennent ne compte pas. Avant, une accolade dans une chaîne d'un `${…}` ajoutait une `}` en
// fin de script (construction refusée par un message trompeur), et un guillemet dans une regex d'une
// expression de texte faisait sauter la traduction des directives de tout le reste du HTML.

import assert from 'node:assert/strict'
import { transpile, applyMjsSugarToScript } from '../src/transpiler/index.js'

describe('accolades et guillemets dans les chaînes et les regex d\'une expression', () => {
  it('une accolade ouvrante dans une chaîne d\'un ${…} : script inchangé, composant construit', async () => {
    const src = "$label = `${ $ouvert ? '{' : '' }`\n$n = 1"
    assert.equal(applyMjsSugarToScript(src, 'civet'), src)
    await assert.doesNotReject(transpile(`<script>\n$ouvert = true\n${src}\n</script>\n<p>{$label}{$n}</p>`, { moduleName: 'accolade-chaine' }))
  })

  it('une accolade fermante dans une chaîne d\'un ${…} : la suite de l\'expression reste du code', () => {
    const sortie = applyMjsSugarToScript("$label = `${ $a ? '}' : µfoo() }`", 'civet')
    assert.equal(sortie, "$label = `${ $a ? '}' : µ.foo() }`")
  })

  it('une accolade dans une regex d\'un ${…} : script inchangé, composant construit', async () => {
    const src = "$label = `${ $s.replace(/\\{/g, '') }`"
    assert.equal(applyMjsSugarToScript(src, 'civet'), src)
    await assert.doesNotReject(transpile(`<script>\n$s = 'a{b'\n${src}\n</script>\n<p>{$label}</p>`, { moduleName: 'accolade-regex' }))
  })

  it('un guillemet dans une regex d\'une expression de texte : les directives qui suivent sont traduites', async () => {
    const { output, data } = await transpile("<script>\n$txt = 'a'\n</script>\n<p>{ $txt.replace(/\"/g, '') }</p>\n<button @title=\"Supprimer\">x</button>", { moduleName: 'guillemet-regex' })
    assert.ok(output.includes('mjs-title'), 'infobulle de @title émise')
    assert.deepEqual(Object.keys(data.events), [], 'aucun écouteur d\'un événement « title »')
  })

  it('un guillemet dans une regex d\'une expression : le texte statique qui suit reste du texte', async () => {
    const src = "<script>\n$txt = 'a'\n</script>\n<p>{ $txt.replace(/\"/g, '') }</p>\n<p>Le magasin partagé s'écrit µ$$panier</p>"
    const { output } = await transpile(src, { moduleName: 'guillemet-regex-texte' })
    assert.ok(output.includes('µ$$panier'), 'texte affiché tel qu\'écrit')
  })

  it('les expressions ordinaires gardent leur lecture (division, bloc refermé, accolades imbriquées)', async () => {
    const src = "<script>\n$a = 4\n$o = {k: 1}\n</script>\n{if $a / 2 > 1}<p>{ $a / 2 }</p>{end}\n<p>{ {x: $o.k}.x }</p>\n<button @title=\"Ok\">x</button>"
    const { output, data } = await transpile(src, { moduleName: 'expressions-ordinaires' })
    assert.ok(output.includes('mjs-title'))
    assert.deepEqual(Object.keys(data.events), [])
  })
})
