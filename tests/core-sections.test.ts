// Les repères d'un module cœur (src/bundler/core-sections.ts) : les morceaux qui ne servent qu'à un attribut (`other` de <@@select>)
// sont écrits entre deux repères ; le filtre les garde ou les ôte, et les repères ne sortent jamais.
// Statique : la grammaire sur de petits textes, puis le VRAI select.mjs du framework, avec et sans ses morceaux « other ».

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { selectCoreSections, type CoreKind } from '../src/bundler/core-sections.js'
import { transpile } from '../src/transpiler/index.js'

const SELECT = fileURLToPath(new URL('../src/core-modules/select.mjs', import.meta.url))

/** tout reste : les morceaux de l'attribut restent, l'autre forme part */
const WITH = (kind: CoreKind) => kind === 'piece'
/** les morceaux de l'attribut partent, l'autre forme revient */
const WITHOUT = (kind: CoreKind) => kind === 'alt'

// un repère qui reste : une ligne de repère, un repère en fin de ligne, une paire de gabarit (les lignes de commentaire qui EXPLIQUENT les repères ne comptent pas)
const leaks = (text: string): string[] => text.split('\n').filter((l) => /^\s*(?:#|\/\/) @@/.test(l) || /\S\s+# @@ \S+$/.test(l) || (!/^\s*(?:#|\/\/)/.test(l) && /<!-- @@/.test(l)))

describe('repères des modules cœur — la grammaire', () => {
  it('un texte sans repère passe tel quel (la même chaîne)', () => {
    const src = '<script>\n  $a = 1\n</script>\n<p>{$a}</p>\n'
    assert.equal(selectCoreSections('x.mjs', src, WITHOUT), src)
  })

  it('script : un bloc entre deux repères part, ses lignes et les repères deviennent des lignes vides', () => {
    const src = ['<script>', '  $a = 1', '  # @@ other', '  $b = 2', '  $c = 3', '  # @@', '  $d = 4', '</script>'].join('\n')
    assert.equal(selectCoreSections('x.mjs', src, WITHOUT), ['<script>', '  $a = 1', '', '', '', '', '  $d = 4', '</script>'].join('\n'))
    assert.equal(selectCoreSections('x.mjs', src, WITH), ['<script>', '  $a = 1', '', '  $b = 2', '  $c = 3', '', '  $d = 4', '</script>'].join('\n'))
  })

  it('script : un repère en fin de ligne ne vaut que pour cette ligne, et le repère ne reste pas', () => {
    const src = '  $a = 1\n  $b = 2 # @@ other\n  $c = 3'
    assert.equal(selectCoreSections('x.mjs', src, WITHOUT), '  $a = 1\n\n  $c = 3')
    assert.equal(selectCoreSections('x.mjs', src, WITH), '  $a = 1\n  $b = 2\n  $c = 3')
  })

  it('gabarit : repères sur leur ligne, et paire sur une même ligne autour d\'un bout de ligne', () => {
    const src = ['<ul>', '  <!-- @@ other -->', '  <li>autre</li>', '  <!-- @@ -->', '  <li>un</li>{if $x}<b>x</b>{end}<!-- @@ other -->{if $y}<i>y</i>{end}<!-- @@ -->', '</ul>'].join('\n')
    assert.equal(selectCoreSections('x.mjs', src, WITHOUT), ['<ul>', '', '', '', '  <li>un</li>{if $x}<b>x</b>{end}', '</ul>'].join('\n'))
    assert.equal(selectCoreSections('x.mjs', src, WITH), ['<ul>', '', '  <li>autre</li>', '', '  <li>un</li>{if $x}<b>x</b>{end}{if $y}<i>y</i>{end}', '</ul>'].join('\n'))
  })

  it('style : repères `//`', () => {
    const src = ['<style>', '  .a', '    color: red', '  // @@ other', '  .b', '    color: blue', '  // @@', '</style>'].join('\n')
    assert.equal(selectCoreSections('x.mjs', src, WITHOUT), ['<style>', '  .a', '    color: red', '', '', '', '', '</style>'].join('\n'))
    assert.equal(selectCoreSections('x.mjs', src, WITH), ['<style>', '  .a', '    color: red', '', '  .b', '    color: blue', '', '</style>'].join('\n'))
  })

  it('les repères s\'emboîtent : le morceau de dedans ne reste que si celui de dehors reste', () => {
    const src = ['# @@ other', 'a', '# @@ dev other', 'b', '# @@', 'c', '# @@', 'd'].join('\n')
    const seen: string[] = []
    const out = selectCoreSections('x.mjs', src, (kind, attr) => { seen.push(kind + ':' + attr); return kind === 'dev' })
    assert.equal(out, ['', '', '', '', '', '', '', 'd'].join('\n'), 'dehors ôté : dedans ôté, même demandé')
    assert.deepEqual(seen, ['piece:other'], 'le filtre n\'est même pas interrogé pour un morceau dans un morceau ôté')
    const keep = selectCoreSections('x.mjs', src, (kind) => kind !== 'alt')
    assert.equal(keep, ['', 'a', '', 'b', '', 'c', '', 'd'].join('\n'))
  })

  it('l\'autre forme est écrite en commentaire : décommentée quand l\'attribut part, retirée quand il reste, retrait gardé', () => {
    const src = ['  # @@ other', '  $a = full()', '  # @@', '  # @@ !other', '  # $a = lean()', '  # if $b', '  #   $c = 1', '  # @@', '  $z = 0'].join('\n')
    assert.equal(selectCoreSections('x.mjs', src, WITHOUT), ['', '', '', '', '  $a = lean()', '  if $b', '    $c = 1', '', '  $z = 0'].join('\n'))
    assert.equal(selectCoreSections('x.mjs', src, WITH), ['', '  $a = full()', '', '', '', '', '', '', '  $z = 0'].join('\n'))
  })

  it('l\'autre forme tient aussi sur une ligne (repère en fin de ligne) et dans le gabarit (commentaire HTML)', () => {
    const src = ['  a = 1 # @@ other', '  # a = 2 # @@ !other', '<!-- @@ other -->', '<div class="x">', '<!-- @@ -->', '<!-- @@ !other -->', '<!-- <div> -->', '<!-- @@ -->'].join('\n')
    assert.equal(selectCoreSections('x.mjs', src, WITHOUT), ['', '  a = 2', '', '', '', '', '<div>', ''].join('\n'))
    assert.equal(selectCoreSections('x.mjs', src, WITH), ['  a = 1', '', '', '<div class="x">', '', '', '', ''].join('\n'))
  })

  it('le filtre reçoit le genre et le nom de l\'attribut, noms à tirets compris', () => {
    const asked: string[] = []
    const src = ['# @@ other', '# @@', '# @@ !other-label', '# @@', '# @@ dev other-placeholder', '# @@'].join('\n')
    selectCoreSections('x.mjs', src, (kind, attr) => { asked.push(kind + ':' + attr); return true })
    assert.deepEqual(asked, ['piece:other', 'alt:other-label', 'dev:other-placeholder'])
  })

  it('un repère mal fermé est une erreur de build, jamais un morceau manquant en silence', () => {
    assert.throws(() => selectCoreSections('x.mjs', '# @@', WITH), /x\.mjs.*ferme une section.*pas été ouverte/)
    assert.throws(() => selectCoreSections('x.mjs', '# @@ other\na', WITH), /x\.mjs.*pas fermée/)
    assert.throws(() => selectCoreSections('x.mjs', '# @@ other\na\n// @@', WITH), /x\.mjs.*pas fermée/, 'ouverte en script, fermée en style')
    assert.throws(() => selectCoreSections('x.mjs', '<li>a<!-- @@ other -->b</li>', WITH), /x\.mjs.*pas fermée/, 'paire de gabarit ouverte sur une ligne')
    assert.throws(() => selectCoreSections('x.mjs', '# @@ Other\n# @@', WITH), /étiquette « Other »/)
    assert.throws(() => selectCoreSections('x.mjs', 'a # @@ !!other', WITH), /étiquette « !!other »/)
  })

  it('un texte qui parle de repères sans en être ne bouge pas : `@@closest`, `<@@optgroup>`, un `#` dans une chaîne', () => {
    const src = ['  # le <@@optgroup> d\'une option', '  root = @@closest(\'form\')', '  x = "#{a} # @ @"', '<@@field a="b"></@@field>'].join('\n')
    assert.equal(selectCoreSections('x.mjs', src, WITHOUT), src)
  })
})

describe('repères des modules cœur — le vrai select.mjs', () => {
  const src = readFileSync(SELECT, 'utf-8')
  // des noms qui ne servent qu'à « Autre » : fonctions, état, classes de style, libellés, évènement
  const AUTRE = ['otherMaxOf', 'otherMax', 'otherEditing', 'freeOf', 'choicesOf', 'givenOf', 'listedOf', 'cutText', 'otherTextsOf', 'otherRowOf', 'otherName', 'fitOther', 'openOther', 'cancelOther', 'submitOther', 'otherInputRef', 'otherHintId', 'select-other-edit', 'select-other-line', 'select-other-ok', 'select-other-meta', 'select-other-count', 'with-other', 'selectOther', 'µemit \'other\'', '_other', 'dev.selectOtherScript']
  const nbLines = (s: string) => s.split('\n').length

  it('le fichier tel quel porte des repères, et chacun s\'ouvre et se ferme', () => {
    assert.match(src, /# @@ other/)
    assert.match(src, /<!-- @@ other -->/)
    assert.match(src, /\/\/ @@ other/)
    assert.doesNotThrow(() => selectCoreSections(SELECT, src, WITH))
    assert.doesNotThrow(() => selectCoreSections(SELECT, src, WITHOUT))
  })

  it('avec ses morceaux : les repères ont disparu, rien d\'autre n\'a changé, mêmes numéros de ligne', () => {
    const full = selectCoreSections(SELECT, src, WITH)
    assert.deepEqual(leaks(full), [], 'aucun repère ne sort')
    assert.equal(nbLines(full), nbLines(src))
    for (const nom of AUTRE.filter((n) => n !== 'dev.selectOtherScript')) assert.ok(full.includes(nom), `${nom} reste`)
    assert.equal(full.includes('dev.selectOtherScript'), false, 'l\'avertissement du développement ne reste pas : il a son propre genre')
    assert.equal(full.includes('# $'), false, 'aucune autre forme (commentée) ne reste')
  })

  it('sans ses morceaux : plus rien de propre à « Autre », mêmes numéros de ligne, nettement plus court', () => {
    const lean = selectCoreSections(SELECT, src, WITHOUT)
    assert.deepEqual(leaks(lean), [], 'aucun repère ne sort')
    assert.equal(nbLines(lean), nbLines(src))
    for (const nom of AUTRE) assert.equal(lean.includes(nom), false, `${nom} est parti`)
    // le seul reste : le sélecteur d'un champ de réponse libre dans la règle du texte d'attente, une règle d'un autre morceau du fichier
    const reste = lean.match(/select-other[\w-]*/g) ?? []
    assert.ok(reste.length <= 1 && reste.every((x) => x === 'select-other-input'), `restes : ${reste.join(', ')}`)
    assert.ok(lean.replace(/\n{2,}/g, '\n').length < src.length * 0.75, `${lean.replace(/\n{2,}/g, '\n').length} octets contre ${src.length}`)
  })

  it('les deux formes se compilent ; le fichier tel quel aussi (copie dans un projet : les repères y sont des commentaires)', async function () {
    this.timeout(60000)
    for (const [nom, text] of [['tel quel', src], ['avec', selectCoreSections(SELECT, src, WITH)], ['sans', selectCoreSections(SELECT, src, WITHOUT)]]) {
      const r: any = await transpile(text, { moduleName: 'core-select' } as any)
      assert.ok(String(r.output).length > 10000, `${nom} : sortie ${String(r.output).length} octets`)
    }
  })
})
