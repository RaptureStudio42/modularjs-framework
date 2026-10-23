// le style qui fait clignoter *attention s'appelle `blink` : `flash` se confondait avec l'effet *flash. L'ancien nom arrête la
// construction et propose `blink` — `*attention(flash)`, `style: flash` et `*attention.flash`, sur une balise, sur <@document>
// comme dans un fichier `*.effects.mjs`, en français et en anglais. Le runtime dessine `blink`, plus `flash`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEffect, setProjectEffects } from '../src/effects/catalog.js'
import { resolveProjectEffects, parseEffectsBlock } from '../src/effects/project.js'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const erreur = (nom: string, raw = ''): string => {
  try {
    parseEffect(nom, raw)
  }
  catch (e) {
    return (e as Error).message
  }
  return ''
}

// les erreurs d'un fichier d'effets qui écrit `ligne`
const fichier = (ligne: string): string[] => {
  const problems: Error[] = []
  resolveProjectEffects([parseEffectsBlock(ligne, 1, '/x/app.effects.mjs', problems)], () => {}, problems)
  return problems.map(p => p.message)
}

describe('*attention : le style `flash` s\'appelle `blink`', () => {
  before(() => setProjectEffects(resolveProjectEffects([])))
  after(() => setProjectEffects({}))
  afterEach(() => setMessagesLang('fr'))

  it('`blink` se pose, sans nom comme avec son nom', () => {
    assert.equal(parseEffect('attention', 'blink').fixed.style, 'blink')
    assert.equal(parseEffect('attention', 'style: blink, on: hover').fixed.style, 'blink')
  })

  it('*attention(flash) et style: flash : l\'erreur propose blink, et dit pourquoi', () => {
    for (const raw of ['flash', 'style: flash', 'style: flash, on: click']) {
      const m = erreur('attention', raw)
      assert.ok(m.includes('*attention : style = flash n\'existe plus — écrivez style: blink'), m)
      assert.match(m, /l'effet \*flash/)
      assert.match(m, /permis : 'tada' \|/)
      assert.ok(!/'flash'/.test(m), 'la liste des styles permis ne nomme plus flash : ' + m)
    }
  })

  it('*attention.flash : l\'écriture qui le remplace, réglages écrits gardés', () => {
    assert.ok(erreur('attention.flash').includes('écrivez à la place *attention(style: blink).'), erreur('attention.flash'))
    const m = erreur('attention.flash', 'on: hover')
    assert.match(m, /\*attention\(style: blink, on: hover\)/)
  })

  it('sur une balise et sur <@document> : la construction s\'arrête', async () => {
    await assert.rejects(transpile('<button *attention(flash)>x</button>', { moduleName: 'attention-flash-balise' }), /écrivez style: blink/)
    await assert.rejects(transpile('<button *attention.flash>x</button>', { moduleName: 'attention-flash-alias' }), /écrivez à la place \*attention\(style: blink\)/)
    const { data } = await transpile('<@document *attention.flash></@document>\n<p>x</p>\n', { moduleName: 'attention-flash-doc' })
    assert.ok(data.macroErrors.some((e: string) => e.includes('*attention(style: blink)')), JSON.stringify(data.macroErrors))
  })

  it('dans un fichier *.effects.mjs : l\'ancien nom refusé, le nouveau accepté', () => {
    assert.ok(fichier('*appel = *attention(flash)').some(m => m.includes('écrivez style: blink')), JSON.stringify(fichier('*appel = *attention(flash)')))
    assert.ok(fichier('*appel = *attention.flash').some(m => m.includes('*attention(style: blink)')), JSON.stringify(fichier('*appel = *attention.flash')))
    assert.deepEqual(fichier('*appel = *attention(blink, on: hover)'), [])
  })

  it('en anglais', () => {
    setMessagesLang('en')
    const m = erreur('attention', 'flash')
    assert.match(m, /\*attention: style = flash no longer exists — write style: blink/)
    assert.match(m, /the \*flash effect/)
    assert.match(erreur('attention.flash'), /write \*attention\(style: blink\) instead\./)
  })

  it('le runtime dessine blink (images clés, rendu sans composition), plus flash', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'runtime', 'mjs_fx_attention.ts'), 'utf-8')
    assert.match(src, /^ {2}blink: '0%,50%,100%\{opacity:1\}25%,75%\{opacity:0\}',$/m)
    assert.match(src, /\[mjs-fx-attention-style="blink"\]\[mjs-fx-play~="attention"\]\{animation-composition:replace\}/)
    assert.doesNotMatch(src, /flash/)
  })
})
