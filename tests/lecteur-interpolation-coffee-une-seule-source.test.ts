// La conversion Coffee `"…#{X}…"` → gabarit `` `…${X}…` `` existait en deux copies (gabarit : generator/utils.ts ;
// <script> : transpiler/index.ts). Une seule fonction désormais, dans le lexeur, à côté du lecteur de chaînes qu'elle
// partage déjà ; le <script> et le gabarit en reçoivent la même sortie

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import * as lexeur from '../src/lexer/index.js'
import * as utils from '../src/generator/utils.js'

const SRC = new URL('../src/', import.meta.url)

describe('lecteur d\'interpolation Coffee : une seule source', () => {
  it('une seule définition de la conversion dans src/', () => {
    const fichiers = (readdirSync(SRC, { recursive: true }) as string[]).filter(f => /\.ts$/.test(f))
    const definitions = fichiers.filter(f => /function (?:convertCoffeeInterpolations|toTemplateLiteral)\b/.test(readFileSync(new URL(f, SRC), 'utf8')))
    assert.deepEqual(definitions, ['lexer/index.ts'])
  })

  it('le gabarit utilise la fonction du lexeur', () => {
    const conv = (lexeur as any).convertCoffeeInterpolations
    assert.equal(typeof conv, 'function')
    assert.equal((utils as any).convertCoffeeInterpolations, conv)
    assert.equal(conv('"a #{b} c" + \'d #{e}\''), '`a ${b} c` + \'d #{e}\'')
  })
})
