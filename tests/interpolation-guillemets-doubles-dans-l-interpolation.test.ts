// `"Bonjour #{ if $ok then "oui" else "non" }"` : une interpolation peut porter ses propres guillemets
// doubles. Les lecteurs de chaîne s'arrêtaient au premier guillemet intérieur : en CoffeeScript le texte
// affiché devenait « Bonjour }oui » (une accolade ajoutée en silence), en Civet le <script> refusait de
// compiler, et l'expression de gabarit aussi. Un seul lecteur, celui du lexeur, sert désormais aux trois.

import assert from 'node:assert/strict'
import * as lexeur from '../src/lexer/index.js'
import { cleanJsExpr } from '../src/generator/utils.js'
import { monterHote } from './helpers/coeur-monter.js'

const CHAINE = '"Bonjour #{ if $ok then "oui" else "non" }"'

describe('interpolation #{…} portant des guillemets doubles', function () {
  this.timeout(60000)

  it('le lecteur de chaîne traverse l\'interpolation', () => {
    assert.equal(typeof lexeur.scanDoubleQuoteAt, 'function')
    assert.equal(lexeur.scanDoubleQuoteAt(CHAINE + ' + 1', 0), CHAINE.length)
    assert.equal(lexeur.scanDoubleQuoteAt('"a" + "b"', 0), 3)
    assert.equal(lexeur.scanDoubleQuoteAt('"a \\" b"', 0), 8)
    assert.equal(lexeur.scanDoubleQuoteAt('"pas fermée\n"', 0), -1)
    assert.equal(lexeur.scanDoubleQuoteAt('"a #{ b"', 0), 8)
  })

  it('lexeur : la chaîne est lue jusqu\'à son vrai guillemet fermant', () => {
    assert.equal(lexeur.tokenize('$msg = ' + CHAINE), '$.msg = "Bonjour #{ if $.ok then "oui" else "non" }"')
  })

  it('lexeur : une interpolation jamais refermée est recopiée sans accolade ajoutée', () => {
    assert.equal(lexeur.tokenize('$msg = "a #{ $b"'), '$.msg = "a #{ $b"')
  })

  it('<script lang="coffee"> : affiche « Bonjour oui »', async () => {
    const { hote } = await monterHote(`<script lang="coffee">\n$ok = true\n$msg = ${CHAINE}\n</script>\n<p>{$msg}</p>`, 'interp-guillemets-coffee')
    assert.equal(hote._shadow?.querySelector('p')?.textContent, 'Bonjour oui')
  })

  it('<script> Civet : compile et affiche « Bonjour oui »', async () => {
    const { hote } = await monterHote(`<script>\n$ok = true\n$msg = ${CHAINE}\n</script>\n<p>{$msg}</p>`, 'interp-guillemets-civet')
    assert.equal(hote._shadow?.querySelector('p')?.textContent, 'Bonjour oui')
  })

  it('expression de gabarit : compile et affiche « a x b »', async () => {
    assert.doesNotThrow(() => cleanJsExpr('"a #{ if $ok then "x" else "y" } b"'))
    const { hote } = await monterHote('<script>\n$ok = true\n</script>\n<p>{"a #{ if $ok then "x" else "y" } b"}</p>', 'interp-guillemets-gabarit')
    assert.equal(hote._shadow?.querySelector('p')?.textContent, 'a x b')
  })
})
