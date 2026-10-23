// Types et valeurs permises — la grammaire d'une règle, et des lignes d'un bloc <vars> (composant)
// ou <types> (fichier *.types.mjs). Une règle dit ce qu'une variable accepte (liste blanche, avant
// le `!`) et ce qu'elle refuse (liste noire, après le `!`) ; une plage de nombres dit toujours
// `int` ou `float`. La forme compilée est celle que lit le runtime (mjs_types.ts).

import assert from 'node:assert/strict'
import { parseRule, parseVarsBlock, parseTypesBlock, resolveRule, ruleText, emitRuntimeRule } from '../src/transpiler/var-types.js'

const OU = { bloc: '<vars>', ligne: 1 }
const regle = (texte: string) => parseRule(texte, OU)
const evaluer = (js: string) => new Function(`return ${js}`)()

describe('types — une règle', () => {
  it('nombres : int et float, plage fermée ou ouverte', () => {
    assert.deepEqual(regle('int 0..100'), { k: 'int', min: 0, max: 100 })
    assert.deepEqual(regle('float 0..1'), { k: 'float', min: 0, max: 1 })
    assert.deepEqual(regle('int 0..'), { k: 'int', min: 0 })
    assert.deepEqual(regle('float ..-0.5'), { k: 'float', max: -0.5 })
    assert.deepEqual(regle('int -10..10'), { k: 'int', min: -10, max: 10 })
    assert.deepEqual(regle('int'), { k: 'int' })
  })

  it('texte : longueur et forme, dans les deux ordres', () => {
    assert.deepEqual(regle('string 3..20 /^[a-z0-9_]+$/'), { k: 'string', min: 3, max: 20, re: { source: '^[a-z0-9_]+$', flags: '' } })
    assert.deepEqual(regle('string /^a/i 1..'), { k: 'string', min: 1, re: { source: '^a', flags: 'i' } })
    assert.deepEqual(regle('bool'), { k: 'bool' })
  })

  it('valeurs permises : une liste de valeurs, textes et nombres', () => {
    assert.deepEqual(regle("'red' | 'green' | \"blue\""), { k: 'lit', values: ['red', 'green', 'blue'] })
    assert.deepEqual(regle('1 | 2 | 3'), { k: 'lit', values: [1, 2, 3] })
    assert.deepEqual(regle('true | null'), { k: 'lit', values: [true, null] })
  })

  it('valeurs interdites : tout ce qui suit le `!`, la liste blanche peut être vide', () => {
    assert.deepEqual(regle("! 'admin' | 'root'"), { k: 'any', not: [{ lit: 'admin' }, { lit: 'root' }] })
    assert.deepEqual(regle("string 3..20 ! 'admin' | 'root'"), { k: 'string', min: 3, max: 20, not: [{ lit: 'admin' }, { lit: 'root' }] })
    assert.deepEqual(regle('int 0..10 ! 5 | 7..8'), { k: 'int', min: 0, max: 10, not: [{ lit: 5 }, { min: 7, max: 8 }] })
    assert.deepEqual(regle("'a' | 'b' | 'c' ! 'b'"), { k: 'lit', values: ['a', 'b', 'c'], not: [{ lit: 'b' }] })
  })

  it('listes, objets, règles nommées et mélanges', () => {
    assert.deepEqual(regle('string[] 0..10'), { k: 'array', of: { k: 'string' }, min: 0, max: 10 })
    assert.deepEqual(regle('int 1..5[]'), { k: 'array', of: { k: 'int', min: 1, max: 5 } })
    assert.deepEqual(regle('Percent[][]'), { k: 'array', of: { k: 'array', of: { k: 'ref', name: 'Percent' } } })
    assert.deepEqual(regle('{ volume: Percent, bass?: int -10..10, "a b": string }'), { k: 'object', fields: [
      { key: 'volume', optional: false, rule: { k: 'ref', name: 'Percent' } },
      { key: 'bass', optional: true, rule: { k: 'int', min: -10, max: 10 } },
      { key: 'a b', optional: false, rule: { k: 'string' } },
    ] })
    assert.deepEqual(regle("int 0..10 | 'auto'"), { k: 'union', alts: [{ k: 'int', min: 0, max: 10 }, { k: 'lit', values: ['auto'] }] })
    assert.deepEqual(regle("{ role: ! 'root', n: int }"), { k: 'object', fields: [
      { key: 'role', optional: false, rule: { k: 'any', not: [{ lit: 'root' }] } },
      { key: 'n', optional: false, rule: { k: 'int' } },
    ] })
  })

  it('une plage de nombres sans int ni float est refusée, avec les deux écritures possibles', () => {
    assert.throws(() => regle('0..100'), /int 0\.\.100[\s\S]*float 0\.\.100/)
    assert.throws(() => regle('..5'), /int \.\.5[\s\S]*float \.\.5/)
  })

  it('les fautes de forme sont refusées, chacune avec son message', () => {
    assert.throws(() => regle('int 5..1'), /5\.\.1/, 'bornes inversées')
    assert.throws(() => regle('int 0.5..3'), /entières/, 'un int a des bornes entières')
    assert.throws(() => regle('string -1..3'), /longueur/, 'une longueur est positive')
    assert.throws(() => regle('bool 0..1'), /plage/, 'pas de plage sur un bool')
    assert.throws(() => regle('int /x/'), /string/, 'une forme /…/ ne va que sur un string')
    assert.throws(() => regle('string /x/g'), /g/, 'drapeau g refusé : il rend le test changeant')
    assert.throws(() => regle('string /[/'), /\/\[\//, 'expression invalide')
    assert.throws(() => regle('int 0..10 0..5'), /deux/, 'deux plages')
    assert.throws(() => regle('int !'), /!/, 'rien après le !')
    assert.throws(() => regle("string[] ! 'x'"), /liste|objet/, 'interdits sur une liste')
    assert.throws(() => regle("'abc"), /fermée|ferme/, 'chaîne non fermée')
    assert.throws(() => regle('{ a: int'), /\}/, 'accolade non fermée')
    assert.throws(() => regle('{ a: int, a: float }'), /a/, 'clé en double')
    assert.throws(() => regle('int ; 3'), /;/, 'caractère inconnu')
  })
})

describe('types — le texte canonique et la forme compilée', () => {
  it('ruleText réécrit la règle sous une forme unique', () => {
    assert.equal(ruleText(regle('int   0..100')), 'int 0..100')
    assert.equal(ruleText(regle("string 3..20 /^a/i ! 'admin'|'root'")), "string 3..20 /^a/i ! 'admin' | 'root'")
    assert.equal(ruleText(regle('{ a: int, b?: string[] 0..3 }')), '{ a: int, b?: string[] 0..3 }')
    assert.equal(ruleText(regle("! 'x'")), "! 'x'")
  })

  it('emitRuntimeRule : un objet JS court, textes compris en développement seulement', () => {
    assert.deepEqual(evaluer(emitRuntimeRule(regle('int 0..100'), false)), { t: 'i', a: 0, b: 100 })
    assert.deepEqual(evaluer(emitRuntimeRule(regle('int 0..100'), true)), { t: 'i', a: 0, b: 100, d: 'int 0..100' })
    const s = evaluer(emitRuntimeRule(regle("string 3.. /^[a-z]+$/ ! 'admin'"), false))
    assert.equal(s.t, 's')
    assert.equal(s.a, 3)
    assert.ok(s.r instanceof RegExp && s.r.test('abc') && !s.r.test('ABC'))
    assert.deepEqual(s.n, ['admin'])
    assert.deepEqual(evaluer(emitRuntimeRule(regle('int 0..10 ! 7..8'), false)).n, [{ a: 7, b: 8 }])
    assert.deepEqual(evaluer(emitRuntimeRule(regle("'a' | 1"), false)), { t: 'l', v: ['a', 1] })
    assert.deepEqual(evaluer(emitRuntimeRule(regle('{ a: int, "b c"?: bool }'), false)), { t: 'o', f: { a: { t: 'i' }, 'b c': { t: 'b' } }, o: ['b c'] })
    assert.deepEqual(evaluer(emitRuntimeRule(regle('float[] ..2'), false)), { t: 'a', e: { t: 'f' }, b: 2 })
    assert.deepEqual(evaluer(emitRuntimeRule(regle("int | 'auto'"), false)), { t: 'u', u: [{ t: 'i' }, { t: 'l', v: ['auto'] }] })
    assert.deepEqual(evaluer(emitRuntimeRule(regle("! 'x'"), false)), { t: '*', n: ['x'] })
  })
})

describe('types — lignes d’un bloc', () => {
  it('<vars> : variables et stores, commentaires, lignes vides, objet sur plusieurs lignes', () => {
    const raw = [
      '# le son',
      '$volume    Percent            # entier de 0 à 100',
      '',
      "$color     'red' | 'green'    # une couleur # avec un dièse",
      '$settings  {',
      '  volume: Percent,',
      '  bass?: int -10..10',
      '}',
      '$$cart     { quantity: int 1..99 }',
      "$tag       string ! '#admin'",
    ].join('\n')
    const lignes = parseVarsBlock(raw, 10)
    assert.deepEqual(lignes.map(l => [l.name, l.store, l.line]), [['volume', false, 11], ['color', false, 13], ['settings', false, 14], ['cart', true, 18], ['tag', false, 19]])
    assert.deepEqual(lignes[0].rule, { k: 'ref', name: 'Percent' })
    assert.deepEqual(lignes[2].rule, { k: 'object', fields: [
      { key: 'volume', optional: false, rule: { k: 'ref', name: 'Percent', lineOffset: 1 } },
      { key: 'bass', optional: true, rule: { k: 'int', min: -10, max: 10 } },
    ] }, 'une règle nommée citée sur une ligne suivante garde son écart de ligne, pour ses messages')
    assert.deepEqual(lignes[4].rule, { k: 'string', not: [{ lit: '#admin' }] }, 'un # dans une chaîne n’est pas un commentaire')
  })

  it('<vars> : une forme /…/ se lit entière, même avec `/`, `#` ou `{` dans sa classe', () => {
    const lignes = parseVarsBlock('$pseudo  string /^[a-z/#]+$/i   # fin\n$code    string /^[{]+$/\n$autre   int', 1)
    assert.deepEqual(lignes.map(l => [l.name, l.line]), [['pseudo', 1], ['code', 2], ['autre', 3]])
    assert.deepEqual(lignes[0].rule, { k: 'string', re: { source: '^[a-z/#]+$', flags: 'i' } })
    assert.deepEqual(lignes[1].rule, { k: 'string', re: { source: '^[{]+$', flags: '' } })
  })

  it('<vars> : une règle nommée, un deux-points, une variable en double sont refusés', () => {
    assert.throws(() => parseVarsBlock('Percent int 0..100', 1), /\*\.types\.mjs/)
    assert.throws(() => parseVarsBlock('$volume: int 0..100', 1), /\$volume  int 0\.\.100/)
    assert.throws(() => parseVarsBlock('$a int\n$a float', 1), /\$a/)
    assert.throws(() => parseVarsBlock('$a', 3), /ligne 3/)
  })

  it('<types> : des règles nommées seulement', () => {
    const lignes = parseTypesBlock('Percent  int 0..100\nRatio    float 0..1', 1)
    assert.deepEqual(lignes.map(l => [l.name, l.line]), [['Percent', 1], ['Ratio', 2]])
    assert.throws(() => parseTypesBlock('$volume int', 1), /<vars>/)
    assert.throws(() => parseTypesBlock('int int 0..3', 1), /int/, 'un mot réservé ne se renomme pas')
  })
})

describe('types — règles nommées', () => {
  const defs = {
    Percent: regle('int 0..100'),
    Mix:     regle('{ volume: Percent, bass: int }'),
  }

  it('une règle nommée est remplacée par sa définition, partout où elle sert', () => {
    assert.deepEqual(resolveRule(regle('Percent'), defs, OU), { k: 'int', min: 0, max: 100, name: 'Percent' })
    const r = resolveRule(regle('Mix[] ..4'), defs, OU)
    assert.deepEqual(r, { k: 'array', max: 4, of: { k: 'object', name: 'Mix', fields: [
      { key: 'volume', optional: false, rule: { k: 'int', min: 0, max: 100, name: 'Percent' } },
      { key: 'bass', optional: false, rule: { k: 'int' } },
    ] } })
  })

  it('les interdits d’un usage s’ajoutent à ceux de la définition', () => {
    const d = { Nick: regle("string ! 'root'") }
    // ceux de l'usage restent à part aussi (ownNot) : le texte affiché est « Nick ! 'admin' »
    assert.deepEqual(resolveRule(regle("Nick ! 'admin'"), d, OU), { k: 'string', name: 'Nick', not: [{ lit: 'root' }, { lit: 'admin' }], ownNot: [{ lit: 'admin' }] })
  })

  it('nom inconnu : refusé avec une suggestion ; boucle : refusée', () => {
    assert.throws(() => resolveRule(regle('Percnt'), defs, OU), /Percent/)
    const boucle = { A: regle('B[]'), B: regle('{ a: A }') }
    assert.throws(() => resolveRule(regle('A'), boucle, OU), /A[\s\S]*B|B[\s\S]*A/)
  })
})
