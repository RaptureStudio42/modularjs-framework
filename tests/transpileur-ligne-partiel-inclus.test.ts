// une faute venue d'un partiel inclus (`<@include bas>`) ne cite jamais une ligne du composant : le HTML
// recollé n'a pas les lignes du fichier ; une balise du langage écrite dans un partiel cite sa ligne dans le
// partiel et nomme son fichier (chemin depuis le dossier du composant), même quand le composant écrit la même
// balise à l'identique

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const dir = mjsTmp('ligne-partiel')
writeFileSync(join(dir, '_bas.mjs'), '<p>a</p>\n<p>b</p>\n<@document *lang (color: red)>\n<p>c</p>\n')
writeFileSync(join(dir, '_ps.mjs'), '<script>\n@id = \'depuis le partiel\'\n</script>\n<p>partiel</p>\n')
writeFileSync(join(dir, '_relais.mjs'), '<p>0</p>\n<@include bas>\n')
mkdirSync(join(dir, 'sous'))
writeFileSync(join(dir, 'sous', '_pied.mjs'), '<p>pied</p>\n\n<@document *ripple (color: red)>\n')

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
  it('le message dit la faute et cite sa ligne dans le partiel, avec le fichier du partiel', async () => {
    const { data } = await compile('<script>\n$n = 1\n</script>\n\n<p>un</p>\n<p>deux</p>\n<@include bas>\n<p>trois</p>\n')
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /\*lang \(…\)/)
    assert.match(data.macroErrors[0], /sans espace avant la parenthèse/)
    assert.match(data.macroErrors[0], /\(ligne 3 de _bas\.mjs\)/)
  })

  it('la même faute dans le composant et dans un partiel : chacune cite sa ligne dans son fichier', async () => {
    const { data } = await compile('<p>un</p>\n<@include bas>\n<@document *ripple (color: red)>\n')
    assert.equal(data.macroErrors.length, 2, JSON.stringify(data.macroErrors))
    const ripple = data.macroErrors.find(m => /\*ripple/.test(m))!
    const lang   = data.macroErrors.find(m => /\*lang/.test(m))!
    assert.match(ripple, /\(ligne 3\)/)
    assert.match(lang, /\(ligne 3 de _bas\.mjs\)/)
  })

  it('un partiel inclus par un partiel, ou deux fois : la ligne du partiel qui porte la balise', async () => {
    for (const src of ['<div>\n<@include relais>\n</div>\n', '<@include bas>\n<p>x</p>\n<@include bas>\n']) {
      const { data } = await compile(src)
      assert.ok(data.macroErrors.length > 0, src)
      for (const message of data.macroErrors) assert.match(message, /\(ligne 3 de _bas\.mjs\)/, src)
    }
  })

  it('un partiel d\'un sous-dossier : son chemin depuis le dossier du composant', async () => {
    const { data } = await compile('<p>un</p>\n<@include ./sous/pied>\n')
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /\(ligne 3 de sous\/_pied\.mjs\)/)
  })

  it('le même texte de balise dans le composant et dans un partiel : chacune cite sa ligne dans son fichier', async () => {
    const { data } = await compile('<p>un</p>\n<@include bas>\n<@document *lang (color: red)>\n')
    assert.equal(data.macroErrors.length, 2, JSON.stringify(data.macroErrors))
    assert.ok(data.macroErrors.some(m => /\(ligne 3\)/.test(m)), JSON.stringify(data.macroErrors))
    assert.ok(data.macroErrors.some(m => /\(ligne 3 de _bas\.mjs\)/.test(m)), JSON.stringify(data.macroErrors))
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
