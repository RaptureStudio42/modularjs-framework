// Les lignes d'import ajoutées devant le `<script module>` par `@import` décalaient d'autant la position d'une erreur
// du compilateur Civet dans ce bloc et sa carte de source. Avec ou sans `@import` (remplacés par des lignes vides), un
// même bloc donne la même ligne d'erreur et la même carte ; les lignes d'import ajoutées n'ont pas de position.

import assert from 'node:assert/strict'
import { decode } from '@jridgewell/sourcemap-codec'
import { transpile } from '../src/transpiler/index.js'

const avecImports = (corps: string): string => `@import a "./a.js"\n@import b "./b.js"\n@import c "./c.js"\n<script module>\n${corps}\n</script>\n<script>\n$n = 1\n</script>\n<p>{$n}</p>`
const sansImports = (corps: string): string => avecImports(corps).replace(/^@import.*$/gm, '')
const position    = async (src: string): Promise<string> => {
  try {
    await transpile(src, { moduleName: 'module-situe' })
    return 'construit'
  }
  catch (e: any) { return /module-situe\.module:(\d+:\d+)/.exec(e.message)?.[1] ?? e.message }
}

describe('<script module> avec @import : erreurs et carte situées', () => {
  it('une parenthèse non fermée ligne 7 : même position avec ou sans @import', async () => {
    const corps = 'export x = 1\nexport y = 2\nexport z = (1'
    const sans  = await position(sansImports(corps))
    assert.match(sans, /^8:1$/)
    assert.equal(await position(avecImports(corps)), sans)
  })

  it('la carte du bloc : mêmes lignes d\'origine avec ou sans @import, imports sans position', async () => {
    const corps  = 'export x = 1\nexport y = 2\nexport zz = 3'
    const lignes = (map: string | undefined, sauter: number): string[] => decode(JSON.parse(map ?? '{}').mappings ?? '').slice(sauter).map(l => [...new Set(l.filter(s => s.length >= 4).map(s => s[2]))].join(','))
    const avec = (await transpile(avecImports(corps), { moduleName: 'module-situe' })).data.moduleSourceMap
    const sans = (await transpile(sansImports(corps), { moduleName: 'module-situe' })).data.moduleSourceMap
    assert.deepEqual(lignes(avec, 3), lignes(sans, 0))
    assert.deepEqual(lignes(avec, 0).slice(0, 3), ['', '', ''])
  })
})
