// un gabarit refusé par l'arbre unique reçoit le refus du compilateur, tel qu'il le lit : l'erreur fatale de lecture cite le
// gabarit à partir de l'endroit où la lecture bute (`"<@"`, pas `"\t<@"` ni le texte qui précède) ; un `<@slot>` suivi d'autre
// chose que des blancs reste ouvert, et le jeton de bloc refusé juste après lui est situé dans `<slot>` ; une fermante de trop
// écrite dans une balise raccourci refermée plus loin (rendue vide par l'arbre à un jeton de bloc qui suit) est annoncée par
// l'avertissement d'une fermeture mal appariée de cette balise, puis refusée comme orpheline

import { strict as assert } from 'node:assert'
import { parse, type TagRef } from '../src/parser/index.js'

interface Lu { erreur?: string, console: string[] }

const net = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

// une lecture du gabarit, ses messages de console retenus
function lire(html: string): Lu {
  const garde = { log: console.log, warn: console.warn, error: console.error }
  const messages: string[] = []
  console.log = console.warn = console.error = (...x: unknown[]) => { messages.push(net(x.map(String).join(' '))) }
  try {
    const refs: TagRef[] = []
    parse(html, refs, {})
    return { console: messages }
  }
  catch (e) {
    return { erreur: net((e as Error).message), console: messages }
  }
  finally {
    Object.assign(console, garde)
  }
}

describe('lecteur unique : refus situé là où le compilateur bute', () => {
  it('l\'erreur fatale de lecture cite le gabarit à partir du jeton fautif, sans le blanc ni le texte qui le précèdent', () => {
    const cas: [string, string][] = [
      ['{if $a}\n<ul><li>\t<@', '"<@"'],
      ['<div class="c0">{$x}\r\n</d', '"</d"'],
      ['<ul><li>\t&#123;<@carte/></li><li>z</l<@carte>i></ul>\r\n', '"</l<@carte>i></ul>"'],
      ['{key $k}\r\n<@carte titre="t">\t<img src="a.png" alt=\'b\'>\r\n</@carte{else}>\n{end}', '"</@carte{else}>\\n{end}"'],
      ['<@carte titre="t">\t{"}"}\t</@', '"</@"'],
      ['<@carte titre="t">\t&#123;\n</@ca', '"</@ca"'],
    ]
    for (const [html, extrait] of cas) {
      const lu = lire(html)
      assert.ok(lu.erreur?.includes('[ERREUR DE PARSING FATALE]'), `${JSON.stringify(html)} : erreur fatale (${lu.erreur})`)
      assert.ok(lu.erreur!.includes(`Extrait incriminé : ${extrait}\n`), `${JSON.stringify(html)} : extrait ${extrait} (${lu.erreur})`)
    }
  })

  it('un `<@slot>` suivi d\'autre chose que des blancs reste ouvert : le jeton de bloc refusé après lui est dans `<slot>`', () => {
    for (const html of ['<@carte/><section><@slot>{else}</ul></code>', '<section><@slot>{else}</ul>']) {
      const lu = lire(html)
      assert.ok(lu.erreur?.includes('[JETON HORS DE SON BLOC] `{else}` ligne 1 n\'a pas de sens dans `<slot>` (ouvert ligne 1).'), `${JSON.stringify(html)} : ${lu.erreur}`)
    }
    // suivi de blancs et de commentaires seulement : vide, comme `<@slot/>`
    assert.equal(lire('<div>a</div>\n<@slot>\n<!-- fin -->\n').erreur, undefined)
  })

  it('une fermante de trop dans une balise raccourci refermée plus loin : l\'avertissement de cette balise, puis le refus de l\'orpheline', () => {
    const lu = lire('<@carte titre="t"></section>{else}</tr></@carte>{for i in $l}</@slot>')
    assert.ok(lu.erreur?.includes('[BALISE FERMANTE ORPHELINE] `</section>` ligne 1 : aucune balise ouvrante correspondante.'), String(lu.erreur))
    assert.deepEqual(lu.console.map((m) => m.replace(/\s+/g, ' ').trim()), ['[ModularJS] ⚠️ <mjs-carte> ouverte ligne 1 n\'est pas refermée par </mjs-carte> : </section> rencontrée ligne 1 à la place. Vérifiez l\'imbrication des balises. [lint.syntax]'])
  })
  it('cette fermante de trop garde les balises et les blocs ouverts autour d\'elle : leurs avertissements, dans l\'ordre, et le bloc jamais refermé', () => {
    const mal = (ouverte: string, trouve: string): string => `[ModularJS] ⚠️ <${ouverte}> ouverte ligne 1 n'est pas refermée par </${ouverte}> : </${trouve}> rencontrée ligne 1 à la place. Vérifiez l'imbrication des balises. [lint.syntax]`
    const cas: [string, string, string[]][] = [
      ['<div><@carte titre="t"></section>{else}</tr></@carte></div>', '[BALISE FERMANTE ORPHELINE] `</section>`', [mal('mjs-carte', 'section'), mal('div', 'section')]],
      ['<@carte titre="t"><span></b></span>{end}</@carte>', '[BALISE FERMANTE ORPHELINE] `</b>`', [mal('span', 'b'), mal('mjs-carte', 'b')]],
      ['<@carte titre="t"><p><b></p></section>{else}</tr></@carte>', '[BALISE FERMANTE ORPHELINE] `</section>`', [mal('b', 'p'), mal('mjs-carte', 'section')]],
      ['{if $a}<@carte titre="t"></section>{else}</tr></@carte>{end}', '[BLOC NON FERMÉ] `{if $a}`', [mal('mjs-carte', 'section')]],
      ['<@carte titre="t">{key $k}</h><svg><![CDATA[</@carte>', '[BLOC NON FERMÉ] `{key $k}`', []],
      ['<@boite><@carte titre="t"><v></@carte></k{end}</@boite>', 'Extrait incriminé : "</k{end}</@boite>"', [mal('v', '@carte')]],
    ]
    for (const [html, erreur, avis] of cas) {
      const lu = lire(html)
      assert.ok(lu.erreur?.includes(erreur), `${JSON.stringify(html)} : ${lu.erreur}`)
      assert.deepEqual(lu.console.map((m) => m.replace(/\s+/g, ' ').trim()), avis, JSON.stringify(html))
    }
  })
})
