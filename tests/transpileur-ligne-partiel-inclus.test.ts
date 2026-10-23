// une faute venue d'un partiel inclus (`<@include bas>`) ne cite jamais une ligne du composant : le HTML
// recollé n'a pas les lignes du fichier, et celles d'un partiel ne sont pas celles du composant ; la ligne
// n'est citée que si elle est celle du fichier du composant lui-même

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const dir = mjsTmp('ligne-partiel')
writeFileSync(join(dir, '_bas.mjs'), '<p>a</p>\n<p>b</p>\n<@document *lang (color: red)>\n<p>c</p>\n')
writeFileSync(join(dir, '_ps.mjs'), '<script>\n@id = \'depuis le partiel\'\n</script>\n<p>partiel</p>\n')

const compile = (src: string) => transpile(src, { moduleName: 'hote', baseDir: dir })

// les avertissements `[lint.naming]` d'une compilation qui doit passer
async function avertissements(src: string): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await compile(src) } finally { console.warn = orig }
  return vus.filter(m => m.includes('[lint.naming]'))
}

describe('une balise du langage écrite dans un partiel inclus', () => {
  it('le message dit la faute, sans citer de ligne : le composant a 8 lignes, la balise n\'y est pas', async () => {
    const { data } = await compile('<script>\n$n = 1\n</script>\n\n<p>un</p>\n<p>deux</p>\n<@include bas>\n<p>trois</p>\n')
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /\*lang \(…\)/)
    assert.match(data.macroErrors[0], /sans espace avant la parenthèse/)
    assert.doesNotMatch(data.macroErrors[0], /ligne/)
  })

  it('la même faute dans le composant et dans un partiel : la ligne n\'est citée que pour le composant', async () => {
    const { data } = await compile('<p>un</p>\n<@include bas>\n<@document *ripple (color: red)>\n')
    assert.equal(data.macroErrors.length, 2, JSON.stringify(data.macroErrors))
    const ripple = data.macroErrors.find(m => /\*ripple/.test(m))!
    const lang   = data.macroErrors.find(m => /\*lang/.test(m))!
    assert.match(ripple, /ligne 3\b/)
    assert.doesNotMatch(lang, /ligne/)
  })

  it('le même texte de balise dans le composant et dans un partiel : on ne sait pas laquelle est fautive, aucune ligne', async () => {
    const { data } = await compile('<p>un</p>\n<@include bas>\n<@document *lang (color: red)>\n')
    assert.equal(data.macroErrors.length, 2, JSON.stringify(data.macroErrors))
    for (const message of data.macroErrors) assert.doesNotMatch(message, /ligne/)
  })
})

describe('@id = … écrit dans le <script> d\'un partiel inclus', () => {
  it('l\'avertissement ne cite pas de ligne : le composant a 2 lignes, le partiel ajoute les siennes au script', async () => {
    const vus = await avertissements('<@include ps>\n<p>x</p>\n')
    assert.equal(vus.length, 1, vus.join(' | '))
    assert.match(vus[0], /@id/)
    assert.doesNotMatch(vus[0], /\(ligne/)
  })

  it('celui du composant garde sa ligne, celui du partiel n\'en a pas', async () => {
    const vus = await avertissements('<script>\n$n = 1\n@title = \'x\'\n</script>\n<@include ps>\n')
    assert.equal(vus.length, 2, vus.join(' | '))
    assert.match(vus.find(m => m.includes('@title'))!, /\(ligne 3\)/)
    assert.doesNotMatch(vus.find(m => m.includes('@id'))!, /\(ligne/)
  })
})
