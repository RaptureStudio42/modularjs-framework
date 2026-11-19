// Le texte d'un fichier JS gardé sur un octet par caractère : un caractère au-delà de U+00FF s'écrit en échappement là où l'échappement
// le vaut (chaîne, gabarit sans étiquette, nom), et le programme rend les mêmes valeurs. Dans le doute, le fichier sort tel quel, en entier :
// gabarit étiqueté, expression régulière, directive, commentaire, caractère hors de tout jeton, antislash devant le caractère, fichier
// illisible, fichier dense en texte non latin (plafond de poids), fichier trop long pour être analysé (plafond de taille). La carte de source suit les colonnes.

import assert from 'node:assert/strict'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { decode } from '@jridgewell/sourcemap-codec'
import { oneByteSource, ONE_BYTE_MAX_GROWTH, ONE_BYTE_MAX_LENGTH } from '../src/bundler/one-byte.js'

// la valeur de `r` après l'exécution du texte
const run = (code: string): unknown => {
  const box: Record<string, unknown> = {}
  vm.runInNewContext(code, box)
  return JSON.parse(JSON.stringify(box.r))
}
const wide = (text: string): number => [...text].filter(c => c.codePointAt(0)! > 0xFF).length

const PROGRAM = [
  'const αβ = "Bientôt… l’œuvre à 5 € 😀";',
  'const gabarit = `Prix… ${αβ} ’ œ € 😀`;',
  'class Boîte { #ключ = "œ"; lire() { return this.#ключ } }',
  'const objet = { ключ: 1, "…": 2, 𝒳: 3, méthodeϟ() { return "ϟ" } };',
  'var r = [αβ, gabarit, new Boîte().lire(), Object.keys(objet).join("|"), objet.ключ, objet["…"], objet.𝒳, objet.méthodeϟ.name, (function nomϟ() {}).name];'
].join('\n')

// [ce qui est écrit, l'état attendu] : chaque fichier doit sortir tel quel, à l'identique
const LEFT: Array<[string, string, string]> = [
  ['un gabarit étiqueté lit le texte brut',                  'var r = String.raw`…`;',                                    'tagged-template'],
  ['une expression régulière garde son texte dans source',   'var r = /…/u.source;',                                      'regexp'],
  ['un commentaire ne s\'échappe pas',                        '// note …\nvar r = 1;',                                     'comment'],
  ['une directive se reconnaît à son texte',                 'function f() { "use … strict"; return 1 }\nvar r = f();',   'directive'],
  ['un antislash devant le caractère',                       'var r = "\\…";',                                            'changed'],
  ['un séparateur de ligne entre deux instructions',         'var a = 1; var r = "é";',                              'elsewhere'],
  ['un fichier qu\'acorn ne lit pas',                         'var = "…"',                                                 'unreadable'],
  ['un dictionnaire en cyrillique, par le plafond de poids', 'var r = { a: "Привет, мир", b: "Доброе утро" };',           'weight'],
  ['pas de demi-mesure : une chaîne et un gabarit étiqueté', 'var a = "…"; var r = String.raw`’`;',                       'tagged-template']
]

describe('texte sur un octet par caractère : échappements sûrs, sinon le fichier tel quel', function () {
  it('chaîne, gabarit sans étiquette et noms : plus aucun caractère au-delà de U+00FF, mêmes valeurs', () => {
    // un texte d'essai est dense : le plafond de poids, qui a son test plus bas, est levé ici
    const out = oneByteSource(PROGRAM, undefined, Infinity)
    assert.equal(out.state, 'converted')
    assert.equal(out.wide, 45)
    assert.equal(wide(out.code), 0)
    const expected = run(PROGRAM) as string[]
    assert.equal(expected[0], 'Bientôt… l’œuvre à 5 € 😀')
    assert.equal(expected[1], 'Prix… Bientôt… l’œuvre à 5 € 😀 ’ œ € 😀')
    assert.deepEqual(expected.slice(2), ['œ', 'ключ|…|𝒳|méthodeϟ', 1, 2, 3, 'méthodeϟ', 'nomϟ'])
    assert.deepEqual(run(out.code), expected)
    // les caractères sous U+0100 restent tels quels
    assert.ok(out.code.includes('Bientôt') && out.code.includes('Boîte') && out.code.includes('méthode'))
    // un caractère sur deux unités : ses deux moitiés dans une chaîne, son point de code dans un nom
    assert.ok(out.code.includes('\\uD83D\\uDE00') && out.code.includes('\\u{1D4B3}'))
  })

  it('un fichier sans caractère au-delà de U+00FF n\'est pas analysé : le même texte', () => {
    const code = 'var r = "é µ ÿ"; var ça = 1;'
    const out  = oneByteSource(code)
    assert.equal(out.state, 'narrow')
    assert.equal(out.code, code)
  })

  for (const [label, code, state] of LEFT) {
    it(`tel quel — ${label}`, () => {
      const out = oneByteSource(code, undefined, state === 'weight' ? undefined : Infinity)
      assert.equal(out.state, state)
      assert.equal(out.code, code)
    })
  }

  it('gabarit étiqueté et expression régulière sans caractère large : le reste du fichier se convertit, eux ne bougent pas', () => {
    const code = 'var t = String.raw`a\\u2026b`; var x = /a\\u2026b/u; var r = ["…", t, x.source];'
    const out  = oneByteSource(code, undefined, Infinity)
    assert.equal(out.state, 'converted')
    assert.deepEqual(run(out.code), ['…', 'a\\u2026b', 'a\\u2026b'])
    assert.deepEqual(run(out.code), run(code))
  })

  it('plafond de taille : un fichier trop long sort tel quel, sans être analysé', () => {
    // le plafond passé à la main : un texte d'essai n'a pas à peser 2 Mo
    const short = oneByteSource('var r = "…";', undefined, Infinity, 10)
    assert.equal(short.state, 'size')
    assert.equal(short.code, 'var r = "…";')
    assert.equal(oneByteSource('var r = "…";', undefined, Infinity, 12).state, 'converted')
    // le plafond par défaut : une unité de plus que lui
    assert.equal(ONE_BYTE_MAX_LENGTH, 2 * 1024 * 1024)
    const long = `var r = "${'a'.repeat(ONE_BYTE_MAX_LENGTH)}…";`
    const out  = oneByteSource(long)
    assert.equal(out.state, 'size')
    assert.equal(out.code, long)
    assert.equal(out.wide, 1)
  })

  it('plafond de poids : 2 % de plus au plus', () => {
    assert.equal(ONE_BYTE_MAX_GROWTH, 0.02)
    // un « … » coûte 3 octets de plus : le fichier doit en peser 150 au moins
    const file  = (bytes: number): string => { const head = 'var r = "…"; var p = "'; return head + 'x'.repeat(bytes - Buffer.byteLength(head) - 2) + '";' }
    const under = file(150)
    const over  = file(149)
    assert.equal(Buffer.byteLength(under), 150)
    assert.equal(oneByteSource(under).state, 'converted')
    assert.equal(Buffer.byteLength(oneByteSource(under).code), 153)
    assert.equal(oneByteSource(over).state, 'weight')
    assert.equal(oneByteSource(over).code, over)
    // le plafond levé, le même fichier se convertit
    assert.equal(oneByteSource(over, undefined, Infinity).state, 'converted')
  })

  it('un séparateur de ligne dans une chaîne s\'échappe ; avec une carte de source, le fichier sort tel quel', () => {
    const code = 'var r = "a b";'
    const out  = oneByteSource(code, undefined, Infinity)
    assert.equal(out.state, 'converted')
    assert.equal(out.code, 'var r = "a\\u2028b";')
    const kept = oneByteSource(code, JSON.stringify({ version: 3, sources: ['a.js'], names: [], mappings: 'AAAA' }), Infinity)
    assert.equal(kept.state, 'map')
    assert.equal(kept.code, code)
  })

  it('la carte de source suit : chaque repère désigne le même jeton, à la même place d\'origine', () => {
    const source = 'console.log("avant… l’œuvre 😀", `milieu… ${globalThis.nom}`)\nglobalThis.fin("après…")\n'
    const built  = transformSync(source, { minify: true, charset: 'utf8', sourcemap: 'external', sourcefile: 'a.js' })
    assert.ok(wide(built.code) > 0)
    const out = oneByteSource(built.code, built.map, Infinity)
    assert.equal(out.state, 'converted')
    assert.equal(wide(out.code), 0)
    const before = decode(JSON.parse(built.map).mappings)
    const after  = decode(JSON.parse(out.map!).mappings)
    assert.equal(after.length, before.length)
    const linesBefore = built.code.split('\n')
    const linesAfter  = out.code.split('\n')
    let checked = 0
    for (const [n, segments] of before.entries()) {
      assert.equal(after[n].length, segments.length)
      for (const [k, segment] of segments.entries()) {
        const moved = after[n][k]
        // même place d'origine, et le même caractère sous le repère (un caractère échappé commence par son antislash)
        assert.deepEqual(moved.slice(1), segment.slice(1))
        const was = linesBefore[n][segment[0]] ?? ''
        const is  = linesAfter[n][moved[0]] ?? ''
        assert.equal(is, was.charCodeAt(0) > 0xFF ? '\\' : was)
        checked++
      }
    }
    assert.ok(checked >= 6, `${checked} repères seulement`)
    // au moins un repère a avancé
    assert.ok(before.some((segments, n) => segments.some((segment, k) => after[n][k][0] > segment[0])))
  })
})
