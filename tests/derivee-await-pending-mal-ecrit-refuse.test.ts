// `µpending` mal écrit (`µpending($$x)`, `µpending()`, `µpending($x.a)`), dans le script comme dans le gabarit : refusé à la construction,
// le message dit la forme juste, `µpending($nom)` ; `µfailed` mal écrit l'est déjà de même. `µpending $x` (appel sans parenthèses de
// Civet) reste la lecture de l'attente

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const MAL = (ligne: string, gabarit: string) => `<script>\n  $q = ''\n  f = (q) -> fetch("/api/e-#{q}").then((r) -> r.json())\n  $r = await f($q)\n${ligne}</script>\n<i>${gabarit}</i>\n`
const construire = (src: string) => transpile(src, { moduleName: 'mal', defaultScriptLang: 'civet', templateLang: 'civet', devWarnings: true } as any)

describe('dérivée qui attend — µpending et µfailed mal écrits refusés à la construction', function () {
  for (const [nom, src, forme] of [
    ['script µpending($$r)', MAL('  @lire = -> µpending($$r)\n', '{($r or []).length}'), /µpending\(\$nom\)/],
    ['gabarit µpending($$r)', MAL('', '{µpending($$r)}'), /µpending\(\$nom\)/],
    ['script µpending()', MAL('  @lire = -> µpending()\n', '{($r or []).length}'), /µpending\(\$nom\)/],
    ['gabarit µpending()', MAL('', '{µpending()}'), /µpending\(\$nom\)/],
    ['gabarit µpending($r.a)', MAL('', '{µpending($r.a)}'), /µpending\(\$nom\)/],
    ['script µfailed($$r)', MAL('  @lire = -> µfailed($$r)\n', '{($r or []).length}'), /µfailed\(\$nom\)/],
    ['gabarit µfailed()', MAL('', '{µfailed()}'), /µfailed\(\$nom\)/],
  ] as Array<[string, string, RegExp]>) {
    it('« ' + nom + ' » est refusé, le message dit la forme juste', async () => {
      await assert.rejects(() => construire(src), (e: any) => {
        assert.match(String(e.message), forme, String(e.message))
        return true
      })
    })
  }

  it('µpending $r, µpending($r) et µpending sans parenthèses dans un {await} restent permis', async () => {
    const r: any = await construire(MAL('  @lire = -> µpending $r\n', '{µpending($r)}{await Promise.resolve(1)}{µpending}{end}'))
    assert.match(String(r.output ?? r.code), /_mjs_awPending\(_mjsThis, 'r'\)/)
  })
})
