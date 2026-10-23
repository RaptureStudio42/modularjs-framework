// Le catalogue des effets et ce qu'il dit au build :
// - *weight : les bornes min et max acceptent les valeurs de l'axe `wdth` (75 à 125), plus seulement celles de la graisse ;
// - un ancien nom traduit (`*lens(blur: 55)` → `*filter.lens`) ramène la valeur dans la plage de l'effet qui le remplace, et le dit :
//   l'écriture proposée se compile ;
// - deux effets d'une même balise qui dessinent dans le même pseudo-élément (`::before`, `::after`) : un avertissement du build les
//   nomme (un seul des deux apparaîtrait) ; des effets qui n'y dessinent pas, ou pas avec ces réglages, ne disent rien ;
// - les réglages d'image et de texte de la page que le moteur reconnaît par leur nom (mjs_fx.ts) sont ceux du catalogue.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EFFECTS, parseEffect, removedEffectError } from '../src/effects/catalog.js'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const avertissements = async (html: string) =>
  ((await transpile(html, { moduleName: 'essai-pseudo' })).data.sectionWarnings as string[]).filter((l) => l.includes('pseudo-élément'))

describe('catalogue des effets — bornes de *weight, ancien nom ramené dans la plage, pseudo-éléments partagés, accord avec le moteur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('*weight(axis: wdth, min: 75, max: 125) se compile', () => {
    assert.doesNotThrow(() => parseEffect('weight', 'axis: wdth, min: 75, max: 125'))
    assert.throws(() => parseEffect('weight', 'min: 0'))
  })

  it('*lens(blur: 55) : la traduction propose blur: 50 (la limite de *filter), le dit, et se compile', () => {
    const msg = removedEffectError('lens', 'blur: 55') ?? ''
    const m   = /\*filter\.lens\(([^)]*)\)/.exec(msg)
    assert.ok(m, msg)
    assert.match(m![1], /blur: 50\b/, msg)
    assert.match(msg, /55/, `le message dit la valeur ramenée — ${msg}`)
    // l'écriture proposée passe la règle de *filter, qui refuse 55
    assert.doesNotThrow(() => parseEffect('filter', m![1]), msg)
    assert.throws(() => parseEffect('filter', 'blur: 55'))
    // dans la plage : rien à dire
    assert.doesNotMatch(removedEffectError('lens', 'blur: 20') ?? '', /ramen/)
  })

  it('deux effets dans le même pseudo-élément d\'une balise : avertissement du build qui les nomme', async () => {
    const w = await avertissements('<div *shine *noise>x</div>')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /::after/)
    assert.match(w[0], /\*shine/)
    assert.match(w[0], /\*noise/)
    assert.match(w[0], /\[lint\.\w+\]$/)
    const avant = await avertissements('<div *spotlight *border>x</div>')
    assert.equal(avant.length, 1, JSON.stringify(avant))
    assert.match(avant[0], /::before/)
    assert.match(avant[0], /::after/)
  })

  it('pseudo-éléments : pas d\'avertissement quand les effets n\'y dessinent pas ensemble', async () => {
    assert.deepEqual(await avertissements('<div *shine *sparkles>x</div>'), [])
    assert.deepEqual(await avertissements('<div *tilt *noise>x</div>'), [])
    assert.deepEqual(await avertissements('<div *border(style: run) *noise>x</div>'), [])
    assert.deepEqual(await avertissements('<div *shine(where: text) *noise>x</div>'), [])
    assert.deepEqual(await avertissements('<div *shine>x</div><p *noise>y</p>'), [])
    assert.equal((await avertissements('<div *tilt(glare: true) *noise>x</div>')).length, 1)
  })

  it('les réglages d\'image et de texte de la page reconnus par le moteur sont ceux du catalogue', () => {
    const src   = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime', 'mjs_fx.ts'), 'utf-8')
    const lire  = (nom: string) => {
      const m = new RegExp('var ' + nom + ' = (/.+/);').exec(src)
      assert.ok(m, nom)
      return new Function('return ' + m![1])() as RegExp
    }
    const image = lire('_MJS_FX_IMAGE')
    const texte = lire('_MJS_FX_PAGE_TEXT')
    const manque: string[] = []
    for (const [nom, fx] of Object.entries(EFFECTS)) {
      for (const [k, st] of Object.entries(fx.settings)) {
        if (st.rule === 'image' && !image.test(k)) manque.push(`image ${nom}.${k}`)
        const pageText = st.rule === 'words' || st.rule === 'images' || (/^string\b/.test(st.rule) && !st.css)
        if (pageText && !texte.test(k)) manque.push(`texte ${nom}.${k}`)
      }
    }
    assert.deepEqual(manque, [])
  })
})
