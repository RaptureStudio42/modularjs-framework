// Les lignes retenues pour chaque gestionnaire inline (elles servent à citer la ligne d'un avertissement) suivent
// les gestionnaires émis : une par gestionnaire, aucune restée de la passe de collecte ni d'une compilation
// précédente. Deux remises à zéro y veillent, chacune gardée seule : celle qui sépare la passe de collecte de la
// passe réelle (sinon les lignes sont doublées), celle qui ouvre une compilation (`reset`).
//
// Les avertissements « relais événement brut » et « # dans le HTML » citent la ligne du fichier, aussi dans les
// branches d'un bloc ({if}/{else}, {await}/{success}/{error}) : la descente dans les branches est gardée par les
// avertissements sur `disabled="false"` et sur une ligne qui commence par `#`.

import assert from 'node:assert/strict'
import { compile } from '../src/generator/compile.js'
import { state, reset } from '../src/generator/index.js'
import { CompilerState } from '../src/generator/state.js'
import { transpile } from '../src/transpiler/index.js'

const SOURCE = [
  '<button @click={a()}>1</button>',
  '<p>',
  '<button @click={b()}>2</button>',
  '</p>',
  '<button @click={c()}>3</button>',
].join('\n')

async function avertissements(src: string, filtre: string): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(src, { moduleName: 'lignes' }) } finally { console.warn = orig }
  return vus.filter(m => m.includes(filtre))
}

describe('générateur — les lignes des gestionnaires inline', () => {
  it('une ligne par gestionnaire émis, celle de sa balise (la passe de collecte ne laisse rien)', () => {
    const [, , , inlines] = compile(SOURCE)
    assert.equal(inlines.length, 3)
    assert.deepEqual(state.inlineLines, [1, 3, 5])
  })

  it('une deuxième compilation repart de zéro', () => {
    compile(SOURCE)
    compile('<button @click={z()}>1</button>')
    assert.deepEqual(state.inlineLines, [1])
  })

  it('reset() vide les lignes retenues', () => {
    compile(SOURCE)
    assert.equal(state.inlineLines.length, 3)
    reset()
    assert.deepEqual(state.inlineLines, [])
  })

  it('CompilerState.reset() vide les lignes retenues', () => {
    const s = new CompilerState()
    s.inlineLines.push(4, 7)
    s.reset()
    assert.deepEqual(s.inlineLines, [])
  })

  it('« relais événement brut » : la ligne citée est celle du gestionnaire fautif', async () => {
    const src = '<p>a</p>\n<button @click={ok()}>1</button>\n<p>b</p>\n<button @click={µemit \'x\', e}>2</button>\n'
    const vus = await avertissements(src, 'µemit')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /4/)
  })
})

describe('générateur — avertissements des pièges du HTML dans les branches d\'un bloc', () => {
  it('disabled="false" dans {if} et dans {else} : deux avertissements, à leur ligne', async () => {
    const src = '<script>\n$a = true\n</script>\n{if $a}\n<button disabled="false">1</button>\n{else}\n<input checked="false">\n{end}\n'
    const vus = await avertissements(src, '[lint.syntax]')
    assert.equal(vus.length, 2, vus.join('\n'))
    assert.match(vus[0], /disabled="false"/)
    assert.match(vus[1], /checked="false"/)
  })

  it('disabled="false" dans {success} et dans {error} d\'un {await} : deux avertissements', async () => {
    const src = '<script>\n$p ?= null\n</script>\n{await $p}\n<i>attente</i>\n{success d}\n<button disabled="false">{d}</button>\n{error err}\n<input checked="false">\n{end}\n'
    const vus = await avertissements(src, '[lint.syntax]')
    assert.equal(vus.length, 2, vus.join('\n'))
  })

  it('une ligne « # … » dans {else} : un avertissement', async () => {
    const src = '<script>\n$a = true\n</script>\n{if $a}\n<b>x</b>\n{else}\n<p>\n# oubli de commentaire\nsuite\n</p>\n{end}\n'
    const vus = await avertissements(src, '[lint.syntax]')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /# oubli de commentaire/)
  })
})
