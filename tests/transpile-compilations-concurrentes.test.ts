// Deux appels de transpile() lancés en même temps (Promise.all, un serveur qui compile à la demande) rendent
// chacun la sortie qu'ils rendent seuls : avant, les deux compilations partageaient l'état du générateur et les
// effets de l'appli — un composant perdait sa transition, un autre en héritait, la déclaration `let el;` d'une
// référence `@this=!{el}` disparaissait (ReferenceError au montage), un effet de l'appli devenait inconnu.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { collectEffectDefs } from '../src/bundler/effects-files.js'

const A = '<script>\n$show = true\n</script>\n{if $show}\n<p @transition=*fade>x</p>\n{end}\n<button @click={$show = !$show}>t</button>'
const B = '<script>\n$n = 0\n</script>\n<button @click={$n++}>{$n}</button>'
const C = '<script>\nµmount -> console.log(el)\n</script>\n<button @this=!{el} @click={$k = 1}>x</button>'

describe('transpile() — deux compilations en même temps ne se mêlent pas', function () {
  this.timeout(60000)
  const sources: Record<string, string> = { A, B, C }
  const seules: Record<string, string> = {}

  before(async () => {
    const warn = console.warn
    console.warn = () => {}
    try {
      for (const k of Object.keys(sources)) seules[k] = (await transpile(sources[k], { moduleName: k.toLowerCase() })).output
    }
    finally {
      console.warn = warn
    }
    assert.match(seules.A, /fade/)
    assert.match(seules.C, /let el;/)
  })

  for (const ordre of [['A', 'B'], ['B', 'A'], ['A', 'C'], ['C', 'B'], ['B', 'C', 'A']]) {
    it(`Promise.all ${ordre.join(' + ')} : chaque sortie est celle de la compilation seule`, async () => {
      const warn = console.warn
      console.warn = () => {}
      let rendus: { output: string }[]
      try {
        rendus = await Promise.all(ordre.map(k => transpile(sources[k], { moduleName: k.toLowerCase() })))
      }
      finally {
        console.warn = warn
      }
      ordre.forEach((k, i) => assert.equal(rendus[i].output, seules[k], `sortie de ${k} changée par la compilation voisine`))
    })
  }

  it('les effets de l\'appli d\'une compilation restent les siens quand une autre, sans effets, tourne en même temps', async () => {
    const effectDefs = collectEffectDefs(['/x/app.effects.mjs'], () => '<effects>\n  *titre = *scramble(20)\n</effects>\n')
    const avecEffet = '<script>\n$n = 1\n</script>\n<p *titre>ABC {$n}</p>'
    const seule = (await transpile(avecEffet, { moduleName: 'carte', effectDefs })).output
    const [carte] = await Promise.all([
      transpile(avecEffet, { moduleName: 'carte', effectDefs }),
      transpile(B, { moduleName: 'b' }),
    ])
    assert.equal(carte.output, seule)
  })

  it('l\'effet de l\'appli n\'est pas prêté à une compilation qui ne le déclare pas', async () => {
    const effectDefs = collectEffectDefs(['/x/app.effects.mjs'], () => '<effects>\n  *titre = *scramble(20)\n</effects>\n')
    const sansDefs = '<script>\n$n = 1\n</script>\n<p *titre>ABC {$n}</p>'
    await assert.rejects(transpile(sansDefs, { moduleName: 'seule' }), /titre/)
    const [seule, carte] = await Promise.allSettled([
      transpile(sansDefs, { moduleName: 'seule' }),
      transpile(sansDefs.replace('$n = 1', '$m = 2'), { moduleName: 'carte', effectDefs }),
    ])
    assert.equal(seule.status, 'rejected')
    assert.equal(carte.status, 'fulfilled')
  })
})
