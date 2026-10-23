// `++` entre deux blancs est la concaténation de Civet (`['a'] ++ b`, `"x" ++ b`) : avec µlayout d'un côté ou
// de l'autre, c'est une lecture, elle compile. Seuls `µlayout++` et `++µlayout`, COLLÉS, sont des écritures
// et restent refusés (comme `--`, qui n'a pas d'autre sens).

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const ecrit = /« µlayout » se lit, il ne s'écrit pas/

const script = (corps: string) => `<script>\n  ${corps}\n</script>\n<p>x</p>\n`

describe('µlayout et la concaténation ++ de Civet', () => {
  it('<script> : un tableau ++ µlayout compile en concat, la valeur de µlayout comprise', async () => {
    const { output } = await transpile(script('classes := [\'card\'] ++ µlayout'), { moduleName: 'carte' })
    assert.match(output, /\['card'\]\.concat\(\(\$\.layout \|\| 'default'\)\)/)
  })

  it('<script> : µlayout ++ un tableau, ou une chaîne', async () => {
    const { output } = await transpile(script('a := µlayout ++ [\'x\']\n  b := µlayout ++ \'y\''), { moduleName: 'carte' })
    assert.match(output, /\(\$\.layout \|\| 'default'\)\.concat\(\['x'\]\)/)
    assert.match(output, /\(\$\.layout \|\| 'default'\)\.concat\('y'\)/)
  })

  it('<script> : sur plusieurs lignes, µlayout ++ en fin de ligne', async () => {
    const { output } = await transpile(script('a := µlayout ++\n    [\'x\']'), { moduleName: 'carte' })
    assert.match(output, /\(\$\.layout \|\| 'default'\)\.concat\(\s*\['x'\]\s*\)/)
  })

  it('HTML : {"x" ++ µlayout} et {µlayout ++ "x"} compilent', async () => {
    await transpile('<p>{"x" ++ µlayout}</p>\n', { moduleName: 'carte' })
    await transpile('<p>{µlayout ++ "x"}</p>\n', { moduleName: 'carte' })
    await transpile('<p class={["a"] ++ µlayout}>x</p>\n', { moduleName: 'carte' })
  })

  it('gestionnaire du HTML : $x = [1] ++ µlayout compile', async () => {
    await transpile('<script>\n  $x = [0]\n</script>\n<button @click={$x = [1] ++ µlayout}>b</button><p>{$x}</p>\n', { moduleName: 'carte' })
  })

  it('une concaténation à côté d\'un incrément qui ne touche pas µlayout : permis', async () => {
    await transpile(script('i .= 0\n  i++\n  x := [i] ++ µlayout'), { moduleName: 'carte' })
    await transpile(script('i .= 0\n  x := [i++] ++ µlayout'), { moduleName: 'carte' })
  })

  const refus: [string, string][] = [
    ['µlayout++', 'µlayout++'],
    ['++µlayout', '++µlayout'],
    ['µlayout--', 'µlayout--'],
    ['--µlayout', '--µlayout'],
    ['++µlayout collé après un tableau', 'x := [\'a\'] ++µlayout'],
    ['µlayout++ après une concaténation', 'x := [\'a\'] ++ µlayout++'],
    ['++µlayout après une concaténation', 'x := [\'a\'] ++ ++µlayout'],
  ]
  for (const [nom, code] of refus) {
    it(`<script> : ${nom} reste refusé, avec le message de µlayout`, async () => {
      await assert.rejects(transpile(script(code), { moduleName: 'carte' }), ecrit)
    })
  }

  for (const code of ['{µlayout++}', '{++µlayout}', '{["a"] ++µlayout}']) {
    it(`HTML : ${code} reste refusé, avec le message de µlayout`, async () => {
      await assert.rejects(transpile(`<p>${code}</p>\n`, { moduleName: 'carte' }), ecrit)
    })
  }

  for (const code of ['µlayout++', '++µlayout', '$x = ++µlayout', '$x = [0] ++µlayout']) {
    it(`gestionnaire du HTML : ${code} reste refusé, avec le message de µlayout`, async () => {
      await assert.rejects(transpile(`<script>\n  $x = 1\n</script>\n<button @click={${code}}>b</button>\n`, { moduleName: 'carte' }), ecrit)
    })
  }
})
