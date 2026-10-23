// Atelier de thème, « enregistrer dans le source » : dans un fichier aux fins de ligne Windows
// (CRLF), la déclaration n'était jamais trouvée (« introuvable — reconstruire ? »), le `\r` final
// empêchant le motif de finir la ligne. Désormais trouvée, et les CRLF sont conservés.

import assert from 'node:assert/strict'
import { rewriteThemeValue } from '../src/server/theme-write.js'

describe('theme-write — fichier aux fins de ligne CRLF', () => {
  it('déclaration trouvée et réécrite, CRLF conservés', () => {
    const lf   = '<style>\n:root\n  $$accent: #ff0000\n  $$fond: #fff\n</style>\n'
    const crlf = lf.replace(/\n/g, '\r\n')
    const r = rewriteThemeValue(crlf, 'accent', 'mjs', '#00ff00')
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.before, '#ff0000')
    assert.equal(r.source, crlf.replace('#ff0000', '#00ff00'))
  })
})
