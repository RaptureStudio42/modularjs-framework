// Squelette d'office d'un {await} : jamais dans du contenu SVG ou MathML. Sa zone est un <div> garni
// de barres HTML, qui n'a pas sa place dans un <svg> ou un <math> : un {await} sans branche
// d'attente y compile comme avant, sans squelette ; un <foreignObject> rouvre du HTML, et le
// squelette y revient, comme après la fermeture du <svg>. Un `*skeleton` écrit sur un {await} dans
// un <svg> ou un <math> est refusé par un message qui parle de ce qui est écrit (l'{await}), pas du
// <div> que le compilateur aurait posé.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const SCRIPT = '<script>\n  $p = Promise.resolve(1)\n</script>\n'
const zones  = (out: string) => (out.match(/mjs-skel-zone/g) ?? []).length

describe('squelette d\'office : pas dans un <svg> ni un <math>', () => {
  it('un {await} sans attente dans un <svg> compile, sans squelette', async () => {
    const { output } = await transpile(`${SCRIPT}<svg viewBox="0 0 10 10">\n  {await $p}\n  {success d}\n    <path d={d}></path>\n  {end}\n</svg>\n`, { moduleName: 'squelette-svg' })
    assert.equal(zones(output), 0)
  })

  it('pareil dans un <math>', async () => {
    const { output } = await transpile(`${SCRIPT}<math>\n  {await $p}{success n}<mn>{n}</mn>{end}\n</math>\n`, { moduleName: 'squelette-math' })
    assert.equal(zones(output), 0)
  })

  it('pareil dans un {if} lui-même dans un <svg>', async () => {
    const { output } = await transpile(`${SCRIPT}<svg>\n  <g>\n    {if $p}\n      {await $p}{success n}<text>{n}</text>{end}\n    {end}\n  </g>\n</svg>\n`, { moduleName: 'squelette-svg-if' })
    assert.equal(zones(output), 0)
  })

  it('un <foreignObject> rouvre du HTML : le squelette y revient', async () => {
    const { output } = await transpile(`${SCRIPT}<svg>\n  <foreignObject>\n    {await $p}{success n}<p>{n}</p>{end}\n  </foreignObject>\n</svg>\n`, { moduleName: 'squelette-foreign' })
    assert.equal(zones(output), 1)
  })

  it('après la fermeture du <svg>, le squelette revient aussi', async () => {
    const { output } = await transpile(`${SCRIPT}<svg>\n  {await $p}{success n}<text>{n}</text>{end}\n</svg>\n<div>\n  {await $p}{success n}<p>{n}</p>{end}\n</div>\n`, { moduleName: 'squelette-apres-svg' })
    assert.equal(zones(output), 1)
  })

  it('un *skeleton écrit sur un {await} dans un <svg> : refusé, le message cite l\'{await} et sa ligne', async () => {
    await assert.rejects(
      transpile(`${SCRIPT}<svg>\n  {await $p *skeleton}{success n}<text>{n}</text>{end}\n</svg>\n`, { moduleName: 'squelette-svg-ecrit' }),
      (err: any) => /\{await … \*skeleton\}/.test(err.message) && /ligne 5/.test(err.message) && /<svg>/.test(err.message) && !/<div>/.test(err.message)
    )
  })

  it('dans un <math>, le message nomme <math>', async () => {
    await assert.rejects(
      transpile(`${SCRIPT}<math>\n  {await $p *skeleton}{success n}<mn>{n}</mn>{end}\n</math>\n`, { moduleName: 'squelette-math-ecrit' }),
      (err: any) => /\{await … \*skeleton\}/.test(err.message) && /<math>/.test(err.message)
    )
  })
})
