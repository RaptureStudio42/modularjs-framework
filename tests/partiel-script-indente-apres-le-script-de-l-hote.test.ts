// le script d'un partiel écrit en retrait, dont une ligne revient au bord gauche à l'intérieur d'une chaîne (un gabarit `…`,
// une chaîne sur deux lignes, un bloc """) : versé après le script du composant, il reste une suite d'instructions à part.
// Son retrait se mesure sur les lignes de code seulement ; sinon il restait en retrait, et la dernière instruction du
// composant (`$n = 1`) devenait un appel (`1(…)`), une TypeError au montage

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'
import { mjsTmp } from './helpers/tmp.js'

const J = (...l: string[]) => l.join('\n') + '\n'

const cas: Array<{ id: string, partiel: string[], valeur: RegExp }> = [
  { id: 'gabarit', partiel: ['  @chaine = "a"', '  @gab = `e', 'f`'], valeur: /`e\nf`/ },
  { id: 'chaine-sur-deux-lignes', partiel: ['  @chaine = "a', 'b"'], valeur: /a\\nb|a\nb/ },
  { id: 'bloc-triple', partiel: ['  @bloc = """', 'c', '"""'], valeur: /"c"|`c`|'c'/ }
]

async function compiler(id: string, hote: string, partiel: string[]): Promise<string> {
  const dir = mjsTmp(`partiel-indente-${id}`)
  mkdirSync(dir, { recursive: true })
  const main = J('<script>', hote, '</script>', '<p>{$n}</p>', '<@include ps>')
  writeFileSync(join(dir, 'main.mjs'), main)
  writeFileSync(join(dir, '_ps.mjs'), J('<script>', ...partiel, '</script>', '<p>p</p>'))
  const r: any = await transpileFromMsg({ type: 'transpile', id: 1, content: main, moduleName: 'main', baseDir: dir, sourceDir: dir, preResolvedAssets: {} } as any)
  return String(r.output)
}

describe('le script en retrait d\'un partiel reste à part du script du composant', function () {
  this.timeout(60000)

  for (const c of cas) {
    for (const hote of ['$n = 1', '  $n = 1']) {
      it(`${c.id}, composant « ${hote.trim()} »${hote.startsWith(' ') ? ' en retrait' : ''}`, async () => {
        const code = await compiler(c.id, hote, c.partiel)
        assert.ok(!/\b1\(/.test(code), `la valeur de $n devient un appel :\n${code.slice(0, 1500)}`)
        assert.match(code, /_set\(_mjsThis, 'n', 1\)/)
        assert.match(code, c.valeur)
      })
    }
  }
})

describe('le texte d\'une chaîne du script en retrait d\'un partiel ne change pas', function () {
  this.timeout(60000)

  // composant sans script : le script du partiel se lisait déjà seul ; une ligne de la chaîne plus en retrait que le code garde
  // tout son retrait, comme avant
  it('gabarit au bord gauche et ligne intérieure en retrait, composant sans script', async () => {
    const dir = mjsTmp('partiel-indente-chaine-gardee')
    mkdirSync(dir, { recursive: true })
    const main = J('<p>n</p>', '<@include ps>')
    writeFileSync(join(dir, 'main.mjs'), main)
    writeFileSync(join(dir, '_ps.mjs'), J('<script>', '  @gab = `e', '    g', 'f`', '  @a = 4', '</script>', '<p>p</p>'))
    const r: any = await transpileFromMsg({ type: 'transpile', id: 1, content: main, moduleName: 'main', baseDir: dir, sourceDir: dir, preResolvedAssets: {} } as any)
    assert.match(String(r.output), /`e\n {4}g\nf`/)
  })
})
