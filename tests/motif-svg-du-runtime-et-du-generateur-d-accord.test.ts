// Le générateur (foreignWrapTag, generator/paths.ts) doit savoir quelles balises `µ._mjs_cloneTpl` (runtime,
// mjs_init.ts) lit déjà dans un <svg>. Le runtime part chez le client en texte brut et n'importe rien du compilateur :
// le motif y reste écrit, le générateur en garde une copie exportée, et ce test garde les deux identiques

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as paths from '../src/generator/paths.js'

describe('motif des balises SVG : runtime et générateur d\'accord', () => {
  it('même source, mêmes drapeaux', () => {
    const src = readFileSync(new URL('../src/runtime/mjs_init.ts', import.meta.url), 'utf8')
    const m   = /^µ\._mjs_svgTagRe = \/(.+)\/([a-z]*);$/m.exec(src)
    assert.ok(m, 'motif du runtime introuvable')
    const copie = (paths as any).RUNTIME_SVG_HEAD_RE
    assert.ok(copie instanceof RegExp, 'motif du générateur non exporté')
    assert.deepEqual([copie.source, copie.flags], [m![1], m![2]])
    assert.ok(copie.test('<circle r="1"/>') && !copie.test('<a href="#">'))
  })
})
