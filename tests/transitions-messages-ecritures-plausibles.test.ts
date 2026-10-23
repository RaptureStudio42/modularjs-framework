// Transitions : des messages justes sur trois écritures plausibles. `@in="*fly"` (entre guillemets)
// ne s'entend pas dire « @in attend un effet » : l'effet est là, ce sont les guillemets de trop.
// `@in.local=*fly` (habitude Svelte) ne s'entend pas dire « écrivez @in=*local » : `.local` est un
// modificateur inconnu, pas un nom d'effet ; l'ancienne écriture `@in.fly={…}` garde son message.
// Une transition maison (`µanim.create`) prend des valeurs fixes : `'a' + 'b'` est un calcul, refusé
// comme tel, pas lu comme le texte « a' + 'b » ; une apostrophe échappée reste dans son texte.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const MAISON = "<script>\n  µanim.create 'maison', css: (t) -> { opacity: t }\n</script>\n"

describe('transitions : les messages des écritures plausibles', () => {
  it('@in="*fly" : les guillemets sont de trop, le message donne @in=*fly', async () => {
    await assert.rejects(
      transpile('{if true}<div @in="*fly">x</div>{end}\n', { moduleName: 'tx-guillemets' }),
      (err: any) => err.message.includes('@in=*fly') && /guillemets/.test(err.message) && !/attend un effet/.test(err.message)
    )
  })

  it('@in="*fly(up)" : avec ses réglages aussi — une seule écriture, sans guillemets', async () => {
    await assert.rejects(
      transpile('{if true}<div @in="*fly(up, duration: 300ms)">x</div>{end}\n', { moduleName: 'tx-guillemets-reglages' }),
      (err: any) => err.message.includes('@in=*fly(up, duration: 300ms)') && /guillemets/.test(err.message)
    )
  })

  it("@out='*fade' : pareil entre apostrophes", async () => {
    await assert.rejects(
      transpile("{if true}<div @out='*fade'>x</div>{end}\n", { moduleName: 'tx-apostrophes' }),
      (err: any) => err.message.includes('@out=*fade') && /guillemets/.test(err.message)
    )
  })

  it('@in.local=*fly : modificateur inconnu, pas un nom d\'effet', async () => {
    await assert.rejects(
      transpile('{if true}<div @in.local=*fly>x</div>{end}\n', { moduleName: 'tx-local' }),
      (err: any) => /\.local/.test(err.message) && /modificateur/.test(err.message) && !/\*local/.test(err.message)
    )
    await assert.rejects(
      transpile('{if true}<div @transition.local=*slide(x)>x</div>{end}\n', { moduleName: 'tx-local-reglages' }),
      (err: any) => /@transition\.local/.test(err.message) && /modificateur/.test(err.message) && !/\*local/.test(err.message)
    )
  })

  it('l\'ancienne écriture @in.fly={…} garde son message', async () => {
    await assert.rejects(transpile('{if true}<div @in.fly={{y: 20}}>x</div>{end}\n', { moduleName: 'tx-ancienne' }), /écrivez @in=\*fly/)
  })

  it('@in.global=*fly reste permis', async () => {
    const { output } = await transpile('{if true}<div @in.global=*fly(up)>x</div>{end}\n', { moduleName: 'tx-global' })
    assert.match(output, /_mjs_fxAnim\([^)]*"fly"/)
  })

  it('transition maison : un calcul entre les parenthèses est refusé, pas lu comme un texte', async () => {
    await assert.rejects(
      transpile(`${MAISON}{if true}<div @in=*maison(t: 'a' + 'b')>x</div>{end}\n`, { moduleName: 'tx-maison-calcul' }),
      (err: any) => /pas de calcul/.test(err.message) && /t = 'a' \+ 'b'/.test(err.message)
    )
  })

  it('transition maison : une apostrophe échappée reste dans son texte', async () => {
    const { output } = await transpile(`${MAISON}{if true}<div @in=*maison(t: 'l\\'avion', u: 'x, y')>x</div>{end}\n`, { moduleName: 'tx-maison-echappe' })
    assert.ok(output.includes(`"t": "l'avion"`), output.slice(output.indexOf('_mjs_fxAnimCustom'), output.indexOf('_mjs_fxAnimCustom') + 120))
    assert.ok(output.includes(`"u": "x, y"`))
  })
})
