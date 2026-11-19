// une chaîne à trois guillemets dans une expression du gabarit (`{"""a "x # y" b"""}`, `{'''a 'x # y' b'''}`) se lisait comme trois
// chaînes : le `#` d'entre elles ouvrait un commentaire, et la construction refusait l'expression coupée. Elle se lit d'un bloc, jusqu'à
// ses trois guillemets fermants ; un commentaire écrit après elle en reste un

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function construire(src: string): Promise<{ msg: string, out: string }> {
  const e = console.error, w = console.warn
  console.error = console.warn = () => {}
  try {
    const r: any = await transpile(src, { moduleName: 'cas' })
    return { msg: '', out: String(r.output) }
  }
  catch (err: any) {
    return { msg: String(err?.message ?? err), out: '' }
  }
  finally {
    console.error = e
    console.warn = w
  }
}

describe('expression du gabarit : une chaîne à trois guillemets se lit d\'un bloc, son # compris', function () {
  this.timeout(60000)

  for (const [nom, gabarit, attendu] of [
    ['{"""a "x # y" b"""}', '<p>{"""a "x # y" b"""}</p>', '`a "x # y" b`'],
    ['{\'\'\'a \'x # y\' b\'\'\'}', '<p>{\'\'\'a \'x # y\' b\'\'\'}</p>', '`a \'x # y\' b`'],
    ['{"""a "x" b""" # note}', '<p>{"""a "x" b""" # note}</p>', '`a "x" b`'],
  ] as Array<[string, string, string]>) {
    it(`${nom} : construit, le texte de la chaîne`, async () => {
      const r = await construire(gabarit + '\n')
      assert.equal(r.msg, '')
      assert.ok(r.out.includes(`_mjs_updText('t1', ${attendu})`), r.out.split('\n').filter((l) => l.includes('_mjs_updText')).join('\n'))
      assert.doesNotMatch(r.out, /note/)
    })
  }
})
